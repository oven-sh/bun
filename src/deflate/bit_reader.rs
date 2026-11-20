//! Reads a stream from the lowest bit of its first byte. Zeros follow the end.

use crate::{Error, Result};

/// How many bytes the two refills of a turn of the fast loop may load.
pub(crate) const LOOKAHEAD: usize = 16;
/// How many zero bytes may be loaded. The buffer holds 7, so more means that some were consumed.
const MAX_OVERREAD: usize = 8;
pub(crate) const BITS_IN_REFILL: u32 = 56;

pub(crate) struct Input<'a> {
    bytes: &'a [u8],
    /// `bytes[tail_start..]`, and zeros.
    tail: [u8; LOOKAHEAD + MAX_OVERREAD + LOOKAHEAD],
    tail_start: usize,
}

/// The read state, separate from [`Input`] so that loops keep it in registers.
#[derive(Clone, Copy, Default)]
pub(crate) struct Bits {
    /// The next bit is the lowest. After a refill all 64 are those of the stream, also those past `count`.
    pub(crate) buffer: u64,
    /// The low byte is how many bits of `buffer` are from before `next`. The other bytes are garbage.
    count: u32,
    pub(crate) next: usize,
}

impl<'a> Input<'a> {
    pub(crate) fn new(bytes: &'a [u8]) -> Self {
        let mut tail = [0; _];
        match (bytes.last_chunk::<LOOKAHEAD>(), tail.first_chunk_mut()) {
            (Some(from), Some(to)) => *to = *from,
            _ => tail
                .iter_mut()
                .zip(bytes)
                .for_each(|(to, from)| *to = *from),
        }
        Self {
            bytes,
            tail,
            tail_start: bytes.len().saturating_sub(LOOKAHEAD),
        }
    }

    /// Bytes that go on for [`LOOKAHEAD`] after `position`, where a refill left off, and their position in the input.
    #[inline(always)]
    pub(crate) fn window(&self, position: usize) -> (&[u8], usize) {
        if position < self.tail_start {
            return (self.bytes, 0);
        }
        let end = self.bytes.len() - self.tail_start + MAX_OVERREAD + LOOKAHEAD;
        (self.tail.get(..end).unwrap_or_default(), self.tail_start)
    }

    pub(crate) fn bytes_from(&self, position: usize) -> Result<&'a [u8]> {
        self.bytes.get(position..).ok_or(Error::BadData)
    }
}

impl Bits {
    pub(crate) fn at(position: usize) -> Self {
        Self {
            next: position,
            ..Self::default()
        }
    }

    /// The position of the first byte of which no bit was consumed.
    pub(crate) fn byte_position(self) -> usize {
        self.next - usize::from(self.count as u8 / 8)
    }

    /// `word` is the 8 bytes at `next`.
    #[inline(always)]
    pub(crate) fn refill_with(&mut self, word: [u8; 8]) -> usize {
        self.buffer |= u64::from_le_bytes(word).wrapping_shl(self.count);
        let advance = ((self.count as usize % 64) ^ 63) / 8;
        self.count |= BITS_IN_REFILL;
        advance
    }

    #[inline(always)]
    pub(crate) fn refill(&mut self, input: &Input<'_>) -> Result<()> {
        let word_at = |bytes: &[u8], at: usize| bytes.get(at..)?.first_chunk().copied();
        if let Some(word) = word_at(input.bytes, self.next) {
            self.next += self.refill_with(word);
            return Ok(());
        }
        let word = word_at(&input.tail, self.next - input.tail_start);
        self.next += self.refill_with(word.unwrap_or_default());
        match self.next <= input.bytes.len() + MAX_OVERREAD {
            true => Ok(()),
            false => Err(Error::BadData),
        }
    }

    /// Drops as many bits as the low byte of `entry` says. Returns the buffer as it was.
    #[inline(always)]
    pub(crate) fn consume(&mut self, entry: u32) -> u64 {
        let before = self.buffer;
        self.buffer = before.wrapping_shr(entry);
        self.count = self.count.wrapping_sub(entry);
        before
    }
}
