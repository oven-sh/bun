//! How much there is to allocate is up to a stream or a caller, so a refusal is an error.

pub(crate) use bun_alloc::AllocError;
pub(crate) use bun_core::ffi::Zeroable;
pub(crate) use bun_core::vec::try_zeroed as zeroed;

use bun_core::vec::BorrowedCursor;

pub(crate) type Result<T> = core::result::Result<T, AllocError>;

pub(crate) fn try_reserve<T>(vec: &mut Vec<T>, additional: usize) -> Result<()> {
    if additional > vec.capacity() - vec.len() {
        try_reserve_total(vec, (vec.len() + additional).max(2 * vec.capacity()))?;
    }
    Ok(())
}

pub(crate) fn try_reserve_total<T>(vec: &mut Vec<T>, capacity: usize) -> Result<()> {
    if capacity > vec.capacity() {
        // Reallocating would copy the unused part, too.
        let mut grown = empty(capacity)?;
        grown.append(vec);
        *vec = grown;
    }
    Ok(())
}

pub(crate) fn empty<T>(capacity: usize) -> Result<Vec<T>> {
    let mut vec = Vec::new();
    vec.try_reserve_exact(capacity).map_err(|_| AllocError)?;
    Ok(vec)
}

pub(crate) fn filled<T: Clone>(value: T, len: usize) -> Result<Vec<T>> {
    let mut vec = empty(len)?;
    vec.resize(len, value);
    Ok(vec)
}

pub(crate) fn collected<T>(items: impl ExactSizeIterator<Item = T>) -> Result<Vec<T>> {
    let mut vec = empty(items.len())?;
    vec.extend(items);
    Ok(vec)
}

pub(crate) fn copied<T: Copy>(items: &[T]) -> Result<Vec<T>> {
    let mut vec = empty(items.len())?;
    vec.extend_from_slice(items);
    Ok(vec)
}

pub(crate) fn zeroed_array<T: Zeroable, const N: usize>() -> Result<Box<[T; N]>> {
    zeroed(N)?.try_into().map_err(|_| AllocError)
}

pub(crate) fn filled_array<T: Clone, const N: usize>(value: T) -> Result<Box<[T; N]>> {
    filled(value, N)?.try_into().map_err(|_| AllocError)
}

/// Returns how many of `bytes` that is.
pub(crate) fn append_what_fits(output: &mut BorrowedCursor<'_, u8>, bytes: &[u8]) -> usize {
    let (fits, _) = bytes.split_at(bytes.len().min(output.capacity()));
    output.append(fits);
    fits.len()
}
