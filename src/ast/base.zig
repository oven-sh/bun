const std = @import("std");
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

pub const Ref = enum(TotalSize) {
    default = std.math.maxInt(TotalSize),
    _,

    pub const TotalSize = u62;

    pub fn format(ref: Ref, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
        try std.fmt.format(
            writer,
            "Ref: sourceIndex = {d}, innerIndex = {d}, is_source_contents_slice = {}",
            .{
                ref.sourceIndex(),
                ref.innerIndex(),
                ref.isSourceContentsSlice(),
            },
        );
    }

    const max_ref_int = std.math.maxInt(Ref.Int);
    pub const BitInt = std.meta.Int(.unsigned, @bitSizeOf(Ref));

    pub inline fn asBitInt(this: Ref) BitInt {
        return @bitCast(BitInt, this);
    }

    // 2 bits of padding for whatever is the parent
    pub const Int = u30;
    pub const None = Ref.init(std.math.maxInt(u30), std.math.maxInt(u30), false);
    pub const RuntimeRef = Ref.init(std.math.maxInt(u30), std.math.maxInt(u30) - 1, false);

    const source_index_offset = 1;
    const inner_index_offset = 1 + 30;

    pub inline fn sourceIndex(this: Ref) Int {
        return @truncate(Int, getBits(TotalSize, @enumToInt(this), source_index_offset, 30));
    }

    pub inline fn innerIndex(this: Ref) Int {
        return @truncate(Int, getBits(TotalSize, @enumToInt(this), inner_index_offset, 30));
    }

    pub inline fn isSourceContentsSlice(this: Ref) bool {
        return (getBits(TotalSize, @enumToInt(this), 0, 1) & 1) != 0;
    }

    pub fn atIndex(value: anytype) Ref {
        return @intToEnum(Ref, setBits(TotalSize, 0, inner_index_offset, 30, @truncate(Int, value)));
    }

    pub fn init(inner_index: Int, source_index: Int, is_source_contents_slice: bool) Ref {
        return @intToEnum(
            Ref,
            setBits(
                TotalSize,
                0,
                0,
                1,
                @as(
                    TotalSize,
                    @boolToInt(is_source_contents_slice),
                ),
            ) | setBits(
                TotalSize,
                0,
                source_index_offset,
                30,
                source_index,
            ) | setBits(
                TotalSize,
                0,
                inner_index_offset,
                30,
                inner_index,
            ),
        );
    }

    const Old = struct {
        inner_index: Int = 0,
        source_index: Int = std.math.maxInt(Int),
        is_source_contents_slice: bool = false,
    };
    pub fn initSourceEnd(old: Old) Ref {
        return init(old.inner_index, old.source_index, old.is_source_contents_slice);
    }

    pub fn toInt(int: anytype) Int {
        return @intCast(Int, int);
    }

    pub fn hash(key: Ref) u32 {
        return @truncate(u32, key.hash64());
    }

    pub inline fn asU64(key: Ref) u64 {
        // This type isn't quite a u64 because it is used in a few other packed structs which have variables in them
        // But, there are some footguns with the stage1 implementation of packed structs
        // so it is safer to do comparisons as u64
        // but we want to ensure that the value of the unused bits in the u64 are 0
        // i have not looked at the assembly to verify that the unused bits default to 0
        // so we set it to u64 0 just to be sure
        return @as(u64, @enumToInt(key));
    }

    pub inline fn hash64(key: Ref) u64 {
        return std.hash.Wyhash.hash(0, &@bitCast([8]u8, key.asU64()));
    }

    pub fn eql(ref: Ref, b: Ref) bool {
        return asU64(ref) == b.asU64();
    }
    pub inline fn isNull(self: Ref) bool {
        return self.eql(Ref.None);
    }

    pub fn isSourceIndexNull(int: anytype) bool {
        return int == max_ref_int;
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

// This is kind of the wrong place, but it's shared between files
pub const RequireOrImportMeta = struct {
    // CommonJS files will return the "require_*" wrapper function and an invalid
    // exports object reference. Lazily-initialized ESM files will return the
    // "init_*" wrapper function and the exports object for that file.
    wrapper_ref: Ref = Ref.None,
    exports_ref: Ref = Ref.None,
    is_wrapper_async: bool = false,
};
