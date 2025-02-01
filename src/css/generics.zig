const std = @import("std");
const Allocator = std.mem.Allocator;
const bun = @import("root").bun;
const logger = bun.logger;
const Log = logger.Log;

const ArrayList = std.ArrayListUnmanaged;

const css = @import("./css_parser.zig");
const css_values = css.css_values;

const Parser = css.Parser;
const ParserOptions = css.ParserOptions;
const Result = css.Result;
const Printer = css.Printer;
const PrintErr = css.PrintErr;
const CSSNumber = css.CSSNumber;
const CSSNumberFns = css.CSSNumberFns;
const CSSInteger = css.CSSInteger;
const CSSIntegerFns = css.CSSIntegerFns;
const CustomIdent = css.CustomIdent;
const CustomIdentFns = css.CustomIdentFns;
const DashedIdent = css.DashedIdent;
const DashedIdentFns = css.DashedIdentFns;
const Ident = css.Ident;
const IdentFns = css.IdentFns;
const VendorPrefix = css.VendorPrefix;

pub inline fn implementDeepClone(comptime T: type, this: *const T, allocator: Allocator) T {
    const tyinfo = @typeInfo(T);

    if (comptime bun.meta.isSimpleCopyType(T)) {
        return this.*;
    }

    if (comptime bun.meta.looksLikeListContainerType(T)) |result| {
        return switch (result) {
            .array_list => deepClone(result.child, allocator, this),
            .baby_list => @panic("Not implemented."),
            .small_list => this.deepClone(allocator),
        };
    }

    if (comptime T == []const u8) {
        return this.*;
    }

    if (comptime @typeInfo(T) == .Pointer) {
        const TT = std.meta.Child(T);
        return implementEql(TT, this.*);
    }

    return switch (tyinfo) {
        .Struct => {
            var strct: T = undefined;
            inline for (tyinfo.Struct.fields) |field| {
                if (comptime canTransitivelyImplementDeepClone(field.type) and @hasDecl(field.type, "__generateDeepClone")) {
                    @field(strct, field.name) = implementDeepClone(field.type, &field(this, field.name, allocator));
                } else {
                    @field(strct, field.name) = deepClone(field.type, &@field(this, field.name), allocator);
                }
            }
            return strct;
        },
        .Union => {
            inline for (bun.meta.EnumFields(T), tyinfo.Union.fields) |enum_field, union_field| {
                if (@intFromEnum(this.*) == enum_field.value) {
                    if (comptime canTransitivelyImplementDeepClone(union_field.type) and @hasDecl(union_field.type, "__generateDeepClone")) {
                        return @unionInit(T, enum_field.name, implementDeepClone(union_field.type, &@field(this, enum_field.name), allocator));
                    }
                    return @unionInit(T, enum_field.name, deepClone(union_field.type, &@field(this, enum_field.name), allocator));
                }
            }
            unreachable;
        },
        else => @compileError("Unhandled type " ++ @typeName(T)),
    };
}

