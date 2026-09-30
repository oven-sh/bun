// checker.go:15195-15828 (layer M-MODULE): the resolution of external module names through the resolved modules of the program with its errors, ambient modules, the symbol of an external module as ES module, synthetic defaults, and module types cloned for an import.
use crate::ast::{
    Arg, DiagnosticId, INTERNAL_SYMBOL_NAME_DEFAULT, INTERNAL_SYMBOL_NAME_EXPORT_EQUALS,
    INTERNAL_SYMBOL_NAME_MODULE_EXPORTS, INTERNAL_SYMBOL_NAME_OBJECT, INTERNAL_SYMBOL_NAME_TYPE,
    Kind, NodeFlags, NodeId, RepopulateDiagnosticInfo, RepopulateDiagnosticKind, SymbolFlags,
    SymbolId, find_ancestor, find_ancestor_kind, get_declaration_of_kind, get_external_module_name,
    get_module_specifier_of_bare_or_accessed_require, get_namespace_declaration_node,
    get_source_file_of_node, has_resolution_mode_override, is_emittable_import,
    is_export_declaration, is_identifier, is_import_call, is_import_declaration,
    is_import_declaration_or_js_import_declaration, is_import_equals_declaration,
    is_literal_import_type_node, is_module_declaration, is_non_local_alias,
    is_part_of_type_only_import_or_export_declaration, is_require_call,
    is_resolution_mode_override_host, is_source_file, is_string_literal, is_string_literal_like,
    is_variable_declaration_initialized_to_bare_or_accessed_require,
};
use crate::checker::{
    CachedTypeKey, CachedTypeKind, Checker, ObjectFlags, SignatureKind, TypeFlags, TypeId,
    create_mode_mismatch_details, create_module_not_found_chain, is_side_effect_import,
};
use crate::core::{
    JsxEmit, List, ModuleKind, ModuleResolutionKind, RESOLUTION_MODE_ESM, ResolutionMode, find,
    find_best_pattern_match, if_else, node_core_modules, should_rewrite_module_specifier,
};
use crate::diagnostics::{self, MessageId};
use crate::module::{ResolvedModule, get_resolution_diagnostic};
use crate::stringutil::strings;
use crate::tspath::{
    ComparePathsOptions, EXTENSION_CTS, EXTENSION_DCTS, EXTENSION_DMTS, EXTENSION_JS,
    EXTENSION_JSON, EXTENSION_JSX, EXTENSION_MTS, EXTENSION_TS, EXTENSION_TSX,
    SUPPORTED_TS_EXTENSIONS_FLAT, extension_is_ts, file_extension_is, get_any_extension_from_path,
    get_directory_path, get_normalized_absolute_path, get_relative_path_from_directory,
    get_relative_path_from_file, has_extension, is_declaration_file_name,
    is_external_module_name_relative, path_is_relative, remove_extension, to_path,
    try_extract_ts_extension, try_get_extension_from_path,
};

// tspath answers upstream's panic as an error: the checker records it and goes on with the empty path.
fn relative_path(c: &Checker<'_>, result: Result<Vec<u8>, &'static str>) -> Vec<u8> {
    match result {
        Ok(path) => path,
        Err(message) => {
            let _: () = c.fail(message);
            Vec::new()
        }
    }
}

impl<'a> Checker<'a> {
    pub fn resolve_external_module_name(
        &mut self,
        location: NodeId,
        module_reference_expression: NodeId,
        ignore_errors: bool,
    ) -> SymbolId {
        let mut error_message = self
            .get_cannot_resolve_module_name_error_for_specific_module(module_reference_expression);
        if error_message.is_nil() {
            error_message =
                diagnostics::CANNOT_FIND_MODULE_0_OR_ITS_CORRESPONDING_TYPE_DECLARATIONS;
        }
        let ignore_errors = ignore_errors || self.compiler_options.no_check.is_true();
        self.resolve_external_module_name_worker(
            location,
            module_reference_expression,
            if_else(ignore_errors, MessageId::NIL, error_message),
            ignore_errors,
            false,
        )
    }

    pub fn get_cannot_resolve_module_name_error_for_specific_module(
        &self,
        module_name: NodeId,
    ) -> MessageId {
        let a = self.ast;
        if is_string_literal(a, module_name) {
            if node_core_modules().contains(a.text(module_name)) {
                if self.compiler_options.uses_wildcard_types() {
                    return diagnostics::CANNOT_FIND_NAME_0_DO_YOU_NEED_TO_INSTALL_TYPE_DEFINITIONS_FOR_NODE_TRY_NPM_I_SAVE_DEV_TYPES_SLASHNODE;
                }
                return diagnostics::CANNOT_FIND_NAME_0_DO_YOU_NEED_TO_INSTALL_TYPE_DEFINITIONS_FOR_NODE_TRY_NPM_I_SAVE_DEV_TYPES_SLASHNODE_AND_THEN_ADD_NODE_TO_THE_TYPES_FIELD_IN_YOUR_TSCONFIG;
            }
        }
        MessageId::NIL
    }

    pub fn resolve_external_module_name_worker(
        &mut self,
        location: NodeId,
        module_reference_expression: NodeId,
        module_not_found_error: MessageId,
        ignore_errors: bool,
        is_for_augmentation: bool,
    ) -> SymbolId {
        let a = self.ast;
        if is_string_literal_like(a, module_reference_expression) {
            return self.resolve_external_module(
                location,
                a.text(module_reference_expression),
                module_not_found_error,
                if_else(!ignore_errors, module_reference_expression, NodeId::NIL),
                is_for_augmentation,
            );
        }
        SymbolId::NIL
    }

