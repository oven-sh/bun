//! W3C Trace Context: `traceparent` header parse/format.
//! https://www.w3.org/TR/trace-context/#traceparent-header

pub const traceparent_len = 55; // "00-" + 32 + "-" + 16 + "-" + 2

pub fn formatTraceparent(ctx: SpanContext, out: *[traceparent_len]u8) void {
    out[0] = '0';
    out[1] = '0';
    out[2] = '-';
    hexEncode(&ctx.trace_id, out[3..35]);
    out[35] = '-';
    hexEncode(&ctx.span_id, out[36..52]);
    out[52] = '-';
    out[53] = hex_chars[ctx.flags >> 4];
    out[54] = hex_chars[ctx.flags & 0x0F];
}

const hex_chars = "0123456789abcdef";

fn hexEncode(src: []const u8, dst: []u8) void {
    bun.assert(dst.len == src.len * 2);
    for (src, 0..) |b, i| {
        dst[2 * i] = hex_chars[b >> 4];
        dst[2 * i + 1] = hex_chars[b & 0x0F];
    }
}

pub fn parseTraceparent(header: []const u8) ?SpanContext {
    // Must be at least version-00 length; future versions may be longer but must
    // start with the same 55-byte prefix and a '-' if anything follows.
    if (header.len < traceparent_len) return null;
    if (header.len > traceparent_len and header[traceparent_len] != '-') return null;
    if (header[2] != '-' or header[35] != '-' or header[52] != '-') return null;

    // version: two lowercase hex; "ff" is forbidden.
    const v0 = hexDigit(header[0]) orelse return null;
    const v1 = hexDigit(header[1]) orelse return null;
    if (v0 == 0xf and v1 == 0xf) return null;

    var ctx: SpanContext = .{
        .trace_id = undefined,
        .span_id = undefined,
        .flags = 0,
    };
    if (!hexDecode(header[3..35], &ctx.trace_id)) return null;
    if (!hexDecode(header[36..52], &ctx.span_id)) return null;

    const f0 = hexDigit(header[53]) orelse return null;
    const f1 = hexDigit(header[54]) orelse return null;
    ctx.flags = (f0 << 4) | f1;

    if (!ctx.isValid()) return null;
    return ctx;
}

fn hexDigit(c: u8) ?u8 {
    return switch (c) {
        '0'...'9' => c - '0',
        'a'...'f' => c - 'a' + 10,
        else => null, // W3C: lowercase only
    };
}

fn hexDecode(src: []const u8, dst: []u8) bool {
    bun.assert(src.len == dst.len * 2);
    for (dst, 0..) |*b, i| {
        const hi = hexDigit(src[2 * i]) orelse return false;
        const lo = hexDigit(src[2 * i + 1]) orelse return false;
        b.* = (hi << 4) | lo;
    }
    return true;
}

const bun = @import("bun");
const span_mod = @import("./span.zig");
const SpanContext = span_mod.SpanContext;
