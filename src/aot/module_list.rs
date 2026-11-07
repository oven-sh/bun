#[derive(Clone, PartialEq, Eq, Debug, Default)]
pub struct ModuleList {
    pub inputs: Vec<ModuleInput>,
    pub entry_point: Option<u32>,
    pub exports: Vec<Vec<u8>>,
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub struct ModuleInput {
    pub path: Vec<u8>,
    pub byte_count: u64,
    pub format: Option<ModuleFormat>,
    pub imports: Vec<ModuleImport>,
    pub code_byte_count: u64,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum ModuleFormat {
    Esm,
    Cjs,
    Json,
    Css,
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub struct ModuleImport {
    pub target: ImportTarget,
    pub kind: ModuleImportKind,
    pub original: Vec<u8>,
    pub data_type: Option<DataType>,
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub enum ImportTarget {
    Input(u32),
    External(Vec<u8>),
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum ModuleImportKind {
    ImportStatement,
    RequireCall,
    DynamicImport,
    RequireResolve,
    HtmlManifest,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum DataType {
    Json,
    Toml,
    Text,
}
