//! https://html.spec.whatwg.org/#the-input-element

use super::input_type::ValueMode;
use super::microsyntax::{is_valid_email, month_at, start_of_month, write_float, write_time};
use super::steps::Steps as Limits;
use super::text::TextState;
use super::validity::Validity;
use super::*;
use crate::api::transfer::FileList;
use crate::api::uievents::MouseEvent;
use crate::generated_bindgen::forms::HTMLInputElement;
use InputType::*;

#[derive(Default)]
pub(super) struct InputState {
    pub(super) text: TextState,
    kind: Cell<InputType>,
    is_checked: Cell<bool>,
    pub(super) is_checked_dirty: Cell<bool>,
    is_indeterminate: Cell<bool>,
    was_image: Cell<bool>,
    pub(super) has_new_options: Cell<bool>,
    /// https://html.spec.whatwg.org/#concept-input-type-image-coordinate
    coordinate: Cell<[i32; 2]>,
    pub(super) dates: RefCell<Option<Box<date_fields::Fields>>>,
    pub(super) color_picker: RefCell<Option<Box<color_picker::Picker>>>,
}

#[derive(Clone, Copy)]
pub(crate) struct Input<'a> {
    pub(crate) element: &'a Element,
    pub(super) state: &'a InputState,
    pub(super) text: TextControl<'a>,
}

fn trimmed(text: &DomString) -> DomString {
    let start = text
        .units()
        .take_while(|it| is_ascii_whitespace(*it))
        .count() as u32;
    let end = text.len()
        - text
            .units()
            .rev()
            .take_while(|it| is_ascii_whitespace(*it))
            .count() as u32;
    text.substring(start, end.saturating_sub(start))
}

fn split_on_commas(text: &DomString) -> impl Iterator<Item = DomString> {
    let commas = text
        .units()
        .enumerate()
        .filter(|it| it.1 == u16::from(b','))
        .map(|it| it.0 as u32);
    commas.chain([text.len()]).scan(0, |start, end| {
        Some(text.substring(*start, end - core::mem::replace(start, end + 1)))
    })
}

fn for_yarr(text: &DomString) -> bun_yarr::Text<'_> {
    text.latin1().map_or_else(
        || bun_yarr::Text::Utf16(text.utf16().unwrap_or_default()),
        bun_yarr::Text::Latin1,
    )
}

/// https://html.spec.whatwg.org/#compiled-pattern-regular-expression
fn compile(pattern: &DomString) -> Option<bun_yarr::Compiled> {
    let compile = |it: &DomString| {
        bun_yarr::Compiled::within(for_yarr(it), bun_yarr::flags::UNICODE_SETS, 1 << 17).ok()
    };
    compile(pattern)
        .and_then(|_| compile(&DomString::concat(&[&"^(?:".into(), pattern, &")$".into()])))
}

