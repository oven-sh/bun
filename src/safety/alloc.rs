//! Allocator-identity safety checks.
//!
//! [`bun_alloc::StdAllocator`] is a literal `{ptr, vtable}` struct; this
//! module compares those two words to catch a single unmanaged container
//! being driven by mismatched allocators — no fat-pointer transmutes.
//!
//! Higher-tier `is_instance` checks (`MimallocArena`, `LinuxMemFdAllocator`,
//! `CachedBytecode`, `bundle_v2`, `heap_breakdown::Zone`, arena vtable)
//! live in crates above `bun_safety` in the dep graph; they
//! register their vtable addresses via [`crate::register_alloc_vtable`] at
//! init (data moved down, no fn-ptr hook). `MimallocArena` is in `bun_alloc`
//! (below us) so its `is_instance` is called directly.

use core::fmt;

#[cfg(debug_assertions)]
use bun_alloc::NullableAllocator;
use bun_alloc::{StdAllocator, basic};
use bun_core::Output;
#[cfg(debug_assertions)]
use bun_core::StoredTrace;

/// Returns true if `alloc` definitely has a valid `.ptr`.
fn has_ptr(alloc: StdAllocator) -> bool {
    // In-tier vtable-identity checks (`bun_alloc` is a direct dep).
    core::ptr::eq(alloc.vtable, basic::C_ALLOCATOR.vtable)
        || core::ptr::eq(alloc.vtable, basic::Z_ALLOCATOR.vtable)
        || bun_alloc::MimallocArena::is_instance(&alloc)
        || bun_alloc::String::is_wtf_allocator(alloc)
        // Higher-tier allocators (arena, LinuxMemFdAllocator, MaxHeapAllocator,
        // CachedBytecode, bundle_v2, heap_breakdown::Zone)
        // push their vtable addresses into the registry at init. Empty
        // registry ⇒ `false` (safe under-approximation).
        || crate::known_alloc_vtable(alloc)
}

/// Returns true if the allocators are definitely different.
#[cfg(debug_assertions)]
fn guaranteed_mismatch(alloc1: StdAllocator, alloc2: StdAllocator) -> bool {
    if !core::ptr::eq(alloc1.vtable, alloc2.vtable) {
        return true;
    }
    let ptr1 = if has_ptr(alloc1) {
        alloc1.ptr
    } else {
        return false;
    };
    let ptr2 = if has_ptr(alloc2) {
        alloc2.ptr
    } else {
        return false;
    };
    ptr1 != ptr2
}

/// Asserts that two allocators are equal (in debug builds).
///
/// This function may have false negatives; that is, it may fail to detect that two allocators
/// are different. However, in practice, it's a useful safety check.
pub fn assert_eq(alloc1: StdAllocator, alloc2: StdAllocator) {
    assert_eq_fmt(alloc1, alloc2, format_args!("allocators do not match"));
}

/// Asserts that two allocators are equal, with a formatted message.
pub fn assert_eq_fmt(alloc1: StdAllocator, alloc2: StdAllocator, args: fmt::Arguments<'_>) {
    if !ENABLED {
        return;
    }
    'blk: {
        if !core::ptr::eq(alloc1.vtable, alloc2.vtable) {
            Output::err_tag(
                "allocator mismatch",
                format_args!(
                    "vtables differ: {:p} and {:p}",
                    std::ptr::from_ref(alloc1.vtable),
                    std::ptr::from_ref(alloc2.vtable),
                ),
            );
            break 'blk;
        }
        let ptr1 = if has_ptr(alloc1) { alloc1.ptr } else { return };
        let ptr2 = if has_ptr(alloc2) { alloc2.ptr } else { return };
        if ptr1 == ptr2 {
            return;
        }
        Output::err_tag(
            "allocator mismatch",
            format_args!(
                "vtables are both {:p} but pointers differ: {:p} and {:p}",
                std::ptr::from_ref(alloc1.vtable),
                ptr1,
                ptr2,
            ),
        );
    }
    panic!("{}", args);
}

