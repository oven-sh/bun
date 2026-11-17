//! Compressed data that has not been handed out yet.

use bun_core::vec::BorrowedCursor;

use crate::error::Result;
use crate::format::STORED_BLOCK;
use crate::vec;

const WORD: usize = size_of::<u64>();

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
        Ok(Self {
            bytes: vec::with_room(size + 2 * WORD)?,
            start: 0,
            end: 0,
            bits: 0,
            bit_count: 0,
            size,
            has_overflowed: false,
        })
    }

    pub(super) fn clear(&mut self) {
        (self.start, self.end, self.bits, self.bit_count) = (0, 0, 0, 0);
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

    /// How many bytes the bits so far and the header of a stored block take.
    pub(super) fn stored_header_len(&self) -> usize {
        (self.bit_count as usize + 3).div_ceil(8) + 4
    }

    /// All but the bits of a byte that is not full, as far as there is room.
    pub(super) fn hand_out(&mut self, out: &mut BorrowedCursor<'_, u8>) {
        if self.bit_count >= 8 {
            self.write_bits(WORD, |_| {});
        }
        let bytes = self.bytes.get(self.start..self.end).unwrap_or_default();
        let bytes = bytes.get(..out.capacity()).unwrap_or(bytes);
        out.append(bytes);
        self.start += bytes.len();
        if self.has_no_bytes() {
            (self.start, self.end) = (0, 0);
        }
    }

    /// `write` puts at most `max_len` bytes.
    #[inline(always)]
    pub(super) fn write_bits<R>(
        &mut self,
        max_len: usize,
        write: impl FnOnce(&mut BitWriter<'_>) -> R,
    ) -> R {
        let len = self.end + max_len + 2 * WORD;
        if self.bytes.len() < len {
            self.bytes.resize(len.min(self.bytes.capacity()), 0);
        }
        let mut writer = BitWriter {
            bytes: &mut self.bytes,
            end: self.end as u32,
            bits: self.bits,
            count: self.bit_count,
        };
        writer.put(0, 0);
        let result = write(&mut writer);
        (self.end, self.bits, self.bit_count) = (writer.end as usize, writer.bits, writer.count);
        self.has_overflowed |= self.end + WORD > self.bytes.len();
        result
    }

    /// The stream is at a byte boundary.
    pub(super) fn write_bytes(&mut self, bytes: &[u8]) {
        debug_assert_eq!(self.bit_count, 0);
        debug_assert!(self.end + bytes.len() <= self.bytes.capacity());
        vec::write_at(&mut self.bytes, self.end, bytes);
        self.end += bytes.len();
    }

    pub(super) fn write_stored_header(&mut self, len: u16, is_last: bool) {
        self.write_bits(WORD, |writer| {
            writer.put_block_type(STORED_BLOCK, is_last);
            writer.pad_to_byte_boundary();
            writer.put(u64::from(len) | u64::from(!len) << 16, 32);
        });
    }

    pub(super) fn write_stored_block(&mut self, bytes: &[u8], is_last: bool) {
        self.write_stored_header(bytes.len() as u16, is_last);
        if !bytes.is_empty() {
            self.write_bytes(bytes);
        }
    }

    /// zlib-ng has only whole words pending in the middle of a block.
    pub(super) fn hold_back_partial_word(&mut self) {
        let whole = self.end - self.end % WORD;
        for &byte in self
            .bytes
            .get(whole..self.end)
            .unwrap_or_default()
            .iter()
            .rev()
        {
            self.bits = self.bits << 8 | u64::from(byte);
            self.bit_count += 8;
        }
        self.end = whole;
    }
}

pub(super) struct BitWriter<'a> {
    bytes: &'a mut [u8],
    end: u32,
    bits: u64,
    /// Below 8 between calls.
    count: u32,
}

impl BitWriter<'_> {
    /// `count` is at most 56, and `bits` has no more.
    #[inline(always)]
    pub(super) fn put(&mut self, bits: u64, count: u32) {
        self.bits |= bits.wrapping_shl(self.count);
        self.count += count;
        let end = self.end as usize;
        let room = self.bytes.get_mut(end..end + WORD);
        debug_assert!(room.is_some());
        if let Some(room) = room {
            room.copy_from_slice(&self.bits.to_le_bytes());
        }
        self.end += self.count / 8;
        self.bits = self.bits.wrapping_shr(self.count & !7);
        self.count %= 8;
    }

    pub(super) fn put_block_type(&mut self, block_type: u32, is_last: bool) {
        self.put(u64::from(block_type << 1 | u32::from(is_last)), 3);
    }

    pub(super) fn pad_to_byte_boundary(&mut self) {
        self.put(0, self.count.wrapping_neg() % 8);
    }

    #[inline(always)]
    pub(super) fn len(&self) -> usize {
        self.end as usize
    }
}
