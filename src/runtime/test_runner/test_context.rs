//! Vitest's test context. A test shares one with its hooks, and keeps it across retries and repeats.

use core::ptr::NonNull;
use std::rc::Rc;

use bun_core::String as BunString;
use bun_jsc::{
    self as jsc, AbortSignal, CallFrame, CommonAbortReason, JSFunction, JSGlobalObject, JSHostFn,
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
use super::test_context_parameter::ContextParameter;

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

#[bun_jsc::JsClass(no_construct, no_constructor)]
pub(crate) struct TestContext {
    buntest: BunTestPtrWeak,
    group_index: usize,
    sequence_index: usize,
    /// `BunTest::extra_execution_entries` owns the entries.
    deferred: JsCell<Vec<(Deferred, NonNull<ExecutionEntry>)>>,
    fixtures: JsCell<Vec<usize>>,
}

pub(crate) mod js {
    bun_jsc::codegen_cached_accessors!("TestContext"; task, signal, result, errors, annotations, fixtures, asyncContext);
}

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

/// Vitest passes the context where Jest passes `done`, so a Jest-style `done()` call lands here.
#[bun_jsc::host_fn(export = "TestContext__callInstance")]
fn call_instance(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    Err(global.throw(format_args!("done() callback is deprecated, use promise instead")))
}

fn ascii(global: &JSGlobalObject, text: &'static str) -> JsResult<JSValue> {
    BunString::static_(text).to_js(global)
}

impl TestContext {
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

    fn of_call<'a>(global: &JSGlobalObject, frame: &'a CallFrame) -> JsResult<&'a TestContext> {
        match TestContext::from_js(frame.this()) {
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

    pub(crate) fn state_of_bound(function: JSValue) -> Option<RefDataValue> {
        let this_value = jsc::cpp::Bun__JSBoundFunction__boundThis(function);
        // SAFETY: the wrapper owns the payload, and `function` keeps the wrapper alive.
        unsafe { &*TestContext::from_js(this_value)? }.state_data(this_value)
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

    pub(crate) fn get_task(this: &Self, this_value: JSValue, global: &JSGlobalObject) -> JsResult<JSValue> {
        let Some((buntest, sequence)) = this.sequence() else {
            return Ok(JSValue::UNDEFINED);
        };
        // SAFETY: as in `running`.
        let sequence = unsafe { sequence.as_ref() };
        let Some(test) = sequence.test_entry else {
            return Ok(JSValue::UNDEFINED);
        };
        // SAFETY: owned by the describe tree, which `buntest` keeps alive.
        let test = unsafe { test.as_ref() };
        let name = test.base.name.as_deref().unwrap_or(b"");
        let buntest = buntest.get();
        let root: *mut DescribeScope = &raw mut *buntest.collection.root_scope;

        let task = JSValue::create_empty_object(global, 16);
        let id = format!("{}_{}_{}", buntest.file_id, this.group_index, this.sequence_index);
        task.put(global, b"id", bun_string_jsc::create_utf8_for_js(global, id.as_bytes())?);
        task.put(global, b"type", ascii(global, "test")?);
        task.put(global, b"name", bun_string_jsc::create_utf8_for_js(global, name)?);
        put_full_names(global, task, buntest, &test.base)?;
        task.put(global, b"mode", ascii(global, mode(&test.base))?);
        task.put(global, b"file", suite_task(global, buntest, root)?);
        if let Some(parent) = test.base.parent.filter(|&parent| parent != root) {
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

    pub(crate) fn get_signal(this: &Self, this_value: JSValue, global: &JSGlobalObject) -> JsResult<JSValue> {
        let signal = AbortSignal::create(global);
        if let Some((_buntest, sequence)) = this.running(this_value)
            // SAFETY: as in `running`.
            && unsafe { sequence.as_ref() }.result.is_timeout()
        {
            js::signal_set_cached(this_value, global, signal);
            Self::abort_signal(this_value, global);
        }
        Ok(signal)
    }

    pub(crate) fn get_expect(_this: &Self, this_value: JSValue, global: &JSGlobalObject) -> JsResult<JSValue> {
        let expect = bound(global, this_value, "expect", 1, __jsc_host_expect)?;
        let constructor = jsc::codegen::js::get_constructor::<Expect>(global);
        jsc::cpp::Bun__JSValue__setPrototypeDirect(expect, constructor, global)?;
        // Copied because these getters only work when `this` is the constructor itself, not an object inheriting from it.
        for name in ["not", "resolvesTo", "rejectsTo"] {
            if let Some(value) = constructor.get(global, name)? {
                expect.put(global, name.as_bytes(), value);
            }
        }
        expect.put(global, b"assertions", bound(global, this_value, "assertions", 1, __jsc_host_assertions)?);
        expect.put(global, b"hasAssertions", bound(global, this_value, "hasAssertions", 0, __jsc_host_has_assertions)?);
        expect.put(global, b"getState", bound(global, this_value, "getState", 0, __jsc_host_get_state)?);
        expect.put(global, b"setState", bound(global, this_value, "setState", 1, __jsc_host_set_state)?);
        Ok(expect)
    }

    pub(crate) fn get_skip(_this: &Self, this_value: JSValue, global: &JSGlobalObject) -> JsResult<JSValue> {
        bound(global, this_value, "skip", 2, __jsc_host_skip)
    }

    pub(crate) fn get_on_test_finished(_this: &Self, this_value: JSValue, global: &JSGlobalObject) -> JsResult<JSValue> {
        bound(global, this_value, "onTestFinished", 2, __jsc_host_on_test_finished)
    }

    pub(crate) fn get_on_test_failed(_this: &Self, this_value: JSValue, global: &JSGlobalObject) -> JsResult<JSValue> {
        bound(global, this_value, "onTestFailed", 2, __jsc_host_on_test_failed)
    }

    pub(crate) fn get_annotate(_this: &Self, this_value: JSValue, global: &JSGlobalObject) -> JsResult<JSValue> {
        bound(global, this_value, "annotate", 3, __jsc_host_annotate)
    }

    #[optimize(size)]
    fn defer_call(
        global: &JSGlobalObject,
        frame: &CallFrame,
        when: Deferred,
        name: &'static str,
        signature: &'static [u8],
    ) -> JsResult<JSValue> {
        let args = parse_arguments(
            global,
            frame,
            Signature::Str(signature),
            ParseArgumentsCfg {
                callback: CallbackMode::Require,
                kind: FunctionKind::VitestHook,
                inherited: Default::default(),
            },
        )?;
        let this = Self::of_call(global, frame)?;
        let Some((buntest, _sequence)) = this.running(frame.this()) else {
            return Err(Self::throw_finished(global, name));
        };
        if let Some(callback) = args.callback {
            this.defer(buntest.get(), when, callback, args.options.timeout);
        }
        Ok(JSValue::UNDEFINED)
    }
}

#[bun_jsc::host_fn]
#[optimize(size)]
fn expect(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let state = TestContext::of_call(global, frame)?.state_data(frame.this());
    Expect::call_in(global, frame.arguments(), state)
}

#[bun_jsc::host_fn]
#[optimize(size)]
fn assertions(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let state = TestContext::of_call(global, frame)?.state_data(frame.this());
    Expect::assertions_in(global, frame, state)
}

#[bun_jsc::host_fn]
#[optimize(size)]
fn has_assertions(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let state = TestContext::of_call(global, frame)?.state_data(frame.this());
    Expect::has_assertions_in(global, state)
}

#[bun_jsc::host_fn]
#[optimize(size)]
fn get_state(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let state = TestContext::of_call(global, frame)?.state_data(frame.this());
    Expect::get_state_in(global, state)
}

#[bun_jsc::host_fn]
#[optimize(size)]
fn set_state(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let state = TestContext::of_call(global, frame)?.state_data(frame.this());
    Expect::set_state_in(global, frame, state)
}

/// `skip(note?)` or `skip(condition, note?)`. As in Vitest, only a literal `false` condition doesn't skip.
#[bun_jsc::host_fn]
#[optimize(size)]
fn skip(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let [condition, note] = frame.arguments_as_array::<2>();
    if condition == JSValue::FALSE {
        return Ok(JSValue::UNDEFINED);
    }
    let this_value = frame.this();
    let Some((_buntest, sequence)) = TestContext::of_call(global, frame)?.running(this_value) else {
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

#[bun_jsc::host_fn]
fn on_test_finished(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    TestContext::defer_call(global, frame, Deferred::OnTestFinished, "onTestFinished", b"onTestFinished()")
}

#[bun_jsc::host_fn]
fn on_test_failed(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    TestContext::defer_call(global, frame, Deferred::OnTestFailed, "onTestFailed", b"onTestFailed()")
}

#[bun_jsc::host_fn]
#[optimize(size)]
fn annotate(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let [message, kind, attachment] = frame.arguments_as_array::<3>();
    let this_value = frame.this();
    if TestContext::of_call(global, frame)?.running(this_value).is_none() {
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
#[bun_jsc::host_fn]
#[optimize(size)]
fn get_current_test(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
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
    // SAFETY: as in `running`; nothing else borrows the sequence while a callback of it is on the stack.
    let sequence = unsafe { &mut *sequence.as_ptr() };
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
        JSFunction::create(global, "getCurrentTest", __jsc_host_get_current_test, 0, Default::default()),
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
    let mut name = resolve_path::relative(FileSystem::instance().top_level_dir, file_path(buntest)).to_vec();
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
    let mut next = Some(base);
    while let Some(base) = next {
        names.extend(base.name.as_deref());
        // SAFETY: a parent outlives its children.
        next = base.parent.map(|parent| unsafe { &(*parent).base });
    }
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
    buntest: &mut BunTest,
    scope: *mut DescribeScope,
) -> JsResult<JSValue> {
    let root: *mut DescribeScope = &raw mut *buntest.collection.root_scope;
    // SAFETY: `scope` is in `buntest`'s describe tree, or is the preload hook scope above it.
    let scope = if unsafe { (*scope).base.parent.is_none() } { root } else { scope };
    // SAFETY: as above; the borrow ends before the recursive calls.
    if let Some(task) = unsafe { &(*scope).task } {
        return Ok(task.get());
    }
    let task = JSValue::create_empty_object(global, 10);
    // SAFETY: as above.
    unsafe { (*scope).task = Some(Strong::create(task, global)) };
    // SAFETY: as above.
    let base = unsafe { &(*scope).base };
    task.put(global, b"type", ascii(global, "suite")?);
    task.put(global, b"mode", ascii(global, mode(base))?);
    task.put(global, b"meta", JSValue::create_empty_object_with_null_prototype(global));
    if scope == root {
        let name = bun_string_jsc::create_utf8_for_js(global, &file_name(buntest))?;
        task.put(global, b"name", name);
        task.put(global, b"fullName", name);
        task.put(global, b"filepath", bun_string_jsc::create_utf8_for_js(global, file_path(buntest))?);
        task.put(global, b"file", task);
        return Ok(task);
    }
    task.put(global, b"name", bun_string_jsc::create_utf8_for_js(global, base.name.as_deref().unwrap_or(b""))?);
    put_full_names(global, task, buntest, base)?;
    task.put(global, b"file", suite_task(global, buntest, root)?);
    if let Some(parent) = base.parent.filter(|&parent| parent != root) {
        task.put(global, b"suite", suite_task(global, buntest, parent)?);
    }
    Ok(task)
}

/// Rejects rather than throws, so the report shows the error's own stack and not the `throw` site's.
#[bun_jsc::host_fn]
fn reject_with_this(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    Ok(JSPromise::rejected_promise(global, frame.this()).to_js())
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
    JSFunction::create(global, "", __jsc_host_reject_with_this, 0, Default::default()).bind(
        global,
        error,
        &BunString::static_(""),
        0.0,
        // Never read. Holding the call site keeps GC from flattening `error`'s stack frames before it's reported.
        &[ExpectDeferred::capture_call_site(global)],
    )
}
