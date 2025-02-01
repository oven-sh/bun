const std = @import("std");
const bun = @import("root").bun;
const Allocator = std.mem.Allocator;
const ArrayList = std.ArrayListUnmanaged;

pub const css = @import("../css_parser.zig");

const SmallList = css.SmallList;
const Printer = css.Printer;
const PrintErr = css.PrintErr;
const Result = css.Result;
const VendorPrefix = css.VendorPrefix;
const PropertyId = css.css_properties.PropertyId;
const Property = css.css_properties.Property;

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
const Angle = css.css_values.angle.Angle;
const Url = css.css_values.url.Url;
const Percentage = css.css_values.percentage.Percentage;

const GenericBorder = css.css_properties.border.GenericBorder;
const LineStyle = css.css_properties.border.LineStyle;

/// A value for the [transform](https://www.w3.org/TR/2019/CR-css-transforms-1-20190214/#propdef-transform) property.
pub const TransformList = struct {
    v: ArrayList(Transform),

    pub fn parse(input: *css.Parser) Result(@This()) {
        if (input.tryParse(css.Parser.expectIdentMatching, .{"none"}).isOk()) {
            return .{ .result = .{ .v = .{} } };
        }

        input.skipWhitespace();
        var results = ArrayList(Transform){};
        switch (Transform.parse(input)) {
            .result => |first| results.append(input.allocator(), first) catch bun.outOfMemory(),
            .err => |e| return .{ .err = e },
        }

        while (true) {
            input.skipWhitespace();
            if (input.tryParse(Transform.parse, .{}).asValue()) |item| {
                results.append(input.allocator(), item) catch bun.outOfMemory();
            } else {
                return .{ .result = .{ .v = results } };
            }
        }
    }

    pub fn toCss(this: *const @This(), comptime W: type, dest: *Printer(W)) PrintErr!void {
        if (this.v.items.len == 0) {
            return dest.writeStr("none");
        }

        // TODO: Re-enable with a better solution
        //       See: https://github.com/parcel-bundler/lightningcss/issues/288
        if (dest.minify) {
            var base = ArrayList(u8){};
            const base_writer = base.writer(dest.allocator);
            const WW = @TypeOf(base_writer);

            var scratchbuf = std.ArrayList(u8).init(dest.allocator);
            defer scratchbuf.deinit();
            var p = Printer(WW).new(
                dest.allocator,
                scratchbuf,
                base_writer,
                css.PrinterOptions.defaultWithMinify(true),
                dest.import_records,
            );
            defer p.deinit();

            try this.toCssBase(WW, &p);

            return dest.writeStr(base.items);
        }

        return this.toCssBase(W, dest);
    }

    fn toCssBase(this: *const @This(), comptime W: type, dest: *Printer(W)) PrintErr!void {
        for (this.v.items) |*item| {
            try item.toCss(W, dest);
        }
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }

    pub fn eql(this: *const @This(), other: *const @This()) bool {
        return css.implementEql(@This(), this, other);
    }
};

