//! "in 2 days", "yesterday".

use core::ffi::{CStr, c_char, c_void};
use core::ptr;

use crate::argument::locale_id;
use crate::error::Status;
use crate::ffi::{call, open};
use crate::formatted_value::{FormattedValue, UFormattedValue};
use crate::{Error, Result};

bun_opaque::opaque_ffi! {
    struct UNumberFormat;
    struct URelativeDateTimeFormatter;
    struct UFormattedRelativeDateTime;
}

icu_functions! {
    fn unum_open(
        style: i32,
        pattern: *const u16,
        length: i32,
        locale: *const c_char,
        parse_error: *mut c_void,
        status: &mut Status,
    ) -> *mut UNumberFormat;
    fn unum_setAttribute(format: *mut UNumberFormat, attribute: i32, value: i32);
    fn ureldatefmt_open(
        locale: *const c_char,
        adopted: *mut UNumberFormat,
        style: Style,
        capitalization: i32,
        status: &mut Status,
    ) -> *mut URelativeDateTimeFormatter;
    fn ureldatefmt_close(formatter: *mut URelativeDateTimeFormatter);
    fn ureldatefmt_openResult(status: &mut Status) -> *mut UFormattedRelativeDateTime;
    fn ureldatefmt_closeResult(result: *mut UFormattedRelativeDateTime);
    fn ureldatefmt_formatToResult(
        formatter: *const URelativeDateTimeFormatter,
        offset: f64,
        unit: Unit,
        result: *mut UFormattedRelativeDateTime,
        status: &mut Status,
    );
    fn ureldatefmt_formatNumericToResult(
        formatter: *const URelativeDateTimeFormatter,
        offset: f64,
        unit: Unit,
        result: *mut UFormattedRelativeDateTime,
        status: &mut Status,
    );
    fn ureldatefmt_resultAsValue(result: *const UFormattedRelativeDateTime, status: &mut Status) -> *const UFormattedValue;
}

const UNUM_DECIMAL: i32 = 1;
const UNUM_GROUPING_USED: i32 = 1;
const UNUM_MIN_INTEGER_DIGITS: i32 = 4;
const UNUM_MAX_FRACTION_DIGITS: i32 = 6;
const UNUM_MIN_FRACTION_DIGITS: i32 = 7;
const UNUM_GROUPING_SIZE: i32 = 10;
const UNUM_ROUNDING_MODE: i32 = 11;
const UNUM_SECONDARY_GROUPING_SIZE: i32 = 15;
const UNUM_MINIMUM_GROUPING_DIGITS: i32 = 22;
const UNUM_ROUND_HALFUP: i32 = 6;
const GROUPING_OF_LOCALE: i32 = -2;
const UDISPCTX_CAPITALIZATION_FOR_STANDALONE: i32 = 0x104;

/// The field that covers the number.
pub const NUMERIC_FIELD: i32 = 1;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(i32)]
pub enum Style {
    Long = 0,
    Short = 1,
    Narrow = 2,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(i32)]
pub enum Unit {
    Year = 0,
    Quarter = 1,
    Month = 2,
    Week = 3,
    Day = 4,
    Hour = 5,
    Minute = 6,
    Second = 7,
}

icu_handle! {
    /// Writes at most three fraction digits, and rounds a tie away from zero.
    pub struct RelativeTimeFormatter(URelativeDateTimeFormatter), ureldatefmt_close
}

icu_handle! {
    /// Takes one result after another.
    pub struct FormattedRelativeTime(UFormattedRelativeDateTime), ureldatefmt_closeResult
}

type FormatToResult = unsafe extern "C" fn(
    *const URelativeDateTimeFormatter,
    f64,
    Unit,
    *mut UFormattedRelativeDateTime,
    &mut Status,
);

impl RelativeTimeFormatter {
    pub fn open(locale: &CStr, style: Style) -> Result<RelativeTimeFormatter> {
        let locale = locale_id(locale)?;
        // SAFETY: `locale` is terminated. The style takes no pattern, and the parse error is optional.
        let number_format = open(|status| unsafe {
            unum_open(
                UNUM_DECIMAL,
                ptr::null(),
                0,
                locale,
                ptr::null_mut(),
                status,
            )
        })?
        .as_ptr();
        for (attribute, value) in [
            (UNUM_MIN_INTEGER_DIGITS, 1),
            (UNUM_MIN_FRACTION_DIGITS, 0),
            (UNUM_MAX_FRACTION_DIGITS, 3),
            (UNUM_ROUNDING_MODE, UNUM_ROUND_HALFUP),
            (UNUM_GROUPING_USED, 1),
            (UNUM_GROUPING_SIZE, GROUPING_OF_LOCALE),
            (UNUM_SECONDARY_GROUPING_SIZE, GROUPING_OF_LOCALE),
            (UNUM_MINIMUM_GROUPING_DIGITS, GROUPING_OF_LOCALE),
        ] {
            // SAFETY: the format is open.
            unsafe { unum_setAttribute(number_format, attribute, value) };
        }
        // SAFETY: `locale` is terminated, and the format passes to ICU whether or not this succeeds.
        open(|status| unsafe {
            ureldatefmt_open(
                locale,
                number_format,
                style,
                UDISPCTX_CAPITALIZATION_FOR_STANDALONE,
                status,
            )
        })
        .map(RelativeTimeFormatter)
    }

    /// Prefers a phrase without a number. An offset that is close to an integer counts as that integer.
    pub fn format(
        &self,
        offset: f64,
        unit: Unit,
        result: &mut FormattedRelativeTime,
    ) -> Result<()> {
        self.format_with(ureldatefmt_formatToResult, offset, unit, result)
    }

    pub fn format_numeric(
        &self,
        offset: f64,
        unit: Unit,
        result: &mut FormattedRelativeTime,
    ) -> Result<()> {
        self.format_with(ureldatefmt_formatNumericToResult, offset, unit, result)
    }

    fn format_with(
        &self,
        function: FormatToResult,
        offset: f64,
        unit: Unit,
        result: &mut FormattedRelativeTime,
    ) -> Result<()> {
        if !offset.is_finite() {
            return Err(Error::ILLEGAL_ARGUMENT);
        }
        // SAFETY: both objects are open.
        call(|status| unsafe { function(self.0.as_ptr(), offset, unit, result.0.as_ptr(), status) })
    }
}

impl FormattedRelativeTime {
    pub fn open() -> Result<FormattedRelativeTime> {
        // SAFETY: it takes nothing but the status.
        open(|status| unsafe { ureldatefmt_openResult(status) }).map(FormattedRelativeTime)
    }

    pub fn value(&self) -> Result<FormattedValue<'_>> {
        // SAFETY: the result is open, and to format into it takes the borrow back.
        unsafe { FormattedValue::new(|status| ureldatefmt_resultAsValue(self.0.as_ptr(), status)) }
    }
}
