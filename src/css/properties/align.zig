const std = @import("std");
const bun = @import("bun");
const Allocator = std.mem.Allocator;

pub const css = @import("../css_parser.zig");

const Printer = css.Printer;
const PrintErr = css.PrintErr;

const LengthPercentage = css.css_values.length.LengthPercentage;

const VendorPrefix = css.VendorPrefix;
const Property = css.Property;
const Feature = css.prefixes.Feature;

/// A value for the [align-content](https://www.w3.org/TR/css-align-3/#propdef-align-content) property.
pub const AlignContent = union(enum) {
    /// Default alignment.
    normal: void,
    /// A baseline position.
    baseline_position: BaselinePosition,
    /// A content distribution keyword.
    content_distribution: ContentDistribution,
    /// A content position keyword.
    content_position: struct {
        /// An overflow alignment mode.
        overflow: ?OverflowPosition,
        /// A content position keyword.
        value: ContentPosition,

        pub fn toInner(this: *const @This()) ContentPositionInner {
            return .{
                .overflow = this.overflow,
                .value = this.value,
            };
        }

        pub fn __generateToCss() void {}

        pub fn parse(input: *css.Parser) css.Result(@This()) {
            const overflow = input.tryParse(OverflowPosition.parse, .{}).asValue();

            const value = switch (ContentPosition.parse(input)) {
                .result => |v| v,
                .err => |e| return .{ .err = e },
            };
            return .{ .result = .{ .overflow = overflow, .value = value } };
        }

        pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
            return css.implementEql(@This(), lhs, rhs);
        }

        pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
            return css.implementDeepClone(@This(), this, allocator);
        }
    },

    pub const parse = css.DeriveParse(@This()).parse;
    pub const toCss = css.DeriveToCss(@This()).toCss;

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }
};

/// A [`<baseline-position>`](https://www.w3.org/TR/css-align-3/#typedef-baseline-position) value,
/// as used in the alignment properties.
pub const BaselinePosition = enum {
    /// The first baseline.
    first,
    /// The last baseline.
    last,

    pub fn parse(input: *css.Parser) css.Result(@This()) {
        const location = input.currentSourceLocation();
        const ident = switch (input.expectIdent()) {
            .err => |e| return .{ .err = e },
            .result => |v| v,
        };

        const BaselinePositionIdent = enum {
            baseline,
            first,
            last,
        };

        const BaselinePositionMap = bun.ComptimeEnumMap(BaselinePositionIdent);
        if (BaselinePositionMap.getASCIIICaseInsensitive(ident)) |value|
            switch (value) {
                .baseline => return .{ .result = BaselinePosition.first },
                .first => {
                    if (input.expectIdentMatching("baseline").asErr()) |e| return .{ .err = e };
                    return .{ .result = BaselinePosition.first };
                },
                .last => {
                    if (input.expectIdentMatching("baseline").asErr()) |e| return .{ .err = e };
                    return .{ .result = BaselinePosition.last };
                },
            }
        else
            return .{ .err = location.newUnexpectedTokenError(.{ .ident = ident }) };
    }

    pub fn toCss(this: *const BaselinePosition, comptime W: type, dest: *css.Printer(W)) css.PrintErr!void {
        return switch (this.*) {
            .first => try dest.writeStr("baseline"),
            .last => try dest.writeStr("last baseline"),
        };
    }

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }
};

