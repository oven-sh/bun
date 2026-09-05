//! A native struct exposed to JS as an `ArrayBuffer` over its own bytes —
//! Bun's analog of node's `AliasedStruct` / `AliasedBuffer`. JS reads and
//! writes the raw bytes through a `DataView`/typed array; native code reads
//! and writes the same memory through the struct's `Cell` fields.

use core::cell::Cell;
use core::ffi::c_void;
use std::sync::Arc;

use crate::{JSGlobalObject, JSValue, JsResult};

/// A `#[repr(C)]` block of integer `Cell`s that stays valid whatever bytes JS
/// stores into it. Implemented by [`aliased_struct!`](crate::aliased_struct)
/// and for `[Cell<u64>; N]`.
///
/// # Safety
/// `Self` is `#[repr(C)]`, all-zero bytes are a valid `Self`, and every field
/// is a `Cell` of a primitive integer, so any byte pattern written from JS
/// (on the owning thread — [`AliasedStruct`] pins its buffers there) leaves a
/// valid `Self` and native access never assumes the bytes unchanged.
pub unsafe trait AliasedCells: Sized + 'static {}

// SAFETY: an array of integer cells; see the trait contract.
unsafe impl<const N: usize> AliasedCells for [Cell<u64>; N] {}

/// Declare a `#[repr(C)]` struct of integer `Cell` fields that implements
/// [`AliasedCells`]. Field types are limited to primitive integers.
#[macro_export]
macro_rules! aliased_struct {
    (
        $(#[$meta:meta])*
        $vis:vis struct $Name:ident {
            $($(#[$fmeta:meta])* $fvis:vis $field:ident : $ty:ident),* $(,)?
        }
    ) => {
        $(#[$meta])*
        #[repr(C)]
        $vis struct $Name {
            $($(#[$fmeta])* $fvis $field: ::core::cell::Cell<::core::primitive::$ty>,)*
        }
        $($crate::aliased_struct!(@integer $ty);)*
        // SAFETY: `#[repr(C)]`, every field a `Cell` of a primitive integer
        // (checked above), so all-zero and every other byte pattern is valid.
        unsafe impl $crate::AliasedCells for $Name {}
    };
    (@integer u8) => {};
    (@integer u16) => {};
    (@integer u32) => {};
    (@integer u64) => {};
    (@integer i8) => {};
    (@integer i16) => {};
    (@integer i32) => {};
    (@integer i64) => {};
}

/// Shared ownership of a zero-initialised `T` whose bytes JS may alias; see
/// the module doc. The allocation lives until both this handle (and its
/// clones) and every `ArrayBuffer` made from it are gone.
pub struct AliasedStruct<T: AliasedCells> {
    inner: Arc<T>,
}

impl<T: AliasedCells> AliasedStruct<T> {
    pub fn zeroed() -> Self {
        let mut uninit = Arc::<T>::new_uninit();
        let slot = Arc::get_mut(&mut uninit).expect("fresh Arc is unique");
        // SAFETY: `AliasedCells` — all-zero bytes are a valid `T`.
        let inner = unsafe {
            core::ptr::write_bytes(slot.as_mut_ptr(), 0, 1);
            uninit.assume_init()
        };
        AliasedStruct { inner }
    }

    /// A new `ArrayBuffer` over this struct's bytes. It keeps the allocation
    /// alive on its own, so it may outlive `self`. The buffer is pinned: JS
    /// cannot detach or transfer it, so the bytes stay on this thread and
    /// aliased for its whole life.
    pub fn to_array_buffer(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        unsafe extern "C" fn release<T>(_bytes: *mut c_void, ctx: *mut c_void) {
            // SAFETY: `ctx` is the `Arc::into_raw` below, released once here.
            drop(unsafe { Arc::from_raw(ctx.cast::<T>().cast_const()) });
        }
        let keep = Arc::into_raw(Arc::clone(&self.inner));
        // SAFETY: the buffer aliases `size_of::<T>()` bytes of the `Arc`
        // allocation that `keep` holds until `release` runs (JSC runs it on
        // every path, including failure); `AliasedCells` makes JS writes
        // through it sound.
        let buffer = unsafe {
            crate::array_buffer::make_array_buffer_with_bytes_no_copy(
                global,
                keep.cast_mut().cast(),
                core::mem::size_of::<T>(),
                Some(release::<T>),
                keep.cast_mut().cast(),
            )
        }?;
        let pinned = buffer.pin_array_buffer();
        debug_assert!(pinned);
        Ok(buffer)
    }
}

impl<T: AliasedCells> Clone for AliasedStruct<T> {
    fn clone(&self) -> Self {
        AliasedStruct {
            inner: Arc::clone(&self.inner),
        }
    }
}

impl<T: AliasedCells> Default for AliasedStruct<T> {
    fn default() -> Self {
        Self::zeroed()
    }
}

impl<T: AliasedCells> core::ops::Deref for AliasedStruct<T> {
    type Target = T;
    fn deref(&self) -> &T {
        &self.inner
    }
}
