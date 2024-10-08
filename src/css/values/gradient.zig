const std = @import("std");
const Allocator = std.mem.Allocator;
const bun = @import("root").bun;
const ArrayList = std.ArrayListUnmanaged;
pub const css = @import("../css_parser.zig");
const Result = css.Result;
const VendorPrefix = css.VendorPrefix;
const Printer = css.Printer;
const PrintErr = css.PrintErr;
const CssColor = css.css_values.color.CssColor;
const CSSNumber = css.css_values.number.CSSNumber;
const CSSNumberFns = css.css_values.number.CSSNumberFns;
const Url = css.css_values.url.Url;
const Angle = css.css_values.angle.Angle;
const AnglePercentage = css.css_values.angle.AnglePercentage;
const HorizontalPositionKeyword = css.css_values.position.HorizontalPositionKeyword;
const VerticalPositionKeyword = css.css_values.position.VerticalPositionKeyword;
const Position = css.css_values.position.Position;
const Length = css.css_values.length.Length;
const LengthPercentage = css.css_values.length.LengthPercentage;
const NumberOrPercentage = css.css_values.percentage.NumberOrPercentage;

/// A CSS [`<gradient>`](https://www.w3.org/TR/css-images-3/#gradients) value.
pub const Gradient = union(enum) {
    /// A `linear-gradient()`, and its vendor prefix.
    linear: LinearGradient,
    /// A `repeating-linear-gradient()`, and its vendor prefix.
    repeating_linear: LinearGradient,
    /// A `radial-gradient()`, and its vendor prefix.
    radial: RadialGradient,
    /// A `repeating-radial-gradient`, and its vendor prefix.
    repeating_radial: RadialGradient,
    /// A `conic-gradient()`.
    conic: ConicGradient,
    /// A `repeating-conic-gradient()`.
    repeating_conic: ConicGradient,
    /// A legacy `-webkit-gradient()`.
    @"webkit-gradient": WebKitGradient,

    pub fn parse(input: *css.Parser) Result(Gradient) {
        const location = input.currentSourceLocation();
        const func = switch (input.expectFunction()) {
            .result => |vv| vv,
            .err => |e| return .{ .err = e },
        };
        const Closure = struct { location: css.SourceLocation, func: []const u8 };
        return input.parseNestedBlock(Gradient, Closure{ .location = location, .func = func }, struct {
            fn parse(
                closure: Closure,
                input_: *css.Parser,
            ) Result(Gradient) {
                // css.todo_stuff.match_ignore_ascii_case
                if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(closure.func, "linear-gradient")) {
                    return .{ .result = .{ .linear = switch (LinearGradient.parse(input_, css.VendorPrefix{ .none = true })) {
                        .result => |vv| vv,
                        .err => |e| return .{ .err = e },
                    } } };
                } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(closure.func, "repeating-linear-gradient")) {
                    return .{ .result = .{ .repeating_linear = switch (LinearGradient.parse(input_, css.VendorPrefix{ .none = true })) {
                        .result => |vv| vv,
                        .err => |e| return .{ .err = e },
                    } } };
                } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(closure.func, "radial-gradient")) {
                    return .{ .result = .{ .radial = switch (RadialGradient.parse(input_, css.VendorPrefix{ .none = true })) {
                        .result => |vv| vv,
                        .err => |e| return .{ .err = e },
                    } } };
                } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(closure.func, "repeating-radial-gradient")) {
                    return .{ .result = .{ .repeating_radial = switch (RadialGradient.parse(input_, css.VendorPrefix{ .none = true })) {
                        .result => |vv| vv,
                        .err => |e| return .{ .err = e },
                    } } };
                } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(closure.func, "conic-gradient")) {
                    return .{ .result = .{ .conic = switch (ConicGradient.parse(input_)) {
                        .result => |vv| vv,
                        .err => |e| return .{ .err = e },
                    } } };
                } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(closure.func, "repeating-conic-gradient")) {
                    return .{ .result = .{ .repeating_conic = switch (ConicGradient.parse(input_)) {
                        .result => |vv| vv,
                        .err => |e| return .{ .err = e },
                    } } };
                } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(closure.func, "-webkit-linear-gradient")) {
                    return .{ .result = .{ .linear = switch (LinearGradient.parse(input_, css.VendorPrefix{ .webkit = true })) {
                        .result => |vv| vv,
                        .err => |e| return .{ .err = e },
                    } } };
                } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(closure.func, "-webkit-repeating-linear-gradient")) {
                    return .{ .result = .{ .repeating_linear = switch (LinearGradient.parse(input_, css.VendorPrefix{ .webkit = true })) {
                        .result => |vv| vv,
                        .err => |e| return .{ .err = e },
                    } } };
                } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(closure.func, "-webkit-radial-gradient")) {
                    return .{ .result = .{ .radial = switch (RadialGradient.parse(input_, css.VendorPrefix{ .webkit = true })) {
                        .result => |vv| vv,
                        .err => |e| return .{ .err = e },
                    } } };
                } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(closure.func, "-webkit-repeating-radial-gradient")) {
                    return .{ .result = .{ .repeating_radial = switch (RadialGradient.parse(input_, css.VendorPrefix{ .webkit = true })) {
                        .result => |vv| vv,
                        .err => |e| return .{ .err = e },
                    } } };
                } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(closure.func, "-moz-linear-gradient")) {
                    return .{ .result = .{ .linear = switch (LinearGradient.parse(input_, css.VendorPrefix{ .moz = true })) {
                        .result => |vv| vv,
                        .err => |e| return .{ .err = e },
                    } } };
                } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(closure.func, "-moz-repeating-linear-gradient")) {
                    return .{ .result = .{ .repeating_linear = switch (LinearGradient.parse(input_, css.VendorPrefix{ .moz = true })) {
                        .result => |vv| vv,
                        .err => |e| return .{ .err = e },
                    } } };
                } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(closure.func, "-moz-radial-gradient")) {
                    return .{ .result = .{ .radial = switch (RadialGradient.parse(input_, css.VendorPrefix{ .moz = true })) {
                        .result => |vv| vv,
                        .err => |e| return .{ .err = e },
                    } } };
                } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(closure.func, "-moz-repeating-radial-gradient")) {
                    return .{ .result = .{ .repeating_radial = switch (RadialGradient.parse(input_, css.VendorPrefix{ .moz = true })) {
                        .result => |vv| vv,
                        .err => |e| return .{ .err = e },
                    } } };
                } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(closure.func, "-o-linear-gradient")) {
                    return .{ .result = .{ .linear = switch (LinearGradient.parse(input_, css.VendorPrefix{ .o = true })) {
                        .result => |vv| vv,
                        .err => |e| return .{ .err = e },
                    } } };
                } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(closure.func, "-o-repeating-linear-gradient")) {
                    return .{ .result = .{ .repeating_linear = switch (LinearGradient.parse(input_, css.VendorPrefix{ .o = true })) {
                        .result => |vv| vv,
                        .err => |e| return .{ .err = e },
                    } } };
                } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(closure.func, "-o-radial-gradient")) {
                    return .{ .result = .{ .radial = switch (RadialGradient.parse(input_, css.VendorPrefix{ .o = true })) {
                        .result => |vv| vv,
                        .err => |e| return .{ .err = e },
                    } } };
                } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(closure.func, "-o-repeating-radial-gradient")) {
                    return .{ .result = .{ .repeating_radial = switch (RadialGradient.parse(input_, css.VendorPrefix{ .o = true })) {
                        .result => |vv| vv,
                        .err => |e| return .{ .err = e },
                    } } };
                } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(closure.func, "-webkit-gradient")) {
                    return .{ .result = .{ .@"webkit-gradient" = switch (WebKitGradient.parse(input_)) {
                        .result => |vv| vv,
                        .err => |e| return .{ .err = e },
                    } } };
                } else {
                    return .{ .err = closure.location.newUnexpectedTokenError(.{ .ident = closure.func }) };
                }
            }
        }.parse);
    }

    pub fn toCss(this: *const Gradient, comptime W: type, dest: *Printer(W)) PrintErr!void {
        const f: []const u8, const prefix: ?css.VendorPrefix = switch (this.*) {
            .linear => |g| .{ "linear-gradient(", g.vendor_prefix },
            .repeating_linear => |g| .{ "repeating-linear-gradient(", g.vendor_prefix },
            .radial => |g| .{ "radial-gradient(", g.vendor_prefix },
            .repeating_radial => |g| .{ "repeating-linear-gradient(", g.vendor_prefix },
            .conic => .{ "conic-gradient(", null },
            .repeating_conic => .{ "repeating-conic-gradient(", null },
            .@"webkit-gradient" => .{ "-webkit-gradient(", null },
        };

        if (prefix) |p| {
            try p.toCss(W, dest);
        }

        try dest.writeStr(f);

        switch (this.*) {
            .linear, .repeating_linear => |*linear| {
                try linear.toCss(W, dest, linear.vendor_prefix.eq(css.VendorPrefix{ .none = true }));
            },
            .radial, .repeating_radial => |*radial| {
                try radial.toCss(W, dest);
            },
            .conic, .repeating_conic => |*conic| {
                try conic.toCss(W, dest);
            },
            .@"webkit-gradient" => |*g| {
                try g.toCss(W, dest);
            },
        }

        return dest.writeChar(')');
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }

    pub fn eql(this: *const Gradient, other: *const Gradient) bool {
        return css.implementEql(Gradient, this, other);
        // if (this.* == .linear and other.* == .linear) {
        //     return this.linear.eql(&other.linear);
        // } else if (this.* == .repeating_linear and other.* == .repeating_linear) {
        //     return this.repeating_linear.eql(&other.repeating_linear);
        // } else if (this.* == .radial and other.* == .radial) {
        //     return this.radial.eql(&other.radial);
        // } else if (this.* == .repeating_radial and other.* == .repeating_radial) {
        //     return this.repeating_radial.eql(&other.repeating_radial);
        // } else if (this.* == .conic and other.* == .conic) {
        //     return this.conic.eql(&other.conic);
        // } else if (this.* == .repeating_conic and other.* == .repeating_conic) {
        //     return this.repeating_conic.eql(&other.repeating_conic);
        // } else if (this.* == .@"webkit-gradient" and other.* == .@"webkit-gradient") {
        //     return this.@"webkit-gradient".eql(&other.@"webkit-gradient");
        // }
        // ret
    }
};

