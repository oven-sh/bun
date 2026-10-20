//! Caches the parts of a type that tsgo stores in fields of the type and assigns on first use:
//! `ConditionalType.checkType`, `extendsType`, `resolvedTrueType` and `resolvedFalseType`, `MappedType.constraintType`
//! and `resolvedApparentType`, and `Type.alias`. Also caches the restrictive and permissive instantiations, which tsgo
//! stores per type in `cachedTypes`.
//!
//! In this checker a conditional or mapped type is a type node plus a mapper. Deriving a part means looking up the type
//! of a node and instantiating it. `TypeLinks` caches the derived part per type, so the next read is a single load.
//!
//! A part is cached only when deriving it again would compute nothing and return the same value for the rest of the
//! task. Skipping the derivation is then unobservable, except for the two effects described at the end. The rules:
//! - The cache belongs to one checker, and so to one task. Other tasks can't see it, and none of its ids outlive the
//!   task. A task publishes the same things with and without it.
//! - An alias only needs interning, so it's cached immediately. It depends only on the type's interning key and the
//!   program.
//! - Any other part is `instantiate(declared, mapper)`. It's cached if both steps read a final entry (`derive_part`):
//!   - `declared` is in a table, and no computation in progress will overwrite it. If a type node is in progress
//!     several times, the outermost evaluation stores last (`is_type_node_settled`).
//!   - The result is in `Program::instantiations`. `instantiate_cached` only stores a result there if it was computed
//!     without a cycle, a limit, or a rejection. Also, no instantiation with `mapper` is in progress, because the outer
//!     of two instantiations with the same key stores last (`is_mapper_idle`).
//! - A part derived from other parts is cached only if all of them are. See `TypeLinks::uncached_derivations`.
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

#[derive(Copy, Clone, Debug)]
pub(super) enum MappedPart {
    ConstraintType,
    ApparentType,
}

/// Kind of type that a row of `TypeLinks::parts` describes.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(super) enum Kind {
    Conditional,
    Mapped,
}

/// Number of cells in a row. A conditional type uses all of them.
const PARTS: usize = 4;

/// `restrictiveMapper`, `permissiveMapper` and `uniqueLiteralMapper`, which are the same for every type.
#[derive(Copy, Clone, Debug)]
pub(super) enum FixedMapper {
    Restrictive,
    Permissive,
    UniqueLiteral,
}

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

#[derive(Default)]
struct Aliases {
    /// 0 if the alias hasn't been requested, 1 if the type has no alias, otherwise 2 + the index in `cached`.
    of: ByType,
    cached: Vec<Sym>,
}

/// See the module docs.
#[derive(Default)]
pub(super) struct TypeLinks {
    /// 0 if nothing is cached for the type. Otherwise (1 + the index of its row in `parts`) * 2 + its `Kind`.
    rows: ByType,
    /// Each cell is a `Packed` value, or 0 if it's empty. A conditional type's cells are indexed by the `which`
    /// argument of `cond_piece`, a mapped type's by `MappedPart`.
    parts: Vec<[u32; PARTS]>,
    /// 0 if nothing is cached for the type. Otherwise 1 + the index of its row in `with_fixed_mappers`.
    fixed_mapper_rows: ByType,
    /// `cachedTypes[CachedTypeKindRestrictiveInstantiation]`, `cachedTypes[CachedTypeKindPermissiveInstantiation]` and
    /// `uniqueLiteralFilledInstantiation`, indexed by `FixedMapper`. Each cell is a `Packed` type, or 0 if it's empty.
    with_fixed_mappers: Vec<[u32; 3]>,
    /// Number of `forget_restrictive_instantiations` calls.
    restrictive_resets: u32,
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
            fixed_mapper_rows,
            with_fixed_mappers,
            restrictive_resets,
            uncached_derivations,
            has_found_circular_mapped_constraint,
            aliases,
        } = self;
        let Aliases { of, cached } = aliases.get_mut();
        rows.clear();
        parts.clear();
        fixed_mapper_rows.clear();
        with_fixed_mappers.clear();
        (*restrictive_resets, *uncached_derivations) = (0, 0);
        *has_found_circular_mapped_constraint = false;
        of.clear();
        cached.clear();
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
        self.restrictive_resets = self.restrictive_resets.wrapping_add(1);
    }

    /// Returns the number of `forget_restrictive_instantiations` calls. An instantiation that was in progress during a
    /// call isn't cached either.
    #[inline]
    pub(super) fn restrictive_resets(&self) -> u32 {
        self.restrictive_resets
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
            at => Some(Some(aliases.cached[at as usize - 2])),
        }
    }

    pub(super) fn cache_alias_symbol(&self, ty: TypeId, alias: Option<Sym>) {
        let aliases = &mut *self.aliases.borrow_mut();
        let Some(symbol) = alias else {
            return aliases.of.set(ty, 1);
        };
        aliases.cached.push(symbol);
        aliases.of.set(ty, aliases.cached.len() as u32 + 1);
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
    use super::{ByType, FixedMapper, Kind, MappedPart, PAGE, PARTS, TypeLinks};
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
        }
        links.forget_restrictive_instantiations();
        links.note_uncached_derivation();
        links.note_circular_mapped_constraint();
        links.clear();
        for ty in types {
            assert_eq!(links.cell(ty, Kind::Mapped, 0), 0);
            assert_eq!(links.with_fixed_mapper(FixedMapper::Permissive, ty), 0);
            assert_eq!(links.alias_symbol(ty), None);
        }
        assert_eq!(
            (links.restrictive_resets, links.uncached_derivations),
            (0, 0)
        );
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
        let last = MappedPart::ApparentType as usize;
        links.set_cell(mapped, Kind::Mapped, last, 50, Stored::new());
        links.set_cell(conditional, Kind::Conditional, 0, 60, Stored::new());
        let row = |ty, kind| [0, 1, 2, 3].map(|at| links.cell(ty, kind, at));
        assert_eq!(row(conditional, Kind::Conditional), [60, 0, 40, 0]);
        assert_eq!(row(conditional, Kind::Mapped), [0; PARTS]);
        assert_eq!(row(mapped, Kind::Mapped), [0, 50, 0, 0]);
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
        assert_eq!(links.alias_symbol(without), Some(None));
        assert_eq!(links.alias_symbol(five), Some(Some(symbol(2))));
        assert_eq!(links.alias_symbol(TypeId(3)), None);
    }
}
