const std = @import("std");

const hash_map = @import("hash_map.zig");

const HashMapUnmanaged = hash_map.HashMapUnmanaged;
const Wyhash = std.hash.Wyhash;
const FixedBufferAllocator = std.heap.FixedBufferAllocator;

// https://en.wikipedia.org/wiki/.bss#BSS_in_C
pub fn BSSSectionAllocator(comptime size: usize) type {
    return struct {
        var backing_buf: [size]u8 = undefined;
        var fixed_buffer_allocator = FixedBufferAllocator.init(&backing_buf);
        var buf_allocator = &fixed_buffer_allocator.allocator;
        const Allocator = std.mem.Allocator;
        const Self = @This();

        allocator: Allocator,
        fallback_allocator: *Allocator,

        is_overflowed: bool = false,

        pub fn get(self: *Self) *Allocator {
            return &self.allocator;
        }

        pub fn init(fallback_allocator: *Allocator) Self {
            return Self{ .fallback_allocator = fallback_allocator, .allocator = Allocator{
                .allocFn = BSSSectionAllocator(size).alloc,
                .resizeFn = BSSSectionAllocator(size).resize,
            } };
        }

        pub fn alloc(
            allocator: *Allocator,
            len: usize,
            ptr_align: u29,
            len_align: u29,
            return_address: usize,
        ) error{OutOfMemory}![]u8 {
            const self = @fieldParentPtr(Self, "allocator", allocator);
            return buf_allocator.allocFn(buf_allocator, len, ptr_align, len_align, return_address) catch |err| {
                self.is_overflowed = true;
                return self.fallback_allocator.allocFn(self.fallback_allocator, len, ptr_align, len_align, return_address);
            };
        }

        pub fn resize(
            allocator: *Allocator,
            buf: []u8,
            buf_align: u29,
            new_len: usize,
            len_align: u29,
            return_address: usize,
        ) error{OutOfMemory}!usize {
            const self = @fieldParentPtr(Self, "allocator", allocator);
            if (fixed_buffer_allocator.ownsPtr(buf.ptr)) {
                return fixed_buffer_allocator.allocator.resizeFn(&fixed_buffer_allocator.allocator, buf, buf_align, new_len, len_align, return_address);
            } else {
                return self.fallback_allocator.resizeFn(self.fallback_allocator, buf, buf_align, new_len, len_align, return_address);
            }
        }
    };
}

pub fn isSliceInBuffer(slice: anytype, buffer: anytype) bool {
    return (@ptrToInt(buffer) <= @ptrToInt(slice.ptr) and (@ptrToInt(slice.ptr) + slice.len) <= (@ptrToInt(buffer) + buffer.len));
}

pub const IndexType = packed struct {
    index: u31,
    is_overflow: bool = false,
};

const HashKeyType = u64;
const IndexMap = HashMapUnmanaged(HashKeyType, IndexType, hash_hashFn, hash_eqlFn, 80);
pub const Result = struct {
    hash: HashKeyType,
    index: IndexType,
    status: ItemStatus,

    pub fn hasCheckedIfExists(r: *const Result) bool {
        return r.index.index != Unassigned.index;
    }

    pub fn isOverflowing(r: *const Result, comptime count: usize) bool {
        return r.index >= count;
    }

    pub fn realIndex(r: *const Result, comptime count: anytype) IndexType {
        return if (r.isOverflowing(count)) @intCast(IndexType, r.index - max_index) else r.index;
    }
};
const Seed = 0;

pub const NotFound = IndexType{
    .index = std.math.maxInt(u31),
};
pub const Unassigned = IndexType{
    .index = std.math.maxInt(u31) - 1,
};

pub fn hash_hashFn(key: HashKeyType) HashKeyType {
    return key;
}

pub fn hash_eqlFn(a: HashKeyType, b: HashKeyType) bool {
    return a == b;
}

pub const ItemStatus = enum(u3) {
    unknown,
    exists,
    not_found,
};

const hasDeinit = std.meta.trait.hasFn("deinit")(ValueType);

