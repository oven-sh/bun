const std = @import("std");
const bun = @import("root").bun;
const string = bun.string;
const assert = bun.assert;
const strings = bun.strings;

/// SIMD implementation for sourcemap operations
/// This provides accelerated operations using AVX2, NEON, or other SIMD instructions
/// Optimized for both native and WASM targets
pub const SIMDHelpers = struct {
    /// Parallel comparison of line/column values with SIMD
    /// This can search multiple mappings at once for better performance
    pub const SIMDSearch = struct {
        /// Search through an array of line/column pairs to find a match
        /// x86_64 AVX2 implementation
        pub fn findX86_AVX2(
            lines: []const i32,
            columns: []const i32,
            target_line: i32,
            target_column: i32,
        ) ?usize {
            // We use AVX2 to process 8 i32 values at once
            const lanes = 8;
            const len = lines.len;

            if (len < lanes) {
                // For small arrays, use scalar search
                return findScalar(lines, columns, target_line, target_column);
            }

            // Process 8 elements at a time
            const Vector = @Vector(lanes, i32);
            const BoolVector = @Vector(lanes, bool);
            const target_lines: Vector = @splat(target_line);
            const target_columns: Vector = @splat(target_column);

            var i: usize = 0;
            const blocks = len / lanes;

            // Best matching position found so far
            var best_match: ?usize = null;

            // Process full vector blocks
            while (i < blocks) : (i += 1) {
                const offset = i * lanes;

                // Load data into vectors - use proper alignment and slices
                var line_block: Vector = undefined;
                var column_block: Vector = undefined;

                // Efficiently load data - taking into account potential alignment issues
                for (0..lanes) |j| {
                    line_block[j] = lines[offset + j];
                    column_block[j] = columns[offset + j];
                }

                // Check for line matches using SIMD operations
                const line_lt: BoolVector = line_block < target_lines;
                const line_eq: BoolVector = line_block == target_lines;

                // For equal lines, check column conditions
                const col_lte: BoolVector = column_block <= target_columns;

                // Combine conditions:
                // We want mappings where:
                // 1. Line is less than target OR
                // 2. Line equals target AND column is less than or equal to target
                // Handle bool vectors with element-wise operations
                var matches: BoolVector = undefined;
                for (0..lanes) |j| {
                    matches[j] = line_lt[j] or (line_eq[j] and col_lte[j]);
                }

                // Convert boolean vector to an integer mask
                const mask = @as(u8, @bitCast(matches));

                if (mask != 0) {
                    // Some positions matched - find the rightmost match in this vector
                    // That's the highest valid position less than or equal to the target
                    // Count trailing zeros in the inverted mask to find the last set bit
                    const trailing_zeros = @ctz(~mask);

                    if (trailing_zeros > 0) {
                        // We found a match - update the best match position
                        // The position is the bit position minus one
                        best_match = offset + trailing_zeros - 1;
                    }
                }
            }

            // Handle remaining elements that don't fit in a full vector
            const remaining = len % lanes;
            if (remaining > 0) {
                const start = len - remaining;

                // Find best match in the tail portion using scalar search
                if (findScalar(lines[start..], columns[start..], target_line, target_column)) |index| {
                    // If we found a match in the tail, compare with any previous match
                    if (best_match) |prev_match| {
                        // Choose the match that appears later in the sequence
                        if (start + index > prev_match) {
                            return start + index;
                        }
                        return prev_match;
                    } else {
                        return start + index;
                    }
                }
            }

            return best_match;
        }

        /// ARM NEON implementation (if available)
        pub fn findARM_NEON(
            lines: []const i32,
            columns: []const i32,
            target_line: i32,
            target_column: i32,
        ) ?usize {
            // NEON can process 4 i32 values at once
            const lanes = 4;
            const len = lines.len;

            if (len < lanes) {
                // For small arrays, use scalar search
                return findScalar(lines, columns, target_line, target_column);
            }

            // Process 4 elements at a time using proper @Vector syntax
            const Vector = @Vector(lanes, i32);
            const BoolVector = @Vector(lanes, bool);
            const target_lines: Vector = @splat(target_line);
            const target_columns: Vector = @splat(target_column);

            var i: usize = 0;
            const blocks = len / lanes;

            // Track best match position
            var best_match: ?usize = null;

            // Process full vector blocks
            while (i < blocks) : (i += 1) {
                const offset = i * lanes;

                // Load data into vectors with proper handling of alignment
                var line_block: Vector = undefined;
                var column_block: Vector = undefined;

                // Efficiently load data
                for (0..lanes) |j| {
                    line_block[j] = lines[offset + j];
                    column_block[j] = columns[offset + j];
                }

                // Check conditions using vectorized operations
                const line_lt: BoolVector = line_block < target_lines;
                const line_eq: BoolVector = line_block == target_lines;
                const col_lte: BoolVector = column_block <= target_columns;

                // Combine conditions with boolean vector operations
                // We need to convert bool vectors to unsigned integers for bitwise operations
                var matches: BoolVector = undefined;
                for (0..lanes) |j| {
                    matches[j] = line_lt[j] or (line_eq[j] and col_lte[j]);
                }

                // Convert to mask for bit operations (4 lanes = 4 bits)
                const mask = @as(u4, @bitCast(matches));

                if (mask != 0) {
                    // Find the rightmost/highest matching position
                    const trailing_zeros = @ctz(~mask);

                    if (trailing_zeros > 0) {
                        // Update best match - the position is the bit position minus one
                        best_match = offset + trailing_zeros - 1;
                    }
                }
            }

            // Handle remaining elements
            const remaining = len % lanes;
            if (remaining > 0) {
                const start = len - remaining;

                // Process tail elements with scalar search
                if (findScalar(lines[start..], columns[start..], target_line, target_column)) |index| {
                    // Compare with any previous match
                    if (best_match) |prev_match| {
                        // Return the best match (highest index that satisfies the condition)
                        if (start + index > prev_match) {
                            return start + index;
                        }
                        return prev_match;
                    } else {
                        return start + index;
                    }
                }
            }

            return best_match;
        }

        /// WASM SIMD implementation
        pub fn findWASM_SIMD(
            lines: []const i32,
            columns: []const i32,
            target_line: i32,
            target_column: i32,
        ) ?usize {
            // WASM SIMD supports 128-bit vectors (4 i32 elements)
            const lanes = 4;
            const len = lines.len;

            if (len < lanes) {
                // For small arrays, use scalar search
                return findScalar(lines, columns, target_line, target_column);
            }

            // Process 4 elements at a time using @Vector
            const Vector = @Vector(lanes, i32);
            const BoolVector = @Vector(lanes, bool);
            const target_lines: Vector = @splat(target_line);
            const target_columns: Vector = @splat(target_column);

            var i: usize = 0;
            const blocks = len / lanes;

            // Track best match position
            var best_match: ?usize = null;

            // Process full vector blocks
            while (i < blocks) : (i += 1) {
                const offset = i * lanes;

                // Load data into vectors
                var line_block: Vector = undefined;
                var column_block: Vector = undefined;

                // Load data efficiently
                for (0..lanes) |j| {
                    line_block[j] = lines[offset + j];
                    column_block[j] = columns[offset + j];
                }

                // Check conditions with vector operations
                const line_lt: BoolVector = line_block < target_lines;
                const line_eq: BoolVector = line_block == target_lines;
                const col_lte: BoolVector = column_block <= target_columns;

                // Combine conditions using element-wise operations
                var matches: BoolVector = undefined;
                for (0..lanes) |j| {
                    matches[j] = line_lt[j] or (line_eq[j] and col_lte[j]);
                }

                // Convert to mask for bit operations
                const mask = @as(u4, @bitCast(matches));

                if (mask != 0) {
                    // Find rightmost match
                    const trailing_zeros = @ctz(~mask);

                    if (trailing_zeros > 0) {
                        // Update best match
                        best_match = offset + trailing_zeros - 1;
                    }
                }
            }

            // Handle remaining elements
            const remaining = len % lanes;
            if (remaining > 0) {
                const start = len - remaining;

                if (findScalar(lines[start..], columns[start..], target_line, target_column)) |index| {
                    if (best_match) |prev_match| {
                        if (start + index > prev_match) {
                            return start + index;
                        }
                        return prev_match;
                    } else {
                        return start + index;
                    }
                }
            }

            return best_match;
        }

        /// Scalar (non-SIMD) fallback implementation
        pub fn findScalar(
            lines: []const i32,
            columns: []const i32,
            target_line: i32,
            target_column: i32,
        ) ?usize {
            var index: usize = 0;
            var count = lines.len;

            // Binary search through the data
            while (count > 0) {
                const step = count / 2;
                const i = index + step;

                // Check if this mapping is before our target position
                if (lines[i] < target_line or (lines[i] == target_line and columns[i] <= target_column)) {
                    index = i + 1;
                    count -= step + 1;
                } else {
                    count = step;
                }
            }

            if (index > 0) {
                // We want the last mapping that's <= our position
                return index - 1;
            }

            return null;
        }

        /// Dispatcher that selects the best implementation based on architecture
        pub fn find(
            lines: []const i32,
            columns: []const i32,
            target_line: i32,
            target_column: i32,
        ) ?usize {
            // Check for AVX2 support (x86_64)
            if (@import("builtin").cpu.arch == .x86_64) {
                return findX86_AVX2(lines, columns, target_line, target_column);
            }

            // Check for NEON support (ARM)
            if (@import("builtin").cpu.arch == .aarch64) {
                return findARM_NEON(lines, columns, target_line, target_column);
            }

            // Check for WASM SIMD support
            if (@import("builtin").cpu.arch == .wasm32) {
                return findWASM_SIMD(lines, columns, target_line, target_column);
            }

            // Fallback to scalar implementation
            return findScalar(lines, columns, target_line, target_column);
        }
    };

    /// Delta-of-delta processor with SIMD acceleration
    /// This is optimized for the new format where deltas are stored as delta-of-delta values
    pub const DeltaOfDeltaProcessor = struct {
        /// Process a block of delta-of-delta values with AVX2 SIMD
        pub fn processSIMD(
            dod_values: []const i32,
            base_values: []i32,
            results: []i32,
        ) void {
            const lanes = std.simd.suggestVectorLength(i32) orelse 1;
            const len = @min(@min(dod_values.len, base_values.len), results.len);

            if (len < lanes) {
                // Too small for SIMD, use scalar
                return processScalar(dod_values, base_values, results);
            }

            // First, accumulate deltas from delta-of-deltas
            var i: usize = 0;

            // Use Vector types for SIMD operations
            const Vector = @Vector(lanes, i32);

            while (i + lanes <= len) {
                // Load delta-of-delta values
                var dod_block: Vector = undefined;
                for (0..lanes) |j| {
                    dod_block[j] = dod_values[i + j];
                }

                // Load accumulated delta values
                var delta_block: Vector = undefined;
                for (0..lanes) |j| {
                    delta_block[j] = base_values[i + j];
                }

                // Add delta-of-delta to get new delta values
                const new_deltas = delta_block + dod_block;

                // Store results back
                for (0..lanes) |j| {
                    results[i + j] = new_deltas[j];
                }

                i += lanes;
            }

            // Process any remaining with scalar implementation
            if (i < len) {
                processScalar(dod_values[i..], base_values[i..], results[i..]);
            }
        }

        /// Scalar fallback implementation
        pub fn processScalar(
            dod_values: []const i32,
            base_values: []i32,
            results: []i32,
        ) void {
            const len = @min(@min(dod_values.len, base_values.len), results.len);

            for (0..len) |i| {
                // Add delta-of-delta to previous delta to get new delta
                results[i] = base_values[i] + dod_values[i];
            }
        }

        /// Dispatcher that selects the best implementation based on architecture
        pub fn process(
            dod_values: []const i32,
            base_values: []i32,
            results: []i32,
        ) void {
            return processSIMD(dod_values, base_values, results);
        }
    };
};

