use core::cell::{Cell, RefCell};
use core::marker::PhantomData;
use core::ptr::NonNull;

use super::{FieldValue, GcFree, Visitor};
use crate::{Value, Vm};

const CHUNK_SIZE: usize = 4096;
const SLOT_COUNT: usize = CHUNK_SIZE / size_of::<u64>() - 2;

#[repr(C, align(4096))]
struct Chunk {
    /// Null once the heap is gone. The chunk then stays for the handles that are left.
    set: Cell<*const StrongSet>,
    used: Cell<usize>,
    slots: [Cell<u64>; SLOT_COUNT],
}

/// A free slot holds the address of the next one with this bit, which makes it no cell.
const FREE_TAG: u64 = Value::OTHER_TAG;

#[derive(Default)]
pub(super) struct StrongSet {
    chunks: RefCell<Vec<NonNull<Chunk>>>,
    first_free: Cell<usize>,
}

fn slot_at<'a>(address: usize) -> &'a Cell<u64> {
    // SAFETY: private to this file, which passes only the addresses of slots of live chunks.
    unsafe { &*core::ptr::with_exposed_provenance(address) }
}

fn chunk_of<'a>(slot: usize) -> &'a Chunk {
    // SAFETY: as above.
    unsafe { &*core::ptr::with_exposed_provenance(slot & !(CHUNK_SIZE - 1)) }
}

impl StrongSet {
    #[inline]
    pub(super) fn allocate(&self, word: u64) -> usize {
        if self.first_free.get() == 0 {
            self.grow();
        }
        let address = self.first_free.get();
        self.first_free
            .set((slot_at(address).replace(word) & !FREE_TAG) as usize);
        chunk_of(address).used.update(|used| used + 1);
        address
    }

    #[cold]
    fn grow(&self) {
        let chunk = Box::leak(Box::new(Chunk {
            set: Cell::new(self),
            used: Cell::new(0),
            slots: [const { Cell::new(0) }; SLOT_COUNT],
        }));
        core::ptr::from_mut(chunk).expose_provenance();
        for slot in chunk.slots.iter().rev() {
            slot.set(self.first_free.replace(slot.as_ptr().addr()) as u64 | FREE_TAG);
        }
        self.chunks.borrow_mut().push(NonNull::from(chunk));
    }

    fn for_each_word(&self, mut visit: impl FnMut(u64)) {
        for chunk in self.chunks.borrow().iter() {
            // SAFETY: owned by the set.
            let chunk = unsafe { chunk.as_ref() };
            if chunk.used.get() != 0 {
                chunk.slots.iter().for_each(|slot| visit(slot.get()));
            }
        }
    }

    pub(super) fn visit(&self, visitor: &mut Visitor) {
        // SAFETY: zero, a free link, or a value that has been kept alive so far.
        self.for_each_word(|word| unsafe { visitor.append_word(word) });
    }

    pub(super) fn for_each_cell(&self, mut visit: impl FnMut(usize)) {
        self.for_each_word(|word| {
            if word & Value::NOT_CELL_MASK == 0 && word != 0 {
                visit(word as usize);
            }
        });
    }

    /// Frees the chunks that have no handle, and puts the free slots back in order.
    pub(super) fn shrink(&self) {
        let mut chunks = self.chunks.borrow_mut();
        // SAFETY: owned by the set.
        let is_unused = |chunk: &NonNull<Chunk>| unsafe { chunk.as_ref() }.used.get() == 0;
        if chunks.iter().filter(|chunk| is_unused(chunk)).count() < 2 {
            return;
        }
        let mut address = self.first_free.take();
        while address != 0 {
            let next = (slot_at(address).get() & !FREE_TAG) as usize;
            if chunk_of(address).used.get() != 0 {
                slot_at(address).set(self.first_free.replace(address) as u64 | FREE_TAG);
            }
            address = next;
        }
        for chunk in chunks.extract_if(.., |chunk| is_unused(chunk)) {
            // SAFETY: leaked by `grow`, and no handle or free link refers to it.
            drop(unsafe { Box::from_raw(chunk.as_ptr()) });
        }
    }
}

impl Drop for StrongSet {
    fn drop(&mut self) {
        for chunk in self.chunks.get_mut().drain(..) {
            // SAFETY: leaked by `grow`.
            unsafe {
                if chunk.as_ref().used.get() == 0 {
                    drop(Box::from_raw(chunk.as_ptr()));
                } else {
                    chunk.as_ref().set.set(core::ptr::null());
                }
            }
        }
    }
}

/// # Safety
/// `slot` came from `Heap::allocate_strong_slot` on this thread and is not used again.
pub unsafe fn free_strong_slot(slot: usize) {
    let chunk = chunk_of(slot);
    chunk.used.update(|used| used - 1);
    // SAFETY: cleared when the set goes.
    if let Some(set) = unsafe { chunk.set.get().as_ref() } {
        slot_at(slot).set(set.first_free.replace(slot) as u64 | FREE_TAG);
    } else if chunk.used.get() == 0 {
        let chunk = core::ptr::with_exposed_provenance_mut::<Chunk>(slot & !(CHUNK_SIZE - 1));
        // SAFETY: leaked by `grow`, and that was the last handle.
        drop(unsafe { Box::from_raw(chunk) });
    }
}

/// Another slot with the same content, or zero if the heap is gone.
///
/// # Safety
/// `slot` came from `Heap::allocate_strong_slot` on this thread and has not been freed.
pub unsafe fn duplicate_strong_slot(slot: usize) -> usize {
    // SAFETY: as in `free_strong_slot`.
    let set = unsafe { chunk_of(slot).set.get().as_ref() };
    set.map_or(0, |set| set.allocate(slot_at(slot).get()))
}

/// Keeps a value alive from anywhere in memory.
#[repr(transparent)]
pub struct Strong<T> {
    slot: NonNull<Cell<u64>>,
    value: PhantomData<T>,
}

// SAFETY: the slot is a root.
unsafe impl<T> GcFree for Strong<T> {}

impl<T: FieldValue> Strong<T> {
    #[inline]
    pub fn new(vm: &Vm, value: T) -> Strong<T> {
        Strong {
            slot: NonNull::from(slot_at(vm.heap.allocate_strong_slot(value.to_word()))),
            value: PhantomData,
        }
    }

    /// Panics if the `Vm` is not the one that the handle was made with.
    #[inline]
    pub fn get(&self, vm: &Vm) -> T {
        let slot = self.slot.addr().get();
        assert!(core::ptr::eq(
            chunk_of(slot).set.get(),
            &raw const vm.heap.strong_set
        ));
        // SAFETY: the set has kept it alive.
        unsafe { T::from_word(slot_at(slot).get()) }
    }

    #[inline]
    pub fn set(&self, vm: &Vm, value: T) {
        let slot = self.slot.addr().get();
        assert!(core::ptr::eq(
            chunk_of(slot).set.get(),
            &raw const vm.heap.strong_set
        ));
        slot_at(slot).set(value.to_word());
    }
}

impl<T> Drop for Strong<T> {
    #[inline]
    fn drop(&mut self) {
        // SAFETY: owned by this handle.
        unsafe { free_strong_slot(self.slot.addr().get()) }
    }
}
