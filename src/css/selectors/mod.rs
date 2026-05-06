//! CSS selector parsing and serialization.
//!
//! Hub for `selector.rs` (high-level API + downleveling) / `parser.rs`
//! (Component / Selector / SelectorList grammar) / `builder.rs`.
//!
//! ─── B-2 round 5 status ──────────────────────────────────────────────────
//! All three leaf files un-gated. `parser.rs` carries the full grammar
//! (`GenericComponent`/`GenericSelector`/`GenericSelectorList`, `Combinator`,
//! `PseudoClass`/`PseudoElement`, `attrs::*`, `NthSelectorData`/`NthType`/
//! `NthOfSelectorData`, `SpecificityAndFlags`/`SelectorFlags`,
//! `SelectorParseErrorKind`, `compute_specificity`, the recursive-descent
//! `parse_*` functions). `selector.rs` carries the high-level API
//! (`is_equivalent`/`downlevel_selectors`/`get_prefix`/`is_compatible`) and
//! the two serializer namespaces (`serialize::*`, `tocss_servo::*`).
//! `builder.rs` carries `SelectorBuilder`.
//!
//! The `impl_::Selectors` marker (Rust trait-based reshaping of Zig's
//! `selector.impl.Selectors.SelectorImpl` type-alias namespace) lives here in
//! the hub so the parser↔selector cycle has a single anchor; both files reach
//! it via `bun_css::selector::impl_` / `super::impl_`.

pub mod builder;
pub mod parser;
#[path = "selector.rs"]
pub mod selector;

pub use parser::{Component, PseudoClass, PseudoElement, Selector, SelectorList};

/// Our implementation of the `SelectorImpl` interface — the Rust-shaped
/// equivalent of Zig's `selector.impl.Selectors`. Defined in the hub (not in
/// `selector.rs`) to break the parser↔selector dependency cycle: `parser.rs`
/// needs `impl_::Selectors` to instantiate `Component`/`Selector`/
/// `SelectorList`, and `selector.rs` needs those instantiations.
pub mod impl_ {
    use crate::css_values::ident::{Ident, IdentOrRef};
    use crate::css_values::string::CssString;
    use crate::VendorPrefix;

    /// Marker type carrying the associated-type bundle for Bun's selector
    /// grammar.
    #[derive(Debug, Clone, Copy)]
    pub struct Selectors;

    impl super::parser::SelectorImpl for Selectors {
        type ExtraMatchingData = ();
        type AttrValue = CssString;
        type Identifier = Ident;
        /// An identifier which could be a local name for use in CSS modules
        type LocalIdentifier = IdentOrRef;
        type LocalName = Ident;
        type NamespacePrefix = Ident;
        // TODO(port): lifetime — Zig `[]const u8` type alias borrowing input.
        type NamespaceUrl = &'static [u8];
        type BorrowedNamespaceUrl = &'static [u8];
        type BorrowedLocalName = Ident;
        type NonTSPseudoClass = super::parser::PseudoClass;
        type PseudoElement = super::parser::PseudoElement;
        type VendorPrefix = VendorPrefix;
    }

    pub mod local_identifier {
        use super::*;
        #[inline]
        pub fn from_ident(ident: Ident) -> IdentOrRef {
            IdentOrRef::from_ident(ident)
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/selectors/ (selector.zig + parser.zig + builder.zig)
//   confidence: medium
//   todos:      0
//   notes:      hub un-gated (B-2 round 5): parser.rs/selector.rs/builder.rs compile for real; impl_::Selectors marker lives in mod.rs to anchor the parser↔selector cycle; concrete Component/Selector/SelectorList instantiate over impl_::Selectors
// ──────────────────────────────────────────────────────────────────────────
