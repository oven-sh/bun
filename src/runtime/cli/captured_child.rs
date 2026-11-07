//! Runs a child process to completion on an event loop and captures its output. The input is written to its stdin, and
//! its stdout and stderr are read, as each pipe becomes ready. So neither process waits on the other, and no thread blocks
//! in a write.

use core::cell::Cell;
use core::ffi::{CStr, c_void};

use bun_event_loop::EventLoopHandle;
use bun_event_loop::MiniEventLoop::init_global;
use bun_io::BufferedReader;
#[cfg(unix)]
use bun_io::{FilePollFlag, PosixFlags};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_ptr::{JsCell, RefPtr, ThisPtr};
#[cfg(unix)]
use bun_spawn::SpawnResultExt as _;
use bun_spawn::process::sync::Result as Captured;
use bun_spawn::subprocess::{Source, StaticPipeWriter, StaticPipeWriterProcess, StdioKind};
use bun_spawn::{Process, ProcessHandle, Rusage, SpawnEnv, SpawnOptions, Status, Stdio};
#[cfg(windows)]
use bun_sys::windows::libuv as uv;
#[cfg(unix)]
use bun_sys::{Fd, FdExt as _};

type StdinWriter = StaticPipeWriter<CapturedChild>;

const SIGTERM: u8 = bun_sys::SignalCode::of(bun_core::SignalCode::SIGTERM).0;

// Callbacks reach the child through a `ThisPtr` while `run` is on the stack, so mutable state sits in cells and every
// access is a short shared borrow.
#[derive(bun_ptr::CellRefCounted)]
pub(crate) struct CapturedChild {
    ref_count: Cell<u32>,
    event_loop: EventLoopHandle,
    process: JsCell<Option<ProcessHandle>>,
    exit_status: JsCell<Option<Status>>,
    stdin: JsCell<Option<RefPtr<StdinWriter>>>,
    /// Closed here, not by the writer: see `StaticPipeWriter::leave_fd_open`. `bun fmt` works on the thread pool.
    #[cfg(unix)]
    stdin_fd: Cell<Option<Fd>>,
    stdout: JsCell<BufferedReader>,
    stderr: JsCell<BufferedReader>,
    open_pipes: Cell<u8>,
    /// The first error from any of the three pipes.
    pipe_error: JsCell<Option<bun_sys::Error>>,
}

#[cfg(windows)]
fn new_pipe() -> Stdio {
    let pipe = Box::new(bun_core::ffi::zeroed::<uv::Pipe>());
    Stdio::Buffer(bun_core::heap::into_raw(pipe) as bun_spawn::windows::UvPipePtr)
}

#[cfg(unix)]
fn new_pipe() -> Stdio {
    Stdio::Buffer
}

