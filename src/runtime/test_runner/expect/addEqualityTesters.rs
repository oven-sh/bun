use bun_jsc::bindgen::{JsLocal, JsScope};
use bun_jsc::{JSGlobalObject, JSValue, JsClass as _, JsResult};

use super::super::jest::{FileColumns as _, Jest};
use crate::generated_bindgen::expect::js_ExpectMatcherUtils as js;
use super::{Expect, ExpectMatcherContext, ExpectMatcherUtils, Flags};

impl Expect {
    /// The first call in a new test file drops the testers that the previous file registered itself.
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

    /// `--isolate=modules` keeps the global object. The next file's preloads and imports are evaluated again, and
    /// register their equality testers and snapshot serializers again.
    #[optimize(size)]
    pub(crate) fn reset_for_test_isolation(global: &JSGlobalObject) {
        if !global.bun_vm().test_isolation_state.shares_global {
            return;
        }
        let utils_value = ExpectMatcherUtils::singleton(global);
        let Some(utils) = utils_value.as_class_ref::<ExpectMatcherUtils>() else { return };
        js::equality_testers_set_cached(utils_value, global, JSValue::ZERO);
        js::snapshot_serializers_set_cached(utils_value, global, JSValue::ZERO);
        utils.testers_of_file.set(Vec::new());
        utils.serializers_of_file.set(Vec::new());
    }

    #[optimize(size)]
    pub(crate) fn is_called_by_test_file(global: &JSGlobalObject) -> bool {
        let Some(runner) = Jest::runner() else { return false };
        let Some(buntest) = runner.bun_test_root.clone_active_file() else { return false };
        let path = runner.files.items_source()[buntest.get().file_id as usize].path.text;
        global.get_caller_src_loc().str.eql_utf8(path)
    }

    pub(crate) fn add_equality_testers(cx: &mut JsScope<'_>, testers: JsLocal<'_>) -> JsResult<()> {
        let global = cx.global();
        let testers = testers.to_js();
        if !testers.js_type().is_array() {
            return Err(global.throw_invalid_argument_type_value("testers", "array", testers));
        }

        let utils_value = ExpectMatcherUtils::singleton(global);
        let Some(utils) = ExpectMatcherUtils::from_js(utils_value) else { return Ok(()) };
        // SAFETY: `utils_value` is on the stack and owns the payload.
        let utils = unsafe { &*utils };

        // Build a new array, because script may still hold the old one through `this.customTesters`.
        let all = JSValue::create_empty_array(global, 0)?;
        let mut count = 0;
        if let Some(registered) = Self::registered_testers(global)? {
            let mut iter = registered.array_iterator(global)?;
            while let Some(tester) = iter.next()? {
                all.put_index(global, count, tester)?;
                count += 1;
            }
        }
        let registered = count;

        let is_of_file = Self::is_called_by_test_file(global);
        let mut iter = testers.array_iterator(global)?;
        'testers: while let Some(tester) = iter.next()? {
            if !tester.is_callable() {
                return Err(global.throw_invalid_argument_type_value(
                    format!("testers[{}]", iter.i - 1),
                    "function",
                    tester,
                ));
            }
            // A shared helper that every test file calls shouldn't register the same tester again.
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
            return Ok(());
        }