/// A CSS [`linear-gradient()`](https://www.w3.org/TR/css-images-3/#linear-gradients) or `repeating-linear-gradient()`.
pub const LinearGradient = struct {
    /// The vendor prefixes for the gradient.
    vendor_prefix: VendorPrefix,
    /// The direction of the gradient.
    direction: LineDirection,
    /// The color stops and transition hints for the gradient.
    items: ArrayList(GradientItem(LengthPercentage)),

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }

    pub fn eql(this: *const LinearGradient, other: *const LinearGradient) bool {
        return this.vendor_prefix.eql(other.vendor_prefix) and this.direction.eql(&other.direction) and css.generic.eqlList(GradientItem(LengthPercentage), &this.items, &other.items);
    }

    pub fn parse(input: *css.Parser, vendor_prefix: VendorPrefix) Result(LinearGradient) {
        const direction: LineDirection = if (input.tryParse(LineDirection.parse, .{vendor_prefix.neq(VendorPrefix{ .none = true })}).asValue()) |dir| direction: {
            if (input.expectComma().asErr()) |e| return .{ .err = e };
            break :direction dir;
        } else LineDirection{ .vertical = .bottom };
        const items = switch (parseItems(LengthPercentage, input)) {
            .result => |vv| vv,
            .err => |e| return .{ .err = e },
        };
        return .{ .result = LinearGradient{ .direction = direction, .items = items, .vendor_prefix = vendor_prefix } };
    }

    pub fn toCss(this: *const LinearGradient, comptime W: type, dest: *Printer(W), is_prefixed: bool) PrintErr!void {
        const angle: f32 = switch (this.direction) {
            .vertical => |v| switch (v) {
                .bottom => 180.0,
                .top => 0.0,
            },
            .angle => |a| a.toDegrees(),
            else => -1.0,
        };

        // We can omit `to bottom` or `180deg` because it is the default.
        if (angle == 180.0) {
            // todo_stuff.depth
            try serializeItems(LengthPercentage, &this.items, W, dest);
        }
        // If we have `to top` or `0deg`, and all of the positions and hints are percentages,
        // we can flip the gradient the other direction and omit the direction.
        else if (angle == 0.0 and dest.minify and brk: {
            for (this.items.items) |*item| {
                if (item.* == .hint and item.hint != .percentage) break :brk false;
                if (item.* == .color_stop and item.color_stop.position != null and item.color_stop.position.? != .percentage) break :brk false;
            }
            break :brk true;
        }) {
            var flipped_items = ArrayList(GradientItem(LengthPercentage)).initCapacity(
                dest.allocator,
                this.items.items.len,
            ) catch bun.outOfMemory();
            defer flipped_items.deinit(dest.allocator);

            var i: usize = this.items.items.len;
            while (i > 0) {
                i -= 1;
                const item = &this.items.items[i];
                switch (item.*) {
                    .hint => |*h| switch (h.*) {
                        .percentage => |p| flipped_items.append(dest.allocator, .{ .hint = .{ .percentage = .{ .v = 1.0 - p.v } } }) catch bun.outOfMemory(),
                        else => unreachable,
                    },
                    .color_stop => |*cs| flipped_items.append(dest.allocator, .{
                        .color_stop = .{
                            .color = cs.color,
                            .position = if (cs.position) |*p| switch (p.*) {
                                .percentage => |perc| .{ .percentage = .{ .v = 1.0 - perc.v } },
                                else => unreachable,
                            } else null,
                        },
                    }) catch bun.outOfMemory(),
                }
            }

            serializeItems(LengthPercentage, &flipped_items, W, dest) catch return dest.addFmtError();
        } else {
            if ((this.direction != .vertical or this.direction.vertical != .bottom) and
                (this.direction != .angle or this.direction.angle.deg != 180.0))
            {
                try this.direction.toCss(W, dest, is_prefixed);
                try dest.delim(',', false);
            }

            serializeItems(LengthPercentage, &this.items, W, dest) catch return dest.addFmtError();
        }
    }
};

