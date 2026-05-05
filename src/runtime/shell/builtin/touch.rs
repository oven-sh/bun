use core::ffi::c_char;
use core::fmt;
use core::mem::offset_of;

use bstr::BStr;

use bun_jsc::{EventLoopHandle, EventLoopTask, SystemError, WorkPoolTask};
use bun_paths as resolve_path;
use bun_runtime::node::fs as node_fs;
use bun_runtime::node::TimeLike;
use crate::shell::interpreter::builtin::Result as BuiltinResult;
use crate::shell::interpreter::{
    unsupported_flag, Builtin, BuiltinImpl, BuiltinKind, FlagParser, OutputSrc, OutputTask,
    OutputTaskVTable, ParseError, ParseFlagResult,
};
use crate::shell::{ExitCode, Yield};
use bun_str::{PathString, ZStr};
use bun_sys as syscall;
use bun_threading::WorkPool;

bun_output::declare_scope!(ShellTouch, hidden);

pub struct Touch {
    pub opts: Opts,
    pub state: State,
}

#[derive(strum::IntoStaticStr)]
pub enum State {
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
    pub started_output_queue: bool,
    // TODO(port): lifetime — borrowed from Builtin::args_slice() (shell arena)
    pub args: *const [*const c_char],
    pub err: Option<SystemError>,
}

impl Default for Touch {
    fn default() -> Self {
        Self { opts: Opts::default(), state: State::Idle }
    }
}

impl Default for ExecState {
    fn default() -> Self {
        Self {
            started: false,
            tasks_count: 0,
            tasks_done: 0,
            output_done: 0,
            output_waiting: 0,
            started_output_queue: false,
            args: core::ptr::slice_from_raw_parts(core::ptr::null(), 0),
            err: None,
        }
    }
}

impl fmt::Display for Touch {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "Touch(0x{:x}, state={})",
            self as *const _ as usize,
            <&'static str>::from(&self.state),
        )
    }
}

impl Drop for Touch {
    fn drop(&mut self) {
        bun_output::scoped_log!(ShellTouch, "{} deinit", self);
    }
}

impl Touch {
    pub fn start(&mut self) -> Yield {
        let filepath_args = match self.opts.parse(self.bltn().args_slice()) {
            BuiltinResult::Ok(filepath_args) => filepath_args,
            BuiltinResult::Err(e) => {
                let buf = match e {
                    ParseError::IllegalOption(opt_str) => self.bltn().fmt_error_arena(
                        BuiltinKind::Touch,
                        format_args!("illegal option -- {}\n", BStr::new(opt_str)),
                    ),
                    ParseError::ShowUsage => BuiltinKind::Touch.usage_string(),
                    ParseError::Unsupported(unsupported) => self.bltn().fmt_error_arena(
                        BuiltinKind::Touch,
                        format_args!(
                            "unsupported option, please open a GitHub issue -- {}\n",
                            BStr::new(unsupported)
                        ),
                    ),
                };

                return self.write_failing_error(buf, 1);
            }
        };

        let Some(filepath_args) = filepath_args else {
            return self.write_failing_error(BuiltinKind::Touch.usage_string(), 1);
        };

        self.state = State::Exec(ExecState {
            args: filepath_args as *const [*const c_char],
            ..ExecState::default()
        });

        self.next()
    }

    pub fn next(&mut self) -> Yield {
        match &mut self.state {
            State::Idle => panic!("Invalid state"),
            State::Exec(exec) => {
                if exec.started {
                    if exec.tasks_done >= exec.tasks_count
                        && exec.output_done >= exec.output_waiting
                    {
                        let exit_code: ExitCode = if exec.err.is_some() { 1 } else { 0 };
                        if let Some(e) = exec.err.take() {
                            e.deref();
                        }
                        self.state = State::Done;
                        return self.bltn().done(exit_code);
                    }
                    return Yield::Suspended;
                }

                exec.started = true;
                // SAFETY: args was set from Builtin::args_slice() which outlives self
                let args = unsafe { &*exec.args };
                exec.tasks_count = args.len();

                // PORT NOTE: reshaped for borrowck — hoist scalars so the `exec` borrow
                // ends (NLL) before calling self.bltn(), which needs &mut self.
                let opts = self.opts;
                let cwd = self.bltn().parent_cmd().base.shell.cwd_z();
                let this_ptr: *mut Touch = self;
                for &dir_to_mk_ in args {
                    // SAFETY: arg is a NUL-terminated string from the shell arg vector
                    let dir_to_mk = unsafe { ZStr::from_ptr(dir_to_mk_.cast()) };
                    let task = ShellTouchTask::create(this_ptr, opts, dir_to_mk, cwd);
                    // SAFETY: task is a freshly Box::into_raw'd ShellTouchTask; uniquely
                    // owned here until schedule() hands it to the work pool.
                    unsafe { (*task).schedule() };
                }
                Yield::Suspended
            }
            State::WaitingWriteErr => Yield::Failed,
            State::Done => self.bltn().done(0),
        }
    }

