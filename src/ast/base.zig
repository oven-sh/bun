const std = @import("std");
const bun = @import("bun");
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
    pub const Tag = packed struct {
        javascript_ast: bool = false,
        ast_id: bool = false,
        source: bool = false,
        part: bool = false,
    };

    const ValueIntType = if (!bun.Environment.allow_assert)
        u32
    else
        std.meta.Int(.unsigned, 32 - @bitSizeOf(Tag));

    value: ValueIntType = invalid_value,
    tag: TagOrVoid = if (bun.Environment.allow_assert) Tag{} else void{},

    const TagOrVoid = if (bun.Environment.allow_assert) Tag else void;

    const invalid_value = std.math.maxInt(ValueIntType);

    pub fn set(this: *Index, val: Int) void {
        this.value = val;
    }

    pub inline fn isRuntime(this: Index) bool {
        return this.value == runtime.value;
    }

    pub const invalid = Index{ .value = invalid_value };
    pub const runtime = Index{ .value = 0 };

    pub const Int = ValueIntType;

    pub inline fn source(num: anytype) Index {
        return init(.source, num);
    }

    pub inline fn part(num: anytype) Index {
        return init(.part, num);
    }

    pub inline fn add(this: Index, comptime tag: std.meta.FieldEnum(Tag)) Index {
        var new = this.tag;
        @field(new, tag) = true;
        return Index{
            .tag = new,
            .value = this.value,
        };
    }

    pub fn init(comptime tag: std.meta.FieldEnum(Tag), num: anytype) Index {
        const NumType = @TypeOf(num);
        if (comptime @typeInfo(NumType) == .Pointer) {
            return init(tag, num.*);
        }

        if (comptime bun.Environment.allow_assert) {
            var this_tag = Tag{};
            @field(this_tag, tag) = true;
            return .{
                .tag = this_tag,
                .value = @intCast(Int, num),
            };
        }

        return .{
            .tag = void{},
            .value = @intCast(Int, num),
        };
    }

    pub inline fn isValid(this: Index) bool {
        return this.value != invalid_value;
    }

    pub inline fn isInvalid(this: Index) bool {
        return !this.isValid();
    }

    pub inline fn get(this: Index, comptime tag: std.meta.FieldEnum(Tag)) Int {
        if (comptime bun.Environment.allow_assert) {
            if (!@field(this.tag, tag)) {
                bun.Output.panic("Index.get expected tag to have {s}, but received {any} ({d})", .{
                    @tagName(tag),
                    this.tag,
                    this.value,
                });
            }
        }

        return this.value;
    }
};

pub const Ref = packed struct(u64) {
    tag: enum(u2) {
        invalid,
        allocated_name,
        source_contents_slice,
        symbol,
    } = .invalid,

    source_index: Int = 0,
    inner_index: Int = 0,

    pub const ArrayHashCtx = RefHashCtx;

    pub const Int = u31;

    pub fn toInt(value: anytype) Int {
        return @truncate(Int, value);
    }

    pub fn isSourceIndexNull(this: u32) bool {
        return this == std.math.maxInt(Int);
    }

    pub fn isSymbol(this: Ref) bool {
        return this.tag == .symbol;
    }

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

    pub fn isValid(this: Ref) bool {
        return this.tag != .invalid;
    }

    // 2 bits of padding for whatever is the parent
    pub const None = Ref{ .inner_index = 0, .source_index = 0, .tag = .invalid };
    pub const RuntimeRef = Ref{ .inner_index = 0, .source_index = 0, .tag = .runtime };

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
        // This type isn't quite a u64 because it is used in a few other packed structs which have variables in them
        // But, there are some footguns with the stage1 implementation of packed structs
        // so it is safer to do comparisons as u64
        // but we want to ensure that the value of the unused bits in the u64 are 0
        // i have not looked at the assembly to verify that the unused bits default to 0
        // so we set it to u64 0 just to be sure
        return @bitCast(u64, key);
    }

    pub inline fn hash64(key: Ref) u64 {
        return std.hash.Wyhash.hash(0, &@bitCast([8]u8, @bitCast(u64, key)));
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

// This is kind of the wrong place, but it's shared between files
pub const RequireOrImportMeta = struct {
    // CommonJS files will return the "require_*" wrapper function and an invalid
    // exports object reference. Lazily-initialized ESM files will return the
    // "init_*" wrapper function and the exports object for that file.
    wrapper_ref: Ref = Ref.None,
    exports_ref: Ref = Ref.None,
    is_wrapper_async: bool = false,
};
