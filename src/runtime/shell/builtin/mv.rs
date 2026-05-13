use core::ffi::CStr;
use std::sync::atomic::{AtomicBool, Ordering};

use bun_core::{ZBox, ZStr};
use bun_paths::{PathBuffer, resolve_path};
use bun_ptr::BackRef;

use crate::shell::ExitCode;
use crate::shell::builtin::{Builtin, BuiltinState, IoKind, Kind};
use crate::shell::interpreter::{Interpreter, NodeId, ShellTask, closefd, shell_openat};
use crate::shell::io_writer::{ChildPtr, WriterTag};
use crate::shell::yield_::Yield;

#[derive(Default)]
pub struct Mv {
    pub opts: Opts,
    pub args: MvArgs,
    pub state: MvState,
}

#[derive(Default)]
pub struct MvArgs {
    /// Index into argv where source paths start.
    pub sources_start: usize,
    /// argv[sources_start..target_idx] are sources; argv[target_idx] is dest.
    pub target_idx: usize,
    pub target_fd: Option<bun_sys::Fd>,
}

#[derive(Default)]
pub enum MvState {
    #[default]
    Idle,
    CheckTarget(Box<ShellMvCheckTargetTask>),
    Executing {
        task_count: usize,
        tasks_done: usize,
        error_signal: AtomicBool,
        tasks: Vec<Box<ShellMvBatchedTask>>,
        err: Option<bun_sys::Error>,
    },
    Done,
    WaitingWriteErr {
        exit_code: ExitCode,
    },
    Err,
}

/// Spec: mv.zig `Opts.ParseError` — mv uses its own simpler parser.
pub enum MvParseError {
    IllegalOption(&'static [u8]),
    ShowUsage,
}

impl Mv {
    pub fn start(interp: &Interpreter, cmd: NodeId) -> Yield {
        Self::next(interp, cmd)
    }

    /// Spec: mv.zig `writeFailingError`.
    fn write_failing_error(
        interp: &Interpreter,
        cmd: NodeId,
        buf: &[u8],
        exit_code: ExitCode,
    ) -> Yield {
        if let Some(safeguard) = Builtin::of(interp, cmd).stderr.needs_io() {
            Self::state_mut(interp, cmd).state = MvState::WaitingWriteErr { exit_code };
            let child = ChildPtr::new(cmd, WriterTag::Builtin);
            return Builtin::of_mut(interp, cmd)
                .stderr
                .enqueue(child, buf, safeguard);
        }
        let _ = Builtin::write_no_io(interp, cmd, IoKind::Stderr, buf);
        Builtin::done(interp, cmd, exit_code)
    }

