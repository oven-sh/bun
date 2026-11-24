//! Compressed data that has not been handed out yet.

use bun_core::vec::BorrowedCursor;
use bun_deflate::format::STORED;

use crate::error::Result;
use crate::vec;

const WORD: usize = size_of::<u64>();
/// Not 0, or copies would be slow on AMD: https://sourceware.org/bugzilla/show_bug.cgi?id=30994
const START: usize = 64;

/// A number, and how many bits it takes: at most 63.
#[derive(Clone, Copy)]
pub(super) struct Bits(pub(super) u64, pub(super) u32);

impl Bits {
    pub(super) fn block_header(block_type: u32, is_last: bool) -> Self {
        Self(u64::from(block_type << 1 | u32::from(is_last)), 3)
    }
}

pub(super) struct Pending {
    /// Only as long as it has had to be.
    bytes: Vec<u8>,
    start: usize,
    end: usize,
    bits: u64,
    /// Below 64.
    bit_count: u32,
    size: usize,
    /// For what the code rules out: more was written than there was room for.
    has_overflowed: bool,
}

impl Pending {
    pub(super) fn new(size: usize) -> Result<Self> {
        let mut bytes = vec::with_room(START + size + 2 * WORD)?;
        bytes.resize(START, 0);
        Ok(Self {
            bytes,
            start: START,
            end: START,
            bits: 0,
            bit_count: 0,
            size,
            has_overflowed: false,
        })
    }

    pub(super) fn clear(&mut self) {
        (self.start, self.end, self.bits, self.bit_count) = (START, START, 0, 0);
        self.has_overflowed = false;
    }

    pub(super) fn has_overflowed(&self) -> bool {
        self.has_overflowed
    }

    /// No block takes more.
    pub(super) fn size(&self) -> usize {
        self.size
    }

    /// There may be bits.
    pub(super) fn has_no_bytes(&self) -> bool {
        self.start == self.end
    }

    /// There is no room for another word and the end of the block.
    pub(super) fn is_almost_full(&self) -> bool {
        self.end + WORD >= START + self.size
    }

    /// How many bytes the bits so far and the header of a stored block take.
    pub(super) fn stored_header_len(&self) -> usize {
        (self.bit_count as usize + 3).div_ceil(8) + 4
    }

    /// All but the bits of a byte that is not full, as far as there is room.
    pub(super) fn hand_out(&mut self, out: &mut BorrowedCursor<'_, u8>) {
        self.move_whole_bytes();
        let bytes = self.bytes.get(self.start..self.end).unwrap_or_default();
        let bytes = bytes.get(..out.capacity()).unwrap_or(bytes);
        out.append(bytes);
        self.start += bytes.len();
        if self.has_no_bytes() {
            (self.start, self.end) = (START, START);
        }
    }

    fn move_whole_bytes(&mut self) {
        let len = self.bit_count / 8;
        if len != 0 {
            let bytes = self.bits.to_le_bytes();
            self.append(bytes.get(..len as usize).unwrap_or_default());
            self.bits = self.bits.checked_shr(8 * len).unwrap_or_default();
            self.bit_count %= 8;
        }
    }

    fn append(&mut self, bytes: &[u8]) {
        debug_assert!(self.end + bytes.len() <= self.bytes.capacity());
        vec::write_at(&mut self.bytes, self.end, bytes);
        self.end += bytes.len();
    }

    /// For `max_len` bytes and what is held back, but no further than `limit`.
    #[inline(always)]
    fn room(&mut self, max_len: usize, limit: usize) -> &mut [u8] {
        let end = (self.end + max_len + 2 * WORD).min(limit);
        if self.bytes.len() < end {
            self.bytes.resize(end, 0);
        }
        self.bytes.get_mut(self.end..end).unwrap_or_default()
    }