/// A function to implement `lhs.eql(&rhs)` for the many types in the CSS parser that needs this.
///
/// This is the equivalent of doing `#[derive(PartialEq])` in Rust.
///
/// This function only works on simple types like:
/// - Simple equality types (e.g. integers, floats, strings, enums, etc.)
/// - Types which implement a `.eql(lhs: *const @This(), rhs: *const @This()) bool` function
///
/// Or compound types composed of simple types such as:
/// - Pointers to simple types
/// - Optional simple types
/// - Structs, Arrays, and Unions
pub fn implementEql(comptime T: type, this: *const T, other: *const T) bool {
    const tyinfo = @typeInfo(T);
    if (comptime bun.meta.isSimpleEqlType(T)) {
        return this.* == other.*;
    }
    if (comptime T == []const u8) {
        return bun.strings.eql(this.*, other.*);
    }
    if (comptime @typeInfo(T) == .Pointer) {
        const TT = std.meta.Child(T);
        return implementEql(TT, this.*, other.*);
    }
    if (comptime @typeInfo(T) == .Optional) {
        const TT = std.meta.Child(T);
        if (this.* != null and other.* != null) return implementEql(TT, &this.*.?, &other.*.?);
        return false;
    }
    if (comptime T == VendorPrefix) {
        return VendorPrefix.eql(this.*, other.*);
    }
    return switch (tyinfo) {
        .Optional => @compileError("Handled above, this means Zack wrote a bug."),
        .Pointer => @compileError("Handled above, this means Zack wrote a bug."),
        .Array => {
            const Child = std.meta.Child(T);
            if (comptime bun.meta.isSimpleEqlType(Child)) {
                return std.mem.eql(Child, &this.*, &other.*);
            }
            if (this.len != other.len) return false;
            if (comptime canTransitivelyImplementEql(Child) and @hasDecl(Child, "__generateEql")) {
                for (this.*, other.*) |*a, *b| {
                    if (!implementEql(Child, &a, &b)) return false;
                }
            } else {
                for (this.*, other.*) |*a, *b| {
                    if (!eql(Child, a, b)) return false;
                }
            }
            return true;
        },
        .Struct => {
            inline for (tyinfo.Struct.fields) |field| {
                if (!eql(field.type, &@field(this, field.name), &@field(other, field.name))) return false;
            }
            return true;
        },
        .Union => {
            if (tyinfo.Union.tag_type == null) @compileError("Unions must have a tag type");
            if (@intFromEnum(this.*) != @intFromEnum(other.*)) return false;
            const enum_fields = bun.meta.EnumFields(T);
            inline for (enum_fields, std.meta.fields(T)) |enum_field, union_field| {
                if (enum_field.value == @intFromEnum(this.*)) {
                    if (union_field.type != void) {
                        if (comptime canTransitivelyImplementEql(union_field.type) and @hasDecl(union_field.type, "__generateEql")) {
                            return implementEql(union_field.type, &@field(this, enum_field.name), &@field(other, enum_field.name));
                        }
                        return eql(union_field.type, &@field(this, enum_field.name), &@field(other, enum_field.name));
                    } else {
                        return true;
                    }
                }
            }
            unreachable;
        },
        else => @compileError("Unsupported type: " ++ @typeName(T)),
    };
}

pub fn implementHash(comptime T: type, this: *const T, hasher: *std.hash.Wyhash) void {
    const tyinfo = @typeInfo(T);
    if (comptime T == void) return;
    if (comptime bun.meta.isSimpleEqlType(T)) {
        return hasher.update(std.mem.asBytes(&this));
    }
    if (comptime bun.meta.looksLikeListContainerType(T)) |result| {
        const list = switch (result) {
            .array_list => this.items[0..],
            .baby_list => this.sliceConst(),
            .small_list => this.slice(),
        };
        bun.writeAnyToHasher(hasher, list.len);
        for (list) |*item| {
            hash(tyinfo.Array.child, item, hasher);
        }
        return;
    }
    if (comptime T == []const u8) {
        return hasher.update(this.*);
    }
    if (comptime @typeInfo(T) == .Pointer) {
        @compileError("Invalid type for implementHash(): " ++ @typeName(T));
    }
    if (comptime @typeInfo(T) == .Optional) {
        @compileError("Invalid type for implementHash(): " ++ @typeName(T));
    }
    return switch (tyinfo) {
        .Optional => {
            if (this.* == null) {
                bun.writeAnyToHasher(hasher, "null");
            } else {
                bun.writeAnyToHasher(hasher, "some");
                hash(tyinfo.Optional.child, &this.*.?, hasher);
            }
        },
        .Pointer => {
            hash(tyinfo.Pointer.child, &this.*, hasher);
        },
        .Array => {
            bun.writeAnyToHasher(hasher, this.len);
            for (this.*[0..]) |*item| {
                hash(tyinfo.Array.child, item, hasher);
            }
        },
        .Struct => {
            inline for (tyinfo.Struct.fields) |field| {
                if (comptime hasHash(field.type)) {
                    hash(field.type, &@field(this, field.name), hasher);
                } else if (@hasDecl(field.type, "__generateHash") and @typeInfo(field.type) == .Struct) {
                    implementHash(field.type, &@field(this, field.name), hasher);
                } else {
                    @compileError("Can't hash these fields: " ++ @typeName(field.type) ++ ". On " ++ @typeName(T));
                }
            }
            return;
        },
        .Enum => {
            bun.writeAnyToHasher(hasher, @intFromEnum(this.*));
        },
        .Union => {
            if (tyinfo.Union.tag_type == null) @compileError("Unions must have a tag type");
            bun.writeAnyToHasher(hasher, @intFromEnum(this.*));
            const enum_fields = bun.meta.EnumFields(T);
            inline for (enum_fields, std.meta.fields(T)) |enum_field, union_field| {
                if (enum_field.value == @intFromEnum(this.*)) {
                    const field = union_field;
                    if (comptime hasHash(field.type)) {
                        hash(field.type, &@field(this, field.name), hasher);
                    } else if (@hasDecl(field.type, "__generateHash") and @typeInfo(field.type) == .Struct) {
                        implementHash(field.type, &@field(this, field.name), hasher);
                    } else {
                        @compileError("Can't hash these fields: " ++ @typeName(field.type) ++ ". On " ++ @typeName(T));
                    }
                }
            }
            return;
        },
        else => @compileError("Unsupported type: " ++ @typeName(T)),
    };
}

