use crate::shell::builtin::Builtin;
use crate::shell::interpreter::{Interpreter, NodeId};
use crate::shell::yield_::Yield;

pub struct True;

impl True {
    pub fn start(interp: &Interpreter, cmd: NodeId) -> Yield {
        Builtin::done(interp, cmd, 0)
    }

    pub fn on_io_writer_chunk(
        _interp: &Interpreter,
        _cmd: NodeId,
        _: usize,
        _: Option<bun_sys::SystemError>,
    ) -> Yield {
        Yield::done()
    }
}

// ported from: src/shell/builtin/true_.zig
