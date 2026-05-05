//! AVIF decode + encode for `Bun.Image` on Linux, via libavif + libdav1d (and
//! whichever AV1 encoder the distro bundled — typically aom, rav1e, and/or
//! SVT-AV1) loaded at runtime. Dispatch lives in codecs.zig; this file is a
//! thin Zig-side wrapper over `image_avif_shim.cpp` — the shim does the
//! dlopen, holds the dlsym table, and speaks libavif's ABI. If libavif isn't
//! installed the shim returns `AVIF_UNAVAILABLE` and we surface
//! `error.UnsupportedOnPlatform` (same contract as a mac/win system-backend
//! miss); if libavif is present but has no registered encoder (rare — an
//! explicit decode-only build), encode fails as `EncodeFailed`.
//!
//! macOS and Windows continue to use the OS codec (ImageIO/WIC) via
//! `backend_*` — see `codecs.zig`'s dispatch for how the two paths combine.

const AVIF_OK: i32 = 0;
const AVIF_UNAVAILABLE: i32 = 1;
const AVIF_DECODE_FAILED: i32 = 2;
const AVIF_ENCODE_FAILED: i32 = 3;
const AVIF_TOO_MANY_PIXELS: i32 = 4;

// `bun_avif_*` live in src/jsc/bindings/image_avif_shim.cpp. Return codes:
//   0                    → success
//   AVIF_UNAVAILABLE     → libavif.so.16 not installed or dlsym missed a
//                          required symbol; surface UnsupportedOnPlatform
//                          (same as a mac/win system-backend miss).
//   AVIF_DECODE_FAILED   → libavif's own decode error; surface DecodeFailed.
//   AVIF_ENCODE_FAILED   → libavif's own encode error (also used for "no
//                          codec registered"); surface EncodeFailed.
//   AVIF_TOO_MANY_PIXELS → the shim's pre-decode pixel guard fired; map to
//                          TooManyPixels so callers get the same error code
//                          jpeg/png/webp produce.
extern fn bun_avif_probe(bytes: [*]const u8, len: usize, max_pixels: u64, out_w: *u32, out_h: *u32) i32;
extern fn bun_avif_decode(
    bytes: [*]const u8,
    len: usize,
    max_pixels: u64,
    out_w: *u32,
    out_h: *u32,
    out: ?[*]u8,
    out_icc_ptr: *?[*]u8,
    out_icc_size: *usize,
) i32;
extern fn bun_avif_encode(
    rgba: [*]const u8,
    w: u32,
    h: u32,
    quality: c_int,
    icc: ?[*]const u8,
    icc_size: usize,
    out_data: *?[*]u8,
    out_size: *usize,
) i32;
extern fn bun_avif_free_output(data: ?*anyopaque) void;
// ICC profile buffer handed back by bun_avif_decode is plain malloc'd —
// free() via the C runtime (same lib we dlopen'd libavif against).
extern "c" fn free(ptr: ?*anyopaque) void;

fn mapDecodeErr(rc: i32) codecs.Error {
    return switch (rc) {
        AVIF_UNAVAILABLE => error.UnsupportedOnPlatform,
        AVIF_TOO_MANY_PIXELS => error.TooManyPixels,
        else => error.DecodeFailed,
    };
}

fn mapEncodeErr(rc: i32) codecs.Error {
    return switch (rc) {
        AVIF_UNAVAILABLE => error.UnsupportedOnPlatform,
        else => error.EncodeFailed,
    };
}

