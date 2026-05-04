use crate::css_parser as css;

use css::{Printer, PrintErr, SmallList};

use css::css_values::number::CSSNumber;
#[allow(unused_imports)]
use css::css_values::ident::DashedIdent;
use css::css_values::color::CssColor;
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
        let ident = match input.expect_ident() {
            Ok(ident) => ident,
            Err(e) => return Err(e),
        };

        if let Some(value) = color_scheme_map_get(ident) {
            match value {
                ColorSchemeKeyword::Normal => return Ok(res),
                ColorSchemeKeyword::Only => res.insert(ColorScheme::ONLY),
                ColorSchemeKeyword::Light => res.insert(ColorScheme::LIGHT),
                ColorSchemeKeyword::Dark => res.insert(ColorScheme::DARK),
            }
        }

        while let Some(i) = input.try_parse(css::Parser::expect_ident, ()).ok() {
            if let Some(value) = color_scheme_map_get(i) {
                match value {
                    ColorSchemeKeyword::Normal => {
                        return Err(input.new_custom_error(css::ParserError::InvalidValue));
                    }
                    ColorSchemeKeyword::Only => {
                        // Only must be at the start or the end, not in the middle
                        if res.contains(ColorScheme::ONLY) {
                            return Err(input.new_custom_error(css::ParserError::InvalidValue));
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
                dest.write_char(' ')?;
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

    pub fn deep_clone(&self, allocator: &Arena) -> Self {
        css::implement_deep_clone(self, allocator)
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
    pub images: SmallList<CursorImage>,
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

pub struct ColorSchemeHandler;

impl ColorSchemeHandler {
    pub fn handle_property(
        &mut self,
        property: &css::Property,
        dest: &mut css::DeclarationList,
        context: &mut css::PropertyHandlerContext,
    ) -> bool {
        match property {
            css::Property::ColorScheme(color_scheme_) => {
                let color_scheme: &ColorScheme = color_scheme_;
                if !context.targets.is_compatible(css::compat::Feature::LightDark) {
                    if color_scheme.contains(ColorScheme::LIGHT) {
                        dest.push(define_var(
                            context.allocator,
                            b"--buncss-light",
                            css::Token::Ident(b"initial"),
                        ));
                        dest.push(define_var(
                            context.allocator,
                            b"--buncss-dark",
                            css::Token::Whitespace(b" "),
                        ));

                        if color_scheme.contains(ColorScheme::DARK) {
                            context.add_dark_rule(
                                context.allocator,
                                define_var(
                                    context.allocator,
                                    b"--buncss-light",
                                    css::Token::Whitespace(b" "),
                                ),
                            );
                            context.add_dark_rule(
                                context.allocator,
                                define_var(
                                    context.allocator,
                                    b"--buncss-dark",
                                    css::Token::Ident(b"initial"),
                                ),
                            );
                        }
                    } else if color_scheme.contains(ColorScheme::DARK) {
                        dest.push(define_var(
                            context.allocator,
                            b"--buncss-light",
                            css::Token::Whitespace(b" "),
                        ));
                        dest.push(define_var(
                            context.allocator,
                            b"--buncss-dark",
                            css::Token::Ident(b"initial"),
                        ));
                    }
                }
                dest.push(property.deep_clone(context.allocator));
                true
            }
            _ => false,
        }
    }

    pub fn finalize(&mut self, _: &mut css::DeclarationList, _: &mut css::PropertyHandlerContext) {}
}

fn define_var(allocator: &Arena, name: &'static [u8], value: css::Token) -> css::Property {
    // PORT NOTE: `name` is `&'static [u8]` because all call sites pass byte-string literals.
    css::Property::Custom(css::css_properties::custom::CustomProperty {
        name: css::css_properties::custom::CustomPropertyName::Custom(css::DashedIdent { v: name }),
        value: css::TokenList {
            v: 'brk: {
                let mut list =
                    bumpalo::collections::Vec::<css::css_properties::custom::TokenOrValue>::new_in(
                        allocator,
                    );
                list.push(css::css_properties::custom::TokenOrValue::Token(value));
                break 'brk list;
            },
        },
    })
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/properties/ui.zig (212 lines)
//   confidence: medium
//   todos:      6
//   notes:      Several Zig decls are `@compileError(todo_stuff.depth)` stubs — ported as unit structs with TODO; ColorScheme packed-struct → bitflags; arena allocator threaded as &Arena.
// ──────────────────────────────────────────────────────────────────────────
