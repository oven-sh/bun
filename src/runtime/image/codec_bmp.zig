//! Windows DIB / BMP decode-only.
//!
//! Exists so the WSL2 clipboard path (`CF_DIB` surfaced via xclip on the
//! Linux side) has a decoder; on macOS/Windows the system backend gets first
//! refusal and handles RLE/JPEG-in-BMP/OS2-header oddities. This static path
//! covers what clipboards actually emit: BITMAPINFOHEADER (40) and
//! BITMAPV4/V5HEADER (108/124), uncompressed (BI_RGB) or BI_BITFIELDS, 24/32-
//! bit. Anything else → DecodeFailed (caller has already exhausted the system
//! backend by then).

pub const Header = struct {
    width: u32,
    height: u32,
    /// y-stride direction: BMP rows are bottom-up unless biHeight < 0.
    top_down: bool,
    bpp: u16, // 24 or 32
    pix_off: u32,
    /// BI_BITFIELDS masks; for BI_RGB these are the Windows defaults.
    r_mask: u32,
    g_mask: u32,
    b_mask: u32,
    a_mask: u32,
};

/// Read enough of BITMAPFILEHEADER + BITMAPINFOHEADER (any version ≥ 40)
/// to size and locate the pixel array. Everything is little-endian.
pub fn parseHeader(b: []const u8) codecs.Error!Header {
    // BITMAPFILEHEADER(14) + at least BITMAPINFOHEADER(40).
    if (b.len < 54 or b[0] != 'B' or b[1] != 'M') return error.DecodeFailed;
    const pix_off = std.mem.readInt(u32, b[10..14], .little);
    const ih_size = std.mem.readInt(u32, b[14..18], .little);
    // OS/2 BITMAPCOREHEADER (12) and other oddities — let the system
    // backend (already tried) or caller deal; clipboards don't emit these.
    // (usize add: `ih_size` is attacker bytes; u32 14+u32::MAX would wrap.)
    if (ih_size < 40 or 14 + @as(usize, ih_size) > b.len) return error.DecodeFailed;
    const w_raw = std.mem.readInt(i32, b[18..22], .little);
    const h_raw = std.mem.readInt(i32, b[22..26], .little);
    // i32::MIN biHeight would make `@abs` yield 2³¹, which then doesn't fit
    // back into i32 anywhere downstream — reject it as the corrupt header it
    // is rather than letting safety-checked casts trap.
    if (w_raw <= 0 or h_raw == 0 or h_raw == std.math.minInt(i32)) return error.DecodeFailed;
    const bpp = std.mem.readInt(u16, b[28..30], .little);
    const compression = std.mem.readInt(u32, b[30..34], .little);
    if (bpp != 24 and bpp != 32) return error.DecodeFailed;
    // BI_RGB = 0, BI_BITFIELDS = 3. RLE/JPEG/PNG-in-BMP need a real codec.
    if (compression != 0 and compression != 3) return error.DecodeFailed;

    var h: Header = .{
        .width = @intCast(w_raw),
        .height = @intCast(@abs(h_raw)),
        .top_down = h_raw < 0,
        .bpp = bpp,
        .pix_off = pix_off,
        // BI_RGB defaults — Windows-native byte order is BGR(X). For 32-bit
        // BI_RGB the high byte is *reserved* per the BITMAPINFOHEADER spec
        // and real-world producers (CF_DIB clipboard, GetDIBits, Pillow BGRX)
        // write 0 there; treating it as alpha would make every such image
        // fully transparent. Alpha is only honoured below for BI_BITFIELDS
        // with an explicit V4+ mask, matching libgd/Pillow/stb_image.
        .r_mask = 0x00FF0000,
        .g_mask = 0x0000FF00,
        .b_mask = 0x000000FF,
        .a_mask = 0,
    };
    // BI_BITFIELDS: masks live either in the V4/V5 header at +40 or, for a
    // plain 40-byte INFOHEADER, immediately after it. Same offset both ways.
    if (compression == 3) {
        if (b.len < 14 + 40 + 12) return error.DecodeFailed;
        h.r_mask = std.mem.readInt(u32, b[54..58], .little);
        h.g_mask = std.mem.readInt(u32, b[58..62], .little);
        h.b_mask = std.mem.readInt(u32, b[62..66], .little);
        // Alpha mask is V4+ only (offset 66). V3+BITFIELDS has no alpha.
        h.a_mask = if (ih_size >= 108 and b.len >= 70)
            std.mem.readInt(u32, b[66..70], .little)
        else
            0;
    }
    // BITFIELDS masks come from the file; reject anything that isn't a
    // single ≤8-bit-wide aligned run before `shiftWidth` @intCasts the
    // popcount into u5 (and `to8` multiplies by 255 in u32). 5/6-bit masks
    // are real (565 BMPs); >8-bit are nonsense for an 8-bit-per-channel out.
    inline for (.{ h.r_mask, h.g_mask, h.b_mask, h.a_mask }) |m| {
        if (m != 0) {
            // Contiguous-run check: m >> ctz(m) must be 2^k - 1. The +1 wraps
            // for the all-ones mask we're rejecting, hence `+%`.
            const run = m >> @intCast(@ctz(m));
            if ((run & (run +% 1)) != 0 or @popCount(m) > 8) return error.DecodeFailed;
        }
    }
    return h;
}

