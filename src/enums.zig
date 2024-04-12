// This is a copy-paste of the same file from Zig's standard library.
// This exists mostly as a workaround for https://github.com/ziglang/zig/issues/16980

const std = @import("std");
const assert = @import("root").bun.assert;
const testing = std.testing;
const EnumField = std.builtin.Type.EnumField;

/// Returns a struct with a field matching each unique named enum element.
/// If the enum is extern and has multiple names for the same value, only
/// the first name is used.  Each field is of type Data and has the provided
/// default, which may be undefined.
pub fn EnumFieldStruct(comptime E: type, comptime Data: type, comptime field_default: ?Data) type {
    const StructField = std.builtin.Type.StructField;
    var fields: []const StructField = &[_]StructField{};
    for (std.meta.fields(E)) |field| {
        fields = fields ++ &[_]StructField{.{
            .name = field.name,
            .type = Data,
            .default_value = if (field_default) |d| @as(?*const anyopaque, @ptrCast(&d)) else null,
            .is_comptime = false,
            .alignment = if (@sizeOf(Data) > 0) @alignOf(Data) else 0,
        }};
    }
    return @Type(.{ .Struct = .{
        .layout = .Auto,
        .fields = fields,
        .decls = &.{},
        .is_tuple = false,
    } });
}

/// Looks up the supplied fields in the given enum type.
/// Uses only the field names, field values are ignored.
/// The result array is in the same order as the input.
pub inline fn valuesFromFields(comptime E: type, comptime fields: []const EnumField) []const E {
    comptime {
        var result: [fields.len]E = undefined;
        for (fields, 0..) |f, i| {
            result[i] = @field(E, f.name);
        }
        return &result;
    }
}

/// Returns the set of all named values in the given enum, in
/// declaration order.
pub fn values(comptime E: type) []const E {
    return comptime valuesFromFields(E, @typeInfo(E).Enum.fields);
}

/// A safe alternative to @tagName() for non-exhaustive enums that doesn't
/// panic when `e` has no tagged value.
/// Returns the tag name for `e` or null if no tag exists.
pub fn tagName(comptime E: type, e: E) ?[]const u8 {
    return inline for (@typeInfo(E).Enum.fields) |f| {
        if (@intFromEnum(e) == f.value) break f.name;
    } else null;
}

test tagName {
    const E = enum(u8) { a, b, _ };
    try testing.expect(tagName(E, .a) != null);
    try testing.expectEqualStrings("a", tagName(E, .a).?);
    try testing.expect(tagName(E, @as(E, @enumFromInt(42))) == null);
}

/// Determines the length of a direct-mapped enum array, indexed by
/// @intCast(usize, @intFromEnum(enum_value)).
/// If the enum is non-exhaustive, the resulting length will only be enough
/// to hold all explicit fields.
/// If the enum contains any fields with values that cannot be represented
/// by usize, a compile error is issued.  The max_unused_slots parameter limits
/// the total number of items which have no matching enum key (holes in the enum
/// numbering).  So for example, if an enum has values 1, 2, 5, and 6, max_unused_slots
/// must be at least 3, to allow unused slots 0, 3, and 4.
pub fn directEnumArrayLen(comptime E: type, comptime max_unused_slots: comptime_int) comptime_int {
    var max_value: comptime_int = -1;
    const max_usize: comptime_int = ~@as(usize, 0);
    const fields = std.meta.fields(E);
    for (fields) |f| {
        if (f.value < 0) {
            @compileError("Cannot create a direct enum array for " ++ @typeName(E) ++ ", field ." ++ f.name ++ " has a negative value.");
        }
        if (f.value > max_value) {
            if (f.value > max_usize) {
                @compileError("Cannot create a direct enum array for " ++ @typeName(E) ++ ", field ." ++ f.name ++ " is larger than the max value of usize.");
            }
            max_value = f.value;
        }
    }

    const unused_slots = max_value + 1 - fields.len;
    if (unused_slots > max_unused_slots) {
        const unused_str = std.fmt.comptimePrint("{d}", .{unused_slots});
        const allowed_str = std.fmt.comptimePrint("{d}", .{max_unused_slots});
        @compileError("Cannot create a direct enum array for " ++ @typeName(E) ++ ". It would have " ++ unused_str ++ " unused slots, but only " ++ allowed_str ++ " are allowed.");
    }

    return max_value + 1;
}

/// Initializes an array of Data which can be indexed by
/// @intCast(usize, @intFromEnum(enum_value)).
/// If the enum is non-exhaustive, the resulting array will only be large enough
/// to hold all explicit fields.
/// If the enum contains any fields with values that cannot be represented
/// by usize, a compile error is issued.  The max_unused_slots parameter limits
/// the total number of items which have no matching enum key (holes in the enum
/// numbering).  So for example, if an enum has values 1, 2, 5, and 6, max_unused_slots
/// must be at least 3, to allow unused slots 0, 3, and 4.
/// The init_values parameter must be a struct with field names that match the enum values.
/// If the enum has multiple fields with the same value, the name of the first one must
/// be used.
pub fn directEnumArray(
    comptime E: type,
    comptime Data: type,
    comptime max_unused_slots: comptime_int,
    init_values: EnumFieldStruct(E, Data, null),
) [directEnumArrayLen(E, max_unused_slots)]Data {
    return directEnumArrayDefault(E, Data, null, max_unused_slots, init_values);
}

test "std.enums.directEnumArray" {
    const E = enum(i4) { a = 4, b = 6, c = 2 };
    const runtime_false: bool = false;
    const array = directEnumArray(E, bool, 4, .{
        .a = true,
        .b = runtime_false,
        .c = true,
    });

    try testing.expectEqual([7]bool, @TypeOf(array));
    try testing.expectEqual(true, array[4]);
    try testing.expectEqual(false, array[6]);
    try testing.expectEqual(true, array[2]);
}

