use core::cell::{Cell, UnsafeCell};

use bun_engine_macros::cell;

use crate::heap::barrier;
use crate::{
    ErrorInstance, Field, Gc, JsCell, JsString, RootVec, StackFrame, StackTrace, StackTraceRequest,
    Trace, TypeFlags, Value, Visitor, Vm, options,
};

#[repr(transparent)]
#[cfg_attr(
    rootcheck,
    rootcheck::allow("made empty, and filled through the owner")
)]
struct TracedStackTrace(UnsafeCell<StackTrace>);

// SAFETY: replaced only under the lock of the exception, and the barrier follows.
unsafe impl Trace for TracedStackTrace {
    fn trace(&self, visitor: &mut Visitor) {
        visitor.with_current_cell_locked(|visitor| {
            // SAFETY: as above.
            let stack = unsafe { &*self.0.get() };
            stack.trace(visitor);
            visitor.report_extra_memory(stack.memory_size());
        });
    }
}

/// A value that has been thrown, and from where.
#[cell(cell_type = Exception, flags = TypeFlags::SHAPE_IS_IMMORTAL, estimated_size,
    export = "engine_class_Exception")]
pub struct Exception {
    base: JsCell,
    pub value: Field<Value>,
    /// The one that it was first thrown in. `None` if it was not, or contexts were not tracked then.
    pub async_context: Field<Option<Value>>,
    stack: TracedStackTrace,
    did_notify_debugger: Cell<bool>,
}

impl Exception {
    pub const OFFSET_OF_VALUE: usize = core::mem::offset_of!(Exception, value);

    #[inline]
    pub fn create_without_stack(vm: &Vm, value: Value) -> Gc<Exception> {
        vm.allocate::<Exception>(ExceptionInit {
            base: vm.shapes.exception(),
            value,
            async_context: None,
            stack: TracedStackTrace(UnsafeCell::new(StackTrace::EMPTY)),
            did_notify_debugger: Cell::new(false),
        })
    }

    pub fn create(vm: &Vm, value: Value) -> Gc<Exception> {
        let exception = Self::create_without_stack(vm, value);
        let request = StackTraceRequest {
            skip: 0,
            limit: options().exception_stack_trace_limit as usize,
            below: None,
            filter: None,
        };
        exception.set_stack(vm, StackTrace::capture(vm, request));
        exception
    }

    pub(crate) fn create_termination(vm: &Vm) -> Gc<Exception> {
        let value = JsString::from_literal(vm, "JavaScript execution terminated.");
        Self::create_without_stack(vm, value.into())
    }

    /// In place of an empty one, so that what has been handed out stays valid.
    fn set_stack(&self, vm: &Vm, stack: StackTrace) {
        assert!(self.stack().is_empty());
        let size = stack.memory_size();
        {
            let _lock = barrier::is_fenced().then(|| self.lock());
            // SAFETY: no marker reads it meanwhile, and nothing borrows a frame of an empty list.
            unsafe { *self.stack.0.get() = stack };
        }
        self.write_barrier_for_cell();
        vm.heap.report_extra_memory_allocated(self, size);
    }

    /// Empty if a script was sure to catch it.
    #[inline]
    pub fn stack(&self) -> &[StackFrame] {
        // SAFETY: frames that are there stay.
        unsafe { &*self.stack.0.get() }
    }

    /// Falls back on the frames of the error, as long as it has them.
    pub fn stack_for_reporting(&self, vm: &Vm) -> &[StackFrame] {
        if self.stack().is_empty()
            && let Some(error) = self.value().downcast::<ErrorInstance>()
        {
            let frames: RootVec<StackFrame> = error.stack_frames();
            self.set_stack(vm, StackTrace::copy_of(&frames));
        }
        self.stack()
    }

    pub fn did_notify_debugger(&self) -> &Cell<bool> {
        &self.did_notify_debugger
    }

    fn estimated_size(&self, _: &Vm) -> usize {
        self.cell_size() + size_of_val(self.stack())
    }
}
