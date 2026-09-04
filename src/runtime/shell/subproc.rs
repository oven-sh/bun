use core::cell::Cell;
use std::sync::Arc;

#[cfg(unix)]
use crate::api::bun::process::SpawnResultExt as _;
use crate::api::bun::process::{
    self as bun_process, ProcessHandle, SignalCodeExt, SpawnOptions, Status,
};
#[cfg(windows)]
use crate::api::bun::process::{WindowsOptions, WindowsStdioResult};
use crate::api::bun::subprocess as JscSubprocess;
use crate::shell::interpreter::{Interpreter, NodeId};
use crate::shell::io_writer::{self, IOWriter};
use crate::shell::states::cmd::Cmd as ShellCmd;
use crate::shell::{self as sh, Yield};
use crate::webcore::{self, FileSink};
use bun_alloc::Arena;
use bun_collections::VecExt;
use bun_io::Loop as AsyncLoop;
#[cfg(windows)]
use bun_io::pipe_writer::BaseWindowsPipeWriter as _;
use bun_io::{BufferedReader, ReadState};
use bun_jsc::{self as jsc, EventLoopHandle, JsCell};
use bun_ptr::{BackRef, OwnedThis, ParentRef, RefCount, RefPtr, ThisPtr};
use bun_sys::{self, Fd, FdExt, SystemError};
use enumset::EnumSet;

use crate::api::bun_spawn::stdio::{self, Stdio};
use crate::shell::util::OutKind;

/// Local helper: `OutKind` → tag-name string for logs.
#[inline]
fn out_kind_str(k: OutKind) -> &'static str {
    match k {
        OutKind::Stdout => "stdout",
        OutKind::Stderr => "stderr",
    }
}

/// Local helper: `ReadState` → tag-name string for logs.
#[inline]
fn read_state_str(s: ReadState) -> &'static str {
    match s {
        ReadState::Progress => "progress",
        ReadState::Eof => "eof",
        _ => "drained",
    }
}

pub use JscSubprocess::StdioKind;

use crate::shell::ShellErr;

#[cfg(windows)]
pub type StdioResult = WindowsStdioResult;
#[cfg(not(windows))]
pub type StdioResult = Option<Fd>;

bun_output::define_scoped_log!(log, SHELL_SUBPROC, visible);

/// Used for captured writer
#[derive(Default)]
pub struct ShellIO {
    pub(crate) stdout: Option<Arc<IOWriter>>,
    pub(crate) stderr: Option<Arc<IOWriter>>,
}

// Note: with `Arc<IOWriter>` the only correct way to
// retain is to *clone the Arc and keep it*; a freestanding `ref()` that
// discards the clone is a no-op. Callers hold their own `Arc` clones and
// `ShellIO`'s `Drop` releases them — no explicit ref/deref methods.

// ───────────────────────────────────────────────────────────────────────────
// ShellSubprocess
// ───────────────────────────────────────────────────────────────────────────

pub(crate) type Subprocess = ShellSubprocess;

pub(crate) const DEFAULT_MAX_BUFFER_SIZE: u32 = 1024 * 1024 * 4;

/// Backref from a heap-allocated [`ShellSubprocess`] to its owning `Cmd`.
/// Spec stores `cmd_parent: *ShellCmd` directly. In the NodeId-arena port the
/// `Cmd` lives **inline** in `Interpreter::nodes: Vec<Node>`, so a raw `*mut
/// Cmd` taken at spawn time dangles the moment a later `alloc_node` grows the
/// `Vec` (long pipelines hit this — every piped command pushes new Expansion /
/// Cmd nodes while earlier subprocesses' PipeReaders are still registered in
/// epoll). Store `(interp, NodeId)` instead and resolve through the arena at
/// each use site.
#[derive(Clone, Copy)]
pub struct CmdHandle {
    pub(crate) interp: ParentRef<Interpreter>,
    pub(crate) id: NodeId,
}

impl CmdHandle {
    /// Resolve to the live `Cmd` slot. Single-threaded; the caller must not
    /// hold the result across a call that re-enters the interpreter. `id`
    /// indexes a `Node::Cmd` slot for every caller: the subprocess /
    /// PipeReader callbacks fire strictly before `Cmd::deinit` recycles it.
    #[inline]
    pub(crate) fn cmd_mut(&self) -> &mut ShellCmd {
        self.interp.get().as_cmd_mut(self.id)
    }
}

/// Owned by its `Cmd` (`SubprocExec::child`) as an [`OwnedThis`]; the stdin
/// writer, the pipe readers and the process exit handler hold back-references
/// that the `Cmd` clears (by dropping this, whose `Drop` closes them) before
/// it goes away.
pub struct ShellSubprocess {
    pub(crate) cmd_parent: CmdHandle,

    /// Owning handle on the intrusively ref-counted process; detached in
    /// `finalize_sync`, released on drop.
    pub(crate) process: ProcessHandle,

    pub(crate) stdin: JsCell<Writable>,
    pub(crate) stdout: JsCell<Readable>,
    pub(crate) stderr: JsCell<Readable>,

    pub closed: Cell<EnumSet<StdioKind>>,

    ctrl_c_child: Cell<Option<bun_spawn::ctrl_c::Child>>,
}

pub(crate) type SignalCode = bun_core::SignalCode;

impl Drop for ShellSubprocess {
    fn drop(&mut self) {
        self.finalize_sync();
        log!("Deinit");
    }
}

pub type StaticPipeWriter = JscSubprocess::NewStaticPipeWriter<ShellSubprocess>;

impl JscSubprocess::static_pipe_writer::StaticPipeWriterProcess for ShellSubprocess {
    const POLL_OWNER_TAG: bun_io::PollTag =
        bun_io::posix_event_loop::poll_tag::SHELL_STATIC_PIPE_WRITER;
    fn on_close_io(this: ThisPtr<Self>, kind: StdioKind) {
        this.on_close_io(kind)
    }
}

bun_spawn::link_impl_ProcessExit! {
    Shell for ShellSubprocess => |this| {
        on_process_exit(_process, status, _rusage) =>
            ShellSubprocess::on_process_exit(ThisPtr::new(this), &status),
    }
}

impl ShellSubprocess {
    #[inline]
    pub(crate) fn proc(&self) -> &ProcessHandle {
        &self.process
    }

    pub(crate) fn on_static_pipe_writer_done(&self) {
        log!(
            "Subproc(0x{:x}) onStaticPipeWriterDone(cmd={})",
            std::ptr::from_ref(self) as usize,
            self.cmd_parent.id
        );
        self.cmd_parent.cmd_mut().buffered_input_close();
    }

    pub(crate) fn has_exited(&self) -> bool {
        self.process.has_exited()
    }

    pub(crate) fn r#ref(&self) {
        self.process.enable_keeping_event_loop_alive();

        // self.stdin.ref();
        // }

        // if (!self.hasCalledGetter(.stdout)) {
        self.stdout.get().r#ref();
        // }

