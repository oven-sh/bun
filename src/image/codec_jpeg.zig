//! libjpeg-turbo (TurboJPEG 3 API) decode/encode for `Bun.Image`.
//! Dispatch lives in codecs.zig; this file is the codec body.

const tjhandle = ?*anyopaque;
// TJINIT_COMPRESS=0, TJINIT_DECOMPRESS=1.
pub extern fn tj3Init(init_type: c_int) tjhandle;
pub extern fn tj3Destroy(h: tjhandle) void;
extern fn tj3Set(h: tjhandle, param: c_int, value: c_int) c_int;
pub extern fn tj3Get(h: tjhandle, param: c_int) c_int;
pub extern fn tj3DecompressHeader(h: tjhandle, buf: [*]const u8, len: usize) c_int;
extern fn tj3Decompress8(h: tjhandle, buf: [*]const u8, len: usize, dst: [*]u8, pitch: c_int, pf: c_int) c_int;
extern fn tj3Compress8(h: tjhandle, src: [*]const u8, w: c_int, pitch: c_int, height: c_int, pf: c_int, out: *?[*]u8, out_len: *usize) c_int;
extern fn tj3SetScalingFactor(h: tjhandle, sf: ScalingFactor) c_int;
extern fn tj3SetCroppingRegion(h: tjhandle, r: CropRegion) c_int;
extern fn tj3GetScalingFactors(n: *c_int) ?[*]const ScalingFactor;
pub extern fn tj3Free(ptr: ?*anyopaque) void;
extern fn tj3GetErrorStr(h: tjhandle) [*:0]const u8;

const ScalingFactor = extern struct { num: c_int, denom: c_int };
const CropRegion = extern struct { x: c_int, y: c_int, w: c_int, h: c_int };
/// TJSCALED: ceil(dim * num / denom).
inline fn scaled(dim: u32, sf: ScalingFactor) u32 {
    return @intCast(@divFloor(@as(i64, dim) * sf.num + sf.denom - 1, sf.denom));
}

// tjparam / tjpf enum values from turbojpeg.h.
const TJPARAM_QUALITY = 3;
const TJPARAM_SUBSAMP = 4;
pub const TJPARAM_JPEGWIDTH = 5;
pub const TJPARAM_JPEGHEIGHT = 6;
const TJPARAM_PROGRESSIVE = 12;
const TJPARAM_MAXPIXELS = 24;
const TJPF_RGBA = 7;
const TJSAMP_420 = 2;

