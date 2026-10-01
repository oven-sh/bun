// checker.go 553-579: the methods of Program and of its Host that the checker calls (24 of them), over resolved inputs.
use crate::ast::diagnostic::SourceFiles;
use crate::ast::reader::Ast;
use crate::tscore::compileroptions::{CompilerOptions, ModuleKind, ResolutionMode};
use crate::tscore::golang::{List, Map, OrderedMap, Text};
use crate::tscore::ids::NodeId;

// module/types.go 47-79
#[derive(Clone, Copy, Default, Debug)]
pub struct PackageId<'p> {
    pub name: Text<'p>,
    pub sub_module_name: Text<'p>,
    pub version: Text<'p>,
    pub peer_dependencies: Text<'p>,
}

// IsResolved: the module is present and resolved_file_name is not empty.
#[derive(Clone, Copy, Default, Debug)]
pub struct ResolvedModule<'p> {
    pub resolved_file_name: Text<'p>,
    pub original_path: Text<'p>,
    pub extension: Text<'p>,
    pub resolved_using_ts_extension: bool,
    pub resolved_using_extra_extensions: bool,
    pub package_id: PackageId<'p>,
    pub is_external_library_import: bool,
    pub alternate_result: Text<'p>,
}

// ast/ast.go 2391-2395
#[derive(Clone, Copy, Default, Debug)]
pub struct SourceFileMetaData<'p> {
    pub package_json_type: Text<'p>,
    pub package_json_directory: Text<'p>,
    pub implied_node_format: ResolutionMode,
}

// tsoptions.SourceOutputAndProjectReference and tsoptions.ParsedCommandLine: one project, so no value of them exists.
pub enum ProjectReference {}
pub enum ParsedCommandLine {}

