const std = @import("std");
// Import bun directly, don't re-export it
const bun = @import("root").bun;
const string = bun.string;
const assert = bun.assert;
const strings = bun.strings;

const SourceMap = @import("sourcemap.zig");
const Mapping = SourceMap.Mapping;
const LineColumnOffset = SourceMap.LineColumnOffset;

/// Import and re-export the compact sourcemap implementation
pub const double_delta_encoding = @import("compact/delta_encoding.zig");
pub const simd_helpers = @import("compact/simd_helpers.zig");

pub const DoubleDeltaEncoder = double_delta_encoding.DoubleDeltaEncoder;
pub const SIMDHelpers = simd_helpers.SIMDHelpers;
pub const CompactSourceMap = @This();

/// Magic bytes to identify a compact sourcemap
pub const MAGIC: u32 = 0x43534D32; // "CSM2"
pub const VERSION: u32 = 1;

/// Block-based storage of mappings for better locality
blocks: std.ArrayListUnmanaged(Block) = .{},

/// Total number of mappings
mapping_count: usize = 0,

/// Original input line count
input_line_count: usize = 0,

/// Sources count (for validation purposes)
sources_count: usize = 0,

/// Current block being built
current_block: Block = Block{
    .base = .{
        .generated_line = 0,
        .generated_column = 0,
        .original_line = 0,
        .original_column = 0,
        .source_index = 0,
    },
    .data = &[_]u8{},
    .count = 0,
},

/// Mapping count in current block
current_block_count: u16 = 0,

/// Current block buffer for encoding data
current_block_buffer: std.ArrayListUnmanaged(u8) = .{},

/// Last mapping for delta calculations
last_mapping: Mapping = .{
    .generated = .{
        .lines = 0,
        .columns = 0,
    },
    .original = .{
        .lines = 0,
        .columns = 0,
    },
    .source_index = 0,
},
/// Previous delta values for double-delta encoding
prev_deltas: struct {
    gen_line: i32 = 0,
    gen_col: i32 = 0,
    src_idx: i32 = 0,
    orig_line: i32 = 0,
    orig_col: i32 = 0,
} = .{},

/// The allocator to use for all memory operations
allocator: std.mem.Allocator,

/// The Format type is the builder API for incrementally creating a CompactSourceMap
pub const Format = struct {
    /// Reference to the actual compact sourcemap being built incrementally
    map: CompactSourceMap,

    /// Last mapping state for delta calculations
    last_state: SourceMap.SourceMapState = .{},

    /// Track approximate source line count for optimizations
    approximate_input_line_count: usize = 0,

    /// Base64-encoded mappings for inline sourcemaps (cache)
    base64_mappings: ?[]u8 = null,

    /// Temporary buffer for compatibility with the SourceMapFormat interface
    temp_buffer: bun.MutableString,

    pub fn init(allocator: std.mem.Allocator, _: bool) Format {
        // Create a new compact sourcemap with minimal initialization
        const new_map = allocator.create(CompactSourceMap) catch unreachable;

        new_map.* = CompactSourceMap{
            .blocks = .{},
            .mapping_count = 1,
            .input_line_count = 0,
            .sources_count = 0,
            .current_block_count = 1,
            .current_block_buffer = .{},
            .current_block = Block.fromMapping(.{
                .generated = .{ .lines = 0, .columns = 0 },
                .original = .{ .lines = 0, .columns = 0 },
                .source_index = 0,
            }),
            .last_mapping = .{
                .generated = .{ .lines = 0, .columns = 0 },
                .original = .{ .lines = 0, .columns = 0 },
                .source_index = 0,
            },
            .prev_deltas = .{},
            .allocator = allocator,
        };

        return .{
            .map = new_map.*,
            .temp_buffer = bun.MutableString.initEmpty(allocator),
        };
    }

    pub fn appendLineSeparator(this: *Format) !void {
        // Update the state to track that we're on a new line
        this.last_state.generated_line += 1;
        this.last_state.generated_column = 0;
    }

    pub fn append(this: *Format, current_state: SourceMap.SourceMapState, prev_state: SourceMap.SourceMapState) !void {
        _ = prev_state; // Only needed for VLQ encoding

        // Create the current mapping
        const mapping = Mapping{
            .generated = .{
                .lines = current_state.generated_line,
                .columns = current_state.generated_column,
            },
            .original = .{
                .lines = current_state.original_line,
                .columns = current_state.original_column,
            },
            .source_index = current_state.source_index,
        };

        // Track sources count for validation
        if (current_state.source_index >= 0) {
            this.map.sources_count = @max(this.map.sources_count, @as(usize, @intCast(current_state.source_index)) + 1);
        }

        // Directly add the mapping to the compact sourcemap
        try this.map.addMapping(mapping);

        // Update state
        this.last_state = current_state;

        // Clear any cached base64 mappings since we've modified the data
        if (this.base64_mappings) |mappings| {
            this.map.allocator.free(mappings);
            this.base64_mappings = null;
        }
    }

    pub fn shouldIgnore(this: Format) bool {
        return this.map.mapping_count == 0;
    }

    pub fn getBuffer(this: Format) bun.MutableString {
        // The compact format doesn't actually use a buffer for its internal representation
        // This is only here to satisfy the interface requirements
        return this.temp_buffer;
    }

    pub fn getCount(this: Format) usize {
        return this.map.mapping_count;
    }

    /// Finalize and get the CompactSourceMap reference
    pub fn getCompactSourceMap(this: *Format) !CompactSourceMap {
        // Finalize any pending block
        try this.map.finalizeCurrentBlock();

        // Update input line count from our tracking
        this.map.input_line_count = this.approximate_input_line_count;

        return this.map.*;
    }

    /// Get base64-encoded mappings for inline sourcemaps
    pub fn getBase64Mappings(this: *Format) ![]const u8 {
        // Return cached base64 mappings if available
        if (this.base64_mappings) |mappings| {
            return mappings;
        }

        // Finalize any pending block
        try this.map.finalizeCurrentBlock();

        // Create a complete map of all blocks
        const map = this.map;

        // Get base64 encoding directly from the compact map
        this.base64_mappings = try map.getInlineBase64(map.allocator);

        return this.base64_mappings.?;
    }

    pub fn deinit(this: *Format) void {
        // Free the compact map (which will free all the blocks)
        this.map.deinit();

        // Free the map struct itself
        this.map.allocator.destroy(this.map);

        // Free the base64 cache if any
        if (this.base64_mappings) |mappings| {
            this.map.allocator.free(mappings);
        }

        // Free the temporary buffer
        this.temp_buffer.deinit();
    }
};

