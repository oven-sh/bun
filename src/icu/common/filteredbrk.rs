//! The abbreviations after which a sentence iterator with `ss=standard` does not break ("Mr. Smith"). ICU4C: filteredbrk.cpp

use crate::common::locid::Locale;
use crate::common::memory::{Appendable, try_to_vec};
use crate::common::slice_ext::{SliceExt, to_index};
use crate::common::sorting::{sort_in_place, sort_in_place_by};
use crate::common::unistr::UString as _;
use crate::common::uresbund::{Opened, ures_open_and_tell};
use crate::common::uresimp::U_ICUDATA_BRKITR;
use crate::common::utf16;
use crate::common::utypes::{U_ILLEGAL_ARGUMENT_ERROR, U_INDEX_OUTOFBOUNDS_ERROR, UErrorCode};

const FULL_STOP: u16 = 0x002E;
const SPACE: u16 = 0x0020;
const MAX_LENGTH: usize = 0xffff;

#[derive(Clone, Copy)]
enum MatchKind {
    /// The prefix of an abbreviation, up to and including its first period.
    Partial,
    Whole,
}

type Entry = (Vec<u16>, MatchKind);

/// Matches input against a sorted list, one code unit at a time.
struct Matcher<'a> {
    /// The entries that start with the `length` code units consumed so far.
    entries: &'a [Entry],
    length: usize,
}

impl<'a> Matcher<'a> {
    fn new(entries: &'a [Entry]) -> Self {
        Self { entries, length: 0 }
    }

    #[inline(always)]
    fn next(&mut self, unit: u16) {
        let unit_of = |entry: &Entry| entry.0.get(self.length).copied();
        let start = self
            .entries
            .partition_point(|entry| unit_of(entry) < Some(unit));
        let rest = self.entries.slice(start..);
        self.entries = rest.slice(..rest.partition_point(|entry| unit_of(entry) == Some(unit)));
        self.length += 1;
    }

    #[inline(always)]
    fn next_code_point(&mut self, c: u32) {
        if c <= 0xffff {
            self.next(c as u16);
        } else {
            self.next(utf16::lead(c));
            self.next(utf16::trail(c));
        }
    }

    fn value(&self) -> Option<MatchKind> {
        let (units, kind) = self.entries.first()?;
        (units.len() == self.length).then_some(*kind)
    }

    fn has_next(&self) -> bool {
        self.entries
            .last()
            .is_some_and(|entry| entry.0.len() > self.length)
    }
}

pub(crate) struct Exceptions {
    /// Abbreviations with an inner period ("Ph.D."), and all others that have the same prefix.
    forwards: Vec<Entry>,
    /// The remaining abbreviations and the prefixes of `forwards`, reversed: ".srM", ".hP".
    backwards: Vec<Entry>,
    /// Without them it makes no difference whether code units or code points are matched.
    has_surrogates: bool,
}

/// Returns `string` up to and including its first period, or all of it.
fn prefix(string: &[u16]) -> &[u16] {
    string
        .split_inclusive(|&unit| unit == FULL_STOP)
        .next()
        .unwrap_or_default()
}

/// Fails if `locale` has none. The list is empty after a fallback to root or to the default locale, even if that is a parent.
pub(crate) fn load_abbreviations(locale: &Locale) -> Result<Vec<Vec<u16>>, UErrorCode> {
    let (mut found, mut opened) =
        ures_open_and_tell(Some(U_ICUDATA_BRKITR), locale.get_base_name())?;
    let mut strings = Vec::new();
    for key in [b"exceptions".as_slice(), b"SentenceBreak"] {
        if opened != Opened::Default {
            (found, opened) = found.get_by_key_with_fallback_and_tell(key)?;
        }
    }
    while opened != Opened::Default && found.has_next() {
        let abbreviation = found.get_next_resource()?;
        strings.add(abbreviation.get_string()?.try_to_vec()?);
    }
    Ok(strings)
}

