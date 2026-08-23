use bun_paths::resolve_path;

use crate::node::PathLike;
use crate::shell::builtin::{Builtin, BuiltinState, Kind};
use crate::shell::interpreter::{
    FlagParser, Interpreter, NodeId, OutputQueue, OutputSrc, OutputTask, OutputTaskVTable,
    ParseFlagResult, ShellTask, unsupported_flag,
};
use crate::shell::yield_::Yield;
use crate::shell::{ExitCode, ShellErr};
use bun_ptr::JsCellRefMut;

#[derive(Default)]
pub struct Cp {
    pub(crate) opts: Opts,
    pub(crate) state: State,
    /// Lives on `Cp` (not `ExecState`) because `print_shell_cp_task` is also
    /// driven from `State::Ebusy` on Windows; both states park tasks.
    pub(crate) output: OutputQueue<Cp>,
}

#[derive(Default)]
pub enum State {
    #[default]
    Idle,
    Exec(Box<ExecState>),
    /// Windows-only post-processing of EBUSY collisions.
    #[cfg(windows)]
    Ebusy(EbusyState),
    WaitingWriteErr,
    Done,
}

pub struct ExecState {
    /// Index into argv where source paths start.
    pub(crate) sources_start: usize,
    /// argv[sources_start..target_idx] are sources; argv[target_idx] is the
    /// destination.
    pub(crate) target_idx: usize,
    pub(crate) started: bool,
    pub(crate) tasks_count: u32,
    pub(crate) err: Option<ShellErr>,
    #[cfg(windows)]
    pub(crate) ebusy: EbusyState,
}

/// On Windows it is possible to get an EBUSY error very simply by running
/// `cp myfile.txt myfile.txt mydir/` — two tasks race for the same dest. Bun
/// ignores the EBUSY if at least one task succeeded for that dest.
#[cfg(windows)]
#[derive(Default)]
pub struct EbusyState {
    /// Deferred EBUSY tasks; `None` once `ignore_ebusy_error_if_possible` has
    /// consumed the slot.
    pub(crate) tasks: Vec<Option<Box<ShellCpTask>>>,
    pub(crate) idx: usize,
    pub(crate) main_exit_code: ExitCode,
    /// Absolute target paths that some task copied successfully — used to
    /// suppress a sibling task's EBUSY on the same target.
    pub(crate) absolute_targets: bun_collections::StringSet,
    pub(crate) absolute_srcs: bun_collections::StringSet,
}

