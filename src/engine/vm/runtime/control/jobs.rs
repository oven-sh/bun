//! What the microtasks do. What one throws is reported as uncaught.

use bun_engine_text::names;

use super::async_context::AsyncContextScope;
use super::async_iteration::run_answer;
use super::microtask::TaskHeader;
use super::promise::is_definitely_not_thenable;
use super::reaction::HandlerContext;
use super::resolving::create_resolving_functions;
use crate::runtime::modules;
use crate::{
    Cx, Gc, InternalFieldTuple, InternalMicrotask, InternalReaction, JsAsyncFromSyncIterator,
    JsAsyncFunctionGenerator, JsAsyncGenerator, JsObject, JsPromise, JsResult, PromiseCombinator,
    PromiseReaction, PromiseStatus, QueuedTask, RealmWatchpoint, Thrown, Value, ValueVec,
};

/// Gets the four arguments of the task.
type Job = fn(&mut Cx, TaskHeader, Value, Value, Value, Value) -> JsResult<()>;

const fn job_for(task: InternalMicrotask) -> Job {
    use InternalMicrotask::*;
    match task {
        CallInAsyncContext | CallWithArguments | PromiseReaction | AsyncFunctionResume => {
            |_, _, _, _, _, _| unreachable!()
        }
        PromiseResolveWithoutHandler => {
            |cx, header, result, value, _, _| settle(cx, result, header.status(), value)
        }
        PromiseResolveThenable => resolve_thenable,
        PromiseResolveNativeThenable => resolve_native_thenable,
        PromiseReactToNativeThenable => react_to_native_thenable,
        PromiseRaceElement => settle_race,
        PromiseAllElement | PromiseAllSettledElement | PromiseAnyElement => {
            |cx, header, combinator, value, index, _| {
                (combinator.cast::<PromiseCombinator>()).did_settle(
                    cx,
                    index,
                    header.status(),
                    value,
                )
            }
        }
        PromiseFinally => call_finally,
        PromiseFinallyFulfill | PromiseFinallyReject => pass_finally,
        AsyncGeneratorResume
        | AsyncGeneratorYield
        | AsyncGeneratorResumeWithReturn
        | AsyncGeneratorAwaitReturn => |cx, header, _, value, generator, async_context| {
            let _scope = AsyncContextScope::enter(cx, async_context);
            let generator = generator.cast::<JsAsyncGenerator>();
            generator.continue_with(cx, header.job(), header.status(), value)
        },
        AsyncIteratorAnswer => run_answer,
        AsyncFromSyncIteratorContinue
        | AsyncFromSyncIteratorContinueOrClose
        | AsyncFromSyncIteratorDone => |cx, header, target, value, iterator, async_context| {
            let _scope = AsyncContextScope::enter(cx, async_context);
            let iterator = iterator.cast::<JsAsyncFromSyncIterator>();
            iterator.continue_with(cx, header.job(), target.cast(), header.status(), value)
        },
        PromiseFulfillWithoutHandler => |cx, header, promise, value, _, _| {
            let promise = promise.cast::<JsPromise>();
            match header.status() {
                PromiseStatus::Rejected => promise.reject_promise(cx, value),
                _ => promise.fulfill_promise(cx, value),
            }
            Ok(())
        },
        _ => |cx, header, cell, value, context, _| {
            modules::run_microtask(cx, header.job(), header.status(), cell, value, context)
        },
    }
}

static JOBS: [Job; InternalMicrotask::ALL.len()] = {
    let mut jobs = [job_for(InternalMicrotask::ALL[0]); _];
    let mut index = 0;
    while index < jobs.len() {
        jobs[index] = job_for(InternalMicrotask::ALL[index]);
        index += 1;
    }
    jobs
};

/// The most common jobs are inlined: the caller has saved the registers that a call of generated code destroys.
#[inline(always)]
pub(super) fn run(cx: &mut Cx, task: QueuedTask) -> JsResult<()> {
    let (header, [a, b, c, d]) = task.into_parts();
    if header.is_call() {
        return call(cx, header, a, b, c, d);
    }
    let [a, b, c, d] = [a, b, c, d].map(Option::unwrap_or_default);
    if header.is(InternalMicrotask::AsyncFunctionResume) {
        let _scope = AsyncContextScope::enter(cx, d);
        return (c.cast::<JsAsyncFunctionGenerator>()).continue_with(cx, header.status(), b);
    }
    if header.is(InternalMicrotask::PromiseReaction) {
        return react(cx, header, a, b, c, d);
    }
    JOBS[header.job() as usize](cx, header, a, b, c, d)
}

#[inline(never)]
pub(super) fn run_out_of_line(cx: &mut Cx, task: &QueuedTask) -> JsResult<()> {
    run(cx, *task)
}

