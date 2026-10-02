// checker.go:13991-14168 (layers N-RESOLVE, D-SINK): the resolved symbol of an identifier, the value or alias symbol of a reference, the message for a name that is not found, and the diagnostics of the checker: its two collections, the deferred callbacks, error and its variants, the deprecation suggestions.
use crate::ast::{
    Arg, Ast, DiagnosticId, Diagnostics, File, Kind, NodeId, SourceFiles, SymbolFlags, SymbolId,
    get_jsdoc_deprecated_tag, is_call_expression, is_deprecated_declaration_with_cached_flags,
    is_write_only_access, node_is_missing,
};
use crate::checker::{Checker, DeferredDiagnosticCallback, MAX_SERIALIZATION_LEVEL};
use crate::core::{List, every, if_else, or_else, some};
use crate::diagnostics::{self, Category, MessageId};

// What the diagnostics read of a file, answered by the node table: its names and its text. The line map of a file is `File::ecma_line_map`, whose positions are `TextPos`.
pub struct ProgramFiles<'a> {
    pub ast: Ast<'a>,
}

impl SourceFiles for ProgramFiles<'_> {
    fn file_name(&self, file: NodeId) -> &[u8] {
        match self.find(file) {
            Some(f) => &f.source_file.file_name,
            None => b"",
        }
    }
    fn path(&self, file: NodeId) -> &[u8] {
        match self.find(file) {
            Some(f) => &f.source_file.path.0,
            None => b"",
        }
    }
    fn text(&self, file: NodeId) -> &[u8] {
        match self.find(file) {
            Some(f) => f.source_text(),
            None => b"",
        }
    }
    fn ecma_line_map(&self, _: NodeId) -> &[i32] {
        &[]
    }
}

impl<'a> ProgramFiles<'a> {
    // The file whose root is `file`: none for the nil node and for a node that is not the root of a file of the program.
    fn find(&self, file: NodeId) -> Option<&'a File> {
        self.ast
            .file_of(file)
            .filter(|f| f.source_file.root == file)
    }
}

// The `*ast.DiagnosticsCollection` that getDiagnostics is given and compares by pointer: one of the two collections of the checker.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum DiagnosticsCollectionKind {
    Diagnostics,
    SuggestionDiagnostics,
}

impl<'a> Checker<'a> {
    pub fn get_resolved_symbol(&mut self, node: NodeId) -> SymbolId {
        let a = self.ast;
        let links = self.symbol_node_links.get(node);
        if self.symbol_node_links[links].resolved_symbol.is_nil() {
            let mut symbol = SymbolId::NIL;
            if !node_is_missing(a, node) {
                let name_not_found_message = self.get_cannot_find_name_diagnostic_for_name(node);
                symbol = self.resolve_name(
                    node,
                    a.text(node),
                    SymbolFlags::VALUE | SymbolFlags::EXPORT_VALUE,
                    name_not_found_message,
                    !is_write_only_access(a, node),
                    false,
                );
            }
            self.symbol_node_links[links].resolved_symbol = or_else(symbol, self.unknown_symbol);
        }
        self.symbol_node_links[links].resolved_symbol
    }

    pub fn get_resolved_symbol_or_nil(&mut self, node: NodeId) -> SymbolId {
        let links = self.symbol_node_links.get(node);
        self.symbol_node_links[links].resolved_symbol
    }

    pub fn get_referenced_value_or_alias_symbol(&mut self, reference: NodeId) -> SymbolId {
        let a = self.ast;
        let links = self.symbol_node_links.get(reference);
        let resolved_symbol = self.symbol_node_links[links].resolved_symbol;
        if !resolved_symbol.is_nil() && resolved_symbol != self.unknown_symbol {
            return resolved_symbol;
        }
        self.resolve_name(
            reference,
            a.text(reference),
            SymbolFlags::VALUE | SymbolFlags::EXPORT_VALUE | SymbolFlags::ALIAS,
            MessageId::NIL,
            false,
            false,
        )
    }

