//! Vitest's test context. A test shares one with its hooks, and keeps it across retries and repeats.

use core::ptr::NonNull;
use std::rc::Rc;

use bun_collections::smallvec::SmallVec;
use bun_core::String as BunString;
use bun_jsc::bindgen::{JsLocal, JsScope, JsWrapper};
use bun_jsc::{
    self as jsc, AbortSignal, CommonAbortReason, JSFunction, JSGlobalObject, JSHostFn,
    JSPromise, JSValue, JsCell, JsClass as _, JsResult, Strong, StringJsc as _, bun_string_jsc,
};
use bun_paths::resolve_path;
use bun_resolver::fs::FileSystem;

use super::bun_test::js_fns::Signature;
use super::bun_test::{
    Around, AroundPhase, BaseScope, BunTest, BunTestPtr, BunTestPtrWeak, DescribeScope, EntryData,
    ExecutionEntry, Only, Phase, RefDataValue, ScopeMode,
};
use super::execution::{ExecutionSequence, Result as ExecutionResult};
use super::expect::Expect;
use super::expect::expect_deferred::ExpectDeferred;
use super::jest::FileColumns as _;
use super::scope_functions::{CallbackMode, FunctionKind, ParseArgumentsCfg, parse_arguments};
use super::test_context_parameter::{ContextParameter, TEXT_LEFT_OUT};
use crate::generated_bindgen::scope_functions::{CallbackOrOptions, DescriptionOrCallback};
use crate::generated_bindgen::test_context as generated;

/// Runs after an attempt's hooks, in variant order. Within a kind, the last registered runs first.
#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum Deferred {
    /// A function `beforeEach` returned.
    Teardown,
    Fixture,
    OnTestFinished,
    OnTestFailed,
    /// The rest of an `aroundEach` hook. Everything above runs before `runTest()` resolves.
    Around,
    /// A fixture set up for an `aroundEach` hook.
    AroundFixture,
}

pub(crate) struct TestContext {
    buntest: BunTestPtrWeak,
    group_index: usize,
    sequence_index: usize,
    /// `BunTest::extra_execution_entries` owns the entries.
    deferred: JsCell<Vec<(Deferred, NonNull<ExecutionEntry>)>>,
    fixtures: JsCell<Vec<usize>>,
}

pub(crate) use crate::generated_bindgen::test_context::js_TestContext as js;

pub(crate) fn bound(
    global: &JSGlobalObject,
    this_value: JSValue,
    name: &'static str,
    length: u32,
    function: JSHostFn,
) -> JsResult<JSValue> {
    JSFunction::create(global, name, function, length, Default::default()).bind(
        global,
        this_value,
        &BunString::static_(name),
        f64::from(length),
        &[],
    )
}

fn ascii(global: &JSGlobalObject, text: &'static str) -> JsResult<JSValue> {
    BunString::static_(text).to_js(global)
}

impl TestContext {
    /// Vitest passes the context where Jest passes `done`, so a Jest-style `done()` call lands here.
    pub(crate) fn call_instance(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        Err(cx.global().throw(format_args!("done() callback is deprecated, use promise instead")))
    }

    pub(crate) fn create(
        global: &JSGlobalObject,
        buntest: &BunTestPtr,
        group_index: usize,
        sequence_index: usize,
    ) -> JSValue {
        TestContext {
            buntest: Rc::downgrade(buntest),
            group_index,
            sequence_index,
            deferred: JsCell::new(Vec::new()),
            fixtures: JsCell::new(Vec::new()),
        }
        .to_js(global)
    }

    pub(crate) fn has_fixture(&self, definition: usize) -> bool {
        self.fixtures.get().contains(&definition)
    }

    pub(crate) fn add_fixture(&self, definition: usize) {
        self.fixtures.with_mut(|fixtures| fixtures.push(definition));
    }

    pub(crate) fn remove_fixture(&self, definition: usize) {
        self.fixtures.with_mut(|fixtures| fixtures.retain(|&fixture| fixture != definition));
    }

