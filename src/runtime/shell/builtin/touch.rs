use core::ffi::CStr;

use crate::shell::ExitCode;
use crate::shell::builtin::{Builtin, BuiltinState, IoKind, Kind};
use crate::shell::interpreter::{
    EventLoopHandle, FlagParser, Interpreter, NodeId, OutputSrc, OutputTask, OutputTaskVTable,
    ParseFlagResult, ShellTask, parse_flags, unsupported_flag,
};
use crate::shell::io_writer::{ChildPtr, WriterTag};
use crate::shell::yield_::Yield;

#[derive(Default)]
pub struct Touch {
    pub opts: Opts,
    pub state: State,
}

#[derive(Default)]
pub enum State {
    #[default]
    Idle,
    Exec(ExecState),
    WaitingWriteErr,
    Done,
}

pub struct ExecState {
    pub started: bool,
    pub tasks_count: usize,
    pub tasks_done: usize,
    pub output_done: usize,
    pub output_waiting: usize,
    /// Index into argv where filepath args start.
    pub args_start: usize,
    pub err: Option<bun_sys::Error>,
    /// FIFO of in-flight OutputTask pointers awaiting an IOWriter chunk
    /// completion. Stopgap until `WriterTag` can carry the `*mut OutputTask`
    /// directly — see mkdir.rs `Exec::output_queue` for rationale.
    pub output_queue: std::collections::VecDeque<*mut OutputTask<Touch>>,
}

impl Touch {
    pub fn start(interp: &Interpreter, cmd: NodeId) -> Yield {
        let mut opts = Opts::default();
        let args_start = {
            let args = Builtin::of(interp, cmd).args_slice();
            match parse_flags(&mut opts, args) {
                Ok(Some(rest)) => args.len() - rest.len(),
                Ok(None) => {
                    Self::state_mut(interp, cmd).state = State::WaitingWriteErr;
                    return Builtin::write_failing_error(
                        interp,
                        cmd,
                        Kind::Touch.usage_string(),
                        1,
                    );
                }
                Err(e) => {
                    return Builtin::fail_parse(interp, cmd, Kind::Touch, e, || {
                        Self::state_mut(interp, cmd).state = State::WaitingWriteErr
                    });
                }
            }
        };
        Self::state_mut(interp, cmd).opts = opts;
        Self::state_mut(interp, cmd).state = State::Exec(ExecState {
            started: false,
            tasks_count: 0,
            tasks_done: 0,
            output_done: 0,
            output_waiting: 0,
            args_start,
            err: None,
            output_queue: std::collections::VecDeque::new(),
        });
        Self::next(interp, cmd)
    }

    pub fn next(interp: &Interpreter, cmd: NodeId) -> Yield {
        enum Action {
            Done(ExitCode),
            Schedule(usize),
        }
        let action = match &mut Self::state_mut(interp, cmd).state {
            State::Idle => panic!("Invalid state"),
            State::Exec(exec) => {
                if exec.started {
                    if exec.tasks_done >= exec.tasks_count
                        && exec.output_done >= exec.output_waiting
                    {
                        let code: ExitCode = if exec.err.is_some() { 1 } else { 0 };
                        exec.err = None;
                        Action::Done(code)
                    } else {
                        return Yield::suspended();
                    }
                } else {
                    exec.started = true;
                    Action::Schedule(exec.args_start)
                }
            }
            State::WaitingWriteErr => return Yield::failed(),
            State::Done => return Builtin::done(interp, cmd, 0),
        };
        match action {
            Action::Done(code) => {
                Self::state_mut(interp, cmd).state = State::Done;
                Builtin::done(interp, cmd, code)
            }
            Action::Schedule(args_start) => {
                let argc = Builtin::of(interp, cmd).args_slice().len();
                if let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state {
                    exec.tasks_count = argc - args_start;
                }
                let opts = Self::state_mut(interp, cmd).opts;
                let cwd = Builtin::shell(interp, cmd).cwd().to_vec();
                let evtloop = Builtin::event_loop(interp, cmd);
                let interp_ptr: *mut Interpreter = interp.as_ctx_ptr();
                for i in args_start..argc {
                    let path = Builtin::of(interp, cmd).arg_bytes(i).to_vec();
                    let task =
                        ShellTouchTask::create(cmd, opts, path, cwd.clone(), evtloop, interp_ptr);
                    // SAFETY: freshly heap-allocated.
                    unsafe { ShellTask::schedule(task) };
                }
                Yield::suspended()
            }
        }
    }

