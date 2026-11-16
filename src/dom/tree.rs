//! The part of the DOM that styles and layout need. JavaScript has the whole of it, and mirrors what is connected.

use core::cell::Cell;
use std::rc::Rc;

use crate::boxes::BoxId;
use crate::cascade::RuleList;
use crate::name::{Name, name};
use crate::properties::Style;
use crate::rules::Classes;
use crate::selector::Pseudo;
use crate::sheet::Block;
use crate::values::Str;

/// 0 is no node.
pub(crate) type NodeId = u32;

bitflags::bitflags! {
    /// `src/js/internal/desktop/dom/native.ts` has the bits below `LINK`, which JavaScript sets.
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
        /// An animation has advanced.
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

pub(crate) struct Attribute {
    pub(crate) name: Name,
    pub(crate) qualified: Str,
    pub(crate) value: Str,
    /// `key::value`
    pub(crate) key: Name,
}

/// What an `img`, a `canvas` or the like shows.
#[derive(Clone, Copy, Default, PartialEq)]
pub(crate) struct Replaced {
    pub(crate) image: u32,
    pub(crate) size: [Option<f32>; 2],
    pub(crate) ratio: Option<f32>,
}

pub(crate) struct Element {
    pub(crate) tag: Name,
    pub(crate) namespace: Namespace,
    pub(crate) id: Name,
    pub(crate) classes: Option<Rc<Classes>>,
    pub(crate) attributes: Vec<Attribute>,
    pub(crate) custom_states: Vec<Name>,
    pub(crate) state: State,
    pub(crate) inline_style: Option<Rc<Block>>,
    pub(crate) hints: Option<Rc<Block>>,
    pub(crate) shadow_root: NodeId,
    /// For a slot.
    pub(crate) assigned: Vec<NodeId>,
    /// What a generated element, or one in the shadow tree of a control, is to `originator`.
    pub(crate) pseudo: Pseudo,
    pub(crate) originator: NodeId,
    /// `::marker`, `::before`, `::after` and `::backdrop`.
    pub(crate) generated: [NodeId; 4],
    /// What `generated_by_rules` has last found.
    pub(crate) generated_by_rules: Option<u8>,
    pub(crate) rules: Option<Rc<RuleList>>,
    /// Without the animations.
    pub(crate) base_style: Option<Rc<Style>>,
    pub(crate) style: Option<Rc<Style>>,
    pub(crate) replaced: Option<Replaced>,
    pub(crate) scroll: [f32; 2],
    /// The content box that container queries were last evaluated with.
    pub(crate) container_size: Option<[f32; 2]>,
    /// For `contain-intrinsic-size: auto`.
    /// Inline and block.
    pub(crate) remembered_size: [Option<f32>; 2],
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
            Namespace::Other => self.attribute(crate::name::name!("\0")).unwrap_or_default(),
        }
    }

    pub(crate) fn new(tag: Name, namespace: Namespace) -> Element {
        Element {
            tag,
            namespace,
            id: Name::NONE,
            classes: None,
            attributes: Vec::new(),
            custom_states: Vec::new(),
            state: State::empty(),
            inline_style: None,
            hints: None,
            shadow_root: 0,
            assigned: Vec::new(),
            pseudo: Pseudo::None,
            originator: 0,
            generated: [0; 4],
            generated_by_rules: None,
            rules: None,
            base_style: None,
            style: None,
            replaced: None,
            scroll: [0.0; 2],
            container_size: None,
            remembered_size: [None; 2],
        }
    }

    pub(crate) fn classes(&self) -> &[Name] {
        self.classes.as_ref().map_or(&[], |it| it)
    }

    pub(crate) fn attribute(&self, name: Name) -> Option<&str> {
        let found = self
            .attributes
            .iter()
            .find(|attribute| attribute.name == name);
        found.map(|attribute| &*attribute.value)
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

    pub(crate) fn is_generated(&self) -> bool {
        self.tag == name!("") || matches!(self.pseudo, Pseudo::Scroll(_))
    }
}

pub(crate) enum Data {
    Free,
    Element(Box<Element>),
    Text(Vec<u8>),
    /// A document, or a fragment.
    Root,
    ShadowRoot {
        host: NodeId,
        user_agent: bool,
    },
}

pub(crate) struct Node {
    pub(crate) parent: NodeId,
    pub(crate) first_child: NodeId,
    pub(crate) last_child: NodeId,
    pub(crate) previous: NodeId,
    pub(crate) next: NodeId,
    /// The document or the shadow root that it is in.
    pub(crate) scope: NodeId,
    pub(crate) slot: NodeId,
    /// For text and for an inline element, the first box whose lines it is in.
    pub(crate) layout_box: BoxId,
    pub(crate) flags: Cell<Flags>,
    /// `selector::filter` of `key::of_element`
    pub(crate) keys: u64,
    /// While its descendants are being styled, a number that is greater than those of its ancestors.
    pub(crate) visit: Cell<u32>,
    /// With `DIRTY_DESCENDANTS`, the child that has them all, or 0.
    pub(crate) dirty_child: Cell<NodeId>,
    pub(crate) data: Data,
}

