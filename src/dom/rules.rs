//! Which rules apply to an element, and which elements a change can affect.

use core::cell::{Cell, RefCell};
use std::rc::Rc;

use smallvec::SmallVec;

use crate::carousel::{BUTTON_RULES, COLUMN_MARKER_RULES, COLUMN_RULES, MARKER_RULES};
use crate::condition::Subject;
use crate::name::{Map, Name, Set, name};
use crate::selector::{
    Bloom, Combinator, HasResult, HasResults, List, Matcher, Pseudo, Relation, ScrollPart, Simple,
    key,
};
use crate::sheet::{
    AtKind, AtRule, Block, ContainerQuery, Defined, FontFace, Rule, ScopeRule, Sheet,
};
use crate::tree::{AFTER, BEFORE, Element, Flags, MARKER, NodeId, State, Tree};
use crate::values::Str;

#[derive(Clone)]
struct Entry {
    rule: Rc<Rule>,
    ancestors: [u32; 3],
    states: State,
    slot: u16,
    /// For an element that has the key.
    always_matches: bool,
}

/// By `Kind`: for elements, for pseudo-elements, and for `@starting-style`.
type Bucket = [Vec<Entry>; 3];

const ELEMENTS: usize = 0;
const PSEUDOS: usize = 1;
const STARTING: usize = 2;

#[derive(Default)]
struct Index {
    by_key: Map<Name, Bucket>,
    by_parent_key: Map<Name, Bucket>,
    others: Bucket,
}

impl Index {
    fn insert(&mut self, mut entry: Entry, key: Option<Name>) {
        let (selector, context) = (&entry.rule.selector, &entry.rule.context);
        let part = match selector.pseudo {
            _ if context.is_starting => STARTING,
            Pseudo::None => ELEMENTS,
            _ => PSEUDOS,
        };
        let compounds = &selector.compounds;
        entry.always_matches = compounds.len() == 1
            && (compounds[0].simples.is_empty()
                || compounds[0].key().is_some()
                    && matches!(
                        compounds[0].simples[..],
                        [Simple::Class(_) | Simple::Tag(..)]
                    ))
            && context.container.is_none()
            && context.scope.is_none();
        if let Some(keys) = key
            .map(|it| smallvec::smallvec![it])
            .or_else(|| compounds[0].keys())
        {
            keys.iter()
                .for_each(|key| self.by_key.entry(*key).or_default()[part].push(entry.clone()));
        } else if compounds[0].combinator == Combinator::Child
            && let Some(keys) = compounds[1].keys()
        {
            keys.iter().for_each(|key| {
                self.by_parent_key.entry(*key).or_default()[part].push(entry.clone())
            });
        } else {
            self.others[part].push(entry);
        }
    }

    fn retain(&mut self, mut keeps: impl FnMut(&Entry) -> bool) {
        let buckets = self
            .by_key
            .values_mut()
            .chain(self.by_parent_key.values_mut())
            .chain([&mut self.others]);
        buckets
            .flatten()
            .for_each(|entries| entries.retain(&mut keeps));
    }
}

/// What a rule set has for a list of classes.
#[derive(Default)]
struct Candidates {
    own: Bucket,
    of_children: Bucket,
}

/// The same object for all elements with the same `class` attribute.
#[derive(Default)]
pub(crate) struct Classes {
    pub(crate) source: Str,
    names: Box<[Name]>,
    pub(crate) filter: u64,
    /// The version of the rule set that has last seen them.
    activated: Cell<u32>,
    candidates: RefCell<SmallVec<[(u32, Rc<Candidates>); 1]>>,
}

impl Classes {
    pub(crate) fn new(source: &str) -> Classes {
        let names: Box<[_]> = source
            .split_ascii_whitespace()
            .map(|it| Name::new(it.as_bytes()))
            .collect();
        let filter = crate::selector::filter(names.iter().map(|it| key::class(*it)));
        Classes {
            source: source.into(),
            names,
            filter,
            ..Classes::default()
        }
    }
}

impl core::ops::Deref for Classes {
    type Target = [Name];
    fn deref(&self) -> &[Name] {
        &self.names
    }
}

thread_local! {
    static LAST_VERSION: Cell<u32> = const { Cell::new(0) };
}

fn next_version() -> u32 {
    LAST_VERSION.set(LAST_VERSION.get() + 1);
    LAST_VERSION.get()
}

struct Waiting {
    deferred: u32,
    next: u32,
    slot: u16,
}

const CLASS_ATTRIBUTE: Name = key::attribute(name!("class"));
const END: u32 = u32::MAX - 1;
/// An element has had the key.
const SEEN: u32 = u32::MAX;

struct Slot {
    sheet: Rc<Sheet>,
    rank: u16,
    /// The same sheet can be there several times.
    first_rank: usize,
    layer_ranks: Vec<u16>,
    active_media: Vec<bool>,
    is_removed: bool,
}

impl Slot {
    fn evaluate_media(&mut self, media: &dyn Subject) -> bool {
        let mut changed = self.active_media.len() != self.sheet.media.len();
        self.active_media.resize(self.sheet.media.len(), true);
        for (index, (condition, outer)) in self.sheet.media.iter().enumerate() {
            let is_active = (index == 0 || self.active_media[usize::from(*outer)])
                && condition.evaluate(media) == Some(true);
            changed |= core::mem::replace(&mut self.active_media[index], is_active) != is_active;
        }
        changed
    }
}

