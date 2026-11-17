//! The fields of `<input type=date>` and its like.

use bun_core::strings;

use super::locale::{Locale, local_time};
use super::microsyntax::{DAY, Date, MAX_YEAR};
use super::select_events::is_typed;
use super::*;
use crate::api::ui::assistive::Semantics;
use crate::api::uievents::{KeyboardEvent, Modifiers};

const INCOMPLETE: &str = "?";

/// In the order of a value.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Unit {
    Year,
    Week,
    Month,
    Day,
    Hour,
    Minute,
    Second,
    Millisecond,
    AmPm,
}
use Unit::*;

impl Unit {
    fn part(self) -> String {
        let name = [
            "year",
            "week",
            "month",
            "day",
            "hour",
            "minute",
            "second",
            "millisecond",
            "ampm",
        ][self as usize];
        format!("-webkit-datetime-edit-{name}-field")
    }

    pub(super) fn is_of_time(self) -> bool {
        !matches!(self, Year | Week | Month | Day)
    }

    fn in_value_of(kind: InputType) -> &'static [Unit] {
        const ALL: [Unit; 7] = [Year, Month, Day, Hour, Minute, Second, Millisecond];
        match kind {
            InputType::Time => &ALL[3..],
            InputType::Week => &[Year, Week],
            InputType::Month => &ALL[..2],
            InputType::Date => &ALL[..3],
            _ => &ALL,
        }
    }
}

pub(super) struct Field {
    pub(super) unit: Unit,
    pub(super) min: u32,
    pub(super) max: u32,
    placeholder: &'static str,
    names: Vec<String>,
    pub(super) value: Option<u32>,
}

impl Field {
    pub(super) fn label(&self, value: u32) -> String {
        self.names
            .get((value - self.min) as usize)
            .cloned()
            .unwrap_or_else(|| format!("{value:0width$}", width = self.placeholder.len()))
    }

    fn step(&mut self, is_up: bool, step: u32, this_year: u32) {
        let (first, last) = (self.min, self.max - (self.max - self.min) % step);
        self.value = Some(match self.value {
            None if self.unit == Year => this_year,
            None => {
                if is_up {
                    first
                } else {
                    last
                }
            }
            Some(value) if is_up => Some((value / step + 1) * step)
                .filter(|it| *it <= self.max)
                .unwrap_or(first),
            Some(value) => value
                .div_ceil(step)
                .checked_sub(1)
                .map(|it| it * step)
                .filter(|it| *it >= self.min)
                .unwrap_or(last),
        });
    }
}

pub(super) struct Fields {
    kind: InputType,
    pub(super) locale: Locale,
    pub(super) all: Vec<Field>,
    /// After the fields comes the button for the pop-up.
    active: usize,
    typed: String,
    /// What the fields stand for.
    shown: Option<DomString>,
    pub(super) picker: date_picker::Picker,
}

impl Fields {
    pub(super) fn value(&self, unit: Unit) -> Option<u32> {
        self.all.iter().find(|it| it.unit == unit)?.value
    }

    pub(super) fn read(&mut self, text: &[u8]) {
        let (whole, fraction) = strings::split_once_char(text, b'.').unwrap_or((text, b""));
        let parse = |it: &[u8]| bun_core::fmt::parse_ascii::<u32>(it).unwrap_or(0);
        let numbers: Vec<_> = strings::tokenize_any(whole, b"-:TW ")
            .map(parse)
            .chain([parse(&[fraction, b"000"].concat()[..3])])
            .collect();
        let units = Unit::in_value_of(self.kind);
        for field in &mut self.all {
            let unit = if field.unit == AmPm { Hour } else { field.unit };
            let index = if unit == Millisecond {
                Some(numbers.len() - 1)
            } else {
                units
                    .iter()
                    .position(|it| *it == unit)
                    .filter(|it| it + 1 < numbers.len())
            };
            field.value = (!text.is_empty())
                .then(|| index.map_or(0, |it| numbers[it]))
                .map(|value| match field.unit {
                    AmPm => value / 12,
                    Hour => Some(value % (field.max - field.min + 1))
                        .filter(|it| *it != 0)
                        .unwrap_or(field.min * field.max),
                    _ => value.clamp(field.min, field.max),
                });
        }
    }

