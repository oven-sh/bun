//! Allocations that may be refused.

use crate::error::{Error, Result};

pub(crate) fn filled<T: Clone>(value: T, len: usize) -> Result<Vec<T>> {
    let mut vec = with_room(len)?;
    vec.resize(len, value);
    Ok(vec)
}

pub(crate) fn array<T: Clone, const N: usize>(value: T) -> Result<Box<[T; N]>> {
    boxed(filled(value, N)?)
}

// Out of line, so that the value it is filled with does not stay on the caller's stack.
#[inline(never)]
pub(crate) fn default_array<T: Default, const N: usize>() -> Result<Box<[T; N]>> {
    let mut vec = with_room(N)?;
    vec.resize_with(N, T::default);
    boxed(vec)
}

pub(crate) fn boxed<T, const N: usize>(vec: Vec<T>) -> Result<Box<[T; N]>> {
    // Room to spare would be given back, which aborts if it is refused.
    debug_assert_eq!(vec.capacity(), N);
    vec.try_into().map_err(|_| Error::Internal)
}

pub(crate) fn with_room<T>(capacity: usize) -> Result<Vec<T>> {
    let mut vec = Vec::new();
    vec.try_reserve_exact(capacity)?;
    Ok(vec)
}

pub(crate) fn copied<T: Copy>(from: &[T]) -> Result<Vec<T>> {
    let mut vec = with_room(from.len())?;
    vec.extend_from_slice(from);
    Ok(vec)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_array_is_full() {
        assert_eq!(filled(7, 1).and_then(boxed).as_deref(), Ok(&[7]));
        assert_eq!(with_room(1).and_then(boxed::<u8, 1>), Err(Error::Internal));
    }
}
