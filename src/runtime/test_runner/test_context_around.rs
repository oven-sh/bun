//! `aroundEach` and `aroundAll`. The runner calls every callback from its own loop, so a hook runs in two entries.
//! The setup entry calls the hook and ends when the hook calls `runTest()`. The teardown entry resolves the promise
//! that `runTest()` returned, then waits for the hook to finish.

use core::cell::Cell;
use core::fmt;
use core::ptr::NonNull;
use std::rc::Rc;

use bun_core::String as BunString;
use bun_jsc::bindgen::{JsLocal, JsScope};
use bun_jsc::js_promise::Status as PromiseStatus;
use bun_jsc::{
    JSFunction, JSGlobalObject, JSPromise, JSValue, JsClass as _, JsResult, StringJsc as _, Strong,
};

use super::bun_test::{
    Around, AroundPhase, BunTestPtr, BunTestPtrWeak, DescribeScope, RefDataValue,
};
use super::execution::ExecutionSequence;
use super::test_context::{self, Deferred, TestContext, bound};
use crate::generated_bindgen::test_context as generated;

#[derive(Copy, Clone, PartialEq, Eq)]
enum State {
    SettingUp,
    /// The hook called `runTest()`.
    Called,
    /// The setup entry ended before the hook called `runTest()`.
    Abandoned,
}

/// One call of a hook: each attempt of a test has its own.
pub(crate) struct AroundHook {
    buntest: BunTestPtrWeak,
    set_up_entry: RefDataValue,
    around: Around,
    timeout: u32,
    state: Cell<State>,
}

use crate::generated_bindgen::test_context::js_AroundHook as js;

impl Around {
    fn hook_name(self) -> &'static str {
        match self {
            Around::Each => "aroundEach",
            Around::All => "aroundAll",
        }
    }

    fn callback_name(self) -> &'static str {
        match self {
            Around::Each => "runTest",
            Around::All => "runSuite",
        }
    }

    /// Vitest's `makeAroundHookTimeoutError`
    pub(crate) fn timeout_error(
        self,
        global: &JSGlobalObject,
        phase: AroundPhase,
        timeout: u32,
    ) -> JsResult<JSValue> {
        let (name, phase) = match phase {
            AroundPhase::SetUp => ("AroundHookSetupError", "setup"),
            AroundPhase::TearDown => ("AroundHookTeardownError", "teardown"),
        };
        named_error(
            global,
            name,
            format_args!(
                "The {phase} phase of \"{}\" hook timed out after {timeout}ms.",
                self.hook_name()
            ),
        )
    }
}

fn named_error(
    global: &JSGlobalObject,
    name: &'static str,
    message: fmt::Arguments<'_>,
) -> JsResult<JSValue> {
    let error = global.create_error_instance(message);
    error.put(global, b"name", BunString::static_(name).to_js(global)?);
    Ok(error)
}

fn pending<'a>(promise: Option<JSValue>) -> Option<&'a mut JSPromise> {
    let promise = JSPromise::opaque_mut(promise?.as_promise()?);
    (promise.status() == PromiseStatus::Pending).then_some(promise)
}

impl AroundHook {
    pub(crate) fn create(
        global: &JSGlobalObject,
        buntest: &BunTestPtr,
        set_up_entry: RefDataValue,
        around: Around,
        timeout: u32,
    ) -> JSValue {
        AroundHook {
            buntest: Rc::downgrade(buntest),
            set_up_entry,
            around,
            timeout,
            state: Cell::new(State::SettingUp),
        }
        .to_js(global)
    }

    /// The setup entry's callback. Its arguments are what `create()` returned, the hook, and the hook's last two arguments.
    pub(crate) fn set_up_function(global: &JSGlobalObject) -> JSValue {
        JSFunction::create(
            global,
            "",
            generated::Bun__AroundHook__setUp,
            4,
            Default::default(),
        )
    }

    fn of<'a>(value: JSValue) -> Option<&'a AroundHook> {
        // SAFETY: the wrapper owns the payload, and every caller keeps `value` alive while it uses the borrow.
        AroundHook::from_js(value).map(|this| unsafe { &*this })
    }

