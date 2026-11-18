//! Sequences that templates and stubs share.

#![forbid(unsafe_code)]

use bun_engine_asm::prelude::*;
use bun_engine_asm::{Features, Options};
use bun_engine_text::StringImpl;
use bun_engine_vm::heap::{Allocator, Heap, Space};
use bun_engine_vm::{
    CallFrame, CellType, CellTypeRange, CodeBlock, IndexingMode, InlineWatchpointSet, JsCell,
    JsObject, JsRopeString, JsString, Shape, Storage, TypeFlags, Value, Vm, WatchpointSet,
    WatchpointState,
};

use crate::registers::*;

pub(crate) const UNDEFINED: u64 = Value::UNDEFINED.to_bits();
pub(crate) const NULL: u64 = Value::NULL.to_bits();
pub(crate) const FALSE: u64 = Value::FALSE.to_bits();
pub(crate) const TRUE: u64 = Value::TRUE.to_bits();
pub(crate) const WORD: i32 = 8;

#[inline(always)]
pub(crate) const fn at(base: Gpr, offset: usize) -> Address {
    Address::new(base, offset as i32)
}

pub(crate) const fn in_heap(offset: usize) -> Address {
    at(VM, Vm::OFFSET_OF_HEAP + offset)
}

pub(crate) const ARGUMENT_COUNT: Address = at(FP, CallFrame::OFFSET_OF_ARGUMENT_COUNT);
pub(crate) const CALL_SITE: Address = at(FP, CallFrame::OFFSET_OF_CALL_SITE);
const BARRIER_THRESHOLD: Address = in_heap(Heap::offset_of_field("barrier_threshold"));

/// For cells of that size that need no destruction.
pub(crate) const fn cell_allocator(size: usize) -> Address {
    in_heap(Heap::offset_of_field("cells") + Space::offset_of_allocator_for(size))
}

pub(crate) const fn public_length(storage: Gpr) -> Address {
    Address::new(storage, Storage::OFFSET_OF_PUBLIC_LENGTH as i32)
}

pub(crate) const fn vector_length(storage: Gpr) -> Address {
    Address::new(storage, Storage::OFFSET_OF_VECTOR_LENGTH as i32)
}

pub(crate) const fn shape_id(cell: Gpr) -> Address {
    at(cell, JsCell::OFFSET_OF_SHAPE_ID)
}

pub(crate) const fn cell_type(cell: Gpr) -> Address {
    at(cell, JsCell::OFFSET_OF_TYPE)
}

pub(crate) const fn storage(object: Gpr) -> Address {
    at(object, JsObject::OFFSET_OF_STORAGE)
}

pub(crate) fn assembler_options(seed: u64) -> Options<Features> {
    Options {
        features: Features::host(),
        shorten_jumps: false,
        seed,
    }
}

pub(crate) trait Emit {
    fn load_pinned_registers(&mut self);
    fn load_global(&mut self, dst: Gpr);
    fn branch_if_type(&mut self, cell: Gpr, expected: CellType, target: Label);
    fn branch_if_not_type(&mut self, cell: Gpr, expected: CellType, target: Label);
    fn branch_unless_type_in(&mut self, cell: Gpr, range: CellTypeRange, temp: Gpr, target: Label);
    fn branch_if_cell_is_object(&mut self, cell: Gpr, target: Label);
    fn branch_if_cell_is_no_object(&mut self, cell: Gpr, target: Label);
    fn branch_if_flag(&mut self, cell: Gpr, flags: TypeFlags, target: Label);
    fn branch_unless_flag(&mut self, cell: Gpr, flags: TypeFlags, target: Label);
    fn branch_unless_both_int32(&mut self, a: Gpr, b: Gpr, temp: Gpr, target: Label);
    fn branch_if_needs_barrier(&mut self, owner: Gpr, temp: Gpr, target: Label);
    fn load_indexing_mode(&mut self, dst: Gpr, cell: Gpr, mask: u8);
    fn decode_shape(&mut self, dst: Gpr, id: Gpr);
    fn slot_base(&mut self, dst: Gpr, object: Gpr, byte_offset: Gpr);
    fn load_string_length(&mut self, dst: Gpr, string: Gpr);
    fn load_code_unit(&mut self, dst: Gpr, string: Gpr, index: Gpr, temp: Gpr);
    fn number_to_double(&mut self, dst: Fpr, value: Gpr, temp: Gpr, otherwise: Label);
    fn truncate_number(&mut self, value: Gpr, temp: Gpr, otherwise: Label);
    fn bump_allocate(
        &mut self,
        dst: Gpr,
        allocator: Address,
        size: Option<usize>,
        temp: Gpr,
        full: Label,
    );
    fn store_header(&mut self, cell: Gpr, shape: Gpr, temp: Gpr);
    fn branch_unless_watched(&mut self, set: Gpr, target: Label);
    fn publish(&mut self);
}

