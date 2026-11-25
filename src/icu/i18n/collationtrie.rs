//! Maps code points to CE32s. ICU4C: utrie2.h

use crate::common::bytes::U16s;
use crate::common::slice_ext::{SliceExt, SoftUnwrap};
use crate::common::soft_assert;
use crate::common::umutex::LoadOnly;
use crate::common::utrie2::{UTrie2, UTrie2ValueBits};
use crate::i18n::collation::FALLBACK_CE32;
use bun_icu_format::collation::trie::*;
use bun_icu_format::collation::{LAZY_CE32, Mappings, Root, SparsePrimaries, ce32_of_primary};
use bun_icu_format::runs::{Block, Runs};
use std::ops::Range;
use std::sync::OnceLock;
use std::sync::atomic::Ordering::{Relaxed, Release};
use std::sync::atomic::{AtomicU16, AtomicU32};

pub(crate) type BmpIndex = [AtomicU16; BMP_INDEX_LENGTH];

static PACKED_VALUES: [AtomicU32; VALUES] = [const { AtomicU32::new(0) }; _];
static PACKED_INDEX_2: [AtomicU16; INDEX_2_LENGTH] = [const { AtomicU16::new(0) }; _];

/// A `UTrie2` in a file, or a trie in which `LAZY_CE32` stands for what has not been read yet.
pub(crate) struct CollationTrie {
    index: &'static [LoadOnly<AtomicU16>; BMP_INDEX_LENGTH],
    values: &'static [LoadOnly<AtomicU32>],
    /// To be added to each of `values`.
    bias: u32,
    /// Their indexes start after those of `values`.
    primaries: U16s<'static>,
    ascii: &'static [LoadOnly<AtomicU32>; ASCII.end],
    /// From U+10000 on.
    index_1: U16s<'static>,
    index_2: &'static [LoadOnly<AtomicU16>],
    /// Its entries start after those of `index_2`.
    sparse: SparsePrimaries<'static>,
    high_start: u32,
    high_value: u32,
    packed: Option<Packed>,
}

/// Perf: the CE of a `Primary` takes fewer steps than that of its CE32.
pub(crate) enum Mapping {
    Ce32(u32),
    /// The first two bytes. The other weights are common.
    Primary(u32),
}

#[derive(Clone, Copy)]
struct Packed {
    index: &'static BmpIndex,
    null_entry: u16,
    runs: Runs<'static>,
}

/// Returns the first of `count` values that no trie uses.
fn allocate(count: usize, limit: usize) -> Option<usize> {
    let more = |used: u32| Some(used + count as u32).filter(|&end| end as usize <= limit);
    let used = PACKED_VALUES.get(USED)?.try_update(Relaxed, Relaxed, more);
    used.ok().map(|it| it as usize)
}

/// Returns the entry of a new block with the values around `c`. Each is written once, so other threads read it or `LAZY_CE32`.
fn new_entry(block: Block, c: u32, absent: u32) -> Option<u16> {
    let at = allocate(BLOCK_LENGTH, LAZY_LIMIT)?;
    let values: &[_; BLOCK_LENGTH] = PACKED_VALUES.get(at..)?.first_chunk()?;
    block.expand_half(c, absent, LAZY_CE32, |i, value| {
        if let Some(slot) = values.get(i) {
            slot.store(value, Relaxed);
        }
    });
    Some((at / GRANULARITY) as u16)
}

/// There is room for one call for each trie.
pub(crate) fn expand(mappings: &Mappings, root: &Root, index: &mut BmpIndex) {
    static SHARED: OnceLock<()> = OnceLock::new();
    SHARED.get_or_init(|| {
        for (value, &shared) in PACKED_VALUES.iter().zip(root.shared_values.as_chunks().0) {
            value.store(u32::from_le_bytes(shared), Relaxed);
        }
    });
    let first_block = allocate(mappings.values, VALUES).soft_unwrap();
    mappings.expand_trie(root, index, &PACKED_VALUES, first_block);
}

const LEAD_CODE_POINTS_OFFSET: usize = 0x10000 - LEADS.start;

