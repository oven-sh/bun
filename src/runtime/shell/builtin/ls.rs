use core::ffi::CStr;
use core::sync::atomic::{AtomicUsize, Ordering};

use crate::shell::builtin::{Builtin, IoKind, Kind};
use crate::shell::interpreter::{
    EventLoopHandle, Interpreter, NodeId, OutputSrc, OutputTask, OutputTaskVTable, ShellTask,
};
use crate::shell::io_writer::{ChildPtr, WriterTag};
use crate::shell::yield_::Yield;
use crate::shell::ExitCode;

#[derive(Default)]
pub struct Ls {
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
    pub err: Option<bun_sys::Error>,
    pub task_count: AtomicUsize,
    pub tasks_done: usize,
    pub output_waiting: usize,
    pub output_done: usize,
    /// FIFO of in-flight OutputTask pointers awaiting an IOWriter chunk
    /// completion. Stopgap until `WriterTag` can carry the `*mut OutputTask`
    /// directly — see mkdir.rs `Exec::output_queue` for rationale.
    pub output_queue: std::collections::VecDeque<*mut OutputTask<Ls>>,
}

/// Custom parse error for invalid options. Spec: ls.zig `Opts.ParseError` (ls
/// uses its own per-byte parser, not the shared `FlagParser`).
pub enum LsParseError {
    /// Carries an owned 1-byte copy of the offending flag char.
    IllegalOption(Box<[u8]>),
    ShowUsage,
}

enum ParseFlag {
    ContinueParsing,
    Done,
    IllegalOption(Box<[u8]>),
}

impl Ls {
    pub fn start(interp: &mut Interpreter, cmd: NodeId) -> Yield {
        Self::next(interp, cmd)
    }