/// A value for the [justify-content](https://www.w3.org/TR/css-align-3/#propdef-justify-content) property.
pub const JustifyContent = union(enum) {
    /// Default justification.
    normal,
    /// A content distribution keyword.
    content_distribution: ContentDistribution,
    /// A content position keyword.
    content_position: struct {
        /// A content position keyword.
        value: ContentPosition,
        /// An overflow alignment mode.
        overflow: ?OverflowPosition,

        pub fn toInner(this: *const @This()) ContentPositionInner {
            return .{
                .overflow = this.overflow,
                .value = this.value,
            };
        }

        pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
            return css.implementEql(@This(), lhs, rhs);
        }

        pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
            return css.implementDeepClone(@This(), this, allocator);
        }
    },
    /// Justify to the left.
    left: struct {
        /// An overflow alignment mode.
        overflow: ?OverflowPosition,

        pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
            return css.implementEql(@This(), lhs, rhs);
        }

        pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
            return css.implementDeepClone(@This(), this, allocator);
        }
    },
    /// Justify to the right.
    right: struct {
        /// An overflow alignment mode.
        overflow: ?OverflowPosition,

        pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
            return css.implementEql(@This(), lhs, rhs);
        }

        pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
            return css.implementDeepClone(@This(), this, allocator);
        }
    },

    pub fn parse(input: *css.Parser) css.Result(@This()) {
        if (input.tryParse(css.Parser.expectIdentMatching, .{"normal"}).isOk()) {
            return .{ .result = .normal };
        }

        if (input.tryParse(ContentDistribution.parse, .{}).asValue()) |val| {
            return .{ .result = .{ .content_distribution = val } };
        }

        const overflow = input.tryParse(OverflowPosition.parse, .{}).asValue();
        if (input.tryParse(ContentPosition.parse, .{}).asValue()) |content_position| {
            return .{ .result = .{
                .content_position = .{
                    .overflow = overflow,
                    .value = content_position,
                },
            } };
        }

        const location = input.currentSourceLocation();
        const ident = switch (input.expectIdent()) {
            .result => |v| v,
            .err => |e| return .{ .err = e },
        };

        const JustifyContentIdent = enum {
            left,
            right,
        };

        const JustifyContentIdentMap = bun.ComptimeEnumMap(JustifyContentIdent);
        if (JustifyContentIdentMap.getASCIIICaseInsensitive(ident)) |value|
            return switch (value) {
                .left => .{ .result = .{ .left = .{ .overflow = overflow } } },
                .right => .{ .result = .{ .right = .{ .overflow = overflow } } },
            }
        else
            return .{ .err = location.newUnexpectedTokenError(.{ .ident = ident }) };
    }

    pub fn toCss(this: *const @This(), comptime W: type, dest: *css.Printer(W)) css.PrintErr!void {
        return switch (this.*) {
            .normal => dest.writeStr("normal"),
            .content_distribution => |value| value.toCss(W, dest),
            .content_position => |*cp| {
                if (cp.overflow) |*overflow| {
                    try overflow.toCss(W, dest);
                    try dest.writeStr(" ");
                }
                return cp.value.toCss(W, dest);
            },
            .left => |*l| {
                if (l.overflow) |*overflow| {
                    try overflow.toCss(W, dest);
                    try dest.writeStr(" ");
                }
                return dest.writeStr("left");
            },
            .right => |*r| {
                if (r.overflow) |*overflow| {
                    try overflow.toCss(W, dest);
                    try dest.writeStr(" ");
                }
                return dest.writeStr("right");
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

/// A value for the [align-self](https://www.w3.org/TR/css-align-3/#align-self-property) property.
pub const AlignSelf = union(enum) {
    /// Automatic alignment.
    auto,
    /// Default alignment.
    normal,
    /// Item is stretched.
    stretch,
    /// A baseline position keyword.
    baseline_position: BaselinePosition,
    /// A self position keyword.
    self_position: struct {
        /// An overflow alignment mode.
        overflow: ?OverflowPosition,
        /// A self position keyword.
        value: SelfPosition,

        pub fn toInner(this: *const @This()) SelfPositionInner {
            return .{
                .overflow = this.overflow,
                .value = this.value,
            };
        }

        pub fn __generateToCss() void {}

        pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
            return css.implementEql(@This(), lhs, rhs);
        }

        pub fn parse(input: *css.Parser) css.Result(@This()) {
            const overflow = input.tryParse(OverflowPosition.parse, .{}).asValue();
            const self_position = switch (SelfPosition.parse(input)) {
                .result => |v| v,
                .err => |e| return .{ .err = e },
            };
            return .{
                .result = .{
                    .overflow = overflow,
                    .value = self_position,
                },
            };
        }
    },

    pub const parse = css.DeriveParse(@This()).parse;
    pub const toCss = css.DeriveToCss(@This()).toCss;

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }
};

/// A value for the [justify-self](https://www.w3.org/TR/css-align-3/#justify-self-property) property.
pub const JustifySelf = union(enum) {
    /// Automatic justification.
    auto,
    /// Default justification.
    normal,
    /// Item is stretched.
    stretch,
    /// A baseline position keyword.
    baseline_position: BaselinePosition,
    /// A self position keyword.
    self_position: struct {
        /// A self position keyword.
        value: SelfPosition,
        /// An overflow alignment mode.
        overflow: ?OverflowPosition,

        pub fn toInner(this: *const @This()) SelfPositionInner {
            return .{
                .overflow = this.overflow,
                .value = this.value,
            };
        }

        pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
            return css.implementEql(@This(), lhs, rhs);
        }

        pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
            return css.implementDeepClone(@This(), this, allocator);
        }
    },
    /// Item is justified to the left.
    left: struct {
        /// An overflow alignment mode.
        overflow: ?OverflowPosition,

        pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
            return css.implementEql(@This(), lhs, rhs);
        }

        pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
            return css.implementDeepClone(@This(), this, allocator);
        }
    },
    /// Item is justified to the right.
    right: struct {
        /// An overflow alignment mode.
        overflow: ?OverflowPosition,

        pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
            return css.implementEql(@This(), lhs, rhs);
        }

        pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
            return css.implementDeepClone(@This(), this, allocator);
        }
    },

    pub fn parse(input: *css.Parser) css.Result(@This()) {
        if (input.tryParse(css.Parser.expectIdentMatching, .{"auto"}).isOk()) {
            return .{ .result = .auto };
        }

        if (input.tryParse(css.Parser.expectIdentMatching, .{"normal"}).isOk()) {
            return .{ .result = .normal };
        }

        if (input.tryParse(css.Parser.expectIdentMatching, .{"stretch"}).isOk()) {
            return .{ .result = .stretch };
        }

        if (input.tryParse(BaselinePosition.parse, .{}).asValue()) |val| {
            return .{ .result = .{ .baseline_position = val } };
        }

        const overflow = input.tryParse(OverflowPosition.parse, .{}).asValue();
        if (input.tryParse(SelfPosition.parse, .{}).asValue()) |self_position| {
            return .{ .result = .{ .self_position = .{ .overflow = overflow, .value = self_position } } };
        }

        const location = input.currentSourceLocation();
        const ident = switch (input.expectIdent()) {
            .result => |v| v,
            .err => |e| return .{ .err = e },
        };
        const Enum = enum { left, right };
        const Map = bun.ComptimeEnumMap(Enum);
        if (Map.getASCIIICaseInsensitive(ident)) |val| return .{ .result = switch (val) {
            .left => .{ .left = .{ .overflow = overflow } },
            .right => .{ .right = .{ .overflow = overflow } },
        } };
        return .{ .err = location.newUnexpectedTokenError(.{ .ident = ident }) };
    }

    pub fn toCss(this: *const JustifySelf, comptime W: type, dest: *css.Printer(W)) css.PrintErr!void {
        return switch (this.*) {
            .auto => try dest.writeStr("auto"),
            .normal => try dest.writeStr("normal"),
            .stretch => try dest.writeStr("stretch"),
            .baseline_position => |*baseline_position| baseline_position.toCss(W, dest),
            .self_position => |*self_position| {
                if (self_position.overflow) |*overflow| {
                    try overflow.toCss(W, dest);
                    try dest.writeStr(" ");
                }

                try self_position.value.toCss(W, dest);
            },
            .left => |*left| {
                if (left.overflow) |*overflow| {
                    try overflow.toCss(W, dest);
                    try dest.writeStr(" ");
                }
                try dest.writeStr("left");
            },
            .right => |*right| {
                if (right.overflow) |*overflow| {
                    try overflow.toCss(W, dest);
                    try dest.writeStr(" ");
                }
                try dest.writeStr("right");
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

/// A value for the [align-items](https://www.w3.org/TR/css-align-3/#align-items-property) property.
pub const AlignItems = union(enum) {
    /// Default alignment.
    normal,
    /// Items are stretched.
    stretch,
    /// A baseline position keyword.
    baseline_position: BaselinePosition,
    /// A self position keyword.
    self_position: struct {
        /// An overflow alignment mode.
        overflow: ?OverflowPosition,
        /// A self position keyword.
        value: SelfPosition,

        pub fn toInner(this: *const @This()) SelfPositionInner {
            return .{
                .overflow = this.overflow,
                .value = this.value,
            };
        }

        pub fn parse(input: *css.Parser) css.Result(@This()) {
            const overflow = input.tryParse(OverflowPosition.parse, .{}).asValue();
            const self_position = switch (SelfPosition.parse(input)) {
                .result => |v| v,
                .err => |e| return .{ .err = e },
            };
            return .{
                .result = .{
                    .overflow = overflow,
                    .value = self_position,
                },
            };
        }

        pub fn __generateToCss() void {}

        pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
            return css.implementEql(@This(), lhs, rhs);
        }

        pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
            return css.implementDeepClone(@This(), this, allocator);
        }
    },

    pub const parse = css.DeriveParse(@This()).parse;
    pub const toCss = css.DeriveToCss(@This()).toCss;

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }
};

