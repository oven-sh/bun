//! What the HTML parser builds the tree with.

use std::rc::Rc;

use bun_jsc::JSValue;
use bun_jsc::bindgen::JsScope;
use bun_markup::html::{
    self, Attribute, AttributeNamespace, ElementName, Namespace, NewElement, Patch, Place, Quirks,
    ShortName, Tag, TagSource, find_attribute,
};
use bun_markup::names::pseudo_attributes;
use bun_markup::{Chars, Text as Buffer};
use smallvec::SmallVec;

use super::parser::{DocumentParser, forbid_markup_insertion};
use super::pending;
use crate::api::core::steps::Has;
use crate::api::core::{NodeFlags as F, *};
use crate::api::loading::{self, ScriptFate};
use crate::tree::{self, Data, NodeId};

pub(super) struct Cells;

impl html::Dom for Cells {
    type Node = JSValue;
    type Name = Atom;
    type Text = DomString;
    type Stencil = Rc<Stencil>;

    #[inline]
    fn chars_of_name(name: &Atom) -> Chars<'_> {
        name.chars()
    }

    #[inline]
    fn chars_of_text(text: &DomString) -> Chars<'_> {
        text.chars()
    }

    fn attributes_of(stencil: &Rc<Stencil>) -> Vec<Attribute<Cells>> {
        let copy = |it: &crate::tree::Attribute| Attribute {
            name: it.local.clone(),
            namespace: AttributeNamespace::None,
            value: it.value.string().clone(),
        };
        stencil.mould.attributes().iter().map(copy).collect()
    }
}

pub(super) struct Stencil {
    tag: Tag,
    mould: Mould,
    source: SmallVec<[u8; 48]>,
}

pub(super) fn tag_of(element: &Element) -> Tag {
    element.with(|it| match it.namespace {
        crate::tree::Namespace::Svg if it.local == atom!("foreignObject") => Tag::ForeignObject,
        _ => Tag::from_name(it.local.chars()),
    })
}

const NAME_BITS: u32 = 7;
const STRING_BITS: u32 = 8;
const STENCIL_BITS: u32 = 12;
const LONGEST_SHARED: usize = 48;

/// Markup repeats itself.
pub(crate) struct Recent {
    tags: [Atom; Tag::ALL.len()],
    /// Whether an HTML element can be bare, once that was asked.
    are_plain: [Option<bool>; Tag::ALL.len()],
    names: [Option<(ShortName, Atom)>; 1 << NAME_BITS],
    strings: [Option<DomString>; 1 << STRING_BITS],
    /// With the hash of the source of the tag that it is for, or of the last one that has come once.
    stencils: Box<[(u32, Option<Rc<Stencil>>)]>,
}

impl Recent {
    fn new() -> Box<Recent> {
        let tags = core::array::from_fn(|it| Atom::new(Tag::ALL[it].name()));
        Box::new(Recent {
            tags,
            are_plain: [None; _],
            names: [const { None }; _],
            strings: [const { None }; _],
            stencils: vec![(0, None); 1 << STENCIL_BITS].into(),
        })
    }

    #[inline(always)]
    fn stencil(&mut self, source: TagSource<'_>) -> &mut (u32, Option<Rc<Stencil>>) {
        &mut self.stencils[(source.hash >> (64 - STENCIL_BITS)) as usize]
    }

    #[inline]
    fn name(&mut self, short: ShortName, chars: Chars<'_>) -> Atom {
        match &mut self.names[short.slot(NAME_BITS)] {
            Some((known, atom)) if *known == short => atom.clone(),
            slot => slot.insert((short, Atom::from_chars(chars))).1.clone(),
        }
    }

