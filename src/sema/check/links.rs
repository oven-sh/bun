//! Caches the parts of a type that tsgo stores in fields of the type and assigns on first use:
//! `ConditionalType.checkType`, `extendsType`, `resolvedTrueType`, `resolvedFalseType` and `resolvedDefaultConstraint`,
//! `ConditionalRoot.inferTypeParameters`, `MappedType.typeParameter`, `mapper`, `constraintType`, `templateType`,
//! `nameType`, `modifiersType` and `resolvedApparentType`, and `Type.alias`. Also caches the restrictive and permissive
//! instantiations, which tsgo stores per type in `cachedTypes`.
//!
//! In this checker a conditional or mapped type is a type node plus a mapper. Deriving a part means looking up the type
//! of a node and instantiating it. `TypeLinks` caches the derived part per type, so the next read is a single load.
//!
//! A part is cached only when deriving it again would compute nothing and return the same value for the rest of the
//! task. Skipping the derivation is then unobservable, except for the two effects described at the end. The rules:
//! - The cache belongs to one checker, and so to one task. Other tasks can't see it, and none of its ids outlive the
//!   task. A task publishes the same things with and without it.
//! - A part that only needs interning is cached immediately. It depends only on the type's interning key and the
//!   program. This covers a mapped type's type parameter and mapper, and an alias.
//! - Any other part is `instantiate(declared, mapper)`. It's cached if both steps read a final entry (`derive_part`):
//!   - `declared` is in a table, and no computation in progress will overwrite it. If a type node is in progress
//!     several times, the outermost evaluation stores last (`is_type_node_settled`).
//!   - The result is in `Program::instantiations`. `instantiate_cached` only stores a result there if it was computed
//!     without a cycle, a limit, or a refusal. Also, no instantiation with `mapper` is in progress, because the outer
//!     of two instantiations with the same key stores last (`is_mapper_idle`).
//! - A part derived from other parts is cached only if all of them are. See `TypeLinks::left_open`.
//! - A part whose derivation runs an inference follows the rules for skipping an inference walk. The derivation must
//!   start with `obstacle_to_leaving_out` returning `None` and `is_settled_for_inference` returning true, and it must
//!   not have an effect that the next derivation would repeat (`derive_with_inference`). The cached part is read only
//!   while `obstacle_to_leaving_out` returns `None`.
//! - Nothing is read while `index_infos_in_instantiation` isn't empty. `instantiate` ignores older results then too.
//!
//! Reading a cached part skips the work that `instantiate` does before any lookup: it increments `instantiation_count`,
//! and at a limit it reports 2589 and returns the error type. tsgo loads the field and does neither.

use super::*;
use crate::table::{Id, Packed};
use smallvec::SmallVec;
use std::cell::RefCell;
use std::sync::atomic::AtomicU32;

/// `Type.alias.typeArguments`
pub(super) type AliasArguments = SmallVec<[TypeId; 4]>;

/// Cell index of a conditional type's `resolvedDefaultConstraint`. It follows the `cond_piece` cells.
pub(super) const DEFAULT_CONSTRAINT: usize = 4;
/// Cell index of `root.inferTypeParameters`. The cell contains 1 + start * `MOST_INFER_TYPE_PARAMETERS` + length, where
/// start and length locate the list in `TypeLinks::infer_type_parameters`.
const INFER_TYPE_PARAMETERS: usize = 5;
/// Lists of this length or longer aren't cached.
const MOST_INFER_TYPE_PARAMETERS: usize = 64;

#[derive(Copy, Clone, Debug)]
pub(super) enum MappedPart {
    TypeParameter,
    Mapper,
    ConstraintType,
    TemplateType,
    NameType,
    ModifiersType,
    ApparentType,
}

/// Kind of type that a row of `TypeLinks::parts` describes.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(super) enum Kind {
    Conditional,
    Mapped,
}

/// Number of cells in a row, one per `MappedPart`.
const PARTS: usize = 7;

