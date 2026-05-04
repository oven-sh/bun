use bstr::ByteSlice;
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_jsc::console_object::Formatter;

use super::{Expect, get_signature};

impl Expect {
    #[bun_jsc::host_fn(method)]
    pub fn to_include_repeated(
        this: &mut Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        // TODO(port): `defer this.postMatch(global)` — scopeguard captures &mut Self and
        // conflicts with later uses; Phase B may need an inner-fn + post_match-on-exit reshape.
        let _post = scopeguard::guard((), |_| this.post_match(global));
        // PORT NOTE: reshaped for borrowck (see above)

        let this_value = frame.this();
        let arguments_ = frame.arguments_old(2);
        let arguments = arguments_.slice();

        if arguments.len() < 2 {
            return global.throw_invalid_arguments(format_args!(
                "toIncludeRepeated() requires 2 arguments"
            ));
        }

        this.increment_expect_call_counter();

        let substring = arguments[0];
        substring.ensure_still_alive();

        if !substring.is_string() {
            return global.throw(format_args!(
                "toIncludeRepeated() requires the first argument to be a string"
            ));
        }

        let count = arguments[1];
        count.ensure_still_alive();

        if !count.is_any_int() {
            return global.throw(format_args!(
                "toIncludeRepeated() requires the second argument to be a number"
            ));
        }

        let count_as_num = count.to_u32();

        let Some(expect_string) = Expect::js::captured_value_get_cached(this_value) else {
            return global.throw(format_args!(
                "Internal consistency error: the expect(value) was garbage collected but it should not have been!"
            ));
        };

        if !expect_string.is_string() {
            return global.throw(format_args!(
                "toIncludeRepeated() requires the expect(value) to be a string"
            ));
        }

        let not = this.flags.not;
        let mut pass = false;

        let expect_string_as_str_owned = expect_string.to_slice_or_null(global)?;
        let sub_string_as_str_owned = substring.to_slice_or_null(global)?;
        // defer .deinit() → handled by Drop

        let expect_string_as_str = expect_string_as_str_owned.slice();
        let sub_string_as_str = sub_string_as_str_owned.slice();

        if sub_string_as_str.is_empty() {
            return global.throw(format_args!(
                "toIncludeRepeated() requires the first argument to be a non-empty string"
            ));
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

        let mut formatter = Formatter {
            global_this: global,
            quote_strings: true,
            ..Default::default()
        };
        // defer formatter.deinit() → handled by Drop
        // PORT NOTE: to_fmt borrows the formatter; three live borrows below would alias under
        // &mut. Using shared & here; Phase B may need interior mutability on Formatter.
        let expect_string_fmt = expect_string.to_fmt(&formatter);
        let substring_fmt = substring.to_fmt(&formatter);
        let times_fmt = count.to_fmt(&formatter);

        const RECEIVED_LINE: &str = "Received: <red>{}<r>\n";

        if not {
            if count_as_num == 0 {
                const EXPECTED_LINE: &str = "Expected to include: <green>{}<r> \n";
                const SIGNATURE: &str = get_signature("toIncludeRepeated", "<green>expected<r>", true);
                return this.throw(
                    global,
                    SIGNATURE,
                    format_args!(
                        concat!("\n\n", "Expected to include: <green>{}<r> \n", "Received: <red>{}<r>\n"),
                        substring_fmt,
                        expect_string_fmt
                    ),
                );
            } else if count_as_num == 1 {
                const EXPECTED_LINE: &str = "Expected not to include: <green>{}<r> \n";
                const SIGNATURE: &str = get_signature("toIncludeRepeated", "<green>expected<r>", true);
                return this.throw(
                    global,
                    SIGNATURE,
                    format_args!(
                        concat!("\n\n", "Expected not to include: <green>{}<r> \n", "Received: <red>{}<r>\n"),
                        substring_fmt,
                        expect_string_fmt
                    ),
                );
            } else {
                const EXPECTED_LINE: &str = "Expected not to include: <green>{}<r> <green>{}<r> times \n";
                const SIGNATURE: &str = get_signature("toIncludeRepeated", "<green>expected<r>", true);
                return this.throw(
                    global,
                    SIGNATURE,
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
            const EXPECTED_LINE: &str = "Expected to not include: <green>{}<r>\n";
            const SIGNATURE: &str = get_signature("toIncludeRepeated", "<green>expected<r>", false);
            this.throw(
                global,
                SIGNATURE,
                format_args!(
                    concat!("\n\n", "Expected to not include: <green>{}<r>\n", "Received: <red>{}<r>\n"),
                    substring_fmt,
                    expect_string_fmt
                ),
            )
        } else if count_as_num == 1 {
            const EXPECTED_LINE: &str = "Expected to include: <green>{}<r>\n";
            const SIGNATURE: &str = get_signature("toIncludeRepeated", "<green>expected<r>", false);
            this.throw(
                global,
                SIGNATURE,
                format_args!(
                    concat!("\n\n", "Expected to include: <green>{}<r>\n", "Received: <red>{}<r>\n"),
                    substring_fmt,
                    expect_string_fmt
                ),
            )
        } else {
            const EXPECTED_LINE: &str = "Expected to include: <green>{}<r> <green>{}<r> times \n";
            const SIGNATURE: &str = get_signature("toIncludeRepeated", "<green>expected<r>", false);
            this.throw(
                global,
                SIGNATURE,
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/expect/toIncludeRepeated.zig (110 lines)
//   confidence: medium
//   todos:      1
//   notes:      scopeguard on post_match aliases &mut Self; Formatter borrow shape and Expect::throw fmt-arg signature need Phase B attention
// ──────────────────────────────────────────────────────────────────────────
