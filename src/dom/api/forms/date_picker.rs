//! The pop-up of `<input type=date>` and its like.

use super::date_fields::{self, Unit, month_names, with_fields};
use super::locale::local_time;
use super::microsyntax::{DAY, Date, month_at, weekday, write_date};
use super::*;
use crate::api::ui::assistive::Semantics;
use crate::api::uievents::MouseEvent;
use crate::tree::NodeId;

#[derive(Clone, Copy)]
enum Action {
    ShowMonth(Date),
    PickDay(Date),
    Choose(Unit, u32),
    Clear,
}

#[derive(Default)]
pub(super) struct Picker {
    /// By the buttons, which are connected while it is open.
    actions: Vec<(NodeId, Action)>,
    month: Option<Date>,
    /// The day that the arrow keys start from.
    cursor: Option<Date>,
    initial: DomString,
    filled_for: DomString,
}

fn picker(input: Input<'_>) -> Option<&Element> {
    pop_up(input.element, "-internal-date-picker")
}

pub(super) fn is_open(input: Input<'_>) -> bool {
    input.element.has_state(State::PICKER_OPEN)
}

fn today<'a>(cx: &mut Cx<'a>) -> Date {
    Date::from_days((local_time(cx.global()) / DAY).floor() as i64)
}

pub(super) fn set_open<'a>(cx: &mut Cx<'a>, input: Input<'a>, opens: bool) {
    let element = input.element;
    let (Some(ui), Some(picker)) = (Ui::left_in(element.doc()), picker(input)) else {
        return;
    };
    if opens == is_open(input) || opens && !input.text.is_mutable() {
        return;
    }
    element.set_state(cx, State::PICKER_OPEN, opens);
    set_in_top_layer(cx, ui, picker, opens);
    ui.set_open_picker(opens.then_some(element));
    with_fields(input, |it| it.picker.initial = input.value());
    if opens && input.kind() == InputType::Time {
        date_fields::leave_button(cx, input);
    }
    show_value(cx, input);
    if opens {
        let (rect, size, [width, height]) = (
            layout::bounding_rect(cx, element),
            layout::bounding_rect(cx, picker),
            layout::viewport_size(ui.doc()),
        );
        let top = if rect.bottom() + size.height > height && rect.y > size.height {
            rect.y - size.height
        } else {
            rect.bottom()
        };
        set_part_style(
            cx,
            picker,
            &format!(
                "left:{}px;top:{top}px",
                rect.x.min(width - size.width).max(0.0)
            ),
        );
    }
}

fn months_later(day: Date, count: i64) -> Date {
    let [first, next] =
        [count, count + 1].map(|it| Date::first_of(day.year, day.month + it).days());
    Date::from_days((first + day.day - 1).min(next - 1))
}

fn show_value<'a>(cx: &mut Cx<'a>, input: Input<'a>) {
    let (today, monday) = (
        today(cx),
        input.number().filter(|_| input.kind() == InputType::Week),
    );
    with_fields(input, |it| {
        let [year, month, day] = [
            (Unit::Year, today.year),
            (Unit::Month, today.month),
            (Unit::Day, today.day),
        ]
        .map(|(unit, now)| it.value(unit).map_or(now, i64::from));
        let day = monday.map_or_else(
            || months_later(Date { year, month, day }, 0),
            |it| Date::from_days((it / DAY).floor() as i64),
        );
        (it.picker.month, it.picker.cursor) = (Some(Date { day: 1, ..day }), Some(day));
    });
    fill(cx, input);
}

/// The fields can be edited while it is open.
pub(super) fn follow_value<'a>(cx: &mut Cx<'a>, input: Input<'a>) {
    if is_open(input)
        && with_fields(input, |it| it.picker.filled_for != input.text.text()) == Some(true)
    {
        show_value(cx, input);
    }
}

fn cursor(input: Input<'_>) -> Option<Date> {
    with_fields(input, |it| {
        it.picker
            .cursor
            .filter(|_| is_open(input) && it.is_in_calendar())
    })
    .flatten()
}

