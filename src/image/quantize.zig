//! Median-cut colour quantizer for `.png({ palette: true, colors: N })`.
//!
//! Goal is "good enough to match Sharp's palette PNG path for screenshot
//! compression", not perceptual perfection — Sharp uses libimagequant which
//! is GPL, so we roll a small permissive one. Median-cut is the classic
//! Heckbert '82 algorithm: treat the RGBA pixels as points in a 4-D box,
//! repeatedly split the box with the largest channel range at that channel's
//! median until you have N boxes, then each box's mean becomes a palette
//! entry. Mapping is nearest-entry by squared RGBA distance.
//!
//! No dithering. Floyd–Steinberg would be ~40 more lines if it turns out to
//! matter for the screenshot use case.

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

pub fn quantize(rgba: []const u8, max_colors: u16) error{OutOfMemory}!Result {
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

    // Map every source pixel to its nearest palette entry. k ≤ 256 so the
    // brute-force inner loop is fine; for big images this is the hot loop but
    // the whole point of palette mode is the *output* size, not encode speed.
    var indices = try bun.default_allocator.alloc(u8, n);
    for (0..n) |px| {
        var best_i: u8 = 0;
        var best_d: u32 = std.math.maxInt(u32);
        inline for (0..4) |_| {} // (keep the optimizer honest about the 4-wide body below)
        var i: u16 = 0;
        while (i < k) : (i += 1) {
            var d: u32 = 0;
            inline for (0..4) |c| {
                const diff: i32 = @as(i32, rgba[px * 4 + c]) - @as(i32, palette[i * 4 + c]);
                d += @intCast(diff * diff);
            }
            if (d < best_d) {
                best_d = d;
                best_i = @intCast(i);
            }
        }
        indices[px] = best_i;
    }

    return .{ .palette = palette, .indices = indices, .colors = k, .has_alpha = has_alpha };
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
