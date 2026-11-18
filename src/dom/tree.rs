//! The part of the DOM that styles and layout need. JavaScript has the whole of it, and mirrors what is connected.

use core::cell::{Cell, RefCell};
use core::hint::{Locality, prefetch_read, prefetch_write};
use core::sync::atomic::{AtomicU32, Ordering};
use std::borrow::Cow;
use std::rc::Rc;

use smallvec::SmallVec;

use crate::api::core::bare::Sketch;
use crate::api::core::{Atom, DomString, Ns, QualName, StoredText};

use crate::boxes::BoxId;
use crate::cascade::RuleList;
use crate::name::{Map, Name, Set, name};
use crate::properties::Style;
use crate::rules::Classes;
use crate::selector::{Found, Pseudo};
use crate::sequence::Sequence;
use crate::sheet::Block;

/// 0 is no node.
pub(crate) type NodeId = u32;

bitflags::bitflags! {
    #[derive(Clone, Copy, Default, PartialEq, Eq)]
    pub(crate) struct State: u32 {
        const HOVER = 1;
        const ACTIVE = 1 << 1;
        const FOCUS = 1 << 2;
        const FOCUS_VISIBLE = 1 << 3;
        const FOCUS_WITHIN = 1 << 4;
        const CHECKED = 1 << 5;
        const INDETERMINATE = 1 << 6;
        const PLACEHOLDER_SHOWN = 1 << 7;
        const VALID = 1 << 8;
        const INVALID = 1 << 9;
        const USER_VALID = 1 << 10;
        const USER_INVALID = 1 << 11;
        const IN_RANGE = 1 << 12;
        const OUT_OF_RANGE = 1 << 13;
        const DEFAULT = 1 << 14;
        const MODAL = 1 << 15;
        const POPOVER_OPEN = 1 << 16;
        const UNDEFINED = 1 << 17;
        const TARGET = 1 << 18;
        const FULLSCREEN = 1 << 19;
        const PICKER_OPEN = 1 << 20;
        const FORM_ASSOCIATED = 1 << 21;
        /// Of the parts of a scrollbar.
        const HORIZONTAL = 1 << 22;
        const VERTICAL = 1 << 23;

        const LINK = 1 << 24;
        const DISABLED = 1 << 25;
        const ENABLED = 1 << 26;
        const REQUIRED = 1 << 27;
        const OPTIONAL = 1 << 28;
        const READ_WRITE = 1 << 29;
        const OPEN = 1 << 30;
        const RTL = 1 << 31;
    }
}

