const std = @import("std");

const FeatureFlags = @import("./feature_flags.zig");
const Environment = @import("./env.zig");
const FixedBufferAllocator = std.heap.FixedBufferAllocator;
const bun = @import("root").bun;
const OOM = bun.OOM;

pub fn isSliceInBufferT(comptime T: type, slice: []const T, buffer: []const T) bool {
    return (@intFromPtr(buffer.ptr) <= @intFromPtr(slice.ptr) and
        (@intFromPtr(slice.ptr) + slice.len * @sizeOf(T)) <= (@intFromPtr(buffer.ptr) + buffer.len * @sizeOf(T)));
}

/// Checks if a slice's pointer is contained within another slice.
/// If you need to make this generic, use isSliceInBufferT.
pub fn isSliceInBuffer(slice: []const u8, buffer: []const u8) bool {
    return isSliceInBufferT(u8, slice, buffer);
}

pub fn sliceRange(slice: []const u8, buffer: []const u8) ?[2]u32 {
    return if (@intFromPtr(buffer.ptr) <= @intFromPtr(slice.ptr) and
        (@intFromPtr(slice.ptr) + slice.len) <= (@intFromPtr(buffer.ptr) + buffer.len))
        [2]u32{
            @as(u32, @truncate(@intFromPtr(slice.ptr) - @intFromPtr(buffer.ptr))),
            @as(u32, @truncate(slice.len)),
        }
    else
        null;
}

pub const IndexType = packed struct {
    index: u31,
    is_overflow: bool = false,
};

const HashKeyType = u64;
const IndexMapContext = struct {
    pub fn hash(_: @This(), key: HashKeyType) HashKeyType {
        return key;
    }

    pub fn eql(_: @This(), a: HashKeyType, b: HashKeyType) bool {
        return a == b;
    }
};

pub const IndexMap = std.HashMapUnmanaged(HashKeyType, IndexType, IndexMapContext, 80);

pub const IndexMapManaged = std.HashMap(HashKeyType, IndexType, IndexMapContext, 80);
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
};

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

fn OverflowGroup(comptime Block: type) type {
    return struct {
        const Overflow = @This();
        // 16 million files should be good enough for anyone
        // ...right?
        const max = 4095;
        const UsedSize = std.math.IntFittingRange(0, max + 1);
        const default_allocator = bun.default_allocator;
        used: UsedSize = 0,
        allocated: UsedSize = 0,
        ptrs: [max]*Block = undefined,

        pub fn tail(this: *Overflow) *Block {
            if (this.allocated > 0 and this.ptrs[this.used].isFull()) {
                this.used +%= 1;
                if (this.allocated > this.used) {
                    this.ptrs[this.used].used = 0;
                }
            }

            if (this.allocated <= this.used) {
                this.ptrs[this.allocated] = default_allocator.create(Block) catch unreachable;
                this.ptrs[this.allocated].* = Block{};
                this.allocated +%= 1;
            }

            return this.ptrs[this.used];
        }

        pub inline fn slice(this: *Overflow) []*Block {
            return this.ptrs[0..this.used];
        }
    };
}

pub fn OverflowList(comptime ValueType: type, comptime count: comptime_int) type {
    return struct {
        const This = @This();
        const SizeType = std.math.IntFittingRange(0, count);

        const Block = struct {
            used: SizeType = 0,
            items: [count]ValueType = undefined,

            pub inline fn isFull(block: *const Block) bool {
                return block.used >= @as(SizeType, count);
            }

            pub fn append(block: *Block, value: ValueType) *ValueType {
                if (comptime Environment.allow_assert) bun.assert(block.used < count);
                const index = block.used;
                block.items[index] = value;
                block.used +%= 1;
                return &block.items[index];
            }
        };
        const Overflow = OverflowGroup(Block);
        list: Overflow = Overflow{},
        count: u31 = 0,

        pub inline fn len(this: *const This) u31 {
            return this.count;
        }

        pub inline fn append(this: *This, value: ValueType) *ValueType {
            this.count += 1;
            return this.list.tail().append(value);
        }

        fn reset(this: *This) void {
            for (this.list.slice()) |block| {
                block.used = 0;
            }
            this.list.used = 0;
        }

        pub inline fn atIndex(this: *const This, index: IndexType) *const ValueType {
            const block_id = if (index.index > 0)
                index.index / count
            else
                0;

            if (comptime Environment.allow_assert) bun.assert(index.is_overflow);
            if (comptime Environment.allow_assert) bun.assert(this.list.used >= block_id);
            if (comptime Environment.allow_assert) bun.assert(this.list.ptrs[block_id].used > (index.index % count));

            return &this.list.ptrs[block_id].items[index.index % count];
        }

        pub inline fn atIndexMut(this: *This, index: IndexType) *ValueType {
            const block_id = if (index.index > 0)
                index.index / count
            else
                0;

            if (comptime Environment.allow_assert) bun.assert(index.is_overflow);
            if (comptime Environment.allow_assert) bun.assert(this.list.used >= block_id);
            if (comptime Environment.allow_assert) bun.assert(this.list.ptrs[block_id].used > (index.index % count));

            return &this.list.ptrs[block_id].items[index.index % count];
        }
    };
}

