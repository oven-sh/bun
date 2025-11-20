const MutableString = @This();

allocator: Allocator,
list: std.ArrayListUnmanaged(u8),

pub fn init2048(allocator: Allocator) Allocator.Error!MutableString {
    return MutableString.init(allocator, 2048);
}

pub fn clone(self: *MutableString) Allocator.Error!MutableString {
    return MutableString.initCopy(self.allocator, self.list.items);
}

pub const Writer = std.Io.GenericWriter(*@This(), Allocator.Error, MutableString.writeAll);
pub fn writer(self: *MutableString) Writer {
    return Writer{
        .context = self,
    };
}

pub fn isEmpty(this: *const MutableString) bool {
    return this.list.items.len == 0;
}

pub fn deinit(str: *MutableString) void {
    if (str.list.capacity > 0) {
        str.list.expandToCapacity();
        str.list.clearAndFree(str.allocator);
    }
}

pub fn owns(this: *const MutableString, items: []const u8) bool {
    return bun.isSliceInBuffer(items, this.list.items.ptr[0..this.list.capacity]);
}

pub inline fn growIfNeeded(self: *MutableString, amount: usize) Allocator.Error!void {
    try self.list.ensureUnusedCapacity(self.allocator, amount);
}

pub fn writableNBytesAssumeCapacity(self: *MutableString, amount: usize) []u8 {
    bun.assert(self.list.items.len + amount <= self.list.capacity);
    self.list.items.len += amount;
    return self.list.items[self.list.items.len - amount ..];
}

/// Increases the length of the buffer by `amount` bytes, expanding the capacity if necessary.
/// Returns a pointer to the end of the list - `amount` bytes.
pub fn writableNBytes(self: *MutableString, amount: usize) Allocator.Error![]u8 {
    try self.growIfNeeded(amount);
    return self.writableNBytesAssumeCapacity(amount);
}

pub fn write(self: *MutableString, bytes: anytype) Allocator.Error!usize {
    bun.debugAssert(bytes.len == 0 or !bun.isSliceInBuffer(bytes, self.list.allocatedSlice()));
    try self.list.appendSlice(self.allocator, bytes);
    return bytes.len;
}

pub fn bufferedWriter(self: *MutableString) BufferedWriter {
    return BufferedWriter{ .context = self };
}

pub fn init(allocator: Allocator, capacity: usize) Allocator.Error!MutableString {
    return MutableString{
        .allocator = allocator,
        .list = if (capacity > 0)
            try std.ArrayListUnmanaged(u8).initCapacity(allocator, capacity)
        else
            std.ArrayListUnmanaged(u8){},
    };
}

pub fn initEmpty(allocator: Allocator) MutableString {
    return MutableString{ .allocator = allocator, .list = .{} };
}

pub const ensureUnusedCapacity = growIfNeeded;

pub fn initCopy(allocator: Allocator, str: anytype) Allocator.Error!MutableString {
    var mutable = try MutableString.init(allocator, str.len);
    try mutable.copy(str);
    return mutable;
}

