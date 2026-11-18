//! A pattern for one width of subject: code units in the order in which they are matched.

use core::ops::{Index, IndexMut, Range};

use super::memory::{push, reserve};
use crate::Error;
use crate::analysis::Next;
use crate::program::{ClassId, Direction, MAX_LENGTH, Pairs, UNBOUNDED, Width};
pub(crate) use crate::program::{Step, masked_units};
use crate::set::Set;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) struct Id(u32);

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) struct Span {
    start: u32,
    end: u32,
}

impl Span {
    pub(crate) fn new(range: Range<usize>) -> Span {
        Span {
            start: range.start as u32,
            end: range.end as u32,
        }
    }

    #[inline]
    pub(crate) fn range(self) -> Range<usize> {
        self.start as usize..self.end as usize
    }

    #[inline]
    pub(crate) fn len(self) -> usize {
        (self.end - self.start) as usize
    }
}

/// How the turns of a repeated group are gone back into.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Form {
    Undecided,
    /// Never.
    Possessive,
    /// All have the same length and one way to match.
    Stepped,
    /// All have one way to match, and the loop is lazy.
    Extended,
    Stacked,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Kind {
    Empty,
    Fail,
    Accept,
    Steps(Span),
    StepCount {
        class: ClassId,
        count: u32,
    },
    Pair(ClassId),
    CodePoint(ClassId),
    Open(u16),
    Close(u16),
    Clear(Pairs),
    /// That side of the subject.
    Edge(Direction),
    /// Tests the unit on that side.
    Peek {
        side: Direction,
        step: Step,
        or_edge: bool,
    },
    Boundary {
        word: ClassId,
        other: ClassId,
        negated: bool,
    },
    BackReference {
        pairs: Span,
        ignore_case: bool,
    },
    /// The innermost `Turn` has passed something, or is allowed not to.
    NotEmpty,
    Sequence(Span),
    Alternation(Span),
    /// Up to `max` characters.
    Run {
        class: ClassId,
        max: u32,
        code_points: bool,
        greedy: bool,
        /// Greedy: what has to come next where it gives back. Lazy: the members that it can pass at once.
        filter: Option<ClassId>,
        /// Each member stands for a turn that is counted.
        is_counted: bool,
    },
    Repeat {
        body: Id,
        min: u32,
        max: u32,
        greedy: bool,
        form: Form,
        /// Its turns are among those of which a match can take too many.
        is_counted: bool,
    },
    Turn(Id),
    Look {
        body: Id,
        direction: Direction,
        negated: bool,
    },
}

bitflags::bitflags! {
    #[derive(Clone, Copy, PartialEq, Eq, Debug)]
    pub(crate) struct Traits: u16 {
        /// Can succeed whatever comes next.
        const OPEN = 1 << 0;
        const CANNOT_FAIL = 1 << 1;
        /// Only tests at known offsets, with a known offset at the end.
        const RIGID = 1 << 2;
        /// Success ends the match.
        const ACCEPTS = 1 << 3;
        /// Sets a capture that a back reference reads.
        const REFERENCED = 1 << 4;
        /// Has to be gone back into when what follows fails.
        const REENTERED = 1 << 5;
        /// Can leave frames on the stack.
        const FRAMES = 1 << 6;
        /// Drops the frames that it has pushed when it succeeds.
        const CUTS = 1 << 7;
        /// An alternative that starts with nothing that a later one starts with.
        const EXCLUSIVE = 1 << 8;
        /// An alternative whose successors have to be tried when what follows fails.
        const CONTINUED = 1 << 9;
        /// An alternative that starts with nothing that those do which follow up to the first without this trait.
        const DIFFERS_FROM_NEXT = 1 << 10;
        /// Sets the start or the end of a capture, which need not be among its pairs.
        const WRITES = 1 << 11;
        /// A run that gives nothing back.
        const KEEPS_ALL = 1 << 12;
        /// Looks around further than `NEAR`, or has a loop.
        const TAKES_LONG = 1 << 13;
        /// A run or a loop that is followed by something that can fail.
        const CAN_BE_IN_VAIN = 1 << 14;
        /// Is in a copy of a group that stands for a turn which is counted.
        const COUNTS_TURN = 1 << 15;
    }
}

