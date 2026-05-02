//! Median-cut colour quantizer for `.png({ palette: true, colors: N })`.
//!
//! Goal is "good enough to match Sharp's palette PNG path for screenshot
//! compression", not perceptual perfection — Sharp uses libimagequant which
//! is GPL, so we roll a small permissive one. Median-cut is the classic
//! Heckbert '82 algorithm: treat the RGBA pixels as points in a 4-D box,
//! repeatedly split the box with the largest channel range at that channel's
//! median until you have N boxes, then each box's mean becomes a palette
//! entry. Mapping is nearest-entry by squared RGBA distance, optionally with
//! Floyd–Steinberg error diffusion (`dither: true`).

pub const Result = struct {
    /// `[colors][4]u8` RGBA palette, `bun.default_allocator`-owned.
    palette: []u8,
    /// One palette index per input pixel, `bun.default_allocator`-owned.
    indices: []u8,
    /// Actual palette length (≤ requested `colors`).
    colors: u16,
    /// True if any palette entry has alpha < 255 — caller writes a tRNS chunk.
    has_alpha: bool,

    pub fn deinit(self: *Result) void {
        bun.default_allocator.free(self.palette);
        bun.default_allocator.free(self.indices);
    }
};

const Box = struct {
    /// Slice into the shared `order` index buffer.
    lo: u32,
    hi: u32,
    min: [4]u8,
    max: [4]u8,

    fn widestChannel(self: Box) u2 {
        var best: u2 = 0;
        var span: i32 = -1;
        inline for (0..4) |c| {
            const s: i32 = @as(i32, self.max[c]) - @as(i32, self.min[c]);
            if (s > span) {
                span = s;
                best = @intCast(c);
            }
        }
        return best;
    }
};

extern fn bun_image_nearest_palette(palette: [*]const u8, k: u32, r: i32, g: i32, b: i32, a: i32) u32;

pub const Options = struct {
    max_colors: u16,
    /// Floyd–Steinberg error diffusion. Hides banding on gradients at the
    /// cost of grain on flat areas; off by default to match Sharp's
    /// `palette:true` default.
    dither: bool = false,
};

pub fn quantize(rgba: []const u8, w: u32, h: u32, opts: Options) error{OutOfMemory}!Result {
    const max_colors = opts.max_colors;
    const n: u32 = @intCast(rgba.len / 4);
    const want: u16 = @max(1, @min(max_colors, 256));

    // `order` is a permutation of pixel indices that we partition in-place;
    // each Box owns a contiguous [lo,hi) slice of it.
    var order = try bun.default_allocator.alloc(u32, n);
    defer bun.default_allocator.free(order);
    for (order, 0..) |*o, i| o.* = @intCast(i);

    var boxes = try std.ArrayList(Box).initCapacity(bun.default_allocator, want);
    defer boxes.deinit(bun.default_allocator);
    boxes.appendAssumeCapacity(shrink(rgba, order, 0, n));

    while (boxes.items.len < want) {
        // Pick the box with the largest single-channel range — the one that
        // most wants splitting.
        var pick: usize = 0;
        var best: i32 = -1;
        for (boxes.items, 0..) |b, i| {
            const c = b.widestChannel();
            const s: i32 = @as(i32, b.max[c]) - @as(i32, b.min[c]);
            if (s > best) {
                best = s;
                pick = i;
            }
        }
        if (best <= 0) break; // every remaining box is a single colour
        const b = boxes.items[pick];
        if (b.hi - b.lo < 2) break;

        const ch = b.widestChannel();
        // Partial sort by the chosen channel, then cut at the midpoint.
        const slice = order[b.lo..b.hi];
        std.sort.pdq(u32, slice, SortCtx{ .rgba = rgba, .ch = ch }, SortCtx.less);
        const mid = b.lo + (b.hi - b.lo) / 2;
        boxes.items[pick] = shrink(rgba, order, b.lo, mid);
        boxes.appendAssumeCapacity(shrink(rgba, order, mid, b.hi));
    }

    const k: u16 = @intCast(boxes.items.len);
    var palette = try bun.default_allocator.alloc(u8, @as(usize, k) * 4);
    errdefer bun.default_allocator.free(palette);
    var has_alpha = false;
    for (boxes.items, 0..) |b, i| {
        var sum: [4]u64 = .{ 0, 0, 0, 0 };
        for (order[b.lo..b.hi]) |px| inline for (0..4) |c| {
            sum[c] += rgba[px * 4 + c];
        };
        const cnt: u64 = b.hi - b.lo;
        inline for (0..4) |c| palette[i * 4 + c] = @intCast((sum[c] + cnt / 2) / cnt);
        if (palette[i * 4 + 3] < 255) has_alpha = true;
    }

    var indices = try bun.default_allocator.alloc(u8, n);
    errdefer bun.default_allocator.free(indices);
    if (opts.dither) {
        try mapFloydSteinberg(rgba, w, h, palette, k, indices);
    } else {
        // Direct nearest-entry mapping. k ≤ 256; the inner search is the
        // highway-dispatched kernel so it runs under the best -march.
        for (0..n) |px| {
            const p = rgba[px * 4 ..][0..4];
            indices[px] = @intCast(bun_image_nearest_palette(palette.ptr, k, p[0], p[1], p[2], p[3]));
        }
    }

    return .{ .palette = palette, .indices = indices, .colors = k, .has_alpha = has_alpha };
}

