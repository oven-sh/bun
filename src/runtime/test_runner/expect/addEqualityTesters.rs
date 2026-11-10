use bun_jsc::bindgen::{JsLocal, JsScope};
use bun_jsc::{compiled_program, JSGlobalObject, JSValue, JsClass as _, JsResult};

use super::super::bun_test::{self, AddedInPhase, BunTestPtr, ExecutionEntry};
use super::super::module_mock;
use crate::generated_bindgen::expect::js_ExpectMatcherUtils as js;
use super::{Expect, ExpectMatcherContext, ExpectMatcherUtils, Flags};

/// Who an equality tester or a snapshot serializer belongs to.
pub(crate) enum Registrant {
    /// The running test file. What it registers is gone when it ends.
    TestFile(BunTestPtr),
    /// A preload, a hook of a preload, or the body of a module that a test file imports. Each of them runs once, so
    /// what it registers stays for every later file.
    Shared,
}

impl Expect {
    pub(crate) fn equality_testers(global: &JSGlobalObject) -> Option<JSValue> {
        js::equality_testers_get_cached(ExpectMatcherUtils::singleton(global))
    }

    /// `--isolate=modules` keeps the global object. The next file's preloads and imports are evaluated again, and
    /// register their equality testers and snapshot serializers again.
    #[optimize(size)]
    pub(crate) fn reset_for_test_isolation(global: &JSGlobalObject) {
        if !global.bun_vm().test_isolation_state.shares_global {
            return;
        }
        let utils = ExpectMatcherUtils::singleton(global);
        js::equality_testers_set_cached(utils, global, JSValue::ZERO);
        js::shared_equality_testers_set_cached(utils, global, JSValue::ZERO);
        js::snapshot_serializers_set_cached(utils, global, JSValue::ZERO);
        js::shared_snapshot_serializers_set_cached(utils, global, JSValue::ZERO);
    }

    /// The test file ends, and with it what it registered itself.
    #[optimize(size)]
    pub(crate) fn forget_registrations_of_test_file(global: &JSGlobalObject) {
        let utils = ExpectMatcherUtils::singleton(global);
        let shared = js::shared_equality_testers_get_cached(utils).unwrap_or_default();
        js::equality_testers_set_cached(utils, global, shared);
        let shared = js::shared_snapshot_serializers_get_cached(utils).unwrap_or_default();
        js::snapshot_serializers_set_cached(utils, global, shared);
    }

    /// What runs decides, not the call stack: a tail call drops the frame of its caller, and a bound function or the
    /// callback of a builtin runs without a frame of the file that passed it.
    #[optimize(size)]
    pub(crate) fn registrant(global: &JSGlobalObject) -> Registrant {
        let vm = global.bun_vm();
        // The runner and its files belong to the main thread.
        if vm.worker_ref().is_some() || module_mock::is_in_preload(global) {
            return Registrant::Shared;
        }
        let Some(file) = bun_test::clone_active_strong() else { return Registrant::Shared };
        let buntest = file.get();
        // `is_in_preload` can't name the hook that runs in a concurrent group.
        if let Some(on_stack) = buntest.execution.on_stack.get() {
            // SAFETY: `on_stack` names an entry only while its callback runs, and the file keeps its entries.
            let entry = unsafe { &*on_stack.entry.cast::<ExecutionEntry>() };
            if entry.added_in_phase == AddedInPhase::Preload {
                return Registrant::Shared;
            }
        }
        if Self::runs_import_of_test_file(global, buntest.is_loading) {
            return Registrant::Shared;
        }
        Registrant::TestFile(file)
    }

    /// Whether the body of a module that the test file imports runs. Until the file's own body starts, that is also
    /// what such a body waits for: a promise, a timer.
    fn runs_import_of_test_file(global: &JSGlobalObject, is_loading: bool) -> bool {
        let vm = global.bun_vm();
        if vm.test_file_modules.imported_bodies != 0 {
            return true;
        }
        if !is_loading {
            return false;
        }
        match vm.main() {
            // No evaluate hook sees the body of a compiled module start, so the engine is asked.
            Some(main) if compiled_program::is_compiled_module(main) => {
                compiled_program::runs_body_of_module_other_than(global, main)
            }
            _ => !vm.test_file_modules.own_body_started,
        }
    }

