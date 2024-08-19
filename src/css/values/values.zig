const std = @import("std");
const bun = @import("root").bun;
pub const css = @import("../css_parser.zig");
const Error = css.Error;
const ArrayList = std.ArrayListUnmanaged;
const Printer = css.Printer;
const PrintErr = css.PrintErr;

pub const css_modules = struct {
    /// Defines where the class names referenced in the `composes` property are located.
    ///
    /// See [Composes](Composes).
    pub const Specifier = union(enum) {
        /// The referenced name is global.
        global,
        /// The referenced name comes from the specified file.
        file: []const u8,
        /// The referenced name comes from a source index (used during bundling).
        source_index: u32,
    };
};

pub const angle = struct {
    const CSSNumber = number.CSSNumber;
    /// A CSS [`<angle>`](https://www.w3.org/TR/css-values-4/#angles) value.
    ///
    /// Angles may be explicit or computed by `calc()`, but are always stored and serialized
    /// as their computed value.
    pub const Angle = union(enum) {
        /// An angle in degrees. There are 360 degrees in a full circle.
        deg: CSSNumber,
        /// An angle in radians. There are 2π radians in a full circle.
        rad: CSSNumber,
        /// An angle in gradians. There are 400 gradians in a full circle.
        grad: CSSNumber,
        /// An angle in turns. There is 1 turn in a full circle.
        turn: CSSNumber,

        pub fn parse(input: *css.Parser) Error!Angle {
            _ = input; // autofix
            @compileError(css.todo_stuff.depth);
        }

        // ~toCssImpl
        const This = @This();

        pub fn toCss(this: *const This, comptime W: type, dest: *Printer(W)) PrintErr!void {
            _ = this; // autofix
            _ = dest; // autofix
            @compileError(css.todo_stuff.depth);
        }

        pub fn tryFromToken(token: *const css.Token) Error!Angle {
            if (token.* == .dimension) {
                const value = token.dimension.num;
                const unit = token.dimension.unit;
                if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(unit, "deg")) {
                    return .{ .deg = value };
                } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(unit, "grad")) {
                    return .{ .grad = value };
                } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(unit, "turn")) {
                    return .{ .turn = value };
                } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(unit, "rad")) {
                    return .{ .rad = value };
                }
            }
            @compileError(css.todo_stuff.errors);
        }
    };
};

pub const ident = struct {
    pub usingnamespace @import("./ident.zig");
};

pub const string = struct {
    pub usingnamespace @import("./css_string.zig");
};

pub const color = struct {
    pub usingnamespace @import("./color.zig");
};

pub const image = struct {
    pub usingnamespace @import("./image.zig");
};

pub const number = struct {
    pub const CSSNumber = f32;
    pub const CSSNumberFns = struct {
        pub fn parse(input: *css.Parser) Error!CSSNumber {
            if (input.tryParse(calc.Calc(f32).parse, .{})) |calc_value| {
                switch (calc_value) {
                    .value => |v| return v.*,
                    .number => |n| return n,
                    // Numbers are always compatible, so they will always compute to a value.
                    else => return input.newCustomError(css.ParserError.invalid_value),
                }
            }

            const num = try input.expectNumber();
            return num;
        }

        pub fn toCss(this: *const @This(), comptime W: type, dest: *Printer(W)) PrintErr!void {
            _ = this; // autofix
            _ = dest; // autofix
            @compileError(css.todo_stuff.depth);
        }
    };

    /// A CSS [`<integer>`](https://www.w3.org/TR/css-values-4/#integers) value.
    pub const CSSInteger = i32;
    pub const CSSIntegerFns = struct {
        pub fn parse(input: *css.Parser) Error!CSSInteger {
            // TODO: calc??
            const integer = try input.expectInteger();
            return integer;
        }
        pub fn toCss(this: *const @This(), comptime W: type, dest: *Printer(W)) PrintErr!void {
            try css.to_css.integer(i32, this.*, W, dest);
        }
    };
};

