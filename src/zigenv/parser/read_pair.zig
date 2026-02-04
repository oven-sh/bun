const std = @import("std");
const EnvStream = @import("env_stream.zig").EnvStream;
const EnvPair = @import("../data/env_pair.zig").EnvPair;
const ParserOptions = @import("../data/parser_options.zig").ParserOptions;
const ReadResult = @import("../data/read_result.zig").ReadResult;
const EnvPairList = @import("../data/env_pair_list.zig").EnvPairList;
const readKey = @import("read_key.zig").readKey;
const readValue = @import("read_value.zig").readValue;
const interpolation = @import("../interpolation/interpolation.zig");
const memory = @import("../buffer/memory_utils.zig");
const file_scanner = @import("file_scanner.zig");
const testing = std.testing;

pub fn readPair(allocator: std.mem.Allocator, stream: *EnvStream, pair: *EnvPair, options: ParserOptions) !ReadResult {
    const result = try readKey(stream, &pair.key, options);
    if (result == ReadResult.fail or result == ReadResult.empty) {
        return ReadResult.fail;
    }
    if (result == ReadResult.comment_encountered) {
        return ReadResult.comment_encountered;
    }
    if (result == ReadResult.end_of_stream_key) {
        return ReadResult.end_of_stream_key;
    }

    if (result == ReadResult.end_of_stream_value) {
        return ReadResult.success;
    }

    // Trim right side of key
    while (pair.key.buffer.len > 0) {
        if (pair.key.buffer.ptr[pair.key.buffer.len - 1] != ' ') {
            break;
        }
        pair.key.buffer.len -= 1;
    }

    // Read value
    const value_result = try readValue(allocator, stream, &pair.value, options);
    if (value_result == ReadResult.end_of_stream_value) {
        return ReadResult.end_of_stream_value;
    }

    if (value_result == ReadResult.comment_encountered or value_result == ReadResult.success) {
        interpolation.removeUnclosedInterpolation(&pair.value);
        return ReadResult.success;
    }

    if (value_result == ReadResult.empty) {
        interpolation.removeUnclosedInterpolation(&pair.value);
        return ReadResult.empty;
    }

    if (value_result == ReadResult.end_of_stream_key) {
        interpolation.removeUnclosedInterpolation(&pair.value);
        return ReadResult.end_of_stream_key;
    }

    interpolation.removeUnclosedInterpolation(&pair.value);
    return ReadResult.fail;
}

pub fn readPairsWithHints(
    allocator: std.mem.Allocator,
    stream: *EnvStream,
    hints: file_scanner.BufferSizeHints,
    options: ParserOptions,
) !EnvPairList {
    // Pre-allocate capacity if we have a pair count estimate
    var pairs = EnvPairList.init(allocator);
    if (hints.estimated_pair_count > 0) {
        try pairs.ensureTotalCapacity(hints.estimated_pair_count);
    }
    errdefer memory.deletePairs(&pairs);

    // Use a scratch pair to minimize allocations
    var scratch_pair = try EnvPair.initWithCapacity(
        allocator,
        hints.max_key_size,
        hints.max_value_size,
    );
    defer scratch_pair.deinit();

    while (true) {
        scratch_pair.clear(); // Reset scratch pair for reuse

        const result = try readPair(allocator, stream, &scratch_pair, options);

        if (result == ReadResult.end_of_stream_value or result == ReadResult.success) {
            // Clone the scratch pair into a new pair for the list
            // We want exact sized buffers for the stored pair to save memory
            // But we can't easily "move" from scratch without losing scratch's capacity.
            // So we copy.
            var new_pair = EnvPair.init(allocator); // Init empty

            // Alloc key
            const key_slice = scratch_pair.key.key();
            const new_key_buf = try allocator.alloc(u8, key_slice.len);
            @memcpy(new_key_buf, key_slice);
            new_pair.key.setOwnBuffer(new_key_buf);

            // Alloc value
            const val_slice = scratch_pair.value.value();
            const new_val_buf = try allocator.alloc(u8, val_slice.len);
            @memcpy(new_val_buf, val_slice);
            new_pair.value.setOwnBuffer(new_val_buf);

            // Should we copy interpolations?
            // value.interpolations is an ArrayListUnmanaged(VariablePosition).
            // Yes, if there are interpolations, they need to be copied.
            if (scratch_pair.value.interpolations.items.len > 0) {
                // Deep copy interpolations because scratch_pair.clear() will free the original strings
                for (scratch_pair.value.interpolations.items) |interp| {
                    var new_interp = interp; // Copy struct fields

                    // Duplicate the string if it exists
                    if (interp.variable_str.len > 0) {
                        new_interp.variable_str = try allocator.dupe(u8, interp.variable_str);
                    } else {
                        new_interp.variable_str = "";
                    }

                    if (interp.default_value.len > 0) {
                        new_interp.default_value = try allocator.dupe(u8, interp.default_value);
                    } else {
                        new_interp.default_value = "";
                    }

                    new_interp.allocator = allocator; // Mark as owning memory

                    try new_pair.value.interpolations.append(new_interp);
                }
            }

            // Copy state flags
            new_pair.value.quoted = scratch_pair.value.quoted;
            new_pair.value.double_quoted = scratch_pair.value.double_quoted;
            // ... copy other relevant flags if needed by consumer?
            // Usually only quoted status matters for later processing.

            try pairs.append(new_pair);

            if (result == ReadResult.end_of_stream_value) break;
            continue;
        }

        if (result == ReadResult.comment_encountered or result == ReadResult.fail) {
            continue;
        }
        break;
    }

    return pairs;
}

