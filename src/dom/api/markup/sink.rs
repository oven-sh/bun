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
use crate::api::core::steps::Has;
use crate::api::core::{NodeFlags as F, *};
use crate::api::forms::dormant;
use crate::api::loading::{self, ScriptFate};
use crate::document::Above;
use crate::selector::{filter, filter_of, key};
use crate::tree::{self, Data, NodeId, State};

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
const MOST_SHORT_BITS: u32 = 9;
const STENCIL_BITS: core::ops::RangeInclusive<u32> = 8..=12;
const LONGEST_SHARED: usize = 48;

/// What has come twice.
#[derive(Clone, Default)]
struct Repeated<K> {
    key: K,
    hash: u32,
    string: Option<DomString>,
    /// Of the last other one.
    other_hash: u32,
}

impl<K> Repeated<K> {
    #[inline(always)]
    fn miss(&mut self, key: K, hash: u32, bytes: &[u8]) -> DomString {
        let string = DomString::from_latin1(bytes);
        if core::mem::replace(&mut self.other_hash, hash) == hash {
            (self.key, self.hash, self.string) = (key, hash, Some(string.clone()));
        }
        string
    }
}

/// Markup repeats itself.
pub(crate) struct Recent {
    tags: [Atom; Tag::ALL.len()],
    /// Whether an HTML element can be bare, once that was asked.
    are_plain: [Option<bool>; Tag::ALL.len()],
    /// `Element::own_state` of such an element without attributes.
    own_states: [Option<State>; Tag::ALL.len()],
    /// By their first and last eight characters.
    short: Box<[Repeated<[u64; 2]>]>,
    names: [Option<(ShortName, Atom)>; 1 << NAME_BITS],
    strings: [Repeated<()>; 1 << STRING_BITS],
    /// With the hash of the source of the tag that it is for, or of the last one that has come once.
    stencils: Box<[(u32, Option<Rc<Stencil>>)]>,
    stencil_bits: u32,
}

impl Recent {
    pub(super) fn new() -> Box<Recent> {
        let tags = core::array::from_fn(|it| Atom::new(Tag::ALL[it].name()));
        let (short, stencils) = Default::default();
        let mut recent = Box::new(Recent {
            tags,
            are_plain: [None; _],
            own_states: [None; _],
            names: [const { None }; _],
            strings: core::array::from_fn(|_| Repeated::default()),
            short,
            stencils,
            stencil_bits: 0,
        });
        recent.resize(*STENCIL_BITS.start());
        recent
    }

    fn resize(&mut self, stencil_bits: u32) {
        (self.stencil_bits, self.stencils) =
            (stencil_bits, vec![(0, None); 1 << stencil_bits].into());
        self.short = vec![Repeated::default(); 1 << (stencil_bits - 2).min(MOST_SHORT_BITS)].into();
    }

    #[inline(always)]
    fn stencil(&mut self, source: TagSource<'_>) -> &mut (u32, Option<Rc<Stencil>>) {
        &mut self.stencils[(source.hash >> (64 - self.stencil_bits)) as usize]
    }

    #[inline]
    fn name(&mut self, short: ShortName, chars: Chars<'_>) -> Atom {
        match &mut self.names[short.slot(NAME_BITS)] {
            Some((known, atom)) if *known == short => atom.clone(),
            slot => slot.insert((short, Atom::from_chars(chars))).1.clone(),
        }
    }

    fn wide_text(&mut self, units: &[u16]) -> StoredText {
        let mut narrow = [0; LONGEST_SHARED];
        if units.is_empty()
            || units.len() > narrow.len()
            || units.iter().fold(0, |all, it| all | it) > 0xff
        {
            return DomString::from_chars(Chars::Utf16(units)).into();
        }
        narrow
            .iter_mut()
            .zip(units)
            .for_each(|(to, from)| *to = *from as u8);
        self.narrow_text(&narrow[..units.len()])
    }

