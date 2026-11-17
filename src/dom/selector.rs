//! Selectors, compiled for matching.

use core::cell::{Cell, RefCell};
use std::rc::Rc;

use bun_core::strings;
use smallvec::SmallVec;

use crate::name::{Map, Name, name};
use crate::order::Order as _;
use crate::tree::{Data, Element, Flags, Namespace, Node, NodeId, State, Tree};
use crate::values::{Str, eq};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub(crate) enum Pseudo {
    None,
    Marker,
    Before,
    After,
    Backdrop,
    Selection,
    Scrollbar,
    ScrollbarThumb,
    ScrollbarTrack,
    ScrollbarCorner,
    FirstLetter,
    FirstLine,
    Highlight(Name),
    /// An element in the shadow tree of a control, such as `::placeholder`.
    Part(Name),
    /// `Name::NONE` stands for all of the names.
    Transition(TransitionPart, Name),
    Scroll(ScrollPart),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub(crate) enum ScrollPart {
    Group,
    Marker,
    Column,
    ColumnMarker,
    /// By its logical and by its physical direction. `None` is any.
    Button(Option<u8>, Option<u8>),
}

impl ScrollPart {
    fn button(direction: &[u8]) -> Option<ScrollPart> {
        let find = |names: [&str; 4]| {
            names
                .iter()
                .position(|it| eq(direction, it))
                .map(|it| it as u8)
        };
        let (logical, physical) = (
            find(["block-start", "inline-start", "inline-end", "block-end"]),
            find(["up", "right", "down", "left"]),
        );
        (logical.or(physical).is_some() || direction == b"*")
            .then_some(ScrollPart::Button(logical, physical))
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub(crate) enum TransitionPart {
    Root,
    Group,
    Pair,
    Old,
    New,
    Children,
    /// The snapshot containing block
    Block,
}

impl TransitionPart {
    const ALL: [TransitionPart; 6] = [
        Self::Root,
        Self::Group,
        Self::Pair,
        Self::Old,
        Self::New,
        Self::Children,
    ];

    pub(crate) fn name(self) -> &'static str {
        const NAMES: [&str; 7] = [
            "view-transition",
            "view-transition-group",
            "view-transition-image-pair",
            "view-transition-old",
            "view-transition-new",
            "view-transition-group-children",
            "",
        ];
        NAMES[self as usize]
    }
}

impl Pseudo {
    pub(crate) fn selects(self, other: Pseudo) -> bool {
        self == other
            || match (self, other) {
                (Pseudo::Transition(a, Name::NONE), Pseudo::Transition(b, _)) => a == b,
                (Pseudo::Part(a), Pseudo::Part(b)) => {
                    (a, b) == (name!("-internal-cue-node"), name!("cue"))
                }
                (
                    Pseudo::Scroll(ScrollPart::Button(a, b)),
                    Pseudo::Scroll(ScrollPart::Button(c @ Some(_), d @ Some(_))),
                ) => [a.or(c), b.or(d)] == [c, d],
                _ => false,
            }
    }

    pub(crate) fn name(self) -> &'static str {
        match self {
            Pseudo::Marker => "::marker",
            Pseudo::Before => "::before",
            Pseudo::After => "::after",
            Pseudo::Backdrop => "::backdrop",
            Pseudo::Scroll(ScrollPart::Group) => "::scroll-marker-group",
            Pseudo::Scroll(ScrollPart::Marker) => "::scroll-marker",
            _ => "",
        }
    }

    pub(crate) fn from_name(name: &[u8]) -> Pseudo {
        let name = name.strip_prefix(b":").unwrap_or(name);
        let name = name.strip_prefix(b":").unwrap_or(name);
        let (function, argument) = name
            .strip_suffix(b")")
            .and_then(|it| strings::split_once_char(it, b'('))
            .unwrap_or((name, b""));
        if let Some(part) = TransitionPart::ALL
            .into_iter()
            .find(|it| eq(function, it.name()))
        {
            return Pseudo::Transition(
                part,
                if argument.is_empty() {
                    Name::NONE
                } else {
                    Name::new(argument.trim_ascii())
                },
            );
        }
        match () {
            () if name.is_empty() => Pseudo::None,
            () if eq(name, "scroll-marker-group") => Pseudo::Scroll(ScrollPart::Group),
            () if eq(name, "scroll-marker") => Pseudo::Scroll(ScrollPart::Marker),
            () if eq(name, "column") => Pseudo::Scroll(ScrollPart::Column),
            () if eq(function, "scroll-button")
                && let Some(button) = ScrollPart::button(argument.trim_ascii()) =>
            {
                Pseudo::Scroll(button)
            }
            () if eq(name, "marker") => Pseudo::Marker,
            () if eq(name, "before") => Pseudo::Before,
            () if eq(name, "after") => Pseudo::After,
            () if eq(name, "backdrop") => Pseudo::Backdrop,
            () if eq(name, "selection") => Pseudo::Selection,
            () if eq(name, "target-text") => Pseudo::Highlight(name!("::target-text")),
            () if eq(name, "first-letter") => Pseudo::FirstLetter,
            () if eq(name, "first-line") => Pseudo::FirstLine,
            () if eq(name, "-webkit-scrollbar") => Pseudo::Scrollbar,
            () if eq(name, "-webkit-scrollbar-thumb") => Pseudo::ScrollbarThumb,
            () if eq(name, "-webkit-scrollbar-track") => Pseudo::ScrollbarTrack,
            () if eq(name, "-webkit-scrollbar-corner") => Pseudo::ScrollbarCorner,
            () if let Some([highlight @ .., b')']) = name.strip_prefix(b"highlight(") => {
                Pseudo::Highlight(Name::new(highlight))
            }
            () if eq(name, "-webkit-input-placeholder") => Pseudo::Part(name!("placeholder")),
            () if eq(name, "-webkit-file-upload-button") => {
                Pseudo::Part(name!("file-selector-button"))
            }
            () => Pseudo::Part(Name::lowercase(name)),
        }
    }
}

impl Pseudo {
    pub(crate) fn has_nested(self) -> bool {
        self == Pseudo::Part(name!("picker(select)"))
            || self == Pseudo::Part(name!("details-content"))
    }

    /// Of a pseudo-element of this one.
    pub(crate) fn nested(self, inner: Pseudo) -> Pseudo {
        if self == Pseudo::Scroll(ScrollPart::Column) {
            return Pseudo::Scroll(ScrollPart::ColumnMarker);
        }
        let name = |it: Pseudo| {
            if let Pseudo::Part(name) | Pseudo::Highlight(name) = it {
                name
            } else {
                Name::new(it.name().as_bytes())
            }
        };
        Pseudo::Part(name(self).paired(name(inner)))
    }
}

/// What a selector can depend on, as a key of the indexes.
pub(crate) mod key {
    use core::sync::atomic::{AtomicU64, Ordering};

    use super::*;

    pub(crate) const STRUCTURE: Name = name!("structure").salted(6);

    pub(crate) fn class(name: Name) -> Name {
        name
    }
    pub(crate) fn id(name: Name) -> Name {
        name.salted(1)
    }
    pub(crate) fn tag(name: Name) -> Name {
        name.salted(2)
    }
    pub(crate) const fn attribute(name: Name) -> Name {
        name.salted(3)
    }
    /// `Name::NONE` unless the attribute is of the kind that selectors tend to compare as a whole.
    pub(crate) fn value(name: Name, spelled: &[u8], value: &[u8]) -> Name {
        let has_keys =
            spelled.starts_with(b"data-") || spelled.starts_with(b"aria-") || spelled == b"role";
        has_keys
            .then(|| short_value(name, value))
            .flatten()
            .unwrap_or(Name::NONE)
    }

    /// `value`, for a name that is known to have keys.
    #[inline]
    pub(crate) fn short_value(name: Name, value: &[u8]) -> Option<Name> {
        (value.len() <= 48)
            .then(|| Name::stand_in(crate::name::keyed_hash_of_bytes(name.bits(), value)).salted(8))
    }

    /// A bit for each `value` that was parsed.
    static IN_SELECTORS: [AtomicU64; 128] = [const { AtomicU64::new(0) }; 128];

    pub(crate) fn value_in_selector(name: Name, spelled: &[u8], value: &[u8]) -> Name {
        let key = self::value(name, spelled, value);
        if key != Name::NONE {
            IN_SELECTORS[(key.bits() >> 16) as usize % 128]
                .fetch_or(1 << (key.bits() >> 8 & 63), Ordering::Relaxed);
        }
        key
    }

    pub(crate) fn is_in_selectors(key: Name) -> bool {
        key != Name::NONE
            && IN_SELECTORS[(key.bits() >> 16) as usize % 128].load(Ordering::Relaxed)
                >> (key.bits() >> 8 & 63)
                & 1
                != 0
    }
    /// The name of the attribute that repeats an attribute in a namespace.
    pub(crate) fn namespaced(namespace: &[u8], local: &[u8]) -> Name {
        Name::new(&[local, b" ", namespace].concat())
    }
    pub(crate) fn custom_state(name: Name) -> Name {
        name.salted(4)
    }
    pub(crate) fn state(bit: State) -> Name {
        Name::new(&bit.bits().to_le_bytes()).salted(5)
    }
    pub(crate) fn has(id: u32) -> Name {
        Name::new(&id.to_le_bytes()).salted(7)
    }

    pub(crate) fn besides_classes(element: &Element) -> impl Iterator<Item = Name> + '_ {
        ((element.id != Name::NONE)
            .then(|| id(element.id))
            .into_iter())
        .chain([tag(element.tag)])
        .chain(element.attributes.iter().map(|it| attribute(it.name)))
        .chain(
            element
                .attributes
                .iter()
                .map(|it| it.key)
                .filter(|it| *it != Name::NONE),
        )
    }

    pub(crate) fn of_element(element: &Element) -> impl Iterator<Item = Name> + '_ {
        element
            .classes()
            .iter()
            .map(|name| class(*name))
            .chain(besides_classes(element))
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Combinator {
    None,
    Child,
    Descendant,
    Next,
    Later,
    Slot,
    Part,
}

pub(crate) type List = Rc<[Selector]>;

#[derive(Clone)]
pub(crate) enum Simple {
    Class(Name),
    Id(Name),
    /// As written, and in lowercase.
    Tag(Name, Name),
    Exists(Name, Name),
    Attribute(Rc<AttributeTest>),
    State(State),
    NotState(State),
    CustomState(Name),
    /// Of `Tree::matched_part`
    TransitionClass(Name),
    Cue(List),
    RootOfCue,
    Root,
    Empty,
    Scope,
    Anchor,
    Never,
    /// A control whose `appearance` is not `none`. Only for the parts of the control.
    Native,
    Base(Flags),
    InBase,
    Html,
    InHtml,
    Math,
    Lang(Rc<[Box<[u8]>]>),
    Nth(Nth, Option<List>),
    Namespace(Str),
    /// An attribute, by its local name as written and in lowercase.
    AnyNamespace(Rc<(Box<[u8]>, Name, Option<AttributeTest>)>),
    Part(Rc<[Name]>),
    Host(Option<List>),
    HostContext(List),
    Is(List),
    Not(List),
    Has(Rc<Has>),
}

#[derive(Clone, Copy, PartialEq)]
pub(crate) enum Operator {
    Equal,
    Includes,
    DashMatch,
    Prefix,
    Suffix,
    Substring,
}

#[derive(Clone, Copy, PartialEq)]
pub(crate) enum Case {
    Matters,
    Ignored,
    IgnoredInHtml,
}

#[derive(Clone, Copy, PartialEq)]
pub(crate) enum NthKind {
    Child,
    LastChild,
    OnlyChild,
    OfType,
    LastOfType,
    OnlyOfType,
}

#[derive(Clone, Copy)]
pub(crate) struct Nth {
    pub(crate) kind: NthKind,
    pub(crate) a: i32,
    pub(crate) b: i32,
}

pub(crate) struct AttributeTest {
    pub(crate) names: (Name, Name),
    pub(crate) operator: Operator,
    pub(crate) value: Box<[u8]>,
    pub(crate) case: Case,
    /// `key::value` of the only value that matches.
    pub(crate) key: Name,
}

pub(crate) struct Has {
    pub(crate) id: u32,
    /// Each ends with a compound of only `Simple::Anchor`.
    pub(crate) relatives: Vec<Selector>,
    pub(crate) keys: Vec<Name>,
    /// Of elements that can be anywhere, as in `:has(:is(a b))`.
    pub(crate) outer_keys: Vec<Name>,
    pub(crate) looks_at_siblings: bool,
}

#[derive(Clone)]
pub(crate) struct Compound {
    pub(crate) simples: SmallVec<[Simple; 1]>,
    /// To the next compound, which is to the left.
    pub(crate) combinator: Combinator,
    /// `Bloom::hash` of the key, or 0.
    pub(crate) required: u32,
    /// `filter` of the keys.
    pub(crate) filter: u64,
}

#[derive(Clone)]
pub(crate) struct Selector {
    /// From right to left.
    pub(crate) compounds: SmallVec<[Compound; 1]>,
    pub(crate) specificity: u32,
    pub(crate) pseudo: Pseudo,
    /// What follows the pseudo-element, as in `::-webkit-scrollbar-thumb:hover`.
    pub(crate) pseudo_state: State,
}

/// A compound of a selector that has no other combinators than those for children and descendants.
pub(crate) struct Step<'a> {
    /// `filter` of keys that are all required.
    pub(crate) keys: u64,
    tag: Name,
    class: Name,
    /// If there is more to it.
    compound: Option<&'a Compound>,
    is_child: bool,
}