pub fn BSSList(comptime ValueType: type, comptime count: anytype) type {
    const max_index = count - 1;
    var list_type: type = undefined;
    var list_count = count;
    return struct {
        pub var backing_buf: [count]ValueType = undefined;
        pub var backing_buf_used: u16 = 0;
        const Allocator = std.mem.Allocator;
        const Self = @This();
        pub const ListIndex = packed struct {
            index: u31,
            is_overflowing: bool = false,
        };
        overflow_list: std.ArrayListUnmanaged(ValueType),
        allocator: *Allocator,

        pub var instance: Self = undefined;

        pub fn init(allocator: *std.mem.Allocator) *Self {
            instance = Self{
                .allocator = allocator,
                .overflow_list = std.ArrayListUnmanaged(ValueType){},
            };

            return &instance;
        }

        pub fn isOverflowing() bool {
            return backing_buf_used >= @as(u16, count);
        }

        pub fn at(self: *const Self, index: ListIndex) ?*ValueType {
            if (index.index == NotFound.index or index.index == Unassigned.index) return null;

            if (index.is_overflowing) {
                return &self.overflow_list.items[index.index];
            } else {
                return &backing_buf[index.index];
            }
        }

        pub fn exists(self: *Self, value: ValueType) bool {
            return isSliceInBuffer(value, backing_buf);
        }

        pub fn append(self: *Self, value: ValueType) !ListIndex {
            var result = ListIndex{ .index = std.math.maxInt(u31), .is_overflowing = backing_buf_used > max_index };
            if (result.is_overflowing) {
                result.index = @intCast(u31, self.overflow_list.items.len);
                try self.overflow_list.append(self.allocator, value);
            } else {
                result.index = backing_buf_used;
                backing_buf[result.index] = value;
                backing_buf_used += 1;
                if (backing_buf_used >= max_index) {
                    self.overflow_list = try @TypeOf(self.overflow_list).initCapacity(self.allocator, count);
                }
            }

            return result;
        }

        pub fn update(self: *Self, result: *ListIndex, value: ValueType) !*ValueType {
            if (result.index.index == NotFound.index or result.index.index == Unassigned.index) {
                result.index.is_overflowing = backing_buf_used > max_index;
                if (result.index.is_overflowing) {
                    result.index.index = @intCast(u31, self.overflow_list.items.len);
                } else {
                    result.index.index = backing_buf_used;
                    backing_buf_used += 1;
                    if (backing_buf_used >= max_index) {
                        self.overflow_list = try @TypeOf(self.overflow_list).initCapacity(self.allocator, count);
                    }
                }
            }

            if (result.index.is_overflowing) {
                if (self.overflow_list.items.len == result.index.index) {
                    const real_index = self.overflow_list.items.len;
                    try self.overflow_list.append(self.allocator, value);
                } else {
                    self.overflow_list.items[result.index.index] = value;
                }

                return &self.overflow_list.items[result.index.index];
            } else {
                backing_buf[result.index.index] = value;

                return &backing_buf[result.index.index];
            }
        }

        pub fn remove(self: *Self, index: ListIndex) void {
            @compileError("Not implemented yet.");
            // switch (index) {
            //     Unassigned.index => {
            //         self.index.remove(_key);
            //     },
            //     NotFound.index => {
            //         self.index.remove(_key);
            //     },
            //     0...max_index => {
            //         if (hasDeinit(ValueType)) {
            //             backing_buf[index].deinit();
            //         }
            //         backing_buf[index] = undefined;
            //     },
            //     else => {
            //         const i = index - count;
            //         if (hasDeinit(ValueType)) {
            //             self.overflow_list.items[i].deinit();
            //         }
            //         self.overflow_list.items[index - count] = undefined;
            //     },
            // }

            // return index;
        }
    };
}

// Like an ArrayList except:
// - It only grows
// - Pointer never invalidates
pub const ByteBuffer = struct {
    allocator: *std.mem.Allocator,
    ptr: [*]u8,
    len: usize,

    items: []u8,

    pub fn init(allocator: *std.mem.Allocator, comptime min_length: usize) !ByteBuffer {
        var items = if (min_length > 0) try allocator.alloc(u8, min_length) else &([_]u8{});

        return ByteBuffer{ .allocator = allocator, .items = items, .ptr = undefined, .len = min_length };
    }

    pub fn growIfNeeded(this: *ByteBuffer, min_length: usize) !void {
        const len = std.math.ceilPowerOfTwo(usize, this.items.len + min_length) catch unreachable;
        if (this.len >= len) {
            return;
        }

        if (this.len == 0) {
            const items = try this.allocator.alloc(u8, len);
            this.ptr = items.ptr;
            this.len = items.len;
        } else {
            const items = try this.allocator.realloc(this.ptr[0..this.len], len);
            this.ptr = items.ptr;
            this.len = items.len;
        }

        this.items = this.ptr[0 .. this.items.len + min_length];
    }

    pub fn reset(this: *ByteBuffer) void {
        this.items = this.items[0..0];
    }

    pub fn slice(this: *ByteBuffer, len: usize) ![]u8 {
        try this.growIfNeeded(len);

        return this.items[this.items.len - len ..];
    }

    pub fn append(this: *ByteBuffer, items: anytype) ![]u8 {
        var writable = try this.slice(items.len);
        @memcpy(writable.ptr, items.ptr, items.len);
        return writable;
    }
};