bitflags::bitflags! {
    #[derive(Clone, Copy, Default, PartialEq, Eq)]
    pub(crate) struct Flags: u32 {
        const REMATCH = 1;
        const RECASCADE = 1 << 1;
        const REMATCH_SUBTREE = 1 << 2;
        const DIRTY_DESCENDANTS = 1 << 3;
        /// The children's boxes have to be made again.
        const REBUILD = 1 << 4;
        const REBUILD_BELOW = 1 << 5;
        const RECASCADE_SUBTREE = 1 << 6;
        /// An animation has advanced, or the `style` attribute has changed.
        const REANIMATE = 1 << 7;

        /// What matching a selector has depended on.
        const EDGE_CHILDREN = 1 << 8;
        const CHILD_INDEX = 1 << 9;
        const NEXT_SIBLING = 1 << 10;
        const LATER_SIBLINGS = 1 << 11;
        const EMPTINESS = 1 << 12;
        const HAS_ANCHOR = 1 << 13;
        const QUERIES_CONTAINER = 1 << 14;
        /// Its values depend on a container.
        const MEASURES_CONTAINER = 1 << 22;
        const IS_MEASURED = 1 << 28;
        /// It is in `Stylist::answers`.
        const HAS_ANSWERED = 1 << 29;
        const COUNTED_CHILDREN = 1 << 15;

        const TOP_LAYER = 1 << 16;
        const ANIMATED = 1 << 17;
        /// `content-visibility` skips the contents.
        const SKIPPED = 1 << 18;
        const AUTO_DIRECTION = 1 << 19;
        const VISITED = 1 << 20;
        /// A `select` with `appearance: base-select`.
        const BASE_SELECT = 1 << 30;
        /// Of a root: a document that is not rendered.
        const OTHER_DOCUMENT = 1 << 30;
        /// A `select` whose picker, or list box, has it.
        const BASE_OPTIONS = 1 << 31;
        const KEYFRAMES_CHANGED = 1 << 21;
        /// The renderer already shows what the animations have advanced to.
        const CATCHES_UP = 1 << 23;
        const WATCHED_BY_TIMELINE = 1 << 27;
        /// A shadow host or a slot.
        const REDIRECTS_CHILDREN = 1 << 24;
        /// The style is older than what its throttled animations have advanced to.
        const LAGS = 1 << 25;
        /// It is in `Locks::missed`.
        const HAS_MISSED = 1 << 26;

        const STYLE_DIRTY = Self::REMATCH.bits() | Self::RECASCADE.bits() | Self::REMATCH_SUBTREE.bits()
            | Self::RECASCADE_SUBTREE.bits() | Self::REANIMATE.bits() | Self::KEYFRAMES_CHANGED.bits();
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Namespace {
    Html,
    Svg,
    MathMl,
    Other,
}

/// Of a name that has more than a local name.
pub(crate) struct Space {
    pub(crate) ns: Ns,
    pub(crate) prefix: Option<Atom>,
    pub(crate) uri: Box<str>,
    /// An attribute that scripts do not see.
    pub(crate) is_hidden: bool,
}

impl Space {
    pub(crate) fn new(ns: Ns, prefix: Option<Atom>) -> Rc<Space> {
        Rc::new(Space {
            uri: ns.as_utf8().into(),
            ns,
            prefix,
            is_hidden: false,
        })
    }
}

#[derive(Clone)]
pub(crate) struct Attribute {
    /// Of `qualified`.
    pub(crate) name: Name,
    pub(crate) local: Atom,
    pub(crate) space: Option<Rc<Space>>,
    pub(crate) value: StoredText,
    /// `key::value`
    pub(crate) key: Name,
}

impl Attribute {
    /// The local name, and then a space and the namespace if there is one.
    pub(crate) fn qualified(&self) -> Cow<'_, str> {
        match &self.space {
            Some(space) if !space.uri.is_empty() => {
                Cow::Owned(format!("{} {}", self.local.as_utf8(), space.uri))
            }
            _ => self.local.as_utf8(),
        }
    }
}

/// Where `inline_style` is from.
#[derive(Clone, Copy, PartialEq)]
pub(crate) enum StyleSource {
    Attribute,
    /// A script has changed it, and the attribute has yet to follow.
    Edited,
    /// The attribute is its serialization.
    Serialized,
}

/// Elements that were made alike share them until one changes.
#[derive(Clone)]
pub(crate) enum Attributes {
    Own(Vec<Attribute>),
    Shared(Rc<[Attribute]>),
}

impl Attributes {
    fn unshare(&mut self) {
        *self = Attributes::Own(self.to_vec());
    }

    #[inline(always)]
    pub(crate) fn to_mut(&mut self) -> &mut Vec<Attribute> {
        if let Attributes::Shared(_) = self {
            self.unshare();
        }
        match self {
            Attributes::Own(own) => own,
            Attributes::Shared(_) => unreachable!(),
        }
    }

    /// With room for another.
    #[inline]
    pub(crate) fn to_mut_for_more(&mut self) -> &mut Vec<Attribute> {
        if let Attributes::Shared(shared) = self {
            let mut own = Vec::with_capacity(shared.len() + 1);
            own.extend_from_slice(shared);
            *self = Attributes::Own(own);
        }
        let own = self.to_mut();
        if own.len() == own.capacity() {
            own.reserve_exact(1 + own.len() / 2);
        }
        own
    }

    #[inline]
    pub(crate) fn share(&mut self) -> Attributes {
        if let Attributes::Own(own) = self
            && !own.is_empty()
        {
            *self = Attributes::Shared(core::mem::take(own).into());
        }
        self.clone()
    }
}

impl core::ops::Deref for Attributes {
    type Target = [Attribute];
    #[inline(always)]
    fn deref(&self) -> &[Attribute] {
        match self {
            Attributes::Own(own) => own,
            Attributes::Shared(shared) => shared,
        }
    }
}

impl<'a> IntoIterator for &'a Attributes {
    type Item = &'a Attribute;
    type IntoIter = core::slice::Iter<'a, Attribute>;
    #[inline(always)]
    fn into_iter(self) -> Self::IntoIter {
        self.iter()
    }
}

/// What a copy has of an element.
#[derive(Clone)]
pub(crate) struct Likeness {
    pub(crate) tag: Name,
    pub(crate) namespace: Namespace,
    pub(crate) local: Atom,
    pub(crate) space: Option<Rc<Space>>,
    pub(crate) is_unprepared: bool,
    pub(crate) id: Name,
    pub(crate) classes: Option<Rc<Classes>>,
    pub(crate) attributes: Attributes,
    pub(crate) keys: u64,
}

impl Likeness {
    #[inline(always)]
    pub(crate) fn of(it: &mut Element, keys: u64) -> Likeness {
        Likeness {
            tag: it.tag,
            namespace: it.namespace,
            local: it.local.clone(),
            space: it.space.clone(),
            is_unprepared: it.is_unprepared
                || it.inline_style.is_some()
                || it.hints.is_some()
                || it.is_style_refused,
            id: it.id,
            classes: it.classes.clone(),
            attributes: it.attributes.share(),
            keys,
        }
    }
}

/// What an `img`, a `canvas` or the like shows.
#[derive(Clone, Copy, Default, PartialEq)]
pub(crate) struct Replaced {
    pub(crate) image: u32,
    pub(crate) size: [Option<f32>; 2],
    pub(crate) ratio: Option<f32>,
}

/// What is used together shares cache lines.
#[repr(C)]
pub(crate) struct Element {
    pub(crate) tag: Name,
    pub(crate) classes: Option<Rc<Classes>>,
    pub(crate) style: Option<Rc<Style>>,
    /// Without the animations.
    pub(crate) base_style: Option<Rc<Style>>,
    pub(crate) rules: Option<Rc<RuleList>>,
    pub(crate) id: Name,
    pub(crate) state: State,
    pub(crate) originator: NodeId,
    pub(crate) namespace: Namespace,
    /// `inline_style` and `hints` may not be what the attributes say.
    pub(crate) is_unprepared: bool,
    /// What `generated_by_rules` has last found.
    pub(crate) generated_by_rules: Option<u8>,
    pub(crate) is_style_refused: bool,
    /// A child may depend on the properties that are not inherited.
    pub(crate) is_depended_on: bool,
    pub(crate) style_source: StyleSource,
    /// Which of `Rare::USUAL` stands in for `rare`.
    usual: u8,
    /// `::marker`, `::before`, `::after` and `::backdrop`.
    pub(crate) generated: [NodeId; 4],
    pub(crate) attributes: Attributes,
    pub(crate) inline_style: Option<Rc<Block>>,
    pub(crate) local: Atom,
    rare: Option<Box<Rare>>,
}

const _: () = assert!(size_of::<Element>() == 128);

/// What most elements do not have.
pub(crate) struct Rare {
    /// What a generated element, or one in the shadow tree of a control, is to `originator`.
    pub(crate) pseudo: Pseudo,
    pub(crate) shadow_root: NodeId,
    pub(crate) hints: Option<Rc<Block>>,
    pub(crate) custom_states: Vec<Name>,
    pub(crate) replaced: Option<Replaced>,
    /// If it has a prefix, or `Namespace::Other`.
    pub(crate) space: Option<Rc<Space>>,
    /// For a slot.
    pub(crate) assigned: Vec<NodeId>,
    pub(crate) scroll: [f32; 2],
    /// The content box that container queries were last evaluated with.
    pub(crate) container_size: Option<[f32; 2]>,
    /// For `contain-intrinsic-size: auto`.
    /// Inline and block.
    pub(crate) remembered_size: [Option<f32>; 2],
}

impl Rare {
    const USUAL: [Rare; 4] = [
        Rare::of(Pseudo::None),
        Rare::of(Pseudo::Marker),
        Rare::of(Pseudo::Before),
        Rare::of(Pseudo::After),
    ];

    const fn of(pseudo: Pseudo) -> Rare {
        Rare {
            pseudo,
            shadow_root: 0,
            hints: None,
            custom_states: Vec::new(),
            replaced: None,
            space: None,
            assigned: Vec::new(),
            scroll: [0.0; 2],
            container_size: None,
            remembered_size: [None; 2],
        }
    }
}

impl core::ops::Deref for Element {
    type Target = Rare;
    #[inline(always)]
    fn deref(&self) -> &Rare {
        self.rare
            .as_deref()
            .unwrap_or_else(|| &const { &Rare::USUAL }[usize::from(self.usual) % 4])
    }
}

pub(crate) const MARKER: usize = 0;
pub(crate) const BEFORE: usize = 1;
pub(crate) const AFTER: usize = 2;
pub(crate) const BACKDROP: usize = 3;

impl Element {
    pub(crate) fn namespace_uri(&self) -> &str {
        match self.namespace {
            Namespace::Html => "http://www.w3.org/1999/xhtml",
            Namespace::Svg => "http://www.w3.org/2000/svg",
            Namespace::MathMl => "http://www.w3.org/1998/Math/MathML",
            Namespace::Other => self.space.as_ref().map_or("", |it| &it.uri),
        }
    }

    pub(crate) fn set_custom_state(&mut self, name: Name, on: bool) {
        let states = &mut self.rare_mut().custom_states;
        states.retain(|it| *it != name);
        states.extend(on.then_some(name));
    }

    pub(crate) fn unassign(&mut self, id: NodeId) {
        let Some(Rare { assigned, .. }) = self.rare_if_any() else {
            return;
        };
        let index = if assigned.last() == Some(&id) {
            Some(assigned.len() - 1)
        } else {
            assigned.iter().position(|it| *it == id)
        };
        index.map(|it| assigned.remove(it));
    }

    pub(crate) fn attributes_besides_class(&self) -> impl Iterator<Item = &Attribute> {
        let all = if self.has_only_classes() {
            &[]
        } else {
            &*self.attributes
        };
        all.iter().filter(|it| it.name != name!("class"))
    }

    /// It has no attribute but `class`.
    pub(crate) fn has_only_classes(&self) -> bool {
        self.attributes.len() == usize::from(self.classes.is_some())
    }

    #[inline(always)]
    pub(crate) fn new(tag: Name, namespace: Namespace) -> Element {
        Element {
            tag,
            namespace,
            local: Atom::EMPTY,
            is_unprepared: false,
            is_style_refused: false,
            is_depended_on: false,
            style_source: StyleSource::Attribute,
            id: Name::NONE,
            classes: None,
            attributes: Attributes::Own(Vec::new()),
            state: State::empty(),
            inline_style: None,
            originator: 0,
            usual: 0,
            generated: [0; 4],
            generated_by_rules: None,
            rules: None,
            base_style: None,
            style: None,
            rare: None,
        }
    }

    pub(crate) fn rare_mut(&mut self) -> &mut Rare {
        let pseudo = self.pseudo;
        self.rare.get_or_insert_with(|| Box::new(Rare::of(pseudo)))
    }

    pub(crate) fn set_pseudo(&mut self, pseudo: Pseudo, originator: NodeId) {
        self.originator = originator;
        match const { &Rare::USUAL }
            .iter()
            .position(|it| it.pseudo == pseudo)
            .filter(|_| self.rare.is_none())
        {
            Some(usual) => self.usual = usual as u8,
            None => self.rare_mut().pseudo = pseudo,
        }
    }

    pub(crate) fn has_rare(&self) -> bool {
        self.rare.is_some()
    }

    /// To take something away.
    pub(crate) fn rare_if_any(&mut self) -> Option<&mut Rare> {
        self.rare.as_deref_mut()
    }

    pub(crate) fn classes(&self) -> &[Name] {
        self.classes.as_ref().map_or(&[], |it| it)
    }

    pub(crate) fn attribute(&self, name: Name) -> Option<&str> {
        let found = self
            .attributes
            .iter()
            .find(|attribute| attribute.name == name);
        found.map(|attribute| self.value_of(attribute))
    }

    #[inline]
    pub(crate) fn value_of<'a>(&'a self, attribute: &'a Attribute) -> &'a str {
        match self.style_source == StyleSource::Edited && attribute.name == name!("style") {
            true => self
                .inline_style
                .as_ref()
                .map_or("", |it| crate::values::text(it.editable().text())),
            false => &attribute.value,
        }
    }

    pub(crate) fn has(&self, name: Name) -> bool {
        self.attribute(name).is_some()
    }

    pub(crate) fn number(&self, name: Name) -> Option<f32> {
        let value = self.attribute(name)?.trim_ascii_start();
        let is_part = |(index, byte): &(usize, u8)| {
            byte.is_ascii_digit() || *byte == b'.' || (*index == 0 && matches!(byte, b'-' | b'+'))
        };
        value[..value.bytes().enumerate().take_while(is_part).count()]
            .parse()
            .ok()
    }

    /// `Name::NONE` for an element that is not HTML.
    pub(crate) fn html_tag(&self) -> Name {
        match self.namespace {
            Namespace::Html => self.tag,
            _ => Name::NONE,
        }
    }

    #[inline]
    pub(crate) fn is_generated(&self) -> bool {
        self.tag == name!("") || self.originator != 0 && matches!(self.pseudo, Pseudo::Scroll(_))
    }
}

/// A comment, a processing instruction, a doctype or an attribute node.
#[derive(Clone)]
pub(crate) struct Inert {
    pub(crate) name: QualName,
    /// The public id of a doctype.
    pub(crate) data: DomString,
    pub(crate) system_id: DomString,
}

pub(crate) enum Data {
    Free,
    Element(Box<Element>),
    Text(StoredText),
    /// It is never linked.
    Inert(Box<Inert>),
    /// A document, or a fragment.
    Root,
    ShadowRoot {
        host: NodeId,
        user_agent: bool,
    },
}

#[derive(Clone, Copy)]
pub(crate) enum Fact {
    /// No ancestor in the flat tree skips its contents.
    Unskipped = 1,
    /// Its text decides the direction of nothing.
    Undirecting = 2,
}

/// What was found out by visiting the ancestors of rendered nodes.
pub(crate) struct Ancestry {
    /// The node, `epoch` and the facts.
    known: [Cell<u64>; 256],
    epoch: Cell<u32>,
}

impl Default for Ancestry {
    fn default() -> Ancestry {
        Ancestry {
            known: [const { Cell::new(0) }; 256],
            epoch: Cell::new(0),
        }
    }
}

impl Ancestry {
    const FACTS: u32 = 3;

    #[inline(always)]
    fn entry(&self, id: NodeId) -> (&Cell<u64>, u64) {
        (
            &self.known[id as usize % self.known.len()],
            u64::from(id) << 32 | u64::from(self.epoch.get()),
        )
    }

    #[inline(always)]
    pub(crate) fn has(&self, id: NodeId, fact: Fact) -> bool {
        let (entry, without_facts) = self.entry(id);
        (entry.get() ^ without_facts) & !u64::from(Ancestry::FACTS - fact as u32) == fact as u64
    }

    /// Of a node and of ancestors, in that order.
    pub(crate) fn note(&self, path: &[NodeId], fact: Fact) {
        for (entry, without_facts) in path.iter().rev().map(|it| self.entry(*it)) {
            entry.update(|it| if it & !u64::from(Ancestry::FACTS) == without_facts { it } else { without_facts } | fact as u64);
        }
    }

    #[inline(always)]
    pub(crate) fn forget(&self, id: NodeId) {
        self.entry(id)
            .0
            .update(|it| if it >> 32 == u64::from(id) { 0 } else { it });
    }

    #[inline]
    pub(crate) fn forget_all(&self) {
        self.epoch.update(|it| it.wrapping_add(Ancestry::FACTS + 1));
        if self.epoch.get() == 0 {
            self.known.iter().for_each(|it| it.set(0));
        }
    }
}

/// A cache line. The rest is in `Cold`.
#[repr(C, align(64))]
pub(crate) struct Node {
    /// `selector::filter` of `key::of_element`
    pub(crate) keys: u64,
    /// The `keys` of its shadow-including descendants, and some that they had.
    keys_below: u64,
    pub(crate) parent: NodeId,
    pub(crate) first_child: NodeId,
    pub(crate) next: NodeId,
    /// For text and for an inline element, the first box whose lines it is in.
    pub(crate) layout_box: BoxId,
    pub(crate) flags: Cell<Flags>,
    pub(crate) slot: NodeId,
    pub(crate) previous: NodeId,
    /// The document or the shadow root that it is in.
    pub(crate) scope: NodeId,
    pub(crate) data: Data,
}

const _: () = assert!(size_of::<Node>() == 64);

#[derive(Default)]
pub(crate) struct Cold {
    /// The JavaScript object, a `Sketch`, or null.
    cell: Cell<*const crate::api::core::Node>,
    pub(crate) last_child: NodeId,
    /// With `DIRTY_DESCENDANTS`, the child that has them all, or 0. Of a bare comment, the one before it in its parent.
    dirty_child: Cell<NodeId>,
    /// While its descendants are being styled, a number that is greater than those of its ancestors. Of a bare comment, the child that it follows.
    visit: Cell<u32>,
    /// Of the bare ones among its children.
    last_comment: Cell<NodeId>,
}

pub(crate) enum Step {
    Enter(NodeId),
    /// Text, or a comment.
    Visit(NodeId),
    Leave,
}

/// Through bare descendants.
pub(crate) struct Walk {
    root: NodeId,
    parent: NodeId,
    last: NodeId,
    next: NodeId,
    /// With the parent, and the child that it follows.
    comments: Vec<[NodeId; 3]>,
}

impl Walk {
    pub(crate) fn below(tree: &Tree, root: NodeId) -> Walk {
        let mut walk = Walk {
            root,
            parent: 0,
            last: 0,
            next: 0,
            comments: Vec::new(),
        };
        walk.enter(tree, root);
        walk
    }

    #[inline(always)]
    fn enter(&mut self, tree: &Tree, id: NodeId) {
        (self.parent, self.last, self.next) = (id, 0, tree[id].first_child);
        if tree.cold[id as usize].last_comment.get() != 0 {
            self.comments.extend(
                tree.comments_in(id)
                    .map(|(comment, after)| [comment, id, after]),
            );
        }
    }

    #[inline(always)]
    pub(crate) fn step(&mut self, tree: &Tree) -> Option<Step> {
        if let Some([comment, ..]) = self
            .comments
            .pop_if(|it| it[1..] == [self.parent, self.last])
        {
            return Some(Step::Visit(comment));
        }
        let id = self.next;
        if id == 0 {
            return (self.parent != self.root).then(|| {
                self.skip(tree);
                Step::Leave
            });
        }
        tree.prefetch_after(id);
        if tree[id].element().is_some() {
            self.enter(tree, id);
            return Some(Step::Enter(id));
        }
        (self.last, self.next) = (id, tree[id].next);
        Some(Step::Visit(id))
    }

    /// Leaves what was entered.
    #[inline(always)]
    pub(crate) fn skip(&mut self, tree: &Tree) {
        while self.comments.pop_if(|it| it[1] == self.parent).is_some() {}
        let node = &tree[self.parent];
        (self.last, self.next, self.parent) = (self.parent, node.next, node.parent);
    }
}

static FREED_NODES: AtomicU32 = AtomicU32::new(0);

#[unsafe(no_mangle)]
extern "C" fn Bun__DOM__freedNodes() -> u32 {
    FREED_NODES.load(Ordering::Relaxed)
}

impl Node {
    fn new(data: Data) -> Node {
        Node {
            parent: 0,
            first_child: 0,
            previous: 0,
            next: 0,
            scope: 0,
            slot: 0,
            layout_box: 0,
            flags: Cell::default(),
            keys: 0,
            keys_below: 0,
            data,
        }
    }

    pub(crate) fn element(&self) -> Option<&Element> {
        match &self.data {
            Data::Element(element) => Some(element),
            _ => None,
        }
    }

    pub(crate) fn text(&self) -> Option<&[u8]> {
        match &self.data {
            Data::Text(text) => Some(text.as_bytes()),
            _ => None,
        }
    }

    pub(crate) fn stored_text(&self) -> Option<&StoredText> {
        if let Data::Text(text) = &self.data {
            Some(text)
        } else {
            None
        }
    }

    pub(crate) fn has(&self, flags: Flags) -> bool {
        self.flags.get().intersects(flags)
    }

    pub(crate) fn set(&self, flags: Flags) {
        self.flags.set(self.flags.get() | flags);
    }

    pub(crate) fn unset(&self, flags: Flags) {
        self.flags.set(self.flags.get() - flags);
    }
}

/// Gives the lowest id first, so that what is created together is close in memory.
#[derive(Default)]
pub(crate) struct FreeList {
    /// A bit for each id.
    ids: Vec<u64>,
    /// A bit for each of `ids` that is not 0.
    words: Vec<u64>,
    /// Those of `words` that are before it are 0.
    first: usize,
    len: usize,
    /// The first of `ids` that was not 0, which is taken out of them, and its index.
    lowest: (u64, usize),
}

impl FreeList {
    #[inline]
    pub(crate) fn push(&mut self, id: u32) {
        self.push_word(1 << (id % 64), id as usize / 64);
        self.len += 1;
    }

    fn push_all(&mut self, ids: &[u32]) {
        for run in ids.chunk_by(|a, b| a / 64 == b / 64) {
            self.push_word(
                run.iter().fold(0, |all, it| all | 1 << (it % 64)),
                run[0] as usize / 64,
            );
        }
        self.len += ids.len();
    }

    #[inline]
    fn push_word(&mut self, ids: u64, word: usize) {
        if self.lowest.0 != 0 && word <= self.lowest.1 {
            let (old, old_word) = core::mem::take(&mut self.lowest);
            if word == old_word {
                debug_assert!(old & ids == 0);
                self.lowest = (old | ids, word);
                return;
            }
            self.put(old, old_word);
        }
        self.put(ids, word);
    }

    #[inline]
    fn put(&mut self, ids: u64, word: usize) {
        if word >= self.ids.len() {
            self.ids.resize(word + 64, 0);
            self.words.resize(word / 64 + 2, 0);
        }
        debug_assert!(self.ids[word] & ids == 0);
        self.ids[word] |= ids;
        self.words[word / 64] |= 1 << (word % 64);
        self.first = self.first.min(word / 64);
    }

    #[inline]
    pub(crate) fn pop(&mut self) -> Option<u32> {
        self.len = self.len.checked_sub(1)?;
        if self.lowest.0 == 0 {
            self.take_lowest();
        }
        let (ids, word) = self.lowest;
        self.lowest.0 = ids & (ids - 1);
        Some(word as u32 * 64 + ids.trailing_zeros())
    }

    fn take_lowest(&mut self) {
        while self.words[self.first] == 0 {
            self.first += 1;
        }
        let words = &mut self.words[self.first];
        let word = self.first * 64 + words.trailing_zeros() as usize;
        *words &= *words - 1;
        self.lowest = (core::mem::take(&mut self.ids[word]), word);
    }

    /// What `pop` is likely to return after `last` and so many others.
    #[inline]
    pub(crate) fn ahead(&self, last: u32, others: usize) -> u32 {
        let ids = (0..others).fold(self.lowest.0, |ids, _| ids & ids.wrapping_sub(1));
        if ids == 0 {
            last + others as u32 + 1
        } else {
            last / 64 * 64 + ids.trailing_zeros()
        }
    }

    fn len(&self) -> usize {
        self.len
    }
}

pub(crate) struct Tree {
    nodes: Vec<Node>,
    cold: Vec<Cold>,
    /// The address of the newest one.
    last_element: usize,
    free: FreeList,
    /// To selectors, it has neither a parent nor siblings.
    pub(crate) cut_at: Cell<NodeId>,
    /// The part of a view transition whose rules are being looked for.
    pub(crate) matched_part: Cell<NodeId>,
    pub(crate) is_xml: bool,
    /// Of what has no `lang` attribute above it.
    pub(crate) language: Box<str>,
    found: Found,
    /// Nothing that selectors can see has changed since they have put something in `found`.
    is_as_found: Cell<bool>,
    pub(crate) sequence: Sequence,
    /// By `mark_style`, which tends to be in tree order.
    pub(crate) marked: RefCell<Vec<NodeId>>,
    pub(crate) ancestry: Ancestry,
}

/// The nodes of a subtree that is leaving the document, which have `Flags::VISITED`.
pub(crate) struct Gone<'a> {
    pub(crate) tree: &'a Tree,
    pub(crate) ids: &'a [NodeId],
}

