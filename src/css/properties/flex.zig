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

/// A value for the [flex-direction](https://www.w3.org/TR/2018/CR-css-flexbox-1-20181119/#propdef-flex-direction) property.
pub const FlexDirection = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

/// A value for the [flex-wrap](https://www.w3.org/TR/2018/CR-css-flexbox-1-20181119/#flex-wrap-property) property.
pub const FlexWrap = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

/// A value for the [flex-flow](https://www.w3.org/TR/2018/CR-css-flexbox-1-20181119/#flex-flow-property) shorthand property.
pub const FlexFlow = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

/// A value for the [flex](https://www.w3.org/TR/2018/CR-css-flexbox-1-20181119/#flex-property) shorthand property.
pub const Flex = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

/// A value for the legacy (prefixed) [box-orient](https://www.w3.org/TR/2009/WD-css3-flexbox-20090723/#orientation) property.
/// Partially equivalent to `flex-direction` in the standard syntax.
pub const BoxOrient = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

/// A value for the legacy (prefixed) [box-orient](https://www.w3.org/TR/2009/WD-css3-flexbox-20090723/#orientation) property.
/// Partially equivalent to `flex-direction` in the standard syntax.
pub const BoxDirection = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

/// A value for the legacy (prefixed) [box-align](https://www.w3.org/TR/2009/WD-css3-flexbox-20090723/#alignment) property.
/// Equivalent to the `align-items` property in the standard syntax.
pub const BoxAlign = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

/// A value for the legacy (prefixed) [box-pack](https://www.w3.org/TR/2009/WD-css3-flexbox-20090723/#packing) property.
/// Equivalent to the `justify-content` property in the standard syntax.
pub const BoxPack = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

/// A value for the legacy (prefixed) [box-lines](https://www.w3.org/TR/2009/WD-css3-flexbox-20090723/#multiple) property.
/// Equivalent to the `flex-wrap` property in the standard syntax.
pub const BoxLines = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

// Old flex (2012): https://www.w3.org/TR/2012/WD-css3-flexbox-20120322/
/// A value for the legacy (prefixed) [flex-pack](https://www.w3.org/TR/2012/WD-css3-flexbox-20120322/#flex-pack) property.
/// Equivalent to the `justify-content` property in the standard syntax.
pub const FlexPack = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

/// A value for the legacy (prefixed) [flex-item-align](https://www.w3.org/TR/2012/WD-css3-flexbox-20120322/#flex-align) property.
/// Equivalent to the `align-self` property in the standard syntax.
pub const FlexItemAlign = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

/// A value for the legacy (prefixed) [flex-line-pack](https://www.w3.org/TR/2012/WD-css3-flexbox-20120322/#flex-line-pack) property.
/// Equivalent to the `align-content` property in the standard syntax.
pub const FlexLinePack = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));
