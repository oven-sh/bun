//! Case mapping and general categories of the Unicode version that Node bundles, which JSC, ICU and `core` do not follow.

use bun_core::strings;
use bun_core::vec::BorrowedCursor;

use crate::{Result, Scratch};

#[path = "unicode_tables.rs"]
mod tables;

pub(crate) use tables::Category;
use tables::{CASE_BLOCK_LEN, SigmaContext};

/// Lowercases to "k".
pub(crate) const KELVIN_SIGN: u32 = 0x212A;
/// Uppercases to "S".
pub(crate) const LONG_S: u32 = 0x17F;
const CAPITAL_I_WITH_DOT: u16 = 0x130;
const COMBINING_DOT_ABOVE: u16 = 0x307;
const CAPITAL_SIGMA: u16 = 0x3A3;
const SMALL_SIGMA: u16 = 0x3C3;
const FINAL_SIGMA: u16 = 0x3C2;

struct PropertyRun {
    first: u32,
    category: usize,
    sigma_context: usize,
}

fn property_run(code_point: u32) -> PropertyRun {
    let runs = tables::PROPERTY_RUNS;
    let run = runs[runs.partition_point(|&run| run >> tables::PROPERTY_BITS <= code_point) - 1];
    let properties = run as usize % (1 << tables::PROPERTY_BITS);
    PropertyRun {
        first: run >> tables::PROPERTY_BITS,
        category: properties % (1 << tables::CATEGORY_BITS),
        sigma_context: properties >> tables::CATEGORY_BITS,
    }
}

pub(crate) fn category(code_point: u32) -> Category {
    let run = property_run(code_point);
    if run.category != tables::ALTERNATING_CASE {
        tables::CATEGORIES[run.category]
    } else if (code_point - run.first).is_multiple_of(2) {
        Category::UppercaseLetter
    } else {
        Category::LowercaseLetter
    }
}

fn sigma_context(code_point: u32) -> SigmaContext {
    tables::SIGMA_CONTEXTS[property_run(code_point).sigma_context]
}

#[inline(always)]
fn map_case(map: &[u8], code_point: u32) -> u32 {
    let Some(&block) = map.get(code_point as usize / CASE_BLOCK_LEN) else {
        return code_point;
    };
    let at = block as usize * CASE_BLOCK_LEN + code_point as usize % CASE_BLOCK_LEN;
    code_point.wrapping_add_signed(tables::CASE_DELTAS[tables::CASE_BLOCKS[at] as usize])
}

/// `code_point` and everything else that it matches under the RegExp flag `i` or `iu`.
#[inline(always)]
pub(crate) fn case_variants(code_point: u32, is_unicode: bool) -> impl Iterator<Item = u32> {
    let map = if is_unicode {
        tables::NEXT_CASE_VARIANT_UNICODE
    } else {
        tables::NEXT_CASE_VARIANT
    };
    core::iter::successors(Some(code_point), move |&variant| {
        Some(map_case(map, variant)).filter(|&next| next != code_point)
    })
}

#[inline(always)]
pub(crate) fn to_lower_latin1(unit: u8) -> u8 {
    match unit {
        b'A'..=b'Z' | 0xC0..=0xD6 | 0xD8..=0xDE => unit + 0x20,
        _ => unit,
    }
}

/// The lowest of the [`case_variants`].
#[inline(always)]
pub(crate) fn fold_latin1(unit: u8) -> u8 {
    match unit {
        b'a'..=b'z' | 0xE0..=0xF6 | 0xF8..=0xFE => unit - 0x20,
        _ => unit,
    }
}

fn split_first_code_point(text: &[u16]) -> Option<(u32, &[u16])> {
    (!text.is_empty()).then(|| {
        let (code_point, len) = strings::decode_wtf16_raw(text);
        (code_point, &text[len.into()..])
    })
}

pub(crate) fn code_points(mut text: &[u16]) -> impl Iterator<Item = u32> {
    core::iter::from_fn(move || {
        let (code_point, rest) = split_first_code_point(text)?;
        text = rest;
        Some(code_point)
    })
}

/// `text.toLowerCase()`
pub(crate) fn to_lower_case<'s>(text: &[u16], scratch: &'s mut Scratch) -> Result<&'s [u16]> {
    let expanding = text.iter().filter(|&&unit| unit == CAPITAL_I_WITH_DOT);
    let mut lower = scratch.buffer(text.len() + expanding.count())?;
    append_lower_case(&mut lower.unfilled(), text);
    Ok(lower.into_filled())
}

/// The end of `text` that decides the last `len` units of `text.toLowerCase()`.
pub(crate) fn end_to_lower_case(text: &[u16], len: usize) -> &[u16] {
    // One more, which may be the first half of a pair.
    let end = &text[text.len().saturating_sub(len + 1)..];
    if end.contains(&CAPITAL_SIGMA) {
        text
    } else {
        end
    }
}

/// What the `Final_Sigma` condition looks at.
fn cased_or_other(text: &[u16]) -> impl Iterator<Item = SigmaContext> {
    let contexts = code_points(text).map(sigma_context);
    contexts.filter(|context| !matches!(context, SigmaContext::CaseIgnorable))
}

fn append_lower_case(to: &mut BorrowedCursor<'_, u16>, text: &[u16]) {
    let mut rest = text;
    // A sigma only looks back to the previous one, which is cased.
    let (mut look_back_start, mut follows_sigma) = (0, false);
    while let Some((code_point, after)) = split_first_code_point(rest) {
        if let Ok(latin1) = u8::try_from(code_point) {
            to.append(&[to_lower_latin1(latin1).into()]);
        } else if code_point == CAPITAL_I_WITH_DOT.into() {
            to.append(&[b'i'.into(), COMBINING_DOT_ABOVE]);
        } else if code_point == CAPITAL_SIGMA.into() {
            let at = text.len() - rest.len();
            let follows_cased = match cased_or_other(&text[look_back_start..at]).last() {
                Some(context) => matches!(context, SigmaContext::Cased),
                None => follows_sigma,
            };
            let is_final =
                follows_cased && !matches!(cased_or_other(after).next(), Some(SigmaContext::Cased));
            to.append(&[if is_final { FINAL_SIGMA } else { SMALL_SIGMA }]);
            (look_back_start, follows_sigma) = (at + 1, true);
        } else {
            match map_case(tables::LOWER_CASE, code_point) {
                lower @ ..=0xFFFF => to.append(&[lower as u16]),
                lower => to.append(&strings::encode_surrogate_pair(lower)),
            }
        }
        rest = after;
    }
}
