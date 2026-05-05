use core::ffi::{c_char, c_void};
use core::fmt;
use core::mem::offset_of;
use std::io::Write as _;

use bun_collections::StringArrayHashMap;
use bun_core::Output;
use bun_jsc::{self as jsc, EventLoopHandle, EventLoopTask, SystemError};
use bun_paths::{self as resolve_path, PathBuffer, MAX_PATH_BYTES};
use crate::shell::{self as shell, ExitCode, ShellErr, Yield};
use bun_str::{strings, ZStr};
use bun_sys::{self as syscall, Result as Maybe};
use bun_threading::{Mutex, WorkPool, WorkPoolTask};

use crate::interpreter::{
    self, unsupported_flag, FlagParser, Interpreter, OutputSrc, OutputTask, OutputTaskVTable,
    ParseError, ParseFlagResult,
};
use crate::interpreter::builtin::{self, Builtin, BuiltinKind, Result as BuiltinResult};

bun_output::declare_scope!(cp, hidden);
bun_output::declare_scope!(ShellCpTask, visible);

pub struct Cp {
    pub opts: Opts,
    pub state: State,
}

impl Default for Cp {
    fn default() -> Self {
        Self { opts: Opts::default(), state: State::Idle }
    }
}

pub enum State {
    Idle,
    Exec(ExecState),
    Ebusy(EbusySubState),
    WaitingWriteErr,
    Done,
}

pub struct ExecState {
    // TODO(port): lifetime — borrowed from Builtin args; not actually 'static
    pub target_path: &'static ZStr,
    // TODO(port): lifetime — borrowed from Builtin args; not actually 'static
    pub paths_to_copy: &'static [*const c_char],
    pub started: bool,
    /// this is thread safe as it is only incremented
    /// and decremented on the main thread by this struct
    pub tasks_count: u32,
    pub output_waiting: u32,
    pub output_done: u32,
    pub err: Option<ShellErr>,

    #[cfg(windows)]
    pub ebusy: EbusyState,
    #[cfg(not(windows))]
    pub ebusy: (),
}

impl ExecState {
    fn new(target_path: &'static ZStr, paths_to_copy: &'static [*const c_char]) -> Self {
        Self {
            target_path,
            paths_to_copy,
            started: false,
            tasks_count: 0,
            output_waiting: 0,
            output_done: 0,
            err: None,
            #[cfg(windows)]
            ebusy: EbusyState::default(),
            #[cfg(not(windows))]
            ebusy: (),
        }
    }
}

pub struct EbusySubState {
    pub state: EbusyState,
    pub idx: usize,
    pub main_exit_code: ExitCode,
}

impl fmt::Display for Cp {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Cp(0x{:x})", self as *const _ as usize)
    }
}

/// On Windows it is possible to get an EBUSY error very simply
/// by running the following command:
///
/// `cp myfile.txt myfile.txt mydir/`
///
/// Bearing in mind that the shell cp implementation creates a
/// ShellCpTask for each source file, it's possible for one of the
/// tasks to get EBUSY while trying to access the source file or the
/// destination file.
///
/// But it's fine to ignore the EBUSY error since at
/// least one of them will succeed anyway.
///
/// We handle this _after_ all the tasks have been
/// executed, to avoid complicated synchronization on multiple
/// threads, because the precise src or dest for each argument is
/// not known until its corresponding ShellCpTask is executed by the
/// threadpool.
#[derive(Default)]
pub struct EbusyState {
    // The tasks themselves are freed in `ignore_ebusy_error_if_possible()`
    pub tasks: Vec<*mut ShellCpTask>,
    pub absolute_targets: StringArrayHashMap<()>,
    pub absolute_srcs: StringArrayHashMap<()>,
}

// PORT NOTE: Zig `deinit` only freed the Vec/map storage and owned key strings.
// In Rust, `Vec<*mut ShellCpTask>` drops the pointers (no-op, tasks freed
// elsewhere), and `StringArrayHashMap` with owned `Box<[u8]>` keys drops keys
// automatically. No explicit Drop body needed.

