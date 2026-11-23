//! The rule-based break iterator. Each call after a `reset` gets the same text, of at most `i32::MAX` units. ICU4C: rbbi.cpp

use crate::common::memory::{TryClone, try_box, try_filled};
use crate::common::rbbi_cache::{BreakCache, Segmenter};
use crate::common::rbbidata::{ACCEPTING_UNCONDITIONAL, Extras, RBBIData, START_STATE, STOP_STATE};
use crate::common::slice_ext::to_index;
use crate::common::ucptrie::FastTrie16;
use crate::common::utf16;
use crate::common::utypes::UErrorCode;

pub(crate) const UBRK_DONE: i32 = -1;

/// The category of `{eof}`.
const EOF_CATEGORY: usize = 1;

/// A match of the forward rules. It fits in a register.
#[derive(Clone, Copy)]
pub(crate) struct Segment {
    pub(crate) end: i32,
    pub(crate) rule_status_index: u16,
    pub(crate) has_dictionary_characters: bool,
}

/// The state of an iterator whose rules are not simple.
pub(crate) struct General {
    pub(crate) extras: Extras,
    /// The position of the `/` of each look-ahead rule, or -1.
    look_ahead_matches: Vec<i32>,
    /// A match that starts here keeps `look_ahead_matches`.
    last_end: i32,
    /// Set if a look-ahead rule is completed without a position.
    pub(crate) missed_look_ahead: bool,
}

impl General {
    #[cold]
    pub(crate) fn new(extras: &Extras) -> Result<Box<Self>, UErrorCode> {
        // The number of a rule has at most 16 bits.
        let count = extras.look_ahead_results_size.min(0x1_0000) as usize;
        try_box(Self {
            extras: *extras,
            look_ahead_matches: try_filled(-1, count)?,
            last_end: UBRK_DONE,
            missed_look_ahead: false,
        })
    }
}

#[inline(always)]
fn trie16(general: Option<&General>) -> Option<&FastTrie16<'static>> {
    general?.extras.trie16.as_ref()
}

// Each loop is compiled twice: with `None` for `general`, and out of the way with `Some`.
impl RBBIData {
    #[inline(always)]
    pub(crate) fn category(&self, c: u32, general: Option<&General>) -> usize {
        match trie16(general) {
            Some(trie16) => trie16.get(c).into(),
            None => self.trie8.get(c).into(),
        }
    }

    #[inline(never)]
    fn next_category8(&self, text: &[u16], mut offset: usize) -> (u8, usize) {
        (self.trie8.get(utf16::next(text, &mut offset)), offset)
    }

    /// Returns the category of the character at `offset`, and the offset after it.
    #[inline(always)]
    fn next_category(
        &self,
        text: &[u16],
        mut offset: usize,
        general: Option<&General>,
    ) -> (usize, usize) {
        if let Some(trie16) = trie16(general) {
            return (trie16.get(utf16::next(text, &mut offset)).into(), offset);
        }
        let (category, offset) = self.next_category8(text, offset);
        (category.into(), offset)
    }

    /// Matches the forward rules from `start`, the start of a character. Returns `None` at the end of the text.
    #[inline(always)]
    pub(crate) fn handle_next(
        &self,
        text: &[u16],
        start: i32,
        mut general: Option<&mut General>,
    ) -> Option<Segment> {
        if let Some(general) = &mut general {
            general.last_end = UBRK_DONE;
        }
        self.handle_next_sequential(text, start, general)
    }

    /// Like `handle_next`, but keeps the look-ahead positions if the last match ended at `start`.
    #[inline(always)]
    pub(crate) fn handle_next_sequential(
        &self,
        text: &[u16],
        start: i32,
        general: Option<&mut General>,
    ) -> Option<Segment> {
        match general {
            None => self.run_simple(text, start),
            Some(general) => self.run_general(text, start, general),
        }
    }

    #[inline(never)]
    fn run_simple(&self, text: &[u16], start: i32) -> Option<Segment> {
        self.run(text, start, None)
    }

    #[cold]
    fn run_general(&self, text: &[u16], start: i32, general: &mut General) -> Option<Segment> {
        // A `memset` of 0 bytes is slow on some processors.
        if general.last_end != start && !general.look_ahead_matches.is_empty() {
            general.look_ahead_matches.fill(-1);
        }
        let segment = self.run(text, start, Some(general));
        general.last_end = segment.map_or(UBRK_DONE, |segment| segment.end);
        segment
    }

