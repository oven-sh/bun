//! `for await` and `yield*` in an async generator. If nothing can tell the difference, the iterator answers the code
//! that asks for the next result directly, in the tick in which the promise for it would have.

use bun_engine_macros::cell;
use bun_engine_text::{names, symbols};

use super::async_context::AsyncContextScope;
use super::microtask::TaskHeader;
use crate::{
    Coroutine, CoroutineState, Cx, Field, Gc, ITERATOR_RESULT_DONE_OFFSET,
    ITERATOR_RESULT_VALUE_OFFSET, InternalMicrotask, InternalReaction, IterationMode,
    IteratorRecord, JsAsyncFunctionGenerator, JsAsyncGenerator, JsObject, JsObjectInit, JsPromise,
    JsResult, PromiseStatus, QueuedTask, RealmWatchpoint, Value, Vm, errors, iterator_complete,
    iterator_value,
};

/// In the payload of an `AsyncIteratorAnswer`.
const IS_DONE: u8 = 1 << 2;

/// In place of the promise that `next` would return.
pub const REQUESTED_STEP: Value = IterationMode::AsyncGenerator.marker();

pub struct AsyncIteratorRecord {
    pub iterator: Gc<JsObject>,
    /// Its marker stands in for `next`.
    pub mode: IterationMode,
}

/// `method` is `iterable[Symbol.asyncIterator]`. `None` if it has to be called.
pub fn open_async_iterator(
    cx: &mut Cx,
    iterable: Value,
    method: Value,
) -> JsResult<Option<AsyncIteratorRecord>> {
    if method.is_undefined_or_null() {
        let mode = IterationMode::AsyncFromSync;
        return Ok(Some(AsyncIteratorRecord {
            iterator: JsAsyncFromSyncIterator::for_iterable(cx, iterable)?.upcast(),
            mode,
        }));
    }
    if let Some(generator) = iterable.downcast::<JsAsyncGenerator>()
        && method == cx.async_iterator_prototype_async_iterator().into()
        && generator.get_pure(cx, names::next) == Some(cx.async_generator_prototype_next().into())
    {
        let mode = IterationMode::AsyncGenerator;
        return Ok(Some(AsyncIteratorRecord {
            iterator: generator.upcast(),
            mode,
        }));
    }
    Ok(None)
}

/// What `asker` has to await. Fails only if execution is terminated.
#[inline]
pub fn request_async_step(
    cx: &mut Cx,
    iterator: Value,
    asker: Gc<Coroutine>,
    value: Option<Value>,
) -> JsResult<Value> {
    // Awaiting a promise reads its `constructor`.
    let (target, awaited) = if cx.holds(RealmWatchpoint::PromiseSpecies) {
        (asker.upcast(), REQUESTED_STEP)
    } else {
        let promise = JsPromise::new(cx);
        (promise.upcast(), promise.into())
    };
    match iterator.downcast::<JsAsyncGenerator>() {
        Some(generator) => generator.request(cx, target, value.unwrap_or_default())?,
        None => (iterator.cast::<JsAsyncFromSyncIterator>()).request(cx, target, value)?,
    }
    Ok(awaited)
}

/// In the realm of the iterator. The one who asks reads the result at once and does not pass it on, so one object does
/// for all steps. Returns that.
#[inline(always)]
pub(super) fn answer(
    cx: &mut Cx,
    asker: Gc<JsObject>,
    value: Value,
    done: bool,
    reusable: Option<Gc<JsObject>>,
    async_context: Value,
) -> JsResult<Option<Gc<JsObject>>> {
    let task = InternalMicrotask::AsyncIteratorAnswer;
    if !cx.holds(RealmWatchpoint::PromiseThen) {
        return answer_observably(cx, asker, value, done, async_context).map(|()| None);
    }
    let result = reusable.unwrap_or_else(|| new_reusable_result(cx));
    let payload = PromiseStatus::Fulfilled as u8 | if done { IS_DONE } else { 0 };
    let arguments = [result.into(), value, asker.into(), async_context];
    cx.global().queue_microtask(cx, task, payload, arguments);
    Ok(Some(result))
}

