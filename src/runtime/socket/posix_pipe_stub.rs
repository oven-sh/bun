//! Windows stand-in for the POSIX `PosixPipe` transport.
//!
//! `bun_dispatch::link_interface!` has no `#[cfg]` support on variants: every
//! variant of `BufferedReaderParentLink` emits an `extern "Rust"` symbol set
//! that the low tier references unconditionally, so a variant with no
//! `link_impl` on a platform is a link error there. This never-constructed
//! ZST satisfies the `PosixPipe` variant on Windows; the real type lives in
//! `PosixPipe.rs` under `#[cfg(unix)]`.

use bun_io::{BufferedReaderParent, Chunk, ReadState};

pub(crate) struct PosixPipe {
    _never: core::convert::Infallible,
}

impl BufferedReaderParent for PosixPipe {
    const KIND: bun_io::BufferedReaderParentLinkKind =
        bun_io::BufferedReaderParentLinkKind::PosixPipe;
    const HAS_ON_READ_CHUNK: bool = true;

    unsafe fn on_read_chunk(_this: *mut Self, _chunk: Chunk<'_>, _has_more: ReadState) -> bool {
        unreachable!("PosixPipe is never constructed on Windows")
    }
    unsafe fn on_reader_done(_this: *mut Self) {
        unreachable!("PosixPipe is never constructed on Windows")
    }
    unsafe fn on_reader_error(_this: *mut Self, _err: bun_sys::Error) {
        unreachable!("PosixPipe is never constructed on Windows")
    }
    unsafe fn loop_(_this: *mut Self) -> *mut bun_io::pipe_reader::Loop {
        unreachable!("PosixPipe is never constructed on Windows")
    }
    unsafe fn event_loop(_this: *mut Self) -> bun_io::EventLoopHandle {
        unreachable!("PosixPipe is never constructed on Windows")
    }
}

bun_io::buffered_reader_parent_link!(PosixPipe for PosixPipe);
