// Represents data that can be either owned or temporary
pub const Data = union(enum) {
    owned: bun.ByteList,
    temporary: []const u8,
    inline_storage: InlineStorage,
    empty: void,

    pub const InlineStorage = bun.BoundedArray(u8, 15);

    pub const Empty: Data = .{ .empty = {} };

    pub fn create(possibly_inline_bytes: []const u8, allocator: std.mem.Allocator) !Data {
        if (possibly_inline_bytes.len == 0) {
            return .{ .empty = {} };
        }

        if (possibly_inline_bytes.len <= 15) {
            var inline_storage = InlineStorage{};
            @memcpy(inline_storage.buffer[0..possibly_inline_bytes.len], possibly_inline_bytes);
            inline_storage.len = @truncate(possibly_inline_bytes.len);
            return .{ .inline_storage = inline_storage };
        }
        return .{
            .owned = bun.ByteList.fromOwnedSlice(try allocator.dupe(u8, possibly_inline_bytes)),
        };
    }

    pub fn toOwned(this: @This()) !bun.ByteList {
        return switch (this) {
            .owned => this.owned,
            .temporary => bun.ByteList.fromOwnedSlice(
                try bun.default_allocator.dupe(u8, this.temporary),
            ),
            .empty => bun.ByteList.empty,
            .inline_storage => bun.ByteList.fromOwnedSlice(
                try bun.default_allocator.dupe(u8, this.inline_storage.slice()),
            ),
        };
    }

    pub fn deinit(this: *@This()) void {
        switch (this.*) {
            .owned => |*owned| owned.clearAndFree(bun.default_allocator),
            .temporary => {},
            .empty => {},
            .inline_storage => {},
        }
    }

    /// Zero bytes before deinit
    /// Generally, for security reasons.
    pub fn zdeinit(this: *@This()) void {
        switch (this.*) {
            .owned => |*owned| {
                // Zero bytes before deinit
                bun.freeSensitive(bun.default_allocator, owned.slice());
                owned.deinit(bun.default_allocator);
            },
            .temporary => {},
            .empty => {},
            .inline_storage => {},
        }
    }

    pub fn slice(this: *const @This()) []const u8 {
        return switch (this.*) {
            .owned => this.owned.slice(),
            .temporary => this.temporary,
            .empty => "",
            .inline_storage => this.inline_storage.slice(),
        };
    }

    pub fn substring(this: *const @This(), start_index: usize, end_index: usize) Data {
        return switch (this.*) {
            .owned => .{ .temporary = this.owned.slice()[start_index..end_index] },
            .temporary => .{ .temporary = this.temporary[start_index..end_index] },
            .empty => .{ .empty = {} },
            .inline_storage => .{ .temporary = this.inline_storage.slice()[start_index..end_index] },
        };
    }

    pub fn sliceZ(this: *const @This()) [:0]const u8 {
        return switch (this.*) {
            .owned => this.owned.slice()[0..this.owned.len :0],
            .temporary => this.temporary[0..this.temporary.len :0],
            .empty => "",
            .inline_storage => this.inline_storage.slice()[0..this.inline_storage.len :0],
        };
    }
};

const bun = @import("bun");
const std = @import("std");
