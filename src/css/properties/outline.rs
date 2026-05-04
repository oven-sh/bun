use super::border::{GenericBorder, LineStyle};

/// A value for the [outline](https://drafts.csswg.org/css-ui/#outline) shorthand property.
pub type Outline = GenericBorder<OutlineStyle, 11>;

/// A value for the [outline-style](https://drafts.csswg.org/css-ui/#outline-style) property.
// `DeriveParse`/`DeriveToCss` in Zig are comptime-reflection helpers that iterate variants
// to implement the domain protocol — in Rust the protocol is a trait and we derive it.
// `implementEql`/`implementDeepClone` are field-iteration eq/clone → `#[derive(PartialEq, Clone)]`.
#[derive(Clone, PartialEq, crate::DeriveParse, crate::DeriveToCss)]
pub enum OutlineStyle {
    /// The `auto` keyword.
    Auto,
    /// A value equivalent to the `border-style` property.
    LineStyle(LineStyle),
}

impl Default for OutlineStyle {
    fn default() -> Self {
        OutlineStyle::LineStyle(LineStyle::None)
    }
}

impl OutlineStyle {
    pub fn eql(lhs: &Self, rhs: &Self) -> bool {
        lhs == rhs
    }

    pub fn deep_clone(&self, _bump: &bun_alloc::Arena) -> Self {
        // PERF(port): was arena-aware implementDeepClone — variants are POD so Clone suffices
        self.clone()
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/properties/outline.zig (33 lines)
//   confidence: high
//   todos:      0
//   notes:      DeriveParse/DeriveToCss mapped to derive macros; eql/deepClone kept as thin wrappers over derived PartialEq/Clone for callsite compat
// ──────────────────────────────────────────────────────────────────────────
