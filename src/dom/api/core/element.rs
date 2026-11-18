//! Elements and their attributes.

use core::borrow::Borrow;
use std::rc::Rc;

use bun_jsc::JSString;
use bun_jsc::bindgen::{self, JsHeap, JsLocal, JsScope};
use smallvec::SmallVec;

use super::atom::{AtomKey, qualified};
use super::atoms::TEXTS;
use super::steps::{AttrChange, Has};
use super::{NodeFlags as F, *};
use crate::document::Document;
use crate::name::Name;
use crate::selector::Pseudo;
use crate::tree::{self, Attribute, Inert, Namespace, NodeId, Space, State};

/// Of `bits_of_kind`. The others are for `known_name`.
pub(super) const OWN_BITS: u32 = 4;

/// The `bits_of_kind` of a new element with that qualified name.
#[inline(always)]
pub(super) const fn bits_for(name: Known) -> u16 {
    const { assert!((Known::Other as u16) < u16::MAX >> OWN_BITS) };
    (name as u16 + 1) << OWN_BITS
}

impl Attribute {
    #[inline]
    pub(crate) fn is_visible(&self) -> bool {
        self.space.as_ref().is_none_or(|it| !it.is_hidden)
    }

    pub(crate) fn qual_name(&self) -> QualName {
        match &self.space {
            Some(space) => {
                QualName::parsed(space.ns.clone(), space.prefix.clone(), self.local.clone())
            }
            None => QualName::plain(&self.local),
        }
    }

    fn has_qualified_name(&self, name: &Atom) -> bool {
        match &self.space {
            None => self.local == *name,
            Some(space) => {
                !space.is_hidden && qualified(space.prefix.as_ref(), &self.local) == *name
            }
        }
    }
}

impl Document {
    /// What scripts see. SMIL puts other values in the place of those that it animates.
    #[inline]
    pub(crate) fn script_value<R>(
        &self,
        id: NodeId,
        attribute: &Attribute,
        read: impl FnOnce(&DomString) -> R,
    ) -> Option<R> {
        let base;
        Some(read(match self.smil.effects.bases.is_empty() {
            true => attribute.value.string(),
            false => {
                base = self.value_without_smil(id, attribute)?;
                &base
            }
        }))
    }

    #[cold]
    #[inline(never)]
    fn value_without_smil(&self, id: NodeId, attribute: &Attribute) -> Option<DomString> {
        match self.smil.effects.bases.get(&(id, attribute.name)) {
            Some((_, base)) => base.as_ref().map(|it| DomString::from_utf8(it)),
            None => Some(attribute.value.string().clone()),
        }
    }

    #[inline]
    fn set_script_value(
        &mut self,
        id: NodeId,
        place: Result<usize, (Atom, Option<Rc<Space>>)>,
        value: Option<&DomString>,
        is_quirky: bool,
    ) {
        if !self.smil.effects.bases.is_empty()
            && let Some(name) = place
                .as_ref()
                .ok()
                .and_then(|it| Some(self.tree.element(id)?.attributes[*it].name))
            && let Some(base) = self.smil.effects.bases.get_mut(&(id, name))
        {
            (base.1, self.smil.needs_update) = (value.map(|it| it.to_utf8().into()), true);
            return;
        }
        if let (Err((local, None)), Some(value)) = (&place, value)
            && *local == atom!("class")
            && self.set_only_class(id, value, is_quirky)
        {
            return;
        }
        self.change_attribute(id, place, value.map(|it| it.clone().into()), is_quirky);
    }
}

/// It has steps that all elements share.
#[inline]
pub(super) fn is_global(name: &Atom) -> bool {
    match name.known() {
        Known::Other => is_handler(name),
        name => name.meaning().contains(Meaning::STEPS),
    }
}

#[inline]
fn is_handler(name: &Atom) -> bool {
    match name.as_known() {
        Some(text) => text.starts_with("on"),
        None => name.as_impl().is_8bit() && name.as_impl().latin1_slice().starts_with(b"on"),
    }
}

impl Node {
    #[inline]
    pub(crate) fn attributes_changed(&self) {
        self.arena().attribute_version.update(|it| it + 1);
    }

    /// What elements are called or belong to, though no attribute has changed.
    pub(crate) fn ties_changed(&self) {
        self.arena().ties_changed();
    }

    pub(crate) fn with_inert<R>(&self, read: impl FnOnce(&Inert) -> R) -> R {
        self.read(|tree, id| match &tree[id].data {
            tree::Data::Inert(inert) => read(inert),
            _ => unreachable!(),
        })
    }

    pub(super) fn change_inert(&self, change: impl FnOnce(&mut Inert)) {
        self.arena().write(|engine| {
            if let tree::Data::Inert(inert) = &mut engine.tree[self.id()].data {
                change(inert);
            }
        });
    }
}

impl Element {
    #[inline(always)]
    pub(crate) fn with<R>(&self, read: impl FnOnce(&tree::Element) -> R) -> R {
        self.read(|tree, id| read(tree.element(id).expect("an element has such a slot")))
    }

    #[inline]
    pub(crate) fn local(&self) -> Atom {
        self.with(|it| it.local.clone())
    }

    /// Of the local name, in any namespace.
    #[inline]
    pub(crate) fn tag(&self) -> Known {
        self.with(|it| it.local.known())
    }

    pub(crate) fn ns(&self) -> Ns {
        self.with(|it| match it.namespace {
            Namespace::Html => Ns::Html,
            Namespace::Svg => Ns::Svg,
            Namespace::MathMl => Ns::MathMl,
            Namespace::Other => it.space.as_ref().map_or(Ns::None, |it| it.ns.clone()),
        })
    }

