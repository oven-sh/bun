//! Promises, as far as instructions deal with them.

use bun_engine_bytecode::{MetadataKind, op};
use bun_engine_codegen::ir::Value as Ssa;
use bun_engine_text::names;
use bun_engine_vm::code::metadata::WeakCell;
use bun_engine_vm::ic::PrototypeLookup;
use bun_engine_vm::{
    IterationMode as Mode, JsPromise, PromiseStatus, RealmWatchpoint, RootVec, SpeculatedType as T,
    root_vec,
};

use super::Builder;
use super::fork::Odds;
use super::iteration::{Otherwise, modes_in};
use crate::graph::{Awaiting, ExitKind, Kind, ShapeSet, heaps};

impl Builder<'_> {
    pub(super) fn new_promise(&mut self, flags: u16, result: Option<Ssa>) -> Ssa {
        let shape = self.global().promise_shape(self.vm);
        let allocation = self.allocation(shape, size_of::<JsPromise>());
        let promise = self.new_instance(allocation.expect("small"));
        let payload = self.word(JsPromise::payload_with_only(flags) as usize);
        let slot = result.unwrap_or_else(|| self.empty());
        let slot = self.graph.root(slot);
        for (offset, value) in [
            (JsPromise::OFFSET_OF_PAYLOAD, payload),
            (JsPromise::OFFSET_OF_SLOT, slot),
        ] {
            (self.ir()).store(value, promise, offset as i32, heaps::OTHER_FIELDS);
        }
        promise
    }

    pub(super) fn create_promise(&mut self, op: op::CreatePromise) {
        let (code_block, kind) = (self.frame().code_block, MetadataKind::CachedCallee);
        let seen = code_block
            .checked_metadata::<WeakCell>(kind, op.metadata)
            .get();
        let (new_target, original) = (
            self.get_value(op.new_target),
            self.global().promise_constructor(self.vm).cell(),
        );
        let expected = self.cell(original);
        if self.graph.root(new_target) != expected
            && (seen != Some(original) || self.has_exited(ExitKind::BadIdentity))
        {
            return self.interpret();
        }
        self.check_identical(new_target, expected);
        let promise = self.new_promise(0, None);
        self.set(op.dst, promise);
    }

    /// Arranges for the async function to go on once the value has settled.
    pub(super) fn subscribe(&mut self, generator: Ssa, value: Ssa) {
        let mut how = Awaiting::empty();
        let is_pristine = self.watch_realm(RealmWatchpoint::PromiseSpecies);
        how.set(Awaiting::SPECIES_IS_PRISTINE, is_pristine);
        how.set(Awaiting::HAS_CONTEXT, self.vm.is_async_context_tracked());
        how.set(Awaiting::IS_NO_THENABLE, self.is_no_thenable(value));
        let shape = self.global().promise_shape(self.vm);
        self.shape(shape);
        let operands = [
            self.alias(value),
            generator,
            self.int32(shape.id().bits() as i32),
            self.cell(self.global().async_context().cell()),
            self.int32(how.bits() as i32),
        ];
        let data = self.graph.intern_type(T::HEAP_TOP);
        self.node(Kind::Await, &operands, data);
    }

    /// Whether that is certain.
    fn is_no_thenable(&mut self, value: Ssa) -> bool {
        if self.is(value, !T::OBJECT) {
            return true;
        }
        let shapes = self.knowledge.shapes_of(&mut self.graph, value);
        if shapes == ShapeSet::ANY || !self.is(value, T::FINAL_OBJECT | T::ARRAY) {
            return false;
        }
        let mut lookups: RootVec<_> = root_vec();
        for position in 0..self.graph.shapes.members(shapes).len() {
            let shape = self.shape_at(self.graph.shapes.members(shapes)[position]);
            if shape.is_dictionary() || shape.get(names::then).is_some() {
                return false;
            }
            match PrototypeLookup::for_miss(self.vm, shape.prototype_object(), names::then) {
                Some(lookup) => lookups.push(lookup),
                None => return false,
            }
        }
        lookups.iter().for_each(|&lookup| self.rely_on(lookup));
        true
    }

    fn fulfilled_promise(&mut self, value: Ssa) -> Ssa {
        let flags = PromiseStatus::Fulfilled as u16 | JsPromise::IS_RESOLVED;
        self.new_promise(flags, Some(value))
    }

    pub(super) fn async_return(&mut self, op: op::AsyncReturn) {
        let (generator, value) = (self.get(op.generator), self.get_value(op.value));
        let settle = |this: &mut Self| {
            let operands = [this.graph.root(generator), this.alias(value)];
            this.node(Kind::AsyncReturn, &operands, 0)
        };
        let promise = if !self.is(generator, T::EMPTY) || T::PROMISE == self.expected(value) {
            settle(self)
        } else if self.is_no_thenable(value) {
            self.fulfilled_promise(value)
        } else {
            let is_object = self.is_type(value, T::OBJECT);
            let promise = self.choose(is_object, Odds::Even, |this, is_object| {
                Some(if is_object {
                    settle(this)
                } else {
                    this.fulfilled_promise(value)
                })
            });
            promise.expect("nothing ends")
        };
        self.leave_with(promise);
    }

    pub(super) fn async_throw(&mut self, op: op::AsyncThrow) {
        let operands = [self.get(op.generator), self.get_value(op.value)];
        let operands = operands.map(|it| self.graph.root(it));
        let promise = self.node(Kind::AsyncThrow, &operands, 0);
        self.leave_with(promise);
    }

    pub(super) fn async_iterator_next(&mut self, op: op::AsyncIteratorNext, next: u32) {
        let (code_block, kind) = (self.frame().code_block, MetadataKind::IterationModes);
        let mut ways = modes_in(code_block.checked_metadata(kind, op.metadata));
        let Some(allocation) = self.async_function_allocation() else {
            return self.interpret();
        };
        let [iterator, method] = [0, 1].map(|index| self.frame().get(op.state.nth(index)));
        if let Some(known) = self.known_mode(method) {
            ways = [known].into_iter().collect();
        }
        // The two kinds are asked alike.
        ways.dedup_by_key(|it| *it == Mode::Generic);
        let (asker, value) = (self.get(op.generator), self.get(op.value));
        let queued = op.queued.from(self.frame().offset);
        let translate = |this: &mut Self, mode, mut otherwise: Otherwise<'_>| {
            let is_generic = this.is_in_mode(method, Mode::Generic);
            if mode == Mode::Generic {
                this.require_condition(is_generic, &mut otherwise);
                return this.goto_with(&[], next);
            }
            let has_marker = this.not(is_generic);
            this.require_condition(has_marker, &mut otherwise);
            let asker = this.ensure_coroutine(asker, allocation);
            let operands = [iterator, asker, value].map(|it| this.graph.root(it));
            let awaited = this.profiled_node(Kind::RequestStep, &operands, 0, T::UNDEFINED);
            this.goto_with(&[(op.generator, asker), (op.dst, awaited)], queued);
        };
        self.for_each_mode(&ways, translate, Self::interpret);
    }
}
