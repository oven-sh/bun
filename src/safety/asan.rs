//! https://github.com/llvm/llvm-project/blob/main/compiler-rt/include/sanitizer/asan_interface.h

use core::ffi::{c_int, c_void};

// TODO(port): confirm cfg name — Zig's `bun.Environment.enable_asan` is a build-time bool;
// mapped here to `bun_asan`. Nightly Rust has `cfg(sanitize = "address")` (unstable,
// tracking #39699) which would be the direct equivalent; Phase B may switch to that or a
// custom `--cfg enable_asan` set by the build script.

#[cfg(bun_asan)]
mod c {
    use core::ffi::{c_int, c_void};

    // TODO(port): move to safety_sys
    unsafe extern "C" {
        fn __asan_poison_memory_region(ptr: *const c_void, size: usize);
        fn __asan_unpoison_memory_region(ptr: *const c_void, size: usize);
        fn __asan_address_is_poisoned(ptr: *const c_void) -> bool;
        fn __asan_describe_address(ptr: *const c_void);
        fn __asan_update_allocation_context(ptr: *const c_void) -> c_int;
        /// https://github.com/llvm/llvm-project/blob/main/compiler-rt/include/sanitizer/lsan_interface.h
        fn __lsan_register_root_region(ptr: *const c_void, size: usize);
        fn __lsan_unregister_root_region(ptr: *const c_void, size: usize);
    }

    #[inline]
    pub fn poison(ptr: *const c_void, size: usize) {
        // SAFETY: ASAN runtime is linked when this cfg is active; ptr/size describe a region
        // owned by the caller (same precondition as the Zig wrapper).
        unsafe { __asan_poison_memory_region(ptr, size) }
    }
    #[inline]
    pub fn unpoison(ptr: *const c_void, size: usize) {
        // SAFETY: see `poison`.
        unsafe { __asan_unpoison_memory_region(ptr, size) }
    }
    #[inline]
    pub fn is_poisoned(ptr: *const c_void) -> bool {
        // SAFETY: ASAN runtime is linked; reads shadow memory only.
        unsafe { __asan_address_is_poisoned(ptr) }
    }
    #[inline]
    pub fn describe(ptr: *const c_void) {
        // SAFETY: ASAN runtime is linked; diagnostic-only, prints to stderr.
        unsafe { __asan_describe_address(ptr) }
    }
    #[inline]
    pub fn update_allocation_context(ptr: *const c_void) -> c_int {
        // SAFETY: ASAN runtime is linked.
        unsafe { __asan_update_allocation_context(ptr) }
    }
    #[inline]
    pub fn register_root_region(ptr: *const c_void, size: usize) {
        // SAFETY: LSAN runtime is linked alongside ASAN.
        unsafe { __lsan_register_root_region(ptr, size) }
    }
    #[inline]
    pub fn unregister_root_region(ptr: *const c_void, size: usize) {
        // SAFETY: must match a prior register_root_region with identical args (caller invariant).
        unsafe { __lsan_unregister_root_region(ptr, size) }
    }
}

#[cfg(not(bun_asan))]
mod c {
    use core::ffi::{c_int, c_void};

    // PORT NOTE: Zig's stub `poison`/`unpoison` took only one arg (never called due to
    // comptime dead-code elimination). Rust type-checks both cfg branches at the call site,
    // so signatures here match the real impl.
    #[inline]
    pub fn poison(_: *const c_void, _: usize) {}
    #[inline]
    pub fn unpoison(_: *const c_void, _: usize) {}
    #[inline]
    pub fn is_poisoned(_: *const c_void) -> bool {
        false
    }
    #[inline]
    pub fn describe(_: *const c_void) {}
    #[inline]
    pub fn update_allocation_context(_: *const c_void) -> c_int {
        0
    }
    #[inline]
    pub fn register_root_region(_: *const c_void, _: usize) {}
    #[inline]
    pub fn unregister_root_region(_: *const c_void, _: usize) {}
}

pub const ENABLED: bool = cfg!(bun_asan);

// `__asan_default_options` lives in `src/bun_bin/main.rs` — it must be in the
// binary crate (a direct link input) to override the ASAN runtime's weak
// default. An rlib member that only provides this symbol is never extracted
// (the runtime's weak def already satisfies the reference), so defining it
// here silently does nothing.

/// Update allocation stack trace for the given allocation to the current stack
/// trace
#[inline]
pub fn update_allocation_context(ptr: *const c_void) -> bool {
    if !ENABLED {
        return false;
    }
    c::update_allocation_context(ptr) == 1
}

/// Describes an address (prints out where it was allocated, freed, stacktraces,
/// etc.)
#[inline]
pub fn describe(ptr: *const c_void) {
    if !ENABLED {
        return;
    }
    c::describe(ptr);
}

/// Tell LSAN to scan `[ptr, ptr+size)` for live pointers during leak checking.
///
/// Needed when a malloc-backed object is reachable only through a pointer that
/// itself lives inside a mimalloc page (which LSAN does not scan). Registering
/// the mimalloc-backed owner as a root region restores the reachability chain
/// so the malloc allocation isn't reported as a false-positive leak at exit.
#[inline]
pub fn register_root_region(ptr: *const c_void, size: usize) {
    if !ENABLED {
        return;
    }
    c::register_root_region(ptr, size);
}

/// Undo a prior `register_root_region(ptr, size)` with the exact same arguments.
#[inline]
pub fn unregister_root_region(ptr: *const c_void, size: usize) {
    if !ENABLED {
        return;
    }
    c::unregister_root_region(ptr, size);
}

/// Manually poison a memory region
///
/// Useful for making custom allocators asan-aware (for example HiveArray)
///
/// *NOT* threadsafe
#[inline]
pub fn poison(ptr: *const c_void, size: usize) {
    if !ENABLED {
        return;
    }
    c::poison(ptr, size);
}

/// Manually unpoison a memory region
///
/// Useful for making custom allocators asan-aware (for example HiveArray)
///
/// *NOT* threadsafe
#[inline]
pub fn unpoison(ptr: *const c_void, size: usize) {
    if !ENABLED {
        return;
    }
    c::unpoison(ptr, size);
}

#[inline]
fn is_poisoned(ptr: *const c_void) -> bool {
    if !ENABLED {
        return false;
    }
    c::is_poisoned(ptr)
}

#[inline]
pub fn assert_poisoned(ptr: *const c_void) {
    if !ENABLED {
        return;
    }
    if !is_poisoned(ptr) {
        c::describe(ptr);
        panic!("Address is not poisoned");
    }
}

#[inline]
pub fn assert_unpoisoned(ptr: *const c_void) {
    if !ENABLED {
        return;
    }
    if is_poisoned(ptr) {
        c::describe(ptr);
        panic!("Address is poisoned");
    }
}

// ported from: src/safety/asan.zig
