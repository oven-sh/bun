use super::generated::{
    Data, Entry, EvalScope, ExpectedResult, Function, Layout, Module, ModuleFailure,
    RuntimeFunctionEntry, TypeSite, Variable, WebAssemblyModule,
};
use super::property_keys::PropertyKeyTable;
use super::strings::StringTable;
use super::types::TypeTable;

#[derive(Default)]
pub struct Program {
    pub strings: StringTable,
    pub property_keys: PropertyKeyTable,
    pub types: TypeTable,
    pub type_sites: Vec<TypeSite>,
    pub expected_results: Vec<ExpectedResult>,
    pub layouts: Vec<Layout>,
    pub variables: Vec<Variable>,
    pub modules: Vec<Module>,
    pub module_failures: Vec<ModuleFailure>,
    pub eval_scopes: Vec<EvalScope>,
    pub functions: Vec<Function>,
    pub data: Vec<Data>,
    pub entries: Vec<Entry>,
    pub runtime_functions: Vec<RuntimeFunctionEntry>,
    pub web_assembly_modules: Vec<WebAssemblyModule>,
}

#[derive(Copy, Clone)]
pub struct NameTables<'a> {
    pub strings: &'a StringTable,
    pub property_keys: &'a PropertyKeyTable,
    pub types: &'a TypeTable,
}

impl Program {
    pub fn new() -> Program {
        Program::default()
    }

    pub fn name_tables(&self) -> NameTables<'_> {
        NameTables {
            strings: &self.strings,
            property_keys: &self.property_keys,
            types: &self.types,
        }
    }
}
