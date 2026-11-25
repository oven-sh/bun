//! `unicode/ures.h`

use crate::capi::ffi::{ErrorCode, NonNullHandle, NulStr, Null, Out, UChar};
use crate::common::uresbund::{self, UResourceBundle};
use crate::common::utypes::*;
use bun_icu_macros::capi;
use std::ptr::null;

/// `path` is null, `locale_id` is not.
#[capi]
fn ures_open(
    path: NulStr<u8>,
    locale_id: NulStr<u8>,
    status: ErrorCode,
) -> Option<Box<UResourceBundle>> {
    status.open(|| {
        let locale_id = locale_id.get().filter(|_| path.is_null());
        uresbund::ures_open(None, locale_id.ok_or(U_UNSUPPORTED_ERROR)?)
    })
}

#[capi]
fn ures_close(bundle: Option<Box<UResourceBundle>>) {
    drop(bundle);
}

#[capi]
fn ures_getByKey(
    bundle: Option<&UResourceBundle>,
    key: NulStr<u8>,
    fill_in: Null,
    status: ErrorCode,
) -> Option<Box<UResourceBundle>> {
    status.open(|| {
        let key = key.get().filter(|_| fill_in.is_null());
        bundle
            .non_null()?
            .get_by_key(key.ok_or(U_UNSUPPORTED_ERROR)?)
    })
}

#[capi]
fn ures_getStringByKey(
    bundle: Option<&UResourceBundle>,
    key: NulStr<u8>,
    len: Out<i32>,
    status: ErrorCode,
) -> *const UChar {
    status.run(null(), |_| {
        let (bundle, key) = (bundle.non_null()?, key.get().ok_or(U_UNSUPPORTED_ERROR)?);
        let string = bundle.get_data_string_by_key(key);
        if matches!(string, Err(U_RESOURCE_TYPE_MISMATCH)) && bundle.find_by_key(key)?.is_alias() {
            len.set(0);
        }
        let string = string?;
        len.set(string.units().len() as i32);
        Ok(string.as_ptr())
    })
}