impl Cp {
    pub fn start(&mut self) -> Yield {
        let maybe_filepath_args = match self.opts.parse(self.bltn().args_slice()) {
            BuiltinResult::Ok(args) => args,
            BuiltinResult::Err(e) => {
                let buf = match e {
                    ParseError::IllegalOption(opt_str) => self
                        .bltn()
                        .fmt_error_arena(BuiltinKind::Cp, format_args!("illegal option -- {}\n", bstr::BStr::new(opt_str))),
                    ParseError::ShowUsage => BuiltinKind::Cp.usage_string(),
                    ParseError::Unsupported(unsupported) => self.bltn().fmt_error_arena(
                        BuiltinKind::Cp,
                        format_args!("unsupported option, please open a GitHub issue -- {}\n", bstr::BStr::new(unsupported)),
                    ),
                };

                return self.write_failing_error(buf, 1);
            }
        };

        if maybe_filepath_args.is_none() || maybe_filepath_args.as_ref().unwrap().len() <= 1 {
            return self.write_failing_error(BuiltinKind::Cp.usage_string(), 1);
        }

        let args = maybe_filepath_args.expect("unreachable");
        let paths_to_copy = &args[0..args.len() - 1];
        // SAFETY: args[len-1] is a valid NUL-terminated C string from argsSlice()
        let tgt_path = unsafe { ZStr::from_ptr(args[args.len() - 1]) };

        self.state = State::Exec(ExecState::new(tgt_path, paths_to_copy));

        self.next()
    }

    #[cfg(windows)]
    pub fn ignore_ebusy_error_if_possible(&mut self) -> Yield {
        let State::Ebusy(ebusy) = &mut self.state else { unreachable!() };

        if ebusy.idx < ebusy.state.tasks.len() {
            // PORT NOTE: reshaped for borrowck — capture len & start idx, iterate by index
            let start = ebusy.idx;
            let len = ebusy.state.tasks.len();
            'outer_loop: for i in 0..(len - start) {
                let task: *mut ShellCpTask = ebusy.state.tasks[start + i];
                // SAFETY: task is a valid Box-allocated ShellCpTask owned by this list
                let task_ref = unsafe { &mut *task };
                let failure_src = task_ref.src_absolute.as_ref().unwrap();
                let failure_tgt = task_ref.tgt_absolute.as_ref().unwrap();
                if ebusy.state.absolute_targets.get(failure_tgt.as_bytes()).is_some() {
                    // SAFETY: reclaim Box ownership to drop
                    drop(unsafe { Box::from_raw(task) });
                    continue 'outer_loop;
                }
                if ebusy.state.absolute_srcs.get(failure_src.as_bytes()).is_some() {
                    // SAFETY: reclaim Box ownership to drop
                    drop(unsafe { Box::from_raw(task) });
                    continue 'outer_loop;
                }
                ebusy.idx += i + 1;
                return self.print_shell_cp_task(task);
            }
        }

