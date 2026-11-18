//! Full case conversion, with the rules of the languages that have their own.

use core::ffi::{CStr, c_char};

use crate::argument::locale_id;
use crate::error::Status;
use crate::ffi::{fill, length};
use crate::{Buffer, Error, Result};

icu_functions! {
    fn u_strToLower(out: *mut u16, capacity: i32, text: *const u16, length: i32, locale: *const c_char, status: &mut Status) -> i32;
    fn u_strToUpper(out: *mut u16, capacity: i32, text: *const u16, length: i32, locale: *const c_char, status: &mut Status) -> i32;
}

/// A unit becomes at most three.
pub const MAX_TEXT_LENGTH: usize = 1 << 29;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Case {
    Lower,
    Upper,
}

impl Case {
    pub fn convert(self, text: &[u16], locale: &CStr) -> Result<Buffer<u16>> {
        let locale = locale_id(locale)?;
        if text.len() > MAX_TEXT_LENGTH {
            return Err(Error::MEMORY_ALLOCATION);
        }
        let function = match self {
            Case::Lower => u_strToLower,
            Case::Upper => u_strToUpper,
        };
        let length = length(text)?;
        let mut converted = Buffer::new();
        (converted.try_reserve_exact(text.len())).map_err(|_| Error::MEMORY_ALLOCATION)?;
        // SAFETY: `text` has `length` units, `locale` is terminated, and `out` has room for `capacity`.
        fill(&mut converted, |out, capacity, status| unsafe {
            function(out, capacity, text.as_ptr(), length, locale, status)
        })?;
        Ok(converted)
    }
}
