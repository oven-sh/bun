use crate as css;
use crate::{Parser, Printer, PrintErr, SmallList};
use crate::css_values::length::{LengthPercentage, LengthPercentageOrAuto};
use crate::css_values::ident::{CustomIdent, DashedIdent};
use crate::css_values::string::CSSString;
use crate::css_values::number::CSSNumber;
use crate::css_values::size::Size2D;
use crate::css_values::time::Time;
use crate::css_values::easing::EasingFunction;
use bun_str::strings;

/// A list of animations.
pub type AnimationList = SmallList<Animation, 1>;

/// A list of animation names.
pub type AnimationNameList = SmallList<AnimationName, 1>;

/// A value for the [animation](https://drafts.csswg.org/css-animations/#animation) shorthand property.
pub struct Animation {
    /// The animation name.
    pub name: AnimationName,
    /// The animation duration.
    pub duration: Time,
    /// The easing function for the animation.
    pub timing_function: EasingFunction,
    /// The number of times the animation will run.
    pub iteration_count: AnimationIterationCount,
    /// The direction of the animation.
    pub direction: AnimationDirection,
    /// The current play state of the animation.
    pub play_state: AnimationPlayState,
    /// The animation delay.
    pub delay: Time,
    /// The animation fill mode.
    pub fill_mode: AnimationFillMode,
    /// The animation timeline.
    pub timeline: AnimationTimeline,
}

