//! Streams of bits.

use bun_zstd_decoder::bounded::Bounded;

use crate::bytes::likely;

const WORD_LEN: usize = 8;

/// Takes a word at a time, of which some bytes count. `None` means that there is no room.
pub(super) struct WordWriter<'a> {
    /// The compiler sees its length as `last + WORD_LEN`, and compares the position with `last`.
    out: &'a mut [u8],
    last: usize,
    position: usize,
}

impl<'a> WordWriter<'a> {
    #[inline(always)]
    pub(super) fn new(out: &'a mut [u8]) -> Option<Self> {
        let last = out.len().checked_sub(WORD_LEN)? as u32 as usize;
        Some(Self {
            out: out.get_mut(..last + WORD_LEN)?,
            last,
            position: 0,
        })
    }

    #[inline(always)]
    pub(super) fn put(&mut self, word: u64, len: u32) -> Option<()> {
        let position = likely(Some(self.position).filter(|&it| it <= self.last))?;
        let bytes = self.out.get_mut(position..position + WORD_LEN)?;
        *bytes.as_mut_array()? = word.to_le_bytes();
        self.position = position + len as usize;
        Some(())
    }

    /// Room for two words, which count as far as it [`advance`](Self::advance)s.
    #[inline(always)]
    pub(super) fn two_words(&mut self) -> Option<&mut [u8; 2 * WORD_LEN]> {
        self.out.get_mut(self.position..)?.first_chunk_mut()
    }

    #[inline(always)]
    pub(super) fn advance(&mut self, len: u32) {
        self.position += len as usize;
    }

    /// The length of what was written.
    #[inline(always)]
    pub(super) fn finish(self, has_partial_byte: bool) -> Option<usize> {
        (self.position < self.last).then(|| self.position + usize::from(has_partial_byte))
    }
}

/// Writes bits from the lowest up.
pub(super) struct BitWriter<'a> {
    words: WordWriter<'a>,
    bits: u64,
    count: u32,
}

impl<'a> BitWriter<'a> {
    #[inline(always)]
    pub(super) fn new(out: &'a mut [u8]) -> Option<Self> {
        Some(Self {
            words: WordWriter::new(out)?,
            bits: 0,
            count: 0,
        })
    }

    /// The lowest `count` bits of `value`. At most 63 bits can be pending.
    #[inline(always)]
    pub(super) fn add(&mut self, value: u32, count: u32) {
        self.add_all(u64::from(value) & 1u64.wrapping_shl(count).minus(1), count);
    }

    /// For a `value` without higher bits.
    #[inline(always)]
    pub(super) fn add_all(&mut self, value: u64, count: u32) {
        self.bits |= value.wrapping_shl(self.count);
        self.count = self.count.plus(count);
    }

    /// Leaves at most 7 bits pending.
    #[inline(always)]
    pub(super) fn flush(&mut self) -> Option<()> {
        self.words.put(self.bits, self.count / 8)?;
        self.bits = self.bits.wrapping_shr(self.count & !7);
        self.count %= 8;
        Some(())
    }

    /// The length of the stream.
    #[inline(always)]
    pub(super) fn finish(mut self) -> Option<usize> {
        self.add(1, 1);
        self.flush()?;
        self.words.finish(self.count > 0)
    }
}