    // ICU4C: rbbi.cpp, RuleBasedBreakIterator::handleNext
    #[inline(always)]
    fn run(&self, text: &[u16], start: i32, mut general: Option<&mut General>) -> Option<Segment> {
        let (table, mut offset) = (&self.forward_table, to_index(start));
        if offset >= text.len() {
            return None;
        }
        let (mut end, mut rule_status_index, mut max_category) = (offset, 0, 0);
        let (mut row, is_simple) = (table.row_offset(START_STATE), general.is_none());
        let has_trie8 = trie16(general.as_deref()).is_none();
        loop {
            let unit = text.get(offset).copied();
            let category;
            (category, offset) = match unit {
                Some(unit) if has_trie8 && unit < 0xd800 => {
                    (self.trie8.bmp_get(unit).into(), offset + 1)
                }
                Some(_) => self.next_category(text, offset, general.as_deref()),
                None => (EOF_CATEGORY, offset),
            };
            max_category = max_category.max(category);
            let next = table.next_row(row, category, is_simple);
            row = next.offset;
            let mut accepts = next.accepting != 0;
            if let Some(general) = &mut general
                && next.accepting > ACCEPTING_UNCONDITIONAL
            {
                if let Some(&position) = general.look_ahead_matches.get(next.accepting)
                    && position > start
                {
                    (end, rule_status_index) = (to_index(position), next.tags_index);
                    break;
                }
                general.missed_look_ahead = true;
                // The match ends here, unless the `/` is at the start of the rule.
                accepts = table.row(START_STATE, false).look_ahead != next.accepting;
            }
            if accepts {
                (end, rule_status_index) = (offset, next.tags_index);
            } else {
                // With a branch instead of a conditional move, the next match does not wait for this one.
                std::hint::cold_path();
            }
            if let Some(general) = &mut general
                && next.look_ahead > ACCEPTING_UNCONDITIONAL
                && let Some(position) = general.look_ahead_matches.get_mut(next.look_ahead)
            {
                *position = offset as i32;
            }
            if next.state == STOP_STATE || unit.is_none() {
                break;
            }
        }
        // No rule matches.
        if end == to_index(start) {
            utf16::fwd_1(text, &mut end);
            rule_status_index = 0;
        }
        Some(Segment {
            end: end as i32,
            rule_status_index,
            has_dictionary_characters: max_category >= self.dict_categories_start as usize,
        })
    }

    /// Returns whether the matches from `start` and from `later` are in the same state within 30 characters after `later`.
    #[inline(always)]
    fn joins(&self, text: &[u16], start: i32, later: i32, general: Option<&General>) -> bool {
        let (table, mut offset) = (&self.forward_table, to_index(start));
        let ([mut row, mut later_row], mut shared) = ([table.row_offset(START_STATE); 2], 0);
        let is_simple = general.is_none();
        while shared == 0 || row != later_row {
            if shared == 30 || offset >= text.len() {
                return false;
            }
            let is_shared = offset >= to_index(later);
            let category;
            (category, offset) = self.next_category(text, offset, general);
            let next = table.next_row(row, category, is_simple);
            if next.state == STOP_STATE || !is_simple && next.accepting > ACCEPTING_UNCONDITIONAL {
                return false;
            }
            row = next.offset;
            if is_shared {
                later_row = table.next_row(later_row, category, is_simple).offset;
                shared += 1;
            }
        }
        true
    }

    #[cold]
    fn joins_general(&self, text: &[u16], start: i32, later: i32, general: &General) -> bool {
        self.joins(text, start, later, Some(general))
    }

    /// Returns the first reliable match after a safe point, with its start. `later` is such a result, of over 30 characters.
    pub(crate) fn handle_next_from_safe_point(
        &self,
        text: &[u16],
        safe_point: i32,
        later: Option<(i32, Segment)>,
        mut general: Option<&mut General>,
    ) -> Option<(i32, Segment)> {
        let joins = |start, later, general: Option<&General>| match general {
            None => self.joins(text, start, later, None),
            Some(general) => self.joins_general(text, start, later, general),
        };
        let mut match_from = |start| match later {
            Some((later, segment)) if joins(start, later, general.as_deref()) => Some(segment),
            _ => self.handle_next(text, start, general.as_deref_mut()),
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
    pub(crate) fn handle_safe_previous(
        &self,
        text: &[u16],
        from: i32,
        general: Option<&General>,
    ) -> i32 {
        match general {
            None => self.run_backward(text, from, None),
            Some(general) => self.run_backward_general(text, from, general),
        }
    }

    #[cold]
    fn run_backward_general(&self, text: &[u16], from: i32, general: &General) -> i32 {
        self.run_backward(text, from, Some(general))
    }

    #[inline(always)]
    fn run_backward(&self, text: &[u16], from: i32, general: Option<&General>) -> i32 {
        let (table, mut offset) = (&self.reverse_table, to_index(from));
        utf16::set_cp_start(text, &mut offset);
        let (mut state, is_simple) = (START_STATE, general.is_none());
        while state != STOP_STATE
            && let Some(&unit) = text.get(offset.wrapping_sub(1))
        {
            let category = if is_simple && unit < 0xd800 {
                offset -= 1;
                self.trie8.bmp_get(unit).into()
            } else {
                self.category(utf16::prev(text, &mut offset), general)
            };
            state = table.next_state(table.row_offset(state), category, is_simple);
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
        let Segmenter { data, general, .. } = &self.segmenter;
        Ok(Self {
            break_cache: self.break_cache.clone_at_position()?,
            segmenter: Segmenter::new(data, general.as_ref().map(|general| &general.extras))?,
        })
    }
}

impl RuleBasedBreakIterator {
    pub(crate) fn new(data: &RBBIData, extras: Option<&Extras>) -> Result<Self, UErrorCode> {
        Ok(Self {
            break_cache: try_box(BreakCache::new())?,
            segmenter: Segmenter::new(data, extras)?,
        })
    }

    /// Keeps the engines that need grapheme clusters from dividing the text of this iterator, which finds the clusters.
    pub(crate) fn set_finds_clusters(&mut self) {
        self.segmenter.language_break_engines.finds_clusters = true;
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

    /// `offset` is the start of a character.
    pub(crate) fn preceding(&mut self, text: &[u16], offset: i32) -> i32 {
        self.break_cache
            .preceding(&mut self.segmenter, text, offset)
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
