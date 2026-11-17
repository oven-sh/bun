use crate as css;
use crate::css_values::alpha::AlphaValue;
use crate::css_values::color::CssColor;
use crate::css_values::easing::EasingFunction;
use crate::css_values::ident::{NoneOrCustomIdentList, is_reserved_custom_ident};
use crate::css_values::image::Image;
use crate::css_values::length::{Length, LengthOrNumber, LengthPercentage, LengthPercentageOrAuto};
use crate::css_values::number::{CSSInteger, CSSNumber};
use crate::css_values::position::{HorizontalPosition, VerticalPosition};
use crate::css_values::rect::Rect;
use crate::css_values::size::Size2D;
use crate::css_values::time::Time;
use crate::prefixes::Feature as PrefixFeature;
use crate::targets::Targets;
use crate::{PrintErr, Printer, SmallList, VendorPrefix};

use super::custom::{CustomProperty, CustomPropertyName, UnparsedProperty};
use super::{
    CSSWideKeyword, align, animation, background, border, border_image, border_radius, box_shadow,
    css_modules, display, flex, font, margin_padding, masking, outline, overflow, position, size,
    text, transform, transition, ui,
};

/// The first block for a row that has the optional part in brackets, the second for one without.
macro_rules! if_row_has {
    ([] { $($yes:tt)* } else { $($no:tt)* }) => { $($no)* };
    ([$($part:tt)+] { $($yes:tt)* } else { $($no:tt)* }) => { $($yes)* };
}

macro_rules! prefix_feature {
    ($Variant:ident) => {
        Some(PrefixFeature::$Variant)
    };
    ($Variant:ident legacy) => {
        None
    };
}