    /// Spec: mv.zig `next`.
    pub fn next(interp: &Interpreter, cmd: NodeId) -> Yield {
        loop {
            // PORT NOTE: reshaped for borrowck — read tag, drop borrow, act.
            enum Tag {
                Idle,
                CheckTarget,
                Executing,
                WaitingWriteErr,
                Done,
                Err,
            }
            let tag = match Self::state_mut(interp, cmd).state {
                MvState::Idle => Tag::Idle,
                MvState::CheckTarget(_) => Tag::CheckTarget,
                MvState::Executing { .. } => Tag::Executing,
                MvState::WaitingWriteErr { .. } => Tag::WaitingWriteErr,
                MvState::Done => Tag::Done,
                MvState::Err => Tag::Err,
            };
            match tag {
                Tag::Idle => {
                    if let Err(e) = Self::parse_opts(interp, cmd) {
                        let buf: Vec<u8> = match e {
                            MvParseError::IllegalOption(s) => Builtin::fmt_error_arena(
                                interp,
                                cmd,
                                Some(Kind::Mv),
                                format_args!("illegal option -- {}\n", bstr::BStr::new(s)),
                            )
                            .to_vec(),
                            MvParseError::ShowUsage => Kind::Mv.usage_string().to_vec(),
                        };
                        return Self::write_failing_error(interp, cmd, &buf, 1);
                    }
                    let cwd = Builtin::cwd(interp, cmd);
                    let target_idx = Self::state_mut(interp, cmd).args.target_idx;
                    let target = ZBox::from_bytes(Builtin::of(interp, cmd).arg_bytes(target_idx));
                    let evtloop = Builtin::event_loop(interp, cmd);
                    let mut task = Box::new(ShellMvCheckTargetTask {
                        cmd,
                        cwd,
                        target,
                        result: None,
                        done: false,
                        task: ShellTask::new(evtloop),
                    });
                    task.task.interp = interp.as_ctx_ptr();
                    // SAFETY: `task` is heap-allocated and outlives the worker
                    // call (held in `MvState::CheckTarget` below).
                    unsafe { ShellTask::schedule(&raw mut *task) };
                    Self::state_mut(interp, cmd).state = MvState::CheckTarget(task);
                    return Yield::suspended();
                }
                Tag::CheckTarget => {
                    let done = match &Self::state_mut(interp, cmd).state {
                        MvState::CheckTarget(t) => t.done,
                        _ => unreachable!(),
                    };
                    if !done {
                        return Yield::suspended();
                    }
                    let result = match &mut Self::state_mut(interp, cmd).state {
                        MvState::CheckTarget(t) => t.result.take(),
                        _ => unreachable!(),
                    };
                    debug_assert!(result.is_some());
                    let maybe_fd: Option<bun_sys::Fd> = match result.unwrap() {
                        Ok(fd) => fd,
                        Err(e) => {
                            // Spec mv.zig:228-247 — only ENOENT (rename to a
                            // new path) is acceptable, and only with exactly
                            // one source. Any other errno (EACCES, ELOOP, …)
                            // is reported and fails regardless of source count.
                            let target = match &Self::state_mut(interp, cmd).state {
                                MvState::CheckTarget(t) => t.target.as_bytes().to_vec(),
                                _ => unreachable!(),
                            };
                            if e.get_errno() == bun_sys::E::ENOENT {
                                let n_sources = {
                                    let me = Self::state_mut(interp, cmd);
                                    me.args.target_idx - me.args.sources_start
                                };
                                if n_sources == 1 {
                                    None
                                } else {
                                    let buf = Builtin::fmt_error_arena(
                                        interp,
                                        cmd,
                                        Some(Kind::Mv),
                                        format_args!(
                                            "{}: No such file or directory\n",
                                            bstr::BStr::new(&target)
                                        ),
                                    )
                                    .to_vec();
                                    return Self::write_failing_error(interp, cmd, &buf, 1);
                                }
                            } else {
                                let msg = e.msg().unwrap_or(b"unknown error");
                                let buf = Builtin::fmt_error_arena(
                                    interp,
                                    cmd,
                                    Some(Kind::Mv),
                                    format_args!(
                                        "{}: {}\n",
                                        bstr::BStr::new(&target),
                                        bstr::BStr::new(msg)
                                    ),
                                )
                                .to_vec();
                                return Self::write_failing_error(interp, cmd, &buf, 1);
                            }
                        }
                    };

                    let n_sources = {
                        let me = Self::state_mut(interp, cmd);
                        me.args.target_fd = maybe_fd;
                        me.args.target_idx - me.args.sources_start
                    };
                    // Trying to move multiple files into a non-directory.
                    if maybe_fd.is_none() && n_sources > 1 {
                        let target = match &Self::state_mut(interp, cmd).state {
                            MvState::CheckTarget(t) => t.target.as_bytes().to_vec(),
                            _ => unreachable!(),
                        };
                        let buf = Builtin::fmt_error_arena(
                            interp,
                            cmd,
                            Some(Kind::Mv),
                            format_args!("{} is not a directory\n", bstr::BStr::new(&target)),
                        )
                        .to_vec();
                        return Self::write_failing_error(interp, cmd, &buf, 1);
                    }

                    const BATCH: usize = ShellMvBatchedTask::BATCH_SIZE;
                    let task_count = n_sources.div_ceil(BATCH);
                    let cwd = Builtin::cwd(interp, cmd);
                    let evtloop = Builtin::event_loop(interp, cmd);
                    let (sources_start, target_idx) = {
                        let me = Self::state_mut(interp, cmd);
                        (me.args.sources_start, me.args.target_idx)
                    };
                    let target = Builtin::of(interp, cmd).arg_bytes(target_idx);

                    let mut tasks: Vec<Box<ShellMvBatchedTask>> = Vec::with_capacity(task_count);
                    for i in 0..task_count {
                        let start = sources_start + i * BATCH;
                        let end = (start + BATCH).min(target_idx);
                        let mut srcs = Vec::with_capacity(end - start);
                        for j in start..end {
                            srcs.push(ZBox::from_bytes(Builtin::of(interp, cmd).arg_bytes(j)));
                        }
                        tasks.push(Box::new(ShellMvBatchedTask {
                            cmd,
                            idx: i,
                            sources: srcs,
                            target: ZBox::from_bytes(target),
                            target_fd: maybe_fd,
                            cwd,
                            error_signal: None,
                            err: None,
                            task: ShellTask::new(evtloop),
                        }));
                    }

                    Self::state_mut(interp, cmd).state = MvState::Executing {
                        task_count,
                        tasks_done: 0,
                        error_signal: AtomicBool::new(false),
                        tasks,
                        err: None,
                    };
                    // Now that the AtomicBool has its final address, point
                    // every task at it and schedule.
                    let interp_ptr: *mut Interpreter = interp.as_ctx_ptr();
                    if let MvState::Executing {
                        error_signal,
                        tasks,
                        ..
                    } = &mut Self::state_mut(interp, cmd).state
                    {
                        let sig = BackRef::new(&*error_signal);
                        for t in tasks.iter_mut() {
                            t.error_signal = Some(sig);
                            t.task.interp = interp_ptr;
                            // SAFETY: `t` is a `Box<ShellMvBatchedTask>` held by
                            // `MvState::Executing` for the worker call's lifetime.
                            unsafe { ShellTask::schedule(&raw mut **t) };
                        }
                    }
                    return Yield::suspended();
                }
                Tag::Executing => {
                    // Shouldn't happen — driven by batchedMoveTaskDone.
                    return Yield::suspended();
                }
                Tag::WaitingWriteErr => return Yield::failed(),
                Tag::Done => return Builtin::done(interp, cmd, 0),
                Tag::Err => return Builtin::done(interp, cmd, 1),
            }
        }
    }

