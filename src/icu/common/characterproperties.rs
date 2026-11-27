//! Cached sets: the code points at which a property can change, and those that have it. ICU4C: characterproperties.cpp

use crate::common::emojiprops;
use crate::common::normalizer2::{get_nfkc_cf_impl, get_nfkc_impl};
use crate::common::normalizer2impl::{NFC, canon_segment_starters};
use crate::common::slice_ext::to_index;
use crate::common::ubidi_props::ubidi_add_property_starts;
use crate::common::ucase;
use crate::common::uchar::{
    ublock_add_property_starts, uchar_add_property_starts, upropsvec_add_property_starts,
};
use crate::common::umutex::OnceBox;
use crate::common::unicode::uchar::*;
use crate::common::uniset::{MAX_VALUE, UnicodeSet};
use crate::common::uprops::*;
use crate::common::utypes::{U_ILLEGAL_ARGUMENT_ERROR, UErrorCode};

type CachedSet = OnceBox<Result<UnicodeSet, UErrorCode>>;

// ICU4C: characterproperties.cpp, initInclusion
fn make_source_inclusions(src: UPropertySource) -> Result<UnicodeSet, UErrorCode> {
    use UPropertySource::*;
    let mut inclusions = UnicodeSet::new();
    let sa = &mut inclusions;
    let mut add_layout_starts =
        |which| layout_trie(which).map(|trie| trie.range_starts().for_each(|c| sa.add(c)));
    match src {
        Inpc => add_layout_starts(UCHAR_INDIC_POSITIONAL_CATEGORY)?,
        Insc => add_layout_starts(UCHAR_INDIC_SYLLABIC_CATEGORY)?,
        Vo => add_layout_starts(UCHAR_VERTICAL_ORIENTATION)?,
        Char => uchar_add_property_starts(sa),
        PropsVec => upropsvec_add_property_starts(sa),
        CharAndPropsVec => {
            uchar_add_property_starts(sa);
            upropsvec_add_property_starts(sa);
        }
        CaseAndNorm => {
            NFC.add_property_starts(sa);
            ucase::add_property_starts(sa);
        }
        Nfc => NFC.add_property_starts(sa),
        Nfkc => get_nfkc_impl()?.add_property_starts(sa),
        NfkcCf => get_nfkc_cf_impl()?.add_property_starts(sa),
        Case => ucase::add_property_starts(sa),
        Bidi => ubidi_add_property_starts(sa),
        IdCompatMath => add_id_compat_math_starts(sa),
        Mcm => add_modifier_combining_mark_starts(sa),
        Emoji => emojiprops::add_property_starts(sa)?,
        Idsu => {
            sa.add(0x2ffe);
            sa.add(0x2fff + 1);
        }
        Block => ublock_add_property_starts(sa),
    }
    Ok(inclusions)
}

#[expect(
    clippy::indexing_slicing,
    reason = "the array has an element for each variant"
)]
fn inclusions_for_source(src: UPropertySource) -> Result<&'static UnicodeSet, UErrorCode> {
    static CACHE: [CachedSet; UPropertySource::COUNT] = [const { OnceBox::new() }; _];
    CACHE[src as usize].get_or_init_caching_err(|| make_source_inclusions(src))
}

/// Returns U+0000 and the code points at which the value of `prop` changes.
fn make_int_property_inclusions(prop: UProperty) -> Result<UnicodeSet, UErrorCode> {
    let (mut inclusions, mut previous) = (UnicodeSet::new(), 0);
    inclusions.add(0);
    for c in inclusions_for_source(uprops_get_source(prop))?.code_points() {
        let value = u_get_int_property_value(c, prop);
        if value != previous {
            inclusions.add(c);
            previous = value;
        }
    }
    Ok(inclusions)
}

/// Returns the code points for which `contains`, a test of the value of `prop`, is true.
pub(crate) fn set_by_filter(
    prop: UProperty,
    contains: &dyn Fn(u32) -> bool,
) -> Result<UnicodeSet, UErrorCode> {
    static CACHE: [CachedSet; (UCHAR_INT_LIMIT - UCHAR_INT_START) as usize] =
        [const { OnceBox::new() }; _];
    let inclusions = match CACHE.get(to_index(prop - UCHAR_INT_START)) {
        Some(cached) => cached.get_or_init_caching_err(|| make_int_property_inclusions(prop)),
        None => inclusions_for_source(uprops_get_source(prop)),
    };
    let (mut set, mut start) = (UnicodeSet::new(), None);
    for c in inclusions?.code_points() {
        if contains(c) {
            start.get_or_insert(c);
        } else if let Some(start) = start.take() {
            set.add_range(start, c - 1);
        }
    }
    if let Some(start) = start {
        set.add_range(start, MAX_VALUE);
    }
    Ok(set)
}

/// Has no strings.
pub(crate) fn binary_property_set(property: UProperty) -> Result<&'static UnicodeSet, UErrorCode> {
    static CACHE: [CachedSet; UCHAR_BINARY_LIMIT as usize] = [const { OnceBox::new() }; _];
    let cached = CACHE.get(to_index(property));
    cached
        .ok_or(U_ILLEGAL_ARGUMENT_ERROR)?
        .get_or_init_caching_err(|| match property {
            UCHAR_SEGMENT_STARTER => Ok(canon_segment_starters()),
            _ => set_by_filter(property, &|c| u_has_binary_property(c, property)),
        })
}
