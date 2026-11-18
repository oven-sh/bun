//! Transitions, CSS animations and those of scripts, on the timing model of Web Animations.

use std::borrow::Cow;
use std::rc::Rc;

use smallvec::SmallVec;

use crate::boxes::BoxId;
use crate::cascade::RuleList;
use crate::compositor::{Sampled, simplify};
use crate::custom::{Text, spelling};
use crate::document::Document;
use crate::engine_event::{CssEvent, EngineEvent, ForNode, Playback, Stage};
use crate::name::{Map, Name, Set};
use crate::paint::Picture;
use crate::properties::{Id, Only, Prop, Style, TransitionProperty, Value, WillChange};
use crate::selector::Pseudo;
use crate::sheet::{AtKind, Declaration, Declared, Defined, Keyframe, Wide};
use crate::timeline::{Snapshot, Watched, trigger_ranges};
use crate::tree::{Flags, NodeId};
use crate::types::*;
use crate::values::{
    ALLOWS_KEYWORDS, Composite, Css, Ctx, Deps, Lp, Mixing, NoneOrSpaces, Out, Str, keywords, mix,
    parse_all, with_current_color,
};

#[derive(Clone, PartialEq)]
enum Animated {
    Property(Value),
    /// `None` is the guaranteed-invalid value.
    Custom(Name, Option<Text>),
}

#[derive(Clone, Copy, PartialEq)]
enum Target {
    Property(Id),
    Custom(Name),
}

impl Target {
    fn id(self) -> Option<Id> {
        match self {
            Target::Property(id) => Some(id),
            Target::Custom(_) => None,
        }
    }

    fn counts_as(self) -> WillChange {
        match self {
            Target::Property(Id::Transform | Id::Translate | Id::Rotate | Id::Scale) => {
                WillChange::TRANSFORM
            }
            Target::Property(Id::Opacity) => WillChange::OPACITY,
            Target::Property(Id::Filter | Id::BackdropFilter) => WillChange::FILTER,
            _ => WillChange::empty(),
        }
    }
}

impl Animated {
    fn written(&self, style: &Style) -> Option<(Prop, Out)> {
        match self {
            Animated::Property(value) => Some((
                Prop::Long(value.id()),
                crate::values::with_zoom(style.zoom, || {
                    crate::prelude::written(|out| value.write(out))
                }),
            )),
            Animated::Custom(name, value) => Some((
                Prop::Custom(*name),
                crate::custom::untainted(value.as_ref()?).to_vec(),
            )),
        }
    }

    fn target(&self) -> Target {
        match self {
            Animated::Property(value) => Target::Property(value.id()),
            Animated::Custom(name, _) => Target::Custom(*name),
        }
    }
}

#[derive(Clone, PartialEq)]
struct Stop {
    offset: f32,
    value: Animated,
    easing: Easing,
    adds: Option<Mixing>,
    /// Which keyframe it is from.
    frame: usize,
}

#[derive(Clone, PartialEq)]
struct Track {
    target: Target,
    stops: Vec<Stop>,
    /// Up to the first stop.
    easing: Easing,
    /// It stays at what the style has anyway.
    is_idle: bool,
}

/// What the compositor was last given for an element that only fades.
struct LastFade {
    timing: Timing,
    rate: f64,
    tracks: Vec<Track>,
    under: f32,
    opacities: Vec<(f32, [f32; 1])>,
}

/// What `Document::animate` has last made of a style with a single animation.
struct LastAnimated {
    base: Rc<Style>,
    keyframes: Rc<[Keyframe]>,
    how: (Easing, Composite, Option<Sample>),
    style: Rc<Style>,
}

#[derive(Clone, PartialEq)]
pub(crate) struct Timing {
    pub(crate) delay: f64,
    pub(crate) end_delay: f64,
    /// The two as fractions of the range of a timeline that follows progress.
    pub(crate) relative_delays: [f64; 2],
    /// Negative for `auto`.
    pub(crate) duration: f64,
    pub(crate) iterations: f64,
    pub(crate) iteration_start: f64,
    pub(crate) fill: FillMode,
    pub(crate) direction: AnimationDirection,
    pub(crate) easing: Easing,
}

const EPSILON: f64 = 1e-6;

#[derive(Clone, Copy, PartialEq)]
enum Phase {
    Idle,
    Before,
    Active,
    After,
}

#[derive(Clone, Copy, PartialEq)]
struct Sample {
    iteration: f64,
    /// In the iteration.
    progress: f64,
    is_before: bool,
}

impl Timing {
    pub(crate) fn active_duration(&self) -> f64 {
        if self.duration == 0.0 || self.iterations == 0.0 {
            0.0
        } else {
            self.duration * self.iterations
        }
    }

    pub(crate) fn end(&self) -> f64 {
        (self.delay + self.active_duration() + self.end_delay).max(0.0)
    }

    /// `length` is how much of a timeline that ends it is to fill.
    pub(crate) fn normalized(&self, length: Option<f64>) -> Timing {
        let known = Timing {
            duration: self.duration.max(0.0),
            ..self.clone()
        };
        let Some(length) = length else { return known };
        let [delay, duration, end_delay] = match known.end() {
            _ if self.duration < 0.0 => {
                let [delay, end_delay] = self.relative_delays.map(|it| it * length);
                [
                    delay,
                    if self.iterations > 0.0 {
                        (length - delay - end_delay).max(0.0) / self.iterations
                    } else {
                        0.0
                    },
                    end_delay,
                ]
            }
            0.0 => [0.0, 0.0, length],
            f64::INFINITY => [0.0, 0.0, 0.0],
            end => [self.delay, self.duration, self.end_delay].map(|it| it / end * length),
        };
        Timing {
            delay,
            duration,
            end_delay,
            ..known
        }
    }

    /// `members` has a bit for each of those to take, in the order of the declaration.
    fn update(&mut self, from: Timing, members: u16) {
        let has = |bit: u16| members >> bit & 1 != 0;
        let numbers = [
            &mut self.delay,
            &mut self.end_delay,
            &mut self.duration,
            &mut self.iterations,
            &mut self.iteration_start,
        ];
        let new = [
            from.delay,
            from.end_delay,
            from.duration,
            from.iterations,
            from.iteration_start,
        ];
        (0..)
            .zip(numbers.into_iter().zip(new))
            .filter(|it| has(it.0))
            .for_each(|(_, (number, new))| *number = new);
        self.relative_delays = [0, 1].map(|it| if has(it) { from.relative_delays } else { self.relative_delays }[usize::from(it)]);
        self.fill = if has(5) { from.fill } else { self.fill };
        self.direction = if has(6) {
            from.direction
        } else {
            self.direction
        };
        if has(7) {
            self.easing = from.easing;
        }
    }

    fn boundaries(&self) -> [f64; 2] {
        [self.delay, self.delay + self.active_duration()].map(|it| it.min(self.end()).max(0.0))
    }

    /// `excludes` says whether the active phase is without its start, and without its end.
    fn phase(&self, time: Option<f64>, excludes: [bool; 2]) -> Phase {
        let (Some(time), [start, end]) = (time, self.boundaries()) else {
            return Phase::Idle;
        };
        let is_at = |boundary: f64| (time - boundary).abs() < EPSILON;
        if if is_at(start) {
            excludes[0]
        } else {
            time < start
        } {
            Phase::Before
        } else if if is_at(end) { excludes[1] } else { time > end } {
            Phase::After
        } else {
            Phase::Active
        }
    }

    fn sample(&self, time: Option<f64>, excludes: [bool; 2]) -> Option<Sample> {
        let (phase, time, active) = (self.phase(time, excludes), time?, self.active_duration());
        let active_time = match (phase, self.fill) {
            (Phase::Before, FillMode::Backwards | FillMode::Both) => (time - self.delay).max(0.0),
            (Phase::Active, _) => (time - self.delay).max(0.0).min(active),
            (Phase::After, FillMode::Forwards | FillMode::Both) => {
                (time - self.delay).min(active).max(0.0)
            }
            _ => return None,
        };
        let overall = self.iteration_start
            + match (self.duration, phase) {
                (0.0, Phase::Before) => 0.0,
                (0.0, _) => self.iterations,
                (duration, _) => active_time / duration,
            };
        let mut simple = if overall.is_infinite() {
            self.iteration_start % 1.0
        } else {
            overall % 1.0
        };
        if simple == 0.0
            && phase != Phase::Before
            && (active_time == active || (active_time - active).abs() < EPSILON)
            && self.iterations != 0.0
        {
            simple = 1.0;
        }
        let iteration = match simple {
            _ if phase == Phase::After && self.iterations.is_infinite() => f64::INFINITY,
            1.0 => overall.floor() - 1.0,
            _ => overall.floor(),
        };
        let is_odd = iteration.is_finite() && iteration % 2.0 == 1.0;
        let forwards = match self.direction {
            AnimationDirection::Normal => true,
            AnimationDirection::Reverse => false,
            AnimationDirection::Alternate => !is_odd,
            AnimationDirection::AlternateReverse => is_odd || iteration.is_infinite(),
        };
        let directed = if forwards { simple } else { 1.0 - simple };
        let is_before = phase
            == if forwards {
                Phase::Before
            } else {
                Phase::After
            };
        Some(Sample {
            iteration,
            progress: self.easing.apply(directed, is_before),
            is_before,
        })
    }
}

enum Kind {
    Transition {
        name: Str,
        /// Going back to this value takes as long as it took to get away from it.
        reversing_start: Animated,
        end: Animated,
        shortening: f64,
        /// Those that start together have the same.
        generation: u32,
    },
    /// With its place in `animation-name`.
    Css(Str, usize),
    Script,
}

enum Clock {
    None,
    /// With the time of the document at which it is 0.
    Document(f64),
    Progress(u32, Option<Snapshot>),
}

#[derive(Clone, Copy, PartialEq)]
enum Pending {
    None,
    Play,
    Pause,
}

bitflags::bitflags! {
    /// What a script has set, which styles do not change any more. The members of `Timing` come first.
    #[derive(Clone, Copy)]
    struct Overridden: u16 {
        const KEYFRAMES = 1 << 8;
        const PLAY_STATE = 1 << 9;
        const TIMELINE = 1 << 10;
        const RANGE_START = 1 << 11;
        const RANGE_END = 1 << 12;
        const COMPOSITE = 1 << 13;
        const TRIGGER = 1 << 14;
    }
}

#[derive(Clone, PartialEq)]
enum TriggeredBy {
    Name(Str),
    /// With its activation range and its active range.
    Timeline(u32, [RangeEdge; 4]),
}

keywords! {
    Behavior { Play = "play", Pause = "pause", Reset = "reset", PlayOnce = "play-once", PlayForwards = "play-forwards",
        PlayBackwards = "play-backwards", Replay = "replay", None = "none" }
}

struct Trigger {
    by: TriggeredBy,
    /// When it is activated and when it is deactivated.
    behaviors: [Behavior; 2],
    /// The element that declares it.
    source: NodeId,
    is_active: bool,
    is_paused_by_style: bool,
    /// The animation has not started.
    is_awaited: bool,
}

struct Animation {
    /// The target.
    node: NodeId,
    /// If the target is a pseudo-element, which may not exist.
    wanted: Option<(NodeId, Pseudo)>,
    kind: Kind,
    /// The element whose style asks for it, or 0.
    owner: NodeId,
    /// 0 until one that has lost its owner is played.
    sequence: u32,
    is_exposed: bool,
    keyframes: Rc<[Keyframe]>,
    default_easing: Easing,
    composite: Composite,
    tracks: Vec<Track>,
    /// The style that `tracks` were computed for.
    computed_for: Option<Rc<Style>>,
    /// What else they depend on.
    deps: Deps,
    specified: Timing,
    timing: Timing,
    clock: Clock,
    css_timeline: Timeline,
    range: [RangeEdge; 2],
    start: Option<f64>,
    hold: Option<f64>,
    previous: Option<f64>,
    rate: f64,
    pending_rate: Option<f64>,
    pending: Pending,
    /// Whether the start time follows the range.
    aligns: bool,
    is_finished: bool,
    overridden: Overridden,
    replace_state: ReplaceState,
    phase: Phase,
    sample: Option<Sample>,
    /// What the last events were about.
    reported: (Phase, Option<f64>),
    throttle: Throttle,
    trigger: Option<Box<Trigger>>,
}

#[derive(Clone, Copy, Default, PartialEq)]
pub(crate) enum ReplaceState {
    #[default]
    Active,
    Removed,
    Persisted,
}

#[derive(Clone, Copy, Default, PartialEq)]
pub(crate) enum Playing {
    #[default]
    Idle,
    Running,
    Paused,
    Finished,
}

#[derive(Clone, Copy, Default, PartialEq)]
pub(crate) enum TimelineId {
    #[default]
    None,
    /// With the time of the document at which it is 0.
    Document(f64),
    Progress(u32),
}

#[derive(Clone, Copy)]
pub(crate) struct State {
    pub(crate) play_state: Playing,
    pub(crate) current_time: Option<f64>,
    pub(crate) start_time: Option<f64>,
    pub(crate) playback_rate: f64,
    pub(crate) is_pending: bool,
    pub(crate) replace_state: ReplaceState,
    pub(crate) progress: Option<f64>,
    pub(crate) iteration: Option<f64>,
    pub(crate) end_time: f64,
    pub(crate) active_duration: f64,
    pub(crate) duration: f64,
    pub(crate) timeline: TimelineId,
    pub(crate) timeline_time: Option<f64>,
    pub(crate) has_keyframes_from_script: bool,
}

impl Default for State {
    fn default() -> State {
        State {
            play_state: Playing::Idle,
            current_time: None,
            start_time: None,
            playback_rate: 1.0,
            is_pending: false,
            replace_state: ReplaceState::Active,
            progress: None,
            iteration: None,
            end_time: 0.0,
            active_duration: 0.0,
            duration: 0.0,
            timeline: TimelineId::None,
            timeline_time: None,
            has_keyframes_from_script: false,
        }
    }
}

#[derive(Clone, Copy)]
pub(crate) enum Control {
    Play,
    Pause,
    Cancel,
    Finish,
    Reverse,
    Seek(f64),
    SetStart(Option<f64>),
    SetRate(f64),
    UpdateRate(f64),
    Persist,
    /// Scripts have let go of it.
    Release,
}

/// Of one that a style has started.
pub(crate) struct Origin {
    pub(crate) is_transition: bool,
    pub(crate) name: Str,
    pub(crate) node: NodeId,
    pub(crate) pseudo: Cow<'static, str>,
}

pub(crate) struct ComputedKeyframe {
    pub(crate) range: Option<RangeName>,
    pub(crate) offset: f32,
    pub(crate) computed_offset: Option<f32>,
    pub(crate) easing: Easing,
    pub(crate) adds: Option<Composite>,
    pub(crate) values: Vec<(Prop, Out)>,
}

#[derive(Clone, Copy)]
pub(crate) struct TimelineState {
    pub(crate) time: Option<f64>,
    pub(crate) source: NodeId,
    pub(crate) subject: NodeId,
    pub(crate) axis: Axis,
    pub(crate) is_view: bool,
    pub(crate) offsets: [f64; 2],
}

struct Progress {
    watched: Watched,
    /// `None` while it is inactive.
    snapshot: Option<Snapshot>,
    is_exposed: bool,
    is_from_script: bool,
}