impl Cp {
    pub(crate) fn start(interp: &Interpreter, cmd: NodeId) -> Yield {
        let mut opts = Opts::default();
        let (sources_start, target_idx) = {
            let argc = Builtin::argc(interp, cmd);
            match Builtin::parse_flags(interp, cmd, &mut opts) {
                Ok(Some(start)) if argc - start > 1 => (start, argc - 1),
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
            err: None,
            #[cfg(windows)]
            ebusy: EbusyState::default(),
        }));
        Self::next(interp, cmd)
    }

    fn next(interp: &Interpreter, cmd: NodeId) -> Yield {
        enum Action {
            Done(ExitCode),
            Schedule {
                start: usize,
                target: usize,
            },
            #[cfg(windows)]
            Ebusy(ExitCode),
            #[cfg(windows)]
            IgnoreEbusy,
            Suspend,
            Failed,
            AlreadyDone,
        }
        let output_drained = Self::state_mut(interp, cmd).output.drained();
        let action = match &mut Self::state_mut(interp, cmd).state {
            State::Idle => panic!(
                "Invalid state for \"Cp\": idle, this indicates a bug in Bun. Please file a GitHub issue"
            ),
            State::Exec(exec) => {
                if exec.started {
                    if exec.tasks_count == 0 && output_drained {
                        let exit_code: ExitCode = if exec.err.is_some() { 1 } else { 0 };
                        exec.err = None;
                        #[cfg(windows)]
                        let act = if !exec.ebusy.tasks.is_empty() {
                            Action::Ebusy(exit_code)
                        } else {
                            // `Drop` frees the ebusy state here.
                            Action::Done(exit_code)
                        };
                        #[cfg(not(windows))]
                        let act = Action::Done(exit_code);
                        act
                    } else {
                        Action::Suspend
                    }
                } else {
                    exec.started = true;
                    let n = (exec.target_idx - exec.sources_start) as u32;
                    exec.tasks_count = n;
                    Action::Schedule {
                        start: exec.sources_start,
                        target: exec.target_idx,
                    }
                }
            }
            #[cfg(windows)]
            State::Ebusy(_) => Action::IgnoreEbusy,
            State::WaitingWriteErr => Action::Failed,
            State::Done => Action::AlreadyDone,
        };
        match action {
            Action::Suspend => Yield::suspended(),
            Action::Failed => Yield::failed(),
            Action::AlreadyDone => Builtin::done(interp, cmd, 0),
            #[cfg(windows)]
            Action::IgnoreEbusy => Self::ignore_ebusy_error_if_possible(interp, cmd),
            Action::Done(code) => {
                Self::state_mut(interp, cmd).state = State::Done;
                Builtin::done(interp, cmd, code)
            }
            #[cfg(windows)]
            Action::Ebusy(exit_code) => {
                {
                    let mut me = Self::state_mut(interp, cmd);
                    let State::Exec(exec) = &mut me.state else {
                        unreachable!()
                    };
                    let mut ebusy = core::mem::take(&mut exec.ebusy);
                    ebusy.idx = 0;
                    ebusy.main_exit_code = exit_code;
                    me.state = State::Ebusy(ebusy);
                }
                Self::ignore_ebusy_error_if_possible(interp, cmd)
            }
            Action::Schedule { start, target } => {
                let cwd = Builtin::shell(interp, cmd).borrow().cwd().to_vec();
                let opts = Self::state_mut(interp, cmd).opts;
                let tgt = Builtin::of(interp, cmd).arg_bytes(target).to_vec();
                let operands = 1 + (target - start);
                for i in start..target {
                    let src = Builtin::of(interp, cmd).arg_bytes(i).to_vec();
                    let task = ShellCpTask::create(
                        cmd,
                        opts,
                        operands,
                        src,
                        tgt.clone(),
                        cwd.clone(),
                        interp,
                    );
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
        // Only the usage error is written directly; task output goes through
        // `OutputTask::on_chunk`.
        let _ = (written, e);
        debug_assert!(matches!(
            Self::state_mut(interp, cmd).state,
            State::WaitingWriteErr
        ));
        Builtin::done(interp, cmd, 1)
    }

    /// Windows-only post-processing of tasks that failed with EBUSY: if some
    /// other task already succeeded
    /// for the same absolute src/tgt, the EBUSY is benign and the task is
    /// dropped; otherwise its error is surfaced via `print_shell_cp_task`.
    #[cfg(windows)]
    fn ignore_ebusy_error_if_possible(interp: &Interpreter, cmd: NodeId) -> Yield {
        loop {
            // Pop tasks one at a time; `idx` is bumped on the first
            // non-ignorable hit so a re-entry resumes there.
            let next = {
                let State::Ebusy(eb) = &mut Self::state_mut(interp, cmd).state else {
                    unreachable!()
                };
                if eb.idx < eb.tasks.len() {
                    let t = eb.tasks[eb.idx].take().expect("ebusy task consumed once");
                    eb.idx += 1;
                    let ignorable = t
                        .tgt_absolute
                        .as_ref()
                        .map_or(false, |p| eb.absolute_targets.contains(p))
                        || t.src_absolute
                            .as_ref()
                            .map_or(false, |p| eb.absolute_srcs.contains(p));
                    Some((t, ignorable))
                } else {
                    None
                }
            };
            match next {
                Some((t, true)) => drop(t),
                Some((t, false)) => return Self::print_shell_cp_task(interp, cmd, t),
                None => break,
            }
        }
        let exit_code = {
            let me = Self::state_mut(interp, cmd);
            let State::Ebusy(eb) = &me.state else {
                unreachable!()
            };
            eb.main_exit_code
        };
        // `Drop` frees the ebusy sets/vec here.
        Self::state_mut(interp, cmd).state = State::Done;
        Builtin::done(interp, cmd, exit_code)
    }

    fn on_shell_cp_task_done(
        interp: &Interpreter,
        cmd: NodeId,
        #[cfg_attr(not(windows), allow(unused_mut))] mut task: Box<ShellCpTask>,
    ) {
        if let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state {
            exec.tasks_count -= 1;
        }
        #[cfg(windows)]
        {
            let mut me = Self::state_mut(interp, cmd);
            if let State::Exec(exec) = &mut me.state {
                if let Some(err) = &task.err {
                    // Defer the task to the ebusy phase. Note the precedence:
                    //   `(is_sys && errno==EBUSY && tgt_match) || src_match`
                    // i.e. ANY sys error whose `path` equals `src_absolute` is
                    // deferred regardless of errno; preserved deliberately for
                    // compatibility.
                    let is_ebusy = matches!(err, ShellErr::Sys(sys)
                        if (sys.get_errno() == bun_sys::E::EBUSY
                                && task.tgt_absolute.as_deref()
                                    .map_or(false, |p| sys.path.eql_utf8(p)))
                            || task.src_absolute.as_deref()
                                    .map_or(false, |p| sys.path.eql_utf8(p)));
                    if is_ebusy {
                        exec.ebusy.tasks.push(Some(task));
                        drop(me);
                        return Self::next(interp, cmd).run(interp);
                    }
                } else {
                    // Record successful absolute paths so a deferred EBUSY
                    // sibling can be suppressed.
                    if let Some(tgt) = task.tgt_absolute.take() {
                        bun_core::handle_oom(exec.ebusy.absolute_targets.insert(&tgt));
                    }
                    if let Some(src) = task.src_absolute.take() {
                        bun_core::handle_oom(exec.ebusy.absolute_srcs.insert(&src));
                    }
                }
            }
            drop(me);
        }
        Self::print_shell_cp_task(interp, cmd, task).run(interp);
    }

    #[allow(
        clippy::boxed_local,
        reason = "reclaim point for the box the work pool handed back"
    )]
    fn print_shell_cp_task(interp: &Interpreter, cmd: NodeId, mut task: Box<ShellCpTask>) -> Yield {
        // The lock is uncontended here (all work-pool subtasks have
        // finished) but the data lives inside it.
        let output = core::mem::take(&mut *task.verbose_output.lock());
        let output_task = OutputTask::<Cp>::new(cmd, OutputSrc::Arrlist(output));

        let errstr: Option<Vec<u8>> = task.err.take().map(|e| {
            let s = Builtin::shell_err_to_string(Kind::Cp, &e);
            if let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state {
                exec.err = Some(e);
            }
            // `e` drops here when not stored.
            s
        });
        OutputTask::<Cp>::start(output_task, interp, errstr.as_deref())
    }
}

