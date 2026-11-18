//! What happens when a promise settles.

use bun_engine_macros::cell;

use super::tagged_field::TaggedField;
use crate::{
    Cx, Gc, GlobalObject, InternalFieldTuple, InternalMicrotask, JsCell, PromiseStatus, QueuedTask,
    TypeFlags, Value, Vm,
};

/// A job of the engine that runs in place of a handler. What `cell` and `context` are depends on the task.
#[derive(Clone, Copy)]
pub struct InternalReaction {
    pub task: InternalMicrotask,
    /// Undefined if there is none.
    pub cell: Value,
    pub context: Value,
    pub async_context: Value,
}

impl InternalReaction {
    #[inline(always)]
    pub fn new(task: InternalMicrotask, cell: Option<Gc<JsCell>>, context: Value) -> Self {
        InternalReaction {
            task,
            cell: cell.map_or_default(Value::from),
            context,
            async_context: Value::UNDEFINED,
        }
    }

    #[inline(always)]
    pub fn in_async_context(self, async_context: Value) -> InternalReaction {
        InternalReaction {
            async_context,
            ..self
        }
    }

    #[inline(always)]
    pub fn in_current_async_context(self, cx: &Cx) -> InternalReaction {
        self.in_async_context(cx.current_async_context())
    }

    #[inline(always)]
    pub(super) fn to_task(
        self,
        global: &GlobalObject,
        status: PromiseStatus,
        value: Value,
    ) -> QueuedTask {
        let arguments = [self.cell, value, self.context, self.async_context];
        QueuedTask::new(global.into(), self.task, status as u8, arguments.map(Some))
    }

    /// As if to a promise that nothing else knows of and that has settled.
    #[inline(always)]
    pub fn queue(self, vm: &Vm, global: &GlobalObject, status: PromiseStatus, value: Value) {
        self.to_task(global, status, value).queue(vm, global);
    }
}

/// What the first and the last argument of a `PromiseReaction` job are. It is in the payload, above the status.
#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub(super) enum HandlerContext {
    /// The promise or capability, and the async context.
    Async,
    /// The promise or capability, and a second argument for the handler.
    Argument,
    /// The async context, and the second argument. Nothing gets the result of the handler.
    BothWithoutResult,
    /// The promise or capability, and an `InternalFieldTuple` of the second argument and the async context.
    Both,
}

impl HandlerContext {
    const SHIFT: u32 = 2;

    #[inline(always)]
    pub(super) fn from_payload(payload: u8) -> HandlerContext {
        match payload >> Self::SHIFT & 3 {
            0 => HandlerContext::Async,
            1 => HandlerContext::Argument,
            2 => HandlerContext::BothWithoutResult,
            _ => HandlerContext::Both,
        }
    }

    #[inline(always)]
    const fn payload(self) -> u8 {
        (self as u8) << Self::SHIFT
    }
}

/// Where the result of a handler goes, and what else it is called with.
#[derive(Clone, Copy)]
pub(super) struct Continuation {
    pub(super) kind: HandlerContext,
    pub(super) first: Value,
    pub(super) last: Value,
}

impl Continuation {
    #[inline(always)]
    pub(super) fn new(result: Value, async_context: Value) -> Continuation {
        Continuation {
            kind: HandlerContext::Async,
            first: result,
            last: async_context,
        }
    }

    #[inline]
    pub(super) fn with_argument(cx: &Cx, result: Value, argument: Value) -> Continuation {
        let async_context = cx.current_async_context();
        let (kind, first, last) = if argument.is_undefined_or_null() {
            (HandlerContext::Async, result, async_context)
        } else if async_context.is_undefined() {
            (HandlerContext::Argument, result, argument)
        } else if result.is_undefined_or_null() {
            (HandlerContext::BothWithoutResult, async_context, argument)
        } else {
            let both = InternalFieldTuple::create(cx, argument, async_context);
            (HandlerContext::Both, result, both.into())
        };
        Continuation { kind, first, last }
    }

    #[inline(always)]
    pub(super) fn has_context(self) -> bool {
        !self.last.is_undefined()
    }

