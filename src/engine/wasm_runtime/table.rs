//! Tables of references.

use core::alloc::Layout;
use core::cell::Cell;
use core::ptr::NonNull;
use core::sync::atomic::{AtomicU32, Ordering};
use std::alloc;
use std::rc::Rc;

use bun_engine_asm::Width;
use bun_engine_wasm_compiler::abi::{Callable, FunctionElement, TableView, Trap};
use bun_engine_wasm_format::limits::MAX_TABLE_ENTRIES;
use bun_engine_wasm_format::{AbstractHeapType, CanonicalValType, Limits, OutOfMemory};
use bun_threading::Mutex;

use crate::instance::Instance;
use crate::registry::{Registration, Registry};
use crate::store::Store;
use crate::value::{HostCell, Reference};
use crate::words;

pub struct TableType {
    /// A reference type.
    pub element: CanonicalValType,
    pub address: Width,
    pub limits: Limits,
}

pub struct Table {
    store: Rc<Store>,
    ty: TableType,
    holds_functions: bool,
    /// `capacity` times a `FunctionElement` or a `Reference`, of which the first `length` are initialized.
    elements: Cell<NonNull<u64>>,
    length: Cell<u32>,
    capacity: AtomicU32,
    /// Held to change `elements` or `length`, and by other threads to read them.
    shape: Mutex,
    views: Registry<TableView>,
    owner: Cell<Option<HostCell>>,
}

const WORDS_OF_FUNCTION: usize = size_of::<FunctionElement>() / 8;

fn words_of(callable: Callable, reference: u64) -> [u64; WORDS_OF_FUNCTION] {
    let element = FunctionElement {
        callable,
        reference,
    };
    // SAFETY: it consists of words.
    unsafe { core::mem::transmute(element) }
}

impl Table {
    /// The elements are null.
    pub fn new(store: &Rc<Store>, ty: TableType) -> Result<Rc<Self>, OutOfMemory> {
        let length = u32::try_from(ty.limits.initial).map_err(|_| OutOfMemory)?;
        if length > MAX_TABLE_ENTRIES {
            return Err(OutOfMemory);
        }
        let element = ty.element.erased().as_ref().expect("a reference type");
        let table = Self {
            store: Rc::clone(store),
            holds_functions: element.heap_type().abstract_type().top() == AbstractHeapType::Func,
            ty,
            elements: Cell::new(NonNull::dangling()),
            length: Cell::new(0),
            capacity: AtomicU32::new(0),
            shape: Mutex::new(),
            views: Registry::default(),
            owner: Cell::new(None),
        };
        if length != 0 {
            // SAFETY: the size is not zero.
            let elements = unsafe { alloc::alloc_zeroed(table.layout(length)) };
            let elements = NonNull::new(elements).ok_or(OutOfMemory)?;
            table.elements.set(elements.cast());
            table.capacity.store(length, Ordering::Relaxed);
            if !table.holds_functions {
                // SAFETY: within the capacity.
                unsafe { table.write_many(0, Reference::NULL, length) };
            }
            table.length.set(length);
        }
        Ok(Rc::new(table))
    }

    fn layout(&self, capacity: u32) -> Layout {
        let layout = match self.holds_functions {
            true => Layout::array::<FunctionElement>(capacity as usize),
            false => Layout::array::<Reference>(capacity as usize),
        };
        layout.expect("a table is not that long")
    }

    /// As it was declared.
    pub fn ty(&self) -> &TableType {
        &self.ty
    }

    #[inline]
    pub fn len(&self) -> u32 {
        self.length.get()
    }

    fn capacity(&self) -> u32 {
        self.capacity.load(Ordering::Relaxed)
    }

    /// What it takes outside the heap. On any thread.
    pub fn size_in_bytes(&self) -> usize {
        self.layout(self.capacity()).size()
    }

    pub fn owner(&self) -> Option<HostCell> {
        self.owner.get()
    }