/// Why it does not need every frame.
#[derive(Clone, Copy, PartialEq)]
enum Throttle {
    None,
    Unseen,
    Composited,
}

#[derive(Default)]
pub(crate) struct Animations {
    pub(crate) now: f64,
    all: Map<u32, Animation>,
    by_node: Map<NodeId, SmallVec<[u32; 2]>>,
    last_id: u32,
    generation: u32,
    timelines: Map<u32, Progress>,
    /// By the node that they watch or have watched.
    watchers: Map<NodeId, SmallVec<[u32; 2]>>,
    /// Those that may have events for the next frame.
    changed: Vec<u32>,
    /// Those in skipped contents, whose events wait.
    silenced: Vec<u32>,
    /// The nodes whose animations may have been replaced.
    filled: Vec<NodeId>,
    /// Since the last frame, and before that.
    retired: [Vec<u32>; 2],
    pub(crate) names_are_stale: bool,
    pub(crate) has_throttled: bool,
    has_triggers: bool,
    /// The boxes without which running animations have no effect.
    /// The nodes that may have `Flags::LAGS`.
    pub(crate) lagging: Vec<NodeId>,
    last_sampled: Option<LastAnimated>,
    last_fade: core::cell::RefCell<Option<LastFade>>,
    pub(crate) watched: Set<BoxId>,
}

impl Animations {
    pub(crate) fn last_id(&self) -> u32 {
        self.last_id
    }
}

impl Animation {
    fn new(node: NodeId, kind: Kind, specified: Timing) -> Animation {
        Animation {
            node,
            wanted: None,
            owner: if matches!(kind, Kind::Script) {
                0
            } else {
                node
            },
            sequence: 0,
            is_exposed: matches!(kind, Kind::Script),
            kind,
            keyframes: Rc::new([]),
            default_easing: Easing::linear(),
            composite: Composite::Replace,
            tracks: Vec::new(),
            computed_for: None,
            trigger: None,
            deps: Deps::empty(),
            timing: specified.normalized(None),
            specified,
            clock: Clock::Document(0.0),
            css_timeline: Timeline::Auto,
            range: Default::default(),
            start: None,
            hold: None,
            previous: None,
            rate: 1.0,
            pending_rate: None,
            pending: Pending::None,
            aligns: false,
            is_finished: false,
            overridden: Overridden::empty(),
            replace_state: ReplaceState::Active,
            phase: Phase::Idle,
            sample: None,
            reported: (Phase::Idle, None),
            throttle: Throttle::None,
        }
    }

    fn follows_scroll(&self) -> bool {
        matches!(self.clock, Clock::Progress(..))
    }

    fn timeline_time(&self, now: f64) -> Option<f64> {
        match &self.clock {
            Clock::None => None,
            Clock::Document(origin) => Some(now - origin),
            Clock::Progress(_, snapshot) => snapshot.as_ref().map(Snapshot::time),
        }
    }

    fn unheld_time(&self, now: f64) -> Option<f64> {
        Some((self.timeline_time(now)? - self.start?) * self.rate + 0.0)
    }

    fn time(&self, now: f64) -> Option<f64> {
        self.hold.or_else(|| self.unheld_time(now))
    }

    fn start_for(&self, time: f64, now: f64) -> Option<f64> {
        Some(
            self.timeline_time(now)?
                - if self.rate == 0.0 {
                    0.0
                } else {
                    time / self.rate
                },
        )
    }

    fn effective_rate(&self) -> f64 {
        self.pending_rate.unwrap_or(self.rate)
    }

    fn apply_pending_rate(&mut self) {
        self.rate = self.pending_rate.take().unwrap_or(self.rate);
    }

    fn is_idle(&self, now: f64) -> bool {
        self.start.is_none() && self.pending == Pending::None && self.time(now).is_none()
    }

    /// Or idle.
    fn is_paused(&self) -> bool {
        self.pending == Pending::Pause || self.start.is_none() && self.pending == Pending::None
    }

    fn has_reached_end(&self, now: f64) -> bool {
        let (time, rate) = (self.time(now), self.effective_rate());
        time.is_some_and(|it| {
            rate > 0.0 && it >= self.timing.end() - EPSILON || rate < 0.0 && it <= EPSILON
        })
    }

    /// Whether the active phase is still to come.
    fn is_ahead(&self, phase: Phase) -> bool {
        phase == Phase::Before && self.rate > 0.0 || phase == Phase::After && self.rate < 0.0
    }

    fn is_running(&self, now: f64) -> bool {
        matches!(self.clock, Clock::Document(_))
            && (self.pending != Pending::None
                || self.start.is_some() && !self.has_reached_end(now) && self.rate != 0.0)
    }

    /// As fractions of the timeline.
    fn fractions(&self) -> [f64; 2] {
        let Clock::Progress(_, Some(snapshot)) = &self.clock else {
            return [0.0, 1.0];
        };
        [0, 1].map(|edge| {
            let whole = Lp::Fraction(edge as f32);
            let RangeEdge(name, offset) = &self.range[edge];
            snapshot.fraction(*name, offset.as_ref().unwrap_or(&whole))
        })
    }

    fn normalize(&mut self) {
        let [start, end] = self.fractions();
        self.timing = self.specified.normalized(
            self.follows_scroll()
                .then(|| (end - start).max(0.0) * 100.0),
        );
    }

    fn align(&mut self) {
        self.start = Some(self.fractions()[usize::from(self.effective_rate() < 0.0)] * 100.0);
    }

    fn excludes(&self) -> [bool; 2] {
        if self.trigger.as_ref().is_some_and(|it| it.is_awaited) && self.is_paused() {
            return [true; 2];
        }
        let (mut excludes, Clock::Progress(_, Some(snapshot))) =
            ([self.rate < 0.0, self.rate >= 0.0], &self.clock)
        else {
            return [self.rate < 0.0, self.rate >= 0.0];
        };
        let limits = [0.0, 1.0]
            .map(|it| snapshot.fraction(Some(RangeName::Scroll), &Lp::Fraction(it)) * 100.0);
        for (excludes, boundary) in excludes.iter_mut().zip(self.timing.boundaries()) {
            let at = self.start.unwrap_or(0.0) + boundary / self.rate;
            *excludes &= !limits.iter().any(|it| (at - it).abs() < 1e-3);
        }
        excludes
    }

    /// `false` if it would have to start at an end that it does not have.
    fn play(&mut self, now: f64, rewinds: bool) -> bool {
        let (time, end, rate) = (self.time(now), self.timing.end(), self.effective_rate());
        let seeks = rewinds && !self.follows_scroll();
        let seek = match time {
            _ if seeks && rate >= 0.0 && time.is_none_or(|it| it < 0.0 || it >= end) => Some(0.0),
            _ if seeks && rate < 0.0 && time.is_none_or(|it| it <= 0.0 || it > end) => Some(end),
            None if rate == 0.0 => Some(0.0),
            _ => None,
        };
        if seek == Some(f64::INFINITY) {
            return false;
        }
        self.hold = seek.or(self.hold);
        if rewinds && self.follows_scroll() {
            (self.aligns, self.hold) = (true, time);
        }
        self.start = self.start.filter(|_| self.hold.is_none());
        let has_work = self.hold.is_some()
            || self.follows_scroll()
            || self.pending == Pending::Pause
            || self.pending_rate.is_some();
        if has_work {
            self.pending = Pending::Play;
        }
        true
    }

    fn pause(&mut self, now: f64) -> bool {
        if self.is_paused() && !self.is_idle(now) {
            return true;
        }
        if self.time(now).is_none() {
            match self.follows_scroll() {
                true => self.aligns = true,
                false if self.rate < 0.0 && self.timing.end().is_infinite() => return false,
                false => {
                    self.hold = Some(if self.rate >= 0.0 {
                        0.0
                    } else {
                        self.timing.end()
                    })
                }
            }
        }
        self.pending = Pending::Pause;
        true
    }

    fn is_ready(&self, now: f64) -> bool {
        self.pending != Pending::None
            && self.timeline_time(now).is_some()
            && (self.start.is_some() || self.hold.is_some())
    }

    fn run_pending_task(&mut self, now: f64) {
        let (time, pending) = (
            self.time(now),
            core::mem::replace(&mut self.pending, Pending::None),
        );
        let changes = self.hold.is_some() || self.pending_rate.is_some();
        self.apply_pending_rate();
        if pending == Pending::Pause {
            (self.hold, self.start) = (time, None);
        } else if let Some(time) = time.filter(|_| changes) {
            (self.start, self.hold) = (
                self.start_for(time, now),
                (self.rate == 0.0).then_some(time),
            );
        }
    }

    fn seek_silently(&mut self, time: f64, now: f64) {
        match self
            .start_for(time, now)
            .filter(|_| self.hold.is_none() && self.start.is_some() && self.rate != 0.0)
        {
            Some(start) => self.start = Some(start),
            None => self.hold = Some(time),
        }
        self.start = self.start.filter(|_| self.timeline_time(now).is_some());
        (self.previous, self.aligns) = (None, false);
    }

    fn seek(&mut self, time: f64, now: f64) {
        self.seek_silently(time, now);
        if self.pending == Pending::Pause {
            (self.hold, self.start, self.pending) = (Some(time), None, Pending::None);
            self.apply_pending_rate();
        }
    }

    fn set_start(&mut self, start: Option<f64>, now: f64) {
        if start.is_some() && self.timeline_time(now).is_none() {
            self.hold = None;
        }
        let time = self.time(now);
        self.apply_pending_rate();
        self.hold = if start.is_none() {
            time
        } else {
            self.hold.filter(|_| self.rate == 0.0)
        };
        (self.start, self.pending, self.aligns) = (start, Pending::None, false);
    }

    fn finish(&mut self, now: f64) -> bool {
        let rate = self.effective_rate();
        if rate == 0.0 || rate > 0.0 && self.timing.end().is_infinite() {
            return false;
        }
        self.apply_pending_rate();
        let limit = if rate > 0.0 { self.timing.end() } else { 0.0 };
        self.seek_silently(limit, now);
        self.start = self.start.or_else(|| self.start_for(limit, now));
        if self.start.is_some() {
            self.hold = self.hold.filter(|_| self.pending != Pending::Pause);
            self.pending = Pending::None;
        }
        true
    }

    fn set_rate(&mut self, rate: f64, now: f64) {
        let (time, reverses) = (self.time(now), (rate < 0.0) != (self.rate < 0.0));
        (self.rate, self.pending_rate) = (rate, None);
        if !self.follows_scroll() {
            time.into_iter().for_each(|time| self.seek(time, now));
        } else if reverses && self.aligns && self.start.is_some() {
            self.align();
        }
    }

    fn update_rate(&mut self, rate: f64, now: f64) {
        let was_finished = self.has_reached_end(now);
        self.pending_rate = Some(rate);
        if self.pending != Pending::None {
        } else if self.is_paused() || self.time(now).is_none() {
            self.apply_pending_rate();
        } else if was_finished {
            let time = self.unheld_time(now);
            self.apply_pending_rate();
            self.start = time.and_then(|it| self.start_for(it, now));
        } else {
            self.play(now, false);
        }
    }

    fn reverse(&mut self, now: f64) -> bool {
        let original = self.pending_rate.replace(0.0 - self.effective_rate());
        let plays =
            !matches!(self.clock, Clock::None | Clock::Progress(_, None)) && self.play(now, true);
        self.pending_rate = if plays { self.pending_rate } else { original };
        plays
    }

    /// https://drafts.csswg.org/animation-triggers-1/#animation-trigger-behavior
    fn perform(&mut self, behavior: Behavior, now: f64) {
        let rate = self.effective_rate();
        let turns = behavior == Behavior::PlayForwards && rate < 0.0
            || behavior == Behavior::PlayBackwards && rate > 0.0;
        match behavior {
            Behavior::None => {}
            Behavior::Pause => _ = self.pause(now),
            Behavior::Reset | Behavior::Replay => {
                self.pause(now);
                self.seek(if rate < 0.0 { self.timing.end() } else { 0.0 }, now);
                if behavior == Behavior::Replay {
                    self.play(now, false);
                }
            }
            _ if turns => {
                self.pending_rate = Some(-rate);
                self.play(now, false);
            }
            _ if self.is_finished => {}
            _ => _ = self.play(now, false),
        }
    }

    fn set_clock(&mut self, clock: Clock, now: f64) {
        let (is_playing, followed_scroll, end) =
            (!self.is_paused(), self.follows_scroll(), self.timing.end());
        let progress = self
            .time(now)
            .map(|it| if end == 0.0 { 0.0 } else { it / end });
        (self.clock, self.computed_for) = (clock, None);
        self.normalize();
        let time = progress.map(|it| it * self.timing.end());
        if self.follows_scroll() {
            self.apply_pending_rate();
            (self.aligns, self.start, self.hold) = (true, None, None);
            match is_playing {
                true => _ = self.play(now, true),
                false => self.hold = time,
            }
        } else if followed_scroll {
            self.aligns = false;
            match time {
                Some(time) => self.seek(time, now),
                None if self.pending == Pending::Play => _ = self.play(now, true),
                None => {}
            }
        }
        self.hold = self.hold.filter(|_| self.start.is_none());
    }

    /// The timeline that it follows has moved on.
    fn follow(&mut self, snapshot: Option<Snapshot>, now: f64) {
        let Clock::Progress(_, old) = &mut self.clock else {
            return;
        };
        let old = core::mem::replace(old, snapshot);
        if old
            .zip(snapshot)
            .is_none_or(|(a, b)| !a.has_same_ranges(&b))
            && self.keyframes.iter().any(|it| it.range.is_some())
        {
            self.computed_for = None;
        }
        self.normalize();
        if snapshot.is_none() || self.is_idle(now) {
            return;
        }
        if !self.is_paused()
            && !self.aligns
            && self.pending == Pending::Play
            && let Some(hold) = self.hold.take()
        {
            self.start = self.start_for(hold, now);
        }
        if if self.is_paused() {
            self.start.is_none() && self.hold.is_none()
        } else {
            self.aligns
        } {
            let before = self.start;
            self.align();
            self.apply_pending_rate();
            if self.start != before {
                (self.hold, self.previous) = (None, None);
            }
        }
    }

    fn update_hold(&mut self, now: f64, did_seek: bool) {
        let time = if did_seek {
            self.time(now)
        } else {
            self.unheld_time(now)
        };
        if let Some(time) = time.filter(|_| self.start.is_some() && self.pending == Pending::None) {
            let (end, previous) = (self.timing.end(), self.previous.filter(|_| !self.aligns));
            if self.rate > 0.0 && time >= end {
                self.hold = Some(if did_seek {
                    time
                } else {
                    previous.map_or(end, |it| it.max(end))
                });
            } else if self.rate < 0.0 && time <= 0.0 {
                self.hold = Some(if did_seek {
                    time
                } else {
                    previous.map_or(0.0, |it| it.min(0.0))
                });
            } else if self.rate != 0.0 && self.timeline_time(now).is_some() {
                if let Some(hold) = self.hold.take().filter(|_| did_seek) {
                    self.start = self.start_for(hold, now);
                }
            }
        }
        self.previous = self.time(now);
    }

