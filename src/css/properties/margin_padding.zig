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
const Angle = css.css_values.angle.Angle;
const Url = css.css_values.url.Url;

/// A value for the [inset-block](https://drafts.csswg.org/css-logical/#propdef-inset-block) shorthand property.
pub const InsetBlock = @compileError(css.todo_stuff.depth);
/// A value for the [inset-inline](https://drafts.csswg.org/css-logical/#propdef-inset-inline) shorthand property.
pub const InsetInline = @compileError(css.todo_stuff.depth);
/// A value for the [inset](https://drafts.csswg.org/css-logical/#propdef-inset) shorthand property.
pub const Inline = @compileError(css.todo_stuff.depth);

/// A value for the [margin-block](https://drafts.csswg.org/css-logical/#propdef-margin-block) shorthand property.
pub const MarginBlock = @compileError(css.todo_stuff.depth);

/// A value for the [margin-inline](https://drafts.csswg.org/css-logical/#propdef-margin-inline) shorthand property.
pub const MarginInline = @compileError(css.todo_stuff.depth);

/// A value for the [margin](https://drafts.csswg.org/css-box-4/#propdef-margin) shorthand property.
pub const Margin = @compileError(css.todo_stuff.depth);

/// A value for the [padding-block](https://drafts.csswg.org/css-logical/#propdef-padding-block) shorthand property.
pub const PaddingBlock = @compileError(css.todo_stuff.depth);

/// A value for the [padding-inline](https://drafts.csswg.org/css-logical/#propdef-padding-inline) shorthand property.
pub const PaddingInline = @compileError(css.todo_stuff.depth);

/// A value for the [padding](https://drafts.csswg.org/css-box-4/#propdef-padding) shorthand property.
pub const Padding = @compileError(css.todo_stuff.depth);

/// A value for the [scroll-margin-block](https://drafts.csswg.org/css-scroll-snap/#propdef-scroll-margin-block) shorthand property.
pub const ScrollMarginBlock = @compileError(css.todo_stuff.depth);

/// A value for the [scroll-margin-inline](https://drafts.csswg.org/css-scroll-snap/#propdef-scroll-margin-inline) shorthand property.
pub const ScrollMarginInline = @compileError(css.todo_stuff.depth);

/// A value for the [scroll-margin](https://drafts.csswg.org/css-scroll-snap/#scroll-margin) shorthand property.
pub const ScrollMargin = @compileError(css.todo_stuff.depth);

/// A value for the [scroll-padding-block](https://drafts.csswg.org/css-scroll-snap/#propdef-scroll-padding-block) shorthand property.
pub const ScrollPaddingBlock = @compileError(css.todo_stuff.depth);

/// A value for the [scroll-padding-inline](https://drafts.csswg.org/css-scroll-snap/#propdef-scroll-padding-inline) shorthand property.
pub const ScrollPaddingInline = @compileError(css.todo_stuff.depth);

/// A value for the [scroll-padding](https://drafts.csswg.org/css-scroll-snap/#scroll-padding) shorthand property.
pub const ScrollPadding = @compileError(css.todo_stuff.depth);
