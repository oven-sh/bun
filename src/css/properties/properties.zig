const std = @import("std");
const bun = @import("root").bun;
const Allocator = std.mem.Allocator;

pub const css = @import("../css_parser.zig");

const Printer = css.Printer;
const PrintErr = css.PrintErr;

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

pub const font = @import("./font.zig");

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

const Position = position.Position;

const Error = css.Error;

const ArrayList = std.ArrayListUnmanaged;
const SmallList = css.SmallList;

pub const custom = struct {
    pub usingnamespace @import("./custom.zig");
};

pub const @"align" = struct {
    /// A value for the [align-content](https://www.w3.org/TR/css-align-3/#propdef-align-content) property.
    pub const AlignContent = union(enum) {
        /// Default alignment.
        normal: void,
        /// A baseline position.
        baseline_position: BaselinePosition,
        /// A content distribution keyword.
        content_distribution: ContentDistribution,
        /// A content position keyword.
        content_position: struct {
            /// An overflow alignment mode.
            overflow: ?OverflowPosition,
            /// A content position keyword.
            value: ContentPosition,
        },
    };

    /// A [`<baseline-position>`](https://www.w3.org/TR/css-align-3/#typedef-baseline-position) value,
    /// as used in the alignment properties.
    pub const BaselinePosition = enum {
        /// The first baseline.
        first,
        /// The last baseline.
        last,
    };

    /// A value for the [justify-content](https://www.w3.org/TR/css-align-3/#propdef-justify-content) property.
    pub const JustifyContent = union(enum) {
        /// Default justification.
        normal,
        /// A content distribution keyword.
        content_distribution: ContentDistribution,
        /// A content position keyword.
        content_position: struct {
            /// A content position keyword.
            value: ContentPosition,
            /// An overflow alignment mode.
            overflow: ?OverflowPosition,
        },
        /// Justify to the left.
        left: struct {
            /// An overflow alignment mode.
            overflow: ?OverflowPosition,
        },
        /// Justify to the right.
        right: struct {
            /// An overflow alignment mode.
            overflow: ?OverflowPosition,
        },
    };

    /// A value for the [align-self](https://www.w3.org/TR/css-align-3/#align-self-property) property.
    pub const AlignSelf = union(enum) {
        /// Automatic alignment.
        auto,
        /// Default alignment.
        normal,
        /// Item is stretched.
        stretch,
        /// A baseline position keyword.
        baseline_position: BaselinePosition,
        /// A self position keyword.
        self_position: struct {
            /// An overflow alignment mode.
            overflow: ?OverflowPosition,
            /// A self position keyword.
            value: SelfPosition,
        },
    };

    /// A value for the [justify-self](https://www.w3.org/TR/css-align-3/#justify-self-property) property.
    pub const JustifySelf = union(enum) {
        /// Automatic justification.
        auto,
        /// Default justification.
        normal,
        /// Item is stretched.
        stretch,
        /// A baseline position keyword.
        baseline_position: BaselinePosition,
        /// A self position keyword.
        self_position: struct {
            /// A self position keyword.
            value: SelfPosition,
            /// An overflow alignment mode.
            overflow: ?OverflowPosition,
        },
        /// Item is justified to the left.
        left: struct {
            /// An overflow alignment mode.
            overflow: ?OverflowPosition,
        },
        /// Item is justified to the right.
        right: struct {
            /// An overflow alignment mode.
            overflow: ?OverflowPosition,
        },
    };

    /// A value for the [align-items](https://www.w3.org/TR/css-align-3/#align-items-property) property.
    pub const AlignItems = union(enum) {
        /// Default alignment.
        normal,
        /// Items are stretched.
        stretch,
        /// A baseline position keyword.
        baseline_position: BaselinePosition,
        /// A self position keyword.
        self_position: struct {
            /// An overflow alignment mode.
            overflow: ?OverflowPosition,
            /// A self position keyword.
            value: SelfPosition,
        },
    };

    /// A value for the [justify-items](https://www.w3.org/TR/css-align-3/#justify-items-property) property.
    pub const JustifyItems = union(enum) {
        /// Default justification.
        normal,
        /// Items are stretched.
        stretch,
        /// A baseline position keyword.
        baseline_position: BaselinePosition,
        /// A self position keyword, with optional overflow position.
        self_position: struct {
            /// A self position keyword.
            value: SelfPosition,
            /// An overflow alignment mode.
            overflow: ?OverflowPosition,
        },
        /// Items are justified to the left, with an optional overflow position.
        left: struct {
            /// An overflow alignment mode.
            overflow: ?OverflowPosition,
        },
        /// Items are justified to the right, with an optional overflow position.
        right: struct {
            /// An overflow alignment mode.
            overflow: ?OverflowPosition,
        },
        /// A legacy justification keyword.
        legacy: LegacyJustify,
    };

    /// A legacy justification keyword, as used in the `justify-items` property.
    pub const LegacyJustify = enum {
        /// Left justify.
        left,
        /// Right justify.
        right,
        /// Centered.
        center,
    };

    /// A [gap](https://www.w3.org/TR/css-align-3/#column-row-gap) value, as used in the
    /// `column-gap` and `row-gap` properties.
    pub const GapValue = union(enum) {
        /// Equal to `1em` for multi-column containers, and zero otherwise.
        normal,
        /// An explicit length.
        length_percentage: LengthPercentage,
    };

    /// A value for the [gap](https://www.w3.org/TR/css-align-3/#gap-shorthand) shorthand property.
    pub const Gap = @compileError(css.todo_stuff.depth);

    /// A value for the [place-items](https://www.w3.org/TR/css-align-3/#place-items-property) shorthand property.
    pub const PlaceItems = @compileError(css.todo_stuff.depth);

    /// A value for the [place-self](https://www.w3.org/TR/css-align-3/#place-self-property) shorthand property.
    pub const PlaceSelf = @compileError(css.todo_stuff.depth);

    /// A [`<self-position>`](https://www.w3.org/TR/css-align-3/#typedef-self-position) value.
    pub const SelfPosition = @compileError(css.todo_stuff.depth);

    /// A value for the [place-content](https://www.w3.org/TR/css-align-3/#place-content) shorthand property.
    pub const PlaceContent = @compileError(css.todo_stuff.depth);

    /// A [`<content-distribution>`](https://www.w3.org/TR/css-align-3/#typedef-content-distribution) value.
    pub const ContentDistribution = css.DefineEnumProperty(@compileError(css.todo_stuff.errors));

    /// An [`<overflow-position>`](https://www.w3.org/TR/css-align-3/#typedef-overflow-position) value.
    pub const OverflowPosition = css.DefineEnumProperty(@compileError(css.todo_stuff.errors));

    /// A [`<content-position>`](https://www.w3.org/TR/css-align-3/#typedef-content-position) value.
    pub const ContentPosition = css.DefineEnumProperty(@compileError(css.todo_stuff.errors));
};

pub const animation = struct {
    /// A list of animations.
    pub const AnimationList = SmallList(Animation, 1);

    /// A list of animation names.
    pub const AnimationNameList = SmallList(AnimationName, 1);

    /// A value for the [animation](https://drafts.csswg.org/css-animations/#animation) shorthand property.
    pub const Animation = @compileError(css.todo_stuff.depth);

    /// A value for the [animation-name](https://drafts.csswg.org/css-animations/#animation-name) property.
    pub const AnimationName = union(enum) {
        /// The `none` keyword.
        none,
        /// An identifier of a `@keyframes` rule.
        ident: CustomIdent,
        /// A `<string>` name of a `@keyframes` rule.
        string: CSSString,

        // ~toCssImpl
        const This = @This();

        pub fn toCss(this: *const This, comptime W: type, dest: *Printer(W)) PrintErr!void {
            _ = this; // autofix
            _ = dest; // autofix
            @compileError(css.todo_stuff.depth);
        }
    };

    /// A value for the [animation-iteration-count](https://drafts.csswg.org/css-animations/#animation-iteration-count) property.
    pub const AnimationIterationCount = union(enum) {
        /// The animation will repeat the specified number of times.
        number: CSSNumber,
        /// The animation will repeat forever.
        infinite,
    };

    /// A value for the [animation-direction](https://drafts.csswg.org/css-animations/#animation-direction) property.
    pub const AnimationDirection = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

    /// A value for the [animation-play-state](https://drafts.csswg.org/css-animations/#animation-play-state) property.
    pub const AnimationPlayState = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

    /// A value for the [animation-fill-mode](https://drafts.csswg.org/css-animations/#animation-fill-mode) property.
    pub const AnimationFillMode = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

    /// A value for the [animation-composition](https://drafts.csswg.org/css-animations-2/#animation-composition) property.
    pub const AnimationComposition = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

    /// A value for the [animation-timeline](https://drafts.csswg.org/css-animations-2/#animation-timeline) property.
    pub const AnimationTimeline = union(enum) {
        /// The animation's timeline is a DocumentTimeline, more specifically the default document timeline.
        auto,
        /// The animation is not associated with a timeline.
        none,
        /// A timeline referenced by name.
        dashed_ident: DashedIdent,
        /// The scroll() function.
        scroll: ScrollTimeline,
        /// The view() function.
        view: ViewTimeline,
    };

    /// The [scroll()](https://drafts.csswg.org/scroll-animations-1/#scroll-notation) function.
    pub const ScrollTimeline = struct {
        /// Specifies which element to use as the scroll container.
        scroller: Scroller,
        /// Specifies which axis of the scroll container to use as the progress for the timeline.
        axis: ScrollAxis,
    };

    /// The [view()](https://drafts.csswg.org/scroll-animations-1/#view-notation) function.
    pub const ViewTimeline = struct {
        /// Specifies which axis of the scroll container to use as the progress for the timeline.
        axis: ScrollAxis,
        /// Provides an adjustment of the view progress visibility range.
        inset: Size2D(LengthPercentageOrAuto),
    };

    /// A scroller, used in the `scroll()` function.
    pub const Scroller = @compileError(css.todo_stuff.depth);

    /// A scroll axis, used in the `scroll()` function.
    pub const ScrollAxis = @compileError(css.todo_stuff.depth);

    /// A value for the animation-range shorthand property.
    pub const AnimationRange = struct {
        /// The start of the animation's attachment range.
        start: animation.AnimationRangeStart,
        /// The end of the animation's attachment range.
        end: animation.AnimationRangeEnd,
    };

    /// A value for the [animation-range-start](https://drafts.csswg.org/scroll-animations/#animation-range-start) property.
    pub const AnimationRangeStart = struct {
        v: AnimationAttachmentRange,
    };

    /// A value for the [animation-range-end](https://drafts.csswg.org/scroll-animations/#animation-range-start) property.
    pub const AnimationRangeEnd = struct {
        v: AnimationAttachmentRange,
    };

    /// A value for the [animation-range-start](https://drafts.csswg.org/scroll-animations/#animation-range-start)
    /// or [animation-range-end](https://drafts.csswg.org/scroll-animations/#animation-range-end) property.
    pub const AnimationAttachmentRange = union(enum) {
        /// The start of the animation's attachment range is the start of its associated timeline.
        normal,
        /// The animation attachment range starts at the specified point on the timeline measuring from the start of the timeline.
        length_percentage: LengthPercentage,
        /// The animation attachment range starts at the specified point on the timeline measuring from the start of the specified named timeline range.
        timeline_range: struct {
            /// The name of the timeline range.
            name: TimelineRangeName,
            /// The offset from the start of the named timeline range.
            offset: LengthPercentage,
        },
    };

    /// A [view progress timeline range](https://drafts.csswg.org/scroll-animations/#view-timelines-ranges)
    pub const TimelineRangeName = enum {
        /// Represents the full range of the view progress timeline.
        cover,
        /// Represents the range during which the principal box is either fully contained by,
        /// or fully covers, its view progress visibility range within the scrollport.
        contain,
        /// Represents the range during which the principal box is entering the view progress visibility range.
        entry,
        /// Represents the range during which the principal box is exiting the view progress visibility range.
        exit,
        /// Represents the range during which the principal box crosses the end border edge.
        entry_crossing,
        /// Represents the range during which the principal box crosses the start border edge.
        exit_crossing,
    };
};

pub const background = struct {
    /// A value for the [background](https://www.w3.org/TR/css-backgrounds-3/#background) shorthand property.
    pub const Background = struct {
        /// The background image.
        image: Image,
        /// The background color.
        color: CssColor,
        /// The background position.
        position: BackgroundPosition,
        /// How the background image should repeat.
        repeat: background.BackgroundRepeat,
        /// The size of the background image.
        size: background.BackgroundSize,
        /// The background attachment.
        attachment: BackgroundAttachment,
        /// The background origin.
        origin: BackgroundOrigin,
        /// How the background should be clipped.
        clip: BackgroundClip,
    };

    /// A value for the [background-size](https://www.w3.org/TR/css-backgrounds-3/#background-size) property.
    pub const BackgroundSize = union(enum) {
        /// An explicit background size.
        explicit: struct {
            /// The width of the background.
            width: css.css_values.length.LengthPercentage,
            /// The height of the background.
            height: css.css_values.length.LengthPercentageOrAuto,
        },
        /// The `cover` keyword. Scales the background image to cover both the width and height of the element.
        cover,
        /// The `contain` keyword. Scales the background image so that it fits within the element.
        contain,
    };

    /// A value for the [background-position](https://drafts.csswg.org/css-backgrounds/#background-position) shorthand property.
    pub const BackgroundPosition = css.DefineListShorthand(struct {
        comptime {
            @compileError(css.todo_stuff.depth);
        }
    });

    /// A value for the [background-repeat](https://www.w3.org/TR/css-backgrounds-3/#background-repeat) property.
    pub const BackgroundRepeat = struct {
        /// A repeat style for the x direction.
        x: BackgroundRepeatKeyword,
        /// A repeat style for the y direction.
        y: BackgroundRepeatKeyword,
    };

    /// A [`<repeat-style>`](https://www.w3.org/TR/css-backgrounds-3/#typedef-repeat-style) value,
    /// used within the `background-repeat` property to represent how a background image is repeated
    /// in a single direction.
    ///
    /// See [BackgroundRepeat](BackgroundRepeat).
    pub const BackgroundRepeatKeyword = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

    /// A value for the [background-attachment](https://www.w3.org/TR/css-backgrounds-3/#background-attachment) property.
    pub const BackgroundAttachment = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

    /// A value for the [background-origin](https://www.w3.org/TR/css-backgrounds-3/#background-origin) property.
    pub const BackgroundOrigin = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

    /// A value for the [background-clip](https://drafts.csswg.org/css-backgrounds-4/#background-clip) property.
    pub const BackgroundClip = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

    pub const BoxSizing = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

    /// A value for the [aspect-ratio](https://drafts.csswg.org/css-sizing-4/#aspect-ratio) property.
    pub const AspectRatio = struct {
        /// The `auto` keyword.
        auto: bool,
        /// A preferred aspect ratio for the box, specified as width / height.
        ratio: ?css_values.ratio.Ratio,
    };
};

