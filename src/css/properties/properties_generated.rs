// Hand-maintained.
//
// Type paths below resolve against `super::*` (the leaf property
// modules — currently data-only stub bodies in `mod.rs`) and
// `crate::css_values`.

#![allow(non_camel_case_types)]

use crate as css;
use crate::SmallList;
use crate::VendorPrefix;
use crate::prefixes::Feature as PrefixFeature;
use crate::targets::Targets;

use super::CSSWideKeyword;
use super::custom::{CustomProperty, CustomPropertyName, UnparsedProperty};
use super::properties_impl;

// Leaf property modules.
use super::align;
use super::animation;
use super::background;
use super::border;
use super::border_image;
use super::border_radius;
use super::box_shadow;
use super::css_modules;
use super::display;
use super::flex;
use super::font;
use super::margin_padding;
use super::masking;
use super::outline;
use super::overflow;
use super::position;
use super::size;
use super::text;
use super::transform;
use super::transition;
use super::ui;

/// Discriminant-only tag for [`Property`] / [`PropertyId`].
#[repr(u16)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum PropertyIdTag {
    BackgroundColor,
    BackgroundImage,
    BackgroundPositionX,
    BackgroundPositionY,
    BackgroundPosition,
    BackgroundSize,
    BackgroundRepeat,
    BackgroundAttachment,
    BackgroundClip,
    BackgroundOrigin,
    Background,
    BoxShadow,
    Opacity,
    Color,
    Display,
    Visibility,
    Width,
    Height,
    MinWidth,
    MinHeight,
    MaxWidth,
    MaxHeight,
    BlockSize,
    InlineSize,
    MinBlockSize,
    MinInlineSize,
    MaxBlockSize,
    MaxInlineSize,
    BoxSizing,
    AspectRatio,
    Overflow,
    OverflowX,
    OverflowY,
    TextOverflow,
    Position,
    Top,
    Bottom,
    Left,
    Right,
    InsetBlockStart,
    InsetBlockEnd,
    InsetInlineStart,
    InsetInlineEnd,
    InsetBlock,
    InsetInline,
    Inset,
    BorderSpacing,
    BorderTopColor,
    BorderBottomColor,
    BorderLeftColor,
    BorderRightColor,
    BorderBlockStartColor,
    BorderBlockEndColor,
    BorderInlineStartColor,
    BorderInlineEndColor,
    BorderTopStyle,
    BorderBottomStyle,
    BorderLeftStyle,
    BorderRightStyle,
    BorderBlockStartStyle,
    BorderBlockEndStyle,
    BorderInlineStartStyle,
    BorderInlineEndStyle,
    BorderTopWidth,
    BorderBottomWidth,
    BorderLeftWidth,
    BorderRightWidth,
    BorderBlockStartWidth,
    BorderBlockEndWidth,
    BorderInlineStartWidth,
    BorderInlineEndWidth,
    BorderTopLeftRadius,
    BorderTopRightRadius,
    BorderBottomLeftRadius,
    BorderBottomRightRadius,
    BorderStartStartRadius,
    BorderStartEndRadius,
    BorderEndStartRadius,
    BorderEndEndRadius,
    BorderRadius,
    BorderImageSource,
    BorderImageOutset,
    BorderImageRepeat,
    BorderImageWidth,
    BorderImageSlice,
    BorderImage,
    BorderColor,
    BorderStyle,
    BorderWidth,
    BorderBlockColor,
    BorderBlockStyle,
    BorderBlockWidth,
    BorderInlineColor,
    BorderInlineStyle,
    BorderInlineWidth,
    Border,
    BorderTop,
    BorderBottom,
    BorderLeft,
    BorderRight,
    BorderBlock,
    BorderBlockStart,
    BorderBlockEnd,
    BorderInline,
    BorderInlineStart,
    BorderInlineEnd,
    Outline,
    OutlineColor,
    OutlineStyle,
    OutlineWidth,
    FlexDirection,
    FlexWrap,
    FlexFlow,
    FlexGrow,
    FlexShrink,
    FlexBasis,
    Flex,
    Order,
    AlignContent,
    JustifyContent,
    PlaceContent,
    AlignSelf,
    JustifySelf,
    PlaceSelf,
    AlignItems,
    JustifyItems,
    PlaceItems,
    RowGap,
    ColumnGap,
    Gap,
    BoxOrient,
    BoxDirection,
    BoxOrdinalGroup,
    BoxAlign,
    BoxFlex,
    BoxFlexGroup,
    BoxPack,
    BoxLines,
    FlexPack,
    FlexOrder,
    FlexAlign,
    FlexItemAlign,
    FlexLinePack,
    FlexPositive,
    FlexNegative,
    FlexPreferredSize,
    MarginTop,
    MarginBottom,
    MarginLeft,
    MarginRight,
    MarginBlockStart,
    MarginBlockEnd,
    MarginInlineStart,
    MarginInlineEnd,
    MarginBlock,
    MarginInline,
    Margin,
    PaddingTop,
    PaddingBottom,
    PaddingLeft,
    PaddingRight,
    PaddingBlockStart,
    PaddingBlockEnd,
    PaddingInlineStart,
    PaddingInlineEnd,
    PaddingBlock,
    PaddingInline,
    Padding,
    ScrollMarginTop,
    ScrollMarginBottom,
    ScrollMarginLeft,
    ScrollMarginRight,
    ScrollMarginBlockStart,
    ScrollMarginBlockEnd,
    ScrollMarginInlineStart,
    ScrollMarginInlineEnd,
    ScrollMarginBlock,
    ScrollMarginInline,
    ScrollMargin,
    ScrollPaddingTop,
    ScrollPaddingBottom,
    ScrollPaddingLeft,
    ScrollPaddingRight,
    ScrollPaddingBlockStart,
    ScrollPaddingBlockEnd,
    ScrollPaddingInlineStart,
    ScrollPaddingInlineEnd,
    ScrollPaddingBlock,
    ScrollPaddingInline,
    ScrollPadding,
    FontWeight,
    FontSize,
    FontStretch,
    FontFamily,
    FontStyle,
    FontVariantCaps,
    LineHeight,
    Font,
    TransitionProperty,
    TransitionDuration,
    TransitionDelay,
    TransitionTimingFunction,
    Transition,
    Animation,
    AnimationName,
    Transform,
    TransformOrigin,
    TransformStyle,
    TransformBox,
    BackfaceVisibility,
    Perspective,
    PerspectiveOrigin,
    Translate,
    Rotate,
    Scale,
    TextDecorationColor,
    TextEmphasisColor,
    TextShadow,
    Direction,
    Composes,
    MaskImage,
    MaskMode,
    MaskRepeat,
    MaskPositionX,
    MaskPositionY,
    MaskPosition,
    MaskClip,
    MaskOrigin,
    MaskSize,
    MaskComposite,
    MaskType,
    Mask,
    MaskBorderSource,
    MaskBorderMode,
    MaskBorderSlice,
    MaskBorderWidth,
    MaskBorderOutset,
    MaskBorderRepeat,
    MaskBorder,
    WebKitMaskComposite,
    MaskSourceType,
    MaskBoxImage,
    MaskBoxImageSource,
    MaskBoxImageSlice,
    MaskBoxImageWidth,
    MaskBoxImageOutset,
    MaskBoxImageRepeat,
    ColorScheme,
    ViewTransitionName,
    ViewTransitionClass,
    ViewTransitionGroup,
    All,
    Unparsed,
    Custom,
}

impl PropertyIdTag {
    /// The caniuse `prefixes::Feature` that governs this property's vendor
    /// prefixes, if one exists. Returns `None` for unprefixed properties *and*
    /// for the 23 prefixed-but-unmapped legacy properties (`box-orient`,
    /// `flex-pack`, `mask-box-image-*`, …) that have no `Feature` entry.
    pub(crate) const fn prefix_feature(self) -> Option<PrefixFeature> {
        use PropertyIdTag as T;
        Some(match self {
            T::BackgroundClip => PrefixFeature::BackgroundClip,
            T::BoxShadow => PrefixFeature::BoxShadow,
            T::BoxSizing => PrefixFeature::BoxSizing,
            T::TextOverflow => PrefixFeature::TextOverflow,
            T::BorderTopLeftRadius => PrefixFeature::BorderTopLeftRadius,
            T::BorderTopRightRadius => PrefixFeature::BorderTopRightRadius,
            T::BorderBottomLeftRadius => PrefixFeature::BorderBottomLeftRadius,
            T::BorderBottomRightRadius => PrefixFeature::BorderBottomRightRadius,
            T::BorderRadius => PrefixFeature::BorderRadius,
            T::BorderImage => PrefixFeature::BorderImage,
            T::FlexDirection => PrefixFeature::FlexDirection,
            T::FlexWrap => PrefixFeature::FlexWrap,
            T::FlexFlow => PrefixFeature::FlexFlow,
            T::FlexGrow => PrefixFeature::FlexGrow,
            T::FlexShrink => PrefixFeature::FlexShrink,
            T::FlexBasis => PrefixFeature::FlexBasis,
            T::Flex => PrefixFeature::Flex,
            T::Order => PrefixFeature::Order,
            T::AlignContent => PrefixFeature::AlignContent,
            T::JustifyContent => PrefixFeature::JustifyContent,
            T::AlignSelf => PrefixFeature::AlignSelf,
            T::AlignItems => PrefixFeature::AlignItems,
            T::TransitionProperty => PrefixFeature::TransitionProperty,
            T::TransitionDuration => PrefixFeature::TransitionDuration,
            T::TransitionDelay => PrefixFeature::TransitionDelay,
            T::TransitionTimingFunction => PrefixFeature::TransitionTimingFunction,
            T::Transition => PrefixFeature::Transition,
            T::Animation => PrefixFeature::Animation,
            T::AnimationName => PrefixFeature::AnimationName,
            T::Transform => PrefixFeature::Transform,
            T::TransformOrigin => PrefixFeature::TransformOrigin,
            T::TransformStyle => PrefixFeature::TransformStyle,
            T::BackfaceVisibility => PrefixFeature::BackfaceVisibility,
            T::Perspective => PrefixFeature::Perspective,
            T::PerspectiveOrigin => PrefixFeature::PerspectiveOrigin,
            T::TextDecorationColor => PrefixFeature::TextDecorationColor,
            T::TextEmphasisColor => PrefixFeature::TextEmphasisColor,
            T::MaskImage => PrefixFeature::MaskImage,
            T::MaskRepeat => PrefixFeature::MaskRepeat,
            T::MaskPosition => PrefixFeature::MaskPosition,
            T::MaskClip => PrefixFeature::MaskClip,
            T::MaskOrigin => PrefixFeature::MaskOrigin,
            T::MaskSize => PrefixFeature::MaskSize,
            T::Mask => PrefixFeature::Mask,
            _ => return None,
        })
    }

    /// Kebab-case CSS property name.
    pub const fn name(self) -> &'static [u8] {
        match self {
            PropertyIdTag::BackgroundColor => b"background-color",
            PropertyIdTag::BackgroundImage => b"background-image",
            PropertyIdTag::BackgroundPositionX => b"background-position-x",
            PropertyIdTag::BackgroundPositionY => b"background-position-y",
            PropertyIdTag::BackgroundPosition => b"background-position",
            PropertyIdTag::BackgroundSize => b"background-size",
            PropertyIdTag::BackgroundRepeat => b"background-repeat",
            PropertyIdTag::BackgroundAttachment => b"background-attachment",
            PropertyIdTag::BackgroundClip => b"background-clip",
            PropertyIdTag::BackgroundOrigin => b"background-origin",
            PropertyIdTag::Background => b"background",
            PropertyIdTag::BoxShadow => b"box-shadow",
            PropertyIdTag::Opacity => b"opacity",
            PropertyIdTag::Color => b"color",
            PropertyIdTag::Display => b"display",
            PropertyIdTag::Visibility => b"visibility",
            PropertyIdTag::Width => b"width",
            PropertyIdTag::Height => b"height",
            PropertyIdTag::MinWidth => b"min-width",
            PropertyIdTag::MinHeight => b"min-height",
            PropertyIdTag::MaxWidth => b"max-width",
            PropertyIdTag::MaxHeight => b"max-height",
            PropertyIdTag::BlockSize => b"block-size",
            PropertyIdTag::InlineSize => b"inline-size",
            PropertyIdTag::MinBlockSize => b"min-block-size",
            PropertyIdTag::MinInlineSize => b"min-inline-size",
            PropertyIdTag::MaxBlockSize => b"max-block-size",
            PropertyIdTag::MaxInlineSize => b"max-inline-size",
            PropertyIdTag::BoxSizing => b"box-sizing",
            PropertyIdTag::AspectRatio => b"aspect-ratio",
            PropertyIdTag::Overflow => b"overflow",
            PropertyIdTag::OverflowX => b"overflow-x",
            PropertyIdTag::OverflowY => b"overflow-y",
            PropertyIdTag::TextOverflow => b"text-overflow",
            PropertyIdTag::Position => b"position",
            PropertyIdTag::Top => b"top",
            PropertyIdTag::Bottom => b"bottom",
            PropertyIdTag::Left => b"left",
            PropertyIdTag::Right => b"right",
            PropertyIdTag::InsetBlockStart => b"inset-block-start",
            PropertyIdTag::InsetBlockEnd => b"inset-block-end",
            PropertyIdTag::InsetInlineStart => b"inset-inline-start",
            PropertyIdTag::InsetInlineEnd => b"inset-inline-end",
            PropertyIdTag::InsetBlock => b"inset-block",
            PropertyIdTag::InsetInline => b"inset-inline",
            PropertyIdTag::Inset => b"inset",
            PropertyIdTag::BorderSpacing => b"border-spacing",
            PropertyIdTag::BorderTopColor => b"border-top-color",
            PropertyIdTag::BorderBottomColor => b"border-bottom-color",
            PropertyIdTag::BorderLeftColor => b"border-left-color",
            PropertyIdTag::BorderRightColor => b"border-right-color",
            PropertyIdTag::BorderBlockStartColor => b"border-block-start-color",
            PropertyIdTag::BorderBlockEndColor => b"border-block-end-color",
            PropertyIdTag::BorderInlineStartColor => b"border-inline-start-color",
            PropertyIdTag::BorderInlineEndColor => b"border-inline-end-color",
            PropertyIdTag::BorderTopStyle => b"border-top-style",
            PropertyIdTag::BorderBottomStyle => b"border-bottom-style",
            PropertyIdTag::BorderLeftStyle => b"border-left-style",
            PropertyIdTag::BorderRightStyle => b"border-right-style",
            PropertyIdTag::BorderBlockStartStyle => b"border-block-start-style",
            PropertyIdTag::BorderBlockEndStyle => b"border-block-end-style",
            PropertyIdTag::BorderInlineStartStyle => b"border-inline-start-style",
            PropertyIdTag::BorderInlineEndStyle => b"border-inline-end-style",
            PropertyIdTag::BorderTopWidth => b"border-top-width",
            PropertyIdTag::BorderBottomWidth => b"border-bottom-width",
            PropertyIdTag::BorderLeftWidth => b"border-left-width",
            PropertyIdTag::BorderRightWidth => b"border-right-width",
            PropertyIdTag::BorderBlockStartWidth => b"border-block-start-width",
            PropertyIdTag::BorderBlockEndWidth => b"border-block-end-width",
            PropertyIdTag::BorderInlineStartWidth => b"border-inline-start-width",
            PropertyIdTag::BorderInlineEndWidth => b"border-inline-end-width",
            PropertyIdTag::BorderTopLeftRadius => b"border-top-left-radius",
            PropertyIdTag::BorderTopRightRadius => b"border-top-right-radius",
            PropertyIdTag::BorderBottomLeftRadius => b"border-bottom-left-radius",
            PropertyIdTag::BorderBottomRightRadius => b"border-bottom-right-radius",
            PropertyIdTag::BorderStartStartRadius => b"border-start-start-radius",
            PropertyIdTag::BorderStartEndRadius => b"border-start-end-radius",
            PropertyIdTag::BorderEndStartRadius => b"border-end-start-radius",
            PropertyIdTag::BorderEndEndRadius => b"border-end-end-radius",
            PropertyIdTag::BorderRadius => b"border-radius",
            PropertyIdTag::BorderImageSource => b"border-image-source",
            PropertyIdTag::BorderImageOutset => b"border-image-outset",
            PropertyIdTag::BorderImageRepeat => b"border-image-repeat",
            PropertyIdTag::BorderImageWidth => b"border-image-width",
            PropertyIdTag::BorderImageSlice => b"border-image-slice",
            PropertyIdTag::BorderImage => b"border-image",
            PropertyIdTag::BorderColor => b"border-color",
            PropertyIdTag::BorderStyle => b"border-style",
            PropertyIdTag::BorderWidth => b"border-width",
            PropertyIdTag::BorderBlockColor => b"border-block-color",
            PropertyIdTag::BorderBlockStyle => b"border-block-style",
            PropertyIdTag::BorderBlockWidth => b"border-block-width",
            PropertyIdTag::BorderInlineColor => b"border-inline-color",
            PropertyIdTag::BorderInlineStyle => b"border-inline-style",
            PropertyIdTag::BorderInlineWidth => b"border-inline-width",
            PropertyIdTag::Border => b"border",
            PropertyIdTag::BorderTop => b"border-top",
            PropertyIdTag::BorderBottom => b"border-bottom",
            PropertyIdTag::BorderLeft => b"border-left",
            PropertyIdTag::BorderRight => b"border-right",
            PropertyIdTag::BorderBlock => b"border-block",
            PropertyIdTag::BorderBlockStart => b"border-block-start",
            PropertyIdTag::BorderBlockEnd => b"border-block-end",
            PropertyIdTag::BorderInline => b"border-inline",
            PropertyIdTag::BorderInlineStart => b"border-inline-start",
            PropertyIdTag::BorderInlineEnd => b"border-inline-end",
            PropertyIdTag::Outline => b"outline",
            PropertyIdTag::OutlineColor => b"outline-color",
            PropertyIdTag::OutlineStyle => b"outline-style",
            PropertyIdTag::OutlineWidth => b"outline-width",
            PropertyIdTag::FlexDirection => b"flex-direction",
            PropertyIdTag::FlexWrap => b"flex-wrap",
            PropertyIdTag::FlexFlow => b"flex-flow",
            PropertyIdTag::FlexGrow => b"flex-grow",
            PropertyIdTag::FlexShrink => b"flex-shrink",
            PropertyIdTag::FlexBasis => b"flex-basis",
            PropertyIdTag::Flex => b"flex",
            PropertyIdTag::Order => b"order",
            PropertyIdTag::AlignContent => b"align-content",
            PropertyIdTag::JustifyContent => b"justify-content",
            PropertyIdTag::PlaceContent => b"place-content",
            PropertyIdTag::AlignSelf => b"align-self",
            PropertyIdTag::JustifySelf => b"justify-self",
            PropertyIdTag::PlaceSelf => b"place-self",
            PropertyIdTag::AlignItems => b"align-items",
            PropertyIdTag::JustifyItems => b"justify-items",
            PropertyIdTag::PlaceItems => b"place-items",
            PropertyIdTag::RowGap => b"row-gap",
            PropertyIdTag::ColumnGap => b"column-gap",
            PropertyIdTag::Gap => b"gap",
            PropertyIdTag::BoxOrient => b"box-orient",
            PropertyIdTag::BoxDirection => b"box-direction",
            PropertyIdTag::BoxOrdinalGroup => b"box-ordinal-group",
            PropertyIdTag::BoxAlign => b"box-align",
            PropertyIdTag::BoxFlex => b"box-flex",
            PropertyIdTag::BoxFlexGroup => b"box-flex-group",
            PropertyIdTag::BoxPack => b"box-pack",
            PropertyIdTag::BoxLines => b"box-lines",
            PropertyIdTag::FlexPack => b"flex-pack",
            PropertyIdTag::FlexOrder => b"flex-order",
            PropertyIdTag::FlexAlign => b"flex-align",
            PropertyIdTag::FlexItemAlign => b"flex-item-align",
            PropertyIdTag::FlexLinePack => b"flex-line-pack",
            PropertyIdTag::FlexPositive => b"flex-positive",
            PropertyIdTag::FlexNegative => b"flex-negative",
            PropertyIdTag::FlexPreferredSize => b"flex-preferred-size",
            PropertyIdTag::MarginTop => b"margin-top",
            PropertyIdTag::MarginBottom => b"margin-bottom",
            PropertyIdTag::MarginLeft => b"margin-left",
            PropertyIdTag::MarginRight => b"margin-right",
            PropertyIdTag::MarginBlockStart => b"margin-block-start",
            PropertyIdTag::MarginBlockEnd => b"margin-block-end",
            PropertyIdTag::MarginInlineStart => b"margin-inline-start",
            PropertyIdTag::MarginInlineEnd => b"margin-inline-end",
            PropertyIdTag::MarginBlock => b"margin-block",
            PropertyIdTag::MarginInline => b"margin-inline",
            PropertyIdTag::Margin => b"margin",
            PropertyIdTag::PaddingTop => b"padding-top",
            PropertyIdTag::PaddingBottom => b"padding-bottom",
            PropertyIdTag::PaddingLeft => b"padding-left",
            PropertyIdTag::PaddingRight => b"padding-right",
            PropertyIdTag::PaddingBlockStart => b"padding-block-start",
            PropertyIdTag::PaddingBlockEnd => b"padding-block-end",
            PropertyIdTag::PaddingInlineStart => b"padding-inline-start",
            PropertyIdTag::PaddingInlineEnd => b"padding-inline-end",
            PropertyIdTag::PaddingBlock => b"padding-block",
            PropertyIdTag::PaddingInline => b"padding-inline",
            PropertyIdTag::Padding => b"padding",
            PropertyIdTag::ScrollMarginTop => b"scroll-margin-top",
            PropertyIdTag::ScrollMarginBottom => b"scroll-margin-bottom",
            PropertyIdTag::ScrollMarginLeft => b"scroll-margin-left",
            PropertyIdTag::ScrollMarginRight => b"scroll-margin-right",
            PropertyIdTag::ScrollMarginBlockStart => b"scroll-margin-block-start",
            PropertyIdTag::ScrollMarginBlockEnd => b"scroll-margin-block-end",
            PropertyIdTag::ScrollMarginInlineStart => b"scroll-margin-inline-start",
            PropertyIdTag::ScrollMarginInlineEnd => b"scroll-margin-inline-end",
            PropertyIdTag::ScrollMarginBlock => b"scroll-margin-block",
            PropertyIdTag::ScrollMarginInline => b"scroll-margin-inline",
            PropertyIdTag::ScrollMargin => b"scroll-margin",
            PropertyIdTag::ScrollPaddingTop => b"scroll-padding-top",
            PropertyIdTag::ScrollPaddingBottom => b"scroll-padding-bottom",
            PropertyIdTag::ScrollPaddingLeft => b"scroll-padding-left",
            PropertyIdTag::ScrollPaddingRight => b"scroll-padding-right",
            PropertyIdTag::ScrollPaddingBlockStart => b"scroll-padding-block-start",
            PropertyIdTag::ScrollPaddingBlockEnd => b"scroll-padding-block-end",
            PropertyIdTag::ScrollPaddingInlineStart => b"scroll-padding-inline-start",
            PropertyIdTag::ScrollPaddingInlineEnd => b"scroll-padding-inline-end",
            PropertyIdTag::ScrollPaddingBlock => b"scroll-padding-block",
            PropertyIdTag::ScrollPaddingInline => b"scroll-padding-inline",
            PropertyIdTag::ScrollPadding => b"scroll-padding",
            PropertyIdTag::FontWeight => b"font-weight",
            PropertyIdTag::FontSize => b"font-size",
            PropertyIdTag::FontStretch => b"font-stretch",
            PropertyIdTag::FontFamily => b"font-family",
            PropertyIdTag::FontStyle => b"font-style",
            PropertyIdTag::FontVariantCaps => b"font-variant-caps",
            PropertyIdTag::LineHeight => b"line-height",
            PropertyIdTag::Font => b"font",
            PropertyIdTag::TransitionProperty => b"transition-property",
            PropertyIdTag::TransitionDuration => b"transition-duration",
            PropertyIdTag::TransitionDelay => b"transition-delay",
            PropertyIdTag::TransitionTimingFunction => b"transition-timing-function",
            PropertyIdTag::Transition => b"transition",
            PropertyIdTag::Animation => b"animation",
            PropertyIdTag::AnimationName => b"animation-name",
            PropertyIdTag::Transform => b"transform",
            PropertyIdTag::TransformOrigin => b"transform-origin",
            PropertyIdTag::TransformStyle => b"transform-style",
            PropertyIdTag::TransformBox => b"transform-box",
            PropertyIdTag::BackfaceVisibility => b"backface-visibility",
            PropertyIdTag::Perspective => b"perspective",
            PropertyIdTag::PerspectiveOrigin => b"perspective-origin",
            PropertyIdTag::Translate => b"translate",
            PropertyIdTag::Rotate => b"rotate",
            PropertyIdTag::Scale => b"scale",
            PropertyIdTag::TextDecorationColor => b"text-decoration-color",
            PropertyIdTag::TextEmphasisColor => b"text-emphasis-color",
            PropertyIdTag::TextShadow => b"text-shadow",
            PropertyIdTag::Direction => b"direction",
            PropertyIdTag::Composes => b"composes",
            PropertyIdTag::MaskImage => b"mask-image",
            PropertyIdTag::MaskMode => b"mask-mode",
            PropertyIdTag::MaskRepeat => b"mask-repeat",
            PropertyIdTag::MaskPositionX => b"mask-position-x",
            PropertyIdTag::MaskPositionY => b"mask-position-y",
            PropertyIdTag::MaskPosition => b"mask-position",
            PropertyIdTag::MaskClip => b"mask-clip",
            PropertyIdTag::MaskOrigin => b"mask-origin",
            PropertyIdTag::MaskSize => b"mask-size",
            PropertyIdTag::MaskComposite => b"mask-composite",
            PropertyIdTag::MaskType => b"mask-type",
            PropertyIdTag::Mask => b"mask",
            PropertyIdTag::MaskBorderSource => b"mask-border-source",
            PropertyIdTag::MaskBorderMode => b"mask-border-mode",
            PropertyIdTag::MaskBorderSlice => b"mask-border-slice",
            PropertyIdTag::MaskBorderWidth => b"mask-border-width",
            PropertyIdTag::MaskBorderOutset => b"mask-border-outset",
            PropertyIdTag::MaskBorderRepeat => b"mask-border-repeat",
            PropertyIdTag::MaskBorder => b"mask-border",
            PropertyIdTag::WebKitMaskComposite => b"-webkit-mask-composite",
            PropertyIdTag::MaskSourceType => b"mask-source-type",
            PropertyIdTag::MaskBoxImage => b"mask-box-image",
            PropertyIdTag::MaskBoxImageSource => b"mask-box-image-source",
            PropertyIdTag::MaskBoxImageSlice => b"mask-box-image-slice",
            PropertyIdTag::MaskBoxImageWidth => b"mask-box-image-width",
            PropertyIdTag::MaskBoxImageOutset => b"mask-box-image-outset",
            PropertyIdTag::MaskBoxImageRepeat => b"mask-box-image-repeat",
            PropertyIdTag::ColorScheme => b"color-scheme",
            PropertyIdTag::ViewTransitionName => b"view-transition-name",
            PropertyIdTag::ViewTransitionClass => b"view-transition-class",
            PropertyIdTag::ViewTransitionGroup => b"view-transition-group",
            PropertyIdTag::All => b"all",
            PropertyIdTag::Unparsed => b"unparsed",
            PropertyIdTag::Custom => b"custom",
        }
    }
}

/// A known CSS property name + (for prefixable properties) the vendor
/// prefix it was parsed with. Variants without payload are unprefixed.
//
// Do NOT `#[derive(PartialEq, Eq)]` here — the spec-correct
// equality ignores the
// `Custom(CustomPropertyName)` payload and is hand-written below. A derived
// impl would (a) conflict (E0119) and (b) diverge by comparing custom-name
// bytes.
#[derive(Debug, Clone, Copy)]
pub enum PropertyId {
    BackgroundColor,
    BackgroundImage,
    BackgroundPositionX,
    BackgroundPositionY,
    BackgroundPosition,
    BackgroundSize,
    BackgroundRepeat,
    BackgroundAttachment,
    BackgroundClip(VendorPrefix),
    BackgroundOrigin,
    Background,
    BoxShadow(VendorPrefix),
    Opacity,
    Color,
    Display,
    Visibility,
    Width,
    Height,
    MinWidth,
    MinHeight,
    MaxWidth,
    MaxHeight,
    BlockSize,
    InlineSize,
    MinBlockSize,
    MinInlineSize,
    MaxBlockSize,
    MaxInlineSize,
    BoxSizing(VendorPrefix),
    AspectRatio,
    Overflow,
    OverflowX,
    OverflowY,
    TextOverflow(VendorPrefix),
    Position,
    Top,
    Bottom,
    Left,
    Right,
    InsetBlockStart,
    InsetBlockEnd,
    InsetInlineStart,
    InsetInlineEnd,
    InsetBlock,
    InsetInline,
    Inset,
    BorderSpacing,
    BorderTopColor,
    BorderBottomColor,
    BorderLeftColor,
    BorderRightColor,
    BorderBlockStartColor,
    BorderBlockEndColor,
    BorderInlineStartColor,
    BorderInlineEndColor,
    BorderTopStyle,
    BorderBottomStyle,
    BorderLeftStyle,
    BorderRightStyle,
    BorderBlockStartStyle,
    BorderBlockEndStyle,
    BorderInlineStartStyle,
    BorderInlineEndStyle,
    BorderTopWidth,
    BorderBottomWidth,
    BorderLeftWidth,
    BorderRightWidth,
    BorderBlockStartWidth,
    BorderBlockEndWidth,
    BorderInlineStartWidth,
    BorderInlineEndWidth,
    BorderTopLeftRadius(VendorPrefix),
    BorderTopRightRadius(VendorPrefix),
    BorderBottomLeftRadius(VendorPrefix),
    BorderBottomRightRadius(VendorPrefix),
    BorderStartStartRadius,
    BorderStartEndRadius,
    BorderEndStartRadius,
    BorderEndEndRadius,
    BorderRadius(VendorPrefix),
    BorderImageSource,
    BorderImageOutset,
    BorderImageRepeat,
    BorderImageWidth,
    BorderImageSlice,
    BorderImage(VendorPrefix),
    BorderColor,
    BorderStyle,
    BorderWidth,
    BorderBlockColor,
    BorderBlockStyle,
    BorderBlockWidth,
    BorderInlineColor,
    BorderInlineStyle,
    BorderInlineWidth,
    Border,
    BorderTop,
    BorderBottom,
    BorderLeft,
    BorderRight,
    BorderBlock,
    BorderBlockStart,
    BorderBlockEnd,
    BorderInline,
    BorderInlineStart,
    BorderInlineEnd,
    Outline,
    OutlineColor,
    OutlineStyle,
    OutlineWidth,
    FlexDirection(VendorPrefix),
    FlexWrap(VendorPrefix),
    FlexFlow(VendorPrefix),
    FlexGrow(VendorPrefix),
    FlexShrink(VendorPrefix),
    FlexBasis(VendorPrefix),
    Flex(VendorPrefix),
    Order(VendorPrefix),
    AlignContent(VendorPrefix),
    JustifyContent(VendorPrefix),
    PlaceContent,
    AlignSelf(VendorPrefix),
    JustifySelf,
    PlaceSelf,
    AlignItems(VendorPrefix),
    JustifyItems,
    PlaceItems,
    RowGap,
    ColumnGap,
    Gap,
    BoxOrient(VendorPrefix),
    BoxDirection(VendorPrefix),
    BoxOrdinalGroup(VendorPrefix),
    BoxAlign(VendorPrefix),
    BoxFlex(VendorPrefix),
    BoxFlexGroup(VendorPrefix),
    BoxPack(VendorPrefix),
    BoxLines(VendorPrefix),
    FlexPack(VendorPrefix),
    FlexOrder(VendorPrefix),
    FlexAlign(VendorPrefix),
    FlexItemAlign(VendorPrefix),
    FlexLinePack(VendorPrefix),
    FlexPositive(VendorPrefix),
    FlexNegative(VendorPrefix),
    FlexPreferredSize(VendorPrefix),
    MarginTop,
    MarginBottom,
    MarginLeft,
    MarginRight,
    MarginBlockStart,
    MarginBlockEnd,
    MarginInlineStart,
    MarginInlineEnd,
    MarginBlock,
    MarginInline,
    Margin,
    PaddingTop,
    PaddingBottom,
    PaddingLeft,
    PaddingRight,
    PaddingBlockStart,
    PaddingBlockEnd,
    PaddingInlineStart,
    PaddingInlineEnd,
    PaddingBlock,
    PaddingInline,
    Padding,
    ScrollMarginTop,
    ScrollMarginBottom,
    ScrollMarginLeft,
    ScrollMarginRight,
    ScrollMarginBlockStart,
    ScrollMarginBlockEnd,
    ScrollMarginInlineStart,
    ScrollMarginInlineEnd,
    ScrollMarginBlock,
    ScrollMarginInline,
    ScrollMargin,
    ScrollPaddingTop,
    ScrollPaddingBottom,
    ScrollPaddingLeft,
    ScrollPaddingRight,
    ScrollPaddingBlockStart,
    ScrollPaddingBlockEnd,
    ScrollPaddingInlineStart,
    ScrollPaddingInlineEnd,
    ScrollPaddingBlock,
    ScrollPaddingInline,
    ScrollPadding,
    FontWeight,
    FontSize,
    FontStretch,
    FontFamily,
    FontStyle,
    FontVariantCaps,
    LineHeight,
    Font,
    TransitionProperty(VendorPrefix),
    TransitionDuration(VendorPrefix),
    TransitionDelay(VendorPrefix),
    TransitionTimingFunction(VendorPrefix),
    Transition(VendorPrefix),
    Animation(VendorPrefix),
    AnimationName(VendorPrefix),
    Transform(VendorPrefix),
    TransformOrigin(VendorPrefix),
    TransformStyle(VendorPrefix),
    TransformBox,
    BackfaceVisibility(VendorPrefix),
    Perspective(VendorPrefix),
    PerspectiveOrigin(VendorPrefix),
    Translate,
    Rotate,
    Scale,
    TextDecorationColor(VendorPrefix),
    TextEmphasisColor(VendorPrefix),
    TextShadow,
    Direction,
    Composes,
    MaskImage(VendorPrefix),
    MaskMode,
    MaskRepeat(VendorPrefix),
    MaskPositionX,
    MaskPositionY,
    MaskPosition(VendorPrefix),
    MaskClip(VendorPrefix),
    MaskOrigin(VendorPrefix),
    MaskSize(VendorPrefix),
    MaskComposite,
    MaskType,
    Mask(VendorPrefix),
    MaskBorderSource,
    MaskBorderMode,
    MaskBorderSlice,
    MaskBorderWidth,
    MaskBorderOutset,
    MaskBorderRepeat,
    MaskBorder,
    WebKitMaskComposite,
    MaskSourceType(VendorPrefix),
    MaskBoxImage(VendorPrefix),
    MaskBoxImageSource(VendorPrefix),
    MaskBoxImageSlice(VendorPrefix),
    MaskBoxImageWidth(VendorPrefix),
    MaskBoxImageOutset(VendorPrefix),
    MaskBoxImageRepeat(VendorPrefix),
    ColorScheme,
    ViewTransitionName,
    ViewTransitionClass,
    ViewTransitionGroup,
    All,
    Unparsed,
    Custom(CustomPropertyName),
}

