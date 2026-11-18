use core::mem::offset_of;

use bun_engine_bytecode::ResumeMode;
use bun_engine_macros::cell;

use super::async_function::resume_mode_for;
use super::async_iteration::{REQUESTED_STEP, answer, answer_with_error, requeue_early_answer};
use super::tagged_field::TaggedField;
use crate::{
    CallFrame, Coroutine, CoroutineState, Cx, Field, Gc, InternalMicrotask, InternalReaction,
    JsCell, JsObject, JsPromise, JsResult, PromiseStatus, Value, Vm,
};

/// `SuspendedAwait` counts as executing: a request has to wait.
#[cell(name = "AsyncGenerator", cell_type = AsyncGenerator)]
pub struct JsAsyncGenerator {
    base: Coroutine,
    /// Of the first request: the promise to settle or the `Coroutine` to answer, and the `ResumeMode`.
    first_target: TaggedField<JsObject>,
    pub(self) first_value: Field<Value>,
    /// Of the others, which form a ring.
    pub(self) last_request: Field<Option<Gc<AsyncGeneratorRequest>>>,
    pub(self) reusable_result: Field<Option<Gc<JsObject>>>,
}

#[cell]
struct AsyncGeneratorRequest {
    base: JsCell,
    target: TaggedField<JsObject>,
    value: Value,
    next: Field<Option<Gc<AsyncGeneratorRequest>>>,
}

#[derive(Clone, Copy)]
struct Completion {
    mode: ResumeMode,
    value: Value,
}

impl JsAsyncGenerator {
    /// What comes after the `Coroutine` in a new one.
    pub const INITIAL_FIELDS: [(usize, Option<Value>); 4] = [
        (offset_of!(Self, first_target), None),
        (offset_of!(Self, first_value), Some(Value::UNDEFINED)),
        (offset_of!(Self, last_request), None),
        (offset_of!(Self, reusable_result), None),
    ];

    #[inline]
    pub fn for_frame(cx: &mut Cx, frame: &CallFrame) -> JsResult<Gc<JsAsyncGenerator>> {
        let shape = Coroutine::shape_for_frame::<Self>(cx, frame, Cx::async_generator_shape)?;
        let init = JsAsyncGeneratorInit {
            base: Coroutine::init::<Self>(shape, frame),
            first_target: TaggedField::new(0),
            first_value: Value::UNDEFINED,
            last_request: None,
            reusable_result: None,
        };
        Coroutine::allocate(cx, frame, init)
    }

    // The queue

    fn set_first_request(&self, target: Option<Gc<JsObject>>, mode: u16, value: Value) {
        // SAFETY: a field of this cell.
        unsafe { self.first_target.set(self, target, mode) };
        self.set_first_value(value);
    }

    /// AsyncGeneratorEnqueue
    #[inline]
    fn enqueue(&self, vm: &Vm, target: Gc<JsObject>, mode: ResumeMode, value: Value) {
        if self.first_target.cell().is_none() {
            return self.set_first_request(Some(target), mode as u16, value);
        }
        let last = self.last_request();
        let request = vm.allocate::<AsyncGeneratorRequest>(AsyncGeneratorRequestInit {
            base: vm.shape_for::<AsyncGeneratorRequest>(),
            target: TaggedField::new(0),
            value,
            next: last.and_then(|it| it.next()),
        });
        // SAFETY: a new cell.
        unsafe { (request.target).set_without_barrier(Some(target), mode as u16) };
        last.unwrap_or(request).set_next(Some(request));
        self.set_last_request(Some(request));
    }

    #[inline]
    fn dequeue(&self) -> Gc<JsObject> {
        let target = self.first_target.cell().expect("a request");
        match self.last_request().and_then(|it| Some((it, it.next()?))) {
            None => {
                self.first_target.clear(0);
                self.set_first_value(Value::UNDEFINED);
            }
            Some((last, second)) => {
                self.set_first_request(second.target.cell(), second.target.tag(), second.value);
                last.set_next(second.next());
                self.set_last_request((second != last).then_some(last));
            }
        }
        target
    }

