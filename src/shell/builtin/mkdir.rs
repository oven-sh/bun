use core::ffi::c_char;
use core::fmt;
use core::mem::offset_of;

use bun_jsc::{EventLoopHandle, EventLoopTask, SystemError};
use bun_threading::{WorkPool, WorkPoolTask};
use bun_str::ZStr;
use bun_paths as resolve_path;

use crate::interpreter::{
    self, Builtin, FlagParser, OutputSrc, OutputTask, ParseError, ParseFlagResult,
};
use crate::{ExitCode, Yield};

bun_output::declare_scope!(ShellMkdir, hidden);

// --

#[derive(Default)]
pub struct Mkdir {
    pub opts: Opts,
    pub state: State,
}

pub enum State {
    Idle,
    Exec(Exec),
    WaitingWriteErr,
    Done,
}

impl Default for State {
    fn default() -> Self {
        State::Idle
    }
}

pub struct Exec {
    pub started: bool,
    pub tasks_count: usize,
    pub tasks_done: usize,
    pub output_waiting: u16,
    pub output_done: u16,
    // TODO(port): lifetime — borrowed from Builtin args (arena-backed, outlives Mkdir)
    pub args: &'static [*const c_char],
    pub err: Option<SystemError>,
}

impl Mkdir {
    pub fn on_io_writer_chunk(&mut self, _: usize, e: Option<SystemError>) -> Yield {
        if let Some(err) = e {
            err.deref();
        }

        match &mut self.state {
            State::WaitingWriteErr => return self.bltn().done(1),
            State::Exec(exec) => {
                exec.output_done += 1;
            }
            State::Idle | State::Done => panic!("Invalid state"),
        }

        self.next()
    }

    pub fn write_failing_error(&mut self, buf: &[u8], exit_code: ExitCode) -> Yield {
        if let Some(safeguard) = self.bltn().stderr.needs_io() {
            self.state = State::WaitingWriteErr;
            return self.bltn().stderr.enqueue(self, buf, safeguard);
        }

        let _ = self.bltn().write_no_io(Builtin::Stderr, buf);
        // if (this.bltn().writeNoIO(.stderr, buf).asErr()) |e| {
        //     return .{ .err = e };
        // }

        self.bltn().done(exit_code)
    }

    pub fn start(&mut self) -> Yield {
        let filepath_args = match self.opts.parse(self.bltn().args_slice()) {
            interpreter::Result::Ok(filepath_args) => filepath_args,
            interpreter::Result::Err(e) => {
                let buf: &[u8] = match e {
                    ParseError::IllegalOption(opt_str) => self.bltn().fmt_error_arena(
                        Builtin::Kind::Mkdir,
                        format_args!("illegal option -- {}\n", bstr::BStr::new(opt_str)),
                    ),
                    ParseError::ShowUsage => Builtin::Kind::Mkdir.usage_string(),
                    ParseError::Unsupported(unsupported) => self.bltn().fmt_error_arena(
                        Builtin::Kind::Mkdir,
                        format_args!(
                            "unsupported option, please open a GitHub issue -- {}\n",
                            bstr::BStr::new(unsupported)
                        ),
                    ),
                };

                return self.write_failing_error(buf, 1);
            }
        };
        let Some(filepath_args) = filepath_args else {
            return self.write_failing_error(Builtin::Kind::Mkdir.usage_string(), 1);
        };

        self.state = State::Exec(Exec {
            started: false,
            tasks_count: 0,
            tasks_done: 0,
            output_waiting: 0,
            output_done: 0,
            args: filepath_args,
            err: None,
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
                exec.tasks_count = exec.args.len();

                // PORT NOTE: reshaped for borrowck — capture args/opts/cwd before borrowing self.bltn()
                let args = exec.args;
                let opts = self.opts;
                let cwd = self.bltn().parent_cmd().base.shell.cwd_z();
                for dir_to_mk_ in args {
                    // SAFETY: args are NUL-terminated C strings from Builtin args slice
                    let dir_to_mk = unsafe { ZStr::from_ptr(*dir_to_mk_) };
                    let task = ShellMkdirTask::create(self, opts, dir_to_mk, cwd);
                    // SAFETY: task is a valid Box::into_raw pointer
                    unsafe { (*task).schedule() };
                }
                Yield::Suspended
            }
            State::WaitingWriteErr => Yield::Failed,
            State::Done => self.bltn().done(0),
        }
    }

