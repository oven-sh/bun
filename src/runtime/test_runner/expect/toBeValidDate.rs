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
    // PORT NOTE: `defer this.postMatch(global)` — guard owns the `&mut Expect` and runs
    // post_match on drop; the body re-borrows `this` through the guard's DerefMut so every
    // exit path is covered without a raw-pointer alias.
    let this = scopeguard::guard(this, |t| t.post_match(global));

    let this_value = frame.this();
    let value: JSValue = this.get_value(global, this_value, "toBeValidDate", "")?;

    this.increment_expect_call_counter();

    let not = this.flags.get().not();
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