/// "Formerly-BSSList"
/// It's not actually BSS anymore.
///
/// We do keep a pointer to it globally, but because the data is not zero-initialized, it ends up taking space in the object file.
/// We don't want to spend 1-2 MB on these structs.
pub fn BSSList(comptime ValueType: type, comptime _count: anytype) type {
    const count = _count * 2;
    const max_index = count - 1;
    return struct {
        const ChunkSize = 256;
        const OverflowBlock = struct {
            used: std.atomic.Value(u16) = std.atomic.Value(u16).init(0),
            data: [ChunkSize]ValueType = undefined,
            prev: ?*OverflowBlock = null,

            pub fn append(this: *OverflowBlock, item: ValueType) !*ValueType {
                const index = this.used.fetchAdd(1, .acq_rel);
                if (index >= ChunkSize) return error.OutOfMemory;
                this.data[index] = item;
                return &this.data[index];
            }
        };

        const Allocator = std.mem.Allocator;
        const Self = @This();

        allocator: Allocator,
        mutex: Mutex = .{},
        head: *OverflowBlock = undefined,
        tail: OverflowBlock = OverflowBlock{},
        backing_buf: [count]ValueType = undefined,
        used: u32 = 0,

        pub var instance: *Self = undefined;
        pub var loaded = false;

        pub inline fn blockIndex(index: u31) usize {
            return index / ChunkSize;
        }

        pub fn init(allocator: std.mem.Allocator) *Self {
            if (!loaded) {
                instance = bun.default_allocator.create(Self) catch bun.outOfMemory();
                instance.* = Self{
                    .allocator = allocator,
                    .tail = OverflowBlock{},
                };
                instance.head = &instance.tail;
                loaded = true;
            }

            return instance;
        }

        pub fn isOverflowing() bool {
            return instance.used >= @as(u16, count);
        }

        pub fn exists(_: *Self, value: ValueType) bool {
            return isSliceInBuffer(value, instance.backing_buf);
        }

        fn appendOverflow(self: *Self, value: ValueType) !*ValueType {
            instance.used += 1;
            return self.head.append(value) catch brk: {
                var new_block = try self.allocator.create(OverflowBlock);
                new_block.* = OverflowBlock{};
                new_block.prev = self.head;
                self.head = new_block;
                break :brk self.head.append(value);
            };
        }

        pub fn append(self: *Self, value: ValueType) !*ValueType {
            self.mutex.lock();
            defer self.mutex.unlock();
            if (instance.used > max_index) {
                return self.appendOverflow(value);
            } else {
                const index = instance.used;
                instance.backing_buf[index] = value;
                instance.used += 1;
                return &instance.backing_buf[index];
            }
        }
        pub const Pair = struct { index: IndexType, value: *ValueType };
    };
}