impl Emit for MacroAssembler {
    fn load_pinned_registers(&mut self) {
        self.load64(CODE_BLOCK, at(FP, CallFrame::OFFSET_OF_CODE_BLOCK));
    }

    fn load_global(&mut self, dst: Gpr) {
        self.load64(dst, at(CODE_BLOCK, CodeBlock::OFFSET_OF_GLOBAL));
    }

    fn branch_if_type(&mut self, cell: Gpr, expected: CellType, target: Label) {
        self.branch8(Cond::Eq, cell_type(cell), expected.0.into(), target);
    }

    fn branch_if_not_type(&mut self, cell: Gpr, expected: CellType, target: Label) {
        self.branch8(Cond::Ne, cell_type(cell), expected.0.into(), target);
    }

    /// Leaves the distance from the first of them in `temp`.
    fn branch_unless_type_in(&mut self, cell: Gpr, range: CellTypeRange, temp: Gpr, target: Label) {
        self.load8(temp, cell_type(cell));
        self.sub32(temp, temp, i32::from(range.first.0));
        let span = i32::from(range.last.0 - range.first.0);
        self.branch32(Cond::Above, temp, span, target);
    }

    fn branch_if_cell_is_object(&mut self, cell: Gpr, target: Label) {
        let first = CellType::Object.0.into();
        self.branch8(Cond::AboveEq, cell_type(cell), first, target);
    }

    fn branch_if_cell_is_no_object(&mut self, cell: Gpr, target: Label) {
        let first = CellType::Object.0.into();
        self.branch8(Cond::Below, cell_type(cell), first, target);
    }

    fn branch_if_flag(&mut self, cell: Gpr, flags: TypeFlags, target: Label) {
        let (address, mask) = (at(cell, JsCell::OFFSET_OF_FLAGS), flags.bits() as i32);
        self.branch_test8(TestCond::NonZero, address, mask, target);
    }

    fn branch_unless_flag(&mut self, cell: Gpr, flags: TypeFlags, target: Label) {
        let (address, mask) = (at(cell, JsCell::OFFSET_OF_FLAGS), flags.bits() as i32);
        self.branch_test8(TestCond::Zero, address, mask, target);
    }

    fn branch_unless_both_int32(&mut self, a: Gpr, b: Gpr, temp: Gpr, target: Label) {
        self.and64(temp, a, b);
        self.branch_if_not_int32(temp, target);
    }

    fn branch_if_needs_barrier(&mut self, owner: Gpr, temp: Gpr, target: Label) {
        self.load8(temp, at(owner, JsCell::OFFSET_OF_STATE));
        self.branch32(Cond::BelowEq, temp, BARRIER_THRESHOLD, target);
    }

    fn load_indexing_mode(&mut self, dst: Gpr, cell: Gpr, mask: u8) {
        debug_assert!(mask & IndexingMode::KIND_MASK != 0);
        self.load8(dst, at(cell, JsCell::OFFSET_OF_INDEXING_MODE));
        self.and32(dst, dst, i32::from(mask));
    }

    /// The upper half of `id` is clear.
    fn decode_shape(&mut self, dst: Gpr, id: Gpr) {
        self.add64(dst, id, at(VM, Vm::OFFSET_OF_SHAPE_BASE));
    }

    /// What the offset, extended to 64 bits, counts from. `dst` is neither of the others.
    fn slot_base(&mut self, dst: Gpr, object: Gpr, byte_offset: Gpr) {
        self.load64(dst, storage(object));
        self.select64(Cond::Gt, dst, byte_offset, 0, object, dst);
    }

