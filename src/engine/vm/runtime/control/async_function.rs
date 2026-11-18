use core::mem::offset_of;

use bun_engine_bytecode::ResumeMode;
use bun_engine_macros::cell;

use super::async_iteration::{REQUESTED_STEP, has_early_answers, requeue_early_answer};
use crate::{
    CallFrame, CellType, CodeBlock, Coroutine, Cx, Gc, GlobalObject, InternalMicrotask,
    InternalReaction, JsPromise, JsResult, PromiseStatus, RealmSlot, Thrown, Value, Vm,
    is_definitely_not_thenable,
};

/// An async function or a module that has come to an `await`. Scripts never see it.
#[cell(name = "AsyncFunctionGenerator", cell_type = AsyncFunctionGenerator)]
pub struct JsAsyncFunctionGenerator {
    base: Coroutine,
    promise: Gc<JsPromise>,
}

impl JsAsyncFunctionGenerator {
    pub const OFFSET_OF_PROMISE: usize = offset_of!(JsAsyncFunctionGenerator, promise);

    #[inline(always)]
    pub(super) fn for_frame(cx: &Cx, frame: &CallFrame) -> JsResult<Gc<Self>> {
        let promise = JsPromise::new(cx);
        let base = Coroutine::init::<Self>(cx.async_function_generator_shape(), frame);
        Coroutine::allocate(cx, frame, JsAsyncFunctionGeneratorInit { base, promise })
    }

    /// `None` if it takes a call.
    ///
    /// # Safety
    /// `frame` runs `code_block`.
    #[inline(always)]
    pub unsafe fn try_create_quickly(
        vm: &Vm,
        frame: &CallFrame,
        code_block: &CodeBlock,
    ) -> Option<Gc<Self>> {
        let global = code_block.global();
        let shape = global.slot_if_initialized(RealmSlot::async_function_generator_shape)?;
        let size = Coroutine::allocation_size::<Self>(code_block);
        let allocator = vm.heap.cells.allocator_for(size)?;
        let promise = JsPromise::try_new_quickly(vm, &global)?;
        let address = allocator.try_bump()?;
        // SAFETY: what the slot has, and a new cell that is large enough.
        unsafe {
            let base = Coroutine::init::<Self>(shape.cast_unchecked(), frame);
            let init = JsAsyncFunctionGeneratorInit { base, promise };
            Some(Coroutine::initialize_with_nothing_saved(address, init))
        }
    }

    /// `generator` is the operand of an instruction in the code that `frame` runs.
    #[inline(always)]
    pub fn ensure(cx: &Cx, frame: &CallFrame, generator: Option<Value>) -> JsResult<Gc<Self>> {
        match generator {
            Some(generator) => Ok(generator.cast()),
            None => Self::for_frame(cx, frame),
        }
    }

    #[inline(always)]
    pub fn promise(&self) -> Gc<JsPromise> {
        self.promise
    }

    pub fn is_of_module(&self) -> bool {
        self.callee().cell_type() == CellType::Callee
    }

    /// Arranges for the code to go on when `value` has settled. What it throws, the `await` throws.
    #[inline(always)]
    pub fn await_value(&self, cx: &mut Cx, value: Value) -> JsResult<()> {
        if value == REQUESTED_STEP {
            requeue_early_answer(cx, self);
            return Ok(());
        }
        InternalReaction::new(InternalMicrotask::AsyncFunctionResume, None, self.into())
            .in_current_async_context(cx)
            .await_value(cx, value)
    }

    /// The same in the realm of the code, if it takes no call. False, having done nothing, otherwise.
    #[inline(always)]
    pub fn try_await_quickly(&self, vm: &Vm, global: &GlobalObject, value: Value) -> bool {
        if value == REQUESTED_STEP {
            return !has_early_answers(vm);
        }
        InternalReaction::new(InternalMicrotask::AsyncFunctionResume, None, self.into())
            .in_async_context(global.current_async_context(vm))
            .try_await_quickly(vm, global, value)
    }

    #[inline(always)]
    pub(super) fn continue_with(
        &self,
        cx: &mut Cx,
        status: PromiseStatus,
        value: Value,
    ) -> JsResult<()> {
        match self.resume(cx, value, resume_mode_for(status)) {
            Ok(_) => Ok(()),
            Err(thrown) => self.did_fail_to_resume(cx, thrown),
        }
    }

    /// There was no room for the frame.
    #[cold]
    #[inline(never)]
    fn did_fail_to_resume(&self, cx: &Cx, thrown: Thrown) -> JsResult<()> {
        self.promise.reject_with_caught(cx, thrown)
    }
}

#[inline(always)]
pub(super) fn resume_mode_for(status: PromiseStatus) -> ResumeMode {
    match status {
        PromiseStatus::Rejected => ResumeMode::Throw,
        _ => ResumeMode::Normal,
    }
}

/// Fails only if execution is terminated.
#[inline(always)]
pub fn async_return(
    cx: &mut Cx,
    generator: Option<Value>,
    value: Value,
) -> JsResult<Gc<JsPromise>> {
    let Some(generator) = generator else {
        return JsPromise::new_resolved(cx, value);
    };
    let generator = generator.cast::<JsAsyncFunctionGenerator>();
    generator.complete();
    generator.promise.resolve(cx, value)?;
    Ok(generator.promise)
}

/// The same in the realm of the code. `None`, having done nothing, if it takes a call.
#[inline(always)]
pub fn try_async_return_quickly(
    vm: &Vm,
    global: &GlobalObject,
    generator: Option<Gc<JsAsyncFunctionGenerator>>,
    value: Value,
) -> Option<Gc<JsPromise>> {
    if (value.as_object()).is_some_and(|object| !is_definitely_not_thenable(&object)) {
        return None;
    }
    let Some(generator) = generator else {
        return JsPromise::try_fulfilled_quickly(vm, global, value);
    };
    let promise = generator.promise;
    if promise.flags() & JsPromise::IS_RESOLVED != 0 || !promise.try_fulfill_quickly(vm, value) {
        return None;
    }
    promise.mark_as_resolved();
    generator.complete();
    Some(promise)
}

pub fn async_throw(cx: &Cx, generator: Option<Value>, reason: Value) -> Gc<JsPromise> {
    let Some(generator) = generator else {
        return JsPromise::rejected(cx, reason);
    };
    let generator = generator.cast::<JsAsyncFunctionGenerator>();
    generator.complete();
    generator.promise.reject(cx, reason);
    generator.promise
}
