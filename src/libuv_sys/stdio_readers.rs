//! The one reading `uv_pipe_t` open over each stdio fd (0, 1, 2), process-wide.
//!
//! `uv_pipe_open` on fd 0..=2 duplicates the CRT handle, so all pipes over one
//! stdio fd share one kernel file object. That object is synchronous (child
//! stdio pipes are opened without `FILE_FLAG_OVERLAPPED`), so the kernel runs
//! its I/O requests one at a time. libuv reads it with a zero-byte `ReadFile`
//! parked on a pool thread, which holds that turn until data arrives; a second
//! pipe over the same object then blocks the loop thread in `uv_pipe_open`
//! (`SetNamedPipeHandleState`) and later in `PeekNamedPipe`.
//!
//! A reader claims the fd before its `uv_pipe_open` (`Pipe::open_for_reading`)
//! and gets `UV_EBUSY` while another reader holds it. `UvHandle::close` and
//! `close_walk_cb` release it before `uv_close`, which cancels the parked read
//! and closes the handle before it returns, so the next reader needs no loop
//! turn. Writers do not claim: `process.stdout` and `Bun.stdout.writer()` each
//! hold a pipe over fd 1, and a `WriteFile` holds its turn only while writing.

use super::*;

use core::sync::atomic::{AtomicPtr, Ordering};

static READERS: [AtomicPtr<uv_handle_t>; 3] = [
    AtomicPtr::new(ptr::null_mut()),
    AtomicPtr::new(ptr::null_mut()),
    AtomicPtr::new(ptr::null_mut()),
];

fn slot(fd: uv_file) -> Option<&'static AtomicPtr<uv_handle_t>> {
    READERS.get(usize::try_from(fd).ok()?)
}

/// `false` when another pipe already reads `fd`. A non-stdio fd is not shared: always `true`.
pub(crate) fn claim(fd: uv_file, pipe: *mut Pipe) -> bool {
    let Some(slot) = slot(fd) else {
        return true;
    };
    slot.compare_exchange(
        ptr::null_mut(),
        pipe.cast(),
        Ordering::AcqRel,
        Ordering::Acquire,
    )
    .is_ok()
}

/// Forget `handle` as a stdio reader, if it is one.
pub(crate) fn release(handle: *mut uv_handle_t) {
    for slot in &READERS {
        let _ = slot.compare_exchange(handle, ptr::null_mut(), Ordering::AcqRel, Ordering::Acquire);
    }
}