/// A value for the [justify-items](https://www.w3.org/TR/css-align-3/#justify-items-property) property.
pub const JustifyItems = union(enum) {
    /// Default justification.
    normal,
    /// Items are stretched.
    stretch,
    /// A baseline position keyword.
    baseline_position: BaselinePosition,
    /// A self position keyword, with optional overflow position.
    self_position: struct {
        /// A self position keyword.
        value: SelfPosition,
        /// An overflow alignment mode.
        overflow: ?OverflowPosition,

        pub fn toInner(this: *const @This()) SelfPositionInner {
            return .{
                .overflow = this.overflow,
                .value = this.value,
            };
        }

        pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
            return css.implementEql(@This(), lhs, rhs);
        }

        pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
            return css.implementDeepClone(@This(), this, allocator);
        }
    },
    /// Items are justified to the left, with an optional overflow position.
    left: struct {
        /// An overflow alignment mode.
        overflow: ?OverflowPosition,

        pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
            return css.implementEql(@This(), lhs, rhs);
        }

        pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
            return css.implementDeepClone(@This(), this, allocator);
        }
    },
    /// Items are justified to the right, with an optional overflow position.
    right: struct {
        /// An overflow alignment mode.
        overflow: ?OverflowPosition,

        pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
            return css.implementEql(@This(), lhs, rhs);
        }

        pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
            return css.implementDeepClone(@This(), this, allocator);
        }
    },
    /// A legacy justification keyword.
    legacy: LegacyJustify,

    pub fn parse(input: *css.Parser) css.Result(@This()) {
        if (input.tryParse(css.Parser.expectIdentMatching, .{"normal"}).isOk()) {
            return .{ .result = .normal };
        }

        if (input.tryParse(css.Parser.expectIdentMatching, .{"stretch"}).isOk()) {
            return .{ .result = .stretch };
        }

        if (input.tryParse(BaselinePosition.parse, .{}).asValue()) |val| {
            return .{ .result = .{ .baseline_position = val } };
        }

        if (input.tryParse(LegacyJustify.parse, .{}).asValue()) |val| {
            return .{ .result = .{ .legacy = val } };
        }

        const overflow = input.tryParse(OverflowPosition.parse, .{}).asValue();
        if (input.tryParse(SelfPosition.parse, .{}).asValue()) |self_position| {
            return .{ .result = .{ .self_position = .{ .overflow = overflow, .value = self_position } } };
        }

        const location = input.currentSourceLocation();
        const ident = switch (input.expectIdent()) {
            .result => |v| v,
            .err => |e| return .{ .err = e },
        };

        const Enum = enum { left, right };
        const Map = bun.ComptimeEnumMap(Enum);
        if (Map.getASCIIICaseInsensitive(ident)) |val| return .{ .result = switch (val) {
            .left => .{ .left = .{ .overflow = overflow } },
            .right => .{ .right = .{ .overflow = overflow } },
        } };
        return .{ .err = location.newUnexpectedTokenError(.{ .ident = ident }) };
    }

    pub fn toCss(this: *const JustifyItems, comptime W: type, dest: *css.Printer(W)) css.PrintErr!void {
        switch (this.*) {
            .normal => try dest.writeStr("normal"),
            .stretch => try dest.writeStr("stretch"),
            .baseline_position => |*val| try val.toCss(W, dest),
            .self_position => |*sp| {
                if (sp.overflow) |*overflow| {
                    try overflow.toCss(W, dest);
                    try dest.writeStr(" ");
                }
                try sp.value.toCss(W, dest);
            },
            .left => |*l| {
                if (l.overflow) |*overflow| {
                    try overflow.toCss(W, dest);
                    try dest.writeStr(" ");
                }
                try dest.writeStr("left");
            },
            .right => |*r| {
                if (r.overflow) |*overflow| {
                    try overflow.toCss(W, dest);
                    try dest.writeStr(" ");
                }
                try dest.writeStr("right");
            },
            .legacy => |l| try l.toCss(W, dest),
        }
    }

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }
};

/// A legacy justification keyword, as used in the `justify-items` property.
pub const LegacyJustify = enum {
    /// Left justify.
    left,
    /// Right justify.
    right,
    /// Centered.
    center,

    pub fn parse(input: *css.Parser) css.Result(@This()) {
        const location = input.currentSourceLocation();
        const ident = switch (input.expectIdent()) {
            .err => |e| return .{ .err = e },
            .result => |v| v,
        };

        const LegacyJustifyIdent = enum {
            legacy,
            left,
            right,
            center,
        };

        const LegacyJustifyMap = bun.ComptimeEnumMap(LegacyJustifyIdent);
        if (LegacyJustifyMap.getASCIIICaseInsensitive(ident)) |value| {
            switch (value) {
                .legacy => {
                    const inner_location = input.currentSourceLocation();
                    const inner_ident = switch (input.expectIdent()) {
                        .err => |e| return .{ .err = e },
                        .result => |v| v,
                    };
                    const InnerEnum = enum { left, right, center };
                    const InnerLegacyJustifyMap = bun.ComptimeEnumMap(InnerEnum);
                    if (InnerLegacyJustifyMap.getASCIIICaseInsensitive(inner_ident)) |inner_value| {
                        return switch (inner_value) {
                            .left => .{ .result = .left },
                            .right => .{ .result = .right },
                            .center => .{ .result = .center },
                        };
                    } else {
                        return .{ .err = inner_location.newUnexpectedTokenError(.{ .ident = inner_ident }) };
                    }
                },
                .left => {
                    if (input.expectIdentMatching("legacy").asErr()) |e| return .{ .err = e };
                    return .{ .result = .left };
                },
                .right => {
                    if (input.expectIdentMatching("legacy").asErr()) |e| return .{ .err = e };
                    return .{ .result = .right };
                },
                .center => {
                    if (input.expectIdentMatching("legacy").asErr()) |e| return .{ .err = e };
                    return .{ .result = .center };
                },
            }
        }
        return .{ .err = location.newUnexpectedTokenError(.{ .ident = ident }) };
    }

    pub fn toCss(this: *const @This(), comptime W: type, dest: *css.Printer(W)) css.PrintErr!void {
        try dest.writeStr("legacy ");
        switch (this.*) {
            .left => try dest.writeStr("left"),
            .right => try dest.writeStr("right"),
            .center => try dest.writeStr("center"),
        }
    }

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }
};