pub fn slice(comptime T: type, val: *const T) []const bun.meta.looksLikeListContainerType(T).?.child {
    if (comptime bun.meta.looksLikeListContainerType(T)) |result| {
        return switch (result.list) {
            .array_list => val.items,
            .baby_list => val.sliceConst(),
            .small_list => val.slice(),
        };
    }
    @compileError("Unsupported type for `slice`: " ++ @typeName(T));
}

pub fn isCompatible(comptime T: type, val: *const T, browsers: bun.css.targets.Browsers) bool {
    if (@hasDecl(T, "isCompatible")) return T.isCompatible(val, browsers);
    const tyinfo = @typeInfo(T);
    if (tyinfo == .Pointer) {
        const TT = std.meta.Child(T);
        return isCompatible(TT, val.*, browsers);
    }
    if (comptime bun.meta.looksLikeListContainerType(T)) |result| {
        const slc = switch (result.list) {
            .array_list => val.items,
            .baby_list => val.sliceConst(),
            .small_list => val.sliceConst(),
        };
        for (slc) |*item| {
            if (!isCompatible(result.child, item, browsers)) return false;
        }
        return true;
    }
    @compileError("Unsupported type for `isCompatible`: " ++ @typeName(T));
}

pub inline fn parseWithOptions(comptime T: type, input: *Parser, options: *const ParserOptions) Result(T) {
    if (T != f32 and T != i32 and @hasDecl(T, "parseWithOptions")) return T.parseWithOptions(input, options);
    if (comptime bun.meta.looksLikeListContainerType(T)) |result| {
        switch (result.list) {
            .array_list => return input.parseCommaSeparated(result.child, parseFor(result.child)),
            .baby_list => {},
            .small_list => {},
        }
    }
    return switch (T) {
        f32 => CSSNumberFns.parse(input),
        CSSInteger => CSSIntegerFns.parse(input),
        CustomIdent => CustomIdentFns.parse(input),
        DashedIdent => DashedIdentFns.parse(input),
        Ident => IdentFns.parse(input),
        else => T.parse(input),
    };
}

pub inline fn parse(comptime T: type, input: *Parser) Result(T) {
    if (comptime @typeInfo(T) == .Pointer) {
        const TT = std.meta.Child(T);
        return switch (parse(TT, input)) {
            .result => |v| .{ .result = bun.create(input.allocator(), TT, v) },
            .err => |e| .{ .err = e },
        };
    }
    if (comptime @typeInfo(T) == .Optional) {
        const TT = std.meta.Child(T);
        return .{ .result = input.tryParse(parseFor(TT), .{}).asValue() };
    }
    if (comptime bun.meta.looksLikeListContainerType(T)) |result| {
        switch (result.list) {
            .array_list => return input.parseCommaSeparated(result.child, parseFor(result.child)),
            .baby_list => {},
            .small_list => {},
        }
    }
    return switch (T) {
        f32 => CSSNumberFns.parse(input),
        CSSInteger => CSSIntegerFns.parse(input),
        CustomIdent => CustomIdentFns.parse(input),
        DashedIdent => DashedIdentFns.parse(input),
        Ident => IdentFns.parse(input),
        else => T.parse(input),
    };
}