impl Gone<'_> {
    pub(crate) fn has(&self, id: NodeId) -> bool {
        self.tree
            .nodes
            .get(id as usize)
            .is_some_and(|it| it.has(Flags::VISITED))
    }

    #[inline(always)]
    pub(crate) fn leave_map<V>(&self, map: &mut Map<NodeId, V>) {
        if !map.is_empty() {
            self.leave_entries(map);
        }
    }

    #[inline(always)]
    pub(crate) fn leave_set(&self, set: &mut Set<NodeId>) {
        if !set.is_empty() {
            self.leave_members(set);
        }
    }

    #[inline(always)]
    pub(crate) fn leave_list<T>(&self, list: &mut Vec<T>, id: impl Fn(&T) -> NodeId) {
        if !list.is_empty() {
            list.retain(|it| !self.has(id(it)));
        }
    }

    #[inline(never)]
    fn leave_entries<V>(&self, map: &mut Map<NodeId, V>) {
        match map.capacity() {
            size if size < 4 * self.ids.len() => map.retain(|id, _| !self.has(*id)),
            _ => self.ids.iter().for_each(|it| _ = map.remove(it)),
        }
    }

    #[inline(never)]
    fn leave_members(&self, set: &mut Set<NodeId>) {
        match set.capacity() {
            size if size < 4 * self.ids.len() => set.retain(|id| !self.has(*id)),
            _ => self.ids.iter().for_each(|it| _ = set.remove(it)),
        }
    }
}