impl Animation {
    // TODO(port): PropertyFieldMap / VendorPrefixMap were comptime anonymous-struct
    // metadata consumed by reflection in the shorthand codegen. Phase B should
    // replace these with a derive macro (e.g. #[derive(Shorthand)]) that emits
    // the field→PropertyIdTag and field→has-vendor-prefix tables.
    pub const PROPERTY_FIELD_MAP: &'static [(&'static str, css::PropertyIdTag)] = &[
        ("name", css::PropertyIdTag::AnimationName),
        ("duration", css::PropertyIdTag::AnimationDuration),
        ("timing_function", css::PropertyIdTag::AnimationTimingFunction),
        ("iteration_count", css::PropertyIdTag::AnimationIterationCount),
        ("direction", css::PropertyIdTag::AnimationDirection),
        ("play_state", css::PropertyIdTag::AnimationPlayState),
        ("delay", css::PropertyIdTag::AnimationDelay),
        ("fill_mode", css::PropertyIdTag::AnimationFillMode),
        ("timeline", css::PropertyIdTag::AnimationTimeline),
    ];

    pub const VENDOR_PREFIX_MAP: &'static [(&'static str, bool)] = &[
        ("name", true),
        ("duration", true),
        ("timing_function", true),
        ("iteration_count", true),
        ("direction", true),
        ("play_state", true),
        ("delay", true),
        ("fill_mode", true),
    ];

    pub fn parse(input: &mut Parser) -> css::Result<Self> {
        let mut name: Option<AnimationName> = None;
        let mut duration: Option<Time> = None;
        let mut timing_function: Option<EasingFunction> = None;
        let mut iteration_count: Option<AnimationIterationCount> = None;
        let mut direction: Option<AnimationDirection> = None;
        let mut play_state: Option<AnimationPlayState> = None;
        let mut delay: Option<Time> = None;
        let mut fill_mode: Option<AnimationFillMode> = None;
        let mut timeline: Option<AnimationTimeline> = None;

        loop {
            if duration.is_none() {
                if let Some(value) = input.try_parse(Time::parse) {
                    duration = Some(value);
                    continue;
                }
            }
            if timing_function.is_none() {
                if let Some(value) = input.try_parse(EasingFunction::parse) {
                    timing_function = Some(value);
                    continue;
                }
            }
            if delay.is_none() {
                if let Some(value) = input.try_parse(Time::parse) {
                    delay = Some(value);
                    continue;
                }
            }
            if iteration_count.is_none() {
                if let Some(value) = input.try_parse(AnimationIterationCount::parse) {
                    iteration_count = Some(value);
                    continue;
                }
            }
            if direction.is_none() {
                if let Some(value) = input.try_parse(AnimationDirection::parse) {
                    direction = Some(value);
                    continue;
                }
            }
            if fill_mode.is_none() {
                if let Some(value) = input.try_parse(AnimationFillMode::parse) {
                    fill_mode = Some(value);
                    continue;
                }
            }
            if play_state.is_none() {
                if let Some(value) = input.try_parse(AnimationPlayState::parse) {
                    play_state = Some(value);
                    continue;
                }
            }
            if name.is_none() {
                if let Some(value) = input.try_parse(AnimationName::parse) {
                    name = Some(value);
                    continue;
                }
            }
            if timeline.is_none() {
                if let Some(value) = input.try_parse(AnimationTimeline::parse) {
                    timeline = Some(value);
                    continue;
                }
            }
            break;
        }

        css::Result::Ok(Animation {
            name: name.unwrap_or(AnimationName::None),
            duration: duration.unwrap_or(Time::Seconds(0.0)),
            timing_function: timing_function.unwrap_or(EasingFunction::Ease),
            iteration_count: iteration_count.unwrap_or(AnimationIterationCount::Number(1.0)),
            direction: direction.unwrap_or(AnimationDirection::Normal),
            play_state: play_state.unwrap_or(AnimationPlayState::Running),
            delay: delay.unwrap_or(Time::Seconds(0.0)),
            fill_mode: fill_mode.unwrap_or(AnimationFillMode::None),
            timeline: timeline.unwrap_or(AnimationTimeline::Auto),
        })
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        // PORT NOTE: reshaped `inline .ident, .string => |name|` — Zig's inline
        // switch monomorphized over two payload types; Rust extracts the inner
        // string slice up front instead.
        let name_str: Option<&[u8]> = match &self.name {
            AnimationName::None => None,
            AnimationName::Ident(ident) => Some(ident.v.as_ref()),
            AnimationName::String(s) => Some(s.as_ref()),
        };

        if let Some(name_str) = name_str {
            if !self.duration.is_zero() || !self.delay.is_zero() {
                self.duration.to_css(dest)?;
                dest.write_char(' ')?;
            }

            if !self.timing_function.is_ease() || EasingFunction::is_ident(name_str) {
                self.timing_function.to_css(dest)?;
                dest.write_char(' ')?;
            }

            if !self.delay.is_zero() {
                self.delay.to_css(dest)?;
                dest.write_char(' ')?;
            }

            if self.iteration_count != AnimationIterationCount::default()
                || strings::eql_case_insensitive_ascii(name_str, b"infinite")
            {
                self.iteration_count.to_css(dest)?;
                dest.write_char(' ')?;
            }

            if self.direction != AnimationDirection::default()
                || css::parse_utility::parse_string::<AnimationDirection>(
                    dest.allocator,
                    name_str,
                    AnimationDirection::parse,
                )
                .is_ok()
            {
                self.direction.to_css(dest)?;
                dest.write_char(' ')?;
            }

            if self.fill_mode != AnimationFillMode::default()
                || (!strings::eql_case_insensitive_ascii(name_str, b"none")
                    && css::parse_utility::parse_string::<AnimationFillMode>(
                        dest.allocator,
                        name_str,
                        AnimationFillMode::parse,
                    )
                    .is_ok())
            {
                self.fill_mode.to_css(dest)?;
                dest.write_char(' ')?;
            }

            if self.play_state != AnimationPlayState::default()
                || css::parse_utility::parse_string::<AnimationPlayState>(
                    dest.allocator,
                    name_str,
                    AnimationPlayState::parse,
                )
                .is_ok()
            {
                self.play_state.to_css(dest)?;
                dest.write_char(' ')?;
            }
        }

        self.name.to_css(dest)?;

        if self.name != AnimationName::None && self.timeline != AnimationTimeline::default() {
            dest.write_char(' ')?;
            self.timeline.to_css(dest)?;
        }

        Ok(())
    }
}

