//! Reader of a serialized code point trie. ICU4C: ucptrie.h, ucptrie.cpp, ucptrie_impl.h

use crate::common::bytes::{U16s, U32s, View, Word, u16_array, u16_halves};
use crate::common::slice_ext::{SliceExt, SoftUnwrap};
use crate::common::utf16;

const SIGNATURE: u32 = 0x5472_6933; // "Tri3"
const TYPE_SMALL: u16 = 1 << 6;
const VALUE_BITS_16: u16 = 0;
const VALUE_BITS_32: u16 = 1;
const VALUE_BITS_8: u16 = 2;
const MAX_UNICODE: u32 = 0x10_ffff;
const FAST_SHIFT: u32 = 6;
const FAST_DATA_MASK: u32 = (1 << FAST_SHIFT) - 1;
const ERROR_VALUE_NEG_DATA_OFFSET: usize = 1;
const HIGH_VALUE_NEG_DATA_OFFSET: usize = 2;
const SHIFT_3: u32 = 4;
const SHIFT_2: u32 = 5 + SHIFT_3;
const SHIFT_1: u32 = 5 + SHIFT_2;
/// Where the index-1 entry of U+0000 would be in a fast trie. Those of the BMP are omitted.
const FAST_INDEX_1: u32 = (0x10000 >> FAST_SHIFT) - (0x10000 >> SHIFT_1);
/// A small trie has fast data blocks below this code point.
const SMALL_LIMIT: u32 = 0x1000;
const CP_PER_INDEX_2_ENTRY: u32 = 1 << SHIFT_2;
const INDEX_2_MASK: u32 = (1 << (SHIFT_1 - SHIFT_2)) - 1;
const INDEX_3_MASK: u32 = (1 << (SHIFT_2 - SHIFT_3)) - 1;
const SMALL_DATA_MASK: u32 = (1 << SHIFT_3) - 1;

/// Maps a code point to the position of its value in the data.
#[derive(Clone, Copy)]
struct Index<'a>(U16s<'a>);

impl Index<'_> {
    #[inline(always)]
    fn entry(self, i: usize) -> usize {
        self.0.at(i).into()
    }

    #[inline(always)]
    fn bmp(self, c: u32) -> usize {
        self.entry((c >> FAST_SHIFT) as usize) + (c & FAST_DATA_MASK) as usize
    }

    #[inline(always)]
    fn i3_block(self, index_1: u32, c: u32) -> usize {
        let i2_block = self.entry(((c >> SHIFT_1) + index_1) as usize);
        self.entry(i2_block + ((c >> SHIFT_2) & INDEX_2_MASK) as usize)
    }

    #[inline(always)]
    fn data_block(self, i3_block: usize, i3: usize) -> usize {
        if i3_block & 0x8000 == 0 {
            self.entry(i3_block + i3)
        } else {
            // 18-bit offsets: each group of 8 entries is preceded by one entry that holds their upper 2 bits.
            let (group, i3) = ((i3_block & 0x7fff) + (i3 & !7) + (i3 >> 3), i3 & 7);
            ((self.entry(group) << (2 + 2 * i3)) & 0x30000) | self.entry(group + 1 + i3)
        }
    }

    // ICU4C: ucptrie.cpp, ucptrie_internalSmallIndex
    #[inline(always)]
    fn small(self, index_1: u32, c: u32) -> usize {
        let i3_block = self.i3_block(index_1, c);
        let i3 = ((c >> SHIFT_3) & INDEX_3_MASK) as usize;
        self.data_block(i3_block, i3) + (c & SMALL_DATA_MASK) as usize
    }

    fn supplementary(&self, c: u32) -> usize {
        self.small(FAST_INDEX_1, c)
    }
}

/// A trie of type `UCPTRIE_TYPE_FAST` with values of type `T`.
#[derive(Clone, Copy)]
pub(crate) struct FastTrie<'a, T, const N: usize> {
    index: Index<'a>,
    data: View<'a, T, N>,
    /// The value from `high_start` on.
    high_value: [u8; N],
    error_value: [u8; N],
    high_start: u32,
}

pub(crate) type FastTrie8<'a> = FastTrie<'a, u8, 1>;
pub(crate) type FastTrie16<'a> = FastTrie<'a, u16, 2>;