        // While `this.equals()` runs, `EqualityTestersScope` keeps the registered testers apart from its list.
        if js::registered_testers_get_cached(utils_value).is_some() {
            js::registered_testers_set_cached(utils_value, global, all);
        } else {
            js::equality_testers_set_cached(utils_value, global, all);
        }
        utils.testers_of_file.with_mut(|of_file| of_file.resize(count as usize, is_of_file));
        Ok(())
    }

    /// What expect.addEqualityTesters() registered. `equality_testers()` is the list of a `this.equals()` call while one runs.
    pub(crate) fn registered_testers(global: &JSGlobalObject) -> JsResult<Option<JSValue>> {
        match js::registered_testers_get_cached(ExpectMatcherUtils::singleton(global)) {
            Some(kept) => Ok(kept.is_array().then_some(kept)),
            None => Self::equality_testers(global),
        }
    }

    fn run_equality_testers(global: &JSGlobalObject, a: JSValue, b: JSValue, is_strict: bool) -> JsResult<Option<bool>> {
        let Some(testers) = Self::equality_testers(global)? else { return Ok(None) };
        let utils_value = ExpectMatcherUtils::singleton(global);
        let Some(utils) = utils_value.as_class_ref::<ExpectMatcherUtils>() else { return Ok(None) };
        let outer = utils.is_comparing_strictly.replace(is_strict);
        let verdict = Self::ask_equality_testers(global, utils_value, testers, a, b);
        utils.is_comparing_strictly.set(outer);
        verdict
    }

    fn ask_equality_testers(
        global: &JSGlobalObject,
        utils: JSValue,
        testers: JSValue,
        a: JSValue,
        b: JSValue,
    ) -> JsResult<Option<bool>> {
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
            // The testers of `this.utils` tell by it that deep equality calls them, and no matcher or tester of the user.
            js::asked_tester_set_cached(utils, global, tester);
            let verdict = tester.call(global, context, &[a, b, testers]);
            js::asked_tester_set_cached(utils, global, JSValue::ZERO);
            let verdict = verdict?;
            if !verdict.is_undefined() {
                return Ok(Some(verdict.to_boolean()));
            }
        }
        Ok(None)
    }

    /// Called by C++ deep equality. Returns 1 for equal, 0 for not equal or threw, -1 if no tester decided.
    #[unsafe(no_mangle)]
    pub(crate) extern "C" fn Expect__runEqualityTesters(global: &JSGlobalObject, a: JSValue, b: JSValue, is_strict: bool) -> i8 {
        match Self::run_equality_testers(global, a, b, is_strict) {
            Ok(Some(equal)) => i8::from(equal),
            Ok(None) => -1,
            Err(_) => 0,
        }
    }
}

impl ExpectMatcherContext {
    pub(crate) fn get_custom_testers(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        let global = cx.global();
        match Expect::registered_testers(global)? {
            Some(testers) => Ok(testers),
            None => JSValue::create_empty_array(global, 0),
        }
    }
}

/// Until dropped, deep equality uses `testers` (`ZERO` for none) instead of the registered ones, which stay at hand: like in Jest, they are what an asymmetric matcher and `this.customTesters` get.
pub(crate) struct EqualityTestersScope<'a> {
    global: &'a JSGlobalObject,
    outer: JSValue,
    keeps_registered: bool,
}

impl<'a> EqualityTestersScope<'a> {
    /// `None` if deep equality uses no tester as it is, and gets none.
    pub(crate) fn enter(global: &'a JSGlobalObject, testers: JSValue) -> JsResult<Option<Self>> {
        let outer = Expect::equality_testers(global)?.unwrap_or_default();
        if outer.is_empty() && testers.is_empty() {
            return Ok(None);
        }
        let utils = ExpectMatcherUtils::singleton(global);
        // A call inside another one finds them kept. `null` is for none, as an empty field is for no call.
        let keeps_registered = js::registered_testers_get_cached(utils).is_none();
        if keeps_registered {
            let registered = if outer.is_empty() { JSValue::NULL } else { outer };
            js::registered_testers_set_cached(utils, global, registered);
        }
        js::equality_testers_set_cached(utils, global, testers);
        Ok(Some(Self { global, outer, keeps_registered }))
    }
}

impl Drop for EqualityTestersScope<'_> {
    fn drop(&mut self) {
        let utils = ExpectMatcherUtils::singleton(self.global);
        if self.keeps_registered {
            // expect.addEqualityTesters() may have run in between, so what is kept now is what to go back to.
            let registered = js::registered_testers_get_cached(utils).filter(|kept| kept.is_array());
            self.outer = registered.unwrap_or_default();
            js::registered_testers_set_cached(utils, self.global, JSValue::ZERO);
        }
        js::equality_testers_set_cached(utils, self.global, self.outer);
    }
}
