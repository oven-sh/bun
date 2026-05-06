//! Non-blocking buffered reader for one fd, fan-out to multiple shell
//! "child" listeners (currently only `cat`).

use bun_sys::Fd;

use crate::shell::interpreter::{EventLoopHandle, Interpreter, NodeId};
use crate::shell::yield_::Yield;

/// In the NodeId-arena port, listeners are identified by `(NodeId, ReaderTag)`
/// — the node id of the owning Cmd plus a tag saying which builtin impl to
/// dispatch the `on_read_chunk`/`on_reader_done` callback to. Replaces the
/// Zig `TaggedPtrUnion<(Cat,)>`.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct ChildPtr {
    pub node: NodeId,
    pub tag: ReaderTag,
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ReaderTag {
    Cat,
}

pub struct IOReader {
    pub fd: Fd,
    pub evtloop: EventLoopHandle,
    pub readers: Vec<ChildPtr>,
    // TODO(b2-blocked): bun_io::BufferedReader, FilePoll — gated body.
}

impl IOReader {
    pub fn init(fd: Fd, evtloop: EventLoopHandle) -> std::sync::Arc<IOReader> {
        std::sync::Arc::new(IOReader { fd, evtloop, readers: Vec::new() })
    }
}

/// Hoisted dispatch for `on_read_chunk` (PORTING.md §Dispatch hot-path).
pub fn on_read_chunk(_interp: &mut Interpreter, child: ChildPtr, _chunk: &[u8]) -> Yield {
    match child.tag {
        // TODO(b2-blocked): builtin::cat::Cat::on_read_chunk(interp, child.node, chunk)
        ReaderTag::Cat => Yield::suspended(),
    }
}

pub fn on_reader_done(
    _interp: &mut Interpreter,
    child: ChildPtr,
    _err: Option<bun_sys::Error>,
) -> Yield {
    match child.tag {
        ReaderTag::Cat => Yield::suspended(),
    }
}

// The full body (~400 lines: BufferedReader integration, FilePoll registration,
// add_reader/remove_reader, AsyncDeinitReader) is preserved gated — depends on
// bun_io::BufferedReader and bun_aio::FilePoll.
#[cfg(any())]
mod io_reader_body {
    include!("IOReader_body_gated.rs");
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/IOReader.zig (304 lines)
//   confidence: low (NodeId ChildPtr scaffolding; reader body gated)
//   blocked_on: bun_io::BufferedReader, bun_aio::FilePoll
// ──────────────────────────────────────────────────────────────────────────