#[inline(always)]
fn react(
    cx: &mut Cx,
    header: TaskHeader,
    first: Value,
    value: Value,
    handler: Value,
    last: Value,
) -> JsResult<()> {
    let kind = HandlerContext::from_payload(header.payload());
    let (result, count, argument, async_context) = match kind {
        HandlerContext::Async => (first, 1, Value::UNDEFINED, last),
        HandlerContext::Argument => (first, 2, last, Value::UNDEFINED),
        HandlerContext::BothWithoutResult => (Value::UNDEFINED, 2, last, first),
        HandlerContext::Both => {
            let both = last.cast::<InternalFieldTuple>();
            (first, 2, both.fields().at(0), both.fields().at(1))
        }
    };
    let _scope = AsyncContextScope::enter(cx, async_context);
    match cx.call_in_job(handler, Value::UNDEFINED, count, [value, argument]) {
        Ok(value) => settle(cx, result, PromiseStatus::Fulfilled, value),
        Err(thrown) => handler_did_throw(cx, result, thrown),
    }
}

#[cold]
#[inline(never)]
fn handler_did_throw(cx: &mut Cx, result: Value, thrown: Thrown) -> JsResult<()> {
    if result.is_undefined_or_null() {
        return Err(thrown);
    }
    let error = cx.catch_value(thrown)?;
    settle(cx, result, PromiseStatus::Rejected, error)
}

/// `target` is as the `result` of `perform_then`.
#[inline(always)]
fn settle(cx: &mut Cx, target: Value, status: PromiseStatus, value: Value) -> JsResult<()> {
    let Some(promise) = target.downcast::<JsPromise>() else {
        return match target.as_object() {
            Some(capability) => settle_capability(cx, capability, status, value),
            None => Ok(()),
        };
    };
    if status == PromiseStatus::Rejected {
        promise.reject_promise(cx, value);
    } else if let Some(object) = value.as_object() {
        return promise.resolve_with_object(cx.in_realm_of(&promise), object);
    } else {
        promise.fulfill_promise(cx, value);
    }
    Ok(())
}

#[inline(never)]
fn settle_out_of_line(
    cx: &mut Cx,
    target: Value,
    status: PromiseStatus,
    value: Value,
) -> JsResult<()> {
    settle(cx, target, status, value)
}

#[inline(never)]
fn settle_capability(
    cx: &mut Cx,
    capability: Gc<JsObject>,
    status: PromiseStatus,
    value: Value,
) -> JsResult<()> {
    let name = match status {
        PromiseStatus::Rejected => names::reject,
        _ => names::resolve,
    };
    let function = capability.get(cx, name)?;
    cx.call(function, Value::UNDEFINED, &[value]).map(drop)
}

fn settle_race(
    cx: &mut Cx,
    header: TaskHeader,
    promise: Value,
    value: Value,
    _: Value,
    _: Value,
) -> JsResult<()> {
    if !promise.cast::<JsPromise>().mark_as_resolved() {
        return Ok(());
    }
    settle_out_of_line(cx, promise, header.status(), value)
}

/// `call_then` gets the resolving functions.
#[inline(always)]
fn follow(
    cx: &mut Cx,
    target: Value,
    call_then: impl FnOnce(&mut Cx, [Value; 2]) -> JsResult<()>,
) -> JsResult<()> {
    let functions = create_resolving_functions(cx, target);
    if let Err(thrown) = call_then(cx, functions) {
        let error = cx.catch_value(thrown)?;
        cx.call(functions[1], Value::UNDEFINED, &[error])?;
    }
    Ok(())
}

fn resolve_thenable(
    cx: &mut Cx,
    _: TaskHeader,
    thenable: Value,
    then: Value,
    target: Value,
    async_context: Value,
) -> JsResult<()> {
    let _scope = AsyncContextScope::enter(cx, async_context);
    follow_thenable(cx, thenable, then, target)
}

fn follow_thenable(cx: &mut Cx, thenable: Value, then: Value, target: Value) -> JsResult<()> {
    follow(cx, target, |cx, functions| {
        cx.call_in_job(then, thenable, 2, functions).map(drop)
    })
}

#[inline(never)]
fn follow_with_species(
    cx: &mut Cx,
    promise: Gc<JsPromise>,
    target: Value,
    async_context: Value,
) -> JsResult<()> {
    let _scope = AsyncContextScope::enter(cx, async_context);
    follow(cx, target, |cx, [resolve, reject]| {
        promise.then_with_species(cx, resolve, reject).map(drop)
    })
}

fn resolve_native_thenable(
    cx: &mut Cx,
    _: TaskHeader,
    promise: Value,
    target: Value,
    async_context: Value,
    is_unobserved: Value,
) -> JsResult<()> {
    let promise = promise.cast::<JsPromise>();
    if !is_unobserved.is_true() && !promise.has_pristine_species(cx) {
        return follow_with_species(cx, promise, target, async_context);
    }
    let task = InternalMicrotask::PromiseResolveWithoutHandler;
    let reaction = InternalReaction::new(task, target.as_cell(), Value::UNDEFINED);
    promise.react(cx, reaction);
    Ok(())
}

