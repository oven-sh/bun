//! CSS selector parsing and serialization.
//!
//! Hub for `selector.rs` (high-level API + downleveling) / `parser.rs`
//! (Component / Selector / SelectorList grammar) / `builder.rs`.
//!
//! ─── B-2 round 3 status ──────────────────────────────────────────────────
//! Hub un-gated. The three leaf files compile against `css_values::ident::
//! {IdentFns, CSSStringFns}`, `properties::custom::TokenList`, and the
//! `selector::serialize` helper web — all of which transitively reach the
//! gated `values/` lattice. They stay `#[cfg(any())]`-gated below; the hub
//! exposes the data-only `Selector`/`SelectorList`/`Component`/`PseudoClass`
//! /`PseudoElement` shapes so `rules::style` and `css_parser::AtRulePrelude`
//! can name them. When `parser.rs` un-gates these stubs are deleted and the
//! `pub use parser::*` line below takes over.

#[cfg(any())]
pub mod builder;
#[cfg(any())]
pub mod parser;
#[cfg(any())]
#[path = "selector.rs"]
pub mod selector;

#[cfg(not(any()))]
pub mod parser {
    /// A parsed CSS selector list (comma-separated compound selectors).
    /// Data-only stub of `selectors/parser.rs::SelectorList`.
    // PORT NOTE: real type uses `SmallList<Selector, 1>`; `SmallList` lacks
    // `Debug`/`Clone` derives, so the stub uses `Vec` until parser.rs un-gates.
    #[derive(Debug, Default, Clone)]
    pub struct SelectorList {
        pub v: Vec<Selector>,
    }

    /// A single compound selector (sequence of `Component`s with combinators).
    #[derive(Debug, Default, Clone)]
    pub struct Selector {
        pub components: Vec<Component>,
        // Real struct also carries specificity / flags — added when parser.rs un-gates.
    }
    impl Selector {
        #[inline]
        pub fn len(&self) -> usize {
            self.components.len()
        }
    }

    /// A selector component (simple selector or combinator). Variant set is a
    /// subset of the real enum — only the discriminants `selector.rs` and
    /// `rules/` pattern-match on for vendor-prefix downleveling.
    #[derive(Debug, Clone)]
    #[non_exhaustive]
    pub enum Component {
        NonTsPseudoClass(PseudoClass),
        PseudoElement(PseudoElement),
        Is(Box<[Selector]>),
        Any { vendor_prefix: crate::VendorPrefix, selectors: Box<[Selector]> },
        // remaining ~30 variants live in the gated parser.rs
    }

    /// Non-tree-structural pseudo-class (e.g. `:hover`, `:dir(ltr)`).
    #[derive(Debug, Clone)]
    #[non_exhaustive]
    pub enum PseudoClass {}

    /// Pseudo-element (e.g. `::before`, `::placeholder`).
    #[derive(Debug, Clone)]
    #[non_exhaustive]
    pub enum PseudoElement {}
}

#[cfg(not(any()))]
pub mod selector {
    //! High-level selector API stub. Real body in `selector.rs` (gated).
    pub use super::parser;
    pub use super::parser::{Component, PseudoClass, PseudoElement, Selector, SelectorList};

    /// `SelectorImpl` associated-type bundle (Servo-style).
    pub mod r#impl {}
    /// Legacy spelling — `selector.rs` and `parser.rs` both use `impl_`.
    pub use r#impl as impl_;
}

#[cfg(not(any()))]
pub mod builder {}

pub use parser::{Component, PseudoClass, PseudoElement, Selector, SelectorList};

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/selectors/ (selector.zig + parser.zig + builder.zig)
//   confidence: medium
//   todos:      0
//   notes:      hub un-gated; parser/selector/builder leaves internally gated on values/ident Fns + TokenList; SelectorList/Component stubs match css_parser::gated_shims surface
// ──────────────────────────────────────────────────────────────────────────
