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
