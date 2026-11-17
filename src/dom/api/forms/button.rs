//! `button`, `fieldset`, `label`, `legend` and `output`

use super::*;
use crate::api::ui::activation::{self, Click};
use crate::api::ui::{details, invokers};
use crate::api::uievents::{Mouse, PointerData, PointerEvent};
use crate::generated_bindgen::forms::{
    HTMLButtonElement, HTMLFieldSetElement, HTMLLabelElement, HTMLLegendElement, HTMLOutputElement,
    HasAutocomplete, HasForm, HasFormAction, HasLabels,
};

pub(crate) fn button_type(button: &Element) -> Known {
    match button.keyword(atom!("type")) {
        Some(value @ (atom!("submit") | atom!("reset") | atom!("button"))) => value,
        _ if button.has_attr(atom!("commandfor")) || button.has_attr(atom!("command")) => {
            atom!("button")
        }
        _ => atom!("submit"),
    }
}

fn is_select_button(element: &Element) -> bool {
    element
        .parent()
        .is_some_and(|it| it.is_html(atom!("select")))
}

pub(super) fn is_submit_button(element: &Element) -> bool {
    match input_type(element) {
        Some(kind) => matches!(kind, InputType::Submit | InputType::Image),
        None => {
            element.is_html(atom!("button"))
                && button_type(element) == atom!("submit")
                && !is_select_button(element)
        }
    }
}

pub(super) fn update_default<'a>(cx: &mut Cx<'a>, element: &'a Element) {
    let default_of = |form: &'a Element| controls_of(form).find(|it| is_submit_button(it));
    let is_default =
        is_submit_button(element) && form_owner(element).and_then(default_of) == Some(element);
    if is_default == element.has_state(State::DEFAULT) {
        return;
    }
    element.set_state(cx, State::DEFAULT, is_default);
    // The one that was it, or that is it now.
    if let Some(other) = form_owner(element)
        .and_then(|it| controls_of(it).find(|it| *it != element && is_submit_button(it)))
    {
        other.set_state(cx, State::DEFAULT, !is_default);
    }
}

pub(super) fn activate<'a>(cx: &mut Cx<'a>, button: &'a Element, kind: Known, origin: &'a Node) {
    if is_disabled(button) {
        return;
    }
    match (
        form_owner(button).filter(|_| !is_select_button(button)),
        kind,
    ) {
        (Some(form), atom!("submit") | atom!("image")) => {
            form::submit(cx, form, Some(button), false)
        }
        (Some(form), atom!("reset")) => form::reset_form(cx, form),
        (Some(_), _) if !button.attr_is(atom!("type"), "button") => {}
        _ => invokers::invoke(cx, button, origin),
    }
}

impl HTMLButtonElement {
    pub(crate) fn get_command(&self) -> DomString {
        invokers::command_name(self)
    }

    pub(crate) fn set_command<'a>(&'a self, cx: &mut Cx<'a>, value: DomString) {
        self.set_attr(cx, atom!("command"), value);
    }

    pub(crate) fn get_type(&self) -> Known {
        button_type(self)
    }

    pub(crate) fn set_type<'a>(&'a self, cx: &mut Cx<'a>, value: DomString) {
        self.set_attr(cx, atom!("type"), value);
    }
}

pub(crate) static STEPS: Steps = Steps {
    post_connection: Some(inserted),
    removed: Some(removed),
    attribute_changed: Some(attribute_changed),
    activate: Some(|cx, button, _, origin, _| activate(cx, button, button_type(button), origin)),
    ..Steps::NONE
};

impl HTMLFieldSetElement {
    pub(crate) fn get_type(&self) -> Known {
        atom!("fieldset")
    }

    pub(crate) fn get_elements<'a>(&'a self, heap: &JsHeap<'a>) -> JSValue {
        static LISTED: Test = Test {
            bare: Bare::None,
            reads: Reads::Ties,
            matches: is_listed,
            ..Test::ALL
        };
        self.same_object(heap, Edge::Elements, || {
            HTMLCollection::new(heap, self, Filter::descendants(&LISTED)).to_js()
        })
    }
}

pub(crate) static FIELDSET_STEPS: Steps = Steps {
    post_connection: Some(inserted),
    attribute_changed: Some(|cx, fieldset, change| {
        if !change.is(atom!("disabled")) {
            return;
        }
        if let Some(focused) =
            focus::focused(fieldset.doc()).filter(|it| fieldset.contains(it) && is_disabled(it))
        {
            focus::blur(cx, focused);
        }
        for control in fieldset.elements_with_objects().filter(|it| is_listed(it)) {
            if is_form_associated_custom(control) {
                internals::reassociate(cx, control)
            } else {
                dirty(cx, control)
            }
        }
    }),
    ..Steps::NONE
};

pub(crate) static OUTPUT_STEPS: Steps = Steps {
    post_connection: Some(inserted),
    attribute_changed: Some(attribute_changed),
    removed: Some(removed),
    ..Steps::NONE
};

/// https://html.spec.whatwg.org/#concept-output-default-value-override
#[derive(Default)]
struct DefaultValueOverride(RefCell<Option<DomString>>);

