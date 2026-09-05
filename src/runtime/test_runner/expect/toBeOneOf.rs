use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};

use super::Expect;
use super::get_signature;
use super::throw;

// Free fn (this module can't open `impl Expect`); bridged into `impl Expect` by the
// `__forward_matcher!` macro in expect.rs, where the JsClass codegen host_fn shim picks it up.
pub(crate) fn to_be_one_of(
    this: &Expect,
    global_this: &JSGlobalObject,
    call_frame: &CallFrame,
) -> JsResult<JSValue> {
    let (this, expected, not) =
        this.matcher_prelude(global_this, call_frame.this(), "toBeOneOf", "<green>expected<r>")?;

    let arguments = call_frame.arguments();

    if arguments.len() < 1 {
        return Err(global_this.throw_invalid_arguments(format_args!("toBeOneOf() takes 1 argument")));
    }

    let list_value: JSValue = arguments[0];
    let mut pass = false;

    if list_value.js_type().is_array_like() {
        let mut itr = list_value.array_iterator(global_this)?;
        while let Some(item) = itr.next()? {
            // Confusingly, jest-extended uses `deepEqual`, instead of `toBe`
            if item.jest_deep_equals(expected, global_this)? {
                pass = true;
                break;
            }
        }
    } else if list_value.is_iterable(global_this)? {
        list_value.for_each_iter(global_this, |global_this, item| {
            // Confusingly, jest-extended uses `deepEqual`, instead of `toBe`
            let Ok(eq) = item.jest_deep_equals(expected, global_this) else {
                return;
            };
            if eq {
                pass = true;
                // PERF: break out of the `forEach` when a match is found
            }
        })?;
    } else {
        return Err(global_this.throw(format_args!(
            "Received value must be an array type, or both received and expected values must be strings."
        )));
    }

    if not {
        pass = !pass;
    }
    if pass {
        return Ok(JSValue::UNDEFINED);
    }

    // handle failure
    // The `ZigFormatter` adapter holds `&'a mut Formatter`, so two live adapters
    // cannot alias the same backing formatter. Use a second formatter for the
    // second value (matches toBe.rs).
    let mut formatter = super::make_formatter(global_this);
    let mut formatter2 = super::make_formatter(global_this);
    if not {
        let signature = get_signature("toBeOneOf", "<green>expected<r>", true);
        return throw!(
            this,
            global_this,
            signature,
            concat!(
                "\n\n",
                "Expected to not be one of: <green>{}<r>\nReceived: <red>{}<r>\n",
            ),
            list_value.to_fmt(&mut formatter),
            expected.to_fmt(&mut formatter2),
        );
    }

    let signature = get_signature("toBeOneOf", "<green>expected<r>", false);
    return throw!(
        this,
        global_this,
        signature,
        concat!(
            "\n\n",
            "Expected to be one of: <green>{}<r>\n",
            "Received: <red>{}<r>\n",
        ),
        list_value.to_fmt(&mut formatter),
        expected.to_fmt(&mut formatter2),
    );
}

