use bun_engine_macros::native_abi;
use bun_engine_wasm_compiler::abi::Trap;
use bun_engine_wasm_format::{DataIndex, ElemIndex, TypeIndex};

use crate::instance::{Elements, Instance};
use crate::objects::{self, Array};
use crate::outcome::Outcome;
use crate::value::{Bits, Reference};

fn join(low: u64, high: u64) -> Bits {
    Bits::from(high) << 64 | Bits::from(low)
}

fn reference_to(array: Option<Array<'_>>, failure: Trap) -> Outcome {
    let reference = array.map(|array| array.cell().address() as u64);
    reference.ok_or(failure).into()
}

#[native_abi]
pub(crate) unsafe fn new_struct(instance: &Instance, ty: TypeIndex) -> Outcome {
    let object = objects::new_struct(instance, ty);
    object.map(|object| object.address() as u64).into()
}

#[native_abi]
pub(crate) unsafe fn new_array(
    instance: &Instance,
    ty: TypeIndex,
    low: u64,
    high: u64,
    length: u32,
) -> Outcome {
    // SAFETY: validated.
    let array = unsafe { Array::new_filled(instance, ty, length, join(low, high)) };
    reference_to(array, Trap::ArrayNewFailure)
}

#[native_abi]
pub(crate) unsafe fn new_default_array(instance: &Instance, ty: TypeIndex, length: u32) -> Outcome {
    let array = Array::new_default(instance, ty, length);
    reference_to(array, Trap::ArrayNewFailure)
}

#[native_abi]
pub(crate) unsafe fn new_array_from_data(
    instance: &Instance,
    ty: TypeIndex,
    data: DataIndex,
    src: u64,
    length: u32,
) -> Outcome {
    let element = instance.module().types().array_type(ty).element.storage;
    let bytes = instance.data(data, src, u64::from(length) << element.log2_size());
    // SAFETY: validation allows it for numbers.
    let array = bytes.and_then(|bytes| unsafe { Array::from_bytes(instance, ty, length, bytes) });
    reference_to(array, Trap::ArrayNewDataFailure)
}

/// # Safety
/// The array has the range, and the items have the type of its elements.
unsafe fn copy_elements(
    instance: &Instance,
    array: Array<'_>,
    dst: u32,
    elements: Elements<'_>,
    src: u32,
    count: u32,
) -> Result<(), Trap> {
    for index in 0..count {
        let value = instance.element(elements, src + index)?;
        // SAFETY: the caller's.
        unsafe { array.fill(dst + index, value.into(), 1) };
    }
    Ok(())
}

#[native_abi]
pub(crate) unsafe fn new_array_from_elements(
    instance: &Instance,
    ty: TypeIndex,
    elem: ElemIndex,
    src: u32,
    length: u32,
) -> Outcome {
    let elements = instance.elements(elem);
    if !elements.has_range(src.into(), length.into()) {
        return Outcome::failure(Trap::ArrayNewElemFailure);
    }
    let array = Array::new_default(instance, ty, length).filter(|&array| {
        // SAFETY: the whole array, and validated.
        unsafe { copy_elements(instance, array, 0, elements, src, length) }.is_ok()
    });
    reference_to(array, Trap::ArrayNewElemFailure)
}

#[native_abi]
pub(crate) unsafe fn fill_array(
    instance: &Instance,
    array: Reference,
    dst: u32,
    low: u64,
    high: u64,
    count: u32,
) -> Outcome {
    // SAFETY: validated.
    let Some(array) = (unsafe { Array::of(instance.store(), array) }) else {
        return Outcome::failure(Trap::NullReference);
    };
    if !array.has_range(dst, count) {
        return Outcome::failure(Trap::ArrayFillOutOfBounds);
    }
    // SAFETY: in bounds, and validated.
    unsafe { array.fill(dst, join(low, high), count) };
    Outcome::value(0)
}

#[native_abi]
pub(crate) unsafe fn copy_array(
    instance: &Instance,
    to: Reference,
    dst: u32,
    from: Reference,
    src: u32,
    count: u32,
) -> Outcome {
    let store = instance.store();
    // SAFETY: validated.
    let (Some(to), Some(from)) = (unsafe { (Array::of(store, to), Array::of(store, from)) }) else {
        return Outcome::failure(Trap::NullReference);
    };
    if !to.has_range(dst, count) || !from.has_range(src, count) {
        return Outcome::failure(Trap::ArrayCopyOutOfBounds);
    }
    // SAFETY: in bounds, and validated.
    unsafe { to.copy_from(from, dst, src, count) };
    Outcome::value(0)
}

#[native_abi]
pub(crate) unsafe fn init_array_from_data(
    instance: &Instance,
    data: DataIndex,
    array: Reference,
    dst: u32,
    src: u64,
    count: u32,
) -> Outcome {
    // SAFETY: validated.
    let Some(array) = (unsafe { Array::of(instance.store(), array) }) else {
        return Outcome::failure(Trap::NullArrayInitData);
    };
    match instance.data(data, src, array.size_of(count)) {
        Some(bytes) if array.has_range(dst, count) => {
            // SAFETY: in bounds. The elements are numbers.
            unsafe { array.write_bytes(dst, bytes) };
            Outcome::value(0)
        }
        _ => Outcome::failure(Trap::ArrayInitDataOutOfBounds),
    }
}

#[native_abi]
pub(crate) unsafe fn init_array_from_elements(
    instance: &Instance,
    elem: ElemIndex,
    array: Reference,
    dst: u32,
    src: u32,
    count: u32,
) -> Outcome {
    // SAFETY: validated.
    let Some(array) = (unsafe { Array::of(instance.store(), array) }) else {
        return Outcome::failure(Trap::NullArrayInitElem);
    };
    let elements = instance.elements(elem);
    if !array.has_range(dst, count) || !elements.has_range(src.into(), count.into()) {
        return Outcome::failure(Trap::ArrayInitElemOutOfBounds);
    }
    // SAFETY: in bounds, and validated.
    unsafe { copy_elements(instance, array, dst, elements, src, count) }.into()
}
