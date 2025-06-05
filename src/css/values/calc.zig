const std = @import("std");
const bun = @import("bun");
const Allocator = std.mem.Allocator;
pub const css = @import("../css_parser.zig");
const Result = css.Result;
const ArrayList = std.ArrayListUnmanaged;
const Printer = css.Printer;
const PrintErr = css.PrintErr;
const Angle = css.css_values.angle.Angle;
const Length = css.css_values.length.Length;
const LengthValue = css.css_values.length.LengthValue;
const Percentage = css.css_values.percentage.Percentage;
const DimensionPercentage = css.css_values.percentage.DimensionPercentage;
const Time = css.css_values.time.Time;

const CSSNumber = css.css_values.number.CSSNumber;
const CSSNumberFns = css.css_values.number.CSSNumberFns;

const eql = css.generic.eql;
const deepClone = css.deepClone;

pub fn needsDeinit(comptime V: type) bool {
    return switch (V) {
        Length => true,
        DimensionPercentage(Angle) => true,
        DimensionPercentage(LengthValue) => true,
        Percentage => false,
        Angle => false,
        Time => false,
        f32 => false,
        else => @compileError("Can't tell if " ++ @typeName(V) ++ " needs deinit, please add it to the switch statement."),
    };
}

pub fn needsDeepclone(comptime V: type) bool {
    return switch (V) {
        Length => true,
        DimensionPercentage(Angle) => true,
        DimensionPercentage(LengthValue) => true,
        Percentage => false,
        Angle => false,
        Time => false,
        f32 => false,
        else => @compileError("Can't tell if " ++ @typeName(V) ++ " needs deepclone, please add it to the switch statement."),
    };
}

const Tag_ = enum(u8) {
    /// A literal value.
    value = 1,
    /// A literal number.
    number = 2,
    /// A sum of two calc expressions.
    sum = 4,
    /// A product of a number and another calc expression.
    product = 8,
    /// A math function, such as `calc()`, `min()`, or `max()`.
    function = 16,
};

const CalcUnit = enum {
    abs,
    acos,
    asin,
    atan,
    atan2,
    calc,
    clamp,
    cos,
    exp,
    hypot,
    log,
    max,
    min,
    mod,
    pow,
    rem,
    round,
    sign,
    sin,
    sqrt,
    tan,

    pub const Map = bun.ComptimeEnumMap(CalcUnit);
};

