//! Objects and arrays with few members, made without a call.

use crate::heap::{ATOM_SIZE, EXACT_CUTOFF};
use crate::{
    ElementKind, Gc, GlobalObject, JsArray, JsCell, JsFinalObject, JsObject, Shape, ShapeFlags,
    ShapeId, ShapeSpec, Storage, Value, Vm,
};

const WORDS_PER_ATOM: usize = ATOM_SIZE / size_of::<u64>();

/// Copies from 1 to 16 words in two moves, which may overlap.
///
/// # Safety
/// There is room for them.
#[inline(always)]
unsafe fn copy_words(values: &[Value], target: *mut u64) {
    /// # Safety
    /// From `N` to twice as many.
    #[inline(always)]
    unsafe fn copy_ends<const N: usize>(source: *const u64, target: *mut u64, count: usize) {
        // SAFETY: the callers'.
        unsafe {
            target.copy_from_nonoverlapping(source, N);
            (target.add(count - N)).copy_from_nonoverlapping(source.add(count - N), N);
        }
    }
    let (source, count) = (values.as_ptr().cast(), values.len());
    // SAFETY: the caller's.
    unsafe {
        match count {
            ..=2 => copy_ends::<1>(source, target, count),
            3..=4 => copy_ends::<2>(source, target, count),
            5..=8 => copy_ends::<4>(source, target, count),
            _ => copy_ends::<8>(source, target, count),
        }
    }
}

/// A shape of ordinary objects whose properties fill a small cell, up to one slot. It is not kept alive.
#[derive(Clone, Copy)]
pub(crate) struct SnugShape(ShapeId);

impl SnugShape {
    const HEADER: u32 = ShapeSpec::of::<JsFinalObject>().instance_header();

    pub(crate) fn fits(shape: &Shape) -> bool {
        let unfit = ShapeFlags::DICTIONARY | ShapeFlags::IS_CLAIMED | ShapeFlags::HAS_ANY_ACCESSOR;
        let (count, capacity) = (shape.slot_count(), shape.inline_capacity());
        shape.instance_header() == Self::HEADER
            && !shape.has(unfit)
            && count != 0
            && count.next_multiple_of(WORDS_PER_ATOM) == capacity
            && JsFinalObject::allocation_size(capacity) <= EXACT_CUTOFF
    }

    /// # Safety
    /// It fits.
    #[inline(always)]
    pub(crate) unsafe fn new_unchecked(shape: ShapeId) -> SnugShape {
        SnugShape(shape)
    }

    /// # Safety
    /// The shape is alive, and has as many slots as there are values.
    #[inline(always)]
    pub(crate) unsafe fn try_create(self, vm: &Vm, values: &[Value]) -> Option<Gc<JsObject>> {
        let atoms = 1 + values.len().div_ceil(WORDS_PER_ATOM);
        // SAFETY: it fits.
        unsafe { core::hint::assert_unchecked(atoms <= EXACT_CUTOFF / ATOM_SIZE) };
        let address = vm.heap.cells.try_bump_atoms(atoms)?;
        let words = core::ptr::with_exposed_provenance_mut::<u64>(address);
        // SAFETY: a new cell of that size, each word of which is written.
        unsafe {
            words.write(u64::from(self.0.bits()) | u64::from(Self::HEADER) << 32);
            words.add(1).write(0);
            words.add(atoms * WORDS_PER_ATOM - 1).write(0);
            copy_words(values, words.add(2));
            Some(Gc::from_address(address))
        }
    }
}

impl JsArray {
    const MAX_SMALL_LENGTH: usize = EXACT_CUTOFF / size_of::<u64>() - 1;

    /// # Safety
    /// `kind` is dense and can represent the values. No collection runs.
    #[inline(always)]
    pub(crate) unsafe fn try_create_small(
        vm: &Vm,
        global: &GlobalObject,
        kind: ElementKind,
        values: &[Value],
    ) -> Option<Gc<JsArray>> {
        const { assert!(Storage::MIN_VECTOR_LENGTH == 3 && size_of::<JsArray>() == ATOM_SIZE) };
        if values.len().wrapping_sub(1) >= Self::MAX_SMALL_LENGTH {
            return None;
        }
        let atoms = (values.len() / WORDS_PER_ATOM + 1).max(2);
        let storage = Storage::from_base(vm.heap.auxiliary.try_bump_atoms(atoms)?, 0);
        let address = vm.heap.cells.try_bump_atoms(1)?;
        let (elements, room) = (storage.elements_ptr(), atoms * WORDS_PER_ATOM - 1);
        let words = core::ptr::with_exposed_provenance_mut::<u64>(address);
        // SAFETY: new and of these sizes. At most two elements are left for holes.
        unsafe {
            storage.set_lengths(values.len() as u32, room as u32);
            elements
                .add(room - 2)
                .cast::<[u64; 2]>()
                .write([kind.hole(); 2]);
            if kind == ElementKind::Double {
                for (index, value) in values.iter().enumerate() {
                    let number = value.as_number().unwrap_unchecked();
                    elements.add(index).write(number.to_bits());
                }
            } else {
                copy_words(values, elements);
            }
            words.write(JsCell::header_for(&global.array_shape(kind)));
            words.add(1).write(storage.address() as u64);
            Some(Gc::from_address(address))
        }
    }
}