/// Initializes an array of Data which can be indexed by
/// @intCast(usize, @intFromEnum(enum_value)).  The enum must be exhaustive.
/// If the enum contains any fields with values that cannot be represented
/// by usize, a compile error is issued.  The max_unused_slots parameter limits
/// the total number of items which have no matching enum key (holes in the enum
/// numbering).  So for example, if an enum has values 1, 2, 5, and 6, max_unused_slots
/// must be at least 3, to allow unused slots 0, 3, and 4.
/// The init_values parameter must be a struct with field names that match the enum values.
/// If the enum has multiple fields with the same value, the name of the first one must
/// be used.
pub fn directEnumArrayDefault(
    comptime E: type,
    comptime Data: type,
    comptime default: ?Data,
    comptime max_unused_slots: comptime_int,
    init_values: EnumFieldStruct(E, Data, default),
) [directEnumArrayLen(E, max_unused_slots)]Data {
    const len = comptime directEnumArrayLen(E, max_unused_slots);
    var result: [len]Data = if (default) |d| [_]Data{d} ** len else undefined;
    inline for (@typeInfo(@TypeOf(init_values)).Struct.fields) |f| {
        const enum_value = @field(E, f.name);
        const index = @as(usize, @intCast(@intFromEnum(enum_value)));
        result[index] = @field(init_values, f.name);
    }
    return result;
}

test "std.enums.directEnumArrayDefault" {
    const E = enum(i4) { a = 4, b = 6, c = 2 };
    const runtime_false: bool = false;
    const array = directEnumArrayDefault(E, bool, false, 4, .{
        .a = true,
        .b = runtime_false,
    });

    try testing.expectEqual([7]bool, @TypeOf(array));
    try testing.expectEqual(true, array[4]);
    try testing.expectEqual(false, array[6]);
    try testing.expectEqual(false, array[2]);
}

test "std.enums.directEnumArrayDefault slice" {
    const E = enum(i4) { a = 4, b = 6, c = 2 };
    const runtime_b = "b";
    const array = directEnumArrayDefault(E, []const u8, "default", 4, .{
        .a = "a",
        .b = runtime_b,
    });

    try testing.expectEqual([7][]const u8, @TypeOf(array));
    try testing.expectEqualSlices(u8, "a", array[4]);
    try testing.expectEqualSlices(u8, "b", array[6]);
    try testing.expectEqualSlices(u8, "default", array[2]);
}

/// Cast an enum literal, value, or string to the enum value of type E
/// with the same name.
pub fn nameCast(comptime E: type, comptime value: anytype) E {
    return comptime blk: {
        const V = @TypeOf(value);
        if (V == E) break :blk value;
        const name: ?[]const u8 = switch (@typeInfo(V)) {
            .EnumLiteral, .Enum => @tagName(value),
            .Pointer => value,
            else => null,
        };
        if (name) |n| {
            if (@hasField(E, n)) {
                break :blk @field(E, n);
            }
            @compileError("Enum " ++ @typeName(E) ++ " has no field named " ++ n);
        }
        @compileError("Cannot cast from " ++ @typeName(@TypeOf(value)) ++ " to " ++ @typeName(E));
    };
}

test "std.enums.nameCast" {
    const A = enum(u1) { a = 0, b = 1 };
    const B = enum(u1) { a = 1, b = 0 };
    try testing.expectEqual(A.a, nameCast(A, .a));
    try testing.expectEqual(A.a, nameCast(A, A.a));
    try testing.expectEqual(A.a, nameCast(A, B.a));
    try testing.expectEqual(A.a, nameCast(A, "a"));
    try testing.expectEqual(A.a, nameCast(A, @as(*const [1]u8, "a")));
    try testing.expectEqual(A.a, nameCast(A, @as([:0]const u8, "a")));
    try testing.expectEqual(A.a, nameCast(A, @as([]const u8, "a")));

    try testing.expectEqual(B.a, nameCast(B, .a));
    try testing.expectEqual(B.a, nameCast(B, A.a));
    try testing.expectEqual(B.a, nameCast(B, B.a));
    try testing.expectEqual(B.a, nameCast(B, "a"));

    try testing.expectEqual(B.b, nameCast(B, .b));
    try testing.expectEqual(B.b, nameCast(B, A.b));
    try testing.expectEqual(B.b, nameCast(B, B.b));
    try testing.expectEqual(B.b, nameCast(B, "b"));
}

/// A set of enum elements, backed by a bitfield.  If the enum
/// is not dense, a mapping will be constructed from enum values
/// to dense indices.  This type does no dynamic allocation and
/// can be copied by value.
pub fn EnumSet(comptime E: type) type {
    const mixin = struct {
        fn EnumSetExt(comptime Self: type) type {
            const Indexer = Self.Indexer;
            return struct {
                /// Initializes the set using a struct of bools
                pub fn init(init_values: EnumFieldStruct(E, bool, false)) Self {
                    var result = Self{};
                    inline for (0..Self.len) |i| {
                        const key = comptime Indexer.keyForIndex(i);
                        const tag = comptime @tagName(key);
                        if (@field(init_values, tag)) {
                            result.bits.set(i);
                        }
                    }
                    return result;
                }
            };
        }
    };
    return IndexedSet(EnumIndexer(E), mixin.EnumSetExt);
}

/// A map keyed by an enum, backed by a bitfield and a dense array.
/// If the enum is not dense, a mapping will be constructed from
/// enum values to dense indices.  This type does no dynamic
/// allocation and can be copied by value.
pub fn EnumMap(comptime E: type, comptime V: type) type {
    const mixin = struct {
        fn EnumMapExt(comptime Self: type) type {
            const Indexer = Self.Indexer;
            return struct {
                /// Initializes the map using a sparse struct of optionals
                pub fn init(init_values: EnumFieldStruct(E, ?V, @as(?V, null))) Self {
                    var result = Self{};
                    inline for (0..Self.len) |i| {
                        const key = comptime Indexer.keyForIndex(i);
                        const tag = comptime @tagName(key);
                        if (@field(init_values, tag)) |*v| {
                            result.bits.set(i);
                            result.values[i] = v.*;
                        }
                    }
                    return result;
                }
                /// Initializes a full mapping with all keys set to value.
                /// Consider using EnumArray instead if the map will remain full.
                pub fn initFull(value: V) Self {
                    var result = Self{
                        .bits = Self.BitSet.initFull(),
                        .values = undefined,
                    };
                    @memset(&result.values, value);
                    return result;
                }
                /// Initializes a full mapping with supplied values.
                /// Consider using EnumArray instead if the map will remain full.
                pub fn initFullWith(init_values: EnumFieldStruct(E, V, @as(?V, null))) Self {
                    return initFullWithDefault(@as(?V, null), init_values);
                }
                /// Initializes a full mapping with a provided default.
                /// Consider using EnumArray instead if the map will remain full.
                pub fn initFullWithDefault(comptime default: ?V, init_values: EnumFieldStruct(E, V, default)) Self {
                    var result = Self{
                        .bits = Self.BitSet.initFull(),
                        .values = undefined,
                    };
                    inline for (0..Self.len) |i| {
                        const key = comptime Indexer.keyForIndex(i);
                        const tag = comptime @tagName(key);
                        result.values[i] = @field(init_values, tag);
                    }
                    return result;
                }
            };
        }
    };
    return IndexedMap(EnumIndexer(E), V, mixin.EnumMapExt);
}