    pub(crate) fn prefix(&self) -> Option<Atom> {
        self.with(|it| it.space.as_ref()?.prefix.clone())
    }

    pub(crate) fn set_prefix(&self, prefix: Option<Atom>) {
        let space = Space::new(self.ns(), prefix);
        self.bits_of_kind().update(|it| it % (1 << OWN_BITS));
        self.arena().write(|engine| {
            engine
                .tree
                .element_mut(self.id())
                .map(|it| it.rare_mut().space = Some(space))
        });
    }

    pub(crate) fn qual_name(&self) -> QualName {
        QualName::parsed(self.ns(), self.prefix(), self.local())
    }

    pub(crate) fn qualified_name(&self) -> Atom {
        self.with(|it| {
            qualified(
                it.space.as_ref().and_then(|it| it.prefix.as_ref()),
                &it.local,
            )
        })
    }

    #[inline]
    pub(crate) fn has_qualified_name(&self, name: &Atom) -> bool {
        self.with(
            |it| match it.space.as_ref().and_then(|it| it.prefix.as_ref()) {
                None => it.local == *name,
                prefix => qualified(prefix, &it.local) == *name,
            },
        )
    }

    /// An HTML element in an HTML document.
    #[inline]
    pub(crate) fn ignores_case(&self) -> bool {
        self.kind().is_html() && self.doc().is_html_doc()
    }

    /// Of the qualified name.
    #[inline(always)]
    fn known_name(&self) -> Known {
        match self.bits_of_kind().get() >> OWN_BITS {
            0 => self.remember_name(),
            name => Known::from_index(name - 1),
        }
    }

    #[cold]
    fn remember_name(&self) -> Known {
        let name = if self.prefix().is_some() {
            Known::Other
        } else {
            self.tag()
        };
        self.bits_of_kind().update(|it| it | bits_for(name));
        name
    }

    /// For the steps of its kind.
    #[inline]
    pub(crate) fn own_bit(&self) -> bool {
        self.bits_of_kind().get() & 1 != 0
    }

    #[inline]
    pub(crate) fn set_own_bit(&self, on: bool) {
        self.bits_of_kind().update(|it| it & !1 | u16::from(on));
    }