/// Floyd–Steinberg error diffusion. Serial in raster order — each pixel's
/// quantisation error is pushed to its yet-unvisited neighbours with the
/// classic 7/3/5/1 ÷16 kernel:
///
///         ·   X   7
///         3   5   1
///
/// Serpentine scan (alternate L→R / R→L per row) so the diffusion direction
/// flips each row, avoiding the directional artefacts a fixed scan produces.
/// The diffusion itself can't be vectorised (data dependence on the previous
/// pixel), but the per-pixel palette search goes through the highway kernel.
fn mapFloydSteinberg(
    rgba: []const u8,
    w: u32,
    h: u32,
    palette: []const u8,
    k: u16,
    indices: []u8,
) error{OutOfMemory}!void {
    // Two rows of accumulated error, ×4 channels, in i16 (range fits: max
    // |err| per channel per step is 255, weights sum to 1 so it stays bounded
    // across the row). `cur` carries error pushed *into* the current row from
    // the row above; `nxt` collects error for the row below.
    const stride: usize = @as(usize, w) * 4;
    var cur = try bun.default_allocator.alloc(i16, stride);
    defer bun.default_allocator.free(cur);
    var nxt = try bun.default_allocator.alloc(i16, stride);
    defer bun.default_allocator.free(nxt);
    @memset(cur, 0);
    @memset(nxt, 0);

    var y: u32 = 0;
    while (y < h) : (y += 1) {
        const ltr = (y & 1) == 0;
        const step: i64 = if (ltr) 1 else -1;
        var x: i64 = if (ltr) 0 else @as(i64, w) - 1;
        while (x >= 0 and x < w) : (x += step) {
            const px: usize = @as(usize, y) * w + @as(usize, @intCast(x));
            const off: usize = @as(usize, @intCast(x)) * 4;

            // Candidate colour = source + accumulated error (clamped for the
            // search; the *unclamped* error is what propagates so rounding
            // doesn't accumulate bias).
            var cand: [4]i32 = undefined;
            inline for (0..4) |c| cand[c] = @as(i32, rgba[px * 4 + c]) + cur[off + c];

            const idx: u8 = @intCast(bun_image_nearest_palette(
                palette.ptr,
                k,
                clamp255(cand[0]),
                clamp255(cand[1]),
                clamp255(cand[2]),
                clamp255(cand[3]),
            ));
            indices[px] = idx;

            inline for (0..4) |c| {
                const err: i32 = cand[c] - @as(i32, palette[@as(usize, idx) * 4 + c]);
                // Push to the four neighbours. `dir` is +1 for L→R, −1 for R→L.
                const dir = step;
                const xr = x + dir;
                const xl = x - dir;
                if (xr >= 0 and xr < w) cur[@as(usize, @intCast(xr)) * 4 + c] += @intCast((err * 7) >> 4);
                if (xl >= 0 and xl < w) nxt[@as(usize, @intCast(xl)) * 4 + c] += @intCast((err * 3) >> 4);
                nxt[off + c] += @intCast((err * 5) >> 4);
                if (xr >= 0 and xr < w) nxt[@as(usize, @intCast(xr)) * 4 + c] += @intCast(err >> 4);
            }
        }
        // Slide: next row's error becomes current; clear next.
        std.mem.swap([]i16, &cur, &nxt);
        @memset(nxt, 0);
    }
}

inline fn clamp255(v: i32) i32 {
    return @min(@max(v, 0), 255);
}

const SortCtx = struct {
    rgba: []const u8,
    ch: u2,
    fn less(ctx: SortCtx, a: u32, b: u32) bool {
        return ctx.rgba[a * 4 + ctx.ch] < ctx.rgba[b * 4 + ctx.ch];
    }
};

/// Recompute a box's tight min/max over its pixel slice.
fn shrink(rgba: []const u8, order: []const u32, lo: u32, hi: u32) Box {
    var min: [4]u8 = .{ 255, 255, 255, 255 };
    var max: [4]u8 = .{ 0, 0, 0, 0 };
    for (order[lo..hi]) |px| inline for (0..4) |c| {
        const v = rgba[px * 4 + c];
        if (v < min[c]) min[c] = v;
        if (v > max[c]) max[c] = v;
    };
    return .{ .lo = lo, .hi = hi, .min = min, .max = max };
}

const bun = @import("bun");
const std = @import("std");
