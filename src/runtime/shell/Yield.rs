//! Trampoline continuation for the shell interpreter.
//!
//! See the doc comment on `Yield` for the design. The Rust port carries
//! `NodeId`s (indices into `Interpreter::nodes`) instead of `&mut State`
//! borrows — the only `&mut` is the `&mut Interpreter` threaded through
//! `run`.

use bun_collections::smallvec::SmallVec;

use crate::shell::interpreter::{Interpreter, NodeId, StateKind};
use crate::shell::io_reader::{IOReader, IOReaderId};
use crate::shell::io_writer::IOWriterId;
use crate::shell::states::pipeline::Pipeline;
use crate::shell::{ExitCode, ShellErr, ast};

/// A "continuation" of the shell interpreter. Shell state-machine functions
/// return a `Yield`; `Yield::run(&mut Interpreter)` is the trampoline that
/// drives execution without blowing up the call stack.
///
/// Variants name the *next state to step* by `NodeId`. The trampoline looks
/// up the node and matches on its kind (hoisted dispatch — see
/// `Interpreter::next_node`).
// OnIoWriterChunk's `err` is constructed inline at several sites in IOWriter.rs;
// boxing it would add an allocation to the synchronous-write fast path for no win.
#[allow(clippy::large_enum_variant)]
#[must_use]
pub(crate) enum Yield {
    /// Step the node at this id (`Interpreter::next_node`).
    Next(NodeId),
    /// IOWriter completed a chunk; fire `on_io_writer_chunk` on
    /// the registered child at top-of-stack.
    OnIoWriterChunk {
        child: crate::shell::io_writer::ChildPtr,
        written: usize,
        // `bun_sys::SystemError`, consistent with the rest of the shell
        // subsystem (IOWriter/IOReader/Builtin); converted to a JS error at
        // the throw boundary.
        err: Option<bun_sys::SystemError>,
    },
    /// A write failed; fire `on_io_writer_chunk` for each chunk still queued.
    FailPendingWriters(IOWriterId),
    /// A read finished; notify each of its listeners.
    FinishListeners(IOReaderId),
    /// Execution is waiting on async IO (epoll/kqueue/uv). The caller's task
    /// callback will resume by calling `ShellInterpreter::run_yield_with` later.
    Suspended,
    /// The node's JS exception was taken; `Interpreter::fail` winds the script down.
    Failed(NodeId),
    Action(ReentrantAction),
    Done,
}

/// Can run JS or I/O callbacks: `ShellInterpreter::run_yield` does it with no borrow of the `Interpreter`.
pub(crate) enum ReentrantAction {
    /// The node holds nothing in flight.
    Throw(NodeId, Box<ShellErr>),
    StartBuiltinWithJsBuf(NodeId, ast::JSBuf, ast::RedirectFlags),
    Spawn(NodeId),
    TickMiniLoop(NodeId),
    Finish(ExitCode),
}

impl Yield {
    #[inline]
    pub(crate) const fn suspended() -> Yield {
        Yield::Suspended
    }
    #[inline]
    pub(crate) const fn done() -> Yield {
        Yield::Done
    }
    pub(crate) fn throw(node: NodeId, err: ShellErr) -> Yield {
        Yield::Action(ReentrantAction::Throw(node, Box::new(err)))
    }
}

/// What `Yield::run` continues with when the current node suspends.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Deferred {
    /// For `cmd1 | cmd2`, we start cmd1, return to the pipeline, start cmd2, etc.
    Pipeline(NodeId),
    FailPendingWriters(IOWriterId),
    FinishListeners(IOReaderId),
    WritePending(IOWriterId),
}

pub(crate) type DeferredStack = SmallVec<[Deferred; 4]>;

impl Yield {
    /// Trampoline: drive the interpreter until it suspends (`None`) or needs a `ReentrantAction`.
    pub(crate) fn run(
        self,
        interp: &mut Interpreter<'_>,
        stack: &mut DeferredStack,
    ) -> Option<ReentrantAction> {
        // Tail-call trampoline: `loop { state = match state { ... } }`.
        let mut state = self;
        loop {
            state = match state {
                Yield::Next(id) => {
                    if matches!(interp.node(id).kind(), StateKind::Pipeline) {
                        let this = Deferred::Pipeline(id);
                        let done = Pipeline::is_done(interp, id);
                        if done {
                            // remove before stepping (next() will deinit it)
                            if let Some(idx) = stack.iter().position(|d| *d == this) {
                                stack.remove(idx);
                            }
                        } else {
                            debug_assert!(!stack.contains(&this));
                            stack.push(this);
                        }
                    }
                    interp.next_node(id)
                }
                Yield::OnIoWriterChunk {
                    child,
                    written,
                    err,
                } => crate::shell::io_writer::on_io_writer_chunk(interp, child, written, err),
                Yield::FailPendingWriters(id) => {
                    let (next, more) = match interp.io_writers.get_mut(id) {
                        Some(writer) => writer.fail_next_writer(),
                        None => (Yield::done(), false),
                    };
                    if more {
                        stack.push(Deferred::FailPendingWriters(id));
                    }
                    next
                }
                Yield::FinishListeners(id) => {
                    let (next, more) = IOReader::finish_next_listener(interp, id);
                    if more {
                        stack.push(Deferred::FinishListeners(id));
                    }
                    next
                }
                Yield::Failed(id) => interp.fail(id),
                Yield::Action(action) => return Some(action),
                Yield::Suspended | Yield::Done => Self::drain_deferred(interp, stack)?,
            };
        }
    }

    fn drain_deferred(interp: &mut Interpreter<'_>, stack: &mut DeferredStack) -> Option<Yield> {
        while let Some(&deferred) = stack.last() {
            if let Deferred::Pipeline(id) = deferred
                && Pipeline::is_starting_cmds(interp, id)
            {
                return Some(interp.next_node(id));
            }
            stack.pop();
            match deferred {
                Deferred::Pipeline(id) => {
                    if Pipeline::is_done(interp, id) {
                        return Some(interp.next_node(id));
                    }
                }
                Deferred::FailPendingWriters(id) => return Some(Yield::FailPendingWriters(id)),
                Deferred::FinishListeners(id) => return Some(Yield::FinishListeners(id)),
                Deferred::WritePending(id) => {
                    if let Some(writer) = interp.io_writers.get_mut(id) {
                        return Some(writer.write_pending());
                    }
                }
            }
        }
        None
    }
}
