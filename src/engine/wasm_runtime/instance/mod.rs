//! Instances of modules.

mod constant;
mod initialize;
mod link;
mod segments;

use core::cell::{Cell, OnceCell};
use core::mem::offset_of;
use core::num::NonZeroUsize;
use core::ptr;
use core::sync::atomic::{AtomicPtr, Ordering};
use std::rc::Rc;
use std::sync::Arc;

use bun_engine_wasm_compiler::abi::{
    Callable, GlobalPlace, Import, InstanceLayout, MemoryMode, MemoryView, Signature, Trap,
};
use bun_engine_wasm_format::{
    ElemIndex, FuncIndex, GlobalIndex, MemoryIndex, OutOfMemory, TableIndex, TagIndex, TypeIndex,
};
use bun_threading::Guarded;

pub use self::constant::ConstantError;
pub use self::initialize::InitializeError;
pub use self::link::{LinkError, NativeImport};
pub(crate) use self::segments::Elements;
pub use self::segments::SegmentError;
use self::segments::Segments;
use crate::alloc::try_defaults;
use crate::code::CodeGroup;
use crate::engine::Engine;
use crate::frames::Resumption;
use crate::global::Global;
use crate::host::Owned;
use crate::memory::Memory;
use crate::module::Module;
use crate::registry::Registration;
use crate::slot;
use crate::store::Store;
use crate::table::Table;
use crate::tag::Tag;
use crate::value::{Bits, HostCell, Reference};
use crate::words;

/// It is at the end of the cell, after what compiled code accesses, so a reference to it keeps the cell alive.
///
/// After `create` come a `link_*` for each import, `initialize`, `apply_segments` and a call of the start function.
pub struct Instance {
    cell: HostCell,
    memory_views: *const MemoryView,
    store: Rc<Store>,
    module: Arc<Module>,
    mode: OnceCell<MemoryMode>,
    memories: Box<[OnceCell<(Rc<Memory>, Registration)>]>,
    tables: Box<[OnceCell<(Rc<Table>, Registration)>]>,
    /// For those that are indirect, were imported as objects or were asked for.
    globals: Box<[OnceCell<Rc<Global>>]>,
    /// Each with a cell that keeps it.
    tags: Box<[OnceCell<(Arc<Tag>, HostCell)>]>,
    segments: Segments,
    /// Not locked while the host is called.
    traced: Guarded<Traced>,
    resumption: Resumption,
    imports_linked: Cell<usize>,
    entry_limit: Registration,
}

#[derive(Default)]
struct Traced {
    /// For as long as the instance lives.
    kept: Vec<HostCell>,
    /// What the constant expression that is being evaluated has made.
    temporaries: Vec<HostCell>,
    /// By segment, in order, the values of the items that are `ConstExpr::Code`, and zero for the others.
    evaluated: Vec<(ElemIndex, Box<[Reference]>)>,
}

const _: () = assert!(align_of::<Instance>() == 8);

impl Instance {
    pub(crate) const RESUMPTION: i32 = offset_of!(Self, resumption) as i32;

    pub fn cell_size(module: &Module) -> usize {
        Self::offset_in_cell(module) + size_of::<Self>()
    }

    fn offset_in_cell(module: &Module) -> usize {
        module.layout().size().next_multiple_of(8) as usize
    }