    #[inline]
    fn string(&mut self, chars: Chars<'_>) -> DomString {
        let Chars::Latin1(bytes @ [first, .., last]) = chars else {
            return DomString::from_chars(chars);
        };
        if bytes.len() > LONGEST_SHARED {
            return DomString::from_latin1(bytes);
        }
        let ends = match (bytes.first_chunk(), bytes.last_chunk()) {
            (Some(head), Some(tail)) => {
                u64::from(u32::from_le_bytes(*head)) << 32 | u64::from(u32::from_le_bytes(*tail))
            }
            _ => u64::from(*first) << 8 | u64::from(*last),
        };
        let hash = (ends ^ (bytes.len() as u64) << 24).wrapping_mul(0x9e37_79b9_7f4a_7c15);
        match &mut self.strings[(hash >> (64 - STRING_BITS)) as usize] {
            Some(known) if known.latin1() == Some(bytes) => known.clone(),
            slot => slot.insert(DomString::from_latin1(bytes)).clone(),
        }
    }
}

#[derive(Clone, Copy)]
pub(super) enum Client<'a> {
    Fragment {
        root: &'a Node,
        /// What has the registry of the children of `root`.
        registry_from: Option<&'a Node>,
        starts_scripts: bool,
    },
    /// All of it is there, and no script waits for it.
    Inert,
    Loading(&'a DocumentParser),
}

pub(super) struct Sink<'c, 'a> {
    pub(super) cx: &'c mut JsScope<'a>,
    doc: &'a Doc,
    client: Client<'a>,
    recent: Option<Box<Recent>>,
    /// A text node that was extended, and what it has by now.
    growing: Option<(&'a Text, Buffer)>,
    growing_bare: Option<(NodeId, Buffer)>,
    /// What the bare nodes that the parser has are in, and how many it has got.
    owner: Option<&'a Node>,
    added: u32,
}

impl Drop for Sink<'_, '_> {
    fn drop(&mut self) {
        self.stop_growing();
        html::Sink::publish(self);
        self.doc.arena().recent_markup.set(self.recent.take());
    }
}

fn qual_name(attribute: Attribute<Cells>) -> (QualName, DomString) {
    let (ns, prefix) = match attribute.namespace {
        AttributeNamespace::None => (Ns::None, None),
        AttributeNamespace::XLink => (Ns::XLink, Some(atom!("xlink"))),
        AttributeNamespace::Xml => (Ns::Xml, Some(atom!("xml"))),
        AttributeNamespace::Xmlns => (
            Ns::Xmlns,
            (attribute.name != atom!("xmlns")).then_some(atom!("xmlns")),
        ),
    };
    (
        QualName::parsed(ns, prefix.map(Atom::from), attribute.name),
        attribute.value,
    )
}

fn chooses_definition(attribute: &Attribute<Cells>) -> bool {
    matches!(
        attribute.name.known(),
        atom!("is") | atom!("customelementregistry")
    )
}

/// Undefined for the one of the document.
pub(super) fn registry_for_child(parent: Option<&Node>, asks_for_null: bool) -> JSValue {
    if asks_for_null {
        note_scoped_registry();
        return JSValue::NULL;
    }
    let inherits = |it: &&Node| {
        it.has(F::SHADOW_ROOT) || has_scoped_registries() && it.kind() != Kind::Fragment
    };
    parent.filter(inherits).map_or(JSValue::UNDEFINED, |it| {
        custom::registry_value(custom::registry_of(it))
    })
}

fn is_marker(node: &Node, target: Known) -> bool {
    node.kind() == Kind::Instruction && node.with_inert(|it| it.name.local == target)
}

fn end_marker_of(start: &Node) -> Option<&Node> {
    if is_marker(start, atom!("marker")) {
        return Some(start);
    }
    let mut depth = 0u32;
    start.next_siblings().find(|it| {
        depth += u32::from(is_marker(it, atom!("start")));
        is_marker(it, atom!("end")) && depth.checked_sub(1).map(|it| depth = it).is_none()
    })
}

impl<'c, 'a> Sink<'c, 'a> {
    pub(super) fn new(cx: &'c mut JsScope<'a>, doc: &'a Doc, client: Client<'a>) -> Self {
        doc.arena().write(|engine| doc.arena().free_dead(engine));
        doc.prepare_for_bare(Kind::Text);
        Sink {
            cx,
            doc,
            client,
            recent: doc.arena().recent_markup.take(),
            growing: None,
            growing_bare: None,
            owner: None,
            added: 0,
        }
    }

