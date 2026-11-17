//! The pop-up of `<input type=color>`.

use super::*;
use crate::api::ui::assistive::Semantics;
use crate::api::ui::pointer::Tracking;
use crate::api::uievents::{KeyboardEvent, MouseEvent};

const PICKER: &str = "-internal-color-picker";
const WELL: &str = "-internal-color-well";
const HUES: &str = "-internal-color-hues";
const RING: &str = "-internal-color-ring";
const PREVIEW: &str = "-internal-color-preview";
const CODE: &str = "-internal-color-code";
const SUGGESTION: &str = "-internal-color-suggestion";

pub(super) struct Picker {
    /// Hue, saturation and value from 0 to 1. Grays would lose the first.
    hsv: [f32; 3],
    initial: DomString,
    typed: String,
    /// Of `stops`.
    active: usize,
}

fn rgb_of(color: &DomString) -> Option<u32> {
    crate::bindings::parse_rgba(color.to_utf8().as_bytes(), 0xff).map(|it| it >> 8)
}

fn to_hsv(rgb: u32, old: [f32; 3]) -> [f32; 3] {
    let [r, g, b] = [16, 8, 0].map(|it| (rgb >> it & 0xff) as f32 / 255.0);
    let (max, range) = (r.max(g).max(b), r.max(g).max(b) - r.min(g).min(b));
    let hue = match () {
        () if range == 0.0 => old[0],
        () if max == r => ((g - b) / range).rem_euclid(6.0) / 6.0,
        () if max == g => ((b - r) / range + 2.0) / 6.0,
        () => ((r - g) / range + 4.0) / 6.0,
    };
    [hue, if max == 0.0 { old[1] } else { range / max }, max]
}

fn to_hex([hue, saturation, value]: [f32; 3]) -> String {
    let [r, g, b] = [5.0, 3.0, 1.0].map(|it: f32| {
        let at = (it + hue * 6.0) % 6.0;
        ((value - value * saturation * at.min(4.0 - at).clamp(0.0, 1.0)) * 255.0).round() as u8
    });
    format!("#{r:02x}{g:02x}{b:02x}")
}

fn with_picker<R>(input: Input<'_>, f: impl FnOnce(&mut Picker) -> R) -> Option<R> {
    input.state.color_picker.borrow_mut().as_deref_mut().map(f)
}

pub(super) fn is_inside(input: Input<'_>, node: &Node) -> bool {
    pop_up(input.element, PICKER).is_some_and(|it| it.contains_flat(node))
}

pub(super) fn is_open(input: Input<'_>) -> bool {
    input.state.color_picker.borrow().is_some()
}

fn stops(input: Input<'_>) -> impl Iterator<Item = &Element> {
    let all = pop_up(input.element, PICKER)
        .into_iter()
        .flat_map(|it| it.descendant_elements());
    all.filter(|it| {
        [WELL, HUES, CODE, SUGGESTION]
            .into_iter()
            .any(|name| it.is_part(name))
    })
}

pub(crate) fn active_part(input: Input<'_>) -> Option<&Element> {
    stops(input).nth(with_picker(input, |it| it.active)?)
}

fn activate<'a>(cx: &mut Cx<'a>, input: Input<'a>, index: usize) {
    with_picker(input, |it| it.active = index);
    stops(input)
        .enumerate()
        .for_each(|(at, it)| it.set_state(cx, State::FOCUS, at == index));
}

/// False if the focus cannot be in `part`.
pub(crate) fn enter<'a>(cx: &mut Cx<'a>, input: Input<'a>, part: &'a Element) -> bool {
    stops(input)
        .position(|it| it == part)
        .map(|it| activate(cx, input, it))
        .is_some()
}

pub(crate) fn semantics(input: Input<'_>, part: &Element) -> Semantics {
    let Some([hue, saturation, brightness]) =
        with_picker(input, |it| it.hsv.map(|it| (it * 100.0).round()))
    else {
        return Vec::new();
    };
    let named =
        |role: &str, label: &str| vec![("role", role.to_owned()), ("aria-label", label.to_owned())];
    match () {
        () if part.is_part(PICKER) => named("dialog", "Color picker"),
        () if part.is_part(CODE) => named("textbox", "Hex color value"),
        () if part.is_part(SUGGESTION) => vec![("role", "button".to_owned())],
        () if part.is_part(HUES) => [
            named("slider", "Hue slider"),
            vec![("aria-valuenow", hue.to_string())],
        ]
        .concat(),
        () if part.is_part(WELL) => [
            named(
                "slider",
                "Color well with two-dimensional slider for selecting saturation and lightness",
            ),
            vec![
                ("aria-roledescription", "2D slider".to_owned()),
                ("aria-valuenow", saturation.to_string()),
                (
                    "aria-valuetext",
                    format!("X: {saturation}, Y: {brightness}"),
                ),
            ],
        ]
        .concat(),
        () => Vec::new(),
    }
}

