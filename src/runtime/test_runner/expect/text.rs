use bun_core::strings;
use bun_jsc::bindgen::{JsLocal, JsScope};

use super::matcher::{EXPECTED, This, Verdict, fail};
use super::{Expect, JSValueTestExt as _};

/// Unlike `u8::is_ascii_whitespace`, a vertical tab is whitespace.
fn without_whitespace(text: &[u8]) -> impl Iterator<Item = &u8> {
    text.iter().filter(|byte| !matches!(byte, b' ' | b'\t'..=b'\r'))
}

impl Expect {
    pub(crate) fn to_start_with(&self, this: This<'_>, cx: &mut JsScope<'_>, expected: JsLocal<'_>) -> Verdict {
        Self::to_have_substring(this, cx, expected, "toStartWith", "start with", strings::starts_with)
    }

    pub(crate) fn to_end_with(&self, this: This<'_>, cx: &mut JsScope<'_>, expected: JsLocal<'_>) -> Verdict {
        Self::to_have_substring(this, cx, expected, "toEndWith", "end with", strings::ends_with)
    }

    pub(crate) fn to_include(&self, this: This<'_>, cx: &mut JsScope<'_>, expected: JsLocal<'_>) -> Verdict {
        Self::to_have_substring(this, cx, expected, "toInclude", "include", strings::contains)
    }

    #[optimize(size)]
    fn to_have_substring(
        this: This<'_>,
        cx: &mut JsScope<'_>,
        expected: JsLocal<'_>,
        name: &'static str,
        verb: &'static str,
        has: fn(&[u8], &[u8]) -> bool,
    ) -> Verdict {
        let expected = expected.to_js();
        if !expected.is_string() {
            return Err(cx.global().throw(format_args!("{name}() requires the first argument to be a string")));
        }
        let (m, received) = this.start(cx, name, EXPECTED)?;
        let matched = received.is_string() && {
            let (text, substring) = (received.to_utf8(m.global)?, expected.to_utf8(m.global)?);
            substring.is_empty() || has(&text, &substring)
        };
        if m.passes(matched) { m.pass() } else { m.fail_expected_to(verb, expected, received) }
    }

    #[optimize(size)]
    pub(crate) fn to_include_repeated(
        &self,
        this: This<'_>,
        cx: &mut JsScope<'_>,
        substring: JsLocal<'_>,
        count: JsLocal<'_>,
    ) -> Verdict {
        let m = this.begin(cx, "toIncludeRepeated", EXPECTED).count();
        let (substring, count) = (substring.to_js(), count.to_js());
        if !substring.is_string() {
            return Err(m.global.throw(format_args!("toIncludeRepeated() requires the first argument to be a string")));
        }
        if !count.is_any_int() {
            return Err(m
                .global
                .throw(format_args!("toIncludeRepeated() requires the second argument to be a number")));
        }
        let received = m.received()?;
        if !received.is_string() {
            return Err(m.global.throw(format_args!("toIncludeRepeated() requires the expect(value) to be a string")));
        }
        let (text, needle) = (received.to_utf8(m.global)?, substring.to_utf8(m.global)?);
        if needle.is_empty() {
            return Err(m
                .global
                .throw(format_args!("toIncludeRepeated() requires the first argument to be a non-empty string")));
        }

        let times = count.to_u32();
        if m.passes(strings::count(&text, &needle) == times as usize) {
            return m.pass();
        }
        let verb = match (m.not(), times) {
            (false, 0) => "to not include",
            (true, 1..) => "not to include",
            _ => "to include",
        };
        if times > 1 {
            return fail!(
                m,
                "Expected {}: <green>{}<r> <green>{}<r> times \nReceived: <red>{}<r>\n",
                verb,
                m.show(substring),
                m.show(count),
                m.show(received),
            );
        }
        let space = if m.not() { " " } else { "" };
        fail!(
            m,
            "Expected {}: <green>{}<r>{}\nReceived: <red>{}<r>\n",
            verb,
            m.show(substring),
            space,
            m.show(received)
        )
    }

    pub(crate) fn to_match(&self, this: This<'_>, cx: &mut JsScope<'_>, expected: JsLocal<'_>) -> Verdict {
        let (m, received) = this.start(cx, "toMatch", EXPECTED)?;
        let expected = expected.to_js();
        if !expected.is_string() && !expected.is_reg_exp() {
            return Err(m
                .global
                .throw(format_args!("Expected value must be a string or regular expression: {}", m.show(expected))));
        }
        if !received.is_string() {
            return Err(m.global.throw(format_args!("Received value must be a string: {}", m.show(received))));
        }
        let matched = if expected.is_string() {
            received.string_includes(m.global, expected)?
        } else {
            expected.to_match(m.global, received)?
        };
        if m.passes(matched) {
            return m.pass();
        }
        fail!(
            m,
            "Expected substring or pattern: {}<green>{}<r>\nReceived: <red>{}<r>\n",
            m.not_word(),
            m.show(expected),
            m.show(received)
        )
    }

    #[optimize(size)]
    pub(crate) fn to_equal_ignoring_whitespace(
        &self,
        this: This<'_>,
        cx: &mut JsScope<'_>,
        expected: JsLocal<'_>,
    ) -> Verdict {
        let (m, received) = this.start(cx, "toEqualIgnoringWhitespace", EXPECTED)?;
        let expected = expected.to_js();
        if !expected.is_string() {
            return Err(m.global.throw(format_args!("toEqualIgnoringWhitespace() requires argument to be a string")));
        }
        let matched = received.is_string() && {
            let (received, expected) = (received.to_utf8(m.global)?, expected.to_utf8(m.global)?);
            without_whitespace(&received).eq(without_whitespace(&expected))
        };
        if m.passes(matched) { m.pass() } else { m.fail_expected(expected, received) }
    }
}