/// A value for the [animation-name](https://drafts.csswg.org/css-animations/#animation-name) property.
#[derive(PartialEq, Eq, Hash)]
// TODO(port): Hash must use wyhash to match Zig's std.hash.Wyhash (bun_wyhash hasher).
pub enum AnimationName {
    /// The `none` keyword.
    None,
    /// An identifier of a `@keyframes` rule.
    Ident(CustomIdent),
    /// A `<string>` name of a `@keyframes` rule.
    String(CSSString),
}

impl AnimationName {
    // TODO(port): `parse` was not defined in the Zig source for AnimationName but
    // is referenced by `Animation::parse` via `input.tryParse(AnimationName.parse, ...)`.
    // It is presumably provided elsewhere (DeriveParse mixin or hand-written upstream).
    // Phase B: locate/implement.

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        let css_module_animation_enabled = if let Some(css_module) = &dest.css_module {
            css_module.config.animation
        } else {
            false
        };

        match self {
            AnimationName::None => return dest.write_str("none"),
            AnimationName::Ident(s) => {
                if css_module_animation_enabled {
                    // PORT NOTE: reshaped for borrowck — capture allocator/source_index
                    // before borrowing dest.css_module mutably.
                    let allocator = dest.allocator;
                    let source_index = dest.loc.source_index;
                    if let Some(css_module) = &mut dest.css_module {
                        css_module.get_reference(allocator, &s.v, source_index);
                    }
                }
                return s.to_css_with_options(dest, css_module_animation_enabled);
            }
            AnimationName::String(s) => {
                if css_module_animation_enabled {
                    // PORT NOTE: reshaped for borrowck
                    let allocator = dest.allocator;
                    let source_index = dest.loc.source_index;
                    if let Some(css_module) = &mut dest.css_module {
                        css_module.get_reference(allocator, s, source_index);
                    }
                }

                // CSS-wide keywords and `none` cannot remove quotes
                if strings::eql_case_insensitive_ascii_icheck_length(s, b"none")
                    || strings::eql_case_insensitive_ascii_icheck_length(s, b"initial")
                    || strings::eql_case_insensitive_ascii_icheck_length(s, b"inherit")
                    || strings::eql_case_insensitive_ascii_icheck_length(s, b"unset")
                    || strings::eql_case_insensitive_ascii_icheck_length(s, b"default")
                    || strings::eql_case_insensitive_ascii_icheck_length(s, b"revert")
                    || strings::eql_case_insensitive_ascii_icheck_length(s, b"revert-layer")
                {
                    if css::serializer::serialize_string(s, dest).is_err() {
                        return dest.add_fmt_error();
                    }
                    return Ok(());
                }

                return dest.write_ident(s, css_module_animation_enabled);
            }
        }
    }
}

/// A value for the [animation-iteration-count](https://drafts.csswg.org/css-animations/#animation-iteration-count) property.
// TODO(port): css.DeriveParse / css.DeriveToCss were comptime mixins generating
// parse()/to_css() from variant shape. Phase B: implement as #[derive(Parse, ToCss)].
#[derive(PartialEq)]
pub enum AnimationIterationCount {
    /// The animation will repeat the specified number of times.
    Number(CSSNumber),
    /// The animation will repeat forever.
    Infinite,
}

impl AnimationIterationCount {
    pub fn parse(input: &mut Parser) -> css::Result<Self> {
        // TODO(port): generated by css.DeriveParse(@This()).parse
        css::derive_parse::<Self>(input)
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        // TODO(port): generated by css.DeriveToCss(@This()).toCss
        css::derive_to_css(self, dest)
    }

    pub fn default() -> AnimationIterationCount {
        AnimationIterationCount::Number(1.0)
    }
}

/// A value for the [animation-direction](https://drafts.csswg.org/css-animations/#animation-direction) property.
// TODO(port): css.DefineEnumProperty(@This()) provided eql/hash/parse/toCss/deepClone
// by reflecting on @tagName. Phase B: #[derive(EnumProperty)] that emits Parse/ToCss
// using kebab-case variant names.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub enum AnimationDirection {
    /// The animation is played as specified
    Normal,
    /// The animation is played in reverse.
    Reverse,
    /// The animation iterations alternate between forward and reverse.
    Alternate,
    /// The animation iterations alternate between forward and reverse, with reverse occurring first.
    AlternateReverse, // css: "alternate-reverse"
}

