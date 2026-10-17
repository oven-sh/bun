//! The parts of a type that tsgo keeps in fields of the type and assigns when they are first asked for:
//! `ConditionalType.checkType`, `extendsType`, `resolvedTrueType`, `resolvedFalseType` and `resolvedDefaultConstraint`,
//! `ConditionalRoot.inferTypeParameters`, `MappedType.typeParameter`, `mapper`, `constraintType`, `templateType`, `nameType`,
//! `modifiersType` and `resolvedApparentType`, and `Type.alias`. And what it keeps by type in `cachedTypes`: the restrictive
//! and the permissive instantiation.
//!
//! Here a conditional or a mapped type is a type node and a mapper, and a part is derived from them each time: the type of
//! a node is looked up and instantiated. `TypeLinks` keeps what was derived, by type, so that the next read is a load.
//!
//! The rule: a part is kept once deriving it again computes nothing and gives the same, for as long as the task runs. Then
//! not deriving it is not observable, but for the two things at the end.
//! - All of this belongs to one checker, and so to one task. No other task sees it, nothing of it goes to a barrier, and no
//!   id in it outlives the task. What a task publishes is what it published before.
//! - A part that takes no more than interning is a function of the interning key of the type and of the program: the type
//!   parameter and the mapper of a mapped type, an alias. It is kept at once.
//! - Any other part is `instantiate(declared, mapper)`, and is kept if both steps read an entry that stays (`derive_part`):
//!   - `declared` is in a table, and nothing in progress is going to store another one. Of a type node that is in progress
//!     several times, the outermost stores last (`is_type_node_settled`).
//!   - The result is in `Program::instantiations`, which has the rule of `instantiate_cached`: no cycle, no limit and no
//!     refusal on the way. And no instantiation with `mapper` is in progress: of two with one key, the outer one stores
//!     last (`is_mapper_idle`).
//! - A part that is derived from other parts is kept if each of those is: `TypeLinks::left_open`.
//! - A part whose derivation makes an inference is kept by the rules for leaving out a walk of an inference: it began with
//!   no `obstacle_to_leaving_out` and where `is_settled_for_inference`, and left nothing that the next derivation would
//!   leave again (`derive_with_inference`). It is read where there is no `obstacle_to_leaving_out`.
//! - Nothing is read while `index_infos_in_instantiation` is not empty: `instantiate` then reads no older result either.
//!
//! What a read of a kept part leaves out is what `instantiate` does before it looks anything up: it adds to
//! `instantiation_count`, and at a limit it reports 2589 and returns the error type. tsgo loads the field and does neither.

use super::*;
use crate::table::{Id, Packed};
use smallvec::SmallVec;
use std::cell::RefCell;
use std::sync::atomic::AtomicU32;

/// `false`: `cond_piece`, `cond_infer_params` and `default_constraint_of_conditional` derive the part each time, as before.
pub(super) const KEEPS_CONDITIONAL_PARTS: bool = true;
/// The same for `mapped_type_param`, `mapped_mapper`, `mapped_keys`, `mapped_template`, `mapped_name_type`,
/// `mapped_modifiers_type` and `apparent_type_of_mapped`.
pub(super) const KEEPS_MAPPED_PARTS: bool = true;
/// The same for `alias_of_type`. `alias_symbol_of_type` then keeps its results in `Checker::alias_symbols`, as before.
pub(super) const KEEPS_ALIASES: bool = true;
/// The same for `restrictive_instantiation`, `permissive_instantiation` and `unique_literal_filled_instantiation`.
pub(super) const KEEPS_INSTANTIATIONS_WITH_FIXED_MAPPERS: bool = true;

/// Every part that is read from here is derived as well. It is a panic that names the type and the file if that gives
/// another one, or if it computes anything. For debugging.
pub(super) const CHECKS_CONDITIONAL_PARTS: bool = false;
pub(super) const CHECKS_MAPPED_PARTS: bool = false;
pub(super) const CHECKS_ALIASES: bool = false;
pub(super) const CHECKS_INSTANTIATIONS_WITH_FIXED_MAPPERS: bool = false;

/// `Type.alias.typeArguments`
pub(super) type AliasArguments = SmallVec<[TypeId; 4]>;

/// The names of the parts of a conditional type, by the `which` of `cond_piece`.
pub(super) const CONDITIONAL_PARTS: [&str; 4] = [
    "checkType",
    "extendsType",
    "resolvedTrueType",
    "resolvedFalseType",
];

/// The cell of a conditional type for `resolvedDefaultConstraint`, after those of `cond_piece`.
pub(super) const DEFAULT_CONSTRAINT: usize = 4;
/// The one for `root.inferTypeParameters`: 1 + where they are in `TypeLinks::infer_type_parameters`, the start times
/// `MOST_INFER_TYPE_PARAMETERS` plus the length.
const INFER_TYPE_PARAMETERS: usize = 5;
/// A longer list is not kept.
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

/// The kind of type that a row of `TypeLinks::parts` is about.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(super) enum Kind {
    Conditional,
    Mapped,
}