// `PropertyId` equality compares the tag, then *only* compares the payload
// when its type is `VendorPrefix` — for `Custom` (whose payload is
// `CustomPropertyName`) and all unit variants it returns `true` on tag match
// alone. A derived `PartialEq` would compare the `CustomPropertyName` bytes,
// diverging from the duplicate-detection semantics in `rules/style.rs`.
// `prefix()` already returns the `VendorPrefix` payload for the 65 prefixed
// variants and `VendorPrefix::empty()` for every other variant (including
// `Custom`/`All`/`Unparsed`), so `tag` + `prefix` equality is exactly that.
impl PartialEq for PropertyId {
    #[inline]
    fn eq(&self, other: &Self) -> bool {
        self.tag() == other.tag() && self.prefix() == other.prefix()
    }
}

impl Eq for PropertyId {}

// Hash only the tag discriminant so PropertyId can key a hash map
// consistent with `eq`.
impl core::hash::Hash for PropertyId {
    #[inline]
    fn hash<H: core::hash::Hasher>(&self, h: &mut H) {
        (self.tag() as u16).hash(h);
    }
}

impl PropertyId {
    pub(crate) const fn tag(&self) -> PropertyIdTag {
        match self {
            PropertyId::BackgroundColor => PropertyIdTag::BackgroundColor,
            PropertyId::BackgroundImage => PropertyIdTag::BackgroundImage,
            PropertyId::BackgroundPositionX => PropertyIdTag::BackgroundPositionX,
            PropertyId::BackgroundPositionY => PropertyIdTag::BackgroundPositionY,
            PropertyId::BackgroundPosition => PropertyIdTag::BackgroundPosition,
            PropertyId::BackgroundSize => PropertyIdTag::BackgroundSize,
            PropertyId::BackgroundRepeat => PropertyIdTag::BackgroundRepeat,
            PropertyId::BackgroundAttachment => PropertyIdTag::BackgroundAttachment,
            PropertyId::BackgroundClip(..) => PropertyIdTag::BackgroundClip,
            PropertyId::BackgroundOrigin => PropertyIdTag::BackgroundOrigin,
            PropertyId::Background => PropertyIdTag::Background,
            PropertyId::BoxShadow(..) => PropertyIdTag::BoxShadow,
            PropertyId::Opacity => PropertyIdTag::Opacity,
            PropertyId::Color => PropertyIdTag::Color,
            PropertyId::Display => PropertyIdTag::Display,
            PropertyId::Visibility => PropertyIdTag::Visibility,
            PropertyId::Width => PropertyIdTag::Width,
            PropertyId::Height => PropertyIdTag::Height,
            PropertyId::MinWidth => PropertyIdTag::MinWidth,
            PropertyId::MinHeight => PropertyIdTag::MinHeight,
            PropertyId::MaxWidth => PropertyIdTag::MaxWidth,
            PropertyId::MaxHeight => PropertyIdTag::MaxHeight,
            PropertyId::BlockSize => PropertyIdTag::BlockSize,
            PropertyId::InlineSize => PropertyIdTag::InlineSize,
            PropertyId::MinBlockSize => PropertyIdTag::MinBlockSize,
            PropertyId::MinInlineSize => PropertyIdTag::MinInlineSize,
            PropertyId::MaxBlockSize => PropertyIdTag::MaxBlockSize,
            PropertyId::MaxInlineSize => PropertyIdTag::MaxInlineSize,
            PropertyId::BoxSizing(..) => PropertyIdTag::BoxSizing,
            PropertyId::AspectRatio => PropertyIdTag::AspectRatio,
            PropertyId::Overflow => PropertyIdTag::Overflow,
            PropertyId::OverflowX => PropertyIdTag::OverflowX,
            PropertyId::OverflowY => PropertyIdTag::OverflowY,
            PropertyId::TextOverflow(..) => PropertyIdTag::TextOverflow,
            PropertyId::Position => PropertyIdTag::Position,
            PropertyId::Top => PropertyIdTag::Top,
            PropertyId::Bottom => PropertyIdTag::Bottom,
            PropertyId::Left => PropertyIdTag::Left,
            PropertyId::Right => PropertyIdTag::Right,
            PropertyId::InsetBlockStart => PropertyIdTag::InsetBlockStart,
            PropertyId::InsetBlockEnd => PropertyIdTag::InsetBlockEnd,
            PropertyId::InsetInlineStart => PropertyIdTag::InsetInlineStart,
            PropertyId::InsetInlineEnd => PropertyIdTag::InsetInlineEnd,
            PropertyId::InsetBlock => PropertyIdTag::InsetBlock,
            PropertyId::InsetInline => PropertyIdTag::InsetInline,
            PropertyId::Inset => PropertyIdTag::Inset,
            PropertyId::BorderSpacing => PropertyIdTag::BorderSpacing,
            PropertyId::BorderTopColor => PropertyIdTag::BorderTopColor,
            PropertyId::BorderBottomColor => PropertyIdTag::BorderBottomColor,
            PropertyId::BorderLeftColor => PropertyIdTag::BorderLeftColor,
            PropertyId::BorderRightColor => PropertyIdTag::BorderRightColor,
            PropertyId::BorderBlockStartColor => PropertyIdTag::BorderBlockStartColor,
            PropertyId::BorderBlockEndColor => PropertyIdTag::BorderBlockEndColor,
            PropertyId::BorderInlineStartColor => PropertyIdTag::BorderInlineStartColor,
            PropertyId::BorderInlineEndColor => PropertyIdTag::BorderInlineEndColor,
            PropertyId::BorderTopStyle => PropertyIdTag::BorderTopStyle,
            PropertyId::BorderBottomStyle => PropertyIdTag::BorderBottomStyle,
            PropertyId::BorderLeftStyle => PropertyIdTag::BorderLeftStyle,
            PropertyId::BorderRightStyle => PropertyIdTag::BorderRightStyle,
            PropertyId::BorderBlockStartStyle => PropertyIdTag::BorderBlockStartStyle,
            PropertyId::BorderBlockEndStyle => PropertyIdTag::BorderBlockEndStyle,
            PropertyId::BorderInlineStartStyle => PropertyIdTag::BorderInlineStartStyle,
            PropertyId::BorderInlineEndStyle => PropertyIdTag::BorderInlineEndStyle,
            PropertyId::BorderTopWidth => PropertyIdTag::BorderTopWidth,
            PropertyId::BorderBottomWidth => PropertyIdTag::BorderBottomWidth,
            PropertyId::BorderLeftWidth => PropertyIdTag::BorderLeftWidth,
            PropertyId::BorderRightWidth => PropertyIdTag::BorderRightWidth,
            PropertyId::BorderBlockStartWidth => PropertyIdTag::BorderBlockStartWidth,
            PropertyId::BorderBlockEndWidth => PropertyIdTag::BorderBlockEndWidth,
            PropertyId::BorderInlineStartWidth => PropertyIdTag::BorderInlineStartWidth,
            PropertyId::BorderInlineEndWidth => PropertyIdTag::BorderInlineEndWidth,
            PropertyId::BorderTopLeftRadius(..) => PropertyIdTag::BorderTopLeftRadius,
            PropertyId::BorderTopRightRadius(..) => PropertyIdTag::BorderTopRightRadius,
            PropertyId::BorderBottomLeftRadius(..) => PropertyIdTag::BorderBottomLeftRadius,
            PropertyId::BorderBottomRightRadius(..) => PropertyIdTag::BorderBottomRightRadius,
            PropertyId::BorderStartStartRadius => PropertyIdTag::BorderStartStartRadius,
            PropertyId::BorderStartEndRadius => PropertyIdTag::BorderStartEndRadius,
            PropertyId::BorderEndStartRadius => PropertyIdTag::BorderEndStartRadius,
            PropertyId::BorderEndEndRadius => PropertyIdTag::BorderEndEndRadius,
            PropertyId::BorderRadius(..) => PropertyIdTag::BorderRadius,
            PropertyId::BorderImageSource => PropertyIdTag::BorderImageSource,
            PropertyId::BorderImageOutset => PropertyIdTag::BorderImageOutset,
            PropertyId::BorderImageRepeat => PropertyIdTag::BorderImageRepeat,
            PropertyId::BorderImageWidth => PropertyIdTag::BorderImageWidth,
            PropertyId::BorderImageSlice => PropertyIdTag::BorderImageSlice,
            PropertyId::BorderImage(..) => PropertyIdTag::BorderImage,
            PropertyId::BorderColor => PropertyIdTag::BorderColor,
            PropertyId::BorderStyle => PropertyIdTag::BorderStyle,
            PropertyId::BorderWidth => PropertyIdTag::BorderWidth,
            PropertyId::BorderBlockColor => PropertyIdTag::BorderBlockColor,
            PropertyId::BorderBlockStyle => PropertyIdTag::BorderBlockStyle,
            PropertyId::BorderBlockWidth => PropertyIdTag::BorderBlockWidth,
            PropertyId::BorderInlineColor => PropertyIdTag::BorderInlineColor,
            PropertyId::BorderInlineStyle => PropertyIdTag::BorderInlineStyle,
            PropertyId::BorderInlineWidth => PropertyIdTag::BorderInlineWidth,
            PropertyId::Border => PropertyIdTag::Border,
            PropertyId::BorderTop => PropertyIdTag::BorderTop,
            PropertyId::BorderBottom => PropertyIdTag::BorderBottom,
            PropertyId::BorderLeft => PropertyIdTag::BorderLeft,
            PropertyId::BorderRight => PropertyIdTag::BorderRight,
            PropertyId::BorderBlock => PropertyIdTag::BorderBlock,
            PropertyId::BorderBlockStart => PropertyIdTag::BorderBlockStart,
            PropertyId::BorderBlockEnd => PropertyIdTag::BorderBlockEnd,
            PropertyId::BorderInline => PropertyIdTag::BorderInline,
            PropertyId::BorderInlineStart => PropertyIdTag::BorderInlineStart,
            PropertyId::BorderInlineEnd => PropertyIdTag::BorderInlineEnd,
            PropertyId::Outline => PropertyIdTag::Outline,
            PropertyId::OutlineColor => PropertyIdTag::OutlineColor,
            PropertyId::OutlineStyle => PropertyIdTag::OutlineStyle,
            PropertyId::OutlineWidth => PropertyIdTag::OutlineWidth,
            PropertyId::FlexDirection(..) => PropertyIdTag::FlexDirection,
            PropertyId::FlexWrap(..) => PropertyIdTag::FlexWrap,
            PropertyId::FlexFlow(..) => PropertyIdTag::FlexFlow,
            PropertyId::FlexGrow(..) => PropertyIdTag::FlexGrow,
            PropertyId::FlexShrink(..) => PropertyIdTag::FlexShrink,
            PropertyId::FlexBasis(..) => PropertyIdTag::FlexBasis,
            PropertyId::Flex(..) => PropertyIdTag::Flex,
            PropertyId::Order(..) => PropertyIdTag::Order,
            PropertyId::AlignContent(..) => PropertyIdTag::AlignContent,
            PropertyId::JustifyContent(..) => PropertyIdTag::JustifyContent,
            PropertyId::PlaceContent => PropertyIdTag::PlaceContent,
            PropertyId::AlignSelf(..) => PropertyIdTag::AlignSelf,
            PropertyId::JustifySelf => PropertyIdTag::JustifySelf,
            PropertyId::PlaceSelf => PropertyIdTag::PlaceSelf,
            PropertyId::AlignItems(..) => PropertyIdTag::AlignItems,
            PropertyId::JustifyItems => PropertyIdTag::JustifyItems,
            PropertyId::PlaceItems => PropertyIdTag::PlaceItems,
            PropertyId::RowGap => PropertyIdTag::RowGap,
            PropertyId::ColumnGap => PropertyIdTag::ColumnGap,
            PropertyId::Gap => PropertyIdTag::Gap,
            PropertyId::BoxOrient(..) => PropertyIdTag::BoxOrient,
            PropertyId::BoxDirection(..) => PropertyIdTag::BoxDirection,
            PropertyId::BoxOrdinalGroup(..) => PropertyIdTag::BoxOrdinalGroup,
            PropertyId::BoxAlign(..) => PropertyIdTag::BoxAlign,
            PropertyId::BoxFlex(..) => PropertyIdTag::BoxFlex,
            PropertyId::BoxFlexGroup(..) => PropertyIdTag::BoxFlexGroup,
            PropertyId::BoxPack(..) => PropertyIdTag::BoxPack,
            PropertyId::BoxLines(..) => PropertyIdTag::BoxLines,
            PropertyId::FlexPack(..) => PropertyIdTag::FlexPack,
            PropertyId::FlexOrder(..) => PropertyIdTag::FlexOrder,
            PropertyId::FlexAlign(..) => PropertyIdTag::FlexAlign,
            PropertyId::FlexItemAlign(..) => PropertyIdTag::FlexItemAlign,
            PropertyId::FlexLinePack(..) => PropertyIdTag::FlexLinePack,
            PropertyId::FlexPositive(..) => PropertyIdTag::FlexPositive,
            PropertyId::FlexNegative(..) => PropertyIdTag::FlexNegative,
            PropertyId::FlexPreferredSize(..) => PropertyIdTag::FlexPreferredSize,
            PropertyId::MarginTop => PropertyIdTag::MarginTop,
            PropertyId::MarginBottom => PropertyIdTag::MarginBottom,
            PropertyId::MarginLeft => PropertyIdTag::MarginLeft,
            PropertyId::MarginRight => PropertyIdTag::MarginRight,
            PropertyId::MarginBlockStart => PropertyIdTag::MarginBlockStart,
            PropertyId::MarginBlockEnd => PropertyIdTag::MarginBlockEnd,
            PropertyId::MarginInlineStart => PropertyIdTag::MarginInlineStart,
            PropertyId::MarginInlineEnd => PropertyIdTag::MarginInlineEnd,
            PropertyId::MarginBlock => PropertyIdTag::MarginBlock,
            PropertyId::MarginInline => PropertyIdTag::MarginInline,
            PropertyId::Margin => PropertyIdTag::Margin,
            PropertyId::PaddingTop => PropertyIdTag::PaddingTop,
            PropertyId::PaddingBottom => PropertyIdTag::PaddingBottom,
            PropertyId::PaddingLeft => PropertyIdTag::PaddingLeft,
            PropertyId::PaddingRight => PropertyIdTag::PaddingRight,
            PropertyId::PaddingBlockStart => PropertyIdTag::PaddingBlockStart,
            PropertyId::PaddingBlockEnd => PropertyIdTag::PaddingBlockEnd,
            PropertyId::PaddingInlineStart => PropertyIdTag::PaddingInlineStart,
            PropertyId::PaddingInlineEnd => PropertyIdTag::PaddingInlineEnd,
            PropertyId::PaddingBlock => PropertyIdTag::PaddingBlock,
            PropertyId::PaddingInline => PropertyIdTag::PaddingInline,
            PropertyId::Padding => PropertyIdTag::Padding,
            PropertyId::ScrollMarginTop => PropertyIdTag::ScrollMarginTop,
            PropertyId::ScrollMarginBottom => PropertyIdTag::ScrollMarginBottom,
            PropertyId::ScrollMarginLeft => PropertyIdTag::ScrollMarginLeft,
            PropertyId::ScrollMarginRight => PropertyIdTag::ScrollMarginRight,
            PropertyId::ScrollMarginBlockStart => PropertyIdTag::ScrollMarginBlockStart,
            PropertyId::ScrollMarginBlockEnd => PropertyIdTag::ScrollMarginBlockEnd,
            PropertyId::ScrollMarginInlineStart => PropertyIdTag::ScrollMarginInlineStart,
            PropertyId::ScrollMarginInlineEnd => PropertyIdTag::ScrollMarginInlineEnd,
            PropertyId::ScrollMarginBlock => PropertyIdTag::ScrollMarginBlock,
            PropertyId::ScrollMarginInline => PropertyIdTag::ScrollMarginInline,
            PropertyId::ScrollMargin => PropertyIdTag::ScrollMargin,
            PropertyId::ScrollPaddingTop => PropertyIdTag::ScrollPaddingTop,
            PropertyId::ScrollPaddingBottom => PropertyIdTag::ScrollPaddingBottom,
            PropertyId::ScrollPaddingLeft => PropertyIdTag::ScrollPaddingLeft,
            PropertyId::ScrollPaddingRight => PropertyIdTag::ScrollPaddingRight,
            PropertyId::ScrollPaddingBlockStart => PropertyIdTag::ScrollPaddingBlockStart,
            PropertyId::ScrollPaddingBlockEnd => PropertyIdTag::ScrollPaddingBlockEnd,
            PropertyId::ScrollPaddingInlineStart => PropertyIdTag::ScrollPaddingInlineStart,
            PropertyId::ScrollPaddingInlineEnd => PropertyIdTag::ScrollPaddingInlineEnd,
            PropertyId::ScrollPaddingBlock => PropertyIdTag::ScrollPaddingBlock,
            PropertyId::ScrollPaddingInline => PropertyIdTag::ScrollPaddingInline,
            PropertyId::ScrollPadding => PropertyIdTag::ScrollPadding,
            PropertyId::FontWeight => PropertyIdTag::FontWeight,
            PropertyId::FontSize => PropertyIdTag::FontSize,
            PropertyId::FontStretch => PropertyIdTag::FontStretch,
            PropertyId::FontFamily => PropertyIdTag::FontFamily,
            PropertyId::FontStyle => PropertyIdTag::FontStyle,
            PropertyId::FontVariantCaps => PropertyIdTag::FontVariantCaps,
            PropertyId::LineHeight => PropertyIdTag::LineHeight,
            PropertyId::Font => PropertyIdTag::Font,
            PropertyId::TransitionProperty(..) => PropertyIdTag::TransitionProperty,
            PropertyId::TransitionDuration(..) => PropertyIdTag::TransitionDuration,
            PropertyId::TransitionDelay(..) => PropertyIdTag::TransitionDelay,
            PropertyId::TransitionTimingFunction(..) => PropertyIdTag::TransitionTimingFunction,
            PropertyId::Transition(..) => PropertyIdTag::Transition,
            PropertyId::Animation(..) => PropertyIdTag::Animation,
            PropertyId::AnimationName(..) => PropertyIdTag::AnimationName,
            PropertyId::Transform(..) => PropertyIdTag::Transform,
            PropertyId::TransformOrigin(..) => PropertyIdTag::TransformOrigin,
            PropertyId::TransformStyle(..) => PropertyIdTag::TransformStyle,
            PropertyId::TransformBox => PropertyIdTag::TransformBox,
            PropertyId::BackfaceVisibility(..) => PropertyIdTag::BackfaceVisibility,
            PropertyId::Perspective(..) => PropertyIdTag::Perspective,
            PropertyId::PerspectiveOrigin(..) => PropertyIdTag::PerspectiveOrigin,
            PropertyId::Translate => PropertyIdTag::Translate,
            PropertyId::Rotate => PropertyIdTag::Rotate,
            PropertyId::Scale => PropertyIdTag::Scale,
            PropertyId::TextDecorationColor(..) => PropertyIdTag::TextDecorationColor,
            PropertyId::TextEmphasisColor(..) => PropertyIdTag::TextEmphasisColor,
            PropertyId::TextShadow => PropertyIdTag::TextShadow,
            PropertyId::Direction => PropertyIdTag::Direction,
            PropertyId::Composes => PropertyIdTag::Composes,
            PropertyId::MaskImage(..) => PropertyIdTag::MaskImage,
            PropertyId::MaskMode => PropertyIdTag::MaskMode,
            PropertyId::MaskRepeat(..) => PropertyIdTag::MaskRepeat,
            PropertyId::MaskPositionX => PropertyIdTag::MaskPositionX,
            PropertyId::MaskPositionY => PropertyIdTag::MaskPositionY,
            PropertyId::MaskPosition(..) => PropertyIdTag::MaskPosition,
            PropertyId::MaskClip(..) => PropertyIdTag::MaskClip,
            PropertyId::MaskOrigin(..) => PropertyIdTag::MaskOrigin,
            PropertyId::MaskSize(..) => PropertyIdTag::MaskSize,
            PropertyId::MaskComposite => PropertyIdTag::MaskComposite,
            PropertyId::MaskType => PropertyIdTag::MaskType,
            PropertyId::Mask(..) => PropertyIdTag::Mask,
            PropertyId::MaskBorderSource => PropertyIdTag::MaskBorderSource,
            PropertyId::MaskBorderMode => PropertyIdTag::MaskBorderMode,
            PropertyId::MaskBorderSlice => PropertyIdTag::MaskBorderSlice,
            PropertyId::MaskBorderWidth => PropertyIdTag::MaskBorderWidth,
            PropertyId::MaskBorderOutset => PropertyIdTag::MaskBorderOutset,
            PropertyId::MaskBorderRepeat => PropertyIdTag::MaskBorderRepeat,
            PropertyId::MaskBorder => PropertyIdTag::MaskBorder,
            PropertyId::WebKitMaskComposite => PropertyIdTag::WebKitMaskComposite,
            PropertyId::MaskSourceType(..) => PropertyIdTag::MaskSourceType,
            PropertyId::MaskBoxImage(..) => PropertyIdTag::MaskBoxImage,
            PropertyId::MaskBoxImageSource(..) => PropertyIdTag::MaskBoxImageSource,
            PropertyId::MaskBoxImageSlice(..) => PropertyIdTag::MaskBoxImageSlice,
            PropertyId::MaskBoxImageWidth(..) => PropertyIdTag::MaskBoxImageWidth,
            PropertyId::MaskBoxImageOutset(..) => PropertyIdTag::MaskBoxImageOutset,
            PropertyId::MaskBoxImageRepeat(..) => PropertyIdTag::MaskBoxImageRepeat,
            PropertyId::ColorScheme => PropertyIdTag::ColorScheme,
            PropertyId::ViewTransitionName => PropertyIdTag::ViewTransitionName,
            PropertyId::ViewTransitionClass => PropertyIdTag::ViewTransitionClass,
            PropertyId::ViewTransitionGroup => PropertyIdTag::ViewTransitionGroup,
            PropertyId::All => PropertyIdTag::All,
            PropertyId::Unparsed => PropertyIdTag::Unparsed,
            PropertyId::Custom(..) => PropertyIdTag::Custom,
        }
    }

    /// Returns the property name, without any vendor prefixes.
    pub fn name(&self) -> &[u8] {
        match self {
            PropertyId::Custom(c) => c.as_str(),
            // &'static from the tag table coerces to &'_ — identical bytes for
            // every standard variant, including Unparsed => b"unparsed".
            _ => self.tag().name(),
        }
    }

    /// Mutable reference to the stored vendor-prefix slot, if this variant
    /// carries one. The 65 prefixed `PropertyId` variants share a single
    /// or-pattern arm; everything else returns `None`.
    pub(crate) fn prefix_slot_mut(&mut self) -> Option<&mut VendorPrefix> {
        match self {
            PropertyId::BackgroundClip(p)
            | PropertyId::BoxShadow(p)
            | PropertyId::BoxSizing(p)
            | PropertyId::TextOverflow(p)
            | PropertyId::BorderTopLeftRadius(p)
            | PropertyId::BorderTopRightRadius(p)
            | PropertyId::BorderBottomLeftRadius(p)
            | PropertyId::BorderBottomRightRadius(p)
            | PropertyId::BorderRadius(p)
            | PropertyId::BorderImage(p)
            | PropertyId::FlexDirection(p)
            | PropertyId::FlexWrap(p)
            | PropertyId::FlexFlow(p)
            | PropertyId::FlexGrow(p)
            | PropertyId::FlexShrink(p)
            | PropertyId::FlexBasis(p)
            | PropertyId::Flex(p)
            | PropertyId::Order(p)
            | PropertyId::AlignContent(p)
            | PropertyId::JustifyContent(p)
            | PropertyId::AlignSelf(p)
            | PropertyId::AlignItems(p)
            | PropertyId::BoxOrient(p)
            | PropertyId::BoxDirection(p)
            | PropertyId::BoxOrdinalGroup(p)
            | PropertyId::BoxAlign(p)
            | PropertyId::BoxFlex(p)
            | PropertyId::BoxFlexGroup(p)
            | PropertyId::BoxPack(p)
            | PropertyId::BoxLines(p)
            | PropertyId::FlexPack(p)
            | PropertyId::FlexOrder(p)
            | PropertyId::FlexAlign(p)
            | PropertyId::FlexItemAlign(p)
            | PropertyId::FlexLinePack(p)
            | PropertyId::FlexPositive(p)
            | PropertyId::FlexNegative(p)
            | PropertyId::FlexPreferredSize(p)
            | PropertyId::TransitionProperty(p)
            | PropertyId::TransitionDuration(p)
            | PropertyId::TransitionDelay(p)
            | PropertyId::TransitionTimingFunction(p)
            | PropertyId::Transition(p)
            | PropertyId::Animation(p)
            | PropertyId::AnimationName(p)
            | PropertyId::Transform(p)
            | PropertyId::TransformOrigin(p)
            | PropertyId::TransformStyle(p)
            | PropertyId::BackfaceVisibility(p)
            | PropertyId::Perspective(p)
            | PropertyId::PerspectiveOrigin(p)
            | PropertyId::TextDecorationColor(p)
            | PropertyId::TextEmphasisColor(p)
            | PropertyId::MaskImage(p)
            | PropertyId::MaskRepeat(p)
            | PropertyId::MaskPosition(p)
            | PropertyId::MaskClip(p)
            | PropertyId::MaskOrigin(p)
            | PropertyId::MaskSize(p)
            | PropertyId::Mask(p)
            | PropertyId::MaskSourceType(p)
            | PropertyId::MaskBoxImage(p)
            | PropertyId::MaskBoxImageSource(p)
            | PropertyId::MaskBoxImageSlice(p)
            | PropertyId::MaskBoxImageWidth(p)
            | PropertyId::MaskBoxImageOutset(p)
            | PropertyId::MaskBoxImageRepeat(p) => Some(p),
            _ => None,
        }
    }

    /// Returns the vendor prefix for this property id.
    pub(crate) fn prefix(&self) -> VendorPrefix {
        let mut id = *self;
        id.prefix_slot_mut().map_or(VendorPrefix::empty(), |p| *p)
    }

    /// Returns this id with its prefix replaced by `pre` (no-op for
    /// unprefixed variants).
    pub(crate) fn with_prefix(&self, pre: VendorPrefix) -> PropertyId {
        let mut id = *self;
        if let Some(p) = id.prefix_slot_mut() {
            *p = pre;
        }
        id
    }

    /// Bitwise-ORs `pre` into the stored prefix (no-op for unprefixed).
    pub(crate) fn add_prefix(&mut self, pre: VendorPrefix) {
        if let Some(p) = self.prefix_slot_mut() {
            *p |= pre;
        }
    }

    /// Expands the stored prefix to the full set required by `targets`.
    pub(crate) fn set_prefixes_for_targets(&mut self, targets: &Targets) {
        let Some(feature) = self.tag().prefix_feature() else {
            return;
        };
        if let Some(p) = self.prefix_slot_mut() {
            *p = targets.prefixes(*p, feature);
        }
    }

