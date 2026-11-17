//! <https://drafts.csswg.org/web-animations/#the-animationeffect-interface>

use core::cell::{Cell, RefCell};
use std::rc::Rc;

use bun_jsc::JSValue;
use bun_jsc::bindgen::{ClassStructure, JsHeap, JsInterface, JsLocal, JsScope, Result};

use super::keyframes::{self, Frame, parse_easing};
use super::{Animation, milliseconds, percent};
use crate::animation::Timing;
use crate::api::core::{DomError, Element, List, dom_error};
use crate::calc::{Kind, Unit};
use crate::document::Document;
use crate::generated_bindgen::animation::*;
use crate::generated_bindgen::typed::CSSNumberish;
use crate::selector::Pseudo;
use crate::types::{self, AnimationDirection, Easing};
use crate::values::{Composite, Css, Out};

#[derive(Clone)]
struct Specified {
    timing: Timing,
    has_auto_fill: bool,
    /// The delays that are percentages.
    percentages: [Option<f64>; 2],
}

pub(crate) struct AnimationEffect {
    specified: RefCell<Specified>,
    pseudo: RefCell<Option<Out>>,
    composite: Cell<Composite>,
    frames: RefCell<Rc<[Frame]>>,
}

impl Default for AnimationEffect {
    fn default() -> AnimationEffect {
        let timing = Timing {
            delay: 0.0,
            end_delay: 0.0,
            relative_delays: [0.0; 2],
            duration: -1.0,
            iterations: 1.0,
            iteration_start: 0.0,
            fill: types::FillMode::None,
            direction: AnimationDirection::Normal,
            easing: Easing::linear(),
        };
        let specified = Specified {
            timing,
            has_auto_fill: true,
            percentages: [None; 2],
        }
        .into();
        AnimationEffect {
            specified,
            pseudo: RefCell::default(),
            composite: Composite::Replace.into(),
            frames: RefCell::default(),
        }
    }
}

macro_rules! timing_of {
    ($options:expr) => {{
        let it = $options;
        OptionalEffectTiming {
            delay: it.delay,
            direction: it.direction,
            duration: it.duration,
            easing: it.easing,
            end_delay: it.end_delay,
            fill: it.fill,
            iteration_start: it.iteration_start,
            iterations: it.iterations,
        }
    }};
}
pub(super) use timing_of;