impl core::ops::Index<NodeId> for Tree {
    type Output = Node;
    fn index(&self, id: NodeId) -> &Node {
        &self.nodes[id as usize]
    }
}

impl core::ops::IndexMut<NodeId> for Tree {
    fn index_mut(&mut self, id: NodeId) -> &mut Node {
        self.is_as_found.set(false);
        &mut self.nodes[id as usize]
    }
}

const AT_ONCE: usize = 1 << 12;

/// One call takes half as long as a fault for each page.
fn map_in<T>(room: &mut [core::mem::MaybeUninit<T>]) {
    #[cfg(target_os = "linux")]
    {
        unsafe extern "C" {
            fn madvise(
                address: *mut u8,
                length: usize,
                advice: core::ffi::c_int,
            ) -> core::ffi::c_int;
        }
        const MADV_POPULATE_WRITE: core::ffi::c_int = 23;
        let (start, length) = (
            room.as_mut_ptr().cast::<u8>(),
            room.len().min(AT_ONCE) * size_of::<T>(),
        );
        let skipped = start.align_offset(bun_alloc::page_size()).min(length);
        // SAFETY: the pages start in `room`, and what they hold does not change.
        unsafe { madvise(start.add(skipped), length - skipped, MADV_POPULATE_WRITE) };
    }
    #[cfg(not(target_os = "linux"))]
    let _ = room;
}

pub(crate) const DOCUMENT: NodeId = 1;

impl Tree {
    pub(crate) fn new() -> Tree {
        let mut nodes = vec![Node::new(Data::Free), Node::new(Data::Root)];
        nodes[DOCUMENT as usize].scope = DOCUMENT;
        Tree {
            nodes,
            cold: vec![Cold::default(), Cold::default()],
            last_element: 0,
            free: FreeList::default(),
            cut_at: Cell::new(0),
            matched_part: Cell::new(0),
            is_xml: false,
            language: Box::default(),
            found: Found::default(),
            is_as_found: Cell::new(true),
            sequence: Sequence::default(),
            marked: RefCell::default(),
            ancestry: Ancestry::default(),
        }
    }

    /// What was made after it is likely to be visited after it.
    #[inline]
    pub(crate) fn prefetch_after(&self, id: NodeId) {
        prefetch_read(
            self.nodes.as_ptr().wrapping_add(id as usize + 16),
            Locality::L1,
        );
        self.prefetch_data(id + 8);
    }

    #[inline]
    pub(crate) fn prefetch_style(&self, id: NodeId) {
        if let Some(Data::Element(it)) = self.nodes.get(id as usize).map(|it| &it.data) {
            it.style.iter().for_each(|it| {
                prefetch_read(Rc::as_ptr(it).cast::<usize>().wrapping_sub(2), Locality::L1)
            });
            it.rules.iter().for_each(|it| {
                prefetch_read(Rc::as_ptr(it).cast::<usize>().wrapping_sub(2), Locality::L1)
            });
        }
    }

    /// What `prefetch_after` comes too late for.
    pub(crate) fn prefetch_first_below(&self, id: NodeId) {
        if self[id].first_child == id + 1 {
            (2..16).for_each(|it| {
                prefetch_read(
                    self.nodes.as_ptr().wrapping_add(id as usize + it),
                    Locality::L1,
                )
            });
            (0..8).for_each(|it| self.prefetch_data(id + it));
        }
    }

    #[inline]
    pub(crate) fn prefetch_links(&self, id: NodeId) {
        prefetch_read(self.nodes.as_ptr().wrapping_add(id as usize), Locality::L1);
    }

    #[inline]
    pub(crate) fn prefetch_node(&self, id: NodeId) {
        self.prefetch_links(id);
        self.prefetch_cell(id);
    }

    #[inline]
    pub(crate) fn prefetch_data(&self, id: NodeId) {
        match self.nodes.get(id as usize).map(|it| &it.data) {
            Some(Data::Element(it)) => {
                prefetch_read(&raw const it.tag, Locality::L1);
                prefetch_read(&raw const it.attributes, Locality::L1);
            }
            Some(Data::Text(StoredText::Ascii(it))) => prefetch_read(it.as_impl(), Locality::L1),
            _ => {}
        }
    }

    /// For a loop over `ids` that is at the first one.
    #[inline]
    pub(crate) fn prefetch_in(&self, ids: &[NodeId]) {
        let [.., far] = ids[..ids.len().min(13)] else {
            return;
        };
        prefetch_read(&raw const self[far], Locality::L1);
        ids.get(8)
            .into_iter()
            .for_each(|it| self.prefetch_data(*it));
        if let Some(it) = ids.get(4).and_then(|it| self.element(*it)) {
            prefetch_read(it.attributes.as_ptr(), Locality::L1);
        }
    }

    #[inline]
    pub(crate) fn prefetch_cell(&self, id: NodeId) {
        prefetch_read(self.cold.as_ptr().wrapping_add(id as usize), Locality::L1);
    }

    pub(crate) fn found(&self) -> &Found {
        if !self.is_as_found.replace(true) {
            self.found.clear();
        }
        &self.found
    }

    /// For changes that are not made through `IndexMut` or `element_mut`.
    pub(crate) fn forget_found(&self) {
        self.is_as_found.set(false);
    }

    pub(crate) fn is_as_found(&self) -> bool {
        self.is_as_found.get()
    }

    /// After changes to generated nodes, with what `is_as_found` has said before them.
    pub(crate) fn keep_found(&self, was_as_found: bool) {
        self.is_as_found.set(was_as_found);
    }

    #[inline(always)]
    pub(crate) fn create(&mut self, data: Data) -> NodeId {
        let id = self.vacant();
        // It is `Data::Free`.
        let _ = core::mem::ManuallyDrop::new(core::mem::replace(&mut self[id].data, data));
        id
    }

