use crate::shell::ExitCode;
use crate::shell::builtin::{Builtin, BuiltinState, IoKind, Kind};
use crate::shell::interpreter::{
    FlagParser, Interpreter, NodeId, OutputSrc, OutputTask, OutputTaskVTable, OutputWrite,
    ParseFlagResult, ShellTask, unsupported_flag,
};
use crate::shell::io_writer::{ChildPtr, WriterTag};
use crate::shell::yield_::Yield;

#[derive(Default)]
pub struct Touch {
    pub(crate) state: State,
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
    pub(crate) started: bool,
    pub(crate) tasks_count: usize,
    pub(crate) tasks_done: usize,
    pub(crate) output_done: usize,
    pub(crate) output_waiting: usize,
    /// Index into argv where filepath args start.
    pub(crate) args_start: usize,
    pub(crate) err: Option<bun_sys::Error>,
    /// FIFO of in-flight OutputTasks awaiting an IOWriter chunk completion —
    /// see mkdir.rs `Exec::output_queue` for rationale.
    pub(crate) output_queue: std::collections::VecDeque<Box<OutputTask<Touch>>>,
}

impl Touch {
    pub(crate) fn start(interp: &Interpreter, cmd: NodeId) -> Yield {
        let mut opts = Opts::default();
        let args_start = {
            match Builtin::parse_flags(interp, cmd, &mut opts) {
                Ok(Some(start)) => start,
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
                    return Builtin::fail_parse(interp, cmd, Kind::Touch, &e, || {
                        Self::state_mut(interp, cmd).state = State::WaitingWriteErr
                    });
                }
            }
        };
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

    fn next(interp: &Interpreter, cmd: NodeId) -> Yield {
        enum Action {
            Done(ExitCode),
            Schedule(usize),
            Suspend,
            Failed,
            AlreadyDone,
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
                        Action::Suspend
                    }
                } else {
                    exec.started = true;
                    Action::Schedule(exec.args_start)
                }
            }
            State::WaitingWriteErr => Action::Failed,
            State::Done => Action::AlreadyDone,
        };
        match action {
            Action::Suspend => Yield::suspended(),
            Action::Failed => Yield::failed(),
            Action::AlreadyDone => Builtin::done(interp, cmd, 0),
            Action::Done(code) => {
                Self::state_mut(interp, cmd).state = State::Done;
                Builtin::done(interp, cmd, code)
            }
            Action::Schedule(args_start) => {
                let argc = Builtin::argc(interp, cmd);
                if let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state {
                    exec.tasks_count = argc - args_start;
                }
                let cwd = Builtin::shell(interp, cmd).borrow().cwd().to_vec();
                for i in args_start..argc {
                    let path = Builtin::of(interp, cmd).arg_bytes(i).to_vec();
                    let task = ShellTouchTask::create(cmd, path, cwd.clone(), interp);
                    ShellTask::schedule(task);
                }
                Yield::suspended()
            }
        }
    }

    pub(crate) fn on_io_writer_chunk(
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
            return OutputTask::<Touch>::on_io_writer_chunk(task, interp, written, e);
        }
        Self::next(interp, cmd)
    }

    fn on_shell_touch_task_done(interp: &Interpreter, cmd: NodeId, mut task: ShellTouchTask) {
        if let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state {
            exec.tasks_done += 1;
        }
        if let Some(e) = task.err.take() {
            let output_task = OutputTask::<Touch>::new(cmd, OutputSrc::Arrlist(Vec::new()));
            let errstr = Builtin::task_error_to_string(Kind::Touch, &e);
            if let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state {
                exec.err = Some(e);
            }
            OutputTask::<Touch>::start(output_task, interp, Some(&errstr)).run(interp);
            return;
        }
        Self::next(interp, cmd).run(interp);
    }
}