/// An individual transform function (https://www.w3.org/TR/2019/CR-css-transforms-1-20190214/#two-d-transform-functions).
pub const Transform = union(enum) {
    /// A 2D translation.
    translate: struct {
        x: LengthPercentage,
        y: LengthPercentage,

        pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
            return css.implementDeepClone(@This(), this, allocator);
        }

        pub fn eql(this: *const @This(), other: *const @This()) bool {
            return css.implementEql(@This(), this, other);
        }
    },
    /// A translation in the X direction.
    translate_x: LengthPercentage,
    /// A translation in the Y direction.
    translate_y: LengthPercentage,
    /// A translation in the Z direction.
    translate_z: Length,
    /// A 3D translation.
    translate_3d: struct {
        x: LengthPercentage,
        y: LengthPercentage,
        z: Length,

        pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
            return css.implementDeepClone(@This(), this, allocator);
        }

        pub fn eql(this: *const @This(), other: *const @This()) bool {
            return css.implementEql(@This(), this, other);
        }
    },
    /// A 2D scale.
    scale: struct {
        x: NumberOrPercentage,
        y: NumberOrPercentage,

        pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
            return css.implementDeepClone(@This(), this, allocator);
        }

        pub fn eql(this: *const @This(), other: *const @This()) bool {
            return css.implementEql(@This(), this, other);
        }
    },
    /// A scale in the X direction.
    scale_x: NumberOrPercentage,
    /// A scale in the Y direction.
    scale_y: NumberOrPercentage,
    /// A scale in the Z direction.
    scale_z: NumberOrPercentage,
    /// A 3D scale.
    scale_3d: struct {
        x: NumberOrPercentage,
        y: NumberOrPercentage,
        z: NumberOrPercentage,

        pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
            return css.implementDeepClone(@This(), this, allocator);
        }

        pub fn eql(this: *const @This(), other: *const @This()) bool {
            return css.implementEql(@This(), this, other);
        }
    },
    /// A 2D rotation.
    rotate: Angle,
    /// A rotation around the X axis.
    rotate_x: Angle,
    /// A rotation around the Y axis.
    rotate_y: Angle,
    /// A rotation around the Z axis.
    rotate_z: Angle,
    /// A 3D rotation.
    rotate_3d: struct {
        x: f32,
        y: f32,
        z: f32,
        angle: Angle,

        pub fn eql(this: *const @This(), other: *const @This()) bool {
            return css.implementEql(@This(), this, other);
        }

        pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
            return css.implementDeepClone(@This(), this, allocator);
        }
    },
    /// A 2D skew.
    skew: struct {
        x: Angle,
        y: Angle,

        pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
            return css.implementDeepClone(@This(), this, allocator);
        }

        pub fn eql(this: *const @This(), other: *const @This()) bool {
            return css.implementEql(@This(), this, other);
        }
    },
    /// A skew along the X axis.
    skew_x: Angle,
    /// A skew along the Y axis.
    skew_y: Angle,
    /// A perspective transform.
    perspective: Length,
    /// A 2D matrix transform.
    matrix: Matrix(f32),
    /// A 3D matrix transform.
    matrix_3d: Matrix3d(f32),

    pub fn parse(input: *css.Parser) Result(Transform) {
        const function = switch (input.expectFunction()) {
            .result => |v| v,
            .err => |e| return .{ .err = e },
        };

        const Closure = struct { function: []const u8 };
        return input.parseNestedBlock(
            Transform,
            Closure{ .function = function },
            struct {
                fn parse(closure: Closure, i: *css.Parser) css.Result(Transform) {
                    const location = i.currentSourceLocation();
                    if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(closure.function, "matrix")) {
                        const a = switch (css.CSSNumberFns.parse(i)) {
                            .result => |v| v,
                            .err => |e| return .{ .err = e },
                        };
                        if (i.expectComma().asErr()) |e| return .{ .err = e };
                        const b = switch (css.CSSNumberFns.parse(i)) {
                            .result => |v| v,
                            .err => |e| return .{ .err = e },
                        };
                        if (i.expectComma().asErr()) |e| return .{ .err = e };
                        const c = switch (css.CSSNumberFns.parse(i)) {
                            .result => |v| v,
                            .err => |e| return .{ .err = e },
                        };
                        if (i.expectComma().asErr()) |e| return .{ .err = e };
                        const d = switch (css.CSSNumberFns.parse(i)) {
                            .result => |v| v,
                            .err => |e| return .{ .err = e },
                        };
                        if (i.expectComma().asErr()) |e| return .{ .err = e };
                        const e = switch (css.CSSNumberFns.parse(i)) {
                            .result => |v| v,
                            .err => |e| return .{ .err = e },
                        };
                        if (i.expectComma().asErr()) |ee| return .{ .err = ee };
                        const f = switch (css.CSSNumberFns.parse(i)) {
                            .result => |v| v,
                            .err => |ee| return .{ .err = ee },
                        };
                        return .{ .result = .{ .matrix = .{ .a = a, .b = b, .c = c, .d = d, .e = e, .f = f } } };
                    } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(closure.function, "matrix3d")) {
                        const m11 = switch (css.CSSNumberFns.parse(i)) {
                            .result => |v| v,
                            .err => |e| return .{ .err = e },
                        };
                        if (i.expectComma().asErr()) |e| return .{ .err = e };
                        const m12 = switch (css.CSSNumberFns.parse(i)) {
                            .result => |v| v,
                            .err => |e| return .{ .err = e },
                        };
                        if (i.expectComma().asErr()) |e| return .{ .err = e };
                        const m13 = switch (css.CSSNumberFns.parse(i)) {
                            .result => |v| v,
                            .err => |e| return .{ .err = e },
                        };
                        if (i.expectComma().asErr()) |e| return .{ .err = e };
                        const m14 = switch (css.CSSNumberFns.parse(i)) {
                            .result => |v| v,
                            .err => |e| return .{ .err = e },
                        };
                        if (i.expectComma().asErr()) |e| return .{ .err = e };
                        const m21 = switch (css.CSSNumberFns.parse(i)) {
                            .result => |v| v,
                            .err => |e| return .{ .err = e },
                        };
                        if (i.expectComma().asErr()) |e| return .{ .err = e };
                        const m22 = switch (css.CSSNumberFns.parse(i)) {
                            .result => |v| v,
                            .err => |e| return .{ .err = e },
                        };
                        if (i.expectComma().asErr()) |e| return .{ .err = e };
                        const m23 = switch (css.CSSNumberFns.parse(i)) {
                            .result => |v| v,
                            .err => |e| return .{ .err = e },
                        };
                        if (i.expectComma().asErr()) |e| return .{ .err = e };
                        const m24 = switch (css.CSSNumberFns.parse(i)) {
                            .result => |v| v,
                            .err => |e| return .{ .err = e },
                        };
                        if (i.expectComma().asErr()) |e| return .{ .err = e };
                        const m31 = switch (css.CSSNumberFns.parse(i)) {
                            .result => |v| v,
                            .err => |e| return .{ .err = e },
                        };
                        if (i.expectComma().asErr()) |e| return .{ .err = e };
                        const m32 = switch (css.CSSNumberFns.parse(i)) {
                            .result => |v| v,
                            .err => |e| return .{ .err = e },
                        };
                        if (i.expectComma().asErr()) |e| return .{ .err = e };
                        const m33 = switch (css.CSSNumberFns.parse(i)) {
                            .result => |v| v,
                            .err => |e| return .{ .err = e },
                        };
                        if (i.expectComma().asErr()) |e| return .{ .err = e };
                        const m34 = switch (css.CSSNumberFns.parse(i)) {
                            .result => |v| v,
                            .err => |e| return .{ .err = e },
                        };
                        if (i.expectComma().asErr()) |e| return .{ .err = e };
                        const m41 = switch (css.CSSNumberFns.parse(i)) {
                            .result => |v| v,
                            .err => |e| return .{ .err = e },
                        };
                        if (i.expectComma().asErr()) |e| return .{ .err = e };
                        const m42 = switch (css.CSSNumberFns.parse(i)) {
                            .result => |v| v,
                            .err => |e| return .{ .err = e },
                        };
                        if (i.expectComma().asErr()) |e| return .{ .err = e };
                        const m43 = switch (css.CSSNumberFns.parse(i)) {
                            .result => |v| v,
                            .err => |e| return .{ .err = e },
                        };
                        if (i.expectComma().asErr()) |e| return .{ .err = e };
                        const m44 = switch (css.CSSNumberFns.parse(i)) {
                            .result => |v| v,
                            .err => |e| return .{ .err = e },
                        };
                        return .{ .result = .{ .matrix_3d = .{
                            .m11 = m11,
                            .m12 = m12,
                            .m13 = m13,
                            .m14 = m14,
                            .m21 = m21,
                            .m22 = m22,
                            .m23 = m23,
                            .m24 = m24,
                            .m31 = m31,
                            .m32 = m32,
                            .m33 = m33,
                            .m34 = m34,
                            .m41 = m41,
                            .m42 = m42,
                            .m43 = m43,
                            .m44 = m44,
                        } } };
                    } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(closure.function, "translate")) {
                        const x = switch (LengthPercentage.parse(i)) {
                            .result => |v| v,
                            .err => |e| return .{ .err = e },
                        };
                        if (i.tryParse(struct {
                            fn parse(p: *css.Parser) css.Result(void) {
                                return p.expectComma();
                            }
                        }.parse, .{}).isOk()) {
                            const y = switch (LengthPercentage.parse(i)) {
                                .result => |v| v,
                                .err => |e| return .{ .err = e },
                            };
                            return .{ .result = .{ .translate = .{ .x = x, .y = y } } };
                        } else {
                            return .{ .result = .{ .translate = .{ .x = x, .y = LengthPercentage.zero() } } };
                        }
                    } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(closure.function, "translatex")) {
                        const x = switch (LengthPercentage.parse(i)) {
                            .result => |v| v,
                            .err => |e| return .{ .err = e },
                        };
                        return .{ .result = .{ .translate_x = x } };
                    } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(closure.function, "translatey")) {
                        const y = switch (LengthPercentage.parse(i)) {
                            .result => |v| v,
                            .err => |e| return .{ .err = e },
                        };
                        return .{ .result = .{ .translate_y = y } };
                    } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(closure.function, "translatez")) {
                        const z = switch (Length.parse(i)) {
                            .result => |v| v,
                            .err => |e| return .{ .err = e },
                        };
                        return .{ .result = .{ .translate_z = z } };
                    } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(closure.function, "translate3d")) {
                        const x = switch (LengthPercentage.parse(i)) {
                            .result => |v| v,
                            .err => |e| return .{ .err = e },
                        };
                        if (i.expectComma().asErr()) |e| return .{ .err = e };
                        const y = switch (LengthPercentage.parse(i)) {
                            .result => |v| v,
                            .err => |e| return .{ .err = e },
                        };
                        if (i.expectComma().asErr()) |e| return .{ .err = e };
                        const z = switch (Length.parse(i)) {
                            .result => |v| v,
                            .err => |e| return .{ .err = e },
                        };
                        return .{ .result = .{ .translate_3d = .{ .x = x, .y = y, .z = z } } };
                    } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(closure.function, "scale")) {
                        const x = switch (NumberOrPercentage.parse(i)) {
                            .result => |v| v,
                            .err => |e| return .{ .err = e },
                        };
                        if (i.tryParse(struct {
                            fn parse(p: *css.Parser) css.Result(void) {
                                return p.expectComma();
                            }
                        }.parse, .{}).isOk()) {
                            const y = switch (NumberOrPercentage.parse(i)) {
                                .result => |v| v,
                                .err => |e| return .{ .err = e },
                            };
                            return .{ .result = .{ .scale = .{ .x = x, .y = y } } };
                        } else {
                            return .{ .result = .{ .scale = .{ .x = x, .y = x.deepClone(i.allocator()) } } };
                        }
                    } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(closure.function, "scalex")) {
                        const x = switch (NumberOrPercentage.parse(i)) {
                            .result => |v| v,
                            .err => |e| return .{ .err = e },
                        };
                        return .{ .result = .{ .scale_x = x } };
                    } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(closure.function, "scaley")) {
                        const y = switch (NumberOrPercentage.parse(i)) {
                            .result => |v| v,
                            .err => |e| return .{ .err = e },
                        };
                        return .{ .result = .{ .scale_y = y } };
                    } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(closure.function, "scalez")) {
                        const z = switch (NumberOrPercentage.parse(i)) {
                            .result => |v| v,
                            .err => |e| return .{ .err = e },
                        };
                        return .{ .result = .{ .scale_z = z } };
                    } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(closure.function, "scale3d")) {
                        const x = switch (NumberOrPercentage.parse(i)) {
                            .result => |v| v,
                            .err => |e| return .{ .err = e },
                        };
                        if (i.expectComma().asErr()) |e| return .{ .err = e };
                        const y = switch (NumberOrPercentage.parse(i)) {
                            .result => |v| v,
                            .err => |e| return .{ .err = e },
                        };
                        if (i.expectComma().asErr()) |e| return .{ .err = e };
                        const z = switch (NumberOrPercentage.parse(i)) {
                            .result => |v| v,
                            .err => |e| return .{ .err = e },
                        };
                        return .{ .result = .{ .scale_3d = .{ .x = x, .y = y, .z = z } } };
                    } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(closure.function, "rotate")) {
                        const angle = switch (Angle.parseWithUnitlessZero(i)) {
                            .result => |v| v,
                            .err => |e| return .{ .err = e },
                        };
                        return .{ .result = .{ .rotate = angle } };
                    } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(closure.function, "rotatex")) {
                        const angle = switch (Angle.parseWithUnitlessZero(i)) {
                            .result => |v| v,
                            .err => |e| return .{ .err = e },
                        };
                        return .{ .result = .{ .rotate_x = angle } };
                    } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(closure.function, "rotatey")) {
                        const angle = switch (Angle.parseWithUnitlessZero(i)) {
                            .result => |v| v,
                            .err => |e| return .{ .err = e },
                        };
                        return .{ .result = .{ .rotate_y = angle } };
                    } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(closure.function, "rotatez")) {
                        const angle = switch (Angle.parseWithUnitlessZero(i)) {
                            .result => |v| v,
                            .err => |e| return .{ .err = e },
                        };
                        return .{ .result = .{ .rotate_z = angle } };
                    } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(closure.function, "rotate3d")) {
                        const x = switch (css.CSSNumberFns.parse(i)) {
                            .result => |v| v,
                            .err => |e| return .{ .err = e },
                        };
                        if (i.expectComma().asErr()) |e| return .{ .err = e };
                        const y = switch (css.CSSNumberFns.parse(i)) {
                            .result => |v| v,
                            .err => |e| return .{ .err = e },
                        };
                        if (i.expectComma().asErr()) |e| return .{ .err = e };
                        const z = switch (css.CSSNumberFns.parse(i)) {
                            .result => |v| v,
                            .err => |e| return .{ .err = e },
                        };
                        if (i.expectComma().asErr()) |e| return .{ .err = e };
                        const angle = switch (Angle.parseWithUnitlessZero(i)) {
                            .result => |v| v,
                            .err => |e| return .{ .err = e },
                        };
                        return .{ .result = .{ .rotate_3d = .{ .x = x, .y = y, .z = z, .angle = angle } } };
                    } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(closure.function, "skew")) {
                        const x = switch (Angle.parseWithUnitlessZero(i)) {
                            .result => |v| v,
                            .err => |e| return .{ .err = e },
                        };
                        if (i.tryParse(struct {
                            fn parse(p: *css.Parser) css.Result(void) {
                                return p.expectComma();
                            }
                        }.parse, .{}).isOk()) {
                            const y = switch (Angle.parseWithUnitlessZero(i)) {
                                .result => |v| v,
                                .err => |e| return .{ .err = e },
                            };
                            return .{ .result = .{ .skew = .{ .x = x, .y = y } } };
                        } else {
                            return .{ .result = .{ .skew = .{ .x = x, .y = Angle{ .deg = 0.0 } } } };
                        }
                    } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(closure.function, "skewx")) {
                        const angle = switch (Angle.parseWithUnitlessZero(i)) {
                            .result => |v| v,
                            .err => |e| return .{ .err = e },
                        };
                        return .{ .result = .{ .skew_x = angle } };
                    } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(closure.function, "skewy")) {
                        const angle = switch (Angle.parseWithUnitlessZero(i)) {
                            .result => |v| v,
                            .err => |e| return .{ .err = e },
                        };
                        return .{ .result = .{ .skew_y = angle } };
                    } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(closure.function, "perspective")) {
                        const len = switch (Length.parse(i)) {
                            .result => |v| v,
                            .err => |e| return .{ .err = e },
                        };
                        return .{ .result = .{ .perspective = len } };
                    } else {
                        return .{ .err = location.newUnexpectedTokenError(.{ .ident = closure.function }) };
                    }
                }
            }.parse,
        );
    }

    pub fn toCss(this: *const @This(), comptime W: type, dest: *Printer(W)) PrintErr!void {
        switch (this.*) {
            .translate => |t| {
                if (dest.minify and t.x.isZero() and !t.y.isZero()) {
                    try dest.writeStr("translateY(");
                    try t.y.toCss(W, dest);
                } else {
                    try dest.writeStr("translate(");
                    try t.x.toCss(W, dest);
                    if (!t.y.isZero()) {
                        try dest.delim(',', false);
                        try t.y.toCss(W, dest);
                    }
                }
                try dest.writeChar(')');
            },
            .translate_x => |x| {
                try dest.writeStr(if (dest.minify) "translate(" else "translateX(");
                try x.toCss(W, dest);
                try dest.writeChar(')');
            },
            .translate_y => |y| {
                try dest.writeStr("translateY(");
                try y.toCss(W, dest);
                try dest.writeChar(')');
            },
            .translate_z => |z| {
                try dest.writeStr("translateZ(");
                try z.toCss(W, dest);
                try dest.writeChar(')');
            },
            .translate_3d => |t| {
                if (dest.minify and !t.x.isZero() and t.y.isZero() and t.z.isZero()) {
                    try dest.writeStr("translate(");
                    try t.x.toCss(W, dest);
                } else if (dest.minify and t.x.isZero() and !t.y.isZero() and t.z.isZero()) {
                    try dest.writeStr("translateY(");
                    try t.y.toCss(W, dest);
                } else if (dest.minify and t.x.isZero() and t.y.isZero() and !t.z.isZero()) {
                    try dest.writeStr("translateZ(");
                    try t.z.toCss(W, dest);
                } else if (dest.minify and t.z.isZero()) {
                    try dest.writeStr("translate(");
                    try t.x.toCss(W, dest);
                    try dest.delim(',', false);
                    try t.y.toCss(W, dest);
                } else {
                    try dest.writeStr("translate3d(");
                    try t.x.toCss(W, dest);
                    try dest.delim(',', false);
                    try t.y.toCss(W, dest);
                    try dest.delim(',', false);
                    try t.z.toCss(W, dest);
                }
                try dest.writeChar(')');
            },
            .scale => |s| {
                const x: f32 = s.x.intoF32();
                const y: f32 = s.y.intoF32();
                if (dest.minify and x == 1.0 and y != 1.0) {
                    try dest.writeStr("scaleY(");
                    try css.CSSNumberFns.toCss(&y, W, dest);
                } else if (dest.minify and x != 1.0 and y == 1.0) {
                    try dest.writeStr("scaleX(");
                    try css.CSSNumberFns.toCss(&x, W, dest);
                } else {
                    try dest.writeStr("scale(");
                    try css.CSSNumberFns.toCss(&x, W, dest);
                    if (y != x) {
                        try dest.delim(',', false);
                        try css.CSSNumberFns.toCss(&y, W, dest);
                    }
                }
                try dest.writeChar(')');
            },
            .scale_x => |x| {
                try dest.writeStr("scaleX(");
                try css.CSSNumberFns.toCss(&x.intoF32(), W, dest);
                try dest.writeChar(')');
            },
            .scale_y => |y| {
                try dest.writeStr("scaleY(");
                try css.CSSNumberFns.toCss(&y.intoF32(), W, dest);
                try dest.writeChar(')');
            },
            .scale_z => |z| {
                try dest.writeStr("scaleZ(");
                try css.CSSNumberFns.toCss(&z.intoF32(), W, dest);
                try dest.writeChar(')');
            },
            .scale_3d => |s| {
                const x: f32 = s.x.intoF32();
                const y: f32 = s.y.intoF32();
                const z: f32 = s.z.intoF32();
                if (dest.minify and z == 1.0 and x == y) {
                    try dest.writeStr("scale(");
                    try css.CSSNumberFns.toCss(&x, W, dest);
                } else if (dest.minify and x != 1.0 and y == 1.0 and z == 1.0) {
                    try dest.writeStr("scaleX(");
                    try css.CSSNumberFns.toCss(&x, W, dest);
                } else if (dest.minify and x == 1.0 and y != 1.0 and z == 1.0) {
                    try dest.writeStr("scaleY(");
                    try css.CSSNumberFns.toCss(&y, W, dest);
                } else if (dest.minify and x == 1.0 and y == 1.0 and z != 1.0) {
                    try dest.writeStr("scaleZ(");
                    try css.CSSNumberFns.toCss(&z, W, dest);
                } else if (dest.minify and z == 1.0) {
                    try dest.writeStr("scale(");
                    try css.CSSNumberFns.toCss(&x, W, dest);
                    try dest.delim(',', false);
                    try css.CSSNumberFns.toCss(&y, W, dest);
                } else {
                    try dest.writeStr("scale3d(");
                    try css.CSSNumberFns.toCss(&x, W, dest);
                    try dest.delim(',', false);
                    try css.CSSNumberFns.toCss(&y, W, dest);
                    try dest.delim(',', false);
                    try css.CSSNumberFns.toCss(&z, W, dest);
                }
                try dest.writeChar(')');
            },
            .rotate => |angle| {
                try dest.writeStr("rotate(");
                try angle.toCssWithUnitlessZero(W, dest);
                try dest.writeChar(')');
            },
            .rotate_x => |angle| {
                try dest.writeStr("rotateX(");
                try angle.toCssWithUnitlessZero(W, dest);
                try dest.writeChar(')');
            },
            .rotate_y => |angle| {
                try dest.writeStr("rotateY(");
                try angle.toCssWithUnitlessZero(W, dest);
                try dest.writeChar(')');
            },
            .rotate_z => |angle| {
                try dest.writeStr(if (dest.minify) "rotate(" else "rotateZ(");
                try angle.toCssWithUnitlessZero(W, dest);
                try dest.writeChar(')');
            },
            .rotate_3d => |r| {
                if (dest.minify and r.x == 1.0 and r.y == 0.0 and r.z == 0.0) {
                    try dest.writeStr("rotateX(");
                    try r.angle.toCssWithUnitlessZero(W, dest);
                } else if (dest.minify and r.x == 0.0 and r.y == 1.0 and r.z == 0.0) {
                    try dest.writeStr("rotateY(");
                    try r.angle.toCssWithUnitlessZero(W, dest);
                } else if (dest.minify and r.x == 0.0 and r.y == 0.0 and r.z == 1.0) {
                    try dest.writeStr("rotate(");
                    try r.angle.toCssWithUnitlessZero(W, dest);
                } else {
                    try dest.writeStr("rotate3d(");
                    try css.CSSNumberFns.toCss(&r.x, W, dest);
                    try dest.delim(',', false);
                    try css.CSSNumberFns.toCss(&r.y, W, dest);
                    try dest.delim(',', false);
                    try css.CSSNumberFns.toCss(&r.z, W, dest);
                    try dest.delim(',', false);
                    try r.angle.toCssWithUnitlessZero(W, dest);
                }
                try dest.writeChar(')');
            },
            .skew => |s| {
                if (dest.minify and s.x.isZero() and !s.y.isZero()) {
                    try dest.writeStr("skewY(");
                    try s.y.toCssWithUnitlessZero(W, dest);
                } else {
                    try dest.writeStr("skew(");
                    try s.x.toCss(W, dest);
                    if (!s.y.isZero()) {
                        try dest.delim(',', false);
                        try s.y.toCssWithUnitlessZero(W, dest);
                    }
                }
                try dest.writeChar(')');
            },
            .skew_x => |angle| {
                try dest.writeStr(if (dest.minify) "skew(" else "skewX(");
                try angle.toCssWithUnitlessZero(W, dest);
                try dest.writeChar(')');
            },
            .skew_y => |angle| {
                try dest.writeStr("skewY(");
                try angle.toCssWithUnitlessZero(W, dest);
                try dest.writeChar(')');
            },
            .perspective => |len| {
                try dest.writeStr("perspective(");
                try len.toCss(W, dest);
                try dest.writeChar(')');
            },
            .matrix => |m| {
                try dest.writeStr("matrix(");
                try css.CSSNumberFns.toCss(&m.a, W, dest);
                try dest.delim(',', false);
                try css.CSSNumberFns.toCss(&m.b, W, dest);
                try dest.delim(',', false);
                try css.CSSNumberFns.toCss(&m.c, W, dest);
                try dest.delim(',', false);
                try css.CSSNumberFns.toCss(&m.d, W, dest);
                try dest.delim(',', false);
                try css.CSSNumberFns.toCss(&m.e, W, dest);
                try dest.delim(',', false);
                try css.CSSNumberFns.toCss(&m.f, W, dest);
                try dest.writeChar(')');
            },
            .matrix_3d => |m| {
                try dest.writeStr("matrix3d(");
                try css.CSSNumberFns.toCss(&m.m11, W, dest);
                try dest.delim(',', false);
                try css.CSSNumberFns.toCss(&m.m12, W, dest);
                try dest.delim(',', false);
                try css.CSSNumberFns.toCss(&m.m13, W, dest);
                try dest.delim(',', false);
                try css.CSSNumberFns.toCss(&m.m14, W, dest);
                try dest.delim(',', false);
                try css.CSSNumberFns.toCss(&m.m21, W, dest);
                try dest.delim(',', false);
                try css.CSSNumberFns.toCss(&m.m22, W, dest);
                try dest.delim(',', false);
                try css.CSSNumberFns.toCss(&m.m23, W, dest);
                try dest.delim(',', false);
                try css.CSSNumberFns.toCss(&m.m24, W, dest);
                try dest.delim(',', false);
                try css.CSSNumberFns.toCss(&m.m31, W, dest);
                try dest.delim(',', false);
                try css.CSSNumberFns.toCss(&m.m32, W, dest);
                try dest.delim(',', false);
                try css.CSSNumberFns.toCss(&m.m33, W, dest);
                try dest.delim(',', false);
                try css.CSSNumberFns.toCss(&m.m34, W, dest);
                try dest.delim(',', false);
                try css.CSSNumberFns.toCss(&m.m41, W, dest);
                try dest.delim(',', false);
                try css.CSSNumberFns.toCss(&m.m42, W, dest);
                try dest.delim(',', false);
                try css.CSSNumberFns.toCss(&m.m43, W, dest);
                try dest.delim(',', false);
                try css.CSSNumberFns.toCss(&m.m44, W, dest);
                try dest.writeChar(')');
            },
        }
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }

    pub fn eql(this: *const @This(), other: *const @This()) bool {
        return css.implementEql(@This(), this, other);
    }
};