    pub fn on_io_writer_chunk(&mut self, _: usize, e: Option<SystemError>) -> Yield {
        if let Some(err) = e {
            err.deref();
        }

        if matches!(self.state, State::WaitingWriteErr) {
            return self.bltn().done(1);
        }

        self.next()
    }

    pub fn write_failing_error(&mut self, buf: &[u8], exit_code: ExitCode) -> Yield {
        if let Some(safeguard) = self.bltn().stderr.needs_io() {
            self.state = State::WaitingWriteErr;
            // PORT NOTE: reshaped for borrowck
            let this_ptr: *mut Touch = self;
            return self.bltn().stderr.enqueue(this_ptr, buf, safeguard);
        }

        let _ = self.bltn().write_no_io(BuiltinIoKind::Stderr, buf);

        self.bltn().done(exit_code)
    }

    pub fn on_shell_touch_task_done(&mut self, task: *mut ShellTouchTask) {
        // SAFETY: task was Box::into_raw'd in ShellTouchTask::create; we reclaim ownership here
        let mut task = unsafe { Box::from_raw(task) };

        let State::Exec(exec) = &mut self.state else {
            unreachable!("on_shell_touch_task_done called outside Exec state");
        };

        bun_output::scoped_log!(
            ShellTouch,
            "{} onShellTouchTaskDone {} tasks_done={} tasks_count={}",
            // TODO(port): cannot Display `self` while `exec` borrow is live; using ptr for now
            self as *const _ as usize,
            &*task,
            exec.tasks_done,
            exec.tasks_count
        );

        exec.tasks_done += 1;
        let err = task.err.take();
        // `task` (Box) drops at end of scope — replaces `defer bun.default_allocator.destroy(task)`

        if let Some(e) = err {
            let output_task: *mut ShellTouchOutputTask = Box::into_raw(Box::new(
                ShellTouchOutputTask {
                    parent: self,
                    output: OutputSrc::Arrlist(Default::default()),
                    state: OutputTaskState::WaitingWriteErr,
                },
            ));
            let error_string = self.bltn().task_error_to_string(BuiltinKind::Touch, &e);
            let State::Exec(exec) = &mut self.state else { unreachable!() };
            if let Some(prev) = exec.err.take() {
                prev.deref();
            }
            exec.err = Some(e);
            // SAFETY: output_task is a freshly-allocated Box; OutputTask owns its own lifecycle
            unsafe { (*output_task).start(error_string).run() };
            return;
        }

        self.next().run();
    }

    #[inline]
    pub fn bltn(&mut self) -> &mut Builtin {
        // SAFETY: self is the `touch` field of Builtin::Impl, which is the `impl` field of Builtin.
        unsafe {
            let impl_ptr = (self as *mut Touch as *mut u8)
                .sub(offset_of!(BuiltinImpl, touch))
                .cast::<BuiltinImpl>();
            &mut *(impl_ptr as *mut u8)
                .sub(offset_of!(Builtin, impl_))
                .cast::<Builtin>()
        }
    }
}

// TODO(port): OutputTask is a Zig type-generator `fn OutputTask(comptime Parent, comptime vtable) type`.
// Modeled here as a generic over the parent type with an `OutputTaskVTable` trait impl.
pub type ShellTouchOutputTask = OutputTask<Touch>;
// TODO(port): OutputTaskState / OutputSrc variants — exact shape lives in interpreter.rs
use crate::shell::interpreter::OutputTaskState;
use crate::shell::interpreter::BuiltinIoKind;

impl OutputTaskVTable for Touch {
    fn write_err<C>(this: &mut Touch, childptr: C, errbuf: &[u8]) -> Option<Yield> {
        let State::Exec(exec) = &mut this.state else { unreachable!() };
        exec.output_waiting += 1;
        if let Some(safeguard) = this.bltn().stderr.needs_io() {
            return Some(this.bltn().stderr.enqueue(childptr, errbuf, safeguard));
        }
        let _ = this.bltn().write_no_io(BuiltinIoKind::Stderr, errbuf);
        None
    }

    fn on_write_err(this: &mut Touch) {
        let State::Exec(exec) = &mut this.state else { unreachable!() };
        exec.output_done += 1;
    }