        // if (!self.hasCalledGetter(.stderr)) {
        self.stderr.get().r#ref();
        // }
    }

    /// This disables the keeping process alive flag on the poll and also in the stdin, stdout, and stderr
    pub(crate) fn unref<const _DEREF: bool>(&self) {
        self.process.disable_keeping_event_loop_alive();

        self.stdout.get().unref();

        self.stderr.get().unref();
    }

    pub(crate) fn try_kill(&self, sig: i32) -> bun_sys::Result<()> {
        if self.has_exited() {
            return Ok(());
        }

        self.process.kill(u8::try_from(sig).expect("int cast"))
    }

    pub(crate) fn close_io(&self, io: StdioKind) {
        if self.closed.get().contains(io) {
            return;
        }
        log!("close IO {}", <&'static str>::from(io));
        self.closed.set(self.closed.get() | io);

        // If you never referenced stdout/stderr, they won't be garbage collected.
        //
        // That means:
        //   1. We need to stop watching them
        //   2. We need to free the memory
        //   3. We need to halt any pending reads (1)
        // if (!self.hasCalledGetter(io)) {
        match io {
            StdioKind::Stdin => {
                // Outside the cell: releasing a `Buffer` writer can re-enter
                // `on_close_io`.
                let mut stdin = self.stdin.replace(Writable::Ignore);
                stdin.finalize();
                self.stdin.set(stdin);
            }
            StdioKind::Stdout => self.stdout.with_mut(|s| s.finalize()),
            StdioKind::Stderr => self.stderr.with_mut(|s| s.finalize()),
        }
    }

    // This must only be run once per Subprocess
    pub(crate) fn finalize_sync(&self) {
        self.process.detach();

        self.close_io(StdioKind::Stdin);
        self.close_io(StdioKind::Stdout);
        self.close_io(StdioKind::Stderr);
    }

    pub(crate) fn on_close_io(&self, kind: StdioKind) {
        match kind {
            StdioKind::Stdin => match self.stdin.replace(Writable::Ignore) {
                Writable::Pipe(pipe) => {
                    pipe.source.with_mut(|s| s.clear());
                }
                Writable::Buffer(buffer) => {
                    self.on_static_pipe_writer_done();
                    StaticPipeWriter::detach_source(buffer.this_ptr());
                }
                other => self.stdin.set(other),
            },
            StdioKind::Stdout | StdioKind::Stderr => {
                let out: &JsCell<Readable> = match kind {
                    StdioKind::Stdout => &self.stdout,
                    StdioKind::Stderr => &self.stderr,
                    StdioKind::Stdin => unreachable!(),
                };
                if matches!(out.get(), Readable::Pipe(_)) {
                    let Readable::Pipe(pipe) = out.replace(Readable::Ignore) else {
                        unreachable!()
                    };
                    // The only callers reach here from inside
                    // `PipeReader::on_reader_done`/`on_reader_error`, which hold
                    // their own ref on this same reader.
                    if matches!(pipe.state.get(), PipeReaderState::Done(_)) {
                        out.set(Readable::Buffer(pipe.take_done_buffer()));
                    }
                }
            }
        }
    }

    /// Tear-down prep for a subprocess whose stdio start() failed: marks
    /// pending pipe readers as errored so `PipeReader`'s done-assert passes
    /// and clears the exit handler so a later exit doesn't reach the `Cmd`.
    /// Windows: `PipeReader`'s drop asserts the libuv source is closed, and
    /// whether the source is uv-initialized depends on how far
    /// startWithCurrentPipe got, so the caller leaks the Subprocess instead
    /// (pre-existing behavior); the Ctrl+C accounting is released and the
    /// exit handler cleared without closing the poller.
    fn abort_after_failed_start(&self) {
        #[cfg(windows)]
        {
            self.ctrl_c_child.set(None);
            self.process.process_mut().set_exit_handler_default();
        }
        #[cfg(not(windows))]
        {
            for r in [&self.stdout, &self.stderr] {
                if let Readable::Pipe(pipe) = r.get() {
                    pipe.state.with_mut(|s| {
                        if matches!(s, PipeReaderState::Pending) {
                            *s = PipeReaderState::Err(None);
                        }
                    });
                }
            }
            self.process.detach();
        }
    }

    /// Stop stdio still active because the `Cmd` is deinited mid-flight (VM
    /// shutdown); a no-op after a normal close. Readers stop without firing
    /// `on_reader_done`, queued capture chunks are cancelled (the `IOWriter`
    /// queue holds a pointer to the `PipeReader`), a pending buffer-stdin
    /// writer is closed. POSIX-only, same tradeoff as
    /// [`Self::abort_after_failed_start`].
    #[cfg(not(windows))]
    pub(crate) fn deinit_in_flight_io(&self) {
        // Claim `start()`'s ref, `close()` (fires `on_close` → `on_close_io`:
        // slot → `Ignore`, `create()`'s ref released), release the claimed
        // ref — the JS `Subprocess::close_io` stdin shape.
        let pending_start = match self.stdin.get() {
            Writable::Buffer(buffer) => StaticPipeWriter::take_start_ref(buffer.this_ptr()),
            _ => None,
        };
        if let Some(writer) = pending_start {
            StaticPipeWriter::close(writer.this_ptr());
        }

        for slot in [&self.stdout, &self.stderr] {
            let Readable::Pipe(pipe) = slot.get() else {
                continue;
            };
            // Neither `reader.deinit()` nor `cancel_chunks` fires a callback.
            if matches!(pipe.state.get(), PipeReaderState::Pending) {
                // Deregisters the poll and closes the fd without
                // `on_reader_done`; `Err` satisfies the drop's done-assert.
                pipe.reader.with_mut(|r| r.deinit());
                pipe.state.set(PipeReaderState::Err(None));
            }
            if let Some(writer) = pipe.captured_writer.writer.replace(None) {
                writer.cancel_chunks(PipeReader::captured_child_ptr(pipe.this_ptr()));
                pipe.captured_writer.dead.set(true);
            }
        }
    }

    /// `Heap::lastChanceToFinalize` deletes the `JSC::ArrayBuffer` impls
    /// before the sweep that reaches us, so dropping the redirect target's
    /// [`PinnedArrayBuffer`](jsc::PinnedArrayBuffer) would write to a
    /// freed impl; defuse it. VM-shutdown finalizer only (on a live heap this
    /// would leak the pin and GC root).
    #[cfg(not(windows))]
    pub(crate) fn defuse_array_buffer_unpins(&self) {
        for slot in [&self.stdout, &self.stderr] {
            let Readable::Pipe(pipe) = slot.get() else {
                continue;
            };
            pipe.buffered_output.with_mut(|b| {
                if let BufferedOutput::ArrayBuffer { buf, .. } = b {
                    buf.defuse();
                }
            });
        }
    }

    // `sh::Result`'s `ShellErr` is a shared shell-wide error type defined in
    // `shell_body.rs`; boxing it here would change `pub fn` signatures across
    // every `?`-propagating shell caller.
    //
    /// Spawn the process and wire its stdio. The caller stores the result in
    /// `Cmd.exec.subproc.child` and then calls [`Self::start`], whose reader
    /// / process callbacks expect to find it there.
    #[allow(clippy::result_large_err)]
    pub(crate) fn spawn_async(
        event_loop: EventLoopHandle,
        shellio: &mut ShellIO,
        spawn_args_: SpawnArgs<'_>,
        argv: &[&core::ffi::CStr],
        cmd_parent: CmdHandle,
    ) -> sh::Result<OwnedThis<Self>> {
        let mut spawn_args = spawn_args_;
        Self::spawn_maybe_sync_impl(event_loop, &mut spawn_args, argv, shellio, cmd_parent)
    }

    // See `spawn_async`: `sh::Result`'s `ShellErr` is shared shell-wide; not
    // boxable from this file.
    #[allow(clippy::result_large_err)]
    fn spawn_maybe_sync_impl(
        event_loop: EventLoopHandle,
        spawn_args: &mut SpawnArgs<'_>,
        argv: &[&core::ffi::CStr],
        shellio: &mut ShellIO,
        cmd_parent: CmdHandle,
    ) -> sh::Result<OwnedThis<Self>> {
        // Owns the `K=V\0` storage when inheriting the parent env; kept alive
        // until after `spawn_process` returns.
        let inherited_env_storage: Option<bun_dotenv::NullDelimitedEnvMap> =
            if !spawn_args.override_env && spawn_args.env_array.is_empty() {
                Some(bun_core::handle_oom(
                    event_loop.create_null_delimited_env_map(),
                ))
            } else {
                None
            };
        let env: Vec<&core::ffi::CStr> = match &inherited_env_storage {
            Some(envmap) => envmap.iter().collect(),
            None => spawn_args.env_array.clone(),
        };

        // Until ownership transfers into Writable/Readable, deinit any caller-provided
        // stdio resources (memfd, Blob) on early return so they aren't leaked
        // (`redirect_stdout`/`redirect_stderr` drop with `spawn_args`). Defused via
        // `ScopeGuard::into_inner` once consumed.
        let mut stdio_guard = scopeguard::guard(&mut spawn_args.stdio, |stdio| {
            for s in stdio.iter_mut() {
                // Stdio's Drop impl handles resource teardown.
                *s = Stdio::Ignore;
            }
        });

        #[cfg(unix)]
        let no_sigpipe = if let Some(iowriter) = &shellio.stdout {
            !iowriter.is_socket()
        } else {
            true
        };

        // Hoist asSpawnOption results so a later one failing doesn't strand an earlier
        // Windows *uv.Pipe in an unbound temporary inside the struct initializer.
        // `mut` only for the Windows-only `.deinit()` rollback below.
        #[cfg_attr(not(windows), allow(unused_mut))]
        let mut stdin_opt = match stdio_guard[0].as_spawn_option(0) {
            stdio::ResultT::Result(opt) => opt,
            stdio::ResultT::Err(e) => {
                return Err(ShellErr::Custom(Box::<[u8]>::from(e.to_str())));
            }
        };
        #[cfg_attr(not(windows), allow(unused_mut))]
        let mut stdout_opt = match stdio_guard[1].as_spawn_option(1) {
            stdio::ResultT::Result(opt) => opt,
            stdio::ResultT::Err(e) => {
                #[cfg(windows)]
                stdin_opt.deinit();
                return Err(ShellErr::Custom(Box::<[u8]>::from(e.to_str())));
            }
        };
        let stderr_opt = match stdio_guard[2].as_spawn_option(2) {
            stdio::ResultT::Result(opt) => opt,
            stdio::ResultT::Err(e) => {
                #[cfg(windows)]
                {
                    stdin_opt.deinit();
                    stdout_opt.deinit();
                }
                return Err(ShellErr::Custom(Box::<[u8]>::from(e.to_str())));
            }
        };

        let mut spawn_options = SpawnOptions {
            cwd: spawn_args.cwd.into(),
            stdin: stdin_opt,
            stdout: stdout_opt,
            stderr: stderr_opt,
            #[cfg(windows)]
            windows: WindowsOptions {
                hide_window: true,
                loop_: event_loop,
                ..Default::default()
            },
            ..Default::default()
        };
        #[cfg(unix)]
        {
            spawn_options.no_sigpipe = no_sigpipe;
        }

        // Backref so PipeReader callbacks can drive `Yield::run` from async I/O
        // completion; plumbed explicitly through `SpawnArgs`.
        let interp = spawn_args.interp;

        let foreground = !cmd_parent.interp.get().in_background(cmd_parent.id);
        let ctrl_c_child = foreground.then(bun_spawn::ctrl_c::Child::enter);
        let spawn_result = match bun_process::spawn_process_cstr(
            &spawn_options,
            argv,
            bun_process::SpawnEnv::Strings(&env),
        ) {
            Err(err) => {
                // WindowsSpawnOptions has no Drop
                // (its Stdio::Buffer/Ipc carry FFI-owned `*mut uv::Pipe` already
                // `uv_pipe_init`ed by spawn_process_windows before uv_spawn fails),
                // so an implicit `drop(spawn_options)` is a no-op and leaks the
                // pipe handles open in the uv loop. POSIX deinit is a no-op.
                #[cfg(windows)]
                {
                    spawn_options.stdin.deinit();
                    spawn_options.stdout.deinit();
                    spawn_options.stderr.deinit();
                    for extra in spawn_options.extra_fds.iter_mut() {
                        extra.deinit();
                    }
                }
                drop(spawn_options);
                let mut msg = Vec::<u8>::new();
                use std::io::Write;
                let _ = write!(&mut msg, "Failed to spawn process: {}", err.name());
                return Err(ShellErr::Custom(msg.into_boxed_slice()));
            }
            Ok(r) => match r {
                bun_sys::Result::Err(err) => {
                    #[cfg(windows)]
                    {
                        spawn_options.stdin.deinit();
                        spawn_options.stdout.deinit();
                        spawn_options.stderr.deinit();
                        for extra in spawn_options.extra_fds.iter_mut() {
                            extra.deinit();
                        }
                    }
                    drop(spawn_options);
                    return Err(ShellErr::Sys(err.to_shell_system_error()));
                }
                bun_sys::Result::Ok(result) => result,
            },
        };

        let mut spawn_result = spawn_result;

        // Note: Stdio impls Drop, so move out via mem::replace instead of clone.
        let stdio0 = core::mem::replace(&mut stdio_guard[0], Stdio::Ignore);
        let stdio1 = core::mem::replace(&mut stdio_guard[1], Stdio::Ignore);
        let stdio2 = core::mem::replace(&mut stdio_guard[2], Stdio::Ignore);

        // `to_process_handle` consumes the result for pid/pidfd; pull the fd handles out first.
        let spawn_stdin = spawn_result.stdin.take();
        let spawn_stdout = spawn_result.stdout.take();
        let spawn_stderr = spawn_result.stderr.take();

        // Two-phase init: allocate the Subprocess first so its stable address
        // is available to `Writable::init` / `Readable::init` (they store it on
        // StaticPipeWriter / PipeReader as a backref), then fill the stdio slots.
        let owned = OwnedThis::new(Subprocess {
            process: spawn_result.to_process_handle(event_loop),
            stdin: JsCell::new(Writable::Ignore),
            stdout: JsCell::new(Readable::Ignore),
            stderr: JsCell::new(Readable::Ignore),
            cmd_parent,
            closed: Cell::new(EnumSet::empty()),
            ctrl_c_child: Cell::new(ctrl_c_child),
        });
        let subprocess: ThisPtr<Subprocess> = owned.this_ptr();

        let stdin = match Writable::init(stdio0, event_loop, subprocess, spawn_stdin) {
            Ok(w) => w,
            Err(WritableInitError::UnexpectedCreatingStdin(err)) => {
                let _ = subprocess.try_kill(SignalCode::SIGTERM as i32);
                return Err(ShellErr::new_sys(&err));
            }
        };
        subprocess.stdin.set(stdin);
        subprocess.stdout.set(Readable::init(
            OutKind::Stdout,
            stdio1,
            spawn_args.redirect_stdout.take(),
            shellio.stdout.clone(),
            event_loop,
            subprocess,
            spawn_stdout,
            interp,
            DEFAULT_MAX_BUFFER_SIZE,
            true,
        ));
        subprocess.stderr.set(Readable::init(
            OutKind::Stderr,
            stdio2,
            spawn_args.redirect_stderr.take(),
            shellio.stderr.clone(),
            event_loop,
            subprocess,
            spawn_stderr,
            interp,
            DEFAULT_MAX_BUFFER_SIZE,
            true,
        ));

        // The owning `Cmd` outlives the `Process` exit callback (it drops the
        // subprocess, which detaches the handler, before it goes away).
        subprocess.process.set_exit_handler(subprocess);
        let _ = scopeguard::ScopeGuard::into_inner(stdio_guard);

        // Wire the FileSink's close-signal back to us so `Writable::on_close`
        // (drops the sink ref) runs when the sink finishes. Only reachable on
        // Windows (POSIX `Writable::init` never returns `Pipe` for shell stdio).
        if let Writable::Pipe(pipe) = subprocess.stdin.get() {
            pipe.source
                .set(webcore::streams::SourceHandle::ShellSubprocess(
                    BackRef::from(subprocess),
                ));
        }

        Ok(owned)
    }

    /// Watch the process and start the stdio streams. Runs after the `Cmd`
    /// has stored `this`: `watch`/`start`/`read_all` may synchronously fire the
    /// exit handler or reader callbacks, which reach back into the `Cmd`.
    ///
    /// On error the pending pipe readers have been marked errored and the exit
    /// handler cleared (see [`Self::abort_after_failed_start`]); the caller
    /// drops `this` (POSIX) or leaks it (Windows).
    #[allow(clippy::result_large_err)]
    pub(crate) fn start(
        this: ThisPtr<Self>,
        event_loop: EventLoopHandle,
        lazy: &mut bool,
        notify_caller_process_already_exited: &mut bool,
    ) -> sh::Result<()> {
        match this.process.watch() {
            bun_sys::Result::Ok(()) => {}
            bun_sys::Result::Err(_) => {
                *notify_caller_process_already_exited = true;
                *lazy = false;
            }
        }

        let stdin_start_err = match this.stdin.get() {
            Writable::Buffer(buffer) => StaticPipeWriter::start(buffer.this_ptr()).err(),
            _ => None,
        };
        if let Some(err) = stdin_start_err {
            let sys_err = err.to_shell_system_error();
            let _ = this.try_kill(SignalCode::SIGTERM as i32);
            this.abort_after_failed_start();
            return Err(ShellErr::Sys(sys_err));
        }

        if let Err(err) = Readable::start_pipe_reader(&this.stdout, this, event_loop, !*lazy) {
            let sys_err = err.to_shell_system_error();
            let _ = this.try_kill(SignalCode::SIGTERM as i32);
            this.abort_after_failed_start();
            return Err(ShellErr::Sys(sys_err));
        }

        if let Err(err) = Readable::start_pipe_reader(&this.stderr, this, event_loop, !*lazy) {
            let sys_err = err.to_shell_system_error();
            let _ = this.try_kill(SignalCode::SIGTERM as i32);
            this.abort_after_failed_start();
            return Err(ShellErr::Sys(sys_err));
        }

        log!("returning");

        Ok(())
    }

    /// `this: ThisPtr` because `Cmd::on_exit` may drive the interpreter, whose
    /// `Cmd::deinit` frees us.
    pub(crate) fn on_process_exit(this: ThisPtr<Self>, status: &Status) {
        log!("onProcessExit({:x})", this.as_ptr() as usize);
        let interrupted =
            this.ctrl_c_child.take().is_some() && bun_spawn::ctrl_c::child_died_of_it(status);
        let exit_code: Option<u8> = 'brk: {
            if let Status::Exited(exited) = &status {
                #[cfg(windows)]
                if exited.raw == bun_sys::windows::STATUS_CONTROL_C_EXIT {
                    break 'brk SignalCode::SIGINT.to_exit_code();
                }
                break 'brk Some(exited.code);
            }

            if matches!(status, Status::Err(_)) {
                // TODO: handle error
            }

            if matches!(status, Status::Signaled(_)) {
                if let Some(code) = status.signal_code() {
                    break 'brk Some(code.to_exit_code().unwrap());
                }
            }

            break 'brk None;
        };

        if let Some(code) = exit_code {
            let handle = this.cmd_parent;
            // No borrow of `this` is live past this point.
            let cmd = handle.cmd_mut();
            cmd.base.interrupted |= interrupted;
            if cmd.exit_code.is_none() {
                cmd.on_exit(code.into());
            }
        }
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Writable
// ───────────────────────────────────────────────────────────────────────────

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum WritableInitError {
    #[error("UnexpectedCreatingStdin")]
    UnexpectedCreatingStdin(bun_sys::Error),
}

pub enum Writable {
    Pipe(RefPtr<FileSink>),
    Fd(Fd),
    Buffer(RefPtr<StaticPipeWriter>),
    Memfd(Fd),
    Inherit,
    Ignore,
}

impl ShellSubprocess {
    // When the stream has closed we need to be notified to prevent a use-after-free
    // We can test for this use-after-free by enabling hot module reloading on a file and then saving it twice
    pub fn on_stdin_close(&self, _: Option<bun_sys::Error>) {
        // Dropping the payload releases the Pipe/Buffer ref.
        drop(self.stdin.replace(Writable::Ignore));
    }
}

impl Writable {
    pub(crate) fn init(
        stdio: Stdio,
        event_loop: EventLoopHandle,
        subprocess: ThisPtr<Subprocess>,
        result: StdioResult,
    ) -> Result<Writable, WritableInitError> {
        assert_stdio_result!(result);

        // Note: `Stdio` impls Drop, so we cannot partially move out via
        // match (E0509). Dispatch on `&mut` and `mem::take` the non-Copy
        // payloads.
        let mut stdio = stdio;
        #[cfg(windows)]
        {
            match &mut stdio {
                Stdio::Pipe | Stdio::ReadableStream(_) => {
                    if let StdioResult::Buffer(buf) = result {
                        // Ownership of the `Box<uv::Pipe>` transfers into the
                        // FileSink's writer.
                        let pipe = FileSink::create_with_pipe(event_loop, buf);
                        if let bun_sys::Result::Err(err) =
                            pipe.writer.with_mut(|w| w.start_with_current_pipe())
                        {
                            return Err(WritableInitError::UnexpectedCreatingStdin(err));
                        }

                        // TODO: uncoment this when is ready, commented because was not compiling
                        // subprocess.weak_file_sink_stdin_ptr = pipe;
                        // subprocess.flags.has_stdin_destructor_called = false;

                        return Ok(Writable::Pipe(pipe));
                    }
                    return Ok(Writable::Inherit);
                }

                Stdio::Blob(blob) => {
                    return Ok(Writable::Buffer(StaticPipeWriter::create(
                        event_loop,
                        subprocess,
                        result,
                        JscSubprocess::source_from_blob(core::mem::take(blob)),
                    )));
                }
                Stdio::Fd(fd) => {
                    return Ok(Writable::Fd(*fd));
                }
                Stdio::Dup2(dup2) => {
                    return Ok(Writable::Fd(dup2.to.to_fd()));
                }
                Stdio::Inherit => {
                    return Ok(Writable::Inherit);
                }
                Stdio::Memfd(_) | Stdio::Path(_) | Stdio::Ignore => {
                    return Ok(Writable::Ignore);
                }
                Stdio::Ipc | Stdio::Capture(_) => {
                    return Ok(Writable::Ignore);
                }
                Stdio::SocketFd => {
                    // The shell never uses this; rejected at i < 3 anyway.
                    panic!("Unimplemented stdin socket-fd");
                }
            }
        }
        #[cfg(not(windows))]
        {
            match &mut stdio {
                Stdio::Dup2(_) => {
                    // The shell never uses this
                    panic!("Unimplemented stdin dup2");
                }
                Stdio::Pipe => {
                    // The shell never uses this
                    panic!("Unimplemented stdin pipe");
                }

                Stdio::Blob(blob) => Ok(Writable::Buffer(StaticPipeWriter::create(
                    event_loop,
                    subprocess,
                    result,
                    JscSubprocess::source_from_blob(core::mem::take(blob)),
                ))),
                Stdio::Memfd(memfd) => {
                    debug_assert!(memfd.is_valid());
                    let fd = *memfd;
                    // Ownership of the fd transfers to `Writable::Memfd`.
                    // Swap in `Ignore` and suppress the old value's destructor
                    // so `Stdio::Drop` doesn't close the fd we just took
                    // (`stdio = Stdio::Ignore` alone would drop+close the old
                    // `Stdio::Memfd`).
                    let _ =
                        core::mem::ManuallyDrop::new(core::mem::replace(&mut stdio, Stdio::Ignore));
                    Ok(Writable::Memfd(fd))
                }
                Stdio::Fd(_) => Ok(Writable::Fd(result.unwrap())),
                Stdio::Inherit => Ok(Writable::Inherit),
                Stdio::Path(_) | Stdio::Ignore => Ok(Writable::Ignore),
                Stdio::Ipc | Stdio::Capture(_) => Ok(Writable::Ignore),
                Stdio::ReadableStream(_) => {
                    // The shell never uses this
                    panic!("Unimplemented stdin readable_stream");
                }
                Stdio::SocketFd => {
                    // The shell never uses this; rejected at i < 3 anyway.
                    panic!("Unimplemented stdin socket-fd");
                }
            }
        }
    }

    // Note: there is intentionally no `Writable::toJS` here — the shell never
    // exposes its stdin Writable to JS.

    pub fn finalize(&mut self) {
        match core::mem::replace(self, Writable::Ignore) {
            Writable::Pipe(pipe) => drop(pipe),
            Writable::Buffer(buffer) => {
                StaticPipeWriter::update_ref(buffer.this_ptr(), false);
                drop(buffer);
            }
            Writable::Memfd(fd) => fd.close(),
            other @ (Writable::Ignore | Writable::Fd(_) | Writable::Inherit) => *self = other,
        }
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Readable
// ───────────────────────────────────────────────────────────────────────────

pub enum Readable {
    Fd(Fd),
    Memfd(Fd),
    /// One ref; released by `finalize` (`detach`) or `on_close_io`.
    Pipe(RefPtr<PipeReader>),
    Inherit,
    Ignore,
    Closed,
    Buffer(Box<[u8]>),
}

impl Readable {
    /// If the slot is a `Pipe`, start its `BufferedReader` against `process`
    /// and (when `eager`) immediately drain it. `start`/`read_all` can
    /// complete the reader synchronously, which runs `close_io` →
    /// `Readable::finalize` and overwrites the slot, so no borrow of it is held
    /// across those calls; a local ref keeps the reader alive meanwhile.
    fn start_pipe_reader(
        slot: &JsCell<Readable>,
        process: ThisPtr<ShellSubprocess>,
        event_loop: EventLoopHandle,
        eager: bool,
    ) -> bun_sys::Result<()> {
        let keepalive = match slot.get() {
            Readable::Pipe(pipe) => pipe.clone(),
            _ => return Ok(()),
        };
        let result = keepalive.start(process, event_loop);
        if result.is_ok() && eager {
            PipeReader::read_all(keepalive.this_ptr());
        }
        result
    }

    pub(crate) fn r#ref(&self) {
        if let Readable::Pipe(pipe) = self {
            pipe.update_ref(true);
        }
    }

    pub(crate) fn unref(&self) {
        if let Readable::Pipe(pipe) = self {
            pipe.update_ref(false);
        }
    }

    // Note: there is intentionally no `Readable::toSlice` here — subprocess
    // output is read via `PipeReader::buffered_output`.

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn init(
        out_type: OutKind,
        stdio: Stdio,
        redirect_buf: Option<jsc::PinnedArrayBuffer>,
        shellio: Option<Arc<IOWriter>>,
        event_loop: EventLoopHandle,
        process: ThisPtr<ShellSubprocess>,
        result: StdioResult,
        interp: Option<ParentRef<Interpreter>>,
        _max_size: u32,
        _is_sync: bool,
    ) -> Readable {
        assert_stdio_result!(result);

        debug_assert!(redirect_buf.is_none() || matches!(stdio, Stdio::Pipe | Stdio::Capture(_)));
        let buffered_output = match redirect_buf {
            Some(buf) => BufferedOutput::ArrayBuffer { buf, i: 0 },
            None => BufferedOutput::default(),
        };
        // Note: `Stdio` impls Drop, so dispatch on `&mut` instead of partial moves (E0509).
        let mut stdio = stdio;
        #[cfg(windows)]
        {
            return match &mut stdio {
                Stdio::Inherit => Readable::Inherit,
                Stdio::Ipc | Stdio::Dup2(_) | Stdio::Ignore => Readable::Ignore,
                Stdio::Path(_) => Readable::Ignore,
                Stdio::Fd(fd) => Readable::Fd(*fd),
                // blobs are immutable, so we should only ever get the case
                // where the user passed in a Blob with an fd
                Stdio::Blob(_) => Readable::Ignore,
                Stdio::Memfd(_) => Readable::Ignore,
                Stdio::Pipe => Readable::Pipe(PipeReader::create(
                    event_loop,
                    process,
                    result,
                    None,
                    buffered_output,
                    out_type,
                    interp,
                )),
                Stdio::Capture(_) => Readable::Pipe(PipeReader::create(
                    event_loop,
                    process,
                    result,
                    shellio,
                    buffered_output,
                    out_type,
                    interp,
                )),
                Stdio::ReadableStream(_) => Readable::Ignore, // Shell doesn't use readable_stream
                // The shell never uses this; rejected at i < 3 anyway.
                Stdio::SocketFd => Readable::Ignore,
            };
        }

        #[cfg(not(windows))]
        {
            match &mut stdio {
                Stdio::Inherit => Readable::Inherit,
                Stdio::Ipc | Stdio::Dup2(_) | Stdio::Ignore => Readable::Ignore,
                Stdio::Path(_) => Readable::Ignore,
                Stdio::Fd(_) => Readable::Fd(result.unwrap()),
                // blobs are immutable, so we should only ever get the case
                // where the user passed in a Blob with an fd
                Stdio::Blob(_) => Readable::Ignore,
                Stdio::Memfd(memfd) => {
                    let fd = *memfd;
                    // Ownership of the fd transfers to `Readable::Memfd`. Swap in
                    // `Ignore` and suppress the old value's destructor so
                    // `Stdio::Drop` doesn't close the fd we just took.
                    let _ =
                        core::mem::ManuallyDrop::new(core::mem::replace(&mut stdio, Stdio::Ignore));
                    Readable::Memfd(fd)
                }
                Stdio::Pipe => Readable::Pipe(PipeReader::create(
                    event_loop,
                    process,
                    result,
                    None,
                    buffered_output,
                    out_type,
                    interp,
                )),
                Stdio::Capture(_) => Readable::Pipe(PipeReader::create(
                    event_loop,
                    process,
                    result,
                    shellio,
                    buffered_output,
                    out_type,
                    interp,
                )),
                Stdio::ReadableStream(_) => Readable::Ignore, // Shell doesn't use readable_stream
                // The shell never uses this; rejected at i < 3 anyway.
                Stdio::SocketFd => Readable::Ignore,
            }
        }
    }

    pub fn finalize(&mut self) {
        match core::mem::replace(self, Readable::Closed) {
            Readable::Memfd(fd) => {
                *self = Readable::Closed;
                fd.close();
            }
            // .fd is borrowed from the shell's IOWriter (see IO.OutKind.to_subproc_stdio) or
            // a CowFd redirect; the owner closes it.
            Readable::Fd(_) => {
                *self = Readable::Closed;
            }
            Readable::Pipe(pipe) => {
                *self = Readable::Closed;
                PipeReader::detach(pipe);
            }
            other => {
                *self = other;
            }
        }
    }
}

// ───────────────────────────────────────────────────────────────────────────
// SpawnArgs
// ───────────────────────────────────────────────────────────────────────────

pub struct SpawnArgs<'a> {
    /// Shared borrow: arena alloc methods take `&self`, and a `&'a Arena`
    /// (being `Copy`) lets `fill_env` hand back `&'a [u8]` slices without
    /// the raw-pointer round-trip the `&'a mut Arena` reborrow forced.
    pub(crate) arena: &'a Arena,
    /// Backref so [`PipeReader`] async-I/O callbacks can drive
    /// [`Yield::run`]. The spawning `Cmd` passes it explicitly here and it is
    /// plumbed through `Readable::init` → `PipeReader::create`.
    pub(crate) interp: Option<ParentRef<Interpreter>>,

    pub(crate) override_env: bool,
    pub(crate) env_array: Vec<&'a core::ffi::CStr>,
    pub(crate) cwd: &'a [u8],
    pub(crate) stdio: [Stdio; 3],
    /// `> ${arraybuffer}` redirect targets; the matching `stdio` slot is `Pipe`.
    pub(crate) redirect_stdout: Option<jsc::PinnedArrayBuffer>,
    pub(crate) redirect_stderr: Option<jsc::PinnedArrayBuffer>,
    pub(crate) lazy: bool,
    pub path: &'a [u8],
    // ipc_mode: IPCMode,
    // ipc_callback: JSValue,
}

impl<'a> SpawnArgs<'a> {
    pub(crate) fn default<const IS_SYNC: bool>(
        arena: &'a Arena,
        interp: &Interpreter,
        event_loop: EventLoopHandle,
    ) -> SpawnArgs<'a> {
        let mut out = SpawnArgs {
            arena,
            interp: Some(ParentRef::new(interp)),

            override_env: false,
            env_array: Vec::new(),
            cwd: event_loop.top_level_dir(),
            stdio: [Stdio::Ignore, Stdio::Pipe, Stdio::Inherit],
            redirect_stdout: None,
            redirect_stderr: None,
            lazy: false,
            // PATH unset → fall back to _PATH_DEFPATH on POSIX (Android often
            // has no PATH). PATH="" (explicit empty) is preserved — that's a
            // deliberate "search nothing" and substituting a default would
            // change argv[0] resolution on existing platforms.
            path: event_loop.with_env_var(b"PATH", |p| match p {
                Some(p) => &*arena.alloc_slice_copy(p),
                None => bun_spawn::default_search_path(),
            }),
            // .ipc_mode = IPCMode.none,
            // .ipc_callback = .zero,
        };

        if IS_SYNC {
            out.stdio[1] = Stdio::Pipe;
            out.stdio[2] = Stdio::Pipe;
        }
        out
    }

    /// `object_iter` should be a some type with the following fields:
    /// - `next() bool`
    pub(crate) fn fill_env<const DISABLE_PATH_LOOKUP_FOR_ARV0: bool>(
        &mut self,
        env_iter: &mut crate::shell::env_map::Iterator<'_>,
    ) {
        self.override_env = true;
        // Note: `bun_collections::array_hash_map::Iter` doesn't impl
        // `ExactSizeIterator`; use `size_hint` for the reservation.
        self.env_array
            .reserve_exact(env_iter.size_hint().0.saturating_sub(self.env_array.len()));

        if DISABLE_PATH_LOOKUP_FOR_ARV0 {
            // If the env object does not include a $PATH, it must disable path lookup for argv[0]
            self.path = b"";
        }

        while let Some(entry) = env_iter.next() {
            let key = entry.key_ptr.slice();
            let value = entry.value_ptr.slice();

            // Build a NUL-terminated `key=value` string in the spawn arena.
            // Bumpalo owns the bytes; freed when the spawn arena is reset.
            let len = key.len() + 1 + value.len();
            // `self.arena: &'a Arena` is `Copy`, so binding it yields the full
            // `'a` lifetime independent of the `&mut self` reborrow — the
            // returned slice is naturally `&'a mut [u8]`.
            let arena: &'a Arena = self.arena;
            let line: &'a mut [u8] = arena.alloc_slice_fill_default(len + 1);
            line[..key.len()].copy_from_slice(key);
            line[key.len()] = b'=';
            line[key.len() + 1..len].copy_from_slice(value);
            line[len] = 0;
            let line: &'a [u8] = line;

            if key == b"PATH" {
                self.path = &line[b"PATH=".len()..len];
            }

            self.env_array
                .push(core::ffi::CStr::from_bytes_until_nul(line).expect("NUL-terminated above"));
        }
    }
}