/// Convert it to an ASCII identifier. Note: If you change this to a non-ASCII
/// identifier, you're going to potentially cause trouble with non-BMP code
/// points in target environments that don't support bracketed Unicode escapes.
pub fn ensureValidIdentifier(str: string, allocator: Allocator) Allocator.Error!string {
    if (str.len == 0) {
        return "_";
    }

    var iterator = strings.CodepointIterator.init(str);
    var cursor = strings.CodepointIterator.Cursor{};

    var has_needed_gap = false;
    var needs_gap = false;
    var start_i: usize = 0;

    if (!iterator.next(&cursor)) return "_";

    const JSLexerTables = @import("../js_lexer_tables.zig");

    // Common case: no gap necessary. No allocation necessary.
    needs_gap = !js_lexer.isIdentifierStart(cursor.c);
    if (!needs_gap) {
        // Are there any non-alphanumeric chars at all?
        while (iterator.next(&cursor)) {
            if (!js_lexer.isIdentifierContinue(cursor.c) or cursor.width > 1) {
                needs_gap = true;
                start_i = cursor.i;
                break;
            }
        }
    }

    if (!needs_gap) {
        return JSLexerTables.StrictModeReservedWordsRemap.get(str) orelse str;
    }

    if (needs_gap) {
        var mutable = try MutableString.initCopy(allocator, if (start_i == 0)
            // the first letter can be a non-identifier start
            // https://github.com/oven-sh/bun/issues/2946
            "_"
        else
            str[0..start_i]);
        needs_gap = false;

        var items = str[start_i..];
        iterator = strings.CodepointIterator.init(items);
        cursor = strings.CodepointIterator.Cursor{};

        while (iterator.next(&cursor)) {
            if (js_lexer.isIdentifierContinue(cursor.c) and cursor.width == 1) {
                if (needs_gap) {
                    try mutable.appendChar('_');
                    needs_gap = false;
                    has_needed_gap = true;
                }
                try mutable.append(items[cursor.i .. cursor.i + @as(u32, cursor.width)]);
            } else if (!needs_gap) {
                needs_gap = true;
                // skip the code point, replace it with a single _
            }
        }

        // If it ends with an emoji
        if (needs_gap) {
            try mutable.appendChar('_');
            needs_gap = false;
            has_needed_gap = true;
        }

        if (comptime bun.Environment.allow_assert) {
            bun.assert(js_lexer.isIdentifier(mutable.list.items));
        }

        return try mutable.list.toOwnedSlice(allocator);
    }

    return str;
}

pub fn len(self: *const MutableString) usize {
    return self.list.items.len;
}

pub fn copy(self: *MutableString, str: anytype) Allocator.Error!void {
    try self.list.ensureTotalCapacity(self.allocator, str[0..].len);

    if (self.list.items.len == 0) {
        try self.list.insertSlice(self.allocator, 0, str);
    } else {
        try self.list.replaceRange(self.allocator, 0, str[0..].len, str[0..]);
    }
}

pub inline fn growBy(self: *MutableString, amount: usize) Allocator.Error!void {
    try self.list.ensureUnusedCapacity(self.allocator, amount);
}

pub inline fn appendSlice(self: *MutableString, items: []const u8) Allocator.Error!void {
    try self.list.appendSlice(self.allocator, items);
}

pub inline fn appendSliceExact(self: *MutableString, items: []const u8) Allocator.Error!void {
    if (items.len == 0) return;
    try self.list.ensureTotalCapacityPrecise(self.allocator, self.list.items.len + items.len);
    var end = self.list.items.ptr + self.list.items.len;
    self.list.items.len += items.len;
    @memcpy(end[0..items.len], items);
}

pub inline fn reset(
    self: *MutableString,
) void {
    self.list.clearRetainingCapacity();
}

pub inline fn resetTo(
    self: *MutableString,
    index: usize,
) void {
    bun.assert(index <= self.list.capacity);
    self.list.items.len = index;
}

pub fn inflate(self: *MutableString, amount: usize) Allocator.Error!void {
    try self.list.resize(self.allocator, amount);
}

pub inline fn appendCharNTimes(self: *MutableString, char: u8, n: usize) Allocator.Error!void {
    try self.list.appendNTimes(self.allocator, char, n);
}

pub inline fn appendChar(self: *MutableString, char: u8) Allocator.Error!void {
    try self.list.append(self.allocator, char);
}
pub inline fn appendCharAssumeCapacity(self: *MutableString, char: u8) void {
    self.list.appendAssumeCapacity(char);
}
pub inline fn append(self: *MutableString, char: []const u8) Allocator.Error!void {
    try self.list.appendSlice(self.allocator, char);
}
pub inline fn appendInt(self: *MutableString, int: u64) Allocator.Error!void {
    const count = bun.fmt.fastDigitCount(int);
    try self.list.ensureUnusedCapacity(self.allocator, count);
    const old = self.list.items.len;
    self.list.items.len += count;
    bun.assert(count == std.fmt.printInt(self.list.items.ptr[old .. old + count], int, 10, .lower, .{}));
}

