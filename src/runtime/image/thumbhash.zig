//! ThumbHash — Evan Wallace's tiny LQIP encoding (public domain).
//! https://github.com/evanw/thumbhash
//!
//! ~21–25 bytes encode the low-order DCT coefficients of L/P/Q (luma + two
//! opponent-colour planes, optionally A) of a ≤100×100 image. Decoding gives a
//! ≤32px blur with the right average colour, aspect ratio and rough structure.
//!
//! `Bun.Image.placeholder()` runs `decode → box-resize ≤100 → encode()` →
//! `decode()` → PNG-encode → `data:` URL, all on the work pool. The hash
//! itself is exposed as the intermediate so a future `as: "hash"` option is
//! one switch away. The encode/decode are scalar f32 and tiny (≤100²·7² mults
//! at the absolute most); not worth a Highway kernel.

/// Maximum hash length: 5-byte header + (has_alpha ? 1 : 0) + ceil((L+P+Q+A
/// AC counts)/2). Worst case (has_alpha, square) is 5+1+ceil((14+5+5+14)/2)=25.
pub const max_len = 25;

pub fn encode(out: *[max_len]u8, w: u32, h: u32, rgba: []const u8) []u8 {
    bun.debugAssert(w > 0 and w <= 100 and h > 0 and h <= 100);
    bun.debugAssert(rgba.len == @as(usize, w) * h * 4);

    // Average colour (alpha-weighted so transparent pixels don't tug it).
    var avg: [4]f32 = .{0} ** 4;
    var i: usize = 0;
    while (i < rgba.len) : (i += 4) {
        const a: f32 = @as(f32, @floatFromInt(rgba[i + 3])) / 255.0;
        avg[0] += a / 255.0 * @as(f32, @floatFromInt(rgba[i + 0]));
        avg[1] += a / 255.0 * @as(f32, @floatFromInt(rgba[i + 1]));
        avg[2] += a / 255.0 * @as(f32, @floatFromInt(rgba[i + 2]));
        avg[3] += a;
    }
    if (avg[3] > 0) for (avg[0..3]) |*c| {
        c.* /= avg[3];
    };

    const npix: f32 = @floatFromInt(w * h);
    const has_alpha = avg[3] < npix;
    const l_limit: f32 = if (has_alpha) 5 else 7; // fewer luma bits if alpha
    const lx = @max(1, @as(u32, @intFromFloat(@round(l_limit * @as(f32, @floatFromInt(w)) / @as(f32, @floatFromInt(@max(w, h)))))));
    const ly = @max(1, @as(u32, @intFromFloat(@round(l_limit * @as(f32, @floatFromInt(h)) / @as(f32, @floatFromInt(@max(w, h)))))));

    // RGBA → LPQA, compositing transparent pixels onto the average so the DCT
    // doesn't see a black fringe.
    var l: [100 * 100]f32 = undefined;
    var p: [100 * 100]f32 = undefined;
    var q: [100 * 100]f32 = undefined;
    var a: [100 * 100]f32 = undefined;
    i = 0;
    var px: usize = 0;
    while (i < rgba.len) : ({
        i += 4;
        px += 1;
    }) {
        const al: f32 = @as(f32, @floatFromInt(rgba[i + 3])) / 255.0;
        const r = avg[0] * (1 - al) + al / 255.0 * @as(f32, @floatFromInt(rgba[i + 0]));
        const g = avg[1] * (1 - al) + al / 255.0 * @as(f32, @floatFromInt(rgba[i + 1]));
        const b = avg[2] * (1 - al) + al / 255.0 * @as(f32, @floatFromInt(rgba[i + 2]));
        l[px] = (r + g + b) / 3;
        p[px] = (r + g) / 2 - b;
        q[px] = r - g;
        a[px] = al;
    }

    var lc = dct(l[0..px], w, h, @max(lx, 3), @max(ly, 3));
    var pc = dct(p[0..px], w, h, 3, 3);
    var qc = dct(q[0..px], w, h, 3, 3);
    var ac = if (has_alpha) dct(a[0..px], w, h, 5, 5) else Channel{ .dc = 1, .scale = 1 };

    const land = w > h;
    const h24: u32 = @as(u32, @intFromFloat(@round(63 * lc.dc))) |
        (@as(u32, @intFromFloat(@round(31.5 + 31.5 * pc.dc))) << 6) |
        (@as(u32, @intFromFloat(@round(31.5 + 31.5 * qc.dc))) << 12) |
        (@as(u32, @intFromFloat(@round(31 * lc.scale))) << 18) |
        (@as(u32, @intFromBool(has_alpha)) << 23);
    const h16: u16 = @as(u16, @intCast(if (land) ly else lx)) |
        (@as(u16, @intFromFloat(@round(63 * pc.scale))) << 3) |
        (@as(u16, @intFromFloat(@round(63 * qc.scale))) << 9) |
        (@as(u16, @intFromBool(land)) << 15);
    out[0] = @truncate(h24);
    out[1] = @truncate(h24 >> 8);
    out[2] = @truncate(h24 >> 16);
    out[3] = @truncate(h16);
    out[4] = @truncate(h16 >> 8);
    var n: usize = 5;
    if (has_alpha) {
        out[5] = @as(u8, @intFromFloat(@round(15 * ac.dc))) | (@as(u8, @intFromFloat(@round(15 * ac.scale))) << 4);
        n = 6;
    }

    var odd = false;
    inline for (.{ &lc, &pc, &qc, &ac }) |ch| for (ch.ac[0..ch.n]) |f| {
        const u: u8 = @intFromFloat(@round(15 * f));
        if (odd) out[n - 1] |= u << 4 else {
            out[n] = u;
            n += 1;
        }
        odd = !odd;
    };
    return out[0..n];
}

