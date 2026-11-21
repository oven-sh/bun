//! Likely subtags for locale IDs, and the region for supplemental data. ICU4C: loclikely.cpp

use crate::common::charstr::{ByteSink, SmallChars, via_byte_sink};
use crate::common::locid::Locale;
use crate::common::loclikelysubtags::{LikelySubtags, Lsr};
use crate::common::memory::fail_on_oom;
use crate::common::sink::CheckedArraySink;
use crate::common::slice_ext::SliceExt;
use crate::common::uloc::{
    Region, Subtags, append_subtags, uloc_get_country, ulocimp_canonicalize_to,
    ulocimp_get_keyword_value_to,
};
use crate::common::uloc_data::VALID_REGION_MAP;
use crate::common::utypes::*;

/// Writes the canonical ID with new subtags, which `replace` makes from the canonical ID and its old subtags.
fn replace_lsr(
    locale_id: &[u8],
    sink: &mut ByteSink,
    replace: fn(&[u8], Lsr) -> Result<Lsr, UErrorCode>,
) -> Result<(), UErrorCode> {
    let mut canonical = SmallChars::new();
    fail_on_oom(|| ulocimp_canonicalize_to(locale_id, &mut canonical))?;
    let (subtags, variant, trailing) = Subtags::parse_with_variant(&canonical)?;
    if variant.has_subtag_longer_than(8) {
        return Err(U_ILLEGAL_ARGUMENT_ERROR);
    }
    let lsr = Lsr {
        language: subtags.language(),
        script: subtags.script(),
        region: subtags.region(),
    };
    let Lsr {
        language,
        script,
        region,
    } = replace(&canonical, lsr)?;
    append_subtags(
        if *language == *b"und" { b"" } else { &language },
        &script,
        &region,
        &variant,
        sink,
    );
    sink.add_all(trailing);
    Ok(())
}

pub(crate) fn ulocimp_add_likely_subtags(locale_id: &[u8]) -> Result<Vec<u8>, UErrorCode> {
    via_byte_sink(|sink| ulocimp_add_likely_subtags_to(locale_id, sink))
}

pub(crate) fn ulocimp_add_likely_subtags_to(
    locale_id: &[u8],
    sink: &mut ByteSink,
) -> Result<(), UErrorCode> {
    replace_lsr(locale_id, sink, |locale_id, lsr| {
        if (lsr.language.len() == 4 && !lsr.script.is_empty()) || lsr.language.len() > 8 {
            return Err(U_ILLEGAL_ARGUMENT_ERROR);
        }
        // `Locale` parses some IDs differently from `Subtags`: "x-y" is a private use tag.
        LikelySubtags::get()?.make_maximized_lsr_from(&Locale::create_from_name(locale_id))
    })
}

pub(crate) fn ulocimp_minimize_subtags(locale_id: &[u8]) -> Result<Vec<u8>, UErrorCode> {
    via_byte_sink(|sink| ulocimp_minimize_subtags_to(locale_id, sink))
}

pub(crate) fn ulocimp_minimize_subtags_to(
    locale_id: &[u8],
    sink: &mut ByteSink,
) -> Result<(), UErrorCode> {
    replace_lsr(locale_id, sink, |_, lsr| {
        Ok(LikelySubtags::get()?.minimize_subtags(lsr))
    })
}

/// Returns the region of a subdivision value ("rg=uszzzz", "sd=usca"), or an empty region if it is not valid.
fn region_from_key(locale_id: &[u8], key: &[u8]) -> Result<Region, UErrorCode> {
    let mut start = [0; 2];
    let mut value = CheckedArraySink::new(&mut start);
    ulocimp_get_keyword_value_to(locale_id, key, &mut value)?;
    let is_valid_length = (3..=6).contains(&value.length());
    start.make_ascii_uppercase();
    Ok(if is_valid_length && is_valid_region(start) {
        Region::new(start)
    } else {
        Region::EMPTY
    })
}

/// Returns the first non-empty region of "rg", the subtag and, with `infer_region`, "sd" and the likely subtags.
pub(crate) fn ulocimp_get_region_for_supplemental_data(
    locale_id: &[u8],
    infer_region: bool,
) -> Result<Region, UErrorCode> {
    let mut region = region_from_key(locale_id, b"rg")?;
    if region.is_empty() {
        region = uloc_get_country(locale_id)?;
    }
    if region.is_empty() && infer_region {
        region = region_from_key(locale_id, b"sd")?;
        if region.is_empty() {
            let likely =
                ulocimp_add_likely_subtags(locale_id).and_then(|likely| uloc_get_country(&likely));
            region = likely.unwrap_or_default();
        }
    }
    Ok(region)
}

fn is_valid_region(upper: [u8; 2]) -> bool {
    let [first @ b'A'..=b'Z', second @ b'A'..=b'Z'] = upper else {
        return false;
    };
    let index = usize::from(first - b'A') * 26 + usize::from(second - b'A');
    VALID_REGION_MAP.at(index / 32) & (1 << (index % 32)) != 0
}