    pub fn get_cannot_find_name_diagnostic_for_name(&self, node: NodeId) -> MessageId {
        let a = self.ast;
        match a.text(node) {
            b"document" | b"console" => {
                diagnostics::CANNOT_FIND_NAME_0_DO_YOU_NEED_TO_CHANGE_YOUR_TARGET_LIBRARY_TRY_CHANGING_THE_LIB_COMPILER_OPTION_TO_INCLUDE_DOM
            }
            b"$" => if_else(
                self.compiler_options.uses_wildcard_types(),
                diagnostics::CANNOT_FIND_NAME_0_DO_YOU_NEED_TO_INSTALL_TYPE_DEFINITIONS_FOR_JQUERY_TRY_NPM_I_SAVE_DEV_TYPES_SLASHJQUERY,
                diagnostics::CANNOT_FIND_NAME_0_DO_YOU_NEED_TO_INSTALL_TYPE_DEFINITIONS_FOR_JQUERY_TRY_NPM_I_SAVE_DEV_TYPES_SLASHJQUERY_AND_THEN_ADD_JQUERY_TO_THE_TYPES_FIELD_IN_YOUR_TSCONFIG,
            ),
            b"beforeEach" | b"describe" | b"suite" | b"it" | b"test" => if_else(
                self.compiler_options.uses_wildcard_types(),
                diagnostics::CANNOT_FIND_NAME_0_DO_YOU_NEED_TO_INSTALL_TYPE_DEFINITIONS_FOR_A_TEST_RUNNER_TRY_NPM_I_SAVE_DEV_TYPES_SLASHJEST_OR_NPM_I_SAVE_DEV_TYPES_SLASHMOCHA,
                diagnostics::CANNOT_FIND_NAME_0_DO_YOU_NEED_TO_INSTALL_TYPE_DEFINITIONS_FOR_A_TEST_RUNNER_TRY_NPM_I_SAVE_DEV_TYPES_SLASHJEST_OR_NPM_I_SAVE_DEV_TYPES_SLASHMOCHA_AND_THEN_ADD_JEST_OR_MOCHA_TO_THE_TYPES_FIELD_IN_YOUR_TSCONFIG,
            ),
            b"process" | b"require" | b"Buffer" | b"module" | b"NodeJS" => if_else(
                self.compiler_options.uses_wildcard_types(),
                diagnostics::CANNOT_FIND_NAME_0_DO_YOU_NEED_TO_INSTALL_TYPE_DEFINITIONS_FOR_NODE_TRY_NPM_I_SAVE_DEV_TYPES_SLASHNODE,
                diagnostics::CANNOT_FIND_NAME_0_DO_YOU_NEED_TO_INSTALL_TYPE_DEFINITIONS_FOR_NODE_TRY_NPM_I_SAVE_DEV_TYPES_SLASHNODE_AND_THEN_ADD_NODE_TO_THE_TYPES_FIELD_IN_YOUR_TSCONFIG,
            ),
            b"Bun" => if_else(
                self.compiler_options.uses_wildcard_types(),
                diagnostics::CANNOT_FIND_NAME_0_DO_YOU_NEED_TO_INSTALL_TYPE_DEFINITIONS_FOR_BUN_TRY_NPM_I_SAVE_DEV_TYPES_SLASHBUN,
                diagnostics::CANNOT_FIND_NAME_0_DO_YOU_NEED_TO_INSTALL_TYPE_DEFINITIONS_FOR_BUN_TRY_NPM_I_SAVE_DEV_TYPES_SLASHBUN_AND_THEN_ADD_BUN_TO_THE_TYPES_FIELD_IN_YOUR_TSCONFIG,
            ),
            b"Map" | b"Set" | b"Promise" | b"ast.Symbol" | b"WeakMap" | b"WeakSet" | b"Iterator"
            | b"AsyncIterator" | b"SharedArrayBuffer" | b"Atomics" | b"AsyncIterable"
            | b"AsyncIterableIterator" | b"AsyncGenerator" | b"AsyncGeneratorFunction"
            | b"BigInt" | b"Reflect" | b"BigInt64Array" | b"BigUint64Array" => {
                diagnostics::CANNOT_FIND_NAME_0_DO_YOU_NEED_TO_CHANGE_YOUR_TARGET_LIBRARY_TRY_CHANGING_THE_LIB_COMPILER_OPTION_TO_1_OR_LATER
            }
            b"await" if is_call_expression(a, a.parent(node)) => {
                diagnostics::CANNOT_FIND_NAME_0_DID_YOU_MEAN_TO_WRITE_THIS_IN_AN_ASYNC_FUNCTION
            }
            _ => {
                if a.kind(a.parent(node)) == Kind::ShorthandPropertyAssignment {
                    return diagnostics::NO_VALUE_EXISTS_IN_SCOPE_FOR_THE_SHORTHAND_PROPERTY_0_EITHER_DECLARE_ONE_OR_PROVIDE_AN_INITIALIZER;
                }
                diagnostics::CANNOT_FIND_NAME_0
            }
        }
    }

