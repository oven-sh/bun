//! <https://drafts.csswg.org/css-pseudo/#CSSPseudoElement-interface>

use bun_jsc::JSValue;
use bun_jsc::bindgen::{JsHeap, JsInterface};

use crate::api::core::{Edge, Element};
use crate::generated_bindgen::cssom::{ElementPseudo, js_CSSPseudoElement};
use crate::values::{Out, eq};

pub(crate) struct CSSPseudoElement(Out, bun_jsc::bindgen::Interior);

impl CSSPseudoElement {
    fn new<'a>(heap: &JsHeap<'a>, element: &Element, parent: JSValue, selector: Out) -> &'a Self {
        let made = js_CSSPseudoElement::create(
            element.realm(heap),
            CSSPseudoElement(selector, Default::default()),
        );
        js_CSSPseudoElement::set_element(made, Some(element));
        js_CSSPseudoElement::set_parent(made, parent);
        made
    }

    pub(crate) fn get_type(&self) -> &[u8] {
        bun_core::strings::split_once_char(&self.0, b'(').map_or(&self.0, |it| it.0)
    }

    pub(crate) fn get_selector_text(&self) -> &[u8] {
        &self.0
    }

    pub(crate) fn pseudo<'a>(&'a self, heap: &JsHeap<'a>, r#type: &[u8]) -> Option<&'a Self> {
        (matches!(self.get_type(), b"::before" | b"::after") && eq(r#type, "::marker"))
            .then_some(())?;
        js_CSSPseudoElement::marker(self).or_else(|| {
            let made = Self::new(
                heap,
                js_CSSPseudoElement::element(self)?,
                self.to_js(),
                b"::marker".into(),
            );
            js_CSSPseudoElement::set_marker(self, Some(made));
            Some(made)
        })
    }
}

pub(crate) fn pseudo_element<'a>(
    heap: &JsHeap<'a>,
    element: &'a Element,
    r#type: &[u8],
) -> Option<&'a CSSPseudoElement> {
    let selector = crate::cssom::pseudo_element(r#type.trim_ascii())?;
    (matches!(
        &selector[2..],
        b"before" | b"after" | b"marker" | b"backdrop" | b"scroll-marker"
    ) || selector.starts_with(b"::view-transition"))
    .then_some(())?;
    let known = element.edge_list(heap, Edge::PseudoElements);
    let found = known
        .values()
        .filter_map(|it| CSSPseudoElement::from_js(heap, it))
        .find(|it| it.0 == selector);
    Some(found.unwrap_or_else(|| {
        let made = CSSPseudoElement::new(heap, element, element.to_js(), selector);
        known.push(heap, made.to_js());
        made
    }))
}

impl ElementPseudo {
    pub(crate) fn pseudo<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        r#type: &[u8],
    ) -> Option<&'a CSSPseudoElement> {
        pseudo_element(heap, self, r#type)
    }
}
