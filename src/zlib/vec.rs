//! Allocations that may be refused.

use bun_core::vec::{BorrowedBuf, BorrowedCursor, append_with};

use crate::error::{Error, Result};

/// With exactly that capacity.
pub(crate) fn with_room<T>(capacity: usize) -> Result<Vec<T>> {
    let mut vec = Vec::new();
    vec.try_reserve_exact(capacity)?;
    (vec.capacity() == capacity)
        .then_some(vec)
        .ok_or(Error::Internal)
}

/// Over what is there from `at` on, which is not behind the end. The capacity suffices.
pub(crate) fn write_at(vec: &mut Vec<u8>, at: usize, bytes: &[u8]) {
    write_with(vec, at, bytes.len(), |mut room| room.append(bytes));
}

/// The same for the `len` bytes that `write` fills its argument with.
#[inline]
pub(crate) fn write_with(
    vec: &mut Vec<u8>,
    at: usize,
    len: usize,
    write: impl FnOnce(BorrowedCursor<'_, u8>),
) {
    if let Some(room) = vec.get_mut(at..at + len) {
        write(BorrowedBuf::from(room).unfilled());
    } else {
        vec.truncate(at);
        debug_assert!(at + len <= vec.capacity());
        append_with(vec, len, write);
    }
}
