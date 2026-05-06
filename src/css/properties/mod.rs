//! CSS property definitions.
//!
//! Ported from `src/css/properties/properties.zig`.

use crate as css;

// ─── B-2 round 3 status ────────────────────────────────────────────────────
// Hub un-gated. Every leaf property module (`align`, `background`, `border`,
// ...) bottoms out on the `values/` calc lattice (Length / Percentage /
// Angle / Color) plus `declaration::DeclarationList` and
// `context::PropertyHandlerContext`, all of which remain gated. The leaves
// stay `#[cfg(any())]`-gated below and re-expose data-only stubs for the
// handful of types `css_parser.rs` and `rules/` reach into by name.
//
// `properties_generated.rs` is a codegen placeholder (the Rust emitter for
// `generate_properties.ts` is not written yet), so `Property`/`PropertyId`/
// `PropertyIdTag` are unit stubs here matching `css_parser::gated_shims`.

macro_rules! gated_prop {
    ($name:ident) => {
        #[cfg(any())] pub mod $name;
        #[cfg(not(any()))] pub mod $name {}
    };
    ($name:ident, { $($body:tt)* }) => {
        #[cfg(any())] pub mod $name;
        #[cfg(not(any()))] pub mod $name { $($body)* }
    };
}

// ─── Submodule declarations ────────────────────────────────────────────────
// (Zig: `pub const X = @import("./X.zig");`)
gated_prop!(align);
gated_prop!(animation);
gated_prop!(background);
gated_prop!(border);
gated_prop!(border_image);
gated_prop!(border_radius);
gated_prop!(box_shadow);
gated_prop!(contain);
gated_prop!(display);
gated_prop!(effects);
gated_prop!(flex);
gated_prop!(font);
gated_prop!(grid);
gated_prop!(list);
gated_prop!(margin_padding);
gated_prop!(masking);
gated_prop!(outline);
gated_prop!(overflow);
gated_prop!(position);
gated_prop!(prefix_handler);
gated_prop!(shape);
gated_prop!(size);
gated_prop!(svg);
gated_prop!(text);
gated_prop!(transform);
gated_prop!(transition);
gated_prop!(ui);

// `css_modules`: data-only stub for `Composes`/`Specifier` so
// `css_parser::gated_shims` can later flip to `crate::properties::css_modules`.
gated_prop!(css_modules, {
    /// `composes:` declaration value (CSS Modules).
    #[derive(Default, Clone)]
    pub struct Composes;
    pub use crate::values::css_modules::Specifier;
});

// `custom`: data-only stubs for `TokenList`/`EnvironmentVariable`/
// `CustomPropertyName` so `media_query.rs` and `rules/unknown.rs` resolve.
gated_prop!(custom, {
    /// `properties::custom::TokenList` — `BabyList<TokenOrValue>` newtype.
    #[derive(Default, Clone)]
    pub struct TokenList;
    /// Associated-fn namespace for `TokenList` (Zig `TokenListFns`).
    pub struct TokenListFns;
    /// CSS `env()` reference. Data-only — parse/to_css live in the gated file.
    #[derive(Debug, Clone)]
    pub struct EnvironmentVariable;
    /// Either a `--dashed-ident` or an unknown bare property name.
    #[derive(Debug, Clone, Copy)]
    pub enum CustomPropertyName {
        Custom(crate::values::ident::DashedIdent),
        Unknown(crate::values::ident::Ident),
    }
});

#[cfg(any())]
mod properties_generated;
#[cfg(any())]
mod properties_impl;

// ─── Re-exports ────────────────────────────────────────────────────────────

pub use self::custom::CustomPropertyName;

#[cfg(any())]
pub use self::properties_generated::{Property, PropertyId, PropertyIdTag};
// Stand-ins until `generate_properties.ts` emits Rust. Unit types — every
// callsite that constructs/matches these is itself `#[cfg(any())]`-gated.
#[cfg(not(any()))]
pub type PropertyId = ();
#[cfg(not(any()))]
pub type Property = ();
#[cfg(not(any()))]
pub type PropertyIdTag = ();

/// A [CSS-wide keyword](https://drafts.csswg.org/css-cascade-5/#defaulting-keywords).
// Zig: `css.DefineEnumProperty(@This())` provides eql/hash/parse/toCss/deepClone via
// comptime reflection over @tagName. In Rust the domain protocol is a trait + derive.
// TODO(port): wire `#[derive(css::DefineEnumProperty)]` proc-macro (parse/to_css over
// kebab-case tag names) in Phase B; until then this is a plain data enum.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum CSSWideKeyword {
    /// The property's initial value.
    Initial,
    /// The property's computed value on the parent element.
    Inherit,
    /// Either inherit or initial depending on whether the property is inherited.
    Unset,
    /// Rolls back the cascade to the cascaded value of the earlier origin.
    Revert,
    /// Rolls back the cascade to the value of the previous cascade layer.
    RevertLayer,
}

// ─── Dead code (not ported) ────────────────────────────────────────────────
// The original Zig file contains ~1800 lines of commented-out code (lines 60–1876)
// implementing the old `DefineProperties(...)` comptime-reflection approach that
// predates `properties_generated.zig`. It is dead reference material and is
// intentionally omitted here. See `src/css/properties/properties.zig` for the
// historical block; the live definitions come from `properties_generated`.

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/properties/properties.zig (1886 lines)
//   confidence: high
//   todos:      1
//   notes:      hub un-gated; leaf property modules internally gated on values/ calc lattice + declaration/context; Property/PropertyId are codegen stubs until generate_properties.ts emits Rust
// ──────────────────────────────────────────────────────────────────────────