/// A CSS [`radial-gradient()`](https://www.w3.org/TR/css-images-3/#radial-gradients) or `repeating-radial-gradient()`.
pub const RadialGradient = struct {
    /// The vendor prefixes for the gradient.
    vendor_prefix: VendorPrefix,
    /// The shape of the gradient.
    shape: EndingShape,
    /// The position of the gradient.
    position: Position,
    /// The color stops and transition hints for the gradient.
    items: ArrayList(GradientItem(LengthPercentage)),

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }

    pub fn parse(input: *css.Parser, vendor_prefix: VendorPrefix) Result(RadialGradient) {
        // todo_stuff.depth
        const shape = switch (input.tryParse(EndingShape.parse, .{})) {
            .result => |vv| vv,
            .err => null,
        };
        const position = switch (input.tryParse(struct {
            fn parse(input_: *css.Parser) Result(Position) {
                if (input_.expectIdentMatching("at").asErr()) |e| return .{ .err = e };
                return Position.parse(input_);
            }
        }.parse, .{})) {
            .result => |v| v,
            .err => null,
        };

        if (shape != null or position != null) {
            if (input.expectComma().asErr()) |e| return .{ .err = e };
        }

        const items = switch (parseItems(LengthPercentage, input)) {
            .result => |vv| vv,
            .err => |e| return .{ .err = e },
        };
        return .{
            .result = RadialGradient{
                // todo_stuff.depth
                .shape = shape orelse EndingShape.default(),
                // todo_stuff.depth
                .position = position orelse Position.center(),
                .items = items,
                .vendor_prefix = vendor_prefix,
            },
        };
    }

    pub fn toCss(this: *const RadialGradient, comptime W: type, dest: *Printer(W)) PrintErr!void {
        if (std.meta.eql(this.shape, EndingShape.default())) {
            try this.shape.toCss(W, dest);
            if (this.position.isCenter()) {
                try dest.delim(',', false);
            } else {
                try dest.writeChar(' ');
            }
        }

        if (!this.position.isCenter()) {
            try dest.writeStr("at ");
            try this.position.toCss(W, dest);
            try dest.delim(',', false);
        }

        try serializeItems(LengthPercentage, &this.items, W, dest);
    }

    pub fn eql(this: *const RadialGradient, other: *const RadialGradient) bool {
        return this.vendor_prefix.eql(other.vendor_prefix) and
            this.shape.eql(&other.shape) and
            this.position.eql(&other.position) and
            css.generic.eqlList(GradientItem(LengthPercentage), &this.items, &other.items);
    }
};

