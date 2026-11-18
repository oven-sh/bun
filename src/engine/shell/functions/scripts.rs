//! Running and checking code, and making realms.

use std::time::Instant;

use bun_engine_vm::{
    CompileError, GlobalObject, SourceCode, SourceType, evaluate_script, origin_of_caller,
    throw_compile_error,
};

use super::io::url_from_arguments;
use super::{put, string, to_text};
use crate::prelude::*;
use crate::{files, global};

pub(super) const FUNCTIONS: Functions = &[
    ("run", run, 1),
    ("runString", run_string, 1),
    ("load", load, 1),
    ("loadString", load_string, 1),
    ("checkSyntax", check_syntax, 1),
    ("checkModuleSyntax", check_module_syntax, 1),
    ("checkScriptSyntax", check_script_syntax, 1),
    ("callerSourceOrigin", caller_source_origin, 0),
    ("createGlobalObject", create_global_object, 0),
];

fn milliseconds_since(cx: &Cx, start: Instant) -> Value {
    if State::of(cx).command_line().is_deterministic {
        return Value::ZERO;
    }
    (start.elapsed().as_millis() as u64).into()
}

fn read_script(cx: &Cx, path: &str) -> JsResult<SourceCode> {
    match files::read_code(path) {
        Some(bytes) => {
            let source = files::source_at(path, &bytes, SourceType::Program);
            super::use_disk_cache(cx, &source, path);
            Ok(source)
        }
        None => Err(cx.throw_error(ErrorType::Error, "Could not open file.")),
    }
}

pub(super) fn script_from_caller(cx: &mut Cx, text: Value) -> JsResult<SourceCode> {
    let text = text.to_string_ref(cx)?;
    let origin = origin_of_caller(cx);
    Ok(files::source(
        text,
        origin.as_deref(),
        None,
        SourceType::Program,
    ))
}

pub(super) fn evaluate_in(
    cx: &mut Cx,
    realm: Gc<GlobalObject>,
    source: &SourceCode,
) -> JsResult<Value> {
    let result = evaluate_script(cx.in_realm(realm), source, Value::UNDEFINED);
    if cx.has_pending_termination_exception() {
        cx.is_execution_forbidden().set(true);
    }
    result
}

fn create_realm_with_arguments(cx: &mut Cx, arguments: &[Value]) -> JsResult<Gc<GlobalObject>> {
    let realm = global::create(cx);
    let cx = cx.in_realm(realm);
    put(
        cx,
        &realm,
        "arguments",
        cx.new_array_from(arguments)?.into(),
    );
    Ok(realm)
}

#[native_abi]
fn run(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let path = to_text(cx, frame.argument(0))?;
    let source = read_script(cx, &path)?;
    let realm = create_realm_with_arguments(cx, frame.rest(1))?;
    let start = Instant::now();
    evaluate_in(cx, realm, &source)?;
    Ok(milliseconds_since(cx, start))
}

#[native_abi]
fn run_string(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let source = script_from_caller(cx, frame.argument(0))?;
    let realm = create_realm_with_arguments(cx, frame.rest(1))?;
    evaluate_in(cx, realm, &source)?;
    Ok(realm.global_this().into())
}

#[native_abi]
fn load(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let path = files::path_of_url(&url_from_arguments(cx, frame)?);
    let source = read_script(cx, &path)?;
    evaluate_in(cx, cx.global(), &source)
}

#[native_abi]
fn load_string(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let source = script_from_caller(cx, frame.argument(0))?;
    evaluate_in(cx, cx.global(), &source)
}

#[native_abi]
fn check_syntax(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let path = to_text(cx, frame.argument(0))?;
    let source = read_script(cx, &path)?;
    let start = Instant::now();
    match cx.check_script_syntax(&source.provider) {
        Ok(()) => Ok(milliseconds_since(cx, start)),
        Err(error) => Err(throw_compile_error(cx, &error, &source.provider)),
    }
}

/// Throws a string.
fn check_text(
    cx: &mut Cx,
    frame: &CallFrame,
    source_type: SourceType,
    check: impl FnOnce(&Cx, &SourceCode) -> Result<(), CompileError>,
) -> JsResult<Value> {
    let text = frame.argument(0).to_string_ref(cx)?;
    let source = files::source(text, None, None, source_type);
    let start = Instant::now();
    let Err(error) = check(cx, &source) else {
        return Ok(milliseconds_since(cx, start));
    };
    let line = source.provider.position_in_document(error.offset).line;
    let message = format!("SyntaxError: {}:{line}", error.message);
    Err(cx.throw(string(cx, &message)))
}

#[native_abi]
fn check_module_syntax(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    check_text(cx, frame, SourceType::Module, |cx, source| {
        cx.check_module_syntax(&source.provider)
    })
}

#[native_abi]
fn check_script_syntax(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    check_text(cx, frame, SourceType::Program, |cx, source| {
        cx.check_script_syntax(&source.provider)
    })
}

#[native_abi]
fn caller_source_origin(cx: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    let url = origin_of_caller(cx).and_then(|origin| origin.url().cloned());
    Ok(url.map_or(Value::NULL, |url| JsString::new(cx, url).into()))
}

#[native_abi]
pub(super) fn create_global_object(cx: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    Ok(global::create(cx).global_this().into())
}