pub const border = struct {
    /// A value for the [border-top](https://www.w3.org/TR/css-backgrounds-3/#propdef-border-top) shorthand property.
    pub const BorderTop = GenericBorder(LineStyle, 0);
    /// A value for the [border-right](https://www.w3.org/TR/css-backgrounds-3/#propdef-border-right) shorthand property.
    pub const BorderRight = GenericBorder(LineStyle, 1);
    /// A value for the [border-bottom](https://www.w3.org/TR/css-backgrounds-3/#propdef-border-bottom) shorthand property.
    pub const BorderBottom = GenericBorder(LineStyle, 2);
    /// A value for the [border-left](https://www.w3.org/TR/css-backgrounds-3/#propdef-border-left) shorthand property.
    pub const BorderLeft = GenericBorder(LineStyle, 3);
    /// A value for the [border-block-start](https://drafts.csswg.org/css-logical/#propdef-border-block-start) shorthand property.
    pub const BorderBlockStart = GenericBorder(LineStyle, 4);
    /// A value for the [border-block-end](https://drafts.csswg.org/css-logical/#propdef-border-block-end) shorthand property.
    pub const BorderBlockEnd = GenericBorder(LineStyle, 5);
    /// A value for the [border-inline-start](https://drafts.csswg.org/css-logical/#propdef-border-inline-start) shorthand property.
    pub const BorderInlineStart = GenericBorder(LineStyle, 6);
    /// A value for the [border-inline-end](https://drafts.csswg.org/css-logical/#propdef-border-inline-end) shorthand property.
    pub const BorderInlineEnd = GenericBorder(LineStyle, 7);
    /// A value for the [border-block](https://drafts.csswg.org/css-logical/#propdef-border-block) shorthand property.
    pub const BorderBlock = GenericBorder(LineStyle, 8);
    /// A value for the [border-inline](https://drafts.csswg.org/css-logical/#propdef-border-inline) shorthand property.
    pub const BorderInline = GenericBorder(LineStyle, 9);
    /// A value for the [border](https://www.w3.org/TR/css-backgrounds-3/#propdef-border) shorthand property.
    pub const Border = GenericBorder(LineStyle, 10);

    /// A generic type that represents the `border` and `outline` shorthand properties.
    pub fn GenericBorder(comptime S: type, comptime P: u8) type {
        _ = P; // autofix
        return struct {
            /// The width of the border.
            width: BorderSideWidth,
            /// The border style.
            style: S,
            /// The border color.
            color: CssColor,
        };
    }
    /// A [`<line-style>`](https://drafts.csswg.org/css-backgrounds/#typedef-line-style) value, used in the `border-style` property.
    pub const LineStyle = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

    /// A value for the [border-width](https://www.w3.org/TR/css-backgrounds-3/#border-width) property.
    pub const BorderSideWith = union(enum) {
        /// A UA defined `thin` value.
        thin,
        /// A UA defined `medium` value.
        medium,
        /// A UA defined `thick` value.
        thick,
        /// An explicit width.
        length: Length,
    };

    /// A value for the [border-color](https://drafts.csswg.org/css-backgrounds/#propdef-border-color) shorthand property.
    pub const BorderColor = @compileError(css.todo_stuff.depth);

    /// A value for the [border-style](https://drafts.csswg.org/css-backgrounds/#propdef-border-style) shorthand property.
    pub const BorderStyle = @compileError(css.todo_stuff.depth);

    /// A value for the [border-width](https://drafts.csswg.org/css-backgrounds/#propdef-border-width) shorthand property.
    pub const BorderWidth = @compileError(css.todo_stuff.depth);

    /// A value for the [border-block-color](https://drafts.csswg.org/css-logical/#propdef-border-block-color) shorthand property.
    pub const BorderBlockColor = @compileError(css.todo_stuff.depth);

    /// A value for the [border-block-width](https://drafts.csswg.org/css-logical/#propdef-border-block-width) shorthand property.
    pub const BorderBlockWidth = @compileError(css.todo_stuff.depth);

    /// A value for the [border-inline-color](https://drafts.csswg.org/css-logical/#propdef-border-inline-color) shorthand property.
    pub const BorderInlineColor = @compileError(css.todo_stuff.depth);

    /// A value for the [border-inline-style](https://drafts.csswg.org/css-logical/#propdef-border-inline-style) shorthand property.
    pub const BorderInlineStyle = @compileError(css.todo_stuff.depth);

    /// A value for the [border-inline-width](https://drafts.csswg.org/css-logical/#propdef-border-inline-width) shorthand property.
    pub const BorderInlineWidth = @compileError(css.todo_stuff.depth);
};

pub const border_image = struct {
    /// A value for the [border-image](https://www.w3.org/TR/css-backgrounds-3/#border-image) shorthand property.
    pub const BorderImage = @compileError(css.todo_stuff.depth);

    /// A value for the [border-image-repeat](https://www.w3.org/TR/css-backgrounds-3/#border-image-repeat) property.
    const BorderImageRepeat = struct {
        /// The horizontal repeat value.
        horizontal: BorderImageRepeatKeyword,
        /// The vertical repeat value.
        vertical: BorderImageRepeatKeyword,
    };

    /// A value for the [border-image-width](https://www.w3.org/TR/css-backgrounds-3/#border-image-width) property.
    pub const BorderImageSideWidth = union(enum) {
        /// A number representing a multiple of the border width.
        number: CSSNumber,
        /// An explicit length or percentage.
        length_percentage: LengthPercentage,
        /// The `auto` keyword, representing the natural width of the image slice.
        auto: void,
    };

    const BorderImageRepeatKeyword = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

    /// A value for the [border-image-slice](https://www.w3.org/TR/css-backgrounds-3/#border-image-slice) property.
    const BorderImageSlice = struct {
        /// The offsets from the edges of the image.
        offsets: Rect(NumberOrPercentage),
        /// Whether the middle of the border image should be preserved.
        fill: bool,
    };
};

pub const border_radius = struct {
    /// A value for the [border-radius](https://www.w3.org/TR/css-backgrounds-3/#border-radius) property.
    pub const BorderRadius = @compileError(css.todo_stuff.depth);
};

pub const box_shadow = struct {
    /// A value for the [box-shadow](https://drafts.csswg.org/css-backgrounds/#box-shadow) property.
    pub const BoxShadow = struct {
        /// The color of the box shadow.
        color: CssColor,
        /// The x offset of the shadow.
        x_offset: Length,
        /// The y offset of the shadow.
        y_offset: Length,
        /// The blur radius of the shadow.
        blur: Length,
        /// The spread distance of the shadow.
        spread: Length,
        /// Whether the shadow is inset within the box.
        inset: bool,
    };
};

pub const contain = struct {
    const ContainerIdent = ContainerName;
    /// A value for the [container-type](https://drafts.csswg.org/css-contain-3/#container-type) property.
    /// Establishes the element as a query container for the purpose of container queries.
    pub const ContainerType = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

    /// A value for the [container-name](https://drafts.csswg.org/css-contain-3/#container-name) property.
    pub const ContainerNameList = union(enum) {
        /// The `none` keyword.
        none,
        /// A list of container names.
        names: SmallList(ContainerIdent, 1),
    };

    /// A value for the [container](https://drafts.csswg.org/css-contain-3/#container-shorthand) shorthand property.
    pub const Container = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));
};

pub const css_modules = struct {
    /// A value for the [composes](https://github.com/css-modules/css-modules/#dependencies) property from CSS modules.
    pub const Composes = struct {
        /// A list of class names to compose.
        names: CustomIdentList,
        /// Where the class names are composed from.
        from: ?Specifier,
        /// The source location of the `composes` property.
        loc: Location,
    };

    /// Defines where the class names referenced in the `composes` property are located.
    ///
    /// See [Composes](Composes).
    const Specifier = union(enum) {
        /// The referenced name is global.
        global,
        /// The referenced name comes from the specified file.
        file: []const u8,
        /// The referenced name comes from a source index (used during bundling).
        source_index: u32,

        pub fn parse(input: *css.Parser) Error!Specifier {
            if (input.tryParse(css.Parser.expectString, .{})) |file| {
                return .{ .file = file };
            }
            try input.expectIdentMatching("global");
            return .global;
        }
    };
};

pub const display = struct {
    /// A value for the [display](https://drafts.csswg.org/css-display-3/#the-display-properties) property.
    pub const Display = union(enum) {
        /// A display keyword.
        keyword: DisplayKeyword,
        /// The inside and outside display values.
        pair: DisplayPair,
    };

    /// A value for the [visibility](https://drafts.csswg.org/css-display-3/#visibility) property.
    pub const Visibility = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

    pub const DisplayKeyword = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

    /// A pair of inside and outside display values, as used in the `display` property.
    ///
    /// See [Display](Display).
    pub const DisplayPair = struct {
        /// The outside display value.
        outside: DisplayOutside,
        /// The inside display value.
        inside: DisplayInside,
        /// Whether this is a list item.
        is_list_item: bool,
    };

    /// A [`<display-outside>`](https://drafts.csswg.org/css-display-3/#typedef-display-outside) value.
    pub const DisplayOutside = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));
    /// A [`<display-inside>`](https://drafts.csswg.org/css-display-3/#typedef-display-inside) value.
    pub const DisplayInside = union(enum) {
        flow,
        flow_root,
        table,
        flex: css.VendorPrefix,
        box: css.VendorPrefix,
        grid,
        ruby,
    };
};

pub const effects = struct {
    /// A value for the [filter](https://drafts.fxtf.org/filter-effects-1/#FilterProperty) and
    /// [backdrop-filter](https://drafts.fxtf.org/filter-effects-2/#BackdropFilterProperty) properties.
    pub const FilterList = union(enum) {
        /// The `none` keyword.
        none,
        /// A list of filter functions.
        filters: SmallList(Filter, 1),
    };

    /// A [filter](https://drafts.fxtf.org/filter-effects-1/#filter-functions) function.
    pub const Filter = union(enum) {
        /// A `blur()` filter.
        blur: Length,
        /// A `brightness()` filter.
        brightness: NumberOrPercentage,
        /// A `contrast()` filter.
        contrast: NumberOrPercentage,
        /// A `grayscale()` filter.
        grayscale: NumberOrPercentage,
        /// A `hue-rotate()` filter.
        hue_rotate: Angle,
        /// An `invert()` filter.
        invert: NumberOrPercentage,
        /// An `opacity()` filter.
        opacity: NumberOrPercentage,
        /// A `saturate()` filter.
        saturate: NumberOrPercentage,
        /// A `sepia()` filter.
        sepia: NumberOrPercentage,
        /// A `drop-shadow()` filter.
        drop_shadow: DropShadow,
        /// A `url()` reference to an SVG filter.
        url: Url,
    };

    /// A [`drop-shadow()`](https://drafts.fxtf.org/filter-effects-1/#funcdef-filter-drop-shadow) filter function.
    pub const DropShadow = struct {
        /// The color of the drop shadow.
        color: CssColor,
        /// The x offset of the drop shadow.
        x_offset: Length,
        /// The y offset of the drop shadow.
        y_offset: Length,
        /// The blur radius of the drop shadow.
        blur: Length,
    };
};

pub const flex = struct {
    /// A value for the [flex-direction](https://www.w3.org/TR/2018/CR-css-flexbox-1-20181119/#propdef-flex-direction) property.
    pub const FlexDirection = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

    /// A value for the [flex-wrap](https://www.w3.org/TR/2018/CR-css-flexbox-1-20181119/#flex-wrap-property) property.
    pub const FlexWrap = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

    /// A value for the [flex-flow](https://www.w3.org/TR/2018/CR-css-flexbox-1-20181119/#flex-flow-property) shorthand property.
    pub const FlexFlow = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

    /// A value for the [flex](https://www.w3.org/TR/2018/CR-css-flexbox-1-20181119/#flex-property) shorthand property.
    pub const Flex = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

    /// A value for the legacy (prefixed) [box-orient](https://www.w3.org/TR/2009/WD-css3-flexbox-20090723/#orientation) property.
    /// Partially equivalent to `flex-direction` in the standard syntax.
    pub const BoxOrient = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

    /// A value for the legacy (prefixed) [box-orient](https://www.w3.org/TR/2009/WD-css3-flexbox-20090723/#orientation) property.
    /// Partially equivalent to `flex-direction` in the standard syntax.
    pub const BoxDirection = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

    /// A value for the legacy (prefixed) [box-align](https://www.w3.org/TR/2009/WD-css3-flexbox-20090723/#alignment) property.
    /// Equivalent to the `align-items` property in the standard syntax.
    pub const BoxAlign = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

    /// A value for the legacy (prefixed) [box-pack](https://www.w3.org/TR/2009/WD-css3-flexbox-20090723/#packing) property.
    /// Equivalent to the `justify-content` property in the standard syntax.
    pub const BoxPack = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

    /// A value for the legacy (prefixed) [box-lines](https://www.w3.org/TR/2009/WD-css3-flexbox-20090723/#multiple) property.
    /// Equivalent to the `flex-wrap` property in the standard syntax.
    pub const BoxLines = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

    // Old flex (2012): https://www.w3.org/TR/2012/WD-css3-flexbox-20120322/
    /// A value for the legacy (prefixed) [flex-pack](https://www.w3.org/TR/2012/WD-css3-flexbox-20120322/#flex-pack) property.
    /// Equivalent to the `justify-content` property in the standard syntax.
    pub const FlexPack = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

    /// A value for the legacy (prefixed) [flex-item-align](https://www.w3.org/TR/2012/WD-css3-flexbox-20120322/#flex-align) property.
    /// Equivalent to the `align-self` property in the standard syntax.
    pub const FlexItemAlign = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

    /// A value for the legacy (prefixed) [flex-line-pack](https://www.w3.org/TR/2012/WD-css3-flexbox-20120322/#flex-line-pack) property.
    /// Equivalent to the `align-content` property in the standard syntax.
    pub const FlexLinePack = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));
};

