use bun_core::ZStr;
use bun_paths::resolve_path;

use crate::node::types::PathLikeExt as _;
use crate::node::{PathLike, ThreadIsolated, fs};
use crate::shell::builtin::{Builtin, BuiltinState, IoKind, Kind};
use crate::shell::interpreter::{
    EventLoopHandle, FlagParser, Interpreter, NodeId, OutputSrc, OutputTask, OutputTaskVTable,
    ParseFlagResult, ShellTask, parse_flags, shell_join_path, shell_resolve_operand,
};
use crate::shell::io_writer::{ChildPtr, WriterTag};
use crate::shell::yield_::Yield;
use crate::shell::{ExitCode, ShellErr};
use core::ops::ControlFlow;

#[derive(Default)]
pub(crate) struct Cp {
    pub(crate) opts: Opts,
    pub(crate) state: State,
    /// FIFO of in-flight `OutputTask`s awaiting an IOWriter chunk
    /// completion. Stopgap until `WriterTag` can carry the `OutputTask`
    /// directly (see mkdir.rs `Exec::output_queue`).
    pub(crate) output_queue: std::collections::VecDeque<Box<OutputTask<Cp>>>,
}

#[derive(Default)]
pub(crate) enum State {
    #[default]
    Idle,
    Exec(Box<ExecState>),
    WaitingWriteErr,
    Done,
}

pub(crate) struct ExecState {
    /// Index into argv where source paths start.
    pub(crate) sources_start: usize,
    /// argv[sources_start..target_idx] are sources; argv[target_idx] is the
    /// destination.
    pub(crate) target_idx: usize,
    pub(crate) started: bool,
    pub(crate) tasks_count: u32,
    pub(crate) output_waiting: u32,
    pub(crate) output_done: u32,
    /// A source operand was not copied: the exit code is 1.
    pub(crate) failed: bool,
}

impl Cp {
    pub(crate) fn start(interp: &Interpreter, cmd: NodeId) -> Yield {
        let mut opts = Opts::default();
        let (sources_start, target_idx) = {
            let args = Builtin::of(interp, cmd).args_slice();
            match parse_flags(&mut opts, args) {
                Ok(Some(rest)) if rest.len() > 1 => {
                    let start = args.len() - rest.len();
                    (start, args.len() - 1)
                }
                Ok(_) => {
                    Self::state_mut(interp, cmd).state = State::WaitingWriteErr;
                    return Builtin::write_failing_error(interp, cmd, Kind::Cp.usage_string(), 1);
                }
                Err(e) => {
                    return Builtin::fail_parse(interp, cmd, Kind::Cp, &e, || {
                        Self::state_mut(interp, cmd).state = State::WaitingWriteErr
                    });
                }
            }
        };
        Self::state_mut(interp, cmd).opts = opts;
        Self::state_mut(interp, cmd).state = State::Exec(Box::new(ExecState {
            sources_start,
            target_idx,
            started: false,
            tasks_count: 0,
            output_waiting: 0,
            output_done: 0,
            failed: false,
        }));
        Self::next(interp, cmd)
    }