impl Step<'_> {
    pub(crate) fn all_of<'a>(
        list: &'a [Selector],
        matcher: &Matcher<'_>,
    ) -> Option<SmallVec<[Step<'a>; 4]>> {
        let [selector] = list else { return None };
        (selector.pseudo == Pseudo::None && matcher.cut_at == 0 && matcher.host == 0)
            .then_some(())?;
        let step = |compound: &'a Compound| {
            let mut step = Step {
                keys: 0,
                tag: Name::NONE,
                class: Name::NONE,
                compound: None,
                is_child: compound.combinator == Combinator::Child,
            };
            for simple in &compound.simples {
                match simple {
                    Simple::Tag(name, lower) if name == lower => {
                        step.keys |= filter([key::tag(*name)].into_iter());
                        step.tag = *name;
                    }
                    Simple::Class(class) => {
                        step.keys |= filter([key::class(*class)].into_iter());
                        step.compound = step
                            .compound
                            .or_else(|| (step.class != Name::NONE).then_some(compound));
                        step.class = *class;
                    }
                    Simple::Scope => return None,
                    _ => step.compound = Some(compound),
                }
            }
            matches!(
                compound.combinator,
                Combinator::None | Combinator::Child | Combinator::Descendant
            )
            .then_some(step)
        };
        selector.compounds.iter().map(step).collect()
    }

    #[inline(always)]
    fn fits(&self, matcher: &Matcher<'_>, id: NodeId) -> bool {
        let node = &matcher.tree[id];
        node.keys & self.keys == self.keys
            && node.element().is_some_and(|it| {
                (self.tag == Name::NONE || it.tag == self.tag)
                    && (self.class == Name::NONE || it.classes().contains(&self.class))
            })
            && self.compound.is_none_or(|it| matcher.compound(it, id))
    }

    #[inline]
    pub(crate) fn lead_to(steps: &[Step<'_>], matcher: &Matcher<'_>, id: NodeId) -> bool {
        let [first, rest @ ..] = steps else {
            return false;
        };
        if !first.fits(matcher, id) {
            return false;
        }
        let (mut index, mut at, mut is_child, mut retry) = (0, id, first.is_child, (0, 0));
        while let Some(step) = rest.get(index) {
            at = matcher.tree[at].parent;
            if at == 0 {
                return false;
            }
            if step.fits(matcher, at) {
                retry = if is_child { retry } else { (index, at) };
                (index, is_child) = (index + 1, step.is_child);
            } else if is_child {
                ((index, at), is_child) = (retry, false);
                if at == 0 {
                    return false;
                }
            }
        }
        true
    }
}

