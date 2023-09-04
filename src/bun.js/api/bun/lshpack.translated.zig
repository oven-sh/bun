pub const __builtin_bswap16 = @import("std").zig.c_builtins.__builtin_bswap16;
pub const __builtin_bswap32 = @import("std").zig.c_builtins.__builtin_bswap32;
pub const __builtin_bswap64 = @import("std").zig.c_builtins.__builtin_bswap64;
pub const __builtin_signbit = @import("std").zig.c_builtins.__builtin_signbit;
pub const __builtin_signbitf = @import("std").zig.c_builtins.__builtin_signbitf;
pub const __builtin_popcount = @import("std").zig.c_builtins.__builtin_popcount;
pub const __builtin_ctz = @import("std").zig.c_builtins.__builtin_ctz;
pub const __builtin_clz = @import("std").zig.c_builtins.__builtin_clz;
pub const __builtin_sqrt = @import("std").zig.c_builtins.__builtin_sqrt;
pub const __builtin_sqrtf = @import("std").zig.c_builtins.__builtin_sqrtf;
pub const __builtin_sin = @import("std").zig.c_builtins.__builtin_sin;
pub const __builtin_sinf = @import("std").zig.c_builtins.__builtin_sinf;
pub const __builtin_cos = @import("std").zig.c_builtins.__builtin_cos;
pub const __builtin_cosf = @import("std").zig.c_builtins.__builtin_cosf;
pub const __builtin_exp = @import("std").zig.c_builtins.__builtin_exp;
pub const __builtin_expf = @import("std").zig.c_builtins.__builtin_expf;
pub const __builtin_exp2 = @import("std").zig.c_builtins.__builtin_exp2;
pub const __builtin_exp2f = @import("std").zig.c_builtins.__builtin_exp2f;
pub const __builtin_log = @import("std").zig.c_builtins.__builtin_log;
pub const __builtin_logf = @import("std").zig.c_builtins.__builtin_logf;
pub const __builtin_log2 = @import("std").zig.c_builtins.__builtin_log2;
pub const __builtin_log2f = @import("std").zig.c_builtins.__builtin_log2f;
pub const __builtin_log10 = @import("std").zig.c_builtins.__builtin_log10;
pub const __builtin_log10f = @import("std").zig.c_builtins.__builtin_log10f;
pub const __builtin_abs = @import("std").zig.c_builtins.__builtin_abs;
pub const __builtin_fabs = @import("std").zig.c_builtins.__builtin_fabs;
pub const __builtin_fabsf = @import("std").zig.c_builtins.__builtin_fabsf;
pub const __builtin_floor = @import("std").zig.c_builtins.__builtin_floor;
pub const __builtin_floorf = @import("std").zig.c_builtins.__builtin_floorf;
pub const __builtin_ceil = @import("std").zig.c_builtins.__builtin_ceil;
pub const __builtin_ceilf = @import("std").zig.c_builtins.__builtin_ceilf;
pub const __builtin_trunc = @import("std").zig.c_builtins.__builtin_trunc;
pub const __builtin_truncf = @import("std").zig.c_builtins.__builtin_truncf;
pub const __builtin_round = @import("std").zig.c_builtins.__builtin_round;
pub const __builtin_roundf = @import("std").zig.c_builtins.__builtin_roundf;
pub const __builtin_strlen = @import("std").zig.c_builtins.__builtin_strlen;
pub const __builtin_strcmp = @import("std").zig.c_builtins.__builtin_strcmp;
pub const __builtin_object_size = @import("std").zig.c_builtins.__builtin_object_size;
pub const __builtin___memset_chk = @import("std").zig.c_builtins.__builtin___memset_chk;
pub const __builtin_memset = @import("std").zig.c_builtins.__builtin_memset;
pub const __builtin___memcpy_chk = @import("std").zig.c_builtins.__builtin___memcpy_chk;
pub const __builtin_memcpy = @import("std").zig.c_builtins.__builtin_memcpy;
pub const __builtin_expect = @import("std").zig.c_builtins.__builtin_expect;
pub const __builtin_nanf = @import("std").zig.c_builtins.__builtin_nanf;
pub const __builtin_huge_valf = @import("std").zig.c_builtins.__builtin_huge_valf;
pub const __builtin_inff = @import("std").zig.c_builtins.__builtin_inff;
pub const __builtin_isnan = @import("std").zig.c_builtins.__builtin_isnan;
pub const __builtin_isinf = @import("std").zig.c_builtins.__builtin_isinf;
pub const __builtin_isinf_sign = @import("std").zig.c_builtins.__builtin_isinf_sign;
pub const __has_builtin = @import("std").zig.c_builtins.__has_builtin;
pub const __builtin_assume = @import("std").zig.c_builtins.__builtin_assume;
pub const __builtin_unreachable = @import("std").zig.c_builtins.__builtin_unreachable;
pub const __builtin_constant_p = @import("std").zig.c_builtins.__builtin_constant_p;
pub const __builtin_mul_overflow = @import("std").zig.c_builtins.__builtin_mul_overflow;
pub const __u_char = u8;
pub const __u_short = c_ushort;
pub const __u_int = c_uint;
pub const __u_long = c_ulong;
pub const __int8_t = i8;
pub const __uint8_t = u8;
pub const __int16_t = c_short;
pub const __uint16_t = c_ushort;
pub const __int32_t = c_int;
pub const __uint32_t = c_uint;
pub const __int64_t = c_long;
pub const __uint64_t = c_ulong;
pub const __int_least8_t = __int8_t;
pub const __uint_least8_t = __uint8_t;
pub const __int_least16_t = __int16_t;
pub const __uint_least16_t = __uint16_t;
pub const __int_least32_t = __int32_t;
pub const __uint_least32_t = __uint32_t;
pub const __int_least64_t = __int64_t;
pub const __uint_least64_t = __uint64_t;
pub const __quad_t = c_long;
pub const __u_quad_t = c_ulong;
pub const __intmax_t = c_long;
pub const __uintmax_t = c_ulong;
pub const __dev_t = c_ulong;
pub const __uid_t = c_uint;
pub const __gid_t = c_uint;
pub const __ino_t = c_ulong;
pub const __ino64_t = c_ulong;
pub const __mode_t = c_uint;
pub const __nlink_t = c_ulong;
pub const __off_t = c_long;
pub const __off64_t = c_long;
pub const __pid_t = c_int;
pub const __fsid_t = extern struct {
    __val: [2]c_int,
};
pub const __clock_t = c_long;
pub const __rlim_t = c_ulong;
pub const __rlim64_t = c_ulong;
pub const __id_t = c_uint;
pub const __time_t = c_long;
pub const __useconds_t = c_uint;
pub const __suseconds_t = c_long;
pub const __suseconds64_t = c_long;
pub const __daddr_t = c_int;
pub const __key_t = c_int;
pub const __clockid_t = c_int;
pub const __timer_t = ?*anyopaque;
pub const __blksize_t = c_long;
pub const __blkcnt_t = c_long;
pub const __blkcnt64_t = c_long;
pub const __fsblkcnt_t = c_ulong;
pub const __fsblkcnt64_t = c_ulong;
pub const __fsfilcnt_t = c_ulong;
pub const __fsfilcnt64_t = c_ulong;
pub const __fsword_t = c_long;
pub const __ssize_t = c_long;
pub const __syscall_slong_t = c_long;
pub const __syscall_ulong_t = c_ulong;
pub const __loff_t = __off64_t;
pub const __caddr_t = [*c]u8;
pub const __intptr_t = c_long;
pub const __socklen_t = c_uint;
pub const __sig_atomic_t = c_int;
pub const int_least8_t = __int_least8_t;
pub const int_least16_t = __int_least16_t;
pub const int_least32_t = __int_least32_t;
pub const int_least64_t = __int_least64_t;
pub const uint_least8_t = __uint_least8_t;
pub const uint_least16_t = __uint_least16_t;
pub const uint_least32_t = __uint_least32_t;
pub const uint_least64_t = __uint_least64_t;
pub const int_fast8_t = i8;
pub const int_fast16_t = c_long;
pub const int_fast32_t = c_long;
pub const int_fast64_t = c_long;
pub const uint_fast8_t = u8;
pub const uint_fast16_t = c_ulong;
pub const uint_fast32_t = c_ulong;
pub const uint_fast64_t = c_ulong;
pub const intmax_t = __intmax_t;
pub const uintmax_t = __uintmax_t;
pub const lsxpack_strlen_t = u16;
pub const LSXPACK_HPACK_VAL_MATCHED: c_int = 1;
pub const LSXPACK_QPACK_IDX: c_int = 2;
pub const LSXPACK_APP_IDX: c_int = 4;
pub const LSXPACK_NAME_HASH: c_int = 8;
pub const LSXPACK_NAMEVAL_HASH: c_int = 16;
pub const LSXPACK_VAL_MATCHED: c_int = 32;
pub const LSXPACK_NEVER_INDEX: c_int = 64;
pub const enum_lsxpack_flag = c_uint;

