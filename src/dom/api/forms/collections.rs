//! The lists of controls and of options.

use bun_core::WTFStringImplStruct as Impl;
use bun_jsc::bindgen::{JsAtom, PropertyNames};

use super::*;
use crate::generated_bindgen::collections::js_HTMLCollection;
use crate::generated_bindgen::forms::{
    ElementOrIndex, HTMLFormControlsCollection, HTMLFormElement, HTMLOptionElement,
    HTMLOptionsCollection, OptionOrGroup, RadioNodeList, js_HTMLFormControlsCollection,
    js_RadioNodeList,
};
use crate::name::Map;

static ELEMENTS: Test = Test {
    bare: Bare::None,
    reads: Reads::Ties,
    matches: |it| is_listed(it) && input_type(it) != Some(InputType::Image),
    belongs: |form, it| form_owner(it).is_some_and(|it| **it == *form),
    lists: |form, add| {
        may_have_remote_owners(form) && {
            add.into_iter().for_each(|add| {
                form.as_element()
                    .into_iter()
                    .flat_map(controls_of)
                    .filter(|it| (ELEMENTS.matches)(it))
                    .for_each(add)
            });
            true
        }
    },
    ..Test::ALL
};

static IMAGES: Test = Test {
    tags: &[atom!("img")],
    matches: |it| it.kind() == Kind::Image,
    belongs: |form, it| {
        it.closest_html(atom!("form"))
            .is_some_and(|it| **it == *form)
    },
    ..Test::ALL
};

fn elements_of(form: &Node) -> &HTMLCollection {
    form.collection_at(
        Edge::Elements,
        js_HTMLFormControlsCollection::CLASS,
        &ELEMENTS,
    )
}

fn images_of(form: &Node) -> &HTMLCollection {
    form.collection_at(Edge::FormImages, js_HTMLCollection::CLASS, &IMAGES)
}

fn controls_or_images_named<'a>(form: &'a Node, name: &Atom) -> SmallVec<[&'a Element; 2]> {
    let controls = elements_of(form).named(name);
    if controls.is_empty() && form.may_have_below(atom!("img")) {
        images_of(form).named(name)
    } else {
        controls
    }
}

impl RadioNodeList {
    fn radios(&self) -> impl Iterator<Item = Input<'_>> {
        self.nodes()
            .filter_map(Node::as_element)
            .filter_map(Input::of)
            .filter(|it| it.kind() == InputType::Radio)
    }

    pub(crate) fn get_value(&self) -> DomString {
        self.radios()
            .find(|it| it.is_checked())
            .map(Input::value)
            .unwrap_or_default()
    }

    pub(crate) fn set_value<'a>(&'a self, cx: &mut Cx<'a>, value: &DomString) {
        if let Some(it) = self.radios().find(|it| it.value() == *value) {
            it.set_checked(cx, true);
        }
    }
}

impl HTMLFormControlsCollection {
    pub(crate) fn named_get<'a>(&'a self, heap: &JsHeap<'a>, name: &Impl) -> Option<JSValue> {
        let name = Atom::from_impl(name);
        match *self.named(&name) {
            [] => return None,
            [only] => return Some(only.to_js()),
            _ => {}
        }
        let filter = Filter::listed_by_name(name, |form, name, add| {
            elements_of(form).named(name).into_iter().for_each(add)
        });
        Some(NodeList::of_class(heap, js_RadioNodeList::CLASS, self.owner(), filter).to_js())
    }

    pub(crate) fn named_keys<'a>(&'a self, heap: &JsHeap<'a>, names: &mut PropertyNames) {
        HTMLCollection::named_keys(self, heap, names);
    }

    pub(crate) fn named_item<'a>(&'a self, heap: &JsHeap<'a>, name: JsAtom<'a>) -> JSValue {
        self.named_get(heap, name.get()).unwrap_or(JSValue::NULL)
    }
}

/// Where the names are in the lists at `Edge::PastNames` and `Edge::NamedLists`.
#[derive(Default)]
struct Names {
    past: RefCell<Map<Atom, u32>>,
    lists: RefCell<Map<Atom, u32>>,
}

impl HTMLFormElement {
    pub(crate) fn get_elements(&self, _: &JsHeap<'_>) -> JSValue {
        elements_of(self).to_js()
    }

    pub(crate) fn get_length(&self) -> u32 {
        elements_of(self).len()
    }

