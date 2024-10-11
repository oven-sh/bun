const std = @import("std");
const bun = @import("root").bun;
const css = @import("./css_parser.zig");
const Printer = css.Printer;
const Parser = css.Parser;
const Result = css.Result;
const voidWrap = css.voidWrap;
const generic = css.generic;
const Delimiters = css.Delimiters;
const PrintErr = css.PrintErr;
const Allocator = std.mem.Allocator;
const implementEql = css.implementEql;

/// This is a type whose items can either be heap-allocated (essentially the
/// same as a BabyList(T)) or inlined in the struct itself.
///
/// This is type is a performance optimizations for avoiding allocations, especially when you know the list
/// will commonly have N or fewer items.
///
/// The `capacity` field is used to disambiguate between the two states: - When
/// `capacity <= N`, the items are stored inline, and `capacity` is the length
/// of the items.  - When `capacity > N`, the items are stored on the heap, and
/// this type essentially becomes a BabyList(T), but with the fields reordered.
///
/// This code is based on servo/rust-smallvec and the Zig std.ArrayList source.
pub fn SmallList(comptime T: type, comptime N: comptime_int) type {
    return struct {
        capacity: u32 = 0,
        data: Data = .{ .inlined = undefined },

        const Data = union {
            inlined: [N]T,
            heap: HeapData,
        };

        const HeapData = struct {
            len: u32,
            ptr: [*]T,

            pub fn initCapacity(allocator: Allocator, capacity: u32) HeapData {
                return .{
                    .len = 0,
                    .ptr = (allocator.alloc(T, capacity) catch bun.outOfMemory()).ptr,
                };
            }
        };

        const This = @This();

        pub fn parse(input: *Parser) Result(@This()) {
            const parseFn = comptime voidWrap(T, generic.parseFor(T));
            var values: @This() = .{};
            while (true) {
                input.skipWhitespace();
                switch (input.parseUntilBefore(Delimiters{ .comma = true }, T, {}, parseFn)) {
                    .result => |v| {
                        values.append(input.allocator(), v);
                    },
                    .err => |e| return .{ .err = e },
                }
                switch (input.next()) {
                    .err => return .{ .result = values },
                    .result => |t| {
                        if (t.* == .comma) continue;
                        std.debug.panic("Expected a comma", .{});
                    },
                }
            }
            unreachable;
        }

        pub fn toCss(this: *const @This(), comptime W: type, dest: *Printer(W)) PrintErr!void {
            const length = this.len();
            for (this.slice(), 0..) |*val, idx| {
                try val.toCss(W, dest);
                if (idx < length - 1) {
                    try dest.delim(',', false);
                }
            }
        }

        pub fn withOne(val: T) @This() {
            var ret = This{};
            ret.capacity = 1;
            ret.data.inlined[0] = val;
            return ret;
        }

        pub inline fn at(this: *const @This(), idx: u32) *const T {
            return &this.as_const_ptr()[idx];
        }

        pub inline fn mut(this: *@This(), idx: u32) *T {
            return &this.as_ptr()[idx];
        }

        pub inline fn toOwnedSlice(this: *const @This(), allocator: Allocator) []T {
            if (this.spilled()) return this.data.heap.ptr[0..this.data.heap.len];
            return allocator.dupe(T, this.data.inlined[0..this.capacity]) catch bun.outOfMemory();
        }

        /// NOTE: If this is inlined then this will refer to stack memory, if
        /// need it to be stable then you should use `.toOwnedSlice()`
        pub inline fn slice(this: *const @This()) []const T {
            if (this.capacity > N) return this.data.heap.ptr[0..this.data.heap.len];
            return this.data.inlined[0..this.capacity];
        }

        /// NOTE: If this is inlined then this will refer to stack memory, if
        /// need it to be stable then you should use `.toOwnedSlice()`
        pub inline fn slice_mut(this: *@This()) []T {
            if (this.capacity > N) return this.data.heap.ptr[0..this.data.heap.len];
            return this.data.inlined[0..this.capacity];
        }

        pub fn orderedRemove(this: *@This(), idx: u32) T {
            var ptr, const len_ptr, const capp = this.tripleMut();
            _ = capp; // autofix
            bun.assert(idx < len_ptr.*);

            const length = len_ptr.*;

            len_ptr.* = len_ptr.* - 1;
            ptr += idx;
            const item = ptr[0];
            std.mem.copyForwards(T, ptr[0 .. length - idx - 1], ptr[1..][0 .. length - idx - 1]);

            return item;
        }

        pub fn swapRemove(this: *@This(), idx: u32) T {
            var ptr, const len_ptr, const capp = this.tripleMut();
            _ = capp; // autofix
            bun.assert(idx < len_ptr.*);

            const ret = ptr[idx];
            ptr[idx] = ptr[len_ptr.* -| 1];
            len_ptr.* = len_ptr.* - 1;

            return ret;
        }

        pub fn clearRetainingCapacity(this: *@This()) void {
            if (this.spilled()) {
                this.data.heap.len = 0;
            } else {
                this.capacity = 0;
            }
        }

        pub fn deepClone(this: *const @This(), allocator: Allocator) @This() {
            var ret: @This() = .{};
            ret.appendSlice(allocator, this.slice());
            for (ret.slice_mut()) |*item| {
                item.* = generic.deepClone(T, item, allocator);
            }
            return ret;
        }

        pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
            if (lhs.len() != rhs.len()) return false;
            for (lhs.slice(), rhs.slice()) |*a, *b| {
                if (!generic.eql(T, a, b)) return false;
            }
            return true;
        }

        /// Shallow clone
        pub fn clone(this: *const @This(), allocator: Allocator) @This() {
            var ret = this.*;
            if (!this.spilled()) return ret;
            ret.data.heap.ptr = (allocator.dupe(T, ret.data.heap.ptr[0..ret.data.heap.len]) catch bun.outOfMemory()).ptr;
            return ret;
        }

        pub fn deinit(this: *@This(), allocator: Allocator) void {
            if (this.spilled()) {
                allocator.free(this.data.heap.ptr[0..this.data.heap.len]);
            }
        }

        pub fn hash(this: *const @This(), hasher: anytype) void {
            for (this.slice()) |*item| {
                css.generic.hash(T, item, hasher);
            }
        }

        pub inline fn len(this: *const @This()) u32 {
            if (this.spilled()) return this.data.heap.len;
            return this.capacity;
        }

        pub inline fn isEmpty(this: *const @This()) bool {
            return this.len() == 0;
        }

        pub fn initCapacity(allocator: Allocator, capacity: u32) @This() {
            if (capacity > N) {
                var list: This = .{};
                list.capacity = capacity;
                list.data = .{ .heap = HeapData.initCapacity(allocator, capacity) };
                return list;
            }

            return .{
                .capacity = 0,
            };
        }

        pub fn insert(
            this: *@This(),
            allocator: Allocator,
            index: u32,
            item: T,
        ) void {
            var ptr, var len_ptr, const capp = this.tripleMut();
            if (len_ptr.* == capp) {
                this.reserveOneUnchecked(allocator);
                const heap_ptr, const heap_len_ptr = this.heap();
                ptr = heap_ptr;
                len_ptr = heap_len_ptr;
            }
            const length = len_ptr.*;
            ptr += index;
            if (index < length) {
                const count = length - index;
                std.mem.copyBackwards(T, ptr[1..][0..count], ptr[0..count]);
            } else if (index == length) {
                // No elements need shifting.
            } else {
                @panic("index exceeds length");
            }
            len_ptr.* = length + 1;
            ptr[0] = item;
        }

        pub fn append(this: *@This(), allocator: Allocator, item: T) void {
            var ptr, var len_ptr, const capp = this.tripleMut();
            if (len_ptr.* == capp) {
                this.reserveOneUnchecked(allocator);
                const heap_ptr, const heap_len = this.heap();
                ptr = heap_ptr;
                len_ptr = heap_len;
            }
            ptr[len_ptr.*] = item;
            len_ptr.* += 1;
        }

        pub fn appendSlice(this: *@This(), allocator: Allocator, items: []const T) void {
            this.insertSlice(allocator, this.len(), items);
        }

        pub fn insertSlice(this: *@This(), allocator: Allocator, index: u32, items: []const T) void {
            this.reserve(allocator, @intCast(items.len));

            const length = this.len();
            bun.assert(index <= length);
            const ptr: [*]T = this.as_ptr()[index..];
            const count = length - index;
            std.mem.copyBackwards(T, ptr[items.len..][0..count], ptr[0..count]);
            @memcpy(ptr[0..items.len], items);
            this.setLen(length + @as(u32, @intCast(items.len)));
        }

        pub fn setLen(this: *@This(), new_len: u32) void {
            const len_ptr = this.lenMut();
            len_ptr.* = new_len;
        }

        inline fn heap(this: *@This()) struct { [*]T, *u32 } {
            return .{ this.data.heap.ptr, &this.data.heap.len };
        }

        fn as_const_ptr(this: *const @This()) [*]const T {
            if (this.spilled()) return this.data.heap.ptr;
            return &this.data.inlined;
        }

        fn as_ptr(this: *@This()) [*]T {
            if (this.spilled()) return this.data.heap.ptr;
            return &this.data.inlined;
        }

        fn reserve(this: *@This(), allocator: Allocator, additional: u32) void {
            const ptr, const __len, const capp = this.tripleMut();
            _ = ptr; // autofix
            const len_ = __len.*;

            if (capp - len_ >= additional) return;
            const new_cap = growCapacity(capp, len_ + additional);
            this.tryGrow(allocator, new_cap);
        }

        fn reserveOneUnchecked(this: *@This(), allocator: Allocator) void {
            @setCold(true);
            bun.assert(this.len() == this.capacity);
            const new_cap = growCapacity(this.capacity, this.len() + 1);
            this.tryGrow(allocator, new_cap);
        }

        fn tryGrow(this: *@This(), allocator: Allocator, new_cap: u32) void {
            const unspilled = !this.spilled();
            const ptr, const __len, const cap = this.tripleMut();
            const length = __len.*;
            bun.assert(new_cap >= length);
            if (new_cap <= N) {
                if (unspilled) return;
                this.data = .{ .inlined = undefined };
                @memcpy(ptr[0..length], this.data.inlined[0..length]);
                this.capacity = length;
                allocator.free(ptr[0..length]);
            } else if (new_cap != cap) {
                const new_alloc: [*]T = if (unspilled) new_alloc: {
                    const new_alloc = allocator.alloc(T, new_cap) catch bun.outOfMemory();
                    @memcpy(new_alloc[0..length], ptr[0..length]);
                    break :new_alloc new_alloc.ptr;
                } else new_alloc: {
                    break :new_alloc (allocator.realloc(ptr[0..length], new_cap * @sizeOf(T)) catch bun.outOfMemory()).ptr;
                };
                this.data = .{ .heap = .{ .ptr = new_alloc, .len = length } };
                this.capacity = new_cap;
            }
        }

        /// Returns a tuple with (data ptr, len, capacity)
        /// Useful to get all SmallVec properties with a single check of the current storage variant.
        inline fn tripleMut(this: *@This()) struct { [*]T, *u32, u32 } {
            if (this.spilled()) return .{ this.data.heap.ptr, &this.data.heap.len, this.capacity };
            return .{ &this.data.inlined, &this.capacity, N };
        }

        inline fn lenMut(this: *@This()) *u32 {
            if (this.spilled()) return &this.data.heap.len;
            return &this.capacity;
        }

        fn growToHeap(this: *@This(), allocator: Allocator, additional: usize) void {
            bun.assert(!this.spilled());
            const new_size = growCapacity(this.capacity, this.capacity + additional);
            var slc = allocator.alloc(T, new_size) catch bun.outOfMemory();
            @memcpy(slc[0..this.capacity], this.data.inlined[0..this.capacity]);
            this.data = .{ .heap = HeapData{ .len = this.capacity, .ptr = slc.ptr } };
            this.capacity = new_size;
        }

        inline fn spilled(this: *const @This()) bool {
            return this.capacity > N;
        }

        /// Copy pasted from Zig std in array list:
        ///
        /// Called when memory growth is necessary. Returns a capacity larger than
        /// minimum that grows super-linearly.
        fn growCapacity(current: u32, minimum: u32) u32 {
            var new = current;
            while (true) {
                new +|= new / 2 + 8;
                if (new >= minimum)
                    return new;
            }
        }
    };
}
