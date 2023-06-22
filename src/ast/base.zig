const std = @import("std");
const bun = @import("root").bun;
const unicode = std.unicode;

pub const JavascriptString = []u16;
pub fn newJavascriptString(comptime text: []const u8) JavascriptString {
    return unicode.utf8ToUtf16LeStringLiteral(text);
}

pub const NodeIndex = u32;
pub const NodeIndexNone = 4294967293;

// TODO: figure out if we actually need this
// -- original comment --
// Files are parsed in parallel for speed. We want to allow each parser to
// generate symbol IDs that won't conflict with each other. We also want to be
// able to quickly merge symbol tables from all files into one giant symbol
// table.
//
// We can accomplish both goals by giving each symbol ID two parts: a source
// index that is unique to the parser goroutine, and an inner index that
// increments as the parser generates new symbol IDs. Then a symbol map can
// be an array of arrays indexed first by source index, then by inner index.
// The maps can be merged quickly by creating a single outer array containing
// all inner arrays from all parsed files.

pub const RefHashCtx = struct {
    pub fn hash(_: @This(), key: Ref) u32 {
        return key.hash();
    }

    pub fn eql(_: @This(), ref: Ref, b: Ref, _: usize) bool {
        return ref.asU64() == b.asU64();
    }
};

pub const RefCtx = struct {
    pub fn hash(_: @This(), key: Ref) u64 {
        return key.hash64();
    }

    pub fn eql(_: @This(), ref: Ref, b: Ref) bool {
        return ref.asU64() == b.asU64();
    }
};

/// Sets the range of bits starting at `start_bit` upto and excluding `start_bit` + `number_of_bits`
/// to be specific, if the range is N bits long, the N lower bits of `value` will be used; if any of
/// the other bits in `value` are set to 1, this function will panic.
///
/// ```zig
/// var val: u8 = 0b10000000;
/// setBits(&val, 2, 4, 0b00001101);
/// try testing.expectEqual(@as(u8, 0b10110100), val);
/// ```
///
/// ## Panics
/// This method will panic if the `value` exceeds the bit range of the type of `target`
pub fn setBits(
    comptime TargetType: type,
    target: TargetType,
    comptime start_bit: comptime_int,
    comptime number_of_bits: comptime_int,
    value: TargetType,
) TargetType {
    const end_bit = start_bit + number_of_bits;

    comptime {
        if (number_of_bits == 0) @compileError("non-zero number_of_bits must be provided");

        if (@typeInfo(TargetType) == .Int) {
            if (@typeInfo(TargetType).Int.signedness != .unsigned) {
                @compileError("requires an unsigned integer, found " ++ @typeName(TargetType));
            }
            if (start_bit >= @bitSizeOf(TargetType)) {
                @compileError("start_bit index is out of bounds of the bit field");
            }
            if (end_bit > @bitSizeOf(TargetType)) {
                @compileError("start_bit + number_of_bits is out of bounds of the bit field");
            }
        } else if (@typeInfo(TargetType) == .ComptimeInt) {
            @compileError("comptime_int is unsupported");
        } else {
            @compileError("requires an unsigned integer, found " ++ @typeName(TargetType));
        }
    }

    if (comptime std.debug.runtime_safety) {
        if (getBits(TargetType, value, 0, (end_bit - start_bit)) != value) @panic("value exceeds bit range");
    }

    const bitmask: TargetType = comptime blk: {
        var bitmask = ~@as(TargetType, 0);
        bitmask <<= (@bitSizeOf(TargetType) - end_bit);
        bitmask >>= (@bitSizeOf(TargetType) - end_bit);
        bitmask >>= start_bit;
        bitmask <<= start_bit;
        break :blk ~bitmask;
    };

    return (target & bitmask) | (value << start_bit);
}

pub inline fn getBits(comptime TargetType: type, target: anytype, comptime start_bit: comptime_int, comptime number_of_bits: comptime_int) TargetType {
    comptime {
        if (number_of_bits == 0) @compileError("non-zero number_of_bits must be provided");

        if (@typeInfo(TargetType) == .Int) {
            if (@typeInfo(TargetType).Int.signedness != .unsigned) {
                @compileError("requires an unsigned integer, found " ++ @typeName(TargetType));
            }
            if (start_bit >= @bitSizeOf(TargetType)) {
                @compileError("start_bit index is out of bounds of the bit field");
            }
            if (start_bit + number_of_bits > @bitSizeOf(TargetType)) {
                @compileError("start_bit + number_of_bits is out of bounds of the bit field");
            }
        } else if (@typeInfo(TargetType) == .ComptimeInt) {
            if (target < 0) {
                @compileError("requires an unsigned integer, found " ++ @typeName(TargetType));
            }
        } else {
            @compileError("requires an unsigned integer, found " ++ @typeName(TargetType));
        }
    }

    return @truncate(TargetType, target >> start_bit);
}

/// In some parts of Bun, we have many different IDs pointing to different things.
/// It's easy for them to get mixed up, so we use this type to make sure we don't.
///
pub const Index = packed struct(u32) {
    value: Int,

    pub fn set(this: *Index, val: Int) void {
        this.value = val;
    }

    pub inline fn isRuntime(this: Index) bool {
        return this.value == runtime.value;
    }

    pub const invalid = Index{ .value = std.math.maxInt(Int) };
    pub const runtime = Index{
        .value = 0,
    };

    pub const Int = u32;

    pub inline fn source(num: anytype) Index {
        return .{ .value = @truncate(Int, num) };
    }

    pub inline fn part(num: anytype) Index {
        return .{ .value = @truncate(Int, num) };
    }

    pub fn init(num: anytype) Index {
        const NumType = @TypeOf(num);
        if (comptime @typeInfo(NumType) == .Pointer) {
            return init(num.*);
        }

        if (comptime bun.Environment.allow_assert) {
            return .{
                .value = @intCast(Int, num),
            };
        }

        return .{
            .value = @intCast(Int, num),
        };
    }

    pub inline fn isValid(this: Index) bool {
        return this.value != invalid.value;
    }

    pub inline fn isInvalid(this: Index) bool {
        return !this.isValid();
    }

    pub inline fn get(this: Index) Int {
        return this.value;
    }
};

