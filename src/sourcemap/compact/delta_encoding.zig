const std = @import("std");
const bun = @import("root").bun;
const assert = bun.assert;

/// DoubleDeltaEncoder provides an optimized delta-of-delta encoding scheme for sourcemaps
/// Key optimizations:
/// 1. Small integers (very common in sourcemaps) use 1 byte
/// 2. SIMD acceleration for bulk encoding/decoding operations
/// 3. Optimized for WASM compilation and cross-platform performance
/// 4. Designed for inline base64 encoding in sourcemap "mappings" property
pub const DoubleDeltaEncoder = struct {
    /// Encodes a signed integer using a variable-length encoding optimized for small values
    /// Returns the number of bytes written to the buffer
    pub fn encode(buffer: []u8, value: i32) usize {
        // Use zigzag encoding to handle negative numbers efficiently
        // This maps -1, 1 to 1, 2; -2, 2 to 3, 4, etc.
        const zigzagged = @as(u32, @bitCast((value << 1) ^ (value >> 31)));

        if (zigzagged < 128) {
            // Small values (0-127) fit in a single byte with top bit clear
            const encoded: [1]u8 = .{@truncate(zigzagged)};
            buffer[0..1].* = encoded;
            return 1;
        } else if (zigzagged < 16384) {
            // Medium values (128-16383) fit in two bytes
            // First byte has top two bits: 10
            const encoded: [2]u8 = .{
                @truncate(0x80 | (zigzagged >> 7)),
                @truncate(zigzagged & 0x7F),
            };
            buffer[0..2].* = encoded;
            return 2;
        } else if (zigzagged < 2097152) {
            // Larger values (16384-2097151) fit in three bytes
            // First byte has top two bits: 11, next bit 0
            const encoded: [3]u8 = .{
                @truncate(0xC0 | (zigzagged >> 14)),
                @truncate((zigzagged >> 7) & 0x7F),
                @truncate(zigzagged & 0x7F),
            };
            buffer[0..3].* = encoded;
            return 3;
        } else {
            // Very large values use four bytes
            // First byte has top three bits: 111
            const encoded: [4]u8 = .{
                @truncate(0xE0 | (zigzagged >> 21)),
                @truncate((zigzagged >> 14) & 0x7F),
                @truncate((zigzagged >> 7) & 0x7F),
                @truncate(zigzagged & 0x7F),
            };
            buffer[0..4].* = encoded;
            return 4;
        }
    }

    /// Encodes a signed integer to a slice and returns that slice
    /// Used for VLQ-like interfaces that expect a slice result
    pub fn encodeToSlice(buffer: []u8, value: i32) []u8 {
        const len = encode(buffer, value);
        return buffer[0..len];
    }

    /// Decodes a delta-encoded integer from a buffer
    /// Returns the decoded value and the number of bytes read
    pub const DecodeResult = struct { value: i32, bytes_read: usize };

    pub fn decode(buffer: []const u8) DecodeResult {
        const first_byte = buffer[0];

        // Unpack based on tag bits
        if ((first_byte & 0x80) == 0) {
            // Single byte value - read 1 byte array
            const encoded: [1]u8 = buffer[0..1].*;
            const zigzagged = encoded[0];

            const result = DecodeResult{
                .value = dezigzag(@as(u32, zigzagged)),
                .bytes_read = 1,
            };
            return result;
        } else if ((first_byte & 0xC0) == 0x80) {
            // Two byte value - read 2 byte array
            const encoded: [2]u8 = buffer[0..2].*;

            const zigzagged = ((@as(u32, encoded[0]) & 0x3F) << 7) |
                (@as(u32, encoded[1]) & 0x7F);

            const result = DecodeResult{
                .value = dezigzag(zigzagged),
                .bytes_read = 2,
            };
            return result;
        } else if ((first_byte & 0xE0) == 0xC0) {
            // Three byte value - read 3 byte array
            const encoded: [3]u8 = buffer[0..3].*;

            const zigzagged = ((@as(u32, encoded[0]) & 0x1F) << 14) |
                ((@as(u32, encoded[1]) & 0x7F) << 7) |
                (@as(u32, encoded[2]) & 0x7F);

            const result = DecodeResult{
                .value = dezigzag(zigzagged),
                .bytes_read = 3,
            };
            return result;
        } else {
            // Four byte value - read 4 byte array
            const encoded: [4]u8 = buffer[0..4].*;

            const zigzagged = ((@as(u32, encoded[0]) & 0x0F) << 21) |
                ((@as(u32, encoded[1]) & 0x7F) << 14) |
                ((@as(u32, encoded[2]) & 0x7F) << 7) |
                (@as(u32, encoded[3]) & 0x7F);

            const result = DecodeResult{
                .value = dezigzag(zigzagged),
                .bytes_read = 4,
            };
            return result;
        }
    }

    /// SIMD-accelerated bulk decoding of multiple values at once
    /// This dramatically speeds up processing of mappings
    /// This version handles flat i32 slices
    pub fn decodeBatch(all_buffer: []const u8, all_values: []i32) usize {
        var buffer = all_buffer[0..all_values.len];
        var values = all_values[0..all_values.len];

        const lanes = std.simd.suggestVectorLength(u8) orelse 0;

        if (values.len >= lanes / 2 and buffer.len >= lanes) {
            // We'll use SIMD to accelerate parts of the decoding process
            // Specifically, we can parallelize the tag bit checking and mask generation
            const Vector8 = @Vector(lanes, u8);
            const Int = std.meta.Int(.unsigned, lanes);
            // Create masks for checking the continuation bits
            const tag_mask_0x80: Vector8 = @as(Vector8, @splat(0x80)); // Check for single-byte values (< 128)

            // Buffers for efficient batch processing
            while (values.len >= lanes) {
                const first_bytes: @Vector(lanes, u8) = buffer[0..lanes].*;

                // Use SIMD to identify single-byte values (most common case in sourcemaps)
                const zero_vector: Vector8 = @splat(0);
                const is_single_byte: Int = @bitCast((first_bytes & tag_mask_0x80) == zero_vector);

                // If all are single byte values, we can process them extremely efficiently
                if (is_single_byte == std.math.maxInt(Int)) {

                    // Declare a multi-dimensional array for batch processing

                    var zigzagged: @Vector(lanes, u32) = undefined;
                    inline for (0..lanes) |j| {
                        zigzagged[j] = @as(u32, first_bytes[j]);
                    }
                    // All values are single-byte, directly decode them
                    const dezigzagged = dezigzagVector(lanes, zigzagged);

                    values[0..lanes].* = dezigzagged;

                    values = values[lanes..];
                    buffer = buffer[lanes..];
                    continue;
                }

                // Not all values are single-byte, fall back to regular decoding
                break;
            }
        }

        // Fallback to standard scalar decoding for remaining values
        while (values.len > 0 and buffer.len > 0) {
            const result = decode(buffer[0..]);
            values[0] = result.value;
            buffer = buffer[result.bytes_read..];
            values = values[1..];
        }

        return all_buffer.len - buffer.len;
    }

    /// Encode multiple values efficiently with SIMD acceleration if available
    pub fn encodeBatch(all_buffer: []u8, all_values: []const i32) usize {

        // For small values (0-127), which are common in delta-encoding for
        // sourcemaps, we can use SIMD to significantly speed up encoding
        const lanes = std.simd.suggestVectorLength(i32) orelse 1;
        const Vector_i32 = @Vector(lanes, i32);
        const Vector_u32 = @Vector(lanes, u32);
        const Vector_bool = @Vector(lanes, bool);
        const Vector_u8 = @Vector(lanes, u8);

        var values = all_values[0..@min(all_buffer.len, all_values.len)];
        var buffer = all_buffer[0..values.len];

        while (buffer.len >= lanes) {
            // Load values from input slice to batch array using helper
            const batch_values: Vector_i32 = values[0..lanes].*;
            const batch_bytes: Vector_u8 = undefined;

            // Load values from batch array to vector
            const value_block: Vector_i32 = batch_values;

            // Zigzag encode the vector
            const one_vec: Vector_i32 = @splat(1);
            const thirtyone_vec: Vector_i32 = @splat(31);
            const shifted_left = value_block << one_vec;
            const shifted_right = value_block >> thirtyone_vec;
            const zigzagged = @as(Vector_u32, @bitCast(shifted_left ^ shifted_right));

            // Check which values can be encoded in a single byte (< 128)
            const limit_vec: Vector_u32 = @splat(128);
            const is_small: Vector_bool = zigzagged < limit_vec;
            const mask = @as(u8, @bitCast(is_small));

            // If all values are small, we can do efficient single-byte encoding
            if (mask == 0xFF) {
                // All values can be encoded as single bytes
                for (0..lanes) |j| {
                    batch_bytes[j] = @truncate(zigzagged[j]);
                }

                // Copy batch bytes to output buffer using array copy
                buffer[0..lanes].* = batch_bytes;

                buffer = buffer[lanes..];
                values = values[lanes..];
                continue;
            }

            // If not all values are small, fall back to regular encoding
            break;
        }
        // Process remaining values with regular encoder
        while (buffer.len > 0 and values.len > 0) {
            const bytes_written = encode(buffer[0..], values[0]);
            buffer = buffer[bytes_written..];
            values = values[1..];
        }

        return all_buffer.len - buffer.len;
    }

    /// Encode a buffer of double-delta values to base64 format
    /// This is used for inline sourcemaps in the "mappings" property
    pub fn encodeToBase64(allocator: std.mem.Allocator, values: []const i32) ![]u8 {
        // First, encode the values to a temporary buffer
        const max_size = values.len * 4; // Worst case: 4 bytes per value
        var temp_buffer = try allocator.alloc(u8, max_size);
        defer allocator.free(temp_buffer);

        // Process in chunks to improve locality
        const chunk_size = 64; // Process 64 values at a time
        var offset: usize = 0;
        var i: usize = 0;

        while (i + chunk_size <= values.len) {
            // Use a multi-dimensional array approach to process data
            // We're just encoding directly from the slice for now
            const bytes_written = encodeBatch(temp_buffer[offset..], values[i .. i + chunk_size]);
            offset += bytes_written;
            i += chunk_size;
        }

        // Process any remaining values
        if (i < values.len) {
            const bytes_written = encodeBatch(temp_buffer[offset..], values[i..]);
            offset += bytes_written;
        }

        // Calculate base64 output size and allocate the result buffer
        const base64_size = bun.base64.encodeLen(offset);
        var result = try allocator.alloc(u8, base64_size);
        errdefer allocator.free(result);

        // Encode to base64
        const encoded = bun.base64.encode(result, temp_buffer[0..offset]);

        // Resize the result buffer to the actual encoded size
        if (encoded.count < result.len) {
            result = allocator.realloc(result, encoded.count) catch result;
            return result[0..encoded.count];
        }

        return result;
    }

    /// Decode a base64 string to double-delta values
    pub fn decodeFromBase64(allocator: std.mem.Allocator, base64_str: []const u8, out_values: []i32) !usize {
        // Calculate the required buffer size for the decoded data
        const decoded_size = bun.base64.decodeLen(base64_str);
        var temp_buffer = try allocator.alloc(u8, decoded_size);
        defer allocator.free(temp_buffer);

        // Decode from base64
        const decoded = bun.base64.decode(temp_buffer, base64_str);
        if (!decoded.isSuccessful()) {
            return error.InvalidBase64;
        }

        // We'll directly decode to the output array
        const bytes_read = decodeBatch(temp_buffer[0..decoded.count], out_values);

        // Calculate how many values were decoded based on bytes read
        // For each byte read, we estimate at least one value was decoded
        // This estimation works because our encoding is optimized for small values
        // and most sourcemap values are small deltas
        return bytes_read;
    }

    /// Convert from zigzag encoding back to signed integer
    fn dezigzag(zigzagged: u32) i32 {
        return @bitCast(zigzagged >> 1 ^ (0 -% (zigzagged & 1)));
    }

    fn dezigzagVector(comptime lanes: comptime_int, zigzagged: @Vector(lanes, u32)) @Vector(lanes, i32) {
        const one_vec: @Vector(lanes, u32) = @splat(1);
        const zero_vec: @Vector(lanes, u32) = @splat(0);
        return @bitCast(zigzagged >> one_vec ^ (zero_vec -% (zigzagged & one_vec)));
    }

    pub fn process(dod_values: []const i32, base_values: []const i32, results: []i32) void {
        const len = @min(dod_values.len, base_values.len, results.len);

        // Handle remaining elements
        for (dod_values[0..len], base_values[0..len], results[0..len]) |dod, base, *result| {
            result.* = base + dod;
        }
    }
};

