const std = @import("std");
const Allocator = std.mem.Allocator;

pub const css = @import("../css_parser.zig");

const Printer = css.Printer;
const PrintErr = css.PrintErr;

/// A value for the [overflow](https://www.w3.org/TR/css-overflow-3/#overflow-properties) shorthand property.
pub const Overflow = struct {
    /// A value for the [overflow](https://www.w3.org/TR/css-overflow-3/#overflow-properties) shorthand property.
    x: OverflowKeyword,
    /// The overflow mode for the y direction.
    y: OverflowKeyword,

    pub fn parse(input: *css.Parser) css.Result(Overflow) {
        const x = switch (OverflowKeyword.parse(input)) {
            .result => |v| v,
            .err => |e| return .{ .err = e },
        };
        const y = switch (input.tryParse(OverflowKeyword.parse, .{})) {
            .result => |v| v,
            else => x,
        };
        return .{ .result = Overflow{ .x = x, .y = y } };
    }

    pub fn toCss(this: *const Overflow, comptime W: type, dest: *css.Printer(W)) css.PrintErr!void {
        try this.x.toCss(W, dest);
        if (this.y != this.x) {
            try dest.writeChar(' ');
            try this.y.toCss(W, dest);
        }
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }

    pub inline fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }
};

/// An [overflow](https://www.w3.org/TR/css-overflow-3/#overflow-properties) keyword
/// as used in the `overflow-x`, `overflow-y`, and `overflow` properties.
pub const OverflowKeyword = enum {
    /// Overflowing content is visible.
    visible,
    /// Overflowing content is hidden. Programmatic scrolling is allowed.
    hidden,
    /// Overflowing content is clipped. Programmatic scrolling is not allowed.
    clip,
    /// The element is scrollable.
    scroll,
    /// Overflowing content scrolls if needed.
    auto,

    const css_impl = css.DefineEnumProperty(@This());
    pub const eql = css_impl.eql;
    pub const hash = css_impl.hash;
    pub const parse = css_impl.parse;
    pub const toCss = css_impl.toCss;
    pub const deepClone = css_impl.deepClone;
};

/// A value for the [text-overflow](https://www.w3.org/TR/css-overflow-3/#text-overflow) property.
pub const TextOverflow = enum {
    /// Overflowing text is clipped.
    clip,
    /// Overflowing text is truncated with an ellipsis.
    ellipsis,

    const css_impl = css.DefineEnumProperty(@This());
    pub const eql = css_impl.eql;
    pub const hash = css_impl.hash;
    pub const parse = css_impl.parse;
    pub const toCss = css_impl.toCss;
    pub const deepClone = css_impl.deepClone;
};