        // Drop EbusyState (Vec + maps) by replacing state.
        let exit_code = ebusy.main_exit_code;
        self.state = State::Done;
        self.bltn().done(exit_code)
    }

    pub fn next(&mut self) -> Yield {
        while !matches!(self.state, State::Done) {
            match &mut self.state {
                State::Idle => panic!(
                    "Invalid state for \"Cp\": idle, this indicates a bug in Bun. Please file a GitHub issue"
                ),
                State::Exec(exec) => {
                    if exec.started {
                        if exec.tasks_count <= 0 && exec.output_done >= exec.output_waiting {
                            let exit_code: ExitCode = if exec.err.is_some() { 1 } else { 0 };
                            if let Some(err) = exec.err.take() {
                                drop(err);
                            }
                            #[cfg(windows)]
                            {
                                if exec.ebusy.tasks.len() > 0 {
                                    let ebusy = core::mem::take(&mut exec.ebusy);
                                    self.state = State::Ebusy(EbusySubState {
                                        state: ebusy,
                                        idx: 0,
                                        main_exit_code: exit_code,
                                    });
                                    continue;
                                }
                                // exec.ebusy dropped when state is replaced below
                            }
                            self.state = State::Done;
                            return self.bltn().done(exit_code);
                        }
                        return Yield::Suspended;
                    }

                    exec.started = true;
                    exec.tasks_count = u32::try_from(exec.paths_to_copy.len()).unwrap();

                    let cwd_path = self.bltn().parent_cmd().base.shell.cwd_z();

                    // PORT NOTE: reshaped for borrowck — copy out borrowed slices/opts before re-borrowing self
                    let paths_to_copy = exec.paths_to_copy;
                    let target_path = exec.target_path;
                    let opts = self.opts;
                    let event_loop = self.bltn().event_loop();

                    // Launch a task for each argument
                    for &path_raw in paths_to_copy {
                        // SAFETY: path_raw is a valid NUL-terminated C string from argsSlice()
                        let path = unsafe { ZStr::from_ptr(path_raw) };
                        let cp_task = ShellCpTask::create(
                            self,
                            event_loop,
                            opts,
                            1 + paths_to_copy.len(),
                            path,
                            target_path,
                            cwd_path,
                        );
                        // SAFETY: cp_task is a valid Box-leaked pointer
                        unsafe { (*cp_task).schedule() };
                    }
                    return Yield::Suspended;
                }
                State::Ebusy(_) => {
                    #[cfg(windows)]
                    {
                        return self.ignore_ebusy_error_if_possible();
                    }
                    #[cfg(not(windows))]
                    panic!("Should only be called on Windows");
                }
                State::WaitingWriteErr => return Yield::Failed,
                State::Done => unreachable!(),
            }
        }

        self.bltn().done(0)
    }

    pub fn write_failing_error(&mut self, buf: &[u8], exit_code: ExitCode) -> Yield {
        if let Some(safeguard) = self.bltn().stderr.needs_io() {
            self.state = State::WaitingWriteErr;
            return self.bltn().stderr.enqueue(self, buf, safeguard);
        }

        let _ = self.bltn().write_no_io(builtin::Stdio::Stderr, buf);

        self.bltn().done(exit_code)
    }

    pub fn on_io_writer_chunk(&mut self, _: usize, e: Option<SystemError>) -> Yield {
        if let Some(err) = e {
            err.deref();
        }
        if matches!(self.state, State::WaitingWriteErr) {
            return self.bltn().done(1);
        }
        if let State::Exec(exec) = &mut self.state {
            exec.output_done += 1;
        }
        self.next()
    }

    #[inline]
    pub fn bltn(&mut self) -> &mut Builtin {
        // SAFETY: self is the `cp` field inside `Builtin.impl` (a Builtin::Impl union),
        // which is itself the `impl` field of `Builtin`. Same invariant as the Zig.
        unsafe {
            let impl_ptr = (self as *mut Self as *mut u8)
                .sub(offset_of!(builtin::Impl, cp))
                .cast::<builtin::Impl>();
            let builtin_ptr = (impl_ptr as *mut u8)
                .sub(offset_of!(Builtin, impl_))
                .cast::<Builtin>();
            &mut *builtin_ptr
        }
    }

    pub fn on_shell_cp_task_done(&mut self, task: *mut ShellCpTask) {
        debug_assert!(matches!(self.state, State::Exec(_)));
        let State::Exec(exec) = &mut self.state else { unreachable!() };
        bun_output::scoped_log!(cp, "task done: 0x{:x} {}", task as usize, exec.tasks_count);
        exec.tasks_count -= 1;

        #[cfg(windows)]
        {
            // SAFETY: task is a valid Box-allocated ShellCpTask
            let task_ref = unsafe { &mut *task };
            if let Some(err) = &task_ref.err {
                if matches!(err, ShellErr::Sys(sys)
                    if sys.get_errno() == bun_sys::Errno::BUSY
                        && (task_ref.tgt_absolute.as_ref().is_some_and(|t| sys.path.eql_utf8(t.as_bytes())))
                        || (task_ref.src_absolute.as_ref().is_some_and(|s| sys.path.eql_utf8(s.as_bytes()))))
                {
                    bun_output::scoped_log!(
                        cp,
                        "{} got ebusy {} {}",
                        self,
                        exec.ebusy.tasks.len(),
                        exec.paths_to_copy.len()
                    );
                    exec.ebusy.tasks.push(task);
                    self.next().run();
                    return;
                }
            } else {
                if let Some(tgt) = task_ref.tgt_absolute.take() {
                    let gop = exec.ebusy.absolute_targets.get_or_put(tgt.as_bytes());
                    // TODO(port): StringArrayHashMap key ownership — if found_existing, free `tgt`;
                    // else map takes ownership. Exact API depends on bun_collections::StringArrayHashMap.
                    if gop.found_existing {
                        drop(tgt);
                    } else {
                        core::mem::forget(tgt); // map now owns the key bytes
                    }
                }
                if let Some(src) = task_ref.src_absolute.take() {
                    let gop = exec.ebusy.absolute_srcs.get_or_put(src.as_bytes());
                    if gop.found_existing {
                        drop(src);
                    } else {
                        core::mem::forget(src);
                    }
                }
            }
        }

        self.print_shell_cp_task(task).run();
    }

    pub fn print_shell_cp_task(&mut self, task: *mut ShellCpTask) -> Yield {
        // Deinitialize this task as we are starting a new one
        // SAFETY: reclaim Box ownership; dropped at end of scope (matches Zig `defer task.deinit()`)
        let mut task = unsafe { Box::from_raw(task) };

        let output = task.take_output();

        let output_task: *mut ShellCpOutputTask = Box::into_raw(Box::new(ShellCpOutputTask {
            parent: self,
            output: OutputSrc::Arrlist(output),
            state: interpreter::OutputTaskState::WaitingWriteErr,
        }));
        // SAFETY: output_task is a freshly Box-leaked valid pointer
        let output_task_ref = unsafe { &mut *output_task };

        if let Some(err) = task.err.take() {
            let error_string = self.bltn().task_error_to_string(BuiltinKind::Cp, &err);
            if let State::Exec(exec) = &mut self.state {
                if let Some(prev) = exec.err.take() {
                    drop(prev);
                }
                exec.err = Some(err);
            } else {
                drop(err);
            }
            return output_task_ref.start(Some(error_string));
        }
        output_task_ref.start(None)
    }
}

