//! Engines that use a dictionary to divide text without spaces into words. ICU4C: dictbe.cpp

use crate::common::dictionarydata::DictionaryMatcher;
use crate::common::memory::{Appendable as _, set_oom, try_filled};
use crate::common::normalizer2::{Normalizer2, get_nfkc_instance};
use crate::common::slice_ext::{SliceExt as _, to_index};
use crate::common::uchar::{line_break, u_get_gc_mask, uscript_get_script};
use crate::common::udata::searches_files;
use crate::common::unicode::uchar::{U_GC_M_MASK, U_LB_COMPLEX_CONTEXT};
use crate::common::unicode::uscript::*;
use crate::common::uresimp::{U_ICUDATA_BRKITR, ures_get_next_string, ures_open};
use crate::common::utf16::{self, code_points};
use crate::common::utypes::UErrorCode;
use std::iter::repeat_n;

/// A position in the text, at the start of a character.
struct Cursor<'a> {
    text: &'a [u16],
    index: i32,
}

impl Cursor<'_> {
    /// Returns 0 at the end of the text.
    fn current(&self) -> u32 {
        utf16::get(self.text, to_index(self.index))
    }

    fn before(&self) -> u32 {
        utf16::prev(self.text, &mut to_index(self.index))
    }

    /// Returns `current()` and moves past it.
    fn next(&mut self) -> u32 {
        let mut index = to_index(self.index);
        let c = utf16::next(self.text, &mut index);
        self.index = index as i32;
        c
    }
}

/// What `WordBreakEngine` needs to know about a script.
pub(crate) struct WordScript {
    script: UScriptCode,
    begins_word: fn(u32) -> bool,
    ends_word: fn(u32) -> bool,
    has_suffixes: bool,
    /// A shorter run is not divided.
    min_run_length: i32,
}

pub(crate) static THAI: WordScript = WordScript {
    script: USCRIPT_THAI,
    begins_word: |c| matches!(c, 0x0E01..=0x0E2E | 0x0E40..=0x0E44),
    ends_word: |c| !matches!(c, 0x0E31 | 0x0E40..=0x0E44),
    has_suffixes: true,
    min_run_length: 5,
};
pub(crate) static LAO: WordScript = WordScript {
    script: USCRIPT_LAO,
    begins_word: |c| matches!(c, 0x0E81..=0x0EAE | 0x0EDC..=0x0EDD | 0x0EC0..=0x0EC4),
    ends_word: |c| !matches!(c, 0x0EC0..=0x0EC4),
    has_suffixes: false,
    min_run_length: 4,
};
pub(crate) static BURMESE: WordScript = WordScript {
    script: USCRIPT_MYANMAR,
    begins_word: |c| matches!(c, 0x1000..=0x102A),
    ends_word: |_| true,
    has_suffixes: false,
    min_run_length: 4,
};
pub(crate) static KHMER: WordScript = WordScript {
    script: USCRIPT_KHMER,
    begins_word: |c| matches!(c, 0x1780..=0x17B3),
    ends_word: |c| c != 0x17D2,
    has_suffixes: false,
    min_run_length: 4,
};

impl WordScript {
    /// Tests for `[[:Thai:]&[:LineBreak=SA:]]`, or the corresponding set of another script.
    pub(crate) fn handles(&self, c: u32) -> bool {
        uscript_get_script(c) == self.script && line_break(c) == U_LB_COMPLEX_CONTEXT
    }
}

const THAI_PAIYANNOI: u32 = 0x0E2F;
const THAI_MAIYAMOK: u32 = 0x0E46;

const LOOKAHEAD: usize = 3;
const ROOT_COMBINE_THRESHOLD: usize = 3;
const PREFIX_COMBINE_THRESHOLD: usize = 3;
const POSSIBLE_WORD_LIST_MAX: usize = 20;

/// The dictionary words that start at `offset`.
#[derive(Clone, Copy)]
struct PossibleWord {
    /// The length of each word, and whether it has fewer code points than `ROOT_COMBINE_THRESHOLD`.
    lengths: [(i32, bool); POSSIBLE_WORD_LIST_MAX],
    count: usize,
    prefix: usize,
    offset: i32,
    mark: usize,
    current: usize,
}

