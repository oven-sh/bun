const std = @import("std");
const Allocator = std.mem.Allocator;

pub const css = @import("../css_parser.zig");
pub const css_values = @import("../values/values.zig");
pub const Error = css.Error;
const Printer = css.Printer;
const PrintErr = css.PrintErr;

/// @tailwind
/// https://github.com/tailwindlabs/tailwindcss.com/blob/4d6ac11425d96bc963f936e0157df460a364c43b/src/pages/docs/functions-and-directives.mdx?plain=1#L13
pub const TailwindAtRule = struct {
    style_name: TailwindStyleName,
    /// The location of the rule in the source file.
    loc: css.Location,

    pub fn toCss(this: *const @This(), comptime W: type, dest: *Printer(W)) PrintErr!void {
        try dest.writeStr("@tailwind");
        try dest.whitespace();
        try this.style_name.toCss(W, dest);
        try dest.writeChar(';');
    }

    pub fn deepClone(this: *const @This(), _: std.mem.Allocator) @This() {
        return this.*;
    }
};

pub const TailwindStyleName = enum {
    /// This injects Tailwind's base styles and any base styles registered by
    ///  plugins.
    base,
    /// This injects Tailwind's component classes and any component classes
    /// registered by plugins.
    components,
    /// This injects Tailwind's utility classes and any utility classes registered
    /// by plugins.
    utilities,
    /// Use this directive to control where Tailwind injects the hover, focus,
    /// responsive, dark mode, and other variants of each class.
    ///
    /// If omitted, Tailwind will append these classes to the very end of
    /// your stylesheet by default.
    variants,

    pub fn asStr(this: *const @This()) []const u8 {
        return css.enum_property_util.asStr(@This(), this);
    }

    pub fn parse(input: *css.Parser) css.Result(@This()) {
        return css.enum_property_util.parse(@This(), input);
    }

    pub fn toCss(this: *const @This(), comptime W: type, dest: *Printer(W)) PrintErr!void {
        return css.enum_property_util.toCss(@This(), this, W, dest);
    }
};