/// A 2D matrix.
pub fn Matrix(comptime T: type) type {
    return struct {
        a: T,
        b: T,
        c: T,
        d: T,
        e: T,
        f: T,

        pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
            return css.implementDeepClone(@This(), this, allocator);
        }

        pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
            return css.implementEql(@This(), lhs, rhs);
        }
    };
}

/// A 3D matrix.
pub fn Matrix3d(comptime T: type) type {
    return struct {
        m11: T,
        m12: T,
        m13: T,
        m14: T,
        m21: T,
        m22: T,
        m23: T,
        m24: T,
        m31: T,
        m32: T,
        m33: T,
        m34: T,
        m41: T,
        m42: T,
        m43: T,
        m44: T,

        pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
            return css.implementEql(@This(), lhs, rhs);
        }
    };
}

/// A value for the [transform-style](https://drafts.csswg.org/css-transforms-2/#transform-style-property) property.
pub const TransformStyle = enum {
    flat,
    @"preserve-3d",
    pub usingnamespace css.DefineEnumProperty(@This());
};

/// A value for the [transform-box](https://drafts.csswg.org/css-transforms-1/#transform-box) property.
pub const TransformBox = enum {
    /// Uses the content box as reference box.
    @"content-box",
    /// Uses the border box as reference box.
    @"border-box",
    /// Uses the object bounding box as reference box.
    @"fill-box",
    /// Uses the stroke bounding box as reference box.
    @"stroke-box",
    /// Uses the nearest SVG viewport as reference box.
    @"view-box",

    pub usingnamespace css.DefineEnumProperty(@This());
};

