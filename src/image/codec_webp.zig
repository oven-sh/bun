//! libwebp decode/encode for `Bun.Image`.
//! Dispatch lives in codecs.zig; this file is the codec body.

pub extern fn WebPGetInfo(data: [*]const u8, len: usize, w: *c_int, h: *c_int) c_int;
extern fn WebPDecodeRGBA(data: [*]const u8, len: usize, w: *c_int, h: *c_int) ?[*]u8;
extern fn WebPEncodeRGBA(rgba: [*]const u8, w: c_int, h: c_int, stride: c_int, q: f32, out: *?[*]u8) usize;
extern fn WebPEncodeLosslessRGBA(rgba: [*]const u8, w: c_int, h: c_int, stride: c_int, out: *?[*]u8) usize;
pub extern fn WebPFree(ptr: ?*anyopaque) void;

pub fn decode(bytes: []const u8, max_pixels: u64) codecs.Error!codecs.Decoded {
    var cw: c_int = 0;
    var ch: c_int = 0;
    // Header-only probe first so the pixel guard fires before libwebp
    // allocates the full canvas internally. WebPGetInfo can hand back
    // non-positive on a malformed header; reject before @intCast traps.
    if (WebPGetInfo(bytes.ptr, bytes.len, &cw, &ch) == 0 or cw <= 0 or ch <= 0)
        return error.DecodeFailed;
    const w: u32 = @intCast(cw);
    const h: u32 = @intCast(ch);
    try codecs.guard(w, h, max_pixels);
    const ptr = WebPDecodeRGBA(bytes.ptr, bytes.len, &cw, &ch) orelse return error.DecodeFailed;
    defer WebPFree(ptr);
    // `bytes` is a borrowed view of a JS ArrayBuffer the user can still WRITE
    // (the pin only blocks detach), so a hostile caller can swap in a smaller
    // WebP between WebPGetInfo and WebPDecodeRGBA. libwebp re-parses on the
    // second call and writes the actual decoded dims back into cw/ch — reject
    // any mismatch instead of trusting the probe and over-reading the
    // smaller allocation. (Same race the CG shim guards at :298.)
    if (cw != w or ch != h) return error.DecodeFailed;
    const len: usize = @as(usize, w) * h * 4;
    const out = try bun.default_allocator.dupe(u8, ptr[0..len]);
    return .{ .rgba = out, .width = w, .height = h };
}

pub fn encode(rgba: []const u8, w: u32, h: u32, quality: u8, lossless: bool) codecs.Error!codecs.Encoded {
    var out: ?[*]u8 = null;
    const stride: c_int = @intCast(w * 4);
    const len = if (lossless)
        WebPEncodeLosslessRGBA(rgba.ptr, @intCast(w), @intCast(h), stride, &out)
    else
        WebPEncodeRGBA(rgba.ptr, @intCast(w), @intCast(h), stride, @floatFromInt(quality), &out);
    if (len == 0 or out == null) return error.EncodeFailed;
    return .{ .bytes = out.?[0..len], .free = codecs.Encoded.wrap(WebPFree) };
}

const bun = @import("bun");
const codecs = @import("./codecs.zig");
