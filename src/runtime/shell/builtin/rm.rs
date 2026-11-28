use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

use bun_core::{ZBox, ZStr, strings};
use bun_event_loop::AnyTaskWithExtraContext::MiniTask;
use bun_paths::Path;
use bun_ptr::BackRef;
use bun_sys::{E, File, Maybe, dir_iterator};

use crate::node::fs::{
    find_embedded_shell_folder, forget_shell_operand, is_on_disk_at, note_found_on_disk,
};
use crate::shell::builtin::{BadFlag, Builtin, Kind};
use crate::shell::builtins::batch::Batch;
use crate::shell::interpreter::{
    Interpreter, NodeId, ShellTask, WorkPoolTask, names_two_files, shell_openat,
};
use crate::shell::yield_::Yield;

const USAGE: &[u8] = b"usage: rm [-f | -i] [-dIPRrvWx] file ...\n       unlink [--] file\n";

#[derive(Clone, Copy, Default)]
pub(crate) struct Opts {
    /// `-f`, `--force` — ignore nonexistent files and arguments, never prompt.
    pub(crate) force: bool,
    /// `-i`, `-I`, `--interactive`
    interactive: bool,
    /// `-r`, `-R`, `--recursive`
    pub(crate) recursive: bool,
    /// `-v`, `--verbose`
    pub(crate) verbose: bool,
    /// `-d`, `--dir` — remove empty directories without `-r`.
    pub(crate) remove_empty_dirs: bool,
}

impl Opts {
    fn parse<'a>(&mut self, flag: &'a [u8]) -> Result<(), BadFlag<'a>> {
        match flag {
            b"--preserve-root" | b"--no-preserve-root" => {}
            b"--recursive" => self.recursive = true,
            b"--verbose" => self.verbose = true,
            b"--dir" => self.remove_empty_dirs = true,
            b"--interactive=never" => self.interactive = false,
            b"--interactive=once" | b"--interactive=always" => self.interactive = true,
            [_, b'-', ..] => return Err(BadFlag::Illegal(b"-")),
            [] => {}
            [_, letters @ ..] => {
                for ch in letters {
                    match ch {
                        b'f' => (self.force, self.interactive) = (true, false),
                        b'r' | b'R' => self.recursive = true,
                        b'v' => self.verbose = true,
                        b'd' => self.remove_empty_dirs = true,
                        b'i' | b'I' => self.interactive = true,
                        _ => return Err(BadFlag::Illegal(letters)),
                    }
                }
            }
        }
        Ok(())
    }
}

pub(crate) fn start(interp: &Interpreter, cmd: NodeId) -> Yield {
    note_found_on_disk();
    let (flags, paths) = Builtin::of(interp, cmd).split_flags();
    let mut opts = Opts::default();
    if let Err(flag) = flags.iter().try_for_each(|flag| opts.parse(flag)) {
        return Builtin::fail_flag(interp, cmd, flag);
    }
    if paths.is_empty() {
        return Builtin::fail_usage(interp, cmd, USAGE);
    }
    if opts.interactive {
        return Builtin::fail(interp, cmd, format_args!("\"-i\" is not supported yet"));
    }

    // Check that none of the paths will delete the root.
    let cwd_path = Builtin::shell(interp, cmd).cwd();
    for path in paths {
        let resolved = match bun_paths::is_absolute(path) {
            true => Path::from(path),
            false => Path::join(&[cwd_path, path]),
        };
        // A root, or what is directly in `/`.
        if (Path::resolve(&[resolved.as_bytes()]).dirname()).is_none_or(|parent| parent.len() == 1)
        {
            let resolved = bstr::BStr::new(resolved.as_bytes());
            return Builtin::fail(
                interp,
                cmd,
                format_args!("\"{resolved}\" may not be removed\n"),
            );
        }
    }

    Batch::start(interp, cmd, paths.len());
    let bltn = Builtin::of(interp, cmd);
    let (stop, running) = (BackRef::new(&bltn.stop), BackRef::new(&bltn.running));
    let cwd = Builtin::cwd(interp, cmd);
    for path in paths {
        ShellRmTask::schedule(interp, cmd, opts, path, cwd, stop, running);
    }
    Yield::suspended()
}