pub(super) fn active_cell(input: Input<'_>) -> Option<&Element> {
    let (cursor, by_month) = (cursor(input)?, input.kind() == InputType::Month);
    let is_it = |it: &&(NodeId, Action)| matches!(it.1, Action::PickDay(day) if day == if by_month { Date { day: 1, ..cursor } } else { cursor });
    let id = with_fields(input, |it| Some(it.picker.actions.iter().find(is_it)?.0)).flatten()?;
    picker(input)?
        .descendant_elements()
        .find(|it| it.id() == id)
}

pub(super) fn mark_cursor<'a>(cx: &mut Cx<'a>, input: Input<'a>) {
    let active = active_cell(input);
    picker(input)
        .into_iter()
        .flat_map(|it| it.descendant_elements())
        .for_each(|it| it.set_state(cx, State::FOCUS, Some(it) == active));
}

pub(super) fn move_cursor<'a>(cx: &mut Cx<'a>, input: Input<'a>, key: Known) -> bool {
    let Some(from) = cursor(input) else {
        return false;
    };
    let (step, [days, months]) = match key {
        atom!("ArrowLeft") | atom!("ArrowRight") => (
            if (key == atom!("ArrowLeft")) == looks_like(cx, input.element, Looks::RTL) {
                1
            } else {
                -1
            },
            [1, 1],
        ),
        atom!("ArrowUp") | atom!("ArrowDown") => {
            (if key == atom!("ArrowDown") { 1 } else { -1 }, [7, 4])
        }
        atom!("PageUp") | atom!("PageDown") => {
            (if key == atom!("PageDown") { 1 } else { -1 }, [0, 12])
        }
        _ => return false,
    };
    let to = match input.kind() {
        InputType::Month => months_later(from, step * months),
        _ if days == 0 => months_later(from, step),
        _ => Date::from_days(from.days() + step * days),
    };
    if can_pick(input, to) {
        with_fields(input, |it| {
            (it.picker.month, it.picker.cursor) = (Some(Date { day: 1, ..to }), Some(to))
        });
        pick(cx, input, to);
    }
    true
}

pub(super) fn accept<'a>(cx: &mut Cx<'a>, input: Input<'a>) {
    match cursor(input) {
        Some(day) if can_pick(input, day) => pick(cx, input, day),
        Some(_) => {}
        None => choose(cx, input, &[]),
    }
    set_open(cx, input, false);
}

pub(super) fn cancel<'a>(cx: &mut Cx<'a>, input: Input<'a>) {
    let initial =
        with_fields(input, |it| it.picker.initial.clone()).filter(|it| *it != input.value());
    set_open(cx, input, false);
    initial
        .into_iter()
        .for_each(|it| date_fields::set(cx, input, it));
}

fn piece<'a>(
    cx: &mut Cx<'a>,
    input: Input<'a>,
    parent: &'a Node,
    name: &str,
    text: &str,
) -> &'a Element {
    let made = div(
        cx,
        input.element,
        parent,
        &format!("-internal-date-picker-{name}"),
    );
    if !text.is_empty() {
        text_in(cx, made, text);
    }
    made
}

fn button<'a>(
    cx: &mut Cx<'a>,
    input: Input<'a>,
    parent: &'a Node,
    name: &str,
    text: &str,
    action: Option<Action>,
) -> &'a Element {
    let made = piece(
        cx,
        input,
        parent,
        if action.is_some() { name } else { "disabled" },
        text,
    );
    with_fields(input, |it| {
        it.picker.actions.extend(action.map(|it| (made.id(), it)))
    });
    made
}

pub(super) fn semantics(input: Input<'_>, part: &Element) -> Semantics {
    if picker(input) == Some(part) {
        return vec![("role", "dialog".to_owned())];
    }
    let all = with_fields(input, |fields| {
        let label = match fields.picker.actions.iter().find(|it| it.0 == part.id())?.1 {
            Action::ShowMonth(month) => fields
                .locale
                .format(&fields.locale.pattern("yMMMM"), month.days() as f64 * DAY),
            Action::PickDay(day) if !part.is_part("-internal-date-picker-link") => {
                let skeleton = if input.kind() == InputType::Month {
                    "yMMMM"
                } else {
                    "yMMMMEEEEd"
                };
                fields
                    .locale
                    .format(&fields.locale.pattern(skeleton), day.days() as f64 * DAY)
            }
            _ => String::new(),
        };
        let mut all = vec![("role", "button".to_owned()), ("aria-label", label)];
        all.extend(
            part.is_part("-internal-date-picker-chosen")
                .then(|| ("aria-pressed", "true".to_owned())),
        );
        Some(all)
    });
    all.flatten().unwrap_or_default()
}

