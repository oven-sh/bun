/// Buffer for newline-delimited data that tracks scan positions to avoid O(n²) scanning.
/// Each byte is scanned exactly once. We track:
/// - newline_pos: position of first known newline (if any)
/// - scanned_pos: how far we've scanned (bytes before this have been checked)
/// - head: offset into the buffer where unconsumed data starts (avoids copying on each consume)
///
/// When data arrives, we only scan the NEW bytes.
/// When we consume a message, we just advance `head` instead of copying.
/// Compaction only happens when head exceeds a threshold.
pub const JSONLineBuffer = struct {
    data: bun.ByteList = .{},
    /// Offset into data where unconsumed content starts.
    head: u32 = 0,
    /// Position of a known upcoming newline relative to head, if any.
    newline_pos: ?u32 = null,
    /// How far we've scanned for newlines relative to head.
    scanned_pos: u32 = 0,

    /// Compact the buffer when head exceeds this threshold.
    const compaction_threshold = 16 * 1024 * 1024; // 16 MB

    /// Get the active (unconsumed) portion of the buffer.
    fn activeSlice(self: *const @This()) []const u8 {
        return self.data.slice()[self.head..];
    }

    /// Scan for newline in unscanned portion of the buffer.
    fn scanForNewline(self: *@This()) void {
        if (self.newline_pos != null) return;
        const slice = self.activeSlice();
        if (self.scanned_pos >= slice.len) return;

        const unscanned = slice[self.scanned_pos..];
        if (bun.strings.indexOfChar(unscanned, '\n')) |local_idx| {
            bun.debugAssert(local_idx <= std.math.maxInt(u32));
            const pos = self.scanned_pos +| @as(u32, @intCast(local_idx));
            self.newline_pos = pos;
            self.scanned_pos = pos +| 1; // Only scanned up to (and including) the newline
        } else {
            bun.debugAssert(slice.len <= std.math.maxInt(u32));
            self.scanned_pos = @intCast(slice.len); // No newline, scanned everything
        }
    }

    /// Compact the buffer by moving data to the front. Called when head exceeds threshold.
    fn compact(self: *@This()) void {
        if (self.head == 0) return;
        const slice = self.activeSlice();
        bun.copy(u8, self.data.ptr[0..slice.len], slice);
        bun.debugAssert(slice.len <= std.math.maxInt(u32));
        self.data.len = @intCast(slice.len);
        self.head = 0;
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
            .data = self.activeSlice()[0 .. pos + 1],
            .newline_pos = pos,
        };
    }

    /// Consume bytes from the front of the buffer after processing a message.
    /// Just advances head offset - no copying until compaction threshold is reached.
    pub fn consume(self: *@This(), bytes: u32) void {
        self.head +|= bytes;

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

        // Check if we've consumed everything
        if (self.head >= self.data.len) {
            // Free memory if capacity exceeds threshold, otherwise just reset
            if (self.data.cap >= compaction_threshold) {
                self.data.deinit(bun.default_allocator);
                self.data = .{};
            } else {
                self.data.len = 0;
            }
            self.head = 0;
            self.scanned_pos = 0;
            self.newline_pos = null;
            return;
        }

        // Compact if head exceeds threshold to avoid unbounded memory growth
        if (self.head >= compaction_threshold) {
            self.compact();
        }
    }

    pub fn isEmpty(self: *const @This()) bool {
        return self.head >= self.data.len;
    }

    pub fn unusedCapacitySlice(self: *@This()) []u8 {
        return self.data.unusedCapacitySlice();
    }

    pub fn ensureUnusedCapacity(self: *@This(), additional: usize) void {
        bun.handleOom(self.data.ensureUnusedCapacity(bun.default_allocator, additional));
    }

    /// Notify the buffer that data was written directly (e.g., via pre-allocated slice).
    pub fn notifyWritten(self: *@This(), new_data: []const u8) void {
        bun.debugAssert(new_data.len <= std.math.maxInt(u32));
        self.data.len +|= @as(u32, @intCast(new_data.len));
        self.scanForNewline();
    }

    pub fn deinit(self: *@This()) void {
        self.data.deinit(bun.default_allocator);
    }
};

const bun = @import("bun");
const std = @import("std");