pub(crate) fn tests_state(list: &[Selector]) -> bool {
    list.iter()
        .flat_map(|it| &it.compounds)
        .flat_map(|it| &it.simples)
        .any(|simple| match simple {
            Simple::Nth(_, Some(list))
            | Simple::Is(list)
            | Simple::Not(list)
            | Simple::Host(Some(list))
            | Simple::HostContext(list) => tests_state(list),
            Simple::Has(has) => tests_state(&has.relatives),
            _ => matches!(simple, Simple::State(_) | Simple::NotState(_)),
        })
}

/// Whether it has at most `budget` simple selectors, with what `&` stands for counted each time.
pub(crate) fn fits(list: &[Selector], budget: &mut u32) -> bool {
    list.iter()
        .flat_map(|it| &it.compounds)
        .flat_map(|it| &it.simples)
        .all(|simple| {
            *budget = budget.saturating_sub(1);
            *budget > 0
                && match simple {
                    Simple::Nth(_, Some(list)) | Simple::Is(list) | Simple::Not(list) => {
                        fits(list, budget)
                    }
                    Simple::Has(has) => fits(&has.relatives, budget),
                    _ => true,
                }
        })
}

const CLASS: u32 = 1 << 10;

bitflags::bitflags! {
    /// Where the subject of a selector is, from the element that has a feature.
    #[derive(Clone, Copy, PartialEq, Eq)]
    pub(crate) struct Relation: u8 {
        const DESCENDANT = 1;
        const SIBLING = 2;
        const EARLIER_SIBLING = 4;
        /// Assigned to a slot.
        const SLOTTED = 8;
    }
}

impl Simple {
    pub(crate) fn is_about_host(&self) -> bool {
        match self {
            Simple::Host(_) | Simple::HostContext(_) | Simple::Scope => true,
            Simple::Is(list) | Simple::Not(list) => list
                .iter()
                .any(|it| it.compounds[0].simples.iter().any(Simple::is_about_host)),
            _ => false,
        }
    }

    fn cost(&self) -> u8 {
        match self {
            Simple::Never | Simple::Class(_) | Simple::Id(_) | Simple::Tag(..) => 0,
            Simple::State(_) | Simple::NotState(_) | Simple::Root | Simple::Scope => 1,
            Simple::Exists(..) | Simple::Attribute(_) | Simple::CustomState(_) => 2,
            Simple::Is(_) | Simple::Not(_) => 4,
            Simple::Has(_) => 5,
            _ => 3,
        }
    }
}

fn best_key<'a>(simples: impl Iterator<Item = &'a Simple>) -> Option<Name> {
    let ranked = simples.filter_map(|simple| match simple {
        Simple::Id(id) => Some((0, key::id(*id))),
        Simple::Class(class) => Some((1, key::class(*class))),
        Simple::Attribute(test) if test.key != Name::NONE => Some((2, test.key)),
        Simple::Exists(name, lower) if name == lower => Some((3, key::attribute(*name))),
        Simple::Attribute(test) if test.names.0 == test.names.1 => {
            Some((3, key::attribute(test.names.0)))
        }
        Simple::Tag(name, lower) if name == lower => Some((4, key::tag(*name))),
        _ => None,
    });
    ranked.min_by_key(|(rank, _)| *rank).map(|(_, key)| key)
}

impl Compound {
    /// One that an element has to have, in `key::of_element`.
    pub(crate) fn key(&self) -> Option<Name> {
        best_key(self.simples.iter())
    }

    /// An element has to have all of them.
    pub(crate) fn attribute_keys(&self) -> impl Iterator<Item = Name> + '_ {
        let of_attributes = self
            .simples
            .iter()
            .filter(|it| matches!(it, Simple::Attribute(_) | Simple::Exists(..)));
        of_attributes.filter_map(|it| best_key(core::iter::once(it)))
    }

    /// An element has to have one of them.
    pub(crate) fn keys(&self) -> Option<SmallVec<[Name; 1]>> {
        if let Some(key) = self.key() {
            return Some(smallvec::smallvec![key]);
        }
        self.simples.iter().find_map(|simple| match simple {
            Simple::Is(list) => {
                let mut keys = SmallVec::new();
                for selector in list.iter() {
                    keys.extend(selector.compounds[0].keys()?);
                }
                keys.order_by(Ord::cmp);
                keys.dedup();
                Some(keys)
            }
            Simple::Root => Some(smallvec::smallvec![
                key::tag(name!("html")),
                key::tag(name!("svg"))
            ]),
            _ => None,
        })
    }
}

impl Selector {
    pub(crate) fn class(name: Name) -> Selector {
        let compound = Compound {
            simples: smallvec::smallvec![Simple::Class(name)],
            combinator: Combinator::None,
            required: Bloom::hash(key::class(name)),
            filter: filter(core::iter::once(key::class(name))),
        };
        let compounds = smallvec::smallvec![compound];
        Selector {
            compounds,
            specificity: CLASS,
            pseudo: Pseudo::None,
            pseudo_state: State::empty(),
        }
    }

    /// Those that the subject has to be in.
    pub(crate) fn states(&self) -> State {
        let states = self.compounds[0].simples.iter().filter_map(|it| match it {
            Simple::State(state) => Some(*state),
            _ => None,
        });
        states.collect()
    }

    /// Whether the subject can have that `class` attribute, as far as attribute selectors tell.
    pub(crate) fn allows_class_attribute(&self, value: &str) -> bool {
        self.compounds[0].simples.iter().all(|it| match it {
            Simple::Attribute(test) if test.names.1 == name!("class") => {
                test.matches(value.as_bytes(), true)
            }
            _ => true,
        })
    }

    /// `:is()` of one compound is that compound, and `a:is(b c)` is `b ac`.
    pub(crate) fn flatten(&mut self) {
        let mut index = 0;
        while index < self.compounds.len() {
            let is_last = index + 1 == self.compounds.len();
            let compound = &mut self.compounds[index];
            let found = compound.simples.iter().position(|simple| {
                matches!(simple, Simple::Is(list) if list.len() == 1
                    && list[0].pseudo == Pseudo::None
                    && (is_last || list[0].compounds.len() == 1))
            });
            let Some(found) = found else {
                compound.simples.order_by_key(Simple::cost);
                compound.required = compound.key().map_or(0, Bloom::hash);
                compound.filter = filter(compound.keys().into_iter().flatten());
                index += 1;
                continue;
            };
            let Simple::Is(list) = compound.simples.remove(found) else {
                unreachable!()
            };
            let (first, rest) = (&list[0].compounds[0], &list[0].compounds[1..]);
            compound.simples.extend(first.simples.iter().cloned());
            if !rest.is_empty() {
                compound.combinator = first.combinator;
                self.compounds.extend(rest.iter().cloned());
            }
        }
    }

    /// Reports each key, where the subject is, and a key that the same element has to have.
    /// Whether `Dependencies::signature` tells if it matches.
    pub(crate) fn follows_from_signature(&self) -> bool {
        self.compounds.iter().all(Compound::follows_from_signature)
    }

    /// Those that have no key for the value.
    pub(crate) fn compared_attributes(&self, out: &mut crate::name::Set<Name>) {
        for simple in self.compounds.iter().flat_map(|it| &it.simples) {
            match simple {
                Simple::Attribute(test) if test.key == Name::NONE => {
                    out.extend([test.names.0, test.names.1])
                }
                Simple::Lang(_) => out.extend(LANGUAGES),
                Simple::Is(list) | Simple::Not(list) => {
                    list.iter().for_each(|it| it.compared_attributes(out))
                }
                _ => {}
            }
        }
    }

