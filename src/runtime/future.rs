//! What a future on the JS loop ([`bun_jsc::future`]) can await that this crate owns:
//! the timer heap, JavaScript promises and child processes.
//!
//! Each is the one owner of its kind that the dispatch tables know
//! (`EventLoopTimerTag::Future`, `native_promise_context::Tag::Future`, `ProcessExit::Command`,
//! `BufferedReaderParentLink::Command`). An `async fn` that uses them adds no tag, no arm and no
//! callback of its own.

use core::cell::Cell;
use core::ffi::CStr;
use core::future::Future;
use core::marker::PhantomPinned;
use core::pin::Pin;
use core::ptr::NonNull;
use core::task::{Context, Poll};
use std::rc::Rc;

use bun_async::Slot;
use bun_core::{Timespec, TimespecMockMode};
use bun_io::BufferedReader as OutputReader;
use bun_jsc::bindgen::{JsLocal, JsScope};
use bun_jsc::future::LoopRef;
use bun_jsc::js_promise::{UnwrapMode, Unwrapped};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{EventLoopHandle, JSGlobalObject, JSPromise, JSValue, JsCell, JsResult, Strong};
use bun_ptr::ThisPtr;
use bun_resolver::fs::FileSystem;
use bun_sys as sys;

#[cfg(not(windows))]
use crate::api::bun::process::SpawnResultExt as _;
use crate::api::bun::process::{self as spawn, ProcessHandle, Rusage, SpawnOptions, Status};
use crate::api::native_promise_context;
use crate::generated_bindgen::future::{Bun__Future__onFulfilled, Bun__Future__onRejected};
use crate::jsc_hooks::timer_all_mut as timer_all;
use crate::timer::{EventLoopTimer, EventLoopTimerState, EventLoopTimerTag};

// ── timers ────────────────────────────────────────────────────────────────

/// Resolves once `ms` milliseconds of real time have passed, and keeps the process alive until
/// then. Dropping it takes it off the timer heap.
pub(crate) fn sleep(ms: u32) -> Sleep {
    sleep_until(Timespec::now(TimespecMockMode::ForceRealTime).add_ms(i64::from(ms)))
}

/// [`sleep`], to a point on the real clock.
pub(crate) fn sleep_until(deadline: Timespec) -> Sleep {
    Sleep {
        timer: JsCell::new(EventLoopTimer::init_paused(EventLoopTimerTag::Future)),
        deadline,
        fired: Slot::new(),
        keeps_loop_alive: None,
        _linked_into_the_heap: PhantomPinned,
    }
}

#[must_use = "futures do nothing unless awaited"]
pub(crate) struct Sleep {
    pub(crate) timer: JsCell<EventLoopTimer>,
    deadline: Timespec,
    fired: Slot<()>,
    keeps_loop_alive: Option<LoopRef>,
    _linked_into_the_heap: PhantomPinned,
}

impl Sleep {
    /// # Safety
    /// `this` is the armed `Sleep` whose timer the heap just popped.
    pub(crate) unsafe fn on_timer_fire(this: *mut Self) {
        // SAFETY: fn contract. Shared: the fields written are cells.
        let this = unsafe { &*this };
        this.timer
            .with_mut(|timer| timer.state = EventLoopTimerState::FIRED);
        this.fired.fill(());
    }
}

impl Future for Sleep {
    type Output = ();

    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<()> {
        // SAFETY: nothing is moved out of it.
        let this = unsafe { self.get_unchecked_mut() };
        match this.timer.get().state {
            EventLoopTimerState::PENDING => {
                this.keeps_loop_alive = Some(LoopRef::new());
                timer_all().update(this.timer.as_ptr(), &this.deadline);
            }
            // Ready however often it is polled from here on.
            EventLoopTimerState::FIRED => {
                this.keeps_loop_alive = None;
                return Poll::Ready(());
            }
            EventLoopTimerState::ACTIVE | EventLoopTimerState::CANCELLED => {}
        }
        this.fired.poll_take(cx)
    }
}

