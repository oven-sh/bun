const std = @import("std");
const bun = @import("root").bun;
const Allocator = std.mem.Allocator;
const ArrayList = std.ArrayListUnmanaged;

pub const css = @import("../css_parser.zig");

const SmallList = css.SmallList;
const Printer = css.Printer;
const PrintErr = css.PrintErr;

const LengthPercentage = css.css_values.length.LengthPercentage;
const CustomIdent = css.css_values.ident.CustomIdent;
const CSSString = css.css_values.string.CSSString;
const CSSNumber = css.css_values.number.CSSNumber;
const LengthPercentageOrAuto = css.css_values.length.LengthPercentageOrAuto;
const Size2D = css.css_values.size.Size2D;
const DashedIdent = css.css_values.ident.DashedIdent;
const Time = css.css_values.time.Time;
const EasingFunction = css.css_values.easing.EasingFunction;

/// A list of animations.
pub const AnimationList = SmallList(Animation, 1);

/// A list of animation names.
pub const AnimationNameList = SmallList(AnimationName, 1);

/// A value for the [animation](https://drafts.csswg.org/css-animations/#animation) shorthand property.
pub const Animation = struct {
    /// The animation name.
    name: AnimationName,
    /// The animation duration.
    duration: Time,
    /// The easing function for the animation.
    timing_function: EasingFunction,
    /// The number of times the animation will run.
    iteration_count: AnimationIterationCount,
    /// The direction of the animation.
    direction: AnimationDirection,
    /// The current play state of the animation.
    play_state: AnimationPlayState,
    /// The animation delay.
    delay: Time,
    /// The animation fill mode.
    fill_mode: AnimationFillMode,
    /// The animation timeline.
    timeline: AnimationTimeline,

    pub usingnamespace css.DefineListShorthand(@This());

    pub const PropertyFieldMap = .{
        .name = css.PropertyIdTag.@"animation-name",
        .duration = css.PropertyIdTag.@"animation-duration",
        .timing_function = css.PropertyIdTag.@"animation-timing-function",
        .iteration_count = css.PropertyIdTag.@"animation-iteration-count",
        .direction = css.PropertyIdTag.@"animation-direction",
        .play_state = css.PropertyIdTag.@"animation-play-state",
        .delay = css.PropertyIdTag.@"animation-delay",
        .fill_mode = css.PropertyIdTag.@"animation-fill-mode",
        .timeline = css.PropertyIdTag.@"animation-timeline",
    };

    pub const VendorPrefixMap = .{
        .name = true,
        .duration = true,
        .timing_function = true,
        .iteration_count = true,
        .direction = true,
        .play_state = true,
        .delay = true,
        .fill_mode = true,
    };

    pub fn parse(input: *css.Parser) css.Result(@This()) {
        var name: ?AnimationName = null;
        var duration: ?Time = null;
        var timing_function: ?EasingFunction = null;
        var iteration_count: ?AnimationIterationCount = null;
        var direction: ?AnimationDirection = null;
        var play_state: ?AnimationPlayState = null;
        var delay: ?Time = null;
        var fill_mode: ?AnimationFillMode = null;
        var timeline: ?AnimationTimeline = null;

        while (true) {
            if (duration == null) {
                if (input.tryParse(Time.parse, .{})) |value| {
                    duration = value;
                    continue;
                }
            }
            if (timing_function == null) {
                if (input.tryParse(EasingFunction.parse, .{})) |value| {
                    timing_function = value;
                    continue;
                }
            }
            if (delay == null) {
                if (input.tryParse(Time.parse, .{})) |value| {
                    delay = value;
                    continue;
                }
            }
            if (iteration_count == null) {
                if (input.tryParse(AnimationIterationCount.parse, .{})) |value| {
                    iteration_count = value;
                    continue;
                }
            }
            if (direction == null) {
                if (input.tryParse(AnimationDirection.parse, .{})) |value| {
                    direction = value;
                    continue;
                }
            }
            if (fill_mode == null) {
                if (input.tryParse(AnimationFillMode.parse, .{})) |value| {
                    fill_mode = value;
                    continue;
                }
            }
            if (play_state == null) {
                if (input.tryParse(AnimationPlayState.parse, .{})) |value| {
                    play_state = value;
                    continue;
                }
            }
            if (name == null) {
                if (input.tryParse(AnimationName.parse, .{})) |value| {
                    name = value;
                    continue;
                }
            }
            if (timeline == null) {
                if (input.tryParse(AnimationTimeline.parse, .{})) |value| {
                    timeline = value;
                    continue;
                }
            }
            break;
        }

        return .{
            .result = Animation{
                .name = name orelse AnimationName.none,
                .duration = duration orelse Time{ .seconds = 0.0 },
                .timing_function = timing_function orelse EasingFunction.ease,
                .iteration_count = iteration_count orelse AnimationIterationCount.number(1),
                .direction = direction orelse AnimationDirection.normal,
                .play_state = play_state orelse AnimationPlayState.running,
                .delay = delay orelse Time{ .seconds = 0.0 },
                .fill_mode = fill_mode orelse AnimationFillMode.none,
                .timeline = timeline orelse AnimationTimeline.auto,
            },
        };
    }

    pub fn toCss(this: *const @This(), comptime W: type, dest: *Printer(W)) PrintErr!void {
        switch (this.name) {
            .none => {},
            inline .ident, .string => |name| {
                const name_str = if (this.name == .ident) name.v else name;

                if (!this.duration.isZero() or !this.delay.isZero()) {
                    try this.duration.toCss(W, dest);
                    try dest.writeChar(' ');
                }

                if (!this.timing_function.isEase() or EasingFunction.isIdent(name_str)) {
                    try this.timing_function.toCss(W, dest);
                    try dest.writeChar(' ');
                }

                if (!this.delay.isZero()) {
                    try this.delay.toCss(W, dest);
                    try dest.writeChar(' ');
                }

                if (!this.iteration_count.eql(&AnimationIterationCount.default()) or bun.strings.eqlCaseInsensitiveASCII(name_str, "infinite")) {
                    try this.iteration_count.toCss(W, dest);
                    try dest.writeChar(' ');
                }

                if (!this.direction.eql(&AnimationDirection.default()) or css.parse_utility.parseString(
                    dest.allocator,
                    AnimationDirection,
                    name_str,
                    AnimationDirection.parse,
                ).isOk()) {
                    try this.direction.toCss(W, dest);
                    try dest.writeChar(' ');
                }

                if (!this.fill_mode.eql(&AnimationFillMode.default()) or
                    (!bun.strings.eqlCaseInsensitiveASCII(name_str, "none") and css.parse_utility.parseString(dest.allocator, AnimationFillMode, name_str, AnimationFillMode.parse).isOk()))
                {
                    try this.fill_mode.toCss(W, dest);
                    try dest.writeChar(' ');
                }

                if (!this.play_state.eql(&AnimationPlayState.default()) or css.parse_utility.parseString(
                    dest.allocator,
                    AnimationPlayState,
                    name_str,
                    AnimationPlayState.parse,
                ).isOk()) {
                    try this.play_state.toCss(W, dest);
                    try dest.writeChar(' ');
                }
            },
        }

        try this.name.toCss(W, dest);

        if (!this.name.eql(&AnimationName.none) and !this.timeline.eql(&AnimationTimeline.default())) {
            try dest.writeChar(' ');
            try this.timeline.toCss(W, dest);
        }
    }
};

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

    pub fn hash(this: *const @This(), hasher: *std.hash.Wyhash) void {
        return css.implementHash(@This(), this, hasher);
    }

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }

    pub fn toCss(this: *const This, comptime W: type, dest: *Printer(W)) PrintErr!void {
        const css_module_animation_enabled = if (dest.css_module) |css_module|
            css_module.config.animation
        else
            false;

        switch (this.*) {
            .none => return dest.writeStr("none"),
            .ident => |s| {
                if (css_module_animation_enabled) {
                    if (dest.css_module) |*css_module| {
                        css_module.getReference(dest.allocator, s.v, dest.loc.source_index);
                    }
                }
                return s.toCssWithOptions(W, dest, css_module_animation_enabled);
            },
            .string => |s| {
                if (css_module_animation_enabled) {
                    if (dest.css_module) |*css_module| {
                        css_module.getReference(dest.allocator, s, dest.loc.source_index);
                    }
                }

                // CSS-wide keywords and `none` cannot remove quotes
                if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(s, "none") or
                    bun.strings.eqlCaseInsensitiveASCIIICheckLength(s, "initial") or
                    bun.strings.eqlCaseInsensitiveASCIIICheckLength(s, "inherit") or
                    bun.strings.eqlCaseInsensitiveASCIIICheckLength(s, "unset") or
                    bun.strings.eqlCaseInsensitiveASCIIICheckLength(s, "default") or
                    bun.strings.eqlCaseInsensitiveASCIIICheckLength(s, "revert") or
                    bun.strings.eqlCaseInsensitiveASCIIICheckLength(s, "revert-layer"))
                {
                    css.serializer.serializeString(s, dest) catch return dest.addFmtError();
                    return;
                }

                return dest.writeIdent(s, css_module_animation_enabled);
            },
        }
    }
};

