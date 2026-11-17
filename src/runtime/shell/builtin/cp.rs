use bstr::BStr;
use bun_jsc::ThreadIsolated;
use bun_paths::resolve_path;

use crate::node::PathLike;
use crate::node::fs::{ShellAsyncCpTask, args};
use crate::shell::ShellErr;
use crate::shell::builtin::{BadFlag, Builtin, Kind};
use crate::shell::builtins::batch::Batch;
use crate::shell::interpreter::{
    Interpreter, NodeId, ShellTask, ShellTaskCtx, shell_join_path, shell_resolve_operand,
};
use crate::shell::yield_::Yield;

const USAGE: &[u8] = b"usage: cp [-R [-H | -L | -P]] [-fi | -n] [-aclpsvXx] source_file target_file\n       cp [-R [-H | -L | -P]] [-fi | -n] [-aclpsvXx] source_file ... target_directory\n";

pub(crate) fn start(interp: &Interpreter, cmd: NodeId) -> Yield {
    let (flags, operands) = Builtin::of(interp, cmd).split_flags();
    let mut opts = Opts::default();
    if let Err(flag) = flags.iter().try_for_each(|flag| opts.parse(flag)) {
        return Builtin::fail_flag(interp, cmd, flag);
    }
    let Some((tgt, sources @ [_, ..])) = operands.split_last() else {
        return Builtin::fail_usage(interp, cmd, USAGE);
    };
    Batch::start(interp, cmd, sources.len());
    for src in sources {
        ShellCpTask::schedule(interp, cmd, opts, operands.len(), src, tgt);
    }
    Yield::suspended()
}

/// On Windows it is possible to get an EBUSY error very simply by running
/// `cp myfile.txt myfile.txt mydir/` — two tasks race for the same dest. Bun
/// ignores the EBUSY if at least one task succeeded for that dest.
#[cfg(windows)]
#[derive(Default)]
pub(crate) struct Ebusy {
    /// Held back until every task has reported.
    tasks: std::collections::VecDeque<Box<ShellCpTask>>,
    /// What some task copied successfully.
    absolute_targets: bun_collections::StringSet,
    absolute_srcs: bun_collections::StringSet,
}

#[cfg(windows)]
impl Ebusy {
    /// `None` if it keeps `task`.
    fn admit(&mut self, mut task: Box<ShellCpTask>) -> Option<Box<ShellCpTask>> {
        let Some(err) = &task.err else {
            if let Some(tgt) = task.tgt_absolute.take() {
                bun_core::handle_oom(self.absolute_targets.insert(&tgt));
            }
            if let Some(src) = task.src_absolute.take() {
                bun_core::handle_oom(self.absolute_srcs.insert(&src));
            }
            return Some(task);
        };
        let ShellErr::Sys(sys) = err else {
            return Some(task);
        };
        let is_about = |path: &Option<Vec<u8>>| path.as_ref().is_some_and(|p| sys.path.eql_utf8(p));
        // An error about the source is held back whatever its errno.
        if (sys.get_errno() == bun_sys::E::EBUSY && is_about(&task.tgt_absolute))
            || is_about(&task.src_absolute)
        {
            self.tasks.push_back(task);
            return None;
        }
        Some(task)
    }

    /// Skips the tasks whose source or target another task has copied.
    pub(crate) fn next_failure(&mut self) -> Option<(Option<Vec<u8>>, Vec<u8>)> {
        let has = |set: &bun_collections::StringSet, path: &Option<Vec<u8>>| {
            path.as_ref().is_some_and(|p| set.contains(p))
        };
        loop {
            let task = self.tasks.pop_front()?;
            if !has(&self.absolute_targets, &task.tgt_absolute)
                && !has(&self.absolute_srcs, &task.src_absolute)
            {
                return Some(task.take_report());
            }
        }
    }
}