    pub fn get_external_module_file_from_declaration(&mut self, declaration: NodeId) -> NodeId {
        let a = self.ast;
        let mut specifier = NodeId::NIL;
        if a.kind(declaration) == Kind::ModuleDeclaration {
            if is_string_literal(a, a.name(declaration)) {
                specifier = a.name(declaration);
            }
        } else {
            specifier = get_external_module_name(a, declaration);
        }
        let module_symbol = self.resolve_external_module_name_worker(
            specifier,
            specifier,
            MessageId::NIL,
            false,
            false,
        );
        if module_symbol.is_nil() {
            return NodeId::NIL;
        }
        let decl = get_declaration_of_kind(a, module_symbol, Kind::SourceFile);
        if decl.is_nil() {
            return NodeId::NIL;
        }
        // `decl.AsSourceFile()`: a source file is the id of its SourceFile node.
        decl
    }

    pub fn resolve_external_module(
        &mut self,
        location: NodeId,
        module_reference: &[u8],
        module_not_found_error: MessageId,
        error_node: NodeId,
        is_for_augmentation: bool,
    ) -> SymbolId {
        let a = self.ast;
        let program = self.program;
        if !error_node.is_nil() && module_reference.starts_with(b"@types/") {
            let without_at_type_prefix = module_reference.get(b"@types/".len()..).unwrap_or(&[]);
            self.error(
                error_node,
                diagnostics::CANNOT_IMPORT_TYPE_DECLARATION_FILES_CONSIDER_IMPORTING_0_INSTEAD_OF_1,
                &[Arg::Str(without_at_type_prefix), Arg::Str(module_reference)],
            );
        }
        let ambient_module = self.try_find_ambient_module(module_reference, true);
        if !ambient_module.is_nil() {
            return ambient_module;
        }

        let importing_source_file = get_source_file_of_node(a, location);
        let mut context_specifier = NodeId::NIL;

        if is_string_literal_like(a, location)
            || !a.parent(location).is_nil()
                && is_module_declaration(a, a.parent(location))
                && a.as_module_declaration(a.parent(location)).name == location
        {
            context_specifier = location;
        } else if is_module_declaration(a, location) {
            context_specifier = a.as_module_declaration(location).name;
        } else if is_literal_import_type_node(a, location) {
            context_specifier = a
                .as_literal_type_node(a.as_import_type_node(location).argument)
                .literal;
        } else if is_variable_declaration_initialized_to_bare_or_accessed_require(a, location) {
            context_specifier = get_module_specifier_of_bare_or_accessed_require(a, location);
        } else {
            let mut ancestor = find_ancestor(a, location, |node| is_import_call(a, node));
            if !ancestor.is_nil() {
                context_specifier = a.arguments(ancestor).at(0usize);
            }

            if ancestor.is_nil() {
                ancestor = find_ancestor(a, location, |node| {
                    is_import_declaration_or_js_import_declaration(a, node)
                });
                if !ancestor.is_nil() {
                    context_specifier = a.module_specifier(ancestor);
                }
            }
            if ancestor.is_nil() {
                ancestor = find_ancestor(a, location, |node| is_export_declaration(a, node));
                if !ancestor.is_nil() {
                    context_specifier = a.module_specifier(ancestor);
                }
            }
            if ancestor.is_nil() {
                ancestor = find_ancestor(a, location, |node| is_import_equals_declaration(a, node));
                if !ancestor.is_nil() {
                    let module_reference_node =
                        a.as_import_equals_declaration(ancestor).module_reference;
                    if a.kind(module_reference_node) == Kind::ExternalModuleReference {
                        context_specifier = a.expression(module_reference_node);
                    }
                }
            }
        }

        let mode = if !context_specifier.is_nil() && is_string_literal_like(a, context_specifier) {
            program.get_mode_for_usage_location(importing_source_file, context_specifier)
        } else {
            program.get_default_resolution_mode_for_file(importing_source_file)
        };

        let resolved_module =
            program.get_resolved_module(importing_source_file, module_reference, mode);
        let is_resolved = resolved_module.is_some_and(|module| module.is_resolved());
        // Upstream reads the fields of the module only where it is resolved or not nil: the nil module reads as the zero module here.
        let resolved = resolved_module.unwrap_or_default();

        let mut resolution_diagnostic = MessageId::NIL;
        if !error_node.is_nil() && is_resolved {
            resolution_diagnostic = get_resolution_diagnostic(
                a,
                self.compiler_options,
                &resolved,
                importing_source_file,
            );
        }

        let mut source_file = NodeId::NIL;
        if is_resolved
            && (resolution_diagnostic.is_nil()
                || resolution_diagnostic
                    == diagnostics::MODULE_0_WAS_RESOLVED_TO_1_BUT_JSX_IS_NOT_SET)
        {
            source_file = program.get_source_file_for_resolved_module(resolved.resolved_file_name);
        }

        if !source_file.is_nil() {
            // If there's a resolutionDiagnostic we need to report it even if a sourceFile is found.
            if !resolution_diagnostic.is_nil() {
                self.error(
                    error_node,
                    resolution_diagnostic,
                    &[
                        Arg::Str(module_reference),
                        Arg::Str(resolved.resolved_file_name),
                    ],
                );
            }

            if !error_node.is_nil() {
                if resolved.resolved_using_ts_extension
                    && is_declaration_file_name(module_reference)
                {
                    if !find_ancestor(a, location, |node| is_emittable_import(a, node)).is_nil() {
                        let ts_extension = try_extract_ts_extension(module_reference);
                        if ts_extension.is_empty() {
                            let _: () = self.fail("should be able to extract TS extension from string that passes IsDeclarationFileName");
                        } else {
                            let suggested_import_source = self.get_suggested_import_source(
                                module_reference,
                                ts_extension,
                                mode,
                            );
                            self.error(
                                error_node,
                                diagnostics::A_DECLARATION_FILE_CANNOT_BE_IMPORTED_WITHOUT_IMPORT_TYPE_DID_YOU_MEAN_TO_IMPORT_AN_IMPLEMENTATION_FILE_0_INSTEAD,
                                &[Arg::Str(&suggested_import_source)],
                            );
                        }
                    }
                } else if resolved.resolved_using_ts_extension
                    && !self.compiler_options.allow_importing_ts_extensions_from(
                        a.as_source_file(importing_source_file).file_name(),
                    )
                {
                    if !find_ancestor(a, location, |node| is_emittable_import(a, node)).is_nil() {
                        let mut ts_extension = try_extract_ts_extension(module_reference);
                        if ts_extension.is_empty() {
                            // Fallback: do a best-effort extraction using strings.Contains. This handles cases where a wildcard pattern matches a TS extension that's not at the end of the module specifier, e.g., "#/foo.ts.omg" through "#/*.omg": "./src/*"
                            for &ext in SUPPORTED_TS_EXTENSIONS_FLAT {
                                if strings::contains(module_reference, ext) {
                                    ts_extension = ext;
                                    break;
                                }
                            }
                        }
                        if ts_extension.is_empty() {
                            let _: () = self.fail("should be able to extract TS extension from string when resolvedUsingTsExtension is true");
                        } else {
                            self.error(
                                error_node,
                                diagnostics::AN_IMPORT_PATH_CAN_ONLY_END_WITH_A_0_EXTENSION_WHEN_ALLOWIMPORTINGTSEXTENSIONS_IS_ENABLED,
                                &[Arg::Str(ts_extension)],
                            );
                        }
                    }
                } else if self
                    .compiler_options
                    .rewrite_relative_import_extensions
                    .is_true()
                    && !a.flags(location).intersects(NodeFlags::AMBIENT)
                    && !is_declaration_file_name(module_reference)
                    && !is_literal_import_type_node(a, location)
                    && !is_part_of_type_only_import_or_export_declaration(a, location)
                {
                    let should_rewrite =
                        should_rewrite_module_specifier(module_reference, self.compiler_options);
                    if !resolved.resolved_using_ts_extension && should_rewrite {
                        let relative_to_source_file = relative_path(
                            self,
                            get_relative_path_from_file(
                                &get_normalized_absolute_path(
                                    a.as_source_file(importing_source_file).file_name(),
                                    program.get_current_directory(),
                                ),
                                resolved.resolved_file_name,
                                ComparePathsOptions {
                                    use_case_sensitive_file_names: program
                                        .use_case_sensitive_file_names(),
                                    current_directory: program.get_current_directory(),
                                },
                            ),
                        );
                        self.error(
                            error_node,
                            diagnostics::THIS_RELATIVE_IMPORT_PATH_IS_UNSAFE_TO_REWRITE_BECAUSE_IT_LOOKS_LIKE_A_FILE_NAME_BUT_ACTUALLY_RESOLVES_TO_0,
                            &[Arg::Str(&relative_to_source_file)],
                        );
                    } else if resolved.resolved_using_ts_extension
                        && !should_rewrite
                        && program.source_file_may_be_emitted(source_file, false)
                    {
                        let extension = get_any_extension_from_path(module_reference, &[], false);
                        self.error(
                            error_node,
                            diagnostics::THIS_IMPORT_USES_A_0_EXTENSION_TO_RESOLVE_TO_AN_INPUT_TYPESCRIPT_FILE_BUT_WILL_NOT_BE_REWRITTEN_DURING_EMIT_BECAUSE_IT_IS_NOT_A_RELATIVE_PATH,
                            &[Arg::Str(&extension)],
                        );
                    } else if resolved.resolved_using_ts_extension && should_rewrite {
                        if let Some(redirect) = program.get_redirect_for_resolution(source_file) {
                            let own_root_dir = program.common_source_directory();
                            let other_root_dir = redirect.common_source_directory();

                            let compare_options = ComparePathsOptions {
                                use_case_sensitive_file_names: program
                                    .use_case_sensitive_file_names(),
                                current_directory: program.get_current_directory(),
                            };

                            let root_dir_path = relative_path(
                                self,
                                get_relative_path_from_directory(
                                    own_root_dir,
                                    other_root_dir,
                                    compare_options,
                                ),
                            );

                            // Get outDir paths, defaulting to root directories if not specified
                            let mut own_out_dir: &[u8] = &self.compiler_options.out_dir;
                            if own_out_dir.is_empty() {
                                own_out_dir = own_root_dir;
                            }
                            let mut other_out_dir: &[u8] = &redirect.compiler_options().out_dir;
                            if other_out_dir.is_empty() {
                                other_out_dir = other_root_dir;
                            }
                            let out_dir_path = relative_path(
                                self,
                                get_relative_path_from_directory(
                                    own_out_dir,
                                    other_out_dir,
                                    compare_options,
                                ),
                            );

                            if root_dir_path != out_dir_path {
                                self.error(
                                    error_node,
                                    diagnostics::THIS_IMPORT_PATH_IS_UNSAFE_TO_REWRITE_BECAUSE_IT_RESOLVES_TO_ANOTHER_PROJECT_AND_THE_RELATIVE_PATH_BETWEEN_THE_PROJECTS_OUTPUT_FILES_IS_NOT_THE_SAME_AS_THE_RELATIVE_PATH_BETWEEN_ITS_INPUT_FILES,
                                    &[],
                                );
                            }
                        }
                    }
                }
            }

            if !a.symbol(source_file).is_nil() {
                if !error_node.is_nil() {
                    if resolved.is_external_library_import
                        && !resolution_extension_is_ts_or_json(resolved.extension)
                    {
                        self.error_on_implicit_any_module(
                            false,
                            error_node,
                            mode,
                            &resolved,
                            module_reference,
                        );
                    }
                    if self.module_kind == ModuleKind::NODE16
                        || self.module_kind == ModuleKind::NODE18
                    {
                        let is_sync_import = program
                            .get_default_resolution_mode_for_file(importing_source_file)
                            == ModuleKind::COMMON_JS
                            && find_ancestor(a, location, |node| is_import_call(a, node)).is_nil()
                            || !find_ancestor(a, location, |node| {
                                is_import_equals_declaration(a, node)
                            })
                            .is_nil();
                        let override_host = find_ancestor(a, location, |node| {
                            is_resolution_mode_override_host(a, node)
                        });
                        if is_sync_import
                            && program.get_default_resolution_mode_for_file(source_file)
                                == ModuleKind::ES_NEXT
                            && !has_resolution_mode_override(a, override_host)
                        {
                            if !find_ancestor_kind(a, location, Kind::ImportEqualsDeclaration)
                                .is_nil()
                            {
                                // ImportEquals in an ESM file resolving to another ESM file
                                self.error(
                                    error_node,
                                    diagnostics::MODULE_0_CANNOT_BE_IMPORTED_USING_THIS_CONSTRUCT_THE_SPECIFIER_ONLY_RESOLVES_TO_AN_ES_MODULE_WHICH_CANNOT_BE_IMPORTED_WITH_REQUIRE_USE_AN_ECMASCRIPT_IMPORT_INSTEAD,
                                    &[Arg::Str(module_reference)],
                                );
                            } else {
                                // CJS file resolving to an ESM file
                                let mut diagnostic_details = DiagnosticId::NIL;
                                let ext = try_get_extension_from_path(
                                    a.as_source_file(importing_source_file).file_name(),
                                );
                                if ext == EXTENSION_TS
                                    || ext == EXTENSION_JS
                                    || ext == EXTENSION_TSX
                                    || ext == EXTENSION_JSX
                                {
                                    diagnostic_details = self.create_mode_mismatch_details(
                                        importing_source_file,
                                        error_node,
                                    );
                                }

                                let message = if !override_host.is_nil()
                                    && a.kind(override_host) == Kind::ImportDeclaration
                                    && !a.import_clause(override_host).is_nil()
                                    && a.is_type_only(a.import_clause(override_host))
                                {
                                    diagnostics::TYPE_ONLY_IMPORT_OF_AN_ECMASCRIPT_MODULE_FROM_A_COMMONJS_MODULE_MUST_HAVE_A_RESOLUTION_MODE_ATTRIBUTE
                                } else if !override_host.is_nil()
                                    && a.kind(override_host) == Kind::ImportType
                                {
                                    diagnostics::TYPE_IMPORT_OF_AN_ECMASCRIPT_MODULE_FROM_A_COMMONJS_MODULE_MUST_HAVE_A_RESOLUTION_MODE_ATTRIBUTE
                                } else {
                                    diagnostics::THE_CURRENT_FILE_IS_A_COMMONJS_MODULE_WHOSE_IMPORTS_WILL_PRODUCE_REQUIRE_CALLS_HOWEVER_THE_REFERENCED_FILE_IS_AN_ECMASCRIPT_MODULE_AND_CANNOT_BE_IMPORTED_WITH_REQUIRE_CONSIDER_WRITING_A_DYNAMIC_IMPORT_0_CALL_INSTEAD
                                };

                                let diagnostic = self.new_diagnostic_chain_for_node(
                                    diagnostic_details,
                                    error_node,
                                    message,
                                    &[Arg::Str(module_reference)],
                                );
                                self.add_diagnostic(diagnostic);
                            }
                        }
                    }
                }
                return self.get_merged_symbol(a.symbol(source_file));
            }
            if !error_node.is_nil()
                && !module_not_found_error.is_nil()
                && !is_side_effect_import(a, error_node)
            {
                self.error(
                    error_node,
                    diagnostics::FILE_0_IS_NOT_A_MODULE,
                    &[Arg::Str(resolved.resolved_file_name)],
                );
            }
            return SymbolId::NIL;
        }

        if !self.pattern_ambient_modules.is_empty() {
            let pattern_symbol = find_best_pattern_match(
                &self.pattern_ambient_modules,
                |module| &module.pattern,
                module_reference,
            )
            .map(|module| module.symbol);
            if let Some(pattern_symbol) = pattern_symbol {
                let augmentation =
                    a.table_get(self.pattern_ambient_module_augmentations, module_reference);
                if !augmentation.is_nil() {
                    return self.get_merged_symbol(augmentation);
                }
                return self.get_merged_symbol(pattern_symbol);
            }
        }

        if error_node.is_nil() {
            return SymbolId::NIL;
        }

        if is_resolved
            && !resolution_extension_is_ts_or_json(resolved.extension)
            && resolution_diagnostic.is_nil()
            || resolution_diagnostic
                == diagnostics::COULD_NOT_FIND_A_DECLARATION_FILE_FOR_MODULE_0_1_IMPLICITLY_HAS_AN_ANY_TYPE
        {
            if is_for_augmentation {
                self.error(
                    error_node,
                    diagnostics::INVALID_MODULE_NAME_IN_AUGMENTATION_MODULE_0_RESOLVES_TO_AN_UNTYPED_MODULE_AT_1_WHICH_CANNOT_BE_AUGMENTED,
                    &[
                        Arg::Str(module_reference),
                        Arg::Str(resolved.resolved_file_name),
                    ],
                );
            } else {
                self.error_on_implicit_any_module(
                    self.no_implicit_any && !module_not_found_error.is_nil(),
                    error_node,
                    mode,
                    &resolved,
                    module_reference,
                );
            }
            return SymbolId::NIL;
        }

        if !module_not_found_error.is_nil() {
            // See if this was possibly a projectReference redirect
            if is_resolved {
                let resolved_path = to_path(
                    resolved.resolved_file_name,
                    program.get_current_directory(),
                    program.use_case_sensitive_file_names(),
                );
                if let Some(redirect) = program.get_project_reference_from_source(&resolved_path) {
                    if !redirect.output_dts.is_empty() {
                        self.error(
                            error_node,
                            diagnostics::OUTPUT_FILE_0_HAS_NOT_BEEN_BUILT_FROM_SOURCE_FILE_1,
                            &[
                                Arg::Str(&redirect.output_dts),
                                Arg::Str(resolved.resolved_file_name),
                            ],
                        );
                        return SymbolId::NIL;
                    }
                }
            }

            if !resolution_diagnostic.is_nil() {
                self.error(
                    error_node,
                    resolution_diagnostic,
                    &[
                        Arg::Str(module_reference),
                        Arg::Str(resolved.resolved_file_name),
                    ],
                );
            } else {
                let is_extensionless_relative_path_import =
                    path_is_relative(module_reference) && !has_extension(module_reference);
                let resolution_is_node16_or_next = self.module_resolution_kind
                    == ModuleResolutionKind::NODE16
                    || self.module_resolution_kind == ModuleResolutionKind::NODE_NEXT;
                if !self.compiler_options.get_resolve_json_module()
                    && file_extension_is(module_reference, EXTENSION_JSON)
                {
                    self.error(
                        error_node,
                        diagnostics::CANNOT_FIND_MODULE_0_CONSIDER_USING_RESOLVEJSONMODULE_TO_IMPORT_MODULE_WITH_JSON_EXTENSION,
                        &[Arg::Str(module_reference)],
                    );
                } else if mode == RESOLUTION_MODE_ESM
                    && resolution_is_node16_or_next
                    && is_extensionless_relative_path_import
                {
                    let absolute_ref = get_normalized_absolute_path(
                        module_reference,
                        &get_directory_path(a.as_source_file(importing_source_file).file_name()),
                    );
                    let suggested_ext = self.get_suggested_import_extension(&absolute_ref);
                    if !suggested_ext.is_empty() {
                        let suggested_reference = [module_reference, suggested_ext].concat();
                        self.error(
                            error_node,
                            diagnostics::RELATIVE_IMPORT_PATHS_NEED_EXPLICIT_FILE_EXTENSIONS_IN_ECMASCRIPT_IMPORTS_WHEN_MODULERESOLUTION_IS_NODE16_OR_NODENEXT_DID_YOU_MEAN_0,
                            &[Arg::Str(&suggested_reference)],
                        );
                    } else {
                        self.error(
                            error_node,
                            diagnostics::RELATIVE_IMPORT_PATHS_NEED_EXPLICIT_FILE_EXTENSIONS_IN_ECMASCRIPT_IMPORTS_WHEN_MODULERESOLUTION_IS_NODE16_OR_NODENEXT_CONSIDER_ADDING_AN_EXTENSION_TO_THE_IMPORT_PATH,
                            &[],
                        );
                    }
                } else if resolved_module.is_some() && !resolved.alternate_result.is_empty() {
                    let error_info = self.create_module_not_found_chain(
                        &resolved,
                        error_node,
                        module_reference,
                        mode,
                        module_reference,
                    );
                    let diagnostic = self.new_diagnostic_chain_for_node(
                        error_info,
                        error_node,
                        module_not_found_error,
                        &[Arg::Str(module_reference)],
                    );
                    self.add_diagnostic(diagnostic);
                } else {
                    self.error(
                        error_node,
                        module_not_found_error,
                        &[Arg::Str(module_reference)],
                    );
                }
            }
        }

        SymbolId::NIL
    }
}

