//! Bridge between `core::alloc::Allocator` and the `allocator_api2` polyfill
//! trait that `hashbrown::HashMap<_, _, _, A>` is bounded on.
//!
//! The obvious route — enable `hashbrown/nightly` so its `A` bound is the real
//! `core::alloc::Allocator` — is closed: that feature also turns on
//! `min_specialization` and specialises `RawTableClone` on `T: Copy`, which
//! the workspace's pinned nightly rejects ("cannot specialize on trait
//! `Copy`"). Enabling `allocator-api2/nightly` instead is also closed — it
//! re-exports the real trait, but hashbrown then names
//! `core::alloc::Allocator` from a crate that lacks
//! `#![feature(allocator_api)]`.
//!
//! So `hashbrown` is built against the polyfill trait, and any allocator we
//! want to plug into a `hashbrown::HashMap` must implement *both* traits:
//! `core::alloc::Allocator` (for `Box<[u8], A>` keys / `Vec<_, A>` etc.) and
//! `allocator_api2::alloc::Allocator` (for the table itself). The two traits
//! have identical method signatures modulo the `AllocError` type, so the
//! macro below delegates one to the other. Only `allocate`/`deallocate` are
//! provided — hashbrown never calls `grow`/`shrink`/`allocate_zeroed` (it
//! reallocates by alloc-new + move + dealloc-old; see `raw/mod.rs`
//! `RawTableInner::resize_inner`), and the polyfill's defaulted
//! `allocate_zeroed` correctly forwards to our `allocate`.

use core::alloc::{Allocator, Layout};
use core::ptr::NonNull;

/// Implement `allocator_api2::alloc::Allocator` for a type that already
/// implements `core::alloc::Allocator`, by delegation. Only the two methods
/// hashbrown actually calls are forwarded; the rest keep the polyfill's
/// default bodies (which themselves call back into `allocate`/`deallocate`).
macro_rules! bridge_allocator_api2 {
    ($t:ty) => {
        // SAFETY: every method is a 1:1 forward to the corresponding
        // `core::alloc::Allocator` method on the same `self` / arguments, so
        // the polyfill trait's safety contract (memory blocks are valid for
        // the returned size, `deallocate` is only called on blocks `allocate`
        // returned, etc.) is exactly the contract the underlying impl already
        // upholds.
        unsafe impl ::allocator_api2::alloc::Allocator for $t {
            #[inline]
            fn allocate(
                &self,
                layout: ::core::alloc::Layout,
            ) -> ::core::result::Result<
                ::core::ptr::NonNull<[u8]>,
                ::allocator_api2::alloc::AllocError,
            > {
                ::core::alloc::Allocator::allocate(self, layout)
                    .map_err(|_| ::allocator_api2::alloc::AllocError)
            }

            #[inline]
            unsafe fn deallocate(
                &self,
                ptr: ::core::ptr::NonNull<u8>,
                layout: ::core::alloc::Layout,
            ) {
                // SAFETY: `ptr`/`layout` were returned by `allocate` above on
                // this same allocator (per the polyfill trait's caller
                // contract), which is exactly the precondition the underlying
                // `core::alloc::Allocator::deallocate` requires.
                unsafe { ::core::alloc::Allocator::deallocate(self, ptr, layout) }
            }
        }
    };
}

// `crate::DefaultAlloc` is the existing ZST marker for `bun.default_allocator`
// (Zig); here it gains `core::alloc::Allocator` (forwarding to
// `std::alloc::Global`, since `#[global_allocator] = Mimalloc` makes that the
// process default) plus the api2 bridge, so a single `A` type can back both a
// `hashbrown::HashMap<_, _, _, A>` table and its `Box<[u8], A>` keys.
// `std::alloc::Global` can't be used directly: orphan rules forbid us
// implementing the polyfill trait on it, and `allocator_api2::alloc::Global`
// doesn't implement `core::alloc::Allocator`.
use crate::DefaultAlloc;

// SAFETY: thin forwarder to `std::alloc::Global`, which upholds the
// `Allocator` contract; every method delegates to the corresponding `Global`
// method on the same arguments and returns the result unchanged.
unsafe impl Allocator for DefaultAlloc {
    #[inline]
    fn allocate(&self, layout: Layout) -> Result<NonNull<[u8]>, core::alloc::AllocError> {
        std::alloc::Global.allocate(layout)
    }
    #[inline]
    fn allocate_zeroed(&self, layout: Layout) -> Result<NonNull<[u8]>, core::alloc::AllocError> {
        std::alloc::Global.allocate_zeroed(layout)
    }
    #[inline]
    unsafe fn deallocate(&self, ptr: NonNull<u8>, layout: Layout) {
        // SAFETY: forwarded; caller guarantees `ptr` came from `allocate` on
        // this allocator (i.e. `Global`) with `layout`.
        unsafe { std::alloc::Global.deallocate(ptr, layout) }
    }
    #[inline]
    unsafe fn grow(
        &self,
        ptr: NonNull<u8>,
        old: Layout,
        new: Layout,
    ) -> Result<NonNull<[u8]>, core::alloc::AllocError> {
        // SAFETY: forwarded; caller upholds `Allocator::grow`'s preconditions.
        unsafe { std::alloc::Global.grow(ptr, old, new) }
    }
    #[inline]
    unsafe fn grow_zeroed(
        &self,
        ptr: NonNull<u8>,
        old: Layout,
        new: Layout,
    ) -> Result<NonNull<[u8]>, core::alloc::AllocError> {
        // SAFETY: forwarded.
        unsafe { std::alloc::Global.grow_zeroed(ptr, old, new) }
    }
    #[inline]
    unsafe fn shrink(
        &self,
        ptr: NonNull<u8>,
        old: Layout,
        new: Layout,
    ) -> Result<NonNull<[u8]>, core::alloc::AllocError> {
        // SAFETY: forwarded.
        unsafe { std::alloc::Global.shrink(ptr, old, new) }
    }
}

bridge_allocator_api2!(DefaultAlloc);
bridge_allocator_api2!(crate::ast_alloc::AstAlloc);
