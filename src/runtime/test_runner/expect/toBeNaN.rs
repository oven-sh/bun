use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
#[allow(unused_imports)] use super::{JSValueTestExt, JSGlobalObjectTestExt, BigIntCompare, make_formatter};
use bun_jsc::console_object::Formatter;

use super::Expect;
use super::get_signature;

// TODO(port): #[bun_jsc::host_fn(method)] — must be inside `impl Expect`; shim wired by JsClass codegen
pub fn to_be_nan(this: &Expect, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    // Zig: `defer this.postMatch(globalThis);` — guard owns the `&mut Expect` borrow and
    // DerefMut's back to it, so post_match runs on every exit path (including the `?` below)
    // without a raw-pointer alias.
    let this = scopeguard::guard(this, |t| t.post_match(global));

    let this_value = frame.this();
    let value: JSValue = this.get_value(global, this_value, "toBeNaN", "")?;

    this.increment_expect_call_counter();

    let not = this.flags.get().not();
    let mut pass = false;
    if value.is_number() {
        let number = value.as_number();
        if number != number {
            pass = true;
        }
    }

    if not {
        pass = !pass;
    }
    if pass {
        return Ok(JSValue::UNDEFINED);
    }

    // handle failure
    let mut formatter = super::make_formatter(global);
    let value_fmt = value.to_fmt(&mut formatter);
    if not {
        let signature: &str = get_signature("toBeNaN", "", true);
        return this.throw(global, signature, format_args!(concat!("\n\n", "Received: <red>{}<r>\n"), value_fmt));
    }

    let signature: &str = get_signature("toBeNaN", "", false);
    this.throw(global, signature, format_args!(concat!("\n\n", "Received: <red>{}<r>\n"), value_fmt))
}

// ported from: src/test_runner/expect/toBeNaN.zig
