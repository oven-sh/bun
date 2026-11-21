//! Reader of a serialized code point trie of type `UCPTRIE_TYPE_FAST`. ICU4C: ucptrie.h, ucptrie.cpp, ucptrie_impl.h

use crate::common::bytes::{U16s, View, Word, u16_array, u16_halves};
use crate::common::slice_ext::{SliceExt, SoftUnwrap};
use crate::common::utf16;

const SIGNATURE: u32 = 0x5472_6933; // "Tri3"
const VALUE_BITS_16: u16 = 0;
const VALUE_BITS_8: u16 = 2;
const FAST_SHIFT: u32 = 6;
const FAST_DATA_MASK: u32 = (1 << FAST_SHIFT) - 1;
const ERROR_VALUE_NEG_DATA_OFFSET: usize = 1;
const HIGH_VALUE_NEG_DATA_OFFSET: usize = 2;
const SHIFT_3: u32 = 4;
const SHIFT_2: u32 = 5 + SHIFT_3;
const SHIFT_1: u32 = 5 + SHIFT_2;
/// Where the index-1 entry of U+0000 would be. Those of the BMP are omitted.
const INDEX_1_OFFSET: u32 = (0x10000 >> FAST_SHIFT) - (0x10000 >> SHIFT_1);
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

    // ICU4C: ucptrie.cpp, ucptrie_internalSmallIndex
    fn supplementary(&self, c: u32) -> usize {
        let i2_block = self.entry(((c >> SHIFT_1) + INDEX_1_OFFSET) as usize);
        let i3_block = self.entry(i2_block + ((c >> SHIFT_2) & INDEX_2_MASK) as usize);
        let i3 = ((c >> SHIFT_3) & INDEX_3_MASK) as usize;
        let data_block = if i3_block & 0x8000 == 0 {
            self.entry(i3_block + i3)
        } else {
            // 18-bit offsets: each group of 8 entries is preceded by one entry that holds their upper 2 bits.
            let (group, i3) = ((i3_block & 0x7fff) + (i3 & !7) + (i3 >> 3), i3 & 7);
            ((self.entry(group) << (2 + 2 * i3)) & 0x30000) | self.entry(group + 1 + i3)
        };
        data_block + (c & SMALL_DATA_MASK) as usize
    }
}

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
        } else if c > 0x10_ffff {
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
