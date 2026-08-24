//! The one reading `uv_pipe_t` open over each stdio fd (0, 1, 2), process-wide.
//!
//! `uv_pipe_open` on fd 0..=2 duplicates the CRT handle, so every pipe opened
//! over the same stdio fd shares one kernel file object. The pipe a parent
//! hands its child as stdio is, as a rule, synchronous (opened without
//! `FILE_FLAG_OVERLAPPED`), and the kernel serialises every I/O request on a
//! synchronous file object through that object's lock. libuv reads such a
//! pipe with a zero-byte `ReadFile` parked on a thread-pool thread
//! (`uv_pipe_zero_readfile_thread_proc`), which holds the lock until data or
//! EOF arrives. Any other pipe over the same file object then blocks the loop
//! thread: `uv_pipe_open` (`SetNamedPipeHandleState`, `NtQueryInformationFile`)
//! while opening, and `PeekNamedPipe` / `ReadFile` in `uv__pipe_read_data`
//! while reading.
//!
//! So a stdio fd takes one reader at a time, whatever mode its pipe is in.
//! [`claim`] runs before the `uv_pipe_open` of a reader
//! (`Pipe::open_for_reading`); [`release`] runs when the `uv_close` for any
//! handle is issued (`UvHandle::close`, `close_walk_cb`). `uv__pipe_close`
//! cancels the pending zero-byte read and closes the handle before it
//! returns, so the next reader may open the fd as soon as the previous one's
//! `uv_close` is issued, without a loop turn.
//!
//! Writers never claim: a `WriteFile` holds the lock only for the write, and
//! process.stdout and `Bun.stdout.writer()` may each hold a pipe over fd 1.

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

/// Record `pipe` as the reader of `fd`. `false` when another pipe already
/// reads it. Always `true` for a non-stdio fd: such a handle is not shared.
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

/// Forget `handle` as the reader of whichever stdio fd it holds. No-op for a
/// handle that holds none.
pub(crate) fn release(handle: *mut uv_handle_t) {
    for slot in &READERS {
        let _ = slot.compare_exchange(handle, ptr::null_mut(), Ordering::AcqRel, Ordering::Acquire);
    }
}