impl Drop for Sleep {
    fn drop(&mut self) {
        if self.timer.get().state == EventLoopTimerState::ACTIVE {
            timer_all().remove(self.timer.as_ptr());
        }
    }
}

// ── promises ──────────────────────────────────────────────────────────────

/// What the reactions of an awaited promise share with the future that awaits it.
pub(crate) struct Reaction {
    /// Rooted from the reaction (a microtask) to the poll (the next task).
    outcome: Slot<Result<Strong, Strong>>,
}

impl native_promise_context::NativePromiseContextType for Reaction {
    const TAG: native_promise_context::Tag = native_promise_context::Tag::Future;
}

/// `await value`, from Rust: `Ok` with what it was fulfilled with, `Err` with why it was rejected.
/// A `then` that script can observe is called, and what is not thenable is its own outcome.
///
/// It does not keep the process alive, and it does not keep the promise alive: one that is
/// collected can never settle, so a task that waits for nothing else is dropped.
pub(crate) fn settled(global: &JSGlobalObject, value: JSValue) -> JsResult<Settled> {
    let reaction = Rc::new(Reaction {
        outcome: Slot::new(),
    });
    let native = (value.as_promise().map(JSPromise::opaque_mut))
        .filter(|promise| promise.is_then_fast_and_non_observable());
    let promise = match native {
        Some(promise) => promise,
        None if value.is_object() => {
            let follower = JSPromise::create(global);
            follower.resolve(global, value)?;
            follower
        }
        None => {
            reaction.outcome.fill(Ok(Strong::create(value, global)));
            return Ok(Settled(reaction));
        }
    };
    match promise.unwrap(global.vm(), UnwrapMode::MarkHandled) {
        Unwrapped::Fulfilled(value) => reaction.outcome.fill(Ok(Strong::create(value, global))),
        Unwrapped::Rejected(reason) => reaction.outcome.fill(Err(Strong::create(reason, global))),
        Unwrapped::Pending => {
            // The cell's claim: given back to a reaction, or to `collected`.
            let claim = Rc::into_raw(Rc::clone(&reaction)).cast_mut();
            promise.to_js().then_with_value(
                global,
                native_promise_context::create(global, claim, JSValue::ZERO),
                Bun__Future__onFulfilled,
                Bun__Future__onRejected,
            );
        }
    }
    Ok(Settled(reaction))
}

#[must_use = "futures do nothing unless awaited"]
pub(crate) struct Settled(Rc<Reaction>);

impl Future for Settled {
    type Output = Result<JSValue, JSValue>;

    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
        // The roots go as the values reach the stack.
        self.0.outcome.poll_take(cx).map(|outcome| match outcome {
            Ok(value) => Ok(value.get()),
            Err(reason) => Err(reason.get()),
        })
    }
}

impl Reaction {
    fn react(
        cx: &mut JsScope<'_>,
        claim: Option<NonNull<Reaction>>,
        outcome: Result<JSValue, JSValue>,
    ) {
        let Some(claim) = claim else { return };
        // SAFETY: the claim `settled` gave the cell, handed back once.
        let reaction = unsafe { Rc::from_raw(claim.as_ptr().cast_const()) };
        if Rc::strong_count(&reaction) == 1 {
            // Its future was dropped.
            return;
        }
        let global = cx.global();
        reaction.outcome.fill(match outcome {
            Ok(value) => Ok(Strong::create(value, global)),
            Err(reason) => Err(Strong::create(reason, global)),
        });
    }
}

/// The promise was collected unsettled. Called by the cell's destructor while the collector
/// sweeps: what runs here frees plain memory and at most queues a task.
#[unsafe(no_mangle)]
extern "C" fn Bun__Future__promiseCollected(claim: NonNull<Reaction>) {
    // SAFETY: the claim `settled` gave the cell, which no reaction took.
    let reaction = unsafe { Rc::from_raw(claim.as_ptr().cast_const()) };
    reaction.outcome.abandon();
}