    fn write(&self) -> Option<String> {
        let mut text = String::new();
        for field in Unit::in_value_of(self.kind)
            .iter()
            .filter_map(|unit| self.all.iter().find(|it| it.unit == *unit))
        {
            let value = field.value?;
            text += &match field.unit {
                Year => format!("{value:04}"),
                Week => format!("-W{value:02}"),
                Month | Day => format!("-{value:02}"),
                Hour => {
                    let hour =
                        value % (field.max - field.min + 1) + 12 * self.value(AmPm).unwrap_or(0);
                    format!(
                        "{}{hour:02}",
                        if self.kind == InputType::Time {
                            ""
                        } else {
                            "T"
                        }
                    )
                }
                Millisecond => format!(".{value:03}"),
                _ => format!(":{value:02}"),
            };
        }
        self.all.iter().all(|it| it.value.is_some()).then_some(text)
    }

    fn is_of_time(&self, index: usize) -> bool {
        self.all.get(index).is_some_and(|it| it.unit.is_of_time())
    }

    pub(super) fn is_in_calendar(&self) -> bool {
        self.kind != InputType::Time && !self.is_of_time(self.active)
    }

    /// Where Tab leads in the pop-up.
    fn next_column(&self, is_back: bool) -> Option<usize> {
        let first = |is_of_time| {
            self.all
                .iter()
                .position(|it| it.unit.is_of_time() == is_of_time)
        };
        match (self.is_of_time(self.active), is_back) {
            (false, true) => None,
            (false, false) => first(true),
            (true, true) => self
                .active
                .checked_sub(1)
                .filter(|it| self.is_of_time(*it))
                .or_else(|| first(false)),
            (true, false) => Some(self.active + 1).filter(|it| self.is_of_time(*it)),
        }
    }

    fn activate(&mut self, index: Option<usize>, has_button: bool) -> bool {
        let Some(index) = index.filter(|it| *it < self.all.len() + usize::from(has_button)) else {
            return false;
        };
        self.active = index;
        self.typed.clear();
        true
    }

    fn type_key(&mut self, key: &str) -> bool {
        let (Some(field), typed) = (self.all.get_mut(self.active), &mut self.typed) else {
            return false;
        };
        let is_digit = matches!(key.as_bytes(), [b'0'..=b'9']);
        if !field.names.is_empty() && !(is_digit && field.unit == Month) {
            let find = |prefix: &str| {
                field
                    .names
                    .iter()
                    .position(|it| it.to_lowercase().starts_with(prefix))
            };
            *typed += &key.to_lowercase();
            if find(typed).is_none() {
                *typed = key.to_lowercase();
            }
            let Some(index) = find(typed) else {
                return false;
            };
            field.value = Some(field.min + index as u32);
            return true;
        }
        if !is_digit {
            return false;
        }
        *typed += key;
        if typed.parse().ok().is_none_or(|it: u32| it > field.max) {
            key.clone_into(typed);
        }
        let value = typed.parse().unwrap_or(0);
        field.value = (value >= field.min).then_some(value);
        if value * 10 > field.max || typed.len() > field.max.ilog10() as usize {
            typed.clear();
            self.activate(Some(self.active + 1), false);
        }
        true
    }
}

pub(super) fn with_fields<R>(input: Input<'_>, act: impl FnOnce(&mut Fields) -> R) -> Option<R> {
    input.state.dates.borrow_mut().as_deref_mut().map(act)
}

enum Piece {
    Text(String),
    /// A letter of a pattern.
    Field(char),
}

/// https://unicode.org/reports/tr35/tr35-dates.html#Date_Format_Patterns
fn pieces(pattern: &str) -> Vec<Piece> {
    let (mut all, mut is_quoted, mut last) = (Vec::new(), false, '\0');
    for character in pattern.chars() {
        match (character, all.last_mut()) {
            ('\'', _) if last != '\'' => is_quoted = !is_quoted,
            (letter, Some(Piece::Field(same))) if letter == *same && !is_quoted => {}
            (letter, _) if letter.is_ascii_alphabetic() && !is_quoted => {
                all.push(Piece::Field(letter))
            }
            (other, piece) => {
                is_quoted ^= other == '\'';
                let other = if other == '\u{202f}' { ' ' } else { other };
                if let Some(Piece::Text(text)) = piece {
                    text.push(other)
                } else {
                    all.push(Piece::Text(other.into()))
                }
            }
        }
        last = if last == '\'' { '\0' } else { character };
    }
    all
}

