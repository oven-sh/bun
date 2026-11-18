//! What html.bind.ts declares, but for links and tables.

use core::cell::RefCell;

use bun_jsc::JSValue;
use bun_jsc::bindgen::{self, JsHeap, JsInterface, JsList, JsLocal, JsScope, JsStringImpl};

use super::reflect::parse_integer;
use super::steps::Steps;
use super::url::{Part, Url};
use super::{NodeFlags as F, *};
use crate::api::trusted::Trusted;
use crate::generated_bindgen::html::*;

type Cx<'c, 'a> = &'c mut JsScope<'a>;
type Result<'a, T = ()> = bindgen::Result<'a, T>;

#[derive(Default)]
struct Nonce(RefCell<DomString>);

impl Element {
    /// <https://html.spec.whatwg.org/#cryptographicnonce>
    pub(crate) fn nonce(&self) -> DomString {
        self.try_extra::<Nonce>()
            .map(|it| it.0.borrow().clone())
            .unwrap_or_default()
    }

    pub(super) fn set_nonce(&self, nonce: DomString) {
        self.set(F::HAS_NONCE);
        self.extra::<Nonce>().0.replace(nonce);
    }

    /// From the selectors of style sheets that may have been injected.
    pub(crate) fn hide_nonce<'a>(&'a self, cx: Cx<'_, 'a>) {
        let nonce = self.nonce();
        if !nonce.is_empty()
            && self.with_attr_string(atom!("nonce"), |it| !it.is_empty()) == Some(true)
            && page::has_policy_from_header(cx, self.doc())
        {
            self.set_attr(cx, atom!("nonce"), DomString::default());
            self.set_nonce(nonce);
        }
    }

    pub(super) fn copy_nonce(&self, to: &Element) {
        if let Some(nonce) = self.try_extra::<Nonce>() {
            to.set_nonce(nonce.0.borrow().clone());
        }
    }

    /// The state of the nearest element that has `attribute` in one of two states. The empty string is the first.
    pub(crate) fn inherited_switch(&self, attribute: Known, on: &str, off: &str) -> Option<bool> {
        let state = |it: &DomString| {
            if it.is_empty() || it.eq_ignore_ascii_case(on) {
                Some(true)
            } else {
                it.eq_ignore_ascii_case(off).then_some(false)
            }
        };
        core::iter::successors(Some(self), |it| it.parent_element())
            .find_map(|it| it.with_attr_string(attribute, state).flatten())
    }

    pub(super) fn same_collection<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        edge: Edge,
        filter: Filter,
    ) -> JSValue {
        self.same_object(heap, edge, || {
            HTMLCollection::new(heap, self, filter).to_js()
        })
    }
}

impl HTMLOrSVGElement {
    pub(crate) fn get_dataset<'a>(&'a self, heap: &JsHeap<'a>) -> JSValue {
        self.dataset(heap)
    }

    pub(crate) fn get_nonce(&self) -> DomString {
        self.nonce()
    }

    pub(crate) fn set_nonce(&self, nonce: DomString) {
        Element::set_nonce(self, nonce);
    }
}

/// <https://html.spec.whatwg.org/#rendered-text-fragment>
fn rendered_text_fragment<'a>(
    cx: Cx<'_, 'a>,
    doc: &'a Doc,
    text: &DomString,
) -> &'a DocumentFragment {
    let fragment = doc.create_fragment(&cx.heap);
    let (mut start, mut at) = (0, 0);
    loop {
        let unit = (at < text.len()).then(|| text.unit(at));
        if unit.is_some_and(|it| it != 0x0a && it != 0x0d) {
            at += 1;
            continue;
        }
        if at > start {
            append_detached(
                fragment,
                doc.create_text(&cx.heap, text.substring(start, at - start)),
            );
        }
        let Some(unit) = unit else { return fragment };
        append_detached(fragment, doc.create_html(&cx.heap, atom!("br")));
        at += if unit == 0x0d && at + 1 < text.len() && text.unit(at + 1) == 0x0a {
            2
        } else {
            1
        };
        start = at;
    }
}

/// <https://html.spec.whatwg.org/#merge-with-the-next-text-node>
fn merge_with_next_text<'a>(cx: Cx<'_, 'a>, node: &'a Node) {
    if let (Some(text), Some(next)) = (node.as_text(), node.next_sibling().and_then(Node::as_text))
    {
        text.append_data(cx, &next.data());
        remove(cx, next, Observers::Notify);
    }
}

