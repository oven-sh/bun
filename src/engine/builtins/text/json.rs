use bun_engine_bytecode::Visibility;
use bun_engine_vm::call::native_not_a_constructor;
use bun_engine_vm::json::{self, RawJson};
use bun_engine_vm::{JsFunction, RealmSlot};

use crate::prelude::*;

static_table!(static PROPERTIES = [
    StaticProperty::function(names::parse, parse, 2).with_intrinsic(Intrinsic::JsonParse),
    StaticProperty::function(names::stringify, stringify, 3)
        .with_intrinsic(Intrinsic::JsonStringify),
    StaticProperty::function(names::isRawJSON, is_raw_json, 1),
    StaticProperty::function(names::rawJSON, raw_json, 1),
    StaticProperty::string(symbols::toStringTag, names::JSON),
]);

define_object!(JsonObject, "JSON", PROPERTIES);

pub(super) fn initialize_slot(cx: &Cx, slot: RealmSlot) -> bool {
    let global = cx.global();
    match slot {
        RealmSlot::json_object => {
            global.init_json_object(JsonObject::create(cx, cx.object_prototype().into()));
        }
        RealmSlot::raw_json_shape => global.init_raw_json_shape(RawJson::create_shape(cx)),
        RealmSlot::private_json_parse => global.init_private_json_parse(JsFunction::native_with(
            cx,
            1,
            names::parse.to_identifier().string(),
            parse,
            native_not_a_constructor,
            Intrinsic::JsonParse,
            Visibility::Private,
        )),
        _ => return false,
    }
    true
}

#[native_abi]
fn parse(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let text = frame.argument(0).to_string_view(cx)?;
    let reviver = frame.argument(1);
    if reviver.is_callable() {
        return json::parse_with_reviver(cx, &text, reviver);
    }
    json::parse(cx, text.text().into())
}

#[native_abi]
fn stringify(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    json::stringify_to_value(cx, frame.argument(0), frame.argument(1), frame.argument(2))
}

#[native_abi]
fn is_raw_json(_: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    Ok(frame.argument(0).is::<RawJson>().into())
}

#[native_abi]
fn raw_json(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let text = frame.argument(0).to_string(cx)?;
    RawJson::create(cx, text).map(Into::into)
}
