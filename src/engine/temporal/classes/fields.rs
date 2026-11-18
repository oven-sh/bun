use bun_engine_vm::PreferredType;

use super::arguments::{calendar_of, require_object, require_string, to_string, to_time_zone};
use super::prelude::*;
use crate::{CalendarId, Conversion, FieldSet, Fields, TemporalValue};

/// PrepareCalendarFields
#[inline(always)]
pub(super) fn read_fields(
    cx: &mut Cx,
    item: &JsObject,
    set: FieldSet,
    calendar: CalendarId,
) -> JsResult<Fields> {
    let mut fields = Fields::new(set, calendar);
    fill(cx, item, &mut fields)?;
    Ok(fields)
}

fn fill(cx: &mut Cx, item: &JsObject, fields: &mut Fields) -> JsResult<()> {
    for field in fields.properties() {
        let value = get(cx, item, field.property())?;
        if value.is_undefined() {
            fields.skip(field).or_throw(cx)?;
            continue;
        }
        match field.conversion() {
            Conversion::Number => {
                let number = value.to_number(cx)?;
                fields.set_number(field, number).or_throw(cx)?;
            }
            Conversion::String => {
                let string = to_string(cx, value)?;
                fields.set_text(field, string.text()).or_throw(cx)?;
            }
            Conversion::PrimitiveString(not_string) => {
                let primitive = value.to_primitive(cx, PreferredType::String)?;
                let string = require_string(cx, primitive, not_string)?;
                fields.set_text(field, string.text()).or_throw(cx)?;
            }
            Conversion::TimeZone => fields.set_time_zone(to_time_zone(cx, value)?),
        }
    }
    Ok(())
}

/// In the calendar that `item` names.
#[inline(always)]
pub(super) fn read_own_fields(cx: &mut Cx, item: &JsObject, set: FieldSet) -> JsResult<Fields> {
    let calendar = calendar_of(cx, item)?;
    read_fields(cx, item, set, calendar)
}

/// IsPartialTemporalObject
fn is_partial(cx: &mut Cx, item: &JsObject) -> JsResult<bool> {
    let can_be_partial = matches!(
        TemporalValue::of(item),
        None | Some(TemporalValue::Duration(_) | TemporalValue::Instant(_))
    );
    Ok(can_be_partial
        && get(cx, item, names::calendar)?.is_undefined()
        && get(cx, item, names::timeZone)?.is_undefined())
}

/// The first argument of `with`.
#[inline(always)]
pub(super) fn read_partial_fields(
    cx: &mut Cx,
    item: Value,
    set: FieldSet,
    calendar: CalendarId,
    not_partial: Error,
) -> JsResult<Fields> {
    let item = require_object(cx, item, not_partial)?;
    if !is_partial(cx, &item)? {
        return Err(throw(cx, not_partial));
    }
    let fields = read_fields(cx, &item, set, calendar)?;
    fields.require_any().or_throw(cx)?;
    Ok(fields)
}
