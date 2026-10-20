//! Properties of union types: the `isUnion` half of `createUnionOrIntersectionProperty`. `build_intersection_shape` is
//! the intersection half.
//!
//! `createUnionOrIntersectionProperty` looks the name up in every member of the union. In a union of a hundred object
//! types, most names exist in only a few members. For each of the other members it still computes which type to search,
//! misses the lookup, and then searches for an applicable index signature. Three caches avoid most of that work. Each
//! one is filled only after enough lookups to pay for it:
//! - `MemberFacts`: everything about a member that doesn't depend on the name, provided the name is ordinary
//!   (`is_ordinary_name`). With facts, a member that doesn't have the property costs little more than one lookup.
//! - `UnionMembers::holders`: maps a name to the members that have a property with that name.
//! - `UnionSummary`: the combined contribution of a long union's members to a property they don't have. Together with
//!   the name's holders, it determines which members to visit. The rest are skipped entirely.
//!
//! The first two are keyed by member rather than by union, because narrowing or filtering a union creates another union
//! of the same members. The third is a few bits per member of the union.
//!
//! `getTypeOfPropertyOfContextualType` also looks a name up in every member of a union. It reads these caches
//! (`members_to_ask_as_context`) but never fills them.
//!
//! A lookup in a member can resolve types, report errors and hit cycles, so the caches must not change what is resolved
//! or in which order:
//! - Facts are a by-product of a full lookup. Nothing is resolved just to compute them.
//! - Facts only contain final data: the type's own flags, and entries already stored in a table or a memo. Reading
//!   those again computes nothing, so skipping the read isn't observable.
//! - A member that needs more than that never gets facts. It gets a full lookup every time.
//! - Members are always visited in union order.

use super::shape::{LONG_PROP_LIST, MemberCount, PropertyHolder, is_plain_object};
use super::shortcuts::{TypeNumbers, task_fact};
use super::*;
use crate::util::{FxHashSet, PositionSet};
use smallvec::SmallVec;

/// Shorter unions don't use `MemberFacts`. Most unions are short, and there's little to save in them.
const MIN_MEMBERS_FOR_FACTS: usize = 8;

/// Length of `UnionMembers::recent`. Only a few unions have more members than this, and `task_fact::IS_WALKED_UNION`
/// covers those.
const RECENT_UNION_MEMBERS: usize = 512;

/// Shorter unions don't get a `UnionSummary`. Walking their members with facts costs no more than the rest of building
/// the property, so a summary would save little.
const MIN_MEMBERS_FOR_SUMMARY: usize = 128;

/// A name with more holders than this is looked up in every member instead. `holders` lists members of all unions, so
/// each holder has to be searched for among this union's members. That search costs about 2 instructions per member.
/// Visiting a member that has facts but not the property costs about 50.
const MOST_HOLDERS_TO_FIND: usize = 16;

/// Flags that, together with `READONLY`, record which accessors a property has.
const ACCESSOR_KIND: PropFlags = PropFlags::ACCESSOR.union(PropFlags::WRITE_ONLY);

/// A member's contribution to a union property that the member doesn't have.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Missing {
    /// `getApplicableIndexInfoForName` found an index signature. `value` is its type, or for a tuple, the type of the
    /// elements after the fixed ones.
    IndexSignature { value: TypeId, is_readonly: bool },
    /// The member is the type of an object literal without spreads, so it can't have other properties. It contributes
    /// `undefined`.
    ClosedObjectLiteral,
    /// `CheckFlagsReadPartial`
    ReadPartial,
}

/// A member's `Missing` value for any ordinary name it doesn't have.
#[derive(Copy, Clone)]
enum WhenMissing {
    /// Not computed yet. Computing it needs the member's index signatures, and resolving an intersection's index
    /// signatures compares its constituents' signatures. That work is deferred until a lookup misses.
    Unknown,
    /// The member is a tuple, has an index signature whose key type isn't `string`, or has one whose type is
    /// instantiated on every read.
    DependsOnName,
    Adds(Missing),
}

