//! `unicode/unumsys.h`

use crate::capi::ffi::{ErrorCode, NulStr, UBool};
use crate::capi::uenum::{self, UEnumeration};
use crate::common::locid::Locale;
use crate::common::utypes::U_UNSUPPORTED_ERROR;
use crate::i18n::numsys::NumberingSystem;
use bun_icu_macros::capi;
use std::ffi::c_char;
use std::ptr::null;

pub(crate) type UNumberingSystem = NumberingSystem;

#[capi]
fn unumsys_open(locale: NulStr<u8>, status: ErrorCode) -> Option<Box<UNumberingSystem>> {
    status.open(|| NumberingSystem::create_instance_for_locale(&Locale::new(locale.get())))
}

#[capi]
fn unumsys_openByName(name: NulStr<u8>, status: ErrorCode) -> Option<Box<UNumberingSystem>> {
    status.open(|| NumberingSystem::create_instance_by_name(name.get().ok_or(U_UNSUPPORTED_ERROR)?))
}

#[capi]
fn unumsys_close(unumsys: Option<Box<UNumberingSystem>>) {
    drop(unumsys);
}

#[capi]
fn unumsys_openAvailableNames(status: ErrorCode) -> Option<Box<UEnumeration>> {
    status.open(|| NumberingSystem::get_available_names().map(uenum::open))
}

#[capi]
fn unumsys_getName(unumsys: Option<&UNumberingSystem>) -> *const c_char {
    unumsys.map_or(null(), |unumsys| unumsys.get_name_c_str().as_ptr())
}

#[capi]
fn unumsys_isAlgorithmic(unumsys: Option<&UNumberingSystem>) -> UBool {
    unumsys.map_or(0, |unumsys| UBool::from(unumsys.is_algorithmic()))
}
