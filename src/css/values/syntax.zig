const std = @import("std");
const bun = @import("root").bun;
pub const css = @import("../css_parser.zig");
const Error = css.Error;
const ArrayList = std.ArrayListUnmanaged;
const Printer = css.Printer;
const PrintErr = css.PrintErr;
const CSSNumber = css.css_values.number.CSSNumber;
const CSSNumberFns = css.css_values.number.CSSNumberFns;
const Calc = css.css_values.calc.Calc;
const DimensionPercentage = css.css_values.percentage.DimensionPercentage;
const LengthPercentage = css.css_values.length.LengthPercentage;
const Length = css.css_values.length.Length;
const Percentage = css.css_values.percentage.Percentage;
const CssColor = css.css_values.color.CssColor;
const Image = css.css_values.image.Image;
const Url = css.css_values.url.Url;
const CSSInteger = css.css_values.number.CSSInteger;
const CSSIntegerFns = css.css_values.number.CSSIntegerFns;
const Angle = css.css_values.angle.Angle;
const Time = css.css_values.time.Time;
const Resolution = css.css_values.resolution.Resolution;
const CustomIdent = css.css_values.ident.CustomIdent;
const CustomIdentFns = css.css_values.ident.CustomIdentFns;
const Ident = css.css_values.ident.Ident;

/// A CSS [syntax string](https://drafts.css-houdini.org/css-properties-values-api/#syntax-strings)
/// used to define the grammar for a registered custom property.
pub const SyntaxString = union(enum) {
    /// A list of syntax components.
    components: ArrayList(SyntaxComponent),
    /// The universal syntax definition.
    universal,

    const This = @This();

    pub fn toCss(this: *const This, comptime W: type, dest: *Printer(W)) PrintErr!void {
        _ = this; // autofix
        _ = dest; // autofix
        @compileError(css.todo_stuff.depth);
    }

    pub fn parse(input: *css.Parser) Error!SyntaxString {
        _ = input; // autofix
        @compileError(css.todo_stuff.depth);
    }

    /// Parses a value according to the syntax grammar.
    pub fn parseValue(this: *SyntaxString, input: *css.Parser) Error!ParsedComponent {
        _ = this; // autofix
        _ = input; // autofix
        @compileError(css.todo_stuff.depth);
    }
};

/// A [syntax component](https://drafts.css-houdini.org/css-properties-values-api/#syntax-component)
/// within a [SyntaxString](SyntaxString).
///
/// A syntax component consists of a component kind an a multiplier, which indicates how the component
/// may repeat during parsing.
pub const SyntaxComponent = struct {
    kind: SyntaxComponentKind,
    multiplier: Multiplier,
};

pub const SyntaxComponentKind = union(enum) {
    comptime {
        @compileError(css.todo_stuff.depth);
    }
};

pub const ParsedComponent = union(enum) {
    /// A `<length>` value.
    length: Length,
    /// A `<number>` value.
    number: CSSNumber,
    /// A `<percentage>` value.
    percentage: Percentage,
    /// A `<length-percentage>` value.
    length_percentage: LengthPercentage,
    /// A `<color>` value.
    color: CssColor,
    /// An `<image>` value.
    image: Image, // Zig doesn't have lifetimes, so 'i is omitted.
    /// A `<url>` value.
    url: Url, // Lifetimes are omitted in Zig.
    /// An `<integer>` value.
    integer: CSSInteger,
    /// An `<angle>` value.
    angle: Angle,
    /// A `<time>` value.
    time: Time,
    /// A `<resolution>` value.
    resolution: Resolution,
    /// A `<transform-function>` value.
    transform_function: css.css_properties.transform.Transform,
    /// A `<transform-list>` value.
    transform_list: css.css_properties.transform.TransformList,
    /// A `<custom-ident>` value.
    custom_ident: CustomIdent,
    /// A literal value.
    literal: Ident,
    /// A repeated component value.
    repeated: struct {
        /// The components to repeat.
        components: ArrayList(ParsedComponent),
        /// A multiplier describing how the components repeat.
        multiplier: Multiplier,
    },
    /// A raw token stream.
    token_list: css.css_properties.custom.TokenList,

    const This = @This();

    pub fn toCss(this: *const This, comptime W: type, dest: *Printer(W)) PrintErr!void {
        _ = this; // autofix
        _ = dest; // autofix
        @compileError(css.todo_stuff.depth);
    }
};

/// A [multiplier](https://drafts.css-houdini.org/css-properties-values-api/#multipliers) for a
/// [SyntaxComponent](SyntaxComponent). Indicates whether and how the component may be repeated.
pub const Multiplier = enum {
    /// The component may not be repeated.
    none,
    /// The component may repeat one or more times, separated by spaces.
    space,
    /// The component may repeat one or more times, separated by commas.
    comma,
};