    /// With the owner, if what is appended to it can be bare.
    #[inline(always)]
    fn bare_parent(&mut self, parent: JSValue) -> Option<(&'a Node, NodeId)> {
        if parent.is_int32() {
            return Some((self.owner?, parent.as_int32() as NodeId));
        }
        let parent = self.node(parent);
        if self.owner != Some(parent) {
            (parent.takes_bare() && Rc::ptr_eq(parent.arena(), self.doc.arena())).then_some(())?;
            html::Sink::publish(self);
            self.owner = Some(parent);
        }
        Some((parent, parent.id()))
    }

    #[inline(always)]
    fn appended(&mut self, owner: &Node) {
        owner.set(F::HAS_BARE_CHILDREN);
        self.added += 1;
    }

    #[cold]
    fn extend_bare(&mut self, node: NodeId, more: Chars<'_>) {
        if self.growing_bare.as_ref().is_some_and(|it| it.0 != node) {
            self.stop_growing_bare();
        }
        let old = || {
            self.doc.read(|tree, _| {
                if let Data::Text(it) = &tree[node].data {
                    it.string().chars().into()
                } else {
                    Buffer::default()
                }
            })
        };
        self.growing_bare
            .get_or_insert_with(|| (node, old()))
            .1
            .push(more);
    }

    #[cold]
    fn stop_growing_bare(&mut self) {
        if let Some((owner, (node, text))) = self.owner.zip(self.growing_bare.take()) {
            owner.change(|engine, _| {
                engine.set_text(node, DomString::from_chars(text.chars()).into())
            });
        }
    }

    #[cold]
    fn find_out_if_plain(&mut self, tag: Tag) -> bool {
        let is_plain = self
            .doc
            .prepare_for_bare(Kind::of_html(self.recent().tags[tag as usize].known()));
        *self.recent().are_plain[tag as usize].insert(is_plain)
    }

    #[inline(always)]
    fn node(&self, cell: JSValue) -> &'a Node {
        debug_assert!(cell.is_cell());
        // SAFETY: the parser has it from here. Nothing is collected while it runs, or else `DocumentParser::keep` holds it.
        unsafe { Node::from_cell(cell) }
    }

