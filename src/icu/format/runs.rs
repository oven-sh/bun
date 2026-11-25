//! Maps code points to 32-bit values that mostly rise in equal steps. It is read where it is.

use crate::words::{Slots, Words};
use core::ops::Range;

pub const BLOCK_SHIFT: u32 = 6;
const HALF: usize = 1 << (BLOCK_SHIFT - 1);

/// The number of segments, the segments, the offset of each block in words or 0 if it has no values, the blocks.
#[derive(Clone, Copy)]
pub struct Runs<'a> {
    segments: &'a [[u8; 2 * Segment::WORDS]],
    bytes: &'a [u8],
}

/// Consecutive blocks of code points.
#[derive(Clone, Copy)]
pub struct Segment {
    pub first_block: u16,
    pub blocks: u16,
    /// Where the offsets of its blocks are, in words.
    offsets: u16,
    /// What they count from, in units of `BASE_WORDS`.
    base: u16,
}

impl Segment {
    pub const WORDS: usize = 4;
    pub const BASE_WORDS: usize = 4;
}

/// A bit for each code point at which a run starts, the base, the parameters, then a field for each run, from the lowest bit on.
#[derive(Clone, Copy)]
pub struct Block<'a> {
    header: &'a [u8; Block::HEADER_SIZE],
    fields: &'a [u8],
}

impl<'a> Runs<'a> {
    /// `Block::PADDING` bytes follow the last field.
    pub fn new(bytes: &'a [u8]) -> Self {
        let all = bytes.get(2..).unwrap_or_default().as_chunks().0;
        let segments = all.get(..Words::of(bytes).index_at(0)).unwrap_or_default();
        Self { segments, bytes }
    }

    pub fn segments(self) -> impl Iterator<Item = Segment> {
        (self.segments.iter()).map(|&[a0, a1, b0, b1, c0, c1, d0, d1]| Segment {
            first_block: u16::from_le_bytes([a0, a1]),
            blocks: u16::from_le_bytes([b0, b1]),
            offsets: u16::from_le_bytes([c0, c1]),
            base: u16::from_le_bytes([d0, d1]),
        })
    }

    /// Returns the segment with `c`, and the index of the block in it.
    #[inline(always)]
    fn find(self, c: u32) -> Option<(Segment, usize)> {
        let index_in = |it: &Segment| (c >> BLOCK_SHIFT).wrapping_sub(it.first_block.into());
        let segment = self.segments().find(|it| index_in(it) < it.blocks.into())?;
        Some((segment, index_in(&segment) as usize))
    }

    /// Returns the block with `c`, unless it has no values.
    #[inline]
    pub fn block(self, c: u32) -> Option<Block<'a>> {
        let (segment, index) = self.find(c)?;
        let offset = Words::of(self.bytes).index_at(usize::from(segment.offsets) + index);
        let start = 2 * (Segment::BASE_WORDS * usize::from(segment.base) + offset);
        let (header, fields) = self.bytes.get(start..)?.split_first_chunk()?;
        (offset != 0).then_some(Block { header, fields })
    }

    /// Returns the code points around `c` whose blocks are the same.
    pub fn with_block_of(self, c: u32) -> Option<Range<u32>> {
        let (segment, index) = self.find(c)?;
        let offset = |i: usize| Words::of(self.bytes).at(usize::from(segment.offsets) + i);
        let is_same = |&i: &usize| offset(i) == offset(index);
        let before = (0..index).rev().take_while(is_same).count();
        let from_here = (index..segment.blocks.into()).take_while(is_same).count();
        let first_of = |i: usize| (u32::from(segment.first_block) + i as u32) << BLOCK_SHIFT;
        Some(first_of(index - before)..first_of(index + from_here))
    }
}

