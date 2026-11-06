use super::program_keys::ProgramModule;
use super::unit::LinkUnit;
use crate::builtins::id::BuiltinId;
use crate::ir::generated::{
    Data, Entry, EvalScope, ExpectedResult, Function, Layout, Module, ModuleFailure,
    RuntimeFunctionEntry, TypeSite, Variable, WebAssemblyModule,
};
use crate::ir::{
    DataId, EvalScopeId, ExpectedResultId, FunctionId, IdMap, LayoutId, ModuleFailureId, ModuleId,
    PropertyKeyId, PropertyKeyTable, StringId, StringTable, TypeId, TypeSiteId, VariableId,
};
use crate::load::{PerProject, ProgramFile};
use bun_sema::atom::Atom;
use std::sync::Arc;

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub(super) struct DefinitionSite {
    pub unit: u32,
    pub index: u32,
}

/// Who stores a variable that link defines.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum ExportWriter {
    /// The loader, when it links the module, which lists the variable among its synthetic exports.
    Loader,
    /// The body of a CommonJS module of the program. Until it does, the name reads `undefined`.
    Body,
    /// The body of the face of a CommonJS file, which takes the copy that ES importers hold.
    Face,
    /// The run time, behind the body of a face that captures: it leaves the copy of a name that the object lacks empty.
    Capture,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum VariableDefinition {
    Unit(DefinitionSite),
    SyntheticExport {
        /// The record that stores the variable.
        module: u32,
        name: Atom,
        is_known_member: bool,
        writer: ExportWriter,
    },
}

pub(super) struct SupertypeEdges {
    pub starts: Vec<u32>,
    pub supertypes: Vec<u32>,
}

impl SupertypeEdges {
    pub(super) fn of(&self, layout: u32) -> &[u32] {
        let (start, end) = (layout as usize, layout as usize + 1);
        &self.supertypes[self.starts[start] as usize..self.starts[end] as usize]
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) struct RuntimeFunctionRoot {
    pub function: u32,
    pub entry: RuntimeFunctionEntry,
    pub file: ProgramFile,
}

pub(super) struct Definitions {
    pub functions: Vec<Option<DefinitionSite>>,
    pub layouts: Vec<Option<DefinitionSite>>,
    // By layout and then by site: see `LayoutKey::has_united_definitions`.
    pub other_layout_definitions: Vec<(u32, DefinitionSite)>,
    pub variables: Vec<Option<VariableDefinition>>,
    pub supertypes: SupertypeEdges,
    pub function_types: SupertypeEdges,
    pub builtin_members: Vec<(u32, BuiltinId)>,
    pub has_members_without_layout: Vec<bool>,
    pub conversions_outside_family: Vec<(u32, u32)>,
    pub runtime_functions: Vec<RuntimeFunctionRoot>,
}

impl Definitions {
    pub(super) fn other_definitions_of(&self, layout: u32) -> &[(u32, DefinitionSite)] {
        let others = &self.other_layout_definitions;
        let start = others.partition_point(|&(other, _)| other < layout);
        let end = others.partition_point(|&(other, _)| other <= layout);
        &others[start..end]
    }

