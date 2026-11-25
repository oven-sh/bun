//! Collation data. The root and all tailorings share one pool. Their tries are filled in as they are read.

use crate::runs::{self, Runs};
use crate::words::{Slots, Words, take_bytes, take_number};
use core::ops::Range;
use core::sync::atomic::Ordering::Relaxed;
use core::sync::atomic::{AtomicU16, AtomicU32};

pub const DATA_FORMAT: [u8; 4] = *b"BCol";

/// In a trie: the CE32 is in the runs.
pub const LAZY_CE32: u32 = 0xc3;
/// Two CEs: the index in the pool of the second one and of the first one.
pub const PAIR_LOW_BYTE: u8 = 0xc7;
pub const PAIR_INDEX_BITS: u32 = 12;
/// The CEs of a syllable: the secondary weight of the last one less `HANJA_MIN_SECONDARY`, the index of the syllable in the pool.
pub const HANJA_LOW_BYTE: u8 = 0xd7;
pub const HANJA_INDEX_BITS: u32 = 10;
pub const HANJA_MIN_SECONDARY: u32 = 0x4000;

/// `primary` is a weight of two bytes, or 0 for a character that is not tailored.
#[inline(always)]
pub fn ce32_of_primary(primary: u16) -> u32 {
    match primary {
        0 => 0xc0,
        _ => u32::from(primary) << 16 | 0x0505,
    }
}

/// The root is the first.
pub const MAX_TRIES: usize = 128;

/// The item after its header: the options, the end of each part, the parts.
#[derive(Clone, Copy)]
pub struct Root<'a> {
    pub options: u32,
    pub scripts: &'a [u8],
    pub fast_latin: &'a [u8],
    /// The start of the values of all tries.
    pub shared_values: &'a [u8],
    /// It is read as CEs, as CE32s and as contexts.
    pub pool: &'a [u8],
    mappings: &'a [u8],
}

impl<'a> Root<'a> {
    pub const PARTS: usize = 5;

    pub fn new(bytes: &'a [u8]) -> Self {
        let fields = bytes.as_chunks().0;
        let field = |i: usize| u32::from_le_bytes(fields.at(i));
        let mut start = 4 * (1 + Self::PARTS);
        let parts: [_; Root::PARTS] = core::array::from_fn(|i| {
            let end = field(1 + i) as usize;
            (bytes.get(core::mem::replace(&mut start, end)..end)).unwrap_or_default()
        });
        let [scripts, fast_latin, shared_values, mappings, pool] = parts;
        Self {
            options: field(0),
            scripts,
            fast_latin,
            shared_values,
            pool,
            mappings,
        }
    }

    pub fn mappings(&self) -> Mappings<'a> {
        Mappings::new(self.mappings, self.pool)
    }
}

/// The tries are like `UTrie2`. They have their values in one array, and their supplementary indexes in another.
pub mod trie {
    use core::ops::Range;

    pub const BLOCK_SHIFT: u32 = 5;
    pub const BLOCK_LENGTH: usize = 1 << BLOCK_SHIFT;
    /// An entry of an index is the offset of a block in units of this.
    pub const GRANULARITY: usize = 4;
    /// For code units, and then for the code points of lead surrogates.
    pub const BMP_INDEX_LENGTH: usize = 0x820;
    pub const INDEX_1_SHIFT: u32 = 11;
    pub const INDEX_2_BLOCK_LENGTH: usize = 1 << (INDEX_1_SHIFT - BLOCK_SHIFT);

    pub const INDEX_2_LENGTH: usize = 0x4000;
    /// The entries from here on lead to `Mappings::primaries`.
    pub const VALUES: usize = (1 << 18) - (UNIFIED_HAN.end - UNIFIED_HAN.start);
    /// The rest is kept for the layers of the tailorings.
    pub const LAZY_LIMIT: usize = VALUES - 0xf000;

    /// An entry that is still 0 leads to it.
    pub const LAZY_BLOCK: usize = 0;
    /// With and without special Jamo. Fallback values follow both.
    pub const HANGUL_BLOCKS: [usize; 2] = [0x20, 0x60];
    pub const FALLBACK_BLOCK: usize = 0x40;
    pub const UNASSIGNED_BLOCK: usize = 0xa0;
    pub const LEAD_BLOCK: usize = 0xc0;
    pub const ASCII_BLOCKS: usize = 0xe0;
    pub const LATIN_1_BLOCKS: usize = 0x160;
    /// The blocks of all tries end here, with the number of values that are in use.
    pub const USED: usize = 0x1a0;

