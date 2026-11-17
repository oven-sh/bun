use bun_jsc::JSValue;
use bun_jsc::bindgen::{JsLocal, JsScope};

use super::Expect;
use super::matcher::{EXPECTED, NO_PARAMS, This, Verdict, fail, params};

impl Expect {
    /// Object.is()
    pub(crate) fn to_be(&self, this: This<'_>, cx: &mut JsScope<'_>, expected: JsLocal<'_>) -> Verdict {
        let (m, received) = this.start(cx, "toBe", EXPECTED)?;
        let expected = expected.to_js();
        if m.passes(expected.is_same_value(received, m.global)?) {
            return m.pass();
        }
        if m.not() {
            return fail!(m, "Expected: not <green>{}<r>\n", m.show(expected));
        }
        if received.jest_deep_equals(expected, m.global)? || received.jest_strict_deep_equals(expected, m.global)? {
            if self.custom_label.is_empty() {
                return fail!(m, "Expected: <green>{}<r>\nReceived: serializes to the same string\n", m.show(expected));
            }
            return fail!(
                m,
                concat!(
                    "<d>If this test should pass, replace \"toBe\" with \"toEqual\" or \"toStrictEqual\"<r>\n\n",
                    "Expected: <green>{}<r>\nReceived: serializes to the same string\n",
                ),
                m.show(expected),
            );
        }
        if expected.is_string() && received.is_string() {
            return m.fail_diff(expected, received);
        }
        m.fail_expected(expected, received)
    }

    pub(crate) fn to_equal(&self, this: This<'_>, cx: &mut JsScope<'_>, expected: JsLocal<'_>) -> Verdict {
        let (m, received) = this.start(cx, "toEqual", EXPECTED)?;
        let expected = expected.to_js();
        if m.passes(received.jest_deep_equals(expected, m.global)?) {
            m.pass()
        } else {
            m.fail_diff(expected, received)
        }
    }

    pub(crate) fn to_strict_equal(&self, this: This<'_>, cx: &mut JsScope<'_>, expected: JsLocal<'_>) -> Verdict {
        let (m, received) = this.start(cx, "toStrictEqual", EXPECTED)?;
        let expected = expected.to_js();
        if m.passes(received.jest_strict_deep_equals(expected, m.global)?) {
            m.pass()
        } else {
            m.fail_diff(expected, received)
        }
    }

    pub(crate) fn to_match_object(&self, this: This<'_>, cx: &mut JsScope<'_>, expected: JsLocal<'_>) -> Verdict {
        let (m, received) = this.start(cx, "toMatchObject", EXPECTED)?;
        let expected = expected.to_js();
        // Jest refuses a value that isn't an object. To Vitest it's one that doesn't match.
        if m.not() && !(received.is_object() && expected.is_object()) && self.is_vitest() {
            return m.pass();
        }
        if !received.is_object() {
            return fail!(m, "<b>Matcher error<r>: <red>received<r> value must be a non-null object\n");
        }
        if !expected.is_object() {
            return fail!(
                m.with_params(NO_PARAMS),
                "<b>Matcher error<r>: <green>expected<r> value must be a non-null object\n"
            );
        }
        let (matched, shown) = received.jest_deep_match(expected, m.global, m.not())?;
        if m.passes(matched) { m.pass() } else { m.fail_diff(expected, shown) }
    }

    pub(crate) fn to_have_property(
        &self,
        this: This<'_>,
        cx: &mut JsScope<'_>,
        path: JsLocal<'_>,
        value: &[JsLocal<'_>],
    ) -> Verdict {
        let m = this.begin(cx, "toHaveProperty", params!("<green>path<r><d>, <r><green>value<r>")).count();
        let global = m.global;
        let path = path.to_js();
        let expected = value.first().map(|value| value.to_js());
        let received = m.received()?;

        // bun:test has always let `.not.toHaveProperty()` pass on these two.
        if received.is_undefined_or_null() && self.is_vitest() {
            return Err(global.throw_type_error(format_args!(
                ".toHaveProperty() expects to receive a valid object, but got {}",
                if received.is_null() { "null" } else { "undefined" },
            )));
        }
        if !path.is_string() && !path.is_iterable(global)? {
            return Err(global.throw(format_args!("Expected path must be a string or an array")));
        }

        let mut found: Option<JSValue> = None;
        if !received.is_undefined_or_null() {
            // In Vitest an own key spelled like the whole path, e.g. "a.b", wins over walking the path.
            if path.is_string() && self.is_vitest() {
                found = received.get_own(global, &path.to_bun_string(global)?)?;
            }
            if found.is_none() {
                found =
                    Some(received.get_if_property_exists_from_path(global, path)?).filter(|found| !found.is_empty());
            }
        }
        let matched = match (found, expected) {
            (Some(found), Some(expected)) => found.jest_deep_equals(expected, global)?,
            _ => found.is_some(),
        };
        if m.passes(matched) {
            return m.pass();
        }

        let path_only = m.with_params(params!("<green>path<r>"));
        match (found, expected) {
            (None, None) => fail!(path_only, "Expected path: <green>{}<r>\n\nUnable to find property\n", m.show(path)),
            (Some(found), None) => {
                fail!(
                    path_only,
                    "Expected path: not <green>{}<r>\n\nReceived value: <red>{}<r>\n",
                    m.show(path),
                    m.show(found)
                )
            }
            (None, Some(expected)) => fail!(
                m,
                "Expected path: <green>{}<r>\n\nExpected value: <green>{}<r>\n\nUnable to find property\n",
                m.show(path),
                m.show(expected),
            ),
            (Some(_), Some(expected)) if m.not() => {
                fail!(
                    m,
                    "Expected path: <green>{}<r>\n\nExpected value: not <green>{}<r>\n",
                    m.show(path),
                    m.show(expected)
                )
            }
            (Some(found), Some(expected)) => m.fail_diff(expected, found),
        }
    }
}