/// A multiset of enum elements up to a count of usize. Backed
/// by an EnumArray. This type does no dynamic allocation and can
/// be copied by value.
pub fn EnumMultiset(comptime E: type) type {
    return BoundedEnumMultiset(E, usize);
}

/// A multiset of enum elements up to CountSize. Backed by an
/// EnumArray. This type does no dynamic allocation and can be
/// copied by value.
pub fn BoundedEnumMultiset(comptime E: type, comptime CountSize: type) type {
    return struct {
        const Self = @This();

        counts: EnumArray(E, CountSize),

        /// Initializes the multiset using a struct of counts.
        pub fn init(init_counts: EnumFieldStruct(E, CountSize, 0)) Self {
            var self = initWithCount(0);
            inline for (@typeInfo(E).Enum.fields) |field| {
                const c = @field(init_counts, field.name);
                const key = @as(E, @enumFromInt(field.value));
                self.counts.set(key, c);
            }
            return self;
        }

        /// Initializes the multiset with a count of zero.
        pub fn initEmpty() Self {
            return initWithCount(0);
        }

        /// Initializes the multiset with all keys at the
        /// same count.
        pub fn initWithCount(comptime c: CountSize) Self {
            return .{
                .counts = EnumArray(E, CountSize).initDefault(c, .{}),
            };
        }

        /// Returns the total number of key counts in the multiset.
        pub fn count(self: Self) usize {
            var sum: usize = 0;
            for (self.counts.values) |c| {
                sum += c;
            }
            return sum;
        }

        /// Checks if at least one key in multiset.
        pub fn contains(self: Self, key: E) bool {
            return self.counts.get(key) > 0;
        }

        /// Removes all instance of a key from multiset. Same as
        /// setCount(key, 0).
        pub fn removeAll(self: *Self, key: E) void {
            return self.counts.set(key, 0);
        }

        /// Increases the key count by given amount. Caller asserts
        /// operation will not overflow.
        pub fn addAssertSafe(self: *Self, key: E, c: CountSize) void {
            self.counts.getPtr(key).* += c;
        }

        /// Increases the key count by given amount.
        pub fn add(self: *Self, key: E, c: CountSize) error{Overflow}!void {
            self.counts.set(key, try std.math.add(CountSize, self.counts.get(key), c));
        }

        /// Decreases the key count by given amount. If amount is
        /// greater than the number of keys in multset, then key count
        /// will be set to zero.
        pub fn remove(self: *Self, key: E, c: CountSize) void {
            self.counts.getPtr(key).* -= @min(self.getCount(key), c);
        }

        /// Returns the count for a key.
        pub fn getCount(self: Self, key: E) CountSize {
            return self.counts.get(key);
        }

        /// Set the count for a key.
        pub fn setCount(self: *Self, key: E, c: CountSize) void {
            self.counts.set(key, c);
        }

        /// Increases the all key counts by given multiset. Caller
        /// asserts operation will not overflow any key.
        pub fn addSetAssertSafe(self: *Self, other: Self) void {
            inline for (@typeInfo(E).Enum.fields) |field| {
                const key = @as(E, @enumFromInt(field.value));
                self.addAssertSafe(key, other.getCount(key));
            }
        }

        /// Increases the all key counts by given multiset.
        pub fn addSet(self: *Self, other: Self) error{Overflow}!void {
            inline for (@typeInfo(E).Enum.fields) |field| {
                const key = @as(E, @enumFromInt(field.value));
                try self.add(key, other.getCount(key));
            }
        }

        /// Deccreases the all key counts by given multiset. If
        /// the given multiset has more key counts than this,
        /// then that key will have a key count of zero.
        pub fn removeSet(self: *Self, other: Self) void {
            inline for (@typeInfo(E).Enum.fields) |field| {
                const key = @as(E, @enumFromInt(field.value));
                self.remove(key, other.getCount(key));
            }
        }

        /// Returns true iff all key counts are the same as
        /// given multiset.
        pub fn eql(self: Self, other: Self) bool {
            inline for (@typeInfo(E).Enum.fields) |field| {
                const key = @as(E, @enumFromInt(field.value));
                if (self.getCount(key) != other.getCount(key)) {
                    return false;
                }
            }
            return true;
        }

        /// Returns true iff all key counts less than or
        /// equal to the given multiset.
        pub fn subsetOf(self: Self, other: Self) bool {
            inline for (@typeInfo(E).Enum.fields) |field| {
                const key = @as(E, @enumFromInt(field.value));
                if (self.getCount(key) > other.getCount(key)) {
                    return false;
                }
            }
            return true;
        }

        /// Returns true iff all key counts greater than or
        /// equal to the given multiset.
        pub fn supersetOf(self: Self, other: Self) bool {
            inline for (@typeInfo(E).Enum.fields) |field| {
                const key = @as(E, @enumFromInt(field.value));
                if (self.getCount(key) < other.getCount(key)) {
                    return false;
                }
            }
            return true;
        }

        /// Returns a multiset with the total key count of this
        /// multiset and the other multiset. Caller asserts
        /// operation will not overflow any key.
        pub fn plusAssertSafe(self: Self, other: Self) Self {
            var result = self;
            result.addSetAssertSafe(other);
            return result;
        }

        /// Returns a multiset with the total key count of this
        /// multiset and the other multiset.
        pub fn plus(self: Self, other: Self) error{Overflow}!Self {
            var result = self;
            try result.addSet(other);
            return result;
        }

        /// Returns a multiset with the key count of this
        /// multiset minus the corresponding key count in the
        /// other multiset. If the other multiset contains
        /// more key count than this set, that key will have
        /// a count of zero.
        pub fn minus(self: Self, other: Self) Self {
            var result = self;
            result.removeSet(other);
            return result;
        }

        pub const Entry = EnumArray(E, CountSize).Entry;
        pub const Iterator = EnumArray(E, CountSize).Iterator;

        /// Returns an iterator over this multiset. Keys with zero
        /// counts are included. Modifications to the set during
        /// iteration may or may not be observed by the iterator,
        /// but will not invalidate it.
        pub fn iterator(self: *Self) Iterator {
            return self.counts.iterator();
        }
    };
}

