use bun_io::StreamBuffer;

/// Bytes that a write accepted and the socket did not take yet. A partial send
/// advances a cursor and moves no bytes. An empty queue holds no allocation.
#[derive(Default)]
pub(crate) struct PendingWrites(StreamBuffer);

impl PendingWrites {
    #[inline]
    pub(crate) fn len(&self) -> usize {
        self.0.size()
    }

    #[inline]
    pub(crate) fn slice(&self) -> &[u8] {
        self.0.slice()
    }

    /// The allocation, sent prefix included.
    #[inline]
    pub(crate) fn capacity(&self) -> usize {
        self.0.list.capacity()
    }

    #[inline]
    pub(crate) fn append_slice(&mut self, bytes: &[u8]) {
        bun_core::handle_oom(self.0.write(bytes));
    }

    #[inline]
    pub(crate) fn clear_and_free(&mut self) {
        self.0 = StreamBuffer::default();
    }

    /// Drops the first `n` unsent bytes.
    #[inline]
    pub(crate) fn consume(&mut self, n: usize) {
        if n >= self.len() {
            self.clear_and_free();
        } else {
            self.0.wrote(n);
        }
    }

    /// Drops the first `n` unsent bytes and queues `bytes` behind the rest. When one
    /// writev took the queue and part of the chunk, `bytes` reuse the allocation.
    #[cfg(unix)]
    #[inline]
    pub(crate) fn consume_then_append(&mut self, n: usize, bytes: &[u8]) {
        if bytes.is_empty() {
            return self.consume(n);
        }
        if n >= self.len() {
            self.0.cursor = 0;
            self.0.list.clear();
        } else {
            self.0.wrote(n);
        }
        self.append_slice(bytes);
    }
}