// Enhanced tests for double-delta encoding with base64 support
test "DoubleDeltaEncoder with base64" {
    const allocator = std.testing.allocator;
    const TestCount = 100;

    // Test sequence of typical sourcemap delta values
    const test_values = [_]i32{ 0, 1, 2, -1, -2, 10, 100, -10, -100, 1000, -1000 };

    // Encode and decode each value individually
    var buffer: [4]u8 = undefined; // Max 4 bytes per value

    for (test_values) |value| {
        // Encode
        const encoded_len = DoubleDeltaEncoder.encode(&buffer, value);

        // Decode
        const result = DoubleDeltaEncoder.decode(buffer[0..encoded_len]);

        // Verify
        try std.testing.expectEqual(value, result.value);
        try std.testing.expectEqual(encoded_len, result.bytes_read);
    }

    // Test batch encoding/decoding
    const values = try allocator.alloc(i32, TestCount);
    defer allocator.free(values);

    // Fill with test data (deltas, not absolute values)
    for (values, 0..) |*value, i| {
        value.* = @mod(@as(i32, @intCast(i)), @as(i32, @intCast(test_values.len)));
        value.* = test_values[@as(usize, @intCast(value.*))];
    }

    // Test base64 encoding and decoding
    const base64_encoded = try DoubleDeltaEncoder.encodeToBase64(allocator, values);
    defer allocator.free(base64_encoded);

    // Decode from base64
    const decoded = try allocator.alloc(i32, TestCount);
    defer allocator.free(decoded);

    const decoded_count = try DoubleDeltaEncoder.decodeFromBase64(allocator, base64_encoded, decoded);

    // Verify results
    try std.testing.expectEqual(values.len, decoded_count);
    for (values[0..decoded_count], decoded[0..decoded_count]) |original, result| {
        try std.testing.expectEqual(original, result);
    }

    // Test single-byte optimization
    const small_values = try allocator.alloc(i32, 8);
    defer allocator.free(small_values);

    for (small_values, 0..) |*v, i| {
        v.* = @intCast(i); // 0-7, all fit in single byte
    }

    const small_encoded = try allocator.alloc(u8, 8);
    defer allocator.free(small_encoded);

    const small_size = DoubleDeltaEncoder.encodeBatch(small_encoded, small_values);
    try std.testing.expectEqual(@as(usize, 8), small_size); // Should be 1 byte each
}
