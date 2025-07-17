const std = @import("std");
const ArrayList = std.ArrayListUnmanaged;

pub const css = @import("../css_parser.zig");

const CustomIdent = css.css_values.ident.CustomIdent;
const CSSString = css.css_values.string.CSSString;
const Image = css.css_values.image.Image;

/// A value for the [list-style-type](https://www.w3.org/TR/2020/WD-css-lists-3-20201117/#text-markers) property.
pub const ListStyleType = union(enum) {
    /// No marker.
    none,
    /// An explicit marker string.
    string: CSSString,
    /// A named counter style.
    counter_style: CounterStyle,
};

/// A [counter-style](https://www.w3.org/TR/css-counter-styles-3/#typedef-counter-style) name.
pub const CounterStyle = union(enum) {
    /// A predefined counter style name.
    predefined: PredefinedCounterStyle,
    /// A custom counter style name.
    name: CustomIdent,
    /// An inline `symbols()` definition.
    symbols: Symbols,

    const Symbols = struct {
        /// The counter system.
        system: SymbolsType,
        /// The symbols.
        symbols: ArrayList(Symbol),
    };
};

/// A single [symbol](https://www.w3.org/TR/css-counter-styles-3/#funcdef-symbols) as used in the
/// `symbols()` function.
///
/// See [CounterStyle](CounterStyle).
const Symbol = union(enum) {
    /// A string.
    string: CSSString,
    /// An image.
    image: Image,
};

/// A [predefined counter](https://www.w3.org/TR/css-counter-styles-3/#predefined-counters) style.
pub const PredefinedCounterStyle = @compileError(css.todo_stuff.depth);

/// A [`<symbols-type>`](https://www.w3.org/TR/css-counter-styles-3/#typedef-symbols-type) value,
/// as used in the `symbols()` function.
///
/// See [CounterStyle](CounterStyle).
pub const SymbolsType = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

/// A value for the [list-style-position](https://www.w3.org/TR/2020/WD-css-lists-3-20201117/#list-style-position-property) property.
pub const ListStylePosition = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

/// A value for the [list-style](https://www.w3.org/TR/2020/WD-css-lists-3-20201117/#list-style-property) shorthand property.
pub const ListStyle = @compileError(css.todo_stuff.depth);

/// A value for the [marker-side](https://www.w3.org/TR/2020/WD-css-lists-3-20201117/#marker-side) property.
pub const MarkerSide = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));