    fn of_call<'a>(global: &JSGlobalObject, this_value: JsLocal<'a>) -> JsResult<&'a TestContext> {
        match TestContext::from_js(this_value.to_js()) {
            // SAFETY: the wrapper owns the payload, and the frame keeps the wrapper alive.
            Some(this) => Ok(unsafe { &*this }),
            None => Err(global.throw_type_error(format_args!("Expected this to be a test context"))),
        }
    }

    fn sequence(&self) -> Option<(BunTestPtr, NonNull<ExecutionSequence>)> {
        let buntest = self.buntest.upgrade()?;
        let execution = &mut buntest.get().execution;
        let start = execution.groups.get(self.group_index)?.sequence_start;
        let sequence = NonNull::from(execution.sequences.get_mut(start + self.sequence_index)?);
        Some((buntest, sequence))
    }

    fn running(&self, this_value: JSValue) -> Option<(BunTestPtr, NonNull<ExecutionSequence>)> {
        let (buntest, sequence) = self.sequence()?;
        // SAFETY: points into `buntest.execution.sequences`, which `buntest` keeps alive.
        let context = unsafe { sequence.as_ref() }.context.as_ref()?.get();
        (buntest.phase == Phase::Execution && context == this_value).then_some((buntest, sequence))
    }

    fn throw_finished(global: &JSGlobalObject, name: &str) -> jsc::JsError {
        global.throw(format_args!("Cannot call {name}() after its test has finished"))
    }

    /// Lets `expect()` attribute a call to this test even when other tests run concurrently.
    fn state_data(&self, this_value: JSValue) -> Option<RefDataValue> {
        let (_buntest, sequence) = self.running(this_value)?;
        // SAFETY: as in `running`.
        let sequence = unsafe { sequence.as_ref() };
        Some(RefDataValue::Execution {
            group_index: self.group_index,
            entry_data: Some(EntryData {
                sequence_index: self.sequence_index,
                entry: sequence.active_entry.map_or(core::ptr::null(), |entry| entry.as_ptr().cast_const().cast()),
                attempt: sequence.attempt,
            }),
        })
    }

    pub(crate) fn defer(&self, buntest: &mut BunTest, when: Deferred, callback: JSValue, timeout: u32) {
        let gets_context = matches!(when, Deferred::OnTestFinished | Deferred::OnTestFailed);
        let entry = buntest.create_vitest_entry(callback, timeout, gets_context);
        if when == Deferred::Around {
            // SAFETY: just allocated.
            unsafe { (*entry.as_ptr()).around = Some((Around::Each, AroundPhase::TearDown)) };
        }
        self.deferred.with_mut(|deferred| deferred.push((when, entry)));
    }

    /// Returns false if the test has finished.
    pub(crate) fn defer_fixture(&self, this_value: JSValue, tear_down: JSValue, timeout: u32) -> bool {
        let Some((buntest, sequence)) = self.running(this_value) else {
            return false;
        };
        // SAFETY: as in `running`.
        let when = if unsafe { sequence.as_ref() }.is_before_run_test() { Deferred::AroundFixture } else { Deferred::Fixture };
        self.defer(buntest.get(), when, tear_down, timeout);
        true
    }

    pub(crate) fn take_deferred(&self, attempt_failed: bool) -> Option<NonNull<ExecutionEntry>> {
        self.deferred.with_mut(|deferred| {
            loop {
                let next = (0..deferred.len()).rev().min_by_key(|&index| deferred[index].0)?;
                let (when, entry) = deferred.remove(next);
                if when != Deferred::OnTestFailed || attempt_failed {
                    return Some(entry);
                }
                // SAFETY: owned by `BunTest::extra_execution_entries`, which outlives the sequence.
                unsafe { (*entry.as_ptr()).callback = None };
            }
        })
    }

    fn result(this_value: JSValue, global: &JSGlobalObject) -> JSValue {
        js::result_get_cached(this_value).unwrap_or_else(|| {
            let result = JSValue::create_empty_object(global, 4);
            js::result_set_cached(this_value, global, result);
            result
        })
    }

    #[optimize(size)]
    pub(crate) fn sync_result(
        this_value: JSValue,
        global: &JSGlobalObject,
        sequence: &ExecutionSequence,
    ) -> JsResult<()> {
        let (Some(result), Some(test)) = (js::result_get_cached(this_value), sequence.test_entry) else {
            return Ok(());
        };
        // SAFETY: owned by the describe tree, which outlives the sequence.
        let test = unsafe { test.as_ref() };
        result.put(global, b"state", ascii(global, sequence.state())?);
        result.put(global, b"retryCount", JSValue::from(test.retry_count - sequence.remaining_retry_count));
        result.put(global, b"repeatCount", JSValue::from(test.repeat_count - sequence.remaining_repeat_count));
        Ok(())
    }

    pub(crate) fn record_error(
        this_value: JSValue,
        global: &JSGlobalObject,
        thrown: JSValue,
    ) -> JsResult<()> {
        let errors = match js::errors_get_cached(this_value) {
            Some(errors) => errors,
            None => {
                let errors = JSValue::create_empty_array(global, 0)?;
                js::errors_set_cached(this_value, global, errors);
                Self::result(this_value, global).put(global, b"errors", errors);
                errors
            }
        };
        let thrown = match thrown.to_error() {
            Some(thrown) => thrown,
            None if thrown.is_exception(global.vm_ptr()) => return Ok(()),
            None => thrown,
        };
        if thrown.is_object() || thrown.is_symbol() {
            return errors.push(global, thrown);
        }
        let error = JSValue::create_empty_object(global, 1);
        error.put(global, b"message", thrown.to_bun_string(global)?.into_js(global)?);
        errors.push(global, error)
    }

    pub(crate) fn abort_signal(this_value: JSValue, global: &JSGlobalObject) {
        if let Some(signal) = js::signal_get_cached(this_value).and_then(AbortSignal::from_js) {
            // SAFETY: the wrapper in the cached slot keeps the signal alive.
            unsafe { &*signal }.signal(global, CommonAbortReason::Timeout);
        }
    }

    pub(crate) fn get_task(&self, this_value: JsWrapper<'_, Self>, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        let (this_value, global) = (this_value.to_js(), cx.global());
        let Some((buntest, sequence)) = self.sequence() else {
            return Ok(JSValue::UNDEFINED);
        };
        // SAFETY: as in `running`.
        let sequence = unsafe { sequence.as_ref() };
        let Some(test) = sequence.test_entry else {
            return Ok(JSValue::UNDEFINED);
        };
        // SAFETY: owned by the describe tree, which `buntest` keeps alive.
        let test = unsafe { test.as_ref() };
        let buntest = buntest.get();
        let root: *mut DescribeScope = &raw mut *buntest.collection.root_scope;
        let id = format!("{}_{}_{}", buntest.file_id, self.group_index, self.sequence_index);
        let (file, suite) = tasks(global, buntest, test.base.parent.filter(|&parent| parent != root))?;
        let name = bun_string_jsc::create_utf8_for_js(global, test.base.name.as_deref().unwrap_or(b""))?;
        let full_test_name = join(global, suite.and_then(SuiteTask::full_test_name), test.base.name.as_deref(), name)?;

        let task = JSValue::create_empty_object(global, 16);
        task.put(global, b"id", bun_string_jsc::create_utf8_for_js(global, id.as_bytes())?);
        task.put(global, b"type", ascii(global, "test")?);
        task.put(global, b"name", name);
        file.put_full_names(global, task, full_test_name)?;
        task.put(global, b"mode", ascii(global, mode(&test.base))?);
        task.put(global, b"file", file.task.get());
        if let Some(suite) = suite {
            task.put(global, b"suite", suite.task.get());
        }
        if test.base.mode == ScopeMode::Fails {
            task.put(global, b"fails", JSValue::TRUE);
        }
        if test.base.concurrent {
            task.put(global, b"concurrent", JSValue::TRUE);
        }
        task.put(global, b"timeout", JSValue::from(test.timeout));
        task.put(global, b"retry", JSValue::from(test.retry_count));
        task.put(global, b"repeats", JSValue::from(test.repeat_count));
        task.put(global, b"meta", JSValue::create_empty_object_with_null_prototype(global));
        task.put(global, b"annotations", Self::annotations(this_value, global)?);
        task.put(global, b"result", Self::result(this_value, global));
        task.put_non_enumerable(global, b"context", this_value);
        Self::sync_result(this_value, global, sequence)?;
        Ok(task)
    }

    fn annotations(this_value: JSValue, global: &JSGlobalObject) -> JsResult<JSValue> {
        if let Some(annotations) = js::annotations_get_cached(this_value) {
            return Ok(annotations);
        }
        let annotations = JSValue::create_empty_array(global, 0)?;
        js::annotations_set_cached(this_value, global, annotations);
        Ok(annotations)
    }

    pub(crate) fn get_signal(&self, this_value: JsWrapper<'_, Self>, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        let (this_value, global) = (this_value.to_js(), cx.global());
        let signal = AbortSignal::create(global);
        if let Some((_buntest, sequence)) = self.running(this_value)
            // SAFETY: as in `running`.
            && unsafe { sequence.as_ref() }.result.is_timeout()
        {
            js::signal_set_cached(this_value, global, signal);
            Self::abort_signal(this_value, global);
        }
        Ok(signal)
    }

    pub(crate) fn get_expect(&self, this_value: JsWrapper<'_, Self>, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        let (this_value, global) = (this_value.to_js(), cx.global());
        let expect = bound(global, this_value, "expect", 1, generated::Bun__TestContext__expect)?;
        let constructor = super::expect::js::get_constructor(global);
        jsc::cpp::Bun__JSValue__setPrototypeDirect(expect, constructor, global)?;
        expect.put(global, b"assertions", bound(global, this_value, "assertions", 1, generated::Bun__TestContext__assertions)?);
        expect.put(global, b"hasAssertions", bound(global, this_value, "hasAssertions", 0, generated::Bun__TestContext__hasAssertions)?);
        expect.put(global, b"getState", bound(global, this_value, "getState", 0, generated::Bun__TestContext__getState)?);
        expect.put(global, b"setState", bound(global, this_value, "setState", 1, generated::Bun__TestContext__setState)?);
        expect.put(global, b"soft", bound(global, this_value, "soft", 1, generated::Bun__TestContext__soft)?);
        expect.put(global, b"poll", bound(global, this_value, "poll", 1, generated::Bun__TestContext__poll)?);
        Ok(expect)
    }

    pub(crate) fn get_skip(&self, this_value: JsWrapper<'_, Self>, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        bound(cx.global(), this_value.to_js(), "skip", 2, generated::Bun__TestContext__skip)
    }

    pub(crate) fn get_on_test_finished(&self, this_value: JsWrapper<'_, Self>, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        Self::defer_hook_function(cx.global(), this_value.to_js(), "onTestFinished", false)
    }

    pub(crate) fn get_on_test_failed(&self, this_value: JsWrapper<'_, Self>, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        Self::defer_hook_function(cx.global(), this_value.to_js(), "onTestFailed", true)
    }

    pub(crate) fn get_annotate(&self, this_value: JsWrapper<'_, Self>, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        bound(cx.global(), this_value.to_js(), "annotate", 3, generated::Bun__TestContext__annotate)
    }

    fn defer_hook_function(
        global: &JSGlobalObject,
        this_value: JSValue,
        name: &'static str,
        only_if_failed: bool,
    ) -> JsResult<JSValue> {
        JSFunction::create(global, name, generated::Bun__TestContext__deferHook, 2, Default::default()).bind(
            global,
            this_value,
            &BunString::static_(name),
            2.0,
            &[JSValue::from(only_if_failed)],
        )
    }

    #[optimize(size)]
    fn defer_call<'a>(
        global: &JSGlobalObject,
        this_value: JsLocal<'a>,
        (first, second, third): (DescriptionOrCallback<'a>, CallbackOrOptions<'a>, CallbackOrOptions<'a>),
        when: Deferred,
        name: &'static str,
        signature: &'static [u8],
    ) -> JsResult<()> {
        let args = parse_arguments(
            global,
            (first, JsLocal::UNDEFINED),
            second,
            third,
            Signature::Str(signature),
            ParseArgumentsCfg {
                callback: CallbackMode::Require,
                kind: FunctionKind::VitestHook,
                inherited: Default::default(),
            },
        )?;
        let this = Self::of_call(global, this_value)?;
        let Some((buntest, _sequence)) = this.running(this_value.to_js()) else {
            return Err(Self::throw_finished(global, name));
        };
        if let Some(callback) = args.callback {
            this.defer(buntest.get(), when, callback, args.options.timeout);
        }
        Ok(())
    }
}