impl Node {
    fn new(data: Data) -> Node {
        Node {
            parent: 0,
            first_child: 0,
            last_child: 0,
            previous: 0,
            next: 0,
            scope: 0,
            slot: 0,
            layout_box: 0,
            flags: Cell::default(),
            keys: 0,
            visit: Cell::new(0),
            dirty_child: Cell::new(0),
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
            Data::Text(text) => Some(text),
            _ => None,
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

pub(crate) struct Tree {
    nodes: Vec<Node>,
    free: Vec<NodeId>,
    /// To selectors, it has neither a parent nor siblings.
    pub(crate) cut_at: Cell<NodeId>,
    /// The part of a view transition whose rules are being looked for.
    pub(crate) matched_part: Cell<NodeId>,
    pub(crate) is_xml: bool,
    /// Of what has no `lang` attribute above it.
    pub(crate) language: Box<str>,
    /// Some nodes of the document that nothing around them skips.
    unskipped: [Cell<NodeId>; 64],
}

impl core::ops::Index<NodeId> for Tree {
    type Output = Node;
    fn index(&self, id: NodeId) -> &Node {
        &self.nodes[id as usize]
    }
}

impl core::ops::IndexMut<NodeId> for Tree {
    fn index_mut(&mut self, id: NodeId) -> &mut Node {
        &mut self.nodes[id as usize]
    }
}

pub(crate) const DOCUMENT: NodeId = 1;

impl Tree {
    pub(crate) fn new() -> Tree {
        let mut nodes = vec![Node::new(Data::Free), Node::new(Data::Root)];
        nodes[DOCUMENT as usize].scope = DOCUMENT;
        Tree {
            nodes,
            free: Vec::new(),
            cut_at: Cell::new(0),
            matched_part: Cell::new(0),
            is_xml: false,
            language: Box::default(),
            unskipped: [const { Cell::new(0) }; 64],
        }
    }

    pub(crate) fn create(&mut self, data: Data) -> NodeId {
        match self.free.pop() {
            Some(id) => {
                self[id] = Node::new(data);
                id
            }
            None => {
                self.nodes.push(Node::new(data));
                (self.nodes.len() - 1) as NodeId
            }
        }
    }

    pub(crate) fn free(&mut self, id: NodeId) {
        self[id] = Node::new(Data::Free);
        self.free.push(id);
        if self.unskipped(id).get() == id {
            self.unskipped(id).set(0);
        }
    }

    fn unskipped(&self, id: NodeId) -> &Cell<NodeId> {
        &self.unskipped[id as usize & 63]
    }

    /// For when a node gets another parent in the flat tree, or begins to skip its contents.
    pub(crate) fn forget_unskipped(&mut self) {
        self.unskipped = [const { Cell::new(0) }; 64];
    }

    pub(crate) fn is_in_skipped_contents(&self, id: NodeId) -> bool {
        let is_known = |it: NodeId| self.unskipped(it).get() == it;
        if is_known(id) {
            return false;
        }
        let Some(last) = self
            .flat_ancestors(id)
            .find(|it| self[*it].has(Flags::SKIPPED) || is_known(*it) || *it == DOCUMENT)
        else {
            return false;
        };
        if self[last].has(Flags::SKIPPED) {
            return true;
        }
        core::iter::once(id)
            .chain(self.flat_ancestors(id))
            .take_while(|it| *it != last)
            .for_each(|it| self.unskipped(it).set(it));
        false
    }

    pub(crate) fn forget_boxes(&mut self) {
        self.nodes.iter_mut().for_each(|it| it.layout_box = 0);
    }

    pub(crate) fn len(&self) -> usize {
        self.nodes.len() - self.free.len()
    }

    pub(crate) fn contains(&self, id: NodeId) -> bool {
        (self.nodes.get(id as usize)).is_some_and(|node| !matches!(node.data, Data::Free))
    }

    pub(crate) fn link(&mut self, parent: NodeId, child: NodeId, before: NodeId) {
        let previous = match before {
            0 => core::mem::replace(&mut self[parent].last_child, child),
            _ => core::mem::replace(&mut self[before].previous, child),
        };
        match previous {
            0 => self[parent].first_child = child,
            _ => self[previous].next = child,
        }
        let node = &mut self[child];
        (node.parent, node.previous, node.next) = (parent, previous, before);
    }

    pub(crate) fn unlink(&mut self, child: NodeId) {
        if self[child].parent != 0 {
            self.forget_unskipped();
        }
        let node = &mut self[child];
        let (parent, previous, next) = (node.parent, node.previous, node.next);
        (node.parent, node.previous, node.next) = (0, 0, 0);
        if parent == 0 {
            return;
        }
        match previous {
            0 => self[parent].first_child = next,
            _ => self[previous].next = next,
        }
        match next {
            0 => self[parent].last_child = previous,
            _ => self[next].previous = previous,
        }
    }

    pub(crate) fn element(&self, id: NodeId) -> Option<&Element> {
        self.nodes.get(id as usize)?.element()
    }

    pub(crate) fn element_mut(&mut self, id: NodeId) -> Option<&mut Element> {
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
            next = self[current].first_child;
            let mut at = current;
            while next == 0 && at != root {
                next = self[at].next;
                at = self[at].parent;
            }
            Some(current)
        })
    }

    /// `root` and its descendants, with the shadow trees.
    pub(crate) fn visit_subtree(&self, root: NodeId, mut visit: impl FnMut(NodeId)) {
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

    pub(crate) fn flat_ancestors(&self, id: NodeId) -> impl Iterator<Item = NodeId> + '_ {
        let some = |id| (id != 0).then_some(id);
        core::iter::successors(some(self.flat_parent(id)), move |id| {
            some(self.flat_parent(*id))
        })
    }

    /// Without the generated ones.
    pub(crate) fn flat_children(&self, id: NodeId) -> impl Iterator<Item = NodeId> + '_ {
        let (assigned, parent) = match self[id].element() {
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
        self[id].set(flags);
        let mut child = id;
        for ancestor in self.flat_ancestors(id) {
            let node = &self[ancestor];
            if node.has(Flags::DIRTY_DESCENDANTS) {
                if node.dirty_child.get() != child {
                    node.dirty_child.set(0);
                }
                break;
            }
            node.set(Flags::DIRTY_DESCENDANTS);
            node.dirty_child.set(child);
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