// A file is the id of its SourceFile node (ast.HasFileName and tspath.Path alike).
pub trait Program {
    fn options(&self) -> &CompilerOptions;
    fn source_files(&self) -> List<'_, NodeId>;
    // The files arrive bound.
    fn bind_source_files(&self);
    fn file_exists(&self, file_name: &[u8]) -> bool;
    fn get_source_file_for_resolved_module(&self, file_name: &[u8]) -> NodeId;
    fn get_emit_module_format_of_file(&self, source_file: NodeId) -> ModuleKind;
    fn get_emit_syntax_for_usage_location(
        &self,
        source_file: NodeId,
        usage: NodeId,
    ) -> ResolutionMode;
    fn get_implied_node_format_for_emit(&self, source_file: NodeId) -> ModuleKind;
    fn get_resolved_module(
        &self,
        file: NodeId,
        module_reference: &[u8],
        mode: ResolutionMode,
    ) -> Option<ResolvedModule<'_>>;
    // GetResolvedModules: the one caller ranges over every module of every file.
    fn for_each_resolved_module(&self, f: &mut dyn FnMut(ResolvedModule<'_>));
    // GetPackagesMap: nil when the program keeps none, the checker then builds its own.
    fn get_packages_map(&self) -> Option<&Map<Text<'_>, bool>>;
    fn get_source_file_meta_data(&self, file: NodeId) -> SourceFileMetaData<'_>;
    // GetJSXRuntimeImportSpecifier: the module reference and the synthetic specifier node.
    fn get_jsx_runtime_import_specifier(&self, file: NodeId) -> (Text<'_>, NodeId);
    fn get_import_helpers_import_specifier(&self, file: NodeId) -> NodeId;
    fn source_file_may_be_emitted(&self, source_file: NodeId, force_dts_emit: bool) -> bool;
    fn is_source_file_default_library(&self, file: NodeId) -> bool;
    fn get_project_reference_from_output_dts(&self, file: NodeId) -> Option<&ProjectReference>;
    fn get_redirect_for_resolution(&self, file: NodeId) -> Option<&ParsedCommandLine>;
    fn common_source_directory(&self) -> &[u8];
    // Host (modulespecifiers.ModuleSpecifierGenerationHost): the five of its methods that the checker calls.
    fn use_case_sensitive_file_names(&self) -> bool;
    fn get_current_directory(&self) -> &[u8];
    fn get_project_reference_from_source(&self, file: NodeId) -> Option<&ProjectReference>;
    fn get_default_resolution_mode_for_file(&self, file: NodeId) -> ResolutionMode;
    fn get_mode_for_usage_location(&self, file: NodeId, usage: NodeId) -> ResolutionMode;
}

// The resolved inputs that answer the trait for one project without references.
#[derive(Default)]
pub struct ResolvedProgram<'p> {
    pub options: CompilerOptions,
    // Lib files first, then the roots in the order of the program.
    pub files: List<'p, NodeId>,
    pub default_library_files: Map<NodeId, bool>,
    pub file_by_name: Map<Text<'p>, NodeId>,
    pub resolved_modules: OrderedMap<(NodeId, Text<'p>, ResolutionMode), ResolvedModule<'p>>,
    pub meta: Map<NodeId, SourceFileMetaData<'p>>,
    pub module_formats: Map<NodeId, ModuleKind>,
    pub current_directory: Text<'p>,
    pub use_case_sensitive_file_names: bool,
}

impl<'p> Program for ResolvedProgram<'p> {
    fn options(&self) -> &CompilerOptions {
        &self.options
    }
    fn source_files(&self) -> List<'_, NodeId> {
        self.files
    }
    fn bind_source_files(&self) {}
    fn file_exists(&self, file_name: &[u8]) -> bool {
        self.file_by_name.get_ok(&file_name).is_some()
    }
    fn get_source_file_for_resolved_module(&self, file_name: &[u8]) -> NodeId {
        self.file_by_name.get(&file_name)
    }
    fn get_emit_module_format_of_file(&self, source_file: NodeId) -> ModuleKind {
        self.module_formats.get(&source_file)
    }
    fn get_emit_syntax_for_usage_location(
        &self,
        source_file: NodeId,
        _usage: NodeId,
    ) -> ResolutionMode {
        self.meta.get(&source_file).implied_node_format
    }
    fn get_implied_node_format_for_emit(&self, source_file: NodeId) -> ModuleKind {
        self.module_formats.get(&source_file)
    }
    fn get_resolved_module(
        &self,
        file: NodeId,
        module_reference: &[u8],
        mode: ResolutionMode,
    ) -> Option<ResolvedModule<'_>> {
        self.resolved_modules
            .get_ok(&(file, module_reference, mode))
    }
    fn for_each_resolved_module(&self, f: &mut dyn FnMut(ResolvedModule<'_>)) {
        for position in 0..self.resolved_modules.len() as usize {
            if let Some((_, module)) = self.resolved_modules.entry_at(position) {
                f(module);
            }
        }
    }
    fn get_packages_map(&self) -> Option<&Map<Text<'_>, bool>> {
        None
    }
    fn get_source_file_meta_data(&self, file: NodeId) -> SourceFileMetaData<'_> {
        self.meta.get(&file)
    }
    fn get_jsx_runtime_import_specifier(&self, _file: NodeId) -> (Text<'_>, NodeId) {
        (b"", NodeId::NIL)
    }
    fn get_import_helpers_import_specifier(&self, _file: NodeId) -> NodeId {
        NodeId::NIL
    }
    fn source_file_may_be_emitted(&self, _source_file: NodeId, _force_dts_emit: bool) -> bool {
        false
    }
    fn is_source_file_default_library(&self, file: NodeId) -> bool {
        self.default_library_files.get(&file)
    }
    fn get_project_reference_from_output_dts(&self, _file: NodeId) -> Option<&ProjectReference> {
        None
    }
    fn get_redirect_for_resolution(&self, _file: NodeId) -> Option<&ParsedCommandLine> {
        None
    }
    fn common_source_directory(&self) -> &[u8] {
        b""
    }
    fn use_case_sensitive_file_names(&self) -> bool {
        self.use_case_sensitive_file_names
    }
    fn get_current_directory(&self) -> &[u8] {
        self.current_directory
    }
    fn get_project_reference_from_source(&self, _file: NodeId) -> Option<&ProjectReference> {
        None
    }
    fn get_default_resolution_mode_for_file(&self, file: NodeId) -> ResolutionMode {
        self.meta.get(&file).implied_node_format
    }
    fn get_mode_for_usage_location(&self, file: NodeId, _usage: NodeId) -> ResolutionMode {
        self.meta.get(&file).implied_node_format
    }
}

// What the diagnostics of the checker read from the files of the program: names and texts. The line maps belong to the writer.
#[derive(Clone, Copy)]
pub struct ProgramFiles<'a> {
    ast: Ast<'a>,
}

impl<'a> ProgramFiles<'a> {
    pub fn new(ast: Ast<'a>) -> Self {
        Self { ast }
    }
    fn file(&self, file: NodeId) -> Option<&'a crate::ast::file::File> {
        self.ast
            .frozen()
            .files()
            .iter()
            .find(|candidate| candidate.source_file.root == file)
            .copied()
    }
}

impl SourceFiles for ProgramFiles<'_> {
    fn file_name(&self, file: NodeId) -> &[u8] {
        match self.file(file) {
            Some(found) => &found.source_file.file_name,
            None => b"",
        }
    }
    fn path(&self, file: NodeId) -> &[u8] {
        self.file_name(file)
    }
    fn text(&self, file: NodeId) -> &[u8] {
        match self.file(file) {
            Some(found) => found.source_text(),
            None => b"",
        }
    }
    fn ecma_line_map(&self, _file: NodeId) -> &[i32] {
        &[]
    }
}
