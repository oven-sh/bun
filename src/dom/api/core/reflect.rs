//! <https://html.spec.whatwg.org/#reflecting-content-attributes-in-idl-attributes>

use bun_jsc::bindgen::{self, JsHeap, JsInterface, JsList, JsLocal, JsScope, JsStringImpl};
use bun_jsc::{JSString, JSValue};
use smallvec::SmallVec;

use super::{NodeFlags as F, *};
use crate::api::trusted::Trusted;
use crate::generated_bindgen::reflect::*;

type Str<'a> = JsLocal<'a, JSString>;
type Cx<'c, 'a> = &'c mut JsScope<'a>;
type Result<'a, T = ()> = bindgen::Result<'a, T>;

pub(crate) struct Integer {
    pub(crate) name: Known,
    pub(crate) default: i32,
    pub(crate) min: i32,
    pub(crate) limit: Limit,
}

pub(crate) enum Limit {
    None,
    /// With it, the attribute may be anything that is not negative.
    AtMost(i32),
    ThrowsBelow(i32),
}

pub(crate) struct Enumerated {
    pub(crate) name: Known,
    pub(crate) keywords: &'static [&'static str],
    pub(crate) missing: &'static str,
    pub(crate) invalid: &'static str,
}

pub(crate) struct Tokens {
    pub(crate) name: Known,
    pub(crate) supported: Option<&'static [&'static str]>,
}

/// It saturates.
fn parse_long(text: &[u8]) -> Option<i64> {
    let text = text.trim_ascii_start();
    let (sign, digits) = match text {
        [b'-', digits @ ..] => (-1, digits),
        [b'+', digits @ ..] | digits => (1, digits),
    };
    let value = digits
        .iter()
        .take_while(|it| it.is_ascii_digit())
        .fold(0_i64, |all, it| {
            all.saturating_mul(10).saturating_add(i64::from(it - b'0'))
        });
    digits
        .first()
        .is_some_and(u8::is_ascii_digit)
        .then_some(sign * value)
}

/// <https://html.spec.whatwg.org/#rules-for-parsing-integers>
pub(crate) fn parse_integer(text: &[u8]) -> Option<i32> {
    parse_long(text)?.try_into().ok()
}

#[inline(always)]
fn element_of(node: &Node) -> &Element {
    debug_assert!(node.is_element());
    // SAFETY: only the interfaces of elements have these members.
    unsafe { node.cast() }
}

#[inline]
fn set(cx: Cx<'_, '_>, node: &Node, name: Known, value: Option<DomString>) {
    // SAFETY: the caller holds it.
    let element = element_of(unsafe { Node::from_cell(node.to_js()) });
    match value {
        Some(value) => element.set_attr(cx, name, value),
        None => _ = element.remove_attr(cx, name),
    }
}

fn text(value: JsStringImpl<'_>) -> DomString {
    DomString::from_impl(value.get())
}

macro_rules! strings {
    ($($name:ty)*) => {
        $(impl $name {
            #[inline]
            pub(crate) fn get<'a>(&self, heap: &JsHeap<'a>, name: Known) -> Str<'a> {
                element_of(self).with_attr_string(name, |it| it.to_js(heap)).unwrap_or_else(|| Atom::EMPTY.to_js(heap))
            }

            #[inline]
            pub(crate) fn set<'a>(&self, cx: Cx<'_, 'a>, name: Known, value: JsStringImpl<'a>) {
                // SAFETY: the caller holds it.
                element_of(unsafe { Node::from_cell(self.to_js()) }).set_attr_to_impl(cx, &name.into(), value.get());
            }
        })*
    };
}
strings!(ReflectString ReflectNullToEmpty ReflectUsvString);

impl ReflectNullable {
    pub(crate) fn get<'a>(&self, heap: &JsHeap<'a>, name: Known) -> Option<Str<'a>> {
        element_of(self).attr(name).map(|it| it.to_js(heap))
    }

    pub(crate) fn set<'a>(&self, cx: Cx<'_, 'a>, name: Known, value: Option<JsStringImpl<'a>>) {
        set(cx, self, name, value.map(text));
    }
}

fn aria_attribute(property: &bun_alloc::WTFStringImplStruct) -> Known {
    let mut name = SmallVec::<[u8; 32]>::from_slice(b"aria-");
    name.extend_from_slice(&property.latin1_slice()["aria".len()..]);
    Known::from_latin1_lowercased(&name)
}

