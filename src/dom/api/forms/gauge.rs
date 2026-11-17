//! `meter` and `progress`

use super::microsyntax::{parse_float, write_float};
use super::*;
use crate::generated_bindgen::forms::{GaugeNumber, HTMLProgressElement};

fn is_meter(element: &Element) -> bool {
    element.is_html(atom!("meter"))
}

/// The actual value of the attribute with that name.
pub(crate) fn number(element: &Element, name: Known) -> f64 {
    let given = element
        .with_attr(name, |it| parse_float(it.as_bytes()))
        .flatten();
    let [min, max] = [atom!("min"), atom!("max")].map(|it| move || number(element, it));
    match name {
        atom!("min") => given.filter(|_| is_meter(element)).unwrap_or(0.0),
        atom!("max") if is_meter(element) => given.unwrap_or(1.0).max(min()),
        atom!("max") => given.filter(|it| *it > 0.0).unwrap_or(1.0),
        atom!("low") => given.map_or_else(min, |it| it.clamp(min(), max())),
        atom!("high") => {
            given.map_or_else(max, |it| it.clamp(number(element, atom!("low")), max()))
        }
        atom!("optimum") => {
            given.map_or_else(|| min().midpoint(max()), |it| it.clamp(min(), max()))
        }
        _ => given.unwrap_or(0.0).clamp(min(), max()),
    }
}

fn build<'a>(cx: &mut Cx<'a>, element: &'a Element) {
    let parts = match is_meter(element) {
        true => [
            "-webkit-meter-inner-element",
            "-webkit-meter-bar",
            "-webkit-meter-optimum-value",
        ],
        false => [
            "-webkit-progress-inner-element",
            "-webkit-progress-bar",
            "-webkit-progress-value",
        ],
    };
    let root: &Node = element.attach_ua_shadow(cx);
    parts
        .into_iter()
        .fold(root, |parent, it| div(cx, element, parent, it));
    render(cx, element);
}

pub(super) fn render<'a>(cx: &mut Cx<'a>, element: &'a Element) {
    element.set_state(
        cx,
        State::INDETERMINATE,
        !is_meter(element) && !element.has_attr(atom!("value")),
    );
    let Some(bar) = element
        .shadow_root()
        .and_then(|it| it.descendant_elements().last())
    else {
        return;
    };
    let [value, min, max] =
        [atom!("value"), atom!("min"), atom!("max")].map(|it| number(element, it));
    set_part_style(
        cx,
        bar,
        &format!(
            "inline-size:{}%",
            if max > min {
                (value - min) / (max - min) * 100.0
            } else {
                0.0
            }
        ),
    );
    if is_meter(element) {
        let [low, high, optimum] =
            [atom!("low"), atom!("high"), atom!("optimum")].map(|it| number(element, it));
        let region = |it: f64| usize::from(it >= low) + usize::from(it > high);
        let parts = [
            "-webkit-meter-optimum-value",
            "-webkit-meter-suboptimum-value",
            "-webkit-meter-even-less-good-value",
        ];
        bar.set_pseudo(parts[region(value).abs_diff(region(optimum))], element);
    }
}

impl GaugeNumber {
    pub(crate) fn get(&self, name: Known) -> f64 {
        number(self, name)
    }

    pub(crate) fn set<'a>(&'a self, cx: &mut Cx<'a>, name: Known, value: f64) {
        if is_meter(self) || name != atom!("max") || value > 0.0 {
            self.set_attr(cx, name, from_ascii(&write_float(value)));
        }
    }
}

impl HTMLProgressElement {
    pub(crate) fn get_position(&self) -> f64 {
        if self.has_attr(atom!("value")) {
            number(self, atom!("value")) / number(self, atom!("max"))
        } else {
            -1.0
        }
    }
}

pub(crate) static STEPS: Steps = Steps {
    ua_shadow: Some(build),
    attribute_changed: Some(|cx, element, _| dirty(cx, element)),
    ..Steps::NONE
};
