//! Forward-decl shell task types referenced by `runtime::dispatch::run_task`.
//!
//! Several shell task types collapsed into the NodeId-arena state machine
//! (`interpreter.rs`); the rest are gated behind `interpreter_body_gated.rs`.
//! The high-tier dispatcher must still cast the erased `Task.ptr` to a
//! concrete type and call the per-type entry point, so the shapes are
//! declared here. Bodies that already exist elsewhere re-export through this
//! module; the rest carry the body inline (mostly `run_from_main_thread()` →
//! resume the parent state via NodeId).

use crate::shell::interpreter::{Interpreter, NodeId, ShellTask};
/// Task payload for [`ShellAsync`](crate::shell::states::r#async::Async)'s
/// bounce back to the main thread. The state lives in `interp.nodes`, so
/// the enqueued payload is `(interp, node)`.
#[repr(C)]
pub(crate) struct ShellAsyncTask {
    pub interp: *mut Interpreter,
    pub node: NodeId,
}

/// Stat task backing shell conditional expressions (`[ -f x ]` etc.). Wraps an
/// inner [`ShellTask`].
#[repr(C)]
pub(crate) struct ShellCondExprStatTask {
    pub task: CondExprStatInner,
}

#[repr(C)]
pub(crate) struct CondExprStatInner {
    pub task: ShellTask,
    pub cond: NodeId,
    pub stat: bun_sys::Result<bun_sys::Stat>,
    pub path: Vec<u8>,
    /// The shell env's cwd fd, captured at schedule time so
    /// `run_from_thread_pool` can
    /// `statat` without touching the interpreter off-thread.
    pub cwd_fd: bun_sys::Fd,
}

impl ShellCondExprStatTask {
    /// # Safety
    /// `this` must be a live `heap::alloc` payload paired with the schedule
    /// site. Ownership of `*this` is consumed.
    pub(crate) fn run_from_main_thread(this: *mut Self, interp: &Interpreter) {
        // SAFETY: live Box'd task; paired with `heap::alloc` at schedule time.
        let owned = unsafe { bun_core::heap::take(this) };
        crate::shell::states::cond_expr::CondExpr::on_stat_task_done(
            interp,
            owned.task.cond,
            &owned.task.stat,
            &owned.task.path,
        );
    }
}

/// Error result of a glob-expansion task.
pub(crate) enum ShellGlobErr {
    Syscall(bun_sys::Error),
    Unknown(crate::Error),
}

/// Glob-expansion task run off the JS thread during word expansion.
#[repr(C)]
pub(crate) struct ShellGlobTask {
    pub task: ShellTask,
    pub expansion: NodeId,
    pub walker: bun_glob::BunGlobWalkerZ,
    pub result: Vec<Vec<u8>>,
    pub err: Option<ShellGlobErr>,
}

impl bun_event_loop::Taskable for ShellGlobTask {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::ShellGlobTask;
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

impl crate::shell::interpreter::ShellTaskCtx for ShellGlobTask {
    const TASK_OFFSET: usize = core::mem::offset_of!(Self, task);
    fn run_from_thread_pool(this: &mut Self) {
        match Self::walk_impl(&mut this.walker, &mut this.result) {
            Ok(Ok(())) => {}
            Ok(Err(e)) => this.err = Some(ShellGlobErr::Syscall(e)),
            Err(e) => this.err = Some(ShellGlobErr::Unknown(e)),
        }
    }
    fn run_from_main_thread(this: *mut Self, interp: &Interpreter) {
        // SAFETY: paired with `heap::alloc` in `create_and_schedule`.
        let mut me = unsafe { bun_core::heap::take(this) };
        crate::shell::states::expansion::Expansion::on_glob_walk_done(
            interp,
            me.expansion,
            core::mem::take(&mut me.result),
            me.err.take(),
        );
    }
}

impl ShellGlobTask {
    /// Heap-allocate the glob task for `expansion` and schedule it on the
    /// work pool; the allocation is freed in `run_from_main_thread`.
    pub(crate) fn create_and_schedule(
        interp: &Interpreter,
        expansion: NodeId,
        walker: bun_glob::BunGlobWalkerZ,
    ) {
        let mut task = ShellTask::new(interp.event_loop);
        task.interp = interp.as_ctx_ptr();
        let this = bun_core::heap::alloc(ShellGlobTask {
            task,
            expansion,
            walker,
            result: Vec::new(),
            err: None,
        });
        // SAFETY: `this` is a fresh heap allocation embedding `ShellTask` at
        // `TASK_OFFSET`; freed in `run_from_main_thread`.
        unsafe { ShellTask::schedule::<ShellGlobTask>(this) };
    }