impl AnimationDirection {
    pub fn parse(input: &mut Parser) -> css::Result<Self> {
        css::define_enum_property::parse::<Self>(input)
    }
    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        css::define_enum_property::to_css(self, dest)
    }
    pub fn deep_clone(&self) -> Self {
        *self
    }
    pub fn default() -> AnimationDirection {
        AnimationDirection::Normal
    }
}

/// A value for the [animation-play-state](https://drafts.csswg.org/css-animations/#animation-play-state) property.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub enum AnimationPlayState {
    /// The animation is playing.
    Running,
    /// The animation is paused.
    Paused,
}

impl AnimationPlayState {
    pub fn parse(input: &mut Parser) -> css::Result<Self> {
        css::define_enum_property::parse::<Self>(input)
    }
    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        css::define_enum_property::to_css(self, dest)
    }
    pub fn deep_clone(&self) -> Self {
        *self
    }
    pub fn default() -> AnimationPlayState {
        AnimationPlayState::Running
    }
}

/// A value for the [animation-fill-mode](https://drafts.csswg.org/css-animations/#animation-fill-mode) property.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub enum AnimationFillMode {
    /// The animation has no effect while not playing.
    None,
    /// After the animation, the ending values are applied.
    Forwards,
    /// Before the animation, the starting values are applied.
    Backwards,
    /// Both forwards and backwards apply.
    Both,
}

impl AnimationFillMode {
    pub fn parse(input: &mut Parser) -> css::Result<Self> {
        css::define_enum_property::parse::<Self>(input)
    }
    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        css::define_enum_property::to_css(self, dest)
    }
    pub fn deep_clone(&self) -> Self {
        *self
    }
    pub fn default() -> AnimationFillMode {
        AnimationFillMode::None
    }
}

/// A value for the [animation-composition](https://drafts.csswg.org/css-animations-2/#animation-composition) property.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub enum AnimationComposition {
    /// The result of compositing the effect value with the underlying value is simply the effect value.
    Replace,
    /// The effect value is added to the underlying value.
    Add,
    /// The effect value is accumulated onto the underlying value.
    Accumulate,
}

impl AnimationComposition {
    pub fn parse(input: &mut Parser) -> css::Result<Self> {
        css::define_enum_property::parse::<Self>(input)
    }
    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        css::define_enum_property::to_css(self, dest)
    }
    pub fn deep_clone(&self) -> Self {
        *self
    }
}

/// A value for the [animation-timeline](https://drafts.csswg.org/css-animations-2/#animation-timeline) property.
#[derive(PartialEq)]
pub enum AnimationTimeline {
    /// The animation's timeline is a DocumentTimeline, more specifically the default document timeline.
    Auto,
    /// The animation is not associated with a timeline.
    None,
    /// A timeline referenced by name.
    DashedIdent(DashedIdent),
    /// The scroll() function.
    Scroll(ScrollTimeline),
    /// The view() function.
    View(ViewTimeline),
}

impl AnimationTimeline {
    pub fn parse(input: &mut Parser) -> css::Result<Self> {
        // TODO(port): generated by css.DeriveParse(@This()).parse
        css::derive_parse::<Self>(input)
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        // TODO(port): generated by css.DeriveToCss(@This()).toCss
        css::derive_to_css(self, dest)
    }

    pub fn default() -> AnimationTimeline {
        AnimationTimeline::Auto
    }
}

/// The [scroll()](https://drafts.csswg.org/scroll-animations-1/#scroll-notation) function.
#[derive(PartialEq)]
pub struct ScrollTimeline {
    /// Specifies which element to use as the scroll container.
    pub scroller: Scroller,
    /// Specifies which axis of the scroll container to use as the progress for the timeline.
    pub axis: ScrollAxis,
}

/// The [view()](https://drafts.csswg.org/scroll-animations-1/#view-notation) function.
#[derive(PartialEq)]
pub struct ViewTimeline {
    /// Specifies which axis of the scroll container to use as the progress for the timeline.
    pub axis: ScrollAxis,
    /// Provides an adjustment of the view progress visibility range.
    pub inset: Size2D<LengthPercentageOrAuto>,
}

