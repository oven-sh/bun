use core::cell::{Cell, UnsafeCell};
use core::ops::{Deref, DerefMut};
use core::ptr::NonNull;

pub const PIPE_READ_BUFFER_SIZE: usize = 256 * 1024;
type PipeReadBuffer = [u8; PIPE_READ_BUFFER_SIZE];

#[derive(Clone, Copy, PartialEq, Eq)]
enum State {
    Available,
    Used,
}

/// Per-loop scratch for blocking pipe/file reads. Chunks are delivered straight out of it, and a consumer may run user code that starts a nested read while still parsing the chunk, so only one borrower on the thread may hold it at a time. Interior-mutable so a refused nested `claim` never forms a `&mut` over the outer guard's pointers.
pub struct PipeReadScratch {
    state: Cell<State>,
    buffer: UnsafeCell<Option<Box<PipeReadBuffer>>>,
}

impl PipeReadScratch {
    pub const fn new() -> Self {
        Self {
            state: Cell::new(State::Available),
            buffer: UnsafeCell::new(None),
        }
    }

    /// `None` while a borrower further up the stack still holds the guard.
    pub fn claim(&self) -> Option<PipeReadScratchGuard> {
        if self.state.replace(State::Used) == State::Used {
            return None;
        }
        // SAFETY: `state` was just moved to `Used`, so no guard (the only other accessor of `buffer`) exists; the borrow ends at `;`.
        let buffer = unsafe { &mut *self.buffer.get() }.get_or_insert_with(bun_core::boxed_zeroed);
        Some(PipeReadScratchGuard {
            buffer: NonNull::from(&mut buffer[..]),
            state: NonNull::from(&self.state),
        })
    }
}

impl Default for PipeReadScratch {
    fn default() -> Self {
        Self::new()
    }
}

/// Exclusive claim on the scratch; released on drop. The owner (VM rare data / mini loop) outlives every guard.
pub struct PipeReadScratchGuard {
    buffer: NonNull<[u8]>,
    state: NonNull<Cell<State>>,
}

impl Deref for PipeReadScratchGuard {
    type Target = [u8];
    #[inline]
    fn deref(&self) -> &[u8] {
        // SAFETY: the buffer is a separate heap allocation only reachable through this guard while `state` is `Used`.
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
        // SAFETY: the owner outlives the guard; `Cell` needs only a shared ref.
        unsafe { self.state.as_ref() }.set(State::Available);
    }
}
