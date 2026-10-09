use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsClass as _, JsResult};

use super::super::jest::{FileColumns as _, Jest};
use super::expect_matcher_utils_js as js;
use super::{Expect, ExpectMatcherContext, ExpectMatcherUtils, Flags};

impl Expect {
    /// The testers that hold now, or what an [`EqualityTestersScope`] put in their place.
    pub(crate) fn equality_testers(global: &JSGlobalObject) -> JsResult<Option<JSValue>> {
        let utils_value = ExpectMatcherUtils::singleton(global);
        let Some(utils) = ExpectMatcherUtils::from_js(utils_value) else { return Ok(None) };
        // SAFETY: `utils_value` is on the stack and owns the payload.
        let utils = unsafe { &*utils };

        let file = Jest::file_generation(global);
        let same_file = utils.testers_file.replace(file) == file;
        let Some(testers) = js::equality_testers_get_cached(utils_value) else { return Ok(None) };
        if same_file || !utils.testers_of_file.get().contains(&true) {
            return Ok(Some(testers));
        }

        let of_file = utils.testers_of_file.replace(Vec::new());
        let kept = JSValue::create_empty_array(global, 0)?;
        let mut count = 0;
        let mut iter = testers.array_iterator(global)?;
        for is_of_file in of_file {
            let Some(tester) = iter.next()? else { break };
            if !is_of_file {
                kept.put_index(global, count, tester)?;
                count += 1;
            }
        }
        utils.testers_of_file.set(vec![false; count as usize]);
        if count == 0 {
            js::equality_testers_set_cached(utils_value, global, JSValue::ZERO);
            return Ok(None);
        }
        js::equality_testers_set_cached(utils_value, global, kept);
        Ok(Some(kept))
    }

    /// Whether the function that made the call in `frame` is in the test file that is running.
    fn is_called_by_test_file(global: &JSGlobalObject, frame: &CallFrame) -> bool {
        let Some(runner) = Jest::runner() else { return false };
        let Some(buntest) = runner.bun_test_root.clone_active_file() else { return false };
        let path = runner.files.items_source()[buntest.get().file_id as usize].path.text;
        frame.get_caller_src_loc(global).str.eql_utf8(path)
    }

    pub(crate) fn add_equality_testers(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let [testers] = frame.arguments_as_array::<1>();
        if !testers.js_type().is_array() {
            return Err(global.throw_invalid_argument_type_value("testers", "array", testers));
        }

        let utils_value = ExpectMatcherUtils::singleton(global);
        let Some(utils) = ExpectMatcherUtils::from_js(utils_value) else { return Ok(JSValue::UNDEFINED) };
        // SAFETY: `utils_value` is on the stack and owns the payload.
        let utils = unsafe { &*utils };

        // A new array: script may hold the old one, as `customTesters`.
        let all = JSValue::create_empty_array(global, 0)?;
        let mut count = 0;
        if let Some(registered) = Self::equality_testers(global)? {
            let mut iter = registered.array_iterator(global)?;
            while let Some(tester) = iter.next()? {
                all.put_index(global, count, tester)?;
                count += 1;
            }
        }
        let registered = count;

        let is_of_file = Self::is_called_by_test_file(global, frame);
        let mut iter = testers.array_iterator(global)?;
        'testers: while let Some(tester) = iter.next()? {
            if !tester.is_callable() {
                return Err(global.throw_invalid_argument_type_value(
                    format!("testers[{}]", iter.i - 1),
                    "function",
                    tester,
                ));
            }
            // A helper that every test file calls registers its tester once.
            if !is_of_file {
                for index in 0..registered {
                    if all.get_direct_index(global, index)? == tester
                        && utils.testers_of_file.get().get(index as usize) == Some(&false)
                    {
                        continue 'testers;
                    }
                }
            }
            all.put_index(global, count, tester)?;
            count += 1;
        }
        if count == registered {
            return Ok(JSValue::UNDEFINED);
        }

        js::equality_testers_set_cached(utils_value, global, all);
        utils.testers_of_file.with_mut(|of_file| of_file.resize(count as usize, is_of_file));
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
