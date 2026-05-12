use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
#[allow(unused_imports)] use super::{JSValueTestExt, JSGlobalObjectTestExt, BigIntCompare, make_formatter};
use bun_jsc::console_object::Formatter;
use super::Expect;
use super::get_signature;

static JS_TYPE_OF_MAP: phf::Map<&'static [u8], &'static [u8]> = phf::phf_map! {
    b"function" => b"function",
    b"object" => b"object",
    b"bigint" => b"bigint",
    b"boolean" => b"boolean",
    b"number" => b"number",
    b"string" => b"string",
    b"symbol" => b"symbol",
    b"undefined" => b"undefined",
};

// TODO(port): #[bun_jsc::host_fn(method)] — must be inside `impl Expect`; shim wired by JsClass codegen
pub fn to_be_type_of(
    this: &Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    let (this, value, not) = this.matcher_prelude(global, frame.this(), "toBeTypeOf", "")?;
    let _arguments = frame.arguments_old::<1>();
    let arguments = _arguments.slice();

    if arguments.len() < 1 {
        return Err(global.throw_invalid_arguments(format_args!("toBeTypeOf() requires 1 argument")));
    }

    let expected = arguments[0];
    expected.ensure_still_alive();

    if !expected.is_string() {
        return Err(global.throw_invalid_arguments(format_args!("toBeTypeOf() requires a string argument")));
    }

    let expected_type = expected.to_bun_string(global)?;
    // `defer expected_type.deref()` — handled by Drop on bun_core::String.

    let expected_utf8 = expected_type.to_utf8();
    let Some(typeof_) = JS_TYPE_OF_MAP.get(expected_utf8.slice()).copied() else {
        return Err(global.throw_invalid_arguments(format_args!(
            "toBeTypeOf() requires a valid type string argument ('function', 'object', 'bigint', 'boolean', 'number', 'string', 'symbol', 'undefined')"
        )));
    };

    let mut pass = false;
    let mut what_is_the_type: &'static [u8] = b"";

    // Checking for function/class should be done before everything else, or it will fail.
    if value.is_callable() {
        what_is_the_type = b"function";
    } else if value.is_object() || value.js_type().is_array() || value.is_null() {
        what_is_the_type = b"object";
    } else if value.is_big_int() {
        what_is_the_type = b"bigint";
    } else if value.is_boolean() {
        what_is_the_type = b"boolean";
    } else if value.is_number() {
        what_is_the_type = b"number";
    } else if value.js_type().is_string() {
        what_is_the_type = b"string";
    } else if value.is_symbol() {
        what_is_the_type = b"symbol";
    } else if value.is_undefined() {
        what_is_the_type = b"undefined";
    } else {
        return Err(global.throw(format_args!("Internal consistency error: unknown JSValue type")));
    }

    pass = typeof_ == what_is_the_type;

    if not {
        pass = !pass;
    }
    if pass {
        return Ok(JSValue::UNDEFINED);
    }

    let mut formatter = super::make_formatter(global);
    // PORT NOTE: ZigFormatter borrows &mut Formatter for its lifetime; need a second formatter
    // so `received` and `expected_str` can coexist in one format_args!.
    let mut formatter2 = super::make_formatter(global);
    // `defer formatter.deinit()` — handled by Drop.
    let received = value.to_fmt(&mut formatter);
    let expected_str = expected.to_fmt(&mut formatter2);

    if not {
        let signature = get_signature("toBeTypeOf", "", true);
        return this.throw(
            global,
            signature,
            format_args!(
                concat!(
                    "\n\n",
                    "Expected type: not <green>{}<r>\n",
                    "Received type: <red>\"{}\"<r>\nReceived value: <red>{}<r>\n",
                ),
                expected_str,
                bstr::BStr::new(what_is_the_type),
                received,
            ),
        );
    }

    let signature = get_signature("toBeTypeOf", "", false);
    this.throw(
        global,
        signature,
        format_args!(
            concat!(
                "\n\n",
                "Expected type: <green>{}<r>\n",
                "Received type: <red>\"{}\"<r>\nReceived value: <red>{}<r>\n",
            ),
            expected_str,
            bstr::BStr::new(what_is_the_type),
            received,
        ),
    )
}

// ported from: src/test_runner/expect/toBeTypeOf.zig