/// A row is `"name": Variant(Value[, VendorPrefix: PREFIX | PREFIX[, legacy]]) [with parser],`.
macro_rules! define_properties {
    ($(
        $name:literal: $Variant:ident(
            $Value:ty $(, $Prefix:ty: $($allowed:ident)|+ $(, $legacy:ident)?)?
        ) $(with $parse:ident)?,
    )+) => {
        /// Discriminant-only tag for [`Property`] / [`PropertyId`].
        #[repr(u16)]
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, strum::VariantArray)]
        pub enum PropertyIdTag {
            $($Variant,)+
            All,
            Unparsed,
            Custom,
        }

        /// A property name and, if it can have one, the vendor prefix it is written with.
        #[derive(Debug, Clone, Copy)]
        pub enum PropertyId<'bump> {
            $($Variant $(($Prefix))?,)+
            All,
            /// Never built: it lines the discriminants up with the tags, so `tag()` is arithmetic.
            Unparsed,
            Custom(CustomPropertyName<'bump>),
        }

        /// A parsed declaration value. A prefixed property carries `(value, VendorPrefix)`.
        pub enum Property<'bump> {
            $($Variant(if_row_has!([$($Prefix)?] { ($Value, VendorPrefix) } else { $Value })),)+
            All(CSSWideKeyword),
            Unparsed(UnparsedProperty<'bump>),
            Custom(CustomProperty<'bump>),
        }

        impl PropertyIdTag {
            /// The caniuse entry for the prefixes that targets need. A `legacy` name has none.
            const fn prefix_feature(self) -> Option<PrefixFeature> {
                match self {
                    $($(PropertyIdTag::$Variant => prefix_feature!($Variant $($legacy)?),)?)+
                    _ => None,
                }
            }

            pub const fn name(self) -> &'static [u8] {
                match self {
                    $(PropertyIdTag::$Variant => $name,)+
                    PropertyIdTag::All => "all",
                    PropertyIdTag::Unparsed => "unparsed",
                    PropertyIdTag::Custom => "custom",
                }
                .as_bytes()
            }
        }

        impl<'bump> PropertyId<'bump> {
            pub(crate) const fn tag(&self) -> PropertyIdTag {
                match self {
                    $(PropertyId::$Variant { .. } => PropertyIdTag::$Variant,)+
                    PropertyId::All => PropertyIdTag::All,
                    PropertyId::Unparsed => PropertyIdTag::Unparsed,
                    PropertyId::Custom(..) => PropertyIdTag::Custom,
                }
            }

            fn prefix_slot_mut(&mut self) -> Option<&mut VendorPrefix> {
                match self {
                    $($(| PropertyId::$Variant(if_row_has!([$Prefix] { p } else {})))?)+ => Some(p),
                    _ => None,
                }
            }

            /// `None` if the name is unknown or cannot be written with `prefix`.
            fn from_name_and_prefix(name: &[u8], prefix: VendorPrefix) -> Option<Self> {
                bun_core::comptime_string_map! {
                    static KNOWN: (VendorPrefix, fn(VendorPrefix) -> PropertyId<'static>) = {
                        $($name => (
                            VendorPrefix::NONE $($(.union(VendorPrefix::$allowed))+)?,
                            if_row_has!([$($Prefix)?] {
                                PropertyId::$Variant
                            } else {
                                |_| PropertyId::$Variant
                            }),
                        ),)+
                    };
                }
                let &(allowed, make) = KNOWN.get_ascii_case_insensitive(name)?;
                allowed.intersects(prefix).then(|| make(prefix))
            }
        }

        impl<'bump> Property<'bump> {
            /// Looks through `Unparsed` to the property that the value is for.
            pub(crate) fn property_id(&self) -> PropertyId<'bump> {
                match self {
                    $(Property::$Variant(_v) => if_row_has!([$($Prefix)?] {
                        PropertyId::$Variant(_v.1)
                    } else {
                        PropertyId::$Variant
                    }),)+
                    Property::All(..) => PropertyId::All,
                    Property::Unparsed(u) => u.property_id,
                    Property::Custom(c) => PropertyId::Custom(c.name),
                }
            }

            fn value_to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
                match self {
                    $(Property::$Variant(v) => {
                        css::generic::to_css(if_row_has!([$($Prefix)?] { &v.0 } else { v }), dest)
                    })+
                    Property::All(v) => css::generic::to_css(v, dest),
                    Property::Unparsed(u) => u.value.to_css(dest),
                    Property::Custom(c) => c.value.to_css(dest),
                }
            }

            pub fn parse(
                property_id: PropertyId<'bump>,
                input: &mut css::Parser<'_, 'bump>,
                options: &css::ParserOptions,
            ) -> css::Result<'bump, Property<'bump>> {
                let state = input.state();

                match property_id {
                    // In a module a bad value is an error.
                    PropertyId::Composes if input.flags.css_modules() => {
                        return css::generic::parse_with_options(input, options)
                            .map(Property::Composes);
                    }
                    $(if_row_has!([$($Prefix)?] {
                        PropertyId::$Variant(prefix)
                    } else {
                        PropertyId::$Variant
                    }) => {
                        let parse = if_row_has!([$($parse)?] { $($parse)? } else { parse_value });
                        if let Some(v) = parse(input, options) {
                            return Ok(Property::$Variant(
                                if_row_has!([$($Prefix)?] { (v, prefix) } else { v }),
                            ));
                        }
                    })+
                    PropertyId::All => return CSSWideKeyword::parse(input).map(Property::All),
                    PropertyId::Custom(name) => {
                        return CustomProperty::parse(name, input, options).map(Property::Custom);
                    }
                    PropertyId::Unparsed => {}
                }

                // `var()`, or syntax the type lacks: the handlers still need to know the property.
                input.reset(&state);
                if let PropertyId::Animation(_) | PropertyId::AnimationName(_) = property_id {
                    return animation::parse_unparsed(property_id, input, options);
                }
                UnparsedProperty::parse(property_id, input, options).map(Property::Unparsed)
            }

            pub(crate) fn deep_clone(&self, arena: &'bump bun_alloc::Arena) -> Property<'bump> {
                match self {
                    $(Property::$Variant(v) => Property::$Variant(if_row_has!([$($Prefix)?] {
                        (css::generic::deep_clone(&v.0, arena), v.1)
                    } else {
                        css::generic::deep_clone(v, arena)
                    })),)+
                    Property::All(a) => Property::All(*a),
                    Property::Unparsed(u) => Property::Unparsed(u.deep_clone(arena)),
                    Property::Custom(c) => Property::Custom(c.deep_clone(arena)),
                }
            }

            pub fn eql(&self, other: &Property<'bump>) -> bool {
                match (self, other) {
                    $((Property::$Variant(a), Property::$Variant(b)) => if_row_has!([$($Prefix)?] {
                        css::generic::eql(&a.0, &b.0) && a.1 == b.1
                    } else {
                        css::generic::eql(a, b)
                    }),)+
                    (Property::All(_), Property::All(_)) => true,
                    (Property::Unparsed(a), Property::Unparsed(b)) => a.eql(b),
                    (Property::Custom(a), Property::Custom(b)) => a.eql(b),
                    _ => false,
                }
            }
        }
    };
}

