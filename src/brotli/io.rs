//! Where the decoder and the encoder put their output.

/// A buffer of limited size that is filled from the start.
pub trait Output {
    /// How many more bytes fit.
    fn available(&self) -> usize;
    /// Appends `bytes`, which is no longer than [`Self::available`].
    fn write(&mut self, bytes: &[u8]);
}

/// The slice shrinks from the front, to what is still free.
impl Output for &mut [u8] {
    #[inline]
    fn available(&self) -> usize {
        self.len()
    }

    #[inline]
    fn write(&mut self, bytes: &[u8]) {
        let buffer = core::mem::take(self);
        if let Some((head, tail)) = buffer.split_at_mut_checked(bytes.len()) {
            head.copy_from_slice(bytes);
            *self = tail;
        }
    }
}

/// The spare capacity of a `Vec`, which is never reallocated, up to a total length of `limit`.
pub struct SpareCapacity<'a> {
    vec: &'a mut Vec<u8>,
    limit: usize,
}

impl<'a> SpareCapacity<'a> {
    pub fn new(vec: &'a mut Vec<u8>, limit: usize) -> Self {
        Self { vec, limit }
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
    fn write(&mut self, bytes: &[u8]) {
        if bytes.len() <= self.available() {
            self.vec.extend_from_slice(bytes);
        }
    }
}
