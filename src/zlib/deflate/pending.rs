//! Compressed data that has not been handed out yet.

use bun_core::vec::{BorrowedCursor, append_with};
use bun_deflate::encoder::Bits;
use bun_deflate::format::{END_OF_BLOCK, STATIC, STORED, static_litlen_codeword};

use crate::error::{Error, Result};

/// Not 0, or copies would be slow on AMD: https://sourceware.org/bugzilla/show_bug.cgi?id=30994
const START: usize = 64;

type Out<'a> = BorrowedCursor<'a, u8>;

/// What is written goes to the output as far as it has room, so that it is full if there are bytes here.
pub(super) struct Pending {
    bytes: Vec<u8>,
    start: usize,
    bits: Bits,
    size: u32,
    result: Result<()>,
}

impl Pending {
    pub(super) fn new(size: u32) -> Self {
        Self {
            bytes: Vec::new(),
            start: 0,
            bits: Bits::default(),
            size,
            result: Ok(()),
        }
    }

    pub(super) fn clear(&mut self) {
        self.bytes.clear();
        (self.start, self.bits, self.result) = (0, Bits::default(), Ok(()));
    }

    /// An error if something is missing.
    pub(super) fn result(&self) -> Result<()> {
        self.result
    }

    /// What zlib would have room for.
    pub(super) fn size(&self) -> usize {
        self.size as usize
    }

    /// There may be bits.
    pub(super) fn has_no_bytes(&self) -> bool {
        self.start == self.bytes.len()
    }

    /// How many bytes the bits so far and the header of a stored block take.
    pub(super) fn stored_header_len(&self) -> usize {
        (self.bits.count + 3).div_ceil(8) + 4
    }

    /// As far as there is room.
    pub(super) fn hand_out(&mut self, out: &mut Out<'_>) {
        let bytes = self.bytes.get(self.start..).unwrap_or_default();
        let bytes = bytes.get(..out.capacity()).unwrap_or(bytes);
        out.append(bytes);
        self.start += bytes.len();
    }

    fn try_reserve(&mut self, len: usize) -> bool {
        let is_empty = self.has_no_bytes();
        if is_empty {
            self.bytes.clear();
            self.start = 0;
        }
        if let Err(error) = self.bytes.try_reserve(START + len) {
            self.result = Err(error.into());
        } else if is_empty {
            self.bytes.resize(START, 0);
            self.start = START;
        }
        self.result.is_ok()
    }

    /// `write` puts `len` bytes, straight into `out` if it can.
    pub(super) fn write(
        &mut self,
        len: usize,
        out: &mut Out<'_>,
        write: impl FnOnce(Out<'_>, &mut Bits) -> bool,
    ) {
        let is_written = if len + 16 <= out.capacity() {
            write(out.reborrow(), &mut self.bits)
        } else if self.try_reserve(len + 16) {
            let bits = &mut self.bits;
            append_with(&mut self.bytes, usize::MAX, |room| write(room, bits))
        } else {
            return;
        };
        self.hand_out(out);
        if !is_written {
            self.result = Err(Error::Internal);
        }
    }

    fn append(&mut self, bytes: &[u8], out: &mut Out<'_>) {
        let (now, later) = bytes.split_at(bytes.len().min(out.capacity()));
        out.append(now);
        if !later.is_empty() && self.try_reserve(later.len()) {
            self.bytes.extend_from_slice(later);
        }
    }

    fn put(&mut self, value: u64, count: usize, out: &mut Out<'_>) {
        let all = self.bits.value | value << self.bits.count;
        let count = self.bits.count + count;
        self.append(all.to_le_bytes().get(..count / 8).unwrap_or_default(), out);
        self.bits = Bits {
            value: all >> (count & !7),
            count: count % 8,
        };
    }

    pub(super) fn pad_to_byte_boundary(&mut self, out: &mut Out<'_>) {
        self.put(0, self.bits.count.wrapping_neg() % 8, out);
    }

    /// From the next byte boundary on.
    pub(super) fn write_bytes(&mut self, bytes: &[u8], out: &mut Out<'_>) {
        self.pad_to_byte_boundary(out);
        self.append(bytes, out);
    }

    pub(super) fn write_empty_block(&mut self, out: &mut Out<'_>) {
        let end = static_litlen_codeword(END_OF_BLOCK);
        self.put(
            (end.bits << 3 | STATIC << 1).into(),
            3 + end.len as usize,
            out,
        );
    }

    pub(super) fn write_stored_header(&mut self, len: u16, is_last: bool, out: &mut Out<'_>) {
        let count = 8 * self.stored_header_len() - self.bits.count;
        let lens = u64::from(len) | u64::from(!len) << 16;
        let kind = STORED << 1 | u32::from(is_last);
        self.put(lens << (count - 32) | u64::from(kind), count, out);
    }

    pub(super) fn write_stored_block(&mut self, bytes: &[u8], is_last: bool, out: &mut Out<'_>) {
        self.write_stored_header(bytes.len() as u16, is_last, out);
        self.append(bytes, out);
    }
}
