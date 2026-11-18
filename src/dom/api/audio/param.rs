//! https://webaudio.github.io/web-audio-api/#AudioParam

use core::cell::OnceCell;
use std::collections::VecDeque;
use std::rc::Rc;

use super::*;

#[derive(Clone, Copy)]
pub(super) struct ParamKind {
    pub(super) name: &'static str,
    pub(super) initial: f32,
    pub(super) range: Range,
    pub(super) is_always_k_rate: bool,
}

#[derive(Clone, Copy)]
pub(super) enum Range {
    Fixed(f32, f32),
    UpToNyquist,
    AroundZeroToNyquist,
}

#[derive(Clone)]
enum Shape {
    Set,
    Linear,
    Exponential,
    Target(f32),
    Curve(Rc<[f32]>, f64),
    Hold,
}

#[derive(Clone)]
struct Automation {
    shape: Shape,
    value: f32,
    time: f64,
    end: f64,
}

impl Automation {
    fn new(shape: Shape, value: f32, time: f64) -> Automation {
        let end = if let Shape::Curve(_, duration) = shape {
            time + duration
        } else {
            time
        };
        Automation {
            shape,
            value,
            time,
            end,
        }
    }

    fn is_ramp(&self) -> bool {
        matches!(self.shape, Shape::Linear | Shape::Exponential)
    }
}

struct Timeline {
    /// What it was at `since`, before the first of the events.
    value: f32,
    since: f64,
    events: VecDeque<Automation>,
}

impl Timeline {
    /// The value at that time, and how many events are over, with the value and the time that they ended at.
    fn at(&self, time: f64) -> (f32, usize, f32, f64) {
        let (mut value, mut since) = (self.value, self.since);
        for (at, event) in self.events.iter().enumerate() {
            let (from, to) = (f64::from(value), f64::from(event.value));
            let progress = (time - since) / (event.time - since);
            let unfinished = match &event.shape {
                Shape::Linear if time < event.time => Some(from + (to - from) * progress),
                Shape::Exponential if time < event.time => Some(if from * to > 0.0 {
                    from * (to / from).powf(progress)
                } else {
                    from
                }),
                _ if time < event.time => Some(from),
                Shape::Curve(values, duration) if time < event.end => {
                    let position = (time - event.time) / duration * (values.len() - 1) as f64;
                    let [before, after] = [0, 1].map(|it| {
                        f64::from(values[(position as usize + it).min(values.len() - 1)])
                    });
                    Some(before + (after - before) * position.fract())
                }
                Shape::Target(constant) => {
                    let next = self.events.get(at + 1).map_or(f64::INFINITY, |it| {
                        if it.is_ramp() { event.time } else { it.time }
                    });
                    let (until, constant) = (time.min(next), f64::from(*constant));
                    let reached = if constant > 0.0 {
                        to + (from - to) * ((event.time - until) / constant).exp()
                    } else {
                        to
                    };
                    if time < next && time - event.time < constant * 20.0 {
                        return (reached as f32, at, value, since);
                    }
                    (value, since) = (reached as f32, until);
                    continue;
                }
                _ => None,
            };
            if let Some(unfinished) = unfinished {
                return (unfinished as f32, at, value, since);
            }
            (value, since) = (event.value, event.end);
        }
        (value, self.events.len(), value, time)
    }

    fn forget_until(&mut self, time: f64) -> f32 {
        let (current, over, value, since) = self.at(time);
        self.events.drain(..over);
        (self.value, self.since) = (value, since);
        current
    }
}

pub(crate) struct AudioParam {
    kind: ParamKind,
    /// Among those of a processor.
    key: OnceCell<Rc<[u8]>>,
    limits: [Cell<f32>; 2],
    rate: Cell<AutomationRate>,
    timeline: RefCell<Timeline>,
}