pub fn decode(bytes: []const u8, max_pixels: u64) codecs.Error!codecs.Decoded {
    // Two-phase so the output buffer can live in bun.default_allocator
    // (matches jpeg/png/webp ownership contract): phase 1 runs
    // `avifDecoderParse` and returns dims; phase 2 runs the AV1 decode and
    // fills the caller-provided buffer. The shim re-opens the decoder
    // between phases, which is cheap relative to the AV1 decode itself.
    var w: u32 = 0;
    var h: u32 = 0;
    var icc_ptr: ?[*]u8 = null;
    var icc_size: usize = 0;
    switch (bun_avif_decode(bytes.ptr, bytes.len, max_pixels, &w, &h, null, &icc_ptr, &icc_size)) {
        AVIF_OK => {},
        else => |rc| return mapDecodeErr(rc),
    }
    if (w == 0 or h == 0) return error.DecodeFailed;

    const out = try bun.default_allocator.alloc(u8, @as(usize, w) * h * 4);
    errdefer bun.default_allocator.free(out);
    switch (bun_avif_decode(bytes.ptr, bytes.len, max_pixels, &w, &h, out.ptr, &icc_ptr, &icc_size)) {
        AVIF_OK => {},
        else => |rc| return mapDecodeErr(rc),
    }
    // Re-home the ICC profile out of the shim's `malloc`'d buffer into
    // `bun.default_allocator` so the pipeline can free it uniformly. If
    // the dupe OOMs we drop the profile and keep the pixels — jpeg/png do
    // the same (see #30197 rationale); an AVIF without ICC is still valid
    // (implicitly sRGB via CICP).
    const icc: ?[]u8 = blk: {
        if (icc_ptr == null or icc_size == 0) break :blk null;
        defer free(icc_ptr);
        const p = icc_ptr orelse break :blk null;
        break :blk bun.default_allocator.dupe(u8, p[0..icc_size]) catch break :blk null;
    };
    return .{ .rgba = out, .width = w, .height = h, .icc_profile = icc };
}

/// Header-only dimensions probe for `.metadata()`. libavif's parse() stops
/// before sample decode, so this reads the ispe box and returns — roughly
/// PNG-IHDR-cheap, not "full AV1 decode".
pub fn probe(bytes: []const u8, max_pixels: u64) codecs.Error!struct { width: u32, height: u32 } {
    var w: u32 = 0;
    var h: u32 = 0;
    switch (bun_avif_probe(bytes.ptr, bytes.len, max_pixels, &w, &h)) {
        AVIF_OK => {},
        else => |rc| return mapDecodeErr(rc),
    }
    if (w == 0 or h == 0) return error.DecodeFailed;
    return .{ .width = w, .height = h };
}

pub fn encode(rgba: []const u8, w: u32, h: u32, quality: u8, icc_profile: ?[]const u8) codecs.Error!codecs.Encoded {
    // libavif's `quality` is 0-100 (AVIF_QUALITY_WORST .. AVIF_QUALITY_BEST),
    // matching our `EncodeOptions.quality` verbatim — no remap needed.
    // ICC bytes are attached via `avifImageSetProfileICC` inside the shim;
    // libavif copies into its own allocator, so our caller keeps the
    // borrow. See #30197 for why dropping the profile matters.
    var out: ?[*]u8 = null;
    var out_size: usize = 0;
    const icc_ptr: ?[*]const u8 = if (icc_profile) |p| if (p.len > 0) p.ptr else null else null;
    const icc_len: usize = if (icc_profile) |p| p.len else 0;
    switch (bun_avif_encode(rgba.ptr, w, h, @intCast(quality), icc_ptr, icc_len, &out, &out_size)) {
        AVIF_OK => {},
        else => |rc| return mapEncodeErr(rc),
    }
    if (out == null or out_size == 0) return error.EncodeFailed;
    // The shim owns the buffer via libavif's `avifRWData`. Hand the raw
    // pointer+size to JS via `Encoded`; deinit calls `avifRWDataFree`
    // (wrapped in `bun_avif_free_output`) — same zero-copy ownership model
    // as WebPFree / tj3Free.
    return .{
        .bytes = out.?[0..out_size],
        .free = codecs.Encoded.wrap(bun_avif_free_output),
    };
}

const bun = @import("bun");
const codecs = @import("./codecs.zig");
