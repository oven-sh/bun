//! Reader of a frozen, serialized `UTrie2`. ICU4C: utrie2.h, utrie2.cpp, utrie2_impl.h

use crate::common::bytes::{U16s, U32s, u16_array, u16_halves};
use crate::common::uniset::UnicodeSet;
use std::mem::replace;

const UTRIE2_SIG: u32 = 0x5472_6932; // "Tri2"
const HEADER_SIZE: usize = 16;

const UTRIE2_SHIFT_1: u32 = 6 + 5;
const UTRIE2_SHIFT_2: u32 = 5;
const UTRIE2_SHIFT_1_2: u32 = UTRIE2_SHIFT_1 - UTRIE2_SHIFT_2;
const UTRIE2_OMITTED_BMP_INDEX_1_LENGTH: u32 = 0x10000 >> UTRIE2_SHIFT_1;
const UTRIE2_CP_PER_INDEX_1_ENTRY: u32 = 1 << UTRIE2_SHIFT_1;
const UTRIE2_INDEX_2_BLOCK_LENGTH: u32 = 1 << UTRIE2_SHIFT_1_2;
const UTRIE2_INDEX_2_MASK: u32 = UTRIE2_INDEX_2_BLOCK_LENGTH - 1;
const UTRIE2_DATA_BLOCK_LENGTH: u32 = 1 << UTRIE2_SHIFT_2;
const UTRIE2_DATA_MASK: u32 = UTRIE2_DATA_BLOCK_LENGTH - 1;
const UTRIE2_INDEX_SHIFT: u32 = 2;
const UTRIE2_DATA_GRANULARITY: usize = 1 << UTRIE2_INDEX_SHIFT;
const UTRIE2_LSCP_INDEX_2_OFFSET: u32 = 0x10000 >> UTRIE2_SHIFT_2;
const UTRIE2_LSCP_INDEX_2_LENGTH: u32 = 0x400 >> UTRIE2_SHIFT_2;
const UTRIE2_INDEX_2_BMP_LENGTH: u32 = UTRIE2_LSCP_INDEX_2_OFFSET + UTRIE2_LSCP_INDEX_2_LENGTH;
const UTRIE2_UTF8_2B_INDEX_2_OFFSET: u32 = UTRIE2_INDEX_2_BMP_LENGTH;
const UTRIE2_UTF8_2B_INDEX_2_LENGTH: u32 = 0x800 >> 6;
const UTRIE2_INDEX_1_OFFSET: u32 = UTRIE2_UTF8_2B_INDEX_2_OFFSET + UTRIE2_UTF8_2B_INDEX_2_LENGTH;
const UTRIE2_BAD_UTF8_DATA_OFFSET: usize = 0x80;

#[derive(Clone, Copy)]
pub(crate) enum UTrie2ValueBits {
    Bits16 = 0,
    Bits32 = 1,
}

#[derive(Clone, Copy, Default)]
pub(crate) struct UTrie2<'a> {
    /// The index, followed by the data if that is 16-bit. Offsets of 16-bit data count from the start of the index.
    index: U16s<'a>,
    data32: U32s<'a>,
    index_length: usize,
    index2_null_offset: u16,
    data_null_offset: u16,
    high_start: u32,
    high_value_index: usize,
}

