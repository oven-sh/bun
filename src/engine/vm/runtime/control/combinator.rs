//! What `Promise.all`, `allSettled` and `any` keep while they wait.

use core::cell::Cell;

use bun_engine_macros::{cell, native_abi};
use bun_engine_text::names;

use crate::{
    CallFrame, Cx, ElementKind, ErrorInstance, Gc, InternalMicrotask, JsArray, JsCell,
    JsFinalObject, JsFunctionWithFields, JsObject, JsPromise, JsResult, JsString, PromiseStatus,
    TypeFlags, Value,
};

#[cell(flags = TypeFlags::SHAPE_IS_IMMORTAL)]
pub struct PromiseCombinator {
    base: JsCell,
    /// The promise, or else the function to call when the last element is there.
    target: Gc<JsObject>,
    /// No script sees it before that.
    values: Gc<JsArray>,
    /// One more while elements are being added.
    remaining: Cell<u32>,
    /// That of its elements.
    task: InternalMicrotask,
}

impl PromiseCombinator {
    pub fn create(
        cx: &Cx,
        task: InternalMicrotask,
        target: Gc<JsObject>,
        capacity: usize,
    ) -> JsResult<Gc<PromiseCombinator>> {
        let values = cx.new_array_with_capacity(ElementKind::Contiguous, capacity)?;
        Ok(cx.allocate::<PromiseCombinator>(PromiseCombinatorInit {
            base: cx.shapes.promise_combinator(),
            target,
            values,
            remaining: Cell::new(1),
            task,
        }))
    }

    pub fn promise(&self) -> Option<Gc<JsPromise>> {
        self.target.downcast()
    }

    /// Returns its index.
    #[inline(always)]
    pub fn add_element(&self, cx: &mut Cx) -> JsResult<Value> {
        let index = self.values.length();
        if !self.values.try_set_dense(cx, index, Value::UNDEFINED) {
            self.values.append(cx, Value::UNDEFINED)?;
        }
        self.remaining.update(|count| count + 1);
        Ok(index.into())
    }

    /// Once, after the last `add_element`.
    #[inline]
    pub fn did_add_elements(&self, cx: &mut Cx) -> JsResult<()> {
        self.count_down(cx)
    }

    #[inline(always)]
    fn count_down(&self, cx: &mut Cx) -> JsResult<()> {
        self.remaining.update(|count| count - 1);
        if self.remaining.get() != 0 {
            return Ok(());
        }
        self.finish(cx)
    }

    #[inline(never)]
    fn finish(&self, cx: &mut Cx) -> JsResult<()> {
        let rejects = self.task == InternalMicrotask::PromiseAnyElement;
        let result = if rejects {
            ErrorInstance::aggregate(cx, self.values, None).into()
        } else {
            self.values.into()
        };
        match self.promise() {
            Some(promise) if rejects => promise.reject(cx, result),
            Some(promise) => promise.resolve(cx, result)?,
            None => drop(cx.call(self.target.into(), Value::UNDEFINED, &[result])?),
        }
        Ok(())
    }

    #[inline(always)]
    fn record(
        &self,
        cx: &mut Cx,
        index: Value,
        status: PromiseStatus,
        value: Value,
    ) -> JsResult<()> {
        let value = match self.task {
            InternalMicrotask::PromiseAllSettledElement => describe_outcome(cx, status, value),
            _ => value,
        };
        let index = index.as_uint32().expect("from `add_element`");
        if !self.values.try_set_dense(cx, index, value) {
            self.values.put_direct_index(cx, index, value)?;
        }
        self.count_down(cx)
    }

    /// The target is a promise.
    #[inline(always)]
    pub(super) fn did_settle(
        &self,
        cx: &mut Cx,
        index: Value,
        status: PromiseStatus,
        value: Value,
    ) -> JsResult<()> {
        let promise = self.target.cast::<JsPromise>();
        let cx = cx.in_realm_of(&promise);
        match (self.task, status) {
            (InternalMicrotask::PromiseAllElement, PromiseStatus::Rejected) => {
                promise.reject(cx, value);
                Ok(())
            }
            (InternalMicrotask::PromiseAnyElement, PromiseStatus::Fulfilled) => {
                promise.resolve(cx, value)
            }
            _ => self.record(cx, index, status, value),
        }
    }

    /// For the `then` of an element: records what it is called with.
    pub fn create_element_function(&self, cx: &Cx, index: Value, status: PromiseStatus) -> Value {
        let function = match status {
            PromiseStatus::Rejected => record_rejection,
            _ => record_fulfillment,
        };
        JsFunctionWithFields::new(cx, 1, function, [self.into(), index]).into()
    }

    /// Of the two functions that an element of `allSettled` has, the other one may have been first.
    fn has_outcome(&self, index: Value) -> bool {
        self.task == InternalMicrotask::PromiseAllSettledElement
            && (self.remaining.get() == 0
                || (index.as_uint32())
                    .and_then(|index| self.values.try_get_dense(index))
                    .is_some_and(Value::is_object))
    }
}

#[inline(never)]
fn describe_outcome(cx: &Cx, status: PromiseStatus, value: Value) -> Value {
    let (shape, status) = match status {
        PromiseStatus::Rejected => (cx.rejected_outcome_shape(), names::rejected),
        _ => (cx.fulfilled_outcome_shape(), names::fulfilled),
    };
    let status = JsString::from_name(cx, status).into();
    JsFinalObject::create_with_values(cx, shape, &[status, value]).into()
}

fn record_once(cx: &mut Cx, frame: &CallFrame, status: PromiseStatus) -> JsResult<Value> {
    let callee = frame.callee().cast::<JsFunctionWithFields>();
    let index = callee.fields().at(1);
    if let Some(combinator) = callee.fields().at(0).downcast::<PromiseCombinator>() {
        callee.fields().set(0, Value::NULL);
        if !combinator.has_outcome(index) {
            combinator.record(cx, index, status, frame.argument(0))?;
        }
    }
    Ok(Value::UNDEFINED)
}

#[native_abi]
fn record_fulfillment(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    record_once(cx, frame, PromiseStatus::Fulfilled)
}

#[native_abi]
fn record_rejection(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    record_once(cx, frame, PromiseStatus::Rejected)
}