    pub(crate) fn features(
        &self,
        mut relation: Relation,
        report: &mut dyn FnMut(Name, Relation, Name),
        into_has: bool,
    ) {
        for compound in &self.compounds {
            let with_besides = |attribute: Name| {
                let is_other = |it: &&Simple| match it {
                    Simple::Exists(_, name) => *name != attribute,
                    Simple::Attribute(test) => test.names.1 != attribute,
                    _ => true,
                };
                best_key(compound.simples.iter().filter(is_other)).unwrap_or(Name::NONE)
            };
            let with = with_besides(Name::NONE);
            let lasting = best_key(
                compound
                    .simples
                    .iter()
                    .filter(|it| !matches!(it, Simple::Exists(..) | Simple::Attribute(_))),
            );
            let lasting = lasting.unwrap_or(Name::NONE);
            let nested = |list: &[Selector], relation, report: &mut dyn FnMut(_, _, _)| {
                for selector in list {
                    let mut forward = |key, inner, required| match (inner == relation, required) {
                        (true, Name::NONE) if key != lasting => report(key, inner, lasting),
                        _ => report(key, inner, required),
                    };
                    selector.features(relation, &mut forward, into_has);
                }
            };
            for simple in &compound.simples {
                match simple {
                    Simple::Class(class) => report(key::class(*class), relation, Name::NONE),
                    Simple::Id(id) => report(key::id(*id), relation, Name::NONE),
                    Simple::Tag(_, tag) if into_has => report(key::tag(*tag), relation, Name::NONE),
                    Simple::Exists(name, lower) => {
                        report(key::attribute(*name), relation, with_besides(*lower));
                        report(key::attribute(*lower), relation, with_besides(*lower));
                    }
                    Simple::Attribute(test) if test.key != Name::NONE => {
                        report(test.key, relation, with_besides(test.names.1))
                    }
                    Simple::Attribute(test) => {
                        report(
                            key::attribute(test.names.0),
                            relation,
                            with_besides(test.names.1),
                        );
                        report(
                            key::attribute(test.names.1),
                            relation,
                            with_besides(test.names.1),
                        );
                    }
                    Simple::AnyNamespace(it) => {
                        report(key::attribute(it.1), relation, with);
                        report(key::attribute(name!("\0")), relation, with);
                    }
                    Simple::Lang(_) => {
                        for key in LANGUAGES.map(key::attribute) {
                            report(key, relation | Relation::DESCENDANT, Name::NONE);
                            report(key, relation, Name::NONE);
                        }
                    }
                    Simple::State(state) | Simple::NotState(state) => {
                        state
                            .iter()
                            .for_each(|bit| report(key::state(bit), relation, with));
                    }
                    Simple::CustomState(state) => report(key::custom_state(*state), relation, with),
                    Simple::Part(_) => {
                        report(key::attribute(name!("part")), relation, with);
                        report(
                            key::attribute(name!("exportparts")),
                            relation | Relation::DESCENDANT,
                            Name::NONE,
                        );
                    }
                    Simple::Empty => report(key::STRUCTURE, relation, with),
                    Simple::Nth(data, of) => {
                        let sibling = if data.kind == NthKind::LastChild {
                            Relation::EARLIER_SIBLING
                        } else {
                            Relation::SIBLING
                        };
                        report(key::STRUCTURE, relation, with);
                        for selector in of.iter().flat_map(|list| list.iter()) {
                            let mut both = |key, relation: Relation, with| {
                                report(key, relation, with);
                                if !relation.contains(sibling) {
                                    report(key, relation | sibling, with);
                                }
                            };
                            selector.features(relation, &mut both, into_has);
                        }
                    }
                    Simple::Is(list) | Simple::Not(list) | Simple::Host(Some(list)) => {
                        nested(list, relation, report);
                    }
                    Simple::HostContext(list) => {
                        for selector in list.iter() {
                            selector.features(relation | Relation::DESCENDANT, report, into_has);
                        }
                    }
                    Simple::Has(has) => report(key::has(has.id), relation, with),
                    _ => {}
                }
            }
            relation |= match compound.combinator {
                Combinator::Next | Combinator::Later => {
                    report(key::STRUCTURE, relation, with);
                    Relation::SIBLING
                }
                Combinator::Slot => Relation::DESCENDANT | Relation::SLOTTED,
                _ => Relation::DESCENDANT,
            };
        }
    }

    /// Those left of a combinator in a nested selector.
    pub(crate) fn outer_features(&self, report: &mut dyn FnMut(Name, Relation, Name)) {
        for simple in self.compounds.iter().flat_map(|compound| &compound.simples) {
            let (list, relation) = match simple {
                Simple::Is(list) | Simple::Not(list) | Simple::Nth(_, Some(list)) => {
                    (list, Relation::empty())
                }
                Simple::Host(Some(list)) | Simple::HostContext(list) => {
                    (list, Relation::DESCENDANT)
                }
                _ => continue,
            };
            for selector in list.iter() {
                selector.features(
                    relation,
                    &mut |key, relation, with| {
                        if !relation.is_empty() {
                            report(key, relation, with)
                        }
                    },
                    true,
                );
                selector.outer_features(report);
            }
        }
    }

    pub(crate) fn visit_has(&self, visit: &mut dyn FnMut(&Has)) {
        for simple in self.compounds.iter().flat_map(|compound| &compound.simples) {
            match simple {
                Simple::Has(has) => visit(has),
                Simple::Is(list)
                | Simple::Not(list)
                | Simple::Nth(_, Some(list))
                | Simple::Host(Some(list))
                | Simple::HostContext(list) => {
                    list.iter().for_each(|selector| selector.visit_has(visit));
                }
                _ => {}
            }
        }
    }

    /// Keys that some ancestor of the subject has to have, for [`Bloom`].
    pub(crate) fn ancestor_hashes(&self) -> [u32; 3] {
        let (mut hashes, mut count) = ([0; 3], 0);
        for pair in self.compounds.iter().zip(self.compounds.iter().skip(1)) {
            match pair.0.combinator {
                Combinator::Child | Combinator::Descendant => {}
                Combinator::Next | Combinator::Later => continue,
                _ => break,
            }
            for simple in &pair.1.simples {
                let key = match simple {
                    Simple::Class(class) => key::class(*class),
                    Simple::Id(id) => key::id(*id),
                    Simple::Tag(name, lower) if name == lower => key::tag(*name),
                    Simple::Exists(name, lower) if name == lower => key::attribute(*name),
                    Simple::Attribute(test) if test.key != Name::NONE => test.key,
                    Simple::Attribute(test) if test.names.0 == test.names.1 => {
                        key::attribute(test.names.0)
                    }
                    _ => continue,
                };
                hashes[count] = Bloom::hash(key);
                count += 1;
                if count == hashes.len() {
                    return hashes;
                }
            }
        }
        hashes
    }
}

fn filter_bit(hash: u32) -> u64 {
    1 << (hash & 63)
}

const LANGUAGES: [Name; 2] = [
    name!("lang"),
    name!("lang http://www.w3.org/XML/1998/namespace"),
];

/// `filter` of `key::of_element`
pub(crate) fn filter_of(element: &Element) -> u64 {
    let bit = |key: Name| {
        if key == Name::NONE {
            0
        } else {
            filter_bit(Bloom::hash(key))
        }
    };
    let own = element.classes.as_ref().map_or(0, |it| it.filter)
        | bit(key::tag(element.tag))
        | if element.id == Name::NONE {
            0
        } else {
            bit(key::id(element.id))
        };
    element.attributes.iter().fold(own, |all, it| {
        all | bit(key::attribute(it.name)) | bit(it.key)
    })
}

/// A bit for each key.
pub(crate) fn filter(keys: impl Iterator<Item = Name>) -> u64 {
    keys.fold(0, |all, key| all | filter_bit(Bloom::hash(key)))
}

impl Simple {
    fn follows_from_signature(&self) -> bool {
        match self {
            Simple::Class(_)
            | Simple::Id(_)
            | Simple::Tag(..)
            | Simple::Exists(..)
            | Simple::State(_)
            | Simple::NotState(_)
            | Simple::Lang(_)
            | Simple::Host(None) => true,
            Simple::CustomState(_)
            | Simple::Root
            | Simple::Scope
            | Simple::Never
            | Simple::Html
            | Simple::InHtml
            | Simple::Math
            | Simple::Namespace(_) => true,
            Simple::Attribute(test) => !crate::name::is_name!(test.names.1, "style" | "id"),
            Simple::Is(list) | Simple::Not(list) => {
                list.iter().all(Selector::follows_from_signature)
            }
            _ => false,
        }
    }
}