impl Block<'_> {
    pub const HEADER_SIZE: usize = 14;
    /// What is read of the fields of half a block, which have at most 32 bits.
    pub const PADDING: usize = 4 * HALF + 8;
    pub const WIDTH_BITS: u32 = 6;
    pub const SHIFT_BITS: u32 = 5;
    pub const STEP_BITS: u32 = 4;
    /// Only the first code point of a run has a value.
    pub const IS_SPARSE: u16 = 1 << 15;
    /// The field of a run without values.
    pub const ABSENT: u32 = 0;

    #[inline(always)]
    fn read_header(self) -> Header {
        let [starts @ .., b0, b1, b2, b3, p0, p1] = *self.header;
        let parameters = u32::from(u16::from_le_bytes([p0, p1]));
        let shift = (parameters >> Self::WIDTH_BITS) % (1 << Self::SHIFT_BITS);
        let step = (parameters >> (Self::WIDTH_BITS + Self::SHIFT_BITS)) % (1 << Self::STEP_BITS);
        Header {
            starts: u64::from_le_bytes(starts),
            base: u32::from_le_bytes([b0, b1, b2, b3]),
            width: parameters % (1 << Self::WIDTH_BITS),
            scale: 1 << shift,
            step: step << shift,
            is_sparse: parameters & u32::from(Self::IS_SPARSE) != 0,
        }
    }

    #[inline(always)]
    fn field(self, header: &Header, run: u32) -> u32 {
        let bit = run * header.width;
        let bytes = (self.fields.get((bit / 8) as usize..)).and_then(|it| it.first_chunk());
        let bits = bytes.map_or(0, |&it| u64::from_le_bytes(it));
        (bits >> (bit % 8) & ((1 << header.width) - 1)) as u32
    }

    /// Returns whether all code points have the same value.
    #[inline(always)]
    pub fn is_uniform(self) -> bool {
        let header = self.read_header();
        header.starts == 1 && header.step == 0 && !header.is_sparse
    }

    pub fn get(self, c: u32) -> Option<u32> {
        let (header, index) = (self.read_header(), c % (1 << BLOCK_SHIFT));
        let starts_so_far = header.starts << (63 - index);
        if header.is_sparse && starts_so_far >> 63 == 0 {
            return None;
        }
        let field = self.field(&header, starts_so_far.count_ones() - 1);
        (field != Self::ABSENT).then_some(header.value(field, index))
    }

    /// Calls `put(i, value - bias)` once for each code point of the half of the block that has `c`.
    #[inline]
    pub fn expand_half(self, c: u32, absent: u32, bias: u32, mut put: impl FnMut(usize, u32)) {
        let (mut header, first) = (self.read_header(), c & HALF as u32);
        header.base = header.base.wrapping_sub(bias);
        let absent = absent.wrapping_sub(bias);
        let mut starts = (header.starts >> first) as u32;
        let continues = !header.is_sparse && starts % 2 == 0;
        let first_run = (header.starts & ((1 << first) - 1)).count_ones() - u32::from(continues);
        let first_bit = first_run * header.width;
        let fields = (self.fields.get((first_bit / 8) as usize..)).and_then(|it| it.first_chunk());
        let Some::<&[_; Block::PADDING]>(fields) = fields else {
            return;
        };
        let mask = ((1u64 << header.width) - 1) as u32;
        let bits_at = |byte: u32| {
            let bytes = fields.get(byte as usize % (4 * HALF)..);
            (bytes.and_then(|it| it.first_chunk())).map_or(0, |&it| u64::from_le_bytes(it))
        };
        if starts == u32::MAX && header.width % 8 == 0 {
            for i in 0..HALF as u32 {
                let value = match bits_at(i * (header.width / 8)) as u32 & mask {
                    Self::ABSENT => absent,
                    field => header.value(field, first + i),
                };
                put(i as usize, value);
            }
            return;
        }
        let (mut bit, shift) = (first_bit % 8, header.scale.trailing_zeros());
        let mut next_scaled_field = || {
            let bits = bits_at(bit / 8).rotate_right((bit % 8).wrapping_sub(shift));
            bit += header.width;
            bits as u32 & mask << shift
        };
        if header.is_sparse {
            if starts == 0 {
                return (0..HALF).for_each(|i| put(i, absent));
            }
            let mut values = [absent; HALF];
            loop {
                let i = starts.trailing_zeros();
                let value = header.value(0, first + i);
                values.put(i as usize, value.wrapping_add(next_scaled_field()));
                starts &= starts - 1;
                if starts == 0 {
                    return (values.iter().enumerate()).for_each(|(i, &value)| put(i, value));
                }
            }
        }
        let (mut differences, mut absent_bits) = ([header.step; HALF], 0);
        let mut last = 0;
        starts |= 1;
        while starts != 0 {
            let (i, field) = (starts.trailing_zeros(), next_scaled_field());
            starts &= starts - 1;
            if field == Self::ABSENT {
                absent_bits |= starts.isolate_lowest_one().wrapping_sub(1 << i);
            }
            let difference = field.wrapping_sub(last);
            differences.put(i as usize, difference.wrapping_add(header.step));
            last = field;
        }
        let mut value = header.value(0, first.wrapping_sub(1));
        let values = differences.iter().enumerate().map(|(i, &difference)| {
            value = value.wrapping_add(difference);
            (i, value)
        });
        let or_absent = |i, value| match absent_bits >> i & 1 {
            0 => value,
            _ => absent,
        };
        match absent_bits {
            0 => values.for_each(|(i, value)| put(i, value)),
            _ => values.for_each(|(i, value)| put(i, or_absent(i, value))),
        }
    }
}

struct Header {
    starts: u64,
    base: u32,
    width: u32,
    scale: u32,
    step: u32,
    is_sparse: bool,
}

impl Header {
    #[inline(always)]
    fn value(&self, field: u32, index: u32) -> u32 {
        (self.base.wrapping_add(field.wrapping_mul(self.scale)))
            .wrapping_add(self.step.wrapping_mul(index))
    }
}
