const std = @import("std");
const bun = @import("root").bun;
const Allocator = std.mem.Allocator;
pub const css = @import("../css_parser.zig");
const Result = css.Result;
const ArrayList = std.ArrayListUnmanaged;
const Printer = css.Printer;
const PrintErr = css.PrintErr;
const Angle = css.css_values.angle.Angle;
const Length = css.css_values.length.Length;
const Percentage = css.css_values.percentage.Percentage;
const Time = css.css_values.time.Time;

const CSSNumber = css.css_values.number.CSSNumber;
const CSSNumberFns = css.css_values.number.CSSNumberFns;
/// A mathematical expression used within the `calc()` function.
///
/// This type supports generic value types. Values such as `Length`, `Percentage`,
/// `Time`, and `Angle` support `calc()` expressions.
pub fn Calc(comptime V: type) type {
    return union(Tag) {
        /// A literal value.
        /// PERF: this pointer feels unnecessary if V is small
        value: *V,
        /// A literal number.
        number: CSSNumber,
        /// A sum of two calc expressions.
        sum: struct {
            left: *Calc(V),
            right: *Calc(V),
        },
        /// A product of a number and another calc expression.
        product: struct {
            number: CSSNumber,
            expression: *Calc(V),
        },
        /// A math function, such as `calc()`, `min()`, or `max()`.
        function: *MathFunction(V),

        const Tag = enum(u8) {
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

        const This = @This();

        fn clone(this: *const This, allocator: Allocator) This {
            _ = this; // autofix
            _ = allocator; // autofix
            @panic("TODO!");
        }

        fn deinit(this: *This, allocator: Allocator) void {
            _ = this; // autofix
            _ = allocator; // autofix
            @panic("TODO!");
        }

        fn mulValueF32(lhs: V, allocator: Allocator, rhs: f32) V {
            return switch (V) {
                f32 => lhs * rhs,
                else => lhs.mulF32(allocator, rhs),
            };
        }

        fn addValue(lhs: V, rhs: V) V {
            switch (V) {
                f32 => return lhs + rhs,
                Angle => return lhs.add(rhs),
                // CSSNumber => return lhs.add(rhs),
                Length => return lhs.add(rhs),
                Percentage => return lhs.add(rhs),
                Time => return lhs.add(rhs),
                else => lhs.add(rhs),
            }
        }

        fn intoValue(this: @This(), allocator: std.mem.Allocator) V {
            switch (V) {
                Angle => return switch (this.*) {
                    .value => |v| v.*,
                    // TODO: give a better error message
                    else => bun.unreachablePanic("", .{}),
                },
                CSSNumber => return switch (this.*) {
                    .value => |v| v.*,
                    .number => |n| n,
                },
                Length => return Length{
                    .calc = bun.create(allocator, Calc(Length), this),
                },
                Percentage => return switch (this.*) {
                    .value => |v| v.*,
                    // TODO: give a better error message
                    else => bun.unreachablePanic("", .{}),
                },
                Time => return switch (this.*) {
                    .value => |v| v.*,
                    // TODO: give a better error message
                    else => bun.unreachablePanic("", .{}),
                },
                else => @compileError("Unimplemented, intoValue() for V = " ++ @typeName(V)),
            }
        }

        pub fn add(allocator: std.mem.Allocator, this: @This(), rhs: @This()) @This() {
            if (this == .value and rhs == .value) {
                return addValue(this.value, rhs.value);
            } else if (this == .number and rhs == .number) {
                return this.number + rhs.number;
            } else if (this == .value) {
                return addValue(this.value, intoValue(rhs));
            } else if (rhs == .value) {
                return addValue(intoValue(this), rhs.value);
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
                return .{ .value = bun.create(
                    allocator,
                    V,
                    addValue(intoValue(this), intoValue(rhs)),
                ) };
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
            const f = if (input.expectFunction().asErr()) |e| return .{ .err = e };
            // todo_stuff.match_ignore_ascii_case
            if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("calc", f)) {
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
                return .{ .result = Calc(V){
                    .function = bun.create(
                        input.allocator(),
                        MathFunction(V),
                        MathFunction(V){ .calc = calc },
                    ),
                } };
            } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("min", f)) {
                const Closure = struct {
                    ctx: @TypeOf(ctx),
                    pub fn parseNestedBlockFn(self: *@This(), i: *css.Parser) Result(ArrayList(This)) {
                        return i.parseCommaSeparatedWithCtx(This, This, self, @This().parseOne);
                    }
                    pub fn parseOne(self: *@This(), i: *css.Parser) Result(This) {
                        return This.parseSum(i, self.ctx, parseIdent);
                    }
                };
                var closure = Closure{ .ctx = ctx };
                var args = switch (input.parseNestedBlock(This, &closure, Closure.parseNestedBlockFn)) {
                    .result => |vv| vv,
                    .err => |e| return .{ .err = e },
                };
                // PERF(alloc): i don't like this additional allocation
                var reduced: ArrayList(This) = This.reducedArgs(&args, std.math.Order.lt);
                if (reduced.items.len == 1) {
                    return reduced.orderedRemove(0);
                }
                return This{
                    .function = bun.create(
                        input.allocator(),
                        MathFunction(V),
                        MathFunction(V){ .min = reduced },
                    ),
                };
            } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("max", f)) {
                const Closure = struct {
                    ctx: @TypeOf(ctx),
                    pub fn parseNestedBlockFn(self: *@This(), i: *css.Parser) Result(ArrayList(This)) {
                        return i.parseCommaSeparatedWithCtx(This, This, self, @This().parseOne);
                    }
                    pub fn parseOne(self: *@This(), i: *css.Parser) Result(This) {
                        return This.parseSum(i, self.ctx, parseIdent);
                    }
                };
                var closure = Closure{ .ctx = ctx };
                var args = switch (input.parseNestedBlock(This, &closure, Closure.parseNestedBlockFn)) {
                    .result => |vv| vv,
                    .err => |e| return .{ .err = e },
                };
                // PERF: i don't like this additional allocation
                var reduced: ArrayList(This) = This.reducedArgs(&args, std.math.Order.gt);
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
            } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("clamp", f)) {
                const ClosureResult = struct { ?This, This, ?This };
                const Closure = struct {
                    ctx: @TypeOf(ctx),

                    pub fn parseNestedBlock(self: *@This(), i: *css.Parser) Result(ClosureResult) {
                        const min = switch (This.parseSum(i, self, parseIdent)) {
                            .result => |vv| vv,
                            .err => |e| return .{ .err = e },
                        };
                        if (i.expectComma().asErr()) |e| return .{ .err = e };
                        const center = switch (This.parseSum(i, self, parseIdent)) {
                            .result => |vv| vv,
                            .err => |e| return .{ .err = e },
                        };
                        if (input.expectComma().asErr()) |e| return .{ .err = e };
                        const max = switch (This.parseSum(i, self, parseIdent)) {
                            .result => |vv| vv,
                            .err => |e| return .{ .err = e },
                        };
                        return .{ .result = .{ min, center, max } };
                    }
                };
                var closure = Closure{
                    .ctx = ctx,
                };
                var min, var center, var max = switch (input.parseNestedBlock(
                    Result,
                    &closure,
                    Closure.parseNestedBlock,
                )) {
                    .result => |vv| vv,
                    .err => |e| return .{ .err = e },
                };

                // According to the spec, the minimum should "win" over the maximum if they are in the wrong order.
                const cmp = if (max != null and max == .value and center == .value)
                    center.value.partialCmp(max.max.value)
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
                return switch (switch_val) {
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
                };
            } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("round", f)) {
                const Fn = struct {
                    ctx: @TypeOf(ctx),
                    pub inline fn parseNestedBlockFn(self: *@This(), i: *css.Parser) Result(This) {
                        const strategy = if (input.tryParse(RoundingStrategy.parse, .{}).asValue()) |s| brk: {
                            if (input.expectComma().asErr()) |e| return .{ .err = e };
                            break :brk s;
                        } else RoundingStrategy.default();

                        const OpAndFallbackCtx = struct {
                            strategy: RoundingStrategy,

                            pub inline fn op(this: *const @This(), a: f32, b: f32) f32 {
                                return round({}, a, b, this.strategy);
                            }

                            pub inline fn fallback(this: *const @This(), a: This, b: This) MathFunction(V) {
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
                return input.parseNestedBlock(This, {}, Fn.parseNestedBlockFn);
            } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("rem", f)) {
                const Closure = struct {
                    ctx: @TypeOf(ctx),

                    pub inline fn parseNestedBlockFn(self: *@This(), i: *css.Parser) Result(This) {
                        This.parseMathFn(
                            i,
                            void,
                            @This().rem,
                            mathFunctionRem,
                            self.ctx,
                            parseIdent,
                        );
                    }

                    pub inline fn rem(_: void, a: f32, b: f32) f32 {
                        return @mod(a, b);
                    }
                    pub inline fn mathFunctionRem(a: This, b: This) MathFunction(V) {
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
                return input.parseNestedBlock(Calc, &closure, Closure.parseNestedBlockFn);
            } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("mod", f)) {
                const Closure = struct {
                    ctx: @TypeOf(ctx),

                    pub inline fn parseNestedBlockFn(self: *@This(), i: *css.Parser) Result(This) {
                        This.parseMathFn(
                            i,
                            void,
                            @This().modulo,
                            mathFunctionMod,
                            self.ctx,
                            parseIdent,
                        );
                    }

                    pub inline fn modulo(_: void, a: f32, b: f32) f32 {
                        return ((a % b) + b) % b;
                    }
                    pub inline fn mathFunctionMod(a: This, b: This) MathFunction(V) {
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
                return input.parseNestedBlock(Calc, &closure, Closure.parseNestedBlockFn);
            } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("sin", f)) {
                return This.parseTrig(input, .sin, false, ctx, parseIdent);
            } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("cos", f)) {
                return This.parseTrig(input, .cos, false, ctx, parseIdent);
            } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("tan", f)) {
                return This.parseTrig(input, .tan, false, ctx, parseIdent);
            } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("asin", f)) {
                return This.parseTrig(input, .asin, true, ctx, parseIdent);
            } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("acos", f)) {
                return This.parseTrig(input, .acos, true, ctx, parseIdent);
            } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("atan", f)) {
                return This.parseTrig(input, .atan, true, ctx, parseIdent);
            } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("atan2", f)) {
                const Closure = struct {
                    ctx: @TypeOf(ctx),
                    pub inline fn parseNestedBlockFn(self: *@This(), i: *css.Parser) Result(This) {
                        const res = This.parseAtan2(i, self.ctx, parseIdent);
                        if (V.tryFromAngle(res)) |v| {
                            return This{
                                .value = bun.create(
                                    i.allocator(),
                                    V,
                                    v,
                                ),
                            };
                        }

                        return i.newCustomError(css.ParserError{ .invalid_value = {} });
                    }
                };
                var closure = Closure{ .ctx = ctx };
                return input.parseNestedBlock(This, &closure, Closure.parseNestedBlockFn);
            } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("pow", f)) {
                const Closure = struct {
                    ctx: @TypeOf(ctx),
                    pub inline fn parseNestedBlockFn(self: *@This(), i: *css.Parser) Result(This) {
                        const a = switch (This.parseNumeric(i, self.ctx, parseIdent)) {
                            .result => |vv| vv,
                            .err => |e| return .{ .err = e },
                        };

                        if (input.expectComma().asErr()) |e| return .{ .err = e };

                        const b = switch (This.parseNumeric(i, self.ctx, parseIdent)) {
                            .result => |vv| vv,
                            .err => |e| return .{ .err = e },
                        };

                        return .{ .result = This{
                            .number = std.math.pow(f32, a, b),
                        } };
                    }
                };
                var closure = Closure{ .ctx = ctx };
                return input.parseNestedBlock(This, &closure, Closure.parseNestedBlockFn);
            } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("log", f)) {
                const Closure = struct {
                    ctx: @TypeOf(ctx),
                    pub inline fn parseNestedBlockFn(self: *@This(), i: *css.Parser) Result(This) {
                        const value = switch (This.parseNumeric(i, self.ctx, parseIdent)) {
                            .result => |vv| vv,
                            .err => |e| return .{ .err = e },
                        };
                        if (input.tryParse(css.Parser.expectComma, .{}).isOk()) {
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
            } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("sqrt", f)) {
                return This.parseNumericFn(input, .sqrt, ctx, parseIdent);
            } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("exp", f)) {
                return This.parseNumericFn(input, .exp, ctx, parseIdent);
            } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("hypot", f)) {
                const Closure = struct {
                    ctx: @TypeOf(ctx),
                    pub inline fn parseNestedBlockFn(self: *@This(), i: *css.Parser) Result(This) {
                        const args = i.parseCommaSeparatedWithCtx(This, self, parseOne);
                        const v = switch (This.parseHypot(i.allocator(), &args)) {
                            .result => |vv| vv,
                            .err => return This{
                                .function = bun.create(
                                    i.allocator(),
                                    MathFunction,
                                    MathFunction(V){ .hypot = args },
                                ),
                            },
                        };

                        return v;
                    }
                    pub inline fn parseOne(self: *@This(), i: *css.Parser) Result(This) {
                        return This.parseSum(i, self.ctx, parseIdent);
                    }
                };
                var closure = Closure{ .ctx = ctx };
                return input.parseNestedBlock(This, &closure, Closure.parseNestedBlockFn);
            } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("abs", f)) {
                const Closure = struct {
                    ctx: @TypeOf(ctx),
                    pub inline fn parseNestedBlockFn(self: *@This(), i: *css.Parser) Result(This) {
                        const v = switch (This.parseSum(i, self.ctx, parseIdent)) {
                            .result => |vv| vv,
                            .err => |e| return .{ .err = e },
                        };
                        return .{
                            .result = switch (This.applyMap(&v, i.allocator(), .abs)) {
                                .result => |vv| vv,
                                .err => This{
                                    .function = bun.create(
                                        i.allocator(),
                                        MathFunction(V),
                                        MathFunction(V){ .abs = v },
                                    ),
                                },
                            },
                        };
                    }
                };
                var closure = Closure{ .ctx = ctx };
                return input.parseNestedBlock(This, &closure, Closure.parseNestedBlockFn);
            } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("sign", f)) {
                const Closure = struct {
                    ctx: @TypeOf(ctx),
                    pub inline fn parseNestedBlockFn(self: *@This(), i: *css.Parser) Result(This) {
                        const v = switch (This.parseSum(i, self.ctx, parseIdent)) {
                            .result => |vv| vv,
                            .err => |e| return .{ .err = e },
                        };
                        switch (v) {
                            .number => |*n| return .{ .result = This{ .number = std.math.sign(n) } },
                            .value => |*v2| {
                                const MapFn = struct {
                                    pub inline fn sign(s: f32) f32 {
                                        return std.math.sign(s);
                                    }
                                };
                                // First map so we ignore percentages, which must be resolved to their
                                // computed value in order to determine the sign.
                                if (v2.tryMap(MapFn.sign)) |new_v| {
                                    // sign() alwasy resolves to a number.
                                    return .{ .result = This{ .number = new_v.trySign().unwrap() } };
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
            } else {
                return location.newUnexpectedTokenError(.{ .ident = f });
            }
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

                if (tok == .whitespace) {
                    if (input.isExhausted()) {
                        break; // allow trailing whitespace
                    }
                    const next_tok = switch (input.next()) {
                        .result => |vv| vv,
                        .err => |e| return .{ .err = e },
                    };
                    if (next_tok.* == .delim and next_tok.delim == '+') {
                        const next = Calc(V).parseProduct(input, ctx, parse_ident);
                        cur = cur.add(input.allocator(), next);
                    } else if (next_tok.* == .delim and next_tok.delim == '-') {
                        var rhs = switch (This.parseProduct(input, ctx, parse_ident)) {
                            .result => |vv| vv,
                            .err => |e| return .{ .err = e },
                        };
                        rhs = rhs.mul_f32(-1.0);
                        cur = cur.add(input.allocator(), rhs);
                    } else {
                        return input.newUnexpectedTokenError(next_tok.*);
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
            parse_ident: *const fn (@TypeOf(ctx), []const u8) ?This,
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
                        node = node.mul_f32(rhs.number);
                    } else if (node == .number) {
                        const val = node.number;
                        node = rhs;
                        node = node.mul_f32(val);
                    } else {
                        return input.newUnexpectedTokenError(.{ .delim = '*' });
                    }
                } else if (tok.* == .delim and tok.delim == '/') {
                    const rhs = switch (This.parseValue(input, ctx, parse_ident)) {
                        .result => |vv| vv,
                        .err => |e| return .{ .err = e },
                    };
                    if (rhs == .number) {
                        const val = rhs.number;
                        node = node.mul_f32(1.0 / val);
                        continue;
                    }
                    return input.newCustomError(css.ParserError{ .invalid_value = {} });
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
            parse_ident: *const fn (@TypeOf(ctx), []const u8) ?This,
        ) Result(This) {
            // Parse nested calc() and other math functions.
            if (input.tryParse(This.parse, .{}).asValue()) |_calc| {
                const calc: This = _calc;
                switch (calc) {
                    .function => |f| return switch (f.*) {
                        .calc => |c| c,
                        else => .{ .function = f },
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

                return location.newUnexpectedTokenError(.{ .ident = ident });
            }

            const value = switch (input.tryParse(V.parse, .{})) {
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
                tag,
                asin,
                acos,
                atan,
            },
            to_angle: bool,
            ctx: anytype,
            parse_ident: *const fn (@TypeOf(ctx), []const u8) ?This,
        ) Result(This) {
            const trig_fn = struct {
                pub fn run(x: f32) f32 {
                    return comptime switch (trig_fn_kind) {
                        .sin => std.math.sin(x),
                        .cos => std.math.cos(x),
                        .tan => std.math.tan(x),
                        .asin => std.math.asin(x),
                        .acos => std.math.acos(x),
                        .atan => std.math.atan(x),
                    };
                }
            };
            const Closure = struct {
                ctx: @TypeOf(ctx),
                to_angle: bool,

                pub fn parseNestedBockFn(this: *@This(), i: *css.Parser) Result(This) {
                    const v = switch (Calc(Angle)) {
                        .result => |vv| vv,
                        .err => |e| return .{ .err = e },
                    }.parseSum(
                        i,
                        this,
                        @This().parseIdentFn,
                    );

                    const rad = rad: {
                        switch (v) {
                            .value => |angle| {
                                if (!this.to_angle) break :rad trig_fn.run(angle.toRadians());
                            },
                            .number => break :rad trig_fn.run(v.number),
                            else => {},
                        }
                        return i.newCustomError(css.ParserError{ .invalid_value = {} });
                    };

                    if (to_angle and !std.math.isNan(rad)) {
                        if (V.tryFromAngle(.{ .rad = rad })) |val| {
                            return .{
                                .value = bun.create(
                                    i.allocator(),
                                    V,
                                    val,
                                ),
                            };
                        }
                        return i.newCustomError(css.ParserError{ .invalid_value = {} });
                    } else {
                        return .{ .number = rad };
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
            };
            return input.parseNestedBlock(This, &closure, Closure.parseNestedBockFn);
        }

        pub fn parseAtan2(
            input: *css.Parser,
            ctx: anytype,
            parse_ident: *const fn (@TypeOf(ctx), []const u8) ?This,
        ) Result(Angle) {
            const Fn = struct {
                pub inline fn parseIdentNone(_: @TypeOf(ctx), _: []const u8) ?This {
                    return null;
                }
            };

            // atan2 supports arguments of any <number>, <dimension>, or <percentage>, even ones that wouldn't
            // normally be supported by V. The only requirement is that the arguments be of the same type.
            // Try parsing with each type, and return the first one that parses successfully.
            if (input.tryParse(Calc(Length).parseAtan2Args, .{
                {},
                Fn.parseIdentNone,
            }).asValue()) |v| {
                return v;
            }

            if (input.tryParse(Calc(Percentage).parseAtan2Args, .{
                {},
                Fn.parseIdentNone,
            }).asValue()) |v| {
                return v;
            }

            if (input.tryParse(Calc(Angle).parseAtan2Args, .{
                {},
                Fn.parseIdentNone,
            }).asValue()) |v| {
                return v;
            }

            if (input.tryParse(Calc(Time).parseAtan2Args, .{
                {},
                Fn.parseIdentNone,
            }).asValue()) |v| {
                return v;
            }

            const Closure = struct {
                ctx: @TypeOf(ctx),

                pub fn parseIdentFn(self: *@This(), ident: []const u8) ?This {
                    const v = parse_ident(self.ctx, ident) orelse return null;
                    if (v == .number) return .{ .number = v.number };
                    return null;
                }
            };
            var closure = Closure{
                .ctx = ctx,
            };
            return Calc(CSSNumber).parseAtan2Args(&closure, Closure.parseIdentFn);
        }

        pub fn parseAtan2Args(
            input: *css.Parser,
            ctx: anytype,
            parse_ident: *const fn (@TypeOf(ctx), []const u8) ?This,
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
                    pub inline fn opToFn(x: f32, y: f32) ?f32 {
                        return std.math.atan2(x, y);
                    }
                };
                if (a.tryOpTo(&b, Fn.opToFn)) |v| {
                    return v;
                }
            } else if (a == .number and b == .calc) {
                return Angle{ .rad = std.math.atan2(a.number, b.number) };
            } else {
                //y
            }

            // We don't have a way to represent arguments that aren't angles, so just error.
            // This will fall back to an unparsed property, leaving the atan2() function intact.
            return input.newCustomError(css.ParserError{ .invalid_value = {} });
        }

        pub fn parseNumeric(
            input: *css.Parser,
            ctx: anytype,
            parse_ident: *const fn (@TypeOf(ctx), []const u8) ?This,
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
                else => input.newCustomError(css.ParserError.invalid_value),
            };
            return .{ .result = val };
        }

        pub fn parseHypot(allocator: Allocator, args: *ArrayList(This)) Result(?This) {
            if (args.items.len == 1) {
                const v = args.items[0];
                args.items[0] = This{ .number = 0 };
                return v;
            }

            if (args.items.len == 2) {
                return This.applyOp(&args.items[0], args.items[1], allocator, void, hypot);
            }

            var i: usize = 0;
            const first = if (This.applyMap(
                &args.items[0],
                allocator,
                powi2,
            )) |v| v else return null;
            i += 1;
            var errored: bool = false;
            var sum: This = first;
            for (args.items[i..]) |*arg| {
                const Fn = struct {
                    pub inline fn applyOpFn(_: void, a: f32, b: f32) f32 {
                        return a + std.math.powi(f32, b, 2);
                    }
                };
                sum = This.applyOp(&sum, arg, allocator, {}, Fn.applyOpFn) orelse {
                    errored = true;
                    break;
                };
            }

            if (errored) return null;

            return This.applyMap(&sum, allocator, sqrtf32);
        }

        pub fn applyOp(
            a: *const This,
            b: *const This,
            allocator: std.mem.Allocator,
            ctx: anytype,
            comptime op: *const fn (@TypeOf(ctx), f32, f32) f32,
        ) ?This {
            if (a.* == .number and b.* == .number) {
                return This{
                    .value = bun.create(
                        allocator,
                        V,
                        op(ctx, a.number, b.number),
                    ),
                };
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
                    if (v.tryMap(op)) |new_v| {
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
                        var b2 = b.mulF32(dest.allocator, -1.0);
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
                    const calc = &this.product.expression;
                    if (@abs(num) < 1.0) {
                        const div = 1.0 / num;
                        try calc.toCss(W, dest);
                        try dest.delim('/', true);
                        try CSSNumberFns.toCss(&div, W, dest);
                    } else {
                        try CSSNumberFns.toCss(num, W, dest);
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

        pub fn mulF32(this: *const @This(), allocator: Allocator, other: f32) This {
            if (other == 1.0) {
                return this.*;
            }

            return switch (this.*) {
                .value => This{ .value = bun.create(allocator, V, mulValueF32(this.value.*, allocator, other)) },
                .number => This{ .number = this.number * other },
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
                            .expression = this,
                        },
                    },
                },
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
        calc: Calc(V),
        /// The `min()` function.
        min: ArrayList(Calc(V)),
        /// The `max()` function.
        max: ArrayList(Calc(V)),
        /// The `clamp()` function.
        clamp: struct {
            min: Calc(V),
            center: Calc(V),
            max: Calc(V),
        },
        /// The `round()` function.
        round: struct {
            strategy: RoundingStrategy,
            value: Calc(V),
            interval: Calc(V),
        },
        /// The `rem()` function.
        rem: struct {
            dividend: Calc(V),
            divisor: Calc(V),
        },
        /// The `mod()` function.
        mod_: struct {
            dividend: Calc(V),
            divisor: Calc(V),
        },
        /// The `abs()` function.
        abs: Calc(V),
        /// The `sign()` function.
        sign: Calc(V),
        /// The `hypot()` function.
        hypot: ArrayList(Calc(V)),

        pub fn toCss(this: *const @This(), comptime W: type, dest: *css.Printer(W)) css.PrintErr!void {
            return switch (this.*) {
                .calc => |*calc| {
                    try dest.writeStr("calc(");
                    try calc.toCss(dest);
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
                        try arg.toCss(dest);
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
                        try arg.toCss(dest);
                    }
                    try dest.writeChar(')');
                },
                .clamp => |*clamp| {
                    try dest.writeStr("clamp(");
                    try clamp.min.toCss(dest);
                    try dest.delim(',', false);
                    try clamp.center.toCss(dest);
                    try dest.delim(',', false);
                    try clamp.max.toCss(dest);
                    try dest.writeChar(')');
                },
                .round => |*rnd| {
                    try dest.writeStr("round(");
                    if (rnd.strategy != RoundingStrategy.default()) {
                        try rnd.strategy.toCss(dest);
                        try dest.delim(',', false);
                    }
                    try rnd.value.toCss(dest);
                    try dest.delim(',', false);
                    try rnd.interval.toCss(dest);
                    try dest.writeChar(')');
                },
                .rem => |*rem| {
                    try dest.writeStr("rem(");
                    try rem.dividend.toCss(dest);
                    try dest.delim(',', false);
                    try rem.divisor.toCss(dest);
                    try dest.writeChar(')');
                },
                .mod_ => |*mod_| {
                    try dest.writeStr("mod(");
                    try mod_.dividend.toCss(dest);
                    try dest.delim(',', false);
                    try mod_.divisor.toCss(dest);
                    try dest.writeChar(')');
                },
                .abs => |*v| {
                    try dest.writeStr("abs(");
                    try v.toCss(dest);
                    try dest.writeChar(')');
                },
                .sign => |*v| {
                    try dest.writeStr("sign(");
                    try v.toCss(dest);
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
                        try arg.toCss(dest);
                    }
                    try dest.writeChar(')');
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

    pub usingnamespace css.DefineEnumProperty(@This());

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
        .to_zero => @trunc(v) * to,
    };
}

inline fn hypot(_: void, a: f32, b: f32) f32 {
    return std.math.hypot(a, b);
}

inline fn powi2(v: f32) f32 {
    return std.math.powi(f32, v, 2);
}

inline fn sqrtf32(v: f32) f32 {
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

    pub usingnamespace css.DefineEnumProperty(@This());

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
