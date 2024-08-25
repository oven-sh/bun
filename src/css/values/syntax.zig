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

// https://drafts.csswg.org/css-syntax-3/#whitespace
const SPACE_CHARACTERS: []const u8 = &.{ 0x20, 0x09 };

/// A CSS [syntax string](https://drafts.css-houdini.org/css-properties-values-api/#syntax-strings)
/// used to define the grammar for a registered custom property.
pub const SyntaxString = union(enum) {
    /// A list of syntax components.
    components: ArrayList(SyntaxComponent),
    /// The universal syntax definition.
    universal,

    const This = @This();

    pub fn toCss(this: *const This, comptime W: type, dest: *Printer(W)) PrintErr!void {
        try dest.writeChar('"');
        switch (this.*) {
            .universal => try dest.writeChar('*'),
            .components => |*components| {
                var first = true;
                for (components.items) |*component| {
                    if (first) {
                        first = false;
                    } else {
                        try dest.delim('|', true);
                    }

                    try component.toCss(W, dest);
                }
            },
        }

        return dest.writeChar('"');
    }

    pub fn parse(input: *css.Parser) Error!SyntaxString {
        const string = input.expectString();
        return SyntaxString.parseString(string) catch return input.newCustomError(css.ParserError.invalid_value);
    }

    /// Parses a syntax string.
    pub fn parseString(input: []const u8) !SyntaxString {
        // https://drafts.css-houdini.org/css-properties-values-api/#parsing-syntax
        var trimmed_input = std.mem.trimLeft(u8, input, SPACE_CHARACTERS);
        if (trimmed_input.len == 0) {
            @compileError(css.todo_stuff.errors);
        }

        if (bun.strings.eqlComptime(u8, trimmed_input, "*")) {
            return SyntaxString.universal;
        }

        var components = ArrayList(SyntaxComponent){};

        while (true) {
            const component = try SyntaxComponent.parseString(&trimmed_input);
            try components.append(
                @compileError(css.todo_stuff.think_about_allocator),
                component,
            );

            trimmed_input = std.mem.trimLeft(u8, trimmed_input, &std.ascii.spaces);
            if (trimmed_input.len == 0) {
                break;
            }

            if (bun.strings.startsWithChar(trimmed_input, '|')) {
                trimmed_input = trimmed_input[1..];
                continue;
            }

            @compileError(css.todo_stuff.errors);
        }

        return SyntaxString{ .components = components };
    }

    /// Parses a value according to the syntax grammar.
    pub fn parseValue(this: *SyntaxString, input: *css.Parser) Error!ParsedComponent {
        switch (this.*) {
            .universal => return ParsedComponent{
                .token_list = try css.css_properties.custom.TokenList.parse(
                    input,
                    &css.ParserOptions.default(),
                    0,
                ),
            },
            .components => |components| {
                // Loop through each component, and return the first one that parses successfully.
                for (components.items) |component| {
                    const state = input.state();
                    var parsed = ArrayList(ParsedComponent){};

                    while (true) {
                        const value_result = input.tryParse(struct {
                            fn parse(i: *css.Parser) Error!ParsedComponent {
                                return switch (component.kind) {
                                    .length => ParsedComponent{ .length = try Length.parse(i) },
                                    .number => ParsedComponent{ .number = try CSSNumberFns.parse(i) },
                                    .percentage => ParsedComponent{ .percentage = try Percentage.parse(i) },
                                    .length_percentage => ParsedComponent{ .length_percentage = try LengthPercentage.parse(i) },
                                    .color => ParsedComponent{ .color = try CssColor.parse(i) },
                                    .image => ParsedComponent{ .image = try Image.parse(i) },
                                    .url => ParsedComponent{ .url = try Url.parse(i) },
                                    .integer => ParsedComponent{ .integer = try CSSIntegerFns.parse(i) },
                                    .angle => ParsedComponent{ .angle = try Angle.parse(i) },
                                    .time => ParsedComponent{ .time = try Time.parse(i) },
                                    .resolution => ParsedComponent{ .resolution = try Resolution.parse(i) },
                                    .transform_function => ParsedComponent{ .transform_function = try css.css_properties.transform.Transform.parse(i) },
                                    .transform_list => ParsedComponent{ .transform_list = try css.css_properties.transform.TransformList.parse(i) },
                                    .custom_ident => ParsedComponent{ .custom_ident = try CustomIdentFns.parse(i) },
                                    .literal => |value| blk: {
                                        const location = i.currentSourceLocation();
                                        const ident = try i.expectIdent();
                                        if (!bun.strings.eql(ident, value)) {
                                            return location.newUnexpectedTokenError(.{ .ident = ident });
                                        }
                                        break :blk ParsedComponent{ .literal = ident };
                                    },
                                };
                            }
                        }.parse, .{});

                        if (value_result) |value| {
                            switch (component.multiplier) {
                                .none => return value,
                                .space => {
                                    try parsed.append(value);
                                    if (input.isExhausted()) {
                                        return ParsedComponent{ .repeated = .{
                                            .components = parsed,
                                            .multiplier = component.multiplier,
                                        } };
                                    }
                                },
                                .comma => {
                                    try parsed.append(value);
                                    if (input.next()) |token| {
                                        if (token == .comma) continue;
                                        break;
                                    } else {
                                        return ParsedComponent{ .repeated = .{
                                            .components = parsed,
                                            .multiplier = component.multiplier,
                                        } };
                                    }
                                },
                            }
                        } else {
                            break;
                        }
                    }

                    input.reset(&state);
                }

                return input.newErrorForNextToken();
            },
        }
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

    pub fn parseString(input: []const u8) !SyntaxComponent {
        const kind = try SyntaxComponentKind.parseString(input);

        // Pre-multiplied types cannot have multipliers.
        if (kind == .transform_list) {
            return SyntaxComponent{
                .kind = kind,
                .multiplier = .none,
            };
        }

        var multiplier: Multiplier = .none;
        if (bun.strings.startsWithChar(input, '+')) {
            input = input[1..];
            multiplier = .space;
        } else if (bun.strings.startsWithChar(input, '#')) {
            input = input[1..];
            multiplier = .comma;
        }

        return SyntaxComponent{ .kind = kind, .multiplier = multiplier };
    }

    pub fn toCss(this: *const SyntaxComponent, comptime W: type, dest: *Printer(W)) PrintErr!void {
        try this.kind.toCss(W, dest);
        return switch (this.multiplier) {
            .none => {},
            .comma => dest.writeChar('#'),
            .space => dest.writeChar('+'),
        };
    }
};

/// A [syntax component component name](https://drafts.css-houdini.org/css-properties-values-api/#supported-names).
pub const SyntaxComponentKind = union(enum) {
    /// A `<length>` component.
    length,
    /// A `<number>` component.
    number,
    /// A `<percentage>` component.
    percentage,
    /// A `<length-percentage>` component.
    length_percentage,
    /// A `<color>` component.
    color,
    /// An `<image>` component.
    image,
    /// A `<url>` component.
    url,
    /// An `<integer>` component.
    integer,
    /// An `<angle>` component.
    angle,
    /// A `<time>` component.
    time,
    /// A `<resolution>` component.
    resolution,
    /// A `<transform-function>` component.
    transform_function,
    /// A `<transform-list>` component.
    transform_list,
    /// A `<custom-ident>` component.
    custom_ident,
    /// A literal component.
    literal: []const u8,

    pub fn parseString(input_: []const u8) Error!SyntaxComponentKind {
        // https://drafts.css-houdini.org/css-properties-values-api/#consume-syntax-component
        var input = std.mem.trimLeft(u8, input_, SPACE_CHARACTERS);
        if (bun.strings.startsWithChar(input, '<')) {
            // https://drafts.css-houdini.org/css-properties-values-api/#consume-data-type-name
            const end_idx = std.mem.indexOfScalar(u8, input, '>') orelse @compileError(css.todo_stuff.errors);
            const name = input[1..end_idx];
            // todo_stuff.match_ignore_ascii_case
            const component = if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name, "length"))
                .length
            else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name, "number"))
                .number
            else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name, "percentage"))
                .percentage
            else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name, "length-percentage"))
                .length_percentage
            else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name, "color"))
                .color
            else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name, "image"))
                .image
            else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name, "url"))
                .url
            else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name, "integer"))
                .integer
            else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name, "angle"))
                .angle
            else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name, "time"))
                .time
            else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name, "resolution"))
                .resolution
            else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name, "transform-function"))
                .transform_function
            else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name, "transform-list"))
                .transform_list
            else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name, "custom-ident"))
                .custom_ident
            else
                @compileError(css.todo_stuff.errors);

            input = input[end_idx + 1 ..];
            return component;
        } else if (input.len > 0 and isIdentStart(input[0])) {
            // A literal.
            var end_idx: usize = 0;
            while (end_idx < input.len and
                isNameCodePoint(input[end_idx])) : (end_idx +=
                bun.strings.utf8ByteSequenceLengthUnsafe(input[end_idx]))
            {}
            const literal = input[0..end_idx];
            input = input[end_idx..];
            return SyntaxComponentKind{ .literal = literal };
        } else {
            @compileError(css.todo_stuff.errors);
        }
    }

    pub fn toCss(this: *const SyntaxComponentKind, comptime W: type, dest: *Printer(W)) PrintErr!void {
        return switch (this.*) {
            .length => try dest.writeStr("<length>"),
            .number => try dest.writeStr("<number>"),
            .percentage => try dest.writeStr("<percentage>"),
            .length_percentage => try dest.writeStr("<length-percentage>"),
            .color => try dest.writeStr("<color>"),
            .image => try dest.writeStr("<image>"),
            .url => try dest.writeStr("<url>"),
            .integer => try dest.writeStr("<integer>"),
            .angle => try dest.writeStr("<angle>"),
            .time => try dest.writeStr("<time>"),
            .resolution => try dest.writeStr("<resolution>"),
            .transform_function => try dest.writeStr("<transform-function>"),
            .transform_list => try dest.writeStr("<transform-list>"),
            .custom_ident => try dest.writeStr("<custom-ident>"),
            .literal => |l| try dest.writeStr(l),
        };
    }

    fn isIdentStart(c: u8) bool {
        // https://drafts.csswg.org/css-syntax-3/#ident-start-code-point
        return c >= 'A' and c <= 'Z' or c >= 'a' and c <= 'z' or c >= 0x80 or c == '_';
    }

    fn isNameCodePoint(c: u8) bool {
        // https://drafts.csswg.org/css-syntax-3/#ident-code-point
        return isIdentStart(c) or c >= '0' and c <= '9' or c == '-';
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
        return switch (this.*) {
            .length => |*v| try v.toCss(W, dest),
            .number => |*v| try CSSNumberFns.toCss(v, W, dest),
            .percentage => |*v| try v.toCss(W, dest),
            .length_percentage => |*v| try v.toCss(W, dest),
            .color => |*v| try v.toCss(W, dest),
            .image => |*v| try v.toCss(W, dest),
            .url => |*v| try v.toCss(W, dest),
            .integer => |*v| try v.toCss(W, dest),
            .angle => |*v| try v.toCss(W, dest),
            .time => |*v| try v.toCss(W, dest),
            .resolution => |*v| try v.toCss(W, dest),
            .transform_function => |*v| try v.toCss(W, dest),
            .transform_list => |*v| try v.toCss(W, dest),
            .custom_ident => |*v| try CustomIdentFns.toCss(v, W, dest),
            .literal => |*v| try css.serializer.serializeIdentifier(v.*, W, dest),
            .repeated => |*r| {
                var first = true;
                for (r.components.items) |*component| {
                    if (!first) {
                        switch (r.multiplier) {
                            .comma => try dest.delim(',', false),
                            .space => try dest.writeChar(' '),
                            .none => unreachable,
                        }
                    } else {
                        first = false;
                    }
                    try component.toCss(W, dest);
                }
            },
            .token_list => |*t| try t.toCss(W, dest, false),
        };
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
