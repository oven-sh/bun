#![allow(non_camel_case_types, non_snake_case, clippy::missing_safety_doc)]

use core::ffi::{c_char, c_int, c_long, c_ulong, c_ulonglong, c_ushort, c_void};

// PORT NOTE: `Option` below is the mimalloc `mi_option_t` enum (kept verbatim
// from the Zig). Nullable fn-pointer params therefore spell out
// `core::option::Option<...>` to avoid the shadow.

unsafe extern "C" {
    pub fn mi_malloc(size: usize) -> *mut c_void;
    pub fn mi_calloc(count: usize, size: usize) -> *mut c_void;
    pub fn mi_realloc(p: *mut c_void, newsize: usize) -> *mut c_void;
    pub fn mi_expand(p: *mut c_void, newsize: usize) -> *mut c_void;
    pub fn mi_free(p: *mut c_void);
    pub fn mi_strdup(s: *const c_char) -> *mut c_char;
    pub fn mi_strndup(s: *const c_char, n: usize) -> *mut c_char;
    pub fn mi_realpath(fname: *const c_char, resolved_name: *mut c_char) -> *mut c_char;
    pub fn mi_malloc_small(size: usize) -> *mut c_void;
    pub fn mi_zalloc_small(size: usize) -> *mut c_void;
    pub fn mi_zalloc(size: usize) -> *mut c_void;
    pub fn mi_mallocn(count: usize, size: usize) -> *mut c_void;
    pub fn mi_reallocn(p: *mut c_void, count: usize, size: usize) -> *mut c_void;
    pub fn mi_reallocf(p: *mut c_void, newsize: usize) -> *mut c_void;
    pub fn mi_usable_size(p: *const c_void) -> usize;
    pub fn mi_good_size(size: usize) -> usize;
}

pub type mi_deferred_free_fun = extern "C" fn(bool, c_ulonglong, *mut c_void);

unsafe extern "C" {
    pub fn mi_register_deferred_free(
        deferred_free: core::option::Option<mi_deferred_free_fun>,
        arg: *mut c_void,
    );
}

pub type mi_output_fun = extern "C" fn(*const c_char, *mut c_void);

unsafe extern "C" {
    pub fn mi_register_output(out: core::option::Option<mi_output_fun>, arg: *mut c_void);
}

pub type mi_error_fun = extern "C" fn(c_int, *mut c_void);

unsafe extern "C" {
    pub fn mi_register_error(fun: core::option::Option<mi_error_fun>, arg: *mut c_void);
    pub fn mi_collect(force: bool);
    pub fn mi_version() -> c_int;
    pub fn mi_stats_reset();
    pub fn mi_stats_merge();
    pub fn mi_stats_print(out: *mut c_void);
    pub fn mi_stats_print_out(out: core::option::Option<mi_output_fun>, arg: *mut c_void);
    pub fn mi_process_init();
    pub fn mi_thread_init();
    pub fn mi_thread_done();
    pub fn mi_thread_stats_print_out(out: core::option::Option<mi_output_fun>, arg: *mut c_void);
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
    pub fn mi_malloc_aligned(size: usize, alignment: usize) -> *mut c_void;
    pub fn mi_malloc_aligned_at(size: usize, alignment: usize, offset: usize) -> *mut c_void;
    pub fn mi_zalloc_aligned(size: usize, alignment: usize) -> *mut c_void;
    pub fn mi_zalloc_aligned_at(size: usize, alignment: usize, offset: usize) -> *mut c_void;
    pub fn mi_calloc_aligned(count: usize, size: usize, alignment: usize) -> *mut c_void;
    pub fn mi_calloc_aligned_at(
        count: usize,
        size: usize,
        alignment: usize,
        offset: usize,
    ) -> *mut c_void;
    pub fn mi_realloc_aligned(p: *mut c_void, newsize: usize, alignment: usize) -> *mut c_void;
    pub fn mi_realloc_aligned_at(
        p: *mut c_void,
        newsize: usize,
        alignment: usize,
        offset: usize,
    ) -> *mut c_void;
}

/// Opaque mimalloc heap handle (`mi_heap_t`).
#[repr(C)]
pub struct Heap {
    _p: [u8; 0],
    _m: core::marker::PhantomData<(*mut u8, core::marker::PhantomPinned)>,
}

impl Heap {
    #[inline]
    pub fn new() -> *mut Heap {
        // SAFETY: FFI call with no preconditions.
        unsafe { mi_heap_new() }
    }

