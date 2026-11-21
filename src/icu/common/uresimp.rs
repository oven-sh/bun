//! What the other modules use of resource bundles. ICU4C: uresimp.h, ureslocs.h

use crate::common::bytes::U16s;
use crate::common::uresdata::DataString;
use crate::common::utypes::*;

pub(crate) use crate::common::uresbund::{
    ROOT_LOCALE_NAME, Tree, UResourceBundle, ures_get_all_children_with_fallback,
    ures_get_all_items_with_fallback, ures_get_calendar_type, ures_get_keyword_values, ures_open,
    ures_open_direct, ures_open_no_default,
};

pub(crate) const U_ICUDATA_LANG: &[u8] = b"lang";
pub(crate) const U_ICUDATA_REGION: &[u8] = b"region";
pub(crate) const U_ICUDATA_CURR: &[u8] = b"curr";
pub(crate) const U_ICUDATA_ZONE: &[u8] = b"zone";
pub(crate) const U_ICUDATA_UNIT: &[u8] = b"unit";
pub(crate) const U_ICUDATA_BRKITR: &[u8] = b"brkitr";
pub(crate) const U_ICUDATA_COLL: &[u8] = b"coll";
pub(crate) const U_ICUDATA_RBNF: &[u8] = b"rbnf";

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
