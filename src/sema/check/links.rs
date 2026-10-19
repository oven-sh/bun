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
//! - A part derived from other parts is cached only if all of them are. See `TypeLinks::uncached_derivations`.
//! - A part whose derivation runs an inference follows the rules for skipping an inference walk. The derivation must
//!   start with `obstacle_to_skipping` returning `None` and `is_settled_for_inference` returning true, and it must
//!   not have an effect that the next derivation would repeat (`derive_with_inference`). The cached part is read only
//!   while `obstacle_to_skipping` returns `None`.
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
/// Cell index of `root.inferTypeParameters`. The cell contains 1 + start * `MAX_INFER_TYPE_PARAMETERS` + length, where
/// start and length locate the list in `TypeLinks::infer_type_parameters`.
const INFER_TYPE_PARAMETERS: usize = 5;
/// Lists of this length or longer aren't cached.
const MAX_INFER_TYPE_PARAMETERS: usize = 64;

#[derive(Copy, Clone, Debug)]
pub(super) enum MappedPart {
    TypeParameter,
    Mapper,
    ConstraintType,
    TemplateType,
    NameType,
    ModifiersType,
    ApparentType,
    /// 1 + the index in `TypeLinks::index_types`.
    IndexType,
    /// 1 + the index in `TypeLinks::generic_names`.
    HasGenericName,
}

/// Kind of type that a row of `TypeLinks::parts` describes.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(super) enum Kind {
    Conditional,
    Mapped,
}

/// Number of cells in a row, one per `MappedPart`.
const PARTS: usize = 9;

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
const MAX_STACK_OF_CACHED_PART: usize = 64 << 10;

/// Side effects that a derivation repeats every time it runs.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) struct SideEffects {
    /// Amount it adds to `Checker::instantiation_count`.
    instantiations: u32,
    /// Amount it adds to `Checker::instantiations_computed`.
    computed: u32,
    /// Number of levels it adds to `Checker::instantiation_depth` at its deepest point.
    levels: u32,
    /// Bytes of native stack it uses.
    stack: u32,
    /// Bits it sets in `Checker::reliability`.
    reliability: u8,
}

/// The checker's counters at `Checker::begin_measuring`.
struct BeforeDerivation {
    instantiation_count: u32,
    instantiations_computed: u64,
    instantiation_depth: u32,
    /// `Checker::deepest_instantiation`, which starts at the depth during the derivation.
    deepest_instantiation: u32,
    /// Bytes of native stack in use.
    stack_in_use: usize,
    /// `Checker::deepest_stack`, which is 0 during the derivation.
    deepest_stack: usize,
    /// `Checker::reliability`, which is 0 during the derivation.
    reliability: u8,
}

/// A result that tsgo recomputes on every request, plus the first derivation's side effects. tsgo doesn't cache
/// instantiations, so every request there has those effects. `Checker::repeat` applies them instead of running the
/// later derivations.
pub(super) type WithSideEffects<V> = (V, SideEffects);

/// Number of published types per page of `ByType`.
const PAGE: usize = 128;

/// Maps each type to a number, which is 0 until it's set.
#[derive(Default)]
pub(super) struct ByType {
    /// Numbers of the task's own types, indexed by `TypeId::local_number`.
    own: Vec<u32>,
    /// Indexed by a published type's id divided by `PAGE`. Each item is 1 + the index of the page in `published`, or 0
    /// if no number on the page is set. Pages are allocated on demand because a task only looks up a few of the
    /// published types.
    pages: Vec<u32>,
    published: Vec<[u32; PAGE]>,
}

