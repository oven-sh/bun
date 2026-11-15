use core::ffi::c_char;
use core::marker::PhantomData;
use core::ops::ControlFlow;
use core::ptr::NonNull;
use std::rc::Rc;

#[cfg(unix)]
use crate::api::bun::process::SpawnResultExt as _;
#[cfg(windows)]
use crate::api::bun::process::WindowsOptions;
use crate::api::bun::process::{self as bun_process, Process, SpawnOptions, Status};
use crate::api::bun::subprocess as JscSubprocess;
use crate::shell::builtin::{Builtin, IoKind};
use crate::shell::interpreter::{EnvMap, Interpreter, NodeId, ShellInterpreter};
use crate::shell::io_writer::{self, IOWriterId};
use crate::shell::states::cmd::{Cmd, Exec};
use crate::shell::{self as sh, ExitCode, Yield};
use bun_alloc::Arena;
use bun_collections::VecExt;
use bun_core::{CStrList, CStrRef};
use bun_io::max_buf::Kind;
use bun_io::{BufferedReader, IoEvent, Owner, PollTag, ReadResult, ReadState};
use bun_jsc::{self as jsc, EventLoopHandle};
use bun_spawn::subprocess::PipeState;
use bun_sys::{self, SystemError};

use crate::api::bun_spawn::stdio::{self, Stdio};

/// Local helper: `IoKind` → tag-name string for logs.
#[inline]
fn io_kind_str(k: IoKind) -> &'static str {
    match k {
        IoKind::Stdout => "stdout",
        IoKind::Stderr => "stderr",
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

use JscSubprocess::StaticPipeWriter;
pub(crate) use JscSubprocess::StdioKind;

use crate::shell::ShellErr;

pub(crate) use JscSubprocess::StdioResult;

bun_output::define_scoped_log!(log, SHELL_SUBPROC, visible);

/// Used for captured writer
#[derive(Default)]
pub(crate) struct ShellIO {
    pub(crate) stdout: Option<IOWriterId>,
    pub(crate) stderr: Option<IOWriterId>,
}

// ───────────────────────────────────────────────────────────────────────────
// ShellSubprocess
// ───────────────────────────────────────────────────────────────────────────

pub(crate) struct SubprocExec<'a> {
    child: Rc<ShellSubprocess>,

    /// `None` once it is closed, or if it is not piped (e.g. inherited / fd-backed).
    stdin: Option<StaticPipeWriter>,
    stdout: Option<PipeReader>,
    stderr: Option<PipeReader>,

    ctrl_c_child: Option<bun_spawn::ctrl_c::Child>,

    /// `spawn_async` has not returned, so `finish_if_done` must not finish the `Cmd`.
    pub(crate) is_spawning: bool,

    /// Ties it to `Interpreter<'a>`, so it cannot leave a `with_interp` closure.
    _interp: PhantomData<&'a ()>,
}

/// Shared, because C callbacks point to it and `read` borrows it while the interpreter runs.
pub(crate) struct ShellSubprocess {
    interp: NonNull<ShellInterpreter>,
    cmd: NodeId,

    process: bun_process::ProcessHandle,

    stdout: BufferedReader,
    stderr: BufferedReader,

    /// A child a `Bun.ModuleGraph`'s script started with `Bun.$` is killed with the graph.
    abort_handle: jsc::AbortHandle,
}

jsc::impl_abort_handle_owner!(ShellSubprocess, abort_handle, |this, cause| {
    // A child outlives the VM that spawned it, as one `Bun.spawn` started does.
    if !matches!(
        cause,
        jsc::AbortCause::ContextStopped(jsc::StopReason::VmTeardown)
    ) {
        // SAFETY: trait contract — `this` is live.
        let _ = unsafe { (*this).try_kill(SignalCode::SIGKILL as i32) };
    }
});

pub(crate) type SignalCode = bun_core::SignalCode;

impl Drop for SubprocExec<'_> {
    fn drop(&mut self) {
        let child = &*self.child;
        child.unref();
        child.process.detach();
        child.stdout.deinit();
        child.stderr.deinit();
        log!("Deinit");
    }
}

bun_spawn::link_impl_ProcessExit! {
    Shell for ShellSubprocess => |this| {
        // Forwarded raw, not autoref'd: the callee may free `*this`.
        on_process_exit(status, _rusage) =>
            ShellSubprocess::on_process_exit(this, &status),
    }
}