test "EnumMultiset" {
    const Ball = enum { red, green, blue };

    const empty = EnumMultiset(Ball).initEmpty();
    const r0_g1_b2 = EnumMultiset(Ball).init(.{
        .red = 0,
        .green = 1,
        .blue = 2,
    });
    const ten_of_each = EnumMultiset(Ball).initWithCount(10);

    try testing.expectEqual(empty.count(), 0);
    try testing.expectEqual(r0_g1_b2.count(), 3);
    try testing.expectEqual(ten_of_each.count(), 30);

    try testing.expect(!empty.contains(.red));
    try testing.expect(!empty.contains(.green));
    try testing.expect(!empty.contains(.blue));

    try testing.expect(!r0_g1_b2.contains(.red));
    try testing.expect(r0_g1_b2.contains(.green));
    try testing.expect(r0_g1_b2.contains(.blue));

    try testing.expect(ten_of_each.contains(.red));
    try testing.expect(ten_of_each.contains(.green));
    try testing.expect(ten_of_each.contains(.blue));

    {
        var copy = ten_of_each;
        copy.removeAll(.red);
        try testing.expect(!copy.contains(.red));

        // removeAll second time does nothing
        copy.removeAll(.red);
        try testing.expect(!copy.contains(.red));
    }

    {
        var copy = ten_of_each;
        copy.addAssertSafe(.red, 6);
        try testing.expectEqual(copy.getCount(.red), 16);
    }

    {
        var copy = ten_of_each;
        try copy.add(.red, 6);
        try testing.expectEqual(copy.getCount(.red), 16);

        try testing.expectError(error.Overflow, copy.add(.red, std.math.maxInt(usize)));
    }

    {
        var copy = ten_of_each;
        copy.remove(.red, 4);
        try testing.expectEqual(copy.getCount(.red), 6);

        // subtracting more it contains does not underflow
        copy.remove(.green, 14);
        try testing.expectEqual(copy.getCount(.green), 0);
    }

    try testing.expectEqual(empty.getCount(.green), 0);
    try testing.expectEqual(r0_g1_b2.getCount(.green), 1);
    try testing.expectEqual(ten_of_each.getCount(.green), 10);

    {
        var copy = empty;
        copy.setCount(.red, 6);
        try testing.expectEqual(copy.getCount(.red), 6);
    }

    {
        var copy = r0_g1_b2;
        copy.addSetAssertSafe(ten_of_each);
        try testing.expectEqual(copy.getCount(.red), 10);
        try testing.expectEqual(copy.getCount(.green), 11);
        try testing.expectEqual(copy.getCount(.blue), 12);
    }

    {
        var copy = r0_g1_b2;
        try copy.addSet(ten_of_each);
        try testing.expectEqual(copy.getCount(.red), 10);
        try testing.expectEqual(copy.getCount(.green), 11);
        try testing.expectEqual(copy.getCount(.blue), 12);

        const full = EnumMultiset(Ball).initWithCount(std.math.maxInt(usize));
        try testing.expectError(error.Overflow, copy.addSet(full));
    }

    {
        var copy = ten_of_each;
        copy.removeSet(r0_g1_b2);
        try testing.expectEqual(copy.getCount(.red), 10);
        try testing.expectEqual(copy.getCount(.green), 9);
        try testing.expectEqual(copy.getCount(.blue), 8);

        copy.removeSet(ten_of_each);
        try testing.expectEqual(copy.getCount(.red), 0);
        try testing.expectEqual(copy.getCount(.green), 0);
        try testing.expectEqual(copy.getCount(.blue), 0);
    }

    try testing.expect(empty.eql(empty));
    try testing.expect(r0_g1_b2.eql(r0_g1_b2));
    try testing.expect(ten_of_each.eql(ten_of_each));
    try testing.expect(!empty.eql(r0_g1_b2));
    try testing.expect(!r0_g1_b2.eql(ten_of_each));
    try testing.expect(!ten_of_each.eql(empty));

    try testing.expect(empty.subsetOf(empty));
    try testing.expect(r0_g1_b2.subsetOf(r0_g1_b2));
    try testing.expect(empty.subsetOf(r0_g1_b2));
    try testing.expect(r0_g1_b2.subsetOf(ten_of_each));
    try testing.expect(!ten_of_each.subsetOf(r0_g1_b2));
    try testing.expect(!r0_g1_b2.subsetOf(empty));

    try testing.expect(empty.supersetOf(empty));
    try testing.expect(r0_g1_b2.supersetOf(r0_g1_b2));
    try testing.expect(r0_g1_b2.supersetOf(empty));
    try testing.expect(ten_of_each.supersetOf(r0_g1_b2));
    try testing.expect(!r0_g1_b2.supersetOf(ten_of_each));
    try testing.expect(!empty.supersetOf(r0_g1_b2));

    {
        // with multisets it could be the case where two
        // multisets are neither subset nor superset of each
        // other.

        const r10 = EnumMultiset(Ball).init(.{
            .red = 10,
        });
        const b10 = EnumMultiset(Ball).init(.{
            .blue = 10,
        });

        try testing.expect(!r10.subsetOf(b10));
        try testing.expect(!b10.subsetOf(r10));
        try testing.expect(!r10.supersetOf(b10));
        try testing.expect(!b10.supersetOf(r10));
    }

    {
        const result = r0_g1_b2.plusAssertSafe(ten_of_each);
        try testing.expectEqual(result.getCount(.red), 10);
        try testing.expectEqual(result.getCount(.green), 11);
        try testing.expectEqual(result.getCount(.blue), 12);
    }

    {
        const result = try r0_g1_b2.plus(ten_of_each);
        try testing.expectEqual(result.getCount(.red), 10);
        try testing.expectEqual(result.getCount(.green), 11);
        try testing.expectEqual(result.getCount(.blue), 12);

        const full = EnumMultiset(Ball).initWithCount(std.math.maxInt(usize));
        try testing.expectError(error.Overflow, result.plus(full));
    }

    {
        const result = ten_of_each.minus(r0_g1_b2);
        try testing.expectEqual(result.getCount(.red), 10);
        try testing.expectEqual(result.getCount(.green), 9);
        try testing.expectEqual(result.getCount(.blue), 8);
    }

    {
        const result = ten_of_each.minus(r0_g1_b2).minus(ten_of_each);
        try testing.expectEqual(result.getCount(.red), 0);
        try testing.expectEqual(result.getCount(.green), 0);
        try testing.expectEqual(result.getCount(.blue), 0);
    }

    {
        var copy = empty;
        var it = copy.iterator();
        var entry = it.next().?;
        try testing.expectEqual(entry.key, .red);
        try testing.expectEqual(entry.value.*, 0);
        entry = it.next().?;
        try testing.expectEqual(entry.key, .green);
        try testing.expectEqual(entry.value.*, 0);
        entry = it.next().?;
        try testing.expectEqual(entry.key, .blue);
        try testing.expectEqual(entry.value.*, 0);
        try testing.expectEqual(it.next(), null);
    }

    {
        var copy = r0_g1_b2;
        var it = copy.iterator();
        var entry = it.next().?;
        try testing.expectEqual(entry.key, .red);
        try testing.expectEqual(entry.value.*, 0);
        entry = it.next().?;
        try testing.expectEqual(entry.key, .green);
        try testing.expectEqual(entry.value.*, 1);
        entry = it.next().?;
        try testing.expectEqual(entry.key, .blue);
        try testing.expectEqual(entry.value.*, 2);
        try testing.expectEqual(it.next(), null);
    }
}

