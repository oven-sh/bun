use core::mem::MaybeUninit;
use core::ops::{Deref, DerefMut};

pub const PIPE_READ_BUFFER_SIZE: usize = 256 * 1024;
type PipeReadBuffer = [MaybeUninit<u8>; PIPE_READ_BUFFER_SIZE];

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
    pub fn claim(&mut self) -> Option<PipeReadScratchGuard<'_>> {
        if self.state == State::Used {
            return None;
        }
        self.state = State::Used;
        Some(PipeReadScratchGuard {
            state: &mut self.state,
            buffer: &mut self.buffer.get_or_insert_with(new_buffer)[..],
        })
    }
}

fn new_buffer() -> Box<PipeReadBuffer> {
    // SAFETY: an array of `MaybeUninit` is valid in any byte state, so the uninit box already is one.
    unsafe { Box::<PipeReadBuffer>::new_uninit().assume_init() }
}

impl Default for PipeReadScratch {
    fn default() -> Self {
        Self::new()
    }
}

/// Exclusive claim on the scratch; released on drop.
pub struct PipeReadScratchGuard<'a> {
    state: &'a mut State,
    buffer: &'a mut [MaybeUninit<u8>],
}

impl Deref for PipeReadScratchGuard<'_> {
    type Target = [u8];
    #[inline]
    fn deref(&self) -> &[u8] {
        // SAFETY: `u8` has no validity invariant; the buffer only ever receives kernel writes and callers observe just the prefix a read reported.
        unsafe { &*(core::ptr::from_ref(&*self.buffer) as *const [u8]) }
    }
}

impl DerefMut for PipeReadScratchGuard<'_> {
    #[inline]
    fn deref_mut(&mut self) -> &mut [u8] {
        // SAFETY: as in `deref`.
        unsafe { &mut *(core::ptr::from_mut(&mut *self.buffer) as *mut [u8]) }
    }
}

impl Drop for PipeReadScratchGuard<'_> {
    fn drop(&mut self) {
        *self.state = State::Available;
    }
}
