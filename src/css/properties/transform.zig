const std = @import("std");
const bun = @import("root").bun;
const Allocator = std.mem.Allocator;
const ArrayList = std.ArrayListUnmanaged;

pub const css = @import("../css_parser.zig");

const SmallList = css.SmallList;
const Printer = css.Printer;
const PrintErr = css.PrintErr;
const Result = css.Result;

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
    }

    fn toCssBase(this: *const @This(), comptime W: type, dest: *Printer(W)) PrintErr!void {
        for (this.v.items) |*item| {
            try item.toCss(W, dest);
        }
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
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
    },
    /// A 2D scale.
    scale: struct {
        x: NumberOrPercentage,
        y: NumberOrPercentage,

        pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
            return css.implementDeepClone(@This(), this, allocator);
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
    };
}

/// A value for the [transform-style](https://drafts.csswg.org/css-transforms-2/#transform-style-property) property.
pub const TransformStyle = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

/// A value for the [transform-box](https://drafts.csswg.org/css-transforms-1/#transform-box) property.
pub const TransformBox = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

/// A value for the [backface-visibility](https://drafts.csswg.org/css-transforms-2/#backface-visibility-property) property.
pub const BackfaceVisibility = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

/// A value for the perspective property.
pub const Perspective = union(enum) {
    /// No perspective transform is applied.
    none,
    /// Distance to the center of projection.
    length: Length,
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
    },
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
    },
};
