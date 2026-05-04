use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_str::strings;

use crate::expect::{get_signature, Expect};

#[bun_jsc::host_fn(method)]
pub fn to_end_with(
    this: &mut Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    // defer this.postMatch(globalThis) — wrap `this` so post_match runs on every exit path.
    // PORT NOTE: reshaped for borrowck (scopeguard owns the &mut Expect; access via DerefMut).
    let mut this = scopeguard::guard(this, |t| t.post_match(global));

    let this_value = frame.this_value();
    let arguments_ = frame.arguments_old(1);
    let arguments = arguments_.as_slice();

    if arguments.len() < 1 {
        return global.throw_invalid_arguments(format_args!("toEndWith() requires 1 argument"));
    }

    let expected = arguments[0];
    expected.ensure_still_alive();

    if !expected.is_string() {
        return global.throw(format_args!(
            "toEndWith() requires the first argument to be a string"
        ));
    }

    let value: JSValue =
        this.get_value(global, this_value, "toEndWith", "<green>expected<r>")?;

    this.increment_expect_call_counter();

    let mut pass = value.is_string();
    if pass {
        let value_string = value.to_slice_or_null(global)?;
        let expected_string = expected.to_slice_or_null(global)?;
        pass = strings::ends_with(value_string.slice(), expected_string.slice())
            || expected_string.len() == 0;
        // value_string / expected_string drop here (was: defer .deinit())
    }

    let not = this.flags.not;
    if not {
        pass = !pass;
    }

    if pass {
        return Ok(JSValue::UNDEFINED);
    }

    // TODO(port): ConsoleObject.Formatter construction — Zig used struct-literal defaults.
    let mut formatter = bun_jsc::console_object::Formatter {
        global_this: global,
        quote_strings: true,
        ..Default::default()
    };
    // TODO(port): borrowck — Zig holds two `*Formatter` simultaneously via toFmt; Rust can't
    // hand out two `&mut formatter`. Phase B: make `to_fmt` take `&Formatter` (interior mut)
    // or inline the format calls.
    let value_fmt = value.to_fmt(&mut formatter);
    let expected_fmt = expected.to_fmt(&mut formatter);

    if not {
        const EXPECTED_LINE: &str = "Expected to not end with: <green>{}<r>\n";
        const RECEIVED_LINE: &str = "Received: <red>{}<r>\n";
        // PERF(port): was `comptime getSignature(...)` — ensure get_signature is `const fn`
        // (or a macro) so this stays a compile-time &'static str in Phase B.
        let signature = get_signature::<true>("toEndWith", "<green>expected<r>");
        return this.throw(
            global,
            signature,
            format_args!(
                concat!(
                    "\n\n",
                    "Expected to not end with: <green>{}<r>\n",
                    "Received: <red>{}<r>\n"
                ),
                expected_fmt,
                value_fmt
            ),
        );
    }

    const EXPECTED_LINE: &str = "Expected to end with: <green>{}<r>\n";
    const RECEIVED_LINE: &str = "Received: <red>{}<r>\n";
    let signature = get_signature::<false>("toEndWith", "<green>expected<r>");
    this.throw(
        global,
        signature,
        format_args!(
            concat!(
                "\n\n",
                "Expected to end with: <green>{}<r>\n",
                "Received: <red>{}<r>\n"
            ),
            expected_fmt,
            value_fmt
        ),
    )
    // `this` (scopeguard) drops here → post_match(global)
    // `formatter` drops here (was: defer formatter.deinit())
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/expect/toEndWith.zig (64 lines)
//   confidence: medium
//   todos:      2
//   notes:      to_fmt double-&mut-borrow needs reshape; get_signature must be const/macro; Formatter ctor shape guessed
// ──────────────────────────────────────────────────────────────────────────