impl OutputTaskVTable for Touch {
    fn write_err(
        interp: &Interpreter,
        cmd: NodeId,
        child: Box<OutputTask<Self>>,
        errbuf: &[u8],
    ) -> OutputWrite<Self> {
        if let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state {
            exec.output_waiting += 1;
        }
        let stderr_needs_io = Builtin::of(interp, cmd).stderr.needs_io();
        if let Some(safeguard) = stderr_needs_io {
            // Park it so on_io_writer_chunk can route the completion back to
            // the OutputTask state machine (there is no WriterTag for it).
            if let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state {
                exec.output_queue.push_back(child);
            }
            let childptr = ChildPtr::new(cmd, WriterTag::Builtin);
            return OutputWrite::Enqueued(Builtin::write_out(
                interp,
                cmd,
                IoKind::Stderr,
                childptr,
                errbuf,
                safeguard,
            ));
        }
        let _ = Builtin::write_no_io(interp, cmd, IoKind::Stderr, errbuf);
        OutputWrite::Done(child)
    }
    fn on_write_err(interp: &Interpreter, cmd: NodeId) {
        if let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state {
            exec.output_done += 1;
        }
    }
    fn write_out(
        interp: &Interpreter,
        cmd: NodeId,
        child: Box<OutputTask<Self>>,
    ) -> OutputWrite<Self> {
        if let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state {
            exec.output_waiting += 1;
        }
        let stdout_needs_io = Builtin::of(interp, cmd).stdout.needs_io();
        if let Some(safeguard) = stdout_needs_io {
            let childptr = ChildPtr::new(cmd, WriterTag::Builtin);
            return OutputWrite::Enqueued(Builtin::write_out_with(
                interp,
                cmd,
                IoKind::Stdout,
                childptr,
                safeguard,
                |buf| {
                    buf.extend_from_slice(child.output.slice());
                    if let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state {
                        exec.output_queue.push_back(child);
                    }
                },
            ));
        }
        let _ = Builtin::write_no_io(interp, cmd, IoKind::Stdout, child.output.slice());
        OutputWrite::Done(child)
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

/// utimes() the path (creating it on ENOENT) on a worker thread.
pub struct ShellTouchTask {
    pub(crate) cmd: NodeId,
    pub(crate) filepath: Vec<u8>,
    pub(crate) cwd_path: Vec<u8>,
    pub(crate) err: Option<bun_sys::Error>,
    pub task: ShellTask,
}

crate::shell_task!(ShellTouchTask);

impl ShellTouchTask {
    pub(crate) fn create(
        cmd: NodeId,
        filepath: Vec<u8>,
        cwd_path: Vec<u8>,
        interp: &Interpreter,
    ) -> Box<ShellTouchTask> {
        Box::new(ShellTouchTask {
            cmd,
            filepath,
            cwd_path,
            err: None,
            task: ShellTask::new(interp),
        })
    }

    /// utimes() the path; on ENOENT
    /// fall back to `open(O_CREAT|O_WRONLY, 0o664)`.
    pub(crate) fn run_from_thread_pool(this: &mut ShellTouchTask) {
        use bun_paths::resolve_path::{self, Platform, platform};
        use bun_sys::FdExt as _;
        // We have to give an absolute path. An operand that does not fit the
        // path buffer is still passed on whole, so the OS reports ENAMETOOLONG
        // for it like for any other operand.
        let mut spill = Vec::new();
        let filepath: &bun_core::ZStr = if Platform::AUTO.is_absolute(&this.filepath) {
            // Re-terminate (`filepath` is the bare argv bytes without the
            // trailing NUL).
            resolve_path::join_z_spill::<platform::Auto>(&mut spill, &[&this.filepath])
        } else {
            resolve_path::join_z_spill::<platform::Auto>(
                &mut spill,
                &[&this.cwd_path, &this.filepath],
            )
        };

        // Call the bun_sys layer directly (uv_fs_utime on Windows) to avoid
        // the heavyweight NodeFS state.
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
        // Worker→main bounce-back is posted by `ShellTask::run_owned` after
        // this returns.
    }
}

// `runtime::dispatch::run_task`'s `task_tag::ShellTouchTask` arm reboxes the
// pointer `ShellTask::on_finish` posted; a completion that will not run drops
// the keep-alive and the box.

impl crate::shell::interpreter::ShellTaskCtx for ShellTouchTask {
    fn shell_task(&self) -> &ShellTask {
        &self.task
    }
    fn shell_task_mut(&mut self) -> &mut ShellTask {
        &mut self.task
    }
    fn run_from_thread_pool(&mut self) {
        Self::run_from_thread_pool(self)
    }
    fn run_from_main_thread(self: Box<Self>, interp: &Interpreter) {
        let cmd = self.cmd;
        Touch::on_shell_touch_task_done(interp, cmd, *self);
    }
}

#[derive(Clone, Copy, Default)]
pub struct Opts {}

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
            _ => Some(ParseFlagResult::IllegalOption(smallflags[1 + i..].into())),
        }
    }
}
