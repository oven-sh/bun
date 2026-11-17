//! https://html.spec.whatwg.org/#the-elementinternals-interface

use super::validity::Validity;
use super::*;
use crate::api::core::custom::{self, Callback};
use crate::generated_bindgen::forms::{
    DefaultReference, DefaultReferences, DefaultSemantics, ValidityStateFlags, js_ElementInternals,
};

/// Of a form-associated custom element.
#[derive(Default)]
pub(crate) struct Custom {
    pub(super) errors: Cell<Validity>,
    was_disabled: Cell<bool>,
}

pub(super) fn reassociate<'a>(cx: &mut Cx<'a>, element: &'a Element) {
    let doc = element.doc();
    let watchers = doc.try_edge_list(Edge::CustomControls);
    if !element.is_connected() || !element.has_attr(atom!("form")) {
        watchers.map(|it| it.remove(&cx.heap, element.to_js()));
    } else if watchers.is_none_or(|it| !it.contains(element.to_js())) {
        doc.edge_list(&cx.heap, Edge::CustomControls)
            .push(&cx.heap, element.to_js());
        doc.set_doc_flags(DocFlags::WATCHES_IDS, true);
    }
    let form = form_owner(element).map_or(JSValue::NULL, Handle::value);
    if form != element.edge(Edge::AssociatedForm).unwrap_or(JSValue::NULL) {
        element.set_edge(&cx.heap, Edge::AssociatedForm, form);
        custom::enqueue_callback(cx, element, Callback::FormAssociated, &[form]);
    }
    let is_disabled = is_disabled(element);
    if element.extra::<Custom>().was_disabled.replace(is_disabled) != is_disabled {
        custom::enqueue_callback(cx, element, Callback::FormDisabled, &[is_disabled.into()]);
    }
    if element.is_connected() {
        inserted(cx, element, false);
    }
}

pub(crate) fn id_changed<'a>(cx: &mut Cx<'a>, doc: &'a Doc, id: &Atom) {
    let (id, controls) = (
        id.to_dom_string(),
        doc.try_edge_list(Edge::CustomControls)
            .into_iter()
            .flat_map(List::nodes)
            .filter_map(Node::as_element),
    );
    Refs::collect(
        &cx.heap,
        controls.filter(|it| it.attr(atom!("form")).as_ref() == Some(&id)),
    )
    .iter()
    .for_each(|it| reassociate(cx, it));
}

pub(crate) static STEPS: Steps = Steps {
    post_connection: Some(|cx, element, _| reassociate(cx, element)),
    removed: Some(|cx, element, scope, is_move| {
        removed(cx, element, scope, is_move);
        reassociate(cx, element);
    }),
    parent_changed: Some(|cx, element, _| reassociate(cx, element)),
    attribute_changed: Some(|cx, element, change| {
        attribute_changed(cx, element, change);
        reassociate(cx, element);
    }),
    ..Steps::NONE
};

pub(crate) fn make_form_associated<'a>(cx: &mut Cx<'a>, element: &'a Element) {
    if element.has_attr(atom!("form")) {
        element.arena().has_remote_owners.set(true);
    }
    element.set_kind(Kind::FormAssociated);
    element.set_state(cx, State::FORM_ASSOCIATED, true);
    element.ties_changed();
}

#[derive(Default)]
pub(crate) struct ElementInternals {
    /// By the name of the attribute that overrides it.
    semantics: RefCell<Vec<(Known, DomString)>>,
}

slots!(ElementInternals = js_ElementInternals { target: Element });

/// https://html.spec.whatwg.org/#dom-attachinternals
pub(crate) fn attach<'a>(
    cx: &mut Cx<'a>,
    element: &'a Element,
) -> bindgen::Result<'a, &'a ElementInternals> {
    let Some(is_form_associated) =
        custom::may_attach_internals(element).filter(|_| element.edge(Edge::Internals).is_none())
    else {
        return Err(dom_error(
            &cx.heap,
            DomError::NotSupportedError,
            "Unable to attach ElementInternals to this element.",
        ));
    };
    if is_form_associated {
        make_form_associated(cx, element);
    }
    let internals =
        js_ElementInternals::create(element.doc().heap(&cx.heap), ElementInternals::default());
    internals.set_target(Some(element));
    element.set_edge(&cx.heap, Edge::Internals, internals.to_js());
    element.engine(|engine, id| engine.forget_facts(id));
    Ok(internals)
}

impl ElementInternals {
    fn element(&self) -> &Element {
        self.target().expect("set by attach")
    }

    fn semantics(&self, attribute: Known) -> Option<DomString> {
        self.semantics
            .borrow()
            .iter()
            .find(|it| it.0 == attribute)
            .map(|it| it.1.clone())
    }