fn fill<'a>(cx: &mut Cx<'a>, input: Input<'a>) {
    let Some(picker) = picker(input) else { return };
    with_fields(input, |it| {
        it.picker.actions.clear();
        it.picker.filled_for = input.text.text();
    });
    remove_children(cx, picker);
    if !is_open(input) {
        return;
    }
    if input.kind() != InputType::Time {
        let calendar = piece(cx, input, picker, "calendar", "");
        fill_calendar(cx, input, calendar);
        mark_cursor(cx, input);
    }
    let columns = with_fields(input, |fields| {
        let times = fields
            .all
            .iter()
            .filter(|it| it.unit.is_of_time() && it.unit != Unit::Millisecond);
        times
            .map(|it| {
                (
                    it.unit,
                    it.value,
                    (it.min..=it.max)
                        .map(|value| (value, it.label(value)))
                        .collect::<Vec<_>>(),
                )
            })
            .collect::<Vec<_>>()
    });
    for (unit, chosen, cells) in columns.into_iter().flatten() {
        let column = piece(cx, input, picker, "column", "");
        for (value, label) in cells {
            let is_chosen = Some(value) == chosen;
            let cell = button(
                cx,
                input,
                column,
                if is_chosen { "chosen" } else { "cell" },
                &label,
                Some(Action::Choose(unit, value)),
            );
            if is_chosen {
                layout::reveal_in_nearest_scroller(cx, cell);
            }
        }
    }
}

/// The part of a value that says which day, week or month it is.
fn value_of(kind: InputType, day: Date) -> Vec<u8> {
    let time = day.days() as f64 * DAY;
    match kind {
        InputType::Week => kind.write(time),
        InputType::Month => kind.write(month_at(time).unwrap_or(0.0)),
        _ => write_date(time).unwrap_or_default(),
    }
}

fn can_pick(input: Input<'_>, day: Date) -> bool {
    let (kind, limits) = (input.kind(), input.limits());
    let (as_day, slack) = if kind == InputType::DateTimeLocal {
        (InputType::Date, DAY - 1.0)
    } else {
        (kind, 0.0)
    };
    as_day.parse(&value_of(kind, day)).is_some_and(|number| {
        limits.min.is_none_or(|it| number + slack >= it) && limits.max.is_none_or(|it| number <= it)
    })
}

fn fill_calendar<'a>(cx: &mut Cx<'a>, input: Input<'a>, calendar: &'a Element) {
    let (kind, today, value) = (input.kind(), today(cx), input.value());
    let by_year = kind == InputType::Month;
    let texts = with_fields(input, |fields| {
        let (locale, first) = (&fields.locale, fields.picker.month.unwrap_or(today));
        let first_day = if kind == InputType::Week {
            0
        } else {
            locale.first_day_of_week()
        };
        let start = first.days() - (weekday(first.days()) - first_day).rem_euclid(7);
        let names = match by_year {
            true => month_names(locale, &locale.pattern("MMM")),
            false => (start..start + 7)
                .map(|it| {
                    locale
                        .format("EEE", it as f64 * DAY)
                        .chars()
                        .take(2)
                        .collect()
                })
                .collect(),
        };
        (
            first,
            start,
            locale.format(
                &locale.pattern(if by_year { "y" } else { "yMMMM" }),
                first.days() as f64 * DAY,
            ),
            names,
        )
    });
    let Some((first, start, title, names)) = texts else {
        return;
    };
    let head = piece(cx, input, calendar, "row", "");
    piece(cx, input, head, "title", &title);
    for (arrow, step) in [("↑", -1), ("↓", 1)] {
        let month = Date::first_of(
            first.year,
            first.month + step * if by_year { 12 } else { 1 },
        );
        button(
            cx,
            input,
            head,
            "step",
            arrow,
            (month.year > 0).then_some(Action::ShowMonth(month)),
        );
    }
    let pick = |day| can_pick(input, day).then_some(Action::PickDay(day));
    let grid = piece(
        cx,
        input,
        calendar,
        if by_year { "months" } else { "days" },
        "",
    );
    let cells: Vec<_> = if by_year {
        names
            .into_iter()
            .zip(1..)
            .map(|(name, month)| (name, Date::first_of(first.year, month)))
            .collect()
    } else {
        names
            .iter()
            .for_each(|it| _ = piece(cx, input, grid, "label", it));
        (start..start + 42)
            .map(Date::from_days)
            .map(|it| (it.day.to_string(), it))
            .collect()
    };
    for (text, day) in cells {
        let name = match () {
            () if value
                .latin1()
                .is_some_and(|it| it.starts_with(&value_of(kind, day))) =>
            {
                "chosen"
            }
            () if day
                == if by_year {
                    Date { day: 1, ..today }
                } else {
                    today
                } =>
            {
                "today"
            }
            () if !by_year && day.month != first.month => "outside",
            () => "cell",
        };
        button(cx, input, grid, name, &text, pick(day));
    }
    let foot = piece(cx, input, calendar, "row", "");
    button(cx, input, foot, "link", "Clear", Some(Action::Clear));
    let now = match kind {
        InputType::Month => "This month",
        InputType::Week => "This week",
        _ => "Today",
    };
    button(cx, input, foot, "link", now, pick(today));
}