/// A CSS [`conic-gradient()`](https://www.w3.org/TR/css-images-4/#conic-gradients) or `repeating-conic-gradient()`.
pub const ConicGradient = struct {
    /// The angle of the gradient.
    angle: Angle,
    /// The position of the gradient.
    position: Position,
    /// The color stops and transition hints for the gradient.
    items: ArrayList(GradientItem(AnglePercentage)),

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }

    pub fn parse(input: *css.Parser) Result(ConicGradient) {
        const angle = input.tryParse(struct {
            inline fn parse(i: *css.Parser) Result(Angle) {
                if (i.expectIdentMatching("from").asErr()) |e| return .{ .err = e };
                // Spec allows unitless zero angles for gradients.
                // https://w3c.github.io/csswg-drafts/css-images-4/#valdef-conic-gradient-angle
                return Angle.parseWithUnitlessZero(i);
            }
        }.parse, .{}).unwrapOr(Angle{ .deg = 0.0 });

        const position = input.tryParse(struct {
            inline fn parse(i: *css.Parser) Result(Position) {
                if (i.expectIdentMatching("at").asErr()) |e| return .{ .err = e };
                return Position.parse(i);
            }
        }.parse, .{}).unwrapOr(Position.center());

        if (!angle.eql(&Angle{ .deg = 0.0 }) or !std.meta.eql(position, Position.center())) {
            if (input.expectComma().asErr()) |e| return .{ .err = e };
        }

        const items = switch (parseItems(AnglePercentage, input)) {
            .result => |vv| vv,
            .err => |e| return .{ .err = e },
        };
        return .{ .result = ConicGradient{
            .angle = angle,
            .position = position,
            .items = items,
        } };
    }

    pub fn toCss(this: *const ConicGradient, comptime W: type, dest: *Printer(W)) PrintErr!void {
        if (!this.angle.isZero()) {
            try dest.writeStr("from ");
            try this.angle.toCss(W, dest);

            if (this.position.isCenter()) {
                try dest.delim(',', false);
            } else {
                try dest.writeChar(' ');
            }
        }

        if (!this.position.isCenter()) {
            try dest.writeStr("at ");
            try this.position.toCss(W, dest);
            try dest.delim(',', false);
        }

        return try serializeItems(AnglePercentage, &this.items, W, dest);
    }

    pub fn eql(this: *const ConicGradient, other: *const ConicGradient) bool {
        return this.angle.eql(&other.angle) and
            this.position.eql(&other.position) and
            css.generic.eqlList(GradientItem(AnglePercentage), &this.items, &other.items);
    }
};

/// A legacy `-webkit-gradient()`.
pub const WebKitGradient = union(enum) {
    /// A linear `-webkit-gradient()`.
    linear: struct {
        /// The starting point of the gradient.
        from: WebKitGradientPoint,
        /// The ending point of the gradient.
        to: WebKitGradientPoint,
        /// The color stops in the gradient.
        stops: ArrayList(WebKitColorStop),

        pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
            return css.implementDeepClone(@This(), this, allocator);
        }
    },
    /// A radial `-webkit-gradient()`.
    radial: struct {
        /// The starting point of the gradient.
        from: WebKitGradientPoint,
        /// The starting radius of the gradient.
        r0: CSSNumber,
        /// The ending point of the gradient.
        to: WebKitGradientPoint,
        /// The ending radius of the gradient.
        r1: CSSNumber,
        /// The color stops in the gradient.
        stops: ArrayList(WebKitColorStop),

        pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
            return css.implementDeepClone(@This(), this, allocator);
        }
    },

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }

    pub fn eql(this: *const WebKitGradient, other: *const WebKitGradient) bool {
        return switch (this.*) {
            .linear => |*a| switch (other.*) {
                .linear => a.from.eql(&other.linear.from) and a.to.eql(&other.linear.to) and css.generic.eqlList(WebKitColorStop, &a.stops, &other.linear.stops),
                else => false,
            },
            .radial => |*a| switch (other.*) {
                .radial => a.from.eql(&other.radial.from) and a.to.eql(&other.radial.to) and a.r0 == other.radial.r0 and a.r1 == other.radial.r1 and css.generic.eqlList(WebKitColorStop, &a.stops, &other.radial.stops),
                else => false,
            },
        };
    }

    pub fn parse(input: *css.Parser) Result(WebKitGradient) {
        const location = input.currentSourceLocation();
        const ident = switch (input.expectIdent()) {
            .result => |vv| vv,
            .err => |e| return .{ .err = e },
        };
        if (input.expectComma().asErr()) |e| return .{ .err = e };

        // todo_stuff.match_ignore_ascii_case
        if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(ident, "linear")) {
            // todo_stuff.depth
            const from = switch (WebKitGradientPoint.parse(input)) {
                .result => |vv| vv,
                .err => |e| return .{ .err = e },
            };
            if (input.expectComma().asErr()) |e| return .{ .err = e };
            const to = switch (WebKitGradientPoint.parse(input)) {
                .result => |vv| vv,
                .err => |e| return .{ .err = e },
            };
            if (input.expectComma().asErr()) |e| return .{ .err = e };
            const stops = switch (input.parseCommaSeparated(WebKitColorStop, WebKitColorStop.parse)) {
                .result => |vv| vv,
                .err => |e| return .{ .err = e },
            };
            return .{ .result = WebKitGradient{ .linear = .{
                .from = from,
                .to = to,
                .stops = stops,
            } } };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(ident, "radial")) {
            const from = switch (WebKitGradientPoint.parse(input)) {
                .result => |vv| vv,
                .err => |e| return .{ .err = e },
            };
            if (input.expectComma().asErr()) |e| return .{ .err = e };
            const r0 = switch (CSSNumberFns.parse(input)) {
                .result => |vv| vv,
                .err => |e| return .{ .err = e },
            };
            if (input.expectComma().asErr()) |e| return .{ .err = e };
            const to = switch (WebKitGradientPoint.parse(input)) {
                .result => |vv| vv,
                .err => |e| return .{ .err = e },
            };
            if (input.expectComma().asErr()) |e| return .{ .err = e };
            const r1 = switch (CSSNumberFns.parse(input)) {
                .result => |vv| vv,
                .err => |e| return .{ .err = e },
            };
            if (input.expectComma().asErr()) |e| return .{ .err = e };
            // todo_stuff.depth
            const stops = switch (input.parseCommaSeparated(WebKitColorStop, WebKitColorStop.parse)) {
                .result => |vv| vv,
                .err => |e| return .{ .err = e },
            };
            return .{ .result = WebKitGradient{
                .radial = .{
                    .from = from,
                    .r0 = r0,
                    .to = to,
                    .r1 = r1,
                    .stops = stops,
                },
            } };
        } else {
            return .{ .err = location.newUnexpectedTokenError(.{ .ident = ident }) };
        }
    }

    pub fn toCss(this: *const WebKitGradient, comptime W: type, dest: *Printer(W)) PrintErr!void {
        switch (this.*) {
            .linear => |*linear| {
                try dest.writeStr("linear");
                try dest.delim(',', false);
                try linear.from.toCss(W, dest);
                try dest.delim(',', false);
                try linear.to.toCss(W, dest);
                for (linear.stops.items) |*stop| {
                    try dest.delim(',', false);
                    try stop.toCss(W, dest);
                }
            },
            .radial => |*radial| {
                try dest.writeStr("radial");
                try dest.delim(',', false);
                try radial.from.toCss(W, dest);
                try dest.delim(',', false);
                try CSSNumberFns.toCss(&radial.r0, W, dest);
                try dest.delim(',', false);
                try radial.to.toCss(W, dest);
                try dest.delim(',', false);
                try CSSNumberFns.toCss(&radial.r1, W, dest);
                for (radial.stops.items) |*stop| {
                    try dest.delim(',', false);
                    try stop.toCss(W, dest);
                }
            },
        }
    }
};