#[derive(Default)]
pub(crate) struct Subjects {
    keys: Set<Name>,
    parent_keys: Set<Name>,
    others: Vec<Rc<Rule>>,
    pub(crate) is_everything: bool,
}

impl Subjects {
    pub(crate) fn mark(&self, tree: &Tree, root: NodeId) {
        if self.keys.is_empty() && self.parent_keys.is_empty() && self.others.is_empty() {
            return;
        }
        tree.visit_subtree(root, |id| {
            let Some(element) = tree.element(id).filter(|it| it.style.is_some()) else {
                return;
            };
            let has = |element: &Element, keys: &Set<Name>| {
                !keys.is_empty() && key::of_element(element).any(|it| keys.contains(&it))
            };
            let host = tree.host_of(tree[id].scope);
            let may_match = |it: &Rc<Rule>| {
                it.context.scope.is_some()
                    || Matcher::new(tree, host, host, None).matches(&it.selector, id)
            };
            if has(element, &self.keys)
                || tree
                    .element(tree[id].parent)
                    .is_some_and(|it| has(it, &self.parent_keys))
                || self.others.iter().any(may_match)
            {
                tree.mark_style(id, Flags::REMATCH);
            }
        });
    }
}

pub(crate) const UNLAYERED: u16 = u16::MAX - 1;
pub(crate) const INLINE: u16 = u16::MAX;

/// The rules of the style sheets of a document or of a shadow root.
#[derive(Default)]
pub(crate) struct RuleSet {
    slots: Vec<Slot>,
    index: Index,
    /// The first of the rules that wait for an element to have the key.
    waiting_for: Map<Name, u32>,
    waiting: Vec<Waiting>,
    /// Changes with the sheets.
    sheets_version: u32,
    /// Changes with what `Candidates` are made from.
    version: u32,
    layer_order: Vec<Vec<u8>>,
    pseudos: Set<Pseudo>,
    has_starting: bool,
    /// Whose sheet does not select by class.
    pub(crate) is_of_user_agent: bool,
    host: Vec<Entry>,
    slotted: Vec<Entry>,
    parts: Vec<Entry>,
}

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub(crate) enum Level {
    UserAgent,
    Hints,
    /// Of the shadow tree that the element hosts, which is 0, or of one that it is slotted in. The first slot has `u8::MAX`.
    Inner(u8),
    Own,
    /// `::part()`, and how many trees are in between.
    Outer(u8),
}

#[derive(Clone)]
pub(crate) struct Matched {
    pub(crate) block: Rc<Block>,
    pub(crate) level: Level,
    pub(crate) layer: u16,
}

/// For each `@scope` rule, the roots of the scopes that the element is in, with how far away they are.
pub(crate) type ScopeRoots =
    RefCell<SmallVec<[(*const ScopeRule, SmallVec<[(u16, NodeId); 1]>); 1]>>;

/// With the priority in the rule set.
pub(crate) type Found = SmallVec<[(u128, Matched); 24]>;

#[derive(Clone, Copy)]
pub(crate) struct Query<'a> {
    pub(crate) tree: &'a Tree,
    /// The element, or the one that the pseudo-element originates from.
    pub(crate) id: NodeId,
    pub(crate) pseudo: Pseudo,
    pub(crate) pseudo_state: State,
    pub(crate) with_starting: bool,
    pub(crate) bloom: Option<&'a Bloom>,
    pub(crate) has_results: &'a HasResults,
    pub(crate) roots: &'a ScopeRoots,
    pub(crate) container: &'a dyn Fn(&ContainerQuery) -> bool,
}

#[derive(Clone, Copy)]
pub(crate) enum Kind {
    Normal,
    Host,
    Slotted,
    Part,
}

impl RuleSet {
    pub(crate) fn sheets(&self) -> impl Iterator<Item = &Rc<Sheet>> {
        self.by_rank().map(|slot| &slot.sheet)
    }

    /// Returns the keys of the elements to match again, or `None` for all. The rules that wait are not counted.
    pub(crate) fn set_sheets(
        &mut self,
        sheets: &[Rc<Sheet>],
        media: &dyn Subject,
        dependencies: &mut Dependencies,
    ) -> Option<Set<Name>> {
        let position = |sheet: &Rc<Sheet>| sheets.iter().rposition(|it| Rc::ptr_eq(it, sheet));
        let mut subjects = Some(Set::default());
        let mut affects = |rule: &Rule| match (&mut subjects, rule.selector.compounds[0].keys()) {
            (Some(subjects), Some(keys)) => subjects.extend(keys),
            _ => subjects = None,
        };
        let is_in_order = self.sheets().filter_map(position).is_sorted();
        let mut has_removed = false;
        for slot in self
            .slots
            .iter_mut()
            .filter(|it| !it.is_removed && position(&it.sheet).is_none())
        {
            (slot.is_removed, has_removed) = (true, true);
            slot.sheet = Rc::default();
        }
        if has_removed {
            let slots = &self.slots;
            let mut keeps = |entry: &Entry| {
                let is_removed = slots[usize::from(entry.slot)].is_removed;
                is_removed.then(|| affects(&entry.rule)).is_none()
            };
            self.index.retain(&mut keeps);
            [&mut self.host, &mut self.slotted, &mut self.parts]
                .into_iter()
                .for_each(|it| it.retain(&mut keeps));
            self.compact();
        }
        for sheet in sheets {
            if !self.slots.iter().any(|it| Rc::ptr_eq(&it.sheet, sheet)) {
                sheet.rules.iter().for_each(|rule| affects(rule));
                self.add(sheet, dependencies);
            }
        }
        for slot in &mut self.slots {
            slot.rank = position(&slot.sheet).unwrap_or(0) as u16;
            slot.first_rank = sheets
                .iter()
                .position(|it| Rc::ptr_eq(it, &slot.sheet))
                .unwrap_or(0);
            if slot.active_media.is_empty() {
                slot.evaluate_media(media);
            }
        }
        let layers_are_in_order = self.rank_layers();
        (self.sheets_version, self.version) = (next_version(), next_version());
        subjects.filter(|_| is_in_order && layers_are_in_order)
    }

