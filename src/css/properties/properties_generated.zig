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
// const Outline = outline.Outline;
// const OutlineStyle = outline.OutlineStyle;
// const FlexDirection = flex.FlexDirection;
// const FlexWrap = flex.FlexWrap;
// const FlexFlow = flex.FlexFlow;
// const Flex = flex.Flex;
// const BoxOrient = flex.BoxOrient;
// const BoxDirection = flex.BoxDirection;
// const BoxAlign = flex.BoxAlign;
// const BoxPack = flex.BoxPack;
// const BoxLines = flex.BoxLines;
// const FlexPack = flex.FlexPack;
// const FlexItemAlign = flex.FlexItemAlign;
// const FlexLinePack = flex.FlexLinePack;
// const AlignContent = @"align".AlignContent;
// const JustifyContent = @"align".JustifyContent;
// const PlaceContent = @"align".PlaceContent;
// const AlignSelf = @"align".AlignSelf;
// const JustifySelf = @"align".JustifySelf;
// const PlaceSelf = @"align".PlaceSelf;
// const AlignItems = @"align".AlignItems;
// const JustifyItems = @"align".JustifyItems;
// const PlaceItems = @"align".PlaceItems;
// const GapValue = @"align".GapValue;
// const Gap = @"align".Gap;
// const MarginBlock = margin_padding.MarginBlock;
// const Margin = margin_padding.Margin;
// const MarginInline = margin_padding.MarginInline;
// const PaddingBlock = margin_padding.PaddingBlock;
// const PaddingInline = margin_padding.PaddingInline;
// const Padding = margin_padding.Padding;
// const ScrollMarginBlock = margin_padding.ScrollMarginBlock;
// const ScrollMarginInline = margin_padding.ScrollMarginInline;
// const ScrollMargin = margin_padding.ScrollMargin;
// const ScrollPaddingBlock = margin_padding.ScrollPaddingBlock;
// const ScrollPaddingInline = margin_padding.ScrollPaddingInline;
// const ScrollPadding = margin_padding.ScrollPadding;
// const FontWeight = font.FontWeight;
// const FontSize = font.FontSize;
// const FontStretch = font.FontStretch;
// const FontFamily = font.FontFamily;
// const FontStyle = font.FontStyle;
// const FontVariantCaps = font.FontVariantCaps;
// const LineHeight = font.LineHeight;
// const Font = font.Font;
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
// const TextShadow = text.TextShadow;
// const TextSizeAdjust = text.TextSizeAdjust;
// const Direction = text.Direction;
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
// const ClipPath = masking.ClipPath;
// const MaskMode = masking.MaskMode;
// const MaskClip = masking.MaskClip;
// const GeometryBox = masking.GeometryBox;
// const MaskComposite = masking.MaskComposite;
// const MaskType = masking.MaskType;
// const Mask = masking.Mask;
// const MaskBorderMode = masking.MaskBorderMode;
// const MaskBorder = masking.MaskBorder;
// const WebKitMaskComposite = masking.WebKitMaskComposite;
// const WebKitMaskSourceType = masking.WebKitMaskSourceType;
// const BackgroundRepeat = background.BackgroundRepeat;
// const BackgroundSize = background.BackgroundSize;
// const FilterList = effects.FilterList;
// const ContainerType = contain.ContainerType;
// const Container = contain.Container;
// const ContainerNameList = contain.ContainerNameList;
const CustomPropertyName = custom.CustomPropertyName;
// const display = css.css_properties.display;

const Position = position.Position;

const Result = css.Result;

