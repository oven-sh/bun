#![allow(non_camel_case_types, non_snake_case, clippy::missing_safety_doc)]

use core::ffi::{c_char, c_long, c_void};

// `Option` below is the mimalloc `mi_option_t` enum, which shadows
// `core::option::Option` in this module. Nullable fn-pointer params therefore
// spell out `core::option::Option<...>` to avoid the shadow.

unsafe extern "C" {
    /// No preconditions; returns null on failure.
    pub safe fn mi_malloc(size: usize) -> *mut c_void;
    /// No preconditions; returns null on failure.
    pub safe fn mi_calloc(count: usize, size: usize) -> *mut c_void;
    pub fn mi_realloc(p: *mut c_void, newsize: usize) -> *mut c_void;
    pub fn mi_expand(p: *mut c_void, newsize: usize) -> *mut c_void;
    pub fn mi_free(p: *mut c_void);
    /// No preconditions; returns null on failure.
    pub safe fn mi_zalloc(size: usize) -> *mut c_void;
    pub fn mi_usable_size(p: *const c_void) -> usize;
}

pub type mi_output_fun = extern "C" fn(*const c_char, *mut c_void);

unsafe extern "C" {
    /// No preconditions.
    pub safe fn mi_collect(force: bool);
    /// Call when a thread goes idle: collects this thread's pending frees, discards the
    /// free blocks inside its still-used pages, and hands the arena purge to the scavenger.
    /// Safe on any thread; a no-op on a thread that never allocated. No preconditions.
    pub safe fn mi_on_thread_idle();
    /// Hands this thread's heaps to the scavenger for the sleep the caller is
    /// about to enter; it sweeps them off-thread meanwhile. Returns false when
    /// nothing was handed off (no scavenger, a foreign thread, already parked),
    /// and then nothing needs to follow.
    ///
    /// # Safety
    /// When it returns true, this thread must neither allocate nor free until
    /// [`mi_on_thread_idle_end`].
    pub fn mi_on_thread_idle_start() -> bool;
    /// Takes the heaps back after a [`mi_on_thread_idle_start`] that returned
    /// true, waiting for a sweep in progress to stop.
    ///
    /// # Safety
    /// Must pair with a [`mi_on_thread_idle_start`] that returned true, on the
    /// same thread, before it allocates or frees again.
    pub fn mi_on_thread_idle_end();
    pub fn mi_stats_print_out(out: core::option::Option<mi_output_fun>, arg: *mut c_void);
    pub fn mi_process_info(
        elapsed_msecs: *mut usize,
        user_msecs: *mut usize,
        system_msecs: *mut usize,
        current_rss: *mut usize,
        peak_rss: *mut usize,
        current_commit: *mut usize,
        peak_commit: *mut usize,
        page_faults: *mut usize,
    );
    /// No preconditions; returns null on failure.
    pub safe fn mi_malloc_aligned(size: usize, alignment: usize) -> *mut c_void;
    /// No preconditions; returns null on failure.
    pub safe fn mi_zalloc_aligned(size: usize, alignment: usize) -> *mut c_void;
    pub fn mi_realloc_aligned(p: *mut c_void, newsize: usize, alignment: usize) -> *mut c_void;
}

bun_opaque::opaque_ffi! {
    /// Opaque mimalloc heap handle (`mi_heap_t`).
    pub struct Heap;
}

impl Heap {
    #[inline]
    pub fn malloc(&mut self, size: usize) -> *mut c_void {
        // SAFETY: `self` is a live `*mut Heap` obtained from mimalloc.
        unsafe { mi_heap_malloc(self, size) }
    }

    #[inline]
    pub fn calloc(&mut self, count: usize, size: usize) -> *mut c_void {
        // SAFETY: `self` is a live `*mut Heap` obtained from mimalloc.
        unsafe { mi_heap_calloc(self, count, size) }
    }

    /// # Safety
    /// `p` must be null or a pointer previously allocated by this heap.
    #[inline]
    pub unsafe fn realloc(&mut self, p: *mut c_void, newsize: usize) -> *mut c_void {
        // SAFETY: `self` is a live `*mut Heap`; caller upholds `p` contract.
        unsafe { mi_heap_realloc(self, p, newsize) }
    }

    // `p` is only address-range-tested (never dereferenced) — there is no
    // caller precondition, so this stays safe.
}

unsafe extern "C" {
    pub fn mi_heap_new() -> *mut Heap;
    pub fn mi_heap_destroy(heap: *mut Heap);
    pub fn mi_heap_main() -> *mut Heap;
    pub fn mi_heap_malloc(heap: *mut Heap, size: usize) -> *mut c_void;
    fn mi_heap_zalloc(heap: *mut Heap, size: usize) -> *mut c_void;
    fn mi_heap_calloc(heap: *mut Heap, count: usize, size: usize) -> *mut c_void;
    pub fn mi_heap_realloc(heap: *mut Heap, p: *mut c_void, newsize: usize) -> *mut c_void;
    pub fn mi_heap_malloc_aligned(heap: *mut Heap, size: usize, alignment: usize) -> *mut c_void;
    fn mi_heap_zalloc_aligned(heap: *mut Heap, size: usize, alignment: usize) -> *mut c_void;
    pub fn mi_heap_realloc_aligned(
        heap: *mut Heap,
        p: *mut c_void,
        newsize: usize,
        alignment: usize,
    ) -> *mut c_void;
}