/// A value for the [backface-visibility](https://drafts.csswg.org/css-transforms-2/#backface-visibility-property) property.
pub const BackfaceVisibility = enum {
    visible,
    hidden,

    pub usingnamespace css.DefineEnumProperty(@This());
};

/// A value for the perspective property.
pub const Perspective = union(enum) {
    /// No perspective transform is applied.
    none,
    /// Distance to the center of projection.
    length: Length,

    pub usingnamespace css.DeriveParse(@This());
    pub usingnamespace css.DeriveToCss(@This());

    pub fn eql(this: *const @This(), other: *const @This()) bool {
        return css.implementEql(@This(), this, other);
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }
};

/// A value for the [translate](https://drafts.csswg.org/css-transforms-2/#propdef-translate) property.
pub const Translate = union(enum) {
    /// The "none" keyword.
    none,

    /// The x, y, and z translations.
    xyz: struct {
        /// The x translation.
        x: LengthPercentage,
        /// The y translation.
        y: LengthPercentage,
        /// The z translation.
        z: Length,

        pub fn __generateDeepClone() void {}

        pub fn eql(this: *const @This(), other: *const @This()) bool {
            return css.implementEql(@This(), this, other);
        }
    },

    pub fn parse(input: *css.Parser) css.Result(@This()) {
        if (input.tryParse(css.Parser.expectIdentMatching, .{"none"}).isOk()) {
            return .{ .result = .none };
        }

        const x = switch (LengthPercentage.parse(input)) {
            .result => |v| v,
            .err => |e| return .{ .err = e },
        };
        const y = input.tryParse(LengthPercentage.parse, .{});
        const z = if (y.isOk()) input.tryParse(Length.parse, .{}).asValue() else null;

        return .{
            .result = Translate{
                .xyz = .{
                    .x = x,
                    .y = y.unwrapOr(comptime LengthPercentage.zero()),
                    .z = z orelse Length.zero(),
                },
            },
        };
    }

    pub fn toCss(this: *const @This(), comptime W: type, dest: *css.Printer(W)) PrintErr!void {
        switch (this.*) {
            .none => try dest.writeStr("none"),
            .xyz => |xyz| {
                try xyz.x.toCss(W, dest);
                if (!xyz.y.isZero() or !xyz.z.isZero()) {
                    try dest.writeChar(' ');
                    try xyz.y.toCss(W, dest);
                    if (!xyz.z.isZero()) {
                        try dest.writeChar(' ');
                        try xyz.z.toCss(W, dest);
                    }
                }
            },
        }
        return;
    }

    pub fn toTransform(this: *const @This(), allocator: std.mem.Allocator) Transform {
        return switch (this.*) {
            .none => .{ .translate_3d = .{
                .x = LengthPercentage.zero(),
                .y = LengthPercentage.zero(),
                .z = Length.zero(),
            } },
            .xyz => |xyz| .{ .translate_3d = .{
                .x = xyz.x.deepClone(allocator),
                .y = xyz.y.deepClone(allocator),
                .z = xyz.z.deepClone(allocator),
            } },
        };
    }

    pub fn eql(this: *const @This(), other: *const @This()) bool {
        return css.implementEql(@This(), this, other);
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }
};