/// The cells of a row: as many as there are `MappedPart`s.
const PARTS: usize = 7;

/// `restrictiveMapper`, `permissiveMapper` and `uniqueLiteralMapper`: the mappers that are the same for every type.
#[derive(Copy, Clone, Debug)]
pub(super) enum FixedMapper {
    Restrictive,
    Permissive,
    UniqueLiteral,
}

/// A part whose derivation makes an inference is kept if that took no more of the native stack than this, and is read where
/// as much is left. So no `is_stack_low` of the derivation that is left out would have cut it short.
const STACK_OF_KEPT_PART: usize = 64 << 10;

/// How many published types share a page of `ByType`.
const PAGE: usize = 128;

/// A number for each type, 0 until one is set.
#[derive(Default)]
pub(super) struct ByType {
    /// By the index of a type of the task.
    own: Vec<u32>,
    /// By the number of a published type divided by `PAGE`: 1 + the index of its page. 0: no number of the page is set. A
    /// task asks about few of the published types.
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
    /// Where its type arguments are in `Aliases::type_arguments`. `u32::MAX`: nothing has asked for them.
    start: u32,
    len: u32,
}

#[derive(Default)]
struct Aliases {
    /// 0: nothing has asked. 1: the type has no alias. Otherwise 2 + the index in `kept`.
    of: ByType,
    kept: Vec<KeptAlias>,
    type_arguments: Vec<TypeId>,
}

/// See the top of the file.
#[derive(Default)]
pub(super) struct TypeLinks {
    /// 0: nothing is kept for the type. Otherwise 1 + the index of its row in `parts`, times two, plus its `Kind`.
    rows: ByType,
    /// A `Packed` value in each cell, 0 for none. Of a conditional type by the `which` of `cond_piece`, of a mapped type
    /// by `MappedPart`.
    parts: Vec<[u32; PARTS]>,
    /// See `INFER_TYPE_PARAMETERS`.
    infer_type_parameters: Vec<TypeId>,
    /// 0: nothing is kept for the type. Otherwise 1 + the index of its row in `with_fixed_mappers`.
    fixed_mapper_rows: ByType,
    /// `cachedTypes[CachedTypeKindRestrictiveInstantiation]`, `cachedTypes[CachedTypeKindPermissiveInstantiation]` and
    /// `uniqueLiteralFilledInstantiation`, by `FixedMapper`: a `Packed` type, 0 for none.
    with_fixed_mappers: Vec<[u32; 3]>,
    /// The calls of `forget_restrictive_instantiations`.
    times_forgotten: u32,
    /// How many times a part was derived and not kept. A part that is derived from other parts is not kept if it moves.
    left_open: u64,
    /// The task has added to `Program::circular_mapped_constraints`. See `Checker::mapped_keys`.
    has_found_circular_mapped_constraint: bool,
    /// They are asked for under `&Checker`.
    aliases: RefCell<Aliases>,
}

impl TypeLinks {
    /// 0: it is not kept.
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

    /// A part was derived outside `Checker::derive_settled`, so nobody knows whether it stays.
    #[inline]
    pub(super) fn note_left_open(&mut self) {
        self.left_open += 1;
    }

    /// `root.inferTypeParameters` of the conditional type `ty`, if `keep_infer_type_parameters` has kept them.
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

