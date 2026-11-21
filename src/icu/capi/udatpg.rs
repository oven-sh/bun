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

/// Accepts a skeleton that has fields: `j`, `jj` and the letters GyYrUMLEcdaBHkhKmsSvzZO.
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

/// Accepts the letters GyYrUMLEcdaBHkhKmsSvzZO.
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

/// Accepts all fields but week of month, day of year, weekday of month and fractional second.
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
        match dtpg
            .non_null()?
            .field_display_name(to_index(field), to_index(width))
        {
            None => Err(U_ILLEGAL_ARGUMENT_ERROR),
            Some([]) => Err(U_UNSUPPORTED_ERROR),
            Some(name) => Ok(field_name.extract_to(name, status)),
        }
    })
}
