use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};

use super::{Expect, get_signature, throw};

impl Expect {
    #[bun_jsc::host_fn(method)]
    pub(crate) fn to_include_repeated(
        &self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let (this, expect_string, not) =
            self.matcher_prelude(global, frame.this(), "toIncludeRepeated", "<green>expected<r>")?;

        let arguments = frame.arguments();

        if arguments.len() < 2 {
            return Err(global.throw_invalid_arguments(format_args!(
                "toIncludeRepeated() requires 2 arguments"
            )));
        }

        let substring = arguments[0];
        substring.ensure_still_alive();

        if !substring.is_string() {
            return Err(global.throw(format_args!(
                "toIncludeRepeated() requires the first argument to be a string"
            )));
        }

        let count = arguments[1];
        count.ensure_still_alive();

        if !count.is_any_int() {
            return Err(global.throw(format_args!(
                "toIncludeRepeated() requires the second argument to be a number"
            )));
        }

        let count_as_num = count.to_u32();

        if !expect_string.is_string() {
            return Err(global.throw(format_args!(
                "toIncludeRepeated() requires the expect(value) to be a string"
            )));
        }

        let expect_string_as_str_owned = expect_string.to_utf8(global)?;
        let sub_string_as_str_owned = substring.to_utf8(global)?;

        let expect_string_as_str = expect_string_as_str_owned.slice();
        let sub_string_as_str = sub_string_as_str_owned.slice();

        if sub_string_as_str.is_empty() {
            return Err(global.throw(format_args!(
                "toIncludeRepeated() requires the first argument to be a non-empty string"
            )));
        }

        // Non-overlapping occurrence count.
        let actual_count = bun_core::strings::count(expect_string_as_str, sub_string_as_str);
        let mut pass = actual_count == count_as_num as usize;

        if not {
            pass = !pass;
        }
        if pass {
            return Ok(JSValue::UNDEFINED);
        }

        // `to_fmt` takes `&mut Formatter` and the returned adapter holds that borrow live, so
        // three concurrent adapters need three formatters. `make_formatter` is a trivial struct
        // init with no shared state between values.
        let mut formatter = super::make_formatter(global);
        let mut formatter2 = super::make_formatter(global);
        let mut formatter3 = super::make_formatter(global);
        // formatter cleanup handled by Drop
        let expect_string_fmt = expect_string.to_fmt(&mut formatter);
        let substring_fmt = substring.to_fmt(&mut formatter2);
        let times_fmt = count.to_fmt(&mut formatter3);

        // `concat!` only accepts literal tokens (not `const` items), so the message pieces are
        // inlined directly below instead of bound to RECEIVED_LINE/EXPECTED_LINE locals.
        if not {
            if count_as_num == 0 {
                let signature: &str = get_signature("toIncludeRepeated", "<green>expected<r>", true);
                return throw!(
                    this,
                    global,
                    signature,
                    concat!("\n\n", "Expected to include: <green>{}<r> \n", "Received: <red>{}<r>\n"),
                    substring_fmt,
                    expect_string_fmt,
                );
            } else if count_as_num == 1 {
                let signature: &str = get_signature("toIncludeRepeated", "<green>expected<r>", true);
                return throw!(
                    this,
                    global,
                    signature,
                    concat!("\n\n", "Expected not to include: <green>{}<r> \n", "Received: <red>{}<r>\n"),
                    substring_fmt,
                    expect_string_fmt,
                );
            } else {
                let signature: &str = get_signature("toIncludeRepeated", "<green>expected<r>", true);
                return throw!(
                    this,
                    global,
                    signature,
                    concat!("\n\n", "Expected not to include: <green>{}<r> <green>{}<r> times \n", "Received: <red>{}<r>\n"),
                    substring_fmt,
                    times_fmt,
                    expect_string_fmt,
                );
            }
        }

        if count_as_num == 0 {
            let signature: &str = get_signature("toIncludeRepeated", "<green>expected<r>", false);
            throw!(
                this,
                global,
                signature,
                concat!("\n\n", "Expected to not include: <green>{}<r>\n", "Received: <red>{}<r>\n"),
                substring_fmt,
                expect_string_fmt,
            )
        } else if count_as_num == 1 {
            let signature: &str = get_signature("toIncludeRepeated", "<green>expected<r>", false);
            throw!(
                this,
                global,
                signature,
                concat!("\n\n", "Expected to include: <green>{}<r>\n", "Received: <red>{}<r>\n"),
                substring_fmt,
                expect_string_fmt,
            )
        } else {
            let signature: &str = get_signature("toIncludeRepeated", "<green>expected<r>", false);
            throw!(
                this,
                global,
                signature,
                concat!("\n\n", "Expected to include: <green>{}<r> <green>{}<r> times \n", "Received: <red>{}<r>\n"),
                substring_fmt,
                times_fmt,
                expect_string_fmt,
            )
        }
    }
}