    pub(crate) fn indexed_get(&self, index: u32) -> Option<&Element> {
        elements_of(self).at(index)
    }

    fn list_named<'a>(&'a self, heap: &JsHeap<'a>, name: &Atom) -> JSValue {
        let (mut names, lists) = (
            self.extra::<Names>().lists.borrow_mut(),
            self.edge_list(heap, Edge::NamedLists),
        );
        if let Some(index) = names.get(name) {
            return lists.get(*index);
        }
        let filter = Filter::listed_by_name(name.clone(), |form, name, add| {
            controls_or_images_named(form, name)
                .into_iter()
                .for_each(add)
        });
        let list = NodeList::of_class(heap, js_RadioNodeList::CLASS, self, filter).to_js();
        names.insert(name.clone(), lists.len());
        lists.push(heap, list);
        list
    }

    /// https://html.spec.whatwg.org/#past-names-map
    fn once_named(&self, name: &Atom) -> Option<&Element> {
        let index = self
            .try_extra::<Names>()?
            .past
            .borrow()
            .get(name)
            .copied()?;
        let element = self
            .try_edge_list(Edge::PastNames)?
            .node(index)?
            .as_element()?;
        let owner = if element.is_html(atom!("img")) {
            element.closest_html(atom!("form"))
        } else {
            form_owner(element)
        };
        (owner == Some(self)).then_some(element)
    }

    /// https://html.spec.whatwg.org/#dom-form-nameditem
    pub(crate) fn named_get<'a>(&'a self, heap: &JsHeap<'a>, name: &Impl) -> Option<JSValue> {
        let name = Atom::from_impl(name);
        let only = match *controls_or_images_named(self, &name) {
            [] => return self.once_named(&name).map(|it| it.to_js()),
            [only] => only.to_js(),
            _ => return Some(self.list_named(heap, &name)),
        };
        let (mut names, elements) = (
            self.extra::<Names>().past.borrow_mut(),
            self.edge_list(heap, Edge::PastNames),
        );
        match *names.entry(name).or_insert_with(|| elements.len()) {
            index if index < elements.len() => elements.set(heap, index, only),
            _ => elements.push(heap, only),
        }
        Some(only)
    }

    pub(crate) fn named_keys<'a>(&'a self, heap: &JsHeap<'a>, names: &mut PropertyNames) {
        [elements_of(self), images_of(self)]
            .into_iter()
            .for_each(|it| it.named_keys(heap, names));
        let mut past: Vec<_> = self
            .try_extra::<Names>()
            .map(|it| it.past.borrow().clone())
            .unwrap_or_default()
            .into_iter()
            .collect();
        past.order_by_key(|it| it.1);
        past.iter()
            .filter(|it| self.once_named(&it.0).is_some())
            .for_each(|it| names.add(it.0.as_impl()));
    }
}

impl HTMLOptionsCollection {
    fn select(&self) -> Select<'_> {
        Select::new(self.owner().as_element().expect("made for a select"))
    }

    pub(crate) fn get_length(&self) -> u32 {
        self.len()
    }

    pub(crate) fn set_length<'a>(&'a self, cx: &mut Cx<'a>, length: u32) {
        self.select().set_length(cx, length);
    }

    pub(crate) fn indexed_get<'a>(
        &'a self,
        _: &mut Cx<'a>,
        index: u32,
    ) -> bindgen::Result<'a, Option<&'a Element>> {
        Ok(self.at(index))
    }

    pub(crate) fn indexed_set<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        index: u32,
        option: Option<&'a HTMLOptionElement>,
    ) -> bindgen::Result<'a, ()> {
        self.select().set_option(cx, index, option.map(|it| &***it))
    }

    pub(crate) fn get_selected_index(&self) -> i32 {
        self.select().selected_index()
    }

    pub(crate) fn set_selected_index<'a>(&'a self, cx: &mut Cx<'a>, index: i32) {
        self.select().set_selected_index(cx, index);
    }

    pub(crate) fn add<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        element: OptionOrGroup<'a>,
        before: Option<ElementOrIndex<'a>>,
    ) -> bindgen::Result<'a, ()> {
        self.select().add(cx, element, before)
    }

    pub(crate) fn remove<'a>(&'a self, cx: &mut Cx<'a>, index: i32) {
        self.select().remove(cx, index);
    }
}