impl Specified {
    /// <https://drafts.csswg.org/web-animations/#update-the-timing-properties-of-an-animation-effect>. A bit for each member that is given.
    fn update<'a>(
        &mut self,
        heap: &JsHeap<'a>,
        given: &OptionalEffectTiming<'a>,
    ) -> Result<'a, u16> {
        let positive = |value: f64, name: &str| {
            (value >= 0.0)
                .then_some(value)
                .ok_or_else(|| heap.type_error(format_args!("{name} must be non-negative")))
        };
        let (mut new, mut members) = (self.clone(), 0);
        for (index, delay) in [&given.delay, &given.end_delay].into_iter().enumerate() {
            let (absolute, percentage) = match delay {
                None => continue,
                Some(CSSNumberish::Number(it)) => (*it, None),
                Some(CSSNumberish::Value(it)) if it.numeric_type().matches(Kind::Percentage) => {
                    (0.0, Some(it.amount(heap, Unit::Percent)?))
                }
                Some(CSSNumberish::Value(it)) => (milliseconds(heap, it)?, None),
            };
            *[&mut new.timing.delay, &mut new.timing.end_delay][index] = absolute;
            (new.percentages[index], new.timing.relative_delays[index]) =
                (percentage, percentage.unwrap_or(0.0) / 100.0);
            members |= 1 << index;
        }
        let duration = given.duration.as_ref().map(|it| match it {
            Duration::Text(b"auto") => Ok(-1.0),
            Duration::Text(_) => positive(f64::NAN, "duration"),
            Duration::Number(it) => positive(*it, "duration"),
            Duration::Value(it) => positive(milliseconds(heap, it)?, "duration"),
        });
        let numbers = [
            duration,
            given.iterations.map(|it| positive(it, "iterations")),
            given
                .iteration_start
                .map(|it| positive(it, "iterationStart")),
        ];
        for (index, (slot, number)) in [
            &mut new.timing.duration,
            &mut new.timing.iterations,
            &mut new.timing.iteration_start,
        ]
        .into_iter()
        .zip(numbers)
        .enumerate()
        {
            if let Some(number) = number {
                (*slot, members) = (number?, members | 4 << index);
            }
        }
        if let Some(fill) = given.fill {
            use types::FillMode::*;
            (new.timing.fill, new.has_auto_fill, members) = (
                [None, Forwards, Backwards, Both, None][fill as usize],
                fill == FillMode::Auto,
                members | 1 << 5,
            );
        }
        if let Some(direction) = given.direction {
            use AnimationDirection::*;
            (new.timing.direction, members) = (
                [Normal, Reverse, Alternate, AlternateReverse][direction as usize],
                members | 1 << 6,
            );
        }
        if let Some(easing) = given.easing {
            (new.timing.easing, members) = (parse_easing(heap, easing)?, members | 1 << 7);
        }
        *self = new;
        Ok(members)
    }

    fn to_dictionary<'a>(&self, heap: &JsHeap<'a>) -> EffectTiming<'a> {
        use PlaybackDirection::*;
        let (timing, local) = (&self.timing, |it| JsLocal::new(heap, it));
        let delay = |index: usize, absolute| {
            local(
                self.percentages[index]
                    .map_or_else(|| JSValue::js_number(absolute), |it| percent(heap, it)),
            )
        };
        EffectTiming {
            delay: delay(0, timing.delay),
            direction: [Normal, Reverse, Alternate, AlternateReverse][timing.direction as usize],
            duration: if timing.duration < 0.0 {
                heap.create_latin1_string(b"auto").as_value()
            } else {
                local(JSValue::js_number(timing.duration))
            },
            easing: timing.easing.written(),
            end_delay: delay(1, timing.end_delay),
            fill: if self.has_auto_fill {
                FillMode::Auto
            } else {
                [
                    FillMode::None,
                    FillMode::Forwards,
                    FillMode::Backwards,
                    FillMode::Both,
                ][timing.fill as usize]
            },
            iteration_start: timing.iteration_start,
            iterations: timing.iterations,
        }
    }
}

fn valid_pseudo<'a>(heap: &JsHeap<'a>, given: Option<&[u8]>) -> Result<'a, Option<Out>> {
    let parse = |it| {
        crate::cssom::pseudo_element(it).ok_or_else(|| {
            dom_error(
                heap,
                DomError::SyntaxError,
                "The pseudo-element is not valid.",
            )
        })
    };
    given.map(parse).transpose()
}

impl CompositeOperation {
    fn get(self) -> Composite {
        [Composite::Replace, Composite::Add, Composite::Accumulate][self as usize]
    }
}

impl AnimationEffect {
    pub(super) fn of_style(pseudo: &str) -> AnimationEffect {
        AnimationEffect {
            pseudo: (!pseudo.is_empty()).then(|| pseudo.into()).into(),
            ..AnimationEffect::default()
        }
    }

    pub(super) fn target(&self) -> Option<&Element> {
        js_AnimationEffect::target(self)
    }

    pub(super) fn timing(&self) -> Timing {
        self.specified.borrow().timing.clone()
    }

    pub(super) fn has_pseudo(&self) -> bool {
        self.pseudo.borrow().is_some()
    }

    pub(super) fn pseudo(&self) -> Pseudo {
        self.pseudo
            .borrow()
            .as_ref()
            .map_or(Pseudo::None, |it| Pseudo::from_name(it))
    }

    fn live_animation(&self) -> Option<&Animation> {
        js_AnimationEffect::animation(self).filter(|it| it.is_live())
    }

