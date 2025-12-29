const bun = @import("bun");

/// Buffer for newline-delimited data that tracks scan positions to avoid O(n²) scanning.
/// Each byte is scanned exactly once. We track:
/// - newline_pos: position of first known newline (if any)
/// - scanned_pos: how far we've scanned (bytes before this have been checked)
///
/// When data arrives, we only scan the NEW bytes.
/// When we consume a message, we adjust positions without re-scanning already-scanned data.
pub const JSONLineBuffer = struct {
    data: bun.ByteList = .{},
    /// Position of a known upcoming newline, if any.
    newline_pos: ?u32 = null,
    /// How far we've scanned for newlines. All data before this position
    /// has been checked - no need to re-scan after consume().
    scanned_pos: u32 = 0,

    /// Scan for newline in unscanned portion of the buffer.
    fn scanForNewline(self: *@This()) void {
        if (self.newline_pos != null) return;
        const slice = self.data.slice();
        if (self.scanned_pos >= slice.len) return;

        const unscanned = slice[self.scanned_pos..];
        if (bun.strings.indexOfChar(unscanned, '\n')) |local_idx| {
            const pos = self.scanned_pos +| @as(u32, @intCast(local_idx));
            self.newline_pos = pos;
            self.scanned_pos = pos +| 1; // Only scanned up to (and including) the newline
        } else {
            self.scanned_pos = @intCast(slice.len); // No newline, scanned everything
        }
    }

    /// Append bytes to the buffer, scanning only new data for newline.
    pub fn append(self: *@This(), bytes: []const u8) void {
        _ = bun.handleOom(self.data.write(bun.default_allocator, bytes));
        self.scanForNewline();
    }

    /// Returns the next complete message (up to and including newline) if available.
    pub fn next(self: *const @This()) ?struct { data: []const u8, newline_pos: u32 } {
        const pos = self.newline_pos orelse return null;
        return .{
            .data = self.data.slice()[0 .. pos + 1],
            .newline_pos = pos,
        };
    }

    /// Consume bytes from the front of the buffer after processing a message.
    /// Adjusts positions without re-scanning - all remaining data was already scanned.
    pub fn consume(self: *@This(), bytes: u32) void {
        const remaining = self.data.slice()[bytes..];
        bun.copy(u8, self.data.ptr[0..remaining.len], remaining);
        bun.debugAssert(remaining.len <= std.math.maxInt(u32));
        self.data.len = @intCast(remaining.len);

        // Adjust scanned_pos (subtract consumed bytes, but don't go negative)
        self.scanned_pos = if (bytes >= self.scanned_pos) 0 else self.scanned_pos - bytes;

        // Adjust newline_pos
        if (self.newline_pos) |pos| {
            if (bytes > pos) {
                // Consumed past the known newline - clear it and scan for next
                self.newline_pos = null;
                self.scanForNewline();
            } else {
                self.newline_pos = pos - bytes;
            }
        }
    }

    pub fn isEmpty(self: *const @This()) bool {
        return self.data.len == 0;
    }

    pub fn unusedCapacitySlice(self: *@This()) []u8 {
        return self.data.unusedCapacitySlice();
    }

    pub fn ensureUnusedCapacity(self: *@This(), additional: usize) void {
        bun.handleOom(self.data.ensureUnusedCapacity(bun.default_allocator, additional));
    }

    /// Notify the buffer that data was written directly (e.g., via pre-allocated slice).
    pub fn notifyWritten(self: *@This(), new_data: []const u8) void {
        self.data.len +|= @as(u32, @intCast(new_data.len));
        self.scanForNewline();
    }

    pub fn deinit(self: *@This()) void {
        self.data.deinit(bun.default_allocator);
    }
};

const std = @import("std");