impl CapturedChild {
    /// Runs `argv` in `cwd` with `input` on its stdin, and returns once it has exited and its output is read. `Err` is the
    /// name of the error that kept it from running, or its output from being read.
    pub(crate) fn run(
        argv: &[&CStr],
        envp: &[&CStr],
        cwd: &[u8],
        input: Vec<u8>,
    ) -> Result<Captured, &'static [u8]> {
        let Some(vm) = VirtualMachine::get_or_null() else {
            let mini = init_global(None, None);
            // SAFETY: this thread's loop, which lives as long as the thread. Nothing else borrows it here.
            let tick = || unsafe { (*mini).tick_once(core::ptr::null_mut()) };
            let event_loop = EventLoopHandle::init_mini(mini);
            return Self::run_on(event_loop, tick, argv, envp, cwd, input);
        };
        // A lint thread can have a VM, and then the thread's loop is the VM's: a tick would run its timers and callbacks.
        // `Bun.spawnSync` has the same problem, so the VM keeps a separate loop to wait for a child on.
        // SAFETY: this thread's VM. The borrows end with the call, as in `spawn_maybe_sync`.
        let Some(sync_loop) = (unsafe { (*vm).rare_data().spawn_sync_event_loop(&mut *vm) }) else {
            return Err(b"no event loop");
        };
        let sync_loop = sync_loop.prepare(vm.cast());
        let tick = || _ = sync_loop.tick_with_timeout(None);
        let event_loop = EventLoopHandle::init(sync_loop.event_loop_ptr());
        Self::run_on(event_loop, tick, argv, envp, cwd, input)
    }

    fn run_on(
        event_loop: EventLoopHandle,
        tick: impl Fn(),
        argv: &[&CStr],
        envp: &[&CStr],
        cwd: &[u8],
        input: Vec<u8>,
    ) -> Result<Captured, &'static [u8]> {
        let child = RefPtr::new(CapturedChild {
            ref_count: Cell::new(1),
            event_loop,
            process: JsCell::new(None),
            exit_status: JsCell::new(None),
            stdin: JsCell::new(None),
            #[cfg(unix)]
            stdin_fd: Cell::new(None),
            stdout: JsCell::new(BufferedReader::init::<Self>()),
            stderr: JsCell::new(BufferedReader::init::<Self>()),
            open_pipes: Cell::new(0),
            pipe_error: JsCell::new(None),
        });
        let this = child.this_ptr();
        Self::spawn(this, argv, envp, cwd, input)?;
        while this.exit_status.get().is_none() || this.open_pipes.get() != 0 {
            tick();
        }
        if let Some(err) = this.pipe_error.take() {
            return Err(err.name());
        }
        let status = this.exit_status.take().expect("the loop waits for it");
        if let Status::Err(err) = &status {
            return Err(err.name());
        }
        Ok(Captured {
            status,
            stdout: this.stdout.with_mut(|r| core::mem::take(r.final_buffer())),
            stderr: this.stderr.with_mut(|r| core::mem::take(r.final_buffer())),
        })
    }

    fn spawn(
        this: ThisPtr<Self>,
        argv: &[&CStr],
        envp: &[&CStr],
        cwd: &[u8],
        input: Vec<u8>,
    ) -> Result<(), &'static [u8]> {
        // Windows: the `uv::Pipe` allocations are ours until the spawn succeeds.
        let spawn_options = SpawnOptions {
            stdin: match input.is_empty() {
                true => Stdio::Ignore,
                false => new_pipe(),
            },
            stdout: new_pipe(),
            stderr: new_pipe(),
            cwd: Box::from(cwd),
            #[cfg(windows)]
            windows: bun_spawn::WindowsOptions {
                loop_: this.event_loop,
                ..Default::default()
            },
            stream: false,
            // The kernel ends the child when bun dies, however that happens. Git catches this signal to remove its lock files.
            #[cfg(any(target_os = "linux", target_os = "android"))]
            linux_pdeathsig: Some(SIGTERM),
            ..Default::default()
        };
        #[cfg(windows)]
        let mut spawn_options = spawn_options;

        let spawned = bun_spawn::spawn_process_cstr(&spawn_options, argv, SpawnEnv::Strings(envp));
        let spawned = match spawned {
            Ok(Ok(spawned)) => spawned,
            failed => {
                #[cfg(windows)]
                {
                    spawn_options.stdin.deinit();
                    spawn_options.stdout.deinit();
                    spawn_options.stderr.deinit();
                }
                return Err(match failed {
                    Ok(Err(err)) => err.name(),
                    Err(err) => err.name().as_bytes(),
                    Ok(Ok(_)) => unreachable!(),
                });
            }
        };
        #[cfg(windows)]
        let mut spawned = spawned;

        // The child runs from here on, so a pipe that fails to start is only noted: `run` still waits for the exit.
        let this_ptr: *mut c_void = this.as_ptr().cast();
        #[cfg(unix)]
        for (reader, fd, is_memfd) in [
            (&this.stdout, spawned.stdout, spawned.memfds[1]),
            (&this.stderr, spawned.stderr, spawned.memfds[2]),
        ] {
            let Some(fd) = fd else { continue };
            reader.with_mut(|r| r.set_parent(this_ptr));
            if is_memfd {
                reader.with_mut(|r| r.start_memfd(fd));
                continue;
            }
            let _ = bun_sys::set_nonblocking(fd);
            this.open_pipes.set(this.open_pipes.get() + 1);
            // If this fails, it has reported through `on_reader_error`.
            let started = reader.with_mut(|r| {
                r.flags.insert(PosixFlags::NONBLOCKING | PosixFlags::SOCKET);
                r.start(fd, true)
            });
            if started.is_ok() {
                reader.with_mut(|r| {
                    if let Some(poll) = r.handle.get_poll() {
                        poll.set_flag(FilePollFlag::Socket);
                    }
                });
            }
        }
        #[cfg(windows)]
        for (reader, pipe) in [
            (&this.stdout, spawned.stdout.take()),
            (&this.stderr, spawned.stderr.take()),
        ] {
            // Take sole ownership of each pipe before `spawned` drops.
            let bun_spawn::SpawnedStdio::Buffer(pipe) = pipe else {
                continue;
            };
            reader.with_mut(|r| {
                r.set_source(bun_io::Source::Pipe(pipe));
                r.set_parent(this_ptr);
            });
            this.open_pipes.set(this.open_pipes.get() + 1);
            if let Err(err) = reader.with_mut(|r| r.start_with_current_pipe()) {
                Self::on_pipe_closed(this, Some(err));
            }
        }

        #[cfg(unix)]
        let stdin = spawned.stdin.map(Some);
        #[cfg(windows)]
        let stdin = match spawned.stdin.take() {
            pipe @ bun_spawn::SpawnedStdio::Buffer(_) => Some(pipe),
            _ => None,
        };
        if let Some(stdin) = stdin {
            let source = Source::from_owned_bytes(input.into_boxed_slice());
            let writer = StdinWriter::create(this.event_loop, this.as_ptr(), stdin, source);
            this.open_pipes.set(this.open_pipes.get() + 1);
            this.stdin.set(Some(writer.clone()));
            #[cfg(unix)]
            {
                // SAFETY: as for `start` below.
                unsafe { (*writer.as_ptr()).leave_fd_open() };
                this.stdin_fd.set(spawned.stdin);
            }
            // SAFETY: `writer` keeps it alive and nothing else borrows it. If this ends in `on_close_io`, that only takes
            // the other ref out of `this.stdin`.
            if let Err(err) = unsafe { (*writer.as_ptr()).start() } {
                // It has closed the descriptor.
                #[cfg(unix)]
                this.stdin_fd.set(None);
                Self::on_stdin_closed(this, Some(err));
            }
        }

        let process = spawned.to_process_handle(this.event_loop);
        process.set_exit_handler(this);
        match process.watch_or_reap() {
            Ok(false) => {
                this.process.set(Some(process));
                if this.pipe_error.get().is_some() {
                    Self::terminate(this);
                }
            }
            Ok(true) => {}
            Err(err) => {
                if !process.has_exited() {
                    // Nothing will report its exit, and while it runs its pipes stay open.
                    let _ = process.kill(bun_sys::SignalCode::SIGKILL.0);
                    process.on_exit(Status::Err(err), &bun_core::ffi::zeroed::<Rusage>());
                }
            }
        }
        Ok(())
    }

    fn on_stdin_closed(this: ThisPtr<Self>, err: Option<bun_sys::Error>) {
        // Empty if the writer has been counted out already.
        if this.stdin.take().is_some() {
            this.close_stdin_fd();
            Self::on_pipe_closed(this, err);
        }
    }

    fn close_stdin_fd(&self) {
        #[cfg(unix)]
        if let Some(fd) = self.stdin_fd.take() {
            fd.close();
        }
    }

    fn on_pipe_closed(this: ThisPtr<Self>, err: Option<bun_sys::Error>) {
        debug_assert!(this.open_pipes.get() > 0);
        this.open_pipes.set(this.open_pipes.get() - 1);
        if let Some(err) = err {
            this.pipe_error.with_mut(|first| {
                first.get_or_insert(err);
            });
            Self::terminate(this);
        }
    }

    /// For when a pipe has failed: a child that waits for that pipe would never exit.
    fn terminate(this: ThisPtr<Self>) {
        if let Some(process) = this.process.get() {
            let _ = process.kill(SIGTERM);
        }
    }

    fn on_process_exit(this: ThisPtr<Self>, _: &Process, status: Status, _: &Rusage) {
        this.exit_status.set(Some(status));
        // Nobody needs the input that it hasn't read, and a process that it started can hold the other end open.
        if let Some(writer) = this.stdin.get().clone() {
            // SAFETY: `writer` keeps it alive and nothing else borrows it. This ends in `on_close_io`.
            unsafe { (*writer.as_ptr()).close() };
        }
    }
}

