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

// const BorderSideWidth = border.BorderSideWith;
// const Size2D = css_values.size.Size2D;
// const BorderRadius = border_radius.BorderRadius;
// const Rect = css_values.rect.Rect;
// const LengthOrNumber = css_values.length.LengthOrNumber;
// const BorderImageRepeat = border_image.BorderImageRepeat;
// const BorderImageSideWidth = border_image.BorderImageSideWidth;
// const BorderImageSlice = border_image.BorderImageSlice;
// const BorderImage = border_image.BorderImage;
// const BorderColor = border.BorderColor;
// const BorderStyle = border.BorderStyle;
// const BorderWidth = border.BorderWidth;
// const BorderBlockColor = border.BorderBlockColor;
// const BorderBlockStyle = border.BorderBlockStyle;
// const BorderBlockWidth = border.BorderBlockWidth;
// const BorderInlineColor = border.BorderInlineColor;
// const BorderInlineStyle = border.BorderInlineStyle;
// const BorderInlineWidth = border.BorderInlineWidth;
// const Border = border.Border;
// const BorderTop = border.BorderTop;
// const BorderRight = border.BorderRight;
// const BorderLeft = border.BorderLeft;
// const BorderBottom = border.BorderBottom;
// const BorderBlockStart = border.BorderBlockStart;
// const BorderBlockEnd = border.BorderBlockEnd;
// const BorderInlineStart = border.BorderInlineStart;
// const BorderInlineEnd = border.BorderInlineEnd;
// const BorderBlock = border.BorderBlock;
// const BorderInline = border.BorderInline;
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
            .composes => VendorPrefix.empty(),
            .all, .custom, .unparsed => VendorPrefix.empty(),
        };
    }

    pub fn fromNameAndPrefix(name1: []const u8, pre: VendorPrefix) ?PropertyId {
        // TODO: todo_stuff.match_ignore_ascii_case
        if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "background-color")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .@"background-color";
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "composes")) {
            const allowed_prefixes = VendorPrefix{ .none = true };
            if (allowed_prefixes.contains(pre)) return .composes;
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "all")) {} else {
            return null;
        }

        return null;
    }

    pub fn withPrefix(this: *const PropertyId, pre: VendorPrefix) PropertyId {
        _ = pre; // autofix
        return switch (this.*) {
            .@"background-color" => .@"background-color",
            .composes => .composes,
            else => this.*,
        };
    }

    pub fn addPrefix(this: *const PropertyId, pre: VendorPrefix) void {
        _ = pre; // autofix
        return switch (this.*) {
            .@"background-color" => {},
            .composes => {},
            else => {},
        };
    }
};
pub const PropertyIdTag = enum(u16) {
    @"background-color",
    composes,
    all,
    unparsed,
    custom,
};