fn on_shell_rm_task_done(interp: &Interpreter, mut task: Box<ShellRmTask>) {
    let cmd = task.cmd;
    let task_err = task.err.get_mut().take();
    let operand = task.operand.as_bytes();
    let (is_recursive, was_on_disk) = (task.opts.recursive, task.was_on_disk);
    let cwd = Builtin::shell(interp, cmd).cwd();
    let find_folder = || find_embedded_shell_folder(cwd, operand).filter(|_| !is_recursive);
    let task_err = task_err.or_else(find_folder);
    if task_err.is_none() {
        forget_shell_operand(cwd, operand, was_on_disk);
    }
    drop(task);
    let err = task_err.map(|e| Kind::Rm.task_error(&e));
    Batch::report(interp, cmd, err, Vec::new()).run(interp);
}

// ──────────────────────────────────────────────────────────────────────────
// ShellRmTask — per-filepath-arg recursive delete tree
// ──────────────────────────────────────────────────────────────────────────

/// On Windows we allow posix path separators, but `path.join` uses the
/// platform separator: `foo/bar` + `baz` → `foo/bar\baz`. Detect which path
/// separator the user is using and prefer that. If both are used, pick the
/// first one.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum JoinStyle {
    Posix,
    Windows,
}

impl JoinStyle {
    fn from_path(p: &[u8]) -> JoinStyle {
        if cfg!(unix) {
            return JoinStyle::Posix;
        }
        let backslash = strings::index_of_char_usize(p, b'\\').unwrap_or(usize::MAX);
        let forwardslash = strings::index_of_char_usize(p, b'/').unwrap_or(usize::MAX);
        if forwardslash <= backslash {
            JoinStyle::Posix
        } else {
            JoinStyle::Windows
        }
    }
}

/// What `unlink` made of a path.
enum Unlinked {
    Done,
    IsDir,
    #[cfg(not(any(target_os = "linux", target_os = "android")))]
    NotEmpty,
}

/// Who finishes a [`DirTask`], but for the TODO in `remove_entry_dir_after_children`.
enum Owner {
    ThisThread,
    /// It, and the [`ShellRmTask`], may be freed already.
    LastChild,
}

/// One per filepath argument; tracks the cross-thread error state.
pub(crate) struct ShellRmTask {
    pub(crate) cmd: NodeId,
    pub(crate) opts: Opts,
    pub(crate) cwd: bun_sys::Fd,
    operand: ZBox,
    /// [`Builtin::stop`]
    pub(crate) error_signal: BackRef<AtomicBool>,
    /// [`Builtin::running`]: a [`DirTask`] with something to print reports too.
    running: BackRef<AtomicUsize>,
    /// First error hit by any worker thread. Mutex-wrapped so [`handle_err`]
    /// can take `&self` without an interior `&mut` cast.
    pub(crate) err: bun_threading::Guarded<Option<bun_sys::Error>>,
    pub(crate) join_style: JoinStyle,
    was_on_disk: bool,
    pub task: ShellTask,
}

/// One per directory in the recursive walk.
pub(crate) struct DirTask {
    /// A box: the root takes it back in [`DirTask::post_run`].
    pub(crate) task_manager: *mut ShellRmTask,
    pub(crate) parent_task: *mut DirTask,
    /// `None` for the root, which removes [`ShellRmTask::operand`].
    path: Option<ZBox>,
    /// One for itself and one per child. Whoever takes it to 0 is the [`Owner`].
    pub(crate) subtask_count: AtomicUsize,
    pub(crate) deleted_entries: Vec<u8>,
    /// As `ShellTask::interp`, for the verbose write: it can outlive the [`ShellRmTask`].
    interp: *mut Interpreter,
    cmd: NodeId,
    /// Intrusive node for the verbose-write bounce-back to the main thread.
    pub(crate) concurrent_task: bun_event_loop::EventLoopTask,
    /// Intrusive node for the thread-pool dispatch.
    pub(crate) work_task: WorkPoolTask,
}

