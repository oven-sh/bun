//! What the mouse and the keys do to an `input`.

use super::*;
use crate::api::ui::activation::{self, Click};
use crate::api::ui::pointer::Tracking;
use crate::api::uievents::{InputDetails, InputEvent, KeyboardEvent, MouseEvent};
use InputType::*;

impl<'a> Input<'a> {
    pub(crate) fn slide_to(self, cx: &mut Cx<'a>, point: [f64; 2]) {
        let Some((track, thumb)) = self
            .look()
            .and_then(|it| it.parent_element().zip(it.next_sibling()))
        else {
            return;
        };
        let inline_start = writing_mode(cx, track).sides()[3];
        let axis = 1 - inline_start % 2;
        let ([from, to], thumb) = (
            layout::bounding_rect(cx, track).span(axis),
            layout::bounding_rect(cx, thumb).to_array()[2 + axis],
        );
        let fraction = (point[axis] - f64::from(from + thumb / 2.0)) / f64::from(to - from - thumb);
        let fraction = if matches!(inline_start, 1 | 2) {
            1.0 - fraction
        } else {
            fraction
        };
        let (limits, before) = (self.limits(), self.value());
        let (min, max) = (limits.min.unwrap_or(0.0), limits.max.unwrap_or(0.0));
        self.set_number(cx, min + fraction * (max - min));
        if self.value() != before {
            fire_input(cx, self.element);
        }
    }

    pub(crate) fn start_sliding(self, cx: &mut Cx<'a>, ui: &'a Ui, point: [f64; 2]) {
        self.text.begin_edit();
        self.slide_to(cx, point);
        ui.pointer().track(Tracking::Slider, self.element);
    }

    /// Whether `target` is in a slider whose thumb moves along that axis.
    pub(crate) fn slider_along(
        cx: &mut Cx<'a>,
        target: &'a Element,
        is_sideways: bool,
    ) -> Option<Input<'a>> {
        let input = Input::of(target.out_of_control().as_element()?)?;
        (input.kind() == Range
            && !is_disabled(input.element)
            && writing_mode(cx, input.element).is_vertical() != is_sideways)
            .then_some(input)
    }

    pub(crate) fn stop_sliding(self, cx: &mut Cx<'a>) {
        self.text.commit(cx);
    }

    fn move_thumb(self, cx: &mut Cx<'a>, key: Known) -> bool {
        let (limits, before) = (self.limits(), self.value());
        let (min, max) = (limits.min.unwrap_or(0.0), limits.max.unwrap_or(0.0));
        let page = ((max - min) / 10.0 / limits.step.unwrap_or(1.0))
            .max(1.0)
            .round() as i32;
        let [block_start, _, _, inline_start] = writing_mode(cx, self.element).sides();
        let [right, down] = match inline_start {
            0 | 2 => [
                if block_start == 1 { 1 } else { -1 },
                1 - inline_start as i32,
            ],
            _ => [inline_start as i32 - 2, -1],
        };
        match key {
            atom!("Home") => self.set_number(cx, min),
            atom!("End") => self.set_number(cx, max),
            atom!("ArrowUp") => _ = self.step_by(cx, -down),
            atom!("ArrowDown") => _ = self.step_by(cx, down),
            atom!("ArrowLeft") => _ = self.step_by(cx, -right),
            atom!("ArrowRight") => _ = self.step_by(cx, right),
            atom!("PageUp") => _ = self.step_by(cx, page),
            atom!("PageDown") => _ = self.step_by(cx, -page),
            _ => return false,
        }
        if self.value() != before {
            user_changed(cx, self.element);
        }
        true
    }

    fn move_in_group(self, cx: &mut Cx<'a>, step: i32) {
        let group: Vec<_> = self
            .group()
            .map(|it| it.element)
            .filter(|it| *it == self.element || focus::is_focusable(cx, it))
            .collect();
        let index = group.iter().position(|it| *it == self.element).unwrap_or(0);
        let next = group[(index as i32 + step).rem_euclid(group.len() as i32) as usize];
        focus::focus(cx, next, focus::Cause::Keyboard, focus::Options::default());
        activation::click(cx, next, Trusted::Yes, Click::default());
    }

    fn step_by_user(self, cx: &mut Cx<'a>, count: i32) {
        self.text.begin_edit();
        let init = EventInit {
            cancelable: true,
            ..COMPOSED
        };
        let event = InputEvent::new(
            &cx.heap,
            self.element.doc(),
            atom!("beforeinput"),
            init,
            atom!("insertReplacementText"),
            &InputDetails::default(),
        );
        if dispatch(cx, self.element, event) && self.step_by(cx, count) {
            fire_input(cx, self.element);
            self.text.commit(cx);
        }
    }

    fn clear(self, cx: &mut Cx<'a>) {
        self.text.edit(
            cx,
            0,
            self.text.len(),
            &DomString::default(),
            atom!("deleteContent"),
        );
        fire_input(cx, self.element);
    }

    fn mouse_down(self, cx: &mut Cx<'a>, event: &'a MouseEvent, origin: &'a Node) {
        let mouse = event.mouse();
        if self.kind() == Range {
            if let Some(ui) = Ui::of(self.element.doc()).filter(|_| mouse.button == 0) {
                self.start_sliding(cx, ui, mouse.client);
            }
            return;
        }
        if !self.text.is_mutable() {
            return;
        }
        if origin.is_part("-webkit-search-cancel-button") {
            self.clear(cx);
            fire(cx, self.element, atom!("search"), BUBBLES);
        } else if origin.is_part("-webkit-inner-spin-button") {
            let rect = layout::bounding_rect(cx, origin);
            self.step_by_user(
                cx,
                if mouse.client[1] < f64::from(rect.y + rect.height / 2.0) {
                    1
                } else {
                    -1
                },
            );
        }
    }

    fn key_down(self, cx: &mut Cx<'a>, key: Known) -> bool {
        match (self.kind(), key, arrow_step(key)) {
            (Range, ..) => return self.move_thumb(cx, key),
            (Radio, _, Some(step)) => self.move_in_group(cx, step),
            (Number, atom!("ArrowUp") | atom!("ArrowDown"), Some(step)) => {
                if self.text.is_mutable() {
                    self.step_by_user(cx, -step);
                }
            }
            (Search, atom!("Escape"), _) if self.text.len() > 0 && self.text.is_mutable() => {
                self.clear(cx)
            }
            _ => return false,
        }
        true
    }
}

