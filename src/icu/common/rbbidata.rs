//! Compiled break rules, the `.brk` items. ICU4C: rbbidata.h, rbbidata.cpp

use crate::common::bytes::{I32s, U32s};
use crate::common::slice_ext::to_index;
use crate::common::ucptrie::FastTrie8;
use crate::common::udata::UDataInfo;
use crate::sys::package::RBBI_DATA_FORMAT;

// Indexes of the 32-bit fields of `RBBIDataHeader`.
const MAGIC: usize = 0;
const FORWARD_TABLE: usize = 4;
const REVERSE_TABLE: usize = 6;
const TRIE: usize = 8;
const STATUS_TABLE: usize = 12;

// Indexes of the 32-bit fields of `RBBIStateTable`.
const ROW_LENGTH: usize = 1;
const DICT_CATEGORIES_START: usize = 2;
const LOOK_AHEAD_RESULTS_SIZE: usize = 3;
const FLAGS: usize = 4;
const TABLE_DATA: usize = 5;

const RBBI_8BITS_ROWS: u32 = 4;
/// A row has the fields `fAccepting`, `fLookAhead` and `fTagsIdx`, then the next state for each category.
const ROW_NEXT_STATE: usize = 3;

pub(crate) const START_STATE: u8 = 1;
pub(crate) const STOP_STATE: u8 = 0;

#[derive(Clone, Copy)]
pub(crate) struct RBBIStateTable {
    row_length: u32,
    pub(crate) dict_categories_start: u32,
    /// Extends to the end of the item.
    rows: &'static [u8],
}

#[derive(Default)]
pub(crate) struct Row {
    pub(crate) state: u8,
    /// `row_offset(state)`
    pub(crate) offset: usize,
    pub(crate) is_accepting: bool,
    pub(crate) tags_index: u8,
}

impl RBBIStateTable {
    /// Rejects 16-bit rows and look-ahead rules.
    fn read(table: &'static [u8]) -> Option<Self> {
        let header = U32s::of(table);
        if header.get(FLAGS)? & RBBI_8BITS_ROWS == 0 || header.get(LOOK_AHEAD_RESULTS_SIZE)? != 0 {
            return None;
        }
        Some(Self {
            row_length: header.get(ROW_LENGTH)?,
            dict_categories_start: header.get(DICT_CATEGORIES_START)?,
            rows: table.get(TABLE_DATA * 4..)?,
        })
    }

    #[inline(always)]
    pub(crate) fn row_offset(&self, state: u8) -> usize {
        self.row_length.wrapping_mul(state.into()) as usize
    }

    /// Returns the target of the transition for `category` in the row at offset `row`, or the stop state if out of bounds.
    #[inline(always)]
    pub(crate) fn next_state(&self, row: usize, category: u8) -> u8 {
        let index = row.wrapping_add(ROW_NEXT_STATE + usize::from(category));
        self.rows.get(index).copied().unwrap_or(STOP_STATE)
    }

    /// Like `next_state`, with the fields of the target.
    #[inline(always)]
    pub(crate) fn next_row(&self, row: usize, category: u8) -> Row {
        let state = self.next_state(row, category);
        let offset = self.row_offset(state);
        match self.rows.get(offset..offset.wrapping_add(ROW_NEXT_STATE)) {
            Some(&[accepting, _, tags_index]) => Row {
                state,
                offset,
                is_accepting: accepting != 0,
                tags_index,
            },
            _ => Row::default(),
        }
    }
}

#[derive(Clone, Copy)]
pub(crate) struct RBBIData {
    pub(crate) forward_table: RBBIStateTable,
    pub(crate) reverse_table: RBBIStateTable,
    /// Maps a code point to its category.
    pub(crate) trie: FastTrie8<'static>,
    status_table: I32s<'static>,
}

impl RBBIData {
    pub(crate) fn is_acceptable(info: &UDataInfo) -> bool {
        &info.data_format == b"Brk " && info.format_version[0] == RBBI_DATA_FORMAT
    }

    pub(crate) fn read(bytes: &'static [u8]) -> Option<Self> {
        let header = U32s::of(bytes);
        let section = |index| bytes.get(header.get(index)? as usize..);
        if header.get(MAGIC)? != 0xb1a0 {
            return None;
        }
        Some(Self {
            forward_table: RBBIStateTable::read(section(FORWARD_TABLE)?)?,
            reverse_table: RBBIStateTable::read(section(REVERSE_TABLE)?)?,
            trie: FastTrie8::open(section(TRIE)?)?,
            status_table: I32s::of(section(STATUS_TABLE)?),
        })
    }

    /// Returns the last, and largest, value of the record at `index`, which starts with the number of values.
    pub(crate) fn rule_status(&self, index: u8) -> i32 {
        let at = |index| self.status_table.get(index).unwrap_or(0);
        at(to_index(at(index.into())).wrapping_add(index.into()))
    }
}