// /// When header are decoded, it should be stored to @buf starting from @name_offset,
// ///    <name>: <value>\r\n
// /// So, it can be used directly as HTTP/1.1 header. there are 4 extra characters
// /// added.
// ///
// /// limitation: we currently does not support total header size > 64KB.
pub const struct_lsxpack_header = extern struct {
    /// the buffer for headers
    buf: [*]u8 = undefined,
    /// hash value for name
    name_hash: __uint32_t = 0,
    /// hash value for name + value
    nameval_hash: __uint32_t = 0,
    /// the offset for name in the buffer
    name_offset: lsxpack_strlen_t = 0,
    /// the length of name
    name_len: lsxpack_strlen_t = 0,
    /// the offset for value in the buffer
    val_offset: lsxpack_strlen_t = 0,
    /// the length of value
    val_len: lsxpack_strlen_t = 0,
    /// mainly for cookie value chain
    chain_next_idx: __uint16_t = 0,
    /// HPACK static table index
    hpack_index: __uint8_t = 0,
    /// QPACK static table index
    qpack_index: __uint8_t = 0,
    /// APP header index
    app_index: __uint8_t = 0,
    /// combination of lsxpack_flag
    flags: u8 = 0,
    /// control to disable index or not
    indexed_type: __uint8_t = 0,
    /// num of extra bytes written to decoded buffer
    dec_overhead: __uint8_t = 0,
};
pub const lsxpack_header_t = struct_lsxpack_header;

