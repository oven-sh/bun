//! What the other modules use of resource bundles. ICU4C: uresimp.h, ureslocs.h

use crate::common::bytes::U16s;
use crate::common::uresdata::{DataKey, DataString};
use crate::common::utypes::*;

pub(crate) use crate::common::uresbund::{
    ROOT_LOCALE_NAME, Tree, UResourceBundle, ures_get_all_children_with_fallback,
    ures_get_all_items_with_fallback, ures_get_calendar_type, ures_get_keyword_values, ures_open,
    ures_open_direct, ures_open_no_default,
};

pub(crate) const U_ICUDATA_LANG: &[u8] = b"icudt79l-lang";
pub(crate) const U_ICUDATA_REGION: &[u8] = b"icudt79l-region";
pub(crate) const U_ICUDATA_CURR: &[u8] = b"icudt79l-curr";
pub(crate) const U_ICUDATA_ZONE: &[u8] = b"icudt79l-zone";
pub(crate) const U_ICUDATA_UNIT: &[u8] = b"icudt79l-unit";
pub(crate) const U_ICUDATA_BRKITR: &[u8] = b"icudt79l-brkitr";
pub(crate) const U_ICUDATA_COLL: &[u8] = b"icudt79l-coll";
pub(crate) const U_ICUDATA_RBNF: &[u8] = b"icudt79l-rbnf";

/// Returns the next string, or `None` if the item is not a string, and its key if `bundle` is a table.
pub(crate) fn ures_get_next_string(
    bundle: &mut UResourceBundle,
) -> Result<(Option<DataString>, Option<&'static [u8]>), UErrorCode> {
    let key = bundle.get_next_key().map(DataKey::as_bytes);
    let index = bundle.advance()?;
    Ok((bundle.get_data_string_by_index(index)?, key))
}

pub(crate) fn ures_get_next_unicode_string(
    bundle: &mut UResourceBundle,
) -> Result<(Vec<u16>, Option<&'static [u8]>), UErrorCode> {
    let (s, key) = ures_get_next_string(bundle)?;
    Ok((s.unwrap_or(DataString::EMPTY).units().try_to_vec()?, key))
}

pub(crate) fn ures_get_string_by_index(
    bundle: &UResourceBundle,
    index: usize,
) -> Result<Option<U16s<'static>>, UErrorCode> {
    Ok(bundle
        .get_data_string_by_index(index)?
        .map(DataString::units))
}

pub(crate) fn ures_get_data_string_by_index(
    bundle: &UResourceBundle,
    index: usize,
) -> Result<Option<DataString>, UErrorCode> {
    bundle.get_data_string_by_index(index)
}

pub(crate) fn ures_get_unicode_string_by_index(
    bundle: &UResourceBundle,
    index: usize,
) -> Result<Vec<u16>, UErrorCode> {
    ures_get_string_by_index(bundle, index)?
        .unwrap_or(U16s::EMPTY)
        .try_to_vec()
}

pub(crate) fn ures_get_string_by_key_with_fallback(
    bundle: &UResourceBundle,
    key: &[u8],
) -> Result<U16s<'static>, UErrorCode> {
    bundle
        .get_string_by_key_with_fallback(key)
        .map(DataString::units)
}
