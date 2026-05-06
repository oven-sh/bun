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
    )+};
}

// ─── Submodule declarations ────────────────────────────────────────────────
// (Zig: `pub const X = @import("./X.zig");`)
gated_prop!(align, {
    handler_stub!(AlignHandler);
    prop_value_stub!(
        AlignContent, JustifyContent, PlaceContent,
        AlignSelf, JustifySelf, PlaceSelf,
        AlignItems, JustifyItems, PlaceItems,
        GapValue, Gap,
    );
});
gated_prop!(animation, {
    prop_value_stub!(AnimationName);
});
gated_prop!(background, {
    handler_stub!(BackgroundHandler);
    prop_value_stub!(
        Background, BackgroundPosition, BackgroundSize, BackgroundRepeat,
        BackgroundAttachment, BackgroundClip, BackgroundOrigin,
    );
});
gated_prop!(border, {
    handler_stub!(BorderHandler);
    prop_value_stub!(
        LineStyle, BorderSideWidth,
        BorderColor, BorderStyle, BorderWidth,
        BorderBlockColor, BorderBlockStyle, BorderBlockWidth,
        BorderInlineColor, BorderInlineStyle, BorderInlineWidth,
        Border, BorderTop, BorderBottom, BorderLeft, BorderRight,
        BorderBlock, BorderBlockStart, BorderBlockEnd,
        BorderInline, BorderInlineStart, BorderInlineEnd,
    );
});
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
gated_prop!(display, {
    prop_value_stub!(Display, Visibility);
});
gated_prop!(effects);
gated_prop!(flex, {
    handler_stub!(FlexHandler);
    prop_value_stub!(
        FlexDirection, FlexWrap, FlexFlow, Flex,
        BoxOrient, BoxDirection, BoxAlign, BoxPack, BoxLines,
        FlexPack, FlexItemAlign, FlexLinePack,
    );
});
gated_prop!(font, {
    handler_stub!(FontHandler);
    prop_value_stub!(
        FontWeight, FontSize, FontStretch, FontFamily,
        FontStyle, FontVariantCaps, LineHeight, Font,
    );
});
gated_prop!(grid);
gated_prop!(list);
gated_prop!(margin_padding, {
    // Zig: MarginHandler/PaddingHandler/ScrollMarginHandler/InsetHandler are
    // four `NewSizeHandler(...)` instantiations of one comptime-generic struct.
    handler_stub!(MarginHandler, PaddingHandler, ScrollMarginHandler, InsetHandler);
    prop_value_stub!(
        InsetBlock, InsetInline, Inset,
        MarginBlock, MarginInline, Margin,
        PaddingBlock, PaddingInline, Padding,
        ScrollMarginBlock, ScrollMarginInline, ScrollMargin,
        ScrollPaddingBlock, ScrollPaddingInline, ScrollPadding,
    );
});
gated_prop!(masking, {
    prop_value_stub!(
        MaskMode, MaskClip, MaskComposite, MaskType, Mask, MaskBorder,
        MaskBorderMode, GeometryBox, WebKitMaskComposite, WebKitMaskSourceType,
    );
});
gated_prop!(outline, {
    prop_value_stub!(Outline, OutlineStyle);
});
gated_prop!(overflow, {
    prop_value_stub!(Overflow, OverflowKeyword, TextOverflow);
});
gated_prop!(position, {
    prop_value_stub!(Position);
});
gated_prop!(prefix_handler, { handler_stub!(FallbackHandler); });
gated_prop!(shape);
gated_prop!(size, {
    handler_stub!(SizeHandler);
    prop_value_stub!(Size, MaxSize, BoxSizing, AspectRatio);
});
gated_prop!(svg);
gated_prop!(text, {
    /// [direction](https://drafts.csswg.org/css-writing-modes-3/#direction)
    /// — data-only mirror of the gated `text.rs` enum so
    /// `DeclarationHandler.direction: Option<Direction>` and
    /// `Property::Direction(..)` compile.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
    pub enum Direction { Ltr, Rtl }
    prop_value_stub!(TextShadow);
});
gated_prop!(transform, {
    handler_stub!(TransformHandler);
    // PORT NOTE: real `TransformList<'bump>` is bump-allocated; the codegen
    // `Property` enum is lifetime-free, so the stub is a plain owned type.
    prop_value_stub!(
        TransformList, TransformStyle, TransformBox, BackfaceVisibility,
        Perspective, Translate, Rotate, Scale,
    );
});
gated_prop!(transition, {
    handler_stub!(TransitionHandler);
    prop_value_stub!(Transition);
});
gated_prop!(ui, {
    handler_stub!(ColorSchemeHandler);
    prop_value_stub!(ColorScheme);
});

