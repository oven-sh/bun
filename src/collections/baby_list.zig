/// This is like ArrayList except it stores the length and capacity as u32
/// In practice, it is very unusual to have lengths above 4 GiB
pub fn BabyList(comptime Type: type) type {
    const Origin = union(enum) {
        owned,
        borrowed: struct {
            trace: if (traces_enabled) StoredTrace else void,
        },
    };

    return struct {
        const Self = @This();

        // NOTE: If you add, remove, or rename any public fields, you need to update
        // `looksLikeListContainerType` in `meta.zig`.

        /// Don't access this field directly, as it's not safety-checked. Use `.slice()`, `.at()`,
        /// or `.mut()`.
        ptr: [*]Type = &.{},
        len: u32 = 0,
        cap: u32 = 0,
        #origin: if (safety_checks) Origin else void = if (safety_checks) .owned,
        #allocator: bun.safety.CheckedAllocator = .{},

        pub const Elem = Type;

        pub const empty: Self = .{};

        pub fn initCapacity(allocator: std.mem.Allocator, len: usize) OOM!Self {
            var this = initWithBuffer(try allocator.alloc(Type, len));
            this.#allocator.set(allocator);
            return this;
        }

        pub fn initOne(allocator: std.mem.Allocator, value: Type) OOM!Self {
            var items = try allocator.alloc(Type, 1);
            items[0] = value;
            return .{
                .ptr = @as([*]Type, @ptrCast(items.ptr)),
                .len = 1,
                .cap = 1,
                .#allocator = .init(allocator),
            };
        }

        pub fn moveFromList(list_ptr: anytype) Self {
            const ListType = std.meta.Child(@TypeOf(list_ptr));

            if (comptime ListType == Self) {
                @compileError("unnecessary call to `moveFromList`");
            }

            const unsupported_arg_msg = "unsupported argument to `moveFromList`: *" ++
                @typeName(ListType);

            const capacity = if (comptime @hasField(ListType, "capacity"))
                list_ptr.capacity
            else if (comptime @hasField(ListType, "cap"))
                list_ptr.cap
            else if (comptime std.meta.hasFn(ListType, "capacity"))
                list_ptr.capacity()
            else
                @compileError(unsupported_arg_msg);

            const items = if (comptime std.meta.hasFn(ListType, "moveToUnmanaged"))
                list_ptr.moveToUnmanaged().items
            else if (comptime @hasField(ListType, "items"))
                list_ptr.items
            else if (comptime std.meta.hasFn(ListType, "slice"))
                list_ptr.slice()
            else
                @compileError(unsupported_arg_msg);

            if (comptime Environment.allow_assert) {
                bun.assert(items.len <= capacity);
            }

            var this: Self = .{
                .ptr = items.ptr,
                .len = @intCast(items.len),
                .cap = @intCast(capacity),
            };

            const allocator = if (comptime @hasField(ListType, "allocator"))
                list_ptr.allocator
            else if (comptime std.meta.hasFn(ListType, "allocator"))
                list_ptr.allocator();

            if (comptime @TypeOf(allocator) == void) {
                list_ptr.* = .empty;
            } else {
                this.#allocator.set(bun.allocators.asStd(allocator));
                // `moveToUnmanaged` already cleared the old list.
                if (comptime !std.meta.hasFn(ListType, "moveToUnmanaged")) {
                    list_ptr.* = .init(allocator);
                }
            }
            return this;
        }

        /// Requirements:
        ///
        /// * `items` must be owned memory, allocated with some allocator. That same allocator must
        ///   be passed to methods that expect it, like `append`.
        ///
        /// * `items` must be the *entire* region of allocated memory. It cannot be a subslice.
        ///   If you really need an owned subslice, use `shrinkRetainingCapacity` followed by
        ///   `toOwnedSlice` on an `ArrayList`.
        pub fn fromOwnedSlice(items: []Type) Self {
            return .{
                .ptr = items.ptr,
                .len = @intCast(items.len),
                .cap = @intCast(items.len),
            };
        }

        /// Same requirements as `fromOwnedSlice`.
        pub fn initWithBuffer(buffer: []Type) Self {
            return .{
                .ptr = buffer.ptr,
                .len = 0,
                .cap = @intCast(buffer.len),
            };
        }

        /// Copies all elements of `items` into new memory. Creates shallow copies.
        pub fn fromSlice(allocator: std.mem.Allocator, items: []const Type) OOM!Self {
            const allocated = try allocator.alloc(Type, items.len);
            bun.copy(Type, allocated, items);

            return Self{
                .ptr = allocated.ptr,
                .len = @intCast(allocated.len),
                .cap = @intCast(allocated.len),
                .#allocator = .init(allocator),
            };
        }

        /// This method invalidates the `BabyList`. Use `clearAndFree` if you want to empty the
        /// list instead.
        pub fn deinit(this: *Self, allocator: std.mem.Allocator) void {
            this.assertOwned();
            this.listManaged(allocator).deinit();
            this.* = undefined;
        }

        pub fn clearAndFree(this: *Self, allocator: std.mem.Allocator) void {
            this.deinit(allocator);
            this.* = .{};
        }

        pub fn clearRetainingCapacity(this: *Self) void {
            this.len = 0;
        }

        pub fn slice(this: Self) callconv(bun.callconv_inline) []Type {
            return this.ptr[0..this.len];
        }

        /// Same as `.slice()`, with an explicit coercion to const.
        pub fn sliceConst(this: Self) callconv(bun.callconv_inline) []const Type {
            return this.slice();
        }

        pub fn at(this: Self, index: usize) callconv(bun.callconv_inline) *const Type {
            bun.assert(index < this.len);
            return &this.ptr[index];
        }

        pub fn mut(this: Self, index: usize) callconv(bun.callconv_inline) *Type {
            bun.assert(index < this.len);
            return &this.ptr[index];
        }

        pub fn first(this: Self) callconv(bun.callconv_inline) ?*Type {
            return if (this.len > 0) &this.ptr[0] else null;
        }

        pub fn last(this: Self) callconv(bun.callconv_inline) ?*Type {
            return if (this.len > 0) &this.ptr[this.len - 1] else null;
        }

        /// Empties the `BabyList`.
        pub fn toOwnedSlice(this: *Self, allocator: std.mem.Allocator) OOM![]Type {
            if ((comptime safety_checks) and this.len != this.cap) this.assertOwned();
            var list_ = this.listManaged(allocator);
            const result = try list_.toOwnedSlice();
            this.* = .empty;
            return result;
        }

        pub fn moveToList(this: *Self) std.ArrayListUnmanaged(Type) {
            this.assertOwned();
            defer this.* = .empty;
            return this.list();
        }

        pub fn moveToListManaged(this: *Self, allocator: std.mem.Allocator) std.array_list.Managed(Type) {
            this.assertOwned();
            defer this.* = .empty;
            return this.listManaged(allocator);
        }

        pub fn expandToCapacity(this: *Self) void {
            this.len = this.cap;
        }

        pub fn ensureTotalCapacity(
            this: *Self,
            allocator: std.mem.Allocator,
            new_capacity: usize,
        ) !void {
            if ((comptime safety_checks) and new_capacity > this.cap) this.assertOwned();
            var list_ = this.listManaged(allocator);
            try list_.ensureTotalCapacity(new_capacity);
            this.update(list_);
        }

        pub fn ensureTotalCapacityPrecise(
            this: *Self,
            allocator: std.mem.Allocator,
            new_capacity: usize,
        ) !void {
            if ((comptime safety_checks) and new_capacity > this.cap) this.assertOwned();
            var list_ = this.listManaged(allocator);
            try list_.ensureTotalCapacityPrecise(new_capacity);
            this.update(list_);
        }

        pub fn ensureUnusedCapacity(
            this: *Self,
            allocator: std.mem.Allocator,
            count: usize,
        ) OOM!void {
            if ((comptime safety_checks) and count > this.cap - this.len) this.assertOwned();
            var list_ = this.listManaged(allocator);
            try list_.ensureUnusedCapacity(count);
            this.update(list_);
        }

        pub fn shrinkAndFree(this: *Self, allocator: std.mem.Allocator, new_len: usize) void {
            if ((comptime safety_checks) and new_len < this.cap) this.assertOwned();
            var list_ = this.listManaged(allocator);
            list_.shrinkAndFree(new_len);
            this.update(list_);
        }

        pub fn shrinkRetainingCapacity(this: *Self, new_len: usize) void {
            bun.assertf(
                new_len <= this.len,
                "shrinkRetainingCapacity: new len ({d}) cannot exceed old ({d})",
                .{ new_len, this.len },
            );
            this.len = @intCast(new_len);
        }

        pub fn append(this: *Self, allocator: std.mem.Allocator, value: Type) OOM!void {
            if ((comptime safety_checks) and this.len == this.cap) this.assertOwned();
            var list_ = this.listManaged(allocator);
            try list_.append(value);
            this.update(list_);
        }

        pub fn appendAssumeCapacity(this: *Self, value: Type) void {
            bun.assert(this.cap > this.len);
            this.ptr[this.len] = value;
            this.len += 1;
        }

        pub fn appendSlice(this: *Self, allocator: std.mem.Allocator, vals: []const Type) !void {
            if ((comptime safety_checks) and this.cap - this.len < vals.len) this.assertOwned();
            var list_ = this.listManaged(allocator);
            try list_.appendSlice(vals);
            this.update(list_);
        }

        pub fn appendSliceAssumeCapacity(this: *Self, values: []const Type) void {
            bun.assert(this.cap >= this.len + @as(u32, @intCast(values.len)));
            const tail = this.ptr[this.len .. this.len + values.len];
            bun.copy(Type, tail, values);
            this.len += @intCast(values.len);
            bun.assert(this.cap >= this.len);
        }

        pub fn pop(this: *Self) ?Type {
            if (this.len == 0) return null;
            this.len -= 1;
            return this.ptr[this.len];
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

        pub fn insert(this: *Self, allocator: std.mem.Allocator, index: usize, val: Type) OOM!void {
            if ((comptime safety_checks) and this.len == this.cap) this.assertOwned();
            var list_ = this.listManaged(allocator);
            try list_.insert(index, val);
            this.update(list_);
        }

        pub fn insertSlice(
            this: *Self,
            allocator: std.mem.Allocator,
            index: usize,
            vals: []const Type,
        ) OOM!void {
            if ((comptime safety_checks) and this.cap - this.len < vals.len) this.assertOwned();
            var list_ = this.listManaged(allocator);
            try list_.insertSlice(index, vals);
            this.update(list_);
        }

        pub fn replaceRange(
            allocator: std.mem.Allocator,
            this: *Self,
            start: usize,
            len_: usize,
            new_items: []const Type,
        ) OOM!void {
            var list_ = this.listManaged(allocator);
            try list_.replaceRange(start, len_, new_items);
        }

        pub fn clone(this: Self, allocator: std.mem.Allocator) OOM!Self {
            var copy = try this.list().clone(allocator);
            return .moveFromList(&copy);
        }

        pub fn unusedCapacitySlice(this: Self) []Type {
            return this.ptr[this.len..this.cap];
        }

        pub fn contains(this: Self, item: []const Type) bool {
            return this.len > 0 and
                @intFromPtr(item.ptr) >= @intFromPtr(this.ptr) and
                @intFromPtr(item.ptr) < @intFromPtr(this.ptr) + this.len;
        }

        pub fn sortAsc(this: *Self) void {
            bun.strings.sortAsc(this.slice());
        }

        pub fn sort(this: *Self, comptime Context: type, context: Context) void {
            std.sort.pdq(Type, this.slice(), context, Context.lessThan);
        }

        pub fn writableSlice(
            this: *Self,
            allocator: std.mem.Allocator,
            additional: usize,
        ) OOM![]Type {
            if ((comptime safety_checks) and additional > this.cap - this.len) this.assertOwned();
            var list_ = this.listManaged(allocator);
            try list_.ensureUnusedCapacity(additional);
            const prev_len = list_.items.len;
            list_.items.len += additional;
            const writable = list_.items[prev_len..];
            this.update(list_);
            return writable;
        }

        pub fn allocatedSlice(this: Self) []Type {
            return this.ptr[0..this.cap];
        }

        pub fn memoryCost(this: Self) usize {
            return this.cap * @sizeOf(Type);
        }

        /// This method is available only for `BabyList(u8)`.
        pub fn appendFmt(
            this: *Self,
            allocator: std.mem.Allocator,
            comptime fmt: []const u8,
            args: anytype,
        ) OOM!void {
            if ((comptime safety_checks) and this.len == this.cap) this.assertOwned();
            var list_ = this.listManaged(allocator);
            const writer = list_.writer();
            try writer.print(fmt, args);
            this.update(list_);
        }

        /// This method is available only for `BabyList(u8)`.
        pub fn write(this: *Self, allocator: std.mem.Allocator, str: []const u8) OOM!u32 {
            if ((comptime safety_checks) and this.cap - this.len < str.len) this.assertOwned();
            if (comptime Type != u8)
                @compileError("Unsupported for type " ++ @typeName(Type));
            const initial = this.len;
            var list_ = this.listManaged(allocator);
            try list_.appendSlice(str);
            this.update(list_);
            return this.len - initial;
        }

        /// This method is available only for `BabyList(u8)`.
        pub fn writeLatin1(this: *Self, allocator: std.mem.Allocator, str: []const u8) OOM!u32 {
            if ((comptime safety_checks) and str.len > 0) this.assertOwned();
            if (comptime Type != u8)
                @compileError("Unsupported for type " ++ @typeName(Type));
            const initial = this.len;
            const old = this.listManaged(allocator);
            const new = try strings.allocateLatin1IntoUTF8WithList(old, old.items.len, str);
            this.update(new);
            return this.len - initial;
        }

        /// This method is available only for `BabyList(u8)`. Invalid characters are replaced with
        /// replacement character
        pub fn writeUTF16(this: *Self, allocator: std.mem.Allocator, str: []const u16) OOM!u32 {
            if ((comptime safety_checks) and str.len > 0) this.assertOwned();
            if (comptime Type != u8)
                @compileError("Unsupported for type " ++ @typeName(Type));

            const initial_len = this.len;

            var list_ = this.listManaged(allocator);
            {
                defer this.update(list_);

                // Maximum UTF-16 length is 3 times the UTF-8 length + 2
                const length_estimate = if (list_.unusedCapacitySlice().len <= (str.len * 3 + 2))
                    // This length is an estimate. `str` isn't validated and might contain invalid
                    // sequences. If it does simdutf will assume they require 2 characters instead
                    // of 3.
                    bun.simdutf.length.utf8.from.utf16.le(str)
                else
                    str.len;

                try list_.ensureUnusedCapacity(length_estimate);

                try strings.convertUTF16ToUTF8Append(&list_, str);
            }

            return this.len - initial_len;
        }

        /// This method is available only for `BabyList(u8)`.
        pub fn writeTypeAsBytesAssumeCapacity(this: *Self, comptime Int: type, int: Int) void {
            if (comptime Type != u8)
                @compileError("Unsupported for type " ++ @typeName(Type));
            bun.assert(this.cap >= this.len + @sizeOf(Int));
            @as([*]align(1) Int, @ptrCast(this.ptr[this.len .. this.len + @sizeOf(Int)]))[0] = int;
            this.len += @sizeOf(Int);
        }

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

        pub fn toCss(this: *const Self, dest: *bun.css.Printer) bun.css.PrintErr!void {
            return bun.css.to_css.fromBabyList(Type, this, dest);
        }

        pub fn eql(lhs: *const Self, rhs: *const Self) bool {
            if (lhs.len != rhs.len) return false;
            for (lhs.sliceConst(), rhs.sliceConst()) |*a, *b| {
                if (!bun.css.generic.eql(Type, a, b)) return false;
            }
            return true;
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

        /// Avoid using this function. It creates a `BabyList` that will immediately invoke
        /// illegal behavior if you call any method that could allocate or free memory. On top of
        /// that, if `items` points to read-only memory, any attempt to modify a list element (which
        /// is very easy given how many methods return non-const pointers and slices) will also
        /// invoke illegal behavior.
        ///
        /// To find an alternative:
        ///
        /// 1. Determine how the resulting `BabyList` is being used. Is it stored in a struct field?
        ///    Is it passed to a function?
        ///
        /// 2. Determine whether that struct field or function parameter expects the list to be
        ///    mutable. Does it potentially call any methods that could allocate or free, like
        ///    `append` or `deinit`?
        ///
        /// 3. If the list is expected to be mutable, don't use this function, because the returned
        ///    list will invoke illegal behavior if mutated. Use `fromSlice` or another allocating
        ///    function instead.
        ///
        /// 4. If the list is *not* expected to be mutable, don't use a `BabyList` at all. Change
        ///    the field or parameter to be a plain slice instead.
        ///
        /// Requirements:
        ///
        /// * Methods that could potentially free, remap, or resize `items` cannot be called.
        pub fn fromBorrowedSliceDangerous(items: []const Type) Self {
            var this: Self = .fromOwnedSlice(@constCast(items));
            if (comptime safety_checks) this.#origin = .{ .borrowed = .{
                .trace = if (traces_enabled) .capture(@returnAddress()),
            } };
            return this;
        }

        /// Transfers ownership of this `BabyList` to a new allocator.
        ///
        /// This method is valid only if both the old allocator and new allocator are
        /// `MimallocArena`s. See `bun.safety.CheckedAllocator.transferOwnership`.
        pub fn transferOwnership(this: *Self, new_allocator: anytype) void {
            this.#allocator.transferOwnership(new_allocator);
        }

        pub fn format(
            this: Self,
            writer: *std.Io.Writer,
        ) !void {
            return writer.print(
                "BabyList({s}){{{f}}}",
                .{ @typeName(Type), this.list() },
            );
        }

        fn assertOwned(this: *Self) void {
            if ((comptime !safety_checks) or this.#origin == .owned) return;
            if (comptime traces_enabled) {
                bun.Output.note("borrowed BabyList created here:", .{});
                bun.crash_handler.dumpStackTrace(
                    this.#origin.borrowed.trace.trace(),
                    .{ .frame_count = 10, .stop_at_jsc_llint = true },
                );
            }
            std.debug.panic(
                "cannot perform this operation on a BabyList that doesn't own its data",
                .{},
            );
        }

        fn list(this: Self) std.ArrayListUnmanaged(Type) {
            return .{
                .items = this.slice(),
                .capacity = this.cap,
            };
        }

        fn listManaged(this: *Self, allocator: std.mem.Allocator) std.array_list.Managed(Type) {
            this.#allocator.set(allocator);
            var list_ = this.list();
            return list_.toManaged(allocator);
        }

        fn update(this: *Self, list_: anytype) void {
            this.ptr = list_.items.ptr;
            this.len = @intCast(list_.items.len);
            this.cap = @intCast(list_.capacity);
            if (comptime Environment.allow_assert) {
                bun.assert(this.len <= this.cap);
            }
        }

        pub const looksLikeContainerTypeBabyList = Type;
    };
}

pub const ByteList = BabyList(u8);

pub const OffsetByteList = struct {
    const Self = @This();

    head: u32 = 0,
    byte_list: ByteList = .{},

    pub fn init(head: u32, byte_list: ByteList) Self {
        return .{
            .head = head,
            .byte_list = byte_list,
        };
    }

    pub fn write(self: *Self, allocator: std.mem.Allocator, bytes: []const u8) !void {
        _ = try self.byte_list.write(allocator, bytes);
    }

    pub fn slice(self: *const Self) []u8 {
        return self.byte_list.slice()[0..self.head];
    }

    pub fn remaining(self: *const Self) []u8 {
        return self.byte_list.slice()[self.head..];
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

    /// This method invalidates `self`. Use `clearAndFree` to reset to empty instead.
    pub fn deinit(self: *Self, allocator: std.mem.Allocator) void {
        self.byte_list.deinit(allocator);
        self.* = undefined;
    }

    pub fn clearAndFree(self: *Self, allocator: std.mem.Allocator) void {
        self.deinit(allocator);
        self.* = .{};
    }
};

pub const safety_checks = Environment.ci_assert;

const std = @import("std");

const bun = @import("bun");
const OOM = bun.OOM;
const strings = bun.strings;
const StoredTrace = bun.crash_handler.StoredTrace;

const Environment = bun.Environment;
const traces_enabled = Environment.isDebug;