pub fn resolution_extension_is_ts_or_json(ext: &[u8]) -> bool {
    extension_is_ts(ext) || ext == EXTENSION_JSON
}

impl<'a> Checker<'a> {
    pub fn get_suggested_import_source(
        &self,
        module_reference: &[u8],
        ts_extension: &[u8],
        mode: ResolutionMode,
    ) -> Vec<u8> {
        let import_source_without_extension = remove_extension(module_reference, ts_extension);

        // Direct users to import source with .js extension if outputting an ES module. @see https://github.com/microsoft/TypeScript/issues/42151
        if self.module_kind.is_non_node_esm() || mode == ModuleKind::ES_NEXT {
            let prefer_ts = is_declaration_file_name(module_reference)
                && self.compiler_options.get_allow_importing_ts_extensions();
            let ext = if ts_extension == EXTENSION_MTS || ts_extension == EXTENSION_DMTS {
                if_else::<&[u8]>(prefer_ts, b".mts", b".mjs")
            } else if ts_extension == EXTENSION_CTS || ts_extension == EXTENSION_DCTS {
                if_else::<&[u8]>(prefer_ts, b".cts", b".cjs")
            } else {
                if_else::<&[u8]>(prefer_ts, b".ts", b".js")
            };

            return [import_source_without_extension, ext].concat();
        }

        import_source_without_extension.to_vec()
    }

