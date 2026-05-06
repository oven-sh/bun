use core::ffi::CStr;

use crate::shell::builtin::{Builtin, IoKind, Kind};
use crate::shell::interpreter::{
    parse_flags, unsupported_flag, EventLoopHandle, FlagParser, Interpreter, NodeId, OutputSrc,
    OutputTask, OutputTaskVTable, ParseError, ParseFlagResult, ShellTask,
};
use crate::shell::io_writer::{ChildPtr, WriterTag};
use crate::shell::yield_::Yield;
use crate::shell::ExitCode;

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
    pub fn start(interp: &mut Interpreter, cmd: NodeId) -> Yield {
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
                Err(e) => return Self::fail_parse(interp, cmd, e),
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

    fn fail_parse(interp: &mut Interpreter, cmd: NodeId, e: ParseError) -> Yield {
        let buf: Vec<u8> = match e {
            ParseError::IllegalOption(s) => Builtin::fmt_error_arena(
                interp,
                cmd,
                Some(Kind::Touch),
                // SAFETY: payload borrows argv or is 'static.
                format_args!("illegal option -- {}\n", bstr::BStr::new(unsafe { &*s })),
            )
            .to_vec(),
            ParseError::ShowUsage => Kind::Touch.usage_string().to_vec(),
            ParseError::Unsupported(s) => Builtin::fmt_error_arena(
                interp,
                cmd,
                Some(Kind::Touch),
                format_args!(
                    "unsupported option, please open a GitHub issue -- {}\n",
                    // SAFETY: see above.
                    bstr::BStr::new(unsafe { &*s })
                ),
            )
            .to_vec(),
        };
        Self::state_mut(interp, cmd).state = State::WaitingWriteErr;
        Builtin::write_failing_error(interp, cmd, &buf, 1)
    }

    pub fn next(interp: &mut Interpreter, cmd: NodeId) -> Yield {
        enum Action { Done(ExitCode), Schedule(usize) }
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
                for i in args_start..argc {
                    let p = Builtin::of(interp, cmd).args_slice()[i];
                    // SAFETY: argv entries are NUL-terminated.
                    let path = unsafe { CStr::from_ptr(p) }.to_bytes().to_vec();
                    let task = ShellTouchTask::create(cmd, opts, path, cwd.clone(), evtloop);
                    // SAFETY: freshly Box::into_raw'd.
                    unsafe { ShellTask::schedule(task) };
                }
                Yield::suspended()
            }
        }
    }

    pub fn on_io_writer_chunk(
        interp: &mut Interpreter,
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
            // SAFETY: `task` was Box::into_raw'd in `OutputTask::new` and
            // pushed by `write_err`/`write_out`; not yet freed.
            return unsafe { OutputTask::<Touch>::on_io_writer_chunk(task, interp, written, e) };
        }
        Self::next(interp, cmd)
    }

    /// Spec: touch.zig `onShellTouchTaskDone`.
    pub fn on_shell_touch_task_done(
        interp: &mut Interpreter,
        cmd: NodeId,
        task: *mut ShellTouchTask,
    ) {
        // SAFETY: task was Box::into_raw'd in create(); reclaim.
        let mut task = unsafe { Box::from_raw(task) };
        if let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state {
            exec.tasks_done += 1;
        }
        if let Some(e) = task.err.take() {
            let output_task = OutputTask::<Touch>::new(cmd, OutputSrc::Arrlist(Vec::new()));
            let errstr = Builtin::task_error_to_string(interp, cmd, Kind::Touch, &e).to_vec();
            if let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state {
                exec.err = Some(e);
            }
            // SAFETY: freshly allocated.
            unsafe { OutputTask::<Touch>::start(output_task, interp, Some(&errstr)) }.run(interp);
            return;
        }
        Self::next(interp, cmd).run(interp);
    }

    #[inline]
    fn state_mut(interp: &mut Interpreter, cmd: NodeId) -> &mut Touch {
        match &mut Builtin::of_mut(interp, cmd).impl_ {
            crate::shell::builtin::Impl::Touch(t) => &mut **t,
            _ => unreachable!(),
        }
    }
}

pub type ShellTouchOutputTask = OutputTask<Touch>;

impl OutputTaskVTable for Touch {
    fn write_err(
        interp: &mut Interpreter,
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
        Builtin::write_no_io(interp, cmd, IoKind::Stderr, errbuf);
        None
    }
    fn on_write_err(interp: &mut Interpreter, cmd: NodeId) {
        if let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state {
            exec.output_done += 1;
        }
    }
    fn write_out(
        interp: &mut Interpreter,
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
        Builtin::write_no_io(interp, cmd, IoKind::Stdout, &buf);
        None
    }
    fn on_write_out(interp: &mut Interpreter, cmd: NodeId) {
        if let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state {
            exec.output_done += 1;
        }
    }
    fn on_done(interp: &mut Interpreter, cmd: NodeId) -> Yield {
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
    ) -> *mut ShellTouchTask {
        Box::into_raw(Box::new(ShellTouchTask {
            cmd,
            opts,
            filepath,
            cwd_path,
            err: None,
            task: ShellTask::new(evtloop),
        }))
    }

    /// Spec: touch.zig `runFromThreadPool`.
    pub fn run_from_thread_pool(this: *mut ShellTouchTask) {
        // SAFETY: `this` is a live Box::into_raw'd task.
        let this = unsafe { &mut *this };
        // TODO(b2-blocked): bun_paths::join_z, NodeFS::utimes, bun_sys::open —
        // the actual touch is `utimes(path)` falling back to
        // `open(O_CREAT|O_WRONLY)` on ENOENT.
        let _ = (&this.filepath, &this.cwd_path, this.opts);
        this.task.on_finish();
    }

    pub fn run_from_main_thread(this: *mut ShellTouchTask, interp: &mut Interpreter) {
        // SAFETY: `this` is a live Box::into_raw'd task.
        let cmd = unsafe { (*this).cmd };
        Touch::on_shell_touch_task_done(interp, cmd, this);
    }
}

impl crate::shell::interpreter::ShellTaskCtx for ShellTouchTask {
    const TASK_OFFSET: usize = core::mem::offset_of!(Self, task);
    fn run_from_thread_pool(this: *mut Self) { Self::run_from_thread_pool(this) }
    fn run_from_main_thread(this: *mut Self, interp: &mut Interpreter) {
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
            b"--no-create" => Some(ParseFlagResult::Unsupported(unsupported_flag(b"--no-create"))),
            b"--date" => Some(ParseFlagResult::Unsupported(unsupported_flag(b"--date"))),
            b"--reference" => {
                Some(ParseFlagResult::Unsupported(unsupported_flag(b"--reference=FILE")))
            }
            b"--time" => {
                Some(ParseFlagResult::Unsupported(unsupported_flag(b"--reference=FILE")))
            }
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
            _ => Some(ParseFlagResult::IllegalOption(&smallflags[1 + i..] as *const [u8])),
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/builtin/touch.zig (414 lines)
//   confidence: medium (NodeId style; thread-pool body stubbed)
//   blocked_on: NodeFS::utimes, bun_sys::open, WorkPool, IOWriter::enqueue body
// ──────────────────────────────────────────────────────────────────────────