impl<'a, T: Word<N> + 'a, const N: usize> FastTrie<'a, T, N> {
    pub(crate) const EMPTY: Self = Self {
        index: Index(U16s::EMPTY),
        data: View::EMPTY,
        high_value: [0; N],
        error_value: [0; N],
        high_start: 0,
    };

    /// `bytes` may extend past the trie.
    pub(crate) const fn open(bytes: &'a [u8]) -> Option<Self> {
        let Some((header, arrays)) = bytes.split_first_chunk() else {
            return None;
        };
        let [
            signature0,
            signature1,
            options,
            index_length,
            data_length,
            _,
            _,
            high_start,
        ] = u16_array(header);
        let [expected0, expected1] = u16_halves(SIGNATURE);
        let index_length = index_length as usize;
        let data_length = ((options as usize & 0xf000) << 4) | data_length as usize;
        if signature0 == expected0
            && signature1 == expected1
            // The type, which is 0, and the value width.
            && options & 0xff == if N == 1 { VALUE_BITS_8 } else { VALUE_BITS_16 }
            && let Some(index) = U16s::try_from_offset(arrays, 0, index_length)
            && let Some(data) = View::try_from_offset(arrays, index_length * 2, data_length)
            && let Some(high_value) =
                data.bytes_at(data_length.wrapping_sub(HIGH_VALUE_NEG_DATA_OFFSET))
            && let Some(error_value) =
                data.bytes_at(data_length.wrapping_sub(ERROR_VALUE_NEG_DATA_OFFSET))
        {
            Some(Self {
                index: Index(index),
                data,
                high_value,
                error_value,
                high_start: (high_start as u32) << SHIFT_2,
            })
        } else {
            None
        }
    }

    #[inline(always)]
    pub(crate) fn bmp_get(&self, c: u16) -> T {
        self.data.at(self.index.bmp(c.into()))
    }

    /// Like `bmp_get`, but `None` out of bounds: a loop that exits on `None` takes fewer jumps.
    #[inline(always)]
    pub(crate) fn try_bmp_get(&self, c: u16) -> Option<T> {
        let block = self.index.0.get(usize::from(c >> FAST_SHIFT))?;
        self.data
            .get(usize::from(block) + (u32::from(c) & FAST_DATA_MASK) as usize)
            .soft_some()
    }

    #[inline(always)]
    pub(crate) fn supp_get(&self, c: u32) -> T {
        if c >= self.high_start {
            T::from_bytes(&self.high_value)
        } else {
            self.data.at(self.index.supplementary(c))
        }
    }

    #[inline(always)]
    pub(crate) fn get(&self, c: u32) -> T {
        let index = if c <= 0xffff {
            self.index.bmp(c)
        } else if c > MAX_UNICODE {
            return T::from_bytes(&self.error_value);
        } else if c >= self.high_start {
            return T::from_bytes(&self.high_value);
        } else {
            self.index.supplementary(c)
        };
        self.data.at(index)
    }

    /// Returns the code point at `*src` and its value, and advances `*src`. An unpaired surrogate has the error value.
    #[inline(always)]
    pub(crate) fn u16_next(&self, s: &[u16], src: &mut usize) -> (u32, T) {
        let mut c = u32::from(s.at(*src));
        *src += 1;
        let index = match s.get(*src) {
            _ if !utf16::is_surrogate(c) => self.index.bmp(c),
            Some(&trail) if utf16::is_surrogate_lead(c) && utf16::is_trail(trail.into()) => {
                *src += 1;
                c = utf16::get_supplementary(c, trail.into());
                if c >= self.high_start {
                    return (c, T::from_bytes(&self.high_value));
                }
                self.index.supplementary(c)
            }
            _ => return (c, T::from_bytes(&self.error_value)),
        };
        (c, self.data.at(index))
    }

    /// Like `u16_next`, backward, and not past `start`.
    #[inline(always)]
    pub(crate) fn u16_prev(&self, s: &[u16], start: usize, src: &mut usize) -> (u32, T) {
        *src = src.saturating_sub(1);
        let mut c = u32::from(s.at(*src));
        if !utf16::is_surrogate(c) {
            return (c, self.data.at(self.index.bmp(c)));
        }
        match (*src != start).then(|| u32::from(s.at(*src - 1))) {
            Some(lead) if !utf16::is_surrogate_lead(c) && utf16::is_lead(lead) => {
                *src -= 1;
                c = utf16::get_supplementary(lead, c);
                (c, self.supp_get(c))
            }
            _ => (c, T::from_bytes(&self.error_value)),
        }
    }
}

/// A trie of any type and value width.
#[derive(Clone, Copy)]
pub(crate) struct UCPTrie<'a> {
    index: Index<'a>,
    data: &'a [u8],
    data_length: usize,
    value_width: u16,
    /// The end of the fast data blocks.
    fast_limit: u32,
    index_1: u32,
    high_start: u32,
    index3_null_offset: usize,
    data_null_offset: usize,
}