    pub fn on_io_writer_chunk(
        interp: &Interpreter,
        cmd: NodeId,
        _: usize,
        e: Option<bun_sys::SystemError>,
    ) -> Yield {
        match Self::state_mut(interp, cmd).state {
            MvState::WaitingWriteErr { exit_code } => {
                if e.is_some() {
                    Self::state_mut(interp, cmd).state = MvState::Err;
                    return Self::next(interp, cmd);
                }
                Builtin::done(interp, cmd, exit_code)
            }
            _ => panic!("Invalid state"),
        }
    }

    /// Spec: mv.zig `checkTargetTaskDone`.
    pub fn check_target_task_done(interp: &Interpreter, cmd: NodeId) {
        if let MvState::CheckTarget(t) = &mut Self::state_mut(interp, cmd).state {
            t.done = true;
        }
        Self::next(interp, cmd).run(interp);
    }

    /// Spec: mv.zig `batchedMoveTaskDone`.
    pub fn batched_move_task_done(interp: &Interpreter, cmd: NodeId, task_idx: usize) {
        let (all_done, had_err) = {
            let MvState::Executing {
                task_count,
                tasks_done,
                error_signal,
                tasks,
                err,
            } = &mut Self::state_mut(interp, cmd).state
            else {
                unreachable!()
            };
            if let Some(e) = tasks[task_idx].err.take() {
                error_signal.store(true, Ordering::SeqCst);
                if err.is_none() {
                    *err = Some(e);
                }
            }
            *tasks_done += 1;
            (*tasks_done >= *task_count, err.is_some())
        };
        if all_done {
            if had_err {
                let e = match &mut Self::state_mut(interp, cmd).state {
                    MvState::Executing { err, .. } => err.take().unwrap(),
                    _ => unreachable!(),
                };
                // Spec mv.zig:374 — `writeFailingError(buf, err.errno)`: the
                // failing rename's errno becomes the shell exit code.
                let exit_code = e.errno as ExitCode;
                let buf = Builtin::task_error_to_string(interp, cmd, Kind::Mv, &e).to_vec();
                Self::write_failing_error(interp, cmd, &buf, exit_code).run(interp);
                return;
            }
            Self::state_mut(interp, cmd).state = MvState::Done;
            Self::next(interp, cmd).run(interp);
        }
    }