impl ReflectAria {
    pub(crate) fn get<'a>(
        &self,
        heap: &JsHeap<'a>,
        property: &bun_alloc::WTFStringImplStruct,
    ) -> Option<Str<'a>> {
        element_of(self)
            .attr(aria_attribute(property))
            .map(|it| it.to_js(heap))
    }

    pub(crate) fn set<'a>(
        &self,
        cx: Cx<'_, 'a>,
        property: &bun_alloc::WTFStringImplStruct,
        value: Option<JsStringImpl<'a>>,
    ) {
        set(cx, self, aria_attribute(property), value.map(text));
    }
}

impl ReflectBoolean {
    pub(crate) fn get(&self, _: &JsHeap<'_>, name: Known) -> bool {
        element_of(self).has_attr(name)
    }

    pub(crate) fn set(&self, cx: Cx<'_, '_>, name: Known, value: bool) {
        set(cx, self, name, value.then(DomString::default));
    }
}

fn url_of<'a>(cx: Cx<'_, 'a>, node: &'a Node, name: Known) -> Str<'a> {
    let Some(value) = element_of(node).attr(name) else {
        return Atom::EMPTY.to_js(&cx.heap);
    };
    node.doc()
        .parse_url(cx, &value)
        .map_or(value, url::Url::into_href)
        .to_js(&cx.heap)
}

fn compliant<'a>(
    cx: Cx<'_, 'a>,
    node: &'a Node,
    name: Known,
    value: JsLocal<'a>,
) -> Result<'a, DomString> {
    match name {
        atom!("codebase") => {
            Trusted::ScriptUrl.string_for(cx, node, value, "HTMLObjectElement codeBase")
        }
        _ => element_of(node).compliant_attribute_value(cx, &QualName::plain(name), value),
    }
}

impl ReflectTrustedString {
    pub(crate) fn get<'a>(&'a self, cx: Cx<'_, 'a>, name: Known) -> Str<'a> {
        element_of(self)
            .attr(name)
            .unwrap_or_default()
            .to_js(&cx.heap)
    }

    pub(crate) fn set<'a>(&'a self, cx: Cx<'_, 'a>, name: Known, value: JsLocal<'a>) -> Result<'a> {
        let value = compliant(cx, self, name, value)?;
        set(cx, self, name, Some(value));
        Ok(())
    }
}

impl ReflectTrustedUrl {
    pub(crate) fn get<'a>(&'a self, cx: Cx<'_, 'a>, name: Known) -> Str<'a> {
        url_of(cx, self, name)
    }

    pub(crate) fn set<'a>(&'a self, cx: Cx<'_, 'a>, name: Known, value: JsLocal<'a>) -> Result<'a> {
        let value = compliant(cx, self, name, value)?;
        set(cx, self, name, Some(value.into_well_formed()));
        Ok(())
    }
}

impl ReflectUrl {
    pub(crate) fn get<'a>(&'a self, cx: Cx<'_, 'a>, name: Known) -> Str<'a> {
        url_of(cx, self, name)
    }

    pub(crate) fn set<'a>(&self, cx: Cx<'_, 'a>, name: Known, value: JsStringImpl<'a>) {
        set(cx, self, name, Some(text(value)));
    }
}

impl Integer {
    pub(crate) fn get(&self, element: &Element) -> i32 {
        let value = element
            .with_attr(self.name, |it| parse_long(it.as_bytes()))
            .flatten();
        let value = value.map(|it| {
            if let Limit::AtMost(max) = self.limit {
                it.min(max.into())
            } else {
                it
            }
        });
        value
            .and_then(|it| i32::try_from(it).ok())
            .filter(|it| *it >= self.min)
            .unwrap_or(self.default)
    }

    fn set<'a>(&self, cx: Cx<'_, 'a>, node: &Node, value: i64) -> Result<'a> {
        if matches!(self.limit, Limit::ThrowsBelow(it) if value < it.into()) {
            return Err(dom_error(
                &cx.heap,
                DomError::IndexSizeError,
                "The value is too small.",
            ));
        }
        let min = if matches!(self.limit, Limit::AtMost(_)) {
            0
        } else {
            self.min
        };
        let value = i32::try_from(value)
            .ok()
            .filter(|it| *it >= min)
            .unwrap_or(self.default);
        set(cx, node, self.name, Some(DomString::from_integer(value)));
        Ok(())
    }
}