    /// Maps a (case-insensitive) bare property name + parsed prefix to a
    /// `PropertyId`. Returns `None` if the name is unknown *or* the prefix
    /// isn't allowed for that property.
    pub(crate) fn from_name_and_prefix(name: &[u8], pre: VendorPrefix) -> Option<PropertyId> {
        bun_core::comptime_string_map! {
            static KNOWN: (VendorPrefix, fn(VendorPrefix) -> PropertyId) = {
                b"background-color" => (VendorPrefix::NONE, |_| PropertyId::BackgroundColor),
                b"background-image" => (VendorPrefix::NONE, |_| PropertyId::BackgroundImage),
                b"background-position-x" => (VendorPrefix::NONE, |_| PropertyId::BackgroundPositionX),
                b"background-position-y" => (VendorPrefix::NONE, |_| PropertyId::BackgroundPositionY),
                b"background-position" => (VendorPrefix::NONE, |_| PropertyId::BackgroundPosition),
                b"background-size" => (VendorPrefix::NONE, |_| PropertyId::BackgroundSize),
                b"background-repeat" => (VendorPrefix::NONE, |_| PropertyId::BackgroundRepeat),
                b"background-attachment" => (VendorPrefix::NONE, |_| PropertyId::BackgroundAttachment),
                b"background-clip" => (VendorPrefix::NONE.union(VendorPrefix::WEBKIT).union(VendorPrefix::MOZ), PropertyId::BackgroundClip),
                b"background-origin" => (VendorPrefix::NONE, |_| PropertyId::BackgroundOrigin),
                b"background" => (VendorPrefix::NONE, |_| PropertyId::Background),
                b"box-shadow" => (VendorPrefix::NONE.union(VendorPrefix::WEBKIT).union(VendorPrefix::MOZ), PropertyId::BoxShadow),
                b"opacity" => (VendorPrefix::NONE, |_| PropertyId::Opacity),
                b"color" => (VendorPrefix::NONE, |_| PropertyId::Color),
                b"display" => (VendorPrefix::NONE, |_| PropertyId::Display),
                b"visibility" => (VendorPrefix::NONE, |_| PropertyId::Visibility),
                b"width" => (VendorPrefix::NONE, |_| PropertyId::Width),
                b"height" => (VendorPrefix::NONE, |_| PropertyId::Height),
                b"min-width" => (VendorPrefix::NONE, |_| PropertyId::MinWidth),
                b"min-height" => (VendorPrefix::NONE, |_| PropertyId::MinHeight),
                b"max-width" => (VendorPrefix::NONE, |_| PropertyId::MaxWidth),
                b"max-height" => (VendorPrefix::NONE, |_| PropertyId::MaxHeight),
                b"block-size" => (VendorPrefix::NONE, |_| PropertyId::BlockSize),
                b"inline-size" => (VendorPrefix::NONE, |_| PropertyId::InlineSize),
                b"min-block-size" => (VendorPrefix::NONE, |_| PropertyId::MinBlockSize),
                b"min-inline-size" => (VendorPrefix::NONE, |_| PropertyId::MinInlineSize),
                b"max-block-size" => (VendorPrefix::NONE, |_| PropertyId::MaxBlockSize),
                b"max-inline-size" => (VendorPrefix::NONE, |_| PropertyId::MaxInlineSize),
                b"box-sizing" => (VendorPrefix::NONE.union(VendorPrefix::WEBKIT).union(VendorPrefix::MOZ), PropertyId::BoxSizing),
                b"aspect-ratio" => (VendorPrefix::NONE, |_| PropertyId::AspectRatio),
                b"overflow" => (VendorPrefix::NONE, |_| PropertyId::Overflow),
                b"overflow-x" => (VendorPrefix::NONE, |_| PropertyId::OverflowX),
                b"overflow-y" => (VendorPrefix::NONE, |_| PropertyId::OverflowY),
                b"text-overflow" => (VendorPrefix::NONE.union(VendorPrefix::O), PropertyId::TextOverflow),
                b"position" => (VendorPrefix::NONE, |_| PropertyId::Position),
                b"top" => (VendorPrefix::NONE, |_| PropertyId::Top),
                b"bottom" => (VendorPrefix::NONE, |_| PropertyId::Bottom),
                b"left" => (VendorPrefix::NONE, |_| PropertyId::Left),
                b"right" => (VendorPrefix::NONE, |_| PropertyId::Right),
                b"inset-block-start" => (VendorPrefix::NONE, |_| PropertyId::InsetBlockStart),
                b"inset-block-end" => (VendorPrefix::NONE, |_| PropertyId::InsetBlockEnd),
                b"inset-inline-start" => (VendorPrefix::NONE, |_| PropertyId::InsetInlineStart),
                b"inset-inline-end" => (VendorPrefix::NONE, |_| PropertyId::InsetInlineEnd),
                b"inset-block" => (VendorPrefix::NONE, |_| PropertyId::InsetBlock),
                b"inset-inline" => (VendorPrefix::NONE, |_| PropertyId::InsetInline),
                b"inset" => (VendorPrefix::NONE, |_| PropertyId::Inset),
                b"border-spacing" => (VendorPrefix::NONE, |_| PropertyId::BorderSpacing),
                b"border-top-color" => (VendorPrefix::NONE, |_| PropertyId::BorderTopColor),
                b"border-bottom-color" => (VendorPrefix::NONE, |_| PropertyId::BorderBottomColor),
                b"border-left-color" => (VendorPrefix::NONE, |_| PropertyId::BorderLeftColor),
                b"border-right-color" => (VendorPrefix::NONE, |_| PropertyId::BorderRightColor),
                b"border-block-start-color" => (VendorPrefix::NONE, |_| PropertyId::BorderBlockStartColor),
                b"border-block-end-color" => (VendorPrefix::NONE, |_| PropertyId::BorderBlockEndColor),
                b"border-inline-start-color" => (VendorPrefix::NONE, |_| PropertyId::BorderInlineStartColor),
                b"border-inline-end-color" => (VendorPrefix::NONE, |_| PropertyId::BorderInlineEndColor),
                b"border-top-style" => (VendorPrefix::NONE, |_| PropertyId::BorderTopStyle),
                b"border-bottom-style" => (VendorPrefix::NONE, |_| PropertyId::BorderBottomStyle),
                b"border-left-style" => (VendorPrefix::NONE, |_| PropertyId::BorderLeftStyle),
                b"border-right-style" => (VendorPrefix::NONE, |_| PropertyId::BorderRightStyle),
                b"border-block-start-style" => (VendorPrefix::NONE, |_| PropertyId::BorderBlockStartStyle),
                b"border-block-end-style" => (VendorPrefix::NONE, |_| PropertyId::BorderBlockEndStyle),
                b"border-inline-start-style" => (VendorPrefix::NONE, |_| PropertyId::BorderInlineStartStyle),
                b"border-inline-end-style" => (VendorPrefix::NONE, |_| PropertyId::BorderInlineEndStyle),
                b"border-top-width" => (VendorPrefix::NONE, |_| PropertyId::BorderTopWidth),
                b"border-bottom-width" => (VendorPrefix::NONE, |_| PropertyId::BorderBottomWidth),
                b"border-left-width" => (VendorPrefix::NONE, |_| PropertyId::BorderLeftWidth),
                b"border-right-width" => (VendorPrefix::NONE, |_| PropertyId::BorderRightWidth),
                b"border-block-start-width" => (VendorPrefix::NONE, |_| PropertyId::BorderBlockStartWidth),
                b"border-block-end-width" => (VendorPrefix::NONE, |_| PropertyId::BorderBlockEndWidth),
                b"border-inline-start-width" => (VendorPrefix::NONE, |_| PropertyId::BorderInlineStartWidth),
                b"border-inline-end-width" => (VendorPrefix::NONE, |_| PropertyId::BorderInlineEndWidth),
                b"border-top-left-radius" => (VendorPrefix::NONE.union(VendorPrefix::WEBKIT).union(VendorPrefix::MOZ), PropertyId::BorderTopLeftRadius),
                b"border-top-right-radius" => (VendorPrefix::NONE.union(VendorPrefix::WEBKIT).union(VendorPrefix::MOZ), PropertyId::BorderTopRightRadius),
                b"border-bottom-left-radius" => (VendorPrefix::NONE.union(VendorPrefix::WEBKIT).union(VendorPrefix::MOZ), PropertyId::BorderBottomLeftRadius),
                b"border-bottom-right-radius" => (VendorPrefix::NONE.union(VendorPrefix::WEBKIT).union(VendorPrefix::MOZ), PropertyId::BorderBottomRightRadius),
                b"border-start-start-radius" => (VendorPrefix::NONE, |_| PropertyId::BorderStartStartRadius),
                b"border-start-end-radius" => (VendorPrefix::NONE, |_| PropertyId::BorderStartEndRadius),
                b"border-end-start-radius" => (VendorPrefix::NONE, |_| PropertyId::BorderEndStartRadius),
                b"border-end-end-radius" => (VendorPrefix::NONE, |_| PropertyId::BorderEndEndRadius),
                b"border-radius" => (VendorPrefix::NONE.union(VendorPrefix::WEBKIT).union(VendorPrefix::MOZ), PropertyId::BorderRadius),
                b"border-image-source" => (VendorPrefix::NONE, |_| PropertyId::BorderImageSource),
                b"border-image-outset" => (VendorPrefix::NONE, |_| PropertyId::BorderImageOutset),
                b"border-image-repeat" => (VendorPrefix::NONE, |_| PropertyId::BorderImageRepeat),
                b"border-image-width" => (VendorPrefix::NONE, |_| PropertyId::BorderImageWidth),
                b"border-image-slice" => (VendorPrefix::NONE, |_| PropertyId::BorderImageSlice),
                b"border-image" => (VendorPrefix::NONE.union(VendorPrefix::WEBKIT).union(VendorPrefix::MOZ).union(VendorPrefix::O), PropertyId::BorderImage),
                b"border-color" => (VendorPrefix::NONE, |_| PropertyId::BorderColor),
                b"border-style" => (VendorPrefix::NONE, |_| PropertyId::BorderStyle),
                b"border-width" => (VendorPrefix::NONE, |_| PropertyId::BorderWidth),
                b"border-block-color" => (VendorPrefix::NONE, |_| PropertyId::BorderBlockColor),
                b"border-block-style" => (VendorPrefix::NONE, |_| PropertyId::BorderBlockStyle),
                b"border-block-width" => (VendorPrefix::NONE, |_| PropertyId::BorderBlockWidth),
                b"border-inline-color" => (VendorPrefix::NONE, |_| PropertyId::BorderInlineColor),
                b"border-inline-style" => (VendorPrefix::NONE, |_| PropertyId::BorderInlineStyle),
                b"border-inline-width" => (VendorPrefix::NONE, |_| PropertyId::BorderInlineWidth),
                b"border" => (VendorPrefix::NONE, |_| PropertyId::Border),
                b"border-top" => (VendorPrefix::NONE, |_| PropertyId::BorderTop),
                b"border-bottom" => (VendorPrefix::NONE, |_| PropertyId::BorderBottom),
                b"border-left" => (VendorPrefix::NONE, |_| PropertyId::BorderLeft),
                b"border-right" => (VendorPrefix::NONE, |_| PropertyId::BorderRight),
                b"border-block" => (VendorPrefix::NONE, |_| PropertyId::BorderBlock),
                b"border-block-start" => (VendorPrefix::NONE, |_| PropertyId::BorderBlockStart),
                b"border-block-end" => (VendorPrefix::NONE, |_| PropertyId::BorderBlockEnd),
                b"border-inline" => (VendorPrefix::NONE, |_| PropertyId::BorderInline),
                b"border-inline-start" => (VendorPrefix::NONE, |_| PropertyId::BorderInlineStart),
                b"border-inline-end" => (VendorPrefix::NONE, |_| PropertyId::BorderInlineEnd),
                b"outline" => (VendorPrefix::NONE, |_| PropertyId::Outline),
                b"outline-color" => (VendorPrefix::NONE, |_| PropertyId::OutlineColor),
                b"outline-style" => (VendorPrefix::NONE, |_| PropertyId::OutlineStyle),
                b"outline-width" => (VendorPrefix::NONE, |_| PropertyId::OutlineWidth),
                b"flex-direction" => (VendorPrefix::NONE.union(VendorPrefix::WEBKIT).union(VendorPrefix::MS), PropertyId::FlexDirection),
                b"flex-wrap" => (VendorPrefix::NONE.union(VendorPrefix::WEBKIT).union(VendorPrefix::MS), PropertyId::FlexWrap),
                b"flex-flow" => (VendorPrefix::NONE.union(VendorPrefix::WEBKIT).union(VendorPrefix::MS), PropertyId::FlexFlow),
                b"flex-grow" => (VendorPrefix::NONE.union(VendorPrefix::WEBKIT), PropertyId::FlexGrow),
                b"flex-shrink" => (VendorPrefix::NONE.union(VendorPrefix::WEBKIT), PropertyId::FlexShrink),
                b"flex-basis" => (VendorPrefix::NONE.union(VendorPrefix::WEBKIT), PropertyId::FlexBasis),
                b"flex" => (VendorPrefix::NONE.union(VendorPrefix::WEBKIT).union(VendorPrefix::MS), PropertyId::Flex),
                b"order" => (VendorPrefix::NONE.union(VendorPrefix::WEBKIT), PropertyId::Order),
                b"align-content" => (VendorPrefix::NONE.union(VendorPrefix::WEBKIT), PropertyId::AlignContent),
                b"justify-content" => (VendorPrefix::NONE.union(VendorPrefix::WEBKIT), PropertyId::JustifyContent),
                b"place-content" => (VendorPrefix::NONE, |_| PropertyId::PlaceContent),
                b"align-self" => (VendorPrefix::NONE.union(VendorPrefix::WEBKIT), PropertyId::AlignSelf),
                b"justify-self" => (VendorPrefix::NONE, |_| PropertyId::JustifySelf),
                b"place-self" => (VendorPrefix::NONE, |_| PropertyId::PlaceSelf),
                b"align-items" => (VendorPrefix::NONE.union(VendorPrefix::WEBKIT), PropertyId::AlignItems),
                b"justify-items" => (VendorPrefix::NONE, |_| PropertyId::JustifyItems),
                b"place-items" => (VendorPrefix::NONE, |_| PropertyId::PlaceItems),
                b"row-gap" => (VendorPrefix::NONE, |_| PropertyId::RowGap),
                b"column-gap" => (VendorPrefix::NONE, |_| PropertyId::ColumnGap),
                b"gap" => (VendorPrefix::NONE, |_| PropertyId::Gap),
                b"box-orient" => (VendorPrefix::NONE.union(VendorPrefix::WEBKIT).union(VendorPrefix::MOZ), PropertyId::BoxOrient),
                b"box-direction" => (VendorPrefix::NONE.union(VendorPrefix::WEBKIT).union(VendorPrefix::MOZ), PropertyId::BoxDirection),
                b"box-ordinal-group" => (VendorPrefix::NONE.union(VendorPrefix::WEBKIT).union(VendorPrefix::MOZ), PropertyId::BoxOrdinalGroup),
                b"box-align" => (VendorPrefix::NONE.union(VendorPrefix::WEBKIT).union(VendorPrefix::MOZ), PropertyId::BoxAlign),
                b"box-flex" => (VendorPrefix::NONE.union(VendorPrefix::WEBKIT).union(VendorPrefix::MOZ), PropertyId::BoxFlex),
                b"box-flex-group" => (VendorPrefix::NONE.union(VendorPrefix::WEBKIT), PropertyId::BoxFlexGroup),
                b"box-pack" => (VendorPrefix::NONE.union(VendorPrefix::WEBKIT).union(VendorPrefix::MOZ), PropertyId::BoxPack),
                b"box-lines" => (VendorPrefix::NONE.union(VendorPrefix::WEBKIT).union(VendorPrefix::MOZ), PropertyId::BoxLines),
                b"flex-pack" => (VendorPrefix::NONE.union(VendorPrefix::MS), PropertyId::FlexPack),
                b"flex-order" => (VendorPrefix::NONE.union(VendorPrefix::MS), PropertyId::FlexOrder),
                b"flex-align" => (VendorPrefix::NONE.union(VendorPrefix::MS), PropertyId::FlexAlign),
                b"flex-item-align" => (VendorPrefix::NONE.union(VendorPrefix::MS), PropertyId::FlexItemAlign),
                b"flex-line-pack" => (VendorPrefix::NONE.union(VendorPrefix::MS), PropertyId::FlexLinePack),
                b"flex-positive" => (VendorPrefix::NONE.union(VendorPrefix::MS), PropertyId::FlexPositive),
                b"flex-negative" => (VendorPrefix::NONE.union(VendorPrefix::MS), PropertyId::FlexNegative),
                b"flex-preferred-size" => (VendorPrefix::NONE.union(VendorPrefix::MS), PropertyId::FlexPreferredSize),
                b"margin-top" => (VendorPrefix::NONE, |_| PropertyId::MarginTop),
                b"margin-bottom" => (VendorPrefix::NONE, |_| PropertyId::MarginBottom),
                b"margin-left" => (VendorPrefix::NONE, |_| PropertyId::MarginLeft),
                b"margin-right" => (VendorPrefix::NONE, |_| PropertyId::MarginRight),
                b"margin-block-start" => (VendorPrefix::NONE, |_| PropertyId::MarginBlockStart),
                b"margin-block-end" => (VendorPrefix::NONE, |_| PropertyId::MarginBlockEnd),
                b"margin-inline-start" => (VendorPrefix::NONE, |_| PropertyId::MarginInlineStart),
                b"margin-inline-end" => (VendorPrefix::NONE, |_| PropertyId::MarginInlineEnd),
                b"margin-block" => (VendorPrefix::NONE, |_| PropertyId::MarginBlock),
                b"margin-inline" => (VendorPrefix::NONE, |_| PropertyId::MarginInline),
                b"margin" => (VendorPrefix::NONE, |_| PropertyId::Margin),
                b"padding-top" => (VendorPrefix::NONE, |_| PropertyId::PaddingTop),
                b"padding-bottom" => (VendorPrefix::NONE, |_| PropertyId::PaddingBottom),
                b"padding-left" => (VendorPrefix::NONE, |_| PropertyId::PaddingLeft),
                b"padding-right" => (VendorPrefix::NONE, |_| PropertyId::PaddingRight),
                b"padding-block-start" => (VendorPrefix::NONE, |_| PropertyId::PaddingBlockStart),
                b"padding-block-end" => (VendorPrefix::NONE, |_| PropertyId::PaddingBlockEnd),
                b"padding-inline-start" => (VendorPrefix::NONE, |_| PropertyId::PaddingInlineStart),
                b"padding-inline-end" => (VendorPrefix::NONE, |_| PropertyId::PaddingInlineEnd),
                b"padding-block" => (VendorPrefix::NONE, |_| PropertyId::PaddingBlock),
                b"padding-inline" => (VendorPrefix::NONE, |_| PropertyId::PaddingInline),
                b"padding" => (VendorPrefix::NONE, |_| PropertyId::Padding),
                b"scroll-margin-top" => (VendorPrefix::NONE, |_| PropertyId::ScrollMarginTop),
                b"scroll-margin-bottom" => (VendorPrefix::NONE, |_| PropertyId::ScrollMarginBottom),
                b"scroll-margin-left" => (VendorPrefix::NONE, |_| PropertyId::ScrollMarginLeft),
                b"scroll-margin-right" => (VendorPrefix::NONE, |_| PropertyId::ScrollMarginRight),
                b"scroll-margin-block-start" => (VendorPrefix::NONE, |_| PropertyId::ScrollMarginBlockStart),
                b"scroll-margin-block-end" => (VendorPrefix::NONE, |_| PropertyId::ScrollMarginBlockEnd),
                b"scroll-margin-inline-start" => (VendorPrefix::NONE, |_| PropertyId::ScrollMarginInlineStart),
                b"scroll-margin-inline-end" => (VendorPrefix::NONE, |_| PropertyId::ScrollMarginInlineEnd),
                b"scroll-margin-block" => (VendorPrefix::NONE, |_| PropertyId::ScrollMarginBlock),
                b"scroll-margin-inline" => (VendorPrefix::NONE, |_| PropertyId::ScrollMarginInline),
                b"scroll-margin" => (VendorPrefix::NONE, |_| PropertyId::ScrollMargin),
                b"scroll-padding-top" => (VendorPrefix::NONE, |_| PropertyId::ScrollPaddingTop),
                b"scroll-padding-bottom" => (VendorPrefix::NONE, |_| PropertyId::ScrollPaddingBottom),
                b"scroll-padding-left" => (VendorPrefix::NONE, |_| PropertyId::ScrollPaddingLeft),
                b"scroll-padding-right" => (VendorPrefix::NONE, |_| PropertyId::ScrollPaddingRight),
                b"scroll-padding-block-start" => (VendorPrefix::NONE, |_| PropertyId::ScrollPaddingBlockStart),
                b"scroll-padding-block-end" => (VendorPrefix::NONE, |_| PropertyId::ScrollPaddingBlockEnd),
                b"scroll-padding-inline-start" => (VendorPrefix::NONE, |_| PropertyId::ScrollPaddingInlineStart),
                b"scroll-padding-inline-end" => (VendorPrefix::NONE, |_| PropertyId::ScrollPaddingInlineEnd),
                b"scroll-padding-block" => (VendorPrefix::NONE, |_| PropertyId::ScrollPaddingBlock),
                b"scroll-padding-inline" => (VendorPrefix::NONE, |_| PropertyId::ScrollPaddingInline),
                b"scroll-padding" => (VendorPrefix::NONE, |_| PropertyId::ScrollPadding),
                b"font-weight" => (VendorPrefix::NONE, |_| PropertyId::FontWeight),
                b"font-size" => (VendorPrefix::NONE, |_| PropertyId::FontSize),
                b"font-stretch" => (VendorPrefix::NONE, |_| PropertyId::FontStretch),
                b"font-family" => (VendorPrefix::NONE, |_| PropertyId::FontFamily),
                b"font-style" => (VendorPrefix::NONE, |_| PropertyId::FontStyle),
                b"font-variant-caps" => (VendorPrefix::NONE, |_| PropertyId::FontVariantCaps),
                b"line-height" => (VendorPrefix::NONE, |_| PropertyId::LineHeight),
                b"font" => (VendorPrefix::NONE, |_| PropertyId::Font),
                b"transition-property" => (VendorPrefix::NONE.union(VendorPrefix::WEBKIT).union(VendorPrefix::MOZ).union(VendorPrefix::MS), PropertyId::TransitionProperty),
                b"transition-duration" => (VendorPrefix::NONE.union(VendorPrefix::WEBKIT).union(VendorPrefix::MOZ).union(VendorPrefix::MS), PropertyId::TransitionDuration),
                b"transition-delay" => (VendorPrefix::NONE.union(VendorPrefix::WEBKIT).union(VendorPrefix::MOZ).union(VendorPrefix::MS), PropertyId::TransitionDelay),
                b"transition-timing-function" => (VendorPrefix::NONE.union(VendorPrefix::WEBKIT).union(VendorPrefix::MOZ).union(VendorPrefix::MS), PropertyId::TransitionTimingFunction),
                b"transition" => (VendorPrefix::NONE.union(VendorPrefix::WEBKIT).union(VendorPrefix::MOZ).union(VendorPrefix::MS), PropertyId::Transition),
                b"animation-name" => (VendorPrefix::NONE.union(VendorPrefix::WEBKIT).union(VendorPrefix::MOZ).union(VendorPrefix::O).union(VendorPrefix::MS), PropertyId::AnimationName),
                b"animation" => (VendorPrefix::NONE.union(VendorPrefix::WEBKIT).union(VendorPrefix::MOZ).union(VendorPrefix::O).union(VendorPrefix::MS), PropertyId::Animation),
                b"transform" => (VendorPrefix::NONE.union(VendorPrefix::WEBKIT).union(VendorPrefix::MOZ).union(VendorPrefix::MS).union(VendorPrefix::O), PropertyId::Transform),
                b"transform-origin" => (VendorPrefix::NONE.union(VendorPrefix::WEBKIT).union(VendorPrefix::MOZ).union(VendorPrefix::MS).union(VendorPrefix::O), PropertyId::TransformOrigin),
                b"transform-style" => (VendorPrefix::NONE.union(VendorPrefix::WEBKIT).union(VendorPrefix::MOZ), PropertyId::TransformStyle),
                b"transform-box" => (VendorPrefix::NONE, |_| PropertyId::TransformBox),
                b"backface-visibility" => (VendorPrefix::NONE.union(VendorPrefix::WEBKIT).union(VendorPrefix::MOZ), PropertyId::BackfaceVisibility),
                b"perspective" => (VendorPrefix::NONE.union(VendorPrefix::WEBKIT).union(VendorPrefix::MOZ), PropertyId::Perspective),
                b"perspective-origin" => (VendorPrefix::NONE.union(VendorPrefix::WEBKIT).union(VendorPrefix::MOZ), PropertyId::PerspectiveOrigin),
                b"translate" => (VendorPrefix::NONE, |_| PropertyId::Translate),
                b"rotate" => (VendorPrefix::NONE, |_| PropertyId::Rotate),
                b"scale" => (VendorPrefix::NONE, |_| PropertyId::Scale),
                b"text-decoration-color" => (VendorPrefix::NONE.union(VendorPrefix::WEBKIT).union(VendorPrefix::MOZ), PropertyId::TextDecorationColor),
                b"text-emphasis-color" => (VendorPrefix::NONE.union(VendorPrefix::WEBKIT), PropertyId::TextEmphasisColor),
                b"text-shadow" => (VendorPrefix::NONE, |_| PropertyId::TextShadow),
                b"direction" => (VendorPrefix::NONE, |_| PropertyId::Direction),
                b"composes" => (VendorPrefix::NONE, |_| PropertyId::Composes),
                b"mask-image" => (VendorPrefix::NONE.union(VendorPrefix::WEBKIT), PropertyId::MaskImage),
                b"mask-mode" => (VendorPrefix::NONE, |_| PropertyId::MaskMode),
                b"mask-repeat" => (VendorPrefix::NONE.union(VendorPrefix::WEBKIT), PropertyId::MaskRepeat),
                b"mask-position-x" => (VendorPrefix::NONE, |_| PropertyId::MaskPositionX),
                b"mask-position-y" => (VendorPrefix::NONE, |_| PropertyId::MaskPositionY),
                b"mask-position" => (VendorPrefix::NONE.union(VendorPrefix::WEBKIT), PropertyId::MaskPosition),
                b"mask-clip" => (VendorPrefix::NONE.union(VendorPrefix::WEBKIT), PropertyId::MaskClip),
                b"mask-origin" => (VendorPrefix::NONE.union(VendorPrefix::WEBKIT), PropertyId::MaskOrigin),
                b"mask-size" => (VendorPrefix::NONE.union(VendorPrefix::WEBKIT), PropertyId::MaskSize),
                b"mask-composite" => (VendorPrefix::NONE, |_| PropertyId::MaskComposite),
                b"mask-type" => (VendorPrefix::NONE, |_| PropertyId::MaskType),
                b"mask" => (VendorPrefix::NONE.union(VendorPrefix::WEBKIT), PropertyId::Mask),
                b"mask-border-source" => (VendorPrefix::NONE, |_| PropertyId::MaskBorderSource),
                b"mask-border-mode" => (VendorPrefix::NONE, |_| PropertyId::MaskBorderMode),
                b"mask-border-slice" => (VendorPrefix::NONE, |_| PropertyId::MaskBorderSlice),
                b"mask-border-width" => (VendorPrefix::NONE, |_| PropertyId::MaskBorderWidth),
                b"mask-border-outset" => (VendorPrefix::NONE, |_| PropertyId::MaskBorderOutset),
                b"mask-border-repeat" => (VendorPrefix::NONE, |_| PropertyId::MaskBorderRepeat),
                b"mask-border" => (VendorPrefix::NONE, |_| PropertyId::MaskBorder),
                b"-webkit-mask-composite" => (VendorPrefix::NONE, |_| PropertyId::WebKitMaskComposite),
                b"mask-source-type" => (VendorPrefix::NONE.union(VendorPrefix::WEBKIT), PropertyId::MaskSourceType),
                b"mask-box-image" => (VendorPrefix::NONE.union(VendorPrefix::WEBKIT), PropertyId::MaskBoxImage),
                b"mask-box-image-source" => (VendorPrefix::NONE.union(VendorPrefix::WEBKIT), PropertyId::MaskBoxImageSource),
                b"mask-box-image-slice" => (VendorPrefix::NONE.union(VendorPrefix::WEBKIT), PropertyId::MaskBoxImageSlice),
                b"mask-box-image-width" => (VendorPrefix::NONE.union(VendorPrefix::WEBKIT), PropertyId::MaskBoxImageWidth),
                b"mask-box-image-outset" => (VendorPrefix::NONE.union(VendorPrefix::WEBKIT), PropertyId::MaskBoxImageOutset),
                b"mask-box-image-repeat" => (VendorPrefix::NONE.union(VendorPrefix::WEBKIT), PropertyId::MaskBoxImageRepeat),
                b"color-scheme" => (VendorPrefix::NONE, |_| PropertyId::ColorScheme),
                b"view-transition-name" => (VendorPrefix::NONE, |_| PropertyId::ViewTransitionName),
                b"view-transition-class" => (VendorPrefix::NONE, |_| PropertyId::ViewTransitionClass),
                b"view-transition-group" => (VendorPrefix::NONE, |_| PropertyId::ViewTransitionGroup),
            };
        }
        let &(allowed, make) = KNOWN.get_ascii_case_insensitive(name)?;
        if allowed.intersects(pre) {
            Some(make(pre))
        } else {
            None
        }
    }

    #[inline]
    pub(crate) fn deep_clone(&self, _arena: &bun_alloc::Arena) -> PropertyId {
        *self
    }

    pub fn to_css(&self, dest: &mut css::Printer) -> Result<(), css::PrintErr> {
        properties_impl::property_id_mixin::to_css(self, dest)
    }

    pub fn parse(input: &mut css::Parser) -> css::Result<PropertyId> {
        properties_impl::property_id_mixin::parse(input)
    }

    #[inline]
    pub(crate) fn from_string(name: &[u8]) -> PropertyId {
        properties_impl::property_id_mixin::from_string(name)
    }
}