    pub fn get_suggested_import_extension(
        &self,
        extensionless_import_path: &[u8],
    ) -> &'static [u8] {
        let file_exists = |extension: &[u8]| {
            self.program
                .file_exists(&[extensionless_import_path, extension].concat())
        };
        if file_exists(b".mts") {
            return b".mjs";
        }
        if file_exists(b".ts") {
            return b".js";
        }
        if file_exists(b".cts") {
            return b".cjs";
        }
        if file_exists(b".mjs") {
            return b".mjs";
        }
        if file_exists(b".js") {
            return b".js";
        }
        if file_exists(b".cjs") {
            return b".cjs";
        }
        if file_exists(b".tsx") {
            return if_else::<&'static [u8]>(
                self.compiler_options.jsx == JsxEmit::PRESERVE,
                b".jsx",
                b".js",
            );
        }
        if file_exists(b".jsx") {
            return b".jsx";
        }
        if file_exists(b".json") {
            return b".json";
        }
        b""
    }

    pub fn error_on_implicit_any_module(
        &mut self,
        is_error: bool,
        error_node: NodeId,
        mode: ResolutionMode,
        resolved_module: &ResolvedModule<'_>,
        module_reference: &[u8],
    ) {
        let a = self.ast;
        if is_side_effect_import(a, error_node) {
            return;
        }

        let mut error_info = DiagnosticId::NIL;
        if !is_external_module_name_relative(module_reference)
            && !resolved_module.package_id.name.is_empty()
        {
            error_info = self.create_module_not_found_chain(
                resolved_module,
                error_node,
                module_reference,
                mode,
                resolved_module.package_id.name,
            );
        }
        let diagnostic = self.new_diagnostic_chain_for_node(
            error_info,
            error_node,
            diagnostics::COULD_NOT_FIND_A_DECLARATION_FILE_FOR_MODULE_0_1_IMPLICITLY_HAS_AN_ANY_TYPE,
            &[
                Arg::Str(module_reference),
                Arg::Str(resolved_module.resolved_file_name),
            ],
        );
        self.add_error_or_suggestion(is_error, diagnostic);
    }

    // Upstream does not read `resolvedModule` either.
    pub fn create_module_not_found_chain(
        &mut self,
        _resolved_module: &ResolvedModule<'_>,
        error_node: NodeId,
        module_reference: &[u8],
        mode: ResolutionMode,
        package_name: &[u8],
    ) -> DiagnosticId {
        let a = self.ast;
        // Store the original packageName for repopulateInfo before any modifications
        let mut stored_package_name = package_name;
        if stored_package_name == module_reference {
            stored_package_name = b"";
        }

        let details = create_module_not_found_chain(
            self.program,
            get_source_file_of_node(a, error_node),
            module_reference,
            mode,
            package_name,
        );
        let args: Vec<Arg<'_>> = details.args.iter().map(|arg| Arg::Str(arg)).collect();
        let result = self.new_diagnostic_for_node(error_node, details.message, &args);
        self.diagnostic_store[result].set_repopulate_info(RepopulateDiagnosticInfo {
            kind: RepopulateDiagnosticKind::MODULE_NOT_FOUND,
            module_reference: module_reference.to_vec(),
            mode,
            package_name: stored_package_name.to_vec(),
        });
        result
    }

    pub fn create_mode_mismatch_details(
        &mut self,
        source_file: NodeId,
        error_node: NodeId,
    ) -> DiagnosticId {
        let details = create_mode_mismatch_details(self.ast, self.program, source_file);
        let args: Vec<Arg<'_>> = details.args.iter().map(|arg| Arg::Str(arg)).collect();
        let result = self.new_diagnostic_for_node(error_node, details.message, &args);
        self.diagnostic_store[result].set_repopulate_info(RepopulateDiagnosticInfo {
            kind: RepopulateDiagnosticKind::MODE_MISMATCH,
            ..RepopulateDiagnosticInfo::default()
        });
        result
    }

    pub fn try_find_ambient_module(
        &mut self,
        module_name: &[u8],
        with_augmentations: bool,
    ) -> SymbolId {
        if is_external_module_name_relative(module_name) {
            return SymbolId::NIL;
        }
        let quoted_name = [b"\"".as_slice(), module_name, b"\"".as_slice()].concat();
        let globals = self.globals;
        let symbol = self.get_symbol(globals, &quoted_name, SymbolFlags::VALUE_MODULE);
        // merged symbol is module declaration symbol combined with all augmentations
        if with_augmentations {
            return self.get_merged_symbol(symbol);
        }
        symbol
    }

    pub fn get_ambient_modules(&mut self) -> List<'a, SymbolId> {
        if !self.ambient_modules.done {
            let a = self.ast;
            let mut ambient_modules: Vec<SymbolId> = Vec::new();
            // Upstream ranges over the globals (a map): the table is walked in its own order.
            let mut position = 0;
            while let Some((sym, global)) = a.table_entry_at(self.globals, position) {
                position += 1;
                if sym.starts_with(b"\"") && sym.ends_with(b"\"") {
                    ambient_modules.push(global);
                }
            }
            // The list stays nil when no global is an ambient module, as upstream's append leaves it.
            if !ambient_modules.is_empty() {
                self.ambient_modules.value = self.list_of(&ambient_modules);
            }
            self.ambient_modules.done = true;
        }
        self.ambient_modules.value
    }

    pub fn resolve_external_module_symbol(
        &mut self,
        module_symbol: SymbolId,
        dont_resolve_alias: bool,
    ) -> SymbolId {
        let a = self.ast;
        if !module_symbol.is_nil() {
            let export_equals = self.resolve_symbol_ex(
                a.table_get(
                    a.sym(module_symbol).exports,
                    INTERNAL_SYMBOL_NAME_EXPORT_EQUALS,
                ),
                dont_resolve_alias,
            );
            if !export_equals.is_nil() {
                return self.get_merged_symbol(export_equals);
            }
        }
        module_symbol
    }

    // Resolves the given external module symbol, possibly removing call and construct signatures or creating a wrapper module with a synthetic default.
    pub fn resolve_es_module_symbol(
        &mut self,
        module_symbol: SymbolId,
        node: NodeId,
        module_specifier: NodeId,
    ) -> SymbolId {
        let a = self.ast;
        let mut symbol = self.resolve_external_module_symbol(module_symbol, true);
        if is_non_local_alias(
            a,
            symbol,
            SymbolFlags::VALUE | SymbolFlags::TYPE | SymbolFlags::NAMESPACE,
        ) {
            // When the module has an export= with a pure alias, we transitively resolve and propagate any typeOnlyDeclaration
            let source = self.get_symbol_of_declaration(node);
            let resolved = self.resolve_indirection_alias(source, symbol);
            symbol = self.get_merged_symbol(resolved);
        }
        if !symbol.is_nil() {
            let reference_parent = a.parent(module_specifier);
            let mut namespace_import = NodeId::NIL;
            if is_import_declaration(a, reference_parent) {
                namespace_import = get_namespace_declaration_node(a, reference_parent);
            }
            if !namespace_import.is_nil() || is_import_call(a, reference_parent) {
                let reference = if is_import_call(a, reference_parent) {
                    a.arguments(reference_parent).at(0usize)
                } else {
                    a.module_specifier(reference_parent)
                };
                let typ = self.get_type_of_symbol(symbol);
                let default_only_type = self.get_type_with_synthetic_default_only(
                    typ,
                    symbol,
                    module_symbol,
                    reference,
                );
                if !default_only_type.is_nil() {
                    return self.clone_type_as_module_type(
                        symbol,
                        default_only_type,
                        reference_parent,
                    );
                }

                let target_file = find(
                    a.sym(module_symbol).declarations.as_slice(),
                    |declaration| is_source_file(a, declaration),
                );
                let usage_mode = self.get_emit_syntax_for_module_specifier_expression(reference);
                let mut export_module_dot_exports_symbol = SymbolId::NIL;
                if !namespace_import.is_nil()
                    && !target_file.is_nil()
                    && ModuleKind::NODE20 <= self.module_kind
                    && self.module_kind <= ModuleKind::NODE_NEXT
                    && usage_mode == ModuleKind::COMMON_JS
                    && self.program.get_implied_node_format_for_emit(target_file)
                        == ModuleKind::ES_NEXT
                {
                    export_module_dot_exports_symbol = self.get_export_of_module(
                        symbol,
                        INTERNAL_SYMBOL_NAME_MODULE_EXPORTS,
                        namespace_import,
                        true,
                    );
                }
                if !export_module_dot_exports_symbol.is_nil() {
                    if self.has_signatures(typ) {
                        return self.clone_type_as_module_type(
                            export_module_dot_exports_symbol,
                            typ,
                            reference_parent,
                        );
                    }
                    return export_module_dot_exports_symbol;
                }

                let is_esm_cjs_ref = !target_file.is_nil()
                    && is_esm_format_import_importing_commonjs_format_file(
                        usage_mode,
                        self.program.get_implied_node_format_for_emit(target_file),
                    );
                if self.has_signatures(typ)
                    || !self
                        .get_property_of_type_ex(typ, INTERNAL_SYMBOL_NAME_DEFAULT, true, false)
                        .is_nil()
                    || is_esm_cjs_ref
                {
                    let module_type =
                        if self.types[typ].flags.intersects(TypeFlags::STRUCTURED_TYPE) {
                            self.get_type_with_synthetic_default_import_type(
                                typ,
                                symbol,
                                module_symbol,
                                reference,
                            )
                        } else {
                            self.create_default_property_wrapper_for_module(
                                symbol,
                                a.sym(symbol).parent,
                                SymbolId::NIL,
                            )
                        };
                    return self.clone_type_as_module_type(symbol, module_type, reference_parent);
                }
            }
        }
        symbol
    }

    pub fn has_signatures(&mut self, t: TypeId) -> bool {
        self.get_signatures_of_structured_type(t, SignatureKind::CALL)
            .len()
            > 0
            || self
                .get_signatures_of_structured_type(t, SignatureKind::CONSTRUCT)
                .len()
                > 0
    }
}