/// A subprocess whose pipe readers are not started yet.
struct Spawned {
    child: Rc<ShellSubprocess>,
    stdout: Option<StdioResult>,
    stderr: Option<StdioResult>,
    did_exit_immediately: bool,
}

impl Spawned {
    fn start(self, shell_interp: &ShellInterpreter) {
        let child = &self.child;
        for (kind, pipe) in [(IoKind::Stdout, self.stdout), (IoKind::Stderr, self.stderr)] {
            if let Some(pipe) = pipe {
                child.start_pipe_reader(shell_interp, kind, pipe);
            }
        }
        child.r#ref();

        if self.did_exit_immediately {
            // `watch()` failed → process already gone.
            let process = child.process.this_ptr();
            if let Some(status) = process.status() {
                Process::on_exit(process, status.clone(), &bun_process::rusage_zeroed());
            } else {
                Process::wait(process, false);
            }
        }
    }
}

impl<'a> SubprocExec<'a> {
    #[track_caller]
    fn of_mut<'i>(interp: &'i mut Interpreter<'a>, cmd: NodeId) -> &'i mut Self {
        match &mut interp.as_cmd_mut(cmd).exec {
            Exec::Subproc(exec) => exec,
            _ => panic!("Cmd {} is not running a subprocess", cmd),
        }
    }

    fn pipe_reader_mut(&mut self, kind: IoKind) -> &mut Option<PipeReader> {
        match kind {
            IoKind::Stdout => &mut self.stdout,
            IoKind::Stderr => &mut self.stderr,
        }
    }

    /// True once stdin, stdout, and stderr have all been closed.
    pub(crate) fn all_closed(&self) -> bool {
        self.stdin.is_none() && self.stdout.is_none() && self.stderr.is_none()
    }

    pub(crate) fn kill(&self) {
        let _ = self.child.try_kill(SignalCode::SIGKILL as i32);
    }

    /// `Heap::lastChanceToFinalize` deletes the `JSC::ArrayBuffer` impls
    /// before the sweep that reaches us, so dropping the redirect target's
    /// [`PinnedArrayBuffer`](jsc::PinnedArrayBuffer) would write to a
    /// freed impl; defuse it.
    ///
    /// VM-shutdown finalizer only (on a live heap this would leak the pin and
    /// GC root).
    pub(crate) fn defuse_array_buf_pins(&mut self) {
        for pipe in [&mut self.stdout, &mut self.stderr].into_iter().flatten() {
            if let BufferedOutput::ArrayBuffer { buf, .. } = &mut pipe.buffered_output {
                buf.defuse();
            }
        }
    }

    fn on_stdin_io(interp: &mut Interpreter<'a>, cmd: NodeId, event: IoEvent) -> Yield {
        let exec = Self::of_mut(interp, cmd);
        match &exec.stdin {
            Some(stdin) if stdin.on_io(event) == PipeState::Closed => {
                log!("onStdinWriterClose(cmd={})", cmd);
                exec.stdin = None;
                interp.as_cmd_mut(cmd).finish_if_done(cmd)
            }
            _ => Yield::suspended(),
        }
    }

