//! `@opentelemetry/api` values, read without running JavaScript unless a function says otherwise.

use bun_core::Utf8Bytes;
use bun_jsc::{JSBigInt, JSGlobalObject, JSValue, JsResult};
use bun_telemetry::otlp::{EntryWriter, field as f, write_key_value_limited};
use bun_telemetry::propagation::tracestate_bounded;
use bun_telemetry::{Exception, Flags, SpanContext, SpanId, TraceId, Value, clock};

use crate::engine::{self, ErrorDescription, PlainArray};
use crate::generated_bindgen::telemetry::SpanContextInit;
use crate::trace_state::TraceState;

const MAX_ARRAY_ELEMENTS: u32 = 4096;

#[optimize(speed)]
fn non_string_scalar(value: JSValue) -> Option<Value<'static>> {
    if value.is_int32() {
        return Some(Value::Int(value.as_int32().into()));
    }
    if value.is_number() {
        let n = value.as_number();
        let is_safe_integer = n.trunc() == n && n.abs() <= bun_jsc::MAX_SAFE_INTEGER as f64;
        return Some(if is_safe_integer {
            Value::Int(n as i64)
        } else {
            Value::Double(n)
        });
    }
    if value.is_boolean() {
        return Some(Value::Bool(value.as_boolean()));
    }
    if value.is_big_int() && value.is_big_int_in_int64_range(i64::MIN, i64::MAX) {
        return JSBigInt::from_js(value).map(|n| Value::Int(n.to_int64()));
    }
    None
}

