//! The kinds of cases that are less frequent and call nothing.

use bun_engine_asm::prelude::*;
use bun_engine_vm::heap::{Allocator, Heap};
use bun_engine_vm::ic::{AccessCase, AccessKind, PrototypeLookup};
use bun_engine_vm::{
    ArrayBuffer, CellType, CustomGetterSetter, ElementKind, GlobalBinding, GlobalProxy,
    IndexingMode, InlineWatchpointSet, JsArrayBufferView, MapKind, MapTable, MappedArguments,
    OrderedCollection, PropertyOffset, RegExp, RegExpObject, SetKind, SetTable, TypeFlags, Value,
    ViewMode, Vm,
};

use super::Emitter;
use super::abi::*;
use super::search::case;
use crate::emit::{
    Emit, FALSE, TRUE, UNDEFINED, WORD, at, in_heap, public_length, shape_id, storage,
    vector_length,
};

use crate::registers::VM;

const fn view(field: usize) -> Address {
    at(BASE, field)
}

/// From `BASE` into `RESULT`, if it is an int32.
pub(crate) fn load_array_length(m: &mut MacroAssembler, otherwise: Label) {
    let is_array = i32::from(IndexingMode::IS_ARRAY);
    m.load_indexing_mode(
        RESULT,
        BASE,
        IndexingMode::IS_ARRAY | IndexingMode::KIND_MASK,
    );
    m.branch_test32(TestCond::Zero, RESULT, is_array, otherwise);
    m.branch32(Cond::Eq, RESULT, is_array, otherwise);
    m.load64(RESULT, storage(BASE));
    m.load32(RESULT, public_length(RESULT));
    m.branch_test32(TestCond::Negative, RESULT, -1, otherwise);
}

/// From the value of a slot, which it replaces: the getter or the setter, if it can be called for any receiver.
pub(crate) fn load_custom_function(m: &mut MacroAssembler, value: Gpr, which: usize, other: Label) {
    m.branch_if_not_cell(value, other);
    m.branch_if_not_type(value, CellType::CustomGetterSetter, other);
    m.branch_if_not_zero64(
        at(value, CustomGetterSetter::OFFSET_OF_REQUIRED_CLASS),
        other,
    );
    m.load64(value, at(value, which));
    m.branch_if_zero64(value, other);
}

