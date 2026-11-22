//! Currencies. ICU4C: ucurr.cpp

use crate::common::charstr::SmallChars;
use crate::common::cstring::until_nul;
use crate::common::loclikely::ulocimp_get_region_for_supplemental_data;
use crate::common::memory::{Appendable, fail_on_oom, try_to_vec};
use crate::common::slice_ext::{SoftUnwrap, to_index};
use crate::common::ucurr_data::CURRENCY_LIST;
use crate::common::uenum::{Item, StringEnumeration};
use crate::common::uinvchar::invariant_prefix;
use crate::common::uloc::{Subtag, ulocimp_get_keyword_value_to, ulocimp_get_name_to};
use crate::common::unicode::ucurr::*;
use crate::common::uresdata::DataString;
use crate::common::uresimp::*;
use crate::common::utypes::*;
use std::ffi::CStr;

/// Ends at the first character that is not invariant.
fn key_of(currency: &[u16]) -> Subtag<3> {
    Subtag::new(invariant_prefix(currency.iter().copied()))
}

fn upper_key_of(currency: &[u16]) -> Subtag<3> {
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
            Self::IsoCode(currency) => try_to_vec(until_nul(currency)),
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
    let name = find_name(&normalized_name(locale)?, &upper_key_of(currency), style);
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
        match bundle.get_string_by_key_with_fallback(&path) {
            Err(U_MISSING_RESOURCE_ERROR) => style = UCURR_SYMBOL_NAME,
            found => return found.map(Some),
        }
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

fn supplemental_data(key: &[u8]) -> Result<UResourceBundle, UErrorCode> {
    ures_open_direct(Some(U_ICUDATA_CURR), b"supplementalData")?.get_by_key(key)
}

/// Returns the keyword "currency", else the first currency of the region that is legal tender, else its first one.
pub(crate) fn ucurr_for_locale(locale: &[u8]) -> Result<[u16; 3], UErrorCode> {
    let mut keyword = SmallChars::new();
    if ulocimp_get_keyword_value_to(locale, b"currency", &mut keyword).is_ok()
        && let [a, b, c] = *keyword
    {
        return Ok([a, b, c].map(|c| c.to_ascii_uppercase().into()));
    }
    let region = ulocimp_get_region_for_supplemental_data(locale, false)?;
    if region.is_empty() {
        return Err(U_MISSING_RESOURCE_ERROR);
    }
    let entries = supplemental_data(b"CurrencyMap")?.get_by_key(&region)?;
    let mut found = None;
    for index in 0..entries.get_size() {
        let entry = entries.get_by_index(index)?;
        let id = entry.get_string_by_key(b"id").ok();
        let Some(id) = id.filter(|id| id.len() == 3) else {
            continue;
        };
        let (code, tender) = (
            [0, 1, 2].map(|i| id.at(i)),
            entry.get_string_by_key(b"tender"),
        );
        if !tender.is_ok_and(|tender| tender.eq_bytes(b"false")) {
            return Ok(code);
        }
        found.get_or_insert(code);
    }
    found.ok_or(U_MISSING_RESOURCE_ERROR)
}

/// Returns the fraction digits and the rounding increment in units of the last digit.
fn find_meta_data(currency: &[u16]) -> Result<(i32, i32), UErrorCode> {
    let all = supplemental_data(b"CurrencyMeta")?;
    let data = (all.get_by_key(&key_of(currency))).or_else(|_| all.get_by_key(b"DEFAULT"))?;
    let data = data.get_int_vector()?;
    if data.len() == 4 {
        Ok((data.at(0), data.at(1)))
    } else {
        Err(U_INVALID_FORMAT_ERROR)
    }
}

pub(crate) fn ucurr_get_default_fraction_digits(currency: &[u16]) -> Result<i32, UErrorCode> {
    find_meta_data(currency).map(|(digits, _)| digits)
}

pub(crate) fn ucurr_get_rounding_increment(currency: &[u16]) -> Result<f64, UErrorCode> {
    match find_meta_data(currency)? {
        (digits @ 0..=9, increment @ 2..) => {
            Ok(f64::from(increment) / f64::from(10_i32.pow(digits as u32)))
        }
        (0..=9, _) => Ok(0.0),
        _ => Err(U_INVALID_FORMAT_ERROR),
    }
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