/// A [gap](https://www.w3.org/TR/css-align-3/#column-row-gap) value, as used in the
/// `column-gap` and `row-gap` properties.
pub const GapValue = union(enum) {
    /// Equal to `1em` for multi-column containers, and zero otherwise.
    normal,
    /// An explicit length.
    length_percentage: LengthPercentage,

    pub const parse = css.DeriveParse(@This()).parse;
    pub const toCss = css.DeriveToCss(@This()).toCss;

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }
};

/// A value for the [gap](https://www.w3.org/TR/css-align-3/#gap-shorthand) shorthand property.
pub const Gap = struct {
    /// The row gap.
    row: GapValue,
    /// The column gap.
    column: GapValue,

    pub const PropertyFieldMap = .{
        .row = "row-gap",
        .column = "column-gap",
    };

    pub fn parse(input: *css.Parser) css.Result(@This()) {
        const row = switch (@call(.auto, @field(GapValue, "parse"), .{input})) {
            .result => |v| v,
            .err => |e| return .{ .err = e },
        };
        const column = switch (input.tryParse(@field(GapValue, "parse"), .{})) {
            .result => |v| v,
            .err => row,
        };
        return .{ .result = .{ .row = row, .column = column } };
    }

    pub fn toCss(this: *const Gap, comptime W: type, dest: *css.Printer(W)) css.PrintErr!void {
        try this.row.toCss(W, dest);
        if (!this.column.eql(&this.row)) {
            try dest.writeStr(" ");
            try this.column.toCss(W, dest);
        }
    }

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }
};

/// A value for the [place-items](https://www.w3.org/TR/css-align-3/#place-items-property) shorthand property.
pub const PlaceItems = struct {
    /// The item alignment.
    @"align": AlignItems,
    /// The item justification.
    justify: JustifyItems,

    pub const PropertyFieldMap = .{
        .@"align" = "align-items",
        .justify = "justify-items",
    };

    pub const VendorPrefixMap = .{
        .@"align" = true,
    };

    pub fn parse(input: *css.Parser) css.Result(@This()) {
        const @"align" = switch (@call(.auto, @field(AlignItems, "parse"), .{input})) {
            .result => |v| v,
            .err => |e| return .{ .err = e },
        };
        const justify = switch (input.tryParse(@field(JustifyItems, "parse"), .{})) {
            .result => |v| v,
            .err => switch (@"align") {
                .normal => JustifyItems.normal,
                .stretch => JustifyItems.stretch,
                .baseline_position => |p| JustifyItems{ .baseline_position = p },
                .self_position => |sp| JustifyItems{
                    .self_position = .{
                        .overflow = if (sp.overflow) |o| o else null,
                        .value = sp.value,
                    },
                },
            },
        };

        return .{ .result = .{ .@"align" = @"align", .justify = justify } };
    }

    pub fn toCss(this: *const PlaceItems, comptime W: type, dest: *css.Printer(W)) css.PrintErr!void {
        try this.@"align".toCss(W, dest);
        const is_equal = switch (this.justify) {
            .normal => this.@"align".eql(&AlignItems{ .normal = {} }),
            .stretch => this.@"align".eql(&AlignItems{ .stretch = {} }),
            .baseline_position => |*p| brk: {
                if (this.@"align" == .baseline_position) break :brk p.eql(&this.@"align".baseline_position);
                break :brk false;
            },
            .self_position => |*p| brk: {
                if (this.@"align" == .self_position) break :brk p.toInner().eql(&this.@"align".self_position.toInner());
                break :brk false;
            },
            else => false,
        };

        if (!is_equal) {
            try dest.writeStr(" ");
            try this.justify.toCss(W, dest);
        }
    }

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }
};

/// A value for the [place-self](https://www.w3.org/TR/css-align-3/#place-self-property) shorthand property.
pub const PlaceSelf = struct {
    /// The item alignment.
    @"align": AlignSelf,
    /// The item justification.
    justify: JustifySelf,

    pub const PropertyFieldMap = .{
        .@"align" = "align-self",
        .justify = "justify-self",
    };

    pub const VendorPrefixMap = .{
        .@"align" = true,
    };

    pub fn parse(input: *css.Parser) css.Result(@This()) {
        const @"align" = switch (@call(.auto, @field(AlignSelf, "parse"), .{input})) {
            .result => |v| v,
            .err => |e| return .{ .err = e },
        };
        const justify = switch (input.tryParse(@field(JustifySelf, "parse"), .{})) {
            .result => |v| v,
            .err => switch (@"align") {
                .auto => JustifySelf.auto,
                .normal => JustifySelf.normal,
                .stretch => JustifySelf.stretch,
                .baseline_position => |p| JustifySelf{ .baseline_position = p },
                .self_position => |sp| JustifySelf{
                    .self_position = .{
                        .overflow = if (sp.overflow) |o| o else null,
                        .value = sp.value,
                    },
                },
            },
        };

        return .{ .result = .{ .@"align" = @"align", .justify = justify } };
    }

    pub fn toCss(this: *const PlaceSelf, comptime W: type, dest: *css.Printer(W)) css.PrintErr!void {
        try this.@"align".toCss(W, dest);
        const is_equal = switch (this.justify) {
            .auto => true,
            .normal => this.@"align" == .normal,
            .stretch => this.@"align" == .stretch,
            .baseline_position => |p| switch (this.@"align") {
                .baseline_position => |p2| p.eql(&p2),
                else => false,
            },
            .self_position => |sp| brk: {
                if (this.@"align" == .self_position) break :brk sp.toInner().eql(&this.@"align".self_position.toInner());
                break :brk false;
            },
            else => false,
        };

        if (!is_equal) {
            try dest.writeStr(" ");
            try this.justify.toCss(W, dest);
        }
    }

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }
};