impl Compound {
    fn follows_from_signature(&self) -> bool {
        matches!(
            self.combinator,
            Combinator::None | Combinator::Child | Combinator::Descendant
        ) && self.simples.iter().all(Simple::follows_from_signature)
    }
}

/// The answer to whether an ancestor matches the compounds.
#[derive(Clone, Copy, Default)]
struct Search {
    compounds: usize,
    /// With the host.
    scope: (NodeId, NodeId),
    /// If one does, which. Otherwise where the search started.
    node: NodeId,
    visit: u32,
    traversal: u32,
    found: bool,
}

/// What is known of the ancestors of the element that is being styled.
pub(crate) struct Bloom {
    counters: Box<[Cell<u8>; 1 << 14]>,
    /// What has been counted, and for each of the first of `known` how much of it was there before.
    pushed: RefCell<(Vec<u32>, Vec<u32>)>,
    /// All of `known` are. Otherwise the ancestors may have anything.
    is_counted: Cell<bool>,
    searches: Box<[Cell<Search>; 512]>,
    last_visit: u32,
    traversal: u32,
    /// The ancestors.
    path: Vec<NodeId>,
    /// With `Node::visit`. It outlives the traversal.
    known: Vec<(NodeId, u32)>,
    /// How many of `path` and `known` are the same.
    same: usize,
    /// For the first of `path`, with what they were made from.
    signatures: RefCell<(usize, Vec<Name>)>,
    pub(crate) last_signature: Cell<((NodeId, usize), Name)>,
    /// What `generated_by_rules` would say of the element that was matched last.
    pub(crate) last_generated: Cell<Option<(NodeId, u8)>>,
    /// The last element whose rules follow from its signature, also those that generate something.
    pub(crate) last_decided: Cell<NodeId>,
}

impl Bloom {
    /// `sign` adds an element to the signature of its ancestors.
    #[inline]
    pub(crate) fn signature_of_path(
        &self,
        version: usize,
        sign: impl Fn(Name, NodeId) -> Name,
    ) -> Name {
        let (known, all) = &mut *self.signatures.borrow_mut();
        if core::mem::replace(known, version) != version {
            all.clear();
        }
        for id in &self.path[all.len()..] {
            all.push(sign(all.last().copied().unwrap_or(Name::NONE), *id));
        }
        all.last().copied().unwrap_or(Name::NONE)
    }

    pub(crate) fn new() -> Bloom {
        Bloom {
            counters: Box::new([const { Cell::new(0) }; 1 << 14]),
            pushed: RefCell::default(),
            is_counted: Cell::new(true),
            searches: Box::new(core::array::from_fn(|_| Cell::default())),
            last_visit: 0,
            traversal: 0,
            path: Vec::new(),
            known: Vec::new(),
            same: 0,
            signatures: RefCell::default(),
            last_signature: Cell::default(),
            last_generated: Cell::default(),
            last_decided: Cell::default(),
        }
    }

    pub(crate) fn begin_traversal(&mut self, tree: &Tree) {
        if self.last_visit.max(self.traversal) > 1 << 31 {
            self.update(tree);
            *self = Bloom::new();
        }
        self.traversal += 1;
        self.signatures.get_mut().1.clear();
        self.last_signature.take();
        self.last_generated.take();
        self.last_decided.take();
    }

    fn hash(key: Name) -> u32 {
        (key.bits() >> 20) as u32 | 1 << 31
    }

    fn slots(hash: u32) -> [usize; 2] {
        [hash as usize & 0x3fff, (hash >> 14) as usize & 0x3fff]
    }

    pub(crate) fn is_above(&self, tree: &Tree, id: NodeId) -> bool {
        self.path
            .last()
            .is_some_and(|it| *it == tree.flat_parent(id))
    }

    pub(crate) fn innermost(&self) -> NodeId {
        self.path.last().copied().unwrap_or(0)
    }

    pub(crate) fn depth(&self) -> usize {
        self.path.len()
    }

    pub(crate) fn push(&mut self, id: NodeId) {
        self.path.push(id);
    }

    pub(crate) fn truncate(&mut self, depth: usize) {
        self.path.truncate(depth);
        self.signatures.get_mut().1.truncate(depth);
        self.same = self.same.min(depth);
    }

    /// Before it is used.
    #[inline]
    pub(crate) fn update(&mut self, tree: &Tree) -> &Bloom {
        if (self.path.len(), self.known.len()) != (self.same, self.same) {
            self.follow_path(tree);
        }
        self
    }

    fn follow_path(&mut self, tree: &Tree) {
        let pairs = self.path[self.same..].iter().zip(&self.known[self.same..]);
        self.same += pairs
            .take_while(|(id, known)| **id == known.0 && tree.visit(known.0).get() == known.1)
            .count();
        for (id, visit) in self.known.drain(self.same..) {
            if tree.visit(id).get() == visit {
                tree.visit(id).set(0);
            }
        }
        let (pushed, marks) = self.pushed.get_mut();
        if let Some(mark) = marks.get(self.same).copied() {
            marks.truncate(self.same);
            for slot in pushed.drain(mark as usize..).flat_map(Bloom::slots) {
                self.counters[slot].update(|it| it - u8::from(it != u8::MAX));
            }
        }
        for id in &self.path[self.same..] {
            self.last_visit += 1;
            tree.visit(*id).set(self.last_visit);
            self.known.push((*id, self.last_visit));
        }
        self.is_counted.set(marks.len() == self.known.len());
        self.same = self.path.len();
    }

    /// Before it is asked many questions.
    pub(crate) fn count(&self, tree: &Tree) {
        if self.is_counted.replace(true) {
            return;
        }
        let (pushed, marks) = &mut *self.pushed.borrow_mut();
        for (id, _) in &self.known[marks.len()..] {
            marks.push(pushed.len() as u32);
            for hash in tree
                .element(*id)
                .into_iter()
                .flat_map(key::of_element)
                .map(Bloom::hash)
            {
                pushed.push(hash);
                Bloom::slots(hash)
                    .into_iter()
                    .for_each(|slot| self.counters[slot].update(|it| it.saturating_add(1)));
            }
        }
    }

    fn may_have_one(&self, hash: u32) -> bool {
        hash == 0
            || !self.is_counted.get()
            || Bloom::slots(hash)
                .iter()
                .all(|slot| self.counters[*slot].get() != 0)
    }

    fn may_match(&self, compound: &Compound) -> bool {
        match compound.required {
            0 if compound.filter == 0 => true,
            0 => compound.simples.iter().all(|it| match it {
                Simple::Is(list) => list.iter().any(|it| self.may_match(&it.compounds[0])),
                _ => true,
            }),
            required => self.may_have_one(required),
        }
    }

    /// Whether one of the selectors may match the element or one of its ancestors.
    pub(crate) fn may_have_match(&self, list: &[Selector], node: &Node) -> bool {
        let mut required = list.iter().map(|it| it.compounds[0].required);
        required.any(|it| self.may_have_one(it) || node.keys & filter_bit(it) != 0)
    }

    pub(crate) fn may_have(&self, hashes: &[u32; 3]) -> bool {
        hashes.iter().all(|hash| self.may_have_one(*hash))
    }
}

pub(crate) struct HasResult {
    pub(crate) has: Rc<Has>,
    pub(crate) host: NodeId,
    pub(crate) matched: bool,
}

/// What `:has()` has answered, for as long as that holds.
pub(crate) type HasResults = RefCell<Map<NodeId, Vec<HasResult>>>;

/// How many of the children that count are before each of them.
type Indices = Rc<Map<NodeId, u32>>;