const Channel = struct {
    dc: f32 = 0,
    scale: f32 = 0,
    ac: [7 * 7]f32 = .{0} ** 49, // upper bound on AC count
    n: usize = 0,
};

/// Triangular DCT-II of `chan` for the (cx,cy) where cx·ny < nx·(ny−cy) — the
/// "diagonal half" that ThumbHash keeps. Coeffs are normalised to [0,1] by
/// the per-channel max so 4-bit packing is uniform across channels.
fn dct(chan: []const f32, w: u32, h: u32, nx: u32, ny: u32) Channel {
    var c: Channel = .{};
    var fx: [100]f32 = undefined;
    var cy: u32 = 0;
    while (cy < ny) : (cy += 1) {
        var cx: u32 = 0;
        while (cx * ny < nx * (ny - cy)) : (cx += 1) {
            for (0..w) |x|
                fx[x] = @cos(std.math.pi / @as(f32, @floatFromInt(w)) * @as(f32, @floatFromInt(cx)) * (@as(f32, @floatFromInt(x)) + 0.5));
            var f: f32 = 0;
            for (0..h) |y| {
                const fy = @cos(std.math.pi / @as(f32, @floatFromInt(h)) * @as(f32, @floatFromInt(cy)) * (@as(f32, @floatFromInt(y)) + 0.5));
                for (0..w) |x| f += chan[x + y * w] * fx[x] * fy;
            }
            f /= @floatFromInt(w * h);
            if (cx == 0 and cy == 0) {
                c.dc = f;
            } else {
                c.ac[c.n] = f;
                c.n += 1;
                c.scale = @max(c.scale, @abs(f));
            }
        }
    }
    if (c.scale > 0) for (c.ac[0..c.n]) |*f| {
        f.* = 0.5 + 0.5 / c.scale * f.*;
    };
    return c;
}

