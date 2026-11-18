//! Names in the global scope, by where they are when the graph is built.

use bun_engine_bytecode::{MetadataKind, Operand, Register, op};
use bun_engine_codegen::ir::{Heap, Value as Ssa};
use bun_engine_text::PropertyName;
use bun_engine_vm::code::metadata::{GetGlobal, GlobalAccess};
use bun_engine_vm::ic::PrototypeLookup;
use bun_engine_vm::{
    Gc, GlobalBinding, GlobalLexicals, GlobalObject, GlobalPlace, RealmWatchpoint,
    SpeculatedType as T, WatchpointState,
};

use super::Builder;
use super::properties::{Load, Store};
use crate::graph::heaps;

impl Builder<'_> {
    fn binding_place(&mut self, address: usize) -> (Ssa, i32, Heap) {
        (
            self.word(address),
            GlobalBinding::OFFSET_OF_VALUE as i32,
            self.heap_member(heaps::Family::GlobalBinding, address),
        )
    }

    /// `None` if it takes more than a load.
    pub(super) fn find_global(
        &mut self,
        global: Gc<GlobalObject>,
        name: PropertyName<'_>,
        lexicals: GlobalLexicals,
    ) -> Option<Load> {
        Some(match global.anchor().place_for_load(name, lexicals) {
            GlobalPlace::Lexical(binding) | GlobalPlace::Variable(binding) => {
                let value = binding.get()?;
                if binding.watchpoints().state() == WatchpointState::Watched
                    && self.watch(binding.watchpoints())
                {
                    Load::Constant(value)
                } else {
                    Load::Binding(core::ptr::from_ref(binding).addr())
                }
            }
            GlobalPlace::Property(..) => {
                let lookup = PrototypeLookup::for_global_load(self.vm, global, name)?;
                self.rely_on(lookup);
                (lookup.constant()).map_or(Load::Inherited(lookup), Load::Constant)
            }
            GlobalPlace::Unknown => return None,
        })
    }

    /// One that has been initialized.
    pub(super) fn load_binding(&mut self, address: usize, metadata: u32) -> Option<Ssa> {
        let prediction = self.prediction_or_exit(metadata)?;
        let place = self.binding_place(address);
        let value = self.load_value_of_type(place, prediction, T::HEAP_TOP);
        self.note_profile(value, metadata);
        Some(value)
    }

    pub(super) fn get_from_global(
        &mut self,
        dst: Register,
        name: PropertyName<'_>,
        access: &GlobalAccess,
        metadata: u32,
    ) {
        let (global, lexicals) = (self.global(), self.frame().code_block.global_lexicals());
        let how = (access.has_run()).then(|| self.find_global(global, name, lexicals));
        let value = match how.flatten() {
            Some(Load::Constant(value)) => Some(self.value(value)),
            Some(Load::Binding(address)) => self.load_binding(address, metadata),
            Some(Load::Inherited(lookup)) => self.load_inherited(lookup, name, metadata),
            _ => return self.interpret_or_exit(metadata),
        };
        value.inspect(|&value| self.set(dst, value));
    }

    pub(super) fn get_global(&mut self, op: op::GetGlobal) {
        let code_block = self.frame().code_block;
        let code_block = code_block.anchor();
        let entry = code_block.checked_metadata::<GetGlobal>(MetadataKind::GetGlobal, op.metadata);
        let name = code_block.identifier(op.name);
        self.get_from_global(op.dst, name, &entry.access, op.metadata);
    }

    /// `None` if it takes more than a store.
    pub(super) fn find_global_to_assign(
        &mut self,
        global: Gc<GlobalObject>,
        name: PropertyName<'_>,
        lexicals: GlobalLexicals,
    ) -> Option<Store> {
        Some(match global.anchor().place_for_store(name, lexicals) {
            GlobalPlace::Lexical(binding) | GlobalPlace::Variable(binding) => {
                let which = RealmWatchpoint::GlobalVariablesAreWritable;
                if binding.watchpoints().is_still_valid()
                    || !self.watch(global.anchor().watchpoints(self.vm, which))
                {
                    return None;
                }
                Store::Binding(global, core::ptr::from_ref(binding).addr())
            }
            GlobalPlace::Property(..) => {
                let lookup = PrototypeLookup::for_global_store(self.vm, global, name)?;
                self.rely_on(lookup);
                Store::InHolder(lookup)
            }
            GlobalPlace::Unknown => return None,
        })
    }

    pub(super) fn store_binding(&mut self, global: Gc<GlobalObject>, address: usize, value: Ssa) {
        let (owner, (base, offset, heap)) = (self.cell(global.cell()), self.binding_place(address));
        self.store_value(owner, base, offset, heap, value);
    }

    pub(super) fn put_to_global(&mut self, name: PropertyName<'_>, value: Operand) {
        let (global, lexicals) = (self.global(), self.frame().code_block.global_lexicals());
        let (how, value) = (
            self.find_global_to_assign(global, name, lexicals),
            self.get(value),
        );
        match how {
            Some(Store::Binding(global, address)) => self.store_binding(global, address, value),
            Some(Store::InHolder(lookup)) => self.store_in_holder(lookup, name, value),
            _ => self.interpret_if_it_recurs(),
        }
    }

    pub(super) fn put_global(&mut self, op: op::PutGlobal) {
        let code_block = self.frame().code_block;
        self.put_to_global(code_block.anchor().identifier(op.name), op.value);
    }
}