/// Everything the first loop of `createUnionOrIntersectionProperty` computes about a union member before it uses the
/// name. Every property of the member that has an ordinary name is in `members`.
#[derive(Copy, Clone)]
struct MemberFacts<'p> {
    /// `getApparentType` of the member.
    apparent_type: TypeId,
    /// `getReducedApparentType(apparent_type)`. `members` are this type's members.
    reduced_apparent_type: TypeId,
    members: Members<'p>,
    when_missing: WhenMissing,
    /// Number of misses answered from `WhenMissing::Adds` in unions long enough for a summary. Stops counting once
    /// `is_listed` is set.
    asked_in_vain: u32,
    /// True if the member is in `UnionMembers::holders` under each of its property names. Implies that `when_missing`
    /// is `Adds`.
    is_listed: bool,
}

/// Per-union data that, together with a name's holders, is enough to build a long union's property with that name.
struct UnionSummary {
    /// Members that weren't listed when the summary was built.
    always_visited: PositionSet,
    /// Each distinct `Missing` value among the listed members, with the members that contribute it.
    missing: SmallVec<[(Missing, PositionSet); 2]>,
    /// `always_visited`, plus the listed members that fail `has_only_its_properties`.
    always_asked_as_context: PositionSet,
}

/// Type ids can be task-local, so none of this is shared between tasks.
#[derive(Default)]
pub(super) struct UnionMembers<'p> {
    facts: Vec<MemberFacts<'p>>,
    /// Maps a member to 1 + the index of its facts in `facts`, or to 0 if it doesn't have facts.
    facts_of: TypeNumbers,
    /// Recently visited members without facts, each stored at its id modulo the length. A member that is found here on
    /// its next visit gets facts even if its union is being walked for the first time. Narrowing one union in many ways
    /// creates many unions that are each walked only once.
    recent: Vec<TypeId>,
    /// Maps a name to the `is_listed` members that have a property with that name.
    holders: FxHashMap<Atom, SmallVec<[TypeId; 4]>>,
    summaries: FxHashMap<TypeId, UnionSummary>,
    /// True while a caller looks up every name that a union's members have. See `property_holder_of_member`.
    is_listing: bool,
}

impl<'p> UnionMembers<'p> {
    /// Sets `is_listing` and returns the previous value.
    pub(super) fn set_listing(&mut self, is_listing: bool) -> bool {
        std::mem::replace(&mut self.is_listing, is_listing)
    }

    #[inline]
    fn facts(&self, member: TypeId) -> Option<&MemberFacts<'p>> {
        let at = (self.facts_of.get(member) as usize).checked_sub(1)?;
        self.facts.get(at)
    }

    fn facts_mut(&mut self, member: TypeId) -> Option<&mut MemberFacts<'p>> {
        let at = (self.facts_of.get(member) as usize).checked_sub(1)?;
        self.facts.get_mut(at)
    }

    fn keep_facts(&mut self, member: TypeId, facts: MemberFacts<'p>) {
        if let Some(kept) = self.facts_mut(member) {
            *kept = facts;
            return;
        }
        self.facts.push(facts);
        self.facts_of.set(member, self.facts.len() as u32);
    }
}

/// Result of `add_member`.
#[derive(Copy, Clone)]
struct MemberLookup<'p> {
    holder: PropertyHolder<'p>,
    /// True if `non_cacheable_mark` didn't change while `holder` was computed, so `holder` is safe to cache.
    is_holder_final: bool,
    /// `Some` if the member doesn't have the property. The pair is the member's contribution and a flag that is true if
    /// the contribution is safe to cache too.
    missing: Option<(Missing, bool)>,
}

