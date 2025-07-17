// https://github.com/lithdew/rheia/blob/162293d0f0e8d6572a8954c0add83f13f76b3cc6/hash_map.zig
// Apache License 2.0
const std = @import("std");

const mem = std.mem;
const math = std.math;
const testing = std.testing;

const bun = @import("bun");
const assert = bun.assert;

pub fn AutoHashMap(comptime K: type, comptime V: type, comptime max_load_percentage: comptime_int) type {
    return HashMap(K, V, std.hash_map.AutoContext(K), max_load_percentage);
}

pub fn AutoStaticHashMap(comptime K: type, comptime V: type, comptime capacity: comptime_int) type {
    return StaticHashMap(K, V, std.hash_map.AutoContext(K), capacity);
}

pub fn StaticHashMap(comptime K: type, comptime V: type, comptime Context: type, comptime capacity: usize) type {
    assert(math.isPowerOfTwo(capacity));

    const shift = 63 - math.log2_int(u64, capacity) + 1;
    const overflow = capacity / 10 + (63 - @as(u64, shift) + 1) << 1;

    return struct {
        const empty_hash = math.maxInt(u64);

        pub const Entry = struct {
            hash: u64 = empty_hash,
            key: K = std.mem.zeroes(K),
            value: V = std.mem.zeroes(V),

            pub fn isEmpty(self: Entry) bool {
                return self.hash == empty_hash;
            }

            pub fn format(self: Entry, comptime layout: []const u8, options: std.fmt.FormatOptions, writer: anytype) !void {
                _ = layout;
                _ = options;
                try std.fmt.format(writer, "(hash: {}, key: {}, value: {})", .{ self.hash, self.key, self.value });
            }
        };

        pub const GetOrPutResult = struct {
            value_ptr: *V,
            found_existing: bool,
        };

        const Self = @This();

        entries: [capacity + overflow]Entry = [_]Entry{.{}} ** (capacity + overflow),
        len: usize = 0,
        shift: u6 = shift,

        // put_probe_count: usize = 0,
        // get_probe_count: usize = 0,
        // del_probe_count: usize = 0,

        const impl = HashMapMixin(Self, K, V, Context);
        pub const putAssumeCapacity = impl.putAssumeCapacity;
        pub const slice = impl.slice;
        pub const clearRetainingCapacity = impl.clearRetainingCapacity;
        pub const putAssumeCapacityContext = impl.putAssumeCapacityContext;
        pub const getOrPutAssumeCapacity = impl.getOrPutAssumeCapacity;
        pub const getOrPutAssumeCapacityContext = impl.getOrPutAssumeCapacityContext;
        pub const get = impl.get;
        pub const getContext = impl.getContext;
        pub const has = impl.has;
        pub const hasWithHash = impl.hasWithHash;
        pub const hasContext = impl.hasContext;
        pub const delete = impl.delete;
        pub const deleteContext = impl.deleteContext;
    };
}