    #[inline(always)]
    fn element(&self, cell: JSValue) -> &'a Element {
        debug_assert!(self.node(cell).is_element());
        // SAFETY: it is what `create_element` has made.
        unsafe { self.node(cell).cast() }
    }

    #[inline(always)]
    fn recent(&mut self) -> &mut Recent {
        self.recent.get_or_insert_with(Recent::new)
    }

    fn loader(&self) -> Option<&'a DocumentParser> {
        match self.client {
            Client::Loading(parser) => Some(parser),
            _ => None,
        }
    }

    fn stop_growing(&mut self) {
        if let Some((node, text)) = self.growing.take() {
            node.replace_all_data(self.cx, &DomString::from_chars(text.chars()));
        }
    }

    #[cold]
    fn extend(&mut self, node: &'a Text, more: Chars<'_>) {
        if let Some(parser) = self.loader() {
            parser.set_inserting(true);
            node.append_data(self.cx, &DomString::from_chars(more));
            return parser.set_inserting(false);
        }
        if !self
            .growing
            .as_ref()
            .is_some_and(|it| core::ptr::eq(it.0, node))
        {
            self.stop_growing();
        }
        self.growing
            .get_or_insert_with(|| (node, node.with_data(|it| it.chars().into())))
            .1
            .push(more);
    }

    #[inline]
    fn insert(&mut self, node: &'a Node, place: Place<JSValue>) {
        let parent = self.node(place.parent);
        if place.before.is_none() && parent.takes_plain_append(node) {
            append_detached(parent, node);
        } else {
            self.loader().inspect(|it| it.set_inserting(true));
            insert(
                self.cx,
                node,
                parent,
                place.before.map(|it| self.node(it)),
                Observers::Notify,
            );
            self.loader().inspect(|it| it.set_inserting(false));
        }
    }

    fn insert_if_possible(&mut self, node: &'a Node, place: Place<JSValue>) {
        if node.parent().is_some() {
            remove(self.cx, node, Observers::Notify);
        }
        let (parent, before) = (
            self.node(place.parent),
            place.before.map(|it| self.node(it)),
        );
        if node.parent().is_none()
            && ensure_pre_insert_validity(&self.cx.heap, node, parent, before, Validity::Inserting)
                .is_ok()
        {
            insert(self.cx, node, parent, before, Observers::Notify);
        }
    }

    /// <https://html.spec.whatwg.org/#create-an-element-for-the-token>, for what takes more than a name and attributes.
    #[cold]
    fn create_special(
        &mut self,
        name: QualName,
        NewElement {
            attributes,
            intended_parent,
            position,
            had_duplicate_attributes,
            ..
        }: NewElement<'_, Cells>,
    ) -> &'a Element {
        let parent = self.node(intended_parent);
        let doc = parent.doc();
        let is = find_attribute(attributes, "is").map(Atom::from_string);
        let may_be_custom =
            name.ns == Ns::Html && (is.is_some() || is_valid_custom_element_name(&name.local));
        let constructing = self
            .loader()
            .filter(|_| may_be_custom && doc.is(DocFlags::HAS_PAGE));
        let forbidden = constructing.map(|_| forbid_markup_insertion(self.doc));
        if constructing.is_some() {
            pending::before_constructing(self.cx, parent, &name.local, is.as_ref());
        }
        let inherits_from = match self.client {
            Client::Fragment {
                root,
                registry_from,
                ..
            } if root == parent => registry_from,
            _ => Some(parent),
        };
        let asks_for_null =
            name.ns == Ns::Html && find_attribute(attributes, "customelementregistry").is_some();
        let registry = registry_for_child(inherits_from, asks_for_null);
        let synchronous = if constructing.is_some() {
            Synchronous::Yes
        } else {
            Synchronous::No
        };
        let is_script = name.local == atom!("script") && name.ns != Ns::MathMl;
        let created = doc.create_element(self.cx, name, is.as_ref(), synchronous, registry);
        if is_script {
            let fate = match self.client {
                Client::Fragment {
                    starts_scripts: true,
                    ..
                } => ScriptFate::RunsWhenConnected,
                Client::Loading(parser) if parser.runs_scripts() => ScriptFate::ParserInserted,
                _ => ScriptFate::AlreadyStarted,
            };
            loading::script_created(
                &self.cx.heap,
                created,
                self.doc,
                fate,
                (position.line, position.column),
                had_duplicate_attributes,
            );
        }
        created.append_attributes(self.cx, attributes.drain(..).map(qual_name));
        if constructing.is_some() {
            custom::react_now(self.cx);
        }
        drop(forbidden);
        created
    }

    #[inline]
    fn create(&mut self, element: NewElement<'_, Cells>) -> &'a Element {
        let parent = self.node(element.intended_parent);
        let (doc, chooses_registry) = (
            parent.doc(),
            parent.has(F::SHADOW_ROOT) || has_scoped_registries(),
        );
        if let Some(stencil) = element.stencil {
            if !chooses_registry
                && matches!(element.name, ElementName::Known(tag) if tag == stencil.tag)
                && stencil.mould.fits(doc)
            {
                return stencil.mould.create(&self.cx.heap, doc);
            }
            element
                .attributes
                .extend(<Cells as html::Dom>::attributes_of(stencil));
        }
        let ns = match element.namespace {
            Namespace::Html => Ns::Html,
            Namespace::Svg => Ns::Svg,
            Namespace::MathMl => Ns::MathMl,
        };
        let (local, is_special) = match element.name {
            ElementName::Known(tag) => {
                (self.recent().tags[tag as usize].clone(), tag == Tag::Script)
            }
            ElementName::Other(name) => (name.clone(), ns == Ns::Html),
        };
        let name = QualName::parsed(ns, None, local);
        match is_special || chooses_registry || element.attributes.iter().any(chooses_definition) {
            true => self.create_special(name, element),
            false => doc.create_parsed(self.cx, name, element.attributes.drain(..).map(qual_name)),
        }
    }
}

