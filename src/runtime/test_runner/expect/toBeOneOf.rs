use core::ffi::c_void;
#[allow(unused_imports)] use super::{JSValueTestExt, JSGlobalObjectTestExt, BigIntCompare, make_formatter};

use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult, VM};

use super::Expect;
use super::get_signature;

struct ExpectedEntry<'a> {
    global_this: &'a JSGlobalObject,
    expected: JSValue,
    pass: &'a mut bool,
}

extern "C" fn same_value_iterator(
    _: *mut VM,
    _: &JSGlobalObject,
    entry_: *mut c_void,
    item: JSValue,
) {
    // SAFETY: entry_ is &mut ExpectedEntry passed through forEach's opaque ctx; non-null for the duration of the iteration.
    let entry = unsafe { bun_ptr::callback_ctx::<ExpectedEntry<'_>>(entry_) };
    // Confusingly, jest-extended uses `deepEqual`, instead of `toBe`
    let Ok(eq) = item.jest_deep_equals(entry.expected, entry.global_this) else {
        return;
    };
    if eq {
        *entry.pass = true;
        // TODO(perf): break out of the `forEach` when a match is found
    }
}

// TODO(port): #[bun_jsc::host_fn(method)] — must be inside `impl Expect`; shim wired by JsClass codegen
pub fn to_be_one_of(
    this: &Expect,
    global_this: &JSGlobalObject,
    call_frame: &CallFrame,
) -> JsResult<JSValue> {
    let (this, expected, not) =
        this.matcher_prelude(global_this, call_frame.this(), "toBeOneOf", "<green>expected<r>")?;

    let arguments_ = call_frame.arguments_old::<1>();
    let arguments = arguments_.slice();

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
        let mut expected_entry = ExpectedEntry {
            global_this,
            expected,
            pass: &mut pass,
        };
        list_value.for_each(
            global_this,
            (&raw mut expected_entry).cast::<c_void>(),
            same_value_iterator,
        )?;
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
    // PORT NOTE: Zig shares one `*Formatter` across both `toFmt` calls; in Rust the
    // `ZigFormatter` adapter holds `&'a mut Formatter`, so two live adapters cannot alias
    // the same backing formatter. Use a second formatter for the second value (matches toBe.rs).
    let mut formatter = super::make_formatter(global_this);
    let mut formatter2 = super::make_formatter(global_this);
    if not {
        // TODO(port): get_signature was `comptime` in Zig — ensure it is `const fn` so this stays compile-time.
        let signature = get_signature("toBeOneOf", "<green>expected<r>", true);
        // PORT NOTE: Zig `{f}` fmt specifier mapped to Rust `{}` (Display); `++` mapped to concat!.
        return this.throw(
            global_this,
            signature,
            format_args!(
                concat!(
                    "\n\n",
                    "Expected to not be one of: <green>{}<r>\nReceived: <red>{}<r>\n",
                ),
                list_value.to_fmt(&mut formatter),
                expected.to_fmt(&mut formatter2),
            ),
        );
    }

    let signature = get_signature("toBeOneOf", "<green>expected<r>", false);
    return this.throw(
        global_this,
        signature,
        format_args!(
            concat!(
                "\n\n",
                "Expected to be one of: <green>{}<r>\n",
                "Received: <red>{}<r>\n",
            ),
            list_value.to_fmt(&mut formatter),
            expected.to_fmt(&mut formatter2),
        ),
    );
}

// ported from: src/test_runner/expect/toBeOneOf.zig
