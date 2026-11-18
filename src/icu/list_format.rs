//! Lists: "a, b, and c".

use core::ffi::{CStr, c_char};

use smallvec::SmallVec;

use crate::argument::locale_id;
use crate::error::Status;
use crate::ffi::{call, length, open};
use crate::formatted_value::{FormattedValue, UFormattedValue};
use crate::{Error, Result};

bun_opaque::opaque_ffi! {
    struct UListFormatter;
    struct UFormattedList;
}

icu_functions! {
    fn ulistfmt_openForType(locale: *const c_char, kind: Kind, width: Width, status: &mut Status) -> *mut UListFormatter;
    fn ulistfmt_close(formatter: *mut UListFormatter);
    fn ulistfmt_openResult(status: &mut Status) -> *mut UFormattedList;
    fn ulistfmt_closeResult(result: *mut UFormattedList);
    fn ulistfmt_formatStringsToResult(
        formatter: *const UListFormatter,
        strings: *const *const u16,
        lengths: *const i32,
        count: i32,
        result: *mut UFormattedList,
        status: &mut Status,
    );
    fn ulistfmt_resultAsValue(result: *const UFormattedList, status: &mut Status) -> *const UFormattedValue;
}

/// More than a pattern adds to an element.
const MAX_LITERAL_LENGTH: usize = 32;
const MAX_TOTAL_LENGTH: usize = 1 << 29;

/// The field of `Category::LIST` that covers one of the strings.
pub const ELEMENT_FIELD: i32 = 1;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(i32)]
pub enum Kind {
    And = 0,
    Or = 1,
    Units = 2,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(i32)]
pub enum Width {
    Wide = 0,
    Short = 1,
    Narrow = 2,
}

icu_handle! {
    pub struct ListFormatter(UListFormatter), ulistfmt_close
}

icu_handle! {
    pub struct FormattedList(UFormattedList), ulistfmt_closeResult
}

impl ListFormatter {
    pub fn open(locale: &CStr, kind: Kind, width: Width) -> Result<ListFormatter> {
        let locale = locale_id(locale)?;
        // SAFETY: `locale` is terminated.
        open(|status| unsafe { ulistfmt_openForType(locale, kind, width, status) })
            .map(ListFormatter)
    }

    pub fn format<'a>(
        &self,
        strings: impl IntoIterator<Item = &'a [u16]>,
    ) -> Result<FormattedList> {
        let mut pointers = SmallVec::<[*const u16; 8]>::new();
        let mut lengths = SmallVec::<[i32; 8]>::new();
        let mut total_length = 0usize;
        for string in strings {
            total_length = total_length.saturating_add(string.len() + MAX_LITERAL_LENGTH);
            if total_length > MAX_TOTAL_LENGTH
                || pointers.try_reserve(1).is_err()
                || lengths.try_reserve(1).is_err()
            {
                return Err(Error::MEMORY_ALLOCATION);
            }
            pointers.push(string.as_ptr());
            lengths.push(length(string)?);
        }
        let count = length(&lengths)?;
        // SAFETY: it takes nothing but the status.
        let result = open(|status| unsafe { ulistfmt_openResult(status) }).map(FormattedList)?;
        // SAFETY: both objects are open, and there are `count` strings of these lengths, which are copied.
        call(|status| unsafe {
            ulistfmt_formatStringsToResult(
                self.0.as_ptr(),
                pointers.as_ptr(),
                lengths.as_ptr(),
                count,
                result.0.as_ptr(),
                status,
            )
        })?;
        Ok(result)
    }
}

impl FormattedList {
    pub fn value(&self) -> Result<FormattedValue<'_>> {
        // SAFETY: the result is open, and is formatted into only once.
        unsafe { FormattedValue::new(|status| ulistfmt_resultAsValue(self.0.as_ptr(), status)) }
    }
}
