//! https://html.spec.whatwg.org/#constraints

use super::*;
use crate::api::ui::top_layer;
use crate::generated_bindgen::forms::{HasValidity, ValidityState, js_ValidityState};

bitflags::bitflags! {
    #[derive(Clone, Copy, Default, PartialEq, Eq)]
    pub(crate) struct Validity: u16 {
        const VALUE_MISSING = 1;
        const TYPE_MISMATCH = 1 << 1;
        const PATTERN_MISMATCH = 1 << 2;
        const TOO_LONG = 1 << 3;
        const TOO_SHORT = 1 << 4;
        const RANGE_UNDERFLOW = 1 << 5;
        const RANGE_OVERFLOW = 1 << 6;
        const STEP_MISMATCH = 1 << 7;
        const BAD_INPUT = 1 << 8;
        const CUSTOM_ERROR = 1 << 9;
    }
}

const MESSAGES: [&str; 9] = [
    "Please fill out this field.",
    "Please enter a valid value.",
    "Please match the requested format.",
    "Please shorten this text.",
    "Please lengthen this text.",
    "The value is too small.",
    "The value is too large.",
    "Please enter a valid value.",
    "Please enter a valid value.",
];

pub(crate) fn errors(element: &Element) -> Validity {
    let own = match element.html_tag() {
        atom!("input") => Input::new(element).errors(),
        atom!("textarea") => textarea::errors(element),
        atom!("select") => Select::new(element).errors(),
        _ => match custom_control(element) {
            Some(custom) => return custom.errors.get(),
            None => Validity::empty(),
        },
    };
    if control(element).custom_error.borrow().is_some() {
        own | Validity::CUSTOM_ERROR
    } else {
        own
    }
}

fn is_barred(element: &Element) -> bool {
    let is_read_only = || element.has_attr(atom!("readonly"));
    match element.html_tag() {
        atom!("input") => {
            matches!(
                input_type(element),
                Some(InputType::Hidden | InputType::Reset | InputType::Button)
            ) || is_read_only()
        }
        atom!("button") => button::button_type(element) != atom!("submit"),
        atom!("select") => false,
        atom!("fieldset") | atom!("object") | atom!("output") => true,
        _ => is_read_only(),
    }
}

pub(crate) fn will_validate(element: &Element) -> bool {
    !is_barred(element)
        && !is_disabled(element)
        && element.closest_html(atom!("datalist")).is_none()
}

fn message(element: &Element) -> DomString {
    let custom = control(element).custom_error.borrow().clone();
    let own = || {
        MESSAGES
            .get(errors(element).bits().trailing_zeros() as usize)
            .map(|it| DomString::from(*it))
    };
    will_validate(element)
        .then(|| custom.or_else(own))
        .flatten()
        .unwrap_or_default()
}

pub(crate) fn has_custom_error(element: &Element) -> bool {
    matches!(element.html_tag(), atom!("input") | atom!("textarea"))
        && control(element).custom_error.borrow().is_some()
}

pub(super) fn set_custom_error<'a>(cx: &mut Cx<'a>, element: &'a Element, message: &DomString) {
    control(element)
        .custom_error
        .replace((!message.is_empty()).then(|| normalize_newlines(message)));
    dirty(cx, element);
}

/// https://html.spec.whatwg.org/#interactively-validate-the-constraints, or statically
pub(super) fn validate<'a, 'e>(
    cx: &mut Cx<'a>,
    candidates: impl IntoIterator<Item = &'e Element>,
    reports: bool,
) -> bool {
    let invalid = Refs::collect(
        &cx.heap,
        candidates
            .into_iter()
            .filter(|it| will_validate(it) && !errors(it).is_empty()),
    );
    let mut unhandled = Refs::default();
    for element in invalid.iter() {
        if fire(cx, element, atom!("invalid"), CANCELABLE) && reports {
            unhandled.push(&cx.heap, element);
        }
    }
    for element in unhandled.iter() {
        let anchor = element
            .edge_node(Edge::ValidationAnchor)
            .and_then(Node::as_element)
            .unwrap_or(element);
        if focus::is_focusable(cx, anchor) || focus::delegates_focus(anchor) {
            focus::focus(cx, anchor, focus::Cause::Script, focus::Options::default());
            if let Some(ui) = Ui::of(element.doc()) {
                top_layer::show_bubble_below(cx, ui, anchor, &message(element).to_utf8());
            }
            break;
        }
    }
    invalid.is_empty()
}

fn set_states<'a>(cx: &mut Cx<'a>, element: &'a Element, is_valid: Option<bool>, was_edited: bool) {
    element.set_state(cx, State::VALID, is_valid == Some(true));
    element.set_state(cx, State::INVALID, is_valid == Some(false));
    element.set_state(cx, State::USER_VALID, was_edited && is_valid == Some(true));
    element.set_state(
        cx,
        State::USER_INVALID,
        was_edited && is_valid == Some(false),
    );
}

/// Whether it matches `:invalid`.
pub(super) fn update_states<'a>(cx: &mut Cx<'a>, element: &'a Element) -> bool {
    let is_valid = will_validate(element).then(|| errors(element).is_empty());
    set_states(cx, element, is_valid, control(element).was_edited.get());
    is_valid == Some(false)
}

pub(super) fn update_states_of_group<'a>(cx: &mut Cx<'a>, group: &'a Element) {
    let is_invalid = |it: &Element| it.has_state(State::INVALID) && !it.is_html(atom!("fieldset"));
    let has_invalid = match group.is_html(atom!("form")) {
        true => controls_of(group).any(is_invalid),
        false => group
            .elements_with_objects()
            .any(|it| is_invalid(it) && is_listed(it)),
    };
    set_states(cx, group, Some(!has_invalid), false);
}

slots!(ValidityState = js_ValidityState { element: Element });

pub(super) fn validity_state(heap: &JsHeap<'_>, element: &Element) -> JSValue {
    element.same_object(heap, Edge::Validity, || {
        let made = js_ValidityState::create(element.doc().heap(heap), Default::default());
        made.set_element(Some(element));
        made.to_js()
    })
}

impl ValidityState {
    fn errors(&self) -> Validity {
        self.element().map(errors).unwrap_or_default()
    }

    pub(crate) fn get_valid(&self) -> bool {
        self.errors().is_empty()
    }
}

impl crate::generated_bindgen::forms::ValidityFlag {
    pub(crate) fn get(&self, flag: Validity) -> bool {
        self.errors().contains(flag)
    }
}

impl HasValidity {
    pub(crate) fn get_will_validate(&self) -> bool {
        will_validate(self)
    }

    pub(crate) fn get_validity(&self, heap: &JsHeap<'_>) -> JSValue {
        validity_state(heap, self)
    }

    pub(crate) fn get_validation_message(&self) -> DomString {
        message(self)
    }

    pub(crate) fn check_validity<'a>(&'a self, cx: &mut Cx<'a>) -> bool {
        validate(cx, [&**self], false)
    }

    pub(crate) fn report_validity<'a>(&'a self, cx: &mut Cx<'a>) -> bool {
        validate(cx, [&**self], true)
    }

    pub(crate) fn set_custom_validity<'a>(&'a self, cx: &mut Cx<'a>, message: &DomString) {
        set_custom_error(cx, self, message);
    }
}