/// State shared by every member visit while one union property is built.
struct Walk {
    name: Atom,
    /// `skipObjectFunctionPropertyAugment`
    skips: bool,
    is_late_bound: bool,
    uses_facts: bool,
    /// True if every member of the union has been visited before with `uses_facts` set.
    is_walked_again: bool,
    /// True if the union is long enough for a summary.
    is_long: bool,
    /// Memo for `Checker::is_ordinary_name`, filled on first use.
    is_ordinary_name: Option<bool>,
    /// True once the name's literal type has been created.
    has_literal_type: bool,
    /// Number of visited members that a summary would put in `UnionSummary::always_visited`.
    always_visited: usize,
}

/// Accumulates the results of the first loop of `createUnionOrIntersectionProperty` for a union.
struct UnionPropertyBuilder<'p, 's> {
    /// The first entry is `singleProp`.
    prop_set: SmallVec<[Prop<'s>; 4]>,
    /// `Prop::fx_hash_without_lists` of every entry in `prop_set`. Empty until `prop_set` reaches `LONG_PROP_LIST`.
    prop_hashes: FxHashSet<u64>,
    /// Symbols seen in earlier members. Mirrors `prop != singleProp` and `propSet.Add(prop)`, so a symbol that many
    /// members inherit is processed only once.
    symbols: SmallVec<[(*const Prop<'p>, MapperId); LONG_PROP_LIST]>,
    /// Everything in `symbols`, plus the symbols added after it filled up.
    more_symbols: FxHashSet<(*const Prop<'p>, MapperId)>,
    /// `indexTypes`. Each type is paired with the position of the first member that contributes it, and the list is
    /// sorted by that position.
    index_types: SmallVec<[(usize, TypeId); 4]>,
    merged_instantiations: bool,
    flags: PropFlags,
    is_public: bool,
    /// Apparent type of the member that has `singleProp`.
    first_owner: TypeId,
    /// Position of that member in the union.
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

    /// Returns false if an earlier member already had the symbol.
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

    /// True if `prop` isn't in `prop_set` yet. The caller must then push it.
    fn is_new_prop(&mut self, prop: &Prop<'s>) -> bool {
        if self.prop_set.len() < LONG_PROP_LIST {
            return !self.prop_set.contains(prop);
        }
        if self.prop_hashes.is_empty() {
            let hashes = self.prop_set.iter().map(Prop::fx_hash_without_lists);
            self.prop_hashes.extend(hashes);
        }
        // An unseen hash proves that the property is new. On a hash hit, search the list.
        self.prop_hashes.insert(prop.fx_hash_without_lists()) || !self.prop_set.contains(prop)
    }

    /// Records that the member at `at` doesn't have the property. Members can be added out of order once `first_at` is
    /// final.
    fn add_missing(&mut self, at: usize, missing: Missing) {
        match missing {
            Missing::IndexSignature { value, is_readonly } => {
                // Only `singleProp` sets these flags, so a member before it has nothing to clear.
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

    /// `indexTypes` is only passed to `getUnionType`, so duplicates are dropped. Properties are compared by value, so
    /// the order must not depend on how many members were visited.
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

    /// `skips` is `skipObjectFunctionPropertyAugment`, and `union_properties` is `propertyCache`. There's no
    /// `propertyCacheWithoutFunctionPropertyAugment` because only importing a name from a module with `export =` looks
    /// up a union property that way.
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

    /// Returns `CheckFlagsHasNonUniformType` and `CheckFlagsHasLiteralType` for the property that
    /// `createUnionOrIntersectionProperty` builds from `props`. A union property stores them in its flags. An
    /// intersection property doesn't, because its type is resolved lazily.
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
                || !t.is_never() && self.is_every_type_unit(t)
                || self.is_pattern_literal(t)
            {
                flags |= PropFlags::HAS_LITERAL_TYPE;
            }
        }
        flags
    }

    /// The `isUnion` half of `createUnionOrIntersectionProperty`.
    fn create_union_property(
        &mut self,
        containing_type: TypeId,
        name: Atom,
        skip_object_function_property_augment: bool,
    ) -> Option<Prop<'s>> {
        let skips = skip_object_function_property_augment;
        let parts = self.parts(containing_type);
        self.tally(MemberCount::UnionPropertiesCreated, 1);
        let uses_facts =
            parts.len() >= MIN_MEMBERS_FOR_FACTS && !skips && self.do_member_facts_hold();
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
        walk.is_walked_again =
            uses_facts && !(self.task_facts).add(containing_type, task_fact::IS_WALKED_UNION);
        for (at, &current) in parts.iter().enumerate() {
            self.visit_member(&mut walk, &mut builder, at, current);
        }
        // A summary saves little if more than 1/8 of the members have to be visited for every name.
        if walk.is_walked_again
            && walk.is_long
            && walk.always_visited * 8 <= parts.len()
            && !(self.union_members.summaries).contains_key(&containing_type)
        {
            self.summarize_union(containing_type);
        }
        self.finish_union_property(builder, containing_type, name)
    }

    /// True if a full lookup would match the cached facts, given the computations currently in progress.
    fn do_member_facts_hold(&self) -> bool {
        // Looking a name up in an intersection that is being reduced creates its properties a second time. See
        // `reduce_apparent_type_of_intersection_in_progress`.
        let mut being_reduced = self.never_in_progress.iter();
        // While `unresolved_members` is non-empty, `members` omits a type reference's inherited members.
        self.unresolved_members.is_empty()
            && !being_reduced.any(|&ty| self.task_facts.has(ty, task_fact::IS_IN_MEMBER_FACTS))
    }

    /// True if a member's `Missing` value for this name can be reused for other names. Object types must never inherit
    /// the name from `Object` or `Function`, and the name must not be late-bound or numeric, because then an index
    /// signature's key type decides if the signature applies.
    fn is_ordinary_name(&self, walk: &mut Walk) -> bool {
        let (name, is_late_bound) = (walk.name, walk.is_late_bound);
        *walk
            .is_ordinary_name
            .get_or_insert_with(|| self.is_ordinary(name, is_late_bound))
    }

    /// `is_late_bound` must be `Atoms::is_symbol_name(name)`.
    fn is_ordinary(&self, name: Atom, is_late_bound: bool) -> bool {
        name.is_some()
            && !is_late_bound
            && !self.is_numeric_name(name)
            && self.is_never_inherited(name)
    }

    /// True if a lookup in the member `current`, whose facts are `facts`, can only find the properties in
    /// `facts.members`. The member must be an object type, which is its own apparent type, without index signatures.
    fn has_only_its_properties(&self, current: TypeId, facts: &MemberFacts<'p>) -> bool {
        let shape = facts.members.shape();
        self.flags(current) & tf::OBJECT != 0
            && facts.apparent_type == current
            && facts.reduced_apparent_type == current
            && shape.properties_of().is_none()
            && shape.index.is_empty()
    }

    /// For `getTypeOfPropertyOfContextualType`. Returns the members of `union` to search for the property `name`, or
    /// `None` to search all of them.
    ///
    /// A skipped member passes `has_only_its_properties`, and `name`, which is ordinary, isn't one of those properties.
    /// So the member doesn't have the property, doesn't inherit it, and doesn't have an applicable index signature.
    /// Checking that only reads the member's stored members and resolves nothing, so skipping the member isn't
    /// observable.
    pub(super) fn members_to_ask_as_context(
        &self,
        union: TypeId,
        name: Atom,
    ) -> Option<PositionSet> {
        let parts = self.parts(union);
        // Members only get facts while a union property is built. If that never happened for this union, looking up
        // each member's facts isn't worth it.
        if parts.len() < MIN_MEMBERS_FOR_FACTS
            || !self.task_facts.has(union, task_fact::IS_WALKED_UNION)
            || !self.do_member_facts_hold()
            || !self.is_ordinary(name, self.atoms().is_symbol_name(name))
        {
            return None;
        }
        if parts.len() >= MIN_MEMBERS_FOR_SUMMARY
            && let Some(summary) = self.union_members.summaries.get(&union)
            && let holders = self.union_members.holders.get(&name)
            && let holders = holders.map_or(&[][..], |holders| &holders[..])
            && holders.len() <= MOST_HOLDERS_TO_FIND
        {
            let mut asked = summary.always_asked_as_context.clone();
            for holder in holders {
                if let Some(at) = parts.iter().position(|member| member == holder) {
                    asked.insert(at);
                }
            }
            return Some(asked);
        }
        let mut asked = PositionSet::new(parts.len());
        for (at, member) in parts.iter().enumerate() {
            let lacks_it = self.union_members.facts(*member).is_some_and(|facts| {
                self.has_only_its_properties(*member, facts)
                    && facts.members.resolved.prop_past_filter(name).is_none()
            });
            if !lacks_it {
                asked.insert(at);
            }
        }
        Some(asked)
    }

    /// Returns the members of `union` to visit for the property, based on the union's summary and the name's holders,
    /// or `None` to visit all of them.
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

    /// The first loop of `createUnionOrIntersectionProperty` for a `union` that has a summary. `visited` is the result
    /// of `members_to_visit`.
    fn visit_some_members(
        &mut self,
        union: TypeId,
        visited: &PositionSet,
        walk: &mut Walk,
        builder: &mut UnionPropertyBuilder<'p, 's>,
    ) {
        let parts = self.parts(union);
        // `getApplicableIndexInfoForName` creates the name's literal type for the first member that has an index
        // signature but not the property. If that member is skipped, the type is still created at the same point in the
        // walk.
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
            // The first member determines the index type's position. The last member determines whether a member after
            // `singleProp` contributes it.
            let ends = [members.first_except(visited), members.last_except(visited)];
            for at in ends.into_iter().flatten() {
                builder.add_missing(at, *missing);
            }
        }
    }

    /// One iteration of the first loop of `createUnionOrIntersectionProperty`, for the member `current` at position
    /// `at`.
    fn visit_member(
        &mut self,
        walk: &mut Walk,
        builder: &mut UnionPropertyBuilder<'p, 's>,
        at: usize,
        current: TypeId,
    ) {
        self.tally(MemberCount::MembersVisited, 1);
        // Only object types and intersections can have facts.
        let may_have_facts =
            walk.uses_facts && self.flags(current) & (tf::OBJECT | tf::INTERSECTION) != 0;
        let facts = match may_have_facts {
            true => self.union_members.facts(current).copied(),
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
            let symbol = self.identity_of_own_property(facts.reduced_apparent_type, prop);
            self.add_member_property(builder, at, t, (symbol, prop), members.mapper);
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
                // Only a union with a summary reads `holders`.
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
                    if let Some(facts) = self.union_members.facts_mut(current) {
                        facts.when_missing = when_missing;
                    }
                }
                missing
            }
        };
        builder.add_missing(at, missing);
    }

    /// True if `current` was already in `UnionMembers::recent`. Inserts it either way.
    fn is_visited_again(&mut self, current: TypeId) -> bool {
        let recent = &mut self.union_members.recent;
        if recent.is_empty() {
            recent.resize(RECENT_UNION_MEMBERS, TypeId::NEVER);
        }
        let place = &mut recent[current.0 as usize % RECENT_UNION_MEMBERS];
        std::mem::replace(place, current) == current
    }

    /// `lookup` must be the value that `add_member` just returned for `current`.
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
                self.task_facts.add(ty, task_fact::IS_IN_MEMBER_FACTS);
            }
        }
        self.union_members.keep_facts(current, facts);
    }

    /// Called when a lookup misses in the member `current`, which has facts but isn't listed. The member is listed once
    /// that has happened a quarter as many times as it has properties. Listing costs about 60 instructions per property
    /// and the facts saved about 250 per miss, so the savings have already paid for it.
    fn count_asked_in_vain(&mut self, current: TypeId) {
        let UnionMembers {
            facts,
            facts_of,
            holders,
            ..
        } = &mut self.union_members;
        let at = (facts_of.get(current) as usize).wrapping_sub(1);
        let Some(facts) = facts.get_mut(at) else {
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
            always_asked_as_context: PositionSet::new(parts.len()),
        };
        for (at, current) in parts.iter().enumerate() {
            let Some(
                facts @ &MemberFacts {
                    when_missing: WhenMissing::Adds(missing),
                    is_listed: true,
                    ..
                },
            ) = self.union_members.facts(*current)
            else {
                summary.always_visited.insert(at);
                summary.always_asked_as_context.insert(at);
                continue;
            };
            if !self.has_only_its_properties(*current, facts) {
                summary.always_asked_as_context.insert(at);
            }
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

    /// Returns `apparent_type(ty)` for an intersection or a non-mapped object type, if the answer is already in the
    /// type's flags or in a memo, so that reading it computes nothing.
    fn known_apparent_type(&self, ty: TypeId) -> Option<TypeId> {
        if !self.is_intersection(ty) || self.has_only_own_apparent_types(ty) {
            return Some(ty);
        }
        self.apparent_types_of_intersections.get(ty)
    }

    /// Returns `reduced(ty)` for the same kinds of types, under the same condition.
    fn known_reduced_type(&self, ty: TypeId) -> Option<TypeId> {
        if !self.may_be_reduced(ty) || !self.is_intersection(ty) {
            return Some(ty);
        }
        let is_never = self.p.never_intersections.get(&self.task, &ty)?;
        Some(if is_never { TypeId::NEVER } else { ty })
    }

    /// Returns the facts for the union member `current`, with `when_missing` still `Unknown`. Returns `None` if this
    /// kind of type needs more work on every lookup, or if some of its data isn't final.
    fn facts_of_member(
        &self,
        current: TypeId,
        lookup: MemberLookup<'p>,
    ) -> Option<MemberFacts<'p>> {
        let PropertyHolder::Members(apparent, members) = lookup.holder else {
            return None;
        };
        // The kinds that `known_apparent_type` and `known_reduced_type` support. Any other kind's apparent type is
        // recomputed every time, from a base constraint, by instantiating a mapped type, or by resolving a global type.
        let is_covered = |ty: TypeId| {
            let data = self.data(ty);
            is_plain_object(data) || matches!(data, TypeData::Intersection(_))
        };
        if !lookup.is_holder_final || !is_covered(current) || self.is_deferred(current) {
            return None;
        }
        let t = self.known_apparent_type(current)?;
        // `is_apparent_type_of_intersection_never` rebuilds this kind of intersection on every call.
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
        // `is_type_only_member`: a module's object type can list a property that a lookup must not find.
        if matches!(
            self.data(apparent),
            TypeData::Anon {
                origin: Origin::Module(_) | Origin::Namespace { .. },
                ..
            }
        ) {
            return None;
        }
        // Members that aren't stored are replaced later and don't outlive the file.
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

    /// Returns `MemberFacts::when_missing` for a member whose `reduced_apparent_type` is `apparent`. `missing` is the
    /// value that `missing_from_member` just returned for an ordinary name. The result is `Adds(missing)` if
    /// `missing_from_member` would return that value for every ordinary name without computing anything.
    fn when_missing(&self, apparent: TypeId, missing: Missing) -> WhenMissing {
        let object = match self.data(apparent) {
            TypeData::Intersection(_) => self.p.intersection_objects.get(&self.task, &apparent),
            _ => Some(apparent),
        };
        let Some(members) = object.and_then(|object| self.resolved_members(object)) else {
            return WhenMissing::Unknown;
        };
        let shape = members.shape();
        // `instantiate` counts its calls and fails past a limit, so skipping a call is observable.
        let is_unchanged = |ty: TypeId| {
            members.mapper == MapperId::IDENTITY
                || self.types().instantiation_class(ty) == InstantiationClass::Unchanged
        };
        let is_the_same_for_every_name = shape.properties_of().is_none()
            && !matches!(self.data(apparent), TypeData::Tuple { .. })
            && (shape.index.iter())
                .all(|info| info.key == TypeId::STRING && is_unchanged(info.value));
        match is_the_same_for_every_name {
            true => WhenMissing::Adds(missing),
            false => WhenMissing::DependsOnName,
        }
    }

    /// The slow path of `visit_member`, which doesn't use facts. Returns `None` if the member doesn't contribute to the
    /// property.
    fn add_member(
        &mut self,
        walk: &Walk,
        builder: &mut UnionPropertyBuilder<'p, 's>,
        at: usize,
        current: TypeId,
    ) -> Option<MemberLookup<'p>> {
        self.tally(MemberCount::MembersVisitedWithoutFacts, 1);
        let before = self.non_cacheable_mark();
        let t = self.apparent_type(current);
        // An intersection's apparent type is `never` if a member's apparent type is `never`, e.g. a conditional type
        // with that constraint.
        if self.is_error_type(t) || t.is_never() || self.is_apparent_type_of_intersection_never(t) {
            return None;
        }
        let holder = self.apparent_type_or_type_variable(current, t);
        let holder = self.property_holder_of_member(holder, self.union_members.is_listing);
        let is_holder_final = self.non_cacheable_mark() == before;
        let missing = match self.property_of_holder(holder, walk.name, walk.skips) {
            Some((prop, mapper)) => {
                let symbol = self.identity_of_found_property(holder, prop);
                self.add_member_property(builder, at, t, (symbol, prop), mapper);
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

    /// Records that the member at `at`, whose apparent type is `t`, has `prop`. `symbol` is the result of
    /// `identity_of_own_property`.
    fn add_member_property(
        &mut self,
        builder: &mut UnionPropertyBuilder<'p, 's>,
        at: usize,
        t: TypeId,
        (symbol, prop): (*const Prop<'p>, &'p Prop<'p>),
        mapper: MapperId,
    ) {
        let access = PropFlags::PRIVATE | PropFlags::PROTECTED;
        if !builder.insert_symbol((symbol, mapper)) {
            return;
        }
        let mut prop = prop.clone_in(self.arena);
        self.instantiate_prop(&mut prop, mapper);
        // `prop.Flags&SymbolFlagsClassMember`: variables of a module or of `globalThis` are ignored.
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
        // `prop.Flags&SymbolFlagsAccessor`: a property with only a getter is read-only.
        let accessors = |p: &Prop| match p.flags.contains(PropFlags::ACCESSOR) {
            true => p.flags & (ACCESSOR_KIND | PropFlags::READONLY),
            false => PropFlags::empty(),
        };
        if accessors(&prop) != accessors(single) {
            builder.flags.remove(ACCESSOR_KIND);
        }
        // `isInstantiation`: instantiations of the same property that `compareProperties` considers equal count as one
        // property.
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

    /// Returns the contribution of a member with apparent type `t` to the union's property `name`, which the member
    /// doesn't have.
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

    /// The rest of `createUnionOrIntersectionProperty`, after its first loop.
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
            // There's only one distinct property, so the union reuses it. An intersection property gets its two flags
            // here. See `non_uniform_and_literal`.
            let mut single = prop_set.pop()?;
            if let PropSource::Intersected(of, props) = &single.source
                && self.is_intersection(*of)
            {
                single.flags |= self.non_uniform_and_literal(props);
            }
            // `links.writeType` of `singleProp`'s clone.
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
        // `getDeclarationModifierFlagsFromSymbol`: private if any is private, else public if any is public, else
        // protected.
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