impl Emitter<'_> {
    /// Goes to the code for the kind in `index`. `emit` is false for a kind that has none.
    pub(super) fn dispatch(
        &mut self,
        index: Gpr,
        otherwise: impl Fn(AccessKind) -> Label,
        mut emit: impl FnMut(&mut Self, AccessKind) -> bool,
    ) {
        let labels = AccessKind::ALL.map(|_| self.m.new_label());
        self.m.jump_table(index, &labels);
        for (kind, label) in AccessKind::ALL.into_iter().zip(labels) {
            let start = self.m.here();
            let target = if emit(self, kind) {
                start
            } else {
                otherwise(kind)
            };
            self.m.alias(label, target);
        }
    }

    /// For a case that the search has found and not dealt with.
    pub(super) fn by_kind(&mut self) {
        let (miss, first_call) = (self.miss, AccessKind::FIRST_THAT_CALLS as i32);
        self.m.load8(RESULT, case(AccessCase::OFFSET_OF_KIND));
        self.m
            .branch32(Cond::AboveEq, RESULT, first_call, self.defer);
        self.dispatch(RESULT, |_| miss, Self::handle);
    }

    pub(super) fn handle(&mut self, kind: AccessKind) -> bool {
        let miss = self.miss;
        match kind {
            AccessKind::LoadInherited => self.load_inherited(SHAPE, miss),
            AccessKind::ArrayLength => {
                self.m.load64(RESULT, storage(BASE));
                self.m.load32(RESULT, public_length(RESULT));
                self.box_length();
            }
            AccessKind::StringLength => {
                self.m.load_string_length(RESULT, BASE);
                self.box_length();
            }
            AccessKind::ArgumentsLength => {
                self.m.branch_if_flag(BASE, TypeFlags::PER_CELL_BIT, miss);
                (self.m).load32(RESULT, at(BASE, MappedArguments::OFFSET_OF_LENGTH));
                self.box_length();
            }
            AccessKind::TypedArrayLength | AccessKind::DataViewByteLength => {
                self.miss_unless_valid();
                if kind == AccessKind::DataViewByteLength {
                    (self.m).branch_if_zero64(view(JsArrayBufferView::OFFSET_OF_VECTOR), miss);
                }
                (self.m).load64(RESULT, view(JsArrayBufferView::OFFSET_OF_LENGTH));
                self.box_length();
            }
            AccessKind::TypedArrayByteLength => {
                self.miss_unless_valid();
                (self.m).load64(RESULT, view(JsArrayBufferView::OFFSET_OF_LENGTH));
                self.scale_by_operand();
                self.box_length();
            }
            AccessKind::TypedArrayByteOffset => {
                self.miss_unless_valid();
                self.load_byte_offset(RESULT);
                self.box_length();
            }
            AccessKind::ResizableTypedArrayLength
            | AccessKind::ResizableTypedArrayByteLength
            | AccessKind::ResizableTypedArrayByteOffset => self.measure_resizable_view(kind),
            AccessKind::CollectionSize => {
                self.miss_unless_valid();
                (self.m).load64(
                    RESULT,
                    at(BASE, OrderedCollection::<MapKind>::OFFSET_OF_TABLE),
                );
                self.m.load32(RESULT, at(RESULT, MapTable::OFFSET_OF_LIVE));
                self.box_length();
            }
            AccessKind::RegExpFlag => {
                self.miss_unless_valid();
                (self.m).load64(RESULT, at(BASE, RegExpObject::OFFSET_OF_REGEXP_AND_FLAGS));
                (self.m).and64(RESULT, RESULT, !(RegExpObject::FLAG_MASK as i32));
                self.m.load8(RESULT, at(RESULT, RegExp::OFFSET_OF_FLAGS));
                self.m.load16(SHAPE, case(AccessCase::OFFSET_OF_OPERAND));
                self.m.test32(TestCond::NonZero, RESULT, RESULT, SHAPE);
                self.m.box_boolean(RESULT, RESULT);
            }
            AccessKind::LoadKeptResult => {
                self.miss_unless_valid();
                self.m.load16(SHAPE, case(AccessCase::OFFSET_OF_OPERAND));
                (self.m).load64(RESULT, Address::indexed(BASE, SHAPE, Scale::One, 0));
                self.m.branch_if_zero64(RESULT, self.defer);
            }
            AccessKind::LoadModuleBinding => {
                self.m.load64(RESULT, case(AccessCase::OFFSET_OF_POINTER));
                self.m.load64(RESULT, at(RESULT, 0));
            }
            AccessKind::TransitionAndGrow => {
                self.miss_unless_valid();
                self.m.load64(SHAPE, case(AccessCase::OFFSET_OF_POINTER));
                self.m.branch_if_zero64(SHAPE, miss);
                self.m.load16(NAME, case(AccessCase::OFFSET_OF_OPERAND));
                (self.m).load32(CASE, case(AccessCase::OFFSET_OF_SHAPE_OR_EPOCH));
                self.grow_and_add();
                return true;
            }
            AccessKind::SetArrayLength => {
                self.set_array_length();
                return true;
            }
            AccessKind::Delete => {
                (self.m).load32(RESULT, case(AccessCase::OFFSET_OF_SHAPE_OR_EPOCH));
                self.m.store32(shape_id(BASE), RESULT);
                (self.m).load32_signed64(SHAPE, case(AccessCase::OFFSET_OF_POINTER));
                self.m.slot_base(RESULT, BASE, SHAPE);
                (self.m).store64(Address::indexed(RESULT, SHAPE, Scale::One, 0), 0);
                self.m.move32(RESULT, TRUE);
                (self.m).branch_if_needs_barrier(BASE, SHAPE, self.write_barrier);
            }
            AccessKind::DeleteNonConfigurable => {
                let deletes = at(VM, Vm::OFFSET_OF_DELETES_UNCONFIGURABLE_PROPERTIES);
                self.m.branch8(Cond::Ne, deletes, 0, miss);
                self.m.move32(RESULT, FALSE);
            }
            AccessKind::ThroughGlobalProxy => {
                self.through_global_proxy();
                return true;
            }
            _ => return false,
        }
        self.m.ret();
        true
    }

    /// Of 64 bits.
    fn box_length(&mut self) {
        self.m.branch64(Cond::Above, RESULT, i32::MAX, self.miss);
        self.m.box_int32(RESULT, RESULT);
    }

    fn miss_unless_valid(&mut self) {
        self.m.load64(RESULT, case(AccessCase::OFFSET_OF_LOOKUP));
        let is_valid = at(RESULT, PrototypeLookup::OFFSET_OF_IS_VALID);
        self.m.branch8(Cond::Eq, is_valid, 0, self.miss);
    }

    /// Overwrites `NAME` too.
    pub(super) fn load_inherited(&mut self, holder: Gpr, miss: Label) {
        self.m.load64(holder, case(AccessCase::OFFSET_OF_LOOKUP));
        (self.m).load32_signed64(NAME, at(holder, PrototypeLookup::OFFSET_OF_BYTE_OFFSET));
        (self.m).load64(holder, at(holder, PrototypeLookup::OFFSET_OF_HOLDER));
        self.m.branch_if_zero64(holder, miss);
        self.m.slot_base(RESULT, holder, NAME);
        (self.m).load64(RESULT, Address::indexed(RESULT, NAME, Scale::One, 0));
    }

    /// Multiplies by the size of an element, of which the operand is the logarithm.
    fn scale_by_operand(&mut self) {
        self.m.load16(NAME, case(AccessCase::OFFSET_OF_OPERAND));
        self.m.shl64(RESULT, RESULT, NAME);
    }

    fn load_byte_offset(&mut self, dst: Gpr) {
        (self.m).load64(dst, view(JsArrayBufferView::OFFSET_OF_BYTE_OFFSET));
        self.m
            .extract_bits(Sign::Unsigned, Width::W64, dst, dst, 0, 56);
    }

    /// If it is known to have elements and cannot have got more.
    fn measure_resizable_view(&mut self, kind: AccessKind) {
        let fixed = self.m.new_label();
        self.miss_unless_valid();
        let mode = view(JsArrayBufferView::OFFSET_OF_MODE);
        let (m, miss) = (&mut *self.m, self.miss);
        m.load64(RESULT, view(JsArrayBufferView::OFFSET_OF_LENGTH));
        m.branch_if_zero64(RESULT, miss);
        if kind == AccessKind::ResizableTypedArrayByteOffset {
            self.load_byte_offset(RESULT);
            return self.box_length();
        }
        m.branch_test8(
            TestCond::Zero,
            mode,
            ViewMode::AUTO_LENGTH.bits().into(),
            fixed,
        );
        m.branch_test8(
            TestCond::Zero,
            mode,
            ViewMode::RESIZABLE.bits().into(),
            miss,
        );
        m.load64(SHAPE, view(JsArrayBufferView::OFFSET_OF_BUFFER));
        m.load64(RESULT, at(SHAPE, ArrayBuffer::OFFSET_OF_BYTE_LENGTH));
        self.load_byte_offset(SHAPE);
        self.m.sub64(RESULT, RESULT, SHAPE);
        self.m.load16(NAME, case(AccessCase::OFFSET_OF_OPERAND));
        self.m.shr64(RESULT, RESULT, NAME);
        self.m.bind(fixed);
        if kind == AccessKind::ResizableTypedArrayByteLength {
            self.scale_by_operand();
        }
        self.box_length();
    }

    /// With the allocator in `SHAPE`, the number of slots in the old storage in `NAME`, and the new shape in `CASE`. The
    /// object has no elements.
    pub(super) fn grow_and_add(&mut self) {
        const FIRST_CAPACITY: i32 = PropertyOffset::capacity_for(1) as i32;
        let [reallocate, publish] = self.labels();
        let (m, miss) = (&mut *self.m, self.miss);
        let is_fenced = in_heap(Heap::offset_of_field("mutator_should_be_fenced"));
        m.branch8(Cond::Ne, is_fenced, 0, miss);
        let (new, capacity, temp) = (RESULT, NAME, KEY);
        m.load64(new, at(SHAPE, Allocator::OFFSET_OF_START));
        m.branch64(
            Cond::AboveEq,
            new,
            at(SHAPE, Allocator::OFFSET_OF_END),
            miss,
        );
        m.load32(temp, at(SHAPE, Allocator::OFFSET_OF_CELL_SIZE));
        m.add64(temp, temp, new);
        m.store64(at(SHAPE, Allocator::OFFSET_OF_START), temp);
        m.branch_if_not_zero32(capacity, reallocate);
        for index in 0..FIRST_CAPACITY - 1 {
            m.store64(Address::new(new, index * WORD), 0);
        }
        m.store64(Address::new(new, (FIRST_CAPACITY - 1) * WORD), VALUE);
        m.add64(new, new, (FIRST_CAPACITY + 1) * WORD);
        m.bind(publish);
        m.store64(storage(BASE), new);
        m.store32(shape_id(BASE), CASE);
        self.return_from_store();

        // There are twice as many. The old ones are in the upper half.
        let (m, old, index, upper_half) = (&mut *self.m, SHAPE, ENTRY, NAME);
        m.bind(reallocate);
        m.shl32(index, capacity, 3);
        m.load64(old, storage(BASE));
        m.sub64(old, old, index);
        m.add64(upper_half, new, index);
        let next = m.here();
        m.load64(temp, Address::indexed(old, index, Scale::One, -2 * WORD));
        m.store64(Address::indexed(upper_half, index, Scale::One, -WORD), temp);
        m.store64(Address::indexed(new, index, Scale::One, -WORD), 0);
        m.branch_sub32(ResultCond::NonZero, index, index, WORD, next);
        m.store64(Address::new(upper_half, -WORD), VALUE);
        m.sub64(new, upper_half, new);
        m.compute_address(new, Address::indexed(upper_half, new, Scale::One, WORD));
        m.jump(publish);
    }

    /// The elements are dense and writable. What stays in the vector and leaves little of it unused.
    fn set_array_length(&mut self) {
        const MOST_REMOVED: i32 = 64;
        let [grow, done, double, clear] = self.labels();
        let (m, miss) = (&mut *self.m, self.miss);
        let (elements, length, hole) = (CASE, NAME, SHAPE);
        m.branch_if_not_int32(VALUE, miss);
        m.load64(elements, storage(BASE));
        m.load32(length, public_length(elements));
        m.branch32(Cond::AboveEq, VALUE, length, grow);
        m.sub32(RESULT, length, VALUE);
        m.branch32(Cond::Above, RESULT, MOST_REMOVED, miss);
        m.load_indexing_mode(RESULT, BASE, IndexingMode::KIND_MASK);
        m.branch32(Cond::Eq, RESULT, ElementKind::Double as i32, double);
        m.move32(hole, 0);
        m.bind(clear);
        m.sub32(length, length, 1);
        m.store64(Address::indexed(elements, length, Scale::Eight, 0), hole);
        m.branch32(Cond::Above, length, VALUE, clear);
        m.bind(done);
        m.store32(public_length(elements), VALUE);
        m.move32(RESULT, UNDEFINED);
        m.ret();
        m.bind(grow);
        m.branch32(Cond::BelowEq, VALUE, vector_length(elements), done);
        m.jump(miss);
        m.bind(double);
        m.move64(hole, Value::PURE_NAN_BITS);
        m.jump(clear);
    }

    fn through_global_proxy(&mut self) {
        let (target, miss, first_call) = (SHAPE, self.miss, AccessKind::FIRST_THAT_CALLS as i32);
        (self.m).load64(target, at(BASE, GlobalProxy::OFFSET_OF_TARGET));
        (self.m).load32(RESULT, case(AccessCase::OFFSET_OF_SHAPE_OR_EPOCH));
        self.m.branch32(Cond::Ne, RESULT, shape_id(target), miss);
        self.m.load8(RESULT, case(AccessCase::OFFSET_OF_OPERAND));
        (self.m).branch32(Cond::AboveEq, RESULT, first_call, self.defer);
        let pointer = case(AccessCase::OFFSET_OF_POINTER);
        let (stored, answer) = (self.m.new_label(), self.m.new_label());
        self.dispatch(
            RESULT,
            |kind| if kind.has_answer() { answer } else { miss },
            |e, kind| {
                match kind {
                    AccessKind::LoadOwn | AccessKind::Replace => {
                        e.m.load32_signed64(NAME, pointer);
                        e.m.slot_base(RESULT, target, NAME);
                        e.m.add64(RESULT, RESULT, NAME);
                    }
                    AccessKind::LoadGlobalBinding => e.m.load64(RESULT, pointer),
                    AccessKind::StoreGlobalBinding => {
                        e.m.load64(RESULT, pointer);
                        let watchpoints = at(RESULT, GlobalBinding::OFFSET_OF_WATCHPOINTS);
                        let invalidated = InlineWatchpointSet::THIN_INVALIDATED;
                        e.m.branch64(Cond::Ne, watchpoints, invalidated, miss);
                    }
                    _ => return false,
                }
                if let AccessKind::LoadOwn | AccessKind::LoadGlobalBinding = kind {
                    e.m.load64(RESULT, at(RESULT, 0));
                    e.m.ret();
                } else {
                    e.m.jump(stored);
                }
                true
            },
        );
        self.m.bind(stored);
        self.m.store64(at(RESULT, 0), VALUE);
        self.m.move64(BASE, target);
        self.return_from_store();
        self.m.bind(answer);
        let holds = self.m.new_label();
        (self.m).branch_if_zero64(case(AccessCase::OFFSET_OF_LOOKUP), holds);
        self.miss_unless_valid();
        self.m.bind(holds);
        self.m.load64(RESULT, pointer);
        self.m.ret();
    }
}

const _: () = {
    assert!(GlobalBinding::OFFSET_OF_VALUE == 0);
    assert!(JsArrayBufferView::BYTE_OFFSET_MASK == (1 << 56) - 1);
    assert!(PropertyOffset::capacity_for(5) == 2 * PropertyOffset::capacity_for(4));
    assert!(MapTable::OFFSET_OF_LIVE == SetTable::OFFSET_OF_LIVE);
    assert!(
        OrderedCollection::<MapKind>::OFFSET_OF_TABLE
            == OrderedCollection::<SetKind>::OFFSET_OF_TABLE
    );
};