    /// Takes over what a style has changed.
    pub(super) fn refresh<'a>(&'a self, cx: &mut JsScope<'a>, with_keyframes: bool) {
        let Some(animation) = self.live_animation().filter(|it| it.is_css()) else {
            return;
        };
        let state = animation.state(cx);
        if let Some((timing, composite)) =
            animation.engine(|engine, id| engine.specified_effect(id))
        {
            let mut specified = self.specified.borrow_mut();
            specified.has_auto_fill &= timing.fill == types::FillMode::None;
            specified.timing = timing;
            self.composite.set(composite);
        }
        if with_keyframes && !state.has_keyframes_from_script {
            self.frames.replace(
                animation
                    .engine(|engine, id| engine.computed_keyframes(id))
                    .into_iter()
                    .map(Frame::from)
                    .collect(),
            );
        }
    }

    pub(super) fn send_keyframes(&self, engine: &mut Document, animation: u32) {
        let keyframes = self
            .frames
            .borrow()
            .iter()
            .map(|it| it.for_engine(&engine.base_url))
            .collect();
        engine.set_keyframes(animation, Some(keyframes), self.composite.get());
    }

    pub(crate) fn get_timing<'a>(&'a self, cx: &mut JsScope<'a>) -> EffectTiming<'a> {
        self.refresh(cx, false);
        self.specified.borrow().to_dictionary(self.realm(&cx.heap))
    }

    pub(crate) fn get_computed_timing<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
    ) -> ComputedEffectTiming<'a> {
        let EffectTiming {
            delay,
            direction,
            easing,
            end_delay,
            fill,
            iteration_start,
            iterations,
            ..
        } = self.get_timing(cx);
        let fill = if fill == FillMode::Auto {
            FillMode::None
        } else {
            fill
        };
        let (times, current_iteration, progress) = match js_AnimationEffect::animation(self) {
            Some(animation) => {
                animation.revive(cx);
                let state = animation.state(cx);
                let times = [
                    Some(state.duration),
                    Some(state.active_duration),
                    Some(state.end_time),
                    state.current_time,
                ];
                (
                    times.map(|it| animation.time_to_js(cx, it)),
                    state.iteration,
                    state.progress,
                )
            }
            None => {
                let timing = self.timing().normalized(None);
                let number = JSValue::js_number;
                (
                    [
                        number(timing.duration),
                        number(timing.active_duration()),
                        number(timing.end()),
                        JSValue::NULL,
                    ],
                    None,
                    None,
                )
            }
        };
        let [duration, active_duration, end_time, local_time] =
            times.map(|it| JsLocal::new(&cx.heap, it));
        ComputedEffectTiming {
            delay,
            direction,
            duration,
            easing,
            end_delay,
            fill,
            iteration_start,
            iterations,
            active_duration,
            current_iteration,
            end_time,
            local_time,
            progress,
        }
    }

    pub(crate) fn update_timing<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        timing: &OptionalEffectTiming<'a>,
    ) -> Result<'a, ()> {
        self.refresh(cx, false);
        let members = self.specified.borrow_mut().update(&cx.heap, timing)?;
        if let Some(animation) = js_AnimationEffect::animation(self) {
            animation.revive(cx);
            animation.engine(|engine, id| engine.set_timing(id, self.timing(), members));
            animation.changed(cx);
        }
        Ok(())
    }
}