fn pattern(input: Input<'_>, locale: &Locale) -> String {
    let step = input.limits().step.unwrap_or(0.0);
    let values =
        [Some(input.text.text()), input.element.attr(atom!("min"))].map(|it| input.parse(&it?));
    let needs = |unit: f64| step % unit > 0.0 || values.iter().flatten().any(|it| it % unit != 0.0);
    let time = if needs(1000.0) {
        "jjmmssSSS"
    } else if needs(60_000.0) {
        "jjmmss"
    } else {
        "jjmm"
    };
    match input.kind() {
        InputType::Week => "'Week 'w, y".into(),
        InputType::Date => locale.pattern("yMMdd"),
        InputType::Month => locale.pattern("yMMMM"),
        InputType::Time => locale.pattern(time),
        _ => locale.pattern(&format!("yMMdd{time}")),
    }
}

pub(super) fn month_names(locale: &Locale, pattern: &str) -> Vec<String> {
    (1..=12)
        .map(|month| locale.format(pattern, Date::first_of(2000, month).days() as f64 * DAY))
        .collect()
}

pub(super) fn build<'a>(cx: &mut Cx<'a>, input: Input<'a>, root: &'a Node) {
    let (element, kind) = (input.element, input.kind());
    let locale = Locale::new(&host::locale(element.doc()));
    let container = div(cx, element, root, "-internal-datetime-container");
    let edit = div(cx, element, container, "-webkit-datetime-edit");
    let wrapper = div(cx, element, edit, "-webkit-datetime-edit-fields-wrapper");
    div(cx, element, container, "-webkit-calendar-picker-indicator");
    div(cx, element, root, "-internal-date-picker");
    element.set_edge(&cx.heap, Edge::Look, wrapper.value());
    let (is_numeric, mut all) = (
        matches!(kind, InputType::Date | InputType::DateTimeLocal),
        Vec::new(),
    );
    for piece in pieces(&pattern(input, &locale)) {
        let letter = match piece {
            Piece::Field(letter) => letter,
            Piece::Text(text) => {
                let part = div(cx, element, wrapper, "-webkit-datetime-edit-text");
                text_in(cx, part, &text);
                continue;
            }
        };
        let (unit, min, max, placeholder, names) = match letter {
            'y' => (
                Year,
                1,
                MAX_YEAR as u32,
                if is_numeric { "yyyy" } else { "----" },
                Vec::new(),
            ),
            'M' | 'L' if is_numeric => (Month, 1, 12, "mm", Vec::new()),
            'M' | 'L' => (
                Month,
                1,
                12,
                "---------",
                month_names(&locale, &locale.pattern("MMMM")),
            ),
            'd' => (Day, 1, 31, "dd", Vec::new()),
            'w' => (Week, 1, 53, "--", Vec::new()),
            'K' => (Hour, 0, 11, "--", Vec::new()),
            'h' => (Hour, 1, 12, "--", Vec::new()),
            'H' => (Hour, 0, 23, "--", Vec::new()),
            'k' => (Hour, 1, 24, "--", Vec::new()),
            'm' => (Minute, 0, 59, "--", Vec::new()),
            's' => (Second, 0, 59, "--", Vec::new()),
            'S' => (Millisecond, 0, 999, "---", Vec::new()),
            'a' | 'b' | 'B' => (
                AmPm,
                0,
                1,
                "--",
                vec![locale.format("a", 0.0), locale.format("a", DAY / 2.0)],
            ),
            _ => continue,
        };
        let part = div(cx, element, wrapper, &unit.part());
        text_in(cx, part, "");
        all.push(Field {
            unit,
            min,
            max,
            placeholder,
            names,
            value: None,
        });
    }
    input.state.dates.replace(Some(Box::new(Fields {
        kind,
        locale,
        all,
        active: 0,
        typed: String::new(),
        shown: None,
        picker: Default::default(),
    })));
}