// `css_modules`: data-only stub for `Composes`/`Specifier` so
// `css_parser::gated_shims` can later flip to `crate::properties::css_modules`.
gated_prop!(css_modules, {
    /// `composes:` declaration value (CSS Modules).
    #[derive(Debug, Default, Clone, PartialEq)]
    pub struct Composes;
    pub use crate::values::css_modules::Specifier;
});

// `custom`: data-only stubs for `TokenList`/`EnvironmentVariable`/
// `CustomPropertyName`/`CustomProperty`/`UnparsedProperty` so
// `properties_generated` and `media_query.rs`/`rules/unknown.rs` resolve.
gated_prop!(custom, {
    use crate::values::ident::{DashedIdent, Ident};

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
        Custom(DashedIdent),
        Unknown(Ident),
    }
    // PORT NOTE: `DashedIdent`/`Ident` carry `*const [u8]` arena slices and
    // intentionally don't derive `PartialEq` (pointer-eq would be wrong).
    // `PropertyId` derives `PartialEq`, so compare the underlying bytes here.
    impl PartialEq for CustomPropertyName {
        fn eq(&self, other: &Self) -> bool {
            // SAFETY: arena-owned slices live for the parse session.
            unsafe { (&*self.as_ptr()).eq(&*other.as_ptr()) }
        }
    }
    impl CustomPropertyName {
        #[inline]
        fn as_ptr(&self) -> *const [u8] {
            match self {
                CustomPropertyName::Custom(d) => d.v,
                CustomPropertyName::Unknown(i) => i.v,
            }
        }
        /// Borrow the underlying name slice. SAFETY: see `DashedIdent::as_slice`.
        #[inline]
        pub fn as_str(&self) -> &[u8] {
            unsafe { &*self.as_ptr() }
        }
        pub fn from_str(name: &[u8]) -> CustomPropertyName {
            if name.starts_with(b"--") {
                CustomPropertyName::Custom(DashedIdent { v: name as *const [u8] })
            } else {
                CustomPropertyName::Unknown(Ident { v: name as *const [u8] })
            }
        }
        pub fn to_css(&self, dest: &mut crate::Printer) -> Result<(), crate::PrintErr> {
            // TODO(port): real impl serializes via `serialize_identifier` /
            // `write_dashed_ident`; stubbed until `custom.rs` un-gates.
            dest.write_str(self.as_str())
        }
    }

    /// A known property whose value could not be parsed.
    pub struct UnparsedProperty {
        pub property_id: crate::properties::PropertyId,
        pub value: TokenList,
    }

    /// A `--custom: <token-list>` declaration.
    pub struct CustomProperty {
        pub name: CustomPropertyName,
        pub value: TokenList,
    }
});

mod properties_generated;
mod properties_impl;

// ─── Re-exports ────────────────────────────────────────────────────────────

pub use self::custom::CustomPropertyName;
pub use self::properties_generated::{Property, PropertyId, PropertyIdTag};

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
//   notes:      hub + properties_generated un-gated; leaf property modules remain internally gated, surfacing data-only value-type stubs for the Property enum payloads
// ──────────────────────────────────────────────────────────────────────────
