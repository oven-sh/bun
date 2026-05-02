//! GIF89a/87a first-frame decode for `Bun.Image`.
//!
//! LZW is inherently serial — each code's expansion depends on the dictionary
//! built from all prior codes — so the bitstream decode is scalar by
//! construction. The post-LZW palette→RGBA expand is a 4-byte gather per
//! pixel; on the sizes GIF is actually used at it's memory-bandwidth-bound
//! and a tight scalar loop already saturates that, so no Highway kernel here
//! (the existing `NearestPaletteImpl` covers the encode-side colour match if
//! we add `.gif()` later).
//!
//! Scope: single-image, first frame; honours interlace and the GCE
//! transparency index. Animated/disposal/NETSCAPE loop are skipped — Sharp's
//! default `pages:1` does the same.

const Bits = struct {
    /// Sub-block-aware bit reader. GIF wraps the LZW bitstream in length-
    /// prefixed sub-blocks (≤255 bytes each, terminated by a 0 block), and
    /// codes are LSB-first across byte boundaries — so this pulls one byte at
    /// a time from the sub-block stream into a 32-bit accumulator.
    src: []const u8,
    /// Index into `src` of the next byte to consume.
    i: usize,
    /// Bytes remaining in the current sub-block. 0 ⇒ need to read a length.
    block: usize = 0,
    acc: u32 = 0,
    nbits: u5 = 0,
    /// We hit the 0-length terminator or ran off the end — every subsequent
    /// `read` returns 0 so the LZW loop sees an EOI-shaped value and stops
    /// instead of looping forever on truncated input.
    eof: bool = false,

    fn read(self: *Bits, n: u5) u16 {
        while (self.nbits < n and !self.eof) {
            if (self.block == 0) {
                if (self.i >= self.src.len) {
                    self.eof = true;
                    break;
                }
                self.block = self.src[self.i];
                self.i += 1;
                if (self.block == 0) {
                    self.eof = true;
                    break;
                }
            }
            if (self.i >= self.src.len) {
                self.eof = true;
                break;
            }
            self.acc |= @as(u32, self.src[self.i]) << self.nbits;
            self.i += 1;
            self.block -= 1;
            self.nbits += 8;
        }
        const v: u16 = @truncate(self.acc & ((@as(u32, 1) << n) - 1));
        self.acc >>= n;
        self.nbits -|= n;
        return v;
    }

    /// Skip the rest of this image's sub-blocks (after EOI we may still be
    /// mid-block, and there can be trailing padding sub-blocks).
    fn drain(self: *Bits) void {
        var i = self.i + self.block;
        while (i < self.src.len) {
            // Widen before the add: `1 + u8(255)` overflows u8 (peer-type
            // resolution) before reaching the usize lhs — Debug panics,
            // ReleaseFast wraps to 0 and loops forever.
            const n: usize = self.src[i];
            i += 1 + n;
            if (n == 0) break;
        }
        self.i = @min(i, self.src.len);
    }
};

/// One node per dictionary entry. The classic LZW dict is "string = previous
/// string + one byte"; we store `(prefix, suffix)` and reconstruct each string
/// by walking `prefix` back to a root code (< clear). 4096 codes is the GIF
/// hard cap (12-bit codes), so the table is fixed-size — heap-allocated in
/// `decodeFrame` (12 KiB) to keep WorkPool stacks small.
const Dict = struct {
    prefix: [4096]u16,
    suffix: [4096]u8,

    /// Walk the prefix chain into `scratch` (reversed), then copy forwards
    /// into `out`. Returns bytes written and the FIRST byte of the string
    /// (needed for the K-ω-K case where the new code refers to itself).
    fn emit(self: *const Dict, code_: u16, clear: u16, out: []u8, scratch: []u8) struct { usize, u8 } {
        var code = code_;
        var n: usize = 0;
        while (code >= clear) : (n += 1) {
            // 4096-deep chain max; scratch is sized for that.
            scratch[n] = self.suffix[code];
            code = self.prefix[code];
        }
        scratch[n] = @truncate(code); // root: literal byte
        n += 1;
        const first: u8 = scratch[n - 1];
        const cap = @min(n, out.len);
        for (0..cap) |k| out[k] = scratch[n - 1 - k];
        return .{ cap, first };
    }
};