pub fn HashMap(comptime K: type, comptime V: type, comptime Context: type, comptime max_load_percentage: comptime_int) type {
    return struct {
        const empty_hash = math.maxInt(u64);

        pub const Entry = struct {
            hash: u64 = empty_hash,
            key: K = undefined,
            value: V = undefined,

            pub fn isEmpty(self: Entry) bool {
                return self.hash == empty_hash;
            }

            pub fn format(self: Entry, comptime layout: []const u8, options: std.fmt.FormatOptions, writer: anytype) !void {
                _ = layout;
                _ = options;
                try std.fmt.format(writer, "(hash: {}, key: {}, value: {})", .{ self.hash, self.key, self.value });
            }
        };

        pub const GetOrPutResult = struct {
            value_ptr: *V,
            found_existing: bool,
        };

        const Self = @This();

        entries: [*]Entry,
        len: usize = 0,
        shift: u6,

        // put_probe_count: usize = 0,
        // get_probe_count: usize = 0,
        // del_probe_count: usize = 0,

        const impl = HashMapMixin(Self, K, V, Context);
        pub const putAssumeCapacity = impl.putAssumeCapacity;
        pub const slice = impl.slice;
        pub const clearRetainingCapacity = impl.clearRetainingCapacity;
        pub const putAssumeCapacityContext = impl.putAssumeCapacityContext;
        pub const getOrPutAssumeCapacity = impl.getOrPutAssumeCapacity;
        pub const getOrPutAssumeCapacityContext = impl.getOrPutAssumeCapacityContext;
        pub const get = impl.get;
        pub const getContext = impl.getContext;
        pub const has = impl.has;
        pub const hasWithHash = impl.hasWithHash;
        pub const hasContext = impl.hasContext;
        pub const delete = impl.delete;
        pub const deleteContext = impl.deleteContext;

        pub fn initCapacity(gpa: mem.Allocator, capacity: u64) !Self {
            assert(math.isPowerOfTwo(capacity));

            const shift = 63 - math.log2_int(u64, capacity) + 1;
            const overflow = capacity / 10 + (63 - @as(u64, shift) + 1) << 1;

            const entries = try gpa.alloc(Entry, @as(usize, @intCast(capacity + overflow)));
            @memset(entries, .{});

            return Self{
                .entries = entries.ptr,
                .shift = shift,
            };
        }

        pub fn deinit(self: *Self, gpa: mem.Allocator) void {
            gpa.free(self.slice());
        }

        pub fn ensureUnusedCapacity(self: *Self, gpa: mem.Allocator, count: usize) !void {
            try self.ensureTotalCapacity(gpa, self.len + count);
        }

        pub fn ensureTotalCapacity(self: *Self, gpa: mem.Allocator, count: usize) !void {
            while (true) {
                const capacity = @as(u64, 1) << (63 - self.shift + 1);
                if (count <= capacity * max_load_percentage / 100) {
                    break;
                }
                try self.grow(gpa);
            }
        }

        fn grow(self: *Self, gpa: mem.Allocator) !void {
            const capacity = @as(u64, 1) << (63 - self.shift + 1);
            const overflow = capacity / 10 + (63 - @as(usize, self.shift) + 1) << 1;
            const end = self.entries + @as(usize, @intCast(capacity + overflow));

            const map = try Self.initCapacity(gpa, @as(usize, @intCast(capacity * 2)));
            var src = self.entries;
            var dst = map.entries;

            while (src != end) {
                const entry = src[0];

                const i = if (!entry.isEmpty()) entry.hash >> map.shift else 0;
                const p = map.entries + i;

                dst = if (@intFromPtr(p) >= @intFromPtr(dst)) p else dst;
                dst[0] = entry;

                src += 1;
                dst += 1;
            }

            self.deinit(gpa);
            self.entries = map.entries;
            self.shift = map.shift;
        }

        pub fn put(self: *Self, gpa: mem.Allocator, key: K, value: V) !void {
            try self.putContext(gpa, key, value, undefined);
        }

        pub fn putContext(self: *Self, gpa: mem.Allocator, key: K, value: V, ctx: Context) !void {
            try self.ensureUnusedCapacity(gpa, 1);
            self.putAssumeCapacityContext(key, value, ctx);
        }

        pub fn getOrPut(self: *Self, gpa: mem.Allocator, key: K) !GetOrPutResult {
            return try self.getOrPutContext(gpa, key, undefined);
        }

        pub fn getOrPutContext(self: *Self, gpa: mem.Allocator, key: K, ctx: Context) !GetOrPutResult {
            try self.ensureUnusedCapacity(gpa, 1);
            return self.getOrPutAssumeCapacityContext(key, ctx);
        }
    };
}

