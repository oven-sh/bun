const std = @import("std");
const bun = @import("root").bun;
const Allocator = std.mem.Allocator;

pub const css = @import("../css_parser.zig");

const Printer = css.Printer;
const PrintErr = css.PrintErr;
const VendorPrefix = css.VendorPrefix;

const PropertyIdImpl = @import("./properties_impl.zig").PropertyIdImpl;

const CSSWideKeyword = css.css_properties.CSSWideKeyword;
const UnparsedProperty = css.css_properties.custom.UnparsedProperty;
const CustomProperty = css.css_properties.custom.CustomProperty;

const css_values = css.css_values;
const CssColor = css.css_values.color.CssColor;
const Image = css.css_values.image.Image;
const Length = css.css_values.length.LengthValue;
const LengthPercentage = css_values.length.LengthPercentage;
const LengthPercentageOrAuto = css_values.length.LengthPercentageOrAuto;
const PropertyCategory = css.PropertyCategory;
const LogicalGroup = css.LogicalGroup;
const CSSNumber = css.css_values.number.CSSNumber;
const CSSInteger = css.css_values.number.CSSInteger;
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

const BorderSideWidth = border.BorderSideWith;
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
const VerticalAlign = font.VerticalAlign;
const Transition = transition.Transition;
const AnimationNameList = animation.AnimationNameList;
const AnimationList = animation.AnimationList;
const AnimationIterationCount = animation.AnimationIterationCount;
const AnimationDirection = animation.AnimationDirection;
const AnimationPlayState = animation.AnimationPlayState;
const AnimationFillMode = animation.AnimationFillMode;
const AnimationComposition = animation.AnimationComposition;
const AnimationTimeline = animation.AnimationTimeline;
const AnimationRangeStart = animation.AnimationRangeStart;
const AnimationRangeEnd = animation.AnimationRangeEnd;
const AnimationRange = animation.AnimationRange;
const TransformList = transform.TransformList;
const TransformStyle = transform.TransformStyle;
const TransformBox = transform.TransformBox;
const BackfaceVisibility = transform.BackfaceVisibility;
const Perspective = transform.Perspective;
const Translate = transform.Translate;
const Rotate = transform.Rotate;
const Scale = transform.Scale;
const TextTransform = text.TextTransform;
const WhiteSpace = text.WhiteSpace;
const WordBreak = text.WordBreak;
const LineBreak = text.LineBreak;
const Hyphens = text.Hyphens;
const OverflowWrap = text.OverflowWrap;
const TextAlign = text.TextAlign;
const TextIndent = text.TextIndent;
const Spacing = text.Spacing;
const TextJustify = text.TextJustify;
const TextAlignLast = text.TextAlignLast;
const TextDecorationLine = text.TextDecorationLine;
const TextDecorationStyle = text.TextDecorationStyle;
const TextDecorationThickness = text.TextDecorationThickness;
const TextDecoration = text.TextDecoration;
const TextDecorationSkipInk = text.TextDecorationSkipInk;
const TextEmphasisStyle = text.TextEmphasisStyle;
const TextEmphasis = text.TextEmphasis;
const TextEmphasisPositionVertical = text.TextEmphasisPositionVertical;
const TextEmphasisPositionHorizontal = text.TextEmphasisPositionHorizontal;
const TextEmphasisPosition = text.TextEmphasisPosition;
const TextShadow = text.TextShadow;
const TextSizeAdjust = text.TextSizeAdjust;
const Direction = text.Direction;
const UnicodeBidi = text.UnicodeBidi;
const BoxDecorationBreak = text.BoxDecorationBreak;
const Resize = ui.Resize;
const Cursor = ui.Cursor;
const ColorOrAuto = ui.ColorOrAuto;
const CaretShape = ui.CaretShape;
const Caret = ui.Caret;
const UserSelect = ui.UserSelect;
const Appearance = ui.Appearance;
const ColorScheme = ui.ColorScheme;
const ListStyleType = list.ListStyleType;
const ListStylePosition = list.ListStylePosition;
const ListStyle = list.ListStyle;
const MarkerSide = list.MarkerSide;
const Composes = css_modules.Composes;
const SVGPaint = svg.SVGPaint;
const FillRule = shape.FillRule;
const AlphaValue = shape.AlphaValue;
const StrokeLinecap = svg.StrokeLinecap;
const StrokeLinejoin = svg.StrokeLinejoin;
const StrokeDasharray = svg.StrokeDasharray;
const Marker = svg.Marker;
const ColorInterpolation = svg.ColorInterpolation;
const ColorRendering = svg.ColorRendering;
const ShapeRendering = svg.ShapeRendering;
const TextRendering = svg.TextRendering;
const ImageRendering = svg.ImageRendering;
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
const FilterList = effects.FilterList;
const ContainerType = contain.ContainerType;
const Container = contain.Container;
const ContainerNameList = contain.ContainerNameList;
const CustomPropertyName = custom.CustomPropertyName;
const display = css.css_properties.display;

const Position = position.Position;

const Result = css.Result;

