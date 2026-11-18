use bun_engine_date::TimeZone;

use super::arguments::to_time_zone;
use super::prelude::*;
use super::zone_names;
use crate::{CalendarId, Instant, ZonedDateTime};

static_table!(static PROPERTIES = [
    function(names::instant, instant, 0),
    function(names::timeZoneId, time_zone_id, 0),
    function(names::plainDateISO, plain_date_iso, 0),
    function(names::plainDateTimeISO, plain_date_time_iso, 0),
    function(names::plainTimeISO, plain_time_iso, 0),
    function(names::zonedDateTimeISO, zoned_date_time_iso, 0),
    StaticProperty::string(symbols::toStringTag, names::temporalNow),
]);

define_object!(NowObject, "Temporal.Now", PROPERTIES);

pub(super) fn initialize(cx: &Cx) {
    cx.global().init_temporal_now_object(NowObject::create(cx));
}

/// SystemUTCEpochNanoseconds
#[inline(always)]
fn current_instant(cx: &Cx) -> JsResult<Instant> {
    let overridden = cx.global().overridden_date_now().get();
    if overridden.is_nan() {
        return Ok(Instant::clamped(bun_core::time::nano_timestamp()));
    }
    Instant::from_overridden_clock(overridden).or_throw(cx)
}

/// SystemTimeZoneIdentifier
fn current_time_zone(cx: &Cx) -> TimeZone {
    TimeZone::Named(cx.date_cache().time_zone())
}

#[inline(always)]
fn current_zoned(cx: &Cx, frame: &CallFrame) -> JsResult<ZonedDateTime> {
    let time_zone = match frame.argument(0) {
        Value::UNDEFINED => current_time_zone(cx),
        given => to_time_zone(cx, given)?,
    };
    let instant = current_instant(cx)?;
    Ok(ZonedDateTime::new(instant, time_zone, CalendarId::Iso8601))
}

#[native_abi]
fn instant(cx: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    current_instant(cx)?.returned(cx)
}

#[native_abi]
fn time_zone_id(cx: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    Ok(zone_names::identifier(cx, current_time_zone(cx)).into())
}

#[native_abi]
fn plain_date_iso(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    current_zoned(cx, frame)?.to_plain_date().returned(cx)
}

#[native_abi]
fn plain_date_time_iso(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    current_zoned(cx, frame)?.to_plain_date_time().returned(cx)
}

#[native_abi]
fn plain_time_iso(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    current_zoned(cx, frame)?.iso_date_time().time.returned(cx)
}

#[native_abi]
fn zoned_date_time_iso(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    current_zoned(cx, frame)?.returned(cx)
}
