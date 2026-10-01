// checker.go 553-579: Program and the five methods of Host that package checker calls, in upstream's order. A file is the NodeId of its SourceFile node (ast.HasFileName and tspath.Path both name a file of the program).
use crate::tscore::golang::{Text, Tristate};
use crate::tscore::ids::NodeId;

// core.ScriptTarget, core.ModuleKind, core.ModuleResolutionKind: upstream's numbers.
#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Default, Debug)]
pub struct ScriptTarget(pub i32);

#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Default, Debug)]
pub struct ModuleKind(pub i32);

#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Default, Debug)]
pub struct ModuleResolutionKind(pub i32);

// core.ResolutionMode = core.ModuleKind
pub type ResolutionMode = ModuleKind;

// Stand-in for core.CompilerOptions: the options that the translated functions of this scratch read.
#[derive(Default)]
pub struct CompilerOptions {
    pub strict: Tristate,
    pub strict_null_checks: Tristate,
    pub exact_optional_property_types: Tristate,
    pub no_unused_locals: Tristate,
}

// module/types.go 47-79
#[derive(Clone, Copy, Default)]
pub struct PackageId<'p> {
    pub name: Text<'p>,
    pub sub_module_name: Text<'p>,
    pub version: Text<'p>,
    pub peer_dependencies: Text<'p>,
}

// IsResolved: the module is present and resolved_file_name is not empty.
#[derive(Clone, Copy, Default)]
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
#[derive(Clone, Copy, Default)]
pub struct SourceFileMetaData<'p> {
    pub package_json_type: Text<'p>,
    pub package_json_directory: Text<'p>,
    pub implied_node_format: ResolutionMode,
}

pub trait Program<'p> {
    fn options(&self) -> &'p CompilerOptions;
    fn source_files(&self) -> &'p [NodeId];
    // The files arrive bound: nothing to do.
    fn bind_source_files(&self);
    fn file_exists(&self, file_name: &[u8]) -> bool;
    fn get_source_file(&self, file_name: &[u8]) -> NodeId;
    fn get_source_file_for_resolved_module(&self, file_name: &[u8]) -> NodeId;
    fn get_emit_module_format_of_file(&self, source_file: NodeId) -> ModuleKind;
    fn get_emit_syntax_for_usage_location(
        &self,
        source_file: NodeId,
        usage_location: NodeId,
    ) -> ResolutionMode;
    fn get_implied_node_format_for_emit(&self, source_file: NodeId) -> ModuleKind;
    fn get_resolved_module(
        &self,
        current_source_file: NodeId,
        module_reference: &[u8],
        mode: ResolutionMode,
    ) -> Option<ResolvedModule<'p>>;
    // GetResolvedModules: the only reader ranges over every entry (utilities.go 1672).
    fn for_each_resolved_module(&self, f: &mut dyn FnMut(ResolvedModule<'p>));
    // GetPackagesMap: None when the program has no map yet (utilities.go 1799 reads the checker's own).
    fn get_packages_map_entry(&self, package_name: &[u8]) -> Option<bool>;
    fn get_source_file_meta_data(&self, file: NodeId) -> SourceFileMetaData<'p>;
    fn get_jsx_runtime_import_specifier(&self, file: NodeId) -> (Text<'p>, NodeId);
    fn get_import_helpers_import_specifier(&self, file: NodeId) -> NodeId;
    fn source_file_may_be_emitted(&self, source_file: NodeId, force_dts_emit: bool) -> bool;
    fn is_source_file_default_library(&self, file: NodeId) -> bool;
    // The three project reference questions: false and None for a program without references.
    fn has_project_reference_from_output_dts(&self, file: NodeId) -> bool;
    fn get_redirect_for_resolution(&self, file: NodeId) -> Option<&'p CompilerOptions>;
    fn common_source_directory(&self) -> Text<'p>;
    // Host (modulespecifiers.ModuleSpecifierGenerationHost): five of its fifteen methods.
    fn use_case_sensitive_file_names(&self) -> bool;
    fn get_current_directory(&self) -> Text<'p>;
    fn has_project_reference_from_source(&self, path: &[u8]) -> bool;
    fn get_default_resolution_mode_for_file(&self, file: NodeId) -> ResolutionMode;
    fn get_mode_for_usage_location(&self, file: NodeId, usage_location: NodeId) -> ResolutionMode;
}