// ───────────────────────────────────────────────────────────────────────────
// PipeReader
// ───────────────────────────────────────────────────────────────────────────

pub type IOReader = BufferedReader;

pub enum PipeReaderState {
    Pending,
    Done(Box<[u8]>),
    Err(Option<Box<SystemError>>),
}

/// Intrusively ref-counted: `Readable::Pipe` holds the create ref;
/// `start_pipe_reader` and the terminal reader callbacks hold short-lived
/// keepalives. Every field is interior-mutable so the reader callbacks, the
/// `IOWriter` chunk callback and the owning `Cmd` (via `Readable::Pipe`) can
/// all reach the same reader through `&PipeReader`.
#[derive(bun_ptr::RefCounted)]
pub struct PipeReader {
    ref_count: RefCount<PipeReader>,
    pub(crate) reader: JsCell<IOReader>,
    /// Cleared by `detach` (from the subprocess's own teardown) before the
    /// subprocess is freed.
    pub(crate) process: Cell<Option<BackRef<ShellSubprocess, bun_ptr::Root>>>,
    pub(crate) event_loop: Cell<EventLoopHandle>,
    pub(crate) state: JsCell<PipeReaderState>,
    #[cfg_attr(windows, allow(dead_code))]
    stdio_result: StdioResult,
    pub(crate) out_type: OutKind,
    pub(crate) captured_writer: CapturedWriter,
    pub(crate) buffered_output: JsCell<BufferedOutput>,
    /// Backref so async read/write callbacks can drive `Yield::run`. See
    /// `IOWriter::interp` / `IOReader::interp` for the same pattern. Wired
    /// from `Cmd::interp` at `PipeReader::create` time.
    interp: Option<ParentRef<Interpreter>>,
}

