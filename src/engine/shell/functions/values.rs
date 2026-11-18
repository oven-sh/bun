//! How values are represented, and values that scripts cannot make.

use bun_engine_macros::cell;
use bun_engine_number::Random;
use bun_engine_text::{Base64Alphabet, LastChunkHandling, Text};
use bun_engine_vm::ValueVec;
use bun_engine_vm::json::{self, LinesEnd};
use bun_engine_vm::{
    InternalFunction, JsArrayBuffer, JsArrayBufferView, JsFunctionWithFields, RealmWatchpoint,
    Shape, ShapeSpec, TypeFlags, call,
};

use super::{put, return_false, return_undefined, string};
use crate::prelude::*;

pub(super) const FUNCTIONS: Functions = &[
    ("atob", atob, 1),
    ("btoa", btoa, 1),
    ("streamingJSONParse", parse_json_lines, 1),
    ("describe", describe, 1),
    ("describeArray", describe_array, 1),
    ("addressOf", address_of, 1),
    ("version", return_undefined, 1),
    ("isInt32", is_int32, 0),
    ("isPureNaN", is_pure_nan, 0),
    ("asDoubleNumber", as_double_number, 1),
    ("makeMasquerader", make_masquerader, 0),
    ("createHeapBigInt", create_heap_bigint, 1),
    ("isHeapBigInt", is_heap_bigint, 1),
    ("is8BitString", is_8_bit_string, 1),
    ("isRope", is_rope, 1),
    ("createNonRopeNonAtomString", create_plain_string, 1),
    ("is32BitPlatform", return_false, 0),
    ("maxArguments", max_arguments, 0),
    ("transferArrayBuffer", transfer_array_buffer, 1),
    ("ensureArrayStorage", ensure_array_storage, 0),
    ("hasCustomProperties", has_custom_properties, 0),
    ("getRandomSeed", get_random_seed, 0),
    ("setRandomSeed", set_random_seed, 1),
    (
        "createNoopNativeFunctionWithCapture",
        create_function_with_capture,
        1,
    ),
];

#[native_abi]
pub(super) fn describe(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let value = frame.arguments().first();
    Ok(value.map_or_default(|it| JsString::new(cx, it.describe()).into()))
}

pub(super) fn indexing_mode_name(object: &JsObject) -> String {
    let mut name = String::new();
    let _ = object.indexing_mode().describe(&mut name);
    name
}

#[native_abi]
fn describe_array(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let Some(&value) = frame.arguments().first() else {
        return Ok(Value::UNDEFINED);
    };
    let Some(object) = value.as_object() else {
        return Ok(string(cx, "<not object>"));
    };
    let storage = match object.cell_type().has_storage() {
        true => object.storage().address(),
        false => 0,
    };
    let (length, capacity) = (object.public_length(), object.vector_length());
    let text =
        format!("<Butterfly: {storage:#x}; public length: {length}; vector length: {capacity}>");
    Ok(string(cx, &text))
}

#[native_abi]
fn address_of(_: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let cell = frame.argument(0).as_cell();
    Ok(cell.map_or_default(|cell| f64::from_bits(cell.address() as u64).into()))
}

#[native_abi]
fn is_int32(_: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    Ok(frame.arguments().iter().all(|it| it.is_int32()).into())
}

#[native_abi]
fn is_pure_nan(_: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let is_nan = |it: &Value| it.as_number().is_some_and(f64::is_nan);
    Ok(frame.arguments().iter().all(is_nan).into())
}

#[native_abi]
fn as_double_number(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    frame.argument(0).to_number(cx).map(Value::double)
}

/// An object with an `[[IsHTMLDDA]]` slot.
#[cell(name = "Function", flags = TypeFlags::MASQUERADES_AS_UNDEFINED)]
struct Masquerader {
    base: InternalFunction,
}

#[native_abi]
fn call_masquerader(_: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    Ok(Value::NULL)
}

pub(super) fn create_masquerader(cx: &Cx) -> Value {
    let (global, spec) = (cx.global(), ShapeSpec::of::<Masquerader>());
    let shape = Shape::create(cx, Some(global), cx.object_prototype().into(), spec);
    (global.watchpoints_unchecked(RealmWatchpoint::NoObjectMasqueradesAsUndefined)).invalidate(cx);
    let base = InternalFunction::init(cx, shape, call_masquerader, None);
    let function = cx.allocate::<Masquerader>(MasqueraderInit { base });
    function.define_length_and_name(cx, 0, JsString::from_literal(cx, "IsHTMLDDA"));
    function.into()
}

#[native_abi]
fn make_masquerader(cx: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    Ok(create_masquerader(cx))
}

#[native_abi]
fn create_heap_bigint(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    frame.argument(0).to_bigint(cx).map(Into::into)
}

#[native_abi]
fn is_heap_bigint(_: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    Ok(frame.argument(0).is_bigint().into())
}

