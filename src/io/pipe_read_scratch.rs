use core::cell::{Cell, UnsafeCell};
use core::ops::{Deref, DerefMut};

pub const PIPE_READ_BUFFER_SIZE: usize = 256 * 1024;
type PipeReadBuffer = [u8; PIPE_READ_BUFFER_SIZE];

/// Per-loop scratch for blocking pipe/file reads. Chunks are delivered straight out of it, and a consumer may run user code that starts a nested read while still parsing the chunk, so only one borrower on the thread may hold it at a time.
pub struct PipeReadScratch {
    in_use: Cell<bool>,
    buffer: UnsafeCell<Option<Box<PipeReadBuffer>>>,
}

impl PipeReadScratch {
    pub const fn new() -> Self {
        Self {
            in_use: Cell::new(false),
            buffer: UnsafeCell::new(None),
        }
    }

    /// `None` while a borrower further up the stack still holds the guard.
    pub fn claim(&self) -> Option<PipeReadScratchGuard<'_>> {
        if self.in_use.replace(true) {
            return None;
        }
        Some(PipeReadScratchGuard(self))
    }
}

/// Exclusive claim on the scratch; released on drop.
pub struct PipeReadScratchGuard<'a>(&'a PipeReadScratch);

impl Deref for PipeReadScratchGuard<'_> {
    type Target = [u8];
    #[inline]
    fn deref(&self) -> &[u8] {
        // SAFETY: `in_use` is set, so this guard is the only accessor of `buffer` until it drops.
        unsafe { &(*self.0.buffer.get()).get_or_insert_with(bun_core::boxed_zeroed)[..] }
    }
}

impl DerefMut for PipeReadScratchGuard<'_> {
    #[inline]
    fn deref_mut(&mut self) -> &mut [u8] {
        // SAFETY: as in `deref`.
        unsafe { &mut (*self.0.buffer.get()).get_or_insert_with(bun_core::boxed_zeroed)[..] }
    }
}

impl Drop for PipeReadScratchGuard<'_> {
    fn drop(&mut self) {
        self.0.in_use.set(false);
    }
}