    pub fn on_shell_mkdir_task_done(&mut self, task: *mut ShellMkdirTask) {
        // SAFETY: task is a valid pointer created by ShellMkdirTask::create; we consume it here
        let task_ref = unsafe { &mut *task };
        let State::Exec(exec) = &mut self.state else {
            unreachable!()
        };
        exec.tasks_done += 1;
        let output = task_ref.take_output();
        let err = task_ref.err.take();
        // SAFETY: task was Box::into_raw'd in create(); reclaim and drop here (Zig: defer task.deinit())
        unsafe { ShellMkdirTask::deinit(task) };

        let output_task: *mut ShellMkdirOutputTask =
            Box::into_raw(Box::new(ShellMkdirOutputTask {
                parent: self,
                output: OutputSrc::Arrlist(output),
                state: interpreter::OutputTaskState::WaitingWriteErr,
            }));
        // TODO(port): OutputTask field names/variants — verify against interpreter.rs

        if let Some(e) = err {
            let error_string = self.bltn().task_error_to_string(Builtin::Kind::Mkdir, &e);
            let State::Exec(exec) = &mut self.state else {
                unreachable!()
            };
            if let Some(prev) = exec.err.take() {
                prev.deref();
            }
            exec.err = Some(e);
            // SAFETY: output_task is a valid freshly-boxed pointer
            unsafe { (*output_task).start(Some(error_string)).run() };
            return;
        }
        // SAFETY: output_task is a valid freshly-boxed pointer
        unsafe { (*output_task).start(None).run() };
    }

    #[inline]
    pub fn bltn(&mut self) -> &mut Builtin {
        // SAFETY: self is the .mkdir field of Builtin::Impl, which is the .impl field of Builtin
        unsafe {
            let impl_ptr = (self as *mut Mkdir as *mut u8)
                .sub(offset_of!(Builtin::Impl, mkdir))
                .cast::<Builtin::Impl>();
            &mut *(impl_ptr as *mut u8)
                .sub(offset_of!(Builtin, impl_))
                .cast::<Builtin>()
        }
        // TODO(port): verify Builtin/Builtin::Impl field names (`impl_`, `mkdir`)
    }
}

// Zig: pub fn deinit(this: *Mkdir) void { _ = this; }
// No Drop impl needed — body was empty.

pub type ShellMkdirOutputTask = OutputTask<Mkdir, ShellMkdirOutputTaskVTable>;
// TODO(port): OutputTask in Zig takes a comptime vtable struct of fn pointers; in Rust this
// should be `OutputTask<Mkdir>` where `Mkdir: OutputTaskVTable` (trait impl). Placeholder
// second type param used here to mirror the Zig shape.

pub struct ShellMkdirOutputTaskVTable;

impl ShellMkdirOutputTaskVTable {
    pub fn write_err<C>(this: &mut Mkdir, childptr: C, errbuf: &[u8]) -> Option<Yield> {
        let State::Exec(exec) = &mut this.state else {
            unreachable!()
        };
        exec.output_waiting += 1;
        if let Some(safeguard) = this.bltn().stderr.needs_io() {
            return Some(this.bltn().stderr.enqueue(childptr, errbuf, safeguard));
        }
        let _ = this.bltn().write_no_io(Builtin::Stderr, errbuf);
        None
    }

    pub fn on_write_err(this: &mut Mkdir) {
        let State::Exec(exec) = &mut this.state else {
            unreachable!()
        };
        exec.output_done += 1;
    }

    pub fn write_out<C>(this: &mut Mkdir, childptr: C, output: &mut OutputSrc) -> Option<Yield> {
        let State::Exec(exec) = &mut this.state else {
            unreachable!()
        };
        exec.output_waiting += 1;
        if let Some(safeguard) = this.bltn().stdout.needs_io() {
            let slice = output.slice();
            bun_output::scoped_log!(
                ShellMkdir,
                "THE SLICE: {} {}",
                slice.len(),
                bstr::BStr::new(slice)
            );
            return Some(this.bltn().stdout.enqueue(childptr, slice, safeguard));
        }
        let _ = this.bltn().write_no_io(Builtin::Stdout, output.slice());
        None
    }