impl HTMLElement {
    pub(crate) fn get_translate(&self) -> bool {
        self.inherited_switch(atom!("translate"), "yes", "no")
            .unwrap_or(true)
    }

    pub(crate) fn set_translate<'a>(&'a self, cx: Cx<'_, 'a>, value: bool) {
        self.set_attr(
            cx,
            atom!("translate"),
            DomString::from(if value { "yes" } else { "no" }),
        );
    }

    pub(crate) fn get_hidden<'a>(&'a self, heap: &JsHeap<'a>) -> JSValue {
        match self.with_attr_string(atom!("hidden"), |it| it.eq_ignore_ascii_case("until-found")) {
            Some(true) => Atom::of(atom!("until-found")).to_js(heap).to_js(),
            state => JSValue::js_boolean(state.is_some()),
        }
    }

    pub(crate) fn set_hidden<'a>(&'a self, cx: Cx<'_, 'a>, value: Hidden<'a>) {
        let is_hidden = match value {
            Hidden::None => false,
            Hidden::Flag(flag) => flag,
            Hidden::Number(number) => number != 0.0 && !number.is_nan(),
            Hidden::Text(text) => {
                let text = DomString::from_impl(text.get());
                if text.eq_ignore_ascii_case("until-found") {
                    return self.set_attr(
                        cx,
                        atom!("hidden"),
                        Atom::of(atom!("until-found")).to_dom_string(),
                    );
                }
                !text.is_empty()
            }
        };
        match is_hidden {
            true => self.set_attr(cx, atom!("hidden"), DomString::default()),
            false => _ = self.remove_attr(cx, atom!("hidden")),
        }
    }

    pub(crate) fn get_inner_text<'a>(&'a self, cx: Cx<'_, 'a>) -> DomString {
        let rendered = if self.is_rendered() {
            self.synced_engine(cx, |engine, id| engine.inner_text_if_rendered(id))
        } else {
            None
        };
        rendered.map_or_else(
            || self.descendant_text_content(),
            |it| DomString::from_utf8(crate::values::text(&it)),
        )
    }

    pub(crate) fn set_inner_text<'a>(&'a self, cx: Cx<'_, 'a>, text: DomString) {
        if !text.has_newline() {
            return string_replace_all(cx, text, self);
        }
        let fragment = rendered_text_fragment(cx, self.doc(), &text);
        replace_all(cx, Some(fragment), self);
    }

    pub(crate) fn get_outer_text<'a>(&'a self, cx: Cx<'_, 'a>) -> DomString {
        self.get_inner_text(cx)
    }

    pub(crate) fn set_outer_text<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        text: JsStringImpl<'a>,
    ) -> Result<'a> {
        let Some(parent) = self.parent() else {
            return Err(dom_error(
                &cx.heap,
                DomError::NoModificationAllowedError,
                "The element has no parent.",
            ));
        };
        let (previous, next) = (self.previous_sibling(), self.next_sibling());
        let fragment = rendered_text_fragment(cx, self.doc(), &text.into());
        if fragment.first_child().is_none() {
            append_detached(
                fragment,
                self.doc().create_text(&cx.heap, DomString::default()),
            );
        }
        replace(cx, self, fragment, parent)?;
        for node in [next.and_then(Node::previous_sibling), previous]
            .into_iter()
            .flatten()
        {
            merge_with_next_text(cx, node);
        }
        Ok(())
    }
}

impl HTMLMarqueeElement {
    pub(crate) fn get_loop(&self) -> i32 {
        self.with_attr(atom!("loop"), |it| parse_integer(it.as_bytes()))
            .flatten()
            .filter(|it| *it > 0)
            .unwrap_or(-1)
    }

    pub(crate) fn set_loop<'a>(&'a self, cx: Cx<'_, 'a>, count: i32) -> Result<'a> {
        if count <= 0 && count != -1 {
            return Err(dom_error(
                &cx.heap,
                DomError::IndexSizeError,
                "The value is neither positive nor -1.",
            ));
        }
        self.set_attr(cx, atom!("loop"), DomString::from_integer(count));
        Ok(())
    }

    pub(crate) fn start(&self) {}

    pub(crate) fn stop(&self) {}
}

impl HTMLMapElement {
    pub(crate) fn get_areas<'a>(&'a self, heap: &JsHeap<'a>) -> JSValue {
        self.same_collection(
            heap,
            Edge::Parts,
            Filter::descendants(
                const {
                    &Test {
                        tags: &[atom!("area")],
                        matches: |it| it.kind() == Kind::Area,
                        ..Test::ALL
                    }
                },
            ),
        )
    }
}

