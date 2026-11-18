//! What code from the console of a frontend finds besides the globals.

use bun_engine_number::NumberText;
use bun_engine_text::{Identifier, StringRef, Text, names};
use bun_engine_vm::{
    Attributes, CallFrame, Cx, DontEnumMode, Gc, JsNativeClosure, JsObject, JsResult, JsString,
    Message, PropertyNameMode, Value,
};

use super::{Remote, queries};

type Function = fn(&mut Cx, &CallFrame) -> JsResult<Value>;

const FUNCTIONS: [(&str, u32, Function); 6] = [
    ("keys", 1, |cx, frame| {
        let object = frame.argument(0).to_object(cx)?;
        let keys = object.own_keys_array(cx, PropertyNameMode::Strings, DontEnumMode::Exclude);
        keys.map(Value::from)
    }),
    ("values", 1, |cx, frame| {
        let message = "Object.values requires that input parameter not be null or undefined";
        let value = frame.argument(0).require_object_coercible(cx, message)?;
        (value.to_object(cx)?.enumerable_own_values(cx)).map(Value::from)
    }),
    ("queryInstances", 0, queries::instances),
    ("queryObjects", 0, queries::instances),
    ("queryHolders", 0, queries::holders),
    ("inspect", 1, |_, _| Ok(Value::UNDEFINED)),
];

const FUNCTIONS_OF_CONSOLE: [&str; 26] = [
    "assert",
    "clear",
    "count",
    "countReset",
    "debug",
    "dir",
    "dirxml",
    "error",
    "group",
    "groupCollapsed",
    "groupEnd",
    "info",
    "log",
    "profile",
    "profileEnd",
    "record",
    "recordEnd",
    "screenshot",
    "table",
    "takeHeapSnapshot",
    "time",
    "timeEnd",
    "timeLog",
    "timeStamp",
    "trace",
    "warn",
];

fn define(
    cx: &Cx,
    holder: &JsObject,
    name: &'static str,
    length: u32,
    body: impl Fn(&mut Cx, &CallFrame) -> JsResult<Value> + bun_engine_vm::GcFree + 'static,
) {
    let anonymous = StringRef::empty();
    let body = move |cx: &mut Cx, frame: &CallFrame, _: &[Value]| body(cx, frame);
    let function = JsNativeClosure::create(cx, length, &anonymous, &[], body);
    let text = format_args!("function {name}() {{ [Command Line API] }}").into_string();
    let text = [JsString::new(cx, text).into()];
    let to_string = |_: &mut Cx, _: &CallFrame, text: &[Value]| Ok(text[0]);
    let to_string = JsNativeClosure::create(cx, 0, &anonymous, &text, to_string);
    function.put_direct(cx, names::toString, to_string.into(), Attributes::NONE);
    let name = Identifier::from_literal(name);
    holder.put_direct(cx, name.name(), function.into(), Attributes::NONE);
}

fn create_functions(cx: &Cx) -> Gc<JsObject> {
    let holder = cx.new_object();
    for (name, length, function) in FUNCTIONS {
        define(cx, &holder, name, length, function);
    }
    for name in FUNCTIONS_OF_CONSOLE {
        define(cx, &holder, name, 0, move |cx, frame| {
            let console = cx.global_this().get(cx, names::console)?;
            let name = Identifier::from_literal(name);
            cx.invoke(console, name.name(), frame.arguments())
        });
    }
    holder
}

impl Remote<'_> {
    pub(super) fn command_line_api(self, cx: &Cx) -> Gc<JsObject> {
        let registry = self.registry;
        let functions = registry.command_line_functions().unwrap_or_else(|| {
            let functions = create_functions(cx);
            registry.set_command_line_functions(Some(functions));
            functions
        });
        let api = cx.new_object_with_prototype(Some(functions));
        let alias = self.controller.runtime.saved_result_alias();
        let define = |key: Text<'_>, value: Value| {
            let alias = alias.iter().map(|it| it.text());
            for prefix in alias.chain([Text::from_ascii("$")]) {
                if let Ok(name) = StringRef::try_concat(&[prefix, key]) {
                    let name = Identifier::new(name.text());
                    if name.name().as_index().is_none() {
                        api.put_direct(cx, name.name(), value, Attributes::CONSTANT);
                    }
                }
            }
        };
        for (key, value) in [
            ("_", registry.last_result()),
            ("exception", registry.exception()),
        ] {
            if let Some(value) = value {
                define(Text::from_ascii(key), value);
            }
        }
        for (number, value) in (1_u32..).zip(registry.saved_results().iter()) {
            define(NumberText::from(number).text(), value);
        }
        api
    }
}