pub const list = struct {
    /// A value for the [list-style-type](https://www.w3.org/TR/2020/WD-css-lists-3-20201117/#text-markers) property.
    pub const ListStyleType = union(enum) {
        /// No marker.
        none,
        /// An explicit marker string.
        string: CSSString,
        /// A named counter style.
        counter_style: CounterStyle,
    };

    /// A [counter-style](https://www.w3.org/TR/css-counter-styles-3/#typedef-counter-style) name.
    pub const CounterStyle = union(enum) {
        /// A predefined counter style name.
        predefined: PredefinedCounterStyle,
        /// A custom counter style name.
        name: CustomIdent,
        /// An inline `symbols()` definition.
        symbols: Symbols,

        const Symbols = struct {
            /// The counter system.
            system: SymbolsType,
            /// The symbols.
            symbols: ArrayList(Symbol),
        };
    };

    /// A single [symbol](https://www.w3.org/TR/css-counter-styles-3/#funcdef-symbols) as used in the
    /// `symbols()` function.
    ///
    /// See [CounterStyle](CounterStyle).
    const Symbol = union(enum) {
        /// A string.
        string: CSSString,
        /// An image.
        image: Image,
    };

    /// A [predefined counter](https://www.w3.org/TR/css-counter-styles-3/#predefined-counters) style.
    pub const PredefinedCounterStyle = @compileError(css.todo_stuff.depth);

    /// A [`<symbols-type>`](https://www.w3.org/TR/css-counter-styles-3/#typedef-symbols-type) value,
    /// as used in the `symbols()` function.
    ///
    /// See [CounterStyle](CounterStyle).
    pub const SymbolsType = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

    /// A value for the [list-style-position](https://www.w3.org/TR/2020/WD-css-lists-3-20201117/#list-style-position-property) property.
    pub const ListStylePosition = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

    /// A value for the [list-style](https://www.w3.org/TR/2020/WD-css-lists-3-20201117/#list-style-property) shorthand property.
    pub const ListStyle = @compileError(css.todo_stuff.depth);

    /// A value for the [marker-side](https://www.w3.org/TR/2020/WD-css-lists-3-20201117/#marker-side) property.
    pub const MarkerSide = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));
};

pub const margin_padding = struct {
    /// A value for the [inset-block](https://drafts.csswg.org/css-logical/#propdef-inset-block) shorthand property.
    pub const InsetBlock = @compileError(css.todo_stuff.depth);
    /// A value for the [inset-inline](https://drafts.csswg.org/css-logical/#propdef-inset-inline) shorthand property.
    pub const InsetInline = @compileError(css.todo_stuff.depth);
    /// A value for the [inset](https://drafts.csswg.org/css-logical/#propdef-inset) shorthand property.
    pub const Inline = @compileError(css.todo_stuff.depth);

    /// A value for the [margin-block](https://drafts.csswg.org/css-logical/#propdef-margin-block) shorthand property.
    pub const MarginBlock = @compileError(css.todo_stuff.depth);

    /// A value for the [margin-inline](https://drafts.csswg.org/css-logical/#propdef-margin-inline) shorthand property.
    pub const MarginInline = @compileError(css.todo_stuff.depth);

    /// A value for the [margin](https://drafts.csswg.org/css-box-4/#propdef-margin) shorthand property.
    pub const Margin = @compileError(css.todo_stuff.depth);

    /// A value for the [padding-block](https://drafts.csswg.org/css-logical/#propdef-padding-block) shorthand property.
    pub const PaddingBlock = @compileError(css.todo_stuff.depth);

    /// A value for the [padding-inline](https://drafts.csswg.org/css-logical/#propdef-padding-inline) shorthand property.
    pub const PaddingInline = @compileError(css.todo_stuff.depth);

    /// A value for the [padding](https://drafts.csswg.org/css-box-4/#propdef-padding) shorthand property.
    pub const Padding = @compileError(css.todo_stuff.depth);

    /// A value for the [scroll-margin-block](https://drafts.csswg.org/css-scroll-snap/#propdef-scroll-margin-block) shorthand property.
    pub const ScrollMarginBlock = @compileError(css.todo_stuff.depth);

    /// A value for the [scroll-margin-inline](https://drafts.csswg.org/css-scroll-snap/#propdef-scroll-margin-inline) shorthand property.
    pub const ScrollMarginInline = @compileError(css.todo_stuff.depth);

    /// A value for the [scroll-margin](https://drafts.csswg.org/css-scroll-snap/#scroll-margin) shorthand property.
    pub const ScrollMargin = @compileError(css.todo_stuff.depth);

    /// A value for the [scroll-padding-block](https://drafts.csswg.org/css-scroll-snap/#propdef-scroll-padding-block) shorthand property.
    pub const ScrollPaddingBlock = @compileError(css.todo_stuff.depth);

    /// A value for the [scroll-padding-inline](https://drafts.csswg.org/css-scroll-snap/#propdef-scroll-padding-inline) shorthand property.
    pub const ScrollPaddingInline = @compileError(css.todo_stuff.depth);

    /// A value for the [scroll-padding](https://drafts.csswg.org/css-scroll-snap/#scroll-padding) shorthand property.
    pub const ScrollPadding = @compileError(css.todo_stuff.depth);
};

pub const masking = struct {
    /// A value for the [clip-path](https://www.w3.org/TR/css-masking-1/#the-clip-path) property.
    const ClipPath = union(enum) {
        /// No clip path.
        None,
        /// A url reference to an SVG path element.
        Url: Url,
        /// A basic shape, positioned according to the reference box.
        Shape: struct {
            /// A basic shape.
            // todo_stuff.think_about_mem_mgmt
            shape: *BasicShape,
            /// A reference box that the shape is positioned according to.
            reference_box: masking.GeometryBox,
        },
        /// A reference box.
        Box: masking.GeometryBox,
    };

    /// A [`<geometry-box>`](https://www.w3.org/TR/css-masking-1/#typedef-geometry-box) value
    /// as used in the `mask-clip` and `clip-path` properties.
    const GeometryBox = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

    /// A CSS [`<basic-shape>`](https://www.w3.org/TR/css-shapes-1/#basic-shape-functions) value.
    const BasicShape = union(enum) {
        /// An inset rectangle.
        Inset: InsetRect,
        /// A circle.
        Circle: Circle,
        /// An ellipse.
        Ellipse: Ellipse,
        /// A polygon.
        Polygon: Polygon,
    };

    /// An [`inset()`](https://www.w3.org/TR/css-shapes-1/#funcdef-inset) rectangle shape.
    const InsetRect = struct {
        /// The rectangle.
        rect: Rect(LengthPercentage),
        /// A corner radius for the rectangle.
        radius: BorderRadius,
    };

    /// A [`circle()`](https://www.w3.org/TR/css-shapes-1/#funcdef-circle) shape.
    pub const Circle = struct {
        /// The radius of the circle.
        radius: ShapeRadius,
        /// The position of the center of the circle.
        position: Position,
    };

    /// An [`ellipse()`](https://www.w3.org/TR/css-shapes-1/#funcdef-ellipse) shape.
    pub const Ellipse = struct {
        /// The x-radius of the ellipse.
        radius_x: ShapeRadius,
        /// The y-radius of the ellipse.
        radius_y: ShapeRadius,
        /// The position of the center of the ellipse.
        position: Position,
    };

    /// A [`polygon()`](https://www.w3.org/TR/css-shapes-1/#funcdef-polygon) shape.
    pub const Polygon = struct {
        /// The fill rule used to determine the interior of the polygon.
        fill_rule: FillRule,
        /// The points of each vertex of the polygon.
        points: ArrayList(Point),
    };

    /// A [`<shape-radius>`](https://www.w3.org/TR/css-shapes-1/#typedef-shape-radius) value
    /// that defines the radius of a `circle()` or `ellipse()` shape.
    pub const ShapeRadius = union(enum) {
        /// An explicit length or percentage.
        LengthPercentage: LengthPercentage,
        /// The length from the center to the closest side of the box.
        ClosestSide,
        /// The length from the center to the farthest side of the box.
        FarthestSide,
    };

    /// A point within a `polygon()` shape.
    ///
    /// See [Polygon](Polygon).
    pub const Point = struct {
        /// The x position of the point.
        x: LengthPercentage,
        /// The y position of the point.
        y: LengthPercentage,
    };

    /// A value for the [mask-mode](https://www.w3.org/TR/css-masking-1/#the-mask-mode) property.
    const MaskMode = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

    /// A value for the [mask-clip](https://www.w3.org/TR/css-masking-1/#the-mask-clip) property.
    const MaskClip = union(enum) {
        /// A geometry box.
        GeometryBox: masking.GeometryBox,
        /// The painted content is not clipped.
        NoClip,
    };

    /// A value for the [mask-composite](https://www.w3.org/TR/css-masking-1/#the-mask-composite) property.
    pub const MaskComposite = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

    /// A value for the [mask-type](https://www.w3.org/TR/css-masking-1/#the-mask-type) property.
    pub const MaskType = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

    /// A value for the [mask](https://www.w3.org/TR/css-masking-1/#the-mask) shorthand property.
    pub const Mask = @compileError(css.todo_stuff.depth);

    /// A value for the [mask-border-mode](https://www.w3.org/TR/css-masking-1/#the-mask-border-mode) property.
    pub const MaskBorderMode = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

    /// A value for the [mask-border](https://www.w3.org/TR/css-masking-1/#the-mask-border) shorthand property.
    pub const MaskBorder = @compileError(css.todo_stuff.depth);

    /// A value for the [-webkit-mask-composite](https://developer.mozilla.org/en-US/docs/Web/CSS/-webkit-mask-composite)
    /// property.
    ///
    /// See also [MaskComposite](MaskComposite).
    pub const WebKitMaskComposite = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

    /// A value for the [-webkit-mask-source-type](https://github.com/WebKit/WebKit/blob/6eece09a1c31e47489811edd003d1e36910e9fd3/Source/WebCore/css/CSSProperties.json#L6578-L6587)
    /// property.
    ///
    /// See also [MaskMode](MaskMode).
    pub const WebKitMaskSourceType = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));
};

pub const outline = struct {
    /// A value for the [outline](https://drafts.csswg.org/css-ui/#outline) shorthand property.
    pub const Outline = border.GenericBorder(outline.OutlineStyle, 11);

    /// A value for the [outline-style](https://drafts.csswg.org/css-ui/#outline-style) property.
    pub const OutlineStyle = union(enum) {
        /// The `auto` keyword.
        auto: void,
        /// A value equivalent to the `border-style` property.
        line_style: border.LineStyle,
    };
};

pub const overflow = struct {
    /// A value for the [overflow](https://www.w3.org/TR/css-overflow-3/#overflow-properties) shorthand property.
    pub const Overflow = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));
    /// An [overflow](https://www.w3.org/TR/css-overflow-3/#overflow-properties) keyword
    /// as used in the `overflow-x`, `overflow-y`, and `overflow` properties.
    pub const OverflowKeyword = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));
    /// A value for the [text-overflow](https://www.w3.org/TR/css-overflow-3/#text-overflow) property.
    pub const TextOverflow = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));
};

pub const position = struct {
    /// A value for the [position](https://www.w3.org/TR/css-position-3/#position-property) property.
    pub const Position = union(enum) {
        /// The box is laid in the document flow.
        static,
        /// The box is laid out in the document flow and offset from the resulting position.
        relative,
        /// The box is taken out of document flow and positioned in reference to its relative ancestor.
        absolute,
        /// Similar to relative but adjusted according to the ancestor scrollable element.
        sticky: css.VendorPrefix,
        /// The box is taken out of the document flow and positioned in reference to the page viewport.
        fixed,
    };
};

pub const shape = struct {
    /// A [`<fill-rule>`](https://www.w3.org/TR/css-shapes-1/#typedef-fill-rule) used to
    /// determine the interior of a `polygon()` shape.
    ///
    /// See [Polygon](Polygon).
    pub const FillRule = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

    /// A CSS [`<alpha-value>`](https://www.w3.org/TR/css-color-4/#typedef-alpha-value),
    /// used to represent opacity.
    ///
    /// Parses either a `<number>` or `<percentage>`, but is always stored and serialized as a number.
    pub const AlphaValue = struct {
        v: f32,
    };
};

pub const size = struct {
    pub const Size = union(enum) {
        /// The `auto` keyworda
        auto,
        /// An explicit length or percentage.
        length_percentage: css_values.length.LengthPercentage,
        /// The `min-content` keyword.
        min_content: css.VendorPrefix,
        /// The `max-content` keyword.
        max_content: css.VendorPrefix,
        /// The `fit-content` keyword.
        fit_content: css.VendorPrefix,
        /// The `fit-content()` function.
        fit_content_function: css_values.length.LengthPercentage,
        /// The `stretch` keyword, or the `-webkit-fill-available` or `-moz-available` prefixed keywords.
        stretch: css.VendorPrefix,
        /// The `contain` keyword.
        contain,
    };

    /// A value for the [minimum](https://drafts.csswg.org/css-sizing-3/#min-size-properties)
    /// and [maximum](https://drafts.csswg.org/css-sizing-3/#max-size-properties) size properties,
    /// e.g. `min-width` and `max-height`.
    pub const MaxSize = union(enum) {
        /// The `none` keyword.
        none,
        /// An explicit length or percentage.
        length_percentage: LengthPercentage,
        /// The `min-content` keyword.
        min_content: css.VendorPrefix,
        /// The `max-content` keyword.
        max_content: css.VendorPrefix,
        /// The `fit-content` keyword.
        fit_content: css.VendorPrefix,
        /// The `fit-content()` function.
        fit_content_function: LengthPercentage,
        /// The `stretch` keyword, or the `-webkit-fill-available` or `-moz-available` prefixed keywords.
        stretch: css.VendorPrefix,
        /// The `contain` keyword.
        contain,
    };
};