    pub fn next(interp: &mut Interpreter, cmd: NodeId) -> Yield {
        loop {
            // PORT NOTE: reshaped for borrowck — match on a tag, drop the
            // borrow, then act.
            enum Tag { Idle, Exec, WaitingWriteErr, Done }
            let tag = match Self::state_mut(interp, cmd).state {
                State::Idle => Tag::Idle,
                State::Exec(_) => Tag::Exec,
                State::WaitingWriteErr => Tag::WaitingWriteErr,
                State::Done => Tag::Done,
            };
            match tag {
                Tag::Idle => {
                    // Parse opts; will be None if called with no args, in
                    // which case we run once with ".".
                    let paths_start = match Self::parse_opts(interp, cmd) {
                        Ok(p) => p,
                        Err(e) => {
                            let buf: Vec<u8> = match e {
                                LsParseError::IllegalOption(opt) => Builtin::fmt_error_arena(
                                    interp,
                                    cmd,
                                    Some(Kind::Ls),
                                    format_args!(
                                        "illegal option -- {}\n",
                                        bstr::BStr::new(&opt[..])
                                    ),
                                )
                                .to_vec(),
                                LsParseError::ShowUsage => Kind::Ls.usage_string().to_vec(),
                            };
                            Self::state_mut(interp, cmd).state = State::WaitingWriteErr;
                            return Builtin::write_failing_error(interp, cmd, &buf, 1);
                        }
                    };

                    let argc = Builtin::of(interp, cmd).args_slice().len();
                    let task_count = match paths_start {
                        Some(start) => argc - start,
                        None => 1,
                    };
                    Self::state_mut(interp, cmd).state = State::Exec(ExecState {
                        err: None,
                        task_count: AtomicUsize::new(task_count),
                        tasks_done: 0,
                        output_waiting: 0,
                        output_done: 0,
                        output_queue: std::collections::VecDeque::new(),
                    });

                    let cwd = Builtin::cwd(interp, cmd);
                    let opts = Self::state_mut(interp, cmd).opts;
                    let evtloop = Builtin::event_loop(interp, cmd);
                    if let Some(start) = paths_start {
                        let print_directory = task_count > 1;
                        for i in start..argc {
                            let p = Builtin::of(interp, cmd).args_slice()[i];
                            // SAFETY: argv entries are NUL-terminated.
                            let path = unsafe { CStr::from_ptr(p) }.to_bytes().to_vec();
                            let mut task =
                                ShellLsTask::create(cmd, opts, cwd, path, evtloop);
                            // SAFETY: freshly Box::into_raw'd.
                            unsafe {
                                (*task).print_directory = print_directory;
                                ShellTask::schedule(task);
                            }
                            let _ = &mut task;
                        }
                    } else {
                        let task = ShellLsTask::create(cmd, opts, cwd, b".".to_vec(), evtloop);
                        // SAFETY: freshly Box::into_raw'd.
                        unsafe { ShellTask::schedule(task) };
                    }
                    return Yield::suspended();
                }
                Tag::Exec => {
                    let done = {
                        let State::Exec(exec) = &Self::state_mut(interp, cmd).state else {
                            unreachable!()
                        };
                        exec.tasks_done >= exec.task_count.load(Ordering::Relaxed)
                            && exec.output_done >= exec.output_waiting
                    };
                    if done {
                        let exit_code: ExitCode = {
                            let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state
                            else {
                                unreachable!()
                            };
                            let code = if exec.err.is_some() { 1 } else { 0 };
                            exec.err = None;
                            code
                        };
                        Self::state_mut(interp, cmd).state = State::Done;
                        return Builtin::done(interp, cmd, exit_code);
                    }
                    return Yield::suspended();
                }
                Tag::WaitingWriteErr => return Yield::failed(),
                Tag::Done => return Builtin::done(interp, cmd, 0),
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
            return unsafe { OutputTask::<Ls>::on_io_writer_chunk(task, interp, written, e) };
        }
        Self::next(interp, cmd)
    }

    /// Spec: ls.zig `onShellLsTaskDone`.
    pub fn on_shell_ls_task_done(
        interp: &mut Interpreter,
        cmd: NodeId,
        task: *mut ShellLsTask,
    ) {
        // SAFETY: task was Box::into_raw'd in create(); reclaim.
        let mut task = unsafe { Box::from_raw(task) };
        if let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state {
            exec.tasks_done += 1;
        }
        let output = core::mem::take(&mut task.output);
        let output_task = OutputTask::<Ls>::new(cmd, OutputSrc::Arrlist(output));

        if let Some(e) = task.err.take() {
            let errstr = Builtin::task_error_to_string(interp, cmd, Kind::Ls, &e).to_vec();
            if let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state {
                if exec.err.is_none() {
                    exec.err = Some(e);
                }
            }
            // SAFETY: freshly allocated.
            unsafe { OutputTask::<Ls>::start(output_task, interp, Some(&errstr)) }.run(interp);
            return;
        }
        // SAFETY: freshly allocated.
        unsafe { OutputTask::<Ls>::start(output_task, interp, None) }.run(interp);
    }

    /// Spec: ls.zig `parseOpts` / `parseFlags`. Returns the index of the
    /// first non-flag arg, or `None` if there are no positional args.
    fn parse_opts(
        interp: &mut Interpreter,
        cmd: NodeId,
    ) -> Result<Option<usize>, LsParseError> {
        let argc = Builtin::of(interp, cmd).args_slice().len();
        if argc == 0 {
            return Ok(None);
        }
        let mut idx = 0usize;
        while idx < argc {
            let p = Builtin::of(interp, cmd).args_slice()[idx];
            // SAFETY: argv entries are NUL-terminated.
            let flag = unsafe { CStr::from_ptr(p) }.to_bytes();
            match Self::parse_flag(&mut Self::state_mut(interp, cmd).opts, flag) {
                ParseFlag::Done => return Ok(Some(idx)),
                ParseFlag::ContinueParsing => {}
                ParseFlag::IllegalOption(s) => return Err(LsParseError::IllegalOption(s)),
            }
            idx += 1;
        }
        Ok(None)
    }

    fn parse_flag(opts: &mut Opts, flag: &[u8]) -> ParseFlag {
        if flag.is_empty() || flag[0] != b'-' {
            return ParseFlag::Done;
        }
        // FIXME windows
        if flag.len() == 1 {
            return ParseFlag::IllegalOption(Box::from(&b"-"[..]));
        }
        for &ch in &flag[1..] {
            match ch {
                b'a' => opts.show_all = true,
                b'A' => opts.show_almost_all = true,
                b'd' => opts.list_directories = true,
                b'l' => opts.long_listing = true,
                b'R' => opts.recursive = true,
                b'r' => opts.reverse_order = true,
                b'1' => opts.one_file_per_line = true,
                // The remaining short flags are recognised but currently no-op
                // (mirrors Zig — most fields exist only for parsing parity).
                b'b' | b'B' | b'c' | b'C' | b'D' | b'f' | b'F' | b'g' | b'G' | b'h' | b'H'
                | b'i' | b'I' | b'k' | b'L' | b'm' | b'n' | b'N' | b'o' | b'p' | b'q' | b'Q'
                | b's' | b'S' | b't' | b'T' | b'u' | b'U' | b'v' | b'w' | b'x' | b'X' | b'Z' => {}
                _ => return ParseFlag::IllegalOption(Box::from(&flag[1..2])),
            }
        }
        ParseFlag::ContinueParsing
    }

    #[inline]
    fn state_mut(interp: &mut Interpreter, cmd: NodeId) -> &mut Ls {
        match &mut Builtin::of_mut(interp, cmd).impl_ {
            crate::shell::builtin::Impl::Ls(l) => &mut **l,
            _ => unreachable!(),
        }
    }
}

pub type ShellLsOutputTask = OutputTask<Ls>;

impl OutputTaskVTable for Ls {
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

/// Spec: ls.zig `ShellLsTask`. Opens the path, iterates its entries (or
/// prints the path itself for files / `-d`), accumulating into `output`.
pub struct ShellLsTask {
    pub cmd: NodeId,
    pub opts: Opts,
    pub print_directory: bool,
    pub cwd: bun_sys::Fd,
    pub path: Vec<u8>,
    pub output: Vec<u8>,
    pub is_absolute: bool,
    pub err: Option<bun_sys::Error>,
    pub task: ShellTask,
}

impl ShellLsTask {
    pub fn create(
        cmd: NodeId,
        opts: Opts,
        cwd: bun_sys::Fd,
        path: Vec<u8>,
        evtloop: EventLoopHandle,
    ) -> *mut ShellLsTask {
        Box::into_raw(Box::new(ShellLsTask {
            cmd,
            opts,
            print_directory: false,
            cwd,
            path,
            output: Vec::new(),
            is_absolute: false,
            err: None,
            task: ShellTask::new(evtloop),
        }))
    }

