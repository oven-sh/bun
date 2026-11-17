use bun_core::strings;
use bun_jsc::bindgen::{JsLocal, JsScope};
use bun_jsc::{JSGlobalObject, JSPropertyIterator, JSPropertyIteratorOptions, JSValue, JsError, JsResult};

use super::expect_deferred::{Asked, Pass, Question};
use super::matcher::{EXPECTED, Matcher, NO_PARAMS, This, Verdict, fail};
use super::{Expect, show};

fn any_item(
    global: &JSGlobalObject,
    array: JSValue,
    mut test: impl FnMut(JSValue) -> JsResult<bool>,
) -> JsResult<bool> {
    let mut items = array.array_iterator(global)?;
    while let Some(item) = items.next()? {
        if test(item)? {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Reads to the end, also after a match.
fn any_iterated(
    global: &JSGlobalObject,
    iterable: JSValue,
    mut test: impl FnMut(JSValue) -> JsResult<bool>,
) -> JsResult<bool> {
    let mut any = false;
    let found = &mut any;
    iterable.try_for_each(global, move |item| {
        *found |= test(item)?;
        Ok(())
    })?;
    Ok(any)
}

fn any_index(count: u64, mut test: impl FnMut(u32) -> JsResult<bool>) -> JsResult<bool> {
    for index in 0..count as u32 {
        if test(index)? {
            return Ok(true);
        }
    }
    Ok(false)
}

fn any_item_equals(global: &JSGlobalObject, array: JSValue, value: JSValue) -> JsResult<bool> {
    any_item(global, array, |item| item.jest_deep_equals(value, global))
}

/// As an array, and the same one on a replay: an iterator can only be read once.
fn items_of(global: &JSGlobalObject, iterable: JSValue) -> JsResult<JSValue> {
    Pass::once(global, Question { asked: Asked::Items, who: JSValue::UNDEFINED, what: iterable }, &mut || {
        let items = JSValue::create_empty_array(global, 0)?;
        let mut count = 0;
        iterable.try_for_each(global, move |item| {
            items.put_index(global, count, item)?;
            count += 1;
            Ok(())
        })?;
        Ok(items)
    })
}

#[cold]
fn throw_not_a_list(global: &JSGlobalObject) -> JsError {
    global.throw(format_args!(
        "Received value must be an array type, or both received and expected values must be strings."
    ))
}

#[cold]
fn throw_no_length(global: &JSGlobalObject, received: JSValue) -> JsError {
    global.throw(format_args!("Received value does not have a length property: {}", show(global, received)))
}

#[cold]
fn throw_length_is_nan(global: &JSGlobalObject) -> JsError {
    global.throw(format_args!("Received value has non-number length property: NaN"))
}

/// Vitest's check.
fn is_dom_node(global: &JSGlobalObject, value: JSValue) -> JsResult<bool> {
    match global.to_js_value().get(global, "Node")? {
        Some(node) if node.is_callable() => value.is_instance_of(global, node),
        _ => Ok(false),
    }
}

impl Expect {
    pub(crate) fn to_have_length(&self, this: This<'_>, cx: &mut JsScope<'_>, expected: JsLocal<'_>) -> Verdict {
        let (m, received) = this.start(cx, "toHaveLength", EXPECTED)?;
        if !received.is_object() && !received.is_string() {
            return Err(throw_no_length(m.global, received));
        }
        let expected = Self::non_negative_integer(m.global, expected.to_js(), f64::MAX)?;
        let length = received.get_length_if_property_exists_internal(m.global)?;
        if length == f64::INFINITY {
            return Err(throw_no_length(m.global, received));
        }
        if length.is_nan() {
            return Err(throw_length_is_nan(m.global));
        }
        if m.passes(length == expected) {
            return m.pass();
        }
        if m.not() {
            return fail!(m, "Expected length: not <green>{}<r>\n", expected);
        }
        fail!(m, "Expected length: <green>{}<r>\nReceived length: <red>{}<r>\n", expected, length)
    }

    #[optimize(size)]
    pub(crate) fn to_be_array_of_size(&self, this: This<'_>, cx: &mut JsScope<'_>, size: JsLocal<'_>) -> Verdict {
        let call = this.begin(cx, "toBeArrayOfSize", NO_PARAMS);
        let received = call.received()?;
        let size = size.to_js();
        if !size.is_any_int() {
            return Err(call
                .global()
                .throw(format_args!("toBeArrayOfSize() requires the first argument to be a number")));
        }
        let m = call.count();
        let matched = received.is_array() && received.get_length(m.global)? as i64 == size.to_int64();
        if m.passes(matched) { m.pass() } else { m.fail_received(received) }
    }

    #[optimize(size)]
    pub(crate) fn to_be_empty(&self, this: This<'_>, cx: &mut JsScope<'_>) -> Verdict {
        let (m, received) = this.start(cx, "toBeEmpty", NO_PARAMS)?;
        let global = m.global;
        let length = received.get_length_if_property_exists_internal(global)?;
        let is_empty = if length.is_nan() {
            return Err(throw_length_is_nan(global));
        } else if length != f64::INFINITY {
            length == 0.0
        } else if !received.is_object() {
            return fail!(
                m.signed_not(false),
                "Expected value to be a string, object, or iterable\n\nReceived: <red>{}<r>\n",
                m.show(received),
            );
        } else if received.is_iterable(global)? {
            !any_iterated(global, received, |_| Ok(true))?
        } else {
            let options = JSPropertyIteratorOptions {
                own_properties_only: false,
                include_value: true,
                // jest-extended compares against `{}` with an equality that sees enumerable Symbol keys.
                include_symbols: true,
                ..Default::default()
            };
            JSPropertyIterator::init(global, received.to_object(global)?, options)?.len == 0
        };
        if m.passes(is_empty) {
            return m.pass();
        }
        if m.not() {
            return fail!(
                m,
                "Expected value <b>not<r> to be a string, object, or iterable\n\nReceived: <red>{}<r>\n",
                m.show(received)
            );
        }
        fail!(m, "Expected value to be empty\n\nReceived: <red>{}<r>\n", m.show(received))
    }

    #[optimize(size)]
    pub(crate) fn to_be_one_of(&self, this: This<'_>, cx: &mut JsScope<'_>, expected: JsLocal<'_>) -> Verdict {
        let (m, received) = this.start(cx, "toBeOneOf", EXPECTED)?;
        let global = m.global;
        let expected = expected.to_js();
        // jest-extended compares like `toEqual`, not like `toBe`.
        let matched = if expected.js_type().is_array_like() {
            any_item_equals(global, expected, received)?
        } else if expected.is_iterable(global)? {
            any_iterated(global, expected, move |item| item.jest_deep_equals(received, global))?
        } else {
            return Err(throw_not_a_list(global));
        };
        if m.passes(matched) { m.pass() } else { m.fail_expected_to("be one of", expected, received) }
    }

    pub(crate) fn to_contain(&self, this: This<'_>, cx: &mut JsScope<'_>, expected: JsLocal<'_>) -> Verdict {
        let (m, received) = this.start(cx, "toContain", EXPECTED)?;
        let global = m.global;
        let expected = expected.to_js();
        // `===` like Jest's `indexOf()`, not Object.is: `[-0]` contains `0`, `[NaN]` does not contain `NaN`.
        let matched = if received.js_type().is_array_like() {
            any_item(global, received, |item| item.is_strict_equal(expected, global))?
        } else if received.is_string_literal() && (expected.is_string_literal() || self.is_vitest()) {
            // Vitest searches with `indexOf()`, which converts `expected` to a string. Jest refuses a non-string.
            let (text, substring) = (received.to_utf8(global)?, expected.to_utf8(global)?);
            substring.is_empty() || strings::contains(&text, &substring)
        } else if self.is_vitest() && is_dom_node(global, received)? {
            if !is_dom_node(global, expected)? {
                return Err(global.throw_type_error(format_args!(
                    "toContain() expected a DOM node as the argument, but got {}",
                    expected.js_type_string(global)
                )));
            }
            let contains = received.get(global, "contains")?.unwrap_or(JSValue::UNDEFINED);
            contains.call(global, received, &[expected])?.to_boolean()
        } else if received.is_iterable(global)? {
            any_iterated(global, received, move |item| item.is_strict_equal(expected, global))?
        } else {
            return Err(throw_not_a_list(global));
        };
        if m.passes(matched) { m.pass() } else { m.fail_expected_to("contain", expected, received) }
    }

    #[optimize(size)]
    pub(crate) fn to_contain_equal(&self, this: This<'_>, cx: &mut JsScope<'_>, expected: JsLocal<'_>) -> Verdict {
        let (m, received) = this.start(cx, "toContainEqual", EXPECTED)?;
        let global = m.global;
        let expected = expected.to_js();
        let matched = if received.js_type().is_array_like() {
            any_item_equals(global, received, expected)?
        } else if received.is_string_literal() && expected.js_type().is_string_object_like() {
            false
        } else if received.is_string() && expected.is_string() {
            // Jest spreads the string into an array, so only one code point can be in it.
            let (text, character) = (received.to_utf8(global)?, expected.to_utf8(global)?);
            let code_points = strings::CodepointIterator::init(&character);
            let mut cursor = strings::Cursor::default();
            let _ = code_points.next(&mut cursor);
            !code_points.next(&mut cursor) && strings::contains(&text, &character)
        } else if received.is_iterable(global)? {
            any_item_equals(global, items_of(global, received)?, expected)?
        } else {
            return Err(throw_not_a_list(global));
        };
        if m.passes(matched) {
            return m.pass_this();
        }
        if m.not() {
            return fail!(m, "Expected to not contain: <green>{}<r>\n", m.show(expected));
        }
        m.fail_expected_to("contain", expected, received)
    }
}

fn array_argument(m: &Matcher<'_>, expected: JsLocal<'_>) -> JsResult<JSValue> {
    let expected = expected.to_js();
    if expected.is_array() {
        Ok(expected)
    } else {
        Err(m.global.throw_invalid_argument_type(m.name, "expected", "array"))
    }
}

fn contained(m: &Matcher<'_>, matched: bool, verb: &str, expected: JSValue, received: JSValue) -> Verdict {
    if m.passes(matched) { m.pass_this() } else { m.fail_expected_to(verb, expected, received) }
}

/// `Object.values()`
struct Values<'a> {
    global: &'a JSGlobalObject,
    array: JSValue,
    count: u64,
}

impl<'a> Values<'a> {
    fn of(global: &'a JSGlobalObject, object: JSValue) -> JsResult<Option<Self>> {
        if object.is_undefined_or_null() {
            return Ok(None);
        }
        let array = object.values(global)?;
        Ok(Some(Self { global, array, count: array.get_length(global)? }))
    }

    fn has(&self, expected: JSValue) -> JsResult<bool> {
        any_index(self.count, |index| self.array.get_index(self.global, index)?.jest_deep_equals(expected, self.global))
    }

    fn has_all(&self, expected: JSValue) -> JsResult<bool> {
        Ok(!any_item(self.global, expected, |item| Ok(!self.has(item)?))?)
    }
}

impl Expect {
    #[optimize(size)]
    pub(crate) fn to_contain_key(&self, this: This<'_>, cx: &mut JsScope<'_>, expected: JsLocal<'_>) -> Verdict {
        let m = this.begin(cx, "toContainKey", EXPECTED).count();
        let received = m.received()?;
        let expected = expected.to_js();
        if !received.is_object() {
            return Err(m.global.throw_invalid_arguments(format_args!(
                "Expected value must be an object\nReceived: {}",
                m.show(received)
            )));
        }
        contained(&m, received.has_own_property_value(m.global, expected)?, "contain", expected, received)
    }

    #[optimize(size)]
    pub(crate) fn to_contain_keys(&self, this: This<'_>, cx: &mut JsScope<'_>, expected: JsLocal<'_>) -> Verdict {
        let m = this.begin(cx, "toContainKeys", EXPECTED).count();
        let received = m.received()?;
        let expected = array_argument(&m, expected)?;
        let count = expected.get_length(m.global)?;
        let matched = if received.is_object() {
            !any_index(count, |index| {
                Ok(!received.has_own_property_value(m.global, expected.get_index(m.global, index)?)?)
            })?
        } else {
            // jest-extended passes anything when no key is expected.
            count == 0
        };
        contained(&m, matched, "contain", expected, received)
    }

    #[optimize(size)]
    pub(crate) fn to_contain_any_keys(&self, this: This<'_>, cx: &mut JsScope<'_>, expected: JsLocal<'_>) -> Verdict {
        let m = this.begin(cx, "toContainAnyKeys", EXPECTED).count();
        let received = m.received()?;
        let expected = array_argument(&m, expected)?;
        let matched = received.is_object()
            && any_index(expected.get_length(m.global)?, |index| {
                received.has_own_property_value(m.global, expected.get_index(m.global, index)?)
            })?;
        contained(&m, matched, "contain", expected, received)
    }

    #[optimize(size)]
    pub(crate) fn to_contain_all_keys(&self, this: This<'_>, cx: &mut JsScope<'_>, expected: JsLocal<'_>) -> Verdict {
        let m = this.begin(cx, "toContainAllKeys", EXPECTED).count();
        let global = m.global;
        let received = m.received()?;
        let expected = array_argument(&m, expected)?;
        let count = expected.get_length(global)?;
        let keys = received.keys(global)?;
        let matched = keys.get_length(global)? == count
            && !any_item(global, keys, |key| {
                Ok(!any_index(count, |index| key.jest_deep_equals(expected.get_index(global, index)?, global))?)
            })?;
        contained(&m, matched, "contain all keys", expected, keys)
    }

    #[optimize(size)]
    pub(crate) fn to_contain_value(&self, this: This<'_>, cx: &mut JsScope<'_>, expected: JsLocal<'_>) -> Verdict {
        let m = this.begin(cx, "toContainValue", EXPECTED).count();
        let received = m.received()?;
        let expected = expected.to_js();
        let matched =
            !received.is_undefined_or_null() && any_item_equals(m.global, received.values(m.global)?, expected)?;
        contained(&m, matched, "contain", expected, received)
    }

    #[optimize(size)]
    pub(crate) fn to_contain_values(&self, this: This<'_>, cx: &mut JsScope<'_>, expected: JsLocal<'_>) -> Verdict {
        let m = this.begin(cx, "toContainValues", EXPECTED).count();
        let expected = array_argument(&m, expected)?;
        let received = m.received()?;
        let matched = match Values::of(m.global, received)? {
            Some(values) => values.has_all(expected)?,
            None => true,
        };
        contained(&m, matched, "contain", expected, received)
    }

    #[optimize(size)]
    pub(crate) fn to_contain_any_values(&self, this: This<'_>, cx: &mut JsScope<'_>, expected: JsLocal<'_>) -> Verdict {
        let m = this.begin(cx, "toContainAnyValues", EXPECTED).count();
        let expected = array_argument(&m, expected)?;
        let received = m.received()?;
        let matched = match Values::of(m.global, received)? {
            Some(values) => any_item(m.global, expected, |item| values.has(item))?,
            None => false,
        };
        contained(&m, matched, "contain any of the following values", expected, received)
    }

    #[optimize(size)]
    pub(crate) fn to_contain_all_values(&self, this: This<'_>, cx: &mut JsScope<'_>, expected: JsLocal<'_>) -> Verdict {
        let m = this.begin(cx, "toContainAllValues", EXPECTED).count();
        let expected = array_argument(&m, expected)?;
        let received = m.received()?;
        let matched = match Values::of(m.global, received)? {
            Some(values) => {
                values.count != 0 && values.count == expected.get_length(m.global)? && values.has_all(expected)?
            }
            None => false,
        };
        contained(&m, matched, "contain all values", expected, received)
    }
}