impl ShellRmTask {
    /// Not a `PoolTask`: the `DirTask` tree posts it back, in [`DirTask::post_run`].
    fn schedule(
        interp: &Interpreter,
        cmd: NodeId,
        opts: Opts,
        root_path: &[u8],
        cwd: bun_sys::Fd,
        error_signal: BackRef<AtomicBool>,
        running: BackRef<AtomicUsize>,
    ) {
        let this = bun_core::heap::alloc(ShellRmTask {
            cmd,
            opts,
            cwd,
            operand: ZBox::from_bytes(root_path),
            error_signal,
            running,
            err: bun_threading::Guarded::new(None),
            join_style: JoinStyle::from_path(root_path),
            was_on_disk: !root_path.is_empty() && is_on_disk_at(cwd, root_path),
            task: ShellTask::new(interp),
        });
        DirTask::schedule(this, core::ptr::null_mut(), None, interp.as_ctx_ptr(), cmd);
    }

    fn is_stopped(&self) -> bool {
        self.error_signal.load(Ordering::SeqCst)
    }

    /// Spawns a child DirTask for the directory at `path`.
    fn enqueue(&self, parent: *mut DirTask, path: ZBox) {
        if self.is_stopped() {
            return;
        }
        // SAFETY: `parent` is live until its `subtask_count` drains to 0. Its `task_manager` can be
        // written through, which a pointer made from `&self` could not.
        let task_manager = unsafe {
            let count = (*parent).subtask_count.fetch_add(1, Ordering::Relaxed);
            debug_assert!(count > 0);
            (*parent).task_manager
        };
        DirTask::schedule(task_manager, parent, Some(path), self.task.interp, self.cmd);
    }

    /// Takes `dir_task` as a raw pointer (not `&mut DirTask`) so callers in
    /// `remove_entry*` — which already hold `&self: &ShellRmTask` and a
    /// `&ZStr` borrowed from `dir_task.path` — never materialise an aliasing
    /// `&mut DirTask`. Only the disjoint `deleted_entries` field is reborrowed
    /// mutably here.
    fn verbose_deleted(&self, dir_task: *mut DirTask, path: &[u8]) {
        if !self.opts.verbose {
            return;
        }
        // SAFETY: a DirTask's non-atomic fields are single-owner-at-a-time.
        // Ownership starts on the worker that runs `remove_entry*` and is
        // handed off via `subtask_count`: the parent's final append here is
        // sequenced-before its `subtask_count.fetch_sub(SeqCst)` in
        // `remove_entry`, and the child taking the counter to 0 in
        // `post_run` acquire-reads from that release sequence before
        // re-entering via `delete_after_waiting_for_children`. That pair
        // makes prior `deleted_entries` writes visible to the new owner, so
        // this `&mut` is exclusive and race-free. The reborrow is also
        // disjoint from every other live borrow (`&self`, `path`).
        let entries = unsafe { &mut (*dir_task).deleted_entries };
        if entries.is_empty() {
            self.running.fetch_add(1, Ordering::SeqCst);
        }
        entries.extend_from_slice(path);
        entries.push(b'\n');
    }

    /// `-f` passes over what is not there.
    fn forgive(&self, dir_task: *mut DirTask, path: &ZStr, e: &bun_sys::Error) -> Maybe<()> {
        if e.get_errno() != E::ENOENT || !self.opts.force {
            return Err(e.with_path(path));
        }
        self.verbose_deleted(dir_task, path);
        Ok(())
    }

    fn join_in_style(&self, parent: &[u8], name: &[u8]) -> Path {
        let mut path = Path::join(&[parent, name]);
        if self.join_style == JoinStyle::Posix {
            bun_paths::to_portable_in_place(path.as_mut_slice());
        }
        path
    }

    /// A relative path is not normalized.
    fn join(parent: &[u8], name: &[u8]) -> ZBox {
        if bun_paths::is_absolute(parent) {
            return Path::join(&[parent, name]).to_zbox();
        }
        let mut path = Path::from(parent);
        path.push(name);
        path.to_zbox()
    }

