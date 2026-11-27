//! `unicode/utypes.h`

use crate::common::UErrorCode;
use bun_icu_macros::capi;
use std::ffi::c_char;

#[capi]
fn u_errorName(code: UErrorCode) -> *const c_char {
    code.c_name().as_ptr()
}