const ArrayList = std.ArrayListUnmanaged;
const SmallList = css.SmallList;
pub const Property = union(PropertyIdTag) {
    @"background-color": CssColor,
    @"background-image": SmallList(Image, 1),
    @"background-position-x": SmallList(css_values.position.HorizontalPosition, 1),
    @"background-position-y": SmallList(css_values.position.HorizontalPosition, 1),
    @"background-position": SmallList(background.BackgroundPosition, 1),
    @"background-size": SmallList(background.BackgroundSize, 1),
    @"background-repeat": SmallList(background.BackgroundSize, 1),
    @"background-attachment": SmallList(background.BackgroundAttachment, 1),
    @"background-clip": struct { SmallList(background.BackgroundAttachment, 1), VendorPrefix },
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
    @"font-family": ArrayList(FontFamily),
    @"font-style": FontStyle,
    @"font-variant-caps": FontVariantCaps,
    @"line-height": LineHeight,
    font: Font,
    @"vertical-align": VerticalAlign,
    @"font-palette": DashedIdentReference,
    @"transition-property": struct { SmallList(PropertyId, 1), VendorPrefix },
    @"transition-duration": struct { SmallList(Time, 1), VendorPrefix },
    @"transition-delay": struct { SmallList(Time, 1), VendorPrefix },
    @"transition-timing-function": struct { SmallList(EasingFunction, 1), VendorPrefix },
    transition: struct { SmallList(Transition, 1), VendorPrefix },
    @"animation-name": struct { AnimationNameList, VendorPrefix },
    @"animation-duration": struct { SmallList(Time, 1), VendorPrefix },
    @"animation-timing-function": struct { SmallList(EasingFunction, 1), VendorPrefix },
    @"animation-iteration-count": struct { SmallList(AnimationIterationCount, 1), VendorPrefix },
    @"animation-direction": struct { SmallList(AnimationDirection, 1), VendorPrefix },
    @"animation-play-state": struct { SmallList(AnimationPlayState, 1), VendorPrefix },
    @"animation-delay": struct { SmallList(Time, 1), VendorPrefix },
    @"animation-fill-mode": struct { SmallList(AnimationFillMode, 1), VendorPrefix },
    @"animation-composition": SmallList(AnimationComposition, 1),
    @"animation-timeline": SmallList(AnimationTimeline, 1),
    @"animation-range-start": SmallList(AnimationRangeStart, 1),
    @"animation-range-end": SmallList(AnimationRangeEnd, 1),
    @"animation-range": SmallList(AnimationRange, 1),
    animation: struct { AnimationList, VendorPrefix },
    transform: struct { TransformList, VendorPrefix },
    @"transform-origin": struct { Position, VendorPrefix },
    @"transform-style": struct { TransformStyle, VendorPrefix },
    @"transform-box": TransformBox,
    @"backface-visibility": struct { BackfaceVisibility, VendorPrefix },
    perspective: struct { Perspective, VendorPrefix },
    @"perspective-origin": struct { Position, VendorPrefix },
    translate: Translate,
    rotate: Rotate,
    scale: Scale,
    @"text-transform": TextTransform,
    @"white-space": WhiteSpace,
    @"tab-size": struct { LengthOrNumber, VendorPrefix },
    @"word-break": WordBreak,
    @"line-break": LineBreak,
    hyphens: struct { Hyphens, VendorPrefix },
    @"overflow-wrap": OverflowWrap,
    @"word-wrap": OverflowWrap,
    @"text-align": TextAlign,
    @"text-align-last": struct { TextAlignLast, VendorPrefix },
    @"text-justify": TextJustify,
    @"word-spacing": Spacing,
    @"letter-spacing": Spacing,
    @"text-indent": TextIndent,
    @"text-decoration-line": struct { TextDecorationLine, VendorPrefix },
    @"text-decoration-style": struct { TextDecorationStyle, VendorPrefix },
    @"text-decoration-color": struct { CssColor, VendorPrefix },
    @"text-decoration-thickness": TextDecorationThickness,
    @"text-decoration": struct { TextDecoration, VendorPrefix },
    @"text-decoration-skip-ink": struct { TextDecorationSkipInk, VendorPrefix },
    @"text-emphasis-style": struct { TextEmphasisStyle, VendorPrefix },
    @"text-emphasis-color": struct { CssColor, VendorPrefix },
    @"text-emphasis": struct { TextEmphasis, VendorPrefix },
    @"text-emphasis-position": struct { TextEmphasisPosition, VendorPrefix },
    @"text-shadow": SmallList(TextShadow, 1),
    @"text-size-adjust": struct { TextSizeAdjust, VendorPrefix },
    direction: Direction,
    @"unicode-bidi": UnicodeBidi,
    @"box-decoration-break": struct { BoxDecorationBreak, VendorPrefix },
    resize: Resize,
    cursor: Cursor,
    @"caret-color": ColorOrAuto,
    @"caret-shape": CaretShape,
    caret: Caret,
    @"user-select": struct { UserSelect, VendorPrefix },
    @"accent-color": ColorOrAuto,
    appearance: struct { Appearance, VendorPrefix },
    @"list-style-type": ListStyleType,
    @"list-style-image": Image,
    @"list-style-position": ListStylePosition,
    @"list-style": ListStyle,
    @"marker-side": MarkerSide,
    composes: Composes,
    fill: SVGPaint,
    @"fill-rule": FillRule,
    @"fill-opacity": AlphaValue,
    stroke: SVGPaint,
    @"stroke-opacity": AlphaValue,
    @"stroke-width": LengthPercentage,
    @"stroke-linecap": StrokeLinecap,
    @"stroke-linejoin": StrokeLinejoin,
    @"stroke-miterlimit": CSSNumber,
    @"stroke-dasharray": StrokeDasharray,
    @"stroke-dashoffset": LengthPercentage,
    @"marker-start": Marker,
    @"marker-mid": Marker,
    @"marker-end": Marker,
    marker: Marker,
    @"color-interpolation": ColorInterpolation,
    @"color-interpolation-filters": ColorInterpolation,
    @"color-rendering": ColorRendering,
    @"shape-rendering": ShapeRendering,
    @"text-rendering": TextRendering,
    @"image-rendering": ImageRendering,
    @"clip-path": struct { ClipPath, VendorPrefix },
    @"clip-rule": FillRule,
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
    filter: struct { FilterList, VendorPrefix },
    @"backdrop-filter": struct { FilterList, VendorPrefix },
    @"z-index": position.ZIndex,
    @"container-type": ContainerType,
    @"container-name": ContainerNameList,
    container: Container,
    @"view-transition-name": CustomIdent,
    @"color-scheme": ColorScheme,
    all: CSSWideKeyword,
    unparsed: UnparsedProperty,
    custom: CustomProperty,

    /// Parses a CSS property by name.
    pub fn parse(property_id: PropertyId, input: *css.Parser, options: *css.ParserOptions) Result(Property) {
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
                if (css.generic.parseWithOptions(SmallList(css_values.position.HorizontalPosition, 1), input, options).asValue()) |c| {
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
                if (css.generic.parseWithOptions(SmallList(background.BackgroundSize, 1), input, options).asValue()) |c| {
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
                if (css.generic.parseWithOptions(SmallList(background.BackgroundAttachment, 1), input, options).asValue()) |c| {
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
                if (css.generic.parseWithOptions(ArrayList(FontFamily), input, options).asValue()) |c| {
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
            .@"vertical-align" => {
                if (css.generic.parseWithOptions(VerticalAlign, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"vertical-align" = c } };
                    }
                }
            },
            .@"font-palette" => {
                if (css.generic.parseWithOptions(DashedIdentReference, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"font-palette" = c } };
                    }
                }
            },
            .@"transition-property" => |pre| {
                if (css.generic.parseWithOptions(SmallList(PropertyId, 1), input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"transition-property" = .{ c, pre } } };
                    }
                }
            },
            .@"transition-duration" => |pre| {
                if (css.generic.parseWithOptions(SmallList(Time, 1), input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"transition-duration" = .{ c, pre } } };
                    }
                }
            },
            .@"transition-delay" => |pre| {
                if (css.generic.parseWithOptions(SmallList(Time, 1), input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"transition-delay" = .{ c, pre } } };
                    }
                }
            },
            .@"transition-timing-function" => |pre| {
                if (css.generic.parseWithOptions(SmallList(EasingFunction, 1), input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"transition-timing-function" = .{ c, pre } } };
                    }
                }
            },
            .transition => |pre| {
                if (css.generic.parseWithOptions(SmallList(Transition, 1), input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .transition = .{ c, pre } } };
                    }
                }
            },
            .@"animation-name" => |pre| {
                if (css.generic.parseWithOptions(AnimationNameList, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"animation-name" = .{ c, pre } } };
                    }
                }
            },
            .@"animation-duration" => |pre| {
                if (css.generic.parseWithOptions(SmallList(Time, 1), input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"animation-duration" = .{ c, pre } } };
                    }
                }
            },
            .@"animation-timing-function" => |pre| {
                if (css.generic.parseWithOptions(SmallList(EasingFunction, 1), input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"animation-timing-function" = .{ c, pre } } };
                    }
                }
            },
            .@"animation-iteration-count" => |pre| {
                if (css.generic.parseWithOptions(SmallList(AnimationIterationCount, 1), input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"animation-iteration-count" = .{ c, pre } } };
                    }
                }
            },
            .@"animation-direction" => |pre| {
                if (css.generic.parseWithOptions(SmallList(AnimationDirection, 1), input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"animation-direction" = .{ c, pre } } };
                    }
                }
            },
            .@"animation-play-state" => |pre| {
                if (css.generic.parseWithOptions(SmallList(AnimationPlayState, 1), input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"animation-play-state" = .{ c, pre } } };
                    }
                }
            },
            .@"animation-delay" => |pre| {
                if (css.generic.parseWithOptions(SmallList(Time, 1), input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"animation-delay" = .{ c, pre } } };
                    }
                }
            },
            .@"animation-fill-mode" => |pre| {
                if (css.generic.parseWithOptions(SmallList(AnimationFillMode, 1), input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"animation-fill-mode" = .{ c, pre } } };
                    }
                }
            },
            .@"animation-composition" => {
                if (css.generic.parseWithOptions(SmallList(AnimationComposition, 1), input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"animation-composition" = c } };
                    }
                }
            },
            .@"animation-timeline" => {
                if (css.generic.parseWithOptions(SmallList(AnimationTimeline, 1), input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"animation-timeline" = c } };
                    }
                }
            },
            .@"animation-range-start" => {
                if (css.generic.parseWithOptions(SmallList(AnimationRangeStart, 1), input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"animation-range-start" = c } };
                    }
                }
            },
            .@"animation-range-end" => {
                if (css.generic.parseWithOptions(SmallList(AnimationRangeEnd, 1), input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"animation-range-end" = c } };
                    }
                }
            },
            .@"animation-range" => {
                if (css.generic.parseWithOptions(SmallList(AnimationRange, 1), input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"animation-range" = c } };
                    }
                }
            },
            .animation => |pre| {
                if (css.generic.parseWithOptions(AnimationList, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .animation = .{ c, pre } } };
                    }
                }
            },
            .transform => |pre| {
                if (css.generic.parseWithOptions(TransformList, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .transform = .{ c, pre } } };
                    }
                }
            },
            .@"transform-origin" => |pre| {
                if (css.generic.parseWithOptions(Position, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"transform-origin" = .{ c, pre } } };
                    }
                }
            },
            .@"transform-style" => |pre| {
                if (css.generic.parseWithOptions(TransformStyle, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"transform-style" = .{ c, pre } } };
                    }
                }
            },
            .@"transform-box" => {
                if (css.generic.parseWithOptions(TransformBox, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"transform-box" = c } };
                    }
                }
            },
            .@"backface-visibility" => |pre| {
                if (css.generic.parseWithOptions(BackfaceVisibility, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"backface-visibility" = .{ c, pre } } };
                    }
                }
            },
            .perspective => |pre| {
                if (css.generic.parseWithOptions(Perspective, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .perspective = .{ c, pre } } };
                    }
                }
            },
            .@"perspective-origin" => |pre| {
                if (css.generic.parseWithOptions(Position, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"perspective-origin" = .{ c, pre } } };
                    }
                }
            },
            .translate => {
                if (css.generic.parseWithOptions(Translate, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .translate = c } };
                    }
                }
            },
            .rotate => {
                if (css.generic.parseWithOptions(Rotate, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .rotate = c } };
                    }
                }
            },
            .scale => {
                if (css.generic.parseWithOptions(Scale, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .scale = c } };
                    }
                }
            },
            .@"text-transform" => {
                if (css.generic.parseWithOptions(TextTransform, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"text-transform" = c } };
                    }
                }
            },
            .@"white-space" => {
                if (css.generic.parseWithOptions(WhiteSpace, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"white-space" = c } };
                    }
                }
            },
            .@"tab-size" => |pre| {
                if (css.generic.parseWithOptions(LengthOrNumber, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"tab-size" = .{ c, pre } } };
                    }
                }
            },
            .@"word-break" => {
                if (css.generic.parseWithOptions(WordBreak, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"word-break" = c } };
                    }
                }
            },
            .@"line-break" => {
                if (css.generic.parseWithOptions(LineBreak, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"line-break" = c } };
                    }
                }
            },
            .hyphens => |pre| {
                if (css.generic.parseWithOptions(Hyphens, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .hyphens = .{ c, pre } } };
                    }
                }
            },
            .@"overflow-wrap" => {
                if (css.generic.parseWithOptions(OverflowWrap, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"overflow-wrap" = c } };
                    }
                }
            },
            .@"word-wrap" => {
                if (css.generic.parseWithOptions(OverflowWrap, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"word-wrap" = c } };
                    }
                }
            },
            .@"text-align" => {
                if (css.generic.parseWithOptions(TextAlign, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"text-align" = c } };
                    }
                }
            },
            .@"text-align-last" => |pre| {
                if (css.generic.parseWithOptions(TextAlignLast, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"text-align-last" = .{ c, pre } } };
                    }
                }
            },
            .@"text-justify" => {
                if (css.generic.parseWithOptions(TextJustify, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"text-justify" = c } };
                    }
                }
            },
            .@"word-spacing" => {
                if (css.generic.parseWithOptions(Spacing, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"word-spacing" = c } };
                    }
                }
            },
            .@"letter-spacing" => {
                if (css.generic.parseWithOptions(Spacing, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"letter-spacing" = c } };
                    }
                }
            },
            .@"text-indent" => {
                if (css.generic.parseWithOptions(TextIndent, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"text-indent" = c } };
                    }
                }
            },
            .@"text-decoration-line" => |pre| {
                if (css.generic.parseWithOptions(TextDecorationLine, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"text-decoration-line" = .{ c, pre } } };
                    }
                }
            },
            .@"text-decoration-style" => |pre| {
                if (css.generic.parseWithOptions(TextDecorationStyle, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"text-decoration-style" = .{ c, pre } } };
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
            .@"text-decoration-thickness" => {
                if (css.generic.parseWithOptions(TextDecorationThickness, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"text-decoration-thickness" = c } };
                    }
                }
            },
            .@"text-decoration" => |pre| {
                if (css.generic.parseWithOptions(TextDecoration, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"text-decoration" = .{ c, pre } } };
                    }
                }
            },
            .@"text-decoration-skip-ink" => |pre| {
                if (css.generic.parseWithOptions(TextDecorationSkipInk, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"text-decoration-skip-ink" = .{ c, pre } } };
                    }
                }
            },
            .@"text-emphasis-style" => |pre| {
                if (css.generic.parseWithOptions(TextEmphasisStyle, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"text-emphasis-style" = .{ c, pre } } };
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
            .@"text-emphasis" => |pre| {
                if (css.generic.parseWithOptions(TextEmphasis, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"text-emphasis" = .{ c, pre } } };
                    }
                }
            },
            .@"text-emphasis-position" => |pre| {
                if (css.generic.parseWithOptions(TextEmphasisPosition, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"text-emphasis-position" = .{ c, pre } } };
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
            .@"text-size-adjust" => |pre| {
                if (css.generic.parseWithOptions(TextSizeAdjust, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"text-size-adjust" = .{ c, pre } } };
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
            .@"unicode-bidi" => {
                if (css.generic.parseWithOptions(UnicodeBidi, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"unicode-bidi" = c } };
                    }
                }
            },
            .@"box-decoration-break" => |pre| {
                if (css.generic.parseWithOptions(BoxDecorationBreak, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"box-decoration-break" = .{ c, pre } } };
                    }
                }
            },
            .resize => {
                if (css.generic.parseWithOptions(Resize, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .resize = c } };
                    }
                }
            },
            .cursor => {
                if (css.generic.parseWithOptions(Cursor, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .cursor = c } };
                    }
                }
            },
            .@"caret-color" => {
                if (css.generic.parseWithOptions(ColorOrAuto, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"caret-color" = c } };
                    }
                }
            },
            .@"caret-shape" => {
                if (css.generic.parseWithOptions(CaretShape, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"caret-shape" = c } };
                    }
                }
            },
            .caret => {
                if (css.generic.parseWithOptions(Caret, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .caret = c } };
                    }
                }
            },
            .@"user-select" => |pre| {
                if (css.generic.parseWithOptions(UserSelect, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"user-select" = .{ c, pre } } };
                    }
                }
            },
            .@"accent-color" => {
                if (css.generic.parseWithOptions(ColorOrAuto, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"accent-color" = c } };
                    }
                }
            },
            .appearance => |pre| {
                if (css.generic.parseWithOptions(Appearance, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .appearance = .{ c, pre } } };
                    }
                }
            },
            .@"list-style-type" => {
                if (css.generic.parseWithOptions(ListStyleType, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"list-style-type" = c } };
                    }
                }
            },
            .@"list-style-image" => {
                if (css.generic.parseWithOptions(Image, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"list-style-image" = c } };
                    }
                }
            },
            .@"list-style-position" => {
                if (css.generic.parseWithOptions(ListStylePosition, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"list-style-position" = c } };
                    }
                }
            },
            .@"list-style" => {
                if (css.generic.parseWithOptions(ListStyle, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"list-style" = c } };
                    }
                }
            },
            .@"marker-side" => {
                if (css.generic.parseWithOptions(MarkerSide, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"marker-side" = c } };
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
            .fill => {
                if (css.generic.parseWithOptions(SVGPaint, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .fill = c } };
                    }
                }
            },
            .@"fill-rule" => {
                if (css.generic.parseWithOptions(FillRule, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"fill-rule" = c } };
                    }
                }
            },
            .@"fill-opacity" => {
                if (css.generic.parseWithOptions(AlphaValue, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"fill-opacity" = c } };
                    }
                }
            },
            .stroke => {
                if (css.generic.parseWithOptions(SVGPaint, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .stroke = c } };
                    }
                }
            },
            .@"stroke-opacity" => {
                if (css.generic.parseWithOptions(AlphaValue, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"stroke-opacity" = c } };
                    }
                }
            },
            .@"stroke-width" => {
                if (css.generic.parseWithOptions(LengthPercentage, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"stroke-width" = c } };
                    }
                }
            },
            .@"stroke-linecap" => {
                if (css.generic.parseWithOptions(StrokeLinecap, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"stroke-linecap" = c } };
                    }
                }
            },
            .@"stroke-linejoin" => {
                if (css.generic.parseWithOptions(StrokeLinejoin, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"stroke-linejoin" = c } };
                    }
                }
            },
            .@"stroke-miterlimit" => {
                if (css.generic.parseWithOptions(CSSNumber, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"stroke-miterlimit" = c } };
                    }
                }
            },
            .@"stroke-dasharray" => {
                if (css.generic.parseWithOptions(StrokeDasharray, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"stroke-dasharray" = c } };
                    }
                }
            },
            .@"stroke-dashoffset" => {
                if (css.generic.parseWithOptions(LengthPercentage, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"stroke-dashoffset" = c } };
                    }
                }
            },
            .@"marker-start" => {
                if (css.generic.parseWithOptions(Marker, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"marker-start" = c } };
                    }
                }
            },
            .@"marker-mid" => {
                if (css.generic.parseWithOptions(Marker, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"marker-mid" = c } };
                    }
                }
            },
            .@"marker-end" => {
                if (css.generic.parseWithOptions(Marker, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"marker-end" = c } };
                    }
                }
            },
            .marker => {
                if (css.generic.parseWithOptions(Marker, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .marker = c } };
                    }
                }
            },
            .@"color-interpolation" => {
                if (css.generic.parseWithOptions(ColorInterpolation, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"color-interpolation" = c } };
                    }
                }
            },
            .@"color-interpolation-filters" => {
                if (css.generic.parseWithOptions(ColorInterpolation, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"color-interpolation-filters" = c } };
                    }
                }
            },
            .@"color-rendering" => {
                if (css.generic.parseWithOptions(ColorRendering, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"color-rendering" = c } };
                    }
                }
            },
            .@"shape-rendering" => {
                if (css.generic.parseWithOptions(ShapeRendering, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"shape-rendering" = c } };
                    }
                }
            },
            .@"text-rendering" => {
                if (css.generic.parseWithOptions(TextRendering, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"text-rendering" = c } };
                    }
                }
            },
            .@"image-rendering" => {
                if (css.generic.parseWithOptions(ImageRendering, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"image-rendering" = c } };
                    }
                }
            },
            .@"clip-path" => |pre| {
                if (css.generic.parseWithOptions(ClipPath, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"clip-path" = .{ c, pre } } };
                    }
                }
            },
            .@"clip-rule" => {
                if (css.generic.parseWithOptions(FillRule, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"clip-rule" = c } };
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
            .filter => |pre| {
                if (css.generic.parseWithOptions(FilterList, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .filter = .{ c, pre } } };
                    }
                }
            },
            .@"backdrop-filter" => |pre| {
                if (css.generic.parseWithOptions(FilterList, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"backdrop-filter" = .{ c, pre } } };
                    }
                }
            },
            .@"z-index" => {
                if (css.generic.parseWithOptions(position.ZIndex, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"z-index" = c } };
                    }
                }
            },
            .@"container-type" => {
                if (css.generic.parseWithOptions(ContainerType, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"container-type" = c } };
                    }
                }
            },
            .@"container-name" => {
                if (css.generic.parseWithOptions(ContainerNameList, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"container-name" = c } };
                    }
                }
            },
            .container => {
                if (css.generic.parseWithOptions(Container, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .container = c } };
                    }
                }
            },
            .@"view-transition-name" => {
                if (css.generic.parseWithOptions(CustomIdent, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"view-transition-name" = c } };
                    }
                }
            },
            .@"color-scheme" => {
                if (css.generic.parseWithOptions(ColorScheme, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"color-scheme" = c } };
                    }
                }
            },
            .all => return .{ .result = .{ .all = try CSSWideKeyword.parse(input, options) } },
            .custom => |name| return .{ .result = .{ .custom = try CustomProperty.parse(name, input, options) } },
            else => {},
        }

        // If a value was unable to be parsed, treat as an unparsed property.
        // This is different from a custom property, handled below, in that the property name is known
        // and stored as an enum rather than a string. This lets property handlers more easily deal with it.
        // Ideally we'd only do this if var() or env() references were seen, but err on the safe side for now.
        input.reset(&state);
        return .{ .result = .{ .unparsed = try UnparsedProperty.parse(property_id, input, options) } };
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
            .@"background-clip" => |pre| .{ "background-clip", pre },
            .@"background-origin" => .{ "background-origin", VendorPrefix{ .none = true } },
            .background => .{ "background", VendorPrefix{ .none = true } },
            .@"box-shadow" => |pre| .{ "box-shadow", pre },
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
            .@"box-sizing" => |pre| .{ "box-sizing", pre },
            .@"aspect-ratio" => .{ "aspect-ratio", VendorPrefix{ .none = true } },
            .overflow => .{ "overflow", VendorPrefix{ .none = true } },
            .@"overflow-x" => .{ "overflow-x", VendorPrefix{ .none = true } },
            .@"overflow-y" => .{ "overflow-y", VendorPrefix{ .none = true } },
            .@"text-overflow" => |pre| .{ "text-overflow", pre },
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
            .@"border-top-left-radius" => |pre| .{ "border-top-left-radius", pre },
            .@"border-top-right-radius" => |pre| .{ "border-top-right-radius", pre },
            .@"border-bottom-left-radius" => |pre| .{ "border-bottom-left-radius", pre },
            .@"border-bottom-right-radius" => |pre| .{ "border-bottom-right-radius", pre },
            .@"border-start-start-radius" => .{ "border-start-start-radius", VendorPrefix{ .none = true } },
            .@"border-start-end-radius" => .{ "border-start-end-radius", VendorPrefix{ .none = true } },
            .@"border-end-start-radius" => .{ "border-end-start-radius", VendorPrefix{ .none = true } },
            .@"border-end-end-radius" => .{ "border-end-end-radius", VendorPrefix{ .none = true } },
            .@"border-radius" => |pre| .{ "border-radius", pre },
            .@"border-image-source" => .{ "border-image-source", VendorPrefix{ .none = true } },
            .@"border-image-outset" => .{ "border-image-outset", VendorPrefix{ .none = true } },
            .@"border-image-repeat" => .{ "border-image-repeat", VendorPrefix{ .none = true } },
            .@"border-image-width" => .{ "border-image-width", VendorPrefix{ .none = true } },
            .@"border-image-slice" => .{ "border-image-slice", VendorPrefix{ .none = true } },
            .@"border-image" => |pre| .{ "border-image", pre },
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
            .@"flex-direction" => |pre| .{ "flex-direction", pre },
            .@"flex-wrap" => |pre| .{ "flex-wrap", pre },
            .@"flex-flow" => |pre| .{ "flex-flow", pre },
            .@"flex-grow" => |pre| .{ "flex-grow", pre },
            .@"flex-shrink" => |pre| .{ "flex-shrink", pre },
            .@"flex-basis" => |pre| .{ "flex-basis", pre },
            .flex => |pre| .{ "flex", pre },
            .order => |pre| .{ "order", pre },
            .@"align-content" => |pre| .{ "align-content", pre },
            .@"justify-content" => |pre| .{ "justify-content", pre },
            .@"place-content" => .{ "place-content", VendorPrefix{ .none = true } },
            .@"align-self" => |pre| .{ "align-self", pre },
            .@"justify-self" => .{ "justify-self", VendorPrefix{ .none = true } },
            .@"place-self" => .{ "place-self", VendorPrefix{ .none = true } },
            .@"align-items" => |pre| .{ "align-items", pre },
            .@"justify-items" => .{ "justify-items", VendorPrefix{ .none = true } },
            .@"place-items" => .{ "place-items", VendorPrefix{ .none = true } },
            .@"row-gap" => .{ "row-gap", VendorPrefix{ .none = true } },
            .@"column-gap" => .{ "column-gap", VendorPrefix{ .none = true } },
            .gap => .{ "gap", VendorPrefix{ .none = true } },
            .@"box-orient" => |pre| .{ "box-orient", pre },
            .@"box-direction" => |pre| .{ "box-direction", pre },
            .@"box-ordinal-group" => |pre| .{ "box-ordinal-group", pre },
            .@"box-align" => |pre| .{ "box-align", pre },
            .@"box-flex" => |pre| .{ "box-flex", pre },
            .@"box-flex-group" => |pre| .{ "box-flex-group", pre },
            .@"box-pack" => |pre| .{ "box-pack", pre },
            .@"box-lines" => |pre| .{ "box-lines", pre },
            .@"flex-pack" => |pre| .{ "flex-pack", pre },
            .@"flex-order" => |pre| .{ "flex-order", pre },
            .@"flex-align" => |pre| .{ "flex-align", pre },
            .@"flex-item-align" => |pre| .{ "flex-item-align", pre },
            .@"flex-line-pack" => |pre| .{ "flex-line-pack", pre },
            .@"flex-positive" => |pre| .{ "flex-positive", pre },
            .@"flex-negative" => |pre| .{ "flex-negative", pre },
            .@"flex-preferred-size" => |pre| .{ "flex-preferred-size", pre },
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
            .@"vertical-align" => .{ "vertical-align", VendorPrefix{ .none = true } },
            .@"font-palette" => .{ "font-palette", VendorPrefix{ .none = true } },
            .@"transition-property" => |pre| .{ "transition-property", pre },
            .@"transition-duration" => |pre| .{ "transition-duration", pre },
            .@"transition-delay" => |pre| .{ "transition-delay", pre },
            .@"transition-timing-function" => |pre| .{ "transition-timing-function", pre },
            .transition => |pre| .{ "transition", pre },
            .@"animation-name" => |pre| .{ "animation-name", pre },
            .@"animation-duration" => |pre| .{ "animation-duration", pre },
            .@"animation-timing-function" => |pre| .{ "animation-timing-function", pre },
            .@"animation-iteration-count" => |pre| .{ "animation-iteration-count", pre },
            .@"animation-direction" => |pre| .{ "animation-direction", pre },
            .@"animation-play-state" => |pre| .{ "animation-play-state", pre },
            .@"animation-delay" => |pre| .{ "animation-delay", pre },
            .@"animation-fill-mode" => |pre| .{ "animation-fill-mode", pre },
            .@"animation-composition" => .{ "animation-composition", VendorPrefix{ .none = true } },
            .@"animation-timeline" => .{ "animation-timeline", VendorPrefix{ .none = true } },
            .@"animation-range-start" => .{ "animation-range-start", VendorPrefix{ .none = true } },
            .@"animation-range-end" => .{ "animation-range-end", VendorPrefix{ .none = true } },
            .@"animation-range" => .{ "animation-range", VendorPrefix{ .none = true } },
            .animation => |pre| .{ "animation", pre },
            .transform => |pre| .{ "transform", pre },
            .@"transform-origin" => |pre| .{ "transform-origin", pre },
            .@"transform-style" => |pre| .{ "transform-style", pre },
            .@"transform-box" => .{ "transform-box", VendorPrefix{ .none = true } },
            .@"backface-visibility" => |pre| .{ "backface-visibility", pre },
            .perspective => |pre| .{ "perspective", pre },
            .@"perspective-origin" => |pre| .{ "perspective-origin", pre },
            .translate => .{ "translate", VendorPrefix{ .none = true } },
            .rotate => .{ "rotate", VendorPrefix{ .none = true } },
            .scale => .{ "scale", VendorPrefix{ .none = true } },
            .@"text-transform" => .{ "text-transform", VendorPrefix{ .none = true } },
            .@"white-space" => .{ "white-space", VendorPrefix{ .none = true } },
            .@"tab-size" => |pre| .{ "tab-size", pre },
            .@"word-break" => .{ "word-break", VendorPrefix{ .none = true } },
            .@"line-break" => .{ "line-break", VendorPrefix{ .none = true } },
            .hyphens => |pre| .{ "hyphens", pre },
            .@"overflow-wrap" => .{ "overflow-wrap", VendorPrefix{ .none = true } },
            .@"word-wrap" => .{ "word-wrap", VendorPrefix{ .none = true } },
            .@"text-align" => .{ "text-align", VendorPrefix{ .none = true } },
            .@"text-align-last" => |pre| .{ "text-align-last", pre },
            .@"text-justify" => .{ "text-justify", VendorPrefix{ .none = true } },
            .@"word-spacing" => .{ "word-spacing", VendorPrefix{ .none = true } },
            .@"letter-spacing" => .{ "letter-spacing", VendorPrefix{ .none = true } },
            .@"text-indent" => .{ "text-indent", VendorPrefix{ .none = true } },
            .@"text-decoration-line" => |pre| .{ "text-decoration-line", pre },
            .@"text-decoration-style" => |pre| .{ "text-decoration-style", pre },
            .@"text-decoration-color" => |pre| .{ "text-decoration-color", pre },
            .@"text-decoration-thickness" => .{ "text-decoration-thickness", VendorPrefix{ .none = true } },
            .@"text-decoration" => |pre| .{ "text-decoration", pre },
            .@"text-decoration-skip-ink" => |pre| .{ "text-decoration-skip-ink", pre },
            .@"text-emphasis-style" => |pre| .{ "text-emphasis-style", pre },
            .@"text-emphasis-color" => |pre| .{ "text-emphasis-color", pre },
            .@"text-emphasis" => |pre| .{ "text-emphasis", pre },
            .@"text-emphasis-position" => |pre| .{ "text-emphasis-position", pre },
            .@"text-shadow" => .{ "text-shadow", VendorPrefix{ .none = true } },
            .@"text-size-adjust" => |pre| .{ "text-size-adjust", pre },
            .direction => .{ "direction", VendorPrefix{ .none = true } },
            .@"unicode-bidi" => .{ "unicode-bidi", VendorPrefix{ .none = true } },
            .@"box-decoration-break" => |pre| .{ "box-decoration-break", pre },
            .resize => .{ "resize", VendorPrefix{ .none = true } },
            .cursor => .{ "cursor", VendorPrefix{ .none = true } },
            .@"caret-color" => .{ "caret-color", VendorPrefix{ .none = true } },
            .@"caret-shape" => .{ "caret-shape", VendorPrefix{ .none = true } },
            .caret => .{ "caret", VendorPrefix{ .none = true } },
            .@"user-select" => |pre| .{ "user-select", pre },
            .@"accent-color" => .{ "accent-color", VendorPrefix{ .none = true } },
            .appearance => |pre| .{ "appearance", pre },
            .@"list-style-type" => .{ "list-style-type", VendorPrefix{ .none = true } },
            .@"list-style-image" => .{ "list-style-image", VendorPrefix{ .none = true } },
            .@"list-style-position" => .{ "list-style-position", VendorPrefix{ .none = true } },
            .@"list-style" => .{ "list-style", VendorPrefix{ .none = true } },
            .@"marker-side" => .{ "marker-side", VendorPrefix{ .none = true } },
            .composes => .{ "composes", VendorPrefix{ .none = true } },
            .fill => .{ "fill", VendorPrefix{ .none = true } },
            .@"fill-rule" => .{ "fill-rule", VendorPrefix{ .none = true } },
            .@"fill-opacity" => .{ "fill-opacity", VendorPrefix{ .none = true } },
            .stroke => .{ "stroke", VendorPrefix{ .none = true } },
            .@"stroke-opacity" => .{ "stroke-opacity", VendorPrefix{ .none = true } },
            .@"stroke-width" => .{ "stroke-width", VendorPrefix{ .none = true } },
            .@"stroke-linecap" => .{ "stroke-linecap", VendorPrefix{ .none = true } },
            .@"stroke-linejoin" => .{ "stroke-linejoin", VendorPrefix{ .none = true } },
            .@"stroke-miterlimit" => .{ "stroke-miterlimit", VendorPrefix{ .none = true } },
            .@"stroke-dasharray" => .{ "stroke-dasharray", VendorPrefix{ .none = true } },
            .@"stroke-dashoffset" => .{ "stroke-dashoffset", VendorPrefix{ .none = true } },
            .@"marker-start" => .{ "marker-start", VendorPrefix{ .none = true } },
            .@"marker-mid" => .{ "marker-mid", VendorPrefix{ .none = true } },
            .@"marker-end" => .{ "marker-end", VendorPrefix{ .none = true } },
            .marker => .{ "marker", VendorPrefix{ .none = true } },
            .@"color-interpolation" => .{ "color-interpolation", VendorPrefix{ .none = true } },
            .@"color-interpolation-filters" => .{ "color-interpolation-filters", VendorPrefix{ .none = true } },
            .@"color-rendering" => .{ "color-rendering", VendorPrefix{ .none = true } },
            .@"shape-rendering" => .{ "shape-rendering", VendorPrefix{ .none = true } },
            .@"text-rendering" => .{ "text-rendering", VendorPrefix{ .none = true } },
            .@"image-rendering" => .{ "image-rendering", VendorPrefix{ .none = true } },
            .@"clip-path" => |pre| .{ "clip-path", pre },
            .@"clip-rule" => .{ "clip-rule", VendorPrefix{ .none = true } },
            .@"mask-image" => |pre| .{ "mask-image", pre },
            .@"mask-mode" => .{ "mask-mode", VendorPrefix{ .none = true } },
            .@"mask-repeat" => |pre| .{ "mask-repeat", pre },
            .@"mask-position-x" => .{ "mask-position-x", VendorPrefix{ .none = true } },
            .@"mask-position-y" => .{ "mask-position-y", VendorPrefix{ .none = true } },
            .@"mask-position" => |pre| .{ "mask-position", pre },
            .@"mask-clip" => |pre| .{ "mask-clip", pre },
            .@"mask-origin" => |pre| .{ "mask-origin", pre },
            .@"mask-size" => |pre| .{ "mask-size", pre },
            .@"mask-composite" => .{ "mask-composite", VendorPrefix{ .none = true } },
            .@"mask-type" => .{ "mask-type", VendorPrefix{ .none = true } },
            .mask => |pre| .{ "mask", pre },
            .@"mask-border-source" => .{ "mask-border-source", VendorPrefix{ .none = true } },
            .@"mask-border-mode" => .{ "mask-border-mode", VendorPrefix{ .none = true } },
            .@"mask-border-slice" => .{ "mask-border-slice", VendorPrefix{ .none = true } },
            .@"mask-border-width" => .{ "mask-border-width", VendorPrefix{ .none = true } },
            .@"mask-border-outset" => .{ "mask-border-outset", VendorPrefix{ .none = true } },
            .@"mask-border-repeat" => .{ "mask-border-repeat", VendorPrefix{ .none = true } },
            .@"mask-border" => .{ "mask-border", VendorPrefix{ .none = true } },
            .@"-webkit-mask-composite" => .{ "-webkit-mask-composite", VendorPrefix{ .none = true } },
            .@"mask-source-type" => |pre| .{ "mask-source-type", pre },
            .@"mask-box-image" => |pre| .{ "mask-box-image", pre },
            .@"mask-box-image-source" => |pre| .{ "mask-box-image-source", pre },
            .@"mask-box-image-slice" => |pre| .{ "mask-box-image-slice", pre },
            .@"mask-box-image-width" => |pre| .{ "mask-box-image-width", pre },
            .@"mask-box-image-outset" => |pre| .{ "mask-box-image-outset", pre },
            .@"mask-box-image-repeat" => |pre| .{ "mask-box-image-repeat", pre },
            .filter => |pre| .{ "filter", pre },
            .@"backdrop-filter" => |pre| .{ "backdrop-filter", pre },
            .@"z-index" => .{ "z-index", VendorPrefix{ .none = true } },
            .@"container-type" => .{ "container-type", VendorPrefix{ .none = true } },
            .@"container-name" => .{ "container-name", VendorPrefix{ .none = true } },
            .container => .{ "container", VendorPrefix{ .none = true } },
            .@"view-transition-name" => .{ "view-transition-name", VendorPrefix{ .none = true } },
            .@"color-scheme" => .{ "color-scheme", VendorPrefix{ .none = true } },
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
            .@"flex-grow" => |*value| value[0].toCss(W, dest),
            .@"flex-shrink" => |*value| value[0].toCss(W, dest),
            .@"flex-basis" => |*value| value[0].toCss(W, dest),
            .flex => |*value| value[0].toCss(W, dest),
            .order => |*value| value[0].toCss(W, dest),
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
            .@"box-ordinal-group" => |*value| value[0].toCss(W, dest),
            .@"box-align" => |*value| value[0].toCss(W, dest),
            .@"box-flex" => |*value| value[0].toCss(W, dest),
            .@"box-flex-group" => |*value| value[0].toCss(W, dest),
            .@"box-pack" => |*value| value[0].toCss(W, dest),
            .@"box-lines" => |*value| value[0].toCss(W, dest),
            .@"flex-pack" => |*value| value[0].toCss(W, dest),
            .@"flex-order" => |*value| value[0].toCss(W, dest),
            .@"flex-align" => |*value| value[0].toCss(W, dest),
            .@"flex-item-align" => |*value| value[0].toCss(W, dest),
            .@"flex-line-pack" => |*value| value[0].toCss(W, dest),
            .@"flex-positive" => |*value| value[0].toCss(W, dest),
            .@"flex-negative" => |*value| value[0].toCss(W, dest),
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
            .@"vertical-align" => |*value| value.toCss(W, dest),
            .@"font-palette" => |*value| value.toCss(W, dest),
            .@"transition-property" => |*value| value[0].toCss(W, dest),
            .@"transition-duration" => |*value| value[0].toCss(W, dest),
            .@"transition-delay" => |*value| value[0].toCss(W, dest),
            .@"transition-timing-function" => |*value| value[0].toCss(W, dest),
            .transition => |*value| value[0].toCss(W, dest),
            .@"animation-name" => |*value| value[0].toCss(W, dest),
            .@"animation-duration" => |*value| value[0].toCss(W, dest),
            .@"animation-timing-function" => |*value| value[0].toCss(W, dest),
            .@"animation-iteration-count" => |*value| value[0].toCss(W, dest),
            .@"animation-direction" => |*value| value[0].toCss(W, dest),
            .@"animation-play-state" => |*value| value[0].toCss(W, dest),
            .@"animation-delay" => |*value| value[0].toCss(W, dest),
            .@"animation-fill-mode" => |*value| value[0].toCss(W, dest),
            .@"animation-composition" => |*value| value.toCss(W, dest),
            .@"animation-timeline" => |*value| value.toCss(W, dest),
            .@"animation-range-start" => |*value| value.toCss(W, dest),
            .@"animation-range-end" => |*value| value.toCss(W, dest),
            .@"animation-range" => |*value| value.toCss(W, dest),
            .animation => |*value| value[0].toCss(W, dest),
            .transform => |*value| value[0].toCss(W, dest),
            .@"transform-origin" => |*value| value[0].toCss(W, dest),
            .@"transform-style" => |*value| value[0].toCss(W, dest),
            .@"transform-box" => |*value| value.toCss(W, dest),
            .@"backface-visibility" => |*value| value[0].toCss(W, dest),
            .perspective => |*value| value[0].toCss(W, dest),
            .@"perspective-origin" => |*value| value[0].toCss(W, dest),
            .translate => |*value| value.toCss(W, dest),
            .rotate => |*value| value.toCss(W, dest),
            .scale => |*value| value.toCss(W, dest),
            .@"text-transform" => |*value| value.toCss(W, dest),
            .@"white-space" => |*value| value.toCss(W, dest),
            .@"tab-size" => |*value| value[0].toCss(W, dest),
            .@"word-break" => |*value| value.toCss(W, dest),
            .@"line-break" => |*value| value.toCss(W, dest),
            .hyphens => |*value| value[0].toCss(W, dest),
            .@"overflow-wrap" => |*value| value.toCss(W, dest),
            .@"word-wrap" => |*value| value.toCss(W, dest),
            .@"text-align" => |*value| value.toCss(W, dest),
            .@"text-align-last" => |*value| value[0].toCss(W, dest),
            .@"text-justify" => |*value| value.toCss(W, dest),
            .@"word-spacing" => |*value| value.toCss(W, dest),
            .@"letter-spacing" => |*value| value.toCss(W, dest),
            .@"text-indent" => |*value| value.toCss(W, dest),
            .@"text-decoration-line" => |*value| value[0].toCss(W, dest),
            .@"text-decoration-style" => |*value| value[0].toCss(W, dest),
            .@"text-decoration-color" => |*value| value[0].toCss(W, dest),
            .@"text-decoration-thickness" => |*value| value.toCss(W, dest),
            .@"text-decoration" => |*value| value[0].toCss(W, dest),
            .@"text-decoration-skip-ink" => |*value| value[0].toCss(W, dest),
            .@"text-emphasis-style" => |*value| value[0].toCss(W, dest),
            .@"text-emphasis-color" => |*value| value[0].toCss(W, dest),
            .@"text-emphasis" => |*value| value[0].toCss(W, dest),
            .@"text-emphasis-position" => |*value| value[0].toCss(W, dest),
            .@"text-shadow" => |*value| value.toCss(W, dest),
            .@"text-size-adjust" => |*value| value[0].toCss(W, dest),
            .direction => |*value| value.toCss(W, dest),
            .@"unicode-bidi" => |*value| value.toCss(W, dest),
            .@"box-decoration-break" => |*value| value[0].toCss(W, dest),
            .resize => |*value| value.toCss(W, dest),
            .cursor => |*value| value.toCss(W, dest),
            .@"caret-color" => |*value| value.toCss(W, dest),
            .@"caret-shape" => |*value| value.toCss(W, dest),
            .caret => |*value| value.toCss(W, dest),
            .@"user-select" => |*value| value[0].toCss(W, dest),
            .@"accent-color" => |*value| value.toCss(W, dest),
            .appearance => |*value| value[0].toCss(W, dest),
            .@"list-style-type" => |*value| value.toCss(W, dest),
            .@"list-style-image" => |*value| value.toCss(W, dest),
            .@"list-style-position" => |*value| value.toCss(W, dest),
            .@"list-style" => |*value| value.toCss(W, dest),
            .@"marker-side" => |*value| value.toCss(W, dest),
            .composes => |*value| value.toCss(W, dest),
            .fill => |*value| value.toCss(W, dest),
            .@"fill-rule" => |*value| value.toCss(W, dest),
            .@"fill-opacity" => |*value| value.toCss(W, dest),
            .stroke => |*value| value.toCss(W, dest),
            .@"stroke-opacity" => |*value| value.toCss(W, dest),
            .@"stroke-width" => |*value| value.toCss(W, dest),
            .@"stroke-linecap" => |*value| value.toCss(W, dest),
            .@"stroke-linejoin" => |*value| value.toCss(W, dest),
            .@"stroke-miterlimit" => |*value| value.toCss(W, dest),
            .@"stroke-dasharray" => |*value| value.toCss(W, dest),
            .@"stroke-dashoffset" => |*value| value.toCss(W, dest),
            .@"marker-start" => |*value| value.toCss(W, dest),
            .@"marker-mid" => |*value| value.toCss(W, dest),
            .@"marker-end" => |*value| value.toCss(W, dest),
            .marker => |*value| value.toCss(W, dest),
            .@"color-interpolation" => |*value| value.toCss(W, dest),
            .@"color-interpolation-filters" => |*value| value.toCss(W, dest),
            .@"color-rendering" => |*value| value.toCss(W, dest),
            .@"shape-rendering" => |*value| value.toCss(W, dest),
            .@"text-rendering" => |*value| value.toCss(W, dest),
            .@"image-rendering" => |*value| value.toCss(W, dest),
            .@"clip-path" => |*value| value[0].toCss(W, dest),
            .@"clip-rule" => |*value| value.toCss(W, dest),
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
            .filter => |*value| value[0].toCss(W, dest),
            .@"backdrop-filter" => |*value| value[0].toCss(W, dest),
            .@"z-index" => |*value| value.toCss(W, dest),
            .@"container-type" => |*value| value.toCss(W, dest),
            .@"container-name" => |*value| value.toCss(W, dest),
            .container => |*value| value.toCss(W, dest),
            .@"view-transition-name" => |*value| value.toCss(W, dest),
            .@"color-scheme" => |*value| value.toCss(W, dest),
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
            .transition => |*v| {
                if (!v[1].eq(property_id.prefix())) return null;
                return v[0].longhand(property_id);
            },
            .animation => |*v| {
                if (!v[1].eq(property_id.prefix())) return null;
                return v[0].longhand(property_id);
            },
            .@"text-decoration" => |*v| {
                if (!v[1].eq(property_id.prefix())) return null;
                return v[0].longhand(property_id);
            },
            .@"text-emphasis" => |*v| {
                if (!v[1].eq(property_id.prefix())) return null;
                return v[0].longhand(property_id);
            },
            .caret => |*v| return v.longhand(property_id),
            .@"list-style" => |*v| return v.longhand(property_id),
            .mask => |*v| {
                if (!v[1].eq(property_id.prefix())) return null;
                return v[0].longhand(property_id);
            },
            .@"mask-border" => |*v| return v.longhand(property_id),
            .container => |*v| return v.longhand(property_id),
            else => {},
        }
        return null;
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
    @"vertical-align",
    @"font-palette",
    @"transition-property": VendorPrefix,
    @"transition-duration": VendorPrefix,
    @"transition-delay": VendorPrefix,
    @"transition-timing-function": VendorPrefix,
    transition: VendorPrefix,
    @"animation-name": VendorPrefix,
    @"animation-duration": VendorPrefix,
    @"animation-timing-function": VendorPrefix,
    @"animation-iteration-count": VendorPrefix,
    @"animation-direction": VendorPrefix,
    @"animation-play-state": VendorPrefix,
    @"animation-delay": VendorPrefix,
    @"animation-fill-mode": VendorPrefix,
    @"animation-composition",
    @"animation-timeline",
    @"animation-range-start",
    @"animation-range-end",
    @"animation-range",
    animation: VendorPrefix,
    transform: VendorPrefix,
    @"transform-origin": VendorPrefix,
    @"transform-style": VendorPrefix,
    @"transform-box",
    @"backface-visibility": VendorPrefix,
    perspective: VendorPrefix,
    @"perspective-origin": VendorPrefix,
    translate,
    rotate,
    scale,
    @"text-transform",
    @"white-space",
    @"tab-size": VendorPrefix,
    @"word-break",
    @"line-break",
    hyphens: VendorPrefix,
    @"overflow-wrap",
    @"word-wrap",
    @"text-align",
    @"text-align-last": VendorPrefix,
    @"text-justify",
    @"word-spacing",
    @"letter-spacing",
    @"text-indent",
    @"text-decoration-line": VendorPrefix,
    @"text-decoration-style": VendorPrefix,
    @"text-decoration-color": VendorPrefix,
    @"text-decoration-thickness",
    @"text-decoration": VendorPrefix,
    @"text-decoration-skip-ink": VendorPrefix,
    @"text-emphasis-style": VendorPrefix,
    @"text-emphasis-color": VendorPrefix,
    @"text-emphasis": VendorPrefix,
    @"text-emphasis-position": VendorPrefix,
    @"text-shadow",
    @"text-size-adjust": VendorPrefix,
    direction,
    @"unicode-bidi",
    @"box-decoration-break": VendorPrefix,
    resize,
    cursor,
    @"caret-color",
    @"caret-shape",
    caret,
    @"user-select": VendorPrefix,
    @"accent-color",
    appearance: VendorPrefix,
    @"list-style-type",
    @"list-style-image",
    @"list-style-position",
    @"list-style",
    @"marker-side",
    composes,
    fill,
    @"fill-rule",
    @"fill-opacity",
    stroke,
    @"stroke-opacity",
    @"stroke-width",
    @"stroke-linecap",
    @"stroke-linejoin",
    @"stroke-miterlimit",
    @"stroke-dasharray",
    @"stroke-dashoffset",
    @"marker-start",
    @"marker-mid",
    @"marker-end",
    marker,
    @"color-interpolation",
    @"color-interpolation-filters",
    @"color-rendering",
    @"shape-rendering",
    @"text-rendering",
    @"image-rendering",
    @"clip-path": VendorPrefix,
    @"clip-rule",
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
    filter: VendorPrefix,
    @"backdrop-filter": VendorPrefix,
    @"z-index",
    @"container-type",
    @"container-name",
    container,
    @"view-transition-name",
    @"color-scheme",
    all,
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
            .@"vertical-align" => VendorPrefix.empty(),
            .@"font-palette" => VendorPrefix.empty(),
            .@"transition-property" => |p| p,
            .@"transition-duration" => |p| p,
            .@"transition-delay" => |p| p,
            .@"transition-timing-function" => |p| p,
            .transition => |p| p,
            .@"animation-name" => |p| p,
            .@"animation-duration" => |p| p,
            .@"animation-timing-function" => |p| p,
            .@"animation-iteration-count" => |p| p,
            .@"animation-direction" => |p| p,
            .@"animation-play-state" => |p| p,
            .@"animation-delay" => |p| p,
            .@"animation-fill-mode" => |p| p,
            .@"animation-composition" => VendorPrefix.empty(),
            .@"animation-timeline" => VendorPrefix.empty(),
            .@"animation-range-start" => VendorPrefix.empty(),
            .@"animation-range-end" => VendorPrefix.empty(),
            .@"animation-range" => VendorPrefix.empty(),
            .animation => |p| p,
            .transform => |p| p,
            .@"transform-origin" => |p| p,
            .@"transform-style" => |p| p,
            .@"transform-box" => VendorPrefix.empty(),
            .@"backface-visibility" => |p| p,
            .perspective => |p| p,
            .@"perspective-origin" => |p| p,
            .translate => VendorPrefix.empty(),
            .rotate => VendorPrefix.empty(),
            .scale => VendorPrefix.empty(),
            .@"text-transform" => VendorPrefix.empty(),
            .@"white-space" => VendorPrefix.empty(),
            .@"tab-size" => |p| p,
            .@"word-break" => VendorPrefix.empty(),
            .@"line-break" => VendorPrefix.empty(),
            .hyphens => |p| p,
            .@"overflow-wrap" => VendorPrefix.empty(),
            .@"word-wrap" => VendorPrefix.empty(),
            .@"text-align" => VendorPrefix.empty(),
            .@"text-align-last" => |p| p,
            .@"text-justify" => VendorPrefix.empty(),
            .@"word-spacing" => VendorPrefix.empty(),
            .@"letter-spacing" => VendorPrefix.empty(),
            .@"text-indent" => VendorPrefix.empty(),
            .@"text-decoration-line" => |p| p,
            .@"text-decoration-style" => |p| p,
            .@"text-decoration-color" => |p| p,
            .@"text-decoration-thickness" => VendorPrefix.empty(),
            .@"text-decoration" => |p| p,
            .@"text-decoration-skip-ink" => |p| p,
            .@"text-emphasis-style" => |p| p,
            .@"text-emphasis-color" => |p| p,
            .@"text-emphasis" => |p| p,
            .@"text-emphasis-position" => |p| p,
            .@"text-shadow" => VendorPrefix.empty(),
            .@"text-size-adjust" => |p| p,
            .direction => VendorPrefix.empty(),
            .@"unicode-bidi" => VendorPrefix.empty(),
            .@"box-decoration-break" => |p| p,
            .resize => VendorPrefix.empty(),
            .cursor => VendorPrefix.empty(),
            .@"caret-color" => VendorPrefix.empty(),
            .@"caret-shape" => VendorPrefix.empty(),
            .caret => VendorPrefix.empty(),
            .@"user-select" => |p| p,
            .@"accent-color" => VendorPrefix.empty(),
            .appearance => |p| p,
            .@"list-style-type" => VendorPrefix.empty(),
            .@"list-style-image" => VendorPrefix.empty(),
            .@"list-style-position" => VendorPrefix.empty(),
            .@"list-style" => VendorPrefix.empty(),
            .@"marker-side" => VendorPrefix.empty(),
            .composes => VendorPrefix.empty(),
            .fill => VendorPrefix.empty(),
            .@"fill-rule" => VendorPrefix.empty(),
            .@"fill-opacity" => VendorPrefix.empty(),
            .stroke => VendorPrefix.empty(),
            .@"stroke-opacity" => VendorPrefix.empty(),
            .@"stroke-width" => VendorPrefix.empty(),
            .@"stroke-linecap" => VendorPrefix.empty(),
            .@"stroke-linejoin" => VendorPrefix.empty(),
            .@"stroke-miterlimit" => VendorPrefix.empty(),
            .@"stroke-dasharray" => VendorPrefix.empty(),
            .@"stroke-dashoffset" => VendorPrefix.empty(),
            .@"marker-start" => VendorPrefix.empty(),
            .@"marker-mid" => VendorPrefix.empty(),
            .@"marker-end" => VendorPrefix.empty(),
            .marker => VendorPrefix.empty(),
            .@"color-interpolation" => VendorPrefix.empty(),
            .@"color-interpolation-filters" => VendorPrefix.empty(),
            .@"color-rendering" => VendorPrefix.empty(),
            .@"shape-rendering" => VendorPrefix.empty(),
            .@"text-rendering" => VendorPrefix.empty(),
            .@"image-rendering" => VendorPrefix.empty(),
            .@"clip-path" => |p| p,
            .@"clip-rule" => VendorPrefix.empty(),
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
            .filter => |p| p,
            .@"backdrop-filter" => |p| p,
            .@"z-index" => VendorPrefix.empty(),
            .@"container-type" => VendorPrefix.empty(),
            .@"container-name" => VendorPrefix.empty(),
            .container => VendorPrefix.empty(),
            .@"view-transition-name" => VendorPrefix.empty(),
            .@"color-scheme" => VendorPrefix.empty(),
            .all, .custom => VendorPrefix.empty(),
        };
    }

    pub fn fromNameAndPrefix(name1: []const u8, pre: VendorPrefix) ?PropertyId {
        // TODO: todo_stuff.match_ignore_ascii_case
        if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "background-color")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"background-color";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "background-image")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"background-image";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "background-position-x")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"background-position-x";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "background-position-y")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"background-position-y";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "background-position")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"background-position";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "background-size")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"background-size";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "background-repeat")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"background-repeat";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "background-attachment")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"background-attachment";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "background-clip")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true, .moz = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"background-clip" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "background-origin")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"background-origin";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "background")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .background;
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "box-shadow")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true, .moz = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"box-shadow" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "opacity")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .opacity;
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "color")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .color;
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "display")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .display;
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "visibility")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .visibility;
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "width")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .width;
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "height")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .height;
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "min-width")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"min-width";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "min-height")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"min-height";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "max-width")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"max-width";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "max-height")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"max-height";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "block-size")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"block-size";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "inline-size")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"inline-size";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "min-block-size")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"min-block-size";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "min-inline-size")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"min-inline-size";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "max-block-size")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"max-block-size";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "max-inline-size")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"max-inline-size";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "box-sizing")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true, .moz = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"box-sizing" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "aspect-ratio")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"aspect-ratio";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "overflow")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .overflow;
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "overflow-x")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"overflow-x";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "overflow-y")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"overflow-y";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "text-overflow")) {
            const allowed_prefixes = VendorPrefix{ .o = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"text-overflow" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "position")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .position;
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "top")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .top;
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "bottom")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .bottom;
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "left")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .left;
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "right")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .right;
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "inset-block-start")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"inset-block-start";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "inset-block-end")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"inset-block-end";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "inset-inline-start")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"inset-inline-start";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "inset-inline-end")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"inset-inline-end";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "inset-block")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"inset-block";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "inset-inline")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"inset-inline";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "inset")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .inset;
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "border-spacing")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"border-spacing";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "border-top-color")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"border-top-color";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "border-bottom-color")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"border-bottom-color";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "border-left-color")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"border-left-color";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "border-right-color")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"border-right-color";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "border-block-start-color")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"border-block-start-color";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "border-block-end-color")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"border-block-end-color";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "border-inline-start-color")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"border-inline-start-color";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "border-inline-end-color")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"border-inline-end-color";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "border-top-style")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"border-top-style";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "border-bottom-style")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"border-bottom-style";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "border-left-style")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"border-left-style";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "border-right-style")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"border-right-style";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "border-block-start-style")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"border-block-start-style";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "border-block-end-style")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"border-block-end-style";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "border-inline-start-style")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"border-inline-start-style";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "border-inline-end-style")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"border-inline-end-style";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "border-top-width")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"border-top-width";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "border-bottom-width")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"border-bottom-width";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "border-left-width")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"border-left-width";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "border-right-width")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"border-right-width";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "border-block-start-width")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"border-block-start-width";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "border-block-end-width")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"border-block-end-width";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "border-inline-start-width")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"border-inline-start-width";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "border-inline-end-width")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"border-inline-end-width";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "border-top-left-radius")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true, .moz = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"border-top-left-radius" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "border-top-right-radius")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true, .moz = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"border-top-right-radius" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "border-bottom-left-radius")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true, .moz = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"border-bottom-left-radius" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "border-bottom-right-radius")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true, .moz = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"border-bottom-right-radius" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "border-start-start-radius")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"border-start-start-radius";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "border-start-end-radius")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"border-start-end-radius";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "border-end-start-radius")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"border-end-start-radius";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "border-end-end-radius")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"border-end-end-radius";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "border-radius")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true, .moz = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"border-radius" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "border-image-source")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"border-image-source";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "border-image-outset")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"border-image-outset";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "border-image-repeat")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"border-image-repeat";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "border-image-width")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"border-image-width";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "border-image-slice")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"border-image-slice";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "border-image")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true, .moz = true, .o = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"border-image" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "border-color")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"border-color";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "border-style")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"border-style";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "border-width")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"border-width";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "border-block-color")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"border-block-color";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "border-block-style")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"border-block-style";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "border-block-width")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"border-block-width";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "border-inline-color")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"border-inline-color";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "border-inline-style")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"border-inline-style";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "border-inline-width")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"border-inline-width";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "border")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .border;
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "border-top")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"border-top";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "border-bottom")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"border-bottom";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "border-left")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"border-left";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "border-right")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"border-right";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "border-block")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"border-block";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "border-block-start")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"border-block-start";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "border-block-end")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"border-block-end";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "border-inline")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"border-inline";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "border-inline-start")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"border-inline-start";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "border-inline-end")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"border-inline-end";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "outline")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .outline;
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "outline-color")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"outline-color";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "outline-style")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"outline-style";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "outline-width")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"outline-width";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "flex-direction")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true, .ms = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"flex-direction" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "flex-wrap")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true, .ms = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"flex-wrap" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "flex-flow")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true, .ms = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"flex-flow" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "flex-grow")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"flex-grow" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "flex-shrink")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"flex-shrink" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "flex-basis")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"flex-basis" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "flex")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true, .ms = true };
            if (allowed_prefixes.contains(pre)) return .{ .flex = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "order")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true };
            if (allowed_prefixes.contains(pre)) return .{ .order = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "align-content")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"align-content" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "justify-content")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"justify-content" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "place-content")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"place-content";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "align-self")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"align-self" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "justify-self")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"justify-self";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "place-self")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"place-self";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "align-items")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"align-items" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "justify-items")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"justify-items";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "place-items")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"place-items";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "row-gap")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"row-gap";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "column-gap")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"column-gap";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "gap")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .gap;
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "box-orient")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true, .moz = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"box-orient" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "box-direction")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true, .moz = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"box-direction" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "box-ordinal-group")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true, .moz = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"box-ordinal-group" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "box-align")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true, .moz = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"box-align" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "box-flex")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true, .moz = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"box-flex" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "box-flex-group")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"box-flex-group" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "box-pack")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true, .moz = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"box-pack" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "box-lines")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true, .moz = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"box-lines" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "flex-pack")) {
            const allowed_prefixes = VendorPrefix{ .ms = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"flex-pack" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "flex-order")) {
            const allowed_prefixes = VendorPrefix{ .ms = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"flex-order" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "flex-align")) {
            const allowed_prefixes = VendorPrefix{ .ms = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"flex-align" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "flex-item-align")) {
            const allowed_prefixes = VendorPrefix{ .ms = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"flex-item-align" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "flex-line-pack")) {
            const allowed_prefixes = VendorPrefix{ .ms = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"flex-line-pack" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "flex-positive")) {
            const allowed_prefixes = VendorPrefix{ .ms = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"flex-positive" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "flex-negative")) {
            const allowed_prefixes = VendorPrefix{ .ms = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"flex-negative" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "flex-preferred-size")) {
            const allowed_prefixes = VendorPrefix{ .ms = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"flex-preferred-size" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "margin-top")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"margin-top";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "margin-bottom")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"margin-bottom";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "margin-left")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"margin-left";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "margin-right")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"margin-right";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "margin-block-start")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"margin-block-start";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "margin-block-end")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"margin-block-end";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "margin-inline-start")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"margin-inline-start";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "margin-inline-end")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"margin-inline-end";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "margin-block")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"margin-block";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "margin-inline")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"margin-inline";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "margin")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .margin;
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "padding-top")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"padding-top";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "padding-bottom")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"padding-bottom";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "padding-left")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"padding-left";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "padding-right")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"padding-right";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "padding-block-start")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"padding-block-start";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "padding-block-end")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"padding-block-end";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "padding-inline-start")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"padding-inline-start";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "padding-inline-end")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"padding-inline-end";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "padding-block")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"padding-block";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "padding-inline")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"padding-inline";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "padding")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .padding;
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "scroll-margin-top")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"scroll-margin-top";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "scroll-margin-bottom")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"scroll-margin-bottom";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "scroll-margin-left")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"scroll-margin-left";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "scroll-margin-right")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"scroll-margin-right";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "scroll-margin-block-start")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"scroll-margin-block-start";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "scroll-margin-block-end")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"scroll-margin-block-end";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "scroll-margin-inline-start")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"scroll-margin-inline-start";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "scroll-margin-inline-end")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"scroll-margin-inline-end";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "scroll-margin-block")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"scroll-margin-block";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "scroll-margin-inline")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"scroll-margin-inline";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "scroll-margin")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"scroll-margin";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "scroll-padding-top")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"scroll-padding-top";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "scroll-padding-bottom")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"scroll-padding-bottom";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "scroll-padding-left")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"scroll-padding-left";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "scroll-padding-right")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"scroll-padding-right";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "scroll-padding-block-start")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"scroll-padding-block-start";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "scroll-padding-block-end")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"scroll-padding-block-end";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "scroll-padding-inline-start")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"scroll-padding-inline-start";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "scroll-padding-inline-end")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"scroll-padding-inline-end";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "scroll-padding-block")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"scroll-padding-block";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "scroll-padding-inline")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"scroll-padding-inline";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "scroll-padding")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"scroll-padding";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "font-weight")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"font-weight";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "font-size")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"font-size";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "font-stretch")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"font-stretch";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "font-family")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"font-family";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "font-style")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"font-style";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "font-variant-caps")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"font-variant-caps";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "line-height")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"line-height";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "font")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .font;
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "vertical-align")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"vertical-align";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "font-palette")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"font-palette";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "transition-property")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true, .moz = true, .ms = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"transition-property" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "transition-duration")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true, .moz = true, .ms = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"transition-duration" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "transition-delay")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true, .moz = true, .ms = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"transition-delay" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "transition-timing-function")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true, .moz = true, .ms = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"transition-timing-function" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "transition")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true, .moz = true, .ms = true };
            if (allowed_prefixes.contains(pre)) return .{ .transition = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "animation-name")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true, .moz = true, .o = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"animation-name" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "animation-duration")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true, .moz = true, .o = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"animation-duration" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "animation-timing-function")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true, .moz = true, .o = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"animation-timing-function" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "animation-iteration-count")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true, .moz = true, .o = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"animation-iteration-count" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "animation-direction")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true, .moz = true, .o = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"animation-direction" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "animation-play-state")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true, .moz = true, .o = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"animation-play-state" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "animation-delay")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true, .moz = true, .o = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"animation-delay" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "animation-fill-mode")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true, .moz = true, .o = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"animation-fill-mode" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "animation-composition")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"animation-composition";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "animation-timeline")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"animation-timeline";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "animation-range-start")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"animation-range-start";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "animation-range-end")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"animation-range-end";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "animation-range")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"animation-range";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "animation")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true, .moz = true, .o = true };
            if (allowed_prefixes.contains(pre)) return .{ .animation = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "transform")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true, .moz = true, .ms = true, .o = true };
            if (allowed_prefixes.contains(pre)) return .{ .transform = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "transform-origin")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true, .moz = true, .ms = true, .o = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"transform-origin" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "transform-style")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true, .moz = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"transform-style" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "transform-box")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"transform-box";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "backface-visibility")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true, .moz = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"backface-visibility" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "perspective")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true, .moz = true };
            if (allowed_prefixes.contains(pre)) return .{ .perspective = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "perspective-origin")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true, .moz = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"perspective-origin" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "translate")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .translate;
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "rotate")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .rotate;
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "scale")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .scale;
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "text-transform")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"text-transform";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "white-space")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"white-space";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "tab-size")) {
            const allowed_prefixes = VendorPrefix{ .moz = true, .o = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"tab-size" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "word-break")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"word-break";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "line-break")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"line-break";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "hyphens")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true, .moz = true, .ms = true };
            if (allowed_prefixes.contains(pre)) return .{ .hyphens = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "overflow-wrap")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"overflow-wrap";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "word-wrap")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"word-wrap";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "text-align")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"text-align";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "text-align-last")) {
            const allowed_prefixes = VendorPrefix{ .moz = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"text-align-last" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "text-justify")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"text-justify";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "word-spacing")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"word-spacing";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "letter-spacing")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"letter-spacing";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "text-indent")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"text-indent";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "text-decoration-line")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true, .moz = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"text-decoration-line" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "text-decoration-style")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true, .moz = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"text-decoration-style" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "text-decoration-color")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true, .moz = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"text-decoration-color" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "text-decoration-thickness")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"text-decoration-thickness";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "text-decoration")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true, .moz = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"text-decoration" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "text-decoration-skip-ink")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"text-decoration-skip-ink" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "text-emphasis-style")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"text-emphasis-style" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "text-emphasis-color")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"text-emphasis-color" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "text-emphasis")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"text-emphasis" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "text-emphasis-position")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"text-emphasis-position" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "text-shadow")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"text-shadow";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "text-size-adjust")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true, .moz = true, .ms = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"text-size-adjust" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "direction")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .direction;
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "unicode-bidi")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"unicode-bidi";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "box-decoration-break")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"box-decoration-break" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "resize")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .resize;
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "cursor")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .cursor;
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "caret-color")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"caret-color";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "caret-shape")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"caret-shape";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "caret")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .caret;
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "user-select")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true, .moz = true, .ms = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"user-select" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "accent-color")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"accent-color";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "appearance")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true, .moz = true, .ms = true };
            if (allowed_prefixes.contains(pre)) return .{ .appearance = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "list-style-type")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"list-style-type";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "list-style-image")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"list-style-image";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "list-style-position")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"list-style-position";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "list-style")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"list-style";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "marker-side")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"marker-side";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "composes")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .composes;
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "fill")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .fill;
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "fill-rule")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"fill-rule";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "fill-opacity")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"fill-opacity";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "stroke")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .stroke;
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "stroke-opacity")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"stroke-opacity";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "stroke-width")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"stroke-width";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "stroke-linecap")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"stroke-linecap";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "stroke-linejoin")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"stroke-linejoin";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "stroke-miterlimit")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"stroke-miterlimit";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "stroke-dasharray")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"stroke-dasharray";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "stroke-dashoffset")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"stroke-dashoffset";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "marker-start")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"marker-start";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "marker-mid")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"marker-mid";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "marker-end")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"marker-end";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "marker")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .marker;
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "color-interpolation")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"color-interpolation";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "color-interpolation-filters")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"color-interpolation-filters";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "color-rendering")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"color-rendering";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "shape-rendering")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"shape-rendering";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "text-rendering")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"text-rendering";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "image-rendering")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"image-rendering";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "clip-path")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"clip-path" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "clip-rule")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"clip-rule";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "mask-image")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"mask-image" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "mask-mode")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"mask-mode";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "mask-repeat")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"mask-repeat" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "mask-position-x")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"mask-position-x";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "mask-position-y")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"mask-position-y";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "mask-position")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"mask-position" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "mask-clip")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"mask-clip" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "mask-origin")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"mask-origin" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "mask-size")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"mask-size" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "mask-composite")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"mask-composite";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "mask-type")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"mask-type";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "mask")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true };
            if (allowed_prefixes.contains(pre)) return .{ .mask = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "mask-border-source")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"mask-border-source";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "mask-border-mode")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"mask-border-mode";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "mask-border-slice")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"mask-border-slice";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "mask-border-width")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"mask-border-width";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "mask-border-outset")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"mask-border-outset";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "mask-border-repeat")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"mask-border-repeat";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "mask-border")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"mask-border";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "-webkit-mask-composite")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"-webkit-mask-composite";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "mask-source-type")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"mask-source-type" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "mask-box-image")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"mask-box-image" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "mask-box-image-source")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"mask-box-image-source" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "mask-box-image-slice")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"mask-box-image-slice" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "mask-box-image-width")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"mask-box-image-width" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "mask-box-image-outset")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"mask-box-image-outset" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "mask-box-image-repeat")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"mask-box-image-repeat" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "filter")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true };
            if (allowed_prefixes.contains(pre)) return .{ .filter = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "backdrop-filter")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"backdrop-filter" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "z-index")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"z-index";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "container-type")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"container-type";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "container-name")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"container-name";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "container")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .container;
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "view-transition-name")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"view-transition-name";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "color-scheme")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"color-scheme";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "all")) {} else {
            return null;
        }

        return null;
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
    @"vertical-align",
    @"font-palette",
    @"transition-property",
    @"transition-duration",
    @"transition-delay",
    @"transition-timing-function",
    transition,
    @"animation-name",
    @"animation-duration",
    @"animation-timing-function",
    @"animation-iteration-count",
    @"animation-direction",
    @"animation-play-state",
    @"animation-delay",
    @"animation-fill-mode",
    @"animation-composition",
    @"animation-timeline",
    @"animation-range-start",
    @"animation-range-end",
    @"animation-range",
    animation,
    transform,
    @"transform-origin",
    @"transform-style",
    @"transform-box",
    @"backface-visibility",
    perspective,
    @"perspective-origin",
    translate,
    rotate,
    scale,
    @"text-transform",
    @"white-space",
    @"tab-size",
    @"word-break",
    @"line-break",
    hyphens,
    @"overflow-wrap",
    @"word-wrap",
    @"text-align",
    @"text-align-last",
    @"text-justify",
    @"word-spacing",
    @"letter-spacing",
    @"text-indent",
    @"text-decoration-line",
    @"text-decoration-style",
    @"text-decoration-color",
    @"text-decoration-thickness",
    @"text-decoration",
    @"text-decoration-skip-ink",
    @"text-emphasis-style",
    @"text-emphasis-color",
    @"text-emphasis",
    @"text-emphasis-position",
    @"text-shadow",
    @"text-size-adjust",
    direction,
    @"unicode-bidi",
    @"box-decoration-break",
    resize,
    cursor,
    @"caret-color",
    @"caret-shape",
    caret,
    @"user-select",
    @"accent-color",
    appearance,
    @"list-style-type",
    @"list-style-image",
    @"list-style-position",
    @"list-style",
    @"marker-side",
    composes,
    fill,
    @"fill-rule",
    @"fill-opacity",
    stroke,
    @"stroke-opacity",
    @"stroke-width",
    @"stroke-linecap",
    @"stroke-linejoin",
    @"stroke-miterlimit",
    @"stroke-dasharray",
    @"stroke-dashoffset",
    @"marker-start",
    @"marker-mid",
    @"marker-end",
    marker,
    @"color-interpolation",
    @"color-interpolation-filters",
    @"color-rendering",
    @"shape-rendering",
    @"text-rendering",
    @"image-rendering",
    @"clip-path",
    @"clip-rule",
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
    filter,
    @"backdrop-filter",
    @"z-index",
    @"container-type",
    @"container-name",
    container,
    @"view-transition-name",
    @"color-scheme",
    all,
    custom,
};
