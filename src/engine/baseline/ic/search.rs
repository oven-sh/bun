//! Finding the case, and what is most often done with it.

use bun_engine_asm::prelude::*;
use bun_engine_vm::ic::{
    AccessCase, AccessCases, AccessKind, CaseList, Key, LookupEpoch, STATIC_KEYS,
};
use bun_engine_vm::{CellType, JsString, JsSymbol, TypeFlags, Vm};

use super::Emitter;
use super::abi::*;
use crate::emit::{Emit, UNDEFINED, at, shape_id, storage};
use crate::registers::VM;

pub(super) const EPOCH: Address = at(
    VM,
    Vm::OFFSET_OF_LOOKUP_EPOCH + LookupEpoch::OFFSET_OF_CURRENT,
);

pub(super) const fn case(field: usize) -> Address {
    at(CASE, field)
}

/// With the id of the shape in `RESULT`.
pub(crate) fn load_first_answer(m: &mut MacroAssembler, cases: Address, other: Label) {
    let first = |field: usize| at(CASE, CaseList::offset_of_case(0) + field);
    m.load64(CASE, cases);
    m.branch64(Cond::Lt, CASE, AccessCases::FIRST_ADDRESS as i32, other);
    m.branch32(
        Cond::Ne,
        RESULT,
        at(CASE, CaseList::offset_of_tag(0)),
        other,
    );
    m.load32(RESULT, EPOCH);
    m.branch32(
        Cond::Ne,
        RESULT,
        first(AccessCase::OFFSET_OF_SHAPE_OR_EPOCH),
        other,
    );
    m.load64(RESULT, first(AccessCase::OFFSET_OF_POINTER));
}

