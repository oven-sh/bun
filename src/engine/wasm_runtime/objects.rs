//! Structs and arrays.

use core::mem::MaybeUninit;
use core::ptr;

use bun_engine_wasm_compiler::abi::object::{self, FIELDS, LENGTH, TYPE_NUMBER, WIDE_ELEMENTS};
use bun_engine_wasm_compiler::abi::{HostLayout, ObjectType, References, Trap};
use bun_engine_wasm_format::{AbstractHeapType, RefType, Rtt, StorageType, TypeIndex};

use crate::engine::Engine;
use crate::global::default_value;
use crate::host::Contents;
use crate::instance::Instance;
use crate::store::Store;
use crate::value::{Bits, HostCell, Reference};

const MAX_ARRAY_BYTES: u64 = 1 << 30;

/// # Safety
/// `place` is valid for a write of that size.
#[inline]
pub(crate) unsafe fn write(place: *mut u8, log2_size: u8, value: Bits) {
    // SAFETY: the caller's.
    unsafe { ptr::copy_nonoverlapping(value.to_le_bytes().as_ptr(), place, 1 << log2_size) };
}

/// With nothing but the header.
#[inline]
fn new_object(instance: &Instance, ty: TypeIndex, size: usize, rest: Contents) -> Option<HostCell> {
    let (host, vm) = instance.store().host();
    let object = host.allocate_object(vm, size, rest)?;
    // SAFETY: within the size.
    unsafe { object.field::<u64>(0).write(instance.object_header(ty)) };
    Some(object)
}

/// The fields are zero or null.
#[inline]
pub(crate) fn new_struct(instance: &Instance, ty: TypeIndex) -> Result<HostCell, Trap> {
    let rtt = instance.module().types().rtt(ty);
    let size = rtt.struct_size() as usize;
    let object = new_object(instance, ty, FIELDS as usize + size, Contents::Zeros);
    let object = object.ok_or(Trap::StructNewFailure)?;
    for &offset in rtt.reference_offsets() {
        // SAFETY: within the size, and aligned.
        unsafe { (object.field::<Reference>(FIELDS + offset as i32)).write(Reference::NULL) };
    }
    instance.engine().publish_fence();
    Ok(object)
}

/// The fields need values before the next cell is made.
#[inline]
pub(crate) fn new_bare_struct(instance: &Instance, ty: TypeIndex) -> Result<HostCell, Trap> {
    let size = instance.module().types().rtt(ty).struct_size() as usize;
    let object = new_object(instance, ty, FIELDS as usize + size, Contents::Any);
    object.ok_or(Trap::StructNewFailure)
}

/// # Safety
/// `object` is a struct or an array, and lives for `'a`.
#[inline]
unsafe fn rtt_of<'a>(layout: &HostLayout, object: HostCell) -> &'a Rtt {
    // SAFETY: the object keeps its type alive.
    unsafe {
        let number = object.field::<u32>(TYPE_NUMBER).read() as usize;
        let ty = ptr::with_exposed_provenance::<ObjectType>(layout.object_types + number);
        &*ptr::with_exposed_provenance((*ty).rtt())
    }
}

#[derive(Clone, Copy)]
pub(crate) struct Array<'a> {
    store: &'a Store,
    cell: HostCell,
    elements: *mut u8,
    length: u32,
    element: StorageType,
}

impl<'a> Array<'a> {
    /// # Safety
    /// After `initialize`, which makes no cells, all elements have values of their type.
    #[inline]
    unsafe fn new(
        instance: &'a Instance,
        ty: TypeIndex,
        length: u32,
        contents: Contents,
        initialize: impl FnOnce(Self),
    ) -> Option<Self> {
        let rtt = instance.module().types().rtt(ty);
        let element = rtt.element().expect("the type of an array").storage;
        let bytes = u64::from(length) << element.log2_size();
        if bytes > MAX_ARRAY_BYTES {
            return None;
        }
        let elements = object::elements(element);
        let cell = new_object(instance, ty, elements as usize + bytes as usize, contents)?;
        // SAFETY: within the size.
        unsafe { cell.field::<u32>(LENGTH).write(length) };
        let array = Self {
            store: instance.store(),
            cell,
            elements: cell.field(elements),
            length,
            element,
        };
        initialize(array);
        instance.engine().publish_fence();
        Some(array)
    }