    /// Whether those that were there before are in the same order.
    fn rank_layers(&mut self) -> bool {
        let mut order: Vec<Vec<u8>> = Vec::new();
        let mut mentioned = Vec::new();
        for slot in self.slots.iter().filter(|it| !it.is_removed) {
            let names = slot
                .sheet
                .mentions
                .iter()
                .filter(|it| slot.active_media[usize::from(it.1)])
                .map(|it| &slot.sheet.layers[usize::from(it.0)]);
            mentioned.extend(names.map(|it| {
                (
                    if it.first() == Some(&0) {
                        slot.rank.into()
                    } else {
                        slot.first_rank
                    },
                    it,
                )
            }));
        }
        mentioned.sort_by_key(|it| it.0);
        for (_, name) in mentioned {
            let ends = (0..name.len())
                .filter(|end| name[*end] == b'.')
                .chain([name.len()]);
            for prefix in ends.map(|end| &name[..end]) {
                if !order.iter().any(|it| it == prefix) {
                    order.push(prefix.to_vec());
                }
            }
        }
        // A layer comes after the layers in it.
        let path = |name: &[u8]| -> Vec<usize> {
            let ends = (0..name.len())
                .filter(|end| name[*end] == b'.')
                .chain([name.len()]);
            (ends.filter_map(|end| order.iter().position(|it| *it == name[..end])))
                .chain([usize::MAX])
                .collect()
        };
        let mut sorted = order.clone();
        sorted.sort_by_cached_key(|name| path(name));
        for slot in &mut self.slots {
            let rank = |name: &Vec<u8>| sorted.iter().position(|it| it == name);
            slot.layer_ranks = (slot.sheet.layers.iter())
                .map(|name| rank(name).map_or(UNLAYERED, |rank| rank as u16))
                .collect();
        }
        let is_in_order = self
            .layer_order
            .iter()
            .filter_map(|name| sorted.iter().position(|it| it == name))
            .is_sorted();
        self.layer_order = sorted;
        is_in_order
    }

    /// Forgets what waits in the sheets that are gone, whose slots can then be used again.
    fn compact(&mut self) {
        let (old, slots) = (core::mem::take(&mut self.waiting), &self.slots);
        for first in self.waiting_for.values_mut().filter(|it| **it < END) {
            let mut at = core::mem::replace(first, END);
            while let Some(it) = old.get(at as usize) {
                if !slots[usize::from(it.slot)].is_removed {
                    self.waiting.push(Waiting {
                        next: *first,
                        ..*it
                    });
                    *first = self.waiting.len() as u32 - 1;
                }
                at = it.next;
            }
        }
    }

    fn add(&mut self, sheet: &Rc<Sheet>, dependencies: &mut Dependencies) {
        let (rank, first_rank, layer_ranks, active_media) = Default::default();
        let new = Slot {
            sheet: Rc::clone(sheet),
            rank,
            first_rank,
            layer_ranks,
            active_media,
            is_removed: false,
        };
        let slot = match self.slots.iter().position(|it| it.is_removed) {
            Some(free) => {
                self.slots[free] = new;
                free
            }
            None if self.slots.len() > usize::from(u16::MAX) => return,
            None => {
                self.slots.push(new);
                self.slots.len() - 1
            }
        } as u16;
        for rule in &sheet.rules {
            self.insert(Rc::clone(rule), slot, None, false, dependencies);
        }
        self.waiting.reserve(sheet.deferred.len());
        self.waiting_for.reserve(sheet.deferred.len() / 2);
        for (deferred, it) in (0..).zip(&sheet.deferred) {
            let keys = sheet.keys(it);
            for key in &keys[1..] {
                self.waiting_for.entry(*key).or_insert(END);
            }
            let first = self.waiting_for.entry(keys[0]).or_insert(END);
            let next = core::mem::replace(first, self.waiting.len() as u32).min(END);
            self.waiting.push(Waiting {
                deferred,
                next,
                slot,
            });
        }
    }