    /// Sets `exec` of `cmd` on success.
    // `sh::Result`'s `ShellErr` is a shared shell-wide error type defined in
    // `shell_body.rs`; boxing it here would change `pub fn` signatures across
    // every `?`-propagating shell caller.
    #[allow(clippy::result_large_err)]
    fn init(
        interp: &mut Interpreter<'a>,
        cmd: NodeId,
        mut spawn_args: SpawnArgs<'_>,
    ) -> sh::Result<Spawned> {
        let (shell_interp, event_loop) = (interp.shell_interp(), interp.event_loop);
        let owner_ptr = shell_interp.as_ptr().cast();

        #[cfg(unix)]
        let no_sigpipe = if let Some(iowriter) = spawn_args.shellio.stdout {
            !interp.io_writers[iowriter].is_socket()
        } else {
            true
        };

        let mut spawn_option = |i: usize| match spawn_args.stdio[i].as_spawn_option(i as i32) {
            stdio::ResultT::Result(opt) => Ok(opt),
            stdio::ResultT::Err(e) => Err(ShellErr::Custom(Box::<[u8]>::from(e.to_str()))),
        };

        let spawn_options = SpawnOptions {
            stdin: spawn_option(0)?,
            stdout: spawn_option(1)?,
            stderr: spawn_option(2)?,
            cwd: Builtin::shell(interp, cmd).cwd().into(),
            #[cfg(unix)]
            no_sigpipe,
            #[cfg(windows)]
            windows: WindowsOptions {
                hide_window: true,
                loop_: event_loop,
                ..Default::default()
            },
            ..Default::default()
        };

        let args = core::mem::take(&mut interp.as_cmd_mut(cmd).args);
        let mut argv = Vec::with_capacity(args.len() + 1);
        argv.extend(
            args.iter()
                .map(|arg| Some(CStrRef::from_slice_with_nul(arg))),
        );
        let argv = CStrList::from_unterminated(&mut argv);
        let envp = CStrList::from_unterminated(&mut spawn_args.env_array);

        let foreground = !interp.in_background(cmd);
        let ctrl_c_child = foreground.then(bun_spawn::ctrl_c::Child::enter);
        crate::node::fs::note_process_start();
        let mut spawn_result = match bun_process::spawn_process(&spawn_options, argv, Some(envp)) {
            Err(err) => {
                let mut msg = Vec::<u8>::new();
                use std::io::Write;
                let _ = write!(&mut msg, "Failed to spawn process: {}", err.name());
                return Err(ShellErr::Custom(msg.into_boxed_slice()));
            }
            Ok(Err(err)) => return Err(ShellErr::Sys(err.to_shell_system_error())),
            Ok(Ok(result)) => result,
        };

        let [stdio0, stdio1, stdio2] = spawn_args.stdio;

        // `to_process` consumes the result for pid/pidfd; pull the fd handles out first.
        let spawn_stdin = spawn_result.stdin.take();
        let spawn_stdout = spawn_result.stdout.take();
        let spawn_stderr = spawn_result.stderr.take();

        let stdin = match stdio0 {
            Stdio::Blob(blob) => {
                let owner = Owner::with_key(PollTag::ShellStdinWriter, cmd.0, owner_ptr);
                // SAFETY: `shell_interp` owns `interp`, which outlives the writer.
                Some(unsafe { StaticPipeWriter::create(owner, spawn_stdin, blob) })
            }
            Stdio::Fd(_) | Stdio::Inherit | Stdio::Path(_) | Stdio::Ignore => None,
            _ => unreachable!("the shell makes no other stdin"),
        };
        let shellio = spawn_args.shellio;
        let stdout = PipeReader::init(&stdio1, spawn_args.redirect_stdout, shellio.stdout);
        let stderr = PipeReader::init(&stdio2, spawn_args.redirect_stderr, shellio.stderr);

        let child = Rc::new(ShellSubprocess {
            interp: shell_interp,
            cmd,
            process: spawn_result.to_process_handle(event_loop),
            stdout: BufferedReader::init(),
            stderr: BufferedReader::init(),
            abort_handle: jsc::AbortHandle::for_owner::<ShellSubprocess>(),
        });
        let subprocess = Rc::as_ptr(&child).cast_mut();
        // SAFETY: the process and the readers are fields of `child`, which is never borrowed mutably.
        // `shell_interp` owns `interp`, which gets one `Rc`, and is borrowed while any other exists.
        unsafe {
            Process::set_exit_handler(
                &child.process,
                bun_spawn::ProcessExit::new(bun_spawn::ProcessExitKind::Shell, subprocess),
            );
            for (kind, reader) in [(Kind::Stdout, &child.stdout), (Kind::Stderr, &child.stderr)] {
                let tag = PollTag::ShellPipeReader;
                reader.set_external_owner(Owner::with_kind_and_key(tag, kind, cmd.0, owner_ptr));
            }
        }
        if let Some(id) = interp.context {
            // Freed already (the graph was collected): `interrupted()` ends the script.
            if let Some(context) = jsc::virtual_machine::VirtualMachine::get().graph_context(id) {
                // SAFETY: `subprocess` is the live heap allocation; its handle is disarmed on drop.
                unsafe { jsc::AbortHandle::arm_owner(subprocess, context) };
            }
        }

        let spawned = Spawned {
            did_exit_immediately: child.process.watch().is_err(),
            child: Rc::clone(&child),
            stdout: stdout.is_some().then_some(spawn_stdout),
            stderr: stderr.is_some().then_some(spawn_stderr),
        };
        let mut exec = Box::new(SubprocExec {
            child,
            stdin,
            stdout,
            stderr,
            ctrl_c_child,
            is_spawning: true,
            _interp: PhantomData,
        });

        match exec.stdin.as_ref().map(|stdin| stdin.start(event_loop)) {
            None | Some(Ok(PipeState::Open)) => {}
            Some(Ok(PipeState::Closed)) => exec.stdin = None,
            Some(Err(err)) => {
                // Nothing reports its exit from here on, so nothing would reap it either.
                #[cfg(unix)]
                let _ = Process::kill_and_reap(
                    exec.child.process.this_ptr(),
                    &mut bun_process::rusage_zeroed(),
                );
                #[cfg(windows)]
                exec.kill();
                return Err(ShellErr::Sys(err.to_shell_system_error()));
            }
        }

        interp.as_cmd_mut(cmd).exec = Exec::Subproc(exec);
        Ok(spawned)
    }
}

