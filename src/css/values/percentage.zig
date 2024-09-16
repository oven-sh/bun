const std = @import("std");
const bun = @import("root").bun;
pub const css = @import("../css_parser.zig");
const Result = css.Result;
const ArrayList = std.ArrayListUnmanaged;
const Printer = css.Printer;
const PrintErr = css.PrintErr;
const CSSNumber = css.css_values.number.CSSNumber;
const CSSNumberFns = css.css_values.number.CSSNumberFns;
const Calc = css.css_values.calc.Calc;

pub const Percentage = struct {
    v: CSSNumber,

    pub fn parse(input: *css.Parser) Result(Percentage) {
        if (input.tryParse(Calc(Percentage), .{}).asValue()) |calc_value| {
            if (calc_value == .value) |v| return v.*;
            // Percentages are always compatible, so they will always compute to a value.
            bun.unreachablePanic("Percentages are always compatible, so they will always compute to a value.", .{});
        }

        const percent = switch (input.expectPercentage()) {
            .result => |vv| vv,
            .err => |e| return .{ .err = e },
        };

        return .{ .result = Percentage{ .v = percent } };
    }

    pub fn toCss(this: *const @This(), comptime W: type, dest: *Printer(W)) PrintErr!void {
        const x = this.v * 100.0;
        const int_value: ?i32 = if ((x - @trunc(x)) == 0.0)
            @intFromFloat(this.v)
        else
            null;

        const percent = css.Token{ .percentage = .{
            .has_sign = this.v < 0.0,
            .unit_value = this.v,
            .int_value = int_value,
        } };

        if (this.v != 0.0 and @abs(this.v) < 0.01) {
            // TODO: is this the max length?
            var buf: [32]u8 = undefined;
            var fba = std.heap.FixedBufferAllocator.init(&buf);
            var string = std.ArrayList(u8).init(fba.allocator());
            const writer = string.writer();
            try percent.toCssGeneric(writer);
            if (this.v < 0.0) {
                try dest.writeChar('-');
                try dest.writeStr(bun.strings.trimLeadingPattern2(string.items, '-', '0'));
            } else {
                try dest.writeStr(bun.strings.trimLeadingChar(string.items, '0'));
            }
        } else {
            try percent.toCss(W, dest);
        }
    }

    pub fn mulF32(this: Percentage, _: std.mem.Allocator, other: f32) Percentage {
        return Percentage{ .v = this.v * other };
    }

    pub fn isZero(this: *const Percentage) bool {
        return this.v == 0.0;
    }

    pub fn sign(this: *const Percentage) f32 {
        return css.signfns.signF32(this.v);
    }

    pub fn trySign(this: *const Percentage) ?f32 {
        return this.sign();
    }
};

pub fn DimensionPercentage(comptime D: type) type {
    return union(enum) {
        dimension: D,
        percentage: Percentage,
        calc: *Calc(DimensionPercentage(D)),

        const This = @This();

        fn mulValueF32(lhs: D, allocator: std.mem.Allocator, rhs: f32) D {
            return switch (D) {
                f32 => lhs * rhs,
                else => lhs.mulF32(allocator, rhs),
            };
        }

        pub fn mulF32(this: This, allocator: std.mem.Allocator, other: f32) This {
            return switch (this) {
                .dimension => |d| .{ .dimension = mulValueF32(d, allocator, other) },
                .percentage => |p| .{ .percentage = p.mulF32(allocator, other) },
                .calc => |c| .{ .calc = bun.create(allocator, Calc(DimensionPercentage(D)), c.mulF32(allocator, other)) },
            };
        }

        pub fn parse(input: *css.Parser) Result(@This()) {
            if (input.tryParse(Calc(This, .{})).asValue()) |calc_value| {
                if (calc_value == .value) return calc_value.value.*;
                return .{
                    .calc = bun.create(input.allocator(), This, calc_value),
                };
            }

            if (input.tryParse(D.parse(), .{}).asValue()) |length| {
                return .{ .dimension = length };
            }

            if (input.tryParse(Percentage.parse, .{}).asValue()) |percentage| {
                return .{ .percentage = percentage };
            }

            return input.newErrorForNextToken();
        }

        pub fn toCss(this: *const @This(), comptime W: type, dest: *css.Printer(W)) css.PrintErr!void {
            return switch (this.*) {
                .dimension => |*length| length.toCss(W, dest),
                .percentage => |*per| per.toCss(W, dest),
                .calc => |calc| calc.toCss(W, dest),
            };
        }

        pub fn zero() This {
            return .{
                .percentage = .{
                    .value = switch (D) {
                        f32 => 0.0,
                        else => @compileError("TODO implement .zero() for " + @typeName(D)),
                    },
                },
            };
        }

        pub fn isZero(this: *const This) bool {
            return switch (this.*) {
                .dimension => |*d| switch (D) {
                    f32 => d == 0.0,
                    else => @compileError("TODO implement .isZero() for " + @typeName(D)),
                },
                .percentage => |*p| p.isZero(),
                else => false,
            };
        }

        pub fn trySign(this: *const This) ?f32 {
            return switch (this.*) {
                .dimension => |d| d.trySign(),
                .percentage => |p| p.trySign(),
                .calc => |c| c.trySign(),
            };
        }
    };
}

/// Either a `<number>` or `<percentage>`.
pub const NumberOrPercentage = union(enum) {
    /// A number.
    number: CSSNumber,
    /// A percentage.
    percentage: Percentage,

    // TODO: implement this
    // pub usingnamespace css.DeriveParse(@This());
    // pub usingnamespace css.DeriveToCss(@This());

    pub fn parse(input: *css.Parser) Result(NumberOrPercentage) {
        _ = input; // autofix
        @panic(css.todo_stuff.depth);
    }

    pub fn toCss(this: *const NumberOrPercentage, comptime W: type, dest: *css.Printer(W)) css.PrintErr!void {
        _ = this; // autofix
        _ = dest; // autofix
        @panic(css.todo_stuff.depth);
    }

    pub fn intoF32(this: *const @This()) f32 {
        return switch (this.*) {
            .number => this.number,
            .percentage => this.percentage.v(),
        };
    }
};
