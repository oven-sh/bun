use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use super::Expect;
use super::throw;

pub(crate) fn to_have_been_called(
    this: &Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    bun_jsc::mark_binding!();
    let this = this.post_match_guard(global);
    let this_value = frame.this();

    if !frame.arguments_as_array::<1>()[0].is_undefined() {
        return Err(global.throw_invalid_arguments(format_args!(
            "toHaveBeenCalled() must not have an argument"
        )));
    }

    let value: JSValue = this.get_value(global, this_value, "toHaveBeenCalled", "")?;

    let calls = super::mock::JSMockFunction__getCalls(global, value)?;
    this.increment_expect_call_counter();
    if !calls.js_type().is_array() {
        let mut formatter = super::make_formatter(global);
        return Err(global.throw(format_args!(
            "Expected value must be a mock function: {}",
            value.to_fmt(&mut formatter),
        )));
    }

    let calls_length = calls.get_length(global)?;
    let mut pass = calls_length > 0;

    let not = this.flags.get().not();
    if not {
        pass = !pass;
    }
    if pass {
        return Ok(JSValue::UNDEFINED);
    }

    // handle failure
    if not {
        let signature = Expect::get_signature("toHaveBeenCalled", "", true);
        return throw!(
            this,
            global,
            signature,
            concat!(
                "\n\n",
                "Expected number of calls: <green>0<r>\n",
                "Received number of calls: <red>{}<r>\n",
            ),
            calls_length
        );
    }

    let signature = Expect::get_signature("toHaveBeenCalled", "", false);
    throw!(
        this,
        global,
        signature,
        concat!(
            "\n\n",
            "Expected number of calls: \\>= <green>1<r>\n",
            "Received number of calls: <red>{}<r>\n",
        ),
        calls_length
    )
}
