const std = @import("std");
const bun = @import("root").bun;
pub const css = @import("../css_parser.zig");
const Error = css.Error;
const ArrayList = std.ArrayListUnmanaged;
const Printer = css.Printer;
const PrintErr = css.PrintErr;
const Angle = css.css_values.angle.Angle;
const Length = css.css_values.length.Length;
const Percentage = css.css_values.percentage.Percentage;
const Time = css.css_values.time.Time;

const CSSNumber = css.css_values.number.CSSNumber;
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

        fn addValue(lhs: V, rhs: V) V {
            switch (V) {
                f32 => return lhs + rhs,
                Angle => return lhs.add(rhs),
                CSSNumber => return lhs.add(rhs),
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
        pub fn parse(input: *css.Parser) Error!This {
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
        ) Error!This {
            const location = input.currentSourceLocation();
            const f = try input.expectFunction();
            // todo_stuff.match_ignore_ascii_case
            if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("calc", f)) {
                const Closure = struct {
                    ctx: @TypeOf(ctx),
                    pub fn parseNestedBlockFn(self: *@This(), i: *css.Parser) Error!This {
                        return This.parseSum(i, self.ctx, parseIdent);
                    }
                };
                var closure = Closure{ .ctx = ctx };
                const calc = try input.parseNestedBlock(This, &closure, Closure.parseNestedBlockFn);
                if (calc == .value or calc == .number) return calc;
                return Calc(V){
                    .function = bun.create(
                        @compileError(css.todo_stuff.think_about_allocator),
                        MathFunction(V),
                        MathFunction(V){ .calc = calc },
                    ),
                };
            } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("min", f)) {
                const Closure = struct {
                    ctx: @TypeOf(ctx),
                    pub fn parseNestedBlockFn(self: *@This(), i: *css.Parser) Error!ArrayList(This) {
                        return i.parseCommaSeparatedWithCtx(This, This, self, @This().parseOne);
                    }
                    pub fn parseOne(self: *@This(), i: *css.Parser) Error!This {
                        return This.parseSum(i, self.ctx, parseIdent);
                    }
                };
                var closure = Closure{ .ctx = ctx };
                var args = try input.parseNestedBlock(This, &closure, Closure.parseNestedBlockFn);
                // PERF: i don't like this additional allocation
                var reduced: ArrayList(This) = This.reducedArgs(&args, std.math.Order.lt);
                if (reduced.items.len == 1) {
                    return reduced.orderedRemove(0);
                }
                return This{
                    .function = bun.create(
                        @compileError(css.todo_stuff.think_about_allocator),
                        MathFunction(V),
                        MathFunction(V){ .min = reduced },
                    ),
                };
            } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("max", f)) {
                const Closure = struct {
                    ctx: @TypeOf(ctx),
                    pub fn parseNestedBlockFn(self: *@This(), i: *css.Parser) Error!ArrayList(This) {
                        return i.parseCommaSeparatedWithCtx(This, This, self, @This().parseOne);
                    }
                    pub fn parseOne(self: *@This(), i: *css.Parser) Error!This {
                        return This.parseSum(i, self.ctx, parseIdent);
                    }
                };
                var closure = Closure{ .ctx = ctx };
                var args = try input.parseNestedBlock(This, &closure, Closure.parseNestedBlockFn);
                // PERF: i don't like this additional allocation
                var reduced: ArrayList(This) = This.reducedArgs(&args, std.math.Order.gt);
                if (reduced.items.len == 1) {
                    return reduced.orderedRemove(0);
                }
                return This{
                    .function = bun.create(
                        @compileError(css.todo_stuff.think_about_allocator),
                        MathFunction(V),
                        MathFunction(V){ .max = reduced },
                    ),
                };
            } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("clamp", f)) {
                const Result = struct { ?This, This, ?This };
                const Closure = struct {
                    ctx: @TypeOf(ctx),

                    pub fn parseNestedBlock(self: *@This(), i: *css.Parser) Error!Result {
                        const min = try This.parseSum(i, self, parseIdent);
                        try i.expectComma();
                        const center = This.parseSum(i, self, parseIdent);
                        try input.expectComma();
                        const max = This.parseSum(i, self, parseIdent);
                        return .{ min, center, max };
                    }
                };
                var closure = Closure{
                    .ctx = ctx,
                };
                var min, var center, var max = try input.parseNestedBlock(
                    Result,
                    &closure,
                    Closure.parseNestedBlock,
                );

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
                            @compileError(css.todo_stuff.think_about_allocator),
                            MathFunction(V),
                            MathFunction(V){
                                .max = arr2(
                                    @compileError(css.todo_stuff.think_about_allocator),
                                    min.?,
                                    center,
                                ),
                            },
                        ),
                    },
                    0b01 => This{
                        .function = bun.create(
                            @compileError(css.todo_stuff.think_about_allocator),
                            MathFunction(V),
                            MathFunction(V){
                                .min = arr2(
                                    @compileError(css.todo_stuff.think_about_allocator),
                                    max.?,
                                    center,
                                ),
                            },
                        ),
                    },
                    0b11 => This{
                        .function = bun.create(
                            @compileError(css.todo_stuff.think_about_allocator),
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
                    pub inline fn parseNestedBlockFn(self: *@This(), i: *css.Parser) Error!This {
                        const strategy = if (input.tryParse(RoundingStrategy.parse, .{})) |s| brk: {
                            try input.expectComma();
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

                    pub inline fn parseNestedBlockFn(self: *@This(), i: *css.Parser) Error!This {
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

                    pub inline fn parseNestedBlockFn(self: *@This(), i: *css.Parser) Error!This {
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
                    pub inline fn parseNestedBlockFn(self: *@This(), i: *css.Parser) Error!This {
                        _ = i; // autofix
                        const res = This.parseAtan2(input, self.ctx, parseIdent);
                        if (V.tryFromAngle(res)) |v| {
                            return This{
                                .value = bun.create(
                                    @compileError(css.todo_stuff.think_about_allocator),
                                    V,
                                    v,
                                ),
                            };
                        }

                        return input.newCustomError(css.ParserError.invalid_value);
                    }
                };
                var closure = Closure{ .ctx = ctx };
                return input.parseNestedBlock(This, &closure, Closure.parseNestedBlockFn);
            } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("pow", f)) {
                const Closure = struct {
                    ctx: @TypeOf(ctx),
                    pub inline fn parseNestedBlockFn(self: *@This(), i: *css.Parser) Error!This {
                        const a = try This.parseNumeric(i, self.ctx, parseIdent);
                        try input.expectComma();
                        const b = try This.parseNumeric(i, self.ctx, parseIdent);
                        return This{
                            .number = std.math.pow(f32, a, b),
                        };
                    }
                };
                var closure = Closure{ .ctx = ctx };
                return input.parseNestedBlock(This, &closure, Closure.parseNestedBlockFn);
            } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("log", f)) {
                const Closure = struct {
                    ctx: @TypeOf(ctx),
                    pub inline fn parseNestedBlockFn(self: *@This(), i: *css.Parser) Error!This {
                        const value = try This.parseNumeric(i, self.ctx, parseIdent);
                        if (input.tryParse(css.Parser.expectComma, .{})) {
                            const base = This.parseNumeric(i, self.ctx, parseIdent);
                            return This{ .number = std.math.log(f32, base, value) };
                        }
                        return This{ .number = std.math.log(f32, std.math.e, value) };
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
                    pub inline fn parseNestedBlockFn(self: *@This(), i: *css.Parser) Error!This {
                        const args = i.parseCommaSeparatedWithCtx(This, self, parseOne);
                        const v = This.parseHypot(&args) catch return This{
                            .function = bun.create(
                                @compileError(css.todo_stuff.think_about_allocator),
                                MathFunction,
                                MathFunction(V){ .hypot = args },
                            ),
                        };
                        return v;
                    }
                    pub inline fn parseOne(self: *@This(), i: *css.Parser) Error!This {
                        return This.parseSum(i, self.ctx, parseIdent);
                    }
                };
                var closure = Closure{ .ctx = ctx };
                return input.parseNestedBlock(This, &closure, Closure.parseNestedBlockFn);
            } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("abs", f)) {
                const Closure = struct {
                    ctx: @TypeOf(ctx),
                    pub inline fn parseNestedBlockFn(self: *@This(), i: *css.Parser) Error!This {
                        const v = try This.parseSum(i, self.ctx, parseIdent);
                        return This.applyMap(&v, .abs) catch return This{
                            .function = bun.create(
                                @compileError(css.todo_stuff.think_about_allocator),
                                MathFunction(V),
                                MathFunction(V){ .abs = v },
                            ),
                        };
                    }
                };
                var closure = Closure{ .ctx = ctx };
                return input.parseNestedBlock(This, &closure, Closure.parseNestedBlockFn);
            } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("sign", f)) {
                const Closure = struct {
                    ctx: @TypeOf(ctx),
                    pub inline fn parseNestedBlockFn(self: *@This(), i: *css.Parser) Error!This {
                        const v = try This.parseSum(i, self.ctx, parseIdent);
                        switch (v) {
                            .number => |*n| return This{ .number = std.math.sign(n) },
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
                                    return This{ .number = new_v.trySign().unwrap() };
                                }
                            },
                            else => {},
                        }

                        return This{
                            .function = bun.create(
                                @compileError(css.todo_stuff.think_about_allocator),
                                MathFunction(V),
                                MathFunction(V){ .sign = v },
                            ),
                        };
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
        ) Error!This {
            const a = try This.parseSum(input, ctx_for_parse_ident, parse_ident);
            try input.expectComma();
            const b = try This.parseSum(input, ctx_for_parse_ident, parse_ident);

            return This.applyOp(&a, &b, ctx_for_op_and_fallback, op) orelse This{
                .function = bun.create(
                    @compileError(css.todo_stuff.think_about_allocator),
                    MathFunction(V),
                    fallback(ctx_for_op_and_fallback, a, b),
                ),
            };
        }

        pub fn parseSum(
            input: *css.Parser,
            ctx: anytype,
            comptime parse_ident: *const fn (@TypeOf(ctx), []const u8) ?This,
        ) Error!This {
            var cur = try This.parseProduct(input, ctx, parse_ident);
            while (true) {
                const start = input.state();
                const tok = input.nextIncludingWhitespace() catch {
                    input.reset(&start);
                    break;
                };
                if (tok == .whitespace) {
                    if (input.isExhausted()) {
                        break; // allow trailing whitespace
                    }
                    const next_tok = try input.next();
                    if (next_tok.* == .delim and next_tok.delim == '+') {
                        const next = Calc(V).parseProduct(input, ctx, parse_ident);
                        cur = cur.add(@compileError(css.todo_stuff.think_about_allocator), next);
                    } else if (next_tok.* == .delim and next_tok.delim == '-') {
                        var rhs = try This.parseProduct(input, ctx, parse_ident);
                        rhs = rhs.mul_f32(-1.0);
                        cur = cur.add(@compileError(css.todo_stuff.think_about_allocator), rhs);
                    } else {
                        return input.newCustomError(next_tok.*);
                    }
                    continue;
                }
                input.reset(&start);
                break;
            }
        }

        pub fn parseProduct(
            input: *css.Parser,
            ctx: anytype,
            parse_ident: *const fn (@TypeOf(ctx), []const u8) ?This,
        ) Error!This {
            var node = try This.parseValue(input, ctx, parse_ident);
            while (true) {
                const start = input.state();
                const tok = input.next() catch {
                    input.reset(&start);
                    break;
                };
                if (tok.* == .delim and tok.delim == '*') {
                    // At least one of the operands must be a number.
                    const rhs = try This.parseValue(input, ctx, parse_ident);
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
                    const rhs = try This.parseValue(input, ctx, parse_ident);
                    if (rhs == .number) {
                        const val = rhs.number;
                        node = node.mul_f32(1.0 / val);
                        continue;
                    }
                    return input.newCustomError(css.ParserError.invalid_value);
                } else {
                    input.reset(&start);
                    break;
                }
            }
            return node;
        }

        pub fn pareValue(
            input: *css.Parser,
            ctx: anytype,
            parse_ident: *const fn (@TypeOf(ctx), []const u8) ?This,
        ) Error!This {
            // Parse nested calc() and other math functions.
            if (input.tryParse(This.parse, .{})) |_calc| {
                const calc: This = _calc;
                switch (calc) {
                    .function => |f| return switch (f.*) {
                        .calc => |c| c,
                        else => .{ .function = f },
                    },
                    else => return calc,
                }
            }

            if (input.tryParse(css.Parser.expectParenthesisBlock, .{})) |_| {
                const Closure = struct {
                    ctx: @TypeOf(ctx),
                    pub fn parseNestedBlockFn(self: *@This(), i: *css.Parser) Error!This {
                        return This.parseSum(i, self.ctx, parse_ident);
                    }
                };
                var closure = Closure{
                    .ctx = ctx,
                };
                return input.parseNestedBlock(This, &closure, Closure.parseNestedBlockFn);
            }

            if (input.tryParse(css.Parser.expectNumber, .{})) |num| {
                return .{ .number = num };
            }

            if (input.tryParse(Constant.parse, .{})) |constant| {
                return .{ .number = constant.intoF32() };
            }

            const location = input.currentSourceLocation();
            if (input.tryParse(css.Parser.expectIdent, .{})) |ident| {
                if (parse_ident(ctx, ident)) |c| {
                    return c;
                }

                return location.newUnexpectedTokenError(.{ .ident = ident });
            }

            const value = try input.tryParse(V.parse, .{});
            return .{
                .value = bun.create(
                    @compileError(css.todo_stuff.think_about_allocator),
                    V,
                    value,
                ),
            };
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
        ) Error!This {
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

                pub fn parseNestedBockFn(this: *@This(), i: *css.Parser) Error!This {
                    const v = try Calc(Angle).parseSum(
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
                        return input.newCustomError(css.ParserError.invalid_value);
                    };

                    if (to_angle and !std.math.isNan(rad)) {
                        if (V.tryFromAngle(.{ .rad = rad })) |val| {
                            return .{
                                .value = bun.create(
                                    @compileError(css.todo_stuff.think_about_allocator),
                                    V,
                                    val,
                                ),
                            };
                        }
                        return input.newCustomError(css.ParserError.invalid_value);
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
        ) Error!Angle {
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
            })) |v| {
                return v;
            }

            if (input.tryParse(Calc(Percentage).parseAtan2Args, .{
                {},
                Fn.parseIdentNone,
            })) |v| {
                return v;
            }

            if (input.tryParse(Calc(Angle).parseAtan2Args, .{
                {},
                Fn.parseIdentNone,
            })) |v| {
                return v;
            }

            if (input.tryParse(Calc(Time).parseAtan2Args, .{
                {},
                Fn.parseIdentNone,
            })) |v| {
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
        ) Error!Angle {
            const a = try This.parseSum(input, ctx, parse_ident);
            try input.expectComma();
            const b = try This.parseSum(input, ctx, parse_ident);

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
            return input.newCustomError(css.ParserError.invalid_value);
        }

        pub fn parseNumeric(
            input: *css.Parser,
            ctx: anytype,
            parse_ident: *const fn (@TypeOf(ctx), []const u8) ?This,
        ) Error!f32 {
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
            const v: Calc(CSSNumber) = try Calc(CSSNumber).parseSum(input, &closure, Closure.parseIdentFn);
            return switch (v) {
                .number => v.number,
                .value => v.value.*,
                else => input.newCustomError(css.ParserError.invalid_value),
            };
        }

        pub fn parseHypot(args: *ArrayList(This)) Error!?This {
            if (args.items.len == 1) {
                const v = args.items[0];
                args.items[0] = This{ .number = 0 };
                return v;
            }

            if (args.items.len == 2) {
                return This.applyOp(&args.items[0], args.items[1], void, hypot);
            }

            var i: usize = 0;
            const first = if (This.applyMap(
                &args.items[0],
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
                sum = This.applyOp(&sum, arg, {}, Fn.applyOpFn) orelse {
                    errored = true;
                    break;
                };
            }

            if (errored) return null;

            return This.applyMap(&sum, sqrtf32);
        }

        pub fn applyOp(
            a: *const This,
            b: *const This,
            ctx: anytype,
            comptime op: *const fn (@TypeOf(ctx), f32, f32) f32,
        ) ?This {
            if (a.* == .number and b.* == .number) {
                return This{
                    .value = bun.create(
                        @compileError(css.todo_stuff.think_about_allocator),
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

        pub fn applyMap(this: *const This, comptime op: *const fn (f32) f32) ?This {
            switch (this.*) {
                .number => |n| return This{ .number = op(n) },
                .value => |v| {
                    if (v.tryMap(op)) |new_v| {
                        return This{
                            .value = bun.create(
                                @compileError(css.todo_stuff.think_about_allocator),
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