impl Drop for Cp {
    fn drop(&mut self) {
        debug_assert!(matches!(self.state, State::Done | State::WaitingWriteErr));
    }
}

// TODO(port): `OutputTask(Cp, vtable)` is a Zig comptime type-fn. Model as
// `OutputTask<Cp>` where `Cp: OutputTaskVTable` provides the callbacks.
pub type ShellCpOutputTask = OutputTask<Cp>;

impl OutputTaskVTable for Cp {
    fn write_err<C>(&mut self, childptr: &mut C, errbuf: &[u8]) -> Option<Yield> {
        if let State::Exec(exec) = &mut self.state {
            exec.output_waiting += 1;
        }
        if let Some(safeguard) = self.bltn().stderr.needs_io() {
            return Some(self.bltn().stderr.enqueue(childptr, errbuf, safeguard));
        }
        let _ = self.bltn().write_no_io(builtin::Stdio::Stderr, errbuf);
        None
    }

    fn on_write_err(&mut self) {
        if let State::Exec(exec) = &mut self.state {
            exec.output_done += 1;
        }
    }

    fn write_out<C>(&mut self, childptr: &mut C, output: &mut OutputSrc) -> Option<Yield> {
        if let State::Exec(exec) = &mut self.state {
            exec.output_waiting += 1;
        }
        if let Some(safeguard) = self.bltn().stdout.needs_io() {
            return Some(self.bltn().stdout.enqueue(childptr, output.slice(), safeguard));
        }
        let _ = self.bltn().write_no_io(builtin::Stdio::Stdout, output.slice());
        None
    }

    fn on_write_out(&mut self) {
        if let State::Exec(exec) = &mut self.state {
            exec.output_done += 1;
        }
    }

    fn on_done(&mut self) -> Yield {
        self.next()
    }
}

pub struct ShellCpTask {
    pub cp: *mut Cp,

    pub opts: Opts,
    pub operands: usize,
    // TODO(port): lifetime — borrowed from parent Cp args, not actually 'static
    pub src: &'static ZStr,
    pub tgt: &'static ZStr,
    // TODO(port): owned NUL-terminated buffer type — verify `bun_str::ZString` name in Phase B
    pub src_absolute: Option<bun_str::ZString>,
    pub tgt_absolute: Option<bun_str::ZString>,
    // TODO(port): lifetime — borrowed from shell cwd, not actually 'static
    pub cwd_path: &'static ZStr,
    pub verbose_output_lock: Mutex,
    pub verbose_output: Vec<u8>,

    pub task: WorkPoolTask,
    pub event_loop: EventLoopHandle,
    pub concurrent_task: EventLoopTask,
    pub err: Option<ShellErr>,
}

// PORT NOTE: Zig `deinit` freed verbose_output, err, src_absolute, tgt_absolute,
// then `bun.destroy(this)`. In Rust all four are owned types with Drop, and the
// struct itself is Box-allocated; callers drop via `Box::from_raw`. No explicit
// Drop body needed beyond the debug log.
impl Drop for ShellCpTask {
    fn drop(&mut self) {
        bun_output::scoped_log!(ShellCpTask, "deinit");
    }
}

impl ShellCpTask {
    pub fn schedule(&mut self) {
        bun_output::scoped_log!(ShellCpTask, "schedule");
        WorkPool::schedule(&mut self.task);
    }