impl<'a> UTrie2<'a> {
    /// `data` may extend past the trie.
    pub(crate) const fn open_from_serialized(
        value_bits: UTrie2ValueBits,
        data: &'a [u8],
    ) -> Option<Self> {
        let Some(header) = data.first_chunk() else {
            return None;
        };
        let [
            signature0,
            signature1,
            options,
            index_length,
            data_length,
            index2_null,
            data_null,
            high_start,
        ] = u16_array(header);
        let [expected0, expected1] = u16_halves(UTRIE2_SIG);
        let (index_length, data_length) = (
            index_length as usize,
            (data_length as usize) << UTRIE2_INDEX_SHIFT,
        );
        if signature0 != expected0
            || signature1 != expected1
            || options & 0xf != value_bits as u16
            || index_length < UTRIE2_INDEX_1_OFFSET as usize
            || data_length <= UTRIE2_BAD_UTF8_DATA_OFFSET
        {
            return None;
        }
        let (length16, length32, data_limit) = match value_bits {
            UTrie2ValueBits::Bits16 => (index_length + data_length, 0, index_length + data_length),
            UTrie2ValueBits::Bits32 => (index_length, data_length, data_length),
        };
        let (Some(index), Some(data32)) = (
            U16s::try_from_offset(data, HEADER_SIZE, length16),
            U32s::try_from_offset(data, HEADER_SIZE + length16 * 2, length32),
        ) else {
            return None;
        };
        Some(UTrie2 {
            index,
            data32,
            index_length,
            index2_null_offset: index2_null,
            data_null_offset: data_null,
            high_start: (high_start as u32) << UTRIE2_SHIFT_1,
            high_value_index: data_limit - UTRIE2_DATA_GRANULARITY,
        })
    }

    #[inline(always)]
    fn index_raw(&self, offset: u32, c: u32) -> usize {
        (usize::from(self.index.at((offset + (c >> UTRIE2_SHIFT_2)) as usize))
            << UTRIE2_INDEX_SHIFT)
            + (c & UTRIE2_DATA_MASK) as usize
    }

    #[inline(always)]
    fn supp_index2_block(&self, c: u32) -> usize {
        let i1 =
            (UTRIE2_INDEX_1_OFFSET - UTRIE2_OMITTED_BMP_INDEX_1_LENGTH) + (c >> UTRIE2_SHIFT_1);
        usize::from(self.index.at(i1 as usize))
    }

    #[inline(always)]
    fn index_from_supp(&self, c: u32) -> usize {
        let i2 = self.supp_index2_block(c) + ((c >> UTRIE2_SHIFT_2) & UTRIE2_INDEX_2_MASK) as usize;
        (usize::from(self.index.at(i2)) << UTRIE2_INDEX_SHIFT) + (c & UTRIE2_DATA_MASK) as usize
    }

    #[inline(always)]
    fn index_from_cp(&self, ascii_offset: usize, c: u32) -> usize {
        const LSCP: u32 = UTRIE2_LSCP_INDEX_2_OFFSET - (0xd800 >> UTRIE2_SHIFT_2);
        if c < 0xd800 {
            self.index_raw(0, c)
        } else if c <= 0xffff {
            self.index_raw(if c <= 0xdbff { LSCP } else { 0 }, c)
        } else if c > 0x10_ffff {
            ascii_offset + UTRIE2_BAD_UTF8_DATA_OFFSET
        } else if c >= self.high_start {
            self.high_value_index
        } else {
            self.index_from_supp(c)
        }
    }

    #[inline(always)]
    pub(crate) fn get16(&self, c: u32) -> u16 {
        self.index.at(self.index_from_cp(self.index_length, c))
    }

    #[inline(always)]
    pub(crate) fn get16_from_u16_single_lead(&self, c: u16) -> u16 {
        self.index.at(self.index_raw(0, u32::from(c)))
    }

    #[inline(always)]
    pub(crate) fn get32(&self, c: u32) -> u32 {
        self.data32.at(self.index_from_cp(0, c))
    }

    #[inline(always)]
    pub(crate) fn get32_from_u16_single_lead(&self, c: u16) -> u32 {
        self.data32.at(self.index_raw(0, u32::from(c)))
    }

    #[inline(always)]
    pub(crate) fn get32_from_supp(&self, c: u32) -> u32 {
        self.data32.at(if c >= self.high_start {
            self.high_value_index
        } else {
            self.index_from_supp(c)
        })
    }

    #[inline(always)]
    pub(crate) fn get32_from_ascii(&self, c: u8) -> u32 {
        self.data32.at(usize::from(c))
    }

