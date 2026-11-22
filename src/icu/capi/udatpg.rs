//! `unicode/udatpg.h`

use crate::capi::ffi::{Dest, ErrorCode, NonNullHandle, NulStr, Text, UChar};
use crate::capi::ucal::locale_id;
use crate::common::locid::Locale;
use crate::common::slice_ext::to_index;
use crate::common::utypes::*;
use crate::i18n::dtptngen::{self, DateTimePatternGenerator, UDateTimePatternMatchOptions};
use bun_icu_macros::capi;

pub(crate) type UDateTimePatternGenerator = DateTimePatternGenerator;
type UDateTimePatternField = i32;
type UDateTimePGDisplayWidth = i32;

#[capi]
fn udatpg_open(locale: NulStr<u8>, status: ErrorCode) -> Option<Box<UDateTimePatternGenerator>> {
    status
        .open(|| DateTimePatternGenerator::create_instance(&Locale::from_name(locale_id(locale)?)))
}

#[capi]
fn udatpg_close(dtpg: Option<Box<UDateTimePatternGenerator>>) {
    drop(dtpg);
}

/// Accepts quarters, weeks, the day of the year and the weekday in the month only if data can come from files.
#[capi]
fn udatpg_getBestPatternWithOptions(
    dtpg: Option<&UDateTimePatternGenerator>,
    (skeleton, _): Text<UChar>,
    options: UDateTimePatternMatchOptions,
    (best_pattern, _): Dest<UChar>,
    status: ErrorCode,
) -> i32 {
    status.run(0, |status| {
        let result = dtpg
            .non_null()?
            .get_best_pattern(skeleton.get()?, options)?;
        Ok(best_pattern.extract_to(&result, status))
    })
}

#[capi]
fn udatpg_getSkeleton(
    _unused_dtpg: Option<&UDateTimePatternGenerator>,
    (pattern, _): Text<UChar>,
    (skeleton, _): Dest<UChar>,
    status: ErrorCode,
) -> i32 {
    status.run(0, |status| {
        let result = dtptngen::get_skeleton(pattern.get()?)?;
        Ok(skeleton.extract_to(&result, status))
    })
}

/// Accepts all fields but week of month, day of year and weekday of month.
#[capi]
fn udatpg_getFieldDisplayName(
    dtpg: Option<&UDateTimePatternGenerator>,
    field: UDateTimePatternField,
    width: UDateTimePGDisplayWidth,
    (field_name, _): Dest<UChar>,
    status: ErrorCode,
) -> i32 {
    status.run(-1, |status| {
        field_name.check()?;
        let name = dtpg
            .non_null()?
            .field_display_name(to_index(field), to_index(width))
            .ok_or(U_ILLEGAL_ARGUMENT_ERROR)?;
        Ok(field_name.extract_to(name, status))
    })
}