    fn insert(
        &mut self,
        rule: Rc<Rule>,
        slot: u16,
        key: Option<Name>,
        is_new_key: bool,
        dependencies: &mut Dependencies,
    ) {
        dependencies.add(&rule);
        let selector = &rule.selector;
        self.has_starting |= rule.context.is_starting;
        self.pseudos.insert(selector.pseudo);
        let is_host = |it: &Simple| matches!(it, Simple::Host(_) | Simple::HostContext(_));
        let (combinator, is_host) = (
            selector.compounds[0].combinator,
            selector.compounds[0].simples.iter().any(is_host),
        );
        let mut nearest = selector
            .compounds
            .iter()
            .take(if combinator == Combinator::Child {
                2
            } else {
                1
            });
        if !is_new_key
            && nearest.any(|it| {
                it.simples.iter().any(|it| {
                    matches!(
                        it,
                        Simple::Class(_)
                            | Simple::Is(_)
                            | Simple::Attribute(_)
                            | Simple::Exists(..)
                    )
                })
            })
        {
            self.version = next_version();
        }
        let entry = Entry {
            ancestors: selector.ancestor_hashes(),
            states: selector.states(),
            rule,
            slot,
            always_matches: false,
        };
        if !is_host
            && combinator == Combinator::None
            && entry.rule.selector.compounds[0]
                .simples
                .iter()
                .any(Simple::is_about_host)
        {
            self.host.push(Entry {
                rule: Rc::clone(&entry.rule),
                ..entry
            });
        }
        match combinator {
            Combinator::Slot => self.slotted.push(entry),
            Combinator::Part => self.parts.push(entry),
            _ if is_host => self.host.push(entry),
            _ => self.index.insert(entry, key),
        }
    }

    /// Whether any rule has been waiting for the key, and if so whether one applies to descendants.
    fn activate_key(&mut self, key: Name, dependencies: &mut Dependencies) -> Option<bool> {
        let (mut at, mut found) = (
            core::mem::replace(self.waiting_for.get_mut(&key)?, SEEN),
            None,
        );
        while let Some(&Waiting {
            deferred,
            next,
            slot,
        }) = self.waiting.get(at as usize)
        {
            let sheet = &self.slots[usize::from(slot)].sheet;
            let deferred = &sheet.deferred[deferred as usize];
            let keys = sheet.keys(deferred);
            let missing = keys
                .iter()
                .find(|it| self.waiting_for.get(*it).is_some_and(|it| *it != SEEN));
            if let Some(first) = missing.and_then(|it| self.waiting_for.get_mut(it)) {
                self.waiting[at as usize].next = core::mem::replace(first, at);
            } else if let Some(rule) = sheet.activate(deferred) {
                let own = deferred.has_own_key.then(|| keys[0]);
                found = Some(found == Some(true) || own != Some(key));
                self.insert(rule, slot, own, own == Some(key), dependencies);
            }
            at = next;
        }
        found
    }

    pub(crate) fn activate(
        &mut self,
        element: &Element,
        dependencies: &mut Dependencies,
        mut report: impl FnMut(Name, bool),
    ) {
        let mut visit = |key| {
            self.activate_key(key, dependencies)
                .into_iter()
                .for_each(|it| report(key, it))
        };
        key::besides_classes(element).for_each(&mut visit);
        element
            .classes()
            .iter()
            .for_each(|it| visit(key::class(*it)));
    }

    pub(crate) fn activate_for_matching(
        &mut self,
        element: &Element,
        dependencies: &mut Dependencies,
    ) {
        for key in key::besides_classes(element) {
            self.activate_key(key, dependencies);
        }
        if let Some(classes) = element.classes.as_ref().filter(|_| !self.is_of_user_agent)
            && classes.activated.replace(self.sheets_version) != self.sheets_version
        {
            for class in classes.iter() {
                self.activate_key(key::class(*class), dependencies);
            }
        }
    }

    fn candidates(&self, classes: &Classes) -> Rc<Candidates> {
        let mut known = classes.candidates.borrow_mut();
        if let Some((_, found)) = known.iter().find(|it| it.0 == self.version) {
            return Rc::clone(found);
        }
        let mut found = Candidates::default();
        for (map, into) in [
            (&self.index.by_key, &mut found.own),
            (&self.index.by_parent_key, &mut found.of_children),
        ] {
            for bucket in classes.iter().filter_map(|it| map.get(&key::class(*it))) {
                for (from, into) in bucket.iter().zip(into.iter_mut()) {
                    into.extend(from.iter().filter(|it| self.is_active(it)).cloned());
                }
            }
        }
        for (from, into) in self
            .index
            .by_key
            .get(&CLASS_ATTRIBUTE)
            .into_iter()
            .flatten()
            .zip(found.own.iter_mut())
        {
            let applies = |it: &&Entry| {
                self.is_active(it) && it.rule.selector.allows_class_attribute(&classes.source)
            };
            into.extend(from.iter().filter(applies).cloned());
        }
        let found = Rc::new(found);
        known.truncate(1);
        known.insert(0, (self.version, Rc::clone(&found)));
        found
    }