impl OutputTaskVTable for Cp {
    fn output_queue(interp: &Interpreter, cmd: NodeId) -> JsCellRefMut<'_, OutputQueue<Self>> {
        JsCellRefMut::map(Self::state_mut(interp, cmd), |me| &mut me.output)
    }

    fn on_done(interp: &Interpreter, cmd: NodeId) -> Yield {
        Self::next(interp, cmd)
    }
}

/// Resolves src/tgt to absolute paths, decides
/// which POSIX `cp` synopsis applies, then hands off to the node:fs async cp
/// implementation.
pub struct ShellCpTask {
    pub(crate) cmd: NodeId,
    pub(crate) opts: Opts,
    pub(crate) operands: usize,
    pub(crate) src: Vec<u8>,
    pub(crate) tgt: Vec<u8>,
    /// The absolute paths handed to the `ShellAsyncCpTask`, moved back by
    /// [`cp_on_finish`](Self::cp_on_finish) for the EBUSY bookkeeping.
    pub(crate) src_absolute: Option<Vec<u8>>,
    pub(crate) tgt_absolute: Option<Vec<u8>>,
    pub(crate) cwd_path: Vec<u8>,
    /// `cp_on_copy` is invoked from work-pool threads (concurrently per
    /// copied file) while the directory walk is still fanning out, so the
    /// buffer must live inside the mutex.
    pub(crate) verbose_output: bun_threading::Guarded<Vec<u8>>,
    pub(crate) err: Option<ShellErr>,
    pub task: ShellTask,
}