/// Resolves src/tgt to absolute paths, decides
/// which POSIX `cp` synopsis applies, then hands off to the node:fs async cp
/// implementation.
pub(crate) struct ShellCpTask {
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

/// Why nothing is copied for a source operand.
enum Stop {
    /// The destination stays as it is, and that is not an error.
    Skip,
    Fail(Box<ShellErr>),
}

impl From<bun_sys::Error> for Stop {
    fn from(e: bun_sys::Error) -> Stop {
        Stop::Fail(Box::new(ShellErr::new_sys(&e)))
    }
}

fn fail<T>(msg: String) -> Result<T, Stop> {
    Err(Stop::Fail(Box::new(ShellErr::Custom(
        msg.into_bytes().into_boxed_slice(),
    ))))
}

impl ShellCpTask {
    /// What goes to stderr, and to stdout.
    fn take_report(&self) -> (Option<Vec<u8>>, Vec<u8>) {
        let err = self.err.as_ref().map(|err| match err {
            ShellErr::Sys(sys) => {
                let words = BStr::new(sys.message.byte_slice());
                if sys.path.is_empty() {
                    Kind::Cp.message(format_args!("{words}\n"))
                } else {
                    Kind::Cp.message(format_args!("{words}: {}\n", sys.path))
                }
            }
            ShellErr::Custom(words) => Kind::Cp.message(format_args!("{}\n", BStr::new(words))),
        });
        (err, core::mem::take(&mut *self.verbose_output.lock()))
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
            let mut buf = bun_paths::path_buffer_pool::get();
            let mut buf2 = bun_paths::path_buffer_pool::get();
            let src8 = bun_paths::strings::from_wpath(&mut buf, src);
            let dest8 = bun_paths::strings::from_wpath(&mut buf2, dest);
            self.on_copy_impl(src8, dest8);
        }
    }

    /// The `ShellAsyncCpTask`'s completion, on the thread that runs the script.
    pub(crate) fn cp_on_finish(
        mut self: Box<Self>,
        src: PathLike<'static>,
        dest: PathLike<'static>,
        result: bun_sys::Maybe<()>,
    ) {
        self.src_absolute = Some(src.into_vec());
        self.tgt_absolute = Some(dest.into_vec());
        if let Err(e) = result {
            self.err = Some(ShellErr::new_sys(&e));
        }
        // SAFETY: the box `schedule` made, which `run_from_main_thread` takes back.
        unsafe { ShellTask::run_from_main_thread(bun_core::heap::into_raw(self)) };
    }