impl ByType {
    /// Resets every number to 0 but keeps the allocations.
    pub(super) fn clear(&mut self) {
        let ByType {
            own,
            pages,
            published,
        } = self;
        own.clear();
        pages.clear();
        published.clear();
    }

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

struct CachedAlias {
    symbol: Sym,
    /// Offset of its type arguments in `Aliases::type_arguments`, or `u32::MAX` if they haven't been requested.
    start: u32,
    len: u32,
}

#[derive(Default)]
struct Aliases {
    /// 0 if the alias hasn't been requested, 1 if the type has no alias, otherwise 2 + the index in `cached`.
    of: ByType,
    cached: Vec<CachedAlias>,
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
    /// `getIndexTypeForMappedType` of mapped types that have a name type.
    index_types: Vec<WithSideEffects<TypeId>>,
    /// True if `isGenericMappedType` considers the mapped type's name type generic.
    generic_names: Vec<WithSideEffects<bool>>,
    /// 0 if nothing is cached for the type. Otherwise 1 + the index of its row in `with_fixed_mappers`.
    fixed_mapper_rows: ByType,
    /// `cachedTypes[CachedTypeKindRestrictiveInstantiation]`, `cachedTypes[CachedTypeKindPermissiveInstantiation]` and
    /// `uniqueLiteralFilledInstantiation`, indexed by `FixedMapper`. Each cell is a `Packed` type, or 0 if it's empty.
    with_fixed_mappers: Vec<[u32; 3]>,
    /// Number of `forget_restrictive_instantiations` calls.
    times_forgotten: u32,
    /// Number of times a part was derived but not cached. A part derived from other parts isn't cached if this changes
    /// during its derivation.
    uncached_derivations: u64,
    /// True if the task has added to `Program::circular_mapped_constraints`. See `Checker::mapped_keys`.
    has_found_circular_mapped_constraint: bool,
    /// In a `RefCell` because aliases are looked up through `&Checker`.
    aliases: RefCell<Aliases>,
}

impl TypeLinks {
    /// Resets to `TypeLinks::default()` but keeps the allocations. Every field is destructured, so adding a field
    /// without clearing it here is a compile error.
    pub(super) fn clear(&mut self) {
        let TypeLinks {
            rows,
            parts,
            infer_type_parameters,
            index_types,
            generic_names,
            fixed_mapper_rows,
            with_fixed_mappers,
            times_forgotten,
            uncached_derivations,
            has_found_circular_mapped_constraint,
            aliases,
        } = self;
        let Aliases {
            of,
            cached,
            type_arguments,
        } = aliases.get_mut();
        rows.clear();
        parts.clear();
        infer_type_parameters.clear();
        index_types.clear();
        generic_names.clear();
        fixed_mapper_rows.clear();
        with_fixed_mappers.clear();
        (*times_forgotten, *uncached_derivations) = (0, 0);
        *has_found_circular_mapped_constraint = false;
        of.clear();
        cached.clear();
        type_arguments.clear();
    }

    /// Returns 0 if the part isn't cached.
    #[inline]
    fn cell(&self, ty: TypeId, kind: Kind, at: usize) -> u32 {
        let row = self.rows.get(ty);
        if row == 0 || row & 1 != kind as u32 {
            return 0;
        }
        self.parts[(row >> 1) as usize - 1][at]
    }

