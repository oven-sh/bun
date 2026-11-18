//! Making what has elements.

use bun_engine_asm::{Sign, Size};
use bun_engine_codegen::ir::{
    Access, AccessFlags, Action, EffectFlags, Effects, Heap, Input, Op, Output, Type, Value as Ssa,
};
use bun_engine_vm::heap::{self, ATOM_SIZE, Allocator, LARGE_CUTOFF, SIZE_CLASS_OF_STEP};
use bun_engine_vm::{
    ElementKind, ElementType, GlobalObject, ImmutableArray, JsArrayBufferView as View, JsCell,
    JsObject, MappedArguments, Storage, Vm,
};

use super::emit::Site;
use super::operations::while_collecting;
use super::{Lowering, Odds};
use crate::graph::{ExitKind, heaps};
use crate::runtime::operations::Operation;
use crate::runtime::operations::elements as operations;

const WORD: usize = size_of::<u64>();
const MAX_WORDS: u32 = (LARGE_CUTOFF / WORD) as u32;
const CELLS: usize = Vm::OFFSET_OF_HEAP + heap::Heap::offset_of_field("cells");
const AUXILIARY: usize = Vm::OFFSET_OF_HEAP + heap::Heap::offset_of_field("auxiliary");

impl Lowering<'_> {
    fn kind_of(&self, allocation: u32) -> ElementKind {
        let shape = self.graph.allocations[allocation as usize].shape;
        self.graph.shapes[shape].indexing_mode.kind()
    }

    /// The number of words is an I32 that is even, and at most `MAX_WORDS`.
    fn allocate_small(&mut self, space: usize, words: Ssa) -> Ssa {
        let (table, vm) = (
            self.word(SIZE_CLASS_OF_STEP.as_ptr().addr() as u64),
            self.vm(),
        );
        let mut ir = self.ir();
        let steps = ir.shr(words, (ATOM_SIZE / WORD).ilog2());
        let steps = ir.zero_extend(steps);
        let entry = ir.add(table, steps);
        let access = Access::new(heaps::OTHER_FIELDS, AccessFlags::IMMUTABLE);
        let class = ir.load_narrow(Size::S8, Sign::Unsigned, entry, 0, access);
        let offset = ir.mul(class, size_of::<Allocator>());
        let offset = ir.zero_extend(offset);
        let first = ir.add(vm, space);
        let allocator = ir.add(first, offset);
        let effects = while_collecting(Heap::NOTHING);
        let mut data = self.patchpoint(Action::Custom, Site::AllocateFrom, effects);
        data.scratch_gprs = 1;
        let (input, output) = (Input::LateRegister, Output::EarlyRegister);
        (self.ir()).patchpoint(&data, &[(allocator, input)], &[(Type::I64, output)])
    }

    fn allocate_words(&mut self, space: usize, words: Ssa, if_large: Operation) -> Ssa {
        let is_large = self.ir().above(words, MAX_WORDS);
        self.choose(
            is_large,
            Odds::Low,
            Type::I64,
            |this| this.call_operation(if_large, &[words]),
            |this| this.allocate_small(space, words),
        )
    }

    pub(super) fn write_elements(&mut self, site: Site, operands: &[(Ssa, Input)]) {
        let mut data = self.patchpoint(Action::Custom, site, self.writing_elements());
        data.scratch_gprs = matches!(site, Site::CopyWords).into();
        data.scratch_fprs = matches!(site, Site::FillPairs(..) | Site::FillPairsBelow(_)).into();
        self.ir().patchpoint(&data, operands, &[]);
    }

    fn writing_elements(&self) -> Effects {
        Effects {
            reads: self.graph.function.effects(self.at).reads,
            writes: heaps::ELEMENTS,
            flags: EffectFlags::CONTROL_DEPENDENT,
        }
    }

    fn copy_words(&mut self, target: Ssa, source: Ssa, count: Ssa) {
        const MOST_IN_LINE: i32 = 24;
        let are_many = self.ir().above(count, MOST_IN_LINE);
        let call = |this: &mut Self| {
            let (args, effects) = ([target, source, count], this.writing_elements());
            this.call_with_effects(operations::COPY_WORDS, &args, &[], effects);
            Ssa::NONE
        };
        let copy = |this: &mut Self| {
            let operands = [
                (target, Input::LateRegister),
                (source, Input::LateRegister),
                (count, Input::ConsumedRegister),
            ];
            this.write_elements(Site::CopyWords, &operands);
            Ssa::NONE
        };
        self.choose(are_many, Odds::Low, Type::Void, call, copy);
    }

    /// `base` is where the lengths go. Gives the object and the storage.
    fn object_with_vector(&mut self, allocation: u32, base: Ssa, lengths: [Ssa; 2]) -> [Ssa; 2] {
        let object = self.allocate(allocation);
        let storage = self.ir().add(base, WORD);
        let mut ir = self.ir();
        let offset = Storage::OFFSET_OF_PUBLIC_LENGTH as i32;
        ir.store(lengths[0], storage, offset, heaps::PUBLIC_LENGTH);
        let offset = Storage::OFFSET_OF_VECTOR_LENGTH as i32;
        ir.store(lengths[1], storage, offset, heaps::VECTOR_LENGTH);
        self.store(storage, object, JsObject::OFFSET_OF_STORAGE, heaps::STORAGE);
        [object, storage]
    }

    fn store_hole(&mut self, kind: ElementKind, storage: Ssa, offset: usize) {
        let hole = self.word(kind.hole());
        self.store(hole, storage, offset, heaps::ELEMENTS);
    }

    pub(super) fn new_array(&mut self, allocation: u32) -> Ssa {
        let (kind, vector) = (
            self.kind_of(allocation),
            self.graph.allocations[allocation as usize].vector,
        );
        let base = self.allocate_memory(vector.allocator, vector.cell_size);
        let vector_length = vector.cell_size / WORD as u32 - 1;
        let lengths = [vector.length, vector_length].map(|it| self.int32(it as i32));
        let [object, storage] = self.object_with_vector(allocation, base, lengths);
        self.expect_stores(storage, vector.initialized * WORD as u32, object);
        // An odd number, so that those with an odd index start a pair.
        let first_pair = vector.initialized | 1;
        if first_pair != vector.initialized {
            self.store_hole(kind, storage, vector.initialized as usize * WORD);
        }
        if first_pair < vector_length {
            let site = Site::FillPairs(kind.hole(), first_pair, vector_length);
            self.write_elements(site, &[(storage, Input::Register)]);
        }
        let function = &mut self.graph.function;
        let next = function.next(self.at);
        if let Op::Load {
            address, access, ..
        } = *function.op(next)
            && address == self.at
            && access.heap() == heaps::STORAGE
        {
            function.replace(next, storage);
        }
        object
    }

    pub(super) fn new_array_of_holes(&mut self, length: Ssa, shape: Ssa, allocation: u32) -> Ssa {
        let room = self.graph.allocations[allocation as usize].vector.length;
        let (kind, is_large) = (
            self.kind_of(allocation),
            self.ir().above_or_equal(length, MAX_WORDS),
        );
        let small = |this: &mut Self| {
            let least = this.int32(room.max(Storage::MIN_VECTOR_LENGTH) as i32);
            let mut ir = this.ir();
            let is_short = ir.below(length, least);
            let wanted = ir.select(is_short, least, length);
            let vector_length = ir.or(wanted, 1);
            let words = ir.add(vector_length, 1);
            let base = this.allocate_small(AUXILIARY, words);
            let lengths = [length, vector_length];
            let [object, storage] = this.object_with_vector(allocation, base, lengths);
            this.store_hole(kind, storage, 0);
            let operands = [
                (storage, Input::LateRegister),
                (vector_length, Input::ConsumedRegister),
            ];
            this.write_elements(Site::FillPairsBelow(kind.hole()), &operands);
            object
        };
        let large =
            |this: &mut Self| this.call_operation(operations::NEW_LONG_ARRAY, &[shape, length]);
        self.choose(is_large, Odds::Low, Type::I64, large, small)
    }

    pub(super) fn new_array_from_frame(&mut self, source: Ssa, count: Ssa, allocation: u32) -> Ssa {
        let mut ir = self.ir();
        let vector_length = ir.or(count, 1);
        let words = ir.add(vector_length, 1);
        let base = self.allocate_words(AUXILIARY, words, operations::ALLOCATE_LARGE_STORAGE);
        let [object, storage] = self.object_with_vector(allocation, base, [count, vector_length]);
        let mut ir = self.ir();
        let wide = ir.zero_extend(vector_length);
        let offset = ir.shl(wide, WORD.ilog2());
        let last = ir.add(base, offset);
        self.store_hole(self.kind_of(allocation), last, 0);
        self.copy_words(storage, source, count);
        object
    }

    pub(super) fn copy_elements(&mut self, first: Ssa, count: Ssa, allocation: u32) -> Ssa {
        let (owner, copy) = (
            self.operands()[2],
            self.new_array_from_frame(first, count, allocation),
        );
        self.keep_alive(owner);
        copy
    }

    pub(super) fn new_arguments_from_frame(&mut self, source: Ssa, count: Ssa, data: u32) -> Ssa {
        let mut ir = self.ir();
        let words = ir.add(count, MappedArguments::OFFSET_OF_SLOTS / WORD + 1);
        let words = ir.and(words, -2);
        let object = self.allocate_words(CELLS, words, operations::ALLOCATE_LARGE_CELL);
        let (header, none) = (self.header_for(data), self.word(0));
        self.store(header, object, 0, heaps::SHAPE);
        self.store(none, object, JsObject::OFFSET_OF_STORAGE, heaps::STORAGE);
        let slots = self.ir().add(object, MappedArguments::OFFSET_OF_SLOTS);
        self.copy_words(slots, source, count);
        object
    }

    fn clear_pairs(&mut self, first: Ssa, words: Ssa, effects: Effects) {
        const MOST_IN_LINE: i32 = 16;
        let are_many = self.ir().above(words, MOST_IN_LINE);
        let call = |this: &mut Self| {
            this.call_with_effects(operations::CLEAR_WORDS, &[first, words], &[], effects);
            Ssa::NONE
        };
        let clear = |this: &mut Self| {
            let mut data = this.patchpoint(Action::Custom, Site::ClearPairs, effects);
            data.scratch_fprs = 1;
            let operands = [
                (first, Input::LateRegister),
                (words, Input::ConsumedRegister),
            ];
            this.ir().patchpoint(&data, &operands, &[]);
            Ssa::NONE
        };
        self.choose(are_many, Odds::Even, Type::Void, call, clear);
    }

    pub(super) fn new_typed_array(&mut self, length: Ssa, shape: Ssa, allocation: u32) -> Ssa {
        let facts = &self.graph.shapes[self.graph.allocations[allocation as usize].shape];
        let of = ElementType::of_cell_type(facts.cell_type).expect("a typed array");
        let less = self.ir().sub(length, 1);
        let is_unusual =
            (self.ir()).above_or_equal(less, View::MAX_SMALL_LENGTH.min(MAX_WORDS as usize));
        let small = |this: &mut Self| {
            let mut ir = this.ir();
            let bytes = ir.shl(length, of.size_shift());
            let bytes = ir.add(bytes, ATOM_SIZE - 1);
            let words = ir.shr(bytes, WORD.ilog2());
            let words = ir.and(words, -2);
            let vector = this.allocate_small(AUXILIARY, words);
            let (view, none) = (this.allocate_object(allocation), this.word(0));
            let wide = this.ir().zero_extend(length);
            this.store(vector, view, View::OFFSET_OF_VECTOR, heaps::VIEW_VECTOR);
            this.store(wide, view, View::OFFSET_OF_LENGTH, heaps::VIEW_LENGTH);
            this.store(none, view, View::OFFSET_OF_BYTE_OFFSET, heaps::VIEW_LENGTH);
            this.store(none, view, View::OFFSET_OF_BUFFER, heaps::VIEW_LENGTH);
            let effects = Effects {
                writes: heaps::TYPED_ELEMENTS,
                ..Effects::with_flags(EffectFlags::CONTROL_DEPENDENT)
            };
            this.clear_pairs(vector, words, effects);
            view
        };
        let other =
            |this: &mut Self| this.call_operation(operations::NEW_TYPED_ARRAY, &[shape, length]);
        self.choose(is_unusual, Odds::Low, Type::I64, other, small)
    }

    pub(super) fn share_list(&mut self, list: Ssa, allocation: u32) -> Ssa {
        let array = self.allocate(allocation);
        let storage = self.ir().add(list, ImmutableArray::OFFSET_OF_ELEMENTS);
        self.store(storage, array, JsObject::OFFSET_OF_STORAGE, heaps::STORAGE);
        array
    }

    pub(super) fn new_list(&mut self, allocation: u32) -> Ssa {
        let (mut values, list) = (self.operands(), self.allocate(allocation));
        let lengths = self.word(values.len() as u64 * (1 << 32 | 1));
        if values.is_empty() {
            values.push(self.word(0));
        }
        let heap = heaps::OTHER_FIELDS;
        self.store(lengths, list, ImmutableArray::OFFSET_OF_LENGTH, heap);
        for (index, &value) in values.iter().enumerate() {
            let offset = ImmutableArray::OFFSET_OF_ELEMENTS + index * WORD;
            self.store(value, list, offset, heap);
        }
        list
    }

    /// In a part of the frame that is for this node alone.
    pub(super) fn copy_to_memory(&mut self, values: &[Ssa]) -> Ssa {
        let function = &mut self.graph.function;
        let slot = function.add_slot((values.len().max(1) * WORD) as u32, WORD as u32);
        let address = function.slot_address(slot);
        for (index, &value) in values.iter().enumerate() {
            self.store(value, address, index * WORD, heaps::COPIED_VALUES);
        }
        address
    }

    pub(super) fn new_array_with_spread(&mut self) -> Ssa {
        let mut parts = self.operands();
        parts.reverse();
        let args = [self.copy_to_memory(&parts), self.word(parts.len() as u64)];
        self.call_operation(operations::NEW_ARRAY_WITH_SPREAD, &args)
    }

    pub(super) fn check_original_array(&mut self, cell: Ssa, global: Ssa) {
        let differs = self.is_no_original_array(cell, global);
        self.exit_if(differs, ExitKind::BadShape);
    }

    pub(super) fn is_no_original_array(&mut self, cell: Ssa, global: Ssa) -> Ssa {
        let mode = self.load_byte(cell, JsCell::OFFSET_OF_INDEXING_MODE, heaps::INDEXING_MODE);
        let (id, vm) = (self.shape_id(cell), self.vm());
        let access = Access::new(heaps::OTHER_FIELDS, AccessFlags::IMMUTABLE);
        let mut ir = self.ir();
        let base = ir.load(Type::I64, vm, Vm::OFFSET_OF_SHAPE_BASE as i32, access);
        let id = ir.zero_extend(id);
        let shape = ir.add(base, id);
        let twice_the_index = ir.and(mode, i32::from(GlobalObject::ARRAY_SHAPE_INDEX_MASK));
        let twice_the_index = ir.zero_extend(twice_the_index);
        let offset = ir.shl(twice_the_index, WORD.ilog2() - 1);
        let entry = ir.add(global, offset);
        let table = GlobalObject::OFFSET_OF_ORIGINAL_ARRAY_SHAPES as i32;
        let original = ir.load(Type::I64, entry, table, access);
        ir.not_equal(shape, original)
    }
}