pub fn lsxpack_header_set_offset2(arg_hdr: *lsxpack_header_t, arg_buf: [*c]u8, arg_name_offset: usize, arg_name_len: usize, arg_val_offset: usize, arg_val_len: usize) callconv(.C) void {
    arg_hdr.* = .{};
    arg_hdr.buf = arg_buf;
    arg_hdr.name_offset = @truncate(arg_name_offset);
    arg_hdr.val_offset = @truncate(arg_val_offset);
    arg_hdr.name_len = @truncate(arg_name_len);
    arg_hdr.val_len = @truncate(arg_val_len);
}

pub fn lsxpack_header_prepare_decode(arg_hdr: *lsxpack_header_t, arg_out: [*c]u8, arg_offset: usize, arg_len: usize) callconv(.C) void {
    arg_hdr.* = .{};
    arg_hdr.buf = arg_out;
    arg_hdr.name_offset = @truncate(arg_offset);
    if (arg_len > LSXPACK_MAX_STRLEN) {
        arg_hdr.val_len = LSXPACK_MAX_STRLEN;
    } else {
        arg_hdr.val_len = @truncate(arg_len);
    }
}

pub fn lsxpack_header_get_name(hdr: *lsxpack_header_t) []const u8 {
    if (hdr.name_len != 0) return hdr.buf[hdr.name_offset .. hdr.name_offset + hdr.name_len];
    return "";
}
pub fn lsxpack_header_get_value(hdr: *lsxpack_header_t) []const u8 {
    if (hdr.val_len != 0) return hdr.buf[hdr.val_offset .. hdr.val_offset + hdr.val_len];
    return "";
}
pub fn lsxpack_header_get_dec_size(arg_hdr: ?*const lsxpack_header_t) callconv(.C) usize {
    var hdr = arg_hdr;
    return @as(usize, @bitCast(@as(c_long, (@as(c_int, @bitCast(@as(c_uint, hdr.*.name_len))) + @as(c_int, @bitCast(@as(c_uint, hdr.*.val_len)))) + @as(c_int, @bitCast(@as(c_uint, hdr.*.dec_overhead))))));
}
pub fn lsxpack_header_mark_val_changed(arg_hdr: ?*lsxpack_header_t) callconv(.C) void {
    var hdr = arg_hdr;
    hdr.*.flags = @as(c_uint, @bitCast(@as(c_int, @bitCast(hdr.*.flags)) & ~((LSXPACK_HPACK_VAL_MATCHED | LSXPACK_VAL_MATCHED) | LSXPACK_NAMEVAL_HASH)));
}
pub const struct_lshpack_enc_table_entry = opaque {};
pub const struct_lshpack_enc_head = extern struct {
    stqh_first: ?*struct_lshpack_enc_table_entry,
    stqh_last: [*c]?*struct_lshpack_enc_table_entry,
};
pub const struct_lshpack_double_enc_head = opaque {};
pub const LSHPACK_ENC_USE_HIST: c_int = 1;
const enum_unnamed_1 = c_uint;
pub const struct_lshpack_enc = extern struct {
    hpe_cur_capacity: c_uint,
    hpe_max_capacity: c_uint,
    hpe_next_id: c_uint,
    hpe_nelem: c_uint,
    hpe_nbits: c_uint,
    hpe_all_entries: struct_lshpack_enc_head,
    hpe_buckets: ?*struct_lshpack_double_enc_head,
    hpe_hist_buf: [*c]u32,
    hpe_hist_size: c_uint,
    hpe_hist_idx: c_uint,
    hpe_hist_wrapped: c_int,
    hpe_flags: enum_unnamed_1,
};
pub const struct_lshpack_arr = extern struct {
    nalloc: c_uint,
    nelem: c_uint,
    off: c_uint,
    els: [*c]usize,
};
pub const struct_lshpack_dec = extern struct {
    hpd_dyn_table: struct_lshpack_arr,
    hpd_max_capacity: c_uint,
    hpd_cur_max_capacity: c_uint,
    hpd_cur_capacity: c_uint,
    hpd_state: c_uint,
};
pub const LSHPACK_HDR_UNKNOWN: c_int = 0;
pub const LSHPACK_HDR_AUTHORITY: c_int = 1;
pub const LSHPACK_HDR_METHOD_GET: c_int = 2;
pub const LSHPACK_HDR_METHOD_POST: c_int = 3;
pub const LSHPACK_HDR_PATH: c_int = 4;
pub const LSHPACK_HDR_PATH_INDEX_HTML: c_int = 5;
pub const LSHPACK_HDR_SCHEME_HTTP: c_int = 6;
pub const LSHPACK_HDR_SCHEME_HTTPS: c_int = 7;
pub const LSHPACK_HDR_STATUS_200: c_int = 8;
pub const LSHPACK_HDR_STATUS_204: c_int = 9;
pub const LSHPACK_HDR_STATUS_206: c_int = 10;
pub const LSHPACK_HDR_STATUS_304: c_int = 11;
pub const LSHPACK_HDR_STATUS_400: c_int = 12;
pub const LSHPACK_HDR_STATUS_404: c_int = 13;
pub const LSHPACK_HDR_STATUS_500: c_int = 14;
pub const LSHPACK_HDR_ACCEPT_CHARSET: c_int = 15;
pub const LSHPACK_HDR_ACCEPT_ENCODING: c_int = 16;
pub const LSHPACK_HDR_ACCEPT_LANGUAGE: c_int = 17;
pub const LSHPACK_HDR_ACCEPT_RANGES: c_int = 18;
pub const LSHPACK_HDR_ACCEPT: c_int = 19;
pub const LSHPACK_HDR_ACCESS_CONTROL_ALLOW_ORIGIN: c_int = 20;
pub const LSHPACK_HDR_AGE: c_int = 21;
pub const LSHPACK_HDR_ALLOW: c_int = 22;
pub const LSHPACK_HDR_AUTHORIZATION: c_int = 23;
pub const LSHPACK_HDR_CACHE_CONTROL: c_int = 24;
pub const LSHPACK_HDR_CONTENT_DISPOSITION: c_int = 25;
pub const LSHPACK_HDR_CONTENT_ENCODING: c_int = 26;
pub const LSHPACK_HDR_CONTENT_LANGUAGE: c_int = 27;
pub const LSHPACK_HDR_CONTENT_LENGTH: c_int = 28;
pub const LSHPACK_HDR_CONTENT_LOCATION: c_int = 29;
pub const LSHPACK_HDR_CONTENT_RANGE: c_int = 30;
pub const LSHPACK_HDR_CONTENT_TYPE: c_int = 31;
pub const LSHPACK_HDR_COOKIE: c_int = 32;
pub const LSHPACK_HDR_DATE: c_int = 33;
pub const LSHPACK_HDR_ETAG: c_int = 34;
pub const LSHPACK_HDR_EXPECT: c_int = 35;
pub const LSHPACK_HDR_EXPIRES: c_int = 36;
pub const LSHPACK_HDR_FROM: c_int = 37;
pub const LSHPACK_HDR_HOST: c_int = 38;
pub const LSHPACK_HDR_IF_MATCH: c_int = 39;
pub const LSHPACK_HDR_IF_MODIFIED_SINCE: c_int = 40;
pub const LSHPACK_HDR_IF_NONE_MATCH: c_int = 41;
pub const LSHPACK_HDR_IF_RANGE: c_int = 42;
pub const LSHPACK_HDR_IF_UNMODIFIED_SINCE: c_int = 43;
pub const LSHPACK_HDR_LAST_MODIFIED: c_int = 44;
pub const LSHPACK_HDR_LINK: c_int = 45;
pub const LSHPACK_HDR_LOCATION: c_int = 46;
pub const LSHPACK_HDR_MAX_FORWARDS: c_int = 47;
pub const LSHPACK_HDR_PROXY_AUTHENTICATE: c_int = 48;
pub const LSHPACK_HDR_PROXY_AUTHORIZATION: c_int = 49;
pub const LSHPACK_HDR_RANGE: c_int = 50;
pub const LSHPACK_HDR_REFERER: c_int = 51;
pub const LSHPACK_HDR_REFRESH: c_int = 52;
pub const LSHPACK_HDR_RETRY_AFTER: c_int = 53;
pub const LSHPACK_HDR_SERVER: c_int = 54;
pub const LSHPACK_HDR_SET_COOKIE: c_int = 55;
pub const LSHPACK_HDR_STRICT_TRANSPORT_SECURITY: c_int = 56;
pub const LSHPACK_HDR_TRANSFER_ENCODING: c_int = 57;
pub const LSHPACK_HDR_USER_AGENT: c_int = 58;
pub const LSHPACK_HDR_VARY: c_int = 59;
pub const LSHPACK_HDR_VIA: c_int = 60;
pub const LSHPACK_HDR_WWW_AUTHENTICATE: c_int = 61;
pub const LSHPACK_HDR_TOBE_INDEXED: c_int = 255;
pub const enum_lshpack_static_hdr_idx = c_uint;
pub extern fn lshpack_enc_init([*c]struct_lshpack_enc) c_int;
pub extern fn lshpack_enc_cleanup([*c]struct_lshpack_enc) void;
pub extern fn lshpack_enc_encode(henc: [*c]struct_lshpack_enc, dst: [*c]const u8, dst_end: [*c]u8, input: ?*struct_lsxpack_header) [*c]u8;
pub extern fn lshpack_enc_set_max_capacity([*c]struct_lshpack_enc, c_uint) void;
pub extern fn lshpack_enc_use_hist([*c]struct_lshpack_enc, on: c_int) c_int;
pub extern fn lshpack_enc_hist_used([*c]const struct_lshpack_enc) c_int;
pub extern fn lshpack_dec_init([*c]struct_lshpack_dec) void;
pub extern fn lshpack_dec_cleanup([*c]struct_lshpack_dec) void;
pub extern fn lshpack_dec_decode(dec: [*c]struct_lshpack_dec, src: *[*]const u8, src_end: [*c]const u8, output: ?*struct_lsxpack_header) c_int;
pub extern fn lshpack_dec_set_max_capacity([*c]struct_lshpack_dec, c_uint) void;
pub extern fn lshpack_enc_get_stx_tab_id(?*struct_lsxpack_header) c_uint;