    fn order(&self) -> u8 {
        match (&self.kind, self.owner) {
            (_, 0) | (Kind::Script, _) => 2,
            (Kind::Transition { .. }, _) => 0,
            (Kind::Css(..), _) => 1,
        }
    }

    /// Among those with the same owner.
    fn rank(&self) -> (u8, usize, &str) {
        match &self.kind {
            Kind::Transition {
                name, generation, ..
            } if self.owner != 0 => (0, *generation as usize, name),
            Kind::Css(_, index) if self.owner != 0 => (1, *index, ""),
            _ => (2, self.sequence as usize, ""),
        }
    }

    fn offset_of(&self, frame: &Keyframe) -> Option<f32> {
        let Some(range) = frame.range else {
            return Some(frame.offset);
        };
        let (Clock::Progress(_, Some(snapshot)), [start, end]) = (&self.clock, self.fractions())
        else {
            return None;
        };
        (end > start).then(|| {
            ((snapshot.fraction(Some(range), &Lp::Fraction(frame.offset)) - start) / (end - start))
                as f32
        })
    }

    fn can_be_composited(&self) -> bool {
        let is_cheap = |it: &Track| {
            it.target
                .counts_as()
                .intersects(WillChange::TRANSFORM | WillChange::OPACITY)
        };
        !self.tracks.is_empty()
            && self.tracks.iter().all(is_cheap)
            && self.rate > 0.0
            && self.timing.iteration_start == 0.0
    }

    fn only_repaints(&self) -> bool {
        !self.tracks.is_empty()
            && self
                .tracks
                .iter()
                .all(|it| it.target.id().is_some_and(crate::restyle::only_repaints))
    }

    fn is_constant(&self) -> bool {
        !self.tracks.is_empty()
            && self.computed_for.is_some()
            && self.tracks.iter().all(|it| match &it.stops[..] {
                [first, .., last] => {
                    (first.offset, last.offset) == (0.0, 1.0)
                        && it
                            .stops
                            .iter()
                            .all(|it| it.adds.is_none() && it.value == first.value)
                }
                _ => false,
            })
    }

    /// Whether a number only changes its pace at the stops and at the jumps.
    fn is_straight(&self) -> bool {
        let is_so = |easing: &Easing| {
            matches!(easing, Easing::Steps(..=1000, _)) || *easing == Easing::linear()
        };
        is_so(&self.timing.easing)
            && self.tracks.iter().all(|it| {
                is_so(&it.easing)
                    && it
                        .stops
                        .iter()
                        .all(|it| it.adds.is_none() && is_so(&it.easing))
            })
    }

    /// Where in an iteration the values jump, and whether they only change there.
    fn jumps(&self) -> (Vec<f32>, bool) {
        let steps = |easing: &Easing, from: f32, to: f32| match easing {
            Easing::Steps(count @ ..=1000, _) => Some(
                (0..=*count)
                    .map(|it| mix(from, to, it as f32 / *count as f32))
                    .collect::<Vec<_>>(),
            ),
            _ => None,
        };
        if let Some(jumps) = steps(&self.timing.easing, 0.0, 1.0) {
            return (jumps, true);
        }
        let (mut jumps, mut only) = (Vec::new(), self.timing.easing == Easing::linear());
        for track in self
            .tracks
            .iter()
            .filter(|_| self.timing.easing == Easing::linear())
        {
            let starts = core::iter::once((0.0, &track.easing))
                .chain(track.stops.iter().map(|it| (it.offset, &it.easing)));
            for ((start, easing), end) in
                starts.zip(track.stops.iter().map(|it| it.offset).chain([1.0]))
            {
                match steps(easing, start, end) {
                    _ if start == end => jumps.push(end),
                    Some(steps) => jumps.extend(steps),
                    None => only = false,
                }
            }
        }
        jumps.retain(|it| *it > 0.0 && *it < 1.0);
        (jumps, only && !self.tracks.is_empty())
    }

    /// In how long it needs a frame.
    fn next_wake(&self, now: f64, for_iterations: bool) -> f64 {
        let (Some(time), timing) = (
            self.time(now)
                .filter(|_| self.pending == Pending::None && self.rate > 0.0),
            &self.timing,
        ) else {
            return 0.0;
        };
        let active = time - timing.delay;
        let until = match timing.phase(Some(time), [false, true]) {
            Phase::Before => -active,
            Phase::After | Phase::Idle => timing.end() - time,
            Phase::Active => {
                let progress = (active / timing.duration + timing.iteration_start) % 1.0;
                let next = match self.throttle {
                    Throttle::None => {
                        let (jumps, only) = self.jumps();
                        let either_way = jumps
                            .into_iter()
                            .map(f64::from)
                            .flat_map(|it| [it, 1.0 - it]);
                        if only {
                            either_way.filter(|it| *it > progress).fold(1.0, f64::min)
                        } else {
                            progress
                        }
                    }
                    _ if for_iterations => 1.0,
                    _ => f64::INFINITY,
                };
                ((next - progress) * timing.duration).min(timing.active_duration() - active)
            }
        };
        until / self.rate
    }
}

fn discrete<'a>(from: &'a Value, to: &'a Value, t: f32) -> &'a Value {
    let is_off = |value: &Value| {
        matches!(
            value,
            Value::Overlay(OverlayKind::None)
                | Value::ContentVisibility(ContentVisibility::Hidden)
                | Value::Display(DisplayValue(Display::None))
        )
    };
    let switches_at = if is_off(from) {
        f32::MIN_POSITIVE
    } else if is_off(to) {
        1.0
    } else {
        0.5
    };
    if t < switches_at { from } else { to }
}

impl Document {
    fn interpolate(&self, from: &Animated, to: &Animated, t: Mixing) -> Option<Animated> {
        match (from, to) {
            (Animated::Property(from), Animated::Property(to)) if from.id() != Id::Display => {
                from.lerp(to, t).map(Animated::Property)
            }
            (Animated::Custom(name, Some(from)), Animated::Custom(_, Some(to))) => {
                Some(Animated::Custom(
                    *name,
                    Some(self.styles.registry.get(name)?.lerp(from, to, t)?),
                ))
            }
            _ => None,
        }
    }

    fn value_in(&self, style: &Style, target: Target) -> Animated {
        match target {
            Target::Property(id) => Animated::Property(style.computed(id)),
            Target::Custom(name) => Animated::Custom(
                name,
                style.customs.get(name, &self.styles.registry).cloned(),
            ),
        }
    }

    fn sample_track(&self, track: &Track, sample: Sample, under: &Animated) -> Animated {
        let t = sample.progress as f32;
        let value = |stop: &Stop| {
            stop.adds
                .and_then(|how| self.interpolate(under, &stop.value, how))
                .unwrap_or_else(|| stop.value.clone())
        };
        let stops = &track.stops;
        let (first, last) = (&stops[0], &stops[stops.len() - 1]);
        let (from, to, easing) = if first.offset > 0.0
            && (t < first.offset || stops.len() == 1 && first.offset == 1.0)
        {
            (
                (0.0, under.clone()),
                (first.offset, value(first)),
                &track.easing,
            )
        } else if last.offset < 1.0 && (t >= last.offset || stops.len() == 1) {
            (
                (last.offset, value(last)),
                (1.0, under.clone()),
                &last.easing,
            )
        } else {
            let next = stops
                .partition_point(|it| it.offset <= t)
                .max(1)
                .min(stops.len() - 1);
            let (from, to) = (&stops[next.saturating_sub(1)], &stops[next]);
            (
                (from.offset, value(from)),
                (to.offset, value(to)),
                &from.easing,
            )
        };
        if from.0 == to.0 {
            return if t < from.0 { from.1 } else { to.1 };
        }
        let t = easing.apply(
            (sample.progress - f64::from(from.0)) / (f64::from(to.0) - f64::from(from.0)),
            sample.is_before,
        ) as f32;
        self.interpolate(&from.1, &to.1, Mixing::Lerp(t))
            .unwrap_or_else(|| match (&from.1, &to.1) {
                (Animated::Property(from), Animated::Property(to)) => {
                    Animated::Property(discrete(from, to, t).clone())
                }
                (from, to) => if t < 0.5 { from } else { to }.clone(),
            })
    }

    fn compute_tracks(
        &self,
        animation: &Animation,
        style: &Style,
        parent: &Style,
    ) -> (Vec<Track>, Deps) {
        let (mut tracks, mut all_deps): (Vec<Track>, _) = (Vec::new(), Deps::empty());
        let only = self
            .tree
            .element(animation.node)
            .map_or(Only::All, |it| Only::of(it.pseudo));
        let mut frames: Vec<_> = (0..)
            .zip(&*animation.keyframes)
            .filter_map(|(at, it)| Some((animation.offset_of(it)?, at, it)))
            .collect();
        bun_collections::index_sort::sort_slice_by(&mut frames, |a, b| a.0.total_cmp(&b.0));
        for (offset, at, frame) in frames {
            let (values, customs, deps) =
                self.compute_block(animation.node, &frame.block, style, parent);
            all_deps |= deps;
            let values = values
                .into_iter()
                .filter(|it| it.id().is_animatable() && only.allows(it.id()))
                .map(Animated::Property);
            for value in values.chain(customs.into_iter().map(|it| Animated::Custom(it.0, it.1))) {
                let target = value.target();
                let index = tracks
                    .iter()
                    .position(|it| it.target == target)
                    .unwrap_or_else(|| {
                        tracks.push(Track {
                            target,
                            stops: Vec::new(),
                            easing: animation.default_easing.clone(),
                            is_idle: false,
                        });
                        tracks.len() - 1
                    });
                let stops = &mut tracks[index].stops;
                stops.pop_if(|it| {
                    it.frame == at || it.offset == offset && !matches!(animation.kind, Kind::Script)
                });
                let easing = frame
                    .easing
                    .as_ref()
                    .unwrap_or(&animation.default_easing)
                    .clone();
                let reverts = |it: &Rc<Declaration>| matches!((it.prop, target, &it.value), (Prop::Custom(a), Target::Custom(b), Declared::Wide(Wide::RevertLayer | Wide::RevertRule)) if a == b);
                let adds = if frame.block.declarations().list.iter().any(reverts) {
                    Some(Mixing::Lerp(0.0))
                } else {
                    frame.adds.unwrap_or(animation.composite).mixing()
                };
                stops.push(Stop {
                    offset,
                    value,
                    easing,
                    adds,
                    frame: at,
                });
            }
        }
        for track in tracks
            .iter_mut()
            .filter(|it| it.target.id().is_some_and(|it| !it.affects_others()))
        {
            let under = self.value_in(style, track.target);
            track.is_idle = track
                .stops
                .iter()
                .all(|it| it.adds.is_none() && it.value == under);
        }
        (tracks, all_deps)
    }

    fn update_tracks(&mut self, id: u32, style: &Rc<Style>, parent: &Style) {
        let animation = &self.animations.all[&id];
        let is_current = animation
            .computed_for
            .as_ref()
            .is_some_and(|it| Rc::ptr_eq(it, style))
            && !animation.deps.intersects(
                !(Deps::INHERITED
                    | Deps::INK
                    | Deps::FONT_UNITS
                    | Deps::ABSOLUTE_FONT_SIZE
                    | Deps::FONT_SIZE_KEYWORD),
            );
        if is_current
            || matches!(animation.kind, Kind::Transition { .. })
                && !animation.overridden.contains(Overridden::KEYFRAMES)
        {
            return;
        }
        let ((tracks, deps), node) = (
            self.compute_tracks(animation, style, parent),
            animation.node,
        );
        if let Some(animation) = self.animations.all.get_mut(&id) {
            (animation.tracks, animation.deps, animation.computed_for) =
                (tracks, deps, Some(Rc::clone(style)));
        }
        self.forget_samples(node);
    }

    /// Those that it is the target or the owner of.
    fn animations_of(&self, node: NodeId) -> SmallVec<[u32; 2]> {
        match self.tree[node].has(Flags::ANIMATED) {
            true => self
                .animations
                .by_node
                .get(&node)
                .map_or_else(SmallVec::new, |it| SmallVec::from_slice(it)),
            false => SmallVec::new(),
        }
    }

    fn animated_values(
        &self,
        ids: &[u32],
        base: &Style,
        skips_idle: bool,
        progress: impl Fn(&Animation) -> Option<Sample>,
    ) -> Vec<Animated> {
        let mut values: Vec<Animated> = Vec::new();
        for animation in ids.iter().map(|it| &self.animations.all[it]) {
            let Some(t) = progress(animation) else {
                continue;
            };
            for track in &animation.tracks {
                let known = values.iter().position(|it| it.target() == track.target);
                if skips_idle && track.is_idle && known.is_none() {
                    continue;
                }
                let under = known.map_or_else(
                    || self.value_in(base, track.target),
                    |it| values.swap_remove(it),
                );
                values.push(with_current_color(base.ink.color, || {
                    self.sample_track(track, t, &under)
                }));
            }
        }
        values
    }

    fn stack_of(
        &self,
        node: NodeId,
        includes: impl Fn(u32, &Animation) -> bool,
    ) -> SmallVec<[u32; 2]> {
        let mut ids = self.animations_of(node);
        ids.retain(|it| {
            self.animations.all[it].node == node && includes(*it, &self.animations.all[it])
        });
        bun_collections::index_sort::sort_slice_by_key(&mut ids, |it| {
            self.animations.all[it].rank()
        });
        ids
    }

    fn effective_animations(&self, node: NodeId) -> SmallVec<[u32; 2]> {
        self.stack_of(node, |_, it| {
            it.sample.is_some() && it.replace_state != ReplaceState::Removed
        })
    }

