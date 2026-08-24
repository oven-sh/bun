//! The one reader of each stdio fd (0, 1, 2) that is a pipe, process-wide.
//!
//! `uv_pipe_open` on fd 0..=2 duplicates the CRT handle, so all handles over
//! one stdio fd share one kernel file object. That object is synchronous (child
//! stdio pipes are opened without `FILE_FLAG_OVERLAPPED`), so the kernel runs
//! its I/O requests one at a time. A read that waits for input holds that turn:
//! libuv's zero-byte `ReadFile` parked on a pool thread for a `uv_pipe_t`, or
//! the `ReadFile` of a `uv_fs_read`. Any other handle over the same object then
//! blocks the loop thread in `uv_pipe_open` (`SetNamedPipeHandleState`) and
//! later in `PeekNamedPipe`.
//!
//! A reader claims the fd before its first read (`Pipe::open_for_reading`,
//! `ReadFileUV::on_file_open`) and gets `EBUSY` while another reader holds it.
//! A pipe's claim ends in `UvHandle::close` and `close_walk_cb` once `uv_close`
//! has returned: by then the parked read is cancelled and the handle closed, so
//! the next reader, on this thread or another, never waits on the old one and
//! needs no loop turn. A `uv_fs_read` reader's claim ends when its last read
//! has completed. Writers do not claim: `process.stdout` and
//! `Bun.stdout.writer()` each hold a pipe over fd 1, and a `WriteFile` holds
//! its turn only while writing.

use super::*;

use core::sync::atomic::{AtomicPtr, Ordering};

static READERS: [AtomicPtr<c_void>; 3] = [
    AtomicPtr::new(ptr::null_mut()),
    AtomicPtr::new(ptr::null_mut()),
    AtomicPtr::new(ptr::null_mut()),
];

fn slot(fd: uv_file) -> Option<&'static AtomicPtr<c_void>> {
    READERS.get(usize::try_from(fd).ok()?)
}

/// `false` when another reader already holds `fd`. `reader` is any address
/// that is stable until [`release`]. A non-stdio fd is not shared: always `true`.
pub fn claim(fd: uv_file, reader: *mut c_void) -> bool {
    let Some(slot) = slot(fd) else {
        return true;
    };
    slot.compare_exchange(ptr::null_mut(), reader, Ordering::AcqRel, Ordering::Acquire)
        .is_ok()
}

/// Forget `reader` as a stdio reader, if it is one.
pub fn release(reader: *mut c_void) {
    for slot in &READERS {
        let _ = slot.compare_exchange(reader, ptr::null_mut(), Ordering::AcqRel, Ordering::Acquire);
    }
}