impl html::Sink for Sink<'_, '_> {
    type Dom = Cells;

    #[inline]
    fn name(&mut self, chars: Chars<'_>, short: Option<ShortName>) -> Atom {
        short.map_or_else(
            || Atom::from_chars(chars),
            |it| self.recent().name(it, chars),
        )
    }

    #[inline]
    fn value(&mut self, name: &Atom, chars: Chars<'_>) -> DomString {
        match name.known() {
            atom!("id") | atom!("src") | atom!("alt") | atom!("value") => {
                DomString::from_chars(chars)
            }
            _ => self.recent().string(chars),
        }
    }

    #[inline]
    fn recall(&mut self, source: TagSource<'_>) -> Option<Rc<Stencil>> {
        match self.recent().stencil(source) {
            (hash, Some(known))
                if *hash == source.hash as u32 && source.chars == Chars::Latin1(&known.source) =>
            {
                Some(Rc::clone(known))
            }
            _ => None,
        }
    }

    fn remember(
        &mut self,
        source: TagSource<'_>,
        tag: Tag,
        attributes: &mut Vec<Attribute<Cells>>,
    ) -> Option<Rc<Stencil>> {
        let doc = self.doc;
        let recent = self.recent();
        let local = recent.tags[tag as usize].known();
        let slot = recent.stencil(source);
        if slot.0 != source.hash as u32 {
            *slot = (source.hash as u32, None);
            return None;
        }
        if tag == Tag::Script
            || attributes.iter().any(chooses_definition)
            || !Mould::can_hold(doc, local, attributes.iter().map(|it| &it.name))
        {
            return None;
        }
        let source = source
            .chars
            .units()
            .map(|it| u8::try_from(it).ok())
            .collect::<Option<_>>()?;
        let mould = Mould::new(
            doc,
            local,
            attributes.drain(..).map(|it| (it.name, it.value)),
        );
        Some(Rc::clone(slot.1.insert(Rc::new(Stencil {
            tag,
            mould,
            source,
        }))))
    }

    fn document(&self) -> JSValue {
        self.doc.to_js()
    }

    fn is_in_quirks_mode(&self) -> bool {
        self.doc.quirks()
    }

    fn set_quirks(&mut self, quirks: Quirks) {
        self.doc.set_quirks(match quirks {
            Quirks::None => crate::document::Quirks::None,
            Quirks::Limited => crate::document::Quirks::Limited,
            Quirks::Full => crate::document::Quirks::All,
        });
    }

    fn parent(&self, node: JSValue) -> Option<JSValue> {
        if node.is_int32() {
            let parent = self.doc.read(|tree, _| {
                Some(tree[node.as_int32() as NodeId].parent).filter(|it| tree.is_bare(*it))
            });
            return parent
                .map(|it| JSValue::js_number_from_int32(it as i32))
                .or_else(|| self.owner.map(Node::to_js));
        }
        self.node(node).parent().map(Node::to_js)
    }

    fn template_contents(&mut self, node: JSValue) -> Option<JSValue> {
        Some(
            self.node(node.is_cell().then_some(node)?)
                .as_element()?
                .template_contents(self.cx)?
                .to_js(),
        )
    }

