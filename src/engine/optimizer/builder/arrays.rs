//! Making arrays, and the lists that spreading makes.

use core::ptr;

use bun_engine_asm::FloatCond;
use bun_engine_bytecode::{MetadataKind, Register, op};
use bun_engine_codegen::ir::{Type, Value as Ssa};
use bun_engine_vm::code::metadata::NewArrayWithSpecies;
use bun_engine_vm::{
    ArrayAllocationProfile, ArrayModes, ElementKind, Gc, ImmutableArray, IndexingMode, JsArray,
    RealmWatchpoint, Shape, SpeculatedType as T, Storage, Value,
};
use smallvec::SmallVec;

use super::Builder;
use super::elements::heap_for;
use crate::graph::{ExitKind, Kind, ModeSet, ShapeSet, Vector, heaps};
use crate::runtime::cells::what_became_of_arrays;

pub(super) type Values = SmallVec<[Ssa; 8]>;

const MAX_INLINE_LENGTH: u32 = 64;
const MAX_REMEMBERED: i32 = 6;
/// Not a field: what is remembered for as long as an array has the elements that it was made with.
const AS_MADE: i32 = 1;

impl Builder<'_> {
    fn array_shape(&mut self, kind: ElementKind) -> Gc<Shape> {
        self.watch_realm(RealmWatchpoint::NotHavingABadTime);
        self.global().array_shape(kind)
    }

    pub(super) fn made_with_shape(&mut self, kind: Kind, operands: &[Ssa], allocation: u32) -> Ssa {
        let object = self.node(kind, operands, allocation);
        let shapes = ShapeSet::single(self.graph.allocations[allocation as usize].shape);
        (self.knowledge).learn_shapes(&self.graph, object, shapes, object);
        object
    }

    pub(in crate::builder) fn learn_length(&mut self, object: Ssa, length: Ssa) {
        let offset = Storage::OFFSET_OF_PUBLIC_LENGTH as i32;
        (self.knowledge).learn_field(object, offset, heaps::PUBLIC_LENGTH, length);
    }

    /// The elements are as the shape has them stored. Holes follow, up to the length.
    pub(super) fn new_with_elements(
        &mut self,
        (shape, size): (Gc<Shape>, usize),
        elements: &[Ssa],
        length: u32,
        room: u32,
    ) -> Ssa {
        let allocation = self.allocation(shape, size).expect("small");
        let size = Storage::size(0, Some(Storage::min_vector_length(room.max(length))));
        let allocator = self.vm.heap.auxiliary.allocator_for(size).expect("small");
        self.graph.allocations[allocation as usize].vector = Vector {
            allocator: (ptr::from_ref(allocator).addr() - ptr::from_ref(self.vm).addr()) as i32,
            cell_size: allocator.cell_size() as u32,
            length,
            initialized: elements.len() as u32,
        };
        let object = self.made_with_shape(Kind::NewArray, &[], allocation);
        let known_length = self.int32(length as i32);
        self.learn_length(object, known_length);
        let kind = shape.instance_indexing_mode().kind();
        let is_hole = |it| self.graph.function.constant_bits(it) == Some(kind.hole());
        let is_full = elements.len() == length as usize && !elements.iter().copied().any(is_hole);
        let (storage, modes) = (self.storage(object), ModeSet::of_kind(kind));
        for (&element, index) in elements.iter().zip(0..) {
            (self.ir()).store(element, storage, index * 8, heap_for(modes));
            if is_full && index < MAX_REMEMBERED {
                self.learn_element(object, modes, index.into(), element);
            }
        }
        if is_full {
            self.arrays_made.push((object, elements.into()));
            (self.knowledge).learn_field(object, AS_MADE, heaps::ELEMENTS, object);
        }
        object
    }

    /// At least `kind`.
    pub(super) fn kind_for(&self, mut kind: ElementKind, values: &[Ssa]) -> ElementKind {
        for &value in values.iter().filter(|&&it| !self.is(it, T::EMPTY)) {
            let expected = self.expected(value);
            let may_be = |ty: T, failure| {
                self.is(value, ty) || ty.contains(expected) && !self.has_exited(failure)
            };
            kind = kind.max(if may_be(T::INT32, ExitKind::BadType) {
                ElementKind::Int32
            } else if may_be(T::INT32 | T::REAL_DOUBLE, ExitKind::NotANumber) {
                ElementKind::Double
            } else {
                ElementKind::Contiguous
            });
        }
        kind
    }

    pub(super) fn as_element(&mut self, kind: ElementKind, value: Ssa) -> Ssa {
        match kind {
            ElementKind::Double if self.is(value, T::EMPTY) => {
                (self.graph.function).constant(Type::F64, kind.hole())
            }
            ElementKind::Double => {
                let number = self.as_number(value);
                let is_nan = (self.ir()).float_compare(FloatCond::Unordered, number, number);
                self.exit_if(is_nan, ExitKind::NotANumber);
                number
            }
            ElementKind::Int32 if !self.is(value, T::EMPTY) => {
                let int32 = self.as_int32(value);
                self.box_int32(int32)
            }
            _ => self.graph.root(value),
        }
    }

    /// The empty constant stands for a hole. There are no more than `MAX_INLINE_LENGTH`.
    pub(super) fn array_of(&mut self, kind: ElementKind, values: &[Ssa], room: u32) -> Ssa {
        let elements: Values = values.iter().map(|&it| self.as_element(kind, it)).collect();
        let cell = (self.array_shape(kind), size_of::<JsArray>());
        self.new_with_elements(cell, &elements, values.len() as u32, room)
    }

    pub(super) fn registers_from(&self, first: Register, count: u32) -> Values {
        (0..count)
            .map(|index| self.frame().get(first.nth(index)))
            .collect()
    }

    fn array_profile(&self, metadata: u32) -> (ElementKind, u32) {
        let code_block = self.frame().code_block;
        let kind = MetadataKind::NewArray;
        what_became_of_arrays(code_block.checked_metadata::<ArrayAllocationProfile>(kind, metadata))
    }

    pub(super) fn new_array(&mut self, op: op::NewArray) {
        if op.count > MAX_INLINE_LENGTH {
            return self.interpret();
        }
        let (kind, room) = self.array_profile(op.metadata);
        let values = self.registers_from(op.first, op.count);
        let kind = self.kind_for(kind.max(op.shape.into()), &values);
        let array = self.array_of(kind, &values, room);
        self.set(op.dst, array);
    }

    pub(super) fn new_array_from_constant(&mut self, op: op::NewArrayFromConstant) {
        let (code_block, kind) = (self.frame().code_block, MetadataKind::NewArray);
        let profile =
            (code_block.anchor()).checked_metadata::<ArrayAllocationProfile>(kind, op.metadata);
        let elements = code_block.constant(op.elements.0);
        let elements = elements.expect("an array").cast::<ImmutableArray>();
        let (kind, room) = what_became_of_arrays(profile);
        let may_share = self.watch_realm(RealmWatchpoint::NotHavingABadTime);
        let array = if profile.prefers_copy_of(elements.len()) {
            let values: Values = elements.iter().map(|it| self.value(it)).collect();
            self.array_of(kind.max(elements.kind()), &values, room)
        } else if may_share && kind <= elements.kind() {
            let mode = IndexingMode::array(elements.kind()).copy_on_write();
            let shape = self.global().original_array_shape(mode);
            let allocation = self.allocation(shape, size_of::<JsArray>());
            self.dependencies.keep(elements.upcast());
            let list = self.cell(elements.upcast());
            let array = self.made_with_shape(Kind::ShareList, &[list], allocation.expect("small"));
            let length = self.int32(elements.len() as i32);
            self.learn_length(array, length);
            array
        } else {
            return self.interpret();
        };
        self.set(op.dst, array);
    }

    /// What an array that still shares the elements of a constant has at the index.
    pub(super) fn shared_element(&mut self, array: Ssa, index: i64) -> Option<Value> {
        let list = self.graph.inside(self.graph.root(array), Kind::ShareList)?;
        let list = self.constant_cell::<ImmutableArray>(list)?;
        let shares = (self.knowledge).has_modes(&mut self.graph, array, ModeSet::SHARED);
        list.get(u32::try_from(index).ok().filter(|_| shares)?)
    }

    /// `first` is an address in the storage of `source`.
    pub(super) fn copy_elements(
        &mut self,
        source: Ssa,
        kind: ElementKind,
        first: Ssa,
        count: Ssa,
    ) -> Ssa {
        let shape = self.array_shape(kind);
        let allocation = self.allocation(shape, size_of::<JsArray>()).expect("small");
        let operands = [first, count, self.graph.root(source)];
        let copy = self.made_with_shape(Kind::CopyElements, &operands, allocation);
        self.learn_length(copy, count);
        copy
    }

    pub(super) fn may_be_length(&self, length: Ssa) -> bool {
        let failures = [ExitKind::NotAnInteger, ExitKind::OutOfBounds];
        T::BOXED_NUMBER.contains(self.expected(length))
            && !failures.into_iter().any(|it| self.has_exited(it))
    }

    /// The length is an I32.
    pub(super) fn array_of_holes(&mut self, kind: ElementKind, length: Ssa, room: u32) -> Ssa {
        let (shape, size) = (self.array_shape(kind), size_of::<JsArray>());
        let constant = self.graph.function.int_constant(length);
        if let Some(length) = constant.filter(|it| (0..=MAX_INLINE_LENGTH.into()).contains(it)) {
            return self.new_with_elements((shape, size), &[], length as u32, room);
        }
        let limit = self.int32(JsArray::MIN_SPARSE_CONSTRUCTION_LENGTH as i32);
        let length = self.check_bounds(length, limit);
        let allocation = self.allocation(shape, size).expect("small");
        self.graph.allocations[allocation as usize].vector.length = room;
        let shape = self.cell(shape.upcast());
        let array = self.made_with_shape(Kind::NewArrayOfHoles, &[length, shape], allocation);
        self.learn_length(array, length);
        array
    }

    pub(super) fn new_array_with_size(&mut self, op: op::NewArrayWithSize) {
        let length = self.get(op.length);
        if !self.may_be_length(length) {
            return self.interpret();
        }
        let (kind, room) = self.array_profile(op.metadata);
        let length = self.as_index(length);
        let array = self.array_of_holes(kind, length, room);
        self.set(op.dst, array);
    }

    /// Of a cell. It has one of the shapes that arrays of this realm start out with.
    pub(super) fn check_original_array(&mut self, value: Ssa) -> Ssa {
        let (global, shapes) = (
            self.global(),
            self.knowledge.shapes_of(&mut self.graph, value),
        );
        let is_original = |&it| global.is_original_array_shape(&self.shape_at(it));
        if shapes != ShapeSet::ANY && self.graph.shapes.members(shapes).iter().all(is_original) {
            return self.alias(value);
        }
        let operands = [self.alias(value), self.cell(global.cell())];
        let array = self.node(Kind::CheckOriginalArray, &operands, 0);
        (self.knowledge).learn_type(&self.graph, value, T::ARRAY, array);
        let modes = ModeSet::ARRAY.without(ModeSet::of_kind(ElementKind::None));
        (self.knowledge).learn_modes(&self.graph, value, modes, array);
        array
    }

    pub(super) fn new_array_with_species(&mut self, op: op::NewArrayWithSpecies) {
        let (code_block, kind) = (self.frame().code_block, MetadataKind::NewArrayWithSpecies);
        let entry =
            (code_block.anchor()).checked_metadata::<NewArrayWithSpecies>(kind, op.metadata);
        let (length, original) = (self.get(op.length), self.get(op.array));
        let Some(prediction) = self.prediction_or_exit(op.metadata) else {
            return;
        };
        if !self.may_be_length(length)
            || !T::ARRAY.contains(prediction)
            || self.has_exited(ExitKind::ExoticObject)
            || !self.watch_realm(RealmWatchpoint::ArraySpecies)
        {
            return self.interpret();
        }
        let usual =
            ArrayModes::STORED | ArrayModes::ARRAY | ArrayModes::COPY_ON_WRITE | ArrayModes::MIXED;
        self.assume_type(original, T::OBJECT);
        if usual.contains(entry.array.modes()) && !self.has_exited(ExitKind::BadShape) {
            self.check_original_array(original);
        } else {
            let original = self.alias(original);
            self.node(Kind::CheckSpeciesIsArray, &[original], 0);
        }
        let (kind, room) = what_became_of_arrays(&entry.allocation);
        let length = self.as_index(length);
        let array = self.array_of_holes(kind, length, room);
        self.set(op.dst, array);
    }

    // Lists

    /// What getting the elements one by one would give, if the array is as it has been made.
    pub(super) fn known_elements(&mut self, array: Ssa) -> Option<Values> {
        let root = self.graph.root(array);
        self.knowledge.field(root, AS_MADE, heaps::ELEMENTS)?;
        let shape = self.graph.allocations[self.graph.node(root)?.1 as usize].shape;
        if self.knowledge.shapes_of(&mut self.graph, root) != ShapeSet::single(shape) {
            return None;
        }
        let kind = self.graph.shapes[shape].indexing_mode.kind();
        let elements = (self.arrays_made.iter().rfind(|it| it.0 == root)?.1).clone();
        let tagged = elements.into_iter().map(|element| match kind {
            ElementKind::Double => self.box_element(element),
            _ => element,
        });
        Some(tagged.collect())
    }

    /// CreateListFromArrayLike
    pub(super) fn elements_as_list(&mut self, value: Ssa) -> Option<Values> {
        if self.is(value, T::ARRAY) {
            self.known_elements(value)
        } else {
            self.known_arguments(value)
        }
    }

    /// An array that can be read from as it is.
    pub(super) fn array_as_list(&mut self, value: Ssa) -> Option<Ssa> {
        let failures = [ExitKind::BadShape, ExitKind::BadElements];
        if !self.is(value, T::ARRAY) && self.expected(value) != T::ARRAY
            || failures.into_iter().any(|it| self.has_exited(it))
            || !self.watch_realm(RealmWatchpoint::ArrayPrototypeChainIsSane)
        {
            return None;
        }
        self.check_type_or(value, T::CELL, ExitKind::BadElements);
        self.check_original_array(value);
        Some(self.check_is_dense(value))
    }

    /// For a call that is about to copy from the list: the array that has just been spread, if that does as well.
    pub(super) fn without_copy(&mut self, list: Ssa) -> Ssa {
        let list = self.graph.root(list);
        let Some(spread) = self.graph.inside(list, Kind::SpreadElements) else {
            return list;
        };
        let is_in_no_state = !self.checkpoint.is_none()
            && !self.frame().has_handler()
            && self.graph.makes_again(self.checkpoint, list);
        let may_skip = is_in_no_state
            && self.graph.function.block_of(list) == self.block
            && self.watch_realm(RealmWatchpoint::ArrayIteratorProtocol);
        match may_skip.then(|| self.array_as_list(spread)).flatten() {
            Some(array) => {
                self.graph.function.remove(list);
                array
            }
            None => list,
        }
    }

    pub(super) fn list_of(&mut self, values: &[Ssa]) -> Ssa {
        let shape = self.vm.shapes.immutable_array(ElementKind::Contiguous);
        let size = ImmutableArray::allocation_size(values.len() as u32);
        let allocation = self.allocation(shape, size).expect("small");
        self.node(Kind::NewList, values, allocation)
    }

    /// What the parts stand for, if that is known. `is_list` is asked about positions.
    pub(super) fn flatten(&self, parts: &[Ssa], is_list: impl Fn(u32) -> bool) -> Option<Values> {
        let mut values = Values::new();
        for (&part, position) in parts.iter().zip(0..) {
            let root = self.graph.root(part);
            if !is_list(position) {
                values.push(part);
            } else if self.graph.kind(root) == Some(Kind::NewList) {
                values.extend_from_slice(self.graph.function.operands(root));
            } else {
                return None;
            }
        }
        (values.len() <= MAX_INLINE_LENGTH as usize).then_some(values)
    }

    pub(super) fn spread(&mut self, op: op::Spread) {
        const PLAIN: T = T::ARRAY
            .union(T::DIRECT_ARGUMENTS)
            .union(T::SCOPED_ARGUMENTS);
        let iterable = self.get(op.iterable);
        let root = self.graph.root(iterable);
        let made_in = self.graph.frame_at(self.graph.function.origin(root)).global;
        let is_pristine = made_in == self.global().address()
            && self.watch_realm(RealmWatchpoint::ArrayIteratorProtocol);
        let known = is_pristine
            .then(|| self.elements_as_list(iterable))
            .flatten();
        let list = if let Some(values) = known {
            self.list_of(&values)
        } else if PLAIN.contains(self.expected(iterable))
            && !self.has_exited(ExitKind::ExoticObject)
        {
            let object = self.check_type_or(iterable, PLAIN, ExitKind::ExoticObject);
            self.node(Kind::SpreadElements, &[object], 0)
        } else {
            self.node(Kind::Spread, &[root], 0)
        };
        self.set(op.dst, list);
    }

    pub(super) fn new_array_with_spread(&mut self, op: op::NewArrayWithSpread) {
        let (code_block, parts) = (
            self.frame().code_block,
            self.registers_from(op.first, op.count),
        );
        let is_list = |position| code_block.body().is_spread(op.mask, position);
        let array = match self.flatten(&parts, is_list) {
            Some(values) => {
                let kind = match self.kind_for(ElementKind::Int32, &values) {
                    ElementKind::Int32 => ElementKind::Int32,
                    _ => ElementKind::Contiguous,
                };
                self.array_of(kind, &values, 0)
            }
            None => {
                let roots: Values = parts.iter().map(|&it| self.graph.root(it)).collect();
                let array = self.node(Kind::NewArrayWithSpread, &roots, 0);
                let modes = ModeSet::ARRAY.and(ModeSet::VALUES);
                (self.knowledge).learn_modes(&self.graph, array, modes, array);
                array
            }
        };
        self.set(op.dst, array);
    }
}
