use crate::css_parser as css;
use crate::css_parser::{CssResult as Result, PrintErr, Printer};
use crate::targets::Browsers;
use crate::values::protocol::{IsCompatible, Parse, ToCss};

// PORT NOTE: the Zig `needsDeinit(comptime T: type) bool` switch and the
// `deinit(this, arena)` method are dropped entirely. They existed to
// thread per-field `arena.free` through a comptime type table; in Rust,
// `T: Drop` on the four fields handles this automatically (and arena-owned
// payloads in `bun_css` are bulk-freed by the bump, never per-value).

/// A generic value that represents a value for four sides of a box,
/// e.g. border-width, margin, padding, etc.
///
/// When serialized, as few components as possible are written when
/// there are duplicate values.
pub struct Rect<T> {
    /// The top component.
    pub top: T,
    /// The right component.
    pub right: T,
    /// The bottom component.
    pub bottom: T,
    /// The left component.
    pub left: T,
}

impl<T> Rect<T> {
    pub fn eql(&self, other: &Self) -> bool
    where
        T: PartialEq,
    {
        self.top == other.top
            && self.right == other.right
            && self.bottom == other.bottom
            && self.left == other.left
    }

    pub fn deep_clone(&self, _bump: &bun_alloc::Arena) -> Self
    where
        T: Clone,
    {
        // PORT NOTE: Zig branched on `comptime needs_deinit` to decide between
        // bitwise copy and per-field `.deepClone(arena)`. In Rust this is
        // just the `DeepClone`/`Clone` trait on `T` — the cheap-copy types
        // (`f32`, `NumberOrPercentage`, `LineStyle`) impl it as a bit copy.
        // TODO(port): narrow trait bound once css::generic::DeepClone lands.
        Self {
            top: self.top.clone(),
            right: self.right.clone(),
            bottom: self.bottom.clone(),
            left: self.left.clone(),
        }
    }

    pub fn all(val: T) -> Self
    where
        T: Clone,
    {
        Self {
            top: val.clone(),
            right: val.clone(),
            bottom: val.clone(),
            left: val,
        }
    }

    pub fn parse(input: &mut css::Parser) -> Result<Self>
    where
        T: Parse + Clone,
    {
        Self::parse_with(input, Self::val_parse)
    }

    pub fn parse_with<F>(input: &mut css::Parser, parse_fn: F) -> Result<Self>
    where
        F: Fn(&mut css::Parser) -> Result<T>,
        T: Clone,
    {
        let first = parse_fn(input)?;
        let second = match input.try_parse(&parse_fn) {
            Ok(v) => v,
            // <first>
            Err(_) => {
                return Ok(Self {
                    top: first.clone(),
                    right: first.clone(),
                    bottom: first.clone(),
                    left: first,
                });
            }
        };
        let third = match input.try_parse(&parse_fn) {
            Ok(v) => v,
            // <first> <second>
            Err(_) => {
                return Ok(Self {
                    top: first.clone(),
                    right: second.clone(),
                    bottom: first,
                    left: second,
                });
            }
        };
        let fourth = match input.try_parse(&parse_fn) {
            Ok(v) => v,
            // <first> <second> <third>
            Err(_) => {
                return Ok(Self {
                    top: first,
                    right: second.clone(),
                    bottom: third,
                    left: second,
                });
            }
        };
        // <first> <second> <third> <fourth>
        Ok(Self {
            top: first,
            right: second,
            bottom: third,
            left: fourth,
        })
    }

    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr>
    where
        T: ToCss + PartialEq,
    {
        self.top.to_css(dest)?;
        let same_vertical = self.top == self.bottom;
        let same_horizontal = self.right == self.left;
        if same_vertical && same_horizontal && self.top == self.right {
            return Ok(());
        }
        dest.write_str(b" ")?;
        self.right.to_css(dest)?;
        if same_vertical && same_horizontal {
            return Ok(());
        }
        dest.write_str(b" ")?;
        self.bottom.to_css(dest)?;
        if same_horizontal {
            return Ok(());
        }
        dest.write_str(b" ")?;
        self.left.to_css(dest)
    }

    pub fn val_parse(i: &mut css::Parser) -> Result<T>
    where
        T: Parse,
    {
        T::parse(i)
    }

    pub fn is_compatible(&self, browsers: Browsers) -> bool
    where
        T: IsCompatible,
    {
        self.top.is_compatible(browsers)
            && self.right.is_compatible(browsers)
            && self.bottom.is_compatible(browsers)
            && self.left.is_compatible(browsers)
    }
}

// ported from: src/css/values/rect.zig