pub const svg = struct {
    /// An SVG [`<paint>`](https://www.w3.org/TR/SVG2/painting.html#SpecifyingPaint) value
    /// used in the `fill` and `stroke` properties.
    const SVGPaint = union(enum) {
        /// A URL reference to a paint server element, e.g. `linearGradient`, `radialGradient`, and `pattern`.
        Url: struct {
            /// The url of the paint server.
            url: Url,
            /// A fallback to be used in case the paint server cannot be resolved.
            fallback: ?SVGPaintFallback,
        },
        /// A solid color paint.
        Color: CssColor,
        /// Use the paint value of fill from a context element.
        ContextFill,
        /// Use the paint value of stroke from a context element.
        ContextStroke,
        /// No paint.
        None,
    };

    /// A fallback for an SVG paint in case a paint server `url()` cannot be resolved.
    ///
    /// See [SVGPaint](SVGPaint).
    const SVGPaintFallback = union(enum) {
        /// No fallback.
        None,
        /// A solid color.
        Color: CssColor,
    };

    /// A value for the [stroke-linecap](https://www.w3.org/TR/SVG2/painting.html#LineCaps) property.
    pub const StrokeLinecap = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

    /// A value for the [stroke-linejoin](https://www.w3.org/TR/SVG2/painting.html#LineJoin) property.
    pub const StrokeLinejoin = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

    /// A value for the [stroke-dasharray](https://www.w3.org/TR/SVG2/painting.html#StrokeDashing) property.
    const StrokeDasharray = union(enum) {
        /// No dashing is used.
        None,
        /// Specifies a dashing pattern to use.
        Values: ArrayList(LengthPercentage),
    };

    /// A value for the [marker](https://www.w3.org/TR/SVG2/painting.html#VertexMarkerProperties) properties.
    const Marker = union(enum) {
        /// No marker.
        None,
        /// A url reference to a `<marker>` element.
        Url: Url,
    };

    /// A value for the [color-interpolation](https://www.w3.org/TR/SVG2/painting.html#ColorInterpolation) property.
    pub const ColorInterpolation = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

    /// A value for the [color-rendering](https://www.w3.org/TR/SVG2/painting.html#ColorRendering) property.
    pub const ColorRendering = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

    /// A value for the [shape-rendering](https://www.w3.org/TR/SVG2/painting.html#ShapeRendering) property.
    pub const ShapeRendering = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

    /// A value for the [text-rendering](https://www.w3.org/TR/SVG2/painting.html#TextRendering) property.
    pub const TextRendering = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

    /// A value for the [image-rendering](https://www.w3.org/TR/SVG2/painting.html#ImageRendering) property.
    pub const ImageRendering = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));
};

pub const text = struct {
    /// A value for the [text-transform](https://www.w3.org/TR/2021/CRD-css-text-3-20210422/#text-transform-property) property.
    pub const TextTransform = struct {
        /// How case should be transformed.
        case: TextTransformCase,
        /// How ideographic characters should be transformed.
        other: TextTransformOther,
    };

    pub const TextTransformOther = packed struct(u8) {
        /// Puts all typographic character units in full-width form.
        full_width: bool = false,
        /// Converts all small Kana characters to the equivalent full-size Kana.
        full_size_kana: bool = false,
    };

    /// Defines how text case should be transformed in the
    /// [text-transform](https://www.w3.org/TR/2021/CRD-css-text-3-20210422/#text-transform-property) property.
    const TextTransformCase = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

    /// A value for the [white-space](https://www.w3.org/TR/2021/CRD-css-text-3-20210422/#white-space-property) property.
    pub const WhiteSpace = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

    /// A value for the [word-break](https://www.w3.org/TR/2021/CRD-css-text-3-20210422/#word-break-property) property.
    pub const WordBreak = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

    /// A value for the [line-break](https://www.w3.org/TR/2021/CRD-css-text-3-20210422/#line-break-property) property.
    pub const LineBreak = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

    /// A value for the [hyphens](https://www.w3.org/TR/2021/CRD-css-text-3-20210422/#hyphenation) property.
    pub const Hyphens = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

    /// A value for the [overflow-wrap](https://www.w3.org/TR/2021/CRD-css-text-3-20210422/#overflow-wrap-property) property.
    pub const OverflowWrap = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

    /// A value for the [text-align](https://www.w3.org/TR/2021/CRD-css-text-3-20210422/#text-align-property) property.
    pub const TextAlign = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

    /// A value for the [text-align-last](https://www.w3.org/TR/2021/CRD-css-text-3-20210422/#text-align-last-property) property.
    pub const TextAlignLast = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

    /// A value for the [text-justify](https://www.w3.org/TR/2021/CRD-css-text-3-20210422/#text-justify-property) property.
    pub const TextJustify = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

    /// A value for the [word-spacing](https://www.w3.org/TR/2021/CRD-css-text-3-20210422/#word-spacing-property)
    /// and [letter-spacing](https://www.w3.org/TR/2021/CRD-css-text-3-20210422/#letter-spacing-property) properties.
    pub const Spacing = union(enum) {
        /// No additional spacing is applied.
        normal,
        /// Additional spacing between each word or letter.
        length: Length,
    };

    /// A value for the [text-indent](https://www.w3.org/TR/2021/CRD-css-text-3-20210422/#text-indent-property) property.
    pub const TextIndent = struct {
        /// The amount to indent.
        value: LengthPercentage,
        /// Inverts which lines are affected.
        hanging: bool,
        /// Affects the first line after each hard break.
        each_line: bool,
    };

    /// A value for the [text-decoration-line](https://www.w3.org/TR/2020/WD-css-text-decor-4-20200506/#text-decoration-line-property) property.
    ///
    /// Multiple lines may be specified by combining the flags.
    pub const TextDecorationLine = packed struct(u8) {
        /// Each line of text is underlined.
        underline: bool = false,
        /// Each line of text has a line over it.
        overline: bool = false,
        /// Each line of text has a line through the middle.
        line_through: bool = false,
        /// The text blinks.
        blink: bool = false,
        /// The text is decorated as a spelling error.
        spelling_error: bool = false,
        /// The text is decorated as a grammar error.
        grammar_error: bool = false,
    };

    /// A value for the [text-decoration-style](https://www.w3.org/TR/2020/WD-css-text-decor-4-20200506/#text-decoration-style-property) property.
    pub const TextDecorationStyle = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

    /// A value for the [text-decoration-thickness](https://www.w3.org/TR/2020/WD-css-text-decor-4-20200506/#text-decoration-width-property) property.
    pub const TextDecorationThickness = union(enum) {
        /// The UA chooses an appropriate thickness for text decoration lines.
        auto,
        /// Use the thickness defined in the current font.
        from_font,
        /// An explicit length.
        length_percentage: LengthPercentage,
    };

    /// A value for the [text-decoration](https://www.w3.org/TR/2020/WD-css-text-decor-4-20200506/#text-decoration-property) shorthand property.
    pub const TextDecoration = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

    /// A value for the [text-decoration-skip-ink](https://www.w3.org/TR/2020/WD-css-text-decor-4-20200506/#text-decoration-skip-ink-property) property.
    pub const TextDecorationSkipInk = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

    /// A text emphasis shape for the [text-emphasis-style](https://www.w3.org/TR/2020/WD-css-text-decor-4-20200506/#text-emphasis-style-property) property.
    ///
    /// See [TextEmphasisStyle](TextEmphasisStyle).
    pub const TextEmphasisStyle = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

    /// A value for the [text-emphasis](https://www.w3.org/TR/2020/WD-css-text-decor-4-20200506/#text-emphasis-property) shorthand property.
    pub const TextEmphasis = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

    /// A value for the [text-emphasis-position](https://www.w3.org/TR/2020/WD-css-text-decor-4-20200506/#text-emphasis-position-property) property.
    pub const TextEmphasisPosition = struct {
        /// The vertical position.
        vertical: text.TextEmphasisPositionVertical,
        /// The horizontal position.
        horizontal: text.TextEmphasisPositionHorizontal,
    };

    /// A vertical position keyword for the [text-emphasis-position](https://www.w3.org/TR/2020/WD-css-text-decor-4-20200506/#text-emphasis-position-property) property.
    ///
    /// See [TextEmphasisPosition](TextEmphasisPosition).
    pub const TextEmphasisPositionVertical = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

    /// A horizontal position keyword for the [text-emphasis-position](https://www.w3.org/TR/2020/WD-css-text-decor-4-20200506/#text-emphasis-position-property) property.
    ///
    /// See [TextEmphasisPosition](TextEmphasisPosition).
    pub const TextEmphasisPositionHorizontal = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

    /// A value for the [text-shadow](https://www.w3.org/TR/2020/WD-css-text-decor-4-20200506/#text-shadow-property) property.
    pub const TextShadow = struct {
        /// The color of the text shadow.
        color: CssColor,
        /// The x offset of the text shadow.
        x_offset: Length,
        /// The y offset of the text shadow.
        y_offset: Length,
        /// The blur radius of the text shadow.
        blur: Length,
        /// The spread distance of the text shadow.
        spread: Length, // added in Level 4 spec
    };

    /// A value for the [text-size-adjust](https://w3c.github.io/csswg-drafts/css-size-adjust/#adjustment-control) property.
    pub const TextSizeAdjust = union(enum) {
        /// Use the default size adjustment when displaying on a small device.
        auto,
        /// No size adjustment when displaying on a small device.
        none,
        /// When displaying on a small device, the font size is multiplied by this percentage.
        percentage: Percentage,
    };

    /// A value for the [direction](https://drafts.csswg.org/css-writing-modes-3/#direction) property.
    pub const Direction = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

    /// A value for the [unicode-bidi](https://drafts.csswg.org/css-writing-modes-3/#unicode-bidi) property.
    pub const UnicodeBidi = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

    /// A value for the [box-decoration-break](https://www.w3.org/TR/css-break-3/#break-decoration) property.
    pub const BoxDecorationBreak = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));
};

pub const transform = struct {
    /// A value for the [transform](https://www.w3.org/TR/2019/CR-css-transforms-1-20190214/#propdef-transform) property.
    pub const TransformList = struct {
        v: ArrayList(Transform),
    };

    /// An individual transform function (https://www.w3.org/TR/2019/CR-css-transforms-1-20190214/#two-d-transform-functions).
    pub const Transform = union(enum) {
        /// A 2D translation.
        translate: struct { x: LengthPercentage, y: LengthPercentage },
        /// A translation in the X direction.
        translate_x: LengthPercentage,
        /// A translation in the Y direction.
        translate_y: LengthPercentage,
        /// A translation in the Z direction.
        translate_z: Length,
        /// A 3D translation.
        translate_3d: struct { x: LengthPercentage, y: LengthPercentage, z: Length },
        /// A 2D scale.
        scale: struct { x: NumberOrPercentage, y: NumberOrPercentage },
        /// A scale in the X direction.
        scale_x: NumberOrPercentage,
        /// A scale in the Y direction.
        scale_y: NumberOrPercentage,
        /// A scale in the Z direction.
        scale_z: NumberOrPercentage,
        /// A 3D scale.
        scale_3d: struct { x: NumberOrPercentage, y: NumberOrPercentage, z: NumberOrPercentage },
        /// A 2D rotation.
        rotate: Angle,
        /// A rotation around the X axis.
        rotate_x: Angle,
        /// A rotation around the Y axis.
        rotate_y: Angle,
        /// A rotation around the Z axis.
        rotate_z: Angle,
        /// A 3D rotation.
        rotate_3d: struct { x: f32, y: f32, z: f32, angle: Angle },
        /// A 2D skew.
        skew: struct { x: Angle, y: Angle },
        /// A skew along the X axis.
        skew_x: Angle,
        /// A skew along the Y axis.
        skew_y: Angle,
        /// A perspective transform.
        perspective: Length,
        /// A 2D matrix transform.
        matrix: Matrix(f32),
        /// A 3D matrix transform.
        matrix_3d: Matrix3d(f32),
    };

    /// A 2D matrix.
    pub fn Matrix(comptime T: type) type {
        return struct {
            a: T,
            b: T,
            c: T,
            d: T,
            e: T,
            f: T,
        };
    }

    /// A 3D matrix.
    pub fn Matrix3d(comptime T: type) type {
        return struct {
            m11: T,
            m12: T,
            m13: T,
            m14: T,
            m21: T,
            m22: T,
            m23: T,
            m24: T,
            m31: T,
            m32: T,
            m33: T,
            m34: T,
            m41: T,
            m42: T,
            m43: T,
            m44: T,
        };
    }

    /// A value for the [transform-style](https://drafts.csswg.org/css-transforms-2/#transform-style-property) property.
    pub const TransformStyle = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

    /// A value for the [transform-box](https://drafts.csswg.org/css-transforms-1/#transform-box) property.
    pub const TransformBox = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

    /// A value for the [backface-visibility](https://drafts.csswg.org/css-transforms-2/#backface-visibility-property) property.
    pub const BackfaceVisibility = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

    /// A value for the perspective property.
    pub const Perspective = union(enum) {
        /// No perspective transform is applied.
        none,
        /// Distance to the center of projection.
        length: Length,
    };

    /// A value for the [translate](https://drafts.csswg.org/css-transforms-2/#propdef-translate) property.
    pub const Translate = union(enum) {
        /// The "none" keyword.
        none,

        /// The x, y, and z translations.
        xyz: struct {
            /// The x translation.
            x: LengthPercentage,
            /// The y translation.
            y: LengthPercentage,
            /// The z translation.
            z: Length,
        },
    };

    /// A value for the [rotate](https://drafts.csswg.org/css-transforms-2/#propdef-rotate) property.
    pub const Rotate = struct {
        /// Rotation around the x axis.
        x: f32,
        /// Rotation around the y axis.
        y: f32,
        /// Rotation around the z axis.
        z: f32,
        /// The angle of rotation.
        angle: Angle,
    };

    /// A value for the [scale](https://drafts.csswg.org/css-transforms-2/#propdef-scale) property.
    pub const Scale = union(enum) {
        /// The "none" keyword.
        none,

        /// Scale on the x, y, and z axis.
        xyz: struct {
            /// Scale on the x axis.
            x: NumberOrPercentage,
            /// Scale on the y axis.
            y: NumberOrPercentage,
            /// Scale on the z axis.
            z: NumberOrPercentage,
        },
    };
};

