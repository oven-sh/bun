pub const css = @import("../css_parser.zig");

const Printer = css.Printer;
const PrintErr = css.PrintErr;

/// A value for the [position](https://www.w3.org/TR/css-position-3/#position-property) property.
pub const Position = union(enum) {
    /// The box is laid in the document flow.
    static,
    /// The box is laid out in the document flow and offset from the resulting position.
    relative,
    /// The box is taken out of document flow and positioned in reference to its relative ancestor.
    absolute,
    /// Similar to relative but adjusted according to the ancestor scrollable element.
    sticky: css.VendorPrefix,
    /// The box is taken out of the document flow and positioned in reference to the page viewport.
    fixed,

    pub fn parse(input: *css.Parser) css.Result(Position) {
        const location = input.currentSourceLocation();
        const ident = switch (input.expectIdent()) {
            .err => |e| return .{ .err = e },
            .result => |v| v,
        };

        const PositionKeyword = enum {
            static,
            relative,
            absolute,
            fixed,
            sticky,
            @"-webkit-sticky",
        };

        const keyword_map = bun.ComptimeStringMap(PositionKeyword, .{
            .{ "static", .static },
            .{ "relative", .relative },
            .{ "absolute", .absolute },
            .{ "fixed", .fixed },
            .{ "sticky", .sticky },
            .{ "-webkit-sticky", .@"-webkit-sticky" },
        });

        const keyword = keyword_map.get(ident) orelse {
            return .{ .err = location.newUnexpectedTokenError(.{ .ident = ident }) };
        };

        return .{ .result = switch (keyword) {
            .static => .static,
            .relative => .relative,
            .absolute => .absolute,
            .fixed => .fixed,
            .sticky => .{ .sticky = css.VendorPrefix{ .none = true } },
            .@"-webkit-sticky" => .{ .sticky = css.VendorPrefix{ .webkit = true } },
        } };
    }

    pub fn toCss(this: *const Position, dest: *css.Printer) css.PrintErr!void {
        return switch (this.*) {
            .static => dest.writeStr("static"),
            .relative => dest.writeStr("relative"),
            .absolute => dest.writeStr("absolute"),
            .fixed => dest.writeStr("fixed"),
            .sticky => |prefix| {
                try prefix.toCss(dest);
                return dest.writeStr("sticky");
            },
        };
    }

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }
};

const bun = @import("bun");
const std = @import("std");
const Allocator = std.mem.Allocator;
