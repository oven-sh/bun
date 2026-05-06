//! Non-blocking buffered writer for one fd. Multiple shell "children" can
//! enqueue chunks; when a chunk completes (or errors), the writer fires
//! `on_io_writer_chunk` on the owning child.

use bun_sys::Fd;

use crate::shell::interpreter::{EventLoopHandle, Interpreter, NodeId};
use crate::shell::yield_::Yield;

/// In the NodeId-arena port, a "writer child" is `(NodeId, WriterTag)` — the
/// id of the owning state node plus a tag saying which `on_io_writer_chunk`
/// impl to dispatch to. Replaces Zig's `TaggedPtrUnion<(Builtin, Cmd,
/// Pipeline, …)>`.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct ChildPtr {
    pub node: NodeId,
    pub tag: WriterTag,
}

impl ChildPtr {
    pub const NULL: ChildPtr = ChildPtr { node: NodeId::NONE, tag: WriterTag::Cmd };
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum WriterTag {
    /// Builtin running inside a Cmd — dispatch via `Builtin::on_io_writer_chunk`.
    Builtin,
    Cmd,
    Pipeline,
    Subshell,
    CondExpr,
    If,
    /// Subprocess stdin pipe.
    Subproc,
}

#[derive(Clone, Copy, Default)]
pub struct Flags {
    pub pollable: bool,
    pub is_socket: bool,
    pub nonblock: bool,
}

pub struct IOWriter {
    pub fd: Fd,
    pub evtloop: EventLoopHandle,
    pub flags: Flags,
    // TODO(b2-blocked): bun_io::BufferedWriter, writers queue, FilePoll — gated body.
}

impl IOWriter {
    pub fn init(fd: Fd, flags: Flags, evtloop: EventLoopHandle) -> std::sync::Arc<IOWriter> {
        std::sync::Arc::new(IOWriter { fd, evtloop, flags })
    }
}

/// Hoisted dispatch for the `onIOWriterChunk` callback (PORTING.md §Dispatch
/// hot-path). Called by `Yield::OnIoWriterChunk` and by the writer's poll
/// callback.
pub fn on_io_writer_chunk(
    interp: &mut Interpreter,
    child: ChildPtr,
    written: usize,
    err: Option<bun_sys::SystemError>,
) -> Yield {
    use crate::shell::builtin::Builtin;
    match child.tag {
        WriterTag::Builtin => Builtin::on_io_writer_chunk(interp, child.node, written, err),
        // TODO(b2-blocked): per-state on_io_writer_chunk (Cmd writes "command
        // not found", Pipeline/Subshell/CondExpr/If write error msgs).
        WriterTag::Cmd
        | WriterTag::Pipeline
        | WriterTag::Subshell
        | WriterTag::CondExpr
        | WriterTag::If
        | WriterTag::Subproc => Yield::suspended(),
    }
}

// The full body (~1200 lines: chunk queue, BufferedWriter integration,
// FilePoll registration, cancel_chunks, handle_broken_pipe, AsyncDeinitWriter,
// enqueue/enqueue_fmt_bltn) is preserved gated — depends on
// bun_io::BufferedWriter and bun_aio::FilePoll.
#[cfg(any())]
mod io_writer_body {
    include!("IOWriter_body_gated.rs");
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/IOWriter.zig (1067 lines)
//   confidence: low (NodeId ChildPtr scaffolding; writer body gated)
//   blocked_on: bun_io::BufferedWriter, bun_aio::FilePoll
// ──────────────────────────────────────────────────────────────────────────