const INHERITED: Traits = Traits::WRITES
    .union(Traits::REFERENCED)
    .union(Traits::TAKES_LONG);

#[derive(Clone, Copy, Debug)]
pub(crate) struct Node {
    pub(crate) kind: Kind,
    pub(crate) min: u32,
    pub(crate) max: u32,
    /// Success writes them all, but for those that are never set.
    pub(crate) pairs: Pairs,
    pub(crate) traits: Traits,
    /// Of a rigid node: no offset that it tests is further away.
    reach: u16,
    first: u32,
}

impl Node {
    #[inline]
    pub(crate) fn is(&self, traits: Traits) -> bool {
        self.traits.contains(traits)
    }

    /// How far it can get, if that is a measure of the work.
    pub(crate) fn extent(&self) -> u32 {
        match self.is(Traits::TAKES_LONG) {
            true => UNBOUNDED,
            false => self.max,
        }
    }

    /// Passes nothing, tests nothing.
    pub(crate) fn is_bookkeeping(&self) -> bool {
        matches!(self.kind, Kind::Open(_) | Kind::Close(_) | Kind::Clear(_))
    }

    fn leaf(kind: Kind) -> Node {
        const PASSIVE: Traits = Traits::OPEN.union(Traits::CANNOT_FAIL).union(Traits::RIGID);
        let one = |pair| Pairs {
            first: pair,
            end: pair + 1,
        };
        let (min, max, traits, pairs) = match kind {
            Kind::Empty => (0, 0, PASSIVE, Pairs::NONE),
            Kind::Open(pair) | Kind::Close(pair) => (0, 0, PASSIVE | Traits::WRITES, one(pair)),
            Kind::Clear(pairs) => (0, 0, PASSIVE | Traits::WRITES, pairs),
            Kind::Fail => (0, 0, Traits::RIGID, Pairs::NONE),
            Kind::Accept => {
                let traits = Traits::CANNOT_FAIL | Traits::RIGID | Traits::ACCEPTS;
                (0, 0, traits, Pairs::NONE)
            }
            Kind::Steps(Span { start, end }) => {
                (end - start, end - start, Traits::RIGID, Pairs::NONE)
            }
            Kind::StepCount { count, .. } if count > NEAR => {
                (count, count, Traits::empty(), Pairs::NONE)
            }
            Kind::StepCount { count, .. } => (count, count, Traits::RIGID, Pairs::NONE),
            Kind::Pair(_) => (2, 2, Traits::RIGID, Pairs::NONE),
            Kind::CodePoint(_) => (1, 2, Traits::empty(), Pairs::NONE),
            Kind::Edge(_) | Kind::Peek { .. } | Kind::Boundary { .. } => {
                (0, 0, Traits::OPEN | Traits::RIGID, Pairs::NONE)
            }
            Kind::BackReference { .. } => (0, UNBOUNDED, Traits::OPEN, Pairs::NONE),
            Kind::NotEmpty => (0, 0, Traits::OPEN, Pairs::NONE),
            Kind::Run {
                max, code_points, ..
            } => {
                let units = max.saturating_mul(if code_points { 2 } else { 1 });
                (0, units, Traits::OPEN | Traits::CANNOT_FAIL, Pairs::NONE)
            }
            Kind::Sequence(_)
            | Kind::Alternation(_)
            | Kind::Repeat { .. }
            | Kind::Turn(_)
            | Kind::Look { .. } => unreachable!("the node has children"),
        };
        let reach = reach(max.max(1));
        Node {
            kind,
            min,
            max,
            pairs,
            traits: match reach {
                Some(_) => traits,
                None => traits - Traits::RIGID,
            },
            reach: reach.unwrap_or(0),
            first: FIRST_IS_NOT_STORED,
        }
    }
}

pub(crate) const MAX_REACH: u32 = 1 << 10;
/// Going back this far need not count as work.
pub(crate) const NEAR: u32 = 64;
const CLASSES_COMPARED: usize = 16;
const FIRST_IS_NOT_STORED: u32 = u32::MAX;