/// A mathematical expression used within the `calc()` function.
///
/// This type supports generic value types. Values such as `Length`, `Percentage`,
/// `Time`, and `Angle` support `calc()` expressions.
pub fn Calc(comptime V: type) type {
    const needs_deinit = needsDeinit(V);
    const needs_deepclone = needsDeepclone(V);

    return union(Tag) {
        /// A literal value.
        /// PERF: this pointer feels unnecessary if V is small
        value: *V,
        /// A literal number.
        number: CSSNumber,
        /// A sum of two calc expressions.
        sum: struct {
            left: *This,
            right: *This,
        },
        /// A product of a number and another calc expression.
        product: struct {
            number: CSSNumber,
            expression: *This,
        },
        /// A math function, such as `calc()`, `min()`, or `max()`.
        function: *MathFunction(V),

        const Tag = Tag_;

        const This = @This();

        pub fn deepClone(this: *const This, allocator: Allocator) This {
            return switch (this.*) {
                .value => |v| {
                    return .{
                        .value = bun.create(
                            allocator,
                            V,
                            if (needs_deepclone) v.deepClone(allocator) else v.*,
                        ),
                    };
                },
                .number => this.*,
                .sum => |sum| {
                    return .{ .sum = .{
                        .left = bun.create(allocator, This, sum.left.deepClone(allocator)),
                        .right = bun.create(allocator, This, sum.right.deepClone(allocator)),
                    } };
                },
                .product => |product| {
                    return .{
                        .product = .{
                            .number = product.number,
                            .expression = bun.create(allocator, This, product.expression.deepClone(allocator)),
                        },
                    };
                },
                .function => |function| {
                    return .{
                        .function = bun.create(
                            allocator,
                            MathFunction(V),
                            function.deepClone(allocator),
                        ),
                    };
                },
            };
        }

        pub fn deinit(this: *This, allocator: Allocator) void {
            return switch (this.*) {
                .value => |v| {
                    if (comptime needs_deinit) {
                        v.deinit(allocator);
                    }
                    allocator.destroy(this.value);
                },
                .number => {},
                .sum => |sum| {
                    sum.left.deinit(allocator);
                    sum.right.deinit(allocator);
                    allocator.destroy(sum.left);
                    allocator.destroy(sum.right);
                },
                .product => |product| {
                    product.expression.deinit(allocator);
                    allocator.destroy(product.expression);
                },
                .function => |function| {
                    function.deinit(allocator);
                    allocator.destroy(function);
                },
            };
        }

        pub fn eql(this: *const @This(), other: *const @This()) bool {
            return switch (this.*) {
                .value => |a| return other.* == .value and css.generic.eql(V, a, other.value),
                .number => |*a| return other.* == .number and css.generic.eql(f32, a, &other.number),
                .sum => |s| return other.* == .sum and s.left.eql(other.sum.left) and s.right.eql(other.sum.right),
                .product => |p| return other.* == .product and p.number == other.product.number and p.expression.eql(other.product.expression),
                .function => |f| return other.* == .function and f.eql(other.function),
            };
        }

        fn mulValueF32(lhs: V, allocator: Allocator, rhs: f32) V {
            return switch (V) {
                f32 => lhs * rhs,
                else => lhs.mulF32(allocator, rhs),
            };
        }

        // TODO: addValueOwned
        pub fn addValue(allocator: Allocator, lhs: V, rhs: V) V {
            return switch (V) {
                f32 => return lhs + rhs,
                else => lhs.addInternal(allocator, rhs),
            };
        }

        // TODO: intoValueOwned
        pub fn intoValue(this: @This(), allocator: std.mem.Allocator) V {
            switch (V) {
                Angle => return switch (this) {
                    .value => |v| v.*,
                    // TODO: give a better error message
                    else => bun.unreachablePanic("", .{}),
                },
                CSSNumber => return switch (this) {
                    .value => |v| v.*,
                    .number => |n| n,
                    // TODO: give a better error message
                    else => bun.unreachablePanic("", .{}),
                },
                Length => return Length{
                    .calc = bun.create(allocator, Calc(Length), this),
                },
                Percentage => return switch (this) {
                    .value => |v| v.*,
                    // TODO: give a better error message
                    else => bun.unreachablePanic("", .{}),
                },
                Time => return switch (this) {
                    .value => |v| v.*,
                    // TODO: give a better error message
                    else => bun.unreachablePanic("", .{}),
                },
                DimensionPercentage(LengthValue) => return DimensionPercentage(LengthValue){ .calc = bun.create(
                    allocator,
                    Calc(DimensionPercentage(LengthValue)),
                    this,
                ) },
                DimensionPercentage(Angle) => return DimensionPercentage(Angle){ .calc = bun.create(
                    allocator,
                    Calc(DimensionPercentage(Angle)),
                    this,
                ) },
                else => @compileError("Unimplemented, intoValue() for V = " ++ @typeName(V)),
            }
        }

        pub fn intoCalc(val: V, allocator: std.mem.Allocator) This {
            return switch (V) {
                f32 => .{ .value = bun.create(allocator, f32, val) },
                else => val.intoCalc(allocator),
            };
        }

        // TODO: change to addOwned()
        pub fn add(this: @This(), allocator: std.mem.Allocator, rhs: @This()) @This() {
            if (this == .value and rhs == .value) {
                // PERF: we can reuse the allocation here
                return intoCalc(addValue(allocator, this.value.*, rhs.value.*), allocator);
            } else if (this == .number and rhs == .number) {
                return .{ .number = this.number + rhs.number };
            } else if (this == .value) {
                // PERF: we can reuse the allocation here
                return intoCalc(addValue(allocator, this.value.*, intoValue(rhs, allocator)), allocator);
            } else if (rhs == .value) {
                // PERF: we can reuse the allocation here
                return intoCalc(addValue(allocator, intoValue(this, allocator), rhs.value.*), allocator);
            } else if (this == .function) {
                return This{
                    .sum = .{
                        .left = bun.create(allocator, This, this),
                        .right = bun.create(allocator, This, rhs),
                    },
                };
            } else if (rhs == .function) {
                return This{
                    .sum = .{
                        .left = bun.create(allocator, This, this),
                        .right = bun.create(allocator, This, rhs),
                    },
                };
            } else {
                return intoCalc(addValue(allocator, intoValue(this, allocator), intoValue(rhs, allocator)), allocator);
            }
        }

        // TODO: users of this and `parseWith` don't need the pointer and often throwaway heap allocated values immediately
        // use temp allocator or something?
        pub fn parse(input: *css.Parser) Result(This) {
            const Fn = struct {
                pub fn parseWithFn(_: void, _: []const u8) ?This {
                    return null;
                }
            };
            return parseWith(input, {}, Fn.parseWithFn);
        }

        pub fn parseWith(
            input: *css.Parser,
            ctx: anytype,
            comptime parseIdent: *const fn (@TypeOf(ctx), []const u8) ?This,
        ) Result(This) {
            const location = input.currentSourceLocation();
            const f = switch (input.expectFunction()) {
                .result => |v| v,
                .err => |e| return .{ .err = e },
            };

            switch (CalcUnit.Map.getAnyCase(f) orelse return .{ .err = location.newUnexpectedTokenError(.{ .ident = f }) }) {
                .calc => {
                    const Closure = struct {
                        ctx: @TypeOf(ctx),
                        pub fn parseNestedBlockFn(self: *@This(), i: *css.Parser) Result(This) {
                            return This.parseSum(i, self.ctx, parseIdent);
                        }
                    };
                    var closure = Closure{ .ctx = ctx };
                    const calc = switch (input.parseNestedBlock(This, &closure, Closure.parseNestedBlockFn)) {
                        .result => |vv| vv,
                        .err => |e| return .{ .err = e },
                    };
                    if (calc == .value or calc == .number) return .{ .result = calc };
                    return .{ .result = This{
                        .function = bun.create(
                            input.allocator(),
                            MathFunction(V),
                            MathFunction(V){ .calc = calc },
                        ),
                    } };
                },
                .min => {
                    const Closure = struct {
                        ctx: @TypeOf(ctx),
                        pub fn parseNestedBlockFn(self: *@This(), i: *css.Parser) Result(ArrayList(This)) {
                            return i.parseCommaSeparatedWithCtx(This, self, @This().parseOne);
                        }
                        pub fn parseOne(self: *@This(), i: *css.Parser) Result(This) {
                            return This.parseSum(i, self.ctx, parseIdent);
                        }
                    };
                    var closure = Closure{ .ctx = ctx };
                    var reduced = switch (input.parseNestedBlock(ArrayList(This), &closure, Closure.parseNestedBlockFn)) {
                        .result => |vv| vv,
                        .err => |e| return .{ .err = e },
                    };
                    // PERF(alloc): i don't like this additional allocation
                    // can we use stack fallback here if the common case is that there will be 1 argument?
                    This.reduceArgs(input.allocator(), &reduced, std.math.Order.lt);
                    // var reduced: ArrayList(This) = This.reduceArgs(&args, std.math.Order.lt);
                    if (reduced.items.len == 1) {
                        defer reduced.deinit(input.allocator());
                        return .{ .result = reduced.swapRemove(0) };
                    }
                    return .{ .result = This{
                        .function = bun.create(
                            input.allocator(),
                            MathFunction(V),
                            MathFunction(V){ .min = reduced },
                        ),
                    } };
                },
                .max => {
                    const Closure = struct {
                        ctx: @TypeOf(ctx),
                        pub fn parseNestedBlockFn(self: *@This(), i: *css.Parser) Result(ArrayList(This)) {
                            return i.parseCommaSeparatedWithCtx(This, self, @This().parseOne);
                        }
                        pub fn parseOne(self: *@This(), i: *css.Parser) Result(This) {
                            return This.parseSum(i, self.ctx, parseIdent);
                        }
                    };
                    var closure = Closure{ .ctx = ctx };
                    var reduced = switch (input.parseNestedBlock(ArrayList(This), &closure, Closure.parseNestedBlockFn)) {
                        .result => |vv| vv,
                        .err => |e| return .{ .err = e },
                    };
                    // PERF: i don't like this additional allocation
                    This.reduceArgs(input.allocator(), &reduced, std.math.Order.gt);
                    // var reduced: ArrayList(This) = This.reduceArgs(&args, std.math.Order.gt);
                    if (reduced.items.len == 1) {
                        return .{ .result = reduced.orderedRemove(0) };
                    }
                    return .{ .result = This{
                        .function = bun.create(
                            input.allocator(),
                            MathFunction(V),
                            MathFunction(V){ .max = reduced },
                        ),
                    } };
                },
                .clamp => {
                    const ClosureResult = struct { ?This, This, ?This };
                    const Closure = struct {
                        ctx: @TypeOf(ctx),

                        pub fn parseNestedBlock(self: *@This(), i: *css.Parser) Result(ClosureResult) {
                            const min = switch (This.parseSum(i, self, parseIdentWrapper)) {
                                .result => |vv| vv,
                                .err => |e| return .{ .err = e },
                            };
                            if (i.expectComma().asErr()) |e| return .{ .err = e };
                            const center = switch (This.parseSum(i, self, parseIdentWrapper)) {
                                .result => |vv| vv,
                                .err => |e| return .{ .err = e },
                            };
                            if (i.expectComma().asErr()) |e| return .{ .err = e };
                            const max = switch (This.parseSum(i, self, parseIdentWrapper)) {
                                .result => |vv| vv,
                                .err => |e| return .{ .err = e },
                            };
                            return .{ .result = .{ min, center, max } };
                        }

                        pub fn parseIdentWrapper(self: *@This(), ident: []const u8) ?This {
                            return parseIdent(self.ctx, ident);
                        }
                    };
                    var closure = Closure{
                        .ctx = ctx,
                    };
                    var min, var center, var max = switch (input.parseNestedBlock(
                        ClosureResult,
                        &closure,
                        Closure.parseNestedBlock,
                    )) {
                        .result => |vv| vv,
                        .err => |e| return .{ .err = e },
                    };

                    // According to the spec, the minimum should "win" over the maximum if they are in the wrong order.
                    const cmp = if (max != null and max.? == .value and center == .value)
                        css.generic.partialCmp(V, center.value, max.?.value)
                    else
                        null;

                    // If center is known to be greater than the maximum, replace it with maximum and remove the max argument.
                    // Otherwise, if center is known to be less than the maximum, remove the max argument.
                    if (cmp) |cmp_val| {
                        if (cmp_val == std.math.Order.gt) {
                            const val = max.?;
                            center = val;
                            max = null;
                        } else {
                            min = null;
                        }
                    }

                    const switch_val: u8 = (@as(u8, @intFromBool(min != null)) << 1) | (@as(u8, @intFromBool(min != null)));
                    // switch (min, max)
                    return .{ .result = switch (switch_val) {
                        0b00 => center,
                        0b10 => This{
                            .function = bun.create(
                                input.allocator(),
                                MathFunction(V),
                                MathFunction(V){
                                    .max = arr2(
                                        input.allocator(),
                                        min.?,
                                        center,
                                    ),
                                },
                            ),
                        },
                        0b01 => This{
                            .function = bun.create(
                                input.allocator(),
                                MathFunction(V),
                                MathFunction(V){
                                    .min = arr2(
                                        input.allocator(),
                                        max.?,
                                        center,
                                    ),
                                },
                            ),
                        },
                        0b11 => This{
                            .function = bun.create(
                                input.allocator(),
                                MathFunction(V),
                                MathFunction(V){
                                    .clamp = .{
                                        .min = min.?,
                                        .center = center,
                                        .max = max.?,
                                    },
                                },
                            ),
                        },
                        else => unreachable,
                    } };
                },
                .round => {
                    const Closure = struct {
                        ctx: @TypeOf(ctx),
                        pub fn parseNestedBlockFn(self: *@This(), i: *css.Parser) Result(This) {
                            const strategy = if (i.tryParse(RoundingStrategy.parse, .{}).asValue()) |s| brk: {
                                if (i.expectComma().asErr()) |e| return .{ .err = e };
                                break :brk s;
                            } else RoundingStrategy.default();

                            const OpAndFallbackCtx = struct {
                                strategy: RoundingStrategy,

                                pub fn op(this: *const @This(), a: f32, b: f32) f32 {
                                    return round({}, a, b, this.strategy);
                                }

                                pub fn fallback(this: *const @This(), a: This, b: This) MathFunction(V) {
                                    return MathFunction(V){
                                        .round = .{
                                            .strategy = this.strategy,
                                            .value = a,
                                            .interval = b,
                                        },
                                    };
                                }
                            };
                            var ctx_for_op_and_fallback = OpAndFallbackCtx{
                                .strategy = strategy,
                            };
                            return This.parseMathFn(
                                i,
                                &ctx_for_op_and_fallback,
                                OpAndFallbackCtx.op,
                                OpAndFallbackCtx.fallback,
                                self.ctx,
                                parseIdent,
                            );
                        }
                    };
                    var closure = Closure{
                        .ctx = ctx,
                    };
                    return input.parseNestedBlock(This, &closure, Closure.parseNestedBlockFn);
                },
                .rem => {
                    const Closure = struct {
                        ctx: @TypeOf(ctx),

                        pub fn parseNestedBlockFn(self: *@This(), i: *css.Parser) Result(This) {
                            return This.parseMathFn(
                                i,
                                {},
                                @This().rem,
                                mathFunctionRem,
                                self.ctx,
                                parseIdent,
                            );
                        }

                        pub fn rem(_: void, a: f32, b: f32) f32 {
                            return @mod(a, b);
                        }
                        pub fn mathFunctionRem(_: void, a: This, b: This) MathFunction(V) {
                            return MathFunction(V){
                                .rem = .{
                                    .dividend = a,
                                    .divisor = b,
                                },
                            };
                        }
                    };
                    var closure = Closure{
                        .ctx = ctx,
                    };
                    return input.parseNestedBlock(This, &closure, Closure.parseNestedBlockFn);
                },
                .mod => {
                    const Closure = struct {
                        ctx: @TypeOf(ctx),

                        pub fn parseNestedBlockFn(self: *@This(), i: *css.Parser) Result(This) {
                            return This.parseMathFn(
                                i,
                                {},
                                @This().modulo,
                                mathFunctionMod,
                                self.ctx,
                                parseIdent,
                            );
                        }

                        pub fn modulo(_: void, a: f32, b: f32) f32 {
                            // return ((a % b) + b) % b;
                            return @mod((@mod(a, b) + b), b);
                        }
                        pub fn mathFunctionMod(_: void, a: This, b: This) MathFunction(V) {
                            return MathFunction(V){
                                .mod_ = .{
                                    .dividend = a,
                                    .divisor = b,
                                },
                            };
                        }
                    };
                    var closure = Closure{
                        .ctx = ctx,
                    };
                    return input.parseNestedBlock(This, &closure, Closure.parseNestedBlockFn);
                },
                .sin => {
                    return This.parseTrig(input, .sin, false, ctx, parseIdent);
                },
                .cos => {
                    return This.parseTrig(input, .cos, false, ctx, parseIdent);
                },
                .tan => {
                    return This.parseTrig(input, .tan, false, ctx, parseIdent);
                },
                .asin => {
                    return This.parseTrig(input, .asin, true, ctx, parseIdent);
                },
                .acos => {
                    return This.parseTrig(input, .acos, true, ctx, parseIdent);
                },
                .atan => {
                    return This.parseTrig(input, .atan, true, ctx, parseIdent);
                },
                .atan2 => {
                    const Closure = struct {
                        ctx: @TypeOf(ctx),
                        pub fn parseNestedBlockFn(self: *@This(), i: *css.Parser) Result(This) {
                            const res = switch (This.parseAtan2(i, self.ctx, parseIdent)) {
                                .result => |v| v,
                                .err => |e| return .{ .err = e },
                            };
                            if (css.generic.tryFromAngle(V, res)) |v| {
                                return .{ .result = This{
                                    .value = bun.create(
                                        i.allocator(),
                                        V,
                                        v,
                                    ),
                                } };
                            }

                            return .{ .err = i.newCustomError(css.ParserError{ .invalid_value = {} }) };
                        }
                    };
                    var closure = Closure{ .ctx = ctx };
                    return input.parseNestedBlock(This, &closure, Closure.parseNestedBlockFn);
                },
                .pow => {
                    const Closure = struct {
                        ctx: @TypeOf(ctx),
                        pub fn parseNestedBlockFn(self: *@This(), i: *css.Parser) Result(This) {
                            const a = switch (This.parseNumeric(i, self.ctx, parseIdent)) {
                                .result => |vv| vv,
                                .err => |e| return .{ .err = e },
                            };

                            if (i.expectComma().asErr()) |e| return .{ .err = e };

                            const b = switch (This.parseNumeric(i, self.ctx, parseIdent)) {
                                .result => |vv| vv,
                                .err => |e| return .{ .err = e },
                            };

                            return .{ .result = This{
                                .number = bun.powf(a, b),
                            } };
                        }
                    };
                    var closure = Closure{ .ctx = ctx };
                    return input.parseNestedBlock(This, &closure, Closure.parseNestedBlockFn);
                },
                .log => {
                    const Closure = struct {
                        ctx: @TypeOf(ctx),
                        pub fn parseNestedBlockFn(self: *@This(), i: *css.Parser) Result(This) {
                            const value = switch (This.parseNumeric(i, self.ctx, parseIdent)) {
                                .result => |vv| vv,
                                .err => |e| return .{ .err = e },
                            };
                            if (i.tryParse(css.Parser.expectComma, .{}).isOk()) {
                                const base = switch (This.parseNumeric(i, self.ctx, parseIdent)) {
                                    .result => |vv| vv,
                                    .err => |e| return .{ .err = e },
                                };
                                return .{ .result = This{ .number = std.math.log(f32, base, value) } };
                            }
                            return .{ .result = This{ .number = std.math.log(f32, std.math.e, value) } };
                        }
                    };
                    var closure = Closure{ .ctx = ctx };
                    return input.parseNestedBlock(This, &closure, Closure.parseNestedBlockFn);
                },
                .sqrt => {
                    return This.parseNumericFn(input, .sqrt, ctx, parseIdent);
                },
                .exp => {
                    return This.parseNumericFn(input, .exp, ctx, parseIdent);
                },
                .hypot => {
                    const Closure = struct {
                        ctx: @TypeOf(ctx),
                        pub fn parseNestedBlockFn(self: *@This(), i: *css.Parser) Result(This) {
                            var args = switch (i.parseCommaSeparatedWithCtx(This, self, parseOne)) {
                                .result => |v| v,
                                .err => |e| return .{ .err = e },
                            };
                            const val = switch (This.parseHypot(i.allocator(), &args)) {
                                .result => |vv| vv,
                                .err => |e| return .{ .err = e },
                            };

                            if (val) |v| return .{ .result = v };

                            return .{ .result = This{
                                .function = bun.create(
                                    i.allocator(),
                                    MathFunction(V),
                                    MathFunction(V){ .hypot = args },
                                ),
                            } };
                        }

                        pub fn parseOne(self: *@This(), i: *css.Parser) Result(This) {
                            return This.parseSum(i, self.ctx, parseIdent);
                        }
                    };
                    var closure = Closure{ .ctx = ctx };
                    return input.parseNestedBlock(This, &closure, Closure.parseNestedBlockFn);
                },
                .abs => {
                    const Closure = struct {
                        ctx: @TypeOf(ctx),
                        pub fn parseNestedBlockFn(self: *@This(), i: *css.Parser) Result(This) {
                            const v = switch (This.parseSum(i, self.ctx, parseIdent)) {
                                .result => |vv| vv,
                                .err => |e| return .{ .err = e },
                            };
                            return .{
                                .result = if (This.applyMap(&v, i.allocator(), absf)) |vv| vv else This{
                                    .function = bun.create(
                                        i.allocator(),
                                        MathFunction(V),
                                        MathFunction(V){ .abs = v },
                                    ),
                                },
                            };
                        }
                    };
                    var closure = Closure{ .ctx = ctx };
                    return input.parseNestedBlock(This, &closure, Closure.parseNestedBlockFn);
                },
                .sign => {
                    const Closure = struct {
                        ctx: @TypeOf(ctx),
                        pub fn parseNestedBlockFn(self: *@This(), i: *css.Parser) Result(This) {
                            const v = switch (This.parseSum(i, self.ctx, parseIdent)) {
                                .result => |vv| vv,
                                .err => |e| return .{ .err = e },
                            };
                            switch (v) {
                                .number => |*n| return .{ .result = This{ .number = std.math.sign(n.*) } },
                                .value => |v2| {
                                    const MapFn = struct {
                                        pub fn sign(s: f32) f32 {
                                            return std.math.sign(s);
                                        }
                                    };
                                    // First map so we ignore percentages, which must be resolved to their
                                    // computed value in order to determine the sign.
                                    if (css.generic.tryMap(V, v2, MapFn.sign)) |new_v| {
                                        // sign() alwasy resolves to a number.
                                        return .{
                                            .result = This{
                                                // .number = css.generic.trySign(V, &new_v) orelse bun.unreachablePanic("sign always resolved to a number.", .{}),
                                                .number = css.generic.trySign(V, &new_v) orelse @panic("sign() always resolves to a number."),
                                            },
                                        };
                                    }
                                },
                                else => {},
                            }

                            return .{ .result = This{
                                .function = bun.create(
                                    i.allocator(),
                                    MathFunction(V),
                                    MathFunction(V){ .sign = v },
                                ),
                            } };
                        }
                    };
                    var closure = Closure{ .ctx = ctx };
                    return input.parseNestedBlock(This, &closure, Closure.parseNestedBlockFn);
                },
            }
        }

        pub fn parseNumericFn(input: *css.Parser, comptime op: enum { sqrt, exp }, ctx: anytype, comptime parse_ident: *const fn (@TypeOf(ctx), []const u8) ?This) Result(This) {
            const Closure = struct { ctx: @TypeOf(ctx) };
            var closure = Closure{ .ctx = ctx };
            return input.parseNestedBlock(This, &closure, struct {
                pub fn parseNestedBlockFn(self: *Closure, i: *css.Parser) Result(This) {
                    const v = switch (This.parseNumeric(i, self.ctx, parse_ident)) {
                        .result => |v| v,
                        .err => |e| return .{ .err = e },
                    };

                    return .{
                        .result = This{
                            .number = switch (op) {
                                .sqrt => std.math.sqrt(v),
                                .exp => std.math.exp(v),
                            },
                        },
                    };
                }
            }.parseNestedBlockFn);
        }

        pub fn parseMathFn(
            input: *css.Parser,
            ctx_for_op_and_fallback: anytype,
            comptime op: *const fn (@TypeOf(ctx_for_op_and_fallback), f32, f32) f32,
            comptime fallback: *const fn (@TypeOf(ctx_for_op_and_fallback), This, This) MathFunction(V),
            ctx_for_parse_ident: anytype,
            comptime parse_ident: *const fn (@TypeOf(ctx_for_parse_ident), []const u8) ?This,
        ) Result(This) {
            const a = switch (This.parseSum(input, ctx_for_parse_ident, parse_ident)) {
                .result => |vv| vv,
                .err => |e| return .{ .err = e },
            };
            if (input.expectComma().asErr()) |e| return .{ .err = e };
            const b = switch (This.parseSum(input, ctx_for_parse_ident, parse_ident)) {
                .result => |vv| vv,
                .err => |e| return .{ .err = e },
            };

            const val = This.applyOp(&a, &b, input.allocator(), ctx_for_op_and_fallback, op) orelse This{
                .function = bun.create(
                    input.allocator(),
                    MathFunction(V),
                    fallback(ctx_for_op_and_fallback, a, b),
                ),
            };

            return .{ .result = val };
        }

        pub fn parseSum(
            input: *css.Parser,
            ctx: anytype,
            comptime parse_ident: *const fn (@TypeOf(ctx), []const u8) ?This,
        ) Result(This) {
            var cur = switch (This.parseProduct(input, ctx, parse_ident)) {
                .result => |vv| vv,
                .err => |e| return .{ .err = e },
            };
            while (true) {
                const start = input.state();
                const tok = switch (input.nextIncludingWhitespace()) {
                    .result => |vv| vv,
                    .err => {
                        input.reset(&start);
                        break;
                    },
                };

                if (tok.* == .whitespace) {
                    if (input.isExhausted()) {
                        break; // allow trailing whitespace
                    }
                    const next_tok = switch (input.next()) {
                        .result => |vv| vv,
                        .err => |e| return .{ .err = e },
                    };
                    if (next_tok.* == .delim and next_tok.delim == '+') {
                        const next = switch (This.parseProduct(input, ctx, parse_ident)) {
                            .result => |vv| vv,
                            .err => |e| return .{ .err = e },
                        };
                        cur = cur.add(input.allocator(), next);
                    } else if (next_tok.* == .delim and next_tok.delim == '-') {
                        var rhs = switch (This.parseProduct(input, ctx, parse_ident)) {
                            .result => |vv| vv,
                            .err => |e| return .{ .err = e },
                        };
                        rhs = rhs.mulF32(input.allocator(), -1.0);
                        cur = cur.add(input.allocator(), rhs);
                    } else {
                        return .{ .err = input.newUnexpectedTokenError(next_tok.*) };
                    }
                    continue;
                }
                input.reset(&start);
                break;
            }

            return .{ .result = cur };
        }

        pub fn parseProduct(
            input: *css.Parser,
            ctx: anytype,
            comptime parse_ident: *const fn (@TypeOf(ctx), []const u8) ?This,
        ) Result(This) {
            var node = switch (This.parseValue(input, ctx, parse_ident)) {
                .result => |vv| vv,
                .err => |e| return .{ .err = e },
            };
            while (true) {
                const start = input.state();
                const tok = switch (input.next()) {
                    .result => |vv| vv,
                    .err => {
                        input.reset(&start);
                        break;
                    },
                };

                if (tok.* == .delim and tok.delim == '*') {
                    // At least one of the operands must be a number.
                    const rhs = switch (This.parseValue(input, ctx, parse_ident)) {
                        .result => |vv| vv,
                        .err => |e| return .{ .err = e },
                    };
                    if (rhs == .number) {
                        node = node.mulF32(input.allocator(), rhs.number);
                    } else if (node == .number) {
                        const val = node.number;
                        node = rhs;
                        node = node.mulF32(input.allocator(), val);
                    } else {
                        return .{ .err = input.newUnexpectedTokenError(.{ .delim = '*' }) };
                    }
                } else if (tok.* == .delim and tok.delim == '/') {
                    const rhs = switch (This.parseValue(input, ctx, parse_ident)) {
                        .result => |vv| vv,
                        .err => |e| return .{ .err = e },
                    };
                    if (rhs == .number) {
                        const val = rhs.number;
                        if (val != 0.0) {
                            node = node.mulF32(input.allocator(), 1.0 / val);
                            continue;
                        }
                    }
                    return .{ .err = input.newCustomError(css.ParserError{ .invalid_value = {} }) };
                } else {
                    input.reset(&start);
                    break;
                }
            }
            return .{ .result = node };
        }

        pub fn parseValue(
            input: *css.Parser,
            ctx: anytype,
            comptime parse_ident: *const fn (@TypeOf(ctx), []const u8) ?This,
        ) Result(This) {
            // Parse nested calc() and other math functions.
            if (input.tryParse(This.parse, .{}).asValue()) |_calc| {
                const calc: This = _calc;
                switch (calc) {
                    .function => |f| return switch (f.*) {
                        .calc => |c| .{ .result = c },
                        else => .{ .result = .{ .function = f } },
                    },
                    else => return .{ .result = calc },
                }
            }

            if (input.tryParse(css.Parser.expectParenthesisBlock, .{}).isOk()) {
                const Closure = struct {
                    ctx: @TypeOf(ctx),
                    pub fn parseNestedBlockFn(self: *@This(), i: *css.Parser) Result(This) {
                        return This.parseSum(i, self.ctx, parse_ident);
                    }
                };
                var closure = Closure{
                    .ctx = ctx,
                };
                return input.parseNestedBlock(This, &closure, Closure.parseNestedBlockFn);
            }

            if (input.tryParse(css.Parser.expectNumber, .{}).asValue()) |num| {
                return .{ .result = .{ .number = num } };
            }

            if (input.tryParse(Constant.parse, .{}).asValue()) |constant| {
                return .{ .result = .{ .number = constant.intoF32() } };
            }

            const location = input.currentSourceLocation();
            if (input.tryParse(css.Parser.expectIdent, .{}).asValue()) |ident| {
                if (parse_ident(ctx, ident)) |c| {
                    return .{ .result = c };
                }

                return .{ .err = location.newUnexpectedTokenError(.{ .ident = ident }) };
            }

            const value = switch (input.tryParse(css.generic.parseFor(V), .{})) {
                .result => |vv| vv,
                .err => |e| return .{ .err = e },
            };
            return .{ .result = .{
                .value = bun.create(
                    input.allocator(),
                    V,
                    value,
                ),
            } };
        }

        pub fn parseTrig(
            input: *css.Parser,
            comptime trig_fn_kind: enum {
                sin,
                cos,
                tan,
                asin,
                acos,
                atan,
            },
            to_angle: bool,
            ctx: anytype,
            comptime parse_ident: *const fn (@TypeOf(ctx), []const u8) ?This,
        ) Result(This) {
            const trig_fn = struct {
                pub fn run(x: f32) f32 {
                    const mathfn = comptime switch (trig_fn_kind) {
                        .sin => std.math.sin,
                        .cos => std.math.cos,
                        .tan => std.math.tan,
                        .asin => std.math.asin,
                        .acos => std.math.acos,
                        .atan => std.math.atan,
                    };
                    return mathfn(x);
                }
            };
            const Closure = struct {
                ctx: @TypeOf(ctx),
                to_angle: bool,

                pub fn parseNestedBockFn(this: *@This(), i: *css.Parser) Result(This) {
                    const v = switch (Calc(Angle).parseSum(
                        i,
                        this,
                        @This().parseIdentFn,
                    )) {
                        .result => |vv| vv,
                        .err => |e| return .{ .err = e },
                    };

                    const rad = rad: {
                        switch (v) {
                            .value => |angle| {
                                if (!this.to_angle) break :rad trig_fn.run(angle.toRadians());
                            },
                            .number => break :rad trig_fn.run(v.number),
                            else => {},
                        }
                        return .{ .err = i.newCustomError(css.ParserError{ .invalid_value = {} }) };
                    };

                    if (this.to_angle and !std.math.isNan(rad)) {
                        if (css.generic.tryFromAngle(V, .{ .rad = rad })) |val| {
                            return .{ .result = .{
                                .value = bun.create(
                                    i.allocator(),
                                    V,
                                    val,
                                ),
                            } };
                        }
                        return .{ .err = i.newCustomError(css.ParserError{ .invalid_value = {} }) };
                    } else {
                        return .{ .result = .{ .number = rad } };
                    }
                }

                pub fn parseIdentFn(this: *@This(), ident: []const u8) ?Calc(Angle) {
                    const v = parse_ident(this.ctx, ident) orelse return null;
                    if (v == .number) return .{ .number = v.number };
                    return null;
                }
            };
            var closure = Closure{
                .ctx = ctx,
                .to_angle = to_angle,
            };
            return input.parseNestedBlock(This, &closure, Closure.parseNestedBockFn);
        }

        pub fn ParseIdentNone(comptime Ctx: type, comptime Value: type) type {
            return struct {
                pub fn func(_: Ctx, _: []const u8) ?Calc(Value) {
                    return null;
                }
            };
        }

        pub fn parseAtan2(
            input: *css.Parser,
            ctx: anytype,
            comptime parse_ident: *const fn (@TypeOf(ctx), []const u8) ?This,
        ) Result(Angle) {
            const Ctx = @TypeOf(ctx);

            // atan2 supports arguments of any <number>, <dimension>, or <percentage>, even ones that wouldn't
            // normally be supported by V. The only requirement is that the arguments be of the same type.
            // Try parsing with each type, and return the first one that parses successfully.
            if (tryParseAtan2Args(Ctx, Length, input, ctx).asValue()) |v| {
                return .{ .result = v };
            }

            if (tryParseAtan2Args(Ctx, Percentage, input, ctx).asValue()) |v| {
                return .{ .result = v };
            }

            if (tryParseAtan2Args(Ctx, Angle, input, ctx).asValue()) |v| {
                return .{ .result = v };
            }

            if (tryParseAtan2Args(Ctx, Time, input, ctx).asValue()) |v| {
                return .{ .result = v };
            }

            const Closure = struct {
                ctx: @TypeOf(ctx),

                pub fn parseIdentFn(self: *@This(), ident: []const u8) ?Calc(CSSNumber) {
                    const v = parse_ident(self.ctx, ident) orelse return null;
                    if (v == .number) return .{ .number = v.number };
                    return null;
                }
            };
            var closure = Closure{
                .ctx = ctx,
            };
            return Calc(CSSNumber).parseAtan2Args(input, &closure, Closure.parseIdentFn);
        }

        inline fn tryParseAtan2Args(
            comptime Ctx: type,
            comptime Value: type,
            input: *css.Parser,
            ctx: Ctx,
        ) Result(Angle) {
            const func = ParseIdentNone(Ctx, Value).func;
            return input.tryParseImpl(Result(Angle), Calc(Value).parseAtan2Args, .{ input, ctx, func });
        }

        pub fn parseAtan2Args(
            input: *css.Parser,
            ctx: anytype,
            comptime parse_ident: *const fn (@TypeOf(ctx), []const u8) ?This,
        ) Result(Angle) {
            const a = switch (This.parseSum(input, ctx, parse_ident)) {
                .result => |vv| vv,
                .err => |e| return .{ .err = e },
            };
            if (input.expectComma().asErr()) |e| return .{ .err = e };
            const b = switch (This.parseSum(input, ctx, parse_ident)) {
                .result => |vv| vv,
                .err => |e| return .{ .err = e },
            };

            if (a == .value and b == .value) {
                const Fn = struct {
                    pub fn opToFn(_: void, x: f32, y: f32) Angle {
                        return .{ .rad = std.math.atan2(x, y) };
                    }
                };
                if (css.generic.tryOpTo(V, Angle, a.value, b.value, {}, Fn.opToFn)) |v| {
                    return .{ .result = v };
                }
            } else if (a == .number and b == .number) {
                return .{ .result = Angle{ .rad = std.math.atan2(a.number, b.number) } };
            } else {
                // doo nothing
            }

            // We don't have a way to represent arguments that aren't angles, so just error.
            // This will fall back to an unparsed property, leaving the atan2() function intact.
            return .{ .err = input.newCustomError(css.ParserError{ .invalid_value = {} }) };
        }

        pub fn parseNumeric(
            input: *css.Parser,
            ctx: anytype,
            comptime parse_ident: *const fn (@TypeOf(ctx), []const u8) ?This,
        ) Result(f32) {
            const Closure = struct {
                ctx: @TypeOf(ctx),

                pub fn parseIdentFn(self: *@This(), ident: []const u8) ?Calc(CSSNumber) {
                    const v = parse_ident(self.ctx, ident) orelse return null;
                    if (v == .number) return .{ .number = v.number };
                    return null;
                }
            };
            var closure = Closure{
                .ctx = ctx,
            };
            const v: Calc(CSSNumber) = switch (Calc(CSSNumber).parseSum(input, &closure, Closure.parseIdentFn)) {
                .result => |v| v,
                .err => |e| return .{ .err = e },
            };
            const val = switch (v) {
                .number => v.number,
                .value => v.value.*,
                else => return .{ .err = input.newCustomError(css.ParserError.invalid_value) },
            };
            return .{ .result = val };
        }

        pub fn parseHypot(allocator: Allocator, args: *ArrayList(This)) Result(?This) {
            if (args.items.len == 1) {
                const v = args.items[0];
                args.items[0] = This{ .number = 0 };
                return .{ .result = v };
            }

            if (args.items.len == 2) {
                return .{ .result = This.applyOp(&args.items[0], &args.items[1], allocator, {}, hypot) };
            }

            var i: usize = 0;
            const first = if (This.applyMap(
                &args.items[0],
                allocator,
                powi2,
            )) |v| v else return .{ .result = null };
            i += 1;
            var errored: bool = false;
            var sum: This = first;
            for (args.items[i..]) |*arg| {
                const Fn = struct {
                    pub fn applyOpFn(_: void, a: f32, b: f32) f32 {
                        return a + bun.powf(b, 2);
                    }
                };
                sum = This.applyOp(&sum, arg, allocator, {}, Fn.applyOpFn) orelse {
                    errored = true;
                    break;
                };
            }

            if (errored) return .{ .result = null };

            return .{ .result = This.applyMap(&sum, allocator, sqrtf32) };
        }

        pub fn applyOp(
            a: *const This,
            b: *const This,
            allocator: std.mem.Allocator,
            ctx: anytype,
            comptime op: *const fn (@TypeOf(ctx), f32, f32) f32,
        ) ?This {
            if (a.* == .value and b.* == .value) {
                if (css.generic.tryOp(V, a.value, b.value, ctx, op)) |v| {
                    return This{
                        .value = bun.create(
                            allocator,
                            V,
                            v,
                        ),
                    };
                }
                return null;
            }

            if (a.* == .number and b.* == .number) {
                return This{
                    .number = op(ctx, a.number, b.number),
                };
            }

            return null;
        }

        pub fn applyMap(this: *const This, allocator: Allocator, comptime op: *const fn (f32) f32) ?This {
            switch (this.*) {
                .number => |n| return This{ .number = op(n) },
                .value => |v| {
                    if (css.generic.tryMap(V, v, op)) |new_v| {
                        return This{
                            .value = bun.create(
                                allocator,
                                V,
                                new_v,
                            ),
                        };
                    }
                },
                else => {},
            }

            return null;
        }

        pub fn toCss(this: *const @This(), comptime W: type, dest: *css.Printer(W)) css.PrintErr!void {
            const was_in_calc = dest.in_calc;
            dest.in_calc = true;

            const res = toCssImpl(this, W, dest);

            dest.in_calc = was_in_calc;
            return res;
        }

        pub fn toCssImpl(this: *const @This(), comptime W: type, dest: *css.Printer(W)) css.PrintErr!void {
            return switch (this.*) {
                .value => |v| v.toCss(W, dest),
                .number => |n| CSSNumberFns.toCss(&n, W, dest),
                .sum => |sum| {
                    const a = sum.left;
                    const b = sum.right;
                    try a.toCss(W, dest);
                    // White space is always required.
                    if (b.isSignNegative()) {
                        try dest.writeStr(" - ");
                        var b2 = b.deepClone(dest.allocator).mulF32(dest.allocator, -1.0);
                        defer b2.deinit(dest.allocator);
                        try b2.toCss(W, dest);
                    } else {
                        try dest.writeStr(" + ");
                        try b.toCss(W, dest);
                    }
                    return;
                },
                .product => {
                    const num = this.product.number;
                    const calc = this.product.expression;
                    if (@abs(num) < 1.0) {
                        const div = 1.0 / num;
                        try calc.toCss(W, dest);
                        try dest.delim('/', true);
                        try CSSNumberFns.toCss(&div, W, dest);
                    } else {
                        try CSSNumberFns.toCss(&num, W, dest);
                        try dest.delim('*', true);
                        try calc.toCss(W, dest);
                    }
                },
                .function => |f| return f.toCss(W, dest),
            };
        }

        pub fn trySign(this: *const @This()) ?f32 {
            return switch (this.*) {
                .value => |v| return switch (V) {
                    f32 => css.signfns.signF32(v),
                    else => v.trySign(),
                },
                .number => |n| css.signfns.signF32(n),
                else => null,
            };
        }

        pub fn isSignNegative(this: *const @This()) bool {
            return css.signfns.isSignNegative(this.trySign() orelse return false);
        }

        pub fn mulF32(this: @This(), allocator: Allocator, other: f32) This {
            if (other == 1.0) {
                return this;
            }

            return switch (this) {
                // PERF: why not reuse the allocation here?
                .value => This{ .value = bun.create(allocator, V, mulValueF32(this.value.*, allocator, other)) },
                .number => This{ .number = this.number * other },
                // PERF: why not reuse the allocation here?
                .sum => This{ .sum = .{
                    .left = bun.create(
                        allocator,
                        This,
                        this.sum.left.mulF32(allocator, other),
                    ),
                    .right = bun.create(
                        allocator,
                        This,
                        this.sum.right.mulF32(allocator, other),
                    ),
                } },
                .product => {
                    const num = this.product.number * other;
                    if (num == 1.0) {
                        return this.product.expression.*;
                    }
                    return This{
                        .product = .{
                            .number = num,
                            .expression = this.product.expression,
                        },
                    };
                },
                .function => switch (this.function.*) {
                    // PERF: why not reuse the allocation here?
                    .calc => This{
                        .function = bun.create(
                            allocator,
                            MathFunction(V),
                            MathFunction(V){
                                .calc = this.function.calc.mulF32(allocator, other),
                            },
                        ),
                    },
                    else => This{
                        .product = .{
                            .number = other,
                            .expression = bun.create(allocator, This, this),
                        },
                    },
                },
            };
        }

        /// PERF:
        /// I don't like how this function requires allocating a second ArrayList
        /// I am pretty sure we could do this reduction in place, or do it as the
        /// arguments are being parsed.
        fn reduceArgs(allocator: Allocator, args: *ArrayList(This), order: std.math.Order) void {
            // Reduces the arguments of a min() or max() expression, combining compatible values.
            // e.g. min(1px, 1em, 2px, 3in) => min(1px, 1em)
            var reduced = ArrayList(This){};

            for (args.items) |*arg| {
                var found: ??*This = null;
                switch (arg.*) {
                    .value => |val| {
                        for (reduced.items) |*b| {
                            switch (b.*) {
                                .value => |v| {
                                    const result = css.generic.partialCmp(V, val, v);
                                    if (result != null) {
                                        if (result == order) {
                                            found = b;
                                            break;
                                        } else {
                                            found = @as(?*This, null);
                                            break;
                                        }
                                    }
                                },
                                else => {},
                            }
                        }
                    },
                    else => {},
                }

                if (found) |__r| {
                    if (__r) |r| {
                        r.* = arg.*;
                        // set to dummy value since we moved it into `reduced`
                        arg.* = This{ .number = 420 };
                        continue;
                    }
                } else {
                    reduced.append(allocator, arg.*) catch bun.outOfMemory();
                    // set to dummy value since we moved it into `reduced`
                    arg.* = This{ .number = 420 };
                    continue;
                }
                arg.deinit(allocator);
                arg.* = This{ .number = 420 };
            }

            css.deepDeinit(This, allocator, args);
            args.* = reduced;
        }

        pub fn isCompatible(this: *const @This(), browsers: css.targets.Browsers) bool {
            return switch (this.*) {
                .sum => |*args| return args.left.isCompatible(browsers) and args.right.isCompatible(browsers),
                .product => |*args| return args.expression.isCompatible(browsers),
                .function => |f| f.isCompatible(browsers),
                .value => |v| v.isCompatible(browsers),
                .number => true,
            };
        }
    };
}