    /// Before anything is put in.
    ///
    /// # Safety
    /// The cell keeps and traces the table. The elements have their type by the time an instance uses them.
    pub unsafe fn set_owner(&self, owner: HostCell) {
        self.owner.set(Some(owner));
    }

    #[inline]
    fn write_barrier(&self) {
        self.store.write_barrier(self.owner().expect("an owner"));
    }

    fn words_per_element(&self) -> usize {
        match self.holds_functions {
            true => WORDS_OF_FUNCTION,
            false => 1,
        }
    }

    #[inline]
    fn element(&self, index: u32) -> *mut u64 {
        let offset = index as usize * self.words_per_element();
        self.elements.get().as_ptr().wrapping_add(offset)
    }

    #[inline]
    pub(crate) fn check_range(&self, start: u64, count: u64) -> Result<(u32, u32), Trap> {
        match start.checked_add(count) {
            Some(end) if end <= self.len().into() => Ok((start as u32, count as u32)),
            _ => Err(Trap::TableOutOfBounds),
        }
    }

    /// # Safety
    /// The range is within the capacity, and `value` has the type of the elements.
    #[inline]
    unsafe fn write_many(&self, start: u32, value: Reference, count: u32) {
        let (engine, first, count) = (self.store.engine(), self.element(start), count as usize);
        if !self.holds_functions {
            // SAFETY: the caller's.
            return unsafe { engine.fill_words(first, [value.0], count) };
        }
        let element = value.cell().map_or([0; WORDS_OF_FUNCTION], |function| {
            // SAFETY: what is not null in such a table is a function.
            words_of(unsafe { engine.callable_of(function) }, value.0)
        });
        // SAFETY: the caller's.
        unsafe { engine.fill_words(first, element, count) };
    }

    /// The object for a function is made when it is first asked for.
    pub fn get(&self, index: u64) -> Result<Reference, Trap> {
        let (index, _) = self.check_range(index, 1)?;
        if !self.holds_functions {
            // SAFETY: in bounds.
            return Ok(Reference(unsafe { self.element(index).read() }));
        }
        // SAFETY: in bounds.
        let element = unsafe { self.element(index).cast::<FunctionElement>().read() };
        if element.reference != 0 {
            return Ok(Reference(element.reference));
        }
        let reference = if element.callable.rtt == 0 {
            Reference::NULL
        } else {
            // SAFETY: the table keeps the instance alive.
            let instance = unsafe { Instance::of_callable(self.store.engine(), &element.callable) };
            instance.function_reference(instance.func_with_slot(element.callable.slot))?
        };
        // SAFETY: tables do not shrink.
        unsafe { self.write_callable(index, element.callable, reference.0) };
        Ok(reference)
    }

    /// # Safety
    /// `value` has the type of the elements.
    #[inline]
    pub unsafe fn fill(&self, start: u64, value: Reference, count: u64) -> Result<(), Trap> {
        let (start, count) = self.check_range(start, count)?;
        // SAFETY: in bounds, and the caller's.
        unsafe { self.write_many(start, value, count) };
        if value.cell().is_some() {
            self.write_barrier();
        }
        Ok(())
    }

    /// Without the barrier, which is for `finish_writes`.
    ///
    /// # Safety
    /// `index` is in bounds, and the function has the type of the elements.
    #[inline]
    pub(crate) unsafe fn write_callable(&self, index: u32, callable: Callable, reference: u64) {
        let (engine, element) = (self.store.engine(), words_of(callable, reference));
        // SAFETY: the caller's.
        unsafe { engine.fill_words(self.element(index), element, 1) };
    }

    pub(crate) fn finish_writes(&self) {
        self.write_barrier();
    }