fn HashMapMixin(
    comptime Self: type,
    comptime K: type,
    comptime V: type,
    comptime Context: type,
) type {
    return struct {
        pub fn clearRetainingCapacity(self: *Self) void {
            @memset(self.slice(), .{});
            self.len = 0;
        }

        pub fn slice(self: *Self) []Self.Entry {
            const capacity = @as(u64, 1) << (63 - self.shift + 1);
            const overflow = capacity / 10 + (63 - @as(usize, self.shift) + 1) << 1;
            return self.entries[0..@as(usize, @intCast(capacity + overflow))];
        }

        pub fn putAssumeCapacity(self: *Self, key: K, value: V) void {
            self.putAssumeCapacityContext(key, value, undefined);
        }

        pub fn putAssumeCapacityContext(self: *Self, key: K, value: V, ctx: Context) void {
            const result = self.getOrPutAssumeCapacityContext(key, ctx);
            if (!result.found_existing) result.value_ptr.* = value;
        }

        pub fn getOrPutAssumeCapacity(self: *Self, key: K) Self.GetOrPutResult {
            return self.getOrPutAssumeCapacityContext(key, undefined);
        }

        pub fn getOrPutAssumeCapacityContext(self: *Self, key: K, ctx: Context) Self.GetOrPutResult {
            var it: Self.Entry = .{ .hash = ctx.hash(key), .key = key, .value = undefined };
            var i = it.hash >> self.shift;

            assert(it.hash != Self.empty_hash);

            var inserted_at: ?usize = null;
            while (true) : (i += 1) {
                const entry = self.entries[i];
                if (entry.hash >= it.hash) {
                    if (ctx.eql(entry.key, key)) {
                        return .{ .found_existing = true, .value_ptr = &self.entries[i].value };
                    }
                    self.entries[i] = it;
                    if (entry.isEmpty()) {
                        self.len += 1;
                        return .{ .found_existing = false, .value_ptr = &self.entries[inserted_at orelse i].value };
                    }
                    if (inserted_at == null) {
                        inserted_at = i;
                    }
                    it = entry;
                }
                // self.put_probe_count += 1;
            }
        }

        pub fn get(self: *const Self, key: K) ?V {
            return self.getContext(key, undefined);
        }

        pub fn getContext(self: *const Self, key: K, ctx: Context) ?V {
            const hash = ctx.hash(key);
            assert(hash != Self.empty_hash);

            for (self.entries[hash >> self.shift ..]) |entry| {
                if (entry.hash >= hash) {
                    if (!ctx.eql(entry.key, key)) {
                        return null;
                    }
                    return entry.value;
                }
                // self.get_probe_count += 1;
            }
        }

        pub fn has(self: *const Self, key: K) bool {
            return self.hasContext(key, undefined);
        }

        pub fn hasWithHash(self: *const Self, key_hash: u64) bool {
            assert(key_hash != Self.empty_hash);

            for (self.entries[key_hash >> self.shift ..]) |entry| {
                if (entry.hash >= key_hash) {
                    return entry.hash == key_hash;
                }
            }

            return false;
        }

        pub fn hasContext(self: *const Self, key: K, ctx: Context) bool {
            const hash = ctx.hash(key);
            assert(hash != Self.empty_hash);

            for (self.entries[hash >> self.shift ..]) |entry| {
                if (entry.hash >= hash) {
                    if (!ctx.eql(entry.key, key)) {
                        return false;
                    }
                    return true;
                }
                // self.get_probe_count += 1;
            }
            unreachable;
        }

        pub fn delete(self: *Self, key: K) ?V {
            return self.deleteContext(key, undefined);
        }

        pub fn deleteContext(self: *Self, key: K, ctx: Context) ?V {
            const hash = ctx.hash(key);
            assert(hash != Self.empty_hash);

            var i = hash >> self.shift;
            while (true) : (i += 1) {
                const entry = self.entries[i];
                if (entry.hash >= hash) {
                    if (!ctx.eql(entry.key, key)) {
                        return null;
                    }
                    break;
                }
                // self.del_probe_count += 1;
            }

            const value = self.entries[i].value;

            while (true) : (i += 1) {
                const j = self.entries[i + 1].hash >> self.shift;
                if (i < j or self.entries[i + 1].isEmpty()) {
                    break;
                }
                self.entries[i] = self.entries[i + 1];
                // self.del_probe_count += 1;
            }
            self.entries[i] = .{};
            self.len -= 1;

            return value;
        }
    };
}

