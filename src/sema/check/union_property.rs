//! The properties of a union type: `createUnionOrIntersectionProperty` where `isUnion`. `build_intersection_shape` has the
//! other half.
//!
//! `createUnionOrIntersectionProperty` asks every member of the union for the name. In a union of a hundred object types most
//! names are in a few members. In each of the others it works out where to look, looks the name up in vain, and then looks
//! for an index signature that applies. To spare that, three things are kept, each once it has been earned:
//! - `MemberFacts`: what does not depend on the name, if the name is an ordinary one. With them, a member that does not
//!   have the name takes a lookup and little else.
//! - `UnionMembers::holders`: for a name, the members that have it.
//! - `UnionSummary`: what the members of a long union add where they do not have a name, taken together. With the holders
//!   of the name, it says which members to visit, and the others are not even looked at.
//!
//! The first two are kept for the member, not for the union: whatever narrows or filters a union makes another union of the
//! same members. The third is a few bits for each member of the union.
//!
//! Asking a member can resolve types, report errors and close cycles, so none of this may change what is resolved, nor in
//! which order:
//! - The facts are a by-product of asking the member. Nothing is resolved for their sake.
//! - They are only what is final: what a type says about itself, and what a table or a memo has stored. Asking for that again
//!   computes nothing, so not asking is not observable.
//! - A member about which more than that is needed has no facts, and is asked each time.
//! - The members that are visited are visited in the order of the union.

use super::shape::{LONG_PROP_LIST, PropertyHolder, is_plain_object};
use super::*;
use crate::util::{FxHashSet, PositionSet};
use smallvec::SmallVec;

/// The members of a shorter union are asked each time. Most unions are short, and there is little to save in them.
const MIN_MEMBERS_FOR_FACTS: usize = 8;

/// The length of `UnionMembers::recent`: more than the members of all but a few unions. `UnionMembers::walked` is for those.
const RECENT_UNION_MEMBERS: usize = 512;

/// A shorter union has no summary: to go through its members with their facts takes no longer than the rest of what it
/// takes to make a property, so there is little left to save.
const MIN_MEMBERS_FOR_SUMMARY: usize = 128;

/// A name with more holders than this is looked up in every member. The holders are those in any union: to find one among
/// the members takes about 2 instructions a member, to visit a member that has facts and not the name about 50.
const MOST_HOLDERS_TO_FIND: usize = 16;

/// The flags that say which accessors a property has, besides `READONLY`.
const ACCESSOR_KIND: PropFlags = PropFlags::ACCESSOR.union(PropFlags::WRITE_ONLY);

/// What a member that does not have the property adds to the property of the union.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Missing {
    /// `getApplicableIndexInfoForName` finds an index signature. `value`: its type, or for a tuple the type of the elements
    /// after the fixed ones.
    IndexSignature { value: TypeId, is_readonly: bool },
    /// The member is the type of an object literal without spreads, which has no other properties: `undefined`.
    ClosedObjectLiteral,
    /// `CheckFlagsReadPartial`
    ReadPartial,
}

/// `Missing` for a member and every ordinary name that it does not have.
#[derive(Copy, Clone)]
enum WhenMissing {
    /// Not found out yet. It takes the index signatures of the member, and resolving those of an intersection compares the
    /// signatures of its constituents: that waits for a name that is missing.
    Unknown,
    /// The member is a tuple, or has an index signature whose key type is not `string`, or one whose type is instantiated
    /// each time.
    DependsOnName,
    Adds(Missing),
}

/// What the first loop of `createUnionOrIntersectionProperty` works out about a member of a union before it uses the name.
/// The member has the properties in `members`, and no other that has an ordinary name.
#[derive(Copy, Clone)]
struct MemberFacts<'p> {
    /// `getApparentType` of the member.
    apparent_type: TypeId,
    /// `getReducedApparentType` of that, which `members` are the members of.
    reduced_apparent_type: TypeId,
    members: Members<'p>,
    when_missing: WhenMissing,
    /// How many times it was `Adds` for a name in a union that may get a summary. Not counted once `is_listed`.
    asked_in_vain: u32,
    /// The member is in `UnionMembers::holders` under the name of each of its properties. Then `when_missing` is `Adds`.
    is_listed: bool,
}

/// What a long union needs besides the holders of a name to make the property of that name.
struct UnionSummary {
    /// The members that were not listed when this was made.
    always_visited: PositionSet,
    /// What the other members add where they do not have the name, and which of them add it.
    missing: SmallVec<[(Missing, PositionSet); 2]>,
}

