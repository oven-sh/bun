//! EXIF Orientation reader.
//!
//! Only the *Orientation* tag (0x0112) is parsed — that is the one piece of
//! EXIF that changes pixel meaning, and the only thing Sharp's `autoOrient`
//! looks at. Everything else (GPS, camera model, timestamps, …) is ignored.
//!
//! Layout being walked, for the next maintainer:
//!
//!   JPEG = FF D8 (SOI) · marker* · FF DA (SOS) · scan · FF D9 (EOI)
//!   marker = FF xx · be16 length · payload[length-2]
//!
//!   APP1/Exif payload = "Exif\0\0" · TIFF
//!   TIFF = byte-order ("II"=LE | "MM"=BE) · u16 magic 42 · u32 IFD0-offset
//!   IFD0 = u16 entry-count · entry[count] · u32 next-IFD-offset
//!   entry = u16 tag · u16 type · u32 count · u32 value-or-offset
//!
//! Orientation is type 3 (SHORT), count 1, so its value is packed in the
//! first 2 bytes of the 4-byte value field — no offset chase needed.
//!
//! The functions are deliberately permissive: any malformation returns
//! `null`/`.normal` rather than an error. EXIF is advisory; we never fail
//! decode over it.

pub const Orientation = enum(u8) {
    normal = 1,
    flop = 2, // mirror horizontal
    rotate180 = 3,
    flip = 4, // mirror vertical
    flop_rotate90 = 5,
    rotate90 = 6,
    flop_rotate270 = 7,
    rotate270 = 8,

    /// The (mirror?, cw-degrees) pair that turns the stored pixels upright.
    pub fn transform(self: Orientation) struct { flop: bool, flip: bool, rotate: u16 } {
        return switch (self) {
            .normal => .{ .flop = false, .flip = false, .rotate = 0 },
            .flop => .{ .flop = true, .flip = false, .rotate = 0 },
            .rotate180 => .{ .flop = false, .flip = false, .rotate = 180 },
            .flip => .{ .flop = false, .flip = true, .rotate = 0 },
            .flop_rotate90 => .{ .flop = true, .flip = false, .rotate = 90 },
            .rotate90 => .{ .flop = false, .flip = false, .rotate = 90 },
            .flop_rotate270 => .{ .flop = true, .flip = false, .rotate = 270 },
            .rotate270 => .{ .flop = false, .flip = false, .rotate = 270 },
        };
    }
};

/// Walk JPEG markers up to SOS looking for an APP1/Exif segment, then read
/// IFD0 tag 0x0112. JPEG-only because phone cameras are the source of rotated
/// images; PNG eXIf and WebP EXIF chunks exist but are rare enough to leave
/// for a follow-up.
pub fn readJpeg(bytes: []const u8) Orientation {
    if (bytes.len < 4 or bytes[0] != 0xFF or bytes[1] != 0xD8) return .normal;
    var i: usize = 2;
    while (i + 4 <= bytes.len) {
        if (bytes[i] != 0xFF) return .normal;
        const marker = bytes[i + 1];
        switch (marker) {
            // Padding / restart markers carry no length field.
            0xFF => {
                i += 1;
                continue;
            },
            0xD0...0xD8 => {
                i += 2;
                continue;
            },
            // SOS / EOI: scan data begins; EXIF would have come earlier.
            0xDA, 0xD9 => return .normal,
            else => {},
        }
        const seglen = (@as(usize, bytes[i + 2]) << 8) | bytes[i + 3];
        if (seglen < 2 or i + 2 + seglen > bytes.len) return .normal;
        if (marker == 0xE1 and seglen >= 8) {
            const seg = bytes[i + 4 .. i + 2 + seglen];
            if (seg.len >= 6 and std.mem.eql(u8, seg[0..6], "Exif\x00\x00"))
                return parseTiff(seg[6..]) orelse .normal;
        }
        i += 2 + seglen;
    }
    return .normal;
}

fn parseTiff(tiff: []const u8) ?Orientation {
    if (tiff.len < 8) return null;
    const big = std.mem.eql(u8, tiff[0..2], "MM");
    if (!big and !std.mem.eql(u8, tiff[0..2], "II")) return null;
    if ((rd16(tiff, 2, big) orelse return null) != 42) return null;
    const ifd0 = rd32(tiff, 4, big) orelse return null;
    const count = rd16(tiff, ifd0, big) orelse return null;
    var e: usize = ifd0 + 2;
    var n: u16 = 0;
    while (n < count) : ({
        n += 1;
        e += 12;
    }) {
        const tag = rd16(tiff, e, big) orelse return null;
        if (tag != 0x0112) continue;
        const v = rd16(tiff, e + 8, big) orelse return null;
        return if (v >= 1 and v <= 8) @enumFromInt(v) else null;
    }
    return null;
}

inline fn rd16(b: []const u8, off: usize, big: bool) ?u16 {
    if (off + 2 > b.len) return null;
    return std.mem.readInt(u16, b[off..][0..2], if (big) .big else .little);
}
inline fn rd32(b: []const u8, off: usize, big: bool) ?u32 {
    if (off + 4 > b.len) return null;
    return std.mem.readInt(u32, b[off..][0..4], if (big) .big else .little);
}

const std = @import("std");
