//! Currencies. ICU4C: ucurr.cpp

use crate::common::charstr::SmallChars;
use crate::common::memory::{Appendable, fail_on_oom, try_to_vec};
use crate::common::slice_ext::{SoftUnwrap, to_index};
use crate::common::ucurr_data::CURRENCY_LIST;
use crate::common::uenum::{Item, StringEnumeration};
use crate::common::uinvchar::invariant_prefix;
use crate::common::uloc::{Subtag, ulocimp_get_name_to};
use crate::common::unicode::ucurr::*;
use crate::common::uresdata::DataString;
use crate::common::uresimp::*;
use crate::common::utypes::*;
use std::ffi::CStr;

fn key_of(currency: &[u16]) -> Subtag<3> {
    Subtag::new(invariant_prefix(currency.iter().copied()).map(|c| c.to_ascii_uppercase()))
}

pub(crate) enum CurrencyName<'a> {
    Name(DataString),
    /// The argument itself: the data have no name.
    IsoCode(&'a [u16]),
}

impl CurrencyName<'_> {
    pub(crate) fn try_to_vec(self) -> Result<Vec<u16>, UErrorCode> {
        match self {
            Self::Name(name) => name.units().try_to_vec(),
            Self::IsoCode(currency) => try_to_vec(currency),
        }
    }
}

fn normalized_name(locale: &[u8]) -> Result<SmallChars, UErrorCode> {
    let mut name = SmallChars::new();
    fail_on_oom(|| ulocimp_get_name_to(locale, &mut name)).map_err(|_| U_ILLEGAL_ARGUMENT_ERROR)?;
    Ok(name)
}

pub(crate) fn ucurr_get_name<'a>(
    currency: &'a [u16],
    locale: &[u8],
    style: UCurrNameStyle,
) -> Result<CurrencyName<'a>, UErrorCode> {
    let name = find_name(&normalized_name(locale)?, &key_of(currency), style);
    Ok((name.ok().flatten()).map_or(CurrencyName::IsoCode(currency), CurrencyName::Name))
}

fn find_name(
    locale: &[u8],
    key: &[u8],
    mut style: UCurrNameStyle,
) -> Result<Option<DataString>, UErrorCode> {
    let bundle = ures_open(Some(U_ICUDATA_CURR), locale)?;
    let table: &[u8] = match style {
        UCURR_NARROW_SYMBOL_NAME => b"Currencies%narrow/",
        UCURR_FORMAL_SYMBOL_NAME => b"Currencies%formal/",
        _ => b"",
    };
    if !table.is_empty() {
        let mut path = SmallChars::of(table);
        path.add_all(key);
        if let Ok(name) = bundle.get_string_by_key_with_fallback(&path) {
            return Ok(Some(name));
        }
        style = UCURR_SYMBOL_NAME;
    }
    let names = (bundle.get_by_key(b"Currencies")?).get_by_key_with_fallback(key)?;
    names.get_data_string_by_index(to_index(style))
}

pub(crate) fn ucurr_get_plural_name<'a>(
    currency: &'a [u16],
    locale: &[u8],
    plural_count: &[u8],
) -> Result<CurrencyName<'a>, UErrorCode> {
    find_plural_name(&normalized_name(locale)?, &key_of(currency), plural_count)
        .map(CurrencyName::Name)
        .or_else(|_| ucurr_get_name(currency, locale, UCURR_LONG_NAME))
}

fn find_plural_name(locale: &[u8], key: &[u8], count: &[u8]) -> Result<DataString, UErrorCode> {
    let plurals = ures_open(Some(U_ICUDATA_CURR), locale)?.get_by_key(b"CurrencyPlurals")?;
    let names = plurals.get_by_key_with_fallback(key)?;
    names
        .get_string_by_key_with_fallback(count)
        .or_else(|_| names.get_string_by_key_with_fallback(b"other"))
}

pub(crate) struct UCurrencyContext(std::slice::Iter<'static, [u8; 4]>);

impl StringEnumeration for UCurrencyContext {
    fn count(&self) -> Result<usize, UErrorCode> {
        Ok(CURRENCY_LIST.len())
    }

    fn next(&mut self) -> Result<Option<Item<'_>>, UErrorCode> {
        let code = self.0.next().map(|code| CStr::from_bytes_with_nul(code));
        Ok(code.map(|code| Item::Chars(code.ok().soft_unwrap())))
    }
}

pub(crate) fn ucurr_open_iso_currencies() -> UCurrencyContext {
    UCurrencyContext(CURRENCY_LIST.iter())
}