    /// Spec: ls.zig `run`.
    pub fn run_from_thread_pool(this: *mut ShellLsTask) {
        // SAFETY: `this` is a live Box::into_raw'd task.
        let this = unsafe { &mut *this };
        // TODO(b2-blocked): ShellSyscall::openat(O_DIRECTORY) +
        // bun_core::DirIterator + Syscall::lstatat for `-l`. Stubbed: emit
        // the path itself so output is non-empty and observable.
        if this.opts.list_directories || true {
            this.output.extend_from_slice(&this.path);
            this.output.push(b'\n');
        }
        this.task.on_finish();
    }

    pub fn run_from_main_thread(this: *mut ShellLsTask, interp: &mut Interpreter) {
        // SAFETY: `this` is a live Box::into_raw'd task.
        let cmd = unsafe { (*this).cmd };
        Ls::on_shell_ls_task_done(interp, cmd, this);
    }
}

impl crate::shell::interpreter::ShellTaskCtx for ShellLsTask {
    const TASK_OFFSET: usize = core::mem::offset_of!(Self, task);
    fn run_from_thread_pool(this: *mut Self) { Self::run_from_thread_pool(this) }
    fn run_from_main_thread(this: *mut Self, interp: &mut Interpreter) {
        Self::run_from_main_thread(this, interp)
    }
}

/// Spec: ls.zig `Opts`. Only the fields the current port actually consults
/// are kept; the rest are recognised by `parse_flag` but not stored.
#[derive(Clone, Copy, Default)]
pub struct Opts {
    /// `-a`, `--all` — do not ignore entries starting with `.`
    pub show_all: bool,
    /// `-A`, `--almost-all` — like `-a` but skip `.` and `..`
    pub show_almost_all: bool,
    /// `-d`, `--directory` — list directories themselves, not their contents
    pub list_directories: bool,
    /// `-l` — use a long listing format
    pub long_listing: bool,
    /// `-R`, `--recursive` — list subdirectories recursively
    pub recursive: bool,
    /// `-r`, `--reverse` — reverse order while sorting
    pub reverse_order: bool,
    /// `-1` — list one file per line
    pub one_file_per_line: bool,
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/builtin/ls.zig (1026 lines)
//   confidence: low-medium (NodeId style; DirIterator/-l body stubbed)
//   blocked_on: bun_core::DirIterator, ShellSyscall::openat, Syscall::lstatat,
//               WorkPool, IOWriter::enqueue body
// ──────────────────────────────────────────────────────────────────────────