    /// # Safety
    /// `value` has the type of the elements, unless these are all written before the array is used.
    #[inline]
    pub(crate) unsafe fn new_filled(
        instance: &'a Instance,
        ty: TypeIndex,
        length: u32,
        value: Bits,
    ) -> Option<Self> {
        // SAFETY: the whole array, and the caller's.
        unsafe {
            if value == 0 {
                return Self::new(instance, ty, length, Contents::Zeros, |_| {});
            }
            Self::new(instance, ty, length, Contents::Any, |array| {
                array.fill_without_barrier(0, value, length);
            })
        }
    }

    /// # Safety
    /// The elements are numbers, and there are as many bytes as they take.
    pub(crate) unsafe fn from_bytes(
        instance: &'a Instance,
        ty: TypeIndex,
        length: u32,
        bytes: &[u8],
    ) -> Option<Self> {
        // SAFETY: the caller's.
        unsafe {
            Self::new(instance, ty, length, Contents::Any, |array| {
                array.write_bytes(0, bytes);
            })
        }
    }

    /// # Safety
    /// `next` gives values of the type of the elements, and makes no cells.
    pub(crate) unsafe fn from_values(
        instance: &'a Instance,
        ty: TypeIndex,
        length: u32,
        mut next: impl FnMut() -> Bits,
    ) -> Option<Self> {
        // SAFETY: the whole array, and the caller's.
        unsafe {
            Self::new(instance, ty, length, Contents::Any, |array| {
                for index in 0..length {
                    write(array.address_of(index), array.element.log2_size(), next());
                }
            })
        }
    }

    /// With zeros or nulls.
    #[inline]
    pub(crate) fn new_default(instance: &'a Instance, ty: TypeIndex, length: u32) -> Option<Self> {
        let element = instance.module().types().array_type(ty).element.storage;
        // SAFETY: validation allows it where null is a value, and others overwrite it.
        unsafe { Self::new_filled(instance, ty, length, default_value(element.unpacked())) }
    }

    /// `None` for null.
    ///
    /// # Safety
    /// `reference` is null or an array, which lives for `'a`.
    #[inline]
    pub(crate) unsafe fn of(store: &'a Store, reference: Reference) -> Option<Self> {
        let (cell, layout) = (reference.cell()?, store.engine().layout());
        // SAFETY: the caller's.
        let (rtt, length) = unsafe { (rtt_of(layout, cell), cell.field::<u32>(LENGTH).read()) };
        let element = rtt.element().expect("the type of an array").storage;
        Some(Self {
            store,
            cell,
            elements: cell.field(object::elements(element)),
            length,
            element,
        })
    }

    #[inline]
    pub(crate) fn cell(&self) -> HostCell {
        self.cell
    }

    #[inline]
    pub(crate) fn has_range(&self, start: u32, count: u32) -> bool {
        u64::from(start) + u64::from(count) <= self.length.into()
    }

    /// In bytes, of so many elements.
    #[inline]
    pub(crate) fn size_of(&self, count: u32) -> u64 {
        u64::from(count) << self.element.log2_size()
    }

    #[inline]
    fn address_of(&self, index: u32) -> *mut u8 {
        self.elements.wrapping_add(self.size_of(index) as usize)
    }

    /// # Safety
    /// As for `fill`.
    #[inline]
    unsafe fn fill_without_barrier(&self, start: u32, value: Bits, count: u32) {
        /// # Safety
        /// `first` is valid for the writes, and nothing else accesses the memory meanwhile.
        unsafe fn repeat<const N: usize>(first: *mut u8, value: Bits, count: usize) {
            let bytes = MaybeUninit::new(*value.to_le_bytes().first_chunk::<N>().unwrap());
            // SAFETY: the caller's.
            unsafe { core::slice::from_raw_parts_mut(first.cast(), count) }.fill(bytes);
        }
        let (first, count) = (self.address_of(start), count as usize);
        // SAFETY: the caller's. The collector reads references only.
        unsafe {
            match self.element.log2_size() {
                0 => repeat::<1>(first, value, count),
                1 => repeat::<2>(first, value, count),
                2 => repeat::<4>(first, value, count),
                3 => self
                    .store
                    .engine()
                    .fill_words(first.cast(), [value as u64], count),
                _ => repeat::<16>(first, value, count),
            }
        }
    }