/// Block-based storage for efficient processing
pub const Block = struct {
    /// Base values for the block (first mapping in absolute terms)
    base: BaseValues,

    /// Compact double-delta encoded data
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

    /// Create an empty block with the given base values
    pub fn init(base_values: BaseValues) Block {
        return .{
            .base = base_values,
            .data = &[_]u8{},
            .count = 1, // Base mapping counts as 1
        };
    }

    /// Create an empty block from a mapping
    pub fn fromMapping(mapping: Mapping) Block {
        return Block.init(.{
            .generated_line = mapping.generatedLine(),
            .generated_column = mapping.generatedColumn(),
            .source_index = mapping.sourceIndex(),
            .original_line = mapping.originalLine(),
            .original_column = mapping.originalColumn(),
        });
    }

    /// Free memory associated with a block
    pub fn deinit(self: *Block, allocator: std.mem.Allocator) void {
        if (self.data.len > 0) {
            allocator.free(self.data);
        }
    }
};

/// Create a new, empty CompactSourceMap
pub fn create(allocator: std.mem.Allocator) !CompactSourceMap {
    return CompactSourceMap{
        .blocks = std.ArrayList(Block).init(allocator),
        .mapping_count = 0,
        .input_line_count = 0,
        .sources_count = 0,
        .current_block_count = 0,
        .current_block_buffer = std.ArrayList(u8).init(allocator),
        .current_block = undefined, // Will be initialized on first mapping
        .last_mapping = undefined, // Will be initialized on first mapping
        .prev_deltas = .{},
        .allocator = allocator,
    };
}

/// Add a new mapping to the sourcemap incrementally
pub fn addMapping(self: *CompactSourceMap, mapping: Mapping) !void {
    // Handle the first mapping which initializes the first block
    if (self.mapping_count == 0) {
        self.current_block = Block.fromMapping(mapping);
        self.last_mapping = mapping;
        self.mapping_count = 1;
        self.current_block_count = 1;
        return;
    }

    // Check if we need to start a new block
    if (self.current_block_count >= Block.BLOCK_SIZE) {
        try self.finalizeCurrentBlock();

        // Start a new block with this mapping as the base
        self.current_block = Block.fromMapping(mapping);
        self.last_mapping = mapping;
        self.current_block_count = 1;
        self.prev_deltas = .{};
        self.mapping_count += 1;
        return;
    }

    // Calculate deltas from the last mapping
    const gen_line_delta = mapping.generatedLine() - self.last_mapping.generatedLine();
    const gen_col_delta = if (gen_line_delta > 0)
        mapping.generatedColumn() // If we changed lines, column is absolute
    else
        mapping.generatedColumn() - self.last_mapping.generatedColumn();

    const src_idx_delta = mapping.sourceIndex() - self.last_mapping.sourceIndex();
    const orig_line_delta = mapping.originalLine() - self.last_mapping.originalLine();
    const orig_col_delta = mapping.originalColumn() - self.last_mapping.originalColumn();

    // Calculate double-delta values
    const gen_line_dod = gen_line_delta - self.prev_deltas.gen_line;
    const gen_col_dod = gen_col_delta - self.prev_deltas.gen_col;
    const src_idx_dod = src_idx_delta - self.prev_deltas.src_idx;
    const orig_line_dod = orig_line_delta - self.prev_deltas.orig_line;
    const orig_col_dod = orig_col_delta - self.prev_deltas.orig_col;

    // Encode and append to the current block buffer
    var temp_buffer: [16]u8 = undefined;

    // Ensure we have capacity in the buffer
    try self.current_block_buffer.ensureUnusedCapacity(self.allocator, 20); // Overestimate for safety

    // Encode each value
    const gen_line_size = DoubleDeltaEncoder.encode(&temp_buffer, gen_line_dod);
    try self.current_block_buffer.appendSlice(self.allocator, temp_buffer[0..gen_line_size]);

    const gen_col_size = DoubleDeltaEncoder.encode(&temp_buffer, gen_col_dod);
    try self.current_block_buffer.appendSlice(self.allocator, temp_buffer[0..gen_col_size]);

    const src_idx_size = DoubleDeltaEncoder.encode(&temp_buffer, src_idx_dod);
    try self.current_block_buffer.appendSlice(self.allocator, temp_buffer[0..src_idx_size]);

    const orig_line_size = DoubleDeltaEncoder.encode(&temp_buffer, orig_line_dod);
    try self.current_block_buffer.appendSlice(self.allocator, temp_buffer[0..orig_line_size]);

    const orig_col_size = DoubleDeltaEncoder.encode(&temp_buffer, orig_col_dod);
    try self.current_block_buffer.appendSlice(self.allocator, temp_buffer[0..orig_col_size]);

    // Update last deltas for next double-delta calculation
    self.prev_deltas.gen_line = gen_line_delta;
    self.prev_deltas.gen_col = gen_col_delta;
    self.prev_deltas.src_idx = src_idx_delta;
    self.prev_deltas.orig_line = orig_line_delta;
    self.prev_deltas.orig_col = orig_col_delta;

    // Update last mapping and counts
    self.last_mapping = mapping;
    self.current_block_count += 1;
    self.mapping_count += 1;
}

