use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use super::Expect;
use super::get_signature;
use super::throw;

bun_core::comptime_string_map! {
    static JS_TYPE_OF_MAP: &'static [u8] = {
        b"function" => b"function",
        b"object" => b"object",
        b"bigint" => b"bigint",
        b"boolean" => b"boolean",
        b"number" => b"number",
        b"string" => b"string",
        b"symbol" => b"symbol",
        b"undefined" => b"undefined",
    };
}

// Free fn (this module can't open `impl Expect`); bridged into `impl Expect` by the
// `__forward_matcher!` macro in expect.rs, where the JsClass codegen host_fn shim picks it up.
pub(crate) fn to_be_type_of(
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

    let expected_type = bun_core::OwnedString::new(expected.to_bun_string(global)?);

    let expected_utf8 = expected_type.to_utf8();
    let Some(typeof_) = JS_TYPE_OF_MAP.get(expected_utf8.slice()).copied() else {
        return Err(global.throw_invalid_arguments(format_args!(
            "toBeTypeOf() requires a valid type string argument ('function', 'object', 'bigint', 'boolean', 'number', 'string', 'symbol', 'undefined')"
        )));
    };

    // Checking for function/class should be done before everything else, or it will fail.
    let what_is_the_type: &'static [u8] = if value.is_callable() {
        b"function"
    } else if value.is_object() || value.js_type().is_array() || value.is_null() {
        b"object"
    } else if value.is_big_int() {
        b"bigint"
    } else if value.is_boolean() {
        b"boolean"
    } else if value.is_number() {
        b"number"
    } else if value.js_type().is_string() {
        b"string"
    } else if value.is_symbol() {
        b"symbol"
    } else if value.is_undefined() {
        b"undefined"
    } else {
        return Err(global.throw(format_args!("Internal consistency error: unknown JSValue type")));
    };

    let mut pass = typeof_ == what_is_the_type;

    if not {
        pass = !pass;
    }
    if pass {
        return Ok(JSValue::UNDEFINED);
    }

    let mut formatter = super::make_formatter(global);
    // ZigFormatter borrows &mut Formatter for its lifetime; need a second formatter
    // so `received` and `expected_str` can coexist in one format_args!.
    let mut formatter2 = super::make_formatter(global);
    // `defer formatter.deinit()` — handled by Drop.
    let received = value.to_fmt(&mut formatter);
    let expected_str = expected.to_fmt(&mut formatter2);

    if not {
        let signature = get_signature("toBeTypeOf", "", true);
        return throw!(
            this,
            global,
            signature,
            concat!(
                "\n\n",
                "Expected type: not <green>{}<r>\n",
                "Received type: <red>\"{}\"<r>\nReceived value: <red>{}<r>\n",
            ),
            expected_str,
            bstr::BStr::new(what_is_the_type),
            received,
        );
    }

    let signature = get_signature("toBeTypeOf", "", false);
    throw!(
        this,
        global,
        signature,
        concat!(
            "\n\n",
            "Expected type: <green>{}<r>\n",
            "Received type: <red>\"{}\"<r>\nReceived value: <red>{}<r>\n",
        ),
        expected_str,
        bstr::BStr::new(what_is_the_type),
        received,
    )
}