pub(super) fn reset_output<'a>(cx: &mut Cx<'a>, output: &'a Element) {
    if let Some(value) = output.extra::<DefaultValueOverride>().0.take() {
        string_replace_all(cx, value, output);
    }
}

impl HTMLOutputElement {
    pub(crate) fn get_type(&self) -> Known {
        atom!("output")
    }

    pub(crate) fn get_value(&self) -> DomString {
        self.descendant_text_content()
    }

    pub(crate) fn set_value<'a>(&'a self, cx: &mut Cx<'a>, value: DomString) {
        self.extra::<DefaultValueOverride>()
            .0
            .replace(Some(self.get_default_value()));
        string_replace_all(cx, value, self);
    }

    pub(crate) fn get_default_value(&self) -> DomString {
        self.extra::<DefaultValueOverride>()
            .0
            .borrow()
            .clone()
            .unwrap_or_else(|| self.get_value())
    }

    pub(crate) fn set_default_value<'a>(&'a self, cx: &mut Cx<'a>, value: DomString) {
        let saved = &self.extra::<DefaultValueOverride>().0;
        if saved.borrow().is_some() {
            saved.replace(Some(value));
        } else {
            string_replace_all(cx, value, self);
        }
    }
}

impl HTMLLegendElement {
    pub(crate) fn get_form(&self) -> Option<&Node> {
        let fieldset = self
            .parent_element()
            .filter(|it| it.is_html(atom!("fieldset")))?;
        seen_from(fieldset, form_owner(fieldset))
    }
}

impl HTMLLabelElement {
    pub(crate) fn get_control(&self) -> Option<&Node> {
        seen_from(self, labeled_control(self))
    }

    pub(crate) fn get_form(&self) -> Option<&Node> {
        seen_from(self, form_owner(labeled_control(self)?))
    }
}

fn activate_label<'a>(
    cx: &mut Cx<'a>,
    label: &'a Element,
    event: &'a Event,
    origin: &'a Node,
    _: JSValue,
) {
    let Some(control) = labeled_control(label).filter(|it| {
        !it.contains_composed(origin) && !details::is_in_interactive_content(origin, label)
    }) else {
        return;
    };
    let click = event.downcast::<PointerEvent>();
    let detail = click.map_or(0, |it| it.get_detail());
    if event.is_trusted() {
        let selected = range::try_selection(label.doc()).and_then(Selection::range);
        if detail == 1
            && selected.is_some_and(|it| !it.collapsed() && label.contains(it.start().node))
        {
            return;
        }
        focus::focus(
            cx,
            control,
            if is_typed_in(control) {
                focus::Cause::Script
            } else {
                focus::Cause::Mouse
            },
            focus::Options::default(),
        );
    }
    let forwarded = click.map(|it| Click {
        mouse: Mouse {
            movement: [0.0; 2],
            button: 0,
            buttons: 0,
            ..it.mouse()
        },
        detail,
        pointer: Some(PointerData {
            id: it.pointer().id,
            kind: it.pointer().kind.clone(),
            is_primary: it.pointer().is_primary,
            ..Default::default()
        }),
    });
    activation::click(
        cx,
        control,
        if event.is_trusted() {
            Trusted::Yes
        } else {
            Trusted::No
        },
        forwarded.unwrap_or_default(),
    );
}

pub(crate) static LABEL_STEPS: Steps = Steps {
    activate: Some(activate_label),
    ..Steps::NONE
};

impl HasForm {
    pub(crate) fn get_form(&self) -> Option<&Node> {
        seen_from(self, form_owner(self))
    }
}

pub(super) fn label_list<'a>(heap: &JsHeap<'a>, element: &'a Element) -> JSValue {
    let labels = Filter::listed(|it, add| {
        it.as_element()
            .into_iter()
            .flat_map(labels_of)
            .for_each(add)
    });
    element.same_object(heap, Edge::Labels, || {
        NodeList::live(heap, element, labels).to_js()
    })
}

impl HasLabels {
    pub(crate) fn get_labels<'a>(&'a self, heap: &JsHeap<'a>) -> JSValue {
        if is_labelable(self) {
            label_list(heap, self)
        } else {
            JSValue::NULL
        }
    }
}

impl HasAutocomplete {
    pub(crate) fn get_autocomplete(&self) -> DomString {
        let is_hidden = input_type(self) == Some(InputType::Hidden);
        let value = self.with_attr(atom!("autocomplete"), |it| {
            autofill::exposed_value(it.as_bytes(), is_hidden)
        });
        crate::values::text(&value.unwrap_or_default()).into()
    }

    pub(crate) fn set_autocomplete<'a>(&'a self, cx: &mut Cx<'a>, value: DomString) {
        self.set_attr(cx, atom!("autocomplete"), value);
    }
}

impl HasFormAction {
    pub(crate) fn get_form_action<'a>(&'a self, cx: &mut Cx<'a>) -> DomString {
        form::action(cx, self, atom!("formaction"))
    }

    pub(crate) fn set_form_action<'a>(&'a self, cx: &mut Cx<'a>, value: DomString) {
        self.set_attr(cx, atom!("formaction"), value);
    }
}