#[optimize(size)]
pub(crate) fn expect(cx: &mut JsScope<'_>, this_value: JsLocal<'_>, received: JsLocal<'_>, message: JsLocal<'_>) -> JsResult<JSValue> {
    let global = cx.global();
    let state = TestContext::of_call(global, this_value)?.state_data(this_value.to_js());
    Expect::call_in(global, received.to_js(), message.to_js(), state)
}

#[optimize(size)]
pub(crate) fn soft(cx: &mut JsScope<'_>, this_value: JsLocal<'_>, received: JsLocal<'_>, message: JsLocal<'_>) -> JsResult<JSValue> {
    let global = cx.global();
    let state = TestContext::of_call(global, this_value)?.state_data(this_value.to_js());
    Expect::soft_in(global, received.to_js(), message.to_js(), state)
}

#[optimize(size)]
pub(crate) fn poll(cx: &mut JsScope<'_>, this_value: JsLocal<'_>, callback: JsLocal<'_>, options: JsLocal<'_>) -> JsResult<JSValue> {
    let global = cx.global();
    let state = TestContext::of_call(global, this_value)?.state_data(this_value.to_js());
    Expect::poll_in(global, callback.to_js(), options.to_js(), state)
}

#[optimize(size)]
pub(crate) fn assertions(cx: &mut JsScope<'_>, this_value: JsLocal<'_>, count: JsLocal<'_>) -> JsResult<()> {
    let global = cx.global();
    let state = TestContext::of_call(global, this_value)?.state_data(this_value.to_js());
    Expect::assertions_in(global, count.to_js(), state)
}