    #[inline]
    pub(super) fn tag_name_to_js<'a>(&self, heap: &JsHeap<'a>) -> JsLocal<'a, JSString> {
        match self.known_name() {
            Known::Other => self.tag_name().to_js(heap),
            name => super::string::known_to_js(heap, name, self.ignores_case()),
        }
    }

    #[inline]
    pub(super) fn local_name_to_js<'a>(&self, heap: &JsHeap<'a>) -> JsLocal<'a, JSString> {
        match self.known_name() {
            Known::Other => self.with(|it| it.local.to_js(heap)),
            name => super::string::known_to_js(heap, name, false),
        }
    }

    pub(crate) fn tag_name(&self) -> Atom {
        if self.ignores_case() {
            self.qualified_name().to_ascii_uppercase()
        } else {
            self.qualified_name()
        }
    }

    #[inline]
    pub(super) fn may_be_custom(&self) -> bool {
        matches!(self.kind(), Kind::HtmlElement | Kind::FormAssociated)
            && Kind::of_html(self.tag()) == Kind::Unknown
    }

    #[inline]
    pub(crate) fn flush_style<'a>(&'a self, _: &mut JsScope<'a>) {
        self.serialize_style();
    }

    #[inline]
    pub(super) fn serialize_style(&self) {
        if self.has(F::STYLE_DIRTY) {
            seams::flush_style(self);
        }
    }

    #[inline(always)]
    fn find<R>(
        &self,
        is_it: impl Fn(&Attribute) -> bool,
        read: impl FnOnce(&DomString) -> R,
    ) -> Option<R> {
        self.arena().read(|engine| {
            engine.script_value(
                self.id(),
                engine
                    .tree
                    .element(self.id())?
                    .attributes
                    .iter()
                    .find(|it| is_it(it))?,
                read,
            )
        })
    }

    /// In no namespace. For `style`, after `flush_style`.
    #[inline]
    pub(crate) fn attr(&self, name: impl AtomKey) -> Option<DomString> {
        self.with_attr_string(name, DomString::clone)
    }

    #[inline]
    pub(crate) fn with_attr_string<R>(
        &self,
        name: impl AtomKey,
        read: impl FnOnce(&DomString) -> R,
    ) -> Option<R> {
        self.find(move |it| it.local.is(&name) && it.space.is_none(), read)
    }

    #[inline]
    pub(crate) fn with_attr<R>(
        &self,
        name: impl AtomKey,
        read: impl FnOnce(&str) -> R,
    ) -> Option<R> {
        self.with_attr_string(name, |it| read(&it.to_utf8()))
    }

    #[inline]
    pub(crate) fn has_attr(&self, name: impl AtomKey) -> bool {
        self.with_attr_string(name, |_| ()).is_some()
    }

    /// In any namespace.
    #[inline]
    pub(crate) fn has_any_attr(&self, names: &[Known]) -> bool {
        self.with(|it| {
            it.attributes
                .iter()
                .any(|it| names.contains(&it.local.known()))
        })
    }

    pub(crate) fn attr_ns(&self, ns: &Ns, local: &Atom) -> Option<DomString> {
        self.find(|it| Element::is_named(it, ns, local), DomString::clone)
    }

    fn is_named(it: &Attribute, ns: &Ns, local: &Atom) -> bool {
        it.local == *local
            && it.is_visible()
            && it.space.as_ref().map_or(&Ns::None, |it| &it.ns) == ns
    }

    /// The name of the one that it has.
    pub(crate) fn has_href(&self) -> bool {
        self.has_attr(atom!("href")) || self.attr_ns(&Ns::XLink, &Atom::of(atom!("href"))).is_some()
    }

    pub(crate) fn attr_name_ns(&self, ns: &Ns, local: &Atom) -> Option<QualName> {
        self.attr_ns(ns, local)?;
        self.with(|it| {
            it.attributes
                .iter()
                .find(|it| Element::is_named(it, ns, local))
                .map(Attribute::qual_name)
        })
    }

    /// Of the first one with that qualified name.
    pub(crate) fn attr_name_by_qualified_name(&self, name: &Atom) -> Option<QualName> {
        match self.has(F::HAS_NAMESPACED_ATTR) {
            true => self.with(|it| {
                it.attributes
                    .iter()
                    .find(|it| it.has_qualified_name(name))
                    .map(Attribute::qual_name)
            }),
            false => self.has_attr(name).then(|| QualName::plain(name)),
        }
    }

    #[inline]
    pub(crate) fn attr_by_qualified_name(&self, name: &Atom) -> Option<DomString> {
        match self.has(F::HAS_NAMESPACED_ATTR) {
            true => self.find(|it| it.has_qualified_name(name), DomString::clone),
            false => self.attr(name),
        }
    }

    /// `visit` is under the rules of `read`.
    #[inline]
    pub(crate) fn for_each_attr(&self, mut visit: impl FnMut(&Attribute, &DomString)) {
        self.arena().read(|engine| {
            for it in engine
                .tree
                .element(self.id())
                .into_iter()
                .flat_map(|it| &it.attributes)
                .filter(|it| it.is_visible())
            {
                engine.script_value(self.id(), it, |value| visit(it, value));
            }
        });
    }

    pub(crate) fn attrs(&self) -> SmallVec<[(QualName, DomString); 4]> {
        let mut all = SmallVec::new();
        self.for_each_attr(|it, value| all.push((it.qual_name(), value.clone())));
        all
    }

    pub(crate) fn attr_count(&self) -> u32 {
        let mut count = 0;
        self.for_each_attr(|_, _| count += 1);
        count
    }

    /// No steps depend on them, and they are what the engine has.
    #[inline]
    pub(super) fn has_only_passive_attributes(&self) -> bool {
        let has_steps = self.steps().contains(Has::ATTRIBUTE_CHANGED);
        self.arena()
            .read(|engine| engine.smil.effects.bases.is_empty())
            && !self.doc().is(DocFlags::CHECKS_STYLE_ATTRIBUTES)
            && self.with(|it| {
                it.attributes.iter().all(|it| {
                    it.local == atom!("class")
                        || !has_steps && it.is_visible() && !is_global(&it.local)
                })
            })
    }

    /// In no namespace.
    #[inline]
    pub(crate) fn set_attr<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        name: impl Into<Atom>,
        value: impl Borrow<DomString>,
    ) {
        self.change_attr(cx, &QualName::plain(name), Some(value.borrow()));
    }

    /// One that exists keeps its prefix.
    pub(crate) fn set_attr_ns<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        name: impl Borrow<QualName>,
        value: impl Borrow<DomString>,
    ) {
        self.change_attr(cx, name.borrow(), Some(value.borrow()));
    }

    pub(crate) fn remove_attr<'a>(&'a self, cx: &mut JsScope<'a>, name: impl Into<Atom>) -> bool {
        self.change_attr(cx, &QualName::plain(name), None)
    }

    pub(crate) fn remove_attr_ns<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        name: impl Borrow<QualName>,
    ) -> bool {
        self.change_attr(cx, name.borrow(), None)
    }

    pub(crate) fn toggle_attr<'a>(&'a self, cx: &mut JsScope<'a>, name: impl Into<Atom>, on: bool) {
        let name = name.into();
        if on != self.has_attr(&name) {
            self.change_attr(
                cx,
                &QualName::plain(name),
                on.then(DomString::default).as_ref(),
            );
        }
    }

    /// To a string of a script.
    #[inline]
    pub(crate) fn set_attr_to_impl<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        name: &Atom,
        value: &bun_core::WTFStringImplStruct,
    ) {
        if !self.store_any_unnoticed(name.known(), value) {
            self.set_noticed_attr(cx, name, value);
        }
    }

    /// Likewise, for a name that is a constant.
    #[inline(always)]
    pub(super) fn set_known_attr<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        name: Known,
        value: &bun_core::WTFStringImplStruct,
    ) {
        if !DomString::with_impl(
            value,
            #[inline(always)]
            |it| self.store_unnoticed(name, it),
        ) {
            self.set_noticed_attr(cx, &name.into(), value);
        }
    }

    fn store_any_unnoticed(&self, name: Known, value: &bun_core::WTFStringImplStruct) -> bool {
        DomString::with_impl(
            value,
            #[inline(always)]
            |it| self.store_unnoticed(name, it),
        )
    }

    #[inline(never)]
    fn set_noticed_attr<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        name: &Atom,
        value: &bun_core::WTFStringImplStruct,
    ) {
        if DomString::with_impl(value, |it| self.store_attr(cx, name, Some(it))).is_none() {
            self.change_attr_with_steps(
                cx,
                &QualName::plain(name),
                Some(&DomString::from_impl(value)),
            );
        }
    }

    /// Whether it was enough to store the value.
    #[inline(always)]
    fn store_unnoticed(&self, name: Known, value: &DomString) -> bool {
        let (doc, meaning) = (self.doc(), name.meaning());
        if meaning.intersects(Meaning::STEPS | Meaning::OTHER)
            || self.has(F::CUSTOM | F::HAS_EXPLICIT_ELEMENTS | F::HAS_ATTR_NODES)
            || !self.kind().is_html()
            || doc.is(DocFlags::OBSERVES_ATTRIBUTES | DocFlags::RECORDS_EDITS)
            || name != atom!("class") && self.steps().contains(Has::ATTRIBUTE_CHANGED)
        {
            return false;
        }
        let may_change = name != atom!("id")
            || !self.has(F::CONNECTED | F::NAMED) && self.kind() != Kind::Object;
        let Some(has_changed) = self.arena().write(
            #[inline(always)]
            |engine| {
                engine.store_attribute(
                    self.id(),
                    name,
                    value,
                    self.is_rendered(),
                    may_change,
                    doc.quirks(),
                )
            },
        ) else {
            return false;
        };
        if has_changed {
            self.attributes_changed();
            self.arena().record_attribute(self, &name.into());
            if name == atom!("id") {
                self.toggle(F::HAS_ID, !value.is_empty());
            }
        }
        true
    }

    /// Whether it had one.
    #[inline]
    fn change_attr<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        name: &QualName,
        new: Option<&DomString>,
    ) -> bool {
        let stored = if name.ns == Ns::None {
            self.store_attr(cx, &name.local, new)
        } else {
            None
        };
        stored.unwrap_or_else(|| self.change_attr_with_steps(cx, name, new))
    }

    /// `change_attr`, unless something but the engine has to hear of it.
    fn store_attr<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        name: &Atom,
        new: Option<&DomString>,
    ) -> Option<bool> {
        let (doc, id, is_id) = (self.doc(), self.id(), *name == atom!("id"));
        if self.has(F::CUSTOM | F::HAS_EXPLICIT_ELEMENTS | F::HAS_ATTR_NODES)
            || self.has_observed_attribute(name)
            || *name != atom!("class")
                && (self.steps().contains(Has::ATTRIBUTE_CHANGED)
                    || matches!(name.known(), atom!("style") | atom!("form"))
                    || is_global(name))
        {
            return None;
        }
        let (index, is_same) = self.arena().read(|engine| {
            let attributes = engine.tree.element(id).map_or(&[][..], |it| &it.attributes);
            let index = attributes
                .iter()
                .position(|it| it.local == *name && it.space.is_none());
            (
                index,
                index.and_then(|it| {
                    engine.script_value(id, &attributes[it], |old| Some(old) == new)
                }),
            )
        });
        match is_same {
            Some(true) => return Some(true),
            None if new.is_none() => return Some(false),
            _ if is_id => return None,
            _ => {}
        }
        self.attributes_changed();
        self.arena().record_attribute(self, name);
        if self.tell_engine(index.ok_or_else(|| (name.clone(), None)), new) {
            doc.invalidate(cx);
        }
        Some(is_same.is_some())
    }

    /// Whether a frame has to be asked for.
    #[inline]
    fn tell_engine(
        &self,
        place: Result<usize, (Atom, Option<Rc<Space>>)>,
        new: Option<&DomString>,
    ) -> bool {
        let doc = self.doc();
        self.change(|engine, id| {
            engine.set_script_value(id, place, new, doc.quirks());
            self.is_rendered()
                && !self.arena().is_scheduled.get()
                && (doc.is(DocFlags::IS_ACCESSIBLE)
                    || if self.kind().is_svg() {
                        engine.needs_attention()
                    } else {
                        engine.has_pending()
                    })
        })
    }

    fn change_attr_with_steps<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        name: &QualName,
        new: Option<&DomString>,
    ) -> bool {
        let is_plain = name.ns == Ns::None;
        // It is looked up.
        let atom = new
            .filter(|_| is_plain && name.local == atom!("name"))
            .map(|it| Atom::from_string(it).to_dom_string());
        let new = atom.as_ref().or(new);
        if is_plain && name.local == atom!("style") {
            self.flush_style(cx);
        }
        let (doc, id) = (self.doc(), self.id());
        let (index, old) = self.arena().read(|engine| {
            let attributes = engine.tree.element(id).map_or(&[][..], |it| &it.attributes);
            let index = attributes.iter().position(|it| {
                if is_plain {
                    it.local == name.local && it.space.is_none()
                } else {
                    Element::is_named(it, &name.ns, &name.local)
                }
            });
            (
                index,
                index.and_then(|it| engine.script_value(id, &attributes[it], DomString::clone)),
            )
        });
        if old.is_none() && new.is_none() {
            return false;
        }
        if let Some(attr) = old
            .as_ref()
            .filter(|_| new.is_none())
            .and_then(|_| self.existing_attr_node(name))
        {
            attr.detach(&cx.heap, self);
        }
        self.attributes_changed();
        self.arena().record_attribute(self, &name.local);
        if !is_plain {
            self.set(F::HAS_NAMESPACED_ATTR);
        }
        let needs_frame = old.as_ref() != new
            && self.tell_engine(
                index.ok_or_else(|| {
                    (
                        name.local.clone(),
                        (!is_plain).then(|| Space::new(name.ns.clone(), name.prefix.clone())),
                    )
                }),
                new,
            );
        self.run_attribute_steps(
            cx,
            &AttrChange {
                name,
                old: old.as_ref(),
                new,
            },
        );
        if needs_frame {
            doc.invalidate(cx);
        }
        old.is_some()
    }

    #[inline]
    /// Whether it was enough to store the value.
    pub(super) fn set_attribute_unnoticed<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        name: bindgen::JsLocal<'a, bun_jsc::JSString>,
        value: bindgen::JsLocal<'a, bun_jsc::JSString>,
    ) -> bindgen::Result<'a, bool> {
        if !self.ignores_case()
            || self.has(F::CUSTOM | F::HAS_NAMESPACED_ATTR | F::HAS_EXPLICIT_ELEMENTS)
            || self.doc().is(DocFlags::IS_ACCESSIBLE)
        {
            return Ok(false);
        }
        let value = super::string::impl_of(heap, value)?;
        Atom::with_lowercased_and_keyed(heap, name, |local, name| {
            if name == Name::NONE {
                return !crate::api::trusted::is_required()
                    && self.store_any_unnoticed(local.known(), value);
            }
            self.attributes_changed();
            let store = |value: &DomString| {
                self.arena().write(|engine| {
                    if self.is_rendered() {
                        engine.change_attribute_unnoticed(self.id(), local, value)
                    } else {
                        engine.set_keyed_attribute(self.id(), local, name, value)
                    }
                })
            };
            !self.has_observed_attribute(local) && DomString::with_impl(value, store)
        })
    }

    fn run_attribute_steps<'a>(&'a self, cx: &mut JsScope<'a>, change: &AttrChange<'_>) {
        let AttrChange { name, old, new } = *change;
        let doc = self.doc();
        if self.has_observed_attribute(&name.local) {
            queue_mutation_record(&cx.heap, self, Record::Attribute { name, old });
        }
        if self.has(F::CUSTOM) {
            custom::attribute_changed(cx, self, change);
        }
        if name.ns != Ns::None {
            if name.ns == Ns::XLink
                && self.kind().is_svg()
                && self.steps().contains(Has::ATTRIBUTE_CHANGED)
            {
                seams::attribute_changed(cx, self, change);
            }
            return;
        }
        if self.has(F::HAS_EXPLICIT_ELEMENTS) {
            reflect::attribute_changed(&cx.heap, self, name.local.known());
        }
        match name.local.known() {
            atom!("class") => return,
            atom!("id") => {
                let (old, new) = (
                    old.filter(|it| !it.is_empty()),
                    new.filter(|it| !it.is_empty()),
                );
                self.toggle(F::HAS_ID, new.is_some());
                if let Some(scope) = self.scope().filter(|_| old != new) {
                    old.into_iter().for_each(|it| {
                        scope.remove_id(Name::sought(it.to_utf8().as_bytes()), self.id())
                    });
                    new.into_iter().for_each(|it| {
                        scope.add_id(&cx.heap, Name::sought(it.to_utf8().as_bytes()), self.id())
                    });
                    if doc.is(DocFlags::WATCHES_IDS) {
                        old.into_iter()
                            .chain(new)
                            .for_each(|it| doc.id_changed(cx, &Atom::from_string(it)));
                    }
                    if self.arena().has_remote_owners.get() {
                        old.into_iter()
                            .chain(new)
                            .for_each(|it| crate::api::forms::id_changed(cx, scope, it));
                    }
                    if old.is_some() {
                        crate::api::ui::interest::id_changed(cx, self);
                    }
                }
                if self.has(F::NAMED) || self.kind() == Kind::Object {
                    self.name_changed(cx);
                }
            }
            atom!("name") => self.name_changed(cx),
            atom!("style") => {
                if doc.is(DocFlags::CHECKS_STYLE_ATTRIBUTES) && !self.has(F::USER_AGENT) {
                    page::style_attribute_changed(cx, self, change.new);
                }
                return;
            }
            atom!("slot") => {
                if let Some(shadow) = self.parent_element().and_then(Element::shadow_root) {
                    slots::slot_attribute_changed(cx, shadow, self);
                }
            }
            atom!("form") if crate::api::forms::is_listed(self) => {
                self.arena().has_remote_owners.set(true)
            }
            atom!("blocking") => doc.invalidate(cx),
            atom!("nonce") => self.set_nonce(new.cloned().unwrap_or_default()),
            atom!("popover") => crate::api::ui::popover::attribute_changed(cx, self),
            atom!("interestfor") => crate::api::ui::interest::forget(cx, self),
            atom!("autofocus") => self.toggle(F::AUTOFOCUS, change.new.is_some()),
            atom!("elementtiming") => crate::api::performance::time_element(&cx.heap, self),
            _ if is_handler(&name.local) => {
                crate::api::events::handler_attribute_changed(cx, self, &name.local, change.new)
            }
            _ => {}
        }
        if self.steps().contains(Has::ATTRIBUTE_CHANGED) {
            seams::attribute_changed(cx, self, change);
        }
    }

    fn name_changed<'a>(&'a self, cx: &mut JsScope<'a>) {
        if matches!(
            self.kind(),
            Kind::Embed | Kind::Form | Kind::IFrame | Kind::Image | Kind::Object
        ) {
            let has_name = self.with_attr_string(atom!("name"), |it| !it.is_empty()) == Some(true);
            self.toggle(
                F::NAMED,
                has_name || self.kind() == Kind::Object && self.has(F::HAS_ID),
            );
            named::changed(&cx.heap, self);
        }
    }

    /// Only styles see it. The name ends with ` source`.
    pub(crate) fn set_presentation_attr(&self, name: &str, value: Option<&str>) {
        self.change(|engine, id| engine.set_attribute(id, name, value));
    }

    /// For a document with other quirks.
    pub(super) fn reclassify(&self) {
        let is_quirky = self.doc().quirks();
        self.arena().classes_changed();
        self.arena().write(|engine| {
            let Some(element) = engine.tree.element_mut(self.id()) else {
                return;
            };
            element.is_unprepared = true;
            if let Some(index) = element
                .attributes
                .iter()
                .position(|it| it.local == atom!("class") && it.space.is_none())
            {
                let value = element.attributes[index].value.clone();
                engine.change_attribute(self.id(), Ok(index), Some(value), is_quirky);
            }
        });
    }

    #[inline]
    pub(crate) fn state(&self) -> State {
        self.with(|it| it.state)
    }

    pub(crate) fn set_state<'a>(&'a self, cx: &mut JsScope<'a>, bits: State, on: bool) {
        if if on {
            !self.state().contains(bits)
        } else {
            self.state().intersects(bits)
        } {
            self.change(|engine, id| engine.set_state(id, bits, on));
            if self.is_rendered() {
                self.doc().invalidate_if_dirty(cx);
            }
        }
    }

    pub(crate) fn set_custom_state<'a>(&'a self, cx: &mut JsScope<'a>, name: &str, on: bool) {
        self.change(|engine, id| engine.set_custom_state(id, Name::new(name.as_bytes()), on));
        if self.is_rendered() {
            self.doc().invalidate(cx);
        }
    }

    /// It is `originator::name`, in the shadow tree of that control.
    pub(crate) fn set_pseudo(&self, name: &str, originator: &Element) {
        self.change(|engine, id| engine.set_pseudo(id, name.as_bytes(), originator.id()));
    }

    pub(crate) fn is_pseudo_of(&self, originator: &Element) -> bool {
        self.doc() == originator.doc() && self.with(|it| it.originator) == originator.id()
    }

    pub(crate) fn pseudo(&self) -> Pseudo {
        self.with(|it| it.pseudo)
    }

    /// Where `innerHTML` and the like find the children.
    pub(crate) fn contents<'a>(&'a self, cx: &mut JsScope<'a>) -> &'a Node {
        self.template_contents(cx).map_or(self, |it| it)
    }

    // ───────────────────────────── attribute nodes ─────────────────────────────

    fn existing_attr_node(&self, name: &QualName) -> Option<&Attr> {
        let known = if self.has(F::HAS_ATTR_NODES) {
            self.try_edge_list(Edge::AttributeNodes)?
        } else {
            return None;
        };
        known
            .nodes()
            .find(|it| it.with_inert(|it| it.name.local == name.local && it.name.ns == name.ns))?
            .downcast()
    }

    /// Of an attribute that it has.
    pub(crate) fn attr_node<'a>(&'a self, heap: &JsHeap<'a>, name: QualName) -> &'a Attr {
        self.existing_attr_node(&name).unwrap_or_else(|| {
            let attr = self.doc().create_attr(heap, name, DomString::default());
            attr.attach(heap, self);
            attr
        })
    }

    pub(super) fn attr_node_at<'a>(&'a self, heap: &JsHeap<'a>, index: u32) -> Option<&'a Attr> {
        let name = self.arena().read(|engine| {
            let has_value = |it: &&Attribute| {
                it.is_visible() && engine.script_value(self.id(), it, |_| ()).is_some()
            };
            engine
                .tree
                .element(self.id())?
                .attributes
                .iter()
                .filter(has_value)
                .nth(index as usize)
                .map(Attribute::qual_name)
        })?;
        let likely = self
            .try_edge_list(Edge::AttributeNodes)
            .and_then(|it| it.node(index))
            .filter(|it| it.with_inert(|it| it.name == name));
        Some(
            likely
                .and_then(Node::downcast)
                .unwrap_or_else(|| self.attr_node(heap, name)),
        )
    }

    pub(crate) fn set_attr_node<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        attr: &'a Attr,
    ) -> bindgen::Result<'a, Option<&'a Attr>> {
        let value = self.compliant_attribute_text(cx, &attr.qual_name(), attr.value())?;
        self.flush_style(cx);
        adopt(cx, attr, self.doc());
        match attr.owner() {
            Some(owner) if **owner == **self => return Ok(Some(attr)),
            None if attr.doc() == self.doc() => {}
            _ => {
                return Err(dom_error(
                    &cx.heap,
                    DomError::InUseAttributeError,
                    "The attribute is in use by another element.",
                ));
            }
        }
        let name = attr.qual_name();
        let old = self
            .attr_name_ns(&name.ns, &name.local)
            .map(|it| self.attr_node(&cx.heap, it));
        if let Some(old) = old {
            old.detach(&cx.heap, self);
            let space =
                (name.ns != Ns::None).then(|| Space::new(name.ns.clone(), name.prefix.clone()));
            self.arena().write(|engine| {
                let attributes = engine
                    .tree
                    .element_mut(self.id())
                    .into_iter()
                    .flat_map(|it| it.attributes.to_mut());
                attributes
                    .filter(|it| Element::is_named(it, &name.ns, &name.local))
                    .for_each(|it| it.space.clone_from(&space));
            });
        }
        attr.attach(&cx.heap, self);
        self.set_attr_ns(cx, name, value);
        Ok(old)
    }

    pub(crate) fn remove_attr_node<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        attr: Option<&'a Attr>,
    ) -> bindgen::Result<'a, &'a Attr> {
        let Some(attr) = attr.filter(|it| it.owner().is_some_and(|it| **it == **self)) else {
            return Err(dom_error(
                &cx.heap,
                DomError::NotFoundError,
                "The attribute was not found.",
            ));
        };
        self.remove_attr_ns(cx, attr.qual_name());
        Ok(attr)
    }
}