    /// # Safety
    /// The array has the range, and `value` has the type of the elements.
    #[inline]
    pub(crate) unsafe fn fill(&self, start: u32, value: Bits, count: u32) {
        // SAFETY: the caller's.
        unsafe { self.fill_without_barrier(start, value, count) };
        if self.element.is_ref() && Reference(value as u64).cell().is_some() {
            self.store.write_barrier(self.cell);
        }
    }

    /// # Safety
    /// Both have the range, and the type of the elements of `from` is a subtype of that of the elements of `self`.
    #[inline]
    pub(crate) unsafe fn copy_from(&self, from: Self, dst: u32, src: u32, count: u32) {
        let (dst, src) = (self.address_of(dst), from.address_of(src));
        if !self.element.is_ref() {
            // SAFETY: the caller's.
            return unsafe { ptr::copy(src, dst, self.size_of(count) as usize) };
        }
        let engine = self.store.engine();
        // SAFETY: the caller's.
        unsafe { engine.move_words(dst.cast(), src.cast(), count as usize) };
        self.store.write_barrier(self.cell);
    }

    /// # Safety
    /// The elements are numbers, and there are enough from `start` on.
    #[inline]
    pub(crate) unsafe fn write_bytes(&self, start: u32, bytes: &[u8]) {
        // SAFETY: the caller's.
        unsafe { ptr::copy_nonoverlapping(bytes.as_ptr(), self.address_of(start), bytes.len()) };
    }
}

/// Shows where the references are, on any thread: a field at a time, or all elements at once.
///
/// # Safety
/// `object` is a struct or an array of that type.
#[inline(always)]
pub unsafe fn find_references(
    object: HostCell,
    ty: &ObjectType,
    mut visit: impl FnMut(*const u64, usize),
) {
    match ty.references() {
        (References::InWords, mut words) => {
            while words != 0 {
                visit(object.field(FIELDS + words.trailing_zeros() as i32 * 8), 1);
                words &= words - 1;
            }
        }
        (References::AtOffsets, _) => {
            // SAFETY: whoever keeps the one keeps the other.
            let rtt = unsafe { &*ptr::with_exposed_provenance::<Rtt>(ty.rtt()) };
            for &offset in rtt.reference_offsets() {
                visit(object.field(FIELDS + offset as i32), 1);
            }
        }
        (References::InElements, _) => {
            // SAFETY: the caller's. It does not change.
            let length = unsafe { object.field::<u32>(LENGTH).read() };
            visit(object.field(WIDE_ELEMENTS), length as usize);
        }
    }
}

impl Engine {
    /// `None` unless it is a struct or an array.
    ///
    /// # Safety
    /// `value` is a value of the host that lives for `'a`.
    pub(crate) unsafe fn rtt_of_object<'a>(&self, value: Reference) -> Option<&'a Rtt> {
        let (cell, layout) = (value.cell()?, self.layout());
        // SAFETY: every cell has the byte.
        let kind = unsafe { cell.field::<u8>(layout.cell_kind).read() };
        let is_object = kind == layout.object_kind;
        // SAFETY: the kind tells.
        is_object.then(|| unsafe { rtt_of(layout, cell) })
    }

    /// For a type below `any`, with the `Rtt` if it is a defined one. `value` is internalized.
    ///
    /// # Safety
    /// `value` is a value of the host.
    pub unsafe fn has_type(
        &self,
        value: Reference,
        expected: RefType,
        defined: Option<&Rtt>,
    ) -> bool {
        if value.is_null() {
            return expected.is_nullable();
        }
        // SAFETY: the caller's.
        let object = unsafe { self.rtt_of_object(value) };
        if let Some(defined) = defined {
            return object.is_some_and(|rtt| rtt.is_subtype_of(defined));
        }
        let actual = match object {
            Some(rtt) => rtt.kind().abstract_type(),
            None if value.is_i31() => AbstractHeapType::I31,
            None => AbstractHeapType::Any,
        };
        actual.is_subtype_of(expected.heap_type().abstract_type())
    }
}
