//! Patterns like "{1} was born in {0}", in which apostrophes quote braces. ICU4C: simpleformatter.cpp

use crate::common::memory::{Appendable, try_with_capacity};
use crate::common::sink::{MAX_STRING_CAPACITY, TextBuf};
use crate::common::slice_ext::{SliceExt, SoftUnwrap};
use crate::common::unistr::UStr;
use crate::common::utypes::*;
use std::cmp::Ordering;

/// The exclusive upper limit of argument numbers, and the offset that is added to the length of a text segment.
pub(crate) const ARG_NUM_LIMIT: usize = 0x100;
const MAX_SEGMENT_LENGTH: usize = 0xffff - ARG_NUM_LIMIT;

/// "{0}"
pub(crate) const ARG0: [u16; 3] = [OPEN_BRACE, DIGIT_ZERO, CLOSE_BRACE];

const APOS: u16 = 0x27;
const DIGIT_ZERO: u16 = 0x30;
const DIGIT_NINE: u16 = 0x39;
const OPEN_BRACE: u16 = 0x7b;
const CLOSE_BRACE: u16 = 0x7d;

pub(crate) struct SimpleFormatter {
    /// The highest argument number + 1, then argument numbers and length-prefixed text segments. Empty means `[0]`.
    compiled_pattern: Vec<u16>,
}

enum Part<'a> {
    Argument(usize),
    Text(&'a [u16]),
}

/// Iterates over `rest`, a compiled pattern without its first unit.
fn parts(mut rest: &[u16]) -> impl Iterator<Item = Part<'_>> {
    std::iter::from_fn(move || {
        let (&n, after) = rest.split_first()?;
        let length = usize::from(n).saturating_sub(ARG_NUM_LIMIT);
        rest = after.slice(length..);
        Some(if length == 0 {
            Part::Argument(n.into())
        } else {
            Part::Text(after.slice(..length))
        })
    })
}

