//! The dictionaries that the constructors of memories and tables take, and numbers as wide as an address.

use bun_engine_asm::Width;
use bun_engine_vm::{JsBigInt, options};

use crate::prelude::*;

/// AddressValueToU64
#[inline]
pub(crate) fn to_address(cx: &mut Cx, value: Value, address: Width) -> JsResult<u64> {
    if address == Width::W64 {
        let message = "Expect an integer argument in the range: [0, 2^64 - 1]";
        let value = value.to_bigint(cx)?.value().to_u64();
        return value.ok_or_else(|| cx.throw_type_error(message));
    }
    to_u32_in_range(cx, value).map(u64::from)
}

/// For `[EnforceRange] unsigned long` of Web IDL.
#[inline]
pub(crate) fn to_u32_in_range(cx: &mut Cx, value: Value) -> JsResult<u32> {
    match value.as_index_int32() {
        Some(integer) => Ok(integer),
        None => convert_to_u32_in_range(cx, value),
    }
}

fn convert_to_u32_in_range(cx: &mut Cx, value: Value) -> JsResult<u32> {
    let integer = value.to_number(cx)?.trunc();
    if (0.0..=f64::from(u32::MAX)).contains(&integer) {
        return Ok(integer as u32);
    }
    Err(cx.throw_type_error("Expect an integer argument in the range: [0, 2^32 - 1]"))
}

/// U64ToAddressValue
#[inline]
pub(crate) fn from_address(cx: &Cx, value: u64, address: Width) -> Value {
    match address {
        Width::W32 => (value as u32).into(),
        Width::W64 => JsBigInt::from_small(cx, value).into(),
    }
}

pub(crate) struct Descriptor {
    object: Gc<JsObject>,
    /// `WebAssembly.Memory`
    class: &'static str,
}

impl Descriptor {
    pub(crate) fn new(cx: &Cx, class: &'static str, value: Value) -> JsResult<Descriptor> {
        let object = value.as_object().ok_or_else(|| {
            cx.throw_type_error(format_args!(
                "{class} expects its first argument to be an object"
            ))
        })?;
        Ok(Descriptor { object, class })
    }

    pub(crate) fn get(&self, cx: &mut Cx, name: PropertyName<'_>) -> JsResult<Value> {
        self.object.get(cx, name)
    }

    /// What goes with the name that the member has. `None` if it has another.
    pub(crate) fn choice<T: Copy>(
        &self,
        cx: &mut Cx,
        member: PropertyName<'_>,
        choices: &[(PropertyName<'static>, T)],
    ) -> JsResult<Option<T>> {
        let value = self.get(cx, member)?;
        choose(cx, value, choices)
    }

    pub(crate) fn address_type(&self, cx: &mut Cx) -> JsResult<Width> {
        let class = self.class;
        let value = self.get(cx, names::address)?;
        if value.is_undefined() {
            return Ok(Width::W32);
        }
        let choices = [(names::i32, Width::W32), (names::i64, Width::W64)];
        match choose(cx, value, &choices)? {
            Some(Width::W64) if !options().use_wasm_memory64 => Err(cx.throw_type_error(
                format_args!("{class} 'address' of 'i64' requires Memory64 to be enabled"),
            )),
            Some(address) => Ok(address),
            None => Err(cx.throw_type_error(format_args!(
                "{class} 'address' must be a string of value 'i32' or 'i64'"
            ))),
        }
    }

    /// `initial`, or `minimum` in its place.
    pub(crate) fn initial(&self, cx: &mut Cx, address: Width) -> JsResult<u64> {
        let initial = self.get(cx, names::initial)?;
        let minimum = self.get(cx, names::minimum)?;
        let value = match (initial, minimum) {
            (Value::UNDEFINED, value) | (value, Value::UNDEFINED) => value,
            _ => {
                return Err(cx.throw_type_error(format_args!(
                    "{} 'initial' and 'minimum' options are specified at the same time",
                    self.class
                )));
            }
        };
        to_address(cx, value, address)
    }

    pub(crate) fn maximum(&self, cx: &mut Cx, address: Width) -> JsResult<Option<u64>> {
        match self.get(cx, names::maximum)? {
            Value::UNDEFINED => Ok(None),
            value => to_address(cx, value, address).map(Some),
        }
    }
}

pub(crate) fn choose<T: Copy>(
    cx: &mut Cx,
    value: Value,
    choices: &[(PropertyName<'static>, T)],
) -> JsResult<Option<T>> {
    let view = value.to_string_view(cx)?;
    let found = choices.iter().find(|(name, _)| name.text() == view.text());
    Ok(found.map(|&(_, choice)| choice))
}
