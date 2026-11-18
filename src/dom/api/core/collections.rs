//! <https://dom.spec.whatwg.org/#old-style-collections>

use core::cell::{Cell, OnceCell, RefCell, UnsafeCell};
use core::num::NonZeroU32;

use bun_core::WTFStringImplStruct as Impl;
use bun_jsc::JSValue;
use bun_jsc::bindgen::{Class, JsAtom, JsHeap, JsInterface, PropertyNames, PublishesItems};
use smallvec::SmallVec;

use super::changes::{Few, Move};
use super::{NodeFlags as F, *};
use crate::api::support::allocate_quietly;
use crate::generated_bindgen::collections::{
    HTMLAllCollection, HTMLCollection, NodeList, js_Collection, js_HTMLAllCollection,
    js_HTMLCollection, js_NodeList,
};
use crate::name::{Map, Name, name};
use crate::selector::{filter, key};

type Add<'r, 'a> = &'r mut dyn FnMut(&'a Element);
type Found = SmallVec<[*const Node; 2]>;

/// For descendants.
pub(crate) struct Test {
    /// One of which it has. Empty for any.
    pub(crate) tags: &'static [Known],
    pub(crate) bare: Bare,
    pub(crate) reads: Reads,
    /// By the element alone.
    pub(crate) matches: fn(&Element) -> bool,
    /// By what is between the root and the element.
    pub(crate) belongs: fn(&Node, &Element) -> bool,
    /// Whether it has listed them, as there is more to it for now.
    pub(crate) lists: for<'a> fn(&'a Node, Option<Add<'_, 'a>>) -> bool,
    /// Whether there is still no more to it after an element has moved, if `lists` takes long to tell.
    pub(crate) allows_move: Option<fn(&Node, &Element) -> bool>,
}

/// Which of the elements that have no object yet it is asked about.
pub(crate) enum Bare {
    None,
    With(Known),
    All,
}

impl Test {
    pub(crate) const ALL: Test = Test {
        tags: &[],
        bare: Bare::All,
        reads: Reads::Nothing,
        matches: |_| true,
        belongs: |_, _| true,
        lists: |_, _| false,
        allows_move: None,
    };
}

/// None of the functions runs scripts or changes the tree.
pub(crate) enum Filter {
    Static,
    ChildNodes,
    /// Only for `children`, of which a node has one.
    Children,
    /// Some of the children, by their kind. A node has one such.
    Parts(fn(&Element) -> bool),
    Descendants {
        test: &'static Test,
        keys: u64,
    },
    DescendantsByName(Atom, fn(&Atom, &Element) -> bool),
    Tag {
        html: Atom,
        other: Atom,
        keys: u64,
    },
    TagNs(Option<Ns>, Option<Atom>),
    Class(Box<[DomString]>),
    Listed(for<'a> fn(&'a Node, Add<'_, 'a>)),
    ListedByName(Atom, for<'a> fn(&'a Node, &Atom, Add<'_, 'a>)),
}

fn keys_of_tags(tags: &[Known]) -> u64 {
    filter(tags.iter().map(|it| key::tag(Atom::of(*it).name())))
}

impl Filter {
    pub(crate) fn descendants(test: &'static Test) -> Filter {
        Filter::Descendants {
            test,
            keys: if test.tags.is_empty() {
                u64::MAX
            } else {
                keys_of_tags(test.tags)
            },
        }
    }