/// A type id can be the task's own, so none of this is shared with other tasks.
#[derive(Default)]
pub(super) struct UnionMembers<'p> {
    facts: FxHashMap<TypeId, MemberFacts<'p>>,
    /// The intersections among `apparent_type` and `reduced_apparent_type` of `facts`.
    reduced: FxHashSet<TypeId>,
    /// The unions whose members were all visited for a property. Facts and summaries are kept from the second time on: to
    /// keep them costs about as much as to visit the members once, and many unions are asked for one property and no more.
    walked: FxHashSet<TypeId>,
    /// The members without facts that were visited last, each at its id modulo the length. One that is visited again gets
    /// its facts as well: a union that is narrowed in many ways makes many unions that are each asked once.
    recent: Vec<TypeId>,
    /// For each name, the members with `is_listed` that have it.
    holders: FxHashMap<Atom, SmallVec<[TypeId; 4]>>,
    summaries: FxHashMap<TypeId, UnionSummary>,
}

/// What `add_member` has found out about a member.
#[derive(Copy, Clone)]
struct MemberLookup<'p> {
    holder: PropertyHolder<'p>,
    /// Nothing made the computation in progress invalid for the next caller while `holder` was worked out.
    is_holder_final: bool,
    /// If the member does not have the name: what it adds, and whether the same holds for that.
    missing: Option<(Missing, bool)>,
}

/// What stays the same, or is found out once, while the members of a union are visited for a property.
struct Walk {
    name: Atom,
    /// `skipObjectFunctionPropertyAugment`
    skips: bool,
    is_late_bound: bool,
    uses_facts: bool,
    /// All the members of the union were visited before, with `uses_facts`.
    is_walked_again: bool,
    /// The union is long enough for a summary.
    is_long: bool,
    /// `Checker::is_ordinary_name`, once a member did not have the name.
    is_ordinary_name: Option<bool>,
    /// The literal type of the name exists.
    has_literal_type: bool,
    /// How many of the members visited so far a summary would have in `always_visited`.
    always_visited: usize,
}