    pub fn on_io_writer_chunk(
        interp: &Interpreter,
        cmd: NodeId,
        written: usize,
        e: Option<bun_sys::SystemError>,
    ) -> Yield {
        if matches!(Self::state_mut(interp, cmd).state, State::WaitingWriteErr) {
            return Builtin::done(interp, cmd, 1);
        }
        let pending = if let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state {
            exec.output_queue.pop_front()
        } else {
            None
        };
        if let Some(task) = pending {
            // SAFETY: `task` was heap-allocated in `OutputTask::new` and
            // pushed by `write_err`/`write_out`; not yet freed.
            return unsafe { OutputTask::<Touch>::on_io_writer_chunk(task, interp, written, e) };
        }
        Self::next(interp, cmd)
    }

    /// Spec: touch.zig `onShellTouchTaskDone`.
    pub fn on_shell_touch_task_done(interp: &Interpreter, cmd: NodeId, task: *mut ShellTouchTask) {
        // SAFETY: task was heap-allocated in create(); reclaim.
        let mut task = unsafe { bun_core::heap::take(task) };
        if let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state {
            exec.tasks_done += 1;
        }
        if let Some(e) = task.err.take() {
            let output_task = OutputTask::<Touch>::new(cmd, OutputSrc::Arrlist(Vec::new()));
            let errstr = Builtin::task_error_to_string(interp, cmd, Kind::Touch, &e).to_vec();
            if let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state {
                exec.err = Some(e);
            }
            OutputTask::<Touch>::start(output_task, interp, Some(&errstr)).run(interp);
            return;
        }
        Self::next(interp, cmd).run(interp);
    }
}

pub type ShellTouchOutputTask = OutputTask<Touch>;

impl OutputTaskVTable for Touch {
    fn write_err(
        interp: &Interpreter,
        cmd: NodeId,
        child: *mut OutputTask<Self>,
        errbuf: &[u8],
    ) -> Option<Yield> {
        if let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state {
            exec.output_waiting += 1;
        }
        if let Some(safeguard) = Builtin::of(interp, cmd).stderr.needs_io() {
            // Stash so on_io_writer_chunk can route to the OutputTask state
            // machine and reclaim the box (stopgap for missing WriterTag).
            if let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state {
                exec.output_queue.push_back(child);
            }
            let childptr = ChildPtr::new(cmd, WriterTag::Builtin);
            return Some(
                Builtin::of_mut(interp, cmd)
                    .stderr
                    .enqueue(childptr, errbuf, safeguard),
            );
        }
        let _ = Builtin::write_no_io(interp, cmd, IoKind::Stderr, errbuf);
        None
    }
    fn on_write_err(interp: &Interpreter, cmd: NodeId) {
        if let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state {
            exec.output_done += 1;
        }
    }
    fn write_out(
        interp: &Interpreter,
        cmd: NodeId,
        child: *mut OutputTask<Self>,
        output: &mut OutputSrc,
    ) -> Option<Yield> {
        if let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state {
            exec.output_waiting += 1;
        }
        if let Some(safeguard) = Builtin::of(interp, cmd).stdout.needs_io() {
            if let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state {
                exec.output_queue.push_back(child);
            }
            let childptr = ChildPtr::new(cmd, WriterTag::Builtin);
            let buf = output.slice().to_vec();
            return Some(
                Builtin::of_mut(interp, cmd)
                    .stdout
                    .enqueue(childptr, &buf, safeguard),
            );
        }
        let buf = output.slice().to_vec();
        let _ = Builtin::write_no_io(interp, cmd, IoKind::Stdout, &buf);
        None
    }
    fn on_write_out(interp: &Interpreter, cmd: NodeId) {
        if let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state {
            exec.output_done += 1;
        }
    }
    fn on_done(interp: &Interpreter, cmd: NodeId) -> Yield {
        Self::next(interp, cmd)
    }
}

/// Spec: touch.zig `ShellTouchTask`. utimes() the path (creating it on
/// ENOENT) on a worker thread.
pub struct ShellTouchTask {
    pub cmd: NodeId,
    pub opts: Opts,
    pub filepath: Vec<u8>,
    pub cwd_path: Vec<u8>,
    pub err: Option<bun_sys::Error>,
    pub task: ShellTask,
}

impl ShellTouchTask {
    pub fn create(
        cmd: NodeId,
        opts: Opts,
        filepath: Vec<u8>,
        cwd_path: Vec<u8>,
        evtloop: EventLoopHandle,
        interp: *mut Interpreter,
    ) -> *mut ShellTouchTask {
        let mut task = Box::new(ShellTouchTask {
            cmd,
            opts,
            filepath,
            cwd_path,
            err: None,
            task: ShellTask::new(evtloop),
        });
        task.task.interp = interp;
        bun_core::heap::into_raw(task)
    }

