use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_jsc::console_object::Formatter;
use bun_jsc::expect::Expect;

#[bun_jsc::host_fn(method)]
pub fn to_be_empty_object(
    this: &mut Expect,
    global: &JSGlobalObject,
    call_frame: &CallFrame,
) -> JsResult<JSValue> {
    // PORT NOTE: reshaped for borrowck — Zig `defer this.postMatch(globalThis)` becomes a
    // scopeguard that owns the &mut and DerefMut's it for the body.
    let mut this = scopeguard::guard(this, |this| this.post_match(global));

    let this_value = call_frame.this();
    let value: JSValue = this.get_value(global, this_value, "toBeEmptyObject", "")?;

    this.increment_expect_call_counter();

    let not = this.flags.not;
    let mut pass = value.is_object_empty(global)?;

    if not {
        pass = !pass;
    }
    if pass {
        return Ok(this_value);
    }

    let mut formatter = Formatter {
        global,
        quote_strings: true,
        ..Default::default()
    };
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/expect/toBeEmptyObject.zig (36 lines)
//   confidence: medium
//   todos:      0
//   notes:      defer postMatch via scopeguard+DerefMut; get_signature assumed const fn; throw() takes fmt::Arguments
// ──────────────────────────────────────────────────────────────────────────
