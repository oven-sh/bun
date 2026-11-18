use core::ffi::c_void;

use bun_engine_macros::export;
use bun_engine_text::{StringRef, Text};
use bun_engine_vm::json::{self, ParsedLines, Source};
use bun_engine_vm::{Cx, Gc, JsResult, JsString, Value, ValueVec, Vm};

#[export]
fn json_parse(cx: &Cx, text: Text<'_>) -> JsResult<Value> {
    json::parse(cx, text.into())
}

#[export]
fn json_try_parse(cx: &Cx, text: Text<'_>) -> JsResult<Option<Value>> {
    json::try_parse(cx, text.into())
}

#[export]
fn json_try_parse_utf8(cx: &Cx, utf8: &[u8]) -> JsResult<Option<Value>> {
    json::try_parse(cx, Source::from_utf8(utf8))
}

#[export]
fn json_stringify(cx: &mut Cx, value: Value, space: Value) -> JsResult<Option<StringRef>> {
    json::stringify(cx, value, Value::NULL, space)
}

#[export]
fn json_try_make_string(vm: &Vm, text: Text<'_>) -> Option<Gc<JsString>> {
    const MAX_SHARED_LENGTH: usize = 16;
    if text.len() <= MAX_SHARED_LENGTH {
        return JsString::try_from_text_as_atom(vm, text).ok();
    }
    JsString::try_from_text(vm, text).ok()
}

/// Returns a `LinesEnd`.
///
/// # Safety
/// `receive` and `context` go together.
unsafe fn parse_lines(
    parse: impl FnOnce(&mut ValueVec) -> JsResult<ParsedLines>,
    read: &mut usize,
    receive: unsafe extern "C" fn(*mut c_void, *const Value, usize),
    context: *mut c_void,
) -> JsResult<u8> {
    let mut values = ValueVec::new();
    let parsed = parse(&mut values)?;
    // SAFETY: the caller's.
    unsafe { receive(context, values.as_ptr(), values.len()) };
    *read = parsed.read;
    Ok(parsed.end as u8)
}

#[export]
unsafe fn json_parse_lines(
    cx: &Cx,
    text: Text<'_>,
    read: &mut usize,
    receive: unsafe extern "C" fn(*mut c_void, *const Value, usize),
    context: *mut c_void,
) -> JsResult<u8> {
    let parse = |values: &mut ValueVec| json::parse_lines(cx, text, values);
    // SAFETY: C++ sees to it.
    unsafe { parse_lines(parse, read, receive, context) }
}

#[export]
unsafe fn json_parse_lines_utf8(
    cx: &Cx,
    utf8: &[u8],
    read: &mut usize,
    receive: unsafe extern "C" fn(*mut c_void, *const Value, usize),
    context: *mut c_void,
) -> JsResult<u8> {
    let parse = |values: &mut ValueVec| json::parse_utf8_lines(cx, utf8, values);
    // SAFETY: as above.
    unsafe { parse_lines(parse, read, receive, context) }
}