#[optimize(size)]
pub(crate) fn has_assertions(cx: &mut JsScope<'_>, this_value: JsLocal<'_>) -> JsResult<()> {
    let global = cx.global();
    let state = TestContext::of_call(global, this_value)?.state_data(this_value.to_js());
    Expect::has_assertions_in(global, state)
}

#[optimize(size)]
pub(crate) fn get_state(cx: &mut JsScope<'_>, this_value: JsLocal<'_>) -> JsResult<JSValue> {
    let global = cx.global();
    let state = TestContext::of_call(global, this_value)?.state_data(this_value.to_js());
    Expect::get_state_in(global, state)
}

#[optimize(size)]
pub(crate) fn set_state(cx: &mut JsScope<'_>, this_value: JsLocal<'_>, state_to_merge: JsLocal<'_>) -> JsResult<()> {
    let global = cx.global();
    let state = TestContext::of_call(global, this_value)?.state_data(this_value.to_js());
    Expect::set_state_in(global, state_to_merge.to_js(), state)
}

/// `skip(note?)` or `skip(condition, note?)`. As in Vitest, only a literal `false` condition doesn't skip.
#[optimize(size)]
pub(crate) fn skip(
    cx: &mut JsScope<'_>,
    this_value: JsLocal<'_>,
    condition: JsLocal<'_>,
    note: JsLocal<'_>,
) -> JsResult<()> {
    let (global, condition, note) = (cx.global(), condition.to_js(), note.to_js());
    if condition == JSValue::FALSE {
        return Ok(());
    }
    let this = TestContext::of_call(global, this_value)?;
    let this_value = this_value.to_js();
    let Some((_buntest, sequence)) = this.running(this_value) else {
        return Err(TestContext::throw_finished(global, "skip"));
    };
    // SAFETY: as in `running`; nothing else borrows the sequence while a callback of it is on the stack.
    let sequence = unsafe { &mut *sequence.as_ptr() };
    sequence.result = ExecutionResult::Skip;
    let result = TestContext::result(this_value, global);
    result.put(global, b"pending", JSValue::TRUE);
    let note = if condition.is_string() { condition } else { note };
    if !note.is_undefined() {
        result.put(global, b"note", note);
    }
    TestContext::sync_result(this_value, global, sequence)?;
    Err(global.throw(format_args!("test is skipped; abort execution")))
}