impl<'a> Input<'a> {
    pub(super) fn new(element: &'a Element) -> Input<'a> {
        let state = element.extra::<InputState>();
        Input {
            element,
            state,
            text: TextControl::of_input(element, &state.text),
        }
    }

    pub(crate) fn of(element: &'a Element) -> Option<Input<'a>> {
        element.is_html(atom!("input")).then(|| Input::new(element))
    }

    pub(crate) fn kind(self) -> InputType {
        self.state.kind.get()
    }

    pub(crate) fn is_checked(self) -> bool {
        self.state.is_checked.get()
    }

    pub(crate) fn is_indeterminate(self) -> bool {
        self.state.is_indeterminate.get()
    }

    pub(super) fn coordinate(self) -> [i32; 2] {
        self.state.coordinate.get()
    }

    fn has(self, name: Known) -> bool {
        self.element.has_attr(name)
    }

    fn default_value(self) -> DomString {
        self.element.attr(atom!("value")).unwrap_or_default()
    }

    fn is_value_mode(self) -> bool {
        self.kind().value_mode() == ValueMode::Value
    }

    pub(crate) fn limits(self) -> Limits {
        let [min, max, step, value] = [atom!("min"), atom!("max"), atom!("step"), atom!("value")]
            .map(|it| self.element.attr(it).unwrap_or_default());
        let [min, max, step, value] =
            [&min, &max, &step, &value].map(|it| it.ascii().unwrap_or_default().as_bytes());
        self.kind().steps(min, max, step, value)
    }

    pub(super) fn parse(self, text: &DomString) -> Option<f64> {
        self.kind().parse(text.ascii()?.as_bytes())
    }

    pub(crate) fn number(self) -> Option<f64> {
        self.parse(&self.value())
    }

    /// https://html.spec.whatwg.org/#value-sanitization-algorithm
    pub(super) fn sanitize(self, text: &DomString) -> DomString {
        match self.kind() {
            Range => from_ascii(&write_float(self.limits().clamp(self.parse(text)))),
            DateTimeLocal => self
                .parse(text)
                .map(|it| from_ascii(&DateTimeLocal.write(it)))
                .unwrap_or_default(),
            kind if kind.is_numeric() => self.parse(text).map(|_| text.clone()).unwrap_or_default(),
            Color => format!(
                "#{:06x}",
                crate::bindings::parse_rgba(text.to_utf8().as_bytes(), 0xff).unwrap_or(0) >> 8
            )
            .as_str()
            .into(),
            Email if self.has(atom!("multiple")) => {
                let mut out = StringBuilder::default();
                for (index, address) in split_on_commas(&without_newlines(text)).enumerate() {
                    out.push_str(if index == 0 { "" } else { "," });
                    out.push(&trimmed(&address));
                }
                out.finish()
            }
            Email | Url => trimmed(&without_newlines(text)),
            _ => without_newlines(text),
        }
    }

    fn files(self) -> Option<&'a FileList> {
        FileList::from_value(self.element.edge(Edge::Files)?)
    }

    pub(super) fn selected_files(self) -> impl Iterator<Item = JSValue> {
        self.files().into_iter().flat_map(FileList::files)
    }

    pub(crate) fn names_of_files(self) -> impl Iterator<Item = DomString> {
        self.files().into_iter().flat_map(FileList::names)
    }

    pub(crate) fn value(self) -> DomString {
        match self.kind().value_mode() {
            ValueMode::Value
                if self.kind() == Number && self.text.state.last_edit_was_by_user.get() =>
            {
                let text = self.text.text();
                let start = u32::from(text.units().next() == Some(b'+'.into()));
                self.sanitize(&text.substring(
                    start,
                    text.len() - start - u32::from(text.units().next_back() == Some(b'.'.into())),
                ))
            }
            ValueMode::Value => self.sanitize(&self.text.text()),
            ValueMode::Default => self.default_value(),
            ValueMode::DefaultOn => self
                .element
                .attr(atom!("value"))
                .unwrap_or_else(|| "on".into()),
            ValueMode::Filename => match self.files().filter(|it| it.get_length() > 0) {
                Some(files) => DomString::concat(&[
                    &"C:\\fakepath\\".into(),
                    &files.names().next().unwrap_or_default(),
                ]),
                None => DomString::default(),
            },
        }
    }

    /// In the mode value.
    pub(crate) fn set_value(self, cx: &mut Cx<'a>, value: &DomString) {
        let value = self.sanitize(value);
        if self.kind() != Number || value.is_empty() || value != self.value() {
            self.text.set_from_script(cx, value);
        } else {
            self.text.state.is_dirty.set(true);
        }
    }

    pub(super) fn set_number(self, cx: &mut Cx<'a>, value: f64) {
        let text = if self.kind() == Time {
            write_time(value, self.limits().step.unwrap_or(0.0))
        } else {
            self.kind().write(value)
        };
        self.set_value(cx, &from_ascii(&text));
    }

    fn set_files(self, cx: &mut Cx<'a>, files: Option<&'a FileList>) {
        match files {
            Some(files) => self.element.set_edge(&cx.heap, Edge::Files, files.value()),
            None => self.element.clear_edge(&cx.heap, Edge::Files),
        }
        dirty(cx, self.element);
    }

    /// https://html.spec.whatwg.org/#radio-button-group
    pub(super) fn group(self) -> impl Iterator<Item = Input<'a>> {
        let (name, form) = (
            self.element.attr(atom!("name")).filter(|it| !it.is_empty()),
            form_owner(self.element),
        );
        let named = match (&name, self.element.scope()) {
            (None, _) => smallvec::smallvec![self.element],
            (Some(name), Some(scope)) => scope.descendants_named(&Atom::from_string(name)),
            (Some(_), None) => self
                .element
                .root()
                .objects()
                .filter_map(Node::as_element)
                .filter(|it| it.attr(atom!("name")) == name)
                .collect(),
        };
        named.into_iter().filter_map(Input::of).filter(move |it| {
            it.element == self.element || it.kind() == Radio && form_owner(it.element) == form
        })
    }