    /// What it adds is in the tree of the root, and depends on `Reads::Ties`.
    pub(crate) fn listed(list: for<'a> fn(&'a Node, Add<'_, 'a>)) -> Filter {
        Filter::Listed(list)
    }

    pub(crate) fn listed_by_name(
        name: Atom,
        list: for<'a> fn(&'a Node, &Atom, Add<'_, 'a>),
    ) -> Filter {
        Filter::ListedByName(name, list)
    }

    fn reads(&self) -> Reads {
        match self {
            Filter::Descendants { test, .. } => test.reads,
            Filter::Class(_) => Reads::Classes,
            Filter::DescendantsByName(..) | Filter::Listed(_) | Filter::ListedByName(..) => {
                Reads::Ties
            }
            _ => Reads::Nothing,
        }
    }

    /// What says that a list of children is current.
    #[inline(always)]
    fn flag(&self) -> Option<F> {
        match self {
            Filter::ChildNodes => Some(F::CHILD_NODES_ARE_CACHED),
            Filter::Children => Some(F::CHILDREN_ARE_CACHED),
            Filter::Parts(_) => Some(F::CHILD_CACHE),
            _ => None,
        }
    }

    #[inline]
    fn takes_child(&self, child: &Node) -> bool {
        match self {
            Filter::ChildNodes => true,
            Filter::Parts(matches) => child.as_element().is_some_and(matches),
            _ => child.is_element(),
        }
    }

    /// What matches has one of them.
    fn keys(&self, root: &Node) -> u64 {
        match self {
            Filter::Tag { keys, .. } | Filter::Descendants { keys, .. } => *keys,
            Filter::Class(names) => names.first().map_or(0, |it| {
                let name = if root.doc().quirks() {
                    Name::lowercase
                } else {
                    Name::new
                };
                filter(core::iter::once(key::class(name(it.to_utf8().as_bytes()))))
            }),
            _ => u64::MAX,
        }
    }

    /// Wherever it is.
    #[inline]
    fn may_match(&self, it: &Element) -> bool {
        match self {
            Filter::Descendants { test, .. } => (test.matches)(it),
            Filter::DescendantsByName(name, matches) => matches(name, it),
            Filter::Tag { html, other, .. } => {
                it.has_qualified_name(if it.kind().is_html() { html } else { other })
            }
            Filter::TagNs(ns, local) => {
                local
                    .as_ref()
                    .is_none_or(|local| it.with(|it| it.local == *local))
                    && ns.as_ref().is_none_or(|ns| it.ns() == *ns)
            }
            Filter::Class(names) => {
                let ignores_case = it.doc().quirks();
                it.with_attr_string(atom!("class"), |all| {
                    names.iter().all(|it| all.has_token(it, ignores_case))
                }) == Some(true)
            }
            _ => false,
        }
    }

    fn may_match_bare(&self, root: &Node, it: &crate::tree::Element) -> bool {
        match self {
            Filter::Descendants { test, .. } => match test.bare {
                _ if !test.tags.is_empty() && !test.tags.contains(&it.local.known()) => false,
                Bare::None => false,
                Bare::With(attribute) => it.has(Atom::of(attribute).name()),
                Bare::All => true,
            },
            Filter::DescendantsByName(..) => it.id != Name::NONE || it.has(name!("name")),
            Filter::Tag { html, other, keys } => {
                *keys == u64::MAX || it.local == *html || it.local == *other
            }
            Filter::TagNs(_, local) => local.as_ref().is_none_or(|local| it.local == *local),
            Filter::Class(names) => it.classes.as_ref().is_some_and(|it| {
                names
                    .iter()
                    .all(|name| it.source.string().has_token(name, root.doc().quirks()))
            }),
            _ => false,
        }
    }

    /// In tree order after `at`, the descendants of `within` that are worth looking at.
    fn candidates<'a>(
        &self,
        within: &'a Node,
        at: &Node,
        keys: u64,
    ) -> impl Iterator<Item = &'a Element> {
        within.descendants_after(at, keys, move |it| self.may_match_bare(within, it))
    }

    #[inline]
    fn matches(&self, root: &Node, it: &Element) -> bool {
        self.may_match(it)
            && if let Filter::Descendants { test, .. } = self {
                (test.belongs)(root, it)
            } else {
                true
            }
    }

    fn stays_in_tree_order(&self, root: &Node, since: u64) -> bool {
        let Filter::Descendants {
            test: Test {
                allows_move: Some(allows),
                ..
            },
            ..
        } = self
        else {
            return false;
        };
        root.arena().moves_since(since).is_some_and(|it| {
            it.iter()
                .filter_map(|it| it.node.as_element())
                .all(|it| allows(root, it))
        })
    }

    /// The descendants that match, and nothing else.
    fn is_in_tree_order(&self, root: &Node) -> bool {
        match self {
            Filter::Descendants { test, .. } => !(test.lists)(root, None),
            Filter::Listed(_) | Filter::ListedByName(..) => false,
            _ => true,
        }
    }
}

#[repr(C)]
pub(crate) struct Collection {
    filter: Filter,
    /// The first ones, or all. They are in the tree of the root for as long as `version` is that of its arena.
    found: UnsafeCell<Found>,
    version: Cell<u64>,
    version_of_attributes: Cell<u64>,
    names: OnceCell<Box<RefCell<Names>>>,
    /// Where something was last looked for.
    hints: Cell<[u32; 2]>,
    /// `Arena::collections` then. What was corrected is not relied on to keep nodes alive.
    corrected_at: Cell<Option<NonZeroU32>>,
    /// How often scripts have to read it before it is worth publishing.
    patience: Cell<u32>,
    reads: Reads,
    is_complete: Cell<bool>,
    was_in_tree_order: Cell<bool>,
}

pub(crate) type NamesOf = fn(&Element) -> [Option<DomString>; 2];

#[derive(Default)]
struct Named {
    all: SmallVec<[*const Node; 1]>,
    is_mixed_up: bool,
}

/// Of a collection that is complete.
struct Names {
    of: NamesOf,
    /// That of `Reads::Ties`.
    version: u64,
    /// The index is made for the second name.
    was_asked: bool,
    index: Option<Map<Atom, Named>>,
}

impl Names {
    fn atoms(&self, element: &Element) -> impl Iterator<Item = Atom> + use<> {
        let [first, second] = (self.of)(element);
        let second = second.filter(|it| first.as_ref() != Some(it));
        [first, second]
            .into_iter()
            .flatten()
            .map(|it| Atom::from_string(&it))
    }

    fn add(&mut self, element: &Element, is_last: bool) {
        for name in self.atoms(element) {
            let Some(named) = self.index.as_mut().map(|it| it.entry(name).or_default()) else {
                return;
            };
            named.is_mixed_up |= !is_last && !named.all.is_empty();
            named.all.push(&raw const **element);
        }
    }

    fn remove(&mut self, element: &Element) {
        for name in self.atoms(element) {
            if let Some(index) = &mut self.index
                && let Some(named) = index.get_mut(&name)
            {
                named
                    .all
                    .retain(|it| !core::ptr::eq(*it, &raw const **element));
                if named.all.is_empty() {
                    index.remove(&name);
                }
            }
        }
    }