pub enum BufferedOutput {
    Bytelist(Vec<u8>),
    ArrayBuffer { buf: jsc::PinnedArrayBuffer, i: u32 },
}

impl Default for BufferedOutput {
    fn default() -> Self {
        BufferedOutput::Bytelist(Vec::<u8>::default())
    }
}

impl BufferedOutput {
    #[inline]
    pub(crate) fn len(&self) -> usize {
        match self {
            BufferedOutput::Bytelist(b) => b.len() as usize,
            BufferedOutput::ArrayBuffer { i, .. } => *i as usize,
        }
    }

    pub(crate) fn slice(&self) -> &[u8] {
        match self {
            BufferedOutput::Bytelist(b) => b.slice(),
            BufferedOutput::ArrayBuffer { buf, .. } => buf.slice(),
        }
    }

    pub(crate) fn append(&mut self, bytes: &[u8]) {
        match self {
            BufferedOutput::Bytelist(b) => {
                let _ = b.append_slice(bytes); // OOM/capacity: fire-and-forget
            }
            BufferedOutput::ArrayBuffer { buf, i } => {
                let array_buf_slice = buf.slice_mut();
                let idx = *i as usize;
                // TODO: We should probably throw error here?
                if idx >= array_buf_slice.len() {
                    return;
                }
                let length = (array_buf_slice.len() - idx).min(bytes.len());
                array_buf_slice[idx..idx + length].copy_from_slice(&bytes[..length]);
                *i += u32::try_from(length).expect("int cast");
            }
        }
    }
}

