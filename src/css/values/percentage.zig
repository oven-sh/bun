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
            try percent.toCss(W, &string);
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

    pub fn mulF32(this: Percentage, other: f32) Percentage {
        return Percentage{ .v = this.v * other };
    }

    pub fn isZero(this: *const Percentage) bool {
        return this.v == 0.0;
    }
};

pub fn DimensionPercentage(comptime D: type) type {
    return union(enum) {
        dimension: D,
        percentage: Percentage,
        calc: *Calc(DimensionPercentage(D)),

        const This = @This();

        pub fn parse(input: *css.Parser) Result(@This()) {
            if (input.tryParse(Calc(This, .{})).asValue()) |calc_value| {
                if (calc_value == .value) return calc_value.value.*;
                return .{
                    .calc = bun.create(@compileError(css.todo_stuff.think_about_allocator), This, calc_value),
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
            switch (this.*) {
                .dimension => |*length| return length.toCss(W, dest),
                .percentage => |*per| return per.toCss(W, dest),
                .calc => |calc| calc.toCss(W, dest),
            }
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