/// `restrictiveMapper`, `permissiveMapper` and `uniqueLiteralMapper`, which are the same for every type.
#[derive(Copy, Clone, Debug)]
pub(super) enum FixedMapper {
    Restrictive,
    Permissive,
    UniqueLiteral,
}

/// A part whose derivation runs an inference is cached only if the derivation used at most this many bytes of native
/// stack, and it's read only where that many bytes are free. So no `is_stack_low` check would have cut the skipped
/// derivation short.
const STACK_OF_KEPT_PART: usize = 64 << 10;

/// Number of published types per page of `ByType`.
const PAGE: usize = 128;

/// Maps each type to a number, which is 0 until it's set.
#[derive(Default)]
pub(super) struct ByType {
    /// Numbers of the task's own types, indexed by `TypeId::local_number`.
    own: Vec<u32>,
    /// Indexed by a published type's id divided by `PAGE`. Each item is 1 + the index of the page in `published`, or 0
    /// if no number on the page is set. Pages are allocated on demand because a task only asks about a few of the
    /// published types.
    pages: Vec<u32>,
    published: Vec<[u32; PAGE]>,
}

impl ByType {
    #[inline]
    pub(super) fn get(&self, ty: TypeId) -> u32 {
        match ty.local_number() {
            Some(index) => self.own.get(index as usize).copied().unwrap_or(0),
            None => match self.pages.get(ty.0 as usize / PAGE) {
                Some(&page) if page != 0 => self.published[page as usize - 1][ty.0 as usize % PAGE],
                _ => 0,
            },
        }
    }

    pub(super) fn set(&mut self, ty: TypeId, number: u32) {
        let Some(index) = ty.local_number() else {
            let at = ty.0 as usize / PAGE;
            if at >= self.pages.len() {
                self.pages.resize(at + 1, 0);
            }
            if self.pages[at] == 0 {
                self.published.push([0; PAGE]);
                self.pages[at] = self.published.len() as u32;
            }
            self.published[self.pages[at] as usize - 1][ty.0 as usize % PAGE] = number;
            return;
        };
        if index as usize >= self.own.len() {
            self.own.resize(index as usize + 1, 0);
        }
        self.own[index as usize] = number;
    }
}

struct KeptAlias {
    symbol: Sym,
    /// Offset of its type arguments in `Aliases::type_arguments`, or `u32::MAX` if they haven't been requested.
    start: u32,
    len: u32,
}

#[derive(Default)]
struct Aliases {
    /// 0 if the alias hasn't been requested, 1 if the type has no alias, otherwise 2 + the index in `kept`.
    of: ByType,
    kept: Vec<KeptAlias>,
    type_arguments: Vec<TypeId>,
}

/// See the module docs.
#[derive(Default)]
pub(super) struct TypeLinks {
    /// 0 if nothing is cached for the type. Otherwise (1 + the index of its row in `parts`) * 2 + its `Kind`.
    rows: ByType,
    /// Each cell is a `Packed` value, or 0 if it's empty. A conditional type's cells are indexed by the `which`
    /// argument of `cond_piece`, a mapped type's by `MappedPart`.
    parts: Vec<[u32; PARTS]>,
    /// See `INFER_TYPE_PARAMETERS`.
    infer_type_parameters: Vec<TypeId>,
    /// 0 if nothing is cached for the type. Otherwise 1 + the index of its row in `with_fixed_mappers`.
    fixed_mapper_rows: ByType,
    /// `cachedTypes[CachedTypeKindRestrictiveInstantiation]`, `cachedTypes[CachedTypeKindPermissiveInstantiation]` and
    /// `uniqueLiteralFilledInstantiation`, indexed by `FixedMapper`. Each cell is a `Packed` type, or 0 if it's empty.
    with_fixed_mappers: Vec<[u32; 3]>,
    /// Number of `forget_restrictive_instantiations` calls.
    times_forgotten: u32,
    /// Number of times a part was derived but not cached. A part derived from other parts isn't cached if this changes
    /// during its derivation.
    left_open: u64,
    /// True if the task has added to `Program::circular_mapped_constraints`. See `Checker::mapped_keys`.
    has_found_circular_mapped_constraint: bool,
    /// In a `RefCell` because aliases are looked up through `&Checker`.
    aliases: RefCell<Aliases>,
}