    /// The two differ.
    fn load_string_length(&mut self, dst: Gpr, string: Gpr) {
        let (rope, done) = (self.new_label(), self.new_label());
        self.load64(dst, at(string, JsString::OFFSET_OF_FIBER));
        self.branch_test32(TestCond::NonZero, dst, JsString::IS_ROPE, rope);
        self.load32(dst, at(dst, StringImpl::OFFSET_OF_LENGTH));
        self.jump(done);
        self.bind(rope);
        self.load32(dst, at(string, JsRopeString::OFFSET_OF_LENGTH));
        self.bind(done);
    }

    /// `string` is a `StringImpl` that has the index.
    fn load_code_unit(&mut self, dst: Gpr, string: Gpr, index: Gpr, temp: Gpr) {
        let (wide, done) = (self.new_label(), self.new_label());
        self.load64(temp, at(string, StringImpl::OFFSET_OF_DATA));
        let flags = at(string, StringImpl::OFFSET_OF_FLAGS);
        self.branch_test32(TestCond::Zero, flags, StringImpl::IS_LATIN1, wide);
        self.load8(dst, Address::indexed(temp, index, Scale::One, 0));
        self.jump(done);
        self.bind(wide);
        self.load16(dst, Address::indexed(temp, index, Scale::Two, 0));
        self.bind(done);
    }

    fn number_to_double(&mut self, dst: Fpr, value: Gpr, temp: Gpr, otherwise: Label) {
        let (int32, done) = (self.new_label(), self.new_label());
        self.branch_if_int32(value, int32);
        self.branch_if_not_number(value, otherwise);
        self.unbox_double(dst, value, temp);
        self.jump(done);
        self.bind(int32);
        self.convert_i32_to_f64(dst, value);
        self.bind(done);
    }

    /// ToInt32, into the lower half.
    fn truncate_number(&mut self, value: Gpr, temp: Gpr, otherwise: Label) {
        let done = self.new_label();
        self.branch_if_int32(value, done);
        self.branch_if_not_number(value, otherwise);
        self.unbox_double(F0, value, temp);
        self.truncate_f64_to_int32_modular(value, F0, otherwise);
        self.bind(done);
    }

    /// `size` is that of the cells of the allocator, if it is known.
    fn bump_allocate(
        &mut self,
        dst: Gpr,
        allocator: Address,
        size: Option<usize>,
        temp: Gpr,
        full: Label,
    ) {
        let field = |offset: usize| allocator.plus(offset as i32);
        self.load64(dst, field(Allocator::OFFSET_OF_START));
        self.branch64(Cond::AboveEq, dst, field(Allocator::OFFSET_OF_END), full);
        match size {
            Some(size) => self.add64(temp, dst, size),
            None => {
                self.load32(temp, field(Allocator::OFFSET_OF_CELL_SIZE));
                self.add64(temp, temp, dst);
            }
        }
        self.store64(field(Allocator::OFFSET_OF_START), temp);
    }

    /// `shape` is the address of the shape.
    fn store_header(&mut self, cell: Gpr, shape: Gpr, temp: Gpr) {
        self.load32(temp, at(shape, Shape::OFFSET_OF_INSTANCE_HEADER));
        self.store32(at(cell, JsCell::OFFSET_OF_INDEXING_MODE), temp);
        self.sub64(temp, shape, at(VM, Vm::OFFSET_OF_SHAPE_BASE));
        self.store32(shape_id(cell), temp);
    }

    /// `set` has the bits of an `InlineWatchpointSet`.
    fn branch_unless_watched(&mut self, set: Gpr, target: Label) {
        let watched = self.new_label();
        self.branch64(Cond::Eq, set, InlineWatchpointSet::THIN_WATCHED, watched);
        self.branch_test32(TestCond::NonZero, set, InlineWatchpointSet::IS_THIN, target);
        let state = at(set, WatchpointSet::OFFSET_OF_STATE);
        self.branch8(Cond::Ne, state, WatchpointState::Watched as i32, target);
        self.bind(watched);
    }

    /// Between initializing a cell and letting go of it.
    fn publish(&mut self) {
        if cfg!(not(target_arch = "x86_64")) {
            let done = self.new_label();
            let is_fenced = in_heap(Heap::offset_of_field("mutator_should_be_fenced"));
            self.branch8(Cond::Eq, is_fenced, 0, done);
            self.store_fence();
            self.bind(done);
        }
    }
}