    /// Removes what takes no walk. `Some` is the directory to walk.
    fn remove_or_open(&self, dir_task: *mut DirTask, path: &ZStr) -> Maybe<Option<File>> {
        // SAFETY: `dir_task` is live; this thread owns it.
        let is_operand = unsafe { (*dir_task).parent_task.is_null() };
        // NT opens the working directory for an empty name.
        if cfg!(windows) && path.is_empty() {
            let missing = bun_sys::Error::from_code(E::ENOENT, bun_sys::Tag::unlink);
            return self.forgive(dir_task, path, &missing).map(|()| None);
        }
        if names_two_files(path) {
            return Err(bun_sys::Error::from_code(E::EINVAL, bun_sys::Tag::unlink).with_path(path));
        }
        if is_operand && let Unlinked::Done = self.remove_entry_file(dir_task, path)? {
            return Ok(None);
        }

        if !self.opts.recursive {
            if self.opts.remove_empty_dirs {
                match bun_sys::rmdirat(self.cwd, path) {
                    Ok(()) => {
                        self.verbose_deleted(dir_task, path);
                        return Ok(None);
                    }
                    Err(e) if e.get_errno() == E::ENOTDIR => {
                        if let Unlinked::Done = self.remove_entry_file(dir_task, path)? {
                            return Ok(None);
                        }
                    }
                    Err(e) => return self.forgive(dir_task, path, &e).map(|()| None),
                }
            }
            return Err(bun_sys::Error::from_code(E::EISDIR, bun_sys::Tag::TODO).with_path(path));
        }

        // The entry was classified as a directory before this open (readdir
        // type, or unlinkat returning EISDIR/EPERM). NOFOLLOW keeps a symlink
        // swapped in between classification and open from redirecting the
        // recursive delete into an unrelated tree (same as Dir::delete_tree).
        let flags = bun_sys::O::DIRECTORY | bun_sys::O::RDONLY | bun_sys::O::NOFOLLOW;
        match shell_openat(self.cwd, path, flags, 0) {
            Ok(fd) => Ok(Some(File::from_fd(fd))),
            Err(e) if e.get_errno() == E::ENOTDIR => {
                self.remove_entry_file(dir_task, path).map(|_| None)
            }
            Err(e) => self.forgive(dir_task, path, &e).map(|()| None),
        }
    }

    fn remove_entry(&self, dir_task: *mut DirTask) -> Maybe<Owner> {
        // SAFETY: `dir_task` is live; this thread owns it. `path` is read-only after construction.
        let path: &ZStr = unsafe { (*dir_task).path.as_ref() }.unwrap_or(&self.operand);
        let Some(dir) = self.remove_or_open(dir_task, path)? else {
            return Ok(Owner::ThisThread);
        };
        if self.is_stopped() {
            return Ok(Owner::ThisThread);
        }

        let mut iterator = dir_iterator::iterate(dir.fd());
        // No return from inside the loop: children may be out, and only the hand-off below accounts for them.
        let mut i: usize = 0;
        let loop_result: Maybe<()> = loop {
            let current = match iterator.next() {
                Err(e) => break Err(e.with_path(path)),
                Ok(None) => break Ok(()),
                Ok(Some(ent)) => ent,
            };
            // TODO this seems bad maybe better to listen to kqueue/epoll event
            if (i & 3) == 0 && self.is_stopped() {
                break Ok(());
            }
            i += 1;
            let name = current.name.slice_u8();
            if current.kind == bun_sys::EntryKind::Directory {
                self.enqueue(dir_task, Self::join(path, name));
                continue;
            }
            let file_path = self.join_in_style(path, name);
            match self.remove_entry_file(dir_task, &file_path) {
                Ok(Unlinked::Done) => {}
                Ok(_) => self.enqueue(dir_task, file_path.to_zbox()),
                Err(e) => break Err(e),
            }
        };

        // Before the hand-off, after which `self` may be freed.
        if let Err(e) = loop_result {
            self.handle_err(e);
        }

        // SAFETY: `dir_task` is live until `subtask_count` drains to 0, and this thread holds a count.
        unsafe {
            if (*dir_task).subtask_count.fetch_sub(1, Ordering::SeqCst) != 1 {
                return Ok(Owner::LastChild);
            }
            // No child is left. Restore the count that `post_run` releases.
            (*dir_task).subtask_count.store(1, Ordering::SeqCst);
        }

        if self.is_stopped() {
            return Ok(Owner::ThisThread);
        }

        // Close BEFORE deleting on Windows.
        #[cfg(windows)]
        drop(dir);

        match bun_sys::rmdirat(self.cwd, path) {
            Ok(()) => self.verbose_deleted(dir_task, path),
            Err(e) if e.get_errno() == E::ENOENT => self.forgive(dir_task, path, &e)?,
            Err(e) => return Err(e),
        }
        Ok(Owner::ThisThread)
    }