/// Finalize the current block and add it to blocks list
fn finalizeCurrentBlock(self: *CompactSourceMap) !void {
    if (self.current_block_count <= 1) {
        return; // Only base mapping, nothing to do
    }

    // Allocate and copy the data from the buffer
    const data = try self.allocator.alloc(u8, self.current_block_buffer.items.len);
    @memcpy(data, self.current_block_buffer.items);

    // Set the data and count on the current block
    self.current_block.data = data;
    self.current_block.count = self.current_block_count;

    // Add to blocks
    try self.blocks.append(self.allocator, self.current_block);

    // We keep all blocks in memory for JavaScript files which can be large

    // Reset the current block buffer
    self.current_block_buffer.clearRetainingCapacity();
}

/// Const version of finalizeCurrentBlock that can work with const CompactSourceMap
/// This doesn't actually modify the structure, just ensures no pending work is lost
fn finalizeCurrentBlockConst(self: *const CompactSourceMap) !void {
    // If we're a const reference, we don't actually finalize anything
    // This is just for compatibility with code that calls this method on a const ref
    return;
}

/// Get the total memory usage of this compact sourcemap
pub fn getMemoryUsage(self: CompactSourceMap) usize {
    var total: usize = @sizeOf(CompactSourceMap);

    // Add the block array size
    total += self.blocks.items.len * @sizeOf(Block);

    // Add the size of all block data
    for (self.blocks.items) |block| {
        total += block.data.len;
    }

    // Add current block buffer size
    total += self.current_block_buffer.items.len;

    return total;
}

/// Create a CompactSourceMap from standard sourcemap data
pub fn init(
    allocator: std.mem.Allocator,
    mappings: Mapping.List,
    input_line_count: usize,
    sources_count: usize,
) !CompactSourceMap {
    if (mappings.len == 0) {
        return .{
            .blocks = &[_]Block{},
            .mapping_count = 0,
            .input_line_count = input_line_count,
            .sources_count = sources_count,
        };
    }

    // Calculate how many blocks we'll need
    const block_count = (mappings.len + Block.BLOCK_SIZE - 1) / Block.BLOCK_SIZE;

    // Allocate blocks
    var blocks = std.ArrayListUnmanaged(Block){};
    errdefer blocks.deinit(allocator);

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

        // These track the last absolute values
        var last_gen_line = base.generated_line;
        var last_gen_col = base.generated_column;
        var last_src_idx = base.source_index;
        var last_orig_line = base.original_line;
        var last_orig_col = base.original_column;

        // These track the last delta values (for double-delta encoding)
        var last_gen_line_delta: i32 = 0;
        var last_gen_col_delta: i32 = 0;
        var last_src_idx_delta: i32 = 0;
        var last_orig_line_delta: i32 = 0;
        var last_orig_col_delta: i32 = 0;

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

            // Calculate double-delta values
            const gen_line_dod = gen_line_delta - last_gen_line_delta;
            const gen_col_dod = gen_col_delta - last_gen_col_delta;
            const src_idx_dod = src_idx_delta - last_src_idx_delta;
            const orig_line_dod = orig_line_delta - last_orig_line_delta;
            const orig_col_dod = orig_col_delta - last_orig_col_delta;

            // Calculate size needed for each double-delta
            buffer_size += DoubleDeltaEncoder.encode(&temp_buffer, gen_line_dod);
            buffer_size += DoubleDeltaEncoder.encode(&temp_buffer, gen_col_dod);
            buffer_size += DoubleDeltaEncoder.encode(&temp_buffer, src_idx_dod);
            buffer_size += DoubleDeltaEncoder.encode(&temp_buffer, orig_line_dod);
            buffer_size += DoubleDeltaEncoder.encode(&temp_buffer, orig_col_dod);

            // Update last values for next delta
            last_gen_line = mapping.generatedLine();
            last_gen_col = mapping.generatedColumn();
            last_src_idx = mapping.sourceIndex();
            last_orig_line = mapping.originalLine();
            last_orig_col = mapping.originalColumn();

            // Update last delta values for next double-delta
            last_gen_line_delta = gen_line_delta;
            last_gen_col_delta = gen_col_delta;
            last_src_idx_delta = src_idx_delta;
            last_orig_line_delta = orig_line_delta;
            last_orig_col_delta = orig_col_delta;
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

        // Reset delta tracking for second pass
        last_gen_line_delta = 0;
        last_gen_col_delta = 0;
        last_src_idx_delta = 0;
        last_orig_line_delta = 0;
        last_orig_col_delta = 0;

        // Skip first mapping (base values)
        // Check if we can use batch encoding for efficiency
        const remaining_mappings = end_idx - (start_idx + 1);

        if (remaining_mappings >= 4) {
            // Pre-calculate all double-delta values for batch encoding
            var dod_values = try allocator.alloc(i32, remaining_mappings * 5);
            defer allocator.free(dod_values);

            // Reset tracking for delta calculation
            last_gen_line = base.generated_line;
            last_gen_col = base.generated_column;
            last_src_idx = base.source_index;
            last_orig_line = base.original_line;
            last_orig_col = base.original_column;

            // Reset tracking for double-delta calculation
            last_gen_line_delta = 0;
            last_gen_col_delta = 0;
            last_src_idx_delta = 0;
            last_orig_line_delta = 0;
            last_orig_col_delta = 0;

            // Calculate all double-delta values upfront
            for (start_idx + 1..end_idx, 0..) |i, delta_idx| {
                const mapping = Mapping{
                    .generated = mappings.items(.generated)[i],
                    .original = mappings.items(.original)[i],
                    .source_index = mappings.items(.source_index)[i],
                };

                // Calculate deltas
                const gen_line_delta = mapping.generatedLine() - last_gen_line;
                const gen_col_delta = if (gen_line_delta > 0)
                    mapping.generatedColumn()
                else
                    mapping.generatedColumn() - last_gen_col;

                const src_idx_delta = mapping.sourceIndex() - last_src_idx;
                const orig_line_delta = mapping.originalLine() - last_orig_line;
                const orig_col_delta = mapping.originalColumn() - last_orig_col;

                // Calculate double-delta values
                const gen_line_dod = gen_line_delta - last_gen_line_delta;
                const gen_col_dod = gen_col_delta - last_gen_col_delta;
                const src_idx_dod = src_idx_delta - last_src_idx_delta;
                const orig_line_dod = orig_line_delta - last_orig_line_delta;
                const orig_col_dod = orig_col_delta - last_orig_col_delta;

                // Store double-delta values
                const base_offset = delta_idx * 5;
                dod_values[base_offset + 0] = gen_line_dod;
                dod_values[base_offset + 1] = gen_col_dod;
                dod_values[base_offset + 2] = src_idx_dod;
                dod_values[base_offset + 3] = orig_line_dod;
                dod_values[base_offset + 4] = orig_col_dod;

                // Update last values for next iteration
                last_gen_line = mapping.generatedLine();
                last_gen_col = mapping.generatedColumn();
                last_src_idx = mapping.sourceIndex();
                last_orig_line = mapping.originalLine();
                last_orig_col = mapping.originalColumn();

                // Update last delta values for next double-delta
                last_gen_line_delta = gen_line_delta;
                last_gen_col_delta = gen_col_delta;
                last_src_idx_delta = src_idx_delta;
                last_orig_line_delta = orig_line_delta;
                last_orig_col_delta = orig_col_delta;
            }

            // Use batch encoding for efficiency
            offset = DoubleDeltaEncoder.encodeBatch(data, dod_values);
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

                // Calculate and encode double-delta values
                const gen_line_dod = gen_line_delta - last_gen_line_delta;
                const gen_col_dod = gen_col_delta - last_gen_col_delta;
                const src_idx_dod = src_idx_delta - last_src_idx_delta;
                const orig_line_dod = orig_line_delta - last_orig_line_delta;
                const orig_col_dod = orig_col_delta - last_orig_col_delta;

                offset += DoubleDeltaEncoder.encode(data[offset..], gen_line_dod);
                offset += DoubleDeltaEncoder.encode(data[offset..], gen_col_dod);
                offset += DoubleDeltaEncoder.encode(data[offset..], src_idx_dod);
                offset += DoubleDeltaEncoder.encode(data[offset..], orig_line_dod);
                offset += DoubleDeltaEncoder.encode(data[offset..], orig_col_dod);

                // Update last values
                last_gen_line = mapping.generatedLine();
                last_gen_col = mapping.generatedColumn();
                last_src_idx = mapping.sourceIndex();
                last_orig_line = mapping.originalLine();
                last_orig_col = mapping.originalColumn();

                // Update last delta values
                last_gen_line_delta = gen_line_delta;
                last_gen_col_delta = gen_col_delta;
                last_src_idx_delta = src_idx_delta;
                last_orig_line_delta = orig_line_delta;
                last_orig_col_delta = orig_col_delta;
            }
        }

        assert(offset == buffer_size);

        // Store block
        try blocks.append(allocator, .{
            .base = base,
            .data = data,
            .count = @intCast(block_mapping_count),
        });
    }

    return .{
        .blocks = blocks,
        .mapping_count = mappings.len,
        .input_line_count = input_line_count,
        .sources_count = sources_count,
    };
}