impl PossibleWord {
    const EMPTY: Self = Self {
        lengths: [(0, false); POSSIBLE_WORD_LIST_MAX],
        count: 0,
        prefix: 0,
        offset: -1,
        mark: 0,
        current: 0,
    };

    /// Returns whether the candidate is below the threshold.
    fn move_after(&self, candidate: usize, text: &mut Cursor) -> bool {
        let (length, is_short) = self.lengths.at(candidate);
        text.index = self.offset + length;
        is_short
    }

    /// Selects the longest candidate, moves `text` after it and returns the number of candidates.
    fn candidates(
        &mut self,
        text: &mut Cursor,
        dictionary: DictionaryMatcher,
        range_end: i32,
    ) -> usize {
        let start = text.index;
        if start != self.offset {
            (self.offset, self.count) = (start, 0);
            let rest = text.text.slice(to_index(start)..to_index(range_end));
            self.prefix = dictionary.matches(rest, usize::MAX, |length, cp_length, _| {
                if let Some(slot) = self.lengths.get_mut(self.count) {
                    *slot = (length as i32, cp_length < ROOT_COMBINE_THRESHOLD);
                    self.count += 1;
                }
            });
        }
        self.current = self.count.saturating_sub(1);
        self.mark = self.current;
        if self.count > 0 {
            self.move_after(self.current, text);
        }
        self.count
    }

    fn back_up(&mut self, text: &mut Cursor) -> bool {
        let has_previous = self.current > 0;
        if has_previous {
            self.current -= 1;
            self.move_after(self.current, text);
        }
        has_previous
    }

    fn mark_current(&mut self) {
        self.mark = self.current;
    }
}

struct PossibleWords([PossibleWord; LOOKAHEAD]);

impl PossibleWords {
    fn word(&mut self, number: usize) -> &mut PossibleWord {
        let [a, b, c] = &mut self.0;
        match number % LOOKAHEAD {
            0 => a,
            1 => b,
            _ => c,
        }
    }
}

/// For Thai, Lao, Burmese and Khmer.
pub(crate) struct WordBreakEngine {
    pub(crate) script: &'static WordScript,
    pub(crate) dictionary: DictionaryMatcher,
}

impl WordBreakEngine {
    /// Marks the candidate for word `number` that is followed by the most dictionary words, up to two.
    fn mark_best_candidate(
        &self,
        words: &mut PossibleWords,
        number: usize,
        text: &mut Cursor,
        range_end: i32,
    ) {
        if text.index >= range_end {
            return;
        }
        loop {
            if words
                .word(number + 1)
                .candidates(text, self.dictionary, range_end)
                > 0
            {
                words.word(number).mark_current();
                if text.index >= range_end {
                    return;
                }
                loop {
                    if words
                        .word(number + 2)
                        .candidates(text, self.dictionary, range_end)
                        > 0
                    {
                        return;
                    }
                    if !words.word(number + 1).back_up(text) {
                        break;
                    }
                }
            }
            if !words.word(number).back_up(text) {
                return;
            }
        }
    }

    /// Moves `text` by one character or more, to a plausible word boundary.
    fn resynchronize(&self, next: &mut PossibleWord, text: &mut Cursor, range_end: i32) {
        loop {
            let before = text.next();
            let index = text.index;
            if index >= range_end {
                return;
            }
            if (self.script.begins_word)(text.current())
                && (self.script.ends_word)(before)
                && next.candidates(text, self.dictionary, range_end) > 0
            {
                text.index = index;
                return;
            }
        }
    }

    /// Moves `text` past the suffix characters that extend the Thai word before it.
    fn skip_suffixes(&self, next: &mut PossibleWord, text: &mut Cursor, range_end: i32) {
        let word_end = text.index;
        if next.candidates(text, self.dictionary, range_end) > 0 {
            text.index = word_end;
            return;
        }
        if text.current() == THAI_PAIYANNOI
            && !matches!(text.before(), THAI_PAIYANNOI | THAI_MAIYAMOK)
        {
            text.next();
        }
        if text.current() == THAI_MAIYAMOK && text.before() != THAI_MAIYAMOK {
            text.next();
        }
    }