    pub fn create(
        cp: *mut Cp,
        evtloop: EventLoopHandle,
        opts: Opts,
        operands: usize,
        src: &'static ZStr,
        tgt: &'static ZStr,
        cwd_path: &'static ZStr,
    ) -> *mut ShellCpTask {
        Box::into_raw(Box::new(ShellCpTask {
            cp,
            operands,
            opts,
            src,
            tgt,
            src_absolute: None,
            tgt_absolute: None,
            cwd_path,
            verbose_output_lock: Mutex::new(),
            verbose_output: Vec::new(),
            task: WorkPoolTask { callback: Self::run_from_thread_pool },
            event_loop: evtloop,
            concurrent_task: EventLoopTask::from_event_loop(evtloop),
            err: None,
        }))
    }

    fn take_output(&mut self) -> Vec<u8> {
        core::mem::take(&mut self.verbose_output)
    }

    pub fn ensure_dest(nodefs: &mut bun_runtime::node::fs::NodeFS, dest: bun_paths::OSPathSliceZ) -> Maybe<()> {
        // TODO(port): jsc.Node.Arguments.Mkdir.DefaultMode — verify path in bun_runtime::node
        match nodefs.mkdir_recursive_os_path(dest, bun_runtime::node::Arguments::Mkdir::DEFAULT_MODE, false) {
            Maybe::Err(err) => Maybe::Err(err),
            Maybe::Ok(_) => Maybe::Ok(()),
        }
    }

    pub fn has_trailing_sep(path: &ZStr) -> bool {
        if path.len() == 0 {
            return false;
        }
        resolve_path::Platform::Auto.is_separator(path.as_bytes()[path.len() - 1])
    }

    pub fn is_dir(&mut self, path: &ZStr) -> Maybe<bool> {
        #[cfg(windows)]
        {
            let Some(attributes) = bun_sys::get_file_attributes(path.as_bytes()) else {
                let err = syscall::Error {
                    errno: bun_sys::SystemErrno::ENOENT as _,
                    syscall: syscall::Tag::Copyfile,
                    path: path.as_bytes().into(),
                };
                return Maybe::Err(err);
            };

            return Maybe::Ok(attributes.is_directory);
        }
        #[cfg(not(windows))]
        {
            let stat = match syscall::lstat(path) {
                Maybe::Ok(x) => x,
                Maybe::Err(e) => {
                    return Maybe::Err(e);
                }
            };
            Maybe::Ok(bun_sys::S::is_dir(stat.mode))
        }
    }

    fn enqueue_to_event_loop(&mut self) {
        match &self.event_loop {
            EventLoopHandle::Js(js) => {
                js.enqueue_task_concurrent(self.concurrent_task.js().from(self, jsc::TaskDeinit::ManualDeinit));
            }
            EventLoopHandle::Mini(mini) => {
                mini.enqueue_task_concurrent(self.concurrent_task.mini().from(self, "runFromMainThreadMini"));
            }
        }
    }

    pub fn run_from_main_thread(&mut self) {
        bun_output::scoped_log!(ShellCpTask, "runFromMainThread");
        // SAFETY: BACKREF — `cp` outlives this task; set in `create()` and used only on main thread
        unsafe { (*self.cp).on_shell_cp_task_done(self) };
    }

    pub fn run_from_main_thread_mini(&mut self, _: *mut c_void) {
        self.run_from_main_thread();
    }

    pub fn run_from_thread_pool(task: *mut WorkPoolTask) {
        bun_output::scoped_log!(ShellCpTask, "runFromThreadPool");
        // SAFETY: task points to ShellCpTask.task field
        let this: &mut Self = unsafe {
            &mut *(task as *mut u8)
                .sub(offset_of!(ShellCpTask, task))
                .cast::<ShellCpTask>()
        };
        if let Some(e) = this.run_from_thread_pool_impl() {
            this.err = Some(e);
            this.enqueue_to_event_loop();
            return;
        }
    }