impl CollationTrie {
    /// Returns `None` if `bytes` is not aligned, too.
    pub(crate) fn open_from_serialized(bytes: &'static [u8]) -> Option<Self> {
        let trie = UTrie2::open_from_serialized(UTrie2ValueBits::Bits32, bytes)?;
        let index = LoadOnly::<AtomicU16>::slice_in(trie.index.as_bytes())?;
        let values = LoadOnly::<AtomicU32>::slice_in(trie.data32.as_bytes())?;
        Some(Self {
            index: index.first_chunk()?,
            values,
            bias: 0,
            primaries: U16s::EMPTY,
            ascii: values.first_chunk()?,
            index_1: trie.index_1(),
            index_2: index,
            sparse: SparsePrimaries::default(),
            high_start: trie.high_start,
            high_value: trie.data32.at(trie.high_value_index),
            packed: None,
        })
    }

    /// `index` has been expanded.
    pub(crate) fn open_packed(
        mappings: &Mappings<'static>,
        index: &'static BmpIndex,
    ) -> Option<Self> {
        let (values, index_1) = (
            LoadOnly::slice_of(&PACKED_VALUES),
            U16s::of(mappings.index_1),
        );
        let ascii = usize::from(index.first()?.load(Relaxed)) * GRANULARITY;
        Some(Self {
            index: LoadOnly::slice_of(index).first_chunk()?,
            values,
            bias: LAZY_CE32,
            primaries: U16s::of(mappings.primaries),
            ascii: values.get(ascii..)?.first_chunk()?,
            index_1,
            index_2: LoadOnly::slice_of(&PACKED_INDEX_2),
            sparse: mappings.sparse,
            high_start: 0x10000 + ((index_1.len() as u32) << INDEX_1_SHIFT),
            high_value: (values.get(mappings.null_block())?.load()).wrapping_add(LAZY_CE32),
            packed: Some(Packed {
                index,
                null_entry: (mappings.null_block() / GRANULARITY) as u16,
                runs: mappings.runs,
            }),
        })
    }

    pub(crate) fn is_packed(&self) -> bool {
        self.packed.is_some()
    }

    #[inline(always)]
    fn mapping(&self, entry: u16, c: u32) -> Mapping {
        let index = usize::from(entry) * GRANULARITY + c as usize % BLOCK_LENGTH;
        if let Some(value) = self.values.get(index) {
            return Mapping::Ce32(value.load().wrapping_add(self.bias));
        }
        match self.primaries.get(index - self.values.len()).soft_some() {
            Some(0) => Mapping::Ce32(FALLBACK_CE32),
            Some(primary) => Mapping::Primary(primary.into()),
            None => Mapping::Ce32(0),
        }
    }

    #[inline(always)]
    fn value(&self, entry: u16, c: u32) -> u32 {
        match self.mapping(entry, c) {
            Mapping::Ce32(ce32) => ce32,
            Mapping::Primary(primary) => ce32_of_primary(primary as u16),
        }
    }

    /// `c` is a code unit, or the code point of a lead surrogate plus `LEAD_CODE_POINTS_OFFSET`.
    #[inline(always)]
    fn bmp_entry(&self, c: usize) -> u16 {
        (self.index.get(c >> BLOCK_SHIFT).map(|it| it.load())).soft_unwrap()
    }

    /// `c` is supplementary and below `high_start`.
    #[inline(always)]
    fn index_2_of(&self, c: u32) -> usize {
        let block = self.index_1.at(((c - 0x10000) >> INDEX_1_SHIFT) as usize);
        usize::from(block) + (c >> BLOCK_SHIFT) as usize % INDEX_2_BLOCK_LENGTH
    }

    /// The error is the entry for `sparse`.
    #[inline(always)]
    fn supplementary_entry(&self, c: u32) -> Result<u16, usize> {
        let index = self.index_2_of(c);
        (self.index_2.get(index).map(|it| it.load())).ok_or_else(|| index - self.index_2.len())
    }

    #[inline(always)]
    fn entry_of_bmp_code_point(&self, c: u32) -> u16 {
        let is_lead = LEADS.contains(&(c as usize));
        self.bmp_entry(c as usize + if is_lead { LEAD_CODE_POINTS_OFFSET } else { 0 })
    }

    #[inline(always)]
    pub(crate) fn get(&self, c: u32) -> u32 {
        if c < 0xd800 {
            self.get_from_u16_single_lead(c as u16)
        } else if c <= 0xffff {
            self.value(self.entry_of_bmp_code_point(c), c)
        } else {
            self.get_from_supp(c)
        }
    }

