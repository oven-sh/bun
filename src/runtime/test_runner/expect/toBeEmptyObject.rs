use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use super::Expect;
use super::throw;

// Free fn (this module can't open `impl Expect`); bridged into `impl Expect` by the
// `__forward_matcher!` macro in expect.rs, where the JsClass codegen host_fn shim picks it up.
pub(crate) fn to_be_empty_object(
    this: &Expect,
    global: &JSGlobalObject,
    call_frame: &CallFrame,
) -> JsResult<JSValue> {
    let this_value = call_frame.this();
    let (this, value, not) = this.matcher_prelude(global, this_value, "toBeEmptyObject", "")?;
    let mut pass = value.is_object_empty(global)?;

    if not {
        pass = !pass;
    }
    if pass {
        return Ok(this_value);
    }

    let mut formatter = super::make_formatter(global);
    // `defer formatter.deinit()` → handled by Drop.
    let received = value.to_fmt(&mut formatter);

    if not {
        let signature = Expect::get_signature("toBeEmptyObject", "", true);
        return throw!(
            this,
            global,
            signature,
            "\n\nReceived: <red>{}<r>\n", received,
        );
    }

    let signature = Expect::get_signature("toBeEmptyObject", "", false);
    throw!(
        this,
        global,
        signature,
        "\n\nReceived: <red>{}<r>\n", received,
    )
}

