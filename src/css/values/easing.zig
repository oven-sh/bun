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
const DimensionPercentage = css.css_values.percentage.DimensionPercentage;
const LengthPercentage = css.css_values.length.LengthPercentage;
const Length = css.css_values.length.Length;
const Percentage = css.css_values.percentage.Percentage;
const CssColor = css.css_values.color.CssColor;
const Image = css.css_values.image.Image;
const Url = css.css_values.url.Url;
const CSSInteger = css.css_values.number.CSSInteger;
const CSSIntegerFns = css.css_values.number.CSSIntegerFns;
const Angle = css.css_values.angle.Angle;
const Time = css.css_values.time.Time;
const Resolution = css.css_values.resolution.Resolution;
const CustomIdent = css.css_values.ident.CustomIdent;
const CustomIdentFns = css.css_values.ident.CustomIdentFns;
const Ident = css.css_values.ident.Ident;

/// A CSS [easing function](https://www.w3.org/TR/css-easing-1/#easing-functions).
pub const EasingFunction = union(enum) {
    /// A linear easing function.
    linear,
    /// Equivalent to `cubic-bezier(0.25, 0.1, 0.25, 1)`.
    ease,
    /// Equivalent to `cubic-bezier(0.42, 0, 1, 1)`.
    ease_in,
    /// Equivalent to `cubic-bezier(0, 0, 0.58, 1)`.
    ease_out,
    /// Equivalent to `cubic-bezier(0.42, 0, 0.58, 1)`.
    ease_in_out,
    /// A custom cubic Bézier easing function.
    cubic_bezier: struct {
        /// The x-position of the first point in the curve.
        x1: CSSNumber,
        /// The y-position of the first point in the curve.
        y1: CSSNumber,
        /// The x-position of the second point in the curve.
        x2: CSSNumber,
        /// The y-position of the second point in the curve.
        y2: CSSNumber,
    },
    /// A step easing function.
    steps: struct {
        /// The number of intervals in the function.
        count: CSSInteger,
        /// The step position.
        position: StepPosition = StepPosition.default,
    },

    pub fn parse(input: *css.Parser) Result(EasingFunction) {
        const location = input.currentSourceLocation();
        if (input.tryParse(struct {
            fn parse(i: *css.Parser) Result([]const u8) {
                return i.expectIdent();
            }
        }.parse, .{}).asValue()) |ident| {
            // todo_stuff.match_ignore_ascii_case
            const keyword = if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(ident, "linear"))
                EasingFunction.linear
            else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(ident, "ease"))
                EasingFunction.ease
            else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(ident, "ease-in"))
                EasingFunction.ease_in
            else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(ident, "ease-out"))
                EasingFunction.ease_out
            else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(ident, "ease-in-out"))
                EasingFunction.ease_in_out
            else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(ident, "step-start"))
                EasingFunction{ .steps = .{ .count = 1, .position = .start } }
            else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(ident, "step-end"))
                EasingFunction{ .steps = .{ .count = 1, .position = .end } }
            else
                return .{ .err = location.newUnexpectedTokenError(.{ .ident = ident }) };
            return .{ .result = keyword };
        }

        const function = switch (input.expectFunction()) {
            .result => |vv| vv,
            .err => |e| return .{ .err = e },
        };
        return input.parseNestedBlock(
            EasingFunction,
            .{ .loc = location, .function = function },
            struct {
                fn parse(
                    closure: *const struct { loc: css.SourceLocation, function: []const u8 },
                    i: *css.Parser,
                ) Result(EasingFunction) {
                    if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(closure.function, "cubic-bezier")) {
                        const x1 = switch (CSSNumberFns.parse(i)) {
                            .result => |vv| vv,
                            .err => |e| return .{ .err = e },
                        };
                        if (i.expectComma().asErr()) |e| return .{ .err = e };
                        const y1 = switch (CSSNumberFns.parse(i)) {
                            .result => |vv| vv,
                            .err => |e| return .{ .err = e },
                        };
                        if (i.expectComma().asErr()) |e| return .{ .err = e };
                        const x2 = switch (CSSNumberFns.parse(i)) {
                            .result => |vv| vv,
                            .err => |e| return .{ .err = e },
                        };
                        if (i.expectComma().asErr()) |e| return .{ .err = e };
                        const y2 = switch (CSSNumberFns.parse(i)) {
                            .result => |vv| vv,
                            .err => |e| return .{ .err = e },
                        };
                        return .{ .result = EasingFunction{ .cubic_bezier = .{ .x1 = x1, .y1 = y1, .x2 = x2, .y2 = y2 } } };
                    } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(closure.function, "steps")) {
                        const count = switch (CSSIntegerFns.parse(i)) {
                            .result => |vv| vv,
                            .err => |e| return .{ .err = e },
                        };
                        const position = i.tryParse(struct {
                            fn parse(p: *css.Parser) Result(StepPosition) {
                                if (p.expectComma().asErr()) |e| return .{ .err = e };
                                return StepPosition.parse(p);
                            }
                        }.parse, .{}).unwrapOr(StepPosition.default);
                        return .{ .result = EasingFunction{ .steps = .{ .count = count, .position = position } } };
                    } else {
                        return closure.loc.newUnexpectedTokenError(.{ .ident = closure.function });
                    }
                }
            }.parse,
        );
    }

    pub fn toCss(this: *const EasingFunction, comptime W: type, dest: *css.Printer(W)) css.PrintErr!void {
        return switch (this.*) {
            .linear => try dest.writeStr("linear"),
            .ease => try dest.writeStr("ease"),
            .ease_in => try dest.writeStr("ease-in"),
            .ease_out => try dest.writeStr("ease-out"),
            .ease_in_out => try dest.writeStr("ease-in-out"),
            else => {
                if (this.isEase()) {
                    return dest.writeStr("ease");
                } else if (this == .cubic_bezier and std.meta.eql(this.cubic_bezier, .{
                    .x1 = 0.42,
                    .y1 = 0.0,
                    .x2 = 1.0,
                    .y2 = 1.0,
                })) {
                    return dest.writeStr("ease-in");
                } else if (this == .cubic_bezier and std.meta.eql(this.cubic_bezier, .{
                    .x1 = 0.0,
                    .y1 = 0.0,
                    .x2 = 0.58,
                    .y2 = 1.0,
                })) {
                    return dest.writeStr("ease-out");
                } else if (this == .cubic_bezier and std.meta.eql(this.cubic_bezier, .{
                    .x1 = 0.42,
                    .y1 = 0.0,
                    .x2 = 0.58,
                    .y2 = 1.0,
                })) {
                    return dest.writeStr("ease-in-out");
                }

                switch (this.*) {
                    .cubic_bezier => |cb| {
                        try dest.writeStr("cubic-bezier(");
                        try css.generic.toCss(cb.x1, W, dest);
                        try dest.writeChar(',');
                        try css.generic.toCss(cb.y1, W, dest);
                        try dest.writeChar(',');
                        try css.generic.toCss(cb.x2, W, dest);
                        try dest.writeChar(',');
                        try css.generic.toCss(cb.y2, W, dest);
                        try dest.writeChar(')');
                    },
                    .steps => {
                        if (this.steps.count == 1 and this.steps.position == .start) {
                            return try dest.writeStr("step-start");
                        }
                        if (this.steps.count == 1 and this.steps.position == .end) {
                            return try dest.writeStr("step-end");
                        }
                        try dest.writeStr("steps(");
                        try dest.writeFmt("steps({d}", .{this.steps.count});
                        try dest.delim(',', false);
                        try this.steps.position.toCss(W, dest);
                        return try dest.writeChar(')');
                    },
                    .linear, .ease, .ease_in, .ease_out, .ease_in_out => unreachable,
                }
            },
        };
    }

    /// Returns whether the easing function is equivalent to the `ease` keyword.
    pub fn isEase(this: *const EasingFunction) bool {
        return this.* == .ease or
            (this.* == .cubic_bezier and std.meta.eql(this.cubic_bezier == .{
            .x1 = 0.25,
            .y1 = 0.1,
            .x2 = 0.25,
            .y2 = 1.0,
        }));
    }
};