impl ShellInterpreter {
    pub(crate) fn on_subproc_stdin_io(&self, cmd: NodeId, event: IoEvent) {
        self.run_yield_with(|interp| SubprocExec::on_stdin_io(interp, cmd, event));
    }

    pub(crate) fn on_pipe_reader_io(&self, cmd: NodeId, kind: Kind, event: IoEvent) {
        let kind = match kind {
            Kind::Stdout => IoKind::Stdout,
            Kind::Stderr => IoKind::Stderr,
        };
        let child = self.with_interp(|interp| Rc::clone(&SubprocExec::of_mut(interp, cmd).child));
        if let Some(child) = child {
            let result = child.read(self, kind, Some(event));
            drop(child);
            self.run_yield_with(|interp| PipeReader::on_read_result(interp, cmd, kind, result));
        }
    }
}

impl ShellSubprocess {
    pub(crate) fn spawn_async(
        shell_interp: &ShellInterpreter,
        cmd: NodeId,
        spawn_args: SpawnArgs<'_>,
    ) -> Yield {
        let spawned =
            shell_interp.with_interp(|interp| match SubprocExec::init(interp, cmd, spawn_args) {
                Ok(spawned) => ControlFlow::Continue(spawned),
                Err(e) => ControlFlow::Break(Builtin::cmd_write_failing_error(
                    interp,
                    cmd,
                    format_args!("{}\n", e),
                )),
            });
        match spawned.expect("the script waits for this Cmd") {
            ControlFlow::Continue(spawned) => spawned.start(shell_interp),
            ControlFlow::Break(y) => return y,
        }
        let y = shell_interp.with_interp(|interp| {
            SubprocExec::of_mut(interp, cmd).is_spawning = false;
            interp.as_cmd_mut(cmd).finish_if_done(cmd)
        });
        y.expect("the script waits for this Cmd")
    }

    fn reader(&self, kind: IoKind) -> &BufferedReader {
        match kind {
            IoKind::Stdout => &self.stdout,
            IoKind::Stderr => &self.stderr,
        }
    }

