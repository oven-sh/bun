use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
#[allow(unused_imports)] use super::{JSValueTestExt, JSGlobalObjectTestExt, BigIntCompare, make_formatter};
use bun_jsc::console_object::Formatter;

use super::Expect;

// TODO(port): #[bun_jsc::host_fn(method)] — must be inside `impl Expect`; shim wired by JsClass codegen
pub fn to_be_integer(
    this: &mut Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    // PORT NOTE: reshaped for borrowck — was `defer this.postMatch(global)`; scopeguard would hold
    // `&mut this` across the body, so post_match is called inline before each return instead.

    let this_value = frame.this();
    let value: JSValue = match this.get_value(global, this_value, "toBeInteger", "") {
        Ok(v) => v,
        Err(e) => {
            this.post_match(global);
            return Err(e);
        }
    };

    this.increment_expect_call_counter();

    let not = this.flags.not();
    let pass = value.is_any_int() != not;

    if pass {
        this.post_match(global);
        return Ok(JSValue::UNDEFINED);
    }

    let mut formatter = super::make_formatter(global);
    let received = value.to_fmt(&mut formatter);

    if not {
        let signature: &str = Expect::get_signature("toBeInteger", "", true);
        this.post_match(global);
        return this.throw(
            global,
            signature,
            format_args!(concat!("\n\n", "Received: <red>{}<r>\n"), received),
        );
    }

    let signature: &str = Expect::get_signature("toBeInteger", "", false);
    this.post_match(global);
    this.throw(
        global,
        signature,
        format_args!(concat!("\n\n", "Received: <red>{}<r>\n"), received),
    )
}

// ported from: src/test_runner/expect/toBeInteger.zig