/// A scroller, used in the `scroll()` function.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub enum Scroller {
    /// Specifies to use the document viewport as the scroll container.
    Root,
    /// Specifies to use the nearest ancestor scroll container.
    Nearest,
    /// Specifies to use the element's own principal box as the scroll container.
    Self_, // css: "self"
}

impl Scroller {
    pub fn parse(input: &mut Parser) -> css::Result<Self> {
        css::define_enum_property::parse::<Self>(input)
    }
    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        css::define_enum_property::to_css(self, dest)
    }
    pub fn deep_clone(&self) -> Self {
        *self
    }
    pub fn default() -> Scroller {
        Scroller::Nearest
    }
}

/// A scroll axis, used in the `scroll()` function.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub enum ScrollAxis {
    /// Specifies to use the measure of progress along the block axis of the scroll container.
    Block,
    /// Specifies to use the measure of progress along the inline axis of the scroll container.
    Inline, // css: "inline"
    /// Specifies to use the measure of progress along the horizontal axis of the scroll container.
    X,
    /// Specifies to use the measure of progress along the vertical axis of the scroll container.
    Y,
}

impl ScrollAxis {
    pub fn parse(input: &mut Parser) -> css::Result<Self> {
        css::define_enum_property::parse::<Self>(input)
    }
    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        css::define_enum_property::to_css(self, dest)
    }
    pub fn deep_clone(&self) -> Self {
        *self
    }
    pub fn default() -> ScrollAxis {
        ScrollAxis::Block
    }
}

/// A value for the animation-range shorthand property.
pub struct AnimationRange {
    /// The start of the animation's attachment range.
    pub start: AnimationRangeStart,
    /// The end of the animation's attachment range.
    pub end: AnimationRangeEnd,
}

/// A value for the [animation-range-start](https://drafts.csswg.org/scroll-animations/#animation-range-start) property.
pub struct AnimationRangeStart {
    pub v: AnimationAttachmentRange,
}

/// A value for the [animation-range-end](https://drafts.csswg.org/scroll-animations/#animation-range-start) property.
pub struct AnimationRangeEnd {
    pub v: AnimationAttachmentRange,
}

/// A value for the [animation-range-start](https://drafts.csswg.org/scroll-animations/#animation-range-start)
/// or [animation-range-end](https://drafts.csswg.org/scroll-animations/#animation-range-end) property.
pub enum AnimationAttachmentRange {
    /// The start of the animation's attachment range is the start of its associated timeline.
    Normal,
    /// The animation attachment range starts at the specified point on the timeline measuring from the start of the timeline.
    LengthPercentage(LengthPercentage),
    /// The animation attachment range starts at the specified point on the timeline measuring from the start of the specified named timeline range.
    TimelineRange {
        /// The name of the timeline range.
        name: TimelineRangeName,
        /// The offset from the start of the named timeline range.
        offset: LengthPercentage,
    },
}

/// A [view progress timeline range](https://drafts.csswg.org/scroll-animations/#view-timelines-ranges)
pub enum TimelineRangeName {
    /// Represents the full range of the view progress timeline.
    Cover,
    /// Represents the range during which the principal box is either fully contained by,
    /// or fully covers, its view progress visibility range within the scrollport.
    Contain,
    /// Represents the range during which the principal box is entering the view progress visibility range.
    Entry,
    /// Represents the range during which the principal box is exiting the view progress visibility range.
    Exit,
    /// Represents the range during which the principal box crosses the end border edge.
    EntryCrossing,
    /// Represents the range during which the principal box crosses the start border edge.
    ExitCrossing,
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/properties/animation.zig (515 lines)
//   confidence: medium
//   todos:      9
//   notes:      DefineEnumProperty/DeriveParse/DeriveToCss comptime mixins stubbed as crate helper calls — Phase B should replace with derive macros; PropertyFieldMap/VendorPrefixMap reified as const slices.
// ──────────────────────────────────────────────────────────────────────────
