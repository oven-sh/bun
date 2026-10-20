use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use super::Expect;
use super::get_signature;
use super::throw;

pub(crate) fn to_have_been_called_times(
    this: &Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    let arguments: &[JSValue] = frame.arguments();
    let (this, calls, _value) = this.mock_prologue(
        global,
        frame.this(),
        "toHaveBeenCalledTimes",
        "<green>expected<r>",
        super::mock::MockKind::Calls,
    )?;

    let times = super::mock::expected_count(global, arguments, "toHaveBeenCalledTimes")?;

    let mut pass = calls.get_length(global)? as i64 == times;

    let not = this.flags.get().not();
    if not {
        pass = !pass;
    }
    if pass {
        return Ok(JSValue::UNDEFINED);
    }

    // handle failure
    if not {
        let signature = get_signature("toHaveBeenCalledTimes", "<green>expected<r>", true);
        return throw!(
            this,
            global,
            signature,
            concat!(
                "\n\n",
                "Expected number of calls: not <green>{}<r>\n",
                "Received number of calls: <red>{}<r>\n"
            ),
            times,
            calls.get_length(global)?,
        );
    }

    let signature = get_signature("toHaveBeenCalledTimes", "<green>expected<r>", false);
    throw!(
        this,
        global,
        signature,
        concat!(
            "\n\n",
            "Expected number of calls: <green>{}<r>\n",
            "Received number of calls: <red>{}<r>\n"
        ),
        times,
        calls.get_length(global)?,
    )
}
