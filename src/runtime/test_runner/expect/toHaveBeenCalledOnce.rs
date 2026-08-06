use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use super::Expect;
use super::get_signature;
use super::throw;

pub(crate) fn to_have_been_called_once(
    this: &Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    bun_jsc::mark_binding!();
    let (this, calls, _value) = this.mock_prologue(
        global,
        frame.this(),
        "toHaveBeenCalledOnce",
        "<green>expected<r>",
        super::mock::MockKind::Calls,
    )?;

    let calls_length = calls.get_length(global)?;
    let mut pass = calls_length == 1;

    let not = this.flags.get().not();
    if not {
        pass = !pass;
    }
    if pass {
        return Ok(JSValue::UNDEFINED);
    }

    // handle failure
    if not {
        let signature = get_signature("toHaveBeenCalledOnce", "<green>expected<r>", true);
        return throw!(
            this,
            global,
            signature,
            concat!(
                "\n\n",
                "Expected number of calls: not <green>1<r>\n",
                "Received number of calls: <red>{}<r>\n",
            ),
            calls_length,
        );
    }

    let signature = get_signature("toHaveBeenCalledOnce", "<green>expected<r>", false);
    throw!(
        this,
        global,
        signature,
        concat!(
            "\n\n",
            "Expected number of calls: <green>1<r>\n",
            "Received number of calls: <red>{}<r>\n",
        ),
        calls_length,
    )
}
