use crate::css_parser::{CssResult as Result, Parser, PrintErr, Printer};
use crate::values::protocol::{Parse, ToCss};
use bun_alloc::Arena;

/// A generic value that represents a value with two components, e.g. a border radius.
///
/// When serialized, only a single component will be written if both are equal.
pub struct Size2D<T> {
    pub(crate) a: T,
    pub(crate) b: T,
}

// Per-type dispatch is expressed via trait bounds — `f32` and
// `LengthPercentage` impl the same `Parse`/`ToCss` traits as other CSS value
// types (the `f32` impls delegate to `CSSNumberFns`).
impl<T> Size2D<T>
where
    T: Clone + PartialEq,
{
    fn parse_val(input: &mut Parser) -> Result<T>
    where
        T: Parse,
    {
        // f32 → CSSNumberFns::parse, LengthPercentage → LengthPercentage::parse,
        // else → T::parse — all unified under the `Parse` trait in Rust.
        T::parse(input)
    }

    pub(crate) fn parse(input: &mut Parser) -> Result<Size2D<T>>
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

    pub(crate) fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr>
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

    fn val_to_css(val: &T, dest: &mut Printer) -> core::result::Result<(), PrintErr>
    where
        T: ToCss,
    {
        // f32 → CSSNumberFns::to_css, else → val.to_css — unified under `ToCss` trait.
        val.to_css(dest)
    }

    pub(crate) fn deep_clone(&self, _bump: &Arena) -> Self {
        // `T: Clone` covers this (Box payloads deep-clone via their Clone impls).
        Size2D {
            a: self.a.clone(),
            b: self.b.clone(),
        }
    }

    #[inline]
    fn val_eql(lhs: &T, rhs: &T) -> bool {
        // f32 → `lhs.* == rhs.*`, else → `lhs.eql(rhs)` — unified under PartialEq.
        lhs == rhs
    }

    #[inline]
    pub(crate) fn eql(lhs: &Self, rhs: &Self) -> bool {
        // Note: compares lhs.a against rhs.b only (not a/a && b/b).
        lhs.a == rhs.b
    }
}

// Keep references to the f32/LengthPercentage special-case helpers so trait
// impls can be wired up later if they don't already exist.