#[native_abi]
fn is_8_bit_string(_: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let string = frame.argument(0).as_string();
    Ok(string.is_some_and(|it| it.is_latin1()).into())
}

#[native_abi]
fn is_rope(_: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let string = frame.argument(0).as_string();
    Ok(string.is_some_and(|it| it.is_rope()).into())
}

#[native_abi]
fn create_plain_string(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let view = frame.argument(0).to_string_view(cx)?;
    if view.text().len() <= 1 {
        return Err(cx.throw_type_error("empty / one-length string can be always atom string"));
    }
    cx.new_string(view.text()).map(Into::into)
}

#[native_abi]
fn max_arguments(cx: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    let words = (cx.stack_bounds().origin - cx.soft_stack_limit()) / size_of::<Value>();
    Ok(words.min(call::MAX_ARGUMENTS).into())
}

#[native_abi]
pub(super) fn transfer_array_buffer(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    if frame.argument_count() == 0 {
        return Err(cx.throw_error(ErrorType::Error, "Not enough arguments"));
    }
    let Some(buffer) = frame.argument(0).downcast::<JsArrayBuffer>() else {
        return Err(cx.throw_error(ErrorType::Error, "Expected an array buffer"));
    };
    if !buffer.is_shared() && buffer.buffer().is_detachable() {
        buffer.buffer().detach(cx);
    }
    Ok(Value::UNDEFINED)
}

#[native_abi]
pub(super) fn ensure_array_storage(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    for object in frame.arguments().iter().filter_map(|it| it.as_object()) {
        if !object.is::<JsArrayBufferView>() && object.cell_type().has_storage() {
            cx.or_out_of_memory(object.convert_to_sparse(cx))?;
        }
    }
    Ok(Value::UNDEFINED)
}

#[native_abi]
fn has_custom_properties(_: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let object = frame.argument(0).as_object();
    Ok(object.is_some_and(|it| it.shape().slot_count() != 0).into())
}

#[native_abi]
fn get_random_seed(cx: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    Ok(cx.global().random_state().get().seed().into())
}

#[native_abi]
fn set_random_seed(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let seed = frame.argument(0).to_uint32(cx)?;
    cx.global().random_state().set(Random::new(seed));
    Ok(Value::UNDEFINED)
}

#[native_abi]
fn return_capture(_: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    Ok(JsFunctionWithFields::fields_of_callee(frame)[0])
}

#[native_abi]
fn create_function_with_capture(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let fields = [frame.argument(0), Value::UNDEFINED];
    Ok(JsFunctionWithFields::new(cx, 0, return_capture, fields).into())
}

#[native_abi]
fn atob(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    const INVALID: &str = "Invalid character in argument for atob.";
    if frame.argument_count() == 0 {
        return Err(cx.throw_error(ErrorType::Error, "Missing input for atob."));
    }
    if frame.argument(0).is_undefined() {
        return Err(cx.throw_error(ErrorType::Error, INVALID));
    }
    let view = frame.argument(0).to_string_view(cx)?;
    let mut bytes = vec![0; view.text().base64_decoded_capacity()];
    let (alphabet, last) = (Base64Alphabet::Standard, LastChunkHandling::Loose);
    match view.text().decode_base64_into(alphabet, last, &mut bytes) {
        Ok(progress) if progress.read == view.text().len() => {
            (cx.new_string(Text::Latin1(&bytes[..progress.written]))).map(Into::into)
        }
        _ => Err(cx.throw_error(ErrorType::Error, INVALID)),
    }
}

#[native_abi]
fn btoa(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    if frame.argument_count() == 0 {
        return Err(cx.throw_error(ErrorType::Error, "Missing input for btoa."));
    }
    let view = frame.argument(0).to_string_view(cx)?;
    let text = cx.or_out_of_memory(StringRef::try_narrowed(view.text()))?;
    let Text::Latin1(bytes) = text.text() else {
        let message = "Invalid character in argument for btoa.";
        return Err(cx.throw_error(ErrorType::Error, message));
    };
    let encoded = StringRef::try_base64_of(bytes, Base64Alphabet::Standard, false);
    Ok(JsString::new(cx, cx.or_out_of_memory(encoded)?).into())
}

#[native_abi]
fn parse_json_lines(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let (view, mut values) = (frame.argument(0).to_string_view(cx)?, ValueVec::new());
    let parsed = json::parse_lines(cx, view.text(), &mut values)?;
    let status = match parsed.end {
        LinesEnd::Complete => "complete",
        LinesEnd::NeedsMoreText => "needMoreData",
        LinesEnd::SyntaxError => "error",
    };
    let result = cx.new_object();
    put(cx, &result, "values", cx.new_array_from(&values)?.into());
    put(cx, &result, "charactersConsumed", parsed.read.into());
    put(cx, &result, "status", string(cx, status));
    Ok(result.into())
}