pub const transition = struct {
    /// A value for the [transition](https://www.w3.org/TR/2018/WD-css-transitions-1-20181011/#transition-shorthand-property) property.
    pub const Transition = @compileError(css.todo_stuff.depth);
};

pub const ui = struct {
    /// A value for the [color-scheme](https://drafts.csswg.org/css-color-adjust/#color-scheme-prop) property.
    pub const ColorScheme = packed struct(u8) {
        /// Indicates that the element supports a light color scheme.
        light: bool = false,
        /// Indicates that the element supports a dark color scheme.
        dark: bool = false,
        /// Forbids the user agent from overriding the color scheme for the element.
        only: bool = false,
    };

    /// A value for the [resize](https://www.w3.org/TR/2021/WD-css-ui-4-20210316/#resize) property.
    pub const Resize = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

    /// A value for the [cursor](https://www.w3.org/TR/2021/WD-css-ui-4-20210316/#cursor) property.
    pub const Cursor = struct {
        /// A list of cursor images.
        images: SmallList(CursorImage),
        /// A pre-defined cursor.
        keyword: CursorKeyword,
    };

    /// A [cursor image](https://www.w3.org/TR/2021/WD-css-ui-4-20210316/#cursor) value, used in the `cursor` property.
    ///
    /// See [Cursor](Cursor).
    pub const CursorImage = struct {
        /// A url to the cursor image.
        url: Url,
        /// The location in the image where the mouse pointer appears.
        hotspot: ?[2]CSSNumber,
    };

    /// A pre-defined [cursor](https://www.w3.org/TR/2021/WD-css-ui-4-20210316/#cursor) value,
    /// used in the `cursor` property.
    ///
    /// See [Cursor](Cursor).
    pub const CursorKeyword = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

    /// A value for the [caret-color](https://www.w3.org/TR/2021/WD-css-ui-4-20210316/#caret-color) property.
    pub const ColorOrAuto = union(enum) {
        /// The `currentColor`, adjusted by the UA to ensure contrast against the background.
        auto,
        /// A color.
        color: CssColor,
    };

    /// A value for the [caret-shape](https://www.w3.org/TR/2021/WD-css-ui-4-20210316/#caret-shape) property.
    pub const CaretShape = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

    /// A value for the [caret](https://www.w3.org/TR/2021/WD-css-ui-4-20210316/#caret) shorthand property.
    pub const Caret = @compileError(css.todo_stuff.depth);

    /// A value for the [user-select](https://www.w3.org/TR/2021/WD-css-ui-4-20210316/#content-selection) property.
    pub const UserSelect = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

    /// A value for the [appearance](https://www.w3.org/TR/2021/WD-css-ui-4-20210316/#appearance-switching) property.
    pub const Appearance = union(enum) {
        none,
        auto,
        textfield,
        menulist_button,
        button,
        checkbox,
        listbox,
        menulist,
        meter,
        progress_bar,
        push_button,
        radio,
        searchfield,
        slider_horizontal,
        square_button,
        textarea,
        non_standard: []const u8,
    };
};

pub fn DefineProperties(comptime properties: anytype) type {
    const input_fields: []const std.builtin.Type.StructField = std.meta.fields(@TypeOf(properties));
    const total_fields_len = input_fields.len + 2; // +2 for the custom property and the `all` property
    const TagSize = u16;
    const PropertyIdT, const max_enum_name_length: usize = brk: {
        var max: usize = 0;
        var property_id_type = std.builtin.Type.Enum{
            .tag_type = TagSize,
            .is_exhaustive = true,
            .decls = &.{},
            .fields = undefined,
        };
        var enum_fields: [total_fields_len]std.builtin.Type.EnumField = undefined;
        for (input_fields, 0..) |field, i| {
            enum_fields[i] = .{
                .name = field.name,
                .value = i,
            };
            max = @max(max, field.name.len);
        }
        enum_fields[input_fields.len] = std.builtin.Type.EnumField{
            .name = "all",
            .value = input_fields.len,
        };
        enum_fields[input_fields.len + 1] = std.builtin.Type.EnumField{
            .name = "custom",
            .value = input_fields.len + 1,
        };
        property_id_type.fields = &enum_fields;
        break :brk .{ property_id_type, max };
    };

    const types: []const type = types: {
        var types: [total_fields_len]type = undefined;
        inline for (input_fields, 0..) |field, i| {
            types[i] = @field(properties, field.name).ty;

            if (std.mem.eql(u8, field.name, "transition-property")) {
                types[i] = struct { SmallList(PropertyIdT, 1), css.VendorPrefix };
            }

            // Validate it

            const value = @field(properties, field.name);
            const ValueT = @TypeOf(value);
            const value_ty = value.ty;
            const ValueTy = @TypeOf(value_ty);
            const value_ty_info = @typeInfo(ValueTy);
            // If `valid_prefixes` is defined, the `ty` should be a two item tuple where
            // the second item is of type `VendorPrefix`
            if (@hasField(ValueT, "valid_prefixes")) {
                if (!value_ty_info.Struct.is_tuple) {
                    @compileError("Expected a tuple type for `ty` when `valid_prefixes` is defined");
                }
                if (value_ty_info.Struct.fields[1].type != css.VendorPrefix) {
                    @compileError("Expected the second item in the tuple to be of type `VendorPrefix`");
                }
            }
        }
        types[input_fields.len] = void;
        types[input_fields.len + 1] = CustomPropertyName;
        break :types &types;
    };
    const PropertyT = PropertyT: {
        var union_fields: [total_fields_len]std.builtin.Type.UnionField = undefined;
        inline for (input_fields, 0..) |input_field, i| {
            const Ty = types[i];
            union_fields[i] = std.builtin.Type.UnionField{
                .alignment = @alignOf(Ty),
                .type = type,
                .name = input_field.name,
            };
        }
        union_fields[input_fields.len] = std.builtin.Type.UnionField{
            .alignment = 0,
            .type = void,
            .name = "all",
        };
        union_fields[input_fields.len + 1] = std.builtin.Type.UnionField{
            .alignment = @alignOf(CustomPropertyName),
            .type = CustomPropertyName,
            .name = "custom",
        };
        break :PropertyT std.builtin.Type.Union{
            .layout = .auto,
            .tag_type = PropertyIdT,
            .decls = &.{},
            .fields = union_fields,
        };
    };
    _ = PropertyT; // autofix
    return struct {
        pub const PropertyId = PropertyIdT;

        pub fn propertyIdEq(lhs: PropertyId, rhs: PropertyId) bool {
            _ = lhs; // autofix
            _ = rhs; // autofix
            @compileError(css.todo_stuff.depth);
        }

        pub fn propertyIdIsShorthand(id: PropertyId) bool {
            inline for (std.meta.fields(PropertyId)) |field| {
                if (field.value == @intFromEnum(id)) {
                    const is_shorthand = if (@hasField(@TypeOf(@field(properties, field.name)), "shorthand"))
                        @field(@field(properties, field.name), "shorthand")
                    else
                        false;
                    return is_shorthand;
                }
            }
            return false;
        }

        /// PropertyId.prefix()
        pub fn propertyIdPrefix(id: PropertyId) css.VendorPrefix {
            _ = id; // autofix
            @compileError(css.todo_stuff.depth);
        }

        /// PropertyId.name()
        pub fn propertyIdName(id: PropertyId) []const u8 {
            _ = id; // autofix
            @compileError(css.todo_stuff.depth);
        }

        pub fn propertyIdFromStr(name: []const u8) PropertyId {
            const prefix, const name_ref = if (bun.strings.startsWithCaseInsensitiveAscii(name, "-webkit-"))
                .{ css.VendorPrefix.webkit, name[8..] }
            else if (bun.strings.startsWithCaseInsensitiveAscii(name, "-moz-"))
                .{ css.VendorPrefix.moz, name[5..] }
            else if (bun.strings.startsWithCaseInsensitiveAscii(name, "-o-"))
                .{ css.VendorPrefix.moz, name[3..] }
            else if (bun.strings.startsWithCaseInsensitiveAscii(name, "-ms-"))
                .{ css.VendorPrefix.moz, name[4..] }
            else
                .{ css.VendorPrefix.none, name };

            return parsePropertyIdFromNameAndPrefix(name_ref, prefix) catch .{
                .custom = CustomPropertyName.fromStr(name),
            };
        }

        pub fn parsePropertyIdFromNameAndPrefix(name: []const u8, prefix: css.VendorPrefix) Error!PropertyId {
            var buffer: [max_enum_name_length]u8 = undefined;
            if (name.len > buffer.len) {
                // TODO: actual source just returns empty Err(())
                return Error.InvalidPropertyName;
            }
            const lower = bun.strings.copyLowercase(name, buffer[0..name.len]);
            inline for (std.meta.fields(PropertyIdT)) |field_| {
                const field: std.builtin.Type.EnumField = field_;
                // skip custom
                if (bun.strings.eql(field.name, "custom")) continue;

                if (bun.strings.eql(lower, field.name)) {
                    const prop = @field(properties, field.name);
                    const allowed_prefixes = allowed_prefixes: {
                        var prefixes: css.VendorPrefix = if (@hasField(@TypeOf(prop), "unprefixed") and !prop.unprefixed)
                            css.VendorPrefix.empty()
                        else
                            css.VendorPrefix{ .none = true };

                        if (@hasField(@TypeOf(prop), "valid_prefixes")) {
                            prefixes = css.VendorPrefix.bitwiseOr(prefixes, prop.valid_prefixes);
                        }

                        break :allowed_prefixes prefixes;
                    };

                    if (allowed_prefixes.contains(prefix)) return @enumFromInt(field.value);
                }
            }
            return Error.InvalidPropertyName;
        }
    };
}

/// SmallList(PropertyId)
const SmallListPropertyIdPlaceholder = struct {};