/// A parsed CSS declaration value, tagged by [`PropertyIdTag`]. Prefixed
/// properties carry `(value, VendorPrefix)`.
// No `#[derive(Clone)]` — several `css_values::*` payloads
// (Image, Size2D, Rect, SmallList) intentionally lack `Clone` and use
// `deep_clone(&Arena)` instead. `Property::deep_clone` is the public API.
pub enum Property {
    BackgroundColor(css::css_values::color::CssColor),
    BackgroundImage(SmallList<css::css_values::image::Image, 1>),
    BackgroundPositionX(SmallList<css::css_values::position::HorizontalPosition, 1>),
    BackgroundPositionY(SmallList<css::css_values::position::VerticalPosition, 1>),
    BackgroundPosition(SmallList<background::BackgroundPosition, 1>),
    BackgroundSize(SmallList<background::BackgroundSize, 1>),
    BackgroundRepeat(SmallList<background::BackgroundRepeat, 1>),
    BackgroundAttachment(SmallList<background::BackgroundAttachment, 1>),
    BackgroundClip((SmallList<background::BackgroundClip, 1>, VendorPrefix)),
    BackgroundOrigin(SmallList<background::BackgroundOrigin, 1>),
    Background(SmallList<background::Background, 1>),
    BoxShadow((SmallList<box_shadow::BoxShadow, 1>, VendorPrefix)),
    Opacity(css::css_values::alpha::AlphaValue),
    Color(css::css_values::color::CssColor),
    Display(display::Display),
    Visibility(display::Visibility),
    Width(size::Size),
    Height(size::Size),
    MinWidth(size::Size),
    MinHeight(size::Size),
    MaxWidth(size::MaxSize),
    MaxHeight(size::MaxSize),
    BlockSize(size::Size),
    InlineSize(size::Size),
    MinBlockSize(size::Size),
    MinInlineSize(size::Size),
    MaxBlockSize(size::MaxSize),
    MaxInlineSize(size::MaxSize),
    BoxSizing((size::BoxSizing, VendorPrefix)),
    AspectRatio(size::AspectRatio),
    Overflow(overflow::Overflow),
    OverflowX(overflow::OverflowKeyword),
    OverflowY(overflow::OverflowKeyword),
    TextOverflow((overflow::TextOverflow, VendorPrefix)),
    Position(position::Position),
    Top(css::css_values::length::LengthPercentageOrAuto),
    Bottom(css::css_values::length::LengthPercentageOrAuto),
    Left(css::css_values::length::LengthPercentageOrAuto),
    Right(css::css_values::length::LengthPercentageOrAuto),
    InsetBlockStart(css::css_values::length::LengthPercentageOrAuto),
    InsetBlockEnd(css::css_values::length::LengthPercentageOrAuto),
    InsetInlineStart(css::css_values::length::LengthPercentageOrAuto),
    InsetInlineEnd(css::css_values::length::LengthPercentageOrAuto),
    InsetBlock(margin_padding::InsetBlock),
    InsetInline(margin_padding::InsetInline),
    Inset(margin_padding::Inset),
    BorderSpacing(css::css_values::size::Size2D<css::css_values::length::Length>),
    BorderTopColor(css::css_values::color::CssColor),
    BorderBottomColor(css::css_values::color::CssColor),
    BorderLeftColor(css::css_values::color::CssColor),
    BorderRightColor(css::css_values::color::CssColor),
    BorderBlockStartColor(css::css_values::color::CssColor),
    BorderBlockEndColor(css::css_values::color::CssColor),
    BorderInlineStartColor(css::css_values::color::CssColor),
    BorderInlineEndColor(css::css_values::color::CssColor),
    BorderTopStyle(border::LineStyle),
    BorderBottomStyle(border::LineStyle),
    BorderLeftStyle(border::LineStyle),
    BorderRightStyle(border::LineStyle),
    BorderBlockStartStyle(border::LineStyle),
    BorderBlockEndStyle(border::LineStyle),
    BorderInlineStartStyle(border::LineStyle),
    BorderInlineEndStyle(border::LineStyle),
    BorderTopWidth(border::BorderSideWidth),
    BorderBottomWidth(border::BorderSideWidth),
    BorderLeftWidth(border::BorderSideWidth),
    BorderRightWidth(border::BorderSideWidth),
    BorderBlockStartWidth(border::BorderSideWidth),
    BorderBlockEndWidth(border::BorderSideWidth),
    BorderInlineStartWidth(border::BorderSideWidth),
    BorderInlineEndWidth(border::BorderSideWidth),
    BorderTopLeftRadius(
        (
            css::css_values::size::Size2D<css::css_values::length::LengthPercentage>,
            VendorPrefix,
        ),
    ),
    BorderTopRightRadius(
        (
            css::css_values::size::Size2D<css::css_values::length::LengthPercentage>,
            VendorPrefix,
        ),
    ),
    BorderBottomLeftRadius(
        (
            css::css_values::size::Size2D<css::css_values::length::LengthPercentage>,
            VendorPrefix,
        ),
    ),
    BorderBottomRightRadius(
        (
            css::css_values::size::Size2D<css::css_values::length::LengthPercentage>,
            VendorPrefix,
        ),
    ),
    BorderStartStartRadius(
        css::css_values::size::Size2D<css::css_values::length::LengthPercentage>,
    ),
    BorderStartEndRadius(css::css_values::size::Size2D<css::css_values::length::LengthPercentage>),
    BorderEndStartRadius(css::css_values::size::Size2D<css::css_values::length::LengthPercentage>),
    BorderEndEndRadius(css::css_values::size::Size2D<css::css_values::length::LengthPercentage>),
    BorderRadius((border_radius::BorderRadius, VendorPrefix)),
    BorderImageSource(css::css_values::image::Image),
    BorderImageOutset(css::css_values::rect::Rect<css::css_values::length::LengthOrNumber>),
    BorderImageRepeat(border_image::BorderImageRepeat),
    BorderImageWidth(css::css_values::rect::Rect<border_image::BorderImageSideWidth>),
    BorderImageSlice(border_image::BorderImageSlice),
    BorderImage((border_image::BorderImage, VendorPrefix)),
    BorderColor(border::BorderColor),
    BorderStyle(border::BorderStyle),
    BorderWidth(border::BorderWidth),
    BorderBlockColor(border::BorderBlockColor),
    BorderBlockStyle(border::BorderBlockStyle),
    BorderBlockWidth(border::BorderBlockWidth),
    BorderInlineColor(border::BorderInlineColor),
    BorderInlineStyle(border::BorderInlineStyle),
    BorderInlineWidth(border::BorderInlineWidth),
    Border(border::Border),
    BorderTop(border::BorderTop),
    BorderBottom(border::BorderBottom),
    BorderLeft(border::BorderLeft),
    BorderRight(border::BorderRight),
    BorderBlock(border::BorderBlock),
    BorderBlockStart(border::BorderBlockStart),
    BorderBlockEnd(border::BorderBlockEnd),
    BorderInline(border::BorderInline),
    BorderInlineStart(border::BorderInlineStart),
    BorderInlineEnd(border::BorderInlineEnd),
    Outline(outline::Outline),
    OutlineColor(css::css_values::color::CssColor),
    OutlineStyle(outline::OutlineStyle),
    OutlineWidth(border::BorderSideWidth),
    FlexDirection((flex::FlexDirection, VendorPrefix)),
    FlexWrap((flex::FlexWrap, VendorPrefix)),
    FlexFlow((flex::FlexFlow, VendorPrefix)),
    FlexGrow((css::css_values::number::CSSNumber, VendorPrefix)),
    FlexShrink((css::css_values::number::CSSNumber, VendorPrefix)),
    FlexBasis(
        (
            css::css_values::length::LengthPercentageOrAuto,
            VendorPrefix,
        ),
    ),
    Flex((flex::Flex, VendorPrefix)),
    Order((css::css_values::number::CSSInteger, VendorPrefix)),
    AlignContent((align::AlignContent, VendorPrefix)),
    JustifyContent((align::JustifyContent, VendorPrefix)),
    PlaceContent(align::PlaceContent),
    AlignSelf((align::AlignSelf, VendorPrefix)),
    JustifySelf(align::JustifySelf),
    PlaceSelf(align::PlaceSelf),
    AlignItems((align::AlignItems, VendorPrefix)),
    JustifyItems(align::JustifyItems),
    PlaceItems(align::PlaceItems),
    RowGap(align::GapValue),
    ColumnGap(align::GapValue),
    Gap(align::Gap),
    BoxOrient((flex::BoxOrient, VendorPrefix)),
    BoxDirection((flex::BoxDirection, VendorPrefix)),
    BoxOrdinalGroup((css::css_values::number::CSSInteger, VendorPrefix)),
    BoxAlign((flex::BoxAlign, VendorPrefix)),
    BoxFlex((css::css_values::number::CSSNumber, VendorPrefix)),
    BoxFlexGroup((css::css_values::number::CSSInteger, VendorPrefix)),
    BoxPack((flex::BoxPack, VendorPrefix)),
    BoxLines((flex::BoxLines, VendorPrefix)),
    FlexPack((flex::FlexPack, VendorPrefix)),
    FlexOrder((css::css_values::number::CSSInteger, VendorPrefix)),
    FlexAlign((flex::BoxAlign, VendorPrefix)),
    FlexItemAlign((flex::FlexItemAlign, VendorPrefix)),
    FlexLinePack((flex::FlexLinePack, VendorPrefix)),
    FlexPositive((css::css_values::number::CSSNumber, VendorPrefix)),
    FlexNegative((css::css_values::number::CSSNumber, VendorPrefix)),
    FlexPreferredSize(
        (
            css::css_values::length::LengthPercentageOrAuto,
            VendorPrefix,
        ),
    ),
    MarginTop(css::css_values::length::LengthPercentageOrAuto),
    MarginBottom(css::css_values::length::LengthPercentageOrAuto),
    MarginLeft(css::css_values::length::LengthPercentageOrAuto),
    MarginRight(css::css_values::length::LengthPercentageOrAuto),
    MarginBlockStart(css::css_values::length::LengthPercentageOrAuto),
    MarginBlockEnd(css::css_values::length::LengthPercentageOrAuto),
    MarginInlineStart(css::css_values::length::LengthPercentageOrAuto),
    MarginInlineEnd(css::css_values::length::LengthPercentageOrAuto),
    MarginBlock(margin_padding::MarginBlock),
    MarginInline(margin_padding::MarginInline),
    Margin(margin_padding::Margin),
    PaddingTop(css::css_values::length::LengthPercentageOrAuto),
    PaddingBottom(css::css_values::length::LengthPercentageOrAuto),
    PaddingLeft(css::css_values::length::LengthPercentageOrAuto),
    PaddingRight(css::css_values::length::LengthPercentageOrAuto),
    PaddingBlockStart(css::css_values::length::LengthPercentageOrAuto),
    PaddingBlockEnd(css::css_values::length::LengthPercentageOrAuto),
    PaddingInlineStart(css::css_values::length::LengthPercentageOrAuto),
    PaddingInlineEnd(css::css_values::length::LengthPercentageOrAuto),
    PaddingBlock(margin_padding::PaddingBlock),
    PaddingInline(margin_padding::PaddingInline),
    Padding(margin_padding::Padding),
    ScrollMarginTop(css::css_values::length::LengthPercentageOrAuto),
    ScrollMarginBottom(css::css_values::length::LengthPercentageOrAuto),
    ScrollMarginLeft(css::css_values::length::LengthPercentageOrAuto),
    ScrollMarginRight(css::css_values::length::LengthPercentageOrAuto),
    ScrollMarginBlockStart(css::css_values::length::LengthPercentageOrAuto),
    ScrollMarginBlockEnd(css::css_values::length::LengthPercentageOrAuto),
    ScrollMarginInlineStart(css::css_values::length::LengthPercentageOrAuto),
    ScrollMarginInlineEnd(css::css_values::length::LengthPercentageOrAuto),
    ScrollMarginBlock(margin_padding::ScrollMarginBlock),
    ScrollMarginInline(margin_padding::ScrollMarginInline),
    ScrollMargin(margin_padding::ScrollMargin),
    ScrollPaddingTop(css::css_values::length::LengthPercentageOrAuto),
    ScrollPaddingBottom(css::css_values::length::LengthPercentageOrAuto),
    ScrollPaddingLeft(css::css_values::length::LengthPercentageOrAuto),
    ScrollPaddingRight(css::css_values::length::LengthPercentageOrAuto),
    ScrollPaddingBlockStart(css::css_values::length::LengthPercentageOrAuto),
    ScrollPaddingBlockEnd(css::css_values::length::LengthPercentageOrAuto),
    ScrollPaddingInlineStart(css::css_values::length::LengthPercentageOrAuto),
    ScrollPaddingInlineEnd(css::css_values::length::LengthPercentageOrAuto),
    ScrollPaddingBlock(margin_padding::ScrollPaddingBlock),
    ScrollPaddingInline(margin_padding::ScrollPaddingInline),
    ScrollPadding(margin_padding::ScrollPadding),
    FontWeight(font::FontWeight),
    FontSize(font::FontSize),
    FontStretch(font::FontStretch),
    FontFamily(Vec<font::FontFamily>),
    FontStyle(font::FontStyle),
    FontVariantCaps(font::FontVariantCaps),
    LineHeight(font::LineHeight),
    Font(font::Font),
    TransitionProperty((SmallList<PropertyId, 1>, VendorPrefix)),
    TransitionDuration((SmallList<css::css_values::time::Time, 1>, VendorPrefix)),
    TransitionDelay((SmallList<css::css_values::time::Time, 1>, VendorPrefix)),
    TransitionTimingFunction(
        (
            SmallList<css::css_values::easing::EasingFunction, 1>,
            VendorPrefix,
        ),
    ),
    Transition((SmallList<transition::Transition, 1>, VendorPrefix)),
    Animation((SmallList<animation::Animation, 1>, VendorPrefix)),
    AnimationName((SmallList<animation::AnimationName, 1>, VendorPrefix)),
    Transform((transform::TransformList, VendorPrefix)),
    TransformOrigin((position::Position, VendorPrefix)),
    TransformStyle((transform::TransformStyle, VendorPrefix)),
    TransformBox(transform::TransformBox),
    BackfaceVisibility((transform::BackfaceVisibility, VendorPrefix)),
    Perspective((transform::Perspective, VendorPrefix)),
    PerspectiveOrigin((position::Position, VendorPrefix)),
    Translate(transform::Translate),
    Rotate(transform::Rotate),
    Scale(transform::Scale),
    TextDecorationColor((css::css_values::color::CssColor, VendorPrefix)),
    TextEmphasisColor((css::css_values::color::CssColor, VendorPrefix)),
    TextShadow(SmallList<text::TextShadow, 1>),
    Direction(text::Direction),
    Composes(css_modules::Composes),
    MaskImage((SmallList<css::css_values::image::Image, 1>, VendorPrefix)),
    MaskMode(SmallList<masking::MaskMode, 1>),
    MaskRepeat((SmallList<background::BackgroundRepeat, 1>, VendorPrefix)),
    MaskPositionX(SmallList<css::css_values::position::HorizontalPosition, 1>),
    MaskPositionY(SmallList<css::css_values::position::VerticalPosition, 1>),
    MaskPosition((SmallList<position::Position, 1>, VendorPrefix)),
    MaskClip((SmallList<masking::MaskClip, 1>, VendorPrefix)),
    MaskOrigin((SmallList<masking::GeometryBox, 1>, VendorPrefix)),
    MaskSize((SmallList<background::BackgroundSize, 1>, VendorPrefix)),
    MaskComposite(SmallList<masking::MaskComposite, 1>),
    MaskType(masking::MaskType),
    Mask((SmallList<masking::Mask, 1>, VendorPrefix)),
    MaskBorderSource(css::css_values::image::Image),
    MaskBorderMode(masking::MaskBorderMode),
    MaskBorderSlice(border_image::BorderImageSlice),
    MaskBorderWidth(css::css_values::rect::Rect<border_image::BorderImageSideWidth>),
    MaskBorderOutset(css::css_values::rect::Rect<css::css_values::length::LengthOrNumber>),
    MaskBorderRepeat(border_image::BorderImageRepeat),
    MaskBorder(masking::MaskBorder),
    WebKitMaskComposite(SmallList<masking::WebKitMaskComposite, 1>),
    MaskSourceType((SmallList<masking::WebKitMaskSourceType, 1>, VendorPrefix)),
    MaskBoxImage((border_image::BorderImage, VendorPrefix)),
    MaskBoxImageSource((css::css_values::image::Image, VendorPrefix)),
    MaskBoxImageSlice((border_image::BorderImageSlice, VendorPrefix)),
    MaskBoxImageWidth(
        (
            css::css_values::rect::Rect<border_image::BorderImageSideWidth>,
            VendorPrefix,
        ),
    ),
    MaskBoxImageOutset(
        (
            css::css_values::rect::Rect<css::css_values::length::LengthOrNumber>,
            VendorPrefix,
        ),
    ),
    MaskBoxImageRepeat((border_image::BorderImageRepeat, VendorPrefix)),
    ColorScheme(ui::ColorScheme),
    ViewTransitionName(transition::ViewTransitionName),
    ViewTransitionClass(css::css_values::ident::NoneOrCustomIdentList),
    ViewTransitionGroup(transition::ViewTransitionGroup),
    All(CSSWideKeyword),
    Unparsed(UnparsedProperty),
    Custom(CustomProperty),
}

/// A fully-consumed `T`, or `None` (falling back to `Property::Unparsed`).
/// One instantiation per value type rather than one inlined copy per property.
fn parse_value<T: css::generic::ParseWithOptions>(
    input: &mut css::Parser,
    options: &css::ParserOptions,
) -> Option<T> {
    let value = T::parse_with_options(input, options).ok()?;
    input.expect_exhausted().is_ok().then_some(value)
}

impl Property {
    /// Returns the [`PropertyId`] for this declaration.
    pub(crate) fn property_id(&self) -> PropertyId {
        match self {
            Property::BackgroundColor(..) => PropertyId::BackgroundColor,
            Property::BackgroundImage(..) => PropertyId::BackgroundImage,
            Property::BackgroundPositionX(..) => PropertyId::BackgroundPositionX,
            Property::BackgroundPositionY(..) => PropertyId::BackgroundPositionY,
            Property::BackgroundPosition(..) => PropertyId::BackgroundPosition,
            Property::BackgroundSize(..) => PropertyId::BackgroundSize,
            Property::BackgroundRepeat(..) => PropertyId::BackgroundRepeat,
            Property::BackgroundAttachment(..) => PropertyId::BackgroundAttachment,
            Property::BackgroundClip(v) => PropertyId::BackgroundClip(v.1),
            Property::BackgroundOrigin(..) => PropertyId::BackgroundOrigin,
            Property::Background(..) => PropertyId::Background,
            Property::BoxShadow(v) => PropertyId::BoxShadow(v.1),
            Property::Opacity(..) => PropertyId::Opacity,
            Property::Color(..) => PropertyId::Color,
            Property::Display(..) => PropertyId::Display,
            Property::Visibility(..) => PropertyId::Visibility,
            Property::Width(..) => PropertyId::Width,
            Property::Height(..) => PropertyId::Height,
            Property::MinWidth(..) => PropertyId::MinWidth,
            Property::MinHeight(..) => PropertyId::MinHeight,
            Property::MaxWidth(..) => PropertyId::MaxWidth,
            Property::MaxHeight(..) => PropertyId::MaxHeight,
            Property::BlockSize(..) => PropertyId::BlockSize,
            Property::InlineSize(..) => PropertyId::InlineSize,
            Property::MinBlockSize(..) => PropertyId::MinBlockSize,
            Property::MinInlineSize(..) => PropertyId::MinInlineSize,
            Property::MaxBlockSize(..) => PropertyId::MaxBlockSize,
            Property::MaxInlineSize(..) => PropertyId::MaxInlineSize,
            Property::BoxSizing(v) => PropertyId::BoxSizing(v.1),
            Property::AspectRatio(..) => PropertyId::AspectRatio,
            Property::Overflow(..) => PropertyId::Overflow,
            Property::OverflowX(..) => PropertyId::OverflowX,
            Property::OverflowY(..) => PropertyId::OverflowY,
            Property::TextOverflow(v) => PropertyId::TextOverflow(v.1),
            Property::Position(..) => PropertyId::Position,
            Property::Top(..) => PropertyId::Top,
            Property::Bottom(..) => PropertyId::Bottom,
            Property::Left(..) => PropertyId::Left,
            Property::Right(..) => PropertyId::Right,
            Property::InsetBlockStart(..) => PropertyId::InsetBlockStart,
            Property::InsetBlockEnd(..) => PropertyId::InsetBlockEnd,
            Property::InsetInlineStart(..) => PropertyId::InsetInlineStart,
            Property::InsetInlineEnd(..) => PropertyId::InsetInlineEnd,
            Property::InsetBlock(..) => PropertyId::InsetBlock,
            Property::InsetInline(..) => PropertyId::InsetInline,
            Property::Inset(..) => PropertyId::Inset,
            Property::BorderSpacing(..) => PropertyId::BorderSpacing,
            Property::BorderTopColor(..) => PropertyId::BorderTopColor,
            Property::BorderBottomColor(..) => PropertyId::BorderBottomColor,
            Property::BorderLeftColor(..) => PropertyId::BorderLeftColor,
            Property::BorderRightColor(..) => PropertyId::BorderRightColor,
            Property::BorderBlockStartColor(..) => PropertyId::BorderBlockStartColor,
            Property::BorderBlockEndColor(..) => PropertyId::BorderBlockEndColor,
            Property::BorderInlineStartColor(..) => PropertyId::BorderInlineStartColor,
            Property::BorderInlineEndColor(..) => PropertyId::BorderInlineEndColor,
            Property::BorderTopStyle(..) => PropertyId::BorderTopStyle,
            Property::BorderBottomStyle(..) => PropertyId::BorderBottomStyle,
            Property::BorderLeftStyle(..) => PropertyId::BorderLeftStyle,
            Property::BorderRightStyle(..) => PropertyId::BorderRightStyle,
            Property::BorderBlockStartStyle(..) => PropertyId::BorderBlockStartStyle,
            Property::BorderBlockEndStyle(..) => PropertyId::BorderBlockEndStyle,
            Property::BorderInlineStartStyle(..) => PropertyId::BorderInlineStartStyle,
            Property::BorderInlineEndStyle(..) => PropertyId::BorderInlineEndStyle,
            Property::BorderTopWidth(..) => PropertyId::BorderTopWidth,
            Property::BorderBottomWidth(..) => PropertyId::BorderBottomWidth,
            Property::BorderLeftWidth(..) => PropertyId::BorderLeftWidth,
            Property::BorderRightWidth(..) => PropertyId::BorderRightWidth,
            Property::BorderBlockStartWidth(..) => PropertyId::BorderBlockStartWidth,
            Property::BorderBlockEndWidth(..) => PropertyId::BorderBlockEndWidth,
            Property::BorderInlineStartWidth(..) => PropertyId::BorderInlineStartWidth,
            Property::BorderInlineEndWidth(..) => PropertyId::BorderInlineEndWidth,
            Property::BorderTopLeftRadius(v) => PropertyId::BorderTopLeftRadius(v.1),
            Property::BorderTopRightRadius(v) => PropertyId::BorderTopRightRadius(v.1),
            Property::BorderBottomLeftRadius(v) => PropertyId::BorderBottomLeftRadius(v.1),
            Property::BorderBottomRightRadius(v) => PropertyId::BorderBottomRightRadius(v.1),
            Property::BorderStartStartRadius(..) => PropertyId::BorderStartStartRadius,
            Property::BorderStartEndRadius(..) => PropertyId::BorderStartEndRadius,
            Property::BorderEndStartRadius(..) => PropertyId::BorderEndStartRadius,
            Property::BorderEndEndRadius(..) => PropertyId::BorderEndEndRadius,
            Property::BorderRadius(v) => PropertyId::BorderRadius(v.1),
            Property::BorderImageSource(..) => PropertyId::BorderImageSource,
            Property::BorderImageOutset(..) => PropertyId::BorderImageOutset,
            Property::BorderImageRepeat(..) => PropertyId::BorderImageRepeat,
            Property::BorderImageWidth(..) => PropertyId::BorderImageWidth,
            Property::BorderImageSlice(..) => PropertyId::BorderImageSlice,
            Property::BorderImage(v) => PropertyId::BorderImage(v.1),
            Property::BorderColor(..) => PropertyId::BorderColor,
            Property::BorderStyle(..) => PropertyId::BorderStyle,
            Property::BorderWidth(..) => PropertyId::BorderWidth,
            Property::BorderBlockColor(..) => PropertyId::BorderBlockColor,
            Property::BorderBlockStyle(..) => PropertyId::BorderBlockStyle,
            Property::BorderBlockWidth(..) => PropertyId::BorderBlockWidth,
            Property::BorderInlineColor(..) => PropertyId::BorderInlineColor,
            Property::BorderInlineStyle(..) => PropertyId::BorderInlineStyle,
            Property::BorderInlineWidth(..) => PropertyId::BorderInlineWidth,
            Property::Border(..) => PropertyId::Border,
            Property::BorderTop(..) => PropertyId::BorderTop,
            Property::BorderBottom(..) => PropertyId::BorderBottom,
            Property::BorderLeft(..) => PropertyId::BorderLeft,
            Property::BorderRight(..) => PropertyId::BorderRight,
            Property::BorderBlock(..) => PropertyId::BorderBlock,
            Property::BorderBlockStart(..) => PropertyId::BorderBlockStart,
            Property::BorderBlockEnd(..) => PropertyId::BorderBlockEnd,
            Property::BorderInline(..) => PropertyId::BorderInline,
            Property::BorderInlineStart(..) => PropertyId::BorderInlineStart,
            Property::BorderInlineEnd(..) => PropertyId::BorderInlineEnd,
            Property::Outline(..) => PropertyId::Outline,
            Property::OutlineColor(..) => PropertyId::OutlineColor,
            Property::OutlineStyle(..) => PropertyId::OutlineStyle,
            Property::OutlineWidth(..) => PropertyId::OutlineWidth,
            Property::FlexDirection(v) => PropertyId::FlexDirection(v.1),
            Property::FlexWrap(v) => PropertyId::FlexWrap(v.1),
            Property::FlexFlow(v) => PropertyId::FlexFlow(v.1),
            Property::FlexGrow(v) => PropertyId::FlexGrow(v.1),
            Property::FlexShrink(v) => PropertyId::FlexShrink(v.1),
            Property::FlexBasis(v) => PropertyId::FlexBasis(v.1),
            Property::Flex(v) => PropertyId::Flex(v.1),
            Property::Order(v) => PropertyId::Order(v.1),
            Property::AlignContent(v) => PropertyId::AlignContent(v.1),
            Property::JustifyContent(v) => PropertyId::JustifyContent(v.1),
            Property::PlaceContent(..) => PropertyId::PlaceContent,
            Property::AlignSelf(v) => PropertyId::AlignSelf(v.1),
            Property::JustifySelf(..) => PropertyId::JustifySelf,
            Property::PlaceSelf(..) => PropertyId::PlaceSelf,
            Property::AlignItems(v) => PropertyId::AlignItems(v.1),
            Property::JustifyItems(..) => PropertyId::JustifyItems,
            Property::PlaceItems(..) => PropertyId::PlaceItems,
            Property::RowGap(..) => PropertyId::RowGap,
            Property::ColumnGap(..) => PropertyId::ColumnGap,
            Property::Gap(..) => PropertyId::Gap,
            Property::BoxOrient(v) => PropertyId::BoxOrient(v.1),
            Property::BoxDirection(v) => PropertyId::BoxDirection(v.1),
            Property::BoxOrdinalGroup(v) => PropertyId::BoxOrdinalGroup(v.1),
            Property::BoxAlign(v) => PropertyId::BoxAlign(v.1),
            Property::BoxFlex(v) => PropertyId::BoxFlex(v.1),
            Property::BoxFlexGroup(v) => PropertyId::BoxFlexGroup(v.1),
            Property::BoxPack(v) => PropertyId::BoxPack(v.1),
            Property::BoxLines(v) => PropertyId::BoxLines(v.1),
            Property::FlexPack(v) => PropertyId::FlexPack(v.1),
            Property::FlexOrder(v) => PropertyId::FlexOrder(v.1),
            Property::FlexAlign(v) => PropertyId::FlexAlign(v.1),
            Property::FlexItemAlign(v) => PropertyId::FlexItemAlign(v.1),
            Property::FlexLinePack(v) => PropertyId::FlexLinePack(v.1),
            Property::FlexPositive(v) => PropertyId::FlexPositive(v.1),
            Property::FlexNegative(v) => PropertyId::FlexNegative(v.1),
            Property::FlexPreferredSize(v) => PropertyId::FlexPreferredSize(v.1),
            Property::MarginTop(..) => PropertyId::MarginTop,
            Property::MarginBottom(..) => PropertyId::MarginBottom,
            Property::MarginLeft(..) => PropertyId::MarginLeft,
            Property::MarginRight(..) => PropertyId::MarginRight,
            Property::MarginBlockStart(..) => PropertyId::MarginBlockStart,
            Property::MarginBlockEnd(..) => PropertyId::MarginBlockEnd,
            Property::MarginInlineStart(..) => PropertyId::MarginInlineStart,
            Property::MarginInlineEnd(..) => PropertyId::MarginInlineEnd,
            Property::MarginBlock(..) => PropertyId::MarginBlock,
            Property::MarginInline(..) => PropertyId::MarginInline,
            Property::Margin(..) => PropertyId::Margin,
            Property::PaddingTop(..) => PropertyId::PaddingTop,
            Property::PaddingBottom(..) => PropertyId::PaddingBottom,
            Property::PaddingLeft(..) => PropertyId::PaddingLeft,
            Property::PaddingRight(..) => PropertyId::PaddingRight,
            Property::PaddingBlockStart(..) => PropertyId::PaddingBlockStart,
            Property::PaddingBlockEnd(..) => PropertyId::PaddingBlockEnd,
            Property::PaddingInlineStart(..) => PropertyId::PaddingInlineStart,
            Property::PaddingInlineEnd(..) => PropertyId::PaddingInlineEnd,
            Property::PaddingBlock(..) => PropertyId::PaddingBlock,
            Property::PaddingInline(..) => PropertyId::PaddingInline,
            Property::Padding(..) => PropertyId::Padding,
            Property::ScrollMarginTop(..) => PropertyId::ScrollMarginTop,
            Property::ScrollMarginBottom(..) => PropertyId::ScrollMarginBottom,
            Property::ScrollMarginLeft(..) => PropertyId::ScrollMarginLeft,
            Property::ScrollMarginRight(..) => PropertyId::ScrollMarginRight,
            Property::ScrollMarginBlockStart(..) => PropertyId::ScrollMarginBlockStart,
            Property::ScrollMarginBlockEnd(..) => PropertyId::ScrollMarginBlockEnd,
            Property::ScrollMarginInlineStart(..) => PropertyId::ScrollMarginInlineStart,
            Property::ScrollMarginInlineEnd(..) => PropertyId::ScrollMarginInlineEnd,
            Property::ScrollMarginBlock(..) => PropertyId::ScrollMarginBlock,
            Property::ScrollMarginInline(..) => PropertyId::ScrollMarginInline,
            Property::ScrollMargin(..) => PropertyId::ScrollMargin,
            Property::ScrollPaddingTop(..) => PropertyId::ScrollPaddingTop,
            Property::ScrollPaddingBottom(..) => PropertyId::ScrollPaddingBottom,
            Property::ScrollPaddingLeft(..) => PropertyId::ScrollPaddingLeft,
            Property::ScrollPaddingRight(..) => PropertyId::ScrollPaddingRight,
            Property::ScrollPaddingBlockStart(..) => PropertyId::ScrollPaddingBlockStart,
            Property::ScrollPaddingBlockEnd(..) => PropertyId::ScrollPaddingBlockEnd,
            Property::ScrollPaddingInlineStart(..) => PropertyId::ScrollPaddingInlineStart,
            Property::ScrollPaddingInlineEnd(..) => PropertyId::ScrollPaddingInlineEnd,
            Property::ScrollPaddingBlock(..) => PropertyId::ScrollPaddingBlock,
            Property::ScrollPaddingInline(..) => PropertyId::ScrollPaddingInline,
            Property::ScrollPadding(..) => PropertyId::ScrollPadding,
            Property::FontWeight(..) => PropertyId::FontWeight,
            Property::FontSize(..) => PropertyId::FontSize,
            Property::FontStretch(..) => PropertyId::FontStretch,
            Property::FontFamily(..) => PropertyId::FontFamily,
            Property::FontStyle(..) => PropertyId::FontStyle,
            Property::FontVariantCaps(..) => PropertyId::FontVariantCaps,
            Property::LineHeight(..) => PropertyId::LineHeight,
            Property::Font(..) => PropertyId::Font,
            Property::TransitionProperty(v) => PropertyId::TransitionProperty(v.1),
            Property::TransitionDuration(v) => PropertyId::TransitionDuration(v.1),
            Property::TransitionDelay(v) => PropertyId::TransitionDelay(v.1),
            Property::TransitionTimingFunction(v) => PropertyId::TransitionTimingFunction(v.1),
            Property::Transition(v) => PropertyId::Transition(v.1),
            Property::Animation(v) => PropertyId::Animation(v.1),
            Property::AnimationName(v) => PropertyId::AnimationName(v.1),
            Property::Transform(v) => PropertyId::Transform(v.1),
            Property::TransformOrigin(v) => PropertyId::TransformOrigin(v.1),
            Property::TransformStyle(v) => PropertyId::TransformStyle(v.1),
            Property::TransformBox(..) => PropertyId::TransformBox,
            Property::BackfaceVisibility(v) => PropertyId::BackfaceVisibility(v.1),
            Property::Perspective(v) => PropertyId::Perspective(v.1),
            Property::PerspectiveOrigin(v) => PropertyId::PerspectiveOrigin(v.1),
            Property::Translate(..) => PropertyId::Translate,
            Property::Rotate(..) => PropertyId::Rotate,
            Property::Scale(..) => PropertyId::Scale,
            Property::TextDecorationColor(v) => PropertyId::TextDecorationColor(v.1),
            Property::TextEmphasisColor(v) => PropertyId::TextEmphasisColor(v.1),
            Property::TextShadow(..) => PropertyId::TextShadow,
            Property::Direction(..) => PropertyId::Direction,
            Property::Composes(..) => PropertyId::Composes,
            Property::MaskImage(v) => PropertyId::MaskImage(v.1),
            Property::MaskMode(..) => PropertyId::MaskMode,
            Property::MaskRepeat(v) => PropertyId::MaskRepeat(v.1),
            Property::MaskPositionX(..) => PropertyId::MaskPositionX,
            Property::MaskPositionY(..) => PropertyId::MaskPositionY,
            Property::MaskPosition(v) => PropertyId::MaskPosition(v.1),
            Property::MaskClip(v) => PropertyId::MaskClip(v.1),
            Property::MaskOrigin(v) => PropertyId::MaskOrigin(v.1),
            Property::MaskSize(v) => PropertyId::MaskSize(v.1),
            Property::MaskComposite(..) => PropertyId::MaskComposite,
            Property::MaskType(..) => PropertyId::MaskType,
            Property::Mask(v) => PropertyId::Mask(v.1),
            Property::MaskBorderSource(..) => PropertyId::MaskBorderSource,
            Property::MaskBorderMode(..) => PropertyId::MaskBorderMode,
            Property::MaskBorderSlice(..) => PropertyId::MaskBorderSlice,
            Property::MaskBorderWidth(..) => PropertyId::MaskBorderWidth,
            Property::MaskBorderOutset(..) => PropertyId::MaskBorderOutset,
            Property::MaskBorderRepeat(..) => PropertyId::MaskBorderRepeat,
            Property::MaskBorder(..) => PropertyId::MaskBorder,
            Property::WebKitMaskComposite(..) => PropertyId::WebKitMaskComposite,
            Property::MaskSourceType(v) => PropertyId::MaskSourceType(v.1),
            Property::MaskBoxImage(v) => PropertyId::MaskBoxImage(v.1),
            Property::MaskBoxImageSource(v) => PropertyId::MaskBoxImageSource(v.1),
            Property::MaskBoxImageSlice(v) => PropertyId::MaskBoxImageSlice(v.1),
            Property::MaskBoxImageWidth(v) => PropertyId::MaskBoxImageWidth(v.1),
            Property::MaskBoxImageOutset(v) => PropertyId::MaskBoxImageOutset(v.1),
            Property::MaskBoxImageRepeat(v) => PropertyId::MaskBoxImageRepeat(v.1),
            Property::ColorScheme(..) => PropertyId::ColorScheme,
            Property::ViewTransitionName(..) => PropertyId::ViewTransitionName,
            Property::ViewTransitionClass(..) => PropertyId::ViewTransitionClass,
            Property::ViewTransitionGroup(..) => PropertyId::ViewTransitionGroup,
            Property::All(..) => PropertyId::All,
            Property::Unparsed(u) => u.property_id,
            Property::Custom(c) => PropertyId::Custom(c.name),
        }
    }

    /// `(name, prefix)` pair for serialization. Panics on `Custom`.
    pub(crate) fn __to_css_helper(&self) -> (&[u8], VendorPrefix) {
        match self {
            Property::Custom(..) => unreachable!(),
            Property::Unparsed(u) => (u.property_id.name(), u.property_id.prefix().or_none()),
            _ => {
                let id = self.property_id();
                (id.tag().name(), id.prefix().or_none())
            }
        }
    }

