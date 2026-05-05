use core::ffi::c_void;
use core::fmt;

use bun_alloc::{self, Allocator, MimallocArena, NullableAllocator};
#[cfg(target_os = "linux")]
use bun_alloc::LinuxMemFdAllocator;
use bun_core::Output;
use bun_core::StoredTrace; // MOVE_DOWN: was bun_crash_handler::StoredTrace (CYCLEBREAK → core)

// TODO(port): Zig's `std.mem.Allocator` is a `{ ptr: *anyopaque, vtable: *const VTable }` pair.
// In Rust the closest analogue is `&dyn bun_alloc::Allocator` (fat pointer = data + vtable).
// The helpers below extract those two words for identity comparison. Revisit in Phase B once
// `bun_alloc::Allocator`'s exact shape is fixed — if it ends up being a concrete struct rather
// than a trait object, these helpers and every signature in this file change.

#[inline]
fn vtable_of(alloc: &dyn Allocator) -> *const () {
    let raw: *const dyn Allocator = alloc;
    // SAFETY: `*const dyn Trait` is a two-word fat pointer (data, vtable). Layout is
    // guaranteed by the Rust ABI for trait objects.
    unsafe { core::mem::transmute::<*const dyn Allocator, [*const (); 2]>(raw)[1] }
}

#[inline]
fn ptr_of(alloc: &dyn Allocator) -> *const c_void {
    alloc as *const dyn Allocator as *const c_void
}

// ──────────────────────────────────────────────────────────────────────────

fn no_alloc(
    _ptr: *mut c_void,
    _len: usize,
    _alignment: usize, // TODO(port): std.mem.Alignment
    _ret_addr: usize,
) -> Option<*mut u8> {
    None
}

// TODO(port): `dummy_vtable` / `arena_vtable` exist in Zig to obtain the vtable pointer that
// `std.heap.ArenaAllocator` hands out, so `has_ptr` can recognize arena-backed allocators by
// vtable identity. In Rust the arena type is `bumpalo::Bump` (re-exported as `bun_alloc::Arena`)
// and there is no equivalent "extract the vtable from a dummy instance at comptime" trick on
// stable. Phase B should replace this with `bun_alloc::Arena::is_instance(alloc)` (a downcast
// check) and delete `no_alloc` / `DUMMY_VTABLE` / `ARENA_VTABLE` entirely.
#[allow(dead_code)]
static DUMMY_VTABLE: () = ();

// TODO(port): see note on DUMMY_VTABLE. Placeholder so `has_ptr` compiles structurally.
fn arena_vtable() -> *const () {
    // PORT NOTE: Zig computes this at comptime via a labeled block; Rust cannot const-eval
    // a trait-object vtable extraction. Compute lazily instead.
    // TODO(port): replace with bun_alloc::Arena::VTABLE or an is_instance check.
    core::ptr::null()
}

// PORT NOTE: `cfg!()` keeps both branches in the type-checker (PORTING.md §Platform conditionals).
// `LinuxMemFdAllocator` / `heap_breakdown::Zone` may be cfg-gated in `bun_alloc`, so gate the
// reference itself with `#[cfg]` helpers that vanish on other targets.
// TODO(port): verify LinuxMemFdAllocator / heap_breakdown::Zone are exported unconditionally in
// bun_alloc; if so, these helpers can be inlined back into `has_ptr`.
#[inline]
fn linux_memfd_is_instance(alloc: &dyn Allocator) -> bool {
    #[cfg(target_os = "linux")]
    { return LinuxMemFdAllocator::is_instance(alloc); }
    #[cfg(not(target_os = "linux"))]
    { let _ = alloc; false }
}

#[inline]
fn heap_breakdown_zone_is_instance(alloc: &dyn Allocator) -> bool {
    // TODO(port): `bun.heap_breakdown.enabled` is a comptime build flag; map to a cfg feature.
    #[cfg(feature = "heap_breakdown")]
    { return bun_alloc::heap_breakdown::Zone::is_instance(alloc); }
    #[cfg(not(feature = "heap_breakdown"))]
    { let _ = alloc; false }
}