    fn write_out<C>(this: &mut Touch, childptr: C, output: &mut OutputSrc) -> Option<Yield> {
        let State::Exec(exec) = &mut this.state else { unreachable!() };
        exec.output_waiting += 1;
        if let Some(safeguard) = this.bltn().stdout.needs_io() {
            let slice = output.slice();
            bun_output::scoped_log!(
                ShellTouch,
                "THE SLICE: {} {}",
                slice.len(),
                BStr::new(slice)
            );
            return Some(this.bltn().stdout.enqueue(childptr, slice, safeguard));
        }
        let _ = this.bltn().write_no_io(BuiltinIoKind::Stdout, output.slice());
        None
    }

    fn on_write_out(this: &mut Touch) {
        let State::Exec(exec) = &mut this.state else { unreachable!() };
        exec.output_done += 1;
    }

    fn on_done(this: &mut Touch) -> Yield {
        this.next()
    }
}

pub struct ShellTouchTask {
    pub touch: *mut Touch,

    pub opts: Opts,
    // TODO(port): lifetime — borrowed from shell arg vector (arena) for the task's duration
    pub filepath: ZStr<'static>,
    // TODO(port): lifetime — borrowed from shell cwd buffer for the task's duration
    pub cwd_path: ZStr<'static>,

    pub err: Option<SystemError>,
    pub task: WorkPoolTask,
    pub event_loop: EventLoopHandle,
    pub concurrent_task: EventLoopTask,
}

impl fmt::Display for ShellTouchTask {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "ShellTouchTask(0x{:x}, filepath={})",
            self as *const _ as usize,
            BStr::new(self.filepath.as_bytes()),
        )
    }
}

impl Drop for ShellTouchTask {
    fn drop(&mut self) {
        if let Some(e) = self.err.take() {
            e.deref();
        }
        // `bun.default_allocator.destroy(this)` is handled by Box drop at the call site.
    }
}

impl ShellTouchTask {
    pub fn create(
        touch: *mut Touch,
        opts: Opts,
        filepath: ZStr<'static>,
        cwd_path: ZStr<'static>,
    ) -> *mut ShellTouchTask {
        // SAFETY: `touch` is a valid backref to the owning Touch (BACKREF per LIFETIMES.tsv)
        let event_loop = unsafe { (*touch).bltn() }.event_loop();
        Box::into_raw(Box::new(ShellTouchTask {
            touch,
            opts,
            cwd_path,
            filepath,
            event_loop,
            concurrent_task: EventLoopTask::from_event_loop(event_loop),
            err: None,
            task: WorkPoolTask { callback: Self::run_from_thread_pool },
        }))
    }

    pub fn schedule(&mut self) {
        bun_output::scoped_log!(ShellTouch, "{} schedule", self);
        WorkPool::schedule(&mut self.task);
    }

    pub fn run_from_main_thread(&mut self) {
        bun_output::scoped_log!(ShellTouch, "{} runFromJS", self);
        // SAFETY: `touch` backref is valid for the lifetime of this task
        unsafe { (*self.touch).on_shell_touch_task_done(self) };
    }

    pub fn run_from_main_thread_mini(&mut self, _: &mut ()) {
        self.run_from_main_thread();
    }

    fn run_from_thread_pool(task: *mut WorkPoolTask) {
        // SAFETY: task points to ShellTouchTask.task
        let this: &mut ShellTouchTask = unsafe {
            &mut *(task as *mut u8)
                .sub(offset_of!(ShellTouchTask, task))
                .cast::<ShellTouchTask>()
        };
        bun_output::scoped_log!(ShellTouch, "{} runFromThreadPool", this);

        // We have to give an absolute path
        let filepath: ZStr<'_> = 'brk: {
            if resolve_path::Platform::Auto.is_absolute(this.filepath.as_bytes()) {
                break 'brk this.filepath;
            }
            let parts: &[&[u8]] = &[this.cwd_path.as_bytes(), this.filepath.as_bytes()];
            break 'brk resolve_path::join_z(parts, resolve_path::Platform::Auto);
        };

        let mut node_fs_ = node_fs::NodeFS::default();
        // TODO(port): std.time.milliTimestamp() equivalent
        let milliseconds: f64 = bun_core::time::milli_timestamp() as f64;
        #[cfg(windows)]
        let atime: TimeLike = milliseconds / 1000.0;
        #[cfg(not(windows))]
        let atime: TimeLike = TimeLike {
            sec: (milliseconds / MS_PER_S).floor() as i64,
            nsec: ((milliseconds % MS_PER_S) * NS_PER_MS) as i64,
        };
        let mtime = atime;
        let args = node_fs::Arguments::Utimes {
            atime,
            mtime,
            path: node_fs::PathLike::String(PathString::init(filepath.as_bytes())),
        };
        'out: {
            if let Some(err) = node_fs_.utimes(args, node_fs::Flavor::Sync).as_err() {
                if err.get_errno() == bun_sys::Errno::NOENT {
                    let perm = 0o664;
                    match syscall::open(&filepath, bun_sys::O::CREAT | bun_sys::O::WRONLY, perm) {
                        bun_sys::Result::Ok(fd) => {
                            fd.close();
                            break 'out;
                        }
                        bun_sys::Result::Err(e) => {
                            this.err =
                                Some(e.with_path(filepath.as_bytes()).to_shell_system_error());
                            break 'out;
                        }
                    }
                }
                this.err = Some(err.with_path(filepath.as_bytes()).to_shell_system_error());
            }
        }