/// A [`<self-position>`](https://www.w3.org/TR/css-align-3/#typedef-self-position) value.
pub const SelfPosition = enum {
    /// Item is centered within the container.
    center,
    /// Item is aligned to the start of the container.
    start,
    /// Item is aligned to the end of the container.
    end,
    /// Item is aligned to the edge of the container corresponding to the start side of the item.
    @"self-start",
    /// Item is aligned to the edge of the container corresponding to the end side of the item.
    @"self-end",
    /// Item  is aligned to the start of the container, within flexbox layouts.
    @"flex-start",
    /// Item  is aligned to the end of the container, within flexbox layouts.
    @"flex-end",

    const css_impl = css.DefineEnumProperty(@This());
    pub const eql = css_impl.eql;
    pub const hash = css_impl.hash;
    pub const parse = css_impl.parse;
    pub const toCss = css_impl.toCss;
    pub const deepClone = css_impl.deepClone;
};

/// A value for the [place-content](https://www.w3.org/TR/css-align-3/#place-content) shorthand property.
pub const PlaceContent = struct {
    /// The content alignment.
    @"align": AlignContent,
    /// The content justification.
    justify: JustifyContent,

    pub const PropertyFieldMap = .{
        .@"align" = css.PropertyIdTag.@"align-content",
        .justify = css.PropertyIdTag.@"justify-content",
    };

    pub const VendorPrefixMap = .{
        .@"align" = true,
        .justify = true,
    };

    pub fn parse(input: *css.Parser) css.Result(@This()) {
        const @"align" = switch (@call(.auto, @field(AlignContent, "parse"), .{input})) {
            .result => |v| v,
            .err => |e| return .{ .err = e },
        };
        const justify = switch (@call(.auto, @field(JustifyContent, "parse"), .{input})) {
            .result => |v| v,
            .err => |_| switch (@"align") {
                .baseline_position => JustifyContent{ .content_position = .{
                    .overflow = null,
                    .value = .start,
                } },
                .normal => JustifyContent.normal,
                .content_distribution => |value| JustifyContent{ .content_distribution = value },
                .content_position => |pos| JustifyContent{ .content_position = .{
                    .overflow = if (pos.overflow) |*overflow| overflow.deepClone(input.allocator()) else null,
                    .value = pos.value.deepClone(input.allocator()),
                } },
            },
        };

        return .{ .result = .{ .@"align" = @"align", .justify = justify } };
    }

    pub fn toCss(this: *const PlaceContent, comptime W: type, dest: *css.Printer(W)) css.PrintErr!void {
        try this.@"align".toCss(W, dest);
        const is_equal = switch (this.justify) {
            .normal => brk: {
                if (this.@"align" == .normal) break :brk true;
                break :brk false;
            },
            .content_distribution => |*d| brk: {
                if (this.@"align" == .content_distribution) break :brk d.eql(&this.@"align".content_distribution);
                break :brk false;
            },
            .content_position => |*p| brk: {
                if (this.@"align" == .content_position) break :brk p.toInner().eql(&this.@"align".content_position.toInner());
                break :brk false;
            },
            else => false,
        };

        if (!is_equal) {
            try dest.writeStr(" ");
            try this.justify.toCss(W, dest);
        }
    }

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }
};

/// A [`<content-distribution>`](https://www.w3.org/TR/css-align-3/#typedef-content-distribution) value.
pub const ContentDistribution = enum {
    /// Items are spaced evenly, with the first and last items against the edge of the container.
    @"space-between",
    /// Items are spaced evenly, with half-size spaces at the start and end.
    @"space-around",
    /// Items are spaced evenly, with full-size spaces at the start and end.
    @"space-evenly",
    /// Items are stretched evenly to fill free space.
    stretch,

    const css_impl = css.DefineEnumProperty(@This());
    pub const eql = css_impl.eql;
    pub const hash = css_impl.hash;
    pub const parse = css_impl.parse;
    pub const toCss = css_impl.toCss;
    pub const deepClone = css_impl.deepClone;
};

/// An [`<overflow-position>`](https://www.w3.org/TR/css-align-3/#typedef-overflow-position) value.
pub const OverflowPosition = enum {
    /// If the size of the alignment subject overflows the alignment container,
    /// the alignment subject is instead aligned as if the alignment mode were start.
    safe,
    /// Regardless of the relative sizes of the alignment subject and alignment
    /// container, the given alignment value is honored.
    unsafe,

    const css_impl = css.DefineEnumProperty(@This());
    pub const eql = css_impl.eql;
    pub const hash = css_impl.hash;
    pub const parse = css_impl.parse;
    pub const toCss = css_impl.toCss;
    pub const deepClone = css_impl.deepClone;
};

/// A [`<content-position>`](https://www.w3.org/TR/css-align-3/#typedef-content-position) value.
pub const ContentPosition = enum {
    /// Content is centered within the container.
    center,
    /// Content is aligned to the start of the container.
    start,
    /// Content is aligned to the end of the container.
    end,
    /// Same as `start` when within a flexbox container.
    @"flex-start",
    /// Same as `end` when within a flexbox container.
    @"flex-end",

    const css_impl = css.DefineEnumProperty(@This());
    pub const eql = css_impl.eql;
    pub const hash = css_impl.hash;
    pub const parse = css_impl.parse;
    pub const toCss = css_impl.toCss;
    pub const deepClone = css_impl.deepClone;
};

pub const SelfPositionInner = struct {
    /// An overflow alignment mode.
    overflow: ?OverflowPosition,
    /// A self position keyword.
    value: SelfPosition,

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }
};

pub const ContentPositionInner = struct {
    /// An overflow alignment mode.
    overflow: ?OverflowPosition,
    /// A content position keyword.
    value: ContentPosition,

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }
};

