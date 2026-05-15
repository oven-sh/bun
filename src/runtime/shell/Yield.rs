//! Trampoline continuation for the shell interpreter.
//!
//! See the doc comment on `Yield` for the design. The Rust port carries
//! `NodeId`s (indices into `Interpreter::nodes`) instead of `&mut State`
//! borrows — the only `&mut` is the `&Interpreter` threaded through
//! `run`.

use core::cell::Cell;

use crate::shell::interpreter::{Interpreter, NodeId, StateKind, log};
use crate::shell::states::pipeline::Pipeline;

/// A "continuation" of the shell interpreter. Shell state-machine functions
/// return a `Yield`; `Yield::run(&Interpreter)` is the trampoline that
/// drives execution without blowing up the call stack.
///
/// Variants name the *next state to step* by `NodeId`. The trampoline looks
/// up the node and matches on its kind (hoisted dispatch — see
/// `Interpreter::next_node`).
#[derive(strum::IntoStaticStr)]
pub enum Yield {
    /// Step the node at this id (`Interpreter::next_node`).
    Next(NodeId),
    /// Start the node at this id (`Interpreter::start_node`). Used when a
    /// freshly-created child needs starting at top-of-stack.
    Start(NodeId),
    /// IOWriter completed a chunk synchronously; fire `on_io_writer_chunk` on
    /// the registered child at top-of-stack.
    OnIoWriterChunk {
        child: crate::shell::io_writer::ChildPtr,
        written: usize,
        // TODO(b2-blocked): bun_jsc::SystemError — opaque until jsc compiles.
        err: Option<bun_sys::SystemError>,
    },
    /// Execution is waiting on async IO (epoll/kqueue/uv). The caller's task
    /// callback will resume by calling `.run()` again later.
    Suspended,
    /// Threw a JS error.
    Failed,
    Done,
}

impl Yield {
    #[inline]
    pub const fn suspended() -> Yield {
        Yield::Suspended
    }
    #[inline]
    pub const fn done() -> Yield {
        Yield::Done
    }
    #[inline]
    pub const fn failed() -> Yield {
        Yield::Failed
    }

    pub fn is_done(&self) -> bool {
        matches!(self, Yield::Done)
    }
}

thread_local! {
    /// Debug-only re-entrancy guard. See Zig `_dbg_catch_exec_within_exec`.
    static DBG_CATCH_EXEC_WITHIN_EXEC: Cell<usize> = const { Cell::new(0) };
}

/// RAII re-entrancy depth guard: increments the thread-local depth counter on
/// construction, decrements on `Drop`. Debug-only (no-op in release).
struct DbgDepthGuard;

impl DbgDepthGuard {
    /// Ideally 1, but resolving the JS Promise in `Interpreter::finish` can
    /// re-enter another shell script.
    const MAX_DEPTH: usize = 2;

    #[inline]
    fn enter(tag: &'static str) -> Self {
        if cfg!(debug_assertions) {
            let n = DBG_CATCH_EXEC_WITHIN_EXEC.get();
            log!("Yield({}) depth = {} + 1", tag, n);
            debug_assert!(n <= Self::MAX_DEPTH);
            DBG_CATCH_EXEC_WITHIN_EXEC.set(n + 1);
        }
        let _ = tag;
        Self
    }
}

impl Drop for DbgDepthGuard {
    #[inline]
    fn drop(&mut self) {
        if cfg!(debug_assertions) {
            DBG_CATCH_EXEC_WITHIN_EXEC.set(DBG_CATCH_EXEC_WITHIN_EXEC.get() - 1);
        }
    }
}

impl Yield {
    /// Trampoline: drive the interpreter until it suspends/finishes.
    pub fn run(self, interp: &Interpreter) {
        let tag: &'static str = (&self).into();
        let _depth = DbgDepthGuard::enter(tag);

        // A pipeline starts multiple "threads" of execution (`cmd1 | cmd2 | cmd3`).
        // We start cmd1, return to the pipeline, start cmd2, etc. — so we keep
        // a small stack of pipeline NodeIds to resume.
        //
        // PERF(port): was stack-fallback alloc (4 inline) — profile in Phase B;
        // smallvec::SmallVec<[NodeId; 4]> is the right shape.
        let mut pipeline_stack: Vec<NodeId> = Vec::with_capacity(4);

        // Zig used a labelled `state: switch` as a tail-call trampoline. Rust
        // lowers it to `loop { state = match state { ... } }`.
        let mut state = self;
        loop {
            state = match state {
                Yield::Next(id) => {
                    if matches!(interp.node(id).kind(), StateKind::Pipeline) {
                        let done = Pipeline::is_done(interp, id);
                        if done {
                            // remove before stepping (next() will deinit it)
                            if let Some(idx) = pipeline_stack.iter().position(|p| *p == id) {
                                pipeline_stack.remove(idx);
                            }
                        } else {
                            debug_assert!(!pipeline_stack.contains(&id));
                            pipeline_stack.push(id);
                        }
                    }
                    interp.next_node(id)
                }
                Yield::Start(id) => interp.start_node(id),
                Yield::OnIoWriterChunk {
                    child,
                    written,
                    err,
                } => crate::shell::io_writer::on_io_writer_chunk(interp, child, written, err),
                Yield::Suspended | Yield::Failed | Yield::Done => {
                    if let Some(y) = Self::drain_pipelines(interp, &mut pipeline_stack) {
                        y
                    } else {
                        return;
                    }
                }
            };
        }
    }

    fn drain_pipelines(interp: &Interpreter, pipeline_stack: &mut Vec<NodeId>) -> Option<Yield> {
        while let Some(&id) = pipeline_stack.last() {
            if Pipeline::is_starting_cmds(interp, id) {
                return Some(interp.next_node(id));
            }
            pipeline_stack.pop();
            if Pipeline::is_done(interp, id) {
                return Some(interp.next_node(id));
            }
        }
        None
    }
}

// ported from: src/shell/Yield.zig