    fn visit_candidates(&self, query: &Query, part: usize, mut visit: impl FnMut(&Entry)) {
        let Some(element) = query.tree.element(query.id) else {
            return;
        };
        let (parent, state) = (
            query.tree.element(query.tree[query.id].parent),
            element.state,
        );
        let applies = |it: &&Entry| state.contains(it.states) && self.is_active(it);
        for (element, map, is_parent) in [
            (Some(element), &self.index.by_key, false),
            (parent, &self.index.by_parent_key, true),
        ] {
            let Some(element) = element.filter(|_| !map.is_empty()) else {
                continue;
            };
            if let Some(classes) = element.classes.as_ref().filter(|_| !self.is_of_user_agent) {
                let candidates = self.candidates(classes);
                let candidates = if is_parent {
                    &candidates.of_children
                } else {
                    &candidates.own
                };
                candidates[part]
                    .iter()
                    .filter(|it| state.contains(it.states))
                    .for_each(&mut visit);
            }
            let keys =
                key::besides_classes(element).filter(|it| is_parent || *it != CLASS_ATTRIBUTE);
            for bucket in keys.filter_map(|key| map.get(&key)) {
                bucket[part].iter().filter(applies).for_each(&mut visit);
            }
        }
        self.index.others[part]
            .iter()
            .filter(applies)
            .for_each(visit);
    }

    fn is_active(&self, entry: &Entry) -> bool {
        self.slots[usize::from(entry.slot)].active_media[usize::from(entry.rule.context.media)]
    }

    /// Adds what the queries that have changed their answer apply to.
    pub(crate) fn evaluate_media(&mut self, media: &dyn Subject, affected: &mut Subjects) {
        let before: Vec<_> = self
            .slots
            .iter()
            .map(|it| it.active_media.clone())
            .collect();
        if !self
            .slots
            .iter_mut()
            .fold(false, |changed, slot| slot.evaluate_media(media) | changed)
        {
            return;
        }
        self.version = next_version();
        if self
            .slots
            .iter()
            .any(|it| it.sheet.mentions.iter().any(|it| it.1 != 0))
        {
            affected.is_everything |= !self.rank_layers();
        }
        let flips = |slot: usize, media: u16| {
            before[slot].get(usize::from(media))
                != self.slots[slot].active_media.get(usize::from(media))
        };
        let has_flipped = |it: &&Entry| flips(usize::from(it.slot), it.rule.context.media);
        for (map, keys) in [
            (&self.index.by_key, &mut affected.keys),
            (&self.index.by_parent_key, &mut affected.parent_keys),
        ] {
            keys.extend(
                map.iter()
                    .filter(|it| it.1.iter().flatten().any(|it| has_flipped(&it)))
                    .map(|it| *it.0),
            );
        }
        affected.others.extend(
            self.index
                .others
                .iter()
                .flatten()
                .filter(has_flipped)
                .map(|it| Rc::clone(&it.rule)),
        );
        affected.is_everything |= [&self.host, &self.slotted, &self.parts]
            .into_iter()
            .flatten()
            .any(|it| has_flipped(&it))
            || self
                .slots
                .iter()
                .enumerate()
                .any(|(slot, it)| it.sheet.at_rules.iter().any(|it| flips(slot, it.media)));
    }

    fn by_rank(&self) -> impl DoubleEndedIterator<Item = &Slot> {
        let mut slots: Vec<_> = self.slots.iter().filter(|it| !it.is_removed).collect();
        slots.sort_by_key(|slot| slot.rank);
        slots.into_iter()
    }

    /// The valid ones that apply, in ascending priority.
    pub(crate) fn defined(&self, kind: AtKind, name: Option<&str>) -> Vec<(Str, Defined)> {
        let mut all = Vec::new();
        for slot in self.by_rank() {
            let applies = |it: &&AtRule| {
                it.kind == kind
                    && name.is_none_or(|name| *name == *it.name)
                    && slot.active_media[usize::from(it.media)]
            };
            let found = slot.sheet.at_rules.iter().filter(applies);
            all.extend(found.map(|it| {
                (
                    slot.layer_ranks[usize::from(it.layer)],
                    Rc::clone(&it.name),
                    slot.sheet.defined(it),
                )
            }));
        }
        all.retain(|it| !matches!(it.2, Defined::Invalid));
        all.sort_by_key(|it| it.0);
        all.into_iter().map(|it| (it.1, it.2)).collect()
    }

    pub(crate) fn font_faces(&self) -> Vec<Rc<FontFace>> {
        let faces = self.defined(AtKind::FontFace, None).into_iter();
        faces
            .filter_map(|it| {
                if let Defined::FontFace(face) = it.1 {
                    Some(face)
                } else {
                    None
                }
            })
            .collect()
    }

    pub(crate) fn has_starting_styles(&self) -> bool {
        self.has_starting
    }

    pub(crate) fn has_rules_for(&self, pseudo: Pseudo) -> bool {
        self.pseudos.contains(&pseudo)
    }

    pub(crate) fn count_pseudos(&self) -> usize {
        self.pseudos.len()
    }