    #[inline(always)]
    pub(super) fn text(&mut self, chars: Chars<'_>) -> StoredText {
        match chars {
            Chars::Latin1(bytes) => self.narrow_text(bytes),
            Chars::Utf16(units) => self.wide_text(units),
        }
    }

    #[inline(always)]
    fn narrow_text(&mut self, bytes: &[u8]) -> StoredText {
        let (Some(first), chars) = (bytes.first(), Chars::Latin1(bytes)) else {
            return StoredText::default();
        };
        if bytes.len() > 16 {
            return if first.is_ascii_whitespace() && chars.is_all_spaces() {
                StoredText::Ascii(self.string(chars))
            } else {
                DomString::from_latin1(bytes).into()
            };
        }
        let ends = match (
            bytes.first_chunk(),
            bytes.last_chunk(),
            bytes.first_chunk(),
            bytes.last_chunk(),
        ) {
            (Some(head), Some(tail), ..) => [u64::from_le_bytes(*head), u64::from_le_bytes(*tail)],
            (.., Some(head), Some(tail)) => [
                u32::from_le_bytes(*head).into(),
                u32::from_le_bytes(*tail).into(),
            ],
            _ => [
                u64::from(*first) | u64::from(bytes[bytes.len() / 2]) << 8,
                bytes[bytes.len() - 1].into(),
            ],
        };
        if (ends[0] | ends[1]) & u64::from_le_bytes([0x80; 8]) != 0 {
            return DomString::from_latin1(bytes).into();
        }
        let hash = (ends[0] ^ ends[1].rotate_left(29))
            .wrapping_add(bytes.len() as u64)
            .wrapping_mul(0x9e37_79b9_7f4a_7c15);
        let with_len = (hash >> 16) as u32 & !31 | bytes.len() as u32;
        StoredText::Ascii(
            match &mut self.short
                [(hash >> (64 - MOST_SHORT_BITS)) as usize & (self.short.len() - 1)]
            {
                Repeated {
                    key,
                    hash,
                    string: Some(string),
                    ..
                } if (*key, *hash) == (ends, with_len) => string.clone(),
                slot => slot.miss(ends, with_len, bytes),
            },
        )
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
            Repeated {
                hash: known,
                string: Some(string),
                ..
            } if *known == (hash >> 16) as u32 && string.latin1() == Some(bytes) => string.clone(),
            slot => slot.miss((), (hash >> 16) as u32, bytes),
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
    /// `Node::above_bare`
    above: [Above; 2],
    /// `dormant::can_be_in`, once that was asked.
    takes_dormant: Option<bool>,
    added: u32,
}

impl Drop for Sink<'_, '_> {
    fn drop(&mut self) {
        self.stop_growing();
        html::Sink::publish(self);
        self.doc.arena().recent_markup.set(self.recent.take());
    }
}

const MUCH_MARKUP: usize = 1 << 15;

/// Makes room for what is about to be parsed. `total` includes what the parser has got before.
#[inline]
pub(super) fn expect_markup(doc: &Doc, markup: Chars<'_>, total: usize) {
    if total >= MUCH_MARKUP {
        expect_much_markup(doc, markup, total);
    }
}

#[cold]
fn expect_much_markup(doc: &Doc, markup: Chars<'_>, total: usize) {
    let tags = match markup {
        Chars::Latin1(bytes) => bun_core::strings::count_char(bytes, b'<'),
        Chars::Utf16(units) => units.iter().filter(|it| **it == u16::from(b'<')).count(),
    };
    doc.arena()
        .write(|engine| engine.tree.expect((tags * 3 / 2).min(1 << 20)));
    let (mut recent, bits) = (
        doc.arena().recent_markup.take().unwrap_or_else(Recent::new),
        (total.ilog2() - 6).min(*STENCIL_BITS.end()),
    );
    if recent.stencil_bits < bits {
        recent.resize(bits);
    }
    doc.arena().recent_markup.set(Some(recent));
}

#[inline]
pub(super) fn markup_was_parsed(doc: &Doc, total: usize) {
    if total >= MUCH_MARKUP
        && let Some(mut recent) = doc.arena().recent_markup.take()
    {
        recent.resize(*STENCIL_BITS.start());
        doc.arena().recent_markup.set(Some(recent));
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

fn state_if_dormant(doc: &Doc, tag: Tag, attributes: &[Attribute<Cells>]) -> Option<State> {
    let tag = match tag {
        Tag::Input => atom!("input"),
        Tag::Button => atom!("button"),
        _ => return None,
    };
    dormant::state_of(tag, attributes.iter().map(|it| (&it.name, &it.value)))
        .inspect(|_| doc.prepare_for_dormant_controls())
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
            above: [Above::Detached; 2],
            takes_dormant: None,
            added: 0,
        }
    }

    /// With the owner, if what is appended to it can be bare.
    #[inline(always)]
    fn bare_parent(&mut self, parent: JSValue) -> Option<(&'a Node, NodeId, Above)> {
        if parent.is_int32() {
            return Some((self.owner?, parent.as_int32() as NodeId, self.above[1]));
        }
        let parent = self.node(parent);
        if self.owner != Some(parent) {
            self.change_owner(parent)?;
        }
        Some((parent, parent.id(), self.above[0]))
    }

    fn change_owner(&mut self, owner: &'a Node) -> Option<()> {
        (owner.takes_bare() && owner.is_in_arena_of(self.doc)).then_some(())?;
        html::Sink::publish(self);
        (self.owner, self.above, self.takes_dormant) = (Some(owner), owner.above_bare(), None);
        Some(())
    }

    #[inline(always)]
    fn appended(&mut self, owner: &Node, parent: NodeId, child: Result<NodeId, NodeId>) -> NodeId {
        owner.set(F::HAS_BARE_CHILDREN);
        self.added += 1;
        child.unwrap_or_else(|it| owner.finish_appending(parent, it))
    }

    fn append_with_attributes(
        &mut self,
        local: Atom,
        namespace: Namespace,
        attributes: &mut Vec<Attribute<Cells>>,
        owner: &Node,
        parent: NodeId,
        above: Above,
        state: State,
    ) -> Option<(Result<NodeId, NodeId>, bool)> {
        let (doc, mut has_id) = (owner.doc(), false);
        for it in attributes.iter() {
            has_id |= it.name == atom!("id");
            if it.namespace != AttributeNamespace::None
                || bare::needs_object(&it.name)
                || chooses_definition(it)
                || it.name == atom!("style") && doc.is(DocFlags::CHECKS_STYLE_ATTRIBUTES)
            {
                return None;
            }
        }
        let namespace = match namespace {
            Namespace::Html => tree::Namespace::Html,
            Namespace::Svg => tree::Namespace::Svg,
            Namespace::MathMl => tree::Namespace::MathMl,
        };
        let appended = owner.arena().write(|engine| {
            let mut element = engine.element_with(
                local,
                namespace,
                attributes.drain(..).map(|it| (it.name, it.value.into())),
                doc.quirks(),
            );
            element.state = state;
            let (keys, own) = (
                filter_of(&element),
                if above == Above::New {
                    element.own_state()
                } else {
                    None
                },
            );
            engine.append_bare_element(parent, above, element, keys, own)
        });
        Some((appended, has_id))
    }

    pub(super) fn append_stored_quietly(&mut self, text: &StoredText, parent: JSValue) -> bool {
        let Some((owner, parent, above)) = self.bare_parent(parent) else {
            return false;
        };
        let appended = owner
            .arena()
            .write(|engine| engine.append_bare_text(parent, above, text.clone()));
        self.appended(owner, parent, appended);
        true
    }

    /// With attributes in no namespace that mean nothing to an element without steps. `last` was written with the same name.
    pub(super) fn append_named_quietly<'t>(
        &mut self,
        parent: JSValue,
        name: QualName,
        attributes: impl Iterator<Item = (&'t Atom, &'t StoredText)> + Clone,
        count: usize,
        last: &mut Option<tree::Likeness>,
    ) -> Option<JSValue> {
        let (kind, namespace) = match name.ns {
            Ns::Html => (
                Some(Kind::of_html(name.local.known())).filter(|it| *it != Kind::Unknown)?,
                tree::Namespace::Html,
            ),
            Ns::Svg => (Kind::of_svg(name.local.known()), tree::Namespace::Svg),
            Ns::MathMl => (Kind::MathMl, tree::Namespace::MathMl),
            _ => (Kind::Element, tree::Namespace::Other),
        };
        self.doc.prepare_for_bare(kind).then_some(())?;
        let (owner, parent, above) = self
            .bare_parent(parent)
            .filter(|it| !has_scoped_registries() && !it.0.has(F::SHADOW_ROOT))?;
        let needs_space = name.prefix.is_some()
            || matches!(name.ns, Ns::Other(_) | Ns::XLink | Ns::Xml | Ns::Xmlns);
        last.take_if(|it| {
            it.namespace != namespace
                || it.space.as_ref().map(|it| &it.ns) != needs_space.then_some(&name.ns)
        });
        let is_same = |(a, b): (&tree::Attribute, (&Atom, &StoredText))| {
            a.local == *b.0 && core::ptr::eq(a.value.string().as_impl(), b.1.string().as_impl())
        };
        let (appended, has_id) = owner.arena().write(|engine| {
            let (element, keys) = match last {
                Some(last)
                    if last.attributes.len() == count
                        && last.attributes.iter().zip(attributes.clone()).all(is_same) =>
                {
                    (engine.element_like(last), last.keys)
                }
                _ => {
                    let space = last.take().map_or_else(
                        || needs_space.then(|| tree::Space::new(name.ns, name.prefix)),
                        |it| it.space,
                    );
                    let mut all = attributes.map(|it| (it.0.clone(), it.1.clone()));
                    let mut element = engine.element_with(
                        name.local,
                        namespace,
                        (0..count).map(|_| all.next().expect("as many")),
                        owner.doc().quirks(),
                    );
                    space
                        .into_iter()
                        .for_each(|it| element.rare_mut().space = Some(it));
                    let keys = filter_of(&element);
                    *last = Some(tree::Likeness::of(&mut element, keys));
                    (element, keys)
                }
            };
            let has_id = element.id != crate::name::Name::NONE;
            (
                engine.append_bare_element(parent, above, element, keys, None),
                has_id,
            )
        });
        let id = self.appended(owner, parent, appended);
        if has_id {
            owner.note_id_of_bare(&self.cx.heap, id);
        }
        Some(JSValue::js_number_from_int32(id as i32))
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

    /// A stencil has it by itself.
    #[inline(never)]
    fn state_if_dormant_there(
        &mut self,
        tag: Tag,
        element: &NewElement<'_, Cells>,
    ) -> Option<State> {
        let state = match element.stencil {
            Some(stencil) => stencil.mould.is_dormant().then_some(State::empty()),
            None => state_if_dormant(self.doc, tag, element.attributes),
        }?;
        let (owner, ..) = self.bare_parent(element.intended_parent)?;
        self.takes_dormant
            .get_or_insert_with(|| dormant::can_be_in(owner))
            .then_some(state)
    }

    #[cold]
    fn find_out_if_plain(&mut self, tag: Tag) -> bool {
        let is_plain = self
            .doc
            .prepare_for_bare(Kind::of_html(self.recent().tags[tag as usize].known()));
        self.recent().own_states[tag as usize] = tree::Element::new(
            self.recent().tags[tag as usize].name(),
            tree::Namespace::Html,
        )
        .own_state();
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
            super::before_constructing(self.cx, parent, &name.local, is.as_ref());
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
                if stencil.mould.is_dormant() {
                    doc.prepare_for_dormant_controls();
                }
                return stencil.mould.create(&self.cx.heap, doc);
            }
            element
                .attributes
                .extend(<Cells as html::Dom>::attributes_of(stencil));
        }
        if let (Namespace::Html, &ElementName::Known(tag @ (Tag::Input | Tag::Button))) =
            (element.namespace, &element.name)
            && !(chooses_registry
                || doc.is(DocFlags::CHECKS_STYLE_ATTRIBUTES)
                || element.attributes.iter().any(chooses_definition))
            && let Some(state) = state_if_dormant(doc, tag, element.attributes)
        {
            let local = self.recent().tags[tag as usize].known();
            return Mould::new(
                doc,
                local,
                element.attributes.drain(..).map(|it| (it.name, it.value)),
                Some(state),
            )
            .create(&self.cx.heap, doc);
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
        let dormant = state_if_dormant(doc, tag, attributes);
        if tag == Tag::Script
            || attributes.iter().any(chooses_definition)
            || dormant.is_none()
                && !Mould::can_hold(doc, local, attributes.iter().map(|it| &it.name))
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
            dormant,
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

    #[inline(always)]
    fn append_element_quietly(&mut self, element: NewElement<'_, Cells>) -> Option<JSValue> {
        let (mut own, mut state) = (None, State::empty());
        let local = match (element.namespace, &element.name) {
            (Namespace::Html, &ElementName::Known(tag)) => {
                let recent = self.recent();
                if !recent.are_plain[tag as usize].unwrap_or_else(|| self.find_out_if_plain(tag)) {
                    state = self.state_if_dormant_there(tag, &element)?;
                }
                own = self.recent().own_states[tag as usize];
                self.recent().tags[tag as usize].clone()
            }
            (Namespace::Html, _) => return None,
            (namespace, name) => {
                let local = match *name {
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
        let (owner, parent, above) = self.bare_parent(element.intended_parent)?;
        if has_scoped_registries() || owner.has(F::SHADOW_ROOT) && parent == owner.id() {
            return None;
        }
        let (appended, has_id) = match element.stencil {
            Some(stencil) => {
                (local == stencil.mould.local() && stencil.mould.fits(owner.doc())).then_some(())?;
                (
                    self.doc
                        .arena()
                        .write(|engine| stencil.mould.append_bare(engine, parent, above)),
                    stencil.mould.has_id(),
                )
            }
            None if element.attributes.is_empty() && own.is_some() => {
                let appended = self.doc.arena().write(|engine| {
                    let tag = local.name();
                    let element = engine
                        .tree
                        .new_element(tag, tree::Namespace::Html, |it| it.local = local);
                    engine.append_bare_element(
                        parent,
                        above,
                        element,
                        filter(core::iter::once(key::tag(tag))),
                        own,
                    )
                });
                (appended, false)
            }
            None => self.append_with_attributes(
                local,
                element.namespace,
                element.attributes,
                owner,
                parent,
                above,
                state,
            )?,
        };
        let id = self.appended(owner, parent, appended);
        if has_id {
            owner.note_id_of_bare(&self.cx.heap, id);
        }
        Some(JSValue::js_number_from_int32(id as i32))
    }

    #[inline(always)]
    fn append_text_quietly(&mut self, text: Chars<'_>, parent: JSValue) -> bool {
        let Some((owner, parent, above)) = self.bare_parent(parent) else {
            return false;
        };
        let arena = self.doc.arena();
        if let Some(previous) = arena.read(|engine| engine.tree.text_at_end_of(parent)) {
            self.extend_bare(previous, text);
            return true;
        }
        let data = self.recent().text(text);
        let appended = arena.write(|engine| engine.append_bare_text(parent, above, data));
        self.appended(owner, parent, appended);
        true
    }

    fn append_comment_quietly(&mut self, data: Chars<'_>, parent: JSValue) -> bool {
        let Some((owner, parent, _)) = self.bare_parent(parent) else {
            return false;
        };
        self.doc.prepare_for_bare(Kind::Comment);
        owner.append_bare_comment(parent, DomString::from_chars(data));
        self.appended(owner, parent, Ok(0));
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
            crate::api::forms::associate_by_parser(
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
