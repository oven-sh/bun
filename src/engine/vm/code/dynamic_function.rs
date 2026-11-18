//! CreateDynamicFunction of ECMA-262.

use bun_engine_text::{StringBuilder, StringRef};

use super::eval::generated_source;
use crate::{
    Cx, FunctionExecutable, Gc, GlobalObject, JsFunction, JsObject, JsResult, SourceProviderRef,
    Value, Weak, origin_of_caller, throw_compile_error,
};

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum DynamicFunctionKind {
    Normal,
    Generator,
    Async,
    AsyncGenerator,
}

/// What was made last, for a program that asks for the same again.
pub(super) struct LastFunction {
    executable: Weak<FunctionExecutable>,
    global: Weak<GlobalObject>,
    parameters_end: Option<u32>,
    origin: Option<SourceProviderRef>,
}

fn executable_for(
    cx: &mut Cx,
    text: StringRef,
    parameters_end: Option<u32>,
) -> JsResult<Gc<FunctionExecutable>> {
    let origin = origin_of_caller(cx);
    let address = |it: &Option<SourceProviderRef>| it.as_deref().map(core::ptr::from_ref);
    let is_plain = cx.global().instrumentation(cx).is_empty();
    if let Some(last) = &*cx.services.code.last_function.borrow()
        && let Some(executable) = last.executable.get(cx)
        && is_plain
        && last.global.get(cx) == Some(cx.global())
        && last.parameters_end == parameters_end
        && address(&last.origin) == address(&origin)
        && *executable.provider().source() == text
    {
        return Ok(executable);
    }
    // The object of a tagged template is new for each evaluation of the text.
    let is_reusable = is_plain && !text.text().contains_unit(b'`'.into());
    let provider = generated_source(cx, text, origin.as_deref()).provider;
    let function = (cx.compile_single_function(&provider, parameters_end))
        .map_err(|error| throw_compile_error(cx, &error, &provider))?;
    let executable = FunctionExecutable::create(cx, provider, function);
    if is_reusable {
        cx.services.code.last_function.replace(Some(LastFunction {
            executable: Weak::new(cx, executable),
            global: Weak::new(cx, cx.global()),
            parameters_end,
            origin,
        }));
    }
    Ok(executable)
}

/// `arguments` are the parameters and the body. `new_target` is undefined in a call without `new`.
pub fn create_dynamic_function(
    cx: &mut Cx,
    kind: DynamicFunctionKind,
    constructor: &JsObject,
    new_target: Value,
    arguments: &[Value],
) -> JsResult<Gc<JsFunction>> {
    let mut text = StringBuilder::new();
    text.push_ascii(match kind {
        DynamicFunctionKind::Normal => "function anonymous(",
        DynamicFunctionKind::Generator => "function* anonymous(",
        DynamicFunctionKind::Async => "async function anonymous(",
        DynamicFunctionKind::AsyncGenerator => "async function* anonymous(",
    });
    let (body, parameters) = arguments.split_last().unzip();
    let parameters = parameters.unwrap_or_default();
    for (index, parameter) in parameters.iter().enumerate() {
        if index != 0 {
            text.push_latin1(b',');
        }
        text.push_text(parameter.to_string_view(cx)?.text());
    }
    text.push_ascii("\n)");
    let parameters_end = (!parameters.is_empty()).then_some(text.len() as u32);
    text.push_ascii(" {\n");
    if let Some(body) = body {
        text.push_text(body.to_string_view(cx)?.text());
    }
    text.push_ascii("\n}");
    cx.ensure_can_compile_strings()?;
    let text = cx.or_out_of_memory(text.finish())?;

    let executable = executable_for(cx, text, parameters_end)?;
    let shape = cx.shape_from_new_target(new_target, constructor, |global, vm| {
        JsFunction::shape_for(vm, global, &executable)
    })?;
    // SAFETY: compiled for the global scope.
    let function =
        unsafe { JsFunction::create_with_shape(cx, executable, cx.global().cell(), shape) };
    if new_target.is_object() && new_target != constructor.as_value() {
        function.reify_prototype(cx);
    }
    Ok(function)
}