pub inline fn parseFor(comptime T: type) @TypeOf(struct {
    fn parsefn(input: *Parser) Result(T) {
        return parse(T, input);
    }
}.parsefn) {
    return struct {
        fn parsefn(input: *Parser) Result(T) {
            return parse(T, input);
        }
    }.parsefn;
}

pub fn hasToCss(comptime T: type) bool {
    const tyinfo = @typeInfo(T);
    if (comptime T == []const u8) return false;
    if (tyinfo == .Pointer) {
        const TT = std.meta.Child(T);
        return hasToCss(TT);
    }
    if (tyinfo == .Optional) {
        const TT = std.meta.Child(T);
        return hasToCss(TT);
    }
    if (comptime bun.meta.looksLikeListContainerType(T)) |result| {
        switch (result.list) {
            .array_list => return true,
            .baby_list => return true,
            .small_list => return true,
        }
    }
    return switch (T) {
        f32 => true,
        else => @hasDecl(T, "toCss"),
    };
}

pub inline fn toCss(comptime T: type, this: *const T, comptime W: type, dest: *Printer(W)) PrintErr!void {
    if (@typeInfo(T) == .Pointer) {
        const TT = std.meta.Child(T);
        return toCss(TT, this.*, W, dest);
    }
    if (@typeInfo(T) == .Optional) {
        const TT = std.meta.Child(T);

        if (this.*) |*val| {
            return toCss(TT, val, W, dest);
        }
        return;
    }
    if (comptime bun.meta.looksLikeListContainerType(T)) |result| {
        switch (result.list) {
            .array_list => {
                return css.to_css.fromList(result.child, this.items, W, dest);
            },
            .baby_list => @compileError("TODO"),
            .small_list => @compileError("TODO"),
        }
    }
    return switch (T) {
        f32 => CSSNumberFns.toCss(this, W, dest),
        CSSInteger => CSSIntegerFns.toCss(this, W, dest),
        CustomIdent => CustomIdentFns.toCss(this, W, dest),
        DashedIdent => DashedIdentFns.toCss(this, W, dest),
        Ident => IdentFns.toCss(this, W, dest),
        else => T.toCss(this, W, dest),
    };
}

pub fn eqlList(comptime T: type, lhs: *const ArrayList(T), rhs: *const ArrayList(T)) bool {
    if (lhs.items.len != rhs.items.len) return false;
    for (lhs.items, rhs.items) |*left, *right| {
        if (!eql(T, left, right)) return false;
    }
    return true;
}

pub fn canTransitivelyImplementEql(comptime T: type) bool {
    return switch (@typeInfo(T)) {
        .Struct, .Union => true,
        else => false,
    };
}

pub inline fn eql(comptime T: type, lhs: *const T, rhs: *const T) bool {
    const tyinfo = comptime @typeInfo(T);
    if (comptime tyinfo == .Pointer) {
        if (comptime T == []const u8) return bun.strings.eql(lhs.*, rhs.*);
        if (comptime tyinfo.Pointer.size == .One) {
            const TT = std.meta.Child(T);
            return eql(TT, lhs.*, rhs.*);
        } else if (comptime tyinfo.Pointer.size == .Slice) {
            if (lhs.*.len != rhs.*.len) return false;
            for (lhs.*[0..], rhs.*[0..]) |*a, *b| {
                if (!eql(tyinfo.Pointer.child, a, b)) return false;
            }
            return true;
        } else {
            @compileError("Unsupported pointer size: " ++ @tagName(tyinfo.Pointer.size) ++ " (" ++ @typeName(T) ++ ")");
        }
    }
    if (comptime tyinfo == .Optional) {
        const TT = std.meta.Child(T);
        if (lhs.* == null and rhs.* == null) return true;
        if (lhs.* != null and rhs.* != null) return eql(TT, &lhs.*.?, &rhs.*.?);
        return false;
    }
    if (comptime bun.meta.isSimpleEqlType(T)) {
        return lhs.* == rhs.*;
    }
    if (comptime bun.meta.looksLikeListContainerType(T)) |result| {
        return switch (result.list) {
            .array_list => eqlList(result.child, lhs, rhs),
            .baby_list => return lhs.eql(rhs),
            .small_list => lhs.eql(rhs),
        };
    }
    if (@hasDecl(T, "IMPL_BITFLAGS")) {
        return T.eql(lhs.*, rhs.*);
    }
    return switch (T) {
        f32 => lhs.* == rhs.*,
        CSSInteger => lhs.* == rhs.*,
        CustomIdent, DashedIdent, Ident => bun.strings.eql(lhs.v, rhs.v),
        []const u8 => bun.strings.eql(lhs.*, rhs.*),
        // css.VendorPrefix => css.VendorPrefix.eq(lhs.*, rhs.*),
        else => T.eql(lhs, rhs),
    };
}

