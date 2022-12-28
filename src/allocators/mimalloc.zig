pub extern fn mi_malloc(size: usize) ?*anyopaque;
pub extern fn mi_calloc(count: usize, size: usize) ?*anyopaque;
pub extern fn mi_realloc(p: ?*anyopaque, newsize: usize) ?*anyopaque;
pub extern fn mi_expand(p: ?*anyopaque, newsize: usize) ?*anyopaque;
pub extern fn mi_free(p: ?*anyopaque) void;
pub extern fn mi_strdup(s: [*c]const u8) [*c]u8;
pub extern fn mi_strndup(s: [*c]const u8, n: usize) [*c]u8;
pub extern fn mi_realpath(fname: [*c]const u8, resolved_name: [*c]u8) [*c]u8;
pub extern fn mi_malloc_small(size: usize) ?*anyopaque;
pub extern fn mi_zalloc_small(size: usize) ?*anyopaque;
pub extern fn mi_zalloc(size: usize) ?*anyopaque;
pub extern fn mi_mallocn(count: usize, size: usize) ?*anyopaque;
pub extern fn mi_reallocn(p: ?*anyopaque, count: usize, size: usize) ?*anyopaque;
pub extern fn mi_reallocf(p: ?*anyopaque, newsize: usize) ?*anyopaque;
pub extern fn mi_usable_size(p: ?*const anyopaque) usize;
pub extern fn mi_good_size(size: usize) usize;
pub const mi_deferred_free_fun = *const fn (bool, c_ulonglong, ?*anyopaque) callconv(.C) void;
pub extern fn mi_register_deferred_free(deferred_free: ?mi_deferred_free_fun, arg: ?*anyopaque) void;
pub const mi_output_fun = *const fn ([*:0]const u8, ?*anyopaque) callconv(.C) void;
pub extern fn mi_register_output(out: ?mi_output_fun, arg: ?*anyopaque) void;
pub const mi_error_fun = *const fn (c_int, ?*anyopaque) callconv(.C) void;
pub extern fn mi_register_error(fun: ?mi_error_fun, arg: ?*anyopaque) void;
pub extern fn mi_collect(force: bool) void;
pub extern fn mi_version() c_int;
pub extern fn mi_stats_reset() void;
pub extern fn mi_stats_merge() void;
pub extern fn mi_stats_print(out: ?*anyopaque) void;
pub extern fn mi_stats_print_out(out: ?mi_output_fun, arg: ?*anyopaque) void;
pub extern fn mi_process_init() void;
pub extern fn mi_thread_init() void;
pub extern fn mi_thread_done() void;
pub extern fn mi_thread_stats_print_out(out: ?mi_output_fun, arg: ?*anyopaque) void;
pub extern fn mi_process_info(elapsed_msecs: [*c]usize, user_msecs: [*c]usize, system_msecs: [*c]usize, current_rss: [*c]usize, peak_rss: [*c]usize, current_commit: [*c]usize, peak_commit: [*c]usize, page_faults: [*c]usize) void;
pub extern fn mi_malloc_aligned(size: usize, alignment: usize) ?*anyopaque;
pub extern fn mi_malloc_aligned_at(size: usize, alignment: usize, offset: usize) ?*anyopaque;
pub extern fn mi_zalloc_aligned(size: usize, alignment: usize) ?*anyopaque;
pub extern fn mi_zalloc_aligned_at(size: usize, alignment: usize, offset: usize) ?*anyopaque;
pub extern fn mi_calloc_aligned(count: usize, size: usize, alignment: usize) ?*anyopaque;
pub extern fn mi_calloc_aligned_at(count: usize, size: usize, alignment: usize, offset: usize) ?*anyopaque;
pub extern fn mi_realloc_aligned(p: ?*anyopaque, newsize: usize, alignment: usize) ?*anyopaque;
pub extern fn mi_realloc_aligned_at(p: ?*anyopaque, newsize: usize, alignment: usize, offset: usize) ?*anyopaque;
pub const Heap = opaque {
    pub fn new() ?*Heap {
        return mi_heap_new();
    }

    pub fn delete(self: *Heap) void {
        mi_heap_delete(self);
    }

    pub fn malloc(self: *Heap, size: usize) ?*anyopaque {
        return mi_heap_malloc(self, size);
    }

    pub fn backing(_: *Heap) *Heap {
        return mi_heap_get_default();
    }

    pub fn calloc(self: *Heap, count: usize, size: usize) ?*anyopaque {
        return mi_heap_calloc(self, count, size);
    }

    pub fn realloc(self: *Heap, p: ?*anyopaque, newsize: usize) ?*anyopaque {
        return mi_heap_realloc(self, p, newsize);
    }

    pub fn isOwned(self: *Heap, p: ?*anyopaque) bool {
        return mi_heap_check_owned(self, p);
    }
};
pub extern fn mi_heap_new() ?*Heap;
pub extern fn mi_heap_delete(heap: *Heap) void;
pub extern fn mi_heap_destroy(heap: *Heap) void;
pub extern fn mi_heap_set_default(heap: *Heap) *Heap;
pub extern fn mi_heap_get_default() *Heap;
pub extern fn mi_heap_get_backing() *Heap;
pub extern fn mi_heap_collect(heap: *Heap, force: bool) void;
pub extern fn mi_heap_malloc(heap: *Heap, size: usize) ?*anyopaque;
pub extern fn mi_heap_zalloc(heap: *Heap, size: usize) ?*anyopaque;
pub extern fn mi_heap_calloc(heap: *Heap, count: usize, size: usize) ?*anyopaque;
pub extern fn mi_heap_mallocn(heap: *Heap, count: usize, size: usize) ?*anyopaque;
pub extern fn mi_heap_malloc_small(heap: *Heap, size: usize) ?*anyopaque;
pub extern fn mi_heap_realloc(heap: *Heap, p: ?*anyopaque, newsize: usize) ?*anyopaque;
pub extern fn mi_heap_reallocn(heap: *Heap, p: ?*anyopaque, count: usize, size: usize) ?*anyopaque;
pub extern fn mi_heap_reallocf(heap: *Heap, p: ?*anyopaque, newsize: usize) ?*anyopaque;
pub extern fn mi_heap_strdup(heap: *Heap, s: [*c]const u8) [*c]u8;
pub extern fn mi_heap_strndup(heap: *Heap, s: [*c]const u8, n: usize) [*c]u8;
pub extern fn mi_heap_realpath(heap: *Heap, fname: [*c]const u8, resolved_name: [*c]u8) [*c]u8;
pub extern fn mi_heap_malloc_aligned(heap: *Heap, size: usize, alignment: usize) ?*anyopaque;
pub extern fn mi_heap_malloc_aligned_at(heap: *Heap, size: usize, alignment: usize, offset: usize) ?*anyopaque;
pub extern fn mi_heap_zalloc_aligned(heap: *Heap, size: usize, alignment: usize) ?*anyopaque;
pub extern fn mi_heap_zalloc_aligned_at(heap: *Heap, size: usize, alignment: usize, offset: usize) ?*anyopaque;
pub extern fn mi_heap_calloc_aligned(heap: *Heap, count: usize, size: usize, alignment: usize) ?*anyopaque;
pub extern fn mi_heap_calloc_aligned_at(heap: *Heap, count: usize, size: usize, alignment: usize, offset: usize) ?*anyopaque;
pub extern fn mi_heap_realloc_aligned(heap: *Heap, p: ?*anyopaque, newsize: usize, alignment: usize) ?*anyopaque;
pub extern fn mi_heap_realloc_aligned_at(heap: *Heap, p: ?*anyopaque, newsize: usize, alignment: usize, offset: usize) ?*anyopaque;
pub extern fn mi_rezalloc(p: ?*anyopaque, newsize: usize) ?*anyopaque;
pub extern fn mi_recalloc(p: ?*anyopaque, newcount: usize, size: usize) ?*anyopaque;
pub extern fn mi_rezalloc_aligned(p: ?*anyopaque, newsize: usize, alignment: usize) ?*anyopaque;
pub extern fn mi_rezalloc_aligned_at(p: ?*anyopaque, newsize: usize, alignment: usize, offset: usize) ?*anyopaque;
pub extern fn mi_recalloc_aligned(p: ?*anyopaque, newcount: usize, size: usize, alignment: usize) ?*anyopaque;
pub extern fn mi_recalloc_aligned_at(p: ?*anyopaque, newcount: usize, size: usize, alignment: usize, offset: usize) ?*anyopaque;
pub extern fn mi_heap_rezalloc(heap: *Heap, p: ?*anyopaque, newsize: usize) ?*anyopaque;
pub extern fn mi_heap_recalloc(heap: *Heap, p: ?*anyopaque, newcount: usize, size: usize) ?*anyopaque;
pub extern fn mi_heap_rezalloc_aligned(heap: *Heap, p: ?*anyopaque, newsize: usize, alignment: usize) ?*anyopaque;
pub extern fn mi_heap_rezalloc_aligned_at(heap: *Heap, p: ?*anyopaque, newsize: usize, alignment: usize, offset: usize) ?*anyopaque;
pub extern fn mi_heap_recalloc_aligned(heap: *Heap, p: ?*anyopaque, newcount: usize, size: usize, alignment: usize) ?*anyopaque;
pub extern fn mi_heap_recalloc_aligned_at(heap: *Heap, p: ?*anyopaque, newcount: usize, size: usize, alignment: usize, offset: usize) ?*anyopaque;
pub extern fn mi_heap_contains_block(heap: *Heap, p: *const anyopaque) bool;
pub extern fn mi_heap_check_owned(heap: *Heap, p: *const anyopaque) bool;
pub extern fn mi_check_owned(p: ?*const anyopaque) bool;
pub const struct_mi_heap_area_s = extern struct {
    blocks: ?*anyopaque,
    reserved: usize,
    committed: usize,
    used: usize,
    block_size: usize,
    full_block_size: usize,
};
pub const mi_heap_area_t = struct_mi_heap_area_s;
pub const mi_block_visit_fun = *const fn (?*const Heap, [*c]const mi_heap_area_t, ?*anyopaque, usize, ?*anyopaque) callconv(.C) bool;
pub extern fn mi_heap_visit_blocks(heap: ?*const Heap, visit_all_blocks: bool, visitor: ?mi_block_visit_fun, arg: ?*anyopaque) bool;
pub extern fn mi_is_in_heap_region(p: ?*const anyopaque) bool;
pub extern fn mi_is_redirected() bool;
pub extern fn mi_reserve_huge_os_pages_interleave(pages: usize, numa_nodes: usize, timeout_msecs: usize) c_int;
pub extern fn mi_reserve_huge_os_pages_at(pages: usize, numa_node: c_int, timeout_msecs: usize) c_int;
pub extern fn mi_reserve_os_memory(size: usize, commit: bool, allow_large: bool) c_int;
pub extern fn mi_manage_os_memory(start: ?*anyopaque, size: usize, is_committed: bool, is_large: bool, is_zero: bool, numa_node: c_int) bool;
pub extern fn mi_debug_show_arenas() void;
pub const ArenaID = c_int;
pub extern fn mi_arena_area(arena_id: ArenaID, size: [*c]usize) ?*anyopaque;
pub extern fn mi_reserve_huge_os_pages_at_ex(pages: usize, numa_node: c_int, timeout_msecs: usize, exclusive: bool, arena_id: *ArenaID) c_int;
pub extern fn mi_reserve_os_memory_ex(size: usize, commit: bool, allow_large: bool, exclusive: bool, arena_id: *ArenaID) c_int;
pub extern fn mi_manage_os_memory_ex(start: ?*anyopaque, size: usize, is_committed: bool, is_large: bool, is_zero: bool, numa_node: c_int, exclusive: bool, arena_id: *ArenaID) bool;
pub extern fn mi_heap_new_in_arena(arena_id: ArenaID) ?*Heap;
pub extern fn mi_reserve_huge_os_pages(pages: usize, max_secs: f64, pages_reserved: [*c]usize) c_int;
pub const Option = enum(c_uint) {
    show_errors = 0,
    show_stats = 1,
    verbose = 2,
    eager_commit = 3,
    deprecated_eager_region_commit = 4,
    deprecated_reset_decommits = 5,
    large_os_pages = 6,
    reserve_huge_os_pages = 7,
    reserve_huge_os_pages_at = 8,
    reserve_os_memory = 9,
    deprecated_segment_cache = 10,
    page_reset = 11,
    abandoned_page_decommit = 12,
    deprecated_segment_reset = 13,
    eager_commit_delay = 14,
    decommit_delay = 15,
    use_numa_nodes = 16,
    limit_os_alloc = 17,
    os_tag = 18,
    max_errors = 19,
    max_warnings = 20,
    max_segment_reclaim = 21,
    allow_decommit = 22,
    segment_decommit_delay = 23,
    decommit_extend_delay = 24,
};
pub extern fn mi_option_is_enabled(option: Option) bool;
pub extern fn mi_option_enable(option: Option) void;
pub extern fn mi_option_disable(option: Option) void;
pub extern fn mi_option_set_enabled(option: Option, enable: bool) void;
pub extern fn mi_option_set_enabled_default(option: Option, enable: bool) void;
pub extern fn mi_option_get(option: Option) c_long;
pub extern fn mi_option_get_clamp(option: Option, min: c_long, max: c_long) c_long;
pub extern fn mi_option_set(option: Option, value: c_long) void;
pub extern fn mi_option_set_default(option: Option, value: c_long) void;
pub extern fn mi_cfree(p: ?*anyopaque) void;
pub extern fn mi__expand(p: ?*anyopaque, newsize: usize) ?*anyopaque;
pub extern fn mi_malloc_size(p: ?*const anyopaque) usize;
pub extern fn mi_malloc_good_size(size: usize) usize;
pub extern fn mi_malloc_usable_size(p: ?*const anyopaque) usize;
pub extern fn mi_posix_memalign(p: [*c]?*anyopaque, alignment: usize, size: usize) c_int;
pub extern fn mi_memalign(alignment: usize, size: usize) ?*anyopaque;
pub extern fn mi_valloc(size: usize) ?*anyopaque;
pub extern fn mi_pvalloc(size: usize) ?*anyopaque;
pub extern fn mi_aligned_alloc(alignment: usize, size: usize) ?*anyopaque;
pub extern fn mi_reallocarray(p: ?*anyopaque, count: usize, size: usize) ?*anyopaque;
pub extern fn mi_reallocarr(p: ?*anyopaque, count: usize, size: usize) c_int;
pub extern fn mi_aligned_recalloc(p: ?*anyopaque, newcount: usize, size: usize, alignment: usize) ?*anyopaque;
pub extern fn mi_aligned_offset_recalloc(p: ?*anyopaque, newcount: usize, size: usize, alignment: usize, offset: usize) ?*anyopaque;
pub extern fn mi_wcsdup(s: [*c]const c_ushort) [*c]c_ushort;
pub extern fn mi_mbsdup(s: [*c]const u8) [*c]u8;
pub extern fn mi_dupenv_s(buf: [*c][*c]u8, size: [*c]usize, name: [*c]const u8) c_int;
pub extern fn mi_wdupenv_s(buf: [*c][*c]c_ushort, size: [*c]usize, name: [*c]const c_ushort) c_int;
pub extern fn mi_free_size(p: ?*anyopaque, size: usize) void;
pub extern fn mi_free_size_aligned(p: ?*anyopaque, size: usize, alignment: usize) void;
pub extern fn mi_free_aligned(p: ?*anyopaque, alignment: usize) void;
pub extern fn mi_new(size: usize) ?*anyopaque;
pub extern fn mi_new_aligned(size: usize, alignment: usize) ?*anyopaque;
pub extern fn mi_new_nothrow(size: usize) ?*anyopaque;
pub extern fn mi_new_aligned_nothrow(size: usize, alignment: usize) ?*anyopaque;
pub extern fn mi_new_n(count: usize, size: usize) ?*anyopaque;
pub extern fn mi_new_realloc(p: ?*anyopaque, newsize: usize) ?*anyopaque;
pub extern fn mi_new_reallocn(p: ?*anyopaque, newcount: usize, size: usize) ?*anyopaque;
pub const MI_SMALL_WSIZE_MAX = @as(c_int, 128);
pub const MI_SMALL_SIZE_MAX = MI_SMALL_WSIZE_MAX * @import("std").zig.c_translation.sizeof(?*anyopaque);
pub const MI_ALIGNMENT_MAX = (@as(c_int, 16) * @as(c_int, 1024)) * @as(c_ulong, 1024);

const std = @import("std");
pub fn canUseAlignedAlloc(len: usize, alignment: usize) bool {
    return alignment > 0 and std.math.isPowerOfTwo(alignment) and !mi_malloc_satisfies_alignment(alignment, len);
}
const MI_MAX_ALIGN_SIZE = 16;
inline fn mi_malloc_satisfies_alignment(alignment: usize, size: usize) bool {
    return (alignment == @sizeOf(*anyopaque) or
        (alignment == MI_MAX_ALIGN_SIZE and size >= (MI_MAX_ALIGN_SIZE / 2)));
}
