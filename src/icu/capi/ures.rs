//! `unicode/ures.h`

use crate::capi::ffi::{ErrorCode, Mut, NulStr, Out, Owned, Ref, UChar};
use crate::common::uresbund::{self, UResourceBundle};
use crate::common::utypes::*;
use bun_icu_macros::capi;
use std::ptr::null;

/// `path` is null, `locale_id` is not.
#[capi]
fn ures_open(path: NulStr<u8>, locale_id: NulStr<u8>, status: ErrorCode) -> *mut UResourceBundle {
    status.open(|cx, _| {
        let locale_id = cx.c_str(locale_id).filter(|_| path.is_null());
        uresbund::ures_open(None, locale_id.ok_or(U_UNSUPPORTED_ERROR)?)
    })
}

#[capi]
fn ures_close(bundle: Owned<UResourceBundle>) {
    bundle.close()
}

/// `fill_in` is null.
#[capi]
fn ures_getByKey(
    bundle: Ref<UResourceBundle>,
    key: NulStr<u8>,
    fill_in: Mut<UResourceBundle>,
    status: ErrorCode,
) -> *mut UResourceBundle {
    status.open(|cx, _| {
        let key = cx.c_str(key).filter(|_| fill_in.is_null());
        bundle.get()?.get_by_key(key.ok_or(U_UNSUPPORTED_ERROR)?)
    })
}

#[capi]
fn ures_getStringByKey(
    bundle: Ref<UResourceBundle>,
    key: NulStr<u8>,
    len: Out<i32>,
    status: ErrorCode,
) -> *const UChar {
    status.run(null(), |cx, _| {
        let (bundle, key) = (bundle.get()?, cx.c_str(key).ok_or(U_UNSUPPORTED_ERROR)?);
        let string = bundle.get_data_string_by_key(key);
        if matches!(string, Err(U_RESOURCE_TYPE_MISMATCH)) && bundle.find_by_key(key)?.is_alias() {
            cx.store(len, 0);
        }
        let string = string?;
        cx.store(len, string.units().len() as i32);
        Ok(string.as_ptr())
    })
}