/// An array keyed by an enum, backed by a dense array.
/// If the enum is not dense, a mapping will be constructed from
/// enum values to dense indices.  This type does no dynamic
/// allocation and can be copied by value.
pub fn EnumArray(comptime E: type, comptime V: type) type {
    const mixin = struct {
        fn EnumArrayExt(comptime Self: type) type {
            const Indexer = Self.Indexer;
            return struct {
                /// Initializes all values in the enum array
                pub fn init(init_values: EnumFieldStruct(E, V, @as(?V, null))) Self {
                    return initDefault(@as(?V, null), init_values);
                }

                /// Initializes values in the enum array, with the specified default.
                pub fn initDefault(comptime default: ?V, init_values: EnumFieldStruct(E, V, default)) Self {
                    var result = Self{ .values = undefined };
                    inline for (0..Self.len) |i| {
                        const key = comptime Indexer.keyForIndex(i);
                        const tag = @tagName(key);
                        result.values[i] = @field(init_values, tag);
                    }
                    return result;
                }
            };
        }
    };
    return IndexedArray(EnumIndexer(E), V, mixin.EnumArrayExt);
}

fn NoExtension(comptime Self: type) type {
    _ = Self;
    return NoExt;
}
const NoExt = struct {};

/// A set type with an Indexer mapping from keys to indices.
/// Presence or absence is stored as a dense bitfield.  This
/// type does no allocation and can be copied by value.
pub fn IndexedSet(comptime I: type, comptime Ext: ?fn (type) type) type {
    comptime ensureIndexer(I);
    return struct {
        const Self = @This();

        pub usingnamespace (Ext orelse NoExtension)(Self);

        /// The indexing rules for converting between keys and indices.
        pub const Indexer = I;
        /// The element type for this set.
        pub const Key = Indexer.Key;

        const BitSet = std.StaticBitSet(Indexer.count);

        /// The maximum number of items in this set.
        pub const len = Indexer.count;

        bits: BitSet = BitSet.initEmpty(),

        /// Returns a set containing no keys.
        pub fn initEmpty() Self {
            return .{ .bits = BitSet.initEmpty() };
        }

        /// Returns a set containing all possible keys.
        pub fn initFull() Self {
            return .{ .bits = BitSet.initFull() };
        }

        /// Returns a set containing multiple keys.
        pub fn initMany(keys: []const Key) Self {
            var set = initEmpty();
            for (keys) |key| set.insert(key);
            return set;
        }

        /// Returns a set containing a single key.
        pub fn initOne(key: Key) Self {
            return initMany(&[_]Key{key});
        }

        /// Returns the number of keys in the set.
        pub fn count(self: Self) usize {
            return self.bits.count();
        }

        /// Checks if a key is in the set.
        pub fn contains(self: Self, key: Key) bool {
            return self.bits.isSet(Indexer.indexOf(key));
        }

        /// Puts a key in the set.
        pub fn insert(self: *Self, key: Key) void {
            self.bits.set(Indexer.indexOf(key));
        }

        /// Removes a key from the set.
        pub fn remove(self: *Self, key: Key) void {
            self.bits.unset(Indexer.indexOf(key));
        }

        /// Changes the presence of a key in the set to match the passed bool.
        pub fn setPresent(self: *Self, key: Key, present: bool) void {
            self.bits.setValue(Indexer.indexOf(key), present);
        }

        /// Toggles the presence of a key in the set.  If the key is in
        /// the set, removes it.  Otherwise adds it.
        pub fn toggle(self: *Self, key: Key) void {
            self.bits.toggle(Indexer.indexOf(key));
        }

        /// Toggles the presence of all keys in the passed set.
        pub fn toggleSet(self: *Self, other: Self) void {
            self.bits.toggleSet(other.bits);
        }

        /// Toggles all possible keys in the set.
        pub fn toggleAll(self: *Self) void {
            self.bits.toggleAll();
        }

        /// Adds all keys in the passed set to this set.
        pub fn setUnion(self: *Self, other: Self) void {
            self.bits.setUnion(other.bits);
        }

        /// Removes all keys which are not in the passed set.
        pub fn setIntersection(self: *Self, other: Self) void {
            self.bits.setIntersection(other.bits);
        }

        /// Returns true iff both sets have the same keys.
        pub fn eql(self: Self, other: Self) bool {
            return self.bits.eql(other.bits);
        }

        /// Returns true iff all the keys in this set are
        /// in the other set. The other set may have keys
        /// not found in this set.
        pub fn subsetOf(self: Self, other: Self) bool {
            return self.bits.subsetOf(other.bits);
        }

        /// Returns true iff this set contains all the keys
        /// in the other set. This set may have keys not
        /// found in the other set.
        pub fn supersetOf(self: Self, other: Self) bool {
            return self.bits.supersetOf(other.bits);
        }

        /// Returns a set with all the keys not in this set.
        pub fn complement(self: Self) Self {
            return .{ .bits = self.bits.complement() };
        }

        /// Returns a set with keys that are in either this
        /// set or the other set.
        pub fn unionWith(self: Self, other: Self) Self {
            return .{ .bits = self.bits.unionWith(other.bits) };
        }

        /// Returns a set with keys that are in both this
        /// set and the other set.
        pub fn intersectWith(self: Self, other: Self) Self {
            return .{ .bits = self.bits.intersectWith(other.bits) };
        }

        /// Returns a set with keys that are in either this
        /// set or the other set, but not both.
        pub fn xorWith(self: Self, other: Self) Self {
            return .{ .bits = self.bits.xorWith(other.bits) };
        }

        /// Returns a set with keys that are in this set
        /// except for keys in the other set.
        pub fn differenceWith(self: Self, other: Self) Self {
            return .{ .bits = self.bits.differenceWith(other.bits) };
        }

        /// Returns an iterator over this set, which iterates in
        /// index order.  Modifications to the set during iteration
        /// may or may not be observed by the iterator, but will
        /// not invalidate it.
        pub fn iterator(self: *const Self) Iterator {
            return .{ .inner = self.bits.iterator(.{}) };
        }

        pub const Iterator = struct {
            inner: BitSet.Iterator(.{}),

            pub fn next(self: *Iterator) ?Key {
                return if (self.inner.next()) |index|
                    Indexer.keyForIndex(index)
                else
                    null;
            }
        };
    };
}