    /// Spec: touch.zig `runFromThreadPool`. utimes() the path; on ENOENT
    /// fall back to `open(O_CREAT|O_WRONLY, 0o664)`.
    pub fn run_from_thread_pool(this: &mut ShellTouchTask) {
        use bun_paths::resolve_path::{self, Platform, platform};
        use bun_sys::FdExt as _;
        // We have to give an absolute path.
        let mut buf = bun_paths::PathBuffer::uninit();
        let filepath: &bun_core::ZStr = if Platform::AUTO.is_absolute(&this.filepath) {
            // Re-terminate into the path buffer (`filepath` is the bare argv
            // bytes without the trailing NUL).
            resolve_path::join_z_buf::<platform::Auto>(buf.as_mut_slice(), &[&this.filepath])
        } else {
            resolve_path::join_z_buf::<platform::Auto>(
                buf.as_mut_slice(),
                &[&this.cwd_path, &this.filepath],
            )
        };

        // Zig went via `NodeFS{}.utimes(args, .sync)`; that wrapper just
        // forwards to `Syscall.utimens` (uv_fs_utime on Windows), so call
        // the bun_sys layer directly to avoid the heavyweight NodeFS state.
        let milliseconds = bun_core::time::milli_timestamp();
        let atime = bun_sys::TimeLike {
            sec: milliseconds.div_euclid(1_000),
            nsec: milliseconds.rem_euclid(1_000) * 1_000_000,
        };
        let mtime = atime;
        if let Err(err) = bun_sys::utimens(filepath, atime, mtime) {
            'out: {
                if err.get_errno() == bun_sys::E::ENOENT {
                    const PERM: bun_sys::Mode = 0o664;
                    match bun_sys::open(filepath, bun_sys::O::CREAT | bun_sys::O::WRONLY, PERM) {
                        Ok(fd) => {
                            fd.close();
                            break 'out;
                        }
                        Err(e) => {
                            this.err = Some(e.with_path(filepath.as_bytes()));
                            break 'out;
                        }
                    }
                }
                this.err = Some(err.with_path(filepath.as_bytes()));
            }
        }
        // Worker→main bounce-back is posted by `shell_task_trampoline` after
        // this returns (Zig: `event_loop.enqueueTaskConcurrent(...)`).
    }

    pub fn run_from_main_thread(this: *mut ShellTouchTask, interp: &Interpreter) {
        // SAFETY: `this` is a live heap-allocated task.
        let cmd = unsafe { (*this).cmd };
        Touch::on_shell_touch_task_done(interp, cmd, this);
    }
}

impl bun_event_loop::Taskable for ShellTouchTask {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::ShellTouchTask;
}

impl crate::shell::interpreter::ShellTaskCtx for ShellTouchTask {
    const TASK_OFFSET: usize = core::mem::offset_of!(Self, task);
    fn run_from_thread_pool(this: &mut Self) {
        Self::run_from_thread_pool(this)
    }
    fn run_from_main_thread(this: *mut Self, interp: &Interpreter) {
        Self::run_from_main_thread(this, interp)
    }
}

#[derive(Clone, Copy, Default)]
pub struct Opts {
    /// `-a` — change only the access time
    pub access_time_only: bool,
    /// `-c`, `--no-create` — do not create any files
    pub no_create: bool,
    /// `-h`, `--no-dereference` — affect each symbolic link instead of any
    /// referenced file
    pub no_dereference: bool,
    /// `-m` — change only the modification time
    pub modification_time_only: bool,
}

impl FlagParser for Opts {
    fn parse_long(&mut self, flag: &[u8]) -> Option<ParseFlagResult> {
        match flag {
            b"--no-create" => Some(ParseFlagResult::Unsupported(unsupported_flag(
                b"--no-create",
            ))),
            b"--date" => Some(ParseFlagResult::Unsupported(unsupported_flag(b"--date"))),
            b"--reference" => Some(ParseFlagResult::Unsupported(unsupported_flag(
                b"--reference=FILE",
            ))),
            b"--time" => Some(ParseFlagResult::Unsupported(unsupported_flag(
                b"--reference=FILE",
            ))),
            _ => None,
        }
    }

    fn parse_short(&mut self, ch: u8, smallflags: &[u8], i: usize) -> Option<ParseFlagResult> {
        match ch {
            b'a' => Some(ParseFlagResult::Unsupported(unsupported_flag(b"-a"))),
            b'c' => Some(ParseFlagResult::Unsupported(unsupported_flag(b"-c"))),
            b'd' => Some(ParseFlagResult::Unsupported(unsupported_flag(b"-d"))),
            b'h' => Some(ParseFlagResult::Unsupported(unsupported_flag(b"-h"))),
            b'm' => Some(ParseFlagResult::Unsupported(unsupported_flag(b"-m"))),
            b'r' => Some(ParseFlagResult::Unsupported(unsupported_flag(b"-r"))),
            b't' => Some(ParseFlagResult::Unsupported(unsupported_flag(b"-t"))),
            _ => Some(ParseFlagResult::IllegalOption(
                &raw const smallflags[1 + i..],
            )),
        }
    }
}

// ported from: src/shell/builtin/touch.zig
