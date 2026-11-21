//! Single values that the data have for a locale or a code. ICU4C: locresdata.cpp

use crate::common::bytes::U16s;
use crate::common::charstr::SmallChars;
use crate::common::uinvchar::invariant_chars;
use crate::common::uloc::{find_row, ulocimp_canonicalize_to};
use crate::common::uloc_data::DEPRECATED_COUNTRIES;
use crate::common::unicode::uloc::*;
use crate::common::uresimp::*;
use crate::common::utypes::*;

pub(crate) fn uloc_get_table_string_with_fallback(
    tree: Tree,
    locale: &[u8],
    table_key: &[u8],
    item_key: &[u8],
) -> Result<U16s<'static>, UErrorCode> {
    let table = ures_open(tree, locale)?.get_by_key_with_fallback(table_key);
    let table = table.or(Err(U_RESOURCE_TYPE_MISMATCH))?;
    ures_get_string_by_key_with_fallback(&table, item_key).or_else(|missing| {
        let current = find_row::<2, _>(DEPRECATED_COUNTRIES, item_key)
            .filter(|_| table_key == b"Countries")
            .ok_or(missing)?;
        ures_get_string_by_key_with_fallback(&table, current)
    })
}

pub(crate) fn uloc_get_character_orientation(locale_id: &[u8]) -> Result<ULayoutType, UErrorCode> {
    let mut canonical = SmallChars::new();
    ulocimp_canonicalize_to(locale_id, &mut canonical)?;
    let value = uloc_get_table_string_with_fallback(None, &canonical, b"layout", b"characters")?;
    match value.get(0).map(u8::try_from) {
        None => Ok(ULOC_LAYOUT_UNKNOWN),
        Some(Ok(b'b')) => Ok(ULOC_LAYOUT_BTT),
        Some(Ok(b'l')) => Ok(ULOC_LAYOUT_LTR),
        Some(Ok(b'r')) => Ok(ULOC_LAYOUT_RTL),
        Some(Ok(b't')) => Ok(ULOC_LAYOUT_TTB),
        Some(_) => Err(U_INTERNAL_PROGRAM_ERROR),
    }
}

/// Returns what replaces a deprecated code. `kind` is "language" or "territory". Spaces separate several successors.
pub(crate) fn find_replacement(kind: &[u8], code: &[u8]) -> Option<SmallChars> {
    let mut value = ures_open_direct(None, b"metadata").ok()?.get_value();
    for key in [b"alias", kind, code, b"replacement"] {
        value = value.get_table().ok()?.get(key)?;
    }
    invariant_chars(value.get_string().ok()?.iter()).ok()
}
