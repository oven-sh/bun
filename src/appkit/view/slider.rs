//! `Slider`: an `NSSlider` with an optional step.

use super::{Cx, Event, Prop, Widget};
use crate::error::Result;
use crate::geometry::Positive;
use crate::objc::appkit::{NSSlider, NSView};

/// Above this many steps tick marks stop being useful and just cost drawing.
const MAX_TICK_MARKS: f64 = 50.0;
const DEFAULT_MIN: f64 = 0.0;
const DEFAULT_MAX: f64 = 1.0;
const DEFAULT_CONTINUOUS: bool = true;

pub(crate) struct Slider {
    view: NSSlider,
    step: Option<Positive>,
    /// What was last asked for (by a prop or the user), before snapping/clamping.
    wanted: f64,
}

impl Slider {
    pub(crate) fn new(cx: &Cx<'_>) -> Slider {
        let view = NSSlider::with_value(0.0, DEFAULT_MIN, DEFAULT_MAX, None, None);
        view.set_continuous(DEFAULT_CONTINUOUS);
        super::wire_action(cx, &view);
        Slider {
            view,
            step: None,
            wanted: 0.0,
        }
    }

    fn snap(&self, value: f64) -> f64 {
        let (min, max) = (self.view.min_value(), self.view.max_value());
        let value = match self.step {
            Some(step) => min + ((value - min) / step.get()).round() * step.get(),
            None => value,
        };
        if min <= max {
            value.clamp(min, max)
        } else {
            value
        }
    }

    fn apply(&self) {
        self.view.set_double_value(self.snap(self.wanted));
    }

    fn update_tick_marks(&self) {
        let steps = match self.step {
            Some(step) => (self.view.max_value() - self.view.min_value()) / step.get(),
            None => 0.0,
        };
        // NSSlider spaces tick marks evenly from min to max, so they only coincide with the step
        // grid when the range is a whole number of steps; otherwise `snap` alone does the snapping.
        let integral = (steps - steps.round()).abs() <= 1e-9 * steps.max(1.0);
        let ticks = if integral && (1.0..=MAX_TICK_MARKS).contains(&steps) {
            steps.round() as isize + 1
        } else {
            0
        };
        self.view.set_number_of_tick_marks(ticks);
        self.view.set_allows_tick_mark_values_only(ticks > 0);
    }
}

impl Widget for Slider {
    fn view(&self) -> &NSView {
        &self.view
    }

    fn set<'p>(&mut self, _cx: &Cx<'_>, prop: Prop<'p>) -> Result<Option<Prop<'p>>> {
        match prop {
            Prop::Number(v) => {
                self.wanted = v;
                self.apply();
            }
            Prop::Min(v) => {
                self.view.set_min_value(v.unwrap_or(DEFAULT_MIN));
                self.update_tick_marks();
                self.apply();
            }
            Prop::Max(v) => {
                self.view.set_max_value(v.unwrap_or(DEFAULT_MAX));
                self.update_tick_marks();
                self.apply();
            }
            Prop::Step(s) => {
                self.step = s;
                self.update_tick_marks();
                self.apply();
            }
            Prop::Continuous(b) => self.view.set_continuous(b.unwrap_or(DEFAULT_CONTINUOUS)),
            Prop::Enabled(b) => self.view.set_enabled(b),
            other => return Ok(Some(other)),
        }
        Ok(None)
    }

    fn number(&self) -> Option<f64> {
        Some(self.view.double_value())
    }

    fn on_action(&mut self, emit: &mut dyn FnMut(Event)) {
        let raw = self.view.double_value();
        let value = self.snap(raw);
        if value != raw {
            self.view.set_double_value(value);
        }
        self.wanted = value;
        emit(Event::ValueChanged(value));
    }

    fn detach(&mut self) {
        super::unwire_action(&self.view);
    }
}
