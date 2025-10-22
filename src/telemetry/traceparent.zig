/// W3C Trace Context traceparent header parser
/// Specification: https://www.w3.org/TR/trace-context/
///
/// Format: "version-trace_id-span_id-trace_flags"
/// Example: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
///
/// Reference implementation: OpenTelemetry C++ (api/include/opentelemetry/trace/propagation/http_trace_context.h)
const std = @import("std");
const bun = @import("bun");
const strings = bun.strings;

/// Parsed W3C traceparent header components
pub const TraceContext = struct {
    version: u8,
    trace_id: [32]u8, // 32 hex characters (128-bit ID)
    span_id: [16]u8, // 16 hex characters (64-bit ID)
    trace_flags: u8,

    /// Parse a W3C traceparent header value
    /// Returns null if the format is invalid or IDs are all zeros
    pub fn parse(traceparent: []const u8) ?TraceContext {
        // W3C spec: version 00 requires exactly 55 bytes
        // Format: "00-{32 hex}-{16 hex}-{2 hex}"
        //          00 - 32char  - 16char  - 02
        //          2  1 32       1 16      1 2 = 55 bytes
        if (traceparent.len < 55) return null;

        // Split into 4 parts by '-'
        var parts: [4][]const u8 = undefined;
        const parts_count = splitByDash(traceparent, &parts);
        if (parts_count != 4) return null;

        // Part 0: Version (2 hex chars)
        const version_str = parts[0];
        if (version_str.len != 2) return null;
        if (!isValidHex(version_str)) return null;
        const version = hexToU8(version_str) orelse return null;

        // Version 0xFF is invalid per spec
        if (version == 0xFF) return null;

        // Part 1: Trace ID (32 hex chars)
        const trace_id_str = parts[1];
        if (trace_id_str.len != 32) return null;
        if (!isValidHex(trace_id_str)) return null;

        // Trace ID must not be all zeros (invalid ID)
        if (isAllZeros(trace_id_str)) return null;

        // Part 2: Span ID (16 hex chars)
        const span_id_str = parts[2];
        if (span_id_str.len != 16) return null;
        if (!isValidHex(span_id_str)) return null;

        // Span ID must not be all zeros (invalid ID)
        if (isAllZeros(span_id_str)) return null;

        // Part 3: Trace flags (2 hex chars)
        const flags_str = parts[3];
        if (flags_str.len != 2) return null;
        if (!isValidHex(flags_str)) return null;
        const trace_flags = hexToU8(flags_str) orelse return null;

        // Version handling per W3C spec:
        // - Version 0x00: Must be exactly 55 bytes (already validated above)
        // - Version > 0x00: Can be >= 55 bytes (future compatibility)
        if (version == 0x00) {
            if (traceparent.len != 55) return null;
        } else {
            // Future version: allow flexible length but minimum 55
            if (traceparent.len < 55) return null;
        }

        // Copy hex strings (validated above)
        var trace_id: [32]u8 = undefined;
        var span_id: [16]u8 = undefined;
        @memcpy(&trace_id, trace_id_str);
        @memcpy(&span_id, span_id_str);

        return .{
            .version = version,
            .trace_id = trace_id,
            .span_id = span_id,
            .trace_flags = trace_flags,
        };
    }

    /// Format a traceparent header value into the provided buffer
    /// Returns the formatted slice (always 55 bytes for version 00)
    pub fn format(ctx: TraceContext, buf: *[55]u8) []const u8 {
        // Format: "00-{trace_id}-{span_id}-{flags}"
        const hex_chars = "0123456789abcdef";

        // Version (2 hex chars)
        buf[0] = hex_chars[ctx.version >> 4];
        buf[1] = hex_chars[ctx.version & 0x0F];
        buf[2] = '-';

        // Trace ID (32 hex chars, already hex string)
        @memcpy(buf[3..35], &ctx.trace_id);
        buf[35] = '-';

        // Span ID (16 hex chars, already hex string)
        @memcpy(buf[36..52], &ctx.span_id);
        buf[52] = '-';

        // Trace flags (2 hex chars)
        buf[53] = hex_chars[ctx.trace_flags >> 4];
        buf[54] = hex_chars[ctx.trace_flags & 0x0F];

        return buf[0..55];
    }
};

