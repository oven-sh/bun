use core::cell::UnsafeCell;
use core::marker::PhantomData;
use core::sync::atomic::{AtomicU64, Ordering};

use crate::heap::keep_alive;
use crate::{CellKind, Gc, GcFree, JsCell, Trace, Visitor};

pub(super) const TAG_SHIFT: u32 = 48;
pub(super) const ADDRESS_MASK: u64 = (1 << TAG_SHIFT) - 1;

/// An `Option<Gc<T>>` with 16 bits of the owner's choosing above the address.
#[repr(transparent)]
pub struct TaggedField<T>(UnsafeCell<u64>, PhantomData<T>);

impl<T> !GcFree for TaggedField<T> {}

/// It does not look like an address, so the collector has to be able to see the cell itself up to here.
#[inline(always)]
fn word<T>(cell: Option<Gc<T>>, tag: u16) -> u64 {
    let address = cell.map_or(0, Gc::address);
    keep_alive(address);
    address as u64 | u64::from(tag) << TAG_SHIFT
}

impl<T: CellKind> TaggedField<T> {
    /// The cell is set once the owner exists.
    #[inline(always)]
    pub(super) fn new(tag: u16) -> TaggedField<T> {
        TaggedField(UnsafeCell::new(u64::from(tag) << TAG_SHIFT), PhantomData)
    }

    #[inline(always)]
    fn atomic(&self) -> &AtomicU64 {
        // SAFETY: aligned. The plain loads are on the only thread that stores.
        unsafe { AtomicU64::from_ptr(self.0.get()) }
    }

    #[inline(always)]
    pub(super) fn bits(&self) -> u64 {
        // SAFETY: only this thread stores.
        unsafe { *self.0.get() }
    }

    #[inline(always)]
    pub(super) fn tag(&self) -> u16 {
        (self.bits() >> TAG_SHIFT) as u16
    }

    #[inline(always)]
    pub(super) fn cell(&self) -> Option<Gc<T>> {
        let address = (self.bits() & ADDRESS_MASK) as usize;
        // SAFETY: stored as a `Gc<T>`, and the owner keeps it alive.
        (address != 0).then(|| unsafe { Gc::from_address(address) })
    }

    #[inline(always)]
    pub(super) fn set_tag(&self, tag: u16) {
        let word = self.bits() & ADDRESS_MASK | u64::from(tag) << TAG_SHIFT;
        self.atomic().store(word, Ordering::Relaxed);
    }

    #[inline(always)]
    pub(super) fn clear(&self, tag: u16) {
        (self.atomic()).store(u64::from(tag) << TAG_SHIFT, Ordering::Relaxed);
    }

    /// # Safety
    /// `owner` is the cell that traces the field.
    #[inline(always)]
    pub(super) unsafe fn set(&self, owner: &JsCell, cell: Option<Gc<T>>, tag: u16) {
        self.atomic().store(word(cell, tag), Ordering::Relaxed);
        owner.write_barrier_for_cell();
    }

    /// # Safety
    /// As for `Field::set_without_barrier`.
    #[inline(always)]
    pub(super) unsafe fn set_without_barrier(&self, cell: Option<Gc<T>>, tag: u16) {
        self.atomic().store(word(cell, tag), Ordering::Relaxed);
    }
}

// SAFETY: `set` runs the barrier.
unsafe impl<T: CellKind> Trace for TaggedField<T> {
    #[inline(always)]
    fn trace(&self, visitor: &mut Visitor) {
        // SAFETY: zero or a cell that the owner keeps alive.
        unsafe { visitor.append_word(self.atomic().load(Ordering::Relaxed) & ADDRESS_MASK) }
    }
}
