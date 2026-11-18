//! Lookups in the tables of the `Vm`.

use core::mem::offset_of;

use bun_engine_asm::prelude::*;
use bun_engine_codegen::PatchpointSite;
use bun_engine_vm::caches::{ENTRY_SHIFT, LoadEntry, LookupTables, SHAPE_SHIFT, StoreEntry};
use bun_engine_vm::{JsCell, JsObject, Vm};

use super::{Cold, Emitter};
use crate::graph::SlotSearch;
use crate::runtime::registers::*;
use crate::runtime::search::Searched;

/// With its hash.
#[derive(Clone, Copy)]
enum Name {
    Fixed(usize, u32),
    Variable(Gpr, Gpr),
}

#[derive(Clone, Copy)]
pub(super) struct Searching {
    thunk: usize,
    object: Gpr,
    value: Option<Gpr>,
    name: Name,
    result: Gpr,
    entry: Gpr,
    temp: Gpr,
}

impl Searching {
    fn new(thunk: usize, search: SlotSearch, site: &PatchpointSite<'_>) -> Self {
        let (name, rest) = match (search.name, site.operands) {
            (Some((name, hash)), all) => (Name::Fixed(name, hash), all),
            (None, [rest @ .., name, hash]) => (Name::Variable(name.gpr(), hash.gpr()), rest),
            _ => unreachable!("a name"),
        };
        Self {
            thunk,
            object: rest[0].gpr(),
            value: rest.get(1).map(|it| it.gpr()),
            name,
            result: site.results[0].gpr(),
            entry: site.scratch_gprs[0],
            temp: site.scratch_gprs[1],
        }
    }

    fn name_in(&self, m: &mut MacroAssembler, temp: Gpr) -> Gpr {
        match self.name {
            Name::Fixed(name, _) => {
                m.move64(temp, name);
                temp
            }
            Name::Variable(name, _) => name,
        }
    }

    fn field(&self, offset: usize) -> Address {
        at(self.entry, offset)
    }

    /// In the primary table.
    fn find_entry(&self, m: &mut MacroAssembler, table: usize, none: Label) {
        let (entry, shape, temp) = (self.entry, self.temp, self.result);
        m.load32(shape, at(self.object, JsCell::OFFSET_OF_SHAPE_ID));
        m.shr32(entry, shape, SHAPE_SHIFT as u8);
        match self.name {
            Name::Fixed(_, hash) => m.add32(entry, entry, hash as i32),
            Name::Variable(_, hash) => m.add32(entry, entry, hash),
        }
        m.and32(entry, entry, (LoadEntry::PRIMARY_COUNT - 1) << ENTRY_SHIFT);
        m.add64(entry, entry, at(VM, Vm::OFFSET_OF_LOOKUP_TABLES));
        if table != 0 {
            m.add64(entry, entry, table);
        }
        m.branch32(
            Cond::Ne,
            shape,
            self.field(LoadEntry::OFFSET_OF_SHAPE),
            none,
        );
        let name = self.name_in(m, temp);
        m.branch64(Cond::Ne, name, self.field(LoadEntry::OFFSET_OF_NAME), none);
        m.load32(temp, at(VM, Vm::OFFSET_OF_PROTOTYPE_CHAIN_EPOCH));
        m.branch32(Cond::Ne, temp, self.field(LoadEntry::OFFSET_OF_EPOCH), none);
    }

    /// From the object in `result`, to what the offset is relative to.
    fn find_base(&self, m: &mut MacroAssembler, byte_offset: Gpr) {
        m.load64(self.entry, at(self.result, JsObject::OFFSET_OF_STORAGE));
        let (object, storage) = (self.result, self.entry);
        m.select64(Cond::Gt, self.result, byte_offset, 0, object, storage);
    }

