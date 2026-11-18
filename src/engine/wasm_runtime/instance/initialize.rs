//! What a module defines.

use std::rc::Rc;
use std::sync::Arc;

use bun_engine_wasm_compiler::abi::{GlobalPlace, MemoryMode};
use bun_engine_wasm_format::{
    GlobalIndex, MemoryIndex, OutOfMemory, TableIndex, TagIndex, TypeIndex, TypeKind,
};

use super::{ConstantError, Instance, set_once};
use crate::host::Owned;
use crate::memory::Memory;
use crate::table::{Table, TableType};
use crate::tag::Tag;
use crate::value::Reference;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum InitializeError {
    OutOfMemory,
    /// A table is too long, or there is no memory for it.
    Table,
    Constant(ConstantError),
}

impl From<OutOfMemory> for InitializeError {
    fn from(_: OutOfMemory) -> Self {
        Self::OutOfMemory
    }
}

impl From<ConstantError> for InitializeError {
    fn from(error: ConstantError) -> Self {
        Self::Constant(error)
    }
}

/// Those that are not imported, with their indices.
fn defined<T>(all: &[T], imported: u32) -> impl Iterator<Item = (u32, &T)> {
    (imported..).zip(&all[imported as usize..])
}

impl Instance {
    /// After an error the instance is of no use.
    pub fn initialize(&self) -> Result<(), InitializeError> {
        assert!(self.imports_linked.get() == self.module.imports().len());
        self.define_memories()?;
        let first_memory = self.memories().next();
        let mode = first_memory.map_or(MemoryMode::Checked, Memory::mode);
        self.module.make_code(mode)?.add_user(&self.store.retired);
        set_once(&self.mode, mode);
        self.define_tags()?;
        self.find_object_types()?;
        self.define_tables()?;
        self.define_globals()?;
        Ok(self.evaluate_elements()?)
    }

    fn define_memories(&self) -> Result<(), OutOfMemory> {
        for (index, &ty) in defined(self.module.memories(), self.module.imported().memories) {
            let wanted = match index {
                0 => MemoryMode::Guarded,
                _ => MemoryMode::Checked,
            };
            let memory = Memory::new(&self.store, ty, wanted)?;
            let owner = self.new_owner(Owned::Memory(Rc::clone(&memory)))?;
            // SAFETY: the host vouches for it.
            unsafe { memory.set_owner(owner) };
            self.keep_memory(MemoryIndex(index), memory);
        }
        Ok(())
    }

    fn define_tags(&self) -> Result<(), OutOfMemory> {
        for (index, &ty) in defined(self.module.tags(), self.module.imported().tags) {
            let tag = Tag::new(self.module.types().canonical(ty));
            let owner = self.new_owner(Owned::Tag(Arc::clone(&tag)))?;
            self.keep_tag(TagIndex(index), tag, owner);
        }
        Ok(())
    }

    fn find_object_types(&self) -> Result<(), OutOfMemory> {
        let types = self.module.types();
        let wanted = (0..types.len()).map(TypeIndex);
        let wanted =
            wanted.filter(|&ty| types.kind(ty) != TypeKind::Func && types.first_index(ty) == ty);
        let count = wanted.clone().count();
        (self.traced.lock().kept.try_reserve(count)).map_err(|_| OutOfMemory)?;
        for ty in wanted {
            let supertype = types.supertype(ty);
            let supertype = supertype.map(|it| self.object_header(types.first_index(it)));
            let found = self.engine().host().object_type(self, ty, supertype);
            let (header, cell) = found.ok_or(OutOfMemory)?;
            self.write_word(self.module.layout().object_header(ty), header as usize);
            self.keep_alive(cell);
        }
        Ok(())
    }

    fn define_tables(&self) -> Result<(), InitializeError> {
        for (index, declared) in defined(self.module.tables(), self.module.imported().tables) {
            let ty = TableType {
                element: self.module.types().canonical_value(declared.element.into()),
                address: declared.address,
                limits: declared.limits,
            };
            let table = Table::new(&self.store, ty).map_err(|_| InitializeError::Table)?;
            let owner = self.new_owner(Owned::Table(Rc::clone(&table)))?;
            // SAFETY: the host vouches for it. A table without initializer can hold null.
            unsafe { table.set_owner(owner) };
            self.keep_table(TableIndex(index), table);
            if let Some(init) = declared.init {
                let value = Reference(self.evaluate(init)? as u64);
                let table = self.table(TableIndex(index));
                // SAFETY: the initializer was validated.
                unsafe { table.fill(0, value, table.len().into()) }.expect("in bounds");
            }
        }
        Ok(())
    }

    fn define_globals(&self) -> Result<(), InitializeError> {
        for (index, declared) in defined(self.module.globals(), self.module.imported().globals) {
            let index = GlobalIndex(index);
            let value = self.evaluate(declared.init.expect("an initializer"))?;
            match self.module.layout().global(index) {
                GlobalPlace::Inline(offset) => self.set_inline_global(index, offset, value),
                GlobalPlace::Indirect(_) => drop(self.define_global(index, value)?),
            }
        }
        Ok(())
    }
}
