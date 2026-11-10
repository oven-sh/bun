use super::answers::{CheckedType, ClassRef, GaveUp, MemberLookup, QueryLimit};
use super::builtin_types::BuiltinClassIndex;
use super::prototype_links::{NamedValue, PrototypeOperation};
use super::queries::{GivenProduct, Queries};
use super::type_identity::ObjectOrigin;
use super::type_shape::ShapeKind;
use crate::atom::{Atom, known};
use crate::bind::{Binding, Bound, Decl, FnOwner, Parent, PatParent, StoreKind, SymbolId};
use crate::check::root_declaration;
use crate::check::shape::PropertyHolder;
use crate::hir::{
    self, BinOp, CallId, Chain, ClassId, ExprFlags, ExprId, ExprKind, ExprTag, Flags, FnBody, FnId,
    FnKind, MemberKey, ParamId, PatId, PatKind, PropId, PropKey, PropKind, StmtId, StmtKind, UnOp,
    VarKind,
};
use crate::program::{FileId, FileRole};
use crate::session::vec_from_iter_in;
use crate::types::{
    MapperId, Prop, PropFlags, PropSource, Shape, SigId, SigParam, TypeData, TypeId,
};
use crate::util::{FxHashMap, FxHashSet};
use bun_sort_by_number::{SortByNumber, number_of_pair};
use smallvec::SmallVec;
use std::cell::{Cell, RefCell};
use std::rc::Rc;

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub(super) enum Subject {
    Binding(SymbolId),
    Pattern(PatId),
    This(FnId),
    Field(u32),
    Result(FnId),
    Expression(ExprId),
    Number(SymbolId),
}

pub(super) enum UsageState {
    InProgress {
        index: usize,
        assumed: Option<Rc<Usage>>,
    },
    InCycle {
        index: usize,
        found: Rc<Usage>,
    },
    Assumed(Rc<Usage>),
    Known(Rc<Usage>),
    NotKept,
}

#[derive(Copy, Clone)]
pub(super) enum TypeState {
    Searched { index: u32 },
    Alone,
    Member { cycle: u32 },
    InProgress { depth: u32, assumed: Option<TypeId> },
    InCycle { found: TypeId, position: u32 },
    Assumed(TypeId),
    Known(TypeId),
    NotKept,
}

type Subjects = SmallVec<[Subject; 4]>;

struct SubjectSearched {
    subject: Subject,
    index: u32,
    lowest_index: u32,
    asks_for: Subjects,
    next: usize,
}

impl TypeState {
    fn was_computed(self) -> bool {
        !matches!(
            self,
            TypeState::Searched { .. } | TypeState::Alone | TypeState::Member { .. }
        )
    }
}

#[derive(Default)]
struct SubjectStack {
    depth: usize,
    outermost_revisited: Option<usize>,
}

struct EnteredSubject {
    depth: usize,
    revisited_earlier: Option<usize>,
}

impl SubjectStack {
    fn enter(&mut self) -> EnteredSubject {
        let entered = EnteredSubject {
            depth: self.depth,
            revisited_earlier: self.outermost_revisited.take(),
        };
        self.depth += 1;
        entered
    }

    fn revisit(&mut self, depth: usize) {
        let outermost = self
            .outermost_revisited
            .map_or(depth, |other| other.min(depth));
        self.outermost_revisited = Some(outermost);
    }

    #[allow(clippy::needless_pass_by_value)]
    fn leave(&mut self, entered: EnteredSubject) -> bool {
        self.depth = entered.depth;
        let outer = self
            .outermost_revisited
            .filter(|&depth| depth < entered.depth);
        self.outermost_revisited = entered.revisited_earlier;
        if let Some(depth) = outer {
            self.revisit(depth);
        }
        outer.is_some()
    }
}

#[derive(Default)]
pub(super) struct TypesInProgress {
    subjects: SubjectStack,
    remaining_types: u64,
    in_cycles: Vec<Subject>,
    first_in_cycle: Vec<usize>,
    out_of_reach: Vec<Subject>,
    is_computing_again: bool,
    subjects_not_kept: u64,
    next_usage_index: usize,
    cycles: Vec<Option<Box<[Subject]>>>,
}

impl TypesInProgress {
    fn enter(&mut self) -> EnteredSubject {
        self.first_in_cycle.push(self.in_cycles.len());
        self.subjects.enter()
    }

    fn leave(&mut self, entered: EnteredSubject) -> bool {
        self.first_in_cycle.pop();
        self.subjects.leave(entered)
    }

    fn revisit_in_cycle(&mut self, position: u32) {
        let entered_earlier = self
            .first_in_cycle
            .partition_point(|&first| first <= position as usize);
        self.subjects.revisit(entered_earlier.saturating_sub(1));
    }
}

#[derive(Default)]
pub(super) struct ReferenceIndex<'c> {
    to_bindings: Option<&'c [(SymbolId, ExprId)]>,
    to_this: Option<&'c [(FnId, ExprId)]>,
}

fn references_to<K: Copy + Ord>(references: &[(K, ExprId)], subject: K) -> &[(K, ExprId)] {
    let start = references.partition_point(|reference| reference.0 < subject);
    let len = references[start..].partition_point(|reference| reference.0 == subject);
    &references[start..start + len]
}

fn grouped_by_symbol(references: &[(SymbolId, ExprId)]) -> Vec<(SymbolId, ExprId)> {
    let symbol_counts = references.iter().map(|reference| reference.0.idx() + 1);
    let mut next_places = vec![0u32; symbol_counts.max().unwrap_or(0)];
    for reference in references {
        next_places[reference.0.idx()] += 1;
    }
    let mut first_place = 0;
    for next_place in &mut next_places {
        let count = *next_place;
        *next_place = first_place;
        first_place += count;
    }
    let mut grouped = references.to_vec();
    for &reference in references {
        let next_place = &mut next_places[reference.0.idx()];
        grouped[*next_place as usize] = reference;
        *next_place += 1;
    }
    grouped
}

bitflags::bitflags! {
    #[derive(Copy, Clone, PartialEq, Eq, Debug, Default)]
    struct Facts: u16 {
        const NUMBER = 1 << 0;
        const INT32 = 1 << 1;
        const KEY = 1 << 2;
        const STRING = 1 << 3;
        const FUNCTION = 1 << 4;
        const OBJECT = 1 << 5;
        const STORED = 1 << 6;
        const REQUIRED = 1 << 7;
        const INCOMPLETE = 1 << 8;
        const NUMBER_AT_EVERY_VALUE = 1 << 9 | Self::NUMBER.bits();
        const OBJECT_LITERAL_STORED = 1 << 10;
        const UINT32_STORED = 1 << 11;
    }
}

fn first_bytes_of(name: &[u8]) -> u64 {
    let mut first = [0; 8];
    let count = name.len().min(8);
    first[..count].copy_from_slice(&name[..count]);
    u64::from_be_bytes(first)
}

fn required_if(is_required: bool) -> Facts {
    match is_required {
        true => Facts::REQUIRED,
        false => Facts::empty(),
    }
}

#[derive(Clone, PartialEq, Eq)]
pub(super) struct Member {
    name: Atom,
    usage: Rc<Usage>,
}

impl Member {
    fn is_called(&self) -> bool {
        self.usage.facts.contains(Facts::FUNCTION)
    }
}

#[derive(Clone)]
enum Members {
    Few(Vec<Member>),
    Many(ManyMembers),
}

#[derive(Clone)]
struct ManyMembers {
    by_name: Rc<MembersByName>,
    order: Rc<OrderOfNames>,
}

#[derive(Clone, Default)]
struct OrderOfNames {
    pieces: Vec<PieceOfOrder>,
    weight: u64,
}

#[derive(Clone)]
enum PieceOfOrder {
    Name(Atom),
    All(Rc<OrderOfNames>),
}

impl Drop for OrderOfNames {
    fn drop(&mut self) {
        let mut pending = std::mem::take(&mut self.pieces);
        while let Some(piece) = pending.pop() {
            if let PieceOfOrder::All(names) = piece
                && let Some(mut names) = Rc::into_inner(names)
            {
                pending.append(&mut names.pieces);
            }
        }
    }
}

impl OrderOfNames {
    fn of(names: impl Iterator<Item = Atom>) -> OrderOfNames {
        let pieces: Vec<PieceOfOrder> = names.map(PieceOfOrder::Name).collect();
        OrderOfNames {
            weight: pieces.len() as u64,
            pieces,
        }
    }

    fn push(&mut self, piece: PieceOfOrder) {
        let weight = match &piece {
            PieceOfOrder::Name(_) => 1,
            PieceOfOrder::All(names) => names.weight.saturating_add(1),
        };
        self.weight = self.weight.saturating_add(weight);
        self.pieces.push(piece);
    }

    fn is_list_of_names(&self) -> bool {
        self.weight == self.pieces.len() as u64
    }

    fn has_the_pieces_of(&self, other: &OrderOfNames) -> bool {
        if self.weight != other.weight {
            return false;
        }
        let mut open = vec![(self.pieces.iter(), other.pieces.iter())];
        while let Some((own, others)) = open.last_mut() {
            match (own.next(), others.next()) {
                (None, None) => _ = open.pop(),
                (Some(PieceOfOrder::Name(name)), Some(PieceOfOrder::Name(found)))
                    if name == found => {}
                (Some(PieceOfOrder::All(names)), Some(PieceOfOrder::All(found))) => {
                    if Rc::ptr_eq(names, found) {
                        continue;
                    }
                    if names.weight != found.weight {
                        return false;
                    }
                    open.push((names.pieces.iter(), found.pieces.iter()));
                }
                _ => return false,
            }
        }
        true
    }
}

#[derive(Clone)]
pub(super) enum MembersByName {
    One {
        member: Member,
        nodes: Cell<u64>,
    },
    Both {
        bit: u32,
        prefix: u32,
        without_bit: Rc<MembersByName>,
        with_bit: Rc<MembersByName>,
        count: u32,
        nodes: Cell<u64>,
    },
}

fn bits_above(bit: u32, name: u32) -> u32 {
    name & !(bit | (bit - 1))
}

impl MembersByName {
    fn one(member: Member) -> Rc<MembersByName> {
        let nodes = Cell::new(0);
        Rc::new(MembersByName::One { member, nodes })
    }

    fn both(
        (bit, prefix): (u32, u32),
        without_bit: Rc<MembersByName>,
        with_bit: Rc<MembersByName>,
    ) -> Rc<MembersByName> {
        Rc::new(MembersByName::Both {
            bit,
            prefix,
            count: without_bit.count() + with_bit.count(),
            without_bit,
            with_bit,
            nodes: Cell::new(0),
        })
    }

    fn beside(
        (name, members): (u32, Rc<MembersByName>),
        (other_name, others): (u32, Rc<MembersByName>),
    ) -> Rc<MembersByName> {
        debug_assert!(name != other_name);
        let bit = (1 << (u32::BITS - 1)) >> (name ^ other_name).leading_zeros();
        let place = (bit, bits_above(bit, name));
        match name & bit == 0 {
            true => MembersByName::both(place, members, others),
            false => MembersByName::both(place, others, members),
        }
    }

    fn count(&self) -> u32 {
        match self {
            MembersByName::One { .. } => 1,
            MembersByName::Both { count, .. } => *count,
        }
    }

    fn place(&self) -> (u32, u32) {
        match self {
            MembersByName::One { member, .. } => (0, member.name.0),
            MembersByName::Both { bit, prefix, .. } => (*bit, *prefix),
        }
    }

    fn count_nodes(&self) -> u64 {
        let (MembersByName::One { nodes, .. } | MembersByName::Both { nodes, .. }) = self;
        if nodes.get() == 0 {
            nodes.set(match self {
                MembersByName::One { member, .. } => {
                    member.usage.count_nodes(u64::MAX).unwrap_or(u64::MAX)
                }
                MembersByName::Both {
                    without_bit,
                    with_bit,
                    ..
                } => (without_bit.count_nodes()).saturating_add(with_bit.count_nodes()),
            });
        }
        nodes.get()
    }

    fn get(&self, name: Atom) -> Option<&Member> {
        let mut at = self;
        loop {
            match at {
                MembersByName::One { member, .. } => {
                    return (member.name == name).then_some(member);
                }
                MembersByName::Both {
                    bit,
                    without_bit,
                    with_bit,
                    ..
                } => {
                    at = if name.0 & bit == 0 {
                        without_bit
                    } else {
                        with_bit
                    }
                }
            }
        }
    }

    fn member_mut(mut at: &mut Rc<MembersByName>, name: Atom) -> &mut Member {
        loop {
            match Rc::make_mut(at) {
                MembersByName::One { member, nodes } => {
                    nodes.set(0);
                    return member;
                }
                MembersByName::Both {
                    bit,
                    without_bit,
                    with_bit,
                    nodes,
                    ..
                } => {
                    nodes.set(0);
                    at = if name.0 & *bit == 0 {
                        without_bit
                    } else {
                        with_bit
                    };
                }
            }
        }
    }

    fn insert(at: &mut Rc<MembersByName>, member: Member) {
        let name = member.name.0;
        let (bit, prefix) = at.place();
        if bit == 0 || bits_above(bit, name) != prefix {
            let added = (name, MembersByName::one(member));
            *at = MembersByName::beside((prefix, Rc::clone(at)), added);
            return;
        }
        if let MembersByName::Both {
            bit,
            without_bit,
            with_bit,
            count,
            nodes,
            ..
        } = Rc::make_mut(at)
        {
            *count += 1;
            nodes.set(0);
            let half = if name & *bit == 0 {
                without_bit
            } else {
                with_bit
            };
            MembersByName::insert(half, member);
        }
    }

    fn any(&self, is_found: &mut impl FnMut(&Member) -> bool) -> bool {
        match self {
            MembersByName::One { member, .. } => is_found(member),
            MembersByName::Both {
                without_bit,
                with_bit,
                ..
            } => without_bit.any(is_found) || with_bit.any(is_found),
        }
    }
}

impl MembersByName {
    fn has_the_members_of(own: &Rc<MembersByName>, other: &Rc<MembersByName>) -> bool {
        if Rc::ptr_eq(own, other) {
            return true;
        }
        match (&**own, &**other) {
            (MembersByName::One { member, .. }, MembersByName::One { member: found, .. }) => {
                member == found
            }
            (
                MembersByName::Both {
                    without_bit,
                    with_bit,
                    count,
                    ..
                },
                MembersByName::Both {
                    without_bit: others_without_bit,
                    with_bit: others_with_bit,
                    count: others_count,
                    ..
                },
            ) => {
                count == others_count
                    && own.place() == other.place()
                    && MembersByName::has_the_members_of(without_bit, others_without_bit)
                    && MembersByName::has_the_members_of(with_bit, others_with_bit)
            }
            _ => false,
        }
    }
}

struct MergeOfMany<'w> {
    walk: &'w mut Walk,
    added: u32,
}

impl MergeOfMany<'_> {
    fn take_over(&mut self, other: &Rc<MembersByName>) -> Rc<MembersByName> {
        let nodes = other.count_nodes();
        self.walk.remaining_nodes = self.walk.remaining_nodes.saturating_sub(nodes);
        self.added += other.count();
        Rc::clone(other)
    }

    fn merge_member(
        &mut self,
        own: &Rc<MembersByName>,
        member: &Member,
        other: &Member,
    ) -> Rc<MembersByName> {
        let mut usage = Rc::clone(&member.usage);
        merge_part(&mut usage, self.walk, &other.usage);
        match Rc::ptr_eq(&usage, &member.usage) {
            true => Rc::clone(own),
            false => MembersByName::one(Member {
                name: member.name,
                usage,
            }),
        }
    }

    fn merge(&mut self, own: &Rc<MembersByName>, other: &Rc<MembersByName>) -> Rc<MembersByName> {
        if Rc::ptr_eq(own, other) || self.walk.is_out_of_budget() {
            return Rc::clone(own);
        }
        let (place, other_place) = (own.place(), other.place());
        let ((bit, prefix), (other_bit, other_prefix)) = (place, other_place);
        match (&**own, &**other) {
            (MembersByName::One { member, .. }, MembersByName::One { member: found, .. })
                if place == other_place =>
            {
                self.merge_member(own, member, found)
            }
            (
                MembersByName::Both {
                    without_bit,
                    with_bit,
                    ..
                },
                MembersByName::Both {
                    without_bit: others_without_bit,
                    with_bit: others_with_bit,
                    ..
                },
            ) if place == other_place => {
                let without = self.merge(without_bit, others_without_bit);
                let with = self.merge(with_bit, others_with_bit);
                let is = |half: &Rc<MembersByName>, of: &Rc<MembersByName>| Rc::ptr_eq(half, of);
                if is(&without, without_bit) && is(&with, with_bit) {
                    Rc::clone(own)
                } else if is(&without, others_without_bit) && is(&with, others_with_bit) {
                    Rc::clone(other)
                } else {
                    MembersByName::both(place, without, with)
                }
            }
            (
                MembersByName::Both {
                    without_bit,
                    with_bit,
                    ..
                },
                _,
            ) if bit > other_bit && bits_above(bit, other_prefix) == prefix => {
                let half = if other_prefix & bit == 0 {
                    without_bit
                } else {
                    with_bit
                };
                let merged = self.merge(half, other);
                if Rc::ptr_eq(&merged, half) {
                    return Rc::clone(own);
                }
                match other_prefix & bit == 0 {
                    true => MembersByName::both(place, merged, Rc::clone(with_bit)),
                    false => MembersByName::both(place, Rc::clone(without_bit), merged),
                }
            }
            (
                _,
                MembersByName::Both {
                    without_bit,
                    with_bit,
                    ..
                },
            ) if other_bit > bit && bits_above(other_bit, prefix) == other_prefix => {
                match prefix & other_bit == 0 {
                    true => {
                        let merged = self.merge(own, without_bit);
                        MembersByName::both(other_place, merged, self.take_over(with_bit))
                    }
                    false => {
                        let taken = self.take_over(without_bit);
                        MembersByName::both(other_place, taken, self.merge(own, with_bit))
                    }
                }
            }
            _ => {
                let taken = self.take_over(other);
                MembersByName::beside((prefix, Rc::clone(own)), (other_prefix, taken))
            }
        }
    }
}

impl Default for Members {
    fn default() -> Members {
        Members::Few(Vec::new())
    }
}

impl PartialEq for Members {
    fn eq(&self, other: &Members) -> bool {
        match (self, other) {
            (Members::Few(members), Members::Few(others)) => members == others,
            (Members::Many(members), Members::Many(others)) => {
                MembersByName::has_the_members_of(&members.by_name, &others.by_name)
                    && (Rc::ptr_eq(&members.order, &others.order)
                        || members.order.has_the_pieces_of(&others.order)
                        || members.names_in_order() == others.names_in_order())
            }
            _ => self.len() == other.len() && self.in_order() == other.in_order(),
        }
    }
}

impl Eq for Members {}

impl ManyMembers {
    fn of(few: &[Member]) -> Option<ManyMembers> {
        let (first, rest) = few.split_first()?;
        let mut by_name = MembersByName::one(first.clone());
        for member in rest {
            MembersByName::insert(&mut by_name, member.clone());
        }
        Some(ManyMembers {
            by_name,
            order: Rc::new(OrderOfNames::of(few.iter().map(|member| member.name))),
        })
    }

    fn push(&mut self, member: Member) {
        self.push_to_order(PieceOfOrder::Name(member.name));
        MembersByName::insert(&mut self.by_name, member);
    }

    fn push_to_order(&mut self, piece: PieceOfOrder) {
        if let Some(order) = Rc::get_mut(&mut self.order) {
            return order.push(piece);
        }
        let mut order = OrderOfNames::default();
        order.push(PieceOfOrder::All(Rc::clone(&self.order)));
        order.push(piece);
        self.order = Rc::new(order);
    }

    fn push_order_of(&mut self, others: &ManyMembers) {
        self.push_to_order(PieceOfOrder::All(Rc::clone(&others.order)));
        if self.order.weight > 4 * u64::from(self.by_name.count()) + 16 {
            self.write_out_order();
        }
    }

    fn names_in_order(&self) -> Vec<Atom> {
        let count = self.by_name.count() as usize;
        let mut names = Vec::with_capacity(count);
        if self.order.is_list_of_names() {
            names.extend(self.order.pieces.iter().filter_map(|piece| match piece {
                PieceOfOrder::Name(name) => Some(*name),
                PieceOfOrder::All(_) => None,
            }));
            debug_assert_eq!(names.len(), count);
            return names;
        }
        let mut names_met = FxHashSet::with_capacity_and_hasher(count, Default::default());
        let mut open = vec![self.order.pieces.iter()];
        while names.len() < count
            && let Some(pieces) = open.last_mut()
        {
            match pieces.next() {
                None => {
                    open.pop();
                }
                Some(&PieceOfOrder::Name(name)) => {
                    if names_met.insert(name) {
                        names.push(name);
                    }
                }
                Some(PieceOfOrder::All(names)) => open.push(names.pieces.iter()),
            }
        }
        debug_assert_eq!(names.len(), count);
        names
    }

