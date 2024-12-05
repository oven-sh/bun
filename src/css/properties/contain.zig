const std = @import("std");
const bun = @import("root").bun;
const Allocator = std.mem.Allocator;
const ArrayList = std.ArrayListUnmanaged;

pub const css = @import("../css_parser.zig");

const SmallList = css.SmallList;
const Printer = css.Printer;
const PrintErr = css.PrintErr;

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

const ContainerIdent = ContainerName;

/// A value for the [container-type](https://drafts.csswg.org/css-contain-3/#container-type) property.
/// Establishes the element as a query container for the purpose of container queries.
pub const ContainerType = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

/// A value for the [container-name](https://drafts.csswg.org/css-contain-3/#container-name) property.
pub const ContainerNameList = union(enum) {
    /// The `none` keyword.
    none,
    /// A list of container names.
    names: SmallList(ContainerIdent, 1),
};

/// A value for the [container](https://drafts.csswg.org/css-contain-3/#container-shorthand) shorthand property.
pub const Container = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));
