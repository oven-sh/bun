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
const Percentage = css.css_values.percentage.Percentage;

/// A CSS `<position>` value,
/// as used in the `background-position` property, gradients, masks, etc.
pub const Position = struct {
    /// The x-position.
    x: HorizontalPosition,
    /// The y-position.
    y: VerticalPosition,

    pub fn parse(input: *css.Parser) Result(Position) {
        // Try parsing a horizontal position first
        if (input.tryParse(HorizontalPosition.parse, .{}).asValue()) |horizontal_pos| {
            switch (horizontal_pos) {
                .center => {
                    // Try parsing a vertical position next
                    if (input.tryParse(VerticalPosition.parse, .{}).asValue()) |y| {
                        return .{ .result = Position{
                            .x = .center,
                            .y = y,
                        } };
                    }

                    // If it didn't work, assume the first actually represents a y position,
                    // and the next is an x position. e.g. `center left` rather than `left center`.
                    const x = input.tryParse(HorizontalPosition.parse, .{}).unwrapOr(HorizontalPosition.center);
                    const y = VerticalPosition.center;
                    return .{ .result = Position{ .x = x, .y = y } };
                },
                .length => |*x| {
                    // If we got a length as the first component, then the second must
                    // be a keyword or length (not a side offset).
                    if (input.tryParse(VerticalPositionKeyword.parse, .{}).asValue()) |y_keyword| {
                        const y = VerticalPosition{ .side = .{
                            .side = y_keyword,
                            .offset = null,
                        } };
                        return .{ .result = Position{ .x = .{ .length = x.* }, .y = y } };
                    }
                    if (input.tryParse(LengthPercentage.parse, .{}).asValue()) |y_lp| {
                        const y = VerticalPosition{ .length = y_lp };
                        return .{ .result = Position{ .x = .{ .length = x.* }, .y = y } };
                    }
                    const y = VerticalPosition.center;
                    _ = input.tryParse(css.Parser.expectIdentMatching, .{"center"});
                    return .{ .result = Position{ .x = .{ .length = x.* }, .y = y } };
                },
                .side => |*side| {
                    const x_keyword = side.side;
                    const lp = side.offset;

                    // If we got a horizontal side keyword (and optional offset), expect another for the vertical side.
                    // e.g. `left center` or `left 20px center`
                    if (input.tryParse(css.Parser.expectIdentMatching, .{"center"}).isOk()) {
                        const x = HorizontalPosition{ .side = .{
                            .side = x_keyword,
                            .offset = lp,
                        } };
                        const y = VerticalPosition.center;
                        return .{ .result = Position{ .x = x, .y = y } };
                    }

                    // e.g. `left top`, `left top 20px`, `left 20px top`, or `left 20px top 20px`
                    if (input.tryParse(VerticalPositionKeyword.parse, .{}).asValue()) |y_keyword| {
                        const y_lp = switch (input.tryParse(LengthPercentage.parse, .{})) {
                            .result => |vv| vv,
                            .err => null,
                        };
                        const x = HorizontalPosition{ .side = .{
                            .side = x_keyword,
                            .offset = lp,
                        } };
                        const y = VerticalPosition{ .side = .{
                            .side = y_keyword,
                            .offset = y_lp,
                        } };
                        return .{ .result = Position{ .x = x, .y = y } };
                    }

                    // If we didn't get a vertical side keyword (e.g. `left 20px`), then apply the offset to the vertical side.
                    const x = HorizontalPosition{ .side = .{
                        .side = x_keyword,
                        .offset = null,
                    } };
                    const y = if (lp) |lp_val|
                        VerticalPosition{ .length = lp_val }
                    else
                        VerticalPosition.center;
                    return .{ .result = Position{ .x = x, .y = y } };
                },
            }
        }

        // If the horizontal position didn't parse, then it must be out of order. Try vertical position keyword.
        const y_keyword = switch (VerticalPositionKeyword.parse(input)) {
            .result => |vv| vv,
            .err => |e| return .{ .err = e },
        };
        const lp_and_x_pos = input.tryParse(struct {
            fn parse(i: *css.Parser) Result(struct { ?LengthPercentage, HorizontalPosition }) {
                const y_lp = i.tryParse(LengthPercentage.parse, .{}).asValue();
                if (i.tryParse(HorizontalPositionKeyword.parse, .{}).asValue()) |x_keyword| {
                    const x_lp = i.tryParse(LengthPercentage.parse, .{}).asValue();
                    const x_pos = HorizontalPosition{ .side = .{
                        .side = x_keyword,
                        .offset = x_lp,
                    } };
                    return .{ .result = .{ y_lp, x_pos } };
                }
                if (i.expectIdentMatching("center").asErr()) |e| return .{ .err = e };
                const x_pos = HorizontalPosition.center;
                return .{ .result = .{ y_lp, x_pos } };
            }
        }.parse, .{});

        if (lp_and_x_pos.asValue()) |tuple| {
            const y_lp = tuple[0];
            const x = tuple[1];
            const y = VerticalPosition{ .side = .{
                .side = y_keyword,
                .offset = y_lp,
            } };
            return .{ .result = Position{ .x = x, .y = y } };
        }

        const x = HorizontalPosition.center;
        const y = VerticalPosition{ .side = .{
            .side = y_keyword,
            .offset = null,
        } };
        return .{ .result = Position{ .x = x, .y = y } };
    }

    pub fn toCss(this: *const Position, comptime W: type, dest: *css.Printer(W)) css.PrintErr!void {
        if (this.x == .side and this.y == .length and this.x.side.side != .left) {
            try this.x.toCss(W, dest);
            try dest.writeStr(" top ");
            try this.y.length.toCss(W, dest);
        } else if (this.x == .side and this.x.side.side != .left and this.y.isCenter()) {
            // If there is a side keyword with an offset, "center" must be a keyword not a percentage.
            try this.x.toCss(W, dest);
            try dest.writeStr(" center");
        } else if (this.x == .length and this.y == .side and this.y.side.side != .top) {
            try dest.writeStr("left ");
            try this.x.length.toCss(W, dest);
            try dest.writeStr(" ");
            try this.y.toCss(W, dest);
        } else if (this.x.isCenter() and this.y.isCenter()) {
            // `center center` => 50%
            try this.x.toCss(W, dest);
        } else if (this.x == .length and this.y.isCenter()) {
            // `center` is assumed if omitted.
            try this.x.length.toCss(W, dest);
        } else if (this.x == .side and this.x.side.offset == null and this.y.isCenter()) {
            const p: LengthPercentage = this.x.side.side.intoLengthPercentage();
            try p.toCss(W, dest);
        } else if (this.y == .side and this.y.side.offset == null and this.x.isCenter()) {
            try this.y.toCss(W, dest);
        } else if (this.x == .side and this.x.side.offset == null and this.y == .side and this.y.side.offset == null) {
            const x: LengthPercentage = this.x.side.side.intoLengthPercentage();
            const y: LengthPercentage = this.y.side.side.intoLengthPercentage();
            try x.toCss(W, dest);
            try dest.writeStr(" ");
            try y.toCss(W, dest);
        } else {
            const zero = LengthPercentage.zero();
            const fifty = LengthPercentage{ .percentage = .{ .v = 0.5 } };
            const x_len: ?*const LengthPercentage = x_len: {
                switch (this.x) {
                    .side => |side| {
                        if (side.side == .left) {
                            if (side.offset) |*offset| {
                                if (offset.isZero()) {
                                    break :x_len &zero;
                                } else {
                                    break :x_len offset;
                                }
                            } else {
                                break :x_len &zero;
                            }
                        }
                    },
                    .length => |len| {
                        if (len.isZero()) {
                            break :x_len &zero;
                        }
                    },
                    .center => break :x_len &fifty,
                }
                break :x_len null;
            };

            const y_len: ?*const LengthPercentage = y_len: {
                switch (this.y) {
                    .side => |side| {
                        if (side.side == .top) {
                            if (side.offset) |*offset| {
                                if (offset.isZero()) {
                                    break :y_len &zero;
                                } else {
                                    break :y_len offset;
                                }
                            } else {
                                break :y_len &zero;
                            }
                        }
                    },
                    .length => |len| {
                        if (len.isZero()) {
                            break :y_len &zero;
                        }
                    },
                    .center => break :y_len &fifty,
                }
                break :y_len null;
            };

            if (x_len != null and y_len != null) {
                try x_len.?.toCss(W, dest);
                try dest.writeStr(" ");
                try y_len.?.toCss(W, dest);
            } else {
                try this.x.toCss(W, dest);
                try dest.writeStr(" ");
                try this.y.toCss(W, dest);
            }
        }
    }

    pub fn default() @This() {
        return .{
            .x = HorizontalPosition{ .length = LengthPercentage{ .percentage = .{ .v = 0.0 } } },
            .y = VerticalPosition{ .length = LengthPercentage{ .percentage = .{ .v = 0.0 } } },
        };
    }

    /// Returns whether both the x and y positions are centered.
    pub fn isCenter(this: *const @This()) bool {
        return this.x.isCenter() and this.y.isCenter();
    }

    pub fn center() Position {
        return .{ .x = .center, .y = .center };
    }

    pub fn eql(this: *const Position, other: *const Position) bool {
        return this.x.eql(&other.x) and this.y.eql(&other.y);
    }

    pub fn isZero(this: *const Position) bool {
        return this.x.isZero() and this.y.isZero();
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }
};