    /// The promise, the capability, undefined or null.
    #[inline(always)]
    pub(super) fn result(self) -> Value {
        match self.kind {
            HandlerContext::BothWithoutResult => Value::UNDEFINED,
            _ => self.first,
        }
    }

    #[inline(always)]
    pub(super) fn without_handler(self) -> InternalReaction {
        let task = InternalMicrotask::PromiseResolveWithoutHandler;
        InternalReaction::new(task, self.result().as_cell(), Value::UNDEFINED)
    }

    /// `handler` is callable or undefined.
    #[inline(always)]
    pub(super) fn to_task(
        self,
        global: &GlobalObject,
        status: PromiseStatus,
        value: Value,
        handler: Value,
    ) -> QueuedTask {
        if handler.is_undefined() {
            return self.without_handler().to_task(global, status, value);
        }
        let (job, payload) = (
            InternalMicrotask::PromiseReaction,
            status as u8 | self.kind.payload(),
        );
        let arguments = [self.first, value, handler, self.last];
        QueuedTask::new(global.into(), job, payload, arguments.map(Some))
    }
}

/// One that does not fit in the promise. The low byte of the tag is the task, the high byte depends on it.
///
/// | task              | `first`                                  | `second` | high byte                    |
/// | ----------------- | ---------------------------------------- | -------- | ---------------------------- |
/// | `PromiseReaction` | the promise or capability                | handler  | the status that it handles   |
/// | another           | the cell or else the async context       | context  | `FIRST_IS_ASYNC_CONTEXT`     |
#[cell(name = "SlimPromiseReaction", cell_type = SlimPromiseReaction..=FullPromiseReaction,
    flags = TypeFlags::SHAPE_IS_IMMORTAL)]
pub struct PromiseReaction {
    base: JsCell,
    first: Value,
    next: TaggedField<PromiseReaction>,
    second: Value,
}

/// | task              | `first`, `fourth`, high byte | `second`       | `third`       |
/// | ----------------- | ---------------------------- | -------------- | ------------- |
/// | `PromiseReaction` | the `Continuation`           | `onFulfilled`  | `onRejected`  |
/// | another           | the cell                     | context        | async context |
#[cell(cell_type = FullPromiseReaction)]
pub struct FullPromiseReaction {
    base: PromiseReaction,
    third: Value,
    fourth: Value,
}

const FIRST_IS_ASYNC_CONTEXT: u8 = 1;

const fn tag(task: InternalMicrotask, detail: u8) -> u16 {
    u16::from_le_bytes([task as u8, detail])
}

type Next = Option<Gc<PromiseReaction>>;

impl PromiseReaction {
    #[inline(always)]
    fn slim(vm: &Vm, tag: u16, first: Value, second: Value, next: Next) -> Gc<PromiseReaction> {
        let reaction = vm.allocate::<PromiseReaction>(PromiseReactionInit {
            base: vm.shapes.slim_promise_reaction(),
            first,
            next: TaggedField::new(tag),
            second,
        });
        // SAFETY: a new cell.
        unsafe { reaction.next.set_without_barrier(next, tag) };
        reaction
    }

    #[inline(always)]
    fn full(vm: &Vm, tag: u16, values: [Value; 4], next: Next) -> Gc<PromiseReaction> {
        let [first, second, third, fourth] = values;
        let reaction = vm.allocate::<FullPromiseReaction>(FullPromiseReactionInit {
            base: PromiseReactionInit {
                base: vm.shapes.full_promise_reaction(),
                first,
                next: TaggedField::new(tag),
                second,
            },
            third,
            fourth,
        });
        // SAFETY: as above.
        unsafe { reaction.next.set_without_barrier(next, tag) };
        reaction.upcast()
    }

    pub(super) fn internal(vm: &Vm, it: InternalReaction, next: Next) -> Gc<PromiseReaction> {
        if it.async_context.is_undefined() {
            Self::slim(vm, tag(it.task, 0), it.cell, it.context, next)
        } else if it.cell.is_undefined() {
            let tag = tag(it.task, FIRST_IS_ASYNC_CONTEXT);
            Self::slim(vm, tag, it.async_context, it.context, next)
        } else {
            let values = [it.cell, it.context, it.async_context, Value::UNDEFINED];
            Self::full(vm, tag(it.task, 0), values, next)
        }
    }

