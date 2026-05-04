use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_jsc::console_object::Formatter;
use bun_str::strings;

use super::Expect;

#[bun_jsc::host_fn(method)]
pub fn to_start_with(
    this: &mut Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    // Zig: `defer this.postMatch(globalThis);` — side-effect must run on every exit path.
    let _post = scopeguard::guard((), |_| this.post_match(global));
    // TODO(port): scopeguard captures `&mut *this` across the fn body; reshape if borrowck rejects.

    let this_value = frame.this();
    let arguments_ = frame.arguments_old(1);
    let arguments = arguments_.slice();

    if arguments.len() < 1 {
        return global.throw_invalid_arguments(format_args!("toStartWith() requires 1 argument"));
    }

    let expected = arguments[0];
    expected.ensure_still_alive();

    if !expected.is_string() {
        return global.throw(format_args!(
            "toStartWith() requires the first argument to be a string"
        ));
    }

    let value: JSValue = this.get_value(global, this_value, "toStartWith", "<green>expected<r>")?;

    this.increment_expect_call_counter();

    let mut pass = value.is_string();
    if pass {
        let value_string = value.to_slice_or_null(global)?;
        let expected_string = expected.to_slice_or_null(global)?;
        pass = strings::starts_with(value_string.slice(), expected_string.slice())
            || expected_string.len() == 0;
        // `defer *.deinit()` dropped — Utf8Slice/ZigString::Slice impl Drop.
    }

    let not = this.flags.not;
    if not {
        pass = !pass;
    }

    if pass {
        return Ok(JSValue::UNDEFINED);
    }

    let mut formatter = Formatter {
        global_this: global,
        quote_strings: true,
        ..Default::default()
    };
    // `defer formatter.deinit()` dropped — Formatter impls Drop.
    let value_fmt = value.to_fmt(&mut formatter);
    let expected_fmt = expected.to_fmt(&mut formatter);
    // TODO(port): both `to_fmt` calls borrow `&mut formatter`; in Zig these were aliasing
    // `*Formatter` handles. Phase B: make `to_fmt` take `&Formatter` or interleave into the
    // `format_args!` call sites.

    if not {
        const EXPECTED_LINE: &str = "Expected to not start with: <green>{}<r>\n";
        const RECEIVED_LINE: &str = "Received: <red>{}<r>\n";
        const SIGNATURE: &str = Expect::get_signature("toStartWith", "<green>expected<r>", true);
        return this.throw(
            global,
            SIGNATURE,
            format_args!(
                concat!(
                    "\n\n",
                    "Expected to not start with: <green>{}<r>\n",
                    "Received: <red>{}<r>\n"
                ),
                expected_fmt,
                value_fmt
            ),
        );
        // PORT NOTE: Zig used `"\n\n" ++ expected_line ++ received_line` as the comptime fmt
        // string fed to a printf-style fn. Rust `concat!` cannot splice `const` bindings, so the
        // literals are inlined here; the named consts above are kept for diff parity only.
        let _ = (EXPECTED_LINE, RECEIVED_LINE);
    }

    const EXPECTED_LINE: &str = "Expected to start with: <green>{}<r>\n";
    const RECEIVED_LINE: &str = "Received: <red>{}<r>\n";
    const SIGNATURE: &str = Expect::get_signature("toStartWith", "<green>expected<r>", false);
    let _ = (EXPECTED_LINE, RECEIVED_LINE);
    this.throw(
        global,
        SIGNATURE,
        format_args!(
            concat!(
                "\n\n",
                "Expected to start with: <green>{}<r>\n",
                "Received: <red>{}<r>\n"
            ),
            expected_fmt,
            value_fmt
        ),
    )
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/expect/toStartWith.zig (64 lines)
//   confidence: medium
//   todos:      2
//   notes:      scopeguard for postMatch + dual &mut Formatter borrow need Phase-B reshaping; concat! inlines fmt literals (Rust can't splice const &str).
// ──────────────────────────────────────────────────────────────────────────