/// Free all memory associated with the compact sourcemap
pub fn deinit(self: *CompactSourceMap) void {
    // Free all the blocks in the ArrayList
    for (self.blocks.items) |*block| {
        block.deinit(self.allocator);
    }

    // Free the blocks ArrayList itself
    self.blocks.deinit(self.allocator);

    // Free the current block buffer
    self.current_block_buffer.deinit(self.allocator);

    // No need to free current_block as its data is either
    // empty or already tracked in the blocks ArrayList
}

/// Decode the entire CompactSourceMap back to standard Mapping.List format
pub fn decode(self: CompactSourceMap, allocator: std.mem.Allocator) !Mapping.List {
    var mappings = Mapping.List{};
    try mappings.ensureTotalCapacity(allocator, self.mapping_count);

    // First, decode all finalized blocks
    for (self.blocks.items) |block| {
        try self.decodeBlock(allocator, &mappings, block);
    }

    // If we have an active block that's not finalized yet, decode that too
    if (self.current_block_count > 0) {
        const current_block = self.current_block;

        // Create a temporary block with the current buffer data
        if (self.current_block_count > 1 and self.current_block_buffer.items.len > 0) {
            var temp_block = current_block;
            temp_block.data = self.current_block_buffer.items;
            temp_block.count = self.current_block_count;
            try self.decodeBlock(allocator, &mappings, temp_block);
        } else if (self.current_block_count == 1) {
            // Just the base mapping
            try mappings.append(allocator, .{
                .generated = .{
                    .lines = current_block.base.generated_line,
                    .columns = current_block.base.generated_column,
                },
                .original = .{
                    .lines = current_block.base.original_line,
                    .columns = current_block.base.original_column,
                },
                .source_index = current_block.base.source_index,
            });
        }
    }

    return mappings;
}

const CurrentDeltas = struct {
    gen_line_delta: i32,
    gen_col_delta: i32,
    src_idx_delta: i32,
    orig_line_delta: i32,
    orig_col_delta: i32,
};