    #[inline]
    pub fn delete(&mut self) {
        // SAFETY: `self` is a live `*mut Heap` obtained from mimalloc.
        unsafe { mi_heap_delete(self) }
    }

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

    #[inline]
    pub fn realloc(&mut self, p: *mut c_void, newsize: usize) -> *mut c_void {
        // SAFETY: `self` is a live `*mut Heap`; `p` is null or was allocated by this heap.
        unsafe { mi_heap_realloc(self, p, newsize) }
    }

    #[inline]
    pub fn is_owned(&self, p: *const c_void) -> bool {
        // SAFETY: `self` is a live `*const Heap` obtained from mimalloc.
        unsafe { mi_heap_contains(self, p) }
    }
}

unsafe extern "C" {
    pub fn mi_heap_new() -> *mut Heap;
    pub fn mi_heap_delete(heap: *mut Heap);
    pub fn mi_heap_destroy(heap: *mut Heap);
    pub fn mi_heap_main() -> *mut Heap;
    pub fn mi_heap_contains(heap: *const Heap, p: *const c_void) -> bool;
    pub fn mi_heap_collect(heap: *mut Heap, force: bool);
    pub fn mi_heap_malloc(heap: *mut Heap, size: usize) -> *mut c_void;
    pub fn mi_heap_zalloc(heap: *mut Heap, size: usize) -> *mut c_void;
    pub fn mi_heap_calloc(heap: *mut Heap, count: usize, size: usize) -> *mut c_void;
    pub fn mi_heap_mallocn(heap: *mut Heap, count: usize, size: usize) -> *mut c_void;
    pub fn mi_heap_malloc_small(heap: *mut Heap, size: usize) -> *mut c_void;
    pub fn mi_heap_realloc(heap: *mut Heap, p: *mut c_void, newsize: usize) -> *mut c_void;
    pub fn mi_heap_reallocn(
        heap: *mut Heap,
        p: *mut c_void,
        count: usize,
        size: usize,
    ) -> *mut c_void;
    pub fn mi_heap_reallocf(heap: *mut Heap, p: *mut c_void, newsize: usize) -> *mut c_void;
    pub fn mi_heap_strdup(heap: *mut Heap, s: *const c_char) -> *mut c_char;
    pub fn mi_heap_strndup(heap: *mut Heap, s: *const c_char, n: usize) -> *mut c_char;
    pub fn mi_heap_realpath(
        heap: *mut Heap,
        fname: *const c_char,
        resolved_name: *mut c_char,
    ) -> *mut c_char;
    pub fn mi_heap_malloc_aligned(heap: *mut Heap, size: usize, alignment: usize) -> *mut c_void;
    pub fn mi_heap_malloc_aligned_at(
        heap: *mut Heap,
        size: usize,
        alignment: usize,
        offset: usize,
    ) -> *mut c_void;
    pub fn mi_heap_zalloc_aligned(heap: *mut Heap, size: usize, alignment: usize) -> *mut c_void;
    pub fn mi_heap_zalloc_aligned_at(
        heap: *mut Heap,
        size: usize,
        alignment: usize,
        offset: usize,
    ) -> *mut c_void;
    pub fn mi_heap_calloc_aligned(
        heap: *mut Heap,
        count: usize,
        size: usize,
        alignment: usize,
    ) -> *mut c_void;
    pub fn mi_heap_calloc_aligned_at(
        heap: *mut Heap,
        count: usize,
        size: usize,
        alignment: usize,
        offset: usize,
    ) -> *mut c_void;
    pub fn mi_heap_realloc_aligned(
        heap: *mut Heap,
        p: *mut c_void,
        newsize: usize,
        alignment: usize,
    ) -> *mut c_void;
    pub fn mi_heap_realloc_aligned_at(
        heap: *mut Heap,
        p: *mut c_void,
        newsize: usize,
        alignment: usize,
        offset: usize,
    ) -> *mut c_void;
    pub fn mi_rezalloc(p: *mut c_void, newsize: usize) -> *mut c_void;
    pub fn mi_recalloc(p: *mut c_void, newcount: usize, size: usize) -> *mut c_void;
    pub fn mi_rezalloc_aligned(p: *mut c_void, newsize: usize, alignment: usize) -> *mut c_void;
    pub fn mi_rezalloc_aligned_at(
        p: *mut c_void,
        newsize: usize,
        alignment: usize,
        offset: usize,
    ) -> *mut c_void;
    pub fn mi_recalloc_aligned(
        p: *mut c_void,
        newcount: usize,
        size: usize,
        alignment: usize,
    ) -> *mut c_void;
    pub fn mi_recalloc_aligned_at(
        p: *mut c_void,
        newcount: usize,
        size: usize,
        alignment: usize,
        offset: usize,
    ) -> *mut c_void;
    pub fn mi_heap_rezalloc(heap: *mut Heap, p: *mut c_void, newsize: usize) -> *mut c_void;
    pub fn mi_heap_recalloc(
        heap: *mut Heap,
        p: *mut c_void,
        newcount: usize,
        size: usize,
    ) -> *mut c_void;
    pub fn mi_heap_rezalloc_aligned(
        heap: *mut Heap,
        p: *mut c_void,
        newsize: usize,
        alignment: usize,
    ) -> *mut c_void;
    pub fn mi_heap_rezalloc_aligned_at(
        heap: *mut Heap,
        p: *mut c_void,
        newsize: usize,
        alignment: usize,
        offset: usize,
    ) -> *mut c_void;
    pub fn mi_heap_recalloc_aligned(
        heap: *mut Heap,
        p: *mut c_void,
        newcount: usize,
        size: usize,
        alignment: usize,
    ) -> *mut c_void;
    pub fn mi_heap_recalloc_aligned_at(
        heap: *mut Heap,
        p: *mut c_void,
        newcount: usize,
        size: usize,
        alignment: usize,
        offset: usize,
    ) -> *mut c_void;
    pub fn mi_check_owned(p: *const c_void) -> bool;
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

pub type mi_block_visit_fun =
    extern "C" fn(*const Heap, *const mi_heap_area_t, *mut c_void, usize, *mut c_void) -> bool;

unsafe extern "C" {
    pub fn mi_heap_visit_blocks(
        heap: *const Heap,
        visit_all_blocks: bool,
        visitor: core::option::Option<mi_block_visit_fun>,
        arg: *mut c_void,
    ) -> bool;
    pub fn mi_is_in_heap_region(p: *const c_void) -> bool;
    pub fn mi_is_redirected() -> bool;
    pub fn mi_reserve_huge_os_pages_interleave(
        pages: usize,
        numa_nodes: usize,
        timeout_msecs: usize,
    ) -> c_int;
    pub fn mi_reserve_huge_os_pages_at(
        pages: usize,
        numa_node: c_int,
        timeout_msecs: usize,
    ) -> c_int;
    pub fn mi_reserve_os_memory(size: usize, commit: bool, allow_large: bool) -> c_int;
    pub fn mi_manage_os_memory(
        start: *mut c_void,
        size: usize,
        is_committed: bool,
        is_large: bool,
        is_zero: bool,
        numa_node: c_int,
    ) -> bool;
    pub fn mi_debug_show_arenas();
}

pub type ArenaID = *mut c_void;

unsafe extern "C" {
    pub fn mi_arena_area(arena_id: ArenaID, size: *mut usize) -> *mut c_void;
    pub fn mi_reserve_huge_os_pages_at_ex(
        pages: usize,
        numa_node: c_int,
        timeout_msecs: usize,
        exclusive: bool,
        arena_id: *mut ArenaID,
    ) -> c_int;
    pub fn mi_reserve_os_memory_ex(
        size: usize,
        commit: bool,
        allow_large: bool,
        exclusive: bool,
        arena_id: *mut ArenaID,
    ) -> c_int;
    pub fn mi_manage_os_memory_ex(
        start: *mut c_void,
        size: usize,
        is_committed: bool,
        is_large: bool,
        is_zero: bool,
        numa_node: c_int,
        exclusive: bool,
        arena_id: *mut ArenaID,
    ) -> bool;
    pub fn mi_heap_new_in_arena(arena_id: ArenaID) -> *mut Heap;
    pub fn mi_reserve_huge_os_pages(
        pages: usize,
        max_secs: f64,
        pages_reserved: *mut usize,
    ) -> c_int;
    pub fn mi_thread_set_in_threadpool();
}

// PORT NOTE: kept name `Option` to match Zig; shadows `core::option::Option` in
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
    pub fn mi_option_is_enabled(option: Option) -> bool;
    pub fn mi_option_enable(option: Option);
    pub fn mi_option_disable(option: Option);
    pub fn mi_option_set_enabled(option: Option, enable: bool);
    pub fn mi_option_set_enabled_default(option: Option, enable: bool);
    pub fn mi_option_get(option: Option) -> c_long;
    pub fn mi_option_get_clamp(option: Option, min: c_long, max: c_long) -> c_long;
    pub fn mi_option_set(option: Option, value: c_long);
    pub fn mi_option_set_default(option: Option, value: c_long);
    pub fn mi_cfree(p: *mut c_void);
    pub fn mi__expand(p: *mut c_void, newsize: usize) -> *mut c_void;
    pub fn mi_malloc_size(p: *const c_void) -> usize;
    pub fn mi_malloc_good_size(size: usize) -> usize;
    pub fn mi_malloc_usable_size(p: *const c_void) -> usize;
    pub fn mi_posix_memalign(p: *mut *mut c_void, alignment: usize, size: usize) -> c_int;
    pub fn mi_memalign(alignment: usize, size: usize) -> *mut c_void;
    pub fn mi_valloc(size: usize) -> *mut c_void;
    pub fn mi_pvalloc(size: usize) -> *mut c_void;
    pub fn mi_aligned_alloc(alignment: usize, size: usize) -> *mut c_void;
    pub fn mi_reallocarray(p: *mut c_void, count: usize, size: usize) -> *mut c_void;
    pub fn mi_reallocarr(p: *mut c_void, count: usize, size: usize) -> c_int;
    pub fn mi_aligned_recalloc(
        p: *mut c_void,
        newcount: usize,
        size: usize,
        alignment: usize,
    ) -> *mut c_void;
    pub fn mi_aligned_offset_recalloc(
        p: *mut c_void,
        newcount: usize,
        size: usize,
        alignment: usize,
        offset: usize,
    ) -> *mut c_void;
    pub fn mi_wcsdup(s: *const c_ushort) -> *mut c_ushort;
    pub fn mi_mbsdup(s: *const c_char) -> *mut c_char;
    pub fn mi_dupenv_s(buf: *mut *mut c_char, size: *mut usize, name: *const c_char) -> c_int;
    pub fn mi_wdupenv_s(
        buf: *mut *mut c_ushort,
        size: *mut usize,
        name: *const c_ushort,
    ) -> c_int;
    pub fn mi_free_size(p: *mut c_void, size: usize);
    pub fn mi_free_size_aligned(p: *mut c_void, size: usize, alignment: usize);
    pub fn mi_free_aligned(p: *mut c_void, alignment: usize);
    pub fn mi_new(size: usize) -> *mut c_void;
    pub fn mi_new_aligned(size: usize, alignment: usize) -> *mut c_void;
    pub fn mi_new_nothrow(size: usize) -> *mut c_void;
    pub fn mi_new_aligned_nothrow(size: usize, alignment: usize) -> *mut c_void;
    pub fn mi_new_n(count: usize, size: usize) -> *mut c_void;
    pub fn mi_new_realloc(p: *mut c_void, newsize: usize) -> *mut c_void;
    pub fn mi_new_reallocn(p: *mut c_void, newcount: usize, size: usize) -> *mut c_void;
}

pub const MI_SMALL_WSIZE_MAX: c_int = 128;
pub const MI_SMALL_SIZE_MAX: usize =
    MI_SMALL_WSIZE_MAX as usize * core::mem::size_of::<*mut c_void>();
pub const MI_ALIGNMENT_MAX: c_ulong = (16 * 1024) * 1024;
pub const MI_MAX_ALIGN_SIZE: usize = 16;

// TODO(port): Zig took `std.mem.Alignment` (log2 newtype). Rust callers pass the
// alignment in bytes directly; revisit if `bun_alloc` grows an `Alignment` type.
#[inline]
pub fn must_use_aligned_alloc(alignment: usize) -> bool {
    alignment > MI_MAX_ALIGN_SIZE
}

pub type mi_arena_id_t = *mut c_void;

unsafe extern "C" {
    pub fn mi_heap_new_ex(
        heap_tag: c_int,
        allow_destroy: bool,
        arena_id: mi_arena_id_t,
    ) -> *mut Heap;
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/mimalloc_sys/mimalloc.zig (226 lines)
//   confidence: high
//   todos:      1
//   notes:      `Option` enum shadows core::option::Option in this module; nullable fn-ptrs use full path.
// ──────────────────────────────────────────────────────────────────────────