/// The direction of a CSS `linear-gradient()`.
///
/// See [LinearGradient](LinearGradient).
pub const LineDirection = union(enum) {
    /// An angle.
    angle: Angle,
    /// A horizontal position keyword, e.g. `left` or `right`.
    horizontal: HorizontalPositionKeyword,
    /// A vertical position keyword, e.g. `top` or `bottom`.
    vertical: VerticalPositionKeyword,
    /// A corner, e.g. `bottom left` or `top right`.
    corner: struct {
        /// A horizontal position keyword, e.g. `left` or `right`.
        horizontal: HorizontalPositionKeyword,
        /// A vertical position keyword, e.g. `top` or `bottom`.
        vertical: VerticalPositionKeyword,

        pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
            return css.implementDeepClone(@This(), this, allocator);
        }
    },

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }

    pub fn eql(this: *const LineDirection, other: *const LineDirection) bool {
        return switch (this.*) {
            .angle => |*a| switch (other.*) {
                .angle => a.eql(&other.angle),
                else => false,
            },
            .horizontal => |*v| switch (other.*) {
                .horizontal => v.* == other.horizontal,
                else => false,
            },
            .vertical => |*v| switch (other.*) {
                .vertical => v.* == other.vertical,
                else => false,
            },
            .corner => |*c| switch (other.*) {
                .corner => c.horizontal == other.corner.horizontal and c.vertical == other.corner.vertical,
                else => false,
            },
        };
    }

    pub fn parse(input: *css.Parser, is_prefixed: bool) Result(LineDirection) {
        // Spec allows unitless zero angles for gradients.
        // https://w3c.github.io/csswg-drafts/css-images-3/#linear-gradient-syntax
        if (input.tryParse(Angle.parseWithUnitlessZero, .{}).asValue()) |angle| {
            return .{ .result = LineDirection{ .angle = angle } };
        }

        if (!is_prefixed) {
            if (input.expectIdentMatching("to").asErr()) |e| return .{ .err = e };
        }

        if (input.tryParse(HorizontalPositionKeyword.parse, .{}).asValue()) |x| {
            if (input.tryParse(VerticalPositionKeyword.parse, .{}).asValue()) |y| {
                return .{ .result = LineDirection{ .corner = .{
                    .horizontal = x,
                    .vertical = y,
                } } };
            }
            return .{ .result = LineDirection{ .horizontal = x } };
        }

        const y = switch (VerticalPositionKeyword.parse(input)) {
            .result => |vv| vv,
            .err => |e| return .{ .err = e },
        };
        if (input.tryParse(HorizontalPositionKeyword.parse, .{}).asValue()) |x| {
            return .{ .result = LineDirection{ .corner = .{
                .horizontal = x,
                .vertical = y,
            } } };
        }
        return .{ .result = LineDirection{ .vertical = y } };
    }

    pub fn toCss(this: *const LineDirection, comptime W: type, dest: *Printer(W), is_prefixed: bool) PrintErr!void {
        switch (this.*) {
            .angle => |*angle| try angle.toCss(W, dest),
            .horizontal => |*k| {
                if (dest.minify) {
                    try dest.writeStr(switch (k.*) {
                        .left => "270deg",
                        .right => "90deg",
                    });
                } else {
                    if (!is_prefixed) {
                        try dest.writeStr("to ");
                    }
                    try k.toCss(W, dest);
                }
            },
            .vertical => |*k| {
                if (dest.minify) {
                    try dest.writeStr(switch (k.*) {
                        .top => "0deg",
                        .bottom => "180deg",
                    });
                } else {
                    if (!is_prefixed) {
                        try dest.writeStr("to ");
                    }
                    try k.toCss(W, dest);
                }
            },
            .corner => |*c| {
                if (!is_prefixed) {
                    try dest.writeStr("to ");
                }
                try c.vertical.toCss(W, dest);
                try dest.writeChar(' ');
                try c.horizontal.toCss(W, dest);
            },
        }
    }
};

/// Either a color stop or interpolation hint within a gradient.
///
/// This type is generic, and items may be either a [LengthPercentage](super::length::LengthPercentage)
/// or [Angle](super::angle::Angle) depending on what type of gradient it is within.
pub fn GradientItem(comptime D: type) type {
    return union(enum) {
        /// A color stop.
        color_stop: ColorStop(D),
        /// A color interpolation hint.
        hint: D,

        pub fn toCss(this: *const @This(), comptime W: type, dest: *Printer(W)) PrintErr!void {
            return switch (this.*) {
                .color_stop => |*c| try c.toCss(W, dest),
                .hint => |*h| try css.generic.toCss(D, h, W, dest),
            };
        }

        pub fn eql(this: *const GradientItem(D), other: *const GradientItem(D)) bool {
            return switch (this.*) {
                .color_stop => |*a| switch (other.*) {
                    .color_stop => a.eql(&other.color_stop),
                    else => false,
                },
                .hint => |*a| switch (other.*) {
                    .hint => css.generic.eql(D, a, &other.hint),
                    else => false,
                },
            };
        }

        pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
            return css.implementDeepClone(@This(), this, allocator);
        }
    };
}