const FlexLinePack = css.css_properties.flex.FlexLinePack;
const BoxPack = css.css_properties.flex.BoxPack;
const FlexPack = css.css_properties.flex.FlexPack;
const BoxAlign = css.css_properties.flex.BoxAlign;
const FlexAlign = css.css_properties.flex.FlexAlign;
const FlexItemAlign = css.css_properties.flex.FlexItemAlign;

pub const AlignHandler = struct {
    align_content: ?struct { AlignContent, VendorPrefix } = null,
    flex_line_pack: ?struct { FlexLinePack, VendorPrefix } = null,
    justify_content: ?struct { JustifyContent, VendorPrefix } = null,
    box_pack: ?struct { BoxPack, VendorPrefix } = null,
    flex_pack: ?struct { FlexPack, VendorPrefix } = null,
    align_self: ?struct { AlignSelf, VendorPrefix } = null,
    flex_item_align: ?struct { FlexItemAlign, VendorPrefix } = null,
    justify_self: ?JustifySelf = null,
    align_items: ?struct { AlignItems, VendorPrefix } = null,
    box_align: ?struct { BoxAlign, VendorPrefix } = null,
    flex_align: ?struct { FlexAlign, VendorPrefix } = null,
    justify_items: ?JustifyItems = null,
    row_gap: ?GapValue = null,
    column_gap: ?GapValue = null,
    has_any: bool = false,

    pub fn handleProperty(this: *AlignHandler, property: *const Property, dest: *css.DeclarationList, context: *css.PropertyHandlerContext) bool {
        switch (property.*) {
            .@"align-content" => |*val| {
                this.flex_line_pack = null;
                this.handlePropertyHelper(dest, context, "align_content", &val.*[0], val.*[1]);
            },
            .@"flex-line-pack" => |*val| this.handlePropertyHelper(dest, context, "flex_line_pack", &val.*[0], val.*[1]),
            .@"justify-content" => |*val| {
                this.box_pack = null;
                this.flex_pack = null;
                this.handlePropertyHelper(dest, context, "justify_content", &val.*[0], val.*[1]);
            },
            .@"box-pack" => |*val| this.handlePropertyHelper(dest, context, "box_pack", &val.*[0], val.*[1]),
            .@"flex-pack" => |*val| this.handlePropertyHelper(dest, context, "flex_pack", &val.*[0], val.*[1]),
            .@"place-content" => |*val| {
                this.flex_line_pack = null;
                this.box_pack = null;
                this.flex_pack = null;
                this.handlePropertyMaybeFlush(dest, context, "align_content", &val.@"align", VendorPrefix.NONE);
                this.handlePropertyMaybeFlush(dest, context, "justify_content", &val.justify, VendorPrefix.NONE);
                this.handlePropertyHelper(dest, context, "align_content", &val.@"align", VendorPrefix.NONE);
                this.handlePropertyHelper(dest, context, "justify_content", &val.justify, VendorPrefix.NONE);
            },
            .@"align-self" => |*val| {
                this.flex_item_align = null;
                this.handlePropertyHelper(dest, context, "align_self", &val.*[0], val.*[1]);
            },
            .@"flex-item-align" => |*val| this.handlePropertyHelper(dest, context, "flex_item_align", &val.*[0], val.*[1]),
            .@"justify-self" => |*val| {
                this.justify_self = css.generic.deepClone(@TypeOf(val.*), val, context.allocator);
                this.has_any = true;
            },
            .@"place-self" => |*val| {
                this.flex_item_align = null;
                this.handlePropertyHelper(dest, context, "align_self", &val.@"align", VendorPrefix.NONE);
                this.justify_self = css.generic.deepClone(@TypeOf(val.justify), &val.justify, context.allocator);
            },
            .@"align-items" => |*val| {
                this.box_align = null;
                this.flex_align = null;
                this.handlePropertyHelper(dest, context, "align_items", &val.*[0], val.*[1]);
            },
            .@"box-align" => |*val| this.handlePropertyHelper(dest, context, "box_align", &val.*[0], val.*[1]),
            .@"flex-align" => |*val| this.handlePropertyHelper(dest, context, "flex_align", &val.*[0], val.*[1]),
            .@"justify-items" => |*val| {
                this.justify_items = css.generic.deepClone(@TypeOf(val.*), val, context.allocator);
                this.has_any = true;
            },
            .@"place-items" => |*val| {
                this.box_align = null;
                this.flex_align = null;
                this.handlePropertyHelper(dest, context, "align_items", &val.@"align", VendorPrefix.NONE);
                this.justify_items = css.generic.deepClone(@TypeOf(val.justify), &val.justify, context.allocator);
            },
            .@"row-gap" => |*val| {
                this.row_gap = css.generic.deepClone(@TypeOf(val.*), val, context.allocator);
                this.has_any = true;
            },
            .@"column-gap" => |*val| {
                this.column_gap = css.generic.deepClone(@TypeOf(val.*), val, context.allocator);
                this.has_any = true;
            },
            .gap => |*val| {
                this.row_gap = css.generic.deepClone(@TypeOf(val.row), &val.row, context.allocator);
                this.column_gap = css.generic.deepClone(@TypeOf(val.column), &val.column, context.allocator);
                this.has_any = true;
            },
            .unparsed => |*val| {
                if (isAlignProperty(val.property_id)) {
                    this.flush(dest, context);
                    dest.append(context.allocator, property.*) catch bun.outOfMemory();
                } else {
                    return false;
                }
            },
            else => return false,
        }

        return true;
    }

    pub fn finalize(this: *AlignHandler, dest: *css.DeclarationList, context: *css.PropertyHandlerContext) void {
        this.flush(dest, context);
    }

    fn flush(this: *AlignHandler, dest: *css.DeclarationList, context: *css.PropertyHandlerContext) void {
        if (!this.has_any) {
            return;
        }

        this.has_any = false;

        var align_content = bun.take(&this.align_content);
        var justify_content = bun.take(&this.justify_content);
        var align_self = bun.take(&this.align_self);
        var justify_self = bun.take(&this.justify_self);
        var align_items = bun.take(&this.align_items);
        var justify_items = bun.take(&this.justify_items);
        const row_gap = bun.take(&this.row_gap);
        const column_gap = bun.take(&this.column_gap);
        var box_align = bun.take(&this.box_align);
        var box_pack = bun.take(&this.box_pack);
        var flex_line_pack = bun.take(&this.flex_line_pack);
        var flex_pack = bun.take(&this.flex_pack);
        var flex_align = bun.take(&this.flex_align);
        var flex_item_align = bun.take(&this.flex_item_align);

        // 2009 properties
        this.flushPrefixedProperty(dest, context, "box-align", bun.take(&box_align));
        this.flushPrefixedProperty(dest, context, "box-pack", bun.take(&box_pack));

        // 2012 properties
        this.flushPrefixedProperty(dest, context, "flex-pack", bun.take(&flex_pack));
        this.flushPrefixedProperty(dest, context, "flex-align", bun.take(&flex_align));
        this.flushPrefixedProperty(dest, context, "flex-item-align", bun.take(&flex_item_align));
        this.flushPrefixedProperty(dest, context, "flex-line-pack", bun.take(&flex_line_pack));

        this.flushLegacyProperty(dest, context, Feature.align_content, &align_content, null, .{ FlexLinePack, "flex-line-pack" });
        this.flushLegacyProperty(dest, context, Feature.justify_content, &justify_content, .{ BoxPack, "box-pack" }, .{ FlexPack, "flex-pack" });
        if (context.targets.isCompatible(.place_content)) {
            this.flushShorthandHelper(
                dest,
                context,
                .{ .prop = "place-content", .ty = PlaceContent },
                .{ .feature = Feature.align_content, .prop = "align-content" },
                &align_content,
                &justify_content,
                .{ .feature = Feature.justify_content, .prop = "justify-content" },
            );
        }
        this.flushStandardPropertyHelper(dest, context, "align-content", bun.take(&align_content), Feature.align_content);
        this.flushStandardPropertyHelper(dest, context, "justify-content", bun.take(&justify_content), Feature.justify_content);

        this.flushLegacyProperty(dest, context, Feature.align_self, &align_self, null, .{ FlexItemAlign, "flex-item-align" });
        if (context.targets.isCompatible(.place_self)) {
            this.flushShorthandHelper(dest, context, .{ .prop = "place-self", .ty = PlaceSelf }, .{ .feature = Feature.align_self, .prop = "align-self" }, &align_self, &justify_self, null);
        }
        this.flushStandardPropertyHelper(dest, context, "align-self", bun.take(&align_self), Feature.align_self);
        this.flushUnprefixProperty(dest, context, "justify-self", bun.take(&justify_self));

        this.flushLegacyProperty(dest, context, Feature.align_items, &align_items, .{ BoxAlign, "box-align" }, .{ FlexAlign, "flex-align" });
        if (context.targets.isCompatible(css.compat.Feature.place_items)) {
            this.flushShorthandHelper(dest, context, .{ .prop = "place-items", .ty = PlaceItems }, .{ .feature = Feature.align_items, .prop = "align-items" }, &align_items, &justify_items, null);
        }
        this.flushStandardPropertyHelper(dest, context, "align-items", bun.take(&align_items), Feature.align_items);
        this.flushUnprefixProperty(dest, context, "justify-items", bun.take(&justify_items));

        if (row_gap != null and column_gap != null) {
            dest.append(context.allocator, Property{ .gap = Gap{
                .row = row_gap.?,
                .column = column_gap.?,
            } }) catch bun.outOfMemory();
        } else {
            if (row_gap != null) {
                dest.append(context.allocator, Property{ .@"row-gap" = row_gap.? }) catch bun.outOfMemory();
            }

            if (column_gap != null) {
                dest.append(context.allocator, Property{ .@"column-gap" = column_gap.? }) catch bun.outOfMemory();
            }
        }
    }

    fn handlePropertyMaybeFlush(this: *AlignHandler, dest: *css.DeclarationList, context: *css.PropertyHandlerContext, comptime prop: []const u8, val: anytype, vp: VendorPrefix) void {
        // If two vendor prefixes for the same property have different
        // values, we need to flush what we have immediately to preserve order.
        if (@field(this, prop)) |*v| {
            if (!val.eql(&v[0]) and !bun.bits.contains(VendorPrefix, v[1], vp)) {
                this.flush(dest, context);
            }
        }
    }

    fn handlePropertyHelper(this: *AlignHandler, dest: *css.DeclarationList, context: *css.PropertyHandlerContext, comptime prop: []const u8, val: anytype, vp: VendorPrefix) void {
        this.handlePropertyMaybeFlush(dest, context, prop, val, vp);
        // Otherwise, update the value and add the prefix.
        if (@field(this, prop)) |*tuple| {
            tuple.*[0] = css.generic.deepClone(@TypeOf(val.*), val, context.allocator);
            bun.bits.insert(VendorPrefix, &tuple.*[1], vp);
        } else {
            @field(this, prop) = .{ css.generic.deepClone(@TypeOf(val.*), val, context.allocator), vp };
            this.has_any = true;
        }
    }

    // Gets prefixes for standard properties.
    fn flushPrefixesHelper(_: *AlignHandler, context: *css.PropertyHandlerContext, comptime feature: Feature) VendorPrefix {
        var prefix = context.targets.prefixes(VendorPrefix.NONE, feature);
        // Firefox only implemented the 2009 spec prefixed.
        // Microsoft only implemented the 2012 spec prefixed.
        prefix.moz = false;
        prefix.ms = false;
        return prefix;
    }

    fn flushStandardPropertyHelper(this: *AlignHandler, dest: *css.DeclarationList, context: *css.PropertyHandlerContext, comptime prop: []const u8, key: anytype, comptime feature: Feature) void {
        if (key) |v| {
            const val = v[0];
            var prefix = v[1];
            // If we have an unprefixed property, override necessary prefixes.
            prefix = if (prefix.none) flushPrefixesHelper(this, context, feature) else prefix;
            dest.append(context.allocator, @unionInit(Property, prop, .{ val, prefix })) catch bun.outOfMemory();
        }
    }

    fn flushLegacyProperty(
        this: *AlignHandler,
        dest: *css.DeclarationList,
        context: *css.PropertyHandlerContext,
        comptime feature: Feature,
        key: anytype,
        comptime prop_2009: ?struct { type, []const u8 },
        comptime prop_2012: ?struct { type, []const u8 },
    ) void {
        _ = this; // autofix
        if (key.*) |v| {
            const val = v[0];
            var prefix = v[1];
            // If we have an unprefixed standard property, generate legacy prefixed versions.
            prefix = context.targets.prefixes(prefix, feature);

            if (prefix.none) {
                if (comptime prop_2009) |p2009| {
                    // 2009 spec, implemented by webkit and firefox.
                    if (context.targets.browsers) |targets| {
                        var prefixes_2009 = VendorPrefix{};
                        if (Feature.isFlex2009(targets)) {
                            prefixes_2009.webkit = true;
                        }
                        if (prefix.moz) {
                            prefixes_2009.moz = true;
                        }
                        if (!prefixes_2009.isEmpty()) {
                            const s = brk: {
                                const T = comptime p2009[0];
                                if (comptime T == css.css_properties.flex.BoxOrdinalGroup) break :brk @as(?i32, val);
                                break :brk p2009[0].fromStandard(&val);
                            };
                            if (s) |a| {
                                dest.append(context.allocator, @unionInit(Property, p2009[1], .{
                                    a,
                                    prefixes_2009,
                                })) catch bun.outOfMemory();
                            }
                        }
                    }
                }
            }

            // 2012 spec, implemented by microsoft.
            if (prefix.ms) {
                if (comptime prop_2012) |p2012| {
                    const s = brk: {
                        const T = comptime p2012[0];
                        if (comptime T == css.css_properties.flex.BoxOrdinalGroup) break :brk @as(?i32, val);
                        break :brk p2012[0].fromStandard(&val);
                    };
                    if (s) |q| {
                        dest.append(context.allocator, @unionInit(Property, p2012[1], .{
                            q,
                            VendorPrefix.MS,
                        })) catch bun.outOfMemory();
                    }
                }
            }

            // Remove Firefox and IE from standard prefixes.
            prefix.moz = false;
            prefix.ms = false;
        }
    }

    fn flushPrefixedProperty(this: *AlignHandler, dest: *css.DeclarationList, context: *css.PropertyHandlerContext, comptime prop: []const u8, key: anytype) void {
        _ = this; // autofix
        if (key) |v| {
            const val = v[0];
            const prefix = v[1];
            dest.append(context.allocator, @unionInit(Property, prop, .{ val, prefix })) catch bun.outOfMemory();
        }
    }

    fn flushUnprefixProperty(this: *AlignHandler, dest: *css.DeclarationList, context: *css.PropertyHandlerContext, comptime prop: []const u8, key: anytype) void {
        _ = this; // autofix
        if (key) |v| {
            const val = v;
            dest.append(context.allocator, @unionInit(Property, prop, val)) catch bun.outOfMemory();
        }
    }

    fn flushShorthandHelper(
        this: *AlignHandler,
        dest: *css.DeclarationList,
        context: *css.PropertyHandlerContext,
        comptime prop: struct { prop: []const u8, ty: type },
        comptime align_prop: struct {
            feature: Feature,
            prop: []const u8,
        },
        align_val: anytype,
        justify_val: anytype,
        comptime justify_prop: ?struct {
            feature: Feature,
            prop: []const u8,
        },
    ) void {
        // Only use shorthand if both align and justify are present
        if (align_val.*) |*__v1| {
            const @"align" = &__v1.*[0];
            const align_prefix: *css.VendorPrefix = &__v1.*[1];
            if (justify_val.*) |*__v2| {
                const justify = __v2;

                const intersection = align_prefix.bitwiseAnd(if (comptime justify_prop != null) __v2.*[1] else align_prefix.*);
                // Only use shorthand if unprefixed.
                if (intersection.none) {
                    // Add prefixed longhands if needed.
                    align_prefix.* = flushPrefixesHelper(this, context, align_prop.feature);
                    align_prefix.none = false;
                    if (!align_prefix.isEmpty()) {
                        dest.append(
                            context.allocator,
                            @unionInit(Property, align_prop.prop, .{ css.generic.deepClone(@TypeOf(@"align".*), @"align", context.allocator), align_prefix.* }),
                        ) catch bun.outOfMemory();
                    }

                    if (comptime justify_prop != null) {
                        const justify_actual = &__v2.*[0];
                        const justify_prefix = &__v2.*[1];
                        justify_prefix.* = this.flushPrefixesHelper(context, justify_prop.?.feature);
                        justify_prefix.none = false;

                        if (!justify_prefix.isEmpty()) {
                            dest.append(
                                context.allocator,
                                @unionInit(Property, justify_prop.?.prop, .{ css.generic.deepClone(@TypeOf(justify_actual.*), justify_actual, context.allocator), justify_prefix.* }),
                            ) catch bun.outOfMemory();
                        }

                        // Add shorthand.
                        dest.append(
                            context.allocator,
                            @unionInit(Property, prop.prop, prop.ty{
                                .@"align" = css.generic.deepClone(@TypeOf(@"align".*), @"align", context.allocator),
                                .justify = css.generic.deepClone(@TypeOf(justify_actual.*), justify_actual, context.allocator),
                            }),
                        ) catch bun.outOfMemory();
                    } else {

                        // Add shorthand.
                        dest.append(
                            context.allocator,
                            @unionInit(Property, prop.prop, prop.ty{
                                .@"align" = css.generic.deepClone(@TypeOf(@"align".*), @"align", context.allocator),
                                .justify = css.generic.deepClone(@TypeOf(justify.*), justify, context.allocator),
                            }),
                        ) catch bun.outOfMemory();
                    }

                    align_val.* = null;
                    justify_val.* = null;
                }
            }
        }
    }
};

fn isAlignProperty(property_id: css.PropertyId) bool {
    return switch (property_id) {
        .@"align-content",
        .@"flex-line-pack",
        .@"justify-content",
        .@"box-pack",
        .@"flex-pack",
        .@"place-content",
        .@"align-self",
        .@"flex-item-align",
        .@"justify-self",
        .@"place-self",
        .@"align-items",
        .@"box-align",
        .@"flex-align",
        .@"justify-items",
        .@"place-items",
        .@"row-gap",
        .@"column-gap",
        .gap,
        => true,
        else => false,
    };
}
