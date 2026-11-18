//! The patterns of date formats (UTS #35, part 4), and their skeletons: the fields without order or literal text.

use core::ffi::{CStr, c_char};
use core::ptr;

use smallvec::SmallVec;

use crate::argument::{locale_id, pattern_length};
use crate::error::Status;
use crate::ffi::{fill, filled, open};
use crate::{Buffer, Result};

bun_opaque::opaque_ffi! { struct UDateTimePatternGenerator; }

icu_functions! {
    fn udatpg_open(locale: *const c_char, status: &mut Status) -> *mut UDateTimePatternGenerator;
    fn udatpg_close(generator: *mut UDateTimePatternGenerator);
    fn udatpg_getBestPatternWithOptions(
        generator: *mut UDateTimePatternGenerator,
        skeleton: *const u16,
        length: i32,
        options: i32,
        out: *mut u16,
        capacity: i32,
        status: &mut Status,
    ) -> i32;
    fn udatpg_getSkeleton(
        unused: *mut UDateTimePatternGenerator,
        pattern: *const u16,
        length: i32,
        out: *mut u16,
        capacity: i32,
        status: &mut Status,
    ) -> i32;
    fn udatpg_getFieldDisplayName(
        generator: *const UDateTimePatternGenerator,
        field: Field,
        width: Width,
        out: *mut u16,
        capacity: i32,
        status: &mut Status,
    ) -> i32;
}

const UDATPG_MATCH_HOUR_FIELD_LENGTH: i32 = 1 << Field::Hour as i32;

/// Has room for nearly all of them, because one that does not fit is looked up twice.
pub type Pattern = SmallVec<[u16; 64]>;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(i32)]
pub enum Field {
    Era = 0,
    Year = 1,
    Quarter = 2,
    Month = 3,
    WeekOfYear = 4,
    Weekday = 6,
    Day = 9,
    DayPeriod = 10,
    Hour = 11,
    Minute = 12,
    Second = 13,
    Zone = 15,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(i32)]
pub enum Width {
    Wide = 0,
    Abbreviated = 1,
    Narrow = 2,
}

icu_handle! {
    /// The patterns of a locale in its calendar system.
    pub struct PatternGenerator(UDateTimePatternGenerator), udatpg_close
}

impl PatternGenerator {
    pub fn open(locale: &CStr) -> Result<PatternGenerator> {
        let locale = locale_id(locale)?;
        // SAFETY: `locale` is terminated.
        open(|status| unsafe { udatpg_open(locale, status) }).map(PatternGenerator)
    }

    /// The hour is as wide as in `skeleton`, unless the locale has a pattern for that very width.
    pub fn best_pattern(&mut self, skeleton: &[u16]) -> Result<Pattern> {
        let length = pattern_length(skeleton)?;
        let mut pattern = Pattern::new();
        // SAFETY: the generator is open, `skeleton` has `length` units, and `out` has room for `capacity`.
        fill(&mut pattern, |out, capacity, status| unsafe {
            udatpg_getBestPatternWithOptions(
                self.0.as_ptr(),
                skeleton.as_ptr(),
                length,
                UDATPG_MATCH_HOUR_FIELD_LENGTH,
                out,
                capacity,
                status,
            )
        })?;
        Ok(pattern)
    }

    /// What the locale calls a field: `day of the week`.
    pub fn field_name(&self, field: Field, width: Width) -> Result<Buffer<u16>> {
        // SAFETY: the generator is open, and `out` has room for `capacity`.
        filled(|out, capacity, status| unsafe {
            udatpg_getFieldDisplayName(self.0.as_ptr(), field, width, out, capacity, status)
        })
    }
}

/// Of the first 50 items of `pattern`, where an item is a field or one unit of anything else.
pub fn skeleton(pattern: &[u16]) -> Result<Buffer<u16>> {
    let length = pattern_length(pattern)?;
    // SAFETY: `pattern` has `length` units, and `out` has room for `capacity`.
    filled(|out, capacity, status| unsafe {
        udatpg_getSkeleton(
            ptr::null_mut(),
            pattern.as_ptr(),
            length,
            out,
            capacity,
            status,
        )
    })
}
