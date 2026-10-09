use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsClass as _, JsResult};

use super::super::jest::Jest;
use super::expect_matcher_utils_js as js;
use super::{Expect, ExpectMatcherContext, ExpectMatcherUtils, Flags};

fn append_first(global: &JSGlobalObject, target: JSValue, source: JSValue, count: u32) -> JsResult<()> {
    let mut iter = source.array_iterator(global)?;
    while iter.i < count {
        let Some(tester) = iter.next()? else { break };
        target.push(global, tester)?;
    }
    Ok(())
}

impl Expect {
    /// The testers of preload scripts and of the current test file, or what an [`EqualityTestersScope`] put in their place.
    pub(crate) fn equality_testers(global: &JSGlobalObject) -> JsResult<Option<JSValue>> {
        let utils_value = ExpectMatcherUtils::singleton(global);
        let Some(utils) = ExpectMatcherUtils::from_js(utils_value) else { return Ok(None) };
        // SAFETY: `utils_value` is on the stack and owns the payload.
        let utils = unsafe { &*utils };

        let file = Jest::file_generation(global);
        let same_file = utils.testers_file.replace(file) == file;
        let Some(testers) = js::equality_testers_get_cached(utils_value) else { return Ok(None) };
        if same_file {
            return Ok(Some(testers));
        }

        let from_preload = utils.preload_testers.get();
        if from_preload == 0 {
            js::equality_testers_set_cached(utils_value, global, JSValue::ZERO);
            return Ok(None);
        }
        let kept = JSValue::create_empty_array(global, 0)?;
        append_first(global, kept, testers, from_preload)?;
        js::equality_testers_set_cached(utils_value, global, kept);
        Ok(Some(kept))
    }

    pub(crate) fn add_equality_testers(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let [testers] = frame.arguments_as_array::<1>();
        if !testers.js_type().is_array() {
            return Err(global.throw_invalid_argument_type_value("testers", "array", testers));
        }

        let added = JSValue::create_empty_array(global, 0)?;
        let mut iter = testers.array_iterator(global)?;
        while let Some(tester) = iter.next()? {
            if !tester.is_callable() {
                return Err(global.throw_invalid_argument_type_value(
                    format!("testers[{}]", iter.i - 1),
                    "function",
                    tester,
                ));
            }
            added.push(global, tester)?;
        }
        if iter.len == 0 {
            return Ok(JSValue::UNDEFINED);
        }

        let all = match Self::equality_testers(global)? {
            Some(registered) => {
                let all = JSValue::create_empty_array(global, 0)?;
                append_first(global, all, registered, u32::MAX)?;
                append_first(global, all, added, u32::MAX)?;
                all
            }
            None => added,
        };

        let utils_value = ExpectMatcherUtils::singleton(global);
        js::equality_testers_set_cached(utils_value, global, all);
        if global.bun_vm().is_in_preload {
            if let Some(utils) = ExpectMatcherUtils::from_js(utils_value) {
                // SAFETY: `utils_value` is on the stack and owns the payload.
                unsafe { &*utils }.preload_testers.set(all.get_length(global)? as u32);
            }
        }
        Ok(JSValue::UNDEFINED)
    }

    fn run_equality_testers(global: &JSGlobalObject, a: JSValue, b: JSValue) -> JsResult<Option<bool>> {
        let Some(testers) = Self::equality_testers(global)? else { return Ok(None) };
        let context = ExpectMatcherContext { flags: Flags::default(), parent: None }.to_js(global);
        let mut iter = testers.array_iterator(global)?;
        while let Some(tester) = iter.next()? {
            if !tester.is_callable() {
                return Err(global.throw_invalid_argument_type_value(
                    format!("customTesters[{}]", iter.i - 1),
                    "function",
                    tester,
                ));
            }
            let verdict = tester.call(global, context, &[a, b, testers])?;
            if !verdict.is_undefined() {
                return Ok(Some(verdict.to_boolean()));
            }
        }
        Ok(None)
    }

    /// For C++ deep equality. 1: equal, 0: not equal or threw, -1: no tester has an opinion.
    #[unsafe(no_mangle)]
    pub(crate) extern "C" fn Expect__runEqualityTesters(global: &JSGlobalObject, a: JSValue, b: JSValue) -> i8 {
        match Self::run_equality_testers(global, a, b) {
            Ok(Some(equal)) => i8::from(equal),
            Ok(None) => -1,
            Err(_) => 0,
        }
    }
}

impl ExpectMatcherContext {
    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_custom_testers(_this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        match Expect::equality_testers(global)? {
            Some(testers) => Ok(testers),
            None => JSValue::create_empty_array(global, 0),
        }
    }
}

/// Deep equality consults `testers` (`ZERO`: none) instead of the registered ones until this is dropped.
pub(crate) struct EqualityTestersScope<'a> {
    global: &'a JSGlobalObject,
    outer: JSValue,
}

impl<'a> EqualityTestersScope<'a> {
    pub(crate) fn enter(global: &'a JSGlobalObject, testers: JSValue) -> JsResult<Self> {
        let outer = Expect::equality_testers(global)?.unwrap_or_default();
        js::equality_testers_set_cached(ExpectMatcherUtils::singleton(global), global, testers);
        Ok(Self { global, outer })
    }
}

impl Drop for EqualityTestersScope<'_> {
    fn drop(&mut self) {
        js::equality_testers_set_cached(ExpectMatcherUtils::singleton(self.global), self.global, self.outer);
    }
}