/// A `radial-gradient()` [ending shape](https://www.w3.org/TR/css-images-3/#valdef-radial-gradient-ending-shape).
///
/// See [RadialGradient](RadialGradient).
pub const EndingShape = union(enum) {
    /// An ellipse.
    ellipse: Ellipse,
    /// A circle.
    circle: Circle,

    pub usingnamespace css.DeriveParse(@This());
    pub usingnamespace css.DeriveToCss(@This());

    pub fn default() EndingShape {
        return .{ .ellipse = .{ .extent = .@"farthest-corner" } };
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }

    pub fn eql(this: *const EndingShape, other: *const EndingShape) bool {
        return switch (this.*) {
            .ellipse => |*a| switch (other.*) {
                .ellipse => a.eql(&other.ellipse),
                else => false,
            },
            .circle => |*a| switch (other.*) {
                .circle => a.eql(&other.circle),
                else => false,
            },
        };
    }
};

/// An x/y position within a legacy `-webkit-gradient()`.
pub const WebKitGradientPoint = struct {
    /// The x-position.
    x: WebKitGradientPointComponent(HorizontalPositionKeyword),
    /// The y-position.
    y: WebKitGradientPointComponent(VerticalPositionKeyword),

    pub fn parse(input: *css.Parser) Result(WebKitGradientPoint) {
        const x = switch (WebKitGradientPointComponent(HorizontalPositionKeyword).parse(input)) {
            .result => |v| v,
            .err => |e| return .{ .err = e },
        };
        const y = switch (WebKitGradientPointComponent(VerticalPositionKeyword).parse(input)) {
            .result => |v| v,
            .err => |e| return .{ .err = e },
        };
        return .{ .result = .{ .x = x, .y = y } };
    }

    pub fn toCss(this: *const WebKitGradientPoint, comptime W: type, dest: *Printer(W)) PrintErr!void {
        try this.x.toCss(W, dest);
        try dest.writeChar(' ');
        return try this.y.toCss(W, dest);
    }

    pub fn eql(this: *const WebKitGradientPoint, other: *const WebKitGradientPoint) bool {
        return this.x.eql(&other.x) and this.y.eql(&other.y);
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }
};

/// A keyword or number within a [WebKitGradientPoint](WebKitGradientPoint).
pub fn WebKitGradientPointComponent(comptime S: type) type {
    return union(enum) {
        /// The `center` keyword.
        center,
        /// A number or percentage.
        number: NumberOrPercentage,
        /// A side keyword.
        side: S,

        const This = @This();

        pub fn parse(input: *css.Parser) Result(This) {
            if (input.tryParse(css.Parser.expectIdentMatching, .{"center"}).isOk()) {
                return .{ .result = .center };
            }

            if (input.tryParse(NumberOrPercentage.parse, .{}).asValue()) |number| {
                return .{ .result = .{ .number = number } };
            }

            const keyword = switch (css.generic.parse(S, input)) {
                .result => |vv| vv,
                .err => |e| return .{ .err = e },
            };
            return .{ .result = .{ .side = keyword } };
        }

        pub fn toCss(this: *const This, comptime W: type, dest: *Printer(W)) PrintErr!void {
            switch (this.*) {
                .center => {
                    if (dest.minify) {
                        try dest.writeStr("50%");
                    } else {
                        try dest.writeStr("center");
                    }
                },
                .number => |*lp| {
                    if (lp.* == .percentage and lp.percentage.v == 0.0) {
                        try dest.writeChar('0');
                    } else {
                        try lp.toCss(W, dest);
                    }
                },
                .side => |*s| {
                    if (dest.minify) {
                        const lp: LengthPercentage = s.intoLengthPercentage();
                        try lp.toCss(W, dest);
                    } else {
                        try s.toCss(W, dest);
                    }
                },
            }
        }

        pub fn eql(this: *const This, other: *const This) bool {
            return switch (this.*) {
                .center => switch (other.*) {
                    .center => true,
                    else => false,
                },
                .number => |*a| switch (other.*) {
                    .number => a.eql(&other.number),
                    else => false,
                },
                .side => |*a| switch (other.*) {
                    .side => |*b| a.eql(&b.*),
                    else => false,
                },
            };
        }
    };
}