/// Decode `hash` to a ≤32px RGBA image. Returns `error.DecodeFailed` if the
/// hash is too short. Output is `bun.default_allocator`-owned.
pub fn decode(hash: []const u8) error{ DecodeFailed, OutOfMemory }!struct { rgba: []u8, w: u32, h: u32 } {
    if (hash.len < 5) return error.DecodeFailed;
    const h24: u32 = @as(u32, hash[0]) | @as(u32, hash[1]) << 8 | @as(u32, hash[2]) << 16;
    const h16: u16 = @as(u16, hash[3]) | @as(u16, hash[4]) << 8;
    const l_dc: f32 = @as(f32, @floatFromInt(h24 & 63)) / 63;
    const p_dc: f32 = @as(f32, @floatFromInt((h24 >> 6) & 63)) / 31.5 - 1;
    const q_dc: f32 = @as(f32, @floatFromInt((h24 >> 12) & 63)) / 31.5 - 1;
    const l_scale: f32 = @as(f32, @floatFromInt((h24 >> 18) & 31)) / 31;
    const has_alpha = (h24 >> 23) != 0;
    const p_scale: f32 = @as(f32, @floatFromInt((h16 >> 3) & 63)) / 63;
    const q_scale: f32 = @as(f32, @floatFromInt((h16 >> 9) & 63)) / 63;
    const land = (h16 >> 15) != 0;
    const l_max: u16 = if (has_alpha) 5 else 7;
    const lx = @max(@as(u32, 3), if (land) l_max else h16 & 7);
    const ly = @max(@as(u32, 3), if (land) h16 & 7 else l_max);
    var a_dc: f32 = 1;
    var a_scale: f32 = 1;
    var off: usize = 5;
    if (has_alpha) {
        if (hash.len < 6) return error.DecodeFailed;
        a_dc = @as(f32, @floatFromInt(hash[5] & 15)) / 15;
        a_scale = @as(f32, @floatFromInt(hash[5] >> 4)) / 15;
        off = 6;
    }

    var nibbles: NibbleReader = .{ .src = hash, .i = off };
    var l_ac: [49]f32 = undefined;
    var p_ac: [5]f32 = undefined;
    var q_ac: [5]f32 = undefined;
    var a_ac: [14]f32 = undefined;
    const ln = try nibbles.channel(&l_ac, lx, ly, l_scale);
    // 1.25× saturation boost on decode compensates for 4-bit quantisation
    // washing the chroma out — matches the reference impl.
    const pn = try nibbles.channel(&p_ac, 3, 3, p_scale * 1.25);
    const qn = try nibbles.channel(&q_ac, 3, 3, q_scale * 1.25);
    const an = if (has_alpha) try nibbles.channel(&a_ac, 5, 5, a_scale) else 0;

    const ratio = @as(f32, @floatFromInt(lx)) / @as(f32, @floatFromInt(ly));
    const w: u32 = if (ratio > 1) 32 else @intFromFloat(@round(32 * ratio));
    const h: u32 = if (ratio > 1) @intFromFloat(@round(32 / ratio)) else 32;
    const rgba = try bun.default_allocator.alloc(u8, @as(usize, w) * h * 4);
    errdefer bun.default_allocator.free(rgba);

    var fx: [7]f32 = undefined;
    var fy: [7]f32 = undefined;
    for (0..h) |y| for (0..w) |x| {
        var lv = l_dc;
        var pv = p_dc;
        var qv = q_dc;
        var av = a_dc;
        const nf = @max(lx, if (has_alpha) @as(u32, 5) else 3);
        for (0..nf) |c|
            fx[c] = @cos(std.math.pi / @as(f32, @floatFromInt(w)) * (@as(f32, @floatFromInt(x)) + 0.5) * @as(f32, @floatFromInt(c)));
        for (0..@max(ly, if (has_alpha) @as(u32, 5) else 3)) |c|
            fy[c] = @cos(std.math.pi / @as(f32, @floatFromInt(h)) * (@as(f32, @floatFromInt(y)) + 0.5) * @as(f32, @floatFromInt(c)));
        lv += idct(l_ac[0..ln], lx, ly, &fx, &fy);
        pv += idct(p_ac[0..pn], 3, 3, &fx, &fy);
        qv += idct(q_ac[0..qn], 3, 3, &fx, &fy);
        if (has_alpha) av += idct(a_ac[0..an], 5, 5, &fx, &fy);
        const b = lv - 2.0 / 3.0 * pv;
        const r = (3 * lv - b + qv) / 2;
        const g = r - qv;
        const o = (y * w + x) * 4;
        rgba[o + 0] = clamp8(r);
        rgba[o + 1] = clamp8(g);
        rgba[o + 2] = clamp8(b);
        rgba[o + 3] = clamp8(av);
    };
    return .{ .rgba = rgba, .w = w, .h = h };
}

inline fn idct(ac: []const f32, nx: u32, ny: u32, fx: *const [7]f32, fy: *const [7]f32) f32 {
    var v: f32 = 0;
    var j: usize = 0;
    var cy: u32 = 0;
    while (cy < ny) : (cy += 1) {
        var cx: u32 = if (cy > 0) 0 else 1;
        const fy2 = fy[cy] * 2;
        while (cx * ny < nx * (ny - cy)) : (cx += 1) {
            v += ac[j] * fx[cx] * fy2;
            j += 1;
        }
    }
    return v;
}

const NibbleReader = struct {
    src: []const u8,
    i: usize,
    hi: bool = false,
    fn next(self: *NibbleReader) error{DecodeFailed}!u8 {
        if (self.i >= self.src.len) return error.DecodeFailed;
        const v = if (self.hi) self.src[self.i] >> 4 else self.src[self.i] & 15;
        if (self.hi) self.i += 1;
        self.hi = !self.hi;
        return v;
    }
    fn channel(self: *NibbleReader, out: []f32, nx: u32, ny: u32, scale: f32) error{DecodeFailed}!usize {
        var n: usize = 0;
        var cy: u32 = 0;
        while (cy < ny) : (cy += 1) {
            var cx: u32 = if (cy > 0) 0 else 1;
            while (cx * ny < nx * (ny - cy)) : (cx += 1) {
                out[n] = (@as(f32, @floatFromInt(try self.next())) / 7.5 - 1) * scale;
                n += 1;
            }
        }
        return n;
    }
};

inline fn clamp8(v: f32) u8 {
    return @intFromFloat(std.math.clamp(v, 0, 1) * 255);
}

const bun = @import("bun");
const std = @import("std");
