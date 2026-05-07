//! Allocator-identity safety checks (Zig: `bun.safety.alloc`).
//!
//! Zig's `std.mem.Allocator` is a `{ ptr: *anyopaque, vtable: *const VTable }`
//! pair; this module compares those two words to catch a single unmanaged
//! container being driven by mismatched allocators. The Rust port uses
//! [`bun_alloc::StdAllocator`] (the literal `{ptr, vtable}` struct) so the
//! comparison semantics are identical — no fat-pointer transmutes.
//!
//! Higher-tier `is_instance` checks (`MimallocArena`, `allocation_scope`,
//! `LinuxMemFdAllocator`, `CachedBytecode`, `bundle_v2`, `heap_breakdown::Zone`,
//! arena vtable) live in crates above `bun_safety` in the dep graph and are
//! reached via the [`crate::ALLOC_HAS_PTR`] / [`crate::IS_MIMALLOC_ARENA`]
//! AtomicPtr hooks (CYCLEBREAK §Debug-hook).

use core::fmt;

use bun_alloc::{basic, NullableAllocator, StdAllocator};
use bun_core::{Output, StoredTrace};

/// Returns true if `alloc` definitely has a valid `.ptr`.
fn has_ptr(alloc: StdAllocator) -> bool {
    // In-tier vtable-identity checks (`bun_alloc` is a direct dep).
    core::ptr::eq(alloc.vtable, basic::C_ALLOCATOR.vtable)
        || core::ptr::eq(alloc.vtable, basic::Z_ALLOCATOR.vtable)
        || bun_alloc::String::is_wtf_allocator(alloc)
        // Higher-tier checks (arena, allocation_scope, LinuxMemFdAllocator,
        // MaxHeapAllocator, MimallocArena, CachedBytecode, bundle_v2,
        // heap_breakdown::Zone) are folded into a single hook the runtime
        // registers at init. Unset hook ⇒ `false` (safe under-approximation).
        || crate::call_alloc_predicate(&crate::ALLOC_HAS_PTR, alloc)
}

/// Returns true if the allocators are definitely different.
fn guaranteed_mismatch(alloc1: StdAllocator, alloc2: StdAllocator) -> bool {
    if !core::ptr::eq(alloc1.vtable, alloc2.vtable) {
        return true;
    }
    let ptr1 = if has_ptr(alloc1) { alloc1.ptr } else { return false };
    let ptr2 = if has_ptr(alloc2) { alloc2.ptr } else { return false };
    ptr1 != ptr2
}

/// Asserts that two allocators are equal (in `ci_assert` builds).
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
                std::ptr::from_ref(alloc1.vtable), ptr1, ptr2,
            ),
        );
    }
    bun_core::assertf!(false, "{}", args);
}

/// Use this in unmanaged containers to ensure multiple allocators aren't being used with the same
/// container. Each method of the container that accepts an allocator parameter should call either
/// `CheckedAllocator::set` (for non-const methods) or `CheckedAllocator::assert_eq` (for const
/// methods). (Exception: methods like `clone` which explicitly accept any allocator should not call
/// any methods on this type.)
pub struct CheckedAllocator {
    // Zig: `#allocator: if (enabled) NullableAllocator else void = if (enabled) .init(null)`
    #[cfg(feature = "ci_assert")]
    allocator: NullableAllocator,
    // Zig: `#trace: if (traces_enabled) StoredTrace else void = if (traces_enabled) StoredTrace.empty`
    #[cfg(debug_assertions)]
    trace: StoredTrace,
}

impl Default for CheckedAllocator {
    #[inline]
    fn default() -> Self {
        Self {
            #[cfg(feature = "ci_assert")]
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
        if !ENABLED {
            return;
        }
        #[cfg(feature = "ci_assert")]
        if self.allocator.is_null() {
            self.allocator = NullableAllocator::init(Some(alloc));
            #[cfg(debug_assertions)]
            {
                // PORT NOTE: Zig passes `@returnAddress()`. Rust has no stable
                // equivalent; `None` lets `StoredTrace::capture` start from the
                // immediate caller frame instead.
                self.trace = StoredTrace::capture(None);
            }
        } else {
            self.assert_eq(alloc);
        }
    }

    pub fn assert_eq(&self, alloc: StdAllocator) {
        if !ENABLED {
            return;
        }
        #[cfg(feature = "ci_assert")]
        {
            let Some(old_alloc) = self.allocator.get() else { return };
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
                // Hook-registered: `bun_crash_handler::dump_stack_trace`
                // (frame_count = 10, stop_at_jsc_llint = true).
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
    pub fn transfer_ownership(&mut self, new_alloc: impl AsMimallocArenaAllocator) {
        if !ENABLED {
            return;
        }
        #[cfg(feature = "ci_assert")]
        {
            let new_std = new_alloc.allocator();

            // PORT NOTE: Zig uses `defer self.* = .init(new_std)`. A scopeguard
            // would need a `&mut self` capture overlapping the reads below, so
            // the assignment is hoisted to both early returns instead.
            let Some(old_allocator) = self.allocator.get() else {
                *self = Self::init(new_std);
                return;
            };
            if crate::call_alloc_predicate(&crate::IS_MIMALLOC_ARENA, old_allocator) {
                *self = Self::init(new_std);
                return;
            }

            #[cfg(debug_assertions)]
            {
                Output::err_generic("collection first used here:", ());
                // Hook-registered: `bun_crash_handler::dump_stack_trace`.
                crate::dump_stored_trace(&self.trace);
            }
            panic!(
                "cannot transfer ownership from non-MimallocArena (old vtable is {:p})",
                old_allocator.vtable as *const _,
            );
        }
    }
}

/// Zig's `transferOwnership` accepts `*MimallocArena | *const MimallocArena |
/// MimallocArena.Borrowed` via `anytype` + comptime switch and calls
/// `.allocator()` on the result. `MimallocArena` lives in `bun_runtime` (above
/// this crate), so callers implement this trait there.
pub trait AsMimallocArenaAllocator {
    fn allocator(&self) -> StdAllocator;
}

pub const ENABLED: bool = cfg!(feature = "ci_assert");

#[allow(dead_code)]
const TRACES_ENABLED: bool = cfg!(debug_assertions);

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/safety/alloc.zig (192 lines)
//   confidence: medium
//   todos:      0
//   notes:      Reworked from `&dyn Allocator` fat-pointer transmutes to `StdAllocator` (the literal {ptr, vtable} port) so .ptr/.vtable compare exactly as in Zig. Higher-tier `is_instance` checks (arena/allocation_scope/LinuxMemFd/MaxHeap/MimallocArena/CachedBytecode/bundle_v2/heap_breakdown) folded into the `ALLOC_HAS_PTR` hook; `MimallocArena::is_instance` for `transfer_ownership` via `IS_MIMALLOC_ARENA` hook. `is_wtf_allocator`/c_allocator/z_allocator vtable checks are direct (already moved down to bun_alloc).
// ──────────────────────────────────────────────────────────────────────────