    fn r#ref(&self) {
        self.process.enable_keeping_event_loop_alive();
        self.stdout.update_ref(true);
        self.stderr.update_ref(true);
    }

    /// This disables the keeping process alive flag on the poll and also in the stdout and stderr
    fn unref(&self) {
        self.process.disable_keeping_event_loop_alive();
        self.stdout.update_ref(false);
        self.stderr.update_ref(false);
    }

    fn try_kill(&self, sig: i32) -> bun_sys::Result<()> {
        if self.process.has_exited() {
            return Ok(());
        }

        self.process.kill(u8::try_from(sig).expect("int cast"))
    }

    /// Starts the reader and immediately drains it.
    fn start_pipe_reader(&self, shell_interp: &ShellInterpreter, kind: IoKind, pipe: StdioResult) {
        let reader = self.reader(kind);
        #[cfg(windows)]
        let started = {
            reader.set_source(match pipe {
                StdioResult::Buffer(buf) => bun_io::Source::Pipe(buf),
                StdioResult::BufferFd(fd) => bun_io::Source::File(bun_io::Source::open_file(
                    shell_interp.event_loop.loop_(),
                    fd,
                )),
                StdioResult::UnownedFd(_) | StdioResult::Unavailable => panic!("Shouldn't happen."),
            });
            reader
                .start_with_current_pipe()
                .map(|()| ReadResult::Pending)
        };
        // `reader` owns the fd from here.
        #[cfg(not(windows))]
        let started = reader.start(
            shell_interp.event_loop.as_event_loop_ctx(),
            pipe.unwrap().into_raw(),
            true,
        );
        let result = match started {
            Ok(ReadResult::Pending) => {
                // TODO: are these flags correct
                #[cfg(unix)]
                reader.update_flags(|f| f.insert(bun_io::PosixFlags::SOCKET));
                self.read(shell_interp, kind, None)
            }
            Ok(result) => result,
            // Windows only. A read error, so that the `Cmd` is still alive when the child exits.
            Err(err) => ReadResult::Err(err),
        };
        shell_interp
            .run_yield_with(|interp| PipeReader::on_read_result(interp, self.cmd, kind, result));
    }

    /// The `Cmd` does not finish before `on_read_result`.
    fn read(
        &self,
        shell_interp: &ShellInterpreter,
        kind: IoKind,
        event: Option<IoEvent>,
    ) -> ReadResult {
        let event_loop = shell_interp.event_loop.as_event_loop_ctx();
        self.reader(kind)
            .read_chunks(event_loop, event, |chunk, has_more| {
                log!(
                    "PipeReader({}, {}) onReadChunk(chunk_len={}, has_more={})",
                    self.cmd,
                    io_kind_str(kind),
                    chunk.len(),
                    read_state_str(has_more)
                );
                shell_interp.run_yield_with(|interp| {
                    PipeReader::on_read_chunk(interp, self.cmd, kind, &chunk)
                });
                // The read loop re-registers the poll itself based on the bool we return.
                has_more != ReadState::Eof
            })
    }

    /// # Safety
    /// `this` must be live, and its `SubprocExec` not dropped yet. May free it.
    unsafe fn on_process_exit(this: *mut Self, status: &Status) {
        log!("onProcessExit({:x})", this as usize);
        let exit_code: Option<u8> = 'brk: {
            if let Status::Exited(exited) = &status {
                #[cfg(windows)]
                if exited.raw == bun_sys::windows::STATUS_CONTROL_C_EXIT {
                    break 'brk Some(bun_sys::SignalCode::SIGINT.to_exit_code());
                }
                break 'brk Some(exited.code);
            }

            // How it ended is not known. The command has to finish all the same.
            if matches!(status, Status::Err(_)) {
                break 'brk Some(1);
            }

            if let Some(code) = status.signal().map(|signal| signal.to_exit_code()) {
                break 'brk Some(code);
            }

            break 'brk None;
        };

        // SAFETY: caller contract. `interp` owns the `SubprocExec`.
        let (shell_interp, cmd) = unsafe { ((*this).interp.as_ref(), (*this).cmd) };
        shell_interp.run_yield_with(|interp| {
            let exec = SubprocExec::of_mut(interp, cmd);
            let interrupted =
                exec.ctrl_c_child.take().is_some() && bun_spawn::ctrl_c::child_died_of_it(status);
            let Some(code) = exit_code else {
                return Yield::suspended();
            };
            let me = interp.as_cmd_mut(cmd);
            me.base.interrupted |= interrupted;
            me.on_exit(cmd, code.into())
        });
    }
}

// ───────────────────────────────────────────────────────────────────────────
// SpawnArgs
// ───────────────────────────────────────────────────────────────────────────

pub(crate) struct SpawnArgs<'a> {
    /// Shared borrow: arena alloc methods take `&self`, and a `&'a Arena`
    /// (being `Copy`) lets `fill_env` hand back `&'a [u8]` slices without
    /// the unsafe pointer round-trip the `&'a mut Arena` reborrow forced.
    pub(crate) arena: &'a Arena,

    pub(crate) env_array: Vec<Option<CStrRef<'a>>>,
    pub(crate) stdio: [Stdio; 3],
    pub(crate) shellio: ShellIO,
    /// `> ${arraybuffer}` redirect targets; the matching `stdio` slot is `Pipe`.
    pub(crate) redirect_stdout: Option<jsc::PinnedArrayBuffer>,
    pub(crate) redirect_stderr: Option<jsc::PinnedArrayBuffer>,
    /// `PATH` in `env_array`.
    path: Option<&'a [u8]>,
    // ipc_mode: IPCMode,
    // ipc_callback: JSValue,
}