    pub const ASCII: Range<usize> = 0..0x80;
    pub const LATIN_1: Range<usize> = 0xc0..0x100;
    pub const UNIFIED_HAN: Range<usize> = 0x4e00..0xa000;
    pub const HANGUL: Range<usize> = 0xac00..0xd7a4;
    pub const LEADS: Range<usize> = 0xd800..0xdc00;
}

/// `%%CollationBin` has these fields in this order, as numbers unless they are slices.
pub struct Tailoring<'a> {
    pub options: u32,
    /// The count, then 32 bits each.
    pub reorder_codes: &'a [u8],
    /// `None` if nothing follows.
    pub mappings: Option<Mappings<'a>>,
}

pub struct Mappings<'a> {
    /// Below `MAX_TRIES`.
    pub number: usize,
    /// The number of values in the blocks that the layers change.
    pub values: usize,
    /// The index of the CE32s of the Jamo, or 0.
    pub jamo: usize,
    hangul_block: usize,
    /// The offset in the pool and the length, as for each of the layers. The root adds nothing to collunsafe.h.
    pub unsafe_backward: &'a [u8],
    fast_latin: &'a [u8],
    /// The length of these numbers in bytes, and the numbers.
    layers: &'a [u8],
    /// The count, then 16 bits each.
    pub index_1: &'a [u8],
    /// The count, then what `ce32_of_primary` takes for each of `UNIFIED_HAN`. The runs come first.
    pub primaries: &'a [u8],
    /// The rest.
    pub runs: Runs<'a>,
}

fn take_part<'a>(numbers: &mut &[u8], pool: &'a [u8]) -> &'a [u8] {
    let (start, length) = (take_number(numbers), take_number(numbers));
    pool.get(start..start + length).unwrap_or_default()
}

fn take_counted<'a>(bytes: &mut &'a [u8], size: usize) -> &'a [u8] {
    let count = take_number(bytes);
    take_bytes(bytes, size * count)
}

impl<'a> Tailoring<'a> {
    pub fn new(mut bytes: &'a [u8], root: &Root<'a>) -> Self {
        Self {
            options: take_number(&mut bytes) as u32,
            reorder_codes: take_counted(&mut bytes, 4),
            mappings: (!bytes.is_empty()).then(|| Mappings::new(bytes, root.pool)),
        }
    }
}

/// A trie that no other thread reads yet.
struct Trie<'u> {
    index: &'u mut [AtomicU16],
    values: &'u [AtomicU32],
    next_block: usize,
}

impl Trie<'_> {
    /// Each block of `units` is `step` values after the one before.
    fn point(&mut self, units: Range<usize>, first_block: usize, step: usize) {
        let entries = units.start >> trie::BLOCK_SHIFT..units.end >> trie::BLOCK_SHIFT;
        let entries = self.index.get_mut(entries).unwrap_or_default();
        for (i, entry) in entries.iter_mut().enumerate() {
            *entry.get_mut() = ((first_block + step * i) / trie::GRANULARITY) as u16;
        }
    }

    fn block_of(&mut self, unit: usize) -> usize {
        let entry = self.index.get_mut(unit >> trie::BLOCK_SHIFT);
        entry.map_or(0, |it| usize::from(*it.get_mut()) * trie::GRANULARITY)
    }

    /// `unit` is a UTF-16 code unit.
    fn set(&mut self, unit: usize, value: u32) -> Option<()> {
        use trie::*;
        if self.block_of(unit) < USED {
            let length = if unit < ASCII.end {
                ASCII.end
            } else {
                BLOCK_LENGTH
            };
            let first = unit & !(length - 1);
            let shared = self.values.get(self.block_of(first)..)?.iter().take(length);
            let own = self.values.get(self.next_block..)?;
            (own.iter().zip(shared)).for_each(|(own, it)| own.store(it.load(Relaxed), Relaxed));
            self.point(first..first + length, self.next_block, BLOCK_LENGTH);
            self.next_block += length;
        }
        let at = self.block_of(unit) + unit % BLOCK_LENGTH;
        self.values.get(at).map(|it| it.store(value, Relaxed))
    }

    /// A byte with the distance less one and a bit for each byte of the value that changes, more distance, these bytes.
    fn apply(&mut self, mut layer: &[u8]) {
        let (mut next, mut value) = (0, [0; 4]);
        while let Some((&head, rest)) = layer.split_first() {
            layer = rest;
            next += usize::from(head >> 4);
            if head >> 4 == 0xf {
                next += take_number(&mut layer);
            }
            for (i, byte) in value.iter_mut().enumerate() {
                if head >> i & 1 != 0 {
                    *byte = take_bytes(&mut layer, 1).at(0);
                }
            }
            self.set(next, u32::from_le_bytes(value));
            next += 1;
        }
    }
}

