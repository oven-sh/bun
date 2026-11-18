//! Lookups in the tables of the `Vm`.

use bun_engine_asm::Shift;
use bun_engine_asm::prelude::*;
use bun_engine_text::{OFFSET_OF_SYMBOL_HASH, StringImpl};
use bun_engine_vm::Vm;
use bun_engine_vm::caches::{ENTRY_SHIFT, LoadEntry, LookupTables, SHAPE_SHIFT, StoreEntry};
use bun_engine_vm::ic::Key;

use super::Emitter;
use super::abi::*;
use crate::emit::{Emit, FALSE, at, shape_id};
use crate::registers::*;

const fn entry(field: usize) -> Address {
    at(CASE, field)
}

impl Emitter<'_> {
    /// Leaves the address of the entry for `SHAPE` and the name in `CASE`, which has the `caches::name_hash` of a fixed
    /// key. `found` is emitted for each table.
    fn find(&mut self, key: Key, tables: [usize; 2], none: Label, found: impl Fn(&mut Self)) {
        let [second, symbol, has_hash] = self.labels();
        let name = if key == Key::Fixed { KEY } else { NAME };
        if key == Key::Variable {
            self.m.load32(CASE, at(NAME, StringImpl::OFFSET_OF_FLAGS));
            (self.m).branch_test32(TestCond::NonZero, CASE, StringImpl::IS_SYMBOL, symbol);
            self.m.shr32(CASE, CASE, StringImpl::FLAG_COUNT as u8);
            self.m.bind(has_hash);
            self.m.shl32(CASE, CASE, ENTRY_SHIFT as u8);
        }
        let check = |e: &mut Self, table: usize, count: usize, otherwise: Label| {
            e.m.and32(CASE, CASE, (count - 1) << ENTRY_SHIFT);
            e.m.add64(CASE, CASE, at(VM, Vm::OFFSET_OF_LOOKUP_TABLES));
            if table != 0 {
                e.m.add64(CASE, CASE, table);
            }
            e.m.load32(RESULT, at(VM, Vm::OFFSET_OF_PROTOTYPE_CHAIN_EPOCH));
            (e.m).branch32(
                Cond::Ne,
                SHAPE,
                entry(LoadEntry::OFFSET_OF_SHAPE),
                otherwise,
            );
            (e.m).branch64(Cond::Ne, name, entry(LoadEntry::OFFSET_OF_NAME), otherwise);
            (e.m).branch32(
                Cond::Ne,
                RESULT,
                entry(LoadEntry::OFFSET_OF_EPOCH),
                otherwise,
            );
        };
        self.m.shr32(RESULT, SHAPE, SHAPE_SHIFT as u8);
        self.m.add32(CASE, CASE, RESULT);
        check(self, tables[0], LoadEntry::PRIMARY_COUNT, second);
        found(self);
        self.m.bind(second);
        self.m.add32(CASE, SHAPE, name);
        (self.m).xor_shifted(Width::W32, CASE, CASE, CASE, Shift::RightLogical, 9);
        self.m.shl32(CASE, CASE, ENTRY_SHIFT as u8 - 3);
        check(self, tables[1], LoadEntry::SECONDARY_COUNT, none);
        found(self);
        if key == Key::Variable {
            self.m.bind(symbol);
            self.m.load32(CASE, at(NAME, OFFSET_OF_SYMBOL_HASH));
            self.m.jump(has_hash);
        }
    }

    fn find_load(&mut self, key: Key, none: Label, found: impl Fn(&mut Self)) {
        let tables = [
            LookupTables::OFFSET_OF_LOADS,
            LookupTables::OFFSET_OF_SECONDARY_LOADS,
        ];
        self.find(key, tables, none, found);
    }

    pub(super) fn load_megamorphic(&mut self, key: Key, none: Label) {
        self.find_load(key, none, |e| {
            (e.m).load32_signed64(SHAPE, entry(LoadEntry::OFFSET_OF_BYTE_OFFSET));
            (e.m).branch_test32(TestCond::NonZero, SHAPE, LoadEntry::IS_SPECIAL, e.defer);
            e.m.load64(NAME, entry(LoadEntry::OFFSET_OF_HOLDER));
            e.m.slot_base(RESULT, BASE, SHAPE);
            (e.m).select_test64(TestCond::NonZero, RESULT, NAME, -1, NAME, RESULT);
            (e.m).load64(RESULT, Address::indexed(RESULT, SHAPE, Scale::One, 0));
            e.m.ret();
        });
    }

    pub(super) fn load_own_megamorphic(&mut self, key: Key) {
        self.find_load(key, self.miss, |e| {
            (e.m).load32_signed64(SHAPE, entry(LoadEntry::OFFSET_OF_BYTE_OFFSET));
            (e.m).branch_test32(TestCond::NonZero, SHAPE, LoadEntry::IS_SPECIAL, e.miss);
            (e.m).branch_if_not_zero64(entry(LoadEntry::OFFSET_OF_HOLDER), e.miss);
            e.m.slot_base(RESULT, BASE, SHAPE);
            (e.m).load64(RESULT, Address::indexed(RESULT, SHAPE, Scale::One, 0));
            e.m.ret();
        });
    }

    pub(super) fn has_megamorphic(&mut self, key: Key, none: Label) {
        self.find_load(key, none, |e| {
            e.m.load8(RESULT, entry(LoadEntry::OFFSET_OF_IS_PRESENT));
            e.m.or32(RESULT, RESULT, FALSE);
            e.m.ret();
        });
    }

    /// `SHAPE` has `StoreEntry::DEFINES` if that is what it does.
    pub(super) fn store_megamorphic(&mut self, key: Key, none: Label) {
        let tables = [
            LookupTables::OFFSET_OF_STORES,
            LookupTables::OFFSET_OF_SECONDARY_STORES,
        ];
        let grow = self.m.new_label();
        self.find(key, tables, none, |e| {
            (e.m).load32_signed64(SHAPE, entry(StoreEntry::OFFSET_OF_BYTE_OFFSET));
            (e.m).branch_test32(TestCond::NonZero, SHAPE, StoreEntry::IS_SPECIAL, grow);
            e.m.slot_base(RESULT, BASE, SHAPE);
            (e.m).store64(Address::indexed(RESULT, SHAPE, Scale::One, 0), VALUE);
            // The next access to the object need not wait for this one.
            let same_shape = e.m.new_label();
            e.m.load32(RESULT, entry(StoreEntry::OFFSET_OF_NEW_SHAPE));
            e.m.branch32(Cond::Eq, RESULT, shape_id(BASE), same_shape);
            e.m.store32(shape_id(BASE), RESULT);
            e.m.bind(same_shape);
            e.return_from_store();
        });
        self.m.bind(grow);
        self.m.load32(SHAPE, entry(StoreEntry::OFFSET_OF_ALLOCATOR));
        self.m.branch_if_zero32(SHAPE, self.miss);
        self.m.add64(SHAPE, SHAPE, VM);
        self.m.load32(NAME, entry(StoreEntry::OFFSET_OF_CAPACITY));
        self.m.load32(CASE, entry(StoreEntry::OFFSET_OF_NEW_SHAPE));
        self.grow_and_add();
    }
}

const _: () = {
    assert!(StoreEntry::OFFSET_OF_NAME == LoadEntry::OFFSET_OF_NAME);
    assert!(StoreEntry::OFFSET_OF_SHAPE == LoadEntry::OFFSET_OF_SHAPE);
    assert!(StoreEntry::OFFSET_OF_EPOCH == LoadEntry::OFFSET_OF_EPOCH);
    assert!(StoreEntry::PRIMARY_COUNT == LoadEntry::PRIMARY_COUNT);
    assert!(StoreEntry::SECONDARY_COUNT == LoadEntry::SECONDARY_COUNT);
};
