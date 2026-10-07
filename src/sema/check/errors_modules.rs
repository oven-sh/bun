//! Modules, namespaces, imports and exports that are misplaced, unresolved or incompatible with the
//! options:
//!
//! * `bindModuleDeclaration`: 2668 5061; `bindNamespaceExportDeclaration`: 1184 1314 1315 1316
//! * `checkModuleDeclaration`: 1035 1280 1287 1540 2435 2436 2669 2670;
//!   `checkModuleAugmentationElement`: 2666 2667
//! * `mergeModuleAugmentation`, and the errors `resolveExternalModule` and `mergeSymbol` report on
//!   its behalf: 2306 2567 2649 2664 2665 2671 2732 2834 2835
//! * `checkExternalImportOrExportDeclaration`: 1147 1194 2439 2858
//! * `collectModuleReferences`, via `resolveExternalModule`: 2307 2580 2591 2732 2882, reported or
//!   removed
//! * `checkImportAttributes`, `getTypeFromImportAttributes`, `checkImportType`,
//!   `getResolutionModeOverride`: 1453 1454 1463 1464 2322 2823 2856 2857
//! * `checkImportEqualsDeclaration`: 1202 1392 2437 2438; `checkExportDeclaration`: 1194 2498;
//!   `checkClassDeclaration`: 1211
//! * `checkExportAssignment`: 1063 1319 1282 1283 1284 1285 1289 1290 1291 1292
//! * `getVerbatimModuleSyntaxErrorMessage`, from `checkAliasSymbol`, `checkExportAssignment` and
//!   `checkGrammarImportCallExpression`: 1286 1295
//! * `checkGrammarModuleElementContext`: 1231 1232 1233 1234 1235 1258 1473 1474
//! * `getTypeFromImportTypeNode`: 1339 1340; `checkGrammarImportClause`: 1363 2206 18058 18059
//!   18060
//! * `reportFlowControlError`: 2563
//!
//! All of TypeScript 7.0.2's checker.go, flow.go, grammarchecks.go, binder.go and
//! parser/references.go. Only `check_import_attributes` requests types.
//!
//! The HIR of a file stores neither modifiers nor keywords: they are read from the source text,
//! starting at a position the HIR does have. A declaration file has no text, so checks that depend
//! on the text are skipped.

use super::errors_enums_names::resolves_to_umd_global;
use super::*;
use crate::bind::{Decl, Parent, ScopeId, SymbolId};
use crate::resolve::{ModuleKind, is_relative};
use bun_collections::ArrayHashMap;

/// State that is constant for a whole file.
struct Cx<'a> {
    file: FileId,
    text: &'a [u8],
    /// The occurrences of module specifiers, in source order.
    uses: &'a [SpecifierUse],
    /// `IsExternalModule`, according to the program.
    is_module: bool,
    /// `IsGlobalSourceFile`: a CommonJS module is none either.
    is_global_source_file: bool,
    /// Not `hasParseDiagnostics`: `grammarErrorOnNode` only reports in a file that parses.
    grammar: bool,
    /// `IsInJSFile`
    is_js: bool,
    /// `verbatimModuleSyntax`
    is_verbatim: bool,
    /// `verbatimModuleSyntax`, in a file whose `GetEmitModuleFormatOfFile` is CommonJS.
    verbatim_commonjs: bool,
    /// `getVerbatimModuleSyntaxErrorMessage`
    esm_syntax_code: u32,
    /// `node.Symbol` for the alias declarations.
    aliases: ArrayHashMap<Decl, Sym>,
}

/// The node whose body a statement list is.
#[derive(Copy, Clone)]
struct Around {
    /// `isInAppropriateContext` of `checkGrammarModuleElementContext`: it is the file or a module.
    is_appropriate_context: bool,
    /// `NONE`: the file, or no module.
    module: ModuleId,
    /// `IsAmbientModule`
    is_ambient_module: bool,
    /// `IsExternalModuleAugmentation`
    is_augmentation: bool,
    /// The module is declared at the top level of the file.
    is_top_level: bool,
    /// `NodeFlagsAmbient`
    is_ambient: bool,
}

impl Cx<'_> {
    /// The module specifier `spec` of the statement at `pos`.
    fn specifier(&self, pos: u32, spec: Atom) -> Option<SpecifierUse> {
        let at = self.uses.partition_point(|u| u.pos < pos);
        self.uses.get(at).copied().filter(|u| u.spec == spec)
    }

    /// `importClause.NamedBindings` is a `NamedImports`. The HIR has no node for `{}` after a
    /// default import: the clause ends with the brace.
    fn has_named_imports(&self, import: &Import) -> bool {
        import.namespace.is_none()
            && (!import.named.is_empty()
                || import.clause_end > import.clause_start
                    && (import.default.is_none()
                        || self.text.get(import.clause_end as usize - 1) == Some(&b'}')))
    }
}

impl Checker<'_, '_> {
    pub(super) fn check_x_modules(&mut self, file: FileId) {
        let hir = self.hir(file);
        if hir.kind == FileKind::Json {
            return;
        }
        self.check_flow_too_deep(file);
        let module = self.files().module(file);
        let sorted;
        let has_calls = hir.specifier_uses.iter().any(|u| u.kind.is_call());
        let uses: &[SpecifierUse] = if !has_calls && hir.specifier_uses.is_sorted_by_key(|u| u.pos)
        {
            &hir.specifier_uses
        } else {
            let mut uses = hir.specifier_uses.to_vec();
            uses.retain(|u| !u.kind.is_call());
            uses.sort_unstable_by_key(|u| u.pos);
            sorted = uses;
            &sorted
        };
        // NEEDS: `Options::verbatim_module_syntax: bool`, the value of
        // `compilerOptions.verbatimModuleSyntax`
        let is_verbatim = self.p.files.options.verbatim_module_syntax;
        let cx = Cx {
            file,
            text: &hir.text,
            is_module: hir.has_module_syntax,
            is_global_source_file: !module.is_module(),
            // `tryParseImportAttributes`, `parseImportType`: `assert` in place of `with` is a parse
            // error.
            grammar: !has_parse_diagnostics(hir) && !hir.diagnostics.iter().any(|d| d.code == 2880),
            is_js: hir.is_js,
            is_verbatim,
            verbatim_commonjs: is_verbatim && self.modules_emits_commonjs(file),
            esm_syntax_code: self.verbatim_module_syntax_error_message(file),
            aliases: self.symbols_of_alias_declarations(file),
            uses,
        };
        let top = Around {
            is_appropriate_context: true,
            module: ModuleId::NONE,
            is_ambient_module: false,
            is_augmentation: false,
            is_top_level: false,
            is_ambient: hir.kind == FileKind::Declaration,
        };
        self.modules_statements(&cx, hir.body, top);
        self.modules_misplaced_statements(&cx, top);
        self.modules_import_calls_and_types(&cx);
        // Fast path: a cycle needs an alias that other files can import, or one that refers to another name in this file.
        let can_be_circular = cx.aliases.keys().iter().any(|d| {
            matches!(
                d,
                Decl::ImportEquals(_)
                    | Decl::ExportSpec(_)
                    | Decl::ExportStarAs(_)
                    | Decl::ExportExpr(_)
                    | Decl::ModuleExports(_)
                    | Decl::ExportsProperty(_)
            )
        });
        for (&decl, &sym) in cx.aliases.iter() {
            // `checkVariableLikeDeclaration`
            if matches!(decl, Decl::Require(_)) {
                self.check_alias_symbol(file, &cx.aliases, decl, false);
            }
            // `resolveAlias`: at `getDeclarationOfAliasSymbol`. Where
            // `checkGrammarModuleElementContext` stops the check of the declaration, something else
            // has to resolve the alias.
            if can_be_circular
                && self.files().alias_links(sym).is_circular
                && self.files().declaration_of_alias_symbol(sym) == Some((file, decl))
                && (statement_of_alias_declaration(hir, decl)
                    .is_none_or(|s| is_in_appropriate_context(self.bound(file), s))
                    || self.modules_alias_is_used(&cx, sym))
                && let Some(at) = self.place_of_alias_declaration(Sym { file, ..sym }, decl)
            {
                if self.files().alias_links(sym).ran_out_of_stack {
                    self.ran_out_of_stack.set(true);
                } else {
                    self.error_at(at, 2303, &[Arg::Sym(sym)]);
                }
            }
        }
    }