    fn forget(&mut self) {
        (self.was_asked, self.index) = (false, None);
    }
}

fn is_among(node: &Node, all: &[&Node]) -> bool {
    all.contains(&node)
}

impl Collection {
    pub(crate) fn of_class<'a, T: JsInterface<Struct = Collection>>(
        heap: &JsHeap<'a>,
        class: Class<T>,
        root: &'a Node,
        filter: Filter,
    ) -> &'a T {
        Collection::create(root.doc().realm(heap), class, root.to_js(), filter)
    }

    #[inline]
    fn create<'a, T: JsInterface<Struct = Collection>>(
        heap: &JsHeap<'a>,
        class: Class<T>,
        owner: JSValue,
        filter: Filter,
    ) -> &'a T {
        let made = Collection {
            reads: filter.reads(),
            filter,
            found: UnsafeCell::default(),
            version: Cell::new(0),
            version_of_attributes: Cell::new(0),
            names: OnceCell::new(),
            hints: Cell::new([0; 2]),
            corrected_at: Cell::new(None),
            patience: Cell::new(0),
            is_complete: Cell::new(false),
            was_in_tree_order: Cell::new(false),
        };
        let made = class.create(heap, made);
        // SAFETY: it extends this.
        js_Collection::set_owner(
            unsafe { Collection::from_js_unchecked(made.to_js()) },
            owner,
        );
        made
    }

    #[inline(always)]
    fn owner_value(&self) -> JSValue {
        js_Collection::owner(self).unwrap_or(JSValue::UNDEFINED)
    }

    /// Of one that is live.
    #[inline(always)]
    pub(crate) fn owner(&self) -> &Node {
        debug_assert!(!matches!(self.filter, Filter::Static));
        // SAFETY: it holds the node.
        unsafe { Node::from_cell(self.owner_value()) }
    }

    fn fixed(&self) -> Option<List<'_>> {
        match self.filter {
            Filter::Static => Some(List::from_value(self.owner_value())),
            _ => None,
        }
    }

    /// For one that is `listed`.
    pub(crate) fn outdate(&self) {
        self.version.set(0);
        self.withdraw_items();
    }

    #[inline]
    fn has_only_live_nodes(&self, root: &Node) -> bool {
        self.corrected_at
            .get()
            .is_none_or(|it| it.get() == root.arena().collections())
    }

    #[inline]
    fn is_current(&self, root: &Node) -> bool {
        let is_current = match self.filter.flag() {
            Some(flag) => root.has(flag),
            None => {
                self.version.get() == root.arena().version.get()
                    && self.version_of_attributes.get() == root.arena().version_of(self.reads)
                    && !root.has(F::USER_AGENT)
            }
        };
        is_current && self.has_only_live_nodes(root)
    }

    #[inline(never)]
    fn catch_up(&self, root: &Node, found: &mut Found) {
        let arena = root.arena();
        if self.filter.flag().is_none()
            && self.was_in_tree_order.get()
            && arena.has_same_elements_as_at(self.version.get())
            && arena.version_of(self.reads) == self.version_of_attributes.get()
            && !root.has(F::USER_AGENT)
            && self.has_only_live_nodes(root)
        {
            return self.version.set(arena.version.get());
        }
        let is_worth_it = (found.len() > 8
            || self.is_complete.get() && self.filter.flag().is_none())
            && !root.has(F::USER_AGENT)
            && self.has_only_live_nodes(root);
        let is_in_tree_order = is_worth_it
            && self.was_in_tree_order.get()
            && self.filter.stays_in_tree_order(root, self.version.get())
            || self.filter.is_in_tree_order(root);
        let was_in_tree_order = self.was_in_tree_order.replace(is_in_tree_order);
        let corrected = match self.filter.flag() {
            _ if !is_worth_it => None,
            Some(flag) => arena
                .moves_since_loss(root, flag)
                .and_then(|it| self.correct_children(root, found, &it)),
            None if is_in_tree_order && was_in_tree_order => self.correct_descendants(root, found),
            None => None,
        };
        self.corrected_at
            .set(corrected.and_then(|()| NonZeroU32::new(arena.collections())));
        if corrected.is_none() {
            self.found_changes(found);
            found.clear();
            self.is_complete.set(false);
            self.names.get().inspect(|it| it.borrow_mut().forget());
        }
        root.set(self.filter.flag().unwrap_or(F::empty()));
        self.version.set(arena.version.get());
        self.version_of_attributes.set(arena.version_of(self.reads));
    }

    #[inline]
    fn found_changes(&self, found: &Found) {
        self.withdraw_items();
        self.patience.set(found.len() as u32 / 4);
    }

    /// For scripts.
    #[inline]
    fn read(&self, index: u32) -> Option<&Node> {
        let node = self.node(index);
        if !self.renew_items() {
            match self.patience.get() {
                0 => self.publish(),
                patience => self.patience.set(patience - 1),
            }
        }
        node
    }

    /// It is current.
    #[inline(never)]
    fn publish(&self) {
        if let Some(list) = self.fixed() {
            // SAFETY: the list holds them.
            list.contiguous()
                .into_iter()
                .for_each(|it| unsafe { self.publish_values(it) });
        } else if self.owner().has(F::USER_AGENT) {
            self.patience.set(u32::MAX);
        } else if self.is_complete.get() {
            // SAFETY: they are current, and the thread outlives its VM.
            super::changes::with_clock(self.reads, |clock| unsafe {
                self.publish_instances(&*self.found.get(), clock)
            });
        }
    }

    fn position(&self, found: &[*const Node], node: &Node) -> Option<usize> {
        let [last, other] = self.hints.get();
        let is_at = |it: &u32| {
            found
                .get(*it as usize)
                .is_some_and(|it| core::ptr::eq(*it, node))
        };
        let near = |hint: u32| {
            [hint, hint + 1, hint.wrapping_sub(1)]
                .into_iter()
                .find(is_at)
        };
        let (index, kept) = match near(last) {
            Some(index) => (index, other),
            None => (
                near(other)
                    .or_else(|| Some((found.len() as u32).wrapping_sub(1)).filter(is_at))
                    .or_else(|| {
                        Some(found.iter().position(|it| core::ptr::eq(*it, node))? as u32)
                    })?,
                last,
            ),
        };
        self.hints.set([index, kept]);
        Some(index as usize)
    }

    /// Before they are used, or `found` is corrected.
    fn forget_names_if_changed(
        &self,
        root: &Node,
        found: &[*const Node],
        is_new: impl Fn(&Node) -> bool,
    ) {
        let Some(mut names) = self.names.get().map(|it| it.borrow_mut()) else {
            return;
        };
        let old = core::mem::replace(&mut names.version, root.arena().version_of(Reads::Ties));
        if names.was_asked
            && root
                .arena()
                .changed_since(Reads::Ties, old)
                .is_none_or(|it| {
                    it.iter()
                        .any(|it| !is_new(it) && self.position(found, it).is_some())
                })
        {
            names.forget();
        }
    }

    fn take_out(&self, found: &mut Found, node: &Node) {
        if let Some(index) = self.position(found, node) {
            self.found_changes(found);
            found.remove(index);
            self.names
                .get()
                .zip(node.as_element())
                .inspect(|(names, it)| names.borrow_mut().remove(it));
        }
    }

    /// `None` if `next` is missing.
    fn put_before(&self, found: &mut Found, nodes: &[&Node], next: Option<&Node>) -> Option<()> {
        let index = match next.map(|it| self.position(found, it)) {
            Some(Some(index)) => index,
            _ if !self.is_complete.get() => return Some(()),
            Some(None) => return None,
            None => found.len(),
        };
        if let Some(mut names) = self
            .names
            .get()
            .map(|it| it.borrow_mut())
            .filter(|it| it.index.is_some())
        {
            nodes
                .iter()
                .filter_map(|it| it.as_element())
                .for_each(|it| names.add(it, next.is_none()));
        }
        self.found_changes(found);
        match nodes {
            [only] => found.insert(index, *only),
            _ => found.insert_many(index, nodes.iter().map(|it| core::ptr::from_ref(*it))),
        }
        Some(())
    }

    fn correct_children(&self, root: &Node, found: &mut Found, moves: &[Move<'_>]) -> Option<()> {
        let is_new = |node: &Node| {
            moves
                .iter()
                .find(|it| it.node == node)
                .is_some_and(|it| !it.is_removal)
        };
        self.forget_names_if_changed(root, found, |it| {
            is_new(it) || it.parent() != Some(root) && moves.iter().all(|moved| moved.node != it)
        });
        moves
            .iter()
            .filter(|it| it.is_removal && !is_new(it.node) && self.filter.takes_child(it.node))
            .for_each(|it| self.take_out(found, it.node));
        let mut added = Few::new();
        for it in moves
            .iter()
            .map(|it| it.node)
            .filter(|it| it.parent() == Some(root) && self.filter.takes_child(it))
        {
            if !is_among(it, &added) {
                added.push(it);
            }
        }
        while !added.is_empty() {
            let node = added.remove(0);
            self.put_before(
                found,
                &[node],
                node.next_siblings()
                    .find(|it| self.filter.takes_child(it) && !is_among(it, &added)),
            )?;
        }
        Some(())
    }

    /// What has neither moved, alone or with an ancestor, nor changed is where it was.
    fn correct_descendants(&self, root: &Node, found: &mut Found) -> Option<()> {
        const MOST: usize = 32;
        let (arena, filter, keys) = (root.arena(), &self.filter, self.filter.keys(root));
        let (moves, changed) = (
            arena.moves_since(self.version.get())?,
            arena.changed_since(self.reads, self.version_of_attributes.get())?,
        );
        if changed.is_empty() && !moves.iter().any(|it| it.node.is_element()) {
            return Some(());
        }
        let moved = |is_removal| {
            moves
                .iter()
                .filter(move |it| it.is_removal == is_removal && it.node.is_element())
        };
        let [removed, inserted] =
            [true, false].map(|it| moved(it).map(|it| it.node).collect::<Few<_>>());
        let has_other_classes = self.reads == Reads::Classes
            && arena.read(|engine| !engine.smil.effects.bases.is_empty());
        if has_other_classes
            || !removed.is_empty() && root.inclusive_ancestors().any(|it| is_among(it, &removed))
        {
            return None;
        }
        let was_inside = |node: &Node| {
            node.inclusive_ancestors()
                .any(|it| it == root || is_among(it, &removed))
        };
        let is_new = |node: &Node| {
            !was_inside(node)
                || removed.is_empty()
                    && node
                        .inclusive_ancestors()
                        .take_while(|it| *it != root)
                        .any(|it| is_among(it, &inserted))
        };
        self.forget_names_if_changed(root, found, is_new);
        changed
            .iter()
            .filter(|it| !is_new(it))
            .for_each(|it| self.take_out(found, it));
        let gone = moved(true)
            .filter(|it| was_inside(it.parent))
            .flat_map(|it| {
                it.node
                    .as_element()
                    .into_iter()
                    .chain(it.node.objects_with(keys))
            })
            .filter(|it| filter.may_match(it));
        for (count, it) in gone.enumerate() {
            (count < MOST).then_some(())?;
            self.take_out(found, it);
        }
        let is_on_its_own = |node: &Node| {
            node.ancestors()
                .find(|it| *it == root || is_among(it, &inserted))
                == Some(root)
        };
        let (mut added, mut groups) = (
            SmallVec::<[&Node; MOST]>::new(),
            Few::<(&Node, usize)>::new(),
        );
        for (node, is_subtree) in inserted
            .iter()
            .map(|it| (*it, true))
            .chain(changed.iter().map(|it| (*it, false)))
            .filter(|it| is_on_its_own(it.0))
        {
            let (start, candidates) = (
                added.len(),
                node.as_element().into_iter().chain(
                    is_subtree
                        .then(|| filter.candidates(node, node, keys))
                        .into_iter()
                        .flatten(),
                ),
            );
            for it in candidates.filter(|it| filter.matches(root, it)) {
                (added.len() < MOST).then_some(())?;
                if !is_among(it, &added[..start]) {
                    added.push(it);
                }
            }
            added[start..]
                .last()
                .into_iter()
                .for_each(|it| groups.push((it, added.len())));
        }
        let mut start = 0;
        for (last, end) in groups {
            let next = filter
                .candidates(root, last, keys)
                .find(|it| filter.matches(root, it) && !is_among(it, &added[end..]));
            self.put_before(found, &added[start..end], next.map(|it| &**it))?;
            start = end;
        }
        Some(())
    }

    /// With the first `wanted` ones, or more.
    #[inline]
    fn with_found<R>(&self, wanted: usize, read: impl FnOnce(&[*const Node]) -> R) -> R {
        // SAFETY: `read` does not come back to this collection.
        read(unsafe { self.found_up_to(wanted) })
    }

    /// # Safety
    /// The result is dropped before the collection is used again.
    #[inline]
    unsafe fn found_up_to(&self, wanted: usize) -> &[*const Node] {
        // SAFETY: the filters do not come back to this collection.
        let (root, found) = (self.owner(), unsafe { &mut *self.found.get() });
        if !self.is_current(root) {
            self.catch_up(root, found);
        }
        if found.len() < wanted && !self.is_complete.get() {
            self.find(root, found, wanted);
        }
        found
    }

    #[inline(never)]
    fn find(&self, root: &Node, found: &mut Found, wanted: usize) {
        // SAFETY: it is current.
        let last = found.last().map(|it| unsafe { &**it });
        let wanted = wanted.max(found.len() + found.len() / 2);
        let missing = wanted - found.len();
        let mut add = |it: &Element| found.push(&raw const **it);
        match &self.filter {
            Filter::Listed(list) => list(root, &mut add),
            Filter::ListedByName(name, list) => list(root, name, &mut add),
            Filter::Descendants { test, .. } if !self.was_in_tree_order.get() => {
                _ = (test.lists)(root, Some(&mut add))
            }
            filter if filter.flag().is_some() => {
                let children = core::iter::successors(
                    last.map_or_else(|| root.first_child(), Node::next_sibling),
                    |it| it.next_sibling(),
                );
                children
                    .filter(|it| filter.takes_child(it))
                    .take(missing)
                    .for_each(|it| found.push(it));
                return self.is_complete.set(found.len() < wanted);
            }
            filter => {
                let keys = filter.keys(root);
                root.read(|tree, id| {
                    let candidates = tree
                        .descendants_after(id, last.map_or(id, Node::id), keys)
                        .filter(|it| {
                            !tree.is_bare(*it)
                                || tree
                                    .element(*it)
                                    .is_some_and(|it| filter.may_match_bare(root, it))
                        });
                    // SAFETY: the root holds its descendants.
                    let candidates =
                        candidates.filter_map(|it| unsafe { tree.cell(it).as_ref() }?.as_element());
                    candidates
                        .filter(|it| filter.matches(root, it))
                        .take(missing)
                        .for_each(add);
                });
                return self.is_complete.set(found.len() < wanted);
            }
        }
        self.is_complete.set(true);
    }

    #[inline]
    pub(crate) fn len(&self) -> u32 {
        self.fixed()
            .map_or_else(|| self.with_found(usize::MAX, <[_]>::len) as u32, List::len)
    }

    #[inline]
    pub(crate) fn node(&self, index: u32) -> Option<&Node> {
        match self.fixed() {
            Some(list) => list.node(index),
            None => self.with_found(index as usize + 1, |it| {
                // SAFETY: it is current, and the stack holds it from now on.
                it.get(index as usize).map(|it| unsafe { &**it })
            }),
        }
    }

    pub(crate) fn at(&self, index: u32) -> Option<&Element> {
        self.node(index)?.as_element()
    }

    /// In one that is live.
    pub(crate) fn index_of(&self, node: &Node) -> Option<u32> {
        self.with_found(usize::MAX, |all| self.position(all, node))
            .map(|it| it as u32)
    }

    /// It sees what changes meanwhile.
    pub(crate) fn nodes(&self) -> impl Iterator<Item = &Node> {
        (0..).map_while(|it| self.node(it))
    }

    pub(crate) fn elements(&self) -> impl Iterator<Item = &Element> {
        self.nodes().filter_map(Node::as_element)
    }

    /// In order, for use until something is allocated. `names_of` is always the same for a collection, which is live.
    pub(crate) fn all_named(&self, name: &Atom, names_of: NamesOf) -> SmallVec<[&Element; 2]> {
        // SAFETY: they are current.
        let element = |it: &*const Node| unsafe { &**it }.as_element();
        self.with_found(usize::MAX, |found| {
            self.forget_names_if_changed(self.owner(), found, |it| {
                self.was_in_tree_order.get() && !self.owner().contains(it)
            });
            let new = || {
                Box::new(RefCell::new(Names {
                    of: names_of,
                    version: self.owner().arena().version_of(Reads::Ties),
                    was_asked: false,
                    index: None,
                }))
            };
            let mut names = self.names.get_or_init(new).borrow_mut();
            let look_through = || {
                let text = name.to_dom_string();
                found
                    .iter()
                    .filter_map(element)
                    .filter(|it| names_of(it).iter().flatten().any(|it| *it == text))
                    .collect::<SmallVec<[_; 2]>>()
            };
            if !core::mem::replace(&mut names.was_asked, true) {
                return look_through();
            }
            if names.index.is_none() {
                names.index = Some(Map::default());
                found
                    .iter()
                    .filter_map(element)
                    .for_each(|it| names.add(it, true));
            }
            let Some(named) = names.index.as_mut().and_then(|it| it.get_mut(name)) else {
                return SmallVec::new();
            };
            if core::mem::take(&mut named.is_mixed_up) {
                named.all = look_through()
                    .into_iter()
                    .map(|it| &raw const **it)
                    .collect();
            }
            named.all.iter().filter_map(element).collect()
        })
    }

    fn add_names(&self, names: &mut PropertyNames, names_of: NamesOf) {
        self.elements()
            .flat_map(names_of)
            .flatten()
            .for_each(|it| names.add(it.as_impl()));
    }
}