// The pool-side body is `run_on_pool`, not `ShellTask::run_owned`: on the
// success path the copy is handed to a `ShellAsyncCpTask` that posts the
// bounce-back itself (`cp_on_finish`), so an unconditional post would
// double-enqueue.
crate::shell_task!(ShellCpTask, run = ShellCpTask::run_on_pool);

impl ShellCpTask {
    fn create(
        cmd: NodeId,
        opts: Opts,
        operands: usize,
        src: Vec<u8>,
        tgt: Vec<u8>,
        cwd_path: Vec<u8>,
        interp: &Interpreter,
    ) -> Box<ShellCpTask> {
        Box::new(ShellCpTask {
            cmd,
            opts,
            operands,
            src,
            tgt,
            src_absolute: None,
            tgt_absolute: None,
            cwd_path,
            verbose_output: bun_threading::Guarded::new(Vec::new()),
            err: None,
            task: ShellTask::new(interp),
        })
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

    /// Called from the node:fs `NewAsyncCpTask<true>`
    /// work-pool thread for every successfully-copied file. Records the pair
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
            let mut buf = bun_paths::PathBuffer::uninit();
            let mut buf2 = bun_paths::PathBuffer::uninit();
            let src8 = bun_paths::strings::from_wpath(&mut buf, src);
            let dest8 = bun_paths::strings::from_wpath(&mut buf2, dest);
            self.on_copy_impl(src8, dest8);
        }
    }

    /// Called on the JS thread when the node:fs async cp completes (success or
    /// first error). Records the error (if any) and finishes this `ShellCpTask`
    /// in place so the interpreter can drain `verbose_output` / surface it.
    ///
    /// # Safety
    /// `this` is the live task `run_on_pool` released to the
    /// `ShellAsyncCpTask`; reclaimed here, not touched by the caller after.
    pub(crate) unsafe fn cp_on_finish(
        this: *mut ShellCpTask,
        src: PathLike<'static>,
        dest: PathLike<'static>,
        result: bun_sys::Maybe<()>,
    ) {
        // SAFETY: caller contract — JS thread, from the `ShellAsyncCpTask`'s
        // completion; `this` is live and ours (the box `run_on_pool` released
        // to it). The pool side finished (and dropped its poster) when it
        // handed the copy to that task, so continue in place rather than
        // bouncing through the concurrent queue again.
        let mut this = unsafe { bun_core::heap::take(this) };
        this.src_absolute = Some(src.into_vec());
        this.tgt_absolute = Some(dest.into_vec());
        if let Err(e) = result {
            this.err = Some(ShellErr::new_sys(&e));
        }
        ShellTask::run_from_main_thread::<ShellCpTask>(this);
    }

    /// Pool-side body: run the impl, and on error post back immediately;
    /// the success path hands the allocation to a `ShellAsyncCpTask`, whose
    /// completion (`cp_on_finish`) reclaims it.
    fn run_on_pool(this: Box<ShellCpTask>) {
        let this = bun_core::heap::into_raw(this);
        // SAFETY: `this` is the box just released; the worker thread has
        // exclusive access until it is handed off. Raw because on success the
        // `ShellAsyncCpTask` it now belongs to may free it from another thread
        // at once.
        unsafe {
            // Moved out first: see above.
            let poster = (*this)
                .task
                .poster
                .take()
                .expect("shell cp task on the pool is armed");
            if let Some(e) = (*this).run_from_thread_pool_impl(&poster) {
                (*this).err = Some(e);
                (*this).task.poster = Some(poster);
                ShellTask::on_finish::<ShellCpTask>(bun_core::heap::take(this));
            } else {
                // The copy now belongs to a `ShellAsyncCpTask` (holding its
                // own poster, completing on the JS thread via `cp_on_finish`);
                // this task's pool part is over.
                drop(poster);
            }
        }
    }

    fn has_trailing_sep(path: &[u8]) -> bool {
        path.last()
            .is_some_and(|&c| resolve_path::Platform::AUTO.is_separator(c))
    }

    fn is_dir(path: &bun_core::ZStr) -> bun_sys::Maybe<bool> {
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

    /// Resolves src/tgt to absolute paths, classifies them per the three
    /// POSIX `cp` synopses
    /// (<https://man7.org/linux/man-pages/man1/cp.1p.html>), then hands off to
    /// the node:fs async cp implementation.
    fn run_from_thread_pool_impl(
        &mut self,
        poster: &bun_jsc::ConcurrentPoster,
    ) -> Option<ShellErr> {
        use resolve_path::{Platform, platform};

        let mut buf2 = bun_paths::PathBuffer::uninit();
        let mut buf3 = bun_paths::PathBuffer::uninit();
        // We have to give an absolute path to our cp implementation for it to
        // work with cwd.
        let src: &bun_core::ZStr = if Platform::AUTO.is_absolute(&self.src) {
            // `self.src` is the bare argv bytes (no NUL); re-terminate via
            // the thread-local join buffer.
            resolve_path::join_z::<platform::Auto>(&[&self.src])
        } else {
            resolve_path::join_z::<platform::Auto>(&[&self.cwd_path, &self.src])
        };
        let mut tgt: &bun_core::ZStr = if Platform::AUTO.is_absolute(&self.tgt) {
            resolve_path::join_z_buf::<platform::Auto>(buf2.as_mut_slice(), &[&self.tgt])
        } else {
            resolve_path::join_z_buf::<platform::Auto>(
                buf2.as_mut_slice(),
                &[&self.cwd_path, &self.tgt],
            )
        };

        // Cases:
        //   SRC       DEST
        //   ----------------
        //   file   -> file
        //   file   -> folder
        //   folder -> folder
        // We need to check dest to see what it is; if it doesn't exist we
        // need to create it.
        let src_is_dir = match Self::is_dir(src) {
            Ok(x) => x,
            Err(e) => return Some(ShellErr::new_sys(&e)),
        };

        // Any source directory without -R is an error.
        if src_is_dir && !self.opts.recursive {
            return Some(ShellErr::Custom(
                format!("{} is a directory (not copied)", bstr::BStr::new(&self.src))
                    .into_bytes()
                    .into_boxed_slice(),
            ));
        }

        if !src_is_dir && src.as_bytes() == tgt.as_bytes() {
            return Some(ShellErr::Custom(
                format!(
                    "{0} and {0} are identical (not copied)",
                    bstr::BStr::new(&self.src)
                )
                .into_bytes()
                .into_boxed_slice(),
            ));
        }

        let (tgt_is_dir, tgt_exists) = match Self::is_dir(tgt) {
            Ok(is_dir) => (is_dir, true),
            Err(e) if e.get_errno() == bun_sys::E::ENOENT => {
                // If it has a trailing directory separator, it's a directory.
                (Self::has_trailing_sep(tgt.as_bytes()), false)
            }
            Err(e) => return Some(ShellErr::new_sys(&e)),
        };

        let mut _copying_many = false;

        // The following logic is based on the POSIX spec.
        if !src_is_dir && !tgt_is_dir && self.operands == 2 {
            // 1st synopsis: source_file -> target_file. Nothing to adjust.
        } else if self.opts.recursive {
            // 2nd synopsis: -R source_files... -> target.
            if tgt_exists {
                let basename = resolve_path::basename(src.as_bytes());
                tgt = resolve_path::join_z_buf::<platform::Auto>(
                    buf3.as_mut_slice(),
                    &[tgt.as_bytes(), basename],
                );
            } else if self.operands == 2 {
                // source_dir -> new_target_dir.
            } else {
                return Some(ShellErr::Custom(
                    format!("directory {} does not exist", bstr::BStr::new(&self.tgt))
                        .into_bytes()
                        .into_boxed_slice(),
                ));
            }
            _copying_many = true;
        } else {
            // 3rd synopsis: source_files... -> target.
            if src_is_dir {
                return Some(ShellErr::Custom(
                    format!("{} is a directory (not copied)", bstr::BStr::new(&self.src))
                        .into_bytes()
                        .into_boxed_slice(),
                ));
            }
            if !tgt_exists || !tgt_is_dir {
                return Some(ShellErr::Custom(
                    format!("{} is not a directory", bstr::BStr::new(&self.tgt))
                        .into_bytes()
                        .into_boxed_slice(),
                ));
            }
            let basename = resolve_path::basename(src.as_bytes());
            tgt = resolve_path::join_z_buf::<platform::Auto>(
                buf3.as_mut_slice(),
                &[tgt.as_bytes(), basename],
            );
            _copying_many = true;
        }

        let args = crate::node::fs::args::Cp::owned(
            src.as_bytes().to_vec(),
            tgt.as_bytes().to_vec(),
            crate::node::fs::args::CpFlags {
                recursive: self.opts.recursive,
                force: true,
                error_on_exist: false,
            },
        );

        // Pool thread: hand the copy to an fs.cp task bound to the loop and
        // poster this shell task captured on its own thread.
        let _ = crate::node::fs::ShellAsyncCpTask::create_for_shell(
            args,
            self.task.event_loop,
            poster.clone(),
            std::ptr::from_mut::<ShellCpTask>(self),
        );

        None
    }
}