    /// # Safety
    /// `cell` has [`Instance::cell_size`] bytes, zeros after the header. It is traced with [`Instance::trace`], ends
    /// with [`Instance::destroy`], and lives for `'a`.
    pub unsafe fn create<'a>(
        cell: HostCell,
        store: &Rc<Store>,
        module: Arc<Module>,
    ) -> Result<&'a Self, OutOfMemory> {
        assert!(ptr::eq(store.engine(), module.engine()));
        let host = store.engine().layout();
        let memories = try_defaults(module.memories().len())?;
        let tables = try_defaults(module.tables().len())?;
        let globals = try_defaults(module.globals().len())?;
        let tags = try_defaults(module.tags().len())?;
        let segments = Segments::new(&module)?;
        let place = cell.field::<Self>(Self::offset_in_cell(&module) as i32);
        // SAFETY: the offsets are within the cell, which stays until `destroy` removes the registration.
        unsafe {
            place.write(Self {
                cell,
                memory_views: cell.field(module.layout().memory(MemoryIndex(0))),
                store: Rc::clone(store),
                module,
                mode: OnceCell::new(),
                memories,
                tables,
                globals,
                tags,
                segments,
                traced: Guarded::default(),
                resumption: Resumption::default(),
                imports_linked: Cell::new(0),
                entry_limit: (store.interrupts())
                    .add_mirror(cell.field(InstanceLayout::entry_limit(host))),
            });
            cell.field::<usize>(InstanceLayout::stack_limit(host))
                .write(store.stack_limit());
            cell.field::<usize>(InstanceLayout::vm(host))
                .write(store.vm().0);
            cell.field::<usize>(InstanceLayout::allocators(host))
                .write(store.allocators());
            cell.field::<usize>(InstanceLayout::object_types(host))
                .write(host.object_types);
            Self::place_in(store.engine(), cell).store(place, Ordering::Release);
            Ok(&*place)
        }
    }

    /// # Safety
    /// `cell` is for an instance of this engine, and lives for `'a`.
    unsafe fn place_in<'a>(engine: &Engine, cell: HostCell) -> &'a AtomicPtr<Self> {
        let word = cell.field(InstanceLayout::runtime_data(engine.layout()));
        // SAFETY: the caller's. It is aligned, and only this module writes it.
        unsafe { AtomicPtr::from_ptr(word) }
    }

    /// `None` if `create` has not succeeded.
    ///
    /// # Safety
    /// `cell` is for an instance of this engine, and lives for `'a`.
    #[inline]
    pub unsafe fn of_cell<'a>(engine: &Engine, cell: HostCell) -> Option<&'a Self> {
        // SAFETY: the word is zero or what `create` wrote.
        unsafe {
            Self::place_in(engine, cell)
                .load(Ordering::Acquire)
                .as_ref()
        }
    }

    /// # Safety
    /// `callable` is not null, and its instance lives for `'a`.
    pub unsafe fn of_callable<'a>(engine: &Engine, callable: &Callable) -> &'a Self {
        let cell = NonZeroUsize::new(callable.instance).map(HostCell);
        // SAFETY: the caller's.
        let instance = cell.and_then(|cell| unsafe { Self::of_cell(engine, cell) });
        instance.expect("a function has an instance")
    }

    /// # Safety
    /// `cell` is for an instance of this engine, and nothing uses it any more.
    pub unsafe fn destroy(engine: &Engine, cell: HostCell) {
        // SAFETY: the word is zero or what `create` wrote.
        unsafe {
            let instance = Self::place_in(engine, cell).swap(ptr::null_mut(), Ordering::Acquire);
            if !instance.is_null() {
                instance.drop_in_place();
            }
        }
    }

    #[inline]
    pub fn cell(&self) -> HostCell {
        self.cell
    }

    #[inline]
    pub fn store(&self) -> &Rc<Store> {
        &self.store
    }

    #[inline]
    pub fn module(&self) -> &Arc<Module> {
        &self.module
    }

    #[inline]
    pub(crate) fn engine(&self) -> &'static Engine {
        self.store.engine()
    }

    /// After `initialize`.
    #[inline]
    pub fn mode(&self) -> MemoryMode {
        *self.mode.get().expect("an initialized instance")
    }

    #[inline]
    pub(crate) fn code(&self) -> &CodeGroup {
        self.module.code(self.mode())
    }

    #[inline]
    pub fn memory(&self, memory: MemoryIndex) -> &Rc<Memory> {
        &self.memories[memory.usize()].get().expect("a memory").0
    }

    pub(crate) fn memories(&self) -> impl Iterator<Item = &Memory> {
        self.memories
            .iter()
            .filter_map(|slot| Some(&*slot.get()?.0))
    }

    /// # Safety
    /// The module has such a memory.
    #[inline]
    pub(crate) unsafe fn memory_view(&self, memory: MemoryIndex) -> *const MemoryView {
        // SAFETY: the views follow each other.
        unsafe { self.memory_views.add(memory.usize()) }
    }

    #[inline]
    pub fn table(&self, table: TableIndex) -> &Rc<Table> {
        &self.tables[table.usize()].get().expect("a table").0
    }

    #[inline]
    pub fn tag(&self, tag: TagIndex) -> &Arc<Tag> {
        &self.tags[tag.usize()].get().expect("a tag").0
    }

    /// The cell that was linked with it, or made for it.
    #[inline]
    pub fn tag_owner(&self, tag: TagIndex) -> HostCell {
        self.tags[tag.usize()].get().expect("a tag").1
    }

    /// For a global that is exported.
    pub fn global(&self, index: GlobalIndex) -> Result<&Rc<Global>, OutOfMemory> {
        let slot = &self.globals[index.usize()];
        if let Some(global) = slot.get() {
            return Ok(global);
        }
        assert!(!self.module.global(index).mutable);
        self.define_global(index, self.global_value(index))
    }

    /// `value` has the type of the global.
    fn define_global(&self, index: GlobalIndex, value: Bits) -> Result<&Rc<Global>, OutOfMemory> {
        let declared = self.module.global(index);
        let ty = self.module.types().canonical_value(declared.ty);
        let global = Global::new(&self.store, ty, declared.mutable);
        let owner = self.new_owner(Owned::Global(Rc::clone(&global)))?;
        // SAFETY: the host vouches for the owner. The value is that of the global or of its validated initializer.
        unsafe {
            global.set_owner(owner);
            global.set(value);
        }
        Ok(self.keep_global(index, global))
    }

    fn keep_global(&self, index: GlobalIndex, global: Rc<Global>) -> &Rc<Global> {
        if let GlobalPlace::Indirect(offset) = self.module.layout().global(index) {
            self.write_word(offset, global.value_address());
        }
        self.keep_alive(global.owner().expect("an owner"));
        set_once(&self.globals[index.usize()], global)
    }

    fn keep_alive(&self, cell: HostCell) {
        self.traced.lock().kept.push(cell);
        self.write_barrier();
    }

    pub(crate) fn linked_global(&self, index: GlobalIndex) -> &Global {
        self.globals[index.usize()].get().expect("a global")
    }

    fn global_value(&self, index: GlobalIndex) -> Bits {
        match self.module.layout().global(index) {
            GlobalPlace::Inline(offset) => {
                let ty = self.module.global(index).ty;
                // SAFETY: the layout has room for a value of the type.
                unsafe { slot::read(self.cell.field(offset), ty) }
            }
            GlobalPlace::Indirect(_) => self.linked_global(index).get(),
        }
    }

    /// `value` has the type of the global.
    fn set_inline_global(&self, index: GlobalIndex, offset: i32, value: Bits) {
        let ty = self.module.global(index).ty;
        if ty.is_ref() {
            self.write_word(offset, value as usize);
            return self.write_barrier();
        }
        // SAFETY: the layout has room for a value of the type.
        unsafe { slot::write(self.cell.field(offset), ty, value) };
    }

    fn new_owner(&self, owned: Owned) -> Result<HostCell, OutOfMemory> {
        let owner = self.engine().host().new_owner(self, owned);
        owner.ok_or(OutOfMemory)
    }

    fn keep_memory(&self, index: MemoryIndex, memory: Rc<Memory>) {
        let view = self.cell.field(self.module.layout().memory(index));
        // SAFETY: the view is in the cell, and `drop` removes it.
        let registration = unsafe { memory.add_view(view) };
        self.keep_alive(memory.owner().expect("an owner"));
        set_once(&self.memories[index.usize()], (memory, registration));
    }

    fn keep_table(&self, index: TableIndex, table: Rc<Table>) {
        let view = self.cell.field(self.module.layout().table(index));
        // SAFETY: the view is in the cell, and `drop` removes it.
        let registration = unsafe { table.add_view(view) };
        self.keep_alive(table.owner().expect("an owner"));
        set_once(&self.tables[index.usize()], (table, registration));
    }

    fn keep_tag(&self, index: TagIndex, tag: Arc<Tag>, owner: HostCell) {
        self.write_word(self.module.layout().tag(index), tag.identity());
        self.keep_alive(owner);
        set_once(&self.tags[index.usize()], (tag, owner));
    }

    /// `offset` is from the layout.
    #[inline]
    fn read_word(&self, offset: i32) -> usize {
        debug_assert!(offset as u32 + 8 <= self.module.layout().size());
        // SAFETY: what the layout covers is initialized.
        unsafe { words::load(self.cell.field(offset)) as usize }
    }

    /// `offset` is from the layout.
    #[inline]
    fn write_word(&self, offset: i32, value: usize) {
        debug_assert!(offset as u32 + 8 <= self.module.layout().size());
        // SAFETY: within the cell, and no reference covers it.
        unsafe { words::store(self.cell.field(offset), value as u64) };
    }

    #[inline]
    fn write_barrier(&self) {
        self.store.write_barrier(self.cell);
    }

    pub(crate) fn import(&self, func: FuncIndex) -> *mut Import {
        assert!(func.0 < self.module.imported().funcs);
        self.cell.field(self.module.layout().import(func))
    }

    /// After `initialize`.
    #[inline]
    pub fn callable(&self, func: FuncIndex) -> Callable {
        let Some(code) = self.module.code_index(func) else {
            // SAFETY: it is in the cell.
            return unsafe { (*self.import(func)).callable };
        };
        let ty = self.module.func_type_index(func);
        Callable {
            slot: self.code().slot_address(code),
            instance: self.cell.address(),
            rtt: self.module.types().rtt(ty).address(),
        }
    }

    /// `slot` is from a `Callable` with this instance.
    pub fn func_with_slot(&self, slot: usize) -> FuncIndex {
        if let Some(code) = self.code().code_with_slot(slot) {
            return self.module.func_index(code);
        }
        let first = self.import(FuncIndex(0)).addr() + Import::STUB as usize;
        let index = slot.wrapping_sub(first) / size_of::<Import>();
        assert!(index < self.module.imported().funcs as usize);
        FuncIndex(index as u32)
    }

    /// Zero if there is none yet.
    #[inline]
    fn existing_function_reference(&self, func: FuncIndex) -> u64 {
        assert!(func.usize() < self.module.funcs().len());
        self.read_word(self.module.layout().function_reference(func)) as u64
    }

    fn set_function_reference(&self, func: FuncIndex, function: HostCell) {
        let offset = self.module.layout().function_reference(func);
        self.write_word(offset, function.address());
        self.keep_alive(function);
    }

    /// After `initialize`.
    pub fn function_reference(&self, func: FuncIndex) -> Result<Reference, Trap> {
        let existing = self.existing_function_reference(func);
        if existing != 0 {
            return Ok(Reference(existing));
        }
        let engine = self.engine();
        let function = engine.host().new_function(self, func);
        let function = function.ok_or(Trap::OutOfMemory)?;
        let stack_bytes = Signature::new(self.module.func_type(func)).stack_bytes;
        let place = function.field::<Callable>(engine.layout().function_callable);
        // SAFETY: the host made room for them.
        unsafe {
            place.write(self.callable(func));
            place.add(1).cast::<usize>().write(stack_bytes as usize);
        }
        engine.publish_fence();
        self.set_function_reference(func, function);
        Ok(function.into())
    }

    /// For the type of a struct or an array, as the driver names it.
    #[inline]
    pub(crate) fn object_header(&self, ty: TypeIndex) -> u64 {
        assert!(ty.0 < self.module.types().len());
        self.read_word(self.module.layout().object_header(ty)) as u64
    }

    /// # Safety
    /// `fill` writes values of the types of the tag to the payload, and makes no cells.
    pub(crate) unsafe fn new_exception(
        &self,
        tag: TagIndex,
        fill: impl FnOnce(*mut u8),
    ) -> Option<HostCell> {
        let engine = self.engine();
        let exception = (engine.host()).new_exception(self, self.tag(tag), self.tag_owner(tag))?;
        fill(exception.field(engine.layout().exception_payload));
        engine.publish_fence();
        Some(exception)
    }

    pub(crate) fn resumption(&self) -> &Resumption {
        &self.resumption
    }

    pub(crate) fn set_caught(&self, exception: HostCell) {
        let offset = InstanceLayout::caught(self.engine().layout());
        self.write_word(offset, exception.address());
    }

    /// On any thread, while the thread of the instance runs.
    pub fn trace(&self, mut visit: impl FnMut(HostCell)) {
        let traced = self.traced.lock();
        let evaluated = traced.evaluated.iter().flat_map(|(_, values)| values);
        let cells = traced.kept.iter().chain(&traced.temporaries).copied();
        cells
            .chain(evaluated.filter_map(|value| value.cell()))
            .for_each(&mut visit);
        drop(traced);

        for &offset in self.module.inline_references() {
            let value = Reference(self.read_word(offset) as u64);
            value.cell().into_iter().for_each(&mut visit);
        }
    }
}

impl Drop for Instance {
    fn drop(&mut self) {
        for (memory, registration) in self.memories.iter().filter_map(OnceCell::get) {
            memory.remove_view(*registration);
        }
        for (table, registration) in self.tables.iter().filter_map(OnceCell::get) {
            table.remove_view(*registration);
        }
        self.store.interrupts().remove_mirror(self.entry_limit);
        if self.mode.get().is_some() {
            self.code().remove_user(&self.store.retired);
        }
    }
}

fn set_once<T>(slot: &OnceCell<T>, value: T) -> &T {
    assert!(slot.get().is_none());
    slot.get_or_init(|| value)
}