pub fn PositionComponent(comptime S: type) type {
    return union(enum) {
        /// The `center` keyword.
        center,
        /// A length or percentage from the top-left corner of the box.
        length: LengthPercentage,
        /// A side keyword with an optional offset.
        side: struct {
            /// A side keyword.
            side: S,
            /// Offset from the side.
            offset: ?LengthPercentage,

            pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
                return css.implementDeepClone(@This(), this, allocator);
            }
        },

        const This = @This();

        pub fn isZero(this: *const This) bool {
            if (this.* == .length and this.length.isZero()) return true;
            return false;
        }

        pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
            return css.implementDeepClone(@This(), this, allocator);
        }

        pub fn eql(this: *const This, other: *const This) bool {
            return switch (this.*) {
                .center => switch (other.*) {
                    .center => true,
                    else => false,
                },
                .length => |*a| switch (other.*) {
                    .length => a.eql(&other.length),
                    else => false,
                },
                .side => |*a| switch (other.*) {
                    .side => a.side.eql(&other.side.side) and css.generic.eql(?LengthPercentage, &a.offset, &other.side.offset),
                    else => false,
                },
            };
        }

        pub fn parse(input: *css.Parser) Result(This) {
            if (input.tryParse(
                struct {
                    fn parse(i: *css.Parser) Result(void) {
                        return i.expectIdentMatching("center");
                    }
                }.parse,
                .{},
            ).isOk()) {
                return .{ .result = .center };
            }

            if (input.tryParse(LengthPercentage.parse, .{}).asValue()) |lp| {
                return .{ .result = .{ .length = lp } };
            }

            const side = switch (S.parse(input)) {
                .result => |vv| vv,
                .err => |e| return .{ .err = e },
            };
            const offset = input.tryParse(LengthPercentage.parse, .{}).asValue();
            return .{ .result = .{ .side = .{ .side = side, .offset = offset } } };
        }

        pub fn toCss(this: *const @This(), comptime W: type, dest: *css.Printer(W)) css.PrintErr!void {
            switch (this.*) {
                .center => {
                    if (dest.minify) {
                        try dest.writeStr("50%");
                    } else {
                        try dest.writeStr("center");
                    }
                },
                .length => |*lp| try lp.toCss(W, dest),
                .side => |*s| {
                    try s.side.toCss(W, dest);
                    if (s.offset) |lp| {
                        try dest.writeStr(" ");
                        try lp.toCss(W, dest);
                    }
                },
            }
        }

        pub fn isCenter(this: *const This) bool {
            switch (this.*) {
                .center => return true,
                .length => |*l| {
                    if (l.* == .percentage) return l.percentage.v == 0.5;
                },
                else => {},
            }
            return false;
        }
    };
}