impl ChildText {
    pub(crate) fn get_text(&self) -> DomString {
        self.child_text_content()
    }

    pub(crate) fn set_text<'a>(&'a self, cx: Cx<'_, 'a>, text: DomString) {
        string_replace_all(cx, text, self);
    }
}

pub(super) const TITLE_STEPS: Steps = Steps {
    post_connection: Some(|_, it, _| metadata::title_changed(it.doc())),
    removed: Some(|_, it, _, _| metadata::title_changed(it.doc())),
    children_changed: Some(|_, it, _| {
        if it.is_connected() {
            metadata::title_changed(it.doc());
        }
    }),
    ..Steps::NONE
};

fn meta_changed<'a>(cx: Cx<'_, 'a>, meta: &'a Element) {
    if meta.scope().is_some_and(|it| it.kind().is_document()) {
        metadata::meta_changed(cx, meta);
    }
}

pub(super) const META_STEPS: Steps = Steps {
    post_connection: Some(|cx, it, _| meta_changed(cx, it)),
    removed: Some(|cx, it, _, _| metadata::meta_changed(cx, it)),
    attribute_changed: Some(|cx, it, _| meta_changed(cx, it)),
    ..Steps::NONE
};

pub(crate) fn take_frame_margins<'a>(cx: Cx<'_, 'a>, body: &'a Element) {
    if !body.doc().is(DocFlags::IN_FRAME) {
        return;
    }
    for name in [atom!("marginwidth"), atom!("marginheight")] {
        let margin = crate::api::frames::container(body.doc())
            .and_then(|it| it.attr(name))
            .and_then(|it| parse_integer(it.to_utf8().as_bytes()));
        if let Some(margin) = margin.filter(|it| *it >= 0) {
            body.set_attr(cx, name, DomString::from_integer(margin));
        }
    }
}

pub(super) const BODY_STEPS: Steps = Steps {
    post_connection: Some(|cx, it, _| take_frame_margins(cx, it)),
    ..Steps::NONE
};

// ───────────────────────────── base ─────────────────────────────

/// <https://html.spec.whatwg.org/#set-the-frozen-base-url>
fn base_changed<'a>(cx: Cx<'_, 'a>, doc: &'a Doc) {
    let fallback = doc.fallback_base_url();
    let href = doc
        .elements_with_objects()
        .filter(|it| it.kind() == Kind::Base)
        .find_map(|it| it.attr(atom!("href")));
    let url = href.and_then(|it| Url::parse(&cx.heap, &it, Some(&fallback)));
    let url = url.filter(|it| {
        !["data:", "javascript:"]
            .iter()
            .any(|scheme| it.part(Part::Protocol).eq_str(scheme))
    });
    let base = url
        .map(Url::into_href)
        .filter(|it| page::allows_base(cx, doc, it))
        .unwrap_or(fallback);
    if doc.is(DocFlags::HAS_PAGE) {
        doc.engine(|engine, _| engine.base_url = base.to_utf8().as_bytes().into());
        doc.window()
            .filter(|_| base != doc.base_url())
            .into_iter()
            .for_each(|it| it.host().base_url_changed(base.to_utf8().into_owned()));
    }
    doc.set_base_url(base);
}

pub(super) const BASE_STEPS: Steps = Steps {
    post_connection: Some(|cx, it, _| base_changed(cx, it.doc())),
    removed: Some(|cx, it, _, _| base_changed(cx, it.doc())),
    attribute_changed: Some(|cx, it, change| {
        if it.is_connected() && change.name.local == atom!("href") {
            base_changed(cx, it.doc());
        }
    }),
    ..Steps::NONE
};

impl HTMLBaseElement {
    pub(crate) fn get_href<'a>(&'a self, heap: &JsHeap<'a>) -> DomString {
        let href = self.attr(atom!("href")).unwrap_or_default();
        Url::parse(heap, &href, Some(&self.doc().fallback_base_url())).map_or(href, Url::into_href)
    }

    pub(crate) fn set_href<'a>(&'a self, cx: Cx<'_, 'a>, href: DomString) {
        self.set_attr(cx, atom!("href"), href);
    }
}

// ───────────────────────────── template ─────────────────────────────