pub const calc = struct {
    const CSSNumber = css.css_values.number.CSSNumber;
    /// A mathematical expression used within the `calc()` function.
    ///
    /// This type supports generic value types. Values such as `Length`, `Percentage`,
    /// `Time`, and `Angle` support `calc()` expressions.
    pub fn Calc(comptime V: type) type {
        return union(enum) {
            /// A literal value.
            value: *V,
            /// A literal number.
            number: CSSNumber,
            /// A sum of two calc expressions.
            sum: struct {
                left: *Calc(V),
                right: *Calc(V),
            },
            /// A product of a number and another calc expression.
            product: struct {
                number: CSSNumber,
                expression: *Calc(V),
            },
            /// A math function, such as `calc()`, `min()`, or `max()`.
            function: *MathFunction(V),

            const This = @This();

            // TODO: users of this and `parseWith` don't need the pointer and often throwaway heap allocated values immediately
            // use temp allocator or something?
            pub fn parse(input: *css.Parser) Error!This {
                _ = input; // autofix
                @compileError(css.todo_stuff.depth);
            }

            pub fn parseWith(
                input: *css.Parser,
                closure: anytype,
                comptime parse_ident: *const fn (@TypeOf(closure), []const u8) Error!This,
            ) Error!This {
                _ = parse_ident; // autofix
                _ = input; // autofix
                @compileError(css.todo_stuff.depth);
            }
        };
    }

    /// A CSS math function.
    ///
    /// Math functions may be used in most properties and values that accept numeric
    /// values, including lengths, percentages, angles, times, etc.
    pub fn MathFunction(comptime V: type) type {
        return union(enum) {
            /// The `calc()` function.
            calc: Calc(V),
            /// The `min()` function.
            min: ArrayList(Calc(V)),
            /// The `max()` function.
            max: ArrayList(Calc(V)),
            /// The `clamp()` function.
            clamp: struct {
                min: Calc(V),
                center: Calc(V),
                max: Calc(V),
            },
            /// The `round()` function.
            round: struct {
                strategy: RoundingStrategy,
                value: Calc(V),
                interval: Calc(V),
            },
            /// The `rem()` function.
            rem: struct {
                dividend: Calc(V),
                divisor: Calc(V),
            },
            /// The `mod()` function.
            mod_: struct {
                dividend: Calc(V),
                divisor: Calc(V),
            },
            /// The `abs()` function.
            abs: Calc(V),
            /// The `sign()` function.
            sign: Calc(V),
            /// The `hypot()` function.
            hypot: ArrayList(Calc(V)),
        };
    }

    /// A [rounding strategy](https://www.w3.org/TR/css-values-4/#typedef-rounding-strategy),
    /// as used in the `round()` function.
    pub const RoundingStrategy = css.DefineEnumProperty(@compileError(css.todo_stuff.enum_property));
};

pub const percentage = struct {
    pub const Percentage = struct {
        v: number.CSSNumber,

        pub fn parse(input: *css.Parser) Error!Percentage {
            if (input.tryParse(calc.Calc(Percentage), .{})) |calc_value| {
                if (calc_value == .value) |v| return v.*;
                // Percentages are always compatible, so they will always compute to a value.
                bun.unreachablePanic("Percentages are always compatible, so they will always compute to a value.", .{});
            }

            const percent = try input.expectPercentage();
            return Percentage{ .v = percent };
        }

        pub fn toCss(this: *const @This(), comptime W: type, dest: *Printer(W)) PrintErr!void {
            _ = this; // autofix
            _ = dest; // autofix
            @compileError(css.todo_stuff.depth);
        }
    };

    pub fn DimensionPercentage(comptime D: type) type {
        return union(enum) {
            dimension: D,
            percentage: Percentage,
            calc: *calc.Calc(DimensionPercentage(D)),
        };
    }

    /// Either a `<number>` or `<percentage>`.
    pub const NumberOrPercentage = union(enum) {
        /// A number.
        number: number.CSSNumber,
        /// A percentage.
        percentage: Percentage,
    };
};

pub const length = struct {
    /// Either a [`<length>`](https://www.w3.org/TR/css-values-4/#lengths) or a [`<number>`](https://www.w3.org/TR/css-values-4/#numbers).
    pub const LengthOrNumber = union(enum) {
        /// A number.
        number: number.CSSNumber,
        /// A length.
        length: Length,
    };

    pub const LengthPercentage = percentage.DimensionPercentage(LengthValue);
    /// Either a [`<length-percentage>`](https://www.w3.org/TR/css-values-4/#typedef-length-percentage), or the `auto` keyword.
    pub const LengthPercentageOrAuto = union(enum) {
        /// The `auto` keyword.
        auto,
        /// A [`<length-percentage>`](https://www.w3.org/TR/css-values-4/#typedef-length-percentage).
        length: LengthPercentage,
    };

    pub const LengthValue = struct {
        pub usingnamespace css.DefineLengthUnits(@This());

        pub fn tryFromToken(token: *const css.Token) Error!@This() {
            _ = token; // autofix
            @compileError(css.todo_stuff.depth);
        }

        pub fn toUnitValue(this: *const @This()) struct { number.CSSNumber, []const u8 } {
            _ = this; // autofix
            @compileError(css.todo_stuff.depth);
        }
    };

    /// A CSS [`<length>`](https://www.w3.org/TR/css-values-4/#lengths) value, with support for `calc()`.
    pub const Length = union(enum) {
        /// An explicitly specified length value.
        value: LengthValue,
        /// A computed length value using `calc()`.
        calc: *calc.Calc(Length),

        pub fn parse(input: *css.Parser) Error!Length {
            if (input.tryParse(calc.Calc(Length).parse, .{})) |calc_value| {
                // PERF: I don't like this redundant allocation
                if (calc_value == .value) return .{ .calc = calc_value.value.* };
                return .{
                    .calc = bun.create(
                        @compileError(css.todo_stuff.think_about_allocator),
                        calc.Calc(Length),
                        calc_value,
                    ),
                };
            }

            const len = try LengthValue.parse(input);
            return .{ .value = len };
        }
    };
};