    /// Appends the boundaries inside the range. ICU4C: dictbe.cpp, ThaiBreakEngine::divideUpDictionaryRange
    pub(crate) fn divide_up(
        &self,
        text: &[u16],
        range_start: i32,
        range_end: i32,
        found_breaks: &mut Vec<i32>,
    ) {
        if range_end - range_start < self.script.min_run_length {
            return;
        }
        let text = &mut Cursor {
            text,
            index: range_start,
        };
        let mut words_found = 0;
        let mut words = PossibleWords([PossibleWord::EMPTY; LOOKAHEAD]);
        loop {
            let (start, mut can_combine) = (text.index, true);
            let candidates = words
                .word(words_found)
                .candidates(text, self.dictionary, range_end);
            if candidates > 1 {
                self.mark_best_candidate(&mut words, words_found, text, range_end);
            }
            if candidates > 0 {
                let word = words.word(words_found);
                can_combine = word.move_after(word.mark, text);
                words_found += 1;
            }

            // Following text that is not a dictionary word is combined with a word below the threshold.
            if text.index < range_end && can_combine {
                let (next, word_end) = (words.word(words_found), text.index);
                if next.candidates(text, self.dictionary, range_end) == 0
                    && (word_end == start || next.prefix < PREFIX_COMBINE_THRESHOLD)
                {
                    self.resynchronize(words.word(words_found + 1), text, range_end);
                    words_found += usize::from(word_end == start);
                } else {
                    text.index = word_end;
                }
            }

            while text.index < range_end && u_get_gc_mask(text.current()) & U_GC_M_MASK != 0 {
                text.next();
            }
            if self.script.has_suffixes && text.index < range_end {
                self.skip_suffixes(words.word(words_found), text, range_end);
            }
            if text.index >= range_end {
                return;
            }
            found_breaks.add(text.index);
        }
    }
}

const MAX_KATAKANA_GROUP_LENGTH: usize = 20;
const MAX_SNLP: u32 = 255;
const MAX_WORD_SIZE: usize = 20;

fn katakana_cost(word_length: usize) -> u32 {
    [8192, 984, 408, 240, 204, 252, 300, 372, 480]
        .get(word_length)
        .copied()
        .unwrap_or(8192)
}

fn is_katakana(unit: u16) -> bool {
    matches!(unit, 0x30A1..=0x30FA | 0x30FC..=0x30FE | 0xFF66..=0xFF9F)
}

/// Tests for the characters of script Common that the engine for Chinese and Japanese handles.
pub(crate) fn is_common_script_kana(c: u32) -> bool {
    matches!(c, 0x30FC | 0xFF70 | 0xFF9E | 0xFF9F)
}

pub(crate) fn is_hangul_syllable(c: u32) -> bool {
    matches!(c, 0xAC00..=0xD7A3)
}

/// The best segmentation of a prefix of the text.
#[derive(Clone, Copy, Default)]
struct BestSplit {
    /// The sum of negative log probabilities. `u32::MAX` if the prefix has no segmentation.
    snlp: u32,
    /// Length of the last word in code units.
    length: u32,
}

/// For Chinese and Japanese, or for Korean.
pub(crate) struct CjkBreakEngine {
    dictionary: DictionaryMatcher,
    nfkc: &'static Normalizer2,
}

impl CjkBreakEngine {
    pub(crate) fn new(dictionary: DictionaryMatcher) -> Result<Self, UErrorCode> {
        let nfkc = get_nfkc_instance()?;
        Ok(Self { dictionary, nfkc })
    }

    /// Fails without the list of Japanese extensions. The linked data have it, unless `--trim` has removed the language.
    pub(crate) fn for_chinese_japanese(dictionary: DictionaryMatcher) -> Result<Self, UErrorCode> {
        let engine = Self::new(dictionary)?;
        if searches_files()? {
            let mut list = ures_open(Some(U_ICUDATA_BRKITR), b"ja")?.get_by_key(b"extensions")?;
            while list.has_next() {
                ures_get_next_string(&mut list)?;
            }
        }
        Ok(engine)
    }