    /// The style with the animations that are in effect.
    pub(crate) fn animate(
        &mut self,
        id: NodeId,
        rules: &RuleList,
        parent: &Style,
        base: &Rc<Style>,
    ) -> Rc<Style> {
        if !self.tree[id].has(Flags::ANIMATED) {
            return Rc::clone(base);
        }
        let ids = self.stack_of(id, |_, it| {
            (it.sample.is_some() || it.is_ahead(it.phase))
                && it.replace_state != ReplaceState::Removed
        });
        if ids.is_empty() {
            return Rc::clone(base);
        }
        ALLOWS_KEYWORDS.set(base.ink.interpolate_size == InterpolateSize::AllowKeywords);
        ids.iter()
            .for_each(|it| self.update_tracks(*it, base, parent));
        let only = Some(&self.animations.all[&ids[0]]).filter(|it| {
            ids.len() == 1
                && !matches!(it.kind, Kind::Transition { .. })
                && matches!(it.clock, Clock::Document(_))
                && !it
                    .deps
                    .intersects(!(Deps::INHERITED | Deps::INK | Deps::FONT_UNITS))
                && it
                    .tracks
                    .iter()
                    .all(|it| it.is_idle || it.target.id().is_some_and(Id::stands_alone))
                && self
                    .tree
                    .element(id)
                    .is_some_and(|it| it.pseudo == Pseudo::None)
        });
        let only = only.map(|it| {
            (
                Rc::clone(&it.keyframes),
                (it.default_easing.clone(), it.composite, it.sample),
            )
        });
        if let (Some((keyframes, how)), Some(last)) = (&only, &self.animations.last_sampled)
            && Rc::ptr_eq(&last.base, base)
            && Rc::ptr_eq(&last.keyframes, keyframes)
            && last.how == *how
        {
            return Rc::clone(&last.style);
        }
        let important = rules.important(base.flow());
        let values_on = |document: &Document, base: &Style| {
            let mut values = document.animated_values(&ids, base, true, |it| it.sample);
            let animations = || ids.iter().map(|it| &document.animations.all[it]);
            let in_transition = |target| {
                animations()
                    .any(|it| it.order() == 0 && it.tracks.iter().any(|it| it.target == target))
            };
            let is_overridden = |target| match target {
                Target::Property(id) => important.contains(&id) || id == Id::Overlay,
                Target::Custom(name) => rules.is_important_custom(name),
            };
            values.retain(|it| !is_overridden(it.target()) || in_transition(it.target()));
            values
        };
        let mut values = values_on(self, base);
        let mut style = Style::clone(base);
        let affects_others = values
            .iter()
            .any(|it| it.target().id().is_none_or(Id::affects_others));
        if affects_others {
            let cascade = |document: &Document, values: &[Animated]| {
                let (mut properties, mut customs) = (Vec::new(), Vec::new());
                for value in values {
                    match value {
                        Animated::Custom(name, value) => customs.push((*name, value.clone())),
                        Animated::Property(value) if value.id().affects_others() => {
                            properties.push(value.clone())
                        }
                        Animated::Property(_) => {}
                    }
                }
                document.compute_animated_style(id, rules, parent, &customs, &properties)
            };
            style = cascade(self, &values);
            let may_use_each_other = values.len() > 1
                && values.iter().any(|it| it.target().id().is_none())
                && ids
                    .iter()
                    .any(|it| !self.animations.all[it].deps.is_empty());
            if may_use_each_other {
                let under = Rc::new(style);
                ids.iter()
                    .for_each(|it| self.update_tracks(*it, &under, parent));
                style = cascade(self, &values_on(self, base));
            }
            if values
                .iter()
                .any(|it| it.target().id().is_some_and(|it| !it.affects_others()))
            {
                let under = Rc::new(style.clone());
                ids.iter()
                    .for_each(|it| self.update_tracks(*it, &under, parent));
                values = values_on(self, &under);
            }
            values.retain(|it| !it.target().id().is_none_or(Id::affects_others));
        }
        for value in &values {
            if let Animated::Property(value) = value {
                style.groups.set(value);
            }
        }
        style.deps |= ids.iter().map(|it| self.animations.all[it].deps).collect();
        style.animates = ids
            .iter()
            .flat_map(|it| &self.animations.all[it].tracks)
            .map(|it| it.target.counts_as())
            .collect();
        let stand_alone = !affects_others
            && values
                .iter()
                .all(|it| it.target().id().is_some_and(Id::stands_alone));
        if !stand_alone
            && (!Rc::ptr_eq(&style.layout, &base.layout) || !Rc::ptr_eq(&style.paint, &base.paint))
        {
            self.adjust_animated(id, &mut style, parent);
        }
        let style = Rc::new(style);
        if let Some((keyframes, how)) = only {
            self.animations.last_sampled = Some(LastAnimated {
                base: Rc::clone(base),
                keyframes,
                how,
                style: Rc::clone(&style),
            });
        }
        style
    }

    pub(crate) fn reserve_animation(&mut self) -> u32 {
        self.animations.last_id += 1;
        self.animations.last_id
    }

    fn link_animation(&mut self, id: u32, node: NodeId) {
        if node != 0 && !self.animations_of(node).contains(&id) {
            self.tree[node].set(Flags::ANIMATED);
            self.animations.by_node.entry(node).or_default().push(id);
        }
        self.forget_samples(node);
    }

    fn unlink_animation(&mut self, id: u32, node: NodeId) {
        self.forget_samples(node);
        if let Some(ids) = self.animations.by_node.get_mut(&node) {
            ids.retain(|it| *it != id);
            if ids.is_empty() {
                self.animations.by_node.remove(&node);
                self.tree[node].unset(Flags::ANIMATED);
            }
        }
    }

    fn add_animation(&mut self, id: u32, mut animation: Animation) {
        let node = animation.node;
        animation.sequence = id;
        self.animations.all.insert(id, animation);
        self.link_animation(id, node);
    }

    fn drop_animation(&mut self, id: u32) {
        let Some(animation) = self.animations.all.remove(&id) else {
            return;
        };
        self.unlink_animation(id, animation.node);
        self.unlink_animation(id, animation.owner);
        if let Some((originator, _)) = animation.wanted {
            self.unlink_animation(id, originator);
        }
    }

    pub(crate) fn event_target(&self, node: NodeId) -> (NodeId, Cow<'static, str>) {
        match self.tree.element(node).filter(|it| it.is_generated()) {
            Some(element) if let Pseudo::Transition(part, _) = element.pseudo => {
                (element.originator, self.name_of_part(node, part).into())
            }
            Some(element) => (element.originator, element.pseudo.name().into()),
            None => (node, "".into()),
        }
    }

    pub(crate) fn is_still_animated(&self, node: NodeId) -> bool {
        let now = self.animations.now;
        self.animations_of(node)
            .iter()
            .map(|it| &self.animations.all[it])
            .any(|it| {
                it.is_running(now) || it.is_paused() && it.hold.is_some() || it.follows_scroll()
            })
    }

    /// Whether it was on.
    pub(crate) fn stop_compositing(&mut self) -> bool {
        self.catch_up_with_compositor();
        let sampled: Vec<_> = self.compositor.sampled.keys().copied().collect();
        for it in sampled {
            self.forget_samples(it);
        }
        self.pictures.discard();
        core::mem::take(&mut self.compositor.is_on)
    }

    fn emit_css_event(&mut self, id: u32, stage: Stage, elapsed: f64) {
        let (animation, now) = (&self.animations.all[&id], self.animations.now);
        let (is_transition, name) = match &animation.kind {
            Kind::Transition { name, .. } if stage != Stage::Iteration => (true, Rc::clone(name)),
            Kind::Css(name, _) if stage != Stage::Run => (false, Rc::clone(name)),
            _ => return,
        };
        let scheduled = match (&animation.clock, animation.start) {
            (Clock::Document(origin), Some(start))
                if animation.rate != 0.0 && stage != Stage::Cancel =>
            {
                origin + start + (animation.timing.delay + elapsed) / animation.rate
            }
            _ => now,
        };
        let seconds = match animation.follows_scroll() {
            true => elapsed / animation.timing.duration * animation.specified.duration.max(0.0),
            false => elapsed,
        } / 1000.0;
        let (node, pseudo) = self.event_target(animation.owner);
        let finite = |it: f64| if it.is_finite() { it } else { 0.0 };
        self.emit(
            node,
            ForNode::Css(CssEvent {
                is_transition,
                stage,
                name,
                elapsed_seconds: finite(seconds),
                pseudo,
                animation: id,
                scheduled: finite(scheduled).min(now),
            }),
        );
    }

    /// Brings what depends on the current time of the animation up to date.
    fn update_animation(&mut self, id: u32, did_seek: bool) {
        self.update_animation_that(id, did_seek, true);
    }

    fn update_animation_that(&mut self, id: u32, did_seek: bool, may_finish: bool) {
        let now = self.animations.now;
        let Some(animation) = self.animations.all.get_mut(&id) else {
            return;
        };
        if may_finish {
            animation.update_hold(now, did_seek);
        }
        let (time, excludes) = (animation.time(now), animation.excludes());
        let (phase, sample) = (
            animation.timing.phase(time, excludes),
            animation.timing.sample(time, excludes),
        );
        let old_phase = core::mem::replace(&mut animation.phase, phase);
        let old_sample = core::mem::replace(&mut animation.sample, sample);
        let is_at_end = animation.has_reached_end(now) && !animation.is_paused();
        let finishes = is_at_end && may_finish;
        let has_finished = finishes && !animation.is_finished;
        let is_unfinished = !finishes && animation.is_finished;
        animation.is_finished = finishes;
        if animation.owner != 0
            && (animation.reported != (phase, sample.map(|it| it.iteration))
                || is_at_end != animation.is_finished
                || has_finished)
        {
            self.animations.changed.push(id);
        }
        let (node, is_exposed) = (animation.node, animation.is_exposed);
        let throttle = animation.throttle;
        let is_ahead = animation.is_ahead(phase);
        let is_stale = (sample.is_some() || is_ahead)
            && animation.computed_for.is_none()
            && !animation.keyframes.is_empty()
            || is_ahead != animation.is_ahead(old_phase);
        let may_lag =
            throttle != Throttle::None && old_phase == phase && !has_finished && !is_stale;
        let looks_the_same = may_lag && self.tree[node].has(Flags::LAGS)
            || old_sample.and(sample).is_some() && animation.is_constant();
        if finishes && sample.is_some() && animation.order() == 2 {
            self.animations.filled.push(node);
        }
        if old_phase != phase || has_finished {
            self.forget_samples(node);
        }
        if (old_sample != sample && !looks_the_same
            || is_stale
            || has_finished && throttle != Throttle::None)
            && node != 0
        {
            if !may_lag {
                self.tree.mark_style(node, Flags::REANIMATE);
                self.tree[node].unset(Flags::CATCHES_UP);
            } else if !self.tree[node].has(Flags::LAGS) {
                self.tree[node].set(Flags::LAGS);
                self.animations.lagging.push(node);
            }
        }
        if is_exposed && (has_finished || is_unfinished) {
            self.events.push(EngineEvent::Playback(
                id,
                if finishes {
                    Playback::Finish
                } else {
                    Playback::Unfinish
                },
            ));
        }
    }

    fn is_silenced(&self, id: u32) -> bool {
        self.has_skipped_contents()
            && self
                .animations
                .all
                .get(&id)
                .is_some_and(|it| self.tree.is_in_skipped_contents(it.owner))
    }

    fn report_changes(&mut self) {
        let mut ids = core::mem::take(&mut self.animations.changed);
        ids.append(&mut self.animations.silenced);
        let mut silenced: Vec<_> = ids.extract_if(.., |it| self.is_silenced(*it)).collect();
        silenced.sort_unstable();
        silenced.dedup();
        self.animations.silenced = silenced;
        ids.retain(|it| self.animations.all.get(it).is_some_and(|it| it.owner != 0));
        bun_collections::index_sort::sort_slice_unstable_by_key(&mut ids, |it| {
            (self.animations.all[it].order(), *it)
        });
        ids.dedup();
        for id in ids {
            let Some(animation) = self.animations.all.get_mut(&id) else {
                continue;
            };
            let (timing, phase, iteration) = (
                &animation.timing,
                animation.phase,
                animation.sample.map(|it| it.iteration),
            );
            let (old_phase, old_iteration) =
                core::mem::replace(&mut animation.reported, (phase, iteration));
            let active = timing.active_duration();
            let start = (-timing.delay).min(active).max(0.0);
            let end = (timing.end() - timing.delay).min(active).max(0.0);
            let boundary = iteration
                .zip(old_iteration)
                .map_or(0.0, |(new, old)| if old > new { new + 1.0 } else { new });
            let events: &[(Stage, f64)] = match (old_phase, phase) {
                (Phase::Idle, Phase::Before) => &[(Stage::Run, start)],
                (Phase::Idle, Phase::Active) => &[(Stage::Run, start), (Stage::Start, start)],
                (Phase::Idle, Phase::After) => &[
                    (Stage::Run, start),
                    (Stage::Start, start),
                    (Stage::End, end),
                ],
                (Phase::Before, Phase::Active) => &[(Stage::Start, start)],
                (Phase::Before, Phase::After) => &[(Stage::Start, start), (Stage::End, end)],
                (Phase::Active, Phase::After) => &[(Stage::End, end)],
                (Phase::Active, Phase::Before) => &[(Stage::End, start)],
                (Phase::After, Phase::Active) => &[(Stage::Start, end)],
                (Phase::After, Phase::Before) => &[(Stage::Start, end), (Stage::End, start)],
                (Phase::Before | Phase::Active, Phase::Idle) => &[(Stage::Cancel, start)],
                (Phase::Active, Phase::Active) if iteration != old_iteration => &[(
                    Stage::Iteration,
                    (boundary - timing.iteration_start) * timing.duration,
                )],
                _ => &[],
            };
            let is_over = animation.order() == 0 && animation.is_finished && !animation.is_exposed;
            events
                .iter()
                .for_each(|(kind, elapsed)| self.emit_css_event(id, *kind, *elapsed));
            if is_over {
                self.retire(id);
            }
        }
    }

    fn remove_replaced_animations(&mut self) {
        let mut nodes = core::mem::take(&mut self.animations.filled);
        nodes.sort_unstable();
        nodes.dedup();
        let is_replaceable = |_, it: &Animation| {
            it.order() == 2
                && it.is_finished
                && it.sample.is_some()
                && it.replace_state != ReplaceState::Removed
                && matches!(it.clock, Clock::Document(_))
        };
        nodes.retain(|it| self.tree.contains(*it) && self.stack_of(*it, is_replaceable).len() > 1);
        if nodes.is_empty() {
            return;
        }
        self.update_style();
        for node in nodes {
            let (mut covered, mut removed) = (Vec::new(), Vec::new());
            for id in self.stack_of(node, is_replaceable).into_iter().rev() {
                let Some(animation) = self.animations.all.get_mut(&id) else {
                    continue;
                };
                if animation.replace_state == ReplaceState::Active
                    && animation
                        .tracks
                        .iter()
                        .all(|it| covered.contains(&it.target))
                    && !covered.is_empty()
                {
                    animation.replace_state = ReplaceState::Removed;
                    self.tree.mark_style(node, Flags::REANIMATE);
                    removed.push(id);
                } else {
                    covered.extend(animation.tracks.iter().map(|it| it.target));
                }
            }
            self.events.extend(
                removed
                    .into_iter()
                    .rev()
                    .map(|id| EngineEvent::Playback(id, Playback::Remove)),
            );
        }
    }

    fn disown(&mut self, id: u32) {
        match self.animations.all.get_mut(&id) {
            Some(animation) if animation.is_exposed => {
                let (owner, node) = (core::mem::take(&mut animation.owner), animation.node);
                animation.sequence = 0;
                if owner != node {
                    self.unlink_animation(id, owner);
                }
            }
            _ => self.retire(id),
        }
    }

    /// It stays until its events, which scripts can get it from, have been dispatched.
    fn retire(&mut self, id: u32) {
        let Some(animation) = self.animations.all.get_mut(&id) else {
            return;
        };
        let linked = [
            core::mem::take(&mut animation.node),
            core::mem::take(&mut animation.owner),
        ];
        linked
            .into_iter()
            .for_each(|it| self.unlink_animation(id, it));
        self.animations.retired[0].push(id);
    }