    pub(super) fn is_other_definition(&self, layout: u32, site: DefinitionSite) -> bool {
        self.other_layout_definitions
            .binary_search(&(layout, site))
            .is_ok()
    }
}

pub(super) struct UnitMarks {
    pub strings: Vec<bool>,
    pub property_keys: Vec<bool>,
    pub types: Vec<bool>,
    pub type_sites: Vec<bool>,
    pub expected_results: Vec<bool>,
    pub eval_scopes: Vec<bool>,
    pub data: Vec<bool>,
}

impl UnitMarks {
    pub(super) fn new(unit: &LinkUnit) -> UnitMarks {
        UnitMarks {
            strings: vec![false; unit.strings.len()],
            property_keys: vec![false; unit.property_keys.len()],
            types: vec![false; unit.types.len()],
            type_sites: vec![false; unit.records.type_sites.len()],
            expected_results: vec![false; unit.records.expected_results.len()],
            eval_scopes: vec![false; unit.records.eval_scopes.len()],
            data: vec![false; unit.records.data.len()],
        }
    }
}

pub(super) struct Retained {
    pub functions: Vec<bool>,
    pub layouts: Vec<bool>,
    pub variables: Vec<bool>,
    pub module_failures: PerProject<Vec<bool>>,
    pub units: Vec<UnitMarks>,
}

#[derive(Default)]
pub struct UnitIds {
    pub strings: Vec<Option<StringId>>,
    pub property_keys: Vec<Option<PropertyKeyId>>,
    pub types: Vec<Option<TypeId>>,
    pub type_sites: Vec<Option<TypeSiteId>>,
    pub expected_results: Vec<Option<ExpectedResultId>>,
    pub layouts: Vec<Option<LayoutId>>,
    pub variables: Vec<Option<VariableId>>,
    pub modules: Vec<Option<ModuleId>>,
    pub module_failures: Vec<Option<ModuleFailureId>>,
    pub eval_scopes: Vec<Option<EvalScopeId>>,
    pub functions: Vec<Option<FunctionId>>,
    pub data: Vec<Option<DataId>>,
}

impl UnitIds {
    pub fn as_map(&self) -> IdMap<'_> {
        IdMap {
            strings: &self.strings,
            property_keys: &self.property_keys,
            types: &self.types,
            type_sites: &self.type_sites,
            expected_results: &self.expected_results,
            layouts: &self.layouts,
            variables: &self.variables,
            modules: &self.modules,
            module_failures: &self.module_failures,
            eval_scopes: &self.eval_scopes,
            functions: &self.functions,
            data: &self.data,
        }
    }
}

#[derive(Copy, Clone, Default, PartialEq, Eq, Debug)]
pub(super) struct ProgramCounts {
    pub functions: usize,
    pub layouts: usize,
    pub variables: usize,
    pub modules: usize,
    pub module_failures: usize,
    pub type_sites: usize,
    pub expected_results: usize,
    pub eval_scopes: usize,
    pub data: usize,
}

pub(super) struct Numbering {
    pub functions: Vec<Option<FunctionId>>,
    pub layouts: Vec<Option<LayoutId>>,
    pub variables: Vec<Option<VariableId>>,
    pub modules: Vec<Option<ModuleId>>,
    pub module_failures: PerProject<Vec<Option<ModuleFailureId>>>,
    pub counts: ProgramCounts,
    pub units: Vec<UnitIds>,
}

pub(super) struct MergedStrings {
    pub table: StringTable,
    pub local_to_program: Vec<Vec<Option<StringId>>>,
}

pub(super) struct MergedTypes {
    pub types: Vec<Vec<Option<TypeId>>>,
    pub type_representatives: Vec<(u32, TypeId)>,
}

pub(super) struct MergedPropertyKeys {
    pub table: PropertyKeyTable,
    pub local_to_program: Vec<Vec<Option<PropertyKeyId>>>,
}

pub(super) struct ProgramTables {
    /// With the ids of their units: see `BodyRemap`.
    pub functions_by_unit: Vec<Vec<Arc<Function>>>,
    pub layouts: Vec<Layout>,
    /// A list for each unit that has any, in the order of the units.
    pub other_layout_definitions: Vec<Vec<(LayoutId, Layout)>>,
    pub variables: Vec<Variable>,
    pub type_sites: Vec<TypeSite>,
    pub expected_results: Vec<ExpectedResult>,
    pub eval_scopes: Vec<EvalScope>,
    pub data: Vec<Data>,
}

pub(super) struct ModuleRecords {
    pub modules: Vec<Module>,
    pub module_failures: Vec<ModuleFailure>,
    pub entries: Vec<Entry>,
    pub runtime_functions: Vec<RuntimeFunctionEntry>,
    pub web_assembly_modules: Vec<WebAssemblyModule>,
}

pub(super) struct ModuleTable {
    pub modules: Vec<ProgramModule>,
    pub index_by_module: rustc_hash::FxHashMap<ProgramModule, u32>,
    pub unit_by_module: Vec<Option<u32>>,
}

impl ModuleTable {
    pub(super) fn index_of(&self, module: ProgramModule) -> u32 {
        match self.index_by_module.get(&module) {
            Some(&index) => index,
            None => panic!("a module that module binding did not list: {module:?}"),
        }
    }
}
