use bun_css::{self as css, Parser, Printer, PrintErr, VendorPrefix, Token};

/// A value for the [position](https://www.w3.org/TR/css-position-3/#position-property) property.
#[derive(Debug, Clone, PartialEq)]
pub enum Position {
    /// The box is laid in the document flow.
    Static,
    /// The box is laid out in the document flow and offset from the resulting position.
    Relative,
    /// The box is taken out of document flow and positioned in reference to its relative ancestor.
    Absolute,
    /// Similar to relative but adjusted according to the ancestor scrollable element.
    Sticky(VendorPrefix),
    /// The box is taken out of the document flow and positioned in reference to the page viewport.
    Fixed,
}

#[derive(Clone, Copy)]
enum PositionKeyword {
    Static,
    Relative,
    Absolute,
    Fixed,
    Sticky,
    WebkitSticky,
}

static KEYWORD_MAP: phf::Map<&'static [u8], PositionKeyword> = phf::phf_map! {
    b"static" => PositionKeyword::Static,
    b"relative" => PositionKeyword::Relative,
    b"absolute" => PositionKeyword::Absolute,
    b"fixed" => PositionKeyword::Fixed,
    b"sticky" => PositionKeyword::Sticky,
    b"-webkit-sticky" => PositionKeyword::WebkitSticky,
};

impl Position {
    pub fn parse(input: &mut Parser) -> css::Result<Position> {
        let location = input.current_source_location();
        let ident = match input.expect_ident() {
            Err(e) => return Err(e),
            Ok(v) => v,
        };

        let Some(keyword) = KEYWORD_MAP.get(ident).copied() else {
            return Err(location.new_unexpected_token_error(Token::Ident(ident)));
        };

        Ok(match keyword {
            PositionKeyword::Static => Position::Static,
            PositionKeyword::Relative => Position::Relative,
            PositionKeyword::Absolute => Position::Absolute,
            PositionKeyword::Fixed => Position::Fixed,
            PositionKeyword::Sticky => Position::Sticky(VendorPrefix::NONE),
            PositionKeyword::WebkitSticky => Position::Sticky(VendorPrefix::WEBKIT),
        })
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        match self {
            Position::Static => dest.write_str("static"),
            Position::Relative => dest.write_str("relative"),
            Position::Absolute => dest.write_str("absolute"),
            Position::Fixed => dest.write_str("fixed"),
            Position::Sticky(prefix) => {
                prefix.to_css(dest)?;
                dest.write_str("sticky")
            }
        }
    }

    pub fn eql(&self, rhs: &Self) -> bool {
        // Zig: css.implementEql(@This(), lhs, rhs) — comptime-reflection structural eq.
        // Rust: covered by #[derive(PartialEq)].
        self == rhs
    }

    pub fn deep_clone(&self) -> Self {
        // Zig: css.implementDeepClone(@This(), this, allocator) — comptime-reflection deep copy.
        // Rust: covered by #[derive(Clone)]; allocator param dropped (global mimalloc).
        self.clone()
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/properties/position.zig (82 lines)
//   confidence: high
//   todos:      0
//   notes:      eql/deepClone collapsed to derives.
// ──────────────────────────────────────────────────────────────────────────