pub(crate) fn defer_hook<'a>(
    cx: &mut JsScope<'a>,
    this_value: JsLocal<'a>,
    only_if_failed: bool,
    first: DescriptionOrCallback<'a>,
    second: CallbackOrOptions<'a>,
    third: CallbackOrOptions<'a>,
) -> JsResult<()> {
    let arguments = (first, second, third);
    if only_if_failed {
        TestContext::defer_call(cx.global(), this_value, arguments, Deferred::OnTestFailed, "onTestFailed", b"onTestFailed()")
    } else {
        TestContext::defer_call(cx.global(), this_value, arguments, Deferred::OnTestFinished, "onTestFinished", b"onTestFinished()")
    }
}

#[optimize(size)]
pub(crate) fn annotate(
    cx: &mut JsScope<'_>,
    this_value: JsLocal<'_>,
    message: JsLocal<'_>,
    kind: JsLocal<'_>,
    attachment: JsLocal<'_>,
) -> JsResult<JSValue> {
    let global = cx.global();
    let (message, kind, attachment) = (message.to_js(), kind.to_js(), attachment.to_js());
    let this = TestContext::of_call(global, this_value)?;
    let this_value = this_value.to_js();
    if this.running(this_value).is_none() {
        return Err(TestContext::throw_finished(global, "annotate"));
    }
    let (kind, attachment) = if kind.is_object() { (JSValue::UNDEFINED, kind) } else { (kind, attachment) };
    let annotation = JSValue::create_empty_object(global, 3);
    annotation.put(global, b"message", message);
    annotation.put(global, b"type", if kind.is_undefined() { ascii(global, "notice")? } else { kind });
    if !attachment.is_undefined() {
        annotation.put(global, b"attachment", attachment);
    }
    TestContext::annotations(this_value, global)?.push(global, annotation)?;
    Ok(JSPromise::resolved_promise_value(global, annotation))
}

