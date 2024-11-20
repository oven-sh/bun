const std = @import("std");
const bun = @import("root").bun;
const Allocator = std.mem.Allocator;
const ArrayList = std.ArrayListUnmanaged;

pub const css = @import("../css_parser.zig");

const SmallList = css.SmallList;
const Printer = css.Printer;
const PrintErr = css.PrintErr;
const Error = css.Error;

const ContainerName = css.css_rules.container.ContainerName;

const LengthPercentage = css.css_values.length.LengthPercentage;
const CustomIdent = css.css_values.ident.CustomIdent;
const CSSString = css.css_values.string.CSSString;
const CSSNumber = css.css_values.number.CSSNumber;
const LengthPercentageOrAuto = css.css_values.length.LengthPercentageOrAuto;
const Size2D = css.css_values.size.Size2D;
const DashedIdent = css.css_values.ident.DashedIdent;
const Image = css.css_values.image.Image;
const CssColor = css.css_values.color.CssColor;
const Ratio = css.css_values.ratio.Ratio;
const Length = css.css_values.length.LengthValue;
const Rect = css.css_values.rect.Rect;
const NumberOrPercentage = css.css_values.percentage.NumberOrPercentage;
const CustomIdentList = css.css_values.ident.CustomIdentList;

/// A value for the [display](https://drafts.csswg.org/css-display-3/#the-display-properties) property.
pub const Display = union(enum) {
    /// A display keyword.
    keyword: DisplayKeyword,
    /// The inside and outside display values.
    pair: DisplayPair,

    pub usingnamespace css.DeriveParse(@This());
    pub usingnamespace css.DeriveToCss(@This());

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }

    pub fn hash(this: *const @This(), hasher: *std.hash.Wyhash) void {
        return css.implementHash(@This(), this, hasher);
    }

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }
};

/// A value for the [visibility](https://drafts.csswg.org/css-display-3/#visibility) property.
pub const Visibility = enum {
    /// The element is visible.
    visible,
    /// The element is hidden.
    hidden,
    /// The element is collapsed.
    collapse,

    pub usingnamespace css.DefineEnumProperty(@This());
};

/// A `display` keyword.
///
/// See [Display](Display).
pub const DisplayKeyword = enum {
    none,
    contents,
    @"table-row-group",
    @"table-header-group",
    @"table-footer-group",
    @"table-row",
    @"table-cell",
    @"table-column-group",
    @"table-column",
    @"table-caption",
    @"ruby-base",
    @"ruby-text",
    @"ruby-base-container",
    @"ruby-text-container",

    pub usingnamespace css.DefineEnumProperty(@This());
};

