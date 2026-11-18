//! Base64 and hex.

use bun_engine_text::{Base64Alphabet, Cursor, LastChunkHandling, Progress, StringRef};
use bun_engine_vm::{Attributes, JsFinalObject, JsTypedArray, JsUint8Array};

use crate::prelude::*;

fn this_array(cx: &Cx, frame: &CallFrame, method: &str) -> JsResult<Gc<JsUint8Array>> {
    frame.this_value().downcast().ok_or_else(|| {
        cx.throw_type_error(format_args!(
            "{method} requires that |this| be a Uint8Array"
        ))
    })
}

fn string_argument(cx: &Cx, frame: &CallFrame, method: &str) -> JsResult<Gc<JsString>> {
    let string = frame.argument(0).as_string();
    string.ok_or_else(|| cx.throw_type_error(format_args!("{method} requires a string")))
}

/// GetOptionsObject, without making one.
fn options_object(cx: &Cx, options: Value, method: &str) -> JsResult<Option<Gc<JsObject>>> {
    if !options.is_undefined() && !options.is_object() {
        let message = format_args!("{method} requires that options be an object");
        return Err(cx.throw_type_error(message));
    }
    Ok(options.as_object())
}

/// The first choice is the default. `None` if the value is none of them.
fn choose<T: Copy>(cx: &Cx, value: Value, choices: &[(&str, T)]) -> JsResult<Option<T>> {
    let Some(string) = value.as_string() else {
        return Ok(value.is_undefined().then(|| choices[0].1));
    };
    let view = string.view(cx)?;
    let choice = choices.iter().find(|it| view.text().eq_ascii(it.0));
    Ok(choice.map(|it| it.1))
}

fn alphabet_option(cx: &mut Cx, options: &JsObject, method: &str) -> JsResult<Base64Alphabet> {
    let value = options.get(cx, names::alphabet)?;
    let choices = [
        ("base64", Base64Alphabet::Standard),
        ("base64url", Base64Alphabet::Url),
    ];
    choose(cx, value, &choices)?.ok_or_else(|| {
        cx.throw_type_error(format_args!(
            "{method} requires that alphabet be \"base64\" or \"base64url\""
        ))
    })
}

fn decoding_options(
    cx: &mut Cx,
    options: Value,
    method: &str,
) -> JsResult<(Base64Alphabet, LastChunkHandling)> {
    let Some(options) = options_object(cx, options, method)? else {
        return Ok((Base64Alphabet::Standard, LastChunkHandling::Loose));
    };
    let alphabet = alphabet_option(cx, &options, method)?;
    let value = options.get(cx, names::lastChunkHandling)?;
    let choices = [
        ("loose", LastChunkHandling::Loose),
        ("strict", LastChunkHandling::Strict),
        ("stop-before-partial", LastChunkHandling::StopBeforePartial),
    ];
    match choose(cx, value, &choices)? {
        Some(last) => Ok((alphabet, last)),
        None => Err(cx.throw_type_error(format_args!(
            "{method} requires that lastChunkHandling be \"loose\", \"strict\", or \"stop-before-partial\""
        ))),
    }
}

pub(super) fn initialize_result_shape(cx: &Cx) {
    let shape = [names::read, names::written]
        .into_iter()
        .fold(cx.object_shape(), |shape, name| {
            shape.add_property_transition(cx, name, Attributes::NONE).0
        });
    cx.global().init_decoding_result_shape(shape);
}

fn progress_object(cx: &Cx, progress: Progress) -> Value {
    let values = [progress.read.into(), progress.written.into()];
    JsFinalObject::create_with_values(cx, cx.decoding_result_shape(), &values).into()
}

#[native_abi]
pub(super) fn from_base64(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let method = "Uint8Array.fromBase64";
    let string = string_argument(cx, frame, method)?;
    let (alphabet, last) = decoding_options(cx, frame.argument(1), method)?;
    let view = string.view(cx)?;
    let (mut bytes, mut result) = (Vec::new(), Ok(()));
    let capacity = view.text().base64_decoded_capacity();
    cx.or_out_of_memory(Cursor::extend_vec(&mut bytes, capacity, |to| {
        result = view.text().decode_base64(alphabet, last, to);
    }))?;
    result.map_err(|error| cx.throw_syntax_error(error.message()))?;
    JsUint8Array::from_vec(cx, cx.uint8_array_shape(), bytes).map(Into::into)
}

#[native_abi]
pub(super) fn from_hex(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let view = string_argument(cx, frame, "Uint8Array.fromHex")?.view(cx)?;
    let (shape, length, mut result) = (cx.uint8_array_shape(), view.text().len() / 2, Ok(()));
    let array = JsTypedArray::create_filled(cx, shape, length, |_, filler| {
        filler.write(|to| result = view.text().decode_hex(to));
    })?;
    result.map_err(|error| cx.throw_syntax_error(error.message()))?;
    Ok(array.into())
}

#[native_abi]
pub(super) fn set_from_base64(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let method = "Uint8Array.prototype.setFromBase64";
    let this = this_array(cx, frame, method)?;
    let string = string_argument(cx, frame, method)?;
    let (alphabet, last) = decoding_options(cx, frame.argument(1), method)?;
    this.validate(cx)?;
    let view = string.view(cx)?;
    let progress = this.set_from_base64(cx, view.text(), alphabet, last)?;
    Ok(progress_object(cx, progress))
}

#[native_abi]
pub(super) fn set_from_hex(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let method = "Uint8Array.prototype.setFromHex";
    let this = this_array(cx, frame, method)?;
    this.validate(cx)?;
    let view = string_argument(cx, frame, method)?.view(cx)?;
    let progress = this.set_from_hex(cx, view.text())?;
    Ok(progress_object(cx, progress))
}

#[native_abi]
pub(super) fn to_base64(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let method = "Uint8Array.prototype.toBase64";
    let this = this_array(cx, frame, method)?;
    let (mut alphabet, mut omits_padding) = (Base64Alphabet::Standard, false);
    if let Some(options) = options_object(cx, frame.argument(0), method)? {
        alphabet = alphabet_option(cx, &options, method)?;
        omits_padding = options.get(cx, names::omitPadding)?.to_boolean(cx);
    }
    this.validate(cx)?;
    let encode = |bytes: &[u8]| StringRef::try_base64_of(bytes, alphabet, omits_padding);
    match this.encode(cx, encode) {
        Ok(text) => Ok(JsString::new(cx, text).into()),
        Err(_) => Err(cx.throw_out_of_memory_with("Out of memory: generated stirng is too long")),
    }
}

#[native_abi]
pub(super) fn to_hex(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this = this_array(cx, frame, "Uint8Array.prototype.toHex")?;
    this.validate(cx)?;
    match this.encode(cx, StringRef::try_hex_of) {
        Ok(text) => Ok(JsString::new(cx, text).into()),
        Err(_) => Err(cx.throw_out_of_memory_with("Out of memory: generated string is too long")),
    }
}