/// Decode a single block into the mappings list using double-delta decoding
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
    var current_values = block.base;
    var current_deltas: CurrentDeltas = .{
        .gen_line_delta = 0,
        .gen_col_delta = 0,
        .src_idx_delta = 0,
        .orig_line_delta = 0,
        .orig_col_delta = 0,
    };
    var offset: usize = 0;

    // Process remaining mappings
    var i: u16 = 1;
    while (i < block.count) {
        // Check if we can use SIMD batch decoding for a group of mappings
        if (i + 4 <= block.count) {
            // We have at least 4 more mappings to decode, use batch processing
            var dod_values: [20]i32 = undefined; // Space for 4 mappings × 5 values each

            // Use SIMD-accelerated batch decoding to read double-delta values
            const bytes_read = DoubleDeltaEncoder.decodeBatch(block.data[offset..], &dod_values);
            offset += bytes_read;

            // Process the successfully decoded mappings - each mapping has 5 values
            const mappings_decoded = @min(4, bytes_read / 5);

            // Convert double-delta values to delta values using SIMD helpers
            var delta_values: [20]i32 = undefined;

            // Process delta-of-delta values for generated line
            // No need to copy the data, since the function expects a const slice
            const dod_slice = dod_values[0 .. mappings_decoded * 5];

            // Base values don't need to be mutable if they're not modified
            var base_values_array = [_]i32{ current_deltas.gen_line_delta, current_deltas.gen_line_delta, current_deltas.gen_line_delta, current_deltas.gen_line_delta };
            const base_slice = base_values_array[0..mappings_decoded];

            // Results slice needs to be mutable since it's written to, but it's a slice of a mutable array so it's OK
            const results_slice = delta_values[0 .. mappings_decoded * 5];

            SIMDHelpers.DeltaOfDeltaProcessor.process(dod_slice, base_slice, results_slice);

            // Process delta-of-delta values for generated column
            const gen_col_dod_slice = dod_values[1 .. mappings_decoded * 5]; // Use the const slice directly

            // Base values can be const
            var gen_col_base_array = [_]i32{ current_deltas.gen_col_delta, current_deltas.gen_col_delta, current_deltas.gen_col_delta, current_deltas.gen_col_delta };
            const gen_col_base_slice = gen_col_base_array[0..mappings_decoded];

            // Results can be const since they're a slice of a mutable array
            const gen_col_results_slice = delta_values[1 .. mappings_decoded * 5];

            SIMDHelpers.DeltaOfDeltaProcessor.process(gen_col_dod_slice, gen_col_base_slice, gen_col_results_slice);

            // Process delta-of-delta values for source index
            const src_idx_dod_slice = dod_values[2 .. mappings_decoded * 5]; // Use the const slice directly

            // Base values can be const
            var src_idx_base_array = [_]i32{ current_deltas.src_idx_delta, current_deltas.src_idx_delta, current_deltas.src_idx_delta, current_deltas.src_idx_delta };
            const src_idx_base_slice = src_idx_base_array[0..mappings_decoded];

            // Results can be const since they're a slice of a mutable array
            const src_idx_results_slice = delta_values[2 .. mappings_decoded * 5];

            SIMDHelpers.DeltaOfDeltaProcessor.process(src_idx_dod_slice, src_idx_base_slice, src_idx_results_slice);

            // Process delta-of-delta values for original line
            const orig_line_dod_slice = dod_values[3 .. mappings_decoded * 5]; // Use the const slice directly

            var orig_line_base_array = [_]i32{ current_deltas.orig_line_delta, current_deltas.orig_line_delta, current_deltas.orig_line_delta, current_deltas.orig_line_delta };
            const orig_line_base_slice = orig_line_base_array[0..mappings_decoded];

            // Results can be const since they're a slice of a mutable array
            const orig_line_results_slice = delta_values[3 .. mappings_decoded * 5];

            SIMDHelpers.DeltaOfDeltaProcessor.process(orig_line_dod_slice, orig_line_base_slice, orig_line_results_slice);

            // Process delta-of-delta values for original column
            const orig_col_dod_slice = dod_values[4 .. mappings_decoded * 5]; // Use the const slice directly

            var orig_col_base_array = [_]i32{ current_deltas.orig_col_delta, current_deltas.orig_col_delta, current_deltas.orig_col_delta, current_deltas.orig_col_delta };
            const orig_col_base_slice = orig_col_base_array[0..mappings_decoded];

            // Results can be const since they're a slice of a mutable array
            const orig_col_results_slice = delta_values[4 .. mappings_decoded * 5];

            SIMDHelpers.DeltaOfDeltaProcessor.process(orig_col_dod_slice, orig_col_base_slice, orig_col_results_slice);

            // Now apply deltas to get absolute values and append mappings
            for (0..mappings_decoded) |j| {
                const gen_line_delta = delta_values[j * 5 + 0];
                const gen_col_delta = delta_values[j * 5 + 1];
                const src_idx_delta = delta_values[j * 5 + 2];
                const orig_line_delta = delta_values[j * 5 + 3];
                const orig_col_delta = delta_values[j * 5 + 4];

                // Update current values with the deltas
                current_values.generated_line += gen_line_delta;

                if (gen_line_delta > 0) {
                    // If we changed lines, column is absolute
                    current_values.generated_column = gen_col_delta;
                } else {
                    // Otherwise add delta to previous
                    current_values.generated_column += gen_col_delta;
                }

                current_values.source_index += src_idx_delta;
                current_values.original_line += orig_line_delta;
                current_values.original_column += orig_col_delta;

                // Append mapping
                try mappings.append(allocator, .{
                    .generated = .{
                        .lines = current_values.generated_line,
                        .columns = current_values.generated_column,
                    },
                    .original = .{
                        .lines = current_values.original_line,
                        .columns = current_values.original_column,
                    },
                    .source_index = current_values.source_index,
                });

                // Update current deltas for next iteration
                current_deltas.gen_line_delta = gen_line_delta;
                current_deltas.gen_col_delta = gen_col_delta;
                current_deltas.src_idx_delta = src_idx_delta;
                current_deltas.orig_line_delta = orig_line_delta;
                current_deltas.orig_col_delta = orig_col_delta;
            }

            // Update counter for processed mappings
            i += @intCast(mappings_decoded);
            continue;
        }

        // Fallback to individual decoding for remaining mappings
        // Decode double-delta values
        const gen_line_dod_result = DoubleDeltaEncoder.decode(block.data[offset..]);
        offset += gen_line_dod_result.bytes_read;
        const gen_line_dod = gen_line_dod_result.value;

        const gen_col_dod_result = DoubleDeltaEncoder.decode(block.data[offset..]);
        offset += gen_col_dod_result.bytes_read;
        const gen_col_dod = gen_col_dod_result.value;

        const src_idx_dod_result = DoubleDeltaEncoder.decode(block.data[offset..]);
        offset += src_idx_dod_result.bytes_read;
        const src_idx_dod = src_idx_dod_result.value;

        const orig_line_dod_result = DoubleDeltaEncoder.decode(block.data[offset..]);
        offset += orig_line_dod_result.bytes_read;
        const orig_line_dod = orig_line_dod_result.value;

        const orig_col_dod_result = DoubleDeltaEncoder.decode(block.data[offset..]);
        offset += orig_col_dod_result.bytes_read;
        const orig_col_dod = orig_col_dod_result.value;

        // Update deltas using double-delta values
        current_deltas.gen_line_delta += gen_line_dod;
        current_deltas.gen_col_delta += gen_col_dod;
        current_deltas.src_idx_delta += src_idx_dod;
        current_deltas.orig_line_delta += orig_line_dod;
        current_deltas.orig_col_delta += orig_col_dod;

        // Update current values with new deltas
        current_values.generated_line += current_deltas.gen_line_delta;

        i += 1; // Increment counter for non-batch case

        if (current_deltas.gen_line_delta > 0) {
            // If we changed lines, column is absolute
            current_values.generated_column = current_deltas.gen_col_delta;
        } else {
            // Otherwise add delta to previous
            current_values.generated_column += current_deltas.gen_col_delta;
        }

        current_values.source_index += current_deltas.src_idx_delta;
        current_values.original_line += current_deltas.orig_line_delta;
        current_values.original_column += current_deltas.orig_col_delta;

        // Append mapping
        try mappings.append(allocator, .{
            .generated = .{
                .lines = current_values.generated_line,
                .columns = current_values.generated_column,
            },
            .original = .{
                .lines = current_values.original_line,
                .columns = current_values.original_column,
            },
            .source_index = current_values.source_index,
        });
    }
}

