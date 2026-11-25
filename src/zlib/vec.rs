//! Allocations that may be refused.

use crate::error::{Error, Result};

/// With exactly that capacity.
pub(crate) fn with_room<T>(capacity: usize) -> Result<Vec<T>> {
    let mut vec = Vec::new();
    vec.try_reserve_exact(capacity)?;
    (vec.capacity() == capacity)
        .then_some(vec)
        .ok_or(Error::Internal)
}