pub fn readPairsWithOptions(allocator: std.mem.Allocator, stream: *EnvStream, options: ParserOptions) !EnvPairList {
    // Use default hints (0 capacity = start small)
    const default_hints = file_scanner.BufferSizeHints{
        .max_key_size = 0,
        .max_value_size = 0,
        .estimated_pair_count = 0,
    };
    return readPairsWithHints(allocator, stream, default_hints, options);
}

pub fn readPairs(allocator: std.mem.Allocator, stream: *EnvStream) !EnvPairList {
    return readPairsWithOptions(allocator, stream, ParserOptions.defaults());
}

test "readPair simple pair" {
    const default_options = ParserOptions.defaults();
    var stream = EnvStream.init("KEY=value");

    var pair = EnvPair.init(testing.allocator);
    defer pair.deinit();

    const result = try readPair(testing.allocator, &stream, &pair, default_options);

    try testing.expectEqual(ReadResult.success, result);
    try testing.expectEqualStrings("KEY", pair.key.key());
    try testing.expectEqualStrings("value", pair.value.value());
}

test "readPair with whitespace" {
    const default_options = ParserOptions.defaults();
    var stream = EnvStream.init("  KEY  =  value  ");

    var pair = EnvPair.init(testing.allocator);
    defer pair.deinit();

    const result = try readPair(testing.allocator, &stream, &pair, default_options);

    try testing.expectEqual(ReadResult.success, result);
    try testing.expectEqualStrings("KEY", pair.key.key());
    // Value should have right trimming if implicit double quote, logic handles it in readValue
}

test "readPair with quotes" {
    const default_options = ParserOptions.defaults();
    var stream = EnvStream.init("KEY=\"quoted value\"");

    var pair = EnvPair.init(testing.allocator);
    defer pair.deinit();

    const result = try readPair(testing.allocator, &stream, &pair, default_options);

    try testing.expectEqual(ReadResult.success, result);
    try testing.expectEqualStrings("KEY", pair.key.key());
    try testing.expectEqualStrings("quoted value", pair.value.value());
}

test "readPair comment line" {
    const default_options = ParserOptions.defaults();
    var stream = EnvStream.init("#comment\nKEY=value");

    var pair = EnvPair.init(testing.allocator);
    defer pair.deinit();

    const result = try readPair(testing.allocator, &stream, &pair, default_options);

    try testing.expectEqual(ReadResult.comment_encountered, result);
}

test "readPairs multiple pairs" {
    var stream = EnvStream.init("KEY1=value1\nKEY2=value2\nKEY3=value3");

    var pairs = try readPairs(testing.allocator, &stream);
    defer {
        // Pairs handles cleanup of items
        pairs.deinit();
    }

    try testing.expectEqual(@as(usize, 3), pairs.items.len);
    try testing.expectEqualStrings("KEY1", pairs.items[0].key.key());
    try testing.expectEqualStrings("value1", pairs.items[0].value.value());
    try testing.expectEqualStrings("KEY2", pairs.items[1].key.key());
    try testing.expectEqualStrings("value2", pairs.items[1].value.value());
    try testing.expectEqualStrings("KEY3", pairs.items[2].key.key());
    try testing.expectEqualStrings("value3", pairs.items[2].value.value());
}

test "readPairs with comments" {
    var stream = EnvStream.init("#comment\nKEY1=value1\n#another comment\nKEY2=value2");

    var pairs = try readPairs(testing.allocator, &stream);
    defer {
        pairs.deinit();
    }

    try testing.expectEqual(@as(usize, 2), pairs.items.len);
    try testing.expectEqualStrings("KEY1", pairs.items[0].key.key());
    try testing.expectEqualStrings("KEY2", pairs.items[1].key.key());
}

test "readPairs with empty lines" {
    var stream = EnvStream.init("KEY1=value1\n\nKEY2=value2");

    var pairs = try readPairs(testing.allocator, &stream);
    defer {
        pairs.deinit();
    }

    // Empty lines should be skipped as fail (in loop) or handled
    try testing.expect(pairs.items.len >= 2);
}

test "readPairs windows line endings" {
    var stream = EnvStream.init("KEY1=value1\r\nKEY2=value2\r\n");

    var pairs = try readPairs(testing.allocator, &stream);
    defer {
        pairs.deinit();
    }

    try testing.expectEqual(@as(usize, 2), pairs.items.len);
    try testing.expectEqualStrings("KEY1", pairs.items[0].key.key());
    try testing.expectEqualStrings("KEY2", pairs.items[1].key.key());
}

test "readPairs empty stream" {
    var stream = EnvStream.init("");

    var pairs = try readPairs(testing.allocator, &stream);
    defer {
        pairs.deinit();
    }

    try testing.expectEqual(@as(usize, 0), pairs.items.len);
}