    /// The proximity of the scope, if it matches.
    fn matches(&self, entry: &Entry, query: &Query, host: NodeId) -> Option<u16> {
        if query
            .bloom
            .is_some_and(|bloom| !bloom.may_have(&entry.ancestors))
        {
            return None;
        }
        let rule = &entry.rule;
        if !rule.selector.pseudo.selects(query.pseudo)
            || !query.pseudo_state.contains(rule.selector.pseudo_state)
        {
            return None;
        }
        if entry.always_matches {
            return Some(u16::MAX);
        }
        let matcher = |scope| {
            let mut matcher = Matcher::new(query.tree, host, scope, Some(query.has_results));
            matcher.bloom = query.bloom;
            matcher
        };
        let proximity = match &rule.context.scope {
            None => matcher(if host == 0 { 0 } else { NodeId::MAX })
                .matches(&rule.selector, query.id)
                .then_some(u16::MAX)?,
            Some(scope) => {
                scope_roots(scope, query, host)
                    .iter()
                    .find(|it| matcher(it.1).matches(&rule.selector, query.id))?
                    .0
            }
        };
        rule.context
            .container
            .as_deref()
            .is_none_or(query.container)
            .then_some(proximity)
    }

    /// Adds `BEFORE`, `AFTER` and `MARKER`, as bits, if a rule gives them content.
    pub(crate) fn generated(&self, query: &Query, kind: Kind, host: NodeId, found: &mut u8) {
        let visit = |entry: &Entry| {
            let pseudo = entry.rule.selector.pseudo;
            let bit = match pseudo {
                Pseudo::Before => 1 << BEFORE,
                Pseudo::After => 1 << AFTER,
                Pseudo::Marker => 1 << MARKER,
                Pseudo::Scroll(ScrollPart::Marker) => MARKER_RULES,
                Pseudo::Scroll(ScrollPart::Button(..)) => BUTTON_RULES,
                Pseudo::Scroll(ScrollPart::Column) => COLUMN_RULES,
                Pseudo::Scroll(ScrollPart::ColumnMarker) => COLUMN_MARKER_RULES,
                _ => return,
            };
            if *found & bit == 0
                && (entry.rule.block.declarations().sets_content || bit == COLUMN_RULES)
                && self
                    .matches(
                        entry,
                        &Query {
                            pseudo,
                            pseudo_state: if bit >= MARKER_RULES {
                                State::all()
                            } else {
                                query.pseudo_state
                            },
                            ..*query
                        },
                        host,
                    )
                    .is_some()
            {
                *found |= bit;
            }
        };
        let list = match kind {
            Kind::Normal => return self.visit_candidates(query, PSEUDOS, visit),
            Kind::Host => &self.host,
            Kind::Slotted => &self.slotted,
            Kind::Part => &self.parts,
        };
        list.iter().filter(|it| self.is_active(it)).for_each(visit);
    }

    /// Appends in ascending priority.
    pub(crate) fn collect(
        &self,
        query: &Query,
        kind: Kind,
        host: NodeId,
        level: Level,
        out: &mut Found,
    ) {
        let start = out.len();
        let mut visit = |entry: &Entry| {
            if let Some(proximity) = self.matches(entry, query, host) {
                let (slot, rule) = (&self.slots[usize::from(entry.slot)], &entry.rule);
                let layer = slot.layer_ranks[usize::from(rule.context.layer)];
                let priority = u128::from(layer) << 96
                    | u128::from(rule.selector.specificity) << 64
                    | u128::from(!proximity) << 48
                    | u128::from(slot.rank) << 32
                    | u128::from(rule.order);
                out.push((
                    priority,
                    Matched {
                        block: Rc::clone(&rule.block),
                        level,
                        layer,
                    },
                ));
            }
        };
        let applies = |it: &&Entry| {
            self.is_active(it) && (query.with_starting || !it.rule.context.is_starting)
        };
        match kind {
            Kind::Host => self.host.iter().filter(applies).for_each(visit),
            Kind::Slotted => self.slotted.iter().filter(applies).for_each(visit),
            Kind::Part => self.parts.iter().filter(applies).for_each(visit),
            Kind::Normal => {
                self.visit_candidates(
                    query,
                    if query.pseudo == Pseudo::None {
                        ELEMENTS
                    } else {
                        PSEUDOS
                    },
                    &mut visit,
                );
                if query.with_starting {
                    self.visit_candidates(query, STARTING, &mut visit);
                }
                if host != 0 {
                    self.parts.iter().filter(applies).for_each(visit);
                }
            }
        }
        out[start..].sort_unstable_by_key(|it| it.0);
    }
}

/// Of the scopes that the element is in, from the nearest, with how far away they are.
fn scope_roots(scope: &Rc<ScopeRule>, query: &Query, host: NodeId) -> SmallVec<[(u16, NodeId); 1]> {
    if let Some(known) = query
        .roots
        .borrow()
        .iter()
        .find(|it| it.0 == Rc::as_ptr(scope))
    {
        return known.1.clone();
    }
    let outer = scope.outer.as_ref().map(|it| scope_roots(it, query, host));
    let matcher = |root| Matcher::new(query.tree, host, root, Some(query.has_results));
    let is_near =
        |(start, bloom): (&List, &Bloom)| bloom.may_have_match(start, &query.tree[query.id]);
    let mut roots = SmallVec::new();
    if scope.start.as_ref().zip(query.bloom).is_none_or(is_near) {
        let up = |id: &NodeId| {
            Some(if *id == host {
                0
            } else {
                query.tree.parent_or_host(*id)
            })
            .filter(|it| query.tree.element(*it).is_some())
        };
        let path = || core::iter::successors(Some(query.id), up);
        roots.extend((0..u16::MAX).zip(path()).filter(|(distance, root)| {
            let is_limit = |id| {
                scope
                    .end
                    .as_ref()
                    .is_some_and(|end| matcher(*root).any(end, id))
            };
            let starts = |around| match &scope.start {
                Some(start) => matcher(around).any(start, *root),
                None if scope.owner == 0 => *root == host || query.tree.is_root(*root),
                None => *root == scope.owner,
            };
            outer.as_ref().map_or_else(
                || starts(host),
                |it| it.iter().any(|it| it.0 >= *distance && starts(it.1)),
            ) && !path().take(usize::from(*distance) + 1).any(is_limit)
        }));
    }
    query
        .roots
        .borrow_mut()
        .push((Rc::as_ptr(scope), roots.clone()));
    roots
}

