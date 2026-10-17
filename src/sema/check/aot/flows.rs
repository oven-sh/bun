use bun_threading::{Condvar, Guarded, RwLock};
use crate::aot_rules::Rule;
use crate::atom::{Atom, known};
use crate::bind::{AccessKind, Decl, Flow, FnOwner, MemberOwner, Parent, PatParent, SymFlags, SymbolId};
use crate::check::{Checker, ContextFlags, Program};
use crate::check::relate::Relation;
use crate::check::task::Finished;
use super::identity::Identity;
use super::type_flags;
use super::type_caches::{NestedPairs, TypeCaches, is_published};
use super::callees::Callee;
use super::subtypes::{self, MutatedTypes, Cause, Facts, FieldTypes, Gathered, LoggingRelaxation, Sizes, Subtypes};
use super::creation::Creations;
use super::mutations::{Mutation, CountedRedefinitions, NUMBER_OF_OPERANDS, UntypedMutations, WidestMutations};
use super::escape_closure::{Escapes, TypeParameter};
use super::first_stores::Constructions;
use super::storage::FreshGraph;
use crate::hir::{BinOp, Chain, ClassId, ExprId, ExprKind, ExprTag, FileKind, FnId, MappedModifier, MemberKind, PatKind, PropKey, PropKind, TypeNodeId, TypeNodeKind, UnOp};
use crate::program::{FileId, Sym};
use crate::types::{ComponentsId, EnumValue, Follow, Intrinsic, MapperId, Origin, Prop, PropFlags, PropSource, Shape, SigId, TypeData, TypeId, Visitor};
use crate::util::{Barrier, FxHashMap, FxHashSet};
use std::hash::Hash;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, OnceLock};

const ENGINE_CLASSES: [&[u8]; 23] = [
    b"Map",
    b"Set",
    b"WeakMap",
    b"WeakSet",
    b"Promise",
    b"Date",
    b"RegExp",
    b"Error",
    b"DataView",
    b"ArrayBuffer",
    b"SharedArrayBuffer",
    b"Int8Array",
    b"Uint8Array",
    b"Uint8ClampedArray",
    b"Int16Array",
    b"Uint16Array",
    b"Int32Array",
    b"Uint32Array",
    b"Float16Array",
    b"Float32Array",
    b"Float64Array",
    b"BigInt64Array",
    b"BigUint64Array",
];

const MAX_NESTED_APPLICATIONS: u32 = 8;
const MAX_FAMILY_SIZE: u64 = 4096;
const MIN_DEPTH_OF_LARGE_FAMILY: u32 = 4;
const PRIMITIVES: [TypeId; 5] = [TypeId::STRING, TypeId::NUMBER, TypeId::BOOLEAN, TypeId::BIGINT, TypeId::SYMBOL];

const MAX_INSTANTIATIONS_INSPECTED: u32 = 8;

const MAX_INSTANTIATIONS_INSPECTED_IN_TOTAL: u32 = 2048;

const MAX_LEVELS_INSPECTED: u32 = 256;

const MAX_IN_PLACE_CONVERSION_PROPERTIES: usize = 6;

const MAX_BOUNDARY_TYPES_PER_SITE: u32 = 1 << 16;

pub struct TruncatedSearch {
    rank: (u8, u32, u32),
    pub typed_side: FileId,
    pub name: String,
    pub place: String,
}

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub struct Place {
    pub file: FileId,
    pub pos: u32,
}

impl Place {
    const NOWHERE: Place = Place { file: FileId(u32::MAX), pos: 0 };
}

impl Default for Place {
    fn default() -> Place {
        Place::NOWHERE
    }
}

struct NotedTables<T = TypeId> {
    allocated_at_site: FxHashSet<T>,
    copied_into: FxHashSet<T>,
    upcasts: FxHashMap<(T, T), Place>,
    casts: FxHashSet<(T, T)>,
    guards: FxHashSet<(T, T)>,
    forced: FxHashSet<(T, T)>,
    unverified_overload_results: FxHashSet<(T, T)>,
    tests: FxHashSet<(T, T)>,
    trusted_into: FxHashMap<T, Place>,
    foreign: FxHashMap<T, (Option<T>, Place)>,
    untyped_into: FxHashMap<T, Place>,
    untyped_into_both: FxHashSet<(T, T)>,
    stored_read_only: FxHashSet<(T, T)>,
    read_only_passed_on: FxHashSet<T>,
    any_into: FxHashMap<T, Place>,
    checked_into: FxHashMap<T, Place>,
    checked_by_path: [usize; 7],
    without_fixed_layout: FxHashSet<T>,
    truncated: FxHashMap<Place, [u32; 4]>,
    max_inspected: [u32; 3],
    callees_at_creation: FxHashMap<(T, Atom), Callee>,
    callees_stored: FxHashMap<(T, Atom), Callee>,
    creations: Creations<T>,
    constructions: Constructions<T>,
    escapes: Escapes<T>,
}

fn join_callee<K: Eq + Hash>(callees: &mut FxHashMap<K, Callee>, place: K, callee: Callee) {
    let joined = callees.entry(place).or_default();
    *joined = joined.join(callee);
}

impl<T> Default for NotedTables<T> {
    fn default() -> NotedTables<T> {
        NotedTables {
            allocated_at_site: FxHashSet::default(),
            copied_into: FxHashSet::default(),
            upcasts: FxHashMap::default(),
            casts: FxHashSet::default(),
            guards: FxHashSet::default(),
            forced: FxHashSet::default(),
            unverified_overload_results: FxHashSet::default(),
            tests: FxHashSet::default(),
            trusted_into: FxHashMap::default(),
            foreign: FxHashMap::default(),
            untyped_into: FxHashMap::default(),
            untyped_into_both: FxHashSet::default(),
            stored_read_only: FxHashSet::default(),
            read_only_passed_on: FxHashSet::default(),
            any_into: FxHashMap::default(),
            checked_into: FxHashMap::default(),
            checked_by_path: [0; 7],
            without_fixed_layout: FxHashSet::default(),
            truncated: FxHashMap::default(),
            max_inspected: [0; 3],
            callees_at_creation: FxHashMap::default(),
            callees_stored: FxHashMap::default(),
            creations: Creations::default(),
            constructions: Constructions::default(),
            escapes: Escapes::default(),
        }
    }
}

impl<T: Copy + Eq + Hash> NotedTables<T> {
    fn untyped_object_evidence(&self) -> (Vec<T>, Vec<T>, Vec<T>) {
        self.escapes.with_mutations(|recorded| (recorded.escaped(), recorded.receiving_untyped(), recorded.receiving_untyped_if_escaped()))
    }

    fn absorb(&mut self, other: NotedTables<T>) {
        self.allocated_at_site.extend(other.allocated_at_site);
        self.copied_into.extend(other.copied_into);
        self.casts.extend(other.casts);
        self.guards.extend(other.guards);
        self.untyped_into_both.extend(other.untyped_into_both);
        self.stored_read_only.extend(other.stored_read_only);
        self.read_only_passed_on.extend(other.read_only_passed_on);
        self.forced.extend(other.forced);
        self.unverified_overload_results.extend(other.unverified_overload_results);
        self.tests.extend(other.tests);
        self.without_fixed_layout.extend(other.without_fixed_layout);
        for (at, times) in other.truncated {
            for (sum, more) in self.truncated.entry(at).or_default().iter_mut().zip(times) {
                *sum += more;
            }
        }
        for (maximum, other) in self.max_inspected.iter_mut().zip(other.max_inspected) {
            *maximum = (*maximum).max(other);
        }
        self.creations.absorb(other.creations);
        self.constructions.absorb(other.constructions);
        self.escapes.absorb(other.escapes);
        for (upcast, at) in other.upcasts {
            self.add_upcast(upcast, at);
        }
        for (view, (source, at)) in other.foreign {
            self.add_untyped(view, source, at);
        }
        for (view, at) in other.checked_into {
            self.add_check(view, at);
        }
        for (sum, more) in self.checked_by_path.iter_mut().zip(other.checked_by_path) {
            *sum += more;
        }
        for (view, at) in other.untyped_into {
            self.add_untyped_inflow(view, at);
        }
        for (view, at) in other.any_into {
            self.add_any_inflow(view, at);
        }
        for (view, at) in other.trusted_into {
            self.add_trusted_inflow(view, at);
        }
        for (field, callee) in other.callees_at_creation {
            join_callee(&mut self.callees_at_creation, field, callee);
        }
        for (field, callee) in other.callees_stored {
            join_callee(&mut self.callees_stored, field, callee);
        }
    }

    fn add_upcast(&mut self, upcast: (T, T), at: Place) {
        let first = self.upcasts.entry(upcast).or_insert(at);
        *first = at.min(*first);
    }

    fn add_untyped(&mut self, view: T, source: Option<T>, at: Place) {
        let first = self.foreign.entry(view).or_insert((source, at));
        if at < first.1 {
            *first = (source, at);
        }
    }

    fn add_check(&mut self, view: T, at: Place) {
        let first = self.checked_into.entry(view).or_insert(at);
        *first = at.min(*first);
    }

    fn add_untyped_inflow(&mut self, view: T, at: Place) {
        let first = self.untyped_into.entry(view).or_insert(at);
        *first = at.min(*first);
    }

    fn add_any_inflow(&mut self, view: T, at: Place) {
        let first = self.any_into.entry(view).or_insert(at);
        *first = at.min(*first);
    }

    fn add_trusted_inflow(&mut self, view: T, at: Place) {
        let first = self.trusted_into.entry(view).or_insert(at);
        *first = at.min(*first);
    }

    fn absorb_others(&mut self, others: OtherNotes<T>) {
        for (sum, more) in self.checked_by_path.iter_mut().zip(others.checked_by_path) {
            *sum += more;
        }
        for (field, callee) in others.callees_at_creation {
            join_callee(&mut self.callees_at_creation, field, callee);
        }
        for (field, callee) in others.callees_stored {
            join_callee(&mut self.callees_stored, field, callee);
        }
        self.creations.absorb(others.creations);
        self.constructions.absorb(others.constructions);
    }

    fn add_note(&mut self, note: Note<T>) {
        let Note { kind, has_second, first, second, at } = note;
        match kind {
            NoteKind::AllocatedAtSite => {
                self.allocated_at_site.insert(first);
            }
            NoteKind::CopiedInto => {
                self.copied_into.insert(first);
            }
            NoteKind::NoFixedLayout => {
                self.without_fixed_layout.insert(first);
            }
            NoteKind::Cast => {
                self.casts.insert((first, second));
            }
            NoteKind::Guard => {
                self.guards.insert((first, second));
            }
            NoteKind::Forced => {
                self.forced.insert((first, second));
            }
            NoteKind::UnverifiedOverloadResult => {
                self.unverified_overload_results.insert((first, second));
            }
            NoteKind::Test => {
                self.tests.insert((first, second));
            }
            NoteKind::Upcast => self.add_upcast((first, second), at),
            NoteKind::TrustedInto => self.add_trusted_inflow(first, at),
            NoteKind::UntypedInto => self.add_untyped_inflow(first, at),
            NoteKind::UntypedIntoBoth => {
                self.untyped_into_both.insert((first, second));
            }
            NoteKind::StoredReadOnly => {
                self.stored_read_only.insert((first, second));
            }
            NoteKind::ReadOnlyPassedOn => {
                self.read_only_passed_on.insert(first);
            }
            NoteKind::AnyInto => self.add_any_inflow(first, at),
            NoteKind::CheckedInto => self.add_check(first, at),
            NoteKind::Foreign => self.add_untyped(first, has_second.then_some(second), at),
            NoteKind::EntersParameter
            | NoteKind::InstanceEscapes
            | NoteKind::InstanceReceivesUntyped
            | NoteKind::InstanceReceivesUntypedIfEscapes
            | NoteKind::TypeEscapes
            | NoteKind::FlowsIntoType
            | NoteKind::InstanceFlowsIntoTypes => self.escapes.mutations.get_or_insert_with(Default::default).add_note(kind, first, second, at),
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub(super) enum NoteKind {
    AllocatedAtSite,
    CopiedInto,
    NoFixedLayout,
    Cast,
    Guard,
    Forced,
    UnverifiedOverloadResult,
    Test,
    Upcast,
    TrustedInto,
    UntypedInto,
    UntypedIntoBoth,
    StoredReadOnly,
    ReadOnlyPassedOn,
    AnyInto,
    CheckedInto,
    Foreign,
    EntersParameter,
    InstanceEscapes,
    InstanceReceivesUntyped,
    InstanceReceivesUntypedIfEscapes,
    TypeEscapes,
    FlowsIntoType,
    InstanceFlowsIntoTypes,
}

impl NoteKind {
    fn keeps_first_site(self) -> bool {
        matches!(self, NoteKind::Upcast | NoteKind::TrustedInto | NoteKind::UntypedInto | NoteKind::AnyInto | NoteKind::CheckedInto)
    }
}

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub(super) enum ParameterNoteKind {
    Enters,
    Escaped,
    ReceivesUntyped,
    ReceivesUntypedIfEscapes,
    UntypedInflow,
    AnyInflow,
}

pub(super) type ParameterNote = (ParameterNoteKind, TypeParameter, TypeParameter);

#[derive(Copy, Clone)]
struct Note<T> {
    kind: NoteKind,
    has_second: bool,
    first: T,
    second: T,
    at: Place,
}

struct OtherNotes<T> {
    checked_by_path: [usize; 7],
    callees_at_creation: FxHashMap<(T, Atom), Callee>,
    callees_stored: FxHashMap<(T, Atom), Callee>,
    creations: Creations<T>,
    constructions: Constructions<T>,
}

impl<T> Default for OtherNotes<T> {
    fn default() -> OtherNotes<T> {
        OtherNotes { checked_by_path: [0; 7], callees_at_creation: FxHashMap::default(), callees_stored: FxHashMap::default(), creations: Creations::default(), constructions: Constructions::default() }
    }
}

impl<T: Copy + Eq + Hash> OtherNotes<T> {
    fn absorb(&mut self, other: OtherNotes<T>) {
        for (sum, more) in self.checked_by_path.iter_mut().zip(other.checked_by_path) {
            *sum += more;
        }
        for (field, callee) in other.callees_at_creation {
            join_callee(&mut self.callees_at_creation, field, callee);
        }
        for (field, callee) in other.callees_stored {
            join_callee(&mut self.callees_stored, field, callee);
        }
        self.creations.absorb(other.creations);
        self.constructions.absorb(other.constructions);
    }

    fn renamed<U: Copy + Eq + Hash>(self, rename: &mut impl FnMut(T) -> Option<U>) -> OtherNotes<U> {
        let mut of_fields = |callees: FxHashMap<(T, Atom), Callee>| -> FxHashMap<(U, Atom), Callee> {
            let mut renamed = FxHashMap::default();
            for ((holder, name), callee) in callees {
                if let Some(holder) = rename(holder) {
                    join_callee(&mut renamed, (holder, name), callee);
                }
            }
            renamed
        };
        let (callees_at_creation, callees_stored) = (of_fields(self.callees_at_creation), of_fields(self.callees_stored));
        let creations = self.creations.renamed(&mut *rename);
        let constructions = self.constructions.renamed(rename);
        OtherNotes { checked_by_path: self.checked_by_path, callees_at_creation, callees_stored, creations, constructions }
    }
}

pub struct FlowNotes<T = TypeId> {
    notes: Vec<Note<T>>,
    parameter_notes: Vec<ParameterNote>,
    truncated: FxHashMap<Place, [u32; 4]>,
    max_inspected: [u32; 3],
    others: Option<Box<OtherNotes<T>>>,
    escapes: Escapes<T>,
    absorbed: Option<Box<NotedTables<T>>>,
}

impl<T> Default for FlowNotes<T> {
    fn default() -> FlowNotes<T> {
        FlowNotes { notes: Vec::new(), parameter_notes: Vec::new(), truncated: FxHashMap::default(), max_inspected: [0; 3], others: None, escapes: Escapes::default(), absorbed: None }
    }
}

impl<T: Copy + Eq + Hash> FlowNotes<T> {
    pub fn has_mutations(&self) -> bool {
        self.escapes.mutations.is_some() || !self.parameter_notes.is_empty() || self.notes.last().is_some_and(|note| note.kind >= NoteKind::EntersParameter)
    }

    pub fn absorb_untyped_object_evidence(&mut self, other: &FlowNotes<T>) {
        let evidence = self.absorbed.get_or_insert_with(Default::default).escapes.mutations.get_or_insert_with(Default::default);
        for note in &other.notes[other.first_evidence()..] {
            evidence.add_note(note.kind, note.first, note.second, note.at);
        }
        for &note in other.parameter_notes.iter().filter(|note| note.0 <= ParameterNoteKind::ReceivesUntypedIfEscapes) {
            evidence.add_parameter_note(note);
        }
    }

    pub fn untyped_object_evidence(&self) -> (Vec<T>, Vec<T>, Vec<T>) {
        self.absorbed.as_ref().map_or_else(Default::default, |absorbed| absorbed.untyped_object_evidence())
    }

    pub fn absorb(&mut self, other: FlowNotes<T>) {
        other.add_to(self.absorbed.get_or_insert_with(Default::default));
    }

    fn first_evidence(&self) -> usize {
        self.notes.partition_point(|note| note.kind < NoteKind::EntersParameter)
    }

    pub fn append_taken(&mut self, mut other: FlowNotes<T>) {
        let (mine, theirs) = (self.first_evidence(), other.first_evidence());
        let (evidence, evidence_of_other) = (self.notes.split_off(mine), other.notes.split_off(theirs));
        self.notes.append(&mut other.notes);
        self.notes.extend(evidence);
        self.notes.extend(evidence_of_other);
        self.append(other);
    }

    pub fn append(&mut self, mut other: FlowNotes<T>) {
        self.notes.append(&mut other.notes);
        self.parameter_notes.append(&mut other.parameter_notes);
        for (at, times) in other.truncated {
            for (sum, more) in self.truncated.entry(at).or_default().iter_mut().zip(times) {
                *sum += more;
            }
        }
        for (maximum, other) in self.max_inspected.iter_mut().zip(other.max_inspected) {
            *maximum = (*maximum).max(other);
        }
        match (&mut self.others, other.others) {
            (Some(mine), Some(theirs)) => mine.absorb(*theirs),
            (mine, Some(theirs)) => *mine = Some(theirs),
            (_, None) => {}
        }
        self.escapes.absorb(other.escapes);
    }

    fn add_to(self, tables: &mut NotedTables<T>) {
        if let Some(absorbed) = self.absorbed {
            tables.absorb(*absorbed);
        }
        for note in self.notes {
            tables.add_note(note);
        }
        if !self.parameter_notes.is_empty() {
            let mutations = tables.escapes.mutations.get_or_insert_with(Default::default);
            for note in self.parameter_notes {
                mutations.add_parameter_note(note);
            }
        }
        for (at, times) in self.truncated {
            for (sum, more) in tables.truncated.entry(at).or_default().iter_mut().zip(times) {
                *sum += more;
            }
        }
        for (maximum, other) in tables.max_inspected.iter_mut().zip(self.max_inspected) {
            *maximum = (*maximum).max(other);
        }
        if let Some(others) = self.others {
            tables.absorb_others(*others);
        }
        tables.escapes.absorb(self.escapes);
    }

    fn into_tables(mut self) -> NotedTables<T> {
        let mut tables = self.absorbed.take().map_or_else(Default::default, |absorbed| *absorbed);
        self.add_to(&mut tables);
        tables
    }

    fn others(&mut self) -> &mut OtherNotes<T> {
        self.others.get_or_insert_with(Default::default)
    }

    fn add_at(&mut self, kind: NoteKind, first: T, at: Place) {
        self.notes.push(Note { kind, has_second: false, first, second: first, at });
    }

    fn add_pair_at(&mut self, kind: NoteKind, first: T, second: T, at: Place) {
        self.notes.push(Note { kind, has_second: true, first, second, at });
    }

    fn add_pairs_into(&mut self, kind: NoteKind, sources: &[T], target: T) {
        for &source in sources.iter().filter(|&&source| source != target) {
            self.add_pair_at(kind, source, target, Place::NOWHERE);
        }
    }

    pub(super) fn add_all(&mut self, kind: NoteKind, types: &[T]) {
        for &ty in types {
            self.add_at(kind, ty, Place::NOWHERE);
        }
    }

    pub(super) fn add_pair(&mut self, kind: NoteKind, first: T, second: T) {
        self.add_pair_at(kind, first, second, Place::NOWHERE);
    }

    pub(super) fn add_entering_parameter(&mut self, parameter: TypeParameter, types: &[T]) {
        for &ty in types {
            self.add_at(NoteKind::EntersParameter, ty, Place { file: parameter.0, pos: parameter.1.0 });
        }
    }

    pub(super) fn add_parameters(&mut self, kind: ParameterNoteKind, parameters: &[TypeParameter]) {
        self.parameter_notes.extend(parameters.iter().map(|&parameter| (kind, parameter, parameter)));
    }

    pub(super) fn add_parameter_pair(&mut self, kind: ParameterNoteKind, first: TypeParameter, second: TypeParameter) {
        self.parameter_notes.push((kind, first, second));
    }

    fn add_upcast(&mut self, upcast: (T, T), at: Place) {
        self.add_pair_at(NoteKind::Upcast, upcast.0, upcast.1, at);
    }

    fn add_untyped(&mut self, view: T, source: Option<T>, at: Place) {
        self.notes.push(Note { kind: NoteKind::Foreign, has_second: source.is_some(), first: view, second: source.unwrap_or(view), at });
    }

    fn add_check(&mut self, view: T, at: Place) {
        self.add_at(NoteKind::CheckedInto, view, at);
    }

    fn add_untyped_inflow(&mut self, view: T, at: Place) {
        self.add_at(NoteKind::UntypedInto, view, at);
    }

    fn add_any_inflow(&mut self, view: T, at: Place) {
        self.add_at(NoteKind::AnyInto, view, at);
    }

    fn add_trusted_inflow(&mut self, view: T, at: Place) {
        self.add_at(NoteKind::TrustedInto, view, at);
    }

    pub fn renamed<U: Copy + Eq + Hash>(self, mut rename: impl FnMut(T) -> Option<U>) -> FlowNotes<U> {
        let mut notes = Vec::with_capacity(self.notes.len());
        let mut last: Option<(T, Option<U>)> = None;
        for note in self.notes {
            let first = match last {
                Some((ty, renamed)) if ty == note.first => renamed,
                _ => {
                    let renamed = rename(note.first);
                    last = Some((note.first, renamed));
                    renamed
                }
            };
            let Some(first) = first else { continue };
            let second = if note.has_second { rename(note.second) } else { None };
            if note.has_second && second.is_none() && note.kind != NoteKind::Foreign {
                continue;
            }
            notes.push(Note { kind: note.kind, has_second: second.is_some(), first, second: second.unwrap_or(first), at: note.at });
        }
        let others = self.others.map(|others| Box::new(others.renamed(&mut rename)));
        let escapes = self.escapes.renamed(&mut rename);
        FlowNotes { notes, parameter_notes: self.parameter_notes, truncated: self.truncated, max_inspected: self.max_inspected, others, escapes, absorbed: None }
    }
}

impl FlowNotes<TypeId> {
    fn sort_and_deduplicate(&mut self) {
        self.notes.sort_by(|a, b| {
            let by_second = || if a.kind == NoteKind::Foreign { std::cmp::Ordering::Equal } else { a.second.0.cmp(&b.second.0) };
            (a.kind, a.first.0).cmp(&(b.kind, b.first.0)).then_with(by_second).then_with(|| a.at.cmp(&b.at))
        });
        self.notes.dedup_by(|later, earlier| {
            later.kind == earlier.kind && later.first == earlier.first && (later.kind == NoteKind::Foreign || later.second == earlier.second && (later.kind.keeps_first_site() || later.at == earlier.at))
        });
        self.parameter_notes.sort_unstable();
        self.parameter_notes.dedup();
    }

    fn position(&self) -> (usize, usize) {
        (self.notes.len(), self.parameter_notes.len())
    }

    fn notes_since(&self, position: (usize, usize)) -> FlowNotes {
        let mut since = FlowNotes { notes: self.notes[position.0..].to_vec(), parameter_notes: self.parameter_notes[position.1..].to_vec(), ..FlowNotes::default() };
        since.sort_and_deduplicate();
        since
    }

    fn repeat(&mut self, earlier: &FlowNotes, at: Place) {
        self.notes.extend(earlier.notes.iter().map(|note| Note { at: if note.kind.keeps_first_site() || note.kind == NoteKind::Foreign { at } else { note.at }, ..*note }));
        self.parameter_notes.extend_from_slice(&earlier.parameter_notes);
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Root {
    None,
    Array,
    Function,
    Claimed,
    Class(Sym),
}

pub enum BuiltIn {
    Function,
    Claimed,
    Instance(TypeId),
}

#[derive(Copy, Clone, PartialEq)]
pub enum Literal {
    String(Atom),
    Number(f64),
}

#[derive(Copy, Clone, PartialEq, Eq, Hash)]
pub(super) enum EscapeQuery {
    OfType(TypeId),
    IntoUntypedSlot(TypeId, Option<TypeId>),
    Entry(TypeId, Option<TypeId>),
    EscapingValues(TypeId, bool),
    UntypedIntoPlace(TypeId),
    ThroughGuardsOf(TypeId),
    UntypedIntoNestedClasses(TypeId, bool),
    NestedInflows(TypeId, bool),
}

impl EscapeQuery {
    fn is_local(self) -> bool {
        let is_local = |ty: TypeId| crate::local::is_local_number(ty.0);
        match self {
            EscapeQuery::OfType(ty) | EscapeQuery::EscapingValues(ty, _) | EscapeQuery::UntypedIntoPlace(ty) | EscapeQuery::ThroughGuardsOf(ty) | EscapeQuery::UntypedIntoNestedClasses(ty, _) | EscapeQuery::NestedInflows(ty, _) => is_local(ty),
            EscapeQuery::IntoUntypedSlot(own, target) | EscapeQuery::Entry(own, target) => is_local(own) || target.is_some_and(is_local),
        }
    }

    fn subject(self) -> TypeId {
        match self {
            EscapeQuery::OfType(ty) | EscapeQuery::EscapingValues(ty, _) | EscapeQuery::UntypedIntoPlace(ty) | EscapeQuery::ThroughGuardsOf(ty) | EscapeQuery::UntypedIntoNestedClasses(ty, _) | EscapeQuery::NestedInflows(ty, _) => ty,
            EscapeQuery::IntoUntypedSlot(own, _) | EscapeQuery::Entry(own, _) => own,
        }
    }

    fn shard(self) -> usize {
        use std::hash::BuildHasher;
        (crate::util::FxBuild.hash_one(self) >> 58) as usize
    }
}

type EscapeNotes = FxHashMap<EscapeQuery, Option<Arc<FlowNotes>>>;

struct ListsByType<K> {
    shards: Vec<RwLock<FxHashMap<K, Arc<[TypeId]>>>>,
}

impl<K> ListsByType<K> {
    fn take(&self) -> Vec<FxHashMap<K, Arc<[TypeId]>>> {
        self.shards.iter().map(|shard| std::mem::take(&mut *shard.write())).collect()
    }
}

impl<K> Default for ListsByType<K> {
    fn default() -> ListsByType<K> {
        ListsByType { shards: (0..64).map(|_| RwLock::new(FxHashMap::default())).collect() }
    }
}

impl<K: Copy + Eq + Hash> ListsByType<K> {
    fn shard(&self, key: K) -> &RwLock<FxHashMap<K, Arc<[TypeId]>>> {
        use std::hash::BuildHasher;
        &self.shards[(crate::util::FxBuild.hash_one(key) >> 58) as usize]
    }

    fn get(&self, key: K) -> Option<Arc<[TypeId]>> {
        self.shard(key).read().get(&key).cloned()
    }

    fn add(&self, key: K, list: &[TypeId]) {
        if !list.iter().any(|ty| crate::local::is_local_number(ty.0)) {
            self.shard(key).write().entry(key).or_insert_with(|| list.into());
        }
    }
}

#[derive(Default)]
pub(super) struct ListsSharedByTasks {
    nested_types_staying_untyped: ListsByType<(TypeId, bool)>,
    wide_data_records: ListsByType<TypeId>,
    records: ListsByType<TypeId>,
    nested_class_types: ListsByType<TypeId>,
}

pub(super) struct Shared {
    escape_notes: [Vec<RwLock<EscapeNotes>>; 2],
    lists: [ListsSharedByTasks; 2],
}

impl Shared {
    pub(super) fn release(&self) {
        let notes: Vec<EscapeNotes> = self.escape_notes.iter().flatten().map(|shard| std::mem::take(&mut *shard.write())).collect();
        let lists: Vec<_> = (self.lists.iter())
            .map(|lists| (lists.nested_types_staying_untyped.take(), lists.wide_data_records.take(), lists.records.take(), lists.nested_class_types.take()))
            .collect();
        let _ = std::thread::Builder::new().spawn(move || drop((notes, lists)));
    }
}

impl Default for Shared {
    fn default() -> Shared {
        Shared { escape_notes: [0, 1].map(|_| (0..64).map(|_| RwLock::new(EscapeNotes::default())).collect()), lists: Default::default() }
    }
}

#[derive(Default)]
pub(super) struct State {
    escape_notes: EscapeNotes,
    recorded: FlowNotes,
    seen_as: FxHashMap<(TypeId, TypeId), bool>,
    pub(super) truncated: FxHashSet<(TypeId, TypeId, u8)>,
    pub(super) provably_related: FxHashMap<(TypeId, TypeId, u8), bool>,
    derived_types: FxHashMap<(TypeId, DerivedTypeKind), TypeId>,
    pub(super) literal_contextual_types: FxHashMap<(FileId, ExprId), Option<TypeId>>,
    pub(super) unknown_count: usize,
    roots: FxHashMap<Sym, Root>,
    place: Place,
    visited_inflow_pairs: FxHashSet<(TypeId, TypeId)>,
    nested_untyped_inflow_sites: FxHashMap<TypeId, Place>,
    looked_into: FxHashMap<(Applied, Applied), [u32; 2]>,
    uninspected: FxHashSet<(TypeId, bool)>,
    levels_inspected: u32,
    conditional_type_depth: u32,
    ambient_type_param_mentions: FxHashMap<TypeId, bool>,
    cloned_type_params: FxHashMap<TypeId, std::rc::Rc<[TypeId]>>,
    erased_cloned_type_params: FxHashMap<TypeId, TypeId>,
    applications: FxHashMap<TypeId, Vec<(Applied, u32)>>,
    stored: Option<std::sync::Arc<Vec<u64>>>,
    canonical: FxHashMap<TypeId, TypeId>,
    layout_types_cache: FxHashMap<TypeId, TypeId>,
    first_with_structure: FxHashMap<Identity, TypeId>,
    structure_representatives_used: u32,
    accepts_untyped_values_cache: FxHashMap<TypeId, bool>,
    seen_before: Option<Arc<FxHashSet<Identity>>>,
    finding_canonical: u32,
    pub(super) without_primitives: FxHashMap<TypeId, std::rc::Rc<super::mutations::ObjectTypes>>,
    pub(super) carried: FxHashMap<(TypeId, TypeId), std::rc::Rc<[(TypeId, TypeId)]>>,
    pub(super) untyped_for_objects: FxHashMap<TypeId, bool>,
    pub(super) untyped_for_fields: FxHashMap<TypeId, bool>,
    untyped: FxHashMap<TypeId, bool>,
    type_primitives: FxHashMap<TypeId, Vec<TypeId>>,
    cast_into_dictionaries: FxHashMap<(TypeId, TypeId), std::rc::Rc<[(TypeId, TypeId)]>>,
    stored_property_types: FxHashMap<TypeId, std::rc::Rc<[(Atom, TypeId)]>>,
    stored_property_type: FxHashMap<(TypeId, Atom), Option<TypeId>>,
    pub(super) is_redefined_cache: FxHashMap<TypeId, bool>,
    element_and_call_types: FxHashMap<TypeId, ([Option<TypeId>; 2], [bool; 2])>,
    function_members_cache: FxHashMap<TypeId, std::rc::Rc<[(Atom, TypeId)]>>,
    tags: FxHashMap<TypeId, std::rc::Rc<[(Atom, Box<[u64]>)]>>,
    pub(super) accepts_primitives_cache: FxHashMap<TypeId, bool>,
    pub(super) value_bounds: FxHashMap<TypeId, TypeId>,
    pub(super) constraints_not_known: FxHashSet<TypeId>,
    pub(super) array_subtypes: FxHashMap<TypeId, bool>,
    pub(super) function_types: Option<[TypeId; 3]>,
    tainted: FxHashMap<TypeId, bool>,
    with_tainted_part: FxHashMap<TypeId, bool>,
    taint_query_depth: u32,
    is_searching_from_sources: bool,
    records_external_causes: bool,
    external_data_followed_from: Option<Place>,
    external_cause_round: u32,
    types_being_walked: Vec<Identity>,
    is_boundary_bounded: bool,
    boundary_types_at_site: u32,
    boundary_overflow: Option<TruncatedSearch>,
    records_reaching_javascript: Vec<(TypeId, Place)>,
    generated_from_checked_source: FxHashSet<FileId>,
    checked_sources: FxHashSet<FileId>,
    pairs_compared: FxHashSet<(TypeId, TypeId, bool)>,
    compared_again: FxHashSet<crate::check::relate::Key>,
    generic_callback_cache: FxHashMap<TypeId, bool>,
    reached_from_types: SccState,
    nested_types_staying_untyped: FxHashMap<(TypeId, bool), std::rc::Rc<[TypeId]>>,
    wide_data_records: FxHashMap<TypeId, Box<[TypeId]>>,
    records: FxHashMap<TypeId, Box<[TypeId]>>,
    nested_class_types: FxHashMap<TypeId, Box<[TypeId]>>,
    nested_class_types_by_depth: FxHashMap<(TypeId, u32), std::rc::Rc<[TypeId]>>,
    mapped_layout_types_in_progress: Vec<TypeId>,
    mapped_layout_cycles_cut: u32,
    untyped_type_guards: FxHashMap<TypeId, Box<[TypeId]>>,
    dictionaries: FxHashMap<TypeId, Box<[TypeId]>>,
    plain_data: FxHashMap<(TypeId, bool), bool>,
    unretained_external_data: Vec<Vec<Atom>>,
    nested_pairs_cache: FxHashMap<(TypeId, TypeId), std::rc::Rc<NestedPairs>>,
    large_union_infos: FxHashMap<TypeId, std::rc::Rc<LargeUnionInfo>>,
}

#[derive(Default)]
struct LargeUnionInfo {
    relevant_parts: Vec<u32>,
    parts_by_declaration: Vec<(Sym, u32)>,
    element_and_call_types: Vec<Option<([Option<TypeId>; 2], [bool; 2])>>,
    function_members: Vec<Option<std::rc::Rc<[(Atom, TypeId)]>>>,
}

impl State {
    pub(super) fn take_pairs_compared(&mut self) -> FxHashSet<(TypeId, TypeId, bool)> {
        std::mem::take(&mut self.pairs_compared)
    }

    pub(super) fn add_pairs_compared(&mut self, compared: FxHashSet<(TypeId, TypeId, bool)>) {
        self.pairs_compared.extend(compared);
    }
}

trait Walk {
    fn has_reached(&mut self, ty: TypeId, stays: bool) -> bool;
    fn enter(&mut self, ty: TypeId, stays: bool);
    fn add_view(&mut self, view: TypeId);
    fn leave(&mut self);
}

impl Walk for (&mut FxHashSet<(TypeId, bool)>, &mut Vec<TypeId>) {
    fn has_reached(&mut self, ty: TypeId, stays: bool) -> bool {
        self.0.contains(&(ty, stays))
    }

    fn enter(&mut self, ty: TypeId, stays: bool) {
        self.0.insert((ty, stays));
    }

    fn add_view(&mut self, view: TypeId) {
        self.1.push(view);
    }

    fn leave(&mut self) {}
}

#[derive(Copy, Clone)]
enum Standing {
    OnPath(u32),
    InGroup(u32),
}

struct SccEntry {
    index: u32,
    lowest: u32,
    first_view: usize,
    first_successor_group: usize,
}

struct Group {
    views: Vec<TypeId>,
    successor_groups: Vec<u32>,
    all_views: Option<std::rc::Rc<[TypeId]>>,
}

#[derive(Default)]
struct SccState {
    standing: FxHashMap<(TypeId, bool), Standing>,
    groups: Vec<Group>,
    path: Vec<(TypeId, bool)>,
    entered: Vec<SccEntry>,
    views: Vec<TypeId>,
    successor_groups: Vec<u32>,
}

impl Walk for SccState {
    fn has_reached(&mut self, ty: TypeId, stays: bool) -> bool {
        match self.standing.get(&(ty, stays)) {
            None => false,
            Some(&Standing::OnPath(index)) => {
                if let Some(innermost) = self.entered.last_mut() {
                    innermost.lowest = innermost.lowest.min(index);
                }
                true
            }
            Some(&Standing::InGroup(group)) => {
                self.successor_groups.push(group);
                true
            }
        }
    }

    fn enter(&mut self, ty: TypeId, stays: bool) {
        let index = self.path.len() as u32;
        self.standing.insert((ty, stays), Standing::OnPath(index));
        self.path.push((ty, stays));
        self.entered.push(SccEntry { index, lowest: index, first_view: self.views.len(), first_successor_group: self.successor_groups.len() });
    }

    fn add_view(&mut self, view: TypeId) {
        self.views.push(view);
    }

    fn leave(&mut self) {
        let Some(left) = self.entered.pop() else { return };
        if left.lowest < left.index {
            if let Some(outer) = self.entered.last_mut() {
                outer.lowest = outer.lowest.min(left.lowest);
            }
            return;
        }
        let group = self.groups.len() as u32;
        for member in self.path.drain(left.index as usize..) {
            self.standing.insert(member, Standing::InGroup(group));
        }
        let views = self.views.split_off(left.first_view);
        let mut successor_groups = self.successor_groups.split_off(left.first_successor_group);
        successor_groups.sort_unstable();
        successor_groups.dedup();
        self.groups.push(Group { views, successor_groups, all_views: None });
        self.successor_groups.push(group);
    }
}

impl SccState {
    fn take_views(&mut self) -> std::rc::Rc<[TypeId]> {
        let Some(group) = self.successor_groups.pop() else { return Vec::new().into() };
        self.successor_groups.clear();
        if let Some(known) = &self.groups[group as usize].all_views {
            return std::rc::Rc::clone(known);
        }
        let (mut seen, mut pending, mut views): (FxHashSet<u32>, Vec<u32>, Vec<TypeId>) = (FxHashSet::default(), vec![group], Vec::new());
        while let Some(next) = pending.pop() {
            if seen.insert(next) {
                views.extend_from_slice(&self.groups[next as usize].views);
                pending.extend_from_slice(&self.groups[next as usize].successor_groups);
            }
        }
        views.sort_unstable_by_key(|view| view.0);
        views.dedup();
        let views: std::rc::Rc<[TypeId]> = views.into();
        self.groups[group as usize].all_views = Some(std::rc::Rc::clone(&views));
        views
    }

    fn truncate_groups(&mut self, first: usize) {
        self.groups.truncate(first);
        self.standing.retain(|_, standing| matches!(*standing, Standing::InGroup(group) if (group as usize) < first));
    }
}

#[derive(Default, Clone)]
pub(super) struct ExternalTypes {
    continued_by_pairs: bool,
    identities: FxHashSet<Identity>,
    names: FxHashMap<Identity, Vec<Box<[u8]>>>,
    properties: Vec<FxHashMap<Box<[u8]>, ValueSummary>>,
    property_owners: Vec<Identity>,
    by_name: FxHashMap<Box<[u8]>, Vec<u32>>,
}

fn is_keyed_by_symbol(name: &[u8]) -> bool {
    name.first() == Some(&0xFE)
}

#[derive(Clone, PartialEq, Eq, Hash)]
struct ValueSummary {
    kinds: u16,
    strings: Vec<Box<[u8]>>,
    numbers: Vec<u64>,
}

impl ValueSummary {
    fn may_be_assignable_to(&self, taken: &ValueSummary) -> bool {
        if !said::may_be_assignable_to(self.kinds, taken.kinds) {
            return false;
        }
        if (self.kinds | taken.kinds) & (said::ANYTHING | said::UNKNOWN) != 0 {
            return true;
        }
        (self.kinds & said::STRING == 0 || taken.strings.is_empty() || !self.strings.is_empty() && self.strings.iter().all(|text| taken.strings.contains(text)))
            && (self.kinds & said::NUMBER == 0 || taken.numbers.is_empty() || !self.numbers.is_empty() && self.numbers.iter().all(|bits| taken.numbers.contains(bits)))
    }
}

mod said {
    pub(super) const TRUE: u16 = 1;
    pub(super) const FALSE: u16 = 1 << 1;
    pub(super) const NUMBER: u16 = 1 << 2;
    pub(super) const STRING: u16 = 1 << 3;
    pub(super) const BIGINT: u16 = 1 << 4;
    pub(super) const SYMBOL: u16 = 1 << 5;
    pub(super) const RECORDS: u16 = 1 << 6;
    pub(super) const ARRAYS: u16 = 1 << 7;
    pub(super) const FUNCTIONS: u16 = 1 << 8;
    pub(super) const ANYTHING: u16 = 1 << 9;
    pub(super) const UNKNOWN: u16 = 1 << 10;

    pub(super) fn may_be_assignable_to(held: u16, taken: u16) -> bool {
        taken & (ANYTHING | UNKNOWN) != 0 || held & ANYTHING != 0 || held & !taken == 0
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Hash)]
enum DerivedTypeKind {
    Union,
    Either,
    AnythingAs,
}

#[derive(Copy, Clone, PartialEq, Eq, Hash)]
enum Applied {
    Named(Sym),
    Written(Origin),
    Function(FileId, FnId),
    Computed,
    Tuple,
    Text,
    Alias(Sym),
    Conditional(FileId, TypeNodeId),
    IndexedAccess,
    StringMapping,
}

#[derive(Default)]
struct Referred {
    types: Vec<TypeId>,
    mappers: Vec<MapperId>,
}

impl Visitor for Referred {
    fn atom(&mut self, _: Atom) {}
    fn components(&mut self, _: ComponentsId) {}
    fn mapper(&mut self, id: MapperId) {
        self.mappers.push(id);
    }
    fn sig(&mut self, _: SigId) {}
    fn ty(&mut self, id: TypeId) {
        self.types.push(id);
    }
    fn file(&mut self, _: FileId) {}
    fn plain<T: Hash + ?Sized>(&mut self, _: &T) {}
}

#[derive(Default)]
pub struct LayoutUsage {
    pub is_allocated: bool,
    pub is_transition_target_only: bool,
    pub may_be_frozen: bool,
    pub may_have_other_prototype: bool,
    pub prototype_is_set_by_typed_code: bool,
    pub accepts_untyped: bool,
    pub is_relaxed_for_logging: bool,
    pub accepts_only_other_layouts: bool,
    pub members: Vec<u32>,
    pub structural_subtypes: Vec<u32>,
    pub specializations: Vec<u32>,
    pub callees: Vec<(Atom, FileId, FnId)>,
    pub set_at_creation: Vec<(super::FieldKey, bool)>,
    pub never_observed_absent: Vec<Atom>,
}

pub struct Membership {
    pub views: Vec<LayoutUsage>,
    pub(super) mutation_sites: [[u32; NUMBER_OF_OPERANDS]; 2],
    pub(super) mutated_by: [[u32; 3]; 2],
    pub(super) mutation_evidence: [u32; 5],
    pub(super) untyped_mutations: UntypedMutations,
    pub(super) widest_mutations: WidestMutations,
    pub(super) places_marking_every_layout: Vec<(Mutation, Place)>,
    pub(super) constructions_are_incomplete: bool,
    pub(super) redefinition_counts: CountedRedefinitions,
    pub sizes: Sizes,
    pub untyped_reasons: Vec<Option<UntypedReason>>,
    pub subtypes: Vec<Vec<u32>>,
    pub causes: Vec<Vec<Cause>>,
    pub upcasts: Vec<(u32, u32, Place)>,
    pub vouched: Vec<(u32, Place)>,
}

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub enum DataOrigin {
    Parsed,
    Prediction,
    JsonModule,
    Annotated,
    Inferred,
    Function,
    BuiltIn,
    Property,
    Awaited,
}

impl DataOrigin {
    pub fn is_known_plain_data(self) -> bool {
        self <= DataOrigin::JsonModule
    }
}

struct InspectedCast {
    target: (TypeId, Identity),
    target_parts: Vec<Identity>,
    source: (TypeId, Identity),
    source_parts: Vec<Identity>,
    name_read_on_the_spot: Option<Atom>,
    file: FileId,
    written: TypeNodeId,
    operand: ExprId,
    is_known_plain_data: Option<bool>,
}

struct WrittenUnion {
    file: FileId,
    node: TypeNodeId,
    members: Vec<(TypeId, Identity)>,
}

#[derive(Default)]
struct Left {
    looked_at: FxHashMap<FileId, Vec<InspectedCast>>,
    unions: FxHashMap<FileId, Vec<WrittenUnion>>,
    arrays: Vec<(Identity, Vec<Identity>)>,
}

type TypePropertySummary = (Identity, Option<Vec<(Box<[u8]>, ValueSummary)>>);

fn share_by_weight(files: &[FileId], weights: &[u64], index: usize, searchers: usize) -> Vec<FileId> {
    let total: u64 = files.iter().map(|file| weights[file.idx()]).sum();
    let (from, to) = (total * index as u64 / searchers as u64, total * (index as u64 + 1) / searchers as u64);
    let mut ahead = 0;
    let starts_in_share = |file: &FileId| {
        let starts_at = ahead;
        ahead += weights[file.idx()];
        from <= starts_at && starts_at < to
    };
    files.iter().copied().filter(starts_in_share).collect()
}

pub enum FilePartition<'a> {
    Files(&'a [FileId]),
    Rest { index: usize, of: usize, is_taken: &'a [bool] },
}

pub struct SearchBarrier {
    barrier: Barrier,
    search: Search,
}

pub(super) struct Search {
    searchers: usize,
    barrier: Barrier,
    total_found: [AtomicUsize; 3],
    seen: RwLock<FxHashSet<Identity>>,
    tainted: RwLock<FxHashSet<Identity>>,
    despecialized: RwLock<FxHashSet<Identity>>,
    said: Vec<Guarded<Vec<TypePropertySummary>>>,
    summaries_so_far: Guarded<FxHashSet<Vec<(Box<[u8]>, ValueSummary)>>>,
    external_types: RwLock<ExternalTypes>,
    gave_up: Guarded<Option<TruncatedSearch>>,
    continues_past_sources: (Guarded<Option<bool>>, Condvar),
    is_continuation: bool,
    left: Guarded<Left>,
    seen_before: Option<Arc<FxHashSet<Identity>>>,
    targets_by_source: FxHashMap<Identity, Vec<Identity>>,
    seen_by_other_declarations: FxHashMap<FileId, Place>,
    names: Guarded<FxHashMap<Identity, Vec<Box<[u8]>>>>,
}

impl Search {
    fn new(searchers: usize) -> Search {
        Search {
            searchers,
            barrier: Barrier::new(searchers),
            total_found: Default::default(),
            seen: RwLock::new(Default::default()),
            tainted: RwLock::new(Default::default()),
            despecialized: RwLock::new(Default::default()),
            said: (0..searchers).map(|_| Guarded::default()).collect(),
            summaries_so_far: Guarded::default(),
            external_types: RwLock::new(Default::default()),
            gave_up: Guarded::default(),
            continues_past_sources: Default::default(),
            is_continuation: false,
            left: Guarded::default(),
            seen_before: None,
            targets_by_source: FxHashMap::default(),
            seen_by_other_declarations: FxHashMap::default(),
            names: Guarded::default(),
        }
    }

    fn continuing_from(first: Search, parties: usize) -> Search {
        let seen = std::mem::take(&mut *first.seen.write());
        Search {
            seen_before: Some(Arc::new(seen.clone())),
            seen: RwLock::new(seen),
            tainted: first.tainted,
            despecialized: first.despecialized,
            summaries_so_far: first.summaries_so_far,
            external_types: first.external_types,
            left: first.left,
            names: first.names,
            ..Search::new(parties)
        }
    }

    fn found(&self) -> ExternalTypes {
        ExternalTypes { names: std::mem::take(&mut *self.names.lock()), ..std::mem::take(&mut *self.external_types.write()) }
    }

    fn has_any_found(&self, found: usize, turn: &mut usize) -> bool {
        let (current, previous) = (*turn % 3, (*turn + 2) % 3);
        *turn += 1;
        self.total_found[current].fetch_add(found, Ordering::SeqCst);
        if self.barrier.wait() {
            self.total_found[previous].store(0, Ordering::SeqCst);
        }
        self.total_found[current].load(Ordering::SeqCst) != 0
    }

    fn publish_summaries(&self, records_owners: bool) {
        let (mut external_types, mut summaries_so_far) = (self.external_types.write(), self.summaries_so_far.lock());
        for said in &self.said {
            for (identity, properties) in said.lock().drain(..) {
                let is_new = external_types.identities.insert(identity);
                let Some(properties) = properties.filter(|_| is_new) else { continue };
                if properties.is_empty() || summaries_so_far.contains(&properties) {
                    continue;
                }
                summaries_so_far.insert(properties.clone());
                let index = external_types.properties.len() as u32;
                for (name, _) in &properties {
                    match external_types.by_name.get_mut(name) {
                        Some(having) => having.push(index),
                        None => {
                            external_types.by_name.insert(name.clone(), vec![index]);
                        }
                    }
                }
                external_types.properties.push(properties.into_iter().collect());
                if records_owners {
                    external_types.property_owners.push(identity);
                }
            }
        }
    }
}

impl<'s> Program<'s> {
    pub fn is_external_data_found(&self) -> bool {
        self.aot.storage.external_types.get().is_some()
    }

    pub(crate) fn absorb_pairs_compared(&self, mut pairs: Vec<(Identity, Identity)>) {
        if !pairs.is_empty() {
            self.aot.storage.pairs_compared.lock().append(&mut pairs);
        }
    }

    pub fn meeting_of(&self, parties: usize) -> SearchBarrier {
        let first = self.aot.storage.initial_search.lock().take().expect("the search from the redefinition_counts is made ahead of the plan");
        let mut search = Search::continuing_from(first, parties);
        for (source, target) in std::mem::take(&mut *self.aot.storage.pairs_compared.lock()) {
            search.targets_by_source.entry(source).or_default().push(target);
        }
        for targets in search.targets_by_source.values_mut() {
            targets.sort_unstable();
            targets.dedup();
        }
        SearchBarrier { barrier: Barrier::new(parties), search }
    }

    pub fn find_external_data(&self, searchers: usize, step: u32, is_searched_again: bool, at_once: &dyn Fn(usize, &(dyn Fn(usize) + Sync))) -> Result<Vec<Finished<'s>>, TruncatedSearch> {
        if self.aot.storage.external_types.get().is_some() {
            return Ok(Vec::new());
        }
        self.aot.storage.is_search_under_way.store(is_searched_again, Ordering::Relaxed);
        self.aot.storage.external_marks.lock().clear();
        self.aot.storage.places_where_external_data_enters.lock().clear();
        let search = Search { is_continuation: is_searched_again, seen_by_other_declarations: self.checker().importers_with_other_declarations(), ..Search::new(searchers.max(1)) };
        search.external_types.write().continued_by_pairs = is_searched_again;
        let finished: Vec<Guarded<Option<Finished<'s>>>> = (0..search.searchers).map(|_| Guarded::new(None)).collect();
        const TABLES: usize = 9;
        at_once(search.searchers + TABLES, &|index| {
            if let Some(part) = index.checked_sub(search.searchers) {
                let mut goes_on = search.continues_past_sources.0.lock();
                while goes_on.is_none() {
                    search.continues_past_sources.1.wait_guarded(&mut goes_on);
                }
                if *goes_on != Some(true) {
                    return;
                }
                drop(goes_on);
                let mut checker = self.checker();
                checker.begin_stack_budget();
                checker.begin_task(step, part as u32, false);
                checker.during_translation(|checker| match part {
                    0 => checker.precompute_class_tables(),
                    4 => {
                        checker.free_names();
                    }
                    5 => {
                        checker.prototype_property_names();
                    }
                    1..=3 => checker.precompute_storage_tables(part - 1),
                    part => checker.precompute_storage_tables(part - 3),
                });
                return;
            }
            let mut searcher = self.checker();
            searcher.begin_stack_budget();
            searcher.begin_task(step, index as u32, true);
            for file in (0..self.files.modules.len() as u32).map(FileId) {
                if searcher.is_untyped_file(file) {
                    searcher.task.begin_file(file, false);
                }
            }
            searcher.aot.flows.is_searching_from_sources = true;
            searcher.aot.flows.is_boundary_bounded = true;
            searcher.search_from_sources(&search, index, &FilePartition::Rest { index, of: search.searchers, is_taken: &[] }, &FxHashMap::default());
            let mut found = searcher.end_task();
            found.diagnostics.retain(|(owner, _)| owner.is_some());
            *finished[index].lock() = Some(found);
        });
        if let Some(gave_up) = search.gave_up.lock().take() {
            return Err(gave_up);
        }
        match is_searched_again {
            true => {
                self.aot.storage.external_types.set_warmup_value(search.external_types.read().clone());
                *self.aot.storage.initial_search.lock() = Some(search);
            }
            false => {
                let _ = self.aot.storage.external_types.set(search.found());
            }
        }
        Ok(finished.into_iter().filter_map(|mut finished| finished.get_mut().take()).collect())
    }
}

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub(super) enum ExternalCause {
    UsedAs { at: Place },
    CreatedByGeneratedCode { at: Place },
    CrossesBoundary { at: Place },
    CastFrom { at: Place },
    CastTo { at: Place },
    AssignedFrom,
    Resembles,
    UnionMember { at: Place },
    PartOf,
    SameLayoutAs,
}

#[derive(Clone)]
pub(super) struct ExternalMark {
    rank: (u32, u32),
    pub(super) cause: ExternalCause,
    pub(super) from: Option<Identity>,
    pub(super) name: Vec<u8>,
    pub(super) declared: Option<Place>,
}

#[derive(Copy, Clone)]
pub enum UntypedReason {
    Seen { source: Option<TypeId>, at: Place },
    Untyped { at: Place, candidate: Candidate },
    ExternalData { at: Place, candidate: Candidate },
    UnretainedExternalData { at: Place },
    Inherited { from: u32, at: Place },
    DeclaredOnly,
    Instance,
    PassedCast { from: u32 },
    Weak { at: Place },
    Flat { at: Place },
    MayLackCapacity { at: Place },
    AnotherLayout { at: Place },
    UnconvertibleLayout { from: u32 },
    Dictionary { at: Place },
    TooMany { at: Place },
    ForLogging { at: Place },
    NeverAllocated { at: Place },
    ReachesJavaScript { at: Place },
}

#[derive(Copy, Clone)]
pub struct Candidate(Kind);

pub struct KindsDeclared {
    declaring: Vec<FileId>,
    next: AtomicUsize,
    found: Vec<OnceLock<Option<Vec<(Sym, Option<bool>, bool)>>>>,
    namespaces: OnceLock<Vec<Sym>>,
    publish_lock: RwLock<()>,
}

impl KindsDeclared {
    const FILES_PER_CHECKER: usize = 64;
    const POOL_HELPERS: usize = 64;

    pub fn help(&self, program: &Program<'_>) {
        loop {
            let _shared = self.publish_lock.read();
            let at = self.next.fetch_add(1, Ordering::Relaxed);
            if at == 0 {
                self.namespaces.set(program.checker().namespaces_used_as_values()).expect("the first to come finds the namespaces");
                continue;
            }
            let Some(slice) = self.declaring.chunks(KindsDeclared::FILES_PER_CHECKER).nth(at - 1) else { break };
            let mut c = program.checker();
            c.begin_stack_budget();
            let created = c.kinds_declared_in(slice);
            self.found[at - 1].set((!c.take_ran_out_of_stack() && c.stack_half_used_count() == 0).then_some(created)).expect("a slice is gone through once");
        }
    }

    pub fn give_up(&self) {
        self.next.store(usize::MAX / 2, Ordering::Relaxed);
    }

    pub fn with_publishing_blocked<R>(&self, work: impl FnOnce() -> R) -> R {
        let _shared = self.publish_lock.read();
        work()
    }

    pub fn publish<R>(&self, work: impl FnOnce() -> R) -> R {
        let _alone = self.publish_lock.write();
        work()
    }
}

#[derive(Default)]
struct PropertyIndex {
    all: Vec<u32>,
    indexable: Vec<u32>,
    by_name: FxHashMap<Atom, Vec<u32>>,
    bit_set_words: usize,
    bit_sets_of_long_lists: FxHashMap<Atom, Vec<u64>>,
}

impl PropertyIndex {
    fn build_bit_sets_of_long_lists(&mut self) {
        self.bit_set_words = self.by_name.values().filter_map(|indexes| indexes.last()).max().map_or(0, |&last| last as usize / 64 + 1);
        for (&name, indexes) in &self.by_name {
            if indexes.len() >= self.bit_set_words {
                let mut bits = vec![0u64; self.bit_set_words];
                for &index in indexes {
                    bits[index as usize / 64] |= 1 << (index % 64);
                }
                self.bit_sets_of_long_lists.insert(name, bits);
            }
        }
    }
}

const MAX_EXTERNAL_KINDS_QUERIED: usize = 256;

#[derive(Copy, Clone)]
enum Kind {
    Allocated(TypeId),
    Assignable(TypeId),
    Arrays,
    Functions,
    InstancesOf(Sym),
    ValueOf(Sym),
    Of(TypeId),
    ExternalData(TypeId),
}

#[derive(Copy, Clone, PartialEq, Eq)]
pub enum SubtypeAnswer {
    No,
    Yes,
    NotKnown,
}

#[derive(Copy, Clone)]
pub struct SubtypeQuery {
    kind: Kind,
    view: TypeId,
}

impl SubtypeQuery {
    pub(super) fn allocated_is_subtype_query(created: TypeId, view: TypeId) -> SubtypeQuery {
        SubtypeQuery { kind: Kind::Allocated(created), view }
    }

    pub(super) fn allocated_is_assignable_query(created: TypeId, view: TypeId) -> SubtypeQuery {
        SubtypeQuery { kind: Kind::Assignable(created), view }
    }

    pub(super) fn as_allocated_query(&self) -> Option<(bool, TypeId, TypeId)> {
        match self.kind {
            Kind::Allocated(created) => Some((false, created, self.view)),
            Kind::Assignable(created) => Some((true, created, self.view)),
            _ => None,
        }
    }
}

impl<'p, 's> Checker<'p, 's> {

    pub fn layout_defining_type(&mut self, ty: TypeId) -> TypeId {
        if self.shared_type_flags(ty) & type_flags::IS_OWN_LAYOUT_TYPE != 0 {
            return ty;
        }
        if let Some(&known) = self.aot.flows.layout_types_cache.get(&ty) {
            return known;
        }
        let counts_before = (self.aot.flows.structure_representatives_used, self.aot.flows.mapped_layout_cycles_cut);
        let (found, is_cacheable) = self.compute_cacheable(|c| c.find_layout_type(ty));
        if self.aot.flows.finding_canonical == 0 {
            let is_task_independent = is_cacheable && counts_before == (self.aot.flows.structure_representatives_used, self.aot.flows.mapped_layout_cycles_cut);
            if !is_task_independent || found != ty || !self.publish_type_flags(ty, type_flags::IS_OWN_LAYOUT_TYPE) {
                self.aot.flows.layout_types_cache.insert(ty, found);
            }
        }
        found
    }

    fn find_layout_type(&mut self, ty: TypeId) -> TypeId {
        let ty = self.reduced(ty);
        match *self.data(ty) {
            TypeData::Ref { target, .. } | TypeData::ThisParam(target) if self.files().flags(target).contains(SymFlags::CLASS) => self.declared_type(target),
            TypeData::Anon { origin: Origin::Mapped(file, node), mapper } => {
                if self.aot.flows.mapped_layout_types_in_progress.contains(&ty) {
                    self.aot.flows.mapped_layout_cycles_cut += 1;
                    return ty;
                }
                self.aot.flows.mapped_layout_types_in_progress.push(ty);
                let found = self.find_mapped_layout_type(ty, file, node, mapper);
                self.aot.flows.mapped_layout_types_in_progress.pop();
                found
            }
            _ => {
                let ty = self.regular(ty);
                let ty = self.regular_type_of_object_literal(ty);
                let ty = self.canonical_type(ty);
                if self.plain_literal_structure(ty).is_none() {
                    return ty;
                }
                self.keep_type(ty);
                let identity = self.type_identity(ty);
                self.aot.flows.structure_representatives_used += 1;
                *self.aot.flows.first_with_structure.entry(identity).or_insert(ty)
            }
        }
    }

    fn find_mapped_layout_type(&mut self, ty: TypeId, file: FileId, node: TypeNodeId, mapper: MapperId) -> TypeId {
        let Some((over, _)) = self.mapped_modifiers_source(file, node) else { return ty };
        let over = self.instantiate(over, mapper);
        if self.only_changes_readonly(file, node) {
            let over = if self.is_type_param(over) { self.base_constraint(over) } else { over };
            if self.declares_properties(over) {
                return self.layout_defining_type(over);
            }
        }
        if !self.is_type_param(over) {
            return ty;
        }
        let bound = self.base_constraint(over);
        let bounded = self.types().mapper(vec![(over, bound)]);
        let bounded = self.instantiate(ty, bounded);
        if bounded == ty { ty } else { self.layout_defining_type(bounded) }
    }

    pub fn object_literal_span(&self, ty: TypeId) -> Option<(u32, u32)> {
        match *self.data(ty) {
            TypeData::Anon { origin: Origin::ObjectLiteral(file, e, ..), .. } => Some((file.0, self.hir(file)[e].pos)),
            _ => None,
        }
    }

    fn is_plain_data(&self, file: FileId, e: ExprId) -> bool {
        let hir = self.hir(file);
        match hir[e].kind {
            ExprKind::Null | ExprKind::True | ExprKind::False | ExprKind::Number(_) | ExprKind::String(_) | ExprKind::BigInt(_) | ExprKind::Object(_) => true,
            ExprKind::Unary { op: UnOp::Minus, operand } => matches!(hir[operand].kind, ExprKind::Number(_) | ExprKind::BigInt(_)),
            ExprKind::Array(elements) => hir.ids(elements).all(|element| self.is_plain_data(file, element)),
            _ => false,
        }
    }

    pub(super) fn plain_literal_structure(&mut self, ty: TypeId) -> Option<Vec<(Atom, u8, TypeId)>> {
        let TypeData::Anon { origin: Origin::ObjectLiteral(file, literal, false, _, _, _, false), mapper: MapperId::IDENTITY } = *self.data(ty) else { return None };
        if self.types().provenance(ty).is_some() || self.is_untyped_file(file) {
            return None;
        }
        let hir = self.hir(file);
        let ExprKind::Object(written) = hir[literal].kind else { return None };
        if !written.iter().all(|p| hir[p].kind == PropKind::Init && matches!(hir[p].key, PropKey::Name(_)) && self.is_plain_data(file, hir[p].value)) {
            return None;
        }
        let members = self.members(ty)?;
        let shape = members.shape();
        if shape.props.is_empty() || !shape.call.is_empty() || !shape.construct.is_empty() || !shape.index.is_empty() {
            return None;
        }
        let mut fields = Vec::with_capacity(shape.props.len());
        for prop in shape.props.iter() {
            let name = self.atoms().bytes(prop.name);
            if !matches!(prop.source, PropSource::Literal(..)) || prop.flags.intersects(PropFlags::METHOD | PropFlags::ACCESSOR) || prop.name_type != TypeId::UNRESOLVED || name == b"__proto__" || name.first().is_none_or(u8::is_ascii_digit) {
                return None;
            }
            let of_field = self.type_of_prop(prop, MapperId::IDENTITY);
            let of_field = self.regular(of_field);
            let flags = prop.flags.contains(PropFlags::OPTIONAL) as u8 | (prop.flags.contains(PropFlags::READONLY) as u8) << 1;
            fields.push((prop.name, flags, self.regular_type_of_object_literal(of_field)));
        }
        Some(fields)
    }

    fn canonical_type(&mut self, ty: TypeId) -> TypeId {
        if let Some(&known) = self.aot.flows.canonical.get(&ty) {
            return known;
        }
        self.aot.flows.canonical.insert(ty, ty);
        self.aot.flows.finding_canonical += 1;
        let supertypes: Vec<TypeId> = match *self.data(ty) {
            TypeData::Ref { target, .. } if self.is_created_by_program(ty) => match self.members(ty) {
                Some(members) => self.base_types(target).into_vec().into_iter().map(|base| self.instantiate(base, members.mapper)).collect(),
                None => Vec::new(),
            },
            TypeData::Intersection(ref parts) => parts.to_vec(),
            _ => Vec::new(),
        };
        let mut supertypes = supertypes;
        if let TypeData::Ref { target, .. } = *self.data(ty)
            && self.is_created_by_program(ty)
            && !self.is_instance_type(ty)
        {
            let at_bounds = self.declared_type_with_primitive_bounds(target);
            if at_bounds != ty {
                supertypes.push(at_bounds);
            }
        }
        let mut canonical = ty;
        for supertype in supertypes {
            let is_record = self.declares_properties(supertype) && self.is_created_by_program(supertype) && !self.is_instance_type(supertype);
            if is_record && self.has_same_fields(ty, supertype, true) {
                canonical = self.layout_defining_type(supertype);
                break;
            }
        }
        self.aot.flows.finding_canonical -= 1;
        self.aot.flows.canonical.insert(ty, canonical);
        canonical
    }

    fn has_same_fields(&mut self, sub: TypeId, sup: TypeId, exact: bool) -> bool {
        let (Some(of_sub), Some(of_sup)) = (self.members(sub), self.members(sup)) else { return false };
        let (sub_shape, sup_shape) = (of_sub.shape(), of_sup.shape());
        let is_plain = |shape: &Shape| shape.call.is_empty() && shape.construct.is_empty() && shape.index.is_empty();
        if !is_plain(sub_shape) || !is_plain(sup_shape) {
            return false;
        }
        let is_dead = |c: &Self, name: Atom| !exact && c.is_never_stored(name);
        if exact && sub_shape.props.iter().any(|prop| of_sup.resolved.prop(prop.name).is_none()) {
            return false;
        }
        const KIND: PropFlags = PropFlags::METHOD.union(PropFlags::ACCESSOR);
        for sup_prop in sup_shape.props.iter() {
            if is_dead(self, sup_prop.name) {
                continue;
            }
            let Some(sub_prop) = of_sub.resolved.prop(sup_prop.name) else { return false };
            let (is_sub_optional, is_sup_optional) = (sub_prop.flags.contains(PropFlags::OPTIONAL), sup_prop.flags.contains(PropFlags::OPTIONAL));
            if sub_prop.flags & KIND != sup_prop.flags & KIND || (is_sub_optional && !is_sup_optional) || (exact && is_sub_optional != is_sup_optional) {
                return false;
            }
            let (sub_type, sup_type) = (self.type_of_prop(sub_prop, of_sub.mapper), self.type_of_prop(sup_prop, of_sup.mapper));
            if sub_type != sup_type && !self.differs_in_references_only(sub_type, sup_type, exact) {
                return false;
            }
        }
        true
    }

    fn differs_in_references_only(&mut self, sub: TypeId, sup: TypeId, exact: bool) -> bool {
        let is_generic = |c: &Self, ty: TypeId| c.parts(ty).iter().any(|&part| c.is_instantiable(part));
        if is_generic(self, sub) || is_generic(self, sup) {
            if exact {
                let (sub_bound, sup_bound) = (self.with_primitive_bounds(sub), self.with_primitive_bounds(sup));
                let is_bounded = (sub_bound != sub || sup_bound != sup) && !is_generic(self, sub_bound) && !is_generic(self, sup_bound);
                return is_bounded && (sub_bound == sup_bound || self.differs_in_references_only(sub_bound, sup_bound, true));
            }
            let relation = if self.aot.flows.stored.is_some() { Relation::AssignableAsStored } else { Relation::Assignable };
            return self.is_provably_related(sub, sup, relation);
        }
        let is_nullish = |part: TypeId| part.is_undefined() || part.is_null() || part == TypeId::VOID;
        let has_references = |c: &Self, ty: TypeId| c.parts(ty).iter().any(|&part| !c.has_primitive_flag(part));
        let primitives = |c: &Self, ty: TypeId| -> Vec<TypeId> { c.parts(ty).iter().copied().filter(|&part| c.has_primitive_flag(part) && !is_nullish(part)).collect() };
        let is_boxed = |ty: TypeId| ty.is_any() || ty == TypeId::UNKNOWN;
        if is_boxed(sup) {
            return is_boxed(sub) || primitives(self, sub).is_empty();
        }
        if is_boxed(sub) || sub.is_never() || sup.is_never() {
            return false;
        }
        let (sub_primitives, sup_primitives) = (primitives(self, sub), primitives(self, sup));
        let (sub_references, sup_references) = (has_references(self, sub), has_references(self, sup));
        let is_sub_nullish = !sub_references && sub_primitives.is_empty();
        let is_sup_nullish = !sup_references && sup_primitives.is_empty();
        if exact {
            let kinds = |c: &mut Self, parts: &[TypeId]| -> Vec<TypeId> {
                let mut kinds: Vec<TypeId> = Vec::new();
                for &part in parts {
                    let kind = if c.is_number_like(part) { TypeId::NUMBER } else if c.is_string_like(part) { TypeId::STRING } else { c.base_of_literal(part) };
                    kinds.extend(c.parts(kind).iter().copied());
                }
                kinds.sort_unstable_by_key(|kind| kind.0);
                kinds.dedup();
                kinds
            };
            let (sub_kinds, sup_kinds) = (kinds(self, &sub_primitives), kinds(self, &sup_primitives));
            return (sub_references == sup_references || is_sub_nullish || is_sup_nullish) && sub_kinds == sup_kinds && sub_primitives.iter().all(|&part| sup_primitives.contains(&part) || self.is_provably_assignable(part, sup));
        }
        (!sub_references || sup_references || is_sup_nullish) && sub_primitives.into_iter().all(|part| sup_primitives.contains(&part) || self.is_provably_assignable(part, sup))
    }

    fn primitive_bound(&mut self, ty: TypeId) -> Option<TypeId> {
        if !self.is_type_param(ty) {
            return None;
        }
        let bound = self.base_constraint(ty);
        let is_primitive = !self.parts(bound).is_empty() && self.parts(bound).iter().all(|&part| self.has_primitive_flag(part) && !self.is_instantiable(part));
        is_primitive.then_some(bound)
    }

    fn with_primitive_bounds(&mut self, ty: TypeId) -> TypeId {
        let parts: Vec<TypeId> = self.parts(ty).to_vec();
        let bounded: Vec<TypeId> = parts.into_iter().map(|part| self.primitive_bound(part).unwrap_or(part)).collect();
        self.union(&bounded)
    }

    fn declared_type_with_primitive_bounds(&mut self, target: Sym) -> TypeId {
        let declared = self.declared_type(target);
        let parameters: Vec<TypeId> = self.type_params_of_symbol(target).iter().copied().collect();
        let mut pairs: Vec<(TypeId, TypeId)> = Vec::new();
        for parameter in parameters {
            if let Some(bound) = self.primitive_bound(parameter) {
                pairs.push((parameter, bound));
            }
        }
        if pairs.is_empty() {
            return declared;
        }
        let mapper = self.types().mapper(pairs);
        self.instantiate(declared, mapper)
    }

    fn only_changes_readonly(&mut self, file: FileId, node: TypeNodeId) -> bool {
        let mapped = self.mapped_decl(file, node);
        if mapped.name_ty.is_some() || mapped.ty.is_none() || mapped.optional != MappedModifier::None {
            return false;
        }
        let Some((over, true)) = self.mapped_modifiers_source(file, node) else { return false };
        let (template, key) = (self.type_from_node(file, mapped.ty), self.type_param(file, mapped.param));
        matches!(*self.data(template), TypeData::IndexedAccess { obj, index, .. } if obj == over && index == key)
    }

    pub fn is_nested_too_deeply(&mut self, ty: TypeId) -> bool {
        if let Some(known) = self.cached_type_flag(ty, type_flags::NESTING_KNOWN, type_flags::IS_NESTED_TOO_DEEPLY) {
            return known;
        }
        let found = self.compute_is_nested_too_deeply(ty);
        self.cache_type_flag(ty, type_flags::NESTING_KNOWN, type_flags::IS_NESTED_TOO_DEEPLY, found)
    }

    fn compute_is_nested_too_deeply(&mut self, ty: TypeId) -> bool {
        let depth = self.nesting_bound(ty);
        if depth <= MIN_DEPTH_OF_LARGE_FAMILY {
            return false;
        }
        self.collect_applications(ty);
        let applications = &self.aot.flows.applications[&ty];
        applications.iter().any(|&(_, times)| times > MAX_NESTED_APPLICATIONS) || (applications.len() as u64).checked_pow(depth).is_none_or(|family| family > MAX_FAMILY_SIZE)
    }

    fn generic_form(&mut self, ty: TypeId) -> Option<TypeId> {
        match *self.data(ty) {
            TypeData::Ref { target, .. } => Some(self.declared_type(target)),
            TypeData::Anon { origin: Origin::TypeLiteral(file, node) | Origin::Mapped(file, node), .. } => Some(self.type_from_node(file, node)),
            _ => None,
        }
    }

    pub fn is_beyond_layouts(&mut self, ty: TypeId) -> bool {
        if ty == TypeId::UNRESOLVED {
            return false;
        }
        if let Some(known) = self.cached_type_flag(ty, type_flags::BEYOND_LAYOUTS_KNOWN, type_flags::IS_BEYOND_LAYOUTS) {
            return known;
        }
        let parts: Vec<TypeId> = self.parts(ty).to_vec();
        let found = parts.into_iter().any(|part| self.is_nested_too_deeply(part));
        self.cache_type_flag(ty, type_flags::BEYOND_LAYOUTS_KNOWN, type_flags::IS_BEYOND_LAYOUTS, found)
    }

    pub fn is_read_from_beyond_layouts(&mut self, file: FileId, e: ExprId) -> bool {
        let hir = self.hir(file);
        let call = match hir[e].kind {
            ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => {
                let of_object = self.type_of_expr(file, obj);
                return self.is_beyond_layouts(of_object);
            }
            ExprKind::Call(call) => call,
            _ => return false,
        };
        let mut callee = hir[call].callee;
        while let ExprKind::NonNull(asserted) = hir[callee].kind {
            callee = asserted;
        }
        if let ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } = hir[callee].kind {
            let of_receiver = self.type_of_expr(file, obj);
            if self.is_beyond_layouts(of_receiver) {
                return true;
            }
        }
        for argument in hir.ids(hir[call].args) {
            let argument = match hir[argument].kind {
                ExprKind::Missing => continue,
                ExprKind::Spread(spread) => spread,
                _ => argument,
            };
            let of_argument = self.type_of_expr(file, argument);
            if self.is_beyond_layouts(of_argument) {
                return true;
            }
        }
        false
    }

    pub fn record_untyped_source(&mut self, ty: TypeId) {
        if ty == TypeId::UNRESOLVED {
            return;
        }
        let views = self.nested_types_staying_untyped(ty, true);
        for &view in views.iter() {
            self.record_untyped(view, TypeId::UNRESOLVED);
        }
    }

    pub fn record_generic_function_result(&mut self, created: &FreshGraph, allocated_as: TypeId) {
        if allocated_as == TypeId::UNRESOLVED {
            return;
        }
        let mut views = Vec::new();
        self.add_allocated_types(created, allocated_as, &mut views);
        for view in views {
            self.record_untyped(view, TypeId::UNRESOLVED);
        }
    }

    fn add_allocated_types(&mut self, created: &FreshGraph, allocated_as: TypeId, out: &mut Vec<TypeId>) {
        let mut allocated_as = self.reduced(allocated_as);
        if self.is_instantiable(allocated_as) {
            let bound = self.base_constraint(allocated_as);
            allocated_as = self.reduced(bound);
        }
        if !self.may_hold_objects(allocated_as) {
            return;
        }
        if let TypeData::Union(parts) = self.data(allocated_as) {
            let parts: Vec<TypeId> = parts.to_vec();
            let objects: Vec<TypeId> = parts.iter().copied().filter(|&part| self.declares_properties(part)).collect();
            if objects.len() > 1 {
                let objects = self.union(&objects);
                let common = self.common_supertype_of_union(objects);
                if !matches!(self.data(common), TypeData::Union(_)) {
                    self.add_allocated_types(created, common, out);
                }
            }
            for part in parts {
                self.add_allocated_types(created, part, out);
            }
            return;
        }
        if self.is_array_or_tuple(allocated_as) {
            if let Some(elements) = &created.elements {
                let of_elements: Vec<TypeId> = self.type_arguments(allocated_as).to_vec();
                for of_element in of_elements {
                    self.add_allocated_types(elements, of_element, out);
                }
            }
            return;
        }
        let is_module = matches!(self.data(allocated_as), TypeData::Anon { origin: Origin::Module(..), .. });
        if !created.is_object || self.built_in_for_type(allocated_as).is_some() || self.is_instance_type(allocated_as) || !self.declares_properties(allocated_as) || is_module {
            return;
        }
        let view = self.layout_defining_type(allocated_as);
        out.push(view);
        for (name, held) in &created.within {
            if let Some(of_field) = self.type_of_property(allocated_as, *name) {
                self.add_allocated_types(held, of_field, out);
            }
        }
        if let Some(anywhere) = &created.anywhere
            && let Some(members) = self.members(allocated_as)
        {
            for info in members.shape().index.iter() {
                self.add_allocated_types(anywhere, info.value, out);
            }
            for prop in members.shape().props.iter() {
                let of_field = self.type_of_prop(prop, members.mapper);
                self.add_allocated_types(anywhere, of_field, out);
            }
        }
    }

    fn referenced_types(&self, at: TypeId) -> Vec<TypeId> {
        let mut referred = Referred::default();
        self.data(at).visit(&mut referred);
        if let TypeData::Synth(shape) = self.data(at)
            && let Some((left, right)) = shape.created_from
        {
            for operand in [left, right] {
                if let Some(index) = referred.types.iter().position(|&ty| ty == operand) {
                    referred.types.swap_remove(index);
                }
            }
        }
        for mapper in std::mem::take(&mut referred.mappers) {
            if mapper != MapperId::IDENTITY {
                referred.types.extend(self.types().mapping(mapper).iter().map(|pair| pair.1));
            }
        }
        if let Some((_, type_arguments)) = self.stored_alias(at) {
            referred.types.extend(type_arguments.iter().copied());
        }
        referred.types
    }

    fn nesting_bound(&self, ty: TypeId) -> u32 {
        let mut pending = vec![ty];
        while let Some(&at) = pending.last() {
            if self.cached_nesting_bound(at).is_some() {
                pending.pop();
                continue;
            }
            let referred = self.referenced_types(at);
            let known = pending.len();
            pending.extend(referred.iter().copied().filter(|&argument| self.cached_nesting_bound(argument).is_none()));
            if pending.len() > known {
                continue;
            }
            let within = referred.iter().filter_map(|&argument| self.cached_nesting_bound(argument)).max().unwrap_or(0);
            let (own, alias) = self.own_applications(at, referred.len());
            let added = own.into_iter().chain(alias).map(|applied| applied.1).max().unwrap_or(0);
            self.cache_nesting_bound(at, within.saturating_add(added));
            pending.pop();
        }
        self.cached_nesting_bound(ty).unwrap_or(u32::MAX)
    }

    fn own_applications(&self, at: TypeId, referred: usize) -> (Option<(Applied, u32)>, Option<(Applied, u32)>) {
        let arguments = (referred - self.stored_alias(at).map_or(0, |stored| stored.1.len())) as u32;
        let own = match *self.data(at) {
            TypeData::StringLit { value, .. } => Some((Applied::Text, self.atoms().bytes(value).len() as u32 / 64)),
            _ if arguments == 0 => None,
            TypeData::Ref { target, .. } => Some((Applied::Named(target), 1)),
            TypeData::Anon { origin, .. } => Some((Applied::Written(origin), 1)),
            TypeData::Fns { ref decls, .. } => decls.first().map(|&(file, func)| (Applied::Function(file, func), 1)),
            TypeData::Synth(_) | TypeData::ReverseMapped { .. } => Some((Applied::Computed, 1)),
            TypeData::Tuple { .. } => Some((Applied::Tuple, 1 + arguments / 16)),
            TypeData::Cond { file, node, .. } => Some((Applied::Conditional(file, node), 1)),
            TypeData::IndexedAccess { .. } => Some((Applied::IndexedAccess, 1)),
            TypeData::StringMapping { .. } => Some((Applied::StringMapping, 1)),
            TypeData::Template { ref texts, .. } => Some((Applied::Text, texts.iter().map(|&text| self.atoms().bytes(text).len() as u32).sum::<u32>() / 64)),
            _ => None,
        };
        let alias = self.stored_alias(at).filter(|stored| !stored.1.is_empty()).map(|stored| (Applied::Alias(stored.0), 1));
        (own, alias)
    }

    fn collect_applications(&mut self, ty: TypeId) {
        if self.aot.flows.applications.contains_key(&ty) {
            return;
        }
        let mut pending = vec![ty];
        while let Some(&at) = pending.last() {
            if self.aot.flows.applications.contains_key(&at) {
                pending.pop();
                continue;
            }
            let referred = self.referenced_types(at);
            let known = pending.len();
            pending.extend(referred.iter().copied().filter(|argument| !self.aot.flows.applications.contains_key(argument)));
            if pending.len() > known {
                continue;
            }
            let (own, alias) = self.own_applications(at, referred.len());
            let mut all: Vec<(Applied, u32)> = Vec::new();
            for argument in &referred {
                for &(applied, times) in &self.aot.flows.applications[argument] {
                    match all.iter_mut().find(|known| known.0 == applied) {
                        Some(known) => known.1 = known.1.max(times),
                        None => all.push((applied, times)),
                    }
                }
            }
            for (applied, times) in own.into_iter().chain(alias) {
                match all.iter_mut().find(|known| known.0 == applied) {
                    Some(known) => known.1 += times,
                    None => all.push((applied, times)),
                }
            }
            self.aot.flows.applications.insert(at, all);
            pending.pop();
        }
    }

    pub fn class_instance_type(&mut self, file: FileId, class: ClassId) -> TypeId {
        let class = self.class_sym(file, class);
        self.declared_type(class)
    }

    #[inline]
    pub fn is_instance_type(&self, ty: TypeId) -> bool {
        self.row(ty) & type_flags::IS_INSTANCE_TYPE != 0
    }

    pub fn is_upcast_safe(&mut self, source: TypeId, target: TypeId) -> bool {
        if let Some(&known) = self.aot.flows.seen_as.get(&(source, target)) {
            return known;
        }
        let not_known_before = self.aot.flows.unknown_count;
        let (opaque, any) = (self.restrictive_instantiation(source), self.permissive_instantiation(target));
        let is_seen = self.is_provably_assignable(opaque, any);
        if self.aot.flows.unknown_count == not_known_before {
            self.aot.flows.seen_as.insert((source, target), is_seen);
        }
        is_seen
    }

    pub fn record_upcast(&mut self, source: TypeId, target: TypeId) {
        let at = self.aot.flows.place;
        self.aot.flows.recorded.add_upcast((source, target), at);
    }

    pub fn type_declaration_site(&self, view: TypeId) -> Option<Place> {
        let named = |sym: Sym| {
            let declarations = self.files().decls_of(sym);
            let places = declarations.iter().filter_map(|&(file, decl)| {
                let hir = self.hir(file);
                Some(Place {
                    file,
                    pos: match decl {
                        Decl::Alias(alias) => hir[alias].name_pos,
                        Decl::Interface(interface) => hir[interface].name_pos,
                        Decl::Class(class) if hir[class].name.is_some() => hir[class].name_pos,
                        Decl::Class(class) => hir[class].start,
                        _ => return None,
                    },
                })
            });
            places.min()
        };
        if let Some((alias, _)) = self.alias_of_type(view) {
            return named(alias);
        }
        match *self.data(view) {
            TypeData::Ref { target, .. } => named(target),
            TypeData::Anon { origin: Origin::TypeLiteral(file, node), .. } => Some(Place { file, pos: self.hir(file)[node].pos }),
            TypeData::Anon { origin: Origin::ObjectLiteral(file, e, ..) | Origin::WidenedLiteral(file, e, ..), .. } => Some(Place { file, pos: self.hir(file)[e].pos }),
            _ => None,
        }
    }

    pub fn set_current_site(&mut self, file: FileId, pos: u32) {
        self.aot.flows.place = Place { file, pos };
    }

    pub fn common_supertype_of_union(&mut self, union: TypeId) -> TypeId {
        self.cached_derived_type(union, DerivedTypeKind::Union, Self::compute_common_supertype_of_union)
    }

    fn cached_derived_type(&mut self, ty: TypeId, kind: DerivedTypeKind, find: fn(&mut Self, TypeId) -> TypeId) -> TypeId {
        let is_result_cacheable = !self.results_are_provisional();
        if is_result_cacheable && let Some(&known) = self.aot.flows.derived_types.get(&(ty, kind)) {
            return known;
        }
        let careful_before = (self.stack_half_used_count(), self.aot.flows.unknown_count);
        let view = find(self, ty);
        if is_result_cacheable && careful_before == (self.stack_half_used_count(), self.aot.flows.unknown_count) {
            self.aot.flows.derived_types.insert((ty, kind), view);
        }
        view
    }

    fn compute_common_supertype_of_union(&mut self, union: TypeId) -> TypeId {
        let union = self.reduced(union);
        let view = self.union_as_record(union);
        for &part in self.parts(union) {
            if self.declares_properties(part) {
                let part = self.layout_defining_type(part);
                self.aot.flows.seen_as.insert((part, view), true);
            }
        }
        view
    }

    fn union_as_record(&mut self, union: TypeId) -> TypeId {
        let object = self.union_as_object(union);
        let Some(members) = self.members(object) else { return object };
        let mut shape = Shape::new_in(self.arena);
        for prop in members.shape().props.iter() {
            let ty = self.type_of_prop(prop, members.mapper);
            let flags = prop.flags & (PropFlags::OPTIONAL | PropFlags::METHOD | PropFlags::ACCESSOR);
            shape.props.push(Prop { name: prop.name, flags, source: PropSource::Type(ty), mapper: MapperId::IDENTITY, name_type: TypeId::UNRESOLVED });
        }
        self.sort_by_name(&mut shape);
        shape.index.extend(members.shape().index.iter().cloned());
        (shape.created_from, shape.spread_rank) = (Some((TypeId::NEVER, union)), u32::MAX - 1);
        self.synth(shape)
    }

    fn sort_by_name(&self, shape: &mut Shape<'_>) {
        let atoms = self.atoms();
        shape.props.sort_by(|a, b| atoms.bytes(a.name).cmp(atoms.bytes(b.name)));
    }

    pub fn union_all_members_type(&mut self, union: TypeId) -> TypeId {
        self.cached_derived_type(union, DerivedTypeKind::Either, Self::compute_union_all_members_type)
    }

    fn compute_union_all_members_type(&mut self, union: TypeId) -> TypeId {
        let union = self.reduced(union);
        let parts: Vec<TypeId> = self.parts(union).iter().copied().filter(|&part| self.declares_properties(part)).collect();
        self.record_with_all_names(&parts, (TypeId::NEVER, union))
    }

    fn coerced_unknown_type(&mut self, target: TypeId) -> TypeId {
        self.cached_derived_type(target, DerivedTypeKind::AnythingAs, Self::compute_coerced_unknown_type)
    }

    fn compute_coerced_unknown_type(&mut self, target: TypeId) -> TypeId {
        let parts: Vec<TypeId> = self.parts(target).to_vec();
        self.record_with_all_names(&parts, (TypeId::UNKNOWN, target))
    }

    pub fn is_coerced_unknown_type(&self, ty: TypeId) -> bool {
        matches!(self.data(ty), TypeData::Synth(shape) if shape.spread_rank == u32::MAX && matches!(shape.created_from, Some((TypeId::UNKNOWN, _))))
    }

    fn coercion_target(&self, ty: TypeId) -> TypeId {
        match self.data(ty) {
            TypeData::Synth(shape) if shape.spread_rank == u32::MAX => shape.created_from.map_or(ty, |made_for| made_for.1),
            _ => ty,
        }
    }

    pub fn is_coercion_result_type(&self, ty: TypeId) -> bool {
        matches!(self.data(ty), TypeData::Synth(shape) if shape.spread_rank == u32::MAX && shape.created_from.is_some())
    }

    fn record_with_all_names(&mut self, parts: &[TypeId], made_for: (TypeId, TypeId)) -> TypeId {
        let is_any_type = made_for.0 == TypeId::UNKNOWN;
        let mut of_parts = Vec::with_capacity(parts.len());
        for &part in parts {
            let apparent = self.apparent_type(part);
            of_parts.extend(self.members(apparent));
        }
        let mut shape = Shape::new_in(self.arena);
        let mut seen: FxHashSet<Atom> = FxHashSet::default();
        for members in &of_parts {
            for prop in members.shape().props.iter().filter(|prop| seen.insert(prop.name)) {
                let (mut types, mut is_optional, mut flags) = (Vec::new(), is_any_type, PropFlags::METHOD);
                for other in &of_parts {
                    let Some(found) = other.resolved.prop(prop.name) else {
                        is_optional = true;
                        continue;
                    };
                    types.push(self.type_of_prop(found, other.mapper));
                    is_optional |= found.flags.contains(PropFlags::OPTIONAL);
                    flags = (flags & found.flags) | (found.flags & PropFlags::ACCESSOR) | (flags & PropFlags::ACCESSOR);
                }
                if is_optional {
                    types.push(TypeId::UNDEFINED);
                    flags |= PropFlags::OPTIONAL;
                }
                let ty = self.union(&types);
                shape.props.push(Prop { name: prop.name, flags, source: PropSource::Type(ty), mapper: MapperId::IDENTITY, name_type: TypeId::UNRESOLVED });
            }
        }
        self.sort_by_name(&mut shape);
        (shape.created_from, shape.spread_rank) = (Some(made_for), u32::MAX);
        let view = self.synth(shape);
        for &part in parts {
            let part = self.layout_defining_type(part);
            self.aot.flows.seen_as.insert((part, view), true);
        }
        view
    }

    pub fn coerced_type(&mut self, source: TypeId, target: TypeId) -> TypeId {
        let original_target = target;
        let (source, target) = (self.reduced(source), self.reduced(target));
        let is_untyped = self.is_untyped(source);
        let may_be_any_object = is_untyped || self.has_multiple_primitive_kinds(source);
        if self.is_uninformative(target) || (!is_untyped && self.is_provably_assignable(source, target)) {
            return original_target;
        }
        let is_noop_cast_target = self.is_noop_cast_target(target);
        if is_noop_cast_target && !is_untyped {
            return self.union(&[target, source]);
        }
        let (mut views, mut parts, mut is_unchanged) = (Vec::new(), Vec::new(), true);
        for &part in self.parts(target) {
            if self.has_primitive_flag(part) {
                let widened = if self.is_number_like(part) {
                    TypeId::NUMBER
                } else if self.is_string_like(part) {
                    TypeId::STRING
                } else {
                    self.base_of_literal(part)
                };
                is_unchanged &= self.parts(widened).iter().all(|of_widened| self.parts(target).contains(of_widened));
                parts.push(widened);
            } else if is_untyped && self.can_be_created_from_any_object(part) {
                views.push(part);
            } else {
                parts.push(part);
            }
        }
        if !views.is_empty() {
            let views = self.union(&views);
            parts.push(self.coerced_unknown_type(views));
        }
        if is_noop_cast_target {
            parts.extend([TypeId::STRING, TypeId::NUMBER, TypeId::BOOLEAN, TypeId::BIGINT, TypeId::SYMBOL, TypeId::UNDEFINED, TypeId::NULL]);
        }
        let number_of_target = parts.len();
        if !is_noop_cast_target && self.cast_keeps_primitives(target) {
            if is_untyped {
                parts.extend([TypeId::STRING, TypeId::NUMBER, TypeId::BOOLEAN, TypeId::BIGINT, TypeId::SYMBOL]);
            } else {
                parts.extend(self.parts(source).iter().copied().filter(|&part| self.has_primitive_flag(part) && !part.is_undefined() && !part.is_null()));
            }
        }
        let objects: Vec<TypeId> = parts.iter().copied().filter(|&part| !self.has_primitive_flag(part)).collect();
        if may_be_any_object && objects.into_iter().all(|part| matches!(self.built_in_for_type(part), Some(BuiltIn::Function))) {
            parts.push(TypeId::OBJECT);
        }
        if !is_untyped {
            parts.extend(self.parts(source).iter().copied().filter(|&part| !self.has_primitive_flag(part)));
        }
        let is_kept_bare = self.parts(target).iter().all(|&part| self.has_primitive_flag(part)) && self.parts(target).iter().any(|&part| self.is_number_like(part) || part == TypeId::BOOLEAN || self.parts(TypeId::BOOLEAN).contains(&part));
        for nil in [TypeId::UNDEFINED, TypeId::NULL] {
            if is_kept_bare && (is_untyped || self.parts(source).contains(&nil)) && !parts.contains(&nil) {
                parts.push(nil);
            }
        }
        if is_unchanged && views.is_empty() && parts.len() == number_of_target { original_target } else { self.union(&parts) }
    }

    pub fn has_multiple_primitive_kinds(&mut self, ty: TypeId) -> bool {
        let ty = self.reduced(ty);
        let parts: Vec<TypeId> = self.parts(ty).to_vec();
        let mut kinds: Vec<TypeId> = Vec::new();
        for part in parts {
            if !self.has_primitive_flag(part) {
                return false;
            }
            if part.is_undefined() || part.is_null() {
                continue;
            }
            let kind = if self.is_number_like(part) {
                TypeId::NUMBER
            } else if self.is_string_like(part) {
                TypeId::STRING
            } else {
                self.base_of_literal(part)
            };
            if !kinds.contains(&kind) {
                kinds.push(kind);
            }
        }
        kinds.len() > 1
    }

    pub(super) fn can_be_created_from_any_object(&mut self, part: TypeId) -> bool {
        self.declares_properties(part)
            && self.has_properties(part)
            && self.array_subtype_element(part).is_none()
            && (self.built_in_for_type(part).is_none() || self.extends_error(part))
            && (!self.is_ambient_interface_type(part) || self.extends_error(part))
    }

    fn is_ambient_interface_type(&self, ty: TypeId) -> bool {
        match *self.data(ty) {
            TypeData::Ref { target, .. } => self.files().module(target.file).is_lib || self.is_ambient_interface(target),
            _ => false,
        }
    }

    fn extends_error(&mut self, ty: TypeId) -> bool {
        let Some(BuiltIn::Instance(class)) = self.built_in_for_type(ty) else { return false };
        matches!(*self.data(class), TypeData::Ref { target, .. } if self.atoms().bytes(self.files().symbol(target).name) == b"Error")
    }

    pub fn cast_keeps_primitives(&mut self, target: TypeId) -> bool {
        let target = self.reduced(target);
        let parts: Vec<TypeId> = self.parts(target).to_vec();
        if parts.iter().all(|&part| self.has_primitive_flag(part)) {
            return false;
        }
        parts.into_iter().any(|part| {
            if self.has_primitive_flag(part) {
                return !part.is_undefined() && !part.is_null();
            }
            if self.is_instantiable(part) {
                let bound = self.value_bound(part);
                return bound != part && (self.parts(bound).iter().any(|&of_bound| self.has_primitive_flag(of_bound) && !of_bound.is_undefined() && !of_bound.is_null()) || self.cast_keeps_primitives(bound));
            }
            !self.assignable_primitives(part).is_empty()
        })
    }

    pub fn is_noop_cast_target(&mut self, target: TypeId) -> bool {
        let target = self.reduced(target);
        let mut has_error = false;
        for &part in self.parts(target) {
            if part.is_undefined() || part.is_null() {
                continue;
            }
            if !self.extends_error(part) {
                return false;
            }
            has_error = true;
        }
        has_error
    }

    pub fn coerced_property_read(&mut self, file: FileId, e: ExprId) -> Option<(TypeId, TypeId)> {
        let ExprKind::Dot { obj, name, chain, .. } = self.hir(file)[e].kind else { return None };
        if matches!(self.hir(file)[obj].kind, ExprKind::Super) || !self.has_declared_type(file, e) {
            return None;
        }
        let known = self.result_type_of(file, obj);
        if known == self.type_of_expr(file, obj) || self.is_uninformative(known) {
            return None;
        }
        if self.is_primitive_by_type(file, obj) {
            return None;
        }
        let object = self.non_nullable(known);
        let is_any_type = self.parts(object).iter().any(|&part| self.is_coerced_unknown_type(part));
        let found = if is_any_type { None } else { self.type_of_property(object, name) };
        let target = self.type_of_expr(file, e);
        let may_be_missing = chain != Chain::No || found.is_none_or(|found| self.contains_undefined(found));
        let target = if may_be_missing { self.union(&[target, TypeId::UNDEFINED]) } else { target };
        Some((found.unwrap_or(TypeId::UNKNOWN), target))
    }

    pub fn is_primitive_by_type(&mut self, file: FileId, e: ExprId) -> bool {
        let declared = self.type_of_expr(file, e);
        let parts: Vec<TypeId> = self.parts(declared).to_vec();
        !self.is_uninformative(declared) && !parts.iter().all(|&part| self.is_nullish(part)) && parts.into_iter().all(|part| self.has_primitive_flag(part))
    }

    pub fn is_external_data_prediction(&self, _declared: TypeId) -> bool {
        false
    }

    pub fn is_asserted_at_use(&mut self, file: FileId, e: ExprId) -> bool {
        let declared = self.type_of_expr(file, e);
        self.is_primitive_by_type(file, e) && !self.is_external_data_prediction(declared)
    }

    pub fn record_untyped(&mut self, view: TypeId, source: TypeId) {
        let at = self.aot.flows.place;
        self.aot.flows.recorded.add_untyped(view, (source != TypeId::UNRESOLVED).then_some(source), at);
    }

    fn has_namespace_part(&self, ty: TypeId) -> bool {
        self.parts(ty).iter().any(|&part| matches!(self.data(part), TypeData::Anon { origin: Origin::Module(..), .. }))
    }

    pub fn calls_global_static_method(&mut self, file: FileId, e: ExprId, name: Atom) -> bool {
        let ExprKind::Call(call) = self.hir(file)[e].kind else { return false };
        let ExprKind::Dot { obj, chain: Chain::No, .. } = self.hir(file)[self.hir(file)[call].callee].kind else { return false };
        let name = self.atoms().bytes(name).to_vec();
        self.hir(file)[call].chain == Chain::No && self.refers_to_global_object(file, obj, &name)
    }

    pub fn constructs_global_object(&mut self, file: FileId, e: ExprId, name: Atom) -> bool {
        let ExprKind::New(call) = self.hir(file)[e].kind else { return false };
        let (callee, name) = (self.hir(file)[call].callee, self.atoms().bytes(name).to_vec());
        self.refers_to_global_object(file, callee, &name)
    }

    pub fn creates_proxy(&mut self, file: FileId, e: ExprId) -> bool {
        let hir = self.hir(file);
        match hir[e].kind {
            ExprKind::As { expr: inner, .. } | ExprKind::NonNull(inner) | ExprKind::Satisfies { expr: inner, .. } => self.creates_proxy(file, inner),
            ExprKind::Cond { yes, no, .. } => self.creates_proxy(file, yes) || self.creates_proxy(file, no),
            ExprKind::New(call) => self.refers_to_global_object(file, hir[call].callee, b"Proxy"),
            _ => false,
        }
    }

    pub fn may_return_namespace(&mut self, file: FileId, e: ExprId) -> bool {
        let hir = self.hir(file);
        match hir[e].kind {
            ExprKind::ImportCall { .. } => true,
            ExprKind::Await(inner) | ExprKind::As { expr: inner, .. } | ExprKind::NonNull(inner) | ExprKind::Satisfies { expr: inner, .. } => self.may_return_namespace(file, inner),
            ExprKind::Cond { yes, no, .. } => self.may_return_namespace(file, yes) || self.may_return_namespace(file, no),
            ExprKind::Call(call) if matches!(hir[hir[call].callee].kind, ExprKind::Ident(name) if self.atoms().bytes(name) == b"require") => true,
            _ => {
                let own = self.type_of_expr(file, e);
                if let Some(known) = self.shared_type_flag(own, type_flags::NAMESPACE_TEST_KNOWN, type_flags::MAY_BE_NAMESPACE) {
                    return known;
                }
                let (found, is_cacheable) = self.compute_cacheable(|c| {
                    let awaited = c.awaited(own);
                    c.has_namespace_part(own) || c.has_namespace_part(awaited)
                });
                if is_cacheable {
                    self.publish_type_flag(own, type_flags::NAMESPACE_TEST_KNOWN, type_flags::MAY_BE_NAMESPACE, found);
                }
                found
            }
        }
    }

    pub(super) fn recorded_creations(&mut self) -> &mut Creations {
        &mut self.aot.flows.recorded.others().creations
    }

    pub(super) fn notes(&mut self) -> &mut FlowNotes {
        &mut self.aot.flows.recorded
    }

    pub(super) fn recorded_escapes(&mut self) -> &mut Escapes {
        &mut self.aot.flows.recorded.escapes
    }

    pub(super) fn recorded_constructions(&mut self) -> &mut Constructions {
        &mut self.aot.flows.recorded.others().constructions
    }

    pub fn record_stored_callee(&mut self, holder: TypeId, name: Atom, file: FileId, value: ExprId, is_birth: bool) {
        let callee = self.result_callees_of(file, value, 0).callee;
        if callee != Callee::Nothing {
            let recorded = self.aot.flows.recorded.others();
            join_callee(if is_birth { &mut recorded.callees_at_creation } else { &mut recorded.callees_stored }, (holder, name), callee);
        }
    }

    pub fn record_declared_callee(&mut self, holder: TypeId, name: Atom, file: FileId, func: FnId) {
        join_callee(&mut self.aot.flows.recorded.others().callees_stored, (holder, name), Callee::One(file, func));
    }

    pub fn record_unknown_callee(&mut self, holder: TypeId, name: Atom, file: FileId, pos: u32) {
        join_callee(&mut self.aot.flows.recorded.others().callees_stored, (holder, name), Callee::Unknown(Place { file, pos }));
    }

    pub fn record_allocation(&mut self, ty: TypeId) {
        let ty = self.layout_defining_type(ty);
        self.aot.flows.recorded.add_at(NoteKind::AllocatedAtSite, ty, Place::NOWHERE);
    }

    pub fn intersection_for_forced_cast(&mut self, source: TypeId, target: TypeId) -> Option<TypeId> {
        let not_known_before = self.aot.flows.unknown_count;
        if self.is_coercion_result_type(source) || self.is_coercion_result_type(target) {
            return None;
        }
        let have_fixed_layout = self.declares_properties(source) && self.declares_properties(target) && !self.is_instance_type(source) && !self.is_instance_type(target);
        if !have_fixed_layout || self.is_allocated_subtype(target, source) || self.is_allocated_subtype(source, target) || self.aot.flows.unknown_count != not_known_before {
            return None;
        }
        let both = self.intersection(&[source, target]);
        let both = self.layout_defining_type(both);
        matches!(self.data(both), TypeData::Intersection(_)).then_some(both)
    }

    pub fn record_cast(&mut self, sources: &[TypeId], target: TypeId, may_be_plain: bool, is_trusted: bool, may_convert: bool, is_guard: bool) {
        let at = self.aot.flows.place;
        if may_be_plain && !self.is_instance_type(target) {
            self.aot.flows.recorded.add_at(NoteKind::CopiedInto, target, Place::NOWHERE);
        }
        if is_trusted {
            self.aot.flows.recorded.add_trusted_inflow(target, at);
        }
        let recorded = &mut self.aot.flows.recorded;
        recorded.add_pairs_into(if may_convert { NoteKind::Cast } else { NoteKind::Test }, sources, target);
        if !may_convert {
            return;
        }
        if is_guard {
            recorded.add_pairs_into(NoteKind::Guard, sources, target);
        }
        if let TypeData::Intersection(parts) = self.data(target) {
            for &part in parts.iter() {
                if self.declares_properties(part) {
                    let part = self.layout_defining_type(part);
                    self.aot.flows.recorded.add_pair(NoteKind::Cast, part, target);
                }
            }
        }
    }

    pub fn record_forced_cast(&mut self, sources: &[TypeId], target: TypeId) {
        self.aot.flows.recorded.add_pairs_into(NoteKind::Forced, sources, target);
    }

    pub fn record_unverified_overload_result(&mut self, sources: &[TypeId], target: TypeId) {
        self.aot.flows.recorded.add_pairs_into(NoteKind::UnverifiedOverloadResult, sources, target);
    }

    pub fn declared_call_result(&mut self, file: FileId, e: ExprId) -> Option<TypeId> {
        let sig = self.resolved_signature(file, e).sig?;
        let (of, func, _) = self.sig_decl(sig)?;
        let declared = self.return_type_of_fn(of, func);
        (declared != self.sig_return(sig)).then_some(declared)
    }

    pub fn returned_argument_of(&mut self, file: FileId, e: ExprId) -> Option<ExprId> {
        const NAMES: [&[u8]; 7] = [b"assign", b"freeze", b"seal", b"preventExtensions", b"defineProperty", b"defineProperties", b"setPrototypeOf"];
        let hir = self.hir(file);
        let ExprKind::Call(call) = hir[e].kind else { return None };
        let ExprKind::Dot { obj, name, chain: Chain::No, .. } = hir[hir[call].callee].kind else { return None };
        if name.is_none() || !matches!(hir[obj].kind, ExprKind::Ident(known::Object)) || !NAMES.contains(&self.atoms().bytes(name)) || !self.refers_to_global_object(file, obj, b"Object") {
            return None;
        }
        let first = hir.ids(hir[call].args).next().filter(|&first| !matches!(hir[first].kind, ExprKind::Spread(_) | ExprKind::Missing))?;
        let (declared_in, func, _) = self.resolved_signature(file, e).sig.and_then(|sig| self.sig_decl(sig))?;
        let (of, bound) = (self.hir(declared_in), self.bound(declared_in));
        let FnOwner::Member(member) = bound.fns[func.idx()].owner else { return None };
        let MemberOwner::Interface(interface) = bound.member_owner[member.idx()] else { return None };
        let is_global_object = of.kind == FileKind::Declaration && of[func].name.is_some() && NAMES.contains(&self.atoms().bytes(of[func].name)) && self.atoms().bytes(of[interface].name) == b"ObjectConstructor";
        is_global_object.then_some(first)
    }

    pub fn generic_callback_parameters(&mut self, file: FileId, e: ExprId) -> Vec<(TypeId, TypeId)> {
        let mut pairs = Vec::new();
        let (hir, bound) = (self.hir(file), self.bound(file));
        let Parent::Expr(parent) = bound.expr_parent[e.idx()] else { return pairs };
        let (ExprKind::Call(call) | ExprKind::New(call)) = hir[parent].kind else { return pairs };
        if hir.ids(hir[call].args).any(|argument| matches!(hir[argument].kind, ExprKind::Spread(_))) {
            return pairs;
        }
        let Some(index) = hir.ids(hir[call].args).position(|argument| argument == e) else { return pairs };
        let Some((declared_in, func, _)) = self.resolved_signature(file, parent).sig.and_then(|sig| self.sig_decl(sig)) else { return pairs };
        if self.is_untyped_file(declared_in) || self.is_declaration_only(declared_in) {
            return pairs;
        }
        let generic = self.sig_of_fn(declared_in, func);
        if self.sig_type_params(generic).is_empty() {
            return pairs;
        }
        let taken = self.sig_params(generic);
        let Some(callback) = self.param_type_at(&taken, index) else { return pairs };
        let handed_over = self.type_of_expr(file, e);
        if self.parts(handed_over).to_vec().into_iter().all(|own| self.signatures(own, false).is_empty()) {
            return pairs;
        }
        for part in self.parts(callback).to_vec() {
            if !self.is_generic_callback(part) {
                continue;
            }
            for called_as in self.signatures(part, false).to_vec() {
                let arguments = self.sig_params(called_as);
                for own in self.parts(handed_over).to_vec() {
                    for declared_sig in self.signatures(own, false).to_vec() {
                        let parameters = self.sig_params(declared_sig);
                        for at in 0..parameters.len() {
                            if let (Some(argument), Some(parameter)) = (self.param_type_at(&arguments, at), self.param_type_at(&parameters, at))
                                && self.is_instantiable(argument)
                            {
                                pairs.push((argument, parameter));
                            }
                        }
                    }
                }
            }
        }
        pairs
    }

    fn is_generic_callback(&mut self, callback: TypeId) -> bool {
        if let Some(known) = self.shared_type_flag(callback, type_flags::GENERIC_CALLBACK_KNOWN, type_flags::IS_GENERIC_CALLBACK).or_else(|| self.aot.flows.generic_callback_cache.get(&callback).copied()) {
            return known;
        }
        let (scope, mark) = (self.begin_scope(), self.non_cacheable_mark());
        let apparent = self.reduced_apparent_type(callback);
        let may_be = !self.is_union(apparent) || self.union_has_generic_callback(apparent);
        let is_settled = self.non_cacheable_mark() == mark;
        if self.end_scope(scope).is_ok() && is_settled && !self.publish_type_flag(callback, type_flags::GENERIC_CALLBACK_KNOWN, type_flags::IS_GENERIC_CALLBACK, may_be) {
            self.aot.flows.generic_callback_cache.insert(callback, may_be);
        }
        may_be
    }

    fn union_has_generic_callback(&mut self, union: TypeId) -> bool {
        #[derive(Copy, Clone, PartialEq)]
        enum CommonType {
            Unseen,
            Instantiable(TypeId),
            Rejected,
        }
        let mut callbacks: Vec<(SigId, usize, bool)> = Vec::new();
        for &member in self.parts(union) {
            let signatures = self.signatures(member, false);
            let &[only] = &signatures[..] else { return true };
            if !self.sig_type_params(only).is_empty() {
                return true;
            }
            let declared_count = match *self.types().sig(only) {
                crate::types::SigData::Decl { file, func, .. } => {
                    let hir = self.hir(file);
                    let has_rest = hir[func].params.iter().next_back().is_some_and(|last| hir[last].flags.contains(crate::hir::Flags::REST));
                    (!has_rest).then(|| hir[func].params.len())
                }
                _ => None,
            };
            let (count, has_rest) = match declared_count {
                Some(count) => (count, false),
                None => {
                    let parameters = self.sig_params(only);
                    if parameters.last().is_some_and(|last| last.rest && self.array_element(last.ty).is_none()) {
                        return true;
                    }
                    (parameters.len(), parameters.last().is_some_and(|last| last.rest))
                }
            };
            callbacks.push((only, count, has_rest));
        }
        let positions = 1 + callbacks.iter().map(|callback| callback.1).max().unwrap_or(0);
        let mut common = vec![CommonType::Unseen; positions];
        for (signature, count, has_rest) in callbacks {
            let reached = if has_rest { positions } else { count };
            if common[..reached].iter().all(|&state| state == CommonType::Rejected) {
                continue;
            }
            let parameters = self.sig_params(signature);
            for at in 0..reached {
                if common[at] == CommonType::Rejected {
                    continue;
                }
                match self.param_type_at(&parameters, at) {
                    None | Some(TypeId::UNKNOWN) => {}
                    Some(ty) => {
                        common[at] = match common[at] {
                            CommonType::Unseen if self.is_instantiable(ty) => CommonType::Instantiable(ty),
                            CommonType::Instantiable(other) if other == ty => CommonType::Instantiable(ty),
                            _ => CommonType::Rejected,
                        }
                    }
                }
            }
        }
        common.iter().any(|state| matches!(state, CommonType::Instantiable(_)))
    }

    pub fn is_parameter_type_inferred_from_arguments(&mut self, file: FileId, e: ExprId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let Parent::Expr(parent) = bound.expr_parent[e.idx()] else { return false };
        let (ExprKind::Call(call) | ExprKind::New(call)) = hir[parent].kind else { return false };
        if hir.ids(hir[call].type_args).next().is_some() || hir.ids(hir[call].args).any(|argument| matches!(hir[argument].kind, ExprKind::Spread(_))) {
            return false;
        }
        let Some(index) = hir.ids(hir[call].args).position(|argument| argument == e) else { return false };
        let Some(sig) = self.resolved_signature(file, parent).sig else { return false };
        let Some((declared_in, func, _)) = self.sig_decl(sig) else { return false };
        let declared = self.sig_of_fn(declared_in, func);
        let parameters = self.sig_params(declared);
        let Some(taking) = self.param_type_at(&parameters, index) else { return false };
        self.sig_type_params(declared).contains(&taking)
    }

    pub fn accepts_undefined(&mut self, ty: TypeId) -> bool {
        self.accepts_nullish(ty) || self.parts(ty).iter().any(|&part| part.is_any() || part.is_undefined() || matches!(part, TypeId::UNKNOWN | TypeId::VOID | TypeId::UNRESOLVED) || self.is_instantiable(part))
    }

    pub fn record_object_without_layout(&mut self, ty: TypeId) {
        self.aot.flows.recorded.add_at(NoteKind::NoFixedLayout, ty, Place::NOWHERE);
    }

    pub fn record_expression_type(&mut self, ty: TypeId) {
        for &part in self.parts(ty) {
            if matches!(self.data(part), TypeData::Intersection(_)) && (self.array_subtype_element(part).is_some() || self.extended_built_in(part).is_some()) {
                self.aot.flows.recorded.add_at(NoteKind::NoFixedLayout, part, Place::NOWHERE);
            }
            if let TypeData::Anon { origin: Origin::Module(module), .. } = *self.data(part) {
                let declarations = self.files().decls(module);
                let is_allocated_in_blocks = !declarations.is_empty() && declarations.iter().all(|&(file, decl)| matches!(decl, Decl::Module(_)) && !self.is_declaration_only(file) && !self.files().module(file).is_untyped());
                if !is_allocated_in_blocks {
                    self.aot.flows.recorded.add_at(NoteKind::NoFixedLayout, part, Place::NOWHERE);
                }
            }
        }
    }

    pub fn call_results(&mut self, ty: TypeId) -> Vec<TypeId> {
        let mut results = Vec::new();
        if ty == TypeId::UNRESOLVED {
            return results;
        }
        for &part in self.parts(ty) {
            for constructs in [false, true] {
                for &sig in self.signatures(part, constructs).iter() {
                    results.push(self.sig_return(sig));
                }
            }
        }
        results
    }

    pub fn produced_types(&mut self, ty: TypeId) -> Vec<TypeId> {
        let mut found = self.call_results(ty);
        if ty == TypeId::UNRESOLVED {
            return found;
        }
        for part in self.parts(ty).to_vec() {
            let is_namespace = matches!(self.data(part), TypeData::Anon { origin: Origin::Module(..), .. });
            if !is_namespace && (!self.is_program_declared_record(part) || self.is_instance_type(part)) {
                continue;
            }
            let Some(members) = self.members(part) else { continue };
            for prop in members.shape().props.iter() {
                let held = self.type_of_prop(prop, members.mapper);
                if is_namespace {
                    found.push(held);
                }
                found.extend(self.call_results(held));
            }
        }
        found
    }

    pub fn is_untyped(&mut self, ty: TypeId) -> bool {
        if ty == TypeId::UNRESOLVED {
            return false;
        }
        if !self.results_are_provisional()
            && let Some(&known) = self.aot.flows.untyped.get(&ty)
        {
            return known;
        }
        let (found, is_cacheable) = self.compute_cacheable(|c| c.compute_is_untyped(ty));
        if is_cacheable {
            self.aot.flows.untyped.insert(ty, found);
        }
        found
    }

    fn compute_is_untyped(&mut self, ty: TypeId) -> bool {
        self.parts(ty).iter().any(|&part| {
            let part = if self.is_instantiable(part) { self.base_constraint(part) } else { part };
            part.is_any() || part == TypeId::UNKNOWN || part == TypeId::OBJECT || self.accepts_primitives(part)
        })
    }

    pub fn record_types_staying_untyped(&mut self, ty: TypeId, is_in_container: bool, origin: DataOrigin) {
        if ty == TypeId::UNRESOLVED {
            return;
        }
        let views = self.nested_types_staying_untyped(ty, is_in_container);
        if origin.is_known_plain_data() {
            for &view in views.iter() {
                self.record_untyped(view, TypeId::UNRESOLVED);
            }
        }
    }

    #[inline]
    fn is_declared_externally(&self, ty: TypeId) -> bool {
        self.row(ty) & type_flags::IS_DECLARED_EXTERNALLY != 0
    }

    pub(super) fn explain_taint(&mut self) -> Vec<String> {
        let files = self.files();
        let mut seen: FxHashSet<Sym> = FxHashSet::default();
        let mut declared: Vec<Sym> = Vec::new();
        for (file, module) in files.modules.iter().enumerate() {
            if module.is_untyped() || self.is_declaration_only(FileId(file as u32)) {
                continue;
            }
            for (id, symbol) in module.bound.symbols.iter().enumerate() {
                let sym = files.sym(FileId(file as u32), SymbolId(id as u32));
                if symbol.flags.intersects(SymFlags::CLASS | SymFlags::INTERFACE) && seen.insert(sym) {
                    declared.push(sym);
                }
            }
        }
        let external_types = self.external_types();
        let (mut all, mut by_identity, mut by_looks, mut otherwise) = (0u32, 0u32, 0u32, 0u32);
        let mut lost: Vec<String> = Vec::new();
        let mut external_by_nature: Vec<String> = Vec::new();
        for sym in declared {
            let ty = self.declared_type(sym);
            if !self.declares_properties(ty) || !self.may_hold_objects(ty) || self.is_declared_externally(ty) {
                continue;
            }
            all += 1;
            if !self.is_tainted(ty) {
                continue;
            }
            let identity = self.type_identity(ty);
            if external_types.identities.contains(&identity) {
                by_identity += 1;
                external_by_nature.push(self.display_name(ty));
            } else if self.accepts_external_data(ty, external_types) {
                by_looks += 1;
                if lost.len() < 8 {
                    let name = self.display_name(ty);
                    lost.push(format!("mutations: given: where: by its looks: {name}"));
                }
            } else {
                otherwise += 1;
            }
        }
        let mut lines = vec![format!("mutations: given: of the {all} classes and interfaces that compiled files declare, data from outside is looked at as {by_identity} by what they are, {by_looks} by their looks, {otherwise} otherwise; {} types are given", external_types.identities.len())];
        lines.append(&mut lost);
        external_by_nature.sort();
        lines.extend(external_by_nature.iter().take(40).map(|name| format!("mutations: given: where: by what it is: {name}")));
        lines
    }

    pub fn is_tainted(&mut self, ty: TypeId) -> bool {
        if let Some(known) = self.shared_type_flag(ty, type_flags::TAINT_KNOWN, type_flags::IS_TAINTED) {
            return known;
        }
        let is_computed_now = !self.aot.flows.tainted.contains_key(&ty);
        let (is_tainted, is_cacheable) = self.compute_cacheable(|c| c.compute_is_tainted(ty));
        if is_computed_now && is_cacheable && !matches!(self.data(ty), TypeData::Anon { origin: Origin::ObjectLiteral(..) | Origin::WidenedLiteral(..), .. }) {
            self.publish_type_flag(ty, type_flags::TAINT_KNOWN, type_flags::IS_TAINTED, is_tainted);
        }
        is_tainted
    }

    fn compute_is_tainted(&mut self, ty: TypeId) -> bool {
        if self.aot.flows.is_searching_from_sources || !(self.declares_properties(ty) || self.is_array_or_tuple(ty)) {
            return false;
        }
        if let Some(&known) = self.aot.flows.tainted.get(&ty) {
            return known;
        }
        if !self.may_hold_objects(ty) || self.is_declared_externally(ty) {
            self.aot.flows.tainted.insert(ty, false);
            return false;
        }
        let external_types = self.external_types();
        if external_types.identities.is_empty() {
            return false;
        }
        self.aot.flows.tainted.insert(ty, false);
        self.aot.flows.taint_query_depth += 1;
        let identity = self.type_identity(ty);
        let is_tainted = external_types.identities.contains(&identity) || self.accepts_external_data(ty, external_types) || self.is_literal_type_of_external_data(ty, external_types) || self.is_plain_literal_type(ty);
        self.aot.flows.taint_query_depth -= 1;
        self.aot.flows.tainted.insert(ty, is_tainted);
        is_tainted
    }

    fn is_literal_type_of_external_data(&mut self, ty: TypeId, external_types: &ExternalTypes) -> bool {
        if !matches!(self.data(ty), TypeData::Anon { origin: Origin::ObjectLiteral(..), .. }) {
            return false;
        }
        let regular = self.regular_type_of_object_literal(ty);
        let widened = self.get_widened_type(regular);
        [regular, widened].into_iter().any(|other| other != ty && external_types.identities.contains(&self.type_identity(other)))
    }

    fn is_plain_literal_type(&mut self, ty: TypeId) -> bool {
        let (TypeData::Anon { origin: Origin::ObjectLiteral(file, literal, ..), .. } | TypeData::Anon { origin: Origin::WidenedLiteral(file, literal, ..), .. }) = *self.data(ty) else { return false };
        matches!(self.hir(file)[literal].kind, ExprKind::Object(_)) && self.contextual_type_of_literal(file, literal).is_some_and(|expected| self.has_tainted_part(expected))
    }

    pub(super) fn is_searching_from_sources(&self) -> bool {
        self.aot.flows.is_searching_from_sources
    }

    fn external_types(&mut self) -> &'p ExternalTypes {
        let program = self.p;
        if let Some(external_types) = program.aot.storage.external_types.get() {
            return external_types;
        }
        assert!(!program.aot.storage.is_search_under_way.load(Ordering::Relaxed), "what the program is given is asked for while the search for it is under way");
        let search = Search { seen_by_other_declarations: self.importers_with_other_declarations(), ..Search::new(1) };
        let mut searcher = program.checker();
        searcher.begin_task(0, 0, true);
        (searcher.stack_base, searcher.stack_limit) = (self.stack_base, self.stack_limit);
        searcher.aot.flows.is_searching_from_sources = true;
        searcher.search_from_sources(&search, 0, &FilePartition::Rest { index: 0, of: 1, is_taken: &[] }, &FxHashMap::default());
        drop(searcher);
        program.aot.storage.external_types.get_or_init(|| search.found())
    }

    fn property_summary(&mut self, ty: TypeId) -> Option<Vec<(Box<[u8]>, ValueSummary)>> {
        if self.is_array_or_tuple(ty) {
            return None;
        }
        let mut properties = Vec::new();
        if let Some(members) = self.members(ty) {
            for prop in members.shape().props.iter() {
                let name: Box<[u8]> = self.atoms().bytes(prop.name).into();
                if is_keyed_by_symbol(&name) {
                    continue;
                }
                let of_prop = self.type_of_prop(prop, members.mapper);
                properties.push((name, self.value_summary(of_prop)));
            }
        }
        properties.sort_unstable_by(|one, other| one.0.cmp(&other.0));
        Some(properties)
    }

    fn value_summary(&mut self, ty: TypeId) -> ValueSummary {
        let ty = self.reduced(ty);
        let mut said = ValueSummary { kinds: self.declared_value_kinds(ty), strings: Vec::new(), numbers: Vec::new() };
        for literal in self.type_literals(ty) {
            match literal {
                Literal::String(text) => said.strings.push(self.atoms().bytes(text).into()),
                Literal::Number(number) => said.numbers.push(number.to_bits()),
            }
        }
        said.strings.sort_unstable();
        said.numbers.sort_unstable();
        said
    }

    fn declared_value_kinds(&mut self, ty: TypeId) -> u16 {
        let ty = self.reduced(ty);
        match self.data(ty) {
            TypeData::Union(parts) => parts.iter().copied().fold(0, |all, part| all | self.declared_value_kinds(part)),
            TypeData::Intrinsic(intrinsic) => match intrinsic {
                Intrinsic::String => said::STRING,
                Intrinsic::Number => said::NUMBER,
                Intrinsic::BigInt => said::BIGINT,
                Intrinsic::Symbol => said::SYMBOL,
                Intrinsic::Object => said::RECORDS | said::ARRAYS | said::FUNCTIONS,
                Intrinsic::Unknown => said::UNKNOWN,
                Intrinsic::Undefined | Intrinsic::Missing | Intrinsic::UndefinedWidening | Intrinsic::Null | Intrinsic::NullWidening | Intrinsic::Never => 0,
                _ => said::ANYTHING,
            },
            TypeData::StringLit { .. } | TypeData::EnumLit { value: EnumValue::String(_), .. } | TypeData::Template { .. } | TypeData::StringMapping { .. } => said::STRING,
            TypeData::NumberLit { .. } | TypeData::EnumLit { value: EnumValue::Number(_), .. } => said::NUMBER,
            TypeData::BigIntLit { .. } => said::BIGINT,
            TypeData::BoolLit { value: true, .. } => said::TRUE,
            TypeData::BoolLit { .. } => said::FALSE,
            TypeData::UniqueSymbol { .. } => said::SYMBOL,
            TypeData::Ref { .. } | TypeData::Tuple { .. } | TypeData::Anon { .. } | TypeData::Synth(_) | TypeData::ReverseMapped { .. } | TypeData::Fns { .. } => {
                if self.is_array_or_tuple(ty) || self.array_subtype_element(ty).is_some() {
                    said::ARRAYS
                } else if self.is_declared_externally(ty) || self.is_empty_object_type(ty) {
                    said::ANYTHING
                } else if matches!(self.built_in_for_type(ty), Some(BuiltIn::Function)) {
                    said::FUNCTIONS
                } else {
                    said::RECORDS
                }
            }
            _ => said::ANYTHING,
        }
    }

    fn accepts_external_data(&mut self, ty: TypeId, external_types: &ExternalTypes) -> bool {
        self.external_data_accepted_by(ty, external_types).is_some()
    }

    fn external_data_accepted_by(&mut self, ty: TypeId, external_types: &ExternalTypes) -> Option<u32> {
        if !self.declares_properties(ty) || self.is_instance_type(ty) || self.built_in_for_type(ty).is_some() || self.array_subtype_element(ty).is_some() {
            return None;
        }
        let members = self.members(ty)?;
        if external_types.continued_by_pairs
            && members.shape().props.len() <= MAX_IN_PLACE_CONVERSION_PROPERTIES
            && (members.shape().props.iter().filter(|prop| !prop.flags.contains(PropFlags::OPTIONAL)).count() >= 2
                || (matches!(self.data(ty), TypeData::Ref { .. }) || self.alias_of_type(ty).is_some())
                    && self.generic_form(ty).and_then(|form| self.members(form)).unwrap_or(members).shape().props.iter().any(|prop| {
                        let held = self.type_of_prop(prop, MapperId::IDENTITY);
                        let held = if self.is_instantiable(held) { self.base_constraint(held) } else { held };
                        self.is_uninformative(held) || self.may_hold_objects(held) || self.parts(held).iter().any(|&part| matches!(self.data(part), TypeData::Fns { .. }))
                    }))
        {
            return None;
        }
        let atoms = self.atoms();
        let names: Vec<(&[u8], bool)> = members.shape().props.iter().map(|prop| (atoms.bytes(prop.name), prop.flags.contains(PropFlags::OPTIONAL))).filter(|name| !is_keyed_by_symbol(name.0)).collect();
        let none = Vec::new();
        let having = |name: &[u8]| external_types.by_name.get(name).unwrap_or(&none);
        let lists: Vec<&Vec<u32>> = match names.iter().filter(|name| !name.1).map(|name| having(name.0)).min_by_key(|having| having.len()) {
            Some(fewest) => vec![fewest],
            None => names.iter().map(|name| having(name.0)).collect(),
        };
        let mut taken: Vec<(&[u8], ValueSummary)> = Vec::new();
        for &index in lists.into_iter().flatten() {
            let held = &external_types.properties[index as usize];
            if !names.iter().all(|&(name, is_optional)| is_optional || held.contains_key(name)) {
                continue;
            }
            if taken.is_empty() {
                for prop in members.shape().props.iter() {
                    let of_prop = self.type_of_prop(prop, members.mapper);
                    taken.push((atoms.bytes(prop.name), self.value_summary(of_prop)));
                }
            }
            if taken.iter().all(|(name, taken)| held.get(*name).is_none_or(|held| held.may_be_assignable_to(taken))) {
                return Some(index);
            }
        }
        None
    }

    pub(super) fn external_type_resembled_by(&mut self, ty: TypeId) -> Option<Identity> {
        let external_types = self.external_types();
        if external_types.identities.contains(&self.type_identity(ty)) || !self.is_tainted(ty) {
            return None;
        }
        let resembled = self.external_data_accepted_by(ty, external_types)?;
        external_types.property_owners.get(resembled as usize).copied()
    }

    pub fn is_external_data(&mut self, file: FileId, e: ExprId) -> bool {
        let own = self.type_of_expr(file, e);
        self.has_tainted_part(own) || self.unverified_claim(file, e).is_some() || self.is_predicted(file, e)
    }

    pub fn count_partially_tainted_unions(&mut self) -> (usize, usize, usize) {
        let (mut in_part, mut by_looks, mut all) = (0, 0, 0);
        for file in (0..self.files().modules.len() as u32).map(FileId) {
            if self.hir(file).kind == FileKind::Declaration || self.is_untyped_file(file) {
                continue;
            }
            let hir = self.hir(file);
            for (index, node) in hir.types.iter().enumerate() {
                if !matches!(node.kind, crate::hir::TypeNodeKind::Union(_)) {
                    continue;
                }
                let union = self.type_from_node(file, TypeNodeId(index as u32));
                let (mut tainted, mut found, mut records) = (0, 0, 0);
                for member in self.parts(union).to_vec() {
                    let member = self.reduced(member);
                    if self.declares_properties(member) && !self.is_instance_type(member) && self.built_in_for_type(member).is_none() && self.array_subtype_element(member).is_none() && !self.is_declared_externally(member) {
                        records += 1;
                        if self.is_tainted(member) {
                            tainted += 1;
                            let identity = self.type_identity(member);
                            found += usize::from(self.external_types().identities.contains(&identity));
                        }
                    }
                }
                if records > 1 {
                    all += 1;
                    if tainted != 0 && tainted != records {
                        in_part += 1;
                        by_looks += usize::from(found == 0);
                    }
                }
            }
        }
        (in_part, by_looks, all)
    }

    pub fn is_any_type_tainted(&mut self) -> bool {
        !self.aot.flows.is_searching_from_sources && !self.external_types().identities.is_empty()
    }

    pub(super) fn never_has_fixed_layout(&mut self, ty: TypeId) -> bool {
        let (mut seen, mut found) = (FxHashSet::default(), Vec::new());
        self.add_object_types_in(ty, true, &mut seen, &mut found);
        found.is_empty()
    }

    pub fn has_tainted_part(&mut self, ty: TypeId) -> bool {
        if !matches!(self.data(ty), TypeData::Union(_)) {
            return self.is_tainted(ty);
        }
        if !self.is_any_type_tainted() {
            return false;
        }
        if let Some(&known) = self.aot.flows.with_tainted_part.get(&ty) {
            return known;
        }
        let parts: Vec<TypeId> = self.parts(ty).to_vec();
        let has_one = parts.into_iter().any(|part| self.is_tainted(part));
        if self.aot.flows.taint_query_depth == 0 {
            self.aot.flows.with_tainted_part.insert(ty, has_one);
        }
        has_one
    }

    pub fn is_of_tainted_type(&mut self, file: FileId, e: ExprId) -> bool {
        let own = self.type_of_expr(file, e);
        self.has_tainted_part(own)
    }

    pub fn search_in_parallel(&mut self, meeting: &SearchBarrier, index: usize, share: &FilePartition<'_>) {
        let program = self.p;
        let own_pairs = self.compared_targets_by_source();
        self.aot = Default::default();
        self.aot.flows.is_searching_from_sources = true;
        self.aot.flows.seen_before.clone_from(&meeting.search.seen_before);
        if let FilePartition::Rest { .. } = share {
            for file in (0..program.files.modules.len() as u32).map(FileId) {
                if self.is_untyped_file(file) {
                    self.task.begin_file(file, false);
                }
            }
        }
        self.search_from_sources(&meeting.search, index, share, &own_pairs);
        if meeting.barrier.wait() {
            let _ = program.aot.storage.external_types.set(meeting.search.found());
        }
        meeting.barrier.wait();
        self.aot = Default::default();
    }

    fn visit_external_sources(&mut self, search: &Search, share: &FilePartition<'_>, coercion_targets: &mut Vec<TypeId>, despecialized: &mut Vec<TypeId>, looked_at: &mut Vec<InspectedCast>, written_unions: &mut Vec<WrittenUnion>) -> bool {
        let count = self.files().modules.len() as u32;
        let all = move || (0..count).map(FileId);
        let weights: Vec<u64> = all().map(|file| self.hir(file).exprs.len() as u64 + 1).collect();
        let mine: FxHashSet<FileId> = if let FilePartition::Files(mine) = share { mine.iter().copied().collect() } else { FxHashSet::default() };
        let own = |files: &[FileId]| -> Vec<FileId> {
            match *share {
                FilePartition::Files(_) => files.iter().copied().filter(|file| mine.contains(file)).collect(),
                FilePartition::Rest { index, of, is_taken } => {
                    let left: Vec<FileId> = files.iter().copied().filter(|file| !is_taken.get(file.idx()).copied().unwrap_or(false)).collect();
                    share_by_weight(&left, &weights, index, of)
                }
            }
        };
        let placeholder: FxHashMap<&[u8], FileId> = (all().filter(|&file| self.is_declaration_only(file) && self.hir(file).kind != FileKind::Declaration && self.hir(file).decorators.is_empty()))
            .map(|file| (self.files().module(file).file_name(), file))
            .collect();
        let made_of: Vec<(FileId, FileId)> = (all().filter(|&file| self.is_compiled(file) && self.is_untyped_file(file)))
            .filter_map(|file| Some((file, *placeholder.get(self.files().module(file).file_name().strip_suffix(b".js")?)?)))
            .collect();
        self.aot.flows.generated_from_checked_source = made_of.iter().map(|created| created.0).collect();
        self.aot.flows.checked_sources = made_of.iter().map(|created| created.1).collect();
        let texts: Vec<FileId> = made_of.iter().map(|created| created.1).collect();
        for text in own(&texts) {
            let known = despecialized.len();
            self.add_types_allocated_in(text, despecialized);
            self.note_external_causes(&despecialized[known..], ExternalCause::CreatedByGeneratedCode { at: Place { file: text, pos: 0 } }, None);
        }
        let files: Vec<FileId> = all().filter(|&file| (self.is_compiled(file) || self.aot.flows.checked_sources.contains(&file)) && !self.is_untyped_file(file)).collect();
        let written: Vec<FileId> = all().filter(|&file| self.hir(file).kind != FileKind::Declaration && !self.is_untyped_file(file)).collect();
        for file in own(&files) {
            self.add_external_data_target_types(file, coercion_targets);
        }
        let untyped: Vec<FileId> = all().filter(|&file| self.is_compiled(file) && self.is_untyped_file(file) && !self.aot.flows.generated_from_checked_source.contains(&file)).collect();
        let (mut imported, mut crossed, mut handed_over, mut gotten) = (FxHashSet::default(), FxHashSet::default(), FxHashSet::default(), FxHashSet::default());
        let seen_by_other_declarations = &search.seen_by_other_declarations;
        for file in own(&files) {
            if let Some(&at) = seen_by_other_declarations.get(&file) {
                let module = self.files().file_symbol(file);
                let value = self.files().module_value(module);
                let of_module = self.type_of_symbol(value);
                self.add_passed_values(of_module, 0, file, at, &mut FxHashSet::default(), &mut crossed, coercion_targets);
            }
        }
        for file in own(&untyped) {
            self.add_arguments_to_reexports(file, &mut crossed, coercion_targets);
        }
        if !untyped.is_empty() {
            for file in own(&untyped).into_iter().chain(own(&files)) {
                self.add_types_imported_across_boundary(file, &mut imported, &mut gotten, &mut crossed, coercion_targets);
            }
            for file in own(&files) {
                self.add_types_passed_to_javascript(file, &mut handed_over, &mut crossed, coercion_targets);
            }
        }
        for (record, at) in std::mem::take(&mut self.aot.flows.records_reaching_javascript) {
            let identity = self.type_identity(record);
            let mut held = self.p.aot.storage.records_reaching_javascript.lock();
            let first = held.entry(identity).or_insert(at);
            *first = at.min(*first);
        }
        if let Some(gave_up) = self.aot.flows.boundary_overflow.take() {
            let mut first = search.gave_up.lock();
            if first.as_ref().is_none_or(|known| gave_up.rank < known.rank) {
                *first = Some(gave_up);
            }
        }
        for file in own(&files) {
            self.add_inspected_casts(file, looked_at);
        }
        for file in own(&written) {
            self.add_declared_unions(file, written_unions);
        }
        let is_last = search.barrier.wait();
        let goes_on = search.gave_up.lock().is_none();
        if is_last {
            *search.continues_past_sources.0.lock() = Some(goes_on);
            search.continues_past_sources.1.notify_all();
        }
        goes_on
    }

    pub(in crate::check) fn records_compared_pairs(&self) -> bool {
        self.p.files.options.undefined_properties_have_no_declaration && self.aot.flows.seen_before.is_none() && !self.p.aot.storage.external_types.is_finalized() && (!self.is_warming_up() || self.fuel.get() == u64::MAX)
    }

    pub(in crate::check) fn record_recompared(&mut self, key: crate::check::relate::Key) -> bool {
        self.aot.flows.compared_again.insert(key)
    }

    pub(in crate::check) fn is_assignable_in_conditional_type(&mut self, source: TypeId, target: TypeId) -> bool {
        self.aot.flows.conditional_type_depth += 1;
        let is_assignable = self.is_assignable(source, target);
        self.aot.flows.conditional_type_depth -= 1;
        is_assignable
    }

    pub(in crate::check) fn is_resolving_conditional_type(&self) -> bool {
        self.aot.flows.conditional_type_depth != 0 && self.records_compared_pairs()
    }

    pub(in crate::check) fn record_compared_pair(&mut self, source: TypeId, target: TypeId, relation: Relation, is_reported: bool) {
        if relation != Relation::Identity && (relation != Relation::Comparable || is_reported) && self.aot.flows.conditional_type_depth == 0 && self.records_compared_pairs() {
            self.aot.flows.pairs_compared.insert((source, target, is_reported));
        }
    }

    pub(in crate::check) fn are_compared_pairs_recorded(&self) -> bool {
        self.p.files.options.undefined_properties_have_no_declaration && self.aot.flows.seen_before.is_none() && self.p.aot.storage.external_types.get().is_none()
    }

    fn propagating_pairs(&mut self) -> Vec<(TypeId, TypeId)> {
        let mut compared: Vec<(TypeId, TypeId, bool)> = std::mem::take(&mut self.aot.flows.pairs_compared).into_iter().collect();
        compared.sort_unstable_by_key(|pair| (pair.0.0, pair.1.0, pair.2));
        let mut pairs = Vec::new();
        for (source, target, is_reported) in compared {
            let takes = self.declares_properties(target) && self.may_hold_objects(target) && !self.is_instance_type(target) && self.built_in_for_type(target).is_none() && self.array_subtype_element(target).is_none() && !self.is_declared_externally(target);
            if !takes || !self.declares_properties(source) || !self.may_hold_objects(source) || !(is_reported || self.is_assignable(source, target)) {
                continue;
            }
            pairs.push((source, target));
        }
        self.aot.flows.pairs_compared.clear();
        pairs
    }

    pub(crate) fn take_pairs_compared(&mut self) -> Vec<(Identity, Identity)> {
        let mut pairs = Vec::new();
        for (source, target) in self.propagating_pairs() {
            self.keep_type(target);
            pairs.push((self.type_identity(source), self.type_identity(target)));
        }
        pairs
    }

    fn compared_targets_by_source(&mut self) -> FxHashMap<Identity, Vec<TypeId>> {
        let mut targets: FxHashMap<Identity, Vec<TypeId>> = FxHashMap::default();
        for (source, target) in self.propagating_pairs() {
            targets.entry(self.type_identity(source)).or_default().push(target);
        }
        targets
    }

    #[allow(clippy::too_many_arguments)]
    fn add_targets_of_found_types(&mut self, search: &Search, own_pairs: &FxHashMap<Identity, Vec<TypeId>>, kept_targets: &FxHashMap<Identity, TypeId>, sources_of_kept_targets: &[Identity], followed: &mut FxHashSet<Identity>, tracked_as_plain: &mut FxHashSet<Identity>, out: &mut Vec<TypeId>, despecialized: &mut Vec<TypeId>) {
        if own_pairs.is_empty() && kept_targets.is_empty() {
            return;
        }
        let mut found: Vec<Identity> = {
            let by_all = search.tainted.read();
            own_pairs.keys().chain(sources_of_kept_targets).copied().filter(|identity| by_all.contains(identity) && !followed.contains(identity)).collect()
        };
        found.sort_unstable();
        found.dedup();
        let (plain_by_all, seen_by_all) = (search.despecialized.read(), search.seen.read());
        for identity in found {
            let out = if plain_by_all.contains(&identity) && !seen_by_all.contains(&identity) {
                if !tracked_as_plain.insert(identity) {
                    continue;
                }
                &mut *despecialized
            } else {
                followed.insert(identity);
                &mut *out
            };
            let known = out.len();
            out.extend(own_pairs.get(&identity).into_iter().flatten().copied());
            for target in search.targets_by_source.get(&identity).into_iter().flatten() {
                out.extend(kept_targets.get(target));
            }
            self.note_external_causes(&out[known..], ExternalCause::AssignedFrom, Some(identity));
        }
    }

    fn note_external_cause(&mut self, ty: TypeId, cause: ExternalCause, from: Option<Identity>) {
        if !self.aot.flows.records_external_causes {
            return;
        }
        let rank = (self.aot.flows.external_cause_round, self.aot.flows.types_being_walked.len() as u32);
        let ty = self.reduced(ty);
        let mut marked = self.parts(ty).to_vec();
        if marked.len() > 1 {
            marked.push(ty);
        }
        for part in marked {
            let identity = self.type_identity(part);
            if from == Some(identity) {
                continue;
            }
            if let (None, ExternalCause::UsedAs { at } | ExternalCause::CreatedByGeneratedCode { at } | ExternalCause::CrossesBoundary { at }) = (from, cause) {
                self.p.aot.storage.places_where_external_data_enters.lock().push((identity, self.aot.flows.external_data_followed_from.unwrap_or(at)));
            }
            let improve = |known: &mut ExternalMark| {
                if (rank, cause, from) < (known.rank, known.cause, known.from) {
                    (known.rank, known.cause, known.from) = (rank, cause, from);
                }
            };
            if let Some(known) = self.p.aot.storage.external_marks.lock().get_mut(&identity) {
                improve(known);
                continue;
            }
            let is_inferred = matches!(self.data(part), TypeData::Anon { origin: Origin::ObjectLiteral(..) | Origin::WidenedLiteral(..), .. }) && self.alias_of_type(part).is_none();
            let declared = self.type_declaration_site(part).filter(|_| !is_inferred);
            let mark = ExternalMark { rank, cause, from, name: self.display_name(part).into_bytes(), declared };
            self.p.aot.storage.external_marks.lock().entry(identity).and_modify(improve).or_insert(mark);
        }
    }

    fn note_external_causes(&mut self, types: &[TypeId], cause: ExternalCause, from: Option<Identity>) {
        if self.aot.flows.records_external_causes {
            for ty in types.iter().copied() {
                self.note_external_cause(ty, cause, from);
            }
        }
    }

    pub(super) fn places_where_external_data_enters(&self) -> Vec<(Identity, Place)> {
        let mut places = self.p.aot.storage.places_where_external_data_enters.lock().clone();
        places.sort_unstable();
        places.dedup();
        places
    }

    pub(super) fn external_marks(&mut self) -> (FxHashMap<Identity, ExternalMark>, &'p FxHashSet<Identity>) {
        (self.p.aot.storage.external_marks.lock().clone(), &self.external_types().identities)
    }

    fn search_from_sources(&mut self, search: &Search, index: usize, share: &FilePartition<'_>, own_pairs: &FxHashMap<Identity, Vec<TypeId>>) {
        let (mut coercion_targets, mut despecialized, mut looked_at, mut written_unions) = (Vec::new(), Vec::new(), Vec::new(), Vec::new());
        let goes_on = search.seen_before.is_some();
        let mut turn = 0;
        self.aot.flows.records_external_causes = self.p.rule_scopes.get().is_some_and(|scopes| scopes.is_enabled(Rule::ExternalType) || scopes.is_enabled(Rule::ByName));
        self.aot.flows.external_cause_round = if goes_on { 1 << 24 } else { 0 };
        if !goes_on && !self.visit_external_sources(search, share, &mut coercion_targets, &mut despecialized, &mut looked_at, &mut written_unions) {
            return;
        }
        let (mut is_left_taken, mut arrays_before, mut arrays_found, mut arrays_not_said_yet): (bool, Vec<(Identity, Vec<Identity>)>, Vec<Identity>, Vec<Identity>) = (!goes_on, Vec::new(), Vec::new(), Vec::new());
        let (mut seen, mut views): (FxHashSet<(TypeId, bool)>, Vec<TypeId>) = (FxHashSet::default(), Vec::new());
        let mut visited: FxHashSet<(TypeId, bool)> = FxHashSet::default();
        let mut tainted: FxHashSet<TypeId> = FxHashSet::default();
        let mut arrays: Vec<(TypeId, Vec<Identity>)> = Vec::new();
        let mut listed: FxHashSet<TypeId> = FxHashSet::default();
        let mut not_reported_yet: Vec<TypeId> = Vec::new();
        let mut followed: FxHashSet<Identity> = FxHashSet::default();
        let mut tracked_as_plain: FxHashSet<Identity> = FxHashSet::default();
        let mut plain_candidates: FxHashSet<Identity> = FxHashSet::default();
        let mut kept_targets: FxHashMap<Identity, TypeId> = FxHashMap::default();
        if let (false, &FilePartition::Rest { index, of, .. }) = (search.targets_by_source.is_empty(), share) {
            for (at, ty) in self.kept_types().into_iter().enumerate() {
                if at % of == index {
                    kept_targets.insert(self.type_identity(ty), ty);
                }
            }
        }
        let has_kept_target = |targets: &[Identity]| targets.iter().any(|target| kept_targets.contains_key(target));
        let sources_of_kept_targets: Vec<Identity> = if kept_targets.is_empty() { Vec::new() } else { search.targets_by_source.iter().filter(|pair| has_kept_target(pair.1.as_slice())).map(|pair| *pair.0).collect() };
        self.aot.flows.external_cause_round += 1;
        self.add_targets_of_found_types(search, own_pairs, &kept_targets, &sources_of_kept_targets, &mut followed, &mut tracked_as_plain, &mut coercion_targets, &mut despecialized);
        loop {
            while search.has_any_found(coercion_targets.len() + despecialized.len() + usize::from(turn == 0), &mut turn) {
                self.aot.flows.external_cause_round += 1;
                if !is_left_taken {
                    is_left_taken = true;
                    self.take_remaining_work(search, index, share, &mut looked_at, &mut written_unions, &mut arrays_before);
                }
                for ty in coercion_targets.drain(..) {
                    if self.aot.flows.records_external_causes {
                        let root = self.reduced(ty);
                        let root = self.type_identity(root);
                        self.aot.flows.types_being_walked.push(root);
                    }
                    self.add_types_staying_untyped(ty, true, &mut seen, &mut views);
                    self.aot.flows.types_being_walked.clear();
                }
                let mut newly: Vec<TypeId> = views.drain(..).filter(|&ty| tainted.insert(ty)).collect();
                let mut newly_plain = Vec::new();
                for ty in despecialized.drain(..) {
                    self.add_despecialized_records(ty, &mut views);
                }
                for ty in views.drain(..).filter(|&ty| tainted.insert(ty)) {
                    newly_plain.push(self.type_identity(ty));
                    newly.push(ty);
                }
                if !newly_plain.is_empty() {
                    search.despecialized.write().extend(newly_plain);
                }
                let so_far: Vec<(TypeId, bool)> = seen.iter().copied().filter(|&one| visited.insert(one)).collect();
                let mut stable_seen = Vec::new();
                for &(ty, stays) in &so_far {
                    if stays {
                        stable_seen.push(self.type_identity(ty));
                    }
                    if self.declares_properties(ty) && !self.is_instance_type(ty) && self.built_in_for_type(ty).is_none() && self.array_subtype_element(ty).is_none() && tainted.insert(ty) {
                        newly.push(ty);
                    }
                    if self.is_array_or_tuple(ty) && !tainted.contains(&ty) && listed.insert(ty) {
                        let mut parts = Vec::new();
                        for element in self.type_arguments(ty).to_vec() {
                            for part in self.parts(element).to_vec() {
                                parts.push(self.type_identity(part));
                            }
                        }
                        arrays.push((ty, parts));
                    }
                }
                if !stable_seen.is_empty() {
                    search.seen.write().extend(stable_seen);
                }
                loop {
                    let identities: Vec<Identity> = newly.iter().map(|&ty| self.type_identity(ty)).collect();
                    let mut names = Vec::with_capacity(newly.len());
                    for (&ty, &identity) in newly.iter().zip(&identities) {
                        self.keep_type(ty);
                        let Some(members) = self.members(ty) else { continue };
                        let atoms = self.atoms();
                        names.push((identity, members.shape().props.iter().map(|prop| atoms.bytes(prop.name).into()).collect()));
                    }
                    if !names.is_empty() {
                        search.names.lock().extend(names);
                    }
                    if !(identities.is_empty() && arrays_found.is_empty()) {
                        search.tainted.write().extend(identities.into_iter().chain(arrays_found.iter().copied()));
                    }
                    not_reported_yet.append(&mut newly);
                    arrays_not_said_yet.append(&mut arrays_found);
                    search.barrier.wait();
                    {
                        let by_all = search.tainted.read();
                        arrays.retain(|(ty, parts)| {
                            let is_member = parts.iter().any(|part| by_all.contains(part));
                            if is_member && tainted.insert(*ty) {
                                newly.push(*ty);
                            }
                            !is_member
                        });
                        arrays_before.retain(|(identity, parts)| {
                            let is_member = parts.iter().any(|part| by_all.contains(part));
                            if is_member {
                                arrays_found.push(*identity);
                            }
                            !is_member
                        });
                    }
                    if !search.has_any_found(newly.len() + arrays_found.len(), &mut turn) {
                        break;
                    }
                }
                self.aot.flows.external_cause_round += 1;
                self.add_cast_target_types(&mut looked_at, search, &mut plain_candidates, &mut coercion_targets, &mut despecialized);
                self.add_targets_of_found_types(search, own_pairs, &kept_targets, &sources_of_kept_targets, &mut followed, &mut tracked_as_plain, &mut coercion_targets, &mut despecialized);
            }
            let mut said = Vec::new();
            for ty in not_reported_yet.drain(..) {
                let identity = self.type_identity(ty);
                if !search.external_types.read().identities.contains(&identity) {
                    said.push((identity, self.property_summary(ty)));
                }
            }
            said.extend(arrays_not_said_yet.drain(..).map(|identity| (identity, None)));
            *search.said[index].lock() = said;
            search.barrier.wait();
            if index == 0 {
                search.publish_summaries(self.aot.flows.records_external_causes);
            }
            search.barrier.wait();
            self.aot.flows.external_cause_round += 1;
            self.add_declared_union_members(&written_unions, search, &mut plain_candidates, &mut coercion_targets, &mut despecialized);
            if !search.has_any_found(coercion_targets.len() + despecialized.len(), &mut turn) {
                break;
            }
        }
        if search.is_continuation {
            let seen = search.seen.read();
            let mut left = search.left.lock();
            for it in looked_at {
                if !seen.contains(&it.target.1) || !seen.contains(&it.source.1) && self.may_hold_objects(it.source.0) {
                    left.looked_at.entry(it.file).or_default().push(it);
                }
            }
            for union in written_unions {
                if !union.members.iter().all(|member| seen.contains(&member.1)) {
                    left.unions.entry(union.file).or_default().push(union);
                }
            }
            for (ty, parts) in arrays {
                left.arrays.push((self.type_identity(ty), parts));
            }
        }
    }

    fn take_remaining_work(&mut self, search: &Search, index: usize, share: &FilePartition<'_>, looked_at: &mut Vec<InspectedCast>, unions: &mut Vec<WrittenUnion>, arrays: &mut Vec<(Identity, Vec<Identity>)>) {
        let (mut of_looked_at, mut of_unions) = (Vec::new(), Vec::new());
        {
            let mut left = search.left.lock();
            let files: Vec<FileId> = match *share {
                FilePartition::Files(mine) => mine.to_vec(),
                FilePartition::Rest { index, of, is_taken } => {
                    let mut files: Vec<FileId> = (left.looked_at.keys().chain(left.unions.keys()).copied()).filter(|file| !is_taken.get(file.idx()).copied().unwrap_or(false) && file.idx() % of == index).collect();
                    files.sort_unstable_by_key(|file| file.0);
                    files.dedup();
                    files
                }
            };
            for file in files {
                of_looked_at.extend(left.looked_at.remove(&file).unwrap_or_default());
                of_unions.extend(left.unions.remove(&file).unwrap_or_default());
            }
            if index == 0 {
                *arrays = std::mem::take(&mut left.arrays);
                arrays.sort_unstable();
                arrays.dedup();
            }
        }
        for mut it in of_looked_at {
            let target = self.type_from_node(it.file, it.written);
            it.target.0 = self.reduced(target);
            self.prepare_enclosing(it.file, it.operand);
            let source = self.type_of_expr(it.file, it.operand);
            it.source.0 = self.reduced(source);
            looked_at.push(it);
        }
        for mut union in of_unions {
            let written = self.type_from_node(union.file, union.node);
            let mut members = Vec::new();
            for member in self.parts(written).to_vec() {
                let member = self.reduced(member);
                if self.may_hold_objects(member) {
                    members.push(member);
                }
            }
            union.members = members.into_iter().map(|member| (member, self.type_identity(member))).collect();
            unions.push(union);
        }
    }

    fn add_declared_unions(&mut self, file: FileId, out: &mut Vec<WrittenUnion>) {
        let hir = self.hir(file);
        for (index, node) in hir.types.iter().enumerate() {
            if !matches!(node.kind, TypeNodeKind::Union(_)) {
                continue;
            }
            let union = self.type_from_node(file, TypeNodeId(index as u32));
            let mut members = Vec::new();
            for member in self.parts(union).to_vec() {
                let member = self.reduced(member);
                if self.may_hold_objects(member) {
                    members.push((member, self.type_identity(member)));
                }
            }
            if members.len() >= 2 {
                out.push(WrittenUnion { file, node: TypeNodeId(index as u32), members });
            }
        }
    }

    fn add_declared_union_members(&mut self, unions: &[WrittenUnion], search: &Search, plain_candidates: &mut FxHashSet<Identity>, out: &mut Vec<TypeId>, despecialized: &mut Vec<TypeId>) {
        let (seen, tainted, plain, external_types) = (search.seen.read(), search.tainted.read(), search.despecialized.read(), search.external_types.read());
        let mut taking: FxHashMap<TypeId, bool> = FxHashMap::default();
        for &WrittenUnion { ref members, file, node } in unions {
            if members.iter().all(|member| seen.contains(&member.1)) {
                continue;
            }
            let cause = ExternalCause::UnionMember { at: Place { file, pos: self.hir(file)[node].pos } };
            let first_found = members.iter().map(|member| member.1).find(|member| tainted.contains(member));
            if members.iter().any(|member| tainted.contains(&member.1)) && members.iter().all(|member| !tainted.contains(&member.1) || plain.contains(&member.1) && !seen.contains(&member.1)) {
                let known = despecialized.len();
                despecialized.extend(members.iter().filter(|member| !tainted.contains(&member.1) && plain_candidates.insert(member.1)).map(|member| member.0));
                self.note_external_causes(&despecialized[known..], cause, first_found);
                continue;
            }
            let mut is_external_data = false;
            for &(member, identity) in members {
                is_external_data = tainted.contains(&identity)
                    || match taking.get(&member) {
                        Some(&known) => known,
                        None => {
                            let takes = self.accepts_external_data(member, &external_types);
                            taking.insert(member, takes);
                            takes
                        }
                    };
                if is_external_data {
                    break;
                }
            }
            if is_external_data {
                let known = out.len();
                out.extend(members.iter().filter(|member| !seen.contains(&member.1)).map(|member| member.0));
                let mut first_found = first_found;
                if self.aot.flows.records_external_causes
                    && first_found.is_none()
                    && let Some(&(member, identity)) = members.iter().find(|member| taking.get(&member.0) == Some(&true))
                {
                    let resembled = self.external_data_accepted_by(member, &external_types).and_then(|resembled| external_types.property_owners.get(resembled as usize).copied());
                    self.note_external_cause(member, ExternalCause::Resembles, resembled);
                    first_found = Some(identity);
                }
                self.note_external_causes(&out[known..], cause, first_found);
            }
        }
    }

    fn add_inspected_casts(&mut self, file: FileId, out: &mut Vec<InspectedCast>) {
        let hir = self.hir(file);
        let casts = self.file_exprs_by_kind(file).of(ExprTag::As).iter().filter_map(|&cast| match hir[cast].kind {
            ExprKind::As { expr, ty } => Some((ty, expr, Some(cast))),
            _ => None,
        });
        let annotated = hir.var_decls.iter().filter(|declaration| declaration.ty.is_some() && declaration.init.is_some()).map(|declaration| (declaration.ty, declaration.init, None));
        let written: Vec<(TypeNodeId, ExprId, Option<ExprId>)> = casts.chain(annotated).collect();
        for (written, value, cast) in written {
            let target = self.type_from_node(file, written);
            let target = self.reduced(target);
            if !self.may_hold_objects(target) {
                continue;
            }
            self.prepare_enclosing(file, value);
            let (mut operand, mut source) = (value, self.type_of_expr(file, value));
            while self.is_uninformative(source)
                && let ExprKind::As { expr, .. } | ExprKind::NonNull(expr) = hir[operand].kind
            {
                operand = expr;
                source = self.type_of_expr(file, operand);
            }
            let source = self.reduced(source);
            let mut identities_of_parts = |ty: TypeId| -> Vec<Identity> { self.parts(ty).to_vec().into_iter().map(|part| self.type_identity(part)).collect() };
            let (target_parts, source_parts) = (identities_of_parts(target), identities_of_parts(source));
            let name_read_on_the_spot = cast.and_then(|cast| self.name_read_through_cast(file, cast));
            let (target, source) = ((target, self.type_identity(target)), (source, self.type_identity(source)));
            out.push(InspectedCast { target, target_parts, source, source_parts, name_read_on_the_spot, file, written, operand, is_known_plain_data: None });
        }
    }

    fn name_read_through_cast(&mut self, file: FileId, cast: ExprId) -> Option<Atom> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut outermost = cast;
        let read = loop {
            let Parent::Expr(around) = bound.expr_parent[outermost.idx()] else { return None };
            match hir[around].kind {
                ExprKind::As { expr, .. } | ExprKind::NonNull(expr) if expr == outermost => outermost = around,
                _ => break around,
            }
        };
        let name = match hir[read].kind {
            ExprKind::Dot { obj, name, .. } if obj == outermost && !name.is_none() => name,
            ExprKind::Index { obj, index, .. } if obj == outermost => self.literal_key(file, index)?,
            _ => return None,
        };
        let is_called_or_deleted = matches!(bound.expr_parent[read.idx()], Parent::Expr(user) if match hir[user].kind {
            ExprKind::Call(call) | ExprKind::New(call) | ExprKind::TaggedTemplate(call) => hir[call].callee == read,
            ExprKind::Unary { op: UnOp::Delete, .. } => true,
            _ => false,
        });
        (bound.access_kind(hir, read) == AccessKind::Read && !is_called_or_deleted).then_some(name)
    }

    fn add_cast_target_types(&mut self, looked_at: &mut [InspectedCast], search: &Search, plain_candidates: &mut FxHashSet<Identity>, out: &mut Vec<TypeId>, despecialized: &mut Vec<TypeId>) {
        let (seen, tainted, plain) = (search.seen.read(), search.tainted.read(), search.despecialized.read());
        let is_external_data = |part: &Identity| tainted.contains(part) && !(plain.contains(part) && !seen.contains(part));
        for it in looked_at {
            if it.target_parts.iter().any(|part| tainted.contains(part)) {
                if it.target_parts.iter().any(is_external_data) {
                    let marked = match it.name_read_on_the_spot.and_then(|name| self.type_of_property(it.source.0, name)) {
                        Some(read) => {
                            let read = self.reduced(read);
                            (read, self.type_identity(read))
                        }
                        None => it.source,
                    };
                    if self.may_hold_objects(marked.0) && !seen.contains(&marked.1) {
                        let at = Place { file: it.file, pos: self.hir(it.file)[it.operand].pos };
                        self.note_external_cause(marked.0, ExternalCause::CastTo { at }, it.target_parts.iter().copied().find(is_external_data));
                        out.push(marked.0);
                    }
                }
                continue;
            }
            if seen.contains(&it.target.1) {
                continue;
            }
            if !it.source_parts.iter().any(is_external_data) && it.source_parts.iter().any(|part| tainted.contains(part)) {
                if plain_candidates.insert(it.target.1) {
                    let at = Place { file: it.file, pos: self.hir(it.file)[it.operand].pos };
                    self.note_external_cause(it.target.0, ExternalCause::CastFrom { at }, it.source_parts.iter().copied().find(|part| tainted.contains(part)));
                    despecialized.push(it.target.0);
                }
                continue;
            }
            if it.source_parts.iter().any(is_external_data)
                || self.is_uninformative(it.source.0) && *it.is_known_plain_data.get_or_insert_with(|| self.data_origin(it.file, it.operand).is_some_and(|origin| origin.is_known_plain_data()))
            {
                let at = Place { file: it.file, pos: self.hir(it.file)[it.operand].pos };
                match it.source_parts.iter().copied().find(is_external_data) {
                    Some(source) => self.note_external_cause(it.target.0, ExternalCause::CastFrom { at }, Some(source)),
                    None => self.note_external_cause(it.target.0, ExternalCause::UsedAs { at }, None),
                }
                out.push(it.target.0);
            }
        }
    }

    fn is_declaration_for_javascript(&self, declared_in: FileId) -> bool {
        let flows = &self.aot.flows;
        self.is_untyped_file(declared_in) && !flows.generated_from_checked_source.contains(&declared_in)
            || self.is_declaration_only(declared_in) && self.hir(declared_in).kind != FileKind::Declaration && !flows.checked_sources.contains(&declared_in)
    }

    fn add_despecialized_records(&mut self, ty: TypeId, out: &mut Vec<TypeId>) {
        let ty = self.reduced(ty);
        for part in self.parts(ty).to_vec() {
            if self.declares_properties(part) && !self.is_instance_type(part) && !self.is_declared_externally(part) && self.built_in_for_type(part).is_none() && self.array_subtype_element(part).is_none() {
                out.push(part);
                let view = self.layout_defining_type(part);
                if view != part && self.aot.flows.records_external_causes {
                    let identity = self.type_identity(part);
                    self.note_external_cause(view, ExternalCause::SameLayoutAs, Some(identity));
                }
                out.push(view);
            }
        }
    }

    fn add_types_allocated_in(&mut self, file: FileId, out: &mut Vec<TypeId>) {
        let by_kind = self.file_exprs_by_kind(file);
        for &literal in by_kind.of(ExprTag::Object) {
            self.prepare_enclosing(file, literal);
            out.push(self.type_of_expr(file, literal));
            out.extend(self.contextual_type_of_literal(file, literal));
        }
        for &element in by_kind.of(ExprTag::Jsx) {
            self.prepare_enclosing(file, element);
            out.push(self.jsx_attributes_type(file, element));
            out.extend(self.apparent_type_of_contextual_type_of_jsx_attributes(file, element, ContextFlags::empty()));
        }
    }

    fn add_types_imported_across_boundary(&mut self, file: FileId, imported: &mut FxHashSet<(Sym, bool)>, handed_over: &mut FxHashSet<TypeId>, seen: &mut FxHashSet<TypeId>, out: &mut Vec<TypeId>) {
        let bound = self.bound(file);
        let is_untyped = self.is_untyped_file(file);
        for &name in self.file_exprs_by_kind(file).of(ExprTag::Ident) {
            let local = bound.expr_symbol[name.idx()];
            if local.is_none() {
                continue;
            }
            let local = self.files().sym(file, local);
            if !self.files().flags(local).contains(SymFlags::ALIAS) {
                continue;
            }
            let Some(target) = self.files().resolve_alias(local) else { continue };
            if !imported.insert((target, is_untyped)) {
                continue;
            }
            let across = self.files().decls_of(target).iter().map(|declared| declared.0).find(|&declared_in| match is_untyped {
                true => !self.is_untyped_file(declared_in) && self.hir(declared_in).kind != FileKind::Declaration,
                false => self.is_declaration_for_javascript(declared_in),
            });
            if let Some(declared_in) = across {
                let of_target = self.type_of_symbol(target);
                let typed_side = if is_untyped { declared_in } else { file };
                let at = Place { file, pos: self.hir(file)[name].pos };
                if is_untyped {
                    self.add_escaping_values(of_target, false, typed_side, at, handed_over, seen, out);
                } else {
                    self.add_boundary_types_at(of_target, 1, typed_side, at, seen, out);
                }
            }
        }
    }

    fn add_arguments_to_reexports(&mut self, file: FileId, seen: &mut FxHashSet<TypeId>, out: &mut Vec<TypeId>) {
        let module = self.files().file_symbol(file);
        let value = self.files().module_value(module);
        let of_module = self.type_of_symbol(value);
        let Some(members) = self.members(of_module) else { return };
        let exported: Vec<Sym> = (members.shape().props.iter()).filter_map(|prop| if let PropSource::Symbol(exported) = prop.source { Some(exported) } else { None }).collect();
        for exported in exported {
            let target = if self.files().flags(exported).contains(SymFlags::ALIAS) { self.files().resolve_alias(exported) } else { Some(exported) };
            let Some(target) = target else { continue };
            let declared_in = self.files().decls_of(target).iter().map(|declaration| declaration.0).find(|&declared_in| !self.is_untyped_file(declared_in) && self.hir(declared_in).kind != FileKind::Declaration);
            if let Some(declared_in) = declared_in {
                let of_target = self.type_of_symbol(target);
                self.add_passed_values(of_target, 0, declared_in, Place { file, pos: 0 }, &mut FxHashSet::default(), seen, out);
            }
        }
    }

    fn add_boundary_data(&mut self, ty: TypeId, depth: u32, typed_side: FileId, at: Place, seen: &mut FxHashSet<TypeId>, out: &mut Vec<TypeId>) {
        let ty = self.reduced(ty);
        for part in self.parts(ty).to_vec() {
            if self.contains_only_plain_data(part, &mut FxHashSet::default()) {
                self.add_boundary_types_at(part, 1, typed_side, at, seen, out);
            } else if depth < 4 {
                for signature in self.signatures(part, false).to_vec() {
                    let produced = self.sig_return(signature);
                    self.add_boundary_data(produced, depth + 1, typed_side, at, seen, out);
                }
            }
        }
    }

    fn contains_only_plain_data(&mut self, ty: TypeId, visited: &mut FxHashSet<TypeId>) -> bool {
        self.is_plain_data_type(ty, false, visited)
    }

    fn is_plain_data_type(&mut self, ty: TypeId, allows_functions: bool, visited: &mut FxHashSet<TypeId>) -> bool {
        let ty = self.reduced(ty);
        if !allows_functions && self.parts(ty).iter().any(|&part| matches!(self.data(part), TypeData::Fns { .. })) {
            return false;
        }
        if !self.may_hold_objects(ty) || self.is_uninformative(ty) {
            return true;
        }
        let is_first_query = visited.is_empty();
        if !self.results_are_provisional() {
            match self.aot.flows.plain_data.get(&(ty, allows_functions)) {
                Some(true) => return true,
                Some(false) if is_first_query => return false,
                _ => {}
            }
        }
        let caches = if is_first_query { self.type_caches().filter(|_| is_published(ty)) } else { None };
        if let Some(known) = caches.and_then(|caches| caches.plain_data.get_as((ty, allows_functions), |&known| known)) {
            self.aot.flows.plain_data.insert((ty, allows_functions), known);
            return known;
        }
        if !visited.insert(ty) {
            return true;
        }
        if !is_first_query {
            return self.contains_plain_data_only(ty, allows_functions, visited);
        }
        let (is_plain, is_cacheable) = self.compute_cacheable(|c| c.contains_plain_data_only(ty, allows_functions, visited));
        if is_cacheable && is_plain {
            self.aot.flows.plain_data.extend(visited.iter().map(|&reached| ((reached, allows_functions), true)));
        } else if is_cacheable {
            self.aot.flows.plain_data.insert((ty, allows_functions), false);
        }
        if let Some(caches) = caches.filter(|_| is_cacheable && !self.has_order_dependent_results()) {
            caches.plain_data.insert((ty, allows_functions), is_plain);
        }
        is_plain
    }

    fn contains_plain_data_only(&mut self, ty: TypeId, allows_functions: bool, visited: &mut FxHashSet<TypeId>) -> bool {
        for part in self.parts(ty).to_vec() {
            if !self.may_hold_objects(part) || self.is_uninformative(part) || matches!(self.data(part), TypeData::Fns { .. }) {
                continue;
            }
            if self.is_instantiable(part) {
                let bound = self.base_constraint(part);
                if !self.is_plain_data_type(bound, allows_functions, visited) {
                    return false;
                }
                continue;
            }
            if self.is_array_or_tuple(part) {
                for element in self.type_arguments(part).to_vec() {
                    if !self.is_plain_data_type(element, allows_functions, visited) {
                        return false;
                    }
                }
                continue;
            }
            if self.is_instance_type(part) || self.built_in_for_type(part).is_some() {
                return false;
            }
            if !self.signatures(part, false).is_empty() || !self.signatures(part, true).is_empty() {
                if allows_functions {
                    continue;
                }
                return false;
            }
            if self.is_nested_too_deeply(part) {
                if let Some(form) = self.generic_form(part)
                    && !self.is_plain_data_type(form, allows_functions, visited)
                {
                    return false;
                }
                continue;
            }
            let Some(members) = self.members(part) else { continue };
            let mut held: Vec<TypeId> = members.shape().index.iter().map(|info| info.value).collect();
            for prop in members.shape().props.iter() {
                held.push(self.type_of_prop(prop, members.mapper));
            }
            for held in held {
                if !self.is_plain_data_type(held, allows_functions, visited) {
                    return false;
                }
            }
        }
        true
    }

    fn add_passed_values(&mut self, ty: TypeId, depth: u32, typed_side: FileId, at: Place, visited: &mut FxHashSet<TypeId>, seen: &mut FxHashSet<TypeId>, out: &mut Vec<TypeId>) {
        let ty = self.reduced(ty);
        if depth > 4 || !visited.insert(ty) {
            return;
        }
        for part in self.parts(ty).to_vec() {
            if matches!(self.data(part), TypeData::Ref { .. } | TypeData::Tuple { .. }) {
                for argument in self.type_arguments(part).to_vec() {
                    self.add_passed_values(argument, depth + 1, typed_side, at, visited, seen, out);
                }
            }
            if self.is_declared_externally(part) {
                continue;
            }
            for is_construct in [false, true] {
                for signature in self.signatures(part, is_construct).to_vec() {
                    let parameters = self.sig_params(signature);
                    for index in 0..parameters.len() + 8 {
                        let Some(parameter) = self.param_type_at(&parameters, index) else { break };
                        self.add_incoming_data(parameter, typed_side, at, &mut FxHashSet::default(), seen, out);
                    }
                    let produced = self.sig_return(signature);
                    self.add_passed_values(produced, depth + 1, typed_side, at, visited, seen, out);
                }
            }
            if !self.may_hold_objects(part) || self.is_array_or_tuple(part) || self.is_instantiable(part) {
                continue;
            }
            let Some(members) = self.members(part) else { continue };
            let mut held: Vec<(TypeId, bool)> = Vec::new();
            for prop in members.shape().props.iter() {
                held.push((self.type_of_prop(prop, members.mapper), prop.flags.contains(PropFlags::READONLY)));
            }
            let is_module = matches!(self.data(part), TypeData::Anon { origin: Origin::Module(_), .. });
            let is_declared_record = self.is_declared_record(part);
            for (held, is_readonly) in held {
                if !is_readonly && !is_module && !is_declared_record {
                    self.add_boundary_data(held, 0, typed_side, at, seen, out);
                }
                self.add_passed_values(held, depth + 1, typed_side, at, visited, seen, out);
            }
        }
    }

    fn add_types_passed_to_javascript(&mut self, file: FileId, handed_over: &mut FxHashSet<TypeId>, seen: &mut FxHashSet<TypeId>, out: &mut Vec<TypeId>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let by_kind = self.file_exprs_by_kind(file);
        for &e in by_kind.of(ExprTag::Call).iter().chain(by_kind.of(ExprTag::New)) {
            let (ExprKind::Call(call) | ExprKind::New(call)) = hir[e].kind else { continue };
            let mut named = hir[call].callee;
            while let ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } | ExprKind::NonNull(obj) = hir[named].kind {
                named = obj;
            }
            if !matches!(hir[named].kind, ExprKind::Ident(_)) || bound.expr_symbol[named.idx()].is_none() {
                continue;
            }
            let local = self.files().sym(file, bound.expr_symbol[named.idx()]);
            if !self.files().flags(local).contains(SymFlags::ALIAS) || !self.files().resolve_alias(local).is_some_and(|target| self.is_declaration_for_javascript(target.file)) {
                continue;
            }
            for argument in hir.ids(hir[call].args) {
                let argument = match hir[argument].kind {
                    ExprKind::Spread(spread) => spread,
                    _ => argument,
                };
                self.prepare_enclosing(file, argument);
                let handed = self.type_of_expr(file, argument);
                self.add_escaping_values(handed, false, file, Place { file, pos: hir[argument].pos }, handed_over, seen, out);
            }
        }
    }

    fn add_escaping_values(&mut self, ty: TypeId, parameters_cross: bool, typed_side: FileId, at: Place, handed_over: &mut FxHashSet<TypeId>, seen: &mut FxHashSet<TypeId>, out: &mut Vec<TypeId>) {
        let ty = self.reduced(ty);
        if !(self.may_hold_objects(ty) || matches!(self.data(ty), TypeData::Fns { .. })) || !handed_over.insert(ty) {
            return;
        }
        if let TypeData::Union(parts) = self.data(ty) {
            for part in parts.iter().copied() {
                self.add_escaping_values(part, parameters_cross, typed_side, at, handed_over, seen, out);
            }
            return;
        }
        let is_container = self.is_array_or_tuple(ty) || matches!(self.built_in_for_type(ty), Some(BuiltIn::Instance(_)));
        let is_function = matches!(self.data(ty), TypeData::Fns { .. } | TypeData::Anon { origin: Origin::Function(_), .. });
        let is_declared_record = self.is_declared_record(ty);
        if !(is_container || is_function || is_declared_record) {
            return self.add_boundary_types_at(ty, 2, typed_side, at, seen, out);
        }
        if is_declared_record {
            self.record_record_reaching_javascript(ty, at);
        }
        let mut held: Vec<TypeId> = Vec::new();
        if is_container {
            held.extend(self.type_arguments(ty).iter().copied());
        } else {
            for is_construct in [false, true] {
                for signature in self.signatures(ty, is_construct).to_vec() {
                    let parameters = self.sig_params(signature);
                    for index in 0..parameters.len() + 8 {
                        let Some(parameter) = self.param_type_at(&parameters, index) else { break };
                        if parameters_cross {
                            self.add_boundary_types_at(parameter, 2, typed_side, at, seen, out);
                        } else {
                            held.push(parameter);
                        }
                    }
                    held.push(self.sig_return(signature));
                }
            }
            if let Some(members) = self.members(ty) {
                held.extend(members.shape().index.iter().map(|info| info.value));
                for prop in members.shape().props.iter() {
                    held.push(self.type_of_prop(prop, members.mapper));
                }
            }
        }
        for held in held {
            self.add_escaping_values(held, parameters_cross, typed_side, at, handed_over, seen, out);
        }
    }

    fn add_incoming_data(&mut self, ty: TypeId, typed_side: FileId, at: Place, visited: &mut FxHashSet<TypeId>, seen: &mut FxHashSet<TypeId>, out: &mut Vec<TypeId>) {
        let ty = self.reduced(ty);
        for part in self.parts(ty).to_vec() {
            let is_container = self.is_array_or_tuple(part) || matches!(self.built_in_for_type(part), Some(BuiltIn::Instance(_)));
            if !(is_container || self.is_declared_record(part)) {
                self.add_boundary_data(part, 0, typed_side, at, seen, out);
                continue;
            }
            if !visited.insert(part) {
                continue;
            }
            let mut held: Vec<TypeId> = Vec::new();
            if is_container {
                held.extend(self.type_arguments(part).iter().copied());
            } else if let Some(members) = self.members(part) {
                held.extend(members.shape().index.iter().map(|info| info.value));
                for prop in members.shape().props.iter() {
                    held.push(self.type_of_prop(prop, members.mapper));
                }
            }
            for held in held {
                self.add_incoming_data(held, typed_side, at, visited, seen, out);
            }
        }
    }

    fn record_record_reaching_javascript(&mut self, record: TypeId, at: Place) {
        if !self.is_instance_type(record) {
            self.aot.flows.records_reaching_javascript.push((record, at));
        }
    }

    fn is_declared_record(&mut self, ty: TypeId) -> bool {
        (match *self.data(ty) {
            TypeData::Ref { .. } => self.type_arguments(ty).is_empty(),
            TypeData::Anon { origin: Origin::TypeLiteral(..), .. } => true,
            _ => false,
        }) && !self.is_declared_externally(ty)
            && !self.is_nested_too_deeply(ty)
    }

    fn add_boundary_types_at(&mut self, ty: TypeId, rank: u8, typed_side: FileId, at: Place, seen: &mut FxHashSet<TypeId>, out: &mut Vec<TypeId>) {
        if self.aot.flows.boundary_overflow.is_some() {
            return;
        }
        self.aot.flows.boundary_types_at_site = 0;
        let known = out.len();
        self.add_boundary_types(ty, seen, out);
        self.note_external_causes(&out[known..], ExternalCause::CrossesBoundary { at }, None);
        if self.aot.flows.boundary_types_at_site > MAX_BOUNDARY_TYPES_PER_SITE {
            let name = match *self.data(ty) {
                TypeData::Anon { origin: Origin::Module(module), .. } => format!("typeof import(\"{}\")", self.display_path(module.file)),
                _ => self.display_name(ty),
            };
            let text = &self.hir(at.file).text;
            let line = bun_core::strings::count_char(&text[..(at.pos as usize).min(text.len())], b'\n') + 1;
            let place = format!("{}:{line}", self.display_path(at.file));
            self.aot.flows.boundary_overflow = Some(TruncatedSearch { rank: (rank, at.file.0, at.pos), typed_side, name, place });
        }
    }

    fn display_path(&self, file: FileId) -> String {
        let path = bstr::BStr::new(self.files().module(file).file_name()).to_string();
        match bun_core::strings::last_index_of(path.as_bytes(), b"/node_modules/") {
            Some(at) => path[at + "/node_modules/".len()..].to_owned(),
            None => path[bun_core::strings::last_index_of_char(path.as_bytes(), b'/').map_or(0, |at| at + 1)..].to_owned(),
        }
    }

    fn add_boundary_types(&mut self, ty: TypeId, seen: &mut FxHashSet<TypeId>, out: &mut Vec<TypeId>) {
        if self.aot.flows.boundary_types_at_site > MAX_BOUNDARY_TYPES_PER_SITE {
            return;
        }
        let ty = self.reduced(ty);
        let ty = self.erase_cloned_type_params(ty);
        if !(self.may_hold_objects(ty) || matches!(self.data(ty), TypeData::Fns { .. })) || !seen.insert(ty) {
            return;
        }
        self.aot.flows.boundary_types_at_site += u32::from(self.aot.flows.is_boundary_bounded);
        if self.is_nested_too_deeply(ty) {
            return;
        }
        if let TypeData::Union(parts) = self.data(ty) {
            for part in parts.iter().copied() {
                self.add_boundary_types(part, seen, out);
            }
            return;
        }
        if self.is_instantiable(ty) {
            let bound = self.base_constraint(ty);
            self.add_boundary_types(bound, seen, out);
            return;
        }
        for is_construct in [false, true] {
            for signature in self.signatures(ty, is_construct).to_vec() {
                let parameters = self.sig_params(signature);
                for index in 0..parameters.len() + 8 {
                    let Some(parameter) = self.param_type_at(&parameters, index) else { break };
                    self.add_boundary_types(parameter, seen, out);
                }
                let produced = self.sig_return(signature);
                self.add_boundary_types(produced, seen, out);
            }
        }
        if matches!(self.data(ty), TypeData::Ref { .. } | TypeData::Tuple { .. }) {
            for argument in self.type_arguments(ty).to_vec() {
                self.add_boundary_types(argument, seen, out);
            }
        }
        if self.is_array_or_tuple(ty) {
            out.push(ty);
            return;
        }
        if self.is_declared_externally(ty) {
            return;
        }
        if let TypeData::Anon { origin: Origin::Mapped(file, node), .. } = *self.data(ty)
            && (self.has_type_variables(ty) || self.generic_form(ty) == Some(ty))
        {
            let template = self.mapped_decl(file, node).ty;
            if template.is_some() {
                let template = self.type_from_node(file, template);
                self.add_boundary_types(template, seen, out);
            }
        }
        if let Some(form) = self.generic_form(ty)
            && form != ty
            && self.is_nested_application(ty)
        {
            self.add_boundary_types(form, seen, out);
            for argument in self.referenced_types(ty) {
                self.add_boundary_types(argument, seen, out);
            }
            if self.declares_properties(ty) {
                out.push(ty);
            }
            return;
        }
        let Some(members) = self.members(ty) else { return };
        for info in members.shape().index.iter() {
            self.add_boundary_types(info.value, seen, out);
        }
        for prop in members.shape().props.iter() {
            let of_prop = self.type_of_prop(prop, members.mapper);
            self.add_boundary_types(of_prop, seen, out);
        }
        if self.declares_properties(ty) {
            out.push(ty);
        }
    }

    fn accepts_untyped_values(&mut self, ty: TypeId, depth: u32) -> bool {
        if depth == 0
            && let Some(&known) = self.aot.flows.accepts_untyped_values_cache.get(&ty)
        {
            return known;
        }
        let found = self.is_untyped_for_objects(ty)
            || depth < 2
                && self.parts(ty).to_vec().into_iter().any(|part| {
                    matches!(self.data(part), TypeData::Ref { .. } | TypeData::Tuple { .. }) && self.type_arguments(part).to_vec().into_iter().any(|argument| self.accepts_untyped_values(argument, depth + 1))
                });
        if depth == 0 {
            self.aot.flows.accepts_untyped_values_cache.insert(ty, found);
        }
        found
    }

    pub(super) fn record_flow_into_untyped_slot(&mut self, own: TypeId, target: Option<TypeId>) {
        if !self.may_hold_objects(own) && !matches!(self.data(own), TypeData::Fns { .. }) {
            return;
        }
        if let Some(target) = target
            && !matches!(self.data(own), TypeData::Fns { .. } | TypeData::Anon { origin: Origin::Function(_), .. })
            && !self.accepts_untyped_values(target, 0)
        {
            return;
        }
        if !self.aot.escape_closure.visited_untyped_slots.insert((own, target)) {
            return;
        }
        self.record_escape_query(EscapeQuery::IntoUntypedSlot(own, target));
    }

    fn expand_flow_into_untyped_slot(&mut self, own: TypeId, target: Option<TypeId>) {
        if let Some(target) = target {
            if matches!(self.data(own), TypeData::Fns { .. } | TypeData::Anon { origin: Origin::Function(_), .. }) {
                for mine in self.signatures(own, false).to_vec() {
                    for theirs in self.signatures(target, false).to_vec() {
                        let (taken, handed) = (self.sig_params(mine), self.sig_params(theirs));
                        for index in 0..taken.len() {
                            let (Some(into), Some(from)) = (self.param_type_at(&taken, index), self.param_type_at(&handed, index)) else { break };
                            if self.accepts_untyped_values(into, 0) {
                                self.record_transitive_types(from, 0);
                            }
                        }
                        let (produced, expected) = (self.sig_return(mine), self.sig_return(theirs));
                        if self.accepts_untyped_values(expected, 0) {
                            self.record_transitive_types(produced, 0);
                        }
                    }
                }
            }
            if !self.accepts_untyped_values(target, 0) {
                return;
            }
        }
        self.record_transitive_types(own, 0);
    }

    fn record_transitive_types(&mut self, ty: TypeId, depth: u32) {
        if self.holds_only_primitives(ty) {
            return;
        }
        if depth == 0 {
            self.record_escape_query(EscapeQuery::OfType(ty));
        } else {
            self.expand_transitive_types(ty, depth);
        }
    }

    pub(super) fn note_escape_query_once(&mut self, query: EscapeQuery) {
        let at = self.aot.flows.place;
        match self.aot.escape_closure.queries.entry(query) {
            std::collections::hash_map::Entry::Occupied(mut first) => {
                if *first.get() <= at {
                    return;
                }
                first.insert(at);
            }
            std::collections::hash_map::Entry::Vacant(first) => {
                first.insert(at);
            }
        }
        self.record_escape_query(query);
    }

    pub(super) fn is_type_of_one_expression(&self, ty: TypeId) -> bool {
        match *self.data(ty) {
            TypeData::Fns { ref decls, .. } => decls.first().is_some_and(|&(file, func)| matches!(self.hir(file)[func].kind, crate::hir::FnKind::Expr | crate::hir::FnKind::Arrow)),
            TypeData::Anon { origin: Origin::ObjectLiteral(..), .. } => true,
            _ => false,
        }
    }

    fn expand_escape_query(&mut self, query: EscapeQuery) {
        match query {
            EscapeQuery::OfType(ty) => self.expand_transitive_types(ty, 0),
            EscapeQuery::IntoUntypedSlot(own, target) => self.expand_flow_into_untyped_slot(own, target),
            EscapeQuery::Entry(own, target) => self.walk_entry(own, target),
            EscapeQuery::EscapingValues(shown, is_tested_on_entry) => self.walk_escaping_values(shown, is_tested_on_entry),
            EscapeQuery::UntypedIntoPlace(target) => self.record_untyped_inflow_to_slot(target),
            EscapeQuery::ThroughGuardsOf(shown) => self.record_untyped_inflow_through_type_guards(shown),
            EscapeQuery::UntypedIntoNestedClasses(target, includes_self) => self.expand_untyped_into_nested_classes_query(target, includes_self),
            EscapeQuery::NestedInflows(ty, is_tested) => self.walk_nested_inflows(ty, is_tested),
        }
    }

    pub(super) fn record_escape_query(&mut self, query: EscapeQuery) {
        if self.is_type_of_one_expression(query.subject()) {
            return self.expand_escape_query(query);
        }
        let flows = &mut self.aot.flows;
        if let Some(known) = flows.escape_notes.get(&query) {
            let Some(known) = known else { return };
            return flows.recorded.repeat(known, flows.place);
        }
        let program = self.p;
        let is_shared = self.aot.is_translating && !query.is_local() && !self.is_warming_up() && self.aot.flows.stored.is_none();
        let shared = is_shared.then(|| &program.aot.flows.escape_notes[usize::from(self.aot.is_after_check)][query.shard()]);
        if let Some(found_elsewhere) = shared.and_then(|shared| shared.read().get(&query).cloned()) {
            let flows = &mut self.aot.flows;
            if let Some(known) = &found_elsewhere {
                flows.recorded.repeat(known, flows.place);
            }
            flows.escape_notes.insert(query, found_elsewhere);
            return;
        }
        let careful_before = (self.results_are_provisional(), self.stack_half_used_count(), self.aot.flows.unknown_count);
        let (scope, mark) = (self.begin_scope(), self.non_cacheable_mark());
        let position = self.aot.flows.recorded.position();
        self.expand_escape_query(query);
        let is_settled = self.non_cacheable_mark() == mark && careful_before == (false, self.stack_half_used_count(), self.aot.flows.unknown_count);
        if self.end_scope(scope).is_ok() && is_settled {
            let notes = self.aot.flows.recorded.notes_since(position);
            let is_empty = notes.notes.is_empty() && notes.parameter_notes.is_empty();
            let belongs_to_task = notes.notes.iter().any(|note| crate::local::is_local_number(note.first.0) || crate::local::is_local_number(note.second.0));
            let notes = (!is_empty).then(|| Arc::new(notes));
            if let Some(shared) = shared.filter(|_| !belongs_to_task && !self.has_order_dependent_results()) {
                shared.write().entry(query).or_insert_with(|| notes.clone());
            }
            self.aot.flows.escape_notes.insert(query, notes);
        }
    }

    fn expand_transitive_types(&mut self, ty: TypeId, depth: u32) {
        self.record_escaping_types(ty, None);
        if depth == 0 {
            self.record_any_inflow_to_parameters(ty, 0, &mut FxHashSet::default());
        }
        for &part in self.parts(ty) {
            if self.declares_properties(part) && !self.is_instance_type(part) && !self.is_declared_externally(part) {
                self.record_type_escapes(part);
            }
            if depth >= 2 {
                continue;
            }
            if matches!(self.data(part), TypeData::Ref { .. } | TypeData::Tuple { .. }) {
                for &argument in self.type_arguments(part) {
                    self.record_transitive_types(argument, depth + 1);
                }
            }
            if matches!(self.data(part), TypeData::Anon { origin: Origin::ObjectLiteral(..) | Origin::WidenedLiteral(..), .. })
                && let Some(members) = self.members(part)
            {
                let mut held: Vec<TypeId> = Vec::new();
                for prop in members.shape().props.iter() {
                    held.push(self.type_of_prop(prop, members.mapper));
                }
                for held in held {
                    self.record_transitive_types(held, depth + 1);
                }
            }
        }
    }

    fn is_nested_application(&mut self, ty: TypeId) -> bool {
        self.collect_applications(ty);
        for argument in self.referenced_types(ty) {
            if self.is_instantiable(argument) || self.has_type_variables(argument) || self.aot.flows.applications[&argument].iter().any(|applied| applied.1 > 0) {
                return true;
            }
        }
        false
    }

    fn is_external_data_source(&mut self, file: FileId, e: ExprId) -> bool {
        let hir = self.hir(file);
        let ExprKind::Call(call) = hir[e].kind else { return false };
        let callee = hir[call].callee;
        match hir[callee].kind {
            ExprKind::Dot { obj, name, .. } => match self.atoms().bytes(name) {
                b"parse" => self.refers_to_global_object(file, obj, b"JSON"),
                b"json" => hir.ids(hir[call].args).next().is_none() && self.resolved_signature(file, e).sig.and_then(|sig| self.sig_decl(sig)).is_some_and(|(of, ..)| self.hir(of).kind == FileKind::Declaration),
                _ => false,
            },
            ExprKind::Ident(name) => {
                self.atoms().bytes(name) == b"structuredClone"
                    && self.bound(file).expr_symbol[callee.idx()].is_none()
                    && self.symbol_of_identifier(file, callee, name).is_some_and(|found| self.hir(found.file).kind == FileKind::Declaration)
            }
            _ => false,
        }
    }

    fn is_result_unknown(&mut self, result: TypeId, depth: u32) -> bool {
        self.parts(result).to_vec().into_iter().any(|part| {
            part.is_any()
                || part == TypeId::UNKNOWN
                || depth < 2 && matches!(self.data(part), TypeData::Ref { .. } | TypeData::Tuple { .. }) && self.type_arguments(part).to_vec().into_iter().any(|argument| self.is_result_unknown(argument, depth + 1))
        })
    }

    fn operand_through_casts(&self, file: FileId, mut operand: ExprId) -> ExprId {
        while let ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. } | ExprKind::NonNull(expr) = self.hir(file)[operand].kind {
            operand = expr;
        }
        operand
    }

    fn add_contents_promised_by_container_cast(&mut self, file: FileId, operand: ExprId, target: TypeId, out: &mut Vec<TypeId>) {
        let operand = self.operand_through_casts(file, operand);
        let hir = self.hir(file);
        let is_allocated_empty = match hir[operand].kind {
            ExprKind::New(call) => hir[call].args.len == 0,
            ExprKind::Array(elements) => elements.len == 0,
            _ => false,
        };
        if is_allocated_empty || self.is_result_unknown(target, 0) {
            return;
        }
        self.prepare_enclosing(file, operand);
        let source = self.type_of_expr(file, operand);
        if self.holds_unknown_contents(source, 0) {
            out.push(target);
        }
    }

    fn holds_unknown_contents(&mut self, container: TypeId, depth: u32) -> bool {
        self.parts(container).to_vec().into_iter().any(|part| {
            matches!(self.data(part), TypeData::Ref { .. } | TypeData::Tuple { .. })
                && self.type_arguments(part).to_vec().into_iter().any(|argument| argument == TypeId::UNKNOWN || depth < 1 && self.holds_unknown_contents(argument, depth + 1))
        })
    }

    fn add_results_promised_by_function_cast(&mut self, file: FileId, operand: ExprId, target: TypeId, out: &mut Vec<TypeId>) {
        let promised = self.signatures(target, false).to_vec();
        if promised.is_empty() {
            return;
        }
        let operand = self.operand_through_casts(file, operand);
        self.prepare_enclosing(file, operand);
        let source = self.type_of_expr(file, operand);
        let mut is_unknown = source.is_any() || source == TypeId::UNKNOWN;
        for signature in self.signatures(source, false).to_vec() {
            let result = self.sig_return(signature);
            is_unknown |= self.is_result_unknown(result, 0);
        }
        if !is_unknown {
            return;
        }
        for signature in promised {
            let result = self.sig_return(signature);
            if !self.is_result_unknown(result, 0) {
                out.push(result);
            }
        }
    }

    fn add_external_data_target_types(&mut self, file: FileId, out: &mut Vec<TypeId>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let by_kind = self.file_exprs_by_kind(file);
        let mut pending: Vec<(ExprId, ExprId)> = Vec::new();
        for &call in by_kind.of(ExprTag::Call) {
            if self.is_external_data_source(file, call) {
                pending.push((call, call));
            }
        }
        for &cast in by_kind.of(ExprTag::As) {
            if let ExprKind::As { expr, ty } = hir[cast].kind {
                let written = self.type_from_node(file, ty);
                let target = if written.is_any() || written == TypeId::UNKNOWN {
                    self.prepare_enclosing(file, cast);
                    self.contextual_type(file, cast, ContextFlags::empty())
                } else {
                    Some(written)
                };
                if let Some(target) = target {
                    let known = out.len();
                    self.add_results_promised_by_function_cast(file, expr, target, out);
                    self.add_contents_promised_by_container_cast(file, expr, target, out);
                    self.note_external_causes(&out[known..], ExternalCause::UsedAs { at: Place { file, pos: hir[expr].pos } }, None);
                }
            }
        }
        let mut holders: FxHashSet<SymbolId> = FxHashSet::default();
        while let Some((mut produced, source)) = pending.pop() {
            self.aot.flows.external_data_followed_from = Some(Place { file, pos: hir[source].pos });
            let is_kept_by_name = loop {
                match bound.expr_parent[produced.idx()] {
                    Parent::Expr(parent) if parent.is_some() => match hir[parent].kind {
                        ExprKind::As { ty, .. } => {
                            let target = self.type_from_node(file, ty);
                            self.note_external_cause(target, ExternalCause::UsedAs { at: Place { file, pos: hir[produced].pos } }, None);
                            out.push(target);
                            produced = parent;
                        }
                        ExprKind::Await(_) | ExprKind::NonNull(_) | ExprKind::Satisfies { .. } | ExprKind::Binary { op: BinOp::Or | BinOp::Nullish, .. } => produced = parent,
                        ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } if obj == produced => produced = parent,
                        ExprKind::Cond { yes, no, .. } if yes == produced || no == produced => produced = parent,
                        ExprKind::Binary { op: BinOp::And | BinOp::Comma, right, .. } if right == produced => produced = parent,
                        _ => break false,
                    },
                    Parent::VarInit(d) if hir[d].ty.is_none() && matches!(hir[hir[d].pat].kind, PatKind::Ident(_)) => {
                        let holder = bound.pat_symbol[hir[d].pat.idx()];
                        if holders.insert(holder) {
                            pending.extend(by_kind.of(ExprTag::Ident).iter().copied().filter(|name| bound.expr_symbol[name.idx()] == holder).map(|name| (name, source)));
                        }
                        break true;
                    }
                    _ => break false,
                }
            };
            if is_kept_by_name {
                continue;
            }
            self.prepare_enclosing(file, produced);
            if let Some(expected) = self.contextual_type(file, produced, ContextFlags::empty()) {
                self.note_external_cause(expected, ExternalCause::UsedAs { at: Place { file, pos: hir[produced].pos } }, None);
                out.push(expected);
            }
        }
        self.aot.flows.external_data_followed_from = None;
    }

    pub fn is_syntactically_fresh_graph(&mut self, file: FileId, e: ExprId) -> bool {
        match self.hir(file)[e].kind {
            ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. } | ExprKind::NonNull(expr) => self.is_syntactically_fresh_graph(file, expr),
            ExprKind::Call(call) => {
                let has_one_argument = {
                    let hir = self.hir(file);
                    hir[call].args.len == 1 && !hir.ids(hir[call].args).any(|argument| matches!(hir[argument].kind, ExprKind::Spread(_) | ExprKind::Missing))
                };
                has_one_argument && self.data_origin(file, e) == Some(DataOrigin::Parsed)
            }
            _ => false,
        }
    }

    pub fn data_origin(&mut self, file: FileId, e: ExprId) -> Option<DataOrigin> {
        self.data_origin_at_depth(file, e, 0)
    }

    pub(super) fn data_origin_ignoring_taint(&mut self, file: FileId, e: ExprId) -> Option<DataOrigin> {
        let before = std::mem::replace(&mut self.aot.flows.is_searching_from_sources, true);
        let origin = self.data_origin(file, e);
        self.aot.flows.is_searching_from_sources = before;
        origin
    }

    fn data_origin_at_depth(&mut self, file: FileId, e: ExprId, depth: u32) -> Option<DataOrigin> {
        let is_uninformative = |c: &Self, ty: TypeId| ty != TypeId::UNRESOLVED && c.parts(ty).iter().any(|&part| part.is_any() || part == TypeId::UNKNOWN);
        let ty = self.type_of_expr(file, e);
        if !is_uninformative(self, ty) || depth > 8 {
            return None;
        }
        if self.unverified_claim(file, e).is_some() {
            return Some(DataOrigin::Prediction);
        }
        let either = |a: Option<DataOrigin>, b: Option<DataOrigin>| a.into_iter().chain(b).min();
        match self.hir(file)[e].kind {
            ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. } | ExprKind::NonNull(expr) | ExprKind::AsConst(expr) => self.data_origin_at_depth(file, expr, depth + 1),
            ExprKind::Binary { op: BinOp::Or | BinOp::Nullish, left, right } => either(self.data_origin_at_depth(file, left, depth + 1), self.data_origin_at_depth(file, right, depth + 1)),
            ExprKind::Binary { op: BinOp::And | BinOp::Comma, right, .. } => self.data_origin_at_depth(file, right, depth + 1),
            ExprKind::Cond { yes, no, .. } => either(self.data_origin_at_depth(file, yes, depth + 1), self.data_origin_at_depth(file, no, depth + 1)),
            ExprKind::Call(_) => match self.resolved_signature(file, e).sig.and_then(|sig| self.sig_decl(sig)) {
                Some((declared_in, func, _)) if self.is_declaration_only(declared_in) => {
                    let (hir, bound) = (self.hir(declared_in), self.bound(declared_in));
                    let is_parse = matches!(bound.fns[func.idx()].owner, FnOwner::Member(member) if matches!(bound.member_owner[member.idx()], MemberOwner::Interface(interface) if self.atoms().bytes(hir[interface].name) == b"JSON"))
                        && hir[func].name.is_some()
                        && self.atoms().bytes(hir[func].name) == b"parse";
                    Some(if is_parse { DataOrigin::Parsed } else { DataOrigin::BuiltIn })
                }
                _ => Some(DataOrigin::Function),
            },
            ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => {
                let holder = self.type_of_expr(file, obj);
                if is_uninformative(self, holder) { self.data_origin_at_depth(file, obj, depth + 1) } else { Some(DataOrigin::Property) }
            }
            ExprKind::Await(operand) => match self.hir(file)[operand].kind {
                ExprKind::Call(_) if self.unverified_claim(file, operand).is_some() => Some(DataOrigin::Prediction),
                _ => Some(DataOrigin::Awaited),
            },
            ExprKind::Ident(name) => {
                let named = Some(DataOrigin::Inferred);
                let Some(sym) = self.symbol_of_identifier(file, e, name) else { return named };
                let Some((of, Decl::Var(pat))) = self.files().value_declaration(sym) else { return Some(DataOrigin::Annotated) };
                let (hir, bound) = (self.hir(of), self.bound(of));
                let PatParent::Var(d) = bound.pat_parent[pat.idx()] else { return named };
                let otherwise = Some(if hir[d].ty.is_some() { DataOrigin::Annotated } else { DataOrigin::Inferred });
                if hir[d].pat != pat || hir[d].init.is_none() || !bound.assignments_to(bound.pat_symbol[pat.idx()]).is_empty() {
                    return otherwise;
                }
                match self.data_origin_at_depth(of, hir[d].init, depth + 1) {
                    Some(origin) if origin.is_known_plain_data() => Some(origin),
                    None => None,
                    _ => otherwise,
                }
            }
            _ => None,
        }
    }

    fn add_types_staying_untyped(&mut self, ty: TypeId, stays: bool, seen: &mut FxHashSet<(TypeId, bool)>, out: &mut Vec<TypeId>) {
        self.walk_types_staying_untyped(ty, stays, &mut (seen, out));
    }

    fn walk_types_staying_untyped<W: Walk>(&mut self, ty: TypeId, stays: bool, walk: &mut W) {
        let ty = self.reduced(ty);
        if !self.may_hold_objects(ty) || walk.has_reached(ty, stays) {
            return;
        }
        if stays && self.aot.flows.seen_before.is_some() {
            let identity = self.type_identity(ty);
            if self.aot.flows.seen_before.as_ref().is_some_and(|before| before.contains(&identity)) {
                return;
            }
        }
        walk.enter(ty, stays);
        let holder = self.aot.flows.types_being_walked.last().copied();
        if holder.is_some() {
            self.note_external_cause(ty, ExternalCause::PartOf, holder);
            let identity = self.type_identity(ty);
            self.aot.flows.types_being_walked.push(identity);
        }
        self.walk_contained_types(ty, stays, walk);
        if holder.is_some() {
            self.aot.flows.types_being_walked.pop();
        }
        walk.leave();
    }

    fn walk_contained_types<W: Walk>(&mut self, ty: TypeId, stays: bool, walk: &mut W) {
        if let TypeData::Union(parts) = self.data(ty) {
            let parts: Vec<TypeId> = parts.to_vec();
            let objects: Vec<TypeId> = parts.iter().copied().filter(|&part| self.declares_properties(part)).collect();
            if stays && objects.len() > 1 {
                let objects = self.union(&objects);
                let common = self.common_supertype_of_union(objects);
                self.walk_types_staying_untyped(common, true, walk);
            }
            for part in parts {
                self.walk_types_staying_untyped(part, stays, walk);
            }
        } else if self.is_instantiable(ty) {
            let bound = self.base_constraint(ty);
            self.walk_types_staying_untyped(bound, stays, walk);
        } else if self.is_array_or_tuple(ty) {
            for &element in self.type_arguments(ty) {
                self.walk_types_staying_untyped(element, true, walk);
            }
        } else if let Some(element) = self.array_subtype_element(ty) {
            self.walk_types_staying_untyped(element, true, walk);
        } else {
            match self.built_in_for_type(ty) {
                Some(BuiltIn::Function | BuiltIn::Claimed) => return,
                Some(BuiltIn::Instance(_)) => {
                    for &argument in self.type_arguments(ty) {
                        self.walk_types_staying_untyped(argument, true, walk);
                    }
                    return;
                }
                None => {}
            }
            if self.is_declared_externally(ty) {
                for &argument in self.type_arguments(ty) {
                    self.walk_types_staying_untyped(argument, true, walk);
                }
            }
            if self.is_instance_type(ty) {
                return;
            }
            let Some(members) = self.members(ty) else { return };
            let goes_on = !self.is_nested_too_deeply(ty) && !(self.mentions_ambient_type_param(ty) && self.generic_form(ty).is_some_and(|form| form != ty));
            if !goes_on && let Some(form) = self.generic_form(ty) {
                self.walk_types_staying_untyped(form, true, walk);
            }
            for info in members.shape().index.iter().filter(|_| goes_on) {
                self.walk_types_staying_untyped(info.value, true, walk);
            }
            let is_module = matches!(self.data(ty), TypeData::Anon { origin: Origin::Module(..), .. });
            if !self.declares_properties(ty) && !is_module {
                return;
            }
            if stays && !is_module {
                let view = self.layout_defining_type(ty);
                if view != ty && !self.aot.flows.types_being_walked.is_empty() {
                    let identity = self.type_identity(ty);
                    self.note_external_cause(view, ExternalCause::SameLayoutAs, Some(identity));
                }
                walk.add_view(view);
            }
            for prop in members.shape().props.iter().filter(|_| goes_on) {
                let of_field = self.type_of_prop(prop, members.mapper);
                self.walk_types_staying_untyped(of_field, stays, walk);
            }
        }
    }

    fn mentions_ambient_type_param(&mut self, ty: TypeId) -> bool {
        let mut pending = vec![ty];
        while let Some(&at) = pending.last() {
            if self.aot.flows.ambient_type_param_mentions.contains_key(&at) {
                pending.pop();
                continue;
            }
            let declared_in = match *self.data(at) {
                TypeData::TypeParam(file, ..) => Some(file),
                TypeData::ThisParam(declared) => Some(declared.file),
                _ => None,
            };
            if let Some(file) = declared_in {
                let mentions = self.is_declaration_only(file);
                self.aot.flows.ambient_type_param_mentions.insert(at, mentions);
                pending.pop();
                continue;
            }
            let referred = self.referenced_types(at);
            let known = pending.len();
            pending.extend(referred.iter().copied().filter(|argument| !self.aot.flows.ambient_type_param_mentions.contains_key(argument)));
            if pending.len() > known {
                continue;
            }
            let mentions = referred.iter().any(|argument| self.aot.flows.ambient_type_param_mentions[argument]);
            self.aot.flows.ambient_type_param_mentions.insert(at, mentions);
            pending.pop();
        }
        self.aot.flows.ambient_type_param_mentions[&ty]
    }

    fn nested_types_staying_untyped(&mut self, ty: TypeId, stays: bool) -> std::rc::Rc<[TypeId]> {
        if self.results_are_provisional() || self.aot.flows.seen_before.is_some() {
            let (mut seen, mut views) = (FxHashSet::default(), Vec::new());
            self.add_types_staying_untyped(ty, stays, &mut seen, &mut views);
            return views.into();
        }
        if let Some(known) = self.aot.flows.nested_types_staying_untyped.get(&(ty, stays)) {
            return std::rc::Rc::clone(known);
        }
        let shared = self.lists_shared_by_tasks(ty);
        if let Some(known) = shared.and_then(|shared| shared.nested_types_staying_untyped.get((ty, stays))) {
            let known: std::rc::Rc<[TypeId]> = known.as_ref().into();
            self.aot.flows.nested_types_staying_untyped.insert((ty, stays), std::rc::Rc::clone(&known));
            return known;
        }
        let mut reached = std::mem::take(&mut self.aot.flows.reached_from_types);
        let groups_before = reached.groups.len();
        let ((), is_cacheable) = self.compute_cacheable(|c| c.walk_types_staying_untyped(ty, stays, &mut reached));
        let views = reached.take_views();
        if !is_cacheable {
            reached.truncate_groups(groups_before);
        }
        self.aot.flows.reached_from_types = reached;
        if is_cacheable {
            self.aot.flows.nested_types_staying_untyped.insert((ty, stays), std::rc::Rc::clone(&views));
            if let Some(shared) = shared.filter(|_| !self.has_order_dependent_results()) {
                shared.nested_types_staying_untyped.add((ty, stays), &views);
            }
        }
        views
    }

    fn lists_shared_by_tasks(&self, about: TypeId) -> Option<&'p ListsSharedByTasks> {
        let program = self.p;
        let are_shared = self.aot.is_translating && !crate::local::is_local_number(about.0) && !self.is_warming_up() && !self.results_are_provisional() && self.aot.flows.stored.is_none() && self.aot.flows.seen_before.is_none();
        are_shared.then(|| &program.aot.flows.lists[usize::from(self.aot.is_after_check)])
    }

    pub fn dictionaries_wider_than(&mut self, view: TypeId, record: TypeId) -> Vec<TypeId> {
        let mut accepting_more = Vec::new();
        if view == TypeId::UNRESOLVED || record == TypeId::UNRESOLVED {
            return accepting_more;
        }
        let Some(of_record) = self.members(record) else { return accepting_more };
        if !of_record.shape().index.is_empty() {
            return accepting_more;
        }
        let parts = self.parts(view).to_vec();
        for part in parts {
            if matches!(self.data(part), TypeData::TypeParam(..)) {
                let bound = self.base_constraint(part);
                if bound != part && !self.dictionaries_wider_than(bound, record).is_empty() {
                    accepting_more.push(part);
                }
                continue;
            }
            let Some(members) = self.members(part) else { continue };
            for info in members.shape().index.iter().filter(|info| info.key != TypeId::NUMBER) {
                let value = self.instantiate(info.value, members.mapper);
                let mut accepts_more = false;
                for prop in of_record.shape().props.iter() {
                    let held = self.type_of_prop(prop, of_record.mapper);
                    if value.is_any() || !self.is_assignable(value, held) {
                        accepts_more = true;
                        break;
                    }
                }
                if accepts_more {
                    accepting_more.push(part);
                    break;
                }
            }
        }
        accepting_more
    }

    pub fn dictionaries_in(&mut self, ty: TypeId) -> Vec<TypeId> {
        if ty == TypeId::UNRESOLVED {
            return Vec::new();
        }
        if !self.results_are_provisional()
            && let Some(known) = self.aot.flows.dictionaries.get(&ty)
        {
            return known.to_vec();
        }
        let (found, is_cacheable) = self.compute_cacheable(|c| c.find_dictionaries_in(ty));
        if is_cacheable {
            self.aot.flows.dictionaries.insert(ty, found.as_slice().into());
        }
        found
    }

    fn find_dictionaries_in(&mut self, ty: TypeId) -> Vec<TypeId> {
        let parts = self.parts(ty).to_vec();
        parts
            .into_iter()
            .filter(|&part| {
                if matches!(self.data(part), TypeData::TypeParam(..)) {
                    let bound = self.base_constraint(part);
                    return bound != part && !self.dictionaries_in(bound).is_empty();
                }
                self.members(part).is_some_and(|members| members.shape().index.iter().any(|info| info.key != TypeId::NUMBER))
            })
            .collect()
    }

    pub fn record_stored_read_only(&mut self, held: TypeId, dictionary: TypeId) {
        self.aot.flows.recorded.add_pair(NoteKind::StoredReadOnly, held, dictionary);
    }

    pub fn record_read_only_passed_on(&mut self, dictionary: TypeId) {
        self.aot.flows.recorded.add_all(NoteKind::ReadOnlyPassedOn, &[dictionary]);
    }

    pub fn record_untyped_inflow(&mut self, target: TypeId) {
        let at = self.aot.flows.place;
        self.aot.flows.recorded.add_untyped_inflow(target, at);
    }

    pub fn record_untyped_inflow_to_union_members(&mut self, arms: &[TypeId]) {
        for (index, &arm) in arms.iter().enumerate() {
            for &other in &arms[index + 1..] {
                self.aot.flows.recorded.add_pair(NoteKind::UntypedIntoBoth, arm, other);
            }
        }
    }

    pub fn record_untyped_inflow_to_nested(&mut self, ty: TypeId) {
        if ty == TypeId::UNRESOLVED {
            return;
        }
        let at = self.aot.flows.place;
        if self.aot.flows.nested_untyped_inflow_sites.get(&ty).is_some_and(|&earliest| earliest <= at) {
            return;
        }
        let views = self.nested_types_staying_untyped(ty, false);
        for &view in views.iter() {
            self.record_untyped_inflow(view);
        }
        if self.aot.flows.nested_types_staying_untyped.contains_key(&(ty, false)) {
            self.aot.flows.nested_untyped_inflow_sites.insert(ty, at);
        }
    }

    pub fn record_any_inflow(&mut self, target: TypeId) {
        let at = self.aot.flows.place;
        self.aot.flows.recorded.add_any_inflow(target, at);
    }

    pub fn is_any_like(&mut self, ty: TypeId) -> bool {
        if ty == TypeId::UNRESOLVED {
            return false;
        }
        self.parts(ty).iter().any(|&part| part.is_any() || part == TypeId::UNKNOWN || part == TypeId::OBJECT || !self.is_instantiable(part) && self.accepts_primitives(part))
    }

    pub fn records_in(&mut self, ty: TypeId) -> Vec<TypeId> {
        if !self.results_are_provisional()
            && let Some(known) = self.aot.flows.records.get(&ty)
        {
            return known.to_vec();
        }
        let shared = self.lists_shared_by_tasks(ty);
        if let Some(known) = shared.and_then(|shared| shared.records.get(ty)) {
            self.aot.flows.records.insert(ty, known.as_ref().into());
            return known.to_vec();
        }
        let (found, is_cacheable) = self.compute_cacheable(|c| c.find_records_in(ty));
        if is_cacheable {
            self.aot.flows.records.insert(ty, found.as_slice().into());
            if let Some(shared) = shared.filter(|_| !self.has_order_dependent_results()) {
                shared.records.add(ty, &found);
            }
        }
        found
    }

    fn find_records_in(&mut self, ty: TypeId) -> Vec<TypeId> {
        let (mut found, mut seen, mut pending) = (Vec::new(), FxHashSet::default(), vec![(ty, 0u32)]);
        while let Some((ty, depth)) = pending.pop() {
            let ty = self.reduced(ty);
            for part in self.parts(ty).to_vec() {
                if depth > 4 || !self.may_hold_objects(part) || self.is_uninformative(part) || self.is_instantiable(part) || !seen.insert(part) {
                    continue;
                }
                if self.is_array_or_tuple(part) || self.built_in_for_type(part).is_some() {
                    pending.extend(self.type_arguments(part).to_vec().into_iter().map(|argument| (argument, depth + 1)));
                    continue;
                }
                if self.is_instance_type(part) {
                    continue;
                }
                let Some(members) = self.members(part) else { continue };
                found.push(part);
                pending.extend(members.shape().index.iter().map(|info| (info.value, depth + 1)));
            }
        }
        found
    }

    pub fn find_nested_class_types(&mut self, ty: TypeId) -> Vec<TypeId> {
        if !self.results_are_provisional()
            && let Some(known) = self.aot.flows.nested_class_types.get(&ty)
        {
            return known.to_vec();
        }
        if !self.may_hold_objects(ty) {
            return Vec::new();
        }
        let shared = self.lists_shared_by_tasks(ty);
        if let Some(known) = shared.and_then(|shared| shared.nested_class_types.get(ty)) {
            self.aot.flows.nested_class_types.insert(ty, known.as_ref().into());
            return known.to_vec();
        }
        let ((found, fresh), is_cacheable) = self.compute_cacheable(|c| {
            let mut fresh = FxHashMap::default();
            let found = c.collect_nested_class_types(ty, 4, true, &mut fresh);
            let reduced = c.reduced(ty);
            let root_parts = c.parts(reduced).to_vec();
            let found: Vec<TypeId> = found.iter().copied().filter(|instances| !root_parts.contains(instances)).collect();
            (found, fresh)
        });
        if is_cacheable {
            self.aot.flows.nested_class_types.insert(ty, found.clone().into_boxed_slice());
            self.aot.flows.nested_class_types_by_depth.extend(fresh);
            if let Some(shared) = shared.filter(|_| !self.has_order_dependent_results()) {
                shared.nested_class_types.add(ty, &found);
            }
        }
        found
    }

    pub fn find_predicted_nested_class_types(&mut self, file: FileId, e: ExprId) -> Vec<TypeId> {
        if !matches!(self.hir(file)[e].kind, ExprKind::Call(_) | ExprKind::New(_) | ExprKind::Await(_)) {
            return Vec::new();
        }
        if self.required_builtin_module(file, e).is_some() || !self.is_predicted(file, e) {
            return Vec::new();
        }
        let checked = self.type_of_expr(file, e);
        self.find_nested_class_types(checked)
    }

    fn is_nominal_class(&mut self, instances: TypeId) -> bool {
        let Some(members) = self.members(instances) else { return false };
        members.shape().props.iter().any(|prop| prop.flags.intersects(PropFlags::PRIVATE | PropFlags::PROTECTED) || self.is_private_name(prop.name))
    }

    pub(super) fn record_untyped_inflow_to_classes(&mut self, target: TypeId) {
        self.record_untyped_inflow_to_nested_classes(target, true);
    }

    pub(super) fn record_untyped_inflow_to_slot(&mut self, target: TypeId) {
        let reduced = self.reduced(target);
        let object_part_count = self.parts(reduced).iter().filter(|&&part| self.may_hold_objects(part)).count();
        self.record_untyped_inflow_to_nested_classes(target, object_part_count > 1);
    }

    fn record_untyped_inflow_to_nested_classes(&mut self, target: TypeId, includes_self: bool) {
        if self.may_hold_objects(target) {
            self.record_escape_query(EscapeQuery::UntypedIntoNestedClasses(target, includes_self));
        }
    }

    fn expand_untyped_into_nested_classes_query(&mut self, target: TypeId, includes_self: bool) {
        let mut found = self.find_nested_class_types(target);
        let reduced = self.reduced(target);
        for part in self.parts(reduced).to_vec() {
            if includes_self && self.is_instance_type(part) && !self.is_nominal_class(part) {
                found.push(part);
            }
        }
        let mut pending = vec![(reduced, 0u32)];
        while let Some((ty, depth)) = pending.pop() {
            for part in self.parts(ty).to_vec() {
                if matches!(self.data(part), TypeData::TypeParam(..)) {
                    if depth > 0 || includes_self {
                        self.record_type_accepts_untyped(part, false);
                    }
                } else if depth < 3 {
                    pending.extend(self.type_arguments(part).to_vec().into_iter().map(|argument| (argument, depth + 1)));
                }
            }
        }
        for instances in found {
            let view = self.layout_defining_type(instances);
            self.record_untyped_inflow(view);
            self.record_untyped(view, TypeId::ANY);
        }
    }

    fn record_untyped_inflow_to_parameters(&mut self, ty: TypeId, depth: u32, seen: &mut FxHashSet<TypeId>) {
        for part in self.parts(ty).to_vec() {
            if !seen.insert(part) {
                continue;
            }
            if matches!(self.data(part), TypeData::Anon { origin: Origin::Module(..), .. }) {
                let Some(members) = self.members(part) else { continue };
                let mut exported: Vec<TypeId> = Vec::new();
                for prop in members.shape().props.iter() {
                    if matches!(prop.source, PropSource::Symbol(declared) if !self.is_untyped_file(declared.file) && self.hir(declared.file).kind != FileKind::Declaration) {
                        exported.push(self.type_of_prop(prop, members.mapper));
                    }
                }
                for exported in exported {
                    self.record_untyped_inflow_to_parameters(exported, depth, seen);
                }
                continue;
            }
            for constructs in [false, true] {
                let signatures: Vec<SigId> = self.signatures(part, constructs).iter().copied().collect();
                for signature in signatures {
                    let parameters: Vec<TypeId> = self.sig_params(signature).iter().map(|parameter| parameter.ty).collect();
                    for parameter in parameters {
                        self.record_untyped_inflow_to_classes(parameter);
                    }
                    if depth < 2 {
                        let produced = self.sig_return(signature);
                        self.record_untyped_inflow_to_parameters(produced, depth + 1, seen);
                    }
                }
            }
            if depth >= 2 || !self.declares_properties(part) || self.is_declared_externally(part) {
                continue;
            }
            let Some(members) = self.members(part) else { continue };
            let mut property_types: Vec<TypeId> = Vec::new();
            for prop in members.shape().props.iter() {
                property_types.push(self.type_of_prop(prop, members.mapper));
            }
            for property_type in property_types {
                if self.parts(property_type).to_vec().into_iter().any(|part| !self.signatures(part, false).is_empty()) {
                    self.record_untyped_inflow_to_parameters(property_type, depth + 1, seen);
                }
            }
        }
    }

    pub(super) fn record_js_calls_to_typed_imports(&mut self, file: FileId) {
        let bound = self.bound(file);
        let mut imported: FxHashSet<Sym> = FxHashSet::default();
        for &name in self.file_exprs_by_kind(file).of(ExprTag::Ident) {
            let local = bound.expr_symbol[name.idx()];
            if local.is_none() {
                continue;
            }
            let local = self.files().sym(file, local);
            if !self.files().flags(local).contains(SymFlags::ALIAS) {
                continue;
            }
            let Some(target) = self.files().resolve_alias(local) else { continue };
            if !imported.insert(target) {
                continue;
            }
            let is_typed = self.files().decls_of(target).iter().map(|declared| declared.0).any(|declared_in| !self.is_untyped_file(declared_in) && self.hir(declared_in).kind != FileKind::Declaration);
            if is_typed {
                let of_target = self.type_of_symbol(target);
                let pos = self.hir(file)[name].pos;
                self.set_current_site(file, pos);
                self.record_untyped_inflow_to_parameters(of_target, 0, &mut FxHashSet::default());
            }
        }
        let required: Vec<ExprId> = self.file_exprs_by_kind(file).of(ExprTag::Call).iter().copied().filter(|&call| crate::bind::required_specifier(self.hir(file), call).is_some()).collect();
        let loaded: Vec<ExprId> = self.file_exprs_by_kind(file).of(ExprTag::ImportCall).to_vec();
        for (e, is_promised) in required.into_iter().map(|e| (e, false)).chain(loaded.into_iter().map(|e| (e, true))) {
            let hir = self.hir(file);
            let (specifier, mode) = match hir[e].kind {
                ExprKind::ImportCall { args, .. } => {
                    let written = hir.ids(args).next().filter(|&argument: &ExprId| crate::hir::is_string_literal_like(hir, argument));
                    (written.map(|argument| crate::bind::string_literal_text(hir, argument)), self.files().mode_of_import_call(file))
                }
                _ => (crate::bind::required_specifier(hir, e), self.files().mode_of_require(file)),
            };
            let Some(module) = specifier.and_then(|specifier| self.files().module_of_specifier_as(file, specifier, mode)) else { continue };
            if self.is_untyped_file(module.file) || self.hir(module.file).kind == FileKind::Declaration {
                continue;
            }
            let produced = self.type_of_expr(file, e);
            let of_module = if is_promised { self.awaited(produced) } else { produced };
            let pos = self.hir(file)[e].pos;
            self.set_current_site(file, pos);
            self.record_untyped_inflow_to_parameters(of_module, 0, &mut FxHashSet::default());
        }
    }

    pub(super) fn may_have_type_predicate(&mut self, ty: TypeId) -> bool {
        if self.cached_type_flag(ty, type_flags::HAS_NO_TYPE_PREDICATE, 0).is_some() {
            return false;
        }
        let (found, is_cacheable) = self.compute_cacheable(|c| {
            c.parts(ty).iter().any(|&part| {
                c.signatures(part, false).iter().copied().any(|signature| c.sig_predicate(signature).is_some())
            })
        });
        if !found && is_cacheable && !self.is_warming_up() && !self.has_order_dependent_results() {
            self.cache_type_flag(ty, type_flags::HAS_NO_TYPE_PREDICATE, 0, false);
        }
        found
    }

    pub(super) fn record_untyped_inflow_through_type_guards(&mut self, shown: TypeId) {
        if !self.results_are_provisional()
            && let Some(known) = self.aot.flows.untyped_type_guards.get(&shown)
        {
            let known = known.to_vec();
            for guard in known {
                self.record_untyped_inflow_to_classes(guard);
            }
            return;
        }
        let (guards, is_cacheable) = self.compute_cacheable(|c| {
            let mut guards: Vec<TypeId> = Vec::new();
            for part in c.parts(shown).to_vec() {
                let signatures: Vec<SigId> = c.signatures(part, false).iter().copied().collect();
                for signature in signatures {
                    let Some(predicate) = c.sig_predicate(signature) else { continue };
                    let (Some(index), Some(guard)) = (predicate.param, predicate.ty) else { continue };
                    let Some(guarded) = c.sig_params(signature).get(index).map(|parameter| parameter.ty) else { continue };
                    if c.is_untyped(guarded) {
                        guards.push(guard);
                    }
                }
            }
            guards
        });
        if is_cacheable {
            self.aot.flows.untyped_type_guards.insert(shown, guards.clone().into_boxed_slice());
        }
        for guard in guards {
            self.record_untyped_inflow_to_classes(guard);
        }
    }

    fn collect_nested_class_types(&mut self, ty: TypeId, remaining_depth: u32, is_asked_about: bool, fresh: &mut FxHashMap<(TypeId, u32), std::rc::Rc<[TypeId]>>) -> std::rc::Rc<[TypeId]> {
        let ty = self.reduced(ty);
        if !is_asked_about
            && let Some(known) = self.aot.flows.nested_class_types_by_depth.get(&(ty, remaining_depth)).or_else(|| fresh.get(&(ty, remaining_depth)))
        {
            return std::rc::Rc::clone(known);
        }
        let mut found: Vec<TypeId> = Vec::new();
        for part in self.parts(ty).to_vec() {
            if !self.may_hold_objects(part) || self.is_uninformative(part) || self.is_instantiable(part) {
                continue;
            }
            let mut held: Vec<TypeId> = Vec::new();
            if self.is_array_or_tuple(part) || self.built_in_for_type(part).is_some() || self.is_declared_externally(part) {
                held.extend(self.type_arguments(part).to_vec());
            } else {
                if !self.signatures(part, false).is_empty() || !self.signatures(part, true).is_empty() {
                    continue;
                }
                let Some(members) = self.members(part) else { continue };
                if self.is_instance_type(part) {
                    if members.shape().props.iter().any(|prop| prop.flags.intersects(PropFlags::PRIVATE | PropFlags::PROTECTED) || self.is_private_name(prop.name)) {
                        continue;
                    }
                    if !is_asked_about {
                        found.push(part);
                    }
                }
                if remaining_depth > 0 {
                    held.extend(members.shape().index.iter().map(|info| info.value));
                    for prop in members.shape().props.iter() {
                        held.push(self.type_of_prop(prop, members.mapper));
                    }
                }
            }
            if remaining_depth > 0 {
                for held in held {
                    if self.may_hold_objects(held) {
                        found.extend(self.collect_nested_class_types(held, remaining_depth - 1, false, fresh).iter().copied());
                    }
                }
            }
        }
        let mut seen = FxHashSet::default();
        found.retain(|&instances| seen.insert(instances));
        let found: std::rc::Rc<[TypeId]> = found.into();
        if !is_asked_about {
            fresh.insert((ty, remaining_depth), std::rc::Rc::clone(&found));
        }
        found
    }

    pub(super) fn record_any_inflow_to_records(&mut self, target: TypeId) {
        for record in self.records_in(target) {
            if self.declares_properties(record) && !self.is_declared_externally(record) {
                let view = self.layout_defining_type(record);
                self.record_any_inflow(view);
            }
        }
    }

    pub(super) fn is_served_by_untyped_clone(&mut self, signature: SigId) -> bool {
        let Some((declared_in, func, _)) = self.sig_decl(signature) else { return false };
        self.has_untyped_clone(declared_in, func)
    }

    fn record_any_inflow_to_parameters(&mut self, ty: TypeId, depth: u32, seen: &mut FxHashSet<TypeId>) {
        for part in self.parts(ty).to_vec() {
            if !seen.insert(part) {
                continue;
            }
            for constructs in [false, true] {
                let signatures: Vec<SigId> = self.signatures(part, constructs).iter().copied().collect();
                for signature in signatures {
                    let parameters: Vec<TypeId> = self.sig_params(signature).iter().map(|parameter| parameter.ty).collect();
                    for &parameter in &parameters {
                        self.record_untyped_inflow_to_classes(parameter);
                    }
                    if !self.is_served_by_untyped_clone(signature) {
                        for parameter in parameters {
                            self.record_any_inflow_to_records(parameter);
                        }
                    }
                    if constructs && depth < 2 {
                        let instance = self.sig_return(signature);
                        self.record_any_inflow_to_parameters(instance, depth + 1, seen);
                    }
                }
            }
            if depth >= 2 || !self.declares_properties(part) || self.is_declared_externally(part) {
                continue;
            }
            let Some(members) = self.members(part) else { continue };
            let mut property_types: Vec<TypeId> = Vec::new();
            for prop in members.shape().props.iter() {
                property_types.push(self.type_of_prop(prop, members.mapper));
            }
            for property_type in property_types {
                if self.parts(property_type).to_vec().into_iter().any(|part| !self.signatures(part, false).is_empty()) {
                    self.record_any_inflow_to_parameters(property_type, depth + 1, seen);
                }
            }
        }
    }

    pub fn record_log_build_check(&mut self, target: TypeId, road: usize) {
        let at = self.aot.flows.place;
        self.aot.flows.recorded.add_check(target, at);
        self.aot.flows.recorded.others().checked_by_path[road] += 1;
    }

    pub fn type_pairs_narrowed_together(&mut self, declared: TypeId, narrowed: TypeId) -> Vec<(TypeId, TypeId)> {
        let (mut pairs, mut seen, mut pending) = (Vec::new(), FxHashSet::default(), vec![(declared, narrowed, 0u32)]);
        while let Some((from, to, depth)) = pending.pop() {
            if from == TypeId::UNRESOLVED || to == TypeId::UNRESOLVED {
                continue;
            }
            let (from, to) = (self.reduced(from), self.reduced(to));
            if from == to || depth > 6 || pairs.len() >= 256 || !self.may_hold_objects(from) || !self.may_hold_objects(to) || !seen.insert((from, to)) {
                continue;
            }
            if depth > 0 {
                pairs.push((from, to));
            }
            for wide in self.parts(from).to_vec() {
                for narrow in self.parts(to).to_vec() {
                    let is_skipped = |c: &mut Self, part: TypeId| !c.may_hold_objects(part) || c.is_uninformative(part) || c.is_instantiable(part);
                    if wide == narrow || is_skipped(self, wide) || is_skipped(self, narrow) {
                        continue;
                    }
                    if self.is_array_or_tuple(wide) || self.is_array_or_tuple(narrow) {
                        if self.is_array_or_tuple(wide) && self.is_array_or_tuple(narrow) {
                            let (of_wide, of_narrow) = (self.type_arguments(wide).to_vec(), self.type_arguments(narrow).to_vec());
                            pending.extend(of_wide.into_iter().zip(of_narrow).map(|(a, b)| (a, b, depth + 1)));
                        }
                        continue;
                    }
                    if self.is_instance_type(wide) || self.is_instance_type(narrow) || self.built_in_for_type(wide).is_some() || self.built_in_for_type(narrow).is_some() {
                        continue;
                    }
                    let (Some(of_wide), Some(of_narrow)) = (self.members(wide), self.members(narrow)) else { continue };
                    for prop in of_narrow.shape().props.iter() {
                        if let Some(same) = of_wide.shape().props.iter().find(|same| same.name == prop.name) {
                            let (a, b) = (self.type_of_prop(same, of_wide.mapper), self.type_of_prop(prop, of_narrow.mapper));
                            pending.push((a, b, depth + 1));
                        }
                    }
                }
            }
        }
        pairs
    }

    pub fn destination_type_of_expr(&mut self, file: FileId, e: ExprId) -> Option<TypeId> {
        self.destination_type(file, e, false)
    }

    pub fn destination_type_of_untyped_expr(&mut self, file: FileId, e: ExprId) -> Option<TypeId> {
        self.destination_type(file, e, true)
    }

    pub fn container_element_type_hidden_by_cast(&mut self, file: FileId, e: ExprId) -> Option<TypeId> {
        let hir = self.hir(file);
        let Parent::Expr(parent) = self.bound(file).expr_parent[e.idx()] else { return None };
        let (ExprKind::As { .. }, ExprKind::Call(call)) = (hir[e].kind, hir[parent].kind) else { return None };
        let ExprKind::Dot { obj, .. } = hir[hir[call].callee].kind else { return None };
        let receiver = self.type_of_expr(file, obj);
        if !self.is_array_or_tuple(receiver) && !matches!(self.built_in_for_type(receiver), Some(BuiltIn::Instance(_))) {
            return None;
        }
        self.destination_type_of_untyped_expr(file, e)
    }

    pub fn wide_data_records_in(&mut self, ty: TypeId) -> Vec<TypeId> {
        if !self.results_are_provisional()
            && let Some(known) = self.aot.flows.wide_data_records.get(&ty)
        {
            return known.to_vec();
        }
        let shared = self.lists_shared_by_tasks(ty);
        if let Some(known) = shared.and_then(|shared| shared.wide_data_records.get(ty)) {
            self.aot.flows.wide_data_records.insert(ty, known.as_ref().into());
            return known.to_vec();
        }
        let (found, is_cacheable) = self.compute_cacheable(|c| c.find_wide_data_records_in(ty));
        if is_cacheable {
            self.aot.flows.wide_data_records.insert(ty, found.as_slice().into());
            if let Some(shared) = shared.filter(|_| !self.has_order_dependent_results()) {
                shared.wide_data_records.add(ty, &found);
            }
        }
        found
    }

    fn find_wide_data_records_in(&mut self, ty: TypeId) -> Vec<TypeId> {
        let (mut found, mut seen, mut pending) = (Vec::new(), FxHashSet::default(), vec![(ty, 0u32)]);
        while let Some((ty, depth)) = pending.pop() {
            let ty = self.reduced(ty);
            for part in self.parts(ty).to_vec() {
                if depth > 4 || !self.may_hold_objects(part) || self.is_uninformative(part) || self.is_instantiable(part) || !seen.insert(part) {
                    continue;
                }
                if self.is_array_or_tuple(part) || self.built_in_for_type(part).is_some() {
                    pending.extend(self.type_arguments(part).to_vec().into_iter().map(|held| (held, depth + 1)));
                    continue;
                }
                if self.is_instance_type(part) || !self.contains_only_plain_data(part, &mut FxHashSet::default()) {
                    continue;
                }
                let Some(members) = self.members(part) else { continue };
                if members.shape().props.len() > 6 {
                    found.push(part);
                }
                pending.extend(members.shape().index.iter().map(|info| (info.value, depth + 1)));
                for prop in members.shape().props.iter() {
                    pending.push((self.type_of_prop(prop, members.mapper), depth + 1));
                }
            }
        }
        found
    }

    fn destination_type(&mut self, file: FileId, e: ExprId, is_untyped: bool) -> Option<TypeId> {
        let hir = self.hir(file);
        let enters = match self.bound(file).expr_parent[e.idx()] {
            Parent::Expr(parent) => match hir[parent].kind {
                ExprKind::Call(call) | ExprKind::New(call) => hir[call].callee != e,
                ExprKind::Array(_) => true,
                ExprKind::Yield { value, star: false } => value == e,
                ExprKind::Assign { op: None | Some(crate::hir::BinOp::And | crate::hir::BinOp::Or | crate::hir::BinOp::Nullish), value, .. } => value == e,
                _ => false,
            },
            Parent::Prop(_) => true,
            Parent::Stmt(stmt) => matches!(hir[stmt].kind, crate::hir::StmtKind::Return(_)),
            Parent::FnBody(_) => true,
            _ => false,
        };
        if !enters || matches!(hir[e].kind, ExprKind::Spread(_) | ExprKind::Missing) {
            return None;
        }
        let source = self.type_of_expr(file, e);
        if self.is_uninformative(source) != is_untyped || !is_untyped && self.parts(source).iter().all(|&part| self.has_primitive_flag(part)) {
            return None;
        }
        if is_untyped && self.is_syntactically_nullish(file, e) {
            return None;
        }
        if let Some(parameter) = self.parameter_reached_through_bind_or_apply(file, e) {
            return Some(parameter);
        }
        let entered = self.contextual_type_of_literal(file, e).or_else(|| match self.bound(file).expr_parent[e.idx()] {
            Parent::Expr(parent) if matches!(hir[parent].kind, ExprKind::Array(_)) => {
                let array = self.type_of_expr(file, parent);
                self.index_type_of_type(array, TypeId::NUMBER)
            }
            _ => None,
        });
        entered.filter(|&target| !self.is_uninformative(target))
    }

    fn parameter_reached_through_bind_or_apply(&mut self, file: FileId, e: ExprId) -> Option<TypeId> {
        let hir = self.hir(file);
        let Parent::Expr(parent) = self.bound(file).expr_parent[e.idx()] else { return None };
        let (function, list, skipped) = match hir[parent].kind {
            ExprKind::Call(call) => {
                let ExprKind::Dot { obj, .. } = hir[hir[call].callee].kind else { return None };
                if !self.is_function_bind(file, parent) {
                    return None;
                }
                (obj, hir[call].args, 1)
            }
            ExprKind::Array(elements) => {
                let Parent::Expr(outer) = self.bound(file).expr_parent[parent.idx()] else { return None };
                let ExprKind::Call(call) = hir[outer].kind else { return None };
                let ExprKind::Dot { obj, name, .. } = hir[hir[call].callee].kind else { return None };
                let is_reflect_apply = matches!(hir[obj].kind, ExprKind::Ident(holder) if self.atoms().bytes(holder) == b"Reflect") && self.atoms().bytes(name) == b"apply";
                let mut arguments = hir.ids(hir[call].args);
                let function = arguments.next()?;
                if !is_reflect_apply || arguments.nth(1) != Some(parent) {
                    return None;
                }
                (function, elements, 0)
            }
            _ => return None,
        };
        let position = hir.ids(list).position(|argument| argument == e)?;
        if position < skipped || hir.ids(list).take(position).any(|argument| matches!(hir[argument].kind, ExprKind::Spread(_))) {
            return None;
        }
        let of_function = self.type_of_expr(file, function);
        let mut reached = Vec::new();
        for &part in self.parts(of_function) {
            for &signature in self.signatures(part, false).iter() {
                let parameters = self.sig_params(signature);
                reached.extend(self.param_type_at(&parameters, position - skipped));
            }
        }
        if reached.is_empty() {
            return None;
        }
        let reached = self.union(&reached);
        (!self.is_uninformative(reached)).then_some(reached)
    }

    pub fn spread_destination_types(&mut self, file: FileId, e: ExprId) -> Option<(TypeId, TypeId)> {
        let hir = self.hir(file);
        let ExprKind::Spread(spread) = hir[e].kind else { return None };
        let Parent::Expr(parent) = self.bound(file).expr_parent[e.idx()] else { return None };
        if !matches!(hir[parent].kind, ExprKind::Call(call) | ExprKind::New(call) if hir[call].callee != e) {
            return None;
        }
        let iterable = self.type_of_expr(file, spread);
        let source = self.iterated_type(iterable, false);
        let target = self.contextual_type_of_literal(file, e)?;
        (!self.is_uninformative(source) && !self.is_uninformative(target)).then_some((source, target))
    }

    pub fn assigned_property_types(&mut self, source: TypeId, target: TypeId) -> Vec<(TypeId, TypeId)> {
        let mut entering = Vec::new();
        for &from in &self.parts(source).to_vec() {
            let Some(of_source) = self.members(from) else { continue };
            for &to in &self.parts(target).to_vec() {
                let Some(of_target) = self.members(to) else { continue };
                for prop in of_source.shape().props.iter() {
                    if let Some(taking) = of_target.resolved.prop(prop.name) {
                        entering.push((self.type_of_prop(prop, of_source.mapper), self.type_of_prop(taking, of_target.mapper)));
                    }
                }
            }
        }
        entering
    }

    pub fn callback_argument_types(&mut self, source: TypeId, target: TypeId) -> Vec<(TypeId, TypeId)> {
        let mut entering = Vec::new();
        if !matches!(self.data(source), TypeData::Fns { .. } | TypeData::Anon { origin: Origin::Function(_), .. }) {
            return entering;
        }
        for &part in self.parts(target) {
            for &called_as in self.signatures(part, false).iter() {
                let has_external_caller = self.sig_decl(called_as).is_some_and(|(file, ..)| self.is_untyped_file(file) || self.is_declaration_only(file));
                if !has_external_caller {
                    continue;
                }
                let arguments = self.sig_params(called_as);
                for &declared_sig in self.signatures(source, false).iter() {
                    if !self.sig_decl(declared_sig).is_some_and(|(file, ..)| !self.is_untyped_file(file) && !self.is_declaration_only(file)) {
                        continue;
                    }
                    let parameters = self.sig_params(declared_sig);
                    for index in 0..parameters.len() {
                        if let (Some(argument), Some(parameter)) = (self.param_type_at(&arguments, index), self.param_type_at(&parameters, index)) {
                            entering.push((argument, parameter));
                        }
                    }
                }
            }
        }
        entering
    }

    pub fn nested_inflow_pairs(&mut self, source: TypeId, target: TypeId) -> Vec<(TypeId, TypeId)> {
        let mut entering = Vec::new();
        if source == target || self.is_uninformative(source) || self.is_uninformative(target) {
            return entering;
        }
        if let Some(known) = self.aot.flows.nested_pairs_cache.get(&(source, target)) {
            if known.pairs.is_empty() || !self.aot.flows.visited_inflow_pairs.insert((source, target)) {
                return entering;
            }
            let known = std::rc::Rc::clone(known);
            let mut taken = 0;
            for &(from, to, start, end) in &known.runs {
                entering.extend_from_slice(&known.pairs[taken..start]);
                let first = entering.len();
                entering.extend_from_slice(&known.pairs[start..end]);
                taken = end;
                self.truncate_growing_types(from, to, first, &mut entering);
            }
            entering.extend_from_slice(&known.pairs[taken..]);
            return entering;
        }
        let caches = self.type_caches().filter(|_| is_published(source) && is_published(target));
        if let Some(known) = caches.and_then(|caches| caches.nested_pairs_cache.get_as((source, target), NestedPairs::clone)) {
            self.aot.flows.nested_pairs_cache.insert((source, target), std::rc::Rc::new(known));
            return self.nested_inflow_pairs(source, target);
        }
        if !self.aot.flows.visited_inflow_pairs.insert((source, target)) {
            return entering;
        }
        let is_result_cacheable = !self.results_are_provisional();
        let careful_before = (self.stack_half_used_count(), self.aot.flows.unknown_count);
        let scope = self.begin_scope();
        let marks_before = (self.non_cacheable_mark(), self.cuts());
        let mut held = NestedPairs::default();
        let is_large = self.parts(target).len() >= 16;
        let large = if is_large { self.large_union_info(target) } else { Default::default() };
        let mut functions_of: Vec<Option<std::rc::Rc<[(Atom, TypeId)]>>> = vec![None; if is_large { 0 } else { self.parts(target).len() }];
        let mut value_summary: Vec<Option<([Option<TypeId>; 2], [bool; 2])>> = vec![None; functions_of.len()];
        let (taking, by_declaration) = (&large.relevant_parts, &large.parts_by_declaration);
        for &from in self.parts(source) {
            if self.has_primitive_flag(from) {
                continue;
            }
            let is_written = self.is_program_declared_record(from);
            let is_declared_only = !is_written && self.is_declared_only_record(from);
            let mut from_summary = None;
            let visited: Option<Vec<u32>> = (is_large && is_written).then(|| {
                let mut numbers = taking.clone();
                if let TypeData::Ref { target: declared, .. } = self.data(from) {
                    let first = by_declaration.partition_point(|of_part| of_part.0 < *declared);
                    numbers.extend(by_declaration[first..].iter().take_while(|of_part| of_part.0 == *declared).map(|of_part| of_part.1));
                    numbers.sort_unstable();
                    numbers.dedup();
                }
                numbers
            });
            let tags_of_from = if visited.as_ref().is_some_and(|numbers| numbers.len() > 1) { Some(self.tags_of(from)) } else { None };
            let mut next = 0;
            loop {
                let number = match &visited {
                    Some(numbers) => match numbers.get(next) {
                        Some(&number) => number as usize,
                        None => break,
                    },
                    None if next < self.parts(target).len() => next,
                    None => break,
                };
                next += 1;
                let to = self.parts(target)[number];
                if from == to || self.has_primitive_flag(to) {
                    continue;
                }
                if let (TypeData::Ref { target: declared, .. }, TypeData::Ref { target: as_declared, .. }) = (self.data(from), self.data(to))
                    && declared == as_declared
                {
                    let (arguments, arguments_as) = (self.type_arguments(from), self.type_arguments(to));
                    entering.extend(arguments.iter().copied().zip(arguments_as.iter().copied()));
                    held.pairs.extend(arguments.iter().copied().zip(arguments_as.iter().copied()));
                    continue;
                }
                if !is_large
                    && self.parts(target).len() > 1
                    && matches!(self.data(from), TypeData::Ref { .. })
                    && !self.type_arguments(from).is_empty()
                    && self.declares_properties(from)
                    && self.declares_properties(to)
                    && self.is_accepted_by_other_union_part(from, to, target)
                {
                    continue;
                }
                if self.declares_properties(from) && self.declares_properties(to) {
                    let erased = (self.erase_cloned_type_params(from), self.erase_cloned_type_params(to));
                    if erased != (from, to) {
                        if erased.0 != erased.1 {
                            let mut run = Vec::new();
                            self.add_inflow_pairs_between_records(erased.0, erased.1, &mut run);
                            held.add_run(erased.0, erased.1, &run);
                            if self.aot.flows.visited_inflow_pairs.insert(erased) {
                                let first = entering.len();
                                entering.extend_from_slice(&run);
                                self.truncate_growing_types(erased.0, erased.1, first, &mut entering);
                            }
                        }
                        continue;
                    }
                }
                if let Some(tags_of_from) = tags_of_from.as_ref().filter(|tags| !tags.is_empty()) {
                    let tags_of_to = self.tags_of(to);
                    let has_none_in_common = |(name, constants): &(Atom, Box<[u64]>)| tags_of_to.iter().any(|(same, taken)| same == name && constants.iter().all(|constant| !taken.contains(constant)));
                    if tags_of_from.iter().any(has_none_in_common) {
                        continue;
                    }
                }
                let first = entering.len();
                let (held_by_key, is_declared) = match from_summary {
                    Some(known) => known,
                    None => *from_summary.insert(self.element_and_call_types_of(from)),
                };
                let (slot_type, is_called) = match if is_large { large.element_and_call_types[number] } else { value_summary[number] } {
                    Some(known) => known,
                    None if is_large => self.element_and_call_types_of(to),
                    None => *value_summary[number].insert(self.element_and_call_types_of(to)),
                };
                for key in 0..2 {
                    if let (Some(held), Some(slot_type)) = (held_by_key[key], slot_type[key]) {
                        entering.push((held, slot_type));
                    }
                }
                for constructs in [false, true] {
                    if !is_declared[usize::from(constructs)] || !is_called[usize::from(constructs)] {
                        continue;
                    }
                    for &called_as in self.signatures(to, constructs).iter() {
                        let arguments = self.sig_params(called_as);
                        for &declared_sig in self.signatures(from, constructs).iter() {
                            let parameters = self.sig_params(declared_sig);
                            for index in 0..parameters.len() {
                                if let (Some(argument), Some(parameter)) = (self.param_type_at(&arguments, index), self.param_type_at(&parameters, index)) {
                                    entering.push((argument, parameter));
                                }
                            }
                            entering.push((self.sig_return(declared_sig), self.sig_return(called_as)));
                        }
                    }
                }
                if !is_written {
                    if is_declared_only {
                        for (name, slot_type) in self.object_members(to) {
                            if let Some(held) = self.type_of_property(from, name)
                                && held != slot_type
                            {
                                entering.push((held, slot_type));
                            }
                        }
                    }
                    held.add_run(from, to, &entering[first..]);
                    self.truncate_growing_types(from, to, first, &mut entering);
                    continue;
                }
                let functions = match if is_large { &large.function_members[number] } else { &functions_of[number] } {
                    Some(known) => std::rc::Rc::clone(known),
                    None if is_large => self.function_members_cache(to),
                    None => std::rc::Rc::clone(functions_of[number].insert(self.function_members_cache(to))),
                };
                for &(name, slot_type) in functions.iter() {
                    if let Some(held) = self.type_of_property(from, name)
                        && held != slot_type
                    {
                        entering.push((held, slot_type));
                    }
                }
                held.add_run(from, to, &entering[first..]);
                self.truncate_growing_types(from, to, first, &mut entering);
            }
        }
        let is_whole = self.end_scope(scope).is_ok() && marks_before == (self.non_cacheable_mark(), self.cuts());
        if is_result_cacheable && careful_before == (self.stack_half_used_count(), self.aot.flows.unknown_count) {
            if let Some(caches) = caches.filter(|_| is_whole && held.is_published() && !self.has_order_dependent_results()) {
                caches.nested_pairs_cache.insert((source, target), held.clone());
            }
            self.aot.flows.nested_pairs_cache.insert((source, target), std::rc::Rc::new(held));
        }
        entering
    }

    fn add_inflow_pairs_between_records(&mut self, from: TypeId, to: TypeId, entering: &mut Vec<(TypeId, TypeId)>) {
        let (held_by_key, is_declared) = self.element_and_call_types_of(from);
        let (slot_type, is_called) = self.element_and_call_types_of(to);
        for key in 0..2 {
            if let (Some(held), Some(slot_type)) = (held_by_key[key], slot_type[key]) {
                entering.push((held, slot_type));
            }
        }
        for constructs in [false, true] {
            if !is_declared[usize::from(constructs)] || !is_called[usize::from(constructs)] {
                continue;
            }
            for &called_as in self.signatures(to, constructs).iter() {
                let arguments = self.sig_params(called_as);
                for &declared_sig in self.signatures(from, constructs).iter() {
                    let parameters = self.sig_params(declared_sig);
                    for index in 0..parameters.len() {
                        if let (Some(argument), Some(parameter)) = (self.param_type_at(&arguments, index), self.param_type_at(&parameters, index)) {
                            entering.push((argument, parameter));
                        }
                    }
                    entering.push((self.sig_return(declared_sig), self.sig_return(called_as)));
                }
            }
        }
        let members: Vec<(Atom, TypeId)> = if self.is_program_declared_record(from) {
            self.function_members_cache(to).to_vec()
        } else if self.is_declared_only_record(from) {
            self.object_members(to)
        } else {
            Vec::new()
        };
        for (name, slot_type) in members {
            if let Some(held) = self.type_of_property(from, name)
                && held != slot_type
            {
                entering.push((held, slot_type));
            }
        }
    }

    fn collect_cloned_type_params(&mut self, ty: TypeId) -> std::rc::Rc<[TypeId]> {
        let mut pending = vec![ty];
        while let Some(&at) = pending.last() {
            if self.aot.flows.cloned_type_params.contains_key(&at) {
                pending.pop();
                continue;
            }
            if matches!(*self.data(at), TypeData::TypeParam(_, _, around) if around != MapperId::IDENTITY) {
                self.aot.flows.cloned_type_params.insert(at, [at].into());
                pending.pop();
                continue;
            }
            let mut referred = self.referenced_types(at);
            referred.retain(|&argument| self.has_type_variables(argument));
            let known = pending.len();
            pending.extend(referred.iter().copied().filter(|argument| !self.aot.flows.cloned_type_params.contains_key(argument)));
            if pending.len() > known {
                continue;
            }
            let mut all: Vec<TypeId> = Vec::new();
            for argument in &referred {
                all.extend(self.aot.flows.cloned_type_params[argument].iter().copied());
            }
            all.sort_unstable_by_key(|parameter| parameter.0);
            all.dedup();
            self.aot.flows.cloned_type_params.insert(at, all.into());
            pending.pop();
        }
        std::rc::Rc::clone(&self.aot.flows.cloned_type_params[&ty])
    }

    fn erase_cloned_type_params(&mut self, ty: TypeId) -> TypeId {
        if !self.has_type_variables(ty) {
            return ty;
        }
        let cloned = self.collect_cloned_type_params(ty);
        if cloned.is_empty() {
            return ty;
        }
        if let Some(&known) = self.aot.flows.erased_cloned_type_params.get(&ty) {
            return known;
        }
        let (found, is_cacheable) = self.compute_cacheable(|c| {
            let mut pairs: Vec<(TypeId, TypeId)> = Vec::with_capacity(cloned.len());
            for &parameter in cloned.iter() {
                let mut bound = c.base_constraint(parameter);
                if bound == parameter {
                    bound = TypeId::UNKNOWN;
                }
                let within: Vec<(TypeId, TypeId)> = c.collect_cloned_type_params(bound).iter().map(|&inner| (inner, TypeId::UNKNOWN)).collect();
                if !within.is_empty() {
                    let to_unknown = c.types().mapper(within);
                    bound = c.instantiate(bound, to_unknown);
                }
                pairs.push((parameter, bound));
            }
            let to_constraints = c.types().mapper(pairs);
            c.instantiate(ty, to_constraints)
        });
        if is_cacheable {
            self.aot.flows.erased_cloned_type_params.insert(ty, found);
        }
        found
    }

    fn is_accepted_by_other_union_part(&mut self, from: TypeId, to: TypeId, union: TypeId) -> bool {
        let unknown_before = self.aot.flows.unknown_count;
        let (permissive_from, permissive_to) = (self.permissive_instantiation(from), self.permissive_instantiation(to));
        if self.is_provably_assignable(permissive_from, permissive_to) || self.aot.flows.unknown_count != unknown_before {
            return false;
        }
        self.parts(union).iter().any(|&part| part != to && (part == from || self.is_upcast_safe(from, part)))
    }

    fn large_union_info(&mut self, union: TypeId) -> std::rc::Rc<LargeUnionInfo> {
        let is_result_cacheable = !self.results_are_provisional();
        if is_result_cacheable && let Some(known) = self.aot.flows.large_union_infos.get(&union) {
            return std::rc::Rc::clone(known);
        }
        let careful_before = (self.stack_half_used_count(), self.aot.flows.unknown_count);
        let part_count = self.parts(union).len();
        let mut info = LargeUnionInfo { element_and_call_types: vec![None; part_count], function_members: vec![None; part_count], ..Default::default() };
        for (number, &part) in self.parts(union).iter().enumerate() {
            if self.has_primitive_flag(part) {
                continue;
            }
            if let TypeData::Ref { target: declared, .. } = *self.data(part) {
                info.parts_by_declaration.push((declared, number as u32));
            }
            let (element_types, is_called) = *info.element_and_call_types[number].insert(self.element_and_call_types_of(part));
            let functions = self.function_members_cache(part);
            if element_types != [None, None] || is_called != [false, false] || !functions.is_empty() {
                info.relevant_parts.push(number as u32);
            }
            info.function_members[number] = Some(functions);
        }
        info.parts_by_declaration.sort_unstable();
        let info = std::rc::Rc::new(info);
        if is_result_cacheable && careful_before == (self.stack_half_used_count(), self.aot.flows.unknown_count) {
            self.aot.flows.large_union_infos.insert(union, std::rc::Rc::clone(&info));
        }
        info
    }

    fn tags_of(&mut self, ty: TypeId) -> std::rc::Rc<[(Atom, Box<[u64]>)]> {
        let is_result_cacheable = !self.results_are_provisional();
        if is_result_cacheable && let Some(known) = self.aot.flows.tags.get(&ty) {
            return std::rc::Rc::clone(known);
        }
        let careful_before = (self.stack_half_used_count(), self.aot.flows.unknown_count);
        let mut tags = Vec::new();
        if let Some(members) = self.members(ty) {
            for prop in members.shape().props.iter().filter(|prop| !prop.flags.contains(PropFlags::OPTIONAL)) {
                let of_prop = self.type_of_prop(prop, members.mapper);
                if !self.parts(of_prop).iter().all(|&part| matches!(self.data(part), TypeData::StringLit { .. } | TypeData::NumberLit { .. } | TypeData::EnumLit { .. })) {
                    continue;
                }
                let constants: Box<[u64]> = (self.type_literals(of_prop).into_iter())
                    .map(|constant| match constant {
                        Literal::String(text) => 0x7FF8_0001_0000_0000 | u64::from(text.0),
                        Literal::Number(number) => number.to_bits(),
                    })
                    .collect();
                if !constants.is_empty() {
                    tags.push((prop.name, constants));
                }
            }
        }
        let tags: std::rc::Rc<[(Atom, Box<[u64]>)]> = tags.into();
        if is_result_cacheable && careful_before == (self.stack_half_used_count(), self.aot.flows.unknown_count) {
            self.aot.flows.tags.insert(ty, std::rc::Rc::clone(&tags));
        }
        tags
    }

    fn object_members(&mut self, ty: TypeId) -> Vec<(Atom, TypeId)> {
        if !self.is_program_declared_record(ty) {
            return Vec::new();
        }
        let Some(members) = self.members(ty) else { return Vec::new() };
        let names: Vec<Atom> = members.shape().props.iter().map(|prop| prop.name).collect();
        let mut found = Vec::new();
        for name in names {
            if let Some(slot_type) = self.type_of_property(ty, name)
                && (self.may_hold_objects(slot_type) || self.parts(slot_type).iter().any(|&part| !self.signatures(part, false).is_empty()))
            {
                found.push((name, slot_type));
            }
        }
        found
    }

    fn function_members_cache(&mut self, ty: TypeId) -> std::rc::Rc<[(Atom, TypeId)]> {
        let is_result_cacheable = !self.results_are_provisional();
        if is_result_cacheable && let Some(known) = self.aot.flows.function_members_cache.get(&ty) {
            return std::rc::Rc::clone(known);
        }
        let caches = self.type_caches().filter(|_| is_published(ty));
        if let Some(known) = caches.and_then(|caches| caches.function_members.get_as(ty, |known| std::rc::Rc::<[(Atom, TypeId)]>::from(&known[..]))) {
            self.aot.flows.function_members_cache.insert(ty, std::rc::Rc::clone(&known));
            return known;
        }
        let careful_before = (self.stack_half_used_count(), self.aot.flows.unknown_count);
        let scope = self.begin_scope();
        let marks_before = (self.non_cacheable_mark(), self.cuts());
        let mut functions = Vec::new();
        if self.is_program_declared_record(ty)
            && let Some(members) = self.members(ty)
        {
            let names: Vec<Atom> = members.shape().props.iter().map(|prop| prop.name).collect();
            for name in names {
                if let Some(slot_type) = self.type_of_property(ty, name)
                    && self.parts(slot_type).iter().any(|&part| !self.signatures(part, false).is_empty())
                {
                    functions.push((name, slot_type));
                }
            }
        }
        let is_whole = self.end_scope(scope).is_ok() && marks_before == (self.non_cacheable_mark(), self.cuts());
        let functions: std::rc::Rc<[(Atom, TypeId)]> = functions.into();
        if is_result_cacheable && careful_before == (self.stack_half_used_count(), self.aot.flows.unknown_count) {
            self.aot.flows.function_members_cache.insert(ty, std::rc::Rc::clone(&functions));
            let is_task_independent = is_whole && functions.iter().all(|&(name, slot_type)| !name.is_own() && is_published(slot_type));
            if let Some(caches) = caches.filter(|_| is_task_independent && !self.has_order_dependent_results()) {
                caches.function_members.insert(ty, functions.iter().copied().collect());
            }
        }
        functions
    }

    pub fn dictionary_cast_value_pairs(&mut self, source: TypeId, target: TypeId) -> std::rc::Rc<[(TypeId, TypeId)]> {
        if !self.results_are_provisional()
            && let Some(known) = self.aot.flows.cast_into_dictionaries.get(&(source, target))
        {
            return std::rc::Rc::clone(known);
        }
        let (found, is_cacheable) = self.compute_cacheable(|c| c.compute_dictionary_cast_value_pairs(source, target));
        let found: std::rc::Rc<[(TypeId, TypeId)]> = found.into();
        if is_cacheable {
            self.aot.flows.cast_into_dictionaries.insert((source, target), std::rc::Rc::clone(&found));
        }
        found
    }

    fn compute_stored_property_types(&mut self, ty: TypeId) -> std::rc::Rc<[(Atom, TypeId)]> {
        if !self.results_are_provisional()
            && let Some(known) = self.aot.flows.stored_property_types.get(&ty)
        {
            return std::rc::Rc::clone(known);
        }
        let (found, is_cacheable) = self.compute_cacheable(|c| {
            let names: Vec<Atom> = c.members(ty).map_or_else(Vec::new, |members| members.shape().props.iter().map(|prop| prop.name).collect());
            names.into_iter().filter_map(|name| Some((name, c.type_of_property(ty, name)?))).collect::<Vec<(Atom, TypeId)>>()
        });
        let found: std::rc::Rc<[(Atom, TypeId)]> = found.into();
        if is_cacheable {
            self.aot.flows.stored_property_types.insert(ty, std::rc::Rc::clone(&found));
        }
        found
    }

    fn stored_property_type(&mut self, ty: TypeId, name: Atom) -> Option<TypeId> {
        if !self.results_are_provisional()
            && let Some(&known) = self.aot.flows.stored_property_type.get(&(ty, name))
        {
            return known;
        }
        let (found, is_cacheable) = self.compute_cacheable(|c| c.type_of_property(ty, name));
        if is_cacheable {
            self.aot.flows.stored_property_type.insert((ty, name), found);
        }
        found
    }

    fn compute_dictionary_cast_value_pairs(&mut self, source: TypeId, target: TypeId) -> Vec<(TypeId, TypeId)> {
        let mut found = Vec::new();
        let mut pending = vec![(source, target, 0u8)];
        let mut seen: FxHashSet<(TypeId, TypeId)> = FxHashSet::default();
        while let Some((source, target, depth)) = pending.pop() {
            if depth > 4 || source == target || self.is_uninformative(source) || self.is_uninformative(target) || !seen.insert((source, target)) {
                continue;
            }
            for from in self.parts(source).to_vec() {
                if self.has_primitive_flag(from) || !self.is_program_declared_record(from) || self.index_type_of_type(from, TypeId::STRING).is_some() {
                    continue;
                }
                let stored_property_types = self.compute_stored_property_types(from);
                for to in self.parts(target).to_vec() {
                    if from == to || self.has_primitive_flag(to) {
                        continue;
                    }
                    let value = self.index_type_of_type(to, TypeId::STRING);
                    for &(name, held) in stored_property_types.iter() {
                        match value {
                            Some(value) => {
                                found.push((held, value));
                                pending.push((held, value, depth + 1));
                            }
                            None => {
                                if let Some(slot_type) = self.stored_property_type(to, name) {
                                    pending.push((held, slot_type, depth + 1));
                                }
                            }
                        }
                    }
                }
            }
        }
        found
    }

    pub(super) fn type_caches(&self) -> Option<&'p TypeCaches> {
        let program = self.p;
        let is_shared = self.aot.is_translating
            && program.aot.storage.external_types.is_finalized()
            && !self.is_warming_up()
            && !self.results_are_provisional()
            && self.aot.flows.stored.is_none()
            && self.aot.flows.seen_before.is_none();
        is_shared.then(|| &program.aot.type_caches)
    }

    fn element_and_call_types_of(&mut self, ty: TypeId) -> ([Option<TypeId>; 2], [bool; 2]) {
        let is_result_cacheable = !self.results_are_provisional();
        if is_result_cacheable && let Some(&known) = self.aot.flows.element_and_call_types.get(&ty) {
            return known;
        }
        let caches = self.type_caches().filter(|_| is_published(ty));
        if let Some(known) = caches.and_then(|caches| caches.index_and_call_facts.get_as(ty, |&known| known)) {
            self.aot.flows.element_and_call_types.insert(ty, known);
            return known;
        }
        let careful_before = (self.stack_half_used_count(), self.aot.flows.unknown_count);
        let (found, is_cacheable) = self.compute_cacheable(|c| {
            let held = [TypeId::NUMBER, TypeId::STRING].map(|key| c.index_type_of_type(ty, key));
            (held, [false, true].map(|constructs| !c.signatures(ty, constructs).is_empty()))
        });
        if is_result_cacheable && careful_before == (self.stack_half_used_count(), self.aot.flows.unknown_count) {
            self.aot.flows.element_and_call_types.insert(ty, found);
            let is_task_independent = is_cacheable && found.0.iter().flatten().all(|&held| is_published(held));
            if let Some(caches) = caches.filter(|_| is_task_independent && !self.has_order_dependent_results()) {
                caches.index_and_call_facts.insert(ty, found);
            }
        }
        found
    }

    fn application_of(&self, ty: TypeId) -> Applied {
        match *self.data(ty) {
            TypeData::Ref { target, .. } => Applied::Named(target),
            TypeData::Anon { origin, .. } => Applied::Written(origin),
            TypeData::Fns { ref decls, .. } => decls.first().map_or(Applied::Computed, |&(file, func)| Applied::Function(file, func)),
            TypeData::Intersection(ref parts) => parts.first().map_or(Applied::Computed, |&part| self.application_of(part)),
            _ => Applied::Computed,
        }
    }

    fn nests_one_application_too_often(&mut self, ty: TypeId) -> bool {
        if self.nesting_bound(ty) <= MAX_NESTED_APPLICATIONS {
            return false;
        }
        self.collect_applications(ty);
        self.aot.flows.applications[&ty].iter().any(|&(_, times)| times > MAX_NESTED_APPLICATIONS)
    }

    fn is_self_nesting_growing(&mut self, inner: TypeId, outer: [TypeId; 2]) -> bool {
        if self.nesting_bound(inner) == 0 {
            return false;
        }
        for ty in [inner, outer[0], outer[1]] {
            self.collect_applications(ty);
        }
        let applications = &self.aot.flows.applications;
        applications[&inner].iter().any(|&(applied, times)| {
            let around = outer.iter().filter_map(|ty| applications[ty].iter().find(|known| known.0 == applied)).map(|known| known.1).max();
            around.is_some_and(|around| times > around)
        })
    }

    pub fn unknown_count(&self) -> usize {
        self.aot.flows.unknown_count
    }

    pub(super) fn compute_cacheable<R>(&mut self, compute: impl FnOnce(&mut Checker<'p, 's>) -> R) -> (R, bool) {
        let is_result_cacheable = !self.results_are_provisional();
        let scope = self.begin_scope();
        let before = (self.non_cacheable_mark(), self.cuts(), self.stack_half_used_count(), self.aot.flows.unknown_count);
        let found = compute(self);
        let is_whole = before == (self.non_cacheable_mark(), self.cuts(), self.stack_half_used_count(), self.aot.flows.unknown_count);
        (found, self.end_scope(scope).is_ok() && is_whole && is_result_cacheable)
    }

    pub fn contextual_type_of_literal(&mut self, file: FileId, e: ExprId) -> Option<TypeId> {
        if let Some(&cached) = self.aot.flows.literal_contextual_types.get(&(file, e)) {
            return cached;
        }
        let (found, is_cacheable) = self.compute_cacheable(|c| c.contextual_type_of_literal_uncached(file, e));
        if is_cacheable {
            self.aot.flows.literal_contextual_types.insert((file, e), found);
        }
        found
    }

    pub(super) fn results_are_provisional(&self) -> bool {
        self.aot.flows.is_searching_from_sources || self.aot.flows.taint_query_depth != 0 || self.aot.flows.finding_canonical != 0
    }

    pub fn descend_into_checked_value(&mut self) {
        self.aot.flows.levels_inspected += 1;
    }

    pub fn ascend_from_checked_value(&mut self) {
        self.aot.flows.levels_inspected -= 1;
    }

    fn truncate_growing_types(&mut self, from: TypeId, to: TypeId, first: usize, entering: &mut Vec<(TypeId, TypeId)>) {
        if entering.len() == first {
            return;
        }
        let mut grown = Vec::new();
        let is_walk_deep = self.aot.flows.levels_inspected > 2 * MAX_NESTED_APPLICATIONS;
        let mut is_any_too_deep = false;
        for index in first..entering.len() {
            let (held, slot_type) = entering[index];
            let is_too_deep = is_walk_deep && (self.nests_one_application_too_often(held) || self.nests_one_application_too_often(slot_type));
            is_any_too_deep |= is_too_deep;
            if is_too_deep || self.is_self_nesting_growing(held, [from, to]) || self.is_self_nesting_growing(slot_type, [from, to]) {
                grown.push(index);
            }
        }
        let key = (self.application_of(from), self.application_of(to));
        let times = self.aot.flows.looked_into.entry(key).or_default();
        times[0] += 1;
        times[1] += u32::from(!grown.is_empty());
        let [at_all, for_what_grows] = *times;
        let levels = self.aot.flows.levels_inspected;
        let maximum = &mut self.aot.flows.recorded.max_inspected;
        *maximum = [maximum[0].max(at_all), maximum[1].max(for_what_grows), maximum[2].max(levels)];
        let why = if levels > MAX_LEVELS_INSPECTED {
            3
        } else if self.is_half_of_stack_in_use() {
            2
        } else if at_all > MAX_INSTANTIATIONS_INSPECTED_IN_TOTAL {
            1
        } else if for_what_grows > MAX_INSTANTIATIONS_INSPECTED && !grown.is_empty() {
            0
        } else if is_any_too_deep {
            grown.retain(|&index| {
                let (held, slot_type) = entering[index];
                self.nests_one_application_too_often(held) || self.nests_one_application_too_often(slot_type)
            });
            0
        } else {
            return;
        };
        if why != 0 {
            grown = (first..entering.len()).collect();
        }
        let at = self.aot.flows.place;
        self.aot.flows.recorded.truncated.entry(at).or_default()[why] += 1;
        for index in grown.into_iter().rev() {
            let (held, slot_type) = entering.remove(index);
            self.record_uninspected_type(held, slot_type);
        }
    }

    fn record_untyped_source_once(&mut self, ty: TypeId) {
        if ty == TypeId::UNRESOLVED {
            return;
        }
        let (mut seen, mut views) = (std::mem::take(&mut self.aot.flows.uninspected), Vec::new());
        self.add_types_staying_untyped(ty, true, &mut seen, &mut views);
        self.aot.flows.uninspected = seen;
        for view in views {
            self.record_untyped(view, TypeId::UNRESOLVED);
        }
    }

    fn record_uninspected_type(&mut self, held: TypeId, slot_type: TypeId) {
        self.record_untyped_source_once(slot_type);
        for (function, is_what_it_is_called_as) in [(slot_type, true), (held, false)] {
            for &part in self.parts(function) {
                for constructs in [false, true] {
                    for &signature in self.signatures(part, constructs).iter() {
                        if is_what_it_is_called_as {
                            let produced = self.sig_return(signature);
                            self.record_untyped_source_once(produced);
                            continue;
                        }
                        let parameters = self.sig_params(signature);
                        for index in 0..parameters.len() {
                            if let Some(parameter) = self.param_type_at(&parameters, index) {
                                self.record_untyped_source_once(parameter);
                            }
                        }
                    }
                }
            }
        }
    }

    fn is_program_declared_record(&self, ty: TypeId) -> bool {
        let file = match *self.data(ty) {
            TypeData::Ref { target, .. } => target.file,
            TypeData::Anon { origin: Origin::TypeLiteral(file, _) | Origin::ObjectLiteral(file, ..) | Origin::WidenedLiteral(file, ..), .. } => file,
            _ => return false,
        };
        !self.files.module(file).is_lib && self.hir(file).kind != FileKind::Declaration
    }

    pub fn accepts_untyped(&mut self, source: TypeId, views: &[TypeId]) -> bool {
        let source = self.reduced(source);
        if self.has_namespace_part(source) {
            let at = self.aot.flows.place;
            for &view in views {
                self.aot.flows.recorded.add_untyped(view, Some(source), at);
            }
        }
        let mut admitting = Vec::new();
        let is_accepted = self.find_accepting_types(source, views, &mut admitting) && !admitting.is_empty();
        if is_accepted {
            let at = self.aot.flows.place;
            let is_external = self.is_beyond_layouts(source);
            for view in admitting {
                self.aot.flows.recorded.add_untyped(view, Some(source), at);
                if is_external {
                    self.record_untyped_source(view);
                }
            }
        } else if self.has_tainted_part(source) {
            let at = self.aot.flows.place;
            for part in self.parts(source).to_vec() {
                if !self.is_tainted(part) {
                    continue;
                }
                for &view in views {
                    if self.is_instance_type(view) && self.is_upcast_safe(part, view) {
                        self.aot.flows.recorded.add_untyped(view, Some(part), at);
                    }
                }
            }
        }
        is_accepted
    }

    fn find_accepting_types(&mut self, source: TypeId, views: &[TypeId], out: &mut Vec<TypeId>) -> bool {
        if let TypeData::Union(parts) = self.data(source) {
            return parts.iter().all(|&part| self.find_accepting_types(part, views, out));
        }
        if self.is_uninformative(source) || source == TypeId::OBJECT {
            return false;
        }
        if self.is_instantiable(source) {
            let bound = self.base_constraint(source);
            return bound != source && self.find_accepting_types(bound, views, out);
        }
        if self.has_primitive_flag(source) {
            return true;
        }
        if self.accepts_primitives(source) {
            return false;
        }
        let mut not_known = Vec::new();
        for &view in views {
            let not_known_before = self.aot.flows.unknown_count;
            if self.is_upcast_safe(source, view) {
                out.push(view);
                return true;
            }
            if self.aot.flows.unknown_count != not_known_before {
                not_known.push(view);
            }
        }
        let is_accepted_conservatively = !not_known.is_empty();
        out.append(&mut not_known);
        is_accepted_conservatively
    }

    pub fn is_checked_against_class(&self, expected: TypeId) -> bool {
        self.parts(expected).iter().any(|&part| self.is_instance_type(part))
    }

    fn classes_of_types(&self, types: &[TypeId]) -> FxHashSet<Sym> {
        (types.iter())
            .filter_map(|&ty| match *self.data(ty) {
                TypeData::Ref { target, .. } if self.is_instance_type(ty) => Some(target),
                _ => None,
            })
            .collect()
    }

    fn classes_accepting_untyped(&mut self, escaped: &[TypeId], entered: &[TypeId], receiving_untyped_if_escaped: &[TypeId]) -> FxHashSet<Sym> {
        let (mut opened, evidence) = (self.classes_of_types(entered), self.classes_of_types(escaped));
        let (mut pending, mut ancestors_of_escaped): (Vec<TypeId>, FxHashSet<Sym>) = (escaped.to_vec(), FxHashSet::default());
        while let Some(ty) = pending.pop() {
            let TypeData::Ref { target, .. } = *self.data(ty) else { continue };
            if ancestors_of_escaped.insert(target) {
                pending.extend(self.base_types(target).iter().copied());
            }
        }
        for &ty in receiving_untyped_if_escaped {
            let TypeData::Ref { target, .. } = *self.data(ty) else { continue };
            if !self.is_instance_type(ty) || opened.contains(&target) {
                continue;
            }
            if ancestors_of_escaped.contains(&target) || self.extends_one_of(ty, &evidence) {
                opened.insert(target);
            }
        }
        opened
    }

    pub fn classes_served_by_untyped_clones(&mut self, escaped: &[TypeId], entered: &[TypeId], receiving_untyped_if_escaped: &[TypeId], classes: &[TypeId]) -> Vec<bool> {
        let opened = self.classes_accepting_untyped(escaped, entered, receiving_untyped_if_escaped);
        let mut pending: Vec<TypeId> = escaped.to_vec();
        let escaped = self.classes_of_types(escaped);
        let is_open: Vec<bool> = classes.iter().map(|&class| self.extends_one_of(class, &opened)).collect();
        let mut met: FxHashSet<Sym> = FxHashSet::default();
        for (&class, &is_open) in classes.iter().zip(&is_open) {
            if is_open || self.extends_one_of(class, &escaped) {
                pending.push(class);
            }
        }
        while let Some(ty) = pending.pop() {
            let TypeData::Ref { target, .. } = *self.data(ty) else { continue };
            if met.insert(target) {
                pending.extend(self.base_types(target).iter().copied());
            }
        }
        (classes.iter().zip(is_open)).map(|(&class, is_open)| !is_open && matches!(*self.data(class), TypeData::Ref { target, .. } if met.contains(&target))).collect()
    }

    pub fn record_untyped_object_evidence(&mut self, file: FileId) {
        let program = self.p;
        let retained = self.take_notes_recorded();
        for (_, expressions) in self.code_with_recorded_escapes(file) {
            self.record_escapes_of(file, &expressions);
        }
        self.record_escapes_of(file, &[]);
        let recorded = self.take_notes_recorded();
        self.aot.flows.recorded = retained;
        let recorded = recorded.renamed(|ty| match *self.data(ty) {
            TypeData::Ref { target, .. } if self.is_instance_type(ty) => Some(target),
            _ => None,
        });
        let mut evidence: FlowNotes<Sym> = FlowNotes::default();
        evidence.absorb_untyped_object_evidence(&recorded);
        let places = program.aot.storage.recorded_untyped_object_evidence.get_or_init(|| (0..program.files.modules.len()).map(|_| Guarded::new(None)).collect());
        *places[file.idx()].lock() = Some(evidence.absorbed.and_then(|absorbed| absorbed.escapes.mutations).unwrap_or_default());
    }

    pub fn merge_untyped_object_evidence(&mut self, is_compiled: &dyn Fn(FileId) -> bool) {
        let program = self.p;
        let Some(places) = program.aot.storage.recorded_untyped_object_evidence.get() else { return };
        let mut all: super::mutations::Mutations<Sym> = Default::default();
        for file in (0..program.files.modules.len() as u32).map(FileId) {
            if !is_compiled(file) || self.hir(file).kind == FileKind::Declaration || self.files.module(file).is_opaque() || self.is_untyped_file(file) {
                continue;
            }
            let Some(recorded) = places[file.idx()].lock().take() else { return };
            all.absorb_untyped_object_evidence(&recorded);
        }
        let evidence: FxHashSet<Sym> = all.all_with_untyped_object_evidence().into_iter().collect();
        let mut met: FxHashSet<Sym> = FxHashSet::default();
        let files = if evidence.is_empty() { Vec::new() } else { self.files_declaring_classes() };
        for file in files {
            for class in (0..self.hir(file).classes.len() as u32).map(ClassId) {
                let ty = self.class_instance_type(file, class);
                if !self.extends_one_of(ty, &evidence) {
                    continue;
                }
                let mut pending: Vec<TypeId> = vec![ty];
                while let Some(ty) = pending.pop() {
                    let TypeData::Ref { target, .. } = *self.data(ty) else { continue };
                    if met.insert(target) {
                        pending.extend(self.base_types(target).iter().copied());
                    }
                }
            }
        }
        let _ = program.aot.storage.untyped_object_evidence.set(met);
    }

    pub fn may_use_untyped_clones(&mut self, file: FileId, class: ClassId) -> bool {
        let program = self.p;
        let Some(met) = program.aot.storage.untyped_object_evidence.get() else { return true };
        let ty = self.class_instance_type(file, class);
        matches!(*self.data(ty), TypeData::Ref { target, .. } if met.contains(&target))
    }

    fn extends_one_of(&mut self, ty: TypeId, classes: &FxHashSet<Sym>) -> bool {
        let (mut pending, mut seen): (Vec<TypeId>, FxHashSet<Sym>) = (vec![ty], FxHashSet::default());
        while let Some(ty) = pending.pop() {
            let TypeData::Ref { target, .. } = *self.data(ty) else { continue };
            if !seen.insert(target) {
                continue;
            }
            if classes.contains(&target) {
                return true;
            }
            pending.extend(self.base_types(target).iter().copied());
        }
        false
    }

    pub fn record_external_data(&mut self, retained: &dyn Fn(&Identity) -> Option<TypeId>) -> usize {
        let external_types = self.external_types();
        let mut unretained: Vec<Identity> = Vec::new();
        for identity in &external_types.identities {
            match retained(identity) {
                Some(ty) => {
                    self.aot.flows.recorded.add_at(NoteKind::NoFixedLayout, ty, Place::NOWHERE);
                }
                None => unretained.push(*identity),
            }
        }
        unretained.sort_unstable();
        let atoms = self.atoms();
        self.aot.flows.unretained_external_data = unretained.iter().filter_map(|identity| external_types.names.get(identity)).map(|names| names.iter().filter_map(|name| atoms.lookup(name)).collect()).collect();
        unretained.len()
    }

    pub fn take_notes_recorded(&mut self) -> FlowNotes {
        self.aot.flows.visited_inflow_pairs.clear();
        self.aot.flows.nested_untyped_inflow_sites.clear();
        self.aot.flows.looked_into.clear();
        self.aot.flows.uninspected.clear();
        let mut recorded = std::mem::take(&mut self.aot.flows.recorded);
        recorded.sort_and_deduplicate();
        recorded
    }

    #[inline]
    pub(super) fn may_hold_objects(&self, ty: TypeId) -> bool {
        self.row(ty) & type_flags::MAY_HOLD_OBJECTS != 0
    }

    #[inline]
    pub(super) fn declares_properties(&self, ty: TypeId) -> bool {
        let row = self.row(ty);
        row & type_flags::DECLARES_PROPERTIES != 0 || row & type_flags::IS_NAMESPACE_OBJECT != 0 && matches!(self.data(ty), TypeData::Anon { origin: Origin::Module(namespace), .. } if self.is_reified_namespace(*namespace))
    }

    fn has_properties(&mut self, ty: TypeId) -> bool {
        self.members(ty).is_some_and(|members| !members.shape().props.is_empty())
    }

    fn add_object_types_in(&mut self, ty: TypeId, in_arrays: bool, seen: &mut FxHashSet<TypeId>, out: &mut Vec<TypeId>) {
        let ty = self.reduced(ty);
        if !self.may_hold_objects(ty) || !seen.insert(ty) {
            return;
        }
        if let TypeData::Union(parts) = self.data(ty) {
            for &part in parts.iter() {
                self.add_object_types_in(part, in_arrays, seen, out);
            }
        } else if self.is_instantiable(ty) {
            let bound = self.base_constraint(ty);
            self.add_object_types_in(bound, in_arrays, seen, out);
        } else if self.is_array_or_tuple(ty) {
            if in_arrays {
                for &element in self.type_arguments(ty) {
                    self.add_object_types_in(element, in_arrays, seen, out);
                }
            }
        } else if let Some(element) = self.array_subtype_element(ty) {
            if in_arrays {
                self.add_object_types_in(element, in_arrays, seen, out);
            }
        } else if self.declares_properties(ty) {
            out.push(self.layout_defining_type(ty));
        }
    }

    fn extends_untyped_code(&mut self, sym: Sym, depth: u32) -> bool {
        let declared: Vec<(FileId, Decl)> = self.files().decls_of(sym).to_vec();
        if declared.iter().any(|&(file, _)| self.is_untyped_file(file)) {
            return true;
        }
        if depth > 32 || !declared.iter().any(|&(file, decl)| matches!(decl, Decl::Class(class) if self.hir(file)[class].extends.is_some())) {
            return false;
        }
        let bases = self.base_types(sym).into_vec();
        bases.is_empty()
            || bases.into_iter().any(|base| match *self.data(base) {
                TypeData::Ref { target, .. } => self.extends_untyped_code(target, depth + 1),
                _ => true,
            })
    }

    fn root_of(&mut self, sym: Sym) -> Root {
        if self.aot.flows.roots.is_empty() {
            let others = [
                (known::Array, Root::Array),
                (known::ReadonlyArray, Root::Array),
                (known::Function, Root::Function),
                (known::CallableFunction, Root::Function),
                (known::NewableFunction, Root::Function),
            ];
            for (name, root) in others {
                if let Some(global) = self.global_type_symbol(name) {
                    self.aot.flows.roots.insert(global, root);
                }
            }
            for class in self.engine_classes() {
                self.aot.flows.roots.insert(class, Root::Class(class));
            }
        }
        if let Some(&known) = self.aot.flows.roots.get(&sym) {
            return known;
        }
        self.aot.flows.roots.insert(sym, Root::None);
        let is_called = self.files().decls_of(sym).iter().any(|&(file, decl)| {
            let hir = self.hir(file);
            matches!(decl, Decl::Interface(interface) if hir[interface].members.iter().any(|member| matches!(hir[member].kind, MemberKind::CallSignature | MemberKind::ConstructSignature)))
        });
        let is_of_package = self.is_ambient_interface(sym) && self.files().decls_of(sym).iter().all(|&(file, _)| !self.files().module(file).is_lib);
        let mut root = if !is_called {
            Root::None
        } else if is_of_package {
            Root::Claimed
        } else {
            Root::Function
        };
        for &base in self.base_types(sym).iter() {
            if root != Root::None {
                break;
            }
            if let TypeData::Ref { target, .. } = *self.data(base) {
                root = self.root_of(target);
            }
        }
        self.aot.flows.roots.insert(sym, root);
        root
    }

    fn engine_classes(&self) -> Vec<Sym> {
        ENGINE_CLASSES.iter().filter_map(|name| self.global_type_symbol(self.atoms().intern(name))).collect()
    }

    pub fn extended_built_in(&mut self, ty: TypeId) -> Option<BuiltIn> {
        match *self.data(ty) {
            TypeData::Ref { target, .. } if self.root_of(target) == Root::Class(target) => None,
            TypeData::Ref { .. } | TypeData::Intersection(_) => self.built_in_for_type(ty),
            _ => None,
        }
    }

    pub(super) fn is_primitive_or_built_in(&mut self, ty: TypeId) -> bool {
        self.is_primitive(ty) || matches!(self.built_in_for_type(ty), Some(BuiltIn::Instance(_)))
    }

    fn built_in_for_type(&mut self, ty: TypeId) -> Option<BuiltIn> {
        match *self.data(ty) {
            TypeData::Ref { target, .. } => match self.root_of(target) {
                Root::Function => Some(BuiltIn::Function),
                Root::Claimed => Some(BuiltIn::Claimed),
                Root::Class(class) if class == target => Some(BuiltIn::Instance(ty)),
                Root::Class(class) => {
                    let declared = self.declared_type(class);
                    Some(BuiltIn::Instance(self.permissive_instantiation(declared)))
                }
                _ => None,
            },
            TypeData::Intersection(ref parts) => parts.iter().find_map(|&part| self.built_in_for_type(part)),
            TypeData::Fns { .. } | TypeData::Anon { origin: Origin::Function(_) | Origin::ClassStatic(_), .. } => Some(BuiltIn::Function),
            TypeData::Anon { origin: Origin::TypeLiteral(file, _), .. } => {
                let is_called = !self.signatures(ty, false).is_empty() || !self.signatures(ty, true).is_empty();
                let is_of_package = self.hir(file).kind == FileKind::Declaration && !self.files().module(file).is_lib;
                is_called.then_some(if is_of_package { BuiltIn::Claimed } else { BuiltIn::Function })
            }
            _ => None,
        }
    }

    pub fn type_literals(&mut self, ty: TypeId) -> Vec<Literal> {
        let (mut strings, mut numbers): (Vec<Atom>, Vec<f64>) = (Vec::new(), Vec::new());
        let (mut is_any_string, mut is_any_number) = (false, false);
        let parts = self.parts(ty);
        let mut enums: Vec<TypeId> = Vec::new();
        for &part in parts {
            match *self.data(part) {
                TypeData::StringLit { value, .. } | TypeData::EnumLit { value: EnumValue::String(value), .. } => strings.push(value),
                TypeData::NumberLit { bits, .. } => numbers.push(f64::from_bits(bits)),
                TypeData::EnumLit { member, value: EnumValue::Number(bits), .. } => {
                    let whole = self.enum_type_of_member(member);
                    if !enums.contains(&whole) {
                        enums.push(whole);
                    }
                    numbers.push(f64::from_bits(bits));
                }
                TypeData::Intrinsic(Intrinsic::String) | TypeData::Template { .. } | TypeData::StringMapping { .. } => is_any_string = true,
                TypeData::Intrinsic(Intrinsic::Number) | TypeData::Enum { .. } => is_any_number = true,
                TypeData::Intrinsic(
                    Intrinsic::Undefined | Intrinsic::Missing | Intrinsic::UndefinedWidening | Intrinsic::Null | Intrinsic::NullWidening | Intrinsic::BigInt | Intrinsic::Symbol | Intrinsic::Object,
                )
                | TypeData::BoolLit { .. }
                | TypeData::BigIntLit { .. }
                | TypeData::UniqueSymbol { .. }
                | TypeData::Ref { .. }
                | TypeData::Tuple { .. }
                | TypeData::Anon { .. }
                | TypeData::Fns { .. }
                | TypeData::Synth(_)
                | TypeData::ReverseMapped { .. } => {}
                _ => (is_any_string, is_any_number) = (true, true),
            }
        }
        if !is_any_number && !enums.is_empty() {
            let named: FxHashSet<TypeId> = parts.iter().copied().collect();
            for whole in enums {
                let members = self.parts(whole);
                is_any_number |= members.len() > 1 && members.len() <= named.len() && members.iter().all(|member| named.contains(member));
            }
        }
        let mut literals = Vec::new();
        if !is_any_string {
            strings.sort_unstable_by_key(|&value| self.atoms().bytes(value));
            strings.dedup();
            literals.extend(strings.into_iter().map(Literal::String));
        }
        if !is_any_number {
            numbers.sort_unstable_by(f64::total_cmp);
            numbers.dedup_by_key(|value| value.to_bits());
            literals.extend(numbers.into_iter().map(Literal::Number));
        }
        literals
    }

    pub fn has_no_required_properties(&mut self, ty: TypeId) -> bool {
        let objects: Vec<TypeId> = self.parts(ty).iter().copied().filter(|&part| !self.has_primitive_flag(part)).collect();
        !objects.is_empty()
            && objects.into_iter().all(|part| {
                self.declares_properties(part)
                    && self.members(part).is_some_and(|members| {
                        let shape = members.shape();
                        !shape.props.is_empty() && shape.index.is_empty() && shape.call.is_empty() && shape.construct.is_empty() && shape.props.iter().all(|prop| prop.flags.contains(PropFlags::OPTIONAL))
                    })
            })
    }

    pub fn assignable_primitives(&mut self, ty: TypeId) -> Vec<TypeId> {
        let is_task_independent = self.aot.flows.stored.is_none();
        if !self.results_are_provisional() {
            let row = if is_task_independent { self.shared_type_flags(ty) } else { 0 };
            if row & type_flags::ASSIGNABLE_PRIMITIVES_KNOWN != 0 {
                return PRIMITIVES.iter().enumerate().filter(|primitive| row >> (type_flags::ASSIGNABLE_PRIMITIVES_SHIFT + primitive.0 as u32) & 1 != 0).map(|primitive| *primitive.1).collect();
            }
            if let Some(known) = self.aot.flows.type_primitives.get(&ty) {
                return known.clone();
            }
        }
        let (found, is_cacheable) = self.compute_cacheable(|c| c.compute_type_primitives(ty));
        if is_cacheable {
            let bits = PRIMITIVES.iter().enumerate().filter(|primitive| found.contains(primitive.1)).fold(type_flags::ASSIGNABLE_PRIMITIVES_KNOWN, |bits, primitive| bits | 1 << (type_flags::ASSIGNABLE_PRIMITIVES_SHIFT + primitive.0 as u32));
            if !is_task_independent || !self.publish_type_flags(ty, bits) {
                self.aot.flows.type_primitives.insert(ty, found.clone());
            }
        }
        found
    }

    fn compute_type_primitives(&mut self, ty: TypeId) -> Vec<TypeId> {
        let mut primitives = Vec::new();
        for primitive in PRIMITIVES {
            let wrapper = self.apparent_type(primitive);
            let not_known_before = self.aot.flows.unknown_count;
            if self.has_required_names_of(wrapper, ty) && (self.is_allocated_subtype(primitive, ty) || self.aot.flows.unknown_count != not_known_before) {
                primitives.push(primitive);
            }
        }
        primitives
    }

    fn has_required_names_of(&mut self, ty: TypeId, view: TypeId) -> bool {
        if let TypeData::Intersection(parts) = self.data(view) {
            return parts.iter().all(|&part| self.has_required_names_of(ty, part));
        }
        let object = self.global_ref(known::Object, &[]);
        let (Some(of_type), Some(layout_entry), any_object_type) = (self.members(ty), self.members(view), self.members(object)) else { return false };
        let shape = layout_entry.shape();
        let mut is_weak = shape.index.is_empty();
        for prop in shape.props.iter().filter(|prop| !prop.flags.contains(PropFlags::OPTIONAL)) {
            is_weak = false;
            if of_type.resolved.prop(prop.name).is_none() && !any_object_type.is_some_and(|members| members.resolved.prop(prop.name).is_some()) && !self.is_never_stored(prop.name) {
                return false;
            }
        }
        !is_weak || shape.props.iter().any(|prop| of_type.resolved.prop(prop.name).is_some())
    }

    fn add_property_names(&mut self, names: &mut Vec<Atom>, ty: TypeId) -> bool {
        let Some(members) = self.members(ty) else { return false };
        names.extend(members.shape().props.iter().map(|prop| prop.name));
        !members.shape().index.is_empty() || self.is_object_type_with_inferable_index(ty)
    }

    pub fn kinds_declared(&self) -> KindsDeclared {
        let files = self.files();
        let declaring: Vec<FileId> = (0..files.modules.len() as u32).map(FileId).filter(|&file| !(files.module(file).is_untyped() || (self.is_declaration_only(file) && !files.module(file).is_lib))).collect();
        KindsDeclared { found: declaring.chunks(KindsDeclared::FILES_PER_CHECKER).map(|_| OnceLock::new()).collect(), declaring, next: AtomicUsize::new(0), namespaces: OnceLock::new(), publish_lock: RwLock::new(()) }
    }

    fn namespaces_used_as_values(&self) -> Vec<Sym> {
        let files = self.files();
        let mut namespaces: Vec<Sym> = Vec::new();
        for file in (0..files.modules.len() as u32).map(FileId) {
            let hir = self.hir(file);
            if matches!(hir.kind, FileKind::Declaration | FileKind::Json) {
                continue;
            }
            let named = hir.specifier_uses.iter().filter(|named| named.kind.is_dynamic() || named.kind == crate::hir::SpecifierKind::Require).map(|named| named.spec);
            let whole = hir.imports.iter().filter(|import| import.namespace.is_some()).map(|import| import.spec);
            let exported = hir.ids(hir.body).filter_map(|stmt| if let crate::hir::StmtKind::ExportStar { spec, alias, .. } = hir[stmt].kind { alias.is_some().then_some(spec) } else { None });
            namespaces.extend(named.chain(whole).chain(exported).filter_map(|specifier| files.module_of_specifier(file, specifier)));
        }
        namespaces.sort_unstable();
        namespaces.dedup();
        namespaces
    }

    fn kinds_declared_in(&mut self, slice: &[FileId]) -> Vec<(Sym, Option<bool>, bool)> {
        let files = self.files();
        let c = self;
        let mut found: Vec<(Sym, Option<bool>, bool)> = Vec::new();
        for &file in slice {
            for (id, symbol) in files.module(file).bound.symbols.iter().enumerate() {
                let is_type = symbol.flags.intersects(SymFlags::CLASS | SymFlags::INTERFACE);
                if !is_type && !(symbol.flags.intersects(SymFlags::FUNCTION | SymFlags::VARIABLE) && symbol.exports.is_some()) {
                    continue;
                }
                let sym = files.sym(file, SymbolId(id as u32));
                let root = if is_type { c.root_of(sym) } else { Root::None };
                let instances = if root != Root::None && root != Root::Class(sym) {
                    Some(root == Root::Function)
                } else {
                    (root == Root::None && symbol.flags.intersects(SymFlags::CLASS) && c.extends_untyped_code(sym, 0)).then_some(false)
                };
                let is_value = files.flags(sym).intersects(SymFlags::CLASS | SymFlags::FUNCTION | SymFlags::VARIABLE) && files.each_export(sym).len() != 0 && {
                    let value = c.type_of_symbol(sym);
                    c.has_properties(value) && !(c.signatures(value, false).is_empty() && c.signatures(value, true).is_empty())
                };
                found.push((sym, instances, is_value));
            }
        }
        found
    }

    fn kinds_without_fixed_layout(&mut self, recorded: &FxHashSet<TypeId>, external_types: &[TypeId], required_names: &FxHashSet<Atom>, declared: &KindsDeclared, in_parallel: crate::util::InParallel<'_>) -> (Vec<Kind>, PropertyIndex, PropertyIndex) {
        const KINDS_PER_CHECKER: usize = 512;
        let mut kinds: Vec<(Kind, bool)> = vec![(Kind::Arrays, false), (Kind::Functions, true)];
        kinds.extend(self.engine_classes().into_iter().map(|class| (Kind::InstancesOf(class), false)));
        let mut recorded: Vec<TypeId> = recorded.iter().copied().collect();
        recorded.sort_unstable_by_key(|ty| ty.0);
        for ty in recorded {
            let is_function = matches!(self.built_in_for_type(ty), Some(BuiltIn::Function));
            kinds.push((Kind::Of(ty), is_function));
        }
        kinds.extend(external_types.iter().map(|&ty| (Kind::ExternalData(ty), false)));
        let files = self.files();
        let program = self.p;
        in_parallel(KindsDeclared::POOL_HELPERS, &|_| declared.help(program));
        for &namespace in declared.namespaces.wait() {
            if files.flags(namespace).contains(SymFlags::VALUE_MODULE) {
                kinds.push((Kind::ValueOf(namespace), false));
            }
        }
        let declared: Vec<Vec<(Sym, Option<bool>, bool)>> = (declared.declaring.chunks(KindsDeclared::FILES_PER_CHECKER).zip(&declared.found))
            .map(|(slice, found)| match found.wait() {
                Some(found) => found.clone(),
                None => self.kinds_declared_in(slice),
            })
            .collect();
        let mut seen: FxHashSet<Sym> = FxHashSet::default();
        for (sym, instances, is_value) in declared.into_iter().flatten() {
            if !seen.insert(sym) {
                continue;
            }
            kinds.extend(instances.map(|are_functions| (Kind::InstancesOf(sym), are_functions)));
            if is_value {
                kinds.push((Kind::ValueOf(sym), true));
            }
        }
        let first_declared_only = kinds.len();
        if !required_names.is_empty() {
            let mut seen_kinds: FxHashSet<Sym> = kinds.iter().filter_map(|kind| if let Kind::InstancesOf(sym) = kind.0 { Some(sym) } else { None }).collect();
            for file in (0..files.modules.len() as u32).map(FileId) {
                if files.module(file).is_untyped() || !self.is_declaration_only(file) {
                    continue;
                }
                let bound = &files.module(file).bound;
                for (id, symbol) in bound.symbols.iter().enumerate() {
                    if !symbol.flags.intersects(SymFlags::CLASS | SymFlags::INTERFACE) || !bound.table(symbol.members).iter().any(|member| required_names.contains(&member.0)) {
                        continue;
                    }
                    let sym = files.sym(file, SymbolId(id as u32));
                    let has_behavior = files.flags(sym).intersects(SymFlags::VALUE) || bound.table(symbol.members).iter().any(|member| bound.symbols[member.1.0 as usize].flags.intersects(SymFlags::METHOD | SymFlags::ACCESSOR));
                    if has_behavior && files.decls_of(sym).iter().all(|&(declared_in, _)| self.is_declaration_only(declared_in)) && seen_kinds.insert(sym) {
                        kinds.push((Kind::InstancesOf(sym), false));
                    }
                }
            }
        }
        let names = self.map_slices(&kinds, KINDS_PER_CHECKER, Some(in_parallel), &|c, slice| {
            let of_functions = [known::Function, known::CallableFunction, known::NewableFunction].map(|name| c.global_ref(name, &[]));
            let mut of_slice: Vec<(bool, Vec<Atom>, Vec<Box<[u8]>>)> = Vec::with_capacity(slice.len());
            for &(kind, is_function) in slice {
                let mut names = Vec::new();
                let ty = c.kind_type(kind);
                let mut is_indexable = c.add_property_names(&mut names, ty);
                for of_function in of_functions.into_iter().filter(|_| is_function) {
                    is_indexable |= c.add_property_names(&mut names, of_function);
                }
                let own: Vec<Box<[u8]>> = names.iter().filter(|name| name.is_own()).map(|&name| c.atoms().bytes(name).into()).collect();
                names.retain(|name| !name.is_own());
                of_slice.push((is_indexable, names, own));
            }
            of_slice
        });
        let (mut having, mut having_declared_only) = (PropertyIndex::default(), PropertyIndex::default());
        for (index, (is_indexable, names, own)) in names.into_iter().flatten().enumerate() {
            let is_declared_only = index >= first_declared_only;
            let index = index as u32;
            let having = if is_declared_only { &mut having_declared_only } else { &mut having };
            if !is_declared_only {
                having.all.push(index);
            }
            if is_indexable && !is_declared_only {
                having.indexable.push(index);
            }
            for name in names.into_iter().chain(own.iter().map(|text| self.atoms().intern(text))) {
                let indexes = having.by_name.entry(name).or_default();
                if indexes.last() != Some(&index) {
                    indexes.push(index);
                }
            }
        }
        having.build_bit_sets_of_long_lists();
        having_declared_only.build_bit_sets_of_long_lists();
        (kinds.into_iter().map(|kind| kind.0).collect(), having, having_declared_only)
    }

    fn kind_type(&mut self, kind: Kind) -> TypeId {
        let ty = match kind {
            Kind::Allocated(ty) | Kind::Assignable(ty) => return ty,
            Kind::Of(ty) | Kind::ExternalData(ty) => ty,
            Kind::Arrays => return self.array_of(TypeId::ANY),
            Kind::Functions => return self.global_ref(known::Function, &[]),
            Kind::InstancesOf(sym) => self.declared_type(sym),
            Kind::ValueOf(sym) => self.type_of_symbol(sym),
        };
        self.permissive_instantiation(ty)
    }

    fn is_allocated_subtype(&mut self, created: TypeId, view: TypeId) -> bool {
        self.is_allocated_subtype_by(created, view, true)
    }

    fn is_allocated_subtype_by(&mut self, created: TypeId, view: TypeId, goes_by_fields: bool) -> bool {
        let relation = if self.aot.flows.stored.is_some() { Relation::AssignableAsStored } else { Relation::Assignable };
        if self.is_provably_related(created, view, relation) {
            return true;
        }
        if goes_by_fields && self.aot.flows.stored.is_some() && self.declares_properties(created) && self.declares_properties(view) && self.has_same_fields(created, view, false) {
            return true;
        }
        if goes_by_fields
            && self.aot.flows.stored.is_some()
            && self.declares_properties(created)
            && self.declares_properties(view)
            && !self.is_provably_related(view, created, relation)
            && self.is_assignable_ignoring_optionality(created, view, relation)
        {
            return true;
        }
        let is_created_generic = self.has_type_variables(created);
        if !is_created_generic && !self.has_type_variables(view) {
            return false;
        }
        if is_created_generic && !self.is_instance_type(created) && !self.discriminants_agree(created, view, relation, !goes_by_fields) {
            return false;
        }
        let (created, view) = (self.permissive_instantiation(created), self.permissive_instantiation(view));
        self.is_provably_related(created, view, relation)
    }

    fn may_be_subtype_at_runtime(&mut self, candidate: TypeId, view: TypeId) -> bool {
        self.declares_properties(candidate) && self.declares_properties(view) && self.is_provably_related(candidate, view, Relation::Comparable)
    }

    fn is_narrowed_from(&mut self, view: TypeId, created: TypeId) -> bool {
        if !matches!(self.data(view), TypeData::Intersection(_)) || !self.declares_properties(created) || !self.declares_properties(view) {
            return false;
        }
        let relation = if self.aot.flows.stored.is_some() { Relation::AssignableAsStored } else { Relation::Assignable };
        let (Some(of_created), Some(layout_entry)) = (self.members(created), self.members(view)) else { return false };
        let is_plain = |shape: &Shape| shape.call.is_empty() && shape.construct.is_empty() && shape.index.is_empty();
        if !is_plain(of_created.shape()) || !is_plain(layout_entry.shape()) || of_created.shape().props.len() != layout_entry.shape().props.len() {
            return false;
        }
        const KIND: PropFlags = PropFlags::METHOD.union(PropFlags::ACCESSOR);
        for view_prop in layout_entry.shape().props.iter() {
            let Some(created_prop) = of_created.resolved.prop(view_prop.name) else { return false };
            if created_prop.flags & KIND != view_prop.flags & KIND {
                return false;
            }
            let (created_type, view_type) = (self.type_of_prop(created_prop, of_created.mapper), self.type_of_prop(view_prop, layout_entry.mapper));
            if created_type != view_type && !self.is_provably_related(created_type, view_type, relation) && !self.is_provably_related(view_type, created_type, relation) {
                return false;
            }
        }
        true
    }

    fn is_assignable_ignoring_optionality(&mut self, created: TypeId, view: TypeId, relation: Relation) -> bool {
        let (Some(of_created), Some(layout_entry)) = (self.members(created), self.members(view)) else { return false };
        let is_plain = |shape: &Shape| shape.call.is_empty() && shape.construct.is_empty() && shape.index.is_empty();
        if !is_plain(of_created.shape()) || !is_plain(layout_entry.shape()) {
            return false;
        }
        let mut is_one_optional = false;
        for view_prop in layout_entry.shape().props.iter() {
            if self.is_never_stored(view_prop.name) {
                continue;
            }
            let is_required = !view_prop.flags.contains(PropFlags::OPTIONAL);
            let Some(created_prop) = of_created.resolved.prop(view_prop.name) else {
                if is_required {
                    return false;
                }
                continue;
            };
            let (mut created_type, view_type) = (self.type_of_prop(created_prop, of_created.mapper), self.type_of_prop(view_prop, layout_entry.mapper));
            if is_required && created_prop.flags.contains(PropFlags::OPTIONAL) {
                created_type = self.non_nullable(created_type);
                is_one_optional = true;
            }
            if created_type != view_type && !self.is_provably_related(created_type, view_type, relation) {
                return false;
            }
        }
        is_one_optional
    }

    fn discriminants_agree(&mut self, created: TypeId, view: TypeId, relation: Relation, by_bounds: bool) -> bool {
        let (Some(of_created), Some(layout_entry)) = (self.members(created), self.members(view)) else { return true };
        let are_primitives = |c: &Self, ty: TypeId| c.parts(ty).iter().all(|&part| c.has_primitive_flag(part));
        for view_prop in layout_entry.shape().props.iter() {
            let view_type = self.type_of_prop(view_prop, layout_entry.mapper);
            let names_constants = !self.type_literals(view_type).is_empty();
            if !names_constants && !(by_bounds && are_primitives(self, view_type)) {
                continue;
            }
            let Some(created_prop) = of_created.resolved.prop(view_prop.name) else { continue };
            let created_type = self.type_of_prop(created_prop, of_created.mapper);
            if !names_constants && !self.base_constraint_of(created_type).is_some_and(|bound| are_primitives(self, bound)) {
                continue;
            }
            if !self.is_provably_related(created_type, view_type, relation) {
                return false;
            }
        }
        true
    }

    pub(super) fn guard_proven_type(&mut self, file: FileId, e: ExprId, stored: TypeId, own: TypeId) -> Option<TypeId> {
        let guard = self.guard_narrowing(file, e)?;
        let retained = self.filter(stored, |c, part| c.parts(own).contains(&part) || (c.declares_properties(part) && c.has_required_names_of(part, guard)));
        Some(retained)
    }

    fn guard_narrowing(&mut self, file: FileId, e: ExprId) -> Option<TypeId> {
        const MAX_STEPS: usize = 32;
        let (hir, bound) = (self.hir(file), self.bound(file));
        let named = bound.expr_symbol[e.idx()];
        if named.is_none() {
            return None;
        }
        let mut at = bound.expr_flow[e.idx()];
        for _ in 0..MAX_STEPS {
            let (before, tested) = match bound.flow[at.idx()] {
                Flow::Cond { before, expr, sense: true } => (before, expr),
                Flow::Cond { before, .. } | Flow::Switch { before, .. } => (before, ExprId::NONE),
                Flow::Call { before, call } => (before, call),
                _ => return None,
            };
            at = before;
            let Some(tested) = tested.some() else { continue };
            let ExprKind::Call(call) = hir[tested].kind else { continue };
            let Some(sig) = self.resolved_signature(file, tested).sig else { continue };
            let Some(predicate) = self.sig_predicate(sig) else { continue };
            let (Some(index), Some(guard)) = (predicate.param, predicate.ty) else { continue };
            let Some(argument) = hir.ids(hir[call].args).nth(index) else { continue };
            if matches!(hir[argument].kind, ExprKind::Ident(_)) && bound.expr_symbol[argument.idx()] == named {
                return Some(guard);
            }
        }
        None
    }

    fn restrict_to_stored_names(&mut self, stored: &FxHashSet<Atom>) {
        let bits = self.p.aot.storage.stored_names.get_or_init(|| {
            let mut bits: Vec<u64> = Vec::new();
            for name in stored.iter().filter(|name| name.is_some() && !name.is_own()) {
                let at = name.0 as usize;
                if bits.len() <= at / 64 {
                    bits.resize(at / 64 + 1, 0);
                }
                bits[at / 64] |= 1 << (at % 64);
            }
            std::sync::Arc::new(bits)
        });
        self.aot.flows.stored = Some(Arc::clone(bits));
    }

    pub(in crate::check) fn is_created_by_program(&self, ty: TypeId) -> bool {
        match *self.data(ty) {
            TypeData::Ref { target, .. } => !self.is_declaration_only(target.file),
            TypeData::Tuple { .. } => false,
            _ => true,
        }
    }

    pub fn is_declared_only_record(&self, ty: TypeId) -> bool {
        match self.data(ty) {
            TypeData::Ref { target, .. } => self.is_declaration_only(target.file),
            TypeData::Anon { origin: Origin::TypeLiteral(file, literal), .. } => self.is_declaration_only(*file) && !self.is_safe_validate_result(*file, *literal),
            TypeData::Anon { origin: Origin::GlobalThis, .. } => true,
            TypeData::Intersection(parts) => parts.iter().any(|&part| self.is_declared_only_record(part)),
            TypeData::Synth(shape) if shape.spread_rank >= u32::MAX - 1 => shape.created_from.is_some_and(|(_, viewed)| self.parts(viewed).iter().any(|&part| self.is_declared_only_record(part))),
            _ => false,
        }
    }

    pub(in crate::check) fn without_readonly(&mut self, ty: TypeId) -> TypeId {
        match *self.data(ty) {
            TypeData::Tuple { readonly: true, ref flags, .. } => {
                let (elements, flags) = (self.type_arguments(ty).to_vec(), flags.to_vec());
                self.tuple(&elements, &flags, false)
            }
            TypeData::Ref { .. } if self.is_reference_to_global(ty, known::ReadonlyArray, 1) => match self.array_element(ty) {
                Some(element) => self.array_of(element),
                None => ty,
            },
            _ => ty,
        }
    }

    pub(in crate::check) fn is_never_stored(&self, name: Atom) -> bool {
        let Some(stored) = &self.aot.flows.stored else { return false };
        if name.is_none() || name.is_own() {
            return false;
        }
        let at = name.0 as usize;
        let is_stored = stored.get(at / 64).is_some_and(|word| word >> (at % 64) & 1 != 0);
        !is_stored && !self.atoms().bytes(name).starts_with(&[0xFE])
    }

    fn add_candidates(&mut self, having: &PropertyIndex, view: TypeId, out: &mut Vec<u32>) {
        let Some(members) = self.members(view) else { return };
        let shape = members.shape();
        let object = self.global_ref(known::Object, &[]);
        let any_object_type = self.members(object);
        let mut is_weak = shape.index.is_empty();
        let mut required: Vec<&[u32]> = Vec::new();
        let mut required_names: Vec<Atom> = Vec::new();
        for prop in shape.props.iter().filter(|prop| !prop.flags.contains(PropFlags::OPTIONAL)) {
            is_weak = false;
            if any_object_type.is_some_and(|members| members.resolved.prop(prop.name).is_some()) || self.is_never_stored(prop.name) {
                continue;
            }
            let Some(indexes) = having.by_name.get(&prop.name) else { return };
            required.push(indexes);
            required_names.push(prop.name);
        }
        let Some(&rarest) = required.iter().min_by_key(|indexes| indexes.len()) else {
            let accepts_any = shape.index.iter().any(|info| info.key == TypeId::STRING && self.instantiate(info.value, members.mapper).is_any());
            if is_weak {
                out.extend(shape.props.iter().filter_map(|prop| having.by_name.get(&prop.name)).flatten());
            } else if shape.index.is_empty() || accepts_any || self.has_type_variables(view) {
                out.extend_from_slice(&having.all);
            } else {
                out.extend_from_slice(&having.indexable);
            }
            return;
        };
        if rarest.len() >= having.bit_set_words
            && let Some(bit_sets) = required_names.iter().map(|name| having.bit_sets_of_long_lists.get(name)).collect::<Option<Vec<&Vec<u64>>>>()
        {
            for at in 0..having.bit_set_words {
                let mut word = bit_sets.iter().fold(u64::MAX, |word, bits| word & bits[at]);
                while word != 0 {
                    out.push(at as u32 * 64 + word.trailing_zeros());
                    word &= word - 1;
                }
            }
            return;
        }
        out.extend(rarest.iter().filter(|candidate| required.iter().all(|indexes| indexes.binary_search(candidate).is_ok())));
    }

    fn types_reachable_from_plain_data(&mut self, roots: impl Iterator<Item = (TypeId, Place)>, index_of: &FxHashMap<TypeId, u32>, external_forms: &mut Vec<TypeId>) -> FxHashMap<TypeId, Place> {
        let mut roots: Vec<(TypeId, Place)> = roots.collect();
        roots.sort_unstable_by_key(|root| root.1);
        let mut seen: FxHashSet<TypeId> = FxHashSet::default();
        let mut held: FxHashMap<TypeId, Place> = FxHashMap::default();
        for (root, at) in roots {
            let mut pending = vec![root];
            while let Some(ty) = pending.pop() {
                if !index_of.contains_key(&ty) {
                    if self.is_nested_too_deeply(ty) {
                        external_forms.extend(self.generic_form(ty));
                    }
                    continue;
                }
                if held.contains_key(&ty) {
                    continue;
                }
                held.insert(ty, at);
                if self.is_instance_type(ty) {
                    continue;
                }
                let Some(members) = self.members(ty) else { continue };
                for prop in members.shape().props.iter() {
                    let of_field = self.type_of_prop(prop, members.mapper);
                    self.add_object_types_in(of_field, true, &mut seen, &mut pending);
                }
            }
        }
        held
    }

    pub fn begin_subtypes(&mut self, recorded: FlowNotes, views: &[TypeId], fields: FieldTypes, stored: FxHashSet<Atom>, kinds_declared: &KindsDeclared, says_progress: Option<fn(std::fmt::Arguments<'_>)>, in_parallel: crate::util::InParallel<'_>) -> Subtypes {
        const LAYOUTS_PER_CHECKER: usize = 512;
        const TYPES_PER_WALK: usize = 128;
        let recorded = recorded.into_tables();
        let mut clock = subtypes::Clock::new(says_progress);
        clock.log_progress(format_args!(
            "gathering: {} views, {} types of fields with {} views in them, {} unions; noted: {} sites, {} upcasts, {} casts, {} tests, {} vouched for, {} untyped into, {} copied into, {} not laid out",
            views.len(),
            fields.layouts_in_type.len(),
            fields.layouts_in_type.iter().map(Vec::len).sum::<usize>(),
            fields.together.len(),
            recorded.allocated_at_site.len(),
            recorded.upcasts.len(),
            recorded.casts.len(),
            recorded.tests.len(),
            recorded.trusted_into.len(),
            recorded.untyped_into.len(),
            recorded.copied_into.len(),
            recorded.foreign.len()
        ));
        let mut truncated: Vec<(Place, [u32; 4])> = recorded.truncated.iter().map(|(&at, &times)| (at, times)).collect();
        truncated.sort_unstable();
        let sums = truncated.iter().fold([0u32; 4], |sums, cut| [sums[0] + cut.1[0], sums[1] + cut.1[1], sums[2] + cut.1[2], sums[3] + cut.1[3]]);
        let first = truncated.first().map_or_else(String::new, |cut| format!("; the first at {}", self.display_location(cut.0)));
        clock.log_progress(format_args!(
            "what is held within what enters: the walk was cut short at {} places: {} times for what nests in itself, {} for too many of two declarations, {} for the stack, {} for too many levels{first}; the most of two declarations in one body: {} looked into, {} of them for what nests in itself; the deepest: {} levels",
            truncated.len(),
            sums[0],
            sums[1],
            sums[2],
            sums[3],
            recorded.max_inspected[0],
            recorded.max_inspected[1],
            recorded.max_inspected[2]
        ));
        self.restrict_to_stored_names(&stored);
        let mut index_of: FxHashMap<TypeId, u32> = FxHashMap::default();
        for (index, &view) in views.iter().enumerate() {
            index_of.entry(view).or_insert(index as u32);
        }
        let mut external_forms: Vec<TypeId> = Vec::new();
        let copied_into = self.types_reachable_from_plain_data(recorded.copied_into.iter().map(|&ty| (ty, Place::NOWHERE)), &index_of, &mut Vec::new());
        let untyped_into = self.types_reachable_from_plain_data(recorded.untyped_into.iter().map(|(&ty, &at)| (ty, at)), &index_of, &mut external_forms);
        let mut recorded = recorded;
        let mut stored_through: FxHashSet<TypeId> = recorded.read_only_passed_on.iter().copied().collect();
        loop {
            let before = stored_through.len();
            stored_through.extend(recorded.stored_read_only.iter().filter(|held| stored_through.contains(&held.1)).map(|held| held.0).collect::<Vec<TypeId>>());
            if stored_through.len() == before {
                break;
            }
        }
        let mut opened: Vec<(TypeId, TypeId)> = recorded.stored_read_only.iter().copied().filter(|held| stored_through.contains(&held.1) && index_of.contains_key(&held.0)).collect();
        opened.sort_unstable_by_key(|held| (held.0.0, held.1.0));
        for (held, dictionary) in opened {
            recorded.add_untyped(held, Some(dictionary), Place::NOWHERE);
        }
        let (mut seen_beyond, mut staying) = (FxHashSet::default(), Vec::new());
        for form in external_forms {
            self.add_types_staying_untyped(form, true, &mut seen_beyond, &mut staying);
        }
        for view in staying {
            recorded.add_untyped(view, None, Place::NOWHERE);
        }
        clock.log_progress(format_args!("what is held within: {} copied into, {} untyped into", copied_into.len(), untyped_into.len()));

        let types: Vec<TypeId> = views.to_vec();
        let mut redefined: Vec<TypeId> = recorded.escapes.with_mutations(|recorded| recorded.closed(Mutation::Redefinition)).types;
        redefined.sort_unstable_by_key(|ty| ty.0);
        redefined.dedup();
        for &view in &redefined {
            recorded.add_untyped(view, None, Place::NOWHERE);
        }
        let is_of_literal = |c: &Self, ty: TypeId| match c.data(ty) {
            TypeData::Anon { origin: Origin::ObjectLiteral(..) | Origin::WidenedLiteral(..), .. } => true,
            TypeData::Synth(_) => !c.is_coercion_result_type(ty),
            _ => false,
        };
        let edges: Vec<(TypeId, TypeId)> = recorded.upcasts.keys().chain(&recorded.casts).copied().filter(|&(from, to)| from != to && is_of_literal(self, from) && !self.is_uninformative(to)).collect();
        let mut allocated_by_identity: FxHashMap<Identity, Vec<TypeId>> = FxHashMap::default();
        let mut sites: Vec<TypeId> = recorded.allocated_at_site.iter().copied().filter(|&site| is_of_literal(self, site)).collect();
        sites.sort_unstable_by_key(|ty| ty.0);
        for site in sites {
            allocated_by_identity.entry(self.type_identity(site)).or_default().push(site);
        }
        let mut seen_as_annotated: FxHashSet<TypeId> = edges.iter().filter(|edge| !is_of_literal(self, edge.1)).map(|edge| edge.0).collect();
        let (mut forms_of_literals, mut walked, mut let_out_unwritten): (Vec<[TypeId; 3]>, FxHashSet<TypeId>, FxHashSet<TypeId>) = Default::default();
        let mut to_walk: Vec<TypeId> = recorded.escapes.with_mutations(|recorded| recorded.escaped());
        loop {
            let is_own = |ty: &TypeId| crate::local::is_local_number(ty.0);
            let (own, published): (Vec<TypeId>, Vec<TypeId>) = std::mem::take(&mut to_walk).into_iter().filter(|&ty| walked.insert(ty)).partition(is_own);
            let walk = |c: &mut Checker<'p, 's>, ty: TypeId| {
                let mut forms = Vec::new();
                c.add_nested_object_literal_types(ty, &mut forms);
                let identities: Vec<Identity> = forms.iter().map(|form| c.type_identity(form[1])).collect();
                (forms, identities)
            };
            let of_slices = self.map_slices(&published, TYPES_PER_WALK, Some(in_parallel), &|c, slice| -> Vec<Option<(Vec<[TypeId; 3]>, Vec<Identity>)>> {
                slice.iter().map(|&ty| Some(walk(c, ty)).filter(|(forms, _)| !forms.iter().flatten().any(is_own))).collect()
            });
            let mut identities: Vec<Identity> = Vec::new();
            let known = forms_of_literals.len();
            for (ty, walked_elsewhere) in published.into_iter().zip(of_slices.into_iter().flatten()).chain(own.into_iter().map(|ty| (ty, None))) {
                let (mut forms, mut of_forms) = walked_elsewhere.unwrap_or_else(|| walk(self, ty));
                forms_of_literals.append(&mut forms);
                identities.append(&mut of_forms);
            }
            for (index, identity) in (known..forms_of_literals.len()).zip(identities) {
                let layout_types_cache = forms_of_literals[index][1];
                for &site in allocated_by_identity.get(&identity).into_iter().flatten() {
                    forms_of_literals.push([layout_types_cache, site, site]);
                    to_walk.push(site);
                }
            }
            loop {
                let before = seen_as_annotated.len();
                let below: Vec<TypeId> = edges.iter().filter(|edge| seen_as_annotated.contains(&edge.1)).map(|edge| edge.0).collect();
                seen_as_annotated.extend(below);
                if seen_as_annotated.len() == before {
                    break;
                }
            }
            let_out_unwritten.extend(forms_of_literals.iter().flatten().copied());
            let allocated_as: Vec<TypeId> = edges.iter().filter(|edge| let_out_unwritten.contains(&edge.1) && !seen_as_annotated.contains(&edge.1) && !let_out_unwritten.contains(&edge.0)).map(|edge| edge.0).collect();
            to_walk.extend(allocated_as.iter().copied());
            let_out_unwritten.extend(allocated_as);
            to_walk.retain(|ty| !walked.contains(ty));
            if to_walk.is_empty() {
                break;
            }
        }
        let mut unannotated: Vec<TypeId> = let_out_unwritten.into_iter().filter(|form| !seen_as_annotated.contains(form)).collect();
        unannotated.sort_unstable_by_key(|ty| ty.0);
        for &view in &unannotated {
            recorded.add_untyped(view, None, Place::NOWHERE);
        }
        let altered = Mutation::ALL.map(|mutation| recorded.escapes.with_mutations(|recorded| recorded.closed(mutation)));
        let mutated_types: [Vec<TypeId>; 2] = [0, 1].map(|mutation: usize| {
            let mut handed_over: Vec<TypeId> = altered[mutation].types.clone();
            handed_over.sort_unstable_by_key(|ty| ty.0);
            let (mut found, mut seen): (Vec<TypeId>, FxHashSet<TypeId>) = Default::default();
            for ty in handed_over {
                self.add_object_types_in(ty, false, &mut seen, &mut found);
            }
            found
        });

        let object = self.global_ref(known::Object, &[]);
        let mut any_object_type: Vec<u32> = self.members(object).map_or_else(Vec::new, |members| members.shape().props.iter().map(|prop| prop.name.0).collect());
        any_object_type.sort_unstable();
        let numbered: Vec<(usize, TypeId)> = types.iter().copied().enumerate().collect();
        let gather = |c: &mut Checker<'p, 's>, slice: &[(usize, TypeId)]| {
            c.restrict_to_stored_names(&stored);
            let (mut facts, mut declared): (Vec<Facts>, Vec<(u32, u32)>) = Default::default();
            let (mut passed, mut found): (FxHashSet<TypeId>, Vec<u32>) = Default::default();
            for &(index, ty) in slice {
                let mut of_type = c.facts_of(ty, &any_object_type);
                c.add_undeclared_fields_to(&mut of_type, ty, &stored);
                if recorded.allocated_at_site.contains(&ty) {
                    of_type.flags |= subtypes::HAS_SITE;
                }
                if copied_into.contains_key(&ty) && of_type.flags & subtypes::IS_INSTANCE == 0 {
                    of_type.flags |= subtypes::IS_COPIED;
                }
                facts.push(of_type);
                passed.clear();
                found.clear();
                c.add_declared_supertypes(ty, &index_of, &mut passed, &mut found);
                found.sort_unstable();
                found.dedup();
                declared.extend(found.iter().filter(|&&supertype| supertype as usize != index).map(|&supertype| (index as u32, supertype)));
            }
            (facts, declared)
        };
        let has_own_atoms = |facts: &Facts| {
            let is_own = |name: u32| Atom(name).is_own();
            [&facts.declared, &facts.live, &facts.required, &facts.open].into_iter().any(|names| names.iter().any(|&name| is_own(name)))
                || facts.constants.iter().any(|&(name, constant)| is_own(name) || constant >> 32 == 0x7FF8_0001 && is_own(constant as u32))
        };
        let of_slices = self.map_slices(&numbered, LAYOUTS_PER_CHECKER, Some(in_parallel), &|c, slice| Some(gather(c, slice)).filter(|gathered| !gathered.0.iter().any(has_own_atoms)));
        let mut facts: Vec<Facts> = Vec::with_capacity(types.len());
        let mut declared: Vec<(u32, u32)> = Vec::new();
        for (slice, gathered) in numbered.chunks(LAYOUTS_PER_CHECKER).zip(of_slices) {
            let (of_facts, of_declared) = gathered.unwrap_or_else(|| gather(self, slice));
            facts.extend(of_facts);
            declared.extend(of_declared);
        }
        let has_own_names: Vec<bool> = facts.iter().map(has_own_atoms).collect();
        clock.log_progress(format_args!("the facts: {} types, {} declared supertypes", types.len(), declared.len()));
        let asked_as: Vec<TypeId> = types.iter().map(|&ty| self.coercion_target(ty)).collect();
        clock.log_progress(format_args!("the pairs that the relation is queried for"));

        let mut first_trusted: FxHashMap<u32, Place> = FxHashMap::default();
        for (ty, &at) in recorded.trusted_into.iter().chain(&untyped_into).chain(&copied_into) {
            if let Some(&index) = index_of.get(ty) {
                let first = first_trusted.entry(index).or_insert(at);
                *first = at.min(*first);
            }
        }
        for ty in fields.fields_by_layout.iter().flatten().map(|field| field.1).chain(fields.static_field_types.iter().copied()) {
            for &view in &fields.layouts_in_type[ty as usize] {
                first_trusted.entry(view).or_insert(Place::NOWHERE);
            }
        }
        let mut vouched: Vec<(u32, Place)> = first_trusted.into_iter().collect();
        vouched.sort_unstable();

        let mut foreign: Vec<(u32, Option<TypeId>, UntypedReason)> = Vec::new();
        let mut kind_queries: Vec<(SubtypeQuery, u32, UntypedReason)> = Vec::new();
        let is_external_data = |c: &mut Checker<'p, 's>, ty: TypeId| c.is_tainted(ty) || !matches!(c.data(ty), TypeData::Intersection(_) | TypeData::Anon { origin: Origin::Module(..), .. });
        let (own, published): (Vec<TypeId>, Vec<TypeId>) = recorded.without_fixed_layout.iter().copied().partition(|ty| crate::local::is_local_number(ty.0));
        let of_slices = self.map_slices(&published, LAYOUTS_PER_CHECKER, Some(in_parallel), &|c, slice| -> Vec<TypeId> { slice.iter().copied().filter(|&ty| is_external_data(c, ty)).collect() });
        let mut external_types: Vec<TypeId> = of_slices.into_iter().flatten().collect();
        external_types.extend(own.into_iter().filter(|&ty| is_external_data(self, ty)));
        for ty in &external_types {
            recorded.without_fixed_layout.remove(ty);
        }
        external_types.extend(redefined.iter().copied());
        external_types.sort_unstable_by_key(|ty| ty.0);
        external_types.dedup();
        let required_names: FxHashSet<Atom> = (types.iter().zip(&facts)).filter(|(ty, _)| untyped_into.contains_key(*ty) && !recorded.foreign.contains_key(*ty)).flat_map(|(_, facts)| facts.required.iter().map(|&name| Atom(name))).collect();
        let (others, having, having_declared_only) = self.kinds_without_fixed_layout(&recorded.without_fixed_layout, &external_types, &required_names, kinds_declared, in_parallel);
        clock.log_progress(format_args!("{} vouched for, {} kinds that are not laid out", vouched.len(), others.len()));
        let is_namespace_kind = |c: &Self, kind: Kind| match kind {
            Kind::Of(ty) => matches!(c.data(ty), TypeData::Anon { origin: Origin::Module(..), .. }),
            Kind::ValueOf(sym) => c.files().flags(sym).contains(SymFlags::VALUE_MODULE),
            _ => false,
        };
        let is_namespace: Vec<bool> = others.iter().map(|&kind| is_namespace_kind(self, kind)).collect();
        let has_namespaces = is_namespace.contains(&true);
        let mut unowned_members = PropertyIndex::default();
        for (index, names) in std::mem::take(&mut self.aot.flows.unretained_external_data).into_iter().enumerate() {
            unowned_members.all.push(index as u32);
            unowned_members.indexable.push(index as u32);
            for name in names {
                unowned_members.by_name.entry(name).or_default().push(index as u32);
            }
        }
        unowned_members.build_bit_sets_of_long_lists();
        let (escaped, entered, receiving_untyped_if_escaped) = recorded.untyped_object_evidence();
        let opened = self.classes_accepting_untyped(&escaped, &entered, &receiving_untyped_if_escaped);
        let numbered: Vec<(usize, TypeId)> = views.iter().copied().enumerate().collect();
        let stored_by_js = self.p.aot.storage.records_reaching_javascript.lock().clone();
        let ask = |c: &mut Checker<'p, 's>, slice: &[(usize, TypeId)]| {
            c.restrict_to_stored_names(&stored);
            let mut foreign: Vec<(u32, Option<TypeId>, UntypedReason)> = Vec::new();
            let mut kind_queries: Vec<(SubtypeQuery, u32, UntypedReason)> = Vec::new();
            let (mut candidates, mut of_nobody): (Vec<u32>, Vec<u32>) = Default::default();
            for &(index, view) in slice {
                let seen_at = recorded.foreign.get(&view).map(|seen| seen.1);
                if let Some(&(source, at)) = recorded.foreign.get(&view) {
                    let passing = source.filter(|_| !c.is_coercion_result_type(view));
                    foreign.push((index as u32, passing, UntypedReason::Seen { source, at }));
                } else if let Some(&at) = stored_by_js.get(&c.type_identity(view)) {
                    foreign.push((index as u32, None, UntypedReason::ReachesJavaScript { at }));
                } else if c.is_declared_only_record(view) {
                    foreign.push((index as u32, None, UntypedReason::DeclaredOnly));
                    continue;
                } else if c.is_instance_type(view) && c.extends_one_of(view, &opened) {
                    foreign.push((index as u32, None, UntypedReason::Instance));
                    continue;
                }
                let untyped_at = untyped_into.get(&view).copied().filter(|_| seen_at.is_none());
                let trusted_at = vouched.binary_search_by_key(&(index as u32), |target| target.0).ok().map(|found| vouched[found].1);
                let flows_in = seen_at.or(untyped_at).or(trusted_at);
                let Some(at) = flows_in.or_else(|| has_namespaces.then_some(Place::NOWHERE)) else { continue };
                candidates.clear();
                c.add_candidates(&having, view, &mut candidates);
                if untyped_at.is_some() && !facts[index].required.is_empty() {
                    c.add_candidates(&having_declared_only, view, &mut candidates);
                }
                candidates.sort_unstable();
                candidates.dedup();
                let is_external_data = |candidate: &u32| matches!(others[*candidate as usize], Kind::ExternalData(_));
                let is_allocated_by_coercion = c.is_coercion_result_type(view) || flows_in.is_none();
                if !is_allocated_by_coercion {
                    of_nobody.clear();
                    c.add_candidates(&unowned_members, view, &mut of_nobody);
                    if !of_nobody.is_empty() {
                        foreign.push((index as u32, None, UntypedReason::UnretainedExternalData { at }));
                        continue;
                    }
                }
                let external_types: Vec<u32> = candidates.iter().copied().filter(|candidate| !is_allocated_by_coercion && is_external_data(candidate)).collect();
                if external_types.len() > MAX_EXTERNAL_KINDS_QUERIED {
                    foreign.push((index as u32, None, UntypedReason::ExternalData { at, candidate: Candidate(others[external_types[0] as usize]) }));
                    continue;
                }
                kind_queries.extend(external_types.iter().map(|&candidate| {
                    let kind = others[candidate as usize];
                    (SubtypeQuery { kind, view }, index as u32, UntypedReason::ExternalData { at, candidate: Candidate(kind) })
                }));
                kind_queries.extend(candidates.iter().filter(|candidate| (is_namespace[**candidate as usize] || untyped_at.is_some()) && !is_external_data(candidate)).map(|&candidate| {
                    let kind = others[candidate as usize];
                    (SubtypeQuery { kind, view }, index as u32, UntypedReason::Untyped { at, candidate: Candidate(kind) })
                }));
            }
            (foreign, kind_queries)
        };
        let of_slices = self.map_slices(&numbered, LAYOUTS_PER_CHECKER, Some(in_parallel), &|c, slice| (!slice.iter().any(|view| has_own_names[view.0])).then(|| ask(c, slice)));
        for (slice, asked) in numbered.chunks(LAYOUTS_PER_CHECKER).zip(of_slices) {
            let (of_foreign, of_kinds) = asked.unwrap_or_else(|| ask(self, slice));
            foreign.extend(of_foreign);
            kind_queries.extend(of_kinds);
        }

        let mut upcasts: Vec<(u32, u32, Place)> = recorded.upcasts.iter().filter_map(|(&(from, to), &at)| Some((*index_of.get(&from)?, *index_of.get(&to)?, at))).collect();
        upcasts.sort_unstable();
        let mut casts: Vec<(u32, u32)> = recorded.casts.iter().filter_map(|(from, to)| Some((*index_of.get(from)?, *index_of.get(to)?))).collect();
        casts.sort_unstable();
        let mut guards: Vec<(u32, u32)> = recorded.guards.iter().filter_map(|(from, to)| Some((*index_of.get(from)?, *index_of.get(to)?))).collect();
        guards.sort_unstable();
        let mut forced: Vec<(u32, u32)> = recorded.forced.iter().filter_map(|(from, to)| Some((*index_of.get(from)?, *index_of.get(to)?))).collect();
        forced.sort_unstable();
        let mut unverified_overload_results: Vec<(u32, u32)> = recorded.unverified_overload_results.iter().filter_map(|(from, to)| Some((*index_of.get(from)?, *index_of.get(to)?))).collect();
        unverified_overload_results.sort_unstable();
        let mut tests: Vec<(u32, u32)> = recorded.tests.iter().filter_map(|(from, to)| Some((*index_of.get(from)?, *index_of.get(to)?))).collect();
        tests.sort_unstable();
        let altered: [MutatedTypes; 2] = [0, 1].map(|mutation: usize| {
            let besides: FxHashSet<TypeId> = mutated_types[mutation].iter().copied().filter(|ty| !index_of.contains_key(ty)).collect();
            let extra_targets = recorded.upcasts.keys().chain(&recorded.casts).chain(&recorded.tests).filter(|edge| besides.contains(&edge.1)).filter_map(|edge| index_of.get(&edge.0).copied());
            let mut views: Vec<u32> = mutated_types[mutation].iter().filter_map(|ty| index_of.get(ty).copied()).chain(extra_targets).collect();
            views.sort_unstable();
            views.dedup();
            let mut besides: Vec<TypeId> = besides.into_iter().collect();
            besides.sort_unstable_by_key(|ty| ty.0);
            let besides: Vec<Facts> = besides.into_iter().map(|ty| self.facts_of(ty, &any_object_type)).collect();
            MutatedTypes { views, besides, is_untyped: altered[mutation].is_untyped, is_any_layout: altered[mutation].is_any_layout }
        });
        let mut untyped_inflow_sites: Vec<(u32, Place)> = recorded.untyped_into.iter().filter_map(|(ty, &at)| Some((*index_of.get(ty)?, at))).collect();
        let mut checked: Vec<(u32, Place)> = recorded.checked_into.iter().filter_map(|(ty, &at)| Some((*index_of.get(ty)?, at))).collect();
        checked.sort_unstable();
        untyped_inflow_sites.sort_unstable();
        let mut untyped_inflow_pairs: Vec<(u32, u32)> = (recorded.untyped_into_both.iter()).filter_map(|(arm, other)| Some((*index_of.get(arm)?, *index_of.get(other)?))).flat_map(|(arm, other)| [(arm, other), (other, arm)]).collect();
        untyped_inflow_pairs.sort_unstable();
        untyped_inflow_pairs.dedup();
        let mut any_inflow_sites: Vec<(u32, Place)> = recorded.any_into.iter().filter_map(|(ty, &at)| Some((*index_of.get(ty)?, at))).collect();
        any_inflow_sites.sort_unstable();
        let by_layout_index = |callees: &FxHashMap<(TypeId, Atom), Callee>| -> Vec<(u32, Atom, Callee)> { callees.iter().filter_map(|(&(holder, name), &callee)| Some((*index_of.get(&holder)?, name, callee))).collect() };
        let (callees_at_creation, callees_stored) = (by_layout_index(&recorded.callees_at_creation), by_layout_index(&recorded.callees_stored));
        let creations = recorded.creations.by_layout_index(&index_of);
        let constructions = recorded.constructions.by_layout_index(&index_of);
        clock.log_progress(format_args!("the edges: {} questions about kinds", kind_queries.len()));
        let gathered = Gathered {
            types,
            asked_as,
            facts,
            declared,
            upcasts,
            casts,
            guards,
            forced,
            unverified_overload_results,
            tests,
            vouched,
            untyped_inflow_sites,
            untyped_inflow_pairs,
            any_inflow_sites,
            checked,
            checked_by_path: recorded.checked_by_path,
            logs_type_errors: self.logs_type_errors(),
            logging_relaxation: LoggingRelaxation::Nothing,
            accepting_when_strict: Vec::new(),
            subtypes_when_strict: Vec::new(),
            conversions_when_strict: Vec::new(),
            kind_queries_retry: Vec::new(),
            foreign,
            kind_queries,
            altered,
            fields,
            stored,
            callees_at_creation,
            callees_stored,
            escapes: recorded.escapes,
            creations,
            constructions,
        };
        Subtypes::new(gathered, clock)
    }

    fn type_kind_label(&self, ty: TypeId) -> &'static str {
        match self.data(ty) {
            TypeData::Ref { .. } => "a reference",
            TypeData::Intersection(_) => "an intersection",
            TypeData::Synth(_) => "synthesized",
            TypeData::ReverseMapped { .. } => "reverse mapped",
            TypeData::Anon { origin: Origin::TypeLiteral(..), .. } => "a type literal",
            TypeData::Anon { origin: Origin::Mapped(..), .. } => "mapped",
            TypeData::Anon { origin: Origin::ObjectLiteral(..) | Origin::WidenedLiteral(..), .. } => "an object literal",
            TypeData::Anon { .. } => "of a declaration",
            _ => "another",
        }
    }

    fn facts_of(&mut self, ty: TypeId, any_object_type: &[u32]) -> Facts {
        let mut flags = 0;
        for (is_so, flag) in [(self.is_coercion_result_type(ty), subtypes::IS_COERCION_RESULT), (self.is_instance_type(ty), subtypes::IS_INSTANCE), (self.has_type_variables(ty), subtypes::IS_GENERIC)] {
            if is_so {
                flags |= flag;
            }
        }
        let kind = self.type_kind_label(ty);
        let Some(members) = self.members(ty) else { return Facts { flags, kind, ..Facts::default() } };
        let shape = members.shape();
        let (mut declared, mut live, mut required, mut open): (Vec<u32>, Vec<u32>, Vec<u32>, Vec<u32>) = Default::default();
        let mut hidden: Vec<u32> = shape.props.iter().filter(|prop| prop.flags.intersects(PropFlags::PRIVATE | PropFlags::PROTECTED)).map(|prop| prop.name.0).collect();
        let mut constants: Vec<(u32, u64)> = Vec::new();
        let (mut requires_a_property, mut is_flat, mut is_flat_but_for_functions) = (false, true, true);
        for prop in shape.props.iter() {
            let name = prop.name.0;
            let is_live = !self.is_never_stored(prop.name);
            declared.push(name);
            if is_live {
                live.push(name);
            }
            if !prop.flags.contains(PropFlags::OPTIONAL) {
                requires_a_property = true;
                if is_live && any_object_type.binary_search(&name).is_err() {
                    required.push(name);
                }
            }
            let of_prop = self.type_of_prop(prop, members.mapper);
            is_flat &= self.parts(of_prop).iter().all(|&part| self.has_primitive_flag(part));
            is_flat_but_for_functions &= self.parts(of_prop).iter().all(|&part| self.has_primitive_flag(part) || matches!(self.built_in_for_type(part), Some(BuiltIn::Function)));
            if of_prop.is_any() || of_prop.is_never() || self.has_type_variables(of_prop) {
                open.push(name);
                continue;
            }
            let is_nullish_or_constant = |c: &Self, part: TypeId| {
                matches!(
                    c.data(part),
                    TypeData::StringLit { .. }
                        | TypeData::NumberLit { .. }
                        | TypeData::EnumLit { .. }
                        | TypeData::Intrinsic(Intrinsic::Undefined | Intrinsic::Missing | Intrinsic::UndefinedWidening | Intrinsic::Null | Intrinsic::NullWidening)
                )
            };
            if !self.parts(of_prop).iter().all(|&part| is_nullish_or_constant(self, part)) {
                continue;
            }
            let named = self.type_literals(of_prop);
            if prop.flags.contains(PropFlags::OPTIONAL) || self.parts(of_prop).iter().any(|&part| matches!(self.data(part), TypeData::Intrinsic(_))) {
                constants.push((name, 0x7FF8_0002_0000_0000));
            }
            if !named.is_empty() {
                flags |= subtypes::HAS_CONSTANTS | if named.len() == 1 { subtypes::IS_CONCRETE } else { 0 };
            }
            constants.extend(named.into_iter().map(|constant| match constant {
                Literal::String(text) => (name, 0x7FF8_0001_0000_0000 | u64::from(text.0)),
                Literal::Number(number) => (name, number.to_bits()),
            }));
        }
        if flags & subtypes::IS_INSTANCE == 0 && self.contains_only_plain_data(ty, &mut FxHashSet::default()) {
            flags |= subtypes::IS_PLAIN_DATA | subtypes::IS_PLAIN_DATA_OR_FUNCTIONS | if live.len() > 6 { subtypes::MAY_LACK_CAPACITY } else { 0 };
        } else if flags & subtypes::IS_INSTANCE == 0 && self.is_plain_data_type(ty, true, &mut FxHashSet::default()) {
            flags |= subtypes::IS_PLAIN_DATA_OR_FUNCTIONS;
        }
        if !shape.index.is_empty() {
            flags |= subtypes::HAS_INDEX_SIGNATURE;
        } else if !requires_a_property {
            flags |= subtypes::IS_WEAK;
        }
        if is_flat_but_for_functions && shape.index.is_empty() && shape.call.is_empty() && shape.construct.is_empty() && flags & subtypes::IS_INSTANCE == 0 {
            flags |= subtypes::IS_FLAT_BUT_FOR_FUNCTIONS;
            if is_flat {
                flags |= subtypes::IS_FLAT;
            }
        }
        for names in [&mut declared, &mut live, &mut required, &mut open, &mut hidden] {
            names.sort_unstable();
        }
        constants.sort_unstable();
        constants.dedup();
        Facts { flags, declared: declared.into(), live: live.into(), required: required.into(), constants: constants.into(), open: open.into(), hidden: hidden.into(), kind, ..Facts::default() }
    }

    fn add_declared_supertypes(&mut self, ty: TypeId, index_of: &FxHashMap<TypeId, u32>, passed: &mut FxHashSet<TypeId>, out: &mut Vec<u32>) {
        let supertypes: Vec<TypeId> = match *self.data(ty) {
            TypeData::Ref { target, .. } if self.is_created_by_program(ty) => match self.members(ty) {
                Some(members) => self.base_types(target).into_vec().into_iter().map(|base| self.instantiate(base, members.mapper)).collect(),
                None => Vec::new(),
            },
            TypeData::Intersection(ref parts) => parts.to_vec(),
            _ => Vec::new(),
        };
        for supertype in supertypes {
            if !self.declares_properties(supertype) || !passed.insert(supertype) {
                continue;
            }
            let layout_types_cache = self.layout_defining_type(supertype);
            match index_of.get(&layout_types_cache) {
                Some(&index) => out.push(index),
                None => self.add_declared_supertypes(supertype, index_of, passed, out),
            }
        }
    }

    pub fn answer(&mut self, queries: &[SubtypeQuery], stored: &FxHashSet<Atom>) -> Vec<SubtypeAnswer> {
        self.restrict_to_stored_names(stored);
        let mut admitting = None;
        let mut answers = Vec::with_capacity(queries.len());
        for query in queries {
            let not_known_before = self.aot.flows.unknown_count;
            let is_so = match query.kind {
                Kind::Allocated(created) => self.is_allocated_subtype(created, query.view),
                Kind::Assignable(created) => self.is_allocated_subtype_by(created, query.view, false) || self.is_narrowed_from(query.view, created),
                _ if admitting == Some(query.view) => false,
                Kind::ExternalData(_) => {
                    let external_type = self.kind_type(query.kind);
                    let is_accepted = self.is_allocated_subtype_by(external_type, query.view, false) || self.may_be_subtype_at_runtime(external_type, query.view);
                    if is_accepted {
                        admitting = Some(query.view);
                    }
                    is_accepted
                }
                kind => {
                    let other = self.kind_type(kind);
                    let is_accepted = self.is_allocated_subtype(other, query.view);
                    if is_accepted {
                        admitting = Some(query.view);
                    }
                    is_accepted
                }
            };
            answers.push(if self.aot.flows.unknown_count != not_known_before {
                SubtypeAnswer::NotKnown
            } else if is_so {
                SubtypeAnswer::Yes
            } else {
                SubtypeAnswer::No
            });
        }
        answers
    }

    pub fn explain_untyped(&mut self, views: &[TypeId], membership: &Membership, is_left_out: &[bool]) -> Vec<String> {
        let mut lines = Vec::new();
        for (index, &view) in views.iter().enumerate() {
            let mut why = membership.untyped_reasons[index];
            if why.is_none() || is_left_out[index] {
                continue;
            }
            let mut line = format!("foreign: {}: ", self.display_name(view));
            for _ in 0..32 {
                let Some(reason) = why.take() else { break };
                match reason {
                    UntypedReason::Seen { source, at } => {
                        let source = source.map_or_else(|| "a type that was not retained".to_owned(), |source| self.display_name(source));
                        line += &format!("seen: {source} at {}", self.display_location(at));
                    }
                    UntypedReason::Untyped { at, candidate } => {
                        let candidate = self.kind_type(candidate.0);
                        line += &format!("untyped: something untyped is held to it at {}, and {} is of the type", self.display_location(at), self.display_name(candidate));
                    }
                    UntypedReason::ExternalData { at, candidate } => {
                        let candidate = self.kind_type(candidate.0);
                        let (rule, said_of_it) = if self.is_tainted(candidate) { ("given", "which the program is given") } else { ("not laid out", "objects of which are not laid out") };
                        line += &format!("{rule}: a value that only its type vouches for is held to it or to what holds it at {}, and {}, {said_of_it}, is assignable to it or to what holds it", self.display_location(at), self.display_name(candidate));
                    }
                    UntypedReason::UnretainedExternalData { at } => line += &format!("given: a value that only its type vouches for is held to it or to what holds it at {}, and a type that the program is given and that no task could keep, such as untyped code makes, has its names", self.display_location(at)),
                    UntypedReason::DeclaredOnly => line += "declared in a declaration file",
                    UntypedReason::ReachesJavaScript { at } => line += &format!("JavaScript of the program gets hold of its objects at {}: one that is altered there is an ordinary object from then on", self.display_location(at)),
                    UntypedReason::ForLogging { at } => line += &format!("for the log: something untyped is held to it at {}, and few views open with it", self.display_location(at)),
                    UntypedReason::Instance => line += "a class: the text shows that an object its constructor has not made can come to be: an object of it or a method of it is handed to what is not typed code, or to a built-in that lets it out",
                    UntypedReason::Flat { at } => line += &format!("flat: all its properties are primitives, and something untyped is held to it at {}", self.display_location(at)),
                    UntypedReason::Dictionary { at } => line += &format!("dictionary: it has an index signature, and something untyped is held to it at {}", self.display_location(at)),
                    UntypedReason::AnotherLayout { at } => line += &format!("another layout: a value of type any or unknown is assigned to it or to a type that contains it at {}: the value may be an object that is already laid out as another record type, or one that cannot become this one, which stays as it is and is read by name", self.display_location(at)),
                    UntypedReason::MayLackCapacity { at } => line += &format!("room: it has more than six fields, or is a member of or in a union with a type that does, and an untyped value is assigned to it or to a type that contains it at {}: a matching object may be too small to convert in place", self.display_location(at)),
                    UntypedReason::UnconvertibleLayout { from } => line += &format!("{} reaches it below a cast or through an untyped value, and can neither be converted to it in place nor pass as it", self.type_display_name(views, from)),
                    UntypedReason::TooMany { at } => line += &format!("too many layouts may fit it to ask about each, and a value that only its type vouches for is held to it at {}", self.display_location(at)),
                    UntypedReason::NeverAllocated { at } => line += &format!("nothing is made as it and no layout fits it, and a value that only its type vouches for is held to it at {}", self.display_location(at)),
                    UntypedReason::Weak { at } => line += &format!("weak: it requires no live field, and a value that only its type vouches for is held to it at {}", self.display_location(at)),
                    UntypedReason::Inherited { from, at } => {
                        let source_type = self.type_display_name(views, from);
                        line += &format!("inherited from {source_type} over an upcast noted at {}; which is ", self.display_location(at));
                        why = membership.untyped_reasons.get(from as usize).copied().flatten();
                    }
                    UntypedReason::PassedCast { from } => {
                        line += &format!("what is in a place of {} passes a cast to it; which is ", self.type_display_name(views, from));
                        why = membership.untyped_reasons.get(from as usize).copied().flatten();
                    }
                }
            }
            lines.push(line);
        }
        lines
    }

    fn type_display_name(&mut self, views: &[TypeId], view: u32) -> String {
        views.get(view as usize).map_or_else(|| "types without a layout".to_owned(), |&view| self.display_name(view))
    }

    pub(super) fn display_name(&mut self, ty: TypeId) -> String {
        const MOST: usize = 72;
        let text = self.type_to_string(ty);
        let text = bstr::BStr::new(&text).to_string();
        if text.chars().count() <= MOST { text } else { text.chars().take(MOST).chain(" ..".chars()).collect() }
    }

    pub(super) fn display_location(&self, at: Place) -> String {
        if at == Place::NOWHERE {
            return "no place in the source".to_owned();
        }
        let name = self.files().module(at.file).file_name();
        let name = name.rsplit(|&byte| byte == b'/').next().unwrap_or(name);
        let text = &self.hir(at.file).text;
        let line = bun_core::strings::count_char(&text[..(at.pos as usize).min(text.len())], b'\n') + 1;
        format!("{}:{line}", bstr::BStr::new(name))
    }
}