pub inline fn appendAssumeCapacity(self: *MutableString, char: []const u8) void {
    self.list.appendSliceAssumeCapacity(
        char,
    );
}
pub inline fn lenI(self: *MutableString) i32 {
    return @as(i32, @intCast(self.list.items.len));
}

pub fn takeSlice(self: *MutableString) []u8 {
    const out = self.list.items;
    self.list = .{};
    return out;
}

pub fn toOwnedSlice(self: *MutableString) []u8 {
    return bun.handleOom(self.list.toOwnedSlice(self.allocator)); // TODO
}

pub fn toDynamicOwned(self: *MutableString) DynamicOwned([]u8) {
    return .fromRawIn(self.toOwnedSlice(), self.allocator);
}

/// `self.allocator` must be `bun.default_allocator`.
pub fn toDefaultOwned(self: *MutableString) Owned([]u8) {
    bun.safety.alloc.assertEq(self.allocator, bun.default_allocator);
    return .fromRaw(self.toOwnedSlice());
}

pub fn slice(self: *MutableString) []u8 {
    return self.list.items;
}

/// Appends `0` if needed
pub fn sliceWithSentinel(self: *MutableString) [:0]u8 {
    if (self.list.items.len > 0 and self.list.items[self.list.items.len - 1] != 0) {
        bun.handleOom(self.list.append(self.allocator, 0));
    }
    return self.list.items[0 .. self.list.items.len - 1 :0];
}

pub fn toOwnedSliceLength(self: *MutableString, length: usize) string {
    self.list.items.len = length;
    return self.toOwnedSlice();
}

pub fn containsChar(self: *const MutableString, char: u8) bool {
    return self.indexOfChar(char) != null;
}

pub fn indexOfChar(self: *const MutableString, char: u8) ?u32 {
    return strings.indexOfChar(self.list.items, char);
}

pub fn lastIndexOfChar(self: *const MutableString, char: u8) ?usize {
    return strings.lastIndexOfChar(self.list.items, char);
}

pub fn lastIndexOf(self: *const MutableString, str: u8) ?usize {
    return strings.lastIndexOfChar(self.list.items, str);
}

pub fn indexOf(self: *const MutableString, str: u8) ?usize {
    return std.mem.indexOf(u8, self.list.items, str);
}

pub fn eql(self: *MutableString, other: anytype) bool {
    return std.mem.eql(u8, self.list.items, other);
}

pub fn toSocketBuffers(self: *MutableString, comptime count: usize, ranges: anytype) [count]std.posix.iovec_const {
    var buffers: [count]std.posix.iovec_const = undefined;
    inline for (&buffers, ranges) |*b, r| {
        b.* = .{
            .iov_base = self.list.items[r[0]..r[1]].ptr,
            .iov_len = self.list.items[r[0]..r[1]].len,
        };
    }
    return buffers;
}