    /// Serializes the value (right-hand side) of this declaration.
    pub(crate) fn value_to_css(&self, dest: &mut css::Printer) -> Result<(), css::PrintErr> {
        match self {
            Property::BackgroundColor(v) => css::generic::to_css(v, dest),
            Property::BackgroundImage(v) => css::generic::to_css(v, dest),
            Property::BackgroundPositionX(v) => css::generic::to_css(v, dest),
            Property::BackgroundPositionY(v) => css::generic::to_css(v, dest),
            Property::BackgroundPosition(v) => css::generic::to_css(v, dest),
            Property::BackgroundSize(v) => css::generic::to_css(v, dest),
            Property::BackgroundRepeat(v) => css::generic::to_css(v, dest),
            Property::BackgroundAttachment(v) => css::generic::to_css(v, dest),
            Property::BackgroundClip(v) => css::generic::to_css(&v.0, dest),
            Property::BackgroundOrigin(v) => css::generic::to_css(v, dest),
            Property::Background(v) => css::generic::to_css(v, dest),
            Property::BoxShadow(v) => css::generic::to_css(&v.0, dest),
            Property::Opacity(v) => css::generic::to_css(v, dest),
            Property::Color(v) => css::generic::to_css(v, dest),
            Property::Display(v) => css::generic::to_css(v, dest),
            Property::Visibility(v) => css::generic::to_css(v, dest),
            Property::Width(v) => css::generic::to_css(v, dest),
            Property::Height(v) => css::generic::to_css(v, dest),
            Property::MinWidth(v) => css::generic::to_css(v, dest),
            Property::MinHeight(v) => css::generic::to_css(v, dest),
            Property::MaxWidth(v) => css::generic::to_css(v, dest),
            Property::MaxHeight(v) => css::generic::to_css(v, dest),
            Property::BlockSize(v) => css::generic::to_css(v, dest),
            Property::InlineSize(v) => css::generic::to_css(v, dest),
            Property::MinBlockSize(v) => css::generic::to_css(v, dest),
            Property::MinInlineSize(v) => css::generic::to_css(v, dest),
            Property::MaxBlockSize(v) => css::generic::to_css(v, dest),
            Property::MaxInlineSize(v) => css::generic::to_css(v, dest),
            Property::BoxSizing(v) => css::generic::to_css(&v.0, dest),
            Property::AspectRatio(v) => css::generic::to_css(v, dest),
            Property::Overflow(v) => css::generic::to_css(v, dest),
            Property::OverflowX(v) => css::generic::to_css(v, dest),
            Property::OverflowY(v) => css::generic::to_css(v, dest),
            Property::TextOverflow(v) => css::generic::to_css(&v.0, dest),
            Property::Position(v) => css::generic::to_css(v, dest),
            Property::Top(v) => css::generic::to_css(v, dest),
            Property::Bottom(v) => css::generic::to_css(v, dest),
            Property::Left(v) => css::generic::to_css(v, dest),
            Property::Right(v) => css::generic::to_css(v, dest),
            Property::InsetBlockStart(v) => css::generic::to_css(v, dest),
            Property::InsetBlockEnd(v) => css::generic::to_css(v, dest),
            Property::InsetInlineStart(v) => css::generic::to_css(v, dest),
            Property::InsetInlineEnd(v) => css::generic::to_css(v, dest),
            Property::InsetBlock(v) => css::generic::to_css(v, dest),
            Property::InsetInline(v) => css::generic::to_css(v, dest),
            Property::Inset(v) => css::generic::to_css(v, dest),
            Property::BorderSpacing(v) => css::generic::to_css(v, dest),
            Property::BorderTopColor(v) => css::generic::to_css(v, dest),
            Property::BorderBottomColor(v) => css::generic::to_css(v, dest),
            Property::BorderLeftColor(v) => css::generic::to_css(v, dest),
            Property::BorderRightColor(v) => css::generic::to_css(v, dest),
            Property::BorderBlockStartColor(v) => css::generic::to_css(v, dest),
            Property::BorderBlockEndColor(v) => css::generic::to_css(v, dest),
            Property::BorderInlineStartColor(v) => css::generic::to_css(v, dest),
            Property::BorderInlineEndColor(v) => css::generic::to_css(v, dest),
            Property::BorderTopStyle(v) => css::generic::to_css(v, dest),
            Property::BorderBottomStyle(v) => css::generic::to_css(v, dest),
            Property::BorderLeftStyle(v) => css::generic::to_css(v, dest),
            Property::BorderRightStyle(v) => css::generic::to_css(v, dest),
            Property::BorderBlockStartStyle(v) => css::generic::to_css(v, dest),
            Property::BorderBlockEndStyle(v) => css::generic::to_css(v, dest),
            Property::BorderInlineStartStyle(v) => css::generic::to_css(v, dest),
            Property::BorderInlineEndStyle(v) => css::generic::to_css(v, dest),
            Property::BorderTopWidth(v) => css::generic::to_css(v, dest),
            Property::BorderBottomWidth(v) => css::generic::to_css(v, dest),
            Property::BorderLeftWidth(v) => css::generic::to_css(v, dest),
            Property::BorderRightWidth(v) => css::generic::to_css(v, dest),
            Property::BorderBlockStartWidth(v) => css::generic::to_css(v, dest),
            Property::BorderBlockEndWidth(v) => css::generic::to_css(v, dest),
            Property::BorderInlineStartWidth(v) => css::generic::to_css(v, dest),
            Property::BorderInlineEndWidth(v) => css::generic::to_css(v, dest),
            Property::BorderTopLeftRadius(v) => css::generic::to_css(&v.0, dest),
            Property::BorderTopRightRadius(v) => css::generic::to_css(&v.0, dest),
            Property::BorderBottomLeftRadius(v) => css::generic::to_css(&v.0, dest),
            Property::BorderBottomRightRadius(v) => css::generic::to_css(&v.0, dest),
            Property::BorderStartStartRadius(v) => css::generic::to_css(v, dest),
            Property::BorderStartEndRadius(v) => css::generic::to_css(v, dest),
            Property::BorderEndStartRadius(v) => css::generic::to_css(v, dest),
            Property::BorderEndEndRadius(v) => css::generic::to_css(v, dest),
            Property::BorderRadius(v) => css::generic::to_css(&v.0, dest),
            Property::BorderImageSource(v) => css::generic::to_css(v, dest),
            Property::BorderImageOutset(v) => css::generic::to_css(v, dest),
            Property::BorderImageRepeat(v) => css::generic::to_css(v, dest),
            Property::BorderImageWidth(v) => css::generic::to_css(v, dest),
            Property::BorderImageSlice(v) => css::generic::to_css(v, dest),
            Property::BorderImage(v) => css::generic::to_css(&v.0, dest),
            Property::BorderColor(v) => css::generic::to_css(v, dest),
            Property::BorderStyle(v) => css::generic::to_css(v, dest),
            Property::BorderWidth(v) => css::generic::to_css(v, dest),
            Property::BorderBlockColor(v) => css::generic::to_css(v, dest),
            Property::BorderBlockStyle(v) => css::generic::to_css(v, dest),
            Property::BorderBlockWidth(v) => css::generic::to_css(v, dest),
            Property::BorderInlineColor(v) => css::generic::to_css(v, dest),
            Property::BorderInlineStyle(v) => css::generic::to_css(v, dest),
            Property::BorderInlineWidth(v) => css::generic::to_css(v, dest),
            Property::Border(v) => css::generic::to_css(v, dest),
            Property::BorderTop(v) => css::generic::to_css(v, dest),
            Property::BorderBottom(v) => css::generic::to_css(v, dest),
            Property::BorderLeft(v) => css::generic::to_css(v, dest),
            Property::BorderRight(v) => css::generic::to_css(v, dest),
            Property::BorderBlock(v) => css::generic::to_css(v, dest),
            Property::BorderBlockStart(v) => css::generic::to_css(v, dest),
            Property::BorderBlockEnd(v) => css::generic::to_css(v, dest),
            Property::BorderInline(v) => css::generic::to_css(v, dest),
            Property::BorderInlineStart(v) => css::generic::to_css(v, dest),
            Property::BorderInlineEnd(v) => css::generic::to_css(v, dest),
            Property::Outline(v) => css::generic::to_css(v, dest),
            Property::OutlineColor(v) => css::generic::to_css(v, dest),
            Property::OutlineStyle(v) => css::generic::to_css(v, dest),
            Property::OutlineWidth(v) => css::generic::to_css(v, dest),
            Property::FlexDirection(v) => css::generic::to_css(&v.0, dest),
            Property::FlexWrap(v) => css::generic::to_css(&v.0, dest),
            Property::FlexFlow(v) => css::generic::to_css(&v.0, dest),
            Property::FlexGrow(v) => css::generic::to_css(&v.0, dest),
            Property::FlexShrink(v) => css::generic::to_css(&v.0, dest),
            Property::FlexBasis(v) => css::generic::to_css(&v.0, dest),
            Property::Flex(v) => css::generic::to_css(&v.0, dest),
            Property::Order(v) => css::generic::to_css(&v.0, dest),
            Property::AlignContent(v) => css::generic::to_css(&v.0, dest),
            Property::JustifyContent(v) => css::generic::to_css(&v.0, dest),
            Property::PlaceContent(v) => css::generic::to_css(v, dest),
            Property::AlignSelf(v) => css::generic::to_css(&v.0, dest),
            Property::JustifySelf(v) => css::generic::to_css(v, dest),
            Property::PlaceSelf(v) => css::generic::to_css(v, dest),
            Property::AlignItems(v) => css::generic::to_css(&v.0, dest),
            Property::JustifyItems(v) => css::generic::to_css(v, dest),
            Property::PlaceItems(v) => css::generic::to_css(v, dest),
            Property::RowGap(v) => css::generic::to_css(v, dest),
            Property::ColumnGap(v) => css::generic::to_css(v, dest),
            Property::Gap(v) => css::generic::to_css(v, dest),
            Property::BoxOrient(v) => css::generic::to_css(&v.0, dest),
            Property::BoxDirection(v) => css::generic::to_css(&v.0, dest),
            Property::BoxOrdinalGroup(v) => css::generic::to_css(&v.0, dest),
            Property::BoxAlign(v) => css::generic::to_css(&v.0, dest),
            Property::BoxFlex(v) => css::generic::to_css(&v.0, dest),
            Property::BoxFlexGroup(v) => css::generic::to_css(&v.0, dest),
            Property::BoxPack(v) => css::generic::to_css(&v.0, dest),
            Property::BoxLines(v) => css::generic::to_css(&v.0, dest),
            Property::FlexPack(v) => css::generic::to_css(&v.0, dest),
            Property::FlexOrder(v) => css::generic::to_css(&v.0, dest),
            Property::FlexAlign(v) => css::generic::to_css(&v.0, dest),
            Property::FlexItemAlign(v) => css::generic::to_css(&v.0, dest),
            Property::FlexLinePack(v) => css::generic::to_css(&v.0, dest),
            Property::FlexPositive(v) => css::generic::to_css(&v.0, dest),
            Property::FlexNegative(v) => css::generic::to_css(&v.0, dest),
            Property::FlexPreferredSize(v) => css::generic::to_css(&v.0, dest),
            Property::MarginTop(v) => css::generic::to_css(v, dest),
            Property::MarginBottom(v) => css::generic::to_css(v, dest),
            Property::MarginLeft(v) => css::generic::to_css(v, dest),
            Property::MarginRight(v) => css::generic::to_css(v, dest),
            Property::MarginBlockStart(v) => css::generic::to_css(v, dest),
            Property::MarginBlockEnd(v) => css::generic::to_css(v, dest),
            Property::MarginInlineStart(v) => css::generic::to_css(v, dest),
            Property::MarginInlineEnd(v) => css::generic::to_css(v, dest),
            Property::MarginBlock(v) => css::generic::to_css(v, dest),
            Property::MarginInline(v) => css::generic::to_css(v, dest),
            Property::Margin(v) => css::generic::to_css(v, dest),
            Property::PaddingTop(v) => css::generic::to_css(v, dest),
            Property::PaddingBottom(v) => css::generic::to_css(v, dest),
            Property::PaddingLeft(v) => css::generic::to_css(v, dest),
            Property::PaddingRight(v) => css::generic::to_css(v, dest),
            Property::PaddingBlockStart(v) => css::generic::to_css(v, dest),
            Property::PaddingBlockEnd(v) => css::generic::to_css(v, dest),
            Property::PaddingInlineStart(v) => css::generic::to_css(v, dest),
            Property::PaddingInlineEnd(v) => css::generic::to_css(v, dest),
            Property::PaddingBlock(v) => css::generic::to_css(v, dest),
            Property::PaddingInline(v) => css::generic::to_css(v, dest),
            Property::Padding(v) => css::generic::to_css(v, dest),
            Property::ScrollMarginTop(v) => css::generic::to_css(v, dest),
            Property::ScrollMarginBottom(v) => css::generic::to_css(v, dest),
            Property::ScrollMarginLeft(v) => css::generic::to_css(v, dest),
            Property::ScrollMarginRight(v) => css::generic::to_css(v, dest),
            Property::ScrollMarginBlockStart(v) => css::generic::to_css(v, dest),
            Property::ScrollMarginBlockEnd(v) => css::generic::to_css(v, dest),
            Property::ScrollMarginInlineStart(v) => css::generic::to_css(v, dest),
            Property::ScrollMarginInlineEnd(v) => css::generic::to_css(v, dest),
            Property::ScrollMarginBlock(v) => css::generic::to_css(v, dest),
            Property::ScrollMarginInline(v) => css::generic::to_css(v, dest),
            Property::ScrollMargin(v) => css::generic::to_css(v, dest),
            Property::ScrollPaddingTop(v) => css::generic::to_css(v, dest),
            Property::ScrollPaddingBottom(v) => css::generic::to_css(v, dest),
            Property::ScrollPaddingLeft(v) => css::generic::to_css(v, dest),
            Property::ScrollPaddingRight(v) => css::generic::to_css(v, dest),
            Property::ScrollPaddingBlockStart(v) => css::generic::to_css(v, dest),
            Property::ScrollPaddingBlockEnd(v) => css::generic::to_css(v, dest),
            Property::ScrollPaddingInlineStart(v) => css::generic::to_css(v, dest),
            Property::ScrollPaddingInlineEnd(v) => css::generic::to_css(v, dest),
            Property::ScrollPaddingBlock(v) => css::generic::to_css(v, dest),
            Property::ScrollPaddingInline(v) => css::generic::to_css(v, dest),
            Property::ScrollPadding(v) => css::generic::to_css(v, dest),
            Property::FontWeight(v) => css::generic::to_css(v, dest),
            Property::FontSize(v) => css::generic::to_css(v, dest),
            Property::FontStretch(v) => css::generic::to_css(v, dest),
            Property::FontFamily(v) => css::generic::to_css(v, dest),
            Property::FontStyle(v) => css::generic::to_css(v, dest),
            Property::FontVariantCaps(v) => css::generic::to_css(v, dest),
            Property::LineHeight(v) => css::generic::to_css(v, dest),
            Property::Font(v) => css::generic::to_css(v, dest),
            Property::TransitionProperty(v) => css::generic::to_css(&v.0, dest),
            Property::TransitionDuration(v) => css::generic::to_css(&v.0, dest),
            Property::TransitionDelay(v) => css::generic::to_css(&v.0, dest),
            Property::TransitionTimingFunction(v) => css::generic::to_css(&v.0, dest),
            Property::Transition(v) => css::generic::to_css(&v.0, dest),
            Property::Animation(v) => css::generic::to_css(&v.0, dest),
            Property::AnimationName(v) => css::generic::to_css(&v.0, dest),
            Property::Transform(v) => css::generic::to_css(&v.0, dest),
            Property::TransformOrigin(v) => css::generic::to_css(&v.0, dest),
            Property::TransformStyle(v) => css::generic::to_css(&v.0, dest),
            Property::TransformBox(v) => css::generic::to_css(v, dest),
            Property::BackfaceVisibility(v) => css::generic::to_css(&v.0, dest),
            Property::Perspective(v) => css::generic::to_css(&v.0, dest),
            Property::PerspectiveOrigin(v) => css::generic::to_css(&v.0, dest),
            Property::Translate(v) => css::generic::to_css(v, dest),
            Property::Rotate(v) => css::generic::to_css(v, dest),
            Property::Scale(v) => css::generic::to_css(v, dest),
            Property::TextDecorationColor(v) => css::generic::to_css(&v.0, dest),
            Property::TextEmphasisColor(v) => css::generic::to_css(&v.0, dest),
            Property::TextShadow(v) => css::generic::to_css(v, dest),
            Property::Direction(v) => css::generic::to_css(v, dest),
            Property::Composes(v) => css::generic::to_css(v, dest),
            Property::MaskImage(v) => css::generic::to_css(&v.0, dest),
            Property::MaskMode(v) => css::generic::to_css(v, dest),
            Property::MaskRepeat(v) => css::generic::to_css(&v.0, dest),
            Property::MaskPositionX(v) => css::generic::to_css(v, dest),
            Property::MaskPositionY(v) => css::generic::to_css(v, dest),
            Property::MaskPosition(v) => css::generic::to_css(&v.0, dest),
            Property::MaskClip(v) => css::generic::to_css(&v.0, dest),
            Property::MaskOrigin(v) => css::generic::to_css(&v.0, dest),
            Property::MaskSize(v) => css::generic::to_css(&v.0, dest),
            Property::MaskComposite(v) => css::generic::to_css(v, dest),
            Property::MaskType(v) => css::generic::to_css(v, dest),
            Property::Mask(v) => css::generic::to_css(&v.0, dest),
            Property::MaskBorderSource(v) => css::generic::to_css(v, dest),
            Property::MaskBorderMode(v) => css::generic::to_css(v, dest),
            Property::MaskBorderSlice(v) => css::generic::to_css(v, dest),
            Property::MaskBorderWidth(v) => css::generic::to_css(v, dest),
            Property::MaskBorderOutset(v) => css::generic::to_css(v, dest),
            Property::MaskBorderRepeat(v) => css::generic::to_css(v, dest),
            Property::MaskBorder(v) => css::generic::to_css(v, dest),
            Property::WebKitMaskComposite(v) => css::generic::to_css(v, dest),
            Property::MaskSourceType(v) => css::generic::to_css(&v.0, dest),
            Property::MaskBoxImage(v) => css::generic::to_css(&v.0, dest),
            Property::MaskBoxImageSource(v) => css::generic::to_css(&v.0, dest),
            Property::MaskBoxImageSlice(v) => css::generic::to_css(&v.0, dest),
            Property::MaskBoxImageWidth(v) => css::generic::to_css(&v.0, dest),
            Property::MaskBoxImageOutset(v) => css::generic::to_css(&v.0, dest),
            Property::MaskBoxImageRepeat(v) => css::generic::to_css(&v.0, dest),
            Property::ColorScheme(v) => css::generic::to_css(v, dest),
            Property::ViewTransitionName(v) => css::generic::to_css(v, dest),
            Property::ViewTransitionClass(v) => css::generic::to_css(v, dest),
            Property::ViewTransitionGroup(v) => css::generic::to_css(v, dest),
            Property::All(v) => css::generic::to_css(v, dest),
            Property::Unparsed(u) => u.value.to_css(dest, false),
            Property::Custom(c) => c
                .value
                .to_css(dest, matches!(c.name, CustomPropertyName::Custom(..))),
        }
    }

