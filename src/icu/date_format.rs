//! Dates and times, written as a pattern says.

use core::ffi::{CStr, c_char, c_void};
use core::ptr;

use smallvec::{Array, SmallVec};

use crate::Result;
use crate::argument::{locale_id, pattern_length};
use crate::calendar::{Calendar, UCalendar};
use crate::date_pattern::Pattern;
use crate::error::Status;
use crate::ffi::{fill, open};
use crate::formatted_value::{FieldPositions, UFieldPositionIterator};

bun_opaque::opaque_ffi! { struct UDateFormat; }

icu_functions! {
    fn udat_open(
        time_style: i32,
        date_style: i32,
        locale: *const c_char,
        zone: *const u16,
        zone_length: i32,
        pattern: *const u16,
        pattern_length: i32,
        status: &mut Status,
    ) -> *mut UDateFormat;
    fn udat_close(format: *mut UDateFormat);
    fn udat_applyPattern(format: *mut UDateFormat, localized: i8, pattern: *const u16, length: i32);
    fn udat_toPattern(format: *const UDateFormat, localized: i8, out: *mut u16, capacity: i32, status: &mut Status) -> i32;
    fn udat_formatCalendar(
        format: *const UDateFormat,
        calendar: *mut UCalendar,
        out: *mut u16,
        capacity: i32,
        position: *mut c_void,
        status: &mut Status,
    ) -> i32;
    fn udat_formatCalendarForFields(
        format: *const UDateFormat,
        calendar: *mut UCalendar,
        out: *mut u16,
        capacity: i32,
        positions: *mut UFieldPositionIterator,
        status: &mut Status,
    ) -> i32;
}

const UDAT_NONE: i32 = -1;
const UDAT_PATTERN: i32 = -2;

/// The fields of `Category::DATE`, with the letters that stand for them in a pattern.
pub mod field {
    /// `G`
    pub const ERA: i32 = 0;
    /// `y`
    pub const YEAR: i32 = 1;
    /// `M`
    pub const MONTH: i32 = 2;
    /// `d`
    pub const DAY: i32 = 3;
    /// `k`
    pub const HOUR_1_TO_24: i32 = 4;
    /// `H`
    pub const HOUR_0_TO_23: i32 = 5;
    /// `m`
    pub const MINUTE: i32 = 6;
    /// `s`
    pub const SECOND: i32 = 7;
    /// `S`
    pub const FRACTIONAL_SECOND: i32 = 8;
    /// `E`
    pub const WEEKDAY: i32 = 9;
    /// `a`
    pub const AM_PM: i32 = 14;
    /// `h`
    pub const HOUR_1_TO_12: i32 = 15;
    /// `K`
    pub const HOUR_0_TO_11: i32 = 16;
    /// `z`
    pub const ZONE_SPECIFIC: i32 = 17;
    /// `Y`
    pub const YEAR_OF_WEEK: i32 = 18;
    /// `e`
    pub const LOCAL_WEEKDAY: i32 = 19;
    /// `u`
    pub const EXTENDED_YEAR: i32 = 20;
    /// `Z`
    pub const ZONE_RFC: i32 = 23;
    /// `v`
    pub const ZONE_GENERIC: i32 = 24;
    /// `c`
    pub const STANDALONE_WEEKDAY: i32 = 25;
    /// `L`
    pub const STANDALONE_MONTH: i32 = 26;
    /// `V`
    pub const ZONE_SPECIAL: i32 = 29;
    /// `U`
    pub const YEAR_NAME: i32 = 30;
    /// `O`
    pub const ZONE_LOCALIZED_OFFSET: i32 = 31;
    /// `X`
    pub const ZONE_ISO: i32 = 32;
    /// `x`
    pub const ZONE_ISO_LOCAL: i32 = 33;
    /// `r`
    pub const RELATED_YEAR: i32 = 34;
    /// `b`
    pub const AM_PM_NOON: i32 = 35;
    /// `B`
    pub const FLEXIBLE_DAY_PERIOD: i32 = 36;
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(i32)]
pub enum Style {
    Full = 0,
    Long = 1,
    Medium = 2,
    Short = 3,
}

icu_handle! {
    pub struct DateFormat(UDateFormat), udat_close
}

impl DateFormat {
    pub fn open(locale: &CStr, pattern: &[u16]) -> Result<DateFormat> {
        let locale = locale_id(locale)?;
        let length = pattern_length(pattern)?;
        // SAFETY: `locale` is terminated, `pattern`, which is copied, has `length` units, and the zone is optional.
        open(|status| unsafe {
            udat_open(
                UDAT_PATTERN,
                UDAT_PATTERN,
                locale,
                ptr::null(),
                0,
                pattern.as_ptr(),
                length,
                status,
            )
        })
        .map(DateFormat)
    }

    pub fn set_pattern(&mut self, pattern: &[u16]) -> Result<()> {
        let length = pattern_length(pattern)?;
        // SAFETY: the format is open, and `pattern`, which is copied, has `length` units.
        unsafe { udat_applyPattern(self.0.as_ptr(), 0, pattern.as_ptr(), length) };
        Ok(())
    }

    /// The instant that `calendar` is set to, in its zone. The calendar is one for the locale of the format. The text ends
    /// early if the calendar cannot compute its fields.
    pub fn format<A: Array<Item = u16>>(
        &self,
        calendar: &mut Calendar,
        out: &mut SmallVec<A>,
    ) -> Result<()> {
        // SAFETY: the format and the calendar are open, `out` has room for `capacity`, and the position is optional.
        fill(out, |out, capacity, status| unsafe {
            udat_formatCalendar(
                self.0.as_ptr(),
                calendar.as_mut_ptr(),
                out,
                capacity,
                ptr::null_mut(),
                status,
            )
        })
    }

    /// Fails where the text of `format` ends early. The fields come in the order of the text and do not overlap. One without
    /// text is left out.
    pub fn format_fields<A: Array<Item = u16>>(
        &self,
        calendar: &mut Calendar,
        out: &mut SmallVec<A>,
    ) -> Result<FieldPositions> {
        FieldPositions::collect(|positions| {
            // SAFETY: the format, the calendar and the list are open, and `out` has room for `capacity`.
            fill(out, |out, capacity, status| unsafe {
                udat_formatCalendarForFields(
                    self.0.as_ptr(),
                    calendar.as_mut_ptr(),
                    out,
                    capacity,
                    positions,
                    status,
                )
            })
        })
        .map(|((), positions)| positions)
    }
}

/// The standard pattern of a locale for a date, a time or both.
pub fn style_pattern(locale: &CStr, date: Option<Style>, time: Option<Style>) -> Result<Pattern> {
    let locale = locale_id(locale)?;
    let code = |style: Option<Style>| style.map_or(UDAT_NONE, |style| style as i32);
    // SAFETY: `locale` is terminated, the zone is optional, and the pattern is not read.
    let format = open(|status| unsafe {
        udat_open(
            code(time),
            code(date),
            locale,
            ptr::null(),
            0,
            ptr::null(),
            0,
            status,
        )
    })
    .map(DateFormat)?;
    let mut pattern = Pattern::new();
    // SAFETY: the format is open, and `out` has room for `capacity`.
    fill(&mut pattern, |out, capacity, status| unsafe {
        udat_toPattern(format.0.as_ptr(), 0, out, capacity, status)
    })?;
    Ok(pattern)
}
