//! Lists: "a, b, and c". ICU4C: listformatter.cpp

use crate::common::arrayvec::ArrayVec;
use crate::common::bytes::U16s;
use crate::common::locid::Locale;
use crate::common::memory::{Appendable, try_concat, try_shared_result, try_with_capacity};
use crate::common::resource::{ResourceSink, ResourceValue};
use crate::common::simpleformatter::{ARG0, PatternParts};
use crate::common::slice_ext::to_int32;
use crate::common::uchar::uscript_get_script;
use crate::common::uinvchar::invariant_prefix;
use crate::common::unicode::uscript::USCRIPT_HEBREW;
use crate::common::unistr::{UStr, eq_str, ustr};
use crate::common::uresimp::*;
use crate::common::utypes::*;
use crate::i18n::formatted_string_builder::{FormattedStringBuilder, UNDEFINED_FIELD};
use crate::i18n::formattedvalue::{ConstrainedFieldPosition, FormattedValue};
use crate::i18n::locale_cache::LocaleCache;
use crate::i18n::unicode::uformattedvalue::UFIELD_CATEGORY_LIST;
use std::sync::Arc;

pub(crate) const ULISTFMT_ELEMENT_FIELD: i32 = 1;

fn is_any_at(text: &[u16], index: usize, letters: &[u8]) -> bool {
    text.get(index)
        .is_some_and(|&unit| letters.iter().any(|&letter| u16::from(letter) == unit))
}

/// Spanish "y" becomes "e" before "i" and "hi", except before "hia" and "hie".
fn should_change_to_e(text: &[u16]) -> bool {
    (is_any_at(text, 0, b"hH") && is_any_at(text, 1, b"iI") && !is_any_at(text, 2, b"aAeE"))
        || is_any_at(text, 0, b"iI")
}

/// Spanish "o" becomes "u" before "o", "ho", "8", and "11" if it is followed by a space or the end.
fn should_change_to_u(text: &[u16]) -> bool {
    is_any_at(text, 0, b"oO8")
        || (is_any_at(text, 0, b"hH") && is_any_at(text, 1, b"oO"))
        || matches!(text, [0x31, 0x31] | [0x31, 0x31, 0x20, ..])
}

/// Hebrew vav is followed by a hyphen if the item does not start with a character of the Hebrew script.
fn should_change_to_vav_dash(text: &[u16]) -> bool {
    !text.is_empty() && uscript_get_script(text.char32_at(0)) != USCRIPT_HEBREW
}

type ItemTest = fn(&[u16]) -> bool;
/// A pattern, its replacement, and the test on the last item that selects the replacement.
type Replacement = (&'static str, &'static str, ItemTest);

const SPANISH: &[Replacement] = &[
    ("{0} y {1}", "{0} e {1}", should_change_to_e),
    ("{0} o {1}", "{0} u {1}", should_change_to_u),
];
const HEBREW: &[Replacement] = &[(
    "{0} \u{5D5}{1}",
    "{0} \u{5D5}-{1}",
    should_change_to_vav_dash,
)];

/// Fails unless the pattern starts with {0}, the list so far.
fn compile(pattern: &[u16]) -> Result<PatternParts, UErrorCode> {
    if pattern.starts_with(&ARG0) {
        PatternParts::new(pattern)
    } else {
        Err(U_UNSUPPORTED_ERROR)
    }
}

/// A pattern for the last item, which may depend on the text of the item.
struct ContextualPattern {
    default: PatternParts,
    contextual: Option<(ItemTest, PatternParts)>,
}

impl ContextualPattern {
    fn new(pattern: &[u16], replacement: Option<&Replacement>) -> Result<Self, UErrorCode> {
        let contextual = match replacement {
            Some(&(from, to, test)) if eq_str(pattern, from) => Some((test, compile(&ustr(to))?)),
            _ => None,
        };
        Ok(Self {
            default: compile(pattern)?,
            contextual,
        })
    }

    fn select(&self, item: &[u16]) -> &PatternParts {
        match &self.contextual {
            Some((test, pattern)) if test(item) => pattern,
            _ => &self.default,
        }
    }
}

struct ListPatterns {
    two: ContextualPattern,
    start: PatternParts,
    middle: PatternParts,
    end: ContextualPattern,
}

impl ListPatterns {
    fn new(language: &[u8], [two, start, middle, end]: &[Vec<u16>; 4]) -> Result<Self, UErrorCode> {
        let replacements = match language {
            b"es" => SPANISH,
            b"he" | b"iw" => HEBREW,
            _ => &[],
        };
        let replacement = replacements
            .iter()
            .find(|(from, ..)| eq_str(two, from) || eq_str(end, from));
        Ok(Self {
            two: ContextualPattern::new(two, replacement)?,
            start: compile(start)?,
            middle: compile(middle)?,
            end: ContextualPattern::new(end, replacement)?,
        })
    }
}

type Style = ArrayVec<u8, 24>;

