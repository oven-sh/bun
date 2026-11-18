use bun_engine_date::TimeZone;
use bun_engine_macros::export;
use bun_engine_temporal::{
    Instant, Precision, ShowCalendar, TemporalValue, to_temporal_date, to_temporal_date_time,
    to_temporal_instant, to_temporal_time,
};
use bun_engine_text::StringRef;
use bun_engine_vm::{Cx, Gc, JsObject, JsResult, Value};

use crate::abi::returned_by_value;

#[derive(Clone, Copy)]
#[repr(u8)]
pub(crate) enum TemporalType {
    None,
    Instant,
    PlainDateTime,
    PlainDate,
    PlainTime,
    ZonedDateTime,
    PlainYearMonth,
    PlainMonthDay,
    Duration,
}

returned_by_value! {
    TemporalType = TemporalType::None,
}

#[export]
fn temporal_type(object: &JsObject) -> TemporalType {
    match TemporalValue::of(object) {
        None => TemporalType::None,
        Some(TemporalValue::Instant(_)) => TemporalType::Instant,
        Some(TemporalValue::PlainDateTime(_)) => TemporalType::PlainDateTime,
        Some(TemporalValue::PlainDate(_)) => TemporalType::PlainDate,
        Some(TemporalValue::PlainTime(_)) => TemporalType::PlainTime,
        Some(TemporalValue::ZonedDateTime(_)) => TemporalType::ZonedDateTime,
        Some(TemporalValue::PlainYearMonth(_)) => TemporalType::PlainYearMonth,
        Some(TemporalValue::PlainMonthDay(_)) => TemporalType::PlainMonthDay,
        Some(TemporalValue::Duration(_)) => TemporalType::Duration,
    }
}

#[export]
fn temporal_objects_hold_the_same(a: &JsObject, b: &JsObject) -> bool {
    TemporalValue::of(a) == TemporalValue::of(b)
}

#[export]
fn temporal_object_from(cx: &mut Cx, kind: TemporalType, item: Value) -> JsResult<Gc<JsObject>> {
    let value = match kind {
        TemporalType::Instant => TemporalValue::Instant(to_temporal_instant(cx, item)?),
        TemporalType::PlainDateTime => {
            TemporalValue::PlainDateTime(to_temporal_date_time(cx, item)?)
        }
        TemporalType::PlainDate => TemporalValue::PlainDate(to_temporal_date(cx, item)?),
        TemporalType::PlainTime => TemporalValue::PlainTime(to_temporal_time(cx, item)?),
        _ => unreachable!(),
    };
    Ok(value.to_object(cx))
}

fn exact_time(object: &JsObject) -> Instant {
    match TemporalValue::of(object) {
        Some(TemporalValue::Instant(instant)) => instant,
        Some(TemporalValue::ZonedDateTime(zoned)) => zoned.instant(),
        _ => unreachable!(),
    }
}

/// The high half.
#[export]
fn temporal_epoch_nanoseconds(object: &JsObject, low: &mut u64) -> i64 {
    let nanoseconds = exact_time(object).epoch_nanoseconds();
    *low = nanoseconds as u64;
    (nanoseconds >> 64) as i64
}

#[export]
fn temporal_exact_time_to_string(object: &JsObject, has_offset: bool, minutes: i16) -> StringRef {
    let zone = has_offset.then_some(TimeZone::Offset { minutes });
    StringRef::from_text(exact_time(object).to_text(zone, Precision::AUTO).text())
}

#[export]
fn temporal_offset_nanoseconds(object: &JsObject) -> i64 {
    match TemporalValue::of(object) {
        Some(TemporalValue::ZonedDateTime(zoned)) => zoned.offset_nanoseconds(),
        _ => unreachable!(),
    }
}

#[export]
fn temporal_plain_value_to_string(object: &JsObject) -> StringRef {
    let text = match TemporalValue::of(object) {
        Some(TemporalValue::PlainDateTime(it)) => it.to_text(Precision::AUTO, ShowCalendar::Never),
        Some(TemporalValue::PlainDate(it)) => it.to_text(ShowCalendar::Never),
        Some(TemporalValue::PlainTime(it)) => it.to_text(Precision::AUTO),
        _ => unreachable!(),
    };
    StringRef::from_text(text.text())
}