// ───────────────────────────── invalidation ─────────────────────────────

struct Affected {
    relation: Relation,
    /// `None` is any element.
    subjects: Option<Set<Name>>,
    filter: u64,
}

#[derive(Default)]
pub(crate) struct Dependencies {
    /// Whether it matters for every element.
    of_subject: Map<Name, bool>,
    of_subject_with: Set<(Name, Name)>,
    of_pseudo_elements: Set<Name>,
    of_others: Set<Name>,
    in_has: Set<Name>,
    outside_has: Set<Name>,
    has_looks_at_siblings: bool,
    by_pair: Map<(Name, Name), u32>,
    affected: Vec<Affected>,

    pending: Set<(NodeId, u32)>,
    changed_in_has: Set<Name>,
    has_origins: Vec<NodeId>,
}

impl Dependencies {
    fn add(&mut self, rule: &Rule) {
        {
            let (subjects, base) = (rule.selector.compounds[0].keys(), Relation::empty());
            let mut report = |key, relation: Relation, required| {
                if relation.is_empty() {
                    let always = self.of_subject.entry(key).or_default();
                    match &subjects {
                        _ if required != Name::NONE => {
                            _ = self.of_subject_with.insert((key, required))
                        }
                        Some(keys) if !keys.contains(&key) => self
                            .of_subject_with
                            .extend(keys.iter().map(|it| (key, *it))),
                        _ => *always = true,
                    }
                    return;
                }
                self.of_others.insert(key);
                let next = self.affected.len() as u32;
                let index = *self.by_pair.entry((key, required)).or_insert(next);
                if index == next {
                    let subjects = Some(Set::default());
                    self.affected.push(Affected {
                        relation,
                        subjects,
                        filter: 0,
                    });
                }
                let affected = &mut self.affected[index as usize];
                affected.relation |= relation;
                match (&mut affected.subjects, &subjects) {
                    (Some(all), Some(keys)) => {
                        all.extend(keys.iter().copied());
                        affected.filter |= crate::selector::filter(keys.iter().copied());
                    }
                    (all, _) => *all = None,
                }
            };
            rule.selector.features(base, &mut report, false);
            let scopes =
                core::iter::successors(rule.context.scope.as_ref(), |it| it.outer.as_ref());
            let limits = scopes
                .flat_map(|it| it.start.iter().chain(&it.end))
                .flat_map(|list| list.iter());
            for limit in limits.clone() {
                limit.features(base, &mut report, false);
                limit.features(Relation::DESCENDANT, &mut report, false);
            }
            (rule.selector.pseudo_state.iter())
                .for_each(|bit| _ = self.of_pseudo_elements.insert(key::state(bit)));
            for selector in limits.chain([&rule.selector]) {
                selector.visit_has(&mut |has| {
                    self.in_has.extend(has.keys.iter().copied());
                    self.outside_has.extend(has.outer_keys.iter().copied());
                    self.has_looks_at_siblings |= has.looks_at_siblings;
                });
            }
        }
    }

    pub(crate) fn feature_changed(&mut self, tree: &Tree, id: NodeId, feature: Name) {
        self.feature_changed_along_with(tree, id, feature, &[]);
    }

    /// A rule is indexed by a pair of names, so the classes that were removed at the same time count.
    pub(crate) fn feature_changed_along_with(
        &mut self,
        tree: &Tree,
        id: NodeId,
        feature: Name,
        removed: &[Name],
    ) {
        let Some(element) = tree.element(id) else {
            return;
        };
        let required = || key::of_element(element).chain(removed.iter().map(|it| key::class(*it)));
        if !tree[id].has(Flags::REMATCH)
            && (self.of_subject.get(&feature).is_some_and(|always| {
                *always || required().any(|it| self.of_subject_with.contains(&(feature, it)))
            }) || element.pseudo != Pseudo::None && self.of_pseudo_elements.contains(&feature))
        {
            tree.mark_style(id, Flags::REMATCH);
        }
        if self.of_others.contains(&feature) {
            for required in required().chain([Name::NONE]) {
                if let Some(index) = self.by_pair.get(&(feature, required)) {
                    self.pending.insert((id, *index));
                }
            }
        }
        if self.in_has.contains(&feature) {
            self.changed_in_has.insert(feature);
            self.has_origins.push(id);
        }
    }

