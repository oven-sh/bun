//! What a locale calls languages, regions, scripts and calendars.

use core::ffi::{CStr, c_char};

use crate::argument::locale_id;
use crate::error::Status;
use crate::ffi::{filled, open};
use crate::{Buffer, Error, Result};

bun_opaque::opaque_ffi! { struct ULocaleDisplayNames; }

icu_functions! {
    fn uldn_openForContext(locale: *const c_char, contexts: *mut i32, count: i32, status: &mut Status) -> *mut ULocaleDisplayNames;
    fn uldn_close(names: *mut ULocaleDisplayNames);
    fn uldn_localeDisplayName(names: *const ULocaleDisplayNames, code: *const c_char, out: *mut u16, capacity: i32, status: &mut Status) -> i32;
    fn uldn_regionDisplayName(names: *const ULocaleDisplayNames, code: *const c_char, out: *mut u16, capacity: i32, status: &mut Status) -> i32;
    fn uldn_scriptDisplayName(names: *const ULocaleDisplayNames, code: *const c_char, out: *mut u16, capacity: i32, status: &mut Status) -> i32;
    fn uldn_keyValueDisplayName(
        names: *const ULocaleDisplayNames,
        key: *const c_char,
        value: *const c_char,
        out: *mut u16,
        capacity: i32,
        status: &mut Status,
    ) -> i32;
}

const UDISPCTX_CAPITALIZATION_FOR_STANDALONE: i32 = 0x104;
const UDISPCTX_NO_SUBSTITUTE: i32 = 0x301;

/// More than anything has that has a name.
const MAX_CODE_LENGTH: usize = 64;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(i32)]
pub enum Dialects {
    /// English (United Kingdom)
    Standard = 0,
    /// British English
    Named = 1,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(i32)]
pub enum Length {
    Full = 0x200,
    Short = 0x201,
}

icu_handle! {
    pub struct DisplayNames(ULocaleDisplayNames), uldn_close
}

impl DisplayNames {
    pub fn open(locale: &CStr, dialects: Dialects, length: Length) -> Result<DisplayNames> {
        let locale = locale_id(locale)?;
        let mut contexts = [
            dialects as i32,
            UDISPCTX_CAPITALIZATION_FOR_STANDALONE,
            length as i32,
            UDISPCTX_NO_SUBSTITUTE,
        ];
        // SAFETY: `locale` is terminated, and there are as many contexts, which are copied.
        open(|status| unsafe {
            uldn_openForContext(locale, contexts.as_mut_ptr(), contexts.len() as i32, status)
        })
        .map(DisplayNames)
    }

    pub fn of_locale(&self, code: &CStr) -> Result<Option<Buffer<u16>>> {
        if locale_id(code).is_err() {
            return Ok(None);
        }
        // SAFETY: the object is open, `code` is terminated, and `out` has room for `capacity`.
        name_of(code, |out, capacity, status| unsafe {
            uldn_localeDisplayName(self.0.as_ptr(), code.as_ptr(), out, capacity, status)
        })
    }

    pub fn of_region(&self, code: &CStr) -> Result<Option<Buffer<u16>>> {
        // SAFETY: the object is open, `code` is terminated, and `out` has room for `capacity`.
        name_of(code, |out, capacity, status| unsafe {
            uldn_regionDisplayName(self.0.as_ptr(), code.as_ptr(), out, capacity, status)
        })
    }

    pub fn of_script(&self, code: &CStr) -> Result<Option<Buffer<u16>>> {
        // SAFETY: the object is open, `code` is terminated, and `out` has room for `capacity`.
        name_of(code, |out, capacity, status| unsafe {
            uldn_scriptDisplayName(self.0.as_ptr(), code.as_ptr(), out, capacity, status)
        })
    }

    /// `code` is a value of the `calendar` keyword.
    pub fn of_calendar(&self, code: &CStr) -> Result<Option<Buffer<u16>>> {
        // SAFETY: the object is open, both strings are terminated, and `out` has room for `capacity`.
        name_of(code, |out, capacity, status| unsafe {
            uldn_keyValueDisplayName(
                self.0.as_ptr(),
                c"calendar".as_ptr(),
                code.as_ptr(),
                out,
                capacity,
                status,
            )
        })
    }
}

fn name_of(
    code: &CStr,
    function: impl FnMut(*mut u16, i32, &mut Status) -> i32,
) -> Result<Option<Buffer<u16>>> {
    if code.count_bytes() > MAX_CODE_LENGTH {
        return Ok(None);
    }
    match filled(function) {
        Err(Error::ILLEGAL_ARGUMENT) => Ok(None),
        name => name.map(Some),
    }
}
