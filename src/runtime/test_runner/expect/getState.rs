use bun_jsc::bun_string_jsc;
use bun_jsc::{CallFrame, JSGlobalObject, JSPropertyIterator, JSPropertyIteratorOptions, JSValue, JsResult};

use super::super::bun_test::{self, ExecutionEntry, RefDataValue};
use super::super::execution::{ExecutionSequence, ExpectAssertions};
use super::super::jest::{FileColumns as _, Jest};
use super::expect_matcher_utils_js as js;
use super::{Expect, ExpectMatcherContext, ExpectMatcherUtils};

/// The names of the enclosing `describe` blocks and of the test.
pub(crate) fn full_test_name(entry: &ExecutionEntry, separator: &[u8]) -> Vec<u8> {
    let mut names: Vec<&[u8]> = vec![entry.base.name.as_deref().unwrap_or(b"(unnamed)")];
    let mut parent = entry.base.parent;
    while let Some(scope) = parent {
        // SAFETY: the `BunTest` that owns `entry` owns its enclosing scopes.
        let scope = unsafe { &*scope };
        if let Some(name) = scope.base.name.as_deref() {
            if !name.is_empty() {
                names.push(name);
            }
        }
        parent = scope.base.parent;
    }
    names.reverse();
    names.join(separator)
}

/// The test to read or write, if not the one that is running.
type Test = Option<RefDataValue>;

/// `None` where `expect.assertions()` is not supported either: outside of a test, and in concurrent tests unless `test` names one.
fn with_sequence<R>(test: Test, f: impl FnOnce(&mut ExecutionSequence) -> R) -> Option<R> {
    let buntest_strong = bun_test::clone_active_strong()?;
    let buntest = buntest_strong.get();
    test.unwrap_or_else(|| buntest.get_current_state_data()).sequence(buntest).map(f)
}

fn assertion_calls(test: Test) -> JSValue {
    JSValue::js_number(f64::from(with_sequence(test, |sequence| sequence.expect_call_count).unwrap_or(0)))
}

fn expected_assertions_number(test: Test) -> JSValue {
    match with_sequence(test, |sequence| sequence.expect_assertions) {
        Some(ExpectAssertions::Exact(count)) => JSValue::js_number(f64::from(count)),
        _ => JSValue::NULL,
    }
}

fn is_expecting_assertions(test: Test) -> JSValue {
    JSValue::from(with_sequence(test, |sequence| sequence.expect_assertions) == Some(ExpectAssertions::AtLeastOne))
}

fn current_test_name(global: &JSGlobalObject, test: Test) -> JsResult<JSValue> {
    let name = with_sequence(test, |sequence| {
        // SAFETY: the `BunTest` kept alive by `with_sequence` owns the entry.
        sequence.test_entry.map(|entry| unsafe { entry.as_ref() }).map(|entry| {
            full_test_name(entry, if entry.calling.is_vitest() { b" > " } else { b" " })
        })
    });
    match name.flatten() {
        Some(name) => bun_string_jsc::create_utf8_for_js(global, &name),
        None => Ok(JSValue::UNDEFINED),
    }
}

fn test_path(global: &JSGlobalObject) -> JsResult<JSValue> {
    let (Some(buntest), Some(runner)) = (bun_test::clone_active_strong(), Jest::runner()) else {
        return Ok(JSValue::UNDEFINED);
    };
    bun_string_jsc::create_utf8_for_js(global, runner.files.items_source()[buntest.file_id as usize].path.text)
}

fn to_count(global: &JSGlobalObject, name: &'static str, value: JSValue) -> JsResult<u32> {
    if !value.is_uint32_as_any_int() {
        return Err(global.throw_invalid_argument_type_value(name, "non-negative integer", value));
    }
    Ok(value.to_u32())
}

impl Expect {
    /// One object per global, so that what `setState` and the caller put on it stays.
    fn state_object(global: &JSGlobalObject) -> JSValue {
        let utils = ExpectMatcherUtils::singleton(global);
        js::state_get_cached(utils).unwrap_or_else(|| {
            let state = JSValue::create_empty_object(global, 6);
            js::state_set_cached(utils, global, state);
            state
        })
    }