/// A CSS math function.
///
/// Math functions may be used in most properties and values that accept numeric
/// values, including lengths, percentages, angles, times, etc.
pub fn MathFunction(comptime V: type) type {
    return union(enum) {
        /// The `calc()` function.
        calc: ThisCalc,
        /// The `min()` function.
        min: ArrayList(ThisCalc),
        /// The `max()` function.
        max: ArrayList(ThisCalc),
        /// The `clamp()` function.
        clamp: struct {
            min: ThisCalc,
            center: ThisCalc,
            max: ThisCalc,
        },
        /// The `round()` function.
        round: struct {
            strategy: RoundingStrategy,
            value: ThisCalc,
            interval: ThisCalc,
        },
        /// The `rem()` function.
        rem: struct {
            dividend: ThisCalc,
            divisor: ThisCalc,
        },
        /// The `mod()` function.
        mod_: struct {
            dividend: ThisCalc,
            divisor: ThisCalc,
        },
        /// The `abs()` function.
        abs: ThisCalc,
        /// The `sign()` function.
        sign: ThisCalc,
        /// The `hypot()` function.
        hypot: ArrayList(ThisCalc),

        const ThisCalc = Calc(V);

        pub fn eql(this: *const @This(), other: *const @This()) bool {
            return switch (this.*) {
                .calc => |a| return other.* == .calc and a.eql(&other.calc),
                .min => |*a| return other.* == .min and css.generic.eqlList(ThisCalc, a, &other.min),
                .max => |*a| return other.* == .max and css.generic.eqlList(ThisCalc, a, &other.max),
                .clamp => |*a| return other.* == .clamp and a.min.eql(&other.clamp.min) and a.center.eql(&other.clamp.center) and a.max.eql(&other.clamp.max),
                .round => |*a| return other.* == .round and a.strategy == other.round.strategy and a.value.eql(&other.round.value) and a.interval.eql(&other.round.interval),
                .rem => |*a| return other.* == .rem and a.dividend.eql(&other.rem.dividend) and a.divisor.eql(&other.rem.divisor),
                .mod_ => |*a| return other.* == .mod_ and a.dividend.eql(&other.mod_.dividend) and a.divisor.eql(&other.mod_.divisor),
                .abs => |*a| return other.* == .abs and a.eql(&other.abs),
                .sign => |*a| return other.* == .sign and a.eql(&other.sign),
                .hypot => |*a| return other.* == .hypot and css.generic.eqlList(ThisCalc, a, &other.hypot),
            };
        }

        pub fn deepClone(this: *const @This(), allocator: Allocator) @This() {
            return switch (this.*) {
                .calc => |*calc| .{ .calc = calc.deepClone(allocator) },
                .min => |*min| .{ .min = css.deepClone(ThisCalc, allocator, min) },
                .max => |*max| .{ .max = css.deepClone(ThisCalc, allocator, max) },
                .clamp => |*clamp| .{
                    .clamp = .{
                        .min = clamp.min.deepClone(allocator),
                        .center = clamp.center.deepClone(allocator),
                        .max = clamp.max.deepClone(allocator),
                    },
                },
                .round => |*rnd| .{ .round = .{
                    .strategy = rnd.strategy,
                    .value = rnd.value.deepClone(allocator),
                    .interval = rnd.interval.deepClone(allocator),
                } },
                .rem => |*rem| .{ .rem = .{
                    .dividend = rem.dividend.deepClone(allocator),
                    .divisor = rem.divisor.deepClone(allocator),
                } },
                .mod_ => |*mod_| .{ .mod_ = .{
                    .dividend = mod_.dividend.deepClone(allocator),
                    .divisor = mod_.divisor.deepClone(allocator),
                } },
                .abs => |*abs| .{ .abs = abs.deepClone(allocator) },
                .sign => |*sign| .{ .sign = sign.deepClone(allocator) },
                .hypot => |*hyp| .{
                    .hypot = css.deepClone(ThisCalc, allocator, hyp),
                },
            };
        }

        pub fn deinit(this: *@This(), allocator: Allocator) void {
            switch (this.*) {
                .calc => |*calc| calc.deinit(allocator),
                .min => |*min| css.deepDeinit(ThisCalc, allocator, min),
                .max => |*max| css.deepDeinit(ThisCalc, allocator, max),
                .clamp => |*clamp| {
                    clamp.min.deinit(allocator);
                    clamp.center.deinit(allocator);
                    clamp.max.deinit(allocator);
                },
                .round => |*rnd| {
                    rnd.value.deinit(allocator);
                    rnd.interval.deinit(allocator);
                },
                .rem => |*rem| {
                    rem.dividend.deinit(allocator);
                    rem.divisor.deinit(allocator);
                },
                .mod_ => |*mod_| {
                    mod_.dividend.deinit(allocator);
                    mod_.divisor.deinit(allocator);
                },
                .abs => |*abs| {
                    abs.deinit(allocator);
                },
                .sign => |*sign| {
                    sign.deinit(allocator);
                },
                .hypot => |*hyp| {
                    css.deepDeinit(ThisCalc, allocator, hyp);
                },
            }
        }

        pub fn toCss(this: *const @This(), comptime W: type, dest: *css.Printer(W)) css.PrintErr!void {
            return switch (this.*) {
                .calc => |*calc| {
                    try dest.writeStr("calc(");
                    try calc.toCss(W, dest);
                    try dest.writeChar(')');
                },
                .min => |*args| {
                    try dest.writeStr("min(");
                    var first = true;
                    for (args.items) |*arg| {
                        if (first) {
                            first = false;
                        } else {
                            try dest.delim(',', false);
                        }
                        try arg.toCss(W, dest);
                    }
                    try dest.writeChar(')');
                },
                .max => |*args| {
                    try dest.writeStr("max(");
                    var first = true;
                    for (args.items) |*arg| {
                        if (first) {
                            first = false;
                        } else {
                            try dest.delim(',', false);
                        }
                        try arg.toCss(W, dest);
                    }
                    try dest.writeChar(')');
                },
                .clamp => |*clamp| {
                    try dest.writeStr("clamp(");
                    try clamp.min.toCss(W, dest);
                    try dest.delim(',', false);
                    try clamp.center.toCss(W, dest);
                    try dest.delim(',', false);
                    try clamp.max.toCss(W, dest);
                    try dest.writeChar(')');
                },
                .round => |*rnd| {
                    try dest.writeStr("round(");
                    if (rnd.strategy != RoundingStrategy.default()) {
                        try rnd.strategy.toCss(W, dest);
                        try dest.delim(',', false);
                    }
                    try rnd.value.toCss(W, dest);
                    try dest.delim(',', false);
                    try rnd.interval.toCss(W, dest);
                    try dest.writeChar(')');
                },
                .rem => |*rem| {
                    try dest.writeStr("rem(");
                    try rem.dividend.toCss(W, dest);
                    try dest.delim(',', false);
                    try rem.divisor.toCss(W, dest);
                    try dest.writeChar(')');
                },
                .mod_ => |*mod_| {
                    try dest.writeStr("mod(");
                    try mod_.dividend.toCss(W, dest);
                    try dest.delim(',', false);
                    try mod_.divisor.toCss(W, dest);
                    try dest.writeChar(')');
                },
                .abs => |*v| {
                    try dest.writeStr("abs(");
                    try v.toCss(W, dest);
                    try dest.writeChar(')');
                },
                .sign => |*v| {
                    try dest.writeStr("sign(");
                    try v.toCss(W, dest);
                    try dest.writeChar(')');
                },
                .hypot => |*args| {
                    try dest.writeStr("hypot(");
                    var first = true;
                    for (args.items) |*arg| {
                        if (first) {
                            first = false;
                        } else {
                            try dest.delim(',', false);
                        }
                        try arg.toCss(W, dest);
                    }
                    try dest.writeChar(')');
                },
            };
        }

        pub fn isCompatible(this: *const @This(), browsers: css.targets.Browsers) bool {
            const F = css.compat.Feature;
            return switch (this.*) {
                .calc => |*c| F.isCompatible(F.calc_function, browsers) and c.isCompatible(browsers),
                .min => |*m| F.isCompatible(F.min_function, browsers) and brk: {
                    for (m.items) |*arg| {
                        if (!arg.isCompatible(browsers)) {
                            break :brk false;
                        }
                    }
                    break :brk true;
                },
                .max => |*m| F.isCompatible(F.max_function, browsers) and brk: {
                    for (m.items) |*arg| {
                        if (!arg.isCompatible(browsers)) {
                            break :brk false;
                        }
                    }
                    break :brk true;
                },
                .clamp => |*c| F.isCompatible(F.clamp_function, browsers) and
                    c.min.isCompatible(browsers) and
                    c.center.isCompatible(browsers) and
                    c.max.isCompatible(browsers),
                .round => |*r| F.isCompatible(F.round_function, browsers) and
                    r.value.isCompatible(browsers) and
                    r.interval.isCompatible(browsers),
                .rem => |*r| F.isCompatible(F.rem_function, browsers) and
                    r.dividend.isCompatible(browsers) and
                    r.divisor.isCompatible(browsers),
                .mod_ => |*m| F.isCompatible(F.mod_function, browsers) and
                    m.dividend.isCompatible(browsers) and
                    m.divisor.isCompatible(browsers),
                .abs => |*a| F.isCompatible(F.abs_function, browsers) and
                    a.isCompatible(browsers),
                .sign => |*s| F.isCompatible(F.sign_function, browsers) and
                    s.isCompatible(browsers),
                .hypot => |*h| F.isCompatible(F.hypot_function, browsers) and brk: {
                    for (h.items) |*arg| {
                        if (!arg.isCompatible(browsers)) {
                            break :brk false;
                        }
                    }
                    break :brk true;
                },
            };
        }
    };
}

