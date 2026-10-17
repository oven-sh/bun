//! The properties of a union type: `createUnionOrIntersectionProperty` where `isUnion`. `build_intersection_shape` has the
//! other half.
//!
//! `createUnionOrIntersectionProperty` asks every member of the union for the name. In a union of a hundred object types most
//! names are in a few members. For all the others it looks the name up in vain, and then looks for an index signature that
//! applies, which for an ordinary name is the same one every time. So a union with many members gets a `UnionIndex`: which
//! members have each name, and what the others add to the property.
//!
//! Looking a name up in a member can resolve types, report errors and close cycles, so the index must not change what is
//! resolved, nor in which order:
//! - It is a by-product of the first property that is made of the union, member by member. Nothing is resolved for its sake.
//! - It holds only what is final: what a type says about itself, and what a table or a memo has stored. Asking for that again
//!   computes nothing, so not asking is not observable.
//! - A member about which more than that is needed is not indexed. It is asked each time, as in a union without an index.
//! - The members that are visited for a property are visited in the order of the union.

use super::shape::{LONG_PROP_LIST, PropertyHolder, is_plain_object};
use super::*;
use crate::util::{FxHashSet, PositionSet};
use smallvec::SmallVec;

/// A union with fewer members has no index.
const MIN_INDEXED_MEMBERS: usize = 8;

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

/// A member of a union that has an index.
#[derive(Copy, Clone)]
enum UnionMember<'p> {
    /// Its apparent type is an error type or `never`, so it takes no part in any property.
    Skipped,
    /// It has the properties in `members`, which the index lists, and no other that has an ordinary name.
    Indexed {
        /// `getApparentType` of the member.
        apparent_type: TypeId,
        /// `getReducedApparentType` of that, which `members` are the members of.
        reduced_apparent_type: TypeId,
        members: Members<'p>,
    },
    /// It is asked for every name.
    NotIndexed,
}

struct UnionIndex<'p> {
    /// In the order of the union.
    members: Vec<UnionMember<'p>>,
    /// For each name, the `Indexed` members that have it.
    members_with_name: FxHashMap<Atom, PositionSet>,
    /// The members that are `NotIndexed`.
    not_indexed: PositionSet,
    /// The `Indexed` members that have had every name asked for so far. What a member adds where it does not have the name
    /// is found out the first time that happens, not when the index is made: it takes the member's index signatures, and
    /// resolving those of an intersection compares the signatures of its constituents.
    missing_unknown: PositionSet,
    /// The `Indexed` members in which that depends on the name. They are asked each time.
    missing_depends_on_name: PositionSet,
    /// What the other `Indexed` members add, and which of them add it.
    missing: SmallVec<[(Missing, PositionSet); 4]>,
}

impl<'p> UnionIndex<'p> {
    fn new(members: Vec<UnionMember<'p>>) -> UnionIndex<'p> {
        let count = members.len();
        let mut index = UnionIndex {
            members,
            members_with_name: FxHashMap::default(),
            not_indexed: PositionSet::new(count),
            missing_unknown: PositionSet::new(count),
            missing_depends_on_name: PositionSet::new(count),
            missing: SmallVec::new(),
        };
        for (at, member) in index.members.iter().enumerate() {
            match member {
                UnionMember::Skipped => {}
                UnionMember::NotIndexed => index.not_indexed.insert(at),
                UnionMember::Indexed { members, .. } => {
                    index.missing_unknown.insert(at);
                    for prop in &members.shape().props {
                        let with_name = index.members_with_name.entry(prop.name);
                        with_name
                            .or_insert_with(|| PositionSet::new(count))
                            .insert(at);
                    }
                }
            }
        }
        index
    }

    /// The `Indexed` members that have `name`.
    fn members_with(&self, name: Atom) -> PositionSet {
        match self.members_with_name.get(&name) {
            Some(members) => members.clone(),
            None => PositionSet::new(self.members.len()),
        }
    }

    /// Whether `ty` is the apparent type or the reduced apparent type of an `Indexed` member.
    fn has_apparent_type(&self, ty: TypeId) -> bool {
        self.members.iter().any(|member| {
            matches!(*member, UnionMember::Indexed { apparent_type, reduced_apparent_type, .. }
                if apparent_type == ty || reduced_apparent_type == ty)
        })
    }

    /// Keeps what the member at `at` adds where it does not have the name. `None`: it depends on the name.
    fn record_missing(&mut self, at: usize, missing: Option<Missing>) {
        // While that was found out, another property of the union may have been made, and have recorded it.
        if !self.missing_unknown.contains(at) {
            return;
        }
        self.missing_unknown.remove(at);
        let Some(missing) = missing else {
            self.missing_depends_on_name.insert(at);
            return;
        };
        match self.missing.iter_mut().find(|it| it.0 == missing) {
            Some((_, members)) => members.insert(at),
            None => {
                let mut members = PositionSet::new(self.members.len());
                members.insert(at);
                self.missing.push((missing, members));
            }
        }
    }
}

/// The indexes that a task has made. A type id can be the task's own, so they are not shared with other tasks.
#[derive(Default)]
pub(super) struct UnionIndexes<'p> {
    /// The position in `all`. `None`: no member of the union can be indexed.
    by_union: FxHashMap<TypeId, Option<u32>>,
    all: Vec<UnionIndex<'p>>,
}

