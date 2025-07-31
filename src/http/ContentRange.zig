const ContentRange = @This();

const std = @import("std");
const bun = @import("bun");

/// Represents a single range request (e.g., "bytes=200-1000")
pub const Range = struct {
    start: u64,
    end: ?u64, // null means "to the end"
    
    pub fn length(self: Range, content_size: u64) u64 {
        const actual_end = self.end orelse (content_size - 1);
        return actual_end - self.start + 1;
    }
    
    pub fn actualEnd(self: Range, content_size: u64) u64 {
        return self.end orelse (content_size - 1);
    }
    
    pub fn isValid(self: Range, content_size: u64) bool {
        if (self.start >= content_size) return false;
        if (self.end) |end| {
            return end >= self.start and end < content_size;
        }
        return true;
    }
};

/// Represents a suffix range request (e.g., "bytes=-500" for last 500 bytes)
pub const SuffixRange = struct {
    suffix_length: u64,
    
    pub fn toRange(self: SuffixRange, content_size: u64) Range {
        const start = if (content_size > self.suffix_length) 
            content_size - self.suffix_length 
        else 
            0;
        return Range{
            .start = start,
            .end = content_size - 1,
        };
    }
};

/// Represents different types of range requests
pub const RangeRequest = union(enum) {
    range: Range,
    suffix: SuffixRange,
    
    pub fn toRange(self: RangeRequest, content_size: u64) Range {
        return switch (self) {
            .range => |r| r,
            .suffix => |s| s.toRange(content_size),
        };
    }
    
    pub fn isValid(self: RangeRequest, content_size: u64) bool {
        return switch (self) {
            .range => |r| r.isValid(content_size),
            .suffix => true, // Suffix ranges are always valid
        };
    }
};

/// Parse the Range header value (e.g., "bytes=200-1000,2000-3000")
pub fn parseRangeHeader(range_header: []const u8, allocator: std.mem.Allocator) ![]RangeRequest {
    var result = std.ArrayList(RangeRequest).init(allocator);
    errdefer result.deinit();
    
    const trimmed = std.mem.trim(u8, range_header, " \t");
    
    // Must start with "bytes="
    if (!bun.strings.hasPrefix(trimmed, "bytes=")) {
        return error.InvalidRangeHeader;
    }
    
    const ranges_str = trimmed[6..]; // Skip "bytes="
    
    var range_iter = std.mem.splitScalar(u8, ranges_str, ',');
    while (range_iter.next()) |range_str| {
        const range_trimmed = std.mem.trim(u8, range_str, " \t");
        if (range_trimmed.len == 0) continue;
        
        const range_req = try parseRangeSpec(range_trimmed);
        try result.append(range_req);
    }
    
    if (result.items.len == 0) {
        return error.InvalidRangeHeader;
    }
    
    return try result.toOwnedSlice();
}

/// Parse a single range specification (e.g., "200-1000", "200-", "-500")
fn parseRangeSpec(range_spec: []const u8) !RangeRequest {
    const dash_pos = std.mem.indexOfScalar(u8, range_spec, '-') orelse return error.InvalidRangeSpec;
    
    const start_str = range_spec[0..dash_pos];
    const end_str = range_spec[dash_pos + 1..];
    
    // Suffix range: "-500"
    if (start_str.len == 0) {
        if (end_str.len == 0) return error.InvalidRangeSpec;
        const suffix_length = std.fmt.parseInt(u64, end_str, 10) catch return error.InvalidRangeSpec;
        return RangeRequest{ .suffix = SuffixRange{ .suffix_length = suffix_length } };
    }
    
    // Parse start position
    const start = std.fmt.parseInt(u64, start_str, 10) catch return error.InvalidRangeSpec;
    
    // Open-ended range: "200-"
    if (end_str.len == 0) {
        return RangeRequest{ .range = Range{ .start = start, .end = null } };
    }
    
    // Closed range: "200-1000"
    const end = std.fmt.parseInt(u64, end_str, 10) catch return error.InvalidRangeSpec;
    if (end < start) return error.InvalidRangeSpec;
    
    return RangeRequest{ .range = Range{ .start = start, .end = end } };
}