pub(super) fn open<'a>(cx: &mut Cx<'a>, input: Input<'a>) {
    let element = input.element;
    if is_open(input) {
        return;
    }
    let Some(picker) = open_pop_up(cx, element, PICKER) else {
        return;
    };
    let well = div(cx, element, picker, WELL);
    let row = div(cx, element, picker, "-internal-color-row");
    div(cx, element, row, PREVIEW);
    let hues = div(cx, element, row, HUES);
    [well, hues]
        .into_iter()
        .for_each(|it| _ = div(cx, element, it, RING));
    let code = div(cx, element, picker, CODE);
    text_in(cx, code, "");
    let row = div(cx, element, picker, "-internal-color-row");
    for rgb in suggestions::options(input).filter_map(|it| rgb_of(&option::value(it))) {
        let swatch = div(cx, element, row, SUGGESTION);
        swatch.set_attr(
            cx,
            atom!("title"),
            DomString::from_utf8(&format!("#{rgb:06x}")),
        );
        set_part_style(cx, swatch, &format!("background-color:#{rgb:06x}"));
    }
    input.state.color_picker.replace(Some(Box::new(Picker {
        hsv: [0.0; 3],
        initial: input.value(),
        typed: String::new(),
        active: 0,
    })));
    element.set_state(cx, State::PICKER_OPEN, true);
    input.text.begin_edit();
    activate(cx, input, 0);
    render(cx, input);
}

/// No script runs.
pub(super) fn close<'a>(cx: &mut Cx<'a>, input: Input<'a>) {
    if input.state.color_picker.take().is_some() {
        close_pop_up(cx, input.element, PICKER);
        input.element.set_state(cx, State::PICKER_OPEN, false);
    }
}

pub(super) fn finish<'a>(cx: &mut Cx<'a>, input: Input<'a>) {
    close(cx, input);
    input.text.commit(cx);
}

pub(super) fn render<'a>(cx: &mut Cx<'a>, input: Input<'a>) {
    let value = input.value();
    let state = with_picker(input, |it| {
        if !value.eq_str(&to_hex(it.hsv)) {
            it.hsv = to_hsv(rgb_of(&value).unwrap_or(0), it.hsv);
        }
        (
            it.hsv.map(|it| it * 100.0),
            if it.typed.is_empty() {
                value.clone()
            } else {
                format!("#{}", it.typed).as_str().into()
            },
        )
    });
    let (Some(([hue, saturation, brightness], code)), Some(picker)) =
        (state, pop_up(input.element, PICKER))
    else {
        return;
    };
    for part in picker.descendant_elements() {
        match () {
            () if part.is_part(WELL) => set_part_style(
                cx,
                part,
                &format!("background-color:hsl({} 100% 50%)", hue * 3.6),
            ),
            () if part.is_part(PREVIEW) => {
                set_part_style(cx, part, &format!("background-color:{}", value.to_utf8()))
            }
            () if part.is_part(CODE) => set_text(cx, part.first_child(), &code),
            () if !part.is_part(RING) => {}
            () if part.parent().is_some_and(|it| it.is_part(HUES)) => {
                set_part_style(cx, part, &format!("left:{hue}%;top:50%"))
            }
            () => set_part_style(
                cx,
                part,
                &format!("left:{saturation}%;top:{}%", 100.0 - brightness),
            ),
        }
    }
}

fn choose<'a>(cx: &mut Cx<'a>, input: Input<'a>, color: &DomString) {
    let before = input.value();
    input.set_value(cx, color);
    render(cx, input);
    if input.value() != before {
        fire_input(cx, input.element);
    }
}

fn change<'a>(cx: &mut Cx<'a>, input: Input<'a>, f: impl FnOnce([f32; 3]) -> [f32; 3]) {
    let color = with_picker(input, |it| {
        it.typed.clear();
        it.hsv = f(it.hsv).map(|it| it.clamp(0.0, 1.0));
        to_hex(it.hsv)
    });
    color
        .into_iter()
        .for_each(|it| choose(cx, input, &it.as_str().into()));
}