// Like an ArrayList except:
// - It only grows
// - Pointer never invalidates

pub fn OverflowList(comptime ValueType: type) type {
    return struct {
        const Self = @This();
        allocator: *std.mem.Allocator,
        ptr: [*]ValueType,
        len: usize,

        items: []ValueType,

        pub fn init(allocator: *std.mem.Allocator, comptime min_length: usize) !Self {
            var items = if (min_length > 0) try allocator.alloc(ValueType, min_length) else &([_]ValueType{});

            return Self{ .allocator = allocator, .items = items, .ptr = undefined, .len = min_length };
        }

        pub fn growIfNeeded(this: *Self, min_length: usize) !void {
            const len = std.math.ceilPowerOfTwo(usize, this.items.len + min_length) catch unreachable;
            if (this.len >= len) {
                return;
            }

            if (this.len == 0) {
                const items = try this.allocator.alloc(ValueType, len);
                this.ptr = items.ptr;
                this.len = items.len;
            } else {
                const items = try this.allocator.realloc(this.ptr[0..this.len], len);
                this.ptr = items.ptr;
                this.len = items.len;
            }

            this.items = this.ptr[0 .. this.items.len + min_length];
        }

        pub fn reset(this: *Self) void {
            this.items = this.items[0..0];
        }

        pub fn slice(this: *Self, len: usize) ![]ValueType {
            try this.growIfNeeded(len);

            return this.items[this.items.len - len ..];
        }

        pub fn append(this: *Self, value: ValueType) !*ValueType {
            try this.growIfNeeded(1);
            const index = this.items.len - 1;
            this.items[index] = value;
            return &this.items[index];
        }

        pub fn appendGetIndex(this: *Self, value: ValueType) !usize {
            try this.growIfNeeded(1);
            const index = this.items.len - 1;
            this.items[index] = value;
            return index;
        }
    };
}

// Growable array of variable-length strings
// Copies the strings
pub const StringList = struct {
    const DataType = [][]u8;
    buffer: ByteBuffer,
    ptr: [*][]u8,
    len: usize = 0,
    allocator: *std.mem.Allocator,

    items: DataType,

    pub fn init(allocator: *std.mem.Allocator) StringList {
        return StringList{
            .ptr = undefined,
            .allocator = allocator,
            .len = 0,
            .buffer = ByteBuffer.init(allocator, 0) catch unreachable,
            .items = std.mem.zeroes(DataType),
        };
    }

    pub fn reset(self: *StringList) void {
        self.buffer.reset();
        self.items = self.ptr[0..0];
    }

    pub fn appendCopy(self: *StringList, str: anytype, comptime copy: bool) ![]const u8 {
        const index = try self.appendCopyIndex(str, copy);
        return self.items[index];
    }

    pub fn appendCopyIndex(self: *StringList, str: anytype, comptime copy: bool) !usize {
        if (self.len == 0) {
            var items = try self.allocator.alloc([]u8, 8);
            self.ptr = items.ptr;
            self.len = items.len;
            self.items = items[0..1];
        } else if (self.items.len >= self.len) {
            const end = self.len + 1;
            const len = std.math.ceilPowerOfTwo(usize, self.len + 1) catch unreachable;
            var items = try self.allocator.realloc(self.ptr[0..self.len], len);
            self.ptr = items.ptr;
            self.len = items.len;
            self.items = self.ptr[0..end];
        }

        const index = self.items.len - 1;
        self.items[index] = if (copy) try self.buffer.append(str) else str;
        return index;
    }

    pub fn append(self: *StringList, str: anytype) ![]const u8 {
        return try self.appendCopy(str, true);
    }
};

