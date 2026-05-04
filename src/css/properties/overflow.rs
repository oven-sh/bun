use crate as css;
use crate::{Parser, Printer, PrintErr};

/// A value for the [overflow](https://www.w3.org/TR/css-overflow-3/#overflow-properties) shorthand property.
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct Overflow {
    /// A value for the [overflow](https://www.w3.org/TR/css-overflow-3/#overflow-properties) shorthand property.
    pub x: OverflowKeyword,
    /// The overflow mode for the y direction.
    pub y: OverflowKeyword,
}

impl Overflow {
    pub fn parse(input: &mut Parser) -> css::Result<Overflow> {
        let x = match OverflowKeyword::parse(input) {
            css::Result::Ok(v) => v,
            css::Result::Err(e) => return css::Result::Err(e),
        };
        let y = match input.try_parse(OverflowKeyword::parse, ()) {
            css::Result::Ok(v) => v,
            _ => x,
        };
        css::Result::Ok(Overflow { x, y })
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        self.x.to_css(dest)?;
        if self.y != self.x {
            dest.write_char(' ')?;
            self.y.to_css(dest)?;
        }
        Ok(())
    }

    pub fn deep_clone(&self, allocator: &bun_alloc::Arena) -> Self {
        // PORT NOTE: css.implementDeepClone is comptime field reflection → #[derive(Clone)]
        let _ = allocator;
        *self
    }

    #[inline]
    pub fn eql(lhs: &Self, rhs: &Self) -> bool {
        // PORT NOTE: css.implementEql is comptime field reflection → #[derive(PartialEq)]
        lhs == rhs
    }
}

/// An [overflow](https://www.w3.org/TR/css-overflow-3/#overflow-properties) keyword
/// as used in the `overflow-x`, `overflow-y`, and `overflow` properties.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
// TODO(port): css.DefineEnumProperty(@This()) — comptime mixin providing
// eql/hash/parse/to_css/deep_clone from @tagName. Phase B: targeted
// #[derive(css::EnumProperty)] proc-macro (trait-first per PORTING.md §Comptime reflection).
#[derive(css::EnumProperty)]
pub enum OverflowKeyword {
    /// Overflowing content is visible.
    Visible,
    /// Overflowing content is hidden. Programmatic scrolling is allowed.
    Hidden,
    /// Overflowing content is clipped. Programmatic scrolling is not allowed.
    Clip,
    /// The element is scrollable.
    Scroll,
    /// Overflowing content scrolls if needed.
    Auto,
}

/// A value for the [text-overflow](https://www.w3.org/TR/css-overflow-3/#text-overflow) property.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
// TODO(port): css.DefineEnumProperty(@This()) — see OverflowKeyword.
#[derive(css::EnumProperty)]
pub enum TextOverflow {
    /// Overflowing text is clipped.
    Clip,
    /// Overflowing text is truncated with an ellipsis.
    Ellipsis,
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/properties/overflow.zig (80 lines)
//   confidence: medium
//   todos:      2
//   notes:      DefineEnumProperty mixin mapped to placeholder #[derive(css::EnumProperty)]; Phase B must supply that derive (parse/to_css from lowercase tag name).
// ──────────────────────────────────────────────────────────────────────────