pub const Ref = packed struct(u64) {
    inner_index: Int = 0,

    tag: enum(u2) {
        invalid,
        allocated_name,
        source_contents_slice,
        symbol,
    } = .invalid,

    source_index: Int = 0,

    pub inline fn isEmpty(this: Ref) bool {
        return this.asU64() == 0;
    }

    pub const ArrayHashCtx = RefHashCtx;
    pub const HashCtx = RefCtx;

    pub const Int = std.meta.Int(.unsigned, (64 - 2) / 2);

    pub fn toInt(value: anytype) Int {
        return @intCast(Int, value);
    }

    pub fn isSourceIndexNull(this: anytype) bool {
        return this == std.math.maxInt(Int);
    }

    pub fn isSymbol(this: Ref) bool {
        return this.tag == .symbol;
    }

    pub fn format(ref: Ref, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
        try std.fmt.format(
            writer,
            "Ref[{d}, {d}, {s}]",
            .{
                ref.sourceIndex(),
                ref.innerIndex(),
                @tagName(ref.tag),
            },
        );
    }

    pub fn isValid(this: Ref) bool {
        return this.tag != .invalid;
    }

    // 2 bits of padding for whatever is the parent
    pub const None = Ref{ .inner_index = 0, .source_index = 0, .tag = .invalid };

    pub inline fn sourceIndex(this: Ref) Int {
        return this.source_index;
    }

    pub inline fn innerIndex(this: Ref) Int {
        return this.inner_index;
    }

    pub inline fn isSourceContentsSlice(this: Ref) bool {
        return this.tag == .source_contents_slice;
    }

    pub fn init(inner_index: Int, source_index: usize, is_source_contents_slice: bool) Ref {
        return .{
            .inner_index = inner_index,

            // if we overflow, we want a panic
            .source_index = @intCast(Int, source_index),

            .tag = if (is_source_contents_slice) .source_contents_slice else .allocated_name,
        };
    }

    pub fn initSourceEnd(old: Ref) Ref {
        std.debug.assert(old.tag != .invalid);
        return init(old.inner_index, old.source_index, old.tag == .source_contents_slice);
    }

    pub fn hash(key: Ref) u32 {
        return @truncate(u32, key.hash64());
    }

    pub inline fn asU64(key: Ref) u64 {
        return @bitCast(u64, key);
    }

    pub inline fn hash64(key: Ref) u64 {
        return bun.hash(&@bitCast([8]u8, key.asU64()));
    }

    pub fn eql(ref: Ref, b: Ref) bool {
        return asU64(ref) == b.asU64();
    }
    pub inline fn isNull(self: Ref) bool {
        return self.tag == .invalid;
    }

    pub fn jsonStringify(self: *const Ref, options: anytype, writer: anytype) !void {
        return try std.json.stringify([2]u32{ self.sourceIndex(), self.innerIndex() }, options, writer);
    }
};

test "Ref" {
    {
        const first = .{ .inner_index = 0, .source_index = 1, .is_source_contents_slice = true };
        const ref = Ref.initSourceEnd(.{ .inner_index = 0, .source_index = 1, .is_source_contents_slice = true });
        try std.testing.expectEqual(ref.innerIndex(), first.inner_index);
        try std.testing.expectEqual(ref.sourceIndex(), first.source_index);
        try std.testing.expectEqual(ref.isSourceContentsSlice(), first.is_source_contents_slice);
    }

    {
        const first = .{ .inner_index = 100, .source_index = 0, .is_source_contents_slice = true };
        const ref = Ref.initSourceEnd(.{ .inner_index = 100, .source_index = 0, .is_source_contents_slice = true });
        try std.testing.expectEqual(ref.innerIndex(), first.inner_index);
        try std.testing.expectEqual(ref.sourceIndex(), first.source_index);
        try std.testing.expectEqual(ref.isSourceContentsSlice(), first.is_source_contents_slice);
    }

    {
        const first = .{ .inner_index = 20, .source_index = 100, .is_source_contents_slice = true };
        const ref = Ref.initSourceEnd(.{ .inner_index = 20, .source_index = 100, .is_source_contents_slice = true });
        try std.testing.expectEqual(ref.innerIndex(), first.inner_index);
        try std.testing.expectEqual(ref.sourceIndex(), first.source_index);
        try std.testing.expectEqual(ref.isSourceContentsSlice(), first.is_source_contents_slice);
    }

    {
        const first = .{ .inner_index = 30, .source_index = 100, .is_source_contents_slice = false };
        const ref = Ref.initSourceEnd(.{ .inner_index = 30, .source_index = 100, .is_source_contents_slice = false });
        try std.testing.expectEqual(ref.innerIndex(), first.inner_index);
        try std.testing.expectEqual(ref.sourceIndex(), first.source_index);
        try std.testing.expectEqual(ref.isSourceContentsSlice(), first.is_source_contents_slice);
    }
}