    /// Spec: mv.zig `parseOpts` + `parseFlags`.
    fn parse_opts(interp: &Interpreter, cmd: NodeId) -> Result<(), MvParseError> {
        let argc = Builtin::of(interp, cmd).args_slice().len();
        if argc == 0 {
            return Err(MvParseError::ShowUsage);
        }
        let mut idx = 0usize;
        while idx < argc {
            let flag = Builtin::of(interp, cmd).arg_bytes(idx);
            match Self::parse_flag(&mut Self::state_mut(interp, cmd).opts, flag) {
                MvFlag::Done => {
                    let filepath_args = argc - idx;
                    if filepath_args < 2 {
                        return Err(MvParseError::ShowUsage);
                    }
                    let me = Self::state_mut(interp, cmd);
                    me.args.sources_start = idx;
                    me.args.target_idx = argc - 1;
                    return Ok(());
                }
                MvFlag::ContinueParsing => {}
                MvFlag::IllegalOption(s) => return Err(MvParseError::IllegalOption(s)),
            }
            idx += 1;
        }
        Err(MvParseError::ShowUsage)
    }

    fn parse_flag(opts: &mut Opts, flag: &[u8]) -> MvFlag {
        if flag.is_empty() || flag[0] != b'-' {
            return MvFlag::Done;
        }
        for &ch in &flag[1..] {
            match ch {
                b'f' => {
                    opts.force_overwrite = true;
                    opts.interactive_mode = false;
                    opts.no_overwrite = false;
                }
                b'h' => opts.no_dereference = true,
                b'i' => {
                    opts.interactive_mode = true;
                    opts.force_overwrite = false;
                    opts.no_overwrite = false;
                }
                b'n' => {
                    opts.no_overwrite = true;
                    opts.force_overwrite = false;
                    opts.interactive_mode = false;
                }
                b'v' => opts.verbose_output = true,
                _ => return MvFlag::IllegalOption(b"-"),
            }
        }
        MvFlag::ContinueParsing
    }
}

impl Drop for Mv {
    /// Spec: mv.zig `deinit` — close the directory fd opened by
    /// `ShellMvCheckTargetTask` (`openat(target, O_RDONLY|O_DIRECTORY)`).
    /// `bun_sys::Fd` is `Copy` with no `Drop`, so without this every
    /// `mv srcs... dir/` leaks one open fd.
    fn drop(&mut self) {
        if let Some(fd) = self.args.target_fd.take() {
            closefd(fd);
        }
    }
}

enum MvFlag {
    ContinueParsing,
    Done,
    IllegalOption(&'static [u8]),
}

/// Spec: mv.zig `ShellMvCheckTargetTask`. `openat(target, O_RDONLY|O_DIRECTORY)`
/// on a worker thread to learn whether the destination is a directory.
pub struct ShellMvCheckTargetTask {
    pub cmd: NodeId,
    pub cwd: bun_sys::Fd,
    pub target: ZBox,
    /// `Ok(Some(fd))` → directory; `Ok(None)` → not a directory; `Err(e)` →
    /// open error (e.g. ENOENT).
    pub result: Option<Result<Option<bun_sys::Fd>, bun_sys::Error>>,
    pub done: bool,
    pub task: ShellTask,
}

impl ShellMvCheckTargetTask {
    /// Spec: mv.zig `ShellMvCheckTargetTask.runFromThreadPool`.
    pub fn run_from_thread_pool(this: &mut ShellMvCheckTargetTask) {
        let flags = bun_sys::O::RDONLY | bun_sys::O::DIRECTORY;
        this.result = Some(match shell_openat(this.cwd, &this.target, flags, 0) {
            Ok(fd) => Ok(Some(fd)),
            Err(e) if e.get_errno() == bun_sys::E::ENOTDIR => Ok(None),
            Err(e) => Err(e),
        });
        // Bounce-back is posted by `shell_task_trampoline`.
    }