    fn set_cell(&mut self, ty: TypeId, kind: Kind, at: usize, raw: u32, _: Stored) {
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
    pub(super) fn note_uncached_derivation(&mut self) {
        self.uncached_derivations += 1;
    }

    /// Returns `root.inferTypeParameters` of the conditional type `ty` if `cache_infer_type_parameters` has cached
    /// them.
    #[inline]
    pub(super) fn infer_type_parameters(&self, ty: TypeId) -> Option<SmallVec<[TypeId; 4]>> {
        let encoded =
            (self.cell(ty, Kind::Conditional, INFER_TYPE_PARAMETERS) as usize).checked_sub(1)?;
        let (start, len) = (
            encoded / MAX_INFER_TYPE_PARAMETERS,
            encoded % MAX_INFER_TYPE_PARAMETERS,
        );
        let cached = self.infer_type_parameters.get(start..start + len)?;
        Some(SmallVec::from_slice(cached))
    }

    /// Caches `parameters`. It doesn't need permission because deriving them only needs interning.
    pub(super) fn cache_infer_type_parameters(&mut self, ty: TypeId, parameters: &[TypeId]) {
        // Most lists are empty, and an empty list adds nothing to `infer_type_parameters`.
        let start = match parameters.is_empty() {
            true => 0,
            false => self.infer_type_parameters.len(),
        };
        let encoded = start * MAX_INFER_TYPE_PARAMETERS + parameters.len();
        if parameters.len() < MAX_INFER_TYPE_PARAMETERS
            && let Ok(encoded) = u32::try_from(encoded + 1)
        {
            self.infer_type_parameters.extend_from_slice(parameters);
            let cell = INFER_TYPE_PARAMETERS;
            self.set_cell(ty, Kind::Conditional, cell, encoded, Stored::new());
        }
    }

    /// Returns the entry of `index_types` for the mapped type `ty`.
    #[inline]
    pub(super) fn index_type(&self, ty: TypeId) -> Option<WithSideEffects<TypeId>> {
        let at = self.cell(ty, Kind::Mapped, MappedPart::IndexType as usize) as usize;
        Some(self.index_types[at.checked_sub(1)?])
    }

    pub(super) fn cache_index_type(
        &mut self,
        ty: TypeId,
        entry: WithSideEffects<TypeId>,
        stored: Stored,
    ) {
        self.index_types.push(entry);
        let (cell, encoded) = (
            MappedPart::IndexType as usize,
            self.index_types.len() as u32,
        );
        self.set_cell(ty, Kind::Mapped, cell, encoded, stored);
    }

    /// Returns the entry of `generic_names` for the mapped type `ty`.
    #[inline]
    pub(super) fn has_generic_name(&self, ty: TypeId) -> Option<WithSideEffects<bool>> {
        let at = self.cell(ty, Kind::Mapped, MappedPart::HasGenericName as usize) as usize;
        Some(self.generic_names[at.checked_sub(1)?])
    }

    pub(super) fn cache_has_generic_name(
        &mut self,
        ty: TypeId,
        entry: WithSideEffects<bool>,
        stored: Stored,
    ) {
        self.generic_names.push(entry);
        let (cell, encoded) = (
            MappedPart::HasGenericName as usize,
            self.generic_names.len() as u32,
        );
        self.set_cell(ty, Kind::Mapped, cell, encoded, stored);
    }

    /// Returns 0 if the instantiation isn't cached.
    #[inline]
    fn with_fixed_mapper(&self, mapper: FixedMapper, ty: TypeId) -> u32 {
        match self.fixed_mapper_rows.get(ty) {
            0 => 0,
            row => self.with_fixed_mappers[row as usize - 1][mapper as usize],
        }
    }

    fn cache_with_fixed_mapper(&mut self, mapper: FixedMapper, ty: TypeId, raw: u32, _: Stored) {
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
            at => Some(Some(aliases.cached[at as usize - 2].symbol)),
        }
    }

    pub(super) fn cache_alias_symbol(&self, ty: TypeId, alias: Option<Sym>) {
        let aliases = &mut *self.aliases.borrow_mut();
        let Some(symbol) = alias else {
            return aliases.of.set(ty, 1);
        };
        aliases.cached.push(CachedAlias {
            symbol,
            start: u32::MAX,
            len: 0,
        });
        aliases.of.set(ty, aliases.cached.len() as u32 + 1);
    }

    /// Returns `t.alias.typeArguments` if `cache_alias_type_arguments` has cached them.
    #[inline]
    pub(super) fn alias_type_arguments(&self, ty: TypeId) -> Option<AliasArguments> {
        let aliases = self.aliases.borrow();
        let at = (aliases.of.get(ty) as usize).checked_sub(2)?;
        let cached = aliases.cached.get(at)?;
        let (start, len) = (cached.start as usize, cached.len as usize);
        let type_arguments = aliases.type_arguments.get(start..start + len)?;
        Some(SmallVec::from_slice(type_arguments))
    }

    /// A no-op unless `cache_alias_symbol` has already cached a symbol for `ty`.
    pub(super) fn cache_alias_type_arguments(&self, ty: TypeId, type_arguments: &[TypeId]) {
        let aliases = &mut *self.aliases.borrow_mut();
        let Some(at) = (aliases.of.get(ty) as usize).checked_sub(2) else {
            return;
        };
        if let Some(cached) = aliases.cached.get_mut(at) {
            cached.start = aliases.type_arguments.len() as u32;
            cached.len = type_arguments.len() as u32;
            aliases.type_arguments.extend_from_slice(type_arguments);
        }
    }
}

impl<'p, 's> Checker<'p, 's> {
    /// Returns the part of `ty` in cell `at` if it's cached and may be read now.
    #[inline]
    pub(super) fn cached_part<V: Packed<Cell = AtomicU32>>(
        &self,
        ty: TypeId,
        kind: Kind,
        at: usize,
    ) -> Option<V> {
        let raw = self.links.cell(ty, kind, at);
        (raw != 0 && self.index_infos_in_instantiation.is_empty()).then(|| V::unpack(raw))
    }

