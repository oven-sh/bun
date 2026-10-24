#[cfg(test)]
mod tests;

use super::program_keys::{
    KeyContext, ProgramFunctionKey, ProgramLayoutKey, ProgramModule, ProgramVariableKey,
};
use super::type_hashes::{TypeHashes, hash_types};
use crate::builtins::id::BuiltinId;
use crate::ir::generated::{
    Data, EvalScope, ExpectedResult, Function, Layout, ModuleReferenceKind, RuntimeFunctionEntry,
    TypeSite, Variable,
};
use crate::ir::{
    FunctionId, Id, InParallel, LayoutId, PropertyKeyId, PropertyKeyTable, Reference, StringTable,
    TypeTable, VariableId, for_each_mut,
};
use crate::load::ProgramFile;
use crate::lower::{DefinedObjectType, FamilyFacts, Fragment, ModuleFragment, ObjectTypeKey};
use crate::modules::ModuleFailureId;
use core::hash::{BuildHasher, Hash};
use rustc_hash::FxBuildHasher;
use std::sync::Arc;

pub(super) const SHARD_COUNT: usize = 64;

const _: () = assert!(SHARD_COUNT.is_power_of_two());

pub(super) fn shard_of(hash: u64) -> usize {
    (hash >> 32) as usize & (SHARD_COUNT - 1)
}

pub(super) fn hash_key<K: Hash>(key: &K) -> u64 {
    FxBuildHasher.hash_one(key)
}

pub(super) struct ShardIndex {
    ids: Vec<u32>,
    starts: [u32; SHARD_COUNT + 1],
}

impl ShardIndex {
    pub(super) fn new(hashes: impl ExactSizeIterator<Item = u64> + Clone) -> ShardIndex {
        assert!(
            hashes.len() <= u32::MAX as usize,
            "a shard index holds 32-bit ids"
        );
        let mut starts = [0u32; SHARD_COUNT + 1];
        for hash in hashes.clone() {
            starts[shard_of(hash) + 1] += 1;
        }
        for shard in 0..SHARD_COUNT {
            starts[shard + 1] += starts[shard];
        }
        let mut cursors = starts;
        let mut ids = vec![0u32; hashes.len()];
        for (id, hash) in hashes.enumerate() {
            let cursor = &mut cursors[shard_of(hash)];
            ids[*cursor as usize] = id as u32;
            *cursor += 1;
        }
        ShardIndex { ids, starts }
    }

    pub(super) fn shard(&self, shard: usize) -> &[u32] {
        &self.ids[self.starts[shard] as usize..self.starts[shard + 1] as usize]
    }
}

/// What the shards have found first in each unit, the finds of one unit in a row and the units in order.
pub(super) struct FindsByUnit<I> {
    /// Each with its unit. Within a row they stand in no order that means anything.
    pub finds: Vec<(u32, I)>,
    /// By shard, then by the shard's own order: where the find stands in `finds`.
    pub places: Vec<Vec<u32>>,
}

impl<I: Id + Sync> FindsByUnit<I> {
    pub(super) fn new(unit_count: usize, shards: &[&[(u32, I)]]) -> FindsByUnit<I> {
        let mut cursors = vec![0u32; unit_count + 1];
        for &(unit, _) in shards.iter().copied().flatten() {
            cursors[unit as usize + 1] += 1;
        }
        for unit in 0..unit_count {
            cursors[unit + 1] += cursors[unit];
        }
        let mut finds = vec![(0, I::default()); cursors[unit_count] as usize];
        let mut place = |&find: &(u32, I)| {
            let cursor = &mut cursors[find.0 as usize];
            finds[*cursor as usize] = find;
            *cursor += 1;
            *cursor - 1
        };
        let places = shards
            .iter()
            .map(|shard| shard.iter().map(&mut place).collect())
            .collect();
        FindsByUnit { finds, places }
    }