/// What is empty is taken from the time that it is.
fn choose<'a>(cx: &mut Cx<'a>, input: Input<'a>, values: &[(Unit, u32)]) {
    let now = input
        .kind()
        .write((local_time(cx.global()) / 60_000.0).floor() * 60_000.0);
    with_fields(input, |fields| {
        let before: Vec<_> = fields.all.iter().map(|it| it.value).collect();
        fields.read(&now);
        for (field, before) in fields.all.iter_mut().zip(before) {
            field.value = values
                .iter()
                .find(|it| it.0 == field.unit)
                .map(|it| it.1)
                .or(before)
                .or(field.value);
        }
    });
    date_fields::write(cx, input);
    fill(cx, input);
}

fn pick<'a>(cx: &mut Cx<'a>, input: Input<'a>, day: Date) {
    if input.kind() == InputType::DateTimeLocal {
        return choose(
            cx,
            input,
            &[
                (Unit::Year, day.year as u32),
                (Unit::Month, day.month as u32),
                (Unit::Day, day.day as u32),
            ],
        );
    }
    date_fields::set(cx, input, from_ascii(&value_of(input.kind(), day)));
    fill(cx, input);
}

fn perform<'a>(cx: &mut Cx<'a>, input: Input<'a>, action: Action) {
    match action {
        Action::ShowMonth(month) => {
            with_fields(input, |it| it.picker.month = Some(month));
            fill(cx, input);
        }
        Action::Choose(unit, value) => choose(cx, input, &[(unit, value)]),
        Action::PickDay(day) => {
            set_open(cx, input, input.kind() == InputType::DateTimeLocal);
            with_fields(input, |it| it.picker.cursor = Some(day));
            pick(cx, input, day);
        }
        Action::Clear => {
            set_open(cx, input, false);
            date_fields::set(cx, input, DomString::default());
        }
    }
}

pub(super) fn mouse_down<'a>(
    cx: &mut Cx<'a>,
    input: Input<'a>,
    event: &'a MouseEvent,
    origin: &'a Node,
) {
    if event.get_button() != 0 {
        return;
    }
    let action = with_fields(input, |it| {
        origin.inclusive_ancestors().find_map(|at| {
            it.picker
                .actions
                .iter()
                .find(|it| it.0 == at.id())
                .map(|it| it.1)
        })
    });
    if let Some(action) = action.flatten() {
        perform(cx, input, action);
    } else if origin.is_part("-webkit-calendar-picker-indicator") {
        set_open(cx, input, !is_open(input));
    } else if !picker(input).is_some_and(|it| it.contains_flat(origin)) {
        set_open(cx, input, false);
        date_fields::activate_at(cx, input, event.get_client_x());
    }
}
