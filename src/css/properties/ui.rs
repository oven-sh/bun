#![warn(unused_must_use)]
use crate as css;

use bun_alloc::ArenaVecExt as _;
use css::css_properties::custom::{TokenList, TokenOrValue};
use css::css_properties::{Property, PropertyId};
use css::{PrintErr, Printer, PropertyHandlerContext};

use css::css_values::ident::{DashedIdent, is_reserved_custom_ident};

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
    /// `normal | [ light | dark | <custom-ident> ]+ && only?`. The `bool` says a `<custom-ident>` is present.
    fn from_idents<'a>(idents: impl Iterator<Item = &'a [u8]>) -> Option<(ColorScheme, bool)> {
        let mut res = ColorScheme::empty();
        let mut has_custom_ident = false;
        let mut count: usize = 0;
        // Set by `normal`, and by an `only` that follows the schemes.
        let mut is_complete = false;

        for ident in idents {
            if is_complete {
                return None;
            }
            css::match_ignore_ascii_case! { ident, {
                b"light" => res.insert(ColorScheme::LIGHT),
                b"dark" => res.insert(ColorScheme::DARK),
                b"only" => {
                    if res.contains(ColorScheme::ONLY) {
                        return None;
                    }
                    res.insert(ColorScheme::ONLY);
                    is_complete = count != 0;
                },
                b"normal" => {
                    if count != 0 {
                        return None;
                    }
                    is_complete = true;
                },
                _ => {
                    if is_reserved_custom_ident(ident) {
                        return None;
                    }
                    has_custom_ident = true;
                },
            }}
            count += 1;
        }

        // `only` needs a scheme beside it.
        if count == 0 || (res == ColorScheme::ONLY && !has_custom_ident) {
            return None;
        }
        Some((res, has_custom_ident))
    }

    // A value with a `<custom-ident>` stays `Property::Unparsed`: parcel-bundler/lightningcss#1152
    pub(crate) fn parse(input: &mut css::Parser) -> css::Result<ColorScheme> {
        let idents =
            core::iter::from_fn(|| input.try_parse(|input| input.expect_ident_cloned()).ok());
        match Self::from_idents(idents) {
            Some((color_scheme, false)) => Ok(color_scheme),
            _ => Err(input.new_custom_error(css::ParserError::invalid_value)),
        }
    }

    /// The flags of a value that `parse` left unparsed for its `<custom-ident>` (`light foo`).
    fn from_unparsed(value: &TokenList) -> Option<ColorScheme> {
        let mut is_ident_list = true;
        let idents = value.v.iter().filter_map(|token| match token {
            TokenOrValue::Token(css::Token::Ident(ident)) => Some(*ident),
            TokenOrValue::DashedIdent(ident) => Some(ident.v()),
            TokenOrValue::Token(css::Token::Whitespace(_)) => None,
            _ => {
                is_ident_list = false;
                None
            }
        });
        let (color_scheme, _) = Self::from_idents(idents)?;
        is_ident_list.then_some(color_scheme)
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

#[derive(Default)]
pub struct ColorSchemeHandler;

// `define_var` needs no arena because `TokenList.v` is a std `Vec<TokenOrValue>`.
impl ColorSchemeHandler {
    pub(crate) fn handle_property(
        &mut self,
        property: &Property,
        dest: &mut css::DeclarationList,
        context: &mut PropertyHandlerContext,
    ) -> bool {
        let color_scheme = match property {
            Property::ColorScheme(color_scheme) => *color_scheme,
            Property::Unparsed(unparsed)
                if matches!(unparsed.property_id, PropertyId::ColorScheme) =>
            {
                match ColorScheme::from_unparsed(&unparsed.value) {
                    Some(color_scheme) => color_scheme,
                    None => return false,
                }
            }
            _ => return false,
        };

        if !context
            .targets
            .is_compatible(css::compat::Feature::LightDark)
        {
            if color_scheme.contains(ColorScheme::LIGHT) {
                dest.push(define_var(b"--buncss-light", css::Token::Ident(b"initial")));
                dest.push(define_var(b"--buncss-dark", css::Token::Whitespace(b" ")));

                if color_scheme.contains(ColorScheme::DARK) {
                    context
                        .add_dark_rule(define_var(b"--buncss-light", css::Token::Whitespace(b" ")));
                    context
                        .add_dark_rule(define_var(b"--buncss-dark", css::Token::Ident(b"initial")));
                }
            } else if color_scheme.contains(ColorScheme::DARK) {
                dest.push(define_var(b"--buncss-light", css::Token::Whitespace(b" ")));
                dest.push(define_var(b"--buncss-dark", css::Token::Ident(b"initial")));
            }
        }

        let arena = dest.bump();
        dest.push(match property {
            Property::ColorScheme(_) => Property::ColorScheme(color_scheme),
            _ => property.deep_clone(arena),
        });
        true
    }

    pub(crate) fn finalize(
        &mut self,
        _: &mut css::DeclarationList<'_>,
        _: &mut PropertyHandlerContext<'_>,
    ) {
    }
}

fn define_var(name: &'static [u8], value: css::Token) -> Property {
    // `name` is `&'static [u8]` because all call sites pass byte-string literals.
    // `TokenList.v` is `Vec<TokenOrValue>` (std Vec — see custom.rs:320), so no arena
    // threading is needed here.
    Property::Custom(css::css_properties::custom::CustomProperty {
        name: css::css_properties::custom::CustomPropertyName::Custom(DashedIdent { v: name }),
        value: css::TokenList {
            v: vec![css::css_properties::custom::TokenOrValue::Token(value)],
        },
    })
}