    fn next(interp: &Interpreter, cmd: NodeId) -> Yield {
        enum Action {
            Done(ExitCode),
            Schedule { start: usize, target: usize },
        }
        let action = match &mut Self::state_mut(interp, cmd).state {
            State::Idle => panic!(
                "Invalid state for \"Cp\": idle, this indicates a bug in Bun. Please file a GitHub issue"
            ),
            State::Exec(exec) => {
                if exec.started {
                    if exec.tasks_count == 0 && exec.output_done >= exec.output_waiting {
                        Action::Done(if exec.failed { 1 } else { 0 })
                    } else {
                        return Yield::suspended();
                    }
                } else {
                    exec.started = true;
                    exec.tasks_count = 1;
                    Action::Schedule {
                        start: exec.sources_start,
                        target: exec.target_idx,
                    }
                }
            }
            State::WaitingWriteErr => return Yield::suspended(),
            State::Done => return Builtin::done(interp, cmd, 0),
        };
        match action {
            Action::Done(code) => {
                Self::state_mut(interp, cmd).state = State::Done;
                Builtin::done(interp, cmd, code)
            }
            Action::Schedule { start, target } => {
                let cwd = Builtin::shell(interp, cmd).cwd().to_vec();
                let opts = Self::state_mut(interp, cmd).opts;
                let evtloop = Builtin::event_loop(interp, cmd);
                let tgt = Builtin::of(interp, cmd).arg_bytes(target).to_vec();
                // One task for every source: two sources can name one
                // destination, so they are copied one at a time, in this order.
                let sources = (start..target)
                    .map(|i| Builtin::of(interp, cmd).arg_bytes(i).to_vec())
                    .collect();
                let task =
                    ShellCpTask::create(cmd, evtloop, opts, sources, tgt, cwd, interp.as_ctx_ptr());
                // SAFETY: freshly heap-allocated.
                unsafe { ShellCpTask::schedule(task) };
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
        if let Some(task) = Self::state_mut(interp, cmd).output_queue.pop_front() {
            return OutputTask::<Cp>::on_io_writer_chunk(task, interp, written, e);
        }
        Self::next(interp, cmd)
    }

    /// The pool side is done with every source operand: writes one line per
    /// failed operand to stderr, in operand order, then the `-v` lines to
    /// stdout.
    #[allow(
        clippy::boxed_local,
        reason = "reclaim point for the box the work pool handed back"
    )]
    fn on_shell_cp_task_done(interp: &Interpreter, cmd: NodeId, task: Box<ShellCpTask>) {
        // The lock is uncontended here (all work-pool subtasks have
        // finished) but the data lives inside it.
        let output = core::mem::take(&mut *task.verbose_output.lock());
        let output_task = OutputTask::<Cp>::new(cmd, OutputSrc::Arrlist(output));

        let mut errstr: Vec<u8> = Vec::new();
        for err in &task.errs {
            errstr.extend_from_slice(Builtin::shell_err_to_string(interp, cmd, Kind::Cp, err));
        }
        if let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state {
            exec.tasks_count -= 1;
            exec.failed = !task.errs.is_empty();
        }
        drop(task);
        let errstr = (!errstr.is_empty()).then_some(errstr.as_slice());
        OutputTask::<Cp>::start(output_task, interp, errstr).run(interp);
    }
}