    /// The places of `finds`, those of each unit ordered by `key`, which tells the finds of a unit apart.
    pub(super) fn order_rows_by<K: Ord>(
        &self,
        in_parallel: InParallel<'_>,
        key: &(dyn Fn(u32, I) -> K + Sync),
    ) -> Vec<u32> {
        let unit_at = |place: u32| self.finds[place as usize].0;
        let mut order: Vec<u32> = (0..self.finds.len() as u32).collect();
        let mut rows: Vec<&mut [u32]> = order
            .chunk_by_mut(|&a, &b| unit_at(a) == unit_at(b))
            .collect();
        for_each_mut(&mut rows, in_parallel, &|row| {
            row.sort_unstable_by_key(|&place| {
                let (unit, find) = self.finds[place as usize];
                key(unit, find)
            });
        });
        order
    }

    /// By place in `finds`: the number of the find where `order` is the order of all.
    pub(super) fn number_in(&self, order: &[u32]) -> Vec<I> {
        let mut numbers = vec![I::default(); order.len()];
        for (number, &place) in order.iter().enumerate() {
            numbers[place as usize] = I::new(number);
        }
        numbers
    }
}

pub(super) struct KeyList<K> {
    pub keys: Vec<K>,
    pub hashes: Vec<u64>,
    pub shards: ShardIndex,
}

