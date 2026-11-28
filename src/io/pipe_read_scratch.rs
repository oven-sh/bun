use core::cell::Cell;

pub const PIPE_READ_BUFFER_SIZE: usize = 256 * 1024;

/// Per-loop scratch for blocking pipe/file reads. Chunks are delivered straight out of it, and a consumer may run user code that starts a nested read while still parsing the chunk, so only one borrower on the thread may hold it at a time.
pub struct PipeReadScratch {
    in_use: Cell<bool>,
    /// Not zeroed, so that the pages that nothing is read into stay untouched.
    buffer: Cell<Vec<u8>>,
}

impl PipeReadScratch {
    pub const fn new() -> Self {
        Self {
            in_use: Cell::new(false),
            buffer: Cell::new(Vec::new()),
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
    buffer: Vec<u8>,
}

impl PipeReadScratchGuard<'_> {
    /// Empty, with capacity for `PIPE_READ_BUFFER_SIZE` bytes.
    pub fn empty_buffer(&mut self) -> &mut Vec<u8> {
        self.buffer.clear();
        self.buffer.reserve_exact(PIPE_READ_BUFFER_SIZE);
        &mut self.buffer
    }
}

impl Drop for PipeReadScratchGuard<'_> {
    fn drop(&mut self) {
        self.scratch.buffer.set(core::mem::take(&mut self.buffer));
        self.scratch.in_use.set(false);
    }
}
