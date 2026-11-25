//! Compiled break rules, the `.brk` items. ICU4C: rbbidata.h, rbbidata.cpp

use crate::common::bytes::{I32s, U16s, U32s};
use crate::common::slice_ext::to_index;
use crate::common::ucptrie::{FastTrie8, FastTrie16};
use crate::common::udata::UDataMemory;

const RBBI_DATA_FORMAT: u8 = 7;

// Indexes of the 32-bit fields of `RBBIDataHeader`. The length of a section follows its offset.
const MAGIC: usize = 0;
const FORWARD_TABLE: usize = 4;
const REVERSE_TABLE: usize = 6;
const TRIE: usize = 8;
const STATUS_TABLE: usize = 12;
const HEADER_LENGTH: usize = 20;

// Indexes of the 32-bit fields of `RBBIStateTable`.
const ROW_LENGTH: usize = 1;
const DICT_CATEGORIES_START: usize = 2;
const LOOK_AHEAD_RESULTS_SIZE: usize = 3;
const FLAGS: usize = 4;
const TABLE_DATA: usize = 5;

const RBBI_8BITS_ROWS: u32 = 4;
/// A row has the fields `fAccepting`, `fLookAhead` and `fTagsIdx`, then the next state for each category.
const ROW_NEXT_STATE: usize = 3;

pub(crate) const START_STATE: usize = 1;
pub(crate) const STOP_STATE: usize = 0;

/// Greater values of `accepting` and `look_ahead` are numbers of look-ahead rules.
pub(crate) const ACCEPTING_UNCONDITIONAL: usize = 1;

#[derive(Clone, Copy)]
pub(crate) struct RBBIStateTable {
    row_length: u32,
    has_8_bits: bool,
    /// Extends to the end of the item.
    rows: &'static [u8],
}

#[derive(Default)]
pub(crate) struct Row {
    pub(crate) state: usize,
    /// `row_offset(state)`
    pub(crate) offset: usize,
    pub(crate) accepting: usize,
    pub(crate) look_ahead: usize,
    pub(crate) tags_index: u16,
}

impl RBBIStateTable {
    fn read(table: &'static [u8]) -> Option<Self> {
        let header = U32s::of(table);
        Some(Self {
            row_length: header.get(ROW_LENGTH)?,
            has_8_bits: header.get(FLAGS)? & RBBI_8BITS_ROWS != 0,
            rows: table.get(TABLE_DATA * 4..)?,
        })
    }

    #[inline(always)]
    pub(crate) fn row_offset(&self, state: usize) -> usize {
        self.row_length.wrapping_mul(state as u32) as usize
    }

    /// Returns the target of the transition for `category` in the row at offset `row`, or the stop state if out of bounds.
    #[inline(always)]
    pub(crate) fn next_state(&self, row: usize, category: usize, is_simple: bool) -> usize {
        let field = ROW_NEXT_STATE + category;
        let state = if is_simple || self.has_8_bits {
            self.rows.get(row + field).copied().map(usize::from)
        } else {
            (self.rows.get(row..)).and_then(|row| U16s::of(row).get(field).map(usize::from))
        };
        state.unwrap_or(STOP_STATE)
    }

    #[inline(always)]
    pub(crate) fn row(&self, state: usize, is_simple: bool) -> Row {
        let offset = self.row_offset(state);
        let row = |accepting, look_ahead, tags_index| Row {
            state,
            offset,
            accepting,
            look_ahead,
            tags_index,
        };
        if is_simple || self.has_8_bits {
            match self.rows.get(offset..offset + ROW_NEXT_STATE) {
                Some(&[a, b, c]) => row(a.into(), b.into(), c.into()),
                _ => Row::default(),
            }
        } else {
            match self
                .rows
                .get(offset..offset + 2 * ROW_NEXT_STATE)
                .map(U16s::of)
            {
                Some(fields) => row(fields.at(0).into(), fields.at(1).into(), fields.at(2)),
                None => Row::default(),
            }
        }
    }

    /// Like `next_state`, with the fields of the target.
    #[inline(always)]
    pub(crate) fn next_row(&self, row: usize, category: usize, is_simple: bool) -> Row {
        self.row(self.next_state(row, category, is_simple), is_simple)
    }
}

#[derive(Clone, Copy)]
pub(crate) struct RBBIData {
    pub(crate) forward_table: RBBIStateTable,
    pub(crate) reverse_table: RBBIStateTable,
    /// Maps a code point to its category. Empty if `Extras::trie16` does.
    pub(crate) trie8: FastTrie8<'static>,
    /// Extends to the end of the item.
    status_table: I32s<'static>,
    status_table_length: u32,
    pub(crate) dict_categories_start: u32,
}

/// What rules have that are not simple: they look ahead, or their rows or their trie have 16 bits.
#[derive(Clone, Copy)]
pub(crate) struct Extras {
    pub(crate) trie16: Option<FastTrie16<'static>>,
    pub(crate) look_ahead_results_size: u32,
}

impl RBBIData {
    pub(crate) fn read(item: &UDataMemory) -> Option<(Self, Option<Extras>)> {
        let header = U32s::try_from_offset(item.memory, 0, HEADER_LENGTH)?;
        let section = |index| item.memory.get(header.at(index) as usize..);
        if &item.info.data_format != b"Brk "
            || item.info.format_version[0] != RBBI_DATA_FORMAT
            || header.at(MAGIC) != 0xb1a0
        {
            return None;
        }
        let (forward, trie) = (section(FORWARD_TABLE)?, section(TRIE)?);
        let forward_table = RBBIStateTable::read(forward)?;
        let reverse_table = RBBIStateTable::read(section(REVERSE_TABLE)?)?;
        let (trie8, trie16) = match FastTrie8::open(trie) {
            Some(trie8) => (trie8, None),
            None => (FastTrie8::EMPTY, Some(FastTrie16::open(trie)?)),
        };
        let look_ahead_results_size = U32s::of(forward).get(LOOK_AHEAD_RESULTS_SIZE)?;
        let is_simple = forward_table.has_8_bits
            && reverse_table.has_8_bits
            && trie16.is_none()
            && look_ahead_results_size == 0;
        let data = Self {
            forward_table,
            reverse_table,
            trie8,
            status_table: I32s::of(section(STATUS_TABLE)?),
            status_table_length: header.at(STATUS_TABLE + 1) / 4,
            dict_categories_start: U32s::of(forward).get(DICT_CATEGORIES_START)?,
        };
        let extras = Extras {
            trie16,
            look_ahead_results_size,
        };
        Some((data, (!is_simple).then_some(extras)))
    }

    /// Returns the last, and largest, value of the record at `index`, which starts with the number of values.
    pub(crate) fn rule_status(&self, index: u16) -> i32 {
        let at = |index| self.status_table.get(index).unwrap_or(0);
        at(to_index(at(index.into())).wrapping_add(index.into()))
    }

    /// The numbers of values count as values. ICU4C: rbbi_cache.cpp, DictionaryCache::reset
    pub(crate) fn is_word_like(&self) -> bool {
        let length = (self.status_table.len()).min(self.status_table_length as usize);
        (0..length).rev().any(|i| self.status_table.at(i) > 100)
    }
}
