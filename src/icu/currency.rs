//! The currencies of ISO 4217.

use core::ffi::{CStr, c_char};

use crate::argument::locale_id;
use crate::enumeration::UEnumeration;
use crate::error::Status;
use crate::ffi::{borrowed, call};
use crate::{Enumeration, Result};

icu_functions! {
    fn ucurr_getName(
        currency: *const u16,
        locale: *const c_char,
        style: NameStyle,
        is_choice_format: &mut i8,
        length: &mut i32,
        status: &mut Status,
    ) -> *const u16;
    fn ucurr_openISOCurrencies(kinds: u32, status: &mut Status) -> *mut UEnumeration;
}

const UCURR_ALL: u32 = i32::MAX as u32;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(i32)]
pub enum NameStyle {
    Symbol = 0,
    Long = 1,
    NarrowSymbol = 2,
}

/// `code` is ASCII.
pub fn name(code: [u8; 3], locale: &CStr, style: NameStyle) -> Result<Option<&'static [u16]>> {
    let locale = locale_id(locale)?;
    let [first, second, third] = code.map(|letter| u16::from(letter & 0x7f));
    let code = [first, second, third, 0];
    let mut length = 0;
    // SAFETY: both strings are terminated.
    let name = call(|status| unsafe {
        ucurr_getName(code.as_ptr(), locale, style, &mut 0, &mut length, status)
    })?;
    if name == code.as_ptr() {
        return Ok(None);
    }
    // SAFETY: what is not the argument itself is part of data that stays loaded.
    Ok(Some(unsafe { borrowed(name, length) }))
}

/// Those that are no longer in use included.
pub fn all() -> Result<Enumeration> {
    // SAFETY: it takes flags and the status.
    Enumeration::open(|status| unsafe { ucurr_openISOCurrencies(UCURR_ALL, status) })
}
