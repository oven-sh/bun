//! Many elements of one make.

use bun_jsc::bindgen::JsHeap;

use super::element::is_global;
use super::steps::Has;
use super::{Atom, Doc, DocFlags, DomString, Element, Kind, Known, NodeFlags as F, atom};
use crate::tree::{Attribute, Likeness, Namespace};

/// An HTML element on whose attributes no steps depend.
pub(crate) struct Mould {
    likeness: Likeness,
    kind: Kind,
    flags: F,
    has_style: bool,
    is_quirky: bool,
}

impl Mould {
    pub(crate) fn can_hold<'n>(
        doc: &Doc,
        tag: Known,
        mut names: impl Iterator<Item = &'n Atom>,
    ) -> bool {
        let has_steps =
            doc.arena().steps[Kind::of_html(tag) as usize].contains(Has::ATTRIBUTE_CHANGED);
        names.all(|it| *it == atom!("class") || !has_steps && !is_global(it))
    }

    pub(crate) fn new(
        doc: &Doc,
        tag: Known,
        attributes: impl Iterator<Item = (Atom, DomString)>,
    ) -> Mould {
        let (is_quirky, mut flags, mut has_style) = (doc.quirks(), F::empty(), false);
        let likeness = doc.arena().write(|engine| {
            let id = engine.create_element(tag.into(), Namespace::Html, None);
            for (name, value) in attributes {
                flags |= if name == atom!("id") && !value.is_empty() {
                    F::HAS_ID
                } else {
                    F::empty()
                };
                has_style |= name == atom!("style");
                engine.change_attribute(id, Err((name, None)), Some(value.into()), is_quirky);
            }
            let likeness = engine.likeness_of(id);
            engine.tree.free(id);
            likeness
        });
        Mould {
            likeness: likeness.expect("of an element"),
            kind: Kind::of_html(tag),
            flags,
            has_style,
            is_quirky,
        }
    }

    pub(crate) fn attributes(&self) -> &[Attribute] {
        &self.likeness.attributes
    }

    #[inline]
    pub(crate) fn fits(&self, doc: &Doc) -> bool {
        self.is_quirky == doc.quirks()
            && !(self.has_style && doc.is(DocFlags::CHECKS_STYLE_ATTRIBUTES))
    }

    pub(crate) fn local(&self) -> Known {
        self.likeness.local.known()
    }

    pub(crate) fn has_id(&self) -> bool {
        self.flags.contains(F::HAS_ID)
    }

    #[inline]
    pub(crate) fn create_slot(
        &self,
        engine: &mut crate::document::Document,
    ) -> crate::tree::NodeId {
        engine.create_like(self.likeness.clone())
    }

    #[inline]
    pub(crate) fn create<'a>(&self, heap: &JsHeap<'a>, doc: &'a Doc) -> &'a Element {
        let element = doc.create_of_kind(heap, self.kind, |engine| self.create_slot(engine));
        element.set(self.flags);
        element
    }
}
