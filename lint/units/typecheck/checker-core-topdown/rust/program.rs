// checker.go 553-579: the methods of Program and Host that the ported layers call, in upstream's order. Not compiled yet.
// A file is the NodeId of its SourceFile node (ast.HasFileName). A nil message or module is the NIL id or None.
pub trait Program {
    fn options(&self) -> &CompilerOptions;
    fn source_files(&self) -> &[NodeId];
    // The tables arrive bound: nothing to do.
    fn bind_source_files(&self);
    fn file_exists(&self, file_name: &[u8]) -> bool;
    fn get_source_file_for_resolved_module(&self, file_name: &[u8]) -> NodeId;
    fn get_emit_module_format_of_file(&self, source_file: NodeId) -> ModuleKind;
    fn get_emit_syntax_for_usage_location(&self, source_file: NodeId, usage: NodeId) -> ResolutionMode;
    fn get_implied_node_format_for_emit(&self, source_file: NodeId) -> ModuleKind;
    fn get_resolved_module(&self, file: NodeId, module_reference: &[u8], mode: ResolutionMode) -> Option<&ResolvedModule>;
    fn for_each_resolved_module(&self, f: &mut dyn FnMut(&ResolvedModule));
    fn get_packages_map(&self) -> &PackagesMap;
    fn get_source_file_meta_data(&self, file: NodeId) -> SourceFileMetaData;
    fn source_file_may_be_emitted(&self, source_file: NodeId, force_dts_emit: bool) -> bool;
    fn get_project_reference_from_output_dts(&self, file: NodeId) -> Option<&ProjectReference>;
    fn get_redirect_for_resolution(&self, file: NodeId) -> Option<&ParsedCommandLine>;
    fn common_source_directory(&self) -> &[u8];
    // Host (modulespecifiers.ModuleSpecifierGenerationHost): five of its fifteen methods.
    fn use_case_sensitive_file_names(&self) -> bool;
    fn get_current_directory(&self) -> &[u8];
    fn get_project_reference_from_source(&self, path: &[u8]) -> Option<&ProjectReference>;
    fn get_default_resolution_mode_for_file(&self, file: NodeId) -> ResolutionMode;
    fn get_mode_for_usage_location(&self, file: NodeId, usage: NodeId) -> ResolutionMode;
}

// The resolved inputs that answer the trait for one project without references.
pub struct ResolvedProgram<'p> {
    // Options, SourceFiles (lib files first, then the roots in the order of the program).
    pub options: &'p CompilerOptions,
    pub files: &'p [NodeId],
    // GetSourceFileForResolvedModule, FileExists: keyed by tspath.ToPath(name, current_directory, case sensitivity).
    pub file_by_path: Map<Text<'p>, NodeId>,
    pub existing_paths: Map<Text<'p>, bool>,
    // GetResolvedModule, GetResolvedModules, GetPackagesMap: (importing file, module name, mode) to the result of resolution.
    pub resolved_modules: OrderedMap<(NodeId, Text<'p>, ResolutionMode), ResolvedModule<'p>>,
    // GetSourceFileMetaData and, through the pure functions below, the five format and mode questions.
    pub meta: Map<NodeId, SourceFileMetaData<'p>>,
    pub current_directory: Text<'p>,
    pub use_case_sensitive_file_names: bool,
}

// Pure functions that the implementation calls. None of them reads the disk.
// get_implied_node_format_for_emit  = ast.GetImpliedNodeFormatForEmitWorker(name, options.GetEmitModuleKind(), meta)   ast/utilities.go 2592-2610
// get_emit_module_format_of_file    = ast.GetEmitModuleFormatOfFileWorker(name, options, meta)                        ast/utilities.go 2584-2590
// get_default_resolution_mode_for_file = getDefaultResolutionModeForFile(name, meta, options)                         compiler/fileloader.go 1006-1012
// get_mode_for_usage_location       = getModeForUsageLocation(name, meta, usage, options)                             compiler/fileloader.go 1014-1044
// get_emit_syntax_for_usage_location = getEmitSyntaxForUsageLocationWorker(name, meta, usage, options)                compiler/fileloader.go 1052-1085
// Project references: get_redirect_for_resolution, get_project_reference_from_output_dts and _from_source give None,
// so common_source_directory is never asked. source_file_may_be_emitted is compiler/emitter.go 464-520 and is asked
// only under rewriteRelativeImportExtensions.

// module/types.go 47-79
pub struct PackageId<'p> {
    pub name: Text<'p>,
    pub sub_module_name: Text<'p>,
    pub version: Text<'p>,
    pub peer_dependencies: Text<'p>,
}
// IsResolved: the module is present and resolved_file_name is not empty.
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
pub struct SourceFileMetaData<'p> {
    pub package_json_type: Text<'p>,
    pub package_json_directory: Text<'p>,
    pub implied_node_format: ResolutionMode,
}

// binder/nameresolver.go 9-23: the function fields become a host. `has_*` answers upstream's nil checks.
pub trait NameResolverHost<'a> {
    const HAS_ON_PROPERTY_WITH_INVALID_INITIALIZER: bool;
    const HAS_ON_FAILED_TO_RESOLVE_SYMBOL: bool;
    const HAS_ON_SUCCESSFULLY_RESOLVED_SYMBOL: bool;
    fn compiler_options(&self) -> &CompilerOptions;
    fn get_symbol_of_declaration(&mut self, node: NodeId) -> SymbolId;
    fn error(&mut self, location: NodeId, message: MessageId, args: &[Arg<'_>]);
    fn globals(&self) -> SymbolTableId;
    fn arguments_symbol(&mut self) -> SymbolId;
    fn require_symbol(&self) -> SymbolId;
    fn lookup(&mut self, symbols: SymbolTableId, name: &[u8], meaning: SymbolFlags) -> SymbolId;
    fn symbol_referenced(&mut self, symbol: SymbolId, meaning: SymbolFlags);
    fn set_requires_scope_change_cache(&mut self, node: NodeId, value: Tristate);
    fn get_requires_scope_change_cache(&mut self, node: NodeId) -> Tristate;
    fn on_property_with_invalid_initializer(&mut self, location: NodeId, name: &[u8], declaration: NodeId, result: SymbolId) -> bool;
    fn on_failed_to_resolve_symbol(&mut self, location: NodeId, name: &[u8], meaning: SymbolFlags, name_not_found_message: MessageId);
    fn on_successfully_resolved_symbol(&mut self, location: NodeId, result: SymbolId, meaning: SymbolFlags, last_location: NodeId, associated_declaration: NodeId, within_deferred_context: bool);
}
// Two hosts wrap `&mut Checker`: CheckerNameResolver (createNameResolver: lookup = get_symbol, all three hooks) and
// CheckerNameResolverForSuggestion (createNameResolverForSuggestion: lookup = get_suggestion_for_symbol_name_lookup, no hooks,
// error is still the checker's). pub fn resolve<H: NameResolverHost>(host, location, name, meaning, message, is_use, exclude_globals).
