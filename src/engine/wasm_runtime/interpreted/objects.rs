//! Structs, arrays and the types of references.

use core::cell::Cell;
use core::num::NonZeroUsize;
use core::ptr;

use bun_engine_wasm_compiler::abi::object::{self, FIELDS, LENGTH, TYPE_NUMBER, WIDE_ELEMENTS};
use bun_engine_wasm_compiler::abi::{NULL, Trap};
use bun_engine_wasm_format::{
    AbstractHeapType, DataIndex, ElemIndex, RefType, Rtt, StorageType, TypeIndex, TypeKind,
};

use super::Context;
use crate::objects::{self, Array};
use crate::operations::object as operations;
use crate::outcome::Failure;
use crate::value::{Bits, HostCell, Reference};
use crate::words;

/// Why there is no such element.
#[derive(Clone, Copy)]
pub enum Missing {
    Array,
    Element,
}

/// Of a reference to a struct or an array.
#[inline(always)]
fn object(reference: u64) -> Option<HostCell> {
    NonZeroUsize::new(reference as usize)
        .filter(|_| reference != NULL as u64)
        .map(HostCell)
}

#[inline(always)]
fn place_of_element<const SIZE: usize>(
    context: &Context<'_>,
    array: u64,
    index: u32,
) -> Result<*mut u8, Missing> {
    let array = object(array).ok_or(Missing::Array)?;
    let first = if SIZE <= 4 { LENGTH + 4 } else { WIDE_ELEMENTS };
    assert_array(context, array, Some((SIZE, first)));
    // SAFETY: an array of the module, which keeps its length there.
    if index >= unsafe { array.field::<u32>(LENGTH).read() } {
        return Err(Missing::Element);
    }
    Ok(array.field::<u8>(first).wrapping_add(index as usize * SIZE))
}

/// What the translation of a module has to have got right: the value is a reference to a struct or an array of this
/// module, not a number, a function or anything else that a slot can hold, and the bytes that the instruction reaches
/// are inside it. Assertions turn a mistake into a panic where they are on. `None` where they are off.
#[inline(always)]
fn type_of<'a>(context: &Context<'a>, object: HostCell) -> Option<&'a Rtt> {
    if !cfg!(debug_assertions) {
        return None;
    }
    let engine = context.instance.engine();
    // SAFETY: a value of a frame, which keeps it alive.
    let rtt = unsafe { engine.rtt_of_object(Reference(object.address() as u64)) };
    Some(rtt.expect("a reference to no object of a module"))
}

/// With the bytes that the instruction reads or writes from the start of the object.
#[inline(always)]
fn assert_struct(context: &Context<'_>, object: HostCell, offset: u32, size: usize) {
    let Some(rtt) = type_of(context, object) else {
        return;
    };
    assert!(
        rtt.kind() == TypeKind::Struct,
        "an array where a struct was"
    );
    let end = offset as usize + size;
    assert!(
        end <= FIELDS as usize + rtt.struct_size() as usize,
        "{size} bytes at {offset} are outside the struct"
    );
}

/// With the size of an element and where the first one is, for an instruction that reaches one.
#[inline(always)]
fn assert_array(context: &Context<'_>, object: HostCell, element: Option<(usize, i32)>) {
    let Some(rtt) = type_of(context, object) else {
        return;
    };
    assert!(rtt.kind() == TypeKind::Array, "a struct where an array was");
    let Some((size, first)) = element else {
        return;
    };
    let ty = rtt.element().expect("an array has one").storage;
    assert!(
        ty.size_in_bytes() as usize == size && object::elements(ty) == first,
        "elements of {} bytes read as {size} bytes",
        ty.size_in_bytes()
    );
}

/// Takes the slots of a value.
#[inline]
fn take_value<'a>(ty: StorageType, slots: &mut impl Iterator<Item = &'a Cell<u64>>) -> Bits {
    let mut word = || Bits::from(slots.next().expect("a slot for each word").get());
    match ty.size_in_bytes() {
        16 => word() | word() << 64,
        _ => word(),
    }
}