// `runtime::dispatch::run_task`'s `task_tag::ShellCpTask` arm reboxes the
// pointer `ShellTask::on_finish` posted; a completion that will not run drops
// the keep-alive and the box.

impl crate::shell::interpreter::ShellTaskCtx for ShellCpTask {
    fn shell_task(&self) -> &ShellTask {
        &self.task
    }
    fn shell_task_mut(&mut self) -> &mut ShellTask {
        &mut self.task
    }
    fn run_from_thread_pool(&mut self) {
        // Not reached: the pool-side entry is `run_on_pool` (see the
        // `owned_task!` above), never `ShellTask::run_owned`.
        debug_assert!(false, "ShellCpTask runs run_on_pool on the pool");
    }
    fn run_from_main_thread(self: Box<Self>, interp: &Interpreter) {
        let cmd = self.cmd;
        Cp::on_shell_cp_task_done(interp, cmd, self);
    }
}

#[derive(Clone, Copy, Default)]
pub struct Opts {
    /// `-R` — copy file hierarchies
    pub(crate) recursive: bool,
    /// `-v` — verbose
    pub(crate) verbose: bool,
}

impl FlagParser for Opts {
    fn parse_long(&mut self, _flag: &[u8]) -> Option<ParseFlagResult> {
        None
    }

    fn parse_short(&mut self, ch: u8, smallflags: &[u8], i: usize) -> Option<ParseFlagResult> {
        match ch {
            b'f' => Some(ParseFlagResult::Unsupported(unsupported_flag(b"-f"))),
            b'H' => Some(ParseFlagResult::Unsupported(unsupported_flag(b"-H"))),
            b'i' => Some(ParseFlagResult::Unsupported(unsupported_flag(b"-i"))),
            b'L' => Some(ParseFlagResult::Unsupported(unsupported_flag(b"-L"))),
            b'P' => Some(ParseFlagResult::Unsupported(unsupported_flag(b"-P"))),
            b'p' => Some(ParseFlagResult::Unsupported(unsupported_flag(b"-P"))),
            b'R' => {
                self.recursive = true;
                Some(ParseFlagResult::ContinueParsing)
            }
            b'v' => {
                self.verbose = true;
                Some(ParseFlagResult::ContinueParsing)
            }
            b'n' => Some(ParseFlagResult::ContinueParsing),
            _ => Some(ParseFlagResult::IllegalOption(smallflags[i..].into())),
        }
    }
}
