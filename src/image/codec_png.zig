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
/// iCCP chunk read/write — PNG carries an optional ICC profile alongside
/// the pixels for every colour type (including indexed). `spng_get_iccp`
/// returns non-zero when the source has no iCCP (or the chunk was
/// malformed); we treat all non-zero returns the same way — drop the
/// profile — because the pixels are still valid and a PNG without iCCP
/// is still a valid PNG. The `profile` pointer it hands back is owned by
/// the context and freed with `spng_ctx_free`; dupe out before then.
extern fn spng_get_iccp(ctx: *spng_ctx, iccp: *Iccp) c_int;
extern fn spng_set_iccp(ctx: *spng_ctx, iccp: *const Iccp) c_int;

const Iccp = extern struct {
    /// PNG's Latin-1 iCCP keyword (1-79 chars + NUL). libspng requires it
    /// non-empty on encode; the PNG spec marks it purely informational
    /// (the profile bytes are what describe the colour space), so on
    /// encode we always write the literal `"ICC Profile"`. The source
    /// keyword is not threaded through `Decoded`.
    profile_name: [80]u8,
    profile_len: usize,
    profile: ?[*]u8,
};

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

    // iCCP after decode so the chunk has definitely been parsed. A non-zero
    // return here means "no iCCP" or "iCCP was malformed" — treat both as
    // the no-profile case; the pixels are still valid RGBA. `profile` is
    // context-owned memory, so copy it out before `spng_ctx_free` runs at
    // function exit. Propagate OutOfMemory on allocator failure rather
    // than silently degrading colour fidelity — the pixels may be Display
    // P3 / Adobe RGB / XYB, and a "no profile" result there is a visible
    // colour shift, which is the exact bug #30197 is about.
    var iccp: Iccp = std.mem.zeroes(Iccp);
    const icc: ?[]u8 = if (spng_get_iccp(ctx, &iccp) == 0 and iccp.profile_len > 0 and iccp.profile != null)
        try bun.default_allocator.dupe(u8, iccp.profile.?[0..iccp.profile_len])
    else
        null;
    return .{ .rgba = out, .width = ihdr.width, .height = ihdr.height, .icc_profile = icc };
}

/// Attach `icc_profile` to the encoder as an iCCP chunk. libspng requires
/// `profile_name` non-empty (1-79 Latin-1 chars + NUL) and will deflate the
/// profile payload into the chunk itself. The PNG spec marks the keyword as
/// purely informational, so we write the literal `"ICC Profile"` always —
/// the colour-meaning payload is `p`. A malformed-profile return from
/// libspng drops the profile rather than failing the encode; a PNG without
/// an iCCP is still valid (implicitly sRGB). Called from both truecolour
/// `encode()` and indexed `encodeIndexed()` — the PNG spec applies iCCP to
/// every colour type (indexed-colour palettes live in the source space
/// too, so dropping the profile there would silently reinterpret them as
/// sRGB, same bug #30197 was filed for).
fn embedIccp(ctx: *spng_ctx, icc_profile: ?[]const u8) void {
    const p = icc_profile orelse return;
    if (p.len == 0) return;
    var iccp: Iccp = .{
        .profile_name = @splat(0),
        .profile_len = p.len,
        // `profile` is `char*` in libspng; the library reads-only during
        // encode when `user.iccp = 1` (set by spng_set_iccp). Const-cast
        // to fit the extern-struct field type without duping.
        .profile = @constCast(p.ptr),
    };
    const name = "ICC Profile";
    @memcpy(iccp.profile_name[0..name.len], name);
    _ = spng_set_iccp(ctx, &iccp);
}

pub fn encode(rgba: []const u8, w: u32, h: u32, level: i8, icc_profile: ?[]const u8) codecs.Error!codecs.Encoded {
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
    embedIccp(ctx, icc_profile);
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
/// quantize.zig. `icc_profile` carries the source colour space; median
/// cut operates on the raw RGB numbers without converting colour spaces,
/// so the palette entries are still in that space and need the profile
/// to be interpreted correctly — same contract as truecolour encode.
pub fn encodeIndexed(rgba: []const u8, w: u32, h: u32, level: i8, colors: u16, dither: bool, icc_profile: ?[]const u8) codecs.Error!codecs.Encoded {
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
    embedIccp(ctx, icc_profile);

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