/// What holds until the tree changes.
#[derive(Default)]
pub(crate) struct Found {
    /// By what counts, and by the parent and the nodes that the matcher refers to.
    indices: RefCell<Map<(u64, [NodeId; 5], bool), (Indices, Option<List>)>>,
    /// An element, and how many are before it.
    last_child: Cell<(NodeId, usize)>,
    pub(crate) selections: RefCell<Vec<crate::bindings::Selected>>,
    /// The first match, by `Of::key` and the root, as of `cleared`.
    firsts: [Cell<(u64, NodeId, u32, crate::bindings::Cell)>; 32],
    cleared: Cell<u32>,
    /// Of elements that have no style, as of `rules::last_version`.
    pub(crate) rules: RefCell<Map<NodeId, (u32, Rc<crate::cascade::RuleList>)>>,
    pub(crate) hidden: RefCell<Map<NodeId, crate::cascade::Hidden>>,
}

impl Found {
    pub(crate) fn clear(&self) {
        self.indices.take();
        self.last_child.take();
        self.selections.take();
        self.rules.take();
        self.hidden.take();
        self.cleared.update(|it| it.wrapping_add(1));
        if self.cleared.get() == 0 {
            self.firsts.iter().for_each(|it| _ = it.take());
        }
    }

    #[inline]
    pub(crate) fn first(&self, key: u64, root: NodeId) -> Option<crate::bindings::Cell> {
        let known = self.firsts[(key ^ u64::from(root)) as usize % 32].get();
        ((known.0, known.1, known.2) == (key, root, self.cleared.get())).then_some(known.3)
    }

    pub(crate) fn note_first(&self, key: u64, root: NodeId, first: crate::bindings::Cell) {
        self.firsts[(key ^ u64::from(root)) as usize % 32].set((
            key,
            root,
            self.cleared.get(),
            first,
        ));
    }
}

#[derive(Clone, Copy)]
pub(crate) struct Matcher<'a> {
    pub(crate) tree: &'a Tree,
    /// Of the shadow tree that the selector is in.
    pub(crate) host: NodeId,
    pub(crate) scope: NodeId,
    cut_at: NodeId,
    anchor: NodeId,
    record: Option<&'a HasResults>,
    /// For the subject.
    pub(crate) bloom: Option<&'a Bloom>,
    /// Whether a style depends on the result.
    pub(crate) notes: bool,
}

#[derive(PartialEq)]
enum Outcome {
    Matched,
    TryAnotherSibling,
    TryAnotherAncestor,
    Failed,
}

impl<'a> Matcher<'a> {
    pub(crate) fn new(
        tree: &'a Tree,
        host: NodeId,
        scope: NodeId,
        record: Option<&'a HasResults>,
    ) -> Self {
        Matcher {
            tree,
            host,
            scope,
            cut_at: tree.cut_at.get(),
            anchor: 0,
            bloom: None,
            notes: record.is_some(),
            record,
        }
    }

    pub(crate) fn any(&self, list: &[Selector], id: NodeId) -> bool {
        (list.iter()).any(|selector| selector.pseudo == Pseudo::None && self.matches(selector, id))
    }

    /// Does not look at the pseudo-element.
    pub(crate) fn matches(&self, selector: &Selector, id: NodeId) -> bool {
        self.chain(&selector.compounds, id) == Outcome::Matched
    }

    fn note(&self, id: NodeId, flags: Flags) {
        if self.notes {
            self.tree[id].set(flags);
        }
    }

    fn parent(&self, id: NodeId) -> NodeId {
        if id == self.host || id == self.cut_at {
            return 0;
        }
        let parent = self.tree[id].parent;
        match self.tree[parent].data {
            Data::Element(_) => parent,
            Data::ShadowRoot { host, .. } if host == self.host => host,
            Data::Root | Data::ShadowRoot { .. } if parent == self.scope => parent,
            _ => 0,
        }
    }

    /// Whether they can match an element that has the same signature.
    pub(crate) fn may_match(&self, compounds: &[Compound], id: NodeId) -> bool {
        let Some(element) = self.tree.element(id).filter(|_| id != self.host) else {
            return true;
        };
        let (compound, rest, above) = (&compounds[0], &compounds[1..], |id: &NodeId| {
            Some(self.parent(*id)).filter(|it| *it != 0)
        });
        compound.simples.iter().all(|it| match it {
            _ if it.follows_from_signature() => self.simple(it, element, id),
            Simple::Is(list) => list.iter().any(|it| self.may_match(&it.compounds, id)),
            _ => true,
        }) && match compound.combinator {
            _ if rest.is_empty() => true,
            Combinator::Child | Combinator::Descendant
                if rest.iter().all(Compound::follows_from_signature) =>
            {
                self.beyond(compounds, id) == Outcome::Matched
            }
            Combinator::Child => above(&id).is_some_and(|it| self.may_match(rest, it)),
            Combinator::Descendant => {
                core::iter::successors(above(&id), above).any(|it| self.may_match(&rest[..1], it))
            }
            _ => true,
        }
    }

    fn chain(&self, compounds: &[Compound], id: NodeId) -> Outcome {
        match self.compound(&compounds[0], id) {
            true => self.beyond(compounds, id),
            false => Outcome::TryAnotherSibling,
        }
    }

    /// `id` matches the first.
    #[inline]
    fn beyond(&self, compounds: &[Compound], id: NodeId) -> Outcome {
        let (compound, rest) = (&compounds[0], &compounds[1..]);
        let exhausted = match compound.combinator {
            Combinator::None => return Outcome::Matched,
            Combinator::Slot => {
                let slot = self.tree.slots(id).find(|it| {
                    self.host != 0 && self.tree.host_of(self.tree[*it].scope) == self.host
                });
                return slot.map_or(Outcome::Failed, |it| self.chain(rest, it));
            }
            Combinator::Part => {
                return if self.part(compound, rest, id) {
                    Outcome::Matched
                } else {
                    Outcome::Failed
                };
            }
            Combinator::Next => {
                self.note(self.tree[id].parent, Flags::NEXT_SIBLING);
                Outcome::TryAnotherAncestor
            }
            Combinator::Later => {
                self.note(self.tree[id].parent, Flags::LATER_SIBLINGS);
                Outcome::TryAnotherAncestor
            }
            Combinator::Descendant
                if let Some(bloom) = self.bloom
                    && let Some(outcome) = self.search_ancestors(bloom, rest, id) =>
            {
                return outcome;
            }
            _ => Outcome::Failed,
        };
        let mut candidate = id;
        loop {
            candidate = match compound.combinator {
                Combinator::Next | Combinator::Later if id == self.host || id == self.cut_at => 0,
                Combinator::Next | Combinator::Later => {
                    self.tree.previous_elements(candidate).next().unwrap_or(0)
                }
                _ => self.parent(candidate),
            };
            if candidate == 0 {
                return exhausted;
            }
            let outcome = self.chain(rest, candidate);
            match (&outcome, compound.combinator) {
                (Outcome::Matched | Outcome::Failed, _) | (_, Combinator::Next) => return outcome,
                (_, Combinator::Child) => return Outcome::TryAnotherAncestor,
                (Outcome::TryAnotherAncestor, Combinator::Later) => return outcome,
                _ => {}
            }
        }
    }

    fn part(&self, compound: &Compound, rest: &[Compound], id: NodeId) -> bool {
        let attribute = |id, name| {
            self.tree
                .element(id)
                .and_then(|it| it.attribute(name))
                .unwrap_or_default()
        };
        let wanted = || {
            compound.simples.iter().flat_map(|it| {
                if let Simple::Part(names) = it {
                    &names[..]
                } else {
                    &[]
                }
            })
        };
        let mut names: SmallVec<[&str; 2]> = attribute(id, name!("part"))
            .split_ascii_whitespace()
            .collect();
        self.tree.exporting_hosts(id).any(|host| {
            let is_visible =
                host == self.host || self.tree.host_of(self.tree[host].scope) == self.host;
            if is_visible
                && wanted().all(|it| names.iter().any(|name| Name::new(name.as_bytes()) == *it))
                && self.chain(rest, host) == Outcome::Matched
            {
                return true;
            }
            let mappings = strings::split(attribute(host, name!("exportparts")).as_bytes(), b",")
                .filter_map(|it| {
                    let (inner, outer) = strings::split_once_char(it, b':').unwrap_or((it, it));
                    let [inner, outer] =
                        [inner, outer].map(|it| crate::values::text(it.trim_ascii()));
                    (names.contains(&inner)
                        && !outer
                            .bytes()
                            .any(|it| it == b':' || it.is_ascii_whitespace()))
                    .then_some(outer)
                });
            names = mappings.collect();
            false
        })
    }