    fn in_order(&self) -> Vec<&Member> {
        let names = self.names_in_order();
        (names.iter().filter_map(|&name| self.by_name.get(name))).collect()
    }

    fn write_out_order(&mut self) {
        if !self.order.is_list_of_names() {
            self.order = Rc::new(OrderOfNames::of(self.names_in_order().into_iter()));
        }
    }
}

impl Members {
    const FEW: usize = if cfg!(test) { 8 } else { 64 };

    fn is_empty(&self) -> bool {
        matches!(self, Members::Few(members) if members.is_empty())
    }

    fn len(&self) -> usize {
        match self {
            Members::Few(members) => members.len(),
            Members::Many(members) => members.by_name.count() as usize,
        }
    }

    fn get(&self, name: Atom) -> Option<&Member> {
        match self {
            Members::Few(members) => members.iter().find(|member| member.name == name),
            Members::Many(members) => members.by_name.get(name),
        }
    }

    fn member_mut(&mut self, name: Atom) -> Option<&mut Member> {
        match self {
            Members::Few(members) => members.iter_mut().find(|member| member.name == name),
            Members::Many(members) => {
                members.by_name.get(name)?;
                Some(MembersByName::member_mut(&mut members.by_name, name))
            }
        }
    }

    fn push(&mut self, member: Member) {
        if let Members::Few(few) = self
            && few.len() >= Members::FEW
            && let Some(many) = ManyMembers::of(few)
        {
            *self = Members::Many(many);
        }
        match self {
            Members::Few(members) => members.push(member),
            Members::Many(members) => members.push(member),
        }
    }

    fn in_order(&self) -> Vec<&Member> {
        match self {
            Members::Few(members) => members.iter().collect(),
            Members::Many(members) => members.in_order(),
        }
    }

    fn write_out_order(&mut self) {
        if let Members::Many(members) = self {
            members.write_out_order();
        }
    }

    fn any(&self, mut is_found: impl FnMut(&Member) -> bool) -> bool {
        match self {
            Members::Few(members) => members.iter().any(is_found),
            Members::Many(members) => members.by_name.any(&mut is_found),
        }
    }

    fn merge_member(&mut self, walk: &mut Walk, member: &Member) -> bool {
        match self {
            Members::Few(few) => {
                if let Some(own) = few.iter_mut().find(|own| own.name == member.name) {
                    let before = Rc::as_ptr(&own.usage);
                    merge_part(&mut own.usage, walk, &member.usage);
                    return before != Rc::as_ptr(&own.usage);
                }
            }
            Members::Many(many) => {
                if let Some(own) = many.by_name.get(member.name) {
                    let mut usage = Rc::clone(&own.usage);
                    merge_part(&mut usage, walk, &member.usage);
                    if Rc::ptr_eq(&usage, &own.usage) {
                        return false;
                    }
                    MembersByName::member_mut(&mut many.by_name, member.name).usage = usage;
                    return true;
                }
            }
        }
        if walk.enter_all_nodes_of(&member.usage) {
            self.push(member.clone());
            return true;
        }
        if !walk.enter_node() {
            return false;
        }
        let mut usage = Usage::default();
        usage.merge(walk, &member.usage);
        self.push(Member {
            name: member.name,
            usage: Rc::new(usage),
        });
        true
    }

    fn merged_with_many(&self, walk: &mut Walk, others: &ManyMembers) -> Option<Members> {
        if !walk.merges_member_by_member {
            let nodes_before = walk.remaining_nodes;
            let merged = self.merged_at_once_with_many(walk, others);
            if !walk.is_out_of_budget() {
                return merged;
            }
            walk.remaining_nodes = nodes_before;
        }
        let was_member_by_member = std::mem::replace(&mut walk.merges_member_by_member, true);
        let mut merged = self.clone();
        let mut is_changed = false;
        for member in others.in_order() {
            is_changed |= merged.merge_member(walk, member);
        }
        walk.merges_member_by_member = was_member_by_member;
        is_changed.then_some(merged)
    }

    fn merged_at_once_with_many(&self, walk: &mut Walk, others: &ManyMembers) -> Option<Members> {
        let few;
        let own = match self {
            Members::Many(own) => own,
            Members::Few(own) => match ManyMembers::of(own) {
                Some(own) => {
                    few = own;
                    &few
                }
                None => {
                    MergeOfMany { walk, added: 0 }.take_over(&others.by_name);
                    return Some(Members::Many(others.clone()));
                }
            },
        };
        let mut merge = MergeOfMany { walk, added: 0 };
        let by_name = merge.merge(&own.by_name, &others.by_name);
        if Rc::ptr_eq(&by_name, &own.by_name) {
            return None;
        }
        let has_more_names = merge.added != 0;
        let mut merged = ManyMembers {
            by_name,
            order: Rc::clone(&own.order),
        };
        if has_more_names && !walk.is_out_of_budget() {
            merged.push_order_of(others);
        }
        Some(Members::Many(merged))
    }
}

#[derive(Default, Clone)]
struct Arms {
    list: SmallVec<[TypeId; 2]>,
    listed: Option<Box<FxHashSet<TypeId>>>,
}

impl Arms {
    const FEW: usize = 16;

    fn contains(&self, arm: TypeId) -> bool {
        match &self.listed {
            Some(listed) => listed.contains(&arm),
            None => self.list.contains(&arm),
        }
    }

    fn add(&mut self, arm: TypeId) {
        if self.contains(arm) {
            return;
        }
        self.list.push(arm);
        match &mut self.listed {
            Some(listed) => _ = listed.insert(arm),
            None if self.list.len() > Arms::FEW => {
                self.listed = Some(Box::new(self.list.iter().copied().collect()));
            }
            None => {}
        }
    }
}

impl PartialEq for Arms {
    fn eq(&self, other: &Arms) -> bool {
        self.list == other.list
    }
}

impl Eq for Arms {}

#[derive(Default, Clone, PartialEq, Eq)]
pub(super) struct Usage {
    facts: Facts,
    arms: Arms,
    members: Members,
    elements: Option<Rc<Usage>>,
}

impl Usage {
    fn member_mut(&mut self, name: Atom) -> &mut Usage {
        if self.members.get(name).is_none() {
            self.members.push(Member {
                name,
                usage: Rc::default(),
            });
        }
        let member = self.members.member_mut(name);
        Rc::make_mut(&mut member.expect("the member is there").usage)
    }

    fn elements_mut(&mut self) -> &mut Usage {
        Rc::make_mut(self.elements.get_or_insert_default())
    }

    #[inline]
    fn count_nodes(&self, most: u64) -> Option<u64> {
        match self.members.is_empty() && self.elements.is_none() {
            true => (most != 0).then_some(1),
            false => self.count_nodes_of_parts(most),
        }
    }

    fn count_nodes_of_parts(&self, most: u64) -> Option<u64> {
        let mut count: u64 = 1;
        match &self.members {
            Members::Few(members) => {
                for member in members {
                    count += member.usage.count_nodes(most.checked_sub(count)?)?;
                }
            }
            Members::Many(members) => count = count.saturating_add(members.by_name.count_nodes()),
        }
        if let Some(elements) = &self.elements {
            count += elements.count_nodes(most.checked_sub(count)?)?;
        }
        (count <= most).then_some(count)
    }

    fn add_arm(&mut self, arm: TypeId) {
        self.arms.add(arm);
    }

    fn merge(&mut self, walk: &mut Walk, other: &Usage) {
        if walk.is_out_of_budget() && !walk.looks_at_every_use_of(self) {
            return;
        }
        self.facts |= other.facts;
        for &arm in &other.arms.list {
            self.add_arm(arm);
        }
        if walk.is_out_of_budget() {
            return;
        }
        match &other.members {
            Members::Few(others) => {
                for member in others {
                    self.members.merge_member(walk, member);
                }
            }
            Members::Many(others) => {
                if let Some(merged) = self.members.merged_with_many(walk, others) {
                    self.members = merged;
                }
            }
        }
        match (&mut self.elements, &other.elements) {
            (_, None) => {}
            (Some(own), Some(elements)) => merge_part(own, walk, elements),
            (None, Some(elements)) if walk.enter_all_nodes_of(elements) => {
                self.elements = Some(Rc::clone(elements));
            }
            (None, Some(elements)) => {
                if walk.enter_node() {
                    self.elements_mut().merge(walk, elements);
                }
            }
        }
    }

    fn is_incomplete(&self) -> bool {
        self.facts.contains(Facts::INCOMPLETE)
    }

    fn forget_parts(&mut self) {
        self.members = Members::default();
        self.elements = None;
    }

    fn is_number(&self) -> bool {
        self.facts.contains(Facts::NUMBER) || self.arms.contains(TypeId::NUMBER)
    }

    fn has_stored_part(&self) -> bool {
        let is_stored = |part: &Usage| part.facts.contains(Facts::STORED);
        self.elements.as_deref().is_some_and(is_stored)
            || self.members.any(|member| is_stored(&member.usage))
    }
}

fn merge_part(own: &mut Rc<Usage>, walk: &mut Walk, other: &Rc<Usage>) {
    if Rc::ptr_eq(own, other) || (walk.is_out_of_budget() && !walk.looks_at_every_use_of(own)) {
        return;
    }
    walk.levels_of_parts_entered += 1;
    if !walk.merges_by_what_is_remembered(own, other) {
        merge_part_by_part(own, walk, other);
    }
    walk.levels_of_parts_entered -= 1;
}

fn merge_part_by_part(own: &mut Rc<Usage>, walk: &mut Walk, other: &Rc<Usage>) {
    if !own.facts.contains(other.facts)
        || other.arms.list.iter().any(|&arm| !own.arms.contains(arm))
    {
        let own = Rc::make_mut(own);
        own.facts |= other.facts;
        for &arm in &other.arms.list {
            own.add_arm(arm);
        }
    }
    if walk.is_out_of_budget() {
        return;
    }
    match &other.members {
        Members::Few(others) => {
            for member in others {
                match own.members.get(member.name) {
                    Some(found) => {
                        let mut part = Rc::clone(&found.usage);
                        merge_part(&mut part, walk, &member.usage);
                        if !Rc::ptr_eq(&part, &found.usage)
                            && let Some(found) = Rc::make_mut(own).members.member_mut(member.name)
                        {
                            found.usage = part;
                        }
                    }
                    None if walk.enter_all_nodes_of(&member.usage) => {
                        Rc::make_mut(own).members.push(member.clone());
                    }
                    None if walk.enter_node() => {
                        let part = Rc::make_mut(own).member_mut(member.name);
                        part.merge(walk, &member.usage);
                    }
                    None => {}
                }
            }
        }
        Members::Many(others) => {
            if let Some(merged) = own.members.merged_with_many(walk, others) {
                Rc::make_mut(own).members = merged;
            }
        }
    }
    match (&own.elements, &other.elements) {
        (_, None) => {}
        (Some(elements_of_own), Some(elements)) => {
            let mut part = Rc::clone(elements_of_own);
            merge_part(&mut part, walk, elements);
            if !Rc::ptr_eq(&part, elements_of_own) {
                Rc::make_mut(own).elements = Some(part);
            }
        }
        (None, Some(elements)) if walk.enter_all_nodes_of(elements) => {
            Rc::make_mut(own).elements = Some(Rc::clone(elements));
        }
        (None, Some(elements)) => {
            if walk.enter_node() {
                Rc::make_mut(own).elements_mut().merge(walk, elements);
            }
        }
    }
}

struct Walk {
    max_nodes: u64,
    remaining_nodes: u64,
    lowest_index: usize,
    in_cycles: Vec<Subject>,
    found_something_new: bool,
    root: *const Usage,
    subjects_not_kept: u64,
    unstable_answers_at_start: u64,
    shares_budget: bool,
    subjects_on_stack: usize,
    is_freeing_stack: bool,
    set_aside: Vec<SubjectInProgress>,
    numbers_listed: Option<Subjects>,
    merges_member_by_member: bool,
    passed_on: PassedOn,
    levels_of_parts_entered: u32,
    remembered: Rc<RefCell<PartsRemembered>>,
}

#[derive(Default)]
pub(super) struct PartsRemembered {
    counts: FxHashMap<*const Usage, (Rc<Usage>, u64)>,
    compared: FxHashMap<(*const Usage, *const Usage, bool), (Rc<Usage>, Rc<Usage>, bool)>,
}

#[derive(Copy, Clone, PartialEq, Eq, Hash)]
enum StepToPart {
    Member(Atom),
    Elements,
}

struct PassedOn {
    followed: FxHashSet<(u32, ExprId, bool)>,
    numbers_of_parts: FxHashMap<(u32, StepToPart), u32>,
    part_entered: *const Usage,
    number_of_part_entered: u32,
}

impl Default for PassedOn {
    fn default() -> PassedOn {
        PassedOn {
            followed: FxHashSet::default(),
            numbers_of_parts: FxHashMap::default(),
            part_entered: std::ptr::null(),
            number_of_part_entered: 0,
        }
    }
}

impl PassedOn {
    fn number_of(&self, usage: &Usage) -> Option<u32> {
        std::ptr::eq(usage, self.part_entered).then_some(self.number_of_part_entered)
    }

    fn is_followed_anew(&mut self, outer: ExprId, usage: &Usage) -> bool {
        let holds_number = usage.facts.contains(Facts::NUMBER_AT_EVERY_VALUE);
        match self.number_of(usage) {
            Some(part) => self.followed.insert((part, outer, holds_number)),
            None => true,
        }
    }

    fn number_of_part(&mut self, whole: &Usage, step: StepToPart) -> Option<u32> {
        let whole = self.number_of(whole)?;
        let next = self.numbers_of_parts.len() as u32 + 1;
        Some(*self.numbers_of_parts.entry((whole, step)).or_insert(next))
    }
}

struct SubjectInProgress {
    subject: Subject,
    is_outermost: bool,
    unstable_answers: u64,
    assumed: Option<Rc<Usage>>,
    index: usize,
    first_in_cycle: usize,
    first_in_round: usize,
    lowest_index: usize,
    found_something_new: bool,
    outer_lowest: usize,
    outer_nodes: u64,
    outer_root: *const Usage,
    outer_found_something_new: bool,
}

impl Walk {
    fn new(max_nodes: u64) -> Walk {
        Walk {
            max_nodes,
            remaining_nodes: max_nodes,
            lowest_index: usize::MAX,
            in_cycles: Vec::new(),
            found_something_new: false,
            root: std::ptr::null(),
            subjects_not_kept: 0,
            unstable_answers_at_start: 0,
            shares_budget: false,
            subjects_on_stack: 0,
            is_freeing_stack: false,
            set_aside: Vec::new(),
            numbers_listed: None,
            merges_member_by_member: false,
            passed_on: PassedOn::default(),
            levels_of_parts_entered: 0,
            remembered: Rc::default(),
        }
    }

    fn enter_node(&mut self) -> bool {
        let has_budget = self.remaining_nodes > 0 && !self.is_freeing_stack;
        self.remaining_nodes = self.remaining_nodes.saturating_sub(1);
        has_budget
    }

    const LEVELS_MERGED_WITHOUT_MEMORY: u32 = if cfg!(test) { 0 } else { 8 };
    const NODES_COUNTED_WITHOUT_MEMORY: u64 = if cfg!(test) { 2 } else { 32 };

    fn enter_all_nodes_of(&mut self, usage: &Rc<Usage>) -> bool {
        let count = self.count_nodes_of(usage);
        if count > self.remaining_nodes {
            return false;
        }
        self.remaining_nodes -= count;
        true
    }

    fn count_nodes_of(&mut self, part: &Rc<Usage>) -> u64 {
        if let Some(count) = part.count_nodes(Walk::NODES_COUNTED_WITHOUT_MEMORY) {
            return count;
        }
        if let Some(&(_, count)) = self.remembered.borrow().counts.get(&Rc::as_ptr(part)) {
            return count;
        }
        let mut count: u64 = 1;
        match &part.members {
            Members::Few(members) => {
                for member in members {
                    count = count.saturating_add(self.count_nodes_of(&member.usage));
                }
            }
            Members::Many(members) => count = count.saturating_add(members.by_name.count_nodes()),
        }
        if let Some(elements) = &part.elements {
            count = count.saturating_add(self.count_nodes_of(elements));
        }
        let kept = (Rc::clone(part), count);
        self.remembered
            .borrow_mut()
            .counts
            .insert(Rc::as_ptr(part), kept);
        count
    }

    fn merges_by_what_is_remembered(&mut self, own: &mut Rc<Usage>, other: &Rc<Usage>) -> bool {
        if self.levels_of_parts_entered <= Walk::LEVELS_MERGED_WITHOUT_MEMORY
            || self.is_out_of_budget()
        {
            return false;
        }
        if self.holds_all_of(own, other, false) {
            return true;
        }
        if self.holds_all_of(other, own, true) {
            let added = self.count_nodes_of(other) - self.count_nodes_of(own);
            if added < self.remaining_nodes {
                self.remaining_nodes -= added;
                *own = Rc::clone(other);
                return true;
            }
        }
        false
    }

    fn holds_all_of(&mut self, whole: &Rc<Usage>, part: &Rc<Usage>, in_its_order: bool) -> bool {
        if Rc::ptr_eq(whole, part) {
            return true;
        }
        let key = (Rc::as_ptr(whole), Rc::as_ptr(part), in_its_order);
        if let Some(&(_, _, holds)) = self.remembered.borrow().compared.get(&key) {
            return holds;
        }
        let holds = self.holds_each_of(whole, part, in_its_order);
        let kept = (Rc::clone(whole), Rc::clone(part), holds);
        self.remembered.borrow_mut().compared.insert(key, kept);
        holds
    }

    fn holds_each_of(&mut self, whole: &Rc<Usage>, part: &Rc<Usage>, in_its_order: bool) -> bool {
        if !whole.facts.contains(part.facts) {
            return false;
        }
        let (Members::Few(all), Members::Few(some)) = (&whole.members, &part.members) else {
            return false;
        };
        let holds_arms_and_names = match in_its_order {
            true => {
                whole.arms.list.starts_with(&part.arms.list)
                    && all.len() >= some.len()
                    && all
                        .iter()
                        .zip(some)
                        .all(|(held, member)| held.name == member.name)
            }
            false => part.arms.list.iter().all(|&arm| whole.arms.contains(arm)),
        };
        if !holds_arms_and_names {
            return false;
        }
        for member in some {
            let Some(held) = all.iter().find(|held| held.name == member.name) else {
                return false;
            };
            if !self.holds_all_of(&held.usage, &member.usage, in_its_order) {
                return false;
            }
        }
        match (&whole.elements, &part.elements) {
            (_, None) => true,
            (Some(held), Some(elements)) => self.holds_all_of(held, elements, in_its_order),
            (None, Some(_)) => false,
        }
    }

    fn is_out_of_budget(&self) -> bool {
        self.remaining_nodes == 0
    }

    fn looks_at_every_use_of(&self, usage: &Usage) -> bool {
        std::ptr::eq(usage, self.root) && !self.shares_budget && !self.is_freeing_stack
    }

    fn looks_at_uses_of(&self, usage: &Usage) -> bool {
        (!self.is_out_of_budget() && !self.is_freeing_stack) || self.looks_at_every_use_of(usage)
    }
}

#[derive(Copy, Clone)]
enum Use {
    Nothing,
    PassedOn(ExprId),
    Initializes(PatId),
    Destructured(ExprId),
    Member {
        access: ExprId,
        name: Atom,
        is_optional: bool,
    },
    Keyed {
        access: ExprId,
        key: ExprId,
        is_optional: bool,
    },
    Key {
        object: ExprId,
    },
    Called {
        is_optional: bool,
    },
    Argument {
        call: ExprId,
        index: usize,
    },
    Iterated(Option<PatId>),
    Object {
        is_required: bool,
    },
    Number,
    Int32,
    Updated,
    AddedTo(ExprId),
    ComparedWith(ExprId),
    Stored {
        op: Option<BinOp>,
        value: ExprId,
    },
}

