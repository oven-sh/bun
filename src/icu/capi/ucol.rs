//! `unicode/ucol.h`

use crate::capi::ffi::{
    self, CallerMem, Dest, ErrorCode, MayAlias, Mut, NulStr, Out, Owned, Ref, Text, UBool, UChar,
};
use crate::capi::uenum::{self, UEnumeration};
use crate::capi::uset::USet;
use crate::common::uniset::UnicodeSet;
use crate::common::utypes::*;
use crate::i18n::collationsets::add_contractions_and_expansions;
use crate::i18n::rulebasedcollator::RuleBasedCollator;
use crate::i18n::unicode::ucol::*;
use crate::i18n::{coll, ucol_res};
use bun_icu_macros::capi;
use std::ffi::c_char;
use std::ptr::null;

pub(crate) type UCollator = RuleBasedCollator;

/// `loc` is not null.
#[capi]
fn ucol_open(loc: NulStr<u8>, status: ErrorCode) -> *mut UCollator {
    status.open(|cx, _| coll::open(cx.c_str(loc).ok_or(U_UNSUPPORTED_ERROR)?))
}

#[capi]
fn ucol_close(coll: Owned<UCollator>) {
    coll.close()
}

/// Accepts a strength up to tertiary, a case level only at primary strength, and normalization only on.
#[capi]
fn ucol_setAttribute(
    coll: Mut<UCollator>,
    attr: UColAttribute,
    value: UColAttributeValue,
    status: ErrorCode,
) {
    status.run((), |_, _| {
        let coll = coll.get_mut()?;
        match (attr, value) {
            (UCOL_STRENGTH, UCOL_QUATERNARY | UCOL_IDENTICAL)
            | (UCOL_NORMALIZATION_MODE, UCOL_OFF | UCOL_DEFAULT) => Err(U_UNSUPPORTED_ERROR),
            (UCOL_CASE_LEVEL, UCOL_ON) if coll.attribute(UCOL_STRENGTH)? != UCOL_PRIMARY => {
                Err(U_UNSUPPORTED_ERROR)
            }
            _ => coll.set_attribute(attr, value),
        }
    })
}

/// Accepts all attributes but `UCOL_HIRAGANA_QUATERNARY_MODE`.
#[capi]
fn ucol_getAttribute(
    coll: Ref<UCollator>,
    attr: UColAttribute,
    status: ErrorCode,
) -> UColAttributeValue {
    status.run_no_alloc(UCOL_DEFAULT, |_, _| coll.get()?.attribute(attr))
}

/// The capacity is 0.
#[capi]
fn ucol_getReorderCodes(coll: Ref<UCollator>, (dest, _): Dest<i32>, status: ErrorCode) -> i32 {
    status.run_no_alloc(0, |_, status| {
        if dest.capacity() != 0 {
            return Err(U_UNSUPPORTED_ERROR);
        }
        let count = coll.get()?.reorder_code_count();
        if count != 0 {
            *status = U_BUFFER_OVERFLOW_ERROR;
        }
        Ok(ffi::to_int32(count))
    })
}

/// `coll` has a strength and a case level that `ucol_setAttribute` accepts.
#[capi]
fn ucol_strcoll(
    cx: &CallerMem,
    coll: Ref<UCollator>,
    (source, _): Text<UChar>,
    (target, _): Text<UChar>,
) -> UCollationResult {
    let (Ok(coll), Ok([source, target])) = (coll.get(), cx.texts(source, target)) else {
        return UCOL_EQUAL;
    };
    let order = ffi::ignore_oom(|| coll.compare(source, target));
    debug_assert!(order != Err(U_UNSUPPORTED_ERROR));
    // After a failure the code units decide, so that only identical texts are equal.
    order.unwrap_or_else(|_| source.cmp(target)) as UCollationResult
}

/// `coll` has a strength and a case level that `ucol_setAttribute` accepts.
#[capi]
fn ucol_strcollUTF8(
    coll: Ref<UCollator>,
    (source, _): Text<u8>,
    (target, _): Text<u8>,
    status: ErrorCode,
) -> UCollationResult {
    status.run(UCOL_EQUAL, |cx, _| {
        let [source, target] = cx.texts(source, target)?;
        Ok(coll.get()?.compare(source, target)? as UCollationResult)
    })
}

#[capi]
fn ucol_getRules(cx: &mut CallerMem, coll: Ref<UCollator>, length: Out<i32>) -> *const UChar {
    coll.get().map_or(null(), |coll| {
        cx.store(length, ffi::to_int32(coll.rules().units().len()));
        coll.rules().as_ptr()
    })
}

/// `coll` has the root mappings.
#[capi]
fn ucol_getTailoredSet(coll: Ref<UCollator>, status: ErrorCode) -> *mut USet {
    status.open(|_, _| coll.get()?.root_data().map(|_| UnicodeSet::new()))
}

/// `coll` has the root mappings, the sets are distinct, and `add_prefixes` is true.
#[capi]
fn ucol_getContractionsAndExpansions(
    coll: Ref<UCollator>,
    contractions: Mut<USet>,
    expansions: MayAlias<Mut<USet>, USet>,
    add_prefixes: UBool,
    status: ErrorCode,
) {
    status.run((), |_, _| {
        let expansions = expansions.if_distinct(&contractions);
        let Some(expansions) = expansions.filter(|_| add_prefixes != 0) else {
            return Err(U_UNSUPPORTED_ERROR);
        };
        let (contractions, expansions) = (contractions.get_mut()?, expansions.get_mut()?);
        let data = coll.get()?.root_data()?;
        contractions.clear();
        expansions.clear();
        add_contractions_and_expansions(data, contractions, expansions)
    })
}

#[capi]
fn ucol_getAvailable(index: i32) -> *const c_char {
    ffi::on_oom(None, || coll::available_locales()?.key_at(index as usize))
        .map_or(null(), |name| name.as_c_str().as_ptr())
}

#[capi]
fn ucol_countAvailable() -> i32 {
    ffi::on_oom(None, coll::available_locales).map_or(0, |locales| locales.get_size() as i32)
}

#[capi]
fn ucol_getKeywordValues(keyword: NulStr<u8>, status: ErrorCode) -> *mut UEnumeration {
    status.open(|cx, _| match cx.c_str(keyword) {
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
) -> *mut UEnumeration {
    status.open(|cx, _| {
        let locale = cx.c_str(locale).ok_or(U_UNSUPPORTED_ERROR)?;
        uenum::open_boxed(ucol_res::keyword_values_for_locale(locale)?)
    })
}