pub(crate) struct Graph {
    nodes: Vec<Node>,
    pub(crate) children: Vec<Id>,
    pub(crate) steps: Vec<Step>,
    pub(crate) referenced_pairs: Vec<u16>,
    pub(crate) classes: Vec<Set>,
    units_of_classes: Vec<Next>,
    firsts: Vec<Next>,
    pub(crate) width: Width,
}

impl Index<Id> for Graph {
    type Output = Node;

    #[inline]
    fn index(&self, id: Id) -> &Node {
        &self.nodes[id.0 as usize]
    }
}

impl IndexMut<Id> for Graph {
    #[inline]
    fn index_mut(&mut self, id: Id) -> &mut Node {
        &mut self.nodes[id.0 as usize]
    }
}

impl Index<ClassId> for Graph {
    type Output = Set;

    #[inline]
    fn index(&self, id: ClassId) -> &Set {
        &self.classes[id.index()]
    }
}

fn reach(units: u32) -> Option<u16> {
    (units <= MAX_REACH).then_some(units as u16)
}

impl Graph {
    pub(crate) const EMPTY: Id = Id(0);
    pub(crate) const FAIL: Id = Id(1);

    pub(super) const fn new() -> Graph {
        Graph {
            nodes: Vec::new(),
            children: Vec::new(),
            steps: Vec::new(),
            referenced_pairs: Vec::new(),
            classes: Vec::new(),
            units_of_classes: Vec::new(),
            firsts: Vec::new(),
            width: Width::Latin1,
        }
    }

    pub(super) fn start(&mut self, width: Width, expected_nodes: usize) -> Result<(), Error> {
        self.nodes.clear();
        self.children.clear();
        self.steps.clear();
        self.referenced_pairs.clear();
        self.classes.clear();
        self.units_of_classes.clear();
        self.firsts.clear();
        self.width = width;
        reserve(&mut self.nodes, expected_nodes + 2)?;
        reserve(&mut self.children, expected_nodes)?;
        self.leaf(Kind::Empty)?;
        self.leaf(Kind::Fail).map(drop)
    }

    /// About, in nodes.
    pub(super) fn capacity(&self) -> usize {
        self.nodes.capacity() + self.steps.capacity() / 4
    }

    #[inline]
    pub(crate) fn node_count(&self) -> usize {
        self.nodes.len()
    }

    pub(crate) fn reference_count(&self) -> usize {
        let is_reference = |node: &&Node| matches!(node.kind, Kind::BackReference { .. });
        self.nodes.iter().filter(is_reference).count()
    }

    #[inline]
    pub(crate) fn children_of(&self, span: Span) -> &[Id] {
        &self.children[span.range()]
    }

    /// The children of a sequence, or the node itself.
    pub(crate) fn terms<'a>(&'a self, id: &'a Id) -> &'a [Id] {
        match self[*id].kind {
            Kind::Sequence(children) => self.children_of(children),
            _ => core::slice::from_ref(id),
        }
    }

    pub(crate) fn add_class(&mut self, set: Set) -> Result<ClassId, Error> {
        let set = match self.width {
            Width::Latin1 => Set::from_latin1(*set.latin1()),
            Width::Utf16 => set,
        };
        let recent = self.classes.len().saturating_sub(CLASSES_COMPARED);
        if let Some(index) = self.classes[recent..].iter().position(|it| *it == set) {
            return Ok(ClassId((recent + index) as u32));
        }
        let mut units = Next::from_latin1(*set.latin1());
        for &range in set.above() {
            units.insert_wide(range);
        }
        push(&mut self.units_of_classes, units)?;
        push(&mut self.classes, set)?;
        Ok(ClassId(self.classes.len() as u32 - 1))
    }

    /// The members that fit in a unit.
    #[inline]
    pub(crate) fn units_of(&self, class: ClassId) -> &Next {
        &self.units_of_classes[class.index()]
    }

    pub(crate) fn units_of_step(&self, step: Step) -> Next {
        match step {
            Step::Class(class) => *self.units_of(class),
            Step::Unit { value, mask: 0 } => Next::of_unit(value),
            Step::Unit { mask, .. } if mask == self.width.max_unit() => Next::ANY_UNIT,
            Step::Unit { value, mask } => {
                let units = masked_units(value, mask).map(Next::of_unit);
                units.fold(Next::NOTHING, |all, it| all | it)
            }
        }
    }