/// A [step position](https://www.w3.org/TR/css-easing-1/#step-position), used within the `steps()` function.
pub const StepPosition = enum {
    /// The first rise occurs at input progress value of 0.
    start,
    /// The last rise occurs at input progress value of 1.
    end,
    /// All rises occur within the range (0, 1).
    jump_none,
    /// The first rise occurs at input progress value of 0 and the last rise occurs at input progress value of 1.
    jump_both,

    // TODO: implement this
    // pub usingnamespace css.DeriveToCss(@This());

    pub fn toCss(this: *const StepPosition, comptime W: type, dest: *css.Printer(W)) css.PrintErr!void {
        _ = this; // autofix
        _ = dest; // autofix
        @compileError(css.todo_stuff.depth);
    }

    pub fn parse(input: *css.Parser) Result(StepPosition) {
        const location = input.currentSourceLocation();
        const ident = switch (input.expectIdent()) {
            .result => |vv| vv,
            .err => |e| return .{ .err = e },
        };
        // todo_stuff.match_ignore_ascii_case
        const keyword = if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(ident, "start"))
            StepPosition.start
        else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(ident, "end"))
            StepPosition.end
        else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(ident, "jump-start"))
            StepPosition.start
        else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(ident, "jump-end"))
            StepPosition.end
        else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(ident, "jump-none"))
            StepPosition.jump_none
        else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(ident, "jump-both"))
            StepPosition.jump_both
        else
            return .{ .err = location.newUnexpectedTokenError(.{ .ident = ident }) };
        return .{ .result = keyword };
    }
};