pub struct CapturedWriter {
    pub(crate) dead: Cell<bool>,
    /// `None` iff `dead == true`.
    pub(crate) writer: JsCell<Option<Arc<IOWriter>>>,
    pub(crate) written: Cell<usize>,
    pub(crate) err: JsCell<Option<SystemError>>,
}

impl Default for CapturedWriter {
    fn default() -> Self {
        CapturedWriter {
            dead: Cell::new(true),
            writer: JsCell::new(None),
            written: Cell::new(0),
            err: JsCell::new(None),
        }
    }
}

impl PipeReader {
    /// The `IOWriter` child handle for this reader's captured-output tee.
    #[inline]
    pub(crate) fn captured_child_ptr(this: ThisPtr<Self>) -> io_writer::ChildPtr {
        io_writer::ChildPtr::subproc_capture(this.as_ptr().cast())
    }

    fn captured_do_write(this: ThisPtr<Self>, chunk: &[u8]) {
        let cw = &this.captured_writer;
        if cw.dead.get() || cw.err.get().is_some() {
            return;
        }

        log!(
            "CapturedWriter(0x{:x}, {}) doWrite len={} parent_amount={}",
            std::ptr::from_ref(cw) as usize,
            out_kind_str(this.out_type),
            chunk.len(),
            this.buffered_output.get().len()
        );
        // `dead == false` ⇒ writer.is_some() (set in PipeReader::create).
        let writer = cw
            .writer
            .get()
            .clone()
            .expect("CapturedWriter live without writer");
        let y = writer.enqueue(Self::captured_child_ptr(this), None, chunk);
        Self::run_yield_with(this.interp, y);
    }

