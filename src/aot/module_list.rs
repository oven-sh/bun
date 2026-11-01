//! What a metafile tells about the modules of a compiled program.

#[derive(Clone, PartialEq, Eq, Debug, Default)]
pub struct ModuleList {
    /// The files of the application that the program holds, each once.
    pub inputs: Vec<ModuleInput>,
    /// The position of the main entry point in `inputs`.
    pub entry_point: Option<u32>,
    /// The names that the main entry point exports, in ascending order.
    pub exports: Vec<Vec<u8>>,
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub struct ModuleInput {
    /// From the working directory of the build, with forward slashes.
    pub path: Vec<u8>,
    pub byte_count: u64,
    pub format: Option<ModuleFormat>,
    pub imports: Vec<ModuleImport>,
    /// The machine code of the functions whose text the file holds. A function that is inlined counts for the file of its caller.
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
    /// The specifier as the importer spells it.
    pub original: Vec<u8>,
    pub data_type: Option<DataType>,
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub enum ImportTarget {
    /// A position in `ModuleList::inputs`.
    Input(u32),
    /// The program finds it when it runs: a built-in module, or what the build marked as external or could not resolve.
    External(Vec<u8>),
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum ModuleImportKind {
    ImportStatement,
    RequireCall,
    DynamicImport,
    RequireResolve,
    /// The import of a page.
    HtmlManifest,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum DataType {
    Json,
    Toml,
    Text,
}