impl Emitter<'_> {
    /// Goes on with the first case in the list, if it is for the shape of the base and of that kind.
    pub(super) fn check_first_case(&mut self, cases: Address, kind: AccessKind, other: Label) {
        self.m.branch_if_not_cell(BASE, other);
        self.load_list(cases, other);
        self.m.load32(RESULT, shape_id(BASE));
        (self.m).branch32(
            Cond::Ne,
            RESULT,
            at(CASE, CaseList::offset_of_tag(0)),
            other,
        );
        self.m.add64(CASE, CASE, CaseList::offset_of_case(0));
        (self.m).branch8(
            Cond::Ne,
            case(AccessCase::OFFSET_OF_KIND),
            kind as i32,
            other,
        );
    }

    pub(super) fn load_shape_of_cell(&mut self) {
        self.m.branch_if_not_cell(BASE, self.miss);
        self.m.load32(SHAPE, shape_id(BASE));
    }

    /// From the key, if that is an atom, a symbol or a primitive that has only one value.
    pub(super) fn load_name(&mut self, unknown: Label) {
        let [string, primitive, done] = self.labels();
        let m = &mut *self.m;
        m.branch_if_not_cell(KEY, primitive);
        m.load64(NAME, at(KEY, JsString::OFFSET_OF_FIBER));
        m.branch_if_type(KEY, CellType::String, string);
        m.branch_if_type(KEY, CellType::Symbol, done);
        m.jump(unknown);
        m.bind(primitive);
        for (key, name) in STATIC_KEYS.into_iter().filter(|it| !it.0.is_int32()) {
            m.move64(NAME, name.address());
            m.branch64(Cond::Eq, KEY, key.to_bits(), done);
        }
        m.jump(unknown);
        m.bind(string);
        m.branch_unless_flag(KEY, TypeFlags::PER_CELL_BIT, unknown);
        m.bind(done);
    }

    /// Into `CASE`, where the word is left if it is none.
    pub(super) fn load_list(&mut self, cases: Address, no_list: Label) {
        self.m.load64(CASE, cases);
        (self.m).branch64(Cond::Lt, CASE, AccessCases::FIRST_ADDRESS as i32, no_list);
    }

    /// With the word in `CASE`.
    pub(super) fn branch_unless_megamorphic(&mut self, otherwise: Label) {
        self.m.branch64(Cond::Below, CASE, i32::MIN, otherwise);
    }

    pub(super) fn count_turn(&mut self) {
        let turns = at(CASE, CaseList::OFFSET_OF_TURNS);
        (self.m).branch_add32_to_memory(ResultCond::Carry, turns, CaseList::TURN, self.miss);
    }

    /// In the list in `CASE`, which becomes the case. `found` is emitted for each position.
    fn search(&mut self, key: Key, none: Label, mut found: impl FnMut(&mut Self)) {
        let next: [Label; AccessCases::MAX_CASES] = self.labels();
        let hit: [Label; AccessCases::MAX_CASES] = self.labels();
        if key == Key::Variable {
            self.m.xor32(SHAPE, SHAPE, NAME);
        }
        for index in 0..AccessCases::MAX_CASES {
            let tag = at(CASE, CaseList::offset_of_tag(index));
            self.m.branch32(Cond::Eq, SHAPE, tag, hit[index]);
            self.m.bind(next[index]);
        }
        self.m.jump(none);
        for index in 0..AccessCases::MAX_CASES {
            self.m.bind(hit[index]);
            let offset = CaseList::offset_of_case(index);
            if key == Key::Variable {
                let name = at(CASE, offset + AccessCase::OFFSET_OF_KEY);
                self.m.branch64(Cond::Ne, NAME, name, next[index]);
            }
            self.m.add64(CASE, CASE, offset);
            found(self);
        }
    }

    fn return_answer(&mut self, by_kind: Label) {
        self.m.load32(RESULT, EPOCH);
        let epoch = case(AccessCase::OFFSET_OF_SHAPE_OR_EPOCH);
        self.m.branch32(Cond::Ne, RESULT, epoch, by_kind);
        self.m.load64(RESULT, case(AccessCase::OFFSET_OF_POINTER));
        self.m.ret();
    }

    pub(super) fn search_and_load(&mut self, key: Key, none: Label, by_kind: Label) {
        let [no_slot, in_storage] = self.labels();
        self.search(key, none, |e| {
            (e.m).load32_signed64(RESULT, case(AccessCase::OFFSET_OF_PLAIN_OFFSET));
            e.m.branch32(Cond::Eq, RESULT, 0, no_slot);
            e.m.branch32(Cond::Lt, RESULT, 0, in_storage);
            (e.m).load64(RESULT, Address::indexed(BASE, RESULT, Scale::One, 0));
            e.m.ret();
        });
        self.m.bind(in_storage);
        self.m.add64(RESULT, RESULT, storage(BASE));
        self.m.load64(RESULT, at(RESULT, 0));
        self.m.ret();
        self.m.bind(no_slot);
        self.return_answer(by_kind);
    }

    pub(super) fn search_and_answer(&mut self, key: Key, none: Label, by_kind: Label) {
        self.search(key, none, |e| e.return_answer(by_kind));
    }

    pub(super) fn search_and_defer(&mut self, key: Key) {
        self.search(key, self.miss, |e| e.m.jump(e.defer));
    }

    pub(super) fn search_and_store(&mut self, key: Key, none: Label, by_kind: Label) {
        let [adds, in_storage] = self.labels();
        let new_shape = case(AccessCase::OFFSET_OF_SHAPE_OR_EPOCH);
        self.search(key, none, |e| {
            (e.m).load32_signed64(RESULT, case(AccessCase::OFFSET_OF_PLAIN_OFFSET));
            e.m.branch_if_not_zero32(new_shape, adds);
            e.m.branch32(Cond::Le, RESULT, 0, in_storage);
            (e.m).store64(Address::indexed(BASE, RESULT, Scale::One, 0), VALUE);
            e.return_from_store();
        });
        self.m.bind(in_storage);
        self.m.branch_if_zero32(RESULT, by_kind);
        self.m.add64(RESULT, RESULT, storage(BASE));
        self.m.store64(at(RESULT, 0), VALUE);
        self.return_from_store();
        self.m.bind(adds);
        self.m.branch_if_zero32(RESULT, by_kind);
        self.m.load32(SHAPE, EPOCH);
        let epoch = case(AccessCase::OFFSET_OF_POINTER);
        self.m.branch32(Cond::Ne, SHAPE, epoch, self.miss);
        self.m.slot_base(SHAPE, BASE, RESULT);
        (self.m).store64(Address::indexed(SHAPE, RESULT, Scale::One, 0), VALUE);
        self.m.load32(RESULT, new_shape);
        self.m.store32(shape_id(BASE), RESULT);
        self.return_from_store();
    }

    pub(super) fn return_from_store(&mut self) {
        self.m.move32(RESULT, UNDEFINED);
        (self.m).branch_if_needs_barrier(BASE, SHAPE, self.write_barrier);
        self.m.ret();
    }
}

const _: () = assert!(JsString::OFFSET_OF_FIBER == JsSymbol::OFFSET_OF_NAME);