    pub fn on_write_out(this: &mut Mkdir) {
        let State::Exec(exec) = &mut this.state else {
            unreachable!()
        };
        exec.output_done += 1;
    }

    pub fn on_done(this: &mut Mkdir) -> Yield {
        this.next()
    }
}

pub struct ShellMkdirTask {
    pub mkdir: *mut Mkdir,

    pub opts: Opts,
    // TODO(port): lifetime — borrowed from shell arena/parent cmd; outlives this task
    pub filepath: ZStr<'static>,
    // TODO(port): lifetime — borrowed from shell cwd; outlives this task
    pub cwd_path: ZStr<'static>,
    pub created_directories: Vec<u8>,

    pub err: Option<SystemError>,
    pub task: WorkPoolTask,
    pub event_loop: EventLoopHandle,
    pub concurrent_task: EventLoopTask,
}

impl ShellMkdirTask {
    /// # Safety
    /// `this` must have been created by [`ShellMkdirTask::create`] (i.e. `Box::into_raw`).
    pub unsafe fn deinit(this: *mut ShellMkdirTask) {
        // created_directories (Vec<u8>) drops automatically
        drop(Box::from_raw(this));
    }

    fn take_output(&mut self) -> Vec<u8> {
        core::mem::take(&mut self.created_directories)
    }

    pub fn create(
        mkdir: *mut Mkdir,
        opts: Opts,
        filepath: ZStr<'static>,
        cwd_path: ZStr<'static>,
    ) -> *mut ShellMkdirTask {
        // SAFETY: mkdir is a valid backref to the owning Mkdir builtin
        let evtloop = unsafe { (*mkdir).bltn().parent_cmd().base.event_loop() };
        Box::into_raw(Box::new(ShellMkdirTask {
            mkdir,
            opts,
            cwd_path,
            filepath,
            created_directories: Vec::new(),
            err: None,
            task: WorkPoolTask {
                callback: Self::run_from_thread_pool,
            },
            event_loop: evtloop,
            concurrent_task: EventLoopTask::from_event_loop(evtloop),
        }))
    }

    pub fn schedule(&mut self) {
        bun_output::scoped_log!(ShellMkdir, "{} schedule", self);
        WorkPool::schedule(&mut self.task);
    }

    pub fn run_from_main_thread(&mut self) {
        bun_output::scoped_log!(ShellMkdir, "{} runFromJS", self);
        // SAFETY: self.mkdir is a valid backref set in create()
        unsafe { (*self.mkdir).on_shell_mkdir_task_done(self) };
    }

    pub fn run_from_main_thread_mini(&mut self, _: *mut ()) {
        self.run_from_main_thread();
    }

    fn run_from_thread_pool(task: *mut WorkPoolTask) {
        // SAFETY: task points to ShellMkdirTask.task (intrusive field)
        let this: &mut ShellMkdirTask = unsafe {
            &mut *(task as *mut u8)
                .sub(offset_of!(ShellMkdirTask, task))
                .cast::<ShellMkdirTask>()
        };
        bun_output::scoped_log!(ShellMkdir, "{} runFromThreadPool", this);

        // We have to give an absolute path to our mkdir
        // implementation for it to work with cwd
        let filepath: &ZStr = 'brk: {
            if resolve_path::Platform::Auto.is_absolute(this.filepath.as_bytes()) {
                break 'brk &this.filepath;
            }
            let parts: &[&[u8]] = &[this.cwd_path.as_bytes(), this.filepath.as_bytes()];
            break 'brk resolve_path::join_z(parts, resolve_path::Platform::Auto);
        };