    fn of_call<'a>(global: &JSGlobalObject, this_value: JsLocal<'a>) -> JsResult<&'a AroundHook> {
        Self::of(this_value.to_js()).ok_or_else(|| {
            global.throw_type_error(format_args!("Expected this to be an around hook"))
        })
    }

    /// The setup entry's sequence, while that entry waits for `runTest()`.
    fn setting_up(&self) -> Option<(BunTestPtr, NonNull<ExecutionSequence>)> {
        if self.state.get() != State::SettingUp {
            return None;
        }
        let waiting = self.buntest.upgrade().and_then(|buntest| {
            let (sequence, _) = buntest
                .get()
                .execution
                .get_current_and_valid_execution_sequence(&self.set_up_entry)?;
            let sequence = NonNull::from(sequence);
            Some((buntest, sequence))
        });
        // The entry timed out, or its file is over.
        if waiting.is_none() {
            self.state.set(State::Abandoned);
        }
        waiting
    }

    fn start(
        &self,
        this_value: JSValue,
        global: &JSGlobalObject,
        hook: JSValue,
        context: JSValue,
        suite: JSValue,
    ) -> JsResult<()> {
        let run = bound(
            global,
            this_value,
            self.around.callback_name(),
            0,
            generated::Bun__AroundHook__run,
        )?;
        let returned = hook.call(global, JSValue::UNDEFINED, &[run, context, suite])?;
        match if returned.is_object() {
            returned
                .get(global, "then")?
                .filter(|then| then.is_callable())
        } else {
            None
        } {
            Some(then) => {
                let reactions = [
                    bound(
                        global,
                        this_value,
                        "",
                        1,
                        generated::Bun__AroundHook__onFulfilled,
                    )?,
                    bound(
                        global,
                        this_value,
                        "",
                        1,
                        generated::Bun__AroundHook__onRejected,
                    )?,
                ];
                then.call(global, returned, &reactions)?;
                Ok(())
            }
            None => self.on_settled(this_value, global, Ok(())),
        }
    }

    /// The hook returned or threw, or the promise it returned settled.
    #[optimize(size)]
    fn on_settled(
        &self,
        this_value: JSValue,
        global: &JSGlobalObject,
        result: Result<(), JSValue>,
    ) -> JsResult<()> {
        if self.setting_up().is_some() {
            self.state.set(State::Abandoned);
            let error = match result {
                Err(error) => error,
                Ok(()) => named_error(
                    global,
                    "AroundHookSetupError",
                    format_args!(
                        "The `{0}()` callback was not called in the `{1}` hook. Make sure to call `{0}()` to run the {2}.",
                        self.around.callback_name(),
                        self.around.hook_name(),
                        if self.around == Around::Each {
                            "test"
                        } else {
                            "suite"
                        },
                    ),
                )?,
            };
            return match pending(js::ready_get_cached(this_value)) {
                Some(ready) => ready.reject(global, Ok(error)),
                None => Ok(()),
            };
        }
        // Only set once the hook has called `runTest()`.
        let Some(done) = pending(js::done_get_cached(this_value)) else {
            return Ok(());
        };
        match result {
            Ok(()) => done.resolve(global, JSValue::UNDEFINED),
            Err(error) => {
                // The teardown entry reports it.
                done.set_handled();
                done.reject(global, Ok(error))
            }
        }
    }
}

#[optimize(size)]
pub(crate) fn set_up(
    cx: &mut JsScope<'_>,
    around_hook: JsLocal<'_>,
    hook: JsLocal<'_>,
    context: JsLocal<'_>,
    suite: JsLocal<'_>,
) -> JsResult<JSValue> {
    let global = cx.global();
    let (this_value, hook, context, suite) = (
        around_hook.to_js(),
        hook.to_js(),
        context.to_js(),
        suite.to_js(),
    );
    let Some(this) = AroundHook::of(this_value) else {
        return Err(global.throw_type_error(format_args!(
            "Expected the first argument to be an around hook"
        )));
    };
    let ready = JSPromise::create(global).to_js();
    js::ready_set_cached(this_value, global, ready);
    if let Err(err) = this.start(this_value, global, hook, context, suite) {
        this.on_settled(this_value, global, Err(global.take_exception(err)))?;
    }
    Ok(ready)
}

pub(crate) fn on_fulfilled(cx: &mut JsScope<'_>, this_value: JsLocal<'_>) -> JsResult<()> {
    let global = cx.global();
    AroundHook::of_call(global, this_value)?.on_settled(this_value.to_js(), global, Ok(()))
}

pub(crate) fn on_rejected(
    cx: &mut JsScope<'_>,
    this_value: JsLocal<'_>,
    reason: JsLocal<'_>,
) -> JsResult<()> {
    let global = cx.global();
    AroundHook::of_call(global, this_value)?.on_settled(
        this_value.to_js(),
        global,
        Err(reason.to_js()),
    )
}

