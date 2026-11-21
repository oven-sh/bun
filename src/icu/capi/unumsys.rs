//! `unicode/unumsys.h`

use crate::capi::ffi::{ErrorCode, NulStr, Owned, Ref, UBool};
use crate::capi::uenum::{self, UEnumeration};
use crate::common::locid::Locale;
use crate::common::utypes::U_UNSUPPORTED_ERROR;
use crate::i18n::numsys::NumberingSystem;
use bun_icu_macros::capi;
use std::ffi::c_char;
use std::ptr::null;

pub(crate) type UNumberingSystem = NumberingSystem;

#[capi]
fn unumsys_open(locale: NulStr<u8>, status: ErrorCode) -> *mut UNumberingSystem {
    status.open(|cx, _| NumberingSystem::create_instance_for_locale(&Locale::new(cx.c_str(locale))))
}

#[capi]
fn unumsys_openByName(name: NulStr<u8>, status: ErrorCode) -> *mut UNumberingSystem {
    status.open(|cx, _| {
        NumberingSystem::create_instance_by_name(cx.c_str(name).ok_or(U_UNSUPPORTED_ERROR)?)
    })
}

#[capi]
fn unumsys_close(unumsys: Owned<UNumberingSystem>) {
    unumsys.close()
}

#[capi]
fn unumsys_openAvailableNames(status: ErrorCode) -> *mut UEnumeration {
    status.open(|_, _| uenum::open(NumberingSystem::get_available_names()?))
}

#[capi]
fn unumsys_getName(unumsys: Ref<UNumberingSystem>) -> *const c_char {
    unumsys
        .get()
        .map_or(null(), |unumsys| unumsys.get_name_c_str().as_ptr())
}

#[capi]
fn unumsys_isAlgorithmic(unumsys: Ref<UNumberingSystem>) -> UBool {
    unumsys
        .get()
        .map_or(0, |unumsys| UBool::from(unumsys.is_algorithmic()))
}
