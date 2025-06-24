const std = @import("std");
const bun = @import("bun");
pub const css = @import("../css_parser.zig");
const Result = css.Result;
const Printer = css.Printer;
const PrintErr = css.PrintErr;
const CSSNumberFns = css.css_values.number.CSSNumberFns;
const LengthPercentage = css.css_values.length.LengthPercentage;

/// A generic value that represents a value with two components, e.g. a border radius.
///
/// When serialized, only a single component will be written if both are equal.
pub fn Size2D(comptime T: type) type {
    return struct {
        a: T,
        b: T,

        fn parseVal(input: *css.Parser) Result(T) {
            return switch (T) {
                f32 => return CSSNumberFns.parse(input),
                LengthPercentage => return LengthPercentage.parse(input),
                else => T.parse(input),
            };
        }

        pub fn parse(input: *css.Parser) Result(Size2D(T)) {
            const first = switch (parseVal(input)) {
                .result => |vv| vv,
                .err => |e| return .{ .err = e },
            };
            const second = input.tryParse(parseVal, .{}).unwrapOr(first);
            return .{ .result = Size2D(T){
                .a = first,
                .b = second,
            } };
        }

        pub fn toCss(this: *const Size2D(T), comptime W: type, dest: *css.Printer(W)) css.PrintErr!void {
            try valToCss(&this.a, W, dest);
            if (!valEql(&this.b, &this.a)) {
                try dest.writeStr(" ");
                try valToCss(&this.b, W, dest);
            }
        }

        pub fn valToCss(val: *const T, comptime W: type, dest: *css.Printer(W)) css.PrintErr!void {
            return switch (T) {
                f32 => CSSNumberFns.toCss(val, W, dest),
                else => val.toCss(W, dest),
            };
        }

        pub fn isCompatible(this: *const @This(), browsers: bun.css.targets.Browsers) bool {
            return this.a.isCompatible(browsers) and this.b.isCompatible(browsers);
        }

        pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
            return css.implementDeepClone(@This(), this, allocator);
        }

        pub inline fn valEql(lhs: *const T, rhs: *const T) bool {
            return switch (T) {
                f32 => lhs.* == rhs.*,
                else => lhs.eql(rhs),
            };
        }

        pub inline fn eql(lhs: *const @This(), rhs: *const @This()) bool {
            return switch (T) {
                f32 => lhs.a == rhs.b,
                else => lhs.a.eql(&rhs.b),
            };
        }
    };
}
