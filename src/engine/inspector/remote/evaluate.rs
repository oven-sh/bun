//! Running what a frontend sends, and describing what comes of it.

use bun_engine_text::{StringBuilder, StringRef, Text};
use bun_engine_vm::{
    Cx, DebuggerFrame, Environment, Gc, JsNativeClosure, JsObject, JsPromise, JsResult, SourceCode,
    SourceProvider, SourceType, Value, ValueVec, errors, evaluate_script, indirect_eval,
};

use super::by_value::{from_json, to_json};
use super::object::{Detail, is_plain, kind_of, to_literal};
use super::{ObjectId, Remote, attempt, settle};
use crate::protocol::{Error, Json, Object, Outcome, object};

/// How a result is to be reported.
#[derive(Clone)]
pub(crate) struct Wanted {
    pub(crate) group: StringRef,
    pub(crate) by_value: bool,
    pub(crate) detail: Detail,
    pub(crate) saves: bool,
}

const NO_SUCH_OBJECT: &str = "Could not find object with given id";
const EXECUTION_ENDED: &str = "Internal error: result is not an Object";

/// With the properties of `extension` behind those of the global object.
fn with_scope_extension<T>(
    cx: &mut Cx,
    extension: Option<Gc<JsObject>>,
    run: impl FnOnce(&mut Cx) -> T,
) -> T {
    let Some(extension) = extension else {
        return run(cx);
    };
    let (global, previous) = (cx.global(), cx.global().scope_extension());
    let scope = Environment::create_for_object(cx, global.cell(), extension);
    global.set_scope_extension(Some(scope));
    let result = run(cx);
    global.set_scope_extension(previous);
    result
}

fn not_an_object(cx: &mut Cx, json: &Json) -> Error {
    let value = from_json(cx, json);
    let mut message = StringBuilder::new();
    message.push_ascii("TypeError: ");
    errors::describe_value(cx, settle(cx, value).unwrap_or_default(), &mut message);
    message.push_ascii(" is not an Object.");
    message.into()
}