/// Calls `f` if `value` is an `AttributeValue`.
#[inline]
pub(crate) fn with_attribute_value(
    global: &JSGlobalObject,
    value: JSValue,
    f: impl FnOnce(&Value<'_>),
) -> JsResult<()> {
    if value.is_string_literal() {
        f(&Value::Str(&value.to_js_string_view(global)?.to_utf8()));
    } else if let Some(scalar) = non_string_scalar(value) {
        f(&scalar);
    } else if let Some(array) = PlainArray::new(value) {
        enum Element {
            Str(Utf8Bytes<'static>),
            Other(Value<'static>),
        }
        let len = array.len().min(MAX_ARRAY_ELEMENTS);
        let mut elements = Vec::with_capacity(len as usize);
        for element in (0..len).map(|i| array.get(i).unwrap_or(JSValue::UNDEFINED)) {
            elements.push(if element.is_string_literal() {
                Element::Str(element.to_utf8(global)?)
            } else if element.is_undefined_or_null() {
                Element::Other(Value::Empty)
            } else if let Some(scalar) = non_string_scalar(element) {
                Element::Other(scalar)
            } else {
                return Ok(());
            });
        }
        let values: Vec<Value<'_>> = elements
            .iter()
            .map(|element| match element {
                Element::Str(s) => Value::Str(s),
                Element::Other(v) => *v,
            })
            .collect();
        f(&Value::Array(&values));
    }
    Ok(())
}

/// Runs the getters of `attributes`, all before the first call of `f`.
pub(crate) fn for_each_attribute(
    global: &JSGlobalObject,
    attributes: JSValue,
    mut f: impl FnMut(&[u8], &Value<'_>),
) -> JsResult<()> {
    engine::for_each_attribute(global, attributes, |key, value| {
        if key.is_empty() {
            return Ok(());
        }
        with_attribute_value(global, value, |value| f(key, value))
    })
}

/// The attributes of an event or a link, which are read before the span is borrowed.
#[derive(Default)]
pub(crate) struct EntryAttributes(Vec<u8>);

impl EntryAttributes {
    pub(crate) fn of_event(global: &JSGlobalObject, given: Option<JSValue>) -> JsResult<Self> {
        Self::read(global, given, f::EV_ATTRIBUTES, f::EV_DROPPED_ATTRIBUTES)
    }

    pub(crate) fn of_link(global: &JSGlobalObject, given: Option<JSValue>) -> JsResult<Self> {
        Self::read(
            global,
            given,
            f::LINK_ATTRIBUTES,
            f::LINK_DROPPED_ATTRIBUTES,
        )
    }

    /// Runs getters.
    fn read(
        global: &JSGlobalObject,
        given: Option<JSValue>,
        field: u32,
        dropped_field: u32,
    ) -> JsResult<Self> {
        let mut encoded = Vec::new();
        if let Some(given) = given {
            let limits = &bun_telemetry::state().limits;
            let max_len = limits.attribute_value_length as usize;
            let mut count = 0u64;
            for_each_attribute(global, given, |key, value| {
                if count < limits.attributes.into() {
                    write_key_value_limited(&mut encoded, field, key, value, max_len);
                }
                count += 1;
            })?;
            let dropped = count.saturating_sub(limits.attributes.into());
            bun_telemetry::proto::write_uint_opt(&mut encoded, dropped_field, dropped);
        }
        Ok(EntryAttributes(encoded))
    }

    pub(crate) fn write(&self, entry: Option<EntryWriter<'_>>) {
        if let Some(mut entry) = entry {
            entry.raw(&self.0);
        }
    }
}

pub(crate) fn is_time_input(value: JSValue) -> bool {
    value.is_number() || value.is_date() || value.is_array()
}

/// A `TimeInput` in nanoseconds since the epoch, 0 for anything else.
#[inline]
pub(crate) fn time_input(global: &JSGlobalObject, value: JSValue) -> u64 {
    if value.is_undefined() {
        return 0;
    }
    given_time_input(global, value)
}

fn given_time_input(global: &JSGlobalObject, value: JSValue) -> u64 {
    // What fits a u64 of nanoseconds.
    const MAX_SECONDS: f64 = 1.8e10;
    let from_ms = |ms: f64| {
        if ms > 0.0 && ms < MAX_SECONDS * 1e3 {
            ms.trunc() as u64 * 1_000_000 + (ms.fract() * 1e6) as u64
        } else {
            0
        }
    };
    if value.is_number() {
        let ms = value.as_number();
        // As in the SDK, a number up to `performance.now()` is one of its readings.
        let uptime_ns = global.bun_vm().origin_timer.elapsed().as_nanos() as u64;
        if ms >= 0.0 && ms * 1e6 <= uptime_ns as f64 {
            return clock::now_unix_nanos().saturating_sub(uptime_ns - from_ms(ms).min(uptime_ns));
        }
        return from_ms(ms);
    }
    if value.is_date() {
        return from_ms(value.get_unix_timestamp());
    }
    if let Some(hr_time) = PlainArray::new(value)
        && let Some(seconds) = hr_time.get(0).and_then(JSValue::get_number)
        && let Some(nanos) = hr_time.get(1).and_then(JSValue::get_number)
        && (0.0..MAX_SECONDS).contains(&seconds)
        && (0.0..1e12).contains(&nanos)
    {
        return seconds as u64 * 1_000_000_000 + nanos as u64;
    }
    0
}

impl SpanContextInit<'_> {
    /// `None` unless both ids are valid.
    pub(crate) fn ids(&self) -> Option<SpanContext> {
        Some(SpanContext {
            trace_id: TraceId::from_hex(self.trace_id.as_deref()?)?,
            span_id: SpanId::from_hex(self.span_id.as_deref()?)?,
            flags: Flags::from_w3c(self.trace_flags.map_or(1, |flags| flags as u8)),
        })
    }
}

/// The header of an api `TraceState`, or of a string. Runs its `serialize()`.
pub(crate) fn trace_state_header(global: &JSGlobalObject, value: JSValue) -> JsResult<Vec<u8>> {
    let bounded = |header: &[u8]| tracestate_bounded(header).unwrap_or_default().to_vec();
    if let Some(own) = value.as_class_ref::<TraceState>() {
        return Ok(bounded(own.serialize()));
    }
    let header = if value.is_object()
        && let Some(serialize) = value.get(global, "serialize")?
        && serialize.is_callable()
    {
        serialize.call_for_running_script(global, value, &[])?
    } else {
        value
    };
    if !header.is_string_literal() {
        return Ok(Vec::new());
    }
    Ok(bounded(&header.to_utf8(global)?))
}

impl ErrorDescription {
    pub(crate) fn with<R>(&self, f: impl FnOnce(&Exception<'_>) -> R) -> R {
        f(&Exception {
            ty: &self.ty.to_utf8(),
            message: &self.message.to_utf8(),
            stack: &self.stack.to_utf8(),
        })
    }
}
