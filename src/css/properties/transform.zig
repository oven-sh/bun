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
        _ = input; // autofix
        @panic(css.todo_stuff.depth);
    }

    pub fn toCss(this: *const @This(), comptime W: type, dest: *Printer(W)) PrintErr!void {
        _ = this; // autofix
        _ = dest; // autofix
        @panic(css.todo_stuff.depth);
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
        _ = input; // autofix
        @panic(css.todo_stuff.depth);
    }

    pub fn toCss(this: *const @This(), comptime W: type, dest: *Printer(W)) PrintErr!void {
        _ = this; // autofix
        _ = dest; // autofix
        @panic(css.todo_stuff.depth);
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
