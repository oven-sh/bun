use crate::shell::builtin::Builtin;
use crate::shell::interpreter::{Interpreter, NodeId};
use crate::shell::yield_::Yield;

#[derive(Default)]
pub struct Cat {
    pub state: CatState,
    pub arg_idx: usize,
}

#[derive(Default)]
pub enum CatState {
    #[default]
    Idle,
    ReadingFile,
    ReadingStdin,
    WaitingWrite,
    Done,
}

impl Cat {
    pub fn start(interp: &mut Interpreter, cmd: NodeId) -> Yield {
        // Full body (~380 lines): for each arg (or stdin if none), open via
        // bun_sys::openat, register with an IOReader, and pump chunks to the
        // builtin's stdout IOWriter. Gated until IOReader/IOWriter bodies and
        // bun_sys::openat are wired.
        #[cfg(any())]
        {
            include!("cat_body_gated.rs");
        }
        Builtin::done(interp, cmd, 0)
    }

    pub fn on_io_writer_chunk(
        interp: &mut Interpreter,
        cmd: NodeId,
        _: usize,
        err: Option<bun_sys::SystemError>,
    ) -> Yield {
        if err.is_some() {
            return Builtin::done(interp, cmd, 1);
        }
        // TODO(b2-blocked): advance to next chunk / next file.
        Yield::suspended()
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/builtin/cat.zig (382 lines)
//   confidence: low (NodeId scaffolding only; read/write loop gated)
//   blocked_on: IOReader body, IOWriter::enqueue, bun_sys::openat
// ──────────────────────────────────────────────────────────────────────────