    fn cancel(&mut self, id: u32) {
        let now = self.animations.now;
        let Some(animation) = self
            .animations
            .all
            .get_mut(&id)
            .filter(|it| !it.is_idle(now))
        else {
            return;
        };
        let elapsed = (animation.time(now).unwrap_or(0.0) - animation.timing.delay)
            .min(animation.timing.active_duration())
            .max(0.0);
        let was_pending =
            core::mem::replace(&mut animation.pending, Pending::None) != Pending::None;
        animation.apply_pending_rate();
        (
            animation.start,
            animation.hold,
            animation.previous,
            animation.is_finished,
        ) = (None, None, None, false);
        let was_ahead = animation.is_ahead(animation.phase);
        animation.phase = Phase::Idle;
        let (phase, _) = core::mem::replace(&mut animation.reported, (Phase::Idle, None));
        let (node, is_exposed, is_owned) =
            (animation.node, animation.is_exposed, animation.owner != 0);
        if (animation.sample.take().is_some() || was_ahead) && node != 0 {
            self.tree.mark_style(node, Flags::REANIMATE);
        }
        self.forget_samples(node);
        if is_owned && matches!(phase, Phase::Before | Phase::Active) {
            self.emit_css_event(id, Stage::Cancel, elapsed);
        }
        if is_exposed {
            self.events
                .push(EngineEvent::Playback(id, Playback::Cancel { was_pending }));
        }
    }

    fn cancel_unless_finished(&mut self, id: u32) {
        match self.animations.all[&id].is_finished {
            true => self.report_changes(),
            false => self.cancel(id),
        }
        self.disown(id);
    }

    pub(crate) fn cancel_css_animations(&mut self, node: NodeId) {
        for id in self.animations_of(node) {
            if self.animations.all[&id].owner == node {
                self.cancel(id);
                self.disown(id);
            }
        }
    }

    /// The node is about to be freed.
    pub(crate) fn orphan_animations(&mut self, node: NodeId) {
        self.cancel_css_animations(node);
        for id in self.animations.by_node.remove(&node).unwrap_or_default() {
            let Some(animation) = self.animations.all.get_mut(&id) else {
                continue;
            };
            animation.wanted = animation.wanted.filter(|it| it.0 != node);
            animation.node = if animation.node == node {
                0
            } else {
                animation.node
            };
        }
        for id in self.animations.watchers.remove(&node).unwrap_or_default() {
            self.animations
                .timelines
                .get_mut(&id)
                .into_iter()
                .filter(|it| it.watched.node == node)
                .for_each(|it| it.watched.node = 0);
        }
    }

    pub(crate) fn pseudo_element_created(
        &mut self,
        originator: NodeId,
        pseudo: Pseudo,
        node: NodeId,
    ) {
        for id in self.animations_of(originator) {
            if let Some(animation) = self
                .animations
                .all
                .get_mut(&id)
                .filter(|it| it.wanted == Some((originator, pseudo)))
            {
                (animation.node, animation.computed_for) = (node, None);
                self.link_animation(id, node);
            }
        }
    }

    pub(crate) fn start_pending_animations(&mut self) {
        let now = self.animations.now;
        if !self
            .animations
            .all
            .values()
            .any(|it| it.pending != Pending::None)
        {
            return;
        }
        let mut ready: Vec<u32> = self
            .animations
            .all
            .iter()
            .filter(|it| it.1.is_ready(now))
            .map(|it| *it.0)
            .collect();
        ready.sort_unstable();
        for id in ready {
            let Some(animation) = self.animations.all.get_mut(&id) else {
                continue;
            };
            animation.run_pending_task(now);
            if self.compositor.is_on && animation.can_be_composited() {
                self.pictures.outdate();
            }
            if animation.is_exposed {
                self.events.push(EngineEvent::Playback(id, Playback::Ready));
            }
            self.update_animation(id, false);
        }
    }

    /// Between frames.
    pub(crate) fn clock(&self) -> f64 {
        self.animations.now
    }

    pub(crate) fn advance_clock(&mut self, now: f64) {
        self.animations.now = now;
        let all = self
            .animations
            .all
            .iter()
            .filter(|it| it.1.start.is_some() && !it.1.is_finished && !it.1.follows_scroll());
        let mut ids: SmallVec<[u32; 16]> = all.map(|it| *it.0).collect();
        ids.sort_unstable();
        ids.into_iter()
            .for_each(|id| self.update_animation_that(id, false, !self.is_silenced(id)));
    }

    pub(crate) fn set_time(&mut self, now: f64) {
        if self.compositor.sampled.is_empty() {
            self.compositor.clock_offset = crate::platform::now() - now;
        }
        if self.animations.retired.iter().any(|it| !it.is_empty()) {
            self.animations.retired.reverse();
            for id in core::mem::take(&mut self.animations.retired[0]) {
                if self
                    .animations
                    .all
                    .get(&id)
                    .is_some_and(|it| !it.is_exposed)
                {
                    self.drop_animation(id);
                }
            }
        }
        self.advance_clock(now.max(self.animations.now));
        self.start_pending_animations();
        self.advance_smooth_scrolls(now);
        self.update_scroll_timelines();
        if !self.animations.filled.is_empty() {
            self.remove_replaced_animations();
        }
        if !self.animations.changed.is_empty() {
            self.report_changes();
        }
        if !self.animated_vectors.get_mut().is_empty() {
            self.advance_vectors(now);
        }
        self.resized_vectors.sweep(now);
        self.smil.set_time(now);
    }

    // ───────────────────────────── timelines ─────────────────────────────

    fn add_timeline(&mut self, watched: Watched, is_from_script: bool) -> u32 {
        let id = self.reserve_animation();
        self.watch(id, watched.node);
        self.animations.timelines.insert(
            id,
            Progress {
                watched,
                snapshot: None,
                is_exposed: is_from_script,
                is_from_script,
            },
        );
        id
    }

    /// For `orphan_animations` to be called.
    fn watch(&mut self, timeline: u32, node: NodeId) {
        self.animations
            .watchers
            .entry(node)
            .or_default()
            .push(timeline);
        if node != 0 {
            self.tree[node].set(Flags::WATCHED_BY_TIMELINE);
        }
    }

    fn css_clock(&mut self, node: NodeId, timeline: &Timeline) -> Clock {
        match (timeline, self.find_timeline(node, timeline)) {
            (Timeline::Auto, _) => Clock::Document(0.0),
            (_, None) => Clock::None,
            (_, Some(watched)) => {
                let watchers = self
                    .animations
                    .watchers
                    .get(&watched.node)
                    .into_iter()
                    .flatten();
                let known = watchers
                    .filter_map(|id| Some((id, self.animations.timelines.get(id)?)))
                    .find(|it| !it.1.is_from_script && it.1.watched == watched);
                match known.map(|it| (*it.0, it.1.snapshot)) {
                    Some((id, snapshot)) => Clock::Progress(id, snapshot),
                    None => Clock::Progress(self.add_timeline(watched, false), None),
                }
            }
        }
    }

    fn change_clock(&mut self, id: u32, clock: Clock) {
        let Some(animation) = self.animations.all.get_mut(&id) else {
            return;
        };
        match (&animation.clock, &clock) {
            (Clock::None, Clock::None) => {}
            (Clock::Document(a), Clock::Document(b)) if a == b => {}
            (Clock::Progress(a, _), Clock::Progress(b, _)) if a == b => {}
            _ => {
                animation.set_clock(clock, self.animations.now);
                let node = animation.node;
                self.forget_samples(node);
                self.update_animation(id, false);
                self.needs_frame = true;
            }
        }
    }

    /// The styles of all elements are known.
    pub(crate) fn find_named_timelines(&mut self) {
        self.animations.names_are_stale = false;
        let follows_name = |it: &Animation| {
            matches!(it.css_timeline, Timeline::Named(_))
                && it.owner != 0
                && !it.overridden.contains(Overridden::TIMELINE)
        };
        let all = self.animations.all.iter().filter(|it| follows_name(it.1));
        let followers: Vec<_> = all
            .map(|(id, it)| (*id, it.owner, it.css_timeline.clone()))
            .collect();
        for (id, node, timeline) in followers {
            let clock = self.css_clock(node, &timeline);
            self.change_clock(id, clock);
        }
        if self.animations.has_triggers {
            self.update_triggers(false);
        }
        self.scrolling.declarers.take();
    }

    fn set_trigger(&mut self, id: u32, by: Option<TriggeredBy>, behaviors: [Behavior; 2]) {
        let Some(animation) = self.animations.all.get_mut(&id) else {
            return;
        };
        let is_new = animation.trigger.as_ref().map(|it| &it.by) != by.as_ref();
        let is_awaited = is_new
            && by.is_some()
            && animation.is_idle(self.animations.now)
            && animation.pause(self.animations.now);
        animation.trigger = by.map(
            |by| match animation.trigger.take().filter(|it| it.by == by) {
                Some(old) => Box::new(Trigger { behaviors, ..*old }),
                None => Box::new(Trigger {
                    by,
                    behaviors,
                    source: 0,
                    is_active: false,
                    is_paused_by_style: false,
                    is_awaited,
                }),
            },
        );
        self.animations.has_triggers |= animation.trigger.is_some();
        self.needs_frame |= animation.trigger.is_some();
        if is_awaited {
            self.update_animation(id, false);
        }
    }

    /// The element that declares it, and whether its timeline is in the activation range and in the active range.
    fn trigger_state(
        &self,
        node: NodeId,
        by: &TriggeredBy,
        is_laid_out: bool,
    ) -> (NodeId, Option<[bool; 2]>) {
        match by {
            TriggeredBy::Name(name) => self
                .find_trigger(node, name, is_laid_out)
                .unwrap_or_default(),
            TriggeredBy::Timeline(..) if !is_laid_out => (0, None),
            TriggeredBy::Timeline(u32::MAX, _) => (0, Some([true; 2])),
            TriggeredBy::Timeline(id, ranges) => (
                0,
                self.animations
                    .timelines
                    .get(id)
                    .and_then(|it| Some(self.snapshot(&it.watched)?.is_in(ranges))),
            ),
        }
    }

    fn update_triggers(&mut self, is_laid_out: bool) {
        let now = self.animations.now;
        let all = self.animations.all.iter().filter_map(|(id, it)| {
            Some((
                *id,
                self.trigger_state(it.owner, &it.trigger.as_ref()?.by, is_laid_out),
            ))
        });
        let mut states: Vec<_> = all.collect();
        self.scrolling.declarers.take();
        self.animations.has_triggers = !states.is_empty();
        bun_collections::index_sort::sort_slice_unstable_by_key(&mut states, |it| it.0);
        for (id, (source, state)) in states {
            let Some(animation) = self.animations.all.get_mut(&id) else {
                continue;
            };
            let Some(trigger) = &mut animation.trigger else {
                continue;
            };
            trigger.is_active &= core::mem::replace(&mut trigger.source, source) == source;
            if state.is_none_or(|it| it[usize::from(trigger.is_active)] == trigger.is_active) {
                continue;
            }
            let behavior = trigger.behaviors[usize::from(trigger.is_active)];
            trigger.is_active = !trigger.is_active;
            if trigger.is_paused_by_style || animation.is_idle(now) {
                continue;
            }
            animation.trigger.iter_mut().for_each(|it| {
                it.is_awaited = behavior == Behavior::Reset
                    || it.is_awaited && matches!(behavior, Behavior::None | Behavior::Pause)
            });
            animation.perform(behavior, now);
            let node = animation.node;
            self.forget_samples(node);
            self.update_animation(id, matches!(behavior, Behavior::Reset | Behavior::Replay));
            self.needs_frame = true;
        }
    }

    pub(crate) fn update_scroll_timelines(&mut self) {
        if self.animations.has_triggers {
            self.update_triggers(true);
        }
        if self.animations.timelines.is_empty() {
            return;
        }
        let snapshots: Vec<_> = self
            .animations
            .timelines
            .iter()
            .map(|(id, it)| (*id, self.snapshot(&it.watched)))
            .collect();
        for (id, snapshot) in snapshots {
            self.animations
                .timelines
                .get_mut(&id)
                .into_iter()
                .for_each(|it| it.snapshot = snapshot);
        }
        let (mut used, mut followers) = (Set::default(), Vec::new());
        for (id, animation) in &mut self.animations.all {
            if let Clock::Progress(timeline, _) = animation.clock {
                used.insert(timeline);
                animation.follow(
                    self.animations
                        .timelines
                        .get(&timeline)
                        .and_then(|it| it.snapshot),
                    self.animations.now,
                );
                followers.push(*id);
            }
        }
        let (
            count,
            Animations {
                timelines,
                watchers,
                ..
            },
        ) = (self.animations.timelines.len(), &mut self.animations);
        timelines.retain(|id, it| it.is_exposed || used.contains(id));
        if timelines.len() < count {
            watchers.retain(|_, it| {
                it.retain(|id| timelines.contains_key(id));
                !it.is_empty()
            });
        }
        followers.sort_unstable();
        followers
            .into_iter()
            .for_each(|id| self.update_animation(id, false));
    }

    pub(crate) fn is_animating(&self) -> bool {
        let now = self.animations.now;
        !self.animations.changed.is_empty()
            || !self.animations.filled.is_empty()
            || !self.animated_vectors.borrow().is_empty()
            || (self.smil.needs_update || !self.smil.is_empty()) && self.smil.next_wake() < 17.0
            || self
                .animations
                .silenced
                .iter()
                .any(|it| !self.is_silenced(*it))
            || self.animations.all.values().any(|it| {
                it.is_ready(now)
                    || it.is_running(now)
                        && it.next_wake(now, false) < 17.0
                        && !self.is_in_skipped_contents(it.owner)
            })
    }

    pub(crate) fn next_wake(&self, for_iterations: bool) -> f64 {
        let now = self.animations.now;
        let running = self
            .animations
            .all
            .values()
            .filter(|it| it.is_running(now) && !self.is_in_skipped_contents(it.owner));
        let scrollbars = self.scrolling.wakes(now);
        running
            .map(|it| it.next_wake(now, for_iterations))
            .chain(scrollbars)
            .fold(
                self.smil
                    .next_wake()
                    .min(self.boxes.next_sweep(now))
                    .min(self.resized_vectors.next_sweep(now)),
                f64::min,
            )
            .max(0.0)
    }

    // ───────────────────────────── without frames ─────────────────────────────

    /// The animations of the node have changed.
    fn forget_samples(&mut self, node: NodeId) {
        if self.compositor.sampled.remove(&node).is_some() {
            self.pictures.outdate();
            self.boxes.mark_ink(self.tree[node].layout_box);
        }
        if self.tree[node].has(Flags::LAGS) {
            self.tree.mark_style(node, Flags::REANIMATE);
        }
        self.tree[node].unset(Flags::CATCHES_UP | Flags::LAGS);
        for id in self.animations_of(node) {
            self.animations
                .all
                .get_mut(&id)
                .into_iter()
                .for_each(|it| it.throttle = Throttle::None);
        }
    }

    /// Before the style or the position of the node is looked at.
    pub(crate) fn stop_lagging(&mut self, node: NodeId) {
        let lags = |it: &NodeId| self.tree[*it].has(Flags::LAGS);
        self.animations.lagging.retain(lags);
        if !self.animations.lagging.is_empty() {
            for it in core::iter::once(node)
                .chain(self.tree.flat_ancestors(node))
                .filter(lags)
            {
                if !self.tree[it].has(Flags::REANIMATE) {
                    self.tree[it].set(Flags::CATCHES_UP);
                }
                self.tree[it].unset(Flags::LAGS);
                self.tree.mark_style(it, Flags::REANIMATE);
            }
        }
    }

    pub(crate) fn catch_up_with_compositor(&mut self) {
        if self.animations.has_throttled && crate::platform::renderer().is_some() {
            let now = crate::platform::now() - self.compositor.clock_offset;
            if now > self.animations.now + 16.0 {
                self.advance_clock(now);
            }
        }
    }