macro_rules! members {
    ($($name:ty)*) => {
        $(impl $name {
            #[inline]
            pub(crate) fn get_length(&self, _: &JsHeap<'_>) -> u32 {
                self.len()
            }

            #[inline]
            pub(crate) fn indexed_get(&self, index: u32) -> Option<&Node> {
                self.read(index)
            }
        })*
    };
}
members!(NodeList HTMLCollection HTMLAllCollection);

fn id_and_name(element: &Element, has_name: bool) -> [Option<DomString>; 2] {
    [
        (atom!("id"), element.has(F::HAS_ID)),
        (atom!("name"), has_name),
    ]
    .map(|(attribute, counts)| {
        counts
            .then(|| element.attr(attribute))?
            .filter(|it| !it.is_empty())
    })
}

fn names_in_collections(element: &Element) -> [Option<DomString>; 2] {
    id_and_name(element, element.kind().is_html())
}

impl NodeList {
    pub(crate) fn from_list<'a>(heap: &JsHeap<'a>, nodes: List<'a>) -> &'a NodeList {
        Collection::create(heap, js_NodeList::CLASS, nodes.to_js(), Filter::Static)
    }

    pub(crate) fn from_nodes<'a>(
        heap: &JsHeap<'a>,
        nodes: impl IntoIterator<Item = &'a Node>,
    ) -> &'a NodeList {
        NodeList::from_list(heap, List::from_nodes(heap, nodes))
    }

    pub(crate) fn live<'a>(heap: &JsHeap<'a>, root: &'a Node, filter: Filter) -> &'a NodeList {
        Collection::of_class(heap, js_NodeList::CLASS, root, filter)
    }

    pub(crate) fn of_class<
        'a,
        T: JsInterface<Struct = Collection> + core::ops::Deref<Target = NodeList>,
    >(
        heap: &JsHeap<'a>,
        class: Class<T>,
        root: &'a Node,
        filter: Filter,
    ) -> &'a T {
        Collection::of_class(heap, class, root, filter)
    }
}