impl Attr {
    pub(crate) fn qual_name(&self) -> QualName {
        self.with_inert(|it| it.name.clone())
    }

    pub(crate) fn owner(&self) -> Option<&Element> {
        self.edge_node(Edge::OwnerElement)?.as_element()
    }

    /// For `style`, after `flush_style` of the owner.
    pub(crate) fn value(&self) -> DomString {
        let name = self.qual_name();
        self.owner()
            .and_then(|it| it.attr_ns(&name.ns, &name.local))
            .unwrap_or_else(|| self.with_inert(|it| it.data.clone()))
    }

    pub(crate) fn change_value<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        value: DomString,
    ) -> bindgen::Result<'a, ()> {
        let value = match self.owner() {
            Some(owner) => owner.compliant_attribute_text(cx, &self.qual_name(), value)?,
            None => value,
        };
        match self.owner() {
            Some(owner) => owner.set_attr_ns(cx, self.qual_name(), value),
            None => self.change_inert(|it| it.data = value),
        }
        Ok(())
    }

    fn attach(&self, heap: &JsHeap<'_>, owner: &Element) {
        owner
            .edge_list(heap, Edge::AttributeNodes)
            .push(heap, self.to_js());
        owner.set(F::HAS_ATTR_NODES);
        self.set_edge(heap, Edge::OwnerElement, owner.to_js());
    }

    fn detach(&self, heap: &JsHeap<'_>, owner: &Element) {
        let value = self.value();
        self.change_inert(|it| it.data = value);
        self.clear_edge(heap, Edge::OwnerElement);
        owner
            .edge_list(heap, Edge::AttributeNodes)
            .remove(heap, self.to_js());
    }
}

