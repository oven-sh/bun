const C = @import("std").zig.c_builtins;
const __attribute__ = C.__attribute__;
const _Nonnull = C._Nonnull;
const _Null_unspecified = C._Null_unspecified;
const _Nullable = C._Nullable;
const enum_mi_option_e = C.enum_mi_option_e;
const L = C.L;
const LL = C.LL;
const U = C.U;
const UL = C.UL;
const ULL = C.ULL;
pub const ptrdiff_t = c_long;
pub const wchar_t = c_int;
pub const max_align_t = c_longdouble;
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
pub const mi_deferred_free_fun = fn (bool, c_ulonglong, ?*anyopaque) callconv(.C) void;
pub extern fn mi_register_deferred_free(deferred_free: ?mi_deferred_free_fun, arg: ?*anyopaque) void;
pub const mi_output_fun = fn ([*c]const u8, ?*anyopaque) callconv(.C) void;
pub extern fn mi_register_output(out: ?mi_output_fun, arg: ?*anyopaque) void;
pub const mi_error_fun = fn (c_int, ?*anyopaque) callconv(.C) void;
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
pub extern fn mi_process_info(elapsed_msecs: *usize, user_msecs: *usize, system_msecs: *usize, current_rss: *usize, peak_rss: *usize, current_commit: *usize, peak_commit: *usize, page_faults: *usize) void;
pub extern fn mi_malloc_aligned(size: usize, alignment: usize) ?*anyopaque;
pub extern fn mi_malloc_aligned_at(size: usize, alignment: usize, offset: usize) ?[*]u8;
pub extern fn mi_zalloc_aligned(size: usize, alignment: usize) ?*anyopaque;
pub extern fn mi_zalloc_aligned_at(size: usize, alignment: usize, offset: usize) ?*anyopaque;
pub extern fn mi_calloc_aligned(count: usize, size: usize, alignment: usize) ?*anyopaque;
pub extern fn mi_calloc_aligned_at(count: usize, size: usize, alignment: usize, offset: usize) ?*anyopaque;
pub extern fn mi_realloc_aligned(p: ?*anyopaque, newsize: usize, alignment: usize) ?*anyopaque;
pub extern fn mi_realloc_aligned_at(p: ?*anyopaque, newsize: usize, alignment: usize, offset: usize) ?*anyopaque;
pub const struct_mi_heap_s = opaque {
    pub inline fn backing(_: anytype) *mi_heap_t {
        return mi_heap_get_backing();
    }
};
pub const mi_heap_t = struct_mi_heap_s;
pub extern fn mi_heap_new() ?*mi_heap_t;
pub extern fn mi_heap_delete(heap: ?*mi_heap_t) void;
pub extern fn mi_heap_destroy(heap: ?*mi_heap_t) void;
pub extern fn mi_heap_set_default(heap: ?*mi_heap_t) ?*mi_heap_t;
pub extern fn mi_heap_get_default() *mi_heap_t;
pub extern fn mi_heap_get_backing() *mi_heap_t;
pub extern fn mi_heap_collect(heap: ?*mi_heap_t, force: bool) void;
pub extern fn mi_heap_malloc(heap: ?*mi_heap_t, size: usize) ?*anyopaque;
pub extern fn mi_heap_zalloc(heap: ?*mi_heap_t, size: usize) ?*anyopaque;
pub extern fn mi_heap_calloc(heap: ?*mi_heap_t, count: usize, size: usize) ?*anyopaque;
pub extern fn mi_heap_mallocn(heap: ?*mi_heap_t, count: usize, size: usize) ?*anyopaque;
pub extern fn mi_heap_malloc_small(heap: ?*mi_heap_t, size: usize) ?*anyopaque;
pub extern fn mi_heap_realloc(heap: ?*mi_heap_t, p: ?*anyopaque, newsize: usize) ?*anyopaque;
pub extern fn mi_heap_reallocn(heap: ?*mi_heap_t, p: ?*anyopaque, count: usize, size: usize) ?*anyopaque;
pub extern fn mi_heap_reallocf(heap: ?*mi_heap_t, p: ?*anyopaque, newsize: usize) ?*anyopaque;
pub extern fn mi_heap_strdup(heap: ?*mi_heap_t, s: [*c]const u8) [*c]u8;
pub extern fn mi_heap_strndup(heap: ?*mi_heap_t, s: [*c]const u8, n: usize) [*c]u8;
pub extern fn mi_heap_realpath(heap: ?*mi_heap_t, fname: [*c]const u8, resolved_name: [*c]u8) [*c]u8;
pub extern fn mi_heap_malloc_aligned(heap: ?*mi_heap_t, size: usize, alignment: usize) ?*anyopaque;
pub extern fn mi_heap_malloc_aligned_at(heap: ?*mi_heap_t, size: usize, alignment: usize, offset: usize) ?*anyopaque;
pub extern fn mi_heap_zalloc_aligned(heap: ?*mi_heap_t, size: usize, alignment: usize) ?*anyopaque;
pub extern fn mi_heap_zalloc_aligned_at(heap: ?*mi_heap_t, size: usize, alignment: usize, offset: usize) ?*anyopaque;
pub extern fn mi_heap_calloc_aligned(heap: ?*mi_heap_t, count: usize, size: usize, alignment: usize) ?*anyopaque;
pub extern fn mi_heap_calloc_aligned_at(heap: ?*mi_heap_t, count: usize, size: usize, alignment: usize, offset: usize) ?*anyopaque;
pub extern fn mi_heap_realloc_aligned(heap: ?*mi_heap_t, p: ?*anyopaque, newsize: usize, alignment: usize) ?*anyopaque;
pub extern fn mi_heap_realloc_aligned_at(heap: ?*mi_heap_t, p: ?*anyopaque, newsize: usize, alignment: usize, offset: usize) ?*anyopaque;
pub extern fn mi_rezalloc(p: ?*anyopaque, newsize: usize) ?*anyopaque;
pub extern fn mi_recalloc(p: ?*anyopaque, newcount: usize, size: usize) ?*anyopaque;
pub extern fn mi_rezalloc_aligned(p: ?*anyopaque, newsize: usize, alignment: usize) ?*anyopaque;
pub extern fn mi_rezalloc_aligned_at(p: ?*anyopaque, newsize: usize, alignment: usize, offset: usize) ?*anyopaque;
pub extern fn mi_recalloc_aligned(p: ?*anyopaque, newcount: usize, size: usize, alignment: usize) ?*anyopaque;
pub extern fn mi_recalloc_aligned_at(p: ?*anyopaque, newcount: usize, size: usize, alignment: usize, offset: usize) ?*anyopaque;
pub extern fn mi_heap_rezalloc(heap: ?*mi_heap_t, p: ?*anyopaque, newsize: usize) ?*anyopaque;
pub extern fn mi_heap_recalloc(heap: ?*mi_heap_t, p: ?*anyopaque, newcount: usize, size: usize) ?*anyopaque;
pub extern fn mi_heap_rezalloc_aligned(heap: ?*mi_heap_t, p: ?*anyopaque, newsize: usize, alignment: usize) ?*anyopaque;
pub extern fn mi_heap_rezalloc_aligned_at(heap: ?*mi_heap_t, p: ?*anyopaque, newsize: usize, alignment: usize, offset: usize) ?*anyopaque;
pub extern fn mi_heap_recalloc_aligned(heap: ?*mi_heap_t, p: ?*anyopaque, newcount: usize, size: usize, alignment: usize) ?*anyopaque;
pub extern fn mi_heap_recalloc_aligned_at(heap: ?*mi_heap_t, p: ?*anyopaque, newcount: usize, size: usize, alignment: usize, offset: usize) ?*anyopaque;
pub extern fn mi_heap_contains_block(heap: ?*mi_heap_t, p: ?*const anyopaque) bool;
pub extern fn mi_heap_check_owned(heap: ?*mi_heap_t, p: ?*const anyopaque) bool;
pub extern fn mi_check_owned(p: ?*const anyopaque) bool;
pub const struct_mi_heap_area_s = extern struct {
    blocks: ?*anyopaque,
    reserved: usize,
    committed: usize,
    used: usize,
    block_size: usize,
};
pub const mi_heap_area_t = struct_mi_heap_area_s;
pub const mi_block_visit_fun = fn (?*const mi_heap_t, [*c]const mi_heap_area_t, ?*anyopaque, usize, ?*anyopaque) callconv(.C) bool;
pub extern fn mi_heap_visit_blocks(heap: ?*const mi_heap_t, visit_all_blocks: bool, visitor: ?mi_block_visit_fun, arg: ?*anyopaque) bool;
pub extern fn mi_is_in_heap_region(p: ?*const anyopaque) bool;
pub extern fn mi_is_redirected() bool;
pub extern fn mi_reserve_huge_os_pages_interleave(pages: usize, numa_nodes: usize, timeout_msecs: usize) c_int;
pub extern fn mi_reserve_huge_os_pages_at(pages: usize, numa_node: c_int, timeout_msecs: usize) c_int;
pub extern fn mi_reserve_os_memory(size: usize, commit: bool, allow_large: bool) c_int;
pub extern fn mi_manage_os_memory(start: ?*anyopaque, size: usize, is_committed: bool, is_large: bool, is_zero: bool, numa_node: c_int) bool;
pub extern fn mi_reserve_huge_os_pages(pages: usize, max_secs: f64, pages_reserved: [*c]usize) c_int;
pub const mi_option_t = enum(c_uint) {
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
    segment_cache = 10,
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

    // mimalloc v2 specific
    allow_decommit = 21,
    segment_decommit_delay = 22,
    decommit_extend_delay = 23,
};