    /// `IOWriter` chunk callback for the captured-output tee (dispatched via
    /// `WriterTag::Subproc`).
    pub(crate) fn on_captured_iowriter_chunk(
        this: ThisPtr<Self>,
        amount: usize,
        err: Option<SystemError>,
    ) -> Yield {
        let cw = &this.captured_writer;
        let written = cw.written.get() + amount;
        log!(
            "CapturedWriter({:x}, {}) onWrite({}, has_err={}) total_written={} total_to_write={}",
            std::ptr::from_ref(cw) as usize,
            out_kind_str(this.out_type),
            amount,
            err.is_some(),
            written,
            this.buffered_output.get().len()
        );
        let all_written = written >= this.buffered_output.get().len()
            && !matches!(this.state.get(), PipeReaderState::Pending);
        cw.written.set(written);
        if let Some(e) = err {
            log!(
                "CapturedWriter(0x{:x}, {}) onWrite errno={} errmsg={} errfd={:?} syscall={}",
                std::ptr::from_ref(cw) as usize,
                out_kind_str(this.out_type),
                e.errno,
                e.message,
                e.fd,
                e.syscall
            );
            cw.err.set(Some(e));
        } else if !all_written {
            return Yield::Suspended;
        }
        Self::try_signal_done_to_cmd(this)
    }

    fn captured_writer_done(&self, just_written: usize) -> bool {
        let cw = &self.captured_writer;
        log!(
            "CapturedWriter(0x{:x}, {}) isDone(has_err={}, parent_state={}, written={}, parent_amount={})",
            std::ptr::from_ref(cw) as usize,
            out_kind_str(self.out_type),
            cw.err.get().is_some(),
            <&'static str>::from(self.state.get()),
            cw.written.get(),
            self.buffered_output.get().len()
        );
        if cw.dead.get() || cw.err.get().is_some() {
            return true;
        }
        if matches!(self.state.get(), PipeReaderState::Pending) {
            return false;
        }
        cw.written.get() + just_written >= self.buffered_output.get().len()
    }
}

impl PipeReader {
    /// Clear the backref so any late `on_reader_done`/`on_reader_error`
    /// after the Subprocess is freed can't follow it, and release the ref.
    #[allow(clippy::needless_pass_by_value)] // consumes the ref
    pub(crate) fn detach(this: RefPtr<Self>) {
        log!(
            "PipeReader(0x{:x}, {}) detach()",
            this.as_ptr() as usize,
            out_kind_str(this.out_type)
        );
        this.process.set(None);
    }

    pub(crate) fn is_done(&self) -> bool {
        log!(
            "PipeReader(0x{:x}, {}) isDone() state={} captured_writer_done={}",
            std::ptr::from_ref(self) as usize,
            out_kind_str(self.out_type),
            <&'static str>::from(self.state.get()),
            self.captured_writer_done(0)
        );
        if matches!(self.state.get(), PipeReaderState::Pending) {
            return false;
        }
        self.captured_writer_done(0)
    }