pub(super) fn default_action<'a>(
    cx: &mut Cx<'a>,
    element: &'a Element,
    event: &'a Event,
    origin: &'a Node,
) -> bool {
    let input = Input::new(element);
    if is_disabled(element) {
        return false;
    }
    let (kind, key) = (input.kind(), event.downcast::<KeyboardEvent>());
    match (event.name(), key, event.downcast::<MouseEvent>()) {
        (atom!("keydown"), Some(event), _) if kind.has_date_fields() => {
            date_fields::key_down(cx, input, event)
        }
        (atom!("keydown"), Some(event), _) if kind == Color => {
            color_picker::key_down(cx, input, event)
        }
        (atom!("keypress"), Some(event), _) if kind == Color => {
            color_picker::key_press(cx, input, event)
        }
        (atom!("keydown"), Some(event), _) => {
            suggestions::key_down(cx, input, event.key()) || input.key_down(cx, event.key())
        }
        (atom!("keypress"), Some(event), _)
            if event.key() == atom!("Enter") && (kind.is_typed() || kind.is_checkable()) =>
        {
            input.text.commit(cx);
            if kind == Search {
                fire(cx, element, atom!("search"), BUBBLES);
            }
            form::submit_implicitly(cx, element);
            true
        }
        (atom!("mousedown"), _, Some(event)) => {
            match kind {
                Color => color_picker::mouse_down(cx, input, event, origin),
                _ if kind.has_date_fields() => date_picker::mouse_down(cx, input, event, origin),
                _ if suggestions::mouse_down(cx, input, event, origin) => return true,
                _ => input.mouse_down(cx, event, origin),
            }
            false
        }
        _ => false,
    }
}
