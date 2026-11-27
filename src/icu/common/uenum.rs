//! Enumerations of strings. ICU4C: uenum.cpp, strenum.h

use crate::common::uresdata::DataString;
use crate::common::utypes::{U_UNSUPPORTED_ERROR, UErrorCode};
use std::ffi::CStr;

/// A string as the enumeration stores it.
pub(crate) enum Item<'a> {
    Chars(&'a CStr),
    UChars(&'a [u16]),
    Resource(DataString),
}

pub(crate) trait StringEnumeration: Send + Sync {
    fn count(&self) -> Result<usize, UErrorCode> {
        Err(U_UNSUPPORTED_ERROR)
    }

    fn next(&mut self) -> Result<Option<Item<'_>>, UErrorCode>;
}

pub(crate) type UEnumeration = Box<dyn StringEnumeration>;