#[inline(never)]
fn answer_observably(
    cx: &mut Cx,
    asker: Gc<JsObject>,
    value: Value,
    done: bool,
    async_context: Value,
) -> JsResult<()> {
    let result = cx.new_iterator_result(value, done);
    InternalReaction::new(InternalMicrotask::AsyncIteratorAnswer, None, asker.into())
        .in_async_context(async_context)
        .resolve(cx, result.into())
}

#[inline(never)]
fn new_reusable_result(cx: &Cx) -> Gc<JsObject> {
    let result = cx.new_iterator_result(Value::UNDEFINED, false);
    for offset in [ITERATOR_RESULT_VALUE_OFFSET, ITERATOR_RESULT_DONE_OFFSET] {
        result.shape().did_cache_property_replacement(cx, offset);
    }
    result
}

#[inline(never)]
pub(super) fn answer_with_error(cx: &Cx, asker: Gc<JsObject>, error: Value) {
    InternalReaction::new(InternalMicrotask::AsyncIteratorAnswer, None, asker.into())
        .in_current_async_context(cx)
        .queue(cx, &cx.global(), PromiseStatus::Rejected, error);
}

pub(super) fn run_answer(
    cx: &mut Cx,
    header: TaskHeader,
    result: Value,
    value: Value,
    asker: Value,
    async_context: Value,
) -> JsResult<()> {
    if asker.cast::<Coroutine>().state() != CoroutineState::SuspendedAwait {
        // The iterator has drained the microtasks before it returned to the one who asked.
        let arguments = [result, value, asker, async_context].map(Some);
        let answers = &cx.services.control.early_answers;
        answers.enqueue(QueuedTask::from_parts(header, arguments));
        return Ok(());
    }
    let _scope = AsyncContextScope::enter(cx, async_context);
    let value = match result.as_object() {
        Some(object) => {
            let done = Value::from(header.payload() & IS_DONE != 0);
            debug_assert!(object.shape().is_valid_offset(ITERATOR_RESULT_DONE_OFFSET));
            // SAFETY: from `new_reusable_result`, and nothing has changed its shape.
            unsafe {
                object.put_direct_unchecked(ITERATOR_RESULT_VALUE_OFFSET, value);
                object.put_direct_unchecked(ITERATOR_RESULT_DONE_OFFSET, done);
            }
            result
        }
        None => value,
    };
    match asker.downcast::<JsAsyncFunctionGenerator>() {
        Some(function) => function.continue_with(cx, header.status(), value),
        None => {
            let generator = asker.cast::<JsAsyncGenerator>();
            generator.continue_with(cx, header.job(), header.status(), value)
        }
    }
}

#[inline(always)]
pub(super) fn has_early_answers(vm: &Vm) -> bool {
    !vm.services.control.early_answers.is_empty()
}

#[inline(always)]
pub(super) fn requeue_early_answer(vm: &Vm, asker: &Coroutine) {
    if has_early_answers(vm) {
        requeue_early_answer_slow(vm, asker);
    }
}

#[cold]
#[inline(never)]
fn requeue_early_answer_slow(vm: &Vm, asker: &Coroutine) {
    let answers = &vm.services.control.early_answers;
    for task in (0..answers.len()).map_while(|_| answers.dequeue()) {
        if task.context() == asker.into() {
            task.queue(vm, &task.global());
        } else {
            answers.enqueue(task);
        }
    }
}

/// Scripts never see it.
#[cell(name = "AsyncFromSyncIterator", cell_type = AsyncFromSyncIterator,
    export = "engine_class_AsyncFromSyncIterator")]
pub struct JsAsyncFromSyncIterator {
    base: JsObject,
    sync_iterator: Gc<JsObject>,
    /// Or the marker of an `IterationMode`.
    next_method: Value,
    pub(self) reusable_result: Field<Option<Gc<JsObject>>>,
}