    pub fn run_from_main_thread(this: *mut ShellMvCheckTargetTask, interp: &Interpreter) {
        // SAFETY: `this` is a live boxed task.
        let cmd = unsafe { (*this).cmd };
        Mv::check_target_task_done(interp, cmd);
    }
}

/// Spec: mv.zig `ShellMvBatchedTask`. renameat() each source into the target.
pub struct ShellMvBatchedTask {
    pub cmd: NodeId,
    /// Index into `MvState::Executing::tasks` so the main-thread completion
    /// can route to `Mv::batched_move_task_done` (Zig used `*ShellMvBatchedTask`
    /// directly via `container_of`).
    pub idx: usize,
    pub sources: Vec<ZBox>,
    pub target: ZBox,
    pub target_fd: Option<bun_sys::Fd>,
    pub cwd: bun_sys::Fd,
    /// Back-reference into `MvState::Executing::error_signal`. The owning
    /// `MvState` outlives every batched task (tasks are joined / counted in
    /// `batched_move_task_done` before the state transitions), so the
    /// `BackRef` invariant holds. `None` only between construction and
    /// scheduling — never observed by `run_from_thread_pool`.
    pub error_signal: Option<BackRef<AtomicBool>>,
    pub err: Option<bun_sys::Error>,
    pub task: ShellTask,
}

impl ShellMvBatchedTask {
    pub const BATCH_SIZE: usize = 5;

    /// Spec: mv.zig `ShellMvBatchedTask.runFromThreadPool`.
    pub fn run_from_thread_pool(this: &mut ShellMvBatchedTask) {
        // Moving multiple entries into a directory.
        if this.sources.len() > 1 {
            return this.move_multiple_into_dir();
        }
        // Moving one entry into a directory.
        if let Some(dir) = this.target_fd {
            let mut buf = PathBuffer::uninit();
            if let Err(e) = Self::move_in_dir(
                this.cwd,
                dir,
                this.target.as_bytes(),
                &this.sources[0],
                &mut buf,
            ) {
                this.err = Some(e);
            }
            return;
        }
        // Rename single entry to a new path (target was not a directory).
        if let Err(e) = bun_sys::renameat(this.cwd, &this.sources[0], this.cwd, &this.target) {
            this.err = Some(if e.get_errno() == bun_sys::E::ENOTDIR {
                e.with_path(this.target.as_bytes())
            } else {
                e
            });
        }
        // Bounce-back is posted by `shell_task_trampoline`.
    }

    /// Spec: mv.zig `ShellMvBatchedTask.moveInDir` — `renameat(cwd, src,
    /// target_fd, basename(src))`. Reshaped for borrowck: free fn over the
    /// fields it touches so `src` can borrow `self.sources[_]` while `self.err`
    /// is written by the caller.
    fn move_in_dir(
        cwd: bun_sys::Fd,
        target_fd: bun_sys::Fd,
        target: &[u8],
        src: &ZStr,
        buf: &mut PathBuffer,
    ) -> Result<(), bun_sys::Error> {
        let base = resolve_path::basename(src.as_bytes());
        let len =
            resolve_path::normalize_buf::<bun_paths::platform::Auto>(base, &mut buf[..]).len();
        if len + 1 >= bun_paths::MAX_PATH_BYTES {
            return Err(bun_sys::Error::from_code(
                bun_sys::E::ENAMETOOLONG,
                bun_sys::Tag::rename,
            ));
        }
        buf[len] = 0;
        let path_in_dir = ZStr::from_buf(buf.as_slice(), len);
        bun_sys::renameat(cwd, src, target_fd, path_in_dir).map_err(|e| {
            // Spec mv.zig:122-128 — surface `target/basename(src)` as the
            // failing path. `with_path` heap-clones, so the Zig
            // `err_path_owned` bookkeeping is unnecessary here (`Drop` frees).
            let joined = resolve_path::join_z::<bun_paths::platform::Auto>(&[target, base]);
            e.with_path(joined.as_bytes())
        })
    }