pub fn SortedHashMap(comptime V: type, comptime max_load_percentage: comptime_int) type {
    return struct {
        const empty_hash: [32]u8 = [_]u8{0xFF} ** 32;

        pub const Entry = struct {
            hash: [32]u8 = empty_hash,
            value: V = undefined,

            pub fn isEmpty(self: Entry) bool {
                return cmp(self.hash, empty_hash) == .eq;
            }

            pub fn format(self: Entry, comptime layout: []const u8, options: std.fmt.FormatOptions, writer: anytype) !void {
                _ = layout;
                _ = options;
                try std.fmt.format(writer, "(hash: {}, value: {})", .{ std.fmt.fmtSliceHexLower(mem.asBytes(&self.hash)), self.value });
            }
        };

        const Self = @This();

        entries: [*]Entry,
        len: usize = 0,
        shift: u6,

        // put_probe_count: usize = 0,
        // get_probe_count: usize = 0,
        // del_probe_count: usize = 0,

        pub fn init(gpa: mem.Allocator) !Self {
            return Self.initCapacity(gpa, 16);
        }

        pub fn initCapacity(gpa: mem.Allocator, capacity: u64) !Self {
            assert(math.isPowerOfTwo(capacity));

            const shift = 63 - math.log2_int(u64, capacity) + 1;
            const overflow = capacity / 10 + (63 - @as(u64, shift) + 1) << 1;

            const entries = try gpa.alloc(Entry, @as(usize, @intCast(capacity + overflow)));
            @memset(entries, Entry{});

            return Self{
                .entries = entries.ptr,
                .shift = shift,
            };
        }

        pub fn deinit(self: *Self, gpa: mem.Allocator) void {
            gpa.free(self.slice());
        }

        /// The following routine has its branches optimized against inputs that are cryptographic hashes by
        /// assuming that if the first 64 bits of 'a' and 'b' are equivalent, then 'a' and 'b' are most likely
        /// equivalent.
        fn cmp(a: [32]u8, b: [32]u8) math.Order {
            const msa = @as(u64, @bitCast(a[0..8].*));
            const msb = @as(u64, @bitCast(b[0..8].*));
            if (msa != msb) {
                return if (mem.bigToNative(u64, msa) < mem.bigToNative(u64, msb)) .lt else .gt;
            } else if (@reduce(.And, @as(@Vector(32, u8), a) == @as(@Vector(32, u8), b))) {
                return .eq;
            } else {
                switch (math.order(mem.readIntBig(u64, a[8..16]), mem.readIntBig(u64, b[8..16]))) {
                    .eq => {},
                    .lt => return .lt,
                    .gt => return .gt,
                }
                switch (math.order(mem.readIntBig(u64, a[16..24]), mem.readIntBig(u64, b[16..24]))) {
                    .eq => {},
                    .lt => return .lt,
                    .gt => return .gt,
                }
                return math.order(mem.readIntBig(u64, a[24..32]), mem.readIntBig(u64, b[24..32]));
            }
        }

        /// In release-fast mode, LLVM will optimize this routine to utilize 109 cycles. This routine scatters
        /// hash values across a table into buckets which are lexicographically ordered from one another in
        /// ascending order.
        fn idx(a: [32]u8, shift: u6) usize {
            return @as(usize, @intCast(mem.readIntBig(u64, a[0..8]) >> shift));
        }

        pub fn clearRetainingCapacity(self: *Self) void {
            @memset(self.slice(), Entry{});
            self.len = 0;
        }

        pub fn slice(self: *Self) []Entry {
            const capacity = @as(u64, 1) << (63 - self.shift + 1);
            const overflow = capacity / 10 + (63 - @as(usize, self.shift) + 1) << 1;
            return self.entries[0..@as(usize, @intCast(capacity + overflow))];
        }

        pub fn ensureUnusedCapacity(self: *Self, gpa: mem.Allocator, count: usize) !void {
            try self.ensureTotalCapacity(gpa, self.len + count);
        }

        pub fn ensureTotalCapacity(self: *Self, gpa: mem.Allocator, count: usize) !void {
            while (true) {
                const capacity = @as(u64, 1) << (63 - self.shift + 1);
                if (count <= capacity * max_load_percentage / 100) {
                    break;
                }
                try self.grow(gpa);
            }
        }

        fn grow(self: *Self, gpa: mem.Allocator) !void {
            const capacity = @as(u64, 1) << (63 - self.shift + 1);
            const overflow = capacity / 10 + (63 - @as(usize, self.shift) + 1) << 1;
            const end = self.entries + @as(usize, @intCast(capacity + overflow));

            const map = try Self.initCapacity(gpa, @as(usize, @intCast(capacity * 2)));
            var src = self.entries;
            var dst = map.entries;

            while (src != end) {
                const entry = src[0];

                const i = if (!entry.isEmpty()) idx(entry.hash, map.shift) else 0;
                const p = map.entries + i;

                dst = if (@intFromPtr(p) >= @intFromPtr(dst)) p else dst;
                dst[0] = entry;

                src += 1;
                dst += 1;
            }

            self.deinit(gpa);
            self.entries = map.entries;
            self.shift = map.shift;
        }

        pub fn put(self: *Self, gpa: mem.Allocator, key: [32]u8, value: V) !void {
            try self.ensureUnusedCapacity(gpa, 1);
            self.putAssumeCapacity(key, value);
        }

        pub fn putAssumeCapacity(self: *Self, key: [32]u8, value: V) void {
            const result = self.getOrPutAssumeCapacity(key);
            if (!result.found_existing) result.value_ptr.* = value;
        }

        pub const GetOrPutResult = struct {
            value_ptr: *V,
            found_existing: bool,
        };

        pub fn getOrPut(self: *Self, gpa: mem.Allocator, key: [32]u8) !GetOrPutResult {
            try self.ensureUnusedCapacity(gpa, 1);
            return self.getOrPutAssumeCapacity(key);
        }

        pub fn getOrPutAssumeCapacity(self: *Self, key: [32]u8) GetOrPutResult {
            assert(self.len < (@as(u64, 1) << (63 - self.shift + 1)));
            assert(cmp(key, empty_hash) != .eq);

            var it: Entry = .{ .hash = key, .value = undefined };
            var i = idx(key, self.shift);

            var inserted_at: ?usize = null;
            while (true) : (i += 1) {
                const entry = self.entries[i];
                if (cmp(entry.hash, it.hash).compare(.gte)) {
                    if (cmp(entry.hash, key) == .eq) {
                        return .{ .found_existing = true, .value_ptr = &self.entries[i].value };
                    }
                    self.entries[i] = it;
                    if (entry.isEmpty()) {
                        self.len += 1;
                        return .{ .found_existing = false, .value_ptr = &self.entries[inserted_at orelse i].value };
                    }
                    if (inserted_at == null) {
                        inserted_at = i;
                    }
                    it = entry;
                }
                self.put_probe_count += 1;
            }
        }

        pub fn get(self: *Self, key: [32]u8) ?V {
            assert(cmp(key, empty_hash) != .eq);

            for (self.entries[idx(key, self.shift)..]) |entry| {
                if (cmp(entry.hash, key).compare(.gte)) {
                    if (cmp(entry.hash, key) != .eq) {
                        return null;
                    }
                    return entry.value;
                }
                // self.get_probe_count += 1;
            }
        }

        pub fn delete(self: *Self, key: [32]u8) ?V {
            assert(cmp(key, empty_hash) != .eq);

            var i = idx(key, self.shift);
            while (true) : (i += 1) {
                const entry = self.entries[i];
                if (cmp(entry.hash, key).compare(.gte)) {
                    if (cmp(entry.hash, key) != .eq) {
                        return null;
                    }
                    break;
                }
                self.del_probe_count += 1;
            }

            const value = self.entries[i].value;

            while (true) : (i += 1) {
                const j = idx(self.entries[i + 1].hash, self.shift);
                if (i < j or self.entries[i + 1].isEmpty()) {
                    break;
                }
                self.entries[i] = self.entries[i + 1];
                self.del_probe_count += 1;
            }
            self.entries[i] = .{};
            self.len -= 1;

            return value;
        }
    };
}