    fn facts_of_group(self) -> GroupFacts {
        let key_of = |it: Input<'_>| {
            Some((
                form_owner(it.element).map(|it| it.to_js()),
                it.element.attr(atom!("name")).filter(|it| !it.is_empty())?,
            ))
        };
        let (mut known, root) = (GROUPS.borrow_mut(), self.element.root());
        let (Some(known), Some(key)) = (known.as_deref_mut(), key_of(self)) else {
            return self.group().fold(Default::default(), GroupFacts::with);
        };
        if known.0 != root.to_js() {
            *known = (root.to_js(), Default::default());
            for it in root
                .objects()
                .filter_map(Node::as_element)
                .filter_map(Input::of)
                .filter(|it| it.kind() == Radio)
            {
                if let Some(key) = key_of(it) {
                    let facts = known.1.entry(key).or_default();
                    *facts = facts.with(it);
                }
            }
        }
        known.1.get(&key).copied().unwrap_or_default()
    }

    /// If it is near. There is no more than one.
    fn other_checked_in_group(self) -> Option<Input<'a>> {
        let (name, form, root) = (
            self.element
                .attr(atom!("name"))
                .filter(|it| !it.is_empty())?,
            form_owner(self.element),
            self.element.root(),
        );
        let before = core::iter::successors(self.element.preceding(Some(root)), |it| {
            it.preceding(Some(root))
        });
        let after = core::iter::successors(self.element.following(Some(root)), |it| {
            it.following(Some(root))
        });
        let mut inputs = before
            .take(16)
            .chain(after.take(16))
            .filter_map(Node::as_element)
            .filter_map(Input::of);
        inputs.find(|it| {
            it.is_checked()
                && it.kind() == Radio
                && it.element.attr(atom!("name")).as_ref() == Some(&name)
                && form_owner(it.element) == form
        })
    }

    pub(super) fn set_checked(self, cx: &mut Cx<'a>, is_checked: bool) {
        let was_checked = self.state.is_checked.replace(is_checked);
        if let Some(other) =
            (is_checked && self.kind() == Radio && !may_have_remote_owners(self.element))
                .then(|| self.other_checked_in_group())
                .flatten()
        {
            other.state.is_checked.set(false);
            dirty(cx, other.element);
            dirty(cx, self.element);
        } else if self.kind() == Radio {
            for other in self.group() {
                other
                    .state
                    .is_checked
                    .update(|it| it && (!is_checked || other.element == self.element));
                dirty(cx, other.element);
            }
        } else if was_checked != is_checked {
            dirty(cx, self.element);
        }
    }

    fn uncheck_others(self, cx: &mut Cx<'a>) {
        if self.kind() == Radio && self.is_checked() {
            self.set_checked(cx, true);
        }
    }

    /// Whether the value has changed.
    pub(crate) fn step_by(self, cx: &mut Cx<'a>, count: i32) -> bool {
        let before = self.value();
        let Some(value) = self.limits().step_by(self.parse(&before), count) else {
            return false;
        };
        self.set_number(cx, value);
        self.value() != before
    }

    fn range_errors(limits: &Limits, number: Option<f64>) -> Validity {
        let (is_under, is_over) = number.map_or((false, false), |it| limits.out_of_range(it));
        let mut errors = Validity::empty();
        errors.set(Validity::RANGE_UNDERFLOW, is_under);
        errors.set(Validity::RANGE_OVERFLOW, is_over);
        errors
    }

    pub(super) fn errors(self) -> Validity {
        let (kind, mut errors) = (self.kind(), Validity::empty());
        let is_required = |it: Input<'_>| it.has(atom!("required"));
        if !kind.is_typed() && kind != Range {
            errors.set(
                Validity::VALUE_MISSING,
                match kind {
                    Radio => {
                        self.element.with_attr(atom!("name"), str::is_empty) == Some(false)
                            && !self.is_checked()
                            && self.facts_of_group()
                                == GroupFacts {
                                    is_required: true,
                                    is_checked: false,
                                }
                    }
                    Checkbox => is_required(self) && !self.is_checked(),
                    File => is_required(self) && self.selected_files().next().is_none(),
                    _ => false,
                },
            );
            return errors;
        }
        if matches!(kind, Text | Search | Tel | Password)
            && !self.element.has_any_attr(&[
                atom!("required"),
                atom!("pattern"),
                atom!("maxlength"),
                atom!("minlength"),
            ])
        {
            return errors;
        }
        let value = self.value();
        if value.is_empty() {
            errors.set(
                Validity::VALUE_MISSING,
                is_required(self) && self.text.is_mutable(),
            );
            errors.set(
                Validity::BAD_INPUT,
                kind.is_numeric() && self.text.len() > 0,
            );
        } else if kind.is_numeric() {
            let (limits, number) = (self.limits(), self.parse(&value));
            errors |= Input::range_errors(&limits, number);
            errors.set(
                Validity::STEP_MISMATCH,
                number.is_some_and(|it| limits.mismatches(it)),
            );
        } else {
            let is_list = kind == Email && self.has(atom!("multiple"));
            let all = |test: &dyn Fn(&DomString) -> bool| {
                if is_list {
                    split_on_commas(&value).all(|it| test(&it))
                } else {
                    test(&value)
                }
            };
            errors.set(
                Validity::TYPE_MISMATCH,
                match kind {
                    Email => !all(&|it| it.ascii().is_some_and(|it| is_valid_email(it.as_bytes()))),
                    Url => bun_url::whatwg::Parsed::from_utf8(value.to_utf8().as_bytes()).is_none(),
                    _ => false,
                },
            );
            if let Some(pattern) = self
                .element
                .attr(atom!("pattern"))
                .as_ref()
                .and_then(compile)
            {
                let steps = core::cell::Cell::new((1 << 24) + 64 * value.len() as usize);
                let matches = |it: &DomString| {
                    let mut left = steps.get();
                    let is_found = pattern.exec_within(
                        for_yarr(it),
                        0,
                        &mut vec![0; pattern.offsets_len()],
                        Some(&mut left),
                    );
                    steps.set(left);
                    is_found
                };
                errors.set(Validity::PATTERN_MISMATCH, !all(&matches));
            }
            errors |= self.text.length_errors(value.len());
        }
        errors
    }

    pub(super) fn reset(self, cx: &mut Cx<'a>) {
        if self.files().is_some() {
            self.set_files(cx, None);
        }
        if self.text.state.control.was_edited.take()
            || self.text.state.last_edit_was_by_user.get()
            || self.kind().has_date_fields()
        {
            dirty(cx, self.element);
        }
        self.set_checked(cx, self.has(atom!("checked")));
        if self.is_value_mode() {
            self.text
                .set_default(cx, self.sanitize(&self.default_value()));
        }
        self.text.state.is_dirty.set(false);
        self.state.is_checked_dirty.set(false);
    }

    /// The text of a button or of a file picker, the swatch of a color, or what is before the thumb of a range.
    pub(super) fn look(self) -> Option<&'a Node> {
        self.element.edge_node(Edge::Look)
    }

    fn build(self, cx: &mut Cx<'a>, root: &'a Node) {
        let element = self.element;
        let look: Option<&Node> = match self.kind() {
            kind if kind.has_date_fields() => {
                date_fields::build(cx, self, root);
                None
            }
            kind if kind.has_editor() => {
                let container = div(cx, element, root, "-webkit-textfield-decoration-container");
                let inner = div(cx, element, container, "-internal-editor-container");
                self.text.build_editor(cx, inner);
                match kind {
                    Search => _ = div(cx, element, container, "-webkit-search-cancel-button"),
                    Number => _ = div(cx, element, container, "-webkit-inner-spin-button"),
                    _ => {}
                }
                if self.has(atom!("list")) && kind != Password {
                    div(cx, element, container, suggestions::INDICATOR);
                }
                None
            }
            Range => {
                let container = div(cx, element, root, "-internal-slider-container");
                let track = div(cx, element, container, "-webkit-slider-runnable-track");
                let parts = [
                    "-internal-slider-before",
                    "-webkit-slider-thumb",
                    "-internal-slider-after",
                ];
                Some(parts.map(|it| div(cx, element, track, it))[0])
            }
            Color => {
                let wrapper = div(cx, element, root, "-webkit-color-swatch-wrapper");
                Some(div(cx, element, wrapper, "-webkit-color-swatch"))
            }
            File => {
                let button = part(cx, element, root, "file-selector-button", atom!("span"));
                text_in(cx, button, "Choose File");
                let name = part(cx, element, root, "-internal-file-name", atom!("span"));
                Some(text_in(cx, name, ""))
            }
            Checkbox | Radio => None,
            Image => {
                let parent = crate::api::images::add_alt_text(cx, element, root);
                Some(text_in(cx, parent, ""))
            }
            _ => Some(text_in(cx, root, "")),
        };
        if let Some(look) = look {
            element.set_edge(&cx.heap, Edge::Look, look.value());
        }
        match self.kind() {
            Radio => dirty(cx, element),
            _ => self.render(cx),
        }
    }

    fn rebuild(self, cx: &mut Cx<'a>) {
        let Some(root) = self.element.shadow_root() else {
            return;
        };
        self.close_picker(cx);
        self.element.clear_edge(&cx.heap, Edge::Editor);
        self.element.clear_edge(&cx.heap, Edge::Look);
        self.state.dates.take();
        remove_children(cx, root);
        self.build(cx, root);
    }

    pub(super) fn render(self, cx: &mut Cx<'a>) {
        let (element, kind) = (self.element, self.kind());
        element.set_state(cx, State::CHECKED, kind.is_checkable() && self.is_checked());
        element.set_state(
            cx,
            State::INDETERMINATE,
            match kind {
                Radio => !self.is_checked() && !self.facts_of_group().is_checked,
                Checkbox => self.is_indeterminate(),
                _ => false,
            },
        );
        if kind.is_checkable() {
            element.set_state(cx, State::DEFAULT, self.has(atom!("checked")));
        } else {
            button::update_default(cx, element);
        }
        if kind.is_numeric() {
            let limits = self.limits();
            let is_limited =
                (limits.min.is_some() || limits.max.is_some()) && validity::will_validate(element);
            let is_out = is_limited && !Input::range_errors(&limits, self.number()).is_empty();
            element.set_state(cx, State::IN_RANGE, is_limited && !is_out);
            element.set_state(cx, State::OUT_OF_RANGE, is_out);
        }
        self.text.render(cx);
        if self.state.has_new_options.take() {
            suggestions::user_typed(cx, element);
        }
        if kind.has_date_fields() {
            return date_fields::render(cx, self);
        }
        let Some(look) = self.look() else { return };
        match (kind, look.as_element()) {
            (Range, Some(before)) => {
                let Limits {
                    min: Some(min),
                    max: Some(max),
                    ..
                } = self.limits()
                else {
                    return;
                };
                let fraction = Some((self.number().unwrap_or(min) - min) / (max - min))
                    .filter(|it| it.is_finite())
                    .unwrap_or(0.0);
                set_part_style(cx, before, &format!("flex-grow:{fraction}"));
                if let Some(after) = look
                    .parent()
                    .and_then(Node::last_child)
                    .and_then(Node::as_element)
                {
                    set_part_style(cx, after, &format!("flex-grow:{}", 1.0 - fraction));
                }
            }
            (Color, Some(swatch)) => {
                set_part_style(
                    cx,
                    swatch,
                    &format!("background-color:{}", self.value().to_utf8()),
                );
                color_picker::render(cx, self);
            }
            (File, _) => set_text(
                cx,
                Some(look),
                &match self.files().filter(|it| it.get_length() > 0) {
                    None => "No file chosen".into(),
                    Some(files) if files.get_length() == 1 => {
                        files.names().next().unwrap_or_default()
                    }
                    Some(files) => format!("{} files", files.get_length()).as_str().into(),
                },
            ),
            _ => {
                let alt = (kind == Image)
                    .then(|| {
                        element
                            .attr(atom!("alt"))
                            .or_else(|| element.attr(atom!("title")))
                    })
                    .flatten();
                let label = alt.or_else(|| element.attr(atom!("value")));
                set_text(
                    cx,
                    Some(look),
                    &label.unwrap_or_else(|| kind.default_label().into()),
                );
            }
        }
    }

    /// https://html.spec.whatwg.org/#input-type-change
    fn type_changed(self, cx: &mut Cx<'a>, new: InputType) {
        let (old, old_value, text) = (self.kind(), self.value(), self.text);
        let was_value_mode = self.is_value_mode();
        text.disconnect_value_ranges(cx);
        self.state.kind.set(new);
        match (was_value_mode, new.value_mode()) {
            (true, ValueMode::Default | ValueMode::DefaultOn)
                if text.state.is_dirty.get() && !old_value.is_empty() =>
            {
                self.element.set_attr(cx, atom!("value"), old_value);
            }
            (false, ValueMode::Value) => text.state.is_dirty.set(false),
            _ => {}
        }
        if old == File {
            self.set_files(cx, None);
        }
        self.sanitize_again();
        let [start, end] = if old.supports_selection() {
            text.selection()
        } else {
            [0; 2]
        };
        text.put_selection(start, end);
        self.element
            .set_state(cx, State::IN_RANGE | State::OUT_OF_RANGE, false);
        self.rebuild(cx);
        self.uncheck_others(cx);
        if new == Image || self.state.was_image.get() {
            self.update_image(cx);
        }
        text.show_selection(cx);
        if new.is_typed() && focus::has_focus(self.element) {
            self.element.set_state(cx, State::FOCUS_VISIBLE, true);
        }
    }

    fn sanitize_again(self) {
        if self.is_value_mode() {
            self.text
                .put_text(self.sanitize(&if self.text.state.is_dirty.get() {
                    self.text.text()
                } else {
                    self.default_value()
                }));
        }
    }

    fn update_image(self, cx: &mut Cx<'a>) {
        self.state.was_image.set(true);
        crate::api::images::update_button_image(cx, self.element);
    }

    /// https://html.spec.whatwg.org/#show-the-picker,-if-applicable
    fn show_picker(self, cx: &mut Cx<'a>, ui: &'a Ui) {
        match self.kind() {
            File => {
                let accept = self.element.attr(atom!("accept")).unwrap_or_default();
                host::pick_files(
                    cx,
                    ui,
                    self.element,
                    self.has(atom!("multiple")),
                    self.has(atom!("webkitdirectory")),
                    &accept,
                );
            }
            Color => color_picker::open(cx, self),
            kind if kind.has_editor() => _ = suggestions::show(cx, self, true),
            _ => date_picker::set_open(cx, self, true),
        }
    }

    /// No script runs.
    pub(crate) fn close_picker(self, cx: &mut Cx<'a>) {
        date_picker::set_open(cx, self, false);
        color_picker::close(cx, self);
        suggestions::close(cx, self);
    }

    pub(super) fn list(self) -> Option<&'a Element> {
        let found = self
            .element
            .root()
            .element_by_id(&Atom::from_string(&self.element.attr(atom!("list"))?))?;
        found
            .reference_target()?
            .is_html(atom!("datalist"))
            .then_some(found)
    }

    pub(crate) fn files_picked(self, cx: &mut Cx<'a>, files: Option<&'a FileList>) {
        if files.is_none() {
            fire(cx, self.element, atom!("cancel"), BUBBLES);
            return;
        }
        self.set_files(cx, files);
        user_changed(cx, self.element);
    }

    pub(crate) fn set_value_by_user(self, cx: &mut Cx<'a>, value: &DomString) {
        self.set_value(cx, value);
        user_changed(cx, self.element);
    }
}