impl KeyframeEffect {
    pub(super) fn parse<'a>(
        cx: &mut JsScope<'a>,
        keyframes: Keyframes<'a>,
        timing: &OptionalEffectTiming<'a>,
        composite: CompositeOperation,
        pseudo: Option<&[u8]>,
    ) -> Result<'a, AnimationEffect> {
        let effect = AnimationEffect::default();
        effect.specified.borrow_mut().update(&cx.heap, timing)?;
        effect.composite.set(composite.get());
        effect.pseudo.replace(valid_pseudo(&cx.heap, pseudo)?);
        effect.frames.replace(keyframes::process(cx, keyframes)?);
        Ok(effect)
    }

    pub(super) fn with_duration<'a>(
        cx: &mut JsScope<'a>,
        keyframes: Keyframes<'a>,
        duration: Option<f64>,
    ) -> Result<'a, AnimationEffect> {
        let duration = duration.map(Duration::Number);
        let timing = OptionalEffectTiming {
            delay: None,
            direction: None,
            duration,
            easing: None,
            end_delay: None,
            fill: None,
            iteration_start: None,
            iterations: None,
        };
        Self::parse(cx, keyframes, &timing, CompositeOperation::Replace, None)
    }

    pub(crate) fn constructor<'a>(
        cx: &mut JsScope<'a>,
        structure: ClassStructure<'a, Self>,
        target: Option<&'a Element>,
        keyframes: Keyframes<'a>,
        options: Option<DurationOrEffectOptions<'a>>,
    ) -> Result<'a, &'a Self> {
        let effect = match options {
            Some(DurationOrEffectOptions::Options(it)) => Self::parse(
                cx,
                keyframes,
                &timing_of!(&it),
                it.composite,
                it.pseudo_element,
            ),
            Some(DurationOrEffectOptions::Duration(it)) => {
                Self::with_duration(cx, keyframes, Some(it))
            }
            None => Self::with_duration(cx, keyframes, None),
        }?;
        let made = structure.create(&cx.heap, effect);
        js_AnimationEffect::set_target(made, target);
        Ok(made)
    }

    pub(crate) fn copy_of<'a>(
        cx: &mut JsScope<'a>,
        structure: ClassStructure<'a, Self>,
        source: &'a Self,
    ) -> &'a Self {
        source.refresh(cx, true);
        let AnimationEffect {
            specified,
            pseudo,
            composite,
            frames,
        } = &**source;
        let made = structure.create(
            &cx.heap,
            AnimationEffect {
                specified: specified.clone(),
                pseudo: pseudo.clone(),
                composite: composite.clone(),
                frames: frames.clone(),
            },
        );
        js_AnimationEffect::set_target(made, source.target());
        made
    }

    pub(crate) fn get_target<'a>(&'a self, _: &mut JsScope<'a>) -> Option<&'a Element> {
        self.target()
    }

    pub(crate) fn set_target<'a>(&'a self, cx: &mut JsScope<'a>, value: Option<&'a Element>) {
        js_AnimationEffect::animation(self)
            .into_iter()
            .for_each(|it| it.detach_from_target(&cx.heap));
        js_AnimationEffect::set_target(self, value);
        self.live_animation()
            .into_iter()
            .for_each(|it| it.retarget(cx));
    }

    pub(crate) fn get_pseudo_element<'a>(&self, _: &mut JsScope<'a>) -> Result<'a, Option<Out>> {
        Ok(self.pseudo.borrow().clone())
    }

    pub(crate) fn set_pseudo_element<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        value: Option<&[u8]>,
    ) -> Result<'a, ()> {
        self.pseudo.replace(valid_pseudo(&cx.heap, value)?);
        self.live_animation()
            .into_iter()
            .for_each(|it| it.retarget(cx));
        Ok(())
    }

    pub(crate) fn get_composite<'a>(&'a self, cx: &mut JsScope<'a>) -> CompositeOperation {
        self.refresh(cx, false);
        [
            CompositeOperation::Replace,
            CompositeOperation::Add,
            CompositeOperation::Accumulate,
        ][self.composite.get() as usize]
    }

    pub(crate) fn set_composite<'a>(&'a self, cx: &mut JsScope<'a>, value: CompositeOperation) {
        self.composite.set(value.get());
        if let Some(animation) = self.live_animation() {
            animation.engine(|engine, id| engine.set_keyframes(id, None, value.get()));
            animation.changed(cx);
        }
    }

    pub(crate) fn get_keyframes<'a>(&'a self, cx: &mut JsScope<'a>) -> Result<'a, JSValue> {
        self.refresh(cx, true);
        let (frames, animation) = (
            Rc::clone(&self.frames.borrow()),
            js_AnimationEffect::animation(self),
        );
        let knows_ranges = |it: &&'a Animation| {
            frames.iter().any(|it| it.range.is_some()) && it.state(cx).has_keyframes_from_script
        };
        let computed = self
            .live_animation()
            .filter(knows_ranges)
            .map(|it| it.engine(|engine, id| engine.computed_offsets(id)));
        let all = List::new(&cx.heap);
        for (index, frame) in frames.iter().enumerate() {
            let offset = match &computed {
                Some(all) if frame.range.is_some() => {
                    all.get(index).copied().flatten().map(f64::from)
                }
                _ => frame
                    .computed_offset()
                    .filter(|_| frame.range.is_none() || animation.is_some_and(Animation::is_css)),
            };
            let object = frame.to_js(cx, offset)?;
            all.push(&cx.heap, object);
        }
        Ok(all.to_js())
    }

    pub(crate) fn set_keyframes<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        keyframes: Keyframes<'a>,
    ) -> Result<'a, ()> {
        self.refresh(cx, false);
        self.frames.replace(keyframes::process(cx, keyframes)?);
        if let Some(animation) = self.live_animation() {
            animation.engine(|engine, id| self.send_keyframes(engine, id));
            animation.changed(cx);
        }
        Ok(())
    }
}
