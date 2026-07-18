use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use super::make_formatter;

use super::Expect;
use super::get_signature;
use super::throw;

// Free fn (this module can't open `impl Expect`); bridged into `impl Expect` by the
// `__forward_matcher!` macro in expect.rs, where the JsClass codegen host_fn shim picks it up.
pub(crate) fn to_be_valid_date(
    this: &Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    let this_value = frame.this();
    let (this, value, not) = this.matcher_prelude(global, this_value, "toBeValidDate", "")?;
    let mut pass = value.is_date() && !value.get_unix_timestamp().is_nan();
    if not {
        pass = !pass;
    }

    if pass {
        return Ok(this_value);
    }

    let mut formatter = make_formatter(global);
    // `defer formatter.deinit()` → handled by Drop
    let received = value.to_fmt(&mut formatter);

    if not {
        let signature = get_signature("toBeValidDate", "", true);
        return throw!(
            this,
            global,
            signature,
            "\n\nReceived: <red>{}<r>\n", received,
        );
    }

    let signature = get_signature("toBeValidDate", "", false);
    throw!(
        this,
        global,
        signature,
        "\n\nReceived: <red>{}<r>\n", received,
    )
}