impl Element {
    /// They are made when they are first asked for.
    pub(crate) fn template_contents<'a>(&'a self, cx: Cx<'_, 'a>) -> Option<&'a DocumentFragment> {
        if self.kind() != Kind::Template {
            return None;
        }
        if let Some(contents) = self.edge_node(Edge::TemplateContents) {
            return contents.as_fragment();
        }
        let contents = self
            .doc()
            .template_contents_owner(cx)
            .create_fragment(&cx.heap);
        contents.set_edge(&cx.heap, Edge::Host, self.to_js());
        self.set_edge(&cx.heap, Edge::TemplateContents, contents.to_js());
        Some(contents)
    }
}

pub(super) const TEMPLATE_STEPS: Steps = Steps {
    cloned: Some(|cx, from, to, subtree| {
        let Some(mut next) = from
            .edge_node(Edge::TemplateContents)
            .map(Node::first_child)
            .filter(|_| subtree && bun_core::StackCheck::init().is_safe_to_recurse())
        else {
            return;
        };
        let Some(copy) = to.template_contents(cx) else {
            return;
        };
        while let Some(child) = next {
            if clone_node(cx, child, copy.doc(), true, Some(copy), JSValue::NULL)
                .map_err(|it| it.into_js_error(cx.global()))
                .is_err()
            {
                return;
            }
            next = child.next_sibling();
        }
    }),
    adopted: Some(|cx, it, _| {
        if let Some(contents) = it
            .edge_node(Edge::TemplateContents)
            .filter(|_| bun_core::StackCheck::init().is_safe_to_recurse())
        {
            let owner = it.doc().template_contents_owner(cx);
            adopt(cx, contents, owner);
        }
    }),
    ..Steps::NONE
};

impl HTMLTemplateElement {
    pub(crate) fn get_content<'a>(&'a self, cx: Cx<'_, 'a>) -> &'a DocumentFragment {
        self.template_contents(cx).expect("it is a template")
    }
}

// ───────────────────────────── slot ─────────────────────────────

fn is_in_shadow_tree(node: &Node) -> bool {
    node.root().has(F::SHADOW_ROOT)
}

/// <https://dom.spec.whatwg.org/#find-flattened-slotables>
fn find_flattened_slottables<'a>(slot: &'a Node, found: &mut Vec<&'a Node>) {
    let slottables = |slot: &'a Node| -> Vec<&'a Node> {
        let assigned: Vec<_> = slot.assigned_nodes().collect();
        if assigned.is_empty() {
            slot.children().filter(|it| it.kind().is_linked()).collect()
        } else {
            assigned
        }
    };
    let mut rest = slottables(slot);
    rest.reverse();
    while let Some(node) = rest.pop() {
        match node.has(F::SLOT) && is_in_shadow_tree(node) {
            true => rest.extend(slottables(node).into_iter().rev()),
            false => found.push(node),
        }
    }
}

impl HTMLSlotElement {
    fn assigned<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        options: &AssignedNodesOptions,
        matches: fn(&Node) -> bool,
    ) -> JSValue {
        let mut found = Vec::new();
        match options.flatten && is_in_shadow_tree(self) {
            true => find_flattened_slottables(self, &mut found),
            false => found.extend(self.assigned_nodes()),
        }
        found.retain(|it| matches(it));
        List::from_fn(heap, found.len() as u32, |it| found[it as usize].to_js()).to_js()
    }

    pub(crate) fn js_assigned_nodes<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        options: &AssignedNodesOptions,
    ) -> JSValue {
        self.assigned(heap, options, |_| true)
    }

    pub(crate) fn assigned_elements<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        options: &AssignedNodesOptions,
    ) -> JSValue {
        self.assigned(heap, options, Node::is_element)
    }

    pub(crate) fn assign<'a>(&'a self, cx: Cx<'_, 'a>, nodes: JsList<'a, ElementOrText<'a>>) {
        let nodes = nodes.iter().map(|it| -> &'a Node {
            match it {
                ElementOrText::Element(it) => it,
                ElementOrText::Text(it) => it,
            }
        });
        let nodes = Rooted::from_nodes(&cx.heap, nodes);
        self.assign_manually(cx, &nodes);
    }
}

pub(super) const SLOT_STEPS: Steps = Steps {
    created: Some(|_, it| it.become_slot()),
    attribute_changed: Some(|cx, it, change| {
        if let Some(root) = it
            .root()
            .as_shadow_root()
            .filter(|_| change.name.local == atom!("name"))
        {
            assign_slottables(cx, root);
        }
    }),
    ..Steps::NONE
};

// ───────────────────────────── links ─────────────────────────────