    /// Takes a UTF-8 lead byte in `0xc2..=0xdf` and the low six bits of its trail byte.
    #[inline(always)]
    pub(crate) fn get32_from_utf8_2b(&self, lead: u8, t1: u8) -> u32 {
        let block = self
            .index
            .at(UTRIE2_UTF8_2B_INDEX_2_OFFSET as usize - 0xc0 + usize::from(lead));
        self.data32.at(usize::from(block) + usize::from(t1))
    }

    fn value_at(&self, index: usize) -> u32 {
        if self.data32.is_empty() {
            self.index.at(index).into()
        } else {
            self.data32.at(index)
        }
    }

    pub(crate) fn add_range_starts(&self, set: &mut UnicodeSet) {
        self.enum_ranges(|start, _, _| {
            set.add(start);
            true
        });
    }

    /// Calls `enum_range(start, end, value)` for each range of equal values until it returns false.
    pub(crate) fn enum_ranges(&self, mut enum_range: impl FnMut(u32, u32, u32) -> bool) {
        const LIMIT: u32 = 0x11_0000;
        let mut range = CurrentRange {
            start: 0,
            value: 0,
            enum_range: &mut enum_range,
        };
        let null_block = usize::from(self.data_null_offset);
        let initial_value = self.value_at(null_block);
        let (mut prev_i2_block, mut prev_block) = (usize::MAX, usize::MAX);
        // A multiple of 0x400 at the start of each round.
        let mut c = 0;
        while c < self.high_start.min(LIMIT) {
            let (i2_block, i2_limit) = match c {
                0xd800 => (
                    UTRIE2_LSCP_INDEX_2_OFFSET as usize,
                    UTRIE2_LSCP_INDEX_2_LENGTH,
                ),
                0xdc00 => (0xd800 >> UTRIE2_SHIFT_2, UTRIE2_INDEX_2_BLOCK_LENGTH),
                ..0x1_0000 => ((c >> UTRIE2_SHIFT_2) as usize, UTRIE2_INDEX_2_BLOCK_LENGTH),
                _ => (self.supp_index2_block(c), UTRIE2_INDEX_2_BLOCK_LENGTH),
            };
            if i2_block == prev_i2_block && c - range.start >= UTRIE2_CP_PER_INDEX_1_ENTRY {
                c += UTRIE2_CP_PER_INDEX_1_ENTRY;
                continue;
            }
            prev_i2_block = i2_block;
            if i2_block == usize::from(self.index2_null_offset) {
                if !range.visit(c, initial_value) {
                    return;
                }
                prev_block = null_block;
                c += UTRIE2_CP_PER_INDEX_1_ENTRY;
                continue;
            }
            for i2 in (c >> UTRIE2_SHIFT_2) & UTRIE2_INDEX_2_MASK..i2_limit {
                let block =
                    usize::from(self.index.at(i2_block + i2 as usize)) << UTRIE2_INDEX_SHIFT;
                let repeats_uniform_block =
                    block == prev_block && c - range.start >= UTRIE2_DATA_BLOCK_LENGTH;
                prev_block = block;
                let should_continue = if repeats_uniform_block {
                    true
                } else if block == null_block {
                    range.visit(c, initial_value)
                } else {
                    (0..UTRIE2_DATA_BLOCK_LENGTH)
                        .all(|j| range.visit(c + j, self.value_at(block + j as usize)))
                };
                if !should_continue {
                    return;
                }
                c += UTRIE2_DATA_BLOCK_LENGTH;
            }
        }
        if c >= LIMIT || range.visit(c, self.value_at(self.high_value_index)) {
            (range.enum_range)(range.start, LIMIT - 1, range.value);
        }
    }
}

struct CurrentRange<'f> {
    start: u32,
    value: u32,
    enum_range: &'f mut dyn FnMut(u32, u32, u32) -> bool,
}

impl CurrentRange<'_> {
    /// Reports the range and starts a new one at `c` if `value` differs. Returns false if `enum_range` returns false.
    #[inline(always)]
    fn visit(&mut self, c: u32, value: u32) -> bool {
        if value == self.value {
            return true;
        }
        let (start, value) = (replace(&mut self.start, c), replace(&mut self.value, value));
        start == c || (self.enum_range)(start, c - 1, value)
    }
}