test "SIMDHelpers.SIMDSearch" {
    const allocator = std.testing.allocator;
    const TestCount = 1000;

    var lines = try allocator.alloc(i32, TestCount);
    defer allocator.free(lines);

    var columns = try allocator.alloc(i32, TestCount);
    defer allocator.free(columns);

    // Setup test data - sorted by line, then column
    for (0..TestCount) |i| {
        lines[i] = @intCast(i / 100); // Each line has 100 columns
        columns[i] = @intCast(i % 100);
    }

    // Test various target positions
    const test_cases = [_]struct { line: i32, column: i32, expected: ?usize }{
        // Line 0, column 50
        .{ .line = 0, .column = 50, .expected = 50 },
        // Line 2, column 25
        .{ .line = 2, .column = 25, .expected = 225 },
        // Line 9, column 99 (last element)
        .{ .line = 9, .column = 99, .expected = 999 },
        // Line 5, column 150 (column beyond range, should find line 5, column 99)
        .{ .line = 5, .column = 150, .expected = 599 },
        // Line 11, column 0 (beyond range, should return null)
        .{ .line = 11, .column = 0, .expected = null },
    };

    for (test_cases) |tc| {
        // Test scalar implementation for reference
        const scalar_result = SIMDHelpers.SIMDSearch.findScalar(lines, columns, tc.line, tc.column);
        try std.testing.expectEqual(tc.expected, scalar_result);

        // Test SIMD dispatcher (uses best available implementation)
        const simd_result = SIMDHelpers.SIMDSearch.find(lines, columns, tc.line, tc.column);
        try std.testing.expectEqual(tc.expected, simd_result);
    }
}