    pub fn get_diagnostics_exported(&mut self, source_file: NodeId) -> Vec<DiagnosticId> {
        self.get_diagnostics(source_file, DiagnosticsCollectionKind::Diagnostics)
    }

    pub fn get_suggestion_diagnostics(&mut self, source_file: NodeId) -> Vec<DiagnosticId> {
        self.get_diagnostics(
            source_file,
            DiagnosticsCollectionKind::SuggestionDiagnostics,
        )
    }

    pub fn get_diagnostics(
        &mut self,
        source_file: NodeId,
        collection: DiagnosticsCollectionKind,
    ) -> Vec<DiagnosticId> {
        self.check_not_canceled();
        let check_unused = self.compiler_options.no_unused_locals.is_true()
            || self.compiler_options.no_unused_parameters.is_true()
            || collection == DiagnosticsCollectionKind::SuggestionDiagnostics;
        self.check_source_file(source_file, check_unused);
        if self.was_canceled {
            return Vec::new();
        }
        let files = ProgramFiles { ast: self.ast };
        let view = Diagnostics {
            store: &self.diagnostic_store,
            files: &files,
        };
        match collection {
            DiagnosticsCollectionKind::Diagnostics => {
                self.diagnostics.get_diagnostics_for_file(view, source_file)
            }
            DiagnosticsCollectionKind::SuggestionDiagnostics => self
                .suggestion_diagnostics
                .get_diagnostics_for_file(view, source_file),
        }
    }

    pub fn get_global_diagnostics(&mut self) -> Vec<DiagnosticId> {
        self.check_not_canceled();
        let files = ProgramFiles { ast: self.ast };
        let view = Diagnostics {
            store: &self.diagnostic_store,
            files: &files,
        };
        self.diagnostics.get_global_diagnostics(view)
    }

    pub fn add_deferred_diagnostic(&mut self, callback: DeferredDiagnosticCallback<'a>) {
        self.deferred_diagnostic_callbacks.push(callback);
    }

    pub fn produce_deferred_diagnostics(&mut self) {
        // `range` reads the slice header once: a callback that a callback adds is not run, and the assignment below drops it.
        let callbacks = std::mem::take(&mut self.deferred_diagnostic_callbacks);
        for cb in callbacks {
            cb(self);
        }
        self.deferred_diagnostic_callbacks = Vec::new();
    }

    pub fn add_diagnostic(&mut self, diagnostic: DiagnosticId) -> DiagnosticId {
        // Discard diagnostics created while at the maximum number of recursive TypeToString invocations.
        if self.serialization_level < MAX_SERIALIZATION_LEVEL {
            let files = ProgramFiles { ast: self.ast };
            let view = Diagnostics {
                store: &self.diagnostic_store,
                files: &files,
            };
            return self.diagnostics.add(view, diagnostic);
        }
        diagnostic
    }

    pub fn add_suggestion_diagnostic(&mut self, diagnostic: DiagnosticId) -> DiagnosticId {
        // Discard diagnostics created while at the maximum number of recursive TypeToString invocations.
        if self.serialization_level < MAX_SERIALIZATION_LEVEL {
            let files = ProgramFiles { ast: self.ast };
            let view = Diagnostics {
                store: &self.diagnostic_store,
                files: &files,
            };
            return self.suggestion_diagnostics.add(view, diagnostic);
        }
        diagnostic
    }