impl TypeLinks {
    /// Returns 0 if the part isn't cached.
    #[inline]
    fn cell(&self, ty: TypeId, kind: Kind, at: usize) -> u32 {
        let row = self.rows.get(ty);
        if row == 0 || row & 1 != kind as u32 {
            return 0;
        }
        self.parts[(row >> 1) as usize - 1][at]
    }

    fn keep(&mut self, ty: TypeId, kind: Kind, at: usize, raw: u32, _: Stored) {
        let mut row = self.rows.get(ty);
        if row == 0 {
            self.parts.push([0; PARTS]);
            row = (self.parts.len() as u32) << 1 | kind as u32;
            self.rows.set(ty, row);
        }
        debug_assert!(row & 1 == kind as u32);
        self.parts[(row >> 1) as usize - 1][at] = raw;
    }

    /// Records that a part was derived outside `Checker::derive_settled`, so it isn't known to be final.
    #[inline]
    pub(super) fn note_left_open(&mut self) {
        self.left_open += 1;
    }

    /// Returns `root.inferTypeParameters` of the conditional type `ty` if `keep_infer_type_parameters` has cached them.
    #[inline]
    pub(super) fn infer_type_parameters(&self, ty: TypeId) -> Option<SmallVec<[TypeId; 4]>> {
        let place =
            (self.cell(ty, Kind::Conditional, INFER_TYPE_PARAMETERS) as usize).checked_sub(1)?;
        let (start, len) = (
            place / MOST_INFER_TYPE_PARAMETERS,
            place % MOST_INFER_TYPE_PARAMETERS,
        );
        let kept = self.infer_type_parameters.get(start..start + len)?;
        Some(SmallVec::from_slice(kept))
    }

    /// Caches `parameters`. It doesn't need permission because deriving them only needs interning.
    pub(super) fn keep_infer_type_parameters(&mut self, ty: TypeId, parameters: &[TypeId]) {
        // Most lists are empty, and an empty list adds nothing to `infer_type_parameters`.
        let start = match parameters.is_empty() {
            true => 0,
            false => self.infer_type_parameters.len(),
        };
        let place = start * MOST_INFER_TYPE_PARAMETERS + parameters.len();
        if parameters.len() < MOST_INFER_TYPE_PARAMETERS
            && let Ok(place) = u32::try_from(place + 1)
        {
            self.infer_type_parameters.extend_from_slice(parameters);
            let cell = INFER_TYPE_PARAMETERS;
            self.keep(ty, Kind::Conditional, cell, place, Stored::new());
        }
    }

    /// Returns 0 if the instantiation isn't cached.
    #[inline]
    fn with_fixed_mapper(&self, mapper: FixedMapper, ty: TypeId) -> u32 {
        match self.fixed_mapper_rows.get(ty) {
            0 => 0,
            row => self.with_fixed_mappers[row as usize - 1][mapper as usize],
        }
    }

    fn keep_with_fixed_mapper(&mut self, mapper: FixedMapper, ty: TypeId, raw: u32, _: Stored) {
        let mut row = self.fixed_mapper_rows.get(ty);
        if row == 0 {
            self.with_fixed_mappers.push([0; 3]);
            row = self.with_fixed_mappers.len() as u32;
            self.fixed_mapper_rows.set(ty, row);
        }
        self.with_fixed_mappers[row as usize - 1][mapper as usize] = raw;
    }

    /// Discards the cached restrictive instantiations. Call it when `getUniqueTypeParameters` has created type
    /// parameters whose constraints are unresolved, possibly under ids that it has used before.
    /// `getRestrictiveTypeParameter` returns a type parameter like that unchanged, so the cached results can be stale.
    pub(super) fn forget_restrictive_instantiations(&mut self) {
        for row in &mut self.with_fixed_mappers {
            row[FixedMapper::Restrictive as usize] = 0;
        }
        self.times_forgotten = self.times_forgotten.wrapping_add(1);
    }

