use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
#[allow(unused_imports)] use super::{JSValueTestExt, JSGlobalObjectTestExt, BigIntCompare, make_formatter};
use bun_jsc::console_object::Formatter as ConsoleFormatter;
use super::Expect;
use super::get_signature;

// TODO(port): #[bun_jsc::host_fn(method)] — must be inside `impl Expect`; shim wired by JsClass codegen
pub fn to_be_positive(
    this: &Expect,
    global: &JSGlobalObject,
    call_frame: &CallFrame,
) -> JsResult<JSValue> {
    // Zig: `defer this.postMatch(globalThis);`
    // ScopeGuard derefs to `&mut Expect`, so all `this.*` calls below go through it.
    let this = scopeguard::guard(this, |this| this.post_match(global));

    let this_value = call_frame.this();
    let value: JSValue = this.get_value(global, this_value, "toBePositive", "")?;

    this.increment_expect_call_counter();

    let mut pass = value.is_number();
    if pass {
        let num: f64 = value.as_number();
        pass = num.round() > 0.0 && !num.is_infinite() && !num.is_nan();
    }

    let not = this.flags.get().not();
    if not {
        pass = !pass;
    }

    if pass {
        return Ok(JSValue::UNDEFINED);
    }

    let mut formatter = super::make_formatter(global);
    // Zig: `defer formatter.deinit();` — handled by Drop.
    let received = value.to_fmt(&mut formatter);

    if not {
        let signature: &str = get_signature("toBePositive", "", true);
        return this.throw(
            global,
            signature,
            format_args!("\n\nReceived: <red>{}<r>\n", received),
        );
    }

    let signature: &str = get_signature("toBePositive", "", false);
    this.throw(
        global,
        signature,
        format_args!("\n\nReceived: <red>{}<r>\n", received),
    )
}

// ported from: src/test_runner/expect/toBePositive.zig