pub const BufferedWriter = struct {
    context: *MutableString,
    buffer: [max]u8 = undefined,
    pos: usize = 0,

    const max = 2048;

    pub const Writer = std.Io.GenericWriter(*BufferedWriter, Allocator.Error, BufferedWriter.writeAll);

    inline fn remain(this: *BufferedWriter) []u8 {
        return this.buffer[this.pos..];
    }

    pub fn flush(this: *BufferedWriter) Allocator.Error!void {
        _ = try this.context.writeAll(this.buffer[0..this.pos]);
        this.pos = 0;
    }

    pub fn writeAll(this: *BufferedWriter, bytes: []const u8) Allocator.Error!usize {
        const pending = bytes;

        if (pending.len >= max) {
            try this.flush();
            try this.context.append(pending);
            return pending.len;
        }

        if (pending.len > 0) {
            if (pending.len + this.pos > max) {
                try this.flush();
            }
            @memcpy(this.remain()[0..pending.len], pending);
            this.pos += pending.len;
        }

        return pending.len;
    }

    const E = bun.ast.E;

    /// Write a E.String to the buffer.
    /// This automatically encodes UTF-16 into UTF-8 using
    /// the same code path as TextEncoder
    pub fn writeString(this: *BufferedWriter, bytes: *E.String) Allocator.Error!usize {
        if (bytes.isUTF8()) {
            return try this.writeAll(bytes.slice(this.context.allocator));
        }

        return try this.writeAll16(bytes.slice16());
    }

    /// Write a UTF-16 string to the (UTF-8) buffer
    /// This automatically encodes UTF-16 into UTF-8 using
    /// the same code path as TextEncoder
    pub fn writeAll16(this: *BufferedWriter, bytes: []const u16) Allocator.Error!usize {
        const pending = bytes;

        if (pending.len >= max) {
            try this.flush();
            try this.context.list.ensureUnusedCapacity(this.context.allocator, bytes.len * 2);
            const decoded = strings.copyUTF16IntoUTF8(
                this.remain()[0 .. bytes.len * 2],
                []const u16,
                bytes,
            );
            this.context.list.items.len += @as(usize, decoded.written);
            return pending.len;
        }

        if (pending.len > 0) {
            if ((pending.len * 2) + this.pos > max) {
                try this.flush();
            }
            const decoded = strings.copyUTF16IntoUTF8(
                this.remain()[0 .. bytes.len * 2],
                []const u16,
                bytes,
            );
            this.pos += @as(usize, decoded.written);
        }

        return pending.len;
    }

    pub fn writeHTMLAttributeValueString(this: *BufferedWriter, str: *E.String) Allocator.Error!void {
        if (str.isUTF8()) {
            try this.writeHTMLAttributeValue(str.slice(this.context.allocator));
            return;
        }

        try this.writeHTMLAttributeValue16(str.slice16());
    }

    pub fn writeHTMLAttributeValue(this: *BufferedWriter, bytes: []const u8) Allocator.Error!void {
        var items = bytes;
        while (items.len > 0) {
            // TODO: SIMD
            if (strings.indexOfAny(items, "\"<>")) |j| {
                _ = try this.writeAll(items[0..j]);
                _ = switch (items[j]) {
                    '"' => try this.writeAll("&quot;"),
                    '<' => try this.writeAll("&lt;"),
                    '>' => try this.writeAll("&gt;"),
                    else => unreachable,
                };

                items = items[j + 1 ..];
                continue;
            }

            _ = try this.writeAll(items);
            break;
        }
    }

    pub fn writeHTMLAttributeValue16(this: *BufferedWriter, bytes: []const u16) Allocator.Error!void {
        var items = bytes;
        while (items.len > 0) {
            if (strings.indexOfAny16(items, "\"<>")) |j| {
                // this won't handle strings larger than 4 GB
                // that's fine though, 4 GB of SSR'd HTML is quite a lot...
                _ = try this.writeAll16(items[0..j]);
                _ = switch (items[j]) {
                    '"' => try this.writeAll("&quot;"),
                    '<' => try this.writeAll("&lt;"),
                    '>' => try this.writeAll("&gt;"),
                    else => unreachable,
                };

                items = items[j + 1 ..];
                continue;
            }

            _ = try this.writeAll16(items);
            break;
        }
    }

    pub fn writer(this: *BufferedWriter) BufferedWriter.Writer {
        return BufferedWriter.Writer{ .context = this };
    }
};

pub fn writeAll(self: *MutableString, bytes: string) Allocator.Error!usize {
    try self.list.appendSlice(self.allocator, bytes);
    return bytes.len;
}

const string = []const u8;

const std = @import("std");
const Allocator = std.mem.Allocator;

const bun = @import("bun");
const js_lexer = bun.js_lexer;
const strings = bun.strings;

const DynamicOwned = bun.ptr.DynamicOwned;
const Owned = bun.ptr.Owned;