impl HTMLCollection {
    pub(crate) fn new<'a>(heap: &JsHeap<'a>, root: &'a Node, filter: Filter) -> &'a HTMLCollection {
        Collection::of_class(heap, js_HTMLCollection::CLASS, root, filter)
    }

    pub(crate) fn from_value<'a>(value: JSValue) -> Option<&'a HTMLCollection> {
        // SAFETY: it is one, and the stack holds it from now on.
        HTMLCollection::is(value).then(|| unsafe { HTMLCollection::from_js_unchecked(value) })
    }

    pub(crate) fn named(&self, name: &Atom) -> SmallVec<[&Element; 2]> {
        self.all_named(name, names_in_collections)
    }

    pub(crate) fn named_get<'a>(&'a self, _: &JsHeap<'a>, name: &Impl) -> Option<JSValue> {
        Atom::with_impl(name, |it| self.named(it))
            .first()
            .map(|it| it.to_js())
    }

    pub(crate) fn named_keys<'a>(&'a self, _: &JsHeap<'a>, names: &mut PropertyNames) {
        self.add_names(names, names_in_collections);
    }

    pub(crate) fn named_item<'a>(&'a self, heap: &JsHeap<'a>, name: JsAtom<'a>) -> JSValue {
        self.named_get(heap, name.get()).unwrap_or(JSValue::NULL)
    }
}