    fn run_from_thread_pool_impl(&mut self) -> Option<ShellErr> {
        let mut buf2 = PathBuffer::uninit();
        let mut buf3 = PathBuffer::uninit();
        // We have to give an absolute path to our cp
        // implementation for it to work with cwd
        let src: &ZStr = 'brk: {
            if resolve_path::Platform::Auto.is_absolute(self.src.as_bytes()) {
                break 'brk self.src;
            }
            let parts: &[&[u8]] = &[self.cwd_path.as_bytes(), self.src.as_bytes()];
            break 'brk resolve_path::join_z(parts, resolve_path::Platform::Auto);
        };
        let mut tgt: &ZStr = 'brk: {
            if resolve_path::Platform::Auto.is_absolute(self.tgt.as_bytes()) {
                break 'brk self.tgt;
            }
            let parts: &[&[u8]] = &[self.cwd_path.as_bytes(), self.tgt.as_bytes()];
            break 'brk resolve_path::join_z_buf(&mut buf2[..MAX_PATH_BYTES], parts, resolve_path::Platform::Auto);
        };

        // Cases:
        // SRC       DEST
        // ----------------
        // file   -> file
        // file   -> folder
        // folder -> folder
        // ----------------
        // We need to check dest to see what it is
        // If it doesn't exist we need to create it
        let src_is_dir = match self.is_dir(src) {
            Maybe::Ok(x) => x,
            Maybe::Err(e) => return Some(ShellErr::new_sys(e)),
        };

        // Any source directory without -R is an error
        if src_is_dir && !self.opts.recursive {
            let mut errmsg = Vec::new();
            write!(&mut errmsg, "{} is a directory (not copied)", bstr::BStr::new(self.src.as_bytes())).unwrap();
            return Some(ShellErr::Custom(errmsg));
        }

        if !src_is_dir && src.as_bytes() == tgt.as_bytes() {
            let mut errmsg = Vec::new();
            write!(
                &mut errmsg,
                "{} and {} are identical (not copied)",
                bstr::BStr::new(self.src.as_bytes()),
                bstr::BStr::new(self.src.as_bytes())
            )
            .unwrap();
            return Some(ShellErr::Custom(errmsg));
        }

        let (tgt_is_dir, tgt_exists): (bool, bool) = match self.is_dir(tgt) {
            Maybe::Ok(is_dir) => (is_dir, true),
            Maybe::Err(e) => 'brk: {
                if e.get_errno() == bun_sys::Errno::NOENT {
                    // If it has a trailing directory separator, its a directory
                    let is_dir = Self::has_trailing_sep(tgt);
                    break 'brk (is_dir, false);
                }
                return Some(ShellErr::new_sys(e));
            }
        };

        let mut copying_many = false;

        // Note:
        // The following logic is based on the POSIX spec:
        //   https://man7.org/linux/man-pages/man1/cp.1p.html

        // Handle the "1st synopsis": source_file -> target_file
        if !src_is_dir && !tgt_is_dir && self.operands == 2 {
            // Don't need to do anything here
        }
        // Handle the "2nd synopsis": -R source_files... -> target
        else if self.opts.recursive {
            if tgt_exists {
                let basename = resolve_path::basename(src.as_bytes());
                let parts: &[&[u8]] = &[tgt.as_bytes(), basename];
                tgt = resolve_path::join_z_buf(&mut buf3[..MAX_PATH_BYTES], parts, resolve_path::Platform::Auto);
            } else if self.operands == 2 {
                // source_dir -> new_target_dir
            } else {
                let mut errmsg = Vec::new();
                write!(&mut errmsg, "directory {} does not exist", bstr::BStr::new(self.tgt.as_bytes())).unwrap();
                return Some(ShellErr::Custom(errmsg));
            }
            copying_many = true;
        }
        // Handle the "3rd synopsis": source_files... -> target
        else {
            if src_is_dir {
                let mut errmsg = Vec::new();
                write!(&mut errmsg, "{} is a directory (not copied)", bstr::BStr::new(self.src.as_bytes())).unwrap();
                return Some(ShellErr::Custom(errmsg));
            }
            if !tgt_exists || !tgt_is_dir {
                let mut errmsg = Vec::new();
                write!(&mut errmsg, "{} is not a directory", bstr::BStr::new(self.tgt.as_bytes())).unwrap();
                return Some(ShellErr::Custom(errmsg));
            }
            let basename = resolve_path::basename(src.as_bytes());
            let parts: &[&[u8]] = &[tgt.as_bytes(), basename];
            tgt = resolve_path::join_z_buf(&mut buf3[..MAX_PATH_BYTES], parts, resolve_path::Platform::Auto);
            copying_many = true;
        }
        let _ = copying_many;

        self.src_absolute = Some(bun_str::ZString::from_bytes(src.as_bytes()));
        self.tgt_absolute = Some(bun_str::ZString::from_bytes(tgt.as_bytes()));

        // TODO(port): jsc.Node.fs.Arguments.Cp / PathLike / PathString — verify paths in bun_runtime::node
        let args = bun_runtime::node::fs::Arguments::Cp {
            src: bun_runtime::node::PathLike::String(bun_str::PathString::init(self.src_absolute.as_ref().unwrap().as_bytes())),
            dest: bun_runtime::node::PathLike::String(bun_str::PathString::init(self.tgt_absolute.as_ref().unwrap().as_bytes())),
            flags: bun_runtime::node::fs::CpFlags {
                // SAFETY: 0 is a valid Mode discriminant
                mode: unsafe { core::mem::transmute::<u32, bun_runtime::node::fs::Mode>(0) },
                recursive: self.opts.recursive,
                force: true,
                error_on_exist: false,
                deinit_paths: false,
            },
        };

        bun_output::scoped_log!(
            ShellCpTask,
            "Scheduling {} -> {}",
            bstr::BStr::new(self.src_absolute.as_ref().unwrap().as_bytes()),
            bstr::BStr::new(self.tgt_absolute.as_ref().unwrap().as_bytes())
        );
        match &self.event_loop {
            EventLoopHandle::Js(js) => {
                let vm: &mut jsc::VirtualMachine = js.get_vm_impl();
                bun_output::scoped_log!(ShellCpTask, "Yoops");
                // PERF(port): was ArenaAllocator bulk-free — profile in Phase B
                let _ = bun_runtime::node::fs::ShellAsyncCpTask::create_with_shell_task(
                    vm.global,
                    args,
                    vm,
                    bun_alloc::Arena::new(),
                    self,
                    false,
                );
            }
            EventLoopHandle::Mini(mini) => {
                // PERF(port): was ArenaAllocator bulk-free — profile in Phase B
                let _ = bun_runtime::node::fs::ShellAsyncCpTask::create_mini(
                    args,
                    mini,
                    bun_alloc::Arena::new(),
                    self,
                );
            }
        }

        None
    }

    fn on_subtask_finish(&mut self, err: Maybe<()>) {
        bun_output::scoped_log!(ShellCpTask, "onSubtaskFinish");
        if let Some(e) = err.as_err() {
            self.err = Some(ShellErr::new_sys(e));
        }
        self.enqueue_to_event_loop();
    }

    pub fn on_copy_impl(&mut self, src: &ZStr, dest: &ZStr) {
        self.verbose_output_lock.lock();
        bun_output::scoped_log!(cp, "onCopy: {} -> {}\n", bstr::BStr::new(src.as_bytes()), bstr::BStr::new(dest.as_bytes()));
        // PORT NOTE: defer unlock → manual unlock at end of scope (Mutex is not RAII here)
        let _guard = scopeguard::guard((), |_| self.verbose_output_lock.unlock());
        // TODO(port): scopeguard captures &mut self twice — Phase B: make Mutex return RAII guard
        write!(
            &mut self.verbose_output,
            "{} -> {}\n",
            bstr::BStr::new(src.as_bytes()),
            bstr::BStr::new(dest.as_bytes())
        )
        .unwrap();
    }

    // TODO(port): Zig `cpOnCopy` uses `anytype` + `@TypeOf` to accept either
    // `[:0]const u8` or `[:0]const u16` per arg. Model as a trait `OsPathLike`
    // with `to_utf8_in(&self, buf) -> &ZStr` (Windows transcodes via fromWPath).
    pub fn cp_on_copy<S: OsPathLike, D: OsPathLike>(&mut self, src_: S, dest_: D) {
        if !self.opts.verbose {
            return;
        }
        #[cfg(unix)]
        {
            return self.on_copy_impl(src_.as_zstr_utf8(), dest_.as_zstr_utf8());
        }
        #[cfg(not(unix))]
        {
            let mut buf = PathBuffer::uninit();
            let mut buf2 = PathBuffer::uninit();
            let src: &ZStr = src_.to_utf8_in(&mut buf);
            let dest: &ZStr = dest_.to_utf8_in(&mut buf2);
            self.on_copy_impl(src, dest);
        }
    }

    pub fn cp_on_finish(&mut self, result: Maybe<()>) {
        self.on_subtask_finish(result);
    }
}