    pub(crate) fn all_semantics(&self) -> core::cell::Ref<'_, Vec<(Known, DomString)>> {
        self.semantics.borrow()
    }

    fn control<'a>(&self, heap: &JsHeap<'a>) -> bindgen::Result<'a, &Element> {
        let control = Some(self.element()).filter(|it| custom_control(it).is_some());
        control.ok_or_else(|| {
            dom_error(
                heap,
                DomError::NotSupportedError,
                "The target element is not a form-associated custom element.",
            )
        })
    }

    pub(crate) fn get_shadow_root(&self) -> Option<&ShadowRoot> {
        self.element()
            .shadow_root()
            .filter(|it| it.is(ShadowFlags::AVAILABLE_TO_INTERNALS))
    }

    pub(crate) fn get_states<'a>(&'a self, cx: &mut Cx<'a>) -> JSValue {
        custom::state_set(&cx.heap, self.element())
    }

    pub(crate) fn set_form_value<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        value: JsLocal<'a>,
        _state: JsLocal<'a>,
    ) -> bindgen::Result<'a, ()> {
        let value = super::form_data::submission_value(cx, value)?;
        self.control(&cx.heap)?
            .set_edge(&cx.heap, Edge::SubmissionValue, value);
        Ok(())
    }

    pub(crate) fn set_validity<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        flags: &ValidityStateFlags,
        message: Option<DomString>,
        anchor: Option<&'a crate::generated_bindgen::html::HTMLElement>,
    ) -> bindgen::Result<'a, ()> {
        let (element, message) = (self.control(&cx.heap)?, message.unwrap_or_default());
        let errors = [
            flags.value_missing,
            flags.type_mismatch,
            flags.pattern_mismatch,
            flags.too_long,
            flags.too_short,
            flags.range_underflow,
            flags.range_overflow,
            flags.step_mismatch,
            flags.bad_input,
            flags.custom_error,
        ];
        let errors = Validity::from_bits_retain(
            errors
                .iter()
                .rev()
                .fold(0, |all, it| all << 1 | u16::from(*it)),
        );
        if !errors.is_empty() && message.is_empty() {
            return Err(cx.heap.type_error(format_args!(
                "The message must not be empty if a flag is true."
            )));
        }
        element.extra::<Custom>().errors.set(errors);
        validity::set_custom_error(
            cx,
            element,
            &if errors.is_empty() {
                DomString::default()
            } else {
                message
            },
        );
        if anchor.is_some_and(|it| !element.contains_composed(it)) {
            return Err(dom_error(
                &cx.heap,
                DomError::NotFoundError,
                "The anchor is not a shadow-including descendant of the target element.",
            ));
        }
        element.set_edge_node(
            &cx.heap,
            Edge::ValidationAnchor,
            anchor.map(|it| -> &Element { it }),
        );
        Ok(())
    }

    pub(crate) fn get_form<'a>(&self, heap: &JsHeap<'a>) -> bindgen::Result<'a, Option<&Node>> {
        self.control(heap).map(|it| seen_from(it, form_owner(it)))
    }

    pub(crate) fn get_labels<'a>(&'a self, heap: &JsHeap<'a>) -> bindgen::Result<'a, JSValue> {
        self.control(heap).map(|it| button::label_list(heap, it))
    }

    pub(crate) fn get_will_validate<'a>(&self, heap: &JsHeap<'a>) -> bindgen::Result<'a, bool> {
        self.control(heap).map(validity::will_validate)
    }

    pub(crate) fn get_validity<'a>(&self, heap: &JsHeap<'a>) -> bindgen::Result<'a, JSValue> {
        self.control(heap)
            .map(|it| validity::validity_state(heap, it))
    }

    pub(crate) fn get_validation_message<'a>(
        &self,
        heap: &JsHeap<'a>,
    ) -> bindgen::Result<'a, DomString> {
        self.control(heap).map(|it| {
            control(it)
                .custom_error
                .borrow()
                .clone()
                .unwrap_or_default()
        })
    }

    pub(crate) fn check_validity<'a>(&'a self, cx: &mut Cx<'a>) -> bindgen::Result<'a, bool> {
        self.control(&cx.heap)
            .map(|it| validity::validate(cx, [it], false))
    }

    pub(crate) fn report_validity<'a>(&'a self, cx: &mut Cx<'a>) -> bindgen::Result<'a, bool> {
        self.control(&cx.heap)
            .map(|it| validity::validate(cx, [it], true))
    }
}

impl DefaultSemantics {
    pub(crate) fn get(&self, attribute: Known) -> Option<DomString> {
        self.semantics(attribute)
    }

    pub(crate) fn set(&self, attribute: Known, value: Option<DomString>) {
        let mut all = self.semantics.borrow_mut();
        all.retain(|it| it.0 != attribute);
        all.extend(value.map(|it| (attribute, it)));
    }
}

impl DefaultReference {
    pub(crate) fn get(&self, attribute: Known) -> Option<&Element> {
        reflect::explicit_elements(self.element(), reflect::Owner::Internals, attribute)?.next()
    }

    pub(crate) fn set<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        attribute: Known,
        value: Option<&'a Element>,
    ) {
        reflect::set_explicit_elements(
            heap,
            self.element(),
            reflect::Owner::Internals,
            attribute,
            value.map(|it| [it]),
        );
    }
}

impl DefaultReferences {
    pub(crate) fn get<'a>(&'a self, heap: &JsHeap<'a>, attribute: Known) -> JSValue {
        reflect::frozen_elements(heap, self.element(), reflect::Owner::Internals, attribute)
    }

    pub(crate) fn set<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        attribute: Known,
        value: Option<bindgen::JsList<'a, &'a Element>>,
    ) {
        reflect::set_explicit_elements(
            heap,
            self.element(),
            reflect::Owner::Internals,
            attribute,
            value,
        );
    }
}