// ============================================================================
// Validation Utilities
// ============================================================================

/// Check if a string contains only valid hex characters (0-9, a-f, A-F)
/// Uses bun.strings.isASCIIHexDigit for validation
fn isValidHex(s: []const u8) bool {
    for (s) |c| {
        if (!strings.isASCIIHexDigit(c)) return false;
    }
    return true;
}

/// Convert 2-character hex string to u8
/// Uses bun.strings.toASCIIHexValue for conversion
fn hexToU8(hex: []const u8) ?u8 {
    if (hex.len != 2) return null;
    if (!strings.isASCIIHexDigit(hex[0]) or !strings.isASCIIHexDigit(hex[1])) return null;
    return (strings.toASCIIHexValue(hex[0]) << 4) | strings.toASCIIHexValue(hex[1]);
}

/// Check if a hex string is all zeros (invalid trace/span ID)
fn isAllZeros(hex: []const u8) bool {
    for (hex) |c| {
        if (c != '0') return false;
    }
    return true;
}

/// Split a string by '-' delimiter into at most 4 parts
/// Returns the number of parts found
fn splitByDash(s: []const u8, parts: *[4][]const u8) usize {
    var count: usize = 0;
    var start: usize = 0;

    for (s, 0..) |c, i| {
        if (c == '-') {
            if (count >= 4) return count;
            parts[count] = s[start..i];
            count += 1;
            start = i + 1;
        }
    }

    // Add last part if we haven't filled all 4
    if (count < 4 and start <= s.len) {
        parts[count] = s[start..];
        count += 1;
    }

    return count;
}

// ============================================================================
// Tests
// ============================================================================

test "traceparent: valid format" {
    const tp = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
    const ctx = TraceContext.parse(tp).?;

    try std.testing.expectEqual(@as(u8, 0x00), ctx.version);
    try std.testing.expectEqualStrings("4bf92f3577b34da6a3ce929d0e0e4736", &ctx.trace_id);
    try std.testing.expectEqualStrings("00f067aa0ba902b7", &ctx.span_id);
    try std.testing.expectEqual(@as(u8, 0x01), ctx.trace_flags);
}

test "traceparent: valid format uppercase hex" {
    const tp = "00-4BF92F3577B34DA6A3CE929D0E0E4736-00F067AA0BA902B7-01";
    const ctx = TraceContext.parse(tp).?;

    try std.testing.expectEqual(@as(u8, 0x00), ctx.version);
    try std.testing.expectEqualStrings("4BF92F3577B34DA6A3CE929D0E0E4736", &ctx.trace_id);
    try std.testing.expectEqualStrings("00F067AA0BA902B7", &ctx.span_id);
}

test "traceparent: sampled flag" {
    const tp = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
    const ctx = TraceContext.parse(tp).?;
    try std.testing.expectEqual(@as(u8, 0x01), ctx.trace_flags);
    try std.testing.expect((ctx.trace_flags & 0x01) != 0); // Sampled bit
}

test "traceparent: not sampled" {
    const tp = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-00";
    const ctx = TraceContext.parse(tp).?;
    try std.testing.expectEqual(@as(u8, 0x00), ctx.trace_flags);
    try std.testing.expect((ctx.trace_flags & 0x01) == 0); // Not sampled
}

test "traceparent: invalid - too short" {
    const tp = "00-4bf92f3577b34da6a3ce929d0e0e473";
    try std.testing.expectEqual(@as(?TraceContext, null), TraceContext.parse(tp));
}

test "traceparent: invalid - wrong number of parts" {
    const tp = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7";
    try std.testing.expectEqual(@as(?TraceContext, null), TraceContext.parse(tp));
}

