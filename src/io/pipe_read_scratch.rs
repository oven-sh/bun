use core::mem::MaybeUninit;
use core::ops::{Deref, DerefMut};

pub const PIPE_READ_BUFFER_SIZE: usize = 256 * 1024;

#[derive(PartialEq, Eq)]
enum State {
    Available,
    Used,
}

/// Per-loop scratch for blocking pipe/file reads. Chunks are delivered straight out of it, and a consumer may run user code that starts a nested read while still parsing the chunk, so only one borrower on the thread may hold it at a time.
pub struct PipeReadScratch {
    state: State,
    buffer: Box<[MaybeUninit<u8>]>,
}

impl PipeReadScratch {
    pub fn new() -> Self {
        Self {
            state: State::Available,
            buffer: Box::new_uninit_slice(0),
        }
    }

    /// `None` while a borrower further up the stack still holds the guard.
    pub fn claim(&mut self) -> Option<PipeReadScratchGuard<'_>> {
        if self.state == State::Used {
            return None;
        }
        self.state = State::Used;
        if self.buffer.is_empty() {
            self.buffer = Box::new_uninit_slice(PIPE_READ_BUFFER_SIZE);
        }
        Some(PipeReadScratchGuard(self))
    }
}

impl Default for PipeReadScratch {
    fn default() -> Self {
        Self::new()
    }
}

/// Exclusive claim on the scratch; released on drop.
pub struct PipeReadScratchGuard<'a>(&'a mut PipeReadScratch);

impl Deref for PipeReadScratchGuard<'_> {
    type Target = [u8];
    #[inline]
    fn deref(&self) -> &[u8] {
        // SAFETY: `u8` has no validity invariant; the buffer only ever receives kernel writes and callers observe just the prefix a read reported.
        unsafe { &*(core::ptr::from_ref(&self.0.buffer[..]) as *const [u8]) }
    }
}

impl DerefMut for PipeReadScratchGuard<'_> {
    #[inline]
    fn deref_mut(&mut self) -> &mut [u8] {
        // SAFETY: as in `deref`.
        unsafe { &mut *(core::ptr::from_mut(&mut self.0.buffer[..]) as *mut [u8]) }
    }
}

impl Drop for PipeReadScratchGuard<'_> {
    fn drop(&mut self) {
        self.0.state = State::Available;
    }
}
