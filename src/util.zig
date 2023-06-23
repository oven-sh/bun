// Things that maybe should go in Zig standard library at some point
const std = @import("std");
const bun = @import("root").bun;

pub fn Key(comptime Map: type) type {
    return FieldType(Map.KV, "key").?;
}

pub fn Value(comptime Map: type) type {
    return FieldType(Map.KV, "value").?;
}

pub fn fromEntries(
    comptime Map: type,
    allocator: std.mem.Allocator,
    comptime EntryType: type,
    entries: EntryType,
) !Map {
    var map: Map = undefined;
    if (@hasField(Map, "allocator")) {
        map = Map.init(allocator);
    } else {
        map = Map{};
    }

    if (comptime std.meta.trait.isIndexable(EntryType)) {
        if (comptime !needsAllocator(Map.ensureUnusedCapacity)) {
            try map.ensureUnusedCapacity(entries.len);
        } else {
            try map.ensureUnusedCapacity(allocator, entries.len);
        }

        comptime var i: usize = 0;

        inline while (i < std.meta.fields(EntryType).len) : (i += 1) {
            map.putAssumeCapacity(entries[i].@"0", entries[i].@"1");
        }

        return map;
    } else if (comptime std.meta.trait.isContainer(EntryType) and @hasDecl(EntryType, "count")) {
        if (comptime !needsAllocator(Map.ensureUnusedCapacity)) {
            try map.ensureUnusedCapacity(entries.count());
        } else {
            try map.ensureUnusedCapacity(allocator, entries.count());
        }

        if (comptime @hasDecl(EntryType, "iterator")) {
            var iter = entries.iterator();
            while (iter.next()) |entry| {
                map.putAssumeCapacity(entry.@"0", entry.@"1");
            }

            return map;
        }
    } else if (comptime std.meta.trait.isContainer(EntryType) and std.meta.fields(EntryType).len > 0) {
        if (comptime !needsAllocator(Map.ensureUnusedCapacity)) {
            try map.ensureUnusedCapacity(std.meta.fields(EntryType).len);
        } else {
            try map.ensureUnusedCapacity(allocator, std.meta.fields(EntryType).len);
        }

        inline for (comptime std.meta.fieldNames(@TypeOf(EntryType))) |entry| {
            map.putAssumeCapacity(entry.@"0", entry.@"1");
        }

        return map;
    } else if (comptime std.meta.trait.isConstPtr(EntryType) and std.meta.fields(std.meta.Child(EntryType)).len > 0) {
        if (comptime !needsAllocator(Map.ensureUnusedCapacity)) {
            try map.ensureUnusedCapacity(std.meta.fields(std.meta.Child(EntryType)).len);
        } else {
            try map.ensureUnusedCapacity(allocator, std.meta.fields(std.meta.Child(EntryType)).len);
        }

        comptime var i: usize = 0;

        inline while (i < std.meta.fields(std.meta.Child(EntryType)).len) : (i += 1) {
            map.putAssumeCapacity(entries.*[i].@"0", entries.*[i].@"1");
        }

        return map;
    }

    @compileError("Cannot construct Map from entries of type " ++ @typeName(EntryType));
}

pub fn fromMapLike(
    comptime Map: type,
    allocator: std.mem.Allocator,
    entries: anytype,
) !Map {
    var map: Map = undefined;
    if (comptime @hasField(Map, "allocator")) {
        map = Map.init(allocator);
    } else {
        map = Map{};
    }

    try map.ensureUnusedCapacity(entries.count());

    var iter = entries.iterator();
    while (iter.next()) |entry| {
        map.putAssumeCapacityNoClobber(entry.key_ptr.*, entry.value_ptr.*);
    }

    return map;
}

pub fn FieldType(comptime Map: type, comptime name: []const u8) ?type {
    const i = std.meta.fieldIndex(Map, name) orelse return null;
    const field = std.meta.fields(Map)[i];
    return field.field_type;
}

