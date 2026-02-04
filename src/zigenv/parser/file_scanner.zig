const std = @import("std");

pub const BufferSizeHints = struct {
    max_key_size: usize,
    max_value_size: usize,
    /// Estimated number of key-value pairs in the file.
    /// This is a heuristic that may over-count (e.g., heredocs with = signs)
    /// but should never under-count for simple files.
    estimated_pair_count: usize,
};

/// scanBufferSizes performs a fast pre-scan of the .env file content
/// to estimate the maximum sizes needed for key and value buffers.
/// This is a heuristic approach and doesn't implement full parsing.
pub fn scanBufferSizes(content: []const u8) BufferSizeHints {
    var hints = BufferSizeHints{
        .max_key_size = 0,
        .max_value_size = 0,
        .estimated_pair_count = 0,
    };

    var it = std.mem.splitScalar(u8, content, '\n');
    var current_value_size: usize = 0;
    var in_potential_multiline = false;

    while (it.next()) |line| {
        // Skip trailing empty fragment from a final newline
        if (line.len == 0 and it.rest().len == 0) break;

        // Find first '=' that isn't preceded by comment marker
        // (Simplified: look for '=' in trimmed line)
        const trimmed = std.mem.trim(u8, line, " \t\r");
        if (trimmed.len == 0) {
            if (in_potential_multiline) {
                current_value_size += line.len + 1;
            }
            continue;
        }

        if (trimmed[0] == '#') {
            if (in_potential_multiline) {
                current_value_size += line.len + 1;
            }
            continue;
        }

        if (std.mem.indexOfScalar(u8, line, '=')) |equal_idx| {
            // New key=value pair starts here.
            // Count this as an estimated pair (may over-count for heredocs with = signs)
            hints.estimated_pair_count += 1;

            // If we were in a multiline value, it ends now.
            if (in_potential_multiline) {
                hints.max_value_size = @max(hints.max_value_size, current_value_size);
                in_potential_multiline = false;
            }

            const key_part = line[0..equal_idx];
            const trimmed_key = std.mem.trim(u8, key_part, " \t\r");
            hints.max_key_size = @max(hints.max_key_size, trimmed_key.len);

            const value_part = line[equal_idx + 1 ..];
            const trimmed_value = std.mem.trimRight(u8, value_part, " \t\r");
            current_value_size = trimmed_value.len;
            in_potential_multiline = true; // Heuristic: assume it might continue
        } else {
            // Line with no '='
            if (in_potential_multiline) {
                // Heuristic: this is part of the previous value
                current_value_size += line.len + 1;
            }
        }
    }

    if (in_potential_multiline) {
        hints.max_value_size = @max(hints.max_value_size, current_value_size);
    }

    return hints;
}

// ============================================================================
// Tests
// ============================================================================
const testing = std.testing;

test "scan simple key=value" {
    const content = "KEY=value";
    const hints = scanBufferSizes(content);
    try testing.expectEqual(@as(usize, 3), hints.max_key_size); // "KEY"
    try testing.expectEqual(@as(usize, 5), hints.max_value_size); // "value"
    try testing.expectEqual(@as(usize, 1), hints.estimated_pair_count);
}

test "scan multiple lines" {
    const content = "SHORT=x\nLONGER_KEY=longer_value";
    const hints = scanBufferSizes(content);
    try testing.expectEqual(@as(usize, 10), hints.max_key_size); // "LONGER_KEY"
    try testing.expectEqual(@as(usize, 12), hints.max_value_size); // "longer_value"
    try testing.expectEqual(@as(usize, 2), hints.estimated_pair_count);
}

test "scan with heredoc" {
    const content =
        \\KEY="""
        \\This is a long heredoc value
        \\"""
    ;
    const hints = scanBufferSizes(content);
    // Should detect multi-line value
    // KEY=""" (4 chars after =)
    // \nThis is a long heredoc value (29 chars)
    // \n""" (4 chars)
    // Total approx 37
    try testing.expect(hints.max_value_size > 25);
}

test "scan ignores comments" {
    const content = "#KEY=comment\nREAL=value";
    const hints = scanBufferSizes(content);
    try testing.expectEqual(@as(usize, 4), hints.max_key_size); // "REAL"
    try testing.expectEqual(@as(usize, 5), hints.max_value_size); // "value"
    try testing.expectEqual(@as(usize, 1), hints.estimated_pair_count); // Only REAL=value counted
}

test "scan handles windows line endings" {
    const content = "KEY=value\r\nOTHER=thing\r\n";
    const hints = scanBufferSizes(content);
    try testing.expectEqual(@as(usize, 5), hints.max_key_size); // "OTHER"
    try testing.expectEqual(@as(usize, 5), hints.max_value_size); // "value" or "thing"
    try testing.expectEqual(@as(usize, 2), hints.estimated_pair_count);
}

test "scan counts pairs with empty lines" {
    const content = "A=1\n\nB=2\n\nC=3";
    const hints = scanBufferSizes(content);
    try testing.expectEqual(@as(usize, 3), hints.estimated_pair_count);
}

test "scan counts pairs with heredocs (may overcount)" {
    const content =
        \\KEY="""
        \\multiline with = sign inside
        \\"""
        \\ANOTHER=value
    ;
    const hints = scanBufferSizes(content);
    // May count 2 or 3 depending on heuristic (= inside heredoc)
    // The important thing is it's >= 2 (actual pair count)
    try testing.expect(hints.estimated_pair_count >= 2);
}

test "scan counts single pair" {
    const content = "SOLO=single";
    const hints = scanBufferSizes(content);
    try testing.expectEqual(@as(usize, 1), hints.estimated_pair_count);
}

test "scan returns zero for empty content" {
    const content = "";
    const hints = scanBufferSizes(content);
    try testing.expectEqual(@as(usize, 0), hints.estimated_pair_count);
    try testing.expectEqual(@as(usize, 0), hints.max_key_size);
    try testing.expectEqual(@as(usize, 0), hints.max_value_size);
}

test "scan returns zero for comment-only content" {
    const content = "# just a comment\n# another one";
    const hints = scanBufferSizes(content);
    try testing.expectEqual(@as(usize, 0), hints.estimated_pair_count);
}
