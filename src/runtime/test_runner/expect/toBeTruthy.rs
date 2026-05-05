use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_jsc::console_object::Formatter;

use super::Expect;

#[bun_jsc::host_fn(method)]
pub fn to_be_truthy(
    this: &mut Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    // TODO(port): `defer this.postMatch(globalThis)` — scopeguard borrows `this` for the
    // whole scope which conflicts with the &mut uses below; Phase B may need to reshape
    // (e.g. raw-ptr guard or call post_match before each return).
    let _post = scopeguard::guard((), |_| this.post_match(global));

    let this_value = frame.this_value();
    let value: JSValue = this.get_value(global, this_value, "toBeTruthy", "")?;

    this.increment_expect_call_counter();

    let not = this.flags.not;
    let mut pass = false;

    let truthy = value.to_boolean();
    if truthy {
        pass = true;
    }

    if not {
        pass = !pass;
    }
    if pass {
        return Ok(JSValue::UNDEFINED);
    }

    // handle failure
    let mut formatter = Formatter {
        global_this: global,
        quote_strings: true,
        ..Default::default()
    };
    // `defer formatter.deinit()` → handled by Drop
    let value_fmt = value.to_fmt(&mut formatter);
    if not {
        const SIGNATURE: &str = Expect::get_signature("toBeTruthy", "", true);
        return this.throw(
            global,
            SIGNATURE,
            format_args!("\n\nReceived: <red>{}<r>\n", value_fmt),
        );
    }

    const SIGNATURE: &str = Expect::get_signature("toBeTruthy", "", false);
    this.throw(
        global,
        SIGNATURE,
        format_args!("\n\nReceived: <red>{}<r>\n", value_fmt),
    )
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/expect/toBeTruthy.zig (40 lines)
//   confidence: medium
//   todos:      1
//   notes:      defer postMatch needs borrowck reshape; get_signature assumed const fn
// ──────────────────────────────────────────────────────────────────────────