    #[inline]
    fn append_element_quietly(&mut self, element: NewElement<'_, Cells>) -> Option<JSValue> {
        let local = match (element.namespace, element.name) {
            (Namespace::Html, ElementName::Known(tag)) => {
                let recent = self.recent();
                recent.are_plain[tag as usize]
                    .unwrap_or_else(|| self.find_out_if_plain(tag))
                    .then_some(())?;
                self.recent().tags[tag as usize].clone()
            }
            (Namespace::Html, _) => return None,
            (namespace, name) => {
                let local = match name {
                    ElementName::Known(tag) => self.recent().tags[tag as usize].clone(),
                    ElementName::Other(name) => name.clone(),
                };
                self.doc
                    .prepare_for_bare(if namespace == Namespace::Svg {
                        Kind::of_svg(local.known())
                    } else {
                        Kind::MathMl
                    })
                    .then_some(local)?
            }
        };
        let (owner, parent) = self.bare_parent(element.intended_parent)?;
        if has_scoped_registries() || owner.has(F::SHADOW_ROOT) && parent == owner.id() {
            return None;
        }
        let (doc, mut has_id) = (owner.doc(), false);
        let id = match element.stencil {
            Some(stencil) => {
                (local == stencil.mould.local() && stencil.mould.fits(doc)).then_some(())?;
                has_id = stencil.mould.has_id();
                owner.append_bare(parent, |engine| stencil.mould.create_slot(engine))
            }
            None => {
                for it in element.attributes.iter() {
                    has_id |= it.name == atom!("id");
                    if it.namespace != AttributeNamespace::None
                        || bare::needs_object(&it.name)
                        || chooses_definition(it)
                        || it.name == atom!("style") && doc.is(DocFlags::CHECKS_STYLE_ATTRIBUTES)
                    {
                        return None;
                    }
                }
                let namespace = match element.namespace {
                    Namespace::Html => tree::Namespace::Html,
                    Namespace::Svg => tree::Namespace::Svg,
                    Namespace::MathMl => tree::Namespace::MathMl,
                };
                owner.append_bare(parent, |engine| {
                    engine.create_element_with(
                        local,
                        namespace,
                        element
                            .attributes
                            .drain(..)
                            .map(|it| (it.name, it.value.into())),
                        doc.quirks(),
                    )
                })
            }
        };
        if has_id {
            owner.note_id_of_bare(&self.cx.heap, id);
        }
        self.appended(owner);
        Some(JSValue::js_number_from_int32(id as i32))
    }

    #[inline]
    fn append_text_quietly(&mut self, text: Chars<'_>, parent: JSValue) -> bool {
        let Some((owner, parent)) = self.bare_parent(parent) else {
            return false;
        };
        if let Some(previous) = owner.read(|tree, _| tree.text_at_end_of(parent)) {
            self.extend_bare(previous, text);
            return true;
        }
        let data = if text.is_all_spaces() {
            self.recent().string(text)
        } else {
            DomString::from_chars(text)
        };
        owner.append_bare(parent, |engine| engine.tree.create(Data::Text(data.into())));
        self.appended(owner);
        true
    }

    fn append_comment_quietly(&mut self, data: Chars<'_>, parent: JSValue) -> bool {
        let Some((owner, parent)) = self.bare_parent(parent) else {
            return false;
        };
        self.doc.prepare_for_bare(Kind::Comment);
        owner.append_bare_comment(parent, DomString::from_chars(data));
        self.appended(owner);
        true
    }

    #[inline(always)]
    fn is_pinned(&self, node: JSValue) -> bool {
        !node.is_int32()
    }

    #[inline]
    fn pin(&mut self, node: JSValue) -> JSValue {
        if !node.is_int32() {
            return node;
        }
        let node = self
            .doc
            .node(node.as_int32() as NodeId)
            .expect("it is in the tree");
        self.loader().inspect(|it| it.keep(&self.cx.heap, node));
        node.to_js()
    }

    #[inline]
    fn publish(&mut self) {
        if self.growing_bare.is_some() {
            self.stop_growing_bare();
        }
        if let Some(owner) = self.owner.take() {
            owner.bare_changed(self.cx, core::mem::take(&mut self.added));
        }
    }

