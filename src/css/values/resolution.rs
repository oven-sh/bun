use crate::css_parser as css;
use crate::css_parser::{CssResult as Result, Maybe, Parser, PrintErr, Printer, Token};
use crate::values::number::CSSNumber;
use bun_core::strings;

/// A CSS `<resolution>` value.
#[derive(
    Clone,
    Copy,
    Debug,
    PartialEq,
    crate::generics::CssEql,
    crate::generics::CssHash,
    crate::generics::DeepClone,
)]
pub enum Resolution {
    /// A resolution in dots per inch.
    Dpi(CSSNumber),
    /// A resolution in dots per centimeter.
    Dpcm(CSSNumber),
    /// A resolution in dots per px.
    Dppx(CSSNumber),
}

// ~toCssImpl

impl Resolution {
    // css.implementHash / css.implementEql — provided by
    // `#[derive(CssHash, CssEql)]` above (f32-payload enum).

    pub fn parse(input: &mut Parser) -> Result<Resolution> {
        // TODO: calc?
        let location = input.current_source_location();
        let tok = input.next()?.clone();
        if let Token::Dimension(dim) = &tok {
            let value = dim.num.value;
            let unit = dim.unit;
            return crate::match_ignore_ascii_case! { unit, {
                b"dpi" => Ok(Resolution::Dpi(value)),
                b"dpcm" => Ok(Resolution::Dpcm(value)),
                b"dppx" | b"x" => Ok(Resolution::Dppx(value)),
                _ => Err(location.new_unexpected_token_error(Token::Ident(unit))),
            }};
        }
        Err(location.new_unexpected_token_error(tok))
    }

    pub fn try_from_token(token: &Token) -> Maybe<Resolution, ()> {
        match token {
            Token::Dimension(dim) => {
                let value = dim.num.value;
                let unit = dim.unit;
                crate::match_ignore_ascii_case! { unit, {
                    b"dpi" => Ok(Resolution::Dpi(value)),
                    b"dpcm" => Ok(Resolution::Dpcm(value)),
                    b"dppx" | b"x" => Ok(Resolution::Dppx(value)),
                    _ => Err(()),
                }}
            }
            _ => Err(()),
        }
    }

    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        let (value, unit): (CSSNumber, &'static [u8]) = match *self {
            Resolution::Dpi(dpi) => (dpi, b"dpi".as_slice()),
            Resolution::Dpcm(dpcm) => (dpcm, b"dpcm".as_slice()),
            Resolution::Dppx(dppx) => {
                if dest
                    .targets
                    .is_compatible(crate::compat::Feature::XResolutionUnit)
                {
                    (dppx, b"x".as_slice())
                } else {
                    (dppx, b"dppx".as_slice())
                }
            }
        };

        css::serializer::serialize_dimension(value, unit, dest)
    }

    pub fn add_f32(self, other: f32) -> Resolution {
        match self {
            Resolution::Dpi(dpi) => Resolution::Dpi(dpi + other),
            Resolution::Dpcm(dpcm) => Resolution::Dpcm(dpcm + other),
            Resolution::Dppx(dppx) => Resolution::Dppx(dppx + other),
        }
    }
}

// ported from: src/css/values/resolution.zig
