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
const CSSInteger = css.css_values.number.CSSInteger;
const CSSIntegerFns = css.css_values.number.CSSIntegerFns;
const Angle = css.css_values.angle.Angle;
const Time = css.css_values.time.Time;
const CustomIdent = css.css_values.ident.CustomIdent;
const CustomIdentFns = css.css_values.ident.CustomIdentFns;
const Ident = css.css_values.ident.Ident;

/// A CSS `<resolution>` value.
pub const Resolution = union(enum) {
    /// A resolution in dots per inch.
    dpi: CSSNumber,
    /// A resolution in dots per centimeter.
    dpcm: CSSNumber,
    /// A resolution in dots per px.
    dppx: CSSNumber,

    // ~toCssImpl
    const This = @This();

    pub fn hash(this: *const @This(), hasher: *std.hash.Wyhash) void {
        return css.implementHash(@This(), this, hasher);
    }

    pub fn eql(this: *const Resolution, other: *const Resolution) bool {
        return switch (this.*) {
            .dpi => |*a| switch (other.*) {
                .dpi => a.* == other.dpi,
                else => false,
            },
            .dpcm => |*a| switch (other.*) {
                .dpcm => a.* == other.dpcm,
                else => false,
            },
            .dppx => |*a| switch (other.*) {
                .dppx => a.* == other.dppx,
                else => false,
            },
        };
    }

    pub fn parse(input: *css.Parser) Result(Resolution) {
        // TODO: calc?
        const location = input.currentSourceLocation();
        const tok = switch (input.next()) {
            .result => |vv| vv,
            .err => |e| return .{ .err = e },
        };
        if (tok.* == .dimension) {
            const value = tok.dimension.num.value;
            const unit = tok.dimension.unit;
            // css.todo_stuff.match_ignore_ascii_case
            if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(unit, "dpi")) return .{ .result = .{ .dpi = value } };
            if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(unit, "dpcm")) return .{ .result = .{ .dpcm = value } };
            if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(unit, "dppx") or bun.strings.eqlCaseInsensitiveASCIIICheckLength(unit, "x")) return .{ .result = .{ .dppx = value } };
            return .{ .err = location.newUnexpectedTokenError(.{ .ident = unit }) };
        }
        return .{ .err = location.newUnexpectedTokenError(tok.*) };
    }

    pub fn tryFromToken(token: *const css.Token) css.Maybe(Resolution, void) {
        switch (token.*) {
            .dimension => |dim| {
                const value = dim.num.value;
                const unit = dim.unit;
                // todo_stuff.match_ignore_ascii_case
                if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(unit, "dpi")) {
                    return .{ .result = .{ .dpi = value } };
                } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(unit, "dpcm")) {
                    return .{ .result = .{ .dpcm = value } };
                } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(unit, "dppx") or
                    bun.strings.eqlCaseInsensitiveASCIIICheckLength(unit, "x"))
                {
                    return .{ .result = .{ .dppx = value } };
                } else {
                    return .{ .err = {} };
                }
            },
            else => return .{ .err = {} },
        }
    }

    pub fn toCss(this: *const This, comptime W: type, dest: *Printer(W)) PrintErr!void {
        const value, const unit = switch (this.*) {
            .dpi => |dpi| .{ dpi, "dpi" },
            .dpcm => |dpcm| .{ dpcm, "dpcm" },
            .dppx => |dppx| if (dest.targets.isCompatible(.x_resolution_unit))
                .{ dppx, "x" }
            else
                .{ dppx, "dppx" },
        };

        return try css.serializer.serializeDimension(value, unit, W, dest);
    }

    pub fn addF32(this: This, _: std.mem.Allocator, other: f32) Resolution {
        return switch (this) {
            .dpi => |dpi| .{ .dpi = dpi + other },
            .dpcm => |dpcm| .{ .dpcm = dpcm + other },
            .dppx => |dppx| .{ .dppx = dppx + other },
        };
    }
};