    fn walk_impl(
        walker: &mut bun_glob::BunGlobWalkerZ,
        result: &mut Vec<Vec<u8>>,
    ) -> Result<bun_sys::Result<()>, crate::Error> {
        let mut iter = bun_glob::walk::Iterator::new(walker);
        if let Err(e) = iter.init()? {
            return Ok(Err(e));
        }
        loop {
            match iter.next()? {
                Err(e) => return Ok(Err(e)),
                Ok(None) => return Ok(Ok(())),
                Ok(Some(path)) => {
                    // The walker SENTINEL=true variant NUL-terminates; strip
                    // it so the argv word boundary doesn't carry an embedded 0.
                    let bytes = if path.last() == Some(&0) {
                        &path[..path.len() - 1]
                    } else {
                        &path[..]
                    };
                    result.push(bytes.to_vec());
                }
            }
        }
    }
}

/// The file a [`ShellReadFileRangeTask`] reads.
pub(crate) enum FileRangeSource {
    /// Opened against the shell's cwd, as a `< path` redirect is.
    Path {
        cwd_fd: bun_sys::Fd,
        path: bun_core::ZBox,
    },
    /// A dup of the descriptor of a `Bun.file(fd)`.
    Dup(bun_sys::File),
}

impl FileRangeSource {
    pub(crate) fn path(&self) -> Option<&bun_core::ZBox> {
        match self {
            Self::Path { path, .. } => Some(path),
            Self::Dup(_) => None,
        }
    }
}

/// Reads a range of a file off the JS thread. It is the window of a
/// `Bun.file()` slice that is a command's stdin (`cmd < ${file.slice(a, b)}`).
#[repr(C)]
pub(crate) struct ShellReadFileRangeTask {
    pub task: ShellTask,
    cmd: NodeId,
    source: FileRangeSource,
    offset: u64,
    len: usize,
    bytes: bun_sys::Result<Vec<u8>>,
}

impl bun_event_loop::Taskable for ShellReadFileRangeTask {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::ShellReadFileRangeTask;
    /// A pool completion that will not run: drop the keep-alive and the box
    /// (nothing else frees an unrun one).
    unsafe fn release_unrun(this: *mut Self) {
        // SAFETY: fn contract — the box `create_and_schedule` made.
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

impl crate::shell::interpreter::ShellTaskCtx for ShellReadFileRangeTask {
    const TASK_OFFSET: usize = core::mem::offset_of!(Self, task);
    fn run_from_thread_pool(this: &mut Self) {
        this.bytes = this.read();
    }
    fn run_from_main_thread(this: *mut Self, interp: &Interpreter) {
        // SAFETY: paired with `heap::alloc` in `create_and_schedule`.
        let mut me = unsafe { bun_core::heap::take(this) };
        crate::shell::states::cmd::Cmd::on_stdin_slice_read(
            interp,
            me.cmd,
            core::mem::replace(&mut me.bytes, Ok(Vec::new())),
            &me.source,
        );
    }
}

impl ShellReadFileRangeTask {
    /// Heap-allocate the task for `cmd` and schedule it on the work pool; the
    /// allocation is freed in `run_from_main_thread`.
    pub(crate) fn create_and_schedule(
        interp: &Interpreter,
        cmd: NodeId,
        source: FileRangeSource,
        offset: u64,
        len: usize,
    ) {
        let mut task = ShellTask::new(interp.event_loop);
        task.interp = interp.as_ctx_ptr();
        let this = bun_core::heap::alloc(ShellReadFileRangeTask {
            task,
            cmd,
            source,
            offset,
            len,
            bytes: Ok(Vec::new()),
        });
        // SAFETY: `this` is a fresh heap allocation embedding `ShellTask` at
        // `TASK_OFFSET`; freed in `run_from_main_thread`.
        unsafe { ShellTask::schedule::<ShellReadFileRangeTask>(this) };
    }

    fn read(&self) -> bun_sys::Result<Vec<u8>> {
        match &self.source {
            FileRangeSource::Path { cwd_fd, path } => {
                let file = bun_sys::File::from_fd(crate::shell::interpreter::shell_openat(
                    *cwd_fd,
                    path.as_zstr(),
                    bun_sys::O::RDONLY | bun_sys::O::CLOEXEC,
                    0,
                )?);
                read_file_range(&file, self.offset, self.len)
            }
            FileRangeSource::Dup(file) => {
                // A Windows `pread` moves the file position, and the dup shares it with the script's descriptor.
                #[cfg(windows)]
                let position = file.get_pos();
                let bytes = read_file_range(file, self.offset, self.len);
                #[cfg(windows)]
                if let Ok(position) = position {
                    let _ = file.seek_to(position);
                }
                bytes
            }
        }
    }
}

/// `len` bytes of `file` from `offset`, or fewer when the file ends before that.
fn read_file_range(file: &bun_sys::File, offset: u64, len: usize) -> bun_sys::Result<Vec<u8>> {
    let mut bytes = Vec::new();
    if bytes.try_reserve_exact(len).is_err() {
        return Err(bun_sys::Error::oom());
    }
    while bytes.len() < len {
        let want = len - bytes.len();
        let at = offset + bytes.len() as u64;
        // SAFETY: `pread` only writes to the spare capacity, which holds `want` bytes or more,
        // and reports how many bytes it wrote.
        let read = unsafe {
            bun_core::vec::fill_spare(&mut bytes, 0, |spare| {
                match bun_sys::pread(file.handle(), &mut spare[..want], at as i64) {
                    Ok(read) => (read, Ok(read)),
                    Err(err) => (0, Err(err)),
                }
            })
        }?;
        if read == 0 {
            break;
        }
    }
    Ok(bytes)
}

/// A child node in the
/// recursive rm tree-walk; posts back to main when its subtree is empty.
/// Re-export: the real DirTask lives in `builtins::rm` (full recursive
/// tree-walk node). `dispatch.rs` calls `ShellRmDirTask::run_from_main_thread`
/// for the verbose-write bounce-back.
pub(crate) use crate::shell::builtins::rm::DirTask as ShellRmDirTask;