    /// Parses a CSS property by name.
    pub fn parse(
        property_id: PropertyId,
        input: &mut css::Parser,
        options: &css::ParserOptions,
    ) -> css::Result<Property> {
        let state = input.state();

        match property_id {
            PropertyId::BackgroundColor => {
                if let Some(c) = parse_value::<css::css_values::color::CssColor>(input, options) {
                    return Ok(Property::BackgroundColor(c));
                }
            }
            PropertyId::BackgroundImage => {
                if let Some(c) =
                    parse_value::<SmallList<css::css_values::image::Image, 1>>(input, options)
                {
                    return Ok(Property::BackgroundImage(c));
                }
            }
            PropertyId::BackgroundPositionX => {
                if let Some(c) = parse_value::<
                    SmallList<css::css_values::position::HorizontalPosition, 1>,
                >(input, options)
                {
                    return Ok(Property::BackgroundPositionX(c));
                }
            }
            PropertyId::BackgroundPositionY => {
                if let Some(c) = parse_value::<
                    SmallList<css::css_values::position::VerticalPosition, 1>,
                >(input, options)
                {
                    return Ok(Property::BackgroundPositionY(c));
                }
            }
            PropertyId::BackgroundPosition => {
                if let Some(c) =
                    parse_value::<SmallList<background::BackgroundPosition, 1>>(input, options)
                {
                    return Ok(Property::BackgroundPosition(c));
                }
            }
            PropertyId::BackgroundSize => {
                if let Some(c) =
                    parse_value::<SmallList<background::BackgroundSize, 1>>(input, options)
                {
                    return Ok(Property::BackgroundSize(c));
                }
            }
            PropertyId::BackgroundRepeat => {
                if let Some(c) =
                    parse_value::<SmallList<background::BackgroundRepeat, 1>>(input, options)
                {
                    return Ok(Property::BackgroundRepeat(c));
                }
            }
            PropertyId::BackgroundAttachment => {
                if let Some(c) =
                    parse_value::<SmallList<background::BackgroundAttachment, 1>>(input, options)
                {
                    return Ok(Property::BackgroundAttachment(c));
                }
            }
            PropertyId::BackgroundClip(pre) => {
                if let Some(c) =
                    parse_value::<SmallList<background::BackgroundClip, 1>>(input, options)
                {
                    return Ok(Property::BackgroundClip((c, pre)));
                }
            }
            PropertyId::BackgroundOrigin => {
                if let Some(c) =
                    parse_value::<SmallList<background::BackgroundOrigin, 1>>(input, options)
                {
                    return Ok(Property::BackgroundOrigin(c));
                }
            }
            PropertyId::Background => {
                if let Some(c) = parse_value::<SmallList<background::Background, 1>>(input, options)
                {
                    return Ok(Property::Background(c));
                }
            }
            PropertyId::BoxShadow(pre) => {
                if let Some(c) = parse_value::<SmallList<box_shadow::BoxShadow, 1>>(input, options)
                {
                    return Ok(Property::BoxShadow((c, pre)));
                }
            }
            PropertyId::Opacity => {
                if let Some(c) = parse_value::<css::css_values::alpha::AlphaValue>(input, options) {
                    return Ok(Property::Opacity(c));
                }
            }
            PropertyId::Color => {
                if let Some(c) = parse_value::<css::css_values::color::CssColor>(input, options) {
                    return Ok(Property::Color(c));
                }
            }
            PropertyId::Display => {
                if let Some(c) = parse_value::<display::Display>(input, options) {
                    return Ok(Property::Display(c));
                }
            }
            PropertyId::Visibility => {
                if let Some(c) = parse_value::<display::Visibility>(input, options) {
                    return Ok(Property::Visibility(c));
                }
            }
            PropertyId::Width => {
                if let Some(c) = parse_value::<size::Size>(input, options) {
                    return Ok(Property::Width(c));
                }
            }
            PropertyId::Height => {
                if let Some(c) = parse_value::<size::Size>(input, options) {
                    return Ok(Property::Height(c));
                }
            }
            PropertyId::MinWidth => {
                if let Some(c) = parse_value::<size::Size>(input, options) {
                    return Ok(Property::MinWidth(c));
                }
            }
            PropertyId::MinHeight => {
                if let Some(c) = parse_value::<size::Size>(input, options) {
                    return Ok(Property::MinHeight(c));
                }
            }
            PropertyId::MaxWidth => {
                if let Some(c) = parse_value::<size::MaxSize>(input, options) {
                    return Ok(Property::MaxWidth(c));
                }
            }
            PropertyId::MaxHeight => {
                if let Some(c) = parse_value::<size::MaxSize>(input, options) {
                    return Ok(Property::MaxHeight(c));
                }
            }
            PropertyId::BlockSize => {
                if let Some(c) = parse_value::<size::Size>(input, options) {
                    return Ok(Property::BlockSize(c));
                }
            }
            PropertyId::InlineSize => {
                if let Some(c) = parse_value::<size::Size>(input, options) {
                    return Ok(Property::InlineSize(c));
                }
            }
            PropertyId::MinBlockSize => {
                if let Some(c) = parse_value::<size::Size>(input, options) {
                    return Ok(Property::MinBlockSize(c));
                }
            }
            PropertyId::MinInlineSize => {
                if let Some(c) = parse_value::<size::Size>(input, options) {
                    return Ok(Property::MinInlineSize(c));
                }
            }
            PropertyId::MaxBlockSize => {
                if let Some(c) = parse_value::<size::MaxSize>(input, options) {
                    return Ok(Property::MaxBlockSize(c));
                }
            }
            PropertyId::MaxInlineSize => {
                if let Some(c) = parse_value::<size::MaxSize>(input, options) {
                    return Ok(Property::MaxInlineSize(c));
                }
            }
            PropertyId::BoxSizing(pre) => {
                if let Some(c) = parse_value::<size::BoxSizing>(input, options) {
                    return Ok(Property::BoxSizing((c, pre)));
                }
            }
            PropertyId::AspectRatio => {
                if let Some(c) = parse_value::<size::AspectRatio>(input, options) {
                    return Ok(Property::AspectRatio(c));
                }
            }
            PropertyId::Overflow => {
                if let Some(c) = parse_value::<overflow::Overflow>(input, options) {
                    return Ok(Property::Overflow(c));
                }
            }
            PropertyId::OverflowX => {
                if let Some(c) = parse_value::<overflow::OverflowKeyword>(input, options) {
                    return Ok(Property::OverflowX(c));
                }
            }
            PropertyId::OverflowY => {
                if let Some(c) = parse_value::<overflow::OverflowKeyword>(input, options) {
                    return Ok(Property::OverflowY(c));
                }
            }
            PropertyId::TextOverflow(pre) => {
                if let Some(c) = parse_value::<overflow::TextOverflow>(input, options) {
                    return Ok(Property::TextOverflow((c, pre)));
                }
            }
            PropertyId::Position => {
                if let Some(c) = parse_value::<position::Position>(input, options) {
                    return Ok(Property::Position(c));
                }
            }
            PropertyId::Top => {
                if let Some(c) =
                    parse_value::<css::css_values::length::LengthPercentageOrAuto>(input, options)
                {
                    return Ok(Property::Top(c));
                }
            }
            PropertyId::Bottom => {
                if let Some(c) =
                    parse_value::<css::css_values::length::LengthPercentageOrAuto>(input, options)
                {
                    return Ok(Property::Bottom(c));
                }
            }
            PropertyId::Left => {
                if let Some(c) =
                    parse_value::<css::css_values::length::LengthPercentageOrAuto>(input, options)
                {
                    return Ok(Property::Left(c));
                }
            }
            PropertyId::Right => {
                if let Some(c) =
                    parse_value::<css::css_values::length::LengthPercentageOrAuto>(input, options)
                {
                    return Ok(Property::Right(c));
                }
            }
            PropertyId::InsetBlockStart => {
                if let Some(c) =
                    parse_value::<css::css_values::length::LengthPercentageOrAuto>(input, options)
                {
                    return Ok(Property::InsetBlockStart(c));
                }
            }
            PropertyId::InsetBlockEnd => {
                if let Some(c) =
                    parse_value::<css::css_values::length::LengthPercentageOrAuto>(input, options)
                {
                    return Ok(Property::InsetBlockEnd(c));
                }
            }
            PropertyId::InsetInlineStart => {
                if let Some(c) =
                    parse_value::<css::css_values::length::LengthPercentageOrAuto>(input, options)
                {
                    return Ok(Property::InsetInlineStart(c));
                }
            }
            PropertyId::InsetInlineEnd => {
                if let Some(c) =
                    parse_value::<css::css_values::length::LengthPercentageOrAuto>(input, options)
                {
                    return Ok(Property::InsetInlineEnd(c));
                }
            }
            PropertyId::InsetBlock => {
                if let Some(c) = parse_value::<margin_padding::InsetBlock>(input, options) {
                    return Ok(Property::InsetBlock(c));
                }
            }
            PropertyId::InsetInline => {
                if let Some(c) = parse_value::<margin_padding::InsetInline>(input, options) {
                    return Ok(Property::InsetInline(c));
                }
            }
            PropertyId::Inset => {
                if let Some(c) = parse_value::<margin_padding::Inset>(input, options) {
                    return Ok(Property::Inset(c));
                }
            }
            PropertyId::BorderSpacing => {
                if let Some(c) = parse_value::<
                    css::css_values::size::Size2D<css::css_values::length::Length>,
                >(input, options)
                {
                    return Ok(Property::BorderSpacing(c));
                }
            }
            PropertyId::BorderTopColor => {
                if let Some(c) = parse_value::<css::css_values::color::CssColor>(input, options) {
                    return Ok(Property::BorderTopColor(c));
                }
            }
            PropertyId::BorderBottomColor => {
                if let Some(c) = parse_value::<css::css_values::color::CssColor>(input, options) {
                    return Ok(Property::BorderBottomColor(c));
                }
            }
            PropertyId::BorderLeftColor => {
                if let Some(c) = parse_value::<css::css_values::color::CssColor>(input, options) {
                    return Ok(Property::BorderLeftColor(c));
                }
            }
            PropertyId::BorderRightColor => {
                if let Some(c) = parse_value::<css::css_values::color::CssColor>(input, options) {
                    return Ok(Property::BorderRightColor(c));
                }
            }
            PropertyId::BorderBlockStartColor => {
                if let Some(c) = parse_value::<css::css_values::color::CssColor>(input, options) {
                    return Ok(Property::BorderBlockStartColor(c));
                }
            }
            PropertyId::BorderBlockEndColor => {
                if let Some(c) = parse_value::<css::css_values::color::CssColor>(input, options) {
                    return Ok(Property::BorderBlockEndColor(c));
                }
            }
            PropertyId::BorderInlineStartColor => {
                if let Some(c) = parse_value::<css::css_values::color::CssColor>(input, options) {
                    return Ok(Property::BorderInlineStartColor(c));
                }
            }
            PropertyId::BorderInlineEndColor => {
                if let Some(c) = parse_value::<css::css_values::color::CssColor>(input, options) {
                    return Ok(Property::BorderInlineEndColor(c));
                }
            }
            PropertyId::BorderTopStyle => {
                if let Some(c) = parse_value::<border::LineStyle>(input, options) {
                    return Ok(Property::BorderTopStyle(c));
                }
            }
            PropertyId::BorderBottomStyle => {
                if let Some(c) = parse_value::<border::LineStyle>(input, options) {
                    return Ok(Property::BorderBottomStyle(c));
                }
            }
            PropertyId::BorderLeftStyle => {
                if let Some(c) = parse_value::<border::LineStyle>(input, options) {
                    return Ok(Property::BorderLeftStyle(c));
                }
            }
            PropertyId::BorderRightStyle => {
                if let Some(c) = parse_value::<border::LineStyle>(input, options) {
                    return Ok(Property::BorderRightStyle(c));
                }
            }
            PropertyId::BorderBlockStartStyle => {
                if let Some(c) = parse_value::<border::LineStyle>(input, options) {
                    return Ok(Property::BorderBlockStartStyle(c));
                }
            }
            PropertyId::BorderBlockEndStyle => {
                if let Some(c) = parse_value::<border::LineStyle>(input, options) {
                    return Ok(Property::BorderBlockEndStyle(c));
                }
            }
            PropertyId::BorderInlineStartStyle => {
                if let Some(c) = parse_value::<border::LineStyle>(input, options) {
                    return Ok(Property::BorderInlineStartStyle(c));
                }
            }
            PropertyId::BorderInlineEndStyle => {
                if let Some(c) = parse_value::<border::LineStyle>(input, options) {
                    return Ok(Property::BorderInlineEndStyle(c));
                }
            }
            PropertyId::BorderTopWidth => {
                if let Some(c) = parse_value::<border::BorderSideWidth>(input, options) {
                    return Ok(Property::BorderTopWidth(c));
                }
            }
            PropertyId::BorderBottomWidth => {
                if let Some(c) = parse_value::<border::BorderSideWidth>(input, options) {
                    return Ok(Property::BorderBottomWidth(c));
                }
            }
            PropertyId::BorderLeftWidth => {
                if let Some(c) = parse_value::<border::BorderSideWidth>(input, options) {
                    return Ok(Property::BorderLeftWidth(c));
                }
            }
            PropertyId::BorderRightWidth => {
                if let Some(c) = parse_value::<border::BorderSideWidth>(input, options) {
                    return Ok(Property::BorderRightWidth(c));
                }
            }
            PropertyId::BorderBlockStartWidth => {
                if let Some(c) = parse_value::<border::BorderSideWidth>(input, options) {
                    return Ok(Property::BorderBlockStartWidth(c));
                }
            }
            PropertyId::BorderBlockEndWidth => {
                if let Some(c) = parse_value::<border::BorderSideWidth>(input, options) {
                    return Ok(Property::BorderBlockEndWidth(c));
                }
            }
            PropertyId::BorderInlineStartWidth => {
                if let Some(c) = parse_value::<border::BorderSideWidth>(input, options) {
                    return Ok(Property::BorderInlineStartWidth(c));
                }
            }
            PropertyId::BorderInlineEndWidth => {
                if let Some(c) = parse_value::<border::BorderSideWidth>(input, options) {
                    return Ok(Property::BorderInlineEndWidth(c));
                }
            }
            PropertyId::BorderTopLeftRadius(pre) => {
                if let Some(c) = parse_value::<
                    css::css_values::size::Size2D<css::css_values::length::LengthPercentage>,
                >(input, options)
                {
                    return Ok(Property::BorderTopLeftRadius((c, pre)));
                }
            }
            PropertyId::BorderTopRightRadius(pre) => {
                if let Some(c) = parse_value::<
                    css::css_values::size::Size2D<css::css_values::length::LengthPercentage>,
                >(input, options)
                {
                    return Ok(Property::BorderTopRightRadius((c, pre)));
                }
            }
            PropertyId::BorderBottomLeftRadius(pre) => {
                if let Some(c) = parse_value::<
                    css::css_values::size::Size2D<css::css_values::length::LengthPercentage>,
                >(input, options)
                {
                    return Ok(Property::BorderBottomLeftRadius((c, pre)));
                }
            }
            PropertyId::BorderBottomRightRadius(pre) => {
                if let Some(c) = parse_value::<
                    css::css_values::size::Size2D<css::css_values::length::LengthPercentage>,
                >(input, options)
                {
                    return Ok(Property::BorderBottomRightRadius((c, pre)));
                }
            }
            PropertyId::BorderStartStartRadius => {
                if let Some(c) = parse_value::<
                    css::css_values::size::Size2D<css::css_values::length::LengthPercentage>,
                >(input, options)
                {
                    return Ok(Property::BorderStartStartRadius(c));
                }
            }
            PropertyId::BorderStartEndRadius => {
                if let Some(c) = parse_value::<
                    css::css_values::size::Size2D<css::css_values::length::LengthPercentage>,
                >(input, options)
                {
                    return Ok(Property::BorderStartEndRadius(c));
                }
            }
            PropertyId::BorderEndStartRadius => {
                if let Some(c) = parse_value::<
                    css::css_values::size::Size2D<css::css_values::length::LengthPercentage>,
                >(input, options)
                {
                    return Ok(Property::BorderEndStartRadius(c));
                }
            }
            PropertyId::BorderEndEndRadius => {
                if let Some(c) = parse_value::<
                    css::css_values::size::Size2D<css::css_values::length::LengthPercentage>,
                >(input, options)
                {
                    return Ok(Property::BorderEndEndRadius(c));
                }
            }
            PropertyId::BorderRadius(pre) => {
                if let Some(c) = parse_value::<border_radius::BorderRadius>(input, options) {
                    return Ok(Property::BorderRadius((c, pre)));
                }
            }
            PropertyId::BorderImageSource => {
                if let Some(c) = parse_value::<css::css_values::image::Image>(input, options) {
                    return Ok(Property::BorderImageSource(c));
                }
            }
            PropertyId::BorderImageOutset => {
                if let Some(c) = parse_value::<
                    css::css_values::rect::Rect<css::css_values::length::LengthOrNumber>,
                >(input, options)
                {
                    return Ok(Property::BorderImageOutset(c));
                }
            }
            PropertyId::BorderImageRepeat => {
                if let Some(c) = parse_value::<border_image::BorderImageRepeat>(input, options) {
                    return Ok(Property::BorderImageRepeat(c));
                }
            }
            PropertyId::BorderImageWidth => {
                if let Some(c) = parse_value::<
                    css::css_values::rect::Rect<border_image::BorderImageSideWidth>,
                >(input, options)
                {
                    return Ok(Property::BorderImageWidth(c));
                }
            }
            PropertyId::BorderImageSlice => {
                if let Some(c) = parse_value::<border_image::BorderImageSlice>(input, options) {
                    return Ok(Property::BorderImageSlice(c));
                }
            }
            PropertyId::BorderImage(pre) => {
                if let Some(c) = parse_value::<border_image::BorderImage>(input, options) {
                    return Ok(Property::BorderImage((c, pre)));
                }
            }
            PropertyId::BorderColor => {
                if let Some(c) = parse_value::<border::BorderColor>(input, options) {
                    return Ok(Property::BorderColor(c));
                }
            }
            PropertyId::BorderStyle => {
                if let Some(c) = parse_value::<border::BorderStyle>(input, options) {
                    return Ok(Property::BorderStyle(c));
                }
            }
            PropertyId::BorderWidth => {
                if let Some(c) = parse_value::<border::BorderWidth>(input, options) {
                    return Ok(Property::BorderWidth(c));
                }
            }
            PropertyId::BorderBlockColor => {
                if let Some(c) = parse_value::<border::BorderBlockColor>(input, options) {
                    return Ok(Property::BorderBlockColor(c));
                }
            }
            PropertyId::BorderBlockStyle => {
                if let Some(c) = parse_value::<border::BorderBlockStyle>(input, options) {
                    return Ok(Property::BorderBlockStyle(c));
                }
            }
            PropertyId::BorderBlockWidth => {
                if let Some(c) = parse_value::<border::BorderBlockWidth>(input, options) {
                    return Ok(Property::BorderBlockWidth(c));
                }
            }
            PropertyId::BorderInlineColor => {
                if let Some(c) = parse_value::<border::BorderInlineColor>(input, options) {
                    return Ok(Property::BorderInlineColor(c));
                }
            }
            PropertyId::BorderInlineStyle => {
                if let Some(c) = parse_value::<border::BorderInlineStyle>(input, options) {
                    return Ok(Property::BorderInlineStyle(c));
                }
            }
            PropertyId::BorderInlineWidth => {
                if let Some(c) = parse_value::<border::BorderInlineWidth>(input, options) {
                    return Ok(Property::BorderInlineWidth(c));
                }
            }
            PropertyId::Border => {
                if let Some(c) = parse_value::<border::Border>(input, options) {
                    return Ok(Property::Border(c));
                }
            }
            PropertyId::BorderTop => {
                if let Some(c) = parse_value::<border::BorderTop>(input, options) {
                    return Ok(Property::BorderTop(c));
                }
            }
            PropertyId::BorderBottom => {
                if let Some(c) = parse_value::<border::BorderBottom>(input, options) {
                    return Ok(Property::BorderBottom(c));
                }
            }
            PropertyId::BorderLeft => {
                if let Some(c) = parse_value::<border::BorderLeft>(input, options) {
                    return Ok(Property::BorderLeft(c));
                }
            }
            PropertyId::BorderRight => {
                if let Some(c) = parse_value::<border::BorderRight>(input, options) {
                    return Ok(Property::BorderRight(c));
                }
            }
            PropertyId::BorderBlock => {
                if let Some(c) = parse_value::<border::BorderBlock>(input, options) {
                    return Ok(Property::BorderBlock(c));
                }
            }
            PropertyId::BorderBlockStart => {
                if let Some(c) = parse_value::<border::BorderBlockStart>(input, options) {
                    return Ok(Property::BorderBlockStart(c));
                }
            }
            PropertyId::BorderBlockEnd => {
                if let Some(c) = parse_value::<border::BorderBlockEnd>(input, options) {
                    return Ok(Property::BorderBlockEnd(c));
                }
            }
            PropertyId::BorderInline => {
                if let Some(c) = parse_value::<border::BorderInline>(input, options) {
                    return Ok(Property::BorderInline(c));
                }
            }
            PropertyId::BorderInlineStart => {
                if let Some(c) = parse_value::<border::BorderInlineStart>(input, options) {
                    return Ok(Property::BorderInlineStart(c));
                }
            }
            PropertyId::BorderInlineEnd => {
                if let Some(c) = parse_value::<border::BorderInlineEnd>(input, options) {
                    return Ok(Property::BorderInlineEnd(c));
                }
            }
            PropertyId::Outline => {
                if let Some(c) = parse_value::<outline::Outline>(input, options) {
                    return Ok(Property::Outline(c));
                }
            }
            PropertyId::OutlineColor => {
                if let Some(c) = parse_value::<css::css_values::color::CssColor>(input, options) {
                    return Ok(Property::OutlineColor(c));
                }
            }
            PropertyId::OutlineStyle => {
                if let Some(c) = parse_value::<outline::OutlineStyle>(input, options) {
                    return Ok(Property::OutlineStyle(c));
                }
            }
            PropertyId::OutlineWidth => {
                if let Some(c) = parse_value::<border::BorderSideWidth>(input, options) {
                    return Ok(Property::OutlineWidth(c));
                }
            }
            PropertyId::FlexDirection(pre) => {
                if let Some(c) = parse_value::<flex::FlexDirection>(input, options) {
                    return Ok(Property::FlexDirection((c, pre)));
                }
            }
            PropertyId::FlexWrap(pre) => {
                if let Some(c) = parse_value::<flex::FlexWrap>(input, options) {
                    return Ok(Property::FlexWrap((c, pre)));
                }
            }
            PropertyId::FlexFlow(pre) => {
                if let Some(c) = parse_value::<flex::FlexFlow>(input, options) {
                    return Ok(Property::FlexFlow((c, pre)));
                }
            }
            PropertyId::FlexGrow(pre) => {
                if let Some(c) = parse_value::<css::css_values::number::CSSNumber>(input, options) {
                    return Ok(Property::FlexGrow((c, pre)));
                }
            }
            PropertyId::FlexShrink(pre) => {
                if let Some(c) = parse_value::<css::css_values::number::CSSNumber>(input, options) {
                    return Ok(Property::FlexShrink((c, pre)));
                }
            }
            PropertyId::FlexBasis(pre) => {
                if let Some(c) =
                    parse_value::<css::css_values::length::LengthPercentageOrAuto>(input, options)
                {
                    return Ok(Property::FlexBasis((c, pre)));
                }
            }
            PropertyId::Flex(pre) => {
                if let Some(c) = parse_value::<flex::Flex>(input, options) {
                    return Ok(Property::Flex((c, pre)));
                }
            }
            PropertyId::Order(pre) => {
                if let Some(c) = parse_value::<css::css_values::number::CSSInteger>(input, options)
                {
                    return Ok(Property::Order((c, pre)));
                }
            }
            PropertyId::AlignContent(pre) => {
                if let Some(c) = parse_value::<align::AlignContent>(input, options) {
                    return Ok(Property::AlignContent((c, pre)));
                }
            }
            PropertyId::JustifyContent(pre) => {
                if let Some(c) = parse_value::<align::JustifyContent>(input, options) {
                    return Ok(Property::JustifyContent((c, pre)));
                }
            }
            PropertyId::PlaceContent => {
                if let Some(c) = parse_value::<align::PlaceContent>(input, options) {
                    return Ok(Property::PlaceContent(c));
                }
            }
            PropertyId::AlignSelf(pre) => {
                if let Some(c) = parse_value::<align::AlignSelf>(input, options) {
                    return Ok(Property::AlignSelf((c, pre)));
                }
            }
            PropertyId::JustifySelf => {
                if let Some(c) = parse_value::<align::JustifySelf>(input, options) {
                    return Ok(Property::JustifySelf(c));
                }
            }
            PropertyId::PlaceSelf => {
                if let Some(c) = parse_value::<align::PlaceSelf>(input, options) {
                    return Ok(Property::PlaceSelf(c));
                }
            }
            PropertyId::AlignItems(pre) => {
                if let Some(c) = parse_value::<align::AlignItems>(input, options) {
                    return Ok(Property::AlignItems((c, pre)));
                }
            }
            PropertyId::JustifyItems => {
                if let Some(c) = parse_value::<align::JustifyItems>(input, options) {
                    return Ok(Property::JustifyItems(c));
                }
            }
            PropertyId::PlaceItems => {
                if let Some(c) = parse_value::<align::PlaceItems>(input, options) {
                    return Ok(Property::PlaceItems(c));
                }
            }
            PropertyId::RowGap => {
                if let Some(c) = parse_value::<align::GapValue>(input, options) {
                    return Ok(Property::RowGap(c));
                }
            }
            PropertyId::ColumnGap => {
                if let Some(c) = parse_value::<align::GapValue>(input, options) {
                    return Ok(Property::ColumnGap(c));
                }
            }
            PropertyId::Gap => {
                if let Some(c) = parse_value::<align::Gap>(input, options) {
                    return Ok(Property::Gap(c));
                }
            }
            PropertyId::BoxOrient(pre) => {
                if let Some(c) = parse_value::<flex::BoxOrient>(input, options) {
                    return Ok(Property::BoxOrient((c, pre)));
                }
            }
            PropertyId::BoxDirection(pre) => {
                if let Some(c) = parse_value::<flex::BoxDirection>(input, options) {
                    return Ok(Property::BoxDirection((c, pre)));
                }
            }
            PropertyId::BoxOrdinalGroup(pre) => {
                if let Some(c) = parse_value::<css::css_values::number::CSSInteger>(input, options)
                {
                    return Ok(Property::BoxOrdinalGroup((c, pre)));
                }
            }
            PropertyId::BoxAlign(pre) => {
                if let Some(c) = parse_value::<flex::BoxAlign>(input, options) {
                    return Ok(Property::BoxAlign((c, pre)));
                }
            }
            PropertyId::BoxFlex(pre) => {
                if let Some(c) = parse_value::<css::css_values::number::CSSNumber>(input, options) {
                    return Ok(Property::BoxFlex((c, pre)));
                }
            }
            PropertyId::BoxFlexGroup(pre) => {
                if let Some(c) = parse_value::<css::css_values::number::CSSInteger>(input, options)
                {
                    return Ok(Property::BoxFlexGroup((c, pre)));
                }
            }
            PropertyId::BoxPack(pre) => {
                if let Some(c) = parse_value::<flex::BoxPack>(input, options) {
                    return Ok(Property::BoxPack((c, pre)));
                }
            }
            PropertyId::BoxLines(pre) => {
                if let Some(c) = parse_value::<flex::BoxLines>(input, options) {
                    return Ok(Property::BoxLines((c, pre)));
                }
            }
            PropertyId::FlexPack(pre) => {
                if let Some(c) = parse_value::<flex::FlexPack>(input, options) {
                    return Ok(Property::FlexPack((c, pre)));
                }
            }
            PropertyId::FlexOrder(pre) => {
                if let Some(c) = parse_value::<css::css_values::number::CSSInteger>(input, options)
                {
                    return Ok(Property::FlexOrder((c, pre)));
                }
            }
            PropertyId::FlexAlign(pre) => {
                if let Some(c) = parse_value::<flex::BoxAlign>(input, options) {
                    return Ok(Property::FlexAlign((c, pre)));
                }
            }
            PropertyId::FlexItemAlign(pre) => {
                if let Some(c) = parse_value::<flex::FlexItemAlign>(input, options) {
                    return Ok(Property::FlexItemAlign((c, pre)));
                }
            }
            PropertyId::FlexLinePack(pre) => {
                if let Some(c) = parse_value::<flex::FlexLinePack>(input, options) {
                    return Ok(Property::FlexLinePack((c, pre)));
                }
            }
            PropertyId::FlexPositive(pre) => {
                if let Some(c) = parse_value::<css::css_values::number::CSSNumber>(input, options) {
                    return Ok(Property::FlexPositive((c, pre)));
                }
            }
            PropertyId::FlexNegative(pre) => {
                if let Some(c) = parse_value::<css::css_values::number::CSSNumber>(input, options) {
                    return Ok(Property::FlexNegative((c, pre)));
                }
            }
            PropertyId::FlexPreferredSize(pre) => {
                if let Some(c) =
                    parse_value::<css::css_values::length::LengthPercentageOrAuto>(input, options)
                {
                    return Ok(Property::FlexPreferredSize((c, pre)));
                }
            }
            PropertyId::MarginTop => {
                if let Some(c) =
                    parse_value::<css::css_values::length::LengthPercentageOrAuto>(input, options)
                {
                    return Ok(Property::MarginTop(c));
                }
            }
            PropertyId::MarginBottom => {
                if let Some(c) =
                    parse_value::<css::css_values::length::LengthPercentageOrAuto>(input, options)
                {
                    return Ok(Property::MarginBottom(c));
                }
            }
            PropertyId::MarginLeft => {
                if let Some(c) =
                    parse_value::<css::css_values::length::LengthPercentageOrAuto>(input, options)
                {
                    return Ok(Property::MarginLeft(c));
                }
            }
            PropertyId::MarginRight => {
                if let Some(c) =
                    parse_value::<css::css_values::length::LengthPercentageOrAuto>(input, options)
                {
                    return Ok(Property::MarginRight(c));
                }
            }
            PropertyId::MarginBlockStart => {
                if let Some(c) =
                    parse_value::<css::css_values::length::LengthPercentageOrAuto>(input, options)
                {
                    return Ok(Property::MarginBlockStart(c));
                }
            }
            PropertyId::MarginBlockEnd => {
                if let Some(c) =
                    parse_value::<css::css_values::length::LengthPercentageOrAuto>(input, options)
                {
                    return Ok(Property::MarginBlockEnd(c));
                }
            }
            PropertyId::MarginInlineStart => {
                if let Some(c) =
                    parse_value::<css::css_values::length::LengthPercentageOrAuto>(input, options)
                {
                    return Ok(Property::MarginInlineStart(c));
                }
            }
            PropertyId::MarginInlineEnd => {
                if let Some(c) =
                    parse_value::<css::css_values::length::LengthPercentageOrAuto>(input, options)
                {
                    return Ok(Property::MarginInlineEnd(c));
                }
            }
            PropertyId::MarginBlock => {
                if let Some(c) = parse_value::<margin_padding::MarginBlock>(input, options) {
                    return Ok(Property::MarginBlock(c));
                }
            }
            PropertyId::MarginInline => {
                if let Some(c) = parse_value::<margin_padding::MarginInline>(input, options) {
                    return Ok(Property::MarginInline(c));
                }
            }
            PropertyId::Margin => {
                if let Some(c) = parse_value::<margin_padding::Margin>(input, options) {
                    return Ok(Property::Margin(c));
                }
            }
            PropertyId::PaddingTop => {
                if let Some(c) =
                    parse_value::<css::css_values::length::LengthPercentageOrAuto>(input, options)
                {
                    return Ok(Property::PaddingTop(c));
                }
            }
            PropertyId::PaddingBottom => {
                if let Some(c) =
                    parse_value::<css::css_values::length::LengthPercentageOrAuto>(input, options)
                {
                    return Ok(Property::PaddingBottom(c));
                }
            }
            PropertyId::PaddingLeft => {
                if let Some(c) =
                    parse_value::<css::css_values::length::LengthPercentageOrAuto>(input, options)
                {
                    return Ok(Property::PaddingLeft(c));
                }
            }
            PropertyId::PaddingRight => {
                if let Some(c) =
                    parse_value::<css::css_values::length::LengthPercentageOrAuto>(input, options)
                {
                    return Ok(Property::PaddingRight(c));
                }
            }
            PropertyId::PaddingBlockStart => {
                if let Some(c) =
                    parse_value::<css::css_values::length::LengthPercentageOrAuto>(input, options)
                {
                    return Ok(Property::PaddingBlockStart(c));
                }
            }
            PropertyId::PaddingBlockEnd => {
                if let Some(c) =
                    parse_value::<css::css_values::length::LengthPercentageOrAuto>(input, options)
                {
                    return Ok(Property::PaddingBlockEnd(c));
                }
            }
            PropertyId::PaddingInlineStart => {
                if let Some(c) =
                    parse_value::<css::css_values::length::LengthPercentageOrAuto>(input, options)
                {
                    return Ok(Property::PaddingInlineStart(c));
                }
            }
            PropertyId::PaddingInlineEnd => {
                if let Some(c) =
                    parse_value::<css::css_values::length::LengthPercentageOrAuto>(input, options)
                {
                    return Ok(Property::PaddingInlineEnd(c));
                }
            }
            PropertyId::PaddingBlock => {
                if let Some(c) = parse_value::<margin_padding::PaddingBlock>(input, options) {
                    return Ok(Property::PaddingBlock(c));
                }
            }
            PropertyId::PaddingInline => {
                if let Some(c) = parse_value::<margin_padding::PaddingInline>(input, options) {
                    return Ok(Property::PaddingInline(c));
                }
            }
            PropertyId::Padding => {
                if let Some(c) = parse_value::<margin_padding::Padding>(input, options) {
                    return Ok(Property::Padding(c));
                }
            }
            PropertyId::ScrollMarginTop => {
                if let Some(c) =
                    parse_value::<css::css_values::length::LengthPercentageOrAuto>(input, options)
                {
                    return Ok(Property::ScrollMarginTop(c));
                }
            }
            PropertyId::ScrollMarginBottom => {
                if let Some(c) =
                    parse_value::<css::css_values::length::LengthPercentageOrAuto>(input, options)
                {
                    return Ok(Property::ScrollMarginBottom(c));
                }
            }
            PropertyId::ScrollMarginLeft => {
                if let Some(c) =
                    parse_value::<css::css_values::length::LengthPercentageOrAuto>(input, options)
                {
                    return Ok(Property::ScrollMarginLeft(c));
                }
            }
            PropertyId::ScrollMarginRight => {
                if let Some(c) =
                    parse_value::<css::css_values::length::LengthPercentageOrAuto>(input, options)
                {
                    return Ok(Property::ScrollMarginRight(c));
                }
            }
            PropertyId::ScrollMarginBlockStart => {
                if let Some(c) =
                    parse_value::<css::css_values::length::LengthPercentageOrAuto>(input, options)
                {
                    return Ok(Property::ScrollMarginBlockStart(c));
                }
            }
            PropertyId::ScrollMarginBlockEnd => {
                if let Some(c) =
                    parse_value::<css::css_values::length::LengthPercentageOrAuto>(input, options)
                {
                    return Ok(Property::ScrollMarginBlockEnd(c));
                }
            }
            PropertyId::ScrollMarginInlineStart => {
                if let Some(c) =
                    parse_value::<css::css_values::length::LengthPercentageOrAuto>(input, options)
                {
                    return Ok(Property::ScrollMarginInlineStart(c));
                }
            }
            PropertyId::ScrollMarginInlineEnd => {
                if let Some(c) =
                    parse_value::<css::css_values::length::LengthPercentageOrAuto>(input, options)
                {
                    return Ok(Property::ScrollMarginInlineEnd(c));
                }
            }
            PropertyId::ScrollMarginBlock => {
                if let Some(c) = parse_value::<margin_padding::ScrollMarginBlock>(input, options) {
                    return Ok(Property::ScrollMarginBlock(c));
                }
            }
            PropertyId::ScrollMarginInline => {
                if let Some(c) = parse_value::<margin_padding::ScrollMarginInline>(input, options) {
                    return Ok(Property::ScrollMarginInline(c));
                }
            }
            PropertyId::ScrollMargin => {
                if let Some(c) = parse_value::<margin_padding::ScrollMargin>(input, options) {
                    return Ok(Property::ScrollMargin(c));
                }
            }
            PropertyId::ScrollPaddingTop => {
                if let Some(c) =
                    parse_value::<css::css_values::length::LengthPercentageOrAuto>(input, options)
                {
                    return Ok(Property::ScrollPaddingTop(c));
                }
            }
            PropertyId::ScrollPaddingBottom => {
                if let Some(c) =
                    parse_value::<css::css_values::length::LengthPercentageOrAuto>(input, options)
                {
                    return Ok(Property::ScrollPaddingBottom(c));
                }
            }
            PropertyId::ScrollPaddingLeft => {
                if let Some(c) =
                    parse_value::<css::css_values::length::LengthPercentageOrAuto>(input, options)
                {
                    return Ok(Property::ScrollPaddingLeft(c));
                }
            }
            PropertyId::ScrollPaddingRight => {
                if let Some(c) =
                    parse_value::<css::css_values::length::LengthPercentageOrAuto>(input, options)
                {
                    return Ok(Property::ScrollPaddingRight(c));
                }
            }
            PropertyId::ScrollPaddingBlockStart => {
                if let Some(c) =
                    parse_value::<css::css_values::length::LengthPercentageOrAuto>(input, options)
                {
                    return Ok(Property::ScrollPaddingBlockStart(c));
                }
            }
            PropertyId::ScrollPaddingBlockEnd => {
                if let Some(c) =
                    parse_value::<css::css_values::length::LengthPercentageOrAuto>(input, options)
                {
                    return Ok(Property::ScrollPaddingBlockEnd(c));
                }
            }
            PropertyId::ScrollPaddingInlineStart => {
                if let Some(c) =
                    parse_value::<css::css_values::length::LengthPercentageOrAuto>(input, options)
                {
                    return Ok(Property::ScrollPaddingInlineStart(c));
                }
            }
            PropertyId::ScrollPaddingInlineEnd => {
                if let Some(c) =
                    parse_value::<css::css_values::length::LengthPercentageOrAuto>(input, options)
                {
                    return Ok(Property::ScrollPaddingInlineEnd(c));
                }
            }
            PropertyId::ScrollPaddingBlock => {
                if let Some(c) = parse_value::<margin_padding::ScrollPaddingBlock>(input, options) {
                    return Ok(Property::ScrollPaddingBlock(c));
                }
            }
            PropertyId::ScrollPaddingInline => {
                if let Some(c) = parse_value::<margin_padding::ScrollPaddingInline>(input, options)
                {
                    return Ok(Property::ScrollPaddingInline(c));
                }
            }
            PropertyId::ScrollPadding => {
                if let Some(c) = parse_value::<margin_padding::ScrollPadding>(input, options) {
                    return Ok(Property::ScrollPadding(c));
                }
            }
            PropertyId::FontWeight => {
                if let Some(c) = parse_value::<font::FontWeight>(input, options) {
                    return Ok(Property::FontWeight(c));
                }
            }
            PropertyId::FontSize => {
                if let Some(c) = parse_value::<font::FontSize>(input, options) {
                    return Ok(Property::FontSize(c));
                }
            }
            PropertyId::FontStretch => {
                if let Some(c) = parse_value::<font::FontStretch>(input, options) {
                    return Ok(Property::FontStretch(c));
                }
            }
            PropertyId::FontFamily => {
                if let Some(c) = parse_value::<Vec<font::FontFamily>>(input, options) {
                    return Ok(Property::FontFamily(c));
                }
            }
            PropertyId::FontStyle => {
                if let Some(c) = parse_value::<font::FontStyle>(input, options) {
                    return Ok(Property::FontStyle(c));
                }
            }
            PropertyId::FontVariantCaps => {
                if let Some(c) = parse_value::<font::FontVariantCaps>(input, options) {
                    return Ok(Property::FontVariantCaps(c));
                }
            }
            PropertyId::LineHeight => {
                if let Some(c) = parse_value::<font::LineHeight>(input, options) {
                    return Ok(Property::LineHeight(c));
                }
            }
            PropertyId::Font => {
                if let Some(c) = parse_value::<font::Font>(input, options) {
                    return Ok(Property::Font(c));
                }
            }
            PropertyId::TransitionProperty(pre) => {
                if let Some(c) = parse_value::<SmallList<PropertyId, 1>>(input, options) {
                    return Ok(Property::TransitionProperty((c, pre)));
                }
            }
            PropertyId::TransitionDuration(pre) => {
                if let Some(c) =
                    parse_value::<SmallList<css::css_values::time::Time, 1>>(input, options)
                {
                    return Ok(Property::TransitionDuration((c, pre)));
                }
            }
            PropertyId::TransitionDelay(pre) => {
                if let Some(c) =
                    parse_value::<SmallList<css::css_values::time::Time, 1>>(input, options)
                {
                    return Ok(Property::TransitionDelay((c, pre)));
                }
            }
            PropertyId::TransitionTimingFunction(pre) => {
                if let Some(c) = parse_value::<SmallList<css::css_values::easing::EasingFunction, 1>>(
                    input, options,
                ) {
                    return Ok(Property::TransitionTimingFunction((c, pre)));
                }
            }
            PropertyId::Transition(pre) => {
                if let Some(c) = parse_value::<SmallList<transition::Transition, 1>>(input, options)
                {
                    return Ok(Property::Transition((c, pre)));
                }
            }
            PropertyId::Animation(pre) => {
                if let Some(c) = parse_value::<SmallList<animation::Animation, 1>>(input, options) {
                    return Ok(Property::Animation((c, pre)));
                }
            }
            PropertyId::AnimationName(pre) => {
                if let Some(c) =
                    parse_value::<SmallList<animation::AnimationName, 1>>(input, options)
                {
                    return Ok(Property::AnimationName((c, pre)));
                }
            }
            PropertyId::Transform(pre) => {
                if let Some(c) = parse_value::<transform::TransformList>(input, options) {
                    return Ok(Property::Transform((c, pre)));
                }
            }
            PropertyId::TransformOrigin(pre) => {
                if let Some(c) = parse_value::<position::Position>(input, options) {
                    return Ok(Property::TransformOrigin((c, pre)));
                }
            }
            PropertyId::TransformStyle(pre) => {
                if let Some(c) = parse_value::<transform::TransformStyle>(input, options) {
                    return Ok(Property::TransformStyle((c, pre)));
                }
            }
            PropertyId::TransformBox => {
                if let Some(c) = parse_value::<transform::TransformBox>(input, options) {
                    return Ok(Property::TransformBox(c));
                }
            }
            PropertyId::BackfaceVisibility(pre) => {
                if let Some(c) = parse_value::<transform::BackfaceVisibility>(input, options) {
                    return Ok(Property::BackfaceVisibility((c, pre)));
                }
            }
            PropertyId::Perspective(pre) => {
                if let Some(c) = parse_value::<transform::Perspective>(input, options) {
                    return Ok(Property::Perspective((c, pre)));
                }
            }
            PropertyId::PerspectiveOrigin(pre) => {
                if let Some(c) = parse_value::<position::Position>(input, options) {
                    return Ok(Property::PerspectiveOrigin((c, pre)));
                }
            }
            PropertyId::Translate => {
                if let Some(c) = parse_value::<transform::Translate>(input, options) {
                    return Ok(Property::Translate(c));
                }
            }
            PropertyId::Rotate => {
                if let Some(c) = parse_value::<transform::Rotate>(input, options) {
                    return Ok(Property::Rotate(c));
                }
            }
            PropertyId::Scale => {
                if let Some(c) = parse_value::<transform::Scale>(input, options) {
                    return Ok(Property::Scale(c));
                }
            }
            PropertyId::TextDecorationColor(pre) => {
                if let Some(c) = parse_value::<css::css_values::color::CssColor>(input, options) {
                    return Ok(Property::TextDecorationColor((c, pre)));
                }
            }
            PropertyId::TextEmphasisColor(pre) => {
                if let Some(c) = parse_value::<css::css_values::color::CssColor>(input, options) {
                    return Ok(Property::TextEmphasisColor((c, pre)));
                }
            }
            PropertyId::TextShadow => {
                if let Some(c) = parse_value::<SmallList<text::TextShadow, 1>>(input, options) {
                    return Ok(Property::TextShadow(c));
                }
            }
            PropertyId::Direction => {
                if let Some(c) = parse_value::<text::Direction>(input, options) {
                    return Ok(Property::Direction(c));
                }
            }
            PropertyId::Composes => {
                return css::generic::parse_with_options::<css_modules::Composes>(input, options)
                    .map(Property::Composes);
            }
            PropertyId::MaskImage(pre) => {
                if let Some(c) =
                    parse_value::<SmallList<css::css_values::image::Image, 1>>(input, options)
                {
                    return Ok(Property::MaskImage((c, pre)));
                }
            }
            PropertyId::MaskMode => {
                if let Some(c) = parse_value::<SmallList<masking::MaskMode, 1>>(input, options) {
                    return Ok(Property::MaskMode(c));
                }
            }
            PropertyId::MaskRepeat(pre) => {
                if let Some(c) =
                    parse_value::<SmallList<background::BackgroundRepeat, 1>>(input, options)
                {
                    return Ok(Property::MaskRepeat((c, pre)));
                }
            }
            PropertyId::MaskPositionX => {
                if let Some(c) = parse_value::<
                    SmallList<css::css_values::position::HorizontalPosition, 1>,
                >(input, options)
                {
                    return Ok(Property::MaskPositionX(c));
                }
            }
            PropertyId::MaskPositionY => {
                if let Some(c) = parse_value::<
                    SmallList<css::css_values::position::VerticalPosition, 1>,
                >(input, options)
                {
                    return Ok(Property::MaskPositionY(c));
                }
            }
            PropertyId::MaskPosition(pre) => {
                if let Some(c) = parse_value::<SmallList<position::Position, 1>>(input, options) {
                    return Ok(Property::MaskPosition((c, pre)));
                }
            }
            PropertyId::MaskClip(pre) => {
                if let Some(c) = parse_value::<SmallList<masking::MaskClip, 1>>(input, options) {
                    return Ok(Property::MaskClip((c, pre)));
                }
            }
            PropertyId::MaskOrigin(pre) => {
                if let Some(c) = parse_value::<SmallList<masking::GeometryBox, 1>>(input, options) {
                    return Ok(Property::MaskOrigin((c, pre)));
                }
            }
            PropertyId::MaskSize(pre) => {
                if let Some(c) =
                    parse_value::<SmallList<background::BackgroundSize, 1>>(input, options)
                {
                    return Ok(Property::MaskSize((c, pre)));
                }
            }
            PropertyId::MaskComposite => {
                if let Some(c) = parse_value::<SmallList<masking::MaskComposite, 1>>(input, options)
                {
                    return Ok(Property::MaskComposite(c));
                }
            }
            PropertyId::MaskType => {
                if let Some(c) = parse_value::<masking::MaskType>(input, options) {
                    return Ok(Property::MaskType(c));
                }
            }
            PropertyId::Mask(pre) => {
                if let Some(c) = parse_value::<SmallList<masking::Mask, 1>>(input, options) {
                    return Ok(Property::Mask((c, pre)));
                }
            }
            PropertyId::MaskBorderSource => {
                if let Some(c) = parse_value::<css::css_values::image::Image>(input, options) {
                    return Ok(Property::MaskBorderSource(c));
                }
            }
            PropertyId::MaskBorderMode => {
                if let Some(c) = parse_value::<masking::MaskBorderMode>(input, options) {
                    return Ok(Property::MaskBorderMode(c));
                }
            }
            PropertyId::MaskBorderSlice => {
                if let Some(c) = parse_value::<border_image::BorderImageSlice>(input, options) {
                    return Ok(Property::MaskBorderSlice(c));
                }
            }
            PropertyId::MaskBorderWidth => {
                if let Some(c) = parse_value::<
                    css::css_values::rect::Rect<border_image::BorderImageSideWidth>,
                >(input, options)
                {
                    return Ok(Property::MaskBorderWidth(c));
                }
            }
            PropertyId::MaskBorderOutset => {
                if let Some(c) = parse_value::<
                    css::css_values::rect::Rect<css::css_values::length::LengthOrNumber>,
                >(input, options)
                {
                    return Ok(Property::MaskBorderOutset(c));
                }
            }
            PropertyId::MaskBorderRepeat => {
                if let Some(c) = parse_value::<border_image::BorderImageRepeat>(input, options) {
                    return Ok(Property::MaskBorderRepeat(c));
                }
            }
            PropertyId::MaskBorder => {
                if let Some(c) = parse_value::<masking::MaskBorder>(input, options) {
                    return Ok(Property::MaskBorder(c));
                }
            }
            PropertyId::WebKitMaskComposite => {
                if let Some(c) =
                    parse_value::<SmallList<masking::WebKitMaskComposite, 1>>(input, options)
                {
                    return Ok(Property::WebKitMaskComposite(c));
                }
            }
            PropertyId::MaskSourceType(pre) => {
                if let Some(c) =
                    parse_value::<SmallList<masking::WebKitMaskSourceType, 1>>(input, options)
                {
                    return Ok(Property::MaskSourceType((c, pre)));
                }
            }
            PropertyId::MaskBoxImage(pre) => {
                if let Some(c) = parse_value::<border_image::BorderImage>(input, options) {
                    return Ok(Property::MaskBoxImage((c, pre)));
                }
            }
            PropertyId::MaskBoxImageSource(pre) => {
                if let Some(c) = parse_value::<css::css_values::image::Image>(input, options) {
                    return Ok(Property::MaskBoxImageSource((c, pre)));
                }
            }
            PropertyId::MaskBoxImageSlice(pre) => {
                if let Some(c) = parse_value::<border_image::BorderImageSlice>(input, options) {
                    return Ok(Property::MaskBoxImageSlice((c, pre)));
                }
            }
            PropertyId::MaskBoxImageWidth(pre) => {
                if let Some(c) = parse_value::<
                    css::css_values::rect::Rect<border_image::BorderImageSideWidth>,
                >(input, options)
                {
                    return Ok(Property::MaskBoxImageWidth((c, pre)));
                }
            }
            PropertyId::MaskBoxImageOutset(pre) => {
                if let Some(c) = parse_value::<
                    css::css_values::rect::Rect<css::css_values::length::LengthOrNumber>,
                >(input, options)
                {
                    return Ok(Property::MaskBoxImageOutset((c, pre)));
                }
            }
            PropertyId::MaskBoxImageRepeat(pre) => {
                if let Some(c) = parse_value::<border_image::BorderImageRepeat>(input, options) {
                    return Ok(Property::MaskBoxImageRepeat((c, pre)));
                }
            }
            PropertyId::ColorScheme => {
                if let Some(c) = parse_value::<ui::ColorScheme>(input, options) {
                    return Ok(Property::ColorScheme(c));
                }
            }
            PropertyId::ViewTransitionName => {
                if let Some(c) = parse_value::<transition::ViewTransitionName>(input, options) {
                    return Ok(Property::ViewTransitionName(c));
                }
            }
            PropertyId::ViewTransitionClass => {
                if let Some(c) =
                    parse_value::<css::css_values::ident::NoneOrCustomIdentList>(input, options)
                {
                    return Ok(Property::ViewTransitionClass(c));
                }
            }
            PropertyId::ViewTransitionGroup => {
                if let Some(c) = parse_value::<transition::ViewTransitionGroup>(input, options) {
                    return Ok(Property::ViewTransitionGroup(c));
                }
            }
            PropertyId::All => return CSSWideKeyword::parse(input).map(Property::All),
            PropertyId::Custom(name) => {
                return CustomProperty::parse(name, input, options).map(Property::Custom);
            }
            PropertyId::Unparsed => {}
        }

        // If a value was unable to be parsed, treat as an unparsed property.
        // This is different from a custom property, handled above, in that the property name is known
        // and stored as an enum rather than a string. This lets property handlers more easily deal with it.
        // Ideally we'd only do this if var() or env() references were seen, but err on the safe side for now.
        input.reset(&state);
        UnparsedProperty::parse(property_id, input, options).map(Property::Unparsed)
    }

