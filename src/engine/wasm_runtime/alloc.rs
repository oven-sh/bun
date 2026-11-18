//! Allocation that fails with an error, for what grows with the module.

use bun_engine_wasm_format::OutOfMemory;

pub(crate) fn try_boxed<T>(
    items: impl ExactSizeIterator<Item = T>,
) -> Result<Box<[T]>, OutOfMemory> {
    let mut vec = Vec::new();
    vec.try_reserve_exact(items.len())?;
    vec.extend(items);
    Ok(vec.into_boxed_slice())
}

pub(crate) fn try_defaults<T: Default>(count: usize) -> Result<Box<[T]>, OutOfMemory> {
    try_boxed((0..count).map(|_| T::default()))
}

pub(crate) fn try_push<T>(vec: &mut Vec<T>, item: T) -> Result<(), OutOfMemory> {
    vec.try_reserve(1)?;
    vec.push(item);
    Ok(())
}
