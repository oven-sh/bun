//! What lets an object that only inherits from a prototype act as an instance.

use bun_engine_text::StringRef;
use bun_engine_vm::{Attributes, CellKind, JsSymbol, PropertyDescriptor};

use super::prelude::*;

pub(super) fn initialize(cx: &Cx) {
    let description = StringRef::from_literal("IntlLegacyConstructedSymbol");
    let symbol = JsSymbol::create(cx, Some(&description));
    cx.global().init_intl_fallback_symbol(symbol);
}

fn inherits_from(cx: &mut Cx, value: Value, constructor: &JsObject) -> JsResult<bool> {
    let prototype = constructor.get_direct(names::prototype).unwrap_or_default();
    JsObject::default_has_instance(cx, value, prototype)
}

/// ChainNumberFormat and ChainDateTimeFormat, for a call without `new`.
pub(super) fn chain(cx: &mut Cx, frame: &CallFrame, instance: Value) -> JsResult<Value> {
    let this = frame.this_value();
    match this.as_object() {
        Some(object) if inherits_from(cx, this, &frame.callee())? => {
            let symbol = cx.intl_fallback_symbol();
            let descriptor = PropertyDescriptor::data(instance, Attributes::CONSTANT);
            object.define_property_or_throw(cx, symbol.anchor().name(), &descriptor)?;
            Ok(this)
        }
        _ => Ok(instance),
    }
}

/// UnwrapNumberFormat and UnwrapDateTimeFormat
#[inline]
pub(super) fn unwrap<T: CellKind>(
    cx: &mut Cx,
    this: Value,
    constructor: fn(&Cx) -> Gc<JsObject>,
) -> JsResult<Value> {
    if this.is::<T>() || !inherits_from(cx, this, &constructor(cx))? {
        return Ok(this);
    }
    let symbol = cx.intl_fallback_symbol();
    this.get(cx, symbol.anchor().name())
}
