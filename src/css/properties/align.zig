const std = @import("std");
const bun = @import("root").bun;
const Allocator = std.mem.Allocator;
const ArrayList = std.ArrayListUnmanaged;

pub const css = @import("../css_parser.zig");

const Printer = css.Printer;
const PrintErr = css.PrintErr;

const LengthPercentage = css.css_values.length.LengthPercentage;

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
            const overflow = OverflowPosition.parse(input).asValue();
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

    pub usingnamespace css.DeriveParse(@This());
    pub usingnamespace css.DeriveToCss(@This());

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
        if (input.expectIdentMatching("normal").isOk()) {
            return .{ .result = .normal };
        }

        if (ContentDistribution.parse(input).asValue()) |val| {
            return .{ .result = .{ .content_distribution = val } };
        }

        const overflow = OverflowPosition.parse(input).asValue();
        if (ContentPosition.parse(input).asValue()) |content_position| {
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
            const overflow = OverflowPosition.parse(input).asValue();
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

    pub usingnamespace css.DeriveParse(@This());
    pub usingnamespace css.DeriveToCss(@This());

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
            const overflow = OverflowPosition.parse(input).asValue();
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

    pub usingnamespace css.DeriveParse(@This());
    pub usingnamespace css.DeriveToCss(@This());

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

    pub usingnamespace css.DeriveParse(@This());
    pub usingnamespace css.DeriveToCss(@This());

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

    pub usingnamespace css.DefineShorthand(@This(), css.PropertyIdTag.gap);

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

    pub usingnamespace css.DefineShorthand(@This(), css.PropertyIdTag.@"place-items");

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

    pub usingnamespace css.DefineShorthand(@This(), css.PropertyIdTag.@"place-self");

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

    pub usingnamespace css.DefineEnumProperty(@This());
};

/// A value for the [place-content](https://www.w3.org/TR/css-align-3/#place-content) shorthand property.
pub const PlaceContent = struct {
    /// The content alignment.
    @"align": AlignContent,
    /// The content justification.
    justify: JustifyContent,

    pub usingnamespace css.DefineShorthand(@This(), css.PropertyIdTag.@"place-content");

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

    pub usingnamespace css.DefineEnumProperty(@This());
};

/// An [`<overflow-position>`](https://www.w3.org/TR/css-align-3/#typedef-overflow-position) value.
pub const OverflowPosition = enum {
    /// If the size of the alignment subject overflows the alignment container,
    /// the alignment subject is instead aligned as if the alignment mode were start.
    safe,
    /// Regardless of the relative sizes of the alignment subject and alignment
    /// container, the given alignment value is honored.
    unsafe,

    pub usingnamespace css.DefineEnumProperty(@This());
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

    pub usingnamespace css.DefineEnumProperty(@This());
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