/// <https://html.spec.whatwg.org/#all-named-elements>
fn names_in_all(it: &Element) -> [Option<DomString>; 2] {
    use Kind::*;
    id_and_name(
        it,
        matches!(
            it.kind(),
            Anchor
                | Button
                | Embed
                | Form
                | Frame
                | FrameSet
                | IFrame
                | Image
                | Input
                | Map
                | Meta
                | Object
                | Select
                | TextArea
        ),
    )
}

impl HTMLAllCollection {
    pub(crate) fn new<'a>(heap: &JsHeap<'a>, doc: &'a Doc) -> &'a HTMLAllCollection {
        Collection::of_class(
            heap,
            js_HTMLAllCollection::CLASS,
            doc,
            Filter::descendants(&Test::ALL),
        )
    }

    pub(crate) fn named_get<'a>(&'a self, heap: &JsHeap<'a>, name: &Impl) -> Option<JSValue> {
        match *Atom::with_impl(name, |it| self.all_named(it, names_in_all)) {
            [] => None,
            [only] => Some(only.to_js()),
            _ => Some(
                HTMLCollection::new(
                    heap,
                    self.owner(),
                    Filter::DescendantsByName(Atom::from_impl(name), |name, it| {
                        names_in_all(it).contains(&Some(name.to_dom_string()))
                    }),
                )
                .to_js(),
            ),
        }
    }

    pub(crate) fn named_keys<'a>(&'a self, _: &JsHeap<'a>, names: &mut PropertyNames) {
        self.add_names(names, names_in_all);
    }

    pub(crate) fn named_item<'a>(&'a self, heap: &JsHeap<'a>, name: JsAtom<'a>) -> JSValue {
        self.named_get(heap, name.get()).unwrap_or(JSValue::NULL)
    }

    pub(crate) fn call_instance<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        name_or_index: Option<JsAtom<'a>>,
    ) -> JSValue {
        self.item(heap, name_or_index)
    }

    pub(crate) fn item<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        name_or_index: Option<JsAtom<'a>>,
    ) -> JSValue {
        let Some(key) = name_or_index else {
            return JSValue::NULL;
        };
        let text = DomString::from_impl(key.get());
        let index = text
            .ascii()
            .filter(|it| it.len() == 1 || it.starts_with(|it| matches!(it, '1'..='9')))
            .and_then(|it| it.parse().ok())
            .filter(|it| *it != u32::MAX);
        index.map_or_else(
            || self.named_item(heap, key),
            |it| self.node(it).map_or(JSValue::NULL, Node::to_js),
        )
    }
}

