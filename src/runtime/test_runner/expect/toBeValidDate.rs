use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
#[allow(unused_imports)] use super::{JSValueTestExt, JSGlobalObjectTestExt, BigIntCompare, make_formatter};

use super::Expect;
use super::get_signature;

// TODO(port): #[bun_jsc::host_fn(method)] — must be inside `impl Expect`; shim wired by JsClass codegen
pub fn to_be_valid_date(
    this: &Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    let this_value = frame.this();
    let (this, value, not) = this.matcher_prelude(global, this_value, "toBeValidDate", "")?;
    let mut pass = value.is_date() && !value.get_unix_timestamp().is_nan();
    if not {
        pass = !pass;
    }

    if pass {
        return Ok(this_value);
    }

    let mut formatter = make_formatter(global);
    // `defer formatter.deinit()` → handled by Drop
    let received = value.to_fmt(&mut formatter);

    if not {
        let signature = get_signature("toBeValidDate", "", true);
        return this.throw(
            global,
            signature,
            format_args!("\n\nReceived: <red>{}<r>\n", received),
        );
    }

    let signature = get_signature("toBeValidDate", "", false);
    this.throw(
        global,
        signature,
        format_args!("\n\nReceived: <red>{}<r>\n", received),
    )
}

// ported from: src/test_runner/expect/toBeValidDate.zig