struct Step {
    value: Value,
    done: bool,
}

impl JsAsyncFromSyncIterator {
    /// `next_method` has been read from the iterator.
    pub fn create(cx: &Cx, sync_iterator: Gc<JsObject>, next_method: Value) -> Gc<Self> {
        assert!(!IterationMode::is_marker(next_method));
        Self::allocate(cx, sync_iterator, next_method)
    }

    fn allocate(cx: &Cx, sync_iterator: Gc<JsObject>, next_method: Value) -> Gc<Self> {
        cx.allocate::<JsAsyncFromSyncIterator>(JsAsyncFromSyncIteratorInit {
            base: JsObjectInit::new(cx, cx.async_from_sync_iterator_shape()),
            sync_iterator,
            next_method,
            reusable_result: None,
        })
    }

    /// CreateAsyncFromSyncIterator(GetIteratorDirect(iterator))
    pub fn for_iterator(cx: &mut Cx, iterator: Gc<JsObject>) -> JsResult<Gc<Self>> {
        let [_, next_method, _] = IteratorRecord::direct(cx, iterator.into())?.parts();
        Ok(Self::allocate(cx, iterator, next_method))
    }

    /// CreateAsyncFromSyncIterator(GetIterator(iterable, sync))
    pub fn for_iterable(cx: &mut Cx, iterable: Value) -> JsResult<Gc<Self>> {
        let method = iterable.get(cx, symbols::iterator)?;
        if !method.is_callable() {
            return Err(cx.throw_type_error("iterable should have an iterator symbol"));
        }
        let iterator = match IteratorRecord::open(cx, iterable, method)? {
            Some(record) => record.iterator(cx),
            None => cx.call(method, iterable, &[])?,
        };
        match iterator.as_object() {
            Some(iterator) => Self::for_iterator(cx, iterator),
            None => Err(cx.throw_type_error("iterator method should return an object")),
        }
    }

    fn call_method(&self, cx: &mut Cx, method: Value, argument: Option<Value>) -> JsResult<Step> {
        if !method.is_callable() {
            return Err(cx.throw_type_error("Iterator method is not callable."));
        }
        let result = cx.call(method, self.sync_iterator.into(), argument.as_slice())?;
        let Some(result) = result.as_object() else {
            return Err(cx.throw_type_error(errors::ITERATOR_RESULT_NOT_OBJECT));
        };
        Ok(Step {
            done: iterator_complete(cx, &result)?,
            value: iterator_value(cx, &result)?,
        })
    }

    #[inline]
    fn step(&self, cx: &mut Cx, argument: Option<Value>) -> JsResult<Step> {
        if !IterationMode::is_marker(self.next_method) {
            return self.call_method(cx, self.next_method, argument);
        }
        let iterator = self.sync_iterator.into();
        // SAFETY: those of the record in `for_iterator`, in a mode in which the iterator has the position.
        let mut record = unsafe {
            IteratorRecord::from_parts([IteratorRecord::START, self.next_method, iterator])
        };
        let value = record.step_builtin(cx)?;
        Ok(Step {
            done: value.is_none(),
            value: value.unwrap_or_default(),
        })
    }

    /// AsyncFromSyncIteratorContinuation. `unless_done` is the task for a step that is not the last.
    fn await_step(
        &self,
        cx: &mut Cx,
        target: Gc<JsObject>,
        step: JsResult<Step>,
        unless_done: InternalMicrotask,
    ) -> JsResult<()> {
        let Step { value, done } = match step {
            Ok(step) => step,
            Err(thrown) => {
                reject_target(cx, target, cx.catch_value(thrown)?);
                return Ok(());
            }
        };
        let task = if done {
            InternalMicrotask::AsyncFromSyncIteratorDone
        } else {
            unless_done
        };
        let reaction = InternalReaction::new(task, Some(target.cell()), self.into());
        match reaction.in_current_async_context(cx).await_value(cx, value) {
            Ok(()) => Ok(()),
            Err(thrown) => {
                let error = cx.catch_value(thrown)?;
                self.continue_with(cx, task, target, PromiseStatus::Rejected, error)
            }
        }
    }

