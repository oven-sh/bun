use super::program_keys::KeyContext;
use crate::builtins::id::BuiltinId;
use crate::ir::generated::{
    Data, DeclaredRecord, EvalScope, ExpectedResult, Function, ModuleInstance, ModuleLink,
    RuntimeFunctionEntry, Variable,
};
use crate::ir::{
    DataId, EvalScopeId, ExpectedResultId, FunctionId, InParallel, LayoutId, PackScratch,
    PackedFunction, PackedLayout, PropertyKeyId, VariableId, parallel::map_each,
};
use crate::load::ProgramFile;
use crate::lower::{
    CheckerTypeId, FamilyFacts, Fragment, ModuleFragment, NameOfHeir, ObjectTypeKey, SaidTypes,
    SharedTables, TableLengths,
};
use bun_sema::check::aot::TypeIdentity;
use bun_sema::erasure::PackedTypeRanges;
use std::sync::Arc;

const FUNCTIONS_PACKED_AT_A_TIME: usize = 1 << 11;

#[derive(Clone)]
pub(super) struct UnitRecords {
    pub eval_scopes: Vec<(EvalScopeId, EvalScope)>,
    pub data: Vec<(DataId, Data)>,
    pub expected_results: Vec<(ExpectedResultId, ExpectedResult)>,
    pub declared_records: Vec<DeclaredRecord>,
    pub module_instances: Vec<ModuleInstance>,
    pub module_links: Vec<ModuleLink>,
}

#[derive(Clone)]
pub struct LinkUnit {
    pub(super) file: ProgramFile,
    pub(super) is_checked: bool,
    pub(super) shared: Arc<SharedTables>,
    pub(super) lengths: TableLengths,
    pub(super) tables: u32,
    pub(super) function_definitions: Vec<(FunctionId, PackedFunction)>,
    pub(super) layout_definitions: Vec<(LayoutId, PackedLayout)>,
    pub(super) object_types: Vec<(u32, ObjectTypeKey)>,
    said_types: Vec<CheckerTypeId>,
    said_keys: Vec<(TypeIdentity, ObjectTypeKey)>,
    pub(super) layouts_named_by_code: Vec<LayoutId>,
    pub(super) allocated_layouts: Vec<LayoutId>,
    pub(super) names_of_heirs: Vec<NameOfHeir>,
    pub(super) written_keys: Vec<PropertyKeyId>,
    pub(super) read_keys: Vec<PropertyKeyId>,
    pub(super) keys_laid_by_descriptors: Vec<PropertyKeyId>,
    pub(super) variable_definitions: Vec<(VariableId, Variable)>,
    pub(super) records: UnitRecords,
    pub(super) supertype_edges: Vec<(LayoutId, LayoutId)>,
    pub(super) function_type_edges: Vec<(FunctionId, FunctionId)>,
    pub(super) builtin_members: Vec<(FunctionId, BuiltinId)>,
    pub(super) family_facts: FamilyFacts,
    pub(super) runtime_functions: Vec<RuntimeFunctionEntry>,
    pub(super) module: ModuleFragment,
}

/// The allocator leaves a block that is at least half used as long as it is.
fn trimmed<T: Copy>(list: Vec<T>) -> Vec<T> {
    match list.capacity() - list.len() > list.len() / 8 {
        true => list[..].to_vec(),
        false => list,
    }
}

fn trim<T: Copy>(list: &mut Vec<T>) {
    *list = trimmed(core::mem::take(list));
}

const fn assert_send<T: Send>() {}

const _: () = assert_send::<LinkUnit>();

fn pack_functions(
    mut functions: Vec<(FunctionId, Arc<Function>)>,
    scratch: &mut PackScratch,
    in_parallel: InParallel<'_>,
) -> Vec<(FunctionId, PackedFunction)> {
    let pack = |functions: Vec<(FunctionId, Arc<Function>)>, scratch: &mut PackScratch| {
        let mut packed = Vec::with_capacity(functions.len());
        for (id, function) in functions {
            packed.push((id, PackedFunction::new(function, scratch)));
        }
        packed
    };
    if functions.len() <= FUNCTIONS_PACKED_AT_A_TIME {
        return pack(functions, scratch);
    }
    let mut packed = Vec::with_capacity(functions.len());
    let mut runs = Vec::with_capacity(functions.len() / FUNCTIONS_PACKED_AT_A_TIME + 1);
    while functions.len() > FUNCTIONS_PACKED_AT_A_TIME {
        runs.push(functions.split_off(functions.len() - FUNCTIONS_PACKED_AT_A_TIME));
    }
    runs.push(functions);
    runs.reverse();
    let pack_run = |run| pack(run, &mut PackScratch::default());
    for run in map_each(runs, in_parallel, &pack_run) {
        packed.extend(run);
    }
    packed
}

impl LinkUnit {
    pub fn take_erased_type_ranges(&mut self) -> Option<(ProgramFile, PackedTypeRanges)> {
        let types = self.module.erased_type_ranges.take()?;
        Some((self.file, types))
    }

    pub fn note_commit(&self, said_types: &SaidTypes) {
        self.shared.note_commit(self.lengths);
        let (file, is_checked) = (self.file.file, self.is_checked);
        said_types.note_commit(file, is_checked, &self.said_types, &self.said_keys);
    }

    pub fn new(
        context: &KeyContext<'_>,
        fragment: Fragment,
        in_parallel: InParallel<'_>,
    ) -> LinkUnit {
        debug_assert!(fragment.layouts_named_by_code.is_sorted());
        let mut scratch = PackScratch::default();
        let function_definitions = pack_functions(fragment.functions, &mut scratch, in_parallel);
        // Collected, they would lie in the block of the unpacked ones.
        let mut layout_definitions = Vec::with_capacity(fragment.layouts.len());
        for (id, layout) in fragment.layouts {
            layout_definitions.push((id, PackedLayout::new(&layout, &mut scratch)));
        }
        let mut module = fragment.module;
        let positions = &mut module.positions;
        trim(&mut positions.line_starts);
        trim(&mut positions.column_adjustments);
        trim(&mut positions.quoted_sources);
        trim(&mut positions.quoted_source_text);
        LinkUnit {
            file: ProgramFile {
                project: context.project,
                file: fragment.file,
            },
            is_checked: fragment.is_checked,
            shared: fragment.tables,
            lengths: fragment.lengths,
            tables: u32::MAX,
            function_definitions,
            layout_definitions,
            object_types: trimmed(fragment.object_types),
            said_types: trimmed(fragment.said_types),
            said_keys: trimmed(fragment.said_keys),
            layouts_named_by_code: trimmed(fragment.layouts_named_by_code),
            allocated_layouts: trimmed(fragment.allocated_layouts),
            names_of_heirs: trimmed(fragment.names_of_heirs),
            written_keys: trimmed(fragment.written_keys),
            read_keys: trimmed(fragment.read_keys),
            keys_laid_by_descriptors: trimmed(fragment.keys_laid_by_descriptors),
            variable_definitions: trimmed(fragment.variables),
            records: UnitRecords {
                eval_scopes: fragment.eval_scopes,
                data: fragment.data,
                expected_results: fragment.expected_results,
                declared_records: fragment.declared_records,
                module_instances: fragment.module_instances,
                module_links: fragment.module_links,
            },
            supertype_edges: trimmed(fragment.supertype_edges),
            function_type_edges: trimmed(fragment.function_type_edges),
            builtin_members: fragment.builtin_members,
            family_facts: fragment.family_facts,
            runtime_functions: fragment.runtime_functions,
            module,
        }
    }
}
