//! The first step of an access whose key is a value.

use core::mem::offset_of;

use bun_engine_asm::NegativeZero;
use bun_engine_asm::prelude::*;
use bun_engine_text::names;
use bun_engine_vm::code::metadata::ArrayAccess;
use bun_engine_vm::ic::Key;
use bun_engine_vm::{
    ArrayModes, ArrayProfile, CellType, ElementKind, IndexingMode, JsArrayBufferView, Shape, Value,
    ViewMode, Vm,
};

use super::abi::*;
use super::elements::{Absent, INDEX, has_element};
use super::entries::Store;
use super::{Elements, Emitter, load_element, store_element};
use crate::emit::{Emit, FALSE, TRUE, UNDEFINED, at, public_length, shape_id, storage};
use crate::registers::*;

impl Emitter<'_> {
    /// Into `INDEX`, from `number` on, where the key is one. Returns where to start instead of at `start`, if it is
    /// likely to be an int32.
    fn load_index(&mut self, start: Label, number: Label) -> Label {
        let [int32, has_index] = self.labels();
        self.m.bind(number);
        self.m.branch_if_int32(KEY, int32);
        self.m.unbox_double(F0, KEY, INDEX);
        (self.m).convert_f64_to_i32_exact(INDEX, F0, NegativeZero::Accept, self.miss);
        self.m.sign_extend32_to_64(INDEX, INDEX);
        self.m.jump(has_index);
        let by_index = self.routine("by_index", |e| {
            e.m.branch_if_not_cell(BASE, e.miss);
            e.m.branch_if_not_int32(KEY, start);
        });
        self.m.bind(int32);
        self.m.sign_extend32_to_64(INDEX, KEY);
        self.m.bind(has_index);
        by_index
    }

    /// Goes to the code for the type of the typed array.
    fn dispatch_on_typed_array(&mut self, other: Label, mut emit: impl FnMut(&mut Self, Elements)) {
        (self.m).branch_unless_type_in(BASE, CellType::TYPED_ARRAYS, RESULT, other);
        let range = CellType::TYPED_ARRAYS.first.0..=CellType::TYPED_ARRAYS.last.0;
        let labels: Vec<Label> = range.clone().map(|_| self.m.new_label()).collect();
        self.m.jump_table(RESULT, &labels);
        for (cell_type, label) in range.zip(labels) {
            match Elements::typed(self.m, CellType(cell_type)) {
                Some(kind) => {
                    self.m.bind(label);
                    emit(self, kind);
                }
                None => self.m.alias(label, self.miss),
            }
        }
    }

    pub(super) fn find_case_for_proxy(&mut self, cases: Address) {
        self.m.branch_if_not_type(BASE, CellType::Proxy, self.miss);
        self.m.load32(SHAPE, shape_id(BASE));
        self.load_list(cases, self.miss);
        self.m.move32(NAME, 0);
        self.search_and_defer(Key::Variable);
    }

    fn record_shape(&mut self, profile: Address) {
        let last_shape = profile.plus(ArrayProfile::OFFSET_OF_LAST_SHAPE as i32);
        self.m.load32(SHAPE, shape_id(BASE));
        self.m.store32(last_shape, SHAPE);
    }

    /// And then returns. The shape may not be there any more when the profile is looked at.
    fn record_shape_and_kind(&mut self, profile: Address, kind: Elements, finish: fn(&mut Self)) {
        let new = self.m.new_label();
        let last_shape = profile.plus(ArrayProfile::OFFSET_OF_LAST_SHAPE as i32);
        let modes = profile.plus(ArrayProfile::OFFSET_OF_MODES as i32);
        self.m.load32(SHAPE, shape_id(BASE));
        self.m.branch32(Cond::Ne, SHAPE, last_shape, new);
        finish(self);
        self.m.bind(new);
        self.m.store32(last_shape, SHAPE);
        if let Some(mode) = kind.mode() {
            self.m.or_to_memory(Size::S32, modes, mode.bits());
        } else {
            let table = ArrayModes::OF_INDEXING_MODES;
            (self.m).load_indexing_mode(SHAPE, BASE, (table.len() - 1) as u8);
            self.m.move64(CASE, table.as_ptr().addr());
            (self.m).load16(SHAPE, Address::indexed(CASE, SHAPE, Scale::Two, 0));
            self.m.or_to_memory(Size::S32, modes, SHAPE);
        }
        finish(self);
    }

    fn miss_unless_seen(&mut self, profile: Address, mode: ArrayModes) {
        let modes = profile.plus(ArrayProfile::OFFSET_OF_MODES as i32);
        (self.m).branch_test32(TestCond::Zero, modes, mode.bits(), self.miss);
    }

    fn miss_if_resizable(&mut self) {
        let mode = at(BASE, JsArrayBufferView::OFFSET_OF_MODE);
        let resizable = ViewMode::RESIZABLE_OR_GROWABLE.bits().into();
        (self.m).branch_test8(TestCond::NonZero, mode, resizable, self.miss);
    }

    /// For an index that no element has. Falls into where it comes for an object that has no elements of a known kind.
    fn answer_if_absent(
        &mut self,
        absent: Absent,
        outside_view: Label,
        profile: Address,
        answer: u64,
        [negative, proxy]: [Label; 2],
    ) {
        let [check, no_elements, seen] = self.labels();
        self.m
            .load_indexing_mode(RESULT, BASE, IndexingMode::KIND_MASK);
        (self.m).branch32(Cond::Ne, RESULT, ElementKind::Undecided as i32, no_elements);
        self.m.load64(CASE, storage(BASE));
        (self.m).branch32(Cond::Below, INDEX, public_length(CASE), absent.hole);
        self.m.bind(absent.outside);
        self.m.branch32(Cond::Lt, INDEX, 0, negative);
        self.miss_unless_seen(profile, ArrayModes::OUT_OF_BOUNDS);
        self.m.bind(check);
        self.m.load32(RESULT, shape_id(BASE));
        self.m.decode_shape(RESULT, RESULT);
        (self.m).load64(RESULT, at(RESULT, Shape::OFFSET_OF_OWN_ELEMENTS_EPOCH));
        let epoch = at(VM, Vm::OFFSET_OF_PROTOTYPE_CHAIN_EPOCH);
        self.m.branch64(Cond::Ne, RESULT, epoch, proxy);
        self.m.bind(seen);
        self.record_shape(profile);
        self.m.move32(RESULT, answer);
        self.m.ret();
        self.m.bind(absent.hole);
        self.miss_unless_seen(profile, ArrayModes::HOLE);
        self.m.jump(check);
        self.m.bind(no_elements);
        self.m.branch32(Cond::Ge, INDEX, 0, check);
        self.m.jump(negative);
        self.m.bind(outside_view);
        self.miss_if_resizable();
        self.miss_unless_seen(profile, ArrayModes::OUT_OF_BOUNDS);
        self.m.jump(seen);
    }

    /// `load_by_value` and `has_by_value`. These and `store_by_value` return what `load_index` does.
    fn read_by_value(
        &mut self,
        [profile, cases]: [Address; 2],
        absent_answer: u64,
        kinds: &[Elements],
        read: fn(&mut MacroAssembler, Elements, Label, Absent),
        by_name: impl FnOnce(&mut Self, Label),
    ) -> Label {
        let start = self.m.here();
        let [number, has_name, negative, proxy] = self.labels();
        let [untyped, outside_view, hole, outside] = self.labels();
        self.m.branch_if_not_cell(BASE, self.miss);
        self.m.branch_if_number(KEY, number);
        self.load_name(proxy);
        self.m.bind(has_name);
        self.m.load32(SHAPE, shape_id(BASE));
        by_name(self, proxy);
        self.m.bind(proxy);
        self.find_case_for_proxy(cases);
        self.m.bind(negative);
        self.m.branch32(Cond::Ne, INDEX, -1, proxy);
        self.m.move64(NAME, names::minusOne.address());
        self.m.jump(has_name);

        let by_index = self.load_index(start, number);
        let found = |e: &mut Self, kind| e.record_shape_and_kind(profile, kind, |e| e.m.ret());
        let try_kind = |e: &mut Self, kind, absent| {
            let other = e.m.new_label();
            read(e.m, kind, other, absent);
            found(e, kind);
            e.m.bind(other);
        };
        try_kind(self, Elements::Values, Absent { hole, outside });
        try_kind(self, Elements::Double, Absent { hole, outside });
        self.dispatch_on_typed_array(untyped, |e, kind| {
            read(e.m, kind, e.miss, Absent::both(outside_view));
            found(e, kind);
        });
        self.m.bind(untyped);
        let plain = self.m.new_label();
        self.m.branch_if_type(BASE, CellType::FinalObject, plain);
        for &kind in kinds {
            try_kind(self, kind, Absent::both(self.miss));
        }
        self.m.bind(plain);
        let absent = Absent { hole, outside };
        self.answer_if_absent(
            absent,
            outside_view,
            profile,
            absent_answer,
            [negative, proxy],
        );
        by_index
    }

    pub(super) fn load_by_value(&mut self, by_kind: Label) -> Label {
        let cases = at(ENTRY, offset_of!(ArrayAccess, cases));
        self.read_by_value(
            [at(ENTRY, offset_of!(ArrayAccess, array)), cases],
            UNDEFINED,
            &[
                Elements::String,
                Elements::DirectArguments,
                Elements::ScopedArguments,
            ],
            load_element,
            |e, none| e.load_from(cases, Key::Variable, none, by_kind),
        )
    }

    pub(super) fn has_by_value(&mut self, by_kind: Label) -> Label {
        let cases = at(ENTRY, offset_of!(ArrayAccess, cases));
        self.read_by_value(
            [at(ENTRY, offset_of!(ArrayAccess, array)), cases],
            FALSE,
            &[Elements::DirectArguments, Elements::ScopedArguments],
            has_element,
            |e, none| e.has_from(cases, Key::Variable, none, by_kind),
        )
    }

    pub(super) fn store_by_value(&mut self, mode: Store, by_kind: Label) -> Label {
        let start = self.m.here();
        let [number, no_list, untyped, outside_view, proxy] = self.labels();
        let profile = at(ENTRY, offset_of!(ArrayAccess, array));
        let cases = at(ENTRY, offset_of!(ArrayAccess, cases));
        let modes = profile.plus(ArrayProfile::OFFSET_OF_MODES as i32);
        self.m.branch_if_not_cell(BASE, self.miss);
        self.m.branch_if_number(KEY, number);
        self.load_name(proxy);
        self.m.load32(SHAPE, shape_id(BASE));
        self.load_list(cases, no_list);
        self.count_turn();
        self.search_and_store(Key::Variable, proxy, by_kind);
        self.m.bind(no_list);
        self.branch_unless_megamorphic(self.miss);
        self.store_megamorphic_as(mode, Key::Variable, self.miss);
        self.m.bind(proxy);
        self.find_case_for_proxy(cases);

        let by_index = self.load_index(start, number);
        for kind in [Elements::Values, Elements::Double] {
            let other = self.m.new_label();
            store_element(
                self.m,
                kind,
                modes,
                other,
                Absent::both(self.miss),
                self.miss,
            );
            self.record_shape_and_kind(profile, kind, Self::return_from_store);
            self.m.bind(other);
        }
        if mode == Store::Set {
            self.dispatch_on_typed_array(untyped, |e, kind| {
                store_element(e.m, kind, modes, e.miss, Absent::both(outside_view), e.miss);
                e.m.move32(RESULT, UNDEFINED);
                e.record_shape_and_kind(profile, kind, |e| e.m.ret());
            });
            self.m.bind(outside_view);
            self.m.branch_if_not_number(VALUE, self.miss);
            self.miss_if_resizable();
            self.miss_unless_seen(profile, ArrayModes::OUT_OF_BOUNDS);
            self.record_shape(profile);
            self.m.move32(RESULT, UNDEFINED);
            self.m.ret();
            self.m.bind(untyped);
            let (kind, absent) = (Elements::DirectArguments, Absent::both(self.miss));
            store_element(self.m, kind, modes, proxy, absent, self.miss);
            self.record_shape(profile);
            self.return_from_store();
        } else {
            self.m.jump(self.miss);
        }
        by_index
    }

    pub(super) fn delete_by_value(&mut self, by_kind: Label) {
        let [index, double, done] = self.labels();
        self.load_shape_of_cell();
        self.m.branch_if_int32(KEY, index);
        self.load_name(self.miss);
        self.load_list(at(ENTRY, 0), self.miss);
        self.search_and_answer(Key::Variable, self.miss, by_kind);

        let (m, miss) = (&mut *self.m, self.miss);
        m.bind(index);
        m.load_indexing_mode(RESULT, BASE, IndexingMode::KIND_AND_WRITABILITY_MASK);
        m.sub32(RESULT, RESULT, ElementKind::Int32 as i32);
        let last = ElementKind::Contiguous as i32 - ElementKind::Int32 as i32;
        m.branch32(Cond::Above, RESULT, last, miss);
        m.branch_if_not_type(BASE, CellType::Array, miss);
        m.branch32(Cond::Lt, KEY, 0, miss);
        m.load64(CASE, storage(BASE));
        m.zero_extend32(INDEX, KEY);
        m.branch32(Cond::AboveEq, INDEX, public_length(CASE), done);
        let element = Address::indexed(CASE, INDEX, Scale::Eight, 0);
        let kind = ElementKind::Double as i32 - ElementKind::Int32 as i32;
        m.branch32(Cond::Eq, RESULT, kind, double);
        m.store64(element, 0);
        m.bind(done);
        m.move32(RESULT, TRUE);
        m.ret();
        m.bind(double);
        m.store64(element, Value::PURE_NAN_BITS);
        m.jump(done);
    }
}
