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

    pub fn eql(_: @This(), ref: Ref, b: Ref) bool {
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

pub const Ref = packed struct {
    const max_ref_int = std.math.maxInt(Ref.Int);
    pub const BitInt = std.meta.Int(.unsigned, @bitSizeOf(Ref));

    source_index: Int = max_ref_int,
    inner_index: Int = 0,
    is_source_contents_slice: bool = false,

    pub inline fn asBitInt(this: Ref) BitInt {
        return @bitCast(BitInt, this);
    }

    // 2 bits of padding for whatever is the parent
    pub const Int = u30;
    pub const None = Ref{
        .inner_index = max_ref_int,
        .source_index = max_ref_int,
    };
    pub const RuntimeRef = Ref{
        .inner_index = max_ref_int,
        .source_index = max_ref_int - 1,
    };

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
        return @as(u64, 0) | @as(u64, key.asBitInt());
    }

    pub inline fn hash64(key: Ref) u64 {
        return std.hash.Wyhash.hash(0, &@bitCast([8]u8, key.asU64()));
    }

    pub fn eql(ref: Ref, b: Ref) bool {
        return asU64(ref) == b.asU64();
    }
    pub fn isNull(self: Ref) bool {
        return self.eql(Ref.None);
    }

    pub fn isSourceIndexNull(int: anytype) bool {
        return int == max_ref_int;
    }

    pub fn jsonStringify(self: *const Ref, options: anytype, writer: anytype) !void {
        return try std.json.stringify([2]u32{ self.source_index, self.inner_index }, options, writer);
    }
};

// This is kind of the wrong place, but it's shared between files
pub const RequireOrImportMeta = struct {
    // CommonJS files will return the "require_*" wrapper function and an invalid
    // exports object reference. Lazily-initialized ESM files will return the
    // "init_*" wrapper function and the exports object for that file.
    wrapper_ref: Ref = Ref.None,
    exports_ref: Ref = Ref.None,
    is_wrapper_async: bool = false,
};
