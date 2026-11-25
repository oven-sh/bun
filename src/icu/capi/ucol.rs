//! `unicode/ucol.h`

use crate::capi::ffi::{self, Dest, ErrorCode, NonNullHandle, NulStr, Out, Text, UBool, UChar};
use crate::capi::uenum::{self, UEnumeration};
use crate::capi::uset::USet;
use crate::common::utypes::*;
use crate::i18n::coll::{self, AvailableLocales};
use crate::i18n::collationsets::{add_contractions_and_expansions, tailored_set};
use crate::i18n::rulebasedcollator::RuleBasedCollator;
use crate::i18n::ucol_res;
use crate::i18n::unicode::ucol::*;
use bun_icu_macros::capi;
use std::ffi::{CStr, c_char};
use std::ptr::null;

pub(crate) type UCollator = RuleBasedCollator;

/// `loc` is not null.
#[capi]
fn ucol_open(loc: NulStr<u8>, status: ErrorCode) -> Option<Box<UCollator>> {
    status.open(|| coll::open(loc.get().ok_or(U_UNSUPPORTED_ERROR)?))
}

#[capi]
fn ucol_close(coll: Option<Box<UCollator>>) {
    drop(coll);
}

/// Accepts normalization only on.
#[capi]
fn ucol_setAttribute(
    coll: Option<&mut UCollator>,
    attr: UColAttribute,
    value: UColAttributeValue,
    status: ErrorCode,
) {
    status.run((), |_| match (attr, value) {
        (UCOL_NORMALIZATION_MODE, UCOL_OFF | UCOL_DEFAULT) => Err(U_UNSUPPORTED_ERROR),
        _ => coll.non_null()?.set_attribute(attr, value),
    })
}

/// Accepts all attributes but `UCOL_HIRAGANA_QUATERNARY_MODE`.
#[capi]
fn ucol_getAttribute(
    coll: Option<&UCollator>,
    attr: UColAttribute,
    status: ErrorCode,
) -> UColAttributeValue {
    status.run_no_alloc(UCOL_DEFAULT, |_| coll.non_null()?.attribute(attr))
}

/// The capacity is 0.
#[capi]
fn ucol_getReorderCodes(coll: Option<&UCollator>, (dest, _): Dest<i32>, status: ErrorCode) -> i32 {
    status.run_no_alloc(0, |status| {
        if dest.capacity() != 0 {
            return Err(U_UNSUPPORTED_ERROR);
        }
        let count = coll.non_null()?.reorder_code_count();
        if count != 0 {
            *status = U_BUFFER_OVERFLOW_ERROR;
        }
        Ok(ffi::to_int32(count))
    })
}

/// Normalizes the texts, whether or not `coll` has `UCOL_NORMALIZATION_MODE` on.
#[capi]
fn ucol_strcoll(
    coll: Option<&UCollator>,
    (source, _): Text<UChar>,
    (target, _): Text<UChar>,
) -> UCollationResult {
    let (Some(coll), Ok(source), Ok(target)) = (coll, source.get(), target.get()) else {
        return UCOL_EQUAL;
    };
    let order = ffi::ignore_oom(|| coll.compare(source, target));
    // After a failure the code units decide, so that only identical texts are equal.
    order.unwrap_or_else(|_| source.cmp(target) as UCollationResult)
}

/// Normalizes the texts too.
#[capi]
fn ucol_strcollUTF8(
    coll: Option<&UCollator>,
    (source, _): Text<u8>,
    (target, _): Text<u8>,
    status: ErrorCode,
) -> UCollationResult {
    status.run(UCOL_EQUAL, |_| {
        let (source, target) = (source.get()?, target.get()?);
        coll.non_null()?.compare(source, target)
    })
}

#[capi]
fn ucol_getRules(coll: Option<&UCollator>, length: Out<i32>) -> *const UChar {
    coll.map_or(null(), |coll| {
        length.set(ffi::to_int32(coll.rules().units().len()));
        coll.rules().as_ptr()
    })
}

#[capi]
fn ucol_getTailoredSet(coll: Option<&UCollator>, status: ErrorCode) -> Option<Box<USet>> {
    status.open(|| tailored_set(coll.non_null()?.data()))
}

/// The sets are distinct, and `add_prefixes` is true.
#[capi]
fn ucol_getContractionsAndExpansions(
    coll: Option<&UCollator>,
    contractions: Option<&mut USet>,
    expansions: Option<&mut USet>,
    add_prefixes: UBool,
    status: ErrorCode,
) {
    status.run((), |_| {
        if add_prefixes == 0 {
            return Err(U_UNSUPPORTED_ERROR);
        }
        let (contractions, expansions) = (contractions.non_null()?, expansions.non_null()?);
        let data = coll.non_null()?.data();
        contractions.clear();
        expansions.clear();
        add_contractions_and_expansions(data, contractions, expansions)
    })
}

#[capi]
fn ucol_getAvailable(index: i32) -> *const c_char {
    ffi::on_oom(None, || AvailableLocales::load()?.get(index as usize)).map_or(null(), CStr::as_ptr)
}

#[capi]
fn ucol_countAvailable() -> i32 {
    ffi::on_oom(None, AvailableLocales::load).map_or(0, |locales| ffi::to_int32(locales.count()))
}

#[capi]
fn ucol_getKeywordValues(keyword: NulStr<u8>, status: ErrorCode) -> Option<Box<UEnumeration>> {
    status.open(|| match keyword.get() {
        Some(b"collation") => uenum::open_boxed(ucol_res::keyword_values()?),
        _ => Err(U_ILLEGAL_ARGUMENT_ERROR),
    })
}

/// `locale` is not null.
#[capi]
fn ucol_getKeywordValuesForLocale(
    _key: NulStr<u8>,
    locale: NulStr<u8>,
    _commonly_used: UBool,
    status: ErrorCode,
) -> Option<Box<UEnumeration>> {
    status.open(|| {
        let locale = locale.get().ok_or(U_UNSUPPORTED_ERROR)?;
        uenum::open_boxed(ucol_res::keyword_values_for_locale(locale)?)
    })
}