/// Returns "standard" for "/LOCALE/listPattern/standard/end".
fn aliased_style(alias: U16s) -> Style {
    let rest = alias.iter().skip("/LOCALE/listPattern/".len());
    Style::from_iter_truncated(invariant_prefix(rest).take_while(|&c| c != b'/'))
}

#[derive(Default)]
struct ListPatternsSink {
    /// The first value found for each of "2", "start", "middle" and "end".
    patterns: [Vec<u16>; 4],
    /// The style named by an alias in the last table passed to `put`. Missing patterns are looked up there next.
    aliased_style: Style,
}

impl ResourceSink for ListPatternsSink {
    fn put(&mut self, value: &ResourceValue) -> Result<(), UErrorCode> {
        self.aliased_style = Style::default();
        let [two, start, middle, end] = &mut self.patterns;
        for (key, value) in value.get_table()?.iter() {
            let pattern = match key {
                b"2" => &mut *two,
                b"start" => &mut *start,
                b"middle" => &mut *middle,
                b"end" => &mut *end,
                _ => continue,
            };
            match value.get_alias_string() {
                _ if !pattern.is_empty() => {}
                Ok(alias) => self.aliased_style = aliased_style(alias),
                Err(_) => *pattern = value.get_unicode_string()?,
            }
        }
        Ok(())
    }
}

fn load_patterns(locale: &Locale, style: &[u8]) -> Result<ListPatterns, UErrorCode> {
    let rb = ures_open(None, locale.get_name())?;
    let rb = rb.get_by_key_with_fallback(b"listPattern")?;
    let mut sink = ListPatternsSink::default();
    let mut style = Style::from_slice(style);
    // The limit ends a cycle of aliases.
    for _ in 0..64 {
        ures_get_all_items_with_fallback(&rb, &style, &mut sink)?;
        if sink.aliased_style.is_empty() || sink.aliased_style == style {
            break;
        }
        style = sink.aliased_style;
    }
    if sink.patterns.iter().any(Vec::is_empty) {
        return Err(U_MISSING_RESOURCE_ERROR);
    }
    ListPatterns::new(locale.get_language(), &sink.patterns)
}

pub(crate) struct ListFormatter {
    patterns: Arc<ListPatterns>,
}

impl ListFormatter {
    /// `style` is a key of the table `listPattern`.
    pub(crate) fn create_instance(locale: &Locale, style: &[u8]) -> Result<Self, UErrorCode> {
        /// Keyed by "locale:style".
        static PATTERNS: LocaleCache<ListPatterns> = LocaleCache::new();
        let key = try_concat(&[locale.get_name(), b":", style])?;
        let patterns = PATTERNS.get_or_try_insert_with(&key, || {
            try_shared_result(&mut load_patterns(locale, style))
        });
        patterns.map(|patterns| Self { patterns })
    }

    pub(crate) fn format(&self, items: &[&[u16]]) -> Result<FormattedList, UErrorCode> {
        let mut list = FormattedList {
            string: FormattedStringBuilder::new(),
            elements: try_with_capacity(items.len())?,
        };
        list.add_element(items.first().copied().unwrap_or_default());
        match *items {
            [] | [_] => {}
            [_, second] => list.append(self.patterns.two.select(second), second),
            [_, second, ref middle @ .., last] => {
                list.append(&self.patterns.start, second);
                for item in middle {
                    list.append(&self.patterns.middle, item);
                }
                list.append(self.patterns.end.select(last), last);
            }
        }
        list.string.write_terminator();
        list.string.outcome().map(|()| list)
    }
}

pub(crate) struct FormattedList {
    string: FormattedStringBuilder,
    /// Start and limit of each item that is not empty.
    elements: Vec<[i32; 2]>,
}

impl FormattedList {
    fn add_element(&mut self, item: &[u16]) {
        if !item.is_empty() {
            let start = self.string.len();
            self.string.add_all(item, UNDEFINED_FIELD);
            (self.elements).add([start, self.string.len()].map(to_int32));
        }
    }

    fn append(&mut self, pattern: &PatternParts, item: &[u16]) {
        let [_, infix, suffix] = pattern.pieces();
        self.string.add_all(infix, UNDEFINED_FIELD);
        self.add_element(item);
        self.string.add_all(suffix, UNDEFINED_FIELD);
    }

    pub(crate) fn text(&self) -> &[u16] {
        self.string.chars()
    }
}

impl FormattedValue for FormattedList {
    fn terminated_text(&self) -> &[u16] {
        self.string.chars_with_nul()
    }

    /// Reports only elements. The iteration context is the number of elements passed.
    fn next_position(&self, cfpos: &mut ConstrainedFieldPosition) -> bool {
        debug_assert!(cfpos.is_constrained());
        let context = cfpos.iteration_context();
        match self.elements.get(context as usize) {
            Some(&[start, limit]) if cfpos.matches_category(UFIELD_CATEGORY_LIST) => {
                cfpos.set_iteration_context(context + 1);
                cfpos.set_state(UFIELD_CATEGORY_LIST, ULISTFMT_ELEMENT_FIELD, start, limit);
                true
            }
            _ => {
                cfpos.set_to_end(self.string.len());
                false
            }
        }
    }
}