    fn has_animated_inline_box_in(&self, node: NodeId) -> bool {
        let mut inline = self
            .rendered_children(node)
            .filter(|it| self.tree.style(*it).is_some() && self.own_box(*it).is_none());
        inline.any(|it| self.tree[it].has(Flags::ANIMATED) || self.has_animated_inline_box_in(it))
    }

    fn sample_for_compositor(
        &self,
        node: NodeId,
        own: Option<BoxId>,
        size: [f32; 2],
    ) -> Option<Sampled> {
        let (now, ids) = (self.animations.now, self.effective_animations(node));
        let is_live = |it: &Animation| {
            it.follows_scroll() && it.start.is_some()
                || it.is_running(now) && it.phase == Phase::Active
        };
        let counts_as = |it: &Animation| {
            it.tracks
                .iter()
                .map(|it| it.target.counts_as())
                .collect::<WillChange>()
        };
        let all = ids.iter().map(|it| &self.animations.all[it]);
        let is_relevant = |it: &&Animation| {
            is_live(it) && counts_as(it).intersects(WillChange::TRANSFORM | WillChange::OPACITY)
        };
        let live: SmallVec<[&Animation; 2]> = all.filter(is_relevant).collect();
        let first = *live.first()?;
        let is_like_first = |it: &&Animation| {
            it.follows_scroll() == first.follows_scroll() && it.pending == Pending::None
        };
        (live.iter().all(|it| it.can_be_composited()) && live.iter().all(is_like_first))
            .then_some(())?;
        let targets: WillChange = live.iter().map(|it| counts_as(it)).collect();
        match own.map(|it| &self.boxes[it]) {
            Some(it) => (it.style.effects.backface == Backface::Visible && !it.is_foreign_object)
                .then_some(())?,
            None => {
                (!self.has_animated_inline_box_in(node)
                    && !targets.contains(WillChange::TRANSFORM)
                    && !first.follows_scroll())
                .then_some(())?;
            }
        }

        let base = self.tree.element(node)?.base_style.as_ref()?;
        let only_fades =
            targets == WillChange::OPACITY && ids.len() == 1 && !first.follows_scroll();
        let (timeline, mut positions): (_, Vec<f32>);
        let time_at: Box<dyn Fn(&Animation, f32) -> f64>;
        if let Clock::Progress(_, snapshot) = &first.clock {
            let (snapshot, origin) = (snapshot.filter(|_| live.len() == 1)?, first.start?);
            let ([start, end], min) = (
                snapshot.range(),
                self.scroll_range(self.own_box(snapshot.source)?)[snapshot.axis][0],
            );
            let [from, to] = first
                .fractions()
                .map(|it| mix(start, end, it as f32).max(0.0).min(snapshot.extent));
            (min == 0.0 && first.timing.fill == FillMode::Both && to > from).then_some(())?;
            timeline = crate::compositor::Timeline::Offset(snapshot.source, snapshot.axis);
            positions = (0..=64).map(|it| mix(from, to, it as f32 / 64.0)).collect();
            time_at = Box::new(move |it, at| {
                (f64::from((at - start) / (end - start)) * 100.0 - origin) * it.rate
            });
        } else {
            let alternates = |it: &Animation| {
                matches!(
                    it.timing.direction,
                    AnimationDirection::Alternate | AnimationDirection::AlternateReverse
                )
            };
            let cycle = |it: &Animation| {
                let (timing, iterations) = (&it.timing, 1.0 + f64::from(alternates(it)));
                let start = it.start.unwrap_or(now) + timing.delay / it.rate;
                (
                    start,
                    timing.duration * iterations / it.rate,
                    timing.iterations / iterations,
                )
            };
            let (mut start, mut length, mut cycles) = cycle(first);
            let is_one_cycle = live.iter().all(|it| cycle(it) == cycle(first));
            if !is_one_cycle {
                let end = live
                    .iter()
                    .map(|it| cycle(it))
                    .map(|it| it.0 + it.1 * it.2)
                    .fold(f64::INFINITY, f64::min);
                (start, length, cycles) = (
                    now,
                    Some(end - now).filter(|it| *it > 0.0 && *it <= 4000.0)?,
                    1.0,
                );
            }
            timeline = crate::compositor::Timeline::Time {
                start,
                cycle: length,
                cycles,
            };
            let is_same = |it: &&LastFade| {
                only_fades
                    && (it.rate, it.under) == (first.rate, base.effects.opacity.0)
                    && it.timing == first.timing
                    && it.tracks == first.tracks
            };
            if let Some(known) = self.animations.last_fade.borrow().as_ref().filter(is_same) {
                return Some(Sampled {
                    timeline,
                    size,
                    transforms: Vec::new(),
                    opacities: known.opacities.clone(),
                });
            }
            let is_straight =
                targets == WillChange::OPACITY && ids.len() == 1 && first.is_straight();
            let count = if is_straight {
                2
            } else {
                (length / 16.0).clamp(60.0, 240.0) as u32
            };
            positions = (0..=count).map(|it| it as f32 / count as f32).collect();
            let jumps: Vec<f32> = live
                .iter()
                .flat_map(|it| it.jumps().0)
                .flat_map(|it| [it, 1.0 - it])
                .collect();
            (jumps.is_empty() || is_one_cycle).then_some(())?;
            let stops = live
                .iter()
                .filter(|_| is_one_cycle)
                .flat_map(|it| &it.tracks)
                .flat_map(|it| &it.stops);
            let mut corners: Vec<f32> = stops.flat_map(|it| [it.offset, 1.0 - it.offset]).collect();
            corners.extend(jumps.iter().flat_map(|it| [*it; 2]));
            match alternates(first) {
                true => positions.extend(corners.iter().flat_map(|it| [it / 2.0, 0.5 + it / 2.0])),
                false => positions.extend(corners),
            }
            bun_collections::index_sort::sort_slice_by(&mut positions, f32::total_cmp);
            time_at = Box::new(move |it, at| {
                (start + length * f64::from(at) - it.start.unwrap_or(now)) * it.rate
            });
        }

        let (mut style, mut transforms, mut opacities) =
            (Style::clone(base), Vec::new(), Vec::new());
        for same in positions.chunk_by(|a, b| a == b) {
            let (at, is_last) = (
                same[0],
                same.as_ptr_range().end == positions.as_ptr_range().end,
            );
            let sides: &[f64] = if is_last {
                &[-0.01]
            } else if same.len() > 1 && at > 0.0 {
                &[-0.01, 0.01]
            } else {
                &[0.01]
            };
            for side in sides {
                let progress =
                    |it: &Animation| match live.iter().any(|live| core::ptr::eq(*live, it)) {
                        true => it
                            .timing
                            .sample(Some(time_at(it, at) + side), [false, true])
                            .or(it.sample),
                        false => it.sample,
                    };
                for value in self.animated_values(&ids, base, false, progress) {
                    if let (Animated::Property(value), false) =
                        (&value, value.target().counts_as().is_empty())
                    {
                        style.groups.set(value);
                    }
                }
                transforms.extend(
                    targets
                        .contains(WillChange::TRANSFORM)
                        .then(|| (at, style.transform(size[0], size[1]))),
                );
                opacities.extend(
                    targets
                        .contains(WillChange::OPACITY)
                        .then_some((at, [style.effects.opacity.0])),
                );
            }
        }
        let linear = 0.05 / size[0].max(size[1]).max(1.0);
        let transforms = simplify(&transforms, [linear, linear, linear, linear, 0.05, 0.05]);
        let opacities = simplify(&opacities, [0.002]);
        if only_fades {
            let (timing, tracks) = (first.timing.clone(), first.tracks.clone());
            self.animations.last_fade.replace(Some(LastFade {
                timing,
                rate: first.rate,
                tracks,
                under: base.effects.opacity.0,
                opacities: opacities.clone(),
            }));
        }
        Some(Sampled {
            timeline,
            size,
            transforms,
            opacities,
        })
    }

    /// Before painting.
    pub(crate) fn prepare_animations(&mut self) {
        let now = self.animations.now;
        let live = self
            .animations
            .all
            .values()
            .filter(|it| it.node != 0 && (it.is_running(now) || it.follows_scroll()));
        let nodes: Set<NodeId> = live.map(|it| it.node).collect();
        let watched = nodes
            .iter()
            .flat_map(|it| [*it, self.tree.flat_parent(*it)])
            .map(|it| self.nearest_box(it))
            .collect();
        let old = core::mem::replace(&mut self.animations.watched, watched);
        let changed: Vec<BoxId> = old
            .symmetric_difference(&self.animations.watched)
            .copied()
            .collect();
        for it in changed {
            self.repaint_box(it);
        }
        for node in nodes.into_iter().filter(|_| self.compositor.is_on) {
            let own = self.own_box(node);
            let size = own.map_or([0.0; 2], |it| {
                [
                    self.boxes[it].layout.size.width,
                    self.boxes[it].layout.size.height,
                ]
            });
            let is_current = |it: &Rc<Sampled>| {
                it.size == size
                    && (own.is_some() || !self.has_animated_inline_box_in(node))
                    && matches!(it.timeline, crate::compositor::Timeline::Time { .. })
            };
            if !self.compositor.sampled.get(&node).is_some_and(is_current) {
                let had = match self.sample_for_compositor(node, own, size).filter(|it| {
                    it.transforms.is_empty() || own.is_none_or(|it| self.has_simple_transform(it))
                }) {
                    Some(sampled) => self
                        .compositor
                        .sampled
                        .insert(node, Rc::new(sampled))
                        .is_none(),
                    None => self.compositor.sampled.remove(&node).is_some(),
                };
                if had || self.compositor.sampled.contains_key(&node) {
                    self.boxes.mark_ink(self.tree[node].layout_box);
                }
            }
        }
    }

    pub(crate) fn nearest_box(&self, node: NodeId) -> BoxId {
        core::iter::once(node)
            .chain(self.tree.flat_ancestors(node))
            .find_map(|it| self.own_box(it))
            .unwrap_or(0)
    }

    /// Whether something in the picture is behind.
    pub(crate) fn throttle_animations(&mut self) -> bool {
        let Some(picture) = self.pictures.current() else {
            return false;
        };
        let (now, mut throttles) = (self.animations.now, Vec::new());
        for (id, it) in self
            .animations
            .all
            .iter()
            .filter(|it| it.1.is_running(now) || it.1.follows_scroll())
        {
            throttles.push((
                *id,
                match () {
                    () if it.node == 0 || self.is_in_skipped_contents(it.node) => Throttle::Unseen,
                    () if it.can_be_composited() && picture.driven.contains(&it.node) => {
                        Throttle::Composited
                    }
                    () if it.only_repaints() && !self.can_be_seen(it, picture) => Throttle::Unseen,
                    () => Throttle::None,
                },
            ));
        }
        self.animations.has_throttled = throttles.iter().any(|it| it.1 != Throttle::None);
        let mut is_behind = false;
        for (id, throttle) in throttles {
            let Some(it) = self.animations.all.get_mut(&id) else {
                continue;
            };
            it.throttle = throttle;
            if throttle == Throttle::None && self.tree[it.node].has(Flags::LAGS) {
                self.tree[it.node].unset(Flags::LAGS | Flags::CATCHES_UP);
                self.tree.mark_style(it.node, Flags::REANIMATE);
                is_behind = true;
            }
        }
        is_behind
    }

    fn can_be_seen(&self, animation: &Animation, picture: &Picture) -> bool {
        let (node, targets) = (animation.node, || {
            animation.tracks.iter().map(|it| it.target)
        });
        let may_appear = targets().any(|it| it == Target::Property(Id::Visibility))
            || targets().any(|it| it.id().is_some_and(crate::restyle::changes_ink))
                && !self.compositor.sampled.contains_key(&node)
                && self.tree.style(node).is_some_and(|it| it.is_visible());
        let watched = self.nearest_box(if may_appear {
            self.tree.flat_parent(node)
        } else {
            node
        });
        watched != 0 && picture.seen.contains(&watched)
    }

    // ───────────────────────────── from styles ─────────────────────────────

    fn find_keyframes(&self, node: NodeId, name: &str) -> Option<Rc<[Keyframe]>> {
        if let Some(found) = self.transition_keyframes(node, name) {
            return Some(found);
        }
        match self
            .find_defined(
                self.tree_of_value(node, Id::AnimationName),
                AtKind::Keyframes,
                name,
            )?
            .0
        {
            Defined::Keyframes(frames) => Some(frames),
            _ => None,
        }
    }

    pub(crate) fn update_css_animations(&mut self, node: NodeId, style: &Style) {
        self.forget_samples(node);
        let (a, now) = (&style.animation, self.animations.now);
        let mut old = self.animations_of(node);
        old.retain(|id| {
            self.animations.all[id].order() == 1 && self.animations.all[id].owner == node
        });
        bun_collections::index_sort::sort_slice_by_key(&mut old, |id| {
            self.animations.all[id].rank().1
        });
        let composites =
            crate::grammar::split_list(style.other(Id::AnimationComposition).as_bytes());
        let triggers = crate::grammar::split_list(style.other(Id::AnimationTrigger).as_bytes());
        let mut wanted = Vec::new();
        for (index, name) in a.name.iter().enumerate().rev() {
            if let Some((name, keyframes)) = name
                .0
                .as_ref()
                .and_then(|it| Some((it, self.find_keyframes(node, it)?)))
            {
                let same = old.iter().rposition(
                    |id| matches!(&self.animations.all[id].kind, Kind::Css(it, _) if it == name),
                );
                wanted.push((index, name, keyframes, same.map(|it| old.remove(it))));
            }
        }
        for (index, name, keyframes, same) in wanted.into_iter().rev() {
            let timing = Timing {
                delay: a.delay.at(index).0.into(),
                end_delay: 0.0,
                relative_delays: [0.0; 2],
                duration: a.duration.at(index).0.into(),
                iterations: a.iterations.at(index).0.into(),
                iteration_start: 0.0,
                fill: *a.fill.at(index),
                direction: *a.direction.at(index),
                easing: Easing::linear(),
            };
            let id = same.unwrap_or_else(|| {
                let id = self.reserve_animation();
                self.add_animation(
                    id,
                    Animation::new(node, Kind::Css(Rc::clone(name), index), timing.clone()),
                );
                id
            });
            let timeline = a.timeline.at(index);
            self.animations.names_are_stale |= matches!(timeline, Timeline::Named(_));
            let Some(animation) = self.animations.all.get_mut(&id) else {
                continue;
            };
            let overridden = animation.overridden;
            animation.kind = Kind::Css(Rc::clone(name), index);
            animation.specified.update(timing, !overridden.bits());
            if !overridden.contains(Overridden::KEYFRAMES) {
                (animation.keyframes, animation.default_easing) =
                    (keyframes, a.easing.at(index).clone());
            }
            if !overridden.contains(Overridden::COMPOSITE) {
                animation.composite = Composite::from_name(composites[index % composites.len()])
                    .unwrap_or(Composite::Replace);
            }
            for (edge, flag, range) in [
                (0, Overridden::RANGE_START, &a.range_start),
                (1, Overridden::RANGE_END, &a.range_end),
            ] {
                if !overridden.contains(flag) {
                    animation.range[edge] = range.at(index).clone();
                }
            }
            (animation.computed_for, animation.css_timeline) = (None, timeline.clone());
            animation.normalize();
            if !overridden.contains(Overridden::TIMELINE) {
                let clock = self.css_clock(node, timeline);
                self.change_clock(id, clock);
            }
            if !overridden.contains(Overridden::TRIGGER) {
                let trigger =
                    bun_core::strings::split_once_char(triggers[index % triggers.len()], b' ');
                let mut words = crate::hooks::words(trigger.unwrap_or_default().1)
                    .into_iter()
                    .map(Behavior::from_name);
                let behaviors = [(); 2].map(|()| words.next().flatten().unwrap_or(Behavior::None));
                self.set_trigger(
                    id,
                    trigger.map(|it| TriggeredBy::Name(crate::values::text(it.0).into())),
                    behaviors,
                );
            }
            let Some(animation) = self.animations.all.get_mut(&id) else {
                continue;
            };
            let is_paused = *a.play_state.at(index) == PlayState::Paused;
            let waits = animation.trigger.as_mut().is_some_and(|it| {
                !core::mem::replace(&mut it.is_paused_by_style, is_paused) || same.is_none()
            });
            if !overridden.contains(Overridden::PLAY_STATE)
                && (same.is_none() || !animation.is_idle(now))
            {
                match a.play_state.at(index) {
                    PlayState::Paused => _ = animation.pause(now),
                    PlayState::Running if waits => {}
                    PlayState::Running if animation.is_paused() => {
                        _ = animation.play(now, same.is_none())
                    }
                    PlayState::Running => {}
                }
            }
            self.needs_frame |= animation.follows_scroll();
            self.update_animation(id, false);
        }
        for id in old {
            self.cancel(id);
            self.disown(id);
        }
    }