pub fn canTransitivelyImplementDeepClone(comptime T: type) bool {
    return switch (@typeInfo(T)) {
        .Struct, .Union => true,
        else => false,
    };
}

pub inline fn deepClone(comptime T: type, this: *const T, allocator: Allocator) T {
    const tyinfo = comptime @typeInfo(T);
    if (comptime tyinfo == .Pointer) {
        if (comptime tyinfo.Pointer.size == .One) {
            const TT = std.meta.Child(T);
            return bun.create(allocator, TT, deepClone(TT, this.*, allocator));
        }
        if (comptime tyinfo.Pointer.size == .Slice) {
            var slc = allocator.alloc(tyinfo.Pointer.child, this.len) catch bun.outOfMemory();
            if (comptime bun.meta.isSimpleCopyType(tyinfo.Pointer.child) or tyinfo.Pointer.child == []const u8) {
                @memcpy(slc, this.*);
            } else {
                for (this.*, 0..) |*e, i| {
                    slc[i] = deepClone(tyinfo.Pointer.child, e, allocator);
                }
            }
            return slc;
        }
        @compileError("Deep clone not supported for this kind of pointer: " ++ @tagName(tyinfo.Pointer.size) ++ " (" ++ @typeName(T) ++ ")");
    }
    if (comptime tyinfo == .Optional) {
        const TT = std.meta.Child(T);
        if (this.* != null) return deepClone(TT, &this.*.?, allocator);
        return null;
    }
    if (comptime bun.meta.isSimpleCopyType(T)) {
        return this.*;
    }
    if (comptime bun.meta.looksLikeListContainerType(T)) |result| {
        return switch (result.list) {
            .array_list => css.deepClone(result.child, allocator, this),
            .baby_list => {
                return bun.BabyList(result.child).deepClone2(this, allocator);
            },
            .small_list => this.deepClone(allocator),
        };
    }
    // Strings in the CSS parser are always arena allocated
    // So it is safe to skip const strings as they will never be mutated
    if (comptime T == []const u8) {
        return this.*;
    }

    if (!@hasDecl(T, "deepClone")) {
        @compileError(@typeName(T) ++ " does not have a deepClone() function");
    }

    return T.deepClone(this, allocator);
}

const Angle = css_values.angle.Angle;
pub inline fn tryFromAngle(comptime T: type, angle: Angle) ?T {
    return switch (T) {
        CSSNumber => CSSNumberFns.tryFromAngle(angle),
        Angle => return Angle.tryFromAngle(angle),
        else => T.tryFromAngle(angle),
    };
}

pub inline fn trySign(comptime T: type, val: *const T) ?f32 {
    return switch (T) {
        CSSNumber => CSSNumberFns.sign(val),
        else => {
            if (@hasDecl(T, "sign")) return T.sign(val);
            return T.trySign(val);
        },
    };
}

pub inline fn tryMap(
    comptime T: type,
    val: *const T,
    comptime map_fn: *const fn (a: f32) f32,
) ?T {
    return switch (T) {
        CSSNumber => map_fn(val.*),
        else => {
            if (@hasDecl(T, "map")) return T.map(val, map_fn);
            return T.tryMap(val, map_fn);
        },
    };
}

pub inline fn tryOpTo(
    comptime T: type,
    comptime R: type,
    lhs: *const T,
    rhs: *const T,
    ctx: anytype,
    comptime op_fn: *const fn (@TypeOf(ctx), a: f32, b: f32) R,
) ?R {
    return switch (T) {
        CSSNumber => op_fn(ctx, lhs.*, rhs.*),
        else => {
            if (@hasDecl(T, "opTo")) return T.opTo(lhs, rhs, R, ctx, op_fn);
            return T.tryOpTo(lhs, rhs, R, ctx, op_fn);
        },
    };
}