pub const position = struct {
    pub fn PositionComponent(comptime S: type) type {
        return union(enum) {
            center,
            length,
            side: struct {
                side: S,
                offset: ?length.LengthPercentage,
            },
        };
    }

    pub const HorizontalPositionKeyword = css.DefineEnumProperty(struct {
        comptime {
            @compileError(css.todo_stuff.depth);
        }
    });

    pub const VerticalPositionKeyword = css.DefineEnumProperty(struct {
        comptime {
            @compileError(css.todo_stuff.depth);
        }
    });

    pub const HorizontalPosition = PositionComponent(HorizontalPositionKeyword);
    pub const VerticalPosition = PositionComponent(VerticalPositionKeyword);
};

pub const syntax = struct {
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
        length: length.Length,
        /// A `<number>` value.
        number: number.CSSNumber,
        /// A `<percentage>` value.
        percentage: percentage.Percentage,
        /// A `<length-percentage>` value.
        length_percentage: length.LengthPercentage,
        /// A `<color>` value.
        color: color.CssColor,
        /// An `<image>` value.
        image: image.Image, // Zig doesn't have lifetimes, so 'i is omitted.
        /// A `<url>` value.
        url: url.Url, // Lifetimes are omitted in Zig.
        /// An `<integer>` value.
        integer: number.CSSInteger,
        /// An `<angle>` value.
        angle: angle.Angle,
        /// A `<time>` value.
        time: time.Time,
        /// A `<resolution>` value.
        resolution: resolution.Resolution,
        /// A `<transform-function>` value.
        transform_function: css.css_properties.transform.Transform,
        /// A `<transform-list>` value.
        transform_list: css.css_properties.transform.TransformList,
        /// A `<custom-ident>` value.
        custom_ident: ident.CustomIdent,
        /// A literal value.
        literal: ident.Ident,
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
};

pub const alpha = struct {
    pub const AlphaValue = struct {
        comptime {
            @compileError(css.todo_stuff.depth);
        }
    };
};

pub const ratio = struct {
    /// A CSS [`<ratio>`](https://www.w3.org/TR/css-values-4/#ratios) value,
    /// representing the ratio of two numeric values.
    pub const Ratio = struct {
        numerator: number.CSSNumber,
        denominator: number.CSSNumber,
    };
};

pub const size = struct {
    /// A generic value that represents a value with two components, e.g. a border radius.
    ///
    /// When serialized, only a single component will be written if both are equal.
    pub fn Size2D(comptime T: type) type {
        return struct {
            a: T,
            b: T,

            pub fn parse(input: *css.Parser) Error!Size2D(T) {
                _ = input; // autofix
                @compileError(css.todo_stuff.depth);
            }
        };
    }
};

pub const rect = struct {
    /// A generic value that represents a value for four sides of a box,
    /// e.g. border-width, margin, padding, etc.
    ///
    /// When serialized, as few components as possible are written when
    /// there are duplicate values.
    pub fn Rect(comptime T: type) type {
        return struct {
            /// The top component.
            top: T,
            /// The right component.
            right: T,
            /// The bottom component.
            bottom: T,
            /// The left component.
            left: T,
        };
    }
};

pub const time = struct {
    const CSSNumber = number.CSSNumber;

    /// A CSS [`<time>`](https://www.w3.org/TR/css-values-4/#time) value, in either
    /// seconds or milliseconds.
    ///
    /// Time values may be explicit or computed by `calc()`, but are always stored and serialized
    /// as their computed value.
    pub const Time = union(enum) {
        /// A time in seconds.
        seconds: CSSNumber,
        /// A time in milliseconds.
        milliseconds: CSSNumber,

        pub fn tryFromToken(token: *const css.Token) Error!Time {
            _ = token; // autofix
            @compileError(css.todo_stuff.depth);
        }
    };
};