    fn add_vacant(&mut self) -> NodeId {
        if self.nodes.len() == self.nodes.capacity() {
            self.grow();
        }
        self.nodes.push(Node::new(Data::Free));
        self.cold.push(Cold::default());
        (self.nodes.len() - 1) as NodeId
    }

    #[inline]
    fn vacant(&mut self) -> NodeId {
        let id = self.free.pop().unwrap_or_else(|| self.add_vacant());
        let later = self.free.ahead(id, 6) as usize;
        prefetch_write(self.nodes.as_mut_ptr().wrapping_add(later), Locality::L1);
        prefetch_write(self.cold.as_mut_ptr().wrapping_add(later), Locality::L1);
        id
    }

    #[cold]
    fn grow(&mut self) {
        self.expect(1);
    }

    #[cold]
    fn make_room(&mut self) {
        if self.nodes.len() == self.nodes.capacity() {
            self.grow();
        }
        if self.nodes.len() >= 4 * AT_ONCE {
            map_in(self.nodes.spare_capacity_mut());
            map_in(self.cold.spare_capacity_mut());
        }
    }

    /// So many nodes are likely to be created.
    pub(crate) fn expect(&mut self, count: usize) {
        fn reserve<T>(all: &mut Vec<T>, more: usize) {
            // Pages that are not touched cost nothing, and copies do.
            let capacity = match all.len() + more {
                needed @ 0x400..0x4_0000 => (needed * 4).max(1 << 16),
                needed => needed.max(all.capacity() * 2),
            };
            let mut roomier = Vec::new();
            if all.capacity() - all.len() < more && roomier.try_reserve_exact(capacity).is_ok() {
                roomier.append(all);
                *all = roomier;
            }
        }
        let more = count.saturating_sub(self.free.len());
        reserve(&mut self.nodes, more);
        reserve(&mut self.cold, more);
    }

    pub(crate) fn create_bare(&mut self, data: Data, keys: u64) -> NodeId {
        let id = self.create(data);
        self[id].keys = keys;
        self.make_bare(id);
        id
    }

    /// A new last child, which is bare.
    #[inline(always)]
    pub(crate) fn append_bare(&mut self, parent: NodeId, data: Data, keys: u64) -> NodeId {
        let sketch = Sketch::of(&data);
        let reused = self.free.pop();
        let id = reused.unwrap_or(self.nodes.len() as NodeId);
        let previous = core::mem::replace(&mut self.cold_mut(parent).last_child, id);
        let above = &mut self[parent];
        let (scope, is_news) = (above.scope, keys & !above.keys_below != 0);
        match previous {
            0 => above.first_child = id,
            _ => self[previous].next = id,
        }
        let node = Node {
            parent,
            previous,
            scope,
            keys,
            ..Node::new(data)
        };
        if reused.is_none() {
            if id.is_multiple_of(AT_ONCE as u32) || self.nodes.len() == self.nodes.capacity() {
                self.make_room();
            }
            self.nodes.push(node);
            self.cold.push(Cold {
                cell: Cell::new(sketch.to_cell()),
                ..Cold::default()
            });
        } else {
            prefetch_write(
                self.nodes.as_mut_ptr().wrapping_add(id as usize + 6),
                Locality::L1,
            );
            // It is `Data::Free`.
            let _ = core::mem::ManuallyDrop::new(core::mem::replace(&mut self[id], node));
            self.cold_mut(id).cell.set(sketch.to_cell());
        }
        if is_news {
            self.add_keys_below(parent, keys);
        }
        id
    }

    /// A copy of an element, which is about to get copies of its descendants.
    #[inline]
    pub(crate) fn append_bare_like(&mut self, of: NodeId, parent: NodeId) -> NodeId {
        self.prefetch_after(of);
        if let Some(it) = self.element(of + 4) {
            prefetch_read(
                it.attributes.as_ptr().cast::<usize>().wrapping_sub(2),
                Locality::L1,
            );
        }
        let (keys, keys_below) = (self[of].keys, self[of].keys_below);
        let Some(Likeness {
            tag,
            namespace,
            local,
            space,
            is_unprepared,
            id,
            classes,
            attributes,
            ..
        }) = self.element_to_style(of).map(|it| Likeness::of(it, keys))
        else {
            return 0;
        };
        let element = self.new_element(tag, namespace, |element| {
            (
                element.local,
                element.is_unprepared,
                element.id,
                element.classes,
                element.attributes,
            ) = (local, is_unprepared, id, classes, attributes);
            space
                .into_iter()
                .for_each(|it| element.rare_mut().space = Some(it));
        });
        self.add_keys_below(parent, keys | keys_below);
        self.sequence.shape_changed(parent);
        let copy = self.append_bare(parent, Data::Element(element), keys);
        self[copy].keys_below = keys_below;
        copy
    }

    #[inline(always)]
    pub(crate) fn create_element(
        &mut self,
        tag: Name,
        namespace: Namespace,
        fill: impl FnOnce(&mut Element),
    ) -> NodeId {
        let element = self.new_element(tag, namespace, fill);
        self.create(Data::Element(element))
    }

    #[inline(always)]
    pub(crate) fn new_element(
        &mut self,
        tag: Name,
        namespace: Namespace,
        fill: impl FnOnce(&mut Element),
    ) -> Box<Element> {
        let room = Box::<Element>::new_uninit();
        let address = room.as_ptr().addr();
        let step = address.wrapping_sub(core::mem::replace(&mut self.last_element, address));
        let later = room
            .as_ptr()
            .cast::<u8>()
            .cast_mut()
            .wrapping_add(step.wrapping_mul(6));
        [0, 64]
            .into_iter()
            .for_each(|it| prefetch_write(later.wrapping_add(it), Locality::L1));
        let mut element = Box::write(room, Element::new(tag, namespace));
        fill(&mut element);
        element
    }

    #[inline]
    pub(crate) fn free(&mut self, id: NodeId) {
        if self.cold[id as usize].last_comment.get() != 0 {
            self.free_comments_in(id);
        }
        self.sequence.shape_changed(id);
        self[id] = Node::new(Data::Free);
        self.cold[id as usize] = Cold::default();
        self.free.push(id);
        self.ancestry.forget(id);
    }

    pub(crate) fn free_all(&mut self, ids: &[NodeId]) {
        const AT_A_TIME: usize = 32;
        let chunk = |index: usize| ids.chunks(AT_A_TIME).nth(index).unwrap_or_default();
        (0..2)
            .flat_map(chunk)
            .for_each(|it| self.prefetch_node(*it));
        chunk(0).iter().for_each(|it| self.prefetch_data(*it));
        for (index, now) in ids.chunks(AT_A_TIME).enumerate() {
            chunk(index + 2)
                .iter()
                .for_each(|it| self.prefetch_node(*it));
            chunk(index + 1)
                .iter()
                .for_each(|it| self.prefetch_data(*it));
            now.iter()
                .filter_map(|it| self.element(*it))
                .for_each(|it| prefetch_read(it.attributes.as_ptr(), Locality::L1));
            for id in now.iter().copied() {
                if self.cold[id as usize].last_comment.get() != 0 {
                    self.free_comments_in(id);
                }
                self.sequence.shape_changed(id);
                self[id] = Node::new(Data::Free);
                self.cold[id as usize] = Cold::default();
                self.ancestry.forget(id);
            }
            self.free.push_all(now);
        }
    }

    #[cold]
    fn free_comments_in(&mut self, parent: NodeId) {
        self.take_comments(parent)
            .into_iter()
            .for_each(|it| self.free(it.0));
    }

    /// Its descendants, which are bare. Returns how many they were.
    pub(crate) fn free_below(&mut self, root: NodeId) -> u32 {
        if self.cold[root as usize].last_comment.get() != 0 {
            self.free_comments_in(root);
        }
        self.cold_mut(root).last_child = 0;
        self[root].keys_below = 0;
        let (mut at, mut later, mut count) = (
            core::mem::take(&mut self[root].first_child),
            SmallVec::<[NodeId; 32]>::new(),
            0,
        );
        while at != 0 {
            self.prefetch_after(at);
            let (child, next) = (self[at].first_child, self[at].next);
            self.free(at);
            count += 1;
            if child != 0 && next != 0 {
                later.push(next);
            }
            at = if child != 0 {
                child
            } else if next != 0 {
                next
            } else {
                later.pop().unwrap_or(0)
            };
        }
        count
    }

    /// The same, if they have been listed.
    pub(crate) fn free_these_below(
        &mut self,
        root: NodeId,
        ids: &[NodeId],
        mut take_leave: impl FnMut(NodeId, &Element),
    ) -> u32 {
        self[root].first_child = 0;
        self.free_below(root);
        self.sequence.forget();
        for (index, id) in ids.iter().copied().enumerate() {
            self.prefetch_in(&ids[index..]);
            if self.cold[id as usize].last_comment.get() != 0 {
                self.free_comments_in(id);
            }
            self.cold[id as usize] = Cold::default();
            self.ancestry.forget(id);
            if let Data::Element(element) =
                core::mem::replace(&mut self[id], Node::new(Data::Free)).data
            {
                take_leave(id, &element);
            }
        }
        self.free.push_all(ids);
        ids.len() as u32
    }

