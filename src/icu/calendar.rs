//! Calendar systems. Times are milliseconds since the epoch.

use core::ffi::{CStr, c_char};

use crate::argument::{locale_id, time_value, zone_id_length};
use crate::enumeration::UEnumeration;
use crate::error::Status;
use crate::ffi::{call, filled, open};
use crate::{Buffer, Enumeration, Result};

bun_opaque::opaque_ffi! { pub(crate) struct UCalendar; }

icu_functions! {
    fn ucal_open(zone: *const u16, length: i32, locale: *const c_char, kind: i32, status: &mut Status) -> *mut UCalendar;
    fn ucal_close(calendar: *mut UCalendar);
    fn ucal_clone(calendar: *const UCalendar, status: &mut Status) -> *mut UCalendar;
    fn ucal_setTimeZone(calendar: *mut UCalendar, zone: *const u16, length: i32, status: &mut Status);
    fn ucal_setGregorianChange(calendar: *mut UCalendar, time: f64, status: &mut Status);
    fn ucal_setMillis(calendar: *mut UCalendar, time: f64, status: &mut Status);
    fn ucal_get(calendar: *const UCalendar, field: Field, status: &mut Status) -> i32;
    fn ucal_getTimeZoneDisplayName(
        calendar: *const UCalendar,
        kind: ZoneName,
        locale: *const c_char,
        out: *mut u16,
        capacity: i32,
        status: &mut Status,
    ) -> i32;
    fn ucal_getKeywordValuesForLocale(key: *const c_char, locale: *const c_char, commonly_used: i8, status: &mut Status) -> *mut UEnumeration;
}

const UCAL_DEFAULT: i32 = 0;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(i32)]
pub enum Field {
    /// From zero.
    Month = 2,
    DayOfMonth = 5,
    DayOfYear = 6,
    ZoneOffset = 15,
    DaylightOffset = 16,
    ExtendedYear = 19,
    IsLeapMonth = 22,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(i32)]
pub enum ZoneName {
    Standard = 0,
    Daylight = 2,
}

icu_handle! {
    /// An instant and its fields, each computed from the other when it is read.
    pub struct Calendar(UCalendar), ucal_close
}

impl Calendar {
    /// The calendar system that `locale` names or prefers. A zone that ICU does not know has the offset zero.
    pub fn open(zone: &[u16], locale: &CStr) -> Result<Calendar> {
        let locale = locale_id(locale)?;
        let length = zone_id_length(zone)?;
        // SAFETY: `zone` has `length` units and `locale` is terminated. Both are copied.
        open(|status| unsafe { ucal_open(zone.as_ptr(), length, locale, UCAL_DEFAULT, status) })
            .map(Calendar)
    }

    pub(crate) fn as_mut_ptr(&mut self) -> *mut UCalendar {
        self.0.as_ptr()
    }

    pub fn try_clone(&self) -> Result<Calendar> {
        // SAFETY: the calendar is open.
        open(|status| unsafe { ucal_clone(self.0.as_ptr(), status) }).map(Calendar)
    }

    pub fn set_time_zone(&mut self, zone: &[u16]) -> Result<()> {
        let length = zone_id_length(zone)?;
        // SAFETY: the calendar is open, and `zone`, which is copied, has `length` units.
        call(|status| unsafe { ucal_setTimeZone(self.0.as_ptr(), zone.as_ptr(), length, status) })
    }

    /// Dates before `time` are Julian. `Error::UNSUPPORTED` unless the system is `gregorian` or `iso8601`.
    pub fn set_gregorian_change(&mut self, time: f64) -> Result<()> {
        let time = time_value(time)?;
        // SAFETY: the calendar is open.
        call(|status| unsafe { ucal_setGregorianChange(self.0.as_ptr(), time, status) })
    }

    pub fn set_millis(&mut self, time: f64) -> Result<()> {
        let time = time_value(time)?;
        // SAFETY: the calendar is open.
        call(|status| unsafe { ucal_setMillis(self.0.as_ptr(), time, status) })
    }

    pub fn get(&mut self, field: Field) -> Result<i32> {
        // SAFETY: the calendar is open.
        call(|status| unsafe { ucal_get(self.0.as_ptr(), field, status) })
    }

    /// The long name: `Pacific Standard Time`.
    pub fn zone_name(&self, kind: ZoneName, locale: &CStr) -> Result<Buffer<u16>> {
        let locale = locale_id(locale)?;
        // SAFETY: the calendar is open, `locale` is terminated, and `out` has room for `capacity`.
        filled(|out, capacity, status| unsafe {
            ucal_getTimeZoneDisplayName(self.0.as_ptr(), kind, locale, out, capacity, status)
        })
    }
}

/// The values of the `calendar` keyword that are in common use in the region of `locale`, the preferred one first.
pub fn common_systems(locale: &CStr) -> Result<Enumeration> {
    let locale = locale_id(locale)?;
    // SAFETY: both strings are terminated.
    Enumeration::open(|status| unsafe {
        ucal_getKeywordValuesForLocale(c"calendar".as_ptr(), locale, 1, status)
    })
}