fn field_elements(input: Input<'_>) -> impl Iterator<Item = &Element> {
    input
        .look()
        .into_iter()
        .flat_map(Node::element_children)
        .filter(|it| !it.is_part("-webkit-datetime-edit-text"))
}

fn stops(input: Input<'_>) -> impl Iterator<Item = &Element> {
    let button = input
        .look()
        .and_then(|it| it.parent()?.next_sibling()?.as_element());
    field_elements(input).chain(button)
}

/// Where the focus is.
pub(crate) fn active_part(input: Input<'_>) -> Option<&Element> {
    date_picker::active_cell(input)
        .or_else(|| stops(input).nth(with_fields(input, |it| it.active)?))
}

pub(crate) fn enter_by_tab(element: &Element, is_backward: bool) {
    if let Some(input) = Input::of(element) {
        with_fields(input, |it| {
            it.activate(
                Some(if is_backward {
                    it.all.len() - usize::from(!input.text.is_mutable())
                } else {
                    0
                }),
                true,
            )
        });
    }
}

/// False if the focus cannot be in `part`.
pub(crate) fn enter<'a>(cx: &mut Cx<'a>, input: Input<'a>, part: &'a Element) -> bool {
    let index = stops(input).position(|it| it == part);
    activate(cx, input, true, |_| index)
}

pub(crate) fn semantics(input: Input<'_>, part: &Element) -> Semantics {
    if part.is_part("-webkit-calendar-picker-indicator") {
        let kind = match input.kind() {
            InputType::Date => "date",
            InputType::Month => "month",
            InputType::Time => "time",
            InputType::Week => "week",
            _ => "local date and time",
        };
        return vec![
            ("role", "button".to_owned()),
            ("aria-haspopup", "menu".to_owned()),
            ("aria-label", format!("Show {kind} picker")),
        ];
    }
    let Some(index) = field_elements(input).position(|it| it == part) else {
        return date_picker::semantics(input, part);
    };
    let all = with_fields(input, |fields| {
        let it = &fields.all[index];
        let label = [
            "Year",
            "Week",
            "Month",
            "Day",
            "Hours",
            "Minutes",
            "Seconds",
            "Milliseconds",
            "AM/PM",
        ][it.unit as usize];
        let number = |value: u32| (value + u32::from(it.unit == AmPm)).to_string();
        let mut all = vec![
            ("role", "spinbutton".to_owned()),
            ("aria-label", label.to_owned()),
            ("aria-placeholder", it.placeholder.to_owned()),
            ("aria-valuemin", number(it.min)),
            ("aria-valuemax", number(it.max)),
        ];
        all.extend(it.value.into_iter().flat_map(|value| {
            [
                ("aria-valuenow", number(value)),
                ("aria-valuetext", it.label(value)),
            ]
        }));
        all.extend(is_disabled(input.element).then(|| ("aria-disabled", "true".to_owned())));
        all
    });
    all.unwrap_or_default()
}

pub(super) fn render<'a>(cx: &mut Cx<'a>, input: Input<'a>) {
    let text = input.text.text();
    let shown = with_fields(input, |fields| {
        if fields.shown.as_ref() != Some(&text) {
            fields.read(text.ascii().unwrap_or_default().as_bytes());
            fields.shown = Some(text);
        }
        (
            fields
                .all
                .iter()
                .map(|it| {
                    it.value
                        .map_or_else(|| it.placeholder.to_owned(), |value| it.label(value))
                })
                .collect::<Vec<_>>(),
            fields.active,
        )
    });
    let Some((labels, active)) = shown else {
        return;
    };
    field_elements(input)
        .zip(labels)
        .for_each(|(element, label)| set_text(cx, element.first_child(), &label.as_str().into()));
    for (index, element) in stops(input).enumerate() {
        element.set_state(
            cx,
            State::FOCUS,
            index == active && focus::has_focus(input.element),
        );
    }
}

pub(super) fn set<'a>(cx: &mut Cx<'a>, input: Input<'a>, text: DomString) {
    let before = input.value();
    input.text.set_from_script(cx, text);
    input.render(cx);
    if input.value() != before {
        user_changed(cx, input.element);
    }
}

