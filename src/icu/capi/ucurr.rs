//! `unicode/ucurr.h`

use crate::capi::ffi::{self, ErrorCode, NulStr, Out, UBool, UChar};
use crate::capi::uenum::{self, UEnumeration};
use crate::common::ucurr::{CurrencyName, ucurr_get_name, ucurr_open_iso_currencies};
use crate::common::unicode::ucurr::*;
use crate::common::utypes::*;
use bun_icu_macros::capi;
use std::ptr::null;

/// Takes the symbol, long or narrow style.
#[capi]
fn ucurr_getName(
    currency: NulStr<UChar>,
    locale: NulStr<u8>,
    name_style: UCurrNameStyle,
    is_choice_format: Out<UBool>,
    len: Out<i32>,
    ec: ErrorCode,
) -> *const UChar {
    ec.run(null(), |ec| {
        let (Some(code), Some(locale), UCURR_SYMBOL_NAME..=UCURR_NARROW_SYMBOL_NAME) =
            (currency.up_to(3), locale.get(), name_style)
        else {
            return Err(U_UNSUPPORTED_ERROR);
        };
        let (name, length) = match ucurr_get_name(code, locale, name_style)? {
            CurrencyName::Name(name) => (name.as_ptr(), name.units().len()),
            CurrencyName::IsoCode(_) => {
                *ec = U_USING_DEFAULT_WARNING;
                let units = currency.units().into_iter().flatten();
                (currency.as_ptr(), units.count())
            }
        };
        is_choice_format.set(0);
        len.set(ffi::to_int32(length));
        Ok(name)
    })
}

/// The only type is `UCURR_ALL`.
#[capi]
fn ucurr_openISOCurrencies(curr_type: u32, status: ErrorCode) -> Option<Box<UEnumeration>> {
    status.open(|| match curr_type {
        UCURR_ALL => uenum::open_boxed(ucurr_open_iso_currencies()),
        _ => Err(U_UNSUPPORTED_ERROR),
    })
}
