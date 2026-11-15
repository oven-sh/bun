//! Vitest's test context. A test shares one with its hooks, and keeps it across retries and repeats.

use core::cell::Cell;
use std::rc::Rc;

use bun_core::String as BunString;
use bun_jsc::bindgen::{JsLocal, JsScope, JsWrapper};
use bun_jsc::{
    self as jsc, AbortSignal, CommonAbortReason, JSFunction, JSGlobalObject, JSHostFn,
    JSPromise, JSValue, JsClass as _, JsResult, Strong, StringJsc as _, bun_string_jsc,
};
use bun_paths::resolve_path;
use bun_ptr::CellExt as _;
use bun_resolver::fs::FileSystem;

use super::bun_test::js_fns::Signature;
use super::bun_test::{
    BaseScope, BunTest, BunTestPtr, BunTestPtrWeak, EntryData, Only, Phase, RefDataValue, ScopeId, ScopeMode,
};
use super::execution::{ExecutionSequence, Result as ExecutionResult};
use super::expect::Expect;
use super::expect::expect_deferred::ExpectDeferred;
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
    fixtures: Cell<Vec<usize>>,
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
            fixtures: Cell::default(),
        }
        .to_js(global)
    }

    pub(crate) fn has_fixture(&self, definition: usize) -> bool {
        self.fixtures.with_taken(|fixtures| fixtures.contains(&definition))
    }

    pub(crate) fn add_fixture(&self, definition: usize) {
        self.fixtures.with_taken(|fixtures| fixtures.push(definition));
    }

    pub(crate) fn remove_fixture(&self, definition: usize) {
        self.fixtures.with_taken(|fixtures| fixtures.retain(|&fixture| fixture != definition));
    }

    fn of_call<'a>(global: &JSGlobalObject, this_value: JsLocal<'a>) -> JsResult<&'a TestContext> {
        match TestContext::from_js(this_value.to_js()) {
            // SAFETY: the wrapper owns the payload, and the frame keeps the wrapper alive.
            Some(this) => Ok(unsafe { &*this }),
            None => Err(global.throw_type_error(format_args!("Expected this to be a test context"))),
        }
    }

    /// `buntest` is `self.buntest`.
    fn sequence<'a>(&self, buntest: &'a BunTest) -> Option<&'a ExecutionSequence> {
        let execution = &buntest.execution;
        execution.groups().get(self.group_index)?.sequences(execution).get(self.sequence_index)
    }

    fn running<'a>(&self, buntest: &'a BunTest, this_value: JSValue) -> Option<&'a ExecutionSequence> {
        let sequence = self.sequence(buntest)?;
        (buntest.phase.get() == Phase::Execution && sequence.context.get() == Some(this_value)).then_some(sequence)
    }

    /// `None` if the test has finished.
    fn with_running<R>(&self, this_value: JSValue, f: impl FnOnce(&BunTest, &ExecutionSequence) -> R) -> Option<R> {
        let buntest = self.buntest.upgrade()?;
        Some(f(&buntest, self.running(&buntest, this_value)?))
    }

    fn throw_finished(global: &JSGlobalObject, name: &str) -> jsc::JsError {
        global.throw(format_args!("Cannot call {name}() after its test has finished"))
    }

    /// Lets `expect()` attribute a call to this test even when other tests run concurrently.
    fn state_data(&self, this_value: JSValue) -> Option<RefDataValue> {
        self.with_running(this_value, |_, sequence| RefDataValue::Execution {
            group_index: self.group_index,
            entry_data: Some(EntryData {
                sequence_index: self.sequence_index,
                entry: sequence.active_entry.get(),
                attempt: sequence.attempt.get(),
            }),
        })
    }

    /// Returns false if the test has finished.
    pub(crate) fn defer_fixture(&self, this_value: JSValue, tear_down: JSValue, timeout: u32) -> bool {
        self.with_running(this_value, |buntest, sequence| {
            let when = if sequence.is_before_run_test(buntest) { Deferred::AroundFixture } else { Deferred::Fixture };
            sequence.defer(buntest, when, tear_down, timeout);
        })
        .is_some()
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
        buntest: &BunTest,
        sequence: &ExecutionSequence,
    ) -> JsResult<()> {
        let (Some(result), Some(test)) = (js::result_get_cached(this_value), sequence.test(buntest)) else {
            return Ok(());
        };
        result.put(global, b"state", ascii(global, sequence.state(buntest))?);
        result.put(global, b"retryCount", JSValue::from(test.retry_count - sequence.remaining_retry_count.get()));
        result.put(global, b"repeatCount", JSValue::from(test.repeat_count - sequence.remaining_repeat_count.get()));
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
        let Some(buntest) = self.buntest.upgrade() else {
            return Ok(JSValue::UNDEFINED);
        };
        let buntest: &BunTest = &buntest;
        let Some(sequence) = self.sequence(buntest) else {
            return Ok(JSValue::UNDEFINED);
        };
        let Some(test) = sequence.test(buntest) else {
            return Ok(JSValue::UNDEFINED);
        };
        let name = test.base.name.as_deref().unwrap_or(b"");

        let task = JSValue::create_empty_object(global, 16);
        let id = format!("{}_{}_{}", buntest.file.id, self.group_index, self.sequence_index);
        task.put(global, b"id", bun_string_jsc::create_utf8_for_js(global, id.as_bytes())?);
        task.put(global, b"type", ascii(global, "test")?);
        task.put(global, b"name", bun_string_jsc::create_utf8_for_js(global, name)?);
        put_full_names(global, task, buntest, &test.base)?;
        task.put(global, b"mode", ascii(global, mode(&test.base))?);
        task.put(global, b"file", suite_task(global, buntest, ScopeId::ROOT)?);
        if let Some(parent) = test.base.parent.filter(|&parent| parent != ScopeId::ROOT) {
            task.put(global, b"suite", suite_task(global, buntest, parent)?);
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
        Self::sync_result(this_value, global, buntest, sequence)?;
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
        if self.with_running(this_value, |_, sequence| sequence.result.get().is_timeout()) == Some(true) {
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
        this.with_running(this_value.to_js(), |buntest, sequence| {
            if let Some(callback) = args.callback {
                sequence.defer(buntest, when, callback, args.options.timeout);
            }
        })
        .ok_or_else(|| Self::throw_finished(global, name))
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
    this.with_running(this_value, |buntest, sequence| {
        sequence.result.set(ExecutionResult::Skip);
        let result = TestContext::result(this_value, global);
        result.put(global, b"pending", JSValue::TRUE);
        let note = if condition.is_string() { condition } else { note };
        if !note.is_undefined() {
            result.put(global, b"note", note);
        }
        TestContext::sync_result(this_value, global, buntest, sequence)?;
        Err(global.throw(format_args!("test is skipped; abort execution")))
    })
    .unwrap_or_else(|| Err(TestContext::throw_finished(global, "skip")))
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
    if this.with_running(this_value, |_, _| ()).is_none() {
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
    let Some(buntest) = super::bun_test::clone_active_strong() else {
        return Ok(JSValue::UNDEFINED);
    };
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
    let context = sequence.context(global, &buntest, group_index, entry_data.sequence_index);
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
        ScopeMode::Normal | ScopeMode::Failing | ScopeMode::Fails if base.only.get() == Only::Yes => "only",
        ScopeMode::Normal | ScopeMode::Failing | ScopeMode::Fails => "run",
    }
}

fn file_name(buntest: &BunTest) -> Vec<u8> {
    let mut name = resolve_path::relative(FileSystem::instance().top_level_dir(), buntest.file.path).to_vec();
    resolve_path::platform_to_posix_in_place::<u8>(&mut name);
    name
}

#[optimize(size)]
fn put_full_names(
    global: &JSGlobalObject,
    task: JSValue,
    buntest: &BunTest,
    base: &BaseScope,
) -> JsResult<()> {
    let mut names: Vec<&[u8]> = Vec::new();
    names.extend(base.name.as_deref());
    names.extend(buntest.scopes_from(base.parent).filter_map(|scope| scope.base.name.as_deref()));
    names.reverse();
    task.put(global, b"fullTestName", bun_string_jsc::create_utf8_for_js(global, &names.join(&b" > "[..]))?);
    let file_name = file_name(buntest);
    names.insert(0, &file_name);
    task.put(global, b"fullName", bun_string_jsc::create_utf8_for_js(global, &names.join(&b" > "[..]))?);
    Ok(())
}

/// Vitest's `Suite` for a describe block, or its `File` for the root scope. Cached in `DescribeScope::task`.
#[optimize(size)]
pub(crate) fn suite_task(
    global: &JSGlobalObject,
    buntest: &BunTest,
    scope: ScopeId,
) -> JsResult<JSValue> {
    let scope = match buntest.scope(scope) {
        preload if preload.base.parent.is_none() => buntest.scope(ScopeId::ROOT),
        scope => scope,
    };
    if let Some(task) = scope.task.get() {
        return Ok(task.get());
    }
    let task = scope.task.get_or_init(|| Strong::create(JSValue::create_empty_object(global, 10), global)).get();
    let base = &scope.base;
    task.put(global, b"type", ascii(global, "suite")?);
    task.put(global, b"mode", ascii(global, mode(base))?);
    task.put(global, b"meta", JSValue::create_empty_object_with_null_prototype(global));
    if scope.id == ScopeId::ROOT {
        let name = bun_string_jsc::create_utf8_for_js(global, &file_name(buntest))?;
        task.put(global, b"name", name);
        task.put(global, b"fullName", name);
        task.put(global, b"filepath", bun_string_jsc::create_utf8_for_js(global, buntest.file.path)?);
        task.put(global, b"file", task);
        return Ok(task);
    }
    task.put(global, b"name", bun_string_jsc::create_utf8_for_js(global, base.name.as_deref().unwrap_or(b""))?);
    put_full_names(global, task, buntest, base)?;
    task.put(global, b"file", suite_task(global, buntest, ScopeId::ROOT)?);
    if let Some(parent) = base.parent.filter(|&parent| parent != ScopeId::ROOT) {
        task.put(global, b"suite", suite_task(global, buntest, parent)?);
    }
    Ok(task)
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
