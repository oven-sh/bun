#![allow(unused_imports, dead_code)]
#![warn(unused_must_use)]
use crate as css;
use crate::{Parser, Printer, PrintErr, VendorPrefix, Token};
use bun_string::strings;

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

fn lookup_keyword(ident: &[u8]) -> Option<PositionKeyword> {
    // ≤8 entries → plain match per PORTING.md (Zig: `bun.ComptimeEnumMap` +
    // `getASCIIICaseInsensitive`).
    use bun_string::strings::eql_case_insensitive_ascii_check_length as eq;
    Some(if eq(ident, b"static") { PositionKeyword::Static }
        else if eq(ident, b"relative") { PositionKeyword::Relative }
        else if eq(ident, b"absolute") { PositionKeyword::Absolute }
        else if eq(ident, b"fixed") { PositionKeyword::Fixed }
        else if eq(ident, b"sticky") { PositionKeyword::Sticky }
        else if eq(ident, b"-webkit-sticky") { PositionKeyword::WebkitSticky }
        else { return None })
}

impl Position {
    pub fn parse(input: &mut Parser) -> css::Result<Position> {
        let location = input.current_source_location();
        let ident = match input.expect_ident() {
            Err(e) => return Err(e),
            Ok(v) => v,
        };

        let Some(keyword) = lookup_keyword(ident) else {
            // SAFETY: `ident` is a slice into Parser's source buffer, which the
            // arena outlives; `Token` stores it as `&'static [u8]` (the
            // crate-wide `src_str` lifetime erasure used everywhere in
            // css_parser.rs — see `css_parser::src_str`).
            return Err(location.new_unexpected_token_error(
                Token::Ident(unsafe { crate::css_parser::src_str(ident) }),
            ));
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