    /// Returns the number of `forget_restrictive_instantiations` calls. An instantiation that was in progress during a
    /// call isn't cached either.
    #[inline]
    pub(super) fn times_forgotten(&self) -> u32 {
        self.times_forgotten
    }

    pub(super) fn note_circular_mapped_constraint(&mut self) {
        self.has_found_circular_mapped_constraint = true;
    }

    #[inline]
    pub(super) fn has_found_circular_mapped_constraint(&self) -> bool {
        self.has_found_circular_mapped_constraint
    }

    /// Returns `t.alias.symbol`, or `None` if it hasn't been requested yet.
    #[inline]
    pub(super) fn alias_symbol(&self, ty: TypeId) -> Option<Option<Sym>> {
        let aliases = self.aliases.borrow();
        match aliases.of.get(ty) {
            0 => None,
            1 => Some(None),
            at => Some(Some(aliases.kept[at as usize - 2].symbol)),
        }
    }

    pub(super) fn keep_alias_symbol(&self, ty: TypeId, alias: Option<Sym>) {
        let aliases = &mut *self.aliases.borrow_mut();
        let Some(symbol) = alias else {
            return aliases.of.set(ty, 1);
        };
        aliases.kept.push(KeptAlias {
            symbol,
            start: u32::MAX,
            len: 0,
        });
        aliases.of.set(ty, aliases.kept.len() as u32 + 1);
    }

    /// Returns `t.alias.typeArguments` if `keep_alias_type_arguments` has cached them.
    #[inline]
    pub(super) fn alias_type_arguments(&self, ty: TypeId) -> Option<AliasArguments> {
        let aliases = self.aliases.borrow();
        let at = (aliases.of.get(ty) as usize).checked_sub(2)?;
        let kept = aliases.kept.get(at)?;
        let (start, len) = (kept.start as usize, kept.len as usize);
        let type_arguments = aliases.type_arguments.get(start..start + len)?;
        Some(SmallVec::from_slice(type_arguments))
    }

    /// A no-op unless `keep_alias_symbol` has already cached a symbol for `ty`.
    pub(super) fn keep_alias_type_arguments(&self, ty: TypeId, type_arguments: &[TypeId]) {
        let aliases = &mut *self.aliases.borrow_mut();
        let Some(at) = (aliases.of.get(ty) as usize).checked_sub(2) else {
            return;
        };
        if let Some(kept) = aliases.kept.get_mut(at) {
            kept.start = aliases.type_arguments.len() as u32;
            kept.len = type_arguments.len() as u32;
            aliases.type_arguments.extend_from_slice(type_arguments);
        }
    }
}

impl<'p, 's> Checker<'p, 's> {
    /// Returns the part of `ty` in cell `at` if it's cached and may be read now.
    #[inline]
    pub(super) fn kept_part<V: Packed<Cell = AtomicU32>>(
        &self,
        ty: TypeId,
        kind: Kind,
        at: usize,
    ) -> Option<V> {
        let raw = self.links.cell(ty, kind, at);
        (raw != 0 && self.index_infos_in_instantiation.is_empty()).then(|| V::unpack(raw))
    }

    /// Caches a part that only needs interning.
    pub(super) fn keep_interned_part<V: Packed<Cell = AtomicU32>>(
        &mut self,
        ty: TypeId,
        kind: Kind,
        at: usize,
        part: V,
    ) {
        (self.links).keep(ty, kind, at, part.pack(), Stored::new());
    }

    /// Caches a part. `stored` is the permission that `derive_settled` returned with it.
    pub(super) fn keep_part<V: Packed<Cell = AtomicU32>>(
        &mut self,
        (ty, kind, at): (TypeId, Kind, usize),
        part: V,
        stored: Stored,
    ) {
        self.links.keep(ty, kind, at, part.pack(), stored);
    }

