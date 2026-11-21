//! The rule-based break iterator. Each call after a `reset` gets the same text, of at most `i32::MAX` units. ICU4C: rbbi.cpp

use crate::common::memory::{TryClone, try_box};
use crate::common::rbbi_cache::{BreakCache, Segmenter};
use crate::common::rbbidata::{RBBIData, START_STATE, STOP_STATE};
use crate::common::slice_ext::to_index;
use crate::common::utf16;
use crate::common::utypes::UErrorCode;

pub(crate) const UBRK_DONE: i32 = -1;

/// The category of `{eof}`.
const EOF_CATEGORY: u8 = 1;

/// A match of the forward rules. It fits in a register.
#[derive(Clone, Copy)]
pub(crate) struct Segment {
    pub(crate) end: i32,
    pub(crate) rule_status_index: u8,
    pub(crate) has_dictionary_characters: bool,
}

impl RBBIData {
    /// Returns the category of the character at `offset`, and the offset after it.
    #[inline(never)]
    fn next_category(&self, text: &[u16], mut offset: usize) -> (u8, usize) {
        (self.trie.get(utf16::next(text, &mut offset)), offset)
    }

    /// Matches the forward rules from `start`, the start of a character. Returns `None` at the end of the text.
    pub(crate) fn handle_next(&self, text: &[u16], start: i32) -> Option<Segment> {
        let (table, mut offset) = (&self.forward_table, to_index(start));
        if offset >= text.len() {
            return None;
        }
        let (mut end, mut rule_status_index, mut max_category) = (offset, 0, 0);
        let mut row = table.row_offset(START_STATE);
        loop {
            let unit = text.get(offset).copied();
            let category;
            (category, offset) = match unit {
                Some(unit) if unit < 0xd800 => (self.trie.bmp_get(unit), offset + 1),
                Some(_) => self.next_category(text, offset),
                None => (EOF_CATEGORY, offset),
            };
            max_category = max_category.max(category);
            let next = table.next_row(row, category);
            row = next.offset;
            if next.is_accepting {
                (end, rule_status_index) = (offset, next.tags_index);
            } else {
                // With a branch instead of a conditional move, the next match does not wait for this one.
                std::hint::cold_path();
            }
            if next.state == STOP_STATE || unit.is_none() {
                break;
            }
        }
        // Damaged rules may match nothing.
        if end == to_index(start) {
            utf16::fwd_1(text, &mut end);
            rule_status_index = 0;
        }
        Some(Segment {
            end: end as i32,
            rule_status_index,
            has_dictionary_characters: u32::from(max_category) >= table.dict_categories_start,
        })
    }

    /// Returns whether the matches from `start` and from `later` are in the same state within 30 characters after `later`.
    fn joins(&self, text: &[u16], start: i32, later: i32) -> bool {
        let (table, mut offset) = (&self.forward_table, to_index(start));
        let ([mut row, mut later_row], mut shared) = ([table.row_offset(START_STATE); 2], 0);
        while shared == 0 || row != later_row {
            if shared == 30 || offset >= text.len() {
                return false;
            }
            let is_shared = offset >= to_index(later);
            let category;
            (category, offset) = self.next_category(text, offset);
            let next = table.next_row(row, category);
            if next.state == STOP_STATE {
                return false;
            }
            row = next.offset;
            if is_shared {
                (later_row, shared) = (table.next_row(later_row, category).offset, shared + 1);
            }
        }
        true
    }

    /// Returns the first reliable match after a safe point, with its start. `later` is such a result, of over 30 characters.
    pub(crate) fn handle_next_from_safe_point(
        &self,
        text: &[u16],
        safe_point: i32,
        later: Option<(i32, Segment)>,
    ) -> Option<(i32, Segment)> {
        let match_from = |start| match later {
            Some((later, segment)) if self.joins(text, start, later) => Some(segment),
            _ => self.handle_next(text, start),
        };
        let first = match_from(safe_point)?;
        // The safe rules identify pairs of characters, so the boundary after the first one is not reliable.
        let mut second_character = to_index(safe_point);
        utf16::fwd_1(text, &mut second_character);
        if to_index(first.end) == second_character {
            Some((first.end, match_from(first.end)?))
        } else {
            Some((safe_point, first))
        }
    }

    /// Returns a safe point before `from`, or 0.
    pub(crate) fn handle_safe_previous(&self, text: &[u16], from: i32) -> i32 {
        let (table, mut offset) = (&self.reverse_table, to_index(from));
        utf16::set_cp_start(text, &mut offset);
        let mut state = START_STATE;
        while state != STOP_STATE
            && let Some(&unit) = text.get(offset.wrapping_sub(1))
        {
            let category = if unit < 0xd800 {
                offset -= 1;
                self.trie.bmp_get(unit)
            } else {
                self.trie.get(utf16::prev(text, &mut offset))
            };
            state = table.next_state(table.row_offset(state), category);
        }
        offset as i32
    }
}

pub(crate) struct RuleBasedBreakIterator {
    segmenter: Segmenter,
    break_cache: Box<BreakCache>,
}

impl TryClone for RuleBasedBreakIterator {
    /// Returns a copy at the current position, with empty caches.
    fn try_clone(&self) -> Result<Self, UErrorCode> {
        Ok(Self {
            segmenter: Segmenter::new(&self.segmenter.data),
            break_cache: self.break_cache.clone_at_position()?,
        })
    }
}

impl RuleBasedBreakIterator {
    pub(crate) fn new(data: &RBBIData) -> Result<Self, UErrorCode> {
        Ok(Self {
            segmenter: Segmenter::new(data),
            break_cache: try_box(BreakCache::new())?,
        })
    }

    pub(crate) fn reset(&mut self) {
        self.break_cache.set_text();
        self.segmenter.dictionary_cache.reset();
    }

    pub(crate) fn first(&mut self, text: &[u16]) -> i32 {
        self.break_cache
            .seek_or_populate(&mut self.segmenter, text, 0);
        0
    }

    #[inline]
    pub(crate) fn next(&mut self, text: &[u16]) -> i32 {
        self.break_cache
            .next(&mut self.segmenter, text)
            .unwrap_or(UBRK_DONE)
    }

    pub(crate) fn previous(&mut self, text: &[u16]) -> i32 {
        self.break_cache
            .previous(&mut self.segmenter, text)
            .unwrap_or(UBRK_DONE)
    }

    pub(crate) fn following(&mut self, text: &[u16], offset: i32) -> i32 {
        let Ok(offset) = usize::try_from(offset) else {
            return self.first(text);
        };
        let mut offset = offset.min(text.len());
        utf16::set_cp_start(text, &mut offset);
        self.break_cache
            .following(&mut self.segmenter, text, offset as i32)
            .unwrap_or(UBRK_DONE)
    }

    #[inline]
    pub(crate) fn current(&self) -> i32 {
        self.break_cache.position()
    }

    pub(crate) fn get_rule_status(&self) -> i32 {
        self.segmenter
            .data
            .rule_status(self.break_cache.rule_status_index())
    }
}