fn find_use(hir: &hir::File<'_>, bound: &Bound<'_>, value: ExprId) -> Use {
    match bound.parent_of_expr(value) {
        Parent::Expr(parent) => match parent.some() {
            Some(parent) => find_use_in_expression(hir, bound, parent, value),
            None => Use::Nothing,
        },
        Parent::Stmt(statement) => match statement.some() {
            Some(statement) => find_use_in_statement(hir, statement),
            None => Use::Nothing,
        },
        Parent::VarInit(declaration) => Use::Initializes(hir[declaration].pat),
        Parent::Prop(property) => find_use_in_property(hir, bound, property, value),
        Parent::None
        | Parent::File
        | Parent::ParamDefault(_)
        | Parent::PatPropDefault(_)
        | Parent::PatElemDefault(_)
        | Parent::PropKey(_)
        | Parent::PatKey(_)
        | Parent::MemberKey(_)
        | Parent::MethodKey(_)
        | Parent::MemberInit(_)
        | Parent::FnBody(_)
        | Parent::EnumInit(_)
        | Parent::Case(_)
        | Parent::ClassExtends(_)
        | Parent::ClassDecorator(_)
        | Parent::MemberDecorator(_)
        | Parent::ParamDecorator(_)
        | Parent::Module(_) => Use::Nothing,
    }
}

fn find_use_in_expression(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    parent: ExprId,
    value: ExprId,
) -> Use {
    match hir[parent].kind {
        ExprKind::Dot { .. } | ExprKind::Index { .. } => find_use_in_access(hir, parent, value),
        ExprKind::Call(site) | ExprKind::New(site) => find_use_in_call(hir, parent, site, value),
        ExprKind::TaggedTemplate(site) if hir[site].callee == value => {
            Use::Called { is_optional: false }
        }
        ExprKind::Spread(_) if bound.get_assignment_target(hir, value).is_none() => {
            Use::Iterated(None)
        }
        ExprKind::Unary { op, .. } => find_use_as_unary_operand(op),
        ExprKind::Binary { op, left, right } => match left == value {
            true => find_use_as_binary_operand(op, parent, Side::Left, right),
            false => find_use_as_binary_operand(op, parent, Side::Right, left),
        },
        ExprKind::Assign {
            op,
            target,
            value: stored,
        } if target == value => Use::Stored { op, value: stored },
        ExprKind::Assign {
            op: Some(op),
            target,
            ..
        } if !matches!(op, BinOp::And | BinOp::Or | BinOp::Nullish) => {
            find_use_as_binary_operand(op, parent, Side::Right, target)
        }
        ExprKind::Assign {
            op: None, target, ..
        } if matches!(hir[target].kind, ExprKind::Array(_)) => Use::Iterated(None),
        ExprKind::Assign {
            op: None, target, ..
        } if matches!(hir[target].kind, ExprKind::Object(_)) => Use::Destructured(target),
        ExprKind::Cond { test, .. } if test != value => Use::PassedOn(parent),
        ExprKind::As { .. }
        | ExprKind::Satisfies { .. }
        | ExprKind::AsConst(_)
        | ExprKind::NonNull(_)
        | ExprKind::Instantiation { .. } => Use::PassedOn(parent),
        ExprKind::TaggedTemplate(_)
        | ExprKind::Spread(_)
        | ExprKind::Assign { .. }
        | ExprKind::Cond { .. }
        | ExprKind::Missing
        | ExprKind::Ident(_)
        | ExprKind::PrivateIdentifier(_)
        | ExprKind::This
        | ExprKind::Super
        | ExprKind::Null
        | ExprKind::True
        | ExprKind::False
        | ExprKind::Number(_)
        | ExprKind::String(_)
        | ExprKind::BigInt(_)
        | ExprKind::Regex { .. }
        | ExprKind::Template { .. }
        | ExprKind::Array(_)
        | ExprKind::Object(_)
        | ExprKind::Fn(_)
        | ExprKind::Class(_)
        | ExprKind::Await(_)
        | ExprKind::Yield { .. }
        | ExprKind::Jsx(_)
        | ExprKind::ImportCall { .. }
        | ExprKind::ImportMeta
        | ExprKind::NewTarget(_)
        | ExprKind::JsxText(_) => Use::Nothing,
    }
}

fn find_use_in_access(hir: &hir::File<'_>, access: ExprId, value: ExprId) -> Use {
    let Some((object, key)) = hir.member_key(access) else {
        return Use::Nothing;
    };
    if object != value {
        return Use::Key { object };
    }
    let is_optional = hir
        .expr_flags(access)
        .contains(ExprFlags::OPTIONAL_CHAIN_LINK);
    match key {
        MemberKey::Name(name) => Use::Member {
            access,
            name,
            is_optional,
        },
        MemberKey::PrivateName(_) => Use::Object {
            is_required: !is_optional,
        },
        MemberKey::Computed(key) => Use::Keyed {
            access,
            key,
            is_optional,
        },
    }
}

fn find_use_in_call(hir: &hir::File<'_>, call: ExprId, site: CallId, value: ExprId) -> Use {
    let node = hir[site];
    if node.callee == value {
        return Use::Called {
            is_optional: node.chain == Chain::Start,
        };
    }
    for (index, argument) in hir.ids(node.args).enumerate() {
        if argument == value {
            return Use::Argument { call, index };
        }
        if matches!(hir[argument].kind, ExprKind::Spread(_)) {
            break;
        }
    }
    Use::Nothing
}

