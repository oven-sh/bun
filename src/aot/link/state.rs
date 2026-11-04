use super::program_keys::ProgramModule;
use crate::builtins::id::BuiltinId;
use crate::ir::generated::{
    AmbiguousExport, Entry, Module, ModuleFailure, RuntimeFunctionEntry, WebAssemblyModule,
};
use crate::load::ProgramFile;
use bun_sema::atom::Atom;

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
        is_replaceable: bool,
        writer: ExportWriter,
    },
    /// `VariableKey::MockOfRuntimeModule`
    MockOfRuntimeModule {
        module: u32,
    },
}

#[derive(Default)]
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
    /// The merged index of `entry.function`, which is a number of the tables of `file`.
    pub function: u32,
    pub entry: RuntimeFunctionEntry,
    pub file: ProgramFile,
}

/// Functions, layouts and variables go by merged index here: the place of the key in `MergedKeys::keys`, not a number of any tables and not an id of the program.
pub(super) struct Definitions {
    pub functions: Vec<Option<DefinitionSite>>,
    pub layouts: Vec<Option<DefinitionSite>>,
    /// What the chosen definition of each layout names as its base.
    pub bases_of_layouts: Vec<Option<u32>>,
    // By layout and then by site: see `LayoutKey::has_united_definitions`.
    pub other_layout_definitions: Vec<(u32, DefinitionSite)>,
    pub variables: Vec<Option<VariableDefinition>>,
    pub runtime_functions: Vec<RuntimeFunctionRoot>,
    /// No number of the program hangs on this or on what follows: only the records are written with them.
    /// Empty until `Definitions::add_related_layouts` and `Definitions::add_related_functions`.
    pub supertypes: SupertypeEdges,
    pub has_members_without_layout: Vec<bool>,
    pub function_types: SupertypeEdges,
    pub builtin_members: Vec<(u32, BuiltinId)>,
}

impl Definitions {
    #[cfg(test)]
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

pub(super) struct ModuleRecords {
    pub modules: Vec<Module>,
    /// The index of a record among `modules`, and the unit that still holds the positions of its file.
    pub units_with_positions: Vec<(u32, u32)>,
    pub module_failures: Vec<ModuleFailure>,
    pub ambiguous_exports: Vec<AmbiguousExport>,
    pub entries: Vec<Entry>,
    pub runtime_functions: Vec<RuntimeFunctionEntry>,
    pub web_assembly_modules: Vec<WebAssemblyModule>,
}

pub(super) struct ModuleTable {
    pub modules: Vec<ProgramModule>,
    pub index_by_module: rustc_hash::FxHashMap<ProgramModule, u32>,
}

impl ModuleTable {
    pub(super) fn index_of(&self, module: ProgramModule) -> u32 {
        match self.index_by_module.get(&module) {
            Some(&index) => index,
            None => panic!("a module that module binding did not list: {module:?}"),
        }
    }
}
