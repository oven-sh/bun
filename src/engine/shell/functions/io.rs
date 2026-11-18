//! Printing, files and leaving.

use std::io::{BufRead, Write};

use bun_engine_vm::{
    JsArrayBuffer, JsArrayBufferView, JsUint8Array, StackVisitor, origin_of_caller,
};

use super::{to_console_text, to_text, to_utf8};
use crate::prelude::*;
use crate::{files, run};

pub(super) const FUNCTIONS: Functions = &[
    ("debug", debug, 1),
    ("print", print, 1),
    ("printErr", print_err, 1),
    ("prettyPrint", pretty_print, 1),
    ("printStack", print_stack, 1),
    ("quit", quit, 0),
    ("readFile", read_file, 2),
    ("read", read_file, 2),
    ("writeFile", write_file, 2),
    ("write", write_file, 2),
    ("readline", read_line, 0),
];

fn write_line(
    cx: &mut Cx,
    frame: &CallFrame,
    out: &mut dyn Write,
    convert: fn(&mut Cx, Value) -> JsResult<Vec<u8>>,
) -> JsResult<Value> {
    let state = State::of(cx);
    if state.expected_async_passes.get() != 0
        && let Some(text) = frame.argument(0).as_string()
        && text.view(cx)?.text().eq_ascii("Test262:AsyncTestComplete")
    {
        state.async_passes.update(|passes| passes + 1);
        return Ok(Value::UNDEFINED);
    }
    for (index, &argument) in frame.arguments().iter().enumerate() {
        if index != 0 {
            let _ = out.write_all(b" ");
        }
        let _ = out.write_all(&convert(cx, argument)?);
    }
    let _ = out.write_all(b"\n");
    Ok(Value::UNDEFINED)
}

#[native_abi]
pub(super) fn print(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    write_line(cx, frame, &mut std::io::stdout(), to_utf8)
}

#[native_abi]
pub(super) fn print_err(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    write_line(cx, frame, &mut std::io::stderr(), to_utf8)
}

#[native_abi]
fn pretty_print(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    write_line(cx, frame, &mut std::io::stdout(), to_console_text)
}

#[native_abi]
fn debug(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let text = to_utf8(cx, frame.argument(0))?;
    let _ = std::io::stderr().write_all(&[b"--> ", &text[..], b"\n"].concat());
    Ok(Value::UNDEFINED)
}

#[native_abi]
pub(super) fn print_stack(cx: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    eprintln!("--> Stack trace:");
    for (index, frame) in StackVisitor::frames(cx).enumerate() {
        let name = (frame.callee).map_or_default(|callee| bun_engine_vm::display_name(&callee));
        let position = (frame.code_block).map(|it| it.line_column(frame.bytecode_offset));
        eprintln!("    {index}   {name} {position:?}");
    }
    Ok(Value::UNDEFINED)
}

#[native_abi]
fn quit(_: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    run::exit(0)
}

/// The URL of the first argument, which the second can declare to be relative to the calling script.
pub(super) fn url_from_arguments(cx: &mut Cx, frame: &CallFrame) -> JsResult<String> {
    let is_relative_to_caller = match frame.argument(1).as_string() {
        Some(mode) => mode.view(cx)?.text().eq_ascii("caller relative"),
        None => false,
    };
    let path = to_text(cx, frame.argument(0))?;
    if !is_relative_to_caller {
        return Ok(files::absolute_url(&path));
    }
    let base = origin_of_caller(cx).and_then(|origin| Some(origin.url()?.to_string()));
    match base.filter(|base| files::is_file_url(base)) {
        Some(base) => Ok(files::resolve(&base, &path)),
        None => Err(cx.throw_error(
            ErrorType::UriError,
            format_args!("caller relative URL path is not a local file: {path}"),
        )),
    }
}

#[native_abi]
fn read_file(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let mut is_binary = false;
    if frame.argument_count() > 1 {
        let mode = to_text(cx, frame.argument(1))?;
        is_binary = mode == "binary";
        if !is_binary && mode != "caller relative" {
            let message = "Expected 'binary' or 'caller relative' as second argument.";
            return Err(cx.throw_error(ErrorType::Error, message));
        }
    }
    let path = files::path_of_url(&url_from_arguments(cx, frame)?);
    let Some(bytes) = files::read(&path) else {
        let message = format_args!("Could not open file: {path}");
        return Err(cx.throw_error(ErrorType::Error, message));
    };
    if is_binary {
        return JsUint8Array::from_vec(cx, cx.uint8_array_shape(), bytes).map(Into::into);
    }
    Ok(JsString::new(cx, files::decode(&bytes)).into())
}

#[native_abi]
fn write_file(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let path = to_text(cx, frame.argument(0))?;
    let data = frame.argument(1);
    let bytes = if let Some(buffer) = data.downcast::<JsArrayBuffer>() {
        let bytes = buffer.bytes(&cx.no_gc()).try_to_vec();
        cx.or_out_of_memory(bytes)?
    } else if let Some(view) = data.downcast::<JsArrayBufferView>() {
        let bytes = view.bytes(&cx.no_gc()).try_to_vec();
        cx.or_out_of_memory(bytes)?
    } else {
        to_utf8(cx, data)?
    };
    match std::fs::write(path, &bytes) {
        Ok(()) => Ok(bytes.len().into()),
        Err(_) => Err(cx.throw_error(ErrorType::Error, "Could not open file.")),
    }
}

#[native_abi]
fn read_line(cx: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    let mut line = Vec::new();
    let _ = std::io::stdin().lock().read_until(b'\n', &mut line);
    line.pop_if(|last| *last == b'\n');
    Ok(JsString::new(cx, StringRef::from_latin1(&line)).into())
}