/// A [rounding strategy](https://www.w3.org/TR/css-values-4/#typedef-rounding-strategy),
/// as used in the `round()` function.
pub const RoundingStrategy = enum {
    /// Round to the nearest integer.
    nearest,
    /// Round up (ceil).
    up,
    /// Round down (floor).
    down,
    /// Round toward zero (truncate).
    @"to-zero",

    pub fn asStr(this: *const @This()) []const u8 {
        return css.enum_property_util.asStr(@This(), this);
    }

    pub fn parse(input: *css.Parser) Result(@This()) {
        return css.enum_property_util.parse(@This(), input);
    }

    pub fn toCss(this: *const @This(), comptime W: type, dest: *Printer(W)) PrintErr!void {
        return css.enum_property_util.toCss(@This(), this, W, dest);
    }

    pub fn default() RoundingStrategy {
        return .nearest;
    }
};

fn arr2(allocator: std.mem.Allocator, a: anytype, b: anytype) ArrayList(@TypeOf(a)) {
    const T = @TypeOf(a);
    if (T != @TypeOf(b)) {
        @compileError("arr2: types must match");
    }
    var arr = ArrayList(T){};
    arr.appendSlice(allocator, &.{ a, b }) catch bun.outOfMemory();
    return arr;
}

fn round(_: void, value: f32, to: f32, strategy: RoundingStrategy) f32 {
    const v = value / to;
    return switch (strategy) {
        .down => @floor(v) * to,
        .up => @ceil(v) * to,
        .nearest => @round(v) * to,
        .@"to-zero" => @trunc(v) * to,
    };
}