test "pure EnumSet fns" {
    const Suit = enum { spades, hearts, clubs, diamonds };

    const empty = EnumSet(Suit).initEmpty();
    const full = EnumSet(Suit).initFull();
    const black = EnumSet(Suit).initMany(&[_]Suit{ .spades, .clubs });
    const red = EnumSet(Suit).initMany(&[_]Suit{ .hearts, .diamonds });

    try testing.expect(empty.eql(empty));
    try testing.expect(full.eql(full));
    try testing.expect(!empty.eql(full));
    try testing.expect(!full.eql(empty));
    try testing.expect(!empty.eql(black));
    try testing.expect(!full.eql(red));
    try testing.expect(!red.eql(empty));
    try testing.expect(!black.eql(full));

    try testing.expect(empty.subsetOf(empty));
    try testing.expect(empty.subsetOf(full));
    try testing.expect(full.subsetOf(full));
    try testing.expect(!black.subsetOf(red));
    try testing.expect(!red.subsetOf(black));

    try testing.expect(full.supersetOf(full));
    try testing.expect(full.supersetOf(empty));
    try testing.expect(empty.supersetOf(empty));
    try testing.expect(!black.supersetOf(red));
    try testing.expect(!red.supersetOf(black));

    try testing.expect(empty.complement().eql(full));
    try testing.expect(full.complement().eql(empty));
    try testing.expect(black.complement().eql(red));
    try testing.expect(red.complement().eql(black));

    try testing.expect(empty.unionWith(empty).eql(empty));
    try testing.expect(empty.unionWith(full).eql(full));
    try testing.expect(full.unionWith(full).eql(full));
    try testing.expect(full.unionWith(empty).eql(full));
    try testing.expect(black.unionWith(red).eql(full));
    try testing.expect(red.unionWith(black).eql(full));

    try testing.expect(empty.intersectWith(empty).eql(empty));
    try testing.expect(empty.intersectWith(full).eql(empty));
    try testing.expect(full.intersectWith(full).eql(full));
    try testing.expect(full.intersectWith(empty).eql(empty));
    try testing.expect(black.intersectWith(red).eql(empty));
    try testing.expect(red.intersectWith(black).eql(empty));

    try testing.expect(empty.xorWith(empty).eql(empty));
    try testing.expect(empty.xorWith(full).eql(full));
    try testing.expect(full.xorWith(full).eql(empty));
    try testing.expect(full.xorWith(empty).eql(full));
    try testing.expect(black.xorWith(red).eql(full));
    try testing.expect(red.xorWith(black).eql(full));

    try testing.expect(empty.differenceWith(empty).eql(empty));
    try testing.expect(empty.differenceWith(full).eql(empty));
    try testing.expect(full.differenceWith(full).eql(empty));
    try testing.expect(full.differenceWith(empty).eql(full));
    try testing.expect(full.differenceWith(red).eql(black));
    try testing.expect(full.differenceWith(black).eql(red));
}

test "std.enums.EnumSet const iterator" {
    const Direction = enum { up, down, left, right };
    const diag_move = init: {
        var move = EnumSet(Direction).initEmpty();
        move.insert(.right);
        move.insert(.up);
        break :init move;
    };

    var result = EnumSet(Direction).initEmpty();
    var it = diag_move.iterator();
    while (it.next()) |dir| {
        result.insert(dir);
    }

    try testing.expect(result.eql(diag_move));
}

