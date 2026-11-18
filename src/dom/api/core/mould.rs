//! Many elements of one make.

use bun_jsc::bindgen::JsHeap;

use super::element::is_global;
use super::steps::Has;
use super::{Atom, Doc, DocFlags, DomString, Element, Kind, Known, NodeFlags as F, atom};
use crate::document::{Above, Document};
use crate::name::Name;
use crate::selector::filter_of;
use crate::tree::{Attribute, Likeness, Namespace, NodeId, State};

/// An HTML element on whose attributes no steps depend.
pub(crate) struct Mould {
    likeness: Likeness,
    kind: Kind,
    flags: F,
    has_style: bool,
    is_quirky: bool,
    own_state: Option<State>,
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
        attributes: impl ExactSizeIterator<Item = (Atom, DomString)>,
    ) -> Mould {
        let (is_quirky, mut flags, mut has_style) = (doc.quirks(), F::empty(), false);
        let (likeness, own_state) = doc.arena().write(|engine| {
            let attributes = attributes.map(|(name, value)| {
                has_style |= name == atom!("style");
                (name, value.into())
            });
            let mut element =
                engine.element_with(tag.into(), Namespace::Html, attributes, is_quirky);
            flags.set(F::HAS_ID, element.id != Name::NONE);
            let keys = filter_of(&element);
            (Likeness::of(&mut element, keys), element.own_state())
        });
        Mould {
            likeness,
            kind: Kind::of_html(tag),
            flags,
            has_style,
            is_quirky,
            own_state,
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

    #[inline(always)]
    pub(crate) fn append_bare(
        &self,
        engine: &mut Document,
        parent: NodeId,
        above: Above,
    ) -> Result<NodeId, NodeId> {
        let element = engine.element_like(&self.likeness);
        engine.append_bare_element(parent, above, element, self.likeness.keys, self.own_state)
    }

    #[inline]
    pub(crate) fn create<'a>(&self, heap: &JsHeap<'a>, doc: &'a Doc) -> &'a Element {
        let element = doc.create_of_kind(heap, self.kind, |engine| {
            engine.create_like(self.likeness.clone())
        });
        element.set(self.flags);
        element
    }
}