/// A value for the [rotate](https://drafts.csswg.org/css-transforms-2/#propdef-rotate) property.
pub const Rotate = struct {
    /// Rotation around the x axis.
    x: f32,
    /// Rotation around the y axis.
    y: f32,
    /// Rotation around the z axis.
    z: f32,
    /// The angle of rotation.
    angle: Angle,

    pub fn parse(input: *css.Parser) css.Result(@This()) {
        if (input.tryParse(css.Parser.expectIdentMatching, .{"none"}).isOk()) {
            return .{ .result = .{
                .x = 0.0,
                .y = 0.0,
                .z = 1.0,
                .angle = .{ .deg = 0.0 },
            } };
        }

        const angle = input.tryParse(Angle.parse, .{});

        const XYZ = struct { x: f32, y: f32, z: f32 };
        const xyz = switch (input.tryParse(struct {
            fn parse(i: *css.Parser) css.Result(XYZ) {
                const location = i.currentSourceLocation();
                const ident = switch (i.expectIdent()) {
                    .result => |v| v,
                    .err => |e| return .{ .err = e },
                };
                if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(ident, "x")) {
                    return .{ .result = .{ .x = 1.0, .y = 0.0, .z = 0.0 } };
                } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(ident, "y")) {
                    return .{ .result = .{ .x = 0.0, .y = 1.0, .z = 0.0 } };
                } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(ident, "z")) {
                    return .{ .result = .{ .x = 0.0, .y = 0.0, .z = 1.0 } };
                }
                return .{ .err = location.newUnexpectedTokenError(.{ .ident = ident }) };
            }
        }.parse, .{})) {
            .result => |v| v,
            .err => input.tryParse(struct {
                fn parse(i: *css.Parser) css.Result(XYZ) {
                    const x = switch (css.CSSNumberFns.parse(i)) {
                        .result => |v| v,
                        .err => |e| return .{ .err = e },
                    };
                    const y = switch (css.CSSNumberFns.parse(i)) {
                        .result => |v| v,
                        .err => |e| return .{ .err = e },
                    };
                    const z = switch (css.CSSNumberFns.parse(i)) {
                        .result => |v| v,
                        .err => |e| return .{ .err = e },
                    };
                    return .{ .result = .{ .x = x, .y = y, .z = z } };
                }
            }.parse, .{}).unwrapOr(.{ .x = 0.0, .y = 0.0, .z = 1.0 }),
        };

        const final_angle = switch (angle) {
            .result => |v| v,
            .err => switch (Angle.parse(input)) {
                .result => |v| v,
                .err => |e| return .{ .err = e },
            },
        };

        return .{ .result = .{
            .x = xyz.x,
            .y = xyz.y,
            .z = xyz.z,
            .angle = final_angle,
        } };
    }

    pub fn toCss(this: *const @This(), comptime W: type, dest: *css.Printer(W)) PrintErr!void {
        if (this.x == 0.0 and this.y == 0.0 and this.z == 1.0 and this.angle.isZero()) {
            try dest.writeStr("none");
            return;
        }

        if (this.x == 1.0 and this.y == 0.0 and this.z == 0.0) {
            try dest.writeStr("x ");
        } else if (this.x == 0.0 and this.y == 1.0 and this.z == 0.0) {
            try dest.writeStr("y ");
        } else if (!(this.x == 0.0 and this.y == 0.0 and this.z == 1.0)) {
            try css.CSSNumberFns.toCss(&this.x, W, dest);
            try dest.writeChar(' ');
            try css.CSSNumberFns.toCss(&this.y, W, dest);
            try dest.writeChar(' ');
            try css.CSSNumberFns.toCss(&this.z, W, dest);
            try dest.writeChar(' ');
        }

        try this.angle.toCss(W, dest);
    }

    /// Converts the rotation to a transform function.
    pub fn toTransform(this: *const @This(), allocator: std.mem.Allocator) Transform {
        return .{ .rotate_3d = .{
            .x = this.x,
            .y = this.y,
            .z = this.z,
            .angle = this.angle.deepClone(allocator),
        } };
    }

    pub fn eql(this: *const @This(), other: *const @This()) bool {
        return css.implementEql(@This(), this, other);
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }
};

