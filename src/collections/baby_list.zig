/// This is like ArrayList except it stores the length and capacity as u32
/// In practice, it is very unusual to have lengths above 4 GiB
pub fn BabyList(comptime Type: type) type {
    return struct {
        const Self = @This();

        ptr: [*]Type = &[_]Type{},
        len: u32 = 0,
        cap: u32 = 0,
        alloc_ptr: bun.safety.AllocPtr = .{},

        pub const Elem = Type;

        pub fn parse(input: *bun.css.Parser) bun.css.Result(Self) {
            return switch (input.parseCommaSeparated(Type, bun.css.generic.parseFor(Type))) {
                .result => |v| return .{ .result = Self{
                    .ptr = v.items.ptr,
                    .len = @intCast(v.items.len),
                    .cap = @intCast(v.capacity),
                } },
                .err => |e| return .{ .err = e },
            };
        }

        pub fn toCss(this: *const Self, comptime W: type, dest: *bun.css.Printer(W)) bun.css.PrintErr!void {
            return bun.css.to_css.fromBabyList(Type, this, W, dest);
        }

        pub fn eql(lhs: *const Self, rhs: *const Self) bool {
            if (lhs.len != rhs.len) return false;
            for (lhs.sliceConst(), rhs.sliceConst()) |*a, *b| {
                if (!bun.css.generic.eql(Type, a, b)) return false;
            }
            return true;
        }

        pub fn set(this: *@This(), slice_: []Type) void {
            this.ptr = slice_.ptr;
            this.len = @intCast(slice_.len);
            this.cap = @intCast(slice_.len);
        }

        pub fn available(this: *Self) []Type {
            return this.ptr[this.len..this.cap];
        }

        pub fn deinitWithAllocator(this: *Self, allocator: std.mem.Allocator) void {
            this.listManaged(allocator).deinit();
            this.* = .{};
        }

        pub fn shrinkAndFree(this: *Self, allocator: std.mem.Allocator, size: usize) void {
            var list_ = this.listManaged(allocator);
            list_.shrinkAndFree(size);
            this.update(list_);
        }

        pub fn orderedRemove(this: *Self, index: usize) Type {
            var l = this.list();
            defer this.update(l);
            return l.orderedRemove(index);
        }

        pub fn swapRemove(this: *Self, index: usize) Type {
            var l = this.list();
            defer this.update(l);
            return l.swapRemove(index);
        }

        pub fn sortAsc(this: *Self) void {
            bun.strings.sortAsc(this.slice());
        }

        pub fn contains(this: Self, item: []const Type) bool {
            return this.len > 0 and @intFromPtr(item.ptr) >= @intFromPtr(this.ptr) and @intFromPtr(item.ptr) < @intFromPtr(this.ptr) + this.len;
        }

        pub fn initConst(items: []const Type) callconv(bun.callconv_inline) Self {
            @setRuntimeSafety(false);
            return Self{
                // Remove the const qualifier from the items
                .ptr = @constCast(items.ptr),
                .len = @intCast(items.len),
                .cap = @intCast(items.len),
            };
        }

        pub fn ensureUnusedCapacity(this: *Self, allocator: std.mem.Allocator, count: usize) !void {
            var list_ = this.listManaged(allocator);
            try list_.ensureUnusedCapacity(count);
            this.update(list_);
        }

        pub fn pop(this: *Self) ?Type {
            if (this.len == 0) return null;
            this.len -= 1;
            return this.ptr[this.len];
        }

        pub fn clone(this: Self, allocator: std.mem.Allocator) !Self {
            const copy = try this.list().clone(allocator);
            return Self{
                .ptr = copy.items.ptr,
                .len = @intCast(copy.items.len),
                .cap = @intCast(copy.capacity),
            };
        }

        pub fn deepClone(this: Self, allocator: std.mem.Allocator) !Self {
            if (!@hasDecl(Type, "deepClone")) {
                @compileError("Unsupported type for BabyList.deepClone(): " ++ @typeName(Type));
            }

            var list_ = try initCapacity(allocator, this.len);
            for (this.slice()) |item| {
                const clone_result = item.deepClone(allocator);
                const cloned_item = switch (comptime @typeInfo(@TypeOf(clone_result))) {
                    .error_union => try clone_result,
                    else => clone_result,
                };
                list_.appendAssumeCapacity(cloned_item);
            }
            return list_;
        }

        /// Same as `deepClone` but calls `bun.outOfMemory` instead of returning an error.
        /// `Type.deepClone` must not return any error except `error.OutOfMemory`.
        pub fn deepCloneInfallible(this: Self, allocator: std.mem.Allocator) Self {
            return bun.handleOom(this.deepClone(allocator));
        }

        pub fn clearRetainingCapacity(this: *Self) void {
            this.len = 0;
        }

        pub fn replaceRange(
            allocator: std.mem.Allocator,
            this: *Self,
            start: usize,
            len_: usize,
            new_items: []const Type,
        ) !void {
            var list_ = this.listManaged(allocator);
            try list_.replaceRange(start, len_, new_items);
        }

        pub fn appendAssumeCapacity(this: *Self, value: Type) void {
            bun.assert(this.cap > this.len);
            this.ptr[this.len] = value;
            this.len += 1;
        }

        pub fn writableSlice(this: *Self, allocator: std.mem.Allocator, cap: usize) ![]Type {
            var list_ = this.listManaged(allocator);
            try list_.ensureUnusedCapacity(cap);
            const writable = list_.items.ptr[this.len .. this.len + @as(u32, @intCast(cap))];
            list_.items.len += cap;
            this.update(list_);
            return writable;
        }

        pub fn appendSliceAssumeCapacity(this: *Self, values: []const Type) void {
            const tail = this.ptr[this.len .. this.len + values.len];
            bun.assert(this.cap >= this.len + @as(u32, @intCast(values.len)));
            bun.copy(Type, tail, values);
            this.len += @intCast(values.len);
            bun.assert(this.cap >= this.len);
        }

        pub fn initCapacity(allocator: std.mem.Allocator, len: usize) std.mem.Allocator.Error!Self {
            var this = initWithBuffer(try allocator.alloc(Type, len));
            this.alloc_ptr.set(allocator);
            return this;
        }

        pub fn initWithBuffer(buffer: []Type) Self {
            return Self{
                .ptr = buffer.ptr,
                .len = 0,
                .cap = @intCast(buffer.len),
            };
        }

        pub fn init(items: []const Type) Self {
            @setRuntimeSafety(false);
            return Self{
                .ptr = @constCast(items.ptr),
                .len = @intCast(items.len),
                .cap = @intCast(items.len),
            };
        }

        pub fn fromList(list_: anytype) Self {
            if (comptime @TypeOf(list_) == Self) {
                return list_;
            }

            if (comptime @TypeOf(list_) == []const Type) {
                return init(list_);
            }

            if (comptime Environment.allow_assert) {
                bun.assert(list_.items.len <= list_.capacity);
            }

            return Self{
                .ptr = list_.items.ptr,
                .len = @intCast(list_.items.len),
                .cap = @intCast(list_.capacity),
            };
        }

        pub fn fromSlice(allocator: std.mem.Allocator, items: []const Type) !Self {
            const allocated = try allocator.alloc(Type, items.len);
            bun.copy(Type, allocated, items);

            return Self{
                .ptr = allocated.ptr,
                .len = @intCast(allocated.len),
                .cap = @intCast(allocated.len),
                .alloc_ptr = .init(allocator),
            };
        }

        pub fn allocatedSlice(this: *const Self) []u8 {
            if (this.cap == 0) return &.{};

            return this.ptr[0..this.cap];
        }

        pub fn update(this: *Self, list_: anytype) void {
            this.* = .{
                .ptr = list_.items.ptr,
                .len = @intCast(list_.items.len),
                .cap = @intCast(list_.capacity),
            };

            if (comptime Environment.allow_assert) {
                bun.assert(this.len <= this.cap);
            }
        }

        pub fn list(this: Self) std.ArrayListUnmanaged(Type) {
            return std.ArrayListUnmanaged(Type){
                .items = this.ptr[0..this.len],
                .capacity = this.cap,
            };
        }

        pub fn listManaged(this: *Self, allocator: std.mem.Allocator) std.ArrayList(Type) {
            this.alloc_ptr.set(allocator);
            var list_ = this.list();
            return list_.toManaged(allocator);
        }

        pub fn first(this: Self) callconv(bun.callconv_inline) ?*Type {
            return if (this.len > 0) this.ptr[0] else @as(?*Type, null);
        }

        pub fn last(this: Self) callconv(bun.callconv_inline) ?*Type {
            return if (this.len > 0) &this.ptr[this.len - 1] else @as(?*Type, null);
        }

        pub fn first_(this: Self) callconv(bun.callconv_inline) Type {
            return this.ptr[0];
        }

        pub fn at(this: Self, index: usize) callconv(bun.callconv_inline) *const Type {
            bun.assert(index < this.len);
            return &this.ptr[index];
        }

        pub fn mut(this: Self, index: usize) callconv(bun.callconv_inline) *Type {
            bun.assert(index < this.len);
            return &this.ptr[index];
        }

        pub fn one(allocator: std.mem.Allocator, value: Type) !Self {
            var items = try allocator.alloc(Type, 1);
            items[0] = value;
            return Self{
                .ptr = @as([*]Type, @ptrCast(items.ptr)),
                .len = 1,
                .cap = 1,
                .alloc_ptr = .init(allocator),
            };
        }

        pub fn @"[0]"(this: Self) callconv(bun.callconv_inline) Type {
            return this.ptr[0];
        }
        const OOM = error{OutOfMemory};

        pub fn push(this: *Self, allocator: std.mem.Allocator, value: Type) OOM!void {
            var list_ = this.listManaged(allocator);
            try list_.append(value);
            this.update(list_);
        }

        pub fn appendFmt(this: *Self, allocator: std.mem.Allocator, comptime fmt: []const u8, args: anytype) !void {
            var list_ = this.listManaged(allocator);
            const writer = list_.writer();
            try writer.print(fmt, args);

            this.update(list_);
        }

        pub fn insert(this: *Self, allocator: std.mem.Allocator, index: usize, val: Type) !void {
            var list_ = this.listManaged(allocator);
            try list_.insert(index, val);
            this.update(list_);
        }

        pub fn insertSlice(this: *Self, allocator: std.mem.Allocator, index: usize, vals: []const Type) !void {
            var list_ = this.listManaged(allocator);
            try list_.insertSlice(index, vals);
            this.update(list_);
        }

        pub fn append(this: *Self, allocator: std.mem.Allocator, value: []const Type) !void {
            var list_ = this.listManaged(allocator);
            try list_.appendSlice(value);
            this.update(list_);
        }

        pub fn slice(this: Self) callconv(bun.callconv_inline) []Type {
            @setRuntimeSafety(false);
            return this.ptr[0..this.len];
        }

        pub fn sliceConst(this: *const Self) callconv(bun.callconv_inline) []const Type {
            @setRuntimeSafety(false);
            return this.ptr[0..this.len];
        }

        pub fn write(this: *Self, allocator: std.mem.Allocator, str: []const u8) !u32 {
            if (comptime Type != u8)
                @compileError("Unsupported for type " ++ @typeName(Type));
            const initial = this.len;
            var list_ = this.listManaged(allocator);
            try list_.appendSlice(str);
            this.update(list_);
            return this.len - initial;
        }

        pub fn writeLatin1(this: *Self, allocator: std.mem.Allocator, str: []const u8) OOM!u32 {
            if (comptime Type != u8)
                @compileError("Unsupported for type " ++ @typeName(Type));
            const initial = this.len;
            const old = this.listManaged(allocator);
            const new = try strings.allocateLatin1IntoUTF8WithList(old, old.items.len, []const u8, str);
            this.update(new);
            return this.len - initial;
        }

        pub fn writeUTF16(this: *Self, allocator: std.mem.Allocator, str: []const u16) OOM!u32 {
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
                    const result = strings.copyUTF16IntoUTF8WithBufferImpl(
                        slice_,
                        []const u16,
                        remain,
                        trimmed,
                        out_len,
                        // FIXME: Unclear whether or not we should allow
                        //        incomplete UTF-8 sequences. If you are solving a bug
                        //        with invalid UTF-8 sequences, this may be the
                        //        culprit...
                        true,
                    );
                    remain = remain[result.read..];
                    list_.items.len += @as(usize, result.written);
                    if (result.read == 0 or result.written == 0) break;
                }
            }

            return this.len - initial;
        }

        pub fn writeTypeAsBytesAssumeCapacity(this: *Self, comptime Int: type, int: Int) void {
            if (comptime Type != u8)
                @compileError("Unsupported for type " ++ @typeName(Type));
            bun.assert(this.cap >= this.len + @sizeOf(Int));
            @as([*]align(1) Int, @ptrCast(this.ptr[this.len .. this.len + @sizeOf(Int)]))[0] = int;
            this.len += @sizeOf(Int);
        }

        pub fn memoryCost(self: *const Self) usize {
            return self.cap;
        }
    };
}

