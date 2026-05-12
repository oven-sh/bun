#![allow(unused_imports, dead_code)]
#![warn(unused_must_use)]
use crate as css;

use css::css_properties::Property;
use css::{PrintErr, Printer, PropertyHandlerContext, SmallList};

use css::css_values::color::CssColor;
#[allow(unused_imports)]
use css::css_values::ident::DashedIdent;
use css::css_values::number::CSSNumber;
use css::css_values::url::Url;

use bun_alloc::Arena; // bumpalo::Bump re-export (CSS is an arena crate)

bitflags::bitflags! {
    /// A value for the [color-scheme](https://drafts.csswg.org/css-color-adjust/#color-scheme-prop) property.
    #[derive(Clone, Copy, PartialEq, Eq, Default)]
    pub struct ColorScheme: u8 {
        /// Indicates that the element supports a light color scheme.
        const LIGHT = 1 << 0;
        /// Indicates that the element supports a dark color scheme.
        const DARK  = 1 << 1;
        /// Forbids the user agent from overriding the color scheme for the element.
        const ONLY  = 1 << 2;
        // Zig: __unused: u5 = 0  (padding — bitflags handles this implicitly)
    }
}

impl ColorScheme {
    pub fn eql(a: ColorScheme, b: ColorScheme) -> bool {
        a == b
    }

    pub fn parse(input: &mut css::Parser) -> css::Result<ColorScheme> {
        let mut res = ColorScheme::empty();
        let ident = input.expect_ident_cloned()?;

        if let Some(value) = color_scheme_map_get(ident) {
            match value {
                ColorSchemeKeyword::Normal => return Ok(res),
                ColorSchemeKeyword::Only => res.insert(ColorScheme::ONLY),
                ColorSchemeKeyword::Light => res.insert(ColorScheme::LIGHT),
                ColorSchemeKeyword::Dark => res.insert(ColorScheme::DARK),
            }
        }

        while let Ok(i) = input.try_parse(|p| p.expect_ident_cloned()) {
            if let Some(value) = color_scheme_map_get(i) {
                match value {
                    ColorSchemeKeyword::Normal => {
                        return Err(input.new_custom_error(css::ParserError::invalid_value));
                    }
                    ColorSchemeKeyword::Only => {
                        // Only must be at the start or the end, not in the middle
                        if res.contains(ColorScheme::ONLY) {
                            return Err(input.new_custom_error(css::ParserError::invalid_value));
                        }
                        res.insert(ColorScheme::ONLY);
                        return Ok(res);
                    }
                    ColorSchemeKeyword::Light => res.insert(ColorScheme::LIGHT),
                    ColorSchemeKeyword::Dark => res.insert(ColorScheme::DARK),
                }
            }
        }

        Ok(res)
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        if *self == ColorScheme::empty() {
            return dest.write_str("normal");
        }

        if self.contains(ColorScheme::LIGHT) {
            dest.write_str("light")?;
            if self.contains(ColorScheme::DARK) {
                dest.write_char(b' ')?;
            }
        }

        if self.contains(ColorScheme::DARK) {
            dest.write_str("dark")?;
        }

        if self.contains(ColorScheme::ONLY) {
            dest.write_str(" only")?;
        }

        Ok(())
    }

    pub fn deep_clone(&self, _arena: &Arena) -> Self {
        // PORT NOTE: bitflags is Copy.
        *self
    }
}

// Zig: `const Map = bun.ComptimeEnumMap(enum { normal, only, light, dark });`
// ≤8 entries → plain match on bytes (per PORTING.md).
#[derive(Clone, Copy)]
enum ColorSchemeKeyword {
    Normal,
    Only,
    Light,
    Dark,
}

fn color_scheme_map_get(ident: &[u8]) -> Option<ColorSchemeKeyword> {
    match ident {
        b"normal" => Some(ColorSchemeKeyword::Normal),
        b"only" => Some(ColorSchemeKeyword::Only),
        b"light" => Some(ColorSchemeKeyword::Light),
        b"dark" => Some(ColorSchemeKeyword::Dark),
        _ => None,
    }
}

/// A value for the [resize](https://www.w3.org/TR/2021/WD-css-ui-4-20210316/#resize) property.
// TODO(port): Zig source is `css.DefineEnumProperty(@compileError(css.todo_stuff.depth))` — intentionally unimplemented upstream.
pub struct Resize;

/// A value for the [cursor](https://www.w3.org/TR/2021/WD-css-ui-4-20210316/#cursor) property.
pub struct Cursor {
    /// A list of cursor images.
    pub images: SmallList<CursorImage, 1>,
    /// A pre-defined cursor.
    pub keyword: CursorKeyword,
}

/// A [cursor image](https://www.w3.org/TR/2021/WD-css-ui-4-20210316/#cursor) value, used in the `cursor` property.
///
/// See [Cursor](Cursor).
pub struct CursorImage {
    /// A url to the cursor image.
    pub url: Url,
    /// The location in the image where the mouse pointer appears.
    pub hotspot: Option<[CSSNumber; 2]>,
}