impl<'a> SpawnArgs<'a> {
    pub(crate) fn default(arena: &'a Arena) -> SpawnArgs<'a> {
        SpawnArgs {
            arena,

            env_array: Vec::new(),
            stdio: [Stdio::Ignore, Stdio::Pipe, Stdio::Inherit],
            shellio: ShellIO::default(),
            redirect_stdout: None,
            redirect_stderr: None,
            path: None,
            // .ipc_mode = IPCMode.none,
            // .ipc_callback = .zero,
        }
    }

    /// Resolve `bin` via PATH (`bun_which::which`).
    pub(crate) fn which(
        &self,
        event_loop: EventLoopHandle,
        cwd: &[u8],
        bin: &[u8],
    ) -> Option<Vec<u8>> {
        // PATH unset → fall back to _PATH_DEFPATH on POSIX (Android often
        // has no PATH). PATH="" (explicit empty) is preserved — that's a
        // deliberate "search nothing" and substituting a default would
        // change argv[0] resolution on existing platforms.
        // SAFETY: `event_loop.env()` returns the long-lived `*mut Loader`
        // owned by the VM, which nothing changes before this returns, and
        // `BUN_DEFAULT_PATH_FOR_SPAWN` is a NUL-terminated C-string constant.
        let path = self.path.unwrap_or_else(|| unsafe {
            if let Some(p) = (*event_loop.env()).get(b"PATH") {
                p
            } else if cfg!(unix) {
                core::ffi::CStr::from_ptr(BUN_DEFAULT_PATH_FOR_SPAWN).to_bytes()
            } else {
                b""
            }
        });
        let mut path_buf = bun_paths::path_buffer_pool::get();
        bun_which::which(&mut *path_buf, path, cwd, bin).map(|z| z.as_bytes().to_vec())
    }

    pub(crate) fn fill_env(&mut self, env: &EnvMap<'_>) {
        let env_iter = env.iter();
        self.env_array
            .reserve_exact(env_iter.len().saturating_sub(self.env_array.len()));

        for (key, value) in env_iter {
            let key = key.slice();
            let value = value.slice();

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
                self.path = Some(&line[b"PATH=".len()..len]);
            }

            (self.env_array).push(Some(CStrRef::from_slice_with_nul(line)));
        }
    }
}

// ───────────────────────────────────────────────────────────────────────────
// PipeReader
// ───────────────────────────────────────────────────────────────────────────

#[derive(Clone, Copy, strum::IntoStaticStr)]
enum PipeReaderState {
    Pending,
    Done,
    Err(ExitCode),
}

/// State of a read from `ShellSubprocess::stdout` or `ShellSubprocess::stderr`.
pub(crate) struct PipeReader {
    state: PipeReaderState,
    captured_writer: Option<CapturedWriter>,
    buffered_output: BufferedOutput,
}

pub(crate) enum BufferedOutput {
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

    /// Returns the bytes the command has written so far. With `2>&1 ${buf}`, the tee reads them from the `ArrayBuffer`.
    pub(crate) fn slice(&self) -> &[u8] {
        match self {
            BufferedOutput::Bytelist(b) => b.slice(),
            BufferedOutput::ArrayBuffer { buf, i } => {
                let live = buf.live_slice();
                &live[..(*i as usize).min(live.len())]
            }
        }
    }