pub const __INT64_C = @import("std").zig.c_translation.Macros.L_SUFFIX;
pub const __UINT64_C = @import("std").zig.c_translation.Macros.UL_SUFFIX;
pub const INT8_MIN = -@as(c_int, 128);
pub const INT16_MIN = -@as(c_int, 32767) - @as(c_int, 1);
pub const INT32_MIN = -@import("std").zig.c_translation.promoteIntLiteral(c_int, 2147483647, .decimal) - @as(c_int, 1);
pub const INT64_MIN = -__INT64_C(@import("std").zig.c_translation.promoteIntLiteral(c_int, 9223372036854775807, .decimal)) - @as(c_int, 1);
pub const INT8_MAX = @as(c_int, 127);
pub const INT16_MAX = @as(c_int, 32767);
pub const INT32_MAX = @import("std").zig.c_translation.promoteIntLiteral(c_int, 2147483647, .decimal);
pub const INT64_MAX = __INT64_C(@import("std").zig.c_translation.promoteIntLiteral(c_int, 9223372036854775807, .decimal));
pub const UINT8_MAX = @as(c_int, 255);
pub const UINT16_MAX = @import("std").zig.c_translation.promoteIntLiteral(c_int, 65535, .decimal);
pub const UINT32_MAX = @import("std").zig.c_translation.promoteIntLiteral(c_uint, 4294967295, .decimal);
pub const UINT64_MAX = __UINT64_C(@import("std").zig.c_translation.promoteIntLiteral(c_int, 18446744073709551615, .decimal));
pub const INT_LEAST8_MIN = -@as(c_int, 128);
pub const INT_LEAST16_MIN = -@as(c_int, 32767) - @as(c_int, 1);
pub const INT_LEAST32_MIN = -@import("std").zig.c_translation.promoteIntLiteral(c_int, 2147483647, .decimal) - @as(c_int, 1);
pub const INT_LEAST64_MIN = -__INT64_C(@import("std").zig.c_translation.promoteIntLiteral(c_int, 9223372036854775807, .decimal)) - @as(c_int, 1);
pub const INT_LEAST8_MAX = @as(c_int, 127);
pub const INT_LEAST16_MAX = @as(c_int, 32767);
pub const INT_LEAST32_MAX = @import("std").zig.c_translation.promoteIntLiteral(c_int, 2147483647, .decimal);
pub const INT_LEAST64_MAX = __INT64_C(@import("std").zig.c_translation.promoteIntLiteral(c_int, 9223372036854775807, .decimal));
pub const UINT_LEAST8_MAX = @as(c_int, 255);
pub const UINT_LEAST16_MAX = @import("std").zig.c_translation.promoteIntLiteral(c_int, 65535, .decimal);
pub const UINT_LEAST32_MAX = @import("std").zig.c_translation.promoteIntLiteral(c_uint, 4294967295, .decimal);
pub const UINT_LEAST64_MAX = __UINT64_C(@import("std").zig.c_translation.promoteIntLiteral(c_int, 18446744073709551615, .decimal));
pub const INT_FAST8_MIN = -@as(c_int, 128);
pub const INT_FAST16_MIN = -@import("std").zig.c_translation.promoteIntLiteral(c_long, 9223372036854775807, .decimal) - @as(c_int, 1);
pub const INT_FAST32_MIN = -@import("std").zig.c_translation.promoteIntLiteral(c_long, 9223372036854775807, .decimal) - @as(c_int, 1);
pub const INT_FAST64_MIN = -__INT64_C(@import("std").zig.c_translation.promoteIntLiteral(c_int, 9223372036854775807, .decimal)) - @as(c_int, 1);
pub const INT_FAST8_MAX = @as(c_int, 127);
pub const INT_FAST16_MAX = @import("std").zig.c_translation.promoteIntLiteral(c_long, 9223372036854775807, .decimal);
pub const INT_FAST32_MAX = @import("std").zig.c_translation.promoteIntLiteral(c_long, 9223372036854775807, .decimal);
pub const INT_FAST64_MAX = __INT64_C(@import("std").zig.c_translation.promoteIntLiteral(c_int, 9223372036854775807, .decimal));
pub const UINT_FAST8_MAX = @as(c_int, 255);
pub const UINT_FAST16_MAX = @import("std").zig.c_translation.promoteIntLiteral(c_ulong, 18446744073709551615, .decimal);
pub const UINT_FAST32_MAX = @import("std").zig.c_translation.promoteIntLiteral(c_ulong, 18446744073709551615, .decimal);
pub const UINT_FAST64_MAX = __UINT64_C(@import("std").zig.c_translation.promoteIntLiteral(c_int, 18446744073709551615, .decimal));
pub const INTPTR_MIN = -@import("std").zig.c_translation.promoteIntLiteral(c_long, 9223372036854775807, .decimal) - @as(c_int, 1);
pub const INTPTR_MAX = @import("std").zig.c_translation.promoteIntLiteral(c_long, 9223372036854775807, .decimal);
pub const UINTPTR_MAX = @import("std").zig.c_translation.promoteIntLiteral(c_ulong, 18446744073709551615, .decimal);
pub const INTMAX_MIN = -__INT64_C(@import("std").zig.c_translation.promoteIntLiteral(c_int, 9223372036854775807, .decimal)) - @as(c_int, 1);
pub const INTMAX_MAX = __INT64_C(@import("std").zig.c_translation.promoteIntLiteral(c_int, 9223372036854775807, .decimal));
pub const UINTMAX_MAX = __UINT64_C(@import("std").zig.c_translation.promoteIntLiteral(c_int, 18446744073709551615, .decimal));
pub const PTRDIFF_MIN = -@import("std").zig.c_translation.promoteIntLiteral(c_long, 9223372036854775807, .decimal) - @as(c_int, 1);
pub const PTRDIFF_MAX = @import("std").zig.c_translation.promoteIntLiteral(c_long, 9223372036854775807, .decimal);
pub const SIG_ATOMIC_MIN = -@import("std").zig.c_translation.promoteIntLiteral(c_int, 2147483647, .decimal) - @as(c_int, 1);
pub const SIG_ATOMIC_MAX = @import("std").zig.c_translation.promoteIntLiteral(c_int, 2147483647, .decimal);
pub const SIZE_MAX = @import("std").zig.c_translation.promoteIntLiteral(c_ulong, 18446744073709551615, .decimal);
pub const WINT_MIN = @as(c_uint, 0);
pub const WINT_MAX = @import("std").zig.c_translation.promoteIntLiteral(c_uint, 4294967295, .decimal);
pub inline fn INT8_C(c: anytype) @TypeOf(c) {
    return c;
}
pub inline fn INT16_C(c: anytype) @TypeOf(c) {
    return c;
}
pub inline fn INT32_C(c: anytype) @TypeOf(c) {
    return c;
}
pub const INT64_C = @import("std").zig.c_translation.Macros.L_SUFFIX;
pub inline fn UINT8_C(c: anytype) @TypeOf(c) {
    return c;
}
pub inline fn UINT16_C(c: anytype) @TypeOf(c) {
    return c;
}
pub const UINT32_C = @import("std").zig.c_translation.Macros.U_SUFFIX;
pub const UINT64_C = @import("std").zig.c_translation.Macros.UL_SUFFIX;
pub const INTMAX_C = @import("std").zig.c_translation.Macros.L_SUFFIX;
pub const UINTMAX_C = @import("std").zig.c_translation.Macros.UL_SUFFIX;
pub const LSXPACK_HEADER_H_v206 = "";
pub const _ASSERT_H = @as(c_int, 1);
pub const _ASSERT_H_DECLS = "";
pub const _STRING_H = @as(c_int, 1);
pub const __need_size_t = "";
pub const __need_NULL = "";
pub const _SIZE_T = "";
pub const NULL = @import("std").zig.c_translation.cast(?*anyopaque, @as(c_int, 0));
pub const _BITS_TYPES_LOCALE_T_H = @as(c_int, 1);
pub const _BITS_TYPES___LOCALE_T_H = @as(c_int, 1);
pub const _STRINGS_H = @as(c_int, 1);
pub const LSXPACK_MAX_STRLEN = UINT16_MAX;
pub const LSXPACK_DEL = @import("std").zig.c_translation.cast([*c]u8, NULL);
pub const LSHPACK_MAJOR_VERSION = @as(c_int, 2);
pub const LSHPACK_MINOR_VERSION = @as(c_int, 3);
pub const LSHPACK_PATCH_VERSION = @as(c_int, 0);
pub const lshpack_strlen_t = lsxpack_strlen_t;
pub const LSHPACK_MAX_STRLEN = LSXPACK_MAX_STRLEN;
pub const LSHPACK_DEC_HTTP1X_OUTPUT = @as(c_int, 1);
pub const LSHPACK_DEC_CALC_HASH = @as(c_int, 1);
pub const LSHPACK_MAX_INDEX = @as(c_int, 61);
pub const LSHPACK_ERR_MORE_BUF = -@as(c_int, 3);
pub const LSHPACK_ERR_TOO_LARGE = -@as(c_int, 2);
pub const LSHPACK_ERR_BAD_DATA = -@as(c_int, 1);
pub const LSHPACK_OK = @as(c_int, 0);
pub const LSHPACK_DEC_HTTP1X_EXTRA = @as(c_int, 2);
pub inline fn lshpack_dec_extra_bytes(dec_: anytype) @TypeOf(@as(c_int, 4)) {
    _ = @TypeOf(dec_);
    return @as(c_int, 4);
}
pub const lsxpack_flag = enum_lsxpack_flag;
pub const lsxpack_header = struct_lsxpack_header;
pub const lshpack_enc_table_entry = struct_lshpack_enc_table_entry;
pub const lshpack_enc_head = struct_lshpack_enc_head;
pub const lshpack_double_enc_head = struct_lshpack_double_enc_head;
pub const lshpack_enc = struct_lshpack_enc;
pub const lshpack_arr = struct_lshpack_arr;
pub const lshpack_dec = struct_lshpack_dec;
pub const lshpack_static_hdr_idx = enum_lshpack_static_hdr_idx;
