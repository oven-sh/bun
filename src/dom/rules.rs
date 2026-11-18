//! Which rules apply to an element, and which elements a change can affect.

use core::cell::{Cell, RefCell};
use std::rc::{Rc, Weak};

use crate::api::core::StoredText;

use bun_core::strings;
use smallvec::SmallVec;

use crate::carousel::{BUTTON_RULES, COLUMN_MARKER_RULES, COLUMN_RULES, MARKER_RULES};
use crate::cascade::RuleList;
use crate::condition::Subject;
use crate::font_face::FontFace;
use crate::name::{Map, Name, Set, keyed_hash, keyed_hash_of_words, name};
use crate::order::Order as _;
use crate::properties::Only;
use crate::selector::{
    Bloom, Combinator, HasResult, HasResults, List, Matcher, Pseudo, Relation, ScrollPart, Simple,
    key,
};
use crate::sheet::{AtKind, AtRule, Block, ContainerQuery, Defined, Rule, ScopeRule, Sheet};
use crate::tree::{AFTER, BEFORE, Element, Flags, MARKER, NodeId, State, Tree};
use crate::values::Str;

#[derive(Clone)]
struct Entry {
    rule: Rc<Rule>,
    ancestors: [u32; 3],
    states: State,
    slot: u16,
    /// `tag_of_part`, by which those for pseudo-elements are ordered.
    part: u16,
    /// For an element that has the key.
    always_matches: bool,
    follows_from_signature: bool,
    /// The roots of its `@scope` do.
    has_known_roots: bool,
}

/// What a rule set has for the elements with the same signature.
#[derive(Default)]
#[repr(C)]
pub(crate) struct Memo {
    /// What sheets have given an element, by the version of the memos of the user agent and by what `decide` has returned for both.
    lists: RefCell<SmallVec<[((u32, u32, u32), Weak<RuleList>); 1]>>,
    /// The version of the memos of the user agent, if the one for the same signature has no undecided rules.
    pub(crate) is_alone_in_deciding: Cell<Option<u32>>,
    /// What `generated` finds, in both, as of that version, if it follows from the signature.
    pub(crate) always_generates: Cell<Option<(u32, u8)>>,
    undecided: Vec<Entry>,
    /// How far away they are.
    roots: Vec<(*const ScopeRule, SmallVec<[u16; 2]>)>,
    matched: Vec<(u128, Matched)>,
    /// `RuleSet::generated`
    generated: u8,
}

impl Entry {
    fn is_decided(&self) -> bool {
        self.follows_from_signature && self.rule.context.container.is_none()
    }
}

impl Memo {
    pub(crate) fn is_decided(&self) -> bool {
        self.undecided.is_empty()
    }

    pub(crate) fn keep(&self, key: (u32, u32, u32), list: &Rc<RuleList>) {
        let mut lists = self.lists.borrow_mut();
        lists.retain(|it| it.0 != key);
        lists.truncate(3);
        lists.insert(0, (key, Rc::downgrade(list)));
    }

    pub(crate) fn list(&self, key: (u32, u32, u32)) -> Option<Rc<RuleList>> {
        self.lists
            .borrow()
            .iter()
            .find(|it| it.0 == key)?
            .1
            .upgrade()
    }
}

/// By `Kind`: for elements, for pseudo-elements, and for `@starting-style`.
type Bucket = [Vec<Entry>; 3];

const ELEMENTS: usize = 0;
const PSEUDOS: usize = 1;
const STARTING: usize = 2;

