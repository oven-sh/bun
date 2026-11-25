//! What Node's `toLowerCase()` and regular expressions know about a character. It has its own copy of Unicode, and not that of the system.

use bun_core::vec::BorrowedCursor;

use crate::{Failure, Scratch};

#[path = "unicode_tables.rs"]
mod tables;

/// As fine as the classes of a glob tell characters apart.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Category {
    UppercaseLetter,
    LowercaseLetter,
    OtherLetter,
    LetterNumber,
    DecimalNumber,
    SpaceSeparator,
    OtherSeparator,
    Control,
    OtherOther,
    ConnectorPunctuation,
    OtherPunctuation,
    Rest,
}

/// The first character of the run that has `character`, and what the run has in common.
fn properties(character: u32) -> (u32, u8) {
    let after = tables::PROPERTIES.partition_point(|&run| run >> 8 <= character);
    let run = tables::PROPERTIES[after - 1];
    (run >> 8, run as u8)
}

pub(crate) fn category(character: u32) -> Category {
    use Category::*;
    const ALL: [Category; 12] = [
        UppercaseLetter,
        LowercaseLetter,
        OtherLetter,
        LetterNumber,
        DecimalNumber,
        SpaceSeparator,
        OtherSeparator,
        Control,
        OtherOther,
        ConnectorPunctuation,
        OtherPunctuation,
        Rest,
    ];
    let (first, value) = properties(character);
    match ALL.get(usize::from(value & 15)) {
        Some(&category) => category,
        // Upper and lower case in turns.
        None => ALL[((character - first) % 2) as usize],
    }
}

/// A run is its first character, how many it has, how far they are apart, and how far they move. Neighbors trade places if they are 0 apart.
fn moved(runs: &[(u32, u8, u8, i32)], character: u32) -> u32 {
    let after = runs.partition_point(|run| run.0 <= character);
    let Some(&(first, count, stride, distance)) = runs[..after].last() else {
        return character;
    };
    let (offset, count) = (character - first, u32::from(count));
    match u32::from(stride) {
        0 if offset < count => first + (offset ^ 1),
        stride @ 1.. if offset % stride == 0 && offset / stride < count => {
            character.wrapping_add_signed(distance)
        }
        _ => character,
    }
}

/// `character`, and the others that a regular expression with the flag `i` takes for it.
pub(crate) fn cases(character: u32, is_unicode: bool) -> impl Iterator<Item = u32> {
    let runs = if is_unicode {
        tables::NEXT_CASE_UNICODE
    } else {
        tables::NEXT_CASE
    };
    core::iter::successors(Some(character), move |&case| {
        Some(moved(runs, case)).filter(|&next| next != character)
    })
}

#[inline(always)]
pub(crate) fn lower_latin1(character: u8) -> u8 {
    match character {
        b'A'..=b'Z' | 0xC0..=0xD6 | 0xD8..=0xDE => character + 0x20,
        _ => character,
    }
}

/// The lowest of [`cases`].
#[inline(always)]
pub(crate) fn fold_latin1(character: u8) -> u8 {
    match character {
        b'a'..=b'z' | 0xE0..=0xF6 | 0xF8..=0xFE => character - 0x20,
        _ => character,
    }
}

pub(crate) fn is_lead(unit: u16) -> bool {
    unit & 0xFC00 == 0xD800
}

pub(crate) fn is_trail(unit: u16) -> bool {
    unit & 0xFC00 == 0xDC00
}

pub(crate) fn from_surrogates(lead: u16, trail: u16) -> u32 {
    0x10000 + ((u32::from(lead) & 0x3FF) << 10) + (u32::from(trail) & 0x3FF)
}

/// The code point that `text` starts with, and what follows it.
fn split_first(text: &[u16]) -> Option<(u32, &[u16])> {
    match *text {
        [lead, trail, ref rest @ ..] if is_lead(lead) && is_trail(trail) => {
            Some((from_surrogates(lead, trail), rest))
        }
        [unit, ref rest @ ..] => Some((unit.into(), rest)),
        [] => None,
    }
}

const CAPITAL_I_WITH_DOT: u16 = 0x130;
const CAPITAL_SIGMA: u32 = 0x3A3;
const FINAL_SIGMA: u16 = 0x3C2;

/// `text.toLowerCase()`
pub(crate) fn lowered<'s>(text: &[u16], scratch: &'s mut Scratch) -> Result<&'s [u16], Failure> {
    let longer = text.iter().filter(|&&unit| unit == CAPITAL_I_WITH_DOT);
    let mut lower = scratch.room(text.len() + longer.count())?;
    append_lower(&mut lower.unfilled(), text);
    Ok(lower.into_filled())
}

/// `None` for a character that a sigma looks past, and else whether it is cased.
fn beside_sigma(character: u32) -> Option<bool> {
    match properties(character).1 >> 4 {
        2 => None,
        value => Some(value == 1),
    }
}

fn append_lower(to: &mut BorrowedCursor<'_, u16>, text: &[u16]) {
    let mut rest = text;
    // Up to here it is known whether a sigma would follow a cased character.
    let (mut seen, mut follows_cased) = (0, false);
    while let Some((character, after)) = split_first(rest) {
        if let Ok(latin1) = u8::try_from(character) {
            to.append(&[lower_latin1(latin1).into()]);
        } else if character == CAPITAL_I_WITH_DOT.into() {
            to.append(&[b'i'.into(), 0x307]);
        } else if character == CAPITAL_SIGMA {
            let at = text.len() - rest.len();
            let before = code_points(&text[seen..at]).filter_map(beside_sigma).last();
            let is_final = before.unwrap_or(follows_cased)
                && code_points(after).find_map(beside_sigma) != Some(true);
            to.append(&[FINAL_SIGMA + u16::from(!is_final)]);
            (seen, follows_cased) = (at + 1, true);
        } else {
            match moved(tables::LOWER_CASE, character) {
                lower @ ..=0xFFFF => to.append(&[lower as u16]),
                lower => to.append(&[
                    0xD7C0 + (lower >> 10) as u16,
                    0xDC00 | (lower & 0x3FF) as u16,
                ]),
            }
        }
        rest = after;
    }
}

pub(crate) fn code_points(mut text: &[u16]) -> impl Iterator<Item = u32> {
    core::iter::from_fn(move || {
        let (character, rest) = split_first(text)?;
        text = rest;
        Some(character)
    })
}
