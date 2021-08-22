const std = @import("std");

const FeatureFlags = @import("./feature_flags.zig");
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
const IndexMap = std.HashMapUnmanaged(HashKeyType, IndexType, struct {
    pub fn hash(ctx: @This(), key: HashKeyType) HashKeyType {
        return key;
    }

    pub fn eql(ctx: @This(), a: HashKeyType, b: HashKeyType) bool {
        return a == b;
    }
}, 80);
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
const Seed = 999;

pub const NotFound = IndexType{
    .index = std.math.maxInt(u31),
};
pub const Unassigned = IndexType{
    .index = std.math.maxInt(u31) - 1,
};

pub const ItemStatus = enum(u3) {
    unknown,
    exists,
    not_found,
};

const hasDeinit = std.meta.trait.hasFn("deinit")(ValueType);

pub fn BSSList(comptime ValueType: type, comptime _count: anytype) type {
    const count = _count * 2;
    const max_index = count - 1;
    var list_type: type = undefined;
    var list_count = count;
    return struct {
        pub var backing_buf: [count]ValueType = undefined;
        pub var backing_buf_used: u16 = 0;
        const Allocator = std.mem.Allocator;
        const Self = @This();
        const OverflowListType = std.ArrayListUnmanaged(ValueType);

        overflow_list: OverflowListType,
        allocator: *Allocator,

        pub var instance: Self = undefined;

        pub fn init(allocator: *std.mem.Allocator) *Self {
            instance = Self{
                .allocator = allocator,
                .overflow_list = OverflowListType{},
            };

            return &instance;
        }

        pub fn isOverflowing() bool {
            return backing_buf_used >= @as(u16, count);
        }

        pub fn at(self: *const Self, index: IndexType) ?*ValueType {
            if (index.index == NotFound.index or index.index == Unassigned.index) return null;

            if (index.is_overflow) {
                return &self.overflow_list.items[index.index];
            } else {
                return &backing_buf[index.index];
            }
        }

        pub fn exists(self: *Self, value: ValueType) bool {
            return isSliceInBuffer(value, backing_buf);
        }

        pub fn append(self: *Self, value: ValueType) !IndexType {
            var result = IndexType{ .index = std.math.maxInt(u31), .is_overflow = backing_buf_used > max_index };
            if (result.is_overflow) {
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

        pub fn update(self: *Self, result: *IndexType, value: ValueType) !*ValueType {
            if (result.index.index == NotFound.index or result.index.index == Unassigned.index) {
                result.index.is_overflow = backing_buf_used > max_index;
                if (result.index.is_overflow) {
                    result.index.index = @intCast(u31, self.overflow_list.items.len);
                } else {
                    result.index.index = backing_buf_used;
                    backing_buf_used += 1;
                    if (backing_buf_used >= max_index) {
                        self.overflow_list = try @TypeOf(self.overflow_list).initCapacity(self.allocator, count);
                    }
                }
            }

            if (result.index.is_overflow) {
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

        pub fn remove(self: *Self, index: IndexType) void {
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

const Mutex = @import("./sync.zig").Mutex;

/// Append-only list.
/// Stores an initial count in .bss section of the object file
/// Overflows to heap when count is exceeded.
pub fn BSSStringList(comptime _count: usize, comptime _item_length: usize) type {
    // I experimented with string interning here and it was around...maybe 1% when generating a .bun?
    // I tried:
    // - arraybacked list
    // - hashmap list

    // + 1 for sentinel
    const item_length = _item_length + 1;
    const count = _count * 2;
    const max_index = count - 1;
    const ValueType = []const u8;

    return struct {
        pub var slice_buf: [count][]const u8 = undefined;
        pub var slice_buf_used: u16 = 0;
        pub var backing_buf: [count * item_length]u8 = undefined;
        pub var backing_buf_used: u64 = undefined;
        const Allocator = std.mem.Allocator;
        const Self = @This();

        overflow_list: std.ArrayListUnmanaged(ValueType),
        allocator: *Allocator,

        pub var instance: Self = undefined;
        var loaded: bool = false;
        // only need the mutex on append
        var mutex: Mutex = undefined;

        pub fn init(allocator: *std.mem.Allocator) *Self {
            if (!loaded) {
                instance = Self{
                    .allocator = allocator,
                    .overflow_list = std.ArrayListUnmanaged(ValueType){},
                };
                mutex = Mutex.init();
            }

            return &instance;
        }

        pub inline fn isOverflowing() bool {
            return slice_buf_used >= @as(u16, count);
        }

        pub fn exists(self: *Self, value: ValueType) bool {
            return isSliceInBuffer(value, slice_buf);
        }

        pub fn editableSlice(slice: []const u8) []u8 {
            return constStrToU8(slice);
        }

        pub fn append(self: *Self, comptime AppendType: type, _value: AppendType) ![]const u8 {
            return try self.doAppend(AppendType, _value);
        }

        threadlocal var lowercase_append_buf: [std.fs.MAX_PATH_BYTES]u8 = undefined;
        pub fn appendLowerCase(self: *Self, comptime AppendType: type, _value: AppendType) ![]const u8 {
            for (_value) |c, i| {
                lowercase_append_buf[i] = std.ascii.toLower(c);
            }
            var slice = lowercase_append_buf[0.._value.len];

            return self.doAppend(
                @TypeOf(slice),
                slice,
            );
        }

        inline fn doAppend(
            self: *Self,
            comptime AppendType: type,
            _value: AppendType,
        ) ![]const u8 {
            mutex.lock();
            defer mutex.unlock();

            const value_len: usize = brk: {
                switch (comptime AppendType) {
                    []const u8, []u8 => {
                        break :brk _value.len;
                    },
                    else => {
                        var len: usize = 0;
                        for (_value) |val| {
                            len += val.len;
                        }
                        break :brk len;
                    },
                }
                unreachable;
            } + 1;

            var value: [:0]u8 = undefined;
            if (value_len + backing_buf_used < backing_buf.len - 1) {
                const start = backing_buf_used;
                backing_buf_used += value_len;

                switch (AppendType) {
                    []const u8, []u8 => {
                        std.mem.copy(u8, backing_buf[start .. backing_buf_used - 1], _value);
                        backing_buf[backing_buf_used - 1] = 0;
                    },
                    else => {
                        var remainder = backing_buf[start..];
                        for (_value) |val| {
                            std.mem.copy(u8, remainder, val);
                            remainder = remainder[val.len..];
                        }
                        remainder[0] = 0;
                    },
                }

                value = backing_buf[start .. backing_buf_used - 1 :0];
            } else {
                var value_buf = try self.allocator.alloc(u8, value_len);

                switch (comptime AppendType) {
                    []const u8, []u8 => {
                        std.mem.copy(u8, value_buf, _value);
                    },
                    else => {
                        var remainder = value_buf;
                        for (_value) |val| {
                            std.mem.copy(u8, remainder, val);
                            remainder = remainder[val.len..];
                        }
                    },
                }

                value_buf[value_len - 1] = 0;
                value = value_buf[0 .. value_len - 1 :0];
            }

            var result = IndexType{ .index = std.math.maxInt(u31), .is_overflow = slice_buf_used > max_index };

            if (result.is_overflow) {
                result.index = @intCast(u31, self.overflow_list.items.len);
            } else {
                result.index = slice_buf_used;
                slice_buf_used += 1;
                if (slice_buf_used >= max_index) {
                    self.overflow_list = try @TypeOf(self.overflow_list).initCapacity(self.allocator, count);
                }
            }

            if (result.is_overflow) {
                if (self.overflow_list.items.len == result.index) {
                    const real_index = self.overflow_list.items.len;
                    try self.overflow_list.append(self.allocator, value);
                } else {
                    self.overflow_list.items[result.index] = value;
                }

                return self.overflow_list.items[result.index];
            } else {
                slice_buf[result.index] = value;

                return slice_buf[result.index];
            }
        }

        pub fn remove(self: *Self, index: IndexType) void {
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
            //             slice_buf[index].deinit();
            //         }
            //         slice_buf[index] = undefined;
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

pub fn BSSMap(comptime ValueType: type, comptime count: anytype, store_keys: bool, estimated_key_length: usize) type {
    const max_index = count - 1;
    const BSSMapType = struct {
        pub var backing_buf: [count]ValueType = undefined;
        pub var backing_buf_used: u16 = 0;
        const Allocator = std.mem.Allocator;
        const Self = @This();

        index: IndexMap,
        overflow_list: std.ArrayListUnmanaged(ValueType),
        allocator: *Allocator,

        pub var instance: Self = undefined;

        pub fn init(allocator: *std.mem.Allocator) *Self {
            instance = Self{
                .index = IndexMap{},
                .allocator = allocator,
                .overflow_list = std.ArrayListUnmanaged(ValueType){},
            };

            return &instance;
        }

        pub fn isOverflowing() bool {
            return backing_buf_used >= @as(u16, count);
        }

        pub fn getOrPut(self: *Self, key: []const u8) !Result {
            const _key = Wyhash.hash(Seed, key);
            var index = try self.index.getOrPut(self.allocator, _key);

            if (index.found_existing) {
                return Result{
                    .hash = _key,
                    .index = index.value_ptr.*,
                    .status = switch (index.value_ptr.index) {
                        NotFound.index => .not_found,
                        Unassigned.index => .unknown,
                        else => .exists,
                    },
                };
            }
            index.value_ptr.* = Unassigned;

            return Result{
                .hash = _key,
                .index = Unassigned,
                .status = .unknown,
            };
        }

        pub fn get(self: *const Self, key: []const u8) ?*ValueType {
            const _key = Wyhash.hash(Seed, key);
            const index = self.index.get(_key) orelse return null;
            return self.atIndex(index);
        }

        pub fn markNotFound(self: *Self, result: Result) void {
            self.index.put(self.allocator, result.hash, NotFound) catch unreachable;
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
                    if (backing_buf_used >= max_index) {
                        self.overflow_list = try @TypeOf(self.overflow_list).initCapacity(self.allocator, count);
                    }
                }
            }

            try self.index.put(self.allocator, result.hash, result.index);

            if (result.index.is_overflow) {
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

        pub fn remove(self: *Self, key: []const u8) void {
            const _key = Wyhash.hash(Seed, key);
            _ = self.index.remove(_key);
            // const index = self.index.get(_key) orelse return;
            // switch (index) {
            //     Unassigned.index, NotFound.index => {
            //         self.index.remove(_key);
            //     },
            //     0...max_index => {
            //         if (comptime hasDeinit(ValueType)) {
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
        var key_list_overflow: std.ArrayListUnmanaged([]u8) = undefined;
        var instance_loaded = false;
        pub fn init(allocator: *std.mem.Allocator) *Self {
            if (!instance_loaded) {
                instance = Self{
                    .map = BSSMapType.init(allocator),
                };
                instance_loaded = true;
            }

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
                std.mem.copy(u8, slice, key);
            } else {
                slice = try self.map.allocator.dupe(u8, key);
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
                    try key_list_overflow.append(self.map.allocator, slice);
                }
            }
        }

        pub fn markNotFound(self: *Self, result: Result) void {
            self.map.markNotFound(result);
        }

        // For now, don't free the keys.
        pub fn remove(self: *Self, key: []const u8) void {
            return self.map.remove(key);
        }
    };
}

pub fn TBSSMap(comptime ValueType: type, comptime count: anytype, store_keys: bool, estimated_key_length: usize) type {
    const max_index = count - 1;
    const BSSMapType = struct {
        pub threadlocal var backing_buf: [count]ValueType = undefined;
        pub threadlocal var backing_buf_used: u16 = 0;
        const Allocator = std.mem.Allocator;
        const Self = @This();

        index: IndexMap,
        overflow_list: std.ArrayListUnmanaged(ValueType),
        allocator: *Allocator,

        pub threadlocal var instance: Self = undefined;

        pub fn init(allocator: *std.mem.Allocator) *Self {
            instance = Self{
                .index = IndexMap{},
                .allocator = allocator,
                .overflow_list = std.ArrayListUnmanaged(ValueType){},
            };

            return &instance;
        }

        pub fn isOverflowing() bool {
            return backing_buf_used >= @as(u16, count);
        }

        pub fn getOrPut(self: *Self, key: []const u8) !Result {
            const _key = Wyhash.hash(Seed, key);
            var index = try self.index.getOrPut(self.allocator, _key);

            if (index.found_existing) {
                return Result{
                    .hash = _key,
                    .index = index.value_ptr.*,
                    .status = switch (index.value_ptr.index) {
                        NotFound.index => .not_found,
                        Unassigned.index => .unknown,
                        else => .exists,
                    },
                };
            }
            index.value_ptr.* = Unassigned;

            return Result{
                .hash = _key,
                .index = Unassigned,
                .status = .unknown,
            };
        }

        pub fn get(self: *const Self, key: []const u8) ?*ValueType {
            const _key = Wyhash.hash(Seed, key);
            const index = self.index.get(_key) orelse return null;
            return self.atIndex(index);
        }

        pub fn markNotFound(self: *Self, result: Result) void {
            self.index.put(self.allocator, result.hash, NotFound) catch unreachable;
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
                    if (backing_buf_used >= max_index) {
                        self.overflow_list = try @TypeOf(self.overflow_list).initCapacity(self.allocator, count);
                    }
                }
            }

            try self.index.put(self.allocator, result.hash, result.index);

            if (result.index.is_overflow) {
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

        pub fn remove(self: *Self, key: []const u8) IndexType {
            const _key = Wyhash.hash(Seed, key);
            const index = self.index.get(_key) orelse return;
            defer _ = self.index.remove(_key);

            switch (index) {
                NotFound.index, Unassigned.index => {},
                0...max_index => {
                    // if (hasDeinit(ValueType)) {
                    //     backing_buf[index].deinit();
                    // }
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
        pub threadlocal var instance: Self = undefined;
        threadlocal var key_list_buffer: [count * estimated_key_length]u8 = undefined;
        threadlocal var key_list_buffer_used: usize = 0;
        threadlocal var key_list_slices: [count][]u8 = undefined;
        threadlocal var key_list_overflow: std.ArrayListUnmanaged([]u8) = undefined;

        pub fn init(allocator: *std.mem.Allocator) *Self {
            instance = Self{
                .map = BSSMapType.init(allocator),
            };

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
                std.mem.copy(u8, slice, key);
            } else {
                slice = try self.map.allocator.dupe(u8, key);
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
                    try key_list_overflow.append(self.map.allocator, slice);
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