#[derive(Clone, Default)]
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
        let add = |bucket: &mut Bucket| {
            let all = &mut bucket[part];
            all.insert(
                if part == PSEUDOS {
                    all.partition_point(|it| it.part <= entry.part)
                } else {
                    all.len()
                },
                entry.clone(),
            );
        };
        if let Some(keys) = key
            .map(|it| smallvec::smallvec![it])
            .or_else(|| compounds[0].keys())
        {
            keys.iter()
                .for_each(|key| add(self.by_key.entry(*key).or_default()));
        } else if compounds[0].combinator == Combinator::Child
            && let Some(keys) = compounds[1].keys()
        {
            keys.iter()
                .for_each(|key| add(self.by_parent_key.entry(*key).or_default()));
        } else {
            add(&mut self.others);
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
#[repr(C)]
pub(crate) struct Classes {
    pub(crate) filter: u64,
    pub(crate) second_filter: u64,
    hash: u64,
    names: Box<[Name]>,
    /// The hash of those that are in `Dependencies::of_others`, as of its version.
    seen_by_others: Cell<(u32, u64)>,
    /// The version of the rule set that has last seen them.
    activated: Cell<u32>,
    pub(crate) source: StoredText,
    /// Whether that has no name twice, and a space between two.
    is_tidy: Cell<Option<bool>>,
    /// The newest first.
    pub(crate) decided: RefCell<[Decided; 2]>,
    candidates: RefCell<SmallVec<[(u32, Rc<Candidates>); 1]>>,
    /// Of the elements that have been given no other.
    pub(crate) attributes: core::cell::OnceCell<Rc<[crate::tree::Attribute]>>,
}

/// What memos that have no undecided rules have given an element.
#[derive(Default)]
pub(crate) struct Decided {
    pub(crate) signature: Name,
    /// Of the memos of the user agent and of the scope.
    pub(crate) versions: [u32; 2],
    pub(crate) list: Weak<RuleList>,
    pub(crate) generates: u8,
}

impl Classes {
    pub(crate) fn new(source: &StoredText, ignores_case: bool) -> Classes {
        let name = if ignores_case {
            Name::lowercase
        } else {
            Name::new
        };
        let names: Box<[_]> = source
            .split_ascii_whitespace()
            .map(|it| name(it.as_bytes()))
            .collect();
        let keys = || names.iter().map(|it| key::class(*it));
        let (filter, second_filter) = (
            crate::selector::filter(keys()),
            crate::selector::second_filter(keys()),
        );
        Classes {
            source: source.clone(),
            hash: keyed_hash(&**source),
            names,
            filter,
            second_filter,
            ..Classes::default()
        }
    }
}

impl Classes {
    pub(crate) fn is_tidy(&self) -> bool {
        let is_tidy = self.is_tidy.get().unwrap_or_else(|| {
            let mut seen = Set::default();
            bun_core::strings::split(self.source.as_bytes(), b" ")
                .all(|it| !it.is_empty() && !it.iter().any(u8::is_ascii_whitespace))
                && self.names.iter().all(|it| seen.insert(*it))
        });
        self.is_tidy.set(Some(is_tidy));
        is_tidy
    }

    pub(crate) fn note_tidiness(&self) {
        self.is_tidy.set(Some(true));
    }
}

impl Classes {
    pub(crate) fn prefetch(&self) {
        crate::forecast::prefetch(&*self.names);
        if let StoredText::Ascii(it) = &self.source {
            crate::forecast::prefetch(it.as_impl());
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

/// Of the signature that memos are kept by.
fn salt_of(pseudo: Pseudo) -> Option<u64> {
    [Pseudo::None, Pseudo::Before, Pseudo::After, Pseudo::Marker]
        .iter()
        .position(|it| *it == pseudo)
        .map(|it| it as u64)
}

/// The same for what `Pseudo::selects`.
fn tag_of_part(pseudo: Pseudo) -> u16 {
    match pseudo {
        Pseudo::Part(part) if part == name!("-internal-cue-node") => {
            tag_of_part(Pseudo::Part(name!("cue")))
        }
        Pseudo::Part(part) => (part.bits() >> 8) as u16 | 1,
        _ => 0,
    }
}

/// Changes with the rules that apply.
pub(crate) fn last_version() -> u32 {
    LAST_VERSION.get()
}

fn next_version() -> u32 {
    LAST_VERSION.set(LAST_VERSION.get() + 1);
    LAST_VERSION.get()
}

#[derive(Clone)]
struct Waiting {
    deferred: u32,
    next: u32,
    slot: u16,
}

const CLASS_ATTRIBUTE: Name = key::attribute(name!("class"));
const END: u32 = u32::MAX - 1;
/// An element has had the key.
const SEEN: u32 = u32::MAX;

#[derive(Clone)]
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
    pub(crate) definitions: Vec<AtKind>,
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
#[derive(Clone, Default)]
pub(crate) struct RuleSet {
    /// By the last `set_sheets`.
    pub(crate) was_reordered: bool,
    slots: Vec<Slot>,
    index: Index,
    /// The first of the rules that wait for an element to have the key.
    waiting_for: Map<Name, u32>,
    waiting: Vec<Waiting>,
    /// Some keys that nothing waits for, by their lowest bits.
    settled_keys: [Name; 32],
    /// Changes with the sheets.
    sheets_version: u32,
    /// Changes with what `Candidates` are made from.
    version: u32,
    layer_order: Vec<u64>,
    pseudos: Set<Pseudo>,
    has_starting: bool,
    /// Whose sheet does not select by class.
    pub(crate) is_of_user_agent: bool,
    /// The rank of the first sheet that has the origin of the user.
    pub(crate) first_of_user: Option<u16>,
    host: Vec<Entry>,
    slotted: Vec<Entry>,
    parts: Vec<Entry>,
    memos: RefCell<Map<Name, Rc<Memo>>>,
    pub(crate) version_of_memos: Cell<u32>,
}

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub(crate) enum Level {
    UserAgent,
    User,
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
    pub(crate) only: Only,
}

impl Matched {
    pub(crate) fn is_inline(&self) -> bool {
        (self.level, self.layer) == (Level::Own, INLINE)
    }
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
    /// `Dependencies::signature`, or `Name::NONE`.
    pub(crate) signature: Name,
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

    /// Before `set_sheets`.
    pub(crate) fn of_user_agent(sheet: &Rc<Sheet>) -> (RuleSet, Dependencies) {
        let (mut rules, mut dependencies) = (
            RuleSet {
                is_of_user_agent: true,
                ..Default::default()
            },
            Dependencies::default(),
        );
        rules.add(sheet, None, &mut dependencies);
        (rules, dependencies)
    }

    /// Returns the keys of the elements to match again, or `None` for all. The rules that wait are not counted.
    pub(crate) fn set_sheets(
        &mut self,
        sheets: &[Rc<Sheet>],
        media: &dyn Subject,
        dependencies: &mut Dependencies,
    ) -> Option<Set<Name>> {
        let mut places = Map::<_, [usize; 2]>::default();
        for (index, sheet) in sheets.iter().enumerate() {
            places.entry(Rc::as_ptr(sheet)).or_insert([index; 2])[1] = index;
        }
        let position = |sheet: &Rc<Sheet>| places.get(&Rc::as_ptr(sheet)).map(|it| it[1]);
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
        let mut free: Vec<_> = (0..self.slots.len())
            .rev()
            .filter(|it| self.slots[*it].is_removed)
            .collect();
        let mut known: Set<_> = self.slots.iter().map(|it| Rc::as_ptr(&it.sheet)).collect();
        for sheet in sheets {
            if known.insert(Rc::as_ptr(sheet)) {
                sheet.rules.iter().for_each(|rule| affects(rule));
                self.add(sheet, free.pop(), dependencies);
            }
        }
        for slot in &mut self.slots {
            slot.rank = position(&slot.sheet).unwrap_or(0) as u16;
            slot.first_rank = places.get(&Rc::as_ptr(&slot.sheet)).map_or(0, |it| it[0]);
            if slot.active_media.is_empty() {
                slot.evaluate_media(media);
            }
        }
        let layers_are_in_order = self.rank_layers();
        (self.sheets_version, self.version) = (next_version(), next_version());
        self.forget_memos();
        self.was_reordered = !(is_in_order && layers_are_in_order);
        subjects.filter(|_| !self.was_reordered)
    }

    /// Whether those that were there before are in the same order.
    fn rank_layers(&mut self) -> bool {
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
        mentioned.order_by_key(|it| it.0);
        let inner = |outer: u64, name: &[u8]| keyed_hash((outer, name));
        let mut layers_in: Map<u64, Vec<u64>> = Map::default();
        for (_, name) in mentioned {
            strings::split(name, b".").fold(0, |outer, name| {
                let layer = inner(outer, name);
                if !layers_in.contains_key(&layer) {
                    layers_in.insert(layer, Vec::new());
                    layers_in.entry(outer).or_default().push(layer);
                }
                layer
            });
        }
        // A layer comes after the layers in it.
        let (mut sorted, mut pending) = (Vec::new(), layers_in.remove(&0).unwrap_or_default());
        while let Some(layer) = pending.pop() {
            sorted.push(layer);
            pending.extend(layers_in.remove(&layer).unwrap_or_default());
        }
        sorted.reverse();
        let ranks: Map<u64, usize> = sorted.iter().copied().zip(0..).collect();
        for slot in &mut self.slots {
            let rank = |name: &Vec<u8>| ranks.get(&strings::split(name, b".").fold(0, inner));
            slot.layer_ranks = slot
                .sheet
                .layers
                .iter()
                .map(|name| {
                    rank(name).map_or(UNLAYERED, |it| (*it).min(usize::from(UNLAYERED) - 1) as u16)
                })
                .collect();
        }
        let is_in_order = self
            .layer_order
            .iter()
            .filter_map(|it| ranks.get(it))
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

    fn add(&mut self, sheet: &Rc<Sheet>, free: Option<usize>, dependencies: &mut Dependencies) {
        let (rank, first_rank, layer_ranks, active_media) = Default::default();
        let new = Slot {
            sheet: Rc::clone(sheet),
            rank,
            first_rank,
            layer_ranks,
            active_media,
            is_removed: false,
        };
        let slot = match free {
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
        self.settled_keys = Default::default();
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
        let mut scopes =
            core::iter::successors(rule.context.scope.as_ref(), |it| it.outer.as_ref());
        let has_known_roots = scopes.all(|it| {
            it.start.is_some()
                && it
                    .start
                    .iter()
                    .chain(&it.end)
                    .all(|it| it.iter().all(|it| it.follows_from_signature()))
        });
        let follows_from_signature = has_known_roots && selector.follows_from_signature();
        let entry = Entry {
            ancestors: selector.ancestor_hashes(),
            states: selector.states(),
            part: tag_of_part(selector.pseudo),
            rule,
            slot,
            always_matches: false,
            follows_from_signature,
            has_known_roots,
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
    pub(crate) fn activate_key(
        &mut self,
        key: Name,
        dependencies: &mut Dependencies,
    ) -> Option<bool> {
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
        let mut settle = |key: Name| {
            if core::mem::replace(&mut self.settled_keys[(key.bits() >> 8) as usize % 32], key)
                != key
            {
                self.activate_key(key, dependencies);
            }
        };
        settle(key::tag(element.tag));
        match element.has_only_classes() {
            true => element.classes.iter().for_each(|_| settle(CLASS_ATTRIBUTE)),
            false => {
                (element.id != Name::NONE).then(|| settle(key::id(element.id)));
                for it in &element.attributes {
                    settle(key::attribute(it.name));
                    (it.key != Name::NONE).then(|| settle(it.key));
                }
            }
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

    fn visit_candidates<'a>(&'a self, query: &Query, part: usize, mut visit: impl FnMut(&Entry)) {
        let Some(element) = query.tree.element(query.id) else {
            return;
        };
        query
            .bloom
            .filter(|_| part != STARTING)
            .into_iter()
            .for_each(|it| it.count(query.tree));
        let (parent, state) = (
            query.tree.element(query.tree[query.id].parent),
            element.state,
        );
        let applies = |it: &&Entry| state.contains(it.states) && self.is_active(it);
        let tag = tag_of_part(query.pseudo);
        let of_part = |bucket: &'a Bucket| {
            let all = &*bucket[part];
            if part == PSEUDOS {
                &all[all.partition_point(|it| it.part < tag)
                    ..all.partition_point(|it| it.part <= tag)]
            } else {
                all
            }
            .iter()
        };
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
                of_part(bucket).filter(applies).for_each(&mut visit);
            }
        }
        of_part(&self.index.others).filter(applies).for_each(visit);
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
        self.forget_memos();
        self.version = next_version();
        let is_reordered = self
            .slots
            .iter()
            .any(|it| it.sheet.mentions.iter().any(|it| it.1 != 0))
            && !self.rank_layers();
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
        affected.is_everything |= is_reordered
            || [&self.host, &self.slotted, &self.parts]
                .into_iter()
                .flatten()
                .any(|it| has_flipped(&it));
        for (slot, it) in self.slots.iter().enumerate() {
            affected.definitions.extend(
                it.sheet
                    .at_rules
                    .iter()
                    .filter(|it| is_reordered || flips(slot, it.media))
                    .map(|it| it.kind),
            );
        }
    }

    fn by_rank(&self) -> impl DoubleEndedIterator<Item = &Slot> {
        let mut slots: Vec<_> = self.slots.iter().filter(|it| !it.is_removed).collect();
        slots.order_by_key(|slot| slot.rank);
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
        all.order_by_key(|it| it.0);
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

    pub(crate) fn has_starting_style(&self, query: &Query, host: NodeId) -> bool {
        let mut found = false;
        if self.has_starting {
            self.visit_candidates(query, STARTING, |it| {
                found = found || self.matches(it, query, host).is_some()
            });
        }
        found
    }

    pub(crate) fn has_rules_for(&self, pseudo: Pseudo) -> bool {
        self.pseudos.contains(&pseudo)
    }

    pub(crate) fn count_pseudos(&self) -> usize {
        self.pseudos.len()
    }

    pub(crate) fn forget_memos(&mut self) {
        self.memos.get_mut().clear();
        self.version_of_memos.set(next_version());
    }

    fn known_memo(&self, key: Name, query: &Query) -> Option<Rc<Memo>> {
        let known = Rc::clone(self.memos.borrow().get(&key)?);
        if !known.roots.is_empty() {
            let up =
                |distance: u16| (0..distance).fold(query.id, |id, _| query.tree.parent_or_host(id));
            query.roots.borrow_mut().extend(
                known
                    .roots
                    .iter()
                    .map(|(scope, all)| (*scope, all.iter().map(|it| (*it, up(*it))).collect())),
            );
        }
        Some(known)
    }

    /// The proximity of the scope, if it matches.
    /// `decide` is given the candidates that can match, with the proximity if they do.
    fn memo(
        &self,
        key: Name,
        query: &Query,
        part: usize,
        host: NodeId,
        decide: impl Fn(&Entry, &mut Memo, &dyn Fn(&Query) -> Option<u16>),
    ) -> Rc<Memo> {
        if let Some(known) = self.known_memo(key, query) {
            return known;
        }
        let mut memo = Memo::default();
        self.visit_candidates(query, part, |entry| {
            let container = &|_: &ContainerQuery| true;
            decide(
                entry,
                &mut memo,
                &|query| match entry.follows_from_signature {
                    true => self.matches(
                        entry,
                        &Query {
                            container,
                            ..*query
                        },
                        host,
                    ),
                    false => {
                        let may_match = |scope| {
                            query
                                .matcher(host, scope)
                                .may_match(&entry.rule.selector.compounds, query.id)
                        };
                        (query.bloom.is_none_or(|it| it.may_have(&entry.ancestors))
                            && match &entry.rule.context.scope {
                                None => may_match(None),
                                Some(scope) => {
                                    !entry.has_known_roots
                                        || scope_roots(scope, query, host)
                                            .iter()
                                            .any(|it| may_match(Some(it.1)))
                                }
                            })
                        .then_some(0)
                    }
                },
            );
        });
        for scope in memo
            .undecided
            .iter()
            .filter(|it| it.has_known_roots)
            .filter_map(|it| it.rule.context.scope.as_ref())
        {
            if !memo.roots.iter().any(|it| it.0 == Rc::as_ptr(scope)) {
                memo.roots.push((
                    Rc::as_ptr(scope),
                    scope_roots(scope, query, host)
                        .iter()
                        .map(|it| it.0)
                        .collect(),
                ));
            }
        }
        let (memo, mut memos) = (Rc::new(memo), self.memos.borrow_mut());
        if memos.len() >= 8192 {
            memos.clear();
            self.version_of_memos.set(next_version());
        }
        memos.insert(key, Rc::clone(&memo));
        memo
    }

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
        let proximity = match &rule.context.scope {
            None => query
                .matcher(host, None)
                .matches(&rule.selector, query.id)
                .then_some(u16::MAX)?,
            Some(scope) => {
                scope_roots(scope, query, host)
                    .iter()
                    .find(|it| {
                        query
                            .matcher(host, Some(it.1))
                            .matches(&rule.selector, query.id)
                    })?
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
        let bit_of = |entry: &Entry| {
            let bit = match entry.rule.selector.pseudo {
                Pseudo::Before => 1 << BEFORE,
                Pseudo::After => 1 << AFTER,
                Pseudo::Marker => 1 << MARKER,
                Pseudo::Scroll(ScrollPart::Marker) => MARKER_RULES,
                Pseudo::Scroll(ScrollPart::Button(..)) => BUTTON_RULES,
                Pseudo::Scroll(ScrollPart::Column) => COLUMN_RULES,
                Pseudo::Scroll(ScrollPart::ColumnMarker) => COLUMN_MARKER_RULES,
                _ => return None,
            };
            let pseudo_state = if bit >= MARKER_RULES {
                State::all()
            } else {
                query.pseudo_state
            };
            (entry.rule.block.declarations().sets_content || bit == COLUMN_RULES).then_some((
                bit,
                Query {
                    pseudo: entry.rule.selector.pseudo,
                    pseudo_state,
                    ..*query
                },
            ))
        };
        let memo = (matches!(kind, Kind::Normal) && query.signature != Name::NONE).then(|| {
            self.memo(
                query.signature.salted(4),
                query,
                PSEUDOS,
                host,
                |entry, memo, matches| match bit_of(entry).filter(|it| matches(&it.1).is_some()) {
                    Some((bit, _)) if entry.is_decided() => memo.generated |= bit,
                    Some(_) => memo.undecided.push(entry.clone()),
                    None => {}
                },
            )
        });
        *found |= memo.as_ref().map_or(0, |it| it.generated);
        let visit = |entry: &Entry| {
            if let Some((bit, query)) = bit_of(entry).filter(|it| *found & it.0 == 0)
                && self.matches(entry, &query, host).is_some()
            {
                *found |= bit;
            }
        };
        if let Some(memo) = memo {
            return memo.undecided.iter().for_each(visit);
        }
        let list = match kind {
            Kind::Normal => return self.visit_candidates(query, PSEUDOS, visit),
            Kind::Host => &self.host,
            Kind::Slotted => &self.slotted,
            Kind::Part => &self.parts,
        };
        list.iter().filter(|it| self.is_active(it)).for_each(visit);
    }

    /// Appends in ascending priority.
    /// With those of the undecided rules that match, as bits. Together they tell what `collect` would add.
    pub(crate) fn decide(&self, query: &Query, host: NodeId) -> Option<(Rc<Memo>, u32)> {
        let memo = self.known_memo(query.signature.salted(salt_of(query.pseudo)?), query)?;
        let has_known_proximity =
            |it: &Entry| it.rule.context.scope.is_none() || it.has_known_roots;
        if memo.undecided.len() > 32
            || !memo.undecided.iter().all(has_known_proximity)
            || memo.roots.iter().any(|it| it.1.len() > 1)
        {
            return None;
        }
        let matching = memo
            .undecided
            .iter()
            .enumerate()
            .filter(|it| self.matches(it.1, query, host).is_some())
            .fold(0, |all, it| all | 1 << it.0);
        Some((memo, matching))
    }

    /// Whether what `generated` finds follows from the signature.
    pub(crate) fn always_generates_the_same(&self, signature: Name) -> bool {
        self.memos
            .borrow()
            .get(&signature.salted(4))
            .is_some_and(|it| it.is_decided())
    }

    pub(crate) fn note_generated(&self, signature: Name, version: u32, found: u8) {
        if let Some(memo) = self
            .memos
            .borrow()
            .get(&signature.salted(0))
            .filter(|_| self.always_generates_the_same(signature))
        {
            memo.always_generates.set(Some((version, found)));
        }
    }

    pub(crate) fn collect(
        &self,
        query: &Query,
        kind: Kind,
        host: NodeId,
        level: Level,
        out: &mut Found,
    ) {
        let (start, only) = (
            out.len(),
            if level == Level::UserAgent {
                Only::default()
            } else {
                Only::of(query.pseudo)
            },
        );
        let matched = |entry: &Entry, proximity: u16| {
            let (slot, rule) = (&self.slots[usize::from(entry.slot)], &entry.rule);
            let layer = slot.layer_ranks[usize::from(rule.context.layer)];
            let is_of_user = self.first_of_user.is_some_and(|it| slot.rank >= it);
            let (level, only) = if is_of_user {
                (Level::User, Only::of(query.pseudo))
            } else {
                (level, only)
            };
            let priority = u128::from(is_of_user) << 112
                | u128::from(layer) << 96
                | u128::from(rule.selector.specificity) << 64
                | u128::from(!proximity) << 48
                | u128::from(slot.rank) << 32
                | u128::from(rule.order);
            (
                priority,
                Matched {
                    block: Rc::clone(&rule.block),
                    level,
                    layer,
                    only,
                },
            )
        };
        let part = if query.pseudo == Pseudo::None {
            ELEMENTS
        } else {
            PSEUDOS
        };
        let salt = salt_of(query.pseudo).filter(|_| {
            matches!(kind, Kind::Normal)
                && query.signature != Name::NONE
                && query.pseudo_state.is_empty()
        });
        let memo = salt.map(|salt| {
            self.memo(
                query.signature.salted(salt),
                query,
                part,
                host,
                |entry, memo, matches| match matches(query) {
                    Some(proximity) if entry.is_decided() => {
                        memo.matched.push(matched(entry, proximity))
                    }
                    Some(_) if entry.rule.selector.pseudo.selects(query.pseudo) => {
                        memo.undecided.push(entry.clone())
                    }
                    _ => {}
                },
            )
        });
        out.extend(memo.iter().flat_map(|it| &it.matched).cloned());
        let mut visit = |entry: &Entry| {
            out.extend(
                self.matches(entry, query, host)
                    .map(|it| matched(entry, it)),
            )
        };
        let applies = |it: &&Entry| {
            self.is_active(it) && (query.with_starting || !it.rule.context.is_starting)
        };
        match kind {
            Kind::Host => self.host.iter().filter(applies).for_each(visit),
            Kind::Slotted => self.slotted.iter().filter(applies).for_each(visit),
            Kind::Part => self.parts.iter().filter(applies).for_each(visit),
            Kind::Normal => {
                match &memo {
                    Some(memo) => memo.undecided.iter().for_each(&mut visit),
                    None => self.visit_candidates(query, part, &mut visit),
                }
                if query.with_starting {
                    self.visit_candidates(query, STARTING, &mut visit);
                }
                if host != 0 {
                    self.parts.iter().filter(applies).for_each(visit);
                }
            }
        }
        out[start..].order_by_key(|it| it.0);
    }
}

impl<'a> Query<'a> {
    fn matcher(&self, host: NodeId, scope: Option<NodeId>) -> Matcher<'a> {
        let mut matcher = Matcher::new(
            self.tree,
            host,
            scope.unwrap_or(if host == 0 { 0 } else { NodeId::MAX }),
            Some(self.has_results),
        );
        matcher.bloom = self.bloom;
        matcher
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
    query.bloom.into_iter().for_each(|it| it.count(query.tree));
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

#[derive(Clone)]
struct Affected {
    relation: Relation,
    /// `None` is any element.
    subjects: Option<Set<Name>>,
    filter: u64,
}

#[derive(Clone)]
struct Mentioned([u64; 128]);

impl Default for Mentioned {
    fn default() -> Mentioned {
        Mentioned([0; 128])
    }
}

impl Mentioned {
    fn add(&mut self, key: Name) {
        self.0[(key.bits() >> 16) as usize % 128] |= 1 << (key.bits() >> 8 & 63);
    }

    fn may_have(&self, key: Name) -> bool {
        self.0[(key.bits() >> 16) as usize % 128] >> (key.bits() >> 8 & 63) & 1 != 0
    }
}

#[derive(Clone, Default)]
pub(crate) struct Dependencies {
    /// Whether it matters for every element.
    of_subject: Map<Name, bool>,
    /// All the features that matter.
    mentioned: Mentioned,
    of_subject_with: Set<(Name, Name)>,
    of_pseudo_elements: Set<Name>,
    of_others: Set<Name>,
    version_of_others: u32,
    in_has: Set<Name>,
    /// `selector::filter` of them.
    in_has_filter: u64,
    states_in_has: State,
    outside_has: Set<Name>,
    compared_attributes: Set<Name>,
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
                self.mentioned.add(key);
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
                if self.of_others.insert(key) {
                    self.version_of_others = next_version();
                }
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
                .map(key::state)
                .for_each(|key| {
                    self.mentioned.add(key);
                    self.of_pseudo_elements.insert(key);
                });
            for selector in limits.chain([&rule.selector]) {
                selector.compared_attributes(&mut self.compared_attributes);
                selector.visit_has(&mut |has| {
                    has.keys.iter().for_each(|it| self.mentioned.add(*it));
                    self.in_has.extend(has.keys.iter().copied());
                    self.in_has_filter |= crate::selector::filter(has.keys.iter().copied());
                    self.states_in_has.extend(
                        State::all()
                            .iter()
                            .filter(|it| has.keys.contains(&key::state(*it))),
                    );
                    self.outside_has.extend(has.outer_keys.iter().copied());
                    self.has_looks_at_siblings |= has.looks_at_siblings;
                });
            }
        }
    }

    /// Of what selectors can see of the element and of its ancestors, but not of their siblings and descendants.
    pub(crate) fn signature(&self, tree: &Tree, id: NodeId, bloom: &Bloom) -> Name {
        let (last, this) = (
            bloom.last_signature.get(),
            (
                id,
                self.of_others.len() + self.compared_attributes.len() + self.of_subject.len(),
            ),
        );
        if last.0 == this {
            return last.1;
        }
        let own = self.sign(
            tree,
            self.signature_of_path(tree, bloom),
            id,
            true,
            &|key| self.of_subject.contains_key(&key),
        );
        bloom.last_signature.set((this, own));
        own
    }

    #[inline]
    pub(crate) fn signature_of_path(&self, tree: &Tree, bloom: &Bloom) -> Name {
        let sign = |outer, id| {
            self.sign(
                tree,
                outer,
                id,
                self.of_others.contains(&CLASS_ATTRIBUTE),
                &|key| self.of_others.contains(&key),
            )
        };
        bloom.signature_of_path(self.of_others.len() + self.compared_attributes.len(), sign)
    }

    fn seen_by_others(&self, classes: &Classes) -> u64 {
        if classes.seen_by_others.get().0 != self.version_of_others {
            let keys: SmallVec<[_; 4]> = classes
                .iter()
                .map(|it| key::class(*it))
                .filter(|it| self.of_others.contains(it))
                .collect();
            classes.seen_by_others.set((
                self.version_of_others,
                if keys.is_empty() {
                    0
                } else {
                    keyed_hash(&keys[..])
                },
            ));
        }
        classes.seen_by_others.get().1
    }

    fn sign(
        &self,
        tree: &Tree,
        outer: Name,
        id: NodeId,
        has_all_classes: bool,
        matters: &dyn Fn(Name) -> bool,
    ) -> Name {
        let Some(element) = tree.element(id) else {
            return outer;
        };
        let place = u64::from(tree[id].slot != 0)
            | u64::from(tree.element(tree[id].parent).is_some()) << 1
            | (element.namespace as u64) << 2;
        let classes = element.classes.as_ref().map_or(0, |it| {
            if has_all_classes {
                it.hash
            } else {
                self.seen_by_others(it)
            }
        });
        let words = [
            outer.bits(),
            element.tag.bits(),
            classes,
            u64::from(element.state.bits()) << 8 | place,
        ];
        if element.has_only_classes()
            && element.custom_states.is_empty()
            && element.namespace != crate::tree::Namespace::Other
        {
            return Name::stand_in(keyed_hash_of_words(&words));
        }
        let mut words = SmallVec::<[u64; 10]>::from_slice(&words);
        words.extend(
            element
                .custom_states
                .iter()
                .map(|it| key::custom_state(*it).bits()),
        );
        for it in element.attributes_besides_class() {
            if matters(key::attribute(it.name)) {
                words.push(key::attribute(it.name).bits());
                if !crate::name::is_name!(it.name, "style" | "id")
                    && self.compared_attributes.contains(&it.name)
                {
                    words.push(keyed_hash(&*it.value));
                }
            }
            if it.key != Name::NONE && matters(it.key) {
                words.push(it.key.bits());
            }
        }
        if element.id != Name::NONE && matters(key::id(element.id)) {
            words.push(key::id(element.id).bits());
        }
        if element.namespace == crate::tree::Namespace::Other {
            words.push(keyed_hash(element.namespace_uri()));
        }
        Name::stand_in(keyed_hash_of_words(&words))
    }

    #[inline]
    pub(crate) fn may_mention(&self, feature: Name) -> bool {
        self.mentioned.may_have(feature)
    }

    #[inline]
    pub(crate) fn feature_changed(&mut self, tree: &Tree, id: NodeId, feature: Name) {
        if self.mentioned.may_have(feature) {
            self.feature_changed_along_with(tree, id, feature, &[]);
        }
    }

    /// A rule is indexed by a pair of names, so the classes that were removed at the same time count.
    pub(crate) fn feature_changed_along_with(
        &mut self,
        tree: &Tree,
        id: NodeId,
        feature: Name,
        removed: &[Name],
    ) {
        if !self.mentioned.may_have(feature) {
            return;
        }
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
        if !flags.intersects(
            Flags::CHILD_INDEX | Flags::LATER_SIBLINGS | Flags::NEXT_SIBLING | Flags::EDGE_CHILDREN,
        ) && self.in_has.is_empty()
        {
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
        self.changed_for_has(tree, child, previous);
    }

    /// All of them have come, or are about to go.
    pub(crate) fn children_replaced(&mut self, tree: &Tree, parent: NodeId) {
        if tree[parent].has(Flags::EMPTINESS) {
            self.feature_changed(tree, parent, key::STRUCTURE);
        }
        if self.looks_for_descendants() {
            tree.element_children(parent)
                .for_each(|it| self.changed_for_has(tree, it, None));
        }
    }

    pub(crate) fn looks_for_descendants(&self) -> bool {
        !self.in_has.is_empty()
    }

    fn changed_for_has(&mut self, tree: &Tree, child: NodeId, previous: Option<NodeId>) {
        if !self.in_has.is_empty() {
            self.changed_in_has.insert(key::STRUCTURE);
            let this = (tree[child].keys & self.in_has_filter != 0).then_some(child);
            for element in this
                .into_iter()
                .chain(tree.descendants_with(child, self.in_has_filter))
                .filter_map(|it| tree.element(it))
            {
                self.changed_in_has
                    .extend(key::of_element(element).filter(|key| self.in_has.contains(key)));
            }
            if !self.states_in_has.is_empty() {
                let all = core::iter::once(child)
                    .chain(tree.descendants(child))
                    .filter_map(|it| tree.element(it));
                let states = all.fold(State::empty(), |states, it| states | it.state);
                self.changed_in_has
                    .extend((states & self.states_in_has).iter().map(key::state));
            }
            let parent = tree.parent_or_host(child);
            if self.has_origins.last() != Some(&parent) {
                self.has_origins.push(parent);
            }
            self.has_origins.extend(previous);
        }
    }

    pub(crate) fn has_pending(&self) -> bool {
        !self.pending.is_empty() || !self.has_origins.is_empty()
    }

    /// Marks the elements that the changes so far can affect.
    pub(crate) fn flush(&mut self, tree: &Tree, has_results: &HasResults) {
        self.flush_has(tree, has_results);
        let (mut later, mut earlier) = (Set::default(), Set::default());
        let pending = core::mem::take(&mut self.pending);
        for &(id, index) in &pending {
            if !tree.contains(id) {
                continue;
            }
            let (affected, mut known) = (&self.affected[index as usize], Map::default());
            let mut visit = |id, element: &Element| {
                if let Some(subjects) = &affected.subjects
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
                Some(_) => tree.visit_styled(root, affected.filter, &mut visit),
                None => tree.mark_style(root, Flags::REMATCH_SUBTREE),
            };
            if affected.relation.contains(Relation::DESCENDANT)
                && !pending.contains(&(tree[id].parent, index))
            {
                subtree(id);
            }
            if affected.relation.contains(Relation::SIBLING) {
                tree.next_elements(id)
                    .take_while(|it| later.insert((*it, index)))
                    .for_each(&mut subtree);
            }
            if affected.relation.contains(Relation::EARLIER_SIBLING) {
                tree.previous_elements(id)
                    .take_while(|it| earlier.insert((*it, index)))
                    .for_each(subtree);
            }
            let host = if affected.relation.contains(Relation::SLOTTED) {
                tree.host_of(tree[id].scope)
            } else {
                0
            };
            if host != 0 {
                tree.mark_style(host, Flags::REMATCH_SUBTREE);
            }
        }
    }

    fn flush_has(&mut self, tree: &Tree, has_results: &HasResults) {
        tree.forget_found();
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
        let mut earlier = Set::default();
        for id in visited {
            tree[id].unset(Flags::VISITED);
            check(id, false);
            if self.has_looks_at_siblings {
                tree.previous_elements(id)
                    .take_while(|it| earlier.insert(*it))
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
