use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
#[allow(unused_imports)] use super::{JSValueTestExt, JSGlobalObjectTestExt, BigIntCompare, make_formatter};
use bun_jsc::console_object::Formatter;

use super::Expect;
use super::get_signature;

// TODO(port): #[bun_jsc::host_fn(method)] — must be inside `impl Expect`; shim wired by JsClass codegen
pub fn to_be_date(this: &Expect, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    // PORT NOTE: reshaped for borrowck — Zig `defer this.postMatch(globalThis)` becomes a
    // scopeguard owning the `&mut Expect` borrow so post_match runs on every exit path.
    let this = scopeguard::guard(this, |this| this.post_match(global));

    let this_value = frame.this();
    let value: JSValue = this.get_value(global, this_value, "toBeDate", "")?;

    this.increment_expect_call_counter();

    let not = this.flags.get().not();
    let pass = value.is_date() != not;

    if pass {
        return Ok(JSValue::UNDEFINED);
    }

    let mut formatter = super::make_formatter(global);
    // `defer formatter.deinit()` — handled by Drop.
    let received = value.to_fmt(&mut formatter);

    if not {
        let signature = get_signature("toBeDate", "", true);
        return this.throw(
            global,
            signature,
            format_args!(concat!("\n\n", "Received: <red>{}<r>\n"), received),
        );
    }

    let signature = get_signature("toBeDate", "", false);
    this.throw(
        global,
        signature,
        format_args!(concat!("\n\n", "Received: <red>{}<r>\n"), received),
    )
}

// ported from: src/test_runner/expect/toBeDate.zig