    pub(crate) fn append(&mut self, bytes: &[u8]) {
        match self {
            BufferedOutput::Bytelist(b) => {
                let _ = b.append_slice(bytes); // OOM/capacity: fire-and-forget
            }
            BufferedOutput::ArrayBuffer { buf, i } => {
                // JS can resize the buffer between chunks.
                let array_buf_slice = buf.live_slice_mut();
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

struct CapturedWriter {
    writer: IOWriterId,
    written: usize,
    errno: Option<ExitCode>,
}

impl PipeReader {
    fn init(
        stdio: &Stdio,
        redirect_buf: Option<jsc::PinnedArrayBuffer>,
        shellio: Option<IOWriterId>,
    ) -> Option<PipeReader> {
        debug_assert!(redirect_buf.is_none() || matches!(stdio, Stdio::Pipe | Stdio::Capture));
        let capture = match stdio {
            Stdio::Pipe => None,
            Stdio::Capture => shellio,
            _ => return None,
        };
        Some(PipeReader {
            state: PipeReaderState::Pending,
            captured_writer: capture.map(|writer| CapturedWriter {
                writer,
                written: 0,
                errno: None,
            }),
            buffered_output: match redirect_buf {
                Some(buf) => BufferedOutput::ArrayBuffer { buf, i: 0 },
                None => BufferedOutput::default(),
            },
        })
    }

    #[track_caller]
    fn of_mut<'i>(interp: &'i mut Interpreter<'_>, cmd: NodeId, kind: IoKind) -> &'i mut Self {
        let pipe = SubprocExec::of_mut(interp, cmd).pipe_reader_mut(kind);
        pipe.as_mut().expect("pipe was closed")
    }

    fn is_done(&self) -> bool {
        !matches!(self.state, PipeReaderState::Pending)
            && self
                .captured_writer
                .as_ref()
                .is_none_or(|cw| cw.errno.is_some() || cw.written >= self.buffered_output.len())
    }

    fn on_read_chunk(
        interp: &mut Interpreter<'_>,
        cmd: NodeId,
        kind: IoKind,
        chunk: &[u8],
    ) -> Yield {
        let me = Self::of_mut(interp, cmd, kind);
        me.buffered_output.append(chunk);
        match me.captured_writer {
            Some(CapturedWriter {
                writer,
                errno: None,
                ..
            }) => {
                let child = io_writer::ChildPtr::new(cmd, io_writer::WriterTag::Subproc(kind));
                interp.io_writers[writer].enqueue(&mut interp.shells, child, None, chunk)
            }
            _ => Yield::suspended(),
        }
    }

    fn on_read_result(
        interp: &mut Interpreter<'_>,
        cmd: NodeId,
        kind: IoKind,
        result: ReadResult,
    ) -> Yield {
        Self::of_mut(interp, cmd, kind).state = match result {
            ReadResult::Pending => return Yield::suspended(),
            ReadResult::Done => PipeReaderState::Done,
            ReadResult::Err(err) => {
                log!("PipeReader({}) onReaderError {:?}", cmd, err);
                PipeReaderState::Err(err.to_system_error().get_errno() as ExitCode)
            }
        };
        Self::try_signal_done_to_cmd(interp, cmd, kind)
    }

    pub(crate) fn on_io_writer_chunk(
        interp: &mut Interpreter<'_>,
        cmd: NodeId,
        kind: IoKind,
        amount: usize,
        err: Option<SystemError>,
    ) -> Yield {
        let me = Self::of_mut(interp, cmd, kind);
        let cw = me
            .captured_writer
            .as_mut()
            .expect("CapturedWriter enqueued the chunk");
        cw.written += amount;
        log!(
            "CapturedWriter({}, {}) onWrite({}, has_err={}) total_written={} total_to_write={}",
            cmd,
            io_kind_str(kind),
            amount,
            err.is_some(),
            cw.written,
            me.buffered_output.len()
        );
        if let Some(e) = err {
            cw.errno = Some(e.get_errno() as ExitCode);
            let writer = cw.writer;
            // The Cmd signaled below can finish, so the chunks still queued must not call back.
            let child = io_writer::ChildPtr::new(cmd, io_writer::WriterTag::Subproc(kind));
            interp.io_writers[writer].cancel_chunks(child);
        }
        Self::try_signal_done_to_cmd(interp, cmd, kind)
    }

    /// Spec `signalDoneToCmd`.
    fn try_signal_done_to_cmd(interp: &mut Interpreter<'_>, cmd: NodeId, kind: IoKind) -> Yield {
        let exec = SubprocExec::of_mut(interp, cmd);
        let Some(me) = exec.pipe_reader_mut(kind).take_if(|me| me.is_done()) else {
            return Yield::suspended();
        };
        log!(
            "signalDoneToCmd ({}: {}) state={}",
            cmd,
            io_kind_str(kind),
            <&'static str>::from(me.state)
        );
        exec.child.reader(kind).deinit();
        let errno = match me.state {
            PipeReaderState::Err(errno) => Some(errno),
            _ => me.captured_writer.as_ref().and_then(|cw| cw.errno),
        };
        Cmd::buffered_output_close(interp, cmd, kind, me.buffered_output.slice(), errno)
    }
}

// ───────────────────────────────────────────────────────────────────────────
// StdioKind & helpers
// ───────────────────────────────────────────────────────────────────────────

unsafe extern "C" {
    // `_PATH_DEFPATH` string literal emitted from C; immutable, load-time
    // initialized, never null. Reading the pointer value has no precondition.
    pub(crate) safe static BUN_DEFAULT_PATH_FOR_SPAWN: *const c_char;
}
