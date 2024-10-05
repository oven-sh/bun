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
        if (input.tryParse(Calc(Percentage).parse, .{}).asValue()) |calc_value| {
            if (calc_value == .value) return .{ .result = calc_value.value.* };
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
            percent.toCssGeneric(writer) catch return dest.addFmtError();
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

    pub inline fn eql(this: *const Percentage, other: *const Percentage) bool {
        return this.v == other.v;
    }

    pub fn add(lhs: Percentage, _: std.mem.Allocator, rhs: Percentage) Percentage {
        return Percentage{ .v = lhs.v + rhs.v };
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

    pub fn partialCmp(this: *const Percentage, other: *const Percentage) ?std.math.Order {
        return css.generic.partialCmp(f32, &this.v, &other.v);
    }

    pub fn tryFromAngle(_: css.css_values.angle.Angle) ?Percentage {
        return null;
    }

    pub fn tryMap(_: *const Percentage, comptime _: *const fn (f32) f32) ?Percentage {
        // Percentages cannot be mapped because we don't know what they will resolve to.
        // For example, they might be positive or negative depending on what they are a
        // percentage of, which we don't know.
        return null;
    }

    pub fn op(
        this: *const Percentage,
        other: *const Percentage,
        ctx: anytype,
        comptime op_fn: *const fn (@TypeOf(ctx), a: f32, b: f32) f32,
    ) Percentage {
        return Percentage{ .v = op_fn(ctx, this.v, other.v) };
    }

    pub fn opTo(
        this: *const Percentage,
        other: *const Percentage,
        comptime R: type,
        ctx: anytype,
        comptime op_fn: *const fn (@TypeOf(ctx), a: f32, b: f32) R,
    ) R {
        return op_fn(ctx, this.v, other.v);
    }

    pub fn tryOp(
        this: *const Percentage,
        other: *const Percentage,
        ctx: anytype,
        comptime op_fn: *const fn (@TypeOf(ctx), a: f32, b: f32) f32,
    ) ?Percentage {
        return Percentage{ .v = op_fn(ctx, this.v, other.v) };
    }
};

fn needsDeepclone(comptime D: type) bool {
    return switch (D) {
        css.css_values.angle.Angle => false,
        css.css_values.length.LengthValue => false,
        else => @compileError("Can't tell if " ++ @typeName(D) ++ " needs deepclone, please add it to this switch statement."),
    };
}

pub fn DimensionPercentage(comptime D: type) type {
    const needs_deepclone = needsDeepclone(D);
    return union(enum) {
        dimension: D,
        percentage: Percentage,
        calc: *Calc(DimensionPercentage(D)),

        const This = @This();

        pub fn eql(this: *const This, other: *const This) bool {
            return switch (this.*) {
                .dimension => |*d| css.generic.eql(D, d, &other.dimension),
                .percentage => |*p| p.eql(&other.percentage),
                .calc => |calc| calc.eql(other.calc),
            };
        }

        pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) This {
            return switch (this.*) {
                .dimension => |d| if (comptime needs_deepclone) .{ .dimension = d.deepClone(allocator) } else this.*,
                .percentage => return this.*,
                .calc => |calc| .{ .calc = bun.create(allocator, Calc(DimensionPercentage(D)), calc.deepClone(allocator)) },
            };
        }

        pub fn deinit(this: *const @This(), allocator: std.mem.Allocator) void {
            return switch (this.*) {
                .dimension => |d| if (comptime @hasDecl(D, "deinit")) d.deinit(allocator),
                .percentage => {},
                .calc => |calc| calc.deinit(allocator),
            };
        }

        pub fn parse(input: *css.Parser) Result(@This()) {
            if (input.tryParse(Calc(This).parse, .{}).asValue()) |calc_value| {
                if (calc_value == .value) return .{ .result = calc_value.value.* };
                return .{ .result = .{
                    .calc = bun.create(input.allocator(), Calc(DimensionPercentage(D)), calc_value),
                } };
            }

            if (input.tryParse(D.parse, .{}).asValue()) |length| {
                return .{ .result = .{ .dimension = length } };
            }

            if (input.tryParse(Percentage.parse, .{}).asValue()) |percentage| {
                return .{ .result = .{ .percentage = percentage } };
            }

            return .{ .err = input.newErrorForNextToken() };
        }

        pub fn toCss(this: *const @This(), comptime W: type, dest: *css.Printer(W)) css.PrintErr!void {
            return switch (this.*) {
                .dimension => |*length| length.toCss(W, dest),
                .percentage => |*per| per.toCss(W, dest),
                .calc => |calc| calc.toCss(W, dest),
            };
        }

        pub fn zero() This {
            return This{ .dimension = switch (D) {
                f32 => 0.0,
                else => D.zero(),
            } };
        }

        pub fn isZero(this: *const This) bool {
            return switch (this.*) {
                .dimension => |*d| switch (D) {
                    f32 => d == 0.0,
                    else => d.isZero(),
                },
                .percentage => |*p| p.isZero(),
                else => false,
            };
        }

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

        pub fn add(this: This, allocator: std.mem.Allocator, other: This) This {
            _ = this; // autofix
            _ = allocator; // autofix
            _ = other; // autofix
            @panic(css.todo_stuff.depth);
        }

        pub fn partialCmp(this: *const This, other: *const This) ?std.math.Order {
            _ = this; // autofix
            _ = other; // autofix
            @panic(css.todo_stuff.depth);
        } // 128kb

        pub fn trySign(this: *const This) ?f32 {
            return switch (this.*) {
                .dimension => |*d| css.generic.trySign(@TypeOf(d.*), d),
                .percentage => |p| p.trySign(),
                .calc => |c| c.trySign(),
            };
        }

        pub fn tryFromAngle(angle: css.css_values.angle.Angle) ?This {
            return DimensionPercentage(D){
                .dimension = D.tryFromAngle(angle) orelse return null,
            };
        }

        pub fn tryMap(this: *const This, comptime mapfn: *const fn (f32) f32) ?This {
            return switch (this.*) {
                .dimension => |vv| if (css.generic.tryMap(D, &vv, mapfn)) |v| .{ .dimension = v } else null,
                else => null,
            };
        }

        pub fn tryOp(
            this: *const This,
            other: *const This,
            ctx: anytype,
            comptime op_fn: *const fn (@TypeOf(ctx), a: f32, b: f32) f32,
        ) ?This {
            if (this.* == .dimension and other.* == .dimension) return .{ .dimension = css.generic.tryOp(D, &this.dimension, &other.dimension, ctx, op_fn) orelse return null };
            if (this.* == .percentage and other.* == .percentage) return .{ .percentage = Percentage{ .v = op_fn(ctx, this.percentage.v, other.percentage.v) } };
            return null;
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
    pub usingnamespace css.DeriveParse(@This());
    pub usingnamespace css.DeriveToCss(@This());

    // pub fn parse(input: *css.Parser) Result(NumberOrPercentage) {
    //     _ = input; // autofix
    //     @panic(css.todo_stuff.depth);
    // }

    // pub fn toCss(this: *const NumberOrPercentage, comptime W: type, dest: *css.Printer(W)) css.PrintErr!void {
    //     _ = this; // autofix
    //     _ = dest; // autofix
    //     @panic(css.todo_stuff.depth);
    // }

    pub fn eql(this: *const NumberOrPercentage, other: *const NumberOrPercentage) bool {
        return switch (this.*) {
            .number => |*a| switch (other.*) {
                .number => a.* == other.number,
                .percentage => false,
            },
            .percentage => |*a| switch (other.*) {
                .number => false,
                .percentage => a.eql(&other.percentage),
            },
        };
    }

    pub fn intoF32(this: *const @This()) f32 {
        return switch (this.*) {
            .number => this.number,
            .percentage => this.percentage.v,
        };
    }
};
