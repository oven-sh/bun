use core::ffi::c_void;
#[allow(unused_imports)] use super::{JSValueTestExt, JSGlobalObjectTestExt, BigIntCompare, make_formatter};

use bun_jsc::console_object::Formatter;
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult, VM};
use bun_core::strings;

use super::{get_signature, Expect};

struct ExpectedEntry<'a> {
    global_this: &'a JSGlobalObject,
    expected: JSValue,
    pass: &'a mut bool,
}

extern "C" fn deep_equals_iterator(
    _: *mut VM,
    _: &JSGlobalObject,
    entry_: *mut c_void,
    item: JSValue,
) {
    // SAFETY: `entry_` is `&mut ExpectedEntry` passed through `for_each` below; non-null by contract.
    let entry = unsafe { bun_ptr::callback_ctx::<ExpectedEntry<'_>>(entry_) };
    let Ok(eq) = item.jest_deep_equals(entry.expected, entry.global_this) else {
        return;
    };
    if eq {
        *entry.pass = true;
        // TODO(perf): break out of the `forEach` when a match is found
    }
}

// TODO(port): #[bun_jsc::host_fn(method)] — must be inside `impl Expect`; shim wired by JsClass codegen
pub fn to_contain_equal(
    this: &Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    let this_value = frame.this();
    let (this, value, not) =
        this.matcher_prelude(global, this_value, "toContainEqual", "<green>expected<r>")?;
    let arguments_ = frame.arguments_old::<1>();
    let arguments = arguments_.slice();

    if arguments.len() < 1 {
        return Err(global.throw_invalid_arguments(format_args!("toContainEqual() takes 1 argument")));
    }

    let expected = arguments[0];
    expected.ensure_still_alive();
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

            let mut expected_codepoint_cursor = strings::Cursor::default();
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
            (&raw mut expected_entry).cast::<c_void>(),
            deep_equals_iterator,
        )?;
    } else {
        return Err(global.throw(format_args!(
            "Received value must be an array type, or both received and expected values must be strings."
        )));
    }

    if not {
        pass = !pass;
    }
    if pass {
        return Ok(this_value);
    }

    // handle failure
    // PORT NOTE: Zig shared one Formatter for both `toFmt` calls; Rust borrowck forbids two
    // live `&mut formatter` borrows, so allocate a second Formatter for the expected value.
    let mut formatter = super::make_formatter(global);
    let mut formatter2 = super::make_formatter(global);
    let value_fmt = value.to_fmt(&mut formatter);
    let expected_fmt = expected.to_fmt(&mut formatter2);
    if not {
        let signature: &str = get_signature("toContainEqual", "<green>expected<r>", true);
        return this.throw_fmt(
            global,
            signature,
            concat!("\n\n", "Expected to not contain: <green>{}<r>\n"),
            format_args!("{}", expected_fmt),
        );
    }

    let signature: &str = get_signature("toContainEqual", "<green>expected<r>", false);
    this.throw_fmt(
        global,
        signature,
        concat!(
            "\n\n",
            "Expected to contain: <green>{}<r>\n",
            "Received: <red>{}<r>\n"
        ),
        format_args!("{}{}", expected_fmt, value_fmt),
    )
}

// ported from: src/test_runner/expect/toContainEqual.zig
