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
    /// # Safety
    /// `this` is the live `Box::into_raw` payload enqueued by
    /// `ShellSubprocess::on_process_exit`.
    pub unsafe fn run_from_main_thread(this: *mut Self) {
        // SAFETY: caller contract.
        let owned = unsafe { Box::from_raw(this) };
        // SAFETY: `interp` outlives every spawned subprocess.
        let interp = unsafe { &mut *owned.interp };
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
    /// # Safety
    /// `this` is the live `Box::into_raw` payload enqueued by
    /// `IOWriter::async_deinit`.
    pub unsafe fn run_from_main_thread(this: *mut Self) {
        // SAFETY: caller contract.
        let owned = unsafe { Box::from_raw(this) };
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
    /// # Safety
    /// `this` is the live `Box::into_raw` payload enqueued by
    /// `IOReader::async_deinit`.
    pub unsafe fn run_from_main_thread(this: *mut Self) {
        // SAFETY: caller contract.
        let owned = unsafe { Box::from_raw(this) };
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
    pub fn run_from_main_thread(this: *mut Self, interp: &mut Interpreter) {
        // SAFETY: live Box'd task.
        let inner = unsafe { &mut (*this).task };
        crate::shell::states::cond_expr::CondExpr::on_stat_task_done(
            interp, inner.cond, &inner.stat, &inner.path,
        );
        // SAFETY: paired with `Box::into_raw` at schedule time.
        drop(unsafe { Box::from_raw(this) });
    }
}

/// Spec: `Interpreter.Expansion.ShellGlobTask`.
#[repr(C)]
pub struct ShellGlobTask {
    pub task: ShellTask,
    pub expansion: NodeId,
    pub walker: bun_glob::BunGlobWalkerZ,
    pub result: Vec<Vec<u8>>,
    pub err: Option<bun_core::Error>,
}

impl ShellGlobTask {
    /// # Safety
    /// `this` is a live `Box::into_raw`'d task.
    pub unsafe fn run_from_main_thread(this: *mut Self) {
        // SAFETY: caller contract; `interp` set at schedule.
        let interp = unsafe { &mut *(*this).task.interp };
        let me = unsafe { &mut *this };
        crate::shell::states::expansion::Expansion::on_glob_walk_done(
            interp,
            me.expansion,
            core::mem::take(&mut me.result),
            me.err.take(),
        );
    }

    /// Spec: ShellGlobTask.deinit — frees the walker arena + the task box.
    /// # Safety
    /// `this` is a live `Box::into_raw`'d task; called exactly once after
    /// `run_from_main_thread`.
    pub unsafe fn deinit(this: *mut Self) {
        // SAFETY: caller contract.
        drop(unsafe { Box::from_raw(this) });
    }
}

/// Spec: `Interpreter.Builtin.Rm.ShellRmTask.DirTask`. A child node in the
/// recursive rm tree-walk; posts back to main when its subtree is empty.
#[repr(C)]
pub struct ShellRmDirTask {
    pub parent: *mut crate::shell::builtins::rm::ShellRmTask,
    pub path: Vec<u8>,
    pub remaining: core::sync::atomic::AtomicU32,
    pub err: Option<bun_sys::Error>,
}

impl ShellRmDirTask {
    /// # Safety
    /// `this` is a live `Box::into_raw`'d DirTask.
    pub unsafe fn run_from_main_thread(this: *mut Self) {
        // SAFETY: caller contract; `parent` outlives every DirTask child.
        let parent = unsafe { &mut *(*this).parent };
        // SAFETY: `interp` set at parent schedule.
        let interp = unsafe { &mut *parent.task.interp };
        crate::shell::builtins::rm::ShellRmTask::on_dir_task_done(parent, interp, this);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/interpreter.zig (ShellAsyncSubprocessDone,
//               AsyncDeinitReader/Writer, ShellGlobTask, ShellCondExprStatTask,
//               ShellRmTask.DirTask) + src/jsc/Task.zig dispatch arms
//   confidence: medium — shapes match the Zig structs; entry-point bodies
//               forward to the NodeId-arena state methods, several of which
//               are still `// TODO(port)` in their owning modules.
// ──────────────────────────────────────────────────────────────────────────