// The bundler reports `composes` conflicts in this order.
define_properties! {
    "background-color": BackgroundColor(CssColor),
    "background-image": BackgroundImage(SmallList<Image<'bump>, 1>),
    "background-position-x": BackgroundPositionX(SmallList<HorizontalPosition, 1>),
    "background-position-y": BackgroundPositionY(SmallList<VerticalPosition, 1>),
    "background-position": BackgroundPosition(SmallList<background::BackgroundPosition, 1>),
    "background-size": BackgroundSize(SmallList<background::BackgroundSize, 1>),
    "background-repeat": BackgroundRepeat(SmallList<background::BackgroundRepeat, 1>),
    "background-attachment": BackgroundAttachment(SmallList<background::BackgroundAttachment, 1>),
    "background-clip": BackgroundClip(SmallList<background::BackgroundClip, 1>, VendorPrefix: WEBKIT | MOZ),
    "background-origin": BackgroundOrigin(SmallList<background::BackgroundOrigin, 1>),
    "background": Background(SmallList<background::Background<'bump>, 1>),

    "box-shadow": BoxShadow(SmallList<box_shadow::BoxShadow, 1>, VendorPrefix: WEBKIT | MOZ),
    "opacity": Opacity(AlphaValue),
    "color": Color(CssColor),
    "display": Display(display::Display),
    "visibility": Visibility(display::Visibility),

    "width": Width(size::Size),
    "height": Height(size::Size),
    "min-width": MinWidth(size::Size),
    "min-height": MinHeight(size::Size),
    "max-width": MaxWidth(size::MaxSize),
    "max-height": MaxHeight(size::MaxSize),
    "block-size": BlockSize(size::Size),
    "inline-size": InlineSize(size::Size),
    "min-block-size": MinBlockSize(size::Size),
    "min-inline-size": MinInlineSize(size::Size),
    "max-block-size": MaxBlockSize(size::MaxSize),
    "max-inline-size": MaxInlineSize(size::MaxSize),
    "box-sizing": BoxSizing(size::BoxSizing, VendorPrefix: WEBKIT | MOZ),
    "aspect-ratio": AspectRatio(size::AspectRatio),

    "overflow": Overflow(overflow::Overflow),
    "overflow-x": OverflowX(overflow::OverflowKeyword),
    "overflow-y": OverflowY(overflow::OverflowKeyword),
    "text-overflow": TextOverflow(overflow::TextOverflow, VendorPrefix: O),

    "position": Position(position::Position),
    "top": Top(LengthPercentageOrAuto),
    "bottom": Bottom(LengthPercentageOrAuto),
    "left": Left(LengthPercentageOrAuto),
    "right": Right(LengthPercentageOrAuto),
    "inset-block-start": InsetBlockStart(LengthPercentageOrAuto),
    "inset-block-end": InsetBlockEnd(LengthPercentageOrAuto),
    "inset-inline-start": InsetInlineStart(LengthPercentageOrAuto),
    "inset-inline-end": InsetInlineEnd(LengthPercentageOrAuto),
    "inset-block": InsetBlock(margin_padding::InsetBlock),
    "inset-inline": InsetInline(margin_padding::InsetInline),
    "inset": Inset(margin_padding::Inset),

    "border-spacing": BorderSpacing(Size2D<Length>),
    "border-top-color": BorderTopColor(CssColor),
    "border-bottom-color": BorderBottomColor(CssColor),
    "border-left-color": BorderLeftColor(CssColor),
    "border-right-color": BorderRightColor(CssColor),
    "border-block-start-color": BorderBlockStartColor(CssColor),
    "border-block-end-color": BorderBlockEndColor(CssColor),
    "border-inline-start-color": BorderInlineStartColor(CssColor),
    "border-inline-end-color": BorderInlineEndColor(CssColor),

    "border-top-style": BorderTopStyle(border::LineStyle),
    "border-bottom-style": BorderBottomStyle(border::LineStyle),
    "border-left-style": BorderLeftStyle(border::LineStyle),
    "border-right-style": BorderRightStyle(border::LineStyle),
    "border-block-start-style": BorderBlockStartStyle(border::LineStyle),
    "border-block-end-style": BorderBlockEndStyle(border::LineStyle),
    "border-inline-start-style": BorderInlineStartStyle(border::LineStyle),
    "border-inline-end-style": BorderInlineEndStyle(border::LineStyle),

    "border-top-width": BorderTopWidth(border::BorderSideWidth) with parse_non_negative,
    "border-bottom-width": BorderBottomWidth(border::BorderSideWidth) with parse_non_negative,
    "border-left-width": BorderLeftWidth(border::BorderSideWidth) with parse_non_negative,
    "border-right-width": BorderRightWidth(border::BorderSideWidth) with parse_non_negative,
    "border-block-start-width": BorderBlockStartWidth(border::BorderSideWidth) with parse_non_negative,
    "border-block-end-width": BorderBlockEndWidth(border::BorderSideWidth) with parse_non_negative,
    "border-inline-start-width": BorderInlineStartWidth(border::BorderSideWidth) with parse_non_negative,
    "border-inline-end-width": BorderInlineEndWidth(border::BorderSideWidth) with parse_non_negative,

    "border-top-left-radius": BorderTopLeftRadius(Size2D<LengthPercentage>, VendorPrefix: WEBKIT | MOZ) with parse_non_negative,
    "border-top-right-radius": BorderTopRightRadius(Size2D<LengthPercentage>, VendorPrefix: WEBKIT | MOZ) with parse_non_negative,
    "border-bottom-left-radius": BorderBottomLeftRadius(Size2D<LengthPercentage>, VendorPrefix: WEBKIT | MOZ) with parse_non_negative,
    "border-bottom-right-radius": BorderBottomRightRadius(Size2D<LengthPercentage>, VendorPrefix: WEBKIT | MOZ) with parse_non_negative,
    "border-start-start-radius": BorderStartStartRadius(Size2D<LengthPercentage>) with parse_non_negative,
    "border-start-end-radius": BorderStartEndRadius(Size2D<LengthPercentage>) with parse_non_negative,
    "border-end-start-radius": BorderEndStartRadius(Size2D<LengthPercentage>) with parse_non_negative,
    "border-end-end-radius": BorderEndEndRadius(Size2D<LengthPercentage>) with parse_non_negative,
    "border-radius": BorderRadius(border_radius::BorderRadius, VendorPrefix: WEBKIT | MOZ),

    "border-image-source": BorderImageSource(Image<'bump>),
    "border-image-outset": BorderImageOutset(Rect<LengthOrNumber>),
    "border-image-repeat": BorderImageRepeat(border_image::BorderImageRepeat),
    "border-image-width": BorderImageWidth(Rect<border_image::BorderImageSideWidth>),
    "border-image-slice": BorderImageSlice(border_image::BorderImageSlice),
    "border-image": BorderImage(border_image::BorderImage<'bump>, VendorPrefix: WEBKIT | MOZ | O),

    "border-color": BorderColor(border::BorderColor),
    "border-style": BorderStyle(border::BorderStyle),
    "border-width": BorderWidth(border::BorderWidth) with parse_non_negative,
    "border-block-color": BorderBlockColor(border::BorderBlockColor),
    "border-block-style": BorderBlockStyle(border::BorderBlockStyle),
    "border-block-width": BorderBlockWidth(border::BorderBlockWidth) with parse_non_negative,
    "border-inline-color": BorderInlineColor(border::BorderInlineColor),
    "border-inline-style": BorderInlineStyle(border::BorderInlineStyle),
    "border-inline-width": BorderInlineWidth(border::BorderInlineWidth) with parse_non_negative,

    "border": Border(border::Border),
    "border-top": BorderTop(border::BorderTop),
    "border-bottom": BorderBottom(border::BorderBottom),
    "border-left": BorderLeft(border::BorderLeft),
    "border-right": BorderRight(border::BorderRight),
    "border-block": BorderBlock(border::BorderBlock),
    "border-block-start": BorderBlockStart(border::BorderBlockStart),
    "border-block-end": BorderBlockEnd(border::BorderBlockEnd),
    "border-inline": BorderInline(border::BorderInline),
    "border-inline-start": BorderInlineStart(border::BorderInlineStart),
    "border-inline-end": BorderInlineEnd(border::BorderInlineEnd),

    "outline": Outline(outline::Outline),
    "outline-color": OutlineColor(CssColor),
    "outline-style": OutlineStyle(outline::OutlineStyle),
    "outline-width": OutlineWidth(border::BorderSideWidth) with parse_non_negative,

    "flex-direction": FlexDirection(flex::FlexDirection, VendorPrefix: WEBKIT | MS),
    "flex-wrap": FlexWrap(flex::FlexWrap, VendorPrefix: WEBKIT | MS),
    "flex-flow": FlexFlow(flex::FlexFlow, VendorPrefix: WEBKIT | MS),
    "flex-grow": FlexGrow(CSSNumber, VendorPrefix: WEBKIT),
    "flex-shrink": FlexShrink(CSSNumber, VendorPrefix: WEBKIT),
    "flex-basis": FlexBasis(LengthPercentageOrAuto, VendorPrefix: WEBKIT) with parse_non_negative,
    "flex": Flex(flex::Flex, VendorPrefix: WEBKIT | MS) with parse_non_negative,
    "order": Order(CSSInteger, VendorPrefix: WEBKIT),

    "align-content": AlignContent(align::AlignContent, VendorPrefix: WEBKIT),
    "justify-content": JustifyContent(align::JustifyContent, VendorPrefix: WEBKIT),
    "place-content": PlaceContent(align::PlaceContent),
    "align-self": AlignSelf(align::AlignSelf, VendorPrefix: WEBKIT),
    "justify-self": JustifySelf(align::JustifySelf),
    "place-self": PlaceSelf(align::PlaceSelf),
    "align-items": AlignItems(align::AlignItems, VendorPrefix: WEBKIT),
    "justify-items": JustifyItems(align::JustifyItems),
    "place-items": PlaceItems(align::PlaceItems),
    "row-gap": RowGap(align::GapValue) with parse_non_negative,
    "column-gap": ColumnGap(align::GapValue) with parse_non_negative,
    "gap": Gap(align::Gap) with parse_non_negative,

    "box-orient": BoxOrient(flex::BoxOrient, VendorPrefix: WEBKIT | MOZ, legacy),
    "box-direction": BoxDirection(flex::BoxDirection, VendorPrefix: WEBKIT | MOZ, legacy),
    "box-ordinal-group": BoxOrdinalGroup(CSSInteger, VendorPrefix: WEBKIT | MOZ, legacy),
    "box-align": BoxAlign(flex::BoxAlign, VendorPrefix: WEBKIT | MOZ, legacy),
    "box-flex": BoxFlex(CSSNumber, VendorPrefix: WEBKIT | MOZ, legacy),
    "box-flex-group": BoxFlexGroup(CSSInteger, VendorPrefix: WEBKIT, legacy),
    "box-pack": BoxPack(flex::BoxPack, VendorPrefix: WEBKIT | MOZ, legacy),
    "box-lines": BoxLines(flex::BoxLines, VendorPrefix: WEBKIT | MOZ, legacy),

    "flex-pack": FlexPack(flex::FlexPack, VendorPrefix: MS, legacy),
    "flex-order": FlexOrder(CSSInteger, VendorPrefix: MS, legacy),
    "flex-align": FlexAlign(flex::BoxAlign, VendorPrefix: MS, legacy),
    "flex-item-align": FlexItemAlign(flex::FlexItemAlign, VendorPrefix: MS, legacy),
    "flex-line-pack": FlexLinePack(flex::FlexLinePack, VendorPrefix: MS, legacy),
    "flex-positive": FlexPositive(CSSNumber, VendorPrefix: MS, legacy),
    "flex-negative": FlexNegative(CSSNumber, VendorPrefix: MS, legacy),
    "flex-preferred-size": FlexPreferredSize(LengthPercentageOrAuto, VendorPrefix: MS, legacy),

    "margin-top": MarginTop(LengthPercentageOrAuto),
    "margin-bottom": MarginBottom(LengthPercentageOrAuto),
    "margin-left": MarginLeft(LengthPercentageOrAuto),
    "margin-right": MarginRight(LengthPercentageOrAuto),
    "margin-block-start": MarginBlockStart(LengthPercentageOrAuto),
    "margin-block-end": MarginBlockEnd(LengthPercentageOrAuto),
    "margin-inline-start": MarginInlineStart(LengthPercentageOrAuto),
    "margin-inline-end": MarginInlineEnd(LengthPercentageOrAuto),
    "margin-block": MarginBlock(margin_padding::MarginBlock),
    "margin-inline": MarginInline(margin_padding::MarginInline),
    "margin": Margin(margin_padding::Margin),

    "padding-top": PaddingTop(LengthPercentageOrAuto) with parse_non_negative,
    "padding-bottom": PaddingBottom(LengthPercentageOrAuto) with parse_non_negative,
    "padding-left": PaddingLeft(LengthPercentageOrAuto) with parse_non_negative,
    "padding-right": PaddingRight(LengthPercentageOrAuto) with parse_non_negative,
    "padding-block-start": PaddingBlockStart(LengthPercentageOrAuto) with parse_non_negative,
    "padding-block-end": PaddingBlockEnd(LengthPercentageOrAuto) with parse_non_negative,
    "padding-inline-start": PaddingInlineStart(LengthPercentageOrAuto) with parse_non_negative,
    "padding-inline-end": PaddingInlineEnd(LengthPercentageOrAuto) with parse_non_negative,
    "padding-block": PaddingBlock(margin_padding::PaddingBlock) with parse_non_negative,
    "padding-inline": PaddingInline(margin_padding::PaddingInline) with parse_non_negative,
    "padding": Padding(margin_padding::Padding) with parse_non_negative,

    "scroll-margin-top": ScrollMarginTop(LengthPercentageOrAuto),
    "scroll-margin-bottom": ScrollMarginBottom(LengthPercentageOrAuto),
    "scroll-margin-left": ScrollMarginLeft(LengthPercentageOrAuto),
    "scroll-margin-right": ScrollMarginRight(LengthPercentageOrAuto),
    "scroll-margin-block-start": ScrollMarginBlockStart(LengthPercentageOrAuto),
    "scroll-margin-block-end": ScrollMarginBlockEnd(LengthPercentageOrAuto),
    "scroll-margin-inline-start": ScrollMarginInlineStart(LengthPercentageOrAuto),
    "scroll-margin-inline-end": ScrollMarginInlineEnd(LengthPercentageOrAuto),
    "scroll-margin-block": ScrollMarginBlock(margin_padding::ScrollMarginBlock),
    "scroll-margin-inline": ScrollMarginInline(margin_padding::ScrollMarginInline),
    "scroll-margin": ScrollMargin(margin_padding::ScrollMargin),

    "scroll-padding-top": ScrollPaddingTop(LengthPercentageOrAuto),
    "scroll-padding-bottom": ScrollPaddingBottom(LengthPercentageOrAuto),
    "scroll-padding-left": ScrollPaddingLeft(LengthPercentageOrAuto),
    "scroll-padding-right": ScrollPaddingRight(LengthPercentageOrAuto),
    "scroll-padding-block-start": ScrollPaddingBlockStart(LengthPercentageOrAuto),
    "scroll-padding-block-end": ScrollPaddingBlockEnd(LengthPercentageOrAuto),
    "scroll-padding-inline-start": ScrollPaddingInlineStart(LengthPercentageOrAuto),
    "scroll-padding-inline-end": ScrollPaddingInlineEnd(LengthPercentageOrAuto),
    "scroll-padding-block": ScrollPaddingBlock(margin_padding::ScrollPaddingBlock),
    "scroll-padding-inline": ScrollPaddingInline(margin_padding::ScrollPaddingInline),
    "scroll-padding": ScrollPadding(margin_padding::ScrollPadding),

    "font-weight": FontWeight(font::FontWeight),
    "font-size": FontSize(font::FontSize) with parse_non_negative,
    "font-stretch": FontStretch(font::FontStretch),
    "font-family": FontFamily(Vec<font::FontFamily<'bump>>),
    "font-style": FontStyle(font::FontStyle),
    "font-variant-caps": FontVariantCaps(font::FontVariantCaps),
    "line-height": LineHeight(font::LineHeight),
    "font": Font(font::Font<'bump>),

    "transition-property": TransitionProperty(SmallList<PropertyId<'bump>, 1>, VendorPrefix: WEBKIT | MOZ | MS),
    "transition-duration": TransitionDuration(SmallList<Time, 1>, VendorPrefix: WEBKIT | MOZ | MS),
    "transition-delay": TransitionDelay(SmallList<Time, 1>, VendorPrefix: WEBKIT | MOZ | MS),
    "transition-timing-function": TransitionTimingFunction(SmallList<EasingFunction, 1>, VendorPrefix: WEBKIT | MOZ | MS),
    "transition": Transition(SmallList<transition::Transition<'bump>, 1>, VendorPrefix: WEBKIT | MOZ | MS),

    "animation": Animation(SmallList<animation::Animation<'bump>, 1>, VendorPrefix: WEBKIT | MOZ | MS | O),
    "animation-name": AnimationName(SmallList<animation::AnimationName<'bump>, 1>, VendorPrefix: WEBKIT | MOZ | MS | O),

    "transform": Transform(transform::TransformList, VendorPrefix: WEBKIT | MOZ | MS | O),
    "transform-origin": TransformOrigin(position::Position, VendorPrefix: WEBKIT | MOZ | MS | O),
    "transform-style": TransformStyle(transform::TransformStyle, VendorPrefix: WEBKIT | MOZ),
    "transform-box": TransformBox(transform::TransformBox),
    "backface-visibility": BackfaceVisibility(transform::BackfaceVisibility, VendorPrefix: WEBKIT | MOZ),
    "perspective": Perspective(transform::Perspective, VendorPrefix: WEBKIT | MOZ),
    "perspective-origin": PerspectiveOrigin(position::Position, VendorPrefix: WEBKIT | MOZ),
    "translate": Translate(transform::Translate),
    "rotate": Rotate(transform::Rotate),
    "scale": Scale(transform::Scale),

    "text-decoration-color": TextDecorationColor(CssColor, VendorPrefix: WEBKIT | MOZ),
    "text-emphasis-color": TextEmphasisColor(CssColor, VendorPrefix: WEBKIT),
    "text-shadow": TextShadow(SmallList<text::TextShadow, 1>),
    "direction": Direction(text::Direction),

    "composes": Composes(css_modules::Composes<'bump>) with leave_unparsed,

    "mask-image": MaskImage(SmallList<Image<'bump>, 1>, VendorPrefix: WEBKIT),
    "mask-mode": MaskMode(SmallList<masking::MaskMode, 1>),
    "mask-repeat": MaskRepeat(SmallList<background::BackgroundRepeat, 1>, VendorPrefix: WEBKIT),
    "mask-position-x": MaskPositionX(SmallList<HorizontalPosition, 1>),
    "mask-position-y": MaskPositionY(SmallList<VerticalPosition, 1>),
    "mask-position": MaskPosition(SmallList<position::Position, 1>, VendorPrefix: WEBKIT),
    "mask-clip": MaskClip(SmallList<masking::MaskClip, 1>, VendorPrefix: WEBKIT),
    "mask-origin": MaskOrigin(SmallList<masking::GeometryBox, 1>, VendorPrefix: WEBKIT),
    "mask-size": MaskSize(SmallList<background::BackgroundSize, 1>, VendorPrefix: WEBKIT),
    "mask-composite": MaskComposite(SmallList<masking::MaskComposite, 1>),
    "mask-type": MaskType(masking::MaskType),
    "mask": Mask(SmallList<masking::Mask<'bump>, 1>, VendorPrefix: WEBKIT),

    "mask-border-source": MaskBorderSource(Image<'bump>),
    "mask-border-mode": MaskBorderMode(masking::MaskBorderMode),
    "mask-border-slice": MaskBorderSlice(border_image::BorderImageSlice),
    "mask-border-width": MaskBorderWidth(Rect<border_image::BorderImageSideWidth>),
    "mask-border-outset": MaskBorderOutset(Rect<LengthOrNumber>),
    "mask-border-repeat": MaskBorderRepeat(border_image::BorderImageRepeat),
    "mask-border": MaskBorder(masking::MaskBorder<'bump>),

    "-webkit-mask-composite": WebKitMaskComposite(SmallList<masking::WebKitMaskComposite, 1>),
    "mask-source-type": MaskSourceType(SmallList<masking::WebKitMaskSourceType, 1>, VendorPrefix: WEBKIT, legacy),
    "mask-box-image": MaskBoxImage(border_image::BorderImage<'bump>, VendorPrefix: WEBKIT, legacy),
    "mask-box-image-source": MaskBoxImageSource(Image<'bump>, VendorPrefix: WEBKIT, legacy),
    "mask-box-image-slice": MaskBoxImageSlice(border_image::BorderImageSlice, VendorPrefix: WEBKIT, legacy),
    "mask-box-image-width": MaskBoxImageWidth(Rect<border_image::BorderImageSideWidth>, VendorPrefix: WEBKIT, legacy),
    "mask-box-image-outset": MaskBoxImageOutset(Rect<LengthOrNumber>, VendorPrefix: WEBKIT, legacy),
    "mask-box-image-repeat": MaskBoxImageRepeat(border_image::BorderImageRepeat, VendorPrefix: WEBKIT, legacy),

    "color-scheme": ColorScheme(ui::ColorScheme),

    "view-transition-name": ViewTransitionName(transition::ViewTransitionName<'bump>),
    "view-transition-class": ViewTransitionClass(NoneOrCustomIdentList<'bump>),
    "view-transition-group": ViewTransitionGroup(transition::ViewTransitionGroup<'bump>),
}

/// A fully consumed `T`. One instantiation per value type, not one inlined copy per property.
fn parse_value<'bump, T: css::generic::ParseWithOptions<'bump>>(
    input: &mut css::Parser<'_, 'bump>,
    options: &css::ParserOptions,
) -> Option<T> {
    let value = T::parse_with_options(input, options).ok()?;
    input.expect_exhausted().is_ok().then_some(value)
}

/// `parse_value` for a property whose lengths and percentages have the range `[0,∞]`.
fn parse_non_negative<'bump, T: css::generic::ParseWithOptions<'bump>>(
    input: &mut css::Parser<'_, 'bump>,
    options: &css::ParserOptions,
) -> Option<T> {
    let value = input
        .parse_with_non_negative(true, |i| T::parse_with_options(i, options))
        .ok()?;
    input.expect_exhausted().is_ok().then_some(value)
}

/// `composes` outside a CSS module: parsing it would import the file it names.
fn leave_unparsed<T>(_: &mut css::Parser, _: &css::ParserOptions) -> Option<T> {
    None
}

impl PartialEq for PropertyId<'_> {
    #[inline]
    fn eq(&self, other: &Self) -> bool {
        match (self, other) {
            (PropertyId::Custom(a), PropertyId::Custom(b)) => css::generic::eql(a, b),
            _ => self.tag() == other.tag() && self.prefix() == other.prefix(),
        }
    }
}

impl Eq for PropertyId<'_> {}

impl core::hash::Hash for PropertyId<'_> {
    #[inline]
    fn hash<H: core::hash::Hasher>(&self, h: &mut H) {
        (self.tag() as u16).hash(h);
        if let PropertyId::Custom(name) = self {
            h.write(name.as_str());
        }
    }
}

impl<'bump> PropertyId<'bump> {
    /// The name without a vendor prefix.
    pub fn name(&self) -> &[u8] {
        match self {
            PropertyId::Custom(c) => c.as_str(),
            _ => self.tag().name(),
        }
    }

    /// Empty for a property that has no prefixed form.
    pub(crate) fn prefix(&self) -> VendorPrefix {
        let mut id = *self;
        id.prefix_slot_mut().map_or(VendorPrefix::empty(), |p| *p)
    }

    /// One flag for each spelling of the name, in the order they are printed.
    fn each_prefix(&self) -> impl Iterator<Item = VendorPrefix> {
        let prefix = self.prefix().or_none();
        let flags = VendorPrefix::FIELDS.iter().copied();
        flags.filter(move |flag| prefix.contains(*flag))
    }

    pub(crate) fn with_prefix(&self, pre: VendorPrefix) -> PropertyId<'bump> {
        let mut id = *self;
        if let Some(p) = id.prefix_slot_mut() {
            *p = pre;
        }
        id
    }

    pub(crate) fn add_prefix(&mut self, pre: VendorPrefix) {
        if let Some(p) = self.prefix_slot_mut() {
            *p |= pre;
        }
    }

    pub(crate) fn set_prefixes_for_targets(&mut self, targets: &Targets) {
        let Some(feature) = self.tag().prefix_feature() else {
            return;
        };
        if let Some(p) = self.prefix_slot_mut() {
            *p = targets.prefixes(*p, feature);
        }
    }

    #[inline]
    pub(crate) fn deep_clone(&self, _arena: &bun_alloc::Arena) -> PropertyId<'bump> {
        *self
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        let name = self.name();
        dest.write_comma_separated(self.each_prefix(), |d, p| {
            p.to_css(d)?;
            match self {
                PropertyId::Custom(_) => d.serialize_identifier(name),
                _ => d.write_str(name),
            }
        })
    }

    pub fn parse(input: &mut css::Parser<'_, 'bump>) -> css::Result<'bump, PropertyId<'bump>> {
        let name = input.expect_ident()?;
        // `transition-property: unset` is the css-wide keyword, not a property of that name.
        if is_reserved_custom_ident(name) {
            return Err(input.new_custom_error(css::ParserError::invalid_value));
        }
        Ok(PropertyId::from_string(name))
    }

    pub(crate) fn from_string(name: &'bump [u8]) -> PropertyId<'bump> {
        let (prefix, unprefixed) = VendorPrefix::strip_from(name);
        PropertyId::from_name_and_prefix(unprefixed, prefix)
            .unwrap_or_else(|| PropertyId::Custom(CustomPropertyName::from_str(name)))
    }
}

impl Property<'_> {
    /// Does not look through `Unparsed`: the tag says which payload `self` has.
    #[inline]
    pub(crate) fn variant_tag(&self) -> PropertyIdTag {
        match self {
            Property::Unparsed(_) => PropertyIdTag::Unparsed,
            Property::Custom(_) => PropertyIdTag::Custom,
            _ => self.property_id().tag(),
        }
    }

    pub fn to_css(&self, dest: &mut Printer, important: bool) -> Result<(), PrintErr> {
        if let Property::Custom(custom) = self {
            custom.name.to_css(dest)?;
            return self.after_name_to_css(dest, important);
        }
        let id = self.property_id();
        let name = id.name();
        dest.write_separated(
            id.each_prefix(),
            |d| {
                d.write_char(b';')?;
                d.newline()
            },
            |d, p| {
                p.to_css(d)?;
                d.write_str(name)?;
                self.after_name_to_css(d, important)
            },
        )
    }

    /// Out of line it absorbs `value_to_css` and every declaration pays for the larger frame.
    #[inline(always)]
    fn after_name_to_css(&self, dest: &mut Printer, important: bool) -> Result<(), PrintErr> {
        dest.delim(b':', false)?;
        self.value_to_css(dest)?;
        if important {
            dest.whitespace()?;
            dest.write_str(b"!important")?;
        }
        Ok(())
    }
}
