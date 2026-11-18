//! A value of the embedder that follows work from where it is scheduled to where it runs. It is in the first field of
//! `GlobalObject::async_context`. Undefined stands for none.

use crate::{Cx, Gc, GlobalObject, InternalFieldTuple, Value, Vm};

impl Vm {
    /// Until then there is none to propagate.
    #[inline(always)]
    pub fn is_async_context_tracked(&self) -> bool {
        self.is_async_context_tracked.get()
    }

    pub fn start_tracking_async_context(&self) {
        self.is_async_context_tracked.set(true);
    }
}

impl GlobalObject {
    /// What a job that is scheduled now runs in.
    #[inline(always)]
    pub fn current_async_context(&self, vm: &Vm) -> Value {
        if !vm.is_async_context_tracked() {
            return Value::UNDEFINED;
        }
        self.async_context().fields().at(0)
    }
}

impl Cx {
    #[inline(always)]
    pub fn current_async_context(&self) -> Value {
        self.global().current_async_context(self)
    }
}

/// A job neither inherits what an earlier one has left nor leaves anything to a later one.
pub(crate) struct AsyncContextScope(Option<(Gc<InternalFieldTuple>, Value)>);

impl AsyncContextScope {
    #[inline(always)]
    pub(crate) fn enter(cx: &Cx, context: Value) -> AsyncContextScope {
        if !cx.is_async_context_tracked() {
            return AsyncContextScope(None);
        }
        let holder = cx.async_context();
        let previous = holder.fields().at(0);
        if previous != context {
            holder.fields().set(0, context);
        }
        AsyncContextScope(Some((holder, previous)))
    }
}

impl Drop for AsyncContextScope {
    #[inline(always)]
    fn drop(&mut self) {
        if let Some((holder, previous)) = self.0 {
            holder.fields().set(0, previous);
        }
    }
}