    fn remove_entry_dir_after_children(&self, dir_task: *mut DirTask) -> Maybe<Owner> {
        // SAFETY: `dir_task` is live; this thread owns it.
        let path: &ZStr = unsafe { (*dir_task).path.as_ref() }.unwrap_or(&self.operand);
        loop {
            match bun_sys::rmdirat(self.cwd, path) {
                Ok(()) => {
                    self.verbose_deleted(dir_task, path);
                    return Ok(Owner::ThisThread);
                }
                Err(e) if e.get_errno() == E::ENOTDIR => {}
                Err(e) => return self.forgive(dir_task, path, &e).map(|()| Owner::ThisThread),
            }
            match self.remove_entry_file(dir_task, path)? {
                Unlinked::Done => return Ok(Owner::ThisThread),
                Unlinked::IsDir => {}
                // TODO: this task's own count is never released: no child is the last, and `rm` hangs.
                #[cfg(not(any(target_os = "linux", target_os = "android")))]
                Unlinked::NotEmpty => {
                    self.enqueue(dir_task, path.to_zbox());
                    return Ok(Owner::LastChild);
                }
            }
        }
    }

    fn remove_entry_file(&self, dir_task: *mut DirTask, path: &ZStr) -> Maybe<Unlinked> {
        let Err(e) = bun_sys::unlinkat(self.cwd, path) else {
            self.verbose_deleted(dir_task, path);
            return Ok(Unlinked::Done);
        };
        match e.get_errno() {
            E::EISDIR => Ok(Unlinked::IsDir),
            // What these systems say of a directory, and of a file that may not be removed.
            #[cfg(not(any(target_os = "linux", target_os = "android")))]
            E::EPERM => {
                if !self.opts.recursive && !self.opts.remove_empty_dirs {
                    return Ok(Unlinked::IsDir);
                }
                let Err(as_dir) = bun_sys::rmdirat(self.cwd, path) else {
                    self.verbose_deleted(dir_task, path);
                    return Ok(Unlinked::Done);
                };
                match as_dir.get_errno() {
                    E::ENOTEMPTY => Ok(Unlinked::NotEmpty),
                    E::ENOTDIR => Err(e.with_path(path)),
                    _ => Err(as_dir.with_path(path)),
                }
            }
            _ => self.forgive(dir_task, path, &e).map(|()| Unlinked::Done),
        }
    }

    fn handle_err(&self, err: bun_sys::Error) {
        let mut slot = self.err.lock();
        if slot.is_none() {
            *slot = Some(err);
            self.error_signal.store(true, Ordering::SeqCst);
        }
    }
}

// ── DirTask ────────────────────────────────────────────────────────────────

impl DirTask {
    fn schedule(
        task_manager: *mut ShellRmTask,
        parent_task: *mut DirTask,
        path: Option<ZBox>,
        interp: *mut Interpreter,
        cmd: NodeId,
    ) {
        let this = bun_core::heap::alloc(DirTask {
            task_manager,
            parent_task,
            path,
            subtask_count: AtomicUsize::new(1),
            deleted_entries: Vec::new(),
            interp,
            cmd,
            concurrent_task: Default::default(),
            work_task: WorkPoolTask {
                node: Default::default(),
                callback: DirTask::work_pool_callback,
            },
        });
        // SAFETY: freshly allocated.
        bun_threading::work_pool::WorkPool::schedule(unsafe { &raw mut (*this).work_task });
    }