test "traceparent: invalid - non-hex characters in trace_id" {
    const tp = "00-GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG-00f067aa0ba902b7-01";
    try std.testing.expectEqual(@as(?TraceContext, null), TraceContext.parse(tp));
}

test "traceparent: invalid - all-zero trace_id" {
    const tp = "00-00000000000000000000000000000000-00f067aa0ba902b7-01";
    try std.testing.expectEqual(@as(?TraceContext, null), TraceContext.parse(tp));
}

test "traceparent: invalid - all-zero span_id" {
    const tp = "00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01";
    try std.testing.expectEqual(@as(?TraceContext, null), TraceContext.parse(tp));
}

test "traceparent: invalid - version 0xFF" {
    const tp = "ff-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
    try std.testing.expectEqual(@as(?TraceContext, null), TraceContext.parse(tp));
}

test "traceparent: invalid - wrong trace_id length" {
    const tp = "00-4bf92f3577b34da6a3ce929d0e0e47-00f067aa0ba902b7-01";
    try std.testing.expectEqual(@as(?TraceContext, null), TraceContext.parse(tp));
}

test "traceparent: invalid - wrong span_id length" {
    const tp = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa-01";
    try std.testing.expectEqual(@as(?TraceContext, null), TraceContext.parse(tp));
}

test "traceparent: invalid - version 00 with extra data" {
    const tp = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01-extradata";
    try std.testing.expectEqual(@as(?TraceContext, null), TraceContext.parse(tp));
}

test "traceparent: format round-trip" {
    const original = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
    const ctx = TraceContext.parse(original).?;

    var buf: [55]u8 = undefined;
    const formatted = ctx.format(&buf);

    try std.testing.expectEqualStrings(original, formatted);
}

test "traceparent: format with different flags" {
    const ctx: TraceContext = .{
        .version = 0x00,
        .trace_id = "4bf92f3577b34da6a3ce929d0e0e4736".*,
        .span_id = "00f067aa0ba902b7".*,
        .trace_flags = 0xff,
    };

    var buf: [55]u8 = undefined;
    const formatted = ctx.format(&buf);

    try std.testing.expectEqualStrings("00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-ff", formatted);
}

test "isValidHex: valid lowercase" {
    try std.testing.expect(isValidHex("0123456789abcdef"));
}

test "isValidHex: valid uppercase" {
    try std.testing.expect(isValidHex("0123456789ABCDEF"));
}

test "isValidHex: valid mixed case" {
    try std.testing.expect(isValidHex("0123456789AbCdEf"));
}

test "isValidHex: invalid characters" {
    try std.testing.expect(!isValidHex("ghijklmn"));
    try std.testing.expect(!isValidHex("0123456G"));
    try std.testing.expect(!isValidHex("xyz"));
}

test "hexToU8: valid conversions" {
    try std.testing.expectEqual(@as(?u8, 0x00), hexToU8("00"));
    try std.testing.expectEqual(@as(?u8, 0xff), hexToU8("ff"));
    try std.testing.expectEqual(@as(?u8, 0xFF), hexToU8("FF"));
    try std.testing.expectEqual(@as(?u8, 0x42), hexToU8("42"));
    try std.testing.expectEqual(@as(?u8, 0xAB), hexToU8("ab"));
}

test "hexToU8: invalid inputs" {
    try std.testing.expectEqual(@as(?u8, null), hexToU8("GG"));
    try std.testing.expectEqual(@as(?u8, null), hexToU8("0"));
    try std.testing.expectEqual(@as(?u8, null), hexToU8("000"));
}

test "isAllZeros: detects all zeros" {
    try std.testing.expect(isAllZeros("0000000000000000"));
    try std.testing.expect(isAllZeros("00000000000000000000000000000000"));
}

test "isAllZeros: detects non-zero" {
    try std.testing.expect(!isAllZeros("0000000000000001"));
    try std.testing.expect(!isAllZeros("4bf92f3577b34da6a3ce929d0e0e4736"));
}