    /// What can come next where the node succeeds, unless it is open.
    pub(crate) fn first(&self, id: Id) -> Next {
        let node = &self[id];
        match node.kind {
            _ if node.first != FIRST_IS_NOT_STORED => self.firsts[node.first as usize],
            Kind::Steps(steps) => self.units_of_step(self.steps[steps.range().start]),
            Kind::StepCount { class, .. } => *self.units_of(class),
            Kind::Run { class, .. } => *self.units_of(class),
            Kind::Turn(body) => self.first(body),
            Kind::Accept | Kind::BackReference { .. } => Next::ANYTHING,
            _ => Next::NOTHING,
        }
    }

    /// What can come next where the node and what follows it succeed.
    pub(crate) fn first_before(&self, id: Id, after: &Next) -> Next {
        let (node, first) = (&self[id], self.first(id));
        if node.is(Traits::OPEN) {
            first | *after
        } else if node.max == 0 {
            first & *after
        } else {
            first
        }
    }

    fn add(&mut self, node: Node) -> Result<Id, Error> {
        if node.min > MAX_LENGTH {
            return Ok(Graph::FAIL);
        }
        push(&mut self.nodes, node)?;
        Ok(Id(self.nodes.len() as u32 - 1))
    }

    fn store_first(&mut self, first: Next) -> Result<u32, Error> {
        push(&mut self.firsts, first)?;
        Ok(self.firsts.len() as u32 - 1)
    }

    pub(crate) fn duplicate(&mut self, id: Id) -> Result<Id, Error> {
        self.add(self[id])
    }

    /// A node without children.
    pub(crate) fn leaf(&mut self, kind: Kind) -> Result<Id, Error> {
        self.add(Node::leaf(kind))
    }

    /// One that succeeds only where something in `first` comes next.
    pub(crate) fn closed_leaf(&mut self, kind: Kind, first: Next) -> Result<Id, Error> {
        let id = self.leaf_with_first(kind, first)?;
        self[id].traits.remove(Traits::OPEN);
        Ok(id)
    }

    pub(crate) fn set_first(&mut self, id: Id, first: Next) -> Result<(), Error> {
        self[id].first = self.store_first(first)?;
        Ok(())
    }

    pub(crate) fn leaf_with_first(&mut self, kind: Kind, first: Next) -> Result<Id, Error> {
        let id = self.leaf(kind)?;
        self.set_first(id, first)?;
        Ok(id)
    }

    pub(crate) fn add_steps(
        &mut self,
        steps: impl ExactSizeIterator<Item = Step>,
    ) -> Result<Id, Error> {
        let start = self.steps.len();
        reserve(&mut self.steps, steps.len())?;
        self.steps.extend(steps);
        self.leaf(Kind::Steps(Span::new(start..self.steps.len())))
    }

    fn add_children(&mut self, children: &[Id]) -> Result<Span, Error> {
        let start = self.children.len();
        reserve(&mut self.children, children.len())?;
        self.children.extend_from_slice(children);
        Ok(Span::new(start..self.children.len()))
    }

    /// Adds what `term` consists of to the terms of a sequence, which start at `start`.
    pub(crate) fn push_term(
        &mut self,
        terms: &mut Vec<Id>,
        start: usize,
        term: Id,
    ) -> Result<(), Error> {
        match self[term].kind {
            Kind::Empty => Ok(()),
            Kind::Sequence(children) => children
                .range()
                .try_for_each(|child| self.push_term(terms, start, self.children[child])),
            kind => {
                if let Some(&last) = terms[start..].last()
                    && let Some(joined) = join_terms(self[last].kind, kind)
                {
                    self[last] = Node::leaf(joined);
                    return Ok(());
                }
                push(terms, term)
            }
        }
    }

    /// None of the terms is empty or a sequence.
    pub(crate) fn sequence(&mut self, terms: &[Id]) -> Result<Id, Error> {
        match *terms {
            [] => Ok(Graph::EMPTY),
            [only] => Ok(only),
            _ if terms.contains(&Graph::FAIL) => Ok(Graph::FAIL),
            _ => {
                let children = self.add_children(terms)?;
                let (mut node, first) = self.summarize_sequence(children);
                node.first = self.store_first(first)?;
                self.add(node)
            }
        }
    }