    #[inline]
    fn first_request(&self) -> Option<Completion> {
        self.first_target.cell()?;
        let modes = [ResumeMode::Normal, ResumeMode::Return, ResumeMode::Throw];
        Some(Completion {
            mode: modes[usize::from(self.first_target.tag())],
            value: self.first_value(),
        })
    }

    // The methods of the prototype. All that follow fail only if execution is terminated.

    pub fn next(&self, cx: &mut Cx, value: Value) -> JsResult<Gc<JsPromise>> {
        let promise = JsPromise::new(cx);
        self.request(cx, promise.upcast(), value)?;
        Ok(promise)
    }

    /// `next`, for a promise or a `Coroutine`.
    #[inline]
    pub(super) fn request(&self, cx: &mut Cx, target: Gc<JsObject>, value: Value) -> JsResult<()> {
        let state = self.state();
        if state == CoroutineState::Completed {
            return self.deliver(cx, target, Value::UNDEFINED, true);
        }
        self.enqueue(cx, target, ResumeMode::Normal, value);
        if let CoroutineState::SuspendedStart | CoroutineState::SuspendedYield = state {
            self.run(cx, ResumeMode::Normal, value)?;
        }
        Ok(())
    }

    pub fn r#return(&self, cx: &mut Cx, value: Value) -> JsResult<Gc<JsPromise>> {
        let promise = JsPromise::new(cx);
        self.enqueue(cx, promise.upcast(), ResumeMode::Return, value);
        match self.state() {
            CoroutineState::SuspendedStart | CoroutineState::Completed => {
                self.complete();
                self.set_state(CoroutineState::DrainingQueue);
                self.drain_queue(cx)?;
            }
            CoroutineState::SuspendedYield => self.run_with_first_request(cx)?,
            _ => {}
        }
        Ok(promise)
    }

    pub fn throw(&self, cx: &mut Cx, exception: Value) -> JsResult<Gc<JsPromise>> {
        let promise = JsPromise::new(cx);
        let state = self.state();
        if let CoroutineState::SuspendedStart | CoroutineState::Completed = state {
            self.complete();
            promise.reject(cx, exception);
            return Ok(promise);
        }
        self.enqueue(cx, promise.upcast(), ResumeMode::Throw, exception);
        if state == CoroutineState::SuspendedYield {
            self.run(cx, ResumeMode::Throw, exception)?;
        }
        Ok(promise)
    }

    // Steps

    /// The iterator result belongs to the realm of the generator.
    fn deliver(&self, cx: &mut Cx, target: Gc<JsObject>, value: Value, done: bool) -> JsResult<()> {
        if let Some(promise) = target.downcast::<JsPromise>() {
            let result = cx.in_realm_of(self).new_iterator_result(value, done);
            return promise.resolve(cx, result.into());
        }
        let context = cx.current_async_context();
        let reusable = self.reusable_result();
        let cx = cx.in_realm_of(self);
        let result = answer(cx, target, value, done, reusable, context)?;
        if result != reusable {
            self.set_reusable_result(result);
        }
        Ok(())
    }

    /// AsyncGeneratorCompleteStep
    fn complete_step(
        &self,
        cx: &mut Cx,
        status: PromiseStatus,
        value: Value,
        done: bool,
    ) -> JsResult<()> {
        let target = self.dequeue();
        if status != PromiseStatus::Rejected {
            return self.deliver(cx, target, value, done);
        }
        match target.downcast::<JsPromise>() {
            Some(promise) => promise.reject(cx, value),
            None => answer_with_error(cx, target, value),
        }
        Ok(())
    }

    /// The exception, if `value` cannot be awaited.
    #[inline(always)]
    fn await_for(
        &self,
        cx: &mut Cx,
        task: InternalMicrotask,
        value: Value,
    ) -> JsResult<Option<Value>> {
        let reaction = InternalReaction::new(task, None, self.into()).in_current_async_context(cx);
        match reaction.await_value(cx, value) {
            Ok(()) => Ok(None),
            Err(thrown) => cx.catch_value(thrown).map(Some),
        }
    }

    /// AsyncGeneratorDrainQueue
    fn drain_queue(&self, cx: &mut Cx) -> JsResult<()> {
        while let Some(Completion { mode, value }) = self.first_request() {
            match mode {
                ResumeMode::Normal => {
                    self.complete_step(cx, PromiseStatus::Fulfilled, Value::UNDEFINED, true)?;
                }
                ResumeMode::Throw => {
                    self.complete_step(cx, PromiseStatus::Rejected, value, true)?;
                }
                ResumeMode::Return => {
                    let task = InternalMicrotask::AsyncGeneratorAwaitReturn;
                    let Some(exception) = self.await_for(cx, task, value)? else {
                        return Ok(());
                    };
                    self.complete_step(cx, PromiseStatus::Rejected, exception, true)?;
                }
            }
        }
        self.set_state(CoroutineState::Completed);
        Ok(())
    }

    fn finish(&self, cx: &mut Cx, status: PromiseStatus, value: Value) -> JsResult<()> {
        self.set_state(CoroutineState::DrainingQueue);
        self.complete_step(cx, status, value, true)?;
        self.drain_queue(cx)
    }

    /// AsyncGeneratorUnwrapYieldResumption. What the body goes on with, if it does so right away.
    fn unwrap_first_request(&self, cx: &mut Cx) -> JsResult<Option<Completion>> {
        match self.first_request() {
            Some(Completion {
                mode: ResumeMode::Return,
                value,
            }) => {
                self.set_state(CoroutineState::SuspendedAwait);
                let task = InternalMicrotask::AsyncGeneratorResumeWithReturn;
                Ok(self.await_for(cx, task, value)?.map(Completion::throw))
            }
            None => {
                self.set_state(CoroutineState::SuspendedYield);
                Ok(None)
            }
            request => Ok(request),
        }
    }

    fn run_with_first_request(&self, cx: &mut Cx) -> JsResult<()> {
        match self.unwrap_first_request(cx)? {
            Some(Completion { mode, value }) => self.run(cx, mode, value),
            None => Ok(()),
        }
    }

    /// AsyncGeneratorResume, until the body has to wait for something.
    fn run(&self, cx: &mut Cx, mode: ResumeMode, value: Value) -> JsResult<()> {
        let mut next = Some(Completion { mode, value });
        while let Some(Completion { mode, value }) = next {
            let value = match self.resume(cx, value, mode) {
                Ok(value) => value,
                Err(thrown) => {
                    let exception = cx.catch_value(thrown)?;
                    return self.finish(cx, PromiseStatus::Rejected, exception);
                }
            };
            let state = self.state();
            if state == CoroutineState::Completed {
                return self.finish(cx, PromiseStatus::Fulfilled, value);
            }
            self.set_state(CoroutineState::SuspendedAwait);
            next = match state {
                CoroutineState::SuspendedDelegate => {
                    self.complete_step(cx, PromiseStatus::Fulfilled, value, false)?;
                    self.unwrap_first_request(cx)?
                }
                CoroutineState::SuspendedYield => {
                    let task = InternalMicrotask::AsyncGeneratorYield;
                    self.await_for(cx, task, value)?.map(Completion::throw)
                }
                _ if value == REQUESTED_STEP => {
                    requeue_early_answer(cx, self);
                    None
                }
                _ => {
                    let task = InternalMicrotask::AsyncGeneratorResume;
                    self.await_for(cx, task, value)?.map(Completion::throw)
                }
            };
        }
        Ok(())
    }

    /// What one of the tasks waited for has settled.
    #[inline(never)]
    pub(super) fn continue_with(
        &self,
        cx: &mut Cx,
        task: InternalMicrotask,
        status: PromiseStatus,
        value: Value,
    ) -> JsResult<()> {
        let cx = cx.in_realm_of(self);
        match (task, status) {
            (InternalMicrotask::AsyncGeneratorAwaitReturn, _) => self.finish(cx, status, value),
            (InternalMicrotask::AsyncGeneratorYield, PromiseStatus::Fulfilled) => {
                self.complete_step(cx, status, value, false)?;
                self.run_with_first_request(cx)
            }
            (InternalMicrotask::AsyncGeneratorResumeWithReturn, PromiseStatus::Fulfilled) => {
                self.run(cx, ResumeMode::Return, value)
            }
            _ => self.run(cx, resume_mode_for(status), value),
        }
    }
}

impl Completion {
    fn throw(value: Value) -> Completion {
        Completion {
            mode: ResumeMode::Throw,
            value,
        }
    }
}