/// Returns true if `alloc` definitely has a valid `.ptr`.
fn has_ptr(alloc: &dyn Allocator) -> bool {
    vtable_of(alloc) == arena_vtable()
        || bun_alloc::allocation_scope::is_instance(alloc)
        || linux_memfd_is_instance(alloc)
        || bun_alloc::MaxHeapAllocator::is_instance(alloc)
        || vtable_of(alloc) == bun_alloc::c_allocator_vtable()
        || vtable_of(alloc) == bun_alloc::z_allocator_vtable()
        || MimallocArena::is_instance(alloc)
        /* TODO(port): CachedBytecode hook */
        // Hook-registered: bun_bundler::allocator_has_pointer (CYCLEBREAK §Debug-hook ALLOC_HAS_PTR).
        // NOTE: Zig predicates compare *vtable identity* (bundle_v2.zig:4423, string.zig:979),
        // so pass the vtable half of the fat pointer, not the data half.
        || crate::call_alloc_predicate(&crate::ALLOC_HAS_PTR, vtable_of(alloc))
        || heap_breakdown_zone_is_instance(alloc)
        // Hook-registered: bun_str::String::is_wtf_allocator (CYCLEBREAK §Debug-hook IS_WTF_ALLOCATOR).
        || crate::call_alloc_predicate(&crate::IS_WTF_ALLOCATOR, vtable_of(alloc))
}

/// Returns true if the allocators are definitely different.
fn guaranteed_mismatch(alloc1: &dyn Allocator, alloc2: &dyn Allocator) -> bool {
    if vtable_of(alloc1) != vtable_of(alloc2) {
        return true;
    }
    let ptr1 = if has_ptr(alloc1) { ptr_of(alloc1) } else { return false };
    let ptr2 = if has_ptr(alloc2) { ptr_of(alloc2) } else { return false };
    ptr1 != ptr2
}

/// Asserts that two allocators are equal (in `ci_assert` builds).
///
/// This function may have false negatives; that is, it may fail to detect that two allocators
/// are different. However, in practice, it's a useful safety check.
pub fn assert_eq(alloc1: &dyn Allocator, alloc2: &dyn Allocator) {
    assert_eq_fmt(alloc1, alloc2, format_args!("allocators do not match"));
}

/// Asserts that two allocators are equal, with a formatted message.
pub fn assert_eq_fmt(
    alloc1: &dyn Allocator,
    alloc2: &dyn Allocator,
    args: fmt::Arguments<'_>,
) {
    if !ENABLED {
        return;
    }
    'blk: {
        if vtable_of(alloc1) != vtable_of(alloc2) {
            Output::err(
                "allocator mismatch",
                format_args!(
                    "vtables differ: {:p} and {:p}",
                    vtable_of(alloc1),
                    vtable_of(alloc2),
                ),
            );
            break 'blk;
        }
        let ptr1 = if has_ptr(alloc1) { ptr_of(alloc1) } else { return };
        let ptr2 = if has_ptr(alloc2) { ptr_of(alloc2) } else { return };
        if ptr1 == ptr2 {
            return;
        }
        Output::err(
            "allocator mismatch",
            format_args!(
                "vtables are both {:p} but pointers differ: {:p} and {:p}",
                vtable_of(alloc1),
                ptr1,
                ptr2,
            ),
        );
    }
    bun_core::assertf(false, args);
}

/// Use this in unmanaged containers to ensure multiple allocators aren't being used with the same
/// container. Each method of the container that accepts an allocator parameter should call either
/// `CheckedAllocator::set` (for non-const methods) or `CheckedAllocator::assert_eq` (for const
/// methods). (Exception: methods like `clone` which explicitly accept any allocator should not call
/// any methods on this type.)
#[derive(Default)]
pub struct CheckedAllocator {
    // Zig: `#allocator: if (enabled) NullableAllocator else void = if (enabled) .init(null)`
    #[cfg(feature = "ci_assert")]
    allocator: NullableAllocator,
    // Zig: `#trace: if (traces_enabled) StoredTrace else void = if (traces_enabled) StoredTrace.empty`
    #[cfg(debug_assertions)]
    trace: StoredTrace,
}

impl CheckedAllocator {
    #[inline]
    pub fn init(alloc: &dyn Allocator) -> Self {
        let mut self_ = Self::default();
        self_.set(alloc);
        self_
    }

