use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_jsc::console_object::Formatter;
use bun_test_runner::expect::Expect;

#[bun_jsc::host_fn(method)]
pub fn to_have_been_called(
    this: &mut Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    bun_jsc::mark_binding!();
    let this_value = frame.this_value();
    let first_argument = frame.arguments_as_array::<1>()[0];
    // TODO(port): `defer this.postMatch(globalThis)` — scopeguard captures &mut this and conflicts
    // with subsequent &mut uses below; Phase B may need to reshape (call post_match before each
    // return) or split borrows.
    scopeguard::defer! { this.post_match(global); }

    if !first_argument.is_undefined() {
        return global.throw_invalid_arguments(format_args!(
            "toHaveBeenCalled() must not have an argument"
        ));
    }

    let value: JSValue = this.get_value(global, this_value, "toHaveBeenCalled", "")?;

    // TODO(port): verify crate path for `bun.cpp.JSMockFunction__getCalls` extern binding
    let calls = bun_cpp::JSMockFunction__getCalls(global, value)?;
    this.increment_expect_call_counter();
    if !calls.js_type().is_array() {
        let formatter = Formatter {
            global_this: global,
            quote_strings: true,
            ..Default::default()
        };
        // `defer formatter.deinit()` → Drop
        return global.throw(format_args!(
            "Expected value must be a mock function: {}",
            value.to_fmt(&formatter)
        ));
    }

    let calls_length = calls.get_length(global)?;
    let mut pass = calls_length > 0;

    let not = this.flags.not;
    if not {
        pass = !pass;
    }
    if pass {
        return Ok(JSValue::UNDEFINED);
    }

    // handle failure
    if not {
        // TODO(port): `comptime getSignature(...)` — ensure Expect::get_signature is `const fn`
        let signature = Expect::get_signature("toHaveBeenCalled", "", true);
        return this.throw(
            global,
            signature,
            format_args!(
                concat!(
                    "\n\n",
                    "Expected number of calls: <green>0<r>\n",
                    "Received number of calls: <red>{}<r>\n",
                ),
                calls_length
            ),
        );
    }

    let signature = Expect::get_signature("toHaveBeenCalled", "", false);
    this.throw(
        global,
        signature,
        format_args!(
            concat!(
                "\n\n",
                "Expected number of calls: \\>= <green>1<r>\n",
                "Received number of calls: <red>{}<r>\n",
            ),
            calls_length
        ),
    )
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/expect/toHaveBeenCalled.zig (46 lines)
//   confidence: medium
//   todos:      3
//   notes:      defer post_match needs borrowck reshape; bun.cpp extern path + comptime get_signature need Phase B verification
// ──────────────────────────────────────────────────────────────────────────