    #[inline]
    fn create_element(&mut self, element: NewElement<'_, Cells>) -> JSValue {
        let created = self.create(element);
        if let Client::Loading(parser) = self.client {
            parser.keep(&self.cx.heap, created);
            created.toggle(
                F::BEING_PARSED,
                created.steps().contains(Has::FINISHED_PARSING),
            );
        }
        created.to_js()
    }

    #[inline]
    fn insert_element(&mut self, node: JSValue, place: Place<JSValue>) {
        let node = self.node(node);
        let Client::Loading(parser) = self.client else {
            return self.insert(node, place);
        };
        let is_custom = node.has(F::CUSTOM);
        parser.set_inserting(!is_custom);
        self.insert_if_possible(node, place);
        parser.set_inserting(false);
        custom::react_now(self.cx);
    }

    #[inline]
    fn runs_script_when_inserted(&self, node: JSValue) -> bool {
        let node = self.node(node);
        self.loader().is_some()
            && (node.has(F::CUSTOM) || node.steps().contains(Has::POST_CONNECTION))
    }

    #[inline]
    fn insert_text(&mut self, text: Chars<'_>, place: Place<JSValue>) {
        let parent = self.node(place.parent);
        let previous = place.before.map_or_else(
            || parent.last_child(),
            |it| self.node(it).previous_sibling(),
        );
        if let Some(previous) = previous
            .filter(|it| it.kind() == Kind::Text)
            .and_then(Node::as_text)
        {
            return self.extend(previous, text);
        }
        if parent.as_doc().is_none() {
            let data = if text.is_all_spaces() {
                self.recent().string(text)
            } else {
                DomString::from_chars(text)
            };
            let node = parent.doc().create_text(&self.cx.heap, data);
            self.insert(node, place);
        }
    }

    fn insert_comment(&mut self, data: Chars<'_>, place: Place<JSValue>) {
        let node = self
            .node(place.parent)
            .doc()
            .create_comment(&self.cx.heap, DomString::from_chars(data));
        self.insert(node, place);
    }

    fn insert_instruction(&mut self, target: Chars<'_>, data: Chars<'_>, place: Place<JSValue>) {
        let doc = self.node(place.parent).doc();
        let node = doc.create_pi(
            &self.cx.heap,
            Atom::from_chars(target),
            DomString::from_chars(data),
        );
        self.insert(node, place);
    }

    fn insert_doctype(&mut self, name: Chars<'_>, public_id: Chars<'_>, system_id: Chars<'_>) {
        if self.doc.is_html_doc() && !self.doc.content_type().eq_str("text/html") {
            return;
        }
        let [public_id, system_id] = [public_id, system_id].map(DomString::from_chars);
        let node =
            self.doc
                .create_doctype(&self.cx.heap, Atom::from_chars(name), public_id, system_id);
        self.insert_if_possible(
            node,
            Place {
                parent: self.doc.to_js(),
                before: None,
            },
        );
    }

    fn reparent(&mut self, node: JSValue, place: Place<JSValue>) {
        self.insert_if_possible(self.node(node), place);
    }

    fn reparent_children(&mut self, from: JSValue, to: JSValue) {
        while let Some(child) = self.node(from).first_child() {
            self.insert_if_possible(
                child,
                Place {
                    parent: to,
                    before: None,
                },
            );
        }
    }

    fn remove(&mut self, node: JSValue) {
        if self.node(node).parent().is_some() {
            remove(self.cx, self.node(node), Observers::Notify);
        }
    }

    fn add_missing_attributes(&mut self, node: JSValue, attributes: &mut Vec<Attribute<Cells>>) {
        let Some(element) = self.node(node).as_element() else {
            return;
        };
        for it in attributes.drain(..) {
            if !element.has_attr(&it.name) {
                element.set_attr(self.cx, it.name, it.value);
            }
        }
        element.hide_nonce(self.cx);
    }