/// A pre-defined [cursor](https://www.w3.org/TR/2021/WD-css-ui-4-20210316/#cursor) value,
/// used in the `cursor` property.
///
/// See [Cursor](Cursor).
// TODO(port): Zig source is `css.DefineEnumProperty(@compileError(css.todo_stuff.depth))` — intentionally unimplemented upstream.
pub struct CursorKeyword;

/// A value for the [caret-color](https://www.w3.org/TR/2021/WD-css-ui-4-20210316/#caret-color) property.
pub enum ColorOrAuto {
    /// The `currentColor`, adjusted by the UA to ensure contrast against the background.
    Auto,
    /// A color.
    Color(CssColor),
}

/// A value for the [caret-shape](https://www.w3.org/TR/2021/WD-css-ui-4-20210316/#caret-shape) property.
// TODO(port): Zig source is `css.DefineEnumProperty(@compileError(css.todo_stuff.depth))` — intentionally unimplemented upstream.
pub struct CaretShape;

/// A value for the [caret](https://www.w3.org/TR/2021/WD-css-ui-4-20210316/#caret) shorthand property.
// TODO(port): Zig source is `@compileError(css.todo_stuff.depth)` — intentionally unimplemented upstream.
pub struct Caret;

/// A value for the [user-select](https://www.w3.org/TR/2021/WD-css-ui-4-20210316/#content-selection) property.
// TODO(port): Zig source is `css.DefineEnumProperty(@compileError(css.todo_stuff.depth))` — intentionally unimplemented upstream.
pub struct UserSelect;

/// A value for the [appearance](https://www.w3.org/TR/2021/WD-css-ui-4-20210316/#appearance-switching) property.
pub enum Appearance {
    None,
    Auto,
    Textfield,
    MenulistButton,
    Button,
    Checkbox,
    Listbox,
    Menulist,
    Meter,
    ProgressBar,
    PushButton,
    Radio,
    Searchfield,
    SliderHorizontal,
    SquareButton,
    Textarea,
    // TODO(port): arena-owned slice in Zig (`[]const u8`); using raw fat ptr until 'bump threading in Phase B.
    NonStandard(*const [u8]),
}

#[derive(Default)]
pub struct ColorSchemeHandler;

// PORT NOTE: un-gated B-2 round 15 — Property::ColorScheme variant +
// PropertyHandlerContext::{add_dark_rule,targets} + TokenList/DashedIdent/
// CustomProperty shapes are all real now. `context.arena` was dropped from
// PropertyHandlerContext; `define_var` no longer needs an arena because
// `TokenList.v` is a std `Vec<TokenOrValue>` (LIFETIMES.tsv classification).
impl ColorSchemeHandler {
    pub fn handle_property(
        &mut self,
        property: &Property,
        dest: &mut css::DeclarationList,
        context: &mut PropertyHandlerContext,
    ) -> bool {
        match property {
            Property::ColorScheme(color_scheme_) => {
                let color_scheme: ColorScheme = *color_scheme_;
                if !context
                    .targets
                    .is_compatible(css::compat::Feature::LightDark)
                {
                    if color_scheme.contains(ColorScheme::LIGHT) {
                        dest.push(define_var(b"--buncss-light", css::Token::Ident(b"initial")));
                        dest.push(define_var(b"--buncss-dark", css::Token::Whitespace(b" ")));

                        if color_scheme.contains(ColorScheme::DARK) {
                            context.add_dark_rule(define_var(
                                b"--buncss-light",
                                css::Token::Whitespace(b" "),
                            ));
                            context.add_dark_rule(define_var(
                                b"--buncss-dark",
                                css::Token::Ident(b"initial"),
                            ));
                        }
                    } else if color_scheme.contains(ColorScheme::DARK) {
                        dest.push(define_var(b"--buncss-light", css::Token::Whitespace(b" ")));
                        dest.push(define_var(b"--buncss-dark", css::Token::Ident(b"initial")));
                    }
                }
                // PORT NOTE: Zig pushed `property.deepClone(arena)`; ColorScheme is
                // `Copy` (bitflags u8), so reconstruct the variant directly.
                dest.push(Property::ColorScheme(color_scheme));
                true
            }
            _ => false,
        }
    }

    pub fn finalize(
        &mut self,
        _: &mut css::DeclarationList<'_>,
        _: &mut PropertyHandlerContext<'_>,
    ) {
    }
}

fn define_var(name: &'static [u8], value: css::Token) -> Property {
    // PORT NOTE: `name` is `&'static [u8]` because all call sites pass byte-string literals.
    // `TokenList.v` is `Vec<TokenOrValue>` (std Vec — see custom.rs:320), so no arena
    // threading is needed here despite Zig's `ArrayList(TokenOrValue)`.
    Property::Custom(css::css_properties::custom::CustomProperty {
        name: css::css_properties::custom::CustomPropertyName::Custom(DashedIdent { v: name }),
        value: css::TokenList {
            v: vec![css::css_properties::custom::TokenOrValue::Token(value)],
        },
    })
}

// ported from: src/css/properties/ui.zig
