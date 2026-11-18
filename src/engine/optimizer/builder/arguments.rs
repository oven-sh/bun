//! The arguments, where they are not just parameters.

use bun_engine_bytecode::{BlockIndex, Instruction, Opcode, Register, op};
use bun_engine_codegen::ir::{Access, AccessFlags, Heap, Type, Value as Ssa};
use bun_engine_text::{names, symbols};
use bun_engine_vm::call::MAX_ARGUMENTS;
use bun_engine_vm::{
    CallFrame, ClonedArguments, ElementKind, Gc, JsArray, JsObject, MappedArguments,
    RealmWatchpoint, ScopeTemplate, Shape, SpeculatedType as T, Value,
};

use super::Builder;
use super::arrays::Values;
use super::fork::{Fork, Odds};
use super::frame::{ArgumentCount, Junction};
use crate::graph::{ExitKind, Kind, ShapeSet, heaps};

const MAX_INLINE_COUNT: usize = 32;
/// Not a field: the address of the arguments of an inlined function, once they have been put in memory.
const IN_MEMORY: i32 = 2;

impl Builder<'_> {
    fn bounded_argument_count(&mut self, skip: u32) -> Ssa {
        let count = self.arguments_after(skip);
        match self.frame().argument_count {
            ArgumentCount::Known(_) => count,
            ArgumentCount::InFrame => self.at_most(count, MAX_ARGUMENTS as u32),
        }
    }

    /// An I32 that is not negative.
    fn arguments_after(&mut self, skip: u32) -> Ssa {
        let (count, none) = (self.argument_count(), self.int32(0));
        if skip == 0 {
            return count;
        }
        let mut ir = self.ir();
        let (rest, are_few) = (ir.sub(count, skip), ir.below(count, skip));
        ir.select(are_few, none, rest)
    }

    /// In the frame on the stack.
    fn address_of_argument(&mut self, index: u32) -> Ssa {
        self.flush_arguments();
        let frame = self.frame_pointer();
        (self.ir()).add(frame, CallFrame::OFFSET_OF_ARGUMENTS + index as usize * 8)
    }

    pub(super) fn few_arguments(&mut self, skip: u32) -> Option<Values> {
        self.own_arguments(skip)
            .filter(|it| it.len() <= MAX_INLINE_COUNT)
    }

    fn profile_argument(&mut self, value: Ssa, prediction: T, metadata: u32) {
        self.graph.declare(value, T::HEAP_TOP);
        self.graph.predict(value, prediction);
        self.note_profile(value, metadata);
    }

    pub(super) fn get_argument(&mut self, op: op::GetArgument) {
        let (frame, undefined) = (self.frame_pointer(), self.undefined());
        let (register, slots) = (
            Register::argument(op.index),
            self.frame().argument_registers().count() as u32,
        );
        let held = (op.index + 1 < slots).then(|| self.frame().get(register));
        let value = match (self.frame().argument_count, held) {
            (ArgumentCount::Known(count), Some(held)) if op.index + 1 < count => held,
            (ArgumentCount::Known(_), _) => undefined,
            (_, Some(held)) if self.frame().is_in_place(register) => held,
            (ArgumentCount::InFrame, _) => {
                let Some(prediction) = self.prediction_or_exit(op.metadata) else {
                    return;
                };
                let count = self.argument_count();
                let is_there = self.ir().above(count, op.index);
                let found = held.map(|it| self.graph.root(it)).unwrap_or_else(|| {
                    let [there, elsewhere] =
                        [register, Register::CALLEE].map(|it| self.word(it.offset() as usize * 8));
                    let mut ir = self.ir();
                    let offset = ir.select(is_there, there, elsewhere);
                    let address = ir.add(frame, offset);
                    let access = Access::new(heaps::FRAME, AccessFlags::ALWAYS_READABLE);
                    ir.load(Type::I64, address, 0, access)
                });
                let value = self.ir().select(is_there, found, undefined);
                self.profile_argument(value, prediction, op.metadata);
                value
            }
        };
        self.set(op.dst, value);
    }

    fn rest(&mut self, skip: u32) -> Option<Ssa> {
        let kind = ElementKind::Contiguous;
        if let Some(values) = self.few_arguments(skip) {
            return Some(self.array_of(kind, &values, 0));
        }
        self.frame().is_root().then(|| {
            self.watch_realm(RealmWatchpoint::NotHavingABadTime);
            let cell = (self.global().array_shape(kind), size_of::<JsArray>());
            self.copy_arguments(cell, skip)
        })
    }

    pub(super) fn create_rest(&mut self, op: op::CreateRest) {
        let rest = self.rest(op.skip);
        self.set_or_interpret(op.dst, rest);
    }

    fn copy_arguments(&mut self, (shape, size): (Gc<Shape>, usize), skip: u32) -> Ssa {
        let operands = [self.address_of_argument(skip), self.arguments_after(skip)];
        let allocation = self.allocation(shape, size).expect("small");
        self.made_with_shape(Kind::NewArrayFromFrame, &operands, allocation)
    }

    fn unmapped_arguments(&mut self) -> Option<Ssa> {
        let global = self.global();
        self.watch_realm(RealmWatchpoint::NotHavingABadTime);
        let cell = (
            global.cloned_arguments_shape(self.vm),
            size_of::<ClonedArguments>(),
        );
        let count = self.argument_count();
        let initial = [
            (names::length, self.box_int32(count)),
            (
                names::callee,
                self.cell(global.throw_type_error_accessor(self.vm).cell()),
            ),
            (
                symbols::iterator,
                self.cell(global.array_prototype_values().cell()),
            ),
        ];
        let object = if let Some(values) = self.few_arguments(0) {
            let roots: Values = values.iter().map(|&it| self.graph.root(it)).collect();
            self.new_with_elements(cell, &roots, roots.len() as u32, 0)
        } else if self.frame().is_root() {
            self.copy_arguments(cell, 0)
        } else {
            return None;
        };
        for (index, (name, value)) in initial.into_iter().enumerate() {
            let heap = self.heap_member(heaps::Family::Named, name.address());
            let offset = size_of::<JsObject>() + index * 8;
            self.initialize(object, offset as i32, heap, value);
        }
        Some(object)
    }

    fn initialize_for_good(&mut self, object: Ssa, offset: usize, value: Ssa) {
        (self.ir()).store(value, object, offset as i32, heaps::OTHER_FIELDS);
        (self.knowledge).learn_field(object, offset as i32, Heap::NOTHING, value);
    }

    /// With a scope, the first of its slots are the parameters.
    fn mapped_arguments(&mut self, scope: Option<(Ssa, u32)>) -> Option<Ssa> {
        let global = self.global();
        let (shape, parameters, skip) = match scope {
            Some((_, mapped)) => (global.scoped_arguments_shape(self.vm), mapped, mapped),
            None => (
                global.direct_arguments_shape(self.vm),
                self.frame().code_block.parameters() - 1,
                0,
            ),
        };
        let (count, undefined) = (self.argument_count(), self.undefined());
        let padded = if scope.is_some() { 0 } else { parameters };
        let object = if let Some(mut values) = self.few_arguments(skip) {
            values.resize(values.len().max(padded as usize), undefined);
            let size = MappedArguments::offset_of_slot(values.len() as u32);
            let allocation = self.allocation(shape, size)?;
            let object = self.made_with_shape(Kind::NewArguments, &[], allocation);
            for (&value, index) in values.iter().zip(0..) {
                let (offset, value) = (
                    MappedArguments::offset_of_slot(index),
                    self.graph.root(value),
                );
                self.initialize(object, offset as i32, heaps::ARGUMENT_SLOTS, value);
            }
            object
        } else if self.frame().is_root() {
            // The frame has been padded.
            let (rest, least) = (self.arguments_after(skip), self.int32(padded as i32));
            let are_few = self.ir().below(rest, least);
            let slots = self.ir().select(are_few, least, rest);
            let operands = [self.address_of_argument(skip), slots];
            let allocation = self.allocation(shape, size_of::<MappedArguments>())?;
            self.made_with_shape(Kind::NewArgumentsFromFrame, &operands, allocation)
        } else {
            return None;
        };
        let callee = self.graph.root(self.frame().get(Register::CALLEE));
        let (parameters, none) = (self.int32(parameters as i32), self.empty());
        let scope = scope.map_or(none, |(scope, _)| self.graph.root(scope));
        self.initialize_for_good(object, MappedArguments::OFFSET_OF_CALLEE, callee);
        self.initialize_for_good(object, MappedArguments::OFFSET_OF_LENGTH, count);
        self.initialize_for_good(object, MappedArguments::OFFSET_OF_PARAMETERS, parameters);
        self.initialize_for_good(object, MappedArguments::OFFSET_OF_SCOPE, scope);
        let offset = MappedArguments::OFFSET_OF_PLAIN_LENGTH as i32;
        self.initialize(object, offset, heaps::OTHER_FIELDS, count);
        Some(object)
    }

    /// Whether it has been made here, and `length`, `callee` and `Symbol.iterator` are where they were then.
    pub(super) fn has_shape_as_made(&mut self, object: Ssa) -> bool {
        let root = self.graph.root(object);
        let made = self.graph.node(root).filter(|it| it.0.allocates());
        made.is_some_and(|(_, data)| {
            let shape = ShapeSet::single(self.graph.allocations[data as usize].shape);
            self.knowledge.shapes_of(&mut self.graph, root) == shape
        })
    }

    /// What getting `length`, the elements and the iterator of an arguments object would come to.
    pub(super) fn known_arguments(&mut self, object: Ssa) -> Option<Values> {
        let root = self.graph.root(object);
        if self.graph.kind(root) != Some(Kind::NewArguments) {
            let values = self.known_elements(root)?;
            let initial = [
                (names::length, Value::int32(values.len() as i32)),
                (
                    symbols::iterator,
                    self.global().array_prototype_values().into(),
                ),
            ];
            let slots = [ClonedArguments::LENGTH, ClonedArguments::ITERATOR];
            let mut pairs = initial.into_iter().zip(slots);
            let are_initial = pairs.all(|((name, value), slot)| {
                let heap = self.heap_member(heaps::Family::Named, name.address());
                let known = (self.knowledge).field(root, slot.byte_offset() as i32, heap);
                known.and_then(|it| self.constant_value(it)) == Some(value)
            });
            return are_initial.then_some(values);
        }
        if !self.is(root, T::DIRECT_ARGUMENTS) || !self.has_shape_as_made(root) {
            return None;
        }
        let field = |offset: usize, heap| self.knowledge.field(root, offset as i32, heap);
        let length = field(MappedArguments::OFFSET_OF_LENGTH, Heap::NOTHING)?;
        let plain = field(MappedArguments::OFFSET_OF_PLAIN_LENGTH, heaps::OTHER_FIELDS)?;
        let count = (self.graph.function.int_constant(length)).filter(|_| plain == length)?;
        let slot = |it| field(MappedArguments::offset_of_slot(it), heaps::ARGUMENT_SLOTS);
        (0..count as u32).map(slot).collect()
    }

    fn set_or_interpret(&mut self, dst: Register, value: Option<Ssa>) {
        match value {
            Some(value) => self.set(dst, value),
            None => self.interpret(),
        }
    }

    pub(super) fn create_direct_arguments(&mut self, op: op::CreateDirectArguments) {
        let object = self.mapped_arguments(None);
        self.set_or_interpret(op.dst, object);
    }

    pub(super) fn create_scoped_arguments(&mut self, op: op::CreateScopedArguments) {
        let scope = self.get(op.scope);
        let root = self.graph.root(scope);
        let template = (self.graph.kind(root) == Some(Kind::NewScope))
            .then(|| self.constant_cell::<ScopeTemplate>(self.graph.operand(root, 1)))
            .flatten();
        let mapped = template.map(|it| it.scope().mapped_parameters());
        let object = mapped.and_then(|mapped| self.mapped_arguments(Some((scope, mapped))));
        self.set_or_interpret(op.dst, object);
    }

    pub(super) fn create_unmapped_arguments(&mut self, op: op::CreateUnmappedArguments) {
        let object = self.unmapped_arguments();
        self.set_or_interpret(op.dst, object);
    }

    pub(super) fn get_from_arguments(&mut self, op: op::GetFromArguments) {
        let (arguments, offset) = (
            self.get(op.arguments),
            MappedArguments::offset_of_slot(op.index) as i32,
        );
        let (root, heap) = (self.graph.root(arguments), heaps::ARGUMENT_SLOTS);
        if let Some(known) = self.knowledge.field(root, offset, heap) {
            return self.set(op.dst, known);
        }
        if let Some(prediction) = self.prediction_or_exit(op.metadata) {
            let arguments = self.alias(arguments);
            let value = self.load_value_of_type((arguments, offset, heap), prediction, T::HEAP_TOP);
            self.note_profile(value, op.metadata);
            self.set(op.dst, value);
        }
    }

    pub(super) fn put_to_arguments(&mut self, op: op::PutToArguments) {
        let (arguments, value) = (self.get(op.arguments), self.get(op.value));
        let (arguments, offset) = (
            self.alias(arguments),
            MappedArguments::offset_of_slot(op.index) as i32,
        );
        self.store_value(arguments, arguments, offset, heaps::ARGUMENT_SLOTS, value);
    }

    // While there is no object

    pub(super) fn ensure_arguments(&mut self, op: op::EnsureArguments) {
        self.ensure(op.arguments, |this| match op.mapped {
            true => this.mapped_arguments(None),
            false => this.unmapped_arguments(),
        });
    }

    pub(super) fn ensure_rest(&mut self, op: op::EnsureRest) {
        self.ensure(op.rest, |this| this.rest(op.skip));
    }

    fn ensure(&mut self, register: Register, make: impl Fn(&mut Self) -> Option<Ssa>) {
        let arguments = self.get(register);
        let slots = self.frame().argument_registers().count();
        if !self.frame().is_root() && slots > MAX_INLINE_COUNT {
            return self.interpret();
        }
        let is_missing = self.is_type(arguments, T::EMPTY);
        let object = self.choose(
            is_missing,
            Odds::Even,
            |this, is_missing| match is_missing {
                true => make(this),
                false => Some(arguments),
            },
        );
        let object = object.expect("small");
        self.assume_type(object, T::OBJECT);
        self.set(register, object);
    }

    /// Whether there is certain to be no object, once that has been checked.
    pub(super) fn try_without_object(&mut self, arguments: Ssa) -> bool {
        let is_likely = self.is(arguments, T::EMPTY)
            || self.expected(arguments) == T::EMPTY && !self.has_exited(ExitKind::ExoticObject);
        if is_likely {
            self.check_type_or(arguments, T::EMPTY, ExitKind::ExoticObject);
        }
        is_likely
    }

    pub(super) fn get_arguments_length(&mut self, op: op::GetArgumentsLength) {
        let arguments = self.get(op.arguments);
        let is_missing = if self.try_without_object(arguments) {
            self.int32(1)
        } else if (T::ARRAY | T::EMPTY).contains(self.expected(arguments))
            && !self.has_exited(ExitKind::BadElements)
        {
            self.is_type(arguments, T::EMPTY)
        } else {
            return self.interpret_or_exit(op.metadata);
        };
        let count = self.choose(is_missing, Odds::Even, |this, is_missing| {
            let count = match is_missing {
                true => this.bounded_argument_count(op.skip),
                false => this.length_of_dense_array(arguments),
            };
            Some(this.box_int32(count))
        });
        self.set(op.dst, count.expect("a number"));
    }

    pub(super) fn spread_arguments(&mut self, op: op::SpreadArguments) {
        let arguments = self.get(op.arguments);
        let done = self.target_at(op.done.from(self.frame().offset));
        if !(self.knowledge.type_of(&self.graph, arguments)).intersects(T::EMPTY)
            || !self.watch_realm(RealmWatchpoint::ArrayIteratorProtocol)
        {
            return;
        }
        let list = if op.for_call {
            self.empty()
        } else if let Some(values) = self.few_arguments(op.skip) {
            self.list_of(&values)
        } else {
            return;
        };
        let (fork, mut with_object) = (self.fork_later(), Junction::default());
        if !self.try_without_object(arguments) {
            let is_missing = self.is_type(arguments, T::EMPTY);
            self.leave_unless(is_missing, Odds::Even, &mut with_object);
        }
        self.jump_with(op.dst, list, done, &fork, &with_object);
    }

    /// Goes on with the next instruction on the ways to `otherwise`, if there are any.
    fn jump_with(
        &mut self,
        dst: Register,
        value: Ssa,
        done: BlockIndex,
        fork: &Fork,
        otherwise: &Junction,
    ) {
        let old = self.frame().get(dst);
        self.set(dst, value);
        self.goto(done);
        if !otherwise.edges.is_empty() {
            self.resume_at(fork, otherwise);
            self.frame_mut().set(dst, old);
        }
    }

    /// The index is below the number of those from `skip` on.
    fn argument_at(
        &mut self,
        (skip, index): (u32, Ssa),
        flags: AccessFlags,
        (seen, metadata): (T, u32),
    ) -> Ssa {
        let (first, heap) = if self.frame().is_root() {
            (self.address_of_argument(skip), heaps::FRAME)
        } else {
            let values = self.own_arguments(0).expect("known");
            let constant = self.graph.function.int_constant(index);
            let position = constant.and_then(|it| usize::try_from(it).ok());
            if let Some(&value) = position.and_then(|it| values.get(skip as usize + it)) {
                return value;
            }
            let all = self.arguments_in_memory(&values);
            (self.ir().add(all, skip * 8), heaps::COPIED_VALUES)
        };
        let address = self.element_address(first, index);
        let value = (self.ir()).load(Type::I64, address, 0, Access::new(heap, flags));
        self.profile_argument(value, seen, metadata);
        value
    }

    fn arguments_in_memory(&mut self, values: &[Ssa]) -> Ssa {
        let entry = self.graph.frames[self.frame().index.index()].entry;
        let known = self.knowledge.field(entry, IN_MEMORY, Heap::NOTHING);
        known.unwrap_or_else(|| {
            let roots: Values = values.iter().map(|&it| self.graph.root(it)).collect();
            let address = self.node(Kind::CopyToMemory, &roots, 0);
            (self.knowledge).learn_field(entry, IN_MEMORY, Heap::NOTHING, address);
            address
        })
    }

    /// What the access that follows, for when there is an object, has given so far.
    fn seen_with_object(&self, next: u32) -> T {
        let code = self.frame().code_block.body().instructions();
        let (_, size) = Instruction::read(code, next);
        match Instruction::read(code, next + size).0 {
            Instruction::GetByVal(op) => self.prediction_at(op.metadata),
            _ => T::HEAP_TOP,
        }
    }

    /// What says that the object, which the next instruction makes, would inherit no elements.
    fn has_sane_prototypes(&mut self, next: u32) -> bool {
        match self.frame().code_block.opcode_at(next) {
            Some(Opcode::EnsureArguments) => {
                self.watch_realm(RealmWatchpoint::ObjectPrototypeChainIsSane)
            }
            Some(Opcode::EnsureRest) => {
                self.watch_realm(RealmWatchpoint::ArrayPrototypeChainIsSane)
            }
            _ => false,
        }
    }

    pub(super) fn get_argument_by_val(&mut self, op: op::GetArgumentByVal, next: u32) {
        let (arguments, key) = (self.get(op.arguments), self.get(op.key));
        let done = self.target_at(op.done.from(self.frame().offset));
        let (seen, otherwise) = (self.prediction_at(op.metadata), self.seen_with_object(next));
        if (seen | otherwise).is_empty() && !self.has_exited(ExitKind::NeverExecuted) {
            return self.force_exit(ExitKind::NeverExecuted);
        }
        let known = self.knowledge.type_of(&self.graph, arguments);
        if !known.intersects(T::EMPTY) || !self.may_be_index(key) {
            return;
        }
        let profile = (
            if seen.is_empty() { T::HEAP_TOP } else { seen },
            op.metadata,
        );
        let may_be_outside = !otherwise.is_empty() || self.has_exited(ExitKind::OutOfBounds);
        if !may_be_outside && self.try_without_object(arguments) {
            let (index, count) = (self.as_index(key), self.bounded_argument_count(op.skip));
            let place = (op.skip, self.check_bounds(index, count));
            let value = self.argument_at(place, AccessFlags::ALWAYS_READABLE, profile);
            self.set(op.dst, value);
            return self.goto(done);
        }
        let (index, count) = (self.as_index(key), self.bounded_argument_count(op.skip));
        let (fork, mut with_object) = (self.fork_later(), Junction::default());
        let is_missing = self.is_type(arguments, T::EMPTY);
        self.leave_unless(is_missing, Odds::Even, &mut with_object);
        let is_outside = self.ir().above_or_equal(index, count);
        let value = if self.has_sane_prototypes(next) {
            let is_negative = self.ir().less_than(index, 0);
            self.leave_if(is_negative, Odds::Low, &mut with_object);
            let value = self.choose(is_outside, Odds::Even, |this, is_outside| {
                Some(match is_outside {
                    true => this.value(Value::UNDEFINED),
                    false => this.argument_at((op.skip, index), AccessFlags::empty(), profile),
                })
            });
            value.expect("a value")
        } else {
            self.leave_if(is_outside, Odds::Even, &mut with_object);
            self.argument_at((op.skip, index), AccessFlags::empty(), profile)
        };
        self.jump_with(op.dst, value, done, &fork, &with_object);
    }
}