    fn associate_with_form(&mut self, node: JSValue, form: JSValue, intended_parent: JSValue) {
        if self.node(form).root() == self.node(intended_parent).root() {
            pending::associate_with_form(
                &self.cx.heap,
                self.element(node),
                self.element(form),
                self.node(intended_parent),
            );
        }
    }

    fn attach_shadow(&mut self, host: JSValue, template: NewElement<'_, Cells>) -> Option<JSValue> {
        let host = self.node(host).as_element().filter(|it| !it.has(F::HOST))?;
        let find = |name: &str| find_attribute(template.attributes, name);
        let mut flags = ShadowFlags::DECLARATIVE;
        for (flag, is_on) in [
            (
                ShadowFlags::CLOSED,
                find("shadowrootmode")?.eq_ignore_ascii_case("closed"),
            ),
            (
                ShadowFlags::DELEGATES_FOCUS,
                find("shadowrootdelegatesfocus").is_some(),
            ),
            (ShadowFlags::CLONABLE, find("shadowrootclonable").is_some()),
            (
                ShadowFlags::SERIALIZABLE,
                find("shadowrootserializable").is_some(),
            ),
            (
                ShadowFlags::KEEPS_REGISTRY_NULL,
                find("shadowrootcustomelementregistry").is_some(),
            ),
            (
                ShadowFlags::MANUAL_SLOTS,
                find("shadowrootslotassignment")
                    .is_some_and(|it| it.eq_ignore_ascii_case("manual")),
            ),
        ] {
            flags.set(flag, is_on);
        }
        let registry = custom::registry_option(
            &self.cx.heap,
            if flags.contains(ShadowFlags::KEEPS_REGISTRY_NULL) {
                JSValue::NULL
            } else {
                JSValue::UNDEFINED
            },
            host.doc(),
        );
        let Ok(root) = registry.and_then(|it| host.attach_shadow(self.cx, flags, it)) else {
            self.cx.global().clear_exception_except_termination();
            return None;
        };
        root.set_reference_target(find("shadowrootreferencetarget").cloned());
        let template = self.create_element(template);
        self.element(template)
            .set_edge(&self.cx.heap, Edge::TemplateContents, root.to_js());
        Some(template)
    }

    fn start_patch(&mut self, scope: JSValue, name: Chars<'_>) -> Option<Patch<JSValue>> {
        let has_name = |node: &Node| {
            node.with_inert(|it| {
                pseudo_attributes(it.data.chars())
                    .iter()
                    .any(|it| it.0.is(b"name") && it.1.chars() == name)
            })
        };
        let is_start = |it: &&Node| {
            (is_marker(it, atom!("start")) || is_marker(it, atom!("marker"))) && has_name(it)
        };
        let start = self.node(scope).descendants().find(is_start)?;
        let (target, end) = (start.parent()?, end_marker_of(start));
        let between = start
            .next_siblings()
            .take_while(|it| Some(*it) != end && Some(start) != end);
        let replaced = Rooted::from_nodes(&self.cx.heap, between);
        let forbidden = forbid_markup_insertion(self.doc);
        replaced.iter().for_each(|it| self.remove(it.to_js()));
        if let Some(parser) = self.loader() {
            custom::react_now(self.cx);
            [Some(target), Some(start), end]
                .into_iter()
                .flatten()
                .for_each(|it| parser.keep(&self.cx.heap, it));
        }
        drop(forbidden);
        Some(Patch {
            target: target.to_js(),
            start: start.to_js(),
            end: end.map(Node::to_js),
        })
    }

    fn finished(&mut self, node: JSValue) {
        if self.node(node).steps().contains(Has::FINISHED_PARSING) {
            self.stop_growing();
            self.node(node).unset(F::BEING_PARSED);
            seams::finished_parsing(self.cx, self.node(node));
        }
    }

    fn mark_script_as_started(&mut self, script: JSValue) {
        loading::mark_script_as_started(self.element(script));
    }

    #[inline]
    fn wants_to_pause(&mut self) -> bool {
        self.loader().is_some_and(DocumentParser::needs_attention)
    }
}