pub(crate) fn on_fulfilled(
    cx: &mut JsScope<'_>,
    value: JsLocal<'_>,
    context: Option<NonNull<Reaction>>,
) {
    Reaction::react(cx, context, Ok(value.to_js()));
}

pub(crate) fn on_rejected(
    cx: &mut JsScope<'_>,
    reason: JsLocal<'_>,
    context: Option<NonNull<Reaction>>,
) {
    Reaction::react(cx, context, Err(reason.to_js()));
}

// ── child processes ───────────────────────────────────────────────────────

/// A child process spawned to run to its end. Resolves once it has exited and the pipe that
/// captures its output has reached EOF. Dropping it lets go of the child without killing it.
#[must_use = "futures do nothing unless awaited"]
pub(crate) struct Command(NonNull<Child>);

pub(crate) struct Exit {
    pub(crate) status: Status,
    /// What it wrote to stdout, if that was `Stdio::Buffer`.
    #[cfg(all(unix, not(target_os = "macos")))]
    pub(crate) stdout: Vec<u8>,
    #[cfg(windows)]
    pub(crate) stderr: Vec<u8>,
}

/// Why there is no [`Exit`]: the message of the `Error` script gets.
pub(crate) type CommandError = Vec<u8>;

macro_rules! command_error {
    ($($format:tt)*) => {{
        let mut message = $crate::future::CommandError::new();
        let _ = std::io::Write::write_fmt(&mut message, format_args!($($format)*));
        message
    }};
}
pub(crate) use command_error;

/// What the process and the reader call back into. Its callbacks record what happened and wake
/// the task: nothing is freed, spawned or settled beneath them.
struct Child {
    process: JsCell<Option<ProcessHandle>>,
    #[cfg(unix)]
    stdout: JsCell<OutputReader>,
    #[cfg(windows)]
    stderr: JsCell<OutputReader>,
    open_pipes: Cell<u8>,
    status: JsCell<Option<Status>>,
    read_error: JsCell<Option<sys::Error>>,
    finished: Slot<()>,
    event_loop_handle: EventLoopHandle,
}

bun_io::impl_buffered_reader_parent! {
    Command for Child;
    has_on_read_chunk = false;
    on_reader_done  = |this| (*this).on_pipe_closed(None);
    on_reader_error = |this, err| (*this).on_pipe_closed(Some(err));
    loop_           = |_this| VirtualMachine::get_mut().uv_loop().cast();
    event_loop      = |this| (*this).event_loop_handle.as_event_loop_ctx();
}

bun_spawn::link_impl_ProcessExit! {
    Command for Child => |this| {
        on_process_exit(_process, status, _rusage) => (*this).on_exit(status),
    }
}

impl Child {
    fn on_pipe_closed(&self, error: Option<sys::Error>) {
        debug_assert!(self.open_pipes.get() > 0);
        self.open_pipes.set(self.open_pipes.get() - 1);
        if let Some(error) = error
            && self.read_error.get().is_none()
        {
            self.read_error.set(Some(error));
        }
        self.wake_if_finished();
    }

    fn on_exit(&self, status: Status) {
        self.status.set(Some(status));
        self.wake_if_finished();
    }

    fn read_failure(&self) -> Option<CommandError> {
        let err = self.read_error.replace(None)?;
        Some(command_error!(
            "Failed to read process output: {}",
            bstr::BStr::new(err.name())
        ))
    }

    fn wake_if_finished(&self) {
        if self.status.get().is_some() && self.open_pipes.get() == 0 {
            self.finished.fill(());
        }
    }
}

