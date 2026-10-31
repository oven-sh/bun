//! Where the decoder and the encoder put their output.

/// A buffer of limited size that is filled from the start. The decoder and the encoder take it as `dyn` so that they are
/// compiled once.
pub trait Output {
    /// How many more bytes fit.
    fn available(&self) -> usize;
    /// Appends as much of `bytes` as fits, and returns how much that was.
    #[must_use]
    fn write(&mut self, bytes: &[u8]) -> usize;
}

/// The slice shrinks from the front, to what is still free.
impl Output for &mut [u8] {
    #[inline]
    fn available(&self) -> usize {
        self.len()
    }

    #[inline]
    fn write(&mut self, bytes: &[u8]) -> usize {
        let len = bytes.len().min(self.len());
        let (head, tail) = core::mem::take(self).split_at_mut(len);
        head.copy_from_slice(bytes.split_at(len).0);
        *self = tail;
        len
    }
}

/// The spare capacity of a `Vec`, which is never reallocated, up to a total length of `limit`.
pub struct SpareCapacity<'a> {
    vec: &'a mut Vec<u8>,
    start: usize,
    limit: usize,
}

impl<'a> SpareCapacity<'a> {
    pub fn new(vec: &'a mut Vec<u8>, limit: usize) -> Self {
        let start = vec.len();
        Self { vec, start, limit }
    }
}

impl Output for SpareCapacity<'_> {
    #[inline]
    fn available(&self) -> usize {
        self.vec
            .capacity()
            .min(self.limit)
            .saturating_sub(self.vec.len())
    }

    #[inline]
    fn write(&mut self, bytes: &[u8]) -> usize {
        let len = bytes.len().min(self.available());
        self.vec.extend_from_slice(bytes.split_at(len).0);
        len
    }
}

/// An [`Output`] that can start over.
pub(crate) trait Rewind: Output {
    fn written(&self) -> usize;
    /// Discards what was written.
    fn rewind(&mut self);
}

impl Rewind for SpareCapacity<'_> {
    fn written(&self) -> usize {
        self.vec.len() - self.start
    }

    fn rewind(&mut self) {
        self.vec.truncate(self.start);
    }
}

pub(crate) struct Cursor<'a> {
    buffer: &'a mut [u8],
    written: usize,
}

impl<'a> Cursor<'a> {
    pub(crate) fn new(buffer: &'a mut [u8]) -> Self {
        Self { buffer, written: 0 }
    }
}

impl Output for Cursor<'_> {
    fn available(&self) -> usize {
        self.buffer.len() - self.written
    }

    fn write(&mut self, bytes: &[u8]) -> usize {
        let written = self.buffer.split_at_mut(self.written).1.write(bytes);
        self.written += written;
        written
    }
}

impl Rewind for Cursor<'_> {
    fn written(&self) -> usize {
        self.written
    }

    fn rewind(&mut self) {
        self.written = 0;
    }
}
