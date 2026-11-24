//! `unicode/uloc.h`

use super::before_nul;
use crate::capi::ffi::{Dest, Pair, Parameter};
use crate::common::slice_ext::to_length;

/// `char *buffer, int32_t bufferCapacity`: a `Dest` that holds a string, which ends at a NUL or at the capacity.
pub(crate) struct IdBuffer<'c>(Dest<'c, u8>);

impl Parameter for IdBuffer<'_> {}

impl Pair for IdBuffer<'_> {
    type First = *mut u8;
    type Second = i32;
    unsafe fn new(buffer: *mut u8, capacity: i32) -> Self {
        // SAFETY: the contract of `IdBuffer` includes that of `Dest`.
        Self(unsafe { Dest::new(buffer, capacity) })
    }
}

impl<'c> IdBuffer<'c> {
    pub(crate) fn into_dest(self) -> Dest<'c, u8> {
        self.0
    }

    /// Returns `None` for null.
    pub(crate) fn text(&self) -> Option<&[u8]> {
        let Dest { ptr, capacity, .. } = self.0;
        // SAFETY: the string ends at a NUL or at the capacity, and `&self` excludes writes.
        (!ptr.is_null()).then(|| unsafe { before_nul(ptr, to_length(capacity)) })
    }
}
