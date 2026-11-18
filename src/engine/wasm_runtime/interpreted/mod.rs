//! What an interpreter needs to run WebAssembly with nothing but safe code.
//!
//! All of it is reached through an [`Entry`], whose maker answers for the interpreter.

mod calls;
mod entry;
mod exceptions;
mod frames;
mod memory;
mod objects;
mod stack;
mod tables;

use core::cell::Cell;
use core::ptr;
use core::sync::atomic::{AtomicU64, AtomicUsize};

use bun_engine_wasm_compiler::abi::{FunctionSlot, InstanceLayout, MemoryView};
use bun_engine_wasm_format::{GlobalIndex, MemoryIndex};

pub use self::calls::Callee;
pub use self::entry::{Entry, Linkage, Parked};
pub(crate) use self::frames::Header;
pub use self::frames::{Frame, Site};
pub use self::memory::{Scalar, View};
pub use self::objects::Missing;
pub(crate) use self::stack::ValueStack;
pub use self::stack::{Slots, WINDOW, slot_count};
use crate::instance::Instance;
use crate::module::Module;
use crate::value::{HostCell, Reference};
use crate::words;

/// An instance, with what its functions need most often at hand.
pub struct Context<'a> {
    instance: &'a Instance,
    cell: HostCell,
    entry_limit: &'a AtomicUsize,
    top_frame: *mut usize,
    first_memory: *const MemoryView,
    length_of_first_memory: &'a AtomicU64,
    values: &'a [Cell<u64>],
    in_use: &'a Cell<usize>,
    /// That which function 0 would have if imports had such slots.
    first_function_slot: usize,
}

impl<'a> Context<'a> {
    #[inline]
    fn new(instance: &'a Instance, stack: &'a ValueStack) -> Self {
        let (store, cell) = (instance.store(), instance.cell());
        let entry_limit = cell.field(InstanceLayout::entry_limit(store.engine().layout()));
        let imports = instance.module().imported().funcs as usize;
        // SAFETY: words of the cell. Every instance has a view for the first memory.
        let (entry_limit, first_memory, length_of_first_memory) = unsafe {
            let view = instance.memory_view(MemoryIndex(0));
            let length = memory::length_in(view);
            (AtomicUsize::from_ptr(entry_limit), view, length)
        };
        Self {
            instance,
            cell,
            entry_limit,
            top_frame: store.top_frame(),
            first_memory,
            length_of_first_memory,
            values: stack.all(),
            in_use: stack.in_use(),
            first_function_slot: (instance.code().first_slot_address())
                .wrapping_sub(imports * FunctionSlot::SIZE),
        }
    }

    #[inline]
    pub fn module(&self) -> &'a Module {
        self.instance.module()
    }

    /// The interpreter has allocated so much that lives as long as the module.
    pub fn did_translate(&self, bytes: usize) {
        self.module().did_make_code(bytes);
        self.instance.engine().host().module_grew(self.instance);
    }

    /// What the translation of a module has to have got right, where a mistake would reach the memory of the host.
    /// Assertions turn such a mistake into a panic where they are on.
    #[inline(always)]
    fn assert_inside(&self, offset: u32, size: usize) {
        debug_assert!(
            offset as usize + size <= self.module().layout().size() as usize,
            "{size} bytes at {offset} are outside the cell of the instance"
        );
    }

    /// With the offset of an inline global, which is written through this only if it is no reference.
    #[inline(always)]
    pub fn global<const WORDS: usize>(&self, offset: u32) -> &[Cell<u64>; WORDS] {
        self.assert_inside(offset, WORDS * size_of::<u64>());
        // SAFETY: the layout has room for a value of the type, and other threads read only references.
        unsafe { &*self.cell.field(offset as i32) }
    }

    /// The same for one that is indirect.
    #[inline(always)]
    pub fn indirect_global<const WORDS: usize>(&self, offset: u32) -> &[Cell<u64>; WORDS] {
        self.assert_inside(offset, size_of::<usize>());
        // SAFETY: the address of the value of a `Global` that the instance keeps.
        unsafe { &*ptr::with_exposed_provenance(self.cell.field::<usize>(offset as i32).read()) }
    }

    #[inline]
    pub fn set_reference_in_global(&self, offset: u32, value: u64) {
        self.assert_inside(offset, size_of::<u64>());
        // SAFETY: a word of the cell.
        unsafe { words::store(self.cell.field(offset as i32), value) };
        self.did_store(self.cell, value);
    }

    pub fn set_reference_in_indirect_global(&self, global: GlobalIndex, value: u64) {
        // SAFETY: validated.
        unsafe { self.instance.linked_global(global).set(value.into()) };
    }

    #[inline]
    fn did_store(&self, owner: HostCell, value: u64) {
        if Reference(value).cell().is_some() {
            self.instance.store().write_barrier(owner);
        }
    }
}
