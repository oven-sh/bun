//! `unicode/ucurr.h`

use crate::capi::ffi::{self, ErrorCode, NulStr, Out, UBool, UChar};
use crate::capi::uenum::{self, UEnumeration};
use crate::common::ucurr::{CurrencyName, ucurr_get_name, ucurr_open_iso_currencies};
use crate::common::unicode::ucurr::*;
use crate::common::utypes::*;
use bun_icu_macros::capi;
use std::ptr::{null, null_mut};

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
    ec.run(null(), |cx, ec| {
        let (Some(code), Some(locale), UCURR_SYMBOL_NAME..=UCURR_NARROW_SYMBOL_NAME) =
            (cx.str_up_to(currency, 3), cx.c_str(locale), name_style)
        else {
            return Err(U_UNSUPPORTED_ERROR);
        };
        let (name, length) = match ucurr_get_name(code, locale, name_style)? {
            CurrencyName::Name(name) => (name.as_ptr(), name.units().len()),
            CurrencyName::IsoCode(_) => {
                *ec = U_USING_DEFAULT_WARNING;
                let units = cx.until_nul(currency).into_iter().flatten();
                (currency.as_ptr(), units.count())
            }
        };
        cx.store(is_choice_format, 0);
        cx.store(len, ffi::to_int32(length));
        Ok(name)
    })
}

/// The only type is `UCURR_ALL`.
#[capi]
fn ucurr_openISOCurrencies(curr_type: u32, status: ErrorCode) -> *mut UEnumeration {
    if curr_type != UCURR_ALL {
        return status.run(null_mut(), |_, _| Err(U_UNSUPPORTED_ERROR));
    }
    status.open_always(|_| uenum::open_boxed(ucurr_open_iso_currencies()))
}
