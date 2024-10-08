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

pub inline fn parseWithOptions(comptime T: type, input: *Parser, options: *const ParserOptions) Result(T) {
    if (@hasDecl(T, "parseWithOptions")) return T.parseWithOptions(input, options);
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
    for (lhs.items, 0..) |*item, i| {
        if (!eql(T, item, &rhs.items[i])) return false;
    }
    return true;
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
        if (lhs.* != null and rhs.* != null) return eql(TT, &lhs.*.?, &rhs.*.?);
        return false;
    }
    if (comptime bun.meta.isSimpleEqlType(T)) {
        return lhs.* == rhs.*;
    }
    if (comptime bun.meta.looksLikeListContainerType(T)) |result| {
        return eqlList(result.child, lhs, rhs);
    }
    return switch (T) {
        f32 => lhs.* == rhs.*,
        CSSInteger => lhs.* == rhs.*,
        CustomIdent, DashedIdent, Ident => bun.strings.eql(lhs.v, rhs.v),
        []const u8 => bun.strings.eql(lhs.*, rhs.*),
        css.VendorPrefix => css.VendorPrefix.eq(lhs.*, rhs.*),
        else => T.eql(lhs, rhs),
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
            var slice = allocator.alloc(tyinfo.Pointer.child, this.len) catch bun.outOfMemory();
            if (comptime bun.meta.isSimpleCopyType(tyinfo.Pointer.child) or tyinfo.Pointer.child == []const u8) {
                @memcpy(slice, this.*);
            } else {
                for (this.*, 0..) |*e, i| {
                    slice[i] = deepClone(tyinfo.Pointer.child, &e, allocator);
                }
            }
            return slice;
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
            .baby_list => @panic("Not implemented."),
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
