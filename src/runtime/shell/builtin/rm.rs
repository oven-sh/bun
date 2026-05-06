//! Port of src/shell/builtin/rm.zig

use crate::shell::builtin::Builtin;
use crate::shell::interpreter::{Interpreter, NodeId};
use crate::shell::yield_::Yield;

#[derive(Default)]
pub struct Rm {
    pub state: RmState,
}

#[derive(Default)]
pub enum RmState {
    #[default]
    Idle,
    ParseOpts,
    Removing { idx: usize },
    WaitingIo,
    Done,
}

impl Rm {
    pub fn start(interp: &mut Interpreter, cmd: NodeId) -> Yield {
        // Full body (~1700 lines): parse -r/-f/-d/-v, for each arg spawn a
        // ShellRmTask on the WorkPool that walks the directory tree and
        // unlinks/rmdirs, streaming progress to stderr. Gated until
        // bun_sys::{unlinkat, rmdirat, DirIterator}, ShellTask/WorkPool, and
        // IOWriter::enqueue are wired.
        #[cfg(any())]
        {
            include!("rm_body_gated.rs");
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
//   source:     src/shell/builtin/rm.zig (1704 lines)
//   confidence: low (NodeId scaffolding only; body gated)
//   blocked_on: bun_sys::{unlinkat, rmdirat, DirIterator}, ShellTask/WorkPool,
//               IOWriter::enqueue
// ──────────────────────────────────────────────────────────────────────────