    /// The least and the most that the terms pass together.
    pub(crate) fn lengths(&self, terms: &[Id]) -> (u32, u32) {
        terms.iter().fold((0, 0), |(min, max), &term| {
            let term = &self[term];
            (min.saturating_add(term.min), max.saturating_add(term.max))
        })
    }

    /// And whether the sequence is open.
    pub(super) fn first_of_terms(&self, terms: &[Id]) -> (Next, bool) {
        let (mut first, mut allowed) = (Next::NOTHING, None);
        for &term in terms {
            let (node, own) = (&self[term], self.first(term));
            let own = allowed.map_or(own, |allowed| own & allowed);
            if node.is(Traits::OPEN) {
                first = first | own;
            } else if node.max == 0 {
                allowed = Some(own);
            } else {
                return (first | own, false);
            }
        }
        allowed.map_or((first, true), |allowed| (first | allowed, false))
    }

    fn summarize_sequence(&self, children: Span) -> (Node, Next) {
        let (mut min, mut max, mut extent) = (0u32, 0u32, 0u32);
        let (mut all, mut any, mut pairs) = (Traits::all(), Traits::empty(), Pairs::NONE);
        for &child in self.children_of(children) {
            let child = &self[child];
            min = min.saturating_add(child.min);
            max = max.saturating_add(child.max);
            extent = extent.saturating_add(child.reach.into());
            all &= child.traits;
            any |= child.traits;
            pairs = pairs.hull(child.pairs);
        }
        let mut traits =
            all & (Traits::CANNOT_FAIL | Traits::RIGID) | any & (Traits::ACCEPTS | INHERITED);
        traits.set(
            Traits::RIGID,
            all.contains(Traits::RIGID) && extent <= MAX_REACH,
        );
        let (first, is_open) = self.first_of_terms(self.children_of(children));
        traits.set(Traits::OPEN, is_open);
        let node = Node {
            kind: Kind::Sequence(children),
            min,
            max,
            pairs,
            traits,
            reach: reach(extent).unwrap_or(0),
            first: FIRST_IS_NOT_STORED,
        };
        (node, first)
    }

    /// None of the alternatives is `FAIL`.
    pub(crate) fn alternation(&mut self, alternatives: &[Id]) -> Result<Id, Error> {
        match *alternatives {
            [] => Ok(Graph::FAIL),
            [only] => Ok(only),
            _ => {
                let children = self.add_children(alternatives)?;
                for index in children.range() {
                    if self.children[index] == Graph::EMPTY {
                        self.children[index] = self.duplicate(Graph::EMPTY)?;
                    }
                }
                let (mut node, first) = self.summarize_alternation(children);
                node.first = self.store_first(first)?;
                self.add(node)
            }
        }
    }

    fn summarize_alternation(&self, children: Span) -> (Node, Next) {
        let (mut min, mut max, mut extent, mut first) = (u32::MAX, 0, 0, Next::NOTHING);
        let (mut all, mut any, mut pairs) = (Traits::all(), Traits::empty(), Pairs::NONE);
        for &child in self.children_of(children) {
            first = first | self.first(child);
            let child = &self[child];
            min = min.min(child.min);
            max = max.max(child.max);
            extent = extent.max(child.reach);
            all &= child.traits;
            any |= child.traits;
            pairs = pairs.hull(child.pairs);
        }
        let mut traits =
            all & Traits::ACCEPTS | any & (Traits::OPEN | Traits::CANNOT_FAIL | INHERITED);
        let ends_alike =
            min == max && !any.contains(Traits::WRITES) || all.contains(Traits::ACCEPTS);
        traits.set(Traits::RIGID, all.contains(Traits::RIGID) && ends_alike);
        let node = Node {
            kind: Kind::Alternation(children),
            min,
            max,
            pairs,
            traits,
            reach: extent,
            first: FIRST_IS_NOT_STORED,
        };
        (node, first)
    }