impl Doc {
    /// For parsers. It is never a custom element, and the names differ.
    pub(crate) fn create_parsed<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        name: QualName,
        attributes: impl ExactSizeIterator<Item = (QualName, DomString)>,
    ) -> &'a Element {
        let element = self.create_plain(&cx.heap, name);
        element.append_attributes(cx, attributes);
        element
    }
}

impl Element {
    /// To one that is new.
    pub(crate) fn append_attributes<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        attributes: impl ExactSizeIterator<Item = (QualName, DomString)>,
    ) {
        let (id, has_steps) = (self.id(), self.has_attribute_steps());
        self.arena().write(|engine| {
            engine
                .tree
                .element_mut(id)
                .map(|it| it.attributes.to_mut().reserve_exact(attributes.len()))
        });
        attributes.for_each(|(name, value)| self.append_attribute(cx, name, value, has_steps));
    }

    fn has_attribute_steps(&self) -> bool {
        self.steps().contains(Has::ATTRIBUTE_CHANGED)
            || self.has(F::CUSTOM)
            || self.parent().is_some()
            || self.doc().is(DocFlags::CHECKS_STYLE_ATTRIBUTES)
    }

    fn append_attribute<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        name: QualName,
        value: DomString,
        has_steps: bool,
    ) {
        if name.ns != Ns::None
            || name.local != atom!("class") && (has_steps || is_global(&name.local))
            || self.has(F::CUSTOM)
        {
            return self.set_attr_ns(cx, name, value);
        }
        if name.local == atom!("id") {
            self.toggle(F::HAS_ID, !value.is_empty());
        }
        if has_steps {
            self.arena().record_attribute(self, &name.local);
        }
        self.arena().write(|engine| {
            engine.change_attribute(
                self.id(),
                Err((name.local, None)),
                Some(value.into()),
                self.doc().quirks(),
            )
        });
    }
}