    /// `reportFlowControlError`: reports 2563 at the first token of the function body, namespace body or file that contains a reference
    /// whose control flow walk reached the depth limit. `flow_type_of` records those references in `flows_too_deep`.
    fn check_flow_too_deep(&mut self, file: FileId) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        // The limit is 2000 levels, and a walk nests at most once per flow node.
        if bound.flow_places <= 2000 {
            return;
        }
        let mut reported = Node::NONE;
        for i in 0..hir.exprs.len() {
            let e = ExprId(i as u32);
            // `check_source_file` has checked every reference that tsgo checks.
            if self.p.flows_too_deep.get(&self.task, &(file, e)).is_none()
                || bound.is_unchecked(i)
                // `checkWithStatement` does not check the body.
                || hir.is_in_with(hir[e].pos)
            {
                continue;
            }
            let block = self.function_or_module_block_of(file, e);
            // Consecutive references usually share a block.
            if block == reported {
                continue;
            }
            // `GetRangeOfTokenAtPosition(sourceFile, block.StatementList().Pos())`
            let start = if block == Node::FILE {
                Some(first_token_start(&hir.text))
            } else if let NodeData::Stmt(s) = hir.data(block.row())
                && let StmtKind::Module(m) = hir[s].kind
            {
                statement_list_start(hir, hir[m].body)
            } else if let Some(FnBody::Block(statements)) =
                (hir.fns.get(hir.function_of(block.row()).idx())).map(|f| f.body)
            {
                statement_list_start(hir, statements)
            } else {
                None
            };
            if let Some(start) = start {
                reported = block;
                self.error_at((file, start, 0), 2563, &[]);
            }
        }
    }

    /// `GetEmitModuleFormatOfFile(file) == ModuleKindCommonJS`
    pub(super) fn modules_emits_commonjs(&self, file: FileId) -> bool {
        self.emit_module_format_of_file(file) == ModuleKind::CommonJs
    }

    /// `GetEmitModuleFormatOfFile`
    pub(super) fn emit_module_format_of_file(&self, file: FileId) -> ModuleKind {
        match self.files().module(file).implied_format {
            ResolutionMode::Require => ModuleKind::CommonJs,
            ResolutionMode::Import => ModuleKind::EsNext,
            ResolutionMode::None => self.files().compiler_options_for_file(file).module,
        }
    }

    /// The statements of the file or of the body of a module.
    fn modules_statements(&mut self, cx: &Cx<'_>, list: IdList<StmtId>, around: Around) {
        for s in self.hir(cx.file).ids(list) {
            self.modules_statement(cx, s, around);
        }
    }

    /// The statement `s`, whose parent is `around`.
    fn modules_statement(&mut self, cx: &Cx<'_>, s: StmtId, around: Around) {
        match self.hir(cx.file)[s].kind {
            StmtKind::Module(m) => self.modules_declaration(cx, s, m, around),
            StmtKind::Import(i) => self.modules_import(cx, s, i, around),
            StmtKind::ImportEquals(i) => self.modules_import_equals(cx, s, i, around),
            StmtKind::ExportNamed(x) => self.modules_export_named(cx, s, x, around),
            StmtKind::ExportStar { .. } => self.modules_export_star(cx, s, around),
            StmtKind::ExportDefault(e) => self.modules_export_assignment(cx, s, e, false, around),
            StmtKind::ExportAssign(e) => self.modules_export_assignment(cx, s, e, true, around),
            StmtKind::ExportAsNamespace(_) => {
                self.modules_namespace_export_declaration(cx, s, around)
            }
            _ => {}
        }
    }

    /// `bindNamespaceExportDeclaration`: `export as namespace N` accepts no modifiers, and must be
    /// at the top level of a declaration file that is a module.
    fn modules_namespace_export_declaration(&mut self, cx: &Cx<'_>, s: StmtId, around: Around) {
        let hir = self.hir(cx.file);
        let node = (cx.file, hir[s].start, self.end_of_stmt(cx.file, s));
        if !hir[s].modifiers.is_empty() {
            self.error_at(node, 1184, &[]);
        }
        let code = if around.module.is_some() || !around.is_appropriate_context {
            1316
        } else if !cx.is_module {
            1314
        } else if hir.kind != FileKind::Declaration {
            1315
        } else {
            return;
        };
        self.error_at(node, code, &[]);
    }

    /// `checkGrammarModuleElementContext` for the statement `s`, whose parent is `around`.
    fn check_grammar_module_element_context(
        &mut self,
        cx: &Cx<'_>,
        s: StmtId,
        around: Around,
        code: u32,
    ) -> bool {
        if !around.is_appropriate_context && cx.grammar && !cx.text.is_empty() {
            self.error_at((cx.file, self.hir(cx.file)[s].start, 0), code, &[]);
        }
        !around.is_appropriate_context
    }

    /// `node.Flags&NodeFlagsAmbient` of the statement `s`, whose parent is `around`: what follows
    /// `declare` is parsed in an ambient context.
    fn modules_is_ambient(&self, cx: &Cx<'_>, s: StmtId, around: Around) -> bool {
        let hir = self.hir(cx.file);
        around.is_ambient
            || hir
                .find_modifier(hir[s].modifiers, Flags::AMBIENT)
                .is_some()
    }

    // ───────────────────────────── module declarations ─────────────────────────────

    /// `bindModuleDeclaration`, `checkModuleDeclaration`
    fn modules_declaration(&mut self, cx: &Cx<'_>, s: StmtId, m: ModuleId, around: Around) {
        let (hir, files) = (self.hir(cx.file), self.files());
        let module = hir[m];
        let name_pos = module.name_pos;
        let start = hir[s].start;
        let is_global = module.name == ModuleName::Global;
        let is_ambient_module = !matches!(module.name, ModuleName::Ident(_));
        let is_ambient = around.is_ambient || module.flags.contains(Flags::AMBIENT);
        // `IsSourceFile(node.Parent)`
        let is_at_top = around.module.is_none() && around.is_appropriate_context;
        // `IsModuleAugmentationExternal`
        let adds_to_another = if is_at_top {
            cx.is_module
        } else {
            around.is_ambient_module && around.is_top_level && !cx.is_module
        };
        let is_augmentation = is_ambient_module && adds_to_another;
        let inner = Around {
            is_appropriate_context: true,
            module: m,
            is_ambient_module,
            is_augmentation,
            is_top_level: is_at_top,
            is_ambient,
        };
        self.modules_statements(cx, module.body, inner);

        if is_ambient_module {
            // The flag is also set on declarations nested in an exported one, so only the keyword
            // counts.
            if module.flags.contains(Flags::EXPORT)
                && hir.find_modifier(hir[s].modifiers, Flags::EXPORT).is_some()
            {
                self.error_at((cx.file, start, 0), 2668, &[]);
            }
            // `TryParsePattern`
            if !is_augmentation
                && let ModuleName::String(name) = module.name
                && bun_core::strings::count_char(files.atoms.bytes(name), b'*') > 1
            {
                self.error_at((cx.file, name_pos, 0), 5061, &[Arg::Atom(name)]);
            }
        }

        if is_global && !is_ambient {
            self.error_at((cx.file, name_pos, 0), 2670, &[]);
        }
        let context_error = if is_ambient_module { 1234 } else { 1235 };
        if self.check_grammar_module_element_context(cx, s, around, context_error) {
            return;
        }
        // `!c.checkGrammarModifiers(node)`
        if cx.grammar
            && !is_ambient
            && matches!(module.name, ModuleName::String(_))
            && self.grammar_error_in_modifiers(cx.file, s).is_none()
        {
            self.error_at((cx.file, name_pos, 0), 1035, &[]);
        }
        if module.specifies_module {
            self.error_at((cx.file, name_pos, 0), 1540, &[]);
        }
        // Both relate to options that preserve `const enum`s, so a namespace that contains nothing
        // else counts as well.
        if !is_ambient
            && self.p.files.options.isolated_modules
            && self.bound(cx.file).module_instance_state[m.idx()]
                != ModuleInstanceState::NonInstantiated
        {
            if !cx.is_module {
                self.error_at(
                    (cx.file, name_pos, 0),
                    1280,
                    &[Arg::Bytes(isolated_modules_like_flag_name(files))],
                );
            }
            if cx.verbatim_commonjs
                && is_at_top
                && module.flags.contains(Flags::EXPORT)
                && let Some(start) = hir.find_modifier(hir[s].modifiers, Flags::EXPORT)
            {
                self.error_at((cx.file, start, 0), 1287, &[]);
            }
        }

        if !is_ambient_module {
            return;
        }
        if is_augmentation {
            if let ModuleName::String(name) = module.name {
                self.modules_merge_augmentation(cx, m, name, around);
            }
            // An augmentation that was not merged into anything is not visited: it would only
            // produce cascading errors.
            let symbol = self.bound(cx.file).module_symbol[m.idx()];
            let is_merged = || {
                let merged = files.sym(cx.file, symbol);
                files.flags(merged).contains(SymFlags::TRANSIENT)
            };
            let check_body = is_global || symbol.is_some() && is_merged();
            if check_body && cx.grammar {
                for s in hir.ids(module.body) {
                    // `checkModuleAugmentationElement`
                    let code = match hir[s].kind {
                        StmtKind::ExportAssign(_)
                        | StmtKind::ExportDefault(_)
                        | StmtKind::ExportNamed(_)
                        | StmtKind::ExportStar { .. } => 2666,
                        StmtKind::Import(_) => 2667,
                        StmtKind::ImportEquals(i)
                            if matches!(hir[i].target, ImportEqualsTarget::Require(_)) =>
                        {
                            2667
                        }
                        _ => continue,
                    };
                    self.error_at((cx.file, hir[s].start, 0), code, &[]);
                }
            }
        } else if is_global {
            self.error_at((cx.file, name_pos, 0), 2669, &[]);
        } else if !is_at_top || !cx.is_global_source_file {
            self.error_at((cx.file, name_pos, 0), 2435, &[]);
        } else if let ModuleName::String(name) = module.name
            && is_relative(self.atoms().bytes(name))
        {
            self.error_at((cx.file, name_pos, 0), 2436, &[]);
        }
    }

    /// What `mergeModuleAugmentation` reports for the declaration `m`, which augments the module
    /// named `name`. `Files::merge` has merged it. Errors are reported at the first declaration of
    /// its symbol.
    fn modules_merge_augmentation(&mut self, cx: &Cx<'_>, m: ModuleId, name: Atom, around: Around) {
        let (hir, bound, files) = (self.hir(cx.file), self.bound(cx.file), self.files());
        let symbol = bound.module_symbol[m.idx()];
        if symbol.is_none() || !files.merges_module_augmentation(cx.file, symbol) {
            return;
        }
        let decls = &bound.symbols[symbol.idx()].decls;
        let is_first = decls.first() == Some(&Decl::Module(m));
        let start = hir[m].name_pos;
        let report = |c: &mut Self, code: u32, of_each: bool, args: &[Arg<'_>]| {
            if of_each || is_first {
                c.error_at((cx.file, start, 0), code, args);
            }
        };
        // `resolveExternalModuleNameWorker(moduleName, moduleName, moduleNotFoundError, false,
        // true)`. Names in an ambient context are not reported.
        if is_first {
            let written = SpecifierUse {
                spec: name,
                pos: start,
                kind: SpecifierKind::Import,
                mode: ResolutionMode::None,
            };
            let site = SpecifierSite {
                is_ambient: true,
                is_for_augmentation: true,
                is_not_validated: around.is_ambient,
                ..Default::default()
            };
            self.resolve_external_module(cx.file, written, site);
        }
        let own = Sym {
            file: cx.file,
            id: symbol,
        };
        if files.augmentations_of_non_modules.contains(&own) {
            report(self, 2671, false, &[Arg::Atom(name)]);
            return;
        }
        let merged = files.canonical(own);
        if files.flags(merged).contains(SymFlags::TRANSIENT) {
            return;
        }
        let Some(found) = files.module_of_specifier(cx.file, name) else {
            return;
        };
        let main = files.module_value(found);
        let flags = files.flags(main);
        // `mergeSymbol`, `SymbolFlagsValueModuleExcludes`: a module that contains values merges
        // with neither a variable nor a `const enum`, whatever else has the same name.
        let is_variable = flags.intersects(SymFlags::VARIABLE);
        let is_const_enum = || {
            files.decls(main).iter().any(|&(of, d)| matches!(d, Decl::Enum(e) if files.hir(of)[e].flags.contains(Flags::CONST)))
        };
        let has_values = || {
            decls.iter().any(|&d| matches!(d, Decl::Module(part) if bound.module_instance_state[part.idx()] != ModuleInstanceState::NonInstantiated))
        };
        if (is_variable || flags.intersects(SymFlags::ENUM) && is_const_enum()) && has_values() {
            if flags.contains(SymFlags::NAMESPACE_MODULE) {
                report(self, 2649, false, &[Arg::Sym(main)]);
            } else if !is_variable {
                // `reportMergeSymbolError` for the declarations on this side.
                report(self, 2567, true, &[]);
            }
        }
    }

    pub(super) fn modules_is_a_file(&self, module: Sym) -> bool {
        self.files().symbol(module).decls.contains(&Decl::File)
    }

    // ───────────────────────────── imports and exports ─────────────────────────────

    /// `checkExternalImportOrExportDeclaration` for the statement `s` that names the module `spec`.
    fn modules_is_in_valid_position(
        &mut self,
        cx: &Cx<'_>,
        s: StmtId,
        spec: Atom,
        is_export: bool,
        around: Around,
    ) -> bool {
        // The specifier is missing or not a string literal. The parser has reported 1141.
        if spec.is_none() {
            return false;
        }
        let start = self.hir(cx.file)[s].start;
        let written = cx.specifier(start, spec);
        if around.module.is_some() {
            if !around.is_ambient_module {
                if let Some(written) = written {
                    self.error_at(
                        (cx.file, written.pos, 0),
                        if is_export { 1194 } else { 1147 },
                        &[],
                    );
                }
                return false;
            }
            // `isTopLevelInExternalModuleAugmentation`: there the statement has already been
            // reported as misplaced.
            if !around.is_augmentation && is_relative(self.atoms().bytes(spec)) {
                self.error_at((cx.file, start, self.end_of_stmt(cx.file, s)), 2439, &[]);
                return false;
            }
        }
        // The values of its attributes are strings.
        let hir = self.hir(cx.file);
        let mut are_strings = true;
        if written.is_some()
            && let Some((.., attributes)) = self.modules_get_import_attributes(cx.file, hir[s].loc)
        {
            for value in attributes.iter().map(|attribute| hir[attribute].value) {
                // The parser has reported a missing value.
                if !matches!(hir[value].kind, ExprKind::Missing)
                    && !self
                        .modules_string_literal_like(cx.file, value)
                        .is_some_and(|(_, is_string_literal)| is_string_literal)
                {
                    are_strings = false;
                    let start = self.start_of(cx.file, value);
                    self.error_at(
                        (cx.file, start, self.end_of_expr(cx.file, value)),
                        2858,
                        &[],
                    );
                }
            }
        }
        are_strings
    }

    /// `resolveExternalModuleName(node, node.ModuleSpecifier())` for the statement `s`, whose
    /// module specifier is `spec`: whether resolution fails.
    fn modules_module_is_missing(
        &mut self,
        cx: &Cx<'_>,
        s: StmtId,
        spec: Atom,
        around: Around,
    ) -> bool {
        let written = cx.specifier(self.hir(cx.file)[s].start, spec);
        written.is_none_or(|written| {
            !self.resolve_external_module_name(cx.file, s, written, around.is_ambient)
        })
    }

    /// `resolveExternalModuleName(node, node.ModuleSpecifier())` for the statement `s` of `file`,
    /// whose module specifier is `written`: whether the module is found.
    fn resolve_external_module_name(
        &mut self,
        file: FileId,
        s: StmtId,
        written: SpecifierUse,
        is_ambient: bool,
    ) -> bool {
        let hir = self.hir(file);
        let mut site = SpecifierSite {
            is_ambient,
            ..Default::default()
        };
        let type_only = match hir[s].kind {
            StmtKind::Import(_) if written.kind == SpecifierKind::SideEffect => true,
            StmtKind::Import(x) => {
                let import = &hir[x];
                // With braces the module is requested from the declaration itself, which has no
                // `type` keyword.
                let has_braces = import.namespace.is_none()
                    && (!import.named.is_empty() || import.default.is_none());
                site.is_type_only = import.type_only && !has_braces;
                site.is_type_only_import = import.type_only;
                import.type_only
            }
            StmtKind::ExportNamed(x) => hir[x].type_only,
            StmtKind::ExportStar {
                alias, type_only, ..
            } => {
                site.is_type_only = type_only && alias.is_none();
                type_only
            }
            StmtKind::ImportEquals(x) => {
                site.is_type_only = hir[x].flags.contains(Flags::TYPE_ONLY);
                site.is_ambient |= hir[x].flags.contains(Flags::AMBIENT);
                site.is_type_only
            }
            _ => return false,
        };
        site.is_emittable = !type_only;
        self.resolve_external_module(file, written, site)
    }

    /// What `resolveAlias(sym)` reports through `getTargetOfAliasDeclaration`, for a caller other
    /// than the check of the declaration: `resolveExternalModuleName`, then
    /// `check_target_of_alias_declaration`.
    pub(super) fn check_target_of_alias_symbol(&mut self, sym: Sym) {
        let Some((file, decl)) = self.files().declaration_of_alias_symbol(sym) else {
            return;
        };
        // The HIR of a leaf is freed after its task.
        if self.task.file != Some(file) && self.files().module(file).is_leaf {
            return;
        }
        let (hir, bound) = (self.hir(file), self.bound(file));
        let Some(s) = statement_of_alias_declaration(hir, decl) else {
            return;
        };
        let spec = match hir[s].kind {
            StmtKind::Import(x) => hir[x].spec,
            StmtKind::ImportEquals(x) => hir[x].target.spec(),
            StmtKind::ExportNamed(x) => hir[x].spec,
            StmtKind::ExportStar { spec, .. } => spec,
            _ => Atom::NONE,
        };
        // FOR SPEED: nothing stops the check of such a declaration, which reports the same.
        let has_phase_modifier =
            matches!(hir[s].kind, StmtKind::Import(x) if hir[x].type_only || hir[x].is_deferred);
        let is_checked = matches!(bound.stmt_parent[s.idx()], Parent::File)
            && hir.import_attributes.is_empty()
            && !has_phase_modifier;
        if spec.is_none() || is_checked {
            return;
        }
        let start = hir[s].start;
        let is_written = |u: &&SpecifierUse| u.spec == spec && u.pos >= start && !u.kind.is_call();
        let uses = hir.specifier_uses.iter().filter(is_written);
        if let Some(&written) = uses.min_by_key(|u| u.pos)
            && self.resolve_external_module_name(file, s, written, hir.is_ambient(hir.node(s)))
        {
            self.check_target_of_alias_declaration(file, sym, decl);
        }
    }

    /// `check_target_of_alias_symbol` for the alias that `decl` declares, in a statement whose
    /// check does not get to it, if something else resolves the alias.
    fn modules_resolve_alias_if_used(&mut self, cx: &Cx<'_>, decl: Decl) {
        if let Some(&sym) = cx.aliases.get(&decl)
            && self.modules_alias_is_used(cx, sym)
        {
            self.check_target_of_alias_symbol(sym);
        }
    }

    /// The statements that are directly in neither the file nor a module declaration, where
    /// `checkGrammarModuleElementContext` refuses imports, exports and module declarations. 1211
    /// for a class declaration.
    fn modules_misplaced_statements(&mut self, cx: &Cx<'_>, top: Around) {
        let (hir, bound) = (self.hir(cx.file), self.bound(cx.file));
        let reports_grammar_errors = cx.grammar && !cx.text.is_empty();
        for (i, statement) in hir.stmts.iter().enumerate() {
            if matches!(bound.stmt_parent[i], Parent::None) {
                continue;
            }
            // `checkClassDeclaration`: only `export default class` may omit the name.
            if reports_grammar_errors
                && let StmtKind::Class(c) = statement.kind
                && hir[c].name.is_none()
                && !hir[c].flags.contains(Flags::DEFAULT)
                // `default` without `export` (1029) is still a modifier.
                && hir.find_modifier(statement.modifiers, Flags::DEFAULT).is_none()
            {
                let start = hir[c].start;
                self.error_at((cx.file, start, 0), 1211, &[]);
            }
            if matches!(bound.stmt_parent[i], Parent::File | Parent::Module(_)) {
                continue;
            }
            if !matches!(
                statement.kind,
                StmtKind::Module(_)
                    | StmtKind::Import(_)
                    | StmtKind::ImportEquals(_)
                    | StmtKind::ExportNamed(_)
                    | StmtKind::ExportStar { .. }
                    | StmtKind::ExportAssign(_)
                    | StmtKind::ExportDefault(_)
                    | StmtKind::ExportAsNamespace(_)
            ) {
                continue;
            }
            let s = StmtId(i as u32);
            let around = Around {
                is_appropriate_context: false,
                is_ambient: hir.is_ambient(hir.parent(hir.node(s))),
                ..top
            };
            self.modules_statement(cx, s, around);
        }
    }

    /// Whether something other than the check of its declaration resolves the alias `sym`, which
    /// the file declares: a reference in the file, or `getNamedMembers` of `typeof globalThis`.
    fn modules_alias_is_used(&self, cx: &Cx<'_>, sym: Sym) -> bool {
        let (hir, bound, files) = (self.hir(cx.file), self.bound(cx.file), self.files());
        let alias = files.symbol(sym).name;
        let all = SymFlags::VALUE | SymFlags::TYPE | SymFlags::NAMESPACE;
        let means_it = |from: ScopeId, name: Atom| {
            name == alias
                && from.is_some()
                && files.resolve_name(cx.file, from, name, all) == Some(sym)
        };
        // `checkGrammarModuleElementContext` stops the check of any other.
        let is_checked = |s: StmtId| is_in_appropriate_context(bound, s);
        bound.expr_symbol.iter().zip(&bound.expr_parent).any(|(&s, parent)| s.is_some() && files.sym(cx.file, s) == sym && !matches!(parent, Parent::None))
            || hir.types.iter().enumerate().any(|(t, node)| match node.kind {
                TypeNodeKind::Ref { name, .. } | TypeNodeKind::Typeof { name, .. } => !name.is_empty() && means_it(bound.type_scope[t], hir[name.at(0)].text),
                _ => false,
            })
            || hir.import_equals.iter().enumerate().any(|(other, import)| {
                matches!(import.target, ImportEqualsTarget::Entity(names) if !names.is_empty() && is_checked(import.stmt) && means_it(bound.import_equals_scope[other], hir[names.at(0)].text))
            })
            || hir.exports.iter().enumerate().any(|(x, export)| !export.has_module_specifier && is_checked(export.stmt) && export.items.iter().any(|s| means_it(bound.export_scope[x], hir[s].local)))
            || cx.is_global_source_file
                && files.globals.get(alias) == Some(&sym)
                && self.modules_resolves_members_of_global_this(cx)
    }

    /// Whether the members of `typeof globalThis` are resolved by the time the diagnostics of the
    /// file are collected. `getNamedMembers` asks `symbolIsValue` of every global, which resolves
    /// the aliases among them. The default library is not checked here. Its check resolves them:
    /// `DecoratorMetadata` relates `typeof globalThis` to an object type.
    fn modules_resolves_members_of_global_this(&self, cx: &Cx<'_>) -> bool {
        let files = self.files();
        let name = self.atoms().lookup(b"DecoratorMetadata");
        let alias = name.and_then(|name| files.global(name, SymFlags::TYPE_ALIAS));
        alias.is_some_and(|alias| {
            let declarations = files.decls_of(alias);
            let mut declarations = declarations.iter();
            declarations.any(|&(of, _)| {
                files.module(of).is_lib && self.is_checked_no_later_than(of, cx.file)
            })
        })
    }

    /// Whether the file contains `name` after a dot, the syntax for accessing a namespace export:
    /// `N.name`.
    fn modules_follows_a_dot_somewhere(&self, cx: &Cx<'_>, name: Atom) -> bool {
        let hir = self.hir(cx.file);
        let is_among =
            |names: Span<NameId>, from: usize| hir.texts(names).skip(from).any(|n| n == name);
        hir.exprs
            .iter()
            .any(|e| matches!(e.kind, ExprKind::Dot { name: member, .. } if member == name))
            || hir.types.iter().any(|t| match t.kind {
                TypeNodeKind::Ref { name: names, .. }
                | TypeNodeKind::Typeof { name: names, .. } => is_among(names, 1),
                TypeNodeKind::Import { name: names, .. } => is_among(names, 0),
                _ => false,
            })
            || hir.import_equals.iter().any(
                |i| matches!(i.target, ImportEqualsTarget::Entity(names) if is_among(names, 1)),
            )
    }

    /// Whether a file that is checked no later than this one has `import { name } from` or
    /// `export { name } from` the file or the ambient module `around`, with `is_requested(name)`.
    /// `checkAliasSymbol` resolves such an alias to its end, through the aliases that the module
    /// exports, and reports what that finds, in whichever file.
    fn modules_is_imported_by_name(
        &self,
        cx: &Cx<'_>,
        around: Around,
        is_requested: &dyn Fn(Atom) -> bool,
    ) -> bool {
        let is_module = if around.module.is_none() {
            cx.is_module
        } else {
            around.is_ambient_module && !around.is_augmentation
        };
        if !is_module {
            return false;
        }
        let files = self.files();
        let module = if around.module.is_none() {
            self.bound(cx.file).file_symbol
        } else {
            self.bound(cx.file).module_symbol[around.module.idx()]
        };
        let module = Some(files.sym(cx.file, module));
        let until = files.rank_of_file(cx.file) as usize;
        files
            .order
            .iter()
            .take(until.saturating_add(1))
            .any(|&other| {
                // The HIR of a leaf is freed after its task. A file that imports from such an
                // ambient module is no leaf, nor is one that comes before a file it imports from.
                let is_freed = other != cx.file && files.module(other).is_leaf;
                if is_freed || !self.is_checked_no_later_than(other, cx.file) {
                    return false;
                }
                let hir = self.hir(other);
                let is_from_module = |spec: Atom| files.module_of_specifier(other, spec) == module;
                hir.imports.iter().any(|import| {
                    import.named.iter().any(|s| is_requested(hir[s].imported))
                        && is_from_module(import.spec)
                }) || hir.exports.iter().any(|export| {
                    export.items.iter().any(|s| is_requested(hir[s].local))
                        && is_from_module(export.spec)
                })
            })
    }

    /// `checkImportDeclaration`
    fn modules_import(&mut self, cx: &Cx<'_>, s: StmtId, i: ImportId, around: Around) {
        let (hir, files) = (self.hir(cx.file), self.files());
        let (import, pos) = (hir[i], hir[s].start);
        let context_error = if cx.is_js { 1473 } else { 1232 };
        if self.check_grammar_module_element_context(cx, s, around, context_error) {
            self.modules_resolve_aliases_of_import_if_used(cx, i);
            return;
        }
        if self.modules_is_in_valid_position(cx, s, import.spec, false, around)
            && !self.check_grammar_import_clause(cx, i)
        {
            let is_ambient = self.modules_is_ambient(cx, s, around);
            let is_missing = self.modules_module_is_missing(cx, s, import.spec, around);
            self.check_import_binding(cx, Decl::ImportDefault(i), import.default, is_ambient);
            self.check_import_binding(cx, Decl::ImportNamespace(i), import.namespace, is_ambient);
            // The names in braces are checked once the module is resolved.
            for s in import.named.iter().filter(|_| !is_missing) {
                self.check_import_binding(cx, Decl::ImportSpec(s), hir[s].local, is_ambient);
                // `checkModuleExportName` for the name before `as`.
                if hir[s].imported_pos != hir[s].pos {
                    self.modules_module_export_name(cx, hir[s].imported_pos);
                }
            }
            // 1543: `isOnlyImportableAsDefault`, `hasTypeJsonImportAttribute`
            if !import.type_only
                && (ModuleKind::Node18..=ModuleKind::NodeNext).contains(&files.options.module)
                && let Some(written) = cx.specifier(pos, import.spec)
                && written.kind != SpecifierKind::SideEffect
                && let Some(module) = self.resolve_external_module_name_ignoring_errors(
                    cx.file,
                    import.spec,
                    files.mode_of_import(cx.file, import.mode),
                )
                && files.is_only_importable_as_default(cx.file, module)
                && !self
                    .modules_get_import_attributes(cx.file, hir[s].loc)
                    .is_some_and(|(.., attributes)| {
                        attributes.iter().map(|attribute| hir[attribute]).any(|it| {
                            it.key.name().map(|name| self.atoms().bytes(name)) == Some(b"type")
                                && self
                                    .modules_string_literal_like(cx.file, it.value)
                                    .is_some_and(|(value, _)| self.atoms().bytes(value) == b"json")
                        })
                    })
            {
                self.error_at(
                    (cx.file, written.pos, 0),
                    1543,
                    &[Arg::Bytes(files.options.module.name())],
                );
            }
        } else {
            self.modules_resolve_aliases_of_import_if_used(cx, i);
        }
        self.check_import_attributes(cx, s, import.spec, import.type_only);
    }

    /// `modules_resolve_alias_if_used` for the names that the import `i` declares.
    fn modules_resolve_aliases_of_import_if_used(&mut self, cx: &Cx<'_>, i: ImportId) {
        self.modules_resolve_alias_if_used(cx, Decl::ImportDefault(i));
        self.modules_resolve_alias_if_used(cx, Decl::ImportNamespace(i));
        for specifier in self.hir(cx.file)[i].named.iter() {
            self.modules_resolve_alias_if_used(cx, Decl::ImportSpec(specifier));
        }
    }

    /// `checkGrammarImportClause`
    fn check_grammar_import_clause(&mut self, cx: &Cx<'_>, i: ImportId) -> bool {
        let hir = self.hir(cx.file);
        let import = hir[i];
        let has_named_imports = cx.has_named_imports(&import);
        let clause = (cx.file, import.clause_start, import.clause_end);
        let (at, code) = if import.type_only {
            let has_named_bindings = import.namespace.is_some() || has_named_imports;
            let mut specifiers = import.named.iter();
            if import.default.is_some()
                && has_named_bindings
                && !hir.is_in_jsdoc(import.clause_start)
            {
                (clause, 1363)
            // `checkGrammarTypeOnlyNamedImportsOrExports`
            } else if let Some(specifier) = specifiers.find(|&it| hir[it].type_only) {
                ((cx.file, hir[specifier].start, 0), 2206)
            } else {
                return false;
            }
        } else if !import.is_deferred {
            return false;
        } else if import.default.is_some() {
            (clause, 18058)
        } else if has_named_imports {
            (clause, 18059)
        } else if !matches!(
            self.p.files.options.module,
            ModuleKind::EsNext | ModuleKind::Preserve
        ) {
            (clause, 18060)
        } else {
            return false;
        };
        if cx.grammar {
            self.error_at(at, code, &[]);
        }
        cx.grammar
    }

    /// `checkImportBinding` for the declaration `decl` of `name`, but for `checkModuleExportName`.
    fn check_import_binding(&mut self, cx: &Cx<'_>, decl: Decl, name: Atom, is_ambient: bool) {
        self.check_collisions_for_declaration_name(cx.file, decl, name);
        self.check_alias_symbol(cx.file, &cx.aliases, decl, is_ambient);
    }

    /// `resolveExternalModuleName(usage, usage, true /*ignoreErrors*/)` for the specifier `spec` in
    /// `file`. Without an `errorNode` there is no `resolutionDiagnostic`: a file that only needs
    /// `allowArbitraryExtensions` is found, if the program has it for another reason.
    fn resolve_external_module_name_ignoring_errors(
        &self,
        file: FileId,
        spec: Atom,
        mode: ResolutionMode,
    ) -> Option<Sym> {
        let (files, importing) = (self.files(), self.files().module(file));
        let mut arbitrary = importing.arbitrary_extension_imports.iter();
        let source_file = arbitrary
            .position(|&u| u == (spec, mode))
            .and_then(|index| {
                let resolved_file_name = importing.arbitrary_extension_files[index];
                files.by_path.get(self.atoms().bytes(resolved_file_name))
            });
        match source_file {
            Some(source_file) if files.module(source_file).is_module() => {
                Some(files.file_symbol(source_file))
            }
            _ => files.module_of_specifier_as(file, spec, mode),
        }
    }

    /// `checkImportEqualsDeclaration`
    fn modules_import_equals(&mut self, cx: &Cx<'_>, s: StmtId, i: ImportEqualsId, around: Around) {
        let (hir, bound, files) = (self.hir(cx.file), self.bound(cx.file), self.files());
        let (import, decl) = (hir[i], Decl::ImportEquals(i));
        let context_error = if cx.is_js { 1473 } else { 1232 };
        if self.check_grammar_module_element_context(cx, s, around, context_error) {
            self.modules_resolve_alias_if_used(cx, decl);
            return;
        }
        let is_ambient = around.is_ambient || import.flags.contains(Flags::AMBIENT);
        let names = match import.target {
            ImportEqualsTarget::Require(spec) => {
                if self.modules_is_in_valid_position(cx, s, spec, false, around) {
                    self.check_import_binding(cx, decl, import.name, is_ambient);
                    self.modules_module_is_missing(cx, s, spec, around);
                    if (ModuleKind::Es2015..=ModuleKind::EsNext).contains(&files.options.module)
                        && !import.flags.contains(Flags::TYPE_ONLY)
                        && !is_ambient
                    {
                        self.grammar_error_on_node(cx.file, s, 1202, &[]);
                    }
                } else if import.flags.contains(Flags::EXPORT)
                    && self.modules_follows_a_dot_somewhere(cx, import.name)
                {
                    self.modules_module_is_missing(cx, s, spec, around);
                } else {
                    self.modules_resolve_alias_if_used(cx, decl);
                }
                return;
            }
            ImportEqualsTarget::Entity(names) => names,
        };
        self.check_import_binding(cx, decl, import.name, is_ambient);
        if import.flags.contains(Flags::TYPE_ONLY) {
            self.grammar_error_on_node(cx.file, s, 1392, &[]);
        }
        let scope = bound.import_equals_scope[i.idx()];
        if scope.is_none() || names.is_empty() {
            return;
        }
        let first = hir[names.at(0)];
        // `getSymbolOfPartOfRightHandSideOfImportEquals`: an unqualified name is resolved as a
        // namespace.
        let meaning = if names.len() == 1 {
            SymFlags::NAMESPACE
        } else {
            SymFlags::VALUE | SymFlags::TYPE | SymFlags::NAMESPACE
        };
        let Some(target) = self.resolve_entity_name(cx.file, scope, names, meaning, false) else {
            // `canCollectSymbolAliasAccessibilityData`
            if first.text == known::empty || files.options.verbatim_module_syntax {
                return;
            }
            // `markAliasSymbolAsReferenced`: the first name of an alias that is not elided is also
            // resolved as a value.
            let value = SymFlags::VALUE | SymFlags::EXPORT_VALUE;
            if self.modules_is_marked_as_referenced(cx, i, &mut Vec::new())
                && files
                    .resolve_name(cx.file, scope, first.text, value)
                    .is_none()
            {
                let location = hir.node(names.at(0));
                let message =
                    self.get_cannot_find_name_diagnostic_for_name(cx.file, location, first.text);
                self.on_failed_to_resolve_symbol(
                    cx.file, location, None, scope, first.text, value, message,
                );
            }
            return;
        };
        let flags = files.symbol_flags(target);
        if flags == SymFlags::all() {
            return;
        }
        if flags.intersects(SymFlags::VALUE) {
            // As a value, the first name may resolve to a declaration in a nearer scope that is not
            // a namespace.
            let expected = SymFlags::VALUE | SymFlags::NAMESPACE;
            let found = files.resolve_name(cx.file, scope, first.text, expected);
            if let Some(result) = found {
                let module_name = hir.node(names.at(0));
                self.on_successfully_resolved_symbol(cx.file, module_name, scope, result, expected);
            }
            let nearest = found.and_then(|found| files.resolve_alias_as(found, expected));
            if let Some(nearest) = nearest
                && !files.flags(nearest).intersects(SymFlags::NAMESPACE)
            {
                self.error_at((cx.file, first.pos(), 0), 2437, &[Arg::Atom(first.text)]);
            }
        }
        if flags.intersects(SymFlags::TYPE) {
            self.check_type_name_is_reserved(cx.file, s, import.name, 2438);
        }
    }

    /// `aliasSymbolLinks.referenced` of the `import i = A.B`, whose target is `unknownSymbol`:
    /// whether `markAliasSymbolAsReferenced` is called for it. `seen`: those already asked about.
    fn modules_is_marked_as_referenced(
        &self,
        cx: &Cx<'_>,
        i: ImportEqualsId,
        seen: &mut Vec<ImportEqualsId>,
    ) -> bool {
        let (hir, bound, files) = (self.hir(cx.file), self.bound(cx.file), self.files());
        let (import, scope) = (hir[i], bound.import_equals_scope[i.idx()]);
        seen.push(i);
        // `markLinkedReferences`: not where nothing is emitted.
        if import.flags.contains(Flags::AMBIENT) {
            return false;
        }
        // `markImportEqualsAliasReferenced`, `markExportSpecifierAliasReferenced`, `markIdentifierAliasReferenced`
        let is_exported = import.flags.contains(Flags::EXPORT);
        let is_referenced = is_exported && is_in_appropriate_context(bound, import.stmt)
            || hir.exports.iter().enumerate().any(|(x, export)| {
                !export.has_module_specifier
                    && !export.type_only
                    && bound.export_scope[x] == scope
                    && is_in_appropriate_context(bound, export.stmt)
                    && export
                        .items
                        .iter()
                        .any(|s| !hir[s].type_only && hir[s].local == import.name)
            })
            || bound.alias_idents.iter().any(|&(e, _)| {
                !bound.is_unchecked(e.idx())
                    && !bound.is_in_type_query(e)
                    && bound.symbols[bound.expr_symbol[e.idx()].idx()]
                        .decls
                        .contains(&Decl::ImportEquals(i))
            });
        if is_referenced {
            return true;
        }
        // `markAliasSymbolAsReferenced` of another `import =`: `markIdentifierAliasReferenced` for
        // the first name of its right side.
        let Some(&symbol) = cx.aliases.get(&Decl::ImportEquals(i)) else {
            return false;
        };
        let value = SymFlags::VALUE | SymFlags::EXPORT_VALUE;
        (0..hir.import_equals.len()).any(|other| {
            let other = ImportEqualsId(other as u32);
            let from = bound.import_equals_scope[other.idx()];
            matches!(hir[other].target, ImportEqualsTarget::Entity(names)
                if !names.is_empty() && hir[names.at(0)].text == import.name)
                && !seen.contains(&other)
                && from.is_some()
                && files.resolve_name(cx.file, from, import.name, value) == Some(symbol)
                && self.modules_is_marked_as_referenced(cx, other, seen)
        })
    }

    /// `checkModuleExportName` for the name of an import or an export at `pos`, where a string
    /// literal is allowed: 18057.
    fn modules_module_export_name(&mut self, cx: &Cx<'_>, pos: u32) {
        if cx.grammar
            && matches!(
                self.p.files.options.module,
                ModuleKind::Es2015 | ModuleKind::Es2020
            )
            && self.hir(cx.file).kind != FileKind::Declaration
            && let Some(end) = string_end(cx.text, pos as usize)
        {
            self.error_at((cx.file, pos, end as u32), 18057, &[]);
        }
    }

    /// `checkExportDeclaration`, of `export { .. }`
    fn modules_export_named(&mut self, cx: &Cx<'_>, s: StmtId, x: ExportId, around: Around) {
        let hir = self.hir(cx.file);
        let export = hir[x];
        let context_error = if cx.is_js { 1474 } else { 1233 };
        if self.check_grammar_module_element_context(cx, s, around, context_error) {
            for item in export.items.iter() {
                self.modules_resolve_alias_if_used(cx, Decl::ExportSpec(item));
            }
            return;
        }
        if !export.has_module_specifier
            || self.modules_is_in_valid_position(cx, s, export.spec, true, around)
        {
            let is_ambient = self.modules_is_ambient(cx, s, around);
            let is_missing = if !export.has_module_specifier {
                false
            } else if export.items.is_empty() {
                // Without a name to resolve, nothing requests the module.
                true
            } else {
                self.modules_module_is_missing(cx, s, export.spec, around)
            };
            // `checkExportSpecifier`: `checkModuleExportName` for both names. Without `from`, a
            // string before `as` is a 1003.
            for s in export.items.iter() {
                if export.has_module_specifier && hir[s].local_pos != hir[s].pos {
                    self.modules_module_export_name(cx, hir[s].local_pos);
                }
                self.modules_module_export_name(cx, hir[s].pos);
            }
            // `checkExportSpecifier`: `checkAliasSymbol`
            for item in export.items.iter().filter(|_| !is_missing) {
                self.check_alias_symbol(cx.file, &cx.aliases, Decl::ExportSpec(item), is_ambient);
                if !export.has_module_specifier {
                    self.modules_export_specifier(cx, x, item, is_ambient);
                }
            }
            let is_in_ambient_namespace = !export.has_module_specifier && is_ambient;
            if around.module.is_some() && !around.is_ambient_module && !is_in_ambient_namespace {
                let start = hir[s].start;
                self.error_at((cx.file, start, self.end_of_stmt(cx.file, s)), 1194, &[]);
            }
        // `resolveExternalModuleNameWorker` reports nothing for what is not a string.
        } else if export.spec.is_some() {
            let mut items = export.items.iter();
            let may_be_used = around.module.is_some()
                && items.any(|s| self.modules_follows_a_dot_somewhere(cx, hir[s].exported))
                || self.modules_is_imported_by_name(cx, around, &|name| {
                    export.items.iter().any(|s| hir[s].exported == name)
                });
            if may_be_used {
                self.modules_module_is_missing(cx, s, export.spec, around);
            }
            for item in export.items.iter().filter(|_| !may_be_used) {
                self.modules_resolve_alias_if_used(cx, Decl::ExportSpec(item));
            }
        }
        self.check_import_attributes(cx, s, export.spec, export.type_only);
    }

    /// `checkExportSpecifier` for the `export { a }` `x`, which has no module specifier
    fn modules_export_specifier(
        &mut self,
        cx: &Cx<'_>,
        x: ExportId,
        s: ExportSpecId,
        is_ambient: bool,
    ) {
        let (hir, files) = (self.hir(cx.file), self.files());
        let scope = self.bound(cx.file).export_scope[x.idx()];
        let ExportSpec {
            local: name,
            local_pos: start,
            type_only,
            ..
        } = hir[s];
        // `export { "a" }`: not a name.
        if scope.is_none() || matches!(cx.text.get(start as usize), Some(b'"' | b'\'')) {
            return;
        }
        // `PropertyNameOrName`
        let location = match hir.property_name(hir.node(s)) {
            Node::NONE => hir.name(hir.node(s)),
            written => written,
        };
        let all = SymFlags::VALUE | SymFlags::TYPE | SymFlags::NAMESPACE;
        let message = self.get_cannot_find_name_diagnostic_for_name(cx.file, location, name);
        // `getTargetOfExportSpecifier`
        let is_found = files.resolve_name(cx.file, scope, name, all).is_some();
        if !is_found {
            self.on_failed_to_resolve_symbol(cx.file, location, None, scope, name, all, message);
        } else if resolves_to_umd_global(files, cx.file, scope, name, all) {
            self.error(cx.file, location, 2686, &[Arg::Atom(name)]);
        }
        let is_global = files
            .resolve_name(cx.file, scope, name, all | SymFlags::ALIAS)
            .is_some_and(|found| {
                found == files.undefined_symbol
                    || found == files.global_this_symbol
                    || self.is_first_declared_in_global_source_file(found)
            });
        if is_global {
            self.error(cx.file, location, 2661, &[Arg::Atom(name)]);
            return;
        }
        // `markLinkedReferences`: not where nothing is emitted, nor when exports are preserved
        // verbatim.
        // `markIdentifierAliasReferenced`: a name that is not elided is resolved again, as a value.
        if !is_found
            && !is_ambient
            && !type_only
            && !hir[x].type_only
            && !files.options.verbatim_module_syntax
        {
            let meaning = SymFlags::VALUE | SymFlags::EXPORT_VALUE;
            self.on_failed_to_resolve_symbol(
                cx.file, location, None, scope, name, meaning, message,
            );
        }
    }

    /// `checkExportDeclaration`, of `export * from` and `export * as alias from`
    fn modules_export_star(&mut self, cx: &Cx<'_>, s: StmtId, around: Around) {
        let files = self.files();
        let statement = self.hir(cx.file)[s];
        let pos = statement.start;
        let StmtKind::ExportStar {
            spec,
            alias,
            type_only: is_type_only,
            alias_pos,
            ..
        } = statement.kind
        else {
            return;
        };
        // `checkExternalModuleExports` asks for the exports of the file, and
        // `getExportsOfModuleWorker` resolves the module of every `export *` among them. With an
        // `export =` it visits what that resolves to in place of the file.
        let bound = self.bound(cx.file);
        let is_of_file = |it: &(SymbolId, StmtId)| it.0 == bound.file_symbol && it.1 == s;
        let is_resolved_for_file = alias.is_none()
            && bound.export_stars.iter().any(is_of_file)
            && (files.export(files.file_symbol(cx.file), known::export_equals)).is_none();
        let context_error = if cx.is_js { 1474 } else { 1233 };
        if self.check_grammar_module_element_context(cx, s, around, context_error) {
            if is_resolved_for_file {
                self.modules_module_is_missing(cx, s, spec, around);
            }
            self.modules_resolve_alias_if_used(cx, Decl::ExportStarAs(s));
            return;
        }
        if self.modules_is_in_valid_position(cx, s, spec, true, around) {
            if !self.modules_module_is_missing(cx, s, spec, around)
                && let Some(module) = files.module_of_specifier(cx.file, spec)
            {
                // `hasExportAssignmentSymbol`
                if files.export(module, known::export_equals).is_some() {
                    if let Some(written) = cx.specifier(pos, spec) {
                        self.error_at((cx.file, written.pos, 0), 2498, &[Arg::Sym(module)]);
                    }
                } else {
                    let is_ambient = self.modules_is_ambient(cx, s, around);
                    self.check_alias_symbol(
                        cx.file,
                        &cx.aliases,
                        Decl::ExportStarAs(s),
                        is_ambient,
                    );
                }
            }
            // `checkModuleExportName` for the name in `export * as name`, unless only 2498 is
            // reported.
            if alias.is_some()
                && !files
                    .module_of_specifier(cx.file, spec)
                    .is_some_and(|module| files.export(module, known::export_equals).is_some())
            {
                self.modules_module_export_name(cx, alias_pos);
            }
        // `resolveExternalModuleNameWorker` reports nothing for what is not a string.
        } else if spec.is_some() {
            let may_be_used = is_resolved_for_file
                || around.module.is_some()
                    && alias.is_some()
                    && self.modules_follows_a_dot_somewhere(cx, alias)
                || self.modules_is_imported_by_name(cx, around, &|name| {
                    alias.is_none() || name == alias
                });
            if may_be_used {
                self.modules_module_is_missing(cx, s, spec, around);
            } else {
                self.modules_resolve_alias_if_used(cx, Decl::ExportStarAs(s));
            }
        }
        self.check_import_attributes(cx, s, spec, is_type_only);
    }

    /// `checkExportAssignment`
    fn modules_export_assignment(
        &mut self,
        cx: &Cx<'_>,
        s: StmtId,
        e: ExprId,
        is_export_equals: bool,
        around: Around,
    ) {
        let (hir, bound, files) = (self.hir(cx.file), self.bound(cx.file), self.files());
        let start = hir[s].start;
        let context_error = if is_export_equals { 1231 } else { 1258 };
        if self.check_grammar_module_element_context(cx, s, around, context_error) {
            return;
        }
        if around.module.is_some() && !around.is_ambient_module {
            let code = if is_export_equals { 1063 } else { 1319 };
            self.error_at((cx.file, start, self.end_of_stmt(cx.file, s)), code, &[]);
            return;
        }
        let is_ambient = self.modules_is_ambient(cx, s, around);
        if is_ambient && cx.grammar && e.is_some() && !is_entity_name_expression(hir, e) {
            self.error_at(self.span_of_parenthesized_expr(cx.file, e), 2714, &[]);
        }
        // The rest concerns a compiler that processes one file at a time.
        if is_ambient || !self.p.files.options.isolated_modules {
            return;
        }
        // `isIllegalExportDefaultInCJS`: nothing else is reported then.
        if !is_export_equals && cx.verbatim_commonjs {
            self.error_at(
                (cx.file, start, self.end_of_stmt(cx.file, s)),
                cx.esm_syntax_code,
                &[],
            );
            return;
        }
        let ExprKind::Ident(name) = hir[e].kind else {
            return;
        };
        if is_parenthesized(hir, e) {
            return;
        }
        let Some(&scope) = bound.expr_scope.get(&e) else {
            return;
        };
        let Some(sym) = files.resolve_name(
            cx.file,
            scope,
            name,
            SymFlags::VALUE | SymFlags::TYPE | SymFlags::NAMESPACE,
        ) else {
            return;
        };
        let report = |c: &mut Self, equals: u32, default: u32| {
            let code = if is_export_equals { equals } else { default };
            c.error_at(
                (cx.file, hir[e].pos, 0),
                code,
                &[
                    Arg::Atom(name),
                    Arg::Bytes(isolated_modules_like_flag_name(files)),
                ],
            );
        };
        let type_only = files
            .type_only_alias_declaration_ex(sym, SymFlags::VALUE)
            .map(|type_only| type_only.file());
        let flags = files.symbol_flags(sym);
        if cx.is_verbatim {
            if !flags.intersects(SymFlags::VALUE) {
                report(self, 1282, 1284);
            } else if type_only.is_some() {
                report(self, 1283, 1285);
            }
        }
        let own = files.flags(sym);
        if !own.intersects(SymFlags::VALUE) {
            let elsewhere = files.symbol_flags_ex(sym, false, true);
            if own.contains(SymFlags::ALIAS)
                && elsewhere.intersects(SymFlags::TYPE)
                && !elsewhere.intersects(SymFlags::VALUE)
                && type_only != Some(cx.file)
            {
                report(self, 1291, 1292);
            } else if type_only.is_some_and(|of| of != cx.file) {
                let related = self.type_only_declaration_related(sym, self.atom_text(name));
                report(self, 1289, 1290);
                let reported = self.reported.last_mut().unwrap();
                reported.related_information.extend(related);
            }
        }
    }

    // ───────────────────────────── import attributes ─────────────────────────────

    /// `GetImportAttributes` for the declaration or the import type at `within`: the position of
    /// `with`, and the attributes as the parser stores them, an `ExprKind::Object`.
    fn modules_get_import_attributes(
        &self,
        file: FileId,
        within: TextRange,
    ) -> Option<(u32, ExprId, Span<PropId>)> {
        let hir = self.hir(file);
        let is_within = |kept: &&(u32, ExprId)| (within.pos..within.end).contains(&kept.0);
        let &(keyword, object) = hir.import_attributes.iter().find(is_within)?;
        match hir[object].kind {
            ExprKind::Object(attributes) => Some((keyword, object, attributes)),
            _ => None,
        }
    }

    /// `IsStringLiteralLike`: the text of `e`, and whether it is `IsStringLiteral`.
    fn modules_string_literal_like(&self, file: FileId, e: ExprId) -> Option<(Atom, bool)> {
        let hir = self.hir(file);
        let text = match hir[e].kind {
            ExprKind::String(text) => text,
            ExprKind::Template { exprs } if exprs.is_empty() => {
                hir.id_at(hir.template_texts(exprs), 0)
            }
            _ => return None,
        };
        // Parentheses make it another kind of node. A template without substitutions may be lowered to a `String`.
        match hir.text.get(self.start_of(file, e) as usize)? {
            b'"' | b'\'' => Some((text, true)),
            b'`' => Some((text, false)),
            _ => None,
        }
    }

    /// `IsStringLiteralLike(declaration.ModuleSpecifier())` for the declaration `s`, which names the
    /// module `spec`.
    fn modules_specifier_is_string_like(&self, file: FileId, s: StmtId, spec: Atom) -> bool {
        let hir = self.hir(file);
        let within = hir[s].loc;
        let mut expressions = hir.specifier_expressions.iter();
        match expressions.find(|&&e| (within.pos..within.end).contains(&hir[e].pos)) {
            Some(&e) => self.modules_string_literal_like(file, e).is_some(),
            None => spec.is_some(),
        }
    }

    /// `checkImportAttributes` for the declaration `s`, which names the module `spec`.
    fn check_import_attributes(&mut self, cx: &Cx<'_>, s: StmtId, spec: Atom, is_type_only: bool) {
        let within = self.hir(cx.file)[s].loc;
        let Some((start, object, attributes)) = self.modules_get_import_attributes(cx.file, within)
        else {
            return;
        };
        let node = (
            cx.file,
            start,
            self.modules_end_of_import_attributes(cx.file, object),
        );
        // `getGlobalImportAttributesTypeChecked` returns `emptyObjectType` if there is no such interface, and the check is skipped.
        let name = self.atoms().intern(b"ImportAttributes");
        if let Some(sym) = self.get_global_type(name, 0, true)
            && let Some(source) = self.get_type_from_import_attributes(cx.file, object)
        {
            // `getNullableType(importAttributesType, TypeFlagsUndefined)`
            let target = self.declared_type(sym);
            let target = self.optional(target);
            self.check_type_assignable_to(source, target, Some(node), None);
        }
        // The remaining checks report with `grammarErrorOnNode`.
        if !cx.grammar {
            return;
        }
        let overrides = self.get_resolution_mode_override(node, attributes, is_type_only);
        if is_type_only && overrides {
            return;
        }
        // `SupportsImportAttributes`
        let kind = self.p.files.options.module;
        let code = if !((ModuleKind::Node18..=ModuleKind::NodeNext).contains(&kind)
            || matches!(kind, ModuleKind::Preserve | ModuleKind::EsNext))
        {
            2823
        } else if self.modules_specifier_is_string_like(cx.file, s, spec)
            && self.modules_emits_commonjs(cx.file)
        {
            // `getEmitSyntaxForModuleSpecifierExpression`
            2856
        } else if is_type_only {
            2857
        } else if overrides {
            1454
        } else {
            return;
        };
        self.error_at(node, code, &[]);
    }

    /// `node.End()` of the `ImportAttributes` whose attributes are `object`. 0 without a `{`: the
    /// end of the keyword.
    fn modules_end_of_import_attributes(&self, file: FileId, object: ExprId) -> u32 {
        let hir = self.hir(file);
        if hir.text.get(hir[object].pos as usize) == Some(&b'{') {
            hir[object].end
        } else {
            0
        }
    }

    /// `getResolutionModeOverride`: whether `attributes`, the `node`, specify the resolution mode.
    fn get_resolution_mode_override(
        &mut self,
        node: super::related::Place,
        attributes: Span<PropId>,
        report_errors: bool,
    ) -> bool {
        let (file, hir) = (node.0, self.hir(node.0));
        let report = |c: &mut Self, at: super::related::Place, code: u32| {
            if report_errors {
                c.error_at(at, code, &[]);
            }
            false
        };
        if attributes.len() != 1 {
            return report(self, node, 1464);
        }
        let only = hir[attributes.at(0)];
        if !matches!(hir.text.get(only.pos as usize), Some(b'"' | b'\'')) {
            return false;
        }
        if only.key.name().map(|name| self.atoms().bytes(name)) != Some(b"resolution-mode") {
            return report(self, (file, only.pos, 0), 1463);
        }
        let Some((value, _)) = self.modules_string_literal_like(file, only.value) else {
            return false;
        };
        matches!(self.atoms().bytes(value), b"import" | b"require")
            || report(self, (file, self.start_of(file, only.value), 0), 1453)
    }

    /// `HasResolutionModeOverride` for the declaration or the import type whose module specifier is
    /// `written`. Its attributes, if any, come after that specifier and before the next one.
    pub(super) fn has_resolution_mode_override(
        &mut self,
        file: FileId,
        written: SpecifierUse,
    ) -> bool {
        let later = self.hir(file).specifier_uses.iter().map(|u| u.pos);
        let within = TextRange {
            pos: written.pos,
            end: later
                .filter(|&pos| pos > written.pos)
                .min()
                .unwrap_or(u32::MAX),
        };
        self.modules_get_import_attributes(file, within)
            .is_some_and(|(.., attributes)| {
                self.get_resolution_mode_override((file, 0, 0), attributes, false)
            })
    }

    /// `getTypeFromImportAttributes`. `None`: the type of a value is unknown.
    fn get_type_from_import_attributes(&mut self, file: FileId, object: ExprId) -> Option<TypeId> {
        let hir = self.hir(file);
        let ExprKind::Object(attributes) = hir[object].kind else {
            return None;
        };
        let mut props: ArenaVec<Prop> = ArenaVec::with_capacity_in(attributes.len(), self.arena);
        for attribute in attributes.iter() {
            let (name, value) = (hir[attribute].key.name()?, hir[attribute].value);
            let ty = self.type_of_expr(file, value);
            let ty = self.regular(ty);
            // `members[member.Name] = member`: the last attribute with a given name wins.
            props.retain(|p| p.name != name);
            props.push(Prop {
                name,
                flags: PropFlags::empty(),
                source: PropSource::Type(ty),
                mapper: MapperId::IDENTITY,
            });
        }
        Some(self.synth(Shape {
            props,
            ..Shape::new_in(self.arena)
        }))
    }

    /// `checkImportType`: `getResolutionModeOverride`
    fn modules_import_calls_and_types(&mut self, cx: &Cx<'_>) {
        let (hir, bound) = (self.hir(cx.file), self.bound(cx.file));
        if !cx.grammar || hir.import_attributes.is_empty() {
            return;
        }
        for (i, node) in hir.types.iter().enumerate() {
            if !matches!(node.kind, TypeNodeKind::Import { .. }) || bound.is_unchecked_type(i) {
                continue;
            }
            let within = TextRange {
                pos: node.pos,
                end: self.end_of_type_node(cx.file, TypeNodeId(i as u32)),
            };
            if let Some((_, object, attributes)) =
                self.modules_get_import_attributes(cx.file, within)
            {
                // The `ImportAttributes` node starts at the inner `{`: `with` is a property of the enclosing object literal.
                let end = self.modules_end_of_import_attributes(cx.file, object);
                let node = (cx.file, hir[object].pos, end);
                self.get_resolution_mode_override(node, attributes, true);
            }
        }
    }
}