impl HTMLInputElement {
    fn input(&self) -> Input<'_> {
        Input::new(self)
    }

    fn require<'a>(
        &self,
        heap: &JsHeap<'a>,
        applies: fn(InputType) -> bool,
    ) -> bindgen::Result<'a, Input<'_>> {
        let input = Some(self.input()).filter(|it| applies(it.kind()));
        input.ok_or_else(|| {
            dom_error(
                heap,
                DomError::InvalidStateError,
                "This does not apply to the type of the input element.",
            )
        })
    }

    pub(crate) fn get_width<'a>(&'a self, cx: &mut Cx<'a>) -> u32 {
        self.image_size(cx, atom!("width"), 0)
    }

    pub(crate) fn get_height<'a>(&'a self, cx: &mut Cx<'a>) -> u32 {
        self.image_size(cx, atom!("height"), 1)
    }

    fn image_size<'a>(&'a self, cx: &mut Cx<'a>, name: Known, axis: usize) -> u32 {
        if self.input().kind() != Image {
            0
        } else if looks_like(cx, self, Looks::RENDERED) {
            crate::api::ui::layout::laid_out(cx, self, |engine, id| {
                engine.box_sizes(id)[2 + axis].round() as u32
            })
        } else {
            self.integer(name)
                .and_then(|it| it.try_into().ok())
                .unwrap_or_else(|| {
                    crate::api::images::natural_size_of_button_image(self)[axis] as u32
                })
        }
    }

    pub(crate) fn set_width<'a>(&'a self, cx: &mut Cx<'a>, value: u32) {
        reflect::set_unsigned(cx, self, atom!("width"), value, 0);
    }

    pub(crate) fn set_height<'a>(&'a self, cx: &mut Cx<'a>, value: u32) {
        reflect::set_unsigned(cx, self, atom!("height"), value, 0);
    }

    pub(crate) fn get_type(&self) -> Known {
        self.input().kind().name()
    }

    pub(crate) fn set_type<'a>(&'a self, cx: &mut Cx<'a>, value: DomString) {
        self.set_attr(cx, atom!("type"), value);
    }

    pub(crate) fn get_value(&self) -> DomString {
        self.input().value()
    }

    pub(crate) fn set_value<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        value: DomString,
    ) -> bindgen::Result<'a, ()> {
        match self.input().kind().value_mode() {
            ValueMode::Value => self.input().set_value(cx, &value),
            ValueMode::Default | ValueMode::DefaultOn => self.set_attr(cx, atom!("value"), value),
            ValueMode::Filename if value.is_empty() => self.input().set_files(cx, None),
            ValueMode::Filename => {
                return Err(dom_error(
                    &cx.heap,
                    DomError::InvalidStateError,
                    "The value may only be set to the empty string.",
                ));
            }
        }
        Ok(())
    }

    pub(crate) fn get_checked(&self) -> bool {
        self.input().is_checked()
    }

    pub(crate) fn set_checked<'a>(&'a self, cx: &mut Cx<'a>, value: bool) {
        self.input().state.is_checked_dirty.set(true);
        self.input().set_checked(cx, value);
    }

    pub(crate) fn get_indeterminate(&self) -> bool {
        self.input().is_indeterminate()
    }

    pub(crate) fn set_indeterminate<'a>(&'a self, cx: &mut Cx<'a>, value: bool) {
        self.input().state.is_indeterminate.set(value);
        dirty(cx, self);
    }

    pub(crate) fn get_files(&self, heap: &JsHeap<'_>) -> JSValue {
        match self.input().kind() {
            File => self.same_object(heap, Edge::Files, || {
                FileList::new(self.doc().heap(heap), []).value()
            }),
            _ => JSValue::NULL,
        }
    }

    pub(crate) fn set_files<'a>(&'a self, cx: &mut Cx<'a>, files: Option<&'a FileList>) {
        if let Some(files) = files.filter(|_| self.input().kind() == File) {
            self.input().set_files(cx, Some(files));
        }
    }

    pub(crate) fn get_webkit_entries(&self) -> Vec<u32> {
        Vec::new()
    }

    pub(crate) fn get_list(&self) -> Option<&Element> {
        self.input().list()
    }

    pub(crate) fn get_value_as_number(&self) -> f64 {
        self.input().number().unwrap_or(f64::NAN)
    }

    pub(crate) fn set_value_as_number<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        value: f64,
    ) -> bindgen::Result<'a, ()> {
        if value.is_infinite() {
            return Err(cx
                .heap
                .type_error(format_args!("The value provided is infinite.")));
        }
        let input = self.require(&cx.heap, InputType::is_numeric)?;
        if value.is_nan() {
            input.set_value(cx, &DomString::default())
        } else {
            input.set_number(cx, value)
        }
        Ok(())
    }

    pub(crate) fn get_value_as_date<'a>(&self, heap: &JsHeap<'a>) -> bindgen::Result<'a, JSValue> {
        let input = self.input();
        let Some(number) = input.number().filter(|_| input.kind().supports_date()) else {
            return Ok(JSValue::NULL);
        };
        Ok(bindgen::to_js::date(
            self.realm(heap),
            if input.kind() == Month {
                start_of_month(number)
            } else {
                number
            },
        )?
        .to_js())
    }

    pub(crate) fn set_value_as_date<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        date: Option<JsLocal<'a, bun_jsc::JSObject>>,
    ) -> bindgen::Result<'a, ()> {
        let input = self.require(&cx.heap, InputType::supports_date)?;
        let date = date.map(JsLocal::to_js);
        if date.is_some_and(|it| !it.is_date()) {
            return Err(cx.heap.type_error(format_args!("The value is not a Date.")));
        }
        let time = date
            .map(JSValue::get_unix_timestamp)
            .filter(|it| !it.is_nan());
        match if input.kind() == Month {
            time.and_then(month_at)
        } else {
            time
        } {
            Some(number) => input.set_number(cx, number),
            None => input.set_value(cx, &DomString::default()),
        }
        Ok(())
    }

    fn step<'a>(&'a self, cx: &mut Cx<'a>, count: i32) -> bindgen::Result<'a, ()> {
        let input = self.require(&cx.heap, InputType::is_numeric)?;
        if input.limits().step.is_none() {
            return Err(dom_error(
                &cx.heap,
                DomError::InvalidStateError,
                "This element does not have an allowed value step.",
            ));
        }
        input.step_by(cx, count);
        Ok(())
    }

    pub(crate) fn step_up<'a>(&'a self, cx: &mut Cx<'a>, count: i32) -> bindgen::Result<'a, ()> {
        self.step(cx, count)
    }

    pub(crate) fn step_down<'a>(&'a self, cx: &mut Cx<'a>, count: i32) -> bindgen::Result<'a, ()> {
        self.step(cx, count.saturating_neg())
    }

    pub(crate) fn show_picker<'a>(&'a self, cx: &mut Cx<'a>) -> bindgen::Result<'a, ()> {
        let kind = self.input().kind();
        let is_mutable = if kind.is_typed() {
            self.input().text.is_mutable()
        } else {
            !is_disabled(self)
        };
        let allowed = require_picker(self, is_mutable, matches!(kind, File | Color));
        refused(&cx.heap, allowed)?;
        if let Some(ui) = Ui::of(self.doc()).filter(|it| it.consume_activation(cx)) {
            self.input().show_picker(cx, ui);
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Default, PartialEq)]
struct GroupFacts {
    is_required: bool,
    is_checked: bool,
}