    /// Drive a `Yield` from inside an async I/O callback. Mirrors
    /// `IOWriter::run_yield` / `IOReader::run_yield`. `interp` is wired at
    /// `create` time from the spawning `Cmd`; the `None` guard is a defensive
    /// debug-assert for tests that construct a PipeReader without a Cmd. A
    /// free function so no `&PipeReader` borrow is held across the
    /// interpreter trampoline (which can reach this reader via
    /// `Readable::Pipe`).
    fn run_yield_with(interp: Option<ParentRef<Interpreter>>, y: Yield) {
        let Some(interp) = interp else {
            debug_assert!(
                matches!(y, Yield::Done | Yield::Suspended | Yield::Failed),
                "PipeReader async callback fired without interp backref"
            );
            return;
        };
        // interp outlives every PipeReader (it owns the Cmd that spawned the
        // subprocess holding this reader). Single-threaded.
        y.run(interp.get());
    }

    pub(crate) fn create(
        event_loop: EventLoopHandle,
        process: ThisPtr<ShellSubprocess>,
        result: StdioResult,
        capture: Option<Arc<IOWriter>>,
        buffered_output: BufferedOutput,
        out_type: OutKind,
        interp: Option<ParentRef<Interpreter>>,
    ) -> RefPtr<PipeReader> {
        let captured_writer = CapturedWriter::default();
        if let Some(cap) = capture {
            captured_writer.writer.set(Some(cap)); // dupeRef → Arc clone already happened on pass-in
            captured_writer.dead.set(false);
        }

        #[allow(unused_mut)]
        let mut reader = IOReader::init::<PipeReader>();
        #[cfg(not(windows))]
        let stdio_result = result;
        #[cfg(windows)]
        // With `Box<uv::Pipe>` the pipe cannot be aliased, so ownership
        // transfers to `reader.source` (`stdio_result` is never read again
        // on Windows — `start()` goes through `start_with_current_pipe`).
        let stdio_result = match result {
            StdioResult::Buffer(buf) => {
                reader.set_source(bun_io::Source::Pipe(buf));
                StdioResult::Unavailable
            }
            StdioResult::BufferFd(fd) => {
                reader.set_source(bun_io::Source::File(bun_io::Source::open_file(fd)));
                StdioResult::BufferFd(fd)
            }
            StdioResult::UnownedFd(_) | StdioResult::Unavailable => panic!("Shouldn't happen."),
        };

        // Allocate before handing the address to `reader.set_parent`.
        let this = RefPtr::new(PipeReader {
            ref_count: RefCount::init(),
            process: Cell::new(Some(BackRef::from(process))),
            reader: JsCell::new(reader),
            event_loop: Cell::new(event_loop),
            stdio_result,
            out_type,
            state: JsCell::new(PipeReaderState::Pending),
            captured_writer,
            buffered_output: JsCell::new(buffered_output),
            interp,
        });
        log!(
            "PipeReader(0x{:x}, {}) create()",
            this.as_ptr() as usize,
            out_kind_str(out_type)
        );
        let root = this.as_ptr();
        this.reader.with_mut(|r| r.set_parent(root.cast()));

        this
    }

    pub(crate) fn read_all(this: ThisPtr<Self>) {
        if matches!(this.state.get(), PipeReaderState::Pending) {
            // `read`'s dispatch re-enters `on_read_chunk` / the terminal
            // callbacks, hence the root-pointer entry.
            IOReader::read_from(this);
        }
    }

    pub(crate) fn start(
        &self,
        process: ThisPtr<ShellSubprocess>,
        event_loop: EventLoopHandle,
    ) -> bun_sys::Result<()> {
        // self.ref();
        self.process.set(Some(BackRef::from(process)));
        self.event_loop.set(event_loop);
        #[cfg(windows)]
        {
            return self.reader.with_mut(|r| r.start_with_current_pipe());
        }

        #[cfg(not(windows))]
        match self
            .reader
            .with_mut(|r| r.start(self.stdio_result.unwrap(), true))
        {
            bun_sys::Result::Err(err) => bun_sys::Result::Err(err),
            bun_sys::Result::Ok(()) => {
                // `reader.start` reports a poll-registration failure through
                // `on_reader_error` (not its return value), so the reader may
                // already be errored/torn down here; same guard as
                // `SubprocessPipeReader::start`.
                if matches!(self.state.get(), PipeReaderState::Err(_)) {
                    return Ok(());
                }
                #[cfg(unix)]
                self.reader.with_mut(|r| {
                    // TODO: are these flags correct
                    if let Some(poll) = r.handle.get_poll() {
                        poll.set_flag(bun_io::FilePollFlag::Socket);
                    }
                    r.flags.insert(bun_io::pipe_reader::PosixFlags::SOCKET);
                });

                Ok(())
            }
        }
    }

    /// `BufferedReaderParent::on_read_chunk` — invoked with the `PipeReader`
    /// registered via `reader.set_parent`.
    pub(crate) fn on_read_chunk(this: ThisPtr<Self>, chunk: &[u8], has_more: ReadState) -> bool {
        this.buffered_output.with_mut(|b| b.append(chunk));
        log!(
            "PipeReader(0x{:x}, {}) onReadChunk(chunk_len={}, has_more={})",
            this.as_ptr() as usize,
            out_kind_str(this.out_type),
            chunk.len(),
            read_state_str(has_more)
        );

        Self::captured_do_write(this, chunk);

        // No explicit re-arm here (`register_poll()` on POSIX /
        // `start_with_current_pipe()` on Windows). This callback runs from
        // inside the bun_io read loop, which is still working on `reader` and
        // re-registers the poll itself based on the bool we return
        // (`IOReader::on_read_chunk_cb` and `WindowsBufferedReader::on_read`
        // document the same contract).
        //
        // Re-arming from here also violates `BufferedReaderParent`'s
        // requirement that `on_read_chunk` never frees the reader:
        // `register_poll()`'s failure path dispatches `on_reader_error`,
        // which drops the last ref and frees the `PosixBufferedReader` the
        // loop is still reading through.
        has_more != ReadState::Eof
    }

    /// Tail shared by [`on_reader_done`] / [`on_reader_error`]: signal the
    /// owning `Cmd`, drive its `Yield`, then notify the `ShellSubprocess` to
    /// drop its `Readable::Pipe` handle. The caller's keepalive ref keeps
    /// `this` alive across the latter. No `&PipeReader` is held across the
    /// re-entrant `try_signal_done_to_cmd` / `run_yield_with` calls — both
    /// reach back into this same allocation via `Readable::Pipe`. Callers
    /// gate on `is_done()` first so the captured-writer tee has drained before
    /// `on_close_io` drops the `Readable::Pipe` ref.
    fn finish_after_state_set(this: ThisPtr<Self>) {
        // Snapshot `interp` *before* the Cmd call: `try_signal_done_to_cmd`
        // → `Cmd::buffered_output_close` → `close_io` may overwrite the
        // `Readable::Pipe` slot.
        let interp = this.interp;
        let y = Self::try_signal_done_to_cmd(this);
        // Once the Cmd has taken the output it detaches this reader (`process`
        // is `None`) and nothing reads `buffered_output` again. Drop it now
        // rather than with `guard`: `y` can settle the shell promise, and its
        // microtask checkpoint must not see a `> ${arraybuffer}` target that
        // is still pinned.
        if this.process.get().is_none() {
            this.buffered_output.set(BufferedOutput::default());
        }
        Self::run_yield_with(interp, y);
        if let Some(process) = this.process.get() {
            // `process` is the `ShellSubprocess` (stable address), freed only
            // by `Cmd::deinit` after every PipeReader has signalled done (this
            // call). `on_close_io` drops the `Readable::Pipe` ref — the
            // caller's keepalive keeps `this` live past that.
            let kind = this.kind(process.get());
            process.on_close_io(kind);
        }
    }

    /// `this: ThisPtr` because `on_close_io` below drops the `Readable::Pipe`
    /// ref; the local guard holds our own.
    pub(crate) fn on_reader_done(this: ThisPtr<Self>) {
        let _guard = RefPtr::from_this(this);
        log!(
            "onReaderDone(0x{:x}, {})",
            this.as_ptr() as usize,
            out_kind_str(this.out_type)
        );
        let owned = this.to_owned_slice();
        this.state.set(PipeReaderState::Done(owned));
        if !this.is_done() {
            return;
        }
        Self::finish_after_state_set(this);
        // Dropping `_guard` releases our ref; may free `this`.
    }