impl Command {
    /// stderr is captured on Windows and ignored elsewhere.
    pub(crate) fn spawn(
        argv: &[&CStr],
        stdin: spawn::Stdio,
        stdout: spawn::Stdio,
    ) -> Result<Command, CommandError> {
        let event_loop_handle =
            EventLoopHandle::init(VirtualMachine::get_mut().event_loop().cast::<()>());
        let command = Command(bun_core::heap::into_raw_nn(Box::new(Child {
            process: JsCell::new(None),
            #[cfg(unix)]
            stdout: JsCell::new(OutputReader::init::<Child>()),
            #[cfg(windows)]
            stderr: JsCell::new(OutputReader::init::<Child>()),
            open_pipes: Cell::new(0),
            status: JsCell::new(None),
            read_error: JsCell::new(None),
            finished: Slot::new(),
            event_loop_handle,
        })));
        let process = command.start(argv, stdin, stdout)?;
        // SAFETY: the heap `Child`, which outlives the handle: `Command` drops them together.
        process.set_exit_handler(unsafe { ThisPtr::new(command.0.as_ptr()) });
        match process.watch_or_reap() {
            Ok(false) => command.child().process.set(Some(process)),
            Ok(true) => {}
            Err(err) => {
                if !process.has_exited() {
                    let rusage = bun_core::ffi::zeroed::<Rusage>();
                    process.on_exit(Status::Err(err), &rusage);
                }
            }
        }
        Ok(command)
    }

    fn child(&self) -> &Child {
        // SAFETY: allocated by `spawn`, freed by `drop`.
        unsafe { self.0.as_ref() }
    }