/// A value for the [scale](https://drafts.csswg.org/css-transforms-2/#propdef-scale) property.
pub const Scale = union(enum) {
    /// The "none" keyword.
    none,

    /// Scale on the x, y, and z axis.
    xyz: struct {
        /// Scale on the x axis.
        x: NumberOrPercentage,
        /// Scale on the y axis.
        y: NumberOrPercentage,
        /// Scale on the z axis.
        z: NumberOrPercentage,

        pub fn __generateDeepClone() void {}

        pub fn eql(this: *const @This(), other: *const @This()) bool {
            return css.implementEql(@This(), this, other);
        }
    },

    pub fn parse(input: *css.Parser) css.Result(@This()) {
        if (input.tryParse(css.Parser.expectIdentMatching, .{"none"}).isOk()) {
            return .{ .result = .none };
        }

        const x = switch (NumberOrPercentage.parse(input)) {
            .result => |v| v,
            .err => |e| return .{ .err = e },
        };

        const y = input.tryParse(NumberOrPercentage.parse, .{});
        const z = if (y.isOk()) input.tryParse(NumberOrPercentage.parse, .{}).asValue() else null;

        return .{ .result = .{ .xyz = .{
            .x = x,
            .y = if (y.asValue()) |val| val else x,
            .z = if (z) |val| val else .{ .number = 1.0 },
        } } };
    }

    pub fn toCss(this: *const @This(), comptime W: type, dest: *css.Printer(W)) PrintErr!void {
        switch (this.*) {
            .none => try dest.writeStr("none"),
            .xyz => |xyz| {
                try xyz.x.toCss(W, dest);
                const z_val = xyz.z.intoF32();
                if (!xyz.y.eql(&xyz.x) or z_val != 1.0) {
                    try dest.writeChar(' ');
                    try xyz.y.toCss(W, dest);
                    if (z_val != 1.0) {
                        try dest.writeChar(' ');
                        try xyz.z.toCss(W, dest);
                    }
                }
            },
        }
    }

    pub fn toTransform(this: *const @This(), allocator: std.mem.Allocator) Transform {
        return switch (this.*) {
            .none => .{ .scale_3d = .{
                .x = .{ .number = 1.0 },
                .y = .{ .number = 1.0 },
                .z = .{ .number = 1.0 },
            } },
            .xyz => |xyz| .{ .scale_3d = .{
                .x = xyz.x.deepClone(allocator),
                .y = xyz.y.deepClone(allocator),
                .z = xyz.z.deepClone(allocator),
            } },
        };
    }

    pub fn eql(this: *const @This(), other: *const @This()) bool {
        return css.implementEql(@This(), this, other);
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }
};