fn texts<'a>(rest: &'a [u16], values: &[&'a [u16]]) -> impl Iterator<Item = &'a [u16]> {
    parts(rest).map_while(|part| match part {
        Part::Argument(n) => values.get(n).copied(),
        Part::Text(text) => Some(text),
    })
}

/// Stops at a length that no text can have, which bounds a result that repeats its input.
fn format_parts(rest: &[u16], values: &[&[u16]], append_to: &mut dyn TextBuf) {
    const TOO_LONG: usize = 1 << 31;
    for text in texts(rest, values) {
        let room = TOO_LONG.saturating_sub(append_to.len());
        append_to.add_all(text.slice(..text.len().min(room)));
    }
}

/// Parses "12}". Returns the number and the text after the brace.
fn parse_argument(text: &[u16]) -> Option<(usize, &[u16])> {
    let count = text
        .iter()
        .take(3)
        .take_while(|c| (DIGIT_ZERO..=DIGIT_NINE).contains(c))
        .count();
    let (digits, [CLOSE_BRACE, rest @ ..]) = text.split_soft(count) else {
        return None;
    };
    let number = digits.iter().fold(0, |number, digit| {
        number * 10 + usize::from(digit - DIGIT_ZERO)
    });
    (number < ARG_NUM_LIMIT && !matches!(digits, [] | [DIGIT_ZERO, _, ..]))
        .then_some((number, rest))
}

impl SimpleFormatter {
    pub(crate) fn new() -> Self {
        Self {
            compiled_pattern: Vec::new(),
        }
    }

    /// Returns `U_ILLEGAL_ARGUMENT_ERROR` on bad syntax or if the highest argument number + 1 is not in `min..=max`.
    pub(crate) fn with_pattern_min_max_arguments(
        pattern: &[u16],
        min: usize,
        max: usize,
    ) -> Result<Self, UErrorCode> {
        // An argument shrinks from at least 3 units to 1, which makes up for the length unit of the next segment.
        let mut compiled =
            try_with_capacity(pattern.len() + pattern.len() / MAX_SEGMENT_LENGTH + 2)?;
        compiled.add(0);
        let (mut rest, mut limit, mut text_length, mut in_quote) = (pattern, 0, 0, false);
        while let &[mut c, ref after @ ..] = rest {
            rest = after;
            match (c, after) {
                (APOS, [APOS, after @ ..]) => rest = after,
                (APOS, _) if in_quote => {
                    in_quote = false;
                    continue;
                }
                (APOS, [brace @ (OPEN_BRACE | CLOSE_BRACE), after @ ..]) => {
                    (c, rest, in_quote) = (*brace, after, true)
                }
                (OPEN_BRACE, _) if !in_quote => {
                    let number;
                    (number, rest) = parse_argument(after).ok_or(U_ILLEGAL_ARGUMENT_ERROR)?;
                    compiled.add(number as u16);
                    (limit, text_length) = (limit.max(number + 1), 0);
                    continue;
                }
                _ => {}
            }
            text_length = text_length % MAX_SEGMENT_LENGTH + 1;
            if text_length == 1 {
                compiled.add(0);
            }
            let length_index = compiled.len() - text_length;
            compiled.set(length_index, (ARG_NUM_LIMIT + text_length) as u16);
            compiled.add(c);
        }
        if limit < min || max < limit {
            return Err(U_ILLEGAL_ARGUMENT_ERROR);
        }
        compiled.set(0, limit as u16);
        Ok(Self {
            compiled_pattern: compiled,
        })
    }

    pub(crate) fn get_argument_limit(&self) -> usize {
        self.compiled_pattern().at(0).into()
    }

    pub(crate) fn compiled_pattern(&self) -> &[u16] {
        if self.compiled_pattern.is_empty() {
            &[0]
        } else {
            &self.compiled_pattern
        }
    }

    /// Stops at the first argument that has no value.
    pub(crate) fn format(&self, values: &[&[u16]], append_to: &mut dyn TextBuf) {
        format_parts(self.compiled_pattern().slice(1..), values, append_to);
    }

    /// Returns an empty text if the result is too long.
    pub(crate) fn format_to_vec(&self, values: &[&[u16]]) -> Vec<u16> {
        self.format_unless_too_long(values).unwrap_or_default()
    }

    /// Returns `None` if the result exceeds `MAX_STRING_CAPACITY`.
    pub(crate) fn format_unless_too_long(&self, values: &[&[u16]]) -> Option<Vec<u16>> {
        let rest = self.compiled_pattern().slice(1..);
        let length = texts(rest, values)
            .map(<[u16]>::len)
            .fold(0, usize::saturating_add);
        (length <= MAX_STRING_CAPACITY).then(|| {
            let mut result = try_with_capacity(length).unwrap_or_default();
            format_parts(rest, values, &mut result);
            result
        })
    }
}

/// The literal text of a pattern with {0} and {1}, and the offsets of the arguments.
pub(crate) struct PatternParts {
    text: Vec<u16>,
    prefix_end: usize,
    infix_length: usize,
    suffix_start: usize,
    /// The offset of {0} compared with the offset of {1}.
    pub order: Ordering,
}

impl PatternParts {
    pub(crate) fn new(pattern: &[u16]) -> Result<Self, UErrorCode> {
        let formatter = SimpleFormatter::with_pattern_min_max_arguments(pattern, 2, 2)?;
        let (mut text, mut offsets) = (try_with_capacity(pattern.len())?, [None; 2]);
        for part in parts(formatter.compiled_pattern.slice(1..)) {
            match part {
                Part::Argument(n) => offsets.set(n, Some(text.len())),
                Part::Text(part) => text.add_all(part),
            }
        }
        let [zero, one] = offsets;
        let (first, suffix_start) = (zero.min(one), zero.max(one).soft_unwrap());
        // The offset of a missing {0}, as in "'{0}' {1}", counts as -1.
        let (prefix_end, infix_length) =
            first.map_or((0, suffix_start + 1), |first| (first, suffix_start - first));
        Ok(Self {
            text,
            prefix_end,
            infix_length,
            suffix_start,
            order: zero.cmp(&one),
        })
    }

    /// Returns the text before, between and after the arguments.
    pub(crate) fn pieces(&self) -> [&[u16]; 3] {
        [
            self.text.slice(..self.prefix_end),
            self.text
                .temp_sub_string(self.prefix_end, self.infix_length),
            self.text.slice(self.suffix_start..),
        ]
    }
}
