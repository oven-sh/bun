use crate as css;
use crate::{Parser, PrintErr, Printer};

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
        let x = OverflowKeyword::parse(input)?;
        let y = input.try_parse(OverflowKeyword::parse).unwrap_or(x);
        Ok(Overflow { x, y })
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        self.x.to_css(dest)?;
        if self.y != self.x {
            dest.write_char(b' ')?;
            self.y.to_css(dest)?;
        }
        Ok(())
    }

    pub fn deep_clone(&self, arena: &bun_alloc::Arena) -> Self {
        // PORT NOTE: css.implementDeepClone is comptime field reflection → #[derive(Clone)]
        let _ = arena;
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
// PORT NOTE: css.DefineEnumProperty(@This()) — comptime mixin providing
// eql/hash/parse/to_css/deep_clone from @tagName.
#[derive(Clone, Copy, PartialEq, Eq, Hash, crate::DefineEnumProperty)]
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
#[derive(Clone, Copy, PartialEq, Eq, Hash, crate::DefineEnumProperty)]
pub enum TextOverflow {
    /// Overflowing text is clipped.
    Clip,
    /// Overflowing text is truncated with an ellipsis.
    Ellipsis,
}

// ported from: src/css/properties/overflow.zig