/// `TestRunner.getCurrentTest()`: the running test's `task`. In a concurrent group, only while the test's callback is on the stack.
#[optimize(size)]
pub(crate) fn get_current_test(cx: &mut JsScope<'_>) -> JsResult<JSValue> {
    let global = cx.global();
    let Some(strong) = super::bun_test::clone_active_strong() else {
        return Ok(JSValue::UNDEFINED);
    };
    let buntest = strong.get();
    let running = match buntest.get_current_state_data() {
        RefDataValue::Execution { group_index, entry_data: None } => {
            RefDataValue::Execution { group_index, entry_data: buntest.execution.on_stack.get() }
        }
        running => running,
    };
    let (RefDataValue::Execution { group_index, entry_data: Some(entry_data) }, Some((sequence, _))) =
        (running, buntest.execution.get_current_and_valid_execution_sequence(&running))
    else {
        return Ok(JSValue::UNDEFINED);
    };
    if sequence.test_entry.is_none() {
        return Ok(JSValue::UNDEFINED);
    }
    let context = sequence.context(global, &strong, group_index, entry_data.sequence_index);
    Ok(context.get(global, "task")?.unwrap_or(JSValue::UNDEFINED))
}

/// Of Vitest's `TestRunner`, only what test code calls.
pub(crate) fn create_test_runner(global: &JSGlobalObject) -> JSValue {
    let runner = JSValue::create_empty_object(global, 1);
    runner.put(
        global,
        b"getCurrentTest",
        JSFunction::create(global, "getCurrentTest", generated::Bun__TestContext__getCurrentTest, 0, Default::default()),
    );
    runner
}

fn mode(base: &BaseScope) -> &'static str {
    match base.mode {
        ScopeMode::Skip | ScopeMode::FilteredOut => "skip",
        ScopeMode::Todo => "todo",
        ScopeMode::Normal | ScopeMode::Failing | ScopeMode::Fails if base.only == Only::Yes => "only",
        ScopeMode::Normal | ScopeMode::Failing | ScopeMode::Fails => "run",
    }
}

fn file_path(buntest: &BunTest) -> &'static [u8] {
    let Some(reporter) = buntest.reporter else {
        return b"";
    };
    // SAFETY: the reporter outlives every BunTest.
    unsafe { reporter.as_ref() }.jest.files.items_source()[buntest.file_id as usize].path.text
}

fn file_name(buntest: &BunTest) -> Vec<u8> {
    let mut name = resolve_path::relative(FileSystem::instance().top_level_dir(), file_path(buntest)).to_vec();
    resolve_path::platform_to_posix_in_place::<u8>(&mut name);
    name
}

/// A rope: it refers to both strings and copies neither.
fn concat(global: &JSGlobalObject, left: JSValue, right: JSValue) -> JsResult<JSValue> {
    jsc::cpp::Bun__JSString__concat(global, left, right)
}

fn new_suite(global: &JSGlobalObject, base: &BaseScope) -> JsResult<JSValue> {
    let task = JSValue::create_empty_object(global, 10);
    task.put(global, b"type", ascii(global, "suite")?);
    task.put(global, b"mode", ascii(global, mode(base))?);
    task.put(global, b"meta", JSValue::create_empty_object_with_null_prototype(global));
    Ok(task)
}

const SEPARATOR: &[u8] = b" > ";

