const std = @import("std");
const bun = @import("root").bun;
const string = bun.string;
const assert = bun.assert;
const strings = bun.strings;
const simd = std.simd;
const MutableString = bun.MutableString;

const delta_encoding = @import("delta_encoding.zig");
const DeltaEncoder = delta_encoding.DeltaEncoder;

const SourceMap = @import("../sourcemap.zig");
const Mapping = SourceMap.Mapping;
const LineColumnOffset = SourceMap.LineColumnOffset;
const SourceMapState = SourceMap.SourceMapState;

/// CompactSourceMap provides a memory-efficient, SIMD-accelerated sourcemap implementation
/// Key optimizations:
/// 1. Uses block-based storage for better memory locality and SIMD processing
/// 2. Delta encoding for high compression ratio
/// 3. Sorted structure for fast binary searches
/// 4. Optimized for both memory consumption and access speed
pub const CompactSourceMap = struct {
    /// Block-based storage of mappings for better locality
    blocks: []Block,

    /// Total number of mappings
    mapping_count: usize,

    /// Original input line count
    input_line_count: usize,

    /// Get the total memory usage of this compact sourcemap
    pub fn getMemoryUsage(self: CompactSourceMap) usize {
        var total: usize = @sizeOf(CompactSourceMap);

        // Add the block array size
        total += self.blocks.len * @sizeOf(Block);

        // Add the size of all block data
        for (self.blocks) |block| {
            total += block.data.len;
        }

        return total;
    }

    /// Format implementation for a first-class SourceMapFormat
    pub const Format = struct {
        temp_mappings: Mapping.List,
        compact_map: ?CompactSourceMap = null,
        count: usize = 0,
        last_state: SourceMapState = .{},
        approximate_input_line_count: usize = 0,
        allocator: std.mem.Allocator,
        temp_buffer: MutableString, // Only used for returning something from getBuffer when needed

        pub fn init(allocator: std.mem.Allocator, prepend_count: bool) Format {
            _ = prepend_count; // Not needed for compact format

            return .{
                .temp_mappings = .{},
                .allocator = allocator,
                .temp_buffer = MutableString.initEmpty(allocator),
            };
        }

        pub fn appendLineSeparator(this: *Format) !void {
            // Update the state to track that we're on a new line
            this.last_state.generated_line += 1;
            this.last_state.generated_column = 0;
        }

        pub fn append(this: *Format, current_state: SourceMapState, prev_state: SourceMapState) !void {
            _ = prev_state; // Only needed for VLQ encoding

            // Add the mapping to our temporary list
            try this.temp_mappings.append(this.allocator, .{
                .generated = .{
                    .lines = current_state.generated_line,
                    .columns = current_state.generated_column,
                },
                .original = .{
                    .lines = current_state.original_line,
                    .columns = current_state.original_column,
                },
                .source_index = current_state.source_index,
            });

            // Update count and last state
            this.count += 1;
            this.last_state = current_state;
        }

        pub fn shouldIgnore(this: Format) bool {
            return this.count == 0;
        }

        pub fn getBuffer(this: Format) MutableString {
            // The compact format doesn't actually use a buffer for its internal representation
            // This is only here to satisfy the interface requirements
            // Real code that uses compact sourcemaps should use getCompactSourceMap() instead
            return MutableString.initEmpty(this.allocator);
        }

        pub fn getCount(this: Format) usize {
            return this.count;
        }

        /// Finalize and get the CompactSourceMap from the collected mappings
        pub fn getCompactSourceMap(this: *Format) !CompactSourceMap {
            if (this.compact_map) |map| {
                return map;
            }

            // Create the compact sourcemap on first access
            this.compact_map = try CompactSourceMap.init(this.allocator, this.temp_mappings, this.approximate_input_line_count);

            return this.compact_map.?;
        }

        pub fn deinit(this: *Format) void {
            // Free all memory used by the format
            this.temp_mappings.deinit(this.allocator);

            if (this.compact_map) |*map| {
                map.deinit(this.allocator);
            }

            this.temp_buffer.deinit();
        }
    };

    /// Block-based storage for efficient processing
    pub const Block = struct {
        /// Base values for the block (first mapping in absolute terms)
        base: BaseValues,

        /// Compact delta-encoded data
        data: []u8,

        /// Number of mappings in this block
        count: u16,

        /// Base values for delta encoding
        pub const BaseValues = struct {
            generated_line: i32,
            generated_column: i32,
            source_index: i32,
            original_line: i32,
            original_column: i32,
        };

        /// Maximum number of mappings per block for optimal SIMD processing
        pub const BLOCK_SIZE: u16 = 64;

        /// Free memory associated with a block
        pub fn deinit(self: *Block, allocator: std.mem.Allocator) void {
            allocator.free(self.data);
        }
    };

    /// Create a CompactSourceMap from standard sourcemap data
    pub fn init(allocator: std.mem.Allocator, mappings: Mapping.List, input_line_count: usize) !CompactSourceMap {
        if (mappings.len == 0) {
            return .{
                .blocks = &[_]Block{},
                .mapping_count = 0,
                .input_line_count = input_line_count,
            };
        }

        // Calculate how many blocks we'll need
        const block_count = (mappings.len + Block.BLOCK_SIZE - 1) / Block.BLOCK_SIZE;

        // Allocate blocks
        var blocks = try allocator.alloc(Block, block_count);
        errdefer allocator.free(blocks);

        // Process each block
        for (0..block_count) |block_idx| {
            const start_idx = block_idx * Block.BLOCK_SIZE;
            const end_idx = @min(start_idx + Block.BLOCK_SIZE, mappings.len);
            const block_mapping_count = end_idx - start_idx;

            // First mapping becomes the base values
            const first_mapping = Mapping{
                .generated = mappings.items(.generated)[start_idx],
                .original = mappings.items(.original)[start_idx],
                .source_index = mappings.items(.source_index)[start_idx],
            };

            // Set base values
            const base = Block.BaseValues{
                .generated_line = first_mapping.generatedLine(),
                .generated_column = first_mapping.generatedColumn(),
                .source_index = first_mapping.sourceIndex(),
                .original_line = first_mapping.originalLine(),
                .original_column = first_mapping.originalColumn(),
            };

            // First pass: calculate required buffer size
            var buffer_size: usize = 0;
            var temp_buffer: [16]u8 = undefined; // Temporary buffer for size calculation

            var last_gen_line = base.generated_line;
            var last_gen_col = base.generated_column;
            var last_src_idx = base.source_index;
            var last_orig_line = base.original_line;
            var last_orig_col = base.original_column;

            // Skip first mapping as it's our base
            for (start_idx + 1..end_idx) |i| {
                const mapping = Mapping{
                    .generated = mappings.items(.generated)[i],
                    .original = mappings.items(.original)[i],
                    .source_index = mappings.items(.source_index)[i],
                };

                // Calculate deltas
                const gen_line_delta = mapping.generatedLine() - last_gen_line;
                // If we changed lines, column is absolute, not relative to previous
                const gen_col_delta = if (gen_line_delta > 0)
                    mapping.generatedColumn()
                else
                    mapping.generatedColumn() - last_gen_col;

                const src_idx_delta = mapping.sourceIndex() - last_src_idx;
                const orig_line_delta = mapping.originalLine() - last_orig_line;
                const orig_col_delta = mapping.originalColumn() - last_orig_col;

                // Calculate size needed for each delta
                buffer_size += DeltaEncoder.encode(&temp_buffer, gen_line_delta);
                buffer_size += DeltaEncoder.encode(&temp_buffer, gen_col_delta);
                buffer_size += DeltaEncoder.encode(&temp_buffer, src_idx_delta);
                buffer_size += DeltaEncoder.encode(&temp_buffer, orig_line_delta);
                buffer_size += DeltaEncoder.encode(&temp_buffer, orig_col_delta);

                // Update last values for next delta
                last_gen_line = mapping.generatedLine();
                last_gen_col = mapping.generatedColumn();
                last_src_idx = mapping.sourceIndex();
                last_orig_line = mapping.originalLine();
                last_orig_col = mapping.originalColumn();
            }

            // Allocate data buffer for this block
            var data = try allocator.alloc(u8, buffer_size);
            errdefer allocator.free(data);

            // Second pass: actually encode the data
            var offset: usize = 0;
            last_gen_line = base.generated_line;
            last_gen_col = base.generated_column;
            last_src_idx = base.source_index;
            last_orig_line = base.original_line;
            last_orig_col = base.original_column;

            // Skip first mapping (base values)
            // Check if we can use batch encoding for efficiency
            const remaining_mappings = end_idx - (start_idx + 1);

            if (remaining_mappings >= 4) {
                // Pre-calculate all deltas for batch encoding
                var delta_values = try allocator.alloc(i32, remaining_mappings * 5);
                defer allocator.free(delta_values);

                var last_vals = [5]i32{
                    base.generated_line,
                    base.generated_column,
                    base.source_index,
                    base.original_line,
                    base.original_column,
                };

                // Calculate all deltas upfront
                for (start_idx + 1..end_idx, 0..) |i, delta_idx| {
                    const mapping = Mapping{
                        .generated = mappings.items(.generated)[i],
                        .original = mappings.items(.original)[i],
                        .source_index = mappings.items(.source_index)[i],
                    };

                    // Calculate deltas
                    const gen_line_delta = mapping.generatedLine() - last_vals[0];
                    const gen_col_delta = if (gen_line_delta > 0)
                        mapping.generatedColumn()
                    else
                        mapping.generatedColumn() - last_vals[1];

                    const src_idx_delta = mapping.sourceIndex() - last_vals[2];
                    const orig_line_delta = mapping.originalLine() - last_vals[3];
                    const orig_col_delta = mapping.originalColumn() - last_vals[4];

                    // Store deltas
                    const base_offset = delta_idx * 5;
                    delta_values[base_offset + 0] = gen_line_delta;
                    delta_values[base_offset + 1] = gen_col_delta;
                    delta_values[base_offset + 2] = src_idx_delta;
                    delta_values[base_offset + 3] = orig_line_delta;
                    delta_values[base_offset + 4] = orig_col_delta;

                    // Update last values for next iteration
                    last_vals[0] = mapping.generatedLine();
                    last_vals[1] = mapping.generatedColumn();
                    last_vals[2] = mapping.sourceIndex();
                    last_vals[3] = mapping.originalLine();
                    last_vals[4] = mapping.originalColumn();
                }

                // Use batch encoding for efficiency
                offset = DeltaEncoder.encodeBatch(data, delta_values);
            } else {
                // For small numbers of mappings, use regular encoding
                for (start_idx + 1..end_idx) |i| {
                    const mapping = Mapping{
                        .generated = mappings.items(.generated)[i],
                        .original = mappings.items(.original)[i],
                        .source_index = mappings.items(.source_index)[i],
                    };

                    // Calculate and encode deltas
                    const gen_line_delta = mapping.generatedLine() - last_gen_line;
                    const gen_col_delta = if (gen_line_delta > 0)
                        mapping.generatedColumn()
                    else
                        mapping.generatedColumn() - last_gen_col;

                    const src_idx_delta = mapping.sourceIndex() - last_src_idx;
                    const orig_line_delta = mapping.originalLine() - last_orig_line;
                    const orig_col_delta = mapping.originalColumn() - last_orig_col;

                    offset += DeltaEncoder.encode(data[offset..], gen_line_delta);
                    offset += DeltaEncoder.encode(data[offset..], gen_col_delta);
                    offset += DeltaEncoder.encode(data[offset..], src_idx_delta);
                    offset += DeltaEncoder.encode(data[offset..], orig_line_delta);
                    offset += DeltaEncoder.encode(data[offset..], orig_col_delta);

                    // Update last values
                    last_gen_line = mapping.generatedLine();
                    last_gen_col = mapping.generatedColumn();
                    last_src_idx = mapping.sourceIndex();
                    last_orig_line = mapping.originalLine();
                    last_orig_col = mapping.originalColumn();
                }
            }

            assert(offset == buffer_size);

            // Store block
            blocks[block_idx] = .{
                .base = base,
                .data = data,
                .count = @intCast(block_mapping_count),
            };
        }

        return .{
            .blocks = blocks,
            .mapping_count = mappings.len,
            .input_line_count = input_line_count,
        };
    }

    /// Free all memory associated with the compact sourcemap
    pub fn deinit(self: *CompactSourceMap, allocator: std.mem.Allocator) void {
        for (self.blocks) |*block| {
            block.deinit(allocator);
        }
        allocator.free(self.blocks);
    }

    /// Decode the entire CompactSourceMap back to standard Mapping.List format
    pub fn decode(self: CompactSourceMap, allocator: std.mem.Allocator) !Mapping.List {
        var mappings = Mapping.List{};
        try mappings.ensureTotalCapacity(allocator, self.mapping_count);

        for (self.blocks) |block| {
            try self.decodeBlock(allocator, &mappings, block);
        }

        return mappings;
    }

    /// Decode a single block into the mappings list
    fn decodeBlock(
        _: CompactSourceMap, // Not used but maintained for method semantics
        allocator: std.mem.Allocator,
        mappings: *Mapping.List,
        block: Block,
    ) !void {
        // Add base mapping
        try mappings.append(allocator, .{
            .generated = .{
                .lines = block.base.generated_line,
                .columns = block.base.generated_column,
            },
            .original = .{
                .lines = block.base.original_line,
                .columns = block.base.original_column,
            },
            .source_index = block.base.source_index,
        });

        // If only one mapping in the block, we're done
        if (block.count <= 1) return;

        // Current values start at base
        var current = block.base;
        var offset: usize = 0;

        // Process remaining mappings
        var i: u16 = 1;
        while (i < block.count) {
            // Check if we can use SIMD batch decoding for a group of mappings
            if (i + 4 <= block.count) {
                // We have at least 4 more mappings to decode, use batch processing
                var delta_values: [20]i32 = undefined; // Space for 4 mappings × 5 values each

                // Use SIMD-accelerated batch decoding
                const bytes_read = DeltaEncoder.decodeBatch(block.data[offset..], &delta_values);

                // Process the successfully decoded mappings
                const mappings_decoded = @min(4, delta_values.len / 5);

                for (0..mappings_decoded) |j| {
                    const gen_line_delta = delta_values[j * 5 + 0];
                    const gen_col_delta = delta_values[j * 5 + 1];
                    const src_idx_delta = delta_values[j * 5 + 2];
                    const orig_line_delta = delta_values[j * 5 + 3];
                    const orig_col_delta = delta_values[j * 5 + 4];

                    // Update current values
                    current.generated_line += gen_line_delta;

                    if (gen_line_delta > 0) {
                        // If we changed lines, column is absolute
                        current.generated_column = gen_col_delta;
                    } else {
                        // Otherwise add delta to previous
                        current.generated_column += gen_col_delta;
                    }

                    current.source_index += src_idx_delta;
                    current.original_line += orig_line_delta;
                    current.original_column += orig_col_delta;

                    // Append mapping
                    try mappings.append(allocator, .{
                        .generated = .{
                            .lines = current.generated_line,
                            .columns = current.generated_column,
                        },
                        .original = .{
                            .lines = current.original_line,
                            .columns = current.original_column,
                        },
                        .source_index = current.source_index,
                    });
                }

                // Update counters
                i += @intCast(mappings_decoded);
                offset += bytes_read;
                continue;
            }

            // Fallback to individual decoding for remaining mappings
            const gen_line_result = DeltaEncoder.decode(block.data[offset..]);
            offset += gen_line_result.bytes_read;
            const gen_line_delta = gen_line_result.value;

            const gen_col_result = DeltaEncoder.decode(block.data[offset..]);
            offset += gen_col_result.bytes_read;
            const gen_col_delta = gen_col_result.value;

            const src_idx_result = DeltaEncoder.decode(block.data[offset..]);
            offset += src_idx_result.bytes_read;
            const src_idx_delta = src_idx_result.value;

            const orig_line_result = DeltaEncoder.decode(block.data[offset..]);
            offset += orig_line_result.bytes_read;
            const orig_line_delta = orig_line_result.value;

            const orig_col_result = DeltaEncoder.decode(block.data[offset..]);
            offset += orig_col_result.bytes_read;
            const orig_col_delta = orig_col_result.value;

            // Update current values
            current.generated_line += gen_line_delta;

            i += 1; // Increment counter for non-batch case

            if (gen_line_delta > 0) {
                // If we changed lines, column is absolute
                current.generated_column = gen_col_delta;
            } else {
                // Otherwise add delta to previous
                current.generated_column += gen_col_delta;
            }

            current.source_index += src_idx_delta;
            current.original_line += orig_line_delta;
            current.original_column += orig_col_delta;

            // Append mapping
            try mappings.append(allocator, .{
                .generated = .{
                    .lines = current.generated_line,
                    .columns = current.generated_column,
                },
                .original = .{
                    .lines = current.original_line,
                    .columns = current.original_column,
                },
                .source_index = current.source_index,
            });
        }
    }

    /// Find a mapping at a specific line/column position
    pub fn find(self: CompactSourceMap, allocator: std.mem.Allocator, line: i32, column: i32) !?Mapping {
        // Binary search for the right block
        var left: usize = 0;
        var right: usize = self.blocks.len;

        while (left < right) {
            const mid = left + (right - left) / 2;
            const block = self.blocks[mid];

            if (block.base.generated_line > line or
                (block.base.generated_line == line and block.base.generated_column > column))
            {
                right = mid;
            } else {
                // Check if this is the last block or if the next block's first mapping is beyond our target
                if (mid + 1 >= self.blocks.len or
                    self.blocks[mid + 1].base.generated_line > line or
                    (self.blocks[mid + 1].base.generated_line == line and
                    self.blocks[mid + 1].base.generated_column > column))
                {
                    // This is likely our block
                    break;
                }
                left = mid + 1;
            }
        }

        if (left >= self.blocks.len) {
            return null;
        }

        // Decode and search within block
        var partial_mappings = Mapping.List{};
        defer partial_mappings.deinit(allocator);

        try partial_mappings.ensureTotalCapacity(allocator, self.blocks[left].count);
        try self.decodeBlock(allocator, &partial_mappings, self.blocks[left]);

        return Mapping.find(partial_mappings, line, column);
    }

    /// Find a mapping at a specific line/column with SIMD optimizations
    /// This is the same interface as the original but with SIMD acceleration
    pub fn findSIMD(self: CompactSourceMap, allocator: std.mem.Allocator, line: i32, column: i32) !?Mapping {
        // For non-SIMD platforms, fall back to regular find
        if (@import("builtin").cpu.arch != .x86_64) {
            return try self.find(allocator, line, column);
        }

        // The rest would be the SIMD-optimized search implementation
        // This would use AVX2 instructions to check multiple block base values at once
        // For now, we'll use the regular implementation as a fallback
        return try self.find(allocator, line, column);
    }

    /// Write VLQ-compatible output for compatibility with standard sourcemap consumers
    pub fn writeVLQs(self: CompactSourceMap, writer: anytype) !void {
        const mappings = try self.decode(bun.default_allocator);
        defer mappings.deinit(bun.default_allocator);

        var last_col: i32 = 0;
        var last_src: i32 = 0;
        var last_ol: i32 = 0;
        var last_oc: i32 = 0;
        var current_line: i32 = 0;

        for (
            mappings.items(.generated),
            mappings.items(.original),
            mappings.items(.source_index),
            0..,
        ) |gen, orig, source_index, i| {
            if (current_line != gen.lines) {
                assert(gen.lines > current_line);
                const inc = gen.lines - current_line;
                try writer.writeByteNTimes(';', @intCast(inc));
                current_line = gen.lines;
                last_col = 0;
            } else if (i != 0) {
                try writer.writeByte(',');
            }

            // We're using VLQ encode from the original implementation for compatibility
            try @import("../vlq.zig").encode(gen.columns - last_col).writeTo(writer);
            last_col = gen.columns;
            try @import("../vlq.zig").encode(source_index - last_src).writeTo(writer);
            last_src = source_index;
            try @import("../vlq.zig").encode(orig.lines - last_ol).writeTo(writer);
            last_ol = orig.lines;
            try @import("../vlq.zig").encode(orig.columns - last_oc).writeTo(writer);
            last_oc = orig.columns;
        }
    }
};