pub(crate) fn set_unsigned<'a>(
    cx: Cx<'_, 'a>,
    element: &'a Element,
    name: Known,
    value: u32,
    default: u32,
) {
    element.set_attr(
        cx,
        name,
        DomString::from_integer(i32::try_from(value).unwrap_or(default as i32)),
    );
}

impl ReflectLong {
    pub(crate) fn get(&self, _: &JsHeap<'_>, key: &'static Integer) -> i32 {
        key.get(element_of(self))
    }

    pub(crate) fn set<'a>(&self, cx: Cx<'_, 'a>, key: &'static Integer, value: i32) -> Result<'a> {
        key.set(cx, self, value.into())
    }
}

impl ReflectUnsigned {
    pub(crate) fn get(&self, _: &JsHeap<'_>, key: &'static Integer) -> u32 {
        key.get(element_of(self)) as u32
    }

    pub(crate) fn set<'a>(&self, cx: Cx<'_, 'a>, key: &'static Integer, value: u32) -> Result<'a> {
        key.set(cx, self, value.into())
    }
}

impl Enumerated {
    /// `None` if there is no attribute.
    pub(crate) fn get(&self, element: &Element) -> Option<&'static str> {
        element.with_attr_string(self.name, |value| {
            self.keywords
                .iter()
                .copied()
                .find(|it| value.eq_ignore_ascii_case(it))
                .unwrap_or(self.invalid)
        })
    }
}

impl ReflectEnumerated {
    pub(crate) fn get<'a>(&self, heap: &JsHeap<'a>, key: &'static Enumerated) -> Str<'a> {
        Atom::new(key.get(element_of(self)).unwrap_or(key.missing)).to_js(heap)
    }

    pub(crate) fn set<'a>(
        &self,
        cx: Cx<'_, 'a>,
        key: &'static Enumerated,
        value: JsStringImpl<'a>,
    ) {
        set(cx, self, key.name, Some(text(value)));
    }
}

impl ReflectNullableEnumerated {
    pub(crate) fn get<'a>(&self, heap: &JsHeap<'a>, key: &'static Enumerated) -> Option<Str<'a>> {
        key.get(element_of(self))
            .map(|it| Atom::new(it).to_js(heap))
    }

    pub(crate) fn set<'a>(
        &self,
        cx: Cx<'_, 'a>,
        key: &'static Enumerated,
        value: Option<JsStringImpl<'a>>,
    ) {
        set(cx, self, key.name, value.map(text));
    }
}

impl Node {
    /// What `edge` has are pairs of a number and a value.
    fn keyed(&self, edge: Edge, key: u32) -> Option<JSValue> {
        let all = self.try_edge_list(edge)?;
        all.position_of_key(JSValue::js_number_from_int32(key as i32))
            .map(|it| all.get(it + 1))
    }

    fn set_keyed(&self, heap: &JsHeap<'_>, edge: Edge, key: u32, value: Option<JSValue>) {
        let (all, key) = (
            self.edge_list(heap, edge),
            JSValue::js_number_from_int32(key as i32),
        );
        if let Some(index) = all.position_of_key(key) {
            all.remove_range(heap, index, 2);
        }
        value
            .into_iter()
            .flat_map(|it| [key, it])
            .for_each(|it| all.push(heap, it));
    }
}

impl ReflectTokens {
    pub(crate) fn get<'a>(&'a self, heap: &JsHeap<'a>, key: &'static Tokens) -> JSValue {
        self.keyed(Edge::TokenLists, key.name as u32)
            .unwrap_or_else(|| {
                let made =
                    DOMTokenList::new(heap, element_of(self), key.name, key.supported).to_js();
                self.set_keyed(heap, Edge::TokenLists, key.name as u32, Some(made));
                made
            })
    }
}

// ───────────────────────────── elements ─────────────────────────────

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Owner {
    Element,
    Internals,
}

fn key_of(owner: Owner, name: Known) -> u32 {
    (name as u32) << 1 | owner as u32
}

/// Those that a script has set.
pub(crate) fn explicit_elements(
    element: &Element,
    owner: Owner,
    name: Known,
) -> Option<impl Iterator<Item = &Element>> {
    let all = element
        .has(F::HAS_EXPLICIT_ELEMENTS)
        .then(|| element.keyed(Edge::ExplicitElements, key_of(owner, name)))??;
    Some(List::from_value(all).nodes().filter_map(Node::as_element))
}

pub(crate) fn set_explicit_elements<'a>(
    heap: &JsHeap<'a>,
    element: &'a Element,
    owner: Owner,
    name: Known,
    to: Option<impl IntoIterator<Item = &'a Element>>,
) {
    set_explicit_list(
        heap,
        element,
        owner,
        name,
        to.map(|it| List::from_nodes(heap, it.into_iter().map(|it| &**it)).to_js()),
    );
}