    /// Calls `derive` to get the part for `cell`, and caches it if the rules in the module docs allow.
    pub(super) fn derive_part<V: Packed<Cell = AtomicU32>>(
        &mut self,
        cell: (TypeId, Kind, usize),
        derive: impl FnOnce(&mut Self) -> V,
        is_settled: impl FnOnce(&Self) -> bool,
    ) -> V {
        let (part, stored) = self.derive_settled(derive, |c, _| is_settled(c));
        if let Some(stored) = stored {
            self.keep_part(cell, part, stored);
        }
        part
    }

    /// Returns the result of `derive`, plus permission to cache it if the rules in the module docs allow. `is_settled`
    /// must return true if the entries that `derive` read are final (`is_type_node_settled`, `is_mapper_idle`). It's
    /// called after `derive`, and nothing is looked up before, so `derive` creates everything in the same order as
    /// without the cache.
    pub(super) fn derive_settled<V>(
        &mut self,
        derive: impl FnOnce(&mut Self) -> V,
        is_settled: impl FnOnce(&Self, &V) -> bool,
    ) -> (V, Option<Stored>) {
        if !self.index_infos_in_instantiation.is_empty() || self.is_innermost_tainted() {
            self.links.left_open += 1;
            return (derive(self), None);
        }
        let (interruptions, limit_hits) = (self.interruptions(), self.instantiation_limit_hits);
        let left_open = self.links.left_open;
        let scope = self.begin_scope();
        let part = derive(self);
        let is_open = self.non_cacheable_mark() != scope.counters
            || self.lowest_taint <= scope.frames as usize
            || self.interruptions() != interruptions
            || self.instantiation_limit_hits != limit_hits
            || self.links.left_open != left_open
            || !is_settled(self, &part);
        let stored = self.end_scope_as(scope, is_open).ok();
        if stored.is_none() {
            self.links.left_open += 1;
        }
        (part, stored)
    }

    /// Calls `derive`, which runs an inference. The returned flag is true if `derive` had no effect that a caller could
    /// notice, apart from the ones that `derive_settled` checks. For that, it must not have marked the variance being
    /// measured (a hit in `Program::relations` does that every time), its result must not depend on the comparisons or
    /// variance computations in progress, and it must have used at most `STACK_OF_KEPT_PART` bytes of stack.
    pub(super) fn derive_with_inference<V>(
        &mut self,
        derive: impl FnOnce(&mut Self) -> V,
    ) -> (V, bool) {
        let traces = |c: &Self| {
            (
                c.in_progress_variance_reads,
                c.comparisons_of_deeply_nested_types,
                c.any_signature_reads,
            )
        };
        let before = traces(self);
        let in_use = self.stack_base.saturating_sub(stack_pointer());
        let outer_deepest = self.deepest_stack.replace(0);
        let outer_reliability = std::mem::take(&mut self.reliability);
        let part = derive(self);
        let is_reliable = self.reliability == 0;
        self.reliability |= outer_reliability;
        let deepest = self.deepest_stack.get();
        self.deepest_stack.set(deepest.max(outer_deepest));
        let leaves_nothing = is_reliable
            && traces(self) == before
            && deepest.saturating_sub(in_use) <= STACK_OF_KEPT_PART;
        (part, leaves_nothing)
    }

    /// See `STACK_OF_KEPT_PART`.
    #[inline]
    pub(super) fn has_stack_for_kept_part(&self) -> bool {
        self.stack_base.saturating_sub(stack_pointer()) + STACK_OF_KEPT_PART <= self.stack_limit
    }

    /// Returns `instantiateType(ty, mapper)` for a fixed mapper if it's cached and may be read now.
    #[inline]
    pub(super) fn kept_with_fixed_mapper(&self, mapper: FixedMapper, ty: TypeId) -> Option<TypeId> {
        let raw = self.links.with_fixed_mapper(mapper, ty);
        (raw != 0 && self.index_infos_in_instantiation.is_empty()).then(|| TypeId::unpack(raw))
    }