    /// For the shadow host, which is featureless. `None` if the selector is about something that it does not have.
    fn featureless(&self, compound: &Compound, element: &Element, id: NodeId) -> Option<bool> {
        let list = |list: &List| {
            let results = list.iter().filter_map(|it| match &it.compounds[..] {
                [only] => self.featureless(only, element, id),
                [subject, ..] => self.featureless(subject, element, id).map(|_| false),
                [] => None,
            });
            results.max()
        };
        let mut result = None;
        for simple in &compound.simples {
            let matches = match simple {
                Simple::Host(_) | Simple::HostContext(_) => self.simple(simple, element, id),
                Simple::Scope if id == self.scope => true,
                Simple::Anchor => id == self.anchor,
                Simple::Is(inner) => list(inner)?,
                Simple::Not(inner) => !list(inner)?,
                Simple::Namespace(_)
                    if compound
                        .simples
                        .iter()
                        .any(|it| matches!(it, Simple::Host(_) | Simple::HostContext(_))) =>
                {
                    continue;
                }
                Simple::Has(_) => continue,
                _ => return None,
            };
            result = Some(matches && result != Some(false));
        }
        let has = |it: &Simple| !matches!(it, Simple::Has(_)) || self.simple(it, element, id);
        result.map(|it| it && compound.simples.iter().all(has))
    }

    /// `None` if `bloom` does not know the parent.
    fn search_ancestors(
        &self,
        bloom: &Bloom,
        compounds: &[Compound],
        id: NodeId,
    ) -> Option<Outcome> {
        if !bloom.may_match(&compounds[0]) {
            return Some(Outcome::Failed);
        }
        let parent = self.parent(id);
        let (address, from) = (compounds.as_ptr().addr(), self.tree.visit(parent).get());
        (from != 0).then_some(())?;
        let slot = &bloom.searches[(address >> 4 ^ address >> 13) % bloom.searches.len()];
        let known = slot.get();
        let is_known = (known.compounds, known.scope, known.traversal)
            == (address, (self.host, self.scope), bloom.traversal);
        if is_known
            && known.found
            && known.visit <= from
            && self.tree.visit(known.node).get() == known.visit
        {
            return Some(Outcome::Matched);
        }
        let known = Search {
            traversal: bloom.traversal,
            ..known
        };
        let failed = if is_known && !known.found {
            known.visit
        } else {
            0
        };
        let mut at = parent;
        while at != 0 && self.tree.visit(at).get().wrapping_sub(1) >= failed {
            match self.chain(compounds, at) {
                Outcome::Matched => {
                    let visit = self.tree.visit(at).get();
                    slot.set(Search {
                        compounds: address,
                        scope: (self.host, self.scope),
                        node: at,
                        visit,
                        found: true,
                        ..known
                    });
                    return Some(Outcome::Matched);
                }
                Outcome::Failed => break,
                _ => at = self.parent(at),
            }
        }
        slot.set(Search {
            compounds: address,
            scope: (self.host, self.scope),
            node: parent,
            visit: from,
            found: false,
            ..known
        });
        Some(Outcome::Failed)
    }

    fn compound(&self, compound: &Compound, id: NodeId) -> bool {
        let node = &self.tree[id];
        if compound.filter != 0 && node.keys & compound.filter == 0 {
            return false;
        }
        let Some(element) = node.element() else {
            return matches!(compound.simples[..], [Simple::Scope]);
        };
        if id == self.host {
            return self.featureless(compound, element, id) == Some(true);
        }
        compound.simples.iter().all(|simple| match simple {
            Simple::Class(class) => element.classes().iter().any(|it| it == class),
            Simple::Tag(name, lower) if name == lower => element.tag == *name,
            _ => self.simple(simple, element, id),
        })
    }

    fn simple(&self, simple: &Simple, element: &Element, id: NodeId) -> bool {
        let is_html = element.namespace == Namespace::Html && !self.tree.is_xml;
        let pick = |name: Name, lower: Name| if is_html { lower } else { name };
        let outside = || Matcher {
            host: self.tree.host_of(self.tree[id].scope),
            ..*self
        };
        match simple {
            Simple::Class(class) => element.classes().contains(class),
            Simple::Id(name) => element.id == *name,
            Simple::Tag(name, lower) => element.tag == pick(*name, *lower),
            Simple::Exists(name, lower) => element.has(pick(*name, *lower)),
            Simple::Attribute(test) if test.key != Name::NONE => {
                element.attributes.iter().any(|it| {
                    it.key == test.key
                        && it.name == test.names.0
                        && *it.value.as_bytes() == *test.value
                })
            }
            Simple::Attribute(test) => (element.attribute(pick(test.names.0, test.names.1)))
                .is_some_and(|value| test.matches(value.as_bytes(), is_html)),
            Simple::Namespace(namespace) => element.namespace_uri() == &**namespace,
            Simple::AnyNamespace(it) => element.attributes.iter().any(|attribute| {
                let qualified = attribute.qualified();
                let local = strings::split_once_char(qualified.as_bytes(), b' ');
                (local.is_some_and(|local| {
                    local.0 == &*it.0 || is_html && local.0 == &*it.0.to_ascii_lowercase()
                }) || attribute.name == pick(Name::new(&it.0), it.1))
                    && it.2.as_ref().is_none_or(|test| {
                        test.matches(element.value_of(attribute).as_bytes(), is_html)
                    })
            }),
            Simple::State(state) => element.state.contains(*state),
            Simple::NotState(state) => !element.state.intersects(*state),
            Simple::CustomState(state) => element.custom_states.contains(state),
            Simple::TransitionClass(class) => self
                .tree
                .element(self.tree.matched_part.get())
                .is_some_and(|it| it.custom_states.contains(class)),
            Simple::Cue(list) => self.any(list, self.tree.matched_part.get()),
            Simple::RootOfCue => self.tree.is_root_of_cue(id),
            Simple::Root => self.tree.is_root_of_any(id),
            Simple::Scope if self.scope == 0 => self.tree.is_root(id),
            Simple::Scope => id == self.scope,
            Simple::Anchor => id == self.anchor,
            Simple::Never => false,
            Simple::Math => element.namespace == Namespace::MathMl,
            Simple::Base(flag) => self.tree[id].has(*flag),
            Simple::InBase => {
                let select = self
                    .tree
                    .flat_ancestors(id)
                    .find(|it| self.tree.html_tag(*it) == name!("select"));
                select.is_some_and(|it| self.tree[it].has(Flags::BASE_OPTIONS))
            }
            Simple::Html => element.namespace == Namespace::Html,
            Simple::InHtml => is_html,
            Simple::Native => element
                .style
                .as_ref()
                .is_some_and(|it| it.look != crate::theme::Look::None),
            Simple::Empty => {
                self.note(id, Flags::EMPTINESS);
                (self.tree.children(id)).all(|child| self.tree[child].text() == Some(&[]))
            }
            Simple::Lang(ranges) => {
                let mut at = id;
                let language = loop {
                    let Some(element) = self.tree.element(at) else {
                        break &*self.tree.language;
                    };
                    match element
                        .attribute(name!("lang http://www.w3.org/XML/1998/namespace"))
                        .or_else(|| {
                            element.attribute(name!("lang")).filter(|_| {
                                matches!(element.namespace, Namespace::Html | Namespace::Svg)
                                    || element.pseudo != Pseudo::None
                            })
                        }) {
                        Some(language) => break language,
                        None => at = self.tree.parent_or_host(at),
                    }
                };
                ranges
                    .iter()
                    .any(|range| dash_match(language.as_bytes(), range, true))
            }
            Simple::Nth(data, of) => self.nth(*data, of.as_ref(), element, id),
            Simple::Part(_) => element.has(name!("part")),
            Simple::Host(list) => {
                id == self.host && list.as_ref().is_none_or(|list| outside().any(list, id))
            }
            Simple::HostContext(list) => {
                id == self.host
                    && (core::iter::once(id).chain(self.tree.flat_ancestors(id)))
                        .any(|ancestor| outside().any(list, ancestor))
            }
            Simple::Is(list) => self.any(list, id),
            Simple::Not(list) => !self.any(list, id),
            Simple::Has(has) => {
                let Some(record) = self.record else {
                    return self.has(has, id);
                };
                let known = record.borrow().get(&id).and_then(|results| {
                    results
                        .iter()
                        .find(|it| it.has.id == has.id)
                        .map(|it| it.matched)
                });
                known.unwrap_or_else(|| {
                    let matched = self.has(has, id);
                    self.note(id, Flags::HAS_ANCHOR);
                    record.borrow_mut().entry(id).or_default().push(HasResult {
                        has: Rc::clone(has),
                        host: self.host,
                        matched,
                    });
                    matched
                })
            }
        }
    }

