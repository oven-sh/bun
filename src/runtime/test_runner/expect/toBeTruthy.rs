use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
#[allow(unused_imports)] use super::{JSValueTestExt, JSGlobalObjectTestExt, BigIntCompare, make_formatter};
use bun_jsc::console_object::Formatter;

use super::Expect;

// TODO(port): #[bun_jsc::host_fn(method)] — must be inside `impl Expect`; shim wired by JsClass codegen
pub fn to_be_truthy(
    this: &Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    // PORT NOTE: `defer this.postMatch(globalThis)` — scopeguard owns the `&mut Expect`
    // borrow so post_match runs on every exit path; deref-mut through the guard below.
    let this = scopeguard::guard(this, |this| this.post_match(global));

    let this_value = frame.this();
    let value: JSValue = this.get_value(global, this_value, "toBeTruthy", "")?;

    this.increment_expect_call_counter();

    let not = this.flags.get().not();
    let mut pass = false;

    let truthy = value.to_boolean();
    if truthy {
        pass = true;
    }

    if not {
        pass = !pass;
    }
    if pass {
        return Ok(JSValue::UNDEFINED);
    }

    // handle failure
    let mut formatter = super::make_formatter(global);
    // `defer formatter.deinit()` → handled by Drop
    let value_fmt = value.to_fmt(&mut formatter);
    if not {
        let signature: &str = Expect::get_signature("toBeTruthy", "", true);
        return this.throw(
            global,
            signature,
            format_args!("\n\nReceived: <red>{}<r>\n", value_fmt),
        );
    }

    let signature: &str = Expect::get_signature("toBeTruthy", "", false);
    this.throw(
        global,
        signature,
        format_args!("\n\nReceived: <red>{}<r>\n", value_fmt),
    )
}

// ported from: src/test_runner/expect/toBeTruthy.zig
