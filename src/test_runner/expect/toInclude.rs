use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_jsc::console_object::Formatter;
use bun_str::strings;

use crate::expect::Expect;

#[bun_jsc::host_fn(method)]
pub fn to_include(
    this: &mut Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    // TODO(port): `defer this.postMatch(globalThis)` — scopeguard over `&mut self` conflicts
    // with subsequent uses of `this`; Phase B should hoist post_match into a Drop guard on
    // Expect or restructure to call at every return site.
    let _post = scopeguard::guard((), |_| this.post_match(global));

    let this_value = frame.this();
    let arguments_ = frame.arguments_old(1);
    let arguments = arguments_.slice();

    if arguments.len() < 1 {
        return global.throw_invalid_arguments(format_args!("toInclude() requires 1 argument"));
    }

    let expected = arguments[0];
    expected.ensure_still_alive();

    if !expected.is_string() {
        return global.throw(format_args!(
            "toInclude() requires the first argument to be a string"
        ));
    }

    let value: JSValue = this.get_value(global, this_value, "toInclude", "")?;

    this.increment_expect_call_counter();

    let mut pass = value.is_string();
    if pass {
        let value_string = value.to_slice_or_null(global)?;
        let expected_string = expected.to_slice_or_null(global)?;
        pass = strings::contains(value_string.slice(), expected_string.slice())
            || expected_string.len() == 0;
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
    let value_fmt = value.to_fmt(&mut formatter);
    let expected_fmt = expected.to_fmt(&mut formatter);

    if not {
        const EXPECTED_LINE: &str = "Expected to not include: <green>{}<r>\n";
        const RECEIVED_LINE: &str = "Received: <red>{}<r>\n";
        const SIGNATURE: &str = Expect::get_signature("toInclude", "<green>expected<r>", true);
        return this.throw(
            global,
            SIGNATURE,
            format_args!(
                concat!(
                    "\n\n",
                    "Expected to not include: <green>{}<r>\n",
                    "Received: <red>{}<r>\n"
                ),
                expected_fmt,
                value_fmt
            ),
        );
    }

    const EXPECTED_LINE: &str = "Expected to include: <green>{}<r>\n";
    const RECEIVED_LINE: &str = "Received: <red>{}<r>\n";
    const SIGNATURE: &str = Expect::get_signature("toInclude", "<green>expected<r>", false);
    this.throw(
        global,
        SIGNATURE,
        format_args!(
            concat!(
                "\n\n",
                "Expected to include: <green>{}<r>\n",
                "Received: <red>{}<r>\n"
            ),
            expected_fmt,
            value_fmt
        ),
    )
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/expect/toInclude.zig (64 lines)
//   confidence: medium
//   todos:      1
//   notes:      defer post_match needs borrowck reshape; concat! duplicates fmt literals since Rust concat! rejects const refs; get_signature must be const fn
// ──────────────────────────────────────────────────────────────────────────