/// `part` is what the mouse went down in.
pub(crate) fn follow<'a>(cx: &mut Cx<'a>, part: &'a Element, point: [f64; 2]) {
    let Some(input) = part.out_of_control().as_element().and_then(Input::of) else {
        return;
    };
    let (rect, [x, y]) = (layout::bounding_rect(cx, part), layout::narrow(point));
    let [x, y] = [(x - rect.x) / rect.width, (y - rect.y) / rect.height];
    change(cx, input, |[hue, saturation, value]| {
        if part.is_part(HUES) {
            [x, saturation, value]
        } else {
            [hue, x, 1.0 - y]
        }
    });
}

pub(super) fn mouse_down<'a>(
    cx: &mut Cx<'a>,
    input: Input<'a>,
    event: &'a MouseEvent,
    origin: &'a Node,
) {
    let Some(ui) = Ui::of(input.element.doc()).filter(|_| event.get_button() == 0) else {
        return;
    };
    if let Some(part) = origin
        .inclusive_ancestors()
        .find(|it| it.is_part(WELL) || it.is_part(HUES))
        .and_then(Node::as_element)
    {
        enter(cx, input, part);
        ui.pointer().track(Tracking::Color, part);
        follow(cx, part, event.mouse().client);
    } else if let Some(part) = origin.as_element().filter(|it| it.is_part(SUGGESTION)) {
        take_suggestion(cx, input, part);
    }
}

fn take_suggestion<'a>(cx: &mut Cx<'a>, input: Input<'a>, part: &'a Element) {
    with_picker(input, |it| it.typed.clear());
    part.attr(atom!("title"))
        .into_iter()
        .for_each(|it| choose(cx, input, &it));
}

fn edit_code<'a>(cx: &mut Cx<'a>, input: Input<'a>, f: impl FnOnce(&mut String)) {
    let typed = with_picker(input, |it| {
        f(&mut it.typed);
        it.typed.clone()
    });
    match typed.filter(|it| matches!(it.len(), 3 | 6)) {
        Some(typed) => choose(cx, input, &format!("#{typed}").as_str().into()),
        None => render(cx, input),
    }
}

pub(super) fn key_down<'a>(cx: &mut Cx<'a>, input: Input<'a>, event: &'a KeyboardEvent) -> bool {
    const STEP: f32 = 0.01;
    let (Some((initial, active)), Some(part)) = (
        with_picker(input, |it| (it.initial.clone(), it.active)),
        active_part(input),
    ) else {
        return false;
    };
    let (axis, step) = match event.key() {
        atom!("Tab") => {
            let count = stops(input).count();
            return (
                activate(
                    cx,
                    input,
                    (active + if event.get_shift_key() { count - 1 } else { 1 }) % count,
                ),
                true,
            )
                .1;
        }
        atom!("Enter") | atom!(" ") if part.is_part(SUGGESTION) => {
            return (take_suggestion(cx, input, part), true).1;
        }
        atom!("ArrowLeft") | atom!("ArrowDown") if part.is_part(HUES) => (0, -STEP),
        atom!("ArrowRight") | atom!("ArrowUp") if part.is_part(HUES) => (0, STEP),
        atom!("ArrowLeft") => (1, -STEP),
        atom!("ArrowRight") => (1, STEP),
        atom!("ArrowUp") => (2, STEP),
        atom!("ArrowDown") => (2, -STEP),
        atom!("PageUp") => (0, STEP),
        atom!("PageDown") => (0, -STEP),
        atom!("Backspace") => return (edit_code(cx, input, |it| _ = it.pop()), true).1,
        atom!("Escape") if input.value() != initial => {
            with_picker(input, |it| it.typed.clear());
            return (choose(cx, input, &initial), true).1;
        }
        atom!("Escape") | atom!("Enter") => return (finish(cx, input), true).1,
        _ => return false,
    };
    change(cx, input, |mut hsv| {
        hsv[axis] += step;
        hsv
    });
    true
}

pub(super) fn key_press<'a>(cx: &mut Cx<'a>, input: Input<'a>, event: &'a KeyboardEvent) -> bool {
    let Some(digit) =
        char::from_u32(event.get_char_code()).filter(|it| it.is_ascii_hexdigit() && is_open(input))
    else {
        return false;
    };
    edit_code(cx, input, |it| {
        if it.len() == 6 {
            it.clear();
        }
        it.push(digit.to_ascii_lowercase());
    });
    true
}