pub extern fn mi_option_is_enabled(option: mi_option_t) bool;
pub extern fn mi_option_enable(option: mi_option_t) void;
pub extern fn mi_option_disable(option: mi_option_t) void;
pub extern fn mi_option_set_enabled(option: mi_option_t, enable: bool) void;
pub extern fn mi_option_set_enabled_default(option: mi_option_t, enable: bool) void;
pub extern fn mi_option_get(option: mi_option_t) c_long;
pub extern fn mi_option_set(option: mi_option_t, value: c_long) void;
pub extern fn mi_option_set_default(option: mi_option_t, value: c_long) void;
pub extern fn mi_cfree(p: ?*anyopaque) void;
pub extern fn mi__expand(p: ?*anyopaque, newsize: usize) ?*anyopaque;
pub extern fn mi_malloc_size(p: ?*const anyopaque) usize;
pub extern fn mi_malloc_usable_size(p: ?*const anyopaque) usize;
pub extern fn mi_posix_memalign(p: [*c]?*anyopaque, alignment: usize, size: usize) c_int;
pub extern fn mi_memalign(alignment: usize, size: usize) ?*anyopaque;
pub extern fn mi_valloc(size: usize) ?*anyopaque;
pub extern fn mi_pvalloc(size: usize) ?*anyopaque;
pub extern fn mi_aligned_alloc(alignment: usize, size: usize) ?*anyopaque;
pub extern fn mi_reallocarray(p: ?*anyopaque, count: usize, size: usize) ?*anyopaque;
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
pub const mi_attr_alloc_size = @compileError("unable to translate C expr: unexpected token .Eof"); // /Users/jarred/Downloads/mimalloc-1.7.2/include/mimalloc.h:66:13
pub const mi_attr_alloc_size2 = @compileError("unable to translate C expr: unexpected token .Eof"); // /Users/jarred/Downloads/mimalloc-1.7.2/include/mimalloc.h:67:13
pub const mi_attr_alloc_align = @compileError("unable to translate C expr: unexpected token .Eof"); // /Users/jarred/Downloads/mimalloc-1.7.2/include/mimalloc.h:68:13
pub const offsetof = @compileError("TODO implement function '__builtin_offsetof' in std.zig.c_builtins"); // /Users/jarred/Build/zig/lib/include/stddef.h:104:9
pub const mi_malloc_tp = @compileError("unable to translate C expr: unexpected token .RParen"); // /Users/jarred/Downloads/mimalloc-1.7.2/include/mimalloc.h:279:9
pub const mi_zalloc_tp = @compileError("unable to translate C expr: unexpected token .RParen"); // /Users/jarred/Downloads/mimalloc-1.7.2/include/mimalloc.h:280:9
pub const mi_calloc_tp = @compileError("unable to translate C expr: unexpected token .RParen"); // /Users/jarred/Downloads/mimalloc-1.7.2/include/mimalloc.h:281:9
pub const mi_mallocn_tp = @compileError("unable to translate C expr: unexpected token .RParen"); // /Users/jarred/Downloads/mimalloc-1.7.2/include/mimalloc.h:282:9
pub const mi_reallocn_tp = @compileError("unable to translate C expr: unexpected token .RParen"); // /Users/jarred/Downloads/mimalloc-1.7.2/include/mimalloc.h:283:9
pub const mi_recalloc_tp = @compileError("unable to translate C expr: unexpected token .RParen"); // /Users/jarred/Downloads/mimalloc-1.7.2/include/mimalloc.h:284:9
pub const mi_heap_malloc_tp = @compileError("unable to translate C expr: unexpected token .RParen"); // /Users/jarred/Downloads/mimalloc-1.7.2/include/mimalloc.h:286:9
pub const mi_heap_zalloc_tp = @compileError("unable to translate C expr: unexpected token .RParen"); // /Users/jarred/Downloads/mimalloc-1.7.2/include/mimalloc.h:287:9
pub const mi_heap_calloc_tp = @compileError("unable to translate C expr: unexpected token .RParen"); // /Users/jarred/Downloads/mimalloc-1.7.2/include/mimalloc.h:288:9
pub const mi_heap_mallocn_tp = @compileError("unable to translate C expr: unexpected token .RParen"); // /Users/jarred/Downloads/mimalloc-1.7.2/include/mimalloc.h:289:9
pub const mi_heap_reallocn_tp = @compileError("unable to translate C expr: unexpected token .RParen"); // /Users/jarred/Downloads/mimalloc-1.7.2/include/mimalloc.h:290:9
pub const mi_heap_recalloc_tp = @compileError("unable to translate C expr: unexpected token .RParen"); // /Users/jarred/Downloads/mimalloc-1.7.2/include/mimalloc.h:291:9
pub const MI_MALLOC_VERSION = @as(c_int, 171);
pub const NULL = @import("std").zig.c_translation.cast(?*anyopaque, @as(c_int, 0));
pub const bool_1 = bool;
pub const true_2 = @as(c_int, 1);
pub const false_3 = @as(c_int, 0);
pub const __bool_true_false_are_defined = @as(c_int, 1);
pub const MI_SMALL_WSIZE_MAX = @as(c_int, 128);
pub const MI_SMALL_SIZE_MAX = MI_SMALL_WSIZE_MAX * @import("std").zig.c_translation.sizeof(?*anyopaque);
pub const mi_heap_s = struct_mi_heap_s;
pub const mi_heap_area_s = struct_mi_heap_area_s;
pub const mi_option_e = enum_mi_option_e;