    pub fn to_css(&self, dest: &mut css::Printer, important: bool) -> Result<(), css::PrintErr> {
        properties_impl::property_mixin::to_css(self, dest, important)
    }

    pub(crate) fn deep_clone(&self, arena: &bun_alloc::Arena) -> Property {
        match self {
            Property::BackgroundColor(v) => {
                Property::BackgroundColor(css::generic::deep_clone(v, arena))
            }
            Property::BackgroundImage(v) => {
                Property::BackgroundImage(css::generic::deep_clone(v, arena))
            }
            Property::BackgroundPositionX(v) => {
                Property::BackgroundPositionX(css::generic::deep_clone(v, arena))
            }
            Property::BackgroundPositionY(v) => {
                Property::BackgroundPositionY(css::generic::deep_clone(v, arena))
            }
            Property::BackgroundPosition(v) => {
                Property::BackgroundPosition(css::generic::deep_clone(v, arena))
            }
            Property::BackgroundSize(v) => {
                Property::BackgroundSize(css::generic::deep_clone(v, arena))
            }
            Property::BackgroundRepeat(v) => {
                Property::BackgroundRepeat(css::generic::deep_clone(v, arena))
            }
            Property::BackgroundAttachment(v) => {
                Property::BackgroundAttachment(css::generic::deep_clone(v, arena))
            }
            Property::BackgroundClip(v) => {
                Property::BackgroundClip((css::generic::deep_clone(&v.0, arena), v.1))
            }
            Property::BackgroundOrigin(v) => {
                Property::BackgroundOrigin(css::generic::deep_clone(v, arena))
            }
            Property::Background(v) => Property::Background(css::generic::deep_clone(v, arena)),
            Property::BoxShadow(v) => {
                Property::BoxShadow((css::generic::deep_clone(&v.0, arena), v.1))
            }
            Property::Opacity(v) => Property::Opacity(css::generic::deep_clone(v, arena)),
            Property::Color(v) => Property::Color(css::generic::deep_clone(v, arena)),
            Property::Display(v) => Property::Display(css::generic::deep_clone(v, arena)),
            Property::Visibility(v) => Property::Visibility(css::generic::deep_clone(v, arena)),
            Property::Width(v) => Property::Width(css::generic::deep_clone(v, arena)),
            Property::Height(v) => Property::Height(css::generic::deep_clone(v, arena)),
            Property::MinWidth(v) => Property::MinWidth(css::generic::deep_clone(v, arena)),
            Property::MinHeight(v) => Property::MinHeight(css::generic::deep_clone(v, arena)),
            Property::MaxWidth(v) => Property::MaxWidth(css::generic::deep_clone(v, arena)),
            Property::MaxHeight(v) => Property::MaxHeight(css::generic::deep_clone(v, arena)),
            Property::BlockSize(v) => Property::BlockSize(css::generic::deep_clone(v, arena)),
            Property::InlineSize(v) => Property::InlineSize(css::generic::deep_clone(v, arena)),
            Property::MinBlockSize(v) => Property::MinBlockSize(css::generic::deep_clone(v, arena)),
            Property::MinInlineSize(v) => {
                Property::MinInlineSize(css::generic::deep_clone(v, arena))
            }
            Property::MaxBlockSize(v) => Property::MaxBlockSize(css::generic::deep_clone(v, arena)),
            Property::MaxInlineSize(v) => {
                Property::MaxInlineSize(css::generic::deep_clone(v, arena))
            }
            Property::BoxSizing(v) => {
                Property::BoxSizing((css::generic::deep_clone(&v.0, arena), v.1))
            }
            Property::AspectRatio(v) => Property::AspectRatio(css::generic::deep_clone(v, arena)),
            Property::Overflow(v) => Property::Overflow(css::generic::deep_clone(v, arena)),
            Property::OverflowX(v) => Property::OverflowX(css::generic::deep_clone(v, arena)),
            Property::OverflowY(v) => Property::OverflowY(css::generic::deep_clone(v, arena)),
            Property::TextOverflow(v) => {
                Property::TextOverflow((css::generic::deep_clone(&v.0, arena), v.1))
            }
            Property::Position(v) => Property::Position(css::generic::deep_clone(v, arena)),
            Property::Top(v) => Property::Top(css::generic::deep_clone(v, arena)),
            Property::Bottom(v) => Property::Bottom(css::generic::deep_clone(v, arena)),
            Property::Left(v) => Property::Left(css::generic::deep_clone(v, arena)),
            Property::Right(v) => Property::Right(css::generic::deep_clone(v, arena)),
            Property::InsetBlockStart(v) => {
                Property::InsetBlockStart(css::generic::deep_clone(v, arena))
            }
            Property::InsetBlockEnd(v) => {
                Property::InsetBlockEnd(css::generic::deep_clone(v, arena))
            }
            Property::InsetInlineStart(v) => {
                Property::InsetInlineStart(css::generic::deep_clone(v, arena))
            }
            Property::InsetInlineEnd(v) => {
                Property::InsetInlineEnd(css::generic::deep_clone(v, arena))
            }
            Property::InsetBlock(v) => Property::InsetBlock(css::generic::deep_clone(v, arena)),
            Property::InsetInline(v) => Property::InsetInline(css::generic::deep_clone(v, arena)),
            Property::Inset(v) => Property::Inset(css::generic::deep_clone(v, arena)),
            Property::BorderSpacing(v) => {
                Property::BorderSpacing(css::generic::deep_clone(v, arena))
            }
            Property::BorderTopColor(v) => {
                Property::BorderTopColor(css::generic::deep_clone(v, arena))
            }
            Property::BorderBottomColor(v) => {
                Property::BorderBottomColor(css::generic::deep_clone(v, arena))
            }
            Property::BorderLeftColor(v) => {
                Property::BorderLeftColor(css::generic::deep_clone(v, arena))
            }
            Property::BorderRightColor(v) => {
                Property::BorderRightColor(css::generic::deep_clone(v, arena))
            }
            Property::BorderBlockStartColor(v) => {
                Property::BorderBlockStartColor(css::generic::deep_clone(v, arena))
            }
            Property::BorderBlockEndColor(v) => {
                Property::BorderBlockEndColor(css::generic::deep_clone(v, arena))
            }
            Property::BorderInlineStartColor(v) => {
                Property::BorderInlineStartColor(css::generic::deep_clone(v, arena))
            }
            Property::BorderInlineEndColor(v) => {
                Property::BorderInlineEndColor(css::generic::deep_clone(v, arena))
            }
            Property::BorderTopStyle(v) => {
                Property::BorderTopStyle(css::generic::deep_clone(v, arena))
            }
            Property::BorderBottomStyle(v) => {
                Property::BorderBottomStyle(css::generic::deep_clone(v, arena))
            }
            Property::BorderLeftStyle(v) => {
                Property::BorderLeftStyle(css::generic::deep_clone(v, arena))
            }
            Property::BorderRightStyle(v) => {
                Property::BorderRightStyle(css::generic::deep_clone(v, arena))
            }
            Property::BorderBlockStartStyle(v) => {
                Property::BorderBlockStartStyle(css::generic::deep_clone(v, arena))
            }
            Property::BorderBlockEndStyle(v) => {
                Property::BorderBlockEndStyle(css::generic::deep_clone(v, arena))
            }
            Property::BorderInlineStartStyle(v) => {
                Property::BorderInlineStartStyle(css::generic::deep_clone(v, arena))
            }
            Property::BorderInlineEndStyle(v) => {
                Property::BorderInlineEndStyle(css::generic::deep_clone(v, arena))
            }
            Property::BorderTopWidth(v) => {
                Property::BorderTopWidth(css::generic::deep_clone(v, arena))
            }
            Property::BorderBottomWidth(v) => {
                Property::BorderBottomWidth(css::generic::deep_clone(v, arena))
            }
            Property::BorderLeftWidth(v) => {
                Property::BorderLeftWidth(css::generic::deep_clone(v, arena))
            }
            Property::BorderRightWidth(v) => {
                Property::BorderRightWidth(css::generic::deep_clone(v, arena))
            }
            Property::BorderBlockStartWidth(v) => {
                Property::BorderBlockStartWidth(css::generic::deep_clone(v, arena))
            }
            Property::BorderBlockEndWidth(v) => {
                Property::BorderBlockEndWidth(css::generic::deep_clone(v, arena))
            }
            Property::BorderInlineStartWidth(v) => {
                Property::BorderInlineStartWidth(css::generic::deep_clone(v, arena))
            }
            Property::BorderInlineEndWidth(v) => {
                Property::BorderInlineEndWidth(css::generic::deep_clone(v, arena))
            }
            Property::BorderTopLeftRadius(v) => {
                Property::BorderTopLeftRadius((css::generic::deep_clone(&v.0, arena), v.1))
            }
            Property::BorderTopRightRadius(v) => {
                Property::BorderTopRightRadius((css::generic::deep_clone(&v.0, arena), v.1))
            }
            Property::BorderBottomLeftRadius(v) => {
                Property::BorderBottomLeftRadius((css::generic::deep_clone(&v.0, arena), v.1))
            }
            Property::BorderBottomRightRadius(v) => {
                Property::BorderBottomRightRadius((css::generic::deep_clone(&v.0, arena), v.1))
            }
            Property::BorderStartStartRadius(v) => {
                Property::BorderStartStartRadius(css::generic::deep_clone(v, arena))
            }
            Property::BorderStartEndRadius(v) => {
                Property::BorderStartEndRadius(css::generic::deep_clone(v, arena))
            }
            Property::BorderEndStartRadius(v) => {
                Property::BorderEndStartRadius(css::generic::deep_clone(v, arena))
            }
            Property::BorderEndEndRadius(v) => {
                Property::BorderEndEndRadius(css::generic::deep_clone(v, arena))
            }
            Property::BorderRadius(v) => {
                Property::BorderRadius((css::generic::deep_clone(&v.0, arena), v.1))
            }
            Property::BorderImageSource(v) => {
                Property::BorderImageSource(css::generic::deep_clone(v, arena))
            }
            Property::BorderImageOutset(v) => {
                Property::BorderImageOutset(css::generic::deep_clone(v, arena))
            }
            Property::BorderImageRepeat(v) => {
                Property::BorderImageRepeat(css::generic::deep_clone(v, arena))
            }
            Property::BorderImageWidth(v) => {
                Property::BorderImageWidth(css::generic::deep_clone(v, arena))
            }
            Property::BorderImageSlice(v) => {
                Property::BorderImageSlice(css::generic::deep_clone(v, arena))
            }
            Property::BorderImage(v) => {
                Property::BorderImage((css::generic::deep_clone(&v.0, arena), v.1))
            }
            Property::BorderColor(v) => Property::BorderColor(css::generic::deep_clone(v, arena)),
            Property::BorderStyle(v) => Property::BorderStyle(css::generic::deep_clone(v, arena)),
            Property::BorderWidth(v) => Property::BorderWidth(css::generic::deep_clone(v, arena)),
            Property::BorderBlockColor(v) => {
                Property::BorderBlockColor(css::generic::deep_clone(v, arena))
            }
            Property::BorderBlockStyle(v) => {
                Property::BorderBlockStyle(css::generic::deep_clone(v, arena))
            }
            Property::BorderBlockWidth(v) => {
                Property::BorderBlockWidth(css::generic::deep_clone(v, arena))
            }
            Property::BorderInlineColor(v) => {
                Property::BorderInlineColor(css::generic::deep_clone(v, arena))
            }
            Property::BorderInlineStyle(v) => {
                Property::BorderInlineStyle(css::generic::deep_clone(v, arena))
            }
            Property::BorderInlineWidth(v) => {
                Property::BorderInlineWidth(css::generic::deep_clone(v, arena))
            }
            Property::Border(v) => Property::Border(css::generic::deep_clone(v, arena)),
            Property::BorderTop(v) => Property::BorderTop(css::generic::deep_clone(v, arena)),
            Property::BorderBottom(v) => Property::BorderBottom(css::generic::deep_clone(v, arena)),
            Property::BorderLeft(v) => Property::BorderLeft(css::generic::deep_clone(v, arena)),
            Property::BorderRight(v) => Property::BorderRight(css::generic::deep_clone(v, arena)),
            Property::BorderBlock(v) => Property::BorderBlock(css::generic::deep_clone(v, arena)),
            Property::BorderBlockStart(v) => {
                Property::BorderBlockStart(css::generic::deep_clone(v, arena))
            }
            Property::BorderBlockEnd(v) => {
                Property::BorderBlockEnd(css::generic::deep_clone(v, arena))
            }
            Property::BorderInline(v) => Property::BorderInline(css::generic::deep_clone(v, arena)),
            Property::BorderInlineStart(v) => {
                Property::BorderInlineStart(css::generic::deep_clone(v, arena))
            }
            Property::BorderInlineEnd(v) => {
                Property::BorderInlineEnd(css::generic::deep_clone(v, arena))
            }
            Property::Outline(v) => Property::Outline(css::generic::deep_clone(v, arena)),
            Property::OutlineColor(v) => Property::OutlineColor(css::generic::deep_clone(v, arena)),
            Property::OutlineStyle(v) => Property::OutlineStyle(css::generic::deep_clone(v, arena)),
            Property::OutlineWidth(v) => Property::OutlineWidth(css::generic::deep_clone(v, arena)),
            Property::FlexDirection(v) => {
                Property::FlexDirection((css::generic::deep_clone(&v.0, arena), v.1))
            }
            Property::FlexWrap(v) => {
                Property::FlexWrap((css::generic::deep_clone(&v.0, arena), v.1))
            }
            Property::FlexFlow(v) => {
                Property::FlexFlow((css::generic::deep_clone(&v.0, arena), v.1))
            }
            Property::FlexGrow(v) => {
                Property::FlexGrow((css::generic::deep_clone(&v.0, arena), v.1))
            }
            Property::FlexShrink(v) => {
                Property::FlexShrink((css::generic::deep_clone(&v.0, arena), v.1))
            }
            Property::FlexBasis(v) => {
                Property::FlexBasis((css::generic::deep_clone(&v.0, arena), v.1))
            }
            Property::Flex(v) => Property::Flex((css::generic::deep_clone(&v.0, arena), v.1)),
            Property::Order(v) => Property::Order((css::generic::deep_clone(&v.0, arena), v.1)),
            Property::AlignContent(v) => {
                Property::AlignContent((css::generic::deep_clone(&v.0, arena), v.1))
            }
            Property::JustifyContent(v) => {
                Property::JustifyContent((css::generic::deep_clone(&v.0, arena), v.1))
            }
            Property::PlaceContent(v) => Property::PlaceContent(css::generic::deep_clone(v, arena)),
            Property::AlignSelf(v) => {
                Property::AlignSelf((css::generic::deep_clone(&v.0, arena), v.1))
            }
            Property::JustifySelf(v) => Property::JustifySelf(css::generic::deep_clone(v, arena)),
            Property::PlaceSelf(v) => Property::PlaceSelf(css::generic::deep_clone(v, arena)),
            Property::AlignItems(v) => {
                Property::AlignItems((css::generic::deep_clone(&v.0, arena), v.1))
            }
            Property::JustifyItems(v) => Property::JustifyItems(css::generic::deep_clone(v, arena)),
            Property::PlaceItems(v) => Property::PlaceItems(css::generic::deep_clone(v, arena)),
            Property::RowGap(v) => Property::RowGap(css::generic::deep_clone(v, arena)),
            Property::ColumnGap(v) => Property::ColumnGap(css::generic::deep_clone(v, arena)),
            Property::Gap(v) => Property::Gap(css::generic::deep_clone(v, arena)),
            Property::BoxOrient(v) => {
                Property::BoxOrient((css::generic::deep_clone(&v.0, arena), v.1))
            }
            Property::BoxDirection(v) => {
                Property::BoxDirection((css::generic::deep_clone(&v.0, arena), v.1))
            }
            Property::BoxOrdinalGroup(v) => {
                Property::BoxOrdinalGroup((css::generic::deep_clone(&v.0, arena), v.1))
            }
            Property::BoxAlign(v) => {
                Property::BoxAlign((css::generic::deep_clone(&v.0, arena), v.1))
            }
            Property::BoxFlex(v) => Property::BoxFlex((css::generic::deep_clone(&v.0, arena), v.1)),
            Property::BoxFlexGroup(v) => {
                Property::BoxFlexGroup((css::generic::deep_clone(&v.0, arena), v.1))
            }
            Property::BoxPack(v) => Property::BoxPack((css::generic::deep_clone(&v.0, arena), v.1)),
            Property::BoxLines(v) => {
                Property::BoxLines((css::generic::deep_clone(&v.0, arena), v.1))
            }
            Property::FlexPack(v) => {
                Property::FlexPack((css::generic::deep_clone(&v.0, arena), v.1))
            }
            Property::FlexOrder(v) => {
                Property::FlexOrder((css::generic::deep_clone(&v.0, arena), v.1))
            }
            Property::FlexAlign(v) => {
                Property::FlexAlign((css::generic::deep_clone(&v.0, arena), v.1))
            }
            Property::FlexItemAlign(v) => {
                Property::FlexItemAlign((css::generic::deep_clone(&v.0, arena), v.1))
            }
            Property::FlexLinePack(v) => {
                Property::FlexLinePack((css::generic::deep_clone(&v.0, arena), v.1))
            }
            Property::FlexPositive(v) => {
                Property::FlexPositive((css::generic::deep_clone(&v.0, arena), v.1))
            }
            Property::FlexNegative(v) => {
                Property::FlexNegative((css::generic::deep_clone(&v.0, arena), v.1))
            }
            Property::FlexPreferredSize(v) => {
                Property::FlexPreferredSize((css::generic::deep_clone(&v.0, arena), v.1))
            }
            Property::MarginTop(v) => Property::MarginTop(css::generic::deep_clone(v, arena)),
            Property::MarginBottom(v) => Property::MarginBottom(css::generic::deep_clone(v, arena)),
            Property::MarginLeft(v) => Property::MarginLeft(css::generic::deep_clone(v, arena)),
            Property::MarginRight(v) => Property::MarginRight(css::generic::deep_clone(v, arena)),
            Property::MarginBlockStart(v) => {
                Property::MarginBlockStart(css::generic::deep_clone(v, arena))
            }
            Property::MarginBlockEnd(v) => {
                Property::MarginBlockEnd(css::generic::deep_clone(v, arena))
            }
            Property::MarginInlineStart(v) => {
                Property::MarginInlineStart(css::generic::deep_clone(v, arena))
            }
            Property::MarginInlineEnd(v) => {
                Property::MarginInlineEnd(css::generic::deep_clone(v, arena))
            }
            Property::MarginBlock(v) => Property::MarginBlock(css::generic::deep_clone(v, arena)),
            Property::MarginInline(v) => Property::MarginInline(css::generic::deep_clone(v, arena)),
            Property::Margin(v) => Property::Margin(css::generic::deep_clone(v, arena)),
            Property::PaddingTop(v) => Property::PaddingTop(css::generic::deep_clone(v, arena)),
            Property::PaddingBottom(v) => {
                Property::PaddingBottom(css::generic::deep_clone(v, arena))
            }
            Property::PaddingLeft(v) => Property::PaddingLeft(css::generic::deep_clone(v, arena)),
            Property::PaddingRight(v) => Property::PaddingRight(css::generic::deep_clone(v, arena)),
            Property::PaddingBlockStart(v) => {
                Property::PaddingBlockStart(css::generic::deep_clone(v, arena))
            }
            Property::PaddingBlockEnd(v) => {
                Property::PaddingBlockEnd(css::generic::deep_clone(v, arena))
            }
            Property::PaddingInlineStart(v) => {
                Property::PaddingInlineStart(css::generic::deep_clone(v, arena))
            }
            Property::PaddingInlineEnd(v) => {
                Property::PaddingInlineEnd(css::generic::deep_clone(v, arena))
            }
            Property::PaddingBlock(v) => Property::PaddingBlock(css::generic::deep_clone(v, arena)),
            Property::PaddingInline(v) => {
                Property::PaddingInline(css::generic::deep_clone(v, arena))
            }
            Property::Padding(v) => Property::Padding(css::generic::deep_clone(v, arena)),
            Property::ScrollMarginTop(v) => {
                Property::ScrollMarginTop(css::generic::deep_clone(v, arena))
            }
            Property::ScrollMarginBottom(v) => {
                Property::ScrollMarginBottom(css::generic::deep_clone(v, arena))
            }
            Property::ScrollMarginLeft(v) => {
                Property::ScrollMarginLeft(css::generic::deep_clone(v, arena))
            }
            Property::ScrollMarginRight(v) => {
                Property::ScrollMarginRight(css::generic::deep_clone(v, arena))
            }
            Property::ScrollMarginBlockStart(v) => {
                Property::ScrollMarginBlockStart(css::generic::deep_clone(v, arena))
            }
            Property::ScrollMarginBlockEnd(v) => {
                Property::ScrollMarginBlockEnd(css::generic::deep_clone(v, arena))
            }
            Property::ScrollMarginInlineStart(v) => {
                Property::ScrollMarginInlineStart(css::generic::deep_clone(v, arena))
            }
            Property::ScrollMarginInlineEnd(v) => {
                Property::ScrollMarginInlineEnd(css::generic::deep_clone(v, arena))
            }
            Property::ScrollMarginBlock(v) => {
                Property::ScrollMarginBlock(css::generic::deep_clone(v, arena))
            }
            Property::ScrollMarginInline(v) => {
                Property::ScrollMarginInline(css::generic::deep_clone(v, arena))
            }
            Property::ScrollMargin(v) => Property::ScrollMargin(css::generic::deep_clone(v, arena)),
            Property::ScrollPaddingTop(v) => {
                Property::ScrollPaddingTop(css::generic::deep_clone(v, arena))
            }
            Property::ScrollPaddingBottom(v) => {
                Property::ScrollPaddingBottom(css::generic::deep_clone(v, arena))
            }
            Property::ScrollPaddingLeft(v) => {
                Property::ScrollPaddingLeft(css::generic::deep_clone(v, arena))
            }
            Property::ScrollPaddingRight(v) => {
                Property::ScrollPaddingRight(css::generic::deep_clone(v, arena))
            }
            Property::ScrollPaddingBlockStart(v) => {
                Property::ScrollPaddingBlockStart(css::generic::deep_clone(v, arena))
            }
            Property::ScrollPaddingBlockEnd(v) => {
                Property::ScrollPaddingBlockEnd(css::generic::deep_clone(v, arena))
            }
            Property::ScrollPaddingInlineStart(v) => {
                Property::ScrollPaddingInlineStart(css::generic::deep_clone(v, arena))
            }
            Property::ScrollPaddingInlineEnd(v) => {
                Property::ScrollPaddingInlineEnd(css::generic::deep_clone(v, arena))
            }
            Property::ScrollPaddingBlock(v) => {
                Property::ScrollPaddingBlock(css::generic::deep_clone(v, arena))
            }
            Property::ScrollPaddingInline(v) => {
                Property::ScrollPaddingInline(css::generic::deep_clone(v, arena))
            }
            Property::ScrollPadding(v) => {
                Property::ScrollPadding(css::generic::deep_clone(v, arena))
            }
            Property::FontWeight(v) => Property::FontWeight(css::generic::deep_clone(v, arena)),
            Property::FontSize(v) => Property::FontSize(css::generic::deep_clone(v, arena)),
            Property::FontStretch(v) => Property::FontStretch(css::generic::deep_clone(v, arena)),
            Property::FontFamily(v) => Property::FontFamily(css::generic::deep_clone(v, arena)),
            Property::FontStyle(v) => Property::FontStyle(css::generic::deep_clone(v, arena)),
            Property::FontVariantCaps(v) => {
                Property::FontVariantCaps(css::generic::deep_clone(v, arena))
            }
            Property::LineHeight(v) => Property::LineHeight(css::generic::deep_clone(v, arena)),
            Property::Font(v) => Property::Font(css::generic::deep_clone(v, arena)),
            Property::TransitionProperty(v) => {
                Property::TransitionProperty((css::generic::deep_clone(&v.0, arena), v.1))
            }
            Property::TransitionDuration(v) => {
                Property::TransitionDuration((css::generic::deep_clone(&v.0, arena), v.1))
            }
            Property::TransitionDelay(v) => {
                Property::TransitionDelay((css::generic::deep_clone(&v.0, arena), v.1))
            }
            Property::TransitionTimingFunction(v) => {
                Property::TransitionTimingFunction((css::generic::deep_clone(&v.0, arena), v.1))
            }
            Property::Transition(v) => {
                Property::Transition((css::generic::deep_clone(&v.0, arena), v.1))
            }
            Property::Animation(v) => {
                Property::Animation((css::generic::deep_clone(&v.0, arena), v.1))
            }
            Property::AnimationName(v) => {
                Property::AnimationName((css::generic::deep_clone(&v.0, arena), v.1))
            }
            Property::Transform(v) => {
                Property::Transform((css::generic::deep_clone(&v.0, arena), v.1))
            }
            Property::TransformOrigin(v) => {
                Property::TransformOrigin((css::generic::deep_clone(&v.0, arena), v.1))
            }
            Property::TransformStyle(v) => {
                Property::TransformStyle((css::generic::deep_clone(&v.0, arena), v.1))
            }
            Property::TransformBox(v) => Property::TransformBox(css::generic::deep_clone(v, arena)),
            Property::BackfaceVisibility(v) => {
                Property::BackfaceVisibility((css::generic::deep_clone(&v.0, arena), v.1))
            }
            Property::Perspective(v) => {
                Property::Perspective((css::generic::deep_clone(&v.0, arena), v.1))
            }
            Property::PerspectiveOrigin(v) => {
                Property::PerspectiveOrigin((css::generic::deep_clone(&v.0, arena), v.1))
            }
            Property::Translate(v) => Property::Translate(css::generic::deep_clone(v, arena)),
            Property::Rotate(v) => Property::Rotate(css::generic::deep_clone(v, arena)),
            Property::Scale(v) => Property::Scale(css::generic::deep_clone(v, arena)),
            Property::TextDecorationColor(v) => {
                Property::TextDecorationColor((css::generic::deep_clone(&v.0, arena), v.1))
            }
            Property::TextEmphasisColor(v) => {
                Property::TextEmphasisColor((css::generic::deep_clone(&v.0, arena), v.1))
            }
            Property::TextShadow(v) => Property::TextShadow(css::generic::deep_clone(v, arena)),
            Property::Direction(v) => Property::Direction(css::generic::deep_clone(v, arena)),
            Property::Composes(v) => Property::Composes(css::generic::deep_clone(v, arena)),
            Property::MaskImage(v) => {
                Property::MaskImage((css::generic::deep_clone(&v.0, arena), v.1))
            }
            Property::MaskMode(v) => Property::MaskMode(css::generic::deep_clone(v, arena)),
            Property::MaskRepeat(v) => {
                Property::MaskRepeat((css::generic::deep_clone(&v.0, arena), v.1))
            }
            Property::MaskPositionX(v) => {
                Property::MaskPositionX(css::generic::deep_clone(v, arena))
            }
            Property::MaskPositionY(v) => {
                Property::MaskPositionY(css::generic::deep_clone(v, arena))
            }
            Property::MaskPosition(v) => {
                Property::MaskPosition((css::generic::deep_clone(&v.0, arena), v.1))
            }
            Property::MaskClip(v) => {
                Property::MaskClip((css::generic::deep_clone(&v.0, arena), v.1))
            }
            Property::MaskOrigin(v) => {
                Property::MaskOrigin((css::generic::deep_clone(&v.0, arena), v.1))
            }
            Property::MaskSize(v) => {
                Property::MaskSize((css::generic::deep_clone(&v.0, arena), v.1))
            }
            Property::MaskComposite(v) => {
                Property::MaskComposite(css::generic::deep_clone(v, arena))
            }
            Property::MaskType(v) => Property::MaskType(css::generic::deep_clone(v, arena)),
            Property::Mask(v) => Property::Mask((css::generic::deep_clone(&v.0, arena), v.1)),
            Property::MaskBorderSource(v) => {
                Property::MaskBorderSource(css::generic::deep_clone(v, arena))
            }
            Property::MaskBorderMode(v) => {
                Property::MaskBorderMode(css::generic::deep_clone(v, arena))
            }
            Property::MaskBorderSlice(v) => {
                Property::MaskBorderSlice(css::generic::deep_clone(v, arena))
            }
            Property::MaskBorderWidth(v) => {
                Property::MaskBorderWidth(css::generic::deep_clone(v, arena))
            }
            Property::MaskBorderOutset(v) => {
                Property::MaskBorderOutset(css::generic::deep_clone(v, arena))
            }
            Property::MaskBorderRepeat(v) => {
                Property::MaskBorderRepeat(css::generic::deep_clone(v, arena))
            }
            Property::MaskBorder(v) => Property::MaskBorder(css::generic::deep_clone(v, arena)),
            Property::WebKitMaskComposite(v) => {
                Property::WebKitMaskComposite(css::generic::deep_clone(v, arena))
            }
            Property::MaskSourceType(v) => {
                Property::MaskSourceType((css::generic::deep_clone(&v.0, arena), v.1))
            }
            Property::MaskBoxImage(v) => {
                Property::MaskBoxImage((css::generic::deep_clone(&v.0, arena), v.1))
            }
            Property::MaskBoxImageSource(v) => {
                Property::MaskBoxImageSource((css::generic::deep_clone(&v.0, arena), v.1))
            }
            Property::MaskBoxImageSlice(v) => {
                Property::MaskBoxImageSlice((css::generic::deep_clone(&v.0, arena), v.1))
            }
            Property::MaskBoxImageWidth(v) => {
                Property::MaskBoxImageWidth((css::generic::deep_clone(&v.0, arena), v.1))
            }
            Property::MaskBoxImageOutset(v) => {
                Property::MaskBoxImageOutset((css::generic::deep_clone(&v.0, arena), v.1))
            }
            Property::MaskBoxImageRepeat(v) => {
                Property::MaskBoxImageRepeat((css::generic::deep_clone(&v.0, arena), v.1))
            }
            Property::ColorScheme(v) => Property::ColorScheme(css::generic::deep_clone(v, arena)),
            Property::ViewTransitionName(v) => {
                Property::ViewTransitionName(css::generic::deep_clone(v, arena))
            }
            Property::ViewTransitionClass(v) => {
                Property::ViewTransitionClass(css::generic::deep_clone(v, arena))
            }
            Property::ViewTransitionGroup(v) => {
                Property::ViewTransitionGroup(css::generic::deep_clone(v, arena))
            }
            Property::All(a) => Property::All(*a),
            Property::Unparsed(u) => Property::Unparsed(u.deep_clone(arena)),
            Property::Custom(c) => Property::Custom(c.deep_clone(arena)),
        }
    }