    pub(super) fn load_found(&self, m: &mut MacroAssembler) {
        let (result, offset, done) = (self.result, self.temp, m.new_label());
        m.load32_signed64(offset, self.field(LoadEntry::OFFSET_OF_BYTE_OFFSET));
        m.move32(result, 0);
        m.branch_test32(TestCond::NonZero, offset, LoadEntry::IS_SPECIAL, done);
        let (base, object) = (self.entry, self.object);
        m.load64(base, self.field(LoadEntry::OFFSET_OF_HOLDER));
        m.load64(result, at(object, JsObject::OFFSET_OF_STORAGE));
        m.select64(Cond::Gt, result, offset, 0, object, result);
        m.select_test64(TestCond::NonZero, result, base, -1, base, result);
        m.load64(result, Address::indexed(result, offset, Scale::One, 0));
        m.bind(done);
    }

    pub(super) fn call_thunk(&self, m: &mut MacroAssembler) {
        m.compute_address(SP, Address::new(SP, -(size_of::<Searched>() as i32)));
        m.store64(at(SP, offset_of!(Searched, object)), self.object);
        let name = self.name_in(m, self.temp);
        m.store64(at(SP, offset_of!(Searched, name)), name);
        if let Some(value) = self.value {
            let is_fixed = matches!(self.name, Name::Fixed(..));
            m.store64(at(SP, offset_of!(Searched, value)), value);
            m.store32(at(SP, offset_of!(Searched, is_fixed)), i32::from(is_fixed));
        }
        m.call_address(self.thunk);
        m.load64(self.result, at(SP, 0));
        m.compute_address(SP, at(SP, size_of::<Searched>()));
    }
}

impl Emitter<'_> {
    pub(super) fn search_and_load(
        &mut self,
        m: &mut MacroAssembler,
        site: &PatchpointSite<'_>,
        search: u32,
    ) {
        let search = self.graph.searches[search as usize];
        let searching = Searching::new(self.thunks.search_and_load, search, site);
        let slow = self.cold(m, Cold::Search(searching));
        searching.find_entry(m, LookupTables::OFFSET_OF_LOADS, slow.start);
        if let Some(usual) = search.usual_byte_offset {
            // So the load need not wait for the entry.
            let other = self.cold(m, Cold::LoadFound(searching));
            let byte_offset = searching.field(LoadEntry::OFFSET_OF_BYTE_OFFSET);
            m.branch32(Cond::Ne, byte_offset, usual, other.start);
            m.branch_if_not_zero64(searching.field(LoadEntry::OFFSET_OF_HOLDER), other.start);
            let mut base = searching.object;
            if usual < 0 {
                m.load64(searching.result, at(base, JsObject::OFFSET_OF_STORAGE));
                base = searching.result;
            }
            m.load64(searching.result, Address::new(base, usual));
            m.bind(other.end);
        } else {
            searching.load_found(m);
        }
        m.bind(slow.end);
    }

    pub(super) fn search_for_store(
        &mut self,
        m: &mut MacroAssembler,
        site: &PatchpointSite<'_>,
        search: u32,
    ) {
        let search = self.graph.searches[search as usize];
        let searching = Searching::new(self.thunks.search_for_store, search, site);
        let (slow, same_shape) = (self.cold(m, Cold::Search(searching)), m.new_label());
        let Searching {
            object,
            result,
            temp,
            ..
        } = searching;
        searching.find_entry(m, LookupTables::OFFSET_OF_STORES, slow.start);
        m.load32_signed64(temp, searching.field(StoreEntry::OFFSET_OF_BYTE_OFFSET));
        m.branch_test32(TestCond::NonZero, temp, StoreEntry::IS_SPECIAL, slow.start);
        let shape = at(object, JsCell::OFFSET_OF_SHAPE_ID);
        m.load32(result, searching.field(StoreEntry::OFFSET_OF_NEW_SHAPE));
        m.branch32(Cond::Eq, result, shape, same_shape);
        m.store32(shape, result);
        m.bind(same_shape);
        m.move64(result, object);
        searching.find_base(m, temp);
        m.add64(result, result, temp);
        m.bind(slow.end);
    }
}