impl OutputTaskVTable for Cp {
    fn write_err(
        interp: &Interpreter,
        cmd: NodeId,
        child: Box<OutputTask<Self>>,
        errbuf: &[u8],
    ) -> ControlFlow<Yield, Box<OutputTask<Self>>> {
        if let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state {
            exec.output_waiting += 1;
        }
        if let Some(safeguard) = Builtin::of(interp, cmd).stderr.needs_io() {
            // Stash so on_io_writer_chunk can route to the OutputTask state
            // machine and reclaim the box (stopgap for missing WriterTag).
            Self::state_mut(interp, cmd).output_queue.push_back(child);
            let childptr = ChildPtr::new(cmd, WriterTag::Builtin);
            return ControlFlow::Break(
                Builtin::of_mut(interp, cmd)
                    .stderr
                    .enqueue(childptr, errbuf, safeguard),
            );
        }
        let _ = Builtin::write_no_io(interp, cmd, IoKind::Stderr, errbuf);
        ControlFlow::Continue(child)
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
    ) -> ControlFlow<Yield, Box<OutputTask<Self>>> {
        if let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state {
            exec.output_waiting += 1;
        }
        if let Some(safeguard) = Builtin::of(interp, cmd).stdout.needs_io() {
            let buf = child.output.slice().to_vec();
            Self::state_mut(interp, cmd).output_queue.push_back(child);
            let childptr = ChildPtr::new(cmd, WriterTag::Builtin);
            return ControlFlow::Break(
                Builtin::of_mut(interp, cmd)
                    .stdout
                    .enqueue(childptr, &buf, safeguard),
            );
        }
        let buf = child.output.slice().to_vec();
        let _ = Builtin::write_no_io(interp, cmd, IoKind::Stdout, &buf);
        ControlFlow::Continue(child)
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

/// Copies the source operands of one `cp` in command-line order, one at a
/// time: two of them can name one destination. For each it resolves src/tgt
/// to absolute paths, decides which POSIX `cp` synopsis applies, then copies
/// with the node:fs cp implementation.
pub(crate) struct ShellCpTask {
    pub(crate) cmd: NodeId,
    pub(crate) opts: Opts,
    /// The source operands, in command-line order.
    pub(crate) sources: Vec<Vec<u8>>,
    /// Index in `sources` of the operand that is being copied.
    pub(crate) cursor: usize,
    pub(crate) tgt: Vec<u8>,
    pub(crate) cwd_path: Vec<u8>,
    /// `tgt`, looked up by the pool thread before the first operand.
    target: Option<bun_sys::Result<Target>>,
    /// `cp_on_copy` is invoked from work-pool threads (concurrently per
    /// copied file) while the directory walk is still fanning out, so the
    /// buffer must live inside the mutex.
    pub(crate) verbose_output: bun_threading::Guarded<Vec<u8>>,
    /// One entry per source operand that was not copied, in operand order.
    pub(crate) errs: Vec<ShellErr>,
    pub task: ShellTask,
}

/// The target operand. Every source operand gets the same answer: none of
/// them changes what the target itself is.
struct Target {
    /// Absolute.
    path: bun_core::ZBox,
    /// `Err`: its stat failed, and not because nothing is there.
    kind: bun_sys::Result<TargetKind>,
}

#[derive(Clone, Copy)]
struct TargetKind {
    is_dir: bool,
    exists: bool,
}

impl Target {
    fn lookup(cwd: &[u8], operand: &[u8]) -> bun_sys::Result<Target> {
        let path = shell_resolve_operand(bun_sys::Tag::copyfile, cwd, operand)?;
        let kind = match ShellCpTask::is_dir(&path) {
            Ok(is_dir) => Ok(TargetKind {
                is_dir,
                exists: true,
            }),
            Err(e) if e.get_errno() == bun_sys::E::ENOENT => Ok(TargetKind {
                // If it has a trailing directory separator, it's a directory.
                is_dir: ShellCpTask::has_trailing_sep(path.as_bytes()),
                exists: false,
            }),
            Err(e) => Err(e),
        };
        Ok(Target { path, kind })
    }
}

/// Whether there is anything to copy for a source operand.
enum Check {
    Copy,
    /// The destination stays as it is, and that is not an error.
    Skip,
    Fail(Box<ShellErr>),
}

impl Check {
    fn fail(msg: String) -> Check {
        Check::Fail(custom_err(msg))
    }
}

/// What is left to do for a source operand that did not fail.
enum Step {
    /// Nothing: it is copied, or there was nothing to copy.
    Done,
    /// It is a directory: start its walk, with these `fs.cp` arguments.
    Walk(ThreadIsolated<fs::args::Cp<'static>>),
}

fn custom_err(msg: String) -> Box<ShellErr> {
    Box::new(ShellErr::Custom(msg.into_bytes().into_boxed_slice()))
}

fn sys_err(err: &bun_sys::Error) -> Box<ShellErr> {
    Box::new(ShellErr::new_sys(err))
}

impl ShellCpTask {
    fn create(
        cmd: NodeId,
        evtloop: EventLoopHandle,
        opts: Opts,
        sources: Vec<Vec<u8>>,
        tgt: Vec<u8>,
        cwd_path: Vec<u8>,
        interp: *mut Interpreter,
    ) -> *mut ShellCpTask {
        let mut task = Box::new(ShellCpTask {
            cmd,
            opts,
            sources,
            cursor: 0,
            tgt,
            cwd_path,
            target: None,
            verbose_output: bun_threading::Guarded::new(Vec::new()),
            errs: Vec::new(),
            task: ShellTask::new(evtloop),
        });
        // Back-ref so `ShellTask::run_from_main_thread::<ShellCpTask>` (the
        // dispatch.rs bounce-back) can recover `&Interpreter`.
        task.task.interp = interp;
        bun_core::heap::into_raw(task)
    }

    /// Appends `"{src} -> {dest}\n"` to the verbose
    /// buffer (printed to stdout once the cp finishes). Called from work-pool
    /// threads; serialised via `verbose_output`'s mutex.
    fn on_copy_impl(&self, src: &[u8], dest: &[u8]) {
        let mut out = self.verbose_output.lock();
        out.reserve(src.len() + dest.len() + 5);
        out.extend_from_slice(src);
        out.extend_from_slice(b" -> ");
        out.extend_from_slice(dest);
        out.push(b'\n');
    }

    /// Called from the node:fs cp on a work-pool thread
    /// for every successfully-copied file. Records the pair
    /// for `-v`; on Windows the paths arrive as WTF-16 and are transcoded.
    /// Takes `&self` because subtasks fan out concurrently — the only mutated
    /// state is the locked `verbose_output` buffer.
    pub(crate) fn cp_on_copy(&self, src: &[bun_paths::OSPathChar], dest: &[bun_paths::OSPathChar]) {
        if !self.opts.verbose {
            return;
        }
        #[cfg(not(windows))]
        {
            self.on_copy_impl(src, dest);
        }
        #[cfg(windows)]
        {
            let mut buf = bun_paths::path_buffer_pool::get();
            let mut buf2 = bun_paths::path_buffer_pool::get();
            let src8 = bun_paths::strings::from_wpath(&mut buf, src);
            let dest8 = bun_paths::strings::from_wpath(&mut buf2, dest);
            self.on_copy_impl(src8, dest8);
        }
    }

    /// Called by the pool thread that ended the walk of a directory operand,
    /// when that is not the thread that started it (which then got `None`
    /// from `run_for_shell` and left). Records the result and goes on with
    /// the next operands on this thread.
    ///
    /// # Safety
    /// `this` is the live `heap::alloc`'d task and no other thread uses it:
    /// the walk has no subtask left and the thread that started it is done
    /// with `this`.
    pub(crate) unsafe fn cp_on_walk_done(this: *mut ShellCpTask, result: bun_sys::Maybe<()>) {
        // SAFETY: caller contract.
        unsafe {
            if let Err(e) = result {
                (*this).errs.push(ShellErr::new_sys(&e));
            }
            (*this).cursor += 1;
            Self::drive(this);
        }
    }

    /// Unlike most shell builtins this does NOT use the generic
    /// [`ShellTask::schedule`] trampoline (which auto-enqueues back to main
    /// on return): the pool callback returns while the files of a directory
    /// operand are still being copied, and the thread that copies the last
    /// one goes on with the operands, so an unconditional post would be too
    /// early. The embedded [`ShellTask`] is reused for its
    /// `WorkPoolTask` / `concurrent_task` / `keep_alive` storage, and holds
    /// the poster for the whole command.
    ///
    /// # Safety
    /// `this` must be a fresh `heap::alloc`'d task (see [`create`]).
    unsafe fn schedule(this: *mut ShellCpTask) {
        use bun_threading::work_pool::WorkPool;
        // SAFETY: `this` is live; `task` is the embedded `ShellTask`. Stay on
        // raw pointers — once `WorkPool::schedule` returns the worker thread
        // may already be running.
        unsafe {
            let st = &raw mut (*this).task;
            (*st).task.callback = Self::work_pool_callback;
            (*st).keep_alive.ref_((*st).event_loop.as_event_loop_ctx());
            (*st).arm();
            WorkPool::schedule(&raw mut (*st).task);
        }
    }

    /// Recover `*ShellCpTask` from the
    /// intrusive `*WorkPoolTask`, look the target up and start on the operands.
    unsafe fn work_pool_callback(task: *mut crate::shell::interpreter::WorkPoolTask) {
        // SAFETY: `task` is the first `#[repr(C)]` field of `ShellTask`, which
        // is embedded in `ShellCpTask` at `TASK_OFFSET`. `this` is a live
        // heap-allocated task, and this thread is the only one that uses it.
        unsafe {
            let this = bun_ptr::container_of::<ShellCpTask, _>(
                task,
                <Self as crate::shell::interpreter::ShellTaskCtx>::TASK_OFFSET,
            );
            (*this).target = Some(Target::lookup(&(*this).cwd_path, &(*this).tgt));
            Self::drive(this);
        }
    }

    /// Copies the source operands from `cursor` on, in order, then posts the
    /// task to the main-thread concurrent queue (routed by `dispatch.rs` →
    /// [`run_from_main_thread`]). Returns before that when the files of a
    /// directory operand are still being copied on other pool threads: the
    /// one that ends the last copy goes on from [`cp_on_walk_done`].
    ///
    /// [`run_from_main_thread`]: Self::run_from_main_thread
    /// [`cp_on_walk_done`]: Self::cp_on_walk_done
    ///
    /// # Safety
    /// `this` is the live `heap::alloc`'d task and no other thread uses it;
    /// not touched again on this thread after return.
    unsafe fn drive(this: *mut ShellCpTask) {
        let mut node_fs = fs::NodeFS::default();
        // SAFETY: caller contract. The task is reached through the raw pointer
        // and through a shared borrow that ends before a walk starts: the
        // threads of a walk read the task (`cp_on_copy`), and the last of
        // them takes it over.
        unsafe {
            loop {
                let step = {
                    let task = &*this;
                    let Some(source) = task.sources.get(task.cursor) else {
                        break;
                    };
                    task.copy_operand(source, &mut node_fs)
                };
                let err = match step {
                    Ok(Step::Done) => None,
                    Err(err) => Some(*err),
                    Ok(Step::Walk(args)) => {
                        let event_loop = (*this).task.event_loop;
                        match fs::ShellAsyncCpTask::run_for_shell(
                            &mut node_fs,
                            args,
                            event_loop,
                            this,
                        ) {
                            Some(result) => result.err().map(|e| ShellErr::new_sys(&e)),
                            // `*this` belongs to the thread that ends the walk.
                            None => return,
                        }
                    }
                };
                (*this).errs.extend(err);
                (*this).cursor += 1;
            }
            ShellTask::on_finish::<ShellCpTask>(this);
        }
    }

    fn has_trailing_sep(path: &[u8]) -> bool {
        path.last()
            .is_some_and(|&c| resolve_path::Platform::AUTO.is_separator(c))
    }

    fn is_dir(path: &ZStr) -> bun_sys::Maybe<bool> {
        #[cfg(windows)]
        {
            match bun_sys::get_file_attributes(path) {
                Some(attrs) => Ok(attrs.is_directory),
                None => Err(
                    bun_sys::Error::from_code(bun_sys::E::ENOENT, bun_sys::Tag::copyfile)
                        .with_path(path.as_bytes()),
                ),
            }
        }
        #[cfg(not(windows))]
        {
            let st = bun_sys::lstat(path)?;
            Ok(bun_sys::S::ISDIR(st.st_mode as _))
        }
    }

    /// Whether a source operand is a directory, and its `lstat`, which the
    /// checks and the copy reuse. On Windows the file attributes say what it
    /// is, and the `lstat` can fail on its own.
    fn lstat_source(path: &ZStr) -> bun_sys::Maybe<(bool, Option<bun_sys::Stat>)> {
        #[cfg(windows)]
        {
            Ok((Self::is_dir(path)?, bun_sys::lstat(path).ok()))
        }
        #[cfg(not(windows))]
        {
            let stat = bun_sys::lstat(path)?;
            Ok((bun_sys::S::ISDIR(stat.st_mode as _), Some(stat)))
        }
    }

    fn cp_flags(&self) -> fs::args::CpFlags {
        fs::args::CpFlags {
            recursive: self.opts.recursive,
            force: !self.opts.no_clobber,
            error_on_exist: false,
        }
    }

    fn same_inode(a: &bun_sys::Stat, b: &bun_sys::Stat) -> bool {
        // A filesystem without inode numbers reports `st_ino == 0`.
        a.st_ino != 0 && a.st_ino == b.st_ino && a.st_dev == b.st_dev
    }

    /// Runs the src/dest checks `fs.cp` does up front (node's `checkPaths` and
    /// `checkParentPaths`), so copying a directory into itself fails before
    /// anything is created. `source` is the operand as written, `src` its
    /// absolute path. `appended` is the source basename if it was joined
    /// onto the target operand.
    fn check_paths(
        &self,
        source: &[u8],
        src: &ZStr,
        src_stat: &bun_sys::Stat,
        tgt: &ZStr,
        appended: Option<&[u8]>,
    ) -> Check {
        use bun_sys::S;
        use resolve_path::Platform;

        let src_shown = bstr::BStr::new(source);
        let tgt_shown = || -> Vec<u8> {
            let mut shown = self.tgt.clone();
            if let Some(basename) = appended {
                if !Self::has_trailing_sep(&shown) {
                    shown.push(bun_paths::SEP);
                }
                shown.extend_from_slice(basename);
            }
            shown
        };

        // A symlink to a directory is copied as a link, so don't treat it as a directory.
        let src_is_dir = S::ISDIR(src_stat.st_mode as _);
        if let Ok(tgt_stat) = bun_sys::lstat(tgt) {
            // A directory is still merged into an existing one, without replacing its files.
            if self.opts.no_clobber && !src_is_dir {
                return Check::Skip;
            }
            if Self::same_inode(src_stat, &tgt_stat) || src.as_bytes() == tgt.as_bytes() {
                // Only the same operand twice is an error. Scripts rely on `cp file .` exiting 0.
                if self.opts.no_clobber || appended.is_some() || src.as_bytes() != tgt.as_bytes() {
                    return Check::Skip;
                }
                return Check::fail(format!(
                    "{src_shown} and {} are identical (not copied)",
                    bstr::BStr::new(&tgt_shown()),
                ));
            }
            let tgt_is_dir = S::ISDIR(tgt_stat.st_mode as _);
            if src_is_dir && !tgt_is_dir {
                return Check::fail(format!(
                    "cannot overwrite non-directory {} with directory {src_shown}",
                    bstr::BStr::new(&tgt_shown()),
                ));
            }
            if !src_is_dir && tgt_is_dir {
                return Check::fail(format!(
                    "cannot overwrite directory {} with non-directory {src_shown}",
                    bstr::BStr::new(&tgt_shown()),
                ));
            }
        }

        if !src_is_dir {
            return Check::Copy;
        }
        let into_itself = || {
            Check::fail(format!(
                "cannot copy a directory, '{src_shown}', into itself, '{}'",
                bstr::BStr::new(&tgt_shown()),
            ))
        };
        let (s, t) = (src.as_bytes(), tgt.as_bytes());
        if t.len() > s.len() && t.starts_with(s) && Platform::AUTO.is_separator(t[s.len()]) {
            return into_itself();
        }
        // A symlink can alias `src`, so also compare each of `tgt`'s ancestors by inode.
        let src_parent = bun_paths::dirname(s);
        let mut path = bun_paths::path_buffer_pool::get();
        let mut ancestor = t;
        while let Some(parent) = bun_paths::dirname(ancestor) {
            if Some(parent) == src_parent {
                break;
            }
            path[..parent.len()].copy_from_slice(parent);
            path[parent.len()] = 0;
            if let Ok(stat) = bun_sys::stat(ZStr::from_buf(&path[..], parent.len())) {
                if Self::same_inode(src_stat, &stat) {
                    return into_itself();
                }
            }
            ancestor = parent;
        }
        Check::Copy
    }

    /// Copies one source operand, unless it is a directory: that walk is the
    /// caller's to start. Resolves the operand to an absolute path and
    /// classifies it per the three POSIX `cp` synopses
    /// (<https://man7.org/linux/man-pages/man1/cp.1p.html>).
    fn copy_operand(&self, source: &[u8], node_fs: &mut fs::NodeFS) -> Result<Step, Box<ShellErr>> {
        // We have to give an absolute path to our cp implementation for it to
        // work with cwd.
        let src = shell_resolve_operand(bun_sys::Tag::copyfile, &self.cwd_path, source)
            .map_err(|e| sys_err(&e))?;
        let target = self
            .target
            .as_ref()
            .expect("the pool callback looks the target up first")
            .as_ref()
            .map_err(sys_err)?;

        // Cases:
        //   SRC       DEST
        //   ----------------
        //   file   -> file
        //   file   -> folder
        //   folder -> folder
        // We need to check dest to see what it is; if it doesn't exist we
        // need to create it.
        let (src_is_dir, src_stat) = Self::lstat_source(&src).map_err(|e| sys_err(&e))?;

        // Any source directory without -R is an error.
        if src_is_dir && !self.opts.recursive {
            return Err(custom_err(format!(
                "{} is a directory (not copied)",
                bstr::BStr::new(source)
            )));
        }

        let TargetKind {
            is_dir: tgt_is_dir,
            exists: tgt_exists,
        } = *target.kind.as_ref().map_err(sys_err)?;
        let one_source = self.sources.len() == 1;

        // The following logic is based on the POSIX spec.
        // The source basename, when it's joined onto the target.
        let appended: Option<&[u8]> = if !src_is_dir && !tgt_is_dir && one_source {
            // 1st synopsis: source_file -> target_file. Nothing to adjust.
            None
        } else if self.opts.recursive {
            // 2nd synopsis: -R source_files... -> target.
            if tgt_exists {
                Some(resolve_path::basename(src.as_bytes()))
            } else if one_source {
                // source_dir -> new_target_dir.
                None
            } else {
                return Err(custom_err(format!(
                    "directory {} does not exist",
                    bstr::BStr::new(&self.tgt)
                )));
            }
        } else {
            // 3rd synopsis: source_files... -> target.
            if !tgt_exists || !tgt_is_dir {
                return Err(custom_err(format!(
                    "{} is not a directory",
                    bstr::BStr::new(&self.tgt)
                )));
            }
            Some(resolve_path::basename(src.as_bytes()))
        };
        let joined;
        let tgt: &ZStr = match appended {
            Some(basename) => {
                joined =
                    shell_join_path(bun_sys::Tag::copyfile, &[target.path.as_bytes(), basename])
                        .map_err(|e| sys_err(&e))?;
                &joined
            }
            None => &target.path,
        };

        // Without an lstat, let the copy report the error.
        if let Some(src_stat) = &src_stat {
            match self.check_paths(source, &src, src_stat, tgt, appended) {
                Check::Copy => {}
                Check::Skip => return Ok(Step::Done),
                Check::Fail(err) => return Err(err),
            }
        }

        if !src_is_dir {
            if let Some(result) = self.copy_file(node_fs, &src, tgt, src_stat.as_ref()) {
                return result.map(|()| Step::Done).map_err(|e| sys_err(&e));
            }
        }
        Ok(Step::Walk(fs::args::Cp::owned(
            src.as_bytes().to_vec(),
            tgt.as_bytes().to_vec(),
            self.cp_flags(),
        )))
    }

    /// Copies `src`, which is not a directory, on this thread, with borrowed
    /// paths. `None`: the copy was not tried. The node:fs cp takes the
    /// operand then, and reports what is wrong with it.
    fn copy_file(
        &self,
        node_fs: &mut fs::NodeFS,
        src: &ZStr,
        tgt: &ZStr,
        stat: Option<&bun_sys::Stat>,
    ) -> Option<bun_sys::Maybe<()>> {
        let args = fs::args::Cp {
            src: PathLike::borrowed(src.as_bytes()),
            dest: PathLike::borrowed(tgt.as_bytes()),
            flags: self.cp_flags(),
        };
        let mut src_buf = bun_paths::os_path_buffer_pool::get();
        let mut tgt_buf = bun_paths::os_path_buffer_pool::get();
        let src = args.src.os_path(&mut src_buf).ok()?;
        let tgt = args.dest.os_path(&mut tgt_buf).ok()?;
        node_fs.cp_non_directory(src, tgt, stat, &args, || {
            self.cp_on_copy(src.as_ref(), tgt.as_ref())
        })
    }

    /// # Safety
    /// `this` must be a live `heap::alloc`'d task (see [`create`](Self::create));
    /// ownership is reclaimed here.
    fn run_from_main_thread(this: *mut ShellCpTask, interp: &Interpreter) {
        // SAFETY: `this` is a live heap-allocated task per the caller's contract.
        let task = unsafe { bun_core::heap::take(this) };
        Cp::on_shell_cp_task_done(interp, task.cmd, task);
    }
}

impl bun_event_loop::Taskable for ShellCpTask {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::ShellCpTask;
    /// A pool completion that will not run: drop the keep-alive and the box
    /// (nothing else frees an unrun one).
    unsafe fn release_unrun(this: *mut Self) {
        // SAFETY: fn contract — the box the builtin scheduled.
        unsafe {
            (*this).task.unref_unrun();
            drop(bun_core::heap::take(this));
        }
    }
    /// See [`ShellTaskCtx`](crate::shell::interpreter::ShellTaskCtx): a step of a shell script always runs.
    unsafe fn context(_: *const Self) -> bun_event_loop::ContextId {
        bun_event_loop::ContextId::NONE
    }
}

impl crate::shell::interpreter::ShellTaskCtx for ShellCpTask {
    const TASK_OFFSET: usize = core::mem::offset_of!(Self, task);
    fn run_from_thread_pool(_this: &mut Self) {
        // Not reached: `ShellCpTask::schedule` installs `work_pool_callback`
        // directly (the generic trampoline auto-posts back, which is too
        // early while the files of a directory operand are still being
        // copied).
        debug_assert!(
            false,
            "ShellCpTask scheduled via ShellTask::schedule; use ShellCpTask::schedule"
        );
    }
    fn run_from_main_thread(this: *mut Self, interp: &Interpreter) {
        // SAFETY: `ShellTask::run_from_main_thread` dispatch contract — `this`
        // is the live heap-allocated task posted via `ShellTask::schedule`.
        Self::run_from_main_thread(this, interp)
    }
}

#[derive(Clone, Copy, Default)]
pub(crate) struct Opts {
    /// `-R` — copy file hierarchies
    pub(crate) recursive: bool,
    /// `-v` — verbose
    pub(crate) verbose: bool,
    /// `-n` — do not overwrite an existing file
    pub(crate) no_clobber: bool,
}

impl FlagParser for Opts {
    fn parse_long<'a>(&mut self, _flag: &'a [u8]) -> Option<ParseFlagResult<'a>> {
        None
    }

    fn parse_short<'a>(
        &mut self,
        ch: u8,
        smallflags: &'a [u8],
        i: usize,
    ) -> Option<ParseFlagResult<'a>> {
        match ch {
            b'R' => self.recursive = true,
            b'v' => self.verbose = true,
            b'n' => self.no_clobber = true,
            // Only the first flag of a group is rejected. Scripts rely on `-Rp` and `-Rf` working.
            _ if i > 0 => {}
            b'f' => return Some(ParseFlagResult::Unsupported(b"-f")),
            b'H' => return Some(ParseFlagResult::Unsupported(b"-H")),
            b'i' => return Some(ParseFlagResult::Unsupported(b"-i")),
            b'L' => return Some(ParseFlagResult::Unsupported(b"-L")),
            b'P' => return Some(ParseFlagResult::Unsupported(b"-P")),
            b'p' => return Some(ParseFlagResult::Unsupported(b"-P")),
            _ => return Some(ParseFlagResult::IllegalOption(&smallflags[i..])),
        }
        None
    }
}