    /// Caches a part that only needs interning.
    pub(super) fn cache_interned_part<V: Packed<Cell = AtomicU32>>(
        &mut self,
        ty: TypeId,
        kind: Kind,
        at: usize,
        part: V,
    ) {
        (self.links).set_cell(ty, kind, at, part.pack(), Stored::new());
    }

    /// Caches a part. `stored` is the permission that `derive_settled` returned with it.
    pub(super) fn cache_part<V: Packed<Cell = AtomicU32>>(
        &mut self,
        (ty, kind, at): (TypeId, Kind, usize),
        part: V,
        stored: Stored,
    ) {
        self.links.set_cell(ty, kind, at, part.pack(), stored);
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
            self.cache_part(cell, part, stored);
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
            self.links.uncached_derivations += 1;
            return (derive(self), None);
        }
        let (interruptions, limit_hits) = (self.interruptions(), self.instantiation_limit_hits);
        let uncached_derivations = self.links.uncached_derivations;
        let scope = self.begin_scope();
        let part = derive(self);
        let is_open = self.non_cacheable_mark() != scope.counters
            || self.lowest_taint <= scope.frames as usize
            || self.interruptions() != interruptions
            || self.instantiation_limit_hits != limit_hits
            || self.links.uncached_derivations != uncached_derivations
            || !is_settled(self, &part);
        let stored = self.end_scope_as(scope, is_open).ok();
        if stored.is_none() {
            self.links.uncached_derivations += 1;
        }
        (part, stored)
    }

    /// Like `derive_settled`, but also measures `derive`'s side effects. They're `None` if `instantiation_count` was
    /// reset during the derivation.
    pub(super) fn derive_measured<V>(
        &mut self,
        derive: impl FnOnce(&mut Self) -> V,
        is_settled: impl FnOnce(&Self, &V) -> bool,
    ) -> (V, Option<Stored>, Option<SideEffects>) {
        let before = self.begin_measuring();
        let (value, stored) = self.derive_settled(derive, is_settled);
        (value, stored, self.end_measuring(&before))
    }

    fn begin_measuring(&mut self) -> BeforeDerivation {
        BeforeDerivation {
            instantiation_count: self.instantiation_count,
            instantiations_computed: self.instantiations_computed,
            instantiation_depth: self.instantiation_depth,
            deepest_instantiation: std::mem::replace(
                &mut self.deepest_instantiation,
                self.instantiation_depth,
            ),
            stack_in_use: self.stack_base.saturating_sub(stack_pointer()),
            deepest_stack: self.deepest_stack.replace(0),
            reliability: std::mem::take(&mut self.reliability),
        }
    }

    /// Returns the side effects since `begin_measuring`. See `derive_measured`.
    fn end_measuring(&mut self, before: &BeforeDerivation) -> Option<SideEffects> {
        let levels = (self.deepest_instantiation).saturating_sub(before.instantiation_depth);
        self.deepest_instantiation = (self.deepest_instantiation).max(before.deepest_instantiation);
        let deepest = self.deepest_stack.get();
        self.deepest_stack.set(deepest.max(before.deepest_stack));
        let reliability = self.reliability;
        self.reliability |= before.reliability;
        let computed = self.instantiations_computed - before.instantiations_computed;
        let instantiations = (self.instantiation_count).checked_sub(before.instantiation_count)?;
        Some(SideEffects {
            instantiations,
            computed: computed.min(u64::from(u32::MAX)) as u32,
            levels,
            stack: u32::try_from(deepest.saturating_sub(before.stack_in_use)).unwrap_or(u32::MAX),
            reliability,
        })
    }

    /// Applies a derivation's recorded side effects without running it. Returns false and does nothing if one of
    /// `instantiate`'s limits or an `is_stack_low` check could stop the derivation. It then has to run so that it
    /// reports its errors.
    pub(super) fn repeat(&mut self, repeated: &SideEffects) -> bool {
        let count = (self.instantiation_count).saturating_add(repeated.instantiations);
        let levels = self.instantiation_depth + repeated.levels;
        let in_use = self.stack_base.saturating_sub(stack_pointer());
        let deepest = in_use.saturating_add(repeated.stack as usize);
        if !self.index_infos_in_instantiation.is_empty()
            || count >= 5_000_000
            || levels >= 100
            || deepest > self.stack_limit
        {
            return false;
        }
        self.instantiation_count = count;
        self.instantiations_computed += u64::from(repeated.computed);
        self.deepest_instantiation = self.deepest_instantiation.max(levels);
        self.reliability |= repeated.reliability;
        if deepest > self.deepest_stack.get() {
            self.deepest_stack.set(deepest);
        }
        true
    }