/// A pair of inside and outside display values, as used in the `display` property.
///
/// See [Display](Display).
pub const DisplayPair = struct {
    /// The outside display value.
    outside: DisplayOutside,
    /// The inside display value.
    inside: DisplayInside,
    /// Whether this is a list item.
    is_list_item: bool,

    pub fn parse(input: *css.Parser) css.Result(@This()) {
        var list_item = false;
        var outside: ?DisplayOutside = null;
        var inside: ?DisplayInside = null;

        while (true) {
            if (input.tryParse(css.Parser.expectIdentMatching, .{"list-item"}).isOk()) {
                list_item = true;
                continue;
            }

            if (outside == null) {
                if (input.tryParse(DisplayOutside.parse, .{}).asValue()) |o| {
                    outside = o;
                    continue;
                }
            }

            if (inside == null) {
                if (input.tryParse(DisplayInside.parse, .{}).asValue()) |i| {
                    inside = i;
                    continue;
                }
            }

            break;
        }

        if (list_item or inside != null or outside != null) {
            const final_inside: DisplayInside = inside orelse DisplayInside.flow;
            const final_outside: DisplayOutside = outside orelse switch (final_inside) {
                // "If <display-outside> is omitted, the element’s outside display type
                // defaults to block — except for ruby, which defaults to inline."
                // https://drafts.csswg.org/css-display/#inside-model
                .ruby => .@"inline",
                else => .block,
            };

            if (list_item and !(final_inside == .flow or final_inside == .flow_root)) {
                return .{ .err = input.newCustomError(.invalid_declaration) };
            }

            return .{ .result = .{
                .outside = final_outside,
                .inside = final_inside,
                .is_list_item = list_item,
            } };
        }

        const location = input.currentSourceLocation();
        const ident = switch (input.expectIdent()) {
            .result => |v| v,
            .err => |e| return .{ .err = e },
        };

        const displayIdentMap = bun.ComptimeStringMap(DisplayPair, .{
            .{ "inline-block", DisplayPair{ .outside = .@"inline", .inside = .flow_root, .is_list_item = false } },
            .{ "inline-table", DisplayPair{ .outside = .@"inline", .inside = .table, .is_list_item = false } },
            .{ "inline-flex", DisplayPair{ .outside = .@"inline", .inside = .{ .flex = css.VendorPrefix{ .none = true } }, .is_list_item = false } },
            .{ "-webkit-inline-flex", DisplayPair{ .outside = .@"inline", .inside = .{ .flex = css.VendorPrefix{ .webkit = true } }, .is_list_item = false } },
            .{ "-ms-inline-flexbox", DisplayPair{ .outside = .@"inline", .inside = .{ .flex = css.VendorPrefix{ .ms = true } }, .is_list_item = false } },
            .{ "-webkit-inline-box", DisplayPair{ .outside = .@"inline", .inside = .{ .box = css.VendorPrefix{ .webkit = true } }, .is_list_item = false } },
            .{ "-moz-inline-box", DisplayPair{ .outside = .@"inline", .inside = .{ .box = css.VendorPrefix{ .moz = true } }, .is_list_item = false } },
            .{ "inline-grid", DisplayPair{ .outside = .@"inline", .inside = .grid, .is_list_item = false } },
        });
        if (displayIdentMap.getASCIIICaseInsensitive(ident)) |pair| {
            return .{ .result = pair };
        }

        return .{ .err = location.newUnexpectedTokenError(.{ .ident = ident }) };
    }

    pub fn toCss(this: *const DisplayPair, comptime W: type, dest: *css.Printer(W)) css.PrintErr!void {
        if (this.outside == .@"inline" and this.inside == .flow_root and !this.is_list_item) {
            return dest.writeStr("inline-block");
        } else if (this.outside == .@"inline" and this.inside == .table and !this.is_list_item) {
            return dest.writeStr("inline-table");
        } else if (this.outside == .@"inline" and this.inside == .flex and !this.is_list_item) {
            try this.inside.flex.toCss(W, dest);
            if (this.inside.flex.eql(css.VendorPrefix{ .ms = true })) {
                return dest.writeStr("inline-flexbox");
            } else {
                return dest.writeStr("inline-flex");
            }
        } else if (this.outside == .@"inline" and this.inside == .box and !this.is_list_item) {
            try this.inside.box.toCss(W, dest);
            return dest.writeStr("inline-box");
        } else if (this.outside == .@"inline" and this.inside == .grid and !this.is_list_item) {
            return dest.writeStr("inline-grid");
        } else {
            const default_outside: DisplayOutside = switch (this.inside) {
                .ruby => .@"inline",
                else => .block,
            };

            var needs_space = false;
            if (!this.outside.eql(&default_outside) or (this.inside.eql(&DisplayInside{ .flow = {} }) and !this.is_list_item)) {
                try this.outside.toCss(W, dest);
                needs_space = true;
            }

            if (!this.inside.eql(&DisplayInside{ .flow = {} })) {
                if (needs_space) {
                    try dest.writeChar(' ');
                }
                try this.inside.toCss(W, dest);
                needs_space = true;
            }

            if (this.is_list_item) {
                if (needs_space) {
                    try dest.writeChar(' ');
                }
                try dest.writeStr("list-item");
            }
        }
    }

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }
};

/// A [`<display-outside>`](https://drafts.csswg.org/css-display-3/#typedef-display-outside) value.
pub const DisplayOutside = enum {
    block,
    @"inline",
    @"run-in",

    pub usingnamespace css.DefineEnumProperty(@This());
};

/// A [`<display-inside>`](https://drafts.csswg.org/css-display-3/#typedef-display-inside) value.
pub const DisplayInside = union(enum) {
    flow,
    flow_root,
    table,
    flex: css.VendorPrefix,
    box: css.VendorPrefix,
    grid,
    ruby,

    pub fn parse(input: *css.Parser) css.Result(@This()) {
        const displayInsideMap = bun.ComptimeStringMap(DisplayInside, .{
            .{ "flow", DisplayInside.flow },
            .{ "flow-root", DisplayInside.flow_root },
            .{ "table", .table },
            .{ "flex", .{ .flex = css.VendorPrefix{ .none = true } } },
            .{ "-webkit-flex", .{ .flex = css.VendorPrefix{ .webkit = true } } },
            .{ "-ms-flexbox", .{ .flex = css.VendorPrefix{ .ms = true } } },
            .{ "-webkit-box", .{ .box = css.VendorPrefix{ .webkit = true } } },
            .{ "-moz-box", .{ .box = css.VendorPrefix{ .moz = true } } },
            .{ "grid", .grid },
            .{ "ruby", .ruby },
        });

        const location = input.currentSourceLocation();
        const ident = switch (input.expectIdent()) {
            .result => |v| v,
            .err => |e| return .{ .err = e },
        };

        if (displayInsideMap.getASCIIICaseInsensitive(ident)) |value| {
            return .{ .result = value };
        }

        return .{ .err = location.newUnexpectedTokenError(.{ .ident = ident }) };
    }

    pub fn toCss(this: *const DisplayInside, comptime W: type, dest: *css.Printer(W)) css.PrintErr!void {
        switch (this.*) {
            .flow => try dest.writeStr("flow"),
            .flow_root => try dest.writeStr("flow-root"),
            .table => try dest.writeStr("table"),
            .flex => |prefix| {
                try prefix.toCss(W, dest);
                if (prefix.eql(css.VendorPrefix{ .ms = true })) {
                    try dest.writeStr("flexbox");
                } else {
                    try dest.writeStr("flex");
                }
            },
            .box => |prefix| {
                try prefix.toCss(W, dest);
                try dest.writeStr("box");
            },
            .grid => try dest.writeStr("grid"),
            .ruby => try dest.writeStr("ruby"),
        }
    }

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }
};
