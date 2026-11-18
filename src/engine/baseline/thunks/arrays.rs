//! What is done with arrays.

use bun_engine_asm::prelude::*;
use bun_engine_vm::{CellType, ElementKind, GlobalObject, IndexingMode, RealmWatchpoint, call};

use super::Emitter;
use crate::emit::*;
use crate::registers::*;

impl Emitter {
    /// Leaves its storage in `T4`, its length in `T3` and the kind of its elements in `T5`, which is dense.
    pub(super) fn load_writable_array(&mut self, other: Label) {
        let m = &mut self.m;
        m.branch_if_not_cell(T1, other);
        m.branch_if_not_type(T1, CellType::Array, other);
        m.load_indexing_mode(T5, T1, IndexingMode::KIND_AND_WRITABILITY_MASK);
        m.sub32(T4, T5, ElementKind::Int32 as i32);
        let span = ElementKind::Contiguous as i32 - ElementKind::Int32 as i32;
        m.branch32(Cond::Above, T4, span, other);
        m.load64(T4, storage(T1));
        m.load32(T3, public_length(T4));
    }

    pub(super) fn push(&mut self) {
        let [other, words, fits, stored] = core::array::from_fn(|_| self.m.new_label());
        self.load_writable_array(other);
        let m = &mut self.m;
        let slot = Address::indexed(T4, T3, Scale::Eight, 0);
        m.branch32(Cond::AboveEq, T3, vector_length(T4), other);
        m.branch32(Cond::Ne, T5, ElementKind::Double as i32, words);
        m.number_to_double(F0, T2, T0, other);
        m.branch_f64(FloatCond::Unordered, F0, F0, other);
        m.store_f64(slot, F0);
        m.jump(stored);
        m.bind(words);
        m.branch32(Cond::Eq, T5, ElementKind::Contiguous as i32, fits);
        m.branch_if_not_int32(T2, other);
        m.bind(fits);
        m.store64(slot, T2);
        m.bind(stored);
        m.add32(T0, T3, 1);
        m.store32(public_length(T4), T0);
        m.box_int32(T0, T0);
        m.branch_if_needs_barrier(T1, T3, self.write_barrier);
        m.ret();
        m.bind(other);
        m.move32(T0, 0);
        m.ret();
    }

    pub(super) fn pop(&mut self) {
        let [other, words, taken] = core::array::from_fn(|_| self.m.new_label());
        self.load_writable_array(other);
        let m = &mut self.m;
        let slot = Address::indexed(T4, T3, Scale::Eight, 0);
        m.branch_sub32(ResultCond::Negative, T3, T3, 1, other);
        m.branch32(Cond::Ne, T5, ElementKind::Double as i32, words);
        m.load_f64(F0, slot);
        m.branch_f64(FloatCond::Unordered, F0, F0, other);
        m.box_double(T0, F0);
        m.store64(slot, ElementKind::Double.hole());
        m.jump(taken);
        m.bind(words);
        m.load64(T0, slot);
        m.branch_if_empty(T0, other);
        m.store64(slot, 0);
        m.bind(taken);
        m.store32(public_length(T4), T3);
        m.ret();
        m.bind(other);
        m.move32(T0, 0);
        m.ret();
    }

    pub(super) fn is_pristine_array(&mut self) {
        self.is_original_array(RealmWatchpoint::ArrayIteratorProtocol, |_, _| {});
    }

    pub(super) fn is_argument_list(&mut self) {
        self.is_original_array(RealmWatchpoint::ArrayPrototypeChainIsSane, |m, no| {
            m.load_indexing_mode(T0, T1, IndexingMode::KIND_MASK);
            branch_unless_dense(m, T0, no);
            m.load64(T0, storage(T1));
            m.branch32(Cond::Above, public_length(T0), call::MAX_ARGUMENTS, no);
        });
    }

    pub(super) fn is_original_array(
        &mut self,
        holds: RealmWatchpoint,
        test: fn(&mut MacroAssembler, Label),
    ) {
        let m = &mut self.m;
        let no = m.new_label();
        m.branch_if_not_cell(T1, no);
        m.branch_if_not_type(T1, CellType::Array, no);
        test(m, no);
        m.load_global(T2);
        m.load64(T0, at(T2, GlobalObject::offset_of_watchpoints(holds)));
        m.branch_unless_watched(T0, no);
        m.load_indexing_mode(T0, T1, GlobalObject::ARRAY_SHAPE_INDEX_MASK);
        let shapes = GlobalObject::OFFSET_OF_ORIGINAL_ARRAY_SHAPES as i32;
        m.load64(T0, Address::indexed(T2, T0, Scale::Four, shapes));
        m.load32(T2, shape_id(T1));
        m.decode_shape(T2, T2);
        m.compare64(Cond::Eq, T0, T0, T2);
        m.ret();
        self.answer(no, 0);
    }
}

/// Overwrites `kind`.
pub(super) fn branch_unless_dense(m: &mut MacroAssembler, kind: Gpr, target: Label) {
    let (first, last) = (
        ElementKind::Undecided as i32,
        ElementKind::Contiguous as i32,
    );
    m.sub32(kind, kind, first);
    m.branch32(Cond::Above, kind, last - first, target);
}
