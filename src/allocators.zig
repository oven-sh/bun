const std = @import("std");

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

const HashKeyType = u64;
const IndexMap = std.HashMapUnmanaged(HashKeyType, u32, hash_hashFn, hash_eqlFn, 80);
pub const Result = struct {
    hash: HashKeyType,
    index: u32,
    status: ItemStatus,

    pub fn hasCheckedIfExists(r: *Result) bool {
        return r.status != .unknown;
    }
};
const Seed = 999;
pub const NotFound = std.math.maxInt(u32);
pub const Unassigned = NotFound - 1;

pub fn hash_hashFn(key: HashKeyType) HashKeyType {
    return key;
}

pub fn hash_eqlFn(a: HashKeyType, b: HashKeyType) bool {
    return a == b;
}

pub const ItemStatus = packed enum(u3) {
    unknown,
    exists,
    not_found,
};

const hasDeinit = std.meta.trait.hasFn("deinit")(ValueType);

pub fn BSSMap(comptime ValueType: type, comptime count: anytype, store_keys: bool, estimated_key_length: usize) type {
    const max_index = count - 1;
    const BSSMapType = struct {
        pub var backing_buf: [count]ValueType = undefined;
        pub var backing_buf_used: u16 = 0;
        const Allocator = std.mem.Allocator;
        const Self = @This();

        // const HashTableAllocator = BSSSectionAllocator(@bitSizeOf(HashKeyType) * count * 2);

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
                    .index = index.entry.value,
                    .status = switch (index.entry.value) {
                        NotFound => .not_found,
                        Unassigned => .unknown,
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
            const index = self.index.get(_key) orelse return null;
            return self.atIndex(index);
        }

        pub fn markNotFound(self: *Self, result: Result) void {
            self.index.put(self.allocator, result.hash, NotFound) catch unreachable;
        }

        pub fn atIndex(self: *const Self, index: u32) ?*ValueType {
            return switch (index) {
                NotFound, Unassigned => null,
                0...max_index => &backing_buf[index],
                else => &self.overflow_list.items[index - count],
            };
        }

        pub fn put(self: *Self, result: *Result, value: ValueType) !*ValueType {
            var index: u32 = @intCast(u32, backing_buf_used + 1);
            if (index >= max_index) {
                const real_index = self.overflow_list.items.len;
                index += @truncate(u32, real_index);
                try self.overflow_list.append(self.allocator, value);
                result.index = index;
                self.index.putAssumeCapacity(result.hash, index);
                return &self.overflow_list.items[real_index];
            } else {
                backing_buf_used += 1;
                backing_buf[index] = value;
                result.index = index;
                self.index.putAssumeCapacity(result.hash, index);
                if (backing_buf_used >= max_index - 1) {
                    self.overflow_list = try @TypeOf(self.overflow_list).initCapacity(self.allocator, count);
                }
                return &backing_buf[index];
            }
        }

        pub fn remove(self: *Self, key: string) u32 {
            const _key = Wyhash.hash(Seed, key);
            const index = self.index.get(_key) orelse return;
            switch (index) {
                Unassigned => {
                    self.index.remove(_key);
                },
                NotFound => {
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
        var key_list_overflow: std.ArrayListUnmanaged([]u8) = undefined;

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

        pub fn atIndex(self: *Self, index: u32) ?*ValueType {
            return @call(.{ .modifier = .always_inline }, BSSMapType.atIndex, .{ self.map, index });
        }

        pub fn keyAtIndex(self: *Self, index: u32) ?[]const u8 {
            return switch (index) {
                Unassigned, NotFound => null,
                0...max_index => {
                    return key_list_slices[index];
                },
                else => {
                    return key_list_overflow.items[index - count];
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

        pub fn putKey(self: *Self, key: anytype, result: *Result) !void {
            if (key_list_buffer_used + key.len < key_list_buffer.len) {
                const start = key_list_buffer_used;
                key_list_buffer_used += key.len;
                var slice = key_list_buffer[start..key_list_buffer_used];
                std.mem.copy(u8, slice, key);

                if (result.index < count) {
                    key_list_slices[result.index] = slice;
                } else {
                    try key_list_overflow.append(self.map.allocator, slice);
                }
            } else if (result.index > key_list_overflow.items.len) {
                try key_list_overflow.append(self.map.allocator, try self.map.allocator.dupe(u8, key));
            } else {
                const real_index = result.index - count;
                if (key_list_overflow.items[real_index].len > 0) {
                    self.map.allocator.free(key_list_overflow.items[real_index]);
                }

                key_list_overflow.items[real_index] = try self.map.allocator.dupe(u8, key);
            }
        }

        pub fn markNotFound(self: *Self, result: Result) void {
            self.map.markNotFound(result);
        }

        // For now, don't free the keys.
        pub fn remove(self: *Self, key: string) u32 {
            return self.map.remove(key);
        }
    };
}