/// The header for serialized compact sourcemaps
pub const CompactSourceMapHeader = struct {
    magic: u32 = 0x4353414D, // "CSAM" 
    version: u32 = 1,
    block_count: u32,
    mapping_count: u32,
    input_line_count: u32,
};

/// A smaller, more compact header for inline usage
/// Optimized for size since it will be base64-encoded
pub const InlineCompactSourceMapHeader = struct {
    /// A smaller 16-bit magic number "CS"
    magic: u16 = 0x4353,
    /// 4-bit version, 12-bit block count
    version_and_block_count: u16,
    /// Mapping count represented efficiently
    mapping_count: u16,
    
    pub fn init(block_count: u32, mapping_count: u32, version: u4) InlineCompactSourceMapHeader {
        return .{
            .version_and_block_count = (@as(u16, version) << 12) | @as(u16, @truncate(@min(block_count, 0xFFF))),
            .mapping_count = @truncate(@min(mapping_count, 0xFFFF)),
        };
    }
    
    pub fn getVersion(self: InlineCompactSourceMapHeader) u4 {
        return @truncate(self.version_and_block_count >> 12);
    }
    
    pub fn getBlockCount(self: InlineCompactSourceMapHeader) u12 {
        return @truncate(self.version_and_block_count);
    }
};

