const std = @import("std");
const bun = @import("root").bun;
const unicode = std.unicode;

const js_ast = bun.JSAst;

pub const NodeIndex = u32;
pub const NodeIndexNone = 4294967293;

// TODO: figure out if we actually need this

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

/// In some parts of Bun, we have many different IDs pointing to different things.
/// It's easy for them to get mixed up, so we use this type to make sure we don't.
///
pub const Index = packed struct(u32) {
    value: Int,

    pub fn set(this: *Index, val: Int) void {
        this.value = val;
    }

    /// if you are within the parser, use p.isSourceRuntime() instead, as the
    /// runtime index (0) is used as the id for single-file transforms.
    pub inline fn isRuntime(this: Index) bool {
        return this.value == (comptime runtime.value);
    }

    pub const invalid = Index{ .value = std.math.maxInt(Int) };
    pub const runtime = Index{ .value = 0 };

    pub const Int = u32;

    pub inline fn source(num: anytype) Index {
        return .{ .value = @as(Int, @truncate(num)) };
    }

    pub inline fn part(num: anytype) Index {
        return .{ .value = @as(Int, @truncate(num)) };
    }

    pub fn init(num: anytype) Index {
        const NumType = @TypeOf(num);
        if (comptime @typeInfo(NumType) == .Pointer) {
            return init(num.*);
        }

        if (comptime bun.Environment.allow_assert) {
            return .{
                .value = @as(Int, @intCast(num)),
            };
        }

        return .{
            .value = @as(Int, @intCast(num)),
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

/// -- original comment from esbuild --
///
/// Files are parsed in parallel for speed. We want to allow each parser to
/// generate symbol IDs that won't conflict with each other. We also want to be
/// able to quickly merge symbol tables from all files into one giant symbol
/// table.
///
/// We can accomplish both goals by giving each symbol ID two parts: a source
/// index that is unique to the parser goroutine, and an inner index that
/// increments as the parser generates new symbol IDs. Then a symbol map can
/// be an array of arrays indexed first by source index, then by inner index.
/// The maps can be merged quickly by creating a single outer array containing
/// all inner arrays from all parsed files.
pub const Ref = packed struct(u64) {
    pub const Int = u31;

    inner_index: Int = 0,

    tag: enum(u2) {
        invalid,
        allocated_name,
        source_contents_slice,
        symbol,
    } = .invalid,

    source_index: Int = 0,

    /// Represents a null state without using an extra bit
    pub const None = Ref{ .inner_index = 0, .source_index = 0, .tag = .invalid };

    comptime {
        bun.assert(None.isEmpty());
    }

    pub inline fn isEmpty(this: Ref) bool {
        return this.asU64() == 0;
    }

    pub const ArrayHashCtx = RefHashCtx;
    pub const HashCtx = RefCtx;

    pub fn isSourceIndexNull(this: anytype) bool {
        return this == std.math.maxInt(Int);
    }

    pub fn isSymbol(this: Ref) bool {
        return this.tag == .symbol;
    }

    pub fn format(ref: Ref, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
        try std.fmt.format(
            writer,
            "Ref[inner={d}, src={d}, .{s}]",
            .{
                ref.innerIndex(),
                ref.sourceIndex(),
                @tagName(ref.tag),
            },
        );
    }

    pub fn dump(ref: Ref, symbol_table: anytype) std.fmt.Formatter(dumpImpl) {
        return .{ .data = .{
            .ref = ref,
            .symbol_table = switch (@TypeOf(symbol_table)) {
                *const std.ArrayList(js_ast.Symbol) => symbol_table.items,
                *std.ArrayList(js_ast.Symbol) => symbol_table.items,
                []const js_ast.Symbol => symbol_table,
                []js_ast.Symbol => symbol_table,
                else => |T| @compileError("Unsupported type to Ref.dump: " ++ @typeName(T)),
            },
        } };
    }

    fn dumpImpl(data: struct { ref: Ref, symbol_table: []const js_ast.Symbol }, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
        const symbol = data.symbol_table[data.ref.inner_index];
        try std.fmt.format(
            writer,
            "Ref[inner={d}, src={d}, .{s}; original_name={s}, uses={d}]",
            .{
                data.ref.inner_index,
                data.ref.source_index,
                @tagName(data.ref.tag),
                symbol.original_name,
                symbol.use_count_estimate,
            },
        );
    }

    pub fn isValid(this: Ref) bool {
        return this.tag != .invalid;
    }

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
            .source_index = @intCast(source_index),
            .tag = if (is_source_contents_slice) .source_contents_slice else .allocated_name,
        };
    }

    pub fn initSourceEnd(old: Ref) Ref {
        bun.assert(old.tag != .invalid);
        return init(old.inner_index, old.source_index, old.tag == .source_contents_slice);
    }

    pub fn hash(key: Ref) u32 {
        return @truncate(key.hash64());
    }

    pub inline fn asU64(key: Ref) u64 {
        return @bitCast(key);
    }

    pub inline fn hash64(key: Ref) u64 {
        return bun.hash(&@as([8]u8, @bitCast(key.asU64())));
    }

    pub fn eql(ref: Ref, other: Ref) bool {
        return ref.asU64() == other.asU64();
    }

    pub const isNull = isEmpty; // deprecated

    pub fn jsonStringify(self: *const Ref, writer: anytype) !void {
        return try writer.write([2]u32{ self.sourceIndex(), self.innerIndex() });
    }
};