impl Context<'_> {
    /// With the offset from the start of the struct. It is written through this only if it is no reference. `None`
    /// for null.
    #[inline(always)]
    pub fn field<const SIZE: usize>(
        &self,
        reference: u64,
        offset: u32,
    ) -> Option<&Cell<[u8; SIZE]>> {
        let object = object(reference)?;
        assert_struct(self, object, offset, SIZE);
        // SAFETY: validated, and other threads read only references.
        Some(unsafe { &*object.field(offset as i32) })
    }

    #[inline(always)]
    pub fn set_reference_in_field(&self, reference: u64, offset: u32, value: u64) -> Option<()> {
        let object = object(reference)?;
        assert_struct(self, object, offset, size_of::<u64>());
        // SAFETY: validated.
        unsafe { words::store(object.field(offset as i32), value) };
        self.did_store(object, value);
        Some(())
    }

    /// As for a field.
    #[inline(always)]
    pub fn array_element<const SIZE: usize>(
        &self,
        array: u64,
        index: u32,
    ) -> Result<&Cell<[u8; SIZE]>, Missing> {
        // SAFETY: in bounds, and as above.
        place_of_element::<SIZE>(self, array, index).map(|place| unsafe { &*place.cast() })
    }

    #[inline(always)]
    pub fn set_reference_in_array(
        &self,
        array: u64,
        index: u32,
        value: u64,
    ) -> Result<(), Missing> {
        let place = place_of_element::<8>(self, array, index)?;
        // SAFETY: in bounds.
        unsafe { words::store(place.cast(), value) };
        self.did_store(object(array).ok_or(Missing::Array)?, value);
        Ok(())
    }

    #[inline(always)]
    pub fn array_len(&self, array: u64) -> Option<u32> {
        // SAFETY: validated.
        let array = object(array)?;
        assert_array(self, array, None);
        // SAFETY: every array has its length there.
        Some(unsafe { array.field::<u32>(LENGTH).read() })
    }

    #[inline]
    pub fn struct_new(&self, ty: TypeIndex, values: &[Cell<u64>]) -> Result<u64, Failure> {
        let (fields, mut values) = (self.module().types().struct_type(ty).fields, values.iter());
        let object = objects::new_bare_struct(self.instance, ty)?;
        for field in fields {
            let (place, ty) = (object.field(FIELDS + field.offset as i32), field.ty.storage);
            // SAFETY: the object has the field, and the operand its type.
            unsafe { objects::write(place, ty.log2_size(), take_value(ty, &mut values)) };
        }
        self.instance.engine().publish_fence();
        Ok(object.address() as u64)
    }

    pub fn struct_new_default(&self, ty: TypeIndex) -> Result<u64, Failure> {
        Ok(objects::new_struct(self.instance, ty)?.address() as u64)
    }

    pub fn array_new(&self, ty: TypeIndex, value: Bits, length: u32) -> Result<u64, Failure> {
        let (low, high) = (value as u64, (value >> 64) as u64);
        // SAFETY: validated, as in all that follow.
        unsafe { operations::new_array(self.instance, ty, low, high, length) }.into_result()
    }

    pub fn array_new_default(&self, ty: TypeIndex, length: u32) -> Result<u64, Failure> {
        // SAFETY: as above.
        unsafe { operations::new_default_array(self.instance, ty, length) }.into_result()
    }

    pub fn array_new_fixed(
        &self,
        ty: TypeIndex,
        length: u32,
        values: &[Cell<u64>],
    ) -> Result<u64, Failure> {
        let element = self.module().types().array_type(ty).element.storage;
        let mut values = values.iter();
        // SAFETY: a value of the type of the elements for each.
        let array = unsafe {
            Array::from_values(self.instance, ty, length, || {
                take_value(element, &mut values)
            })
        };
        Ok(array.ok_or(Trap::ArrayNewFailure)?.cell().address() as u64)
    }

    pub fn array_new_data(
        &self,
        ty: TypeIndex,
        data: DataIndex,
        [src, length]: [u64; 2],
    ) -> Result<u64, Failure> {
        // SAFETY: as above.
        unsafe { operations::new_array_from_data(self.instance, ty, data, src, length as u32) }
            .into_result()
    }

    pub fn array_new_elem(
        &self,
        ty: TypeIndex,
        elem: ElemIndex,
        [src, length]: [u64; 2],
    ) -> Result<u64, Failure> {
        let (src, length) = (src as u32, length as u32);
        // SAFETY: as above.
        unsafe { operations::new_array_from_elements(self.instance, ty, elem, src, length) }
            .into_result()
    }

    pub fn array_fill(
        &self,
        array: u64,
        dst: u32,
        value: Bits,
        count: u32,
    ) -> Result<u64, Failure> {
        let (array, low, high) = (Reference(array), value as u64, (value >> 64) as u64);
        // SAFETY: as above.
        unsafe { operations::fill_array(self.instance, array, dst, low, high, count) }.into_result()
    }

    pub fn array_copy(&self, [to, dst, from, src, count]: [u64; 5]) -> Result<u64, Failure> {
        let (to, from) = (Reference(to), Reference(from));
        let [dst, src, count] = [dst, src, count].map(|it| it as u32);
        // SAFETY: as above.
        unsafe { operations::copy_array(self.instance, to, dst, from, src, count) }.into_result()
    }

    pub fn array_init_data(&self, data: DataIndex, operands: [u64; 4]) -> Result<u64, Failure> {
        let [array, dst, src, count] = operands;
        let (array, dst, count) = (Reference(array), dst as u32, count as u32);
        // SAFETY: as above.
        unsafe { operations::init_array_from_data(self.instance, data, array, dst, src, count) }
            .into_result()
    }

    pub fn array_init_elem(&self, elem: ElemIndex, operands: [u64; 4]) -> Result<u64, Failure> {
        let (array, [_, dst, src, count]) = (Reference(operands[0]), operands.map(|it| it as u32));
        // SAFETY: as above.
        unsafe { operations::init_array_from_elements(self.instance, elem, array, dst, src, count) }
            .into_result()
    }

    /// For a value of the same hierarchy.
    #[inline]
    pub fn has_type(&self, value: u64, expected: RefType) -> bool {
        let (engine, value, heap_type) = (
            self.instance.engine(),
            Reference(value),
            expected.heap_type(),
        );
        let defined = heap_type.index().map(|it| self.module().types().rtt(it));
        let kind = heap_type.abstract_type();
        if kind.top() == AbstractHeapType::Any {
            // SAFETY: validated.
            return unsafe { engine.has_type(value, expected, defined) };
        }
        match (value.cell(), defined) {
            _ if value.is_null() => expected.is_nullable(),
            // SAFETY: a function, whose instance keeps its type.
            (Some(function), Some(defined)) => unsafe {
                let actual = engine.callable_of(function).rtt;
                (*ptr::with_exposed_provenance::<Rtt>(actual)).is_subtype_of(defined)
            },
            _ => kind == kind.top(),
        }
    }

    /// For a value below `any`, with the offset of the header for objects of a type. If not, it can have a subtype.
    #[inline(always)]
    pub fn has_exact_type(&self, value: u64, header: u32) -> bool {
        self.assert_inside(header + TYPE_NUMBER as u32, size_of::<u32>());
        Reference(value).cell().is_some_and(|cell| {
            // SAFETY: every cell starts with such a number, and the offset is from the layout.
            unsafe {
                let expected = self.cell.field::<u32>(header as i32 + TYPE_NUMBER).read();
                cell.field::<u32>(TYPE_NUMBER).read() == expected
            }
        })
    }
}