    /// Gives the length before, or `None` if it cannot grow so far.
    ///
    /// # Safety
    /// `value` has the type of the elements.
    pub unsafe fn grow(&self, added: u64, value: Reference) -> Option<u32> {
        let old = self.len();
        let most = self.ty.limits.maximum.unwrap_or(u64::MAX);
        let most = most.min(MAX_TABLE_ENTRIES.into());
        let new = added.checked_add(old.into()).filter(|&new| new <= most)?;
        let (new, size_before) = (new as u32, self.size_in_bytes());
        let shape = self.shape.lock_guard();
        if new > self.capacity() {
            let ample = new.max(old + old / 2).min(most as u32);
            self.reallocate(ample).or_else(|| self.reallocate(new))?;
        }
        // SAFETY: within the capacity, and the caller's.
        unsafe { self.write_many(old, value, new - old) };
        self.length.set(new);
        drop(shape);
        self.views.write_all(|| self.view());
        if value.cell().is_some() {
            self.write_barrier();
        }
        if self.size_in_bytes() != size_before {
            let (host, vm) = self.store.host();
            let owner = self.owner().expect("an owner");
            host.report_allocation(vm, owner, self.size_in_bytes() - size_before);
        }
        Some(old)
    }

    fn reallocate(&self, capacity: u32) -> Option<()> {
        let (old, new) = (self.layout(self.capacity()), self.layout(capacity));
        // SAFETY: the new size is not zero, and the elements were allocated with `old` unless that is empty.
        let elements = unsafe {
            match old.size() {
                0 => alloc::alloc(new),
                _ => alloc::realloc(self.elements.get().as_ptr().cast(), old, new.size()),
            }
        };
        self.elements.set(NonNull::new(elements)?.cast());
        self.capacity.store(capacity, Ordering::Relaxed);
        Some(())
    }

    /// # Safety
    /// The type of the elements of `from` is a subtype of that of the elements of `self`.
    pub(crate) unsafe fn copy_from(
        &self,
        from: &Self,
        dst: u64,
        src: u64,
        count: u64,
    ) -> Result<(), Trap> {
        let (dst, _) = self.check_range(dst, count)?;
        let (src, count) = from.check_range(src, count)?;
        let (engine, count) = (
            self.store.engine(),
            count as usize * self.words_per_element(),
        );
        // SAFETY: in bounds. Types that are related have elements of the same kind.
        unsafe { engine.move_words(self.element(dst), from.element(src), count) };
        self.write_barrier();
        Ok(())
    }

    /// On any thread, while the thread of the table runs.
    pub fn trace(&self, mut visit: impl FnMut(HostCell)) {
        let _shape = self.shape.lock_guard();
        // SAFETY: in bounds, and the elements do not move meanwhile.
        let word = |index, offset| unsafe { words::load(self.element(index).byte_add(offset)) };
        let mut visit = |value| Reference(value).cell().into_iter().for_each(&mut visit);
        if !self.holds_functions {
            return (0..self.len()).for_each(|index| visit(word(index, 0)));
        }
        // An instance keeps the objects for its functions.
        let mut last_instance = 0;
        for index in 0..self.len() {
            let instance = word(index, Callable::INSTANCE as usize);
            if core::mem::replace(&mut last_instance, instance) != instance {
                visit(instance);
            }
        }
    }

    fn view(&self) -> TableView {
        TableView {
            elements: self.elements.get().as_ptr().expose_provenance(),
            length: self.len().into(),
            owner: self.owner().expect("an owner").address(),
        }
    }

    /// # Safety
    /// `view` is valid for writes until it is removed.
    pub(crate) unsafe fn add_view(&self, view: *mut TableView) -> Registration {
        // SAFETY: the caller's.
        unsafe {
            view.write(self.view());
            self.views.add(view)
        }
    }

    pub(crate) fn remove_view(&self, registration: Registration) {
        self.views.remove(registration);
    }

    pub(crate) fn store(&self) -> &Rc<Store> {
        &self.store
    }
}

impl Drop for Table {
    fn drop(&mut self) {
        let layout = self.layout(self.capacity());
        if layout.size() != 0 {
            // SAFETY: allocated with this layout. Instances that have a view keep the table.
            unsafe { alloc::dealloc(self.elements.get().as_ptr().cast(), layout) };
        }
    }
}