    pub(super) fn keep_with_fixed_mapper(
        &mut self,
        mapper: FixedMapper,
        ty: TypeId,
        instantiated: TypeId,
        stored: Stored,
    ) {
        (self.links).keep_with_fixed_mapper(mapper, ty, instantiated.pack(), stored);
    }

    /// True if no `instantiate_cached` call with `mapper` is in progress. A call in progress would overwrite the entry
    /// that an instantiation with `mapper` has just read or stored.
    #[inline]
    pub(super) fn is_mapper_idle(&self, mapper: MapperId) -> bool {
        !self.active_mappers.is_active(mapper)
    }

    /// True if `type_from_node` reads the type of `node` from `Program::type_node_types` and that entry is final.
    pub(super) fn is_type_node_settled(&self, file: FileId, node: TypeNodeId) -> bool {
        let q = Query::TypeNode(file, node);
        (self.p.type_node_types.get(&self.task, &(file, node))).is_some()
            && !(self.may_be_in_flight(q) && self.stack.contains(&q))
    }
}

#[cfg(test)]
mod tests {
    use super::{
        ByType, FixedMapper, Kind, MOST_INFER_TYPE_PARAMETERS, MappedPart, PAGE, PARTS, TypeLinks,
    };
    use crate::bind::SymbolId;
    use crate::check::task::Stored;
    use crate::local::LOCAL;
    use crate::program::{FileId, Sym};
    use crate::types::TypeId;

    #[test]
    fn a_number_for_each_type() {
        let page = PAGE as u32;
        let types = [
            0,
            1,
            page - 1,
            page,
            page + 1,
            5 * page,
            LOCAL,
            LOCAL | 1,
            LOCAL | 1000,
        ];
        let mut numbers = ByType::default();
        for ty in types {
            assert_eq!(numbers.get(TypeId(ty)), 0);
        }
        for (at, ty) in types.into_iter().enumerate() {
            numbers.set(TypeId(ty), at as u32 + 1);
        }
        for (at, ty) in types.into_iter().enumerate() {
            assert_eq!(numbers.get(TypeId(ty)), at as u32 + 1);
        }
        for other in [
            2,
            page + 2,
            2 * page,
            5 * page - 1,
            6 * page,
            LOCAL | 2,
            LOCAL | 999,
            LOCAL | 1001,
        ] {
            assert_eq!(numbers.get(TypeId(other)), 0);
        }
        // Only pages with a number are allocated.
        assert_eq!(numbers.published.len(), 3);
    }

    #[test]
    fn a_row_is_read_as_the_kind_that_it_was_kept_as() {
        let (conditional, mapped) = (TypeId(LOCAL | 3), TypeId(7));
        let mut links = TypeLinks::default();
        links.keep(conditional, Kind::Conditional, 2, 40, Stored::new());
        let last = MappedPart::ApparentType as usize;
        assert_eq!(last + 1, PARTS);
        links.keep(mapped, Kind::Mapped, last, 50, Stored::new());
        links.keep(conditional, Kind::Conditional, 0, 60, Stored::new());
        let row = |ty, kind| [0, 1, 2, 3, 4, 5, 6].map(|at| links.cell(ty, kind, at));
        assert_eq!(row(conditional, Kind::Conditional), [60, 0, 40, 0, 0, 0, 0]);
        assert_eq!(row(conditional, Kind::Mapped), [0; PARTS]);
        assert_eq!(row(mapped, Kind::Mapped), [0, 0, 0, 0, 0, 0, 50]);
        assert_eq!(row(mapped, Kind::Conditional), [0; PARTS]);
        assert_eq!(row(TypeId(8), Kind::Mapped), [0; PARTS]);
    }