// ───────────────────────────── names ─────────────────────────────

fn invalid_name<'a>(heap: &JsHeap<'a>, name: &Atom) -> bindgen::Error<'a> {
    dom_error(
        heap,
        DomError::InvalidCharacterError,
        &format!("'{}' is not a valid name.", name.as_utf8()),
    )
}

#[inline]
const fn ends_name(unit: u16) -> bool {
    unit < 64
        && (1 | 1 << 9 | 1 << 10 | 1 << 12 | 1 << 13 | 1 << 0x20 | 1 << 0x2f | 1u64 << 0x3e) >> unit
            & 1
            != 0
}

/// <https://dom.spec.whatwg.org/#valid-element-local-name>
pub(crate) fn validate_element_name<'a>(heap: &JsHeap<'a>, name: &Atom) -> bindgen::Result<'a, ()> {
    let text = name.to_dom_string();
    let ascii = |unit: u16| u8::try_from(unit).ok().filter(u8::is_ascii);
    let is_valid = match text.units().next().map(ascii) {
        Some(Some(first)) if first.is_ascii_alphabetic() => !text.units().any(ends_name),
        Some(None | Some(b':' | b'_')) => text.units().all(|it| {
            ascii(it).is_none_or(|it| {
                it.is_ascii_alphanumeric() || matches!(it, b'-' | b'.' | b':' | b'_')
            })
        }),
        _ => false,
    };
    if is_valid {
        Ok(())
    } else {
        Err(invalid_name(heap, name))
    }
}

