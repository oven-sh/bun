use crate::shell::builtin::Builtin;
use crate::shell::interpreter::{Interpreter, NodeId};
use crate::shell::yield_::Yield;

#[derive(Default)]
pub struct Mv {
    pub state: MvState,
}

#[derive(Default)]
pub enum MvState {
    #[default]
    Idle,
    CheckTarget,
    Moving { idx: usize },
    WaitingIo,
    Done,
}

impl Mv {
    pub fn start(interp: &mut Interpreter, cmd: NodeId) -> Yield {
        // Full body (~550 lines): parse -f/-n/-i, stat target, then for each
        // source either renameat() or fall back to copy+unlink across devices,
        // dispatching to a WorkPool task. Gated until bun_sys::renameat,
        // ShellTask, and IOWriter::enqueue are wired.
        #[cfg(any())]
        {
            include!("mv_body_gated.rs");
        }
        Builtin::done(interp, cmd, 0)
    }

    pub fn on_io_writer_chunk(
        interp: &mut Interpreter,
        cmd: NodeId,
        _: usize,
        _err: Option<bun_sys::SystemError>,
    ) -> Yield {
        Builtin::done(interp, cmd, 1)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/builtin/mv.zig (567 lines)
//   confidence: low (NodeId scaffolding only; body gated)
//   blocked_on: bun_sys::renameat, ShellTask/WorkPool, IOWriter::enqueue
// ──────────────────────────────────────────────────────────────────────────
