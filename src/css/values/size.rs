use crate::css_parser as css;
use crate::css_parser::{Parser, Printer, PrintErr, Result};
use crate::css_values::length::LengthPercentage;
use crate::css_values::number::CSSNumberFns;
use crate::targets::Browsers;
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
// TODO(port): confirm trait names (`css::Parse`, `css::ToCss`, `css::Eql`, `css::IsCompatible`, `css::DeepClone`) match Phase-B crate API.
impl<T> Size2D<T>
where
    T: css::Parse + css::ToCss + css::Eql + css::IsCompatible + css::DeepClone + Clone,
{
    fn parse_val(input: &mut Parser) -> Result<T> {
        // PORT NOTE: f32 → CSSNumberFns::parse, LengthPercentage → LengthPercentage::parse,
        // else → T::parse — all unified under the `Parse` trait in Rust.
        T::parse(input)
    }

    pub fn parse(input: &mut Parser) -> Result<Size2D<T>> {
        let first = match Self::parse_val(input) {
            Result::Ok(vv) => vv,
            Result::Err(e) => return Result::Err(e),
        };
        let second = input.try_parse(Self::parse_val).unwrap_or(first.clone());
        Result::Ok(Size2D { a: first, b: second })
    }

    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        Self::val_to_css(&self.a, dest)?;
        if !Self::val_eql(&self.b, &self.a) {
            dest.write_str(" ")?;
            Self::val_to_css(&self.b, dest)?;
        }
        Ok(())
    }

    pub fn val_to_css(val: &T, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        // PORT NOTE: f32 → CSSNumberFns::to_css, else → val.to_css — unified under `ToCss` trait.
        val.to_css(dest)
    }

    pub fn is_compatible(&self, browsers: Browsers) -> bool {
        self.a.is_compatible(browsers) && self.b.is_compatible(browsers)
    }

    pub fn deep_clone(&self, bump: &Arena) -> Self {
        // TODO(port): css::implement_deep_clone is @typeInfo-based reflection in Zig;
        // replace with #[derive(DeepClone)] or hand-written field-wise deep_clone in Phase B.
        css::implement_deep_clone(self, bump)
    }

    #[inline]
    pub fn val_eql(lhs: &T, rhs: &T) -> bool {
        // PORT NOTE: f32 → `lhs.* == rhs.*`, else → `lhs.eql(rhs)` — unified under `Eql` trait.
        lhs.eql(rhs)
    }

    #[inline]
    pub fn eql(lhs: &Self, rhs: &Self) -> bool {
        // PORT NOTE: preserved verbatim from Zig — compares lhs.a against rhs.b only
        // (not a/a && b/b). Suspect upstream bug, but ported faithfully.
        lhs.a.eql(&rhs.b)
    }
}

// Keep references to the f32/LengthPercentage special-case helpers so Phase B can
// wire trait impls if they don't already exist.
#[allow(unused_imports)]
use {CSSNumberFns as _, LengthPercentage as _};

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/values/size.zig (76 lines)
//   confidence: medium
//   todos:      2
//   notes:      comptime `switch (T)` collapsed to trait bounds; f32/LengthPercentage need Parse/ToCss/Eql impls; eql() compares a↔b only (preserved verbatim, looks like upstream bug)
// ──────────────────────────────────────────────────────────────────────────