    /// Spec `signalDoneToCmd`. The tail call into `Cmd::buffered_output_close`
    /// re-derives a `&PipeReader` to *this same allocation* via the
    /// `Readable::Pipe` ref (for `pipe.slice()` and `close_io`), so no borrow
    /// of `this` is held across it.
    pub(crate) fn try_signal_done_to_cmd(this: ThisPtr<Self>) -> Yield {
        let (done, out_type, process) = (this.is_done(), this.out_type, this.process.get());
        if !done {
            return Yield::Suspended;
        }
        log!(
            "signalDoneToCmd ({:x}: {}) isDone={}",
            this.as_ptr() as usize,
            out_kind_str(out_type),
            done
        );
        // `process` is `None` once `detach()` (via `close_io`) has run, i.e. this
        // reader already signalled its Cmd. The reader can still deliver terminal
        // callbacks after that (see `read_with_fn`'s EAGAIN arm), so no-op here.
        if let Some(proc) = process {
            let e: Option<SystemError> = this.take_captured_error();
            // `proc` is the `ShellSubprocess` freed only by `Cmd::deinit`,
            // which runs strictly after every PipeReader has signalled done.
            // `cmd_mut` resolves through the node arena (see `CmdHandle`).
            let handle = proc.cmd_parent;
            return handle.cmd_mut().buffered_output_close(out_type, e);
        }
        Yield::Suspended
    }

    fn take_captured_error(&self) -> Option<SystemError> {
        if let Some(e) = self.captured_writer.err.replace(None) {
            self.state.with_mut(|state| {
                match core::mem::replace(state, PipeReaderState::Pending) {
                    PipeReaderState::Done(buf) => {
                        drop(buf);
                        *state = PipeReaderState::Err(Some(Box::new(e)));
                    }
                    old @ PipeReaderState::Err(_) => {
                        *state = old;
                    }
                    PipeReaderState::Pending => {
                        *state = PipeReaderState::Err(Some(Box::new(e)));
                    }
                }
            });
        }
        // `bun_sys::SystemError` isn't ref-counted nor `Clone`.
        // Move it out (the only reader of
        // `state.Err` after this point is `Drop`, which tolerates `None`).
        self.state.with_mut(|state| {
            if let PipeReaderState::Err(slot) = state {
                slot.take().map(|b| *b)
            } else {
                None
            }
        })
    }

    pub(crate) fn kind(&self, process: &ShellSubprocess) -> StdioKind {
        if let Readable::Pipe(p) = process.stdout.get() {
            if core::ptr::eq(p.as_ptr(), self) {
                return StdioKind::Stdout;
            }
        }

        if let Readable::Pipe(p) = process.stderr.get() {
            if core::ptr::eq(p.as_ptr(), self) {
                return StdioKind::Stderr;
            }
        }

        panic!("We should be either stdout or stderr");
    }

    pub(crate) fn take_buffer(&self) -> Vec<u8> {
        self.reader.with_mut(|r| r.take_buffer())
    }

    pub(crate) fn slice(&self) -> &[u8] {
        self.buffered_output.get().slice()
    }

    pub(crate) fn to_owned_slice(&self) -> Box<[u8]> {
        if let Some(buf) = self.state.with_mut(|s| match s {
            PipeReaderState::Done(buf) => Some(core::mem::take(buf)),
            _ => None,
        }) {
            return buf;
        }
        // we do not use .toOwnedSlice() because we don't want to reallocate memory.
        let out = self.reader.with_mut(|r| core::mem::take(&mut r._buffer));

        if out.capacity() > 0 && out.is_empty() {
            drop(out);
            return Box::default();
        }
        out.into_boxed_slice()
        // PERF: into_boxed_slice may realloc to shrink. Profile if hot.
    }

    /// Swap the done buffer out, leaving an empty one in its place.
    fn take_done_buffer(&self) -> Box<[u8]> {
        match self.state.replace(PipeReaderState::Done(Box::default())) {
            PipeReaderState::Done(buf) => buf,
            _ => Box::default(),
        }
    }

    pub(crate) fn update_ref(&self, add: bool) {
        self.reader.with_mut(|r| r.update_ref(add));
    }

    /// See [`Self::on_reader_done`].
    pub(crate) fn on_reader_error(this: ThisPtr<Self>, err: &bun_sys::Error) {
        log!(
            "PipeReader(0x{:x}) onReaderError {:?}",
            this.as_ptr() as usize,
            err
        );
        let _guard = RefPtr::from_this(this);
        this.state.with_mut(|state| {
            match core::mem::replace(state, PipeReaderState::Err(None)) {
                // Keep the first recorded error, as `take_captured_error` does.
                old @ PipeReaderState::Err(Some(_)) => *state = old,
                _ => *state = PipeReaderState::Err(Some(Box::new(err.to_system_error()))),
            }
        });
        if !this.is_done() {
            return;
        }
        Self::finish_after_state_set(this);
        // Dropping `_guard` releases our ref; may free `this`.
    }

    pub(crate) fn r#loop(&self) -> *mut AsyncLoop {
        #[cfg(windows)]
        {
            self.event_loop.get().uv_loop()
        }
        #[cfg(not(windows))]
        {
            self.event_loop.get().r#loop()
        }
    }
}

impl Drop for PipeReader {
    fn drop(&mut self) {
        log!(
            "PipeReader(0x{:x}, {}) deinit()",
            std::ptr::from_mut(self) as usize,
            out_kind_str(self.out_type)
        );
        #[cfg(unix)]
        {
            debug_assert!(
                self.reader.get().is_done() || matches!(self.state.get(), PipeReaderState::Err(_))
            );
        }

        #[cfg(windows)]
        {
            let r = self.reader.get();
            debug_assert!(r.source.is_none() || r.source.as_ref().unwrap().is_closed());
        }

        // PipeReaderState::Done(Box<[u8]>) drops its buffer automatically.

        // CapturedWriter's fields drop the err and writer Arc.

        self.state.with_mut(|s| {
            if let PipeReaderState::Err(slot) = s {
                *slot = None;
            }
        });

        // buffered_output drops automatically.
        // reader drops automatically.
        // Box dealloc handled by the refcount destructor.
    }
}

// The reader callbacks get `this: ThisPtr<PipeReader>`: `on_reader_done` /
// `on_reader_error` take a keepalive ref that may free `this` on drop, so no
// `&self`/`&mut self` receiver may span them.
bun_io::impl_buffered_reader_parent! {
    ShellPipeReader for PipeReader;
    borrow = this;
    reader = reader;
    has_on_read_chunk = true;
    on_read_chunk   = |this, chunk, has_more| PipeReader::on_read_chunk(this, &chunk, has_more);
    on_reader_done  = |this| PipeReader::on_reader_done(this);
    on_reader_error = |this, err| PipeReader::on_reader_error(this, &err);
    loop_           = |this| this.r#loop();
    event_loop      = |this| this.event_loop.get().as_event_loop_ctx();
}

// ───────────────────────────────────────────────────────────────────────────
// StdioKind & helpers
// ───────────────────────────────────────────────────────────────────────────

// `StdioKind` is re-exported from `crate::api::bun_subprocess` at the top of
// this file so the `StaticPipeWriterProcess` trait impl uses the exact same
// enum the trait was declared with.

// `StdioResult` is `Option<Fd>` (8-byte Copy) on unix but a non-Copy enum
// (`Buffer(Box<uv::Pipe>)`) on windows; a fn would have to pick by-value
// (moves on windows) or by-ref (clippy::trivially_copy_pass_by_ref on unix).
macro_rules! assert_stdio_result {
    ($result:expr) => {{
        #[cfg(all(debug_assertions, unix))]
        if let Some(fd) = &$result {
            debug_assert!(fd.is_valid());
        }
    }};
}
pub(crate) use assert_stdio_result;

// IntoStaticStr for PipeReaderState (used in logs as the variant name).
impl From<&PipeReaderState> for &'static str {
    fn from(s: &PipeReaderState) -> &'static str {
        match s {
            PipeReaderState::Pending => "pending",
            PipeReaderState::Done(_) => "done",
            PipeReaderState::Err(_) => "err",
        }
    }
}