pub const easing = struct {
    const CSSNumber = number.CSSNumber;
    const CSSInteger = number.CSSInteger;

    /// A CSS [easing function](https://www.w3.org/TR/css-easing-1/#easing-functions).
    pub const EasingFunction = union(enum) {
        /// A linear easing function.
        linear,
        /// Equivalent to `cubic-bezier(0.25, 0.1, 0.25, 1)`.
        ease,
        /// Equivalent to `cubic-bezier(0.42, 0, 1, 1)`.
        ease_in,
        /// Equivalent to `cubic-bezier(0, 0, 0.58, 1)`.
        ease_out,
        /// Equivalent to `cubic-bezier(0.42, 0, 0.58, 1)`.
        ease_in_out,
        /// A custom cubic Bézier easing function.
        cubic_bezier: struct {
            /// The x-position of the first point in the curve.
            x1: CSSNumber,
            /// The y-position of the first point in the curve.
            y1: CSSNumber,
            /// The x-position of the second point in the curve.
            x2: CSSNumber,
            /// The y-position of the second point in the curve.
            y2: CSSNumber,
        },
        /// A step easing function.
        steps: struct {
            /// The number of intervals in the function.
            count: CSSInteger,
            /// The step position.
            position: StepPosition = StepPosition.default,
        },
    };

    /// A [step position](https://www.w3.org/TR/css-easing-1/#step-position), used within the `steps()` function.
    pub const StepPosition = enum {
        /// The first rise occurs at input progress value of 0.
        start,
        /// The last rise occurs at input progress value of 1.
        end,
        /// All rises occur within the range (0, 1).
        jump_none,
        /// The first rise occurs at input progress value of 0 and the last rise occurs at input progress value of 1.
        jump_both,
    };
};

pub const url = struct {
    /// A CSS [url()](https://www.w3.org/TR/css-values-4/#urls) value and its source location.
    pub const Url = struct {
        /// The url string.
        url: []const u8,
        /// The location where the `url()` was seen in the CSS source file.
        loc: css.Location,

        pub fn parse(input: *css.Parser) Error!Url {
            _ = input; // autofix
            @compileError(css.todo_stuff.depth);
        }

        const This = @This();

        /// Returns whether the URL is absolute, and not relative.
        pub fn isAbsolute(this: *const This) bool {
            _ = this; // autofix

            @compileError(css.todo_stuff.depth);
        }

        pub fn toCss(
            this: *const This,
            comptime W: type,
            dest: *Printer(W),
        ) PrintErr!void {
            _ = this; // autofix
            _ = dest; // autofix
            @compileError(css.todo_stuff.depth);
        }
    };
};

pub const resolution = struct {
    const CSSNumber = number.CSSNumber;

    /// A CSS `<resolution>` value.
    pub const Resolution = union(enum) {
        /// A resolution in dots per inch.
        dpi: CSSNumber,
        /// A resolution in dots per centimeter.
        dpcm: CSSNumber,
        /// A resolution in dots per px.
        dppx: CSSNumber,

        pub fn parse(input: *css.Parser) Error!Resolution {
            // TODO: calc?
            const location = input.currentSourceLocation();
            const tok = try input.next();
            if (tok.* == .dimension) {
                const value = tok.dimension.num.value;
                const unit = tok.dimension.unit;
                // css.todo_stuff.match_ignore_ascii_case
                if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(unit, "dpi")) return .{ .dpi = value };
                if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(unit, "dpcm")) return .{ .dpcm = value };
                if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(unit, "dppx") or bun.strings.eqlCaseInsensitiveASCIIICheckLength(unit, "x")) return .{ .dppx = value };
                return location.newUnexpectedTokenError(.{ .ident = unit });
            }
            return location.newUnexpectedTokenError(tok.*);
        }

        pub fn tryFromToken(token: *const css.Token) Error!Resolution {
            _ = token; // autofix
            @compileError(css.todo_stuff.depth);
        }

        // ~toCssImpl
        const This = @This();

        pub fn toCss(this: *const This, comptime W: type, dest: *Printer(W)) PrintErr!void {
            _ = this; // autofix
            _ = dest; // autofix
            @compileError(css.todo_stuff.depth);
        }
    };
};