fn hypot(_: void, a: f32, b: f32) f32 {
    return std.math.hypot(a, b);
}

fn powi2(v: f32) f32 {
    return bun.powf(v, 2);
}

fn sqrtf32(v: f32) f32 {
    return std.math.sqrt(v);
}
/// A mathematical constant.
pub const Constant = enum {
    /// The base of the natural logarithm
    e,
    /// The ratio of a circle's circumference to its diameter
    pi,
    /// infinity
    infinity,
    /// -infinity
    @"-infinity",
    /// Not a number.
    nan,

    pub fn asStr(this: *const @This()) []const u8 {
        return css.enum_property_util.asStr(@This(), this);
    }

    pub fn parse(input: *css.Parser) Result(@This()) {
        return css.enum_property_util.parse(@This(), input);
    }

    pub fn toCss(this: *const @This(), comptime W: type, dest: *Printer(W)) PrintErr!void {
        return css.enum_property_util.toCss(@This(), this, W, dest);
    }

    pub fn intoF32(this: *const @This()) f32 {
        return switch (this.*) {
            .e => std.math.e,
            .pi => std.math.pi,
            .infinity => std.math.inf(f32),
            .@"-infinity" => -std.math.inf(f32),
            .nan => std.math.nan(f32),
        };
    }
};

fn absf(a: f32) f32 {
    return @abs(a);
}