    /// The value of a step has settled.
    #[inline(never)]
    pub(super) fn continue_with(
        &self,
        cx: &mut Cx,
        task: InternalMicrotask,
        target: Gc<JsObject>,
        status: PromiseStatus,
        value: Value,
    ) -> JsResult<()> {
        let cx = cx.in_realm_of(self);
        if status == PromiseStatus::Rejected {
            if task == InternalMicrotask::AsyncFromSyncIteratorContinueOrClose
                && let Err(thrown) = self.close(cx)
            {
                cx.catch(thrown)?;
            }
            reject_target(cx, target, value);
            return Ok(());
        }
        let done = task == InternalMicrotask::AsyncFromSyncIteratorDone;
        if let Some(promise) = target.downcast::<JsPromise>() {
            let result = cx.new_iterator_result(value, done);
            return promise.resolve(cx, result.into());
        }
        let (reusable, context) = (self.reusable_result(), cx.current_async_context());
        let result = answer(cx, target, value, done, reusable, context)?;
        if result != reusable {
            self.set_reusable_result(result);
        }
        Ok(())
    }

    /// IteratorClose
    fn close(&self, cx: &mut Cx) -> JsResult<()> {
        let (iterator, message) = (
            self.sync_iterator.as_value(),
            "Iterator return method is not callable.",
        );
        if let Some(method) = iterator.get_method(cx, names::r#return, message)?
            && !cx.call(method, iterator, &[])?.is_object()
        {
            return Err(cx.throw_type_error(errors::ITERATOR_RESULT_NOT_OBJECT));
        }
        Ok(())
    }

    /// `next`, for a promise or a `Coroutine`.
    fn request(&self, cx: &mut Cx, target: Gc<JsObject>, value: Option<Value>) -> JsResult<()> {
        let step = self.step(cx, value);
        let task = InternalMicrotask::AsyncFromSyncIteratorContinueOrClose;
        self.await_step(cx, target, step, task)
    }

    // The methods of the prototype. They fail only if execution is terminated.

    pub fn next(&self, cx: &mut Cx, value: Option<Value>) -> JsResult<Gc<JsPromise>> {
        let promise = JsPromise::new(cx);
        self.request(cx, promise.upcast(), value)?;
        Ok(promise)
    }

    pub fn r#return(&self, cx: &mut Cx, value: Option<Value>) -> JsResult<Gc<JsPromise>> {
        let step = match self.sync_iterator.get(cx, names::r#return) {
            Ok(method) if method.is_undefined_or_null() => {
                let result = cx.new_iterator_result(value.unwrap_or_default(), true);
                return JsPromise::new_resolved(cx, result.into());
            }
            method => method.and_then(|method| self.call_method(cx, method, value)),
        };
        let promise = JsPromise::new(cx);
        let task = InternalMicrotask::AsyncFromSyncIteratorContinue;
        self.await_step(cx, promise.upcast(), step, task)?;
        Ok(promise)
    }

    pub fn throw(&self, cx: &mut Cx, value: Option<Value>) -> JsResult<Gc<JsPromise>> {
        let step = match self.sync_iterator.get(cx, names::throw) {
            Ok(method) if method.is_undefined_or_null() => self.close(cx).and_then(|()| {
                Err(cx.throw_type_error("Iterator does not provide a throw method."))
            }),
            method => method.and_then(|method| self.call_method(cx, method, value)),
        };
        let promise = JsPromise::new(cx);
        let task = InternalMicrotask::AsyncFromSyncIteratorContinueOrClose;
        self.await_step(cx, promise.upcast(), step, task)?;
        Ok(promise)
    }
}

fn reject_target(cx: &Cx, target: Gc<JsObject>, reason: Value) {
    match target.downcast::<JsPromise>() {
        Some(promise) => promise.reject(cx, reason),
        None => answer_with_error(cx, target, reason),
    }
}