/// One contiguous run of bits in `mask` → (right-shift, bit-width).
/// Separate from the mask read so the inner loop has no ctz/popcount.
inline fn shiftWidth(mask: u32) struct { u5, u5 } {
    if (mask == 0) return .{ 0, 0 };
    const sh: u5 = @intCast(@ctz(mask));
    return .{ sh, @intCast(@popCount(mask)) };
}

/// Expand `width`-bit channel value to 8-bit by bit-replication so 5-bit
/// 0b11111 → 255 (not 248) and 1-bit alpha → 0/255.
inline fn to8(v: u32, width: u5) u8 {
    return switch (width) {
        0 => 0xFF, // unused channel → opaque/full
        8 => @truncate(v),
        else => @truncate((v * 255) / ((@as(u32, 1) << width) - 1)),
    };
}

pub fn decode(bytes: []const u8, max_pixels: u64) codecs.Error!codecs.Decoded {
    const h = try parseHeader(bytes);
    try codecs.guard(h.width, h.height, max_pixels);

    const bpp_bytes: u32 = h.bpp / 8;
    // Rows are padded to 4-byte boundaries — DWORD alignment is the one
    // BMP rule everyone implements.
    const stride: usize = ((@as(usize, h.width) * bpp_bytes + 3) / 4) * 4;
    const need = @as(usize, h.pix_off) + stride * h.height;
    if (need > bytes.len) return error.DecodeFailed;

    const rs, const rw = shiftWidth(h.r_mask);
    const gs, const gw = shiftWidth(h.g_mask);
    const bs, const bw = shiftWidth(h.b_mask);
    const as, const aw = shiftWidth(h.a_mask);

    const out = try bun.default_allocator.alloc(u8, @as(usize, h.width) * h.height * 4);
    errdefer bun.default_allocator.free(out);

    var y: u32 = 0;
    while (y < h.height) : (y += 1) {
        const src_y: usize = if (h.top_down) y else h.height - 1 - y;
        const row = bytes[h.pix_off + src_y * stride ..];
        const dst = out[@as(usize, y) * h.width * 4 ..];
        var x: u32 = 0;
        while (x < h.width) : (x += 1) {
            // 24-bit reads three bytes; 32-bit reads a native LE u32. Both
            // feed the same mask path so BI_BITFIELDS Just Works.
            const pix: u32 = if (bpp_bytes == 3)
                @as(u32, row[x * 3]) | @as(u32, row[x * 3 + 1]) << 8 | @as(u32, row[x * 3 + 2]) << 16
            else
                std.mem.readInt(u32, row[x * 4 ..][0..4], .little);
            dst[x * 4 + 0] = to8((pix >> rs) & ((@as(u32, 1) << rw) -% 1), rw);
            dst[x * 4 + 1] = to8((pix >> gs) & ((@as(u32, 1) << gw) -% 1), gw);
            dst[x * 4 + 2] = to8((pix >> bs) & ((@as(u32, 1) << bw) -% 1), bw);
            dst[x * 4 + 3] = if (h.a_mask == 0) 0xFF else to8((pix >> as) & ((@as(u32, 1) << aw) -% 1), aw);
        }
    }
    return .{ .rgba = out, .width = h.width, .height = h.height };
}

const bun = @import("bun");
const codecs = @import("./codecs.zig");
const std = @import("std");
