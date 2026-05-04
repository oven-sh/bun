use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_jsc::console_object::Formatter as ConsoleFormatter;
use bun_str::ZigString;

use crate::diff_format::DiffFormatter;
use super::Expect;

#[bun_jsc::host_fn(method)]
pub fn to_have_property(
    this: &mut Expect,
    global: &JSGlobalObject,
    call_frame: &CallFrame,
) -> JsResult<JSValue> {
    // PORT NOTE: `defer this.postMatch(globalThis)` — guard owns `this` and calls post_match on drop.
    let mut this = scopeguard::guard(this, |this| this.post_match(global));

    let this_value = call_frame.this();
    let _arguments = call_frame.arguments_old(2);
    let arguments: &[JSValue] = _arguments.as_slice();

    if arguments.len() < 1 {
        return global.throw_invalid_arguments(format_args!(
            "toHaveProperty() requires at least 1 argument"
        ));
    }

    this.increment_expect_call_counter();

    let expected_property_path = arguments[0];
    expected_property_path.ensure_still_alive();
    let expected_property: Option<JSValue> = if arguments.len() > 1 { Some(arguments[1]) } else { None };
    if let Some(ev) = expected_property {
        ev.ensure_still_alive();
    }

    let value: JSValue = this.get_value(
        global,
        this_value,
        "toHaveProperty",
        "<green>path<r><d>, <r><green>value<r>",
    )?;

    if !expected_property_path.is_string() && !expected_property_path.is_iterable(global)? {
        return global.throw(format_args!("Expected path must be a string or an array"));
    }

    let not = this.flags.not;
    let mut path_string = ZigString::EMPTY;
    expected_property_path.to_zig_string(&mut path_string, global)?;

    let mut pass = !value.is_undefined_or_null();
    let mut received_property: JSValue = JSValue::ZERO;

    if pass {
        received_property = value.get_if_property_exists_from_path(global, expected_property_path)?;
        pass = !received_property.is_empty();
    }

    if pass && expected_property.is_some() {
        pass = received_property.jest_deep_equals(expected_property.unwrap(), global)?;
    }

    if not {
        pass = !pass;
    }
    if pass {
        return Ok(JSValue::UNDEFINED);
    }

    // handle failure
    let mut formatter = ConsoleFormatter {
        global_this: global,
        quote_strings: true,
        ..Default::default()
    };
    // `defer formatter.deinit()` — handled by Drop.
    if not {
        if expected_property.is_some() {
            let signature =
                Expect::get_signature("toHaveProperty", "<green>path<r><d>, <r><green>value<r>", true);
            if !received_property.is_empty() {
                return this.throw(
                    global,
                    signature,
                    format_args!(
                        "\n\nExpected path: <green>{}<r>\n\nExpected value: not <green>{}<r>\n",
                        expected_property_path.to_fmt(&mut formatter),
                        expected_property.unwrap().to_fmt(&mut formatter),
                    ),
                );
            }
        }

        let signature = Expect::get_signature("toHaveProperty", "<green>path<r>", true);
        return this.throw(
            global,
            signature,
            format_args!(
                "\n\nExpected path: not <green>{}<r>\n\nReceived value: <red>{}<r>\n",
                expected_property_path.to_fmt(&mut formatter),
                received_property.to_fmt(&mut formatter),
            ),
        );
    }

    if expected_property.is_some() {
        let signature =
            Expect::get_signature("toHaveProperty", "<green>path<r><d>, <r><green>value<r>", false);
        if !received_property.is_empty() {
            // deep equal case
            let diff_format = DiffFormatter {
                received: received_property,
                expected: expected_property.unwrap(),
                global_this: global,
                ..Default::default()
            };

            return this.throw(global, signature, format_args!("\n\n{}\n", diff_format));
        }

        const FMT: &str = concat!(
            "\n\nExpected path: <green>{}<r>\n\nExpected value: <green>{}<r>\n\n",
            "Unable to find property\n",
        );
        // TODO(port): format_args! requires a literal; FMT inlined below to match Zig `++` concat.
        return this.throw(
            global,
            signature,
            format_args!(
                "\n\nExpected path: <green>{}<r>\n\nExpected value: <green>{}<r>\n\nUnable to find property\n",
                expected_property_path.to_fmt(&mut formatter),
                expected_property.unwrap().to_fmt(&mut formatter),
            ),
        );
    }

    let signature = Expect::get_signature("toHaveProperty", "<green>path<r>", false);
    this.throw(
        global,
        signature,
        format_args!(
            "\n\nExpected path: <green>{}<r>\n\nUnable to find property\n",
            expected_property_path.to_fmt(&mut formatter),
        ),
    )
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/expect/toHaveProperty.zig (101 lines)
//   confidence: medium
//   todos:      1
//   notes:      scopeguard owns &mut Expect for post_match defer; Expect.throw assumed to take fmt::Arguments; to_fmt(&mut formatter) may need borrowck reshape (two &mut in one format_args!)
// ──────────────────────────────────────────────────────────────────────────
