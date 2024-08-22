const std = @import("std");
const bun = @import("root").bun;
pub const css = @import("../css_parser.zig");
const Error = css.Error;
const ArrayList = std.ArrayListUnmanaged;
const Printer = css.Printer;
const PrintErr = css.PrintErr;

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