impl Drop for CapturedChild {
    fn drop(&mut self) {
        self.process.set(None);
        // Dropping the writer can close it, which calls `on_close_io`. That has to find the slot empty.
        drop(self.stdin.take());
        self.close_stdin_fd();
        self.stdout.with_mut(|r| r.deinit());
        self.stderr.with_mut(|r| r.deinit());
    }
}

impl StaticPipeWriterProcess for CapturedChild {
    const POLL_OWNER_TAG: bun_io::PollTag = bun_io::PollTag::CapturedChildStaticPipeWriter;
    unsafe fn on_close_io(this: *mut Self, _: StdioKind) {
        // SAFETY: the backref given to `StdinWriter::create`. `run` keeps the child alive until every pipe is closed.
        let this = unsafe { ThisPtr::new(this) };
        // A child that exits without reading all of its input is not an error: its status says how it went.
        Self::on_stdin_closed(this, None);
    }
}

bun_spawn::link_impl_ProcessExit! {
    CapturedChild for CapturedChild => |this| {
        // SAFETY: `this` is the live child installed via `set_exit_handler`.
        on_process_exit(process, status, rusage) =>
            CapturedChild::on_process_exit(ThisPtr::new(this), &*process, status, rusage),
    }
}

bun_io::impl_buffered_reader_parent! {
    CapturedChild for CapturedChild;
    has_on_read_chunk = false;
    // SAFETY: `this` is the live child registered via `set_parent`.
    on_reader_done  = |this| CapturedChild::on_pipe_closed(ThisPtr::new(this), None);
    // SAFETY: `this` is the live child registered via `set_parent`.
    on_reader_error = |this, err| CapturedChild::on_pipe_closed(ThisPtr::new(this), Some(err));
    loop_           = |this| (*this).event_loop.native_loop();
    event_loop      = |this| (*this).event_loop.as_event_loop_ctx();
}
