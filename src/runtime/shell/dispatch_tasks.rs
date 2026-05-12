//! Forward-decl shell task types referenced by `runtime::dispatch::run_task`.
//!
//! The Zig spec (`src/jsc/Task.zig`) names ~16 shell task structs in its
//! 96-arm switch. The Rust shell port collapsed several into the NodeId-arena
//! state machine (`interpreter.rs`) and gated the rest behind
//! `interpreter_body_gated.rs`. The high-tier dispatcher must still cast the
//! erased `Task.ptr` to a concrete type and call the per-type entry point, so
//! the shapes are declared here. Bodies that already exist elsewhere re-export
//! through this module; the rest carry the spec-faithful body inline (mostly
//! `runFromMainThread()` → resume the parent state via NodeId).
//!
//! Spec: `src/shell/interpreter.zig` + per-builtin `src/shell/interpreter/*.zig`.

use crate::shell::interpreter::{Interpreter, NodeId, ShellTask};
use bun_jsc::ConcurrentTask::ConcurrentTask;

/// Task payload for [`ShellAsync`](crate::shell::states::r#async::Async)'s
/// bounce back to the main thread. In Zig the `Async` state struct *is* the
/// task; in the Rust NodeId-arena port the state lives in `interp.nodes`, so
/// the enqueued payload is `(interp, node)`.
#[repr(C)]
pub struct ShellAsyncTask {
    pub interp: *mut Interpreter,
    pub node: NodeId,
    pub concurrent_task: ConcurrentTask,
}

/// Spec: `Interpreter.Cmd.ShellAsyncSubprocessDone`. Posted from the
/// subprocess exit handler back to the JS thread to resume the owning `Cmd`.
#[repr(C)]
pub struct ShellAsyncSubprocessDone {
    pub interp: *mut Interpreter,
    pub cmd: NodeId,
    pub exit_code: crate::shell::ExitCode,
    pub concurrent_task: ConcurrentTask,
}

impl ShellAsyncSubprocessDone {
    /// Spec: interpreter.zig `ShellAsyncSubprocessDone.runFromMainThread`.
    ///
    /// Reached only via `runtime::dispatch::run_task` for
    /// `task_tag::ShellAsyncSubprocessDone`, which always passes the
    /// `heap::alloc` payload enqueued by `ShellSubprocess::on_process_exit`.
    pub fn run_from_main_thread(this: *mut Self) {
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

/// Spec: `Interpreter.AsyncDeinitWriter` (`IOWriter.AsyncDeinit`). Defers
/// dropping an [`IOWriter`](crate::shell::io_writer::IOWriter) to the main
/// thread so its `Drop` doesn't race the writer thread.
#[repr(C)]
pub struct AsyncDeinitWriter {
    pub writer: *mut crate::shell::io_writer::IOWriter,
    pub concurrent_task: ConcurrentTask,
}

impl AsyncDeinitWriter {
    /// Reached only via `runtime::dispatch::run_task` for
    /// `task_tag::ShellIOWriterAsyncDeinit`, which always passes the
    /// `heap::alloc` payload enqueued by `IOWriter::async_deinit`.
    pub fn run_from_main_thread(this: *mut Self) {
        // SAFETY: dispatch contract — `this` is the live `heap::alloc` payload
        // enqueued by `IOWriter::async_deinit`.
        let owned = unsafe { bun_core::heap::take(this) };
        crate::shell::io_writer::IOWriter::deinit_on_main_thread(owned.writer);
    }
}

/// Spec: `Interpreter.AsyncDeinitReader` (`IOReader.AsyncDeinit`).
#[repr(C)]
pub struct AsyncDeinitReader {
    pub reader: *mut crate::shell::io_reader::IOReader,
    pub concurrent_task: ConcurrentTask,
}

impl AsyncDeinitReader {
    /// Reached only via `runtime::dispatch::run_task` for
    /// `task_tag::ShellIOReaderAsyncDeinit`, which always passes the
    /// `heap::alloc` payload enqueued by `IOReader::async_deinit`.
    pub fn run_from_main_thread(this: *mut Self) {
        // SAFETY: dispatch contract — `this` is the live `heap::alloc` payload
        // enqueued by `IOReader::async_deinit`.
        let owned = unsafe { bun_core::heap::take(this) };
        crate::shell::io_reader::IOReader::deinit_on_main_thread(owned.reader);
    }
}

/// Spec: `Interpreter.CondExpr.ShellCondExprStatTask`. Wraps an inner
/// [`ShellTask`] (the Zig spec dispatches via `.task.runFromMainThread()`).
#[repr(C)]
pub struct ShellCondExprStatTask {
    pub task: CondExprStatInner,
}

#[repr(C)]
pub struct CondExprStatInner {
    pub task: ShellTask,
    pub cond: NodeId,
    pub stat: bun_sys::Result<bun_sys::Stat>,
    pub path: Vec<u8>,
}

impl ShellCondExprStatTask {
    pub fn run_from_main_thread(this: *mut Self, interp: &Interpreter) {
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

/// Spec: `Interpreter.Expansion.ShellGlobTask.Err`.
pub enum ShellGlobErr {
    Syscall(bun_sys::Error),
    Unknown(bun_core::Error),
}

/// Spec: `Interpreter.Expansion.ShellGlobTask`.
#[repr(C)]
pub struct ShellGlobTask {
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
    /// Spec: Expansion.zig `ShellGlobTask.createOnMainThread` + `schedule`.
    pub fn create_and_schedule(
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

    /// Spec: Expansion.zig `ShellGlobTask.walkImpl`.
    fn walk_impl(
        walker: &mut bun_glob::BunGlobWalkerZ,
        result: &mut Vec<Vec<u8>>,
    ) -> Result<bun_sys::Result<()>, bun_core::Error> {
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

/// Spec: `Interpreter.Builtin.Rm.ShellRmTask.DirTask`. A child node in the
/// recursive rm tree-walk; posts back to main when its subtree is empty.
/// Re-export: the real DirTask lives in `builtins::rm` (full recursive
/// tree-walk node). `dispatch.rs` calls `ShellRmDirTask::run_from_main_thread`
/// for the verbose-write bounce-back.
pub use crate::shell::builtins::rm::DirTask as ShellRmDirTask;

// ported from: src/shell/interpreter.zig