    pub(crate) fn get_state(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        Self::get_state_in(global, None)
    }

    pub(crate) fn get_state_in(global: &JSGlobalObject, test: Test) -> JsResult<JSValue> {
        let state = Self::state_object(global);
        state.put(global, b"assertionCalls", assertion_calls(test));
        state.put(global, b"currentTestName", current_test_name(global, test)?);
        state.put(global, b"expectedAssertionsNumber", expected_assertions_number(test));
        state.put(global, b"isExpectingAssertions", is_expecting_assertions(test));
        state.put(global, b"suppressedErrors", JSValue::create_empty_array(global, 0)?);
        state.put(global, b"testPath", test_path(global)?);
        Ok(state)
    }

    pub(crate) fn set_state(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        Self::set_state_in(global, frame, None)
    }

    pub(crate) fn set_state_in(global: &JSGlobalObject, frame: &CallFrame, test: Test) -> JsResult<JSValue> {
        let [partial] = frame.arguments_as_array::<1>();
        let Some(partial_object) = partial.get_object() else {
            return Err(global.throw_invalid_argument_type_value("state", "object", partial));
        };

        let state = Self::state_object(global);
        let mut assertion_calls: Option<u32> = None;
        let mut expected_assertions_number: Option<Option<u32>> = None;
        let mut is_expecting_assertions: Option<bool> = None;
        let iter = JSPropertyIterator::init(global, partial_object, JSPropertyIteratorOptions::new(false, true))?;
        while let Some((key, value)) = iter.next()? {
            if key.eq_ascii(b"assertionCalls") {
                assertion_calls = Some(to_count(global, "state.assertionCalls", value)?);
            } else if key.eq_ascii(b"expectedAssertionsNumber") {
                expected_assertions_number = Some(if value.is_undefined_or_null() {
                    None
                } else {
                    Some(to_count(global, "state.expectedAssertionsNumber", value)?)
                });
            } else if key.eq_ascii(b"isExpectingAssertions") {
                is_expecting_assertions = Some(value.to_boolean());
            } else {
                state.put_may_be_index(global, &key, value)?;
            }
        }

        if assertion_calls.is_none() && expected_assertions_number.is_none() && is_expecting_assertions.is_none() {
            return Ok(JSValue::UNDEFINED);
        }
        let applied = with_sequence(test, |sequence| {
            if let Some(count) = assertion_calls {
                sequence.expect_call_count = count;
            }
            match (expected_assertions_number, sequence.expect_assertions) {
                (Some(Some(count)), _) => sequence.expect_assertions = ExpectAssertions::Exact(count),
                (Some(None), ExpectAssertions::Exact(_)) => sequence.expect_assertions = ExpectAssertions::NotSet,
                _ => {}
            }
            match (is_expecting_assertions, sequence.expect_assertions) {
                (Some(true), ExpectAssertions::NotSet) => sequence.expect_assertions = ExpectAssertions::AtLeastOne,
                (Some(false), ExpectAssertions::AtLeastOne) => sequence.expect_assertions = ExpectAssertions::NotSet,
                _ => {}
            }
        });
        if applied.is_none() {
            return Err(global.throw(format_args!("expect.setState() cannot set the assertion counters in the describe phase, in concurrent tests, between tests, or after test execution has completed")));
        }
        Ok(JSValue::UNDEFINED)
    }
}

impl ExpectMatcherContext {
    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_assertion_calls(_this: &Self, _global: &JSGlobalObject) -> JSValue {
        assertion_calls(None)
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_current_test_name(_this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        current_test_name(global, None)
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_expected_assertions_number(_this: &Self, _global: &JSGlobalObject) -> JSValue {
        expected_assertions_number(None)
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_is_expecting_assertions(_this: &Self, _global: &JSGlobalObject) -> JSValue {
        is_expecting_assertions(None)
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_suppressed_errors(_this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        JSValue::create_empty_array(global, 0)
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_test_path(_this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        test_path(global)
    }
}