    pub(crate) fn has(&self, has: &Has, id: NodeId) -> bool {
        let inner = Matcher {
            anchor: id,
            bloom: None,
            ..*self
        };
        let tree = self.tree;
        let parent = match id == self.host {
            true => tree.element(id).map_or(0, |host| host.shadow_root),
            false => id,
        };
        has.relatives.iter().any(|relative| {
            let chain = &relative.compounds[..relative.compounds.len() - 1];
            let is = |combinator| {
                chain
                    .iter()
                    .all(|compound| compound.combinator == combinator)
            };
            let matches = |candidate| inner.matches(relative, candidate);
            match chain[chain.len() - 1].combinator {
                Combinator::Child if chain.len() == 1 => tree.element_children(parent).any(matches),
                Combinator::Next | Combinator::Later if id == self.host => false,
                Combinator::Next if is(Combinator::Next) => tree
                    .next_elements(id)
                    .nth(chain.len() - 1)
                    .is_some_and(matches),
                Combinator::Next | Combinator::Later => {
                    let descends = (chain.iter()).any(|it| {
                        matches!(it.combinator, Combinator::Child | Combinator::Descendant)
                    });
                    tree.next_elements(id).any(|sibling| match descends {
                        true => tree.descendants(sibling).any(matches),
                        false => matches(sibling),
                    })
                }
                _ => tree.descendants(parent).any(matches),
            }
        })
    }

    fn nth(&self, data: Nth, of: Option<&List>, element: &Element, id: NodeId) -> bool {
        let of_type = matches!(
            data.kind,
            NthKind::OfType | NthKind::LastOfType | NthKind::OnlyOfType
        );
        let is_edge = of.is_none() && !of_type && data.a == 0 && data.b == 1;
        let flag = if is_edge {
            Flags::EDGE_CHILDREN
        } else {
            Flags::CHILD_INDEX
        };
        self.note(self.tree[id].parent, flag);
        if is_edge {
            let (is_first, is_last) = (
                || self.tree.previous_elements(id).next().is_none(),
                || self.tree.next_elements(id).next().is_none(),
            );
            return id == self.cut_at
                || (data.kind == NthKind::LastChild || is_first())
                    && (data.kind == NthKind::Child || is_last());
        }
        if of.is_some_and(|list| !self.any(list, id)) {
            return false;
        }
        let counts = |sibling: &NodeId| match of {
            Some(list) => self.any(list, *sibling),
            None => {
                !of_type
                    || self.tree.element(*sibling).is_some_and(|it| {
                        it.tag == element.tag && it.namespace_uri() == element.namespace_uri()
                    })
            }
        };
        let (parent, limit) = (
            self.tree[id].parent,
            if id == self.cut_at {
                0
            } else if data.a <= 0 {
                data.b.max(0) as usize
            } else {
                usize::MAX
            },
        );
        let indices = |makes: bool| {
            let what = of.map_or_else(
                || {
                    if of_type {
                        element.tag.salted(element.namespace as u64).bits()
                    } else {
                        0
                    }
                },
                |it| (it.as_ptr().addr() as u64) << 4 | 15,
            );
            let key = (
                what,
                [parent, self.host, self.scope, self.cut_at, self.anchor],
                self.notes,
            );
            let known = self
                .tree
                .found()
                .indices
                .borrow()
                .get(&key)
                .map(|it| Rc::clone(&it.0));
            known.or_else(|| {
                let indices: Indices = Rc::new(makes.then(|| {
                    self.tree
                        .element_children(parent)
                        .filter(counts)
                        .zip(0..)
                        .collect()
                })?);
                self.tree
                    .found()
                    .indices
                    .borrow_mut()
                    .insert(key, (Rc::clone(&indices), of.cloned()));
                Some(indices)
            })
        };
        let can_index =
            limit != 0 && parent != 0 && (!of_type || element.namespace != Namespace::Other);
        let count = |siblings: &mut dyn Iterator<Item = NodeId>,
                     from_index: fn(usize, usize) -> usize| {
            let look_up = |all: Indices| {
                all.get(&id)
                    .map_or(0, |it| from_index(*it as usize, all.len()).min(limit))
            };
            if let Some(all) = can_index.then(|| indices(of.is_some())).flatten() {
                return look_up(all);
            }
            let found = (&mut *siblings)
                .take(if can_index { 24 } else { usize::MAX })
                .filter(counts)
                .take(limit)
                .count();
            if found == limit || siblings.next().is_none() {
                found
            } else {
                indices(true).map_or(0, look_up)
            }
        };
        let before = || {
            let count = || count(&mut self.tree.previous_elements(id), |index, _| index);
            if of.is_some() || of_type || limit != usize::MAX {
                return count();
            }
            let index = match self.tree.found().last_child.get() {
                (last, index) if last == id => index,
                (last, index) if self.tree.previous_elements(id).next() == Some(last) => index + 1,
                _ => count(),
            };
            self.tree.found().last_child.set((id, index));
            index
        };
        let after = || {
            count(&mut self.tree.next_elements(id), |index, all| {
                all - index - 1
            })
        };
        let index = 1 + match data.kind {
            NthKind::Child | NthKind::OfType => before(),
            NthKind::LastChild | NthKind::LastOfType => after(),
            NthKind::OnlyChild | NthKind::OnlyOfType => before() + after(),
        } as i64;
        match (i64::from(data.a), index - i64::from(data.b)) {
            (0, rest) => rest == 0,
            (a, rest) => rest % a == 0 && rest / a >= 0,
        }
    }
}

fn same(a: &[u8], b: &[u8], ignore_case: bool) -> bool {
    match ignore_case {
        true => a.eq_ignore_ascii_case(b),
        false => a == b,
    }
}

fn dash_match(value: &[u8], expected: &[u8], ignore_case: bool) -> bool {
    (value.split_at_checked(expected.len())).is_some_and(|(start, rest)| {
        same(start, expected, ignore_case) && matches!(rest, [] | [b'-', ..])
    })
}

impl AttributeTest {
    fn matches(&self, value: &[u8], is_html: bool) -> bool {
        let ignore_case = match self.case {
            Case::Ignored => true,
            Case::IgnoredInHtml => is_html,
            Case::Matters => false,
        };
        let expected = &*self.value;
        match self.operator {
            Operator::Equal => same(value, expected, ignore_case),
            Operator::DashMatch => dash_match(value, expected, ignore_case),
            _ if expected.is_empty() || value.len() < expected.len() => false,
            Operator::Includes => strings::tokenize_any(value, b" \t\n\r\x0c")
                .any(|word| same(word, expected, ignore_case)),
            Operator::Prefix => same(&value[..expected.len()], expected, ignore_case),
            Operator::Suffix => same(
                &value[value.len() - expected.len()..],
                expected,
                ignore_case,
            ),
            Operator::Substring if ignore_case => {
                strings::contains(&value.to_ascii_lowercase(), &expected.to_ascii_lowercase())
            }
            Operator::Substring => strings::contains(value, expected),
        }
    }
}
