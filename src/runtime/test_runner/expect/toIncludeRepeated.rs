use bstr::ByteSlice;
#[allow(unused_imports)] use super::{JSValueTestExt, JSGlobalObjectTestExt, BigIntCompare, make_formatter};
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_jsc::console_object::Formatter;

use super::{Expect, get_signature};

impl Expect {
    #[bun_jsc::host_fn(method)]
    pub fn to_include_repeated(
        &self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        // toIncludeRepeated bypasses get_value (reads `captured_value_get_cached` directly,
        // no `.resolves`/`.rejects` handling), so cannot use the full `matcher_prelude`.
        let this = self.post_match_guard(global);

        let this_value = frame.this();
        let arguments_ = frame.arguments_old::<2>();
        let arguments = arguments_.slice();

        if arguments.len() < 2 {
            return Err(global.throw_invalid_arguments(format_args!(
                "toIncludeRepeated() requires 2 arguments"
            )));
        }

        this.increment_expect_call_counter();

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

        let Some(expect_string) = super::js::captured_value_get_cached(this_value) else {
            return Err(global.throw(format_args!(
                "Internal consistency error: the expect(value) was garbage collected but it should not have been!"
            )));
        };

        if !expect_string.is_string() {
            return Err(global.throw(format_args!(
                "toIncludeRepeated() requires the expect(value) to be a string"
            )));
        }

        let not = this.flags.get().not();
        let mut pass = false;

        let expect_string_as_str_owned = expect_string.to_slice_or_null(global)?;
        let sub_string_as_str_owned = substring.to_slice_or_null(global)?;
        // defer .deinit() → handled by Drop

        let expect_string_as_str = expect_string_as_str_owned.slice();
        let sub_string_as_str = sub_string_as_str_owned.slice();

        if sub_string_as_str.is_empty() {
            return Err(global.throw(format_args!(
                "toIncludeRepeated() requires the first argument to be a non-empty string"
            )));
        }

        // std.mem.count(u8, haystack, needle) — non-overlapping occurrence count
        let actual_count = expect_string_as_str.find_iter(sub_string_as_str).count();
        pass = actual_count == count_as_num as usize;

        if not {
            pass = !pass;
        }
        if pass {
            return Ok(JSValue::UNDEFINED);
        }

        // PORT NOTE: Zig aliased one `*Formatter` for all three fmt adapters; Rust `to_fmt` takes
        // `&mut Formatter` and the returned adapter holds that borrow live, so three concurrent
        // adapters need three formatters. `make_formatter` is a trivial struct init with no shared
        // state between values.
        let mut formatter = super::make_formatter(global);
        let mut formatter2 = super::make_formatter(global);
        let mut formatter3 = super::make_formatter(global);
        // defer formatter.deinit() → handled by Drop
        let expect_string_fmt = expect_string.to_fmt(&mut formatter);
        let substring_fmt = substring.to_fmt(&mut formatter2);
        let times_fmt = count.to_fmt(&mut formatter3);

        // PORT NOTE: Zig builds `"\n\n" ++ expected_line ++ received_line` at comptime via named
        // consts; Rust `concat!` only accepts literal tokens (not `const` items), so the pieces are
        // inlined directly below instead of bound to RECEIVED_LINE/EXPECTED_LINE locals.
        if not {
            if count_as_num == 0 {
                let signature: &str = get_signature("toIncludeRepeated", "<green>expected<r>", true);
                return this.throw(
                    global,
                    signature,
                    format_args!(
                        concat!("\n\n", "Expected to include: <green>{}<r> \n", "Received: <red>{}<r>\n"),
                        substring_fmt,
                        expect_string_fmt
                    ),
                );
            } else if count_as_num == 1 {
                let signature: &str = get_signature("toIncludeRepeated", "<green>expected<r>", true);
                return this.throw(
                    global,
                    signature,
                    format_args!(
                        concat!("\n\n", "Expected not to include: <green>{}<r> \n", "Received: <red>{}<r>\n"),
                        substring_fmt,
                        expect_string_fmt
                    ),
                );
            } else {
                let signature: &str = get_signature("toIncludeRepeated", "<green>expected<r>", true);
                return this.throw(
                    global,
                    signature,
                    format_args!(
                        concat!("\n\n", "Expected not to include: <green>{}<r> <green>{}<r> times \n", "Received: <red>{}<r>\n"),
                        substring_fmt,
                        times_fmt,
                        expect_string_fmt
                    ),
                );
            }
        }

        if count_as_num == 0 {
            let signature: &str = get_signature("toIncludeRepeated", "<green>expected<r>", false);
            this.throw(
                global,
                signature,
                format_args!(
                    concat!("\n\n", "Expected to not include: <green>{}<r>\n", "Received: <red>{}<r>\n"),
                    substring_fmt,
                    expect_string_fmt
                ),
            )
        } else if count_as_num == 1 {
            let signature: &str = get_signature("toIncludeRepeated", "<green>expected<r>", false);
            this.throw(
                global,
                signature,
                format_args!(
                    concat!("\n\n", "Expected to include: <green>{}<r>\n", "Received: <red>{}<r>\n"),
                    substring_fmt,
                    expect_string_fmt
                ),
            )
        } else {
            let signature: &str = get_signature("toIncludeRepeated", "<green>expected<r>", false);
            this.throw(
                global,
                signature,
                format_args!(
                    concat!("\n\n", "Expected to include: <green>{}<r> <green>{}<r> times \n", "Received: <red>{}<r>\n"),
                    substring_fmt,
                    times_fmt,
                    expect_string_fmt
                ),
            )
        }
    }
}

// ported from: src/test_runner/expect/toIncludeRepeated.zig