fn react_to_native_thenable(
    cx: &mut Cx,
    header: TaskHeader,
    cell: Value,
    promise: Value,
    context: Value,
    async_context: Value,
) -> JsResult<()> {
    let promise = promise.cast::<JsPromise>();
    let reaction = InternalReaction {
        task: InternalMicrotask::from_bits(header.payload()),
        cell,
        context,
        async_context,
    };
    if !promise.has_pristine_species(cx) {
        let target = PromiseReaction::internal(cx, reaction, None);
        return follow_with_species(cx, promise, target.into(), async_context);
    }
    // It takes a turn to settle the promise that the reaction is to.
    let follower = JsPromise::new(cx);
    follower.react(cx, reaction);
    let task = InternalMicrotask::PromiseResolveWithoutHandler;
    let resolves = InternalReaction::new(task, Some(follower.cell()), Value::UNDEFINED);
    promise.react(cx, resolves);
    Ok(())
}

fn call_finally(
    cx: &mut Cx,
    header: TaskHeader,
    result: Value,
    value: Value,
    on_finally: Value,
    async_context: Value,
) -> JsResult<()> {
    let _scope = AsyncContextScope::enter(cx, async_context);
    let cx = cx.in_realm_of(&result.cast::<JsPromise>());
    let (status, nothing) = (header.status(), Value::UNDEFINED);
    let returned = match cx.call_in_job(on_finally, nothing, 0, [nothing; 2]) {
        Ok(returned) => returned,
        Err(thrown) => return handler_did_throw(cx, result, thrown),
    };
    let task = match status {
        PromiseStatus::Rejected => InternalMicrotask::PromiseFinallyReject,
        _ => InternalMicrotask::PromiseFinallyFulfill,
    };
    let reaction = InternalReaction::new(task, result.as_cell(), value);
    let global = cx.global();
    if global.holds(cx, RealmWatchpoint::PromiseThen)
        && global.holds(cx, RealmWatchpoint::PromiseSpecies)
    {
        match returned.downcast::<JsPromise>() {
            None if is_never_followed(returned) => {
                reaction.queue(cx, &global, PromiseStatus::Fulfilled, returned);
                return Ok(());
            }
            Some(promise)
                if promise.has_pristine_then_in(cx) && promise.has_pristine_species_in(cx) =>
            {
                promise.react(cx, reaction);
                return Ok(());
            }
            _ => {}
        }
    }
    let constructor = cx.promise_constructor();
    match JsPromise::pass_on_after(cx, constructor, returned, status, value) {
        Ok(promise) => settle_out_of_line(cx, result, PromiseStatus::Fulfilled, promise),
        Err(thrown) => handler_did_throw(cx, result, thrown),
    }
}

fn is_never_followed(value: Value) -> bool {
    (value.as_object()).is_none_or(|object| is_definitely_not_thenable(&object))
}

/// Settles the promise that thenFinally or catchFinally would have returned, which `result` follows.
fn pass_finally(
    cx: &mut Cx,
    header: TaskHeader,
    result: Value,
    value: Value,
    original: Value,
    _: Value,
) -> JsResult<()> {
    let (status, value) = match (header.status(), header.job()) {
        (PromiseStatus::Rejected, _) => (PromiseStatus::Rejected, value),
        (_, InternalMicrotask::PromiseFinallyReject) => (PromiseStatus::Rejected, original),
        _ => (PromiseStatus::Fulfilled, original),
    };
    let task = InternalMicrotask::PromiseResolveWithoutHandler;
    let reaction = InternalReaction::new(task, result.as_cell(), Value::UNDEFINED);
    if status == PromiseStatus::Rejected || is_never_followed(value) {
        reaction.queue(cx, &cx.global(), status, value);
        return Ok(());
    }
    let promise = JsPromise::new(cx);
    promise.resolve_promise(cx, value)?;
    promise.react(cx, reaction);
    Ok(())
}

#[inline(never)]
fn call(
    cx: &mut Cx,
    header: TaskHeader,
    function: Option<Value>,
    a: Option<Value>,
    b: Option<Value>,
    c: Option<Value>,
) -> JsResult<()> {
    let function = function.unwrap_or_default();
    if header.is(InternalMicrotask::CallInAsyncContext) {
        return call_in_async_context(cx, function, a.unwrap_or_default(), b, c);
    }
    let mut arguments = ValueVec::new();
    ([a, b, c].into_iter().flatten()).for_each(|argument| arguments.push(argument));
    cx.call(function, Value::UNDEFINED, &arguments).map(drop)
}

#[inline(always)]
fn call_in_async_context(
    cx: &mut Cx,
    function: Value,
    async_context: Value,
    first: Option<Value>,
    second: Option<Value>,
) -> JsResult<()> {
    if !function.is_callable() {
        return Ok(());
    }
    let count = match second {
        Some(_) => 2,
        None => first.is_some().into(),
    };
    let arguments = [first, second].map(Option::unwrap_or_default);
    let scope = AsyncContextScope::enter(cx, async_context);
    let result = cx.call_in_job(function, Value::UNDEFINED, count, arguments);
    drop(scope);
    match (result, cx.embedder().microtasks.report_error.get()) {
        (Err(thrown), Some(report)) => {
            let exception = cx.catch(thrown)?;
            report(cx, exception);
            cx.check_exception()
        }
        (result, _) => result.map(drop),
    }
}
