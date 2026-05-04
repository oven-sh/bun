use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_jsc::console_object::Formatter;
use bun_test_runner::expect::Expect;
use bun_test_runner::expect::get_signature;

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

#[bun_jsc::host_fn(method)]
pub fn to_be_type_of(
    this: &mut Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    // TODO(port): `defer this.postMatch(globalThis)` — scopeguard captures &mut self for the
    // whole body; Phase B may need to reshape (call post_match before each return) for borrowck.
    let _post = scopeguard::guard((), |_| this.post_match(global));

    let this_value = frame.this();
    let _arguments = frame.arguments_old(1);
    let arguments = &_arguments.ptr[0.._arguments.len];

    if arguments.len() < 1 {
        return global.throw_invalid_arguments(format_args!("toBeTypeOf() requires 1 argument"));
    }

    let value: JSValue = this.get_value(global, this_value, "toBeTypeOf", "")?;

    let expected = arguments[0];
    expected.ensure_still_alive();

    if !expected.is_string() {
        return global
            .throw_invalid_arguments(format_args!("toBeTypeOf() requires a string argument"));
    }

    let expected_type = expected.to_bun_string(global)?;
    // `defer expected_type.deref()` — handled by Drop on bun_str::String.
    this.increment_expect_call_counter();

    let Some(typeof_) = expected_type.in_map(&JS_TYPE_OF_MAP) else {
        return global.throw_invalid_arguments(format_args!(
            "toBeTypeOf() requires a valid type string argument ('function', 'object', 'bigint', 'boolean', 'number', 'string', 'symbol', 'undefined')"
        ));
    };

    let not = this.flags.not;
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
        return global.throw(format_args!("Internal consistency error: unknown JSValue type"));
    }

    pass = typeof_ == what_is_the_type;

    if not {
        pass = !pass;
    }
    if pass {
        return Ok(JSValue::UNDEFINED);
    }

    let mut formatter = Formatter {
        global_this: global,
        quote_strings: true,
        ..Default::default()
    };
    // `defer formatter.deinit()` — handled by Drop.
    let received = value.to_fmt(&mut formatter);
    let expected_str = expected.to_fmt(&mut formatter);

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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/expect/toBeTypeOf.zig (93 lines)
//   confidence: medium
//   todos:      1
//   notes:      scopeguard for postMatch holds &mut self; Formatter two-mut-borrow in to_fmt may need reshape
// ──────────────────────────────────────────────────────────────────────────