    pub(crate) fn count_freed(count: usize) {
        // It is an estimate, which is not worth locking the bus for.
        FREED_NODES.store(
            FREED_NODES
                .load(Ordering::Relaxed)
                .wrapping_add(count as u32),
            Ordering::Relaxed,
        );
    }

    /// For another tree, where `Document::rehome` corrects the ids.
    pub(crate) fn take(&mut self, id: NodeId) -> (Node, Cold) {
        let node = (
            core::mem::replace(&mut self[id], Node::new(Data::Free)),
            core::mem::take(self.cold_mut(id)),
        );
        self.free(id);
        node
    }

    pub(crate) fn put(&mut self, node: (Node, Cold)) -> NodeId {
        let id = self.create(Data::Root);
        (self[id], *self.cold_mut(id)) = node;
        id
    }

    pub(crate) fn cold_mut(&mut self, id: NodeId) -> &mut Cold {
        &mut self.cold[id as usize]
    }

    pub(crate) fn dirty_child(&self, id: NodeId) -> &Cell<NodeId> {
        &self.cold[id as usize].dirty_child
    }

    pub(crate) fn visit(&self, id: NodeId) -> &Cell<u32> {
        &self.cold[id as usize].visit
    }

    pub(crate) fn is_in_skipped_contents(&self, id: NodeId) -> bool {
        let (mut at, mut path) = (id, SmallVec::<[NodeId; 64]>::new());
        while at != DOCUMENT && !self.ancestry.has(at, Fact::Unskipped) {
            path.push(at);
            at = self.flat_parent(at);
            if at == 0 || self[at].has(Flags::SKIPPED) {
                return at != 0;
            }
        }
        self.ancestry.note(&path, Fact::Unskipped);
        false
    }

    /// They may be in a state that cannot be dropped.
    pub(crate) fn leak_styles(&mut self) {
        for node in &mut self.nodes {
            node.flags
                .set(node.flags.get() & (Flags::REDIRECTS_CHILDREN | Flags::OTHER_DOCUMENT));
            if let Data::Element(it) = &mut node.data {
                let _ = core::mem::ManuallyDrop::new((
                    it.rules.take(),
                    it.base_style.take(),
                    it.style.take(),
                ));
                it.generated = [0; 4];
            }
        }
    }

    pub(crate) fn forget_boxes(&mut self) {
        let _ = core::mem::ManuallyDrop::new(core::mem::take(&mut self.found));
        for node in &mut self.nodes {
            node.layout_box = 0;
            node.unset(Flags::REBUILD | Flags::VISITED);
        }
    }

    pub(crate) fn len(&self) -> usize {
        self.nodes.len() - self.free.len()
    }

    /// Greater than all ids.
    pub(crate) fn capacity(&self) -> usize {
        self.nodes.len()
    }

    /// Searches have cost more than filling `sequence` does.
    #[inline]
    pub(crate) fn has_searched_enough(&self) -> bool {
        self.sequence.walked.get() > self.nodes.len()
    }

    #[inline]
    pub(crate) fn prepare_to_search(&mut self, root: NodeId) {
        if self.has_searched_enough() {
            let (mut sequence, path) = (
                core::mem::take(&mut self.sequence),
                core::iter::successors(Some(root), |it| Some(self[*it].parent)),
            );
            sequence.fill(self, path.take_while(|it| *it != 0).last().unwrap_or(root));
            self.sequence = sequence;
        }
    }

    pub(crate) fn contains(&self, id: NodeId) -> bool {
        (self.nodes.get(id as usize)).is_some_and(|node| !matches!(node.data, Data::Free))
    }

    #[inline]
    pub(crate) fn link(&mut self, parent: NodeId, child: NodeId, before: NodeId) {
        let previous = match before {
            0 => core::mem::replace(&mut self.cold_mut(parent).last_child, child),
            _ => core::mem::replace(&mut self[before].previous, child),
        };
        match previous {
            0 => self[parent].first_child = child,
            _ => self[previous].next = child,
        }
        let node = &mut self[child];
        (node.parent, node.previous, node.next) = (parent, previous, before);
        let keys = node.keys | node.keys_below;
        if node.element().is_some() {
            self.sequence.shape_changed(parent);
            self.sequence.shape_changed(child);
        }
        self.add_keys_below(parent, keys);
    }

    /// Of `root` and its descendants.
    #[inline]
    pub(crate) fn set_scope(&mut self, root: NodeId, scope: NodeId) {
        if self[root].scope != scope {
            self.change_scope(root, scope);
        }
    }

    fn change_scope(&mut self, root: NodeId, scope: NodeId) {
        let mut next = root;
        while next != 0 {
            let mut at = next;
            prefetch_write(
                self.nodes.as_mut_ptr().wrapping_add(at as usize + 8),
                Locality::L1,
            );
            self[at].scope = scope;
            next = self[at].first_child;
            while next == 0 && at != root {
                (next, at) = (self[at].next, self[at].parent);
            }
        }
    }

    /// It is made if the node is bare.
    #[inline]
    pub(crate) fn cell(&self, id: NodeId) -> *const crate::api::core::Node {
        let cell = self.object(id);
        if Sketch::from_cell(cell).is_some() {
            crate::api::core::bare::make_object(self, id)
        } else {
            cell
        }
    }

    /// Of a node that is not bare.
    #[inline]
    pub(crate) fn object(&self, id: NodeId) -> *const crate::api::core::Node {
        self.cold
            .get(id as usize)
            .map_or(core::ptr::null(), |it| it.cell.get())
    }

    #[inline]
    pub(crate) fn is_bare(&self, id: NodeId) -> bool {
        self.sketch(id).is_some()
    }

    #[inline]
    pub(crate) fn sketch(&self, id: NodeId) -> Option<Sketch> {
        Sketch::from_cell(self.object(id))
    }

    /// What it takes to make objects for them.
    #[inline]
    pub(crate) fn prefetch_children(&self, id: NodeId) {
        [self[id].first_child, self.cold[id as usize].last_child]
            .into_iter()
            .for_each(|it| self.prefetch_node(it));
    }

    #[inline]
    pub(crate) fn make_bare(&mut self, id: NodeId) {
        let sketch = Sketch::of(&self[id].data);
        self.cold_mut(id).cell.set(sketch.to_cell());
    }

    #[inline]
    pub(crate) fn clothe(&self, id: NodeId, cell: *const crate::api::core::Node) {
        self.cold[id as usize].cell.set(cell);
    }

    /// With bare comments.
    pub(crate) fn has_children(&self, id: NodeId) -> bool {
        self[id].first_child != 0 || self.cold[id as usize].last_comment.get() != 0
    }

    /// The last child if it is text, of a node whose children are bare.
    #[inline]
    pub(crate) fn text_at_end_of(&self, id: NodeId) -> Option<NodeId> {
        let Cold {
            last_child,
            last_comment,
            ..
        } = &self.cold[id as usize];
        let is_followed =
            || last_comment.get() != 0 && self.visit(last_comment.get()).get() == *last_child;
        (matches!(self[*last_child].data, Data::Text(_)) && !is_followed()).then_some(*last_child)
    }

    #[inline]
    pub(crate) fn only_text_in(&self, id: NodeId) -> Option<NodeId> {
        let (
            first,
            Cold {
                last_child,
                last_comment,
                ..
            },
        ) = (self[id].first_child, &self.cold[id as usize]);
        (first == *last_child
            && last_comment.get() == 0
            && matches!(self[first].data, Data::Text(_)))
        .then_some(first)
    }