impl<'a> UCPTrie<'a> {
    /// `bytes` may extend past the trie. ICU4C: ucptrie.cpp, ucptrie_openFromBinary
    pub(crate) const fn open(bytes: &'a [u8]) -> Option<Self> {
        let Some((header, arrays)) = bytes.split_first_chunk() else {
            return None;
        };
        let [
            signature0,
            signature1,
            options,
            index_length,
            data_length,
            index3_null_offset,
            data_null_offset,
            high_start,
        ] = u16_array(header);
        let [expected0, expected1] = u16_halves(SIGNATURE);
        let is_small = options & TYPE_SMALL != 0;
        let value_width = options & 0xff & !TYPE_SMALL;
        if signature0 == expected0
            && signature1 == expected1
            && value_width <= VALUE_BITS_8
            && let Some((index, data)) = arrays.split_at_checked(index_length as usize * 2)
        {
            Some(Self {
                index: Index(U16s::of(index)),
                data,
                data_length: ((options as usize & 0xf000) << 4) | data_length as usize,
                value_width,
                fast_limit: if is_small { SMALL_LIMIT } else { 0x1_0000 },
                index_1: if is_small {
                    SMALL_LIMIT >> FAST_SHIFT
                } else {
                    FAST_INDEX_1
                },
                high_start: (high_start as u32) << SHIFT_2,
                index3_null_offset: index3_null_offset as usize,
                data_null_offset: ((options as usize & 0xf00) << 8) | data_null_offset as usize,
            })
        } else {
            None
        }
    }

    fn get_value(&self, i: usize) -> u32 {
        match self.value_width {
            VALUE_BITS_16 => U16s::of(self.data).at(i).into(),
            VALUE_BITS_32 => U32s::of(self.data).at(i),
            _ => self.data.at(i).into(),
        }
    }

    fn high_value(&self) -> u32 {
        self.get_value(self.data_length.wrapping_sub(HIGH_VALUE_NEG_DATA_OFFSET))
    }

    /// Requires a code point.
    pub(crate) fn get(&self, c: u32) -> u32 {
        if c < self.fast_limit {
            self.get_value(self.index.bmp(c))
        } else if c >= self.high_start {
            self.high_value()
        } else {
            self.get_value(self.index.small(self.index_1, c))
        }
    }

    /// Returns the limit of the range of equal values from `start` on. ICU4C: ucptrie.cpp, getRange
    fn range_limit(&self, start: u32) -> u32 {
        if start >= self.high_start {
            return MAX_UNICODE + 1;
        }
        let value = self.get(start);
        let null_value = if self.data_null_offset < self.data_length {
            self.get_value(self.data_null_offset)
        } else {
            self.high_value()
        };
        let (mut prev_i3_block, mut prev_block) = (usize::MAX, usize::MAX);
        let mut c = start;
        while c < self.high_start {
            let (i3_block, i3_range, data_mask) = if c < self.fast_limit {
                let i3_range = c >> FAST_SHIFT..self.fast_limit >> FAST_SHIFT;
                (0, i3_range, FAST_DATA_MASK)
            } else {
                let i3_block = self.index.i3_block(self.index_1, c);
                if i3_block == prev_i3_block && c - start >= CP_PER_INDEX_2_ENTRY {
                    c += CP_PER_INDEX_2_ENTRY;
                    continue;
                }
                prev_i3_block = i3_block;
                if i3_block == self.index3_null_offset {
                    if null_value != value {
                        return c;
                    }
                    prev_block = self.data_null_offset;
                    c = (c | (CP_PER_INDEX_2_ENTRY - 1)) + 1;
                    continue;
                }
                let i3_range = (c >> SHIFT_3) & INDEX_3_MASK..INDEX_3_MASK + 1;
                (i3_block, i3_range, SMALL_DATA_MASK)
            };
            for i3 in i3_range {
                let block = self.index.data_block(i3_block, i3 as usize);
                let limit = (c | data_mask) + 1;
                if block == self.data_null_offset {
                    if null_value != value {
                        return c;
                    }
                } else if block != prev_block
                    && let Some(differs) = (c..limit)
                        .find(|c| self.get_value(block + (c & data_mask) as usize) != value)
                {
                    return differs;
                }
                // The values before `start` can differ.
                prev_block = if c & data_mask == 0 {
                    block
                } else {
                    usize::MAX
                };
                c = limit;
            }
        }
        if self.high_value() == value {
            MAX_UNICODE + 1
        } else {
            c
        }
    }

    /// Returns the first code point of each range of equal values.
    pub(crate) fn range_starts(&self) -> impl Iterator<Item = u32> {
        // In a damaged trie `get` and `range_limit` can disagree about `start`.
        std::iter::successors(Some(0), |&start| {
            Some(self.range_limit(start).max(start + 1)).filter(|&limit| limit <= MAX_UNICODE)
        })
    }
}