const ArrayList = std.ArrayListUnmanaged;
const SmallList = css.SmallList;
pub const Property = union(PropertyIdTag) {
    @"background-color": CssColor,
    color: CssColor,
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
    @"border-top-width": BorderSideWidth,
    @"border-bottom-width": BorderSideWidth,
    @"border-left-width": BorderSideWidth,
    @"border-right-width": BorderSideWidth,
    @"outline-color": CssColor,
    @"text-decoration-color": struct { CssColor, VendorPrefix },
    @"text-emphasis-color": struct { CssColor, VendorPrefix },
    composes: Composes,
    all: CSSWideKeyword,
    unparsed: UnparsedProperty,
    custom: CustomProperty,

    pub usingnamespace PropertyImpl();
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
            .color => {
                if (css.generic.parseWithOptions(CssColor, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .color = c } };
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
            .@"outline-color" => {
                if (css.generic.parseWithOptions(CssColor, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .@"outline-color" = c } };
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
            .composes => {
                if (css.generic.parseWithOptions(Composes, input, options).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .composes = c } };
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

    pub inline fn __toCssHelper(this: *const Property) struct { []const u8, VendorPrefix } {
        return switch (this.*) {
            .@"background-color" => .{ "background-color", VendorPrefix{ .none = true } },
            .color => .{ "color", VendorPrefix{ .none = true } },
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
            .@"border-top-width" => .{ "border-top-width", VendorPrefix{ .none = true } },
            .@"border-bottom-width" => .{ "border-bottom-width", VendorPrefix{ .none = true } },
            .@"border-left-width" => .{ "border-left-width", VendorPrefix{ .none = true } },
            .@"border-right-width" => .{ "border-right-width", VendorPrefix{ .none = true } },
            .@"outline-color" => .{ "outline-color", VendorPrefix{ .none = true } },
            .@"text-decoration-color" => |*x| .{ "text-decoration-color", x.@"1" },
            .@"text-emphasis-color" => |*x| .{ "text-emphasis-color", x.@"1" },
            .composes => .{ "composes", VendorPrefix{ .none = true } },
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
            .color => |*value| value.toCss(W, dest),
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
            .@"border-top-width" => |*value| value.toCss(W, dest),
            .@"border-bottom-width" => |*value| value.toCss(W, dest),
            .@"border-left-width" => |*value| value.toCss(W, dest),
            .@"border-right-width" => |*value| value.toCss(W, dest),
            .@"outline-color" => |*value| value.toCss(W, dest),
            .@"text-decoration-color" => |*value| value[0].toCss(W, dest),
            .@"text-emphasis-color" => |*value| value[0].toCss(W, dest),
            .composes => |*value| value.toCss(W, dest),
            .all => |*keyword| keyword.toCss(W, dest),
            .unparsed => |*unparsed| unparsed.value.toCss(W, dest, false),
            .custom => |*c| c.value.toCss(W, dest, c.name == .custom),
        };
    }

    /// Returns the given longhand property for a shorthand.
    pub fn longhand(this: *const Property, property_id: *const PropertyId) ?Property {
        _ = property_id; // autofix
        switch (this.*) {
            else => {},
        }
        return null;
    }
};
pub const PropertyId = union(PropertyIdTag) {
    @"background-color",
    color,
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
    @"border-top-width",
    @"border-bottom-width",
    @"border-left-width",
    @"border-right-width",
    @"outline-color",
    @"text-decoration-color": VendorPrefix,
    @"text-emphasis-color": VendorPrefix,
    composes,
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
            .color => VendorPrefix.empty(),
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
            .@"border-top-width" => VendorPrefix.empty(),
            .@"border-bottom-width" => VendorPrefix.empty(),
            .@"border-left-width" => VendorPrefix.empty(),
            .@"border-right-width" => VendorPrefix.empty(),
            .@"outline-color" => VendorPrefix.empty(),
            .@"text-decoration-color" => |p| p,
            .@"text-emphasis-color" => |p| p,
            .composes => VendorPrefix.empty(),
            .all, .custom, .unparsed => VendorPrefix.empty(),
        };
    }

    pub fn fromNameAndPrefix(name1: []const u8, pre: VendorPrefix) ?PropertyId {
        // TODO: todo_stuff.match_ignore_ascii_case
        if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "background-color")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"background-color";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "color")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .color;
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
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "outline-color")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"outline-color";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "text-decoration-color")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true, .moz = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"text-decoration-color" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "text-emphasis-color")) {
            const allowed_prefixes = VendorPrefix{ .webkit = true };
            if (allowed_prefixes.contains(pre)) return .{ .@"text-emphasis-color" = pre };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "composes")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .composes;
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "all")) {} else {
            return null;
        }

        return null;
    }

    pub fn withPrefix(this: *const PropertyId, pre: VendorPrefix) PropertyId {
        return switch (this.*) {
            .@"background-color" => .@"background-color",
            .color => .color,
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
            .@"border-top-width" => .@"border-top-width",
            .@"border-bottom-width" => .@"border-bottom-width",
            .@"border-left-width" => .@"border-left-width",
            .@"border-right-width" => .@"border-right-width",
            .@"outline-color" => .@"outline-color",
            .@"text-decoration-color" => .{ .@"text-decoration-color" = pre },
            .@"text-emphasis-color" => .{ .@"text-emphasis-color" = pre },
            .composes => .composes,
            else => this.*,
        };
    }

    pub fn addPrefix(this: *PropertyId, pre: VendorPrefix) void {
        return switch (this.*) {
            .@"background-color" => {},
            .color => {},
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
            .@"border-top-width" => {},
            .@"border-bottom-width" => {},
            .@"border-left-width" => {},
            .@"border-right-width" => {},
            .@"outline-color" => {},
            .@"text-decoration-color" => |*p| {
                p.insert(pre);
            },
            .@"text-emphasis-color" => |*p| {
                p.insert(pre);
            },
            .composes => {},
            else => {},
        };
    }
};
pub const PropertyIdTag = enum(u16) {
    @"background-color",
    color,
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
    @"border-top-width",
    @"border-bottom-width",
    @"border-left-width",
    @"border-right-width",
    @"outline-color",
    @"text-decoration-color",
    @"text-emphasis-color",
    composes,
    all,
    unparsed,
    custom,
};