impl Exceptions {
    // ICU4C: filteredbrk.cpp, SimpleFilteredBreakIteratorBuilder::build
    pub(crate) fn new(mut strings: Vec<Vec<u16>>) -> Result<Self, UErrorCode> {
        if strings.iter().any(|string| string.len() > MAX_LENGTH) {
            return Err(U_INDEX_OUTOFBOUNDS_ERROR);
        }
        sort_in_place(&mut strings);
        let has_surrogates =
            (strings.iter().flatten()).any(|&unit| utf16::is_surrogate(unit.into()));
        if has_surrogates {
            strings.dedup();
        }
        let (mut forwards, mut backwards) = (Vec::new(), Vec::new());
        let first_run = |rest: &[Vec<u16>]| {
            let mut runs = rest.runs_by(|a, b| prefix(a) == prefix(b));
            runs.next().map(<[_]>::len)
        };
        let mut rest = strings.as_mut_slice();
        while let Some(count) = first_run(rest) {
            let same_prefix;
            (same_prefix, rest) = rest.split_soft_mut(count);
            let partial = same_prefix
                .iter()
                .find(|string| prefix(string).len() < string.len());
            let list = if let Some(partial) = partial {
                backwards.add((try_to_vec(prefix(partial))?, MatchKind::Partial));
                &mut forwards
            } else {
                &mut backwards
            };
            for string in same_prefix {
                list.add((std::mem::take(string), MatchKind::Whole));
            }
        }
        for (string, _) in &mut backwards {
            if has_surrogates {
                string.reverse_code_points();
            } else {
                string.reverse();
            }
        }
        sort_in_place_by(&mut backwards, |a, b| a.0.cmp(&b.0));
        // A surrogate pair and its swapped halves reverse to equal strings.
        if has_surrogates && (backwards.array_windows()).any(|[a, b]| a.0 == b.0) {
            return Err(U_ILLEGAL_ARGUMENT_ERROR);
        }
        Ok(Self {
            forwards,
            backwards,
            has_surrogates,
        })
    }

    /// Returns whether the boundary `n` is suppressed. The start and the end of the text, and `UBRK_DONE`, are not.
    pub(crate) fn is_exception_at(&self, text: &[u16], n: i32) -> bool {
        if self.has_surrogates {
            return self.match_code_points(text, n);
        }
        self.match_characters(text, n, |text| text.iter().map(|&unit| unit.into()))
    }

    #[cold]
    fn match_code_points(&self, text: &[u16], n: i32) -> bool {
        self.match_characters(text, n, utf16::code_points)
    }

    // ICU4C: filteredbrk.cpp, SimpleFilteredSentenceBreakIterator::breakExceptionAt
    #[inline(always)]
    fn match_characters<'a, Characters: DoubleEndedIterator<Item = u32>>(
        &self,
        text: &'a [u16],
        n: i32,
        characters: impl Fn(&'a [u16]) -> Characters,
    ) -> bool {
        let Some((before, [_, ..])) = text.split_at_checked(to_index(n)) else {
            return false;
        };
        let before = before.strip_suffix(&[SPACE]).unwrap_or(before);
        let (mut best, mut matcher) = (None, Matcher::new(&self.backwards));
        for c in characters(before).rev() {
            matcher.next_code_point(c);
            if let Some(value) = matcher.value() {
                best = Some((before.len() - matcher.length, value));
            }
            if !matcher.has_next() {
                break;
            }
        }
        match best {
            None => false,
            Some((_, MatchKind::Whole)) => true,
            Some((start, MatchKind::Partial)) => {
                let mut matcher = Matcher::new(&self.forwards);
                let mut characters = characters(text.slice(start..));
                while matcher.has_next()
                    && let Some(c) = characters.next()
                {
                    matcher.next_code_point(c);
                }
                // A text that ends in the middle of an abbreviation matches too.
                !matcher.entries.is_empty()
            }
        }
    }
}