    #[inline(always)]
    pub(crate) fn get_from_supp(&self, c: u32) -> u32 {
        if c >= self.high_start {
            return self.high_value;
        }
        match self.supplementary_entry(c) {
            Ok(entry) => self.value(entry, c),
            Err(entry) => {
                soft_assert!(self.is_packed());
                ce32_of_primary(self.sparse.get(entry, c))
            }
        }
    }

    #[inline(always)]
    pub(crate) fn get_from_u16_single_lead(&self, c: u16) -> u32 {
        self.value(self.bmp_entry(c.into()), c.into())
    }

    #[inline(always)]
    pub(crate) fn mapping_of_u16_single_lead(&self, c: u16) -> Mapping {
        self.mapping(self.bmp_entry(c.into()), c.into())
    }

    #[inline(always)]
    pub(crate) fn get_from_ascii(&self, c: u8) -> u32 {
        let value = self.ascii.get(usize::from(c & 0x7f)).map(|it| it.load());
        value.soft_unwrap().wrapping_add(self.bias)
    }

    /// Returns what `LAZY_CE32` stands for, and remembers the block if there is room. `c` is a code unit or supplementary.
    #[cold]
    #[inline(never)]
    pub(crate) fn fill(&self, c: u32) -> Option<u32> {
        let packed = self.packed.as_ref()?;
        let entry = match c {
            ..0x10000 => packed.index.get((c >> BLOCK_SHIFT) as usize),
            _ => PACKED_INDEX_2.get(self.index_2_of(c)),
        }?;
        let Some(block) = packed.runs.block(c) else {
            entry.store(packed.null_entry, Relaxed);
            return Some(self.high_value);
        };
        let Some(new) = new_entry(block, c, self.high_value) else {
            return Some(block.get(c).unwrap_or(self.high_value));
        };
        entry.store(new, Release);
        if block.is_uniform() && c >= 0x10000 {
            self.share(new, packed.runs.with_block_of(c)?);
        }
        Some(self.value(new, c))
    }

    /// The entries of consecutive blocks with values are consecutive.
    #[cold]
    fn share(&self, entry: u16, supplementary: Range<u32>) {
        let entries = PACKED_INDEX_2.slice(self.index_2_of(supplementary.start)..);
        let entries = entries.iter().take(supplementary.len() / BLOCK_LENGTH);
        entries.for_each(|it| it.store(entry, Release));
    }

    /// Like `get`, but never `LAZY_CE32` unless a file has it. It remembers nothing.
    pub(crate) fn peek(&self, c: u32) -> u32 {
        match (self.get(c), self.packed) {
            (LAZY_CE32, Some(packed)) => {
                (packed.runs.block(c).and_then(|it| it.get(c))).unwrap_or(self.high_value)
            }
            (ce32, _) => ce32,
        }
    }

    /// Calls `handle((start, end), ce32)` for each range of equal CE32s until it fails.
    pub(crate) fn try_for_each_range<E>(
        &self,
        mut handle: impl FnMut((u32, u32), u32) -> Result<(), E>,
    ) -> Result<(), E> {
        const LIMIT: u32 = 0x11_0000;
        let high_start = self.high_start.clamp(0x10000, LIMIT);
        let (mut start, mut ce32, mut last_entry) = (0, self.peek(0), None);
        for first in (0..high_start).step_by(BLOCK_LENGTH) {
            let is_in_runs = (self.packed).is_some_and(|it| it.runs.block(first).is_some());
            let entry = match first {
                _ if is_in_runs => None,
                ..0x10000 => Some(self.entry_of_bmp_code_point(first)),
                _ => self.supplementary_entry(first).ok(),
            };
            let is_repeated = entry.is_some() && entry == last_entry;
            if is_repeated && first - start >= BLOCK_LENGTH as u32 {
                continue;
            }
            last_entry = entry;
            for c in first..first + BLOCK_LENGTH as u32 {
                let next = self.peek(c);
                if next != ce32 {
                    handle((start, c - 1), ce32)?;
                    (start, ce32) = (c, next);
                }
            }
        }
        if high_start < LIMIT && self.high_value != ce32 {
            handle((start, high_start - 1), ce32)?;
            (start, ce32) = (high_start, self.high_value);
        }
        handle((start, LIMIT - 1), ce32)
    }
}