fn set_explicit_list<'a>(
    heap: &JsHeap<'a>,
    element: &'a Element,
    owner: Owner,
    name: Known,
    to: Option<JSValue>,
) {
    element.set(F::HAS_EXPLICIT_ELEMENTS);
    element.set_keyed(heap, Edge::ExplicitElements, key_of(owner, name), to);
    element
        .arena()
        .write(|engine| engine.forget_facts(element.id()));
}

pub(super) fn attribute_changed(heap: &JsHeap<'_>, element: &Element, name: Known) {
    element.set_keyed(
        heap,
        Edge::ExplicitElements,
        key_of(Owner::Element, name),
        None,
    );
}

/// What an attribute of ids refers to, or what a script has put in its place.
pub(crate) fn elements(element: &Element, name: Known) -> Option<impl Iterator<Item = &Element>> {
    let explicit = explicit_elements(element, Owner::Element, name);
    let ids = if explicit.is_none() {
        Some(element.attr(name)?)
    } else {
        None
    };
    let (root, ids): (_, SmallVec<[Atom; 2]>) = (
        element.root(),
        ids.iter()
            .flat_map(DomString::tokens)
            .map(|it| Atom::from_string(&it))
            .collect(),
    );
    let by_id = ids
        .into_iter()
        .filter_map(move |it| root.element_by_id(&it));
    Some(
        explicit
            .into_iter()
            .flatten()
            .filter(move |it| it.root().contains_composed(element))
            .chain(by_id),
    )
}

pub(crate) fn element(element: &Element, name: Known) -> Option<&Element> {
    elements(element, name)?.next()
}

/// The same array for as long as the elements are the same.
pub(crate) fn frozen_elements<'a>(
    heap: &JsHeap<'a>,
    element: &'a Element,
    owner: Owner,
    name: Known,
) -> JSValue {
    let found = match owner {
        Owner::Element => {
            elements(element, name).map(|it| List::from_nodes(heap, it.map(|it| &**it)))
        }
        Owner::Internals => explicit_elements(element, owner, name)
            .map(|it| List::from_nodes(heap, it.map(|it| &**it))),
    };
    let old = element.keyed(Edge::FrozenElements, key_of(owner, name));
    if let Some(old) = old.filter(|old| {
        found.is_some_and(|it| {
            it.values()
                .eq(List::from_value(List::from_value(*old).get(0)).values())
        })
    }) {
        return List::from_value(old).get(1);
    }
    let realm = element.doc().realm(heap);
    let frozen = found.and_then(|it| {
        realm
            .freeze_array(
                realm
                    .create_array((0..it.len()).map(|at| it.get(at)), |heap, it| {
                        Ok(JsLocal::new(heap, it))
                    })
                    .ok()?,
            )
            .ok()
    });
    element.set_keyed(
        heap,
        Edge::FrozenElements,
        key_of(owner, name),
        found
            .zip(frozen)
            .map(|(a, b)| List::from_fn(heap, 2, |it| [a.to_js(), b.to_js()][it as usize]).to_js()),
    );
    frozen.map_or(JSValue::NULL, |it| it.to_js())
}

impl ReflectElement {
    pub(crate) fn get<'a>(&'a self, _: &JsHeap<'a>, name: Known) -> Option<&'a Element> {
        element(element_of(self), name)
    }

    pub(crate) fn set<'a>(&'a self, cx: Cx<'_, 'a>, name: Known, value: Option<&'a Element>) {
        set(cx, self, name, value.map(|_| DomString::default()));
        if value.is_some() {
            set_explicit_elements(
                &cx.heap,
                element_of(self),
                Owner::Element,
                name,
                value.map(Some),
            );
        }
    }
}

impl ReflectElements {
    pub(crate) fn get<'a>(&'a self, heap: &JsHeap<'a>, name: Known) -> JSValue {
        frozen_elements(heap, element_of(self), Owner::Element, name)
    }

    pub(crate) fn set<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        name: Known,
        value: Option<JsList<'a, &'a Element>>,
    ) {
        set(cx, self, name, value.map(|_| DomString::default()));
        if value.is_some() {
            set_explicit_elements(
                &cx.heap,
                element_of(self),
                Owner::Element,
                name,
                value.map(|it| it.iter()),
            );
        }
    }
}