const Mutex = bun.Mutex;

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
        pub const Overflow = OverflowList([]const u8, count / 4);
        const Allocator = std.mem.Allocator;
        const Self = @This();

        backing_buf: [count * item_length]u8 = undefined,
        backing_buf_used: u64 = undefined,
        overflow_list: Overflow = Overflow{},
        allocator: Allocator,
        slice_buf: [count][]const u8 = undefined,
        slice_buf_used: u16 = 0,
        mutex: Mutex = .{},
        pub var instance: *Self = undefined;
        var loaded: bool = false;
        // only need the mutex on append

        const EmptyType = struct {
            len: usize = 0,
        };

        pub fn init(allocator: std.mem.Allocator) *Self {
            if (!loaded) {
                instance = bun.default_allocator.create(Self) catch bun.outOfMemory();
                instance.* = Self{
                    .allocator = allocator,
                    .backing_buf_used = 0,
                };
                loaded = true;
            }

            return instance;
        }

        pub inline fn isOverflowing() bool {
            return instance.slice_buf_used >= @as(u16, count);
        }

        pub fn exists(self: *const Self, value: ValueType) bool {
            return isSliceInBuffer(value, &self.backing_buf);
        }

        pub fn editableSlice(slice: []const u8) []u8 {
            return @constCast(slice);
        }

        pub fn appendMutable(self: *Self, comptime AppendType: type, _value: AppendType) OOM![]u8 {
            const appended = try @call(bun.callmod_inline, append, .{ self, AppendType, _value });
            return @constCast(appended);
        }

        pub fn getMutable(self: *Self, len: usize) ![]u8 {
            return try self.appendMutable(EmptyType, EmptyType{ .len = len });
        }

        pub fn printWithType(self: *Self, comptime fmt: []const u8, comptime Args: type, args: Args) OOM![]const u8 {
            var buf = try self.appendMutable(EmptyType, EmptyType{ .len = std.fmt.count(fmt, args) + 1 });
            buf[buf.len - 1] = 0;
            return std.fmt.bufPrint(buf.ptr[0 .. buf.len - 1], fmt, args) catch unreachable;
        }

        pub fn print(self: *Self, comptime fmt: []const u8, args: anytype) OOM![]const u8 {
            return try printWithType(self, fmt, @TypeOf(args), args);
        }

        pub fn append(self: *Self, comptime AppendType: type, _value: AppendType) OOM![]const u8 {
            self.mutex.lock();
            defer self.mutex.unlock();

            return try self.doAppend(AppendType, _value);
        }

        threadlocal var lowercase_append_buf: bun.PathBuffer = undefined;
        pub fn appendLowerCase(self: *Self, comptime AppendType: type, _value: AppendType) OOM![]const u8 {
            self.mutex.lock();
            defer self.mutex.unlock();

            for (_value, 0..) |c, i| {
                lowercase_append_buf[i] = std.ascii.toLower(c);
            }
            const slice = lowercase_append_buf[0.._value.len];

            return self.doAppend(
                @TypeOf(slice),
                slice,
            );
        }

        inline fn doAppend(
            self: *Self,
            comptime AppendType: type,
            _value: AppendType,
        ) OOM![]const u8 {
            const value_len: usize = brk: {
                switch (comptime AppendType) {
                    EmptyType, []const u8, []u8, [:0]const u8, [:0]u8 => {
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
            if (value_len + instance.backing_buf_used < instance.backing_buf.len - 1) {
                const start = instance.backing_buf_used;
                instance.backing_buf_used += value_len;

                switch (AppendType) {
                    EmptyType => {
                        instance.backing_buf[instance.backing_buf_used - 1] = 0;
                    },
                    []const u8, []u8, [:0]const u8, [:0]u8 => {
                        bun.copy(u8, instance.backing_buf[start .. instance.backing_buf_used - 1], _value);
                        instance.backing_buf[instance.backing_buf_used - 1] = 0;
                    },
                    else => {
                        var remainder = instance.backing_buf[start..];
                        for (_value) |val| {
                            bun.copy(u8, remainder, val);
                            remainder = remainder[val.len..];
                        }
                        remainder[0] = 0;
                    },
                }

                value = instance.backing_buf[start .. instance.backing_buf_used - 1 :0];
            } else {
                var value_buf = try self.allocator.alloc(u8, value_len);

                switch (comptime AppendType) {
                    EmptyType => {},
                    []const u8, []u8, [:0]const u8, [:0]u8 => {
                        bun.copy(u8, value_buf, _value);
                    },
                    else => {
                        var remainder = value_buf;
                        for (_value) |val| {
                            bun.copy(u8, remainder, val);
                            remainder = remainder[val.len..];
                        }
                    },
                }

                value_buf[value_len - 1] = 0;
                value = value_buf[0 .. value_len - 1 :0];
            }

            var result = IndexType{ .index = std.math.maxInt(u31), .is_overflow = instance.slice_buf_used > max_index };

            if (result.is_overflow) {
                result.index = @as(u31, @intCast(self.overflow_list.len()));
            } else {
                result.index = instance.slice_buf_used;
                instance.slice_buf_used += 1;
            }

            if (result.is_overflow) {
                if (self.overflow_list.len() == result.index) {
                    _ = self.overflow_list.append(value);
                } else {
                    self.overflow_list.atIndexMut(result).* = value;
                }

                return value;
            } else {
                instance.slice_buf[result.index] = value;

                return instance.slice_buf[result.index];
            }
        }
    };
}

pub fn BSSMap(comptime ValueType: type, comptime count: anytype, comptime store_keys: bool, comptime estimated_key_length: usize, comptime remove_trailing_slashes: bool) type {
    const max_index = count - 1;
    const BSSMapType = struct {
        const Allocator = std.mem.Allocator;
        const Self = @This();
        const Overflow = OverflowList(ValueType, count / 4);

        index: IndexMap,
        overflow_list: Overflow = Overflow{},
        allocator: Allocator,
        mutex: Mutex = .{},
        backing_buf: [count]ValueType = undefined,
        backing_buf_used: u16 = 0,

        pub var instance: *Self = undefined;

        var loaded: bool = false;

        pub fn init(allocator: std.mem.Allocator) *Self {
            if (!loaded) {
                instance = bun.default_allocator.create(Self) catch bun.outOfMemory();
                instance.* = Self{
                    .index = IndexMap{},
                    .allocator = allocator,
                };
                loaded = true;
            }

            return instance;
        }

        pub fn isOverflowing() bool {
            return instance.backing_buf_used >= @as(u16, count);
        }

        pub fn getOrPut(self: *Self, denormalized_key: []const u8) !Result {
            const key = if (comptime remove_trailing_slashes) std.mem.trimRight(u8, denormalized_key, std.fs.path.sep_str) else denormalized_key;
            const _key = bun.hash(key);

            self.mutex.lock();
            defer self.mutex.unlock();
            const index = try self.index.getOrPut(self.allocator, _key);

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

        pub fn get(self: *Self, denormalized_key: []const u8) ?*ValueType {
            const key = if (comptime remove_trailing_slashes) std.mem.trimRight(u8, denormalized_key, std.fs.path.sep_str) else denormalized_key;
            const _key = bun.hash(key);
            self.mutex.lock();
            defer self.mutex.unlock();
            const index = self.index.get(_key) orelse return null;
            return self.atIndex(index);
        }

        pub fn markNotFound(self: *Self, result: Result) void {
            self.mutex.lock();
            defer self.mutex.unlock();

            self.index.put(self.allocator, result.hash, NotFound) catch unreachable;
        }

        pub fn atIndex(self: *Self, index: IndexType) ?*ValueType {
            if (index.index == NotFound.index or index.index == Unassigned.index) return null;

            if (index.is_overflow) {
                return self.overflow_list.atIndexMut(index);
            } else {
                return &instance.backing_buf[index.index];
            }
        }

        pub fn put(self: *Self, result: *Result, value: ValueType) !*ValueType {
            self.mutex.lock();
            defer self.mutex.unlock();

            if (result.index.index == NotFound.index or result.index.index == Unassigned.index) {
                result.index.is_overflow = instance.backing_buf_used > max_index;
                if (result.index.is_overflow) {
                    result.index.index = self.overflow_list.len();
                } else {
                    result.index.index = instance.backing_buf_used;
                    instance.backing_buf_used += 1;
                }
            }

            try self.index.put(self.allocator, result.hash, result.index);

            if (result.index.is_overflow) {
                if (self.overflow_list.len() == result.index.index) {
                    return self.overflow_list.append(value);
                } else {
                    const ptr = self.overflow_list.atIndexMut(result.index);
                    ptr.* = value;
                    return ptr;
                }
            } else {
                instance.backing_buf[result.index.index] = value;

                return &instance.backing_buf[result.index.index];
            }
        }

        /// Returns true if the entry was removed
        pub fn remove(self: *Self, denormalized_key: []const u8) bool {
            self.mutex.lock();
            defer self.mutex.unlock();

            const key = if (comptime remove_trailing_slashes)
                std.mem.trimRight(u8, denormalized_key, std.fs.path.sep_str)
            else
                denormalized_key;

            const _key = bun.hash(key);
            return self.index.remove(_key);
            // const index = self.index.get(_key) orelse return;
            // switch (index) {
            //     Unassigned.index, NotFound.index => {
            //         self.index.remove(_key);
            //     },
            //     0...max_index => {
            //         if (comptime hasDeinit(ValueType)) {
            //             instance.backing_buf[index].deinit();
            //         }

            //         instance.backing_buf[index] = undefined;
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
        key_list_buffer: [count * estimated_key_length]u8 = undefined,
        key_list_buffer_used: usize = 0,
        key_list_slices: [count][]u8 = undefined,
        key_list_overflow: OverflowList([]u8, count / 4) = OverflowList([]u8, count / 4){},

        const Self = @This();
        pub var instance: *Self = undefined;
        pub var instance_loaded = false;

        pub fn init(allocator: std.mem.Allocator) *Self {
            if (!instance_loaded) {
                instance = bun.default_allocator.create(Self) catch bun.outOfMemory();
                instance.* = Self{
                    .map = BSSMapType.init(allocator),
                };
                instance_loaded = true;
            }

            return instance;
        }

        pub fn isOverflowing() bool {
            return instance.map.backing_buf_used >= count;
        }
        pub fn getOrPut(self: *Self, key: []const u8) !Result {
            return try self.map.getOrPut(key);
        }
        pub fn get(self: *Self, key: []const u8) ?*ValueType {
            return @call(bun.callmod_inline, BSSMapType.get, .{ self.map, key });
        }

        pub fn atIndex(self: *Self, index: IndexType) ?*ValueType {
            return @call(bun.callmod_inline, BSSMapType.atIndex, .{ self.map, index });
        }

        pub fn keyAtIndex(_: *Self, index: IndexType) ?[]const u8 {
            return switch (index.index) {
                Unassigned.index, NotFound.index => null,
                else => {
                    if (!index.is_overflow) {
                        return instance.key_list_slices[index.index];
                    } else {
                        return instance.key_list_overflow.items[index.index];
                    }
                },
            };
        }

        pub fn put(self: *Self, key: anytype, comptime store_key: bool, result: *Result, value: ValueType) !*ValueType {
            const ptr = try self.map.put(result, value);
            if (store_key) {
                try self.putKey(key, result);
            }

            return ptr;
        }

        pub fn isKeyStaticallyAllocated(key: anytype) bool {
            return isSliceInBuffer(key, &instance.key_list_buffer);
        }

        // There's two parts to this.
        // 1. Storing the underlying string.
        // 2. Making the key accessible at the index.
        pub fn putKey(self: *Self, key: anytype, result: *Result) !void {
            self.map.mutex.lock();
            defer self.map.mutex.unlock();
            var slice: []u8 = undefined;

            // Is this actually a slice into the map? Don't free it.
            if (isKeyStaticallyAllocated(key)) {
                slice = key;
            } else if (instance.key_list_buffer_used + key.len < instance.key_list_buffer.len) {
                const start = instance.key_list_buffer_used;
                instance.key_list_buffer_used += key.len;
                slice = instance.key_list_buffer[start..instance.key_list_buffer_used];
                bun.copy(u8, slice, key);
            } else {
                slice = try self.map.allocator.dupe(u8, key);
            }

            if (comptime remove_trailing_slashes) {
                slice = std.mem.trimRight(u8, slice, "/");
            }

            if (!result.index.is_overflow) {
                instance.key_list_slices[result.index.index] = slice;
            } else {
                if (@as(u31, @intCast(instance.key_list_overflow.items.len)) > result.index.index) {
                    const existing_slice = instance.key_list_overflow.items[result.index.index];
                    if (!isKeyStaticallyAllocated(existing_slice)) {
                        self.map.allocator.free(existing_slice);
                    }
                    instance.key_list_overflow.items[result.index.index] = slice;
                } else {
                    try instance.key_list_overflow.append(self.map.allocator, slice);
                }
            }
        }

        pub fn markNotFound(self: *Self, result: Result) void {
            self.map.markNotFound(result);
        }

        /// This does not free the keys.
        /// Returns `true` if an entry had previously existed.
        pub fn remove(self: *Self, key: []const u8) bool {
            return self.map.remove(key);
        }
    };
}
