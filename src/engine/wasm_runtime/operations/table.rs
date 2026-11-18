use bun_engine_macros::native_abi;
use bun_engine_wasm_compiler::abi::Trap;
use bun_engine_wasm_format::{ElemIndex, TableIndex};

use super::minus_one;
use crate::instance::Instance;
use crate::outcome::Outcome;
use crate::value::Reference;

#[native_abi]
pub(crate) unsafe fn get(instance: &Instance, table: TableIndex, index: u64) -> Outcome {
    let reference = instance.table(table).get(index);
    reference.map(|reference| reference.0).into()
}

#[native_abi]
pub(crate) unsafe fn set(
    instance: &Instance,
    table: TableIndex,
    index: u64,
    value: Reference,
) -> Outcome {
    // SAFETY: validated.
    unsafe { instance.table(table).fill(index, value, 1) }.into()
}

#[native_abi]
pub(crate) unsafe fn grow(
    instance: &Instance,
    table: TableIndex,
    value: Reference,
    count: u64,
) -> Outcome {
    let table = instance.table(table);
    // SAFETY: validated.
    let old = unsafe { table.grow(count, value) };
    Outcome::value(old.map_or_else(|| minus_one(table.ty().address), u64::from))
}

#[native_abi]
pub(crate) unsafe fn fill(
    instance: &Instance,
    table: TableIndex,
    dst: u64,
    value: Reference,
    count: u64,
) -> Outcome {
    // SAFETY: validated.
    unsafe { instance.table(table).fill(dst, value, count) }.into()
}

#[native_abi]
pub(crate) unsafe fn copy(
    instance: &Instance,
    dst_table: TableIndex,
    src_table: TableIndex,
    dst: u64,
    src: u64,
    count: u64,
) -> Outcome {
    let (to, from) = (instance.table(dst_table), instance.table(src_table));
    // SAFETY: validated.
    unsafe { to.copy_from(from, dst, src, count) }.into()
}

#[native_abi]
pub(crate) unsafe fn init(
    instance: &Instance,
    table: TableIndex,
    elem: ElemIndex,
    dst: u64,
    src: u64,
    count: u64,
) -> Outcome {
    let (table, elements) = (instance.table(table), instance.elements(elem));
    match table.check_range(dst, count) {
        Ok((dst, count)) if elements.has_range(src, count.into()) => {
            // SAFETY: in bounds, and validated.
            unsafe { instance.copy_elements(table, dst, elements, src as u32, count) }.into()
        }
        _ => Outcome::failure(Trap::TableOutOfBounds),
    }
}

#[native_abi]
pub(crate) unsafe fn drop_elements(instance: &Instance, elem: ElemIndex) {
    instance.drop_elements(elem);
}