    #[test]
    fn only_the_restrictive_instantiations_are_forgotten() {
        let (a, b) = (TypeId(LOCAL | 3), TypeId(7));
        let mut links = TypeLinks::default();
        links.keep_with_fixed_mapper(FixedMapper::Restrictive, a, 40, Stored::new());
        links.keep_with_fixed_mapper(FixedMapper::Permissive, a, 50, Stored::new());
        links.keep_with_fixed_mapper(FixedMapper::UniqueLiteral, b, 60, Stored::new());
        links.keep_with_fixed_mapper(FixedMapper::Restrictive, b, 70, Stored::new());
        let mappers = [
            FixedMapper::Restrictive,
            FixedMapper::Permissive,
            FixedMapper::UniqueLiteral,
        ];
        let row = |links: &TypeLinks, ty| mappers.map(|mapper| links.with_fixed_mapper(mapper, ty));
        assert_eq!(row(&links, a), [40, 50, 0]);
        assert_eq!(row(&links, b), [70, 0, 60]);
        assert_eq!(row(&links, TypeId(8)), [0; 3]);
        links.forget_restrictive_instantiations();
        assert_eq!(row(&links, a), [0, 50, 0]);
        assert_eq!(row(&links, b), [0, 0, 60]);
        links.keep_with_fixed_mapper(FixedMapper::Restrictive, a, 80, Stored::new());
        assert_eq!(row(&links, a), [80, 50, 0]);
    }

    #[test]
    fn infer_type_parameters() {
        let types = [1, 2, LOCAL, LOCAL | 1, LOCAL | 2].map(TypeId);
        let [none, one, five, too_many, not_asked] = types;
        let mut links = TypeLinks::default();
        links.keep_infer_type_parameters(five, &types);
        links.keep_infer_type_parameters(none, &[]);
        links.keep_infer_type_parameters(one, &[five]);
        links.keep_infer_type_parameters(too_many, &[one; MOST_INFER_TYPE_PARAMETERS]);
        let kept = |ty| links.infer_type_parameters(ty).map(|it| it.to_vec());
        assert_eq!(kept(none), Some(vec![]));
        assert_eq!(kept(one), Some(vec![five]));
        assert_eq!(kept(five), Some(types.to_vec()));
        assert_eq!(kept(too_many), None);
        assert_eq!(kept(not_asked), None);
        let most = [one; MOST_INFER_TYPE_PARAMETERS - 1];
        links.keep_infer_type_parameters(not_asked, &most);
        let kept = links.infer_type_parameters(not_asked);
        assert_eq!(kept.map(|it| it.to_vec()), Some(most.to_vec()));
    }

    #[test]
    fn aliases() {
        let symbol = |id| Sym {
            file: FileId(1),
            id: SymbolId(id),
        };
        let types = [1, 2, LOCAL, LOCAL | 1, LOCAL | 2].map(TypeId);
        let [without, none, one, five, not_asked] = types;
        let links = TypeLinks::default();
        assert_eq!(links.alias_symbol(without), None);
        links.keep_alias_symbol(without, None);
        for (at, ty) in [none, one, five, not_asked].into_iter().enumerate() {
            links.keep_alias_symbol(ty, Some(symbol(at as u32)));
        }
        links.keep_alias_type_arguments(five, &types);
        links.keep_alias_type_arguments(none, &[]);
        links.keep_alias_type_arguments(one, &[five]);
        links.keep_alias_type_arguments(without, &[five]);
        assert_eq!(links.alias_symbol(without), Some(None));
        assert_eq!(links.alias_symbol(five), Some(Some(symbol(2))));
        assert_eq!(links.alias_symbol(TypeId(3)), None);
        let type_arguments = |ty| links.alias_type_arguments(ty).map(|it| it.to_vec());
        assert_eq!(type_arguments(without), None);
        assert_eq!(type_arguments(none), Some(vec![]));
        assert_eq!(type_arguments(one), Some(vec![five]));
        assert_eq!(type_arguments(five), Some(types.to_vec()));
        assert_eq!(type_arguments(not_asked), None);
        assert_eq!(type_arguments(TypeId(3)), None);
    }
}