pub fn is_esm_format_import_importing_commonjs_format_file(
    usage_mode: ResolutionMode,
    target_mode: ResolutionMode,
) -> bool {
    usage_mode == ModuleKind::ES_NEXT && target_mode == ModuleKind::COMMON_JS
}

impl<'a> Checker<'a> {
    pub fn get_type_with_synthetic_default_only(
        &mut self,
        t: TypeId,
        symbol: SymbolId,
        original_symbol: SymbolId,
        module_specifier: NodeId,
    ) -> TypeId {
        let has_default_only = self.is_only_importable_as_default(module_specifier, SymbolId::NIL);
        if has_default_only && !t.is_nil() && !self.is_error_type(t) {
            let key = CachedTypeKey {
                kind: CachedTypeKind::DEFAULT_ONLY_TYPE,
                type_id: t,
            };
            let cached = self.cached_types.get(&key);
            if !cached.is_nil() {
                return cached;
            }
            let result = self.create_default_property_wrapper_for_module(
                symbol,
                original_symbol,
                SymbolId::NIL,
            );
            let ok = self.cached_types.set(key, result);
            self.map_set(ok);
            return result;
        }
        TypeId::NIL
    }

    pub fn get_type_with_synthetic_default_import_type(
        &mut self,
        t: TypeId,
        symbol: SymbolId,
        original_symbol: SymbolId,
        module_specifier: NodeId,
    ) -> TypeId {
        let a = self.ast;
        if !t.is_nil() && !self.is_error_type(t) {
            let key = CachedTypeKey {
                kind: CachedTypeKind::SYNTHETIC_TYPE,
                type_id: t,
            };
            let cached = self.cached_types.get(&key);
            if !cached.is_nil() {
                return cached;
            }
            let file = find(
                a.sym(original_symbol).declarations.as_slice(),
                |declaration| is_source_file(a, declaration),
            );
            let has_synthetic_default =
                self.can_have_synthetic_default(file, original_symbol, false, module_specifier);
            let synthetic_type;
            if has_synthetic_default {
                let anonymous_symbol =
                    self.new_symbol(SymbolFlags::TYPE_LITERAL, INTERNAL_SYMBOL_NAME_TYPE);
                let declarations = a.sym(original_symbol).declarations;
                a.update_symbol(anonymous_symbol, |s| s.declarations = declarations);
                let default_containing_object = self.create_default_property_wrapper_for_module(
                    symbol,
                    original_symbol,
                    anonymous_symbol,
                );
                let links = self.value_symbol_links_get(anonymous_symbol);
                self.value_symbol_links[links].resolved_type = default_containing_object;
                if self.is_valid_spread_type(t) {
                    synthetic_type = self.get_spread_type(
                        t,
                        default_containing_object,
                        anonymous_symbol,
                        ObjectFlags::NONE,
                        false,
                    );
                } else {
                    synthetic_type = default_containing_object;
                }
            } else {
                synthetic_type = t;
            }
            let ok = self.cached_types.set(key, synthetic_type);
            self.map_set(ok);
            return synthetic_type;
        }
        t
    }

