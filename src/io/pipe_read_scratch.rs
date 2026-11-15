use core::cell::Cell;

pub const PIPE_READ_BUFFER_SIZE: usize = 256 * 1024;
type PipeReadBuffer = [u8; PIPE_READ_BUFFER_SIZE];

/// Per-loop scratch for blocking pipe/file reads. Chunks are delivered straight out of it, and a consumer may run user code that starts a nested read while still parsing the chunk, so only one borrower on the thread may hold it at a time.
pub struct PipeReadScratch {
    in_use: Cell<bool>,
    buffer: Cell<Option<Box<PipeReadBuffer>>>,
}

impl PipeReadScratch {
    pub const fn new() -> Self {
        Self {
            in_use: Cell::new(false),
            buffer: Cell::new(None),
        }
    }

    /// `None` while a borrower further up the stack still holds the guard.
    pub fn claim(&self) -> Option<PipeReadScratchGuard<'_>> {
        if self.in_use.replace(true) {
            return None;
        }
        Some(PipeReadScratchGuard {
            scratch: self,
            buffer: self.buffer.take(),
        })
    }
}

/// Exclusive claim on the scratch; released on drop.
pub struct PipeReadScratchGuard<'a> {
    scratch: &'a PipeReadScratch,
    buffer: Option<Box<PipeReadBuffer>>,
}

impl PipeReadScratchGuard<'_> {
    pub fn as_mut_slice(&mut self) -> &mut [u8] {
        &mut self.buffer.get_or_insert_with(bun_core::boxed_zeroed)[..]
    }
}

impl Drop for PipeReadScratchGuard<'_> {
    fn drop(&mut self) {
        self.scratch.buffer.set(self.buffer.take());
        self.scratch.in_use.set(false);
    }
}