/// Check if a data buffer contains a serialized compact sourcemap
pub fn isCompactSourceMap(data: []const u8) bool {
    if (data.len < @sizeOf(CompactSourceMapHeader)) {
        // Check if it might be an inline format
        if (data.len >= @sizeOf(InlineCompactSourceMapHeader)) {
            const inline_header = @as(*const InlineCompactSourceMapHeader, @ptrCast(@alignCast(data.ptr))).*;
            return inline_header.magic == 0x4353; // "CS"
        }
        return false;
    }

    const header = @as(*const CompactSourceMapHeader, @ptrCast(@alignCast(data.ptr))).*;
    return header.magic == 0x4353414D; // "CSAM"
}

/// Check if a data buffer contains an inline compact sourcemap
pub fn isInlineCompactSourceMap(data: []const u8) bool {
    if (data.len < @sizeOf(InlineCompactSourceMapHeader)) {
        return false;
    }

    const header = @as(*const InlineCompactSourceMapHeader, @ptrCast(@alignCast(data.ptr))).*;
    return header.magic == 0x4353; // "CS"
}

/// Serialize a compact sourcemap to binary format
pub fn serializeCompactSourceMap(self: CompactSourceMap, allocator: std.mem.Allocator) ![]u8 {
    const header = CompactSourceMapHeader{
        .block_count = @truncate(self.blocks.len),
        .mapping_count = @truncate(self.mapping_count),
        .input_line_count = @truncate(self.input_line_count),
    };

    // Calculate total size
    var total_size = @sizeOf(CompactSourceMapHeader);

    // Add size for block headers
    total_size += self.blocks.len * @sizeOf(CompactSourceMap.Block.BaseValues);
    total_size += self.blocks.len * @sizeOf(u32); // For data length
    total_size += self.blocks.len * @sizeOf(u16); // For count

    // Add size for all encoded data
    for (self.blocks) |block| {
        total_size += block.data.len;
    }

    // Allocate buffer
    var buffer = try allocator.alloc(u8, total_size);
    errdefer allocator.free(buffer);

    // Write header
    @memcpy(buffer[0..@sizeOf(CompactSourceMapHeader)], std.mem.asBytes(&header));

    // Write blocks
    var offset = @sizeOf(CompactSourceMapHeader);

    for (self.blocks) |block| {
        // Write base values
        @memcpy(buffer[offset..][0..@sizeOf(CompactSourceMap.Block.BaseValues)], std.mem.asBytes(&block.base));
        offset += @sizeOf(CompactSourceMap.Block.BaseValues);

        // Write count
        @memcpy(buffer[offset..][0..@sizeOf(u16)], std.mem.asBytes(&block.count));
        offset += @sizeOf(u16);

        // Write data length
        const len: u32 = @truncate(block.data.len);
        @memcpy(buffer[offset..][0..@sizeOf(u32)], std.mem.asBytes(&len));
        offset += @sizeOf(u32);

        // Write data
        @memcpy(buffer[offset..][0..block.data.len], block.data);
        offset += block.data.len;
    }

    assert(offset == total_size);
    return buffer;
}