    pub(super) fn one_handler(
        vm: &Vm,
        handles: PromiseStatus,
        handler: Value,
        result: Value,
        next: Next,
    ) -> Gc<PromiseReaction> {
        let tag = tag(InternalMicrotask::PromiseReaction, handles as u8);
        Self::slim(vm, tag, result, handler, next)
    }

    /// Each handler is callable or undefined.
    pub(super) fn handlers(
        vm: &Vm,
        on_fulfilled: Value,
        on_rejected: Value,
        then: Continuation,
        next: Next,
    ) -> Gc<PromiseReaction> {
        let tag = tag(InternalMicrotask::PromiseReaction, then.kind.payload());
        let values = [then.first, on_fulfilled, on_rejected, then.last];
        Self::full(vm, tag, values, next)
    }

    #[inline(always)]
    pub fn next(&self) -> Option<Gc<PromiseReaction>> {
        self.next.cell()
    }

    fn set_next(&self, next: Next) {
        // SAFETY: a field of this cell.
        unsafe { self.next.set(self, next, self.next.tag()) }
    }

    #[inline(always)]
    fn task_and_detail(&self) -> (InternalMicrotask, u8) {
        let [task, detail] = self.next.tag().to_le_bytes();
        (InternalMicrotask::from_bits(task), detail)
    }

    #[inline(always)]
    fn continuation(&self) -> Continuation {
        match self.downcast::<FullPromiseReaction>() {
            Some(full) => Continuation {
                kind: HandlerContext::from_payload(self.task_and_detail().1),
                first: self.first,
                last: full.fourth,
            },
            None => Continuation::new(self.first, Value::UNDEFINED),
        }
    }

    /// Of one with handlers, the task is `PromiseReaction`, the cell gets the result and the rest is undefined.
    #[inline(always)]
    pub fn describe(&self) -> InternalReaction {
        let (task, detail) = self.task_and_detail();
        if task == InternalMicrotask::PromiseReaction {
            let result = self.continuation().result();
            return InternalReaction::new(task, result.as_cell(), Value::UNDEFINED);
        }
        let (cell, async_context) = match self.downcast::<FullPromiseReaction>() {
            Some(full) => (self.first, full.third),
            None if detail == FIRST_IS_ASYNC_CONTEXT => (Value::UNDEFINED, self.first),
            None => (self.first, Value::UNDEFINED),
        };
        InternalReaction {
            task,
            cell,
            context: self.second,
            async_context,
        }
    }

    #[inline(always)]
    fn to_task(&self, global: &GlobalObject, status: PromiseStatus, value: Value) -> QueuedTask {
        let (task, detail) = self.task_and_detail();
        if task != InternalMicrotask::PromiseReaction {
            return self.describe().to_task(global, status, value);
        }
        let handler = match self.downcast::<FullPromiseReaction>() {
            Some(full) if status == PromiseStatus::Rejected => full.third,
            None if detail != status as u8 => Value::UNDEFINED,
            _ => self.second,
        };
        self.continuation().to_task(global, status, value, handler)
    }

    /// TriggerPromiseReactions. `self` is the newest.
    #[inline(never)]
    pub(super) fn trigger(
        &self,
        vm: &Vm,
        global: &GlobalObject,
        status: PromiseStatus,
        value: Value,
    ) {
        let mut oldest = Gc::from(self);
        if let Some(older) = self.next() {
            self.set_next(None);
            let mut rest = Some(older);
            while let Some(reaction) = rest {
                rest = reaction.next();
                reaction.set_next(Some(oldest));
                oldest = reaction;
            }
        }
        for reaction in core::iter::successors(Some(oldest), |it| it.next()) {
            (reaction.to_task(global, status, value)).queue_or_divert(vm, global);
        }
    }
}

const _: () = assert!(size_of::<PromiseReaction>() == 32);