    pub fn is_common_js_require(&mut self, node: NodeId) -> bool {
        let a = self.ast;
        if !is_require_call(a, node, true) {
            return false;
        }
        if !is_identifier(a, a.expression(node)) {
            return self.fail("Expected identifier for require call");
        }
        // Make sure require is not a local function
        let resolved_require = self.resolve_name(
            a.expression(node),
            a.text(a.expression(node)),
            SymbolFlags::VALUE,
            MessageId::NIL,
            true,
            false,
        );
        if resolved_require == self.require_symbol {
            return true;
        }
        // project includes symbol named 'require' - make sure that it is ambient and local non-alias
        if resolved_require.is_nil() || a.sym(resolved_require).flags.intersects(SymbolFlags::ALIAS)
        {
            return false;
        }

        let target_declaration_kind = if a
            .sym(resolved_require)
            .flags
            .intersects(SymbolFlags::FUNCTION)
        {
            Kind::FunctionDeclaration
        } else if a
            .sym(resolved_require)
            .flags
            .intersects(SymbolFlags::VARIABLE)
        {
            Kind::VariableDeclaration
        } else {
            Kind::Unknown
        };
        if target_declaration_kind != Kind::Unknown {
            let decl = get_declaration_of_kind(a, resolved_require, target_declaration_kind);
            // function/variable declaration should be ambient
            return !decl.is_nil() && a.flags(decl).intersects(NodeFlags::AMBIENT);
        }
        false
    }