test "StaticHashMap: put, get, delete, grow" {
    var map: AutoStaticHashMap(usize, usize, 512) = .{};

    for (0..128) |seed| {
        var rng = std.rand.DefaultPrng.init(seed);

        const keys = try testing.allocator.alloc(usize, 512);
        defer testing.allocator.free(keys);

        for (keys) |*key| key.* = @as(usize, rng.next());

        try testing.expectEqual(@as(u6, 55), map.shift);

        for (keys, 0..) |key, i| map.putAssumeCapacity(key, i);
        try testing.expectEqual(keys.len, map.len);

        var it: usize = 0;
        for (map.slice()) |entry| {
            if (!entry.isEmpty()) {
                if (it > entry.hash) {
                    return error.Unsorted;
                }
                it = entry.hash;
            }
        }

        for (keys, 0..) |key, i| try testing.expectEqual(i, map.get(key).?);
        for (keys, 0..) |key, i| try testing.expectEqual(i, map.delete(key).?);
    }
}

test "HashMap: put, get, delete, grow" {
    for (0..128) |seed| {
        var rng = std.rand.DefaultPrng.init(seed);

        const keys = try testing.allocator.alloc(usize, 512);
        defer testing.allocator.free(keys);

        for (keys) |*key| key.* = rng.next();

        var map = try AutoHashMap(usize, usize, 50).initCapacity(testing.allocator, 16);
        defer map.deinit(testing.allocator);

        try testing.expectEqual(@as(u6, 60), map.shift);

        for (keys, 0..) |key, i| try map.put(testing.allocator, key, i);

        try testing.expectEqual(@as(u6, 54), map.shift);
        try testing.expectEqual(keys.len, map.len);

        var it: usize = 0;
        for (map.slice()) |entry| {
            if (!entry.isEmpty()) {
                if (it > entry.hash) {
                    return error.Unsorted;
                }
                it = entry.hash;
            }
        }

        for (keys, 0..) |key, i| try testing.expectEqual(i, map.get(key).?);
        for (keys, 0..) |key, i| try testing.expectEqual(i, map.delete(key).?);
    }
}

