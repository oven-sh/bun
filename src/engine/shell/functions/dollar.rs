//! `$262`: <https://github.com/tc39/test262/blob/main/INTERPRETING.md#host-defined-functions>

use bun_engine_text::PropertyName;
use bun_engine_vm::heap::Scope;
use bun_engine_vm::{CustomGetterSetter, GlobalProxy};

use super::heap::clear_kept_objects;
use super::scripts::{evaluate_in, script_from_caller};
use super::values::{create_masquerader, transfer_array_buffer};
use super::{agent, object_with, put};
use crate::global;
use crate::prelude::*;

const FUNCTIONS: Functions = &[
    ("createRealm", create_realm, 0),
    ("detachArrayBuffer", transfer_array_buffer, 1),
    ("evalScript", eval_script, 1),
    ("gc", gc, 0),
    ("clearKeptObjects", clear_kept_objects, 0),
    ("globalObjectFor", global_object_for, 1),
];

pub(super) fn create(cx: &Cx) -> Gc<JsObject> {
    let dollar = object_with(cx, FUNCTIONS, Attributes::NONE);
    put(cx, &dollar, "global", cx.global_this().into());
    let name = Identifier::from_literal("IsHTMLDDA");
    let custom = CustomGetterSetter::create(cx, Some(get_is_html_dda), None, None);
    dollar.put_direct_custom(cx, name.name(), custom, Attributes::CUSTOM_VALUE);
    let agent = object_with(cx, agent::FUNCTIONS, Attributes::DONT_ENUM);
    put(cx, &dollar, "agent", agent.into());
    dollar
}

#[native_abi]
fn get_is_html_dda(cx: &mut Cx, _: Value, _: PropertyName<'_>) -> JsResult<Value> {
    Ok(create_masquerader(cx))
}

#[native_abi]
fn create_realm(cx: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    let name = Identifier::from_literal("$");
    Ok(global::create(cx)
        .get_direct(name.name())
        .unwrap_or_default())
}

#[native_abi]
fn eval_script(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let source = script_from_caller(cx, frame.argument(0))?;
    let name = Identifier::from_literal("global");
    match (frame.this_value().get(cx, name.name())?).downcast::<GlobalProxy>() {
        Some(global) => evaluate_in(cx, global.target(), &source),
        None => {
            let message = "Expected global to point to a global object";
            Err(cx.throw_error(ErrorType::Error, message))
        }
    }
}

#[native_abi]
fn gc(cx: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    cx.heap.collect_and_sweep(Some(Scope::Full));
    Ok(Value::UNDEFINED)
}

#[native_abi]
pub(super) fn global_object_for(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    if frame.argument_count() == 0 {
        return Err(cx.throw_error(ErrorType::Error, "Not enough arguments"));
    }
    let realm = frame.argument(0).as_object().and_then(|it| it.realm());
    Ok(realm.map_or_default(|realm| realm.global_this().into()))
}