pub fn BSSStringList(comptime count: usize, comptime item_length: usize) type {
    const max_index = count - 1;
    const ValueType = []const u8;

    return struct {
        pub var backing_buf: [count * item_length]u8 = undefined;
        pub var backing_buf_used: u64 = undefined;

        const Allocator = std.mem.Allocator;
        const Self = @This();
        pub const ListIndex = packed struct {
            index: u31,
            is_overflowing: bool = false,
        };
        list: StringList,
        allocator: *Allocator,

        pub var instance: Self = undefined;

        pub fn init(allocator: *std.mem.Allocator) *Self {
            instance = Self{
                .allocator = allocator,
                .list = StringList.init(allocator),
            };

            return &instance;
        }

        pub fn editableSlice(slice: []const u8) []u8 {
            return constStrToU8(slice);
        }

        pub fn append(self: *Self, value: anytype) ![]const u8 {
            if (value.len + backing_buf_used < backing_buf.len - 1) {
                const start = backing_buf_used;
                backing_buf_used += value.len;
                std.mem.copy(u8, backing_buf[start..backing_buf_used], value);
                return try self.list.appendCopy(backing_buf[start..backing_buf_used], false);
            }

            return try self.list.appendCopy(value, true);
        }
    };
}

pub fn BSSMap(comptime ValueType: type, comptime count: anytype, store_keys: bool, estimated_key_length: usize) type {
    const max_index = count - 1;
    const OverflowListType = OverflowList(ValueType);
    const BSSMapType = struct {
        pub var backing_buf: [count]ValueType = undefined;
        pub var backing_buf_used: u16 = 0;
        const Allocator = std.mem.Allocator;
        const Self = @This();

        index: IndexMap,
        overflow_list: OverflowListType,
        allocator: *Allocator,

        pub var instance: Self = undefined;

        pub fn init(allocator: *std.mem.Allocator) *Self {
            instance = Self{
                .index = IndexMap{},
                .allocator = allocator,
                .overflow_list = OverflowListType.init(allocator, 0) catch unreachable,
            };

            return &instance;
        }

        pub fn isOverflowing() bool {
            return backing_buf_used >= @as(u16, count);
        }

        pub fn getOrPut(self: *Self, key: []const u8) !Result {
            const _key = Wyhash.hash(Seed, key);
            var index = try self.index.getOrPutWithHash(self.allocator, _key, _key);

            if (index.found_existing) {
                return Result{
                    .hash = _key,
                    .index = index.entry.value,
                    .status = switch (index.entry.value.index) {
                        NotFound.index => .not_found,
                        Unassigned.index => .unknown,
                        else => .exists,
                    },
                };
            }
            index.entry.value = Unassigned;

            return Result{
                .hash = _key,
                .index = Unassigned,
                .status = .unknown,
            };
        }

        pub fn get(self: *const Self, key: []const u8) ?*ValueType {
            const _key = Wyhash.hash(Seed, key);
            const index = self.index.getWithHash(_key, _key) orelse return null;
            return self.atIndex(index);
        }

        pub fn markNotFound(self: *Self, result: Result) void {
            self.index.putWithHash(self.allocator, result.hash, result.hash, NotFound) catch unreachable;
        }

        pub fn atIndex(self: *const Self, index: IndexType) ?*ValueType {
            if (index.index == NotFound.index or index.index == Unassigned.index) return null;

            if (index.is_overflow) {
                return &self.overflow_list.items[index.index];
            } else {
                return &backing_buf[index.index];
            }
        }

        pub fn put(self: *Self, result: *Result, value: ValueType) !*ValueType {
            if (result.index.index == NotFound.index or result.index.index == Unassigned.index) {
                result.index.is_overflow = backing_buf_used > max_index;
                if (result.index.is_overflow) {
                    result.index.index = @intCast(u31, self.overflow_list.items.len);
                } else {
                    result.index.index = backing_buf_used;
                    backing_buf_used += 1;
                }
            }

            try self.index.putWithHash(self.allocator, result.hash, result.hash, result.index);

            if (result.index.is_overflow) {
                return try self.overflow_list.append(value);
            } else {
                backing_buf[result.index.index] = value;

                return &backing_buf[result.index.index];
            }
        }

        pub fn remove(self: *Self, key: string) IndexType {
            const _key = Wyhash.hash(Seed, key);
            const index = self.index.getWithHash(_key, _key) orelse return;
            switch (index) {
                Unassigned.index => {
                    self.index.remove(_key);
                },
                NotFound.index => {
                    self.index.remove(_key);
                },
                0...max_index => {
                    if (hasDeinit(ValueType)) {
                        backing_buf[index].deinit();
                    }
                    backing_buf[index] = undefined;
                },
                else => {
                    const i = index - count;
                    if (hasDeinit(ValueType)) {
                        self.overflow_list.items[i].deinit();
                    }
                    self.overflow_list.items[index - count] = undefined;
                },
            }

            return index;
        }
    };
    if (!store_keys) {
        return BSSMapType;
    }

    return struct {
        map: *BSSMapType,
        const Self = @This();
        pub var instance: Self = undefined;
        var key_list_buffer: [count * estimated_key_length]u8 = undefined;
        var key_list_buffer_used: usize = 0;
        var key_list_slices: [count][]u8 = undefined;
        var key_list_overflow: StringList = undefined;

        pub fn init(allocator: *std.mem.Allocator) *Self {
            instance = Self{
                .map = BSSMapType.init(allocator),
            };
            key_list_overflow = key_list_overflow.init(allocator);
            return &instance;
        }

        pub fn isOverflowing() bool {
            return instance.map.backing_buf_used >= count;
        }
        pub fn getOrPut(self: *Self, key: []const u8) !Result {
            return try self.map.getOrPut(key);
        }
        pub fn get(self: *Self, key: []const u8) ?*ValueType {
            return @call(.{ .modifier = .always_inline }, BSSMapType.get, .{ self.map, key });
        }

        pub fn atIndex(self: *Self, index: IndexType) ?*ValueType {
            return @call(.{ .modifier = .always_inline }, BSSMapType.atIndex, .{ self.map, index });
        }

        pub fn keyAtIndex(self: *Self, index: IndexType) ?[]const u8 {
            return switch (index.index) {
                Unassigned.index, NotFound.index => null,
                else => {
                    if (!index.is_overflow) {
                        return key_list_slices[index.index];
                    } else {
                        return key_list_overflow.items[index.index];
                    }
                },
            };
        }

        pub fn put(self: *Self, key: anytype, comptime store_key: bool, result: *Result, value: ValueType) !*ValueType {
            var ptr = try self.map.put(result, value);
            if (store_key) {
                try self.putKey(key, result);
            }

            return ptr;
        }

        pub fn isKeyStaticallyAllocated(key: anytype) bool {
            return isSliceInBuffer(key, &key_list_buffer);
        }

        // There's two parts to this.
        // 1. Storing the underyling string.
        // 2. Making the key accessible at the index.
        pub fn putKey(self: *Self, key: anytype, result: *Result) !void {
            var slice: []u8 = undefined;

            // Is this actually a slice into the map? Don't free it.
            if (isKeyStaticallyAllocated(key)) {
                slice = constStrToU8(key);
            } else if (key_list_buffer_used + key.len < key_list_buffer.len) {
                const start = key_list_buffer_used;
                key_list_buffer_used += key.len;
                slice = key_list_buffer[start..key_list_buffer_used];
                @memcpy(slice.ptr, key.ptr, key.len);
            } else {
                result.index = try key_list_overflow.appendCopyIndex(key, true);
                return;
            }

            if (!result.index.is_overflow) {
                key_list_slices[result.index.index] = slice;
            } else {
                if (@intCast(u31, key_list_overflow.items.len) > result.index.index) {
                    const existing_slice = key_list_overflow.items[result.index.index];
                    if (!isKeyStaticallyAllocated(existing_slice)) {
                        self.map.allocator.free(existing_slice);
                    }
                    key_list_overflow.items[result.index.index] = slice;
                } else {
                    try key_list_overflow.appendCopy(self.map.allocator, slice, false);
                }
            }
        }

        pub fn markNotFound(self: *Self, result: Result) void {
            self.map.markNotFound(result);
        }

        // For now, don't free the keys.
        pub fn remove(self: *Self, key: string) IndexType {
            return self.map.remove(key);
        }
    };
}

pub fn constStrToU8(s: []const u8) []u8 {
    return @intToPtr([*]u8, @ptrToInt(s.ptr))[0..s.len];
}