/// Find a mapping at a specific line/column position using SIMD acceleration
pub fn findSIMD(self: CompactSourceMap, allocator: std.mem.Allocator, line: i32, column: i32) !?Mapping {
    // Quick reject if empty map
    if (self.blocks.items.len == 0 and self.current_block_count == 0) {
        return null;
    }

    // 1. Find the block that might contain our target using binary search
    var best_block_idx: usize = 0;
    var found_block = false;
    var use_current_block = false;

    // First check if we have an active current block that might match
    if (self.current_block_count > 0) {
        const current_line = self.current_block.base.generated_line;
        const current_col = self.current_block.base.generated_column;

        // Check if target position is in the range of the current block
        if (line > current_line or (line == current_line and column >= current_col)) {
            // The position might be in the current block
            use_current_block = true;
        }
    }

    // If we're not using the current block, search in finalized blocks
    if (!use_current_block and self.blocks.items.len > 0) {
        // Prepare arrays of lines and columns from block bases for SIMD search
        var block_lines = try allocator.alloc(i32, self.blocks.items.len);
        defer allocator.free(block_lines);

        var block_columns = try allocator.alloc(i32, self.blocks.items.len);
        defer allocator.free(block_columns);

        // Fill the arrays with block base values
        for (self.blocks.items, 0..) |block, i| {
            block_lines[i] = block.base.generated_line;
            block_columns[i] = block.base.generated_column;
        }

        // Use SIMD search to find the right block
        if (SIMDHelpers.SIMDSearch.find(block_lines, block_columns, line, column)) |idx| {
            best_block_idx = idx;
            found_block = true;
        }
    }

    // If we didn't find a suitable block and we're not using the current block, there's no match
    if (!found_block and !use_current_block) {
        return null;
    }

    // 2. Decode the block and search within it
    if (use_current_block) {
        // Check if the target matches the current block's base position exactly
        if (self.current_block.base.generated_line == line and self.current_block.base.generated_column == column) {
            return Mapping{
                .generated = .{
                    .lines = self.current_block.base.generated_line,
                    .columns = self.current_block.base.generated_column,
                },
                .original = .{
                    .lines = self.current_block.base.original_line,
                    .columns = self.current_block.base.original_column,
                },
                .source_index = self.current_block.base.source_index,
            };
        }

        // If we only have the base mapping, it's not a match
        if (self.current_block_count <= 1) {
            return null;
        }

        // Create a temporary block with the current buffer data
        var temp_block = self.current_block;
        temp_block.data = self.current_block_buffer.items;
        temp_block.count = self.current_block_count;

        // Decode the current block
        var partial_mappings = Mapping.List{};
        defer partial_mappings.deinit(allocator);

        try partial_mappings.ensureTotalCapacity(allocator, temp_block.count);
        try self.decodeBlock(allocator, &partial_mappings, temp_block);

        // Use SIMD search within the block mappings
        var mapping_lines = try allocator.alloc(i32, partial_mappings.len);
        defer allocator.free(mapping_lines);

        var mapping_columns = try allocator.alloc(i32, partial_mappings.len);
        defer allocator.free(mapping_columns);

        // Fill the arrays with mapping positions
        for (0..partial_mappings.len) |i| {
            mapping_lines[i] = partial_mappings.items(.generated)[i].lines;
            mapping_columns[i] = partial_mappings.items(.generated)[i].columns;
        }

        // Use SIMD to find the right mapping in the block
        if (SIMDHelpers.SIMDSearch.find(mapping_lines, mapping_columns, line, column)) |idx| {
            return partial_mappings.get(idx);
        }
    } else if (found_block) {
        const block = self.blocks.items[best_block_idx];

        // Special case: if the target matches the block's base position exactly
        if (block.base.generated_line == line and block.base.generated_column == column) {
            return Mapping{
                .generated = .{
                    .lines = block.base.generated_line,
                    .columns = block.base.generated_column,
                },
                .original = .{
                    .lines = block.base.original_line,
                    .columns = block.base.original_column,
                },
                .source_index = block.base.source_index,
            };
        }

        // Decode the entire block
        var partial_mappings = Mapping.List{};
        defer partial_mappings.deinit(allocator);

        try partial_mappings.ensureTotalCapacity(allocator, block.count);
        try self.decodeBlock(allocator, &partial_mappings, block);

        // Use SIMD search within the block mappings
        var mapping_lines = try allocator.alloc(i32, partial_mappings.len);
        defer allocator.free(mapping_lines);

        var mapping_columns = try allocator.alloc(i32, partial_mappings.len);
        defer allocator.free(mapping_columns);

        // Fill the arrays with mapping positions
        for (0..partial_mappings.len) |i| {
            mapping_lines[i] = partial_mappings.items(.generated)[i].lines;
            mapping_columns[i] = partial_mappings.items(.generated)[i].columns;
        }

        // Use SIMD to find the right mapping in the block
        if (SIMDHelpers.SIMDSearch.find(mapping_lines, mapping_columns, line, column)) |idx| {
            return partial_mappings.get(idx);
        }
    }

    return null;
}

