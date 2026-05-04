use core::ffi::c_void;

use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult, VM};
use bun_jsc::console_object::Formatter;

use crate::expect::Expect;
use crate::expect::get_signature;

struct ExpectedEntry<'a> {
    global_this: &'a JSGlobalObject,
    expected: JSValue,
    pass: &'a mut bool,
}

extern "C" fn same_value_iterator(
    _: *mut VM,
    _: *mut JSGlobalObject,
    entry_: *mut c_void,
    item: JSValue,
) {
    // SAFETY: entry_ is &mut ExpectedEntry passed through forEach's opaque ctx; non-null for the duration of the iteration.
    let entry = unsafe { &mut *(entry_ as *mut ExpectedEntry<'_>) };
    // Confusingly, jest-extended uses `deepEqual`, instead of `toBe`
    let Ok(eq) = item.jest_deep_equals(entry.expected, entry.global_this) else {
        return;
    };
    if eq {
        *entry.pass = true;
        // TODO(perf): break out of the `forEach` when a match is found
    }
}

#[bun_jsc::host_fn(method)]
pub fn to_be_one_of(
    this: &mut Expect,
    global_this: &JSGlobalObject,
    call_frame: &CallFrame,
) -> JsResult<JSValue> {
    let _post = scopeguard::guard((), |_| this.post_match(global_this));
    // PORT NOTE: reshaped for borrowck — `_post` borrows `this`/`global_this`; Phase B may need to
    // restructure post_match invocation (e.g. explicit calls before each return) if borrowck rejects.
    // TODO(port): errdefer/defer captures &mut this across fn body

    let this_value = call_frame.this();
    let arguments_ = call_frame.arguments_old(1);
    let arguments = arguments_.slice();

    if arguments.len() < 1 {
        return global_this.throw_invalid_arguments(format_args!("toBeOneOf() takes 1 argument"));
    }

    this.increment_expect_call_counter();

    let expected = this.get_value(global_this, this_value, "toBeOneOf", "<green>expected<r>")?;
    let list_value: JSValue = arguments[0];

    let not = this.flags.not;
    let mut pass = false;

    if list_value.js_type_loose().is_array_like() {
        let mut itr = list_value.array_iterator(global_this)?;
        while let Some(item) = itr.next()? {
            // Confusingly, jest-extended uses `deepEqual`, instead of `toBe`
            if item.jest_deep_equals(expected, global_this)? {
                pass = true;
                break;
            }
        }
    } else if list_value.is_iterable(global_this)? {
        let mut expected_entry = ExpectedEntry {
            global_this,
            expected,
            pass: &mut pass,
        };
        list_value.for_each(
            global_this,
            &mut expected_entry as *mut ExpectedEntry<'_> as *mut c_void,
            same_value_iterator,
        )?;
    } else {
        return global_this.throw(format_args!(
            "Received value must be an array type, or both received and expected values must be strings."
        ));
    }

    if not {
        pass = !pass;
    }
    if pass {
        return Ok(JSValue::UNDEFINED);
    }

    // handle failure
    let mut formatter = Formatter {
        global_this,
        quote_strings: true,
        ..Default::default()
    };
    // TODO(port): Formatter has additional default fields in Zig; verify Default impl matches `.{}` init.
    let value_fmt = list_value.to_fmt(&mut formatter);
    let expected_fmt = expected.to_fmt(&mut formatter);
    if not {
        let received_fmt = list_value.to_fmt(&mut formatter);
        const EXPECTED_LINE: &str =
            "Expected to not be one of: <green>{}<r>\nReceived: <red>{}<r>\n";
        // TODO(port): get_signature was `comptime` in Zig — ensure it is `const fn` so this stays compile-time.
        let signature = get_signature("toBeOneOf", "<green>expected<r>", true);
        return this.throw(
            global_this,
            signature,
            concat!(
                "\n\n",
                "Expected to not be one of: <green>{}<r>\nReceived: <red>{}<r>\n"
            ),
            format_args!("{}{}", received_fmt, expected_fmt),
        );
        // PORT NOTE: Zig `{f}` fmt specifier mapped to Rust `{}` (Display); `++` mapped to concat!.
        let _ = EXPECTED_LINE;
    }

    const EXPECTED_LINE: &str = "Expected to be one of: <green>{}<r>\n";
    const RECEIVED_LINE: &str = "Received: <red>{}<r>\n";
    let signature = get_signature("toBeOneOf", "<green>expected<r>", false);
    this.throw(
        global_this,
        signature,
        concat!(
            "\n\n",
            "Expected to be one of: <green>{}<r>\n",
            "Received: <red>{}<r>\n"
        ),
        format_args!("{}{}", value_fmt, expected_fmt),
    )
    // PORT NOTE: Zig passed a tuple `.{ value_fmt, expected_fmt }` matched against two `{f}` holes;
    // Rust side of `Expect::throw` likely takes `core::fmt::Arguments` — Phase B to confirm signature.
    ;
    let _ = (EXPECTED_LINE, RECEIVED_LINE);
    unreachable!()
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/expect/toBeOneOf.zig (92 lines)
//   confidence: medium
//   todos:      3
//   notes:      defer post_match via scopeguard borrows &mut this across body; Expect::throw fmt-args shape and const get_signature need Phase B verification
// ──────────────────────────────────────────────────────────────────────────