/// What `add_member` has found out about a member before it used the name.
#[derive(Copy, Clone)]
struct MemberLookup<'p> {
    /// Nothing on the way made the computation in progress invalid for the next caller.
    is_final: bool,
    /// `None`: the member is skipped.
    holder: Option<PropertyHolder<'p>>,
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
    /// be the same with an index and without.
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
        match self.usable_union_index(containing_type, name, skips) {
            Some(index) => self.create_union_property_from_index(index, containing_type, name),
            None => self.create_union_property_from_members(containing_type, name, skips),
        }
    }

    /// `create_union_property` without an index: every member is asked. What that finds out about the members becomes the
    /// index of the union, if it has none and is to have one.
    fn create_union_property_from_members(
        &mut self,
        containing_type: TypeId,
        name: Atom,
        skips: bool,
    ) -> Option<Prop<'s>> {
        let parts = self.parts(containing_type);
        let is_late_bound = self.atoms().is_symbol_name(name);
        let mut is_indexing = parts.len() >= MIN_INDEXED_MEMBERS
            && !(self.union_indexes.by_union).contains_key(&containing_type);
        let mut members = Vec::with_capacity(if is_indexing { parts.len() } else { 0 });
        let mut builder = UnionPropertyBuilder::new(containing_type);
        for (at, &current) in parts.iter().enumerate() {
            let lookup = self.add_member(&mut builder, at, current, name, skips, is_late_bound);
            if is_indexing {
                match self.member_for_index(current, lookup) {
                    Some(member) => members.push(member),
                    None => is_indexing = false,
                }
            }
        }
        if is_indexing {
            self.store_union_index(containing_type, members);
        }
        self.finish_union_property(builder, containing_type, name)
    }

    /// The position in `union_indexes.all` of the index to make the property `name` of `union` from. `None`: there is
    /// none, or it does not have the answer for this name, or not in the state that the checker is in.
    fn usable_union_index(&self, union: TypeId, name: Atom, skips: bool) -> Option<usize> {
        if self.parts(union).len() < MIN_INDEXED_MEMBERS {
            return None;
        }
        let index = (*self.union_indexes.by_union.get(&union)?)? as usize;
        // Whether an index signature applies to a late-bound or a numeric name depends on its key type.
        let is_ordinary_name =
            name.is_some() && !self.atoms().is_symbol_name(name) && !self.is_numeric_name(name);
        // Looking a name up in a member that is being reduced creates its properties once more: see
        // `reduce_apparent_type_of_intersection_in_progress`.
        let mut in_progress = self.never_in_progress.iter();
        let is_usable = !skips
            && is_ordinary_name
            // Every object type has the properties of `Object`, and the index does not list them.
            && self.is_never_inherited(name)
            // `members` leaves out what a type reference inherits.
            && self.unresolved_members.is_empty()
            && !in_progress.any(|&ty| self.union_indexes.all[index].has_apparent_type(ty));
        is_usable.then_some(index)
    }

    /// `create_union_property` with the index at `index`. Only the members that have the name and those that have to be
    /// asked are visited.
    fn create_union_property_from_index(
        &mut self,
        index: usize,
        containing_type: TypeId,
        name: Atom,
    ) -> Option<Prop<'s>> {
        let parts = self.parts(containing_type);
        let of_union = &self.union_indexes.all[index];
        let with_name = of_union.members_with(name);
        let mut visited = with_name.clone();
        visited.extend(&of_union.not_indexed);
        visited.extend_except(&of_union.missing_unknown, &with_name);
        visited.extend_except(&of_union.missing_depends_on_name, &with_name);
        // `getApplicableIndexInfoForName` creates the literal type of the name for the first member that does not have the
        // name and has an index signature. If that member is not visited, the type is created in its turn all the same.
        let has_index_signature =
            |it: &&(Missing, PositionSet)| matches!(it.0, Missing::IndexSignature { .. });
        let mut creates_literal_type_at = (of_union.missing.iter())
            .filter(has_index_signature)
            .filter_map(|it| it.1.first_except(&visited))
            .min();
        let mut builder = UnionPropertyBuilder::new(containing_type);
        for at in visited.iter() {
            if creates_literal_type_at.is_some_and(|turn| turn < at) {
                self.string_literal(name, false);
                creates_literal_type_at = None;
            }
            let member = self.union_indexes.all[index].members[at];
            let (t, apparent, members) = match member {
                UnionMember::Skipped => continue,
                UnionMember::NotIndexed => {
                    self.add_member(&mut builder, at, parts[at], name, false, false);
                    continue;
                }
                UnionMember::Indexed {
                    apparent_type,
                    reduced_apparent_type,
                    members,
                } => (apparent_type, reduced_apparent_type, members),
            };
            if let Some(prop) = members.resolved.prop(name) {
                self.add_member_property(&mut builder, at, t, prop, members.mapper);
                continue;
            }
            let before = self.non_cacheable_mark();
            let missing = self.missing_from_member(t, name, false);
            builder.add_missing(at, missing);
            if self.non_cacheable_mark() == before
                && self.union_indexes.all[index].missing_unknown.contains(at)
                && let Some(is_same) = self.is_missing_the_same_for_every_name(apparent)
            {
                self.union_indexes.all[index].record_missing(at, is_same.then_some(missing));
            }
        }
        if creates_literal_type_at.is_some() {
            self.string_literal(name, false);
        }
        if builder.prop_set.is_empty() {
            return None;
        }
        // Without the members that were visited, not only those that have the name: what a visited member adds may have
        // been recorded since, and it has added that itself.
        for (missing, members) in &self.union_indexes.all[index].missing {
            // The first says where the index type goes, the last whether a member after `singleProp` adds it.
            let ends = [
                members.first_except(&visited),
                members.last_except(&visited),
            ];
            for at in ends.into_iter().flatten() {
                builder.add_missing(at, *missing);
            }
        }
        self.finish_union_property(builder, containing_type, name)
    }

    /// `members`: `member_for_index` of each member of `union`.
    fn store_union_index(&mut self, union: TypeId, members: Vec<UnionMember<'p>>) {
        // While the members were asked, another property of the union may have been made, and have stored one.
        if self.union_indexes.by_union.contains_key(&union) {
            return;
        }
        if !(members.iter()).any(|member| matches!(member, UnionMember::Indexed { .. })) {
            self.union_indexes.by_union.insert(union, None);
            return;
        }
        let at = self.union_indexes.all.len() as u32;
        self.union_indexes.all.push(UnionIndex::new(members));
        self.union_indexes.by_union.insert(union, Some(at));
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

    /// What the index of a union keeps about its member `current`. `lookup`: what `add_member` has just returned for it.
    /// `None`: something about the member is not final, so no index is made this time.
    fn member_for_index(
        &self,
        current: TypeId,
        lookup: MemberLookup<'p>,
    ) -> Option<UnionMember<'p>> {
        if !lookup.is_final {
            return None;
        }
        // The kinds that `known_apparent_type` and `known_reduced_type` are for. The apparent type of any other is computed
        // each time: from a base constraint, by instantiating a mapped type, by resolving a global type.
        let is_covered = |ty: TypeId| {
            let data = self.data(ty);
            is_plain_object(data) || matches!(data, TypeData::Intersection(_))
        };
        if !is_covered(current) || self.is_deferred(current) {
            return Some(UnionMember::NotIndexed);
        }
        let t = self.known_apparent_type(current)?;
        if self.is_error_type(t) || t.is_never() {
            return Some(UnionMember::Skipped);
        }
        let Some(PropertyHolder::Members(apparent, members)) = lookup.holder else {
            return Some(UnionMember::NotIndexed);
        };
        // `is_apparent_type_of_intersection_never` makes the intersection once more.
        let is_made_again = matches!(self.data(t), TypeData::Intersection(parts)
            if parts.iter().any(|&part| self.intersection_member_has_other_apparent_type(part)));
        if !is_covered(t) || is_made_again || self.known_reduced_type(t)? != t {
            return Some(UnionMember::NotIndexed);
        }
        let apparent_type_of_reduced = self.known_apparent_type(t)?;
        if !is_covered(apparent_type_of_reduced)
            || self.known_reduced_type(apparent_type_of_reduced)? != apparent
        {
            return Some(UnionMember::NotIndexed);
        }
        // `is_type_only_member`: a property that is listed and not found.
        if matches!(
            self.data(apparent),
            TypeData::Anon {
                origin: Origin::Module(_) | Origin::Namespace { .. },
                ..
            }
        ) {
            return Some(UnionMember::NotIndexed);
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
        Some(UnionMember::Indexed {
            apparent_type: t,
            reduced_apparent_type: apparent,
            members,
        })
    }

    /// Whether `missing_from_member` returns the same for every name that is neither late-bound nor numeric, and computes
    /// nothing when it is asked again. `apparent`: `reduced_apparent_type` of a `UnionMember::Indexed`. `None`: its index
    /// signatures are not final.
    fn is_missing_the_same_for_every_name(&self, apparent: TypeId) -> Option<bool> {
        let object = match self.data(apparent) {
            TypeData::Intersection(_) => self.p.intersection_objects.get(&self.task, &apparent)?,
            _ => apparent,
        };
        let members = self.resolved_members(object)?;
        let shape = members.shape();
        // `instantiate` counts its calls, and fails from a limit on.
        let is_unchanged = |ty: TypeId| {
            members.mapper == MapperId::IDENTITY
                || self.types().instantiation_class(ty) == InstantiationClass::Unchanged
        };
        Some(
            shape.properties_of.is_none()
                && !matches!(self.data(apparent), TypeData::Tuple { .. })
                && (shape.index.iter())
                    .all(|info| info.key == TypeId::STRING && is_unchanged(info.value)),
        )
    }

    /// One turn of the first loop of `createUnionOrIntersectionProperty`: for `current`, the member at `at`.
    fn add_member(
        &mut self,
        builder: &mut UnionPropertyBuilder<'p, 's>,
        at: usize,
        current: TypeId,
        name: Atom,
        skips: bool,
        is_late_bound: bool,
    ) -> MemberLookup<'p> {
        let before = self.non_cacheable_mark();
        let t = self.apparent_type(current);
        // An intersection with a member whose apparent type is `never`, such as a conditional
        // type with that constraint, has the apparent type `never`.
        if self.is_error_type(t) || t.is_never() || self.is_apparent_type_of_intersection_never(t) {
            return MemberLookup {
                is_final: self.non_cacheable_mark() == before,
                holder: None,
            };
        }
        let holder = self.apparent_type_or_type_variable(current, t);
        let holder = self.property_holder(holder);
        let is_final = self.non_cacheable_mark() == before;
        match self.property_of_holder(holder, name, skips) {
            Some((prop, mapper)) => self.add_member_property(builder, at, t, prop, mapper),
            None => {
                let missing = self.missing_from_member(t, name, is_late_bound);
                builder.add_missing(at, missing);
            }
        }
        MemberLookup {
            is_final,
            holder: Some(holder),
        }
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
