//! Typed side of the `NativePromiseContext` JSCell
//! (src/jsc/bindings/NativePromiseContext.h): a GC cell that owns one ref on
//! an intrusively refcounted native object while a promise reaction that needs
//! it is pending. If the promise settles, the reaction [`take`]s the ref back;
//! if it is collected unsettled, the cell's destructor releases it (through
//! `Bun__NativePromiseContext__destroy`, which the runtime dispatches on the
//! tag).

use core::ffi::c_void;

use bun_ptr::{AnyRefCounted, RefPtr};

use crate::{JSGlobalObject, JSValue};

/// A tag no cell carries: for type-level combinations that are never
/// instantiated. [`create`] refuses it.
pub const INVALID_TAG: u8 = u8::MAX;

/// A native type a `NativePromiseContext` cell can hold a ref on.
///
/// # Safety
/// `TAG` is the `Bun::NativePromiseContext::Tag` value whose destructor arm
/// releases a ref on a `Self`, no other type maps to it (or it is
/// [`INVALID_TAG`]), and cells carrying it are only made by [`create`].
/// Implement through [`native_promise_context_type!`], next to the destructor
/// dispatch that defines the mapping.
pub unsafe trait NativePromiseContextType: AnyRefCounted {
    const TAG: u8;
}

/// `unsafe impl NativePromiseContextType`; see the trait for the obligation.
#[macro_export]
macro_rules! native_promise_context_type {
    (impl $([$($generics:tt)*])? for $ty:ty => $tag:expr) => {
        unsafe impl $(<$($generics)*>)? $crate::native_promise_context::NativePromiseContextType
            for $ty
        {
            const TAG: u8 = $tag;
        }
    };
}

// `ctx` is stored opaquely by the C++ side; `&JSGlobalObject` is ABI-identical
// to a non-null pointer.
unsafe extern "C" {
    safe fn Bun__NativePromiseContext__create(
        global: &JSGlobalObject,
        ctx: *mut c_void,
        tag: u8,
        held: JSValue,
    ) -> JSValue;
    safe fn Bun__NativePromiseContext__take(value: JSValue, tag: u8) -> *mut c_void;
}

/// A new cell owning `ctx`'s ref. `held` is visited by the cell, so whatever
/// GC object keeps the native object reachable can ride along for as long as
/// the promise can settle; pass `JSValue::ZERO` when nothing needs rooting.
pub fn create<T: NativePromiseContextType>(
    global: &JSGlobalObject,
    ctx: RefPtr<T>,
    held: JSValue,
) -> JSValue {
    assert_ne!(T::TAG, INVALID_TAG, "NativePromiseContext: type has no tag");
    Bun__NativePromiseContext__create(global, ctx.into_raw().cast::<c_void>(), T::TAG, held)
}

/// The ref `cell` was created with, leaving the cell empty so its destructor
/// is a no-op. `None` if it was already taken (or released by a termination
/// path), or if `cell` is not a `NativePromiseContext` holding a `T`.
pub fn take<T: NativePromiseContextType>(cell: JSValue) -> Option<RefPtr<T>> {
    if cell.is_empty() || T::TAG == INVALID_TAG {
        return None;
    }
    let ptr = Bun__NativePromiseContext__take(cell, T::TAG);
    if ptr.is_null() {
        return None;
    }
    // SAFETY: a cell tagged `T::TAG` was made by `create::<T>` from
    // `RefPtr::<T>::into_raw` (trait contract: the tag names `T` alone), and
    // the C++ side nulled its slot, so that ref is handed back exactly once.
    Some(unsafe { RefPtr::from_raw(ptr.cast::<T>()) })
}

/// For the destructor dispatch: the ref a collected, never-taken cell owned.
///
/// # Safety
/// `ctx` and `tag` are the pair `Bun__NativePromiseContext__destroy` received,
/// with `tag == T::TAG`, and this is the only release of that ref.
pub unsafe fn destroyed_ref<T: NativePromiseContextType>(ctx: *mut c_void) -> RefPtr<T> {
    // SAFETY: caller contract — as for `take`.
    unsafe { RefPtr::from_raw(ctx.cast::<T>()) }
}