// TODO(port): helper trait for cp_on_copy generic; impls for &ZStr and &WStr live in Phase B
pub trait OsPathLike {
    fn as_zstr_utf8(&self) -> &ZStr;
    fn to_utf8_in<'a>(&self, buf: &'a mut PathBuffer) -> &'a ZStr;
}

#[derive(Clone, Copy)]
pub enum Kind {
    File,
    Dir,
}

// TODO(port): was `packed struct(u16)`. Not all-bool (has u7 padding) so per
// PORTING.md this should be `#[repr(transparent)] struct Opts(u16)` with shift
// accessors. Using a plain bool struct for Phase A readability since fields are
// read/written by name in parse_short; verify size matters in Phase B.
#[derive(Clone, Copy)]
pub struct Opts {
    /// -f
    ///
    /// If the destination file cannot be opened, remove it and create a
    /// new file, without prompting for confirmation regardless of its
    /// permissions.  (The -f option overrides any previous -n option.) The
    /// target file is not unlinked before the copy.  Thus, any existing access
    /// rights will be retained.
    pub remove_and_create_new_file_if_not_found: bool,

    /// -H
    ///
    /// Take actions based on the type and contents of the file
    /// referenced by any symbolic link specified as a
    /// source_file operand.
    pub dereference_command_line_symlinks: bool,

