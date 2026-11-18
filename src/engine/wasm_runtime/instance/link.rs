//! Imports. They belong to the same store as the instance.

use core::ptr;
use std::rc::Rc;
use std::sync::Arc;

use bun_engine_macros::native_abi;
use bun_engine_wasm_compiler::abi::{Callable, GlobalPlace, Import};
use bun_engine_wasm_format::{
    FuncIndex, GlobalIndex, Limits, MemoryIndex, Rtt, TableIndex, TagIndex,
};

use super::Instance;
use crate::global::Global;
use crate::memory::Memory;
use crate::outcome::Outcome;
use crate::table::Table;
use crate::tag::Tag;
use crate::value::{Bits, HostCell, Reference};

/// Gets the arguments, anything for those that are not there, and the cell of the instance that imports it.
#[native_abi]
pub type NativeImport = unsafe fn(u64, u64, u64, HostCell) -> Outcome;

/// What does not match.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum LinkError {
    Type,
    Mutability,
    TooSmall,
    NoMaximum,
    MaximumTooLarge,
    Sharing,
    Address,
}

fn check_limits(size: u64, maximum: Option<u64>, expected: &Limits) -> Result<(), LinkError> {
    if size < expected.initial {
        return Err(LinkError::TooSmall);
    }
    match (maximum, expected.maximum) {
        (None, Some(_)) => Err(LinkError::NoMaximum),
        (Some(actual), Some(expected)) if actual > expected => Err(LinkError::MaximumTooLarge),
        _ => Ok(()),
    }
}

fn check(holds: bool, error: LinkError) -> Result<(), LinkError> {
    holds.then_some(()).ok_or(error)
}

impl Instance {
    fn count_import(&self, index: u32, imported: u32) {
        assert!(index < imported);
        self.imports_linked.set(self.imports_linked.get() + 1);
    }

    fn set_import(&self, func: FuncIndex, import: Import) {
        let place = self.import(func);
        // SAFETY: it is in the cell.
        unsafe {
            assert!((*place).callable.slot == 0);
            place.write(import);
        }
        self.count_import(func.0, self.module.imported().funcs);
    }

    fn rtt_of(&self, func: FuncIndex) -> &Rtt {
        self.module.types().rtt(self.module.func_type_index(func))
    }

    /// # Safety
    /// `function` is a `funcref` of the same store.
    pub unsafe fn link_function(
        &self,
        func: FuncIndex,
        function: HostCell,
    ) -> Result<(), LinkError> {
        // SAFETY: the caller's. The instance of the function keeps its type.
        let (callable, rtt) = unsafe {
            let callable = self.engine().callable_of(function);
            let rtt = ptr::with_exposed_provenance::<Rtt>(callable.rtt);
            (callable, &*rtt)
        };
        check(rtt.is_subtype_of(self.rtt_of(func)), LinkError::Type)?;
        self.set_function_reference(func, function);
        let import = Import {
            callable,
            stub: 0,
            host_function: 0,
            host_data: 0,
        };
        self.set_import(func, import);
        Ok(())
    }

    /// The instance keeps `function` alive.
    ///
    /// # Safety
    /// `stub` is code that can be called like a function of the declared type for as long as the instance lives, and
    /// `function` is a value of the host.
    pub unsafe fn link_host_function(
        &self,
        func: FuncIndex,
        stub: usize,
        function: Reference,
        data: usize,
    ) {
        let callable = Callable {
            slot: self.import(func).addr() + Import::STUB as usize,
            instance: self.cell.address(),
            rtt: self.rtt_of(func).address(),
        };
        let import = Import {
            callable,
            stub,
            host_function: function.0,
            host_data: data,
        };
        self.set_import(func, import);
        if let Some(function) = function.cell() {
            self.keep_alive(function);
        }
    }

    /// # Safety
    /// The declared type has up to three parameters and one result, each an integer or a reference, and `function` is
    /// for that type.
    pub unsafe fn link_native_function(&self, func: FuncIndex, function: NativeImport) {
        let engine = self.engine();
        let stub = (engine.stubs_if_any()).map_or(0, |stubs| stubs.native_call);
        let address = (function as *const ()).expose_provenance();
        // SAFETY: the caller's.
        unsafe { self.link_host_function(func, stub, Reference::NULL, address) };
    }

