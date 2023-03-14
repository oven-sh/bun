const std = @import("std");
const Environment = @import("./env.zig");
const strings = @import("./string_immutable.zig");
const bun = @import("bun");

/// This is like ArrayList except it stores the length and capacity as u32
/// In practice, it is very unusual to have lengths above 4 GB
///
/// This lets us have array lists which occupy the same amount of space as a slice
pub fn BabyList(comptime Type: type) type {
    return struct {
        const ListType = @This();
        ptr: [*]Type = undefined,
        len: u32 = 0,
        cap: u32 = 0,

        pub fn available(this: *@This()) []Type {
            return this.ptr[this.len..this.cap];
        }

        pub fn deinitWithAllocator(this: *@This(), allocator: std.mem.Allocator) void {
            this.listManaged(allocator).deinit();
            this.* = .{};
        }

        pub fn contains(this: @This(), item: []const Type) bool {
            return this.len > 0 and @ptrToInt(item.ptr) >= @ptrToInt(this.ptr) and @ptrToInt(item.ptr) < @ptrToInt(this.ptr) + this.len;
        }

        pub inline fn initConst(items: []const Type) ListType {
            return ListType{
                // Remove the const qualifier from the items
                .ptr = @intToPtr([*]Type, @ptrToInt(items.ptr)),

                .len = @truncate(u32, items.len),
                .cap = @truncate(u32, items.len),
            };
        }

        pub inline fn init(items: []Type) ListType {
            return ListType{
                .ptr = items.ptr,
                .len = @truncate(u32, items.len),
                .cap = @truncate(u32, items.len),
            };
        }

        pub inline fn fromList(list_: anytype) ListType {
            if (comptime Environment.allow_assert) {
                std.debug.assert(list_.items.len <= list_.capacity);
            }

            return ListType{
                .ptr = list_.items.ptr,
                .len = @truncate(u32, list_.items.len),
                .cap = @truncate(u32, list_.capacity),
            };
        }

        pub fn update(this: *ListType, list_: anytype) void {
            this.* = .{
                .ptr = list_.items.ptr,
                .len = @truncate(u32, list_.items.len),
                .cap = @truncate(u32, list_.capacity),
            };

            if (comptime Environment.allow_assert) {
                std.debug.assert(this.len <= this.cap);
            }
        }

        pub fn list(this: ListType) std.ArrayListUnmanaged(Type) {
            return std.ArrayListUnmanaged(Type){
                .items = this.ptr[0..this.len],
                .capacity = this.cap,
            };
        }

        pub fn listManaged(this: ListType, allocator: std.mem.Allocator) std.ArrayList(Type) {
            return std.ArrayList(Type){
                .items = this.ptr[0..this.len],
                .capacity = this.cap,
                .allocator = allocator,
            };
        }

        pub inline fn first(this: ListType) ?*Type {
            return if (this.len > 0) this.ptr[0] else @as(?*Type, null);
        }

        pub inline fn last(this: ListType) ?*Type {
            return if (this.len > 0) &this.ptr[this.len - 1] else @as(?*Type, null);
        }

        pub inline fn first_(this: ListType) Type {
            return this.ptr[0];
        }

        pub fn one(allocator: std.mem.Allocator, value: Type) !ListType {
            var items = try allocator.alloc(Type, 1);
            items[0] = value;
            return ListType{
                .ptr = @ptrCast([*]Type, items.ptr),
                .len = 1,
                .cap = 1,
            };
        }

        pub inline fn @"[0]"(this: ListType) Type {
            return this.ptr[0];
        }
        const OOM = error{OutOfMemory};

        pub fn push(this: *ListType, allocator: std.mem.Allocator, value: Type) OOM!void {
            var list_ = this.list();
            try list_.append(allocator, value);
            this.update(list_);
        }

        pub fn append(this: *ListType, allocator: std.mem.Allocator, value: []const Type) OOM!void {
            var list_ = this.list();
            try list_.appendSlice(allocator, value);
            this.update(list_);
        }

        pub inline fn slice(this: ListType) []Type {
            @setRuntimeSafety(false);
            return this.ptr[0..this.len];
        }

        pub fn write(this: *@This(), allocator: std.mem.Allocator, str: []const u8) !u32 {
            if (comptime Type != u8)
                @compileError("Unsupported for type " ++ @typeName(Type));
            const initial = this.len;
            var list_ = this.listManaged(allocator);
            try list_.appendSlice(str);
            this.update(list_);
            return this.len - initial;
        }
        pub fn writeLatin1(this: *@This(), allocator: std.mem.Allocator, str: []const u8) !u32 {
            if (comptime Type != u8)
                @compileError("Unsupported for type " ++ @typeName(Type));
            const initial = this.len;
            const old = this.listManaged(allocator);
            const new = try strings.allocateLatin1IntoUTF8WithList(old, old.items.len, []const u8, str);
            this.update(new);
            return this.len - initial;
        }
        pub fn writeUTF16(this: *@This(), allocator: std.mem.Allocator, str: []const u16) !u32 {
            if (comptime Type != u8)
                @compileError("Unsupported for type " ++ @typeName(Type));

            var list_ = this.listManaged(allocator);
            const initial = this.len;
            outer: {
                defer this.update(list_);
                const trimmed = bun.simdutf.trim.utf16(str);
                if (trimmed.len == 0)
                    break :outer;
                const available_len = (list_.capacity - list_.items.len);

                // maximum UTF-16 length is 3 times the UTF-8 length + 2
                // only do the pass over the input length if we may not have enough space
                const out_len = if (available_len <= (trimmed.len * 3 + 2))
                    bun.simdutf.length.utf8.from.utf16.le(trimmed)
                else
                    str.len;

                if (out_len == 0)
                    break :outer;

                // intentionally over-allocate a little
                try list_.ensureTotalCapacity(list_.items.len + out_len);

                var remain = str;
                while (remain.len > 0) {
                    const orig_len = list_.items.len;

                    var slice_ = list_.items.ptr[orig_len..list_.capacity];
                    const result = strings.copyUTF16IntoUTF8WithBuffer(slice_, []const u16, remain, trimmed, out_len, true);
                    remain = remain[result.read..];
                    list_.items.len += @as(usize, result.written);
                    if (result.read == 0 or result.written == 0) break;
                }
            }

            return this.len - initial;
        }
    };
}
