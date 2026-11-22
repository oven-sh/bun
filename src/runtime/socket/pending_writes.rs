use bun_io::StreamBuffer;
use bun_jsc::{JSValue, RetainedArrayBuffer};

/// Bytes a write accepted and the socket has not taken. A partial send advances a cursor, and an empty queue holds no allocation.
#[derive(Default)]
pub(crate) struct PendingWrites(Unsent);

enum Unsent {
    Copied(StreamBuffer),
    /// The rest of one chunk, sent from the caller's own buffer.
    Held(RetainedArrayBuffer),
}

const _: () = assert!(size_of::<Unsent>() == size_of::<StreamBuffer>());

impl Default for Unsent {
    fn default() -> Self {
        Unsent::Copied(StreamBuffer::default())
    }
}

impl PendingWrites {
    /// A rest of this size or less is copied, as node:http copies a write of it (`PINNED_WRITE_THRESHOLD`).
    const MIN_HELD: usize = 16 * 1024;

    #[inline]
    pub(crate) fn len(&self) -> usize {
        match &self.0 {
            Unsent::Copied(copied) => copied.size(),
            Unsent::Held(chunk) => chunk.byte_slice().len(),
        }
    }

    #[inline]
    pub(crate) fn slice(&self) -> &[u8] {
        match &self.0 {
            Unsent::Copied(copied) => copied.slice(),
            Unsent::Held(chunk) => chunk.byte_slice(),
        }
    }

    /// The allocation, sent prefix included. A held chunk is the caller's.
    #[inline]
    pub(crate) fn capacity(&self) -> usize {
        match &self.0 {
            Unsent::Copied(copied) => copied.list.capacity(),
            Unsent::Held(_) => 0,
        }
    }

    /// Keeps `bytes[sent..]` of `chunk` without a copy. False: the caller appends them.
    pub(crate) fn hold(&mut self, chunk: JSValue, bytes: &[u8], sent: usize) -> bool {
        if self.len() != 0 || bytes.len() - sent <= Self::MIN_HELD {
            return false;
        }
        let Some(held) = RetainedArrayBuffer::new(chunk, &bytes[sent..]) else {
            return false;
        };
        self.0 = Unsent::Held(held);
        true
    }

    /// A chunk that follows a held one goes out behind a copy of its rest.
    pub(crate) fn append_slice(&mut self, bytes: &[u8]) {
        match &mut self.0 {
            Unsent::Copied(copied) => bun_core::handle_oom(copied.write(bytes)),
            Unsent::Held(_) if bytes.is_empty() => {}
            Unsent::Held(chunk) => {
                let rest = chunk.byte_slice();
                let mut copied = StreamBuffer::default();
                bun_core::handle_oom(copied.ensure_unused_capacity(rest.len() + bytes.len()));
                copied.write_assume_capacity(rest);
                copied.write_assume_capacity(bytes);
                self.0 = Unsent::Copied(copied);
            }
        }
    }

    #[inline]
    pub(crate) fn clear_and_free(&mut self) {
        self.0 = Unsent::default();
    }

    /// Drops the first `n` unsent bytes.
    #[inline]
    pub(crate) fn consume(&mut self, n: usize) {
        if n >= self.len() {
            return self.clear_and_free();
        }
        match &mut self.0 {
            Unsent::Copied(copied) => copied.wrote(n),
            Unsent::Held(chunk) => chunk.advance(n),
        }
    }

    /// `consume(n)` then `append_slice(bytes)`. When `n` covers the whole queue, `bytes` reuse its allocation.
    #[cfg(unix)]
    #[inline]
    pub(crate) fn consume_then_append(&mut self, n: usize, bytes: &[u8]) {
        if bytes.is_empty() {
            return self.consume(n);
        }
        match &mut self.0 {
            Unsent::Copied(copied) if n >= copied.size() => {
                copied.cursor = 0;
                copied.list.clear();
            }
            _ => self.consume(n),
        }
        self.append_slice(bytes);
    }

    /// Lets go of a held chunk and returns how many bytes of it were unsent.
    pub(crate) fn release_held(&mut self) -> usize {
        let Unsent::Held(chunk) = &self.0 else {
            return 0;
        };
        let unsent = chunk.byte_slice().len();
        self.clear_and_free();
        unsent
    }
}