/// `runTest()` or `runSuite()`
#[optimize(size)]
pub(crate) fn run(cx: &mut JsScope<'_>, this_value: JsLocal<'_>) -> JsResult<JSValue> {
    let global = cx.global();
    let this = AroundHook::of_call(global, this_value)?;
    let this_value = this_value.to_js();
    let (hook_name, callback_name) = (this.around.hook_name(), this.around.callback_name());
    let Some((buntest, sequence)) = this.setting_up() else {
        let error = if this.state.get() == State::Abandoned {
            global.create_error_instance(format_args!(
                "Cannot call {callback_name}() after the setup phase of the {hook_name} hook has ended"
            ))
        } else {
            named_error(
                global,
                "AroundHookMultipleCallsError",
                format_args!(
                    "The `{callback_name}()` callback was called multiple times in the `{hook_name}` hook. The callback can only be called once per hook."
                ),
            )?
        };
        return Ok(JSPromise::rejected_promise(global, error).to_js());
    };
    let tear_down = bound(
        global,
        this_value,
        "",
        0,
        generated::Bun__AroundHook__tearDown,
    )?;
    let async_context = capture_async_context(global);
    // SAFETY: points into `buntest.execution.sequences`, which `buntest` keeps alive.
    let (context, entry) = unsafe {
        (
            sequence.as_ref().context.as_ref().map(Strong::get),
            sequence.as_ref().active_entry,
        )
    };
    match this.around {
        Around::Each => {
            if let Some(context) = context
                && let Some(payload) = TestContext::from_js(context)
            {
                let outer = test_context::js::async_context_get_cached(context).unwrap_or_default();
                js::context_set_cached(this_value, global, context);
                js::outer_async_context_set_cached(this_value, global, outer);
                test_context::js::async_context_set_cached(context, global, async_context);
                // SAFETY: the wrapper owns the payload, and the sequence keeps the wrapper alive.
                unsafe { &*payload }.defer(
                    buntest.get(),
                    Deferred::Around,
                    tear_down,
                    this.timeout,
                );
            }
        }
        Around::All => {
            if let Some(entry) = entry
                // SAFETY: the running file keeps the active entry and its scope alive.
                && let Some(scope) = unsafe { entry.as_ref() }.base.parent
            {
                // SAFETY: as above.
                unsafe { &mut *scope }.enter_around_all(entry.as_ptr(), tear_down, async_context);
            }
        }
    }
    this.state.set(State::Called);
    let release = JSPromise::create(global).to_js();
    js::release_set_cached(this_value, global, release);
    js::done_set_cached(this_value, global, JSPromise::create(global).to_js());
    if let Some(ready) = pending(js::ready_get_cached(this_value)) {
        ready.resolve(global, JSValue::UNDEFINED)?;
    }
    Ok(release)
}

/// The teardown entry's callback.
pub(crate) fn tear_down(cx: &mut JsScope<'_>, this_value: JsLocal<'_>) -> JsResult<JSValue> {
    let global = cx.global();
    AroundHook::of_call(global, this_value)?;
    let this_value = this_value.to_js();
    if let Some(context) = js::context_get_cached(this_value) {
        let outer = js::outer_async_context_get_cached(this_value).unwrap_or_default();
        test_context::js::async_context_set_cached(context, global, outer);
    }
    if let Some(release) = pending(js::release_get_cached(this_value)) {
        release.resolve(global, JSValue::UNDEFINED)?;
    }
    Ok(js::done_get_cached(this_value).unwrap_or(JSValue::UNDEFINED))
}

/// Returns its argument, bound to the async context it's called in.
pub(crate) fn adopt_async_context(cx: &mut JsScope<'_>, callback: JsLocal<'_>) -> JSValue {
    callback.to_js().with_async_context_if_needed(cx.global())
}

/// Remembers the current async context, for `in_async_context()`.
fn capture_async_context(global: &JSGlobalObject) -> JSValue {
    JSFunction::create(
        global,
        "",
        generated::Bun__AroundHook__adoptAsyncContext,
        1,
        Default::default(),
    )
    .with_async_context_if_needed(global)
}

/// `callback`, bound to the async context that `captured` remembers instead of the one it was registered in.
pub(crate) fn in_async_context(
    global: &JSGlobalObject,
    captured: JSValue,
    callback: JSValue,
) -> JsResult<JSValue> {
    captured.call(
        global,
        JSValue::UNDEFINED,
        &[callback.without_async_context()],
    )
}

/// The async context of the innermost `runTest()` or `runSuite()` call that a callback runs inside of.
pub(crate) fn captured_async_context(
    context: Option<JSValue>,
    mut scope: Option<*mut DescribeScope>,
) -> Option<JSValue> {
    if let Some(captured) = context.and_then(test_context::js::async_context_get_cached) {
        return Some(captured);
    }
    while let Some(current) = scope {
        // SAFETY: a scope outlives the callbacks that run in it, and its parents outlive it.
        let current = unsafe { &*current };
        if let Some(captured) = &current.async_context {
            return Some(captured.get());
        }
        scope = current.base.parent;
    }
    None
}
