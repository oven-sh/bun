use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_jsc::console_object::Formatter;

use crate::expect::{Expect, get_signature};

#[bun_jsc::host_fn(method)]
pub fn to_contain_all_keys(
    this: &mut Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    // Zig: `defer this.postMatch(globalObject);`
    // PORT NOTE: reshaped for borrowck — scopeguard would hold &mut *this for the whole fn.
    // TODO(port): verify post_match runs on every exit path (incl. `?` early returns) in Phase B.
    let _post_match = scopeguard::guard((), |_| this.post_match(global));

    let this_value = frame.this();
    let arguments_ = frame.arguments_old(1);
    let arguments = arguments_.slice();

    if arguments.len() < 1 {
        return global.throw_invalid_arguments(format_args!(
            "toContainAllKeys() takes 1 argument"
        ));
    }

    this.increment_expect_call_counter();

    let expected = arguments[0];
    expected.ensure_still_alive();
    let value: JSValue =
        this.get_value(global, this_value, "toContainAllKeys", "<green>expected<r>")?;

    if !expected.js_type().is_array() {
        return global.throw_invalid_argument_type("toContainAllKeys", "expected", "array");
    }

    let not = this.flags.not;
    let mut pass = false;

    let count = expected.get_length(global)?;

    let keys = value.keys(global)?;
    if keys.get_length(global)? == count {
        let mut itr = keys.array_iterator(global)?;
        'outer: {
            while let Some(item) = itr.next()? {
                // PORT NOTE: Zig `while ... else break :outer` → explicit `found` flag (Rust has no while-else).
                let mut found = false;
                let mut i: u32 = 0;
                while u64::from(i) < count {
                    let key = expected.get_index(global, i)?;
                    if item.jest_deep_equals(key, global)? {
                        found = true;
                        break;
                    }
                    i += 1;
                }
                if !found {
                    break 'outer;
                }
            }
            pass = true;
        }
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
    // Zig: `defer formatter.deinit();` — handled by Drop.
    let value_fmt = keys.to_fmt(&mut formatter);
    let expected_fmt = expected.to_fmt(&mut formatter);
    if not {
        let received_fmt = keys.to_fmt(&mut formatter);
        return this.throw(
            global,
            get_signature("toContainAllKeys", "<green>expected<r>", true),
            format_args!(
                concat!(
                    "\n\n",
                    "Expected to not contain all keys: <green>{}<r>\nReceived: <red>{}<r>\n",
                ),
                expected_fmt, received_fmt,
            ),
        );
    }

    this.throw(
        global,
        get_signature("toContainAllKeys", "<green>expected<r>", false),
        format_args!(
            concat!(
                "\n\n",
                "Expected to contain all keys: <green>{}<r>\n",
                "Received: <red>{}<r>\n",
            ),
            expected_fmt, value_fmt,
        ),
    )
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/expect/toContainAllKeys.zig (74 lines)
//   confidence: medium
//   todos:      1
//   notes:      defer post_match() via scopeguard conflicts with &mut this borrows; while-else reshaped to found-flag; throw()/get_signature signatures assumed to take format_args!.
// ──────────────────────────────────────────────────────────────────────────
