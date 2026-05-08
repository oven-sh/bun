use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
#[allow(unused_imports)] use super::{JSValueTestExt, JSGlobalObjectTestExt, BigIntCompare, make_formatter};
use bun_jsc::console_object::Formatter;

use super::Expect;

// TODO(port): #[bun_jsc::host_fn(method)] — must be inside `impl Expect`; shim wired by JsClass codegen
pub fn to_be_defined(
    this: &mut Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    // PORT NOTE: reshaped for borrowck — Zig `defer this.postMatch(globalThis)` becomes a
    // scopeguard owning the `&mut Expect` borrow so post_match runs on every exit path.
    let mut this = scopeguard::guard(this, |this| this.post_match(global));

    let this_value = frame.this();
    let value: JSValue = this.get_value(global, this_value, "toBeDefined", "")?;

    this.increment_expect_call_counter();

    let not = this.flags.not();
    let mut pass = !value.is_undefined();
    if not {
        pass = !pass;
    }
    if pass {
        return Ok(JSValue::UNDEFINED);
    }

    // handle failure
    // TODO(port): Formatter likely needs a constructor (global_this field can't Default);
    // adjust once bun_jsc::console_object::Formatter is ported.
    let mut formatter = super::make_formatter(global);
    let value_fmt = value.to_fmt(&mut formatter);
    if not {
        // `received_line` const inlined: format_args! requires a literal first arg.
        let signature = Expect::get_signature("toBeDefined", "", true);
        return this.throw(
            global,
            signature,
            format_args!("\n\nReceived: <red>{}<r>\n", value_fmt),
        );
    }

    let signature = Expect::get_signature("toBeDefined", "", false);
    this.throw(
        global,
        signature,
        format_args!("\n\nReceived: <red>{}<r>\n", value_fmt),
    )
}

// ported from: src/test_runner/expect/toBeDefined.zig