impl GroupFacts {
    fn with(self, radio: Input<'_>) -> GroupFacts {
        GroupFacts {
            is_required: self.is_required || radio.has(atom!("required")),
            is_checked: self.is_checked || radio.is_checked(),
        }
    }
}

/// Of the tree with that root, by form and name.
type Groups = (
    JSValue,
    bun_collections::HashMap<(Option<JSValue>, DomString), GroupFacts>,
);

#[thread_local]
static GROUPS: core::mem::ManuallyDrop<core::cell::RefCell<Option<Box<Groups>>>> =
    core::mem::ManuallyDrop::new(core::cell::RefCell::new(None));

/// `steps` change no radio button.
pub(super) fn remembering_groups(steps: impl FnOnce()) {
    let outer = GROUPS.replace(Some(Box::new((JSValue::ZERO, Default::default()))));
    steps();
    GROUPS.replace(outer);
}

fn input_attribute_changed<'a>(cx: &mut Cx<'a>, element: &'a Element, change: &AttrChange<'_>) {
    let input = Input::new(element);
    match (change.known(), input.kind()) {
        (atom!("type"), old) => {
            let new = element
                .keyword(atom!("type"))
                .map(InputType::from_keyword)
                .unwrap_or_default();
            if new != old {
                input.type_changed(cx, new);
            }
        }
        (atom!("value"), _) if !input.text.state.is_dirty.get() && input.is_value_mode() => {
            input
                .text
                .set_default(cx, input.sanitize(&input.default_value()));
        }
        (atom!("min") | atom!("max") | atom!("step"), Range) => input.sanitize_again(),
        (atom!("min") | atom!("step"), kind) if kind.has_date_fields() => input.rebuild(cx),
        (atom!("list"), kind)
            if kind.has_editor() && change.old.is_some() != change.new.is_some() =>
        {
            input.rebuild(cx);
            input.text.show_selection(cx);
        }
        (atom!("disabled") | atom!("readonly"), _) => input.close_picker(cx),
        (atom!("checked"), _) if !input.state.is_checked_dirty.get() => {
            input.set_checked(cx, change.new.is_some())
        }
        (atom!("name"), Radio) => input.uncheck_others(cx),
        (atom!("src"), Image) => input.update_image(cx),
        (atom!("alt") | atom!("title") | atom!("value"), Image) => {
            input.rebuild(cx);
            crate::api::images::show_button_image(cx, element);
        }
        _ => {}
    }
    attribute_changed(cx, element, change);
}

