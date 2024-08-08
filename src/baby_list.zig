const std = @import("std");
const Environment = @import("./env.zig");
const strings = @import("./string_immutable.zig");
const bun = @import("root").bun;

/// This is like ArrayList except it stores the length and capacity as u32
/// In practice, it is very unusual to have lengths above 4 GB
pub fn BabyList(comptime Type: type) type {
    return struct {
        const ListType = @This();
        ptr: [*]Type = undefined,
        len: u32 = 0,
        cap: u32 = 0,

        pub const Elem = Type;

        pub fn set(this: *@This(), slice_: []Type) void {
            this.ptr = slice_.ptr;
            this.len = @as(u32, @truncate(slice_.len));
            this.cap = @as(u32, @truncate(slice_.len));
        }

        pub fn available(this: *@This()) []Type {
            return this.ptr[this.len..this.cap];
        }

        pub fn deinitWithAllocator(this: *@This(), allocator: std.mem.Allocator) void {
            this.listManaged(allocator).deinit();
            this.* = .{};
        }

        pub fn orderedRemove(this: *@This(), index: usize) Type {
            var l = this.list();
            defer this.update(l);
            return l.orderedRemove(index);
        }

        pub fn swapRemove(this: *@This(), index: usize) Type {
            var l = this.list();
            defer this.update(l);
            return l.swapRemove(index);
        }

        pub fn contains(this: @This(), item: []const Type) bool {
            return this.len > 0 and @intFromPtr(item.ptr) >= @intFromPtr(this.ptr) and @intFromPtr(item.ptr) < @intFromPtr(this.ptr) + this.len;
        }

        pub inline fn initConst(items: []const Type) ListType {
            @setRuntimeSafety(false);
            return ListType{
                // Remove the const qualifier from the items
                .ptr = @constCast(items.ptr),
                .len = @as(u32, @truncate(items.len)),
                .cap = @as(u32, @truncate(items.len)),
            };
        }

        pub fn ensureUnusedCapacity(this: *@This(), allocator: std.mem.Allocator, count: usize) !void {
            var list_ = this.listManaged(allocator);
            try list_.ensureUnusedCapacity(count);
            this.update(list_);
        }

        pub fn popOrNull(this: *@This()) ?Type {
            if (this.len == 0) return null;
            this.len -= 1;
            return this.ptr[this.len];
        }

        pub fn clone(this: @This(), allocator: std.mem.Allocator) !@This() {
            var list_ = this.listManaged(allocator);
            const copy = try list_.clone();
            return ListType{
                .ptr = copy.items.ptr,
                .len = @as(u32, @truncate(copy.items.len)),
                .cap = @as(u32, @truncate(copy.capacity)),
            };
        }

        pub fn deepClone(this: @This(), allocator: std.mem.Allocator) !@This() {
            if (comptime Type != bun.JSAst.Expr and Type != bun.JSAst.G.Property) @compileError("Unsupported type for BabyList.deepClone()");
            var list_ = try initCapacity(allocator, this.len);
            for (this.slice()) |item| {
                list_.appendAssumeCapacity(try item.deepClone(allocator));
            }

            return list_;
        }

        pub fn clearRetainingCapacity(this: *@This()) void {
            this.len = 0;
        }

        pub fn replaceRange(this: *@This(), start: usize, len_: usize, new_items: []const Type) !void {
            var list_ = this.listManaged(bun.default_allocator);
            try list_.replaceRange(start, len_, new_items);
        }

        pub fn appendAssumeCapacity(this: *@This(), value: Type) void {
            bun.assert(this.cap > this.len);
            this.ptr[this.len] = value;
            this.len += 1;
        }

        pub fn writableSlice(this: *@This(), allocator: std.mem.Allocator, cap: usize) ![]Type {
            var list_ = this.listManaged(allocator);
            try list_.ensureUnusedCapacity(cap);
            const writable = list_.items.ptr[this.len .. this.len + @as(u32, @truncate(cap))];
            list_.items.len += cap;
            this.update(list_);
            return writable;
        }

        pub fn appendSliceAssumeCapacity(this: *@This(), values: []const Type) void {
            const tail = this.ptr[this.len .. this.len + values.len];
            bun.assert(this.cap >= this.len + @as(u32, @truncate(values.len)));
            bun.copy(Type, tail, values);
            this.len += @as(u32, @truncate(values.len));
            bun.assert(this.cap >= this.len);
        }

        pub fn initCapacity(allocator: std.mem.Allocator, len: usize) !ListType {
            return initWithBuffer(try allocator.alloc(Type, len));
        }

        pub fn initWithBuffer(buffer: []Type) ListType {
            return ListType{
                .ptr = buffer.ptr,
                .len = 0,
                .cap = @as(u32, @truncate(buffer.len)),
            };
        }

        pub fn init(items: []const Type) ListType {
            @setRuntimeSafety(false);
            return ListType{
                .ptr = @constCast(items.ptr),
                .len = @as(u32, @truncate(items.len)),
                .cap = @as(u32, @truncate(items.len)),
            };
        }

        pub fn fromList(list_: anytype) ListType {
            if (comptime @TypeOf(list_) == ListType) {
                return list_;
            }

            if (comptime @TypeOf(list_) == []const Elem) {
                return init(list_);
            }

            if (comptime Environment.allow_assert) {
                bun.assert(list_.items.len <= list_.capacity);
            }

            return ListType{
                .ptr = list_.items.ptr,
                .len = @as(u32, @truncate(list_.items.len)),
                .cap = @as(u32, @truncate(list_.capacity)),
            };
        }

        pub fn fromSlice(allocator: std.mem.Allocator, items: []const Elem) !ListType {
            const allocated = try allocator.alloc(Elem, items.len);
            bun.copy(Elem, allocated, items);

            return ListType{
                .ptr = allocated.ptr,
                .len = @as(u32, @truncate(allocated.len)),
                .cap = @as(u32, @truncate(allocated.len)),
            };
        }

        pub fn allocatedSlice(this: *const ListType) []u8 {
            if (this.cap == 0) return &.{};

            return this.ptr[0..this.cap];
        }

        pub fn update(this: *ListType, list_: anytype) void {
            this.* = .{
                .ptr = list_.items.ptr,
                .len = @as(u32, @truncate(list_.items.len)),
                .cap = @as(u32, @truncate(list_.capacity)),
            };

            if (comptime Environment.allow_assert) {
                bun.assert(this.len <= this.cap);
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
            bun.assert(index < this.len);
            return &this.ptr[index];
        }

        pub inline fn mut(this: ListType, index: usize) *Type {
            bun.assert(index < this.len);
            return &this.ptr[index];
        }

        pub fn one(allocator: std.mem.Allocator, value: Type) !ListType {
            var items = try allocator.alloc(Type, 1);
            items[0] = value;
            return ListType{
                .ptr = @as([*]Type, @ptrCast(items.ptr)),
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

        pub fn appendFmt(this: *@This(), allocator: std.mem.Allocator, comptime fmt: []const u8, args: anytype) !void {
            var list__ = this.listManaged(allocator);
            const writer = list__.writer();
            try writer.print(fmt, args);
        }

        pub fn append(this: *@This(), allocator: std.mem.Allocator, value: []const Type) !void {
            var list__ = this.listManaged(allocator);
            try list__.appendSlice(value);
            this.update(list__);
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

                    const slice_ = list_.items.ptr[orig_len..list_.capacity];
                    const result = strings.copyUTF16IntoUTF8WithBuffer(slice_, []const u16, remain, trimmed, out_len, true);
                    remain = remain[result.read..];
                    list_.items.len += @as(usize, result.written);
                    if (result.read == 0 or result.written == 0) break;
                }
            }

            return this.len - initial;
        }

        pub fn writeTypeAsBytesAssumeCapacity(this: *@This(), comptime Int: type, int: Int) void {
            if (comptime Type != u8)
                @compileError("Unsupported for type " ++ @typeName(Type));
            bun.assert(this.cap >= this.len + @sizeOf(Int));
            @as([*]align(1) Int, @ptrCast(this.ptr[this.len .. this.len + @sizeOf(Int)]))[0] = int;
            this.len += @sizeOf(Int);
        }
    };
}