    /// Unlike most shell builtins this does NOT use the generic
    /// [`ShellTask::schedule`] trampoline (which auto-enqueues back to main
    /// on return): on the
    /// success path the [`ShellAsyncCpTask`](crate::node::fs::ShellAsyncCpTask)
    /// owns the bounce-back via `cp_on_finish`, so an unconditional post would
    /// double-enqueue. The embedded [`ShellTask`] is reused for its
    /// `WorkPoolTask` / `concurrent_task` / `keep_alive` storage.
    fn schedule(
        interp: &Interpreter,
        cmd: NodeId,
        opts: Opts,
        operands: usize,
        src: &[u8],
        tgt: &[u8],
    ) {
        use bun_threading::work_pool::WorkPool;
        let this = bun_core::heap::alloc(ShellCpTask {
            cmd,
            opts,
            operands,
            src: src.to_vec(),
            tgt: tgt.to_vec(),
            src_absolute: None,
            tgt_absolute: None,
            cwd_path: Builtin::shell(interp, cmd).cwd().to_vec(),
            verbose_output: bun_threading::Guarded::new(Vec::new()),
            err: None,
            task: ShellTask::new(interp),
        });
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
    /// intrusive `*WorkPoolTask`, resolve the operands, and post back immediately
    /// unless a copy was started (which defers the post to `cp_on_finish`).
    unsafe fn work_pool_callback(task: *mut crate::shell::interpreter::WorkPoolTask) {
        // SAFETY: `task` is embedded in the box that `schedule` gave to the pool.
        let mut this = unsafe { bun_core::heap::take(Self::from_work_task(task)) };
        match this.resolve() {
            Ok(args) => {
                let poster = this.task.poster.take();
                let poster = poster.expect("shell cp task on the pool is armed");
                return ShellAsyncCpTask::create_for_shell(args, poster, this);
            }
            Err(Stop::Fail(err)) => this.err = Some(*err),
            Err(Stop::Skip) => {}
        }
        // SAFETY: the queued task owns the box again.
        unsafe { ShellTask::on_finish(bun_core::heap::into_raw(this)) };
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

    fn same_inode(a: &bun_sys::Stat, b: &bun_sys::Stat) -> bool {
        // A filesystem without inode numbers reports `st_ino == 0`.
        a.st_ino != 0 && a.st_ino == b.st_ino && a.st_dev == b.st_dev
    }

    /// Runs the src/dest checks `fs.cp` does up front (node's `checkPaths` and
    /// `checkParentPaths`), so copying a directory into itself fails before
    /// anything is created. `appended` is the source basename if it was joined
    /// onto the target operand.
    fn check_paths(
        &self,
        src: &bun_core::ZStr,
        tgt: &bun_core::ZStr,
        appended: Option<&[u8]>,
    ) -> Result<(), Stop> {
        use bun_sys::S;
        use resolve_path::Platform;

        let src_shown = bstr::BStr::new(&self.src);
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

        // If lstat fails, let the copy report the error.
        let Ok(src_stat) = bun_sys::lstat(src) else {
            return Ok(());
        };
        // A symlink to a directory is copied as a link, so don't treat it as a directory.
        let src_is_dir = S::ISDIR(src_stat.st_mode as _);
        if let Ok(tgt_stat) = bun_sys::lstat(tgt) {
            // A directory is still merged into an existing one, without replacing its files.
            if self.opts.no_clobber && !src_is_dir {
                return Err(Stop::Skip);
            }
            if Self::same_inode(&src_stat, &tgt_stat) || src.as_bytes() == tgt.as_bytes() {
                // Only the same operand twice is an error. Scripts rely on `cp file .` exiting 0.
                if self.opts.no_clobber || appended.is_some() || src.as_bytes() != tgt.as_bytes() {
                    return Err(Stop::Skip);
                }
                return fail(format!(
                    "{src_shown} and {} are identical (not copied)",
                    bstr::BStr::new(&tgt_shown()),
                ));
            }
            let tgt_is_dir = S::ISDIR(tgt_stat.st_mode as _);
            if src_is_dir && !tgt_is_dir {
                return fail(format!(
                    "cannot overwrite non-directory {} with directory {src_shown}",
                    bstr::BStr::new(&tgt_shown()),
                ));
            }
            if !src_is_dir && tgt_is_dir {
                return fail(format!(
                    "cannot overwrite directory {} with non-directory {src_shown}",
                    bstr::BStr::new(&tgt_shown()),
                ));
            }
        }

        if !src_is_dir {
            return Ok(());
        }
        let into_itself = || {
            fail(format!(
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
            if let Ok(stat) = bun_sys::stat(bun_core::ZStr::nul_terminate(&mut path, parent.len()))
            {
                if Self::same_inode(&src_stat, &stat) {
                    return into_itself();
                }
            }
            ancestor = parent;
        }
        Ok(())
    }

    /// Resolves src/tgt to absolute paths, classifies them per the three
    /// POSIX `cp` synopses
    /// (<https://man7.org/linux/man-pages/man1/cp.1p.html>), and says what to copy.
    fn resolve(&self) -> Result<ThreadIsolated<args::Cp<'static>>, Stop> {
        // We have to give an absolute path to our cp implementation for it to
        // work with cwd.
        let src = shell_resolve_operand(bun_sys::Tag::copyfile, &self.cwd_path, &self.src)?;
        let mut tgt = shell_resolve_operand(bun_sys::Tag::copyfile, &self.cwd_path, &self.tgt)?;

        // Cases:
        //   SRC       DEST
        //   ----------------
        //   file   -> file
        //   file   -> folder
        //   folder -> folder
        // We need to check dest to see what it is; if it doesn't exist we
        // need to create it.
        let src_is_dir = Self::is_dir(&src)?;

        // Any source directory without -R is an error.
        if src_is_dir && !self.opts.recursive {
            return fail(format!(
                "{} is a directory (not copied)",
                bstr::BStr::new(&self.src)
            ));
        }

        let (tgt_is_dir, tgt_exists) = match Self::is_dir(&tgt) {
            Ok(is_dir) => (is_dir, true),
            Err(e) if e.get_errno() == bun_sys::E::ENOENT => {
                // If it has a trailing directory separator, it's a directory.
                (Self::has_trailing_sep(tgt.as_bytes()), false)
            }
            Err(e) => return Err(e.into()),
        };

        // Set to the source basename when it's joined onto `tgt`.
        let mut appended: Option<&[u8]> = None;

        // The following logic is based on the POSIX spec.
        if !src_is_dir && !tgt_is_dir && self.operands == 2 {
            // 1st synopsis: source_file -> target_file. Nothing to adjust.
        } else if self.opts.recursive {
            // 2nd synopsis: -R source_files... -> target.
            if tgt_exists {
                let basename = resolve_path::basename(src.as_bytes());
                tgt = shell_join_path(bun_sys::Tag::copyfile, &[tgt.as_bytes(), basename])?;
                appended = Some(basename);
            } else if self.operands == 2 {
                // source_dir -> new_target_dir.
            } else {
                return fail(format!(
                    "directory {} does not exist",
                    bstr::BStr::new(&self.tgt)
                ));
            }
        } else {
            // 3rd synopsis: source_files... -> target.
            if !tgt_exists || !tgt_is_dir {
                return fail(format!("{} is not a directory", bstr::BStr::new(&self.tgt)));
            }
            let basename = resolve_path::basename(src.as_bytes());
            tgt = shell_join_path(bun_sys::Tag::copyfile, &[tgt.as_bytes(), basename])?;
            appended = Some(basename);
        }

        self.check_paths(&src, &tgt, appended)?;

        Ok(args::Cp::owned(
            src.as_bytes().to_vec(),
            tgt.as_bytes().to_vec(),
            args::CpFlags {
                recursive: self.opts.recursive,
                force: !self.opts.no_clobber,
                error_on_exist: false,
            },
        ))
    }
}

impl bun_event_loop::Taskable for ShellCpTask {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::ShellCpTask;
    unsafe fn release_unrun(this: *mut Self) {
        // SAFETY: fn contract — the box the builtin scheduled.
        unsafe { bun_core::heap::destroy(this) };
    }
    /// See [`ShellTaskCtx`](crate::shell::interpreter::ShellTaskCtx): a step of a shell script always runs.
    unsafe fn context(_: *const Self) -> bun_event_loop::ContextId {
        bun_event_loop::ContextId::NONE
    }
}

impl ShellTaskCtx for ShellCpTask {
    const TASK_OFFSET: usize = core::mem::offset_of!(Self, task);
    fn run_from_thread_pool(_this: &mut Self) {
        // Not reached: `ShellCpTask::schedule` installs `work_pool_callback`
        // directly (the generic trampoline auto-posts back, which would
        // double-enqueue when the `ShellAsyncCpTask` later calls
        // `cp_on_finish`).
        debug_assert!(
            false,
            "ShellCpTask scheduled via ShellTask::schedule; use ShellCpTask::schedule"
        );
    }
    fn run_from_main_thread(this: *mut Self, interp: &Interpreter) {
        // SAFETY: `ShellTask::run_from_main_thread` dispatch contract — `this`
        // is the live heap-allocated task posted via `ShellTask::schedule`.
        let task = unsafe { bun_core::heap::take(this) };
        let cmd = task.cmd;
        #[cfg(windows)]
        let Some(batch) = Batch::of(interp, cmd) else {
            return;
        };
        #[cfg(windows)]
        let Some(task) = batch.ebusy.get_or_insert_default().admit(task) else {
            let running = &Builtin::of(interp, cmd).running;
            running.fetch_sub(1, core::sync::atomic::Ordering::SeqCst);
            return Batch::settle(interp, cmd).run(interp);
        };
        let (err, out) = task.take_report();
        drop(task);
        Batch::report(interp, cmd, err, out).run(interp);
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

impl Opts {
    fn parse<'a>(&mut self, flag: &'a [u8]) -> Result<(), BadFlag<'a>> {
        // Only the first flag of a group is rejected. Scripts rely on `-Rp` and `-Rf` working.
        match flag {
            [_, b'R' | b'v' | b'n', ..] => {}
            [_, b'f' | b'H' | b'i' | b'L' | b'P', ..] => {
                return Err(BadFlag::Unsupported(&flag[..2]));
            }
            [_, b'p', ..] => return Err(BadFlag::Unsupported(b"-P")),
            [] | [_] => return Err(BadFlag::Illegal(flag)),
            [_, letters @ ..] => return Err(BadFlag::Illegal(letters)),
        }
        for ch in flag {
            match ch {
                b'R' => self.recursive = true,
                b'v' => self.verbose = true,
                b'n' => self.no_clobber = true,
                _ => {}
            }
        }
        Ok(())
    }
}