/// Use this in unmanaged containers to ensure multiple allocators aren't being used with the same
/// container. Each method of the container that accepts an allocator parameter should call either
/// `CheckedAllocator::set` (for non-const methods) or `CheckedAllocator::assert_eq` (for const
/// methods). (Exception: methods like `clone` which explicitly accept any allocator should not call
/// any methods on this type.)
pub struct CheckedAllocator {
    #[cfg(debug_assertions)]
    allocator: NullableAllocator,
    #[cfg(debug_assertions)]
    trace: StoredTrace,
}

impl Default for CheckedAllocator {
    #[inline]
    fn default() -> Self {
        Self {
            #[cfg(debug_assertions)]
            allocator: NullableAllocator::NULL,
            #[cfg(debug_assertions)]
            trace: StoredTrace::EMPTY,
        }
    }
}

impl CheckedAllocator {
    #[inline]
    pub fn init(alloc: StdAllocator) -> Self {
        let mut self_ = Self::default();
        self_.set(alloc);
        self_
    }

    pub fn set(&mut self, alloc: StdAllocator) {
        let _ = alloc;
        if !ENABLED {
            return;
        }
        #[cfg(debug_assertions)]
        if self.allocator.is_null() {
            self.allocator = NullableAllocator::init(Some(alloc));
            #[cfg(debug_assertions)]
            {
                // `None` lets `StoredTrace::capture` start from the
                // immediate caller frame.
                self.trace = StoredTrace::capture(None);
            }
        } else {
            self.assert_eq(alloc);
        }
    }

    pub fn assert_eq(&self, alloc: StdAllocator) {
        let _ = alloc;
        if !ENABLED {
            return;
        }
        #[cfg(debug_assertions)]
        {
            let Some(old_alloc) = self.allocator.get() else {
                return;
            };
            if !guaranteed_mismatch(old_alloc, alloc) {
                return;
            }

            Output::err_tag(
                "allocator mismatch",
                format_args!("cannot use multiple allocators with the same collection"),
            );
            #[cfg(debug_assertions)]
            {
                Output::err_tag(
                    "allocator mismatch",
                    format_args!("collection first used here, with a different allocator:"),
                );
                // bun_core::dump_stack_trace (T0 fallback — raw addrs).
                crate::dump_stored_trace(&self.trace);
            }
            // Assertion will always fail. We want the error message.
            crate::alloc::assert_eq(old_alloc, alloc);
        }
    }

    /// Transfers ownership of the collection to a new allocator.
    ///
    /// This method is valid only if both the old allocator and new allocator are `MimallocArena`s.
    /// This is okay because data allocated by one `MimallocArena` can always be freed by another
    /// (this includes `resize` and `remap`).
    ///
    /// `new_allocator` should be one of the following:
    ///
    /// * `&MimallocArena`
    /// * `&MimallocArena` (const)
    /// * `MimallocArena::Borrowed`
    ///
    /// If you only have a `StdAllocator`, see `MimallocArena::Borrowed::downcast`.
    #[inline]
    pub fn transfer_ownership(&mut self, new_alloc: &impl AsMimallocArenaAllocator) {
        let _ = new_alloc;
        if !ENABLED {
            return;
        }
        #[cfg(debug_assertions)]
        {
            let new_std = new_alloc.allocator();

            // A scopeguard would need a `&mut self` capture overlapping the
            // reads below, so the assignment is hoisted to both early returns
            // instead.
            let Some(old_allocator) = self.allocator.get() else {
                *self = Self::init(new_std);
                return;
            };
            if crate::is_mimalloc_arena(old_allocator) {
                *self = Self::init(new_std);
                return;
            }

            #[cfg(debug_assertions)]
            {
                Output::err_generic("collection first used here:", ());
                // bun_core::dump_stack_trace (T0 fallback — raw addrs).
                crate::dump_stored_trace(&self.trace);
            }
            panic!(
                "cannot transfer ownership from non-MimallocArena (old vtable is {:p})",
                std::ptr::from_ref(old_allocator.vtable),
            );
        }
    }
}

/// `MimallocArena` lives in `bun_runtime` (above this crate), so callers
/// implement this trait there.
pub trait AsMimallocArenaAllocator {
    fn allocator(&self) -> StdAllocator;
}

pub const ENABLED: bool = cfg!(debug_assertions);
