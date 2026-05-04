//! CSS property definitions.
//!
//! Ported from `src/css/properties/properties.zig`.

use bun_css as css;

// ─── Submodule declarations ────────────────────────────────────────────────
// (Zig: `pub const X = @import("./X.zig");`)

pub mod align;
pub mod animation;
pub mod background;
pub mod border;
pub mod border_image;
pub mod border_radius;
pub mod box_shadow;
pub mod contain;
pub mod css_modules;
pub mod custom;
pub mod display;
pub mod effects;
pub mod flex;
pub mod font;
pub mod grid;
pub mod list;
pub mod margin_padding;
pub mod masking;
pub mod outline;
pub mod overflow;
pub mod position;
pub mod prefix_handler;
pub mod shape;
pub mod size;
pub mod svg;
pub mod text;
pub mod transform;
pub mod transition;
pub mod ui;

mod properties_generated;

// ─── Re-exports ────────────────────────────────────────────────────────────

pub use self::custom::CustomPropertyName;

pub use self::properties_generated::PropertyId;
pub use self::properties_generated::Property;
pub use self::properties_generated::PropertyIdTag;

/// A [CSS-wide keyword](https://drafts.csswg.org/css-cascade-5/#defaulting-keywords).
// Zig: `css.DefineEnumProperty(@This())` provides eql/hash/parse/toCss/deepClone via
// comptime reflection over @tagName. In Rust the domain protocol is a trait + derive.
// TODO(port): wire `#[derive(css::DefineEnumProperty)]` proc-macro (parse/to_css over
// kebab-case tag names) in Phase B.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, css::DefineEnumProperty)]
pub enum CSSWideKeyword {
    /// The property's initial value.
    #[css(name = "initial")]
    Initial,
    /// The property's computed value on the parent element.
    #[css(name = "inherit")]
    Inherit,
    /// Either inherit or initial depending on whether the property is inherited.
    #[css(name = "unset")]
    Unset,
    /// Rolls back the cascade to the cascaded value of the earlier origin.
    #[css(name = "revert")]
    Revert,
    /// Rolls back the cascade to the value of the previous cascade layer.
    #[css(name = "revert-layer")]
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
//   notes:      thin module re-exports + CSSWideKeyword; ~1800 lines of commented-out dead Zig omitted; properties_generated is codegen output
// ──────────────────────────────────────────────────────────────────────────
