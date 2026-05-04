use crate::{self as css, Printer, PrintErr, Parser, Token};
use crate::css_values::number::CSSNumber;
use bun_str::strings;

/// A CSS `<resolution>` value.
#[derive(Clone, Copy, Debug)]
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
    pub fn hash(&self, hasher: &mut bun_wyhash::Wyhash) {
        css::implement_hash(self, hasher)
    }

    pub fn eql(&self, other: &Resolution) -> bool {
        css::implement_eql(self, other)
    }

    pub fn parse(input: &mut Parser) -> css::Result<Resolution> {
        // TODO: calc?
        let location = input.current_source_location();
        let tok = match input.next() {
            css::Result::Ok(vv) => vv,
            css::Result::Err(e) => return css::Result::Err(e),
        };
        if let Token::Dimension(dim) = &*tok {
            let value = dim.num.value;
            let unit = &dim.unit;
            // css.todo_stuff.match_ignore_ascii_case
            if strings::eql_case_insensitive_asciii_check_length(unit, b"dpi") {
                return css::Result::Ok(Resolution::Dpi(value));
            }
            if strings::eql_case_insensitive_asciii_check_length(unit, b"dpcm") {
                return css::Result::Ok(Resolution::Dpcm(value));
            }
            if strings::eql_case_insensitive_asciii_check_length(unit, b"dppx")
                || strings::eql_case_insensitive_asciii_check_length(unit, b"x")
            {
                return css::Result::Ok(Resolution::Dppx(value));
            }
            return css::Result::Err(location.new_unexpected_token_error(Token::Ident(unit.clone())));
        }
        css::Result::Err(location.new_unexpected_token_error(tok.clone()))
    }

    pub fn try_from_token(token: &Token) -> css::Maybe<Resolution, ()> {
        match token {
            Token::Dimension(dim) => {
                let value = dim.num.value;
                let unit = &dim.unit;
                // todo_stuff.match_ignore_ascii_case
                if strings::eql_case_insensitive_asciii_check_length(unit, b"dpi") {
                    css::Maybe::Ok(Resolution::Dpi(value))
                } else if strings::eql_case_insensitive_asciii_check_length(unit, b"dpcm") {
                    css::Maybe::Ok(Resolution::Dpcm(value))
                } else if strings::eql_case_insensitive_asciii_check_length(unit, b"dppx")
                    || strings::eql_case_insensitive_asciii_check_length(unit, b"x")
                {
                    css::Maybe::Ok(Resolution::Dppx(value))
                } else {
                    css::Maybe::Err(())
                }
            }
            _ => css::Maybe::Err(()),
        }
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        let (value, unit): (CSSNumber, &'static str) = match *self {
            Resolution::Dpi(dpi) => (dpi, "dpi"),
            Resolution::Dpcm(dpcm) => (dpcm, "dpcm"),
            Resolution::Dppx(dppx) => {
                if dest.targets.is_compatible(css::compat::Feature::XResolutionUnit) {
                    (dppx, "x")
                } else {
                    (dppx, "dppx")
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/values/resolution.zig (91 lines)
//   confidence: medium
//   todos:      0
//   notes:      css::Result/Maybe variant names and Token::Dimension shape assumed; eql_case_insensitive_asciii_check_length preserves Zig's triple-I typo; allocator param dropped from add_f32
// ──────────────────────────────────────────────────────────────────────────
