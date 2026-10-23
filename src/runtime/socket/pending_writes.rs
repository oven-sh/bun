use bun_io::StreamBuffer;
use core::ffi::c_int;

/// Bytes a write accepted and the socket hasn't taken yet. A partial send advances a cursor instead of moving the rest.
#[derive(Default)]
pub(crate) struct PendingWrites {
    bytes: StreamBuffer,
    completion: Completion,
}

/// What `$write` still owes node:net: one `writeComplete` call for a write it answered "queued".
#[derive(Default, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Completion {
    #[default]
    None,
    Owed,
    /// The send failed for good. This status waits for the close, behind what the peer sent.
    Failed(c_int),
}

impl PendingWrites {
    /// The number of unsent bytes.
    #[inline]
    pub(crate) fn len(&self) -> usize {
        self.bytes.size()
    }

    /// The unsent bytes.
    #[inline]
    pub(crate) fn slice(&self) -> &[u8] {
        self.bytes.slice()
    }

    /// The size of the allocation, which includes the bytes already sent.
    #[inline]
    pub(crate) fn capacity(&self) -> usize {
        self.bytes.memory_cost()
    }

    #[inline]
    pub(crate) fn append_slice(&mut self, bytes: &[u8]) {
        bun_core::handle_oom(self.bytes.write(bytes));
    }

    /// Drops the first `n` bytes, which the socket took. An emptied queue frees its allocation.
    #[inline]
    pub(crate) fn consume(&mut self, n: usize) {
        // One writev sends the queue and part of the chunk behind it, so `n` can exceed `len()`.
        if n >= self.len() {
            self.bytes = StreamBuffer::default();
        } else {
            self.bytes.wrote(n);
        }
    }

    #[inline]
    pub(crate) fn completion(&self) -> Completion {
        self.completion
    }

    /// `$write` answers "queued".
    #[inline]
    pub(crate) fn owe_completion(&mut self) {
        if self.completion == Completion::None {
            self.completion = Completion::Owed;
        }
    }

    /// Frees the bytes, which no send can deliver any more. The first failure is the one reported.
    pub(crate) fn fail(&mut self, status: c_int) {
        self.bytes = StreamBuffer::default();
        if self.completion == Completion::Owed {
            self.completion = Completion::Failed(status);
        }
    }

    /// Frees the bytes and hands the completion to the caller, who delivers it.
    pub(crate) fn take(&mut self) -> Completion {
        self.bytes = StreamBuffer::default();
        core::mem::take(&mut self.completion)
    }
}