    pub fn error(
        &mut self,
        location: NodeId,
        message: MessageId,
        args: &[Arg<'_>],
    ) -> DiagnosticId {
        let diagnostic = self.new_diagnostic_for_node(location, message, args);
        self.add_diagnostic(diagnostic)
    }

    pub fn error_skipped_on_no_emit(
        &mut self,
        location: NodeId,
        message: MessageId,
        args: &[Arg<'_>],
    ) -> DiagnosticId {
        let diagnostic = self.error(location, message, args);
        self.diagnostic_store[diagnostic].set_skipped_on_no_emit();
        diagnostic
    }

    pub fn error_or_suggestion(
        &mut self,
        is_error: bool,
        location: NodeId,
        message: MessageId,
        args: &[Arg<'_>],
    ) {
        let diagnostic = self.new_diagnostic_for_node(location, message, args);
        self.add_error_or_suggestion(is_error, diagnostic);
    }

    pub fn error_and_maybe_suggest_await(
        &mut self,
        location: NodeId,
        maybe_missing_await: bool,
        message: MessageId,
        args: &[Arg<'_>],
    ) -> DiagnosticId {
        let diagnostic = self.error(location, message, args);
        if maybe_missing_await {
            let related = self.create_diagnostic_for_node(
                location,
                diagnostics::DID_YOU_FORGET_TO_USE_AWAIT,
                &[],
            );
            self.diagnostic_store.add_related_info(diagnostic, related);
        }
        diagnostic
    }

    pub fn add_error_or_suggestion(&mut self, is_error: bool, diagnostic: DiagnosticId) {
        if is_error {
            self.add_diagnostic(diagnostic);
        } else {
            let suggestion = self.diagnostic_store.clone_diagnostic(diagnostic);
            self.diagnostic_store[suggestion].set_category(Category::Suggestion);
            self.add_suggestion_diagnostic(suggestion);
        }
    }

    pub fn is_deprecated_declaration(&mut self, declaration: NodeId) -> bool {
        let combined_flags = self.get_combined_node_flags_cached(declaration);
        is_deprecated_declaration_with_cached_flags(self.ast, declaration, combined_flags)
    }

    pub fn add_deprecated_suggestion(
        &mut self,
        location: NodeId,
        declarations: List<'_, NodeId>,
        deprecated_entity: &[u8],
    ) -> DiagnosticId {
        let diagnostic = self.new_diagnostic_for_node(
            location,
            diagnostics::X_0_IS_DEPRECATED,
            &[Arg::Str(deprecated_entity)],
        );
        self.add_deprecated_suggestion_worker(declarations, diagnostic)
    }

    pub fn add_deprecated_suggestion_worker(
        &mut self,
        declarations: List<'_, NodeId>,
        diagnostic: DiagnosticId,
    ) -> DiagnosticId {
        let a = self.ast;
        for &declaration in declarations.as_slice() {
            let deprecated_tag = get_jsdoc_deprecated_tag(a, declaration);
            if !deprecated_tag.is_nil() {
                let related = self.new_diagnostic_for_node(
                    deprecated_tag,
                    diagnostics::THE_DECLARATION_WAS_MARKED_AS_DEPRECATED_HERE,
                    &[],
                );
                self.diagnostic_store.add_related_info(diagnostic, related);
                break;
            }
        }
        self.add_suggestion_diagnostic(diagnostic)
    }

    pub fn is_deprecated_symbol(&mut self, symbol: SymbolId) -> bool {
        let a = self.ast;
        let parent_symbol = self.get_parent_of_symbol(symbol);
        let declarations = a.sym(symbol).declarations;
        if !parent_symbol.is_nil() && declarations.len() > 1 {
            if a.sym(parent_symbol)
                .flags
                .intersects(SymbolFlags::INTERFACE)
            {
                return some(declarations.as_slice(), |declaration| {
                    self.is_deprecated_declaration(declaration)
                });
            } else {
                return every(declarations.as_slice(), |declaration| {
                    self.is_deprecated_declaration(declaration)
                });
            }
        }
        let value_declaration = a.sym(symbol).value_declaration;
        !value_declaration.is_nil() && self.is_deprecated_declaration(value_declaration)
            || declarations.len() != 0
                && every(declarations.as_slice(), |declaration| {
                    self.is_deprecated_declaration(declaration)
                })
    }

    pub fn has_parse_diagnostics(&self, source_file: NodeId) -> bool {
        self.ast.as_source_file(source_file).diagnostics().len() > 0
    }
}