fn url_of<'a>(cx: Cx<'_, 'a>, link: &'a Element) -> Option<Url> {
    link.doc().parse_url(cx, &link.attr(atom!("href"))?)
}

impl HyperlinkElementUtils {
    pub(crate) fn get_href<'a>(&'a self, cx: Cx<'_, 'a>) -> DomString {
        let Some(href) = self.attr(atom!("href")) else {
            return DomString::default();
        };
        self.doc().parse_url(cx, &href).map_or(href, Url::into_href)
    }

    pub(crate) fn set_href<'a>(&'a self, cx: Cx<'_, 'a>, href: DomString) {
        self.set_attr(cx, atom!("href"), href);
    }

    pub(crate) fn get_origin<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a, JSValue> {
        match url_of(cx, self) {
            Some(url) => url.origin(cx),
            None => Ok(Atom::EMPTY.to_js(&cx.heap).to_js()),
        }
    }
}

impl UrlPart {
    pub(crate) fn get<'a>(&'a self, cx: Cx<'_, 'a>, part: Part) -> DomString {
        url_of(cx, self).map_or_else(
            || DomString::from(if part == Part::Protocol { ":" } else { "" }),
            |it| it.part(part),
        )
    }

    pub(crate) fn set<'a>(&'a self, cx: Cx<'_, 'a>, part: Part, value: JsStringImpl<'a>) {
        if let Some(url) = url_of(cx, self) {
            self.set_attr(
                cx,
                atom!("href"),
                url.with_part(part, &value.into()).into_href(),
            );
        }
    }
}

impl HTMLAnchorElement {
    pub(crate) fn get_text(&self) -> DomString {
        self.descendant_text_content()
    }

    pub(crate) fn set_text<'a>(&'a self, cx: Cx<'_, 'a>, text: DomString) {
        string_replace_all(cx, text, self);
    }
}

/// <https://w3c.github.io/trusted-types/dist/spec/#htmlscriptelement-script-text>
#[derive(Default)]
struct ScriptText(RefCell<DomString>);

impl HTMLScriptElement {
    fn trust<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        value: JsLocal<'a>,
        sink: &str,
    ) -> Result<'a, DomString> {
        let text = Trusted::Script.string_for(cx, self, value, sink)?;
        self.extra::<ScriptText>().0.replace(text.clone());
        Ok(text)
    }

    pub(crate) fn get_text(&self, _: Cx<'_, '_>) -> DomString {
        self.child_text_content()
    }

    pub(crate) fn set_text<'a>(&'a self, cx: Cx<'_, 'a>, value: JsLocal<'a>) -> Result<'a> {
        let text = self.trust(cx, value, "HTMLScriptElement text")?;
        string_replace_all(cx, text, self);
        Ok(())
    }

    pub(crate) fn get_text_content(&self, _: Cx<'_, '_>) -> DomString {
        self.descendant_text_content()
    }

    pub(crate) fn set_text_content<'a>(&'a self, cx: Cx<'_, 'a>, value: JsLocal<'a>) -> Result<'a> {
        let value = if value.to_js().is_undefined_or_null() {
            Atom::EMPTY.to_js(&cx.heap).as_value()
        } else {
            value
        };
        let text = self.trust(cx, value, "HTMLScriptElement textContent")?;
        string_replace_all(cx, text, self);
        Ok(())
    }

    pub(crate) fn get_inner_text<'a>(&'a self, cx: Cx<'_, 'a>) -> DomString {
        HTMLElement::get_inner_text(self, cx)
    }

    pub(crate) fn set_inner_text<'a>(&'a self, cx: Cx<'_, 'a>, value: JsLocal<'a>) -> Result<'a> {
        let value = if value.to_js().is_null() {
            Atom::EMPTY.to_js(&cx.heap).as_value()
        } else {
            value
        };
        let text = self.trust(cx, value, "HTMLScriptElement innerText")?;
        HTMLElement::set_inner_text(self, cx, text);
        Ok(())
    }

    pub(crate) fn supports(r#type: &[u8]) -> bool {
        matches!(r#type, b"classic" | b"module" | b"importmap")
    }
}

pub(crate) fn trust_text_of_script(script: &Element) {
    let text = script.child_text_content();
    if !text.is_empty() {
        script.extra::<ScriptText>().0.replace(text);
    }
}

pub(crate) fn is_text_of_script_trusted(script: &Element, text: &DomString) -> bool {
    script
        .try_extra::<ScriptText>()
        .map_or(text.is_empty(), |it| *it.0.borrow() == *text)
}
