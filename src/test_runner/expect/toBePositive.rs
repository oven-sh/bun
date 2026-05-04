use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_jsc::console_object::Formatter as ConsoleFormatter;
use bun_test_runner::expect::Expect;
use bun_test_runner::expect::Expect::get_signature;

#[bun_jsc::host_fn(method)]
pub fn to_be_positive(
    this: &mut Expect,
    global: &JSGlobalObject,
    call_frame: &CallFrame,
) -> JsResult<JSValue> {
    // Zig: `defer this.postMatch(globalThis);`
    // ScopeGuard derefs to `&mut Expect`, so all `this.*` calls below go through it.
    let mut this = scopeguard::guard(this, |this| this.post_match(global));

    let this_value = call_frame.this();
    let value: JSValue = this.get_value(global, this_value, "toBePositive", "")?;

    this.increment_expect_call_counter();

    let mut pass = value.is_number();
    if pass {
        let num: f64 = value.as_number();
        pass = num.round() > 0.0 && !num.is_infinite() && !num.is_nan();
    }

    let not = this.flags.not;
    if not {
        pass = !pass;
    }

    if pass {
        return Ok(JSValue::UNDEFINED);
    }

    let mut formatter = ConsoleFormatter {
        global_this: global,
        quote_strings: true,
        ..Default::default()
    };
    // Zig: `defer formatter.deinit();` — handled by Drop.
    let received = value.to_fmt(&mut formatter);

    if not {
        const SIGNATURE: &str = get_signature("toBePositive", "", true);
        return this.throw(
            global,
            SIGNATURE,
            format_args!("\n\nReceived: <red>{}<r>\n", received),
        );
    }

    const SIGNATURE: &str = get_signature("toBePositive", "", false);
    this.throw(
        global,
        SIGNATURE,
        format_args!("\n\nReceived: <red>{}<r>\n", received),
    )
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/expect/toBePositive.zig (42 lines)
//   confidence: high
//   todos:      0
//   notes:      scopeguard wraps &mut Expect for defer post_match; ConsoleFormatter init uses ..Default — verify field set in Phase B
// ──────────────────────────────────────────────────────────────────────────