/// A value for the [animation-iteration-count](https://drafts.csswg.org/css-animations/#animation-iteration-count) property.
pub const AnimationIterationCount = union(enum) {
    /// The animation will repeat the specified number of times.
    number: CSSNumber,
    /// The animation will repeat forever.
    infinite,

    pub usingnamespace css.DeriveParse(@This());
    pub usingnamespace css.DeriveToCss(@This());

    pub fn default() AnimationIterationCount {
        return .{ .number = 1.0 };
    }

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }
};

/// A value for the [animation-direction](https://drafts.csswg.org/css-animations/#animation-direction) property.
pub const AnimationDirection = enum {
    /// The animation is played as specified
    normal,
    /// The animation is played in reverse.
    reverse,
    /// The animation iterations alternate between forward and reverse.
    alternate,
    /// The animation iterations alternate between forward and reverse, with reverse occurring first.
    @"alternate-reverse",

    pub usingnamespace css.DefineEnumProperty(@This());

    pub fn default() AnimationDirection {
        return .normal;
    }
};

/// A value for the [animation-play-state](https://drafts.csswg.org/css-animations/#animation-play-state) property.
pub const AnimationPlayState = enum {
    /// The animation is playing.
    running,
    /// The animation is paused.
    paused,

    pub usingnamespace css.DefineEnumProperty(@This());

    pub fn default() AnimationPlayState {
        return .running;
    }
};