/// `outer`, the separator and `name`, which JS has as `string`. A `None` is no name and adds nothing. "" is a name.
fn join(global: &JSGlobalObject, outer: Option<JSValue>, name: Option<&[u8]>, string: JSValue) -> JsResult<Option<JSValue>> {
    let (Some(outer), Some(name)) = (outer, name) else {
        return Ok(outer.or_else(|| name.map(|_| string)));
    };
    let mut rest: SmallVec<[u8; 128]> = SmallVec::from_slice(SEPARATOR);
    rest.extend_from_slice(name);
    concat(global, outer, bun_string_jsc::create_utf8_for_js(global, &rest)?).map(Some)
}

/// Vitest's `File` for a test file. `BunTest::file_task` has it once a test or hook of the file needs a task.
pub(crate) struct FileTask {
    task: Strong,
    /// The file's `name`. Also the `fullName` of what has no name and is in no named scope.
    name: Strong,
    /// `name`, then the separator. Every other `fullName` starts with it.
    prefix: Strong,
}

impl FileTask {
    #[optimize(size)]
    fn create(global: &JSGlobalObject, buntest: &BunTest) -> JsResult<FileTask> {
        let mut prefix = file_name(buntest);
        let name = bun_string_jsc::create_utf8_for_js(global, &prefix)?;
        prefix.extend_from_slice(SEPARATOR);
        let prefix = bun_string_jsc::create_utf8_for_js(global, &prefix)?;
        let task = new_suite(global, &buntest.collection.root_scope.base)?;
        task.put(global, b"name", name);
        task.put(global, b"fullName", name);
        task.put(global, b"filepath", bun_string_jsc::create_utf8_for_js(global, file_path(buntest))?);
        task.put(global, b"file", task);
        Ok(FileTask {
            task: Strong::create(task, global),
            name: Strong::create(name, global),
            prefix: Strong::create(prefix, global),
        })
    }

    fn put_full_names(&self, global: &JSGlobalObject, task: JSValue, full_test_name: Option<JSValue>) -> JsResult<()> {
        let (full_test_name, full_name) = match full_test_name {
            Some(name) => (name, concat(global, self.prefix.get(), name)?),
            None => (JSValue::js_empty_string(global), self.name.get()),
        };
        task.put(global, b"fullTestName", full_test_name);
        task.put(global, b"fullName", full_name);
        Ok(())
    }
}

/// Vitest's `Suite` for a describe block. `DescribeScope::task` has it once a test or hook needs it.
pub(crate) struct SuiteTask {
    task: Strong,
    /// The names inside the block are built from this, not from the Suite's `fullTestName`, which a test can assign.
    full_test_name: Option<Strong>,
}

impl SuiteTask {
    fn full_test_name(&self) -> Option<JSValue> {
        self.full_test_name.as_ref().map(Strong::get)
    }
}

/// The `File`, and the Suite of `block`. Builds the Suites that `block` and the blocks around it lack, outermost first.
#[optimize(size)]
fn tasks<'a>(
    global: &JSGlobalObject,
    buntest: &'a mut BunTest,
    block: Option<*mut DescribeScope>,
) -> JsResult<(&'a FileTask, Option<&'a SuiteTask>)> {
    let root: *mut DescribeScope = &raw mut *buntest.collection.root_scope;
    let file: &FileTask = match buntest.file_task {
        Some(ref file) => file,
        None => {
            let file = FileTask::create(global, buntest)?;
            buntest.file_task.insert(file)
        }
    };

    // Uses an explicit stack instead of recursion, because `describe()` can nest arbitrarily deep.
    let mut missing: SmallVec<[*mut DescribeScope; 8]> = SmallVec::new();
    let mut next = block;
    let mut parent: Option<&SuiteTask> = loop {
        let Some(scope) = next.filter(|&scope| scope != root) else {
            break None;
        };
        // SAFETY: `scope` is `block` or a describe block around it, in `buntest`'s tree. A parent outlives its children.
        if let Some(suite) = unsafe { (*scope).task.as_deref() } {
            break Some(suite);
        }
        missing.push(scope);
        // SAFETY: as above.
        next = unsafe { (*scope).base.parent };
    };
    while let Some(scope) = missing.pop() {
        // SAFETY: as above.
        let base = unsafe { &(*scope).base };
        let name = bun_string_jsc::create_utf8_for_js(global, base.name.as_deref().unwrap_or(b""))?;
        let full_test_name = join(global, parent.and_then(SuiteTask::full_test_name), base.name.as_deref(), name)?;
        let task = new_suite(global, base)?;
        task.put(global, b"name", name);
        file.put_full_names(global, task, full_test_name)?;
        task.put(global, b"file", file.task.get());
        if let Some(parent) = parent {
            task.put(global, b"suite", parent.task.get());
        }
        let suite = SuiteTask {
            task: Strong::create(task, global),
            full_test_name: full_test_name.map(|name| Strong::create(name, global)),
        };
        // SAFETY: as above. The Suite is complete, so a build that fails leaves none in the cache.
        parent = Some(unsafe { (*scope).task.insert(Box::new(suite)) });
    }
    Ok((file, parent))
}