pub fn decode(bytes: []const u8, max_pixels: u64) codecs.Error!codecs.Decoded {
    // ── header + LSD ───────────────────────────────────────────────────────
    if (bytes.len < 13 or !(std.mem.eql(u8, bytes[0..6], "GIF89a") or std.mem.eql(u8, bytes[0..6], "GIF87a")))
        return error.DecodeFailed;
    const lsd_packed = bytes[10];
    const has_gct = lsd_packed & 0x80 != 0;
    const gct_size: u16 = if (has_gct) @as(u16, 1) << @intCast((lsd_packed & 7) + 1) else 0;

    var i: usize = 13 + @as(usize, gct_size) * 3;
    if (i > bytes.len) return error.DecodeFailed;
    const gct: []const u8 = if (has_gct) bytes[13..][0 .. @as(usize, gct_size) * 3] else &.{};

    var trns: ?u8 = null; // transparency index from the most recent GCE

    // ── block stream: skip extensions, take the first Image Descriptor ─────
    while (i < bytes.len) {
        switch (bytes[i]) {
            0x3B => return error.DecodeFailed, // trailer before any image
            0x21 => { // extension introducer
                if (i + 2 > bytes.len) return error.DecodeFailed;
                const label = bytes[i + 1];
                i += 2;
                if (label == 0xF9 and i + 6 <= bytes.len and bytes[i] == 4) {
                    // Graphics Control Extension: blocksize=4 · packed ·
                    // delay(u16) · trns-idx · 0
                    if (bytes[i + 1] & 1 != 0) trns = bytes[i + 4];
                }
                // Skip sub-blocks regardless of label. Widen `n` first — a
                // legal max-size 255-byte sub-block (XMP/ICC application
                // extensions emit these) would overflow `1 + u8` and either
                // panic or spin a WorkPool thread forever.
                while (i < bytes.len) {
                    const n: usize = bytes[i];
                    i += 1 + n;
                    if (n == 0) break;
                }
            },
            0x2C => { // Image Descriptor
                if (i + 10 > bytes.len) return error.DecodeFailed;
                const w: u32 = std.mem.readInt(u16, bytes[i + 5 ..][0..2], .little);
                const h: u32 = std.mem.readInt(u16, bytes[i + 7 ..][0..2], .little);
                const ipacked = bytes[i + 9];
                const interlace = ipacked & 0x40 != 0;
                const has_lct = ipacked & 0x80 != 0;
                const lct_size: usize = if (has_lct) @as(usize, 1) << @intCast((ipacked & 7) + 1) else 0;
                i += 10;
                if (w == 0 or h == 0) return error.DecodeFailed;
                try codecs.guard(w, h, max_pixels);
                const ct: []const u8 = if (has_lct) blk: {
                    if (i + lct_size * 3 > bytes.len) return error.DecodeFailed;
                    defer i += lct_size * 3;
                    break :blk bytes[i..][0 .. lct_size * 3];
                } else gct;
                if (ct.len == 0) return error.DecodeFailed; // no palette at all

                if (i >= bytes.len) return error.DecodeFailed;
                const min_code: u5 = @intCast(@min(@max(bytes[i], 2), 11));
                i += 1;
                return decodeFrame(bytes, i, w, h, interlace, ct, min_code, trns);
            },
            else => return error.DecodeFailed,
        }
    }
    return error.DecodeFailed;
}