/// A value for the [animation-fill-mode](https://drafts.csswg.org/css-animations/#animation-fill-mode) property.
pub const AnimationFillMode = enum {
    /// The animation has no effect while not playing.
    none,
    /// After the animation, the ending values are applied.
    forwards,
    /// Before the animation, the starting values are applied.
    backwards,
    /// Both forwards and backwards apply.
    both,

    pub usingnamespace css.DefineEnumProperty(@This());

    pub fn default() AnimationFillMode {
        return .none;
    }
};

/// A value for the [animation-composition](https://drafts.csswg.org/css-animations-2/#animation-composition) property.
pub const AnimationComposition = enum {
    /// The result of compositing the effect value with the underlying value is simply the effect value.
    replace,
    /// The effect value is added to the underlying value.
    add,
    /// The effect value is accumulated onto the underlying value.
    accumulate,

    pub usingnamespace css.DefineEnumProperty(@This());
};

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

    pub usingnamespace css.DeriveParse(@This());
    pub usingnamespace css.DeriveToCss(@This());

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }

    pub fn default() AnimationTimeline {
        return .auto;
    }
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
pub const Scroller = enum {
    /// Specifies to use the document viewport as the scroll container.
    root,
    /// Specifies to use the nearest ancestor scroll container.
    nearest,
    /// Specifies to use the element's own principal box as the scroll container.
    self,

    pub usingnamespace css.DefineEnumProperty(@This());

    pub fn default() Scroller {
        return .nearest;
    }
};

/// A scroll axis, used in the `scroll()` function.
pub const ScrollAxis = enum {
    /// Specifies to use the measure of progress along the block axis of the scroll container.
    block,
    /// Specifies to use the measure of progress along the inline axis of the scroll container.
    @"inline",
    /// Specifies to use the measure of progress along the horizontal axis of the scroll container.
    x,
    /// Specifies to use the measure of progress along the vertical axis of the scroll container.
    y,

    pub usingnamespace css.DefineEnumProperty(@This());

    pub fn default() ScrollAxis {
        return .block;
    }
};

/// A value for the animation-range shorthand property.
pub const AnimationRange = struct {
    /// The start of the animation's attachment range.
    start: AnimationRangeStart,
    /// The end of the animation's attachment range.
    end: AnimationRangeEnd,
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