    pub fn eql(&self, other: &Property) -> bool {
        match (self, other) {
            (Property::BackgroundColor(a), Property::BackgroundColor(b)) => css::generic::eql(a, b),
            (Property::BackgroundImage(a), Property::BackgroundImage(b)) => css::generic::eql(a, b),
            (Property::BackgroundPositionX(a), Property::BackgroundPositionX(b)) => {
                css::generic::eql(a, b)
            }
            (Property::BackgroundPositionY(a), Property::BackgroundPositionY(b)) => {
                css::generic::eql(a, b)
            }
            (Property::BackgroundPosition(a), Property::BackgroundPosition(b)) => {
                css::generic::eql(a, b)
            }
            (Property::BackgroundSize(a), Property::BackgroundSize(b)) => css::generic::eql(a, b),
            (Property::BackgroundRepeat(a), Property::BackgroundRepeat(b)) => {
                css::generic::eql(a, b)
            }
            (Property::BackgroundAttachment(a), Property::BackgroundAttachment(b)) => {
                css::generic::eql(a, b)
            }
            (Property::BackgroundClip(a), Property::BackgroundClip(b)) => {
                css::generic::eql(&a.0, &b.0) && a.1 == b.1
            }
            (Property::BackgroundOrigin(a), Property::BackgroundOrigin(b)) => {
                css::generic::eql(a, b)
            }
            (Property::Background(a), Property::Background(b)) => css::generic::eql(a, b),
            (Property::BoxShadow(a), Property::BoxShadow(b)) => {
                css::generic::eql(&a.0, &b.0) && a.1 == b.1
            }
            (Property::Opacity(a), Property::Opacity(b)) => css::generic::eql(a, b),
            (Property::Color(a), Property::Color(b)) => css::generic::eql(a, b),
            (Property::Display(a), Property::Display(b)) => css::generic::eql(a, b),
            (Property::Visibility(a), Property::Visibility(b)) => css::generic::eql(a, b),
            (Property::Width(a), Property::Width(b)) => css::generic::eql(a, b),
            (Property::Height(a), Property::Height(b)) => css::generic::eql(a, b),
            (Property::MinWidth(a), Property::MinWidth(b)) => css::generic::eql(a, b),
            (Property::MinHeight(a), Property::MinHeight(b)) => css::generic::eql(a, b),
            (Property::MaxWidth(a), Property::MaxWidth(b)) => css::generic::eql(a, b),
            (Property::MaxHeight(a), Property::MaxHeight(b)) => css::generic::eql(a, b),
            (Property::BlockSize(a), Property::BlockSize(b)) => css::generic::eql(a, b),
            (Property::InlineSize(a), Property::InlineSize(b)) => css::generic::eql(a, b),
            (Property::MinBlockSize(a), Property::MinBlockSize(b)) => css::generic::eql(a, b),
            (Property::MinInlineSize(a), Property::MinInlineSize(b)) => css::generic::eql(a, b),
            (Property::MaxBlockSize(a), Property::MaxBlockSize(b)) => css::generic::eql(a, b),
            (Property::MaxInlineSize(a), Property::MaxInlineSize(b)) => css::generic::eql(a, b),
            (Property::BoxSizing(a), Property::BoxSizing(b)) => {
                css::generic::eql(&a.0, &b.0) && a.1 == b.1
            }
            (Property::AspectRatio(a), Property::AspectRatio(b)) => css::generic::eql(a, b),
            (Property::Overflow(a), Property::Overflow(b)) => css::generic::eql(a, b),
            (Property::OverflowX(a), Property::OverflowX(b)) => css::generic::eql(a, b),
            (Property::OverflowY(a), Property::OverflowY(b)) => css::generic::eql(a, b),
            (Property::TextOverflow(a), Property::TextOverflow(b)) => {
                css::generic::eql(&a.0, &b.0) && a.1 == b.1
            }
            (Property::Position(a), Property::Position(b)) => css::generic::eql(a, b),
            (Property::Top(a), Property::Top(b)) => css::generic::eql(a, b),
            (Property::Bottom(a), Property::Bottom(b)) => css::generic::eql(a, b),
            (Property::Left(a), Property::Left(b)) => css::generic::eql(a, b),
            (Property::Right(a), Property::Right(b)) => css::generic::eql(a, b),
            (Property::InsetBlockStart(a), Property::InsetBlockStart(b)) => css::generic::eql(a, b),
            (Property::InsetBlockEnd(a), Property::InsetBlockEnd(b)) => css::generic::eql(a, b),
            (Property::InsetInlineStart(a), Property::InsetInlineStart(b)) => {
                css::generic::eql(a, b)
            }
            (Property::InsetInlineEnd(a), Property::InsetInlineEnd(b)) => css::generic::eql(a, b),
            (Property::InsetBlock(a), Property::InsetBlock(b)) => css::generic::eql(a, b),
            (Property::InsetInline(a), Property::InsetInline(b)) => css::generic::eql(a, b),
            (Property::Inset(a), Property::Inset(b)) => css::generic::eql(a, b),
            (Property::BorderSpacing(a), Property::BorderSpacing(b)) => css::generic::eql(a, b),
            (Property::BorderTopColor(a), Property::BorderTopColor(b)) => css::generic::eql(a, b),
            (Property::BorderBottomColor(a), Property::BorderBottomColor(b)) => {
                css::generic::eql(a, b)
            }
            (Property::BorderLeftColor(a), Property::BorderLeftColor(b)) => css::generic::eql(a, b),
            (Property::BorderRightColor(a), Property::BorderRightColor(b)) => {
                css::generic::eql(a, b)
            }
            (Property::BorderBlockStartColor(a), Property::BorderBlockStartColor(b)) => {
                css::generic::eql(a, b)
            }
            (Property::BorderBlockEndColor(a), Property::BorderBlockEndColor(b)) => {
                css::generic::eql(a, b)
            }
            (Property::BorderInlineStartColor(a), Property::BorderInlineStartColor(b)) => {
                css::generic::eql(a, b)
            }
            (Property::BorderInlineEndColor(a), Property::BorderInlineEndColor(b)) => {
                css::generic::eql(a, b)
            }
            (Property::BorderTopStyle(a), Property::BorderTopStyle(b)) => css::generic::eql(a, b),
            (Property::BorderBottomStyle(a), Property::BorderBottomStyle(b)) => {
                css::generic::eql(a, b)
            }
            (Property::BorderLeftStyle(a), Property::BorderLeftStyle(b)) => css::generic::eql(a, b),
            (Property::BorderRightStyle(a), Property::BorderRightStyle(b)) => {
                css::generic::eql(a, b)
            }
            (Property::BorderBlockStartStyle(a), Property::BorderBlockStartStyle(b)) => {
                css::generic::eql(a, b)
            }
            (Property::BorderBlockEndStyle(a), Property::BorderBlockEndStyle(b)) => {
                css::generic::eql(a, b)
            }
            (Property::BorderInlineStartStyle(a), Property::BorderInlineStartStyle(b)) => {
                css::generic::eql(a, b)
            }
            (Property::BorderInlineEndStyle(a), Property::BorderInlineEndStyle(b)) => {
                css::generic::eql(a, b)
            }
            (Property::BorderTopWidth(a), Property::BorderTopWidth(b)) => css::generic::eql(a, b),
            (Property::BorderBottomWidth(a), Property::BorderBottomWidth(b)) => {
                css::generic::eql(a, b)
            }
            (Property::BorderLeftWidth(a), Property::BorderLeftWidth(b)) => css::generic::eql(a, b),
            (Property::BorderRightWidth(a), Property::BorderRightWidth(b)) => {
                css::generic::eql(a, b)
            }
            (Property::BorderBlockStartWidth(a), Property::BorderBlockStartWidth(b)) => {
                css::generic::eql(a, b)
            }
            (Property::BorderBlockEndWidth(a), Property::BorderBlockEndWidth(b)) => {
                css::generic::eql(a, b)
            }
            (Property::BorderInlineStartWidth(a), Property::BorderInlineStartWidth(b)) => {
                css::generic::eql(a, b)
            }
            (Property::BorderInlineEndWidth(a), Property::BorderInlineEndWidth(b)) => {
                css::generic::eql(a, b)
            }
            (Property::BorderTopLeftRadius(a), Property::BorderTopLeftRadius(b)) => {
                css::generic::eql(&a.0, &b.0) && a.1 == b.1
            }
            (Property::BorderTopRightRadius(a), Property::BorderTopRightRadius(b)) => {
                css::generic::eql(&a.0, &b.0) && a.1 == b.1
            }
            (Property::BorderBottomLeftRadius(a), Property::BorderBottomLeftRadius(b)) => {
                css::generic::eql(&a.0, &b.0) && a.1 == b.1
            }
            (Property::BorderBottomRightRadius(a), Property::BorderBottomRightRadius(b)) => {
                css::generic::eql(&a.0, &b.0) && a.1 == b.1
            }
            (Property::BorderStartStartRadius(a), Property::BorderStartStartRadius(b)) => {
                css::generic::eql(a, b)
            }
            (Property::BorderStartEndRadius(a), Property::BorderStartEndRadius(b)) => {
                css::generic::eql(a, b)
            }
            (Property::BorderEndStartRadius(a), Property::BorderEndStartRadius(b)) => {
                css::generic::eql(a, b)
            }
            (Property::BorderEndEndRadius(a), Property::BorderEndEndRadius(b)) => {
                css::generic::eql(a, b)
            }
            (Property::BorderRadius(a), Property::BorderRadius(b)) => {
                css::generic::eql(&a.0, &b.0) && a.1 == b.1
            }
            (Property::BorderImageSource(a), Property::BorderImageSource(b)) => {
                css::generic::eql(a, b)
            }
            (Property::BorderImageOutset(a), Property::BorderImageOutset(b)) => {
                css::generic::eql(a, b)
            }
            (Property::BorderImageRepeat(a), Property::BorderImageRepeat(b)) => {
                css::generic::eql(a, b)
            }
            (Property::BorderImageWidth(a), Property::BorderImageWidth(b)) => {
                css::generic::eql(a, b)
            }
            (Property::BorderImageSlice(a), Property::BorderImageSlice(b)) => {
                css::generic::eql(a, b)
            }
            (Property::BorderImage(a), Property::BorderImage(b)) => {
                css::generic::eql(&a.0, &b.0) && a.1 == b.1
            }
            (Property::BorderColor(a), Property::BorderColor(b)) => css::generic::eql(a, b),
            (Property::BorderStyle(a), Property::BorderStyle(b)) => css::generic::eql(a, b),
            (Property::BorderWidth(a), Property::BorderWidth(b)) => css::generic::eql(a, b),
            (Property::BorderBlockColor(a), Property::BorderBlockColor(b)) => {
                css::generic::eql(a, b)
            }
            (Property::BorderBlockStyle(a), Property::BorderBlockStyle(b)) => {
                css::generic::eql(a, b)
            }
            (Property::BorderBlockWidth(a), Property::BorderBlockWidth(b)) => {
                css::generic::eql(a, b)
            }
            (Property::BorderInlineColor(a), Property::BorderInlineColor(b)) => {
                css::generic::eql(a, b)
            }
            (Property::BorderInlineStyle(a), Property::BorderInlineStyle(b)) => {
                css::generic::eql(a, b)
            }
            (Property::BorderInlineWidth(a), Property::BorderInlineWidth(b)) => {
                css::generic::eql(a, b)
            }
            (Property::Border(a), Property::Border(b)) => css::generic::eql(a, b),
            (Property::BorderTop(a), Property::BorderTop(b)) => css::generic::eql(a, b),
            (Property::BorderBottom(a), Property::BorderBottom(b)) => css::generic::eql(a, b),
            (Property::BorderLeft(a), Property::BorderLeft(b)) => css::generic::eql(a, b),
            (Property::BorderRight(a), Property::BorderRight(b)) => css::generic::eql(a, b),
            (Property::BorderBlock(a), Property::BorderBlock(b)) => css::generic::eql(a, b),
            (Property::BorderBlockStart(a), Property::BorderBlockStart(b)) => {
                css::generic::eql(a, b)
            }
            (Property::BorderBlockEnd(a), Property::BorderBlockEnd(b)) => css::generic::eql(a, b),
            (Property::BorderInline(a), Property::BorderInline(b)) => css::generic::eql(a, b),
            (Property::BorderInlineStart(a), Property::BorderInlineStart(b)) => {
                css::generic::eql(a, b)
            }
            (Property::BorderInlineEnd(a), Property::BorderInlineEnd(b)) => css::generic::eql(a, b),
            (Property::Outline(a), Property::Outline(b)) => css::generic::eql(a, b),
            (Property::OutlineColor(a), Property::OutlineColor(b)) => css::generic::eql(a, b),
            (Property::OutlineStyle(a), Property::OutlineStyle(b)) => css::generic::eql(a, b),
            (Property::OutlineWidth(a), Property::OutlineWidth(b)) => css::generic::eql(a, b),
            (Property::FlexDirection(a), Property::FlexDirection(b)) => {
                css::generic::eql(&a.0, &b.0) && a.1 == b.1
            }
            (Property::FlexWrap(a), Property::FlexWrap(b)) => {
                css::generic::eql(&a.0, &b.0) && a.1 == b.1
            }
            (Property::FlexFlow(a), Property::FlexFlow(b)) => {
                css::generic::eql(&a.0, &b.0) && a.1 == b.1
            }
            (Property::FlexGrow(a), Property::FlexGrow(b)) => {
                css::generic::eql(&a.0, &b.0) && a.1 == b.1
            }
            (Property::FlexShrink(a), Property::FlexShrink(b)) => {
                css::generic::eql(&a.0, &b.0) && a.1 == b.1
            }
            (Property::FlexBasis(a), Property::FlexBasis(b)) => {
                css::generic::eql(&a.0, &b.0) && a.1 == b.1
            }
            (Property::Flex(a), Property::Flex(b)) => css::generic::eql(&a.0, &b.0) && a.1 == b.1,
            (Property::Order(a), Property::Order(b)) => css::generic::eql(&a.0, &b.0) && a.1 == b.1,
            (Property::AlignContent(a), Property::AlignContent(b)) => {
                css::generic::eql(&a.0, &b.0) && a.1 == b.1
            }
            (Property::JustifyContent(a), Property::JustifyContent(b)) => {
                css::generic::eql(&a.0, &b.0) && a.1 == b.1
            }
            (Property::PlaceContent(a), Property::PlaceContent(b)) => css::generic::eql(a, b),
            (Property::AlignSelf(a), Property::AlignSelf(b)) => {
                css::generic::eql(&a.0, &b.0) && a.1 == b.1
            }
            (Property::JustifySelf(a), Property::JustifySelf(b)) => css::generic::eql(a, b),
            (Property::PlaceSelf(a), Property::PlaceSelf(b)) => css::generic::eql(a, b),
            (Property::AlignItems(a), Property::AlignItems(b)) => {
                css::generic::eql(&a.0, &b.0) && a.1 == b.1
            }
            (Property::JustifyItems(a), Property::JustifyItems(b)) => css::generic::eql(a, b),
            (Property::PlaceItems(a), Property::PlaceItems(b)) => css::generic::eql(a, b),
            (Property::RowGap(a), Property::RowGap(b)) => css::generic::eql(a, b),
            (Property::ColumnGap(a), Property::ColumnGap(b)) => css::generic::eql(a, b),
            (Property::Gap(a), Property::Gap(b)) => css::generic::eql(a, b),
            (Property::BoxOrient(a), Property::BoxOrient(b)) => {
                css::generic::eql(&a.0, &b.0) && a.1 == b.1
            }
            (Property::BoxDirection(a), Property::BoxDirection(b)) => {
                css::generic::eql(&a.0, &b.0) && a.1 == b.1
            }
            (Property::BoxOrdinalGroup(a), Property::BoxOrdinalGroup(b)) => {
                css::generic::eql(&a.0, &b.0) && a.1 == b.1
            }
            (Property::BoxAlign(a), Property::BoxAlign(b)) => {
                css::generic::eql(&a.0, &b.0) && a.1 == b.1
            }
            (Property::BoxFlex(a), Property::BoxFlex(b)) => {
                css::generic::eql(&a.0, &b.0) && a.1 == b.1
            }
            (Property::BoxFlexGroup(a), Property::BoxFlexGroup(b)) => {
                css::generic::eql(&a.0, &b.0) && a.1 == b.1
            }
            (Property::BoxPack(a), Property::BoxPack(b)) => {
                css::generic::eql(&a.0, &b.0) && a.1 == b.1
            }
            (Property::BoxLines(a), Property::BoxLines(b)) => {
                css::generic::eql(&a.0, &b.0) && a.1 == b.1
            }
            (Property::FlexPack(a), Property::FlexPack(b)) => {
                css::generic::eql(&a.0, &b.0) && a.1 == b.1
            }
            (Property::FlexOrder(a), Property::FlexOrder(b)) => {
                css::generic::eql(&a.0, &b.0) && a.1 == b.1
            }
            (Property::FlexAlign(a), Property::FlexAlign(b)) => {
                css::generic::eql(&a.0, &b.0) && a.1 == b.1
            }
            (Property::FlexItemAlign(a), Property::FlexItemAlign(b)) => {
                css::generic::eql(&a.0, &b.0) && a.1 == b.1
            }
            (Property::FlexLinePack(a), Property::FlexLinePack(b)) => {
                css::generic::eql(&a.0, &b.0) && a.1 == b.1
            }
            (Property::FlexPositive(a), Property::FlexPositive(b)) => {
                css::generic::eql(&a.0, &b.0) && a.1 == b.1
            }
            (Property::FlexNegative(a), Property::FlexNegative(b)) => {
                css::generic::eql(&a.0, &b.0) && a.1 == b.1
            }
            (Property::FlexPreferredSize(a), Property::FlexPreferredSize(b)) => {
                css::generic::eql(&a.0, &b.0) && a.1 == b.1
            }
            (Property::MarginTop(a), Property::MarginTop(b)) => css::generic::eql(a, b),
            (Property::MarginBottom(a), Property::MarginBottom(b)) => css::generic::eql(a, b),
            (Property::MarginLeft(a), Property::MarginLeft(b)) => css::generic::eql(a, b),
            (Property::MarginRight(a), Property::MarginRight(b)) => css::generic::eql(a, b),
            (Property::MarginBlockStart(a), Property::MarginBlockStart(b)) => {
                css::generic::eql(a, b)
            }
            (Property::MarginBlockEnd(a), Property::MarginBlockEnd(b)) => css::generic::eql(a, b),
            (Property::MarginInlineStart(a), Property::MarginInlineStart(b)) => {
                css::generic::eql(a, b)
            }
            (Property::MarginInlineEnd(a), Property::MarginInlineEnd(b)) => css::generic::eql(a, b),
            (Property::MarginBlock(a), Property::MarginBlock(b)) => css::generic::eql(a, b),
            (Property::MarginInline(a), Property::MarginInline(b)) => css::generic::eql(a, b),
            (Property::Margin(a), Property::Margin(b)) => css::generic::eql(a, b),
            (Property::PaddingTop(a), Property::PaddingTop(b)) => css::generic::eql(a, b),
            (Property::PaddingBottom(a), Property::PaddingBottom(b)) => css::generic::eql(a, b),
            (Property::PaddingLeft(a), Property::PaddingLeft(b)) => css::generic::eql(a, b),
            (Property::PaddingRight(a), Property::PaddingRight(b)) => css::generic::eql(a, b),
            (Property::PaddingBlockStart(a), Property::PaddingBlockStart(b)) => {
                css::generic::eql(a, b)
            }
            (Property::PaddingBlockEnd(a), Property::PaddingBlockEnd(b)) => css::generic::eql(a, b),
            (Property::PaddingInlineStart(a), Property::PaddingInlineStart(b)) => {
                css::generic::eql(a, b)
            }
            (Property::PaddingInlineEnd(a), Property::PaddingInlineEnd(b)) => {
                css::generic::eql(a, b)
            }
            (Property::PaddingBlock(a), Property::PaddingBlock(b)) => css::generic::eql(a, b),
            (Property::PaddingInline(a), Property::PaddingInline(b)) => css::generic::eql(a, b),
            (Property::Padding(a), Property::Padding(b)) => css::generic::eql(a, b),
            (Property::ScrollMarginTop(a), Property::ScrollMarginTop(b)) => css::generic::eql(a, b),
            (Property::ScrollMarginBottom(a), Property::ScrollMarginBottom(b)) => {
                css::generic::eql(a, b)
            }
            (Property::ScrollMarginLeft(a), Property::ScrollMarginLeft(b)) => {
                css::generic::eql(a, b)
            }
            (Property::ScrollMarginRight(a), Property::ScrollMarginRight(b)) => {
                css::generic::eql(a, b)
            }
            (Property::ScrollMarginBlockStart(a), Property::ScrollMarginBlockStart(b)) => {
                css::generic::eql(a, b)
            }
            (Property::ScrollMarginBlockEnd(a), Property::ScrollMarginBlockEnd(b)) => {
                css::generic::eql(a, b)
            }
            (Property::ScrollMarginInlineStart(a), Property::ScrollMarginInlineStart(b)) => {
                css::generic::eql(a, b)
            }
            (Property::ScrollMarginInlineEnd(a), Property::ScrollMarginInlineEnd(b)) => {
                css::generic::eql(a, b)
            }
            (Property::ScrollMarginBlock(a), Property::ScrollMarginBlock(b)) => {
                css::generic::eql(a, b)
            }
            (Property::ScrollMarginInline(a), Property::ScrollMarginInline(b)) => {
                css::generic::eql(a, b)
            }
            (Property::ScrollMargin(a), Property::ScrollMargin(b)) => css::generic::eql(a, b),
            (Property::ScrollPaddingTop(a), Property::ScrollPaddingTop(b)) => {
                css::generic::eql(a, b)
            }
            (Property::ScrollPaddingBottom(a), Property::ScrollPaddingBottom(b)) => {
                css::generic::eql(a, b)
            }
            (Property::ScrollPaddingLeft(a), Property::ScrollPaddingLeft(b)) => {
                css::generic::eql(a, b)
            }
            (Property::ScrollPaddingRight(a), Property::ScrollPaddingRight(b)) => {
                css::generic::eql(a, b)
            }
            (Property::ScrollPaddingBlockStart(a), Property::ScrollPaddingBlockStart(b)) => {
                css::generic::eql(a, b)
            }
            (Property::ScrollPaddingBlockEnd(a), Property::ScrollPaddingBlockEnd(b)) => {
                css::generic::eql(a, b)
            }
            (Property::ScrollPaddingInlineStart(a), Property::ScrollPaddingInlineStart(b)) => {
                css::generic::eql(a, b)
            }
            (Property::ScrollPaddingInlineEnd(a), Property::ScrollPaddingInlineEnd(b)) => {
                css::generic::eql(a, b)
            }
            (Property::ScrollPaddingBlock(a), Property::ScrollPaddingBlock(b)) => {
                css::generic::eql(a, b)
            }
            (Property::ScrollPaddingInline(a), Property::ScrollPaddingInline(b)) => {
                css::generic::eql(a, b)
            }
            (Property::ScrollPadding(a), Property::ScrollPadding(b)) => css::generic::eql(a, b),
            (Property::FontWeight(a), Property::FontWeight(b)) => css::generic::eql(a, b),
            (Property::FontSize(a), Property::FontSize(b)) => css::generic::eql(a, b),
            (Property::FontStretch(a), Property::FontStretch(b)) => css::generic::eql(a, b),
            (Property::FontFamily(a), Property::FontFamily(b)) => css::generic::eql(a, b),
            (Property::FontStyle(a), Property::FontStyle(b)) => css::generic::eql(a, b),
            (Property::FontVariantCaps(a), Property::FontVariantCaps(b)) => css::generic::eql(a, b),
            (Property::LineHeight(a), Property::LineHeight(b)) => css::generic::eql(a, b),
            (Property::Font(a), Property::Font(b)) => css::generic::eql(a, b),
            (Property::TransitionProperty(a), Property::TransitionProperty(b)) => {
                css::generic::eql(&a.0, &b.0) && a.1 == b.1
            }
            (Property::TransitionDuration(a), Property::TransitionDuration(b)) => {
                css::generic::eql(&a.0, &b.0) && a.1 == b.1
            }
            (Property::TransitionDelay(a), Property::TransitionDelay(b)) => {
                css::generic::eql(&a.0, &b.0) && a.1 == b.1
            }
            (Property::TransitionTimingFunction(a), Property::TransitionTimingFunction(b)) => {
                css::generic::eql(&a.0, &b.0) && a.1 == b.1
            }
            (Property::Transition(a), Property::Transition(b)) => {
                css::generic::eql(&a.0, &b.0) && a.1 == b.1
            }
            (Property::Animation(a), Property::Animation(b)) => {
                css::generic::eql(&a.0, &b.0) && a.1 == b.1
            }
            (Property::AnimationName(a), Property::AnimationName(b)) => {
                css::generic::eql(&a.0, &b.0) && a.1 == b.1
            }
            (Property::Transform(a), Property::Transform(b)) => {
                css::generic::eql(&a.0, &b.0) && a.1 == b.1
            }
            (Property::TransformOrigin(a), Property::TransformOrigin(b)) => {
                css::generic::eql(&a.0, &b.0) && a.1 == b.1
            }
            (Property::TransformStyle(a), Property::TransformStyle(b)) => {
                css::generic::eql(&a.0, &b.0) && a.1 == b.1
            }
            (Property::TransformBox(a), Property::TransformBox(b)) => css::generic::eql(a, b),
            (Property::BackfaceVisibility(a), Property::BackfaceVisibility(b)) => {
                css::generic::eql(&a.0, &b.0) && a.1 == b.1
            }
            (Property::Perspective(a), Property::Perspective(b)) => {
                css::generic::eql(&a.0, &b.0) && a.1 == b.1
            }
            (Property::PerspectiveOrigin(a), Property::PerspectiveOrigin(b)) => {
                css::generic::eql(&a.0, &b.0) && a.1 == b.1
            }
            (Property::Translate(a), Property::Translate(b)) => css::generic::eql(a, b),
            (Property::Rotate(a), Property::Rotate(b)) => css::generic::eql(a, b),
            (Property::Scale(a), Property::Scale(b)) => css::generic::eql(a, b),
            (Property::TextDecorationColor(a), Property::TextDecorationColor(b)) => {
                css::generic::eql(&a.0, &b.0) && a.1 == b.1
            }
            (Property::TextEmphasisColor(a), Property::TextEmphasisColor(b)) => {
                css::generic::eql(&a.0, &b.0) && a.1 == b.1
            }
            (Property::TextShadow(a), Property::TextShadow(b)) => css::generic::eql(a, b),
            (Property::Direction(a), Property::Direction(b)) => css::generic::eql(a, b),
            (Property::Composes(a), Property::Composes(b)) => css::generic::eql(a, b),
            (Property::MaskImage(a), Property::MaskImage(b)) => {
                css::generic::eql(&a.0, &b.0) && a.1 == b.1
            }
            (Property::MaskMode(a), Property::MaskMode(b)) => css::generic::eql(a, b),
            (Property::MaskRepeat(a), Property::MaskRepeat(b)) => {
                css::generic::eql(&a.0, &b.0) && a.1 == b.1
            }
            (Property::MaskPositionX(a), Property::MaskPositionX(b)) => css::generic::eql(a, b),
            (Property::MaskPositionY(a), Property::MaskPositionY(b)) => css::generic::eql(a, b),
            (Property::MaskPosition(a), Property::MaskPosition(b)) => {
                css::generic::eql(&a.0, &b.0) && a.1 == b.1
            }
            (Property::MaskClip(a), Property::MaskClip(b)) => {
                css::generic::eql(&a.0, &b.0) && a.1 == b.1
            }
            (Property::MaskOrigin(a), Property::MaskOrigin(b)) => {
                css::generic::eql(&a.0, &b.0) && a.1 == b.1
            }
            (Property::MaskSize(a), Property::MaskSize(b)) => {
                css::generic::eql(&a.0, &b.0) && a.1 == b.1
            }
            (Property::MaskComposite(a), Property::MaskComposite(b)) => css::generic::eql(a, b),
            (Property::MaskType(a), Property::MaskType(b)) => css::generic::eql(a, b),
            (Property::Mask(a), Property::Mask(b)) => css::generic::eql(&a.0, &b.0) && a.1 == b.1,
            (Property::MaskBorderSource(a), Property::MaskBorderSource(b)) => {
                css::generic::eql(a, b)
            }
            (Property::MaskBorderMode(a), Property::MaskBorderMode(b)) => css::generic::eql(a, b),
            (Property::MaskBorderSlice(a), Property::MaskBorderSlice(b)) => css::generic::eql(a, b),
            (Property::MaskBorderWidth(a), Property::MaskBorderWidth(b)) => css::generic::eql(a, b),
            (Property::MaskBorderOutset(a), Property::MaskBorderOutset(b)) => {
                css::generic::eql(a, b)
            }
            (Property::MaskBorderRepeat(a), Property::MaskBorderRepeat(b)) => {
                css::generic::eql(a, b)
            }
            (Property::MaskBorder(a), Property::MaskBorder(b)) => css::generic::eql(a, b),
            (Property::WebKitMaskComposite(a), Property::WebKitMaskComposite(b)) => {
                css::generic::eql(a, b)
            }
            (Property::MaskSourceType(a), Property::MaskSourceType(b)) => {
                css::generic::eql(&a.0, &b.0) && a.1 == b.1
            }
            (Property::MaskBoxImage(a), Property::MaskBoxImage(b)) => {
                css::generic::eql(&a.0, &b.0) && a.1 == b.1
            }
            (Property::MaskBoxImageSource(a), Property::MaskBoxImageSource(b)) => {
                css::generic::eql(&a.0, &b.0) && a.1 == b.1
            }
            (Property::MaskBoxImageSlice(a), Property::MaskBoxImageSlice(b)) => {
                css::generic::eql(&a.0, &b.0) && a.1 == b.1
            }
            (Property::MaskBoxImageWidth(a), Property::MaskBoxImageWidth(b)) => {
                css::generic::eql(&a.0, &b.0) && a.1 == b.1
            }
            (Property::MaskBoxImageOutset(a), Property::MaskBoxImageOutset(b)) => {
                css::generic::eql(&a.0, &b.0) && a.1 == b.1
            }
            (Property::MaskBoxImageRepeat(a), Property::MaskBoxImageRepeat(b)) => {
                css::generic::eql(&a.0, &b.0) && a.1 == b.1
            }
            (Property::ColorScheme(a), Property::ColorScheme(b)) => css::generic::eql(a, b),
            (Property::ViewTransitionName(a), Property::ViewTransitionName(b)) => {
                css::generic::eql(a, b)
            }
            (Property::ViewTransitionClass(a), Property::ViewTransitionClass(b)) => {
                css::generic::eql(a, b)
            }
            (Property::ViewTransitionGroup(a), Property::ViewTransitionGroup(b)) => {
                css::generic::eql(a, b)
            }
            (Property::All(_), Property::All(_)) => true,
            (Property::Unparsed(a), Property::Unparsed(b)) => a.eql(b),
            (Property::Custom(a), Property::Custom(b)) => a.eql(b),
            _ => false,
        }
    }
}

// `declaration::placeholder_property()` (the moved-out slot
// sentinel in `DeclarationBlock::minify`) is
// `Property::All(CSSWideKeyword::RevertLayer)`.
impl Default for Property {
    #[inline]
    fn default() -> Self {
        Property::All(CSSWideKeyword::RevertLayer)
    }
}
