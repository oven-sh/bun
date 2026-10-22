use bun_io::StreamBuffer;

/// Bytes a write accepted and the socket hasn't taken yet. A partial send advances a cursor instead of moving the rest.
#[derive(Default)]
pub(crate) struct PendingWrites(StreamBuffer);

impl PendingWrites {
    /// The number of unsent bytes.
    #[inline]
    pub(crate) fn len(&self) -> usize {
        self.0.size()
    }

    /// The unsent bytes.
    #[inline]
    pub(crate) fn slice(&self) -> &[u8] {
        self.0.slice()
    }

    /// The size of the allocation, which includes the bytes already sent.
    #[inline]
    pub(crate) fn capacity(&self) -> usize {
        self.0.memory_cost()
    }

    #[inline]
    pub(crate) fn append_slice(&mut self, bytes: &[u8]) {
        bun_core::handle_oom(self.0.write(bytes));
    }

    #[inline]
    pub(crate) fn clear_and_free(&mut self) {
        self.0 = StreamBuffer::default();
    }

    /// Drops the first `n` bytes, which the socket took. An emptied queue frees its allocation.
    #[inline]
    pub(crate) fn consume(&mut self, n: usize) {
        // One writev sends the queue and part of the chunk behind it, so `n` can exceed `len()`.
        if n >= self.len() {
            self.clear_and_free();
        } else {
            self.0.wrote(n);
        }
    }
}