/// Filter ranges to only include valid ones for the given content size
pub fn filterValidRanges(ranges: []const RangeRequest, content_size: u64, allocator: std.mem.Allocator) ![]Range {
    var result = std.ArrayList(Range).init(allocator);
    errdefer result.deinit();
    
    for (ranges) |range_req| {
        if (range_req.isValid(content_size)) {
            try result.append(range_req.toRange(content_size));
        }
    }
    
    return try result.toOwnedSlice();
}

/// Generate Content-Range header value for a single range
pub fn formatContentRangeHeader(range: Range, content_size: u64, allocator: std.mem.Allocator) ![]u8 {
    const actual_end = range.actualEnd(content_size);
    return try std.fmt.allocPrint(allocator, "bytes {d}-{d}/{d}", .{ range.start, actual_end, content_size });
}

/// Generate Content-Range header value for unsatisfiable range
pub fn formatUnsatisfiableRangeHeader(content_size: u64, allocator: std.mem.Allocator) ![]u8 {
    return try std.fmt.allocPrint(allocator, "bytes */{d}", .{content_size});
}

/// Check if the client accepts partial content based on request headers
pub fn acceptsRanges(range_header: ?[]const u8) bool {
    return range_header != null;
}

/// Determine the appropriate status code for a range request
pub fn getRangeResponseStatus(ranges: []const Range, content_size: u64) u16 {
    if (ranges.len == 0) return 416; // Range Not Satisfiable
    if (ranges.len == 1) {
        const range = ranges[0];
        if (range.start == 0 and range.actualEnd(content_size) == content_size - 1) {
            return 200; // Full content
        }
        return 206; // Partial Content
    }
    return 206; // Multipart ranges (not yet implemented)
}

/// Get the slice of content for a given range
pub fn getContentSlice(content: []const u8, range: Range) []const u8 {
    const start = @min(range.start, content.len);
    const end = @min(range.actualEnd(content.len), content.len - 1);
    if (start > end or start >= content.len) return content[0..0];
    return content[start..end + 1];
}

/// Calculate the total length of all ranges combined
pub fn calculateTotalRangeLength(ranges: []const Range, content_size: u64) u64 {
    var total: u64 = 0;
    for (ranges) |range| {
        total += range.length(content_size);
    }
    return total;
}

/// Merge overlapping ranges (optimization for multiple ranges)
pub fn mergeOverlappingRanges(ranges: []Range, allocator: std.mem.Allocator) ![]Range {
    if (ranges.len <= 1) return try allocator.dupe(Range, ranges);
    
    // Sort ranges by start position
    std.mem.sort(Range, ranges, {}, struct {
        fn lessThan(_: void, a: Range, b: Range) bool {
            return a.start < b.start;
        }
    }.lessThan);
    
    var result = std.ArrayList(Range).init(allocator);
    errdefer result.deinit();
    
    var current = ranges[0];
    
    for (ranges[1..]) |range| {
        const current_end = current.end orelse std.math.maxInt(u64);
        
        // Check if ranges overlap or are adjacent
        if (range.start <= current_end + 1) {
            // Merge ranges
            const range_end = range.end orelse std.math.maxInt(u64);
            if (current.end == null or range.end == null) {
                current.end = null; // Open-ended
            } else {
                current.end = @max(current_end, range_end);
            }
        } else {
            // No overlap, add current range and start new one
            try result.append(current);
            current = range;
        }
    }
    
    try result.append(current);
    return try result.toOwnedSlice();
}

test "parseRangeSpec - closed range" {
    const range_req = try parseRangeSpec("200-1000");
    try std.testing.expect(range_req == .range);
    try std.testing.expectEqual(@as(u64, 200), range_req.range.start);
    try std.testing.expectEqual(@as(?u64, 1000), range_req.range.end);
}