/// Vitest's `Suite` for a describe block, or its `File` for the root scope and for the preload hook scope.
pub(crate) fn suite_task(
    global: &JSGlobalObject,
    buntest: &mut BunTest,
    scope: *mut DescribeScope,
) -> JsResult<JSValue> {
    let root: *mut DescribeScope = &raw mut *buntest.collection.root_scope;
    // SAFETY: `scope` is in `buntest`'s describe tree, or is the preload hook scope above it, which alone has no parent.
    let block = (scope != root && unsafe { (*scope).base.parent.is_some() }).then_some(scope);
    let cached = match block {
        // SAFETY: as above.
        Some(block) => unsafe { (*block).task.as_deref() }.map(|suite| &suite.task),
        None => buntest.file_task.as_ref().map(|file| &file.task),
    };
    if let Some(task) = cached {
        return Ok(task.get());
    }
    let (file, suite) = tasks(global, buntest, block)?;
    Ok(suite.map_or(&file.task, |suite| &suite.task).get())
}

/// Rejects rather than throws, so the report shows the error's own stack and not the `throw` site's.
pub(crate) fn reject_with_this(cx: &mut JsScope<'_>, this_value: JsLocal<'_>) -> JSValue {
    JSPromise::rejected_promise(cx.global(), this_value.to_js()).to_js()
}

/// Only an extended `test`'s hooks have fixtures. Any other callback that destructures one fails when the hook runs.
/// `context_index` is 1 for `aroundAll`, whose first parameter is `runSuite`.
pub(crate) fn suite_hook(
    global: &JSGlobalObject,
    name: &str,
    callback: JSValue,
    context_index: usize,
    has_fixtures: bool,
) -> JsResult<JSValue> {
    let (ordinal, hint) = if context_index == 0 {
        ("first", format!("The suite is the second argument: {name}(({{}}, suite) => {{}})"))
    } else {
        ("second", format!("The suite is the third argument: {name}((runSuite, {{}}, suite) => {{}})"))
    };
    let error = match ContextParameter::of(callback, context_index) {
        ContextParameter::Absent => return Ok(callback),
        ContextParameter::TextLeftOut if !has_fixtures => return Ok(callback),
        ContextParameter::TextLeftOut => global.create_error_instance(format_args!("{name}(): {TEXT_LEFT_OUT}")),
        ContextParameter::Properties(names) if has_fixtures || names.is_empty() => return Ok(callback),
        ContextParameter::Properties(names) => {
            let names: Vec<_> = names.iter().map(|name| format!("\"{}\"", bstr::BStr::new(name))).collect();
            global.create_error_instance(format_args!(
                "{name}() has no fixtures for its callback, which destructures {}. {hint}",
                names.join(", "),
            ))
        }
        ContextParameter::RestProperty => global.create_error_instance(format_args!(
            "{name}() has no fixtures for its callback, which destructures a rest property. {hint}",
        )),
        ContextParameter::Other(Some(parameter)) => global.create_error_instance(format_args!(
            "{name}() expects the {ordinal} parameter of its callback to be an object destructuring pattern, received \"{}\". {hint}",
            bstr::BStr::new(&parameter),
        )),
        ContextParameter::Other(None) => global.create_error_instance(format_args!(
            "{name}() expects the {ordinal} parameter of its callback to be an object destructuring pattern. {hint}",
        )),
    };
    rejecting(global, error)
}

pub(crate) fn rejecting(global: &JSGlobalObject, error: JSValue) -> JsResult<JSValue> {
    JSFunction::create(global, "", generated::Bun__TestContext__rejectWithThis, 0, Default::default()).bind(
        global,
        error,
        &BunString::static_(""),
        0.0,
        // Never read. Holding the call site keeps GC from flattening `error`'s stack frames before it's reported.
        &[ExpectDeferred::capture_call_site(global)],
    )
}