/// From the fields to the value.
pub(super) fn write<'a>(cx: &mut Cx<'a>, input: Input<'a>) {
    let text = with_fields(input, |fields| {
        let complete = fields
            .write()
            .map(|it| input.sanitize(&it.as_str().into()))
            .filter(|it| !it.is_empty());
        let text = complete.unwrap_or_else(|| {
            if fields.all.iter().any(|it| it.value.is_some()) {
                INCOMPLETE
            } else {
                ""
            }
            .into()
        });
        fields.shown.insert(text).clone()
    });
    if let Some(it) = text {
        set(cx, input, it);
    }
}

fn activate<'a>(
    cx: &mut Cx<'a>,
    input: Input<'a>,
    has_button: bool,
    index: impl FnOnce(&Fields) -> Option<usize>,
) -> bool {
    let has_moved = with_fields(input, |it| it.activate(index(it), has_button)) == Some(true);
    date_picker::mark_cursor(cx, input);
    render(cx, input);
    has_moved
}

pub(super) fn leave_button<'a>(cx: &mut Cx<'a>, input: Input<'a>) {
    activate(cx, input, false, |it| {
        (it.active == it.all.len()).then_some(0)
    });
}

pub(super) fn activate_at<'a>(cx: &mut Cx<'a>, input: Input<'a>, x: f64) {
    let before = field_elements(input)
        .filter(|it| f64::from(layout::bounding_rect(cx, it).x) <= x)
        .count();
    activate(cx, input, false, |_| Some(before.saturating_sub(1)));
}

pub(super) fn key_down<'a>(cx: &mut Cx<'a>, input: Input<'a>, event: &'a KeyboardEvent) -> bool {
    let (key, is_open) = (event.key(), date_picker::is_open(input));
    let by = |is_back: bool| {
        move |it: &Fields| {
            if is_back {
                it.active.checked_sub(1)
            } else {
                Some(it.active + 1)
            }
        }
    };
    let is_on_button = with_fields(input, |it| it.active == it.all.len()) == Some(true);
    match key {
        atom!("Escape") if is_open => date_picker::cancel(cx, input),
        atom!("Enter") if is_open => date_picker::accept(cx, input),
        atom!("Tab")
            if is_open
                && activate(cx, input, false, |it| it.next_column(event.get_shift_key())) => {}
        atom!("Tab") => {
            date_picker::set_open(cx, input, false);
            return activate(
                cx,
                input,
                input.text.is_mutable(),
                by(event.get_shift_key()),
            );
        }
        _ if is_open && date_picker::move_cursor(cx, input, key) => {}
        atom!("ArrowLeft") | atom!("ArrowRight") => {
            _ = activate(cx, input, false, by(key == atom!("ArrowLeft")))
        }
        _ if !input.text.is_mutable()
            || event
                .modifiers()
                .intersects(Modifiers::CONTROL | Modifiers::META) =>
        {
            return false;
        }
        atom!("F4") | atom!(" ") => date_picker::set_open(cx, input, !is_open),
        atom!("Enter") if is_on_button => date_picker::set_open(cx, input, true),
        atom!("ArrowDown") if event.get_alt_key() => date_picker::set_open(cx, input, !is_open),
        atom!("ArrowUp") | atom!("ArrowDown") | atom!("Backspace") | atom!("Delete")
            if !is_on_button =>
        {
            let (step, today) = (
                input.limits().step.unwrap_or(1.0),
                Date::from_days((local_time(cx.global()) / DAY) as i64),
            );
            with_fields(input, |fields| {
                fields.typed.clear();
                let field = &mut fields.all[fields.active];
                let unit = match field.unit {
                    Minute => 60_000.0,
                    Second => 1000.0,
                    Millisecond => 1.0,
                    _ => f64::NAN,
                };
                let step = if f64::from(field.max + 1) % (step / unit) == 0.0 {
                    (step / unit).max(1.0) as u32
                } else {
                    1
                };
                if arrow_step(key).is_some() {
                    field.step(key == atom!("ArrowUp"), step, today.year as u32)
                } else {
                    field.value = None
                }
            });
            write(cx, input);
        }
        _ if is_typed(event)
            && with_fields(input, |it| it.type_key(&event.get_key().as_utf8())) == Some(true) =>
        {
            write(cx, input)
        }
        _ => return false,
    }
    date_picker::follow_value(cx, input);
    true
}