test "parseRangeSpec - open range" {
    const range_req = try parseRangeSpec("200-");
    try std.testing.expect(range_req == .range);
    try std.testing.expectEqual(@as(u64, 200), range_req.range.start);
    try std.testing.expectEqual(@as(?u64, null), range_req.range.end);
}

test "parseRangeSpec - suffix range" {
    const range_req = try parseRangeSpec("-500");
    try std.testing.expect(range_req == .suffix);
    try std.testing.expectEqual(@as(u64, 500), range_req.suffix.suffix_length);
}

test "parseRangeHeader - single range" {
    const allocator = std.testing.allocator;
    const ranges = try parseRangeHeader("bytes=200-1000", allocator);
    defer allocator.free(ranges);
    
    try std.testing.expectEqual(@as(usize, 1), ranges.len);
    try std.testing.expect(ranges[0] == .range);
    try std.testing.expectEqual(@as(u64, 200), ranges[0].range.start);
    try std.testing.expectEqual(@as(?u64, 1000), ranges[0].range.end);
}

test "parseRangeHeader - multiple ranges" {
    const allocator = std.testing.allocator;
    const ranges = try parseRangeHeader("bytes=0-499, 1000-1499, -500", allocator);
    defer allocator.free(ranges);
    
    try std.testing.expectEqual(@as(usize, 3), ranges.len);
    
    // First range
    try std.testing.expect(ranges[0] == .range);
    try std.testing.expectEqual(@as(u64, 0), ranges[0].range.start);
    try std.testing.expectEqual(@as(?u64, 499), ranges[0].range.end);
    
    // Second range
    try std.testing.expect(ranges[1] == .range);
    try std.testing.expectEqual(@as(u64, 1000), ranges[1].range.start);
    try std.testing.expectEqual(@as(?u64, 1499), ranges[1].range.end);
    
    // Third range (suffix)
    try std.testing.expect(ranges[2] == .suffix);
    try std.testing.expectEqual(@as(u64, 500), ranges[2].suffix.suffix_length);
}

test "Range.isValid" {
    const range1 = Range{ .start = 200, .end = 1000 };
    try std.testing.expect(range1.isValid(2000));
    try std.testing.expect(!range1.isValid(500));
    
    const range2 = Range{ .start = 200, .end = null };
    try std.testing.expect(range2.isValid(2000));
    try std.testing.expect(!range2.isValid(200));
}

test "formatContentRangeHeader" {
    const allocator = std.testing.allocator;
    const range = Range{ .start = 200, .end = 1000 };
    const header = try formatContentRangeHeader(range, 2000, allocator);
    defer allocator.free(header);
    
    try std.testing.expectEqualStrings("bytes 200-1000/2000", header);
}

test "getContentSlice" {
    const content = "Hello, World! This is a test content.";
    const range = Range{ .start = 7, .end = 12 };
    const slice = getContentSlice(content, range);
    
    try std.testing.expectEqualStrings("World!", slice);
}

test "mergeOverlappingRanges" {
    const allocator = std.testing.allocator;
    var ranges = [_]Range{
        Range{ .start = 0, .end = 100 },
        Range{ .start = 50, .end = 150 },
        Range{ .start = 200, .end = 300 },
        Range{ .start = 250, .end = 350 },
    };
    
    const merged = try mergeOverlappingRanges(&ranges, allocator);
    defer allocator.free(merged);
    
    try std.testing.expectEqual(@as(usize, 2), merged.len);
    try std.testing.expectEqual(@as(u64, 0), merged[0].start);
    try std.testing.expectEqual(@as(?u64, 150), merged[0].end);
    try std.testing.expectEqual(@as(u64, 200), merged[1].start);
    try std.testing.expectEqual(@as(?u64, 350), merged[1].end);
}