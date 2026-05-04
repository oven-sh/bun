use crate as css;
use crate::Printer;
use crate::PrintErr;
use crate::Result;
use crate::targets::Browsers;

// PORT NOTE: the Zig `needsDeinit(comptime T: type) bool` switch and the
// `deinit(this, allocator)` method are dropped entirely. They existed to
// thread per-field `allocator.free` through a comptime type table; in Rust,
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
    pub fn eql(&self, other: &Self) -> bool {
        css::generic::eql(&self.top, &other.top)
            && css::generic::eql(&self.right, &other.right)
            && css::generic::eql(&self.bottom, &other.bottom)
            && css::generic::eql(&self.left, &other.left)
    }

    pub fn deep_clone(&self, bump: &css::Allocator) -> Self {
        // PORT NOTE: Zig branched on `comptime needs_deinit` to decide between
        // bitwise copy and per-field `.deepClone(allocator)`. In Rust this is
        // just the `DeepClone`/`Clone` trait on `T` — the cheap-copy types
        // (`f32`, `NumberOrPercentage`, `LineStyle`) impl it as a bit copy.
        // TODO(port): narrow trait bound once css::generic::DeepClone lands.
        Self {
            top: css::generic::deep_clone(&self.top, bump),
            right: css::generic::deep_clone(&self.right, bump),
            bottom: css::generic::deep_clone(&self.bottom, bump),
            left: css::generic::deep_clone(&self.left, bump),
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

    pub fn parse(input: &mut css::Parser) -> Result<Self> {
        Self::parse_with(input, Self::val_parse)
    }

    pub fn parse_with<F>(input: &mut css::Parser, parse_fn: F) -> Result<Self>
    where
        F: Fn(&mut css::Parser) -> Result<T>,
        T: Clone,
    {
        let first = match parse_fn(input) {
            Ok(vv) => vv,
            Err(e) => return Err(e),
        };
        let second = match input.try_parse(&parse_fn) {
            Ok(v) => v,
            // <first>
            Err(_) => {
                return Ok(Self { top: first.clone(), right: first.clone(), bottom: first.clone(), left: first });
            }
        };
        let third = match input.try_parse(&parse_fn) {
            Ok(v) => v,
            // <first> <second>
            Err(_) => {
                return Ok(Self { top: first.clone(), right: second.clone(), bottom: first, left: second });
            }
        };
        let fourth = match input.try_parse(&parse_fn) {
            Ok(v) => v,
            // <first> <second> <third>
            Err(_) => {
                return Ok(Self { top: first, right: second.clone(), bottom: third, left: second });
            }
        };
        // <first> <second> <third> <fourth>
        Ok(Self { top: first, right: second, bottom: third, left: fourth })
    }

    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        css::generic::to_css(&self.top, dest)?;
        let same_vertical = css::generic::eql(&self.top, &self.bottom);
        let same_horizontal = css::generic::eql(&self.right, &self.left);
        if same_vertical && same_horizontal && css::generic::eql(&self.top, &self.right) {
            return Ok(());
        }
        dest.write_str(" ")?;
        css::generic::to_css(&self.right, dest)?;
        if same_vertical && same_horizontal {
            return Ok(());
        }
        dest.write_str(" ")?;
        css::generic::to_css(&self.bottom, dest)?;
        if same_horizontal {
            return Ok(());
        }
        dest.write_str(" ")?;
        css::generic::to_css(&self.left, dest)
    }

    pub fn val_parse(i: &mut css::Parser) -> Result<T> {
        css::generic::parse(i)
    }

    pub fn is_compatible(&self, browsers: Browsers) -> bool {
        // TODO(port): bound `T: IsCompatible` once that trait exists in bun_css.
        css::generic::is_compatible(&self.top, browsers)
            && css::generic::is_compatible(&self.right, browsers)
            && css::generic::is_compatible(&self.bottom, browsers)
            && css::generic::is_compatible(&self.left, browsers)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/values/rect.zig (143 lines)
//   confidence: medium
//   todos:      2
//   notes:      needsDeinit/deinit dropped (Drop handles it); css::generic::* dispatch fns assumed as trait shims — Phase B replaces with real trait bounds (Eql/ToCss/Parse/DeepClone/IsCompatible).
// ──────────────────────────────────────────────────────────────────────────