impl AudioParam {
    pub(super) fn new<'a>(
        heap: &JsHeap<'a>,
        node: &'a AudioNode,
        kind: ParamKind,
        sample_rate: f32,
    ) -> &'a AudioParam {
        let limits = match kind.range {
            Range::Fixed(least, most) => [least, most],
            Range::UpToNyquist => [0.0, sample_rate / 2.0],
            Range::AroundZeroToNyquist => [sample_rate / -2.0, sample_rate / 2.0],
        };
        let rate = Cell::new(if kind.is_always_k_rate {
            AutomationRate::KRate
        } else {
            AutomationRate::ARate
        });
        let timeline = RefCell::new(Timeline {
            value: kind.initial,
            since: 0.0,
            events: VecDeque::new(),
        });
        let param = js_AudioParam::create(
            heap,
            AudioParam {
                kind,
                key: OnceCell::new(),
                limits: limits.map(Cell::new),
                rate,
                timeline,
            },
        );
        js_AudioParam::set_node(param, Some(node));
        param
    }

    pub(super) fn node(&self) -> &AudioNode {
        js_AudioParam::node(self).expect("a param has a node")
    }

    pub(super) fn named(&self, key: &Rc<[u8]>, rate: AutomationRate) -> &Self {
        _ = self.key.set(Rc::clone(key));
        self.rate.set(rate);
        self
    }

    pub(super) fn key(&self) -> &[u8] {
        self.key.get().map_or(&[], |it| it)
    }

    pub(super) fn remote(&self) -> Arg<'_> {
        let node = self.node().remote().id;
        self.key
            .get()
            .map_or(Arg::Part(node, self.kind.name), |it| {
                Arg::Parameter(node, it)
            })
    }

    pub(super) fn initialize(&self, value: f32) {
        self.timeline.borrow_mut().value = value;
    }

    pub(super) fn set_max(&self, value: f32) {
        self.limits[1].set(value);
    }

    fn call(&self, method: &str, arguments: &[Arg<'_>]) {
        self.node().remote().link.send(
            "call",
            &[self.remote(), method.into(), Arg::List(arguments)],
        );
    }

    #[optimize(size)]
    fn tell(&self, event: &Automation) {
        let (value, time) = (
            Arg::Number(event.value.into()),
            self.node().context().at(event.time),
        );
        match &event.shape {
            Shape::Set => self.call("setValueAtTime", &[value, time]),
            Shape::Linear => self.call("linearRampToValueAtTime", &[value, time]),
            Shape::Exponential => self.call("exponentialRampToValueAtTime", &[value, time]),
            Shape::Target(constant) => self.call(
                "setTargetAtTime",
                &[value, time, Arg::Number((*constant).into())],
            ),
            Shape::Curve(values, duration) => self.call(
                "setValueCurveAtTime",
                &[Arg::floats(values), time, Arg::Number(*duration)],
            ),
            Shape::Hold => self.call("cancelAndHoldAtTime", &[time]),
        }
    }

    fn tell_rate(&self) {
        let rate = if self.rate.get() == AutomationRate::KRate {
            "k-rate"
        } else {
            "a-rate"
        };
        self.node().remote().link.send(
            "set",
            &[self.remote(), "automationRate".into(), rate.into()],
        );
    }

    #[optimize(size)]
    pub(super) fn tell_all(&self) {
        self.get_value();
        let timeline = self.timeline.borrow();
        if timeline.value != self.kind.initial {
            self.node().remote().link.send(
                "set",
                &[
                    self.remote(),
                    "value".into(),
                    Arg::Number(timeline.value.into()),
                ],
            );
        }
        if self.rate.get() == AutomationRate::KRate && !self.kind.is_always_k_rate {
            self.tell_rate();
        }
        timeline.events.iter().for_each(|it| self.tell(it));
    }

    fn checked_time(&self, time: f64) -> core::result::Result<f64, Failure> {
        if time < 0.0 {
            return Err(Failure::Range("The time must not be negative."));
        }
        self.get_value();
        Ok(time.max(self.node().context().time()))
    }

    #[optimize(size)]
    fn add(&self, shape: Shape, value: f32, time: f64) -> core::result::Result<&Self, Failure> {
        let event = Automation::new(shape, value, self.checked_time(time)?);
        let mut timeline = self.timeline.borrow_mut();
        let overlaps = |it: &Automation| {
            (it.time..it.end).contains(&event.time) || (event.time < it.time && it.time < event.end)
        };
        if timeline.events.iter().any(overlaps) {
            return Err(not_supported("It overlaps a curve."));
        }
        if self.node().remote().is_copied() {
            self.tell(&event);
        }
        let at = timeline.events.partition_point(|it| it.time <= event.time);
        timeline.events.insert(at, event);
        Ok(self)
    }

    #[optimize(size)]
    pub(crate) fn get_value(&self) -> f32 {
        let value = self
            .timeline
            .borrow_mut()
            .forget_until(self.node().context().time());
        value.max(self.limits[0].get()).min(self.limits[1].get())
    }

    #[optimize(size)]
    pub(crate) fn set_value(&self, value: f32) -> core::result::Result<(), Failure> {
        self.add(Shape::Set, value, 0.0).map(drop)
    }

    pub(crate) fn get_automation_rate(&self) -> AutomationRate {
        self.rate.get()
    }

    pub(crate) fn set_automation_rate(
        &self,
        rate: AutomationRate,
    ) -> core::result::Result<(), Failure> {
        if self.kind.is_always_k_rate && rate != AutomationRate::KRate {
            return Err(Failure::invalid_state("The rate cannot be changed."));
        }
        self.rate.set(rate);
        if self.node().remote().is_copied() {
            self.tell_rate();
        }
        Ok(())
    }

    pub(crate) fn get_default_value(&self) -> f32 {
        self.kind.initial
    }

    pub(crate) fn get_min_value(&self) -> f32 {
        self.limits[0].get()
    }

    pub(crate) fn get_max_value(&self) -> f32 {
        self.limits[1].get()
    }

    pub(crate) fn set_value_at_time(
        &self,
        value: f32,
        time: f64,
    ) -> core::result::Result<&Self, Failure> {
        self.add(Shape::Set, value, time)
    }

    pub(crate) fn linear_ramp_to_value_at_time(
        &self,
        value: f32,
        time: f64,
    ) -> core::result::Result<&Self, Failure> {
        self.add(Shape::Linear, value, time)
    }

    pub(crate) fn exponential_ramp_to_value_at_time(
        &self,
        value: f32,
        time: f64,
    ) -> core::result::Result<&Self, Failure> {
        if value == 0.0 {
            return Err(Failure::Range("The value must not be 0."));
        }
        self.add(Shape::Exponential, value, time)
    }

    pub(crate) fn set_target_at_time(
        &self,
        target: f32,
        time: f64,
        constant: f32,
    ) -> core::result::Result<&Self, Failure> {
        if constant < 0.0 {
            return Err(Failure::Range("The time constant must not be negative."));
        }
        self.add(Shape::Target(constant), target, time)
    }

    pub(crate) fn set_value_curve_at_time(
        &self,
        values: Vec<f32>,
        time: f64,
        duration: f64,
    ) -> core::result::Result<&Self, Failure> {
        let [_, .., last] = values[..] else {
            return Err(Failure::invalid_state("A curve has at least two values."));
        };
        if duration <= 0.0 {
            return Err(Failure::Range("The duration must be positive."));
        }
        self.add(Shape::Curve(values.into(), duration), last, time)
    }

    #[optimize(size)]
    pub(crate) fn cancel_scheduled_values(
        &self,
        time: f64,
    ) -> core::result::Result<&Self, Failure> {
        let time = self.checked_time(time)?;
        self.timeline
            .borrow_mut()
            .events
            .retain(|it| it.time < time && it.end <= time);
        if self.node().remote().is_copied() {
            self.call("cancelScheduledValues", &[self.node().context().at(time)]);
        }
        Ok(self)
    }

    #[optimize(size)]
    pub(crate) fn cancel_and_hold_at_time(
        &self,
        time: f64,
    ) -> core::result::Result<&Self, Failure> {
        let time = self.checked_time(time)?;
        let mut timeline = self.timeline.borrow_mut();
        let (value, kept) = (
            timeline.at(time).0,
            timeline.events.partition_point(|it| it.time <= time),
        );
        let shape = timeline
            .events
            .get(kept)
            .filter(|it| it.is_ramp())
            .map_or(Shape::Hold, |it| it.shape.clone());
        timeline.events.truncate(kept);
        timeline
            .events
            .back_mut()
            .into_iter()
            .for_each(|it| it.end = it.end.min(time));
        timeline
            .events
            .push_back(Automation::new(shape, value, time));
        if self.node().remote().is_copied() {
            self.tell(&Automation::new(Shape::Hold, value, time));
        }
        Ok(self)
    }
}
