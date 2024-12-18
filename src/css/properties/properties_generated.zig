const std = @import("std");
const bun = @import("root").bun;
const Allocator = std.mem.Allocator;

pub const css = @import("../css_parser.zig");

const Printer = css.Printer;
const PrintErr = css.PrintErr;
const VendorPrefix = css.VendorPrefix;

const PropertyImpl = @import("./properties_impl.zig").PropertyImpl;
const PropertyIdImpl = @import("./properties_impl.zig").PropertyIdImpl;

const CSSWideKeyword = css.css_properties.CSSWideKeyword;
const UnparsedProperty = css.css_properties.custom.UnparsedProperty;
const CustomProperty = css.css_properties.custom.CustomProperty;

const css_values = css.css_values;
const CssColor = css.css_values.color.CssColor;
const Image = css.css_values.image.Image;
const Length = css.css_values.length.Length;
const LengthValue = css.css_values.length.LengthValue;
const LengthPercentage = css_values.length.LengthPercentage;
const LengthPercentageOrAuto = css_values.length.LengthPercentageOrAuto;
const PropertyCategory = css.PropertyCategory;
const LogicalGroup = css.LogicalGroup;
const CSSNumber = css.css_values.number.CSSNumber;
const CSSNumberFns = css.css_values.number.CSSNumberFns;
const CSSInteger = css.css_values.number.CSSInteger;
const CSSIntegerFns = css.css_values.number.CSSIntegerFns;
const NumberOrPercentage = css.css_values.percentage.NumberOrPercentage;
const Percentage = css.css_values.percentage.Percentage;
const Angle = css.css_values.angle.Angle;
const DashedIdentReference = css.css_values.ident.DashedIdentReference;
const Time = css.css_values.time.Time;
const EasingFunction = css.css_values.easing.EasingFunction;
const CustomIdent = css.css_values.ident.CustomIdent;
const CSSString = css.css_values.string.CSSString;
const DashedIdent = css.css_values.ident.DashedIdent;
const Url = css.css_values.url.Url;
const CustomIdentList = css.css_values.ident.CustomIdentList;
const Location = css.Location;
const HorizontalPosition = css.css_values.position.HorizontalPosition;
const VerticalPosition = css.css_values.position.VerticalPosition;
const ContainerName = css.css_rules.container.ContainerName;

pub const font = css.css_properties.font;
const border = css.css_properties.border;
const border_radius = css.css_properties.border_radius;
const border_image = css.css_properties.border_image;
const outline = css.css_properties.outline;
const flex = css.css_properties.flex;
const @"align" = css.css_properties.@"align";
const margin_padding = css.css_properties.margin_padding;
const transition = css.css_properties.transition;
const animation = css.css_properties.animation;
const transform = css.css_properties.transform;
const text = css.css_properties.text;
const ui = css.css_properties.ui;
const list = css.css_properties.list;
const css_modules = css.css_properties.css_modules;
const svg = css.css_properties.svg;
const shape = css.css_properties.shape;
const masking = css.css_properties.masking;
const background = css.css_properties.background;
const effects = css.css_properties.effects;
const contain = css.css_properties.contain;
const custom = css.css_properties.custom;
const position = css.css_properties.position;
const box_shadow = css.css_properties.box_shadow;
const size = css.css_properties.size;
const overflow = css.css_properties.overflow;

const BorderSideWidth = border.BorderSideWidth;
const Size2D = css_values.size.Size2D;
const BorderRadius = border_radius.BorderRadius;
const Rect = css_values.rect.Rect;
const LengthOrNumber = css_values.length.LengthOrNumber;
const BorderImageRepeat = border_image.BorderImageRepeat;
const BorderImageSideWidth = border_image.BorderImageSideWidth;
const BorderImageSlice = border_image.BorderImageSlice;
const BorderImage = border_image.BorderImage;
const BorderColor = border.BorderColor;
const BorderStyle = border.BorderStyle;
const BorderWidth = border.BorderWidth;
const BorderBlockColor = border.BorderBlockColor;
const BorderBlockStyle = border.BorderBlockStyle;
const BorderBlockWidth = border.BorderBlockWidth;
const BorderInlineColor = border.BorderInlineColor;
const BorderInlineStyle = border.BorderInlineStyle;
const BorderInlineWidth = border.BorderInlineWidth;
const Border = border.Border;
const BorderTop = border.BorderTop;
const BorderRight = border.BorderRight;
const BorderLeft = border.BorderLeft;
const BorderBottom = border.BorderBottom;
const BorderBlockStart = border.BorderBlockStart;
const BorderBlockEnd = border.BorderBlockEnd;
const BorderInlineStart = border.BorderInlineStart;
const BorderInlineEnd = border.BorderInlineEnd;
const BorderBlock = border.BorderBlock;
const BorderInline = border.BorderInline;
const Outline = outline.Outline;
const OutlineStyle = outline.OutlineStyle;
const FlexDirection = flex.FlexDirection;
const FlexWrap = flex.FlexWrap;
const FlexFlow = flex.FlexFlow;
const Flex = flex.Flex;
const BoxOrient = flex.BoxOrient;
const BoxDirection = flex.BoxDirection;
const BoxAlign = flex.BoxAlign;
const BoxPack = flex.BoxPack;
const BoxLines = flex.BoxLines;
const FlexPack = flex.FlexPack;
const FlexItemAlign = flex.FlexItemAlign;
const FlexLinePack = flex.FlexLinePack;
const AlignContent = @"align".AlignContent;
const JustifyContent = @"align".JustifyContent;
const PlaceContent = @"align".PlaceContent;
const AlignSelf = @"align".AlignSelf;
const JustifySelf = @"align".JustifySelf;
const PlaceSelf = @"align".PlaceSelf;
const AlignItems = @"align".AlignItems;
const JustifyItems = @"align".JustifyItems;
const PlaceItems = @"align".PlaceItems;
const GapValue = @"align".GapValue;
const Gap = @"align".Gap;
const MarginBlock = margin_padding.MarginBlock;
const Margin = margin_padding.Margin;
const MarginInline = margin_padding.MarginInline;
const PaddingBlock = margin_padding.PaddingBlock;
const PaddingInline = margin_padding.PaddingInline;
const Padding = margin_padding.Padding;
const ScrollMarginBlock = margin_padding.ScrollMarginBlock;
const ScrollMarginInline = margin_padding.ScrollMarginInline;
const ScrollMargin = margin_padding.ScrollMargin;
const ScrollPaddingBlock = margin_padding.ScrollPaddingBlock;
const ScrollPaddingInline = margin_padding.ScrollPaddingInline;
const ScrollPadding = margin_padding.ScrollPadding;
const FontWeight = font.FontWeight;
const FontSize = font.FontSize;
const FontStretch = font.FontStretch;
const FontFamily = font.FontFamily;
const FontStyle = font.FontStyle;
const FontVariantCaps = font.FontVariantCaps;
const LineHeight = font.LineHeight;
const Font = font.Font;
// const VerticalAlign = font.VerticalAlign;
// const Transition = transition.Transition;
// const AnimationNameList = animation.AnimationNameList;
// const AnimationList = animation.AnimationList;
// const AnimationIterationCount = animation.AnimationIterationCount;
// const AnimationDirection = animation.AnimationDirection;
// const AnimationPlayState = animation.AnimationPlayState;
// const AnimationFillMode = animation.AnimationFillMode;
// const AnimationComposition = animation.AnimationComposition;
// const AnimationTimeline = animation.AnimationTimeline;
// const AnimationRangeStart = animation.AnimationRangeStart;
// const AnimationRangeEnd = animation.AnimationRangeEnd;
// const AnimationRange = animation.AnimationRange;
// const TransformList = transform.TransformList;
// const TransformStyle = transform.TransformStyle;
// const TransformBox = transform.TransformBox;
// const BackfaceVisibility = transform.BackfaceVisibility;
// const Perspective = transform.Perspective;
// const Translate = transform.Translate;
// const Rotate = transform.Rotate;
// const Scale = transform.Scale;
// const TextTransform = text.TextTransform;
// const WhiteSpace = text.WhiteSpace;
// const WordBreak = text.WordBreak;
// const LineBreak = text.LineBreak;
// const Hyphens = text.Hyphens;
// const OverflowWrap = text.OverflowWrap;
// const TextAlign = text.TextAlign;
// const TextIndent = text.TextIndent;
// const Spacing = text.Spacing;
// const TextJustify = text.TextJustify;
// const TextAlignLast = text.TextAlignLast;
// const TextDecorationLine = text.TextDecorationLine;
// const TextDecorationStyle = text.TextDecorationStyle;
// const TextDecorationThickness = text.TextDecorationThickness;
// const TextDecoration = text.TextDecoration;
// const TextDecorationSkipInk = text.TextDecorationSkipInk;
// const TextEmphasisStyle = text.TextEmphasisStyle;
// const TextEmphasis = text.TextEmphasis;
// const TextEmphasisPositionVertical = text.TextEmphasisPositionVertical;
// const TextEmphasisPositionHorizontal = text.TextEmphasisPositionHorizontal;
// const TextEmphasisPosition = text.TextEmphasisPosition;
const TextShadow = text.TextShadow;
// const TextSizeAdjust = text.TextSizeAdjust;
const Direction = text.Direction;
// const UnicodeBidi = text.UnicodeBidi;
// const BoxDecorationBreak = text.BoxDecorationBreak;
// const Resize = ui.Resize;
// const Cursor = ui.Cursor;
// const ColorOrAuto = ui.ColorOrAuto;
// const CaretShape = ui.CaretShape;
// const Caret = ui.Caret;
// const UserSelect = ui.UserSelect;
// const Appearance = ui.Appearance;
// const ColorScheme = ui.ColorScheme;
// const ListStyleType = list.ListStyleType;
// const ListStylePosition = list.ListStylePosition;
// const ListStyle = list.ListStyle;
// const MarkerSide = list.MarkerSide;
const Composes = css_modules.Composes;
// const SVGPaint = svg.SVGPaint;
// const FillRule = shape.FillRule;
// const AlphaValue = shape.AlphaValue;
// const StrokeLinecap = svg.StrokeLinecap;
// const StrokeLinejoin = svg.StrokeLinejoin;
// const StrokeDasharray = svg.StrokeDasharray;
// const Marker = svg.Marker;
// const ColorInterpolation = svg.ColorInterpolation;
// const ColorRendering = svg.ColorRendering;
// const ShapeRendering = svg.ShapeRendering;
// const TextRendering = svg.TextRendering;
// const ImageRendering = svg.ImageRendering;
const ClipPath = masking.ClipPath;
const MaskMode = masking.MaskMode;
const MaskClip = masking.MaskClip;
const GeometryBox = masking.GeometryBox;
const MaskComposite = masking.MaskComposite;
const MaskType = masking.MaskType;
const Mask = masking.Mask;
const MaskBorderMode = masking.MaskBorderMode;
const MaskBorder = masking.MaskBorder;
const WebKitMaskComposite = masking.WebKitMaskComposite;
const WebKitMaskSourceType = masking.WebKitMaskSourceType;
const BackgroundRepeat = background.BackgroundRepeat;
const BackgroundSize = background.BackgroundSize;
// const FilterList = effects.FilterList;
// const ContainerType = contain.ContainerType;
// const Container = contain.Container;
// const ContainerNameList = contain.ContainerNameList;
const CustomPropertyName = custom.CustomPropertyName;
const display = css.css_properties.display;

const Position = position.Position;

const Result = css.Result;

const BabyList = bun.BabyList;
const ArrayList = std.ArrayListUnmanaged;
const SmallList = css.SmallList;
pub const Property = union(PropertyIdTag) {
    @"background-color": CssColor,
    @"background-image": SmallList(Image, 1),
    @"background-position-x": SmallList(css_values.position.HorizontalPosition, 1),
    @"background-position-y": SmallList(css_values.position.VerticalPosition, 1),
    @"background-position": SmallList(background.BackgroundPosition, 1),
    @"background-size": SmallList(background.BackgroundSize, 1),
    @"background-repeat": SmallList(background.BackgroundRepeat, 1),
    @"background-attachment": SmallList(background.BackgroundAttachment, 1),
    @"background-clip": struct { SmallList(background.BackgroundClip, 1), VendorPrefix },
    @"background-origin": SmallList(background.BackgroundOrigin, 1),
    background: SmallList(background.Background, 1),
    @"box-shadow": struct { SmallList(box_shadow.BoxShadow, 1), VendorPrefix },
    opacity: css.css_values.alpha.AlphaValue,
    color: CssColor,
    display: display.Display,
    visibility: display.Visibility,
    width: size.Size,
    height: size.Size,
    @"min-width": size.Size,
    @"min-height": size.Size,
    @"max-width": size.MaxSize,
    @"max-height": size.MaxSize,
    @"block-size": size.Size,
    @"inline-size": size.Size,
    @"min-block-size": size.Size,
    @"min-inline-size": size.Size,
    @"max-block-size": size.MaxSize,
    @"max-inline-size": size.MaxSize,
    @"box-sizing": struct { size.BoxSizing, VendorPrefix },
    @"aspect-ratio": size.AspectRatio,
    overflow: overflow.Overflow,
    @"overflow-x": overflow.OverflowKeyword,
    @"overflow-y": overflow.OverflowKeyword,
    @"text-overflow": struct { overflow.TextOverflow, VendorPrefix },
    position: position.Position,
    top: LengthPercentageOrAuto,
    bottom: LengthPercentageOrAuto,
    left: LengthPercentageOrAuto,
    right: LengthPercentageOrAuto,
    @"inset-block-start": LengthPercentageOrAuto,
    @"inset-block-end": LengthPercentageOrAuto,
    @"inset-inline-start": LengthPercentageOrAuto,
    @"inset-inline-end": LengthPercentageOrAuto,
    @"inset-block": margin_padding.InsetBlock,
    @"inset-inline": margin_padding.InsetInline,
    inset: margin_padding.Inset,
    @"border-spacing": css.css_values.size.Size2D(Length),
    @"border-top-color": CssColor,
    @"border-bottom-color": CssColor,
    @"border-left-color": CssColor,
    @"border-right-color": CssColor,
    @"border-block-start-color": CssColor,
    @"border-block-end-color": CssColor,
    @"border-inline-start-color": CssColor,
    @"border-inline-end-color": CssColor,
    @"border-top-style": border.LineStyle,
    @"border-bottom-style": border.LineStyle,
    @"border-left-style": border.LineStyle,
    @"border-right-style": border.LineStyle,
    @"border-block-start-style": border.LineStyle,
    @"border-block-end-style": border.LineStyle,
    @"border-inline-start-style": border.LineStyle,
    @"border-inline-end-style": border.LineStyle,
    @"border-top-width": BorderSideWidth,
    @"border-bottom-width": BorderSideWidth,
    @"border-left-width": BorderSideWidth,
    @"border-right-width": BorderSideWidth,
    @"border-block-start-width": BorderSideWidth,
    @"border-block-end-width": BorderSideWidth,
    @"border-inline-start-width": BorderSideWidth,
    @"border-inline-end-width": BorderSideWidth,
    @"border-top-left-radius": struct { Size2D(LengthPercentage), VendorPrefix },
    @"border-top-right-radius": struct { Size2D(LengthPercentage), VendorPrefix },
    @"border-bottom-left-radius": struct { Size2D(LengthPercentage), VendorPrefix },
    @"border-bottom-right-radius": struct { Size2D(LengthPercentage), VendorPrefix },
    @"border-start-start-radius": Size2D(LengthPercentage),
    @"border-start-end-radius": Size2D(LengthPercentage),
    @"border-end-start-radius": Size2D(LengthPercentage),
    @"border-end-end-radius": Size2D(LengthPercentage),
    @"border-radius": struct { BorderRadius, VendorPrefix },
    @"border-image-source": Image,
    @"border-image-outset": Rect(LengthOrNumber),
    @"border-image-repeat": BorderImageRepeat,
    @"border-image-width": Rect(BorderImageSideWidth),
    @"border-image-slice": BorderImageSlice,
    @"border-image": struct { BorderImage, VendorPrefix },
    @"border-color": BorderColor,
    @"border-style": BorderStyle,
    @"border-width": BorderWidth,
    @"border-block-color": BorderBlockColor,
    @"border-block-style": BorderBlockStyle,
    @"border-block-width": BorderBlockWidth,
    @"border-inline-color": BorderInlineColor,
    @"border-inline-style": BorderInlineStyle,
    @"border-inline-width": BorderInlineWidth,
    border: Border,
    @"border-top": BorderTop,
    @"border-bottom": BorderBottom,
    @"border-left": BorderLeft,
    @"border-right": BorderRight,
    @"border-block": BorderBlock,
    @"border-block-start": BorderBlockStart,
    @"border-block-end": BorderBlockEnd,
    @"border-inline": BorderInline,
    @"border-inline-start": BorderInlineStart,
    @"border-inline-end": BorderInlineEnd,
    outline: Outline,
    @"outline-color": CssColor,
    @"outline-style": OutlineStyle,
    @"outline-width": BorderSideWidth,
    @"flex-direction": struct { FlexDirection, VendorPrefix },
    @"flex-wrap": struct { FlexWrap, VendorPrefix },
    @"flex-flow": struct { FlexFlow, VendorPrefix },
    @"flex-grow": struct { CSSNumber, VendorPrefix },
    @"flex-shrink": struct { CSSNumber, VendorPrefix },
    @"flex-basis": struct { LengthPercentageOrAuto, VendorPrefix },
    flex: struct { Flex, VendorPrefix },
    order: struct { CSSInteger, VendorPrefix },
    @"align-content": struct { AlignContent, VendorPrefix },
    @"justify-content": struct { JustifyContent, VendorPrefix },
    @"place-content": PlaceContent,
    @"align-self": struct { AlignSelf, VendorPrefix },
    @"justify-self": JustifySelf,
    @"place-self": PlaceSelf,
    @"align-items": struct { AlignItems, VendorPrefix },
    @"justify-items": JustifyItems,
    @"place-items": PlaceItems,
    @"row-gap": GapValue,
    @"column-gap": GapValue,
    gap: Gap,
    @"box-orient": struct { BoxOrient, VendorPrefix },
    @"box-direction": struct { BoxDirection, VendorPrefix },
    @"box-ordinal-group": struct { CSSInteger, VendorPrefix },
    @"box-align": struct { BoxAlign, VendorPrefix },
    @"box-flex": struct { CSSNumber, VendorPrefix },
    @"box-flex-group": struct { CSSInteger, VendorPrefix },
    @"box-pack": struct { BoxPack, VendorPrefix },
    @"box-lines": struct { BoxLines, VendorPrefix },
    @"flex-pack": struct { FlexPack, VendorPrefix },
    @"flex-order": struct { CSSInteger, VendorPrefix },
    @"flex-align": struct { BoxAlign, VendorPrefix },
    @"flex-item-align": struct { FlexItemAlign, VendorPrefix },
    @"flex-line-pack": struct { FlexLinePack, VendorPrefix },
    @"flex-positive": struct { CSSNumber, VendorPrefix },
    @"flex-negative": struct { CSSNumber, VendorPrefix },
    @"flex-preferred-size": struct { LengthPercentageOrAuto, VendorPrefix },
    @"margin-top": LengthPercentageOrAuto,
    @"margin-bottom": LengthPercentageOrAuto,
    @"margin-left": LengthPercentageOrAuto,
    @"margin-right": LengthPercentageOrAuto,
    @"margin-block-start": LengthPercentageOrAuto,
    @"margin-block-end": LengthPercentageOrAuto,
    @"margin-inline-start": LengthPercentageOrAuto,
    @"margin-inline-end": LengthPercentageOrAuto,
    @"margin-block": MarginBlock,
    @"margin-inline": MarginInline,
    margin: Margin,
    @"padding-top": LengthPercentageOrAuto,
    @"padding-bottom": LengthPercentageOrAuto,
    @"padding-left": LengthPercentageOrAuto,
    @"padding-right": LengthPercentageOrAuto,
    @"padding-block-start": LengthPercentageOrAuto,
    @"padding-block-end": LengthPercentageOrAuto,
    @"padding-inline-start": LengthPercentageOrAuto,
    @"padding-inline-end": LengthPercentageOrAuto,
    @"padding-block": PaddingBlock,
    @"padding-inline": PaddingInline,
    padding: Padding,
    @"scroll-margin-top": LengthPercentageOrAuto,
    @"scroll-margin-bottom": LengthPercentageOrAuto,
    @"scroll-margin-left": LengthPercentageOrAuto,
    @"scroll-margin-right": LengthPercentageOrAuto,
    @"scroll-margin-block-start": LengthPercentageOrAuto,
    @"scroll-margin-block-end": LengthPercentageOrAuto,
    @"scroll-margin-inline-start": LengthPercentageOrAuto,
    @"scroll-margin-inline-end": LengthPercentageOrAuto,
    @"scroll-margin-block": ScrollMarginBlock,
    @"scroll-margin-inline": ScrollMarginInline,
    @"scroll-margin": ScrollMargin,
    @"scroll-padding-top": LengthPercentageOrAuto,
    @"scroll-padding-bottom": LengthPercentageOrAuto,
    @"scroll-padding-left": LengthPercentageOrAuto,
    @"scroll-padding-right": LengthPercentageOrAuto,
    @"scroll-padding-block-start": LengthPercentageOrAuto,
    @"scroll-padding-block-end": LengthPercentageOrAuto,
    @"scroll-padding-inline-start": LengthPercentageOrAuto,
    @"scroll-padding-inline-end": LengthPercentageOrAuto,
    @"scroll-padding-block": ScrollPaddingBlock,
    @"scroll-padding-inline": ScrollPaddingInline,
    @"scroll-padding": ScrollPadding,
    @"font-weight": FontWeight,
    @"font-size": FontSize,
    @"font-stretch": FontStretch,
    @"font-family": BabyList(FontFamily),
    @"font-style": FontStyle,
    @"font-variant-caps": FontVariantCaps,
    @"line-height": LineHeight,
    font: Font,
    @"text-decoration-color": struct { CssColor, VendorPrefix },
    @"text-emphasis-color": struct { CssColor, VendorPrefix },
    @"text-shadow": SmallList(TextShadow, 1),
    direction: Direction,
    composes: Composes,
    @"mask-image": struct { SmallList(Image, 1), VendorPrefix },
    @"mask-mode": SmallList(MaskMode, 1),
    @"mask-repeat": struct { SmallList(BackgroundRepeat, 1), VendorPrefix },
    @"mask-position-x": SmallList(HorizontalPosition, 1),
    @"mask-position-y": SmallList(VerticalPosition, 1),
    @"mask-position": struct { SmallList(Position, 1), VendorPrefix },
    @"mask-clip": struct { SmallList(MaskClip, 1), VendorPrefix },
    @"mask-origin": struct { SmallList(GeometryBox, 1), VendorPrefix },
    @"mask-size": struct { SmallList(BackgroundSize, 1), VendorPrefix },
    @"mask-composite": SmallList(MaskComposite, 1),
    @"mask-type": MaskType,
    mask: struct { SmallList(Mask, 1), VendorPrefix },
    @"mask-border-source": Image,
    @"mask-border-mode": MaskBorderMode,
    @"mask-border-slice": BorderImageSlice,
    @"mask-border-width": Rect(BorderImageSideWidth),
    @"mask-border-outset": Rect(LengthOrNumber),
    @"mask-border-repeat": BorderImageRepeat,
    @"mask-border": MaskBorder,
    @"-webkit-mask-composite": SmallList(WebKitMaskComposite, 1),
    @"mask-source-type": struct { SmallList(WebKitMaskSourceType, 1), VendorPrefix },
    @"mask-box-image": struct { BorderImage, VendorPrefix },
    @"mask-box-image-source": struct { Image, VendorPrefix },
    @"mask-box-image-slice": struct { BorderImageSlice, VendorPrefix },
    @"mask-box-image-width": struct { Rect(BorderImageSideWidth), VendorPrefix },
    @"mask-box-image-outset": struct { Rect(LengthOrNumber), VendorPrefix },
    @"mask-box-image-repeat": struct { BorderImageRepeat, VendorPrefix },
    all: CSSWideKeyword,
    unparsed: UnparsedProperty,
    custom: CustomProperty,

    pub usingnamespace PropertyImpl();

    // Sanity check to make sure all types have the following functions:
    // - deepClone()
    // - eql()
    // - parse()
    // - toCss()
    //
    // We do this string concatenation thing so we get all the errors at once,
    // instead of relying on Zig semantic analysis which usualy stops at the first error.
    comptime {
        const compile_error: []const u8 = compile_error: {
            var compile_error: []const u8 = "";

            if (!@hasDecl(CssColor, "deepClone")) {
                compile_error = compile_error ++ @typeName(CssColor) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(CssColor, "parse")) {
                compile_error = compile_error ++ @typeName(CssColor) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(CssColor, "toCss")) {
                compile_error = compile_error ++ @typeName(CssColor) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(CssColor, "eql")) {
                compile_error = compile_error ++ @typeName(CssColor) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(SmallList(Image, 1), "deepClone")) {
                compile_error = compile_error ++ @typeName(SmallList(Image, 1)) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(SmallList(Image, 1), "parse")) {
                compile_error = compile_error ++ @typeName(SmallList(Image, 1)) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(SmallList(Image, 1), "toCss")) {
                compile_error = compile_error ++ @typeName(SmallList(Image, 1)) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(SmallList(Image, 1), "eql")) {
                compile_error = compile_error ++ @typeName(SmallList(Image, 1)) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(SmallList(css_values.position.HorizontalPosition, 1), "deepClone")) {
                compile_error = compile_error ++ @typeName(SmallList(css_values.position.HorizontalPosition, 1)) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(SmallList(css_values.position.HorizontalPosition, 1), "parse")) {
                compile_error = compile_error ++ @typeName(SmallList(css_values.position.HorizontalPosition, 1)) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(SmallList(css_values.position.HorizontalPosition, 1), "toCss")) {
                compile_error = compile_error ++ @typeName(SmallList(css_values.position.HorizontalPosition, 1)) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(SmallList(css_values.position.HorizontalPosition, 1), "eql")) {
                compile_error = compile_error ++ @typeName(SmallList(css_values.position.HorizontalPosition, 1)) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(SmallList(css_values.position.VerticalPosition, 1), "deepClone")) {
                compile_error = compile_error ++ @typeName(SmallList(css_values.position.VerticalPosition, 1)) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(SmallList(css_values.position.VerticalPosition, 1), "parse")) {
                compile_error = compile_error ++ @typeName(SmallList(css_values.position.VerticalPosition, 1)) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(SmallList(css_values.position.VerticalPosition, 1), "toCss")) {
                compile_error = compile_error ++ @typeName(SmallList(css_values.position.VerticalPosition, 1)) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(SmallList(css_values.position.VerticalPosition, 1), "eql")) {
                compile_error = compile_error ++ @typeName(SmallList(css_values.position.VerticalPosition, 1)) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(SmallList(background.BackgroundPosition, 1), "deepClone")) {
                compile_error = compile_error ++ @typeName(SmallList(background.BackgroundPosition, 1)) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(SmallList(background.BackgroundPosition, 1), "parse")) {
                compile_error = compile_error ++ @typeName(SmallList(background.BackgroundPosition, 1)) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(SmallList(background.BackgroundPosition, 1), "toCss")) {
                compile_error = compile_error ++ @typeName(SmallList(background.BackgroundPosition, 1)) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(SmallList(background.BackgroundPosition, 1), "eql")) {
                compile_error = compile_error ++ @typeName(SmallList(background.BackgroundPosition, 1)) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(SmallList(background.BackgroundSize, 1), "deepClone")) {
                compile_error = compile_error ++ @typeName(SmallList(background.BackgroundSize, 1)) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(SmallList(background.BackgroundSize, 1), "parse")) {
                compile_error = compile_error ++ @typeName(SmallList(background.BackgroundSize, 1)) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(SmallList(background.BackgroundSize, 1), "toCss")) {
                compile_error = compile_error ++ @typeName(SmallList(background.BackgroundSize, 1)) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(SmallList(background.BackgroundSize, 1), "eql")) {
                compile_error = compile_error ++ @typeName(SmallList(background.BackgroundSize, 1)) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(SmallList(background.BackgroundRepeat, 1), "deepClone")) {
                compile_error = compile_error ++ @typeName(SmallList(background.BackgroundRepeat, 1)) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(SmallList(background.BackgroundRepeat, 1), "parse")) {
                compile_error = compile_error ++ @typeName(SmallList(background.BackgroundRepeat, 1)) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(SmallList(background.BackgroundRepeat, 1), "toCss")) {
                compile_error = compile_error ++ @typeName(SmallList(background.BackgroundRepeat, 1)) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(SmallList(background.BackgroundRepeat, 1), "eql")) {
                compile_error = compile_error ++ @typeName(SmallList(background.BackgroundRepeat, 1)) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(SmallList(background.BackgroundAttachment, 1), "deepClone")) {
                compile_error = compile_error ++ @typeName(SmallList(background.BackgroundAttachment, 1)) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(SmallList(background.BackgroundAttachment, 1), "parse")) {
                compile_error = compile_error ++ @typeName(SmallList(background.BackgroundAttachment, 1)) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(SmallList(background.BackgroundAttachment, 1), "toCss")) {
                compile_error = compile_error ++ @typeName(SmallList(background.BackgroundAttachment, 1)) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(SmallList(background.BackgroundAttachment, 1), "eql")) {
                compile_error = compile_error ++ @typeName(SmallList(background.BackgroundAttachment, 1)) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(SmallList(background.BackgroundClip, 1), "deepClone")) {
                compile_error = compile_error ++ @typeName(SmallList(background.BackgroundClip, 1)) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(SmallList(background.BackgroundClip, 1), "parse")) {
                compile_error = compile_error ++ @typeName(SmallList(background.BackgroundClip, 1)) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(SmallList(background.BackgroundClip, 1), "toCss")) {
                compile_error = compile_error ++ @typeName(SmallList(background.BackgroundClip, 1)) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(SmallList(background.BackgroundClip, 1), "eql")) {
                compile_error = compile_error ++ @typeName(SmallList(background.BackgroundClip, 1)) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(SmallList(background.BackgroundOrigin, 1), "deepClone")) {
                compile_error = compile_error ++ @typeName(SmallList(background.BackgroundOrigin, 1)) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(SmallList(background.BackgroundOrigin, 1), "parse")) {
                compile_error = compile_error ++ @typeName(SmallList(background.BackgroundOrigin, 1)) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(SmallList(background.BackgroundOrigin, 1), "toCss")) {
                compile_error = compile_error ++ @typeName(SmallList(background.BackgroundOrigin, 1)) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(SmallList(background.BackgroundOrigin, 1), "eql")) {
                compile_error = compile_error ++ @typeName(SmallList(background.BackgroundOrigin, 1)) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(SmallList(background.Background, 1), "deepClone")) {
                compile_error = compile_error ++ @typeName(SmallList(background.Background, 1)) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(SmallList(background.Background, 1), "parse")) {
                compile_error = compile_error ++ @typeName(SmallList(background.Background, 1)) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(SmallList(background.Background, 1), "toCss")) {
                compile_error = compile_error ++ @typeName(SmallList(background.Background, 1)) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(SmallList(background.Background, 1), "eql")) {
                compile_error = compile_error ++ @typeName(SmallList(background.Background, 1)) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(SmallList(box_shadow.BoxShadow, 1), "deepClone")) {
                compile_error = compile_error ++ @typeName(SmallList(box_shadow.BoxShadow, 1)) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(SmallList(box_shadow.BoxShadow, 1), "parse")) {
                compile_error = compile_error ++ @typeName(SmallList(box_shadow.BoxShadow, 1)) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(SmallList(box_shadow.BoxShadow, 1), "toCss")) {
                compile_error = compile_error ++ @typeName(SmallList(box_shadow.BoxShadow, 1)) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(SmallList(box_shadow.BoxShadow, 1), "eql")) {
                compile_error = compile_error ++ @typeName(SmallList(box_shadow.BoxShadow, 1)) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(css.css_values.alpha.AlphaValue, "deepClone")) {
                compile_error = compile_error ++ @typeName(css.css_values.alpha.AlphaValue) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(css.css_values.alpha.AlphaValue, "parse")) {
                compile_error = compile_error ++ @typeName(css.css_values.alpha.AlphaValue) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(css.css_values.alpha.AlphaValue, "toCss")) {
                compile_error = compile_error ++ @typeName(css.css_values.alpha.AlphaValue) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(css.css_values.alpha.AlphaValue, "eql")) {
                compile_error = compile_error ++ @typeName(css.css_values.alpha.AlphaValue) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(CssColor, "deepClone")) {
                compile_error = compile_error ++ @typeName(CssColor) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(CssColor, "parse")) {
                compile_error = compile_error ++ @typeName(CssColor) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(CssColor, "toCss")) {
                compile_error = compile_error ++ @typeName(CssColor) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(CssColor, "eql")) {
                compile_error = compile_error ++ @typeName(CssColor) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(display.Display, "deepClone")) {
                compile_error = compile_error ++ @typeName(display.Display) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(display.Display, "parse")) {
                compile_error = compile_error ++ @typeName(display.Display) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(display.Display, "toCss")) {
                compile_error = compile_error ++ @typeName(display.Display) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(display.Display, "eql")) {
                compile_error = compile_error ++ @typeName(display.Display) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(display.Visibility, "deepClone")) {
                compile_error = compile_error ++ @typeName(display.Visibility) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(display.Visibility, "parse")) {
                compile_error = compile_error ++ @typeName(display.Visibility) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(display.Visibility, "toCss")) {
                compile_error = compile_error ++ @typeName(display.Visibility) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(display.Visibility, "eql")) {
                compile_error = compile_error ++ @typeName(display.Visibility) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(size.Size, "deepClone")) {
                compile_error = compile_error ++ @typeName(size.Size) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(size.Size, "parse")) {
                compile_error = compile_error ++ @typeName(size.Size) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(size.Size, "toCss")) {
                compile_error = compile_error ++ @typeName(size.Size) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(size.Size, "eql")) {
                compile_error = compile_error ++ @typeName(size.Size) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(size.Size, "deepClone")) {
                compile_error = compile_error ++ @typeName(size.Size) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(size.Size, "parse")) {
                compile_error = compile_error ++ @typeName(size.Size) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(size.Size, "toCss")) {
                compile_error = compile_error ++ @typeName(size.Size) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(size.Size, "eql")) {
                compile_error = compile_error ++ @typeName(size.Size) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(size.Size, "deepClone")) {
                compile_error = compile_error ++ @typeName(size.Size) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(size.Size, "parse")) {
                compile_error = compile_error ++ @typeName(size.Size) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(size.Size, "toCss")) {
                compile_error = compile_error ++ @typeName(size.Size) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(size.Size, "eql")) {
                compile_error = compile_error ++ @typeName(size.Size) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(size.Size, "deepClone")) {
                compile_error = compile_error ++ @typeName(size.Size) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(size.Size, "parse")) {
                compile_error = compile_error ++ @typeName(size.Size) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(size.Size, "toCss")) {
                compile_error = compile_error ++ @typeName(size.Size) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(size.Size, "eql")) {
                compile_error = compile_error ++ @typeName(size.Size) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(size.MaxSize, "deepClone")) {
                compile_error = compile_error ++ @typeName(size.MaxSize) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(size.MaxSize, "parse")) {
                compile_error = compile_error ++ @typeName(size.MaxSize) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(size.MaxSize, "toCss")) {
                compile_error = compile_error ++ @typeName(size.MaxSize) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(size.MaxSize, "eql")) {
                compile_error = compile_error ++ @typeName(size.MaxSize) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(size.MaxSize, "deepClone")) {
                compile_error = compile_error ++ @typeName(size.MaxSize) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(size.MaxSize, "parse")) {
                compile_error = compile_error ++ @typeName(size.MaxSize) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(size.MaxSize, "toCss")) {
                compile_error = compile_error ++ @typeName(size.MaxSize) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(size.MaxSize, "eql")) {
                compile_error = compile_error ++ @typeName(size.MaxSize) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(size.Size, "deepClone")) {
                compile_error = compile_error ++ @typeName(size.Size) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(size.Size, "parse")) {
                compile_error = compile_error ++ @typeName(size.Size) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(size.Size, "toCss")) {
                compile_error = compile_error ++ @typeName(size.Size) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(size.Size, "eql")) {
                compile_error = compile_error ++ @typeName(size.Size) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(size.Size, "deepClone")) {
                compile_error = compile_error ++ @typeName(size.Size) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(size.Size, "parse")) {
                compile_error = compile_error ++ @typeName(size.Size) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(size.Size, "toCss")) {
                compile_error = compile_error ++ @typeName(size.Size) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(size.Size, "eql")) {
                compile_error = compile_error ++ @typeName(size.Size) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(size.Size, "deepClone")) {
                compile_error = compile_error ++ @typeName(size.Size) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(size.Size, "parse")) {
                compile_error = compile_error ++ @typeName(size.Size) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(size.Size, "toCss")) {
                compile_error = compile_error ++ @typeName(size.Size) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(size.Size, "eql")) {
                compile_error = compile_error ++ @typeName(size.Size) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(size.Size, "deepClone")) {
                compile_error = compile_error ++ @typeName(size.Size) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(size.Size, "parse")) {
                compile_error = compile_error ++ @typeName(size.Size) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(size.Size, "toCss")) {
                compile_error = compile_error ++ @typeName(size.Size) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(size.Size, "eql")) {
                compile_error = compile_error ++ @typeName(size.Size) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(size.MaxSize, "deepClone")) {
                compile_error = compile_error ++ @typeName(size.MaxSize) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(size.MaxSize, "parse")) {
                compile_error = compile_error ++ @typeName(size.MaxSize) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(size.MaxSize, "toCss")) {
                compile_error = compile_error ++ @typeName(size.MaxSize) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(size.MaxSize, "eql")) {
                compile_error = compile_error ++ @typeName(size.MaxSize) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(size.MaxSize, "deepClone")) {
                compile_error = compile_error ++ @typeName(size.MaxSize) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(size.MaxSize, "parse")) {
                compile_error = compile_error ++ @typeName(size.MaxSize) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(size.MaxSize, "toCss")) {
                compile_error = compile_error ++ @typeName(size.MaxSize) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(size.MaxSize, "eql")) {
                compile_error = compile_error ++ @typeName(size.MaxSize) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(size.BoxSizing, "deepClone")) {
                compile_error = compile_error ++ @typeName(size.BoxSizing) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(size.BoxSizing, "parse")) {
                compile_error = compile_error ++ @typeName(size.BoxSizing) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(size.BoxSizing, "toCss")) {
                compile_error = compile_error ++ @typeName(size.BoxSizing) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(size.BoxSizing, "eql")) {
                compile_error = compile_error ++ @typeName(size.BoxSizing) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(size.AspectRatio, "deepClone")) {
                compile_error = compile_error ++ @typeName(size.AspectRatio) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(size.AspectRatio, "parse")) {
                compile_error = compile_error ++ @typeName(size.AspectRatio) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(size.AspectRatio, "toCss")) {
                compile_error = compile_error ++ @typeName(size.AspectRatio) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(size.AspectRatio, "eql")) {
                compile_error = compile_error ++ @typeName(size.AspectRatio) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(overflow.Overflow, "deepClone")) {
                compile_error = compile_error ++ @typeName(overflow.Overflow) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(overflow.Overflow, "parse")) {
                compile_error = compile_error ++ @typeName(overflow.Overflow) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(overflow.Overflow, "toCss")) {
                compile_error = compile_error ++ @typeName(overflow.Overflow) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(overflow.Overflow, "eql")) {
                compile_error = compile_error ++ @typeName(overflow.Overflow) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(overflow.OverflowKeyword, "deepClone")) {
                compile_error = compile_error ++ @typeName(overflow.OverflowKeyword) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(overflow.OverflowKeyword, "parse")) {
                compile_error = compile_error ++ @typeName(overflow.OverflowKeyword) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(overflow.OverflowKeyword, "toCss")) {
                compile_error = compile_error ++ @typeName(overflow.OverflowKeyword) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(overflow.OverflowKeyword, "eql")) {
                compile_error = compile_error ++ @typeName(overflow.OverflowKeyword) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(overflow.OverflowKeyword, "deepClone")) {
                compile_error = compile_error ++ @typeName(overflow.OverflowKeyword) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(overflow.OverflowKeyword, "parse")) {
                compile_error = compile_error ++ @typeName(overflow.OverflowKeyword) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(overflow.OverflowKeyword, "toCss")) {
                compile_error = compile_error ++ @typeName(overflow.OverflowKeyword) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(overflow.OverflowKeyword, "eql")) {
                compile_error = compile_error ++ @typeName(overflow.OverflowKeyword) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(overflow.TextOverflow, "deepClone")) {
                compile_error = compile_error ++ @typeName(overflow.TextOverflow) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(overflow.TextOverflow, "parse")) {
                compile_error = compile_error ++ @typeName(overflow.TextOverflow) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(overflow.TextOverflow, "toCss")) {
                compile_error = compile_error ++ @typeName(overflow.TextOverflow) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(overflow.TextOverflow, "eql")) {
                compile_error = compile_error ++ @typeName(overflow.TextOverflow) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(position.Position, "deepClone")) {
                compile_error = compile_error ++ @typeName(position.Position) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(position.Position, "parse")) {
                compile_error = compile_error ++ @typeName(position.Position) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(position.Position, "toCss")) {
                compile_error = compile_error ++ @typeName(position.Position) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(position.Position, "eql")) {
                compile_error = compile_error ++ @typeName(position.Position) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "deepClone")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "parse")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "toCss")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "eql")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "deepClone")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "parse")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "toCss")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "eql")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "deepClone")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "parse")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "toCss")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "eql")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "deepClone")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "parse")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "toCss")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "eql")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "deepClone")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "parse")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "toCss")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "eql")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "deepClone")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "parse")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "toCss")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "eql")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "deepClone")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "parse")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "toCss")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "eql")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "deepClone")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "parse")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "toCss")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "eql")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(margin_padding.InsetBlock, "deepClone")) {
                compile_error = compile_error ++ @typeName(margin_padding.InsetBlock) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(margin_padding.InsetBlock, "parse")) {
                compile_error = compile_error ++ @typeName(margin_padding.InsetBlock) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(margin_padding.InsetBlock, "toCss")) {
                compile_error = compile_error ++ @typeName(margin_padding.InsetBlock) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(margin_padding.InsetBlock, "eql")) {
                compile_error = compile_error ++ @typeName(margin_padding.InsetBlock) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(margin_padding.InsetInline, "deepClone")) {
                compile_error = compile_error ++ @typeName(margin_padding.InsetInline) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(margin_padding.InsetInline, "parse")) {
                compile_error = compile_error ++ @typeName(margin_padding.InsetInline) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(margin_padding.InsetInline, "toCss")) {
                compile_error = compile_error ++ @typeName(margin_padding.InsetInline) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(margin_padding.InsetInline, "eql")) {
                compile_error = compile_error ++ @typeName(margin_padding.InsetInline) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(margin_padding.Inset, "deepClone")) {
                compile_error = compile_error ++ @typeName(margin_padding.Inset) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(margin_padding.Inset, "parse")) {
                compile_error = compile_error ++ @typeName(margin_padding.Inset) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(margin_padding.Inset, "toCss")) {
                compile_error = compile_error ++ @typeName(margin_padding.Inset) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(margin_padding.Inset, "eql")) {
                compile_error = compile_error ++ @typeName(margin_padding.Inset) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(css.css_values.size.Size2D(Length), "deepClone")) {
                compile_error = compile_error ++ @typeName(css.css_values.size.Size2D(Length)) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(css.css_values.size.Size2D(Length), "parse")) {
                compile_error = compile_error ++ @typeName(css.css_values.size.Size2D(Length)) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(css.css_values.size.Size2D(Length), "toCss")) {
                compile_error = compile_error ++ @typeName(css.css_values.size.Size2D(Length)) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(css.css_values.size.Size2D(Length), "eql")) {
                compile_error = compile_error ++ @typeName(css.css_values.size.Size2D(Length)) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(CssColor, "deepClone")) {
                compile_error = compile_error ++ @typeName(CssColor) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(CssColor, "parse")) {
                compile_error = compile_error ++ @typeName(CssColor) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(CssColor, "toCss")) {
                compile_error = compile_error ++ @typeName(CssColor) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(CssColor, "eql")) {
                compile_error = compile_error ++ @typeName(CssColor) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(CssColor, "deepClone")) {
                compile_error = compile_error ++ @typeName(CssColor) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(CssColor, "parse")) {
                compile_error = compile_error ++ @typeName(CssColor) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(CssColor, "toCss")) {
                compile_error = compile_error ++ @typeName(CssColor) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(CssColor, "eql")) {
                compile_error = compile_error ++ @typeName(CssColor) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(CssColor, "deepClone")) {
                compile_error = compile_error ++ @typeName(CssColor) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(CssColor, "parse")) {
                compile_error = compile_error ++ @typeName(CssColor) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(CssColor, "toCss")) {
                compile_error = compile_error ++ @typeName(CssColor) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(CssColor, "eql")) {
                compile_error = compile_error ++ @typeName(CssColor) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(CssColor, "deepClone")) {
                compile_error = compile_error ++ @typeName(CssColor) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(CssColor, "parse")) {
                compile_error = compile_error ++ @typeName(CssColor) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(CssColor, "toCss")) {
                compile_error = compile_error ++ @typeName(CssColor) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(CssColor, "eql")) {
                compile_error = compile_error ++ @typeName(CssColor) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(CssColor, "deepClone")) {
                compile_error = compile_error ++ @typeName(CssColor) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(CssColor, "parse")) {
                compile_error = compile_error ++ @typeName(CssColor) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(CssColor, "toCss")) {
                compile_error = compile_error ++ @typeName(CssColor) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(CssColor, "eql")) {
                compile_error = compile_error ++ @typeName(CssColor) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(CssColor, "deepClone")) {
                compile_error = compile_error ++ @typeName(CssColor) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(CssColor, "parse")) {
                compile_error = compile_error ++ @typeName(CssColor) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(CssColor, "toCss")) {
                compile_error = compile_error ++ @typeName(CssColor) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(CssColor, "eql")) {
                compile_error = compile_error ++ @typeName(CssColor) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(CssColor, "deepClone")) {
                compile_error = compile_error ++ @typeName(CssColor) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(CssColor, "parse")) {
                compile_error = compile_error ++ @typeName(CssColor) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(CssColor, "toCss")) {
                compile_error = compile_error ++ @typeName(CssColor) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(CssColor, "eql")) {
                compile_error = compile_error ++ @typeName(CssColor) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(CssColor, "deepClone")) {
                compile_error = compile_error ++ @typeName(CssColor) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(CssColor, "parse")) {
                compile_error = compile_error ++ @typeName(CssColor) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(CssColor, "toCss")) {
                compile_error = compile_error ++ @typeName(CssColor) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(CssColor, "eql")) {
                compile_error = compile_error ++ @typeName(CssColor) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(border.LineStyle, "deepClone")) {
                compile_error = compile_error ++ @typeName(border.LineStyle) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(border.LineStyle, "parse")) {
                compile_error = compile_error ++ @typeName(border.LineStyle) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(border.LineStyle, "toCss")) {
                compile_error = compile_error ++ @typeName(border.LineStyle) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(border.LineStyle, "eql")) {
                compile_error = compile_error ++ @typeName(border.LineStyle) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(border.LineStyle, "deepClone")) {
                compile_error = compile_error ++ @typeName(border.LineStyle) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(border.LineStyle, "parse")) {
                compile_error = compile_error ++ @typeName(border.LineStyle) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(border.LineStyle, "toCss")) {
                compile_error = compile_error ++ @typeName(border.LineStyle) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(border.LineStyle, "eql")) {
                compile_error = compile_error ++ @typeName(border.LineStyle) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(border.LineStyle, "deepClone")) {
                compile_error = compile_error ++ @typeName(border.LineStyle) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(border.LineStyle, "parse")) {
                compile_error = compile_error ++ @typeName(border.LineStyle) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(border.LineStyle, "toCss")) {
                compile_error = compile_error ++ @typeName(border.LineStyle) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(border.LineStyle, "eql")) {
                compile_error = compile_error ++ @typeName(border.LineStyle) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(border.LineStyle, "deepClone")) {
                compile_error = compile_error ++ @typeName(border.LineStyle) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(border.LineStyle, "parse")) {
                compile_error = compile_error ++ @typeName(border.LineStyle) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(border.LineStyle, "toCss")) {
                compile_error = compile_error ++ @typeName(border.LineStyle) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(border.LineStyle, "eql")) {
                compile_error = compile_error ++ @typeName(border.LineStyle) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(border.LineStyle, "deepClone")) {
                compile_error = compile_error ++ @typeName(border.LineStyle) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(border.LineStyle, "parse")) {
                compile_error = compile_error ++ @typeName(border.LineStyle) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(border.LineStyle, "toCss")) {
                compile_error = compile_error ++ @typeName(border.LineStyle) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(border.LineStyle, "eql")) {
                compile_error = compile_error ++ @typeName(border.LineStyle) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(border.LineStyle, "deepClone")) {
                compile_error = compile_error ++ @typeName(border.LineStyle) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(border.LineStyle, "parse")) {
                compile_error = compile_error ++ @typeName(border.LineStyle) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(border.LineStyle, "toCss")) {
                compile_error = compile_error ++ @typeName(border.LineStyle) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(border.LineStyle, "eql")) {
                compile_error = compile_error ++ @typeName(border.LineStyle) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(border.LineStyle, "deepClone")) {
                compile_error = compile_error ++ @typeName(border.LineStyle) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(border.LineStyle, "parse")) {
                compile_error = compile_error ++ @typeName(border.LineStyle) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(border.LineStyle, "toCss")) {
                compile_error = compile_error ++ @typeName(border.LineStyle) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(border.LineStyle, "eql")) {
                compile_error = compile_error ++ @typeName(border.LineStyle) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(border.LineStyle, "deepClone")) {
                compile_error = compile_error ++ @typeName(border.LineStyle) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(border.LineStyle, "parse")) {
                compile_error = compile_error ++ @typeName(border.LineStyle) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(border.LineStyle, "toCss")) {
                compile_error = compile_error ++ @typeName(border.LineStyle) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(border.LineStyle, "eql")) {
                compile_error = compile_error ++ @typeName(border.LineStyle) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(BorderSideWidth, "deepClone")) {
                compile_error = compile_error ++ @typeName(BorderSideWidth) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(BorderSideWidth, "parse")) {
                compile_error = compile_error ++ @typeName(BorderSideWidth) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(BorderSideWidth, "toCss")) {
                compile_error = compile_error ++ @typeName(BorderSideWidth) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(BorderSideWidth, "eql")) {
                compile_error = compile_error ++ @typeName(BorderSideWidth) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(BorderSideWidth, "deepClone")) {
                compile_error = compile_error ++ @typeName(BorderSideWidth) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(BorderSideWidth, "parse")) {
                compile_error = compile_error ++ @typeName(BorderSideWidth) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(BorderSideWidth, "toCss")) {
                compile_error = compile_error ++ @typeName(BorderSideWidth) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(BorderSideWidth, "eql")) {
                compile_error = compile_error ++ @typeName(BorderSideWidth) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(BorderSideWidth, "deepClone")) {
                compile_error = compile_error ++ @typeName(BorderSideWidth) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(BorderSideWidth, "parse")) {
                compile_error = compile_error ++ @typeName(BorderSideWidth) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(BorderSideWidth, "toCss")) {
                compile_error = compile_error ++ @typeName(BorderSideWidth) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(BorderSideWidth, "eql")) {
                compile_error = compile_error ++ @typeName(BorderSideWidth) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(BorderSideWidth, "deepClone")) {
                compile_error = compile_error ++ @typeName(BorderSideWidth) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(BorderSideWidth, "parse")) {
                compile_error = compile_error ++ @typeName(BorderSideWidth) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(BorderSideWidth, "toCss")) {
                compile_error = compile_error ++ @typeName(BorderSideWidth) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(BorderSideWidth, "eql")) {
                compile_error = compile_error ++ @typeName(BorderSideWidth) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(BorderSideWidth, "deepClone")) {
                compile_error = compile_error ++ @typeName(BorderSideWidth) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(BorderSideWidth, "parse")) {
                compile_error = compile_error ++ @typeName(BorderSideWidth) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(BorderSideWidth, "toCss")) {
                compile_error = compile_error ++ @typeName(BorderSideWidth) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(BorderSideWidth, "eql")) {
                compile_error = compile_error ++ @typeName(BorderSideWidth) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(BorderSideWidth, "deepClone")) {
                compile_error = compile_error ++ @typeName(BorderSideWidth) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(BorderSideWidth, "parse")) {
                compile_error = compile_error ++ @typeName(BorderSideWidth) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(BorderSideWidth, "toCss")) {
                compile_error = compile_error ++ @typeName(BorderSideWidth) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(BorderSideWidth, "eql")) {
                compile_error = compile_error ++ @typeName(BorderSideWidth) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(BorderSideWidth, "deepClone")) {
                compile_error = compile_error ++ @typeName(BorderSideWidth) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(BorderSideWidth, "parse")) {
                compile_error = compile_error ++ @typeName(BorderSideWidth) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(BorderSideWidth, "toCss")) {
                compile_error = compile_error ++ @typeName(BorderSideWidth) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(BorderSideWidth, "eql")) {
                compile_error = compile_error ++ @typeName(BorderSideWidth) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(BorderSideWidth, "deepClone")) {
                compile_error = compile_error ++ @typeName(BorderSideWidth) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(BorderSideWidth, "parse")) {
                compile_error = compile_error ++ @typeName(BorderSideWidth) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(BorderSideWidth, "toCss")) {
                compile_error = compile_error ++ @typeName(BorderSideWidth) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(BorderSideWidth, "eql")) {
                compile_error = compile_error ++ @typeName(BorderSideWidth) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(Size2D(LengthPercentage), "deepClone")) {
                compile_error = compile_error ++ @typeName(Size2D(LengthPercentage)) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(Size2D(LengthPercentage), "parse")) {
                compile_error = compile_error ++ @typeName(Size2D(LengthPercentage)) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(Size2D(LengthPercentage), "toCss")) {
                compile_error = compile_error ++ @typeName(Size2D(LengthPercentage)) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(Size2D(LengthPercentage), "eql")) {
                compile_error = compile_error ++ @typeName(Size2D(LengthPercentage)) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(Size2D(LengthPercentage), "deepClone")) {
                compile_error = compile_error ++ @typeName(Size2D(LengthPercentage)) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(Size2D(LengthPercentage), "parse")) {
                compile_error = compile_error ++ @typeName(Size2D(LengthPercentage)) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(Size2D(LengthPercentage), "toCss")) {
                compile_error = compile_error ++ @typeName(Size2D(LengthPercentage)) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(Size2D(LengthPercentage), "eql")) {
                compile_error = compile_error ++ @typeName(Size2D(LengthPercentage)) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(Size2D(LengthPercentage), "deepClone")) {
                compile_error = compile_error ++ @typeName(Size2D(LengthPercentage)) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(Size2D(LengthPercentage), "parse")) {
                compile_error = compile_error ++ @typeName(Size2D(LengthPercentage)) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(Size2D(LengthPercentage), "toCss")) {
                compile_error = compile_error ++ @typeName(Size2D(LengthPercentage)) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(Size2D(LengthPercentage), "eql")) {
                compile_error = compile_error ++ @typeName(Size2D(LengthPercentage)) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(Size2D(LengthPercentage), "deepClone")) {
                compile_error = compile_error ++ @typeName(Size2D(LengthPercentage)) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(Size2D(LengthPercentage), "parse")) {
                compile_error = compile_error ++ @typeName(Size2D(LengthPercentage)) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(Size2D(LengthPercentage), "toCss")) {
                compile_error = compile_error ++ @typeName(Size2D(LengthPercentage)) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(Size2D(LengthPercentage), "eql")) {
                compile_error = compile_error ++ @typeName(Size2D(LengthPercentage)) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(Size2D(LengthPercentage), "deepClone")) {
                compile_error = compile_error ++ @typeName(Size2D(LengthPercentage)) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(Size2D(LengthPercentage), "parse")) {
                compile_error = compile_error ++ @typeName(Size2D(LengthPercentage)) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(Size2D(LengthPercentage), "toCss")) {
                compile_error = compile_error ++ @typeName(Size2D(LengthPercentage)) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(Size2D(LengthPercentage), "eql")) {
                compile_error = compile_error ++ @typeName(Size2D(LengthPercentage)) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(Size2D(LengthPercentage), "deepClone")) {
                compile_error = compile_error ++ @typeName(Size2D(LengthPercentage)) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(Size2D(LengthPercentage), "parse")) {
                compile_error = compile_error ++ @typeName(Size2D(LengthPercentage)) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(Size2D(LengthPercentage), "toCss")) {
                compile_error = compile_error ++ @typeName(Size2D(LengthPercentage)) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(Size2D(LengthPercentage), "eql")) {
                compile_error = compile_error ++ @typeName(Size2D(LengthPercentage)) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(Size2D(LengthPercentage), "deepClone")) {
                compile_error = compile_error ++ @typeName(Size2D(LengthPercentage)) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(Size2D(LengthPercentage), "parse")) {
                compile_error = compile_error ++ @typeName(Size2D(LengthPercentage)) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(Size2D(LengthPercentage), "toCss")) {
                compile_error = compile_error ++ @typeName(Size2D(LengthPercentage)) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(Size2D(LengthPercentage), "eql")) {
                compile_error = compile_error ++ @typeName(Size2D(LengthPercentage)) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(Size2D(LengthPercentage), "deepClone")) {
                compile_error = compile_error ++ @typeName(Size2D(LengthPercentage)) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(Size2D(LengthPercentage), "parse")) {
                compile_error = compile_error ++ @typeName(Size2D(LengthPercentage)) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(Size2D(LengthPercentage), "toCss")) {
                compile_error = compile_error ++ @typeName(Size2D(LengthPercentage)) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(Size2D(LengthPercentage), "eql")) {
                compile_error = compile_error ++ @typeName(Size2D(LengthPercentage)) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(BorderRadius, "deepClone")) {
                compile_error = compile_error ++ @typeName(BorderRadius) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(BorderRadius, "parse")) {
                compile_error = compile_error ++ @typeName(BorderRadius) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(BorderRadius, "toCss")) {
                compile_error = compile_error ++ @typeName(BorderRadius) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(BorderRadius, "eql")) {
                compile_error = compile_error ++ @typeName(BorderRadius) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(Image, "deepClone")) {
                compile_error = compile_error ++ @typeName(Image) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(Image, "parse")) {
                compile_error = compile_error ++ @typeName(Image) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(Image, "toCss")) {
                compile_error = compile_error ++ @typeName(Image) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(Image, "eql")) {
                compile_error = compile_error ++ @typeName(Image) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(Rect(LengthOrNumber), "deepClone")) {
                compile_error = compile_error ++ @typeName(Rect(LengthOrNumber)) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(Rect(LengthOrNumber), "parse")) {
                compile_error = compile_error ++ @typeName(Rect(LengthOrNumber)) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(Rect(LengthOrNumber), "toCss")) {
                compile_error = compile_error ++ @typeName(Rect(LengthOrNumber)) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(Rect(LengthOrNumber), "eql")) {
                compile_error = compile_error ++ @typeName(Rect(LengthOrNumber)) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(BorderImageRepeat, "deepClone")) {
                compile_error = compile_error ++ @typeName(BorderImageRepeat) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(BorderImageRepeat, "parse")) {
                compile_error = compile_error ++ @typeName(BorderImageRepeat) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(BorderImageRepeat, "toCss")) {
                compile_error = compile_error ++ @typeName(BorderImageRepeat) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(BorderImageRepeat, "eql")) {
                compile_error = compile_error ++ @typeName(BorderImageRepeat) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(Rect(BorderImageSideWidth), "deepClone")) {
                compile_error = compile_error ++ @typeName(Rect(BorderImageSideWidth)) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(Rect(BorderImageSideWidth), "parse")) {
                compile_error = compile_error ++ @typeName(Rect(BorderImageSideWidth)) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(Rect(BorderImageSideWidth), "toCss")) {
                compile_error = compile_error ++ @typeName(Rect(BorderImageSideWidth)) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(Rect(BorderImageSideWidth), "eql")) {
                compile_error = compile_error ++ @typeName(Rect(BorderImageSideWidth)) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(BorderImageSlice, "deepClone")) {
                compile_error = compile_error ++ @typeName(BorderImageSlice) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(BorderImageSlice, "parse")) {
                compile_error = compile_error ++ @typeName(BorderImageSlice) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(BorderImageSlice, "toCss")) {
                compile_error = compile_error ++ @typeName(BorderImageSlice) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(BorderImageSlice, "eql")) {
                compile_error = compile_error ++ @typeName(BorderImageSlice) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(BorderImage, "deepClone")) {
                compile_error = compile_error ++ @typeName(BorderImage) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(BorderImage, "parse")) {
                compile_error = compile_error ++ @typeName(BorderImage) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(BorderImage, "toCss")) {
                compile_error = compile_error ++ @typeName(BorderImage) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(BorderImage, "eql")) {
                compile_error = compile_error ++ @typeName(BorderImage) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(BorderColor, "deepClone")) {
                compile_error = compile_error ++ @typeName(BorderColor) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(BorderColor, "parse")) {
                compile_error = compile_error ++ @typeName(BorderColor) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(BorderColor, "toCss")) {
                compile_error = compile_error ++ @typeName(BorderColor) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(BorderColor, "eql")) {
                compile_error = compile_error ++ @typeName(BorderColor) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(BorderStyle, "deepClone")) {
                compile_error = compile_error ++ @typeName(BorderStyle) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(BorderStyle, "parse")) {
                compile_error = compile_error ++ @typeName(BorderStyle) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(BorderStyle, "toCss")) {
                compile_error = compile_error ++ @typeName(BorderStyle) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(BorderStyle, "eql")) {
                compile_error = compile_error ++ @typeName(BorderStyle) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(BorderWidth, "deepClone")) {
                compile_error = compile_error ++ @typeName(BorderWidth) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(BorderWidth, "parse")) {
                compile_error = compile_error ++ @typeName(BorderWidth) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(BorderWidth, "toCss")) {
                compile_error = compile_error ++ @typeName(BorderWidth) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(BorderWidth, "eql")) {
                compile_error = compile_error ++ @typeName(BorderWidth) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(BorderBlockColor, "deepClone")) {
                compile_error = compile_error ++ @typeName(BorderBlockColor) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(BorderBlockColor, "parse")) {
                compile_error = compile_error ++ @typeName(BorderBlockColor) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(BorderBlockColor, "toCss")) {
                compile_error = compile_error ++ @typeName(BorderBlockColor) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(BorderBlockColor, "eql")) {
                compile_error = compile_error ++ @typeName(BorderBlockColor) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(BorderBlockStyle, "deepClone")) {
                compile_error = compile_error ++ @typeName(BorderBlockStyle) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(BorderBlockStyle, "parse")) {
                compile_error = compile_error ++ @typeName(BorderBlockStyle) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(BorderBlockStyle, "toCss")) {
                compile_error = compile_error ++ @typeName(BorderBlockStyle) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(BorderBlockStyle, "eql")) {
                compile_error = compile_error ++ @typeName(BorderBlockStyle) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(BorderBlockWidth, "deepClone")) {
                compile_error = compile_error ++ @typeName(BorderBlockWidth) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(BorderBlockWidth, "parse")) {
                compile_error = compile_error ++ @typeName(BorderBlockWidth) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(BorderBlockWidth, "toCss")) {
                compile_error = compile_error ++ @typeName(BorderBlockWidth) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(BorderBlockWidth, "eql")) {
                compile_error = compile_error ++ @typeName(BorderBlockWidth) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(BorderInlineColor, "deepClone")) {
                compile_error = compile_error ++ @typeName(BorderInlineColor) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(BorderInlineColor, "parse")) {
                compile_error = compile_error ++ @typeName(BorderInlineColor) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(BorderInlineColor, "toCss")) {
                compile_error = compile_error ++ @typeName(BorderInlineColor) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(BorderInlineColor, "eql")) {
                compile_error = compile_error ++ @typeName(BorderInlineColor) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(BorderInlineStyle, "deepClone")) {
                compile_error = compile_error ++ @typeName(BorderInlineStyle) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(BorderInlineStyle, "parse")) {
                compile_error = compile_error ++ @typeName(BorderInlineStyle) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(BorderInlineStyle, "toCss")) {
                compile_error = compile_error ++ @typeName(BorderInlineStyle) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(BorderInlineStyle, "eql")) {
                compile_error = compile_error ++ @typeName(BorderInlineStyle) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(BorderInlineWidth, "deepClone")) {
                compile_error = compile_error ++ @typeName(BorderInlineWidth) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(BorderInlineWidth, "parse")) {
                compile_error = compile_error ++ @typeName(BorderInlineWidth) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(BorderInlineWidth, "toCss")) {
                compile_error = compile_error ++ @typeName(BorderInlineWidth) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(BorderInlineWidth, "eql")) {
                compile_error = compile_error ++ @typeName(BorderInlineWidth) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(Border, "deepClone")) {
                compile_error = compile_error ++ @typeName(Border) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(Border, "parse")) {
                compile_error = compile_error ++ @typeName(Border) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(Border, "toCss")) {
                compile_error = compile_error ++ @typeName(Border) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(Border, "eql")) {
                compile_error = compile_error ++ @typeName(Border) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(BorderTop, "deepClone")) {
                compile_error = compile_error ++ @typeName(BorderTop) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(BorderTop, "parse")) {
                compile_error = compile_error ++ @typeName(BorderTop) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(BorderTop, "toCss")) {
                compile_error = compile_error ++ @typeName(BorderTop) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(BorderTop, "eql")) {
                compile_error = compile_error ++ @typeName(BorderTop) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(BorderBottom, "deepClone")) {
                compile_error = compile_error ++ @typeName(BorderBottom) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(BorderBottom, "parse")) {
                compile_error = compile_error ++ @typeName(BorderBottom) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(BorderBottom, "toCss")) {
                compile_error = compile_error ++ @typeName(BorderBottom) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(BorderBottom, "eql")) {
                compile_error = compile_error ++ @typeName(BorderBottom) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(BorderLeft, "deepClone")) {
                compile_error = compile_error ++ @typeName(BorderLeft) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(BorderLeft, "parse")) {
                compile_error = compile_error ++ @typeName(BorderLeft) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(BorderLeft, "toCss")) {
                compile_error = compile_error ++ @typeName(BorderLeft) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(BorderLeft, "eql")) {
                compile_error = compile_error ++ @typeName(BorderLeft) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(BorderRight, "deepClone")) {
                compile_error = compile_error ++ @typeName(BorderRight) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(BorderRight, "parse")) {
                compile_error = compile_error ++ @typeName(BorderRight) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(BorderRight, "toCss")) {
                compile_error = compile_error ++ @typeName(BorderRight) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(BorderRight, "eql")) {
                compile_error = compile_error ++ @typeName(BorderRight) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(BorderBlock, "deepClone")) {
                compile_error = compile_error ++ @typeName(BorderBlock) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(BorderBlock, "parse")) {
                compile_error = compile_error ++ @typeName(BorderBlock) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(BorderBlock, "toCss")) {
                compile_error = compile_error ++ @typeName(BorderBlock) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(BorderBlock, "eql")) {
                compile_error = compile_error ++ @typeName(BorderBlock) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(BorderBlockStart, "deepClone")) {
                compile_error = compile_error ++ @typeName(BorderBlockStart) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(BorderBlockStart, "parse")) {
                compile_error = compile_error ++ @typeName(BorderBlockStart) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(BorderBlockStart, "toCss")) {
                compile_error = compile_error ++ @typeName(BorderBlockStart) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(BorderBlockStart, "eql")) {
                compile_error = compile_error ++ @typeName(BorderBlockStart) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(BorderBlockEnd, "deepClone")) {
                compile_error = compile_error ++ @typeName(BorderBlockEnd) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(BorderBlockEnd, "parse")) {
                compile_error = compile_error ++ @typeName(BorderBlockEnd) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(BorderBlockEnd, "toCss")) {
                compile_error = compile_error ++ @typeName(BorderBlockEnd) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(BorderBlockEnd, "eql")) {
                compile_error = compile_error ++ @typeName(BorderBlockEnd) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(BorderInline, "deepClone")) {
                compile_error = compile_error ++ @typeName(BorderInline) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(BorderInline, "parse")) {
                compile_error = compile_error ++ @typeName(BorderInline) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(BorderInline, "toCss")) {
                compile_error = compile_error ++ @typeName(BorderInline) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(BorderInline, "eql")) {
                compile_error = compile_error ++ @typeName(BorderInline) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(BorderInlineStart, "deepClone")) {
                compile_error = compile_error ++ @typeName(BorderInlineStart) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(BorderInlineStart, "parse")) {
                compile_error = compile_error ++ @typeName(BorderInlineStart) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(BorderInlineStart, "toCss")) {
                compile_error = compile_error ++ @typeName(BorderInlineStart) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(BorderInlineStart, "eql")) {
                compile_error = compile_error ++ @typeName(BorderInlineStart) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(BorderInlineEnd, "deepClone")) {
                compile_error = compile_error ++ @typeName(BorderInlineEnd) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(BorderInlineEnd, "parse")) {
                compile_error = compile_error ++ @typeName(BorderInlineEnd) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(BorderInlineEnd, "toCss")) {
                compile_error = compile_error ++ @typeName(BorderInlineEnd) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(BorderInlineEnd, "eql")) {
                compile_error = compile_error ++ @typeName(BorderInlineEnd) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(Outline, "deepClone")) {
                compile_error = compile_error ++ @typeName(Outline) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(Outline, "parse")) {
                compile_error = compile_error ++ @typeName(Outline) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(Outline, "toCss")) {
                compile_error = compile_error ++ @typeName(Outline) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(Outline, "eql")) {
                compile_error = compile_error ++ @typeName(Outline) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(CssColor, "deepClone")) {
                compile_error = compile_error ++ @typeName(CssColor) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(CssColor, "parse")) {
                compile_error = compile_error ++ @typeName(CssColor) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(CssColor, "toCss")) {
                compile_error = compile_error ++ @typeName(CssColor) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(CssColor, "eql")) {
                compile_error = compile_error ++ @typeName(CssColor) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(OutlineStyle, "deepClone")) {
                compile_error = compile_error ++ @typeName(OutlineStyle) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(OutlineStyle, "parse")) {
                compile_error = compile_error ++ @typeName(OutlineStyle) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(OutlineStyle, "toCss")) {
                compile_error = compile_error ++ @typeName(OutlineStyle) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(OutlineStyle, "eql")) {
                compile_error = compile_error ++ @typeName(OutlineStyle) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(BorderSideWidth, "deepClone")) {
                compile_error = compile_error ++ @typeName(BorderSideWidth) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(BorderSideWidth, "parse")) {
                compile_error = compile_error ++ @typeName(BorderSideWidth) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(BorderSideWidth, "toCss")) {
                compile_error = compile_error ++ @typeName(BorderSideWidth) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(BorderSideWidth, "eql")) {
                compile_error = compile_error ++ @typeName(BorderSideWidth) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(FlexDirection, "deepClone")) {
                compile_error = compile_error ++ @typeName(FlexDirection) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(FlexDirection, "parse")) {
                compile_error = compile_error ++ @typeName(FlexDirection) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(FlexDirection, "toCss")) {
                compile_error = compile_error ++ @typeName(FlexDirection) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(FlexDirection, "eql")) {
                compile_error = compile_error ++ @typeName(FlexDirection) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(FlexWrap, "deepClone")) {
                compile_error = compile_error ++ @typeName(FlexWrap) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(FlexWrap, "parse")) {
                compile_error = compile_error ++ @typeName(FlexWrap) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(FlexWrap, "toCss")) {
                compile_error = compile_error ++ @typeName(FlexWrap) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(FlexWrap, "eql")) {
                compile_error = compile_error ++ @typeName(FlexWrap) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(FlexFlow, "deepClone")) {
                compile_error = compile_error ++ @typeName(FlexFlow) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(FlexFlow, "parse")) {
                compile_error = compile_error ++ @typeName(FlexFlow) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(FlexFlow, "toCss")) {
                compile_error = compile_error ++ @typeName(FlexFlow) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(FlexFlow, "eql")) {
                compile_error = compile_error ++ @typeName(FlexFlow) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "deepClone")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "parse")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "toCss")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "eql")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(Flex, "deepClone")) {
                compile_error = compile_error ++ @typeName(Flex) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(Flex, "parse")) {
                compile_error = compile_error ++ @typeName(Flex) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(Flex, "toCss")) {
                compile_error = compile_error ++ @typeName(Flex) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(Flex, "eql")) {
                compile_error = compile_error ++ @typeName(Flex) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(AlignContent, "deepClone")) {
                compile_error = compile_error ++ @typeName(AlignContent) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(AlignContent, "parse")) {
                compile_error = compile_error ++ @typeName(AlignContent) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(AlignContent, "toCss")) {
                compile_error = compile_error ++ @typeName(AlignContent) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(AlignContent, "eql")) {
                compile_error = compile_error ++ @typeName(AlignContent) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(JustifyContent, "deepClone")) {
                compile_error = compile_error ++ @typeName(JustifyContent) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(JustifyContent, "parse")) {
                compile_error = compile_error ++ @typeName(JustifyContent) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(JustifyContent, "toCss")) {
                compile_error = compile_error ++ @typeName(JustifyContent) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(JustifyContent, "eql")) {
                compile_error = compile_error ++ @typeName(JustifyContent) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(PlaceContent, "deepClone")) {
                compile_error = compile_error ++ @typeName(PlaceContent) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(PlaceContent, "parse")) {
                compile_error = compile_error ++ @typeName(PlaceContent) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(PlaceContent, "toCss")) {
                compile_error = compile_error ++ @typeName(PlaceContent) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(PlaceContent, "eql")) {
                compile_error = compile_error ++ @typeName(PlaceContent) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(AlignSelf, "deepClone")) {
                compile_error = compile_error ++ @typeName(AlignSelf) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(AlignSelf, "parse")) {
                compile_error = compile_error ++ @typeName(AlignSelf) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(AlignSelf, "toCss")) {
                compile_error = compile_error ++ @typeName(AlignSelf) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(AlignSelf, "eql")) {
                compile_error = compile_error ++ @typeName(AlignSelf) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(JustifySelf, "deepClone")) {
                compile_error = compile_error ++ @typeName(JustifySelf) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(JustifySelf, "parse")) {
                compile_error = compile_error ++ @typeName(JustifySelf) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(JustifySelf, "toCss")) {
                compile_error = compile_error ++ @typeName(JustifySelf) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(JustifySelf, "eql")) {
                compile_error = compile_error ++ @typeName(JustifySelf) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(PlaceSelf, "deepClone")) {
                compile_error = compile_error ++ @typeName(PlaceSelf) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(PlaceSelf, "parse")) {
                compile_error = compile_error ++ @typeName(PlaceSelf) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(PlaceSelf, "toCss")) {
                compile_error = compile_error ++ @typeName(PlaceSelf) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(PlaceSelf, "eql")) {
                compile_error = compile_error ++ @typeName(PlaceSelf) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(AlignItems, "deepClone")) {
                compile_error = compile_error ++ @typeName(AlignItems) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(AlignItems, "parse")) {
                compile_error = compile_error ++ @typeName(AlignItems) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(AlignItems, "toCss")) {
                compile_error = compile_error ++ @typeName(AlignItems) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(AlignItems, "eql")) {
                compile_error = compile_error ++ @typeName(AlignItems) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(JustifyItems, "deepClone")) {
                compile_error = compile_error ++ @typeName(JustifyItems) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(JustifyItems, "parse")) {
                compile_error = compile_error ++ @typeName(JustifyItems) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(JustifyItems, "toCss")) {
                compile_error = compile_error ++ @typeName(JustifyItems) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(JustifyItems, "eql")) {
                compile_error = compile_error ++ @typeName(JustifyItems) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(PlaceItems, "deepClone")) {
                compile_error = compile_error ++ @typeName(PlaceItems) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(PlaceItems, "parse")) {
                compile_error = compile_error ++ @typeName(PlaceItems) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(PlaceItems, "toCss")) {
                compile_error = compile_error ++ @typeName(PlaceItems) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(PlaceItems, "eql")) {
                compile_error = compile_error ++ @typeName(PlaceItems) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(GapValue, "deepClone")) {
                compile_error = compile_error ++ @typeName(GapValue) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(GapValue, "parse")) {
                compile_error = compile_error ++ @typeName(GapValue) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(GapValue, "toCss")) {
                compile_error = compile_error ++ @typeName(GapValue) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(GapValue, "eql")) {
                compile_error = compile_error ++ @typeName(GapValue) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(GapValue, "deepClone")) {
                compile_error = compile_error ++ @typeName(GapValue) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(GapValue, "parse")) {
                compile_error = compile_error ++ @typeName(GapValue) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(GapValue, "toCss")) {
                compile_error = compile_error ++ @typeName(GapValue) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(GapValue, "eql")) {
                compile_error = compile_error ++ @typeName(GapValue) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(Gap, "deepClone")) {
                compile_error = compile_error ++ @typeName(Gap) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(Gap, "parse")) {
                compile_error = compile_error ++ @typeName(Gap) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(Gap, "toCss")) {
                compile_error = compile_error ++ @typeName(Gap) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(Gap, "eql")) {
                compile_error = compile_error ++ @typeName(Gap) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(BoxOrient, "deepClone")) {
                compile_error = compile_error ++ @typeName(BoxOrient) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(BoxOrient, "parse")) {
                compile_error = compile_error ++ @typeName(BoxOrient) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(BoxOrient, "toCss")) {
                compile_error = compile_error ++ @typeName(BoxOrient) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(BoxOrient, "eql")) {
                compile_error = compile_error ++ @typeName(BoxOrient) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(BoxDirection, "deepClone")) {
                compile_error = compile_error ++ @typeName(BoxDirection) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(BoxDirection, "parse")) {
                compile_error = compile_error ++ @typeName(BoxDirection) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(BoxDirection, "toCss")) {
                compile_error = compile_error ++ @typeName(BoxDirection) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(BoxDirection, "eql")) {
                compile_error = compile_error ++ @typeName(BoxDirection) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(BoxAlign, "deepClone")) {
                compile_error = compile_error ++ @typeName(BoxAlign) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(BoxAlign, "parse")) {
                compile_error = compile_error ++ @typeName(BoxAlign) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(BoxAlign, "toCss")) {
                compile_error = compile_error ++ @typeName(BoxAlign) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(BoxAlign, "eql")) {
                compile_error = compile_error ++ @typeName(BoxAlign) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(BoxPack, "deepClone")) {
                compile_error = compile_error ++ @typeName(BoxPack) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(BoxPack, "parse")) {
                compile_error = compile_error ++ @typeName(BoxPack) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(BoxPack, "toCss")) {
                compile_error = compile_error ++ @typeName(BoxPack) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(BoxPack, "eql")) {
                compile_error = compile_error ++ @typeName(BoxPack) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(BoxLines, "deepClone")) {
                compile_error = compile_error ++ @typeName(BoxLines) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(BoxLines, "parse")) {
                compile_error = compile_error ++ @typeName(BoxLines) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(BoxLines, "toCss")) {
                compile_error = compile_error ++ @typeName(BoxLines) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(BoxLines, "eql")) {
                compile_error = compile_error ++ @typeName(BoxLines) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(FlexPack, "deepClone")) {
                compile_error = compile_error ++ @typeName(FlexPack) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(FlexPack, "parse")) {
                compile_error = compile_error ++ @typeName(FlexPack) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(FlexPack, "toCss")) {
                compile_error = compile_error ++ @typeName(FlexPack) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(FlexPack, "eql")) {
                compile_error = compile_error ++ @typeName(FlexPack) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(BoxAlign, "deepClone")) {
                compile_error = compile_error ++ @typeName(BoxAlign) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(BoxAlign, "parse")) {
                compile_error = compile_error ++ @typeName(BoxAlign) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(BoxAlign, "toCss")) {
                compile_error = compile_error ++ @typeName(BoxAlign) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(BoxAlign, "eql")) {
                compile_error = compile_error ++ @typeName(BoxAlign) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(FlexItemAlign, "deepClone")) {
                compile_error = compile_error ++ @typeName(FlexItemAlign) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(FlexItemAlign, "parse")) {
                compile_error = compile_error ++ @typeName(FlexItemAlign) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(FlexItemAlign, "toCss")) {
                compile_error = compile_error ++ @typeName(FlexItemAlign) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(FlexItemAlign, "eql")) {
                compile_error = compile_error ++ @typeName(FlexItemAlign) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(FlexLinePack, "deepClone")) {
                compile_error = compile_error ++ @typeName(FlexLinePack) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(FlexLinePack, "parse")) {
                compile_error = compile_error ++ @typeName(FlexLinePack) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(FlexLinePack, "toCss")) {
                compile_error = compile_error ++ @typeName(FlexLinePack) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(FlexLinePack, "eql")) {
                compile_error = compile_error ++ @typeName(FlexLinePack) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "deepClone")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "parse")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "toCss")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "eql")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "deepClone")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "parse")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "toCss")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "eql")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "deepClone")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "parse")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "toCss")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "eql")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "deepClone")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "parse")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "toCss")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "eql")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "deepClone")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "parse")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "toCss")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "eql")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "deepClone")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "parse")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "toCss")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "eql")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "deepClone")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "parse")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "toCss")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "eql")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "deepClone")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "parse")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "toCss")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "eql")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "deepClone")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "parse")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "toCss")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "eql")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(MarginBlock, "deepClone")) {
                compile_error = compile_error ++ @typeName(MarginBlock) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(MarginBlock, "parse")) {
                compile_error = compile_error ++ @typeName(MarginBlock) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(MarginBlock, "toCss")) {
                compile_error = compile_error ++ @typeName(MarginBlock) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(MarginBlock, "eql")) {
                compile_error = compile_error ++ @typeName(MarginBlock) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(MarginInline, "deepClone")) {
                compile_error = compile_error ++ @typeName(MarginInline) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(MarginInline, "parse")) {
                compile_error = compile_error ++ @typeName(MarginInline) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(MarginInline, "toCss")) {
                compile_error = compile_error ++ @typeName(MarginInline) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(MarginInline, "eql")) {
                compile_error = compile_error ++ @typeName(MarginInline) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(Margin, "deepClone")) {
                compile_error = compile_error ++ @typeName(Margin) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(Margin, "parse")) {
                compile_error = compile_error ++ @typeName(Margin) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(Margin, "toCss")) {
                compile_error = compile_error ++ @typeName(Margin) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(Margin, "eql")) {
                compile_error = compile_error ++ @typeName(Margin) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "deepClone")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "parse")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "toCss")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "eql")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "deepClone")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "parse")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "toCss")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "eql")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "deepClone")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "parse")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "toCss")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "eql")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "deepClone")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "parse")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "toCss")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "eql")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "deepClone")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "parse")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "toCss")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "eql")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "deepClone")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "parse")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "toCss")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "eql")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "deepClone")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "parse")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "toCss")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "eql")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "deepClone")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "parse")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "toCss")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "eql")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(PaddingBlock, "deepClone")) {
                compile_error = compile_error ++ @typeName(PaddingBlock) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(PaddingBlock, "parse")) {
                compile_error = compile_error ++ @typeName(PaddingBlock) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(PaddingBlock, "toCss")) {
                compile_error = compile_error ++ @typeName(PaddingBlock) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(PaddingBlock, "eql")) {
                compile_error = compile_error ++ @typeName(PaddingBlock) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(PaddingInline, "deepClone")) {
                compile_error = compile_error ++ @typeName(PaddingInline) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(PaddingInline, "parse")) {
                compile_error = compile_error ++ @typeName(PaddingInline) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(PaddingInline, "toCss")) {
                compile_error = compile_error ++ @typeName(PaddingInline) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(PaddingInline, "eql")) {
                compile_error = compile_error ++ @typeName(PaddingInline) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(Padding, "deepClone")) {
                compile_error = compile_error ++ @typeName(Padding) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(Padding, "parse")) {
                compile_error = compile_error ++ @typeName(Padding) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(Padding, "toCss")) {
                compile_error = compile_error ++ @typeName(Padding) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(Padding, "eql")) {
                compile_error = compile_error ++ @typeName(Padding) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "deepClone")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "parse")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "toCss")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "eql")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "deepClone")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "parse")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "toCss")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "eql")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "deepClone")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "parse")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "toCss")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "eql")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "deepClone")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "parse")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "toCss")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "eql")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "deepClone")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "parse")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "toCss")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "eql")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "deepClone")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "parse")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "toCss")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "eql")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "deepClone")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "parse")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "toCss")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "eql")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "deepClone")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "parse")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "toCss")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "eql")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(ScrollMarginBlock, "deepClone")) {
                compile_error = compile_error ++ @typeName(ScrollMarginBlock) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(ScrollMarginBlock, "parse")) {
                compile_error = compile_error ++ @typeName(ScrollMarginBlock) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(ScrollMarginBlock, "toCss")) {
                compile_error = compile_error ++ @typeName(ScrollMarginBlock) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(ScrollMarginBlock, "eql")) {
                compile_error = compile_error ++ @typeName(ScrollMarginBlock) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(ScrollMarginInline, "deepClone")) {
                compile_error = compile_error ++ @typeName(ScrollMarginInline) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(ScrollMarginInline, "parse")) {
                compile_error = compile_error ++ @typeName(ScrollMarginInline) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(ScrollMarginInline, "toCss")) {
                compile_error = compile_error ++ @typeName(ScrollMarginInline) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(ScrollMarginInline, "eql")) {
                compile_error = compile_error ++ @typeName(ScrollMarginInline) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(ScrollMargin, "deepClone")) {
                compile_error = compile_error ++ @typeName(ScrollMargin) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(ScrollMargin, "parse")) {
                compile_error = compile_error ++ @typeName(ScrollMargin) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(ScrollMargin, "toCss")) {
                compile_error = compile_error ++ @typeName(ScrollMargin) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(ScrollMargin, "eql")) {
                compile_error = compile_error ++ @typeName(ScrollMargin) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "deepClone")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "parse")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "toCss")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "eql")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "deepClone")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "parse")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "toCss")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "eql")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "deepClone")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "parse")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "toCss")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "eql")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "deepClone")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "parse")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "toCss")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "eql")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "deepClone")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "parse")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "toCss")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "eql")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "deepClone")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "parse")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "toCss")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "eql")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "deepClone")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "parse")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "toCss")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "eql")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "deepClone")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "parse")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "toCss")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(LengthPercentageOrAuto, "eql")) {
                compile_error = compile_error ++ @typeName(LengthPercentageOrAuto) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(ScrollPaddingBlock, "deepClone")) {
                compile_error = compile_error ++ @typeName(ScrollPaddingBlock) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(ScrollPaddingBlock, "parse")) {
                compile_error = compile_error ++ @typeName(ScrollPaddingBlock) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(ScrollPaddingBlock, "toCss")) {
                compile_error = compile_error ++ @typeName(ScrollPaddingBlock) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(ScrollPaddingBlock, "eql")) {
                compile_error = compile_error ++ @typeName(ScrollPaddingBlock) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(ScrollPaddingInline, "deepClone")) {
                compile_error = compile_error ++ @typeName(ScrollPaddingInline) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(ScrollPaddingInline, "parse")) {
                compile_error = compile_error ++ @typeName(ScrollPaddingInline) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(ScrollPaddingInline, "toCss")) {
                compile_error = compile_error ++ @typeName(ScrollPaddingInline) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(ScrollPaddingInline, "eql")) {
                compile_error = compile_error ++ @typeName(ScrollPaddingInline) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(ScrollPadding, "deepClone")) {
                compile_error = compile_error ++ @typeName(ScrollPadding) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(ScrollPadding, "parse")) {
                compile_error = compile_error ++ @typeName(ScrollPadding) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(ScrollPadding, "toCss")) {
                compile_error = compile_error ++ @typeName(ScrollPadding) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(ScrollPadding, "eql")) {
                compile_error = compile_error ++ @typeName(ScrollPadding) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(FontWeight, "deepClone")) {
                compile_error = compile_error ++ @typeName(FontWeight) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(FontWeight, "parse")) {
                compile_error = compile_error ++ @typeName(FontWeight) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(FontWeight, "toCss")) {
                compile_error = compile_error ++ @typeName(FontWeight) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(FontWeight, "eql")) {
                compile_error = compile_error ++ @typeName(FontWeight) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(FontSize, "deepClone")) {
                compile_error = compile_error ++ @typeName(FontSize) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(FontSize, "parse")) {
                compile_error = compile_error ++ @typeName(FontSize) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(FontSize, "toCss")) {
                compile_error = compile_error ++ @typeName(FontSize) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(FontSize, "eql")) {
                compile_error = compile_error ++ @typeName(FontSize) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(FontStretch, "deepClone")) {
                compile_error = compile_error ++ @typeName(FontStretch) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(FontStretch, "parse")) {
                compile_error = compile_error ++ @typeName(FontStretch) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(FontStretch, "toCss")) {
                compile_error = compile_error ++ @typeName(FontStretch) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(FontStretch, "eql")) {
                compile_error = compile_error ++ @typeName(FontStretch) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(BabyList(FontFamily), "deepClone")) {
                compile_error = compile_error ++ @typeName(BabyList(FontFamily)) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(BabyList(FontFamily), "parse")) {
                compile_error = compile_error ++ @typeName(BabyList(FontFamily)) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(BabyList(FontFamily), "toCss")) {
                compile_error = compile_error ++ @typeName(BabyList(FontFamily)) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(BabyList(FontFamily), "eql")) {
                compile_error = compile_error ++ @typeName(BabyList(FontFamily)) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(FontStyle, "deepClone")) {
                compile_error = compile_error ++ @typeName(FontStyle) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(FontStyle, "parse")) {
                compile_error = compile_error ++ @typeName(FontStyle) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(FontStyle, "toCss")) {
                compile_error = compile_error ++ @typeName(FontStyle) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(FontStyle, "eql")) {
                compile_error = compile_error ++ @typeName(FontStyle) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(FontVariantCaps, "deepClone")) {
                compile_error = compile_error ++ @typeName(FontVariantCaps) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(FontVariantCaps, "parse")) {
                compile_error = compile_error ++ @typeName(FontVariantCaps) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(FontVariantCaps, "toCss")) {
                compile_error = compile_error ++ @typeName(FontVariantCaps) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(FontVariantCaps, "eql")) {
                compile_error = compile_error ++ @typeName(FontVariantCaps) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(LineHeight, "deepClone")) {
                compile_error = compile_error ++ @typeName(LineHeight) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(LineHeight, "parse")) {
                compile_error = compile_error ++ @typeName(LineHeight) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(LineHeight, "toCss")) {
                compile_error = compile_error ++ @typeName(LineHeight) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(LineHeight, "eql")) {
                compile_error = compile_error ++ @typeName(LineHeight) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(Font, "deepClone")) {
                compile_error = compile_error ++ @typeName(Font) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(Font, "parse")) {
                compile_error = compile_error ++ @typeName(Font) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(Font, "toCss")) {
                compile_error = compile_error ++ @typeName(Font) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(Font, "eql")) {
                compile_error = compile_error ++ @typeName(Font) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(CssColor, "deepClone")) {
                compile_error = compile_error ++ @typeName(CssColor) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(CssColor, "parse")) {
                compile_error = compile_error ++ @typeName(CssColor) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(CssColor, "toCss")) {
                compile_error = compile_error ++ @typeName(CssColor) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(CssColor, "eql")) {
                compile_error = compile_error ++ @typeName(CssColor) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(CssColor, "deepClone")) {
                compile_error = compile_error ++ @typeName(CssColor) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(CssColor, "parse")) {
                compile_error = compile_error ++ @typeName(CssColor) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(CssColor, "toCss")) {
                compile_error = compile_error ++ @typeName(CssColor) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(CssColor, "eql")) {
                compile_error = compile_error ++ @typeName(CssColor) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(SmallList(TextShadow, 1), "deepClone")) {
                compile_error = compile_error ++ @typeName(SmallList(TextShadow, 1)) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(SmallList(TextShadow, 1), "parse")) {
                compile_error = compile_error ++ @typeName(SmallList(TextShadow, 1)) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(SmallList(TextShadow, 1), "toCss")) {
                compile_error = compile_error ++ @typeName(SmallList(TextShadow, 1)) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(SmallList(TextShadow, 1), "eql")) {
                compile_error = compile_error ++ @typeName(SmallList(TextShadow, 1)) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(Direction, "deepClone")) {
                compile_error = compile_error ++ @typeName(Direction) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(Direction, "parse")) {
                compile_error = compile_error ++ @typeName(Direction) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(Direction, "toCss")) {
                compile_error = compile_error ++ @typeName(Direction) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(Direction, "eql")) {
                compile_error = compile_error ++ @typeName(Direction) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(Composes, "deepClone")) {
                compile_error = compile_error ++ @typeName(Composes) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(Composes, "parse")) {
                compile_error = compile_error ++ @typeName(Composes) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(Composes, "toCss")) {
                compile_error = compile_error ++ @typeName(Composes) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(Composes, "eql")) {
                compile_error = compile_error ++ @typeName(Composes) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(SmallList(Image, 1), "deepClone")) {
                compile_error = compile_error ++ @typeName(SmallList(Image, 1)) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(SmallList(Image, 1), "parse")) {
                compile_error = compile_error ++ @typeName(SmallList(Image, 1)) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(SmallList(Image, 1), "toCss")) {
                compile_error = compile_error ++ @typeName(SmallList(Image, 1)) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(SmallList(Image, 1), "eql")) {
                compile_error = compile_error ++ @typeName(SmallList(Image, 1)) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(SmallList(MaskMode, 1), "deepClone")) {
                compile_error = compile_error ++ @typeName(SmallList(MaskMode, 1)) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(SmallList(MaskMode, 1), "parse")) {
                compile_error = compile_error ++ @typeName(SmallList(MaskMode, 1)) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(SmallList(MaskMode, 1), "toCss")) {
                compile_error = compile_error ++ @typeName(SmallList(MaskMode, 1)) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(SmallList(MaskMode, 1), "eql")) {
                compile_error = compile_error ++ @typeName(SmallList(MaskMode, 1)) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(SmallList(BackgroundRepeat, 1), "deepClone")) {
                compile_error = compile_error ++ @typeName(SmallList(BackgroundRepeat, 1)) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(SmallList(BackgroundRepeat, 1), "parse")) {
                compile_error = compile_error ++ @typeName(SmallList(BackgroundRepeat, 1)) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(SmallList(BackgroundRepeat, 1), "toCss")) {
                compile_error = compile_error ++ @typeName(SmallList(BackgroundRepeat, 1)) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(SmallList(BackgroundRepeat, 1), "eql")) {
                compile_error = compile_error ++ @typeName(SmallList(BackgroundRepeat, 1)) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(SmallList(HorizontalPosition, 1), "deepClone")) {
                compile_error = compile_error ++ @typeName(SmallList(HorizontalPosition, 1)) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(SmallList(HorizontalPosition, 1), "parse")) {
                compile_error = compile_error ++ @typeName(SmallList(HorizontalPosition, 1)) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(SmallList(HorizontalPosition, 1), "toCss")) {
                compile_error = compile_error ++ @typeName(SmallList(HorizontalPosition, 1)) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(SmallList(HorizontalPosition, 1), "eql")) {
                compile_error = compile_error ++ @typeName(SmallList(HorizontalPosition, 1)) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(SmallList(VerticalPosition, 1), "deepClone")) {
                compile_error = compile_error ++ @typeName(SmallList(VerticalPosition, 1)) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(SmallList(VerticalPosition, 1), "parse")) {
                compile_error = compile_error ++ @typeName(SmallList(VerticalPosition, 1)) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(SmallList(VerticalPosition, 1), "toCss")) {
                compile_error = compile_error ++ @typeName(SmallList(VerticalPosition, 1)) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(SmallList(VerticalPosition, 1), "eql")) {
                compile_error = compile_error ++ @typeName(SmallList(VerticalPosition, 1)) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(SmallList(Position, 1), "deepClone")) {
                compile_error = compile_error ++ @typeName(SmallList(Position, 1)) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(SmallList(Position, 1), "parse")) {
                compile_error = compile_error ++ @typeName(SmallList(Position, 1)) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(SmallList(Position, 1), "toCss")) {
                compile_error = compile_error ++ @typeName(SmallList(Position, 1)) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(SmallList(Position, 1), "eql")) {
                compile_error = compile_error ++ @typeName(SmallList(Position, 1)) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(SmallList(MaskClip, 1), "deepClone")) {
                compile_error = compile_error ++ @typeName(SmallList(MaskClip, 1)) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(SmallList(MaskClip, 1), "parse")) {
                compile_error = compile_error ++ @typeName(SmallList(MaskClip, 1)) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(SmallList(MaskClip, 1), "toCss")) {
                compile_error = compile_error ++ @typeName(SmallList(MaskClip, 1)) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(SmallList(MaskClip, 1), "eql")) {
                compile_error = compile_error ++ @typeName(SmallList(MaskClip, 1)) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(SmallList(GeometryBox, 1), "deepClone")) {
                compile_error = compile_error ++ @typeName(SmallList(GeometryBox, 1)) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(SmallList(GeometryBox, 1), "parse")) {
                compile_error = compile_error ++ @typeName(SmallList(GeometryBox, 1)) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(SmallList(GeometryBox, 1), "toCss")) {
                compile_error = compile_error ++ @typeName(SmallList(GeometryBox, 1)) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(SmallList(GeometryBox, 1), "eql")) {
                compile_error = compile_error ++ @typeName(SmallList(GeometryBox, 1)) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(SmallList(BackgroundSize, 1), "deepClone")) {
                compile_error = compile_error ++ @typeName(SmallList(BackgroundSize, 1)) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(SmallList(BackgroundSize, 1), "parse")) {
                compile_error = compile_error ++ @typeName(SmallList(BackgroundSize, 1)) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(SmallList(BackgroundSize, 1), "toCss")) {
                compile_error = compile_error ++ @typeName(SmallList(BackgroundSize, 1)) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(SmallList(BackgroundSize, 1), "eql")) {
                compile_error = compile_error ++ @typeName(SmallList(BackgroundSize, 1)) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(SmallList(MaskComposite, 1), "deepClone")) {
                compile_error = compile_error ++ @typeName(SmallList(MaskComposite, 1)) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(SmallList(MaskComposite, 1), "parse")) {
                compile_error = compile_error ++ @typeName(SmallList(MaskComposite, 1)) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(SmallList(MaskComposite, 1), "toCss")) {
                compile_error = compile_error ++ @typeName(SmallList(MaskComposite, 1)) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(SmallList(MaskComposite, 1), "eql")) {
                compile_error = compile_error ++ @typeName(SmallList(MaskComposite, 1)) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(MaskType, "deepClone")) {
                compile_error = compile_error ++ @typeName(MaskType) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(MaskType, "parse")) {
                compile_error = compile_error ++ @typeName(MaskType) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(MaskType, "toCss")) {
                compile_error = compile_error ++ @typeName(MaskType) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(MaskType, "eql")) {
                compile_error = compile_error ++ @typeName(MaskType) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(SmallList(Mask, 1), "deepClone")) {
                compile_error = compile_error ++ @typeName(SmallList(Mask, 1)) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(SmallList(Mask, 1), "parse")) {
                compile_error = compile_error ++ @typeName(SmallList(Mask, 1)) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(SmallList(Mask, 1), "toCss")) {
                compile_error = compile_error ++ @typeName(SmallList(Mask, 1)) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(SmallList(Mask, 1), "eql")) {
                compile_error = compile_error ++ @typeName(SmallList(Mask, 1)) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(Image, "deepClone")) {
                compile_error = compile_error ++ @typeName(Image) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(Image, "parse")) {
                compile_error = compile_error ++ @typeName(Image) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(Image, "toCss")) {
                compile_error = compile_error ++ @typeName(Image) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(Image, "eql")) {
                compile_error = compile_error ++ @typeName(Image) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(MaskBorderMode, "deepClone")) {
                compile_error = compile_error ++ @typeName(MaskBorderMode) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(MaskBorderMode, "parse")) {
                compile_error = compile_error ++ @typeName(MaskBorderMode) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(MaskBorderMode, "toCss")) {
                compile_error = compile_error ++ @typeName(MaskBorderMode) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(MaskBorderMode, "eql")) {
                compile_error = compile_error ++ @typeName(MaskBorderMode) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(BorderImageSlice, "deepClone")) {
                compile_error = compile_error ++ @typeName(BorderImageSlice) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(BorderImageSlice, "parse")) {
                compile_error = compile_error ++ @typeName(BorderImageSlice) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(BorderImageSlice, "toCss")) {
                compile_error = compile_error ++ @typeName(BorderImageSlice) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(BorderImageSlice, "eql")) {
                compile_error = compile_error ++ @typeName(BorderImageSlice) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(Rect(BorderImageSideWidth), "deepClone")) {
                compile_error = compile_error ++ @typeName(Rect(BorderImageSideWidth)) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(Rect(BorderImageSideWidth), "parse")) {
                compile_error = compile_error ++ @typeName(Rect(BorderImageSideWidth)) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(Rect(BorderImageSideWidth), "toCss")) {
                compile_error = compile_error ++ @typeName(Rect(BorderImageSideWidth)) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(Rect(BorderImageSideWidth), "eql")) {
                compile_error = compile_error ++ @typeName(Rect(BorderImageSideWidth)) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(Rect(LengthOrNumber), "deepClone")) {
                compile_error = compile_error ++ @typeName(Rect(LengthOrNumber)) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(Rect(LengthOrNumber), "parse")) {
                compile_error = compile_error ++ @typeName(Rect(LengthOrNumber)) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(Rect(LengthOrNumber), "toCss")) {
                compile_error = compile_error ++ @typeName(Rect(LengthOrNumber)) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(Rect(LengthOrNumber), "eql")) {
                compile_error = compile_error ++ @typeName(Rect(LengthOrNumber)) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(BorderImageRepeat, "deepClone")) {
                compile_error = compile_error ++ @typeName(BorderImageRepeat) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(BorderImageRepeat, "parse")) {
                compile_error = compile_error ++ @typeName(BorderImageRepeat) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(BorderImageRepeat, "toCss")) {
                compile_error = compile_error ++ @typeName(BorderImageRepeat) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(BorderImageRepeat, "eql")) {
                compile_error = compile_error ++ @typeName(BorderImageRepeat) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(MaskBorder, "deepClone")) {
                compile_error = compile_error ++ @typeName(MaskBorder) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(MaskBorder, "parse")) {
                compile_error = compile_error ++ @typeName(MaskBorder) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(MaskBorder, "toCss")) {
                compile_error = compile_error ++ @typeName(MaskBorder) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(MaskBorder, "eql")) {
                compile_error = compile_error ++ @typeName(MaskBorder) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(SmallList(WebKitMaskComposite, 1), "deepClone")) {
                compile_error = compile_error ++ @typeName(SmallList(WebKitMaskComposite, 1)) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(SmallList(WebKitMaskComposite, 1), "parse")) {
                compile_error = compile_error ++ @typeName(SmallList(WebKitMaskComposite, 1)) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(SmallList(WebKitMaskComposite, 1), "toCss")) {
                compile_error = compile_error ++ @typeName(SmallList(WebKitMaskComposite, 1)) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(SmallList(WebKitMaskComposite, 1), "eql")) {
                compile_error = compile_error ++ @typeName(SmallList(WebKitMaskComposite, 1)) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(SmallList(WebKitMaskSourceType, 1), "deepClone")) {
                compile_error = compile_error ++ @typeName(SmallList(WebKitMaskSourceType, 1)) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(SmallList(WebKitMaskSourceType, 1), "parse")) {
                compile_error = compile_error ++ @typeName(SmallList(WebKitMaskSourceType, 1)) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(SmallList(WebKitMaskSourceType, 1), "toCss")) {
                compile_error = compile_error ++ @typeName(SmallList(WebKitMaskSourceType, 1)) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(SmallList(WebKitMaskSourceType, 1), "eql")) {
                compile_error = compile_error ++ @typeName(SmallList(WebKitMaskSourceType, 1)) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(BorderImage, "deepClone")) {
                compile_error = compile_error ++ @typeName(BorderImage) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(BorderImage, "parse")) {
                compile_error = compile_error ++ @typeName(BorderImage) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(BorderImage, "toCss")) {
                compile_error = compile_error ++ @typeName(BorderImage) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(BorderImage, "eql")) {
                compile_error = compile_error ++ @typeName(BorderImage) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(Image, "deepClone")) {
                compile_error = compile_error ++ @typeName(Image) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(Image, "parse")) {
                compile_error = compile_error ++ @typeName(Image) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(Image, "toCss")) {
                compile_error = compile_error ++ @typeName(Image) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(Image, "eql")) {
                compile_error = compile_error ++ @typeName(Image) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(BorderImageSlice, "deepClone")) {
                compile_error = compile_error ++ @typeName(BorderImageSlice) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(BorderImageSlice, "parse")) {
                compile_error = compile_error ++ @typeName(BorderImageSlice) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(BorderImageSlice, "toCss")) {
                compile_error = compile_error ++ @typeName(BorderImageSlice) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(BorderImageSlice, "eql")) {
                compile_error = compile_error ++ @typeName(BorderImageSlice) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(Rect(BorderImageSideWidth), "deepClone")) {
                compile_error = compile_error ++ @typeName(Rect(BorderImageSideWidth)) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(Rect(BorderImageSideWidth), "parse")) {
                compile_error = compile_error ++ @typeName(Rect(BorderImageSideWidth)) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(Rect(BorderImageSideWidth), "toCss")) {
                compile_error = compile_error ++ @typeName(Rect(BorderImageSideWidth)) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(Rect(BorderImageSideWidth), "eql")) {
                compile_error = compile_error ++ @typeName(Rect(BorderImageSideWidth)) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(Rect(LengthOrNumber), "deepClone")) {
                compile_error = compile_error ++ @typeName(Rect(LengthOrNumber)) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(Rect(LengthOrNumber), "parse")) {
                compile_error = compile_error ++ @typeName(Rect(LengthOrNumber)) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(Rect(LengthOrNumber), "toCss")) {
                compile_error = compile_error ++ @typeName(Rect(LengthOrNumber)) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(Rect(LengthOrNumber), "eql")) {
                compile_error = compile_error ++ @typeName(Rect(LengthOrNumber)) ++ ": does not have a eql() function.\n";
            }

            if (!@hasDecl(BorderImageRepeat, "deepClone")) {
                compile_error = compile_error ++ @typeName(BorderImageRepeat) ++ ": does not have a deepClone() function.\n";
            }

            if (!@hasDecl(BorderImageRepeat, "parse")) {
                compile_error = compile_error ++ @typeName(BorderImageRepeat) ++ ": does not have a parse() function.\n";
            }

            if (!@hasDecl(BorderImageRepeat, "toCss")) {
                compile_error = compile_error ++ @typeName(BorderImageRepeat) ++ ": does not have a toCss() function.\n";
            }

            if (!@hasDecl(BorderImageRepeat, "eql")) {
                compile_error = compile_error ++ @typeName(BorderImageRepeat) ++ ": does not have a eql() function.\n";
            }

            const final_compile_error = compile_error;
            break :compile_error final_compile_error;
        };
        if (compile_error.len > 0) {
            @compileError(compile_error);
        }
    }

    /// Parses a CSS property by name.
    pub fn parse(property_id: PropertyId, input: *css.Parser, options: *const css.ParserOptions) Result(Property) {
        const state = input.state();

        switch (property_id) {
            .@"background-color" => {
                if (css.generic.parseWithOptions(CssColor, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"background-color" = c } };
                    }
                }
            },
            .@"background-image" => {
                if (css.generic.parseWithOptions(SmallList(Image, 1), input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"background-image" = c } };
                    }
                }
            },
            .@"background-position-x" => {
                if (css.generic.parseWithOptions(SmallList(css_values.position.HorizontalPosition, 1), input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"background-position-x" = c } };
                    }
                }
            },
            .@"background-position-y" => {
                if (css.generic.parseWithOptions(SmallList(css_values.position.VerticalPosition, 1), input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"background-position-y" = c } };
                    }
                }
            },
            .@"background-position" => {
                if (css.generic.parseWithOptions(SmallList(background.BackgroundPosition, 1), input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"background-position" = c } };
                    }
                }
            },
            .@"background-size" => {
                if (css.generic.parseWithOptions(SmallList(background.BackgroundSize, 1), input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"background-size" = c } };
                    }
                }
            },
            .@"background-repeat" => {
                if (css.generic.parseWithOptions(SmallList(background.BackgroundRepeat, 1), input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"background-repeat" = c } };
                    }
                }
            },
            .@"background-attachment" => {
                if (css.generic.parseWithOptions(SmallList(background.BackgroundAttachment, 1), input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"background-attachment" = c } };
                    }
                }
            },
            .@"background-clip" => |pre| {
                if (css.generic.parseWithOptions(SmallList(background.BackgroundClip, 1), input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"background-clip" = .{ c, pre } } };
                    }
                }
            },
            .@"background-origin" => {
                if (css.generic.parseWithOptions(SmallList(background.BackgroundOrigin, 1), input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"background-origin" = c } };
                    }
                }
            },
            .background => {
                if (css.generic.parseWithOptions(SmallList(background.Background, 1), input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .background = c } };
                    }
                }
            },
            .@"box-shadow" => |pre| {
                if (css.generic.parseWithOptions(SmallList(box_shadow.BoxShadow, 1), input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"box-shadow" = .{ c, pre } } };
                    }
                }
            },
            .opacity => {
                if (css.generic.parseWithOptions(css.css_values.alpha.AlphaValue, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .opacity = c } };
                    }
                }
            },
            .color => {
                if (css.generic.parseWithOptions(CssColor, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .color = c } };
                    }
                }
            },
            .display => {
                if (css.generic.parseWithOptions(display.Display, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .display = c } };
                    }
                }
            },
            .visibility => {
                if (css.generic.parseWithOptions(display.Visibility, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .visibility = c } };
                    }
                }
            },
            .width => {
                if (css.generic.parseWithOptions(size.Size, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .width = c } };
                    }
                }
            },
            .height => {
                if (css.generic.parseWithOptions(size.Size, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .height = c } };
                    }
                }
            },
            .@"min-width" => {
                if (css.generic.parseWithOptions(size.Size, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"min-width" = c } };
                    }
                }
            },
            .@"min-height" => {
                if (css.generic.parseWithOptions(size.Size, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"min-height" = c } };
                    }
                }
            },
            .@"max-width" => {
                if (css.generic.parseWithOptions(size.MaxSize, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"max-width" = c } };
                    }
                }
            },
            .@"max-height" => {
                if (css.generic.parseWithOptions(size.MaxSize, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"max-height" = c } };
                    }
                }
            },
            .@"block-size" => {
                if (css.generic.parseWithOptions(size.Size, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"block-size" = c } };
                    }
                }
            },
            .@"inline-size" => {
                if (css.generic.parseWithOptions(size.Size, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"inline-size" = c } };
                    }
                }
            },
            .@"min-block-size" => {
                if (css.generic.parseWithOptions(size.Size, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"min-block-size" = c } };
                    }
                }
            },
            .@"min-inline-size" => {
                if (css.generic.parseWithOptions(size.Size, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"min-inline-size" = c } };
                    }
                }
            },
            .@"max-block-size" => {
                if (css.generic.parseWithOptions(size.MaxSize, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"max-block-size" = c } };
                    }
                }
            },
            .@"max-inline-size" => {
                if (css.generic.parseWithOptions(size.MaxSize, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"max-inline-size" = c } };
                    }
                }
            },
            .@"box-sizing" => |pre| {
                if (css.generic.parseWithOptions(size.BoxSizing, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"box-sizing" = .{ c, pre } } };
                    }
                }
            },
            .@"aspect-ratio" => {
                if (css.generic.parseWithOptions(size.AspectRatio, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"aspect-ratio" = c } };
                    }
                }
            },
            .overflow => {
                if (css.generic.parseWithOptions(overflow.Overflow, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .overflow = c } };
                    }
                }
            },
            .@"overflow-x" => {
                if (css.generic.parseWithOptions(overflow.OverflowKeyword, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"overflow-x" = c } };
                    }
                }
            },
            .@"overflow-y" => {
                if (css.generic.parseWithOptions(overflow.OverflowKeyword, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"overflow-y" = c } };
                    }
                }
            },
            .@"text-overflow" => |pre| {
                if (css.generic.parseWithOptions(overflow.TextOverflow, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"text-overflow" = .{ c, pre } } };
                    }
                }
            },
            .position => {
                if (css.generic.parseWithOptions(position.Position, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .position = c } };
                    }
                }
            },
            .top => {
                if (css.generic.parseWithOptions(LengthPercentageOrAuto, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .top = c } };
                    }
                }
            },
            .bottom => {
                if (css.generic.parseWithOptions(LengthPercentageOrAuto, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .bottom = c } };
                    }
                }
            },
            .left => {
                if (css.generic.parseWithOptions(LengthPercentageOrAuto, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .left = c } };
                    }
                }
            },
            .right => {
                if (css.generic.parseWithOptions(LengthPercentageOrAuto, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .right = c } };
                    }
                }
            },
            .@"inset-block-start" => {
                if (css.generic.parseWithOptions(LengthPercentageOrAuto, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"inset-block-start" = c } };
                    }
                }
            },
            .@"inset-block-end" => {
                if (css.generic.parseWithOptions(LengthPercentageOrAuto, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"inset-block-end" = c } };
                    }
                }
            },
            .@"inset-inline-start" => {
                if (css.generic.parseWithOptions(LengthPercentageOrAuto, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"inset-inline-start" = c } };
                    }
                }
            },
            .@"inset-inline-end" => {
                if (css.generic.parseWithOptions(LengthPercentageOrAuto, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"inset-inline-end" = c } };
                    }
                }
            },
            .@"inset-block" => {
                if (css.generic.parseWithOptions(margin_padding.InsetBlock, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"inset-block" = c } };
                    }
                }
            },
            .@"inset-inline" => {
                if (css.generic.parseWithOptions(margin_padding.InsetInline, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"inset-inline" = c } };
                    }
                }
            },
            .inset => {
                if (css.generic.parseWithOptions(margin_padding.Inset, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .inset = c } };
                    }
                }
            },
            .@"border-spacing" => {
                if (css.generic.parseWithOptions(css.css_values.size.Size2D(Length), input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"border-spacing" = c } };
                    }
                }
            },
            .@"border-top-color" => {
                if (css.generic.parseWithOptions(CssColor, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"border-top-color" = c } };
                    }
                }
            },
            .@"border-bottom-color" => {
                if (css.generic.parseWithOptions(CssColor, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"border-bottom-color" = c } };
                    }
                }
            },
            .@"border-left-color" => {
                if (css.generic.parseWithOptions(CssColor, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"border-left-color" = c } };
                    }
                }
            },
            .@"border-right-color" => {
                if (css.generic.parseWithOptions(CssColor, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"border-right-color" = c } };
                    }
                }
            },
            .@"border-block-start-color" => {
                if (css.generic.parseWithOptions(CssColor, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"border-block-start-color" = c } };
                    }
                }
            },
            .@"border-block-end-color" => {
                if (css.generic.parseWithOptions(CssColor, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"border-block-end-color" = c } };
                    }
                }
            },
            .@"border-inline-start-color" => {
                if (css.generic.parseWithOptions(CssColor, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"border-inline-start-color" = c } };
                    }
                }
            },
            .@"border-inline-end-color" => {
                if (css.generic.parseWithOptions(CssColor, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"border-inline-end-color" = c } };
                    }
                }
            },
            .@"border-top-style" => {
                if (css.generic.parseWithOptions(border.LineStyle, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"border-top-style" = c } };
                    }
                }
            },
            .@"border-bottom-style" => {
                if (css.generic.parseWithOptions(border.LineStyle, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"border-bottom-style" = c } };
                    }
                }
            },
            .@"border-left-style" => {
                if (css.generic.parseWithOptions(border.LineStyle, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"border-left-style" = c } };
                    }
                }
            },
            .@"border-right-style" => {
                if (css.generic.parseWithOptions(border.LineStyle, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"border-right-style" = c } };
                    }
                }
            },
            .@"border-block-start-style" => {
                if (css.generic.parseWithOptions(border.LineStyle, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"border-block-start-style" = c } };
                    }
                }
            },
            .@"border-block-end-style" => {
                if (css.generic.parseWithOptions(border.LineStyle, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"border-block-end-style" = c } };
                    }
                }
            },
            .@"border-inline-start-style" => {
                if (css.generic.parseWithOptions(border.LineStyle, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"border-inline-start-style" = c } };
                    }
                }
            },
            .@"border-inline-end-style" => {
                if (css.generic.parseWithOptions(border.LineStyle, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"border-inline-end-style" = c } };
                    }
                }
            },
            .@"border-top-width" => {
                if (css.generic.parseWithOptions(BorderSideWidth, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"border-top-width" = c } };
                    }
                }
            },
            .@"border-bottom-width" => {
                if (css.generic.parseWithOptions(BorderSideWidth, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"border-bottom-width" = c } };
                    }
                }
            },
            .@"border-left-width" => {
                if (css.generic.parseWithOptions(BorderSideWidth, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"border-left-width" = c } };
                    }
                }
            },
            .@"border-right-width" => {
                if (css.generic.parseWithOptions(BorderSideWidth, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"border-right-width" = c } };
                    }
                }
            },
            .@"border-block-start-width" => {
                if (css.generic.parseWithOptions(BorderSideWidth, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"border-block-start-width" = c } };
                    }
                }
            },
            .@"border-block-end-width" => {
                if (css.generic.parseWithOptions(BorderSideWidth, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"border-block-end-width" = c } };
                    }
                }
            },
            .@"border-inline-start-width" => {
                if (css.generic.parseWithOptions(BorderSideWidth, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"border-inline-start-width" = c } };
                    }
                }
            },
            .@"border-inline-end-width" => {
                if (css.generic.parseWithOptions(BorderSideWidth, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"border-inline-end-width" = c } };
                    }
                }
            },
            .@"border-top-left-radius" => |pre| {
                if (css.generic.parseWithOptions(Size2D(LengthPercentage), input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"border-top-left-radius" = .{ c, pre } } };
                    }
                }
            },
            .@"border-top-right-radius" => |pre| {
                if (css.generic.parseWithOptions(Size2D(LengthPercentage), input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"border-top-right-radius" = .{ c, pre } } };
                    }
                }
            },
            .@"border-bottom-left-radius" => |pre| {
                if (css.generic.parseWithOptions(Size2D(LengthPercentage), input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"border-bottom-left-radius" = .{ c, pre } } };
                    }
                }
            },
            .@"border-bottom-right-radius" => |pre| {
                if (css.generic.parseWithOptions(Size2D(LengthPercentage), input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"border-bottom-right-radius" = .{ c, pre } } };
                    }
                }
            },
            .@"border-start-start-radius" => {
                if (css.generic.parseWithOptions(Size2D(LengthPercentage), input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"border-start-start-radius" = c } };
                    }
                }
            },
            .@"border-start-end-radius" => {
                if (css.generic.parseWithOptions(Size2D(LengthPercentage), input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"border-start-end-radius" = c } };
                    }
                }
            },
            .@"border-end-start-radius" => {
                if (css.generic.parseWithOptions(Size2D(LengthPercentage), input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"border-end-start-radius" = c } };
                    }
                }
            },
            .@"border-end-end-radius" => {
                if (css.generic.parseWithOptions(Size2D(LengthPercentage), input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"border-end-end-radius" = c } };
                    }
                }
            },
            .@"border-radius" => |pre| {
                if (css.generic.parseWithOptions(BorderRadius, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"border-radius" = .{ c, pre } } };
                    }
                }
            },
            .@"border-image-source" => {
                if (css.generic.parseWithOptions(Image, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"border-image-source" = c } };
                    }
                }
            },
            .@"border-image-outset" => {
                if (css.generic.parseWithOptions(Rect(LengthOrNumber), input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"border-image-outset" = c } };
                    }
                }
            },
            .@"border-image-repeat" => {
                if (css.generic.parseWithOptions(BorderImageRepeat, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"border-image-repeat" = c } };
                    }
                }
            },
            .@"border-image-width" => {
                if (css.generic.parseWithOptions(Rect(BorderImageSideWidth), input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"border-image-width" = c } };
                    }
                }
            },
            .@"border-image-slice" => {
                if (css.generic.parseWithOptions(BorderImageSlice, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"border-image-slice" = c } };
                    }
                }
            },
            .@"border-image" => |pre| {
                if (css.generic.parseWithOptions(BorderImage, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"border-image" = .{ c, pre } } };
                    }
                }
            },
            .@"border-color" => {
                if (css.generic.parseWithOptions(BorderColor, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"border-color" = c } };
                    }
                }
            },
            .@"border-style" => {
                if (css.generic.parseWithOptions(BorderStyle, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"border-style" = c } };
                    }
                }
            },
            .@"border-width" => {
                if (css.generic.parseWithOptions(BorderWidth, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"border-width" = c } };
                    }
                }
            },
            .@"border-block-color" => {
                if (css.generic.parseWithOptions(BorderBlockColor, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"border-block-color" = c } };
                    }
                }
            },
            .@"border-block-style" => {
                if (css.generic.parseWithOptions(BorderBlockStyle, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"border-block-style" = c } };
                    }
                }
            },
            .@"border-block-width" => {
                if (css.generic.parseWithOptions(BorderBlockWidth, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"border-block-width" = c } };
                    }
                }
            },
            .@"border-inline-color" => {
                if (css.generic.parseWithOptions(BorderInlineColor, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"border-inline-color" = c } };
                    }
                }
            },
            .@"border-inline-style" => {
                if (css.generic.parseWithOptions(BorderInlineStyle, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"border-inline-style" = c } };
                    }
                }
            },
            .@"border-inline-width" => {
                if (css.generic.parseWithOptions(BorderInlineWidth, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"border-inline-width" = c } };
                    }
                }
            },
            .border => {
                if (css.generic.parseWithOptions(Border, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .border = c } };
                    }
                }
            },
            .@"border-top" => {
                if (css.generic.parseWithOptions(BorderTop, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"border-top" = c } };
                    }
                }
            },
            .@"border-bottom" => {
                if (css.generic.parseWithOptions(BorderBottom, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"border-bottom" = c } };
                    }
                }
            },
            .@"border-left" => {
                if (css.generic.parseWithOptions(BorderLeft, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"border-left" = c } };
                    }
                }
            },
            .@"border-right" => {
                if (css.generic.parseWithOptions(BorderRight, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"border-right" = c } };
                    }
                }
            },
            .@"border-block" => {
                if (css.generic.parseWithOptions(BorderBlock, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"border-block" = c } };
                    }
                }
            },
            .@"border-block-start" => {
                if (css.generic.parseWithOptions(BorderBlockStart, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"border-block-start" = c } };
                    }
                }
            },
            .@"border-block-end" => {
                if (css.generic.parseWithOptions(BorderBlockEnd, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"border-block-end" = c } };
                    }
                }
            },
            .@"border-inline" => {
                if (css.generic.parseWithOptions(BorderInline, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"border-inline" = c } };
                    }
                }
            },
            .@"border-inline-start" => {
                if (css.generic.parseWithOptions(BorderInlineStart, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"border-inline-start" = c } };
                    }
                }
            },
            .@"border-inline-end" => {
                if (css.generic.parseWithOptions(BorderInlineEnd, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"border-inline-end" = c } };
                    }
                }
            },
            .outline => {
                if (css.generic.parseWithOptions(Outline, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .outline = c } };
                    }
                }
            },
            .@"outline-color" => {
                if (css.generic.parseWithOptions(CssColor, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"outline-color" = c } };
                    }
                }
            },
            .@"outline-style" => {
                if (css.generic.parseWithOptions(OutlineStyle, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"outline-style" = c } };
                    }
                }
            },
            .@"outline-width" => {
                if (css.generic.parseWithOptions(BorderSideWidth, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"outline-width" = c } };
                    }
                }
            },
            .@"flex-direction" => |pre| {
                if (css.generic.parseWithOptions(FlexDirection, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"flex-direction" = .{ c, pre } } };
                    }
                }
            },
            .@"flex-wrap" => |pre| {
                if (css.generic.parseWithOptions(FlexWrap, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"flex-wrap" = .{ c, pre } } };
                    }
                }
            },
            .@"flex-flow" => |pre| {
                if (css.generic.parseWithOptions(FlexFlow, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"flex-flow" = .{ c, pre } } };
                    }
                }
            },
            .@"flex-grow" => |pre| {
                if (css.generic.parseWithOptions(CSSNumber, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"flex-grow" = .{ c, pre } } };
                    }
                }
            },
            .@"flex-shrink" => |pre| {
                if (css.generic.parseWithOptions(CSSNumber, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"flex-shrink" = .{ c, pre } } };
                    }
                }
            },
            .@"flex-basis" => |pre| {
                if (css.generic.parseWithOptions(LengthPercentageOrAuto, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"flex-basis" = .{ c, pre } } };
                    }
                }
            },
            .flex => |pre| {
                if (css.generic.parseWithOptions(Flex, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .flex = .{ c, pre } } };
                    }
                }
            },
            .order => |pre| {
                if (css.generic.parseWithOptions(CSSInteger, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .order = .{ c, pre } } };
                    }
                }
            },
            .@"align-content" => |pre| {
                if (css.generic.parseWithOptions(AlignContent, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"align-content" = .{ c, pre } } };
                    }
                }
            },
            .@"justify-content" => |pre| {
                if (css.generic.parseWithOptions(JustifyContent, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"justify-content" = .{ c, pre } } };
                    }
                }
            },
            .@"place-content" => {
                if (css.generic.parseWithOptions(PlaceContent, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"place-content" = c } };
                    }
                }
            },
            .@"align-self" => |pre| {
                if (css.generic.parseWithOptions(AlignSelf, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"align-self" = .{ c, pre } } };
                    }
                }
            },
            .@"justify-self" => {
                if (css.generic.parseWithOptions(JustifySelf, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"justify-self" = c } };
                    }
                }
            },
            .@"place-self" => {
                if (css.generic.parseWithOptions(PlaceSelf, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"place-self" = c } };
                    }
                }
            },
            .@"align-items" => |pre| {
                if (css.generic.parseWithOptions(AlignItems, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"align-items" = .{ c, pre } } };
                    }
                }
            },
            .@"justify-items" => {
                if (css.generic.parseWithOptions(JustifyItems, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"justify-items" = c } };
                    }
                }
            },
            .@"place-items" => {
                if (css.generic.parseWithOptions(PlaceItems, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"place-items" = c } };
                    }
                }
            },
            .@"row-gap" => {
                if (css.generic.parseWithOptions(GapValue, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"row-gap" = c } };
                    }
                }
            },
            .@"column-gap" => {
                if (css.generic.parseWithOptions(GapValue, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"column-gap" = c } };
                    }
                }
            },
            .gap => {
                if (css.generic.parseWithOptions(Gap, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .gap = c } };
                    }
                }
            },
            .@"box-orient" => |pre| {
                if (css.generic.parseWithOptions(BoxOrient, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"box-orient" = .{ c, pre } } };
                    }
                }
            },
            .@"box-direction" => |pre| {
                if (css.generic.parseWithOptions(BoxDirection, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"box-direction" = .{ c, pre } } };
                    }
                }
            },
            .@"box-ordinal-group" => |pre| {
                if (css.generic.parseWithOptions(CSSInteger, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"box-ordinal-group" = .{ c, pre } } };
                    }
                }
            },
            .@"box-align" => |pre| {
                if (css.generic.parseWithOptions(BoxAlign, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"box-align" = .{ c, pre } } };
                    }
                }
            },
            .@"box-flex" => |pre| {
                if (css.generic.parseWithOptions(CSSNumber, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"box-flex" = .{ c, pre } } };
                    }
                }
            },
            .@"box-flex-group" => |pre| {
                if (css.generic.parseWithOptions(CSSInteger, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"box-flex-group" = .{ c, pre } } };
                    }
                }
            },
            .@"box-pack" => |pre| {
                if (css.generic.parseWithOptions(BoxPack, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"box-pack" = .{ c, pre } } };
                    }
                }
            },
            .@"box-lines" => |pre| {
                if (css.generic.parseWithOptions(BoxLines, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"box-lines" = .{ c, pre } } };
                    }
                }
            },
            .@"flex-pack" => |pre| {
                if (css.generic.parseWithOptions(FlexPack, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"flex-pack" = .{ c, pre } } };
                    }
                }
            },
            .@"flex-order" => |pre| {
                if (css.generic.parseWithOptions(CSSInteger, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"flex-order" = .{ c, pre } } };
                    }
                }
            },
            .@"flex-align" => |pre| {
                if (css.generic.parseWithOptions(BoxAlign, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"flex-align" = .{ c, pre } } };
                    }
                }
            },
            .@"flex-item-align" => |pre| {
                if (css.generic.parseWithOptions(FlexItemAlign, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"flex-item-align" = .{ c, pre } } };
                    }
                }
            },
            .@"flex-line-pack" => |pre| {
                if (css.generic.parseWithOptions(FlexLinePack, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"flex-line-pack" = .{ c, pre } } };
                    }
                }
            },
            .@"flex-positive" => |pre| {
                if (css.generic.parseWithOptions(CSSNumber, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"flex-positive" = .{ c, pre } } };
                    }
                }
            },
            .@"flex-negative" => |pre| {
                if (css.generic.parseWithOptions(CSSNumber, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"flex-negative" = .{ c, pre } } };
                    }
                }
            },
            .@"flex-preferred-size" => |pre| {
                if (css.generic.parseWithOptions(LengthPercentageOrAuto, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"flex-preferred-size" = .{ c, pre } } };
                    }
                }
            },
            .@"margin-top" => {
                if (css.generic.parseWithOptions(LengthPercentageOrAuto, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"margin-top" = c } };
                    }
                }
            },
            .@"margin-bottom" => {
                if (css.generic.parseWithOptions(LengthPercentageOrAuto, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"margin-bottom" = c } };
                    }
                }
            },
            .@"margin-left" => {
                if (css.generic.parseWithOptions(LengthPercentageOrAuto, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"margin-left" = c } };
                    }
                }
            },
            .@"margin-right" => {
                if (css.generic.parseWithOptions(LengthPercentageOrAuto, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"margin-right" = c } };
                    }
                }
            },
            .@"margin-block-start" => {
                @setEvalBranchQuota(5000);
                if (css.generic.parseWithOptions(LengthPercentageOrAuto, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"margin-block-start" = c } };
                    }
                }
            },
            .@"margin-block-end" => {
                if (css.generic.parseWithOptions(LengthPercentageOrAuto, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"margin-block-end" = c } };
                    }
                }
            },
            .@"margin-inline-start" => {
                if (css.generic.parseWithOptions(LengthPercentageOrAuto, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"margin-inline-start" = c } };
                    }
                }
            },
            .@"margin-inline-end" => {
                if (css.generic.parseWithOptions(LengthPercentageOrAuto, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"margin-inline-end" = c } };
                    }
                }
            },
            .@"margin-block" => {
                if (css.generic.parseWithOptions(MarginBlock, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"margin-block" = c } };
                    }
                }
            },
            .@"margin-inline" => {
                if (css.generic.parseWithOptions(MarginInline, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"margin-inline" = c } };
                    }
                }
            },
            .margin => {
                @setEvalBranchQuota(5000);
                if (css.generic.parseWithOptions(Margin, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .margin = c } };
                    }
                }
            },
            .@"padding-top" => {
                if (css.generic.parseWithOptions(LengthPercentageOrAuto, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"padding-top" = c } };
                    }
                }
            },
            .@"padding-bottom" => {
                if (css.generic.parseWithOptions(LengthPercentageOrAuto, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"padding-bottom" = c } };
                    }
                }
            },
            .@"padding-left" => {
                if (css.generic.parseWithOptions(LengthPercentageOrAuto, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"padding-left" = c } };
                    }
                }
            },
            .@"padding-right" => {
                if (css.generic.parseWithOptions(LengthPercentageOrAuto, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"padding-right" = c } };
                    }
                }
            },
            .@"padding-block-start" => {
                if (css.generic.parseWithOptions(LengthPercentageOrAuto, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"padding-block-start" = c } };
                    }
                }
            },
            .@"padding-block-end" => {
                if (css.generic.parseWithOptions(LengthPercentageOrAuto, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"padding-block-end" = c } };
                    }
                }
            },
            .@"padding-inline-start" => {
                if (css.generic.parseWithOptions(LengthPercentageOrAuto, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"padding-inline-start" = c } };
                    }
                }
            },
            .@"padding-inline-end" => {
                if (css.generic.parseWithOptions(LengthPercentageOrAuto, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"padding-inline-end" = c } };
                    }
                }
            },
            .@"padding-block" => {
                if (css.generic.parseWithOptions(PaddingBlock, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"padding-block" = c } };
                    }
                }
            },
            .@"padding-inline" => {
                if (css.generic.parseWithOptions(PaddingInline, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"padding-inline" = c } };
                    }
                }
            },
            .padding => {
                if (css.generic.parseWithOptions(Padding, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .padding = c } };
                    }
                }
            },
            .@"scroll-margin-top" => {
                if (css.generic.parseWithOptions(LengthPercentageOrAuto, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"scroll-margin-top" = c } };
                    }
                }
            },
            .@"scroll-margin-bottom" => {
                if (css.generic.parseWithOptions(LengthPercentageOrAuto, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"scroll-margin-bottom" = c } };
                    }
                }
            },
            .@"scroll-margin-left" => {
                if (css.generic.parseWithOptions(LengthPercentageOrAuto, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"scroll-margin-left" = c } };
                    }
                }
            },
            .@"scroll-margin-right" => {
                if (css.generic.parseWithOptions(LengthPercentageOrAuto, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"scroll-margin-right" = c } };
                    }
                }
            },
            .@"scroll-margin-block-start" => {
                if (css.generic.parseWithOptions(LengthPercentageOrAuto, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"scroll-margin-block-start" = c } };
                    }
                }
            },
            .@"scroll-margin-block-end" => {
                if (css.generic.parseWithOptions(LengthPercentageOrAuto, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"scroll-margin-block-end" = c } };
                    }
                }
            },
            .@"scroll-margin-inline-start" => {
                if (css.generic.parseWithOptions(LengthPercentageOrAuto, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"scroll-margin-inline-start" = c } };
                    }
                }
            },
            .@"scroll-margin-inline-end" => {
                if (css.generic.parseWithOptions(LengthPercentageOrAuto, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"scroll-margin-inline-end" = c } };
                    }
                }
            },
            .@"scroll-margin-block" => {
                if (css.generic.parseWithOptions(ScrollMarginBlock, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"scroll-margin-block" = c } };
                    }
                }
            },
            .@"scroll-margin-inline" => {
                if (css.generic.parseWithOptions(ScrollMarginInline, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"scroll-margin-inline" = c } };
                    }
                }
            },
            .@"scroll-margin" => {
                if (css.generic.parseWithOptions(ScrollMargin, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"scroll-margin" = c } };
                    }
                }
            },
            .@"scroll-padding-top" => {
                if (css.generic.parseWithOptions(LengthPercentageOrAuto, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"scroll-padding-top" = c } };
                    }
                }
            },
            .@"scroll-padding-bottom" => {
                if (css.generic.parseWithOptions(LengthPercentageOrAuto, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"scroll-padding-bottom" = c } };
                    }
                }
            },
            .@"scroll-padding-left" => {
                if (css.generic.parseWithOptions(LengthPercentageOrAuto, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"scroll-padding-left" = c } };
                    }
                }
            },
            .@"scroll-padding-right" => {
                if (css.generic.parseWithOptions(LengthPercentageOrAuto, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"scroll-padding-right" = c } };
                    }
                }
            },
            .@"scroll-padding-block-start" => {
                if (css.generic.parseWithOptions(LengthPercentageOrAuto, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"scroll-padding-block-start" = c } };
                    }
                }
            },
            .@"scroll-padding-block-end" => {
                if (css.generic.parseWithOptions(LengthPercentageOrAuto, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"scroll-padding-block-end" = c } };
                    }
                }
            },
            .@"scroll-padding-inline-start" => {
                if (css.generic.parseWithOptions(LengthPercentageOrAuto, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"scroll-padding-inline-start" = c } };
                    }
                }
            },
            .@"scroll-padding-inline-end" => {
                if (css.generic.parseWithOptions(LengthPercentageOrAuto, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"scroll-padding-inline-end" = c } };
                    }
                }
            },
            .@"scroll-padding-block" => {
                if (css.generic.parseWithOptions(ScrollPaddingBlock, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"scroll-padding-block" = c } };
                    }
                }
            },
            .@"scroll-padding-inline" => {
                if (css.generic.parseWithOptions(ScrollPaddingInline, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"scroll-padding-inline" = c } };
                    }
                }
            },
            .@"scroll-padding" => {
                if (css.generic.parseWithOptions(ScrollPadding, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"scroll-padding" = c } };
                    }
                }
            },
            .@"font-weight" => {
                if (css.generic.parseWithOptions(FontWeight, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"font-weight" = c } };
                    }
                }
            },
            .@"font-size" => {
                if (css.generic.parseWithOptions(FontSize, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"font-size" = c } };
                    }
                }
            },
            .@"font-stretch" => {
                if (css.generic.parseWithOptions(FontStretch, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"font-stretch" = c } };
                    }
                }
            },
            .@"font-family" => {
                if (css.generic.parseWithOptions(BabyList(FontFamily), input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"font-family" = c } };
                    }
                }
            },
            .@"font-style" => {
                if (css.generic.parseWithOptions(FontStyle, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"font-style" = c } };
                    }
                }
            },
            .@"font-variant-caps" => {
                if (css.generic.parseWithOptions(FontVariantCaps, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"font-variant-caps" = c } };
                    }
                }
            },
            .@"line-height" => {
                if (css.generic.parseWithOptions(LineHeight, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"line-height" = c } };
                    }
                }
            },
            .font => {
                if (css.generic.parseWithOptions(Font, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .font = c } };
                    }
                }
            },
            .@"text-decoration-color" => |pre| {
                if (css.generic.parseWithOptions(CssColor, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"text-decoration-color" = .{ c, pre } } };
                    }
                }
            },
            .@"text-emphasis-color" => |pre| {
                if (css.generic.parseWithOptions(CssColor, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"text-emphasis-color" = .{ c, pre } } };
                    }
                }
            },
            .@"text-shadow" => {
                if (css.generic.parseWithOptions(SmallList(TextShadow, 1), input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"text-shadow" = c } };
                    }
                }
            },
            .direction => {
                if (css.generic.parseWithOptions(Direction, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .direction = c } };
                    }
                }
            },
            .composes => {
                if (css.generic.parseWithOptions(Composes, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .composes = c } };
                    }
                }
            },
            .@"mask-image" => |pre| {
                if (css.generic.parseWithOptions(SmallList(Image, 1), input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"mask-image" = .{ c, pre } } };
                    }
                }
            },
            .@"mask-mode" => {
                if (css.generic.parseWithOptions(SmallList(MaskMode, 1), input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"mask-mode" = c } };
                    }
                }
            },
            .@"mask-repeat" => |pre| {
                if (css.generic.parseWithOptions(SmallList(BackgroundRepeat, 1), input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"mask-repeat" = .{ c, pre } } };
                    }
                }
            },
            .@"mask-position-x" => {
                if (css.generic.parseWithOptions(SmallList(HorizontalPosition, 1), input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"mask-position-x" = c } };
                    }
                }
            },
            .@"mask-position-y" => {
                if (css.generic.parseWithOptions(SmallList(VerticalPosition, 1), input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"mask-position-y" = c } };
                    }
                }
            },
            .@"mask-position" => |pre| {
                if (css.generic.parseWithOptions(SmallList(Position, 1), input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"mask-position" = .{ c, pre } } };
                    }
                }
            },
            .@"mask-clip" => |pre| {
                @setEvalBranchQuota(5000);
                if (css.generic.parseWithOptions(SmallList(MaskClip, 1), input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"mask-clip" = .{ c, pre } } };
                    }
                }
            },
            .@"mask-origin" => |pre| {
                if (css.generic.parseWithOptions(SmallList(GeometryBox, 1), input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"mask-origin" = .{ c, pre } } };
                    }
                }
            },
            .@"mask-size" => |pre| {
                if (css.generic.parseWithOptions(SmallList(BackgroundSize, 1), input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"mask-size" = .{ c, pre } } };
                    }
                }
            },
            .@"mask-composite" => {
                if (css.generic.parseWithOptions(SmallList(MaskComposite, 1), input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"mask-composite" = c } };
                    }
                }
            },
            .@"mask-type" => {
                if (css.generic.parseWithOptions(MaskType, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"mask-type" = c } };
                    }
                }
            },
            .mask => |pre| {
                if (css.generic.parseWithOptions(SmallList(Mask, 1), input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .mask = .{ c, pre } } };
                    }
                }
            },
            .@"mask-border-source" => {
                if (css.generic.parseWithOptions(Image, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"mask-border-source" = c } };
                    }
                }
            },
            .@"mask-border-mode" => {
                if (css.generic.parseWithOptions(MaskBorderMode, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"mask-border-mode" = c } };
                    }
                }
            },
            .@"mask-border-slice" => {
                if (css.generic.parseWithOptions(BorderImageSlice, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"mask-border-slice" = c } };
                    }
                }
            },
            .@"mask-border-width" => {
                if (css.generic.parseWithOptions(Rect(BorderImageSideWidth), input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"mask-border-width" = c } };
                    }
                }
            },
            .@"mask-border-outset" => {
                if (css.generic.parseWithOptions(Rect(LengthOrNumber), input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"mask-border-outset" = c } };
                    }
                }
            },
            .@"mask-border-repeat" => {
                if (css.generic.parseWithOptions(BorderImageRepeat, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"mask-border-repeat" = c } };
                    }
                }
            },
            .@"mask-border" => {
                if (css.generic.parseWithOptions(MaskBorder, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"mask-border" = c } };
                    }
                }
            },
            .@"-webkit-mask-composite" => {
                if (css.generic.parseWithOptions(SmallList(WebKitMaskComposite, 1), input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"-webkit-mask-composite" = c } };
                    }
                }
            },
            .@"mask-source-type" => |pre| {
                if (css.generic.parseWithOptions(SmallList(WebKitMaskSourceType, 1), input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"mask-source-type" = .{ c, pre } } };
                    }
                }
            },
            .@"mask-box-image" => |pre| {
                if (css.generic.parseWithOptions(BorderImage, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"mask-box-image" = .{ c, pre } } };
                    }
                }
            },
            .@"mask-box-image-source" => |pre| {
                if (css.generic.parseWithOptions(Image, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"mask-box-image-source" = .{ c, pre } } };
                    }
                }
            },
            .@"mask-box-image-slice" => |pre| {
                if (css.generic.parseWithOptions(BorderImageSlice, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"mask-box-image-slice" = .{ c, pre } } };
                    }
                }
            },
            .@"mask-box-image-width" => |pre| {
                if (css.generic.parseWithOptions(Rect(BorderImageSideWidth), input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"mask-box-image-width" = .{ c, pre } } };
                    }
                }
            },
            .@"mask-box-image-outset" => |pre| {
                if (css.generic.parseWithOptions(Rect(LengthOrNumber), input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"mask-box-image-outset" = .{ c, pre } } };
                    }
                }
            },
            .@"mask-box-image-repeat" => |pre| {
                if (css.generic.parseWithOptions(BorderImageRepeat, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"mask-box-image-repeat" = .{ c, pre } } };
                    }
                }
            },
            .all => return .{ .result = .{ .all = switch (CSSWideKeyword.parse(input)) {
                .result => |v| v,
                .err => |e| return .{ .err = e },
            } } },
            .custom => |name| return .{ .result = .{ .custom = switch (CustomProperty.parse(name, input, options)) {
                .result => |v| v,
                .err => |e| return .{ .err = e },
            } } },
            else => {},
        }

        // If a value was unable to be parsed, treat as an unparsed property.
        // This is different from a custom property, handled below, in that the property name is known
        // and stored as an enum rather than a string. This lets property handlers more easily deal with it.
        // Ideally we'd only do this if var() or env() references were seen, but err on the safe side for now.
        input.reset(&state);
        return .{ .result = .{ .unparsed = switch (UnparsedProperty.parse(property_id, input, options)) {
            .result => |v| v,
            .err => |e| return .{ .err = e },
        } } };
    }

    pub fn propertyId(this: *const Property) PropertyId {
        return switch (this.*) {
            .@"background-color" => .@"background-color",
            .@"background-image" => .@"background-image",
            .@"background-position-x" => .@"background-position-x",
            .@"background-position-y" => .@"background-position-y",
            .@"background-position" => .@"background-position",
            .@"background-size" => .@"background-size",
            .@"background-repeat" => .@"background-repeat",
            .@"background-attachment" => .@"background-attachment",
            .@"background-clip" => |*v| PropertyId{ .@"background-clip" = v[1] },
            .@"background-origin" => .@"background-origin",
            .background => .background,
            .@"box-shadow" => |*v| PropertyId{ .@"box-shadow" = v[1] },
            .opacity => .opacity,
            .color => .color,
            .display => .display,
            .visibility => .visibility,
            .width => .width,
            .height => .height,
            .@"min-width" => .@"min-width",
            .@"min-height" => .@"min-height",
            .@"max-width" => .@"max-width",
            .@"max-height" => .@"max-height",
            .@"block-size" => .@"block-size",
            .@"inline-size" => .@"inline-size",
            .@"min-block-size" => .@"min-block-size",
            .@"min-inline-size" => .@"min-inline-size",
            .@"max-block-size" => .@"max-block-size",
            .@"max-inline-size" => .@"max-inline-size",
            .@"box-sizing" => |*v| PropertyId{ .@"box-sizing" = v[1] },
            .@"aspect-ratio" => .@"aspect-ratio",
            .overflow => .overflow,
            .@"overflow-x" => .@"overflow-x",
            .@"overflow-y" => .@"overflow-y",
            .@"text-overflow" => |*v| PropertyId{ .@"text-overflow" = v[1] },
            .position => .position,
            .top => .top,
            .bottom => .bottom,
            .left => .left,
            .right => .right,
            .@"inset-block-start" => .@"inset-block-start",
            .@"inset-block-end" => .@"inset-block-end",
            .@"inset-inline-start" => .@"inset-inline-start",
            .@"inset-inline-end" => .@"inset-inline-end",
            .@"inset-block" => .@"inset-block",
            .@"inset-inline" => .@"inset-inline",
            .inset => .inset,
            .@"border-spacing" => .@"border-spacing",
            .@"border-top-color" => .@"border-top-color",
            .@"border-bottom-color" => .@"border-bottom-color",
            .@"border-left-color" => .@"border-left-color",
            .@"border-right-color" => .@"border-right-color",
            .@"border-block-start-color" => .@"border-block-start-color",
            .@"border-block-end-color" => .@"border-block-end-color",
            .@"border-inline-start-color" => .@"border-inline-start-color",
            .@"border-inline-end-color" => .@"border-inline-end-color",
            .@"border-top-style" => .@"border-top-style",
            .@"border-bottom-style" => .@"border-bottom-style",
            .@"border-left-style" => .@"border-left-style",
            .@"border-right-style" => .@"border-right-style",
            .@"border-block-start-style" => .@"border-block-start-style",
            .@"border-block-end-style" => .@"border-block-end-style",
            .@"border-inline-start-style" => .@"border-inline-start-style",
            .@"border-inline-end-style" => .@"border-inline-end-style",
            .@"border-top-width" => .@"border-top-width",
            .@"border-bottom-width" => .@"border-bottom-width",
            .@"border-left-width" => .@"border-left-width",
            .@"border-right-width" => .@"border-right-width",
            .@"border-block-start-width" => .@"border-block-start-width",
            .@"border-block-end-width" => .@"border-block-end-width",
            .@"border-inline-start-width" => .@"border-inline-start-width",
            .@"border-inline-end-width" => .@"border-inline-end-width",
            .@"border-top-left-radius" => |*v| PropertyId{ .@"border-top-left-radius" = v[1] },
            .@"border-top-right-radius" => |*v| PropertyId{ .@"border-top-right-radius" = v[1] },
            .@"border-bottom-left-radius" => |*v| PropertyId{ .@"border-bottom-left-radius" = v[1] },
            .@"border-bottom-right-radius" => |*v| PropertyId{ .@"border-bottom-right-radius" = v[1] },
            .@"border-start-start-radius" => .@"border-start-start-radius",
            .@"border-start-end-radius" => .@"border-start-end-radius",
            .@"border-end-start-radius" => .@"border-end-start-radius",
            .@"border-end-end-radius" => .@"border-end-end-radius",
            .@"border-radius" => |*v| PropertyId{ .@"border-radius" = v[1] },
            .@"border-image-source" => .@"border-image-source",
            .@"border-image-outset" => .@"border-image-outset",
            .@"border-image-repeat" => .@"border-image-repeat",
            .@"border-image-width" => .@"border-image-width",
            .@"border-image-slice" => .@"border-image-slice",
            .@"border-image" => |*v| PropertyId{ .@"border-image" = v[1] },
            .@"border-color" => .@"border-color",
            .@"border-style" => .@"border-style",
            .@"border-width" => .@"border-width",
            .@"border-block-color" => .@"border-block-color",
            .@"border-block-style" => .@"border-block-style",
            .@"border-block-width" => .@"border-block-width",
            .@"border-inline-color" => .@"border-inline-color",
            .@"border-inline-style" => .@"border-inline-style",
            .@"border-inline-width" => .@"border-inline-width",
            .border => .border,
            .@"border-top" => .@"border-top",
            .@"border-bottom" => .@"border-bottom",
            .@"border-left" => .@"border-left",
            .@"border-right" => .@"border-right",
            .@"border-block" => .@"border-block",
            .@"border-block-start" => .@"border-block-start",
            .@"border-block-end" => .@"border-block-end",
            .@"border-inline" => .@"border-inline",
            .@"border-inline-start" => .@"border-inline-start",
            .@"border-inline-end" => .@"border-inline-end",
            .outline => .outline,
            .@"outline-color" => .@"outline-color",
            .@"outline-style" => .@"outline-style",
            .@"outline-width" => .@"outline-width",
            .@"flex-direction" => |*v| PropertyId{ .@"flex-direction" = v[1] },
            .@"flex-wrap" => |*v| PropertyId{ .@"flex-wrap" = v[1] },
            .@"flex-flow" => |*v| PropertyId{ .@"flex-flow" = v[1] },
            .@"flex-grow" => |*v| PropertyId{ .@"flex-grow" = v[1] },
            .@"flex-shrink" => |*v| PropertyId{ .@"flex-shrink" = v[1] },
            .@"flex-basis" => |*v| PropertyId{ .@"flex-basis" = v[1] },
            .flex => |*v| PropertyId{ .flex = v[1] },
            .order => |*v| PropertyId{ .order = v[1] },
            .@"align-content" => |*v| PropertyId{ .@"align-content" = v[1] },
            .@"justify-content" => |*v| PropertyId{ .@"justify-content" = v[1] },
            .@"place-content" => .@"place-content",
            .@"align-self" => |*v| PropertyId{ .@"align-self" = v[1] },
            .@"justify-self" => .@"justify-self",
            .@"place-self" => .@"place-self",
            .@"align-items" => |*v| PropertyId{ .@"align-items" = v[1] },
            .@"justify-items" => .@"justify-items",
            .@"place-items" => .@"place-items",
            .@"row-gap" => .@"row-gap",
            .@"column-gap" => .@"column-gap",
            .gap => .gap,
            .@"box-orient" => |*v| PropertyId{ .@"box-orient" = v[1] },
            .@"box-direction" => |*v| PropertyId{ .@"box-direction" = v[1] },
            .@"box-ordinal-group" => |*v| PropertyId{ .@"box-ordinal-group" = v[1] },
            .@"box-align" => |*v| PropertyId{ .@"box-align" = v[1] },
            .@"box-flex" => |*v| PropertyId{ .@"box-flex" = v[1] },
            .@"box-flex-group" => |*v| PropertyId{ .@"box-flex-group" = v[1] },
            .@"box-pack" => |*v| PropertyId{ .@"box-pack" = v[1] },
            .@"box-lines" => |*v| PropertyId{ .@"box-lines" = v[1] },
            .@"flex-pack" => |*v| PropertyId{ .@"flex-pack" = v[1] },
            .@"flex-order" => |*v| PropertyId{ .@"flex-order" = v[1] },
            .@"flex-align" => |*v| PropertyId{ .@"flex-align" = v[1] },
            .@"flex-item-align" => |*v| PropertyId{ .@"flex-item-align" = v[1] },
            .@"flex-line-pack" => |*v| PropertyId{ .@"flex-line-pack" = v[1] },
            .@"flex-positive" => |*v| PropertyId{ .@"flex-positive" = v[1] },
            .@"flex-negative" => |*v| PropertyId{ .@"flex-negative" = v[1] },
            .@"flex-preferred-size" => |*v| PropertyId{ .@"flex-preferred-size" = v[1] },
            .@"margin-top" => .@"margin-top",
            .@"margin-bottom" => .@"margin-bottom",
            .@"margin-left" => .@"margin-left",
            .@"margin-right" => .@"margin-right",
            .@"margin-block-start" => .@"margin-block-start",
            .@"margin-block-end" => .@"margin-block-end",
            .@"margin-inline-start" => .@"margin-inline-start",
            .@"margin-inline-end" => .@"margin-inline-end",
            .@"margin-block" => .@"margin-block",
            .@"margin-inline" => .@"margin-inline",
            .margin => .margin,
            .@"padding-top" => .@"padding-top",
            .@"padding-bottom" => .@"padding-bottom",
            .@"padding-left" => .@"padding-left",
            .@"padding-right" => .@"padding-right",
            .@"padding-block-start" => .@"padding-block-start",
            .@"padding-block-end" => .@"padding-block-end",
            .@"padding-inline-start" => .@"padding-inline-start",
            .@"padding-inline-end" => .@"padding-inline-end",
            .@"padding-block" => .@"padding-block",
            .@"padding-inline" => .@"padding-inline",
            .padding => .padding,
            .@"scroll-margin-top" => .@"scroll-margin-top",
            .@"scroll-margin-bottom" => .@"scroll-margin-bottom",
            .@"scroll-margin-left" => .@"scroll-margin-left",
            .@"scroll-margin-right" => .@"scroll-margin-right",
            .@"scroll-margin-block-start" => .@"scroll-margin-block-start",
            .@"scroll-margin-block-end" => .@"scroll-margin-block-end",
            .@"scroll-margin-inline-start" => .@"scroll-margin-inline-start",
            .@"scroll-margin-inline-end" => .@"scroll-margin-inline-end",
            .@"scroll-margin-block" => .@"scroll-margin-block",
            .@"scroll-margin-inline" => .@"scroll-margin-inline",
            .@"scroll-margin" => .@"scroll-margin",
            .@"scroll-padding-top" => .@"scroll-padding-top",
            .@"scroll-padding-bottom" => .@"scroll-padding-bottom",
            .@"scroll-padding-left" => .@"scroll-padding-left",
            .@"scroll-padding-right" => .@"scroll-padding-right",
            .@"scroll-padding-block-start" => .@"scroll-padding-block-start",
            .@"scroll-padding-block-end" => .@"scroll-padding-block-end",
            .@"scroll-padding-inline-start" => .@"scroll-padding-inline-start",
            .@"scroll-padding-inline-end" => .@"scroll-padding-inline-end",
            .@"scroll-padding-block" => .@"scroll-padding-block",
            .@"scroll-padding-inline" => .@"scroll-padding-inline",
            .@"scroll-padding" => .@"scroll-padding",
            .@"font-weight" => .@"font-weight",
            .@"font-size" => .@"font-size",
            .@"font-stretch" => .@"font-stretch",
            .@"font-family" => .@"font-family",
            .@"font-style" => .@"font-style",
            .@"font-variant-caps" => .@"font-variant-caps",
            .@"line-height" => .@"line-height",
            .font => .font,
            .@"text-decoration-color" => |*v| PropertyId{ .@"text-decoration-color" = v[1] },
            .@"text-emphasis-color" => |*v| PropertyId{ .@"text-emphasis-color" = v[1] },
            .@"text-shadow" => .@"text-shadow",
            .direction => .direction,
            .composes => .composes,
            .@"mask-image" => |*v| PropertyId{ .@"mask-image" = v[1] },
            .@"mask-mode" => .@"mask-mode",
            .@"mask-repeat" => |*v| PropertyId{ .@"mask-repeat" = v[1] },
            .@"mask-position-x" => .@"mask-position-x",
            .@"mask-position-y" => .@"mask-position-y",
            .@"mask-position" => |*v| PropertyId{ .@"mask-position" = v[1] },
            .@"mask-clip" => |*v| PropertyId{ .@"mask-clip" = v[1] },
            .@"mask-origin" => |*v| PropertyId{ .@"mask-origin" = v[1] },
            .@"mask-size" => |*v| PropertyId{ .@"mask-size" = v[1] },
            .@"mask-composite" => .@"mask-composite",
            .@"mask-type" => .@"mask-type",
            .mask => |*v| PropertyId{ .mask = v[1] },
            .@"mask-border-source" => .@"mask-border-source",
            .@"mask-border-mode" => .@"mask-border-mode",
            .@"mask-border-slice" => .@"mask-border-slice",
            .@"mask-border-width" => .@"mask-border-width",
            .@"mask-border-outset" => .@"mask-border-outset",
            .@"mask-border-repeat" => .@"mask-border-repeat",
            .@"mask-border" => .@"mask-border",
            .@"-webkit-mask-composite" => .@"-webkit-mask-composite",
            .@"mask-source-type" => |*v| PropertyId{ .@"mask-source-type" = v[1] },
            .@"mask-box-image" => |*v| PropertyId{ .@"mask-box-image" = v[1] },
            .@"mask-box-image-source" => |*v| PropertyId{ .@"mask-box-image-source" = v[1] },
            .@"mask-box-image-slice" => |*v| PropertyId{ .@"mask-box-image-slice" = v[1] },
            .@"mask-box-image-width" => |*v| PropertyId{ .@"mask-box-image-width" = v[1] },
            .@"mask-box-image-outset" => |*v| PropertyId{ .@"mask-box-image-outset" = v[1] },
            .@"mask-box-image-repeat" => |*v| PropertyId{ .@"mask-box-image-repeat" = v[1] },
            .all => PropertyId.all,
            .unparsed => |unparsed| unparsed.property_id,
            .custom => |c| .{ .custom = c.name },
        };
    }

    pub fn deepClone(this: *const Property, allocator: std.mem.Allocator) Property {
        return switch (this.*) {
            .@"background-color" => |*v| .{ .@"background-color" = v.deepClone(allocator) },
            .@"background-image" => |*v| .{ .@"background-image" = v.deepClone(allocator) },
            .@"background-position-x" => |*v| .{ .@"background-position-x" = v.deepClone(allocator) },
            .@"background-position-y" => |*v| .{ .@"background-position-y" = v.deepClone(allocator) },
            .@"background-position" => |*v| .{ .@"background-position" = v.deepClone(allocator) },
            .@"background-size" => |*v| .{ .@"background-size" = v.deepClone(allocator) },
            .@"background-repeat" => |*v| .{ .@"background-repeat" = v.deepClone(allocator) },
            .@"background-attachment" => |*v| .{ .@"background-attachment" = v.deepClone(allocator) },
            .@"background-clip" => |*v| .{ .@"background-clip" = .{ v[0].deepClone(allocator), v[1] } },
            .@"background-origin" => |*v| .{ .@"background-origin" = v.deepClone(allocator) },
            .background => |*v| .{ .background = v.deepClone(allocator) },
            .@"box-shadow" => |*v| .{ .@"box-shadow" = .{ v[0].deepClone(allocator), v[1] } },
            .opacity => |*v| .{ .opacity = v.deepClone(allocator) },
            .color => |*v| .{ .color = v.deepClone(allocator) },
            .display => |*v| .{ .display = v.deepClone(allocator) },
            .visibility => |*v| .{ .visibility = v.deepClone(allocator) },
            .width => |*v| .{ .width = v.deepClone(allocator) },
            .height => |*v| .{ .height = v.deepClone(allocator) },
            .@"min-width" => |*v| .{ .@"min-width" = v.deepClone(allocator) },
            .@"min-height" => |*v| .{ .@"min-height" = v.deepClone(allocator) },
            .@"max-width" => |*v| .{ .@"max-width" = v.deepClone(allocator) },
            .@"max-height" => |*v| .{ .@"max-height" = v.deepClone(allocator) },
            .@"block-size" => |*v| .{ .@"block-size" = v.deepClone(allocator) },
            .@"inline-size" => |*v| .{ .@"inline-size" = v.deepClone(allocator) },
            .@"min-block-size" => |*v| .{ .@"min-block-size" = v.deepClone(allocator) },
            .@"min-inline-size" => |*v| .{ .@"min-inline-size" = v.deepClone(allocator) },
            .@"max-block-size" => |*v| .{ .@"max-block-size" = v.deepClone(allocator) },
            .@"max-inline-size" => |*v| .{ .@"max-inline-size" = v.deepClone(allocator) },
            .@"box-sizing" => |*v| .{ .@"box-sizing" = .{ v[0].deepClone(allocator), v[1] } },
            .@"aspect-ratio" => |*v| .{ .@"aspect-ratio" = v.deepClone(allocator) },
            .overflow => |*v| .{ .overflow = v.deepClone(allocator) },
            .@"overflow-x" => |*v| .{ .@"overflow-x" = v.deepClone(allocator) },
            .@"overflow-y" => |*v| .{ .@"overflow-y" = v.deepClone(allocator) },
            .@"text-overflow" => |*v| .{ .@"text-overflow" = .{ v[0].deepClone(allocator), v[1] } },
            .position => |*v| .{ .position = v.deepClone(allocator) },
            .top => |*v| .{ .top = v.deepClone(allocator) },
            .bottom => |*v| .{ .bottom = v.deepClone(allocator) },
            .left => |*v| .{ .left = v.deepClone(allocator) },
            .right => |*v| .{ .right = v.deepClone(allocator) },
            .@"inset-block-start" => |*v| .{ .@"inset-block-start" = v.deepClone(allocator) },
            .@"inset-block-end" => |*v| .{ .@"inset-block-end" = v.deepClone(allocator) },
            .@"inset-inline-start" => |*v| .{ .@"inset-inline-start" = v.deepClone(allocator) },
            .@"inset-inline-end" => |*v| .{ .@"inset-inline-end" = v.deepClone(allocator) },
            .@"inset-block" => |*v| .{ .@"inset-block" = v.deepClone(allocator) },
            .@"inset-inline" => |*v| .{ .@"inset-inline" = v.deepClone(allocator) },
            .inset => |*v| .{ .inset = v.deepClone(allocator) },
            .@"border-spacing" => |*v| .{ .@"border-spacing" = v.deepClone(allocator) },
            .@"border-top-color" => |*v| .{ .@"border-top-color" = v.deepClone(allocator) },
            .@"border-bottom-color" => |*v| .{ .@"border-bottom-color" = v.deepClone(allocator) },
            .@"border-left-color" => |*v| .{ .@"border-left-color" = v.deepClone(allocator) },
            .@"border-right-color" => |*v| .{ .@"border-right-color" = v.deepClone(allocator) },
            .@"border-block-start-color" => |*v| .{ .@"border-block-start-color" = v.deepClone(allocator) },
            .@"border-block-end-color" => |*v| .{ .@"border-block-end-color" = v.deepClone(allocator) },
            .@"border-inline-start-color" => |*v| .{ .@"border-inline-start-color" = v.deepClone(allocator) },
            .@"border-inline-end-color" => |*v| .{ .@"border-inline-end-color" = v.deepClone(allocator) },
            .@"border-top-style" => |*v| .{ .@"border-top-style" = v.deepClone(allocator) },
            .@"border-bottom-style" => |*v| .{ .@"border-bottom-style" = v.deepClone(allocator) },
            .@"border-left-style" => |*v| .{ .@"border-left-style" = v.deepClone(allocator) },
            .@"border-right-style" => |*v| .{ .@"border-right-style" = v.deepClone(allocator) },
            .@"border-block-start-style" => |*v| .{ .@"border-block-start-style" = v.deepClone(allocator) },
            .@"border-block-end-style" => |*v| .{ .@"border-block-end-style" = v.deepClone(allocator) },
            .@"border-inline-start-style" => |*v| .{ .@"border-inline-start-style" = v.deepClone(allocator) },
            .@"border-inline-end-style" => |*v| .{ .@"border-inline-end-style" = v.deepClone(allocator) },
            .@"border-top-width" => |*v| .{ .@"border-top-width" = v.deepClone(allocator) },
            .@"border-bottom-width" => |*v| .{ .@"border-bottom-width" = v.deepClone(allocator) },
            .@"border-left-width" => |*v| .{ .@"border-left-width" = v.deepClone(allocator) },
            .@"border-right-width" => |*v| .{ .@"border-right-width" = v.deepClone(allocator) },
            .@"border-block-start-width" => |*v| .{ .@"border-block-start-width" = v.deepClone(allocator) },
            .@"border-block-end-width" => |*v| .{ .@"border-block-end-width" = v.deepClone(allocator) },
            .@"border-inline-start-width" => |*v| .{ .@"border-inline-start-width" = v.deepClone(allocator) },
            .@"border-inline-end-width" => |*v| .{ .@"border-inline-end-width" = v.deepClone(allocator) },
            .@"border-top-left-radius" => |*v| .{ .@"border-top-left-radius" = .{ v[0].deepClone(allocator), v[1] } },
            .@"border-top-right-radius" => |*v| .{ .@"border-top-right-radius" = .{ v[0].deepClone(allocator), v[1] } },
            .@"border-bottom-left-radius" => |*v| .{ .@"border-bottom-left-radius" = .{ v[0].deepClone(allocator), v[1] } },
            .@"border-bottom-right-radius" => |*v| .{ .@"border-bottom-right-radius" = .{ v[0].deepClone(allocator), v[1] } },
            .@"border-start-start-radius" => |*v| .{ .@"border-start-start-radius" = v.deepClone(allocator) },
            .@"border-start-end-radius" => |*v| .{ .@"border-start-end-radius" = v.deepClone(allocator) },
            .@"border-end-start-radius" => |*v| .{ .@"border-end-start-radius" = v.deepClone(allocator) },
            .@"border-end-end-radius" => |*v| .{ .@"border-end-end-radius" = v.deepClone(allocator) },
            .@"border-radius" => |*v| .{ .@"border-radius" = .{ v[0].deepClone(allocator), v[1] } },
            .@"border-image-source" => |*v| .{ .@"border-image-source" = v.deepClone(allocator) },
            .@"border-image-outset" => |*v| .{ .@"border-image-outset" = v.deepClone(allocator) },
            .@"border-image-repeat" => |*v| .{ .@"border-image-repeat" = v.deepClone(allocator) },
            .@"border-image-width" => |*v| .{ .@"border-image-width" = v.deepClone(allocator) },
            .@"border-image-slice" => |*v| .{ .@"border-image-slice" = v.deepClone(allocator) },
            .@"border-image" => |*v| .{ .@"border-image" = .{ v[0].deepClone(allocator), v[1] } },
            .@"border-color" => |*v| .{ .@"border-color" = v.deepClone(allocator) },
            .@"border-style" => |*v| .{ .@"border-style" = v.deepClone(allocator) },
            .@"border-width" => |*v| .{ .@"border-width" = v.deepClone(allocator) },
            .@"border-block-color" => |*v| .{ .@"border-block-color" = v.deepClone(allocator) },
            .@"border-block-style" => |*v| .{ .@"border-block-style" = v.deepClone(allocator) },
            .@"border-block-width" => |*v| .{ .@"border-block-width" = v.deepClone(allocator) },
            .@"border-inline-color" => |*v| .{ .@"border-inline-color" = v.deepClone(allocator) },
            .@"border-inline-style" => |*v| .{ .@"border-inline-style" = v.deepClone(allocator) },
            .@"border-inline-width" => |*v| .{ .@"border-inline-width" = v.deepClone(allocator) },
            .border => |*v| .{ .border = v.deepClone(allocator) },
            .@"border-top" => |*v| .{ .@"border-top" = v.deepClone(allocator) },
            .@"border-bottom" => |*v| .{ .@"border-bottom" = v.deepClone(allocator) },
            .@"border-left" => |*v| .{ .@"border-left" = v.deepClone(allocator) },
            .@"border-right" => |*v| .{ .@"border-right" = v.deepClone(allocator) },
            .@"border-block" => |*v| .{ .@"border-block" = v.deepClone(allocator) },
            .@"border-block-start" => |*v| .{ .@"border-block-start" = v.deepClone(allocator) },
            .@"border-block-end" => |*v| .{ .@"border-block-end" = v.deepClone(allocator) },
            .@"border-inline" => |*v| .{ .@"border-inline" = v.deepClone(allocator) },
            .@"border-inline-start" => |*v| .{ .@"border-inline-start" = v.deepClone(allocator) },
            .@"border-inline-end" => |*v| .{ .@"border-inline-end" = v.deepClone(allocator) },
            .outline => |*v| .{ .outline = v.deepClone(allocator) },
            .@"outline-color" => |*v| .{ .@"outline-color" = v.deepClone(allocator) },
            .@"outline-style" => |*v| .{ .@"outline-style" = v.deepClone(allocator) },
            .@"outline-width" => |*v| .{ .@"outline-width" = v.deepClone(allocator) },
            .@"flex-direction" => |*v| .{ .@"flex-direction" = .{ v[0].deepClone(allocator), v[1] } },
            .@"flex-wrap" => |*v| .{ .@"flex-wrap" = .{ v[0].deepClone(allocator), v[1] } },
            .@"flex-flow" => |*v| .{ .@"flex-flow" = .{ v[0].deepClone(allocator), v[1] } },
            .@"flex-grow" => |*v| .{ .@"flex-grow" = .{ v[0], v[1] } },
            .@"flex-shrink" => |*v| .{ .@"flex-shrink" = .{ v[0], v[1] } },
            .@"flex-basis" => |*v| .{ .@"flex-basis" = .{ v[0].deepClone(allocator), v[1] } },
            .flex => |*v| .{ .flex = .{ v[0].deepClone(allocator), v[1] } },
            .order => |*v| .{ .order = .{ v[0], v[1] } },
            .@"align-content" => |*v| .{ .@"align-content" = .{ v[0].deepClone(allocator), v[1] } },
            .@"justify-content" => |*v| .{ .@"justify-content" = .{ v[0].deepClone(allocator), v[1] } },
            .@"place-content" => |*v| .{ .@"place-content" = v.deepClone(allocator) },
            .@"align-self" => |*v| .{ .@"align-self" = .{ v[0].deepClone(allocator), v[1] } },
            .@"justify-self" => |*v| .{ .@"justify-self" = v.deepClone(allocator) },
            .@"place-self" => |*v| .{ .@"place-self" = v.deepClone(allocator) },
            .@"align-items" => |*v| .{ .@"align-items" = .{ v[0].deepClone(allocator), v[1] } },
            .@"justify-items" => |*v| .{ .@"justify-items" = v.deepClone(allocator) },
            .@"place-items" => |*v| .{ .@"place-items" = v.deepClone(allocator) },
            .@"row-gap" => |*v| .{ .@"row-gap" = v.deepClone(allocator) },
            .@"column-gap" => |*v| .{ .@"column-gap" = v.deepClone(allocator) },
            .gap => |*v| .{ .gap = v.deepClone(allocator) },
            .@"box-orient" => |*v| .{ .@"box-orient" = .{ v[0].deepClone(allocator), v[1] } },
            .@"box-direction" => |*v| .{ .@"box-direction" = .{ v[0].deepClone(allocator), v[1] } },
            .@"box-ordinal-group" => |*v| .{ .@"box-ordinal-group" = .{ v[0], v[1] } },
            .@"box-align" => |*v| .{ .@"box-align" = .{ v[0].deepClone(allocator), v[1] } },
            .@"box-flex" => |*v| .{ .@"box-flex" = .{ v[0], v[1] } },
            .@"box-flex-group" => |*v| .{ .@"box-flex-group" = .{ v[0], v[1] } },
            .@"box-pack" => |*v| .{ .@"box-pack" = .{ v[0].deepClone(allocator), v[1] } },
            .@"box-lines" => |*v| .{ .@"box-lines" = .{ v[0].deepClone(allocator), v[1] } },
            .@"flex-pack" => |*v| .{ .@"flex-pack" = .{ v[0].deepClone(allocator), v[1] } },
            .@"flex-order" => |*v| .{ .@"flex-order" = .{ v[0], v[1] } },
            .@"flex-align" => |*v| .{ .@"flex-align" = .{ v[0].deepClone(allocator), v[1] } },
            .@"flex-item-align" => |*v| .{ .@"flex-item-align" = .{ v[0].deepClone(allocator), v[1] } },
            .@"flex-line-pack" => |*v| .{ .@"flex-line-pack" = .{ v[0].deepClone(allocator), v[1] } },
            .@"flex-positive" => |*v| .{ .@"flex-positive" = .{ v[0], v[1] } },
            .@"flex-negative" => |*v| .{ .@"flex-negative" = .{ v[0], v[1] } },
            .@"flex-preferred-size" => |*v| .{ .@"flex-preferred-size" = .{ v[0].deepClone(allocator), v[1] } },
            .@"margin-top" => |*v| .{ .@"margin-top" = v.deepClone(allocator) },
            .@"margin-bottom" => |*v| .{ .@"margin-bottom" = v.deepClone(allocator) },
            .@"margin-left" => |*v| .{ .@"margin-left" = v.deepClone(allocator) },
            .@"margin-right" => |*v| .{ .@"margin-right" = v.deepClone(allocator) },
            .@"margin-block-start" => |*v| .{ .@"margin-block-start" = v.deepClone(allocator) },
            .@"margin-block-end" => |*v| .{ .@"margin-block-end" = v.deepClone(allocator) },
            .@"margin-inline-start" => |*v| .{ .@"margin-inline-start" = v.deepClone(allocator) },
            .@"margin-inline-end" => |*v| .{ .@"margin-inline-end" = v.deepClone(allocator) },
            .@"margin-block" => |*v| .{ .@"margin-block" = v.deepClone(allocator) },
            .@"margin-inline" => |*v| .{ .@"margin-inline" = v.deepClone(allocator) },
            .margin => |*v| .{ .margin = v.deepClone(allocator) },
            .@"padding-top" => |*v| .{ .@"padding-top" = v.deepClone(allocator) },
            .@"padding-bottom" => |*v| .{ .@"padding-bottom" = v.deepClone(allocator) },
            .@"padding-left" => |*v| .{ .@"padding-left" = v.deepClone(allocator) },
            .@"padding-right" => |*v| .{ .@"padding-right" = v.deepClone(allocator) },
            .@"padding-block-start" => |*v| .{ .@"padding-block-start" = v.deepClone(allocator) },
            .@"padding-block-end" => |*v| .{ .@"padding-block-end" = v.deepClone(allocator) },
            .@"padding-inline-start" => |*v| .{ .@"padding-inline-start" = v.deepClone(allocator) },
            .@"padding-inline-end" => |*v| .{ .@"padding-inline-end" = v.deepClone(allocator) },
            .@"padding-block" => |*v| .{ .@"padding-block" = v.deepClone(allocator) },
            .@"padding-inline" => |*v| .{ .@"padding-inline" = v.deepClone(allocator) },
            .padding => |*v| .{ .padding = v.deepClone(allocator) },
            .@"scroll-margin-top" => |*v| .{ .@"scroll-margin-top" = v.deepClone(allocator) },
            .@"scroll-margin-bottom" => |*v| .{ .@"scroll-margin-bottom" = v.deepClone(allocator) },
            .@"scroll-margin-left" => |*v| .{ .@"scroll-margin-left" = v.deepClone(allocator) },
            .@"scroll-margin-right" => |*v| .{ .@"scroll-margin-right" = v.deepClone(allocator) },
            .@"scroll-margin-block-start" => |*v| .{ .@"scroll-margin-block-start" = v.deepClone(allocator) },
            .@"scroll-margin-block-end" => |*v| .{ .@"scroll-margin-block-end" = v.deepClone(allocator) },
            .@"scroll-margin-inline-start" => |*v| .{ .@"scroll-margin-inline-start" = v.deepClone(allocator) },
            .@"scroll-margin-inline-end" => |*v| .{ .@"scroll-margin-inline-end" = v.deepClone(allocator) },
            .@"scroll-margin-block" => |*v| .{ .@"scroll-margin-block" = v.deepClone(allocator) },
            .@"scroll-margin-inline" => |*v| .{ .@"scroll-margin-inline" = v.deepClone(allocator) },
            .@"scroll-margin" => |*v| .{ .@"scroll-margin" = v.deepClone(allocator) },
            .@"scroll-padding-top" => |*v| .{ .@"scroll-padding-top" = v.deepClone(allocator) },
            .@"scroll-padding-bottom" => |*v| .{ .@"scroll-padding-bottom" = v.deepClone(allocator) },
            .@"scroll-padding-left" => |*v| .{ .@"scroll-padding-left" = v.deepClone(allocator) },
            .@"scroll-padding-right" => |*v| .{ .@"scroll-padding-right" = v.deepClone(allocator) },
            .@"scroll-padding-block-start" => |*v| .{ .@"scroll-padding-block-start" = v.deepClone(allocator) },
            .@"scroll-padding-block-end" => |*v| .{ .@"scroll-padding-block-end" = v.deepClone(allocator) },
            .@"scroll-padding-inline-start" => |*v| .{ .@"scroll-padding-inline-start" = v.deepClone(allocator) },
            .@"scroll-padding-inline-end" => |*v| .{ .@"scroll-padding-inline-end" = v.deepClone(allocator) },
            .@"scroll-padding-block" => |*v| .{ .@"scroll-padding-block" = v.deepClone(allocator) },
            .@"scroll-padding-inline" => |*v| .{ .@"scroll-padding-inline" = v.deepClone(allocator) },
            .@"scroll-padding" => |*v| .{ .@"scroll-padding" = v.deepClone(allocator) },
            .@"font-weight" => |*v| .{ .@"font-weight" = v.deepClone(allocator) },
            .@"font-size" => |*v| .{ .@"font-size" = v.deepClone(allocator) },
            .@"font-stretch" => |*v| .{ .@"font-stretch" = v.deepClone(allocator) },
            .@"font-family" => |*v| .{ .@"font-family" = css.generic.deepClone(BabyList(FontFamily), v, allocator) },
            .@"font-style" => |*v| .{ .@"font-style" = v.deepClone(allocator) },
            .@"font-variant-caps" => |*v| .{ .@"font-variant-caps" = v.deepClone(allocator) },
            .@"line-height" => |*v| .{ .@"line-height" = v.deepClone(allocator) },
            .font => |*v| .{ .font = v.deepClone(allocator) },
            .@"text-decoration-color" => |*v| .{ .@"text-decoration-color" = .{ v[0].deepClone(allocator), v[1] } },
            .@"text-emphasis-color" => |*v| .{ .@"text-emphasis-color" = .{ v[0].deepClone(allocator), v[1] } },
            .@"text-shadow" => |*v| .{ .@"text-shadow" = v.deepClone(allocator) },
            .direction => |*v| .{ .direction = v.deepClone(allocator) },
            .composes => |*v| .{ .composes = v.deepClone(allocator) },
            .@"mask-image" => |*v| .{ .@"mask-image" = .{ v[0].deepClone(allocator), v[1] } },
            .@"mask-mode" => |*v| .{ .@"mask-mode" = v.deepClone(allocator) },
            .@"mask-repeat" => |*v| .{ .@"mask-repeat" = .{ v[0].deepClone(allocator), v[1] } },
            .@"mask-position-x" => |*v| .{ .@"mask-position-x" = v.deepClone(allocator) },
            .@"mask-position-y" => |*v| .{ .@"mask-position-y" = v.deepClone(allocator) },
            .@"mask-position" => |*v| .{ .@"mask-position" = .{ v[0].deepClone(allocator), v[1] } },
            .@"mask-clip" => |*v| .{ .@"mask-clip" = .{ v[0].deepClone(allocator), v[1] } },
            .@"mask-origin" => |*v| .{ .@"mask-origin" = .{ v[0].deepClone(allocator), v[1] } },
            .@"mask-size" => |*v| .{ .@"mask-size" = .{ v[0].deepClone(allocator), v[1] } },
            .@"mask-composite" => |*v| .{ .@"mask-composite" = v.deepClone(allocator) },
            .@"mask-type" => |*v| .{ .@"mask-type" = v.deepClone(allocator) },
            .mask => |*v| .{ .mask = .{ v[0].deepClone(allocator), v[1] } },
            .@"mask-border-source" => |*v| .{ .@"mask-border-source" = v.deepClone(allocator) },
            .@"mask-border-mode" => |*v| .{ .@"mask-border-mode" = v.deepClone(allocator) },
            .@"mask-border-slice" => |*v| .{ .@"mask-border-slice" = v.deepClone(allocator) },
            .@"mask-border-width" => |*v| .{ .@"mask-border-width" = v.deepClone(allocator) },
            .@"mask-border-outset" => |*v| .{ .@"mask-border-outset" = v.deepClone(allocator) },
            .@"mask-border-repeat" => |*v| .{ .@"mask-border-repeat" = v.deepClone(allocator) },
            .@"mask-border" => |*v| .{ .@"mask-border" = v.deepClone(allocator) },
            .@"-webkit-mask-composite" => |*v| .{ .@"-webkit-mask-composite" = v.deepClone(allocator) },
            .@"mask-source-type" => |*v| .{ .@"mask-source-type" = .{ v[0].deepClone(allocator), v[1] } },
            .@"mask-box-image" => |*v| .{ .@"mask-box-image" = .{ v[0].deepClone(allocator), v[1] } },
            .@"mask-box-image-source" => |*v| .{ .@"mask-box-image-source" = .{ v[0].deepClone(allocator), v[1] } },
            .@"mask-box-image-slice" => |*v| .{ .@"mask-box-image-slice" = .{ v[0].deepClone(allocator), v[1] } },
            .@"mask-box-image-width" => |*v| .{ .@"mask-box-image-width" = .{ v[0].deepClone(allocator), v[1] } },
            .@"mask-box-image-outset" => |*v| .{ .@"mask-box-image-outset" = .{ v[0].deepClone(allocator), v[1] } },
            .@"mask-box-image-repeat" => |*v| .{ .@"mask-box-image-repeat" = .{ v[0].deepClone(allocator), v[1] } },
            .all => |*a| return .{ .all = a.deepClone(allocator) },
            .unparsed => |*u| return .{ .unparsed = u.deepClone(allocator) },
            .custom => |*c| return .{ .custom = c.deepClone(allocator) },
        };
    }

    /// We're going to have this empty for now since not every property has a deinit function.
    /// It's not strictly necessary since all allocations are into an arena.
    /// It's mostly intended as a performance optimization in the case where mimalloc arena is used,
    /// since it can reclaim the memory and use it for subsequent allocations.
    /// I haven't benchmarked that though, so I don't actually know how much faster it would actually make it.
    pub fn deinit(this: *@This(), allocator: std.mem.Allocator) void {
        _ = this;
        _ = allocator;
    }

    pub inline fn __toCssHelper(this: *const Property) struct { []const u8, VendorPrefix } {
        return switch (this.*) {
            .@"background-color" => .{ "background-color", VendorPrefix{ .none = true } },
            .@"background-image" => .{ "background-image", VendorPrefix{ .none = true } },
            .@"background-position-x" => .{ "background-position-x", VendorPrefix{ .none = true } },
            .@"background-position-y" => .{ "background-position-y", VendorPrefix{ .none = true } },
            .@"background-position" => .{ "background-position", VendorPrefix{ .none = true } },
            .@"background-size" => .{ "background-size", VendorPrefix{ .none = true } },
            .@"background-repeat" => .{ "background-repeat", VendorPrefix{ .none = true } },
            .@"background-attachment" => .{ "background-attachment", VendorPrefix{ .none = true } },
            .@"background-clip" => |*x| .{ "background-clip", x.@"1" },
            .@"background-origin" => .{ "background-origin", VendorPrefix{ .none = true } },
            .background => .{ "background", VendorPrefix{ .none = true } },
            .@"box-shadow" => |*x| .{ "box-shadow", x.@"1" },
            .opacity => .{ "opacity", VendorPrefix{ .none = true } },
            .color => .{ "color", VendorPrefix{ .none = true } },
            .display => .{ "display", VendorPrefix{ .none = true } },
            .visibility => .{ "visibility", VendorPrefix{ .none = true } },
            .width => .{ "width", VendorPrefix{ .none = true } },
            .height => .{ "height", VendorPrefix{ .none = true } },
            .@"min-width" => .{ "min-width", VendorPrefix{ .none = true } },
            .@"min-height" => .{ "min-height", VendorPrefix{ .none = true } },
            .@"max-width" => .{ "max-width", VendorPrefix{ .none = true } },
            .@"max-height" => .{ "max-height", VendorPrefix{ .none = true } },
            .@"block-size" => .{ "block-size", VendorPrefix{ .none = true } },
            .@"inline-size" => .{ "inline-size", VendorPrefix{ .none = true } },
            .@"min-block-size" => .{ "min-block-size", VendorPrefix{ .none = true } },
            .@"min-inline-size" => .{ "min-inline-size", VendorPrefix{ .none = true } },
            .@"max-block-size" => .{ "max-block-size", VendorPrefix{ .none = true } },
            .@"max-inline-size" => .{ "max-inline-size", VendorPrefix{ .none = true } },
            .@"box-sizing" => |*x| .{ "box-sizing", x.@"1" },
            .@"aspect-ratio" => .{ "aspect-ratio", VendorPrefix{ .none = true } },
            .overflow => .{ "overflow", VendorPrefix{ .none = true } },
            .@"overflow-x" => .{ "overflow-x", VendorPrefix{ .none = true } },
            .@"overflow-y" => .{ "overflow-y", VendorPrefix{ .none = true } },
            .@"text-overflow" => |*x| .{ "text-overflow", x.@"1" },
            .position => .{ "position", VendorPrefix{ .none = true } },
            .top => .{ "top", VendorPrefix{ .none = true } },
            .bottom => .{ "bottom", VendorPrefix{ .none = true } },
            .left => .{ "left", VendorPrefix{ .none = true } },
            .right => .{ "right", VendorPrefix{ .none = true } },
            .@"inset-block-start" => .{ "inset-block-start", VendorPrefix{ .none = true } },
            .@"inset-block-end" => .{ "inset-block-end", VendorPrefix{ .none = true } },
            .@"inset-inline-start" => .{ "inset-inline-start", VendorPrefix{ .none = true } },
            .@"inset-inline-end" => .{ "inset-inline-end", VendorPrefix{ .none = true } },
            .@"inset-block" => .{ "inset-block", VendorPrefix{ .none = true } },
            .@"inset-inline" => .{ "inset-inline", VendorPrefix{ .none = true } },
            .inset => .{ "inset", VendorPrefix{ .none = true } },
            .@"border-spacing" => .{ "border-spacing", VendorPrefix{ .none = true } },
            .@"border-top-color" => .{ "border-top-color", VendorPrefix{ .none = true } },
            .@"border-bottom-color" => .{ "border-bottom-color", VendorPrefix{ .none = true } },
            .@"border-left-color" => .{ "border-left-color", VendorPrefix{ .none = true } },
            .@"border-right-color" => .{ "border-right-color", VendorPrefix{ .none = true } },
            .@"border-block-start-color" => .{ "border-block-start-color", VendorPrefix{ .none = true } },
            .@"border-block-end-color" => .{ "border-block-end-color", VendorPrefix{ .none = true } },
            .@"border-inline-start-color" => .{ "border-inline-start-color", VendorPrefix{ .none = true } },
            .@"border-inline-end-color" => .{ "border-inline-end-color", VendorPrefix{ .none = true } },
            .@"border-top-style" => .{ "border-top-style", VendorPrefix{ .none = true } },
            .@"border-bottom-style" => .{ "border-bottom-style", VendorPrefix{ .none = true } },
            .@"border-left-style" => .{ "border-left-style", VendorPrefix{ .none = true } },
            .@"border-right-style" => .{ "border-right-style", VendorPrefix{ .none = true } },
            .@"border-block-start-style" => .{ "border-block-start-style", VendorPrefix{ .none = true } },
            .@"border-block-end-style" => .{ "border-block-end-style", VendorPrefix{ .none = true } },
            .@"border-inline-start-style" => .{ "border-inline-start-style", VendorPrefix{ .none = true } },
            .@"border-inline-end-style" => .{ "border-inline-end-style", VendorPrefix{ .none = true } },
            .@"border-top-width" => .{ "border-top-width", VendorPrefix{ .none = true } },
            .@"border-bottom-width" => .{ "border-bottom-width", VendorPrefix{ .none = true } },
            .@"border-left-width" => .{ "border-left-width", VendorPrefix{ .none = true } },
            .@"border-right-width" => .{ "border-right-width", VendorPrefix{ .none = true } },
            .@"border-block-start-width" => .{ "border-block-start-width", VendorPrefix{ .none = true } },
            .@"border-block-end-width" => .{ "border-block-end-width", VendorPrefix{ .none = true } },
            .@"border-inline-start-width" => .{ "border-inline-start-width", VendorPrefix{ .none = true } },
            .@"border-inline-end-width" => .{ "border-inline-end-width", VendorPrefix{ .none = true } },
            .@"border-top-left-radius" => |*x| .{ "border-top-left-radius", x.@"1" },
            .@"border-top-right-radius" => |*x| .{ "border-top-right-radius", x.@"1" },
            .@"border-bottom-left-radius" => |*x| .{ "border-bottom-left-radius", x.@"1" },
            .@"border-bottom-right-radius" => |*x| .{ "border-bottom-right-radius", x.@"1" },
            .@"border-start-start-radius" => .{ "border-start-start-radius", VendorPrefix{ .none = true } },
            .@"border-start-end-radius" => .{ "border-start-end-radius", VendorPrefix{ .none = true } },
            .@"border-end-start-radius" => .{ "border-end-start-radius", VendorPrefix{ .none = true } },
            .@"border-end-end-radius" => .{ "border-end-end-radius", VendorPrefix{ .none = true } },
            .@"border-radius" => |*x| .{ "border-radius", x.@"1" },
            .@"border-image-source" => .{ "border-image-source", VendorPrefix{ .none = true } },
            .@"border-image-outset" => .{ "border-image-outset", VendorPrefix{ .none = true } },
            .@"border-image-repeat" => .{ "border-image-repeat", VendorPrefix{ .none = true } },
            .@"border-image-width" => .{ "border-image-width", VendorPrefix{ .none = true } },
            .@"border-image-slice" => .{ "border-image-slice", VendorPrefix{ .none = true } },
            .@"border-image" => |*x| .{ "border-image", x.@"1" },
            .@"border-color" => .{ "border-color", VendorPrefix{ .none = true } },
            .@"border-style" => .{ "border-style", VendorPrefix{ .none = true } },
            .@"border-width" => .{ "border-width", VendorPrefix{ .none = true } },
            .@"border-block-color" => .{ "border-block-color", VendorPrefix{ .none = true } },
            .@"border-block-style" => .{ "border-block-style", VendorPrefix{ .none = true } },
            .@"border-block-width" => .{ "border-block-width", VendorPrefix{ .none = true } },
            .@"border-inline-color" => .{ "border-inline-color", VendorPrefix{ .none = true } },
            .@"border-inline-style" => .{ "border-inline-style", VendorPrefix{ .none = true } },
            .@"border-inline-width" => .{ "border-inline-width", VendorPrefix{ .none = true } },
            .border => .{ "border", VendorPrefix{ .none = true } },
            .@"border-top" => .{ "border-top", VendorPrefix{ .none = true } },
            .@"border-bottom" => .{ "border-bottom", VendorPrefix{ .none = true } },
            .@"border-left" => .{ "border-left", VendorPrefix{ .none = true } },
            .@"border-right" => .{ "border-right", VendorPrefix{ .none = true } },
            .@"border-block" => .{ "border-block", VendorPrefix{ .none = true } },
            .@"border-block-start" => .{ "border-block-start", VendorPrefix{ .none = true } },
            .@"border-block-end" => .{ "border-block-end", VendorPrefix{ .none = true } },
            .@"border-inline" => .{ "border-inline", VendorPrefix{ .none = true } },
            .@"border-inline-start" => .{ "border-inline-start", VendorPrefix{ .none = true } },
            .@"border-inline-end" => .{ "border-inline-end", VendorPrefix{ .none = true } },
            .outline => .{ "outline", VendorPrefix{ .none = true } },
            .@"outline-color" => .{ "outline-color", VendorPrefix{ .none = true } },
            .@"outline-style" => .{ "outline-style", VendorPrefix{ .none = true } },
            .@"outline-width" => .{ "outline-width", VendorPrefix{ .none = true } },
            .@"flex-direction" => |*x| .{ "flex-direction", x.@"1" },
            .@"flex-wrap" => |*x| .{ "flex-wrap", x.@"1" },
            .@"flex-flow" => |*x| .{ "flex-flow", x.@"1" },
            .@"flex-grow" => |*x| .{ "flex-grow", x.@"1" },
            .@"flex-shrink" => |*x| .{ "flex-shrink", x.@"1" },
            .@"flex-basis" => |*x| .{ "flex-basis", x.@"1" },
            .flex => |*x| .{ "flex", x.@"1" },
            .order => |*x| .{ "order", x.@"1" },
            .@"align-content" => |*x| .{ "align-content", x.@"1" },
            .@"justify-content" => |*x| .{ "justify-content", x.@"1" },
            .@"place-content" => .{ "place-content", VendorPrefix{ .none = true } },
            .@"align-self" => |*x| .{ "align-self", x.@"1" },
            .@"justify-self" => .{ "justify-self", VendorPrefix{ .none = true } },
            .@"place-self" => .{ "place-self", VendorPrefix{ .none = true } },
            .@"align-items" => |*x| .{ "align-items", x.@"1" },
            .@"justify-items" => .{ "justify-items", VendorPrefix{ .none = true } },
            .@"place-items" => .{ "place-items", VendorPrefix{ .none = true } },
            .@"row-gap" => .{ "row-gap", VendorPrefix{ .none = true } },
            .@"column-gap" => .{ "column-gap", VendorPrefix{ .none = true } },
            .gap => .{ "gap", VendorPrefix{ .none = true } },
            .@"box-orient" => |*x| .{ "box-orient", x.@"1" },
            .@"box-direction" => |*x| .{ "box-direction", x.@"1" },
            .@"box-ordinal-group" => |*x| .{ "box-ordinal-group", x.@"1" },
            .@"box-align" => |*x| .{ "box-align", x.@"1" },
            .@"box-flex" => |*x| .{ "box-flex", x.@"1" },
            .@"box-flex-group" => |*x| .{ "box-flex-group", x.@"1" },
            .@"box-pack" => |*x| .{ "box-pack", x.@"1" },
            .@"box-lines" => |*x| .{ "box-lines", x.@"1" },
            .@"flex-pack" => |*x| .{ "flex-pack", x.@"1" },
            .@"flex-order" => |*x| .{ "flex-order", x.@"1" },
            .@"flex-align" => |*x| .{ "flex-align", x.@"1" },
            .@"flex-item-align" => |*x| .{ "flex-item-align", x.@"1" },
            .@"flex-line-pack" => |*x| .{ "flex-line-pack", x.@"1" },
            .@"flex-positive" => |*x| .{ "flex-positive", x.@"1" },
            .@"flex-negative" => |*x| .{ "flex-negative", x.@"1" },
            .@"flex-preferred-size" => |*x| .{ "flex-preferred-size", x.@"1" },
            .@"margin-top" => .{ "margin-top", VendorPrefix{ .none = true } },
            .@"margin-bottom" => .{ "margin-bottom", VendorPrefix{ .none = true } },
            .@"margin-left" => .{ "margin-left", VendorPrefix{ .none = true } },
            .@"margin-right" => .{ "margin-right", VendorPrefix{ .none = true } },
            .@"margin-block-start" => .{ "margin-block-start", VendorPrefix{ .none = true } },
            .@"margin-block-end" => .{ "margin-block-end", VendorPrefix{ .none = true } },
            .@"margin-inline-start" => .{ "margin-inline-start", VendorPrefix{ .none = true } },
            .@"margin-inline-end" => .{ "margin-inline-end", VendorPrefix{ .none = true } },
            .@"margin-block" => .{ "margin-block", VendorPrefix{ .none = true } },
            .@"margin-inline" => .{ "margin-inline", VendorPrefix{ .none = true } },
            .margin => .{ "margin", VendorPrefix{ .none = true } },
            .@"padding-top" => .{ "padding-top", VendorPrefix{ .none = true } },
            .@"padding-bottom" => .{ "padding-bottom", VendorPrefix{ .none = true } },
            .@"padding-left" => .{ "padding-left", VendorPrefix{ .none = true } },
            .@"padding-right" => .{ "padding-right", VendorPrefix{ .none = true } },
            .@"padding-block-start" => .{ "padding-block-start", VendorPrefix{ .none = true } },
            .@"padding-block-end" => .{ "padding-block-end", VendorPrefix{ .none = true } },
            .@"padding-inline-start" => .{ "padding-inline-start", VendorPrefix{ .none = true } },
            .@"padding-inline-end" => .{ "padding-inline-end", VendorPrefix{ .none = true } },
            .@"padding-block" => .{ "padding-block", VendorPrefix{ .none = true } },
            .@"padding-inline" => .{ "padding-inline", VendorPrefix{ .none = true } },
            .padding => .{ "padding", VendorPrefix{ .none = true } },
            .@"scroll-margin-top" => .{ "scroll-margin-top", VendorPrefix{ .none = true } },
            .@"scroll-margin-bottom" => .{ "scroll-margin-bottom", VendorPrefix{ .none = true } },
            .@"scroll-margin-left" => .{ "scroll-margin-left", VendorPrefix{ .none = true } },
            .@"scroll-margin-right" => .{ "scroll-margin-right", VendorPrefix{ .none = true } },
            .@"scroll-margin-block-start" => .{ "scroll-margin-block-start", VendorPrefix{ .none = true } },
            .@"scroll-margin-block-end" => .{ "scroll-margin-block-end", VendorPrefix{ .none = true } },
            .@"scroll-margin-inline-start" => .{ "scroll-margin-inline-start", VendorPrefix{ .none = true } },
            .@"scroll-margin-inline-end" => .{ "scroll-margin-inline-end", VendorPrefix{ .none = true } },
            .@"scroll-margin-block" => .{ "scroll-margin-block", VendorPrefix{ .none = true } },
            .@"scroll-margin-inline" => .{ "scroll-margin-inline", VendorPrefix{ .none = true } },
            .@"scroll-margin" => .{ "scroll-margin", VendorPrefix{ .none = true } },
            .@"scroll-padding-top" => .{ "scroll-padding-top", VendorPrefix{ .none = true } },
            .@"scroll-padding-bottom" => .{ "scroll-padding-bottom", VendorPrefix{ .none = true } },
            .@"scroll-padding-left" => .{ "scroll-padding-left", VendorPrefix{ .none = true } },
            .@"scroll-padding-right" => .{ "scroll-padding-right", VendorPrefix{ .none = true } },
            .@"scroll-padding-block-start" => .{ "scroll-padding-block-start", VendorPrefix{ .none = true } },
            .@"scroll-padding-block-end" => .{ "scroll-padding-block-end", VendorPrefix{ .none = true } },
            .@"scroll-padding-inline-start" => .{ "scroll-padding-inline-start", VendorPrefix{ .none = true } },
            .@"scroll-padding-inline-end" => .{ "scroll-padding-inline-end", VendorPrefix{ .none = true } },
            .@"scroll-padding-block" => .{ "scroll-padding-block", VendorPrefix{ .none = true } },
            .@"scroll-padding-inline" => .{ "scroll-padding-inline", VendorPrefix{ .none = true } },
            .@"scroll-padding" => .{ "scroll-padding", VendorPrefix{ .none = true } },
            .@"font-weight" => .{ "font-weight", VendorPrefix{ .none = true } },
            .@"font-size" => .{ "font-size", VendorPrefix{ .none = true } },
            .@"font-stretch" => .{ "font-stretch", VendorPrefix{ .none = true } },
            .@"font-family" => .{ "font-family", VendorPrefix{ .none = true } },
            .@"font-style" => .{ "font-style", VendorPrefix{ .none = true } },
            .@"font-variant-caps" => .{ "font-variant-caps", VendorPrefix{ .none = true } },
            .@"line-height" => .{ "line-height", VendorPrefix{ .none = true } },
            .font => .{ "font", VendorPrefix{ .none = true } },
            .@"text-decoration-color" => |*x| .{ "text-decoration-color", x.@"1" },
            .@"text-emphasis-color" => |*x| .{ "text-emphasis-color", x.@"1" },
            .@"text-shadow" => .{ "text-shadow", VendorPrefix{ .none = true } },
            .direction => .{ "direction", VendorPrefix{ .none = true } },
            .composes => .{ "composes", VendorPrefix{ .none = true } },
            .@"mask-image" => |*x| .{ "mask-image", x.@"1" },
            .@"mask-mode" => .{ "mask-mode", VendorPrefix{ .none = true } },
            .@"mask-repeat" => |*x| .{ "mask-repeat", x.@"1" },
            .@"mask-position-x" => .{ "mask-position-x", VendorPrefix{ .none = true } },
            .@"mask-position-y" => .{ "mask-position-y", VendorPrefix{ .none = true } },
            .@"mask-position" => |*x| .{ "mask-position", x.@"1" },
            .@"mask-clip" => |*x| .{ "mask-clip", x.@"1" },
            .@"mask-origin" => |*x| .{ "mask-origin", x.@"1" },
            .@"mask-size" => |*x| .{ "mask-size", x.@"1" },
            .@"mask-composite" => .{ "mask-composite", VendorPrefix{ .none = true } },
            .@"mask-type" => .{ "mask-type", VendorPrefix{ .none = true } },
            .mask => |*x| .{ "mask", x.@"1" },
            .@"mask-border-source" => .{ "mask-border-source", VendorPrefix{ .none = true } },
            .@"mask-border-mode" => .{ "mask-border-mode", VendorPrefix{ .none = true } },
            .@"mask-border-slice" => .{ "mask-border-slice", VendorPrefix{ .none = true } },
            .@"mask-border-width" => .{ "mask-border-width", VendorPrefix{ .none = true } },
            .@"mask-border-outset" => .{ "mask-border-outset", VendorPrefix{ .none = true } },
            .@"mask-border-repeat" => .{ "mask-border-repeat", VendorPrefix{ .none = true } },
            .@"mask-border" => .{ "mask-border", VendorPrefix{ .none = true } },
            .@"-webkit-mask-composite" => .{ "-webkit-mask-composite", VendorPrefix{ .none = true } },
            .@"mask-source-type" => |*x| .{ "mask-source-type", x.@"1" },
            .@"mask-box-image" => |*x| .{ "mask-box-image", x.@"1" },
            .@"mask-box-image-source" => |*x| .{ "mask-box-image-source", x.@"1" },
            .@"mask-box-image-slice" => |*x| .{ "mask-box-image-slice", x.@"1" },
            .@"mask-box-image-width" => |*x| .{ "mask-box-image-width", x.@"1" },
            .@"mask-box-image-outset" => |*x| .{ "mask-box-image-outset", x.@"1" },
            .@"mask-box-image-repeat" => |*x| .{ "mask-box-image-repeat", x.@"1" },
            .all => .{ "all", VendorPrefix{ .none = true } },
            .unparsed => |*unparsed| brk: {
                var prefix = unparsed.property_id.prefix();
                if (prefix.isEmpty()) {
                    prefix = VendorPrefix{ .none = true };
                }
                break :brk .{ unparsed.property_id.name(), prefix };
            },
            .custom => unreachable,
        };
    }

    /// Serializes the value of a CSS property without its name or `!important` flag.
    pub fn valueToCss(this: *const Property, comptime W: type, dest: *css.Printer(W)) PrintErr!void {
        return switch (this.*) {
            .@"background-color" => |*value| value.toCss(W, dest),
            .@"background-image" => |*value| value.toCss(W, dest),
            .@"background-position-x" => |*value| value.toCss(W, dest),
            .@"background-position-y" => |*value| value.toCss(W, dest),
            .@"background-position" => |*value| value.toCss(W, dest),
            .@"background-size" => |*value| value.toCss(W, dest),
            .@"background-repeat" => |*value| value.toCss(W, dest),
            .@"background-attachment" => |*value| value.toCss(W, dest),
            .@"background-clip" => |*value| value[0].toCss(W, dest),
            .@"background-origin" => |*value| value.toCss(W, dest),
            .background => |*value| value.toCss(W, dest),
            .@"box-shadow" => |*value| value[0].toCss(W, dest),
            .opacity => |*value| value.toCss(W, dest),
            .color => |*value| value.toCss(W, dest),
            .display => |*value| value.toCss(W, dest),
            .visibility => |*value| value.toCss(W, dest),
            .width => |*value| value.toCss(W, dest),
            .height => |*value| value.toCss(W, dest),
            .@"min-width" => |*value| value.toCss(W, dest),
            .@"min-height" => |*value| value.toCss(W, dest),
            .@"max-width" => |*value| value.toCss(W, dest),
            .@"max-height" => |*value| value.toCss(W, dest),
            .@"block-size" => |*value| value.toCss(W, dest),
            .@"inline-size" => |*value| value.toCss(W, dest),
            .@"min-block-size" => |*value| value.toCss(W, dest),
            .@"min-inline-size" => |*value| value.toCss(W, dest),
            .@"max-block-size" => |*value| value.toCss(W, dest),
            .@"max-inline-size" => |*value| value.toCss(W, dest),
            .@"box-sizing" => |*value| value[0].toCss(W, dest),
            .@"aspect-ratio" => |*value| value.toCss(W, dest),
            .overflow => |*value| value.toCss(W, dest),
            .@"overflow-x" => |*value| value.toCss(W, dest),
            .@"overflow-y" => |*value| value.toCss(W, dest),
            .@"text-overflow" => |*value| value[0].toCss(W, dest),
            .position => |*value| value.toCss(W, dest),
            .top => |*value| value.toCss(W, dest),
            .bottom => |*value| value.toCss(W, dest),
            .left => |*value| value.toCss(W, dest),
            .right => |*value| value.toCss(W, dest),
            .@"inset-block-start" => |*value| value.toCss(W, dest),
            .@"inset-block-end" => |*value| value.toCss(W, dest),
            .@"inset-inline-start" => |*value| value.toCss(W, dest),
            .@"inset-inline-end" => |*value| value.toCss(W, dest),
            .@"inset-block" => |*value| value.toCss(W, dest),
            .@"inset-inline" => |*value| value.toCss(W, dest),
            .inset => |*value| value.toCss(W, dest),
            .@"border-spacing" => |*value| value.toCss(W, dest),
            .@"border-top-color" => |*value| value.toCss(W, dest),
            .@"border-bottom-color" => |*value| value.toCss(W, dest),
            .@"border-left-color" => |*value| value.toCss(W, dest),
            .@"border-right-color" => |*value| value.toCss(W, dest),
            .@"border-block-start-color" => |*value| value.toCss(W, dest),
            .@"border-block-end-color" => |*value| value.toCss(W, dest),
            .@"border-inline-start-color" => |*value| value.toCss(W, dest),
            .@"border-inline-end-color" => |*value| value.toCss(W, dest),
            .@"border-top-style" => |*value| value.toCss(W, dest),
            .@"border-bottom-style" => |*value| value.toCss(W, dest),
            .@"border-left-style" => |*value| value.toCss(W, dest),
            .@"border-right-style" => |*value| value.toCss(W, dest),
            .@"border-block-start-style" => |*value| value.toCss(W, dest),
            .@"border-block-end-style" => |*value| value.toCss(W, dest),
            .@"border-inline-start-style" => |*value| value.toCss(W, dest),
            .@"border-inline-end-style" => |*value| value.toCss(W, dest),
            .@"border-top-width" => |*value| value.toCss(W, dest),
            .@"border-bottom-width" => |*value| value.toCss(W, dest),
            .@"border-left-width" => |*value| value.toCss(W, dest),
            .@"border-right-width" => |*value| value.toCss(W, dest),
            .@"border-block-start-width" => |*value| value.toCss(W, dest),
            .@"border-block-end-width" => |*value| value.toCss(W, dest),
            .@"border-inline-start-width" => |*value| value.toCss(W, dest),
            .@"border-inline-end-width" => |*value| value.toCss(W, dest),
            .@"border-top-left-radius" => |*value| value[0].toCss(W, dest),
            .@"border-top-right-radius" => |*value| value[0].toCss(W, dest),
            .@"border-bottom-left-radius" => |*value| value[0].toCss(W, dest),
            .@"border-bottom-right-radius" => |*value| value[0].toCss(W, dest),
            .@"border-start-start-radius" => |*value| value.toCss(W, dest),
            .@"border-start-end-radius" => |*value| value.toCss(W, dest),
            .@"border-end-start-radius" => |*value| value.toCss(W, dest),
            .@"border-end-end-radius" => |*value| value.toCss(W, dest),
            .@"border-radius" => |*value| value[0].toCss(W, dest),
            .@"border-image-source" => |*value| value.toCss(W, dest),
            .@"border-image-outset" => |*value| value.toCss(W, dest),
            .@"border-image-repeat" => |*value| value.toCss(W, dest),
            .@"border-image-width" => |*value| value.toCss(W, dest),
            .@"border-image-slice" => |*value| value.toCss(W, dest),
            .@"border-image" => |*value| value[0].toCss(W, dest),
            .@"border-color" => |*value| value.toCss(W, dest),
            .@"border-style" => |*value| value.toCss(W, dest),
            .@"border-width" => |*value| value.toCss(W, dest),
            .@"border-block-color" => |*value| value.toCss(W, dest),
            .@"border-block-style" => |*value| value.toCss(W, dest),
            .@"border-block-width" => |*value| value.toCss(W, dest),
            .@"border-inline-color" => |*value| value.toCss(W, dest),
            .@"border-inline-style" => |*value| value.toCss(W, dest),
            .@"border-inline-width" => |*value| value.toCss(W, dest),
            .border => |*value| value.toCss(W, dest),
            .@"border-top" => |*value| value.toCss(W, dest),
            .@"border-bottom" => |*value| value.toCss(W, dest),
            .@"border-left" => |*value| value.toCss(W, dest),
            .@"border-right" => |*value| value.toCss(W, dest),
            .@"border-block" => |*value| value.toCss(W, dest),
            .@"border-block-start" => |*value| value.toCss(W, dest),
            .@"border-block-end" => |*value| value.toCss(W, dest),
            .@"border-inline" => |*value| value.toCss(W, dest),
            .@"border-inline-start" => |*value| value.toCss(W, dest),
            .@"border-inline-end" => |*value| value.toCss(W, dest),
            .outline => |*value| value.toCss(W, dest),
            .@"outline-color" => |*value| value.toCss(W, dest),
            .@"outline-style" => |*value| value.toCss(W, dest),
            .@"outline-width" => |*value| value.toCss(W, dest),
            .@"flex-direction" => |*value| value[0].toCss(W, dest),
            .@"flex-wrap" => |*value| value[0].toCss(W, dest),
            .@"flex-flow" => |*value| value[0].toCss(W, dest),
            .@"flex-grow" => |*value| CSSNumberFns.toCss(&value[0], W, dest),
            .@"flex-shrink" => |*value| CSSNumberFns.toCss(&value[0], W, dest),
            .@"flex-basis" => |*value| value[0].toCss(W, dest),
            .flex => |*value| value[0].toCss(W, dest),
            .order => |*value| CSSIntegerFns.toCss(&value[0], W, dest),
            .@"align-content" => |*value| value[0].toCss(W, dest),
            .@"justify-content" => |*value| value[0].toCss(W, dest),
            .@"place-content" => |*value| value.toCss(W, dest),
            .@"align-self" => |*value| value[0].toCss(W, dest),
            .@"justify-self" => |*value| value.toCss(W, dest),
            .@"place-self" => |*value| value.toCss(W, dest),
            .@"align-items" => |*value| value[0].toCss(W, dest),
            .@"justify-items" => |*value| value.toCss(W, dest),
            .@"place-items" => |*value| value.toCss(W, dest),
            .@"row-gap" => |*value| value.toCss(W, dest),
            .@"column-gap" => |*value| value.toCss(W, dest),
            .gap => |*value| value.toCss(W, dest),
            .@"box-orient" => |*value| value[0].toCss(W, dest),
            .@"box-direction" => |*value| value[0].toCss(W, dest),
            .@"box-ordinal-group" => |*value| CSSIntegerFns.toCss(&value[0], W, dest),
            .@"box-align" => |*value| value[0].toCss(W, dest),
            .@"box-flex" => |*value| CSSNumberFns.toCss(&value[0], W, dest),
            .@"box-flex-group" => |*value| CSSIntegerFns.toCss(&value[0], W, dest),
            .@"box-pack" => |*value| value[0].toCss(W, dest),
            .@"box-lines" => |*value| value[0].toCss(W, dest),
            .@"flex-pack" => |*value| value[0].toCss(W, dest),
            .@"flex-order" => |*value| CSSIntegerFns.toCss(&value[0], W, dest),
            .@"flex-align" => |*value| value[0].toCss(W, dest),
            .@"flex-item-align" => |*value| value[0].toCss(W, dest),
            .@"flex-line-pack" => |*value| value[0].toCss(W, dest),
            .@"flex-positive" => |*value| CSSNumberFns.toCss(&value[0], W, dest),
            .@"flex-negative" => |*value| CSSNumberFns.toCss(&value[0], W, dest),
            .@"flex-preferred-size" => |*value| value[0].toCss(W, dest),
            .@"margin-top" => |*value| value.toCss(W, dest),
            .@"margin-bottom" => |*value| value.toCss(W, dest),
            .@"margin-left" => |*value| value.toCss(W, dest),
            .@"margin-right" => |*value| value.toCss(W, dest),
            .@"margin-block-start" => |*value| value.toCss(W, dest),
            .@"margin-block-end" => |*value| value.toCss(W, dest),
            .@"margin-inline-start" => |*value| value.toCss(W, dest),
            .@"margin-inline-end" => |*value| value.toCss(W, dest),
            .@"margin-block" => |*value| value.toCss(W, dest),
            .@"margin-inline" => |*value| value.toCss(W, dest),
            .margin => |*value| value.toCss(W, dest),
            .@"padding-top" => |*value| value.toCss(W, dest),
            .@"padding-bottom" => |*value| value.toCss(W, dest),
            .@"padding-left" => |*value| value.toCss(W, dest),
            .@"padding-right" => |*value| value.toCss(W, dest),
            .@"padding-block-start" => |*value| value.toCss(W, dest),
            .@"padding-block-end" => |*value| value.toCss(W, dest),
            .@"padding-inline-start" => |*value| value.toCss(W, dest),
            .@"padding-inline-end" => |*value| value.toCss(W, dest),
            .@"padding-block" => |*value| value.toCss(W, dest),
            .@"padding-inline" => |*value| value.toCss(W, dest),
            .padding => |*value| value.toCss(W, dest),
            .@"scroll-margin-top" => |*value| value.toCss(W, dest),
            .@"scroll-margin-bottom" => |*value| value.toCss(W, dest),
            .@"scroll-margin-left" => |*value| value.toCss(W, dest),
            .@"scroll-margin-right" => |*value| value.toCss(W, dest),
            .@"scroll-margin-block-start" => |*value| value.toCss(W, dest),
            .@"scroll-margin-block-end" => |*value| value.toCss(W, dest),
            .@"scroll-margin-inline-start" => |*value| value.toCss(W, dest),
            .@"scroll-margin-inline-end" => |*value| value.toCss(W, dest),
            .@"scroll-margin-block" => |*value| value.toCss(W, dest),
            .@"scroll-margin-inline" => |*value| value.toCss(W, dest),
            .@"scroll-margin" => |*value| value.toCss(W, dest),
            .@"scroll-padding-top" => |*value| value.toCss(W, dest),
            .@"scroll-padding-bottom" => |*value| value.toCss(W, dest),
            .@"scroll-padding-left" => |*value| value.toCss(W, dest),
            .@"scroll-padding-right" => |*value| value.toCss(W, dest),
            .@"scroll-padding-block-start" => |*value| value.toCss(W, dest),
            .@"scroll-padding-block-end" => |*value| value.toCss(W, dest),
            .@"scroll-padding-inline-start" => |*value| value.toCss(W, dest),
            .@"scroll-padding-inline-end" => |*value| value.toCss(W, dest),
            .@"scroll-padding-block" => |*value| value.toCss(W, dest),
            .@"scroll-padding-inline" => |*value| value.toCss(W, dest),
            .@"scroll-padding" => |*value| value.toCss(W, dest),
            .@"font-weight" => |*value| value.toCss(W, dest),
            .@"font-size" => |*value| value.toCss(W, dest),
            .@"font-stretch" => |*value| value.toCss(W, dest),
            .@"font-family" => |*value| value.toCss(W, dest),
            .@"font-style" => |*value| value.toCss(W, dest),
            .@"font-variant-caps" => |*value| value.toCss(W, dest),
            .@"line-height" => |*value| value.toCss(W, dest),
            .font => |*value| value.toCss(W, dest),
            .@"text-decoration-color" => |*value| value[0].toCss(W, dest),
            .@"text-emphasis-color" => |*value| value[0].toCss(W, dest),
            .@"text-shadow" => |*value| value.toCss(W, dest),
            .direction => |*value| value.toCss(W, dest),
            .composes => |*value| value.toCss(W, dest),
            .@"mask-image" => |*value| value[0].toCss(W, dest),
            .@"mask-mode" => |*value| value.toCss(W, dest),
            .@"mask-repeat" => |*value| value[0].toCss(W, dest),
            .@"mask-position-x" => |*value| value.toCss(W, dest),
            .@"mask-position-y" => |*value| value.toCss(W, dest),
            .@"mask-position" => |*value| value[0].toCss(W, dest),
            .@"mask-clip" => |*value| value[0].toCss(W, dest),
            .@"mask-origin" => |*value| value[0].toCss(W, dest),
            .@"mask-size" => |*value| value[0].toCss(W, dest),
            .@"mask-composite" => |*value| value.toCss(W, dest),
            .@"mask-type" => |*value| value.toCss(W, dest),
            .mask => |*value| value[0].toCss(W, dest),
            .@"mask-border-source" => |*value| value.toCss(W, dest),
            .@"mask-border-mode" => |*value| value.toCss(W, dest),
            .@"mask-border-slice" => |*value| value.toCss(W, dest),
            .@"mask-border-width" => |*value| value.toCss(W, dest),
            .@"mask-border-outset" => |*value| value.toCss(W, dest),
            .@"mask-border-repeat" => |*value| value.toCss(W, dest),
            .@"mask-border" => |*value| value.toCss(W, dest),
            .@"-webkit-mask-composite" => |*value| value.toCss(W, dest),
            .@"mask-source-type" => |*value| value[0].toCss(W, dest),
            .@"mask-box-image" => |*value| value[0].toCss(W, dest),
            .@"mask-box-image-source" => |*value| value[0].toCss(W, dest),
            .@"mask-box-image-slice" => |*value| value[0].toCss(W, dest),
            .@"mask-box-image-width" => |*value| value[0].toCss(W, dest),
            .@"mask-box-image-outset" => |*value| value[0].toCss(W, dest),
            .@"mask-box-image-repeat" => |*value| value[0].toCss(W, dest),
            .all => |*keyword| keyword.toCss(W, dest),
            .unparsed => |*unparsed| unparsed.value.toCss(W, dest, false),
            .custom => |*c| c.value.toCss(W, dest, c.name == .custom),
        };
    }

    /// Returns the given longhand property for a shorthand.
    pub fn longhand(this: *const Property, property_id: *const PropertyId) ?Property {
        switch (this.*) {
            .@"background-position" => |*v| return v.longhand(property_id),
            .overflow => |*v| return v.longhand(property_id),
            .@"inset-block" => |*v| return v.longhand(property_id),
            .@"inset-inline" => |*v| return v.longhand(property_id),
            .inset => |*v| return v.longhand(property_id),
            .@"border-radius" => |*v| {
                if (!v[1].eq(property_id.prefix())) return null;
                return v[0].longhand(property_id);
            },
            .@"border-image" => |*v| {
                if (!v[1].eq(property_id.prefix())) return null;
                return v[0].longhand(property_id);
            },
            .@"border-color" => |*v| return v.longhand(property_id),
            .@"border-style" => |*v| return v.longhand(property_id),
            .@"border-width" => |*v| return v.longhand(property_id),
            .@"border-block-color" => |*v| return v.longhand(property_id),
            .@"border-block-style" => |*v| return v.longhand(property_id),
            .@"border-block-width" => |*v| return v.longhand(property_id),
            .@"border-inline-color" => |*v| return v.longhand(property_id),
            .@"border-inline-style" => |*v| return v.longhand(property_id),
            .@"border-inline-width" => |*v| return v.longhand(property_id),
            .border => |*v| return v.longhand(property_id),
            .@"border-top" => |*v| return v.longhand(property_id),
            .@"border-bottom" => |*v| return v.longhand(property_id),
            .@"border-left" => |*v| return v.longhand(property_id),
            .@"border-right" => |*v| return v.longhand(property_id),
            .@"border-block" => |*v| return v.longhand(property_id),
            .@"border-block-start" => |*v| return v.longhand(property_id),
            .@"border-block-end" => |*v| return v.longhand(property_id),
            .@"border-inline" => |*v| return v.longhand(property_id),
            .@"border-inline-start" => |*v| return v.longhand(property_id),
            .@"border-inline-end" => |*v| return v.longhand(property_id),
            .outline => |*v| return v.longhand(property_id),
            .@"flex-flow" => |*v| {
                if (!v[1].eq(property_id.prefix())) return null;
                return v[0].longhand(property_id);
            },
            .flex => |*v| {
                if (!v[1].eq(property_id.prefix())) return null;
                return v[0].longhand(property_id);
            },
            .@"place-content" => |*v| return v.longhand(property_id),
            .@"place-self" => |*v| return v.longhand(property_id),
            .@"place-items" => |*v| return v.longhand(property_id),
            .gap => |*v| return v.longhand(property_id),
            .@"margin-block" => |*v| return v.longhand(property_id),
            .@"margin-inline" => |*v| return v.longhand(property_id),
            .margin => |*v| return v.longhand(property_id),
            .@"padding-block" => |*v| return v.longhand(property_id),
            .@"padding-inline" => |*v| return v.longhand(property_id),
            .padding => |*v| return v.longhand(property_id),
            .@"scroll-margin-block" => |*v| return v.longhand(property_id),
            .@"scroll-margin-inline" => |*v| return v.longhand(property_id),
            .@"scroll-margin" => |*v| return v.longhand(property_id),
            .@"scroll-padding-block" => |*v| return v.longhand(property_id),
            .@"scroll-padding-inline" => |*v| return v.longhand(property_id),
            .@"scroll-padding" => |*v| return v.longhand(property_id),
            .font => |*v| return v.longhand(property_id),
            .mask => |*v| {
                if (!v[1].eq(property_id.prefix())) return null;
                return v[0].longhand(property_id);
            },
            .@"mask-border" => |*v| return v.longhand(property_id),
            else => {},
        }
        return null;
    }

    pub fn eql(lhs: *const Property, rhs: *const Property) bool {
        if (@intFromEnum(lhs.*) != @intFromEnum(rhs.*)) return false;
        return switch (lhs.*) {
            .@"background-color" => |*v| css.generic.eql(CssColor, v, &rhs.@"background-color"),
            .@"background-image" => |*v| css.generic.eql(SmallList(Image, 1), v, &rhs.@"background-image"),
            .@"background-position-x" => |*v| css.generic.eql(SmallList(css_values.position.HorizontalPosition, 1), v, &rhs.@"background-position-x"),
            .@"background-position-y" => |*v| css.generic.eql(SmallList(css_values.position.VerticalPosition, 1), v, &rhs.@"background-position-y"),
            .@"background-position" => |*v| css.generic.eql(SmallList(background.BackgroundPosition, 1), v, &rhs.@"background-position"),
            .@"background-size" => |*v| css.generic.eql(SmallList(background.BackgroundSize, 1), v, &rhs.@"background-size"),
            .@"background-repeat" => |*v| css.generic.eql(SmallList(background.BackgroundRepeat, 1), v, &rhs.@"background-repeat"),
            .@"background-attachment" => |*v| css.generic.eql(SmallList(background.BackgroundAttachment, 1), v, &rhs.@"background-attachment"),
            .@"background-clip" => |*v| css.generic.eql(SmallList(background.BackgroundClip, 1), &v[0], &v[0]) and v[1].eq(rhs.@"background-clip"[1]),
            .@"background-origin" => |*v| css.generic.eql(SmallList(background.BackgroundOrigin, 1), v, &rhs.@"background-origin"),
            .background => |*v| css.generic.eql(SmallList(background.Background, 1), v, &rhs.background),
            .@"box-shadow" => |*v| css.generic.eql(SmallList(box_shadow.BoxShadow, 1), &v[0], &v[0]) and v[1].eq(rhs.@"box-shadow"[1]),
            .opacity => |*v| css.generic.eql(css.css_values.alpha.AlphaValue, v, &rhs.opacity),
            .color => |*v| css.generic.eql(CssColor, v, &rhs.color),
            .display => |*v| css.generic.eql(display.Display, v, &rhs.display),
            .visibility => |*v| css.generic.eql(display.Visibility, v, &rhs.visibility),
            .width => |*v| css.generic.eql(size.Size, v, &rhs.width),
            .height => |*v| css.generic.eql(size.Size, v, &rhs.height),
            .@"min-width" => |*v| css.generic.eql(size.Size, v, &rhs.@"min-width"),
            .@"min-height" => |*v| css.generic.eql(size.Size, v, &rhs.@"min-height"),
            .@"max-width" => |*v| css.generic.eql(size.MaxSize, v, &rhs.@"max-width"),
            .@"max-height" => |*v| css.generic.eql(size.MaxSize, v, &rhs.@"max-height"),
            .@"block-size" => |*v| css.generic.eql(size.Size, v, &rhs.@"block-size"),
            .@"inline-size" => |*v| css.generic.eql(size.Size, v, &rhs.@"inline-size"),
            .@"min-block-size" => |*v| css.generic.eql(size.Size, v, &rhs.@"min-block-size"),
            .@"min-inline-size" => |*v| css.generic.eql(size.Size, v, &rhs.@"min-inline-size"),
            .@"max-block-size" => |*v| css.generic.eql(size.MaxSize, v, &rhs.@"max-block-size"),
            .@"max-inline-size" => |*v| css.generic.eql(size.MaxSize, v, &rhs.@"max-inline-size"),
            .@"box-sizing" => |*v| css.generic.eql(size.BoxSizing, &v[0], &v[0]) and v[1].eq(rhs.@"box-sizing"[1]),
            .@"aspect-ratio" => |*v| css.generic.eql(size.AspectRatio, v, &rhs.@"aspect-ratio"),
            .overflow => |*v| css.generic.eql(overflow.Overflow, v, &rhs.overflow),
            .@"overflow-x" => |*v| css.generic.eql(overflow.OverflowKeyword, v, &rhs.@"overflow-x"),
            .@"overflow-y" => |*v| css.generic.eql(overflow.OverflowKeyword, v, &rhs.@"overflow-y"),
            .@"text-overflow" => |*v| css.generic.eql(overflow.TextOverflow, &v[0], &v[0]) and v[1].eq(rhs.@"text-overflow"[1]),
            .position => |*v| css.generic.eql(position.Position, v, &rhs.position),
            .top => |*v| css.generic.eql(LengthPercentageOrAuto, v, &rhs.top),
            .bottom => |*v| css.generic.eql(LengthPercentageOrAuto, v, &rhs.bottom),
            .left => |*v| css.generic.eql(LengthPercentageOrAuto, v, &rhs.left),
            .right => |*v| css.generic.eql(LengthPercentageOrAuto, v, &rhs.right),
            .@"inset-block-start" => |*v| css.generic.eql(LengthPercentageOrAuto, v, &rhs.@"inset-block-start"),
            .@"inset-block-end" => |*v| css.generic.eql(LengthPercentageOrAuto, v, &rhs.@"inset-block-end"),
            .@"inset-inline-start" => |*v| css.generic.eql(LengthPercentageOrAuto, v, &rhs.@"inset-inline-start"),
            .@"inset-inline-end" => |*v| css.generic.eql(LengthPercentageOrAuto, v, &rhs.@"inset-inline-end"),
            .@"inset-block" => |*v| css.generic.eql(margin_padding.InsetBlock, v, &rhs.@"inset-block"),
            .@"inset-inline" => |*v| css.generic.eql(margin_padding.InsetInline, v, &rhs.@"inset-inline"),
            .inset => |*v| css.generic.eql(margin_padding.Inset, v, &rhs.inset),
            .@"border-spacing" => |*v| css.generic.eql(css.css_values.size.Size2D(Length), v, &rhs.@"border-spacing"),
            .@"border-top-color" => |*v| css.generic.eql(CssColor, v, &rhs.@"border-top-color"),
            .@"border-bottom-color" => |*v| css.generic.eql(CssColor, v, &rhs.@"border-bottom-color"),
            .@"border-left-color" => |*v| css.generic.eql(CssColor, v, &rhs.@"border-left-color"),
            .@"border-right-color" => |*v| css.generic.eql(CssColor, v, &rhs.@"border-right-color"),
            .@"border-block-start-color" => |*v| css.generic.eql(CssColor, v, &rhs.@"border-block-start-color"),
            .@"border-block-end-color" => |*v| css.generic.eql(CssColor, v, &rhs.@"border-block-end-color"),
            .@"border-inline-start-color" => |*v| css.generic.eql(CssColor, v, &rhs.@"border-inline-start-color"),
            .@"border-inline-end-color" => |*v| css.generic.eql(CssColor, v, &rhs.@"border-inline-end-color"),
            .@"border-top-style" => |*v| css.generic.eql(border.LineStyle, v, &rhs.@"border-top-style"),
            .@"border-bottom-style" => |*v| css.generic.eql(border.LineStyle, v, &rhs.@"border-bottom-style"),
            .@"border-left-style" => |*v| css.generic.eql(border.LineStyle, v, &rhs.@"border-left-style"),
            .@"border-right-style" => |*v| css.generic.eql(border.LineStyle, v, &rhs.@"border-right-style"),
            .@"border-block-start-style" => |*v| css.generic.eql(border.LineStyle, v, &rhs.@"border-block-start-style"),
            .@"border-block-end-style" => |*v| css.generic.eql(border.LineStyle, v, &rhs.@"border-block-end-style"),
            .@"border-inline-start-style" => |*v| css.generic.eql(border.LineStyle, v, &rhs.@"border-inline-start-style"),
            .@"border-inline-end-style" => |*v| css.generic.eql(border.LineStyle, v, &rhs.@"border-inline-end-style"),
            .@"border-top-width" => |*v| css.generic.eql(BorderSideWidth, v, &rhs.@"border-top-width"),
            .@"border-bottom-width" => |*v| css.generic.eql(BorderSideWidth, v, &rhs.@"border-bottom-width"),
            .@"border-left-width" => |*v| css.generic.eql(BorderSideWidth, v, &rhs.@"border-left-width"),
            .@"border-right-width" => |*v| css.generic.eql(BorderSideWidth, v, &rhs.@"border-right-width"),
            .@"border-block-start-width" => |*v| css.generic.eql(BorderSideWidth, v, &rhs.@"border-block-start-width"),
            .@"border-block-end-width" => |*v| css.generic.eql(BorderSideWidth, v, &rhs.@"border-block-end-width"),
            .@"border-inline-start-width" => |*v| css.generic.eql(BorderSideWidth, v, &rhs.@"border-inline-start-width"),
            .@"border-inline-end-width" => |*v| css.generic.eql(BorderSideWidth, v, &rhs.@"border-inline-end-width"),
            .@"border-top-left-radius" => |*v| css.generic.eql(Size2D(LengthPercentage), &v[0], &v[0]) and v[1].eq(rhs.@"border-top-left-radius"[1]),
            .@"border-top-right-radius" => |*v| css.generic.eql(Size2D(LengthPercentage), &v[0], &v[0]) and v[1].eq(rhs.@"border-top-right-radius"[1]),
            .@"border-bottom-left-radius" => |*v| css.generic.eql(Size2D(LengthPercentage), &v[0], &v[0]) and v[1].eq(rhs.@"border-bottom-left-radius"[1]),
            .@"border-bottom-right-radius" => |*v| css.generic.eql(Size2D(LengthPercentage), &v[0], &v[0]) and v[1].eq(rhs.@"border-bottom-right-radius"[1]),
            .@"border-start-start-radius" => |*v| css.generic.eql(Size2D(LengthPercentage), v, &rhs.@"border-start-start-radius"),
            .@"border-start-end-radius" => |*v| css.generic.eql(Size2D(LengthPercentage), v, &rhs.@"border-start-end-radius"),
            .@"border-end-start-radius" => |*v| css.generic.eql(Size2D(LengthPercentage), v, &rhs.@"border-end-start-radius"),
            .@"border-end-end-radius" => |*v| css.generic.eql(Size2D(LengthPercentage), v, &rhs.@"border-end-end-radius"),
            .@"border-radius" => |*v| css.generic.eql(BorderRadius, &v[0], &v[0]) and v[1].eq(rhs.@"border-radius"[1]),
            .@"border-image-source" => |*v| css.generic.eql(Image, v, &rhs.@"border-image-source"),
            .@"border-image-outset" => |*v| css.generic.eql(Rect(LengthOrNumber), v, &rhs.@"border-image-outset"),
            .@"border-image-repeat" => |*v| css.generic.eql(BorderImageRepeat, v, &rhs.@"border-image-repeat"),
            .@"border-image-width" => |*v| css.generic.eql(Rect(BorderImageSideWidth), v, &rhs.@"border-image-width"),
            .@"border-image-slice" => |*v| css.generic.eql(BorderImageSlice, v, &rhs.@"border-image-slice"),
            .@"border-image" => |*v| css.generic.eql(BorderImage, &v[0], &v[0]) and v[1].eq(rhs.@"border-image"[1]),
            .@"border-color" => |*v| css.generic.eql(BorderColor, v, &rhs.@"border-color"),
            .@"border-style" => |*v| css.generic.eql(BorderStyle, v, &rhs.@"border-style"),
            .@"border-width" => |*v| css.generic.eql(BorderWidth, v, &rhs.@"border-width"),
            .@"border-block-color" => |*v| css.generic.eql(BorderBlockColor, v, &rhs.@"border-block-color"),
            .@"border-block-style" => |*v| css.generic.eql(BorderBlockStyle, v, &rhs.@"border-block-style"),
            .@"border-block-width" => |*v| css.generic.eql(BorderBlockWidth, v, &rhs.@"border-block-width"),
            .@"border-inline-color" => |*v| css.generic.eql(BorderInlineColor, v, &rhs.@"border-inline-color"),
            .@"border-inline-style" => |*v| css.generic.eql(BorderInlineStyle, v, &rhs.@"border-inline-style"),
            .@"border-inline-width" => |*v| css.generic.eql(BorderInlineWidth, v, &rhs.@"border-inline-width"),
            .border => |*v| css.generic.eql(Border, v, &rhs.border),
            .@"border-top" => |*v| css.generic.eql(BorderTop, v, &rhs.@"border-top"),
            .@"border-bottom" => |*v| css.generic.eql(BorderBottom, v, &rhs.@"border-bottom"),
            .@"border-left" => |*v| css.generic.eql(BorderLeft, v, &rhs.@"border-left"),
            .@"border-right" => |*v| css.generic.eql(BorderRight, v, &rhs.@"border-right"),
            .@"border-block" => |*v| css.generic.eql(BorderBlock, v, &rhs.@"border-block"),
            .@"border-block-start" => |*v| css.generic.eql(BorderBlockStart, v, &rhs.@"border-block-start"),
            .@"border-block-end" => |*v| css.generic.eql(BorderBlockEnd, v, &rhs.@"border-block-end"),
            .@"border-inline" => |*v| css.generic.eql(BorderInline, v, &rhs.@"border-inline"),
            .@"border-inline-start" => |*v| css.generic.eql(BorderInlineStart, v, &rhs.@"border-inline-start"),
            .@"border-inline-end" => |*v| css.generic.eql(BorderInlineEnd, v, &rhs.@"border-inline-end"),
            .outline => |*v| css.generic.eql(Outline, v, &rhs.outline),
            .@"outline-color" => |*v| css.generic.eql(CssColor, v, &rhs.@"outline-color"),
            .@"outline-style" => |*v| css.generic.eql(OutlineStyle, v, &rhs.@"outline-style"),
            .@"outline-width" => |*v| css.generic.eql(BorderSideWidth, v, &rhs.@"outline-width"),
            .@"flex-direction" => |*v| css.generic.eql(FlexDirection, &v[0], &v[0]) and v[1].eq(rhs.@"flex-direction"[1]),
            .@"flex-wrap" => |*v| css.generic.eql(FlexWrap, &v[0], &v[0]) and v[1].eq(rhs.@"flex-wrap"[1]),
            .@"flex-flow" => |*v| css.generic.eql(FlexFlow, &v[0], &v[0]) and v[1].eq(rhs.@"flex-flow"[1]),
            .@"flex-grow" => |*v| css.generic.eql(CSSNumber, &v[0], &v[0]) and v[1].eq(rhs.@"flex-grow"[1]),
            .@"flex-shrink" => |*v| css.generic.eql(CSSNumber, &v[0], &v[0]) and v[1].eq(rhs.@"flex-shrink"[1]),
            .@"flex-basis" => |*v| css.generic.eql(LengthPercentageOrAuto, &v[0], &v[0]) and v[1].eq(rhs.@"flex-basis"[1]),
            .flex => |*v| css.generic.eql(Flex, &v[0], &v[0]) and v[1].eq(rhs.flex[1]),
            .order => |*v| css.generic.eql(CSSInteger, &v[0], &v[0]) and v[1].eq(rhs.order[1]),
            .@"align-content" => |*v| css.generic.eql(AlignContent, &v[0], &v[0]) and v[1].eq(rhs.@"align-content"[1]),
            .@"justify-content" => |*v| css.generic.eql(JustifyContent, &v[0], &v[0]) and v[1].eq(rhs.@"justify-content"[1]),
            .@"place-content" => |*v| css.generic.eql(PlaceContent, v, &rhs.@"place-content"),
            .@"align-self" => |*v| css.generic.eql(AlignSelf, &v[0], &v[0]) and v[1].eq(rhs.@"align-self"[1]),
            .@"justify-self" => |*v| css.generic.eql(JustifySelf, v, &rhs.@"justify-self"),
            .@"place-self" => |*v| css.generic.eql(PlaceSelf, v, &rhs.@"place-self"),
            .@"align-items" => |*v| css.generic.eql(AlignItems, &v[0], &v[0]) and v[1].eq(rhs.@"align-items"[1]),
            .@"justify-items" => |*v| css.generic.eql(JustifyItems, v, &rhs.@"justify-items"),
            .@"place-items" => |*v| css.generic.eql(PlaceItems, v, &rhs.@"place-items"),
            .@"row-gap" => |*v| css.generic.eql(GapValue, v, &rhs.@"row-gap"),
            .@"column-gap" => |*v| css.generic.eql(GapValue, v, &rhs.@"column-gap"),
            .gap => |*v| css.generic.eql(Gap, v, &rhs.gap),
            .@"box-orient" => |*v| css.generic.eql(BoxOrient, &v[0], &v[0]) and v[1].eq(rhs.@"box-orient"[1]),
            .@"box-direction" => |*v| css.generic.eql(BoxDirection, &v[0], &v[0]) and v[1].eq(rhs.@"box-direction"[1]),
            .@"box-ordinal-group" => |*v| css.generic.eql(CSSInteger, &v[0], &v[0]) and v[1].eq(rhs.@"box-ordinal-group"[1]),
            .@"box-align" => |*v| css.generic.eql(BoxAlign, &v[0], &v[0]) and v[1].eq(rhs.@"box-align"[1]),
            .@"box-flex" => |*v| css.generic.eql(CSSNumber, &v[0], &v[0]) and v[1].eq(rhs.@"box-flex"[1]),
            .@"box-flex-group" => |*v| css.generic.eql(CSSInteger, &v[0], &v[0]) and v[1].eq(rhs.@"box-flex-group"[1]),
            .@"box-pack" => |*v| css.generic.eql(BoxPack, &v[0], &v[0]) and v[1].eq(rhs.@"box-pack"[1]),
            .@"box-lines" => |*v| css.generic.eql(BoxLines, &v[0], &v[0]) and v[1].eq(rhs.@"box-lines"[1]),
            .@"flex-pack" => |*v| css.generic.eql(FlexPack, &v[0], &v[0]) and v[1].eq(rhs.@"flex-pack"[1]),
            .@"flex-order" => |*v| css.generic.eql(CSSInteger, &v[0], &v[0]) and v[1].eq(rhs.@"flex-order"[1]),
            .@"flex-align" => |*v| css.generic.eql(BoxAlign, &v[0], &v[0]) and v[1].eq(rhs.@"flex-align"[1]),
            .@"flex-item-align" => |*v| css.generic.eql(FlexItemAlign, &v[0], &v[0]) and v[1].eq(rhs.@"flex-item-align"[1]),
            .@"flex-line-pack" => |*v| css.generic.eql(FlexLinePack, &v[0], &v[0]) and v[1].eq(rhs.@"flex-line-pack"[1]),
            .@"flex-positive" => |*v| css.generic.eql(CSSNumber, &v[0], &v[0]) and v[1].eq(rhs.@"flex-positive"[1]),
            .@"flex-negative" => |*v| css.generic.eql(CSSNumber, &v[0], &v[0]) and v[1].eq(rhs.@"flex-negative"[1]),
            .@"flex-preferred-size" => |*v| css.generic.eql(LengthPercentageOrAuto, &v[0], &v[0]) and v[1].eq(rhs.@"flex-preferred-size"[1]),
            .@"margin-top" => |*v| css.generic.eql(LengthPercentageOrAuto, v, &rhs.@"margin-top"),
            .@"margin-bottom" => |*v| css.generic.eql(LengthPercentageOrAuto, v, &rhs.@"margin-bottom"),
            .@"margin-left" => |*v| css.generic.eql(LengthPercentageOrAuto, v, &rhs.@"margin-left"),
            .@"margin-right" => |*v| css.generic.eql(LengthPercentageOrAuto, v, &rhs.@"margin-right"),
            .@"margin-block-start" => |*v| css.generic.eql(LengthPercentageOrAuto, v, &rhs.@"margin-block-start"),
            .@"margin-block-end" => |*v| css.generic.eql(LengthPercentageOrAuto, v, &rhs.@"margin-block-end"),
            .@"margin-inline-start" => |*v| css.generic.eql(LengthPercentageOrAuto, v, &rhs.@"margin-inline-start"),
            .@"margin-inline-end" => |*v| css.generic.eql(LengthPercentageOrAuto, v, &rhs.@"margin-inline-end"),
            .@"margin-block" => |*v| css.generic.eql(MarginBlock, v, &rhs.@"margin-block"),
            .@"margin-inline" => |*v| css.generic.eql(MarginInline, v, &rhs.@"margin-inline"),
            .margin => |*v| css.generic.eql(Margin, v, &rhs.margin),
            .@"padding-top" => |*v| css.generic.eql(LengthPercentageOrAuto, v, &rhs.@"padding-top"),
            .@"padding-bottom" => |*v| css.generic.eql(LengthPercentageOrAuto, v, &rhs.@"padding-bottom"),
            .@"padding-left" => |*v| css.generic.eql(LengthPercentageOrAuto, v, &rhs.@"padding-left"),
            .@"padding-right" => |*v| css.generic.eql(LengthPercentageOrAuto, v, &rhs.@"padding-right"),
            .@"padding-block-start" => |*v| css.generic.eql(LengthPercentageOrAuto, v, &rhs.@"padding-block-start"),
            .@"padding-block-end" => |*v| css.generic.eql(LengthPercentageOrAuto, v, &rhs.@"padding-block-end"),
            .@"padding-inline-start" => |*v| css.generic.eql(LengthPercentageOrAuto, v, &rhs.@"padding-inline-start"),
            .@"padding-inline-end" => |*v| css.generic.eql(LengthPercentageOrAuto, v, &rhs.@"padding-inline-end"),
            .@"padding-block" => |*v| css.generic.eql(PaddingBlock, v, &rhs.@"padding-block"),
            .@"padding-inline" => |*v| css.generic.eql(PaddingInline, v, &rhs.@"padding-inline"),
            .padding => |*v| css.generic.eql(Padding, v, &rhs.padding),
            .@"scroll-margin-top" => |*v| css.generic.eql(LengthPercentageOrAuto, v, &rhs.@"scroll-margin-top"),
            .@"scroll-margin-bottom" => |*v| css.generic.eql(LengthPercentageOrAuto, v, &rhs.@"scroll-margin-bottom"),
            .@"scroll-margin-left" => |*v| css.generic.eql(LengthPercentageOrAuto, v, &rhs.@"scroll-margin-left"),
            .@"scroll-margin-right" => |*v| css.generic.eql(LengthPercentageOrAuto, v, &rhs.@"scroll-margin-right"),
            .@"scroll-margin-block-start" => |*v| css.generic.eql(LengthPercentageOrAuto, v, &rhs.@"scroll-margin-block-start"),
            .@"scroll-margin-block-end" => |*v| css.generic.eql(LengthPercentageOrAuto, v, &rhs.@"scroll-margin-block-end"),
            .@"scroll-margin-inline-start" => |*v| css.generic.eql(LengthPercentageOrAuto, v, &rhs.@"scroll-margin-inline-start"),
            .@"scroll-margin-inline-end" => |*v| css.generic.eql(LengthPercentageOrAuto, v, &rhs.@"scroll-margin-inline-end"),
            .@"scroll-margin-block" => |*v| css.generic.eql(ScrollMarginBlock, v, &rhs.@"scroll-margin-block"),
            .@"scroll-margin-inline" => |*v| css.generic.eql(ScrollMarginInline, v, &rhs.@"scroll-margin-inline"),
            .@"scroll-margin" => |*v| css.generic.eql(ScrollMargin, v, &rhs.@"scroll-margin"),
            .@"scroll-padding-top" => |*v| css.generic.eql(LengthPercentageOrAuto, v, &rhs.@"scroll-padding-top"),
            .@"scroll-padding-bottom" => |*v| css.generic.eql(LengthPercentageOrAuto, v, &rhs.@"scroll-padding-bottom"),
            .@"scroll-padding-left" => |*v| css.generic.eql(LengthPercentageOrAuto, v, &rhs.@"scroll-padding-left"),
            .@"scroll-padding-right" => |*v| css.generic.eql(LengthPercentageOrAuto, v, &rhs.@"scroll-padding-right"),
            .@"scroll-padding-block-start" => |*v| css.generic.eql(LengthPercentageOrAuto, v, &rhs.@"scroll-padding-block-start"),
            .@"scroll-padding-block-end" => |*v| css.generic.eql(LengthPercentageOrAuto, v, &rhs.@"scroll-padding-block-end"),
            .@"scroll-padding-inline-start" => |*v| css.generic.eql(LengthPercentageOrAuto, v, &rhs.@"scroll-padding-inline-start"),
            .@"scroll-padding-inline-end" => |*v| css.generic.eql(LengthPercentageOrAuto, v, &rhs.@"scroll-padding-inline-end"),
            .@"scroll-padding-block" => |*v| css.generic.eql(ScrollPaddingBlock, v, &rhs.@"scroll-padding-block"),
            .@"scroll-padding-inline" => |*v| css.generic.eql(ScrollPaddingInline, v, &rhs.@"scroll-padding-inline"),
            .@"scroll-padding" => |*v| css.generic.eql(ScrollPadding, v, &rhs.@"scroll-padding"),
            .@"font-weight" => |*v| css.generic.eql(FontWeight, v, &rhs.@"font-weight"),
            .@"font-size" => |*v| css.generic.eql(FontSize, v, &rhs.@"font-size"),
            .@"font-stretch" => |*v| css.generic.eql(FontStretch, v, &rhs.@"font-stretch"),
            .@"font-family" => |*v| css.generic.eql(BabyList(FontFamily), v, &rhs.@"font-family"),
            .@"font-style" => |*v| css.generic.eql(FontStyle, v, &rhs.@"font-style"),
            .@"font-variant-caps" => |*v| css.generic.eql(FontVariantCaps, v, &rhs.@"font-variant-caps"),
            .@"line-height" => |*v| css.generic.eql(LineHeight, v, &rhs.@"line-height"),
            .font => |*v| css.generic.eql(Font, v, &rhs.font),
            .@"text-decoration-color" => |*v| css.generic.eql(CssColor, &v[0], &v[0]) and v[1].eq(rhs.@"text-decoration-color"[1]),
            .@"text-emphasis-color" => |*v| css.generic.eql(CssColor, &v[0], &v[0]) and v[1].eq(rhs.@"text-emphasis-color"[1]),
            .@"text-shadow" => |*v| css.generic.eql(SmallList(TextShadow, 1), v, &rhs.@"text-shadow"),
            .direction => |*v| css.generic.eql(Direction, v, &rhs.direction),
            .composes => |*v| css.generic.eql(Composes, v, &rhs.composes),
            .@"mask-image" => |*v| css.generic.eql(SmallList(Image, 1), &v[0], &v[0]) and v[1].eq(rhs.@"mask-image"[1]),
            .@"mask-mode" => |*v| css.generic.eql(SmallList(MaskMode, 1), v, &rhs.@"mask-mode"),
            .@"mask-repeat" => |*v| css.generic.eql(SmallList(BackgroundRepeat, 1), &v[0], &v[0]) and v[1].eq(rhs.@"mask-repeat"[1]),
            .@"mask-position-x" => |*v| css.generic.eql(SmallList(HorizontalPosition, 1), v, &rhs.@"mask-position-x"),
            .@"mask-position-y" => |*v| css.generic.eql(SmallList(VerticalPosition, 1), v, &rhs.@"mask-position-y"),
            .@"mask-position" => |*v| css.generic.eql(SmallList(Position, 1), &v[0], &v[0]) and v[1].eq(rhs.@"mask-position"[1]),
            .@"mask-clip" => |*v| css.generic.eql(SmallList(MaskClip, 1), &v[0], &v[0]) and v[1].eq(rhs.@"mask-clip"[1]),
            .@"mask-origin" => |*v| css.generic.eql(SmallList(GeometryBox, 1), &v[0], &v[0]) and v[1].eq(rhs.@"mask-origin"[1]),
            .@"mask-size" => |*v| css.generic.eql(SmallList(BackgroundSize, 1), &v[0], &v[0]) and v[1].eq(rhs.@"mask-size"[1]),
            .@"mask-composite" => |*v| css.generic.eql(SmallList(MaskComposite, 1), v, &rhs.@"mask-composite"),
            .@"mask-type" => |*v| css.generic.eql(MaskType, v, &rhs.@"mask-type"),
            .mask => |*v| css.generic.eql(SmallList(Mask, 1), &v[0], &v[0]) and v[1].eq(rhs.mask[1]),
            .@"mask-border-source" => |*v| css.generic.eql(Image, v, &rhs.@"mask-border-source"),
            .@"mask-border-mode" => |*v| css.generic.eql(MaskBorderMode, v, &rhs.@"mask-border-mode"),
            .@"mask-border-slice" => |*v| css.generic.eql(BorderImageSlice, v, &rhs.@"mask-border-slice"),
            .@"mask-border-width" => |*v| css.generic.eql(Rect(BorderImageSideWidth), v, &rhs.@"mask-border-width"),
            .@"mask-border-outset" => |*v| css.generic.eql(Rect(LengthOrNumber), v, &rhs.@"mask-border-outset"),
            .@"mask-border-repeat" => |*v| css.generic.eql(BorderImageRepeat, v, &rhs.@"mask-border-repeat"),
            .@"mask-border" => |*v| css.generic.eql(MaskBorder, v, &rhs.@"mask-border"),
            .@"-webkit-mask-composite" => |*v| css.generic.eql(SmallList(WebKitMaskComposite, 1), v, &rhs.@"-webkit-mask-composite"),
            .@"mask-source-type" => |*v| css.generic.eql(SmallList(WebKitMaskSourceType, 1), &v[0], &v[0]) and v[1].eq(rhs.@"mask-source-type"[1]),
            .@"mask-box-image" => |*v| css.generic.eql(BorderImage, &v[0], &v[0]) and v[1].eq(rhs.@"mask-box-image"[1]),
            .@"mask-box-image-source" => |*v| css.generic.eql(Image, &v[0], &v[0]) and v[1].eq(rhs.@"mask-box-image-source"[1]),
            .@"mask-box-image-slice" => |*v| css.generic.eql(BorderImageSlice, &v[0], &v[0]) and v[1].eq(rhs.@"mask-box-image-slice"[1]),
            .@"mask-box-image-width" => |*v| css.generic.eql(Rect(BorderImageSideWidth), &v[0], &v[0]) and v[1].eq(rhs.@"mask-box-image-width"[1]),
            .@"mask-box-image-outset" => |*v| css.generic.eql(Rect(LengthOrNumber), &v[0], &v[0]) and v[1].eq(rhs.@"mask-box-image-outset"[1]),
            .@"mask-box-image-repeat" => |*v| css.generic.eql(BorderImageRepeat, &v[0], &v[0]) and v[1].eq(rhs.@"mask-box-image-repeat"[1]),
            .unparsed => |*u| u.eql(&rhs.unparsed),
            .all => true,
            .custom => |*c| c.eql(&rhs.custom),
        };
    }
};
pub const PropertyId = union(PropertyIdTag) {
    @"background-color",
    @"background-image",
    @"background-position-x",
    @"background-position-y",
    @"background-position",
    @"background-size",
    @"background-repeat",
    @"background-attachment",
    @"background-clip": VendorPrefix,
    @"background-origin",
    background,
    @"box-shadow": VendorPrefix,
    opacity,
    color,
    display,
    visibility,
    width,
    height,
    @"min-width",
    @"min-height",
    @"max-width",
    @"max-height",
    @"block-size",
    @"inline-size",
    @"min-block-size",
    @"min-inline-size",
    @"max-block-size",
    @"max-inline-size",
    @"box-sizing": VendorPrefix,
    @"aspect-ratio",
    overflow,
    @"overflow-x",
    @"overflow-y",
    @"text-overflow": VendorPrefix,
    position,
    top,
    bottom,
    left,
    right,
    @"inset-block-start",
    @"inset-block-end",
    @"inset-inline-start",
    @"inset-inline-end",
    @"inset-block",
    @"inset-inline",
    inset,
    @"border-spacing",
    @"border-top-color",
    @"border-bottom-color",
    @"border-left-color",
    @"border-right-color",
    @"border-block-start-color",
    @"border-block-end-color",
    @"border-inline-start-color",
    @"border-inline-end-color",
    @"border-top-style",
    @"border-bottom-style",
    @"border-left-style",
    @"border-right-style",
    @"border-block-start-style",
    @"border-block-end-style",
    @"border-inline-start-style",
    @"border-inline-end-style",
    @"border-top-width",
    @"border-bottom-width",
    @"border-left-width",
    @"border-right-width",
    @"border-block-start-width",
    @"border-block-end-width",
    @"border-inline-start-width",
    @"border-inline-end-width",
    @"border-top-left-radius": VendorPrefix,
    @"border-top-right-radius": VendorPrefix,
    @"border-bottom-left-radius": VendorPrefix,
    @"border-bottom-right-radius": VendorPrefix,
    @"border-start-start-radius",
    @"border-start-end-radius",
    @"border-end-start-radius",
    @"border-end-end-radius",
    @"border-radius": VendorPrefix,
    @"border-image-source",
    @"border-image-outset",
    @"border-image-repeat",
    @"border-image-width",
    @"border-image-slice",
    @"border-image": VendorPrefix,
    @"border-color",
    @"border-style",
    @"border-width",
    @"border-block-color",
    @"border-block-style",
    @"border-block-width",
    @"border-inline-color",
    @"border-inline-style",
    @"border-inline-width",
    border,
    @"border-top",
    @"border-bottom",
    @"border-left",
    @"border-right",
    @"border-block",
    @"border-block-start",
    @"border-block-end",
    @"border-inline",
    @"border-inline-start",
    @"border-inline-end",
    outline,
    @"outline-color",
    @"outline-style",
    @"outline-width",
    @"flex-direction": VendorPrefix,
    @"flex-wrap": VendorPrefix,
    @"flex-flow": VendorPrefix,
    @"flex-grow": VendorPrefix,
    @"flex-shrink": VendorPrefix,
    @"flex-basis": VendorPrefix,
    flex: VendorPrefix,
    order: VendorPrefix,
    @"align-content": VendorPrefix,
    @"justify-content": VendorPrefix,
    @"place-content",
    @"align-self": VendorPrefix,
    @"justify-self",
    @"place-self",
    @"align-items": VendorPrefix,
    @"justify-items",
    @"place-items",
    @"row-gap",
    @"column-gap",
    gap,
    @"box-orient": VendorPrefix,
    @"box-direction": VendorPrefix,
    @"box-ordinal-group": VendorPrefix,
    @"box-align": VendorPrefix,
    @"box-flex": VendorPrefix,
    @"box-flex-group": VendorPrefix,
    @"box-pack": VendorPrefix,
    @"box-lines": VendorPrefix,
    @"flex-pack": VendorPrefix,
    @"flex-order": VendorPrefix,
    @"flex-align": VendorPrefix,
    @"flex-item-align": VendorPrefix,
    @"flex-line-pack": VendorPrefix,
    @"flex-positive": VendorPrefix,
    @"flex-negative": VendorPrefix,
    @"flex-preferred-size": VendorPrefix,
    @"margin-top",
    @"margin-bottom",
    @"margin-left",
    @"margin-right",
    @"margin-block-start",
    @"margin-block-end",
    @"margin-inline-start",
    @"margin-inline-end",
    @"margin-block",
    @"margin-inline",
    margin,
    @"padding-top",
    @"padding-bottom",
    @"padding-left",
    @"padding-right",
    @"padding-block-start",
    @"padding-block-end",
    @"padding-inline-start",
    @"padding-inline-end",
    @"padding-block",
    @"padding-inline",
    padding,
    @"scroll-margin-top",
    @"scroll-margin-bottom",
    @"scroll-margin-left",
    @"scroll-margin-right",
    @"scroll-margin-block-start",
    @"scroll-margin-block-end",
    @"scroll-margin-inline-start",
    @"scroll-margin-inline-end",
    @"scroll-margin-block",
    @"scroll-margin-inline",
    @"scroll-margin",
    @"scroll-padding-top",
    @"scroll-padding-bottom",
    @"scroll-padding-left",
    @"scroll-padding-right",
    @"scroll-padding-block-start",
    @"scroll-padding-block-end",
    @"scroll-padding-inline-start",
    @"scroll-padding-inline-end",
    @"scroll-padding-block",
    @"scroll-padding-inline",
    @"scroll-padding",
    @"font-weight",
    @"font-size",
    @"font-stretch",
    @"font-family",
    @"font-style",
    @"font-variant-caps",
    @"line-height",
    font,
    @"text-decoration-color": VendorPrefix,
    @"text-emphasis-color": VendorPrefix,
    @"text-shadow",
    direction,
    composes,
    @"mask-image": VendorPrefix,
    @"mask-mode",
    @"mask-repeat": VendorPrefix,
    @"mask-position-x",
    @"mask-position-y",
    @"mask-position": VendorPrefix,
    @"mask-clip": VendorPrefix,
    @"mask-origin": VendorPrefix,
    @"mask-size": VendorPrefix,
    @"mask-composite",
    @"mask-type",
    mask: VendorPrefix,
    @"mask-border-source",
    @"mask-border-mode",
    @"mask-border-slice",
    @"mask-border-width",
    @"mask-border-outset",
    @"mask-border-repeat",
    @"mask-border",
    @"-webkit-mask-composite",
    @"mask-source-type": VendorPrefix,
    @"mask-box-image": VendorPrefix,
    @"mask-box-image-source": VendorPrefix,
    @"mask-box-image-slice": VendorPrefix,
    @"mask-box-image-width": VendorPrefix,
    @"mask-box-image-outset": VendorPrefix,
    @"mask-box-image-repeat": VendorPrefix,
    all,
    unparsed,
    custom: CustomPropertyName,

    pub usingnamespace PropertyIdImpl();

    /// Returns the property name, without any vendor prefixes.
    pub inline fn name(this: *const PropertyId) []const u8 {
        return @tagName(this.*);
    }

    /// Returns the vendor prefix for this property id.
    pub fn prefix(this: *const PropertyId) VendorPrefix {
        return switch (this.*) {
            .@"background-color" => VendorPrefix.empty(),
            .@"background-image" => VendorPrefix.empty(),
            .@"background-position-x" => VendorPrefix.empty(),
            .@"background-position-y" => VendorPrefix.empty(),
            .@"background-position" => VendorPrefix.empty(),
            .@"background-size" => VendorPrefix.empty(),
            .@"background-repeat" => VendorPrefix.empty(),
            .@"background-attachment" => VendorPrefix.empty(),
            .@"background-clip" => |p| p,
            .@"background-origin" => VendorPrefix.empty(),
            .background => VendorPrefix.empty(),
            .@"box-shadow" => |p| p,
            .opacity => VendorPrefix.empty(),
            .color => VendorPrefix.empty(),
            .display => VendorPrefix.empty(),
            .visibility => VendorPrefix.empty(),
            .width => VendorPrefix.empty(),
            .height => VendorPrefix.empty(),
            .@"min-width" => VendorPrefix.empty(),
            .@"min-height" => VendorPrefix.empty(),
            .@"max-width" => VendorPrefix.empty(),
            .@"max-height" => VendorPrefix.empty(),
            .@"block-size" => VendorPrefix.empty(),
            .@"inline-size" => VendorPrefix.empty(),
            .@"min-block-size" => VendorPrefix.empty(),
            .@"min-inline-size" => VendorPrefix.empty(),
            .@"max-block-size" => VendorPrefix.empty(),
            .@"max-inline-size" => VendorPrefix.empty(),
            .@"box-sizing" => |p| p,
            .@"aspect-ratio" => VendorPrefix.empty(),
            .overflow => VendorPrefix.empty(),
            .@"overflow-x" => VendorPrefix.empty(),
            .@"overflow-y" => VendorPrefix.empty(),
            .@"text-overflow" => |p| p,
            .position => VendorPrefix.empty(),
            .top => VendorPrefix.empty(),
            .bottom => VendorPrefix.empty(),
            .left => VendorPrefix.empty(),
            .right => VendorPrefix.empty(),
            .@"inset-block-start" => VendorPrefix.empty(),
            .@"inset-block-end" => VendorPrefix.empty(),
            .@"inset-inline-start" => VendorPrefix.empty(),
            .@"inset-inline-end" => VendorPrefix.empty(),
            .@"inset-block" => VendorPrefix.empty(),
            .@"inset-inline" => VendorPrefix.empty(),
            .inset => VendorPrefix.empty(),
            .@"border-spacing" => VendorPrefix.empty(),
            .@"border-top-color" => VendorPrefix.empty(),
            .@"border-bottom-color" => VendorPrefix.empty(),
            .@"border-left-color" => VendorPrefix.empty(),
            .@"border-right-color" => VendorPrefix.empty(),
            .@"border-block-start-color" => VendorPrefix.empty(),
            .@"border-block-end-color" => VendorPrefix.empty(),
            .@"border-inline-start-color" => VendorPrefix.empty(),
            .@"border-inline-end-color" => VendorPrefix.empty(),
            .@"border-top-style" => VendorPrefix.empty(),
            .@"border-bottom-style" => VendorPrefix.empty(),
            .@"border-left-style" => VendorPrefix.empty(),
            .@"border-right-style" => VendorPrefix.empty(),
            .@"border-block-start-style" => VendorPrefix.empty(),
            .@"border-block-end-style" => VendorPrefix.empty(),
            .@"border-inline-start-style" => VendorPrefix.empty(),
            .@"border-inline-end-style" => VendorPrefix.empty(),
            .@"border-top-width" => VendorPrefix.empty(),
            .@"border-bottom-width" => VendorPrefix.empty(),
            .@"border-left-width" => VendorPrefix.empty(),
            .@"border-right-width" => VendorPrefix.empty(),
            .@"border-block-start-width" => VendorPrefix.empty(),
            .@"border-block-end-width" => VendorPrefix.empty(),
            .@"border-inline-start-width" => VendorPrefix.empty(),
            .@"border-inline-end-width" => VendorPrefix.empty(),
            .@"border-top-left-radius" => |p| p,
            .@"border-top-right-radius" => |p| p,
            .@"border-bottom-left-radius" => |p| p,
            .@"border-bottom-right-radius" => |p| p,
            .@"border-start-start-radius" => VendorPrefix.empty(),
            .@"border-start-end-radius" => VendorPrefix.empty(),
            .@"border-end-start-radius" => VendorPrefix.empty(),
            .@"border-end-end-radius" => VendorPrefix.empty(),
            .@"border-radius" => |p| p,
            .@"border-image-source" => VendorPrefix.empty(),
            .@"border-image-outset" => VendorPrefix.empty(),
            .@"border-image-repeat" => VendorPrefix.empty(),
            .@"border-image-width" => VendorPrefix.empty(),
            .@"border-image-slice" => VendorPrefix.empty(),
            .@"border-image" => |p| p,
            .@"border-color" => VendorPrefix.empty(),
            .@"border-style" => VendorPrefix.empty(),
            .@"border-width" => VendorPrefix.empty(),
            .@"border-block-color" => VendorPrefix.empty(),
            .@"border-block-style" => VendorPrefix.empty(),
            .@"border-block-width" => VendorPrefix.empty(),
            .@"border-inline-color" => VendorPrefix.empty(),
            .@"border-inline-style" => VendorPrefix.empty(),
            .@"border-inline-width" => VendorPrefix.empty(),
            .border => VendorPrefix.empty(),
            .@"border-top" => VendorPrefix.empty(),
            .@"border-bottom" => VendorPrefix.empty(),
            .@"border-left" => VendorPrefix.empty(),
            .@"border-right" => VendorPrefix.empty(),
            .@"border-block" => VendorPrefix.empty(),
            .@"border-block-start" => VendorPrefix.empty(),
            .@"border-block-end" => VendorPrefix.empty(),
            .@"border-inline" => VendorPrefix.empty(),
            .@"border-inline-start" => VendorPrefix.empty(),
            .@"border-inline-end" => VendorPrefix.empty(),
            .outline => VendorPrefix.empty(),
            .@"outline-color" => VendorPrefix.empty(),
            .@"outline-style" => VendorPrefix.empty(),
            .@"outline-width" => VendorPrefix.empty(),
            .@"flex-direction" => |p| p,
            .@"flex-wrap" => |p| p,
            .@"flex-flow" => |p| p,
            .@"flex-grow" => |p| p,
            .@"flex-shrink" => |p| p,
            .@"flex-basis" => |p| p,
            .flex => |p| p,
            .order => |p| p,
            .@"align-content" => |p| p,
            .@"justify-content" => |p| p,
            .@"place-content" => VendorPrefix.empty(),
            .@"align-self" => |p| p,
            .@"justify-self" => VendorPrefix.empty(),
            .@"place-self" => VendorPrefix.empty(),
            .@"align-items" => |p| p,
            .@"justify-items" => VendorPrefix.empty(),
            .@"place-items" => VendorPrefix.empty(),
            .@"row-gap" => VendorPrefix.empty(),
            .@"column-gap" => VendorPrefix.empty(),
            .gap => VendorPrefix.empty(),
            .@"box-orient" => |p| p,
            .@"box-direction" => |p| p,
            .@"box-ordinal-group" => |p| p,
            .@"box-align" => |p| p,
            .@"box-flex" => |p| p,
            .@"box-flex-group" => |p| p,
            .@"box-pack" => |p| p,
            .@"box-lines" => |p| p,
            .@"flex-pack" => |p| p,
            .@"flex-order" => |p| p,
            .@"flex-align" => |p| p,
            .@"flex-item-align" => |p| p,
            .@"flex-line-pack" => |p| p,
            .@"flex-positive" => |p| p,
            .@"flex-negative" => |p| p,
            .@"flex-preferred-size" => |p| p,
            .@"margin-top" => VendorPrefix.empty(),
            .@"margin-bottom" => VendorPrefix.empty(),
            .@"margin-left" => VendorPrefix.empty(),
            .@"margin-right" => VendorPrefix.empty(),
            .@"margin-block-start" => VendorPrefix.empty(),
            .@"margin-block-end" => VendorPrefix.empty(),
            .@"margin-inline-start" => VendorPrefix.empty(),
            .@"margin-inline-end" => VendorPrefix.empty(),
            .@"margin-block" => VendorPrefix.empty(),
            .@"margin-inline" => VendorPrefix.empty(),
            .margin => VendorPrefix.empty(),
            .@"padding-top" => VendorPrefix.empty(),
            .@"padding-bottom" => VendorPrefix.empty(),
            .@"padding-left" => VendorPrefix.empty(),
            .@"padding-right" => VendorPrefix.empty(),
            .@"padding-block-start" => VendorPrefix.empty(),
            .@"padding-block-end" => VendorPrefix.empty(),
            .@"padding-inline-start" => VendorPrefix.empty(),
            .@"padding-inline-end" => VendorPrefix.empty(),
            .@"padding-block" => VendorPrefix.empty(),
            .@"padding-inline" => VendorPrefix.empty(),
            .padding => VendorPrefix.empty(),
            .@"scroll-margin-top" => VendorPrefix.empty(),
            .@"scroll-margin-bottom" => VendorPrefix.empty(),
            .@"scroll-margin-left" => VendorPrefix.empty(),
            .@"scroll-margin-right" => VendorPrefix.empty(),
            .@"scroll-margin-block-start" => VendorPrefix.empty(),
            .@"scroll-margin-block-end" => VendorPrefix.empty(),
            .@"scroll-margin-inline-start" => VendorPrefix.empty(),
            .@"scroll-margin-inline-end" => VendorPrefix.empty(),
            .@"scroll-margin-block" => VendorPrefix.empty(),
            .@"scroll-margin-inline" => VendorPrefix.empty(),
            .@"scroll-margin" => VendorPrefix.empty(),
            .@"scroll-padding-top" => VendorPrefix.empty(),
            .@"scroll-padding-bottom" => VendorPrefix.empty(),
            .@"scroll-padding-left" => VendorPrefix.empty(),
            .@"scroll-padding-right" => VendorPrefix.empty(),
            .@"scroll-padding-block-start" => VendorPrefix.empty(),
            .@"scroll-padding-block-end" => VendorPrefix.empty(),
            .@"scroll-padding-inline-start" => VendorPrefix.empty(),
            .@"scroll-padding-inline-end" => VendorPrefix.empty(),
            .@"scroll-padding-block" => VendorPrefix.empty(),
            .@"scroll-padding-inline" => VendorPrefix.empty(),
            .@"scroll-padding" => VendorPrefix.empty(),
            .@"font-weight" => VendorPrefix.empty(),
            .@"font-size" => VendorPrefix.empty(),
            .@"font-stretch" => VendorPrefix.empty(),
            .@"font-family" => VendorPrefix.empty(),
            .@"font-style" => VendorPrefix.empty(),
            .@"font-variant-caps" => VendorPrefix.empty(),
            .@"line-height" => VendorPrefix.empty(),
            .font => VendorPrefix.empty(),
            .@"text-decoration-color" => |p| p,
            .@"text-emphasis-color" => |p| p,
            .@"text-shadow" => VendorPrefix.empty(),
            .direction => VendorPrefix.empty(),
            .composes => VendorPrefix.empty(),
            .@"mask-image" => |p| p,
            .@"mask-mode" => VendorPrefix.empty(),
            .@"mask-repeat" => |p| p,
            .@"mask-position-x" => VendorPrefix.empty(),
            .@"mask-position-y" => VendorPrefix.empty(),
            .@"mask-position" => |p| p,
            .@"mask-clip" => |p| p,
            .@"mask-origin" => |p| p,
            .@"mask-size" => |p| p,
            .@"mask-composite" => VendorPrefix.empty(),
            .@"mask-type" => VendorPrefix.empty(),
            .mask => |p| p,
            .@"mask-border-source" => VendorPrefix.empty(),
            .@"mask-border-mode" => VendorPrefix.empty(),
            .@"mask-border-slice" => VendorPrefix.empty(),
            .@"mask-border-width" => VendorPrefix.empty(),
            .@"mask-border-outset" => VendorPrefix.empty(),
            .@"mask-border-repeat" => VendorPrefix.empty(),
            .@"mask-border" => VendorPrefix.empty(),
            .@"-webkit-mask-composite" => VendorPrefix.empty(),
            .@"mask-source-type" => |p| p,
            .@"mask-box-image" => |p| p,
            .@"mask-box-image-source" => |p| p,
            .@"mask-box-image-slice" => |p| p,
            .@"mask-box-image-width" => |p| p,
            .@"mask-box-image-outset" => |p| p,
            .@"mask-box-image-repeat" => |p| p,
            .all, .custom, .unparsed => VendorPrefix.empty(),
        };
    }

    pub fn fromNameAndPrefix(name1: []const u8, pre: VendorPrefix) ?PropertyId {
        const Enum = enum { @"background-color", @"background-image", @"background-position-x", @"background-position-y", @"background-position", @"background-size", @"background-repeat", @"background-attachment", @"background-clip", @"background-origin", background, @"box-shadow", opacity, color, display, visibility, width, height, @"min-width", @"min-height", @"max-width", @"max-height", @"block-size", @"inline-size", @"min-block-size", @"min-inline-size", @"max-block-size", @"max-inline-size", @"box-sizing", @"aspect-ratio", overflow, @"overflow-x", @"overflow-y", @"text-overflow", position, top, bottom, left, right, @"inset-block-start", @"inset-block-end", @"inset-inline-start", @"inset-inline-end", @"inset-block", @"inset-inline", inset, @"border-spacing", @"border-top-color", @"border-bottom-color", @"border-left-color", @"border-right-color", @"border-block-start-color", @"border-block-end-color", @"border-inline-start-color", @"border-inline-end-color", @"border-top-style", @"border-bottom-style", @"border-left-style", @"border-right-style", @"border-block-start-style", @"border-block-end-style", @"border-inline-start-style", @"border-inline-end-style", @"border-top-width", @"border-bottom-width", @"border-left-width", @"border-right-width", @"border-block-start-width", @"border-block-end-width", @"border-inline-start-width", @"border-inline-end-width", @"border-top-left-radius", @"border-top-right-radius", @"border-bottom-left-radius", @"border-bottom-right-radius", @"border-start-start-radius", @"border-start-end-radius", @"border-end-start-radius", @"border-end-end-radius", @"border-radius", @"border-image-source", @"border-image-outset", @"border-image-repeat", @"border-image-width", @"border-image-slice", @"border-image", @"border-color", @"border-style", @"border-width", @"border-block-color", @"border-block-style", @"border-block-width", @"border-inline-color", @"border-inline-style", @"border-inline-width", border, @"border-top", @"border-bottom", @"border-left", @"border-right", @"border-block", @"border-block-start", @"border-block-end", @"border-inline", @"border-inline-start", @"border-inline-end", outline, @"outline-color", @"outline-style", @"outline-width", @"flex-direction", @"flex-wrap", @"flex-flow", @"flex-grow", @"flex-shrink", @"flex-basis", flex, order, @"align-content", @"justify-content", @"place-content", @"align-self", @"justify-self", @"place-self", @"align-items", @"justify-items", @"place-items", @"row-gap", @"column-gap", gap, @"box-orient", @"box-direction", @"box-ordinal-group", @"box-align", @"box-flex", @"box-flex-group", @"box-pack", @"box-lines", @"flex-pack", @"flex-order", @"flex-align", @"flex-item-align", @"flex-line-pack", @"flex-positive", @"flex-negative", @"flex-preferred-size", @"margin-top", @"margin-bottom", @"margin-left", @"margin-right", @"margin-block-start", @"margin-block-end", @"margin-inline-start", @"margin-inline-end", @"margin-block", @"margin-inline", margin, @"padding-top", @"padding-bottom", @"padding-left", @"padding-right", @"padding-block-start", @"padding-block-end", @"padding-inline-start", @"padding-inline-end", @"padding-block", @"padding-inline", padding, @"scroll-margin-top", @"scroll-margin-bottom", @"scroll-margin-left", @"scroll-margin-right", @"scroll-margin-block-start", @"scroll-margin-block-end", @"scroll-margin-inline-start", @"scroll-margin-inline-end", @"scroll-margin-block", @"scroll-margin-inline", @"scroll-margin", @"scroll-padding-top", @"scroll-padding-bottom", @"scroll-padding-left", @"scroll-padding-right", @"scroll-padding-block-start", @"scroll-padding-block-end", @"scroll-padding-inline-start", @"scroll-padding-inline-end", @"scroll-padding-block", @"scroll-padding-inline", @"scroll-padding", @"font-weight", @"font-size", @"font-stretch", @"font-family", @"font-style", @"font-variant-caps", @"line-height", font, @"text-decoration-color", @"text-emphasis-color", @"text-shadow", direction, composes, @"mask-image", @"mask-mode", @"mask-repeat", @"mask-position-x", @"mask-position-y", @"mask-position", @"mask-clip", @"mask-origin", @"mask-size", @"mask-composite", @"mask-type", mask, @"mask-border-source", @"mask-border-mode", @"mask-border-slice", @"mask-border-width", @"mask-border-outset", @"mask-border-repeat", @"mask-border", @"-webkit-mask-composite", @"mask-source-type", @"mask-box-image", @"mask-box-image-source", @"mask-box-image-slice", @"mask-box-image-width", @"mask-box-image-outset", @"mask-box-image-repeat" };
        const Map = comptime bun.ComptimeEnumMap(Enum);
        if (Map.getASCIIICaseInsensitive(name1)) |prop| {
            switch (prop) {
                .@"background-color" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"background-color";
                },
                .@"background-image" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"background-image";
                },
                .@"background-position-x" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"background-position-x";
                },
                .@"background-position-y" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"background-position-y";
                },
                .@"background-position" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"background-position";
                },
                .@"background-size" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"background-size";
                },
                .@"background-repeat" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"background-repeat";
                },
                .@"background-attachment" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"background-attachment";
                },
                .@"background-clip" => {
                    const allowed_prefixes = VendorPrefix{ .none = true, .webkit = true, .moz = true };
                    if (allowed_prefixes.contains(pre)) return .{ .@"background-clip" = pre };
                },
                .@"background-origin" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"background-origin";
                },
                .background => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .background;
                },
                .@"box-shadow" => {
                    const allowed_prefixes = VendorPrefix{ .none = true, .webkit = true, .moz = true };
                    if (allowed_prefixes.contains(pre)) return .{ .@"box-shadow" = pre };
                },
                .opacity => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .opacity;
                },
                .color => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .color;
                },
                .display => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .display;
                },
                .visibility => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .visibility;
                },
                .width => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .width;
                },
                .height => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .height;
                },
                .@"min-width" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"min-width";
                },
                .@"min-height" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"min-height";
                },
                .@"max-width" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"max-width";
                },
                .@"max-height" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"max-height";
                },
                .@"block-size" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"block-size";
                },
                .@"inline-size" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"inline-size";
                },
                .@"min-block-size" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"min-block-size";
                },
                .@"min-inline-size" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"min-inline-size";
                },
                .@"max-block-size" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"max-block-size";
                },
                .@"max-inline-size" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"max-inline-size";
                },
                .@"box-sizing" => {
                    const allowed_prefixes = VendorPrefix{ .none = true, .webkit = true, .moz = true };
                    if (allowed_prefixes.contains(pre)) return .{ .@"box-sizing" = pre };
                },
                .@"aspect-ratio" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"aspect-ratio";
                },
                .overflow => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .overflow;
                },
                .@"overflow-x" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"overflow-x";
                },
                .@"overflow-y" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"overflow-y";
                },
                .@"text-overflow" => {
                    const allowed_prefixes = VendorPrefix{ .none = true, .o = true };
                    if (allowed_prefixes.contains(pre)) return .{ .@"text-overflow" = pre };
                },
                .position => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .position;
                },
                .top => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .top;
                },
                .bottom => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .bottom;
                },
                .left => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .left;
                },
                .right => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .right;
                },
                .@"inset-block-start" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"inset-block-start";
                },
                .@"inset-block-end" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"inset-block-end";
                },
                .@"inset-inline-start" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"inset-inline-start";
                },
                .@"inset-inline-end" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"inset-inline-end";
                },
                .@"inset-block" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"inset-block";
                },
                .@"inset-inline" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"inset-inline";
                },
                .inset => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .inset;
                },
                .@"border-spacing" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"border-spacing";
                },
                .@"border-top-color" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"border-top-color";
                },
                .@"border-bottom-color" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"border-bottom-color";
                },
                .@"border-left-color" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"border-left-color";
                },
                .@"border-right-color" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"border-right-color";
                },
                .@"border-block-start-color" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"border-block-start-color";
                },
                .@"border-block-end-color" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"border-block-end-color";
                },
                .@"border-inline-start-color" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"border-inline-start-color";
                },
                .@"border-inline-end-color" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"border-inline-end-color";
                },
                .@"border-top-style" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"border-top-style";
                },
                .@"border-bottom-style" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"border-bottom-style";
                },
                .@"border-left-style" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"border-left-style";
                },
                .@"border-right-style" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"border-right-style";
                },
                .@"border-block-start-style" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"border-block-start-style";
                },
                .@"border-block-end-style" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"border-block-end-style";
                },
                .@"border-inline-start-style" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"border-inline-start-style";
                },
                .@"border-inline-end-style" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"border-inline-end-style";
                },
                .@"border-top-width" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"border-top-width";
                },
                .@"border-bottom-width" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"border-bottom-width";
                },
                .@"border-left-width" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"border-left-width";
                },
                .@"border-right-width" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"border-right-width";
                },
                .@"border-block-start-width" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"border-block-start-width";
                },
                .@"border-block-end-width" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"border-block-end-width";
                },
                .@"border-inline-start-width" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"border-inline-start-width";
                },
                .@"border-inline-end-width" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"border-inline-end-width";
                },
                .@"border-top-left-radius" => {
                    const allowed_prefixes = VendorPrefix{ .none = true, .webkit = true, .moz = true };
                    if (allowed_prefixes.contains(pre)) return .{ .@"border-top-left-radius" = pre };
                },
                .@"border-top-right-radius" => {
                    const allowed_prefixes = VendorPrefix{ .none = true, .webkit = true, .moz = true };
                    if (allowed_prefixes.contains(pre)) return .{ .@"border-top-right-radius" = pre };
                },
                .@"border-bottom-left-radius" => {
                    const allowed_prefixes = VendorPrefix{ .none = true, .webkit = true, .moz = true };
                    if (allowed_prefixes.contains(pre)) return .{ .@"border-bottom-left-radius" = pre };
                },
                .@"border-bottom-right-radius" => {
                    const allowed_prefixes = VendorPrefix{ .none = true, .webkit = true, .moz = true };
                    if (allowed_prefixes.contains(pre)) return .{ .@"border-bottom-right-radius" = pre };
                },
                .@"border-start-start-radius" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"border-start-start-radius";
                },
                .@"border-start-end-radius" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"border-start-end-radius";
                },
                .@"border-end-start-radius" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"border-end-start-radius";
                },
                .@"border-end-end-radius" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"border-end-end-radius";
                },
                .@"border-radius" => {
                    const allowed_prefixes = VendorPrefix{ .none = true, .webkit = true, .moz = true };
                    if (allowed_prefixes.contains(pre)) return .{ .@"border-radius" = pre };
                },
                .@"border-image-source" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"border-image-source";
                },
                .@"border-image-outset" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"border-image-outset";
                },
                .@"border-image-repeat" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"border-image-repeat";
                },
                .@"border-image-width" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"border-image-width";
                },
                .@"border-image-slice" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"border-image-slice";
                },
                .@"border-image" => {
                    const allowed_prefixes = VendorPrefix{ .none = true, .webkit = true, .moz = true, .o = true };
                    if (allowed_prefixes.contains(pre)) return .{ .@"border-image" = pre };
                },
                .@"border-color" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"border-color";
                },
                .@"border-style" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"border-style";
                },
                .@"border-width" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"border-width";
                },
                .@"border-block-color" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"border-block-color";
                },
                .@"border-block-style" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"border-block-style";
                },
                .@"border-block-width" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"border-block-width";
                },
                .@"border-inline-color" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"border-inline-color";
                },
                .@"border-inline-style" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"border-inline-style";
                },
                .@"border-inline-width" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"border-inline-width";
                },
                .border => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .border;
                },
                .@"border-top" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"border-top";
                },
                .@"border-bottom" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"border-bottom";
                },
                .@"border-left" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"border-left";
                },
                .@"border-right" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"border-right";
                },
                .@"border-block" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"border-block";
                },
                .@"border-block-start" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"border-block-start";
                },
                .@"border-block-end" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"border-block-end";
                },
                .@"border-inline" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"border-inline";
                },
                .@"border-inline-start" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"border-inline-start";
                },
                .@"border-inline-end" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"border-inline-end";
                },
                .outline => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .outline;
                },
                .@"outline-color" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"outline-color";
                },
                .@"outline-style" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"outline-style";
                },
                .@"outline-width" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"outline-width";
                },
                .@"flex-direction" => {
                    const allowed_prefixes = VendorPrefix{ .none = true, .webkit = true, .ms = true };
                    if (allowed_prefixes.contains(pre)) return .{ .@"flex-direction" = pre };
                },
                .@"flex-wrap" => {
                    const allowed_prefixes = VendorPrefix{ .none = true, .webkit = true, .ms = true };
                    if (allowed_prefixes.contains(pre)) return .{ .@"flex-wrap" = pre };
                },
                .@"flex-flow" => {
                    const allowed_prefixes = VendorPrefix{ .none = true, .webkit = true, .ms = true };
                    if (allowed_prefixes.contains(pre)) return .{ .@"flex-flow" = pre };
                },
                .@"flex-grow" => {
                    const allowed_prefixes = VendorPrefix{ .none = true, .webkit = true };
                    if (allowed_prefixes.contains(pre)) return .{ .@"flex-grow" = pre };
                },
                .@"flex-shrink" => {
                    const allowed_prefixes = VendorPrefix{ .none = true, .webkit = true };
                    if (allowed_prefixes.contains(pre)) return .{ .@"flex-shrink" = pre };
                },
                .@"flex-basis" => {
                    const allowed_prefixes = VendorPrefix{ .none = true, .webkit = true };
                    if (allowed_prefixes.contains(pre)) return .{ .@"flex-basis" = pre };
                },
                .flex => {
                    const allowed_prefixes = VendorPrefix{ .none = true, .webkit = true, .ms = true };
                    if (allowed_prefixes.contains(pre)) return .{ .flex = pre };
                },
                .order => {
                    const allowed_prefixes = VendorPrefix{ .none = true, .webkit = true };
                    if (allowed_prefixes.contains(pre)) return .{ .order = pre };
                },
                .@"align-content" => {
                    const allowed_prefixes = VendorPrefix{ .none = true, .webkit = true };
                    if (allowed_prefixes.contains(pre)) return .{ .@"align-content" = pre };
                },
                .@"justify-content" => {
                    const allowed_prefixes = VendorPrefix{ .none = true, .webkit = true };
                    if (allowed_prefixes.contains(pre)) return .{ .@"justify-content" = pre };
                },
                .@"place-content" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"place-content";
                },
                .@"align-self" => {
                    const allowed_prefixes = VendorPrefix{ .none = true, .webkit = true };
                    if (allowed_prefixes.contains(pre)) return .{ .@"align-self" = pre };
                },
                .@"justify-self" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"justify-self";
                },
                .@"place-self" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"place-self";
                },
                .@"align-items" => {
                    const allowed_prefixes = VendorPrefix{ .none = true, .webkit = true };
                    if (allowed_prefixes.contains(pre)) return .{ .@"align-items" = pre };
                },
                .@"justify-items" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"justify-items";
                },
                .@"place-items" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"place-items";
                },
                .@"row-gap" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"row-gap";
                },
                .@"column-gap" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"column-gap";
                },
                .gap => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .gap;
                },
                .@"box-orient" => {
                    const allowed_prefixes = VendorPrefix{ .none = true, .webkit = true, .moz = true };
                    if (allowed_prefixes.contains(pre)) return .{ .@"box-orient" = pre };
                },
                .@"box-direction" => {
                    const allowed_prefixes = VendorPrefix{ .none = true, .webkit = true, .moz = true };
                    if (allowed_prefixes.contains(pre)) return .{ .@"box-direction" = pre };
                },
                .@"box-ordinal-group" => {
                    const allowed_prefixes = VendorPrefix{ .none = true, .webkit = true, .moz = true };
                    if (allowed_prefixes.contains(pre)) return .{ .@"box-ordinal-group" = pre };
                },
                .@"box-align" => {
                    const allowed_prefixes = VendorPrefix{ .none = true, .webkit = true, .moz = true };
                    if (allowed_prefixes.contains(pre)) return .{ .@"box-align" = pre };
                },
                .@"box-flex" => {
                    const allowed_prefixes = VendorPrefix{ .none = true, .webkit = true, .moz = true };
                    if (allowed_prefixes.contains(pre)) return .{ .@"box-flex" = pre };
                },
                .@"box-flex-group" => {
                    const allowed_prefixes = VendorPrefix{ .none = true, .webkit = true };
                    if (allowed_prefixes.contains(pre)) return .{ .@"box-flex-group" = pre };
                },
                .@"box-pack" => {
                    const allowed_prefixes = VendorPrefix{ .none = true, .webkit = true, .moz = true };
                    if (allowed_prefixes.contains(pre)) return .{ .@"box-pack" = pre };
                },
                .@"box-lines" => {
                    const allowed_prefixes = VendorPrefix{ .none = true, .webkit = true, .moz = true };
                    if (allowed_prefixes.contains(pre)) return .{ .@"box-lines" = pre };
                },
                .@"flex-pack" => {
                    const allowed_prefixes = VendorPrefix{ .none = true, .ms = true };
                    if (allowed_prefixes.contains(pre)) return .{ .@"flex-pack" = pre };
                },
                .@"flex-order" => {
                    const allowed_prefixes = VendorPrefix{ .none = true, .ms = true };
                    if (allowed_prefixes.contains(pre)) return .{ .@"flex-order" = pre };
                },
                .@"flex-align" => {
                    const allowed_prefixes = VendorPrefix{ .none = true, .ms = true };
                    if (allowed_prefixes.contains(pre)) return .{ .@"flex-align" = pre };
                },
                .@"flex-item-align" => {
                    const allowed_prefixes = VendorPrefix{ .none = true, .ms = true };
                    if (allowed_prefixes.contains(pre)) return .{ .@"flex-item-align" = pre };
                },
                .@"flex-line-pack" => {
                    const allowed_prefixes = VendorPrefix{ .none = true, .ms = true };
                    if (allowed_prefixes.contains(pre)) return .{ .@"flex-line-pack" = pre };
                },
                .@"flex-positive" => {
                    const allowed_prefixes = VendorPrefix{ .none = true, .ms = true };
                    if (allowed_prefixes.contains(pre)) return .{ .@"flex-positive" = pre };
                },
                .@"flex-negative" => {
                    const allowed_prefixes = VendorPrefix{ .none = true, .ms = true };
                    if (allowed_prefixes.contains(pre)) return .{ .@"flex-negative" = pre };
                },
                .@"flex-preferred-size" => {
                    const allowed_prefixes = VendorPrefix{ .none = true, .ms = true };
                    if (allowed_prefixes.contains(pre)) return .{ .@"flex-preferred-size" = pre };
                },
                .@"margin-top" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"margin-top";
                },
                .@"margin-bottom" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"margin-bottom";
                },
                .@"margin-left" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"margin-left";
                },
                .@"margin-right" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"margin-right";
                },
                .@"margin-block-start" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"margin-block-start";
                },
                .@"margin-block-end" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"margin-block-end";
                },
                .@"margin-inline-start" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"margin-inline-start";
                },
                .@"margin-inline-end" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"margin-inline-end";
                },
                .@"margin-block" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"margin-block";
                },
                .@"margin-inline" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"margin-inline";
                },
                .margin => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .margin;
                },
                .@"padding-top" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"padding-top";
                },
                .@"padding-bottom" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"padding-bottom";
                },
                .@"padding-left" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"padding-left";
                },
                .@"padding-right" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"padding-right";
                },
                .@"padding-block-start" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"padding-block-start";
                },
                .@"padding-block-end" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"padding-block-end";
                },
                .@"padding-inline-start" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"padding-inline-start";
                },
                .@"padding-inline-end" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"padding-inline-end";
                },
                .@"padding-block" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"padding-block";
                },
                .@"padding-inline" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"padding-inline";
                },
                .padding => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .padding;
                },
                .@"scroll-margin-top" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"scroll-margin-top";
                },
                .@"scroll-margin-bottom" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"scroll-margin-bottom";
                },
                .@"scroll-margin-left" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"scroll-margin-left";
                },
                .@"scroll-margin-right" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"scroll-margin-right";
                },
                .@"scroll-margin-block-start" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"scroll-margin-block-start";
                },
                .@"scroll-margin-block-end" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"scroll-margin-block-end";
                },
                .@"scroll-margin-inline-start" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"scroll-margin-inline-start";
                },
                .@"scroll-margin-inline-end" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"scroll-margin-inline-end";
                },
                .@"scroll-margin-block" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"scroll-margin-block";
                },
                .@"scroll-margin-inline" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"scroll-margin-inline";
                },
                .@"scroll-margin" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"scroll-margin";
                },
                .@"scroll-padding-top" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"scroll-padding-top";
                },
                .@"scroll-padding-bottom" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"scroll-padding-bottom";
                },
                .@"scroll-padding-left" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"scroll-padding-left";
                },
                .@"scroll-padding-right" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"scroll-padding-right";
                },
                .@"scroll-padding-block-start" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"scroll-padding-block-start";
                },
                .@"scroll-padding-block-end" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"scroll-padding-block-end";
                },
                .@"scroll-padding-inline-start" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"scroll-padding-inline-start";
                },
                .@"scroll-padding-inline-end" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"scroll-padding-inline-end";
                },
                .@"scroll-padding-block" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"scroll-padding-block";
                },
                .@"scroll-padding-inline" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"scroll-padding-inline";
                },
                .@"scroll-padding" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"scroll-padding";
                },
                .@"font-weight" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"font-weight";
                },
                .@"font-size" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"font-size";
                },
                .@"font-stretch" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"font-stretch";
                },
                .@"font-family" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"font-family";
                },
                .@"font-style" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"font-style";
                },
                .@"font-variant-caps" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"font-variant-caps";
                },
                .@"line-height" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"line-height";
                },
                .font => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .font;
                },
                .@"text-decoration-color" => {
                    const allowed_prefixes = VendorPrefix{ .none = true, .webkit = true, .moz = true };
                    if (allowed_prefixes.contains(pre)) return .{ .@"text-decoration-color" = pre };
                },
                .@"text-emphasis-color" => {
                    const allowed_prefixes = VendorPrefix{ .none = true, .webkit = true };
                    if (allowed_prefixes.contains(pre)) return .{ .@"text-emphasis-color" = pre };
                },
                .@"text-shadow" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"text-shadow";
                },
                .direction => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .direction;
                },
                .composes => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .composes;
                },
                .@"mask-image" => {
                    const allowed_prefixes = VendorPrefix{ .none = true, .webkit = true };
                    if (allowed_prefixes.contains(pre)) return .{ .@"mask-image" = pre };
                },
                .@"mask-mode" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"mask-mode";
                },
                .@"mask-repeat" => {
                    const allowed_prefixes = VendorPrefix{ .none = true, .webkit = true };
                    if (allowed_prefixes.contains(pre)) return .{ .@"mask-repeat" = pre };
                },
                .@"mask-position-x" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"mask-position-x";
                },
                .@"mask-position-y" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"mask-position-y";
                },
                .@"mask-position" => {
                    const allowed_prefixes = VendorPrefix{ .none = true, .webkit = true };
                    if (allowed_prefixes.contains(pre)) return .{ .@"mask-position" = pre };
                },
                .@"mask-clip" => {
                    const allowed_prefixes = VendorPrefix{ .none = true, .webkit = true };
                    if (allowed_prefixes.contains(pre)) return .{ .@"mask-clip" = pre };
                },
                .@"mask-origin" => {
                    const allowed_prefixes = VendorPrefix{ .none = true, .webkit = true };
                    if (allowed_prefixes.contains(pre)) return .{ .@"mask-origin" = pre };
                },
                .@"mask-size" => {
                    const allowed_prefixes = VendorPrefix{ .none = true, .webkit = true };
                    if (allowed_prefixes.contains(pre)) return .{ .@"mask-size" = pre };
                },
                .@"mask-composite" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"mask-composite";
                },
                .@"mask-type" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"mask-type";
                },
                .mask => {
                    const allowed_prefixes = VendorPrefix{ .none = true, .webkit = true };
                    if (allowed_prefixes.contains(pre)) return .{ .mask = pre };
                },
                .@"mask-border-source" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"mask-border-source";
                },
                .@"mask-border-mode" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"mask-border-mode";
                },
                .@"mask-border-slice" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"mask-border-slice";
                },
                .@"mask-border-width" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"mask-border-width";
                },
                .@"mask-border-outset" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"mask-border-outset";
                },
                .@"mask-border-repeat" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"mask-border-repeat";
                },
                .@"mask-border" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"mask-border";
                },
                .@"-webkit-mask-composite" => {
                    const allowed_prefixes = VendorPrefix{ .none = true };
                    if (allowed_prefixes.contains(pre)) return .@"-webkit-mask-composite";
                },
                .@"mask-source-type" => {
                    const allowed_prefixes = VendorPrefix{ .none = true, .webkit = true };
                    if (allowed_prefixes.contains(pre)) return .{ .@"mask-source-type" = pre };
                },
                .@"mask-box-image" => {
                    const allowed_prefixes = VendorPrefix{ .none = true, .webkit = true };
                    if (allowed_prefixes.contains(pre)) return .{ .@"mask-box-image" = pre };
                },
                .@"mask-box-image-source" => {
                    const allowed_prefixes = VendorPrefix{ .none = true, .webkit = true };
                    if (allowed_prefixes.contains(pre)) return .{ .@"mask-box-image-source" = pre };
                },
                .@"mask-box-image-slice" => {
                    const allowed_prefixes = VendorPrefix{ .none = true, .webkit = true };
                    if (allowed_prefixes.contains(pre)) return .{ .@"mask-box-image-slice" = pre };
                },
                .@"mask-box-image-width" => {
                    const allowed_prefixes = VendorPrefix{ .none = true, .webkit = true };
                    if (allowed_prefixes.contains(pre)) return .{ .@"mask-box-image-width" = pre };
                },
                .@"mask-box-image-outset" => {
                    const allowed_prefixes = VendorPrefix{ .none = true, .webkit = true };
                    if (allowed_prefixes.contains(pre)) return .{ .@"mask-box-image-outset" = pre };
                },
                .@"mask-box-image-repeat" => {
                    const allowed_prefixes = VendorPrefix{ .none = true, .webkit = true };
                    if (allowed_prefixes.contains(pre)) return .{ .@"mask-box-image-repeat" = pre };
                },
            }
        }

        return null;
    }

    pub fn withPrefix(this: *const PropertyId, pre: VendorPrefix) PropertyId {
        return switch (this.*) {
            .@"background-color" => .@"background-color",
            .@"background-image" => .@"background-image",
            .@"background-position-x" => .@"background-position-x",
            .@"background-position-y" => .@"background-position-y",
            .@"background-position" => .@"background-position",
            .@"background-size" => .@"background-size",
            .@"background-repeat" => .@"background-repeat",
            .@"background-attachment" => .@"background-attachment",
            .@"background-clip" => .{ .@"background-clip" = pre },
            .@"background-origin" => .@"background-origin",
            .background => .background,
            .@"box-shadow" => .{ .@"box-shadow" = pre },
            .opacity => .opacity,
            .color => .color,
            .display => .display,
            .visibility => .visibility,
            .width => .width,
            .height => .height,
            .@"min-width" => .@"min-width",
            .@"min-height" => .@"min-height",
            .@"max-width" => .@"max-width",
            .@"max-height" => .@"max-height",
            .@"block-size" => .@"block-size",
            .@"inline-size" => .@"inline-size",
            .@"min-block-size" => .@"min-block-size",
            .@"min-inline-size" => .@"min-inline-size",
            .@"max-block-size" => .@"max-block-size",
            .@"max-inline-size" => .@"max-inline-size",
            .@"box-sizing" => .{ .@"box-sizing" = pre },
            .@"aspect-ratio" => .@"aspect-ratio",
            .overflow => .overflow,
            .@"overflow-x" => .@"overflow-x",
            .@"overflow-y" => .@"overflow-y",
            .@"text-overflow" => .{ .@"text-overflow" = pre },
            .position => .position,
            .top => .top,
            .bottom => .bottom,
            .left => .left,
            .right => .right,
            .@"inset-block-start" => .@"inset-block-start",
            .@"inset-block-end" => .@"inset-block-end",
            .@"inset-inline-start" => .@"inset-inline-start",
            .@"inset-inline-end" => .@"inset-inline-end",
            .@"inset-block" => .@"inset-block",
            .@"inset-inline" => .@"inset-inline",
            .inset => .inset,
            .@"border-spacing" => .@"border-spacing",
            .@"border-top-color" => .@"border-top-color",
            .@"border-bottom-color" => .@"border-bottom-color",
            .@"border-left-color" => .@"border-left-color",
            .@"border-right-color" => .@"border-right-color",
            .@"border-block-start-color" => .@"border-block-start-color",
            .@"border-block-end-color" => .@"border-block-end-color",
            .@"border-inline-start-color" => .@"border-inline-start-color",
            .@"border-inline-end-color" => .@"border-inline-end-color",
            .@"border-top-style" => .@"border-top-style",
            .@"border-bottom-style" => .@"border-bottom-style",
            .@"border-left-style" => .@"border-left-style",
            .@"border-right-style" => .@"border-right-style",
            .@"border-block-start-style" => .@"border-block-start-style",
            .@"border-block-end-style" => .@"border-block-end-style",
            .@"border-inline-start-style" => .@"border-inline-start-style",
            .@"border-inline-end-style" => .@"border-inline-end-style",
            .@"border-top-width" => .@"border-top-width",
            .@"border-bottom-width" => .@"border-bottom-width",
            .@"border-left-width" => .@"border-left-width",
            .@"border-right-width" => .@"border-right-width",
            .@"border-block-start-width" => .@"border-block-start-width",
            .@"border-block-end-width" => .@"border-block-end-width",
            .@"border-inline-start-width" => .@"border-inline-start-width",
            .@"border-inline-end-width" => .@"border-inline-end-width",
            .@"border-top-left-radius" => .{ .@"border-top-left-radius" = pre },
            .@"border-top-right-radius" => .{ .@"border-top-right-radius" = pre },
            .@"border-bottom-left-radius" => .{ .@"border-bottom-left-radius" = pre },
            .@"border-bottom-right-radius" => .{ .@"border-bottom-right-radius" = pre },
            .@"border-start-start-radius" => .@"border-start-start-radius",
            .@"border-start-end-radius" => .@"border-start-end-radius",
            .@"border-end-start-radius" => .@"border-end-start-radius",
            .@"border-end-end-radius" => .@"border-end-end-radius",
            .@"border-radius" => .{ .@"border-radius" = pre },
            .@"border-image-source" => .@"border-image-source",
            .@"border-image-outset" => .@"border-image-outset",
            .@"border-image-repeat" => .@"border-image-repeat",
            .@"border-image-width" => .@"border-image-width",
            .@"border-image-slice" => .@"border-image-slice",
            .@"border-image" => .{ .@"border-image" = pre },
            .@"border-color" => .@"border-color",
            .@"border-style" => .@"border-style",
            .@"border-width" => .@"border-width",
            .@"border-block-color" => .@"border-block-color",
            .@"border-block-style" => .@"border-block-style",
            .@"border-block-width" => .@"border-block-width",
            .@"border-inline-color" => .@"border-inline-color",
            .@"border-inline-style" => .@"border-inline-style",
            .@"border-inline-width" => .@"border-inline-width",
            .border => .border,
            .@"border-top" => .@"border-top",
            .@"border-bottom" => .@"border-bottom",
            .@"border-left" => .@"border-left",
            .@"border-right" => .@"border-right",
            .@"border-block" => .@"border-block",
            .@"border-block-start" => .@"border-block-start",
            .@"border-block-end" => .@"border-block-end",
            .@"border-inline" => .@"border-inline",
            .@"border-inline-start" => .@"border-inline-start",
            .@"border-inline-end" => .@"border-inline-end",
            .outline => .outline,
            .@"outline-color" => .@"outline-color",
            .@"outline-style" => .@"outline-style",
            .@"outline-width" => .@"outline-width",
            .@"flex-direction" => .{ .@"flex-direction" = pre },
            .@"flex-wrap" => .{ .@"flex-wrap" = pre },
            .@"flex-flow" => .{ .@"flex-flow" = pre },
            .@"flex-grow" => .{ .@"flex-grow" = pre },
            .@"flex-shrink" => .{ .@"flex-shrink" = pre },
            .@"flex-basis" => .{ .@"flex-basis" = pre },
            .flex => .{ .flex = pre },
            .order => .{ .order = pre },
            .@"align-content" => .{ .@"align-content" = pre },
            .@"justify-content" => .{ .@"justify-content" = pre },
            .@"place-content" => .@"place-content",
            .@"align-self" => .{ .@"align-self" = pre },
            .@"justify-self" => .@"justify-self",
            .@"place-self" => .@"place-self",
            .@"align-items" => .{ .@"align-items" = pre },
            .@"justify-items" => .@"justify-items",
            .@"place-items" => .@"place-items",
            .@"row-gap" => .@"row-gap",
            .@"column-gap" => .@"column-gap",
            .gap => .gap,
            .@"box-orient" => .{ .@"box-orient" = pre },
            .@"box-direction" => .{ .@"box-direction" = pre },
            .@"box-ordinal-group" => .{ .@"box-ordinal-group" = pre },
            .@"box-align" => .{ .@"box-align" = pre },
            .@"box-flex" => .{ .@"box-flex" = pre },
            .@"box-flex-group" => .{ .@"box-flex-group" = pre },
            .@"box-pack" => .{ .@"box-pack" = pre },
            .@"box-lines" => .{ .@"box-lines" = pre },
            .@"flex-pack" => .{ .@"flex-pack" = pre },
            .@"flex-order" => .{ .@"flex-order" = pre },
            .@"flex-align" => .{ .@"flex-align" = pre },
            .@"flex-item-align" => .{ .@"flex-item-align" = pre },
            .@"flex-line-pack" => .{ .@"flex-line-pack" = pre },
            .@"flex-positive" => .{ .@"flex-positive" = pre },
            .@"flex-negative" => .{ .@"flex-negative" = pre },
            .@"flex-preferred-size" => .{ .@"flex-preferred-size" = pre },
            .@"margin-top" => .@"margin-top",
            .@"margin-bottom" => .@"margin-bottom",
            .@"margin-left" => .@"margin-left",
            .@"margin-right" => .@"margin-right",
            .@"margin-block-start" => .@"margin-block-start",
            .@"margin-block-end" => .@"margin-block-end",
            .@"margin-inline-start" => .@"margin-inline-start",
            .@"margin-inline-end" => .@"margin-inline-end",
            .@"margin-block" => .@"margin-block",
            .@"margin-inline" => .@"margin-inline",
            .margin => .margin,
            .@"padding-top" => .@"padding-top",
            .@"padding-bottom" => .@"padding-bottom",
            .@"padding-left" => .@"padding-left",
            .@"padding-right" => .@"padding-right",
            .@"padding-block-start" => .@"padding-block-start",
            .@"padding-block-end" => .@"padding-block-end",
            .@"padding-inline-start" => .@"padding-inline-start",
            .@"padding-inline-end" => .@"padding-inline-end",
            .@"padding-block" => .@"padding-block",
            .@"padding-inline" => .@"padding-inline",
            .padding => .padding,
            .@"scroll-margin-top" => .@"scroll-margin-top",
            .@"scroll-margin-bottom" => .@"scroll-margin-bottom",
            .@"scroll-margin-left" => .@"scroll-margin-left",
            .@"scroll-margin-right" => .@"scroll-margin-right",
            .@"scroll-margin-block-start" => .@"scroll-margin-block-start",
            .@"scroll-margin-block-end" => .@"scroll-margin-block-end",
            .@"scroll-margin-inline-start" => .@"scroll-margin-inline-start",
            .@"scroll-margin-inline-end" => .@"scroll-margin-inline-end",
            .@"scroll-margin-block" => .@"scroll-margin-block",
            .@"scroll-margin-inline" => .@"scroll-margin-inline",
            .@"scroll-margin" => .@"scroll-margin",
            .@"scroll-padding-top" => .@"scroll-padding-top",
            .@"scroll-padding-bottom" => .@"scroll-padding-bottom",
            .@"scroll-padding-left" => .@"scroll-padding-left",
            .@"scroll-padding-right" => .@"scroll-padding-right",
            .@"scroll-padding-block-start" => .@"scroll-padding-block-start",
            .@"scroll-padding-block-end" => .@"scroll-padding-block-end",
            .@"scroll-padding-inline-start" => .@"scroll-padding-inline-start",
            .@"scroll-padding-inline-end" => .@"scroll-padding-inline-end",
            .@"scroll-padding-block" => .@"scroll-padding-block",
            .@"scroll-padding-inline" => .@"scroll-padding-inline",
            .@"scroll-padding" => .@"scroll-padding",
            .@"font-weight" => .@"font-weight",
            .@"font-size" => .@"font-size",
            .@"font-stretch" => .@"font-stretch",
            .@"font-family" => .@"font-family",
            .@"font-style" => .@"font-style",
            .@"font-variant-caps" => .@"font-variant-caps",
            .@"line-height" => .@"line-height",
            .font => .font,
            .@"text-decoration-color" => .{ .@"text-decoration-color" = pre },
            .@"text-emphasis-color" => .{ .@"text-emphasis-color" = pre },
            .@"text-shadow" => .@"text-shadow",
            .direction => .direction,
            .composes => .composes,
            .@"mask-image" => .{ .@"mask-image" = pre },
            .@"mask-mode" => .@"mask-mode",
            .@"mask-repeat" => .{ .@"mask-repeat" = pre },
            .@"mask-position-x" => .@"mask-position-x",
            .@"mask-position-y" => .@"mask-position-y",
            .@"mask-position" => .{ .@"mask-position" = pre },
            .@"mask-clip" => .{ .@"mask-clip" = pre },
            .@"mask-origin" => .{ .@"mask-origin" = pre },
            .@"mask-size" => .{ .@"mask-size" = pre },
            .@"mask-composite" => .@"mask-composite",
            .@"mask-type" => .@"mask-type",
            .mask => .{ .mask = pre },
            .@"mask-border-source" => .@"mask-border-source",
            .@"mask-border-mode" => .@"mask-border-mode",
            .@"mask-border-slice" => .@"mask-border-slice",
            .@"mask-border-width" => .@"mask-border-width",
            .@"mask-border-outset" => .@"mask-border-outset",
            .@"mask-border-repeat" => .@"mask-border-repeat",
            .@"mask-border" => .@"mask-border",
            .@"-webkit-mask-composite" => .@"-webkit-mask-composite",
            .@"mask-source-type" => .{ .@"mask-source-type" = pre },
            .@"mask-box-image" => .{ .@"mask-box-image" = pre },
            .@"mask-box-image-source" => .{ .@"mask-box-image-source" = pre },
            .@"mask-box-image-slice" => .{ .@"mask-box-image-slice" = pre },
            .@"mask-box-image-width" => .{ .@"mask-box-image-width" = pre },
            .@"mask-box-image-outset" => .{ .@"mask-box-image-outset" = pre },
            .@"mask-box-image-repeat" => .{ .@"mask-box-image-repeat" = pre },
            else => this.*,
        };
    }

    pub fn addPrefix(this: *PropertyId, pre: VendorPrefix) void {
        return switch (this.*) {
            .@"background-color" => {},
            .@"background-image" => {},
            .@"background-position-x" => {},
            .@"background-position-y" => {},
            .@"background-position" => {},
            .@"background-size" => {},
            .@"background-repeat" => {},
            .@"background-attachment" => {},
            .@"background-clip" => |*p| {
                p.insert(pre);
            },
            .@"background-origin" => {},
            .background => {},
            .@"box-shadow" => |*p| {
                p.insert(pre);
            },
            .opacity => {},
            .color => {},
            .display => {},
            .visibility => {},
            .width => {},
            .height => {},
            .@"min-width" => {},
            .@"min-height" => {},
            .@"max-width" => {},
            .@"max-height" => {},
            .@"block-size" => {},
            .@"inline-size" => {},
            .@"min-block-size" => {},
            .@"min-inline-size" => {},
            .@"max-block-size" => {},
            .@"max-inline-size" => {},
            .@"box-sizing" => |*p| {
                p.insert(pre);
            },
            .@"aspect-ratio" => {},
            .overflow => {},
            .@"overflow-x" => {},
            .@"overflow-y" => {},
            .@"text-overflow" => |*p| {
                p.insert(pre);
            },
            .position => {},
            .top => {},
            .bottom => {},
            .left => {},
            .right => {},
            .@"inset-block-start" => {},
            .@"inset-block-end" => {},
            .@"inset-inline-start" => {},
            .@"inset-inline-end" => {},
            .@"inset-block" => {},
            .@"inset-inline" => {},
            .inset => {},
            .@"border-spacing" => {},
            .@"border-top-color" => {},
            .@"border-bottom-color" => {},
            .@"border-left-color" => {},
            .@"border-right-color" => {},
            .@"border-block-start-color" => {},
            .@"border-block-end-color" => {},
            .@"border-inline-start-color" => {},
            .@"border-inline-end-color" => {},
            .@"border-top-style" => {},
            .@"border-bottom-style" => {},
            .@"border-left-style" => {},
            .@"border-right-style" => {},
            .@"border-block-start-style" => {},
            .@"border-block-end-style" => {},
            .@"border-inline-start-style" => {},
            .@"border-inline-end-style" => {},
            .@"border-top-width" => {},
            .@"border-bottom-width" => {},
            .@"border-left-width" => {},
            .@"border-right-width" => {},
            .@"border-block-start-width" => {},
            .@"border-block-end-width" => {},
            .@"border-inline-start-width" => {},
            .@"border-inline-end-width" => {},
            .@"border-top-left-radius" => |*p| {
                p.insert(pre);
            },
            .@"border-top-right-radius" => |*p| {
                p.insert(pre);
            },
            .@"border-bottom-left-radius" => |*p| {
                p.insert(pre);
            },
            .@"border-bottom-right-radius" => |*p| {
                p.insert(pre);
            },
            .@"border-start-start-radius" => {},
            .@"border-start-end-radius" => {},
            .@"border-end-start-radius" => {},
            .@"border-end-end-radius" => {},
            .@"border-radius" => |*p| {
                p.insert(pre);
            },
            .@"border-image-source" => {},
            .@"border-image-outset" => {},
            .@"border-image-repeat" => {},
            .@"border-image-width" => {},
            .@"border-image-slice" => {},
            .@"border-image" => |*p| {
                p.insert(pre);
            },
            .@"border-color" => {},
            .@"border-style" => {},
            .@"border-width" => {},
            .@"border-block-color" => {},
            .@"border-block-style" => {},
            .@"border-block-width" => {},
            .@"border-inline-color" => {},
            .@"border-inline-style" => {},
            .@"border-inline-width" => {},
            .border => {},
            .@"border-top" => {},
            .@"border-bottom" => {},
            .@"border-left" => {},
            .@"border-right" => {},
            .@"border-block" => {},
            .@"border-block-start" => {},
            .@"border-block-end" => {},
            .@"border-inline" => {},
            .@"border-inline-start" => {},
            .@"border-inline-end" => {},
            .outline => {},
            .@"outline-color" => {},
            .@"outline-style" => {},
            .@"outline-width" => {},
            .@"flex-direction" => |*p| {
                p.insert(pre);
            },
            .@"flex-wrap" => |*p| {
                p.insert(pre);
            },
            .@"flex-flow" => |*p| {
                p.insert(pre);
            },
            .@"flex-grow" => |*p| {
                p.insert(pre);
            },
            .@"flex-shrink" => |*p| {
                p.insert(pre);
            },
            .@"flex-basis" => |*p| {
                p.insert(pre);
            },
            .flex => |*p| {
                p.insert(pre);
            },
            .order => |*p| {
                p.insert(pre);
            },
            .@"align-content" => |*p| {
                p.insert(pre);
            },
            .@"justify-content" => |*p| {
                p.insert(pre);
            },
            .@"place-content" => {},
            .@"align-self" => |*p| {
                p.insert(pre);
            },
            .@"justify-self" => {},
            .@"place-self" => {},
            .@"align-items" => |*p| {
                p.insert(pre);
            },
            .@"justify-items" => {},
            .@"place-items" => {},
            .@"row-gap" => {},
            .@"column-gap" => {},
            .gap => {},
            .@"box-orient" => |*p| {
                p.insert(pre);
            },
            .@"box-direction" => |*p| {
                p.insert(pre);
            },
            .@"box-ordinal-group" => |*p| {
                p.insert(pre);
            },
            .@"box-align" => |*p| {
                p.insert(pre);
            },
            .@"box-flex" => |*p| {
                p.insert(pre);
            },
            .@"box-flex-group" => |*p| {
                p.insert(pre);
            },
            .@"box-pack" => |*p| {
                p.insert(pre);
            },
            .@"box-lines" => |*p| {
                p.insert(pre);
            },
            .@"flex-pack" => |*p| {
                p.insert(pre);
            },
            .@"flex-order" => |*p| {
                p.insert(pre);
            },
            .@"flex-align" => |*p| {
                p.insert(pre);
            },
            .@"flex-item-align" => |*p| {
                p.insert(pre);
            },
            .@"flex-line-pack" => |*p| {
                p.insert(pre);
            },
            .@"flex-positive" => |*p| {
                p.insert(pre);
            },
            .@"flex-negative" => |*p| {
                p.insert(pre);
            },
            .@"flex-preferred-size" => |*p| {
                p.insert(pre);
            },
            .@"margin-top" => {},
            .@"margin-bottom" => {},
            .@"margin-left" => {},
            .@"margin-right" => {},
            .@"margin-block-start" => {},
            .@"margin-block-end" => {},
            .@"margin-inline-start" => {},
            .@"margin-inline-end" => {},
            .@"margin-block" => {},
            .@"margin-inline" => {},
            .margin => {},
            .@"padding-top" => {},
            .@"padding-bottom" => {},
            .@"padding-left" => {},
            .@"padding-right" => {},
            .@"padding-block-start" => {},
            .@"padding-block-end" => {},
            .@"padding-inline-start" => {},
            .@"padding-inline-end" => {},
            .@"padding-block" => {},
            .@"padding-inline" => {},
            .padding => {},
            .@"scroll-margin-top" => {},
            .@"scroll-margin-bottom" => {},
            .@"scroll-margin-left" => {},
            .@"scroll-margin-right" => {},
            .@"scroll-margin-block-start" => {},
            .@"scroll-margin-block-end" => {},
            .@"scroll-margin-inline-start" => {},
            .@"scroll-margin-inline-end" => {},
            .@"scroll-margin-block" => {},
            .@"scroll-margin-inline" => {},
            .@"scroll-margin" => {},
            .@"scroll-padding-top" => {},
            .@"scroll-padding-bottom" => {},
            .@"scroll-padding-left" => {},
            .@"scroll-padding-right" => {},
            .@"scroll-padding-block-start" => {},
            .@"scroll-padding-block-end" => {},
            .@"scroll-padding-inline-start" => {},
            .@"scroll-padding-inline-end" => {},
            .@"scroll-padding-block" => {},
            .@"scroll-padding-inline" => {},
            .@"scroll-padding" => {},
            .@"font-weight" => {},
            .@"font-size" => {},
            .@"font-stretch" => {},
            .@"font-family" => {},
            .@"font-style" => {},
            .@"font-variant-caps" => {},
            .@"line-height" => {},
            .font => {},
            .@"text-decoration-color" => |*p| {
                p.insert(pre);
            },
            .@"text-emphasis-color" => |*p| {
                p.insert(pre);
            },
            .@"text-shadow" => {},
            .direction => {},
            .composes => {},
            .@"mask-image" => |*p| {
                p.insert(pre);
            },
            .@"mask-mode" => {},
            .@"mask-repeat" => |*p| {
                p.insert(pre);
            },
            .@"mask-position-x" => {},
            .@"mask-position-y" => {},
            .@"mask-position" => |*p| {
                p.insert(pre);
            },
            .@"mask-clip" => |*p| {
                p.insert(pre);
            },
            .@"mask-origin" => |*p| {
                p.insert(pre);
            },
            .@"mask-size" => |*p| {
                p.insert(pre);
            },
            .@"mask-composite" => {},
            .@"mask-type" => {},
            .mask => |*p| {
                p.insert(pre);
            },
            .@"mask-border-source" => {},
            .@"mask-border-mode" => {},
            .@"mask-border-slice" => {},
            .@"mask-border-width" => {},
            .@"mask-border-outset" => {},
            .@"mask-border-repeat" => {},
            .@"mask-border" => {},
            .@"-webkit-mask-composite" => {},
            .@"mask-source-type" => |*p| {
                p.insert(pre);
            },
            .@"mask-box-image" => |*p| {
                p.insert(pre);
            },
            .@"mask-box-image-source" => |*p| {
                p.insert(pre);
            },
            .@"mask-box-image-slice" => |*p| {
                p.insert(pre);
            },
            .@"mask-box-image-width" => |*p| {
                p.insert(pre);
            },
            .@"mask-box-image-outset" => |*p| {
                p.insert(pre);
            },
            .@"mask-box-image-repeat" => |*p| {
                p.insert(pre);
            },
            else => {},
        };
    }

    pub inline fn deepClone(this: *const PropertyId, _: std.mem.Allocator) PropertyId {
        return this.*;
    }

    pub fn eql(lhs: *const PropertyId, rhs: *const PropertyId) bool {
        if (@intFromEnum(lhs.*) != @intFromEnum(rhs.*)) return false;
        inline for (bun.meta.EnumFields(PropertyId), std.meta.fields(PropertyId)) |enum_field, union_field| {
            if (enum_field.value == @intFromEnum(lhs.*)) {
                if (comptime union_field.type == css.VendorPrefix) {
                    return @field(lhs, union_field.name).eql(@field(rhs, union_field.name));
                } else {
                    return true;
                }
            }
        }
        unreachable;
    }

    pub fn hash(this: *const PropertyId, hasher: *std.hash.Wyhash) void {
        const tag = @intFromEnum(this.*);
        hasher.update(std.mem.asBytes(&tag));
    }
};
pub const PropertyIdTag = enum(u16) {
    @"background-color",
    @"background-image",
    @"background-position-x",
    @"background-position-y",
    @"background-position",
    @"background-size",
    @"background-repeat",
    @"background-attachment",
    @"background-clip",
    @"background-origin",
    background,
    @"box-shadow",
    opacity,
    color,
    display,
    visibility,
    width,
    height,
    @"min-width",
    @"min-height",
    @"max-width",
    @"max-height",
    @"block-size",
    @"inline-size",
    @"min-block-size",
    @"min-inline-size",
    @"max-block-size",
    @"max-inline-size",
    @"box-sizing",
    @"aspect-ratio",
    overflow,
    @"overflow-x",
    @"overflow-y",
    @"text-overflow",
    position,
    top,
    bottom,
    left,
    right,
    @"inset-block-start",
    @"inset-block-end",
    @"inset-inline-start",
    @"inset-inline-end",
    @"inset-block",
    @"inset-inline",
    inset,
    @"border-spacing",
    @"border-top-color",
    @"border-bottom-color",
    @"border-left-color",
    @"border-right-color",
    @"border-block-start-color",
    @"border-block-end-color",
    @"border-inline-start-color",
    @"border-inline-end-color",
    @"border-top-style",
    @"border-bottom-style",
    @"border-left-style",
    @"border-right-style",
    @"border-block-start-style",
    @"border-block-end-style",
    @"border-inline-start-style",
    @"border-inline-end-style",
    @"border-top-width",
    @"border-bottom-width",
    @"border-left-width",
    @"border-right-width",
    @"border-block-start-width",
    @"border-block-end-width",
    @"border-inline-start-width",
    @"border-inline-end-width",
    @"border-top-left-radius",
    @"border-top-right-radius",
    @"border-bottom-left-radius",
    @"border-bottom-right-radius",
    @"border-start-start-radius",
    @"border-start-end-radius",
    @"border-end-start-radius",
    @"border-end-end-radius",
    @"border-radius",
    @"border-image-source",
    @"border-image-outset",
    @"border-image-repeat",
    @"border-image-width",
    @"border-image-slice",
    @"border-image",
    @"border-color",
    @"border-style",
    @"border-width",
    @"border-block-color",
    @"border-block-style",
    @"border-block-width",
    @"border-inline-color",
    @"border-inline-style",
    @"border-inline-width",
    border,
    @"border-top",
    @"border-bottom",
    @"border-left",
    @"border-right",
    @"border-block",
    @"border-block-start",
    @"border-block-end",
    @"border-inline",
    @"border-inline-start",
    @"border-inline-end",
    outline,
    @"outline-color",
    @"outline-style",
    @"outline-width",
    @"flex-direction",
    @"flex-wrap",
    @"flex-flow",
    @"flex-grow",
    @"flex-shrink",
    @"flex-basis",
    flex,
    order,
    @"align-content",
    @"justify-content",
    @"place-content",
    @"align-self",
    @"justify-self",
    @"place-self",
    @"align-items",
    @"justify-items",
    @"place-items",
    @"row-gap",
    @"column-gap",
    gap,
    @"box-orient",
    @"box-direction",
    @"box-ordinal-group",
    @"box-align",
    @"box-flex",
    @"box-flex-group",
    @"box-pack",
    @"box-lines",
    @"flex-pack",
    @"flex-order",
    @"flex-align",
    @"flex-item-align",
    @"flex-line-pack",
    @"flex-positive",
    @"flex-negative",
    @"flex-preferred-size",
    @"margin-top",
    @"margin-bottom",
    @"margin-left",
    @"margin-right",
    @"margin-block-start",
    @"margin-block-end",
    @"margin-inline-start",
    @"margin-inline-end",
    @"margin-block",
    @"margin-inline",
    margin,
    @"padding-top",
    @"padding-bottom",
    @"padding-left",
    @"padding-right",
    @"padding-block-start",
    @"padding-block-end",
    @"padding-inline-start",
    @"padding-inline-end",
    @"padding-block",
    @"padding-inline",
    padding,
    @"scroll-margin-top",
    @"scroll-margin-bottom",
    @"scroll-margin-left",
    @"scroll-margin-right",
    @"scroll-margin-block-start",
    @"scroll-margin-block-end",
    @"scroll-margin-inline-start",
    @"scroll-margin-inline-end",
    @"scroll-margin-block",
    @"scroll-margin-inline",
    @"scroll-margin",
    @"scroll-padding-top",
    @"scroll-padding-bottom",
    @"scroll-padding-left",
    @"scroll-padding-right",
    @"scroll-padding-block-start",
    @"scroll-padding-block-end",
    @"scroll-padding-inline-start",
    @"scroll-padding-inline-end",
    @"scroll-padding-block",
    @"scroll-padding-inline",
    @"scroll-padding",
    @"font-weight",
    @"font-size",
    @"font-stretch",
    @"font-family",
    @"font-style",
    @"font-variant-caps",
    @"line-height",
    font,
    @"text-decoration-color",
    @"text-emphasis-color",
    @"text-shadow",
    direction,
    composes,
    @"mask-image",
    @"mask-mode",
    @"mask-repeat",
    @"mask-position-x",
    @"mask-position-y",
    @"mask-position",
    @"mask-clip",
    @"mask-origin",
    @"mask-size",
    @"mask-composite",
    @"mask-type",
    mask,
    @"mask-border-source",
    @"mask-border-mode",
    @"mask-border-slice",
    @"mask-border-width",
    @"mask-border-outset",
    @"mask-border-repeat",
    @"mask-border",
    @"-webkit-mask-composite",
    @"mask-source-type",
    @"mask-box-image",
    @"mask-box-image-source",
    @"mask-box-image-slice",
    @"mask-box-image-width",
    @"mask-box-image-outset",
    @"mask-box-image-repeat",
    all,
    unparsed,
    custom,

    /// Helper function used in comptime code to know whether to access the underlying value
    /// with tuple indexing syntax because it may have a VendorPrefix associated with it.
    pub fn hasVendorPrefix(this: PropertyIdTag) bool {
        return switch (this) {
            .@"background-color" => false,
            .@"background-image" => false,
            .@"background-position-x" => false,
            .@"background-position-y" => false,
            .@"background-position" => false,
            .@"background-size" => false,
            .@"background-repeat" => false,
            .@"background-attachment" => false,
            .@"background-clip" => true,
            .@"background-origin" => false,
            .background => false,
            .@"box-shadow" => true,
            .opacity => false,
            .color => false,
            .display => false,
            .visibility => false,
            .width => false,
            .height => false,
            .@"min-width" => false,
            .@"min-height" => false,
            .@"max-width" => false,
            .@"max-height" => false,
            .@"block-size" => false,
            .@"inline-size" => false,
            .@"min-block-size" => false,
            .@"min-inline-size" => false,
            .@"max-block-size" => false,
            .@"max-inline-size" => false,
            .@"box-sizing" => true,
            .@"aspect-ratio" => false,
            .overflow => false,
            .@"overflow-x" => false,
            .@"overflow-y" => false,
            .@"text-overflow" => true,
            .position => false,
            .top => false,
            .bottom => false,
            .left => false,
            .right => false,
            .@"inset-block-start" => false,
            .@"inset-block-end" => false,
            .@"inset-inline-start" => false,
            .@"inset-inline-end" => false,
            .@"inset-block" => false,
            .@"inset-inline" => false,
            .inset => false,
            .@"border-spacing" => false,
            .@"border-top-color" => false,
            .@"border-bottom-color" => false,
            .@"border-left-color" => false,
            .@"border-right-color" => false,
            .@"border-block-start-color" => false,
            .@"border-block-end-color" => false,
            .@"border-inline-start-color" => false,
            .@"border-inline-end-color" => false,
            .@"border-top-style" => false,
            .@"border-bottom-style" => false,
            .@"border-left-style" => false,
            .@"border-right-style" => false,
            .@"border-block-start-style" => false,
            .@"border-block-end-style" => false,
            .@"border-inline-start-style" => false,
            .@"border-inline-end-style" => false,
            .@"border-top-width" => false,
            .@"border-bottom-width" => false,
            .@"border-left-width" => false,
            .@"border-right-width" => false,
            .@"border-block-start-width" => false,
            .@"border-block-end-width" => false,
            .@"border-inline-start-width" => false,
            .@"border-inline-end-width" => false,
            .@"border-top-left-radius" => true,
            .@"border-top-right-radius" => true,
            .@"border-bottom-left-radius" => true,
            .@"border-bottom-right-radius" => true,
            .@"border-start-start-radius" => false,
            .@"border-start-end-radius" => false,
            .@"border-end-start-radius" => false,
            .@"border-end-end-radius" => false,
            .@"border-radius" => true,
            .@"border-image-source" => false,
            .@"border-image-outset" => false,
            .@"border-image-repeat" => false,
            .@"border-image-width" => false,
            .@"border-image-slice" => false,
            .@"border-image" => true,
            .@"border-color" => false,
            .@"border-style" => false,
            .@"border-width" => false,
            .@"border-block-color" => false,
            .@"border-block-style" => false,
            .@"border-block-width" => false,
            .@"border-inline-color" => false,
            .@"border-inline-style" => false,
            .@"border-inline-width" => false,
            .border => false,
            .@"border-top" => false,
            .@"border-bottom" => false,
            .@"border-left" => false,
            .@"border-right" => false,
            .@"border-block" => false,
            .@"border-block-start" => false,
            .@"border-block-end" => false,
            .@"border-inline" => false,
            .@"border-inline-start" => false,
            .@"border-inline-end" => false,
            .outline => false,
            .@"outline-color" => false,
            .@"outline-style" => false,
            .@"outline-width" => false,
            .@"flex-direction" => true,
            .@"flex-wrap" => true,
            .@"flex-flow" => true,
            .@"flex-grow" => true,
            .@"flex-shrink" => true,
            .@"flex-basis" => true,
            .flex => true,
            .order => true,
            .@"align-content" => true,
            .@"justify-content" => true,
            .@"place-content" => false,
            .@"align-self" => true,
            .@"justify-self" => false,
            .@"place-self" => false,
            .@"align-items" => true,
            .@"justify-items" => false,
            .@"place-items" => false,
            .@"row-gap" => false,
            .@"column-gap" => false,
            .gap => false,
            .@"box-orient" => true,
            .@"box-direction" => true,
            .@"box-ordinal-group" => true,
            .@"box-align" => true,
            .@"box-flex" => true,
            .@"box-flex-group" => true,
            .@"box-pack" => true,
            .@"box-lines" => true,
            .@"flex-pack" => true,
            .@"flex-order" => true,
            .@"flex-align" => true,
            .@"flex-item-align" => true,
            .@"flex-line-pack" => true,
            .@"flex-positive" => true,
            .@"flex-negative" => true,
            .@"flex-preferred-size" => true,
            .@"margin-top" => false,
            .@"margin-bottom" => false,
            .@"margin-left" => false,
            .@"margin-right" => false,
            .@"margin-block-start" => false,
            .@"margin-block-end" => false,
            .@"margin-inline-start" => false,
            .@"margin-inline-end" => false,
            .@"margin-block" => false,
            .@"margin-inline" => false,
            .margin => false,
            .@"padding-top" => false,
            .@"padding-bottom" => false,
            .@"padding-left" => false,
            .@"padding-right" => false,
            .@"padding-block-start" => false,
            .@"padding-block-end" => false,
            .@"padding-inline-start" => false,
            .@"padding-inline-end" => false,
            .@"padding-block" => false,
            .@"padding-inline" => false,
            .padding => false,
            .@"scroll-margin-top" => false,
            .@"scroll-margin-bottom" => false,
            .@"scroll-margin-left" => false,
            .@"scroll-margin-right" => false,
            .@"scroll-margin-block-start" => false,
            .@"scroll-margin-block-end" => false,
            .@"scroll-margin-inline-start" => false,
            .@"scroll-margin-inline-end" => false,
            .@"scroll-margin-block" => false,
            .@"scroll-margin-inline" => false,
            .@"scroll-margin" => false,
            .@"scroll-padding-top" => false,
            .@"scroll-padding-bottom" => false,
            .@"scroll-padding-left" => false,
            .@"scroll-padding-right" => false,
            .@"scroll-padding-block-start" => false,
            .@"scroll-padding-block-end" => false,
            .@"scroll-padding-inline-start" => false,
            .@"scroll-padding-inline-end" => false,
            .@"scroll-padding-block" => false,
            .@"scroll-padding-inline" => false,
            .@"scroll-padding" => false,
            .@"font-weight" => false,
            .@"font-size" => false,
            .@"font-stretch" => false,
            .@"font-family" => false,
            .@"font-style" => false,
            .@"font-variant-caps" => false,
            .@"line-height" => false,
            .font => false,
            .@"text-decoration-color" => true,
            .@"text-emphasis-color" => true,
            .@"text-shadow" => false,
            .direction => false,
            .composes => false,
            .@"mask-image" => true,
            .@"mask-mode" => false,
            .@"mask-repeat" => true,
            .@"mask-position-x" => false,
            .@"mask-position-y" => false,
            .@"mask-position" => true,
            .@"mask-clip" => true,
            .@"mask-origin" => true,
            .@"mask-size" => true,
            .@"mask-composite" => false,
            .@"mask-type" => false,
            .mask => true,
            .@"mask-border-source" => false,
            .@"mask-border-mode" => false,
            .@"mask-border-slice" => false,
            .@"mask-border-width" => false,
            .@"mask-border-outset" => false,
            .@"mask-border-repeat" => false,
            .@"mask-border" => false,
            .@"-webkit-mask-composite" => false,
            .@"mask-source-type" => true,
            .@"mask-box-image" => true,
            .@"mask-box-image-source" => true,
            .@"mask-box-image-slice" => true,
            .@"mask-box-image-width" => true,
            .@"mask-box-image-outset" => true,
            .@"mask-box-image-repeat" => true,
            .unparsed => false,
            .custom => false,
            .all => false,
        };
    }

    /// Helper function used in comptime code to know whether to access the underlying value
    /// with tuple indexing syntax because it may have a VendorPrefix associated with it.
    pub fn valueType(this: PropertyIdTag) type {
        return switch (this) {
            .@"background-color" => CssColor,
            .@"background-image" => SmallList(Image, 1),
            .@"background-position-x" => SmallList(css_values.position.HorizontalPosition, 1),
            .@"background-position-y" => SmallList(css_values.position.VerticalPosition, 1),
            .@"background-position" => SmallList(background.BackgroundPosition, 1),
            .@"background-size" => SmallList(background.BackgroundSize, 1),
            .@"background-repeat" => SmallList(background.BackgroundRepeat, 1),
            .@"background-attachment" => SmallList(background.BackgroundAttachment, 1),
            .@"background-clip" => SmallList(background.BackgroundClip, 1),
            .@"background-origin" => SmallList(background.BackgroundOrigin, 1),
            .background => SmallList(background.Background, 1),
            .@"box-shadow" => SmallList(box_shadow.BoxShadow, 1),
            .opacity => css.css_values.alpha.AlphaValue,
            .color => CssColor,
            .display => display.Display,
            .visibility => display.Visibility,
            .width => size.Size,
            .height => size.Size,
            .@"min-width" => size.Size,
            .@"min-height" => size.Size,
            .@"max-width" => size.MaxSize,
            .@"max-height" => size.MaxSize,
            .@"block-size" => size.Size,
            .@"inline-size" => size.Size,
            .@"min-block-size" => size.Size,
            .@"min-inline-size" => size.Size,
            .@"max-block-size" => size.MaxSize,
            .@"max-inline-size" => size.MaxSize,
            .@"box-sizing" => size.BoxSizing,
            .@"aspect-ratio" => size.AspectRatio,
            .overflow => overflow.Overflow,
            .@"overflow-x" => overflow.OverflowKeyword,
            .@"overflow-y" => overflow.OverflowKeyword,
            .@"text-overflow" => overflow.TextOverflow,
            .position => position.Position,
            .top => LengthPercentageOrAuto,
            .bottom => LengthPercentageOrAuto,
            .left => LengthPercentageOrAuto,
            .right => LengthPercentageOrAuto,
            .@"inset-block-start" => LengthPercentageOrAuto,
            .@"inset-block-end" => LengthPercentageOrAuto,
            .@"inset-inline-start" => LengthPercentageOrAuto,
            .@"inset-inline-end" => LengthPercentageOrAuto,
            .@"inset-block" => margin_padding.InsetBlock,
            .@"inset-inline" => margin_padding.InsetInline,
            .inset => margin_padding.Inset,
            .@"border-spacing" => css.css_values.size.Size2D(Length),
            .@"border-top-color" => CssColor,
            .@"border-bottom-color" => CssColor,
            .@"border-left-color" => CssColor,
            .@"border-right-color" => CssColor,
            .@"border-block-start-color" => CssColor,
            .@"border-block-end-color" => CssColor,
            .@"border-inline-start-color" => CssColor,
            .@"border-inline-end-color" => CssColor,
            .@"border-top-style" => border.LineStyle,
            .@"border-bottom-style" => border.LineStyle,
            .@"border-left-style" => border.LineStyle,
            .@"border-right-style" => border.LineStyle,
            .@"border-block-start-style" => border.LineStyle,
            .@"border-block-end-style" => border.LineStyle,
            .@"border-inline-start-style" => border.LineStyle,
            .@"border-inline-end-style" => border.LineStyle,
            .@"border-top-width" => BorderSideWidth,
            .@"border-bottom-width" => BorderSideWidth,
            .@"border-left-width" => BorderSideWidth,
            .@"border-right-width" => BorderSideWidth,
            .@"border-block-start-width" => BorderSideWidth,
            .@"border-block-end-width" => BorderSideWidth,
            .@"border-inline-start-width" => BorderSideWidth,
            .@"border-inline-end-width" => BorderSideWidth,
            .@"border-top-left-radius" => Size2D(LengthPercentage),
            .@"border-top-right-radius" => Size2D(LengthPercentage),
            .@"border-bottom-left-radius" => Size2D(LengthPercentage),
            .@"border-bottom-right-radius" => Size2D(LengthPercentage),
            .@"border-start-start-radius" => Size2D(LengthPercentage),
            .@"border-start-end-radius" => Size2D(LengthPercentage),
            .@"border-end-start-radius" => Size2D(LengthPercentage),
            .@"border-end-end-radius" => Size2D(LengthPercentage),
            .@"border-radius" => BorderRadius,
            .@"border-image-source" => Image,
            .@"border-image-outset" => Rect(LengthOrNumber),
            .@"border-image-repeat" => BorderImageRepeat,
            .@"border-image-width" => Rect(BorderImageSideWidth),
            .@"border-image-slice" => BorderImageSlice,
            .@"border-image" => BorderImage,
            .@"border-color" => BorderColor,
            .@"border-style" => BorderStyle,
            .@"border-width" => BorderWidth,
            .@"border-block-color" => BorderBlockColor,
            .@"border-block-style" => BorderBlockStyle,
            .@"border-block-width" => BorderBlockWidth,
            .@"border-inline-color" => BorderInlineColor,
            .@"border-inline-style" => BorderInlineStyle,
            .@"border-inline-width" => BorderInlineWidth,
            .border => Border,
            .@"border-top" => BorderTop,
            .@"border-bottom" => BorderBottom,
            .@"border-left" => BorderLeft,
            .@"border-right" => BorderRight,
            .@"border-block" => BorderBlock,
            .@"border-block-start" => BorderBlockStart,
            .@"border-block-end" => BorderBlockEnd,
            .@"border-inline" => BorderInline,
            .@"border-inline-start" => BorderInlineStart,
            .@"border-inline-end" => BorderInlineEnd,
            .outline => Outline,
            .@"outline-color" => CssColor,
            .@"outline-style" => OutlineStyle,
            .@"outline-width" => BorderSideWidth,
            .@"flex-direction" => FlexDirection,
            .@"flex-wrap" => FlexWrap,
            .@"flex-flow" => FlexFlow,
            .@"flex-grow" => CSSNumber,
            .@"flex-shrink" => CSSNumber,
            .@"flex-basis" => LengthPercentageOrAuto,
            .flex => Flex,
            .order => CSSInteger,
            .@"align-content" => AlignContent,
            .@"justify-content" => JustifyContent,
            .@"place-content" => PlaceContent,
            .@"align-self" => AlignSelf,
            .@"justify-self" => JustifySelf,
            .@"place-self" => PlaceSelf,
            .@"align-items" => AlignItems,
            .@"justify-items" => JustifyItems,
            .@"place-items" => PlaceItems,
            .@"row-gap" => GapValue,
            .@"column-gap" => GapValue,
            .gap => Gap,
            .@"box-orient" => BoxOrient,
            .@"box-direction" => BoxDirection,
            .@"box-ordinal-group" => CSSInteger,
            .@"box-align" => BoxAlign,
            .@"box-flex" => CSSNumber,
            .@"box-flex-group" => CSSInteger,
            .@"box-pack" => BoxPack,
            .@"box-lines" => BoxLines,
            .@"flex-pack" => FlexPack,
            .@"flex-order" => CSSInteger,
            .@"flex-align" => BoxAlign,
            .@"flex-item-align" => FlexItemAlign,
            .@"flex-line-pack" => FlexLinePack,
            .@"flex-positive" => CSSNumber,
            .@"flex-negative" => CSSNumber,
            .@"flex-preferred-size" => LengthPercentageOrAuto,
            .@"margin-top" => LengthPercentageOrAuto,
            .@"margin-bottom" => LengthPercentageOrAuto,
            .@"margin-left" => LengthPercentageOrAuto,
            .@"margin-right" => LengthPercentageOrAuto,
            .@"margin-block-start" => LengthPercentageOrAuto,
            .@"margin-block-end" => LengthPercentageOrAuto,
            .@"margin-inline-start" => LengthPercentageOrAuto,
            .@"margin-inline-end" => LengthPercentageOrAuto,
            .@"margin-block" => MarginBlock,
            .@"margin-inline" => MarginInline,
            .margin => Margin,
            .@"padding-top" => LengthPercentageOrAuto,
            .@"padding-bottom" => LengthPercentageOrAuto,
            .@"padding-left" => LengthPercentageOrAuto,
            .@"padding-right" => LengthPercentageOrAuto,
            .@"padding-block-start" => LengthPercentageOrAuto,
            .@"padding-block-end" => LengthPercentageOrAuto,
            .@"padding-inline-start" => LengthPercentageOrAuto,
            .@"padding-inline-end" => LengthPercentageOrAuto,
            .@"padding-block" => PaddingBlock,
            .@"padding-inline" => PaddingInline,
            .padding => Padding,
            .@"scroll-margin-top" => LengthPercentageOrAuto,
            .@"scroll-margin-bottom" => LengthPercentageOrAuto,
            .@"scroll-margin-left" => LengthPercentageOrAuto,
            .@"scroll-margin-right" => LengthPercentageOrAuto,
            .@"scroll-margin-block-start" => LengthPercentageOrAuto,
            .@"scroll-margin-block-end" => LengthPercentageOrAuto,
            .@"scroll-margin-inline-start" => LengthPercentageOrAuto,
            .@"scroll-margin-inline-end" => LengthPercentageOrAuto,
            .@"scroll-margin-block" => ScrollMarginBlock,
            .@"scroll-margin-inline" => ScrollMarginInline,
            .@"scroll-margin" => ScrollMargin,
            .@"scroll-padding-top" => LengthPercentageOrAuto,
            .@"scroll-padding-bottom" => LengthPercentageOrAuto,
            .@"scroll-padding-left" => LengthPercentageOrAuto,
            .@"scroll-padding-right" => LengthPercentageOrAuto,
            .@"scroll-padding-block-start" => LengthPercentageOrAuto,
            .@"scroll-padding-block-end" => LengthPercentageOrAuto,
            .@"scroll-padding-inline-start" => LengthPercentageOrAuto,
            .@"scroll-padding-inline-end" => LengthPercentageOrAuto,
            .@"scroll-padding-block" => ScrollPaddingBlock,
            .@"scroll-padding-inline" => ScrollPaddingInline,
            .@"scroll-padding" => ScrollPadding,
            .@"font-weight" => FontWeight,
            .@"font-size" => FontSize,
            .@"font-stretch" => FontStretch,
            .@"font-family" => BabyList(FontFamily),
            .@"font-style" => FontStyle,
            .@"font-variant-caps" => FontVariantCaps,
            .@"line-height" => LineHeight,
            .font => Font,
            .@"text-decoration-color" => CssColor,
            .@"text-emphasis-color" => CssColor,
            .@"text-shadow" => SmallList(TextShadow, 1),
            .direction => Direction,
            .composes => Composes,
            .@"mask-image" => SmallList(Image, 1),
            .@"mask-mode" => SmallList(MaskMode, 1),
            .@"mask-repeat" => SmallList(BackgroundRepeat, 1),
            .@"mask-position-x" => SmallList(HorizontalPosition, 1),
            .@"mask-position-y" => SmallList(VerticalPosition, 1),
            .@"mask-position" => SmallList(Position, 1),
            .@"mask-clip" => SmallList(MaskClip, 1),
            .@"mask-origin" => SmallList(GeometryBox, 1),
            .@"mask-size" => SmallList(BackgroundSize, 1),
            .@"mask-composite" => SmallList(MaskComposite, 1),
            .@"mask-type" => MaskType,
            .mask => SmallList(Mask, 1),
            .@"mask-border-source" => Image,
            .@"mask-border-mode" => MaskBorderMode,
            .@"mask-border-slice" => BorderImageSlice,
            .@"mask-border-width" => Rect(BorderImageSideWidth),
            .@"mask-border-outset" => Rect(LengthOrNumber),
            .@"mask-border-repeat" => BorderImageRepeat,
            .@"mask-border" => MaskBorder,
            .@"-webkit-mask-composite" => SmallList(WebKitMaskComposite, 1),
            .@"mask-source-type" => SmallList(WebKitMaskSourceType, 1),
            .@"mask-box-image" => BorderImage,
            .@"mask-box-image-source" => Image,
            .@"mask-box-image-slice" => BorderImageSlice,
            .@"mask-box-image-width" => Rect(BorderImageSideWidth),
            .@"mask-box-image-outset" => Rect(LengthOrNumber),
            .@"mask-box-image-repeat" => BorderImageRepeat,
            .all => CSSWideKeyword,
            .unparsed => UnparsedProperty,
            .custom => CustomProperty,
        };
    }
};
