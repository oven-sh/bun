//! Shell task types referenced by `runtime::dispatch::run_task`.
//!
//! Several shell task types collapsed into the NodeId-arena state machine
//! (`interpreter.rs`). The high-tier dispatcher must still rebox the erased
//! `Task.ptr` as a concrete type and call the per-type entry point, so the
//! shapes are declared here. Bodies that already exist elsewhere re-export
//! through this module; the rest carry the body inline (mostly
//! `run_from_main_thread()` → resume the parent state via NodeId).

use bun_ptr::ParentRef;

use crate::shell::interpreter::{Interpreter, NodeId, ShellTask, ShellTaskCtx};

/// Task payload for [`ShellAsync`](crate::shell::states::r#async::Async)'s
/// bounce back to the main thread. The state lives in `interp.nodes`, so
/// the enqueued payload is `(interp, node)`; one is boxed per `Async` node
/// and reused for each bounce.
pub(crate) struct ShellAsyncTask {
    pub interp: ParentRef<Interpreter>,
    pub node: NodeId,
    /// Intrusive node for the mini-loop post (the JS loop queues a `Task`).
    pub concurrent_task: bun_event_loop::AnyTaskWithExtraContext::AnyTaskWithExtraContext,
}

impl ShellAsyncTask {
    pub(crate) fn run(self: Box<Self>) {
        crate::shell::states::r#async::Async::run_from_main_thread(self);
    }
}

impl bun_event_loop::AnyTaskWithExtraContext::BoxedMiniTaskRunner<ShellAsyncTask>
    for ShellAsyncTask
{
    fn run_from_loop_thread(owner: Box<ShellAsyncTask>) {
        owner.run();
    }
}

/// Stat task backing shell conditional expressions (`[ -f x ]` etc.).
pub(crate) struct ShellCondExprStatTask {
    pub task: ShellTask,
    pub cond: NodeId,
    pub stat: bun_sys::Result<bun_sys::Stat>,
    pub path: Vec<u8>,
    /// The shell env's cwd fd, captured at schedule time so
    /// `run_from_thread_pool` can
    /// `statat` without touching the interpreter off-thread.
    pub cwd_fd: bun_sys::Fd,
}

crate::shell_task!(ShellCondExprStatTask);

impl ShellTaskCtx for ShellCondExprStatTask {
    fn shell_task(&self) -> &ShellTask {
        &self.task
    }
    fn shell_task_mut(&mut self) -> &mut ShellTask {
        &mut self.task
    }
    fn run_from_thread_pool(&mut self) {
        debug_assert!(self.path.last() == Some(&0));
        let z = bun_core::ZStr::from_buf(&self.path, self.path.len() - 1);
        self.stat = crate::shell::interpreter::shell_statat(self.cwd_fd, z);
    }
    fn run_from_main_thread(self: Box<Self>, interp: &Interpreter) {
        crate::shell::states::cond_expr::CondExpr::on_stat_task_done(
            interp, self.cond, &self.stat, &self.path,
        );
    }
}

/// Error result of a glob-expansion task.
pub enum ShellGlobErr {
    Syscall(bun_sys::Error),
    Unknown(crate::Error),
}

/// Glob-expansion task run off the JS thread during word expansion.
pub(crate) struct ShellGlobTask {
    pub task: ShellTask,
    pub expansion: NodeId,
    pub walker: bun_glob::BunGlobWalkerZ,
    pub result: Vec<Vec<u8>>,
    pub err: Option<ShellGlobErr>,
}

crate::shell_task!(ShellGlobTask);

impl ShellTaskCtx for ShellGlobTask {
    fn shell_task(&self) -> &ShellTask {
        &self.task
    }
    fn shell_task_mut(&mut self) -> &mut ShellTask {
        &mut self.task
    }
    fn run_from_thread_pool(&mut self) {
        match Self::walk_impl(&mut self.walker, &mut self.result) {
            Ok(Ok(())) => {}
            Ok(Err(e)) => self.err = Some(ShellGlobErr::Syscall(e)),
            Err(e) => self.err = Some(ShellGlobErr::Unknown(e)),
        }
    }
    fn run_from_main_thread(mut self: Box<Self>, interp: &Interpreter) {
        crate::shell::states::expansion::Expansion::on_glob_walk_done(
            interp,
            self.expansion,
            core::mem::take(&mut self.result),
            self.err.take(),
        );
    }
}

impl ShellGlobTask {
    /// Box the glob task for `expansion` and schedule it on the work pool;
    /// it comes back through `run_from_main_thread`.
    pub(crate) fn create_and_schedule(
        interp: &Interpreter,
        expansion: NodeId,
        walker: bun_glob::BunGlobWalkerZ,
    ) {
        ShellTask::schedule(Box::new(ShellGlobTask {
            task: ShellTask::new(interp),
            expansion,
            walker,
            result: Vec::new(),
            err: None,
        }));
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
pub(crate) use crate::shell::builtins::rm::DirTask as ShellRmDirTask;