    /// Spawns the process and starts the reader.
    fn start(
        &self,
        argv: &[&CStr],
        stdin: spawn::Stdio,
        stdout: spawn::Stdio,
    ) -> Result<ProcessHandle, CommandError> {
        let child = self.child();
        let parent: *mut core::ffi::c_void = self.0.as_ptr().cast();

        #[cfg(not(windows))]
        let resolved_argv0: Option<*const core::ffi::c_char> = None;
        #[cfg(windows)]
        let resolved_argv0: Option<*const core::ffi::c_char>;
        // `resolved_argv0` borrows it until the spawn below.
        #[cfg(windows)]
        let mut path_buf = bun_paths::path_buffer_pool::get();
        #[cfg(windows)]
        {
            // Resolve the executable via bun.which, matching Bun.spawn's behavior.
            let path_env = VirtualMachine::get_mut()
                .transpiler
                .env()
                .map
                .get(b"PATH")
                .unwrap_or(b"");
            let argv0 = argv[0].to_bytes();
            match bun_which::which(&mut path_buf, path_env, b"", argv0) {
                Some(p) => resolved_argv0 = Some(p.as_ptr().cast()),
                None => {
                    return Err(command_error!(
                        "Could not find '{}' in PATH",
                        bstr::BStr::new(argv0)
                    ));
                }
            }
        }
        #[cfg(unix)]
        let env = spawn::SpawnEnv::Inherit;
        #[cfg(windows)]
        let envp_owned = VirtualMachine::get_mut()
            .transpiler
            .env_mut()
            .map
            .create_null_delimited_env_map()
            .map_err(|_| command_error!("Failed to create environment block"))?;
        #[cfg(windows)]
        let env_strings: Vec<&CStr> = envp_owned.iter().collect();
        #[cfg(windows)]
        let env = spawn::SpawnEnv::Strings(&env_strings);

        // `spawn_process_windows` takes the pipe out of `Stdio::Buffer` into
        // `WindowsStdioResult::Buffer` on success, and leaves it with the caller on error.
        #[cfg(windows)]
        let stderr_pipe_ptr: *mut bun_sys::windows::libuv::Pipe =
            bun_core::heap::into_raw(Box::new(bun_core::ffi::zeroed::<
                bun_sys::windows::libuv::Pipe,
            >()));
        let cwd = FileSystem::get().top_level_dir();
        let spawn_options = SpawnOptions {
            stdin,
            stdout,
            #[cfg(windows)]
            stderr: spawn::Stdio::Buffer(stderr_pipe_ptr),
            #[cfg(not(windows))]
            stderr: spawn::Stdio::Ignore,
            cwd: cwd.into(),
            argv0: resolved_argv0,
            #[cfg(windows)]
            windows: spawn::WindowsOptions {
                loop_: child.event_loop_handle,
                ..Default::default()
            },
            ..SpawnOptions::default()
        };
        #[cfg(windows)]
        let mut spawn_options = spawn_options;

        let spawned = match spawn::spawn_process_cstr(&spawn_options, argv, env) {
            Ok(Ok(spawned)) => spawned,
            Ok(Err(err)) => {
                #[cfg(windows)]
                spawn_options.stderr.deinit();
                return Err(command_error!(
                    "Failed to spawn process: {}",
                    bstr::BStr::new(err.name())
                ));
            }
            Err(err) => {
                #[cfg(windows)]
                spawn_options.stderr.deinit();
                return Err(command_error!("Failed to spawn process: {}", err.name()));
            }
        };
        #[cfg(windows)]
        let mut spawned = spawned;

        #[cfg(unix)]
        if let Some(stdout) = spawned.stdout {
            child.stdout.with_mut(|reader| reader.set_parent(parent));
            if spawned.memfds[1] {
                child.stdout.with_mut(|reader| reader.start_memfd(stdout));
            } else {
                let _ = sys::set_nonblocking(stdout);
                child.open_pipes.set(child.open_pipes.get() + 1);
                // A failure calls `on_reader_error`, which touches the other cells only.
                let started = child.stdout.with_mut(|reader| {
                    use bun_io::pipe_reader::PosixFlags;
                    reader
                        .flags
                        .insert(PosixFlags::NONBLOCKING | PosixFlags::SOCKET);
                    reader.start(stdout, true)
                });
                if started.is_err() {
                    return Err(child
                        .read_failure()
                        .unwrap_or_else(|| command_error!("Failed to start reading stdout")));
                }
                child.stdout.with_mut(|reader| {
                    if let Some(poll) = reader.handle.get_poll() {
                        poll.set_flag(bun_io::FilePollFlag::Socket);
                    }
                });
            }
        }
        // Before `spawned` drops, which would close the pipe under the reader.
        #[cfg(windows)]
        if let spawn::WindowsStdioResult::Buffer(pipe) = spawned.stderr.take() {
            debug_assert!(core::ptr::eq(Box::as_ref(&pipe), stderr_pipe_ptr));
            child.stderr.with_mut(|reader| {
                reader.set_source(bun_io::Source::Pipe(pipe));
                reader.set_parent(parent);
            });
            child.open_pipes.set(child.open_pipes.get() + 1);
            if child
                .stderr
                .with_mut(|reader| reader.start_with_current_pipe())
                .is_err()
            {
                return Err(child
                    .read_failure()
                    .unwrap_or_else(|| command_error!("Failed to start reading stderr")));
            }
        }

        Ok(spawned.to_process_handle(child.event_loop_handle))
    }
}

impl Future for Command {
    type Output = Result<Exit, CommandError>;

    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
        let child = self.child();
        core::task::ready!(child.finished.poll_take(cx));
        child.process.set(None);
        if let Some(failure) = child.read_failure() {
            return Poll::Ready(Err(failure));
        }
        Poll::Ready(Ok(Exit {
            status: child.status.replace(None).expect("finished"),
            #[cfg(all(unix, not(target_os = "macos")))]
            stdout: child
                .stdout
                .with_mut(|reader| core::mem::take(reader.final_buffer())),
            #[cfg(windows)]
            stderr: child
                .stderr
                .with_mut(|reader| core::mem::take(reader.final_buffer())),
        }))
    }
}

impl Drop for Command {
    fn drop(&mut self) {
        // SAFETY: allocated by `spawn`. Dropping the handle detaches the exit handler and
        // dropping the reader closes it unreported, so nothing calls back into the `Child` again.
        unsafe { bun_core::heap::destroy(self.0.as_ptr()) };
    }
}
