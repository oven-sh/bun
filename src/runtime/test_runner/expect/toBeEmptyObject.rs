use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
#[allow(unused_imports)] use super::{JSValueTestExt, JSGlobalObjectTestExt, BigIntCompare, make_formatter};
use bun_jsc::console_object::Formatter;
use super::Expect;

// TODO(port): #[bun_jsc::host_fn(method)] — must be inside `impl Expect`; shim wired by JsClass codegen
pub fn to_be_empty_object(
    this: &Expect,
    global: &JSGlobalObject,
    call_frame: &CallFrame,
) -> JsResult<JSValue> {
    let this_value = call_frame.this();
    let (this, value, not) = this.matcher_prelude(global, this_value, "toBeEmptyObject", "")?;
    let mut pass = value.is_object_empty(global)?;

    if not {
        pass = !pass;
    }
    if pass {
        return Ok(this_value);
    }

    let mut formatter = super::make_formatter(global);
    // `defer formatter.deinit()` → handled by Drop.
    let received = value.to_fmt(&mut formatter);

    if not {
        let signature = Expect::get_signature("toBeEmptyObject", "", true);
        return this.throw(
            global,
            signature,
            format_args!("\n\nReceived: <red>{}<r>\n", received),
        );
    }

    let signature = Expect::get_signature("toBeEmptyObject", "", false);
    this.throw(
        global,
        signature,
        format_args!("\n\nReceived: <red>{}<r>\n", received),
    )
}

// ported from: src/test_runner/expect/toBeEmptyObject.zig
