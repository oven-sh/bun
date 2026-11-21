//! The abbreviations after which a sentence iterator with `ss=standard` does not break ("Mr. Smith"). ICU4C: filteredbrk.cpp

use crate::common::locid::{Locale, uloc_get_default};
use crate::common::memory::{Appendable, try_to_vec};
use crate::common::slice_ext::{SliceExt, to_index};
use crate::common::sorting::{sort_in_place, sort_in_place_by};
use crate::common::uresbund::{Opened, ROOT_LOCALE_NAME, ures_open_and_tell};
use crate::common::uresimp::U_ICUDATA_BRKITR;
use crate::common::utypes::{U_INDEX_OUTOFBOUNDS_ERROR, UErrorCode};

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

    fn next(&mut self, unit: u16) {
        let unit_of = |entry: &Entry| entry.0.get(self.length).copied();
        let start = self
            .entries
            .partition_point(|entry| unit_of(entry) < Some(unit));
        let rest = self.entries.slice(start..);
        self.entries = rest.slice(..rest.partition_point(|entry| unit_of(entry) == Some(unit)));
        self.length += 1;
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
    let (bundle, opened) = ures_open_and_tell(Some(U_ICUDATA_BRKITR), locale.get_base_name())?;
    let mut strings = Vec::new();
    if opened == Opened::Default {
        return Ok(strings);
    }
    let mut found = bundle.get_by_key_with_fallback(b"exceptions/SentenceBreak")?;
    let name = found.get_name();
    if name != bundle.get_name()
        && (name == uloc_get_default() || name.to_bytes() == ROOT_LOCALE_NAME)
    {
        return Ok(strings);
    }
    while found.has_next() {
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
        backwards.iter_mut().for_each(|entry| entry.0.reverse());
        sort_in_place_by(&mut backwards, |a, b| a.0.cmp(&b.0));
        Ok(Self {
            forwards,
            backwards,
        })
    }

    /// Returns whether the boundary `n` is suppressed. The start and the end of the text, and `UBRK_DONE`, are not.
    pub(crate) fn is_exception_at(&self, text: &[u16], n: i32) -> bool {
        let Some((before, [_, ..])) = text.split_at_checked(to_index(n)) else {
            return false;
        };
        let before = before.strip_suffix(&[SPACE]).unwrap_or(before);
        let (mut best, mut matcher) = (None, Matcher::new(&self.backwards));
        for &unit in before.iter().rev() {
            matcher.next(unit);
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
                let (mut matcher, mut units) =
                    (Matcher::new(&self.forwards), text.slice(start..).iter());
                while matcher.has_next()
                    && let Some(&unit) = units.next()
                {
                    matcher.next(unit);
                }
                // A text that ends in the middle of an abbreviation matches too.
                !matcher.entries.is_empty()
            }
        }
    }
}
