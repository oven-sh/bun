//! libspng decode/encode for `Bun.Image`. Indexed-PNG encode quantises via
//! `quantize.zig`. Dispatch lives in codecs.zig; this file is the codec body.

const spng_ctx = opaque {};
extern fn spng_ctx_new(flags: c_int) ?*spng_ctx;
extern fn spng_ctx_free(ctx: *spng_ctx) void;
extern fn spng_set_png_buffer(ctx: *spng_ctx, buf: [*]const u8, len: usize) c_int;
extern fn spng_decoded_image_size(ctx: *spng_ctx, fmt: c_int, out: *usize) c_int;
extern fn spng_decode_image(ctx: *spng_ctx, out: [*]u8, len: usize, fmt: c_int, flags: c_int) c_int;
extern fn spng_get_ihdr(ctx: *spng_ctx, ihdr: *Ihdr) c_int;
extern fn spng_set_ihdr(ctx: *spng_ctx, ihdr: *const Ihdr) c_int;
extern fn spng_set_plte(ctx: *spng_ctx, plte: *const Plte) c_int;
extern fn spng_set_trns(ctx: *spng_ctx, trns: *const Trns) c_int;
extern fn spng_encode_image(ctx: *spng_ctx, img: [*]const u8, len: usize, fmt: c_int, flags: c_int) c_int;
extern fn spng_get_png_buffer(ctx: *spng_ctx, len: *usize, err: *c_int) ?[*]u8;
extern fn spng_set_option(ctx: *spng_ctx, opt: c_int, value: c_int) c_int;

const Ihdr = extern struct {
    width: u32,
    height: u32,
    bit_depth: u8,
    color_type: u8,
    compression_method: u8 = 0,
    filter_method: u8 = 0,
    interlace_method: u8 = 0,
};

const SPNG_CTX_ENCODER = 2;
const SPNG_FMT_RGBA8 = 1;
const SPNG_FMT_PNG = 256;
const SPNG_DECODE_TRNS = 1; // apply tRNS chunk so paletted/grey get real alpha
const SPNG_ENCODE_FINALIZE = 2;
// spng_option enum
const SPNG_IMG_COMPRESSION_LEVEL = 2;
const SPNG_ENCODE_TO_BUFFER = 12;
const SPNG_COLOR_TYPE_INDEXED = 3;
const SPNG_COLOR_TYPE_TRUECOLOR_ALPHA = 6;

const Plte = extern struct {
    n_entries: u32,
    entries: [256][4]u8, // r,g,b,alpha(reserved)
};
const Trns = extern struct {
    gray: u16 = 0,
    red: u16 = 0,
    green: u16 = 0,
    blue: u16 = 0,
    n_type3_entries: u32,
    type3_alpha: [256]u8,
};

pub fn decode(bytes: []const u8, max_pixels: u64) codecs.Error!codecs.Decoded {
    const ctx = spng_ctx_new(0) orelse return error.OutOfMemory;
    defer spng_ctx_free(ctx);
    if (spng_set_png_buffer(ctx, bytes.ptr, bytes.len) != 0) return error.DecodeFailed;
    var ihdr: Ihdr = undefined;
    if (spng_get_ihdr(ctx, &ihdr) != 0) return error.DecodeFailed;
    try codecs.guard(ihdr.width, ihdr.height, max_pixels);
    var size: usize = 0;
    if (spng_decoded_image_size(ctx, SPNG_FMT_RGBA8, &size) != 0) return error.DecodeFailed;
    const out = try bun.default_allocator.alloc(u8, size);
    errdefer bun.default_allocator.free(out);
    if (spng_decode_image(ctx, out.ptr, out.len, SPNG_FMT_RGBA8, SPNG_DECODE_TRNS) != 0)
        return error.DecodeFailed;
    return .{ .rgba = out, .width = ihdr.width, .height = ihdr.height };
}

pub fn encode(rgba: []const u8, w: u32, h: u32, level: i8) codecs.Error!codecs.Encoded {
    const ctx = spng_ctx_new(SPNG_CTX_ENCODER) orelse return error.OutOfMemory;
    defer spng_ctx_free(ctx);
    _ = spng_set_option(ctx, SPNG_ENCODE_TO_BUFFER, 1);
    if (level >= 0) _ = spng_set_option(ctx, SPNG_IMG_COMPRESSION_LEVEL, @min(level, 9));
    var ihdr: Ihdr = .{
        .width = w,
        .height = h,
        .bit_depth = 8,
        .color_type = SPNG_COLOR_TYPE_TRUECOLOR_ALPHA,
    };
    if (spng_set_ihdr(ctx, &ihdr) != 0) return error.EncodeFailed;
    if (spng_encode_image(ctx, rgba.ptr, rgba.len, SPNG_FMT_PNG, SPNG_ENCODE_FINALIZE) != 0)
        return error.EncodeFailed;
    var len: usize = 0;
    var err: c_int = 0;
    const buf = spng_get_png_buffer(ctx, &len, &err) orelse return error.EncodeFailed;
    // spng_get_png_buffer transfers ownership (libc malloc); hand to JS
    // with libc `free` as the finalizer instead of duping.
    return .{ .bytes = buf[0..len], .free = codecs.Encoded.wrap(std.c.free) };
}

/// Quantize RGBA to ≤ `colors` and emit an indexed (colour-type 3) PNG
/// with PLTE + tRNS. The quantizer is a small median-cut — see
/// quantize.zig.
pub fn encodeIndexed(rgba: []const u8, w: u32, h: u32, level: i8, colors: u16, dither: bool) codecs.Error!codecs.Encoded {
    var q = try quantize.quantize(rgba, w, h, .{ .max_colors = colors, .dither = dither });
    defer q.deinit();

    const ctx = spng_ctx_new(SPNG_CTX_ENCODER) orelse return error.OutOfMemory;
    defer spng_ctx_free(ctx);
    _ = spng_set_option(ctx, SPNG_ENCODE_TO_BUFFER, 1);
    if (level >= 0) _ = spng_set_option(ctx, SPNG_IMG_COMPRESSION_LEVEL, @min(level, 9));

    var ihdr: Ihdr = .{
        .width = w,
        .height = h,
        .bit_depth = 8,
        .color_type = SPNG_COLOR_TYPE_INDEXED,
    };
    if (spng_set_ihdr(ctx, &ihdr) != 0) return error.EncodeFailed;

    var plte: Plte = .{ .n_entries = q.colors, .entries = undefined };
    var trns: Trns = .{ .n_type3_entries = q.colors, .type3_alpha = undefined };
    for (0..q.colors) |i| {
        plte.entries[i] = .{ q.palette[i * 4], q.palette[i * 4 + 1], q.palette[i * 4 + 2], 255 };
        trns.type3_alpha[i] = q.palette[i * 4 + 3];
    }
    if (spng_set_plte(ctx, &plte) != 0) return error.EncodeFailed;
    if (q.has_alpha and spng_set_trns(ctx, &trns) != 0) return error.EncodeFailed;

    if (spng_encode_image(ctx, q.indices.ptr, q.indices.len, SPNG_FMT_PNG, SPNG_ENCODE_FINALIZE) != 0)
        return error.EncodeFailed;

    var len: usize = 0;
    var err: c_int = 0;
    const buf = spng_get_png_buffer(ctx, &len, &err) orelse return error.EncodeFailed;
    return .{ .bytes = buf[0..len], .free = codecs.Encoded.wrap(std.c.free) };
}

const bun = @import("bun");
const codecs = @import("./codecs.zig");
const quantize = @import("./quantize.zig");
const std = @import("std");
