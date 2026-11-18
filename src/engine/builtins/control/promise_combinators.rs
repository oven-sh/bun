//! `Promise.all`, `allSettled`, `any` and `race`.

use bun_engine_vm::InternalMicrotask::{
    self, PromiseAllElement, PromiseAllSettledElement, PromiseAnyElement, PromiseRaceElement,
};
use bun_engine_vm::{
    InternalReaction, JsArray, JsPromise, PromiseCapability, PromiseCombinator, PromiseStatus,
    RealmWatchpoint, for_each_in_iterable, is_definitely_not_thenable,
};

use super::promise_constructor::this_object;
use crate::prelude::*;

#[native_abi]
pub(super) fn all(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    combine(cx, frame, PromiseAllElement)
}

#[native_abi]
pub(super) fn all_settled(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    combine(cx, frame, PromiseAllSettledElement)
}

#[native_abi]
pub(super) fn any(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    combine(cx, frame, PromiseAnyElement)
}

#[native_abi]
pub(super) fn race(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    combine(cx, frame, PromiseRaceElement)
}

fn combine(cx: &mut Cx, frame: &CallFrame, task: InternalMicrotask) -> JsResult<Value> {
    let (constructor, iterable) = (this_object(cx, frame)?, frame.argument(0));
    if constructor == cx.promise_constructor() && cx.holds(RealmWatchpoint::PromiseResolve) {
        let promise = JsPromise::new(cx);
        if let Err(thrown) = add_to_promise(cx, task, promise, iterable) {
            promise.reject_with_caught(cx, thrown)?;
        }
        return Ok(promise.into());
    }
    let capability = PromiseCapability::new(cx, constructor.into())?;
    if let Err(thrown) = add_to_capability(cx, task, constructor.into(), capability, iterable) {
        let error = cx.catch_value(thrown)?;
        cx.call(capability.reject.into(), Value::UNDEFINED, &[error])?;
    }
    Ok(capability.promise.into())
}

/// `race` has nothing to collect.
fn create_combinator(
    cx: &Cx,
    task: InternalMicrotask,
    target: Gc<JsObject>,
    iterable: Value,
) -> JsResult<Option<Gc<PromiseCombinator>>> {
    if task == PromiseRaceElement {
        return Ok(None);
    }
    let capacity = (iterable.downcast::<JsArray>()).map_or(0, |array| array.vector_length());
    PromiseCombinator::create(cx, task, target, capacity as usize).map(Some)
}

/// `pass_on` makes the function that settles the result right away.
#[inline(never)]
fn invoke_then(
    cx: &mut Cx,
    task: InternalMicrotask,
    promise: Value,
    element: Option<(Gc<PromiseCombinator>, Value)>,
    mut pass_on: impl FnMut(&Cx, PromiseStatus) -> Value,
) -> JsResult<()> {
    let handlers = [PromiseStatus::Fulfilled, PromiseStatus::Rejected].map(|status| {
        match (element, task, status) {
            (None, ..)
            | (_, PromiseAllElement, PromiseStatus::Rejected)
            | (_, PromiseAnyElement, PromiseStatus::Fulfilled) => pass_on(cx, status),
            (Some((combinator, index)), ..) => {
                combinator.create_element_function(cx, index, status)
            }
        }
    });
    let then = promise.get(cx, names::then)?;
    if !then.is_callable() {
        return Err(cx.throw_type_error("then is not a function"));
    }
    cx.call(then, promise, &handlers).map(drop)
}

#[inline(always)]
fn add_element(
    cx: &mut Cx,
    combinator: Option<Gc<PromiseCombinator>>,
) -> JsResult<Option<(Gc<PromiseCombinator>, Value)>> {
    combinator
        .map(|combinator| Ok((combinator, combinator.add_element(cx)?)))
        .transpose()
}

/// The constructor and its `resolve` are the original ones.
fn add_to_promise(
    cx: &mut Cx,
    task: InternalMicrotask,
    promise: Gc<JsPromise>,
    iterable: Value,
) -> JsResult<()> {
    let combinator = create_combinator(cx, task, promise.upcast(), iterable)?;
    let (mut resolve, mut reject) = (None, None);
    for_each_in_iterable(cx, iterable, |cx, value| {
        let element = add_element(cx, combinator)?;
        let reaction = match element {
            Some((combinator, index)) => {
                InternalReaction::new(task, Some(combinator.cell()), index)
            }
            None => InternalReaction::new(task, Some(promise.cell()), promise.into()),
        };
        let (global, then, species) = (
            cx.global(),
            RealmWatchpoint::PromiseThen,
            RealmWatchpoint::PromiseSpecies,
        );
        if let Some(next) = value.downcast::<JsPromise>() {
            if next.is_plain_in(&global, then) && next.is_plain_in(&global, species) {
                next.react(cx, reaction);
                return Ok(());
            }
        } else if (value.as_object()).is_none_or(|object| is_definitely_not_thenable(&object))
            && cx.holds(then)
            && cx.holds(species)
        {
            reaction.queue(cx, &global, PromiseStatus::Fulfilled, value);
            return Ok(());
        }
        let next = JsPromise::resolved(cx, value)?;
        if next.has_pristine_then(cx)
            && JsPromise::species_constructor(cx, &next)? == cx.promise_constructor()
        {
            next.react(cx, reaction);
            return Ok(());
        }
        invoke_then(cx, task, next.into(), element, |cx, status| match status {
            PromiseStatus::Rejected => {
                *reject.get_or_insert_with(|| promise.create_reject_function(cx).into())
            }
            _ => *resolve.get_or_insert_with(|| promise.create_resolve_function(cx).into()),
        })
    })?;
    combinator.map_or(Ok(()), |it| it.did_add_elements(cx))
}

fn add_to_capability(
    cx: &mut Cx,
    task: InternalMicrotask,
    constructor: Value,
    capability: PromiseCapability,
    iterable: Value,
) -> JsResult<()> {
    let promise_resolve = constructor.get(cx, names::resolve)?;
    if !promise_resolve.is_callable() {
        return Err(cx.throw_type_error("Promise resolve is not a function"));
    }
    let target = match task {
        PromiseAnyElement => capability.reject,
        _ => capability.resolve,
    };
    let combinator = create_combinator(cx, task, target, iterable)?;
    for_each_in_iterable(cx, iterable, |cx, value| {
        let element = add_element(cx, combinator)?;
        let next = cx.call(promise_resolve, constructor, &[value])?;
        invoke_then(cx, task, next, element, |_, status| match status {
            PromiseStatus::Rejected => capability.reject.into(),
            _ => capability.resolve.into(),
        })
    })?;
    combinator.map_or(Ok(()), |it| it.did_add_elements(cx))
}