// ───────────────────────────── whether the file parses ─────────────────────────────

// ───────────────────────────── module names ─────────────────────────────

/// The import or export statement that the alias declaration `decl` is, or is a part of.
fn statement_of_alias_declaration(hir: &hir::File, decl: Decl) -> Option<StmtId> {
    let s = match decl {
        Decl::ImportDefault(x) | Decl::ImportNamespace(x) => hir[x].stmt,
        Decl::ImportSpec(specifier) => hir[hir[specifier].import].stmt,
        Decl::ImportEquals(x) => hir[x].stmt,
        Decl::ExportSpec(specifier) => hir[hir[specifier].export].stmt,
        Decl::ExportStarAs(s) | Decl::ExportExpr(s) => s,
        _ => StmtId::NONE,
    };
    s.is_some().then_some(s)
}

/// `isInAppropriateContext` of `checkGrammarModuleElementContext` for the statement `s`.
fn is_in_appropriate_context(bound: &Bound, s: StmtId) -> bool {
    let parent = bound.stmt_parent.get(s.idx());
    matches!(parent, Some(Parent::File | Parent::Module(_)))
}

// ───────────────────────────── message arguments ─────────────────────────────

/// `getIsolatedModulesLikeFlagName`
pub(super) fn isolated_modules_like_flag_name(files: &Files) -> &'static [u8] {
    if files.options.verbatim_module_syntax {
        b"verbatimModuleSyntax"
    } else {
        b"isolatedModules"
    }
}