pub const HorizontalPositionKeyword = enum {
    /// The `left` keyword.
    left,
    /// The `right` keyword.
    right,

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) HorizontalPositionKeyword {
        return css.implementDeepClone(@This(), this, allocator);
    }

    pub fn eql(this: *const HorizontalPositionKeyword, other: *const HorizontalPositionKeyword) bool {
        return this.* == other.*;
    }

    pub fn asStr(this: *const @This()) []const u8 {
        return css.enum_property_util.asStr(@This(), this);
    }

    pub fn parse(input: *css.Parser) Result(@This()) {
        return css.enum_property_util.parse(@This(), input);
    }

    pub fn toCss(this: *const @This(), comptime W: type, dest: *Printer(W)) PrintErr!void {
        return css.enum_property_util.toCss(@This(), this, W, dest);
    }

    pub fn intoLengthPercentage(this: *const @This()) LengthPercentage {
        return switch (this.*) {
            .left => LengthPercentage.zero(),
            .right => .{ .percentage = .{ .v = 1.0 } },
        };
    }
};

pub const VerticalPositionKeyword = enum {
    /// The `top` keyword.
    top,
    /// The `bottom` keyword.
    bottom,

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }

    pub fn eql(this: *const VerticalPositionKeyword, other: *const VerticalPositionKeyword) bool {
        return this.* == other.*;
    }

    pub fn asStr(this: *const @This()) []const u8 {
        return css.enum_property_util.asStr(@This(), this);
    }

    pub fn parse(input: *css.Parser) Result(@This()) {
        return css.enum_property_util.parse(@This(), input);
    }

    pub fn toCss(this: *const @This(), comptime W: type, dest: *Printer(W)) PrintErr!void {
        return css.enum_property_util.toCss(@This(), this, W, dest);
    }

    pub fn intoLengthPercentage(this: *const @This()) LengthPercentage {
        return switch (this.*) {
            .top => LengthPercentage.zero(),
            .bottom => LengthPercentage{ .percentage = Percentage{ .v = 1.0 } },
        };
    }
};

pub const HorizontalPosition = PositionComponent(HorizontalPositionKeyword);
pub const VerticalPosition = PositionComponent(VerticalPositionKeyword);