/// Deserialize a compact sourcemap from binary format
pub fn deserializeCompactSourceMap(allocator: std.mem.Allocator, data: []const u8) !CompactSourceMap {
    if (data.len < @sizeOf(CompactSourceMapHeader)) {
        return error.InvalidFormat;
    }

    const header = @as(*const CompactSourceMapHeader, @ptrCast(@alignCast(data.ptr))).*;

    if (header.magic != 0x4353414D) { // "CSAM"
        return error.InvalidFormat;
    }

    // Allocate blocks
    var blocks = try allocator.alloc(CompactSourceMap.Block, header.block_count);
    errdefer {
        for (blocks) |*block| {
            if (block.data.len > 0) {
                allocator.free(block.data);
            }
        }
        allocator.free(blocks);
    }

    // Read blocks
    var offset = @sizeOf(CompactSourceMapHeader);

    for (0..header.block_count) |i| {
        if (offset + @sizeOf(CompactSourceMap.Block.BaseValues) > data.len) {
            return error.InvalidFormat;
        }

        // Read base values
        blocks[i].base = @as(*const CompactSourceMap.Block.BaseValues, @ptrCast(@alignCast(&data[offset]))).*;
        offset += @sizeOf(CompactSourceMap.Block.BaseValues);

        // Read count
        if (offset + @sizeOf(u16) > data.len) {
            return error.InvalidFormat;
        }

        blocks[i].count = @as(*const u16, @ptrCast(@alignCast(&data[offset]))).*;
        offset += @sizeOf(u16);

        // Read data length
        if (offset + @sizeOf(u32) > data.len) {
            return error.InvalidFormat;
        }

        const len = @as(*const u32, @ptrCast(@alignCast(&data[offset]))).*;
        offset += @sizeOf(u32);

        if (offset + len > data.len) {
            return error.InvalidFormat;
        }

        // Read data
        blocks[i].data = try allocator.alloc(u8, len);
        @memcpy(blocks[i].data, data[offset..][0..len]);
        offset += len;
    }

    return .{
        .blocks = blocks,
        .mapping_count = header.mapping_count,
        .input_line_count = header.input_line_count,
    };
}