    /// -i
    ///
    /// Write a prompt to standard error before copying to any
    /// existing non-directory destination file. If the
    /// response from the standard input is affirmative, the
    /// copy shall be attempted; otherwise, it shall not.
    pub interactive: bool,

    /// -L
    ///
    /// Take actions based on the type and contents of the file
    /// referenced by any symbolic link specified as a
    /// source_file operand or any symbolic links encountered
    /// during traversal of a file hierarchy.
    pub dereference_all_symlinks: bool,

    /// -P
    ///
    /// Take actions on any symbolic link specified as a
    /// source_file operand or any symbolic link encountered
    /// during traversal of a file hierarchy.
    pub preserve_symlinks: bool,

    /// -p
    ///
    /// Duplicate the following characteristics of each source
    /// file in the corresponding destination file:
    /// 1. The time of last data modification and time of last
    ///    access.
    /// 2. The user ID and group ID.
    /// 3. The file permission bits and the S_ISUID and
    ///    S_ISGID bits.
    pub preserve_file_attributes: bool,

    /// -R
    ///
    /// Copy file hierarchies.
    pub recursive: bool,

    /// -v
    ///
    /// Cause cp to be verbose, showing files as they are copied.
    pub verbose: bool,

    /// -n
    ///
    /// Do not overwrite an existing file.  (The -n option overrides any previous -f or -i options.)
    pub overwrite_existing_file: bool,
}

impl Default for Opts {
    fn default() -> Self {
        Self {
            remove_and_create_new_file_if_not_found: false,
            dereference_command_line_symlinks: false,
            interactive: false,
            dereference_all_symlinks: false,
            preserve_symlinks: false,
            preserve_file_attributes: false,
            recursive: false,
            verbose: false,
            overwrite_existing_file: true,
        }
    }
}

impl Opts {
    pub fn parse(
        &mut self,
        args: &[*const c_char],
    ) -> BuiltinResult<Option<&[*const c_char]>, ParseError> {
        FlagParser::<Self>::parse_flags(self, args)
    }

    pub fn parse_long(&mut self, _flag: &[u8]) -> Option<ParseFlagResult> {
        None
    }

    pub fn parse_short(&mut self, char: u8, smallflags: &[u8], i: usize) -> Option<ParseFlagResult> {
        match char {
            b'f' => {
                return Some(ParseFlagResult::Unsupported(unsupported_flag(b"-f")));
            }
            b'H' => {
                return Some(ParseFlagResult::Unsupported(unsupported_flag(b"-H")));
            }
            b'i' => {
                return Some(ParseFlagResult::Unsupported(unsupported_flag(b"-i")));
            }
            b'L' => {
                return Some(ParseFlagResult::Unsupported(unsupported_flag(b"-L")));
            }
            b'P' => {
                return Some(ParseFlagResult::Unsupported(unsupported_flag(b"-P")));
            }
            b'p' => {
                return Some(ParseFlagResult::Unsupported(unsupported_flag(b"-P")));
            }
            b'R' => {
                self.recursive = true;
                return Some(ParseFlagResult::ContinueParsing);
            }
            b'v' => {
                self.verbose = true;
                return Some(ParseFlagResult::ContinueParsing);
            }
            b'n' => {
                self.overwrite_existing_file = true;
                self.remove_and_create_new_file_if_not_found = false;
                return Some(ParseFlagResult::ContinueParsing);
            }
            _ => {
                return Some(ParseFlagResult::IllegalOption(&smallflags[i..]));
            }
        }
        #[allow(unreachable_code)]
        None
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/builtin/cp.zig (771 lines)
//   confidence: medium
//   todos:      13
//   notes:      borrowed ZStr fields use 'static placeholder; OutputTask vtable modeled as trait; bun_runtime::node::fs paths and ZString owned-ZStr type need verification; on_copy_impl Mutex needs RAII guard
// ──────────────────────────────────────────────────────────────────────────