// ───────────────────────────── import attributes in the source text ─────────────────────────────

// ───────────────────────────── scanning the source text ─────────────────────────────

/// The start of the first token of the file. The scanner skips a byte order mark and a `#!` line there like trivia.
fn first_token_start(text: &[u8]) -> u32 {
    let mut at = if text.starts_with(b"\xEF\xBB\xBF") {
        3
    } else {
        0
    };
    if text[at..].starts_with(b"#!") {
        at += bun_core::strings::index_of_any(&text[at..], b"\n\r").unwrap_or(text.len() - at);
    }
    skip_trivia(text, at) as u32
}

/// The position after the string literal that opens at `at`.
fn string_end(text: &[u8], at: usize) -> Option<usize> {
    let quote = *text.get(at)?;
    if quote != b'"' && quote != b'\'' {
        return None;
    }
    let mut i = at + 1;
    loop {
        match *text.get(i)? {
            b'\\' => i += 2,
            b'\n' | b'\r' => return None,
            c if c == quote => return Some(i + 1),
            _ => i += 1,
        }
    }
}

/// The start of the string literal that ends at `end`.
fn string_start(text: &[u8], end: usize) -> Option<usize> {
    let mut open = end.checked_sub(1)?;
    let quote = *text.get(open)?;
    loop {
        open = text[..open].iter().rposition(|&c| c == quote)?;
        // An odd number of backslashes escapes the quote.
        if text[..open]
            .iter()
            .rev()
            .take_while(|&&c| c == b'\\')
            .count()
            % 2
            == 0
        {
            return (string_end(text, open) == Some(end)).then_some(open);
        }
    }
}

/// The start of the first token of a statement list in braces. `None` if the HIR has no statement of the list.
fn statement_list_start(hir: &hir::File, statements: IdList<StmtId>) -> Option<u32> {
    let text = &hir.text[..];
    let first = hir.ids(statements).next()?;
    let mut start = hir[first].start as usize;
    // The HIR drops directives, empty statements and `debugger` statements. They can precede `first`.
    loop {
        let end = skip_trivia_back(text, start);
        let token_start = match text[..end].last() {
            Some(b';') => Some(end - 1),
            Some(b'"' | b'\'') => string_start(text, end),
            _ => Some(word_start(text, end)).filter(|&word| &text[word..end] == b"debugger"),
        };
        match token_start {
            Some(token_start) => start = token_start,
            None => return Some(start as u32),
        }
    }
}
