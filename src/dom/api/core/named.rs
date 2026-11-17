//! <https://html.spec.whatwg.org/#dom-document-nameditem> and <https://html.spec.whatwg.org/#named-access-on-the-window-object>

use core::cell::RefCell;

use bun_core::WTFStringImplStruct as Impl;
use bun_jsc::bindgen::{JsHeap, JsInterface, JsScope, PropertyNames};
use bun_jsc::{JSGlobalObject, JSValue};
use smallvec::SmallVec;

use super::gc::global_of;
use super::{NodeFlags as F, *};
use crate::name::Map;
use crate::tree::NodeId;

type Names = SmallVec<[Atom; 2]>;

unsafe extern "C" {
    safe fn Bun__DOM__announceNameInWindow(global: &JSGlobalObject, atom: Option<&Impl>);
}

/// `None` is for any name.
pub(crate) fn announce_in_window(heap: &JsHeap<'_>, name: Option<&Atom>) {
    Bun__DOM__announceNameInWindow(global_of(heap), name.map(Atom::as_impl));
}

/// What has `NAMED` in the tree of a document.
#[derive(Default)]
struct Named {
    elements: RefCell<Map<Atom, SmallVec<[NodeId; 1]>>>,
    names: RefCell<Map<NodeId, Names>>,
}

fn names_of(element: &Element) -> Names {
    let id = if matches!(element.kind(), Kind::Object | Kind::Image) {
        element.attr(atom!("id"))
    } else {
        None
    };
    let mut names: Names = [id, element.attr(atom!("name"))]
        .iter()
        .flatten()
        .filter(|it| !it.is_empty())
        .map(Atom::from_string)
        .collect();
    names.dedup();
    names
}

pub(super) fn changed<'a>(heap: &JsHeap<'a>, element: &'a Element) {
    let (doc, id) = (element.doc(), element.id());
    let new = if element.has(F::NAMED) && element.scope() == Some(doc) {
        names_of(element)
    } else {
        Names::new()
    };
    let Some(named) = (if new.is_empty() {
        doc.try_extra::<Named>()
    } else {
        Some(doc.extra())
    }) else {
        return;
    };
    let mut elements = named.elements.borrow_mut();
    for name in named.names.borrow_mut().remove(&id).unwrap_or_default() {
        if let Some(all) = elements.get_mut(&name) {
            all.retain(|it| *it != id);
            if all.is_empty() {
                elements.remove(&name);
            }
        }
    }
    for name in &new {
        let all = elements.entry(name.clone()).or_default();
        if all.is_empty() && doc.is(DocFlags::HAS_PAGE) {
            heap.announce_named_property(doc);
        }
        announce_in_window(heap, Some(name));
        all.push(id);
    }
    if !new.is_empty() {
        named.names.borrow_mut().insert(id, new);
    }
}

fn has_name(element: &Element, name: &Atom) -> bool {
    element.has(F::NAMED) && names_of(element).contains(name)
}

fn has_name_in_window(element: &Element, name: &Atom) -> bool {
    let is = |attribute: Known| {
        element.with_attr_string(attribute, |it| *it == name.to_dom_string()) == Some(true)
    };
    element.has(F::HAS_ID) && is(atom!("id"))
        || element.has(F::NAMED) && element.kind() != Kind::IFrame && is(atom!("name"))
}

impl Doc {
    fn elements_named(&self, name: &Atom) -> impl Iterator<Item = &Element> {
        let found = self
            .try_extra::<Named>()
            .and_then(|it| it.elements.borrow().get(name).cloned());
        found
            .into_iter()
            .flatten()
            .filter_map(|it| self.element_in_scope(it))
    }

    fn all_that_match<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        cache: u8,
        name: Atom,
        matches: fn(&Atom, &Element) -> bool,
    ) -> JSValue {
        self.cached_collection(heap, cache, name, |it| {
            HTMLCollection::new(heap, self, Filter::DescendantsByName(it.clone(), matches)).to_js()
        })
    }

    /// As in Chromium, markup cannot replace the members of a document that a sanitizer works on.
    fn exposed_names(&self) -> Option<&Named> {
        self.try_extra::<Named>()
            .filter(|it| self.is(DocFlags::HAS_PAGE) && !it.names.borrow().is_empty())
    }

    pub(crate) fn names_were_exposed(&self, heap: &JsHeap<'_>) {
        if self.exposed_names().is_some() {
            heap.announce_named_property(self);
        }
        announce_in_window(heap, None);
    }

    pub(crate) fn named_get<'a>(&'a self, cx: &mut JsScope<'a>, name: &Impl) -> Option<JSValue> {
        self.exposed_names()?;
        let name = Atom::from_impl(name);
        let mut found = self.elements_named(&name);
        let first = found.next()?;
        if found.next().is_some() {
            return Some(
                self.all_that_match(&cx.heap, 11, name.clone(), |name, it| has_name(it, name)),
            );
        }
        let window = if first.kind() == Kind::IFrame {
            crate::api::frames::content_window(cx, first)
        } else {
            None
        };
        Some(window.unwrap_or_else(|| first.to_js()))
    }

    pub(crate) fn named_keys<'a>(&'a self, _: &mut JsScope<'a>, keys: &mut PropertyNames) {
        if self.exposed_names().is_some() {
            self.elements_with_objects()
                .filter(|it| it.has(F::NAMED))
                .flat_map(names_of)
                .for_each(|it| keys.add(it.as_impl()));
        }
    }

    /// An element or a collection.
    pub(crate) fn named_in_window<'a>(&'a self, heap: &JsHeap<'a>, name: &Atom) -> Option<JSValue> {
        let mut found = self.elements_by_id(name).chain(
            self.elements_named(name)
                .filter(|it| has_name_in_window(it, name)),
        );
        let first = found.next()?;
        match found.all(|it| **it == **first) {
            true => Some(first.to_js()),
            false => Some(self.all_that_match(heap, 12, name.clone(), |name, it| {
                has_name_in_window(it, name)
            })),
        }
    }
}
