//! `unicode/uenum.h`

use crate::capi::ffi::{ErrorCode, Out, UChar};
use crate::common::memory::{self, Appendable};
use crate::common::uenum::{self, Item, StringEnumeration};
use crate::common::uinvchar::uchar_to_char;
use crate::common::utypes::*;
use bun_icu_macros::capi;
use std::ffi::c_char;
use std::ptr::null;

pub(crate) struct UEnumeration {
    source: uenum::UEnumeration,
    /// The last string, if it had to be converted.
    chars: Vec<u8>,
}

pub(crate) fn open(source: uenum::UEnumeration) -> UEnumeration {
    let chars = Vec::new();
    UEnumeration { source, chars }
}

pub(crate) fn open_boxed(
    enumeration: impl StringEnumeration + 'static,
) -> Result<UEnumeration, UErrorCode> {
    Ok(open(memory::try_box(enumeration)?))
}

/// Returns the NUL-terminated copy and its length.
fn copy_as_chars(
    buffer: &mut Vec<u8>,
    string: impl ExactSizeIterator<Item = UChar>,
) -> Result<(*const u8, usize), UErrorCode> {
    const MIN_CAPACITY: usize = 32;
    let length = string.len();
    buffer.clear();
    buffer.reserve_append(MIN_CAPACITY.max(length + 1))?;
    buffer.add_each(string.map(uchar_to_char));
    buffer.add(0);
    Ok((buffer.as_ptr(), length))
}

#[capi]
fn uenum_close(en: Option<Box<UEnumeration>>) {
    drop(en);
}

/// Counts collation types, currencies, numbering systems and time zones.
#[capi]
fn uenum_count(en: Option<&UEnumeration>, status: ErrorCode) -> i32 {
    status.run(-1, |_| {
        en.map_or(Ok(-1), |en| Ok(en.source.count()? as i32))
    })
}

/// Takes only an enumeration of time zones.
#[capi]
fn uenum_unext(
    en: Option<&mut UEnumeration>,
    result_length: Out<i32>,
    status: ErrorCode,
) -> *const UChar {
    status.run(null(), |_| {
        match en.map_or(Ok(None), |en| en.source.next())? {
            Some(Item::Resource(s)) => {
                result_length.set(s.units().len() as i32);
                Ok(s.as_ptr())
            }
            Some(_) => Err(U_UNSUPPORTED_ERROR),
            None => Ok(null()),
        }
    })
}

#[capi]
fn uenum_next(
    en: Option<&mut UEnumeration>,
    result_length: Out<i32>,
    status: ErrorCode,
) -> *const c_char {
    status.run(null(), |_| {
        let Some(UEnumeration { source, chars }) = en else {
            return Ok(null());
        };
        result_length.set(0);
        let (string, length) = match source.next()? {
            Some(Item::Chars(s)) => (s.as_ptr().cast(), s.count_bytes()),
            Some(Item::Resource(s)) => copy_as_chars(chars, s.units().iter())?,
            None => return Ok(null()),
        };
        result_length.set(length as i32);
        Ok(string.cast())
    })
}