    #[inline(always)]
    fn write_up_to(&mut self, max_len: usize, limit: usize, write: impl FnOnce(&mut Writer<'_>)) {
        let (bits, count) = (self.bits, self.bit_count);
        let words = self.room(max_len, limit).as_chunks_mut().0;
        let available = words.len();
        let mut writer = Writer {
            words: words.iter_mut(),
            bits,
            count,
            dropped: false,
        };
        write(&mut writer);
        let Writer {
            words,
            bits,
            count,
            dropped,
        } = writer;
        let written = available - words.len();
        (self.bits, self.bit_count) = (bits, count);
        self.end += WORD * written;
        self.has_overflowed |= dropped;
    }

    /// `write` puts at most `max_len` bytes.
    #[inline(always)]
    pub(super) fn write(&mut self, max_len: usize, write: impl FnOnce(&mut Writer<'_>)) {
        self.write_up_to(max_len, self.bytes.capacity(), write);
    }

    /// The writer has room until `is_almost_full()`.
    #[inline(always)]
    pub(super) fn write_some(&mut self, max_len: usize, write: impl FnOnce(&mut Writer<'_>)) {
        self.write_up_to(max_len, START + self.size - WORD, write);
    }

    /// Without a branch that is hard to predict. `bits_of` gives at most 56 bits each, and `max_len` bytes in all.
    #[inline(always)]
    pub(super) fn put_all<T: Copy>(
        &mut self,
        max_len: usize,
        items: &[T],
        bits_of: impl Fn(T) -> Bits,
    ) {
        const MAX_BITS: u32 = u64::BITS - 8;
        self.move_whole_bytes();
        let (mut held, mut held_count, mut written) = (self.bits, self.bit_count, 0u32);
        let room = self.room(max_len, self.bytes.capacity());
        let mut put = |Bits(bits, count)| {
            held |= bits.wrapping_shl(held_count);
            held_count += count;
            let word = room.get_mut(written as usize..written as usize + WORD);
            if let Some(word) = word.and_then(<[u8]>::as_mut_array) {
                *word = held.to_le_bytes();
            }
            written += held_count / 8;
            held = held.wrapping_shr(held_count & !7);
            held_count %= 8;
        };
        let (pairs, rest) = items.as_chunks();
        for &[first, second] in pairs {
            let (first, second) = (bits_of(first), bits_of(second));
            if first.1 + second.1 <= MAX_BITS {
                let both = first.0 | second.0.wrapping_shl(first.1);
                put(Bits(both, first.1 + second.1));
            } else {
                put(first);
                put(second);
            }
        }
        for &item in rest {
            put(bits_of(item));
        }
        let fits = written as usize + WORD <= room.len();
        (self.bits, self.bit_count) = (held, held_count);
        self.end += if fits { written as usize } else { 0 };
        self.has_overflowed |= !fits;
    }

    pub(super) fn put(&mut self, bits: Bits) {
        self.write(WORD, |writer| writer.put(bits));
    }

    pub(super) fn pad_to_byte_boundary(&mut self) {
        self.bit_count = self.bit_count.next_multiple_of(8);
        self.move_whole_bytes();
    }

    /// From the next byte boundary on.
    pub(super) fn write_bytes(&mut self, bytes: &[u8]) {
        self.pad_to_byte_boundary();
        self.append(bytes);
    }

    pub(super) fn write_stored_header(&mut self, len: u16, is_last: bool) {
        self.put(Bits::block_header(STORED, is_last));
        self.write_bytes(&(u32::from(len) | u32::from(!len) << 16).to_le_bytes());
    }

    pub(super) fn write_stored_block(&mut self, bytes: &[u8], is_last: bool) {
        self.write_stored_header(bytes.len() as u16, is_last);
        self.append(bytes);
    }
}

/// Holds bits back until they make a word.
pub(super) struct Writer<'a> {
    words: core::slice::IterMut<'a, [u8; WORD]>,
    bits: u64,
    /// Below 64.
    count: u32,
    dropped: bool,
}

impl Writer<'_> {
    #[inline(always)]
    pub(super) fn put(&mut self, bits: Bits) {
        self.put_and_check(bits);
    }

    /// Whether there is room for more.
    #[inline(always)]
    pub(super) fn put_and_check(&mut self, Bits(bits, count): Bits) -> bool {
        self.bits |= bits.wrapping_shl(self.count);
        self.count += count;
        if self.count < u64::BITS {
            return true;
        }
        self.count -= u64::BITS;
        match self.words.next() {
            Some(word) => *word = self.bits.to_le_bytes(),
            None => self.dropped = true,
        }
        self.bits = bits.wrapping_shr(count - self.count);
        self.words.len() != 0
    }
}
