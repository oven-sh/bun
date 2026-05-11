use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
#[allow(unused_imports)] use super::{JSValueTestExt, JSGlobalObjectTestExt, BigIntCompare, make_formatter};
use bun_jsc::console_object::Formatter;
use bun_str::strings;

use super::Expect;

// TODO(port): #[bun_jsc::host_fn(method)] — must be inside `impl Expect`; shim wired by JsClass codegen
pub fn to_start_with(
    this: &Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    // Zig: `defer this.postMatch(globalThis);` — side-effect must run on every exit path.
    // PORT NOTE: reshaped for borrowck (scopeguard owns the &mut Expect; access via DerefMut).
    let this = scopeguard::guard(this, |t| t.post_match(global));

    let this_value = frame.this();
    let arguments_ = frame.arguments_old::<1>();
    let arguments = arguments_.slice();

    if arguments.len() < 1 {
        return Err(global.throw_invalid_arguments(format_args!("toStartWith() requires 1 argument")));
    }

    let expected = arguments[0];
    expected.ensure_still_alive();

    if !expected.is_string() {
        return Err(global.throw(format_args!(
            "toStartWith() requires the first argument to be a string"
        )));
    }

    let value: JSValue = this.get_value(global, this_value, "toStartWith", "<green>expected<r>")?;

    this.increment_expect_call_counter();

    let mut pass = value.is_string();
    if pass {
        let value_string = value.to_slice_or_null(global)?;
        let expected_string = expected.to_slice_or_null(global)?;
        pass = strings::starts_with(value_string.slice(), expected_string.slice())
            || expected_string.slice().is_empty();
        // `defer *.deinit()` dropped — Utf8Slice/ZigString::Slice impl Drop.
    }

    let not = this.flags.get().not();
    if not {
        pass = !pass;
    }

    if pass {
        return Ok(JSValue::UNDEFINED);
    }

    // PORT NOTE: Zig shares one `*Formatter` across both `toFmt` calls; in Rust the
    // `ZigFormatter` adapter holds `&'a mut Formatter`, so two live adapters cannot alias
    // the same backing formatter. Use a second formatter for the received value —
    // `make_formatter` is a trivial struct init with no shared state between values.
    let mut formatter = super::make_formatter(global);
    let mut formatter2 = super::make_formatter(global);
    // `defer formatter.deinit()` dropped — Formatter impls Drop.

    if not {
        const EXPECTED_LINE: &str = "Expected to not start with: <green>{}<r>\n";
        const RECEIVED_LINE: &str = "Received: <red>{}<r>\n";
        let signature: &str = Expect::get_signature("toStartWith", "<green>expected<r>", true);
        return this.throw(
            global,
            signature,
            format_args!(
                concat!(
                    "\n\n",
                    "Expected to not start with: <green>{}<r>\n",
                    "Received: <red>{}<r>\n"
                ),
                expected.to_fmt(&mut formatter),
                value.to_fmt(&mut formatter2),
            ),
        );
        // PORT NOTE: Zig used `"\n\n" ++ expected_line ++ received_line` as the comptime fmt
        // string fed to a printf-style fn. Rust `concat!` cannot splice `const` bindings, so the
        // literals are inlined here; the named consts above are kept for diff parity only.
        let _ = (EXPECTED_LINE, RECEIVED_LINE);
    }

    const EXPECTED_LINE: &str = "Expected to start with: <green>{}<r>\n";
    const RECEIVED_LINE: &str = "Received: <red>{}<r>\n";
    let signature: &str = Expect::get_signature("toStartWith", "<green>expected<r>", false);
    let _ = (EXPECTED_LINE, RECEIVED_LINE);
    this.throw(
        global,
        signature,
        format_args!(
            concat!(
                "\n\n",
                "Expected to start with: <green>{}<r>\n",
                "Received: <red>{}<r>\n"
            ),
            expected.to_fmt(&mut formatter),
            value.to_fmt(&mut formatter2),
        ),
    )
    // `this` (scopeguard) drops here → post_match(global)
}

// ported from: src/test_runner/expect/toStartWith.zig
