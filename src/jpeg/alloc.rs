//! `Box` and `Vec` that report a failed allocation instead of aborting.

use crate::error::Result;

/// `Box::new(value)`
pub(crate) fn try_box<T>(value: T) -> Result<Box<T>> {
    Box::try_new(value).map_err(|_| bun_alloc::AllocError.into())
}

pub(crate) fn try_vec_with_capacity<T>(capacity: usize) -> Result<Vec<T>> {
    let mut vec = Vec::new();
    vec.try_reserve_exact(capacity)?;
    Ok(vec)
}

/// `vec![value; len]`
pub(crate) fn try_vec<T: Clone>(value: T, len: usize) -> Result<Vec<T>> {
    let mut vec = try_vec_with_capacity(len)?;
    vec.resize(len, value);
    Ok(vec)
}

/// `items.collect()`
pub(crate) fn try_collect<T>(items: impl ExactSizeIterator<Item = T>) -> Result<Vec<T>> {
    let mut vec = try_vec_with_capacity(items.len())?;
    vec.extend(items);
    Ok(vec)
}
