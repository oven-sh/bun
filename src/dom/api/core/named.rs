//! <https://html.spec.whatwg.org/#dom-document-nameditem> and <https://html.spec.whatwg.org/#named-access-on-the-window-object>

use core::cell::{Cell, RefCell};
use core::hash::Hash;

use bun_collections::hashbrown::hash_map::{Entry, EntryRef, HashMap};
use bun_core::WTFStringImplStruct as Impl;
use bun_jsc::bindgen::{JsHeap, JsInterface, JsScope, PropertyNames};
use bun_jsc::{JSGlobalObject, JSValue};
use smallvec::SmallVec;

use super::gc::global_of;
use super::{NodeFlags as F, *};
use crate::name::{Map, SecretHasher, Set};
use crate::tree::NodeId;

type Names = SmallVec<[Atom; 2]>;

unsafe extern "C" {
    safe fn Bun__DOM__announceNameInWindow(global: &JSGlobalObject, atom: Option<&Impl>);
    safe fn Bun__DOM__hearsOfNamesInWindow(global: &JSGlobalObject) -> bool;
}

pub(super) fn announce_id_in_window(heap: &JsHeap<'_>, id: impl FnOnce() -> Option<Atom>) {
    if Bun__DOM__hearsOfNamesInWindow(global_of(heap)) {
        announce_in_window(heap, id().as_ref());
    }
}

/// `None` is for any name.
pub(crate) fn announce_in_window(heap: &JsHeap<'_>, name: Option<&Atom>) {
    Bun__DOM__announceNameInWindow(global_of(heap), name.map(Atom::as_impl));
}

enum Bearers {
    One(NodeId),
    Many(Box<Many>),
}

enum Members {
    Few(SmallVec<[NodeId; FEW]>),
    Lots(Set<NodeId>),
}

impl Members {
    fn insert(&mut self, element: NodeId) {
        match self {
            Members::Few(few) if few.contains(&element) => {}
            Members::Few(few) if few.len() < FEW => few.push(element),
            Members::Few(few) => {
                *self = Members::Lots(few.iter().copied().chain([element]).collect())
            }
            Members::Lots(lots) => _ = lots.insert(element),
        }
    }

    /// Whether none is left.
    fn remove(&mut self, element: NodeId) -> bool {
        match self {
            Members::Few(few) => few.retain(|it| *it != element),
            Members::Lots(lots) => _ = lots.remove(&element),
        }
        self.iter().next().is_none()
    }

    fn iter(&self) -> impl Iterator<Item = &NodeId> {
        let (few, lots) = match self {
            Members::Few(few) => (&few[..], None),
            Members::Lots(lots) => (&[][..], Some(lots).filter(|it| !it.is_empty())),
        };
        few.iter().chain(lots.into_iter().flatten())
    }
}

struct Many {
    all: Members,
    /// In tree order, with the version of the tree.
    first: Cell<Option<(NodeId, u64)>>,
}

/// So many are compared with each other.
const FEW: usize = 8;

/// The elements of a tree that go by a name.
pub(super) struct Register<K>(RefCell<HashMap<K, Bearers, SecretHasher>>);

impl<K> Default for Register<K> {
    fn default() -> Self {
        Register(RefCell::default())
    }
}

impl<K: Hash + Eq> Register<K> {
    /// Whether it is the only one.
    pub(super) fn add(&self, name: K, element: NodeId) -> bool {
        match self.0.borrow_mut().entry(name) {
            Entry::Vacant(place) => {
                place.insert(Bearers::One(element));
                return true;
            }
            Entry::Occupied(mut found) => match found.get_mut() {
                Bearers::One(other) => {
                    *found.into_mut() = Bearers::Many(Box::new(Many {
                        all: Members::Few(SmallVec::from_slice(&[*other, element])),
                        first: Cell::new(None),
                    }))
                }
                Bearers::Many(many) => {
                    many.all.insert(element);
                    many.first.set(None);
                }
            },
        }
        false
    }

    pub(super) fn remove(&self, name: &K, element: NodeId) {
        let mut all = self.0.borrow_mut();
        let EntryRef::Occupied(mut found) = all.entry_ref(name) else {
            return;
        };
        let is_last = match found.get_mut() {
            Bearers::One(only) => *only == element,
            Bearers::Many(many) => {
                many.first.set(None);
                many.all.remove(element)
            }
        };
        if is_last {
            found.remove();
        }
    }

    /// They all have one of `keys`.
    #[inline]
    pub(super) fn first(
        &self,
        name: &K,
        scope: &Node,
        keys: impl FnOnce() -> u64,
    ) -> Option<NodeId> {
        match self.0.borrow().get(name)? {
            Bearers::One(only) => Some(*only),
            Bearers::Many(many) => {
                let version = scope.arena().version.get();
                let known = many.first.get().filter(|it| it.1 == version).map(|it| it.0);
                let first = known.or_else(|| {
                    scope.read(|tree, root| match &many.all {
                        Members::Few(few) => few
                            .iter()
                            .copied()
                            .filter(|it| tree[*it].scope == tree[root].scope)
                            .reduce(|a, b| if tree.precedes(a, b) { a } else { b }),
                        Members::Lots(lots) => tree
                            .descendants_with(root, keys())
                            .find(|it| lots.contains(it)),
                    })
                })?;
                many.first.set(Some((first, version)));
                Some(first)
            }
        }
    }

    /// No more than two.
    pub(super) fn some<'a>(
        &self,
        name: &K,
        scope: &'a Node,
        test: impl Fn(&Element) -> bool,
    ) -> SmallVec<[&'a Element; 2]> {
        let element = |it: &NodeId| scope.element_in_scope(*it).filter(|it| test(it));
        match self.0.borrow().get(name) {
            None => SmallVec::new(),
            Some(Bearers::One(only)) => element(only).into_iter().collect(),
            Some(Bearers::Many(many)) => many.all.iter().filter_map(element).take(2).collect(),
        }
    }
}

/// What has `NAMED` in the tree of a document.
#[derive(Default)]
struct Named {
    elements: Register<Atom>,
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
    let old = named.names.borrow_mut().remove(&id).unwrap_or_default();
    old.iter()
        .filter(|it| !new.contains(it))
        .for_each(|it| named.elements.remove(it, id));
    for name in new.iter().filter(|it| !old.contains(it)) {
        if named.elements.add(name.clone(), id) && doc.is(DocFlags::HAS_PAGE) {
            heap.announce_named_property(doc);
        }
        announce_in_window(heap, Some(name));
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
    fn all_that_match<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        cache: u8,
        name: &Atom,
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
        let named = self.exposed_names()?;
        let first = match *Atom::with_impl(name, |it| named.elements.some(it, self, |_| true)) {
            [] => return None,
            [only] => only,
            _ => {
                return Some(self.all_that_match(
                    &cx.heap,
                    11,
                    &Atom::from_impl(name),
                    |name, it| has_name(it, name),
                ));
            }
        };
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
        let named = self.try_extra::<Named>().map(|it| {
            it.elements
                .some(name, self, |it| has_name_in_window(it, name))
        });
        let mut found = self
            .some_elements_by_id(name)
            .into_iter()
            .chain(named.into_iter().flatten());
        let first = found.next()?;
        match found.all(|it| **it == **first) {
            true => Some(first.to_js()),
            false => {
                Some(self.all_that_match(heap, 12, name, |name, it| has_name_in_window(it, name)))
            }
        }
    }
}