        let mut node_fs = bun_runtime::node::fs::NodeFS::default();
        // Recursive
        if this.opts.parents {
            let args = bun_runtime::node::fs::arguments::Mkdir {
                path: bun_runtime::node::PathLike::String(bun_str::PathString::init(
                    filepath.as_bytes(),
                )),
                recursive: true,
                always_return_none: true,
                ..Default::default()
            };

            let mut vtable = MkdirVerboseVTable {
                inner: this,
                active: this.opts.verbose,
            };

            match node_fs.mkdir_recursive_impl(args, &mut vtable) {
                bun_sys::Result::Ok(_) => {}
                bun_sys::Result::Err(e) => {
                    this.err = Some(e.with_path(filepath.as_bytes()).to_shell_system_error());
                    core::hint::black_box(&node_fs);
                }
            }
        } else {
            let args = bun_runtime::node::fs::arguments::Mkdir {
                path: bun_runtime::node::PathLike::String(bun_str::PathString::init(
                    filepath.as_bytes(),
                )),
                recursive: false,
                always_return_none: true,
                ..Default::default()
            };
            match node_fs.mkdir_non_recursive(args) {
                bun_sys::Result::Ok(_) => {
                    if this.opts.verbose {
                        this.created_directories
                            .extend_from_slice(filepath.as_bytes());
                        this.created_directories.push(b'\n');
                    }
                }
                bun_sys::Result::Err(e) => {
                    this.err = Some(e.with_path(filepath.as_bytes()).to_shell_system_error());
                    core::hint::black_box(&node_fs);
                }
            }
        }

        match &mut this.event_loop {
            EventLoopHandle::Js(js) => {
                // TODO(port): EventLoopTask union access — verify .js / .from() shape in Rust
                js.enqueue_task_concurrent(
                    this.concurrent_task
                        .js()
                        .from(this, bun_jsc::ConcurrentTaskDeinit::ManualDeinit),
                );
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

impl fmt::Display for ShellMkdirTask {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "ShellMkdirTask(0x{:x}, filepath={})",
            self as *const _ as usize,
            bstr::BStr::new(self.filepath.as_bytes())
        )
    }
}

pub struct MkdirVerboseVTable<'a> {
    pub inner: &'a mut ShellMkdirTask,
    pub active: bool,
}

impl<'a> MkdirVerboseVTable<'a> {
    pub fn on_create_dir(&mut self, dirpath: &bun_paths::OSPathSliceZ) {
        if !self.active {
            return;
        }
        #[cfg(windows)]
        {
            let mut buf = bun_paths::PathBuffer::uninit();
            let str = bun_str::strings::from_wpath(&mut buf, dirpath.as_slice());
            self.inner.created_directories.extend_from_slice(str);
            self.inner.created_directories.push(b'\n');
        }
        #[cfg(not(windows))]
        {
            self.inner
                .created_directories
                .extend_from_slice(dirpath.as_bytes());
            self.inner.created_directories.push(b'\n');
        }
    }
}

#[derive(Default, Clone, Copy)]
pub struct Opts {
    /// -m, --mode
    ///
    /// set file mode (as in chmod), not a=rwx - umask
    pub mode: Option<u32>,

    /// -p, --parents
    ///
    /// no error if existing, make parent directories as needed,
    /// with their file modes unaffected by any -m option.
    pub parents: bool,

    /// -v, --verbose
    ///
    /// print a message for each created directory
    pub verbose: bool,
}

impl Opts {
    pub fn parse(
        &mut self,
        args: &[*const c_char],
    ) -> interpreter::Result<Option<&'static [*const c_char]>, ParseError> {
        // TODO(port): lifetime on returned args slice — borrowed from `args` (arena)
        FlagParser::<Opts>::parse_flags(self, args)
    }

    pub fn parse_long(&mut self, flag: &[u8]) -> Option<ParseFlagResult> {
        if flag == b"--mode" {
            return Some(ParseFlagResult::Unsupported(b"--mode"));
        } else if flag == b"--parents" {
            self.parents = true;
            return Some(ParseFlagResult::ContinueParsing);
        } else if flag == b"--vebose" {
            self.verbose = true;
            return Some(ParseFlagResult::ContinueParsing);
        }

        None
    }

    pub fn parse_short(&mut self, char: u8, smallflags: &[u8], i: usize) -> Option<ParseFlagResult> {
        match char {
            b'm' => {
                return Some(ParseFlagResult::Unsupported(b"-m "));
            }
            b'p' => {
                self.parents = true;
            }
            b'v' => {
                self.verbose = true;
            }
            _ => {
                return Some(ParseFlagResult::IllegalOption(&smallflags[1 + i..]));
                // TODO(port): lifetime — ParseFlagResult borrows from smallflags (arena)
            }
        }

        None
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/builtin/mkdir.zig (400 lines)
//   confidence: medium
//   todos:      9
//   notes:      OutputTask vtable → trait impl; arena-borrowed slices use 'static placeholder; EventLoopTask union access needs verification
// ──────────────────────────────────────────────────────────────────────────
