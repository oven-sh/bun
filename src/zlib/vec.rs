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

/// Over what is there from `at` on, which is not behind the end.
pub(crate) fn write_at(vec: &mut Vec<u8>, at: usize, bytes: &[u8]) {
    if let Some(room) = vec.get_mut(at..at + bytes.len()) {
        room.copy_from_slice(bytes);
    } else {
        vec.truncate(at);
        vec.extend_from_slice(bytes);
    }
}