    pub fn create_default_property_wrapper_for_module(
        &mut self,
        symbol: SymbolId,
        original_symbol: SymbolId,
        anonymous_symbol: SymbolId,
    ) -> TypeId {
        let a = self.ast;
        let mut anonymous_symbol = anonymous_symbol;
        let member_table = a.new_table();
        let new_symbol = self.new_symbol(SymbolFlags::ALIAS, INTERNAL_SYMBOL_NAME_DEFAULT);
        a.update_symbol(new_symbol, |s| s.parent = original_symbol);
        let value_links = self.value_symbol_links_get(new_symbol);
        let name_type = self.get_string_literal_type(b"default");
        self.value_symbol_links[value_links].name_type = name_type;
        let alias_links = self.alias_symbol_links.get(new_symbol);
        let alias_target = self.resolve_symbol(symbol);
        self.alias_symbol_links[alias_links].alias_target = alias_target;
        a.table_set(member_table, INTERNAL_SYMBOL_NAME_DEFAULT, new_symbol);
        if anonymous_symbol.is_nil() && !original_symbol.is_nil() {
            anonymous_symbol =
                self.new_symbol(SymbolFlags::OBJECT_LITERAL, INTERNAL_SYMBOL_NAME_OBJECT);
            let declarations = a.sym(original_symbol).declarations;
            a.update_symbol(anonymous_symbol, |s| s.declarations = declarations);
        }
        self.new_anonymous_type(
            anonymous_symbol,
            member_table,
            List::NIL,
            List::NIL,
            List::NIL,
        )
    }