pub const TransformHandler = struct {
    transform: ?struct { TransformList, VendorPrefix } = null,
    translate: ?Translate = null,
    rotate: ?Rotate = null,
    scale: ?Scale = null,
    has_any: bool = false,

    pub fn handleProperty(
        this: *@This(),
        property: *const css.Property,
        dest: *css.DeclarationList,
        context: *css.PropertyHandlerContext,
    ) bool {
        const individualProperty = struct {
            fn individualProperty(self: *TransformHandler, allocator: std.mem.Allocator, comptime field: []const u8, val: anytype) void {
                if (self.transform) |*transform| {
                    transform.*[0].v.append(allocator, val.toTransform(allocator)) catch bun.outOfMemory();
                } else {
                    @field(self, field) = val.deepClone(allocator);
                    self.has_any = true;
                }
            }
        }.individualProperty;
        const allocator = context.allocator;

        switch (property.*) {
            .transform => |val| {
                const transform_val = val[0];
                const vp = val[1];

                // If two vendor prefixes for the same property have different
                // values, we need to flush what we have immediately to preserve order.
                if (this.transform) |current| {
                    if (!current[0].eql(&transform_val) and !current[1].contains(vp)) {
                        this.flush(allocator, dest, context);
                    }
                }

                // Otherwise, update the value and add the prefix.
                if (this.transform) |*transform| {
                    transform.* = .{ transform_val.deepClone(allocator), transform.*[1].bitwiseOr(vp) };
                } else {
                    this.transform = .{ transform_val.deepClone(allocator), vp };
                    this.has_any = true;
                }

                this.translate = null;
                this.rotate = null;
                this.scale = null;
            },
            .translate => |val| individualProperty(this, allocator, "translate", val),
            .rotate => |val| individualProperty(this, allocator, "rotate", val),
            .scale => |val| individualProperty(this, allocator, "scale", val),
            .unparsed => |unparsed| {
                if (unparsed.property_id == .transform or
                    unparsed.property_id == .translate or
                    unparsed.property_id == .rotate or
                    unparsed.property_id == .scale)
                {
                    this.flush(allocator, dest, context);
                    const prop = if (unparsed.property_id == .transform)
                        Property{ .unparsed = unparsed.getPrefixed(allocator, context.targets, css.prefixes.Feature.transform) }
                    else
                        property.deepClone(allocator);
                    dest.append(allocator, prop) catch bun.outOfMemory();
                } else return false;
            },
            else => return false,
        }

        return true;
    }

    pub fn finalize(this: *@This(), dest: *css.DeclarationList, context: *css.PropertyHandlerContext) void {
        this.flush(context.allocator, dest, context);
    }

    fn flush(this: *@This(), allocator: std.mem.Allocator, dest: *css.DeclarationList, context: *css.PropertyHandlerContext) void {
        if (!this.has_any) return;

        this.has_any = false;

        const transform = bun.take(&this.transform);
        const translate = bun.take(&this.translate);
        const rotate = bun.take(&this.rotate);
        const scale = bun.take(&this.scale);

        if (transform) |t| {
            const prefix = context.targets.prefixes(t[1], css.prefixes.Feature.transform);
            dest.append(allocator, Property{ .transform = .{ t[0], prefix } }) catch bun.outOfMemory();
        }

        if (translate) |t| {
            dest.append(allocator, Property{ .translate = t }) catch bun.outOfMemory();
        }

        if (rotate) |r| {
            dest.append(allocator, Property{ .rotate = r }) catch bun.outOfMemory();
        }

        if (scale) |s| {
            dest.append(allocator, Property{ .scale = s }) catch bun.outOfMemory();
        }
    }
};