pub fn OffsetList(comptime Type: type) type {
    return struct {
        head: u32 = 0,
        byte_list: List = .{},

        const List = BabyList(Type);
        const Self = @This();

        pub fn init(head: u32, byte_list: List) Self {
            return .{
                .head = head,
                .byte_list = byte_list,
            };
        }

        pub fn write(self: *Self, allocator: std.mem.Allocator, bytes: []const u8) !void {
            _ = try self.byte_list.write(allocator, bytes);
        }

        pub fn slice(this: *Self) []u8 {
            return this.byte_list.slice()[0..this.head];
        }

        pub fn remaining(this: *Self) []u8 {
            return this.byte_list.slice()[this.head..];
        }

        pub fn consume(self: *Self, bytes: u32) void {
            self.head +|= bytes;
            if (self.head >= self.byte_list.len) {
                self.head = 0;
                self.byte_list.len = 0;
            }
        }

        pub fn len(self: *const Self) u32 {
            return self.byte_list.len - self.head;
        }

        pub fn clear(self: *Self) void {
            self.head = 0;
            self.byte_list.len = 0;
        }

        pub fn deinit(self: *Self, allocator: std.mem.Allocator) void {
            self.byte_list.deinitWithAllocator(allocator);
            self.* = .{};
        }
    };
}

const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const strings = bun.strings;