/// A color stop within a legacy `-webkit-gradient()`.
pub const WebKitColorStop = struct {
    /// The color of the color stop.
    color: CssColor,
    /// The position of the color stop.
    position: CSSNumber,

    pub fn parse(input: *css.Parser) Result(WebKitColorStop) {
        const location = input.currentSourceLocation();
        const function = switch (input.expectFunction()) {
            .result => |vv| vv,
            .err => |e| return .{ .err = e },
        };
        const Closure = struct { loc: css.SourceLocation, function: []const u8 };
        return input.parseNestedBlock(
            WebKitColorStop,
            Closure{ .loc = location, .function = function },
            struct {
                fn parse(
                    closure: Closure,
                    i: *css.Parser,
                ) Result(WebKitColorStop) {
                    // todo_stuff.match_ignore_ascii_case
                    const position: f32 = if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(closure.function, "color-stop")) position: {
                        const p: NumberOrPercentage = switch (@call(.auto, @field(NumberOrPercentage, "parse"), .{i})) {
                            .result => |vv| vv,
                            .err => |e| return .{ .err = e },
                        };
                        if (i.expectComma().asErr()) |e| return .{ .err = e };
                        break :position p.intoF32();
                    } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(closure.function, "from")) position: {
                        break :position 0.0;
                    } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(closure.function, "to")) position: {
                        break :position 1.0;
                    } else {
                        return .{ .err = closure.loc.newUnexpectedTokenError(.{ .ident = closure.function }) };
                    };
                    const color = switch (CssColor.parse(i)) {
                        .result => |vv| vv,
                        .err => |e| return .{ .err = e },
                    };
                    return .{ .result = WebKitColorStop{ .color = color, .position = position } };
                }
            }.parse,
        );
    }

    pub fn toCss(this: *const WebKitColorStop, comptime W: type, dest: *Printer(W)) PrintErr!void {
        if (this.position == 0.0) {
            try dest.writeStr("from(");
            try this.color.toCss(W, dest);
        } else if (this.position == 1.0) {
            try dest.writeStr("to(");
            try this.color.toCss(W, dest);
        } else {
            try dest.writeStr("color-stop(");
            try css.generic.toCss(CSSNumber, &this.position, W, dest);
            try dest.delim(',', false);
            try this.color.toCss(W, dest);
        }
        try dest.writeChar(')');
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }

    pub fn eql(this: *const WebKitColorStop, other: *const WebKitColorStop) bool {
        return css.implementEql(WebKitColorStop, this, other);
    }
};

/// A [`<color-stop>`](https://www.w3.org/TR/css-images-4/#color-stop-syntax) within a gradient.
///
/// This type is generic, and may be either a [LengthPercentage](super::length::LengthPercentage)
/// or [Angle](super::angle::Angle) depending on what type of gradient it is within.
pub fn ColorStop(comptime D: type) type {
    return struct {
        /// The color of the color stop.
        color: CssColor,
        /// The position of the color stop.
        position: ?D,

        const This = @This();

        pub fn parse(input: *css.Parser) Result(ColorStop(D)) {
            const color = switch (CssColor.parse(input)) {
                .result => |vv| vv,
                .err => |e| return .{ .err = e },
            };
            const position = switch (input.tryParse(css.generic.parseFor(D), .{})) {
                .result => |v| v,
                .err => null,
            };
            return .{ .result = .{ .color = color, .position = position } };
        }

        pub fn toCss(this: *const This, comptime W: type, dest: *Printer(W)) PrintErr!void {
            try this.color.toCss(W, dest);
            if (this.position) |*position| {
                try dest.delim(',', false);
                try css.generic.toCss(D, position, W, dest);
            }
            return;
        }

        pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
            return css.implementDeepClone(@This(), this, allocator);
        }

        pub fn eql(this: *const This, other: *const This) bool {
            return this.color.eql(&other.color) and css.generic.eql(?D, &this.position, &other.position);
        }
    };
}

/// An ellipse ending shape for a `radial-gradient()`.
///
/// See [RadialGradient](RadialGradient).
pub const Ellipse = union(enum) {
    /// An ellipse with a specified horizontal and vertical radius.
    size: struct {
        /// The x-radius of the ellipse.
        x: LengthPercentage,
        /// The y-radius of the ellipse.
        y: LengthPercentage,

        pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
            return css.implementDeepClone(@This(), this, allocator);
        }
    },
    /// A shape extent keyword.
    extent: ShapeExtent,

    pub fn parse(input: *css.Parser) Result(Ellipse) {
        if (input.tryParse(ShapeExtent.parse, .{}).asValue()) |extent| {
            // The `ellipse` keyword is optional, but only if the `circle` keyword is not present.
            // If it is, then we'll re-parse as a circle.
            if (input.tryParse(css.Parser.expectIdentMatching, .{"circle"}).isOk()) {
                return .{ .err = input.newErrorForNextToken() };
            }
            _ = input.tryParse(css.Parser.expectIdentMatching, .{"ellipse"});
            return .{ .result = Ellipse{ .extent = extent } };
        }

        if (input.tryParse(LengthPercentage.parse, .{}).asValue()) |x| {
            const y = switch (LengthPercentage.parse(input)) {
                .result => |vv| vv,
                .err => |e| return .{ .err = e },
            };
            // The `ellipse` keyword is optional if there are two lengths.
            _ = input.tryParse(css.Parser.expectIdentMatching, .{"ellipse"});
            return .{ .result = Ellipse{ .size = .{ .x = x, .y = y } } };
        }

        if (input.tryParse(css.Parser.expectIdentMatching, .{"ellipse"}).isOk()) {
            if (input.tryParse(ShapeExtent.parse, .{}).asValue()) |extent| {
                return .{ .result = Ellipse{ .extent = extent } };
            }

            if (input.tryParse(LengthPercentage.parse, .{}).asValue()) |x| {
                const y = switch (LengthPercentage.parse(input)) {
                    .result => |vv| vv,
                    .err => |e| return .{ .err = e },
                };
                return .{ .result = Ellipse{ .size = .{ .x = x, .y = y } } };
            }

            // Assume `farthest-corner` if only the `ellipse` keyword is present.
            return .{ .result = Ellipse{ .extent = .@"farthest-corner" } };
        }

        return .{ .err = input.newErrorForNextToken() };
    }

    pub fn toCss(this: *const Ellipse, comptime W: type, dest: *Printer(W)) PrintErr!void {
        // The `ellipse` keyword is optional, so we don't emit it.
        return switch (this.*) {
            .size => |*s| {
                try s.x.toCss(W, dest);
                try dest.writeChar(' ');
                return try s.y.toCss(W, dest);
            },
            .extent => |*e| try e.toCss(W, dest),
        };
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }

    pub fn eql(this: *const Ellipse, other: *const Ellipse) bool {
        return this.size.x.eql(&other.size.x) and this.size.y.eql(&other.size.y) and this.extent.eql(&other.extent);
    }
};