/// How the table for fast Latin comparisons differs from that of the root.
pub mod fast_latin {
    pub const MIN_SHORT: u16 = 0x1000;
    /// The shift and the number of bits of the primary and of the secondary weight.
    pub const WEIGHTS: [(u32, u32); 2] = [(10, 6), (5, 5)];
}

impl<'a> Mappings<'a> {
    fn new(mut bytes: &'a [u8], pool: &'a [u8]) -> Self {
        let bytes = &mut bytes;
        Self {
            number: take_number(bytes),
            values: take_number(bytes),
            jamo: take_number(bytes),
            hangul_block: take_number(bytes),
            unsafe_backward: take_part(bytes, pool),
            fast_latin: take_part(bytes, pool),
            layers: take_counted(bytes, 1),
            index_1: take_counted(bytes, 2),
            primaries: take_counted(bytes, 2),
            runs: Runs::new(bytes),
        }
    }

    /// The block of the code points without mappings.
    pub fn null_block(&self) -> usize {
        match self.number {
            0 => trie::UNASSIGNED_BLOCK,
            _ => trie::FALLBACK_BLOCK,
        }
    }

    /// Writes the index for the BMP, and `self.values` values from `first_block` on.
    pub fn expand_trie(
        &self,
        root: &Root,
        index: &mut [AtomicU16],
        values: &[AtomicU32],
        first_block: usize,
    ) {
        use trie::*;
        let mut trie = Trie {
            index,
            values,
            next_block: first_block,
        };
        trie.point(0..BMP_INDEX_LENGTH << BLOCK_SHIFT, self.null_block(), 0);
        trie.point(LEADS, LEAD_BLOCK, 0);
        let last_syllables = HANGUL.end % BLOCK_LENGTH;
        let last_block = self.hangul_block + BLOCK_LENGTH - last_syllables;
        trie.point(HANGUL.end..HANGUL.end + BLOCK_LENGTH, last_block, 0);
        if !self.primaries.is_empty() {
            trie.point(UNIFIED_HAN, VALUES, BLOCK_LENGTH);
        }
        for segment in self.runs.segments() {
            let [first, count] = [segment.first_block, segment.blocks]
                .map(|it| usize::from(it) << runs::BLOCK_SHIFT);
            if first < 0x10000 {
                trie.point(first..first + count, LAZY_BLOCK, 0);
            }
        }
        trie.point(ASCII, ASCII_BLOCKS, BLOCK_LENGTH);
        trie.point(LATIN_1, LATIN_1_BLOCKS, BLOCK_LENGTH);
        trie.point(HANGUL, self.hangul_block, 0);
        let mut layers = self.layers;
        while !layers.is_empty() {
            trie.apply(take_part(&mut layers, root.pool));
        }
    }

    /// 0 if the table is that of the root.
    pub fn fast_latin_units(&self) -> usize {
        take_number(&mut { self.fast_latin })
    }

    /// The length, for each kind of weight where the offset changes, single units that differ, and the end of the table.
    pub fn expand_fast_latin(&self, root: &Root, table: &mut [[u8; 2]]) {
        let (changes, root) = (&mut { self.fast_latin }, Words::of(root.fast_latin));
        take_number(changes);
        let [primaries, secondaries] = fast_latin::WEIGHTS.map(|(shift, _)| {
            let (mut weights, mut offset) = ([0u16; 64], 0u8);
            let mut steps = take_counted(changes, 2).as_chunks().0.iter().peekable();
            for (old, new) in (0..).zip(&mut weights) {
                offset = (steps.next_if(|&&[from, _]| from == old)).map_or(offset, |&[_, it]| it);
                *new = u16::from(old.wrapping_add(offset)) << shift;
            }
            weights
        });
        for (i, unit) in table.iter_mut().enumerate() {
            *unit = u16::to_le_bytes(match root.at(i) {
                other @ ..fast_latin::MIN_SHORT => other,
                ce => {
                    let (primary, secondary) = (ce >> 10, ce >> 5 & 31);
                    primaries.at(primary.into()) | secondaries.at(secondary.into()) | ce & 31
                }
            });
        }
        let mut at = 0;
        for &[distance, low, high] in take_counted(changes, 3).as_chunks().0 {
            at += usize::from(distance);
            table.put(at, [low, high]);
        }
        let end = changes.as_chunks().0.iter().rev();
        (table.iter_mut().rev().zip(end)).for_each(|(unit, &own)| *unit = own);
    }
}