/// <https://dom.spec.whatwg.org/#valid-attribute-local-name>
#[inline]
pub(super) fn is_valid_attribute_name(name: &Atom) -> bool {
    const fn is_valid_latin1(mut text: &[u8]) -> bool {
        let is_empty = text.is_empty();
        while let [unit, rest @ ..] = text
            && *unit != b'='
            && !ends_name(*unit as u16)
        {
            text = rest;
        }
        !is_empty && text.is_empty()
    }
    static OF_KNOWN: [bool; TEXTS.len()] = {
        let (mut all, mut index) = ([false; TEXTS.len()], 0);
        while index < all.len() {
            all[index] = is_valid_latin1(TEXTS[index].as_bytes());
            index += 1;
        }
        all
    };
    match OF_KNOWN.get(name.known() as usize) {
        Some(is_valid) => *is_valid,
        None if name.as_impl().is_8bit() => is_valid_latin1(name.as_impl().latin1_slice()),
        None => !name
            .as_impl()
            .utf16_slice()
            .iter()
            .any(|it| *it == 0x3d || ends_name(*it)),
    }
}

#[inline]
pub(crate) fn validate_attribute_name<'a>(
    heap: &JsHeap<'a>,
    name: &Atom,
) -> bindgen::Result<'a, ()> {
    if is_valid_attribute_name(name) {
        Ok(())
    } else {
        Err(invalid_name(heap, name))
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum NameFor {
    Element,
    Attribute,
}

impl QualName {
    /// <https://dom.spec.whatwg.org/#validate-and-extract>
    pub(crate) fn validate_and_extract<'a>(
        heap: &JsHeap<'a>,
        ns: Ns,
        name: &Atom,
        context: NameFor,
    ) -> bindgen::Result<'a, QualName> {
        let text = name.to_dom_string();
        let colon = text.units().position(|it| it == 0x3a).map(|it| it as u32);
        let prefix = colon.map(|it| text.substring(0, it));
        if prefix
            .as_ref()
            .is_some_and(|it| it.is_empty() || it.units().any(ends_name))
        {
            return Err(invalid_name(heap, name));
        }
        let (prefix, local) = (
            prefix.map(|it| Atom::from_string(&it)),
            colon.map_or_else(
                || name.clone(),
                |it| Atom::from_string(&text.substring(it + 1, u32::MAX)),
            ),
        );
        match context {
            NameFor::Element => validate_element_name(heap, &local)?,
            NameFor::Attribute => validate_attribute_name(heap, &local)?,
        }
        let has_prefix = |known: Known| prefix.as_ref().is_some_and(|it| *it == known);
        if prefix.is_some() && ns == Ns::None
            || has_prefix(atom!("xml")) && ns != Ns::Xml
            || (*name == atom!("xmlns") || has_prefix(atom!("xmlns"))) != (ns == Ns::Xmlns)
        {
            return Err(dom_error(
                heap,
                DomError::NamespaceError,
                &format!(
                    "The name '{}' and the namespace do not go together.",
                    name.as_utf8()
                ),
            ));
        }
        Ok(QualName { ns, prefix, local })
    }
}

