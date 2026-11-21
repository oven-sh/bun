//! `unicode/udatpg.h`

use crate::capi::ffi::{Dest, ErrorCode, NulStr, Owned, Ref, Text, UChar};
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
fn udatpg_open(locale: NulStr<u8>, status: ErrorCode) -> *mut UDateTimePatternGenerator {
    status.open(|cx, _| {
        DateTimePatternGenerator::create_instance(&Locale::from_name(locale_id(cx, locale)?))
    })
}

#[capi]
fn udatpg_close(dtpg: Owned<UDateTimePatternGenerator>) {
    dtpg.close()
}

/// Accepts a skeleton that has fields: `j`, `jj` and the letters GyYrUMLEcdaBHkhKmsSvzZO.
#[capi]
fn udatpg_getBestPatternWithOptions(
    dtpg: Ref<UDateTimePatternGenerator>,
    (skeleton, _): Text<UChar>,
    options: UDateTimePatternMatchOptions,
    (best_pattern, _): Dest<UChar>,
    status: ErrorCode,
) -> i32 {
    status.run(0, |cx, status| {
        let result = dtpg.get()?.get_best_pattern(cx.text(skeleton)?, options)?;
        Ok(cx.extract_to(&result, best_pattern, status))
    })
}

/// Accepts the letters GyYrUMLEcdaBHkhKmsSvzZO.
#[capi]
fn udatpg_getSkeleton(
    _unused_dtpg: Ref<UDateTimePatternGenerator>,
    (pattern, _): Text<UChar>,
    (skeleton, _): Dest<UChar>,
    status: ErrorCode,
) -> i32 {
    status.run(0, |cx, status| {
        let result = dtptngen::get_skeleton(cx.text(pattern)?)?;
        Ok(cx.extract_to(&result, skeleton, status))
    })
}

/// Accepts all fields but week of month, day of year, weekday of month and fractional second.
#[capi]
fn udatpg_getFieldDisplayName(
    dtpg: Ref<UDateTimePatternGenerator>,
    field: UDateTimePatternField,
    width: UDateTimePGDisplayWidth,
    (field_name, _): Dest<UChar>,
    status: ErrorCode,
) -> i32 {
    status.run(-1, |cx, status| {
        field_name.check()?;
        match dtpg
            .get()?
            .field_display_name(to_index(field), to_index(width))
        {
            None => Err(U_ILLEGAL_ARGUMENT_ERROR),
            Some([]) => Err(U_UNSUPPORTED_ERROR),
            Some(name) => Ok(cx.extract_to(name, field_name, status)),
        }
    })
}