    pub fn clone_type_as_module_type(
        &mut self,
        symbol: SymbolId,
        module_type: TypeId,
        reference_parent: NodeId,
    ) -> SymbolId {
        let a = self.ast;
        let source = a.sym(symbol);
        let result = self.new_symbol(source.flags, source.name);
        let members = a.table_clone(source.members);
        let exports = a.table_clone(source.exports);
        a.update_symbol(result, |s| {
            // `slices.Clone(symbol.Declarations)`: a list is never written in place here, so the clone shares it.
            s.declarations = source.declarations;
            s.value_declaration = source.value_declaration;
            s.members = members;
            s.exports = exports;
            s.parent = source.parent;
        });
        let links = self.export_type_links.get(result);
        self.export_type_links[links].target = symbol;
        self.export_type_links[links].originating_import = reference_parent;
        self.resolve_structured_type_members(module_type);
        let value_links = self.value_symbol_links_get(result);
        let resolved_module_type = self.as_structured_type(module_type);
        let (resolved_members, resolved_index_infos) = (
            resolved_module_type.members,
            resolved_module_type.index_infos,
        );
        let resolved_type = self.new_anonymous_type(
            result,
            resolved_members,
            List::NIL,
            List::NIL,
            resolved_index_infos,
        );
        self.value_symbol_links[value_links].resolved_type = resolved_type;
        result
    }
}