test "SortedHashMap: cmp" {
    const prefix = [_]u8{'0'} ** 8 ++ [_]u8{'1'} ** 23;
    const a = prefix ++ [_]u8{0};
    const b = prefix ++ [_]u8{1};

    try testing.expect(SortedHashMap(void, 100).cmp(a, b) == .lt);
    try testing.expect(SortedHashMap(void, 100).cmp(b, a) == .gt);
    try testing.expect(SortedHashMap(void, 100).cmp(a, a) == .eq);
    try testing.expect(SortedHashMap(void, 100).cmp(b, b) == .eq);
    try testing.expect(SortedHashMap(void, 100).cmp([_]u8{'i'} ++ [_]u8{'0'} ** 31, [_]u8{'o'} ++ [_]u8{'0'} ** 31) == .lt);
    try testing.expect(SortedHashMap(void, 100).cmp([_]u8{ 'h', 'i' } ++ [_]u8{'0'} ** 30, [_]u8{ 'h', 'o' } ++ [_]u8{'0'} ** 30) == .lt);
}

test "SortedHashMap: put, get, delete, grow" {
    for (0..128) |seed| {
        var rng = std.rand.DefaultPrng.init(seed);

        const keys = try testing.allocator.alloc([32]u8, 512);
        defer testing.allocator.free(keys);

        for (keys) |*key| rng.fill(key);

        var map = try SortedHashMap(usize, 50).initCapacity(testing.allocator, 16);
        defer map.deinit(testing.allocator);

        try testing.expectEqual(@as(u6, 60), map.shift);

        for (keys, 0..) |key, i| try map.put(testing.allocator, key, i);

        try testing.expectEqual(@as(u6, 54), map.shift);
        try testing.expectEqual(keys.len, map.len);

        var it = [_]u8{0} ** 32;
        for (map.slice()) |entry| {
            if (!entry.isEmpty()) {
                if (!mem.order(u8, &it, &entry.hash).compare(.lte)) {
                    return error.Unsorted;
                }
                it = entry.hash;
            }
        }

        for (keys, 0..) |key, i| try testing.expectEqual(i, map.get(key).?);
        for (keys, 0..) |key, i| try testing.expectEqual(i, map.delete(key).?);
    }
}