    /// The bare ones, from the last, each with the child that it follows.
    fn comments_in(&self, parent: NodeId) -> impl Iterator<Item = (NodeId, NodeId)> + '_ {
        let all =
            core::iter::successors(Some(self.cold[parent as usize].last_comment.get()), |it| {
                Some(self.dirty_child(*it).get())
            });
        all.take_while(|it| *it != 0)
            .map(|it| (it, self.visit(it).get()))
    }

    #[inline]
    pub(crate) fn take_comments(&self, parent: NodeId) -> SmallVec<[(NodeId, NodeId); 4]> {
        if self.cold[parent as usize].last_comment.get() == 0 {
            return SmallVec::new();
        }
        let all = SmallVec::from_iter(self.comments_in(parent));
        self.cold[parent as usize].last_comment.set(0);
        all
    }

    pub(crate) fn append_comment(&mut self, parent: NodeId, comment: NodeId) {
        let Cold {
            last_child,
            last_comment,
            ..
        } = &self.cold[parent as usize];
        self.visit(comment).set(*last_child);
        self.dirty_child(comment).set(last_comment.replace(comment));
    }

    /// One without children.
    #[inline]
    pub(crate) fn append(&mut self, parent: NodeId, child: NodeId) {
        self.link(parent, child, 0);
        self[child].scope = self[parent].scope;
    }

    /// Bare ones, to the end. Their scope has yet to be set. Returns the first.
    pub(crate) fn move_children(&mut self, from: NodeId, to: NodeId) -> NodeId {
        let before = self.cold[to as usize].last_child;
        for (comment, after) in self.take_comments(from).into_iter().rev() {
            self.append_comment(to, comment);
            self.visit(comment)
                .set(if after == 0 { before } else { after });
        }
        let (first, last) = (
            core::mem::take(&mut self[from].first_child),
            core::mem::take(&mut self.cold_mut(from).last_child),
        );
        if first == 0 {
            return 0;
        }
        self.sequence.shape_changed(from);
        self.sequence.shape_changed(to);
        match before {
            0 => self[to].first_child = first,
            _ => self[before].next = first,
        }
        (self[first].previous, self.cold_mut(to).last_child) = (before, last);
        let mut at = first;
        while at != 0 {
            self[at].parent = to;
            at = self[at].next;
        }
        let keys = core::mem::take(&mut self[from].keys_below);
        self.add_keys_below(to, keys);
        first
    }

    #[inline]
    pub(crate) fn set_cell(&mut self, id: NodeId, cell: *const crate::api::core::Node) {
        self.forget_found();
        self.cold_mut(id).cell.set(cell);
    }

    /// Of two nodes of one tree.
    pub(crate) fn precedes(&self, a: NodeId, b: NodeId) -> bool {
        let up = |id: NodeId| self.walk(id, |it| it.parent);
        let (depth_a, depth_b) = (up(a).count(), up(b).count());
        let mut both = up(a)
            .skip(depth_a.saturating_sub(depth_b))
            .zip(up(b).skip(depth_b.saturating_sub(depth_a)));
        let Some((a, b)) = both
            .find(|(a, b)| self[*a].parent == self[*b].parent)
            .filter(|(a, b)| a != b)
        else {
            return depth_a < depth_b;
        };
        let (mut after_a, mut after_b) = (a, b);
        loop {
            (after_a, after_b) = (self[after_a].next, self[after_b].next);
            if after_a == b || after_b == 0 {
                return true;
            }
            if after_b == a || after_a == 0 {
                return false;
            }
        }
    }

    /// In the place of others, which may stay for a while.
    #[inline(always)]
    pub(crate) fn add_keys(&mut self, id: NodeId, keys: u64) {
        let keys = Some(self[id].keys | keys)
            .filter(|it| it.count_ones() < 12)
            .unwrap_or_else(|| self.element(id).map_or(0, crate::selector::filter_of));
        self.set_keys(id, keys);
    }

    #[inline(always)]
    pub(crate) fn set_keys(&mut self, id: NodeId, keys: u64) {
        self[id].keys = keys;
        if self.sequence.is_current()
            && let Some(element) = self.nodes[id as usize].element()
        {
            self.sequence.attributes_changed(id, keys, element);
        }
        self.add_keys_below(self[id].parent, keys);
    }

    #[inline(always)]
    fn add_keys_below(&mut self, mut id: NodeId, keys: u64) {
        while id != 0 && keys & !self[id].keys_below != 0 {
            self[id].keys_below |= keys;
            id = if let Data::ShadowRoot { host, .. } = self[id].data {
                host
            } else {
                self[id].parent
            };
        }
    }

    pub(crate) fn unlink(&mut self, child: NodeId) {
        if self[child].parent != 0 {
            self.ancestry.forget_all();
        }
        self.unlink_unknown(child);
    }

    /// `ancestry` has nothing on it or on what is in it, or it is told.
    #[inline]
    pub(crate) fn unlink_unknown(&mut self, child: NodeId) {
        let node = &mut self[child];
        let (parent, previous, next) = (node.parent, node.previous, node.next);
        (node.parent, node.previous, node.next) = (0, 0, 0);
        if parent == 0 {
            return;
        }
        self.sequence.shape_changed(child);
        match previous {
            0 => self[parent].first_child = next,
            _ => self[previous].next = next,
        }
        match next {
            0 => self.cold_mut(parent).last_child = previous,
            _ => self[next].previous = previous,
        }
        if previous == 0 && next == 0 && !self[parent].has(Flags::REDIRECTS_CHILDREN) {
            self[parent].keys_below = 0;
        }
    }

    /// In tree order, within `root`.
    #[inline]
    pub(crate) fn following(&self, mut at: NodeId, root: NodeId) -> NodeId {
        let mut next = self[at].first_child;
        while next == 0 && at != root {
            (next, at) = (self[at].next, self[at].parent);
        }
        next
    }

    #[inline(always)]
    pub(crate) fn element(&self, id: NodeId) -> Option<&Element> {
        self.nodes.get(id as usize)?.element()
    }

    #[inline(always)]
    pub(crate) fn element_mut(&mut self, id: NodeId) -> Option<&mut Element> {
        self.forget_found();
        self.element_to_style(id)
    }

    /// To change what selectors do not look at.
    #[inline(always)]
    pub(crate) fn element_to_style(&mut self, id: NodeId) -> Option<&mut Element> {
        match &mut self.nodes.get_mut(id as usize)?.data {
            Data::Element(element) => Some(element),
            _ => None,
        }
    }

    pub(crate) fn style(&self, id: NodeId) -> Option<&Rc<Style>> {
        self.element(id)?.style.as_ref()
    }

    pub(crate) fn html_tag(&self, id: NodeId) -> Name {
        self.element(id).map_or(Name::NONE, Element::html_tag)
    }

    fn walk(&self, first: NodeId, step: fn(&Node) -> NodeId) -> impl Iterator<Item = NodeId> + '_ {
        let some = |id| (id != 0).then_some(id);
        core::iter::successors(some(first), move |id| some(step(&self[*id])))
    }

    pub(crate) fn children(&self, id: NodeId) -> impl Iterator<Item = NodeId> + '_ {
        self.walk(self[id].first_child, |node| node.next)
    }

    pub(crate) fn element_children(&self, id: NodeId) -> impl Iterator<Item = NodeId> + '_ {
        self.children(id)
            .filter(|child| self[*child].element().is_some())
    }

    pub(crate) fn previous_elements(&self, id: NodeId) -> impl Iterator<Item = NodeId> + '_ {
        (self.walk(self[id].previous, |node| node.previous))
            .filter(|sibling| self[*sibling].element().is_some())
    }

    pub(crate) fn next_elements(&self, id: NodeId) -> impl Iterator<Item = NodeId> + '_ {
        (self.walk(self[id].next, |node| node.next))
            .filter(|sibling| self[*sibling].element().is_some())
    }

    /// In tree order, without `root`, and without shadow trees.
    pub(crate) fn descendants(&self, root: NodeId) -> impl Iterator<Item = NodeId> + '_ {
        let mut next = self[root].first_child;
        core::iter::from_fn(move || {
            let current = (next != 0).then_some(next)?;
            prefetch_read(
                self.nodes.as_ptr().wrapping_add(current as usize + 8),
                Locality::L1,
            );
            next = self[current].first_child;
            let mut at = current;
            while next == 0 && at != root {
                next = self[at].next;
                at = self[at].parent;
            }
            Some(current)
        })
    }

    /// Those that have one of the keys.
    pub(crate) fn descendants_with(
        &self,
        root: NodeId,
        keys: u64,
    ) -> impl Iterator<Item = NodeId> + '_ {
        self.descendants_after(root, root, keys)
    }

    pub(crate) fn descendants_after(
        &self,
        root: NodeId,
        at: NodeId,
        keys: u64,
    ) -> impl Iterator<Item = NodeId> + '_ {
        self.descendants_where(root, at, keys, move |it| it.keys & keys != 0)
    }

    /// If so, there are no elements in it, in the flat tree or generated.
    #[inline]
    pub(crate) fn has_only_text(&self, id: NodeId) -> bool {
        self[id].keys_below == 0
            && !self[id].has(Flags::REDIRECTS_CHILDREN)
            && self[id]
                .element()
                .is_some_and(|it| it.generated == [0; 4] && it.rare.is_none())
    }

    pub(crate) fn may_have_below(&self, id: NodeId, keys: u64) -> bool {
        self[id].keys_below & keys != 0
    }

    /// 0 if no descendant has one of `keys`.
    pub(crate) fn first_child_with(&self, id: NodeId, keys: u64) -> NodeId {
        if self[id].keys_below & keys != 0 {
            self[id].first_child
        } else {
            0
        }
    }

    /// Fills `found` with the next elements whose keys `fit`. `pending` has the siblings from which on the search continues, the first last.
    #[inline(always)]
    pub(crate) fn next_with(
        &self,
        pending: &mut SmallVec<[NodeId; 32]>,
        fit: impl Fn(u64) -> bool,
        found: &mut [NodeId],
    ) -> usize {
        let (nodes, mut count, mut walked) = (&self.nodes[..], 0, self.sequence.walked.get());
        while let Some(mut id) = pending.pop() {
            while id != 0 {
                walked += 1;
                let node = &nodes[id as usize];
                prefetch_read(core::ptr::from_ref(node).wrapping_add(8), Locality::L1);
                let this = core::mem::replace(&mut id, node.next);
                if fit(node.keys_below) {
                    if id != 0 {
                        pending.push(id);
                    }
                    id = node.first_child;
                }
                if fit(node.keys)
                    && let Data::Element(element) = &node.data
                {
                    prefetch_read(&raw const element.tag, Locality::L1);
                    prefetch_read(self.cold.as_ptr().wrapping_add(this as usize), Locality::L1);
                    found[count] = this;
                    count += 1;
                    if count == found.len() {
                        pending.push(id);
                        self.sequence.walked.set(walked);
                        return count;
                    }
                }
            }
        }
        self.sequence.walked.set(walked);
        count
    }

    /// Leaves out what is in nodes that have none of `keys` below them.
    fn descendants_where<'a>(
        &'a self,
        root: NodeId,
        mut at: NodeId,
        keys: u64,
        is_wanted: impl Fn(&Node) -> bool + 'a,
    ) -> impl Iterator<Item = NodeId> + 'a {
        core::iter::from_fn(move || {
            while at != 0 {
                let mut node = &self[at];
                prefetch_read(
                    self.nodes.as_ptr().wrapping_add(at as usize + 8),
                    Locality::L1,
                );
                let mut next = if node.keys_below & keys != 0 {
                    node.first_child
                } else {
                    0
                };
                while next == 0 && at != root {
                    (next, at) = (node.next, node.parent);
                    node = &self[at];
                }
                at = next;
                if is_wanted(&self[at]) {
                    return Some(at);
                }
            }
            None
        })
    }

    /// `root` and its descendants, with the shadow trees.
    #[inline]
    pub(crate) fn visit_subtree(&self, root: NodeId, mut visit: impl FnMut(NodeId)) {
        match self[root].first_child == 0 && !self[root].has(Flags::REDIRECTS_CHILDREN) {
            true => visit(root),
            false => self.visit_all_in(root, visit),
        }
    }

    fn visit_all_in(&self, root: NodeId, mut visit: impl FnMut(NodeId)) {
        let (mut roots, mut next) = (Vec::new(), Some(root));
        while let Some(root) = next {
            for id in core::iter::once(root).chain(self.descendants(root)) {
                visit(id);
                if self[id].has(Flags::REDIRECTS_CHILDREN) {
                    roots.extend(
                        self[id]
                            .element()
                            .map(|it| it.shadow_root)
                            .filter(|it| *it != 0),
                    );
                }
            }
            next = roots.pop();
        }
    }

    /// Those that have one of `keys`.
    pub(crate) fn visit_styled(
        &self,
        root: NodeId,
        keys: u64,
        mut visit: impl FnMut(NodeId, &Element),
    ) {
        let (mut roots, mut next) = (Vec::new(), Some(root));
        while let Some(root) = next {
            for id in core::iter::once(root).chain(self.descendants_where(root, root, keys, |it| {
                it.keys & keys != 0 || it.has(Flags::REDIRECTS_CHILDREN)
            })) {
                let Some(element) = self[id].element().filter(|it| it.rules.is_some()) else {
                    continue;
                };
                if self[id].keys & keys != 0 {
                    visit(id, element);
                }
                roots.extend((element.shadow_root != 0).then_some(element.shadow_root));
            }
            next = roots.pop();
        }
    }

    /// It is in the document that is shown.
    #[inline]
    pub(crate) fn is_rendered(&self, id: NodeId) -> bool {
        let mut scope = self[id].scope;
        while scope > DOCUMENT {
            scope = self[self.host_of(scope)].scope;
        }
        scope == DOCUMENT
    }

    pub(crate) fn is_slot(&self, id: NodeId) -> bool {
        self[id].scope != DOCUMENT
            && self
                .element(id)
                .is_some_and(|it| it.html_tag() == name!("slot"))
    }

    /// The one that the node is assigned to, the one that that is assigned to, and so on.
    pub(crate) fn slots(&self, id: NodeId) -> impl Iterator<Item = NodeId> {
        core::iter::successors(Some(id), |it| Some(self[*it].slot).filter(|it| *it != 0)).skip(1)
    }

    /// The shadow hosts that may have the element as a part.
    pub(crate) fn exporting_hosts(&self, id: NodeId) -> impl Iterator<Item = NodeId> {
        let host = |id: NodeId| Some(self.host_of(self[id].scope)).filter(|it| *it != 0);
        core::iter::successors(host(id), move |it| {
            self.element(*it)?
                .has(name!("exportparts"))
                .then(|| host(*it))?
        })
    }

    pub(crate) fn host_of(&self, scope: NodeId) -> NodeId {
        match self[scope].data {
            Data::ShadowRoot { host, .. } => host,
            _ => 0,
        }
    }

    /// These compare like the nodes in tree order.
    pub(crate) fn path(&self, id: NodeId) -> Vec<usize> {
        let step = |id: &NodeId| match self.element(*id).filter(|it| it.is_generated()) {
            Some(it) => (
                it.originator,
                self.element(it.originator)
                    .and_then(|it| it.generated.iter().position(|it| it == id)),
            ),
            None => (self.parent_or_host(*id), None),
        };
        let inside = core::iter::successors(Some(id).filter(|it| *it != 0), |id| {
            Some(step(id).0).filter(|it| *it != 0)
        });
        let before = |id| {
            core::iter::successors(Some(id), |it: &NodeId| {
                Some(self[*it].previous).filter(|it| *it != 0)
            })
            .count()
        };
        let mut path: Vec<_> = inside
            .map(|id| {
                step(&id)
                    .1
                    .map_or_else(|| 3 + before(id), |it| [0, 1, 3, 2][it])
            })
            .collect();
        path.reverse();
        path
    }

    pub(crate) fn parent_or_host(&self, id: NodeId) -> NodeId {
        let parent = self[id].parent;
        match self[parent].data {
            Data::ShadowRoot { host, .. } => host,
            _ => parent,
        }
    }

    /// The document for the root element, and 0 for what is not in the flat tree.
    pub(crate) fn flat_parent(&self, id: NodeId) -> NodeId {
        let node = &self[id];
        match &self[node.parent].data {
            Data::ShadowRoot { host, .. } => *host,
            Data::Element(_) if !self[node.parent].has(Flags::REDIRECTS_CHILDREN) => node.parent,
            Data::Element(parent) if parent.shadow_root != 0 => node.slot,
            Data::Element(parent) if !parent.assigned.is_empty() => 0,
            Data::Free => node.element().map_or(0, |element| element.originator),
            _ => node.parent,
        }
    }

    pub(crate) fn is_root_of_cue(&self, id: NodeId) -> bool {
        self.element(id)
            .is_some_and(|it| it.pseudo == Pseudo::Part(name!("cue")))
    }

    pub(crate) fn flat_ancestors(&self, id: NodeId) -> impl Iterator<Item = NodeId> + '_ {
        let some = |id| (id != 0).then_some(id);
        core::iter::successors(some(self.flat_parent(id)), move |id| {
            some(self.flat_parent(*id))
        })
    }

    /// Without the generated ones.
    pub(crate) fn flat_children(&self, id: NodeId) -> impl Iterator<Item = NodeId> + '_ {
        let (assigned, parent) = match self[id]
            .element()
            .filter(|_| self[id].has(Flags::REDIRECTS_CHILDREN))
        {
            Some(element) if element.shadow_root != 0 => (&[][..], element.shadow_root),
            Some(element) if !element.assigned.is_empty() => (&element.assigned[..], 0),
            _ => (&[][..], id),
        };
        assigned.iter().copied().chain(self.children(parent))
    }

    pub(crate) fn root_element(&self) -> NodeId {
        self.element_children(DOCUMENT).next().unwrap_or(0)
    }

    pub(crate) fn is_root(&self, id: NodeId) -> bool {
        self[id].parent == DOCUMENT && id == self.root_element()
    }

    pub(crate) fn is_root_of_any(&self, id: NodeId) -> bool {
        let parent = &self[self[id].parent];
        matches!(parent.data, Data::Root) && (parent.has(Flags::OTHER_DOCUMENT) || self.is_root(id))
    }

    pub(crate) fn body(&self) -> NodeId {
        (self.element_children(self.root_element()))
            .find(|child| self.html_tag(*child) == name!("body"))
            .unwrap_or(0)
    }

    pub(crate) fn mark_style(&self, id: NodeId, flags: Flags) {
        if !self[id].has(Flags::STYLE_DIRTY) {
            let mut marked = self.marked.borrow_mut();
            if marked.len() < 1 << 14 {
                marked.push(id);
            }
        }
        self[id].set(flags);
        let mut child = id;
        for ancestor in self.flat_ancestors(id) {
            let node = &self[ancestor];
            if node.has(Flags::DIRTY_DESCENDANTS) {
                if self.dirty_child(ancestor).get() != child {
                    self.dirty_child(ancestor).set(0);
                }
                break;
            }
            node.set(Flags::DIRTY_DESCENDANTS);
            self.dirty_child(ancestor).set(child);
            child = ancestor;
        }
    }

    pub(crate) fn mark_ancestors(&self, id: NodeId, flag: Flags) {
        for ancestor in self.flat_ancestors(id) {
            if self[ancestor].has(flag) {
                break;
            }
            self[ancestor].set(flag);
        }
    }
}