pub inline fn tryOp(
    comptime T: type,
    lhs: *const T,
    rhs: *const T,
    ctx: anytype,
    comptime op_fn: *const fn (@TypeOf(ctx), a: f32, b: f32) f32,
) ?T {
    return switch (T) {
        Angle => Angle.tryOp(lhs, rhs, ctx, op_fn),
        CSSNumber => op_fn(ctx, lhs.*, rhs.*),
        else => {
            if (@hasDecl(T, "op")) return T.op(lhs, rhs, ctx, op_fn);
            return T.tryOp(lhs, rhs, ctx, op_fn);
        },
    };
}

pub inline fn partialCmp(comptime T: type, lhs: *const T, rhs: *const T) ?std.math.Order {
    return switch (T) {
        f32 => partialCmpF32(lhs, rhs),
        CSSInteger => std.math.order(lhs.*, rhs.*),
        css_values.angle.Angle => css_values.angle.Angle.partialCmp(lhs, rhs),
        else => T.partialCmp(lhs, rhs),
    };
}

pub inline fn partialCmpF32(lhs: *const f32, rhs: *const f32) ?std.math.Order {
    const lte = lhs.* <= rhs.*;
    const rte = lhs.* >= rhs.*;
    if (!lte and !rte) return null;
    if (!lte and rte) return .gt;
    if (lte and !rte) return .lt;
    return .eq;
}

pub const HASH_SEED: u64 = 0;

pub fn hashArrayList(comptime V: type, this: *const ArrayList(V), hasher: *std.hash.Wyhash) void {
    for (this.items) |*item| {
        hash(V, item, hasher);
    }
}
pub fn hashBabyList(comptime V: type, this: *const bun.BabyList(V), hasher: *std.hash.Wyhash) void {
    for (this.sliceConst()) |*item| {
        hash(V, item, hasher);
    }
}

pub fn hasHash(comptime T: type) bool {
    const tyinfo = @typeInfo(T);
    if (comptime T == []const u8) return true;
    if (comptime bun.meta.isSimpleEqlType(T)) return true;
    if (tyinfo == .Pointer) {
        const TT = std.meta.Child(T);
        return hasHash(TT);
    }
    if (tyinfo == .Optional) {
        const TT = std.meta.Child(T);
        return hasHash(TT);
    }
    if (comptime bun.meta.looksLikeListContainerType(T)) |result| {
        switch (result.list) {
            .array_list => return true,
            .baby_list => return true,
            .small_list => return true,
        }
    }
    return switch (T) {
        else => @hasDecl(T, "hash"),
    };
}

pub fn hash(comptime T: type, this: *const T, hasher: *std.hash.Wyhash) void {
    if (comptime T == void) return;
    const tyinfo = @typeInfo(T);
    if (comptime tyinfo == .Pointer and T != []const u8) {
        const TT = std.meta.Child(T);
        if (tyinfo.Pointer.size == .One) {
            return hash(TT, this.*, hasher);
        } else if (tyinfo.Pointer.size == .Slice) {
            for (this.*) |*item| {
                hash(TT, item, hasher);
            }
            return;
        } else {
            @compileError("Can't hash this pointer type: " ++ @typeName(T));
        }
    }
    if (comptime @typeInfo(T) == .Optional) {
        const TT = std.meta.Child(T);
        if (this.* != null) return hash(TT, &this.*.?, hasher);
        return;
    }
    if (comptime bun.meta.looksLikeListContainerType(T)) |result| {
        switch (result.list) {
            .array_list => return hashArrayList(result.child, this, hasher),
            .baby_list => return hashBabyList(result.child, this, hasher),
            .small_list => return this.hash(hasher),
        }
    }
    if (comptime bun.meta.isSimpleEqlType(T)) {
        const bytes = std.mem.asBytes(&this);
        hasher.update(bytes);
        return;
    }
    return switch (T) {
        []const u8 => hasher.update(this.*),
        else => T.hash(this, hasher),
    };
}
