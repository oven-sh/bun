use crate::css_values::ident::CustomIdent;
use crate::css_values::image::Image;
use crate::css_values::string::CssString;

/// A value for the [list-style-type](https://www.w3.org/TR/2020/WD-css-lists-3-20201117/#text-markers) property.
pub enum ListStyleType<'bump> {
    /// No marker.
    None,
    /// An explicit marker string.
    String(CssString),
    /// A named counter style.
    CounterStyle(CounterStyle<'bump>),
}

/// A [counter-style](https://www.w3.org/TR/css-counter-styles-3/#typedef-counter-style) name.
pub enum CounterStyle<'bump> {
    /// A predefined counter style name.
    Predefined(PredefinedCounterStyle),
    /// A custom counter style name.
    Name(CustomIdent),
    /// An inline `symbols()` definition.
    Symbols(Symbols<'bump>),
}

pub struct Symbols<'bump> {
    /// The counter system.
    pub system: SymbolsType,
    /// The symbols.
    pub symbols: bumpalo::collections::Vec<'bump, Symbol>,
}

/// A single [symbol](https://www.w3.org/TR/css-counter-styles-3/#funcdef-symbols) as used in the
/// `symbols()` function.
///
/// See [CounterStyle](CounterStyle).
enum Symbol {
    /// A string.
    String(CssString),
    /// An image.
    Image(Image),
}

/// A [predefined counter](https://www.w3.org/TR/css-counter-styles-3/#predefined-counters) style.
// TODO(port): Zig source is `@compileError(css.todo_stuff.depth)` — unimplemented upstream
pub enum PredefinedCounterStyle {}

/// A [`<symbols-type>`](https://www.w3.org/TR/css-counter-styles-3/#typedef-symbols-type) value,
/// as used in the `symbols()` function.
///
/// See [CounterStyle](CounterStyle).
// TODO(port): Zig source is `css.DefineEnumProperty(@compileError(css.todo_stuff.depth))` — unimplemented upstream
pub enum SymbolsType {}

/// A value for the [list-style-position](https://www.w3.org/TR/2020/WD-css-lists-3-20201117/#list-style-position-property) property.
// TODO(port): Zig source is `css.DefineEnumProperty(@compileError(css.todo_stuff.depth))` — unimplemented upstream
pub enum ListStylePosition {}

/// A value for the [list-style](https://www.w3.org/TR/2020/WD-css-lists-3-20201117/#list-style-property) shorthand property.
// TODO(port): Zig source is `@compileError(css.todo_stuff.depth)` — unimplemented upstream
pub struct ListStyle;

/// A value for the [marker-side](https://www.w3.org/TR/2020/WD-css-lists-3-20201117/#marker-side) property.
// TODO(port): Zig source is `css.DefineEnumProperty(@compileError(css.todo_stuff.depth))` — unimplemented upstream
pub enum MarkerSide {}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/properties/list.zig (64 lines)
//   confidence: medium
//   todos:      5
//   notes:      5 types are @compileError stubs upstream (css.todo_stuff.depth) — left as empty enums/unit struct; 'bump lifetime threaded for arena Vec per AST-crate rule
// ──────────────────────────────────────────────────────────────────────────