#[repr(C)]
pub struct struct_mi_heap_area_s {
    pub blocks: *mut core::ffi::c_void,
    pub reserved: usize,
    pub committed: usize,
    pub used: usize,
    pub block_size: usize,
    pub full_block_size: usize,
    pub reserved1: *mut core::ffi::c_void,
}
pub type mi_heap_area_t = struct_mi_heap_area_s;

type mi_block_visit_fun =
    extern "C" fn(*const Heap, *const mi_heap_area_t, *mut c_void, usize, *mut c_void) -> bool;

unsafe extern "C" {
    pub fn mi_heap_visit_blocks(
        heap: *const Heap,
        visit_all_blocks: bool,
        visitor: core::option::Option<mi_block_visit_fun>,
        arg: *mut c_void,
    ) -> bool;
    pub fn mi_is_in_heap_region(p: *const c_void) -> bool;
}

// Named `Option` after mimalloc's `mi_option_t`; shadows `core::option::Option` in
// this module (callers use `mimalloc::Option`). `enum(c_uint)` → `#[repr(u32)]`
// (c_uint == u32 on all Bun targets; `#[repr(C)]` would give a signed c_int discriminant).
#[repr(u32)]
#[derive(Copy, Clone, Eq, PartialEq, Hash, Debug)]
pub enum Option {
    show_errors = 0,
    show_stats = 1,
    verbose = 2,
    eager_commit = 3,
    arena_eager_commit = 4,
    purge_decommits = 5,
    allow_large_os_pages = 6,
    reserve_huge_os_pages = 7,
    reserve_huge_os_pages_at = 8,
    reserve_os_memory = 9,
    deprecated_segment_cache = 10,
    deprecated_page_reset = 11,
    abandoned_page_purge = 12,
    deprecated_segment_reset = 13,
    eager_commit_delay = 14,
    purge_delay = 15,
    use_numa_nodes = 16,
    disallow_os_alloc = 17,
    os_tag = 18,
    max_errors = 19,
    max_warnings = 20,
    deprecated_max_segment_reclaim = 21,
    destroy_on_exit = 22,
    arena_reserve = 23,
    arena_purge_mult = 24,
    deprecated_purge_extend_delay = 25,
    disallow_arena_alloc = 26,
    retry_on_oom = 27,
    visit_abandoned = 28,
    guarded_min = 29,
    guarded_max = 30,
    guarded_precise = 31,
    guarded_sample_rate = 32,
    guarded_sample_seed = 33,
    generic_collect = 34,
    page_reclaim_on_free = 35,
    page_full_retain = 36,
    page_max_candidates = 37,
    max_vabits = 38,
    pagemap_commit = 39,
    page_commit_on_demand = 40,
    page_max_reclaim = 41,
    page_cross_thread_max_reclaim = 42,
}

unsafe extern "C" {
    // `mi_option_*` take only by-value `#[repr(C)]` enum + scalar args and
    // mutate mimalloc-internal global state; no pointer invariants → `safe fn`.
    pub safe fn mi_option_set(option: Option, value: c_long);
    pub fn mi_malloc_usable_size(p: *const c_void) -> usize;
    pub fn mi_free_size(p: *mut c_void, size: usize);
    pub fn mi_free_size_aligned(p: *mut c_void, size: usize, alignment: usize);
}

pub const MI_MAX_ALIGN_SIZE: usize = 16;

#[inline]
pub fn must_use_aligned_alloc(alignment: usize) -> bool {
    alignment > MI_MAX_ALIGN_SIZE
}

/// `mi_malloc_aligned` when `align > MI_MAX_ALIGN_SIZE`, else `mi_malloc`.
/// mimalloc's small-block fast path is only hit when no explicit alignment is
/// requested, so callers should not unconditionally pass through `_aligned`.
/// No preconditions; returns null on failure.
#[inline(always)]
pub fn mi_malloc_auto_align(size: usize, align: usize) -> *mut c_void {
    if must_use_aligned_alloc(align) {
        mi_malloc_aligned(size, align)
    } else {
        mi_malloc(size)
    }
}

/// Zeroing variant of [`mi_malloc_auto_align`]. No preconditions; null on failure.
#[inline(always)]
pub fn mi_zalloc_auto_align(size: usize, align: usize) -> *mut c_void {
    if must_use_aligned_alloc(align) {
        mi_zalloc_aligned(size, align)
    } else {
        mi_zalloc(size)
    }
}

/// Heap-scoped variant of [`mi_malloc_auto_align`].
///
/// # Safety
/// `heap` must point to a live `mi_heap_t`.
#[inline(always)]
pub unsafe fn mi_heap_malloc_auto_align(heap: *mut Heap, size: usize, align: usize) -> *mut c_void {
    // SAFETY: caller guarantees `heap` is live.
    unsafe {
        if must_use_aligned_alloc(align) {
            mi_heap_malloc_aligned(heap, size, align)
        } else {
            mi_heap_malloc(heap, size)
        }
    }
}

/// Heap-scoped zeroing variant of [`mi_malloc_auto_align`].
///
/// # Safety
/// `heap` must point to a live `mi_heap_t`.
#[inline(always)]
pub unsafe fn mi_heap_zalloc_auto_align(heap: *mut Heap, size: usize, align: usize) -> *mut c_void {
    // SAFETY: caller guarantees `heap` is live.
    unsafe {
        if must_use_aligned_alloc(align) {
            mi_heap_zalloc_aligned(heap, size, align)
        } else {
            mi_heap_zalloc(heap, size)
        }
    }
}