impl Remote<'_> {
    fn extension(self, cx: &mut Cx, is_wanted: bool) -> Option<Gc<JsObject>> {
        is_wanted.then(|| self.command_line_api(cx))
    }

    fn run_script(self, cx: &mut Cx, text: StringRef, has_api: bool) -> JsResult<Value> {
        let provider = SourceProvider::build(text, None, SourceType::Program);
        let source = SourceCode::whole(provider.finish());
        let extension = self.extension(cx, has_api);
        let did_allow = cx.replace_allows_redeclaration(true);
        let result = with_scope_extension(cx, extension, |cx| {
            evaluate_script(cx, &source, Value::UNDEFINED)
        });
        cx.replace_allows_redeclaration(did_allow);
        result
    }

    pub(crate) fn run_in_frame(
        self,
        cx: &mut Cx,
        frame: &DebuggerFrame,
        text: StringRef,
        has_api: bool,
    ) -> JsResult<Value> {
        let extension = self.extension(cx, has_api);
        let realm = (frame.code_block).map_or_else(|| cx.global(), |it| it.global());
        with_scope_extension(cx.in_realm(realm), extension, |cx| frame.evaluate(cx, text))
    }

    fn try_report(
        self,
        cx: &mut Cx,
        result: JsResult<Value>,
        wanted: &Wanted,
    ) -> JsResult<Outcome> {
        let value = match attempt(cx, result)? {
            Ok(value) => value,
            Err(thrown) => {
                let mut result = self.wrap(cx, thrown, &wanted.group, Detail::None)?;
                let description = to_literal(cx, thrown);
                if let Ok(description) = attempt(cx, description)? {
                    result.replace("description", description);
                }
                return Ok(Ok(object! { "result": result, "wasThrown": true }));
            }
        };
        let index = match wanted.saves {
            true => self.registry.save_result(cx, value)?,
            false => 0,
        };
        let result = if wanted.by_value && !is_plain(cx, value) {
            // The response has it in two objects.
            let json = to_json(cx, value, Json::MAX_DEPTH - 2);
            let Ok(Some(json)) = attempt(cx, json)? else {
                let message = "Object has too long reference chain (must not be longer than 1000)";
                return Ok(Err(message.into()));
            };
            object! { "type": kind_of(cx, value), "value": json }
        } else {
            self.wrap(cx, value, &wanted.group, wanted.detail)?
        };
        Ok(Ok(object! {
            "result": result,
            "wasThrown": false,
            "savedResultIndex" => (index != 0).then_some(index),
        }))
    }

    pub(crate) fn report(self, cx: &mut Cx, result: JsResult<Value>, wanted: &Wanted) -> Outcome {
        let outcome = self.try_report(cx, result, wanted);
        settle(cx, outcome).unwrap_or_else(|| Err(EXECUTION_ENDED.into()))
    }

    pub(crate) fn evaluate(
        self,
        cx: &mut Cx,
        text: StringRef,
        has_api: bool,
        wanted: &Wanted,
    ) -> Outcome {
        let result = self.run_script(cx, text, has_api);
        self.report(cx, result, wanted)
    }

    /// Calls what the script evaluates to.
    pub(crate) fn execute(
        self,
        cx: &mut Cx,
        text: StringRef,
        arguments: &[Value],
        wanted: &Wanted,
    ) -> Outcome {
        let function = self.run_script(cx, text, false);
        let result = function.and_then(|it| cx.call(it, Value::UNDEFINED, arguments));
        self.report(cx, result, wanted)
    }

    fn report_when_settled(self, cx: &Cx, promise: Gc<JsPromise>, request: i32, wanted: &Wanted) {
        let [on_fulfilled, on_rejected] = [false, true].map(|is_rejected| {
            let (controller, wanted) = (self.controller.downgrade(), wanted.clone());
            let report = move |cx: &mut Cx, frame: &bun_engine_vm::CallFrame, kept: &[Value]| {
                if let Some(controller) = controller.upgrade() {
                    let remote = Remote::new(&controller, kept[0].cast());
                    let outcome = controller.on_behalf_of_frontend(cx, |cx| {
                        let value = frame.argument(0);
                        let result = match is_rejected {
                            true => Err(cx.throw(value)),
                            false => Ok(value),
                        };
                        remote.report(cx, result, &wanted)
                    });
                    controller.respond(Some(request), outcome);
                }
                Ok(Value::UNDEFINED)
            };
            let kept = [self.registry.into()];
            JsNativeClosure::create(cx, 1, &StringRef::empty(), &kept, report).into()
        });
        promise.perform_then(cx, on_fulfilled, on_rejected, Value::UNDEFINED);
    }

    /// The response follows.
    pub(crate) fn await_promise(
        self,
        cx: &Cx,
        id: Option<u32>,
        request: i32,
        wanted: &Wanted,
    ) -> Outcome<()> {
        let promise = self.registry.find(id).ok_or(NO_SUCH_OBJECT)?;
        let promise = (promise.downcast()).ok_or("Object with given id is not a Promise")?;
        self.report_when_settled(cx, promise, request, wanted);
        Ok(())
    }

    /// Of a `Runtime.CallArgument`.
    fn resolve_argument(self, cx: &mut Cx, argument: &Object) -> Outcome<Value> {
        if let Some(value) = argument.get("value") {
            let value = from_json(cx, value);
            return Ok(settle(cx, value).ok_or(EXECUTION_ENDED)?);
        }
        let Some(id) = argument.string("objectId").filter(|it| !it.is_empty()) else {
            return Ok(Value::UNDEFINED);
        };
        let id = ObjectId::parse(cx, id.text()).filter(|it| it.realm == self.registry.id());
        let id =
            id.ok_or("Arguments should belong to the same JavaScript world as the target object.")?;
        Ok(self.registry.find(id.object).ok_or(NO_SUCH_OBJECT)?)
    }

    pub(crate) fn save_argument(self, cx: &mut Cx, argument: &Object) -> usize {
        let value = self.resolve_argument(cx, argument).ok();
        let index = value.and_then(|it| settle(cx, self.registry.save_result(cx, it)));
        index.unwrap_or(0)
    }

    /// `None` if the response follows: with `awaiting_request`, a promise is waited for.
    pub(crate) fn call_function_on(
        self,
        cx: &mut Cx,
        id: Option<u32>,
        declaration: Text<'_>,
        arguments: &[Json],
        awaiting_request: Option<i32>,
        wanted: &Wanted,
    ) -> Outcome<Option<Object>> {
        let this = self.registry.find(id).ok_or(NO_SUCH_OBJECT)?;
        let mut values = ValueVec::new();
        for argument in arguments {
            values.push(match argument {
                Json::Object(argument) => self.resolve_argument(cx, argument)?,
                Json::Array(_) => Value::UNDEFINED,
                primitive => return Err(not_an_object(cx, primitive)),
            });
        }
        let parts = [Text::from_ascii("("), declaration, Text::from_ascii(")")];
        let text = cx.new_string_from_parts(&parts);
        let function = text.and_then(|text| indirect_eval(cx, text.into()));
        if function.as_ref().is_ok_and(|it| !it.is_callable()) {
            return Err("Given expression does not evaluate to a function".into());
        }
        let result = function.and_then(|it| cx.call(it, this, &values));
        if let (Ok(value), Some(request)) = (&result, awaiting_request)
            && let Some(promise) = value.downcast()
        {
            self.report_when_settled(cx, promise, request, wanted);
            return Ok(None);
        }
        self.report(cx, result, wanted).map(Some)
    }
}
