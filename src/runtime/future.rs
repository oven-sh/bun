//! What a future on the JS loop ([`bun_jsc::future`]) can await that this crate owns: the timer
//! heap and JavaScript promises. (A child process is `bun_spawn::Capture`, on any loop.)
//!
//! Each is the one owner of its kind that the dispatch tables know (`EventLoopTimerTag::Future`,
//! `native_promise_context::Tag::Future`). An `async fn` that uses them adds no tag, no arm and no
//! callback of its own.

use core::cell::Cell;
use core::ffi::CStr;
use core::future::Future;
use core::marker::PhantomPinned;
use core::pin::Pin;
use core::ptr::NonNull;
use core::task::{Context, Poll};
use std::rc::Rc;

use bun_async::{Slot, TaskId};
use bun_core::{Timespec, TimespecMockMode};
use bun_jsc::bindgen::{JsLocal, JsScope};
use bun_jsc::future::LoopRef;
use bun_jsc::js_promise::{UnwrapMode, Unwrapped};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{EventLoopHandle, JSGlobalObject, JSPromise, JSValue, JsCell, JsResult, Strong};
use bun_resolver::fs::FileSystem;
use bun_spawn::{Capture, CaptureError, SpawnEnv, SpawnOptions, Stdio, Streams};
use bun_sys as sys;

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
    /// Rooted from the reaction to the poll, which is not always inside it.
    outcome: Slot<Result<Strong, Strong>>,
    awaited_by: Cell<Option<TaskId>>,
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
        awaited_by: Cell::new(None),
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
        self.0.awaited_by.set(bun_jsc::future::running_task());
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
        let waker = reaction.outcome.fill_quietly(match outcome {
            Ok(value) => Ok(Strong::create(value, global)),
            Err(reason) => Err(Strong::create(reason, global)),
        });
        let awaited_by = reaction.awaited_by.get();
        drop(reaction);
        if let Some(waker) = waker {
            crate::dispatch::fold(bun_jsc::future::resume_now(awaited_by, waker));
        }
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

/// Why a [`command`] did not run to its end: the message of the `Error` script gets.
pub(crate) type CommandError = Vec<u8>;

macro_rules! command_error {
    ($($format:tt)*) => {{
        let mut message = $crate::future::CommandError::new();
        let _ = std::io::Write::write_fmt(&mut message, format_args!($($format)*));
        message
    }};
}
pub(crate) use command_error;

pub(crate) fn read_failure(err: &sys::Error) -> CommandError {
    command_error!(
        "Failed to read process output: {}",
        bstr::BStr::new(err.name())
    )
}

/// Spawns `argv` in the top-level directory with this process's environment and nothing on stdin.
/// stderr is captured on Windows and ignored elsewhere.
pub(crate) fn command(argv: &[&CStr], capture_stdout: bool) -> Result<Capture, CommandError> {
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
    let env = SpawnEnv::Inherit;
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
    let env = SpawnEnv::Strings(&env_strings);

    let options = SpawnOptions {
        stdin: Stdio::Ignore,
        stdout: Stdio::Ignore,
        stderr: Stdio::Ignore,
        cwd: FileSystem::get().top_level_dir().into(),
        argv0: resolved_argv0,
        ..SpawnOptions::default()
    };
    let streams = Streams {
        stdout: capture_stdout,
        stderr: cfg!(windows),
    };
    let event_loop = EventLoopHandle::init(VirtualMachine::get_mut().event_loop().cast::<()>());
    Capture::spawn(options, streams, argv, env, event_loop).map_err(|err| match err {
        CaptureError::Spawn(err) => command_error!("Failed to spawn process: {}", err.name()),
        CaptureError::SpawnSys(err) => {
            command_error!("Failed to spawn process: {}", bstr::BStr::new(err.name()))
        }
        CaptureError::StartReading(err) => read_failure(&err),
    })
}