pub const Property = DefineProperties(.{
    .@"background-color" = .{
        .ty = CssColor,
    },
    .@"background-image" = .{
        // PERF: make this equivalent to SmallVec<[_; 1]>
        .ty = SmallList(Image, 1),
    },
    .@"background-position-x" = .{
        // PERF: make this equivalent to SmallVec<[_; 1]>
        .ty = SmallList(css_values.position.HorizontalPosition, 1),
    },
    .@"background-position-y" = .{
        // PERF: make this equivalent to SmallVec<[_; 1]>
        .ty = SmallList(css_values.position.HorizontalPosition, 1),
    },
    .@"background-position" = .{
        // PERF: make this equivalent to SmallVec<[_; 1]>
        .ty = SmallList(background.BackgroundPosition, 1),
        .shorthand = true,
    },
    .@"background-size" = .{
        // PERF: make this equivalent to SmallVec<[_; 1]>
        .ty = SmallList(background.BackgroundSize, 1),
    },
    .@"background-repeat" = .{
        // PERF: make this equivalent to SmallVec<[_; 1]>
        .ty = SmallList(background.BackgroundSize, 1),
    },
    .@"background-attachment" = .{
        // PERF: make this equivalent to SmallVec<[_; 1]>
        .ty = SmallList(background.BackgroundAttachment, 1),
    },
    .@"background-clip" = .{
        // PERF: make this equivalent to SmallVec<[_; 1]>
        .ty = struct {
            SmallList(background.BackgroundAttachment, 1),
            css.VendorPrefix,
        },
        .valid_prefixes = css.VendorPrefix{
            .webkit = true,
            .moz = true,
        },
    },
    .@"background-origin" = .{
        // PERF: make this equivalent to SmallVec<[_; 1]>
        .ty = SmallList(background.BackgroundOrigin, 1),
    },
    .background = .{
        // PERF: make this equivalent to SmallVec<[_; 1]>
        .ty = SmallList(background.Background, 1),
    },

    .@"box-shadow" = .{
        // PERF: make this equivalent to SmallVec<[_; 1]>
        .ty = struct { SmallList(box_shadow.BoxShadow, 1), css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .webkit = true,
            .moz = true,
        },
    },
    .opacity = .{
        .ty = css.css_values.alpha.AlphaValue,
    },
    .color = .{
        .ty = CssColor,
    },
    .display = .{
        .ty = display.Display,
    },
    .visibility = .{
        .ty = display.Visibility,
    },

    .width = .{
        .ty = size.Size,
        .logical_group = .{ .ty = LogicalGroup.size, .category = PropertyCategory.physical },
    },
    .height = .{
        .ty = size.Size,
        .logical_group = .{ .ty = LogicalGroup.size, .category = PropertyCategory.physical },
    },
    .@"min-width" = .{
        .ty = size.Size,
        .logical_group = .{ .ty = LogicalGroup.min_size, .category = PropertyCategory.physical },
    },
    .@"min-height" = .{
        .ty = size.Size,
        .logical_group = .{ .ty = LogicalGroup.min_size, .category = PropertyCategory.physical },
    },
    .@"max-width" = .{
        .ty = size.MaxSize,
        .logical_group = .{ .ty = LogicalGroup.max_size, .category = PropertyCategory.physical },
    },
    .@"max-height" = .{
        .ty = size.MaxSize,
        .logical_group = .{ .ty = LogicalGroup.max_size, .category = PropertyCategory.physical },
    },
    .@"block-size" = .{
        .ty = size.Size,
        .logical_group = .{ .ty = LogicalGroup.size, .category = PropertyCategory.logical },
    },
    .@"inline-size" = .{
        .ty = size.Size,
        .logical_group = .{ .ty = LogicalGroup.size, .category = PropertyCategory.logical },
    },
    .min_block_size = .{
        .ty = size.Size,
        .logical_group = .{ .ty = LogicalGroup.min_size, .category = PropertyCategory.logical },
    },
    .@"min-inline-size" = .{
        .ty = size.Size,
        .logical_group = .{ .ty = LogicalGroup.min_size, .category = PropertyCategory.logical },
    },
    .@"max-block-size" = .{
        .ty = size.MaxSize,
        .logical_group = .{ .ty = LogicalGroup.max_size, .category = PropertyCategory.logical },
    },
    .@"max-inline-size" = .{
        .ty = size.MaxSize,
        .logical_group = .{ .ty = LogicalGroup.max_size, .category = PropertyCategory.logical },
    },
    .@"box-sizing" = .{
        .ty = struct { size.BoxSizing, css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .webkit = true,
            .moz = true,
        },
    },
    .@"aspect-ratio" = .{
        .ty = size.AspectRatio,
    },

    .overflow = .{
        .ty = overflow.Overflow,
        .shorthand = true,
    },
    .@"overflow-x" = .{
        .ty = overflow.OverflowKeyword,
    },
    .@"overflow-y" = .{
        .ty = overflow.OverflowKeyword,
    },
    .@"text-overflow" = .{
        .ty = struct { overflow.TextOverflow, css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .o = true,
        },
    },

    // https://www.w3.org/TR/2020/WD-css-position-3-20200519
    .position = .{
        .ty = position.Position,
    },
    .top = .{
        .ty = LengthPercentageOrAuto,
        .logical_group = .{ .ty = LogicalGroup.inset, .category = PropertyCategory.physical },
    },
    .bottom = .{
        .ty = LengthPercentageOrAuto,
        .logical_group = .{ .ty = LogicalGroup.inset, .category = PropertyCategory.physical },
    },
    .left = .{
        .ty = LengthPercentageOrAuto,
        .logical_group = .{ .ty = LogicalGroup.inset, .category = PropertyCategory.physical },
    },
    .right = .{
        .ty = LengthPercentageOrAuto,
        .logical_group = .{ .ty = LogicalGroup.inset, .category = PropertyCategory.physical },
    },
    .@"inset-block-start" = .{
        .ty = LengthPercentageOrAuto,
        .logical_group = .{ .ty = LogicalGroup.inset, .category = PropertyCategory.logical },
    },
    .@"inset-block-end" = .{
        .ty = LengthPercentageOrAuto,
        .logical_group = .{ .ty = LogicalGroup.inset, .category = PropertyCategory.logical },
    },
    .@"inset-inline-start" = .{
        .ty = LengthPercentageOrAuto,
        .logical_group = .{ .ty = LogicalGroup.inset, .category = PropertyCategory.logical },
    },
    .@"inset-inline-end" = .{
        .ty = LengthPercentageOrAuto,
        .logical_group = .{ .ty = LogicalGroup.inset, .category = PropertyCategory.logical },
    },
    .@"inset-block" = .{
        .ty = margin_padding.InsetBlock,
        .shorthand = true,
    },
    .@"inset-inline" = .{
        .ty = margin_padding.InsetInline,
        .shorthand = true,
    },
    .inset = .{
        .ty = margin_padding.Inset,
        .shorthand = true,
    },

    .@"border-spacing" = .{
        .ty = css.css_values.size.Size(Length),
    },

    .@"border-top-color" = .{
        .ty = CssColor,
        .logical_group = .{ .ty = LogicalGroup.border_color, .category = PropertyCategory.physical },
    },
    .@"border-bottom-color" = .{
        .ty = CssColor,
        .logical_group = .{ .ty = LogicalGroup.border_color, .category = PropertyCategory.physical },
    },
    .@"border-left-color" = .{
        .ty = CssColor,
        .logical_group = .{ .ty = LogicalGroup.border_color, .category = PropertyCategory.physical },
    },
    .@"border-right-color" = .{
        .ty = CssColor,
        .logical_group = .{ .ty = LogicalGroup.border_color, .category = PropertyCategory.physical },
    },
    .@"border-block-start-color" = .{
        .ty = CssColor,
        .logical_group = .{ .ty = LogicalGroup.border_color, .category = PropertyCategory.logical },
    },
    .@"border-block-end-color" = .{
        .ty = CssColor,
        .logical_group = .{ .ty = LogicalGroup.border_color, .category = PropertyCategory.logical },
    },
    .@"border-inline-start-color" = .{
        .ty = CssColor,
        .logical_group = .{ .ty = LogicalGroup.border_color, .category = PropertyCategory.logical },
    },
    .@"border-inline-end-color" = .{
        .ty = CssColor,
        .logical_group = .{ .ty = LogicalGroup.border_color, .category = PropertyCategory.logical },
    },

    .@"border-top-style" = .{
        .ty = border.LineStyle,
        .logical_group = .{ .ty = LogicalGroup.border_style, .category = PropertyCategory.physical },
    },
    .@"border-bottom-style" = .{
        .ty = border.LineStyle,
        .logical_group = .{ .ty = LogicalGroup.border_style, .category = PropertyCategory.physical },
    },
    .@"border-left-style" = .{
        .ty = border.LineStyle,
        .logical_group = .{ .ty = LogicalGroup.border_style, .category = PropertyCategory.physical },
    },
    .@"border-right-style" = .{
        .ty = border.LineStyle,
        .logical_group = .{ .ty = LogicalGroup.border_style, .category = PropertyCategory.physical },
    },
    .@"border-block-start-style" = .{
        .ty = border.LineStyle,
        .logical_group = .{ .ty = LogicalGroup.border_style, .category = PropertyCategory.logical },
    },
    .@"border-block-end-style" = .{
        .ty = border.LineStyle,
        .logical_group = .{ .ty = LogicalGroup.border_style, .category = PropertyCategory.logical },
    },
    .@"border-inline-start-style" = .{
        .ty = border.LineStyle,
        .logical_group = .{ .ty = LogicalGroup.border_style, .category = PropertyCategory.logical },
    },
    .@"border-inline-end-style" = .{
        .ty = border.LineStyle,
        .logical_group = .{ .ty = LogicalGroup.border_style, .category = PropertyCategory.logical },
    },

    .@"border-top-width" = .{
        .ty = BorderSideWidth,
        .logical_group = .{ .ty = LogicalGroup.border_width, .category = PropertyCategory.physical },
    },
    .@"border-bottom-width" = .{
        .ty = BorderSideWidth,
        .logical_group = .{ .ty = LogicalGroup.border_width, .category = PropertyCategory.physical },
    },
    .@"border-left-width" = .{
        .ty = BorderSideWidth,
        .logical_group = .{ .ty = LogicalGroup.border_width, .category = PropertyCategory.physical },
    },
    .@"border-right-width" = .{
        .ty = BorderSideWidth,
        .logical_group = .{ .ty = LogicalGroup.border_width, .category = PropertyCategory.physical },
    },
    .@"border-block-start-width" = .{
        .ty = BorderSideWidth,
        .logical_group = .{ .ty = LogicalGroup.border_width, .category = PropertyCategory.logical },
    },
    .@"border-block-end-width" = .{
        .ty = BorderSideWidth,
        .logical_group = .{ .ty = LogicalGroup.border_width, .category = PropertyCategory.logical },
    },
    .@"border-inline-start-width" = .{
        .ty = BorderSideWidth,
        .logical_group = .{ .ty = LogicalGroup.border_width, .category = PropertyCategory.logical },
    },
    .@"border-inline-end-width" = .{
        .ty = BorderSideWidth,
        .logical_group = .{ .ty = LogicalGroup.border_width, .category = PropertyCategory.logical },
    },

    .@"border-top-left-radius" = .{
        .ty = struct { Size2D(LengthPercentage), css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .webkit = true,
            .moz = true,
        },
        .logical_group = .{ .ty = LogicalGroup.border_radius, .category = PropertyCategory.physical },
    },
    .@"border-top-right-radius" = .{
        .ty = struct { Size2D(LengthPercentage), css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .webkit = true,
            .moz = true,
        },
        .logical_group = .{ .ty = LogicalGroup.border_radius, .category = PropertyCategory.physical },
    },
    .@"border-bottom-left-radius" = .{
        .ty = struct { Size2D(LengthPercentage), css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .webkit = true,
            .moz = true,
        },
        .logical_group = .{ .ty = LogicalGroup.border_radius, .category = PropertyCategory.physical },
    },
    .@"border-bottom-right-radius" = .{
        .ty = struct { Size2D(LengthPercentage), css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .webkit = true,
            .moz = true,
        },
        .logical_group = .{ .ty = LogicalGroup.border_radius, .category = PropertyCategory.physical },
    },
    .@"border-start-start-radius" = .{
        .ty = Size2D(LengthPercentage),
        .logical_group = .{ .ty = LogicalGroup.border_radius, .category = PropertyCategory.logical },
    },
    .@"border-start-end-radius" = .{
        .ty = Size2D(LengthPercentage),
        .logical_group = .{ .ty = LogicalGroup.border_radius, .category = PropertyCategory.logical },
    },
    .@"border-end-start-radius" = .{
        .ty = Size2D(LengthPercentage),
        .logical_group = .{ .ty = LogicalGroup.border_radius, .category = PropertyCategory.logical },
    },
    .@"border-end-end-radius" = .{
        .ty = Size2D(LengthPercentage),
        .logical_group = .{ .ty = LogicalGroup.border_radius, .category = PropertyCategory.logical },
    },
    .@"border-radius" = .{
        .ty = struct { BorderRadius, css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .webkit = true,
            .moz = true,
        },
        .shorthand = true,
    },

    .@"border-image-source" = .{
        .ty = Image,
    },
    .@"border-image-outset" = .{
        .ty = Rect(LengthOrNumber),
    },
    .@"border-image-repeat" = .{
        .ty = BorderImageRepeat,
    },
    .@"border-image-width" = .{
        .ty = Rect(BorderImageSideWidth),
    },
    .@"border-image-slice" = .{
        .ty = BorderImageSlice,
    },
    .@"border-image" = .{
        .ty = struct { BorderImage, css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .webkit = true,
            .moz = true,
            .o = true,
        },
        .shorthand = true,
    },

    .@"border-color" = .{
        .ty = BorderColor,
        .shorthand = true,
    },
    .@"border-style" = .{
        .ty = BorderStyle,
        .shorthand = true,
    },
    .@"border-width" = .{
        .ty = BorderWidth,
        .shorthand = true,
    },

    .@"border-block-color" = .{
        .ty = BorderBlockColor,
        .shorthand = true,
    },
    .@"border-block-style" = .{
        .ty = BorderBlockStyle,
        .shorthand = true,
    },
    .@"border-block-width" = .{
        .ty = BorderBlockWidth,
        .shorthand = true,
    },

    .@"border-inline-color" = .{
        .ty = BorderInlineColor,
        .shorthand = true,
    },
    .@"border-inline-style" = .{
        .ty = BorderInlineStyle,
        .shorthand = true,
    },
    .@"border-inline-width" = .{
        .ty = BorderInlineWidth,
        .shorthand = true,
    },

    .border = .{
        .ty = Border,
        .shorthand = true,
    },
    .@"border-top" = .{
        .ty = BorderTop,
        .shorthand = true,
    },
    .@"border-bottom" = .{
        .ty = BorderBottom,
        .shorthand = true,
    },
    .@"border-left" = .{
        .ty = BorderLeft,
        .shorthand = true,
    },
    .@"border-right" = .{
        .ty = BorderRight,
        .shorthand = true,
    },
    .@"border-block" = .{
        .ty = BorderBlock,
        .shorthand = true,
    },
    .@"border-block-start" = .{
        .ty = BorderBlockStart,
        .shorthand = true,
    },
    .@"border-block-end" = .{
        .ty = BorderBlockEnd,
        .shorthand = true,
    },
    .@"border-inline" = .{
        .ty = BorderInline,
        .shorthand = true,
    },
    .@"border-inline-start" = .{
        .ty = BorderInlineStart,
        .shorthand = true,
    },
    .@"border-inline-end" = .{
        .ty = BorderInlineEnd,
        .shorthand = true,
    },

    .outline = .{
        .ty = Outline,
        .shorthand = true,
    },
    .@"outline-color" = .{
        .ty = CssColor,
    },
    .@"outline-style" = .{
        .ty = OutlineStyle,
    },
    .@"outline-width" = .{
        .ty = BorderSideWidth,
    },

    // Flex properties: https://www.w3.org/TR/2018/CR-css-flexbox-1-20181119
    .@"flex-direction" = .{
        .ty = struct { FlexDirection, css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .webkit = true,
            .ms = true,
        },
    },
    .@"flex-wrap" = .{
        .ty = struct { FlexWrap, css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .webkit = true,
            .ms = true,
        },
    },
    .@"flex-flow" = .{
        .ty = struct { FlexFlow, css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .webkit = true,
            .ms = true,
        },
        .shorthand = true,
    },
    .@"flex-grow" = .{
        .ty = struct { CSSNumber, css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .webkit = true,
        },
    },
    .@"flex-shrink" = .{
        .ty = struct { CSSNumber, css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .webkit = true,
        },
    },
    .@"flex-basis" = .{
        .ty = struct { LengthPercentageOrAuto, css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .webkit = true,
        },
    },
    .flex = .{
        .ty = struct { Flex, css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .webkit = true,
            .ms = true,
        },
        .shorthand = true,
    },
    .order = .{
        .ty = struct { CSSInteger, css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .webkit = true,
        },
    },

    // Align properties: https://www.w3.org/TR/2020/WD-css-align-3-20200421
    .@"align-content" = .{
        .ty = struct { AlignContent, css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .webkit = true,
        },
    },
    .@"justify-content" = .{
        .ty = struct { JustifyContent, css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .webkit = true,
        },
    },
    .@"place-content" = .{
        .ty = PlaceContent,
        .shorthand = true,
    },
    .@"align-self" = .{
        .ty = struct { AlignSelf, css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .webkit = true,
        },
    },
    .@"justify-self" = .{
        .ty = JustifySelf,
    },
    .@"place-self" = .{
        .ty = PlaceSelf,
        .shorthand = true,
    },
    .@"align-items" = .{
        .ty = struct { AlignItems, css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .webkit = true,
        },
    },
    .@"justify-items" = .{
        .ty = JustifyItems,
    },
    .@"place-items" = .{
        .ty = PlaceItems,
        .shorthand = true,
    },
    .@"row-gap" = .{
        .ty = GapValue,
    },
    .@"column-gap" = .{
        .ty = GapValue,
    },
    .gap = .{
        .ty = Gap,
        .shorthand = true,
    },

    // Old flex (2009): https://www.w3.org/TR/2009/WD-css3-flexbox-20090723/
    .@"box-orient" = .{
        .ty = struct { BoxOrient, css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .webkit = true,
            .moz = true,
        },
        .unprefixed = false,
    },
    .@"box-direction" = .{
        .ty = struct { BoxDirection, css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .webkit = true,
            .moz = true,
        },
        .unprefixed = false,
    },
    .@"box-ordinal-group" = .{
        .ty = struct { CSSInteger, css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .webkit = true,
            .moz = true,
        },
        .unprefixed = false,
    },
    .@"box-align" = .{
        .ty = struct { BoxAlign, css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .webkit = true,
            .moz = true,
        },
        .unprefixed = false,
    },
    .@"box-flex" = .{
        .ty = struct { CSSNumber, css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .webkit = true,
            .moz = true,
        },
        .unprefixed = false,
    },
    .@"box-flex-group" = .{
        .ty = struct { CSSInteger, css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .webkit = true,
        },
        .unprefixed = false,
    },
    .@"box-pack" = .{
        .ty = struct { BoxPack, css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .webkit = true,
            .moz = true,
        },
        .unprefixed = false,
    },
    .@"box-lines" = .{
        .ty = struct { BoxLines, css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .webkit = true,
            .moz = true,
        },
        .unprefixed = false,
    },

    // Old flex (2012): https://www.w3.org/TR/2012/WD-css3-flexbox-20120322/
    .@"flex-pack" = .{
        .ty = struct { FlexPack, css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .ms = true,
        },
        .unprefixed = false,
    },
    .@"flex-order" = .{
        .ty = struct { CSSInteger, css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .ms = true,
        },
        .unprefixed = false,
    },
    .@"flex-align" = .{
        .ty = struct { BoxAlign, css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .ms = true,
        },
        .unprefixed = false,
    },
    .@"flex-item-align" = .{
        .ty = struct { FlexItemAlign, css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .ms = true,
        },
        .unprefixed = false,
    },
    .@"flex-line-pack" = .{
        .ty = struct { FlexLinePack, css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .ms = true,
        },
        .unprefixed = false,
    },

    // Microsoft extensions
    .@"flex-positive" = .{
        .ty = struct { CSSNumber, css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .ms = true,
        },
        .unprefixed = false,
    },
    .@"flex-negative" = .{
        .ty = struct { CSSNumber, css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .ms = true,
        },
        .unprefixed = false,
    },
    .@"flex-preferred-size" = .{
        .ty = struct { LengthPercentageOrAuto, css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .ms = true,
        },
        .unprefixed = false,
    },

    // TODO: the following is enabled with #[cfg(feature = "grid")]
    // .@"grid-template-columns" = .{
    //     .ty = TrackSizing,
    // },
    // .@"grid-template-rows" = .{
    //     .ty = TrackSizing,
    // },
    // .@"grid-auto-columns" = .{
    //     .ty = TrackSizeList,
    // },
    // .@"grid-auto-rows" = .{
    //     .ty = TrackSizeList,
    // },
    // .@"grid-auto-flow" = .{
    //     .ty = GridAutoFlow,
    // },
    // .@"grid-template-areas" = .{
    //     .ty = GridTemplateAreas,
    // },
    // .@"grid-template" = .{
    //     .ty = GridTemplate,
    //     .shorthand = true,
    // },
    // .grid = .{
    //     .ty = Grid,
    //     .shorthand = true,
    // },
    // .@"grid-row-start" = .{
    //     .ty = GridLine,
    // },
    // .@"grid-row-end" = .{
    //     .ty = GridLine,
    // },
    // .@"grid-column-start" = .{
    //     .ty = GridLine,
    // },
    // .@"grid-column-end" = .{
    //     .ty = GridLine,
    // },
    // .@"grid-row" = .{
    //     .ty = GridRow,
    //     .shorthand = true,
    // },
    // .@"grid-column" = .{
    //     .ty = GridColumn,
    //     .shorthand = true,
    // },
    // .@"grid-area" = .{
    //     .ty = GridArea,
    //     .shorthand = true,
    // },

    .@"margin-top" = .{
        .ty = LengthPercentageOrAuto,
        .logical_group = .{ .ty = LogicalGroup.margin, .category = PropertyCategory.physical },
    },
    .@"margin-bottom" = .{
        .ty = LengthPercentageOrAuto,
        .logical_group = .{ .ty = LogicalGroup.margin, .category = PropertyCategory.physical },
    },
    .@"margin-left" = .{
        .ty = LengthPercentageOrAuto,
        .logical_group = .{ .ty = LogicalGroup.margin, .category = PropertyCategory.physical },
    },
    .@"margin-right" = .{
        .ty = LengthPercentageOrAuto,
        .logical_group = .{ .ty = LogicalGroup.margin, .category = PropertyCategory.physical },
    },
    .@"margin-block-start" = .{
        .ty = LengthPercentageOrAuto,
        .logical_group = .{ .ty = LogicalGroup.margin, .category = PropertyCategory.logical },
    },
    .@"margin-block-end" = .{
        .ty = LengthPercentageOrAuto,
        .logical_group = .{ .ty = LogicalGroup.margin, .category = PropertyCategory.logical },
    },
    .@"margin-inline-start" = .{
        .ty = LengthPercentageOrAuto,
        .logical_group = .{ .ty = LogicalGroup.margin, .category = PropertyCategory.logical },
    },
    .@"margin-inline-end" = .{
        .ty = LengthPercentageOrAuto,
        .logical_group = .{ .ty = LogicalGroup.margin, .category = PropertyCategory.logical },
    },
    .@"margin-block" = .{
        .ty = MarginBlock,
        .shorthand = true,
    },
    .@"margin-inline" = .{
        .ty = MarginInline,
        .shorthand = true,
    },
    .margin = .{
        .ty = Margin,
        .shorthand = true,
    },

    .@"padding-top" = .{
        .ty = LengthPercentageOrAuto,
        .logical_group = .{ .ty = LogicalGroup.padding, .category = PropertyCategory.physical },
    },
    .@"padding-bottom" = .{
        .ty = LengthPercentageOrAuto,
        .logical_group = .{ .ty = LogicalGroup.padding, .category = PropertyCategory.physical },
    },
    .@"padding-left" = .{
        .ty = LengthPercentageOrAuto,
        .logical_group = .{ .ty = LogicalGroup.padding, .category = PropertyCategory.physical },
    },
    .@"padding-right" = .{
        .ty = LengthPercentageOrAuto,
        .logical_group = .{ .ty = LogicalGroup.padding, .category = PropertyCategory.physical },
    },
    .@"padding-block-start" = .{
        .ty = LengthPercentageOrAuto,
        .logical_group = .{ .ty = LogicalGroup.padding, .category = PropertyCategory.logical },
    },
    .@"padding-block-end" = .{
        .ty = LengthPercentageOrAuto,
        .logical_group = .{ .ty = LogicalGroup.padding, .category = PropertyCategory.logical },
    },
    .@"padding-inline-start" = .{
        .ty = LengthPercentageOrAuto,
        .logical_group = .{ .ty = LogicalGroup.padding, .category = PropertyCategory.logical },
    },
    .@"padding-inline-end" = .{
        .ty = LengthPercentageOrAuto,
        .logical_group = .{ .ty = LogicalGroup.padding, .category = PropertyCategory.logical },
    },
    .@"padding-block" = .{
        .ty = PaddingBlock,
        .shorthand = true,
    },
    .@"padding-inline" = .{
        .ty = PaddingInline,
        .shorthand = true,
    },
    .padding = .{
        .ty = Padding,
        .shorthand = true,
    },

    .@"scroll-margin-top" = .{
        .ty = LengthPercentageOrAuto,
        .logical_group = .{ .ty = LogicalGroup.scroll_margin, .category = PropertyCategory.physical },
    },
    .@"scroll-margin-bottom" = .{
        .ty = LengthPercentageOrAuto,
        .logical_group = .{ .ty = LogicalGroup.scroll_margin, .category = PropertyCategory.physical },
    },
    .@"scroll-margin-left" = .{
        .ty = LengthPercentageOrAuto,
        .logical_group = .{ .ty = LogicalGroup.scroll_margin, .category = PropertyCategory.physical },
    },
    .@"scroll-margin-right" = .{
        .ty = LengthPercentageOrAuto,
        .logical_group = .{ .ty = LogicalGroup.scroll_margin, .category = PropertyCategory.physical },
    },
    .@"scroll-margin-block-start" = .{
        .ty = LengthPercentageOrAuto,
        .logical_group = .{ .ty = LogicalGroup.scroll_margin, .category = PropertyCategory.logical },
    },
    .@"scroll-margin-block-end" = .{
        .ty = LengthPercentageOrAuto,
        .logical_group = .{ .ty = LogicalGroup.scroll_margin, .category = PropertyCategory.logical },
    },
    .@"scroll-margin-inline-start" = .{
        .ty = LengthPercentageOrAuto,
        .logical_group = .{ .ty = LogicalGroup.scroll_margin, .category = PropertyCategory.logical },
    },
    .@"scroll-margin-inline-end" = .{
        .ty = LengthPercentageOrAuto,
        .logical_group = .{ .ty = LogicalGroup.scroll_margin, .category = PropertyCategory.logical },
    },
    .@"scroll-margin-block" = .{
        .ty = ScrollMarginBlock,
        .shorthand = true,
    },
    .@"scroll-margin-inline" = .{
        .ty = ScrollMarginInline,
        .shorthand = true,
    },
    .@"scroll-margin" = .{
        .ty = ScrollMargin,
        .shorthand = true,
    },

    .@"scroll-padding-top" = .{
        .ty = LengthPercentageOrAuto,
        .logical_group = .{ .ty = LogicalGroup.scroll_padding, .category = PropertyCategory.physical },
    },
    .@"scroll-padding-bottom" = .{
        .ty = LengthPercentageOrAuto,
        .logical_group = .{ .ty = LogicalGroup.scroll_padding, .category = PropertyCategory.physical },
    },
    .@"scroll-padding-left" = .{
        .ty = LengthPercentageOrAuto,
        .logical_group = .{ .ty = LogicalGroup.scroll_padding, .category = PropertyCategory.physical },
    },
    .@"scroll-padding-right" = .{
        .ty = LengthPercentageOrAuto,
        .logical_group = .{ .ty = LogicalGroup.scroll_padding, .category = PropertyCategory.physical },
    },
    .@"scroll-padding-block-start" = .{
        .ty = LengthPercentageOrAuto,
        .logical_group = .{ .ty = LogicalGroup.scroll_padding, .category = PropertyCategory.logical },
    },
    .@"scroll-padding-block-end" = .{
        .ty = LengthPercentageOrAuto,
        .logical_group = .{ .ty = LogicalGroup.scroll_padding, .category = PropertyCategory.logical },
    },
    .@"scroll-padding-inline-start" = .{
        .ty = LengthPercentageOrAuto,
        .logical_group = .{ .ty = LogicalGroup.scroll_padding, .category = PropertyCategory.logical },
    },
    .@"scroll-padding-inline-end" = .{
        .ty = LengthPercentageOrAuto,
        .logical_group = .{ .ty = LogicalGroup.scroll_padding, .category = PropertyCategory.logical },
    },
    .@"scroll-padding-block" = .{
        .ty = ScrollPaddingBlock,
        .shorthand = true,
    },
    .@"scroll-padding-inline" = .{
        .ty = ScrollPaddingInline,
        .shorthand = true,
    },
    .@"scroll-padding" = .{
        .ty = ScrollPadding,
        .shorthand = true,
    },

    .@"font-weight" = .{
        .ty = FontWeight,
    },
    .@"font-size" = .{
        .ty = FontSize,
    },
    .@"font-stretch" = .{
        .ty = FontStretch,
    },
    .@"font-family" = .{
        .ty = ArrayList(FontFamily),
    },
    .@"font-style" = .{
        .ty = FontStyle,
    },
    .@"font-variant-caps" = .{
        .ty = FontVariantCaps,
    },
    .@"line-height" = .{
        .ty = LineHeight,
    },
    .font = .{
        .ty = Font,
        .shorthand = true,
    },
    .@"vertical-align" = .{
        .ty = VerticalAlign,
    },
    .@"font-palette" = .{
        .ty = DashedIdentReference,
    },

    .@"transition-property" = .{
        .ty = struct { SmallListPropertyIdPlaceholder, css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .webkit = true,
            .moz = true,
            .ms = true,
        },
    },
    .@"transition-duration" = .{
        .ty = struct { SmallList(Time, 1), css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .webkit = true,
            .moz = true,
            .ms = true,
        },
    },
    .@"transition-delay" = .{
        .ty = struct { SmallList(Time, 1), css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .webkit = true,
            .moz = true,
            .ms = true,
        },
    },
    .@"transition-timing-function" = .{
        .ty = struct { SmallList(EasingFunction, 1), css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .webkit = true,
            .moz = true,
            .ms = true,
        },
    },
    .transition = .{
        .ty = struct { SmallList(Transition, 1), css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .webkit = true,
            .moz = true,
            .ms = true,
        },
        .shorthand = true,
    },

    .@"animation-name" = .{
        .ty = struct { AnimationNameList, css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .webkit = true,
            .moz = true,
            .o = true,
        },
    },
    .@"animation-duration" = .{
        .ty = struct { SmallList(Time, 1), css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .webkit = true,
            .moz = true,
            .o = true,
        },
    },
    .@"animation-timing-function" = .{
        .ty = struct { SmallList(EasingFunction, 1), css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .webkit = true,
            .moz = true,
            .o = true,
        },
    },
    .@"animation-iteration-count" = .{
        .ty = struct { SmallList(AnimationIterationCount, 1), css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .webkit = true,
            .moz = true,
            .o = true,
        },
    },
    .@"animation-direction" = .{
        .ty = struct { SmallList(AnimationDirection, 1), css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .webkit = true,
            .moz = true,
            .o = true,
        },
    },
    .@"animation-play-state" = .{
        .ty = struct { SmallList(AnimationPlayState, 1), css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .webkit = true,
            .moz = true,
            .o = true,
        },
    },
    .@"animation-delay" = .{
        .ty = struct { SmallList(Time, 1), css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .webkit = true,
            .moz = true,
            .o = true,
        },
    },
    .@"animation-fill-mode" = .{
        .ty = struct { SmallList(AnimationFillMode, 1), css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .webkit = true,
            .moz = true,
            .o = true,
        },
    },
    .@"animation-composition" = .{
        .ty = SmallList(AnimationComposition, 1),
    },
    .@"animation-timeline" = .{
        .ty = SmallList(AnimationTimeline, 1),
    },
    .@"animation-range-start" = .{
        .ty = SmallList(AnimationRangeStart, 1),
    },
    .@"animation-range-end" = .{
        .ty = SmallList(AnimationRangeEnd, 1),
    },
    .@"animation-range" = .{
        .ty = SmallList(AnimationRange, 1),
    },
    .animation = .{
        .ty = struct { AnimationList, css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .webkit = true,
            .moz = true,
            .o = true,
        },
        .shorthand = true,
    },

    // https://drafts.csswg.org/css-transforms-2/
    .transform = .{
        .ty = struct { TransformList, css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .webkit = true,
            .moz = true,
            .ms = true,
            .o = true,
        },
    },
    .@"transform-origin" = .{
        .ty = struct { Position, css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .webkit = true,
            .moz = true,
            .ms = true,
            .o = true,
        },
        // TODO: handle z offset syntax
    },
    .@"transform-style" = .{
        .ty = struct { TransformStyle, css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .webkit = true,
            .moz = true,
        },
    },
    .@"transform-box" = .{
        .ty = TransformBox,
    },
    .@"backface-visibility" = .{
        .ty = struct { BackfaceVisibility, css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .webkit = true,
            .moz = true,
        },
    },
    .perspective = .{
        .ty = struct { Perspective, css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .webkit = true,
            .moz = true,
        },
    },
    .@"perspective-origin" = .{
        .ty = struct { Position, css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .webkit = true,
            .moz = true,
        },
    },
    .translate = .{
        .ty = Translate,
    },
    .rotate = .{
        .ty = Rotate,
    },
    .scale = .{
        .ty = Scale,
    },

    // https://www.w3.org/TR/2021/CRD-css-text-3-20210422
    .@"text-transform" = .{
        .ty = TextTransform,
    },
    .@"white-space" = .{
        .ty = WhiteSpace,
    },
    .@"tab-size" = .{
        .ty = struct { LengthOrNumber, css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .moz = true,
            .o = true,
        },
    },
    .@"word-break" = .{
        .ty = WordBreak,
    },
    .@"line-break" = .{
        .ty = LineBreak,
    },
    .hyphens = .{
        .ty = struct { Hyphens, css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .webkit = true,
            .moz = true,
            .ms = true,
        },
    },
    .@"overflow-wrap" = .{
        .ty = OverflowWrap,
    },
    .@"word-wrap" = .{
        .ty = OverflowWrap,
    },
    .@"text-align" = .{
        .ty = TextAlign,
    },
    .@"text-align-last" = .{
        .ty = struct { TextAlignLast, css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .moz = true,
        },
    },
    .@"text-justify" = .{
        .ty = TextJustify,
    },
    .@"word-spacing" = .{
        .ty = Spacing,
    },
    .@"letter-spacing" = .{
        .ty = Spacing,
    },
    .@"text-indent" = .{
        .ty = TextIndent,
    },

    // https://www.w3.org/TR/2020/WD-css-text-decor-4-20200506
    .@"text-decoration-line" = .{
        .ty = struct { TextDecorationLine, css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .webkit = true,
            .moz = true,
        },
    },
    .@"text-decoration-style" = .{
        .ty = struct { TextDecorationStyle, css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .webkit = true,
            .moz = true,
        },
    },
    .@"text-decoration-color" = .{
        .ty = struct { CssColor, css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .webkit = true,
            .moz = true,
        },
    },
    .@"text-decoration-thickness" = .{
        .ty = TextDecorationThickness,
    },
    .@"text-decoration" = .{
        .ty = struct { TextDecoration, css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .webkit = true,
            .moz = true,
        },
        .shorthand = true,
    },
    .@"text-decoration-skip-ink" = .{
        .ty = struct { TextDecorationSkipInk, css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .webkit = true,
        },
    },
    .@"text-emphasis-style" = .{
        .ty = struct { TextEmphasisStyle, css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .webkit = true,
        },
    },
    .@"text-emphasis-color" = .{
        .ty = struct { CssColor, css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .webkit = true,
        },
    },
    .@"text-emphasis" = .{
        .ty = struct { TextEmphasis, css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .webkit = true,
        },
        .shorthand = true,
    },
    .@"text-emphasis-position" = .{
        .ty = struct { TextEmphasisPosition, css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .webkit = true,
        },
    },
    .@"text-shadow" = .{
        .ty = SmallList(TextShadow, 1),
    },

    // https://w3c.github.io/csswg-drafts/css-size-adjust/
    .@"text-size-adjust" = .{
        .ty = struct { TextSizeAdjust, css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .webkit = true,
            .moz = true,
            .ms = true,
        },
    },

    // https://drafts.csswg.org/css-writing-modes-3/
    .direction = .{
        .ty = Direction,
    },
    .@"unicode-bidi" = .{
        .ty = UnicodeBidi,
    },

    // https://www.w3.org/TR/css-break-3/
    .@"box-decoration-break" = .{
        .ty = struct { BoxDecorationBreak, css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .webkit = true,
        },
    },

    // https://www.w3.org/TR/2021/WD-css-ui-4-20210316
    .resize = .{
        .ty = Resize,
    },
    .cursor = .{
        .ty = Cursor,
    },
    .@"caret-color" = .{
        .ty = ColorOrAuto,
    },
    .@"caret-shape" = .{
        .ty = CaretShape,
    },
    .caret = .{
        .ty = Caret,
        .shorthand = true,
    },
    .@"user-select" = .{
        .ty = struct { UserSelect, css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .webkit = true,
            .moz = true,
            .ms = true,
        },
    },
    .@"accent-color" = .{
        .ty = ColorOrAuto,
    },
    .appearance = .{
        .ty = struct { Appearance, css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .webkit = true,
            .moz = true,
            .ms = true,
        },
    },

    // https://www.w3.org/TR/2020/WD-css-lists-3-20201117
    .@"list-style-type" = .{
        .ty = ListStyleType,
    },
    .@"list-style-image" = .{
        .ty = Image,
    },
    .@"list-style-position" = .{
        .ty = ListStylePosition,
    },
    .@"list-style" = .{
        .ty = ListStyle,
        .shorthand = true,
    },
    .@"marker-side" = .{
        .ty = MarkerSide,
    },

    // CSS modules
    .composes = .{
        .ty = Composes,
        .conditional = .{
            .css_modules = true,
        },
    },

    // https://www.w3.org/TR/SVG2/painting.html
    .fill = .{
        .ty = SVGPaint,
    },
    .@"fill-rule" = .{
        .ty = FillRule,
    },
    .@"fill-opacity" = .{
        .ty = AlphaValue,
    },
    .stroke = .{
        .ty = SVGPaint,
    },
    .@"stroke-opacity" = .{
        .ty = AlphaValue,
    },
    .@"stroke-width" = .{
        .ty = LengthPercentage,
    },
    .@"stroke-linecap" = .{
        .ty = StrokeLinecap,
    },
    .@"stroke-linejoin" = .{
        .ty = StrokeLinejoin,
    },
    .@"stroke-miterlimit" = .{
        .ty = CSSNumber,
    },
    .@"stroke-dasharray" = .{
        .ty = StrokeDasharray,
    },
    .@"stroke-dashoffset" = .{
        .ty = LengthPercentage,
    },
    .@"marker-start" = .{
        .ty = Marker,
    },
    .@"marker-mid" = .{
        .ty = Marker,
    },
    .@"marker-end" = .{
        .ty = Marker,
    },
    .marker = .{
        .ty = Marker,
    },
    .@"color-interpolation" = .{
        .ty = ColorInterpolation,
    },
    .@"color-interpolation-filters" = .{
        .ty = ColorInterpolation,
    },
    .@"color-rendering" = .{
        .ty = ColorRendering,
    },
    .@"shape-rendering" = .{
        .ty = ShapeRendering,
    },
    .@"text-rendering" = .{
        .ty = TextRendering,
    },
    .@"image-rendering" = .{
        .ty = ImageRendering,
    },

    // https://www.w3.org/TR/css-masking-1/
    .@"clip-path" = .{
        .ty = struct { ClipPath, css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .webkit = true,
        },
    },
    .@"clip-rule" = .{
        .ty = FillRule,
    },
    .@"mask-image" = .{
        .ty = struct { SmallList(Image, 1), css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .webkit = true,
        },
    },
    .@"mask-mode" = .{
        .ty = SmallList(MaskMode, 1),
    },
    .@"mask-repeat" = .{
        .ty = struct { SmallList(BackgroundRepeat, 1), css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .webkit = true,
        },
    },
    .@"mask-position-x" = .{
        .ty = SmallList(HorizontalPosition, 1),
    },
    .@"mask-position-y" = .{
        .ty = SmallList(VerticalPosition, 1),
    },
    .@"mask-position" = .{
        .ty = struct { SmallList(Position, 1), css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .webkit = true,
        },
    },
    .@"mask-clip" = .{
        .ty = struct { SmallList(MaskClip, 1), css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .webkit = true,
        },
    },
    .@"mask-origin" = .{
        .ty = struct { SmallList(GeometryBox, 1), css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .webkit = true,
        },
    },
    .@"mask-size" = .{
        .ty = struct { SmallList(BackgroundSize, 1), css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .webkit = true,
        },
    },
    .@"mask-composite" = .{
        .ty = SmallList(MaskComposite, 1),
    },
    .@"mask-type" = .{
        .ty = MaskType,
    },
    .mask = .{
        .ty = struct { SmallList(Mask, 1), css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .webkit = true,
        },
        .shorthand = true,
    },
    .@"mask-border-source" = .{
        .ty = Image,
    },
    .@"mask-border-mode" = .{
        .ty = MaskBorderMode,
    },
    .@"mask-border-slice" = .{
        .ty = BorderImageSlice,
    },
    .@"mask-border-width" = .{
        .ty = Rect(BorderImageSideWidth),
    },
    .@"mask-border-outset" = .{
        .ty = Rect(LengthOrNumber),
    },
    .@"mask-border-repeat" = .{
        .ty = BorderImageRepeat,
    },
    .@"mask-border" = .{
        .ty = MaskBorder,
        .shorthand = true,
    },

    // WebKit additions
    .@"-webkit-mask-composite" = .{
        .ty = SmallList(WebKitMaskComposite, 1),
    },
    .@"mask-source-type" = .{
        .ty = struct { SmallList(WebKitMaskSourceType, 1), css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .webkit = true,
        },
        .unprefixed = false,
    },
    .@"mask-box-image" = .{
        .ty = struct { BorderImage, css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .webkit = true,
        },
        .unprefixed = false,
    },
    .@"mask-box-image-source" = .{
        .ty = struct { Image, css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .webkit = true,
        },
        .unprefixed = false,
    },
    .@"mask-box-image-slice" = .{
        .ty = struct { BorderImageSlice, css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .webkit = true,
        },
        .unprefixed = false,
    },
    .@"mask-box-image-width" = .{
        .ty = struct { Rect(BorderImageSideWidth), css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .webkit = true,
        },
        .unprefixed = false,
    },
    .@"mask-box-image-outset" = .{
        .ty = struct { Rect(LengthOrNumber), css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .webkit = true,
        },
        .unprefixed = false,
    },
    .@"mask-box-image-repeat" = .{
        .ty = struct { BorderImageRepeat, css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .webkit = true,
        },
        .unprefixed = false,
    },

    // https://drafts.fxtf.org/filter-effects-1/
    .filter = .{
        .ty = struct { FilterList, css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .webkit = true,
        },
    },
    .@"backdrop-filter" = .{
        .ty = struct { FilterList, css.VendorPrefix },
        .valid_prefixes = css.VendorPrefix{
            .webkit = true,
        },
    },

    // https://drafts.csswg.org/css2/
    .@"z-index" = .{
        .ty = position.ZIndex,
    },

    // https://drafts.csswg.org/css-contain-3/
    .@"container-type" = .{
        .ty = ContainerType,
    },
    .@"container-name" = .{
        .ty = ContainerNameList,
    },
    .container = .{
        .ty = Container,
        .shorthand = true,
    },

    // https://w3c.github.io/csswg-drafts/css-view-transitions-1/
    .@"view-transition-name" = .{
        .ty = CustomIdent,
    },

    // https://drafts.csswg.org/css-color-adjust/
    .@"color-scheme" = .{
        .ty = ColorScheme,
    },
});