impl Node {
    pub(crate) fn child_nodes<'a>(&'a self, heap: &JsHeap<'a>) -> JSValue {
        self.same_object(heap, Edge::ChildNodes, || {
            NodeList::live(heap, self, Filter::ChildNodes).to_js()
        })
    }

    pub(super) fn list_of_children(&self) -> &Collection {
        let this = self.to_js();
        let list = self.edge(Edge::ChildNodes).unwrap_or_else(|| {
            allocate_quietly(self.doc().global(), |heap| {
                // SAFETY: it is `self`.
                unsafe { Node::from_js_unchecked(this) }.child_nodes(heap)
            })
        });
        // SAFETY: what `child_nodes` makes, which the edge holds.
        unsafe { Collection::from_js_unchecked(list) }
    }

    pub(crate) fn children_collection<'a>(&'a self, heap: &JsHeap<'a>) -> JSValue {
        self.same_object(heap, Edge::Children, || {
            HTMLCollection::new(heap, self, Filter::Children).to_js()
        })
    }

    /// The same one for the same key, but for the 257th name.
    pub(crate) fn cached_collection(
        &self,
        heap: &JsHeap<'_>,
        kind: u8,
        key: &Atom,
        make: impl FnOnce(&Atom) -> JSValue,
    ) -> JSValue {
        #[derive(Default)]
        struct Keys(RefCell<Indices>, Cell<Option<((u8, usize), u32)>>);
        type Indices = Map<(u8, usize), (u32, Atom)>;
        fn remember(
            heap: &JsHeap<'_>,
            keys: &mut Indices,
            all: List<'_>,
            kind: u8,
            key: &Atom,
            made: JSValue,
        ) {
            if keys.len() < 256 || key.is_empty() {
                keys.insert((kind, key.identity()), (all.len(), key.clone()));
                all.push(heap, made);
            }
        }
        let (Keys(keys, last), all, sought) = (
            self.extra::<Keys>(),
            self.edge_list(heap, Edge::Collections),
            (kind, key.identity()),
        );
        if let Some((_, index)) = last.get().filter(|it| it.0 == sought) {
            return all.get(index);
        }
        let mut keys = keys.borrow_mut();
        if let Some((index, _)) = keys.get(&sought) {
            last.set(Some((sought, *index)));
            return all.get(*index);
        }
        let made = make(key);
        remember(heap, &mut keys, all, kind, key, made);
        made
    }

    pub(crate) fn elements_by_tag_name<'a>(&'a self, heap: &JsHeap<'a>, name: &Atom) -> JSValue {
        let is_html = self.doc().is_html_doc();
        self.cached_collection(heap, is_html.into(), name, |name| {
            let html = if is_html {
                name.to_ascii_lowercase()
            } else {
                name.clone()
            };
            let has_prefix = name.to_dom_string().units().any(|it| it == 0x3a);
            let keys = if has_prefix {
                u64::MAX
            } else {
                filter([&html, name].into_iter().map(|it| key::tag(it.name())))
            };
            let filter = if *name == atom!("*") {
                Filter::descendants(&Test::ALL)
            } else {
                Filter::Tag {
                    html,
                    other: name.clone(),
                    keys,
                }
            };
            HTMLCollection::new(heap, self, filter).to_js()
        })
    }

    pub(crate) fn elements_by_tag_name_ns<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        ns: Option<&Atom>,
        local: Atom,
    ) -> &'a HTMLCollection {
        let ns = if ns.is_some_and(|it| *it == atom!("*")) {
            None
        } else {
            Some(Ns::from_uri(ns))
        };
        HTMLCollection::new(
            heap,
            self,
            Filter::TagNs(ns, Some(local).filter(|it| *it != atom!("*"))),
        )
    }

    pub(crate) fn elements_by_class_name<'a>(&'a self, heap: &JsHeap<'a>, names: &Atom) -> JSValue {
        self.cached_collection(heap, 2, names, |it| {
            HTMLCollection::new(
                heap,
                self,
                Filter::Class(it.to_dom_string().tokens().collect()),
            )
            .to_js()
        })
    }

    pub(crate) fn elements_by_name<'a>(&'a self, heap: &JsHeap<'a>, name: &Atom) -> JSValue {
        self.cached_collection(heap, 3, name, |it| {
            NodeList::live(
                heap,
                self,
                Filter::listed_by_name(it.clone(), |root, name, add| {
                    root.descendants_named(name).into_iter().for_each(add)
                }),
            )
            .to_js()
        })
    }

    /// The HTML elements with that `name`.
    pub(crate) fn descendants_named(&self, name: &Atom) -> SmallVec<[&Element; 2]> {
        static NAMED: Test = Test {
            bare: Bare::With(atom!("name")),
            reads: Reads::Ties,
            matches: |it| it.kind().is_html() && it.has_attr(atom!("name")),
            ..Test::ALL
        };
        self.unseen_collection(13, &NAMED)
            .all_named(name, |it| [it.attr(atom!("name")), None])
    }

    /// For `Collection::all_named`. No script has it.
    pub(crate) fn unseen_collection(&self, kind: u8, test: &'static Test) -> &Collection {
        let make = |heap: &JsHeap<'_>| {
            self.cached_collection(heap, kind, &Atom::EMPTY, |_| {
                Collection::create(
                    self.doc().realm(heap),
                    js_HTMLCollection::CLASS,
                    self.to_js(),
                    Filter::descendants(test),
                )
                .to_js()
            })
        };
        HTMLCollection::from_value(allocate_quietly(self.doc().global(), make)).expect("made above")
    }

    /// The one at `edge`.
    pub(crate) fn collection_at<T: JsInterface<Struct = Collection>>(
        &self,
        edge: Edge,
        class: Class<T>,
        test: &'static Test,
    ) -> &HTMLCollection {
        let make = |heap: &JsHeap<'_>| {
            self.same_object(heap, edge, || {
                Collection::create(
                    self.doc().realm(heap),
                    class,
                    self.to_js(),
                    Filter::descendants(test),
                )
                .to_js()
            })
        };
        HTMLCollection::from_value(
            self.edge(edge)
                .unwrap_or_else(|| allocate_quietly(self.doc().global(), make)),
        )
        .expect("made above")
    }

    /// In tree order after `at`, those that have one of `keys`.
    fn descendants_after<'a, T: Fn(&crate::tree::Element) -> bool + Copy>(
        &'a self,
        at: &Node,
        keys: u64,
        takes_bare: T,
    ) -> impl Iterator<Item = &'a Element> + use<'a, T> {
        let next = move |at| {
            self.read(|tree, root| {
                tree.descendants_after(root, at, keys)
                    .find(|it| !tree.is_bare(*it) || tree.element(*it).is_some_and(takes_bare))
            })
        };
        core::iter::successors(next(at.id()), move |it| next(*it))
            .filter_map(|it| self.node(it)?.as_element())
    }

    fn objects_with(&self, keys: u64) -> impl Iterator<Item = &Element> {
        self.descendants_after(self, keys, |_| false)
    }

    /// Among the descendants that are not bare, and some others.
    pub(crate) fn objects_with_tag(&self, tag: Known) -> impl Iterator<Item = &Element> {
        self.objects_with(keys_of_tags(&[tag]))
    }

    /// Likewise.
    pub(crate) fn objects_with_attribute(&self, name: Known) -> impl Iterator<Item = &Element> {
        self.objects_with(filter(core::iter::once(key::attribute(
            Atom::of(name).name(),
        ))))
    }

    pub(crate) fn may_have_below(&self, tag: Known) -> bool {
        self.read(|tree, id| tree.may_have_below(id, keys_of_tags(&[tag])))
    }
}