test "SIMDHelpers.DeltaOfDeltaProcessor" {
    const allocator = std.testing.allocator;
    const TestCount = 100;

    var dod_values = try allocator.alloc(i32, TestCount);
    defer allocator.free(dod_values);

    var base_values = try allocator.alloc(i32, TestCount);
    defer allocator.free(base_values);

    const results = try allocator.alloc(i32, TestCount);
    defer allocator.free(results);

    var expected = try allocator.alloc(i32, TestCount);
    defer allocator.free(expected);

    // Setup test data
    for (0..TestCount) |i| {
        dod_values[i] = @mod(@as(i32, @intCast(i)), 5) - 2; // Values between -2 and 2
        base_values[i] = @intCast(i * 2); // Some base values
    }

    // Calculate expected results using scalar method
    for (0..TestCount) |i| {
        expected[i] = base_values[i] + dod_values[i];
    }

    // Test scalar implementation
    std.mem.set(i32, results, 0);
    SIMDHelpers.DeltaOfDeltaProcessor.processScalar(dod_values, base_values, results);
    try std.testing.expectEqualSlices(i32, expected, results);

    // Test SIMD dispatcher
    std.mem.set(i32, results, 0);
    SIMDHelpers.DeltaOfDeltaProcessor.process(dod_values, base_values, results);
    try std.testing.expectEqualSlices(i32, expected, results);
}