// ───────────────────────────── character data ─────────────────────────────

impl CharacterData {
    #[inline]
    pub(crate) fn with_data<R>(&self, read: impl FnOnce(&DomString) -> R) -> R {
        self.read(|tree, id| match &tree[id].data {
            tree::Data::Text(text) => read(text.string()),
            tree::Data::Inert(inert) => read(&inert.data),
            _ => unreachable!(),
        })
    }

    #[inline]
    pub(crate) fn data(&self) -> DomString {
        self.with_data(DomString::clone)
    }

    #[inline]
    pub(crate) fn data_length(&self) -> u32 {
        self.with_data(DomString::len)
    }

    /// No one is told but the engine.
    pub(crate) fn set_data_quietly(&self, data: DomString) {
        match self.kind().is_text() {
            true => self.change(|engine, id| engine.set_text(id, data.into())),
            false => self.change_inert(|it| it.data = data),
        }
    }

    pub(crate) fn replace_data<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        offset: u32,
        count: u32,
        data: &DomString,
    ) -> bindgen::Result<'a, ()> {
        if offset > self.data_length() {
            return Err(dom_error(
                &cx.heap,
                DomError::IndexSizeError,
                "The offset is greater than the node's length.",
            ));
        }
        self.splice(cx, offset, count, data);
        Ok(())
    }

    pub(crate) fn append_data<'a>(&'a self, cx: &mut JsScope<'a>, data: &DomString) {
        self.splice(cx, self.data_length(), 0, data);
    }

    pub(crate) fn replace_all_data<'a>(&'a self, cx: &mut JsScope<'a>, data: &DomString) {
        self.splice(cx, 0, u32::MAX, data);
    }

    fn splice<'a>(&'a self, cx: &mut JsScope<'a>, offset: u32, count: u32, data: &DomString) {
        let (old, doc) = (self.data(), self.doc());
        let offset = offset.min(old.len());
        let count = count.min(old.len() - offset);
        if doc.is(DocFlags::OBSERVES_DATA | DocFlags::RECORDS_EDITS) {
            queue_mutation_record(&cx.heap, self, Record::Data { old: &old });
        }
        match count == old.len() {
            true => self.set_data_quietly(data.clone()),
            false if offset == old.len() && self.kind().is_text() => {
                self.change(|engine, id| engine.append_text(id, data))
            }
            false => self.set_data_quietly(DomString::concat(&[
                &old.substring(0, offset),
                data,
                &old.substring(offset + count, u32::MAX),
            ])),
        }
        if self.has(F::HAS_RANGES) {
            seams::ranges_after_replace_data(cx, self, offset, count, data.len());
        }
        if self.is_rendered() && self.kind().is_text() {
            doc.invalidate(cx);
        }
        if let Some(parent) = self
            .parent()
            .filter(|it| it.steps().contains(Has::CHILDREN_CHANGED) || it.has(F::IN_SELECT))
        {
            seams::children_changed(cx, parent, false);
        }
    }
}

impl Text {
    pub(crate) fn split<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        offset: u32,
    ) -> bindgen::Result<'a, &'a Text> {
        if offset > self.data_length() {
            return Err(dom_error(
                &cx.heap,
                DomError::IndexSizeError,
                "The offset is larger than the Text node's length.",
            ));
        }
        let (data, doc) = (self.data().substring(offset, u32::MAX), self.doc());
        let rest = if self.kind() == Kind::Text {
            doc.create_text(&cx.heap, data)
        } else {
            doc.create_cdata(&cx.heap, data)
        };
        if let Some(parent) = self.parent() {
            insert(cx, rest, parent, self.next_sibling(), Observers::Notify);
            if doc.is(DocFlags::HAS_RANGES) {
                seams::ranges_after_split(cx, self, rest, offset);
            }
        }
        self.splice(cx, offset, u32::MAX, &DomString::default());
        Ok(rest)
    }
}
