const std = @import("std");
const Environment = @import("env.zig");

/// This is like ArrayList except it stores the length and capacity as u32
/// In practice, it is very unusual to have lengths above 4 GB
///
/// This lets us have array lists which occupy the same amount of space as a
/// slice
pub fn BabyList(comptime Type: type) type {
    return struct {
        const ListType = @This();
        ptr: [*]Type = undefined,
        len: u32 = 0,
        cap: u32 = 0,

        pub fn ensureUnusedCapacity(this: *@This(), allocator: std.mem.Allocator, count: usize) !void {
            var list_ = this.listManaged(allocator);
            try list_.ensureUnusedCapacity(count);
            this.update(list_);
        }

        pub fn append(this: *@This(), allocator: std.mem.Allocator, value: Type) !void {
            if (this.len + 1 < this.cap) {
                var list_ = this.listManaged(allocator);
                try list_.ensureUnusedCapacity(1);
                this.update(list_);
            }
            this.appendAssumeCapacity(value);
        }

        pub inline fn appendAssumeCapacity(this: *@This(), value: Type) void {
            this.ptr[this.len] = value;
            this.len += 1;
        }

        pub inline fn init(items: []const Type) ListType {
            @setRuntimeSafety(false);
            return ListType{
                // Remove the const qualifier from the items
                .ptr = @intToPtr([*]Type, @ptrToInt(items.ptr)),

                .len = @truncate(u32, items.len),
                .cap = @truncate(u32, items.len),
            };
        }

        pub inline fn fromList(list_: anytype) ListType {
            @setRuntimeSafety(false);

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
            @setRuntimeSafety(false);
            this.ptr = list_.items.ptr;
            this.len = @truncate(u32, list_.items.len);
            this.cap = @truncate(u32, list_.capacity);

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

        pub inline fn at(this: ListType, index: usize) *const Type {
            std.debug.assert(index < this.len);
            return &this.ptr[index];
        }

        pub inline fn mut(this: ListType, index: usize) *Type {
            std.debug.assert(index < this.len);
            return &this.ptr[index];
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

        pub inline fn slice(this: ListType) []Type {
            @setRuntimeSafety(false);
            return this.ptr[0..this.len];
        }
    };
}