    /// The function of the engine itself that the import leads to, if it is one of those.
    pub fn native_import(&self, func: FuncIndex) -> Option<NativeImport> {
        let (function, data) = self.host_function(func)?;
        let address: *const () = ptr::with_exposed_provenance(function.is_null().then_some(data)?);
        // SAFETY: `link_native_function` made the address, and the function lives for good.
        Some(unsafe { core::mem::transmute::<*const (), NativeImport>(address) })
    }

    /// Returns the old one.
    ///
    /// # Safety
    /// As for [`Instance::link_host_function`], which has linked the import.
    pub unsafe fn replace_stub_of_import(&self, func: FuncIndex, stub: usize) -> usize {
        // SAFETY: it is in the cell.
        unsafe { (&raw mut (*self.import(func)).stub).replace(stub) }
    }

    /// What was given to [`Instance::link_host_function`] for it.
    pub fn host_function(&self, func: FuncIndex) -> Option<(Reference, usize)> {
        if func.0 >= self.module.imported().funcs {
            return None;
        }
        let place = self.import(func);
        // SAFETY: it is in the cell.
        let import = unsafe { &*place };
        // A function of WebAssembly keeps the callable of its own instance; this one is called through the import.
        let is_of_the_host = import.callable.slot == place.addr() + Import::STUB as usize;
        is_of_the_host.then_some((Reference(import.host_function), import.host_data))
    }

    pub fn link_global(&self, index: GlobalIndex, global: Rc<Global>) -> Result<(), LinkError> {
        assert!(Rc::ptr_eq(global.store(), &self.store));
        let declared = self.module.global(index);
        let expected = self.module.types().canonical_value(declared.ty);
        let fits = match declared.mutable {
            true => *global.ty() == expected,
            false => global.ty().is_subtype_of(&expected),
        };
        check(fits, LinkError::Type)?;
        check(
            global.is_mutable() == declared.mutable,
            LinkError::Mutability,
        )?;
        if let GlobalPlace::Inline(offset) = self.module.layout().global(index) {
            self.set_inline_global(index, offset, global.get());
        }
        self.keep_global(index, global);
        self.count_import(index.0, self.module.imported().globals);
        Ok(())
    }

    /// For a global that is not mutable.
    ///
    /// # Safety
    /// `value` has the declared type, and the global has not been linked.
    pub unsafe fn link_global_value(&self, index: GlobalIndex, value: Bits) {
        let GlobalPlace::Inline(offset) = self.module.layout().global(index) else {
            panic!("the global is mutable");
        };
        self.set_inline_global(index, offset, value);
        self.count_import(index.0, self.module.imported().globals);
    }

    pub fn link_table(&self, index: TableIndex, table: Rc<Table>) -> Result<(), LinkError> {
        assert!(Rc::ptr_eq(table.store(), &self.store));
        let (declared, actual) = (self.module.table(index), table.ty());
        check_limits(table.len().into(), actual.limits.maximum, &declared.limits)?;
        let expected = self.module.types().canonical_value(declared.element.into());
        check(actual.element == expected, LinkError::Type)?;
        check(actual.address == declared.address, LinkError::Address)?;
        self.keep_table(index, table);
        self.count_import(index.0, self.module.imported().tables);
        Ok(())
    }

    pub fn link_memory(&self, index: MemoryIndex, memory: Rc<Memory>) -> Result<(), LinkError> {
        assert!(Rc::ptr_eq(memory.store(), &self.store));
        let (declared, actual) = (self.module.memory(index), memory.ty());
        check_limits(memory.page_count(), actual.pages.maximum, &declared.pages)?;
        check(actual.shared == declared.shared, LinkError::Sharing)?;
        check(actual.address == declared.address, LinkError::Address)?;
        self.keep_memory(index, memory);
        self.count_import(index.0, self.module.imported().memories);
        Ok(())
    }

    /// # Safety
    /// `owner` is a cell that keeps the tag.
    pub unsafe fn link_tag(
        &self,
        index: TagIndex,
        tag: Arc<Tag>,
        owner: HostCell,
    ) -> Result<(), LinkError> {
        let expected = self.module.types().rtt(self.module.tags()[index.usize()]);
        check(ptr::eq(tag.ty().rtt(), expected), LinkError::Type)?;
        self.keep_tag(index, tag, owner);
        self.count_import(index.0, self.module.imported().tags);
        Ok(())
    }
}
