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
use bun_jsc::ConcurrentTask::ConcurrentTask;

/// Task payload for [`ShellAsync`](crate::shell::states::r#async::Async)'s
/// bounce back to the main thread. The state lives in `interp.nodes`, so
/// the enqueued payload is `(interp, node)`.
#[repr(C)]
pub(crate) struct ShellAsyncTask {
    pub interp: *mut Interpreter,
    pub node: NodeId,
    pub concurrent_task: ConcurrentTask,
}

/// Posted from the
/// subprocess exit handler back to the JS thread to resume the owning `Cmd`.
#[repr(C)]
pub(crate) struct ShellAsyncSubprocessDone {
    pub interp: *mut Interpreter,
    pub cmd: NodeId,
    pub exit_code: crate::shell::ExitCode,
    pub concurrent_task: ConcurrentTask,
}

impl ShellAsyncSubprocessDone {
    /// Reached only via `runtime::dispatch::run_task` for
    /// `task_tag::ShellAsyncSubprocessDone`, which always passes the
    /// `heap::alloc` payload enqueued by `ShellSubprocess::on_process_exit`.
    ///
    /// # Safety
    /// `this` must be the live `heap::alloc` payload enqueued by
    /// `ShellSubprocess::on_process_exit`, and `(*this).interp` must outlive
    /// the call. Ownership of `*this` is consumed.
    // Dispatch trampoline: `this` validity is guaranteed by the `run_task`
    // contract; signature is fixed by `dispatch.rs`.
    #[allow(clippy::not_unsafe_ptr_arg_deref)]
    pub(crate) fn run_from_main_thread(this: *mut Self) {
        // SAFETY: dispatch contract — `this` is the live `heap::alloc` payload
        // enqueued by `ShellSubprocess::on_process_exit`; `interp` outlives
        // every spawned subprocess.
        let (owned, interp) = unsafe {
            let owned = bun_core::heap::take(this);
            let interp = &*owned.interp;
            (owned, interp)
        };
        crate::shell::states::cmd::Cmd::on_subprocess_done(interp, owned.cmd, owned.exit_code);
    }
}

/// Defers
/// dropping an [`IOWriter`](crate::shell::io_writer::IOWriter) to the main
/// thread so its `Drop` doesn't race the writer thread.
#[repr(C)]
pub(crate) struct AsyncDeinitWriter {
    pub writer: *mut crate::shell::io_writer::IOWriter,
    pub concurrent_task: ConcurrentTask,
}

impl AsyncDeinitWriter {
    /// Reached only via `runtime::dispatch::run_task` for
    /// `task_tag::ShellIOWriterAsyncDeinit`, which always passes the
    /// `heap::alloc` payload enqueued by `IOWriter::async_deinit`.
    ///
    /// # Safety
    /// `this` must be the live `heap::alloc` payload enqueued by
    /// `IOWriter::async_deinit`. Ownership of `*this` is consumed.
    // Dispatch trampoline: `this` validity is guaranteed by the `run_task`
    // contract; signature is fixed by `dispatch.rs`.
    #[allow(clippy::not_unsafe_ptr_arg_deref)]
    pub(crate) fn run_from_main_thread(this: *mut Self) {
        // SAFETY: dispatch contract — `this` is the live `heap::alloc` payload
        // enqueued by `IOWriter::async_deinit`.
        let owned = unsafe { bun_core::heap::take(this) };
        crate::shell::io_writer::IOWriter::deinit_on_main_thread(owned.writer);
    }
}

/// Defers dropping an [`IOReader`](crate::shell::io_reader::IOReader) to the
/// main thread so its `Drop` doesn't race the reader thread.
#[repr(C)]
pub(crate) struct AsyncDeinitReader {
    pub reader: *mut crate::shell::io_reader::IOReader,
    pub concurrent_task: ConcurrentTask,
}

impl AsyncDeinitReader {
    /// Reached only via `runtime::dispatch::run_task` for
    /// `task_tag::ShellIOReaderAsyncDeinit`, which always passes the
    /// `heap::alloc` payload enqueued by `IOReader::async_deinit`.
    ///
    /// # Safety
    /// `this` must be the live `heap::alloc` payload enqueued by
    /// `IOReader::async_deinit`. Ownership of `*this` is consumed.
    // Dispatch trampoline: `this` validity is guaranteed by the `run_task`
    // contract; signature is fixed by `dispatch.rs`.
    #[allow(clippy::not_unsafe_ptr_arg_deref)]
    pub(crate) fn run_from_main_thread(this: *mut Self) {
        // SAFETY: dispatch contract — `this` is the live `heap::alloc` payload
        // enqueued by `IOReader::async_deinit`.
        let owned = unsafe { bun_core::heap::take(this) };
        crate::shell::io_reader::IOReader::deinit_on_main_thread(owned.reader);
    }
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
    // Dispatch trampoline: `this` validity is guaranteed by the `run_task`
    // contract; signature is fixed by `dispatch.rs`.
    #[allow(clippy::not_unsafe_ptr_arg_deref)]
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
pub enum ShellGlobErr {
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
    // Dispatch trampoline: `this` validity is guaranteed by the `run_task`
    // contract; signature is fixed by the `ShellTaskCtx` trait.
    #[allow(clippy::not_unsafe_ptr_arg_deref)]
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

/// A child node in the
/// recursive rm tree-walk; posts back to main when its subtree is empty.
/// Re-export: the real DirTask lives in `builtins::rm` (full recursive
/// tree-walk node). `dispatch.rs` calls `ShellRmDirTask::run_from_main_thread`
/// for the verbose-write bounce-back.
pub use crate::shell::builtins::rm::DirTask as ShellRmDirTask;