    /// Recover `*mut DirTask` from the intrusive `*WorkPoolTask`.
    unsafe fn work_pool_callback(task: *mut WorkPoolTask) {
        // SAFETY: `work_task` is at a fixed offset within DirTask; `this` is a live DirTask owned by
        // this worker thread. `task_manager` is another allocation, live until the root finishes.
        unsafe {
            let this = bun_core::from_field_ptr!(DirTask, work_task, task);
            Self::post_run(this, (*(*this).task_manager).remove_entry(this));
        }
    }

    /// # Safety
    /// `this` is a live DirTask; called from a worker thread that just
    /// finished its body.
    unsafe fn post_run(this: *mut DirTask, result: Maybe<Owner>) {
        match result {
            Ok(Owner::LastChild) => return,
            Ok(Owner::ThisThread) => {}
            // SAFETY: an error is never returned after the hand-off.
            Err(e) => unsafe { (*(*this).task_manager).handle_err(e) },
        }
        // SAFETY: caller contract. Nothing else uses a DirTask whose count is 0, or the
        // `task_manager` of a root that is done. Until then both it and `parent_task` are live.
        unsafe {
            // We have executed all the children of this task.
            if (*this).subtask_count.fetch_sub(1, Ordering::SeqCst) == 1 {
                let me = bun_core::heap::take(this);
                let (parent_task, task_manager) = (me.parent_task, me.task_manager);
                let tm = &*task_manager;

                // Before the parent's decrement, which can finish the root and with it the poster.
                if tm.opts.verbose && !me.deleted_entries.is_empty() {
                    let poster = tm.task.poster.as_ref().expect("held on the pool");
                    poster.post_intrusive(me, |me| &mut me.concurrent_task);
                } else {
                    drop(me);
                }

                // If we have a parent and we are the last child, now we can delete the parent.
                if !parent_task.is_null() {
                    // Reading 1 synchronizes with the parent's own release, which follows its last write.
                    if (*parent_task).subtask_count.fetch_sub(1, Ordering::SeqCst) == 1 {
                        Self::delete_after_waiting_for_children(parent_task);
                    }
                    return;
                }

                let mut tm = bun_core::heap::take(task_manager);
                let poster = tm.task.take_poster();
                poster.post_intrusive(tm, |tm| &mut tm.task.concurrent_task);
            }
        }
        // Otherwise need to wait.
    }

    /// # Safety
    /// `this` is a live DirTask; called from a worker thread.
    unsafe fn delete_after_waiting_for_children(this: *mut DirTask) {
        // SAFETY: caller contract. `task_manager` is another allocation, live until the root finishes.
        unsafe {
            // The caller took it to 0. Restore the count that `post_run` releases.
            (*this).subtask_count.store(1, Ordering::SeqCst);
            let tm = &*(*this).task_manager;
            let result = if tm.is_stopped() {
                Ok(Owner::ThisThread)
            } else {
                tm.remove_entry_dir_after_children(this)
            };
            Self::post_run(this, result);
        }
    }
}

impl bun_event_loop::BoxedTask for ShellRmTask {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::ShellRmTask;
    fn release_unrun(self: Box<Self>) {}
    /// See [`ShellTask`]: a step of a shell script always runs.
    fn context(&self) -> bun_event_loop::ContextId {
        bun_event_loop::ContextId::NONE
    }
}

impl MiniTask for ShellRmTask {
    fn run_from_main_thread(self: Box<Self>) {
        // SAFETY: see the field; this is its thread.
        on_shell_rm_task_done(unsafe { &*self.task.interp }, self);
    }
}

impl bun_event_loop::BoxedTask for DirTask {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::ShellRmDirTask;
    fn release_unrun(self: Box<Self>) {}
    /// See [`ShellTask`]: a step of a shell script always runs.
    fn context(&self) -> bun_event_loop::ContextId {
        bun_event_loop::ContextId::NONE
    }
}

impl MiniTask for DirTask {
    /// Flush verbose output.
    fn run_from_main_thread(self: Box<Self>) {
        // SAFETY: see the field; this is its thread.
        let interp = unsafe { &*self.interp };
        Batch::report(interp, self.cmd, None, self.deleted_entries).run(interp);
    }
}