        match &mut this.event_loop {
            EventLoopHandle::Js(js) => {
                // TODO(port): ConcurrentTask::from(this, .manual_deinit) — exact API in bun_jsc
                js.enqueue_task_concurrent(this.concurrent_task.js().from(
                    this,
                    bun_jsc::ConcurrentTaskDeinit::Manual,
                ));
            }
            EventLoopHandle::Mini(mini) => {
                mini.enqueue_task_concurrent(
                    this.concurrent_task
                        .mini()
                        .from(this, "runFromMainThreadMini"),
                );
            }
        }
    }
}

const MS_PER_S: f64 = 1000.0;
const NS_PER_MS: f64 = 1_000_000.0;

#[derive(Clone, Copy, Default)]
pub struct Opts {
    /// -a
    ///
    /// change only the access time
    pub access_time_only: bool,

    /// -c, --no-create
    ///
    /// do not create any files
    pub no_create: bool,

    /// -d, --date=STRING
    ///
    /// parse STRING and use it instead of current time
    pub date: Option<&'static [u8]>,

    /// -h, --no-dereference
    ///
    /// affect each symbolic link instead of any referenced file
    /// (useful only on systems that can change the timestamps of a symlink)
    pub no_dereference: bool,

    /// -m
    ///
    /// change only the modification time
    pub modification_time_only: bool,

    /// -r, --reference=FILE
    ///
    /// use this file's times instead of current time
    pub reference: Option<&'static [u8]>,

    /// -t STAMP
    ///
    /// use [[CC]YY]MMDDhhmm[.ss] instead of current time
    pub timestamp: Option<&'static [u8]>,

    /// --time=WORD
    ///
    /// change the specified time:
    /// WORD is access, atime, or use: equivalent to -a
    /// WORD is modify or mtime: equivalent to -m
    pub time: Option<&'static [u8]>,
}

impl Opts {
    pub fn parse(
        &mut self,
        args: &[*const c_char],
    ) -> BuiltinResult<Option<&[*const c_char]>, ParseError> {
        FlagParser::<Opts>::parse_flags(self, args)
    }

    pub fn parse_long(&mut self, flag: &[u8]) -> Option<ParseFlagResult> {
        let _ = self;
        if flag == b"--no-create" {
            return Some(ParseFlagResult::Unsupported(unsupported_flag("--no-create")));
        }

        if flag == b"--date" {
            return Some(ParseFlagResult::Unsupported(unsupported_flag("--date")));
        }

        if flag == b"--reference" {
            return Some(ParseFlagResult::Unsupported(unsupported_flag(
                "--reference=FILE",
            )));
        }

        if flag == b"--time" {
            return Some(ParseFlagResult::Unsupported(unsupported_flag(
                "--reference=FILE",
            )));
        }

        None
    }

    pub fn parse_short(&mut self, char: u8, smallflags: &[u8], i: usize) -> Option<ParseFlagResult> {
        let _ = self;
        match char {
            b'a' => Some(ParseFlagResult::Unsupported(unsupported_flag("-a"))),
            b'c' => Some(ParseFlagResult::Unsupported(unsupported_flag("-c"))),
            b'd' => Some(ParseFlagResult::Unsupported(unsupported_flag("-d"))),
            b'h' => Some(ParseFlagResult::Unsupported(unsupported_flag("-h"))),
            b'm' => Some(ParseFlagResult::Unsupported(unsupported_flag("-m"))),
            b'r' => Some(ParseFlagResult::Unsupported(unsupported_flag("-r"))),
            b't' => Some(ParseFlagResult::Unsupported(unsupported_flag("-t"))),
            _ => Some(ParseFlagResult::IllegalOption(&smallflags[1 + i..])),
        }
        // Zig had a trailing `return null;` here which is unreachable after the exhaustive switch.
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/builtin/touch.zig (414 lines)
//   confidence: medium
//   todos:      8
//   notes:      OutputTask vtable modeled as trait; ZStr<'static> fields need real lifetimes; EventLoopTask/NodeFS API shapes guessed
// ──────────────────────────────────────────────────────────────────────────