/// A map from keys to values, using an index lookup.  Uses a
/// bitfield to track presence and a dense array of values.
/// This type does no allocation and can be copied by value.
pub fn IndexedMap(comptime I: type, comptime V: type, comptime Ext: ?fn (type) type) type {
    comptime ensureIndexer(I);
    return struct {
        const Self = @This();

        pub usingnamespace (Ext orelse NoExtension)(Self);

        /// The index mapping for this map
        pub const Indexer = I;
        /// The key type used to index this map
        pub const Key = Indexer.Key;
        /// The value type stored in this map
        pub const Value = V;
        /// The number of possible keys in the map
        pub const len = Indexer.count;

        const BitSet = std.StaticBitSet(Indexer.count);

        /// Bits determining whether items are in the map
        bits: BitSet = BitSet.initEmpty(),
        /// Values of items in the map.  If the associated
        /// bit is zero, the value is undefined.
        values: [Indexer.count]Value = undefined,

        /// The number of items in the map.
        pub fn count(self: Self) usize {
            return self.bits.count();
        }

        /// Checks if the map contains an item.
        pub fn contains(self: Self, key: Key) bool {
            return self.bits.isSet(Indexer.indexOf(key));
        }

        /// Gets the value associated with a key.
        /// If the key is not in the map, returns null.
        pub fn get(self: Self, key: Key) ?Value {
            const index = Indexer.indexOf(key);
            return if (self.bits.isSet(index)) self.values[index] else null;
        }

        /// Gets the value associated with a key, which must
        /// exist in the map.
        pub fn getAssertContains(self: Self, key: Key) Value {
            const index = Indexer.indexOf(key);
            assert(self.bits.isSet(index));
            return self.values[index];
        }

        /// Gets the address of the value associated with a key.
        /// If the key is not in the map, returns null.
        pub fn getPtr(self: *Self, key: Key) ?*Value {
            const index = Indexer.indexOf(key);
            return if (self.bits.isSet(index)) &self.values[index] else null;
        }

        /// Gets the address of the const value associated with a key.
        /// If the key is not in the map, returns null.
        pub fn getPtrConst(self: *const Self, key: Key) ?*const Value {
            const index = Indexer.indexOf(key);
            return if (self.bits.isSet(index)) &self.values[index] else null;
        }

        /// Gets the address of the value associated with a key.
        /// The key must be present in the map.
        pub fn getPtrAssertContains(self: *Self, key: Key) *Value {
            const index = Indexer.indexOf(key);
            assert(self.bits.isSet(index));
            return &self.values[index];
        }

        /// Adds the key to the map with the supplied value.
        /// If the key is already in the map, overwrites the value.
        pub fn put(self: *Self, key: Key, value: Value) void {
            const index = Indexer.indexOf(key);
            self.bits.set(index);
            self.values[index] = value;
        }

        /// Adds the key to the map with an undefined value.
        /// If the key is already in the map, the value becomes undefined.
        /// A pointer to the value is returned, which should be
        /// used to initialize the value.
        pub fn putUninitialized(self: *Self, key: Key) *Value {
            const index = Indexer.indexOf(key);
            self.bits.set(index);
            self.values[index] = undefined;
            return &self.values[index];
        }

        /// Sets the value associated with the key in the map,
        /// and returns the old value.  If the key was not in
        /// the map, returns null.
        pub fn fetchPut(self: *Self, key: Key, value: Value) ?Value {
            const index = Indexer.indexOf(key);
            const result: ?Value = if (self.bits.isSet(index)) self.values[index] else null;
            self.bits.set(index);
            self.values[index] = value;
            return result;
        }

        /// Removes a key from the map.  If the key was not in the map,
        /// does nothing.
        pub fn remove(self: *Self, key: Key) void {
            const index = Indexer.indexOf(key);
            self.bits.unset(index);
            self.values[index] = undefined;
        }

        /// Removes a key from the map, and returns the old value.
        /// If the key was not in the map, returns null.
        pub fn fetchRemove(self: *Self, key: Key) ?Value {
            const index = Indexer.indexOf(key);
            const result: ?Value = if (self.bits.isSet(index)) self.values[index] else null;
            self.bits.unset(index);
            self.values[index] = undefined;
            return result;
        }

        /// Returns an iterator over the map, which visits items in index order.
        /// Modifications to the underlying map may or may not be observed by
        /// the iterator, but will not invalidate it.
        pub fn iterator(self: *Self) Iterator {
            return .{
                .inner = self.bits.iterator(.{}),
                .values = &self.values,
            };
        }

        /// An entry in the map.
        pub const Entry = struct {
            /// The key associated with this entry.
            /// Modifying this key will not change the map.
            key: Key,

            /// A pointer to the value in the map associated
            /// with this key.  Modifications through this
            /// pointer will modify the underlying data.
            value: *Value,
        };

        pub const Iterator = struct {
            inner: BitSet.Iterator(.{}),
            values: *[Indexer.count]Value,

            pub fn next(self: *Iterator) ?Entry {
                return if (self.inner.next()) |index|
                    Entry{
                        .key = Indexer.keyForIndex(index),
                        .value = &self.values[index],
                    }
                else
                    null;
            }
        };
    };
}

/// A dense array of values, using an indexed lookup.
/// This type does no allocation and can be copied by value.
pub fn IndexedArray(comptime I: type, comptime V: type, comptime Ext: ?fn (type) type) type {
    comptime ensureIndexer(I);
    return struct {
        const Self = @This();

        pub usingnamespace (Ext orelse NoExtension)(Self);

        /// The index mapping for this map
        pub const Indexer = I;
        /// The key type used to index this map
        pub const Key = Indexer.Key;
        /// The value type stored in this map
        pub const Value = V;
        /// The number of possible keys in the map
        pub const len = Indexer.count;

        values: [Indexer.count]Value,

        pub fn initUndefined() Self {
            return Self{ .values = undefined };
        }

        pub fn initFill(v: Value) Self {
            var self: Self = undefined;
            @memset(&self.values, v);
            return self;
        }

        /// Returns the value in the array associated with a key.
        pub fn get(self: Self, key: Key) Value {
            return self.values[Indexer.indexOf(key)];
        }

        /// Returns a pointer to the slot in the array associated with a key.
        pub fn getPtr(self: *Self, key: Key) *Value {
            return &self.values[Indexer.indexOf(key)];
        }

        /// Returns a const pointer to the slot in the array associated with a key.
        pub fn getPtrConst(self: *const Self, key: Key) *const Value {
            return &self.values[Indexer.indexOf(key)];
        }

        /// Sets the value in the slot associated with a key.
        pub fn set(self: *Self, key: Key, value: Value) void {
            self.values[Indexer.indexOf(key)] = value;
        }

        /// Iterates over the items in the array, in index order.
        pub fn iterator(self: *Self) Iterator {
            return .{
                .values = &self.values,
            };
        }

        /// An entry in the array.
        pub const Entry = struct {
            /// The key associated with this entry.
            /// Modifying this key will not change the array.
            key: Key,

            /// A pointer to the value in the array associated
            /// with this key.  Modifications through this
            /// pointer will modify the underlying data.
            value: *Value,
        };

        pub const Iterator = struct {
            index: usize = 0,
            values: *[Indexer.count]Value,

            pub fn next(self: *Iterator) ?Entry {
                const index = self.index;
                if (index < Indexer.count) {
                    self.index += 1;
                    return Entry{
                        .key = Indexer.keyForIndex(index),
                        .value = &self.values[index],
                    };
                }
                return null;
            }
        };
    };
}

/// Verifies that a type is a valid Indexer, providing a helpful
/// compile error if not.  An Indexer maps a comptime-known set
/// of keys to a dense set of zero-based indices.
/// The indexer interface must look like this:
/// ```
/// struct {
///     /// The key type which this indexer converts to indices
///     pub const Key: type,
///     /// The number of indexes in the dense mapping
///     pub const count: usize,
///     /// Converts from a key to an index
///     pub fn indexOf(Key) usize;
///     /// Converts from an index to a key
///     pub fn keyForIndex(usize) Key;
/// }
/// ```
pub fn ensureIndexer(comptime T: type) void {
    comptime {
        if (!@hasDecl(T, "Key")) @compileError("Indexer must have decl Key: type.");
        if (@TypeOf(T.Key) != type) @compileError("Indexer.Key must be a type.");
        if (!@hasDecl(T, "count")) @compileError("Indexer must have decl count: usize.");
        if (@TypeOf(T.count) != usize) @compileError("Indexer.count must be a usize.");
        if (!@hasDecl(T, "indexOf")) @compileError("Indexer.indexOf must be a fn(Key)usize.");
        if (@TypeOf(T.indexOf) != fn (T.Key) usize) @compileError("Indexer must have decl indexOf: fn(Key)usize.");
        if (!@hasDecl(T, "keyForIndex")) @compileError("Indexer must have decl keyForIndex: fn(usize)Key.");
        if (@TypeOf(T.keyForIndex) != fn (usize) T.Key) @compileError("Indexer.keyForIndex must be a fn(usize)Key.");
    }
}