    /// For Chinese and Japanese.
    pub(crate) fn handles(c: u32) -> bool {
        matches!(
            uscript_get_script(c),
            USCRIPT_HAN | USCRIPT_HIRAGANA | USCRIPT_KATAKANA
        ) || is_common_script_kana(c)
    }

    /// Returns the NFKC form of `text` and, for each of its units, the offset in `text` of the fragment that it comes from.
    fn normalize(&self, text: &[u16]) -> Result<(Vec<u16>, Vec<i32>), UErrorCode> {
        let (mut units, mut map, mut normalized_fragment) = (Vec::new(), Vec::new(), Vec::new());
        let mut start = 0;
        while start < text.len() {
            let mut limit = start;
            utf16::fwd_1(text, &mut limit);
            let continuation =
                code_points(text.slice(limit..)).take_while(|&c| !self.nfkc.has_boundary_before(c));
            limit += continuation.map(utf16::length).sum::<usize>();
            self.nfkc
                .normalize(text.slice(start..limit), &mut normalized_fragment)?;
            units.add_all(&normalized_fragment);
            // A longer run counts as a failed allocation.
            if units.len() >= 1 << 28 {
                return Err(set_oom(()));
            }
            map.add_each(repeat_n(start as i32, normalized_fragment.len()));
            start = limit;
        }
        Ok((units, map))
    }

    /// Returns one entry for each code unit and one for the end.
    fn best_splits(&self, text: &[u16]) -> Result<Vec<BestSplit>, UErrorCode> {
        let mut best = try_filled(
            BestSplit {
                snlp: u32::MAX,
                length: 0,
            },
            text.len() + 1,
        )?;
        best.set(0, BestSplit::default());
        let mut is_prev_katakana = false;
        for (i, &unit) in text.iter().enumerate() {
            let snlp = best.at(i).snlp;
            if snlp == u32::MAX {
                continue;
            }
            let mut consider = |length: usize, value: u32| {
                let snlp = snlp.wrapping_add(value);
                if snlp < best.at(i + length).snlp {
                    best.set(
                        i + length,
                        BestSplit {
                            snlp,
                            length: length as u32,
                        },
                    );
                }
            };

            let (rest, mut has_one_character_word) = (text.slice(i..), false);
            (self.dictionary).matches(rest, MAX_WORD_SIZE, |length, cp_length, value| {
                has_one_character_word |= cp_length == 1;
                consider(length, value as u32);
            });
            if !has_one_character_word && !is_hangul_syllable(unit.into()) {
                consider(utf16::length(utf16::get(text, i)), MAX_SNLP);
            }

            let is_current_katakana = is_katakana(unit);
            if !is_prev_katakana && is_current_katakana {
                let group = rest.iter().take(MAX_KATAKANA_GROUP_LENGTH);
                let length = group.take_while(|&&unit| is_katakana(unit)).count();
                if length < MAX_KATAKANA_GROUP_LENGTH {
                    consider(length, katakana_cost(length));
                }
            }
            is_prev_katakana = is_current_katakana;
        }
        Ok(best)
    }

    /// Appends the boundaries inside `run`. ICU4C: dictbe.cpp, CjkBreakEngine::divideUpDictionaryRange
    pub(crate) fn divide_up(
        &self,
        run: &[u16],
        run_start: i32,
        found_breaks: &mut Vec<i32>,
    ) -> Result<(), UErrorCode> {
        let normalized = if self.nfkc.is_normalized(run) == Ok(true) {
            None
        } else {
            Some(self.normalize(run)?)
        };
        let best = self.best_splits(normalized.as_ref().map_or(run, |(units, _)| units))?;
        let (before, mut i, mut last) = (found_breaks.len(), best.len() - 1, i32::MAX);
        while i > 0 {
            i -= match best.at(i).length {
                // The run has no segmentation.
                0 => i,
                length => length as usize,
            };
            let offset = normalized.as_ref().map_or(i as i32, |(_, map)| map.at(i));
            // A boundary inside text that normalization has expanded moves to the start of the fragment.
            if 0 < offset && offset < last {
                found_breaks.add(run_start + offset);
                last = offset;
            }
        }
        found_breaks.slice_mut(before..).reverse();
        Ok(())
    }
}
