#![warn(unused_must_use)]
use crate as css;

use css::css_properties::Property;
use css::{PrintErr, Printer, PropertyHandlerContext};

use css::css_values::ident::DashedIdent;

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
    // Consumes only the keywords it knows (`normal | [ light | dark | <custom-ident> ]+ && only?`
    // minus the custom idents). Anything else, including a css-wide keyword, is left
    // in the input so that `Property::parse` fails `expect_exhausted` and keeps the
    // declaration as `Property::Unparsed` instead of collapsing it to `normal`.
    pub(crate) fn parse(input: &mut css::Parser) -> css::Result<ColorScheme> {
        let mut res = ColorScheme::empty();
        let mut has_any = false;

        if input
            .try_parse(|input| input.expect_ident_matching(b"normal"))
            .is_ok()
        {
            return Ok(res);
        }

        if input
            .try_parse(|input| input.expect_ident_matching(b"only"))
            .is_ok()
        {
            res.insert(ColorScheme::ONLY);
            has_any = true;
        }

        loop {
            if input
                .try_parse(|input| input.expect_ident_matching(b"light"))
                .is_ok()
            {
                res.insert(ColorScheme::LIGHT);
                has_any = true;
                continue;
            }

            if input
                .try_parse(|input| input.expect_ident_matching(b"dark"))
                .is_ok()
            {
                res.insert(ColorScheme::DARK);
                has_any = true;
                continue;
            }

            break;
        }

        // `only` is allowed at the start or the end.
        if !res.contains(ColorScheme::ONLY)
            && input
                .try_parse(|input| input.expect_ident_matching(b"only"))
                .is_ok()
        {
            res.insert(ColorScheme::ONLY);
            has_any = true;
        }

        if has_any {
            return Ok(res);
        }

        Err(input.new_custom_error(css::ParserError::invalid_value))
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
            if !self.intersects(ColorScheme::LIGHT | ColorScheme::DARK) {
                return dest.write_str("only");
            }
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
                // ColorScheme is `Copy` (bitflags u8), so reconstruct the variant directly.
                dest.push(Property::ColorScheme(color_scheme));
                true
            }
            _ => false,
        }
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