impl<K: Hash> KeyList<K> {
    pub(super) fn new(keys: Vec<K>) -> KeyList<K> {
        let hashes: Vec<u64> = keys.iter().map(hash_key).collect();
        let shards = ShardIndex::new(hashes.iter().copied());
        KeyList {
            keys,
            hashes,
            shards,
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
#[repr(u8)]
pub(super) enum LocalKind {
    String,
    PropertyKey,
    Type,
    TypeSite,
    ExpectedResult,
    Layout,
    Variable,
    ModuleTarget,
    ModuleReferrer,
    ModuleFailure,
    EvalScope,
    Function,
    Data,
}

impl LocalKind {
    pub(super) const COUNT: usize = 13;
    pub(super) const ALL: [LocalKind; LocalKind::COUNT] = [
        LocalKind::String,
        LocalKind::PropertyKey,
        LocalKind::Type,
        LocalKind::TypeSite,
        LocalKind::ExpectedResult,
        LocalKind::Layout,
        LocalKind::Variable,
        LocalKind::ModuleTarget,
        LocalKind::ModuleReferrer,
        LocalKind::ModuleFailure,
        LocalKind::EvalScope,
        LocalKind::Function,
        LocalKind::Data,
    ];
}

const _: () = {
    let mut index = 0;
    while index < LocalKind::COUNT {
        assert!(LocalKind::ALL[index] as usize == index);
        index += 1;
    }
};

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) struct LocalReference {
    pub kind: LocalKind,
    pub index: u32,
}

impl LocalReference {
    pub(super) fn new(reference: Reference) -> Option<LocalReference> {
        let (kind, index) = match reference {
            Reference::String(id) => (LocalKind::String, id.index()),
            Reference::PropertyKey(id) => (LocalKind::PropertyKey, id.index()),
            Reference::Type(id) => (LocalKind::Type, id.index()),
            Reference::TypeSite(id) => (LocalKind::TypeSite, id.index()),
            Reference::ExpectedResult(id) => (LocalKind::ExpectedResult, id.index()),
            Reference::Layout(id) => (LocalKind::Layout, id.index()),
            Reference::Variable(id) => (LocalKind::Variable, id.index()),
            Reference::Module(id, ModuleReferenceKind::Target) => {
                (LocalKind::ModuleTarget, id.index())
            }
            Reference::Module(id, ModuleReferenceKind::Referrer) => {
                (LocalKind::ModuleReferrer, id.index())
            }
            Reference::ModuleFailure(id) => (LocalKind::ModuleFailure, id.index()),
            Reference::EvalScope(id) => (LocalKind::EvalScope, id.index()),
            Reference::Function(id, _) => (LocalKind::Function, id.index()),
            Reference::Data(id) => (LocalKind::Data, id.index()),
            Reference::Builtin(_) => return None,
        };
        Some(LocalReference {
            kind,
            index: index as u32,
        })
    }
}

type ReferenceScratch = [Vec<u32>; LocalKind::COUNT];

#[derive(Default)]
pub(super) struct ReferenceLists {
    ids: Vec<u32>,
    ends: Vec<[u32; LocalKind::COUNT]>,
    // By definition: its row of `ends`.
    rows: Vec<u32>,
}

impl ReferenceLists {
    pub(super) fn of(&self, definition: usize, kind: LocalKind) -> &[u32] {
        let ends = self.ends.as_flattened();
        let list = self.rows[definition] as usize * LocalKind::COUNT + kind as usize;
        let start = list.checked_sub(1).map_or(0, |previous| ends[previous]);
        &self.ids[start as usize..ends[list] as usize]
    }

    fn new(definitions: &[(FunctionId, Arc<Function>)]) -> ReferenceLists {
        let mut lists = ReferenceLists::default();
        lists.rows.reserve_exact(definitions.len());
        let mut scratch = ReferenceScratch::default();
        let mut previous: Option<&Arc<Function>> = None;
        for (_, function) in definitions {
            if !previous.is_some_and(|previous| Arc::ptr_eq(previous, function)) {
                lists.add_row(function, &mut scratch);
            }
            lists.rows.push(lists.ends.len() as u32 - 1);
            previous = Some(function);
        }
        ReferenceLists {
            ids: lists.ids.as_slice().into(),
            ends: lists.ends.as_slice().into(),
            rows: lists.rows,
        }
    }

    fn add_row(&mut self, function: &Function, scratch: &mut ReferenceScratch) {
        for list in scratch.iter_mut() {
            list.clear();
        }
        function.for_each_reference(&mut |reference| {
            if let Some(local) = LocalReference::new(reference) {
                scratch[local.kind as usize].push(local.index);
            }
        });
        let mut ends = [0u32; LocalKind::COUNT];
        for (list, end) in scratch.iter_mut().zip(&mut ends) {
            list.sort_unstable();
            list.dedup();
            self.ids.extend_from_slice(list);
            *end = self.ids.len() as u32;
        }
        assert!(
            self.ids.len() <= u32::MAX as usize,
            "the reference lists of a unit have 32-bit offsets"
        );
        self.ends.push(ends);
    }
}

pub(super) struct UnitRecords {
    pub type_sites: Vec<TypeSite>,
    pub expected_results: Vec<ExpectedResult>,
    pub eval_scopes: Vec<EvalScope>,
    pub data: Vec<Data>,
}

pub struct LinkUnit {
    pub(super) file: ProgramFile,
    pub(super) is_checked: bool,
    pub(super) strings: StringTable,
    pub(super) string_shards: ShardIndex,
    pub(super) property_keys: PropertyKeyTable,
    pub(super) types: TypeTable,
    pub(super) type_hashes: TypeHashes,
    pub(super) type_shards: ShardIndex,
    pub(super) functions: KeyList<ProgramFunctionKey>,
    pub(super) layouts: KeyList<ProgramLayoutKey>,
    pub(super) code_layout_count: usize,
    pub(super) variables: KeyList<ProgramVariableKey>,
    pub(super) modules: Vec<ProgramModule>,
    pub(super) module_failures: Vec<ModuleFailureId>,
    pub(super) function_definitions: Vec<(FunctionId, Arc<Function>)>,
    pub(super) function_references: ReferenceLists,
    pub(super) layout_definitions: Vec<(LayoutId, Layout)>,
    pub(super) object_types: Vec<(u32, ObjectTypeKey)>,
    object_type_levels: Vec<u8>,
    pub(super) allocated_layouts: Vec<LayoutId>,
    pub(super) written_keys: Vec<PropertyKeyId>,
    pub(super) variable_definitions: Vec<(VariableId, Variable)>,
    pub(super) records: UnitRecords,
    pub(super) supertype_edges: Vec<(LayoutId, LayoutId)>,
    pub(super) function_type_edges: Vec<(FunctionId, FunctionId)>,
    pub(super) builtin_members: Vec<(FunctionId, BuiltinId)>,
    pub(super) family_facts: FamilyFacts,
    pub(super) runtime_functions: Vec<RuntimeFunctionEntry>,
    pub(super) module: ModuleFragment,
}

const fn assert_send<T: Send>() {}

const _: () = assert_send::<LinkUnit>();

impl LinkUnit {
    pub(super) fn release_hashes_of_strings_and_types(&mut self) {
        self.string_shards.ids = Vec::new();
        self.type_hashes.types = Vec::new();
        self.type_hashes.nesting_depths = Vec::new();
        self.type_shards.ids = Vec::new();
    }

    pub fn defined_object_types(&self) -> impl Iterator<Item = (DefinedObjectType, u8)> {
        let types = self.object_types.iter().zip(&self.object_type_levels);
        types.filter_map(|(&(definition, ty), &level)| {
            let layout = self.layout_definitions[definition as usize].0;
            let key = self.layouts.keys[layout.index()].key;
            Some((DefinedObjectType::new(key, ty)?, level))
        })
    }

    pub fn new(context: &KeyContext<'_>, fragment: Fragment) -> LinkUnit {
        let strings = fragment.strings;
        let string_shards = ShardIndex::new(strings.ids().map(|id| strings.hash(id)));
        let layout_keys = fragment.layout_keys.into_iter();
        let layouts = KeyList::new(layout_keys.map(|key| context.layout_key(key)).collect());
        let function_keys = fragment.function_keys.into_iter();
        let functions = KeyList::new(function_keys.map(|key| context.function_key(key)).collect());
        let type_hashes = hash_types(&fragment.types, &strings, &layouts.keys, &functions.keys);
        let type_shards = ShardIndex::new(type_hashes.types.iter().map(|hash| hash.0[0]));
        let variable_keys = fragment.variable_keys.into_iter();
        let module_keys = fragment.module_keys.into_iter();
        let function_references = ReferenceLists::new(&fragment.functions);
        let module_failures = fragment.module_failure_keys.into_iter();
        LinkUnit {
            file: ProgramFile {
                project: context.project,
                file: context.file(fragment.file),
            },
            is_checked: fragment.is_checked,
            strings,
            string_shards,
            property_keys: fragment.property_keys,
            types: fragment.types,
            type_hashes,
            type_shards,
            functions,
            layouts,
            code_layout_count: fragment.code_layout_count,
            variables: KeyList::new(variable_keys.map(|key| context.variable_key(key)).collect()),
            modules: module_keys.map(|module| context.module(module)).collect(),
            module_failures: module_failures
                .map(|id| context.module_failure(id))
                .collect(),
            function_definitions: fragment.functions,
            function_references,
            layout_definitions: fragment.layouts,
            object_types: fragment.object_types,
            object_type_levels: fragment.object_type_levels,
            allocated_layouts: fragment.allocated_layouts,
            written_keys: fragment.written_keys,
            variable_definitions: fragment.variables,
            records: UnitRecords {
                type_sites: fragment.type_sites,
                expected_results: fragment.expected_results,
                eval_scopes: fragment.eval_scopes,
                data: fragment.data,
            },
            supertype_edges: fragment.supertype_edges,
            function_type_edges: fragment.function_type_edges,
            builtin_members: fragment.builtin_members,
            family_facts: fragment.family_facts,
            runtime_functions: fragment.runtime_functions,
            module: fragment.module,
        }
    }
}