    pub fn set(&mut self, alloc: &dyn Allocator) {
        if !ENABLED {
            return;
        }
        #[cfg(feature = "ci_assert")]
        {
            if self.allocator.is_null() {
                self.allocator = NullableAllocator::init(Some(alloc));
                #[cfg(debug_assertions)]
                {
                    // TODO(port): @returnAddress() — use a backtrace capture or caller-provided ip.
                    self.trace = StoredTrace::capture(0);
                }
            } else {
                self.assert_eq(alloc);
            }
        }
        #[cfg(not(feature = "ci_assert"))]
        let _ = alloc;
    }

    pub fn assert_eq(&self, alloc: &dyn Allocator) {
        if !ENABLED {
            return;
        }
        #[cfg(feature = "ci_assert")]
        {
            let Some(old_alloc) = self.allocator.get() else { return };
            if !guaranteed_mismatch(old_alloc, alloc) {
                return;
            }

            Output::err(
                "allocator mismatch",
                format_args!("cannot use multiple allocators with the same collection"),
            );
            #[cfg(debug_assertions)]
            {
                Output::err(
                    "allocator mismatch",
                    format_args!("collection first used here, with a different allocator:"),
                );
                // Hook-registered: bun_crash_handler::dump_stack_trace (CYCLEBREAK §Debug-hook).
                crate::dump_stored_trace(&self.trace);
            }
            // Assertion will always fail. We want the error message.
            crate::alloc::assert_eq(old_alloc, alloc);
        }
        #[cfg(not(feature = "ci_assert"))]
        let _ = alloc;
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
    /// If you only have a `&dyn Allocator`, see `MimallocArena::Borrowed::downcast`.
    #[inline]
    pub fn transfer_ownership(&mut self, new_allocator: impl AsMimallocArenaAllocator) {
        if !ENABLED {
            return;
        }
        #[cfg(feature = "ci_assert")]
        {
            let new_std = new_allocator.allocator();

            // PORT NOTE: Zig uses `defer self.* = .init(new_std)`. scopeguard would need a
            // `&mut self` capture overlapping the reads below; reshaped for borrowck by hoisting
            // the assignment to both exit paths.
            let old_allocator = match self.allocator.get() {
                Some(a) => a,
                None => {
                    *self = Self::init(new_std);
                    return;
                }
            };
            if MimallocArena::is_instance(old_allocator) {
                *self = Self::init(new_std);
                return;
            }

            #[cfg(debug_assertions)]
            {
                Output::err_generic(format_args!("collection first used here:"));
                // Hook-registered: bun_crash_handler::dump_stack_trace (CYCLEBREAK §Debug-hook).
                crate::dump_stored_trace(&self.trace);
            }
            panic!(
                "cannot transfer ownership from non-MimallocArena (old vtable is {:p})",
                vtable_of(old_allocator),
            );
        }
        #[cfg(not(feature = "ci_assert"))]
        let _ = new_allocator;
    }
}

// TODO(port): Zig's `transferOwnership` accepts `*MimallocArena | *const MimallocArena |
// MimallocArena.Borrowed` via `anytype` + comptime switch. This trait stands in for that set;
// Phase B should impl it for `&MimallocArena` and `bun_alloc::MimallocArenaBorrowed`.
pub trait AsMimallocArenaAllocator {
    fn allocator(&self) -> &dyn Allocator;
}

pub const ENABLED: bool = cfg!(feature = "ci_assert");
// TODO(port): `bun.Environment.ci_assert` is a build-time flag distinct from debug_assertions;
// mapped to a cargo feature here. Phase B: wire the actual feature in Cargo.toml.

#[allow(dead_code)]
const TRACES_ENABLED: bool = cfg!(debug_assertions);

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/safety/alloc.zig (192 lines)
//   confidence: low
//   todos:      10
//   notes:      Entire module compares Zig Allocator {ptr,vtable} identity; Rust has no direct analogue. Ported structurally over `&dyn bun_alloc::Allocator` fat-pointer parts, but Phase B must decide whether this safety layer survives at all (most Rust callers won't pass allocators). arena_vtable/ci_assert/heap_breakdown gated on placeholder cfg features; LinuxMemFdAllocator/Zone refs wrapped in #[cfg] helpers.
// ──────────────────────────────────────────────────────────────────────────