    pub(crate) fn add_equality_testers(cx: &mut JsScope<'_>, testers: JsLocal<'_>) -> JsResult<()> {
        let global = cx.global();
        let testers = testers.to_js();
        if !testers.js_type().is_array() {
            return Err(global.throw_invalid_argument_type_value("testers", "array", testers));
        }

        let utils = ExpectMatcherUtils::singleton(global);
        let registered = js::equality_testers_get_cached(utils);
        let shared = js::shared_equality_testers_get_cached(utils);

        // Build a new array, because script may still hold the old one through `this.customTesters`.
        let all = JSValue::create_empty_array(global, 0)?;
        let mut count = 0;
        if let Some(registered) = registered {
            let mut iter = registered.array_iterator(global)?;
            while let Some(tester) = iter.next()? {
                all.put_index(global, count, tester)?;
                count += 1;
            }
        }
        let registered_count = count;

        let mut iter = testers.array_iterator(global)?;
        'testers: while let Some(tester) = iter.next()? {
            if !tester.is_callable() {
                return Err(global.throw_invalid_argument_type_value(
                    format!("testers[{}]", iter.i - 1),
                    "function",
                    tester,
                ));
            }
            // Every file has a shared tester already, so a helper that every test file calls doesn't add it again.
            if let Some(shared) = shared {
                let mut iter = shared.array_iterator(global)?;
                while let Some(earlier) = iter.next()? {
                    if earlier == tester {
                        continue 'testers;
                    }
                }
            }
            all.put_index(global, count, tester)?;
            count += 1;
        }
        if count == registered_count {
            return Ok(());
        }

        match Self::registrant(global) {
            Registrant::Shared => {
                // Without testers of the test file, the two lists are one array.
                let all_shared = if registered == shared {
                    all
                } else {
                    let all_shared = JSValue::create_empty_array(global, 0)?;
                    let mut shared_count = 0;
                    if let Some(shared) = shared {
                        let mut iter = shared.array_iterator(global)?;
                        while let Some(tester) = iter.next()? {
                            all_shared.put_index(global, shared_count, tester)?;
                            shared_count += 1;
                        }
                    }
                    for index in registered_count..count {
                        all_shared.put_index(global, shared_count, all.get_direct_index(global, index)?)?;
                        shared_count += 1;
                    }
                    all_shared
                };
                js::shared_equality_testers_set_cached(utils, global, all_shared);
            }
            Registrant::TestFile(file) => file.get().has_expect_registrations = true,
        }
        js::equality_testers_set_cached(utils, global, all);
        Ok(())
    }

    fn run_equality_testers(global: &JSGlobalObject, a: JSValue, b: JSValue) -> JsResult<Option<bool>> {
        let Some(testers) = Self::equality_testers(global) else { return Ok(None) };
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

    /// Called by C++ deep equality. Returns 1 for equal, 0 for not equal or threw, -1 if no tester decided.
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
    pub(crate) fn get_custom_testers(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        let global = cx.global();
        match Expect::equality_testers(global) {
            Some(testers) => Ok(testers),
            None => JSValue::create_empty_array(global, 0),
        }
    }
}

/// Until dropped, deep equality uses `testers` (`ZERO` for none) instead of the registered ones.
pub(crate) struct EqualityTestersScope<'a> {
    global: &'a JSGlobalObject,
    outer: JSValue,
}

impl<'a> EqualityTestersScope<'a> {
    pub(crate) fn enter(global: &'a JSGlobalObject, testers: JSValue) -> Self {
        let outer = Expect::equality_testers(global).unwrap_or_default();
        js::equality_testers_set_cached(ExpectMatcherUtils::singleton(global), global, testers);
        Self { global, outer }
    }
}

impl Drop for EqualityTestersScope<'_> {
    fn drop(&mut self) {
        js::equality_testers_set_cached(ExpectMatcherUtils::singleton(self.global), self.global, self.outer);
    }
}
