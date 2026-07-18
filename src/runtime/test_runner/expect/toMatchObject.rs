use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use super::DiffFormatter;
use super::throw;
use super::{get_signature, Expect};

pub(crate) fn to_match_object(
    this: &Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    let (this, received_object, not) =
        this.matcher_prelude(global, frame.this(), "toMatchObject", "<green>expected<r>")?;
    let args_buf = frame.arguments_old::<1>();
    let args = args_buf.slice();

    if !received_object.is_object() {
        let signature: &str = get_signature("toMatchObject", "<green>expected<r>", not);
        return throw!(
            this, global, signature,
            "\n\n<b>Matcher error<r>: <red>received<r> value must be a non-null object\n",
        );
    }

    if args.len() < 1 || !args[0].is_object() {
        let signature: &str = get_signature("toMatchObject", "", not);
        return throw!(
            this, global, signature,
            "\n\n<b>Matcher error<r>: <green>expected<r> value must be a non-null object\n",
        );
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
        return throw!(this, global, signature, "\n\n{}\n", diff_formatter);
    }

    let signature: &str = get_signature("toMatchObject", "<green>expected<r>", false);
    throw!(this, global, signature, "\n\n{}\n", diff_formatter)
}