test "std.enums.ensureIndexer" {
    ensureIndexer(struct {
        pub const Key = u32;
        pub const count: usize = 8;
        pub fn indexOf(k: Key) usize {
            return @as(usize, @intCast(k));
        }
        pub fn keyForIndex(index: usize) Key {
            return @as(Key, @intCast(index));
        }
    });
}

pub fn EnumIndexer(comptime E: type) type {
    if (!@typeInfo(E).Enum.is_exhaustive) {
        @compileError("Cannot create an enum indexer for a non-exhaustive enum.");
    }

    const const_fields = std.meta.fields(E);
    var fields = const_fields[0..const_fields.len].*;
    const min = fields[0].value;
    const max = fields[fields.len - 1].value;
    const fields_len = fields.len;
    if (fields_len == 0) {
        return struct {
            pub const Key = E;
            pub const count: usize = 0;
            pub fn indexOf(e: E) usize {
                _ = e;
                unreachable;
            }
            pub fn keyForIndex(i: usize) E {
                _ = i;
                unreachable;
            }
        };
    }

    const SortContext = struct {
        fields: []EnumField,

        pub fn lessThan(comptime ctx: @This(), comptime a: usize, comptime b: usize) bool {
            return ctx.fields[a].value < ctx.fields[b].value;
        }

        pub fn swap(comptime ctx: @This(), comptime a: usize, comptime b: usize) void {
            return std.mem.swap(EnumField, &ctx.fields[a], &ctx.fields[b]);
        }
    };
    {
        const a: usize = 0;
        const b = fields_len;
        var i = a + 1;
        const context = SortContext{ .fields = &fields };
        @setEvalBranchQuota(999999999);
        while (i < b) : (i += 1) {
            var j = i;
            while (j > a and context.lessThan(j, j - 1)) : (j -= 1) {
                context.swap(j, j - 1);
            }
        }
    }

    if (max - min == fields.len - 1) {
        return struct {
            pub const Key = E;
            pub const count = fields_len;
            pub fn indexOf(e: E) usize {
                return @as(usize, @intCast(@intFromEnum(e) - min));
            }
            pub fn keyForIndex(i: usize) E {
                // TODO fix addition semantics.  This calculation
                // gives up some safety to avoid artificially limiting
                // the range of signed enum values to max_isize.
                const enum_value = if (min < 0) @as(isize, @bitCast(i)) +% min else i + min;
                return @as(E, @enumFromInt(@as(std.meta.Tag(E), @intCast(enum_value))));
            }
        };
    }

    const keys = valuesFromFields(E, &fields);

    return struct {
        pub const Key = E;
        pub const count = fields_len;
        pub fn indexOf(e: E) usize {
            @setEvalBranchQuota(123456);
            for (keys, 0..) |k, i| {
                if (k == e) return i;
            }
            unreachable;
        }
        pub fn keyForIndex(i: usize) E {
            return keys[i];
        }
    };
}

test "std.enums.EnumIndexer dense zeroed" {
    const E = enum(u2) { b = 1, a = 0, c = 2 };
    const Indexer = EnumIndexer(E);
    ensureIndexer(Indexer);
    try testing.expectEqual(E, Indexer.Key);
    try testing.expectEqual(@as(usize, 3), Indexer.count);

    try testing.expectEqual(@as(usize, 0), Indexer.indexOf(.a));
    try testing.expectEqual(@as(usize, 1), Indexer.indexOf(.b));
    try testing.expectEqual(@as(usize, 2), Indexer.indexOf(.c));

    try testing.expectEqual(E.a, Indexer.keyForIndex(0));
    try testing.expectEqual(E.b, Indexer.keyForIndex(1));
    try testing.expectEqual(E.c, Indexer.keyForIndex(2));
}

test "std.enums.EnumIndexer dense positive" {
    const E = enum(u4) { c = 6, a = 4, b = 5 };
    const Indexer = EnumIndexer(E);
    ensureIndexer(Indexer);
    try testing.expectEqual(E, Indexer.Key);
    try testing.expectEqual(@as(usize, 3), Indexer.count);

    try testing.expectEqual(@as(usize, 0), Indexer.indexOf(.a));
    try testing.expectEqual(@as(usize, 1), Indexer.indexOf(.b));
    try testing.expectEqual(@as(usize, 2), Indexer.indexOf(.c));

    try testing.expectEqual(E.a, Indexer.keyForIndex(0));
    try testing.expectEqual(E.b, Indexer.keyForIndex(1));
    try testing.expectEqual(E.c, Indexer.keyForIndex(2));
}

test "std.enums.EnumIndexer dense negative" {
    const E = enum(i4) { a = -6, c = -4, b = -5 };
    const Indexer = EnumIndexer(E);
    ensureIndexer(Indexer);
    try testing.expectEqual(E, Indexer.Key);
    try testing.expectEqual(@as(usize, 3), Indexer.count);

    try testing.expectEqual(@as(usize, 0), Indexer.indexOf(.a));
    try testing.expectEqual(@as(usize, 1), Indexer.indexOf(.b));
    try testing.expectEqual(@as(usize, 2), Indexer.indexOf(.c));

    try testing.expectEqual(E.a, Indexer.keyForIndex(0));
    try testing.expectEqual(E.b, Indexer.keyForIndex(1));
    try testing.expectEqual(E.c, Indexer.keyForIndex(2));
}

test "std.enums.EnumIndexer sparse" {
    const E = enum(i4) { a = -2, c = 6, b = 4 };
    const Indexer = EnumIndexer(E);
    ensureIndexer(Indexer);
    try testing.expectEqual(E, Indexer.Key);
    try testing.expectEqual(@as(usize, 3), Indexer.count);

    try testing.expectEqual(@as(usize, 0), Indexer.indexOf(.a));
    try testing.expectEqual(@as(usize, 1), Indexer.indexOf(.b));
    try testing.expectEqual(@as(usize, 2), Indexer.indexOf(.c));

    try testing.expectEqual(E.a, Indexer.keyForIndex(0));
    try testing.expectEqual(E.b, Indexer.keyForIndex(1));
    try testing.expectEqual(E.c, Indexer.keyForIndex(2));
}