    /// If an ancestor is in a transition: what `node` inherits when they are over.
    pub(crate) fn inherited_after_transitions(&self, node: NodeId) -> Option<Rc<Style>> {
        let is_in_transition = |id| {
            self.tree[id].has(Flags::ANIMATED)
                && self
                    .effective_animations(id)
                    .iter()
                    .any(|it| self.animations.all[it].order() == 0)
        };
        self.tree
            .flat_ancestors(node)
            .any(is_in_transition)
            .then_some(())?;
        let ancestors: SmallVec<[NodeId; 32]> = self.tree.flat_ancestors(node).collect();
        let outermost = ancestors.iter().rposition(|it| is_in_transition(*it))?;
        let base = Rc::clone(
            self.tree
                .element(ancestors[outermost])?
                .base_style
                .as_ref()?,
        );
        ancestors[..outermost].iter().try_rfold(base, |parent, it| {
            Some(self.compute_style(*it, self.tree.element(*it)?.rules.as_ref()?, &parent))
        })
    }

    /// Those that nobody has seen, which are later than the animation `last`.
    pub(crate) fn take_back_transitions(&mut self, node: NodeId, last: u32) {
        for id in self.animations_of(node) {
            let it = &self.animations.all[&id];
            if id > last
                && it.order() == 0
                && it.owner == node
                && !it.is_exposed
                && it.reported.0 == Phase::Idle
            {
                self.drop_animation(id);
                self.tree[node].set(Flags::REANIMATE);
            }
        }
    }

    pub(crate) fn update_transitions(
        &mut self,
        node: NodeId,
        before: &Style,
        after: &Style,
        parent: &Style,
    ) {
        let t = &after.transition;
        ALLOWS_KEYWORDS.set(after.ink.interpolate_size == InterpolateSize::AllowKeywords);
        let matching = |target: Target| {
            t.property
                .iter()
                .rposition(|property| match (property, target) {
                    (TransitionProperty::All, _) => true,
                    (TransitionProperty::Known(prop), Target::Property(id)) => {
                        prop.longhands(after.flow()).contains(&id)
                    }
                    (TransitionProperty::Other(name), Target::Custom(custom)) => {
                        Name::new(name.as_bytes()) == custom
                    }
                    _ => false,
                })
        };
        let takes_time =
            |index: &usize| t.duration.at(*index).0.max(0.0) + t.delay.at(*index).0 > 0.0;
        let mut running = self.animations_of(node);
        running.retain(|id| {
            self.animations.all[id].order() == 0 && self.animations.all[id].owner == node
        });
        let mut changed: SmallVec<[Target; 4]> = SmallVec::new();
        if (0..t.property.len()).any(|index| takes_time(&index)) {
            before.differences(after, |id| {
                if id.is_animatable() && !changed.contains(&Target::Property(id)) {
                    changed.push(Target::Property(id));
                }
            });
            if !before.customs.is_same(&after.customs) {
                let registry = &self.styles.registry;
                let differs = |name: &Name| {
                    before.customs.get(*name, registry) != after.customs.get(*name, registry)
                };
                let named = |it: &TransitionProperty| {
                    if let TransitionProperty::Other(name) = it {
                        Some(Name::new(name.as_bytes()))
                    } else {
                        None
                    }
                };
                let candidates: Set<_> = match t.property.contains(&TransitionProperty::All) {
                    true => registry.keys().copied().collect(),
                    false => t.property.iter().filter_map(named).collect(),
                };
                let registered = candidates
                    .into_iter()
                    .filter(|it| registry.get(it).is_some_and(|it| it.interpolates()));
                changed.extend(registered.filter(differs).map(Target::Custom));
                if t.behavior.contains(&TransitionBehavior::AllowDiscrete) {
                    let others = before
                        .customs
                        .names()
                        .into_iter()
                        .chain(after.customs.names());
                    let others: Set<_> = others
                        .filter(differs)
                        .filter(|it| !changed.contains(&Target::Custom(*it)))
                        .collect();
                    changed.extend(others.into_iter().map(Target::Custom));
                }
            }
        }
        let mut interrupted = Vec::new();
        for id in running {
            let animation = &self.animations.all[&id];
            let Kind::Transition {
                reversing_start,
                end,
                shortening,
                ..
            } = &animation.kind
            else {
                continue;
            };
            let target = end.target();
            if matching(target).is_some() && *end == self.value_in(after, target) {
                changed.retain(|it| *it != target);
                continue;
            }
            if let Some(sample) = animation.sample.filter(|_| !animation.is_finished) {
                let under = self.value_in(before, target);
                let track = animation.tracks.iter().find(|it| it.target == target);
                let current = track.map(|track| {
                    with_current_color(before.ink.color, || {
                        self.sample_track(track, sample, &under)
                    })
                });
                let shortening = (sample.progress * shortening + 1.0 - shortening)
                    .abs()
                    .min(1.0);
                interrupted.push((
                    current.unwrap_or(under),
                    reversing_start.clone(),
                    shortening,
                    end.clone(),
                ));
            }
            self.cancel_unless_finished(id);
        }
        self.animations.generation += u32::from(!changed.is_empty());
        let animated = self.stack_of(node, |_, it| {
            it.order() != 0 && it.sample.is_some() && it.replace_state != ReplaceState::Removed
        });
        for id in animated.iter().filter(|_| !changed.is_empty()) {
            if self.animations.all[id].computed_for.is_none() {
                let tracks = self
                    .compute_tracks(&self.animations.all[id], after, parent)
                    .0;
                self.animations
                    .all
                    .get_mut(id)
                    .into_iter()
                    .for_each(|it| it.tracks.clone_from(&tracks));
            }
        }
        changed.retain(|target| {
            !animated.iter().any(|it| {
                self.animations.all[it]
                    .tracks
                    .iter()
                    .any(|it| it.target == *target)
            })
        });
        for target in changed {
            let Some(index) = matching(target).filter(takes_time) else {
                continue;
            };
            let (mut from, to) = (self.value_in(before, target), self.value_in(after, target));
            let (mut reversing_start, mut shortening) = (from.clone(), 1.0);
            if let Some((current, start, factor, end)) =
                interrupted.iter().find(|it| it.0.target() == target)
            {
                (reversing_start, shortening) = if *start == to {
                    (end.clone(), *factor)
                } else {
                    (current.clone(), 1.0)
                };
                from = current.clone();
            }
            let interpolates = with_current_color(after.ink.color, || {
                self.interpolate(&from, &to, Mixing::Lerp(0.5)).is_some()
            });
            if from == to
                || !interpolates && *t.behavior.at(index) != TransitionBehavior::AllowDiscrete
            {
                continue;
            }
            let delay = f64::from(t.delay.at(index).0);
            let timing = Timing {
                delay: if delay < 0.0 {
                    delay * shortening
                } else {
                    delay
                },
                end_delay: 0.0,
                relative_delays: [0.0; 2],
                duration: f64::from(t.duration.at(index).0.max(0.0)) * shortening,
                iterations: 1.0,
                iteration_start: 0.0,
                fill: FillMode::Backwards,
                direction: AnimationDirection::Normal,
                easing: t.easing.at(index).clone(),
            };
            let name = match target {
                Target::Property(id) => id.name().into(),
                Target::Custom(name) => spelling(name),
            };
            let (end, generation) = (to.clone(), self.animations.generation);
            let mut animation = Animation::new(
                node,
                Kind::Transition {
                    name,
                    reversing_start,
                    end,
                    shortening,
                    generation,
                },
                timing,
            );
            let stop = |offset: f32, value| Stop {
                offset,
                value,
                easing: Easing::linear(),
                adds: None,
                frame: offset as usize,
            };
            animation.tracks.push(Track {
                target,
                stops: vec![stop(0.0, from), stop(1.0, to)],
                easing: Easing::linear(),
                is_idle: false,
            });
            animation.play(self.animations.now, true);
            let id = self.reserve_animation();
            self.add_animation(id, animation);
            self.update_animation(id, false);
        }
    }

    // ───────────────────────────── from scripts ─────────────────────────────

    pub(crate) fn create_animation(
        &mut self,
        id: u32,
        node: NodeId,
        pseudo: Pseudo,
        timing: Timing,
    ) {
        self.drop_animation(id);
        self.add_animation(id, Animation::new(0, Kind::Script, timing));
        self.set_target(id, node, pseudo);
    }

    pub(crate) fn set_target(&mut self, id: u32, node: NodeId, pseudo: Pseudo) {
        if pseudo != Pseudo::None {
            self.update_style();
        }
        let generated = self.tree.element(node).map_or([0; 4], |it| it.generated);
        let is_it = |id: &NodeId| self.tree.element(*id).is_some_and(|it| it.pseudo == pseudo);
        let target = if pseudo == Pseudo::None {
            node
        } else {
            generated.into_iter().find(is_it).unwrap_or(0)
        };
        let target = self.transition_part(node, pseudo).unwrap_or(target);
        let Some(animation) = self.animations.all.get_mut(&id) else {
            return;
        };
        let wanted = (pseudo != Pseudo::None && node != 0).then_some((node, pseudo));
        let old = [
            core::mem::replace(&mut animation.node, target),
            core::mem::replace(&mut animation.wanted, wanted).map_or(0, |it| it.0),
        ];
        let (owner, has_effect) = (animation.owner, animation.sample.is_some());
        animation.computed_for = None;
        old.into_iter()
            .filter(|it| *it != 0 && *it != owner)
            .for_each(|it| self.unlink_animation(id, it));
        [node, target]
            .into_iter()
            .for_each(|it| self.link_animation(id, it));
        for it in [old[0], target]
            .into_iter()
            .filter(|it| *it != 0 && has_effect)
        {
            self.tree.mark_style(it, Flags::REANIMATE);
            self.animations.filled.push(it);
        }
    }

    pub(crate) fn has_lost_target(&self, id: u32) -> bool {
        self.animations
            .all
            .get(&id)
            .is_some_and(|it| it.node == 0 && it.wanted.is_none())
    }

    /// `None` keeps them.
    pub(crate) fn set_keyframes(
        &mut self,
        id: u32,
        keyframes: Option<Rc<[Keyframe]>>,
        composite: Composite,
    ) {
        let Some(animation) = self.animations.all.get_mut(&id) else {
            return;
        };
        if animation.composite != composite {
            animation.overridden |= Overridden::COMPOSITE;
        }
        if let Some(keyframes) = keyframes {
            (animation.keyframes, animation.default_easing) = (keyframes, Easing::linear());
            animation.overridden |= Overridden::KEYFRAMES;
        }
        (animation.composite, animation.computed_for) = (composite, None);
        let node = animation.node;
        if node != 0 && animation.sample.is_some() {
            self.tree.mark_style(node, Flags::REANIMATE);
            self.animations.filled.push(node);
        }
        self.forget_samples(node);
    }

    pub(crate) fn set_timing(&mut self, id: u32, timing: Timing, members: u16) {
        let Some(animation) = self.animations.all.get_mut(&id) else {
            return;
        };
        animation.specified.update(timing, members);
        animation.overridden |= Overridden::from_bits_retain(members & 0xff);
        animation.normalize();
        let node = animation.node;
        self.forget_samples(node);
        self.update_animation(id, false);
    }

    pub(crate) fn set_range(&mut self, id: u32, edge: usize, range: &[u8]) {
        let (Some(animation), now) = (self.animations.all.get_mut(&id), self.animations.now) else {
            return;
        };
        let (cx, node) = (
            Ctx {
                zoom: self.tree.style(animation.node).map_or(1.0, |it| it.zoom),
                ..Ctx::dummy()
            },
            animation.node,
        );
        animation.range[edge] = parse_all(range, |p| RangeEdge::parse(p, &cx)).unwrap_or_default();
        animation.overridden |= [Overridden::RANGE_START, Overridden::RANGE_END][edge];
        animation.computed_for = None;
        if let Clock::Progress(_, snapshot) = animation.clock {
            animation.follow(snapshot, now);
        }
        self.forget_samples(node);
        self.update_animation(id, false);
    }

    /// No `behaviors` detach it.
    pub(crate) fn set_script_trigger(
        &mut self,
        id: u32,
        timeline: TimelineId,
        ranges: [&[u8]; 4],
        behaviors: Option<[Behavior; 2]>,
    ) {
        let timeline = match timeline {
            TimelineId::None => 0,
            TimelineId::Document(_) => u32::MAX,
            TimelineId::Progress(id) => id,
        };
        let zoom = self
            .animations
            .timelines
            .get(&timeline)
            .map_or(1.0, |it| self.zoom_of(it.watched.node));
        let by = TriggeredBy::Timeline(timeline, trigger_ranges(|index| ranges[index], zoom));
        self.animations
            .all
            .get_mut(&id)
            .into_iter()
            .for_each(|it| it.overridden |= Overridden::TRIGGER);
        self.set_trigger(
            id,
            behaviors.is_some().then_some(by),
            behaviors.unwrap_or([Behavior::None; 2]),
        );
    }

    pub(crate) fn set_timeline(&mut self, id: u32, timeline: TimelineId) {
        self.animations
            .all
            .get_mut(&id)
            .into_iter()
            .for_each(|it| it.overridden |= Overridden::TIMELINE);
        let clock = match timeline {
            TimelineId::Progress(timeline) => self
                .animations
                .timelines
                .get(&timeline)
                .map_or(Clock::None, |it| Clock::Progress(timeline, it.snapshot)),
            TimelineId::Document(origin) => Clock::Document(origin),
            TimelineId::None => Clock::None,
        };
        self.change_clock(id, clock);
    }