pub fn Of(comptime ArrayLike: type) type {
    if (std.meta.trait.isSlice(ArrayLike)) {
        return std.meta.Child(ArrayLike);
    }

    if (comptime @hasDecl(ArrayLike, "Elem")) {
        return ArrayLike.Elem;
    }

    if (comptime @hasField(ArrayLike, "items")) {
        return std.meta.Child(FieldType(ArrayLike, "items").?);
    }

    if (comptime @hasField(ArrayLike, "ptr")) {
        return std.meta.Child(FieldType(ArrayLike, "ptr").?);
    }

    @compileError("Cannot infer type within " ++ @typeName(ArrayLike));
}

pub inline fn from(
    comptime Array: type,
    allocator: std.mem.Allocator,
    default: anytype,
) !Array {
    const DefaultType = @TypeOf(default);
    if (comptime std.meta.trait.isSlice(DefaultType)) {
        return fromSlice(Array, allocator, DefaultType, default);
    }

    if (comptime std.meta.trait.isContainer(DefaultType)) {
        if (comptime std.meta.trait.isContainer(Array) and @hasDecl(DefaultType, "put")) {
            return fromMapLike(Array, allocator, default);
        }

        if (comptime @hasField(DefaultType, "items")) {
            if (Of(FieldType(DefaultType, "items").?) == Of(Array)) {
                return fromSlice(Array, allocator, @TypeOf(default.items), default.items);
            }
        }
    }

    if (comptime std.meta.trait.isContainer(Array) and @hasDecl(Array, "put")) {
        if (comptime std.meta.trait.isConstPtr(DefaultType) and std.meta.fields(std.meta.Child(DefaultType)).len > 0) {
            return fromEntries(Array, allocator, @TypeOf(default.*), default.*);
        }
        return fromEntries(Array, allocator, DefaultType, default);
    }

    if (comptime @typeInfo(DefaultType) == .Struct) {
        return fromSlice(Array, allocator, DefaultType, default);
    }

    if (comptime @typeInfo(DefaultType) == .Array) {
        return fromSlice(Array, allocator, []const Of(Array), @as([]const Of(Array), &default));
    }

    return fromSlice(Array, allocator, []const Of(Array), @as([]const Of(Array), default));
}

pub fn concat(
    comptime T: type,
    dest: []T,
    src: []const []const T,
) void {
    var remain = dest;
    for (src) |group| {
        bun.copy(T, remain[0..group.len], group);
        remain = remain[group.len..];
    }
}

pub fn fromSlice(
    comptime Array: type,
    allocator: std.mem.Allocator,
    comptime DefaultType: type,
    default: DefaultType,
) !Array {
    var map: Array = undefined;
    if (comptime std.meta.trait.isSlice(Array)) {} else if (comptime @hasField(Array, "allocator")) {
        map = Array.init(allocator);
    } else {
        map = Array{};
    }

    // is it a MultiArrayList?
    if (comptime !std.meta.trait.isSlice(Array) and @hasField(Array, "bytes")) {
        try map.ensureUnusedCapacity(allocator, default.len);
        for (default) |elem| {
            map.appendAssumeCapacity(elem);
        }

        return map;
    } else {
        var slice: []Of(Array) = undefined;
        if (comptime !std.meta.trait.isSlice(Array)) {
            // is it an ArrayList with an allocator?
            if (comptime !needsAllocator(Array.ensureUnusedCapacity)) {
                try map.ensureUnusedCapacity(default.len);
                // is it an ArrayList without an allocator?
            } else {
                try map.ensureUnusedCapacity(allocator, default.len);
            }
            if (comptime @hasField(Array, "items")) {
                map.items.len = default.len;
                slice = map.items;
            } else if (comptime @hasField(Array, "len")) {
                map.len = @intCast(u32, default.len);
                slice = map.slice();
            } else {
                @compileError("Cannot set length of " ++ @typeName(Array));
            }
        } else if (comptime std.meta.trait.isSlice(Array)) {
            slice = try allocator.alloc(Of(Array), default.len);
        } else if (comptime @hasField(map, "ptr")) {
            slice = try allocator.alloc(Of(Array), default.len);
            map = .{
                .ptr = slice.ptr,
                .len = @truncate(u32, default.len),
                .cap = @truncate(u32, default.len),
            };
        }

        if (comptime std.meta.trait.isIndexable(DefaultType) and (std.meta.trait.isSlice(DefaultType) or std.meta.trait.is(.Array)(DefaultType))) {
            var in = std.mem.sliceAsBytes(default);
            var out = std.mem.sliceAsBytes(slice);
            @memcpy(out[0..in.len], in);
        } else {
            @compileError("Needs a more specific type to copy from");
        }

        if (comptime std.meta.trait.isSlice(Array)) {
            return @as(Array, slice);
        }

        return map;
    }
}

