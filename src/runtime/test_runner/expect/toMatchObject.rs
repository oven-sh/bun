use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
#[allow(unused_imports)] use super::{JSValueTestExt, JSGlobalObjectTestExt, BigIntCompare, make_formatter};
use super::DiffFormatter;
use super::{get_signature, Expect};

// TODO(port): #[bun_jsc::host_fn(method)] — must be inside `impl Expect`; shim wired by JsClass codegen
pub fn to_match_object(
    this: &mut Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    // jsc.markBinding(@src()) — debug-only binding marker; no-op in Rust port.

    // PORT NOTE: reshaped for borrowck — Zig `defer this.postMatch(globalThis)` becomes a
    // scopeguard wrapping `this`; the guard DerefMut's to `&mut Expect` for the body and
    // calls `post_match` on scope exit (success or error).
    let mut this = scopeguard::guard(this, |t| t.post_match(global));

    let this_value = frame.this();
    let args = frame.arguments_old::<1>().slice();

    this.increment_expect_call_counter();

    let not = this.flags.not();

    let received_object: JSValue =
        this.get_value(global, this_value, "toMatchObject", "<green>expected<r>")?;

    if !received_object.is_object() {
        let matcher_error =
            "\n\n<b>Matcher error<r>: <red>received<r> value must be a non-null object\n";
        if not {
            let signature: &str = get_signature("toMatchObject", "<green>expected<r>", true);
            return this.throw(global, signature, format_args!("{matcher_error}"));
        }

        let signature: &str = get_signature("toMatchObject", "<green>expected<r>", false);
        return this.throw(global, signature, format_args!("{matcher_error}"));
    }

    if args.len() < 1 || !args[0].is_object() {
        let matcher_error =
            "\n\n<b>Matcher error<r>: <green>expected<r> value must be a non-null object\n";
        if not {
            let signature: &str = get_signature("toMatchObject", "", true);
            return this.throw(global, signature, format_args!("{matcher_error}"));
        }
        let signature: &str = get_signature("toMatchObject", "", false);
        return this.throw(global, signature, format_args!("{matcher_error}"));
    }

    let property_matchers = args[0];

    let mut pass = received_object.jest_deep_match(property_matchers, global, true)?;

    if not {
        pass = !pass;
    }
    if pass {
        return Ok(JSValue::UNDEFINED);
    }

    // handle failure
    let diff_formatter = DiffFormatter {
        received_string: None,
        expected_string: None,
        received: Some(received_object),
        expected: Some(property_matchers),
        global_this: Some(global),
        not,
    };

    if not {
        let signature: &str = get_signature("toMatchObject", "<green>expected<r>", true);
        return this.throw(global, signature, format_args!("\n\n{}\n", diff_formatter));
    }

    let signature: &str = get_signature("toMatchObject", "<green>expected<r>", false);
    this.throw(global, signature, format_args!("\n\n{}\n", diff_formatter))
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/expect/toMatchObject.zig (68 lines)
//   confidence: medium
//   todos:      0
//   notes:      get_signature must be const fn; defer postMatch reshaped via scopeguard DerefMut wrapper
// ──────────────────────────────────────────────────────────────────────────
