//! Waiting for promises.

use bun_engine_codegen::ir::{Type, Value as Ssa};
use bun_engine_vm::{
    GlobalObject, InlineReactionKind, InternalMicrotask, JsPromise, MicrotaskQueue,
    OFFSET_OF_INTERNAL_FIELDS, PromiseStatus, QueuedTask, REQUESTED_STEP, SpeculatedType as T,
    Value, Vm,
};

use super::truth::Left;
use super::ways::{Detour, Meeting};
use super::{Lowering, Odds};
use crate::graph::{Awaiting, TypeCheck, heaps};
use crate::runtime::operations::suspension as operations;

const TASK: InternalMicrotask = InternalMicrotask::AsyncFunctionResume;

impl Lowering<'_> {
    fn detour_unless_zero(&mut self, value: Ssa, detour: &mut Detour) {
        let is_set = self.ir().is_not_zero(value);
        self.detour_if(is_set, Odds::Low, detour);
    }

    /// For a promise that has been fulfilled.
    fn queue_task(&mut self, arguments: [Ssa; QueuedTask::MAX_ARGUMENTS], slow: &mut Detour) {
        let (vm, global, heap) = (self.vm(), self.global(), heaps::OTHER_FIELDS);
        let diverts = self.load_byte(vm, Vm::OFFSET_OF_HAS_SYNCHRONOUS_MODULE_QUEUE, heap);
        self.detour_unless_zero(diverts, slow);
        let debuggers = self.load(Type::I32, vm, Vm::OFFSET_OF_DEBUGGER_COUNT, heap);
        self.detour_unless_zero(debuggers, slow);
        let queue = self.load(
            Type::I64,
            global,
            GlobalObject::OFFSET_OF_MICROTASK_QUEUE,
            heap,
        );
        let [buffer, capacity, start, end] = [
            MicrotaskQueue::OFFSET_OF_BUFFER,
            MicrotaskQueue::OFFSET_OF_CAPACITY,
            MicrotaskQueue::OFFSET_OF_START,
            MicrotaskQueue::OFFSET_OF_END,
        ]
        .map(|field| self.load(Type::I64, queue, field, heap));
        let length = self.ir().sub(end, start);
        let is_full = self.ir().equal(length, capacity);
        self.detour_if(is_full, Odds::Low, slow);
        let realm = self.graph.frame_at(self.origin).global as u64;
        let header = self.word(QueuedTask::header_for(
            realm,
            TASK,
            PromiseStatus::Fulfilled as u8,
        ));
        let mut ir = self.ir();
        let mask = ir.sub(capacity, 1);
        let index = ir.and(end, mask);
        let distance = ir.mul(index, size_of::<QueuedTask>());
        let (task, next) = (ir.add(buffer, distance), ir.add(end, 1));
        self.store(header, task, 0, heap);
        for (argument, offset) in
            (arguments.into_iter()).zip((QueuedTask::OFFSET_OF_ARGUMENTS..).step_by(8))
        {
            self.store(argument, task, offset, heap);
        }
        self.store(next, queue, MicrotaskQueue::OFFSET_OF_END, heap);
    }

    /// Ends all ways.
    fn react_to_promise(
        &mut self,
        meeting: Meeting,
        slow: &mut Detour,
        [promise, generator, context]: [Ssa; 3],
    ) {
        const KEPT: u16 = JsPromise::IS_HANDLED | JsPromise::IS_RESOLVED;
        let heap = heaps::OTHER_FIELDS;
        let payload = self.load(Type::I64, promise, JsPromise::OFFSET_OF_PAYLOAD, heap);
        let status = (self.ir()).and(
            payload,
            JsPromise::payload_with_only(JsPromise::STATUS_MASK),
        );
        let fulfilled = JsPromise::payload_with_only(PromiseStatus::Fulfilled as u16);
        let is_fulfilled = self.ir().equal(status, fulfilled);
        let undefined = self.word(Value::UNDEFINED.to_bits());
        self.give_if(meeting, is_fulfilled, Odds::Even, |this| {
            let result = this.load(Type::I64, promise, JsPromise::OFFSET_OF_SLOT, heap);
            this.queue_task([undefined, result, generator, context], slow);
            Ssa::NONE
        });
        let rest = (self.ir()).and(payload, !JsPromise::payload_with_only(KEPT));
        self.detour_unless_zero(rest, slow);
        let flags = JsPromise::IS_HANDLED
            | (InlineReactionKind::Internal as u16) << JsPromise::KIND_SHIFT
            | (TASK as u16) << JsPromise::TASK_SHIFT;
        let mut reaction = (self.ir()).or(payload, JsPromise::payload_with_only(flags));
        if context != undefined {
            let has_none = self.ir().equal(context, undefined);
            reaction = self.unless(has_none, reaction, |this| {
                let is_immediate = this.has_type(context, !T::CELL, T::HEAP_TOP);
                this.detour_if(is_immediate, Odds::Low, slow);
                let mark = JsPromise::payload_with_only(JsPromise::PAYLOAD_IS_ASYNC_CONTEXT);
                let marked = this.ir().or(reaction, mark);
                this.ir().or(marked, context)
            });
        }
        self.store(generator, promise, JsPromise::OFFSET_OF_SLOT, heap);
        self.store(reaction, promise, JsPromise::OFFSET_OF_PAYLOAD, heap);
        self.store_barrier(promise, Ssa::NONE);
        if context != undefined {
            self.keep_alive(context);
        }
        self.give(meeting, Ssa::NONE);
    }

    pub(super) fn await_value(&mut self, check: TypeCheck) {
        let [value, generator, plain_shape, holder, how] = self.operands()[..] else {
            unreachable!("it has five")
        };
        let how = self.graph.function.int_constant(how).expect("a constant");
        let (how, left) = (Awaiting::from_bits_retain(how as u32), Left::of(check));
        let (meeting, mut slow, heap) = (
            self.part(Type::Void),
            Detour::default(),
            heaps::INTERNAL_FIELDS,
        );
        let undefined = self.word(Value::UNDEFINED.to_bits());
        let context = if how.contains(Awaiting::HAS_CONTEXT) {
            self.load(Type::I64, holder, OFFSET_OF_INTERNAL_FIELDS, heap)
        } else {
            let (vm, offset) = (self.vm(), Vm::OFFSET_OF_IS_ASYNC_CONTEXT_TRACKED);
            let is_tracked = self.load_byte(vm, offset, heaps::OTHER_FIELDS);
            self.detour_unless_zero(is_tracked, &mut slow);
            undefined
        };
        let mut cell = Detour::default();
        if !how.contains(Awaiting::IS_NO_THENABLE) {
            let is_cell = self.has_type(value, T::CELL, left.known);
            self.detour_if(is_cell, left.odds_of(T::CELL), &mut cell);
        }
        // What stands for a step that has been asked for passes for undefined.
        if left.known.contains(T::UNDEFINED) {
            let is_step = self.ir().equal(value, REQUESTED_STEP.to_bits());
            self.detour_if(is_step, Odds::Even, &mut slow);
        }
        if how.contains(Awaiting::IS_NO_THENABLE) || !T::CELL.contains(left.expected) {
            self.queue_task([undefined, value, generator, context], &mut slow);
            self.give(meeting, Ssa::NONE);
        } else {
            self.take_detour(&mut slow);
        }
        if self.follow(cell) {
            if how.contains(Awaiting::SPECIES_IS_PRISTINE) && left.expected.intersects(T::PROMISE) {
                let id = self.shape_id(value);
                let is_other = self.ir().not_equal(id, plain_shape);
                self.detour_if(is_other, left.odds_of(!T::PROMISE), &mut slow);
                self.react_to_promise(meeting, &mut slow, [value, generator, context]);
            } else {
                self.take_detour(&mut slow);
            }
        }
        self.meet_after(meeting, slow, |this| {
            this.call_operation(operations::AWAIT, &[generator, value]);
            Ssa::NONE
        });
    }
}