    /// A view timeline if it has `insets`.
    pub(crate) fn create_timeline(
        &mut self,
        node: NodeId,
        axis: Axis,
        insets: Option<&[u8]>,
    ) -> u32 {
        self.update_layout();
        let cx = Ctx {
            zoom: self.zoom_of(node),
            ..Ctx::dummy()
        };
        let how = insets
            .and_then(|it| parse_all(it, |p| view_insets(p, &cx)))
            .map_or(Watch::Scroller(Scroller::Itself), Watch::View);
        let watched = Watched { node, how, axis };
        let snapshot = self.snapshot(&watched);
        let id = self.add_timeline(watched, true);
        self.animations
            .timelines
            .get_mut(&id)
            .into_iter()
            .for_each(|it| it.snapshot = snapshot);
        id
    }

    /// `None` says that JavaScript has let go of it.
    pub(crate) fn set_watched_node(&mut self, timeline: u32, node: Option<NodeId>) {
        let Some(it) = self.animations.timelines.get_mut(&timeline) else {
            return;
        };
        (it.watched.node, it.is_exposed) = (node.unwrap_or(it.watched.node), node.is_some());
        if let Some(node) = node.filter(|it| {
            !self.tree[*it].has(Flags::WATCHED_BY_TIMELINE)
                || !self
                    .animations
                    .watchers
                    .get(it)
                    .is_some_and(|it| it.contains(&timeline))
        }) {
            self.watch(timeline, node);
        }
    }

    pub(crate) fn watch_again(&mut self, timeline: u32, node: NodeId) {
        if self
            .animations
            .timelines
            .get(&timeline)
            .is_some_and(|it| it.is_exposed)
        {
            self.set_watched_node(timeline, Some(node));
        }
    }

    pub(crate) fn timeline_state(&mut self, timeline: u32) -> Option<TimelineState> {
        self.animations.timelines.get_mut(&timeline)?.is_exposed = true;
        let it = &self.animations.timelines[&timeline];
        let [source, subject] = [self.timeline_source(&it.watched).0, it.watched.node]
            .map(|it| self.event_target(it).0);
        Some(TimelineState {
            time: it.snapshot.map(|it| it.time()),
            source,
            subject,
            axis: it.watched.axis,
            is_view: matches!(it.watched.how, Watch::View(_)),
            offsets: it.snapshot.map_or([0.0; 2], |it| {
                it.range().map(|offset| (offset / it.zoom).into())
            }),
        })
    }

    /// `false` if it cannot be done in this state.
    pub(crate) fn control_animation(&mut self, id: u32, control: Control) -> bool {
        self.catch_up_with_compositor();
        if self.animations.all.get(&id).is_some_and(|it| it.owner != 0) {
            self.update_style();
        }
        self.forget_samples(self.animations.all.get(&id).map_or(0, |it| it.node));
        let now = self.animations.now;
        let Some(animation) = self.animations.all.get_mut(&id) else {
            return true;
        };
        let (was_pending, was_paused) = (animation.pending != Pending::None, animation.is_paused());
        let mut is_done = true;
        match control {
            Control::Play => is_done = animation.play(now, true),
            Control::Pause => is_done = animation.pause(now),
            Control::Cancel => {
                self.cancel(id);
                return true;
            }
            Control::Finish => is_done = animation.finish(now),
            Control::Reverse => is_done = animation.reverse(now),
            Control::Seek(time) => animation.seek(time, now),
            Control::SetStart(time) => animation.set_start(time, now),
            Control::SetRate(rate) => animation.set_rate(rate, now),
            Control::UpdateRate(rate) => animation.update_rate(rate, now),
            Control::Persist => {
                animation.replace_state = ReplaceState::Persisted;
                let node = animation.node;
                if node != 0 {
                    self.tree.mark_style(node, Flags::REANIMATE);
                }
                self.update_animation(id, false);
                return true;
            }
            Control::Release => {
                animation.is_exposed = false;
                let is_relevant = animation.sample.is_some()
                    && animation.replace_state != ReplaceState::Removed
                    || animation.is_running(now);
                if animation.order() != 1
                    && (animation.node == 0
                        || !is_relevant && animation.reported.0 == animation.phase
                        || animation.owner == 0)
                {
                    self.drop_animation(id);
                }
                return true;
            }
        }
        if is_done
            && (matches!(control, Control::Play | Control::Pause)
                || matches!(control, Control::Reverse | Control::SetStart(_))
                    && was_paused != animation.is_paused())
        {
            animation.overridden |= Overridden::PLAY_STATE;
        }
        if animation.sequence == 0 && !animation.is_idle(now) {
            self.animations.last_id += 1;
            animation.sequence = self.animations.last_id;
        }
        self.needs_frame |= animation.follows_scroll();
        if was_pending && animation.pending == Pending::None {
            self.events.push(EngineEvent::Playback(id, Playback::Ready));
        }
        self.update_animation(
            id,
            matches!(
                control,
                Control::Finish | Control::Seek(_) | Control::SetStart(_) | Control::SetRate(_)
            ),
        );
        is_done
    }

    /// One that is neither running nor pending.
    pub(crate) fn restore_animation(&mut self, id: u32, state: &State) {
        let Some(it) = self.animations.all.get_mut(&id) else {
            return;
        };
        (it.hold, it.start, it.previous, it.rate) = (
            state.current_time,
            state.start_time,
            state.current_time,
            state.playback_rate,
        );
        (it.replace_state, it.is_finished) =
            (state.replace_state, state.play_state == Playing::Finished);
        self.update_animation(id, false);
    }

    pub(crate) fn animation_state(&mut self, id: u32) -> Option<State> {
        if self
            .animations
            .all
            .get(&id)
            .is_some_and(|it| !matches!(it.kind, Kind::Script) || it.follows_scroll())
        {
            self.update_style();
        }
        let (it, now) = (self.animations.all.get(&id)?, self.animations.now);
        Some(State {
            play_state: match () {
                () if it.is_idle(now) => Playing::Idle,
                () if it.is_paused() => Playing::Paused,
                () if it.has_reached_end(now) => Playing::Finished,
                () => Playing::Running,
            },
            current_time: it.time(now),
            start_time: it.start,
            playback_rate: it.rate,
            is_pending: it.pending != Pending::None,
            replace_state: it.replace_state,
            progress: it.sample.map(|it| it.progress),
            iteration: it.sample.map(|it| it.iteration),
            end_time: it.timing.end(),
            active_duration: it.timing.active_duration(),
            duration: it.timing.duration,
            timeline: match it.clock {
                Clock::None => TimelineId::None,
                Clock::Document(origin) => TimelineId::Document(origin),
                Clock::Progress(timeline, _) => TimelineId::Progress(timeline),
            },
            timeline_time: it.timeline_time(now),
            has_keyframes_from_script: it.overridden.contains(Overridden::KEYFRAMES),
        })
    }

    pub(crate) fn specified_effect(&self, id: u32) -> Option<(Timing, Composite)> {
        self.animations
            .all
            .get(&id)
            .map(|it| (it.specified.clone(), it.composite))
    }

    pub(crate) fn animation_range(&mut self, id: u32, edge: usize) -> Option<Out> {
        self.update_style();
        Some(self.animations.all.get(&id)?.range[edge].written())
    }

    pub(crate) fn expose_animation(&mut self, id: u32) -> Option<Origin> {
        self.update_style();
        self.animations.all.get_mut(&id)?.is_exposed = true;
        let animation = &self.animations.all[&id];
        let (is_transition, name) = match &animation.kind {
            Kind::Transition { name, .. } => (true, Rc::clone(name)),
            Kind::Css(name, _) => (false, Rc::clone(name)),
            Kind::Script => return None,
        };
        let (node, pseudo) = self.event_target(animation.node);
        Some(Origin {
            is_transition,
            name,
            node,
            pseudo,
        })
    }

    pub(crate) fn computed_offsets(&self, id: u32) -> Vec<Option<f32>> {
        self.animations.all.get(&id).map_or(Vec::new(), |it| {
            it.keyframes
                .iter()
                .map(|frame| it.offset_of(frame))
                .collect()
        })
    }

    /// Of an animation that a style has started.
    pub(crate) fn computed_keyframes(&mut self, id: u32) -> Vec<ComputedKeyframe> {
        self.update_style();
        let Some(animation) = self.animations.all.get(&id) else {
            return Vec::new();
        };
        let Some(style) = self
            .tree
            .element(animation.node)
            .and_then(|it| it.base_style.as_ref())
        else {
            return Vec::new();
        };
        let parent = self
            .tree
            .style(self.tree.flat_parent(animation.node))
            .unwrap_or(&self.styles.initial);
        type Frame = (
            Option<RangeName>,
            f32,
            Easing,
            Option<Composite>,
            Vec<Animated>,
            Option<f32>,
        );
        let mut frames: Vec<Frame> = Vec::new();
        let mut add = |range, offset, easing: &Easing, adds, value: Option<Animated>, computed| {
            let is_same = |it: &Frame| (it.0, it.1, &it.2, it.3) == (range, offset, easing, adds);
            let at = frames.iter().rposition(is_same).unwrap_or_else(|| {
                frames.push((range, offset, easing.clone(), adds, Vec::new(), computed));
                frames.len() - 1
            });
            frames[at].4.retain(|it| {
                value
                    .as_ref()
                    .is_none_or(|value| value.target() != it.target())
            });
            frames[at].4.extend(value);
        };
        let computed;
        let tracks = if animation.keyframes.is_empty() {
            &animation.tracks
        } else {
            computed = self.compute_tracks(animation, style, parent).0;
            &computed
        };
        for frame in &*animation.keyframes {
            let (easing, offset) = (
                frame.easing.as_ref().unwrap_or(&animation.default_easing),
                animation.offset_of(frame),
            );
            add(frame.range, frame.offset, easing, frame.adds, None, offset);
            let values = self
                .compute_block(animation.node, &frame.block, style, parent)
                .0
                .into_iter()
                .filter(|it| it.id().is_animatable());
            values.for_each(|it| {
                add(
                    frame.range,
                    frame.offset,
                    easing,
                    frame.adds,
                    Some(Animated::Property(it)),
                    offset,
                )
            });
        }
        for track in tracks {
            if animation.keyframes.is_empty() {
                track.stops.iter().for_each(|it| {
                    add(
                        None,
                        it.offset,
                        &it.easing,
                        None,
                        Some(it.value.clone()),
                        Some(it.offset),
                    )
                });
            }
            let is_missing = [
                track.stops[0].offset > 0.0,
                track.stops[track.stops.len() - 1].offset < 1.0,
            ];
            for offset in [0.0, 1.0].into_iter().filter(|it| is_missing[*it as usize]) {
                let has_usual = animation.keyframes.iter().any(|it| {
                    (it.range, it.offset, it.adds) == (None, offset, None)
                        && it.easing.as_ref().is_none_or(|it| *it == track.easing)
                });
                let adds = (!has_usual).then_some(Composite::Replace);
                add(
                    None,
                    offset,
                    &track.easing,
                    adds,
                    Some(self.value_in(style, track.target)),
                    Some(offset),
                );
            }
        }
        bun_collections::index_sort::sort_slice_by(&mut frames, |a, b| {
            (a.0.is_some().cmp(&b.0.is_some())).then(if a.0.is_some() {
                core::cmp::Ordering::Equal
            } else {
                a.1.total_cmp(&b.1)
            })
        });
        let is_listed =
            |it: &&Animated| animation.keyframes.is_empty() || !matches!(it, Animated::Custom(..));
        let finish =
            |(range, offset, easing, adds, values, computed_offset): Frame| ComputedKeyframe {
                range,
                offset,
                computed_offset,
                easing,
                adds,
                values: values
                    .iter()
                    .filter(is_listed)
                    .filter_map(|it| it.written(style))
                    .collect(),
            };
        frames.into_iter().map(finish).collect()
    }

    pub(crate) fn committed_styles(&mut self, id: u32) -> Vec<(Prop, Out)> {
        let Some(node) = self.animations.all.get(&id).map(|it| it.node) else {
            return Vec::new();
        };
        self.update_layout_for(node);
        let size = self
            .own_box(node)
            .map(|it| self.transform_reference(it))
            .map_or([0.0; 2], |it| [it.width, it.height]);
        let Some(base) = self.tree.element(node).and_then(|it| it.base_style.clone()) else {
            return Vec::new();
        };
        let parent = Rc::clone(
            self.tree
                .style(self.tree.flat_parent(node))
                .unwrap_or(&self.styles.initial),
        );
        self.update_tracks(
            id,
            self.tree.style(node).cloned().as_ref().unwrap_or(&base),
            &parent,
        );
        let (animation, mut out) = (&self.animations.all[&id], Vec::new());
        let ids = self.stack_of(node, |other, it| {
            other == id || it.replace_state != ReplaceState::Removed && it.rank() < animation.rank()
        });
        let sample = |it: &Animation| match core::ptr::eq(it, animation) {
            true => it.timing.sample(it.time(self.animations.now), [false; 2]),
            false => it.sample,
        };
        let values = self.animated_values(&ids, &base, false, sample);
        for track in &animation.tracks {
            let value = match values.iter().find(|it| it.target() == track.target) {
                Some(Animated::Property(Value::Transform(it)))
                    if it.0.iter().any(|it| matches!(it, Transform::Deferred(_))) =>
                {
                    let [width, height] = size;
                    Some(Animated::Property(Value::Transform(Transforms(
                        NoneOrSpaces(
                            [Transform::Matrix(Rc::new(it.matrix_3d(width, height)))]
                                .into_iter()
                                .collect(),
                        ),
                    ))))
                }
                value => value.cloned(),
            };
            out.extend(
                value
                    .unwrap_or_else(|| self.value_in(&base, track.target))
                    .written(&base),
            );
        }
        self.animations
            .all
            .get_mut(&id)
            .into_iter()
            .for_each(|it| it.computed_for = None);
        out
    }

    pub(crate) fn relevant_animations(&mut self, node: NodeId, subtree: bool) -> Vec<u32> {
        self.update_layout_for(node);
        let is_target = |it: &Animation| {
            let originator = it
                .wanted
                .map_or_else(|| self.event_target(it.node).0, |it| it.0);
            let mut inside =
                core::iter::successors(Some(originator), |it| Some(self.tree[*it].parent));
            it.node == node
                || subtree
                    && inside
                        .by_ref()
                        .take_while(|it| *it != 0)
                        .any(|it| it == node)
        };
        let is_relevant = |it: &Animation| {
            let is_ahead = it.rate != 0.0
                && it.phase
                    == if it.rate < 0.0 {
                        Phase::After
                    } else {
                        Phase::Before
                    };
            it.replace_state != ReplaceState::Removed
                && (it.sample.is_some()
                    || is_ahead
                    || it.follows_scroll() && !it.is_idle(self.animations.now))
        };
        let all = self.animations.all.iter();
        let mut ids: Vec<u32> = all
            .filter(|(_, it)| is_relevant(it) && is_target(it))
            .map(|it| *it.0)
            .collect();
        bun_collections::index_sort::sort_slice_by_cached_key(&mut ids, |id| {
            let it = &self.animations.all[id];
            (it.order(), self.tree.path(it.owner), it.rank())
        });
        ids.iter().for_each(|id| {
            self.animations
                .all
                .get_mut(id)
                .into_iter()
                .for_each(|it| it.is_exposed = true)
        });
        ids
    }
}
