use core::ffi::c_void;

use bun_jsc::console_object::Formatter;
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult, Vm};
use bun_str::strings;

use crate::expect::{get_signature, Expect};

struct ExpectedEntry<'a> {
    global_this: &'a JSGlobalObject,
    expected: JSValue,
    pass: &'a mut bool,
}

extern "C" fn deep_equals_iterator(
    _: *mut Vm,
    _: *mut JSGlobalObject,
    entry_: *mut c_void,
    item: JSValue,
) {
    // SAFETY: `entry_` is `&mut ExpectedEntry` passed through `for_each` below; non-null by contract.
    let entry = unsafe { &mut *(entry_ as *mut ExpectedEntry<'_>) };
    let Ok(eq) = item.jest_deep_equals(entry.expected, entry.global_this) else {
        return;
    };
    if eq {
        *entry.pass = true;
        // TODO(perf): break out of the `forEach` when a match is found
    }
}

#[bun_jsc::host_fn(method)]
pub fn to_contain_equal(
    this: &mut Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    // TODO(port): `defer this.postMatch(global)` — scopeguard would hold `&mut *this` for the
    // whole body and conflict with uses below; reshape in Phase B (e.g. RAII guard on Expect).
    let this_value = frame.this();
    let arguments_ = frame.arguments_old(1);
    let arguments = arguments_.slice();

    if arguments.len() < 1 {
        return global.throw_invalid_arguments(format_args!("toContainEqual() takes 1 argument"));
    }

    this.increment_expect_call_counter();

    let expected = arguments[0];
    expected.ensure_still_alive();
    let value: JSValue = this.get_value(global, this_value, "toContainEqual", "<green>expected<r>")?;

    let not = this.flags.not;
    let mut pass = false;

    let value_type = value.js_type();
    let expected_type = expected.js_type();

    if value_type.is_array_like() {
        let mut itr = value.array_iterator(global)?;
        while let Some(item) = itr.next()? {
            if item.jest_deep_equals(expected, global)? {
                pass = true;
                break;
            }
        }
    } else if value_type.is_string_like() && expected_type.is_string_like() {
        if expected_type.is_string_object_like() && value_type.is_string() {
            pass = false;
        } else {
            let value_string = value.to_slice_or_null(global)?;
            let expected_string = expected.to_slice_or_null(global)?;

            // jest does not have a `typeof === "string"` check for `toContainEqual`.
            // it immediately spreads the value into an array.

            let mut expected_codepoint_cursor = strings::codepoint_iterator::Cursor::default();
            let mut expected_iter = strings::CodepointIterator::init(expected_string.slice());
            let _ = expected_iter.next(&mut expected_codepoint_cursor);

            pass = if expected_iter.next(&mut expected_codepoint_cursor) {
                false
            } else {
                strings::index_of(value_string.slice(), expected_string.slice()).is_some()
            };
        }
    } else if value.is_iterable(global)? {
        let mut expected_entry = ExpectedEntry {
            global_this: global,
            expected,
            pass: &mut pass,
        };
        value.for_each(
            global,
            &mut expected_entry as *mut ExpectedEntry<'_> as *mut c_void,
            deep_equals_iterator,
        )?;
    } else {
        return global.throw(format_args!(
            "Received value must be an array type, or both received and expected values must be strings."
        ));
    }

    if not {
        pass = !pass;
    }
    if pass {
        return Ok(this_value);
    }

    // handle failure
    let mut formatter = Formatter {
        global_this: global,
        quote_strings: true,
        ..Default::default()
    };
    let value_fmt = value.to_fmt(&mut formatter);
    let expected_fmt = expected.to_fmt(&mut formatter);
    if not {
        const SIGNATURE: &str = get_signature("toContainEqual", "<green>expected<r>", true);
        return this.throw(
            global,
            SIGNATURE,
            concat!("\n\n", "Expected to not contain: <green>{}<r>\n"),
            format_args!("{}", expected_fmt),
        );
    }

    const SIGNATURE: &str = get_signature("toContainEqual", "<green>expected<r>", false);
    this.throw(
        global,
        SIGNATURE,
        concat!(
            "\n\n",
            "Expected to contain: <green>{}<r>\n",
            "Received: <red>{}<r>\n"
        ),
        format_args!("{}{}", expected_fmt, value_fmt),
    )
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/expect/toContainEqual.zig (113 lines)
//   confidence: medium
//   todos:      1
//   notes:      defer postMatch needs borrowck reshape; Expect.throw fmt-args shape may need adjusting
// ──────────────────────────────────────────────────────────────────────────
