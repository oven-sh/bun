//! CSS property definitions.
//!
//! Ported from `src/css/properties/properties.zig`.

#![allow(unused_imports)]
use crate as css;

// ─── B-2 round 7 status ────────────────────────────────────────────────────
// `properties_generated.rs` is now un-gated: the 249-variant `Property` /
// `PropertyId` / `PropertyIdTag` enums are real types referenced by
// `declaration.rs`, `context.rs`, and `rules/`. The leaf property modules
// (`align`, `background`, …) remain `#[cfg(any())]`-gated — their handler
// bodies and parse/to_css impls bottom out on Parser/Printer surface that
// is still in flux — but every *value type* the `Property` enum names is
// re-exposed below as a data-only stub inside the inline `pub mod $name {}`
// body via `prop_value_stub!`. When a leaf .rs file un-gates, its real
// type replaces the stub transparently (same path, same name).
//
// `prefixes::Feature` and the entire `values/` lattice are real, so
// `PropertyId::set_prefixes_for_targets` / `from_name_and_prefix` and the
// `Property` payloads that name `css_values::*` resolve directly.

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

/// Declares a property-handler ZST with the `handle_property` / `finalize`
/// surface that `DeclarationHandler` (declaration.rs) composes over. The
/// real handler bodies live in the gated leaf .rs files; until those
/// un-gate, these no-op stubs keep `DeclarationHandler` compiling against
/// the now-real `Property` enum.
///
/// PORT NOTE: Zig handlers are plain structs with `handleProperty(*Self,
/// *const Property, *DeclarationList, *PropertyHandlerContext) bool` +
/// `finalize(*Self, *DeclarationList, *PropertyHandlerContext) void`. Same
/// shape here; lifetimes on `DeclarationList<'bump>` / context are erased
/// behind anonymous lifetimes since the stub bodies touch neither.
macro_rules! handler_stub {
    ($($Handler:ident),+ $(,)?) => {$(
        #[derive(Default)]
        pub struct $Handler;
        impl $Handler {
            #[inline]
            pub fn handle_property(
                &mut self,
                _property: &crate::properties::Property,
                _dest: &mut crate::DeclarationList<'_>,
                _context: &mut crate::PropertyHandlerContext<'_>,
            ) -> bool {
                false
            }
            #[inline]
            pub fn finalize(
                &mut self,
                _dest: &mut crate::DeclarationList<'_>,
                _context: &mut crate::PropertyHandlerContext<'_>,
            ) {
            }
        }
    )+};
}

/// Declares an opaque property-value type so `properties_generated::Property`
/// can name it while the real definition stays gated in the leaf .rs file.
/// Derives the minimal trait set the codegen `match` arms touch (none beyond
/// move/construct — `Property` itself carries no derives).
macro_rules! prop_value_stub {
    ($($T:ident),+ $(,)?) => {$(
        #[derive(Debug, Clone, Default, PartialEq)]
        pub struct $T;
        // Protocol surface so `#[derive(CssEql/CssHash/DeepClone)]` on
        // un-gated aggregates (e.g. `TokenOrValue`) that carry a still-stubbed
        // payload type-checks. Unit struct → trivial bodies.
        impl $T {
            #[inline] pub fn eql(&self, _other: &Self) -> bool { true }
            #[inline] pub fn hash(&self, _hasher: &mut ::bun_wyhash::Wyhash11) {}
            #[inline] pub fn deep_clone(&self, _bump: &::bun_alloc::Arena) -> Self { Self }
            // Serialization surface so un-gated `TokenList::to_css` /
            // `Property::value_to_css` arms that name a still-stubbed payload
            // type-check. Unit struct → no output (matches Zig zero-value
            // round-trip until the real leaf un-gates).
            #[inline] pub fn to_css(&self, _dest: &mut $crate::Printer) -> ::core::result::Result<(), $crate::PrintErr> { Ok(()) }
        }
    )+};
}

// ─── Submodule declarations ────────────────────────────────────────────────
// (Zig: `pub const X = @import("./X.zig");`)
//
// B-2 round 8: the leaf property modules below are un-gated — their value
// *types* (and handler ZSTs) compile for real and replace the former
// `prop_value_stub!` / `handler_stub!` placeholders. Heavy parse/to_css/
// handle_property *bodies* that bottom out on still-unported Parser/
// PropertyHandlerContext surface remain internally `#[cfg(any())]`-gated
// inside each leaf file (same pattern as `font.rs`).
pub mod align;
gated_prop!(animation, {
    prop_value_stub!(AnimationName);
});
pub mod background;
pub mod border;
gated_prop!(border_image, {
    handler_stub!(BorderImageHandler);
    prop_value_stub!(BorderImage, BorderImageRepeat, BorderImageSideWidth, BorderImageSlice);
});
gated_prop!(border_radius, {
    handler_stub!(BorderRadiusHandler);
    prop_value_stub!(BorderRadius);
});
gated_prop!(box_shadow, {
    handler_stub!(BoxShadowHandler);
    prop_value_stub!(BoxShadow);
});
gated_prop!(contain);
pub mod display;
gated_prop!(effects);
pub mod flex;
// `font`: un-gated — real data types (FontWeight / FontSize / FontStretch /
// FontFamily / FontStyle / FontVariantCaps / LineHeight / Font / FontHandler)
// live in `font.rs`. parse/to_css/handle_property bodies remain internally
// `#[cfg(any())]`-gated there until DeriveParse/DeriveToCss proc-macros +
// EnumProperty derive land.
pub mod font;
gated_prop!(grid);
gated_prop!(list);
pub mod margin_padding;
pub mod masking;
pub mod outline;
pub mod overflow;
pub mod position;
gated_prop!(prefix_handler, { handler_stub!(FallbackHandler); });
gated_prop!(shape);
pub mod size;
gated_prop!(svg);
pub mod text;
pub mod transform;
pub mod transition;
pub mod ui;

// `css_modules`: un-gated — real `Composes` payload (names/from/loc/
// cssparser_loc) + `Specifier` enum (Global/ImportRecordIndex) live in
// `css_modules.rs`. `Composes::to_css` stays internally `#[cfg(any())]`-gated
// on `CustomIdent::to_css` (Printer::write_ident).
pub mod css_modules;

// `custom`: un-gated — real data types (TokenList / TokenOrValue /
// CustomProperty / CustomPropertyName / UnparsedProperty / EnvironmentVariable
// / Variable / Function / UnresolvedColor / UAEnvironmentVariable) live in
// `custom.rs`. parse/to_css/deep_clone/eql/hash bodies remain internally
// `#[cfg(any())]`-gated there until their leaf deps (ident/url/color/
// generics) un-gate.
pub mod custom;

mod properties_generated;
mod properties_impl;

// ─── Re-exports ────────────────────────────────────────────────────────────

pub use self::custom::CustomPropertyName;
pub use self::properties_generated::{Property, PropertyId, PropertyIdTag};

/// A [CSS-wide keyword](https://drafts.csswg.org/css-cascade-5/#defaulting-keywords).
// Zig: `css.DefineEnumProperty(@This())` provides eql/hash/parse/toCss/deepClone via
// comptime reflection over @tagName. The Rust derive emits `EnumProperty` +
// `From<Self> for &'static str` + inherent `parse`/`to_css`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, crate::DefineEnumProperty)]
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
//   notes:      hub + properties_generated un-gated; leaf property modules remain internally gated, surfacing data-only value-type stubs for the Property enum payloads
// ──────────────────────────────────────────────────────────────────────────