    /// Spec: mv.zig `ShellMvBatchedTask.moveMultipleIntoDir`.
    fn move_multiple_into_dir(&mut self) {
        let mut buf = PathBuffer::uninit();
        // `target_fd` is always Some when sources.len() > 1 — `next` rejected
        // the multi-source-into-non-directory case before scheduling.
        let dir = self.target_fd.expect("target_fd set for multi-source mv");
        for i in 0..self.sources.len() {
            if self
                .error_signal
                .is_some_and(|sig| sig.load(Ordering::SeqCst))
            {
                // Another batch hit an error — abort the move loop, but still
                // post back to the main thread so `tasks_done` reaches
                // `task_count` and `mv` doesn't hang.
                return;
            }
            if let Err(e) = Self::move_in_dir(
                self.cwd,
                dir,
                self.target.as_bytes(),
                &self.sources[i],
                &mut buf,
            ) {
                self.err = Some(e);
                return;
            }
        }
    }

    /// Spec: mv.zig `ShellMvBatchedTask.moveAcrossFilesystems` — `rename(2)`
    /// fails with EXDEV across mounts; fall back to `cp -pRP` + `rm -rf`.
    /// TODO(port): unimplemented in Zig too.
    #[allow(dead_code)]
    fn move_across_filesystems(&mut self, _src: &ZStr, _dest: &ZStr) {}

    pub fn run_from_main_thread(this: *mut ShellMvBatchedTask, interp: &Interpreter) {
        // SAFETY: `this` is a live boxed task held in `MvState::Executing::tasks`.
        let (cmd, idx) = unsafe { ((*this).cmd, (*this).idx) };
        Mv::batched_move_task_done(interp, cmd, idx);
    }
}

impl bun_event_loop::Taskable for ShellMvCheckTargetTask {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::ShellMvCheckTargetTask;
}
impl bun_event_loop::Taskable for ShellMvBatchedTask {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::ShellMvBatchedTask;
}

impl crate::shell::interpreter::ShellTaskCtx for ShellMvCheckTargetTask {
    const TASK_OFFSET: usize = core::mem::offset_of!(Self, task);
    fn run_from_thread_pool(this: &mut Self) {
        Self::run_from_thread_pool(this)
    }
    fn run_from_main_thread(this: *mut Self, interp: &Interpreter) {
        Self::run_from_main_thread(this, interp)
    }
}

impl crate::shell::interpreter::ShellTaskCtx for ShellMvBatchedTask {
    const TASK_OFFSET: usize = core::mem::offset_of!(Self, task);
    fn run_from_thread_pool(this: &mut Self) {
        Self::run_from_thread_pool(this)
    }
    fn run_from_main_thread(this: *mut Self, interp: &Interpreter) {
        Self::run_from_main_thread(this, interp)
    }
}

#[derive(Clone, Copy)]
pub struct Opts {
    /// `-f` — do not prompt before overwriting (default).
    pub force_overwrite: bool,
    /// `-h` — if target is a symlink to a directory, do not follow it.
    pub no_dereference: bool,
    /// `-i` — prompt before overwriting.
    pub interactive_mode: bool,
    /// `-n` — do not overwrite an existing file.
    pub no_overwrite: bool,
    /// `-v` — verbose.
    pub verbose_output: bool,
}

impl Default for Opts {
    fn default() -> Self {
        Self {
            force_overwrite: true,
            no_dereference: false,
            interactive_mode: false,
            no_overwrite: false,
            verbose_output: false,
        }
    }
}

// ported from: src/shell/builtin/mv.zig