/// Standard find implementation as fallback
pub fn find(self: CompactSourceMap, allocator: std.mem.Allocator, line: i32, column: i32) !?Mapping {
    // Use the SIMD-accelerated version
    return try self.findSIMD(allocator, line, column);
}

/// Write VLQ-compatible output for compatibility with standard sourcemap consumers
pub fn writeVLQs(self: CompactSourceMap, writer: anytype) !void {
    // Finalize the current block to ensure all mappings are included
    try self.finalizeCurrentBlock();

    // Now decode all blocks
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
        try @import("vlq.zig").encode(gen.columns - last_col).writeTo(writer);
        last_col = gen.columns;
        try @import("vlq.zig").encode(source_index - last_src).writeTo(writer);
        last_src = source_index;
        try @import("vlq.zig").encode(orig.lines - last_ol).writeTo(writer);
        last_ol = orig.lines;
        try @import("vlq.zig").encode(orig.columns - last_oc).writeTo(writer);
        last_oc = orig.columns;
    }
}

/// Serialization header for the compact sourcemap format
pub const Header = struct {
    magic: u32 = MAGIC,
    version: u32 = VERSION,
    block_count: u32,
    mapping_count: u32,
    input_line_count: u32,
    sources_count: u32,
};

/// Write VLQ-compatible mappings to a MutableString for compatibility with standard sourcemap consumers
pub fn writeVLQs(self: *const CompactSourceMap, output_buffer: *bun.MutableString) !void {
    // Finalize the current block to ensure all mappings are included
    try self.finalizeCurrentBlockConst();

    // Now decode all blocks
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
            try output_buffer.appendNTimes(';', @intCast(inc));
            current_line = gen.lines;
            last_col = 0;
        } else if (i != 0) {
            try output_buffer.appendChar(',');
        }

        // We're using VLQ encode from the original implementation for compatibility
        try @import("vlq.zig").encode(gen.columns - last_col).appendTo(output_buffer);
        last_col = gen.columns;
        try @import("vlq.zig").encode(source_index - last_src).appendTo(output_buffer);
        last_src = source_index;
        try @import("vlq.zig").encode(orig.lines - last_ol).appendTo(output_buffer);
        last_ol = orig.lines;
        try @import("vlq.zig").encode(orig.columns - last_oc).appendTo(output_buffer);
        last_oc = orig.columns;
    }
}