fn decodeFrame(bytes: []const u8, lzw_off: usize, w: u32, h: u32, interlace: bool, ct: []const u8, min_code: u5, trns: ?u8) codecs.Error!codecs.Decoded {
    const npix: usize = @as(usize, w) * h;

    // LZW dictionary state. `clear` and `eoi` are the two reserved codes
    // immediately after the literal range; the first assignable code is
    // `eoi + 1`. Code width starts at min_code+1 and grows to 12.
    const clear: u16 = @as(u16, 1) << @as(u4, @intCast(min_code));
    const eoi: u16 = clear + 1;
    var size: u5 = min_code + 1;
    var avail: u16 = eoi + 1;
    var prev: ?u16 = null;

    var dict = bun.default_allocator.create(Dict) catch return error.OutOfMemory;
    defer bun.default_allocator.destroy(dict);
    var scratch: [4096]u8 = undefined;

    const idx = try bun.default_allocator.alloc(u8, npix);
    defer bun.default_allocator.free(idx);
    var written: usize = 0;

    var bits: Bits = .{ .src = bytes, .i = lzw_off };
    while (written < npix) {
        const code = bits.read(size);
        if (bits.eof and code == 0) break;
        if (code == clear) {
            size = min_code + 1;
            avail = eoi + 1;
            prev = null;
            continue;
        }
        if (code == eoi) break;

        // Emit the string for `code`. If `code == avail` (the K-ω-K case: the
        // encoder referenced the entry it's about to create), the string is
        // prev's expansion + prev's first byte — so we emit prev, then append
        // its own first byte.
        var first: u8 = undefined;
        if (code < avail) {
            const r = dict.emit(code, clear, idx[written..], &scratch);
            written += r[0];
            first = r[1];
        } else if (code == avail and prev != null) {
            const r = dict.emit(prev.?, clear, idx[written..], &scratch);
            written += r[0];
            first = r[1];
            if (written < npix) {
                idx[written] = first;
                written += 1;
            }
        } else return error.DecodeFailed; // out-of-range code

        // Add prev+first to the dictionary, then bump code width when the
        // table fills the current width's range. GIF uses *deferred* clear:
        // once avail hits 4096 the encoder may keep emitting 12-bit codes
        // without growing further until it sends a clear.
        if (prev) |p| if (avail < 4096) {
            dict.prefix[avail] = p;
            dict.suffix[avail] = first;
            avail += 1;
            if (avail == (@as(u16, 1) << @as(u4, @intCast(size))) and size < 12) size += 1;
        };
        prev = code;
    }
    bits.drain();
    // A short or truncated stream (early EOI/eof) leaves `idx[written..]` as
    // raw mimalloc bytes. Those would be mapped through an attacker-controlled
    // palette into the output — a heap-memory disclosure. Filling with the
    // transparent index (or 0) makes the unfilled region transparent/background
    // instead, which is what browsers do for short frames.
    if (written < npix) @memset(idx[written..], trns orelse 0);

    // ── interlace reorder ──────────────────────────────────────────────────
    // GIF interlacing writes rows in 4 passes (every 8th from 0, every 8th
    // from 4, every 4th from 2, every 2nd from 1). The decoded `idx` is in
    // pass order; remap to scan order while expanding so we don't allocate a
    // second index buffer.
    const out = try bun.default_allocator.alloc(u8, npix * 4);
    errdefer bun.default_allocator.free(out);

    var pal: [256][4]u8 = .{.{ 0, 0, 0, 255 }} ** 256;
    for (0..ct.len / 3) |c| pal[c] = .{ ct[c * 3], ct[c * 3 + 1], ct[c * 3 + 2], 255 };
    if (trns) |t| pal[t] = .{ 0, 0, 0, 0 };

    if (interlace) {
        const passes = [_][2]u32{ .{ 0, 8 }, .{ 4, 8 }, .{ 2, 4 }, .{ 1, 2 } };
        var src_y: u32 = 0;
        for (passes) |p| {
            var y: u32 = p[0];
            while (y < h) : ({
                y += p[1];
                src_y += 1;
            }) expandRow(idx[@as(usize, src_y) * w ..][0..w], out[@as(usize, y) * w * 4 ..], &pal);
        }
    } else {
        var y: u32 = 0;
        while (y < h) : (y += 1)
            expandRow(idx[@as(usize, y) * w ..][0..w], out[@as(usize, y) * w * 4 ..], &pal);
    }
    return .{ .rgba = out, .width = w, .height = h };
}

/// One row of palette indices → RGBA. Scalar 4-byte copy per pixel — see file
/// comment for why this isn't a Highway kernel.
inline fn expandRow(idx: []const u8, out: []u8, pal: *const [256][4]u8) void {
    for (idx, 0..) |c, x| @memcpy(out[x * 4 ..][0..4], &pal[c]);
}

const bun = @import("bun");
const codecs = @import("./codecs.zig");
const std = @import("std");