const WAS_CHECKED: i32 = 1;
const WAS_INDETERMINATE: i32 = 2;

/// For a checkbox the bits above. For a radio button the one that was checked, or null.
fn pre_activate<'a>(cx: &mut Cx<'a>, element: &'a Element) -> JSValue {
    let input = Input::new(element);
    let saved = match input.kind() {
        Checkbox => JSValue::from(
            i32::from(input.is_checked()) * WAS_CHECKED
                + i32::from(input.state.is_indeterminate.take()) * WAS_INDETERMINATE,
        ),
        Radio => input
            .group()
            .find(|it| it.is_checked())
            .map_or(JSValue::NULL, |it| it.element.value()),
        _ => return JSValue::UNDEFINED,
    };
    input.state.is_checked_dirty.set(true);
    input.set_checked(cx, input.kind() == Radio || !input.is_checked());
    dirty(cx, element);
    saved
}

fn cancel_activate<'a>(cx: &mut Cx<'a>, element: &'a Element, saved: JSValue) {
    let input = Input::new(element);
    if saved.is_int32() {
        input.set_checked(cx, saved.as_int32() & WAS_CHECKED != 0);
        input
            .state
            .is_indeterminate
            .set(saved.as_int32() & WAS_INDETERMINATE != 0);
        dirty(cx, element);
    } else if !saved.is_undefined() {
        input.set_checked(cx, false);
        if let Some(it) = Element::from_value(saved) {
            Input::new(it).set_checked(cx, true);
        }
    }
}

