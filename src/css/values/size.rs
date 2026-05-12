use crate::css_parser as css;
use crate::css_parser::{CssResult as Result, Parser, PrintErr, Printer};
use crate::targets::Browsers;
use crate::values::length::LengthPercentage;
use crate::values::number::CSSNumberFns;
use crate::values::protocol::{IsCompatible, Parse, ToCss};
use bun_alloc::Arena;

/// A generic value that represents a value with two components, e.g. a border radius.
///
/// When serialized, only a single component will be written if both are equal.
pub struct Size2D<T> {
    pub a: T,
    pub b: T,
}

// PORT NOTE: Zig's `switch (T) { f32 => ..., LengthPercentage => ..., else => T.parse }`
// is comptime type dispatch. In Rust this is expressed via trait bounds — `f32` and
// `LengthPercentage` must impl the same `Parse`/`ToCss`/`Eql` traits as other CSS value
// types (the `f32` impls delegate to `CSSNumberFns`). The per-type `switch` arms are
// therefore collapsed into trait method calls below.
// TODO(port): confirm trait names match Phase-B crate API once `generics::
// parse_tocss_numeric_gated` un-gates; for now bound on `values::protocol`.
impl<T> Size2D<T>
where
    T: Clone + PartialEq,
{
    fn parse_val(input: &mut Parser) -> Result<T>
    where
        T: Parse,
    {
        // PORT NOTE: f32 → CSSNumberFns::parse, LengthPercentage → LengthPercentage::parse,
        // else → T::parse — all unified under the `Parse` trait in Rust.
        T::parse(input)
    }

    pub fn parse(input: &mut Parser) -> Result<Size2D<T>>
    where
        T: Parse,
    {
        let first = Self::parse_val(input)?;
        let second = input
            .try_parse(Self::parse_val)
            .unwrap_or_else(|_| first.clone());
        Ok(Size2D {
            a: first,
            b: second,
        })
    }

    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr>
    where
        T: ToCss,
    {
        Self::val_to_css(&self.a, dest)?;
        if !Self::val_eql(&self.b, &self.a) {
            dest.write_str(b" ")?;
            Self::val_to_css(&self.b, dest)?;
        }
        Ok(())
    }

    pub fn val_to_css(val: &T, dest: &mut Printer) -> core::result::Result<(), PrintErr>
    where
        T: ToCss,
    {
        // PORT NOTE: f32 → CSSNumberFns::to_css, else → val.to_css — unified under `ToCss` trait.
        val.to_css(dest)
    }

    pub fn is_compatible(&self, browsers: Browsers) -> bool
    where
        T: IsCompatible,
    {
        self.a.is_compatible(browsers) && self.b.is_compatible(browsers)
    }

    pub fn deep_clone(&self, _bump: &Arena) -> Self {
        // TODO(port): css::implement_deep_clone is @typeInfo-based reflection in Zig;
        // replace with #[derive(DeepClone)] or arena-aware deep_clone in Phase B.
        // For now `T: Clone` covers it (Box payloads deep-clone via their Clone impls).
        Size2D {
            a: self.a.clone(),
            b: self.b.clone(),
        }
    }

    #[inline]
    pub fn val_eql(lhs: &T, rhs: &T) -> bool {
        // PORT NOTE: f32 → `lhs.* == rhs.*`, else → `lhs.eql(rhs)` — unified under PartialEq.
        lhs == rhs
    }

    #[inline]
    pub fn eql(lhs: &Self, rhs: &Self) -> bool {
        // PORT NOTE: preserved verbatim from Zig — compares lhs.a against rhs.b only
        // (not a/a && b/b). Suspect upstream bug, but ported faithfully.
        lhs.a == rhs.b
    }
}

// Keep references to the f32/LengthPercentage special-case helpers so Phase B can
// wire trait impls if they don't already exist.
#[allow(unused_imports)]
use {CSSNumberFns as _, LengthPercentage as _};

// ported from: src/css/values/size.zig
