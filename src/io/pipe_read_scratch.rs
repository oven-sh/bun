use core::ops::{Deref, DerefMut};
use core::ptr::NonNull;

pub const PIPE_READ_BUFFER_SIZE: usize = 256 * 1024;
type PipeReadBuffer = [u8; PIPE_READ_BUFFER_SIZE];

#[derive(PartialEq, Eq)]
enum State {
    Available,
    Used,
}

/// Per-loop scratch for blocking pipe/file reads. Chunks are delivered straight out of it, and a consumer may run user code that starts a nested read while still parsing the chunk, so only one borrower on the thread may hold it at a time.
pub struct PipeReadScratch {
    state: State,
    buffer: Option<Box<PipeReadBuffer>>,
}

impl PipeReadScratch {
    pub const fn new() -> Self {
        Self {
            state: State::Available,
            buffer: None,
        }
    }

    /// `None` while a borrower further up the stack still holds the guard.
    pub fn claim(&mut self) -> Option<PipeReadScratchGuard> {
        if self.state == State::Used {
            return None;
        }
        self.state = State::Used;
        let buffer = self.buffer.get_or_insert_with(bun_core::boxed_zeroed);
        Some(PipeReadScratchGuard {
            buffer: NonNull::from(&mut buffer[..]),
            state: NonNull::from(&mut self.state),
        })
    }
}

impl Default for PipeReadScratch {
    fn default() -> Self {
        Self::new()
    }
}

/// Exclusive claim on the scratch; released on drop. Raw pointers rather than borrows: the owner (VM rare data / mini loop) is re-borrowed `&mut` by every nested `claim` that gets refused, which would invalidate a reference held here.
pub struct PipeReadScratchGuard {
    buffer: NonNull<[u8]>,
    state: NonNull<State>,
}

impl Deref for PipeReadScratchGuard {
    type Target = [u8];
    #[inline]
    fn deref(&self) -> &[u8] {
        // SAFETY: the owner outlives the guard and hands out no other view of the buffer while `state` is `Used`.
        unsafe { self.buffer.as_ref() }
    }
}

impl DerefMut for PipeReadScratchGuard {
    #[inline]
    fn deref_mut(&mut self) -> &mut [u8] {
        // SAFETY: as in `deref`.
        unsafe { self.buffer.as_mut() }
    }
}

impl Drop for PipeReadScratchGuard {
    fn drop(&mut self) {
        // SAFETY: the owner outlives the guard.
        unsafe { self.state.write(State::Available) };
    }
}