pub fn decode(bytes: []const u8, max_pixels: u64, hint: codecs.DecodeHint) codecs.Error!codecs.Decoded {
    const h = tj3Init(1) orelse return error.OutOfMemory;
    defer tj3Destroy(h);
    if (tj3DecompressHeader(h, bytes.ptr, bytes.len) != 0) return error.DecodeFailed;
    const rw = tj3Get(h, TJPARAM_JPEGWIDTH);
    const rh = tj3Get(h, TJPARAM_JPEGHEIGHT);
    // tj3Get returns -1 on error; treat any non-positive dim as a decode
    // failure rather than letting @intCast trap on hostile input.
    if (rw <= 0 or rh <= 0) return error.DecodeFailed;
    const src_w: u32 = @intCast(rw);
    const src_h: u32 = @intCast(rh);
    try codecs.guard(src_w, src_h, max_pixels);

    var w = src_w;
    var ht = src_h;
    // DCT-domain scaling: if the pipeline will downscale, ask libjpeg-turbo
    // for the smallest M/8 IDCT that still ≥ target. The IDCT is where the
    // decode time goes, so this is roughly (8/M)² faster AND the RGBA
    // buffer shrinks by the same factor — both speed and RSS win in one
    // place. The subsequent resize pass takes it the rest of the way.
    if (hint.target_w != 0 and hint.target_h != 0 and
        (hint.target_w < src_w or hint.target_h < src_h))
    {
        var n: c_int = 0;
        if (tj3GetScalingFactors(&n)) |sfs| {
            var best: ScalingFactor = .{ .num = 1, .denom = 1 };
            for (sfs[0..@intCast(n)]) |sf| {
                // Only consider downscale factors.
                if (sf.num >= sf.denom) continue;
                const sw = scaled(src_w, sf);
                const sh = scaled(src_h, sf);
                // Never go BELOW target — that would force upscale and
                // throw away detail the user asked for.
                if (sw < hint.target_w or sh < hint.target_h) continue;
                // Pick the smallest output (= largest reduction).
                if (@as(u64, sw) * sh < @as(u64, scaled(src_w, best)) * scaled(src_h, best))
                    best = sf;
            }
            if (best.num != best.denom) {
                _ = tj3SetScalingFactor(h, best);
                w = scaled(src_w, best);
                ht = scaled(src_h, best);
            }
        }
    }

    // `bytes` may alias a JS ArrayBuffer; the contract is "don't mutate while
    // a terminal is pending" (SharedArrayBuffer is refused at construction),
    // so the honest path costs nothing. Hardening here is so a hostile
    // mid-decode swap degrades to DecodeFailed, not OOB/heap-leak:
    // tj3DecompressHeader ends with `jpeg_abort_decompress`, so
    // tj3Decompress8 re-runs `jpeg_read_header` and derives row count /
    // stride from a fresh parse. Bound the WRITE REGION to OUR alloc with
    //   • TJPARAM_MAXPIXELS — second-parse w'·h' > w·h fails before output
    //     (turbojpeg-mp.c:183)
    //   • explicit pitch — stride can't grow with w'
    //   • croppingRegion {0,0,w,ht} — `croppedHeight = ht` regardless of h'
    //     (turbojpeg-mp.c:222), so an aspect-swap (4096×1→1×4096) that
    //     passes the product check still can't write more rows than fit
    // and post-check the second-parse dims so a smaller swap (which would
    // leave rows unfilled with raw mimalloc bytes) is treated as corrupt.
    _ = tj3Set(h, TJPARAM_MAXPIXELS, std.math.cast(c_int, src_w * src_h) orelse std.math.maxInt(c_int));
    _ = tj3SetCroppingRegion(h, .{ .x = 0, .y = 0, .w = @intCast(w), .h = @intCast(ht) });
    const out = try bun.default_allocator.alloc(u8, @as(usize, w) * ht * 4);
    errdefer bun.default_allocator.free(out);
    if (tj3Decompress8(h, bytes.ptr, bytes.len, out.ptr, @intCast(w * 4), TJPF_RGBA) != 0)
        return error.DecodeFailed;
    if (tj3Get(h, TJPARAM_JPEGWIDTH) != rw or tj3Get(h, TJPARAM_JPEGHEIGHT) != rh)
        return error.DecodeFailed;
    return .{ .rgba = out, .width = w, .height = ht };
}

pub fn encode(rgba: []const u8, w: u32, ht: u32, quality: u8, progressive: bool) codecs.Error!codecs.Encoded {
    const h = tj3Init(0) orelse return error.OutOfMemory;
    defer tj3Destroy(h);
    _ = tj3Set(h, TJPARAM_QUALITY, @intCast(@min(@max(quality, 1), 100)));
    _ = tj3Set(h, TJPARAM_SUBSAMP, TJSAMP_420);
    // Progressive emits a multi-scan SOF2 stream; same size ±1%, decodes
    // coarse-to-fine. Off by default (slower to encode, some old decoders
    // mishandle it).
    if (progressive) _ = tj3Set(h, TJPARAM_PROGRESSIVE, 1);
    var out_ptr: ?[*]u8 = null;
    var out_len: usize = 0;
    if (tj3Compress8(h, rgba.ptr, @intCast(w), 0, @intCast(ht), TJPF_RGBA, &out_ptr, &out_len) != 0) {
        // tj3Compress8 may have allocated (or grown) `out_ptr` before
        // failing mid-stream; the docs say the caller owns it on any return.
        if (out_ptr) |p| tj3Free(p);
        return error.EncodeFailed;
    }
    // tj3Compress8 allocates via libjpeg-turbo's allocator; hand it to JS
    // with `tj3Free` as the finalizer instead of duping.
    return .{ .bytes = out_ptr.?[0..out_len], .free = codecs.Encoded.wrap(tj3Free) };
}

const bun = @import("bun");
const codecs = @import("./codecs.zig");
const std = @import("std");
