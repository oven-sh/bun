use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_core::ZigString;

use super::DiffFormatter;
use super::Expect;

// TODO(port): #[bun_jsc::host_fn(method)] — must be inside `impl Expect`; shim wired by JsClass codegen
pub(crate) fn to_have_property(
    this: &Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    // PORT NOTE: `defer this.postMatch(globalThis)` — guard owns `this` and calls post_match on drop.
    let this = scopeguard::guard(this, |this| this.post_match(global));

    let this_value = frame.this();
    let _arguments = frame.arguments_old::<2>();
    let arguments: &[JSValue] = _arguments.slice();

    if arguments.len() < 1 {
        return Err(global.throw_invalid_arguments(format_args!(
            "toHaveProperty() requires at least 1 argument"
        )));
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
        return Err(global.throw(format_args!("Expected path must be a string or an array")));
    }

    let not = this.flags.get().not();
    let mut path_string = ZigString::EMPTY;
    expected_property_path.to_zig_string(&mut path_string, global)?;

    let mut pass = !value.is_undefined_or_null();
    let mut received_property: JSValue = JSValue::ZERO;

    if pass {
        received_property = value.get_if_property_exists_from_path(global, expected_property_path)?;
        pass = !received_property.is_empty();
    }

    if pass {
        if let Some(expected_property_value) = expected_property {
            pass = received_property.jest_deep_equals(expected_property_value, global)?;
        }
    }

    if not {
        pass = !pass;
    }
    if pass {
        return Ok(JSValue::UNDEFINED);
    }

    let mut formatter = super::make_formatter(global);
    let mut formatter2 = super::make_formatter(global);
    // `defer formatter.deinit()` — handled by Drop.
    if not {
        if let Some(expected_property_value) = expected_property {
            let signature =
                Expect::get_signature("toHaveProperty", "<green>path<r><d>, <r><green>value<r>", true);
            if !received_property.is_empty() {
                return this.throw(
                    global,
                    signature,
                    format_args!(
                        "\n\nExpected path: <green>{}<r>\n\nExpected value: not <green>{}<r>\n",
                        expected_property_path.to_fmt(&mut formatter),
                        expected_property_value.to_fmt(&mut formatter2),
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
                received_property.to_fmt(&mut formatter2),
            ),
        );
    }

    if let Some(expected_property_value) = expected_property {
        let signature =
            Expect::get_signature("toHaveProperty", "<green>path<r><d>, <r><green>value<r>", false);
        if !received_property.is_empty() {
            // deep equal case
            let diff_format = DiffFormatter {
                received: Some(received_property),
                expected: Some(expected_property_value),
                global_this: Some(global),
                ..Default::default()
            };

            return this.throw(global, signature, format_args!("\n\n{}\n", diff_format));
        }

        return this.throw(
            global,
            signature,
            format_args!(
                "\n\nExpected path: <green>{}<r>\n\nExpected value: <green>{}<r>\n\nUnable to find property\n",
                expected_property_path.to_fmt(&mut formatter),
                expected_property_value.to_fmt(&mut formatter2),
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

// ported from: src/test_runner/expect/toHaveProperty.zig
