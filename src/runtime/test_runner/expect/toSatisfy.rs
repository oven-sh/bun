use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};

use super::Expect;
use super::get_signature;
use super::throw;

pub(crate) fn to_satisfy(this: &Expect, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let (this, value, not) = this.matcher_prelude(global, frame.this(), "toSatisfy", "<green>expected<r>")?;

    let arguments = frame.arguments();

    if arguments.len() < 1 {
        return Err(global.throw_invalid_arguments(format_args!("toSatisfy() requires 1 argument")));
    }

    let predicate = arguments[0];
    predicate.ensure_still_alive();

    if !predicate.is_callable() {
        return Err(global.throw(format_args!("toSatisfy() argument must be a function")));
    }

    let result = predicate.call(global, JSValue::UNDEFINED, &[value])?;

    let pass = (result.is_boolean() && result.to_boolean()) != not;

    if pass {
        return Ok(JSValue::UNDEFINED);
    }

    // Formatter impls Drop.
    let mut formatter = super::make_formatter(global);

    if not {
        let signature = get_signature("toSatisfy", "<green>expected<r>", true);
        return throw!(
            this,
            global,
            signature,
            "\n\nExpected: not <green>{}<r>\n", predicate.to_fmt(&mut formatter),
        );
    }

    let signature = get_signature("toSatisfy", "<green>expected<r>", false);

    // `to_fmt(&mut Formatter)` borrows exclusively, so use a second formatter for the
    // received value (matches the toBeGreaterThan.rs pattern).
    let mut formatter2 = super::make_formatter(global);
    throw!(
        this,
        global,
        signature,
        "\n\nExpected: <green>{}<r>\nReceived: <red>{}<r>\n",
        predicate.to_fmt(&mut formatter),
        value.to_fmt(&mut formatter2),
    )
}
