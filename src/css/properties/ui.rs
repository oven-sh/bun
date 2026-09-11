#![warn(unused_must_use)]
use crate as css;

use css::css_properties::Property;
use css::css_properties::custom::{CustomProperty, CustomPropertyName};
use css::{PrintErr, Printer, PropertyHandlerContext};

use css::css_values::ident::DashedIdent;

use bun_alloc::ArenaVecExt as _;

// bumpalo::Bump re-export (CSS is an arena crate)

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
    }
}

impl ColorScheme {
    pub(crate) fn parse(input: &mut css::Parser) -> css::Result<ColorScheme> {
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

    pub(crate) fn to_css(self, dest: &mut Printer) -> Result<(), PrintErr> {
        if self == ColorScheme::empty() {
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
}

// ≤8 entries → plain match on bytes.
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

const LIGHT_VAR: &[u8] = b"--buncss-light";
const DARK_VAR: &[u8] = b"--buncss-dark";

/// Compiles `color-scheme` to the `--buncss-light` / `--buncss-dark` variables, one declaration of each per block.
#[derive(Default)]
pub struct ColorSchemeHandler {
    /// Index in `dest` of the declaration currently holding each variable.
    light: Option<usize>,
    dark: Option<usize>,
    /// Variables before the last `color-scheme` stay put: minifying the block again re-emits them there.
    in_place_from: usize,
}

// `define_var` needs no arena because `TokenList.v` is a std `Vec<TokenOrValue>`.
impl ColorSchemeHandler {
    pub(crate) fn handle_property(
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
                        self.define_vars(
                            dest,
                            css::Token::Ident(b"initial"),
                            css::Token::Whitespace(b" "),
                        );

                        if color_scheme.contains(ColorScheme::DARK) {
                            context
                                .add_dark_rule(define_var(LIGHT_VAR, css::Token::Whitespace(b" ")));
                            context
                                .add_dark_rule(define_var(DARK_VAR, css::Token::Ident(b"initial")));
                        }
                    } else if color_scheme.contains(ColorScheme::DARK) {
                        self.define_vars(
                            dest,
                            css::Token::Whitespace(b" "),
                            css::Token::Ident(b"initial"),
                        );
                    }
                }
                // ColorScheme is `Copy` (bitflags u8), so reconstruct the variant directly.
                dest.push(Property::ColorScheme(color_scheme));
                self.in_place_from = dest.len();
                true
            }
            Property::Custom(CustomProperty {
                name: CustomPropertyName::Custom(name),
                ..
            }) => {
                let slot = match name.v() {
                    LIGHT_VAR => &mut self.light,
                    DARK_VAR => &mut self.dark,
                    _ => return false,
                };
                let declaration = property.deep_clone(dest.bump());
                set_var(slot, self.in_place_from, dest, declaration);
                true
            }
            _ => false,
        }
    }

    fn define_vars(
        &mut self,
        dest: &mut css::DeclarationList,
        light: css::Token,
        dark: css::Token,
    ) {
        set_var(
            &mut self.light,
            self.in_place_from,
            dest,
            define_var(LIGHT_VAR, light),
        );
        set_var(
            &mut self.dark,
            self.in_place_from,
            dest,
            define_var(DARK_VAR, dark),
        );
    }

    pub(crate) fn finalize(
        &mut self,
        _: &mut css::DeclarationList<'_>,
        _: &mut PropertyHandlerContext<'_>,
    ) {
        self.light = None;
        self.dark = None;
        self.in_place_from = 0;
    }
}

/// `dest` only grows while a block is handled, so `slot` stays valid.
fn set_var(
    slot: &mut Option<usize>,
    in_place_from: usize,
    dest: &mut css::DeclarationList,
    declaration: Property,
) {
    match *slot {
        Some(index) if index >= in_place_from => dest[index] = declaration,
        _ => {
            *slot = Some(dest.len());
            dest.push(declaration);
        }
    }
}

fn define_var(name: &'static [u8], value: css::Token) -> Property {
    // `name` is `&'static [u8]` because all call sites pass `LIGHT_VAR` / `DARK_VAR`.
    // `TokenList.v` is `Vec<TokenOrValue>` (std Vec — see custom.rs:320), so no arena
    // threading is needed here.
    Property::Custom(CustomProperty {
        name: CustomPropertyName::Custom(DashedIdent { v: name }),
        value: css::TokenList {
            v: vec![css::css_properties::custom::TokenOrValue::Token(value)],
        },
    })
}