/// What the first loop of `createUnionOrIntersectionProperty` gathers from the members of a union.
struct UnionPropertyBuilder<'p, 's> {
    /// `singleProp` is the first.
    prop_set: SmallVec<[Prop<'s>; 4]>,
    /// `Prop::fx_hash_without_lists` of what is in `prop_set`, once that is long.
    prop_hashes: FxHashSet<u64>,
    /// `prop != singleProp`, `propSet.Add(prop)`: a symbol that many members inherit is considered once.
    symbols: SmallVec<[(*const Prop<'p>, MapperId); LONG_PROP_LIST]>,
    /// `symbols`, and the ones that came when that was full.
    more_symbols: FxHashSet<(*const Prop<'p>, MapperId)>,
    /// `indexTypes`, each with the position of the first member that adds it, in the order of the members.
    index_types: SmallVec<[(usize, TypeId); 4]>,
    merged_instantiations: bool,
    flags: PropFlags,
    is_public: bool,
    /// The apparent type of the member that has `singleProp`.
    first_owner: TypeId,
    /// The position of that member.
    first_at: Option<usize>,
}

impl<'p, 's> UnionPropertyBuilder<'p, 's> {
    fn new(containing_type: TypeId) -> UnionPropertyBuilder<'p, 's> {
        UnionPropertyBuilder {
            prop_set: SmallVec::new(),
            prop_hashes: FxHashSet::default(),
            symbols: SmallVec::new(),
            more_symbols: FxHashSet::default(),
            index_types: SmallVec::new(),
            merged_instantiations: false,
            flags: PropFlags::empty(),
            is_public: false,
            first_owner: containing_type,
            first_at: None,
        }
    }

    /// `false`: an earlier member had the symbol.
    fn insert_symbol(&mut self, symbol: (*const Prop<'p>, MapperId)) -> bool {
        if self.symbols.len() < LONG_PROP_LIST {
            if self.symbols.contains(&symbol) {
                return false;
            }
            self.symbols.push(symbol);
            return true;
        }
        if self.more_symbols.is_empty() {
            self.more_symbols.extend(self.symbols.iter().copied());
        }
        self.more_symbols.insert(symbol)
    }

    /// Whether `prop` is not in `prop_set`. The caller adds it then.
    fn is_new_prop(&mut self, prop: &Prop<'s>) -> bool {
        if self.prop_set.len() < LONG_PROP_LIST {
            return !self.prop_set.contains(prop);
        }
        if self.prop_hashes.is_empty() {
            let hashes = self.prop_set.iter().map(Prop::fx_hash_without_lists);
            self.prop_hashes.extend(hashes);
        }
        // A new hash says that the property is new. Otherwise the list says.
        self.prop_hashes.insert(prop.fx_hash_without_lists()) || !self.prop_set.contains(prop)
    }

    /// The member at `at` does not have the property. A member may be added out of turn once `first_at` is final.
    fn add_missing(&mut self, at: usize, missing: Missing) {
        match missing {
            Missing::IndexSignature { value, is_readonly } => {
                // Only `singleProp` sets these flags, so a member before it has nothing to remove.
                if self.first_at.is_some_and(|first| first < at) {
                    self.flags.remove(ACCESSOR_KIND);
                }
                self.flags |= PropFlags::WRITE_PARTIAL;
                if is_readonly {
                    self.flags |= PropFlags::READONLY;
                }
                self.add_index_type(at, value);
            }
            Missing::ClosedObjectLiteral => {
                self.flags |= PropFlags::WRITE_PARTIAL;
                self.add_index_type(at, TypeId::UNDEFINED);
            }
            Missing::ReadPartial => self.flags |= PropFlags::READ_PARTIAL,
        }
    }

    /// `indexTypes` only feeds `getUnionType`, so a type is kept once. Properties are compared by value, so the order has to
    /// be the same however many of the members were visited.
    fn add_index_type(&mut self, at: usize, ty: TypeId) {
        if let Some(same) = self.index_types.iter().position(|it| it.1 == ty) {
            if self.index_types[same].0 <= at {
                return;
            }
            self.index_types.remove(same);
        }
        let before = self.index_types.iter().rposition(|it| it.0 <= at);
        let place = before.map_or(0, |before| before + 1);
        self.index_types.insert(place, (at, ty));
    }
}

impl<'p, 's> Checker<'p, 's> {
    /// `getUnionOrIntersectionProperty` for a union.
    pub(super) fn union_property(&mut self, union: TypeId, name: Atom) -> Option<&'p Prop<'p>> {
        self.union_property_ex(union, name, false)
    }

    /// `skips`: `skipObjectFunctionPropertyAugment`. `union_properties` is `propertyCache`. There is
    /// no `propertyCacheWithoutFunctionPropertyAugment`: only the import of a name from a module
    /// with `export =` looks a property of a union up that way.
    pub(super) fn union_property_ex(
        &mut self,
        union: TypeId,
        name: Atom,
        skips: bool,
    ) -> Option<&'p Prop<'p>> {
        let kept = match skips {
            true => None,
            false => self.p.union_properties.get(&self.task, &(union, name)),
        };
        let holder = match kept {
            Some(kept) => kept,
            None => {
                let scope = self.begin_scope();
                let holder = self.create_union_property(union, name, skips).map(|prop| {
                    self.synth(Shape {
                        props: vec_from_iter_in([prop], self.arena),
                        ..Shape::new_in(self.arena)
                    })
                });
                if let Ok(stored) = self.end_scope_by_counters(scope)
                    && !skips
                {
                    self.p
                        .union_properties
                        .insert(&self.task, (union, name), holder, stored);
                }
                holder
            }
        };
        match self.data(holder?) {
            TypeData::Synth(shape) => shape.props.first(),
            _ => None,
        }
    }

    /// `CheckFlagsHasNonUniformType` and `CheckFlagsHasLiteralType` of the property that
    /// `createUnionOrIntersectionProperty` makes of `props`. That of a union has them among its
    /// flags. That of an intersection has not: its type is resolved lazily.
    fn non_uniform_and_literal(&mut self, props: &[Prop<'_>]) -> PropFlags {
        let mut flags = PropFlags::empty();
        let first_type = self.type_of_prop(&props[0], MapperId::IDENTITY);
        for prop in props {
            let t = self.type_of_prop(prop, MapperId::IDENTITY);
            if t != first_type {
                flags |= PropFlags::HAS_NON_UNIFORM_TYPE;
            }
            // `isLiteralType`, `isPatternLiteralType`
            if self.is_boolean(t)
                || !t.is_never() && self.every_type(t, |c, m| c.is_unit(m))
                || self.is_pattern_literal(t)
            {
                flags |= PropFlags::HAS_LITERAL_TYPE;
            }
        }
        flags
    }

    /// `createUnionOrIntersectionProperty`, where `isUnion`.
    fn create_union_property(
        &mut self,
        containing_type: TypeId,
        name: Atom,
        skip_object_function_property_augment: bool,
    ) -> Option<Prop<'s>> {
        let skips = skip_object_function_property_augment;
        let parts = self.parts(containing_type);
        // Looking a name up in an intersection that is being reduced creates its properties once more: see
        // `reduce_apparent_type_of_intersection_in_progress`.
        let mut being_reduced = self.never_in_progress.iter();
        let uses_facts = parts.len() >= MIN_MEMBERS_FOR_FACTS
            && !skips
            // `members` leaves out what a type reference inherits.
            && self.unresolved_members.is_empty()
            && !being_reduced.any(|ty| self.union_members.reduced.contains(ty));
        let mut walk = Walk {
            name,
            skips,
            is_late_bound: self.atoms().is_symbol_name(name),
            uses_facts,
            is_walked_again: uses_facts,
            is_long: parts.len() >= MIN_MEMBERS_FOR_SUMMARY,
            is_ordinary_name: None,
            has_literal_type: false,
            always_visited: 0,
        };
        let mut builder = UnionPropertyBuilder::new(containing_type);
        if let Some(visited) = self.members_to_visit(containing_type, &mut walk) {
            self.visit_some_members(containing_type, &visited, &mut walk, &mut builder);
            return self.finish_union_property(builder, containing_type, name);
        }
        walk.is_walked_again = uses_facts && !self.union_members.walked.insert(containing_type);
        for (at, &current) in parts.iter().enumerate() {
            self.visit_member(&mut walk, &mut builder, at, current);
        }
        // With more to visit whatever the name, there is little that a summary would save.
        if walk.is_walked_again
            && walk.is_long
            && walk.always_visited * 8 <= parts.len()
            && !(self.union_members.summaries).contains_key(&containing_type)
        {
            self.summarize_union(containing_type);
        }
        self.finish_union_property(builder, containing_type, name)
    }

    /// Whether what a member adds where it does not have the name can be the same as for other names: no object type
    /// inherits the name from `Object` or `Function`, and it is neither late-bound nor numeric, where it depends on the key
    /// type of an index signature whether that applies.
    fn is_ordinary_name(&self, walk: &mut Walk) -> bool {
        let (name, is_late_bound) = (walk.name, walk.is_late_bound);
        *walk.is_ordinary_name.get_or_insert_with(|| {
            name.is_some()
                && !is_late_bound
                && !self.is_numeric_name(name)
                && self.is_never_inherited(name)
        })
    }

    /// The members of `union` to visit for the property, if its summary and the holders of the name say. `None`: all.
    fn members_to_visit(&self, union: TypeId, walk: &mut Walk) -> Option<PositionSet> {
        if !(walk.uses_facts && walk.is_long) {
            return None;
        }
        let summary = self.union_members.summaries.get(&union)?;
        if !self.is_ordinary_name(walk) {
            return None;
        }
        let holders = self.union_members.holders.get(&walk.name);
        let holders = holders.map_or(&[][..], |holders| &holders[..]);
        if holders.len() > MOST_HOLDERS_TO_FIND {
            return None;
        }
        let parts = self.parts(union);
        let mut visited = summary.always_visited.clone();
        for holder in holders {
            if let Some(at) = parts.iter().position(|member| member == holder) {
                visited.insert(at);
            }
        }
        Some(visited)
    }

    /// The first loop of `createUnionOrIntersectionProperty` for `union`, which has a summary. `visited`: what
    /// `members_to_visit` has returned.
    fn visit_some_members(
        &mut self,
        union: TypeId,
        visited: &PositionSet,
        walk: &mut Walk,
        builder: &mut UnionPropertyBuilder<'p, 's>,
    ) {
        let parts = self.parts(union);
        // `getApplicableIndexInfoForName` creates the literal type of the name for the first member that does not have the
        // name and has an index signature. If that member is not visited, the type is created in its turn all the same.
        let has_index_signature =
            |it: &&(Missing, PositionSet)| matches!(it.0, Missing::IndexSignature { .. });
        let creates_literal_type_at = (self.union_members.summaries.get(&union))
            .into_iter()
            .flat_map(|summary| summary.missing.iter().filter(has_index_signature))
            .filter_map(|it| it.1.first_except(visited))
            .min();
        for at in visited.iter() {
            if !walk.has_literal_type && creates_literal_type_at.is_some_and(|turn| turn < at) {
                self.string_literal(walk.name, false);
                walk.has_literal_type = true;
            }
            self.visit_member(walk, builder, at, parts[at]);
        }
        if !walk.has_literal_type && creates_literal_type_at.is_some() {
            self.string_literal(walk.name, false);
        }
        let Some(summary) = self.union_members.summaries.get(&union) else {
            return;
        };
        if builder.prop_set.is_empty() {
            return;
        }
        for (missing, members) in &summary.missing {
            // The first says where the index type goes, the last whether a member after `singleProp` adds it.
            let ends = [members.first_except(visited), members.last_except(visited)];
            for at in ends.into_iter().flatten() {
                builder.add_missing(at, *missing);
            }
        }
    }

    /// One turn of the first loop of `createUnionOrIntersectionProperty`: for `current`, the member at `at`.
    fn visit_member(
        &mut self,
        walk: &mut Walk,
        builder: &mut UnionPropertyBuilder<'p, 's>,
        at: usize,
        current: TypeId,
    ) {
        // No other kind of type has facts.
        let may_have_facts =
            walk.uses_facts && self.flags(current) & (tf::OBJECT | tf::INTERSECTION) != 0;
        let facts = match may_have_facts {
            true => self.union_members.facts.get(&current).copied(),
            false => None,
        };
        let Some(facts) = facts else {
            walk.always_visited += 1;
            let lookup = self.add_member(walk, builder, at, current);
            if may_have_facts
                && let Some(lookup) = lookup
                && (walk.is_walked_again || self.is_visited_again(current))
            {
                self.keep_member_facts(walk, current, lookup);
            }
            return;
        };
        walk.always_visited += usize::from(!facts.is_listed);
        let (t, members) = (facts.apparent_type, facts.members);
        if let Some(prop) = members.resolved.prop_past_filter(walk.name) {
            self.add_member_property(builder, at, t, prop, members.mapper);
            return;
        }
        if !self.is_ordinary_name(walk) {
            self.add_member(walk, builder, at, current);
            return;
        }
        let missing = match facts.when_missing {
            WhenMissing::Adds(missing) => {
                // See `visit_some_members`.
                if !walk.has_literal_type && matches!(missing, Missing::IndexSignature { .. }) {
                    self.string_literal(walk.name, false);
                    walk.has_literal_type = true;
                }
                // The list is of use to a union that has a summary.
                if walk.is_long && walk.is_walked_again && !facts.is_listed {
                    self.count_asked_in_vain(current);
                }
                missing
            }
            WhenMissing::DependsOnName => self.missing_from_member(t, walk.name, false),
            WhenMissing::Unknown => {
                let before = self.non_cacheable_mark();
                let missing = self.missing_from_member(t, walk.name, false);
                if self.non_cacheable_mark() == before {
                    let when_missing = self.when_missing(facts.reduced_apparent_type, missing);
                    if let Some(facts) = self.union_members.facts.get_mut(&current) {
                        facts.when_missing = when_missing;
                    }
                }
                missing
            }
        };
        builder.add_missing(at, missing);
    }

    /// Whether `current` is in `UnionMembers::recent`, where it is from now on.
    fn is_visited_again(&mut self, current: TypeId) -> bool {
        let recent = &mut self.union_members.recent;
        if recent.is_empty() {
            recent.resize(RECENT_UNION_MEMBERS, TypeId::NEVER);
        }
        let place = &mut recent[current.0 as usize % RECENT_UNION_MEMBERS];
        std::mem::replace(place, current) == current
    }

    /// `lookup`: what `add_member` has just returned for `current`.
    fn keep_member_facts(&mut self, walk: &mut Walk, current: TypeId, lookup: MemberLookup<'p>) {
        let Some(mut facts) = self.facts_of_member(current, lookup) else {
            return;
        };
        if let Some((missing, true)) = lookup.missing
            && self.is_ordinary_name(walk)
        {
            facts.when_missing = self.when_missing(facts.reduced_apparent_type, missing);
        }
        for ty in [facts.apparent_type, facts.reduced_apparent_type] {
            if self.is_intersection(ty) {
                self.union_members.reduced.insert(ty);
            }
        }
        self.union_members.facts.insert(current, facts);
    }

    /// The member `current`, which has facts and is not listed, did not have a name. It is listed once that has happened a
    /// quarter as many times as it has properties: to list a property takes about 60 instructions, and the facts have saved
    /// about 250 each time, so they have paid for it.
    fn count_asked_in_vain(&mut self, current: TypeId) {
        let UnionMembers { facts, holders, .. } = &mut self.union_members;
        let Some(facts) = facts.get_mut(&current) else {
            return;
        };
        let props = &facts.members.shape().props;
        facts.asked_in_vain += 1;
        if (facts.asked_in_vain as usize) * 4 < props.len() {
            return;
        }
        facts.is_listed = true;
        for prop in props {
            holders.entry(prop.name).or_default().push(current);
        }
    }

    fn summarize_union(&mut self, union: TypeId) {
        let parts = self.parts(union);
        let mut summary = UnionSummary {
            always_visited: PositionSet::new(parts.len()),
            missing: SmallVec::new(),
        };
        for (at, current) in parts.iter().enumerate() {
            let Some(&MemberFacts {
                when_missing: WhenMissing::Adds(missing),
                is_listed: true,
                ..
            }) = self.union_members.facts.get(current)
            else {
                summary.always_visited.insert(at);
                continue;
            };
            match summary.missing.iter_mut().find(|it| it.0 == missing) {
                Some((_, members)) => members.insert(at),
                None => {
                    let mut members = PositionSet::new(parts.len());
                    members.insert(at);
                    summary.missing.push((missing, members));
                }
            }
        }
        self.union_members.summaries.insert(union, summary);
    }

    /// `apparent_type(ty)` for an intersection or an object type that is not a mapped type, if asking again computes
    /// nothing: the type says it, or a memo has it.
    fn known_apparent_type(&self, ty: TypeId) -> Option<TypeId> {
        if !self.is_intersection(ty) || self.has_only_own_apparent_types(ty) {
            return Some(ty);
        }
        (self.apparent_types_of_intersections.get(&(ty, ty))).copied()
    }

    /// `reduced(ty)` for the same types, on the same condition.
    fn known_reduced_type(&self, ty: TypeId) -> Option<TypeId> {
        if !self.may_be_reduced(ty) || !self.is_intersection(ty) {
            return Some(ty);
        }
        let is_never = self.p.never_intersections.get(&self.task, &ty)?;
        Some(if is_never { TypeId::NEVER } else { ty })
    }

    /// The facts about the member `current` of a union, without `when_missing`. `None`: it is of a kind about which more
    /// has to be asked each time, or something about it is not final.
    fn facts_of_member(
        &self,
        current: TypeId,
        lookup: MemberLookup<'p>,
    ) -> Option<MemberFacts<'p>> {
        let PropertyHolder::Members(apparent, members) = lookup.holder else {
            return None;
        };
        // The kinds that `known_apparent_type` and `known_reduced_type` are for. The apparent type of any other is computed
        // each time: from a base constraint, by instantiating a mapped type, by resolving a global type.
        let is_covered = |ty: TypeId| {
            let data = self.data(ty);
            is_plain_object(data) || matches!(data, TypeData::Intersection(_))
        };
        if !lookup.is_holder_final || !is_covered(current) || self.is_deferred(current) {
            return None;
        }
        let t = self.known_apparent_type(current)?;
        // `is_apparent_type_of_intersection_never` makes the intersection once more.
        let is_made_again = matches!(self.data(t), TypeData::Intersection(parts)
            if parts.iter().any(|&part| self.intersection_member_has_other_apparent_type(part)));
        if !is_covered(t) || is_made_again || self.known_reduced_type(t)? != t {
            return None;
        }
        let apparent_type_of_reduced = self.known_apparent_type(t)?;
        if !is_covered(apparent_type_of_reduced)
            || self.known_reduced_type(apparent_type_of_reduced)? != apparent
        {
            return None;
        }
        // `is_type_only_member`: a property that is listed and not found.
        if matches!(
            self.data(apparent),
            TypeData::Anon {
                origin: Origin::Module(_) | Origin::Namespace { .. },
                ..
            }
        ) {
            return None;
        }
        // Members that are not stored are replaced later, and do not outlive the file.
        let stored = self.resolved_members(apparent)?;
        if !std::ptr::eq(stored.resolved, members.resolved)
            || stored.mapper != members.mapper
            || self.never_in_progress.contains(&t)
            || self.never_in_progress.contains(&apparent)
        {
            return None;
        }
        Some(MemberFacts {
            apparent_type: t,
            reduced_apparent_type: apparent,
            members,
            when_missing: WhenMissing::Unknown,
            asked_in_vain: 0,
            is_listed: false,
        })
    }

    /// `MemberFacts::when_missing` of a member with the given `reduced_apparent_type`, for which `missing_from_member` has
    /// just returned `missing` for an ordinary name. It is `missing` if that returns the same for every ordinary name, and
    /// computes nothing when it is asked again.
    fn when_missing(&self, apparent: TypeId, missing: Missing) -> WhenMissing {
        let object = match self.data(apparent) {
            TypeData::Intersection(_) => self.p.intersection_objects.get(&self.task, &apparent),
            _ => Some(apparent),
        };
        let Some(members) = object.and_then(|object| self.resolved_members(object)) else {
            return WhenMissing::Unknown;
        };
        let shape = members.shape();
        // `instantiate` counts its calls, and fails from a limit on.
        let is_unchanged = |ty: TypeId| {
            members.mapper == MapperId::IDENTITY
                || self.types().instantiation_class(ty) == InstantiationClass::Unchanged
        };
        let is_the_same_for_every_name = shape.properties_of.is_none()
            && !matches!(self.data(apparent), TypeData::Tuple { .. })
            && (shape.index.iter())
                .all(|info| info.key == TypeId::STRING && is_unchanged(info.value));
        match is_the_same_for_every_name {
            true => WhenMissing::Adds(missing),
            false => WhenMissing::DependsOnName,
        }
    }

    /// `visit_member` without facts. `None`: the member takes no part in the property.
    fn add_member(
        &mut self,
        walk: &Walk,
        builder: &mut UnionPropertyBuilder<'p, 's>,
        at: usize,
        current: TypeId,
    ) -> Option<MemberLookup<'p>> {
        let before = self.non_cacheable_mark();
        let t = self.apparent_type(current);
        // An intersection with a member whose apparent type is `never`, such as a conditional
        // type with that constraint, has the apparent type `never`.
        if self.is_error_type(t) || t.is_never() || self.is_apparent_type_of_intersection_never(t) {
            return None;
        }
        let holder = self.apparent_type_or_type_variable(current, t);
        let holder = self.property_holder(holder);
        let is_holder_final = self.non_cacheable_mark() == before;
        let missing = match self.property_of_holder(holder, walk.name, walk.skips) {
            Some((prop, mapper)) => {
                self.add_member_property(builder, at, t, prop, mapper);
                None
            }
            None => {
                let before = self.non_cacheable_mark();
                let missing = self.missing_from_member(t, walk.name, walk.is_late_bound);
                builder.add_missing(at, missing);
                Some((missing, self.non_cacheable_mark() == before))
            }
        };
        Some(MemberLookup {
            holder,
            is_holder_final,
            missing,
        })
    }

    /// The member at `at`, whose apparent type is `t`, has `prop`.
    fn add_member_property(
        &mut self,
        builder: &mut UnionPropertyBuilder<'p, 's>,
        at: usize,
        t: TypeId,
        prop: &'p Prop<'p>,
        mapper: MapperId,
    ) {
        let access = PropFlags::PRIVATE | PropFlags::PROTECTED;
        if !builder.insert_symbol((std::ptr::from_ref(prop), mapper)) {
            return;
        }
        let mut prop = prop.clone_in(self.arena);
        self.instantiate_prop(&mut prop, mapper);
        // `prop.Flags&SymbolFlagsClassMember`: a variable of a module or of `globalThis` is
        // not considered.
        if !matches!(prop.source, PropSource::Symbol(sym) if !self.is_member_symbol(sym)) {
            builder.flags |= prop.flags & PropFlags::OPTIONAL;
        }
        builder.flags |= prop.flags & (PropFlags::READONLY | access);
        builder.is_public |= !prop.flags.intersects(access);
        if builder.prop_set.is_empty() {
            builder.first_owner = t;
            builder.first_at = Some(at);
            builder.flags |= prop.flags & ACCESSOR_KIND;
            builder.prop_set.push(prop);
            return;
        }
        let single = &builder.prop_set[0];
        // `prop.Flags&SymbolFlagsAccessor`: a getter alone is read-only.
        let accessors = |p: &Prop| match p.flags.contains(PropFlags::ACCESSOR) {
            true => p.flags & (ACCESSOR_KIND | PropFlags::READONLY),
            false => PropFlags::empty(),
        };
        if accessors(&prop) != accessors(single) {
            builder.flags.remove(ACCESSOR_KIND);
        }
        // `isInstantiation`: instantiations of one property that
        // `compareProperties` finds equal are one property.
        let is_same = single.source == prop.source && self.compare_properties(single, &prop);
        if is_same {
            builder.merged_instantiations = matches!(single.source, PropSource::Symbol(symbol)
            if (self.files().parent_of_symbol(symbol)).is_some_and(|parent| {
                !self.local_type_params_of_symbol(parent).is_empty()
            }));
        } else if builder.is_new_prop(&prop) {
            builder.prop_set.push(prop);
        }
    }

    /// What a member whose apparent type is `t` adds to the property `name` of the union, which it does not have.
    fn missing_from_member(&mut self, t: TypeId, name: Atom, is_late_bound: bool) -> Missing {
        let index_info = match self.members_for_index_infos(t) {
            Some(members) if !is_late_bound => self.applicable_index_info_for_name(&members, name),
            _ => None,
        };
        if let Some(info) = index_info {
            Missing::IndexSignature {
                value: self.beyond_fixed_elements(t).unwrap_or(info.value),
                is_readonly: info.readonly,
            }
        } else if self.is_closed_object_literal_type(t) {
            Missing::ClosedObjectLiteral
        } else {
            Missing::ReadPartial
        }
    }

    /// `createUnionOrIntersectionProperty`, from the end of its first loop.
    fn finish_union_property(
        &mut self,
        builder: UnionPropertyBuilder<'p, 's>,
        containing_type: TypeId,
        name: Atom,
    ) -> Option<Prop<'s>> {
        let UnionPropertyBuilder {
            mut prop_set,
            index_types,
            merged_instantiations,
            mut flags,
            is_public,
            first_owner,
            ..
        } = builder;
        let access = PropFlags::PRIVATE | PropFlags::PROTECTED;
        let is_partial = flags.intersects(PropFlags::READ_PARTIAL | PropFlags::WRITE_PARTIAL);
        // "No property was found, or, in a union, a property has a private or protected declaration in one constituent, but is missing
        // or has a different declaration in another constituent."
        if prop_set.is_empty()
            || (prop_set.len() > 1 || is_partial)
                && flags.intersects(access)
                && !(prop_set.len() > 1 && Self::has_common_declaration(&prop_set, self.arena))
        {
            return None;
        }
        if prop_set.len() == 1 && !is_partial {
            // The property of the only member that has one is that of the union. That of an
            // intersection gets its two flags here: see `non_uniform_and_literal`.
            let mut single = prop_set.pop()?;
            if let PropSource::Intersected(of, props) = &single.source
                && self.is_intersection(*of)
            {
                single.flags |= self.non_uniform_and_literal(props);
            }
            // `links.writeType` of the clone of `singleProp`.
            if merged_instantiations {
                self.write_type_of_prop(&single, MapperId::IDENTITY);
            }
            return Some(single);
        }
        for prop in &prop_set {
            self.type_and_write_type_of_prop(prop);
        }
        flags |= self.non_uniform_and_literal(&prop_set);
        // `links.nameType`
        if self.is_numeric_name(name)
            && self
                .key_type_of_props(first_owner, &prop_set)
                .is_some_and(|key| self.is_string_like(key))
        {
            flags |= PropFlags::STRING_NAME;
        }
        // `getDeclarationModifierFlagsFromSymbol`: private if one is, else public if one is, else protected.
        if flags.contains(PropFlags::PRIVATE) || is_public {
            flags.remove(PropFlags::PROTECTED);
        }
        prop_set.extend(index_types.iter().map(|&(_, t)| Prop {
            name,
            flags: PropFlags::WRITE_PARTIAL,
            source: PropSource::Type(t),
            mapper: MapperId::IDENTITY,
            name_type: TypeId::UNRESOLVED,
        }));
        let mut result = Prop {
            name,
            flags,
            source: PropSource::Intersected(containing_type, self.list_of(prop_set)),
            mapper: MapperId::IDENTITY,
            name_type: TypeId::UNRESOLVED,
        };
        self.set_modifiers_of_value_declaration(&mut result);
        Some(result)
    }

    /// `compareProperties(sourceProp, targetProp, compareTypesEqual)`
    fn compare_properties(&mut self, source: &Prop<'s>, target: &Prop<'s>) -> bool {
        if source == target {
            return true;
        }
        let access = PropFlags::PRIVATE | PropFlags::PROTECTED;
        let accessibility = source.flags & access;
        if accessibility != target.flags & access {
            return false;
        }
        if !accessibility.is_empty() {
            // `getTargetSymbol`
            if source.source != target.source {
                return false;
            }
        } else if (source.flags ^ target.flags).contains(PropFlags::OPTIONAL) {
            return false;
        }
        if self.is_readonly_symbol(source) != self.is_readonly_symbol(target) {
            return false;
        }
        // `getNonMissingTypeOfSymbol`
        let [source, target] = [source, target].map(|prop| {
            let ty = self.type_of_prop(prop, MapperId::IDENTITY);
            self.remove_missing_type(ty, prop.flags.contains(PropFlags::OPTIONAL))
        });
        source == target
    }

    /// `hasCommonDeclaration`
    fn has_common_declaration(props: &[Prop], arena: &'s Arena) -> bool {
        let mut common = Self::declared_properties(&[&props[0]], arena);
        for prop in &props[1..] {
            let other = Self::declared_properties(&[prop], arena);
            common.retain(|declared| other.iter().any(|it| it.source == declared.source));
        }
        !common.is_empty()
    }
}
