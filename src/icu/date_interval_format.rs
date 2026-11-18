//! Ranges of dates and times: "Jan 10 – 12, 2007".

use core::ffi::{CStr, c_char};
use core::ptr;

use crate::Result;
use crate::argument::{locale_id, pattern_length};
use crate::calendar::{Calendar, UCalendar};
use crate::error::Status;
use crate::ffi::{call, open};
use crate::formatted_value::{FormattedValue, UFormattedValue};

bun_opaque::opaque_ffi! {
    struct UDateIntervalFormat;
    struct UFormattedDateInterval;
}

icu_functions! {
    fn udtitvfmt_open(
        locale: *const c_char,
        skeleton: *const u16,
        skeleton_length: i32,
        zone: *const u16,
        zone_length: i32,
        status: &mut Status,
    ) -> *mut UDateIntervalFormat;
    fn udtitvfmt_close(format: *mut UDateIntervalFormat);
    fn udtitvfmt_openResult(status: &mut Status) -> *mut UFormattedDateInterval;
    fn udtitvfmt_closeResult(result: *mut UFormattedDateInterval);
    fn udtitvfmt_formatCalendarToResult(
        format: *const UDateIntervalFormat,
        start: *mut UCalendar,
        end: *mut UCalendar,
        result: *mut UFormattedDateInterval,
        status: &mut Status,
    );
    fn udtitvfmt_resultAsValue(result: *const UFormattedDateInterval, status: &mut Status) -> *const UFormattedValue;
}

icu_handle! {
    pub struct DateIntervalFormat(UDateIntervalFormat), udtitvfmt_close
}

icu_handle! {
    pub struct FormattedDateInterval(UFormattedDateInterval), udtitvfmt_closeResult
}

impl DateIntervalFormat {
    pub fn open(locale: &CStr, skeleton: &[u16]) -> Result<DateIntervalFormat> {
        let locale = locale_id(locale)?;
        let length = pattern_length(skeleton)?;
        // SAFETY: `locale` is terminated, `skeleton`, which is copied, has `length` units, and the zone is optional.
        open(|status| unsafe {
            udtitvfmt_open(locale, skeleton.as_ptr(), length, ptr::null(), 0, status)
        })
        .map(DateIntervalFormat)
    }

    /// The calendars differ only in the instant that they are set to. The result has no `Category::DATE_INTERVAL_SPAN` if
    /// it shows a single date.
    pub fn format(
        &self,
        start: &mut Calendar,
        end: &mut Calendar,
    ) -> Result<FormattedDateInterval> {
        // SAFETY: it takes nothing but the status.
        let result =
            open(|status| unsafe { udtitvfmt_openResult(status) }).map(FormattedDateInterval)?;
        // SAFETY: all four objects are open.
        call(|status| unsafe {
            udtitvfmt_formatCalendarToResult(
                self.0.as_ptr(),
                start.as_mut_ptr(),
                end.as_mut_ptr(),
                result.0.as_ptr(),
                status,
            )
        })?;
        Ok(result)
    }
}

impl FormattedDateInterval {
    pub fn value(&self) -> Result<FormattedValue<'_>> {
        // SAFETY: the result is open, and is formatted into only once.
        unsafe { FormattedValue::new(|status| udtitvfmt_resultAsValue(self.0.as_ptr(), status)) }
    }
}