    /// After its children have changed.
    pub(crate) fn refresh(&mut self, id: Id) {
        let old = self[id];
        let (new, first) = match old.kind {
            Kind::Sequence(children) => self.summarize_sequence(children),
            Kind::Alternation(children) => self.summarize_alternation(children),
            _ => unreachable!("the node has no list of children"),
        };
        self.firsts[old.first as usize] = first;
        self[id] = Node {
            first: old.first,
            traits: new.traits | old.traits & (Traits::DIFFERS_FROM_NEXT | Traits::COUNTS_TURN),
            ..new
        };
    }

    pub(crate) fn repeat(
        &mut self,
        body: Id,
        min: u32,
        max: u32,
        greedy: bool,
        is_counted: bool,
    ) -> Result<Id, Error> {
        let of_body = self[body];
        let mut traits = of_body.traits & (Traits::OPEN | Traits::CANNOT_FAIL | INHERITED);
        traits |= Traits::TAKES_LONG;
        if min == 0 {
            traits |= Traits::OPEN | Traits::CANNOT_FAIL;
        }
        let first = self.first(body);
        let node = Node {
            kind: Kind::Repeat {
                body,
                min,
                max,
                greedy,
                form: Form::Undecided,
                is_counted,
            },
            min: of_body.min.saturating_mul(min),
            max: of_body.max.saturating_mul(max),
            pairs: of_body.pairs,
            traits,
            reach: 0,
            first: self.store_first(first)?,
        };
        self.add(node)
    }

    /// `body` ends in `NotEmpty` wherever it can be empty.
    pub(crate) fn turn(&mut self, body: Id, can_be_empty: bool) -> Result<Id, Error> {
        let of_body = self[body];
        let mut traits = of_body.traits & INHERITED;
        traits.set(Traits::OPEN, can_be_empty && of_body.is(Traits::OPEN));
        self.add(Node {
            kind: Kind::Turn(body),
            min: (!can_be_empty).into(),
            traits,
            ..of_body
        })
    }

    /// Captures the unit that was passed last in the direction.
    pub(crate) fn capture_unit_passed(
        &mut self,
        open: Id,
        close: Id,
        direction: Direction,
    ) -> Result<Id, Error> {
        let max = self.width.max_unit();
        let any = Step::Unit {
            value: max,
            mask: max,
        };
        let unit = self.add_steps([any].into_iter())?;
        let body = self.sequence(&[open, unit, close])?;
        self[body].traits |= Traits::CANNOT_FAIL;
        self.look(body, direction.opposite(), false, false)
    }

    /// `constrains` if what the body starts with has to come next in the direction of what is around it.
    pub(crate) fn look(
        &mut self,
        body: Id,
        direction: Direction,
        negated: bool,
        constrains: bool,
    ) -> Result<Id, Error> {
        let of_body = self[body];
        let mut traits = of_body.traits & Traits::RIGID;
        if !negated {
            traits |= of_body.traits & (Traits::WRITES | Traits::REFERENCED);
        }
        traits.set(Traits::TAKES_LONG, of_body.extent() > NEAR);
        traits.set(
            Traits::CANNOT_FAIL,
            !negated && of_body.is(Traits::CANNOT_FAIL),
        );
        traits.set(Traits::OPEN, !constrains);
        let first = match constrains {
            true => self.first(body),
            false => Next::NOTHING,
        };
        let node = Node {
            kind: Kind::Look {
                body,
                direction,
                negated,
            },
            min: 0,
            max: 0,
            pairs: if negated { Pairs::NONE } else { of_body.pairs },
            traits,
            reach: of_body.reach,
            first: self.store_first(first)?,
        };
        self.add(node)
    }
}

fn join_terms(first: Kind, second: Kind) -> Option<Kind> {
    match (first, second) {
        (Kind::Steps(a), Kind::Steps(b)) if a.end == b.start => Some(Kind::Steps(Span {
            start: a.start,
            end: b.end,
        })),
        (
            Kind::Run {
                class,
                max,
                code_points: false,
                greedy,
                filter,
                is_counted,
            },
            Kind::Run {
                class: other_class,
                max: more,
                code_points: false,
                greedy: other_greedy,
                ..
            },
        ) if (class, greedy) == (other_class, other_greedy) => Some(Kind::Run {
            class,
            max: max.saturating_add(more),
            code_points: false,
            greedy,
            filter,
            is_counted,
        }),
        _ => None,
    }
}