pub const ShapeExtent = enum {
    /// The closest side of the box to the gradient's center.
    @"closest-side",
    /// The farthest side of the box from the gradient's center.
    @"farthest-side",
    /// The closest corner of the box to the gradient's center.
    @"closest-corner",
    /// The farthest corner of the box from the gradient's center.
    @"farthest-corner",

    pub fn eql(this: *const ShapeExtent, other: *const ShapeExtent) bool {
        return this.* == other.*;
    }

    pub fn asStr(this: *const @This()) []const u8 {
        return css.enum_property_util.asStr(@This(), this);
    }

    pub fn parse(input: *css.Parser) Result(@This()) {
        return css.enum_property_util.parse(@This(), input);
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }

    pub fn toCss(this: *const @This(), comptime W: type, dest: *Printer(W)) PrintErr!void {
        return css.enum_property_util.toCss(@This(), this, W, dest);
    }
};

/// A circle ending shape for a `radial-gradient()`.
///
/// See [RadialGradient](RadialGradient).
pub const Circle = union(enum) {
    /// A circle with a specified radius.
    radius: Length,
    /// A shape extent keyword.
    extent: ShapeExtent,

    pub fn parse(input: *css.Parser) Result(Circle) {
        if (input.tryParse(ShapeExtent.parse, .{}).asValue()) |extent| {
            // The `circle` keyword is required. If it's not there, then it's an ellipse.
            if (input.expectIdentMatching("circle").asErr()) |e| return .{ .err = e };
            return .{ .result = Circle{ .extent = extent } };
        }

        if (input.tryParse(Length.parse, .{}).asValue()) |length| {
            // The `circle` keyword is optional if there is only a single length.
            // We are assuming here that Ellipse.parse ran first.
            _ = input.tryParse(css.Parser.expectIdentMatching, .{"circle"});
            return .{ .result = Circle{ .radius = length } };
        }

        if (input.tryParse(css.Parser.expectIdentMatching, .{"circle"}).isOk()) {
            if (input.tryParse(ShapeExtent.parse, .{}).asValue()) |extent| {
                return .{ .result = Circle{ .extent = extent } };
            }

            if (input.tryParse(Length.parse, .{}).asValue()) |length| {
                return .{ .result = Circle{ .radius = length } };
            }

            // If only the `circle` keyword was given, default to `farthest-corner`.
            return .{ .result = Circle{ .extent = .@"farthest-corner" } };
        }

        return .{ .err = input.newErrorForNextToken() };
    }

    pub fn toCss(this: *const Circle, comptime W: type, dest: *Printer(W)) PrintErr!void {
        return switch (this.*) {
            .radius => |r| try r.toCss(W, dest),
            .extent => |extent| {
                try dest.writeStr("circle");
                if (extent != .@"farthest-corner") {
                    try dest.writeChar(' ');
                    try extent.toCss(W, dest);
                }
            },
        };
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }

    pub fn eql(this: *const Circle, other: *const Circle) bool {
        return this.radius.eql(&other.radius) and this.extent.eql(&other.extent);
    }
};

pub fn parseItems(comptime D: type, input: *css.Parser) Result(ArrayList(GradientItem(D))) {
    var items = ArrayList(GradientItem(D)){};
    var seen_stop = false;

    while (true) {
        const Closure = struct { items: *ArrayList(GradientItem(D)), seen_stop: *bool };
        if (input.parseUntilBefore(
            css.Delimiters{ .comma = true },
            void,
            Closure{ .items = &items, .seen_stop = &seen_stop },
            struct {
                fn parse(closure: Closure, i: *css.Parser) Result(void) {
                    if (closure.seen_stop.*) {
                        if (i.tryParse(comptime css.generic.parseFor(D), .{}).asValue()) |hint| {
                            closure.seen_stop.* = false;
                            closure.items.append(i.allocator(), .{ .hint = hint }) catch bun.outOfMemory();
                            return Result(void).success;
                        }
                    }

                    const stop = switch (ColorStop(D).parse(i)) {
                        .result => |vv| vv,
                        .err => |e| return .{ .err = e },
                    };

                    if (i.tryParse(comptime css.generic.parseFor(D), .{}).asValue()) |position| {
                        const color = stop.color.deepClone(i.allocator());
                        closure.items.append(i.allocator(), .{ .color_stop = stop }) catch bun.outOfMemory();
                        closure.items.append(i.allocator(), .{ .color_stop = .{
                            .color = color,
                            .position = position,
                        } }) catch bun.outOfMemory();
                    } else {
                        closure.items.append(i.allocator(), .{ .color_stop = stop }) catch bun.outOfMemory();
                    }

                    closure.seen_stop.* = true;
                    return Result(void).success;
                }
            }.parse,
        ).asErr()) |e| return .{ .err = e };

        if (input.next().asValue()) |tok| {
            if (tok.* == .comma) continue;
            bun.unreachablePanic("expected a comma after parsing a gradient", .{});
        } else {
            break;
        }
    }

    return .{ .result = items };
}

pub fn serializeItems(
    comptime D: type,
    items: *const ArrayList(GradientItem(D)),
    comptime W: type,
    dest: *Printer(W),
) PrintErr!void {
    var first = true;
    var last: ?*const GradientItem(D) = null;
    for (items.items) |*item| {
        // Skip useless hints
        if (item.* == .hint and item.hint == .percentage and item.hint.percentage.v == 0.5) {
            continue;
        }

        // Use double position stop if the last stop is the same color and all targets support it.
        if (last) |prev| {
            if (!dest.targets.shouldCompile(.double_position_gradients, .{ .double_position_gradients = true })) {
                if (prev.* == .color_stop and prev.color_stop.position != null and
                    item.* == .color_stop and item.color_stop.position != null and
                    prev.color_stop.color.eql(&item.color_stop.color))
                {
                    try dest.writeChar(' ');
                    try item.color_stop.position.?.toCss(W, dest);
                    last = null;
                    continue;
                }
            }
        }

        if (first) {
            first = false;
        } else {
            try dest.delim(',', false);
        }
        try item.toCss(W, dest);
        last = item;
    }
}