    /// Calls `derive`, which runs an inference. The returned flag is true if `derive` had no effect that a caller could
    /// notice, apart from the ones that `derive_settled` checks. For that, it must not have marked the variance being
    /// measured (a hit in `Program::relations` does that every time), its result must not depend on the comparisons or
    /// variance computations in progress, and it must have used at most `MAX_STACK_OF_CACHED_PART` bytes of stack.
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
        let has_no_side_effects = is_reliable
            && traces(self) == before
            && deepest.saturating_sub(in_use) <= MAX_STACK_OF_CACHED_PART;
        (part, has_no_side_effects)
    }

    /// See `MAX_STACK_OF_CACHED_PART`.
    #[inline]
    pub(super) fn has_stack_for_cached_part(&self) -> bool {
        self.stack_base.saturating_sub(stack_pointer()) + MAX_STACK_OF_CACHED_PART
            <= self.stack_limit
    }

    /// Returns `instantiateType(ty, mapper)` for a fixed mapper if it's cached and may be read now.
    #[inline]
    pub(super) fn cached_with_fixed_mapper(
        &self,
        mapper: FixedMapper,
        ty: TypeId,
    ) -> Option<TypeId> {
        let raw = self.links.with_fixed_mapper(mapper, ty);
        (raw != 0 && self.index_infos_in_instantiation.is_empty()).then(|| TypeId::unpack(raw))
    }

    pub(super) fn cache_with_fixed_mapper(
        &mut self,
        mapper: FixedMapper,
        ty: TypeId,
        instantiated: TypeId,
        stored: Stored,
    ) {
        (self.links).cache_with_fixed_mapper(mapper, ty, instantiated.pack(), stored);
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
        ByType, FixedMapper, Kind, MAX_INFER_TYPE_PARAMETERS, MappedPart, PAGE, PARTS, TypeLinks,
    };
    use crate::bind::SymbolId;
    use crate::check::task::Stored;
    use crate::local::LOCAL;
    use crate::program::{FileId, Sym};
    use crate::types::TypeId;

    #[test]
    fn by_type_stores_a_number_per_type() {
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
    fn cleared_links_have_nothing_cached() {
        let symbol = Sym {
            file: FileId(1),
            id: SymbolId(2),
        };
        let types = [TypeId(LOCAL | 3), TypeId(7), TypeId(5 * PAGE as u32)];
        let mut links = TypeLinks::default();
        for ty in types {
            links.set_cell(ty, Kind::Mapped, 0, 40, Stored::new());
            links.cache_with_fixed_mapper(FixedMapper::Permissive, ty, 50, Stored::new());
            links.cache_alias_symbol(ty, Some(symbol));
            links.cache_alias_type_arguments(ty, &types);
        }
        links.cache_infer_type_parameters(TypeId(8), &types);
        links.forget_restrictive_instantiations();
        links.note_uncached_derivation();
        links.note_circular_mapped_constraint();
        links.clear();
        for ty in types {
            assert_eq!(links.cell(ty, Kind::Mapped, 0), 0);
            assert_eq!(links.with_fixed_mapper(FixedMapper::Permissive, ty), 0);
            assert_eq!(links.alias_symbol(ty), None);
            assert_eq!(links.alias_type_arguments(ty), None);
        }
        assert_eq!(links.infer_type_parameters(TypeId(8)), None);
        assert_eq!((links.times_forgotten, links.uncached_derivations), (0, 0));
        assert!(!links.has_found_circular_mapped_constraint);
        // A row added after `clear` starts empty.
        links.set_cell(types[0], Kind::Mapped, 1, 60, Stored::new());
        assert_eq!(links.cell(types[0], Kind::Mapped, 0), 0);
        assert_eq!(links.cell(types[0], Kind::Mapped, 1), 60);
    }

    #[test]
    fn row_is_only_read_as_its_own_kind() {
        let (conditional, mapped) = (TypeId(LOCAL | 3), TypeId(7));
        let mut links = TypeLinks::default();
        links.set_cell(conditional, Kind::Conditional, 2, 40, Stored::new());
        let last = MappedPart::HasGenericName as usize;
        assert_eq!(last + 1, PARTS);
        links.set_cell(mapped, Kind::Mapped, last, 50, Stored::new());
        links.set_cell(conditional, Kind::Conditional, 0, 60, Stored::new());
        let row = |ty, kind| [0, 1, 2, 3, 4, 5, 6, 7, 8].map(|at| links.cell(ty, kind, at));
        assert_eq!(
            row(conditional, Kind::Conditional),
            [60, 0, 40, 0, 0, 0, 0, 0, 0]
        );
        assert_eq!(row(conditional, Kind::Mapped), [0; PARTS]);
        assert_eq!(row(mapped, Kind::Mapped), [0, 0, 0, 0, 0, 0, 0, 0, 50]);
        assert_eq!(row(mapped, Kind::Conditional), [0; PARTS]);
        assert_eq!(row(TypeId(8), Kind::Mapped), [0; PARTS]);
    }

    #[test]
    fn forget_clears_only_restrictive_instantiations() {
        let (a, b) = (TypeId(LOCAL | 3), TypeId(7));
        let mut links = TypeLinks::default();
        links.cache_with_fixed_mapper(FixedMapper::Restrictive, a, 40, Stored::new());
        links.cache_with_fixed_mapper(FixedMapper::Permissive, a, 50, Stored::new());
        links.cache_with_fixed_mapper(FixedMapper::UniqueLiteral, b, 60, Stored::new());
        links.cache_with_fixed_mapper(FixedMapper::Restrictive, b, 70, Stored::new());
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
        links.cache_with_fixed_mapper(FixedMapper::Restrictive, a, 80, Stored::new());
        assert_eq!(row(&links, a), [80, 50, 0]);
    }

    #[test]
    fn infer_type_parameters() {
        let types = [1, 2, LOCAL, LOCAL | 1, LOCAL | 2].map(TypeId);
        let [none, one, five, too_many, not_requested] = types;
        let mut links = TypeLinks::default();
        links.cache_infer_type_parameters(five, &types);
        links.cache_infer_type_parameters(none, &[]);
        links.cache_infer_type_parameters(one, &[five]);
        links.cache_infer_type_parameters(too_many, &[one; MAX_INFER_TYPE_PARAMETERS]);
        let cached = |ty| links.infer_type_parameters(ty).map(|it| it.to_vec());
        assert_eq!(cached(none), Some(vec![]));
        assert_eq!(cached(one), Some(vec![five]));
        assert_eq!(cached(five), Some(types.to_vec()));
        assert_eq!(cached(too_many), None);
        assert_eq!(cached(not_requested), None);
        let most = [one; MAX_INFER_TYPE_PARAMETERS - 1];
        links.cache_infer_type_parameters(not_requested, &most);
        let cached = links.infer_type_parameters(not_requested);
        assert_eq!(cached.map(|it| it.to_vec()), Some(most.to_vec()));
    }

    #[test]
    fn aliases() {
        let symbol = |id| Sym {
            file: FileId(1),
            id: SymbolId(id),
        };
        let types = [1, 2, LOCAL, LOCAL | 1, LOCAL | 2].map(TypeId);
        let [without, none, one, five, not_requested] = types;
        let links = TypeLinks::default();
        assert_eq!(links.alias_symbol(without), None);
        links.cache_alias_symbol(without, None);
        for (at, ty) in [none, one, five, not_requested].into_iter().enumerate() {
            links.cache_alias_symbol(ty, Some(symbol(at as u32)));
        }
        links.cache_alias_type_arguments(five, &types);
        links.cache_alias_type_arguments(none, &[]);
        links.cache_alias_type_arguments(one, &[five]);
        links.cache_alias_type_arguments(without, &[five]);
        assert_eq!(links.alias_symbol(without), Some(None));
        assert_eq!(links.alias_symbol(five), Some(Some(symbol(2))));
        assert_eq!(links.alias_symbol(TypeId(3)), None);
        let type_arguments = |ty| links.alias_type_arguments(ty).map(|it| it.to_vec());
        assert_eq!(type_arguments(without), None);
        assert_eq!(type_arguments(none), Some(vec![]));
        assert_eq!(type_arguments(one), Some(vec![five]));
        assert_eq!(type_arguments(five), Some(types.to_vec()));
        assert_eq!(type_arguments(not_requested), None);
        assert_eq!(type_arguments(TypeId(3)), None);
    }
}