fn find_use_as_unary_operand(op: UnOp) -> Use {
    match op {
        UnOp::Plus | UnOp::Minus => Use::Number,
        UnOp::BitNot => Use::Int32,
        UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec => Use::Updated,
        UnOp::Not | UnOp::Typeof | UnOp::Void | UnOp::Delete => Use::Nothing,
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Side {
    Left,
    Right,
}

fn find_use_as_binary_operand(op: BinOp, whole: ExprId, side: Side, other: ExprId) -> Use {
    match op {
        BinOp::Add => Use::AddedTo(other),
        BinOp::Sub | BinOp::Mul | BinOp::Div | BinOp::Rem | BinOp::Pow => Use::Number,
        BinOp::Shl | BinOp::Shr | BinOp::UShr | BinOp::BitAnd | BinOp::BitOr | BinOp::BitXor => {
            Use::Int32
        }
        BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge => Use::ComparedWith(other),
        BinOp::And | BinOp::Or | BinOp::Nullish => Use::PassedOn(whole),
        BinOp::Comma if side == Side::Right => Use::PassedOn(whole),
        BinOp::In if side == Side::Right => Use::Object { is_required: true },
        BinOp::Comma
        | BinOp::In
        | BinOp::EqEq
        | BinOp::NotEq
        | BinOp::EqEqEq
        | BinOp::NotEqEq
        | BinOp::Instanceof => Use::Nothing,
    }
}

fn find_use_in_property(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    property: PropId,
    value: ExprId,
) -> Use {
    match hir[property].kind {
        PropKind::Spread if bound.get_assignment_target(hir, value).is_none() => {
            Use::Object { is_required: false }
        }
        PropKind::Spread
        | PropKind::Init
        | PropKind::Shorthand
        | PropKind::Method
        | PropKind::Getter
        | PropKind::Setter => Use::Nothing,
    }
}

fn find_use_in_statement(hir: &hir::File<'_>, statement: StmtId) -> Use {
    match hir[statement].kind {
        StmtKind::ForOf {
            left,
            is_await: false,
            ..
        } => Use::Iterated(find_declared_pattern(hir, left)),
        StmtKind::ForIn { .. } => Use::Object { is_required: false },
        StmtKind::ForOf { is_await: true, .. }
        | StmtKind::Empty
        | StmtKind::Debugger
        | StmtKind::Expr(_)
        | StmtKind::Var(_)
        | StmtKind::Fn(_)
        | StmtKind::Class(_)
        | StmtKind::Interface(_)
        | StmtKind::TypeAlias(_)
        | StmtKind::Enum(_)
        | StmtKind::Module(_)
        | StmtKind::Return(_)
        | StmtKind::If { .. }
        | StmtKind::For { .. }
        | StmtKind::While { .. }
        | StmtKind::DoWhile { .. }
        | StmtKind::Block(_)
        | StmtKind::Switch { .. }
        | StmtKind::Try { .. }
        | StmtKind::Throw(_)
        | StmtKind::Break(_)
        | StmtKind::Continue(_)
        | StmtKind::Labeled { .. }
        | StmtKind::Import(_)
        | StmtKind::ImportEquals(_)
        | StmtKind::ExportNamed(_)
        | StmtKind::ExportStar { .. }
        | StmtKind::ExportDefault(_)
        | StmtKind::ExportAssign(_)
        | StmtKind::ExportAsNamespace(_)
        | StmtKind::With { .. }
        | StmtKind::Directive { .. } => Use::Nothing,
    }
}

fn find_declared_pattern(hir: &hir::File<'_>, loop_head: StmtId) -> Option<PatId> {
    let StmtKind::Var(declarations) = hir[loop_head].kind else {
        return None;
    };
    let declaration = declarations.iter().next()?;
    Some(hir[declaration].pat)
}

fn find_initialized_symbol(bound: &Bound<'_>, name: PatId) -> Option<SymbolId> {
    match bound.initialized_binding(name) {
        Binding::Symbol(symbol) => Some(symbol),
        Binding::Arguments(_) | Binding::CommonJs(_) | Binding::Free => None,
    }
}

fn has_written_type(hir: &hir::File<'_>, bound: &Bound<'_>, name: PatId) -> bool {
    root_declaration(bound, name).has_type_annotation(hir)
}

fn is_untyped_variable(hir: &hir::File<'_>, bound: &Bound<'_>, symbol: SymbolId) -> bool {
    let declarations = bound.symbol(symbol).decls;
    !declarations.is_empty()
        && declarations.iter().all(|&declaration| match declaration {
            Decl::Var(name) | Decl::Param(name) => !has_written_type(hir, bound, name),
            Decl::Fn(_)
            | Decl::Class(_)
            | Decl::Interface(_)
            | Decl::Alias(_)
            | Decl::Enum(_)
            | Decl::EnumMember(_)
            | Decl::Module(_)
            | Decl::TypeParam(_)
            | Decl::ImportDefault(_)
            | Decl::ImportNamespace(_)
            | Decl::ImportSpec(_)
            | Decl::ImportEquals(_)
            | Decl::ExportSpec(_)
            | Decl::ExportStarAs(_)
            | Decl::ExportExpr(_)
            | Decl::UmdGlobal(_)
            | Decl::File
            | Decl::Require(_)
            | Decl::ModuleExports(_)
            | Decl::ExportsProperty(_)
            | Decl::Expando(_)
            | Decl::ObjectLiteral(_)
            | Decl::CommonJsVariable
            | Decl::Member(_)
            | Decl::ParameterProperty(_)
            | Decl::ThisProperty(_)
            | Decl::Property(_)
            | Decl::TypeLiteral(_) => false,
        })
}

fn find_alternatives(hir: &hir::File<'_>, expression: ExprId) -> SmallVec<[ExprId; 2]> {
    let mut alternatives = SmallVec::new();
    if let ExprKind::Cond { branches, .. } = hir[expression].kind {
        let branches = hir.branches(branches);
        alternatives.extend([branches.yes, branches.no]);
    } else if let ExprKind::Binary { op, left, right } = hir[expression].kind {
        for (side, operand, other) in [(Side::Left, left, right), (Side::Right, right, left)] {
            if let Use::PassedOn(_) = find_use_as_binary_operand(op, expression, side, other) {
                alternatives.push(operand);
            }
        }
    }
    alternatives
}

fn has_empty_default(hir: &hir::File<'_>, parameter: ParamId) -> bool {
    let default = hir[parameter].default;
    !default.is_none()
        && matches!(hir[default].kind, ExprKind::Object(members) if members.is_empty())
}

fn is_evaluated_for_some_values_only(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    expression: ExprId,
    answers: &mut FxHashMap<ExprId, bool>,
) -> bool {
    let mut climbed: SmallVec<[ExprId; 8]> = SmallVec::new();
    let mut inner = expression;
    let answer = loop {
        if let Some(&known) = answers.get(&inner) {
            break known;
        }
        climbed.push(inner);
        let Parent::Expr(parent) = bound.parent_of_expr(inner) else {
            break false;
        };
        let Some(parent) = parent.some() else {
            break false;
        };
        match hir[parent].kind {
            ExprKind::Binary {
                op: BinOp::And | BinOp::Or | BinOp::Nullish,
                right,
                ..
            } if right == inner => break true,
            ExprKind::Cond { test, .. } if test != inner => break true,
            _ => inner = parent,
        }
    };
    for expression in climbed {
        answers.insert(expression, answer);
    }
    answer
}

fn is_int32_value(value: f64) -> bool {
    let is_negative_zero = value == 0.0 && value.is_sign_negative();
    value.fract() == 0.0
        && value >= f64::from(i32::MIN)
        && value <= f64::from(i32::MAX)
        && !is_negative_zero
}

fn yields_int32(op: BinOp) -> bool {
    match op {
        BinOp::Shl | BinOp::Shr | BinOp::BitAnd | BinOp::BitOr | BinOp::BitXor => true,
        BinOp::UShr
        | BinOp::Add
        | BinOp::Sub
        | BinOp::Mul
        | BinOp::Div
        | BinOp::Rem
        | BinOp::Pow
        | BinOp::Lt
        | BinOp::Le
        | BinOp::Gt
        | BinOp::Ge
        | BinOp::EqEq
        | BinOp::NotEq
        | BinOp::EqEqEq
        | BinOp::NotEqEq
        | BinOp::And
        | BinOp::Or
        | BinOp::Nullish
        | BinOp::In
        | BinOp::Instanceof
        | BinOp::Comma => false,
    }
}

fn is_int32_literal(hir: &hir::File<'_>, value: ExprId) -> bool {
    let ExprKind::Number(index) = hir[value].kind else {
        return false;
    };
    let number = hir.numbers[index as usize];
    number == f64::from(number as i32)
}

struct TermsRead {
    most: u64,
    ran_out: Cell<bool>,
}

fn is_sum_with_product(hir: &hir::File<'_>, value: ExprId, read: &TermsRead) -> bool {
    let mut terms = vec![value];
    for _ in 0..read.most {
        let Some(term) = terms.pop() else {
            return false;
        };
        match hir[term].kind {
            ExprKind::Binary {
                op: BinOp::Mul | BinOp::Div | BinOp::Pow,
                ..
            } => return true,
            ExprKind::Binary {
                op: BinOp::Add | BinOp::Sub,
                left,
                right,
            } => terms.extend([left, right]),
            _ => {}
        }
    }
    if !terms.is_empty() {
        read.ran_out.set(true);
    }
    false
}

fn is_given_product(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    symbol: SymbolId,
    read: &TermsRead,
) -> bool {
    let starts_as_product = bound.symbol(symbol).decls.iter().any(|&declaration| {
        let Decl::Var(name) = declaration else {
            return false;
        };
        let PatParent::Var(variable) = bound.pat_parent[name.idx()] else {
            return false;
        };
        let initializer = hir[variable].init.some();
        initializer.is_some_and(|initializer| is_sum_with_product(hir, initializer, read))
    });
    starts_as_product
        || bound.stores_to(symbol).iter().any(|store| {
            let Use::Stored { op, value } = find_use(hir, bound, store.target) else {
                return false;
            };
            match op {
                None => is_sum_with_product(hir, value, read),
                Some(op) => matches!(op, BinOp::Mul | BinOp::Div | BinOp::Pow),
            }
        })
}

fn find_enclosing_sum(hir: &hir::File<'_>, bound: &Bound<'_>, operand: ExprId) -> Option<ExprId> {
    let Parent::Expr(parent) = bound.parent_of_expr(operand) else {
        return None;
    };
    let parent = parent.some()?;
    let is_sum = matches!(
        hir[parent].kind,
        ExprKind::Binary {
            op: BinOp::Add | BinOp::Sub,
            ..
        }
    );
    is_sum.then_some(parent)
}

fn is_used_as_int32(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    number: ExprId,
    answers: &mut FxHashMap<ExprId, bool>,
) -> bool {
    let mut walked: SmallVec<[ExprId; 4]> = SmallVec::new();
    let mut value = number;
    let answer = loop {
        match find_use(hir, bound, value) {
            Use::Int32 | Use::Key { .. } => break true,
            Use::Stored { op: Some(op), .. } => break yields_int32(op) || op == BinOp::UShr,
            Use::AddedTo(_) | Use::Number => match find_enclosing_sum(hir, bound, value) {
                Some(sum) => match answers.get(&sum) {
                    Some(&known) => break known,
                    None => {
                        walked.push(sum);
                        value = sum;
                    }
                },
                None => break false,
            },
            Use::Nothing
            | Use::PassedOn(_)
            | Use::Initializes(_)
            | Use::Destructured(_)
            | Use::Member { .. }
            | Use::Keyed { .. }
            | Use::Called { .. }
            | Use::Argument { .. }
            | Use::Iterated(_)
            | Use::Object { .. }
            | Use::Updated
            | Use::ComparedWith(_)
            | Use::Stored { op: None, .. } => break false,
        }
    };
    answers.extend(walked.into_iter().map(|sum| (sum, answer)));
    answer
}

fn find_name_of_function(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    function: FnId,
) -> Option<SymbolId> {
    match bound.fns[function.idx()].owner {
        FnOwner::Stmt(_) => bound.fn_symbol[function.idx()].some(),
        FnOwner::Expr(expression) => match bound.parent_of_expr(expression) {
            Parent::VarInit(declaration) => find_initialized_symbol(bound, hir[declaration].pat),
            _ => None,
        },
        FnOwner::None | FnOwner::Member(_) | FnOwner::Type(_) => None,
    }
}

fn find_argument_of_call(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    first_spread_arguments: &mut FxHashMap<ExprId, u32>,
    callee: ExprId,
    index: usize,
) -> Option<ExprId> {
    let Parent::Expr(call) = bound.parent_of_expr(callee) else {
        return None;
    };
    let call = call.some()?;
    let ExprKind::Call(site) = hir[call].kind else {
        return None;
    };
    let node = hir[site];
    if node.callee != callee {
        return None;
    }
    let first_spread = *first_spread_arguments.entry(call).or_insert_with(|| {
        let mut arguments = hir.ids(node.args);
        let spread = arguments.position(|it| matches!(hir[it].kind, ExprKind::Spread(_)));
        spread.map_or(u32::MAX, |position| position as u32)
    });
    if first_spread as usize <= index {
        return None;
    }
    match index < node.args.len() {
        true => Some(hir.id_at(node.args, index)),
        false => Some(ExprId::NONE),
    }
}

fn find_parameter(parameters: &[SigParam], index: usize) -> Option<SigParam> {
    parameters
        .get(index)
        .copied()
        .filter(|parameter| !parameter.rest)
}

#[derive(Copy, Clone)]
struct CallWithReceiver {
    signature: SigId,
    takes_argument_list: bool,
}

type TypeParts = SmallVec<[TypeId; 4]>;

pub(super) struct ArgumentsGiven {
    pub(super) written: SmallVec<[ExprId; 4]>,
    others_may_call: bool,
}
type ContentsOfLiteral = (FileId, SmallVec<[(Atom, PropFlags, TypeId); 4]>);
type ReturnedExpressions = SmallVec<[(ExprId, TypeId); 4]>;

impl<'c, 'p, 's> Queries<'c, 'p, 's> {
    fn are_positions_only_expected(&self, of: FileId) -> bool {
        match self.role(of) {
            FileRole::Inferred => true,
            FileRole::Checked | FileRole::TypesOnly => false,
        }
    }

    fn is_null_or_undefined_alone(&self, ty: TypeId) -> bool {
        match self.c.data(ty) {
            TypeData::Union(members) => members.iter().all(|&member| self.c.is_nullish(member)),
            _ => self.c.is_nullish(ty),
        }
    }

    fn says_nothing_of_what_is_stored_later(&self, checked: TypeId) -> bool {
        self.c.is_any(checked)
            || self.are_positions_only_expected(self.file)
                && self.is_null_or_undefined_alone(checked)
    }

    fn says_nothing_of_what_is_handed(&mut self, checked: TypeId) -> bool {
        self.says_nothing_of_what_is_stored_later(checked)
            || self.are_positions_only_expected(self.file)
                && self.c.is_empty_anonymous_object_type(checked)
    }

    pub(super) fn infer_parameter_type(
        &mut self,
        of: FileId,
        parameter: ParamId,
        checked: TypeId,
    ) -> TypeId {
        match self.find_parameter_subject(of, parameter, checked) {
            Some(subject) if self.are_positions_only_expected(of) => {
                self.inferred_argument_type_or(subject, checked)
            }
            Some(_) | None => checked,
        }
    }

    pub(super) fn is_read_under_numbers_alone(&mut self, pattern: PatId) -> bool {
        let (hir, bound) = (self.hir(), self.bound());
        let Some(symbol) = find_initialized_symbol(bound, pattern) else {
            return false;
        };
        let mut keys: SmallVec<[ExprId; 4]> = SmallVec::new();
        for &(_, reference) in references_to(self.references_to_bindings(), symbol) {
            let mut value = reference;
            let found = loop {
                match find_use(hir, bound, value) {
                    Use::PassedOn(whole) => value = whole,
                    found => break found,
                }
            };
            if let Use::Keyed { key, .. } = found {
                keys.push(key);
            }
        }
        if keys.is_empty() {
            return false;
        }
        for key in keys {
            let Some(key_type) = self.type_for_evidence(key) else {
                return false;
            };
            if !self.is_number_type(key_type) {
                return false;
            }
        }
        true
    }

    pub(super) fn infer_binding_type(&mut self, pattern: PatId, checked: TypeId) -> TypeId {
        let (hir, bound) = (self.hir(), self.bound());
        let is_untyped_name = matches!(hir[pattern].kind, PatKind::Ident(_))
            && !has_written_type(hir, bound, pattern)
            && self.are_positions_only_expected(self.file);
        let Some(symbol) = find_initialized_symbol(bound, pattern).filter(|_| is_untyped_name)
        else {
            return checked;
        };
        if checked == TypeId::NUMBER {
            return self.inferred_type_or(Subject::Number(symbol), checked);
        }
        let says_nothing = match bound.pat_parent[pattern.idx()] {
            PatParent::Param(parameter) if has_empty_default(hir, parameter) => {
                self.says_nothing_of_what_is_handed(checked)
            }
            PatParent::Param(_) => self.says_nothing_of_what_is_stored_later(checked),
            PatParent::None | PatParent::Var(_) | PatParent::Prop(..) | PatParent::Elem(..) => {
                self.says_nothing_of_what_is_stored_later(checked)
            }
        };
        if !says_nothing {
            return checked;
        }
        match bound.pat_parent[pattern.idx()] {
            PatParent::Param(_) => {
                self.inferred_argument_type_or(Subject::Binding(symbol), checked)
            }
            PatParent::None | PatParent::Var(_) | PatParent::Prop(..) | PatParent::Elem(..) => {
                self.inferred_type_or(Subject::Binding(symbol), checked)
            }
        }
    }

    pub fn is_binding_of_builtin(
        &mut self,
        pattern: PatId,
        class: BuiltinClassIndex,
    ) -> Result<bool, GaveUp> {
        let checked = self.ask(|queries| {
            let ty = queries.c.type_of_pat(queries.file, pattern);
            queries.resolved(ty)
        });
        if checked != Err(GaveUp::ErrorType) {
            let checked = checked?;
            if self.is_type_of_builtin(checked, class)? {
                return Ok(true);
            }
            if !self.is_type_of_every_object(checked)? {
                return Ok(false);
            }
        }
        let (hir, bound) = (self.hir(), self.bound());
        let Some(symbol) = find_initialized_symbol(bound, pattern) else {
            return Ok(false);
        };
        let mut stored: SmallVec<[ExprId; 2]> = SmallVec::new();
        match bound.pat_parent[pattern.idx()] {
            PatParent::Var(variable) => stored.extend(hir[variable].init.some()),
            PatParent::Param(parameter) => stored.extend(self.find_arguments_in_sight(parameter)),
            PatParent::None | PatParent::Prop(..) | PatParent::Elem(..) => {}
        }
        for &(_, reference) in references_to(self.references_to_bindings(), symbol) {
            let mut value = reference;
            let found = loop {
                match find_use(hir, bound, value) {
                    Use::PassedOn(whole) => value = whole,
                    found => break found,
                }
            };
            if let Use::Stored { op: None, value } = found {
                stored.push(value);
            }
        }
        for value in stored {
            let ty = match self.expression_type(value) {
                Err(GaveUp::UnreachedNode | GaveUp::ErrorType) => continue,
                ty => ty?,
            };
            if self.is_type_of_builtin(ty, class)? {
                return Ok(true);
            }
        }
        Ok(false)
    }

    pub fn classes_handed_to_mixin(&mut self, heritage: ExprId, most: usize) -> Vec<ClassRef> {
        let (hir, bound) = (self.hir(), self.bound());
        if !matches!(hir[heritage].kind, ExprKind::Ident(_)) {
            return Vec::new();
        }
        let Binding::Symbol(symbol) = bound.binding(heritage) else {
            return Vec::new();
        };
        let &[Decl::Param(name)] = bound.symbol(symbol).decls else {
            return Vec::new();
        };
        let PatParent::Param(parameter) = bound.pat_parent[name.idx()] else {
            return Vec::new();
        };
        let mut classes: Vec<ClassRef> = Vec::new();
        for argument in self.find_arguments_in_sight(parameter) {
            let Ok(ty) = self.expression_type(argument) else {
                continue;
            };
            let class = match self.type_shape(ty).map(|shape| shape.kind) {
                Ok(ShapeKind::ClassConstructor(class)) => Some(class),
                _ => self.nearest_class_joined_in(ty),
            };
            if let Some(class) = class
                && !classes.contains(&class)
            {
                classes.push(class);
            }
            if classes.len() > most {
                return Vec::new();
            }
        }
        classes
    }

    fn find_arguments_in_sight(&mut self, parameter: ParamId) -> SmallVec<[ExprId; 2]> {
        let (hir, bound) = (self.hir(), self.bound());
        let function = bound.param_fn[parameter.idx()];
        if function == FnId::NONE || hir[parameter].flags.contains(Flags::REST) {
            return SmallVec::new();
        }
        let Some(index) = hir[function].params.position_of(parameter.idx()) else {
            return SmallVec::new();
        };
        let mut callees: SmallVec<[ExprId; 2]> = SmallVec::new();
        if let FnOwner::Expr(expression) = bound.fns[function.idx()].owner {
            callees.push(expression);
        }
        if let Some(name) = find_name_of_function(hir, bound, function) {
            let references = references_to(self.references_to_bindings(), name);
            callees.extend(references.iter().map(|reference| reference.1));
        }
        let first_spreads = &mut self.memo.first_spread_arguments;
        let arguments = callees.into_iter().filter_map(|callee| {
            find_argument_of_call(hir, bound, first_spreads, callee, index)?.some()
        });
        arguments.collect()
    }

    pub(super) fn are_names_alone_read_off_field(&mut self, class: ClassRef, field: Atom) -> bool {
        let (hir, bound) = (self.hir(), self.bound());
        let reads = self.reads_of_field_off_this(class.class, field);
        reads.into_iter().all(|access| {
            let found = find_use(hir, bound, access);
            matches!(
                found,
                Use::Member { .. } | Use::Stored { .. } | Use::Nothing
            )
        })
    }

    pub(super) fn infer_field_type(
        &mut self,
        class: ClassRef,
        field: Atom,
        position: u32,
    ) -> TypeId {
        if class.file != self.file || !self.are_positions_only_expected(class.file) {
            return TypeId::ANY;
        }
        self.memo
            .names_of_fields_asked_about
            .insert(position, (class.class, field));
        self.inferred_type(Subject::Field(position))
    }

    pub(super) fn infer_this_type(&mut self, of: FileId, function: FnId) -> TypeId {
        match self.find_this_subject(of, function) {
            Some(subject) => self.inferred_type(subject),
            None => TypeId::ANY,
        }
    }

    pub(super) fn infer_result_type(
        &mut self,
        of: FileId,
        function: FnId,
        checked: TypeId,
    ) -> TypeId {
        let is_untyped = self.c.is_any(checked) && self.are_positions_only_expected(of);
        match self.find_result_subject(of, function) {
            Some(subject) if is_untyped => self.inferred_type_or(subject, checked),
            Some(_) | None => checked,
        }
    }

    pub(super) fn infer_expression_type(&mut self, expression: ExprId, checked: TypeId) -> TypeId {
        match self.find_subject_of_expression(expression, checked) {
            Some(subject) => self.inferred_type_or(subject, checked),
            None => checked,
        }
    }

    pub(super) fn find_subject_of_expression(
        &self,
        expression: ExprId,
        checked: TypeId,
    ) -> Option<Subject> {
        match self.c.is_any(checked) {
            true => Some(Subject::Expression(expression)),
            false => self.find_number_subject(expression, checked),
        }
    }

    fn inferred_argument_type_or(&mut self, subject: Subject, checked: TypeId) -> TypeId {
        match self.inferred_type_or(subject, checked) {
            TypeId::NUMBER => checked,
            inferred => inferred,
        }
    }

    fn inferred_type_or(&mut self, subject: Subject, checked: TypeId) -> TypeId {
        let inferred = self.inferred_type(subject);
        match self.c.is_any(inferred) {
            true => checked,
            false if self.is_null_or_undefined_alone(checked) => self.c.union(&[checked, inferred]),
            false => inferred,
        }
    }

    fn find_parameter_subject(
        &mut self,
        of: FileId,
        parameter: ParamId,
        checked: TypeId,
    ) -> Option<Subject> {
        if of != self.file {
            return None;
        }
        let (hir, bound) = (self.hir(), self.bound());
        let node = hir[parameter];
        if node.ty.is_some() {
            return None;
        }
        match hir[node.pat].kind {
            PatKind::Ident(_)
                if match has_empty_default(hir, parameter) {
                    true => self.says_nothing_of_what_is_handed(checked),
                    false => self.says_nothing_of_what_is_stored_later(checked),
                } =>
            {
                find_initialized_symbol(bound, node.pat).map(Subject::Binding)
            }
            PatKind::Object(_) if self.is_implied_by_pattern(checked, node.pat) => {
                Some(Subject::Pattern(node.pat))
            }
            PatKind::Ident(_) | PatKind::Object(_) | PatKind::Array(_) | PatKind::Missing => None,
        }
    }

    fn is_implied_by_pattern(&self, ty: TypeId, pattern: PatId) -> bool {
        let position = (self.file, self.hir()[pattern].pos);
        matches!(self.c.data(ty), TypeData::Synth(shape) if shape.pattern_at == Some(position))
    }

    fn find_this_subject(&self, of: FileId, function: FnId) -> Option<Subject> {
        if of != self.file {
            return None;
        }
        let node = self.hir()[function];
        let has_own_this = match node.kind {
            FnKind::Decl | FnKind::Expr | FnKind::Method | FnKind::Getter | FnKind::Setter => true,
            FnKind::Arrow
            | FnKind::Constructor
            | FnKind::StaticBlock
            | FnKind::CallSignature
            | FnKind::ConstructSignature
            | FnKind::FunctionType
            | FnKind::ConstructorType
            | FnKind::IndexSignature => false,
        };
        let is_untyped =
            node.this_param.is_none() && self.c.class_of_member_fn(of, function).is_none();
        (has_own_this && is_untyped).then_some(Subject::This(function))
    }

    fn find_result_subject(&self, of: FileId, function: FnId) -> Option<Subject> {
        if of != self.file {
            return None;
        }
        let node = self.hir()[function];
        let returns_a_value = match node.kind {
            FnKind::Decl | FnKind::Expr | FnKind::Arrow | FnKind::Method | FnKind::Getter => true,
            FnKind::Setter
            | FnKind::Constructor
            | FnKind::StaticBlock
            | FnKind::CallSignature
            | FnKind::ConstructSignature
            | FnKind::FunctionType
            | FnKind::ConstructorType
            | FnKind::IndexSignature => false,
        };
        let wraps_the_value = node.flags.intersects(Flags::ASYNC | Flags::GENERATOR);
        (returns_a_value && !wraps_the_value && node.ret.is_none())
            .then_some(Subject::Result(function))
    }

    fn find_result_subject_of_call(&mut self, call: ExprId) -> Option<Subject> {
        if !matches!(self.hir()[call].kind, ExprKind::Call(_)) {
            return None;
        }
        let declaration = self.resolved_call(call).ok()??.declaration?;
        self.find_result_subject(declaration.file, declaration.function)
    }

    fn find_referenced_subject(&self, expression: ExprId) -> Option<Subject> {
        let (hir, bound) = (self.hir(), self.bound());
        if matches!(hir[expression].kind, ExprKind::This) {
            return match self.c.this_container(self.file, expression) {
                Some(Ok(function)) => self.find_this_subject(self.file, function),
                Some(Err(_)) | None => None,
            };
        }
        if !matches!(hir[expression].kind, ExprKind::Ident(_)) {
            return None;
        }
        match bound.binding(expression) {
            Binding::Symbol(symbol) if is_untyped_variable(hir, bound, symbol) => {
                Some(Subject::Binding(symbol))
            }
            Binding::Symbol(_) | Binding::Arguments(_) | Binding::CommonJs(_) | Binding::Free => {
                None
            }
        }
    }

    fn find_number_subject(&self, expression: ExprId, checked: TypeId) -> Option<Subject> {
        if checked != TypeId::NUMBER {
            return None;
        }
        match self.find_referenced_subject(expression) {
            Some(Subject::Binding(symbol)) => Some(Subject::Number(symbol)),
            Some(
                Subject::Pattern(_)
                | Subject::This(_)
                | Subject::Field(_)
                | Subject::Result(_)
                | Subject::Expression(_)
                | Subject::Number(_),
            )
            | None => None,
        }
    }

    fn inferred_type(&mut self, subject: Subject) -> TypeId {
        if self.memo.types_in_progress.subjects.depth != 0 {
            return self.inferred_type_within_allowance(subject);
        }
        if let Some(&TypeState::Known(known)) = self.memo.inferred_types.get(&subject) {
            return known;
        }
        if self.inputs.max_inference_nodes == 0 {
            return TypeId::ANY;
        }
        let question = self.memo.types_in_progress.enter();
        let first_answer = self.inferred_type_with_new_allowance(subject);
        let in_progress = &self.memo.types_in_progress;
        if !in_progress.in_cycles.is_empty() || !in_progress.out_of_reach.is_empty() {
            self.infer_types_out_of_reach();
        }
        self.memo.types_in_progress.leave(question);
        match self.memo.inferred_types.get(&subject) {
            Some(&TypeState::Known(known)) => known,
            _ => first_answer,
        }
    }

    fn inferred_type_with_new_allowance(&mut self, subject: Subject) -> TypeId {
        self.memo.types_in_progress.remaining_types = self.inputs.max_inference_nodes;
        self.inferred_type_within_allowance(subject)
    }

    #[cold]
    fn infer_types_out_of_reach(&mut self) {
        loop {
            let mut walks: SmallVec<[usize; 4]> = SmallVec::new();
            walks.push(0);
            while let Some(next) = self.memo.types_in_progress.out_of_reach.pop() {
                let state = self.memo.inferred_types.get(&next);
                if !state.is_some_and(|state| state.was_computed()) {
                    walks.push(self.memo.types_in_progress.in_cycles.len());
                    self.inferred_type_with_new_allowance(next);
                }
            }
            let unsettled = std::mem::take(&mut self.memo.types_in_progress.in_cycles);
            if unsettled.is_empty() {
                return;
            }
            self.assume_types_found(&unsettled);
            self.memo.types_in_progress.is_computing_again = true;
            let mut end = unsettled.len();
            for &start in walks.iter().rev() {
                for &other in &unsettled[start..end] {
                    self.inferred_type_with_new_allowance(other);
                }
                end = start;
            }
            self.memo.types_in_progress.is_computing_again = false;
        }
    }

    fn assume_types_found(&mut self, in_cycle: &[Subject]) {
        for other in in_cycle {
            if let Some(state) = self.memo.inferred_types.get_mut(other)
                && let TypeState::InCycle { found, .. } = *state
            {
                *state = TypeState::Assumed(found);
            }
        }
    }

    fn infer_types_of_cycle_again(&mut self, first_in_cycle: usize) {
        let in_cycles = &mut self.memo.types_in_progress.in_cycles;
        let in_cycle: Vec<Subject> = in_cycles.drain(first_in_cycle..).collect();
        self.assume_types_found(&in_cycle);
        for &other in &in_cycle {
            self.inferred_type_within_allowance(other);
        }
        if self.memo.types_in_progress.remaining_types != 0 {
            return;
        }
        for &other in &in_cycle {
            if let Some(&TypeState::Assumed(found)) = self.memo.inferred_types.get(&other) {
                self.leave_type_in_cycle(other, found);
            }
        }
    }

    fn leave_type_in_cycle(&mut self, subject: Subject, found: TypeId) {
        let in_cycles = &mut self.memo.types_in_progress.in_cycles;
        let position = in_cycles.len() as u32;
        in_cycles.push(subject);
        let state = TypeState::InCycle { found, position };
        self.memo.inferred_types.insert(subject, state);
    }

    fn count_answers_not_kept(&self) -> u64 {
        self.count_unstable_answers() + self.memo.types_in_progress.subjects_not_kept
    }

    fn inferred_type_within_allowance(&mut self, subject: Subject) -> TypeId {
        if self.infers_nothing_from_use {
            return TypeId::ANY;
        }
        let in_progress = &mut self.memo.types_in_progress;
        let state = self.memo.inferred_types.get(&subject).copied();
        let assumed = match state {
            Some(TypeState::Known(known)) => return known,
            Some(TypeState::InProgress {
                depth,
                assumed: None,
            }) => {
                in_progress.subjects.revisit(depth as usize);
                return TypeId::ANY;
            }
            Some(TypeState::InProgress {
                assumed: Some(assumed),
                ..
            }) => return assumed,
            Some(TypeState::InCycle { found, position }) => {
                in_progress.revisit_in_cycle(position);
                return found;
            }
            Some(TypeState::Assumed(found)) => Some(found),
            Some(
                TypeState::NotKept
                | TypeState::Searched { .. }
                | TypeState::Alone
                | TypeState::Member { .. },
            )
            | None => None,
        };
        let was_computed = state.is_some_and(TypeState::was_computed);
        if in_progress.subjects.depth > 1 && self.c.is_half_of_stack_in_use() {
            in_progress.remaining_types = 0;
        }
        if in_progress.remaining_types == 0 {
            if let Some(found) = assumed {
                if !in_progress.is_computing_again {
                    in_progress.subjects.revisit(0);
                }
                return found;
            }
            match was_computed {
                false => {
                    if !in_progress.is_computing_again {
                        in_progress.subjects.revisit(0);
                    }
                    in_progress.out_of_reach.push(subject);
                }
                true => in_progress.subjects_not_kept += 1,
            }
            return TypeId::ANY;
        }
        let may_be_in_cycle = !was_computed && !matches!(state, Some(TypeState::Alone));
        if may_be_in_cycle && self.infer_types_of_cycle_around(subject) {
            return self.inferred_type_within_allowance(subject);
        }
        let in_progress = &mut self.memo.types_in_progress;
        in_progress.remaining_types -= 1;
        self.statistics.types_inferred += 1;
        let first_in_cycle = in_progress.in_cycles.len();
        let entered = in_progress.enter();
        let state = TypeState::InProgress {
            depth: entered.depth as u32,
            assumed,
        };
        self.memo.inferred_types.insert(subject, state);
        let answers_not_kept = self.count_answers_not_kept();
        let inferred = self.ask(|queries| {
            Ok(match subject {
                Subject::Expression(expression) => queries.compute_expression_type(expression),
                Subject::Result(function) => queries.compute_result_type(function),
                Subject::Number(symbol) => queries.compute_number_type(symbol),
                Subject::Binding(symbol) => queries.compute_binding_type(symbol),
                Subject::Pattern(_) | Subject::This(_) | Subject::Field(_) => {
                    queries.compute_type_from_uses(subject)
                }
            })
        });
        let inferred = inferred.unwrap_or(TypeId::ANY);
        let leads_back = self.memo.types_in_progress.leave(entered);
        if self.count_answers_not_kept() != answers_not_kept {
            let in_cycles = &mut self.memo.types_in_progress.in_cycles;
            for other in in_cycles.drain(first_in_cycle..) {
                self.memo.inferred_types.insert(other, TypeState::NotKept);
            }
            self.memo.inferred_types.insert(subject, TypeState::NotKept);
        } else if leads_back {
            self.leave_type_in_cycle(subject, inferred);
        } else {
            let known = TypeState::Known(inferred);
            self.memo.inferred_types.insert(subject, known);
            let in_progress = &self.memo.types_in_progress;
            if in_progress.in_cycles.len() > first_in_cycle && in_progress.remaining_types != 0 {
                self.infer_types_of_cycle_again(first_in_cycle);
            }
        }
        inferred
    }

    #[inline(never)]
    fn infer_types_of_cycle_around(&mut self, subject: Subject) -> bool {
        let Some(cycle) = self.take_cycle_of(subject) else {
            return false;
        };
        for &member in &cycle {
            self.inferred_type_within_allowance(member);
        }
        true
    }

    fn take_cycle_of(&mut self, subject: Subject) -> Option<Box<[Subject]>> {
        if matches!(
            subject,
            Subject::Pattern(_) | Subject::This(_) | Subject::Field(_)
        ) {
            return None;
        }
        let mut state = self.memo.inferred_types.get(&subject);
        if state.is_none() {
            self.find_cycles_from(subject);
            state = self.memo.inferred_types.get(&subject);
        }
        match state {
            Some(&TypeState::Member { cycle }) => {
                self.memo.types_in_progress.cycles[cycle as usize].take()
            }
            _ => None,
        }
    }

    fn find_cycles_from(&mut self, start: Subject) {
        let mut path: SmallVec<[SubjectSearched; 4]> = SmallVec::new();
        let mut open: SmallVec<[Subject; 8]> = SmallVec::new();
        let mut next = Some(start);
        let mut count = 0;
        loop {
            if let Some(subject) = next.take() {
                let asks_for = self.find_subjects_asked_for(subject);
                let types = &mut self.memo.inferred_types;
                let leads_on = asks_for.iter().any(|asked_for| match types.get(asked_for) {
                    Some(TypeState::Searched { .. }) | None => *asked_for != subject,
                    Some(_) => false,
                });
                if leads_on {
                    let index = count;
                    count += 1;
                    types.insert(subject, TypeState::Searched { index });
                    open.push(subject);
                    path.push(SubjectSearched {
                        subject,
                        index,
                        lowest_index: index,
                        asks_for,
                        next: 0,
                    });
                } else {
                    types.insert(subject, TypeState::Alone);
                }
            }
            let Some(searched) = path.last_mut() else {
                return;
            };
            if let Some(&asked_for) = searched.asks_for.get(searched.next) {
                searched.next += 1;
                match self.memo.inferred_types.get(&asked_for) {
                    Some(&TypeState::Searched { index }) => {
                        searched.lowest_index = searched.lowest_index.min(index);
                    }
                    Some(_) => {}
                    None => next = Some(asked_for),
                }
                continue;
            }
            let (subject, index, lowest_index) =
                (searched.subject, searched.index, searched.lowest_index);
            path.pop();
            if let Some(asked_for_it) = path.last_mut() {
                asked_for_it.lowest_index = asked_for_it.lowest_index.min(lowest_index);
            }
            if lowest_index != index {
                continue;
            }
            if open.last() == Some(&subject) {
                open.pop();
                self.memo.inferred_types.insert(subject, TypeState::Alone);
                continue;
            }
            let first = open.iter().rposition(|&other| other == subject);
            let mut members: Vec<Subject> = open.drain(first.unwrap_or(0)..).collect();
            members.sort_unstable();
            let cycles = &mut self.memo.types_in_progress.cycles;
            let cycle = cycles.len() as u32;
            for &member in &members {
                let state = TypeState::Member { cycle };
                self.memo.inferred_types.insert(member, state);
            }
            cycles.push(Some(members.into_boxed_slice()));
        }
    }

    fn find_subjects_asked_for(&mut self, subject: Subject) -> Subjects {
        let mut asked_for = Subjects::new();
        match subject {
            Subject::Binding(symbol) => {
                self.add_subjects_a_binding_asks_for(symbol, &mut asked_for);
            }
            Subject::Expression(expression) => {
                if let Some(referenced) = self.find_referenced_subject(expression) {
                    if !matches!(referenced, Subject::This(_)) {
                        asked_for.push(referenced);
                    }
                    return asked_for;
                }
                let receiver = self.find_untyped_receiver(expression);
                asked_for.extend(receiver.map(Subject::Expression));
                let receiver = self.find_untyped_receiver_of_method_call(expression);
                asked_for.extend(receiver.map(Subject::Expression));
                asked_for.extend(self.find_result_subject_of_call(expression));
            }
            Subject::Result(function) => {
                for (returned, checked) in self.find_returned_expressions(function) {
                    asked_for.extend(self.find_subject_of_expression(returned, checked));
                }
            }
            Subject::Number(symbol) => {
                let mut walk = self.new_walk();
                walk.numbers_listed = Some(asked_for);
                self.holds_integers(&mut walk, symbol);
                return walk.numbers_listed.unwrap_or_default();
            }
            Subject::Pattern(_) | Subject::This(_) | Subject::Field(_) => {}
        }
        asked_for
    }

    fn add_subjects_a_binding_asks_for(&mut self, symbol: SymbolId, asked_for: &mut Subjects) {
        let &[Decl::Param(name)] = self.bound().symbol(symbol).decls else {
            if let Some(initializer) = self.find_initializer_of_constant(symbol) {
                let receiver = self.find_untyped_receiver_of_method_call(initializer);
                asked_for.extend(receiver.map(Subject::Expression));
            }
            return;
        };
        let declared = self.find_declared_parameter_type(name);
        if !self.c.is_any(declared) {
            return;
        }
        let mut walk = self.new_walk();
        if let Some(usage) = self.usage_of(&mut walk, Subject::Binding(symbol))
            && usage.members.is_empty()
            && !usage.is_incomplete()
        {
            let used_as = self.type_of_usage(&usage);
            if !self.c.is_any(used_as) && used_as != TypeId::OBJECT {
                return;
            }
        }
        let given = self.find_arguments_given(name);
        for argument in given.map(|given| given.written).unwrap_or_default() {
            if let Some(argument) = argument.some()
                && let Ok(checked) = self.expression_type(argument)
            {
                asked_for.extend(self.find_subject_of_expression(argument, checked));
            }
        }
    }

    fn compute_binding_type(&mut self, symbol: SymbolId) -> TypeId {
        let &[Decl::Param(name)] = self.bound().symbol(symbol).decls else {
            return match self.find_type_a_constant_is_made_with(symbol) {
                Some(made) => made,
                None => self.compute_type_from_uses(Subject::Binding(symbol)),
            };
        };
        let declared = self.find_declared_parameter_type(name);
        if !self.c.is_any(declared) {
            return declared;
        }
        let mut walk = self.new_walk();
        let Some(usage) = self.usage_of(&mut walk, Subject::Binding(symbol)) else {
            return self.compute_type_from_arguments(name).0;
        };
        if usage.members.is_empty() && !usage.is_incomplete() {
            let used_as = self.type_of_usage(&usage);
            if !self.c.is_any(used_as) && used_as != TypeId::OBJECT {
                return used_as;
            }
            let (given, _) = self.compute_type_from_arguments(name);
            let says_more = used_as != TypeId::OBJECT
                || self.c.every_type(given, |c, part| {
                    c.flags(part) & crate::types::tf::OBJECT != 0
                });
            return match !self.c.is_any(given) && says_more {
                true => given,
                false => used_as,
            };
        }
        let (given, others_may_call) = self.compute_type_from_arguments(name);
        let is_named_whole = others_may_call
            && (self.c.members(given))
                .is_some_and(|members| members.shape().props.len() == usage.members.len());
        if !self.c.is_any(given) && !is_named_whole && self.has_every_member(given, &usage.members)
        {
            return given;
        }
        let used_as = self.type_of_usage(&usage);
        match self.c.is_any(used_as) {
            true => given,
            false => used_as,
        }
    }

    fn find_type_a_constant_is_made_with(&mut self, symbol: SymbolId) -> Option<TypeId> {
        let initializer = self.find_initializer_of_constant(symbol)?;
        let made = self.find_result_of_inferred_method(initializer)?;
        match self.c.array_element(made) {
            Some(element) if self.c.is_any(element) => None,
            Some(_) | None => Some(made),
        }
    }

    fn find_initializer_of_constant(&self, symbol: SymbolId) -> Option<ExprId> {
        let (hir, bound) = (self.hir(), self.bound());
        let &[Decl::Var(name)] = bound.symbol(symbol).decls else {
            return None;
        };
        let PatParent::Var(variable) = bound.pat_parent[name.idx()] else {
            return None;
        };
        match hir[variable].kind {
            VarKind::Const => hir[variable].init.some(),
            _ => None,
        }
    }

    fn find_arguments_given(&mut self, name: PatId) -> Option<ArgumentsGiven> {
        let (hir, bound) = (self.hir(), self.bound());
        let PatParent::Param(parameter) = bound.pat_parent[name.idx()] else {
            return None;
        };
        let function = bound.param_fn[parameter.idx()];
        if function == FnId::NONE || hir[parameter].flags.contains(Flags::REST) {
            return None;
        }
        let index = hir[function].params.position_of(parameter.idx())?;
        let callee = find_name_of_function(hir, bound, function)?;
        let references = references_to(self.references_to_bindings(), callee);
        let is_exported = self.is_exported(callee);
        let first_spreads = &mut self.memo.first_spread_arguments;
        let arguments = references.iter().filter_map(|&(_, reference)| {
            find_argument_of_call(hir, bound, first_spreads, reference, index)
        });
        let written: SmallVec<[ExprId; 4]> = arguments.collect();
        let others_may_call = is_exported || written.len() < references.len();
        (!written.is_empty()).then_some(ArgumentsGiven {
            written,
            others_may_call,
        })
    }

    pub fn is_given_by_written_calls_alone(&mut self, name: PatId) -> bool {
        self.find_arguments_given(name)
            .is_some_and(|given| !given.others_may_call)
    }

    fn compute_type_from_arguments(&mut self, name: PatId) -> (TypeId, bool) {
        let Some(given) = self.find_arguments_given(name) else {
            return (TypeId::ANY, true);
        };
        let others_may_call = given.others_may_call;
        let handed = self.compute_type_of_arguments(given.written);
        match others_may_call && self.c.is_union(handed) {
            true => (TypeId::ANY, true),
            false => (handed, others_may_call),
        }
    }

    fn compute_type_of_arguments(&mut self, arguments: SmallVec<[ExprId; 4]>) -> TypeId {
        let is_called_once = arguments.len() == 1;
        let mut parts = TypeParts::new();
        let mut literals_listed = FxHashMap::default();
        let (mut all_given, mut given_listed) = (TypeParts::new(), FxHashSet::default());
        for argument in arguments {
            let given = match argument.some() {
                Some(argument) => self.predicted_expression_type(argument),
                None => Ok(TypeId::UNDEFINED),
            };
            match given {
                Ok(given) if !self.c.is_any(given) => {
                    if !crate::util::is_listed(&all_given, &mut given_listed, given) {
                        all_given.push(given);
                        let given = self.c.base_of_literal(given);
                        self.add_parts_that_differ(given, &mut parts, &mut literals_listed);
                    }
                }
                Ok(_) | Err(_) => return TypeId::ANY,
            }
        }
        match parts[..] {
            [] => TypeId::ANY,
            [TypeId::UNDEFINED] if is_called_once => TypeId::ANY,
            _ => self.c.union(&parts),
        }
    }

    fn add_parts_that_differ(
        &mut self,
        given: TypeId,
        parts: &mut TypeParts,
        literals_listed: &mut FxHashMap<ContentsOfLiteral, usize>,
    ) {
        let alone = [given];
        let members: &[TypeId] = match self.c.data(given) {
            TypeData::Union(members) => members,
            _ => &alone,
        };
        for &member in members {
            let listed = self
                .find_contents_of_literal(member)
                .map(|contents| *literals_listed.entry(contents).or_insert(parts.len()));
            match listed {
                Some(first) if first < parts.len() => {
                    if self.compute_object_origin(member) < self.compute_object_origin(parts[first])
                    {
                        parts[first] = member;
                    }
                }
                Some(_) | None => parts.push(member),
            }
        }
    }

    fn find_contents_of_literal(&mut self, ty: TypeId) -> Option<ContentsOfLiteral> {
        if !self.c.is_closed_object_literal_type(ty) {
            return None;
        }
        let ObjectOrigin::ObjectLiteral { file, .. } = self.compute_object_origin(ty) else {
            return None;
        };
        let members = self.c.members(ty)?;
        let shape = members.shape();
        let is_listed_in_layout = |name: Atom| match self.atom_bytes(name) {
            b"__proto__" | b"Infinity" | b"NaN" | [] => false,
            [first, ..] => first.is_ascii_alphabetic() || matches!(first, b'_' | b'$'),
        };
        if shape.props.is_empty()
            || members.has_signatures()
            || !shape.index.is_empty()
            || !shape
                .props
                .iter()
                .all(|property| is_listed_in_layout(property.name))
        {
            return None;
        }
        let contents = shape.props.iter().map(|property| {
            let holds = self.c.type_of_prop(property, members.mapper);
            (property.name, property.flags, holds)
        });
        Some((file, contents.collect()))
    }

    fn is_exported(&mut self, symbol: SymbolId) -> bool {
        let files = self.files();
        let symbol = files.sym(self.file, symbol);
        let file = self.file;
        let exported = self.memo.exported_symbols.get_or_insert_with(|| {
            let exports = files.exports_of_module(files.file_symbol(file));
            let resolved = exports
                .iter()
                .filter_map(|&(_, export)| files.resolve_alias_if_needed(export));
            resolved.collect()
        });
        exported.contains(&symbol)
    }

    fn compute_result_type(&mut self, function: FnId) -> TypeId {
        let mut result = Usage::default();
        for (returned, checked) in self.find_returned_expressions(function) {
            let expected = self.infer_expression_type(returned, checked);
            let expected = self.c.widened_member_by_member(expected);
            self.add_arm(&mut result, expected);
        }
        self.type_of_usage(&result)
    }

    fn find_returned_expressions(&mut self, function: FnId) -> ReturnedExpressions {
        let (hir, bound) = (self.hir(), self.bound());
        let mut found = ReturnedExpressions::new();
        match hir[function].body {
            FnBody::None => {}
            FnBody::Expr(returned) => self.add_returned_expressions(returned, &mut found),
            FnBody::Block(_) => {
                for statement in bound.ids(bound.fns[function.idx()].returns) {
                    if let StmtKind::Return(returned) = hir[statement].kind
                        && returned.is_some()
                    {
                        self.add_returned_expressions(returned, &mut found);
                    }
                }
            }
        }
        found
    }

    fn type_for_evidence(&mut self, expression: ExprId) -> Option<TypeId> {
        match self.expression_type(expression) {
            Ok(checked) => Some(checked),
            Err(GaveUp::UnreachedNode | GaveUp::ErrorType) => None,
            Err(GaveUp::Unresolved | GaveUp::FlowAnalysisDisabled | GaveUp::OutOfStack) => None,
        }
    }

    fn add_returned_expressions(&mut self, returned: ExprId, found: &mut ReturnedExpressions) {
        if self.c.is_stack_low() {
            return;
        }
        let Some(checked) = self.type_for_evidence(returned) else {
            return;
        };
        let alternatives = find_alternatives(self.hir(), returned);
        if self.c.is_any(checked) && !alternatives.is_empty() {
            for alternative in alternatives {
                self.add_returned_expressions(alternative, found);
            }
            return;
        }
        found.push((returned, checked));
    }

    fn compute_number_type(&mut self, symbol: SymbolId) -> TypeId {
        let mut walk = self.new_walk();
        match self.c.p.aot_symbols().int32_alias() {
            Some(int32) if self.holds_integers(&mut walk, symbol) => self.c.declared_type(int32),
            Some(_) | None => TypeId::ANY,
        }
    }

    fn holds_integers(&mut self, walk: &mut Walk, symbol: SymbolId) -> bool {
        let (hir, bound) = (self.hir(), self.bound());
        let references = self.references_to_bindings();
        let answers = &mut self.memo.sums_used_as_int32;
        let has_int32_use = references_to(references, symbol)
            .iter()
            .any(|&(_, reference)| is_used_as_int32(hir, bound, reference, answers));
        has_int32_use
            && self.starts_as_integer(walk, symbol)
            && self.gets_only_integers(walk, symbol)
    }

    fn starts_as_integer(&mut self, walk: &mut Walk, symbol: SymbolId) -> bool {
        let (hir, bound) = (self.hir(), self.bound());
        let mut has_initializer = false;
        for &declaration in bound.symbol(symbol).decls {
            let Decl::Var(name) = declaration else {
                return false;
            };
            let PatParent::Var(variable) = bound.pat_parent[name.idx()] else {
                return false;
            };
            if let Some(initializer) = hir[variable].init.some() {
                if !self.is_integer(walk, initializer) {
                    return false;
                }
                has_initializer = true;
            }
        }
        has_initializer
    }

    fn gets_only_integers(&mut self, walk: &mut Walk, symbol: SymbolId) -> bool {
        let (hir, bound) = (self.hir(), self.bound());
        bound
            .stores_to(symbol)
            .iter()
            .all(|store| match store.kind {
                StoreKind::Update(_) => true,
                StoreKind::Assign | StoreKind::CompoundAssign(_) => {
                    match find_use(hir, bound, store.target) {
                        Use::Stored { op, value } => self.stores_integer(walk, op, value),
                        Use::Nothing
                        | Use::PassedOn(_)
                        | Use::Initializes(_)
                        | Use::Destructured(_)
                        | Use::Member { .. }
                        | Use::Keyed { .. }
                        | Use::Key { .. }
                        | Use::Called { .. }
                        | Use::Argument { .. }
                        | Use::Iterated(_)
                        | Use::Object { .. }
                        | Use::Number
                        | Use::Int32
                        | Use::Updated
                        | Use::AddedTo(_)
                        | Use::ComparedWith(_) => false,
                    }
                }
                StoreKind::Destructure | StoreKind::ForIn | StoreKind::ForOf => false,
            })
    }

    fn stores_integer(&mut self, walk: &mut Walk, op: Option<BinOp>, value: ExprId) -> bool {
        match op {
            None | Some(BinOp::Add | BinOp::Sub | BinOp::And | BinOp::Or | BinOp::Nullish) => {
                let checked = self.expression_type(value);
                let is_unknown = checked.is_ok_and(|checked| self.c.is_any(checked));
                is_unknown || self.is_integer(walk, value)
            }
            Some(op) => yields_int32(op),
        }
    }

    fn is_integer(&mut self, walk: &mut Walk, expression: ExprId) -> bool {
        if self.c.is_stack_low() || !walk.enter_node() {
            return false;
        }
        let Ok(checked) = self.expression_type(expression) else {
            return false;
        };
        if self.is_int32_type(checked) {
            return true;
        }
        if let Some(subject) = self.find_number_subject(expression, checked) {
            return match &mut walk.numbers_listed {
                Some(listed) => {
                    listed.push(subject);
                    true
                }
                None => self.is_expected_int32(subject),
            };
        }
        let hir = self.hir();
        if let Some((object, MemberKey::Name(name))) = hir.member_key(expression) {
            return name == known::length && self.is_list(object);
        }
        if let ExprKind::Unary { op, .. } = hir[expression].kind {
            return op == UnOp::BitNot;
        }
        let ExprKind::Binary { op, left, right } = hir[expression].kind else {
            return false;
        };
        let is_sum = matches!(op, BinOp::Add | BinOp::Sub);
        yields_int32(op) || is_sum && self.is_integer(walk, left) && self.is_integer(walk, right)
    }

    fn is_int32_type(&mut self, ty: TypeId) -> bool {
        let int32 = self.c.p.aot_symbols().int32_alias();
        let int32 = int32.map(|alias| self.c.declared_type(alias));
        self.c.every_type(ty, |c, part| {
            let is_int32_literal = matches!(
                c.data(part),
                TypeData::NumberLit { bits, .. } if is_int32_value(f64::from_bits(*bits))
            );
            is_int32_literal || Some(part) == int32
        })
    }

    fn is_expected_int32(&mut self, number: Subject) -> bool {
        if let Some(&TypeState::InProgress {
            depth,
            assumed: None,
        }) = self.memo.inferred_types.get(&number)
        {
            self.memo.types_in_progress.subjects.revisit(depth as usize);
            return true;
        }
        let inferred = self.inferred_type(number);
        !self.c.is_any(inferred)
    }

    fn compute_expression_type(&mut self, expression: ExprId) -> TypeId {
        if self.c.is_stack_low() {
            return TypeId::ANY;
        }
        if let Some(subject) = self.find_referenced_subject(expression) {
            return self.inferred_type(subject);
        }
        if let Some(found) = self.find_type_in_inferred_receiver(expression)
            && !self.c.is_any(found)
        {
            return found;
        }
        if let Some(result) = self.find_result_of_inferred_method(expression) {
            return result;
        }
        if let Some(subject) = self.find_result_subject_of_call(expression) {
            let result = self.inferred_type(subject);
            if !self.c.is_any(result) {
                return result;
            }
        }
        self.compute_type_from_uses(Subject::Expression(expression))
    }

    fn find_untyped_receiver(&mut self, access: ExprId) -> Option<ExprId> {
        let (object, _) = self.hir().member_key(access)?;
        let checked = self.expression_type(object).ok()?;
        self.c.is_any(checked).then_some(object)
    }

    fn find_untyped_receiver_of_method_call(&mut self, call: ExprId) -> Option<ExprId> {
        let hir = self.hir();
        match hir[call].kind {
            ExprKind::Call(site) => self.find_untyped_receiver(hir[site].callee),
            _ => None,
        }
    }

    fn find_type_in_inferred_receiver(&mut self, access: ExprId) -> Option<TypeId> {
        let (_, key) = self.hir().member_key(access)?;
        let object = self.find_untyped_receiver(access)?;
        let receiver = self.inferred_type(Subject::Expression(object));
        if self.c.is_any(receiver) {
            return None;
        }
        let name = match key {
            MemberKey::Name(name) => name,
            MemberKey::PrivateName(_) => return None,
            MemberKey::Computed(key) => {
                let key_type = self.expression_type(key).ok()?;
                if self.is_number_type(key_type) {
                    return self.find_element_type(receiver);
                }
                self.c.property_name_of_type(key_type)?
            }
        };
        match self.find_member(receiver, name).ok()? {
            MemberLookup::Member(member) => member.types.checked.ok(),
            MemberLookup::Index(signature) => signature.types.checked.ok(),
            MemberLookup::Absent => None,
        }
    }

    fn find_result_of_inferred_method(&mut self, call: ExprId) -> Option<TypeId> {
        let hir = self.hir();
        let ExprKind::Call(site) = hir[call].kind else {
            return None;
        };
        let callee = hir[site].callee;
        hir.member_key(callee)?;
        let method = self.find_type_in_inferred_receiver(callee)?;
        let mut result = None;
        for &signature in self.c.signatures(method, false).iter() {
            let returned = self.c.sig_return(signature);
            if self.c.has_type_variables(returned) {
                continue;
            }
            if result.is_some_and(|result| result != returned) {
                return None;
            }
            result = Some(returned);
        }
        result.filter(|&result| !self.c.is_any(result))
    }

    fn find_element_type(&mut self, list: TypeId) -> Option<TypeId> {
        let mut elements = TypeParts::new();
        for &part in self.c.parts(list) {
            if self.c.is_string_like(part) {
                elements.push(TypeId::STRING);
            } else {
                elements.push(self.c.array_element(part)?);
            }
        }
        Some(self.c.union(&elements))
    }

    fn new_walk(&self) -> Walk {
        Walk {
            remembered: Rc::clone(&self.memo.parts_remembered),
            ..Walk::new(self.inputs.max_inference_nodes)
        }
    }

    fn compute_type_from_uses(&mut self, subject: Subject) -> TypeId {
        let mut walk = self.new_walk();
        match self.usage_of(&mut walk, subject) {
            Some(usage) => self.type_of_usage(&usage),
            None => TypeId::ANY,
        }
    }

    fn references_to_bindings(&mut self) -> &'c [(SymbolId, ExprId)] {
        if let Some(references) = self.memo.reference_index.to_bindings {
            return references;
        }
        let references = self.compute_references_to_bindings();
        self.memo.reference_index.to_bindings = Some(references);
        references
    }

    #[inline(never)]
    fn add_uses_of_field(&mut self, walk: &mut Walk, position: u32, usage: &mut Usage) {
        let Some(&(class, field)) = self.memo.names_of_fields_asked_about.get(&position) else {
            return;
        };
        for access in self.reads_of_field_off_this(class, field) {
            self.add_evidence(walk, access, usage);
        }
    }

    #[inline(never)]
    fn reads_of_field_off_this(&mut self, class: ClassId, field: Atom) -> Vec<ExprId> {
        if self.memo.reads_of_fields_off_this.is_none() {
            let (file, hir, bound) = (self.file, self.hir(), self.bound());
            let mut reads: FxHashMap<(ClassId, Atom), Vec<ExprId>> = FxHashMap::default();
            for &(function, reference) in self.references_to_this() {
                let FnOwner::Member(member) = bound.fns[function.idx()].owner else {
                    continue;
                };
                if hir[member].flags.contains(Flags::STATIC) {
                    continue;
                }
                let Some(owner) = self.c.class_of_member_fn(file, function) else {
                    continue;
                };
                if let Use::Member { access, name, .. } = find_use(hir, bound, reference) {
                    reads.entry((owner, name)).or_default().push(access);
                }
            }
            self.memo.reads_of_fields_off_this = Some(reads);
        }
        let reads = self.memo.reads_of_fields_off_this.as_ref();
        reads
            .and_then(|reads| reads.get(&(class, field)).cloned())
            .unwrap_or_default()
    }

    fn references_to_this(&mut self) -> &'c [(FnId, ExprId)] {
        if let Some(references) = self.memo.reference_index.to_this {
            return references;
        }
        let references = self.compute_references_to_this();
        self.memo.reference_index.to_this = Some(references);
        references
    }

    fn compute_references_to_bindings(&mut self) -> &'c [(SymbolId, ExprId)] {
        let (file, hir, bound) = (self.file, self.hir(), self.bound());
        let expressions = self.c.exprs_by_kind(file);
        let mut to_bindings = Vec::with_capacity(expressions.of(ExprTag::Ident).len());
        for &reference in expressions.of(ExprTag::Ident) {
            let is_evaluated = bound.is_evaluated_ident(reference)
                && self.require_live_expression(reference).is_ok();
            if !is_evaluated {
                continue;
            }
            match bound.binding(reference) {
                Binding::Symbol(symbol) => to_bindings.push((symbol, reference)),
                Binding::Arguments(_) | Binding::CommonJs(_) | Binding::Free => {}
            }
        }
        let number_of = |owner: u32, reference: ExprId| number_of_pair(owner, hir[reference].pos);
        to_bindings = grouped_by_symbol(&to_bindings);
        if !to_bindings.is_sorted_by_key(|&(symbol, reference)| number_of(symbol.0, reference)) {
            to_bindings.sort_by_u64(|&(symbol, reference)| number_of(symbol.0, reference));
        }
        self.list(&to_bindings)
    }

    fn compute_references_to_this(&mut self) -> &'c [(FnId, ExprId)] {
        let (file, hir) = (self.file, self.hir());
        let expressions = self.c.exprs_by_kind(file);
        let mut to_this = Vec::new();
        for &reference in expressions.of(ExprTag::This) {
            let is_evaluated = self.require_live_expression(reference).is_ok();
            match self.c.this_container(file, reference) {
                Some(Ok(function)) if is_evaluated => to_this.push((function, reference)),
                Some(Ok(_) | Err(_)) | None => {}
            }
        }
        let number_of = |owner: u32, reference: ExprId| number_of_pair(owner, hir[reference].pos);
        to_this.sort_by_u64(|&(function, reference)| number_of(function.0, reference));
        self.list(&to_this)
    }

    fn usage_of(&mut self, walk: &mut Walk, subject: Subject) -> Option<Rc<Usage>> {
        let is_outermost = walk.lowest_index == usize::MAX;
        let usage = self.usage_within_reach(walk, subject);
        match is_outermost && walk.is_freeing_stack {
            true => self.walk_subjects_set_aside(walk),
            false => usage,
        }
    }

    #[cold]
    fn walk_subjects_set_aside(&mut self, walk: &mut Walk) -> Option<Rc<Usage>> {
        let mut first_set_aside = 0;
        loop {
            walk.set_aside[first_set_aside..].reverse();
            walk.is_freeing_stack = false;
            let mut usage = None;
            while !walk.is_freeing_stack {
                let Some(innermost) = walk.set_aside.pop() else {
                    return usage;
                };
                first_set_aside = walk.set_aside.len();
                usage = self.walk_subject(walk, innermost, true);
                if !walk.is_freeing_stack
                    && let Some(asked_for_it) = walk.set_aside.last_mut()
                {
                    asked_for_it.lowest_index = walk.lowest_index;
                    asked_for_it.found_something_new = walk.found_something_new;
                }
            }
        }
    }

    fn usage_within_reach(&mut self, walk: &mut Walk, subject: Subject) -> Option<Rc<Usage>> {
        if walk.is_freeing_stack {
            return None;
        }
        let unstable_answers = self.count_unstable_answers() + walk.subjects_not_kept;
        let is_outermost = walk.lowest_index == usize::MAX;
        if is_outermost {
            (walk.unstable_answers_at_start, walk.shares_budget) = (unstable_answers, false);
        }
        let assumed = match self.memo.usages.get(&subject) {
            Some(UsageState::Known(usage)) => return Some(Rc::clone(usage)),
            Some(UsageState::InProgress { index, assumed }) => {
                walk.lowest_index = walk.lowest_index.min(*index);
                return assumed.clone();
            }
            Some(UsageState::InCycle { index, found }) => {
                walk.lowest_index = walk.lowest_index.min(*index);
                return Some(Rc::clone(found));
            }
            Some(UsageState::Assumed(usage)) => Some(Rc::clone(usage)),
            Some(UsageState::NotKept) => {
                walk.shares_budget = true;
                None
            }
            None => None,
        };
        if walk.subjects_on_stack > 1 && self.c.is_half_of_stack_in_use() {
            walk.is_freeing_stack = true;
            return None;
        }
        walk.shares_budget |= unstable_answers != walk.unstable_answers_at_start;
        let entered = SubjectInProgress {
            subject,
            is_outermost,
            unstable_answers,
            assumed,
            index: 0,
            first_in_cycle: walk.in_cycles.len(),
            first_in_round: 0,
            lowest_index: 0,
            found_something_new: false,
            outer_lowest: walk.lowest_index,
            outer_nodes: walk.remaining_nodes,
            outer_root: walk.root,
            outer_found_something_new: std::mem::take(&mut walk.found_something_new),
        };
        self.walk_subject(walk, entered, false)
    }

    fn walk_subject(
        &mut self,
        walk: &mut Walk,
        mut entered: SubjectInProgress,
        mut was_set_aside: bool,
    ) -> Option<Rc<Usage>> {
        let (subject, is_outermost) = (entered.subject, entered.is_outermost);
        let can_be_merged = match subject {
            Subject::Binding(_) | Subject::Pattern(_) | Subject::This(_) | Subject::Field(_) => {
                true
            }
            Subject::Result(_) | Subject::Expression(_) | Subject::Number(_) => false,
        };
        let (usage, is_stable, is_entry_of_cycle) = loop {
            if was_set_aside {
                walk.lowest_index = entered.lowest_index;
                walk.found_something_new = entered.found_something_new;
                was_set_aside = false;
            } else {
                entered.index = self.memo.types_in_progress.next_usage_index;
                self.memo.types_in_progress.next_usage_index += 1;
                let state = UsageState::InProgress {
                    index: entered.index,
                    assumed: entered.assumed.clone(),
                };
                self.memo.usages.insert(subject, state);
                walk.lowest_index = entered.index;
                entered.first_in_round = walk.in_cycles.len();
            }
            if is_outermost || !walk.shares_budget {
                walk.remaining_nodes = walk.max_nodes;
            }
            self.statistics.usages_walked += 1;
            walk.subjects_on_stack += 1;
            let mut found = self.ask(|queries| Ok(queries.compute_usage(walk, subject)));
            walk.subjects_on_stack -= 1;
            if walk.is_freeing_stack {
                entered.lowest_index = walk.lowest_index;
                entered.found_something_new = walk.found_something_new;
                walk.lowest_index = entered.outer_lowest;
                walk.found_something_new = entered.outer_found_something_new;
                walk.root = entered.outer_root;
                walk.set_aside.push(entered);
                return None;
            }
            let mut is_as_assumed = false;
            if let (Ok(found), Some(assumed)) = (&mut found, &entered.assumed) {
                found.members.write_out_order();
                is_as_assumed = *found == **assumed;
                if !is_as_assumed {
                    found.merge(&mut Walk::new(u64::MAX), assumed);
                    if found.is_incomplete() {
                        found.forget_parts();
                    }
                    found.members.write_out_order();
                }
            }
            let usage = found.ok().map(Rc::new);
            walk.found_something_new |= !is_as_assumed && usage != entered.assumed;
            let is_stable =
                self.count_unstable_answers() + walk.subjects_not_kept == entered.unstable_answers;
            walk.shares_budget |= !is_stable;
            let is_entry_of_cycle =
                walk.lowest_index == entered.index && walk.in_cycles.len() > entered.first_in_round;
            if !is_entry_of_cycle || !walk.found_something_new || walk.shares_budget {
                break (usage, is_stable, is_entry_of_cycle);
            }
            for &other in &walk.in_cycles[entered.first_in_round..] {
                if let Some(state) = self.memo.usages.get_mut(&other)
                    && let UsageState::InCycle { found, .. } = state
                {
                    *state = UsageState::Assumed(Rc::clone(found));
                }
            }
            (entered.assumed, walk.found_something_new) = (usage, false);
        };
        let (index, first_in_cycle) = (entered.index, entered.first_in_cycle);
        let leads_back = walk.lowest_index < index;
        let has_settled = !walk.found_something_new || !is_entry_of_cycle;
        let is_cut_short = walk.shares_budget && walk.is_out_of_budget();
        let found_something_new = std::mem::replace(
            &mut walk.found_something_new,
            entered.outer_found_something_new,
        );
        walk.root = entered.outer_root;
        walk.remaining_nodes = match walk.shares_budget && !is_outermost {
            true => entered.outer_nodes.min(walk.remaining_nodes),
            false => entered.outer_nodes,
        };
        if leads_back && !is_outermost {
            walk.lowest_index = walk.lowest_index.min(entered.outer_lowest);
            walk.found_something_new |= found_something_new;
            walk.in_cycles.push(subject);
            let found = usage.clone().unwrap_or_default();
            let state = UsageState::InCycle { index, found };
            self.memo.usages.insert(subject, state);
            return usage;
        }
        walk.lowest_index = entered.outer_lowest;
        let is_kept = can_be_merged && is_stable && has_settled && !leads_back && !is_cut_short;
        for other in walk.in_cycles.drain(first_in_cycle..) {
            let Some(state) = self.memo.usages.get_mut(&other) else {
                continue;
            };
            match state {
                UsageState::InCycle { found, .. } if is_kept => {
                    *state = UsageState::Known(Rc::clone(found));
                }
                UsageState::InCycle { .. } => {
                    *state = UsageState::NotKept;
                    if self.lacks_stack {
                        self.memo.usages_that_lacked_stack.push(other);
                    }
                }
                UsageState::Assumed(_) => {
                    self.memo.usages.remove(&other);
                }
                UsageState::InProgress { .. } | UsageState::Known(_) | UsageState::NotKept => {}
            }
        }
        match &usage {
            Some(usage) if is_kept => {
                let known = UsageState::Known(Rc::clone(usage));
                self.memo.usages.insert(subject, known);
            }
            Some(_) | None => {
                walk.subjects_not_kept += 1;
                match can_be_merged {
                    true => self.memo.usages.insert(subject, UsageState::NotKept),
                    false => self.memo.usages.remove(&subject),
                };
                if can_be_merged && self.lacks_stack {
                    self.memo.usages_that_lacked_stack.push(subject);
                }
            }
        }
        usage
    }

    pub(super) fn forget_usages_that_lacked_stack(&mut self) {
        if self.memo.usages_that_lacked_stack.is_empty() {
            return;
        }
        for subject in self.memo.usages_that_lacked_stack.drain(..) {
            if let Some(UsageState::NotKept) = self.memo.usages.get(&subject) {
                self.memo.usages.remove(&subject);
            }
        }
    }

    fn compute_usage(&mut self, walk: &mut Walk, subject: Subject) -> Usage {
        let mut usage = Usage::default();
        walk.root = &raw const usage;
        let passed_on_around = std::mem::take(&mut walk.passed_on);
        walk.passed_on.part_entered = &raw const usage;
        match subject {
            Subject::Binding(symbol) => {
                let references = self.references_to_bindings();
                for &(_, reference) in references_to(references, symbol) {
                    self.add_evidence(walk, reference, &mut usage);
                }
            }
            Subject::This(function) => {
                let references = self.references_to_this();
                for &(_, reference) in references_to(references, function) {
                    let checked = self.expression_type(reference);
                    if checked.is_ok_and(|checked| self.c.is_any(checked)) {
                        self.add_evidence(walk, reference, &mut usage);
                    }
                }
            }
            Subject::Field(position) => self.add_uses_of_field(walk, position, &mut usage),
            Subject::Pattern(pattern) => self.add_uses_of_pattern(walk, pattern, &mut usage),
            Subject::Expression(expression) => self.add_evidence(walk, expression, &mut usage),
            Subject::Result(_) | Subject::Number(_) => {
                debug_assert!(
                    false,
                    "what is returned types a result and what is stored a number, not their uses"
                );
            }
        }
        walk.passed_on = passed_on_around;
        if walk.is_out_of_budget() {
            usage.facts |= Facts::INCOMPLETE;
        }
        if usage.is_incomplete() {
            usage.forget_parts();
        }
        usage
    }

    fn add_uses_of_subject(&mut self, walk: &mut Walk, subject: Subject, usage: &mut Usage) {
        let is_part = !std::ptr::eq(usage, walk.root);
        let Some(found) = self.usage_of(walk, subject) else {
            return;
        };
        let is_kept = matches!(self.memo.usages.get(&subject), Some(UsageState::Known(_)));
        if is_part && !is_kept {
            return;
        }
        let own_stores = Facts::STORED | Facts::OBJECT_LITERAL_STORED | Facts::UINT32_STORED;
        let is_stored = usage.facts & own_stores;
        let own_arms = found
            .facts
            .contains(Facts::STORED)
            .then(|| usage.arms.clone());
        usage.merge(walk, &found);
        if let Some(own_arms) = own_arms {
            usage.arms = own_arms;
        }
        usage.facts = (usage.facts - own_stores) | is_stored;
    }

    fn calls_its_object(&self, access: ExprId) -> bool {
        let named = self.inputs.named_values.find_named_value(self.file, access);
        matches!(
            named,
            Some(NamedValue::PrototypeOperation(
                PrototypeOperation::CallFunction { .. }
            ))
        )
    }

    fn add_evidence(&mut self, walk: &mut Walk, value: ExprId, usage: &mut Usage) {
        if self.c.is_stack_low() || !walk.looks_at_uses_of(usage) {
            return;
        }
        let Some(checked) = self.type_for_evidence(value) else {
            return;
        };
        if !self.c.is_any(checked) {
            let says_nothing = self.says_nothing_of_what_is_handed(checked);
            if !says_nothing || self.is_null_or_undefined_alone(checked) {
                self.add_arm(usage, checked);
            }
            if checked != TypeId::NEVER && !says_nothing {
                return;
            }
        }
        match find_use(self.hir(), self.bound(), value) {
            Use::Nothing => {}
            Use::PassedOn(outer) => {
                if walk.passed_on.is_followed_anew(outer, usage) {
                    self.add_evidence(walk, outer, usage);
                }
            }
            Use::Initializes(pattern) => self.add_uses_of_pattern(walk, pattern, usage),
            Use::Destructured(pattern) => self.add_members_of_assignment_pattern(pattern, usage),
            Use::Member {
                access,
                name,
                is_optional,
            } => {
                usage.facts |= required_if(!is_optional);
                match self.calls_its_object(access) {
                    true => usage.facts |= Facts::FUNCTION,
                    false if walk.is_out_of_budget() => {}
                    false => {
                        self.add_evidence_of_part(walk, access, usage, StepToPart::Member(name));
                        self.add_uses_of_elements_in_callbacks(walk, access, name, usage);
                    }
                }
            }
            Use::Keyed {
                access,
                key,
                is_optional,
            } => {
                usage.facts |= required_if(!is_optional);
                self.add_keyed_access(walk, access, key, usage);
            }
            Use::Key { object } => {
                usage.facts |=
                    match self.is_list(object) || self.finds_what_is_read_by_number(value) {
                        true => Facts::NUMBER_AT_EVERY_VALUE | Facts::INT32,
                        false => Facts::KEY,
                    };
            }
            Use::Called { is_optional } => {
                usage.facts |= Facts::FUNCTION;
                usage.facts |= required_if(!is_optional);
            }
            Use::Argument { call, index } => self.add_uses_of_argument(walk, call, index, usage),
            Use::Iterated(pattern) => {
                usage.facts |= Facts::REQUIRED;
                let elements = usage.elements_mut();
                if let Some(pattern) = pattern {
                    self.add_uses_of_pattern(walk, pattern, elements);
                }
            }
            Use::Object { is_required } => {
                usage.facts |= Facts::OBJECT;
                usage.facts |= required_if(is_required);
            }
            Use::Number | Use::Int32 if self.is_combined_into_what_is_no_number(value) => {}
            Use::Number => usage.facts |= self.number_fact_of_operand(value),
            Use::Int32 => {
                usage.facts |= self.number_fact_of_operand(value);
                let given = self.find_product_given_to(value);
                if !given.is_given {
                    usage.facts |= Facts::INT32;
                }
                if given.ran_out_of_terms {
                    self.note_walk_ended_by(QueryLimit::TermsReadForProduct);
                }
            }
            Use::Updated => {
                usage.facts |= Facts::NUMBER_AT_EVERY_VALUE | Facts::STORED;
                self.add_use_of_update(value, usage);
            }
            Use::AddedTo(other) => self.add_addition(other, usage),
            Use::ComparedWith(other) => self.add_comparison(other, usage),
            Use::Stored { op, value } => self.add_store(op, value, usage),
        }
    }

    fn add_uses_of_elements_in_callbacks(
        &mut self,
        walk: &mut Walk,
        access: ExprId,
        method: Atom,
        usage: &mut Usage,
    ) {
        let (hir, bound) = (self.hir(), self.bound());
        let Parent::Expr(call) = bound.parent_of_expr(access) else {
            return;
        };
        let Some(call) = call.some() else {
            return;
        };
        let ExprKind::Call(site) = hir[call].kind else {
            return;
        };
        if hir[site].callee != access {
            return;
        }
        for (index, argument) in hir.ids(hir[site].args).enumerate() {
            let callback = match hir[argument].kind {
                ExprKind::Fn(callback) => callback,
                ExprKind::Spread(_) => break,
                _ => continue,
            };
            let taking_elements = self.find_parameters_taking_elements(method, index);
            for (position, parameter) in hir[callback].params.iter().enumerate().take(8) {
                if taking_elements & (1 << position) == 0 {
                    continue;
                }
                let Ok(checked) = self.checked_binding_type(hir[parameter].pat) else {
                    continue;
                };
                let subject = self.find_parameter_subject(self.file, parameter, checked);
                let Some(subject) = subject else {
                    continue;
                };
                let mut found = Usage::default();
                self.add_uses_of_subject(walk, subject, &mut found);
                if !found.facts.contains(Facts::NUMBER_AT_EVERY_VALUE) {
                    found.facts -= Facts::NUMBER | Facts::INT32;
                }
                let says = self.type_of_usage(&found);
                if self.is_number_type(says) || self.is_string_type(says) {
                    usage.elements_mut().merge(walk, &found);
                }
            }
        }
    }

    fn find_parameters_taking_elements(&mut self, method: Atom, index: usize) -> u8 {
        if let Some(&known) = self.memo.parameters_taking_elements.get(&(method, index)) {
            return known;
        }
        let list = self.c.array_of(TypeId::NEVER);
        let mut taking_elements = 0;
        let signatures = match self.c.type_of_property(list, method) {
            Some(method) => self.c.signatures(method, false),
            None => Default::default(),
        };
        for &signature in signatures.iter() {
            let parameters = self.c.sig_params(signature);
            let Some(callback) = find_parameter(&parameters, index) else {
                continue;
            };
            let callback = self.without_nullish(callback.ty).unwrap_or(callback.ty);
            for &signature in self.c.signatures(callback, false).iter() {
                let parameters = self.c.sig_params(signature);
                for (position, parameter) in parameters.iter().enumerate().take(8) {
                    if parameter.ty == TypeId::NEVER && !parameter.rest {
                        taking_elements |= 1 << position;
                    }
                }
            }
        }
        let known = &mut self.memo.parameters_taking_elements;
        known.insert((method, index), taking_elements);
        taking_elements
    }

    fn is_combined_into_what_is_no_number(&mut self, value: ExprId) -> bool {
        let Parent::Expr(parent) = self.bound().parent_of_expr(value) else {
            return false;
        };
        let Some(ExprKind::Assign {
            op: Some(_),
            target,
            value: stored,
        }) = parent.some().map(|parent| self.hir()[parent].kind)
        else {
            return false;
        };
        stored == value
            && self.expression_type(target).is_ok_and(|ty| {
                !self.c.is_any(ty) && !self.c.some_type(ty, |c, part| c.is_number_like(part))
            })
    }

    fn find_product_given_to(&mut self, reference: ExprId) -> GivenProduct {
        let (hir, bound) = (self.hir(), self.bound());
        let (ExprKind::Ident(_), Binding::Symbol(symbol)) =
            (hir[reference].kind, bound.binding(reference))
        else {
            return GivenProduct {
                is_given: false,
                ran_out_of_terms: false,
            };
        };
        if let Some(&known) = self.memo.symbols_given_products.get(&symbol) {
            return known;
        }
        let read = TermsRead {
            most: self.limit(QueryLimit::TermsReadForProduct),
            ran_out: Cell::new(false),
        };
        let given = GivenProduct {
            is_given: is_given_product(hir, bound, symbol, &read),
            ran_out_of_terms: read.ran_out.get(),
        };
        self.memo.symbols_given_products.insert(symbol, given);
        given
    }

    fn number_fact_of_operand(&mut self, operand: ExprId) -> Facts {
        let (hir, bound) = (self.hir(), self.bound());
        let answers = &mut self.memo.evaluated_for_some_values_only;
        match is_evaluated_for_some_values_only(hir, bound, operand, answers) {
            true => Facts::NUMBER,
            false => Facts::NUMBER_AT_EVERY_VALUE,
        }
    }

    fn add_arm(&mut self, usage: &mut Usage, ty: TypeId) {
        if let Ok(ty) = self.without_nullish(ty) {
            let holds_nothing = self.c.array_element(ty).is_some_and(TypeId::is_never);
            let ty = match holds_nothing {
                true => self.c.array_of(TypeId::ANY),
                false => ty,
            };
            let says_nothing = self.c.is_any(ty)
                || ty == TypeId::UNKNOWN
                || ty.is_never()
                || ty != TypeId::OBJECT && self.c.is_empty_object_type(ty);
            if !says_nothing {
                usage.add_arm(ty);
            }
        }
    }

    fn is_number_type(&self, ty: TypeId) -> bool {
        self.c.every_type(ty, |c, part| c.is_number_like(part))
    }

    fn is_string_type(&self, ty: TypeId) -> bool {
        self.c.every_type(ty, |c, part| c.is_string_like(part))
    }

    fn finds_what_is_read_by_number(&mut self, key: ExprId) -> bool {
        let (hir, bound) = (self.hir(), self.bound());
        let Parent::Expr(access) = bound.parent_of_expr(key) else {
            return false;
        };
        let Some(access) = access.some() else {
            return false;
        };
        let Use::Keyed { key: inner, .. } = find_use(hir, bound, access) else {
            return false;
        };
        let inner = self.type_for_evidence(inner);
        inner.is_some_and(|inner| self.is_number_type(inner))
    }

    fn is_list(&mut self, object: ExprId) -> bool {
        let Ok(ty) = self.expression_type(object) else {
            return false;
        };
        self.c.every_type(ty, |c, part| {
            c.is_array_or_tuple(part) || c.is_string_like(part)
        })
    }

    fn add_use_of_update(&mut self, updated: ExprId, usage: &mut Usage) {
        let (hir, bound) = (self.hir(), self.bound());
        let Parent::Expr(update) = bound.parent_of_expr(updated) else {
            return;
        };
        let Some(update) = update.some() else {
            return;
        };
        match find_use(hir, bound, update) {
            Use::Key { object } => {
                usage.facts |= match self.is_list(object) {
                    true => Facts::INT32,
                    false => Facts::KEY,
                };
            }
            Use::ComparedWith(other) if is_int32_literal(hir, other) => usage.facts |= Facts::INT32,
            _ => {}
        }
    }

    fn add_addition(&mut self, other: ExprId, usage: &mut Usage) {
        if let Ok(ty) = self.expression_type(other)
            && self.is_number_type(ty)
        {
            usage.facts |= Facts::NUMBER_AT_EVERY_VALUE;
        }
    }

    fn add_comparison(&mut self, other: ExprId, usage: &mut Usage) {
        let Some(ty) = self.type_for_evidence(other) else {
            return;
        };
        if self.is_number_type(ty) {
            usage.facts |= Facts::NUMBER_AT_EVERY_VALUE;
        } else if self.is_string_type(ty) {
            usage.facts |= Facts::STRING;
        }
    }

    fn add_store(&mut self, op: Option<BinOp>, value: ExprId, usage: &mut Usage) {
        usage.facts |= Facts::STORED;
        match op {
            None | Some(BinOp::And | BinOp::Or | BinOp::Nullish) => {
                if matches!(self.hir()[value].kind, ExprKind::Object(_)) {
                    usage.facts |= Facts::OBJECT_LITERAL_STORED;
                }
                if let Ok(ty) = self.expression_type(value) {
                    let ty = self.c.widened(ty);
                    self.add_arm(usage, ty);
                }
            }
            Some(BinOp::Add) => self.add_addition(value, usage),
            Some(BinOp::Sub | BinOp::Mul | BinOp::Div | BinOp::Rem | BinOp::Pow) => {
                usage.facts |= Facts::NUMBER_AT_EVERY_VALUE;
            }
            Some(BinOp::UShr) => {
                usage.facts |= Facts::NUMBER_AT_EVERY_VALUE | Facts::UINT32_STORED;
            }
            Some(BinOp::Shl | BinOp::Shr | BinOp::BitAnd | BinOp::BitOr | BinOp::BitXor) => {
                usage.facts |= Facts::NUMBER_AT_EVERY_VALUE | Facts::INT32;
            }
            Some(
                BinOp::Lt
                | BinOp::Le
                | BinOp::Gt
                | BinOp::Ge
                | BinOp::EqEq
                | BinOp::NotEq
                | BinOp::EqEqEq
                | BinOp::NotEqEq
                | BinOp::In
                | BinOp::Instanceof
                | BinOp::Comma,
            ) => {}
        }
    }

    fn add_evidence_of_part(
        &mut self,
        walk: &mut Walk,
        access: ExprId,
        usage: &mut Usage,
        step: StepToPart,
    ) {
        let number = walk.passed_on.number_of_part(usage, step);
        let around = (
            walk.passed_on.part_entered,
            walk.passed_on.number_of_part_entered,
        );
        let part = match step {
            StepToPart::Member(name) => usage.member_mut(name),
            StepToPart::Elements => usage.elements_mut(),
        };
        walk.passed_on.part_entered = match number {
            Some(_) => &raw const *part,
            None => std::ptr::null(),
        };
        walk.passed_on.number_of_part_entered = number.unwrap_or(0);
        self.add_evidence(walk, access, part);
        (
            walk.passed_on.part_entered,
            walk.passed_on.number_of_part_entered,
        ) = around;
    }

    fn add_keyed_access(
        &mut self,
        walk: &mut Walk,
        access: ExprId,
        key: ExprId,
        usage: &mut Usage,
    ) {
        let Some(key_type) = self.type_for_evidence(key) else {
            return;
        };
        let is_index = self.is_number_type(key_type)
            || self.c.is_any(key_type) && self.is_used_as_number(walk, key);
        if is_index {
            self.add_evidence_of_part(walk, access, usage, StepToPart::Elements);
        } else if let Some(name) = self.c.property_name_of_type(key_type) {
            if !walk.is_out_of_budget() {
                self.add_evidence_of_part(walk, access, usage, StepToPart::Member(name));
            }
        } else {
            usage.facts |= Facts::OBJECT;
        }
    }

    fn is_used_as_number(&mut self, walk: &mut Walk, expression: ExprId) -> bool {
        let Some(subject) = self.find_referenced_subject(expression) else {
            return false;
        };
        let usage = self.usage_of(walk, subject);
        usage.is_some_and(|usage| usage.is_number())
    }

    fn add_uses_of_pattern(&mut self, walk: &mut Walk, pattern: PatId, usage: &mut Usage) {
        if self.c.is_stack_low() || !walk.looks_at_uses_of(usage) {
            return;
        }
        let hir = self.hir();
        match hir[pattern].kind {
            PatKind::Missing => {}
            PatKind::Ident(_) => self.add_uses_of_name(walk, pattern, usage),
            PatKind::Object(properties) => {
                usage.facts |= Facts::REQUIRED;
                for property in properties.iter().filter(|&property| !hir[property].is_rest) {
                    match hir.runtime_binding_key(property) {
                        PropKey::Name(name) => {
                            let member = usage.member_mut(name);
                            self.add_uses_of_pattern(walk, hir[property].value, member);
                        }
                        PropKey::Computed(_) => usage.facts |= Facts::OBJECT,
                        PropKey::None | PropKey::Private(_) => {}
                    }
                }
            }
            PatKind::Array(elements) => {
                usage.facts |= Facts::REQUIRED;
                let contents = usage.elements_mut();
                for element in elements.iter().filter(|&element| !hir[element].is_rest) {
                    self.add_uses_of_pattern(walk, hir[element].pat, contents);
                }
            }
        }
    }

    fn add_uses_of_name(&mut self, walk: &mut Walk, name: PatId, usage: &mut Usage) {
        let Ok(checked) = self.checked_binding_type(name) else {
            return;
        };
        if !self.c.is_any(checked) {
            self.add_arm(usage, checked);
            return;
        }
        let bound = self.bound();
        let Some(symbol) = find_initialized_symbol(bound, name) else {
            return;
        };
        if bound.stores_to(symbol).is_empty() && bound.symbol(symbol).decls.len() == 1 {
            self.add_uses_of_subject(walk, Subject::Binding(symbol), usage);
        }
    }

    fn checked_binding_type(&mut self, pattern: PatId) -> CheckedType {
        self.ask(|queries| {
            let ty = queries.c.type_of_pat(queries.file, pattern);
            queries.resolved(ty)
        })
    }

    fn add_members_of_assignment_pattern(&self, pattern: ExprId, usage: &mut Usage) {
        let hir = self.hir();
        let ExprKind::Object(properties) = hir[pattern].kind else {
            return;
        };
        usage.facts |= Facts::REQUIRED;
        for property in properties.iter() {
            match hir.runtime_property_key(property) {
                PropKey::Name(name) => {
                    usage.member_mut(name);
                }
                PropKey::Computed(_) => usage.facts |= Facts::OBJECT,
                PropKey::None | PropKey::Private(_) => {}
            }
        }
    }

    fn add_uses_of_argument(
        &mut self,
        walk: &mut Walk,
        call: ExprId,
        index: usize,
        usage: &mut Usage,
    ) {
        let (signature, index) = match self.find_call_with_receiver(call) {
            Some(indirect) if index == 0 => {
                self.add_uses_of_receiver(walk, indirect.signature, usage);
                return;
            }
            Some(indirect) if indirect.takes_argument_list => return,
            Some(indirect) => (indirect.signature, index - 1),
            None => match self.resolved_call(call) {
                Ok(Some(target)) => (target.signature, index),
                Ok(None) | Err(_) => return,
            },
        };
        let parameters = self.c.sig_params(signature);
        let Some(parameter) = find_parameter(&parameters, index) else {
            return;
        };
        let subject = parameter
            .declaration
            .and_then(|(of, declared)| self.find_parameter_subject(of, declared, parameter.ty));
        let Some(subject) = subject else {
            self.add_arm(usage, parameter.ty);
            return;
        };
        let number_facts = Facts::NUMBER | Facts::INT32;
        let known_here = usage.facts & number_facts;
        self.add_uses_of_subject(walk, subject, usage);
        if !usage.facts.contains(Facts::NUMBER_AT_EVERY_VALUE) {
            usage.facts = (usage.facts - number_facts) | known_here;
        }
    }

    fn add_uses_of_receiver(&mut self, walk: &mut Walk, signature: SigId, usage: &mut Usage) {
        let declaration = self.c.sig_decl(signature);
        let subject =
            declaration.and_then(|(of, function, _)| self.find_this_subject(of, function));
        if let Some(subject) = subject {
            self.add_uses_of_subject(walk, subject, usage);
        }
    }

    fn find_call_with_receiver(&mut self, call: ExprId) -> Option<CallWithReceiver> {
        let hir = self.hir();
        let ExprKind::Call(site) = hir[call].kind else {
            return None;
        };
        let (function, MemberKey::Name(name)) = hir.member_key(hir[site].callee)? else {
            return None;
        };
        let function_type = self.expression_type(function).ok()?;
        let &[signature] = &self.c.signatures(function_type, false)[..] else {
            return None;
        };
        let (method, _) = self.c.get_property_of_type(function_type, name)?;
        let forms = [(known::call, false), (known::apply, true)];
        let (_, takes_argument_list) = forms
            .into_iter()
            .find(|&(form, _)| self.is_function_method(method, form))?;
        Some(CallWithReceiver {
            signature,
            takes_argument_list,
        })
    }

    fn is_function_method(&mut self, method: &'p Prop<'p>, name: Atom) -> bool {
        [known::CallableFunction, known::Function]
            .into_iter()
            .any(|interface| {
                let functions = self.c.global_ref(interface, &[]);
                let declared = self.c.get_property_of_type(functions, name);
                declared.is_some_and(|(declared, _)| declared.source == method.source)
            })
    }

    fn type_of_usage(&mut self, usage: &Usage) -> TypeId {
        if self.c.is_stack_low() {
            return TypeId::ANY;
        }
        let mut parts = TypeParts::from_slice(&usage.arms.list);
        self.drop_arms_that_others_have_grown_from(&mut parts);
        if usage.facts.contains(Facts::NUMBER) {
            parts.push(self.number_type(usage.facts));
        }
        if usage.facts.contains(Facts::STRING) {
            parts.push(TypeId::STRING);
        }
        if usage.facts.contains(Facts::FUNCTION) {
            parts.push(self.c.global_ref(known::Function, &[]));
        } else if !usage.facts.contains(Facts::INCOMPLETE) {
            self.add_object_parts(usage, &mut parts);
        }
        match parts[..] {
            [] => TypeId::ANY,
            [only] => only,
            _ => self.c.union(&parts),
        }
    }

    fn drop_arms_that_others_have_grown_from(&self, arms: &mut TypeParts) {
        if arms.len() <= Arms::FEW {
            return;
        }
        let mut grown_from = FxHashSet::default();
        for &arm in arms.iter() {
            let mut union = arm;
            while let Some(growth) = self.c.growth_of(union)
                && !self.c.has_named_unions(growth.from)
                && grown_from.insert(growth.from)
            {
                union = growth.from;
            }
        }
        arms.retain(|arm| !grown_from.contains(&*arm));
    }

    fn type_of_part(&mut self, part: &Rc<Usage>) -> TypeId {
        if part.members.is_empty() && part.elements.is_none() {
            return self.type_of_usage(part);
        }
        if let Some(&(_, known)) = self.memo.types_of_parts.get(&Rc::as_ptr(part)) {
            return known;
        }
        let not_kept = (self.count_answers_not_kept(), self.c.times_cut_short.get());
        let ty = self.type_of_usage(part);
        if not_kept == (self.count_answers_not_kept(), self.c.times_cut_short.get()) {
            let kept = (Rc::clone(part), ty);
            self.memo.types_of_parts.insert(Rc::as_ptr(part), kept);
        }
        ty
    }

    fn number_type(&mut self, facts: Facts) -> TypeId {
        let int32 = self.c.p.aot_symbols().int32_alias();
        match int32 {
            Some(int32)
                if facts.intersects(Facts::INT32 | Facts::KEY)
                    && !facts.contains(Facts::UINT32_STORED) =>
            {
                self.c.declared_type(int32)
            }
            Some(_) | None => TypeId::NUMBER,
        }
    }

    fn add_object_parts(&mut self, usage: &Usage, parts: &mut TypeParts) {
        let elements = usage.elements.as_deref();
        if usage.facts.contains(Facts::OBJECT) && elements.is_none() {
            parts.push(TypeId::OBJECT);
            return;
        }
        let stores_object = usage.facts.contains(Facts::OBJECT_LITERAL_STORED);
        if usage.members.is_empty() && (elements.is_none() || stores_object) {
            return;
        }
        let element_type = match &usage.elements {
            Some(elements) => self.type_of_part(elements),
            None => TypeId::ANY,
        };
        let array = self.c.array_of(element_type);
        let can_be_array = !stores_object && self.has_every_member_beside_elements(array, usage);
        let can_be_string = !stores_object
            && !usage.has_stored_part()
            && (element_type == TypeId::ANY || element_type == TypeId::STRING)
            && self.has_every_member_beside_elements(TypeId::STRING, usage);
        let any_array = self.c.array_of(TypeId::ANY);
        if can_be_array && let Some(at) = parts.iter().position(|&part| part == any_array) {
            parts[at] = array;
            if can_be_string && elements.is_some() && !parts.contains(&TypeId::STRING) {
                parts.push(TypeId::STRING);
            }
            return;
        }
        let mut fitting = TypeParts::new();
        for (fits, candidate) in [(can_be_array, array), (can_be_string, TypeId::STRING)] {
            if fits && elements.is_some() {
                fitting.push(candidate);
            }
        }
        let is_decided = parts
            .iter()
            .any(|&part| fitting.contains(&part) || self.c.is_array(part));
        let function = self.c.global_ref(known::Function, &[]);
        let can_be_function =
            usage.members.any(Member::is_called) && self.has_every_member(function, &usage.members);
        let can_be_builtin = can_be_array || can_be_string || can_be_function;
        match fitting[..] {
            [] if can_be_builtin => {}
            [] => {
                let known_parts = parts.clone();
                let mut known_parts = known_parts.into_iter();
                if !known_parts.any(|part| self.has_every_member(part, &usage.members)) {
                    parts.push(self.object_type_of(&usage.members));
                }
            }
            [only] => parts.push(only),
            _ if is_decided => {}
            _ => parts.extend_from_slice(&fitting),
        }
    }

    fn has_every_member(&mut self, receiver: TypeId, members: &Members) -> bool {
        let holder = self.c.property_holder_for_every_name(receiver);
        match members {
            Members::Few(members) => {
                let mut members = members.iter();
                members.all(|member| self.has_member(receiver, holder, member, false))
            }
            Members::Many(members) => self.has_all_of_many(receiver, holder, &members.by_name),
        }
    }

    fn has_every_member_beside_elements(&mut self, receiver: TypeId, usage: &Usage) -> bool {
        match &usage.members {
            Members::Few(members) if usage.elements.is_some() => {
                let holder = self.c.property_holder_for_every_name(receiver);
                let mut members = members.iter();
                members.all(|member| self.has_member(receiver, holder, member, true))
            }
            members => self.has_every_member(receiver, members),
        }
    }

    fn has_member(
        &mut self,
        receiver: TypeId,
        holder: Option<PropertyHolder<'p>>,
        member: &Member,
        methods_may_be_read: bool,
    ) -> bool {
        let found = match holder {
            Some(holder) => self.c.property_of_holder(holder, member.name, false),
            None => self.c.get_property_of_type(receiver, member.name),
        };
        let found = found.or_else(|| {
            self.c
                .property_that_some_literals_have(receiver, member.name)
        });
        found.is_some_and(|(property, _)| {
            let is_method = property.flags.contains(PropFlags::METHOD);
            is_method == member.is_called() || (is_method && methods_may_be_read)
        })
    }

    fn has_all_of_many(
        &mut self,
        receiver: TypeId,
        holder: Option<PropertyHolder<'p>>,
        members: &Rc<MembersByName>,
    ) -> bool {
        let (without_bit, with_bit) = match &**members {
            MembersByName::One { member, .. } => {
                return self.has_member(receiver, holder, member, false);
            }
            MembersByName::Both {
                without_bit,
                with_bit,
                ..
            } => (without_bit, with_bit),
        };
        let key = (receiver, Rc::as_ptr(members));
        if let Some(&(_, known)) = self.memo.members_found.get(&key) {
            return known;
        }
        let not_kept = (self.count_answers_not_kept(), self.c.times_cut_short.get());
        let has_all = self.has_all_of_many(receiver, holder, without_bit)
            && self.has_all_of_many(receiver, holder, with_bit);
        if not_kept == (self.count_answers_not_kept(), self.c.times_cut_short.get()) {
            let kept = (Rc::clone(members), has_all);
            self.memo.members_found.insert(key, kept);
        }
        has_all
    }

    fn object_type_of(&mut self, members: &Members) -> TypeId {
        let mut props = Vec::with_capacity(members.len());
        for member in members.in_order() {
            let mut flags = match member.usage.facts.contains(Facts::REQUIRED) {
                true => PropFlags::empty(),
                false => PropFlags::OPTIONAL,
            };
            if member.is_called() {
                flags |= PropFlags::METHOD;
            }
            props.push(Prop {
                name: member.name,
                flags,
                source: PropSource::Type(self.type_of_part(&member.usage)),
                mapper: MapperId::IDENTITY,
                name_type: TypeId::UNRESOLVED,
            });
        }
        let atoms = self.c.atoms();
        let mut props: Vec<(u64, Prop)> = (props.into_iter())
            .map(|prop| (first_bytes_of(atoms.bytes(prop.name)), prop))
            .collect();
        props.sort_unstable_by(|a, b| {
            let whole_names = || atoms.bytes(a.1.name).cmp(atoms.bytes(b.1.name));
            a.0.cmp(&b.0).then_with(whole_names)
        });
        let props = props.into_iter().map(|(_, prop)| prop);
        let arena = self.c.arena;
        self.c.synth(Shape {
            props: vec_from_iter_in(props, arena),
            ..Shape::new_in(arena)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(usage: &Usage) -> Vec<Atom> {
        let members = usage.members.in_order();
        members.into_iter().map(|member| member.name).collect()
    }

    #[test]
    fn references_to_one_subject_are_found_together() {
        let references = [
            (SymbolId(1), ExprId(4)),
            (SymbolId(3), ExprId(2)),
            (SymbolId(3), ExprId(9)),
            (SymbolId(7), ExprId(1)),
        ];
        assert_eq!(references_to(&references, SymbolId(3)), &references[1..3]);
        assert!(references_to(&references, SymbolId(2)).is_empty());
        assert!(references_to(&references, SymbolId(8)).is_empty());
    }

    #[test]
    fn only_a_subject_that_started_earlier_taints() {
        let mut subjects = SubjectStack::default();
        let outer = subjects.enter();
        let inner = subjects.enter();
        subjects.revisit(inner.depth);
        assert!(!subjects.leave(inner));
        let inner = subjects.enter();
        let innermost = subjects.enter();
        subjects.revisit(outer.depth);
        assert!(subjects.leave(innermost));
        assert!(subjects.leave(inner));
        assert!(!subjects.leave(outer));
        assert_eq!(subjects.depth, 0);
    }

    #[test]
    fn a_later_subject_does_not_inherit_an_earlier_revisit() {
        let mut subjects = SubjectStack::default();
        let outer = subjects.enter();
        let middle = subjects.enter();
        subjects.revisit(outer.depth);
        let clean = subjects.enter();
        assert!(!subjects.leave(clean));
        assert!(subjects.leave(middle));
        assert!(!subjects.leave(outer));
    }

    #[test]
    fn walk_ends_with_its_budget() {
        let mut walk = Walk::new(2);
        assert!(walk.enter_node());
        assert!(!walk.is_out_of_budget());
        assert!(walk.enter_node());
        assert!(walk.is_out_of_budget());
        assert!(!walk.enter_node());
    }

    #[test]
    fn merge_keeps_the_order_of_first_use() {
        let mut usage = Usage::default();
        usage.member_mut(known::length).facts |= Facts::NUMBER;
        let mut other = Usage::default();
        other.member_mut(known::call).facts |= Facts::FUNCTION;
        other.member_mut(known::length).facts |= Facts::REQUIRED;
        other.elements_mut().add_arm(TypeId::STRING);
        usage.merge(&mut Walk::new(16), &other);
        assert_eq!(names(&usage), [known::length, known::call]);
        assert_eq!(
            usage.members.in_order()[0].usage.facts,
            Facts::NUMBER | Facts::REQUIRED
        );
        assert_eq!(usage.elements_mut().arms.list[..], [TypeId::STRING]);
    }

    #[test]
    fn long_lists_merge_as_short_ones_do() {
        let (mut usage, mut other) = (Usage::default(), Usage::default());
        for index in 0..40 {
            usage.member_mut(Atom(index)).facts |= Facts::NUMBER;
            other.member_mut(Atom(60 - index)).facts |= Facts::REQUIRED;
        }
        let (mut holder, mut other_holder) = (Usage::default(), Usage::default());
        *holder.member_mut(known::length) = usage.clone();
        *other_holder.member_mut(known::length) = other.clone();
        usage.merge(&mut Walk::new(1000), &other);
        let expected: Vec<Atom> = (0..40).chain((40..=60).rev()).map(Atom).collect();
        assert_eq!(names(&usage), expected);
        for member in usage.members.in_order() {
            let expected = match member.name.0 {
                0..=20 => Facts::NUMBER,
                21..=39 => Facts::NUMBER | Facts::REQUIRED,
                _ => Facts::REQUIRED,
            };
            assert_eq!(member.usage.facts, expected, "{:?}", member.name);
        }
        holder.merge(&mut Walk::new(1000), &other_holder);
        assert!(*holder.members.in_order()[0].usage == usage);
    }

    #[test]
    fn a_part_is_taken_as_it_stands_only_where_own_names_come_first_in_it() {
        let (first, second, holder) = (Atom(1), Atom(2), Atom(3));
        let mut other = Usage::default();
        other.member_mut(holder).member_mut(first);
        other.member_mut(holder).member_mut(second);
        let part_of = |usage: &Usage| Rc::clone(&usage.members.in_order()[0].usage);

        let mut begins_alike = Usage::default();
        begins_alike.member_mut(holder).member_mut(first);
        begins_alike.merge(&mut Walk::new(1000), &other);
        assert!(Rc::ptr_eq(&part_of(&begins_alike), &part_of(&other)));

        let mut begins_otherwise = Usage::default();
        begins_otherwise.member_mut(holder).member_mut(second);
        begins_otherwise.merge(&mut Walk::new(1000), &other);
        assert_eq!(names(&part_of(&begins_otherwise)), [second, first]);
    }

    #[test]
    fn a_part_is_not_taken_as_it_stands_where_the_budget_runs_dry_on_the_way() {
        let (first, second, below, holder) = (Atom(1), Atom(2), Atom(3), Atom(4));
        let mut own = Usage::default();
        own.member_mut(holder).member_mut(first);
        own.member_mut(holder).member_mut(second);
        let mut other = own.clone();
        other.member_mut(holder).member_mut(first).member_mut(below);
        other.member_mut(holder).member_mut(second).facts |= Facts::NUMBER;

        let mut walk = Walk::new(1);
        own.merge(&mut walk, &other);
        assert!(walk.is_out_of_budget());
        let merged = Rc::clone(&own.members.in_order()[0].usage);
        assert_eq!(names(&merged.members.get(first).unwrap().usage), [below]);
        assert!(
            !merged
                .members
                .get(second)
                .unwrap()
                .usage
                .facts
                .contains(Facts::NUMBER)
        );
    }

    #[derive(Clone, Default, PartialEq, Debug)]
    struct PlainUsage {
        facts: Facts,
        members: Vec<(Atom, PlainUsage)>,
    }

    impl PlainUsage {
        fn of(usage: &Usage) -> PlainUsage {
            let members = usage.members.in_order().into_iter();
            PlainUsage {
                facts: usage.facts,
                members: members
                    .map(|member| (member.name, PlainUsage::of(&member.usage)))
                    .collect(),
            }
        }

        fn count_nodes(&self) -> u64 {
            1 + self
                .members
                .iter()
                .map(|member| member.1.count_nodes())
                .sum::<u64>()
        }

        fn merge(&mut self, remaining_nodes: &mut u64, other: &PlainUsage) {
            if *remaining_nodes == 0 {
                return;
            }
            self.facts |= other.facts;
            let count_before = self.members.len();
            for (name, part) in &other.members {
                let own = self.members[..count_before].iter();
                match own.into_iter().position(|member| member.0 == *name) {
                    Some(own) => self.members[own].1.merge(remaining_nodes, part),
                    None if part.count_nodes() <= *remaining_nodes => {
                        *remaining_nodes -= part.count_nodes();
                        self.members.push((*name, part.clone()));
                    }
                    None if *remaining_nodes > 0 => {
                        *remaining_nodes -= 1;
                        let mut added = PlainUsage::default();
                        added.merge(remaining_nodes, part);
                        self.members.push((*name, added));
                    }
                    None => {}
                }
            }
        }
    }

    #[test]
    fn many_members_merge_as_a_list_of_them_does() {
        let mut seed: u64 = 7;
        let mut next = |below: u64| {
            seed = seed * 48_271 % 2_147_483_647;
            seed % below
        };
        let all_facts = [Facts::NUMBER, Facts::STRING, Facts::REQUIRED, Facts::STORED];
        let mut trees: Vec<(Rc<Usage>, PlainUsage)> = Vec::new();
        let (mut ended_budgets, mut most_members) = (0, 0);
        let remembered = Rc::<RefCell<PartsRemembered>>::default();
        const ROUNDS: u32 = if cfg!(miri) { 150 } else { 1500 };
        for round in 0..ROUNDS {
            let (mut usage, mut plain) = (Usage::default(), PlainUsage::default());
            let steps = 1 + next(5);
            for _ in 0..steps {
                if trees.is_empty() || next(3) == 0 {
                    let name = Atom(match next(4) {
                        0 => next(1 << 31) as u32,
                        _ => next(300) as u32,
                    });
                    let fact = all_facts[next(4) as usize];
                    usage.member_mut(name).facts |= fact;
                    match plain.members.iter_mut().find(|member| member.0 == name) {
                        Some(member) => member.1.facts |= fact,
                        None => {
                            let (facts, members) = (fact, Vec::new());
                            plain.members.push((name, PlainUsage { facts, members }));
                        }
                    }
                    continue;
                }
                let other = &trees[next(trees.len() as u64) as usize];
                let most = other.1.count_nodes() + 2;
                let budget = if next(4) == 0 { next(most) } else { 1 << 40 };
                let remembered = Rc::clone(&remembered);
                let mut walk = Walk {
                    remembered,
                    ..Walk::new(budget)
                };
                let mut remaining_nodes = budget;
                if next(5) == 0 {
                    let name = Atom(next(300) as u32);
                    usage.member_mut(name).merge(&mut walk, &other.0);
                    if !plain.members.iter().any(|member| member.0 == name) {
                        plain.members.push((name, PlainUsage::default()));
                    }
                    let mut parts = plain.members.iter_mut();
                    let part = parts.find(|member| member.0 == name).unwrap();
                    part.1.merge(&mut remaining_nodes, &other.1);
                } else {
                    usage.merge(&mut walk, &other.0);
                    plain.merge(&mut remaining_nodes, &other.1);
                }
                assert_eq!(walk.remaining_nodes, remaining_nodes, "round {round}");
                ended_budgets += u32::from(remaining_nodes == 0);
            }
            assert_eq!(PlainUsage::of(&usage), plain, "round {round}");
            assert_eq!(usage.count_nodes(u64::MAX), Some(plain.count_nodes()));
            assert_eq!(usage.count_nodes(plain.count_nodes() - 1), None);
            assert!(usage == usage.clone());
            assert_orders_are_light(&usage);
            most_members = most_members.max(usage.members.len());
            trees.push((Rc::new(usage), plain));
        }
        assert!(ended_budgets > ROUNDS / 15, "{ended_budgets}");
        assert!(
            most_members > if cfg!(miri) { 30 } else { 100 },
            "{most_members}"
        );
    }

    fn assert_orders_are_light(usage: &Usage) {
        if let Members::Many(members) = &usage.members {
            let count = u64::from(members.by_name.count());
            assert!(members.order.weight <= 4 * count + 16, "{count}");
        }
        for member in usage.members.in_order() {
            assert_orders_are_light(&member.usage);
        }
    }

    fn count_orders(usage: &Usage) -> usize {
        let Members::Many(members) = &usage.members else {
            return 0;
        };
        let (mut met, mut open) = (FxHashSet::default(), vec![&members.order]);
        while let Some(order) = open.pop() {
            if met.insert(Rc::as_ptr(order)) {
                open.extend(order.pieces.iter().filter_map(|piece| match piece {
                    PieceOfOrder::All(names) => Some(names),
                    PieceOfOrder::Name(_) => None,
                }));
            }
        }
        met.len()
    }

    #[test]
    fn trees_with_the_same_few_names_do_not_string_their_orders_together() {
        let mut next: Option<Rc<Usage>> = None;
        for index in 0..100 {
            let mut usage = Usage::default();
            usage.member_mut(Atom(index % 12)).facts |= Facts::NUMBER;
            if let Some(next) = &next {
                usage.merge(&mut Walk::new(4096), next);
            }
            assert_orders_are_light(&usage);
            assert!(count_orders(&usage) <= 4 * 12 + 16, "{index}");
            next = Some(Rc::new(usage));
        }
        let expected: Vec<Atom> = (0..12).map(|back| Atom((99 - back) % 12)).collect();
        assert_eq!(names(&next.unwrap()), expected);
    }

    #[test]
    fn a_name_behind_the_names_of_the_next_copies_no_order() {
        let mut next: Option<Rc<Usage>> = None;
        let mut pieces = 0;
        for index in 0..100 {
            let mut usage = Usage::default();
            if let Some(next) = &next {
                usage.merge(&mut Walk::new(4096), next);
            }
            usage.member_mut(Atom(index)).facts |= Facts::STORED;
            if let Members::Many(members) = &usage.members {
                pieces += members.order.pieces.len();
            }
            assert_orders_are_light(&usage);
            next = Some(Rc::new(usage));
        }
        assert!(pieces <= 3 * 100, "{pieces}");
        let expected: Vec<Atom> = (0..100).map(Atom).collect();
        assert_eq!(names(&next.unwrap()), expected);
    }

    #[test]
    fn a_tree_takes_over_the_members_of_the_next_as_they_lie_there() {
        let mut next: Option<Rc<Usage>> = None;
        for index in 0..100 {
            let mut usage = Usage::default();
            usage.member_mut(Atom(index)).facts |= Facts::STORED;
            if let Some(next) = &next {
                usage.merge(&mut Walk::new(4096), next);
            }
            next = Some(Rc::new(usage));
        }
        let first = next.unwrap();
        let expected: Vec<Atom> = (0..100).rev().map(Atom).collect();
        assert_eq!(names(&first), expected);
        let mut again = Usage::default();
        again.merge(&mut Walk::new(4096), &first);
        let (Members::Many(taken), Members::Many(there)) = (&again.members, &first.members) else {
            panic!("they are many");
        };
        assert!(Rc::ptr_eq(&taken.by_name, &there.by_name));
        assert!(again == *first);
    }

    #[test]
    fn first_bytes_are_in_the_order_of_the_names() {
        let names: [&[u8]; 10] = [
            b"",
            b"\0",
            b"a",
            b"a\0",
            b"a\0b",
            b"ab",
            b"abcdefgh",
            b"abcdefgh\0",
            b"abcdefghi",
            b"b",
        ];
        assert!(names.is_sorted());
        assert!(names.is_sorted_by_key(|name| first_bytes_of(name)));
        assert!(first_bytes_of(b"a") < first_bytes_of(b"ab"));
        assert!(first_bytes_of(b"f10") < first_bytes_of(b"f2"));
    }

    #[test]
    fn merge_stops_without_budget() {
        let mut other = Usage::default();
        other.member_mut(known::length);
        other.member_mut(known::call);
        let mut usage = Usage::default();
        usage.merge(&mut Walk::new(2), &other);
        assert_eq!(names(&usage), [known::length, known::call]);
        assert!(usage.members.in_order()[1].usage.facts.is_empty());
        let mut walk = Walk::new(0);
        let mut untouched = Usage::default();
        untouched.merge(&mut walk, &other);
        assert!(untouched.members.is_empty());
    }

    #[test]
    fn only_the_right_side_of_in_and_of_a_comma_says_something() {
        let (whole, other) = (ExprId(1), ExprId(2));
        let find = |op, side| find_use_as_binary_operand(op, whole, side, other);
        assert!(matches!(find(BinOp::In, Side::Left), Use::Nothing));
        assert!(matches!(
            find(BinOp::In, Side::Right),
            Use::Object { is_required: true }
        ));
        assert!(matches!(find(BinOp::Comma, Side::Left), Use::Nothing));
        assert!(matches!(
            find(BinOp::Comma, Side::Right),
            Use::PassedOn(ExprId(1))
        ));
    }

    #[test]
    fn int32_values_are_whole_and_in_range() {
        for value in [0.0, -1.0, 7.0, 2147483647.0, -2147483648.0] {
            assert!(is_int32_value(value), "{value}");
        }
        for value in [
            0.5,
            -0.0,
            2147483648.0,
            -2147483649.0,
            f64::NAN,
            f64::INFINITY,
        ] {
            assert!(!is_int32_value(value), "{value}");
        }
    }

    #[test]
    fn an_unsigned_shift_and_a_sum_may_leave_int32() {
        for op in [
            BinOp::Shl,
            BinOp::Shr,
            BinOp::BitAnd,
            BinOp::BitOr,
            BinOp::BitXor,
        ] {
            assert!(yields_int32(op), "{op:?}");
        }
        for op in [BinOp::UShr, BinOp::Add, BinOp::Sub, BinOp::Mul, BinOp::Rem] {
            assert!(!yields_int32(op), "{op:?}");
        }
    }

    #[test]
    fn a_stored_part_is_an_element_or_a_member() {
        let mut usage = Usage::default();
        usage.member_mut(known::length);
        assert!(!usage.has_stored_part());
        usage.facts |= Facts::STORED;
        assert!(!usage.has_stored_part());
        usage.elements_mut().facts |= Facts::STORED;
        assert!(usage.has_stored_part());
    }
}
