use bun_io::StreamBuffer;
use bun_sys::SystemErrno;

/// Bytes a write accepted and the socket hasn't taken yet. A partial send advances a cursor instead of moving the rest.
#[derive(Default)]
pub(crate) struct PendingWrites {
    bytes: StreamBuffer,
    completion: Completion,
}

/// How the queued bytes end, which their owner hears once.
#[derive(Default, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Completion {
    #[default]
    None,
    /// `$write` answered "queued", so node:net waits for one `writeComplete` call.
    Owed,
    /// The bytes are lost. The error waits for the close, behind what the peer sent.
    Failed(SystemErrno),
    /// The TLS layer's send of records it held met the peer's reset ahead of the poll. The close reports what the poll's would: a failed read, and a canceled write.
    Reset,
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

    /// Frees the bytes.
    #[inline]
    pub(crate) fn clear(&mut self) {
        self.bytes = StreamBuffer::default();
    }

    #[inline]
    pub(crate) fn completion(&self) -> Completion {
        self.completion
    }

    /// The owner handed over bytes and hasn't heard how they ended. The TLS layer's own records (a handshake flight, an alert) aren't the owner's.
    #[inline]
    pub(crate) fn is_pending(&self) -> bool {
        self.len() > 0 || self.completion == Completion::Owed
    }

    /// `$write` answers "queued".
    #[inline]
    pub(crate) fn owe_completion(&mut self) {
        if self.completion == Completion::None {
            self.completion = Completion::Owed;
        }
    }

    #[inline]
    pub(crate) fn is_lost(&self) -> bool {
        matches!(self.completion, Completion::Failed(_) | Completion::Reset)
    }

    /// Frees the bytes, which no send can deliver any more. The first failure is the one reported.
    pub(crate) fn fail(&mut self, errno: SystemErrno) {
        self.clear();
        if !self.is_lost() {
            self.completion = Completion::Failed(errno);
        }
    }

    /// `fail()` for a send that the TLS layer made by itself, of records it held.
    pub(crate) fn fail_held_records(&mut self, errno: SystemErrno) {
        self.clear();
        if !self.is_lost() {
            self.completion = match errno {
                SystemErrno::ECONNRESET => Completion::Reset,
                _ => Completion::Failed(errno),
            };
        }
    }

    /// Frees the bytes and hands the completion to the caller, who delivers it.
    pub(crate) fn take(&mut self) -> Completion {
        self.clear();
        core::mem::take(&mut self.completion)
    }
}