test "SortedHashMap: collision test" {
    const prefix = [_]u8{22} ** 8 ++ [_]u8{1} ** 23;

    var map = try SortedHashMap(usize, 100).initCapacity(testing.allocator, 4);
    defer map.deinit(testing.allocator);

    try map.put(testing.allocator, prefix ++ [_]u8{0}, 0);
    try map.put(testing.allocator, prefix ++ [_]u8{1}, 1);
    try map.put(testing.allocator, prefix ++ [_]u8{2}, 2);
    try map.put(testing.allocator, prefix ++ [_]u8{3}, 3);

    var it = [_]u8{0} ** 32;
    for (map.slice()) |entry| {
        if (!entry.isEmpty()) {
            if (!mem.order(u8, &it, &entry.hash).compare(.lte)) {
                return error.Unsorted;
            }
            it = entry.hash;
        }
    }

    try testing.expectEqual(@as(usize, 0), map.get(prefix ++ [_]u8{0}).?);
    try testing.expectEqual(@as(usize, 1), map.get(prefix ++ [_]u8{1}).?);
    try testing.expectEqual(@as(usize, 2), map.get(prefix ++ [_]u8{2}).?);
    try testing.expectEqual(@as(usize, 3), map.get(prefix ++ [_]u8{3}).?);

    try testing.expectEqual(@as(usize, 2), map.delete(prefix ++ [_]u8{2}).?);
    try testing.expectEqual(@as(usize, 0), map.delete(prefix ++ [_]u8{0}).?);
    try testing.expectEqual(@as(usize, 1), map.delete(prefix ++ [_]u8{1}).?);
    try testing.expectEqual(@as(usize, 3), map.delete(prefix ++ [_]u8{3}).?);

    try map.put(testing.allocator, prefix ++ [_]u8{0}, 0);
    try map.put(testing.allocator, prefix ++ [_]u8{2}, 2);
    try map.put(testing.allocator, prefix ++ [_]u8{3}, 3);
    try map.put(testing.allocator, prefix ++ [_]u8{1}, 1);

    it = [_]u8{0} ** 32;
    for (map.slice()) |entry| {
        if (!entry.isEmpty()) {
            if (!mem.order(u8, &it, &entry.hash).compare(.lte)) {
                return error.Unsorted;
            }
            it = entry.hash;
        }
    }

    try testing.expectEqual(@as(usize, 0), map.delete(prefix ++ [_]u8{0}).?);
    try testing.expectEqual(@as(usize, 1), map.delete(prefix ++ [_]u8{1}).?);
    try testing.expectEqual(@as(usize, 2), map.delete(prefix ++ [_]u8{2}).?);
    try testing.expectEqual(@as(usize, 3), map.delete(prefix ++ [_]u8{3}).?);

    try map.put(testing.allocator, prefix ++ [_]u8{0}, 0);
    try map.put(testing.allocator, prefix ++ [_]u8{2}, 2);
    try map.put(testing.allocator, prefix ++ [_]u8{1}, 1);
    try map.put(testing.allocator, prefix ++ [_]u8{3}, 3);

    it = [_]u8{0} ** 32;
    for (map.slice()) |entry| {
        if (!entry.isEmpty()) {
            if (!mem.order(u8, &it, &entry.hash).compare(.lte)) {
                return error.Unsorted;
            }
            it = entry.hash;
        }
    }

    try testing.expectEqual(@as(usize, 3), map.delete(prefix ++ [_]u8{3}).?);
    try testing.expectEqual(@as(usize, 2), map.delete(prefix ++ [_]u8{2}).?);
    try testing.expectEqual(@as(usize, 1), map.delete(prefix ++ [_]u8{1}).?);
    try testing.expectEqual(@as(usize, 0), map.delete(prefix ++ [_]u8{0}).?);

    try map.put(testing.allocator, prefix ++ [_]u8{3}, 3);
    try map.put(testing.allocator, prefix ++ [_]u8{0}, 0);
    try map.put(testing.allocator, prefix ++ [_]u8{1}, 1);
    try map.put(testing.allocator, prefix ++ [_]u8{2}, 2);

    it = [_]u8{0} ** 32;
    for (map.slice()) |entry| {
        if (!entry.isEmpty()) {
            if (!mem.order(u8, &it, &entry.hash).compare(.lte)) {
                return error.Unsorted;
            }
            it = entry.hash;
        }
    }

    try testing.expectEqual(@as(usize, 3), map.delete(prefix ++ [_]u8{3}).?);
    try testing.expectEqual(@as(usize, 0), map.delete(prefix ++ [_]u8{0}).?);
    try testing.expectEqual(@as(usize, 1), map.delete(prefix ++ [_]u8{1}).?);
    try testing.expectEqual(@as(usize, 2), map.delete(prefix ++ [_]u8{2}).?);
}