/// Serialize a compact sourcemap to binary format (for storage or transmission)
pub fn serialize(self: CompactSourceMap, allocator: std.mem.Allocator) ![]u8 {
    const header = Header{
        .block_count = @truncate(self.blocks.len),
        .mapping_count = @truncate(self.mapping_count),
        .input_line_count = @truncate(self.input_line_count),
        .sources_count = @truncate(self.sources_count),
    };

    // Calculate total size
    var total_size = @sizeOf(Header);

    // Add size for block headers
    total_size += self.blocks.len * @sizeOf(Block.BaseValues);
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
    @memcpy(buffer[0..@sizeOf(Header)], std.mem.asBytes(&header));

    // Write blocks
    var offset = @sizeOf(Header);

    for (self.blocks) |block| {
        // Write base values
        @memcpy(buffer[offset..][0..@sizeOf(Block.BaseValues)], std.mem.asBytes(&block.base));
        offset += @sizeOf(Block.BaseValues);

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

/// Check if a data buffer contains a serialized compact sourcemap
pub fn isSerializedCompactSourceMap(data: []const u8) bool {
    if (data.len < @sizeOf(Header)) {
        return false;
    }

    const header = @as(*const Header, @ptrCast(@alignCast(data.ptr))).*;
    return header.magic == MAGIC;
}

/// Deserialize a compact sourcemap from binary format
pub fn deserialize(allocator: std.mem.Allocator, data: []const u8) !CompactSourceMap {
    if (data.len < @sizeOf(Header)) {
        return error.InvalidFormat;
    }

    const header = @as(*const Header, @ptrCast(@alignCast(data.ptr))).*;

    if (header.magic != MAGIC) {
        return error.InvalidFormat;
    }

    if (header.version != VERSION) {
        return error.UnsupportedVersion;
    }

    // Allocate blocks
    var blocks = try allocator.alloc(Block, header.block_count);
    errdefer {
        for (blocks) |*block| {
            if (block.data.len > 0) {
                allocator.free(block.data);
            }
        }
        allocator.free(blocks);
    }

    // Read blocks
    var offset = @sizeOf(Header);

    for (0..header.block_count) |i| {
        if (offset + @sizeOf(Block.BaseValues) > data.len) {
            return error.InvalidFormat;
        }

        // Read base values
        blocks[i].base = @as(*const Block.BaseValues, @ptrCast(@alignCast(&data[offset]))).*;
        offset += @sizeOf(Block.BaseValues);

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
        .sources_count = header.sources_count,
    };
}

/// Format marker type for the CompactSourceMap
pub const CompactSourceMapFormat = enum { Compact };

/// Inline serialization for direct embedding in sourcemaps
pub fn getInlineBase64(self: CompactSourceMap, allocator: std.mem.Allocator) ![]const u8 {
    // Finalize the current block to ensure all mappings are included
    try self.finalizeCurrentBlock();

    // Get all mappings as an array
    var mappings = try self.decode(allocator);
    defer mappings.deinit(allocator);

    if (mappings.len == 0) {
        return &[_]u8{};
    }

    // First mapping is the base - we'll store delta values directly to avoid
    // the double-delta calculation complexity for a one-off operation
    var double_delta_values = try allocator.alloc(i32, (mappings.len - 1) * 5);
    defer allocator.free(double_delta_values);

    // First mapping becomes our base
    const first_mapping = Mapping{
        .generated = mappings.items(.generated)[0],
        .original = mappings.items(.original)[0],
        .source_index = mappings.items(.source_index)[0],
    };

    // Last values for delta calculation
    var last_gen_line = first_mapping.generatedLine();
    var last_gen_col = first_mapping.generatedColumn();
    var last_src_idx = first_mapping.sourceIndex();
    var last_orig_line = first_mapping.originalLine();
    var last_orig_col = first_mapping.originalColumn();

    // Last deltas for double-delta calculation
    var last_gen_line_delta: i32 = 0;
    var last_gen_col_delta: i32 = 0;
    var last_src_idx_delta: i32 = 0;
    var last_orig_line_delta: i32 = 0;
    var last_orig_col_delta: i32 = 0;

    // Calculate double-delta values for all mappings after the first
    for (1..mappings.len, 0..) |i, value_idx| {
        const mapping = Mapping{
            .generated = mappings.items(.generated)[i],
            .original = mappings.items(.original)[i],
            .source_index = mappings.items(.source_index)[i],
        };

        // Calculate deltas
        const gen_line_delta = mapping.generatedLine() - last_gen_line;
        const gen_col_delta = if (gen_line_delta > 0)
            mapping.generatedColumn() // If we changed lines, column is absolute
        else
            mapping.generatedColumn() - last_gen_col;

        const src_idx_delta = mapping.sourceIndex() - last_src_idx;
        const orig_line_delta = mapping.originalLine() - last_orig_line;
        const orig_col_delta = mapping.originalColumn() - last_orig_col;

        // Calculate double-delta values
        const gen_line_dod = gen_line_delta - last_gen_line_delta;
        const gen_col_dod = gen_col_delta - last_gen_col_delta;
        const src_idx_dod = src_idx_delta - last_src_idx_delta;
        const orig_line_dod = orig_line_delta - last_orig_line_delta;
        const orig_col_dod = orig_col_delta - last_orig_col_delta;

        // Store double-delta values
        const base_offset = value_idx * 5;
        double_delta_values[base_offset + 0] = gen_line_dod;
        double_delta_values[base_offset + 1] = gen_col_dod;
        double_delta_values[base_offset + 2] = src_idx_dod;
        double_delta_values[base_offset + 3] = orig_line_dod;
        double_delta_values[base_offset + 4] = orig_col_dod;

        // Update values for next iteration
        last_gen_line = mapping.generatedLine();
        last_gen_col = mapping.generatedColumn();
        last_src_idx = mapping.sourceIndex();
        last_orig_line = mapping.originalLine();
        last_orig_col = mapping.originalColumn();

        // Update deltas for next iteration
        last_gen_line_delta = gen_line_delta;
        last_gen_col_delta = gen_col_delta;
        last_src_idx_delta = src_idx_delta;
        last_orig_line_delta = orig_line_delta;
        last_orig_col_delta = orig_col_delta;
    }

    // Encode to base64
    return DoubleDeltaEncoder.encodeToBase64(allocator, double_delta_values);
}

/// This function can be used to convert an existing sourcemap
/// to use the new compact format internally
pub fn convertSourceMapToCompact(
    sourcemap: *SourceMap,
    allocator: std.mem.Allocator,
) !void {
    // Create a new compact sourcemap
    var compact = create(allocator);
    compact.input_line_count = @max(1, sourcemap.sources_content.len);
    compact.sources_count = sourcemap.sources.len;

    // Add all mappings from the standard format
    for (0..sourcemap.mapping.len) |i| {
        const mapping = Mapping{
            .generated = sourcemap.mapping.items(.generated)[i],
            .original = sourcemap.mapping.items(.original)[i],
            .source_index = sourcemap.mapping.items(.source_index)[i],
        };

        try compact.addMapping(mapping);
    }

    // Finalize any pending block
    try compact.finalizeCurrentBlock();

    // Update the internal representation
    sourcemap.compact_mapping = compact;
}
