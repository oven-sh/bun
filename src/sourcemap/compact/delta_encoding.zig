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
            buffer[0] = @truncate(zigzagged);
            return 1;
        } else if (zigzagged < 16384) {
            // Medium values (128-16383) fit in two bytes
            // First byte has top two bits: 10
            buffer[0] = @truncate(0x80 | (zigzagged >> 7));
            buffer[1] = @truncate(zigzagged & 0x7F);
            return 2;
        } else if (zigzagged < 2097152) {
            // Larger values (16384-2097151) fit in three bytes
            // First byte has top two bits: 11, next bit 0
            buffer[0] = @truncate(0xC0 | (zigzagged >> 14));
            buffer[1] = @truncate((zigzagged >> 7) & 0x7F);
            buffer[2] = @truncate(zigzagged & 0x7F);
            return 3;
        } else {
            // Very large values use four bytes
            // First byte has top three bits: 111
            buffer[0] = @truncate(0xE0 | (zigzagged >> 21));
            buffer[1] = @truncate((zigzagged >> 14) & 0x7F);
            buffer[2] = @truncate((zigzagged >> 7) & 0x7F);
            buffer[3] = @truncate(zigzagged & 0x7F);
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
    pub fn decode(buffer: []const u8) struct { value: i32, bytes_read: usize } {
        const first_byte = buffer[0];

        // Unpack based on tag bits
        if ((first_byte & 0x80) == 0) {
            // Single byte value
            const zigzagged = first_byte;
            return .{
                .value = dezigzag(@as(u32, zigzagged)),
                .bytes_read = 1,
            };
        } else if ((first_byte & 0xC0) == 0x80) {
            // Two byte value
            const zigzagged = ((@as(u32, first_byte) & 0x3F) << 7) |
                (@as(u32, buffer[1]) & 0x7F);
            return .{
                .value = dezigzag(zigzagged),
                .bytes_read = 2,
            };
        } else if ((first_byte & 0xE0) == 0xC0) {
            // Three byte value
            const zigzagged = ((@as(u32, first_byte) & 0x1F) << 14) |
                ((@as(u32, buffer[1]) & 0x7F) << 7) |
                (@as(u32, buffer[2]) & 0x7F);
            return .{
                .value = dezigzag(zigzagged),
                .bytes_read = 3,
            };
        } else {
            // Four byte value
            const zigzagged = ((@as(u32, first_byte) & 0x0F) << 21) |
                ((@as(u32, buffer[1]) & 0x7F) << 14) |
                ((@as(u32, buffer[2]) & 0x7F) << 7) |
                (@as(u32, buffer[3]) & 0x7F);
            return .{
                .value = dezigzag(zigzagged),
                .bytes_read = 4,
            };
        }
    }

    /// SIMD-accelerated bulk decoding of multiple values at once
    /// This dramatically speeds up processing of mappings
    pub fn decodeBatch(buffer: []const u8, values: []i32) usize {
        var offset: usize = 0;
        var i: usize = 0;

        const vector_size = std.simd.suggestVectorLength(u8) orelse 0;

        // Process with AVX2 acceleration if available
        if (vector_size >= 16 and values.len >= 8 and buffer.len >= 16) {
            // AVX2 can process 8 i32 values at once
            const lanes = 8;

            // We'll use SIMD to accelerate parts of the decoding process
            // Specifically, we can parallelize the tag bit checking and mask generation
            const Vector8 = @Vector(lanes, u8);
            const MaskVector = @Vector(lanes, bool);

            // Create masks for checking the continuation bits
            const tag_mask_0x80: Vector8 = @as(Vector8, @splat(0x80)); // Check for single-byte values (< 128)

            // Buffers for efficient batch processing
            while (i + lanes <= values.len and offset + lanes <= buffer.len) {
                // Check if we can process a full batch
                var can_process_batch = true;

                // Load the first byte of the next 8 potential values
                var first_bytes: Vector8 = undefined;
                for (0..lanes) |j| {
                    if (offset + j < buffer.len) {
                        first_bytes[j] = buffer[offset + j];
                    } else {
                        can_process_batch = false;
                        break;
                    }
                }

                if (!can_process_batch) break;

                // Use SIMD to identify single-byte values (most common case in sourcemaps)
                const zero_vector: Vector8 = @splat(0);
                const is_single_byte: MaskVector = (first_bytes & tag_mask_0x80) == zero_vector;
                const single_byte_mask = @as(u8, @bitCast(is_single_byte));

                // If all are single byte values, we can process them extremely efficiently
                if (single_byte_mask == 0xFF) {
                    // All values are single-byte, directly decode them
                    for (0..lanes) |j| {
                        // For single-byte values, just dezigzag the value
                        const zigzagged = @as(u32, buffer[offset + j]);
                        values[i + j] = dezigzag(zigzagged);
                    }

                    // Update offsets
                    offset += lanes;
                    i += lanes;
                    continue;
                }

                // Not all values are single-byte, fall back to regular decoding
                break;
            }
        } else if (vector_size >= 8 and values.len >= 4 and buffer.len >= 8) {
            // NEON acceleration (similar to AVX2 but with 4 lanes)
            const lanes = 4;

            // Similar implementation to the AVX2 version but with 4 lanes
            const Vector4 = @Vector(lanes, u8);
            const MaskVector = @Vector(lanes, bool);

            // Create masks for checking the continuation bits
            const tag_mask_0x80: Vector4 = @as(Vector4, @splat(0x80));

            // Process batches of 4 values
            while (i + lanes <= values.len and offset + lanes <= buffer.len) {
                // Check if we can process a full batch
                var can_process_batch = true;

                // Load the first byte of the next 4 potential values
                var first_bytes: Vector4 = undefined;
                for (0..lanes) |j| {
                    if (offset + j < buffer.len) {
                        first_bytes[j] = buffer[offset + j];
                    } else {
                        can_process_batch = false;
                        break;
                    }
                }

                if (!can_process_batch) break;

                // Use SIMD to identify single-byte values
                const zero_vector: Vector4 = @splat(0);
                const is_single_byte: MaskVector = (first_bytes & tag_mask_0x80) == zero_vector;
                const single_byte_mask = @as(u4, @bitCast(is_single_byte));

                // If all are single byte values, process efficiently
                if (single_byte_mask == 0xF) {
                    // All values are single-byte, directly decode them
                    for (0..lanes) |j| {
                        const zigzagged = @as(u32, buffer[offset + j]);
                        values[i + j] = dezigzag(zigzagged);
                    }

                    // Update offsets
                    offset += lanes;
                    i += lanes;
                    continue;
                }

                // Not all values are single-byte, fall back to regular decoding
                break;
            }
        }

        // Fallback to standard scalar decoding for remaining values
        while (i < values.len and offset < buffer.len) {
            const result = decode(buffer[offset..]);
            values[i] = result.value;
            offset += result.bytes_read;
            i += 1;
        }

        return offset;
    }

    /// Encode multiple values efficiently with SIMD acceleration if available
    pub fn encodeBatch(buffer: []u8, values: []const i32) usize {
        var offset: usize = 0;

        // For small values (0-127), which are common in delta-encoding for
        // sourcemaps, we can use SIMD to significantly speed up encoding
        const use_avx2 = std.simd.suggestVectorLength(u8) orelse 0 >= 16;
        const use_neon = std.simd.suggestVectorLength(u8) orelse 0 >= 8;

        if (use_avx2 and values.len >= 8 and buffer.len >= 8) {
            // AVX2 processing with 8 lanes
            const lanes = 8;
            const Vector8_i32 = @Vector(lanes, i32);
            const Vector8_u32 = @Vector(lanes, u32);
            const Vector8_bool = @Vector(lanes, bool);

            var i: usize = 0;
            while (i + lanes <= values.len and offset + lanes <= buffer.len) {
                // Load values
                var value_block: Vector8_i32 = undefined;
                for (0..lanes) |j| {
                    value_block[j] = values[i + j];
                }

                // Zigzag encode the vector
                const one_vec: Vector8_i32 = @splat(1);
                const thirtyone_vec: Vector8_i32 = @splat(31);
                const shifted_left = value_block << one_vec;
                const shifted_right = value_block >> thirtyone_vec;
                const zigzagged = @as(Vector8_u32, @bitCast(shifted_left ^ shifted_right));

                // Check which values can be encoded in a single byte (< 128)
                const limit_vec: Vector8_u32 = @splat(128);
                const is_small: Vector8_bool = zigzagged < limit_vec;
                const mask = @as(u8, @bitCast(is_small));

                // If all values are small, we can do efficient single-byte encoding
                if (mask == 0xFF) {
                    // All values can be encoded as single bytes
                    for (0..lanes) |j| {
                        buffer[offset + j] = @truncate(zigzagged[j]);
                    }

                    offset += lanes;
                    i += lanes;
                    continue;
                }

                // If not all values are small, fall back to regular encoding
                break;
            }

            // Process remaining values with regular encoder
            while (i < values.len and offset < buffer.len) {
                const bytes_written = encode(buffer[offset..], values[i]);
                offset += bytes_written;
                i += 1;
            }
        } else if (use_neon and values.len >= 4 and buffer.len >= 4) {
            // NEON processing with 4 lanes
            const lanes = 4;
            const Vector4_i32 = @Vector(lanes, i32);
            const Vector4_u32 = @Vector(lanes, u32);
            const Vector4_bool = @Vector(lanes, bool);

            var i: usize = 0;
            while (i + lanes <= values.len and offset + lanes <= buffer.len) {
                // Load values
                var value_block: Vector4_i32 = undefined;
                for (0..lanes) |j| {
                    value_block[j] = values[i + j];
                }

                // Zigzag encode the vector
                const one_vec: Vector4_i32 = @splat(1);
                const thirtyone_vec: Vector4_i32 = @splat(31);
                const shifted_left = value_block << one_vec;
                const shifted_right = value_block >> thirtyone_vec;
                const zigzagged = @as(Vector4_u32, @bitCast(shifted_left ^ shifted_right));

                // Check which values can be encoded in a single byte
                const limit_vec: Vector4_u32 = @splat(128);
                const is_small: Vector4_bool = zigzagged < limit_vec;
                const mask = @as(u4, @bitCast(is_small));

                // If all values are small, we can do efficient single-byte encoding
                if (mask == 0xF) {
                    // All values can be encoded as single bytes
                    for (0..lanes) |j| {
                        buffer[offset + j] = @truncate(zigzagged[j]);
                    }

                    offset += lanes;
                    i += lanes;
                    continue;
                }

                // If not all values are small, fall back to regular encoding
                break;
            }

            // Process remaining values with regular encoder
            while (i < values.len and offset < buffer.len) {
                const bytes_written = encode(buffer[offset..], values[i]);
                offset += bytes_written;
                i += 1;
            }
        } else {
            // No SIMD - use scalar encoding
            for (values) |value| {
                if (offset >= buffer.len) break;
                const bytes_written = encode(buffer[offset..], value);
                offset += bytes_written;
            }
        }

        return offset;
    }

    /// Encode a buffer of double-delta values to base64 format
    /// This is used for inline sourcemaps in the "mappings" property
    pub fn encodeToBase64(allocator: std.mem.Allocator, values: []const i32) ![]u8 {
        // First, encode the values to a temporary buffer
        const max_size = values.len * 4; // Worst case: 4 bytes per value
        var temp_buffer = try allocator.alloc(u8, max_size);
        defer allocator.free(temp_buffer);
        
        // Encode values to the temporary buffer
        const encoded_size = encodeBatch(temp_buffer, values);
        
        // Calculate base64 output size and allocate the result buffer
        const base64_size = bun.base64.encodeLen(encoded_size);
        var result = try allocator.alloc(u8, base64_size);
        errdefer allocator.free(result);
        
        // Encode to base64
        const encoded = bun.base64.encode(result, temp_buffer[0..encoded_size]);
        
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
        
        // Decode the binary data to values
        const values_decoded = decodeBatch(temp_buffer[0..decoded.count], out_values);
        
        return values_decoded;
    }

    /// Convert from zigzag encoding back to signed integer
    fn dezigzag(zigzagged: u32) i32 {
        return @bitCast(zigzagged >> 1 ^ (0 -% (zigzagged & 1)));
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