    /// They take no more than interning.
    pub(super) fn keep_infer_type_parameters(&mut self, ty: TypeId, parameters: &[TypeId]) {
        // Nothing is added for an empty list, which most are.
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

    /// 0: it is not kept.
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

    /// `getUniqueTypeParameters` has made type parameters whose constraints nothing has asked for, under ids that it may
    /// have used before. `getRestrictiveTypeParameter` leaves such a type parameter as it is.
    pub(super) fn forget_restrictive_instantiations(&mut self) {
        for row in &mut self.with_fixed_mappers {
            row[FixedMapper::Restrictive as usize] = 0;
        }
        self.times_forgotten = self.times_forgotten.wrapping_add(1);
    }

    /// One that was being made at the time is not kept either.
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

    /// `t.alias.symbol`. `None`: nothing has asked yet.
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

    /// `t.alias.typeArguments`, if `keep_alias_type_arguments` has been called.
    #[inline]
    pub(super) fn alias_type_arguments(&self, ty: TypeId) -> Option<AliasArguments> {
        let aliases = self.aliases.borrow();
        let at = (aliases.of.get(ty) as usize).checked_sub(2)?;
        let kept = aliases.kept.get(at)?;
        let (start, len) = (kept.start as usize, kept.len as usize);
        let type_arguments = aliases.type_arguments.get(start..start + len)?;
        Some(SmallVec::from_slice(type_arguments))
    }

    /// After `keep_alias_symbol`, with a symbol.
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

/// A part, for the message of a `CHECKS_*` switch.
pub(super) trait Described: Copy + PartialEq {
    fn described(self, c: &mut Checker<'_, '_>) -> String;
}

impl Described for TypeId {
    fn described(self, c: &mut Checker<'_, '_>) -> String {
        let printed = c.type_to_string(self);
        format!("{self:?} `{}`", bstr::BStr::new(&printed))
    }
}

impl Described for Option<TypeId> {
    fn described(self, c: &mut Checker<'_, '_>) -> String {
        match self {
            Some(ty) => ty.described(c),
            None => "none".to_owned(),
        }
    }
}

impl Described for MapperId {
    fn described(self, c: &mut Checker<'_, '_>) -> String {
        format!("{self:?} {:?}", c.types().mapping(self))
    }
}

impl<'p, 's> Checker<'p, 's> {
    /// The part of `ty` in the cell `at`, if it is kept and may be read now.
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

    /// Keeps a part that takes no more than interning.
    pub(super) fn keep_interned_part<V: Packed<Cell = AtomicU32>>(
        &mut self,
        ty: TypeId,
        kind: Kind,
        at: usize,
        part: V,
    ) {
        (self.links).keep(ty, kind, at, part.pack(), Stored::new());
    }

    /// Keeps a part that `derive_settled` has returned with the permission.
    pub(super) fn keep_part<V: Packed<Cell = AtomicU32>>(
        &mut self,
        (ty, kind, at): (TypeId, Kind, usize),
        part: V,
        stored: Stored,
    ) {
        self.links.keep(ty, kind, at, part.pack(), stored);
    }

    /// The part of `ty` for the cell `at`, from `derive`. Keeps it if the rule at the top of the file allows.
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

    /// What `derive` returns, and the permission to keep it if the rule at the top of the file allows.
    /// `is_settled`: whether the entries that `derive` has read stay (`is_type_node_settled`, `is_mapper_idle`). It is asked
    /// afterwards, and nothing is asked before: `derive` creates what it creates in the order in which it always has.
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

    /// `derive`, which makes an inference, and whether it has left nothing for a caller to notice but what
    /// `derive_settled` looks at: no mark on the variance that is being measured, which a hit in `Program::relations`
    /// leaves each time, nothing that depends on the comparisons or the variance computations in progress, and no more
    /// than `STACK_OF_KEPT_PART` in use.
    pub(super) fn derive_with_inference<V>(
        &mut self,
        derive: impl FnOnce(&mut Self) -> V,
    ) -> (V, bool) {
        let traces = |c: &Self| {
            (
                c.variance_cycles,
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

    /// `instantiateType(ty, mapper)` for one of the mappers that are the same for every type, if it is kept and may be
    /// read now.
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

    /// Whether no `instantiate_cached` with `mapper` is in progress, which would store its result over the entry that an
    /// instantiation with `mapper` has just read or stored.
    #[inline]
    pub(super) fn is_mapper_idle(&self, mapper: MapperId) -> bool {
        !self.active_mappers.is_active(mapper)
    }

    /// Whether `type_from_node` reads the type of `node` from `Program::type_node_types`, and from an entry that stays.
    pub(super) fn is_type_node_settled(&self, file: FileId, node: TypeNodeId) -> bool {
        let q = Query::TypeNode(file, node);
        (self.p.type_node_types.get(&self.task, &(file, node))).is_some()
            && !(self.may_be_in_flight(q) && self.stack.contains(&q))
    }

    /// Under a `CHECKS_*` switch: `kept` was read as the part `name` of `ty`, and `derive` is the long way.
    #[cold]
    #[inline(never)]
    pub(super) fn check_kept_part<V: Described>(
        &mut self,
        ty: TypeId,
        name: &str,
        kept: V,
        derive: impl FnOnce(&mut Self) -> V,
    ) {
        // There, or a few levels further in, the long way fails and reports it.
        if self.instantiation_depth >= 90 || self.instantiation_count >= 4_900_000 {
            return;
        }
        let traces = |c: &Self| {
            (
                c.work,
                c.instantiations_computed,
                c.types().first_new_type_id(),
                c.non_cacheable_mark(),
                c.reported.len(),
            )
        };
        let (before, count) = (traces(self), self.instantiation_count);
        let derived = derive(self);
        self.instantiation_count = count;
        let computed_nothing = traces(self) == before;
        if derived != kept || !computed_nothing {
            let (kept, derived) = (kept.described(self), derived.described(self));
            let of = ty.described(self);
            let found = format!("derived {derived}, computing nothing: {computed_nothing}");
            self.kept_part_differs(ty, &format!("{name} of {of}"), &kept, &found);
        }
    }

    /// Under a `CHECKS_*` switch: the long way has `found` something else than `kept`, which is `what` of `ty`.
    #[cold]
    #[inline(never)]
    pub(super) fn kept_part_differs(&self, ty: TypeId, what: &str, kept: &str, found: &str) -> ! {
        let file =
            (self.task.file).map(|file| bstr::BStr::new(self.files().module(file).file_name()));
        let data = self.data(ty);
        panic!("{what} ({data:?}), while checking {file:?}: kept {kept}, {found}")
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
        // Only the pages that have a number.
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
