use super::program_keys::KeyContext;
use crate::builtins::id::BuiltinId;
use crate::ir::generated::{
    Data, DeclaredRecord, EvalScope, ExpectedResult, Function, Layout, RuntimeFunctionEntry,
    Variable,
};
use crate::ir::{
    DataId, EvalScopeId, ExpectedResultId, FunctionId, LayoutId, PropertyKeyId, VariableId,
};
use crate::load::ProgramFile;
use crate::lower::{
    CheckerTypeId, FamilyFacts, Fragment, ModuleFragment, ObjectTypeKey, SaidTypes, SharedTables,
    TableLengths,
};
use bun_sema::erasure::PackedTypeRanges;
use std::sync::Arc;

#[derive(Clone)]
pub(super) struct UnitRecords {
    pub eval_scopes: Vec<(EvalScopeId, EvalScope)>,
    pub data: Vec<(DataId, Data)>,
    pub expected_results: Vec<(ExpectedResultId, ExpectedResult)>,
    pub declared_records: Vec<DeclaredRecord>,
}

#[derive(Clone)]
pub struct LinkUnit {
    pub(super) file: ProgramFile,
    pub(super) is_checked: bool,
    pub(super) shared: Arc<SharedTables>,
    pub(super) lengths: TableLengths,
    pub(super) tables: u32,
    pub(super) function_definitions: Vec<(FunctionId, Arc<Function>)>,
    pub(super) layout_definitions: Vec<(LayoutId, Layout)>,
    pub(super) object_types: Vec<(u32, ObjectTypeKey)>,
    said_types: Vec<CheckerTypeId>,
    pub(super) layouts_named_by_code: Vec<LayoutId>,
    pub(super) allocated_layouts: Vec<LayoutId>,
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

const fn assert_send<T: Send>() {}

const _: () = assert_send::<LinkUnit>();

impl LinkUnit {
    pub fn take_erased_type_ranges(&mut self) -> Option<(ProgramFile, PackedTypeRanges)> {
        let types = self.module.erased_type_ranges.take()?;
        Some((self.file, types))
    }

    pub fn note_commit(&self, said_types: &SaidTypes) {
        self.shared.note_commit(self.lengths);
        said_types.note_commit(self.file.file, self.is_checked, &self.said_types);
    }

    pub fn new(context: &KeyContext<'_>, mut fragment: Fragment) -> LinkUnit {
        debug_assert!(fragment.layouts_named_by_code.is_sorted());
        let mut scratch = Vec::new();
        for (_, function) in &mut fragment.functions {
            if let Some(function) = Arc::get_mut(function) {
                function.body.pack(&mut scratch);
            }
        }
        LinkUnit {
            file: ProgramFile {
                project: context.project,
                file: fragment.file,
            },
            is_checked: fragment.is_checked,
            shared: fragment.tables,
            lengths: fragment.lengths,
            tables: u32::MAX,
            function_definitions: fragment.functions,
            layout_definitions: fragment.layouts,
            object_types: fragment.object_types,
            said_types: fragment.said_types,
            layouts_named_by_code: fragment.layouts_named_by_code,
            allocated_layouts: fragment.allocated_layouts,
            written_keys: fragment.written_keys,
            read_keys: fragment.read_keys,
            keys_laid_by_descriptors: fragment.keys_laid_by_descriptors,
            variable_definitions: fragment.variables,
            records: UnitRecords {
                eval_scopes: fragment.eval_scopes,
                data: fragment.data,
                expected_results: fragment.expected_results,
                declared_records: fragment.declared_records,
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
