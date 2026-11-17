use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

use bun_core::{ZBox, ZStr, strings};
use bun_paths::resolve_path::{self, Platform, platform};
use bun_ptr::{AliasableBox, BackRef, RefPtr};
use bun_sys::{E, File, Maybe, dir_iterator};

use crate::node::fs::{
    find_embedded_shell_folder, forget_shell_operand, is_on_disk_at, note_found_on_disk,
};
use crate::shell::builtin::{BadFlag, Builtin, Kind};
use crate::shell::builtins::batch::Batch;
use crate::shell::interpreter::{
    EventLoopHandle, Interpreter, NodeId, ShellTask, WorkPoolTask, shell_openat,
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
    // Operands can be longer than the fixed-size buffers behind `join` and `normalize_string`.
    let mut join_spill = Vec::new();
    let mut normalize_buf = Vec::new();
    for path in paths {
        let resolved: &[u8] = if Platform::AUTO.is_absolute(path) {
            path
        } else {
            resolve_path::join_spill::<platform::Auto>(&mut join_spill, &[cwd_path, path])
        };
        // Normalizing adds at most one byte.
        if normalize_buf.len() <= resolved.len() {
            normalize_buf.resize(resolved.len() + 1, 0);
        }
        let normalized = resolve_path::normalize_string_buf::<false, platform::Auto, false>(
            resolved,
            &mut normalize_buf[..],
        );
        if resolve_path::dirname::<platform::Auto>(normalized).is_empty() {
            let resolved = bstr::BStr::new(resolved);
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

fn on_shell_rm_task_done(interp: &Interpreter, task: RefPtr<ShellRmTask>) {
    let cmd = task.cmd;
    // SAFETY: the pool is done with the task.
    let task_err = unsafe { (*task.as_ptr()).err.get_mut().take() };
    let operand = task.root_task.path.as_bytes();
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

/// One per filepath argument; owns the root
/// [`DirTask`] and tracks the cross-thread error state.
#[derive(bun_ptr::ThreadSafeRefCounted)]
pub(crate) struct ShellRmTask {
    pub(crate) cmd: NodeId,
    pub(crate) opts: Opts,
    pub(crate) cwd: bun_sys::Fd,
    /// The root DirTask lives in
    /// its own `heap::alloc`'d allocation so that `&ShellRmTask` (held as
    /// the `&self` receiver throughout `remove_entry*`) never overlaps the
    /// `&mut DirTask` borrows those methods take on the root — embedding it
    /// would make every `verbose_deleted` call on the root UB under Stacked
    /// Borrows.
    pub(crate) root_task: AliasableBox<DirTask>,
    /// [`Builtin::stop`]
    pub(crate) error_signal: BackRef<AtomicBool>,
    /// [`Builtin::running`]: a [`DirTask`] with something to print reports too.
    running: BackRef<AtomicUsize>,
    /// One per main-thread callback to come: its own, and each queued verbose write's.
    ref_count: bun_ptr::ThreadSafeRefCount<Self>,
    /// First error hit by any worker thread. Mutex-wrapped so [`handle_err`]
    /// can take `&self` without an interior `&mut` cast.
    pub(crate) err: bun_threading::Guarded<Option<bun_sys::Error>>,
    pub(crate) join_style: JoinStyle,
    was_on_disk: bool,
    pub task: ShellTask,
}

/// One per directory in the recursive
/// walk; root and children alike are heap-allocated (see the comment on
/// [`ShellRmTask::root_task`]).
pub(crate) struct DirTask {
    pub(crate) task_manager: *mut ShellRmTask,
    pub(crate) parent_task: *mut DirTask,
    pub path: ZBox,
    /// One for itself and one per child. Whoever takes it to 0 is the [`Owner`].
    pub(crate) subtask_count: AtomicUsize,
    pub(crate) deleted_entries: Vec<u8>,
    /// Held while `concurrent_task` is queued.
    write_ref: Option<RefPtr<ShellRmTask>>,
    /// Intrusive node for the verbose-write bounce-back to the main thread.
    pub(crate) concurrent_task: bun_event_loop::EventLoopTask,
    /// Intrusive node for the thread-pool dispatch.
    pub(crate) work_task: WorkPoolTask,
}

impl ShellRmTask {
    /// Not a `PoolTask`: the `DirTask` tree posts it back, in [`finish_concurrently`].
    fn schedule(
        interp: &Interpreter,
        cmd: NodeId,
        opts: Opts,
        root_path: &[u8],
        cwd: bun_sys::Fd,
        error_signal: BackRef<AtomicBool>,
        running: BackRef<AtomicUsize>,
    ) {
        use bun_threading::work_pool::WorkPool;
        // `task_manager` is filled in below.
        let (manager, parent) = (core::ptr::null_mut(), core::ptr::null_mut());
        let path = ZBox::from_bytes(root_path);
        let root_task = AliasableBox::new(DirTask::new(manager, parent, path, interp.event_loop));
        let this = bun_core::heap::alloc(ShellRmTask {
            cmd,
            opts,
            cwd,
            root_task,
            error_signal,
            running,
            ref_count: bun_ptr::ThreadSafeRefCount::init(),
            err: bun_threading::Guarded::new(None),
            join_style: JoinStyle::from_path(root_path),
            was_on_disk: is_on_disk_at(cwd, root_path),
            task: ShellTask::new(interp),
        });
        // SAFETY: both freshly allocated. Stay on raw pointers: once
        // `WorkPool::schedule` returns the worker thread may already be running.
        unsafe {
            (*(*this).root_task.as_ptr()).task_manager = this;
            let st = &raw mut (*this).task;
            (*st).task.callback = Self::work_pool_callback;
            (*st).keep_alive.ref_((*st).event_loop.as_event_loop_ctx());
            (*st).arm();
            WorkPool::schedule(&raw mut (*st).task);
        }
    }

    /// Recover `*ShellRmTask` from the intrusive `*WorkPoolTask` and run the
    /// root DirTask.
    unsafe fn work_pool_callback(task: *mut WorkPoolTask) {
        // SAFETY: `task` is the first `#[repr(C)]` field of `ShellTask`, which
        // is embedded in `ShellRmTask` at `TASK_OFFSET`. `this` is a live
        // heap-allocated task; the worker thread has exclusive access to
        // `root_task` until it spawns subtasks.
        unsafe {
            let this = <Self as crate::shell::interpreter::ShellTaskCtx>::from_work_task(task);
            DirTask::run_from_thread_pool_impl((*this).root_task.as_ptr());
        }
    }

    /// Post this task to the main-thread
    /// concurrent queue; routed by `dispatch.rs` → [`run_from_main_thread`].
    ///
    /// # Safety
    /// `this` is the live `heap::alloc`'d task; not touched again on this
    /// thread after return (unless a verbose write's ref keeps it alive).
    unsafe fn finish_concurrently(this: *mut ShellRmTask) {
        // SAFETY: caller contract.
        unsafe { ShellTask::on_finish::<ShellRmTask>(this) };
    }

    fn is_stopped(&self) -> bool {
        self.error_signal.load(Ordering::SeqCst)
    }

    /// Spawns a child DirTask for the directory at `path`.
    fn enqueue(&self, parent: *mut DirTask, path: ZBox) {
        if self.is_stopped() {
            return;
        }
        // SAFETY: `parent` is live; reuse its `task_manager` (preserves the
        // original `*mut` provenance from `heap::alloc` rather than deriving
        // a writeable pointer from `&self`).
        let task_manager = unsafe { (*parent).task_manager };
        let subtask = DirTask::new(task_manager, parent, path, self.task.event_loop);
        let subtask = bun_core::heap::alloc(subtask);
        // SAFETY: `parent` is live until its `subtask_count` drains to 0;
        // `subtask` is freshly heap-allocated.
        unsafe {
            let count = (*parent).subtask_count.fetch_add(1, Ordering::Relaxed);
            debug_assert!(count > 0);
            bun_threading::work_pool::WorkPool::schedule(&raw mut (*subtask).work_task);
        }
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

    /// Join into `buf` honoring [`join_style`].
    fn buf_join<'a>(
        &self,
        buf: &'a mut bun_paths::PathBuffer,
        spill: &'a mut Vec<u8>,
        parts: &[&[u8]],
    ) -> &'a ZStr {
        if self.join_style == JoinStyle::Posix {
            resolve_path::join_z_buf_spill::<platform::Posix>(buf.as_mut_slice(), spill, parts)
        } else {
            resolve_path::join_z_buf_spill::<platform::Windows>(buf.as_mut_slice(), spill, parts)
        }
    }

    /// A relative path is not normalized.
    fn join(parent: &[u8], name: &[u8]) -> ZBox {
        if Platform::AUTO.is_absolute(parent) {
            let mut spill = Vec::new();
            let joined = resolve_path::join_spill::<platform::Auto>(&mut spill, &[parent, name]);
            return ZBox::from_bytes(joined);
        }
        let mut out = Vec::with_capacity(parent.len() + name.len() + 2);
        out.extend_from_slice(parent);
        if !parent.last().is_some_and(|&c| bun_paths::is_sep_native(c)) {
            out.push(bun_paths::SEP);
        }
        out.extend_from_slice(name);
        ZBox::from_vec(out)
    }

    /// Removes what takes no walk. `Some` is the directory to walk.
    fn remove_or_open(&self, dir_task: *mut DirTask, path: &ZStr) -> Maybe<Option<File>> {
        // SAFETY: `dir_task` is live; this thread owns it.
        let is_operand = unsafe { (*dir_task).parent_task.is_null() };
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
        let path = unsafe { (*dir_task).path.as_zstr() };
        let Some(dir) = self.remove_or_open(dir_task, path)? else {
            return Ok(Owner::ThisThread);
        };
        if self.is_stopped() {
            return Ok(Owner::ThisThread);
        }

        let mut iterator = dir_iterator::iterate(dir.fd());
        let mut buf = bun_paths::path_buffer_pool::get();
        // No return from inside the loop: children may be out, and only the hand-off below accounts for them.
        let mut i: usize = 0;
        let mut join_spill = Vec::new();
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
            let file_path = self.buf_join(&mut buf, &mut join_spill, &[path, name]);
            match self.remove_entry_file(dir_task, file_path) {
                Ok(Unlinked::Done) => {}
                Ok(_) => self.enqueue(dir_task, ZBox::from_bytes(file_path.as_bytes())),
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
        let path = unsafe { (*dir_task).path.as_zstr() };
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
                    self.enqueue(dir_task, ZBox::from_bytes(path.as_bytes()));
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
    fn new(
        task_manager: *mut ShellRmTask,
        parent_task: *mut DirTask,
        path: ZBox,
        event_loop: EventLoopHandle,
    ) -> DirTask {
        DirTask {
            task_manager,
            parent_task,
            path,
            subtask_count: AtomicUsize::new(1),
            deleted_entries: Vec::new(),
            write_ref: None,
            concurrent_task: bun_event_loop::EventLoopTask::from_event_loop(event_loop),
            work_task: WorkPoolTask {
                node: Default::default(),
                callback: DirTask::work_pool_callback,
            },
        }
    }

    /// Recover `*mut DirTask` from the intrusive `*WorkPoolTask`.
    unsafe fn work_pool_callback(task: *mut WorkPoolTask) {
        // SAFETY: `work_task` is at a fixed offset within DirTask; `this` is a
        // live DirTask owned by this worker thread.
        unsafe {
            Self::run_from_thread_pool_impl(bun_core::from_field_ptr!(DirTask, work_task, task))
        };
    }

    /// # Safety
    /// `this` is a live DirTask (root or heap child); the calling worker
    /// thread has exclusive access to its non-atomic fields.
    unsafe fn run_from_thread_pool_impl(this: *mut DirTask) {
        // SAFETY: caller contract. `task_manager` is another allocation, live until the root finishes.
        unsafe { Self::post_run(this, (*(*this).task_manager).remove_entry(this)) };
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
        // SAFETY: caller contract — `this` is a live DirTask owned by the
        // calling worker thread. `me` is held only over atomic / read-only
        // field access; `task_manager` is a separate allocation live until
        // the root finishes; `parent_task` is live until its
        // `subtask_count` drains. `delete_after_waiting_for_children` and
        // `queue_for_write` re-derive from raw `*mut` (no overlap with `me`,
        // which is a `&` over atomics + Copy fields). Non-root `take_child`
        // reclaims `this`'s Box; `finish_concurrently` may free the root.
        unsafe {
            let me = &*this;
            // We have executed all the children of this task.
            if me.subtask_count.fetch_sub(1, Ordering::SeqCst) == 1 {
                let tm = &*me.task_manager;
                let will_queue_verbose = tm.opts.verbose && !me.deleted_entries.is_empty();

                // The verbose hop is posted while the rm task is still counted
                // work of its VM — i.e. before anything below can let the root
                // `finish_concurrently` (which releases that count) run: our
                // parent decrement can cascade into it, and for the root it is
                // the next statement. `this` may be freed by the JS thread once
                // posted, so what we still need is captured first.
                let (parent_task, task_manager) = (me.parent_task, me.task_manager);
                if will_queue_verbose {
                    Self::queue_for_write(this);
                } else {
                    drop(Self::take_child(this));
                }

                // If we have a parent and we are the last child, now we can delete the parent.
                if !parent_task.is_null() {
                    let p = &*parent_task;
                    // Reading 1 synchronizes with the parent's own release, which follows its last write.
                    if p.subtask_count.fetch_sub(1, Ordering::SeqCst) == 1 {
                        Self::delete_after_waiting_for_children(parent_task);
                    }
                    return;
                }

                // Root task: hand it back. It may be freed at any time after
                // this unless the verbose hop's ref keeps it.
                ShellRmTask::finish_concurrently(task_manager);
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

    /// Post this DirTask to the main thread to print what it deleted.
    ///
    /// # Safety
    /// `this` is a live DirTask whose root has not finished.
    unsafe fn queue_for_write(this: *mut DirTask) {
        use bun_event_loop::EventLoopTask;
        // SAFETY: caller contract.
        let (me, rm) = unsafe { (&mut *this, RefPtr::init_ref((*this).task_manager)) };
        let poster = rm.task.poster.as_ref();
        let poster = poster.expect("rm root task on the pool is armed").clone();
        me.write_ref = Some(rm);
        match &mut me.concurrent_task {
            EventLoopTask::Js(ct) => {
                poster.post_js_intrusive(core::ptr::NonNull::from(ct.from(this)));
            }
            EventLoopTask::Mini(at) => {
                let at = at.from(this, dir_task_run_from_main_thread_mini);
                poster.post_mini(core::ptr::NonNull::new(at).expect("intrusive task"));
            }
        }
    }

    /// Flush verbose output.
    ///
    /// Reached only via `runtime::dispatch::run_task` for
    /// `task_tag::ShellRmDirTask` (or the mini-loop trampoline below), which
    /// always passes a live DirTask posted via [`queue_for_write`].
    ///
    /// # Safety
    /// `this` must be a live [`DirTask`] posted via [`queue_for_write`]; main thread.
    pub(crate) fn run_from_main_thread(this: *mut DirTask) {
        // SAFETY: caller contract.
        let (rm, deleted_entries) = unsafe { Self::take_queued(this) };
        // SAFETY: both set by `schedule`. No `&ShellRmTask`: the pool may be writing `task.poster`.
        let (interp, cmd) = unsafe { (&*(*rm.as_ptr()).task.interp, (*rm.as_ptr()).cmd) };
        let next = Batch::report(interp, cmd, None, deleted_entries);
        drop(rm);
        next.run(interp);
    }

    /// SAFETY: `this` was posted via [`queue_for_write`], and is not used again.
    unsafe fn take_queued(this: *mut DirTask) -> (RefPtr<ShellRmTask>, Vec<u8>) {
        // SAFETY: caller contract.
        unsafe {
            let rm = (*this).write_ref.take().expect("set by queue_for_write");
            let deleted_entries = core::mem::take(&mut (*this).deleted_entries);
            drop(Self::take_child(this));
            (rm, deleted_entries)
        }
    }

    /// SAFETY: `this` is done. `None` for the root, which its `ShellRmTask` owns.
    unsafe fn take_child(this: *mut DirTask) -> Option<Box<DirTask>> {
        // SAFETY: caller contract; a child is the box `enqueue` leaked.
        unsafe { (!(*this).parent_task.is_null()).then(|| bun_core::heap::take(this)) }
    }
}

fn dir_task_run_from_main_thread_mini(this: *mut DirTask, _: *mut ()) {
    // SAFETY: mini-loop trampoline for a DirTask posted via `queue_for_write`.
    DirTask::run_from_main_thread(this);
}

// ── Taskable / ShellTaskCtx glue ──────────────────────────────────────────

impl bun_event_loop::Taskable for ShellRmTask {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::ShellRmTask;
    unsafe fn release_unrun(this: *mut Self) {
        // SAFETY: fn contract — the ref of the rm's own completion hop.
        drop(unsafe { RefPtr::from_raw(this) });
    }
    /// See [`ShellTaskCtx`](crate::shell::interpreter::ShellTaskCtx): a step of a shell script always runs.
    unsafe fn context(_: *const Self) -> bun_event_loop::ContextId {
        bun_event_loop::ContextId::NONE
    }
}
impl bun_event_loop::Taskable for DirTask {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::ShellRmDirTask;
    unsafe fn release_unrun(this: *mut Self) {
        // SAFETY: fn contract.
        drop(unsafe { Self::take_queued(this) });
    }
    /// See [`ShellTaskCtx`](crate::shell::interpreter::ShellTaskCtx): a step of a shell script always runs.
    unsafe fn context(_: *const Self) -> bun_event_loop::ContextId {
        bun_event_loop::ContextId::NONE
    }
}

impl crate::shell::interpreter::ShellTaskCtx for ShellRmTask {
    const TASK_OFFSET: usize = core::mem::offset_of!(Self, task);
    fn run_from_thread_pool(_this: &mut Self) {
        // Not reached: `ShellRmTask::schedule` installs `work_pool_callback`
        // directly (the generic trampoline auto-posts back, which would race
        // the recursive DirTask tree's own `finish_concurrently`).
        debug_assert!(
            false,
            "ShellRmTask scheduled via ShellTask::schedule; use ShellRmTask::schedule"
        );
    }
    fn run_from_main_thread(this: *mut Self, interp: &Interpreter) {
        // SAFETY: the ref `schedule` made, which `finish_concurrently` posted.
        on_shell_rm_task_done(interp, unsafe { RefPtr::from_raw(this) })
    }
}
