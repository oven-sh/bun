use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
#[allow(unused_imports)] use super::{JSValueTestExt, JSGlobalObjectTestExt, BigIntCompare, make_formatter};
use super::DiffFormatter;
use super::{get_signature, Expect};

// TODO(port): #[bun_jsc::host_fn(method)] — must be inside `impl Expect`; shim wired by JsClass codegen
pub fn to_match_object(
    this: &Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    let (this, received_object, not) =
        this.matcher_prelude(global, frame.this(), "toMatchObject", "<green>expected<r>")?;
    let args_buf = frame.arguments_old::<1>();
    let args = args_buf.slice();

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

// ported from: src/test_runner/expect/toMatchObject.zig