fn activate<'a>(
    cx: &mut Cx<'a>,
    element: &'a Element,
    event: &'a Event,
    origin: &'a Node,
    saved: JSValue,
) {
    let input = Input::new(element);
    match input.kind() {
        Checkbox | Radio => {
            if !saved.is_undefined() && saved != element.value() && element.is_connected() {
                user_changed(cx, element);
            }
        }
        Color if color_picker::is_inside(input, origin) => {}
        Color if color_picker::is_open(input) => color_picker::finish(cx, input),
        File | Color => {
            if let Some(ui) = Ui::of(element.doc()).filter(|it| it.consume_activation(cx)) {
                input.show_picker(cx, ui);
            }
        }
        kind if kind.is_button() => {
            if kind == Image {
                let click = event.downcast::<MouseEvent>().filter(|it| {
                    it.get_detail() > 0
                        || !crate::api::ui::activation::is_clicked_without_pointer(it)
                });
                input
                    .state
                    .coordinate
                    .set(click.map_or([0; 2], |it| it.offset(cx).map(|it| it as i32)));
            }
            button::activate(cx, element, kind.name(), origin);
        }
        _ => {}
    }
}

pub(crate) static STEPS: Steps = Steps {
    ua_shadow: Some(|cx, element| {
        let root = element.attach_ua_shadow(cx);
        Input::new(element).build(cx, root);
    }),
    post_connection: Some(|cx, element, is_move| {
        Input::new(element).uncheck_others(cx);
        inserted(cx, element, is_move);
    }),
    removed: Some(text::removed),
    rendered: Some(|cx, element| {
        if Input::new(element).state.was_image.get() {
            crate::api::images::show_button_image(cx, element);
        }
    }),
    adopted: Some(|cx, element, _| {
        if input_type(element) == Some(Image) {
            Input::new(element).update_image(cx);
        }
    }),
    parent_changed: Some(|cx, element, _| {
        if element.is_connected() || form_owner(element).is_some() {
            Input::new(element).uncheck_others(cx);
        }
    }),
    attribute_changed: Some(input_attribute_changed),
    cloned: Some(|_, from, to, _| {
        let (from, to) = (Input::new(from), Input::new(to));
        from.text.copy_to(to.text);
        to.state.is_checked.set(from.is_checked());
        to.state
            .is_checked_dirty
            .set(from.state.is_checked_dirty.get());
        to.state.is_indeterminate.set(from.is_indeterminate());
    }),
    pre_activate: Some(pre_activate),
    cancel_activate: Some(cancel_activate),
    activate: Some(activate),
    default_action: Some(input_events::default_action),
    ..Steps::NONE
};