/// Say you need to allocate a bunch of tiny arrays
/// You could just do separate allocations for each, but that is slow
/// With std.ArrayList, pointers invalidate on resize and that means it will crash.
/// So a better idea is to batch up your allocations into one larger allocation
/// and then just make all the arrays point to different parts of the larger allocation
pub fn Batcher(comptime Type: type) type {
    return struct {
        head: []Type,

        pub fn init(allocator: std.mem.Allocator, count: usize) !@This() {
            var all = try allocator.alloc(Type, count);
            return @This(){ .head = all };
        }

        pub inline fn done(this: *@This()) void {
            std.debug.assert(this.head.len == 0);
        }

        pub inline fn eat(this: *@This(), value: Type) *Type {
            return @ptrCast(*Type, &this.head.eat1(value).ptr);
        }

        pub inline fn eat1(this: *@This(), value: Type) []Type {
            var prev = this.head[0..1];
            prev[0] = value;
            this.head = this.head[1..];
            return prev;
        }

        pub inline fn next(this: *@This(), values: anytype) []Type {
            this.head[0..values.len].* = values;
            var prev = this.head[0..values.len];
            this.head = this.head[values.len..];
            return prev;
        }
    };
}

test "fromEntries" {
    const values = try from(std.AutoHashMap(u32, u32), std.heap.page_allocator, .{
        .{ 123, 456 },
        .{ 789, 101112 },
    });
    const mapToMap = try from(std.AutoHashMap(u32, u32), std.heap.page_allocator, values);
    try std.testing.expectEqual(values.get(123).?, 456);
    try std.testing.expectEqual(values.get(789).?, 101112);
    try std.testing.expectEqual(mapToMap.get(123).?, 456);
    try std.testing.expectEqual(mapToMap.get(789).?, 101112);
}

test "from" {
    const values = try from(
        []const u32,
        std.heap.page_allocator,
        &.{ 1, 2, 3, 4, 5, 6 },
    );
    try std.testing.expectEqualSlices(u32, &.{ 1, 2, 3, 4, 5, 6 }, values);
}

test "from arraylist" {
    const values = try from(
        std.ArrayList(u32),
        std.heap.page_allocator,
        &.{ 1, 2, 3, 4, 5, 6 },
    );
    try std.testing.expectEqualSlices(u32, &.{ 1, 2, 3, 4, 5, 6 }, values.items);

    const cloned = try from(
        std.ArrayListUnmanaged(u32),
        std.heap.page_allocator,
        values,
    );

    try std.testing.expectEqualSlices(u32, &.{ 1, 2, 3, 4, 5, 6 }, cloned.items);
}

test "from arraylist with struct" {
    const Entry = std.meta.Tuple(&.{ u32, u32 });
    const values = try from(
        std.ArrayList(Entry),
        std.heap.page_allocator,
        &.{ Entry{ 123, 456 }, Entry{ 123, 456 }, Entry{ 123, 456 }, Entry{ 123, 456 } },
    );
    try std.testing.expectEqualSlices(Entry, &[_]Entry{ .{ 123, 456 }, .{ 123, 456 }, .{ 123, 456 }, .{ 123, 456 } }, values.items);
}

fn needsAllocator(comptime Fn: anytype) bool {
    return std.meta.fields(std.meta.ArgsTuple(@TypeOf(Fn))).len > 2;
}