    /// While `child` is linked: after it was inserted, or before it is removed.
    pub(crate) fn children_changed(&mut self, tree: &Tree, child: NodeId) {
        let parent = tree[child].parent;
        let flags = tree[parent].flags.get();
        if flags.contains(Flags::EMPTINESS) {
            self.feature_changed(tree, parent, key::STRUCTURE);
        }
        if tree[child].element().is_none() {
            return;
        }
        let (previous, next) = (
            tree.previous_elements(child).next(),
            tree.next_elements(child).next(),
        );
        let mut changed = |id| self.feature_changed(tree, id, key::STRUCTURE);
        if flags.contains(Flags::CHILD_INDEX) {
            tree.element_children(parent).for_each(changed);
        } else {
            if flags.contains(Flags::LATER_SIBLINGS) {
                tree.next_elements(child).for_each(&mut changed);
            } else if flags.contains(Flags::NEXT_SIBLING) {
                tree.next_elements(child).take(2).for_each(&mut changed);
            }
            if flags.contains(Flags::EDGE_CHILDREN) {
                previous
                    .filter(|_| next.is_none())
                    .into_iter()
                    .for_each(&mut changed);
                next.filter(|_| previous.is_none())
                    .into_iter()
                    .for_each(&mut changed);
            }
        }
        if !self.in_has.is_empty() {
            self.changed_in_has.insert(key::STRUCTURE);
            for id in core::iter::once(child).chain(tree.descendants(child)) {
                let Some(element) = tree.element(id) else {
                    continue;
                };
                let states = element.state.iter().map(key::state);
                let keys = key::of_element(element).chain(states);
                self.changed_in_has
                    .extend(keys.filter(|key| self.in_has.contains(key)));
            }
            self.has_origins.push(parent);
            self.has_origins.extend(previous);
        }
    }

    pub(crate) fn has_pending(&self) -> bool {
        !self.pending.is_empty() || !self.has_origins.is_empty()
    }

    /// Marks the elements that the changes so far can affect.
    pub(crate) fn flush(&mut self, tree: &Tree, has_results: &HasResults) {
        self.flush_has(tree, has_results);
        for (id, index) in self.pending.drain() {
            if !tree.contains(id) {
                continue;
            }
            let (affected, mut known) = (&self.affected[index as usize], Map::default());
            let mut visit = |id| {
                if tree[id].keys & affected.filter != 0
                    && let (Some(element), Some(subjects)) = (tree.element(id), &affected.subjects)
                    && element.rules.is_some()
                    && (element.classes.as_ref().is_some_and(|it| {
                        *known.entry(Rc::as_ptr(it)).or_insert_with(|| {
                            it.names
                                .iter()
                                .any(|it| subjects.contains(&key::class(*it)))
                        })
                    }) || key::besides_classes(element).any(|key| subjects.contains(&key)))
                {
                    tree.mark_style(id, Flags::REMATCH);
                }
            };
            let mut subtree = |root| match affected.subjects {
                Some(_) => tree.visit_subtree(root, &mut visit),
                None => tree.mark_style(root, Flags::REMATCH_SUBTREE),
            };
            if affected.relation.contains(Relation::DESCENDANT) {
                subtree(id);
            }
            if affected.relation.contains(Relation::SIBLING) {
                tree.next_elements(id).for_each(&mut subtree);
            }
            if affected.relation.contains(Relation::EARLIER_SIBLING) {
                tree.previous_elements(id).for_each(subtree);
            }
        }
    }

    fn flush_has(&mut self, tree: &Tree, has_results: &HasResults) {
        let mut visited = Vec::new();
        for origin in core::mem::take(&mut self.has_origins) {
            let mut at = if tree.contains(origin) { origin } else { 0 };
            while at != 0 && !tree[at].has(Flags::VISITED) {
                tree[at].set(Flags::VISITED);
                visited.push(at);
                at = tree.parent_or_host(at);
            }
        }
        let changed = core::mem::take(&mut self.changed_in_has);
        let mut flipped = Vec::new();
        let mut check = |id: NodeId, only_siblings: bool| {
            if !tree[id].has(Flags::HAS_ANCHOR) {
                return;
            }
            for result in has_results.borrow_mut().get_mut(&id).into_iter().flatten() {
                let mut matcher = Matcher::new(tree, result.host, 0, None);
                matcher.notes = true;
                if (!only_siblings || result.has.looks_at_siblings)
                    && result.has.keys.iter().any(|key| changed.contains(key))
                    && matcher.has(&result.has, id) != result.matched
                {
                    result.matched = !result.matched;
                    flipped.push((id, key::has(result.has.id)));
                }
            }
        };
        for id in visited {
            tree[id].unset(Flags::VISITED);
            check(id, false);
            if self.has_looks_at_siblings {
                tree.previous_elements(id)
                    .for_each(|sibling| check(sibling, true));
            }
        }
        if changed.iter().any(|key| self.outside_has.contains(key)) {
            let looks_out =
                |it: &HasResult| it.has.outer_keys.iter().any(|key| changed.contains(key));
            let anchors: Vec<_> = has_results
                .borrow()
                .iter()
                .filter(|it| tree.contains(*it.0) && it.1.iter().any(looks_out))
                .map(|it| *it.0)
                .collect();
            anchors.into_iter().for_each(|id| check(id, false));
        }
        for (id, feature) in flipped {
            self.feature_changed(tree, id, feature);
        }
    }
}
