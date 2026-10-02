//! Modules, namespaces, imports and exports that are out of place, lead nowhere or do not go with the options:
//!
//! * `bindModuleDeclaration`: 2668 5061; `bindNamespaceExportDeclaration`: 1184 1314 1315 1316
//! * `checkModuleDeclaration`: 1035 1280 1287 1540 2435 2436 2669 2670; `checkModuleAugmentationElement`: 2666 2667
//! * `mergeModuleAugmentation`, and what `resolveExternalModule` and `mergeSymbol` say on its behalf: 2306 2567 2649 2664 2665 2671 2732 2834 2835
//! * `checkExternalImportOrExportDeclaration`: 1147 1194 2439 2858
//! * `collectModuleReferences`, by way of `resolveExternalModule`: 2307 2580 2591 2732 2882, said or taken back
//! * `checkImportAttributes`, `getTypeFromImportAttributes`, `checkImportType`, `getResolutionModeOverride`: 1453 1454 1463 1464 2322
//!   2823 2856 2857
//! * `checkImportEqualsDeclaration`: 2437 2438; `checkExportDeclaration`: 1194 2498; `checkClassDeclaration`: 1211
//! * `checkExportAssignment`: 1063 1319 1282 1283 1284 1285 1289 1290 1291 1292
//! * `getVerbatimModuleSyntaxErrorMessage`, from `checkAliasSymbol`, `checkExportAssignment` and `checkGrammarImportCallExpression`: 1286 1295
//! * `reportObviousModifierErrors`, of `static { }`: 1184
//! * `checkGrammarModuleElementContext`: 1231 1232 1233 1234 1235 1258 1473 1474
//! * `getTypeFromImportTypeNode`: 1339 1340; `checkGrammarImportClause`: 18060
//! * `reportFlowControlError`: 2563
//!
//! All of TypeScript 7.0.2's checker.go, flow.go, grammarchecks.go, binder.go and parser/references.go. Only
//! `check_import_attributes` and `check_flow_too_deep` ask for types.
//!
//! The summary of a file keeps neither modifiers nor keywords: they are read from the text, from a place the summary does have.
//! Of a declaration file there is no text, and what can only be read is not looked for.

use super::errors_x_enums_names::means_umd_global;
use super::*;
use crate::bind::{Decl, MemberOwner, Parent, ScopeId};
use crate::resolve::{ModuleKind, is_relative};

/// What is the same all over a file.
struct Cx<'a> {
    file: FileId,
    text: &'a [u8],
    /// Where module specifiers are written, in the order of the text.
    uses: &'a [SpecifierUse],
    /// `IsExternalModule`, as the program has it.
    is_module: bool,
    /// Not `hasParseDiagnostics`: what `grammarErrorOnNode` has to say is only said of a file that parses.
    grammar: bool,
    /// `IsInJSFile`
    is_js: bool,
    /// `verbatimModuleSyntax`
    is_verbatim: bool,
    /// `verbatimModuleSyntax`, in a file `GetEmitModuleFormatOfFile` has for CommonJS.
    verbatim_commonjs: bool,
    /// `getVerbatimModuleSyntaxErrorMessage`
    esm_syntax_code: u32,
    /// `node.Symbol`, of the declarations of aliases.
    aliases: FxHashMap<Decl, Sym>,
}

/// What a list of statements is the body of.
#[derive(Copy, Clone)]
struct Around {
    /// `NONE`: the file.
    module: ModuleId,
    /// `IsAmbientModule`
    is_ambient_module: bool,
    /// `IsExternalModuleAugmentation`
    is_augmentation: bool,
    /// The module is written at the top of the file.
    is_top_level: bool,
    /// `NodeFlagsAmbient`
    is_ambient: bool,
}

impl Cx<'_> {
    /// The module specifier of the statement at `pos`, which says `spec`.
    fn specifier(&self, pos: u32, spec: Atom) -> Option<SpecifierUse> {
        let at = self.uses.partition_point(|u| u.pos < pos);
        self.uses.get(at).copied().filter(|u| u.spec == spec)
    }
}

impl Checker<'_> {
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
            let mut uses = hir.specifier_uses.clone();
            uses.retain(|u| !u.kind.is_call());
            uses.sort_unstable_by_key(|u| u.pos);
            sorted = uses;
            &sorted
        };
        // NEEDS: `Options::verbatim_module_syntax: bool`, what `compilerOptions.verbatimModuleSyntax` says
        let is_verbatim = self.p.files.options.verbatim_module_syntax;
        let cx = Cx {
            file,
            text: &hir.text,
            is_module: module.is_module(),
            // `tryParseImportAttributes`, `parseImportType`: `assert` where `with` belongs is an error of the parser's.
            grammar: !has_parse_diagnostics(hir)
                && !hir.early_errors.iter().any(|&(_, code)| code == 2880),
            is_js: hir.is_js,
            is_verbatim,
            verbatim_commonjs: is_verbatim && self.xm_emits_commonjs(file),
            esm_syntax_code: self.verbatim_module_syntax_error_message(file),
            aliases: self.symbols_of_alias_declarations(file),
            uses,
        };
        let top = Around {
            module: ModuleId::NONE,
            is_ambient_module: false,
            is_augmentation: false,
            is_top_level: false,
            is_ambient: hir.kind == FileKind::Declaration,
        };
        self.xm_statements(&cx, hir.body, top);
        self.xm_statements_out_of_place(&cx, top);
        self.xm_statements_in_blocks(&cx);
        self.xm_static_blocks(&cx);
        self.xm_import_calls_and_types(&cx);
        // A circle goes through a file by an alias others can get at, or by one that stands for another name of the file.
        let can_be_circular = cx.aliases.keys().any(|d| {
            matches!(
                d,
                Decl::ImportEquals(_)
                    | Decl::ExportSpec(_)
                    | Decl::ExportStarAs(_)
                    | Decl::ExportExpr(_)
            )
        });
        for (&decl, &sym) in &cx.aliases {
            // `checkVariableLikeDeclaration`
            if matches!(decl, Decl::Require(_)) {
                self.check_alias_symbol(file, &cx.aliases, StmtId::NONE, decl, false);
            }
            // `resolveAlias`: at `getDeclarationOfAliasSymbol`
            if can_be_circular
                && self.files().alias_links(sym).is_circular
                && self.files().declaration_of_alias_symbol(sym) == Some((file, decl))
                && let Some(at) = self.place_of_alias_declaration(Sym { file, ..sym }, decl)
            {
                self.error_at(at, 2303, &[Arg::Sym(sym)]);
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
        let mut reported = Parent::None;
        for i in 0..hir.exprs.len() {
            let e = ExprId(i as u32);
            if !matches!(hir[e].kind, ExprKind::Ident(_) | ExprKind::Dot { .. } | ExprKind::Index { .. } | ExprKind::This)
                || bound.is_unchecked(i)
                // `checkWithStatement` does not check the body.
                || hir.is_in_with(hir[e].pos)
            {
                continue;
            }
            // Ensures that the flow of `e` has been walked. The type is cached if an earlier pass asked for it.
            self.type_of_expr(file, e);
            if self.p.flows_too_deep.len() == 0 || self.p.flows_too_deep.get(&(file, e)).is_none() {
                continue;
            }
            let block = self.function_or_module_block_of(file, e);
            // Consecutive references usually share a block.
            if block == reported {
                continue;
            }
            // `GetRangeOfTokenAtPosition(sourceFile, block.StatementList().Pos())`
            let start = match block {
                Parent::File => Some(first_token_start(&hir.text)),
                Parent::Module(m) => statement_list_start(hir, hir[m].body),
                Parent::FnBody(f) => match hir[f].body {
                    FnBody::Block(statements) => statement_list_start(hir, statements),
                    _ => None,
                },
                _ => None,
            };
            if let Some(start) = start {
                reported = block;
                self.error_at((file, start, 0), 2563, &[]);
            }
        }
    }

    /// `GetEmitModuleFormatOfFile(file) == ModuleKindCommonJS`
    pub(super) fn xm_emits_commonjs(&self, file: FileId) -> bool {
        self.emit_module_format_of_file(file) == ModuleKind::CommonJs
    }

    /// `GetEmitModuleFormatOfFile`
    pub(super) fn emit_module_format_of_file(&self, file: FileId) -> ModuleKind {
        match self.files().module(file).implied_format {
            ResolutionMode::Require => ModuleKind::CommonJs,
            ResolutionMode::Import => ModuleKind::EsNext,
            ResolutionMode::None => self.p.files.options.module,
        }
    }

    /// The statements of the file or of the body of a module.
    fn xm_statements(&mut self, cx: &Cx<'_>, list: IdList<StmtId>, around: Around) {
        let hir = self.hir(cx.file);
        for s in hir.ids(list) {
            let Stmt {
                start, modifiers, ..
            } = hir[s];
            match hir[s].kind {
                StmtKind::Module(m) => self.xm_module(cx, list, s, m, around),
                StmtKind::Import(i) => self.xm_import(cx, s, i, around),
                StmtKind::ImportEquals(i) => self.xm_import_equals(cx, s, i, around),
                StmtKind::ExportNamed(x) => self.xm_export_named(cx, s, x, around),
                StmtKind::ExportStar { .. } => self.xm_export_star(cx, s, around),
                StmtKind::ExportDefault(e) => self.xm_export_assignment(cx, s, e, false, around),
                StmtKind::ExportAssign(e) => self.xm_export_assignment(cx, s, e, true, around),
                // `bindNamespaceExportDeclaration`: `export as namespace N` takes no modifiers, and belongs at the top of a declaration
                // file that is a module.
                StmtKind::ExportAsNamespace(_) => {
                    if !modifiers.is_empty() {
                        self.error_at((cx.file, start, self.end_of_stmt(cx.file, s)), 1184, &[]);
                    }
                    let code = if around.module.is_some() {
                        1316
                    } else if !cx.is_module {
                        1314
                    } else if hir.kind != FileKind::Declaration {
                        1315
                    } else {
                        continue;
                    };
                    self.error_at((cx.file, start, self.end_of_stmt(cx.file, s)), code, &[]);
                }
                _ => {}
            }
        }
    }

    // ───────────────────────────── module declarations ─────────────────────────────

    /// `bindModuleDeclaration`, `checkModuleDeclaration`
    fn xm_module(
        &mut self,
        cx: &Cx<'_>,
        list: IdList<StmtId>,
        s: StmtId,
        m: ModuleId,
        around: Around,
    ) {
        let (hir, files) = (self.hir(cx.file), self.files());
        let module = hir[m];
        let name_pos = module.name_pos;
        let start = hir[s].start;
        let is_global = module.name == ModuleName::Global;
        let is_ambient_module = !matches!(module.name, ModuleName::Ident(_));
        let is_ambient = around.is_ambient || module.flags.contains(Flags::AMBIENT);
        let is_at_top = around.module.is_none();
        // `IsModuleAugmentationExternal`
        let adds_to_another = if is_at_top {
            cx.is_module
        } else {
            around.is_ambient_module && around.is_top_level && !cx.is_module
        };
        let is_augmentation = is_ambient_module && adds_to_another;
        let inner = Around {
            module: m,
            is_ambient_module,
            is_augmentation,
            is_top_level: is_at_top,
            is_ambient,
        };
        self.xm_statements(cx, module.body, inner);

        if is_ambient_module {
            // The flag is also on what is written in an exported one: only the word counts.
            if module.flags.contains(Flags::EXPORT)
                && hir.find_modifier(hir[s].modifiers, Flags::EXPORT).is_some()
            {
                self.error_at((cx.file, start, 0), 2668, &[]);
            }
            // `TryParsePattern`
            if !is_augmentation
                && let ModuleName::String(name) = module.name
                && files
                    .atoms
                    .bytes(name)
                    .iter()
                    .filter(|&&c| c == b'*')
                    .count()
                    > 1
            {
                self.error_at((cx.file, name_pos, 0), 5061, &[Arg::Atom(name)]);
            }
        }

        if is_global
            && !around.is_ambient
            && hir
                .find_modifier(hir[s].modifiers, Flags::AMBIENT)
                .is_none()
        {
            self.error_at((cx.file, name_pos, 0), 2670, &[]);
        }
        if cx.grammar && !is_ambient && matches!(module.name, ModuleName::String(_)) {
            self.error_at((cx.file, name_pos, 0), 1035, &[]);
        }
        if module.says_module {
            self.error_at((cx.file, name_pos, 0), 1540, &[]);
        }
        // Both are about options that keep `const enum`s, so that a namespace of nothing else counts as well.
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
            // What was not added to anything is not gone through: it would be one error after the other.
            let check_body = match module.name {
                ModuleName::String(name) => self.xm_merge_augmentation(cx, list, m, name, around),
                _ => true,
            };
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
        } else if !is_at_top {
            self.error_at((cx.file, name_pos, 0), 2435, &[]);
        } else if let ModuleName::String(name) = module.name
            && is_relative(files.atoms.bytes(name))
        {
            self.error_at((cx.file, name_pos, 0), 2436, &[]);
        }
    }

    /// `mergeModuleAugmentation`: whether what `m` declares was added to the module called `name`. What is wrong with that is said
    /// of the first declaration in the file.
    fn xm_merge_augmentation(
        &mut self,
        cx: &Cx<'_>,
        list: IdList<StmtId>,
        m: ModuleId,
        name: Atom,
        around: Around,
    ) -> bool {
        let (hir, bound, files) = (self.hir(cx.file), self.bound(cx.file), self.files());
        let text = files.atoms.bytes(name);
        // `collectModuleReferences`: whether it is one of `ModuleAugmentations` at all.
        let is_collected = if around.module.is_none() {
            around.is_ambient || hir[m].flags.contains(Flags::AMBIENT)
        } else {
            around.is_ambient && !is_relative(text)
        };
        let symbol = bound.module_symbol[m.idx()];
        if !is_collected || symbol.is_none() {
            return false;
        }
        // All that goes by one quoted name in a file is one symbol here. `declareModuleSymbol` has one for each place they are in.
        let decls = &bound.symbols[symbol.idx()].decls;
        let is_here = |part: ModuleId| {
            hir.ids(list)
                .any(|s| matches!(hir[s].kind, StmtKind::Module(x) if x == part))
        };
        let first = decls.iter().find_map(|&d| match d {
            Decl::Module(part) if is_here(part) => Some(part),
            _ => None,
        });
        let start = hir[m].name_pos;
        let report = |c: &mut Self, code: u32, of_each: bool, args: &[Arg<'_>]| {
            if of_each || first == Some(m) {
                c.error_at((cx.file, start, 0), code, args);
            }
        };
        // `resolveExternalModuleNameWorker(moduleName, moduleName, moduleNotFoundError, false, true)`. Names written where everything is only
        // declared are not held against anybody.
        if first == Some(m) {
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
        let Some(found) = self.xm_module_of_specifier(cx.file, name) else {
            return false;
        };
        // `resolveExternalModuleSymbol`
        let main = files.module_value(found);
        let flags = files.flags(main);
        if !flags.intersects(SymFlags::NAMESPACE) {
            // An alias here is one that could not be followed.
            if !flags.contains(SymFlags::ALIAS) {
                report(self, 2671, false, &[Arg::Atom(name)]);
            }
            return false;
        }
        // `mergeSymbol`, `SymbolFlagsValueModuleExcludes`: a module with values in it goes with neither a variable nor a `const enum`,
        // whatever else goes by the name.
        let is_variable = flags.intersects(SymFlags::VARIABLE);
        let is_const_enum = || {
            files.decls(main).iter().any(|&(of, d)| matches!(d, Decl::Enum(e) if files.hir(of)[e].flags.contains(Flags::CONST)))
        };
        let has_values = || {
            decls.iter().any(|&d| matches!(d, Decl::Module(part) if is_here(part) && bound.module_instance_state[part.idx()] != ModuleInstanceState::NonInstantiated))
        };
        if (is_variable || flags.intersects(SymFlags::ENUM) && is_const_enum()) && has_values() {
            if flags.contains(SymFlags::NAMESPACE_MODULE) {
                report(self, 2649, false, &[Arg::Sym(main)]);
            } else if !is_variable {
                // `reportMergeSymbolError`, of the declarations on this side.
                report(self, 2567, true, &[]);
            }
            return false;
        }
        true
    }

    pub(super) fn xm_is_a_file(&self, module: Sym) -> bool {
        self.files().symbol(module).decls.contains(&Decl::File)
    }

    /// Whether a file that is no module declares the module `sym` at its top. Those are what `tryFindAmbientModule` and
    /// `patternAmbientModules` have.
    pub(super) fn xm_is_declared_by_a_script(&self, sym: Sym) -> bool {
        let files = self.files();
        files.decls(sym).iter().any(|&(of, decl)| {
            let hir = files.hir(of);
            matches!(decl, Decl::Module(m)
                if !files.module(of).is_module() && hir.ids(hir.body).any(|s| matches!(hir[s].kind, StmtKind::Module(top) if top == m)))
        })
    }

    /// The module `spec` means in `file`, which is a file or what a script declares. A `declare module` that declares nothing to
    /// `resolveExternalModule` is not it, and does not stand in the way of a file either.
    fn xm_module_of_specifier(&self, file: FileId, spec: Atom) -> Option<Sym> {
        let files = self.files();
        let found = files.module_of_specifier(file, spec)?;
        if self.xm_is_a_file(found) || self.xm_is_declared_by_a_script(found) {
            return Some(found);
        }
        let target = files.module(file).imported_file(spec)?;
        files
            .module(target)
            .is_module()
            .then(|| files.file_symbol(target))
    }

    // ───────────────────────────── imports and exports ─────────────────────────────

    /// `checkExternalImportOrExportDeclaration`, of the statement `s` that names the module `spec`.
    fn xm_is_in_place(
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
            // `isTopLevelInExternalModuleAugmentation`: there it has been said that the statement has no business being there.
            if !around.is_augmentation && is_relative(self.files().atoms.bytes(spec)) {
                self.error_at((cx.file, start, self.end_of_stmt(cx.file, s)), 2439, &[]);
                return false;
            }
        }
        // The values of its attributes are strings.
        let hir = self.hir(cx.file);
        let mut are_strings = true;
        if written.is_some()
            && let Some((.., attributes)) = self.xm_get_import_attributes(cx.file, hir[s].loc)
        {
            for value in attributes.iter().map(|attribute| hir[attribute].value) {
                // The parser has reported a missing value.
                if !matches!(hir[value].kind, ExprKind::Missing)
                    && !self
                        .xm_string_literal_like(cx.file, value)
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

    /// `resolveExternalModuleName(node, node.ModuleSpecifier())`, of the statement `s`, which calls the module `spec`: whether it is at a
    /// loss.
    fn xm_module_is_missing(&mut self, cx: &Cx<'_>, s: StmtId, spec: Atom, around: Around) -> bool {
        let hir = self.hir(cx.file);
        let Some(written) = cx.specifier(hir[s].start, spec) else {
            return true;
        };
        let mut site = SpecifierSite {
            is_ambient: around.is_ambient,
            ..Default::default()
        };
        let type_only = match hir[s].kind {
            StmtKind::Import(_) if written.kind == SpecifierKind::SideEffect => true,
            StmtKind::Import(x) => {
                let import = &hir[x];
                // The module is asked for from the declaration itself if there are braces, and that says `type` nowhere.
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
            _ => return true,
        };
        site.is_emittable = !type_only;
        !self.resolve_external_module(cx.file, written, site)
    }

    /// `checkGrammarModuleElementContext` leaves the imports and exports alone that are directly in neither the file nor a namespace.
    /// Their module is looked for all the same for a name they declare (`resolveAlias`), or for the exports of the file
    /// (`getExportsOfModuleWorker`).
    fn xm_statements_out_of_place(&mut self, cx: &Cx<'_>, top: Around) {
        let (hir, bound) = (self.hir(cx.file), self.bound(cx.file));
        for (i, statement) in hir.stmts.iter().enumerate() {
            if matches!(
                bound.stmt_parent[i],
                Parent::None | Parent::File | Parent::Module(_)
            ) {
                continue;
            }
            let s = StmtId(i as u32);
            match statement.kind {
                StmtKind::Import(x) => {
                    let (import, scope) = (hir[x], bound.import_scope[x.idx()]);
                    let named = import.named.iter();
                    let used: Vec<Decl> = [
                        (import.default, Decl::ImportDefault(x)),
                        (import.namespace, Decl::ImportNamespace(x)),
                    ]
                    .into_iter()
                    .chain(named.map(|n| (hir[n].local, Decl::ImportSpec(n))))
                    .filter(|it| it.0.is_some() && self.xm_alias_is_used(cx, scope, it.0))
                    .map(|it| it.1)
                    .collect();
                    if used.is_empty() || self.xm_module_is_missing(cx, s, import.spec, top) {
                        continue;
                    }
                    for decl in used {
                        if let Some(&sym) = cx.aliases.get(&decl) {
                            self.check_target_of_alias_declaration(cx.file, sym, decl);
                        }
                    }
                }
                StmtKind::ImportEquals(x) => {
                    if let ImportEqualsTarget::Require(spec) = hir[x].target
                        && self.xm_alias_is_used(
                            cx,
                            bound.import_equals_scope[x.idx()],
                            hir[x].name,
                        )
                    {
                        self.xm_module_is_missing(cx, s, spec, top);
                    }
                }
                StmtKind::ExportStar { spec, alias, .. } if alias.is_none() && cx.is_module => {
                    self.xm_module_is_missing(cx, s, spec, top);
                }
                _ => {}
            }
        }
    }

    /// Whether the file mentions `alias`, which a statement in `scope` declares.
    fn xm_alias_is_used(&self, cx: &Cx<'_>, scope: ScopeId, alias: Atom) -> bool {
        let (hir, bound, files) = (self.hir(cx.file), self.bound(cx.file), self.files());
        let scope = bound.scopes.get(scope.idx());
        let Some(symbol) = scope.and_then(|s| bound.lookup(s.locals, alias)) else {
            return false;
        };
        let all = SymFlags::VALUE | SymFlags::TYPE | SymFlags::NAMESPACE;
        let means_it = |from: ScopeId, name: Atom| {
            name == alias
                && from.is_some()
                && files.resolve_name(cx.file, from, name, all) == Some(files.sym(cx.file, symbol))
        };
        bound.expr_symbol.iter().zip(&bound.expr_parent).any(|(&s, parent)| s == symbol && !matches!(parent, Parent::None))
            || hir.types.iter().enumerate().any(|(t, node)| match node.kind {
                TypeNodeKind::Ref { name, .. } | TypeNodeKind::Typeof { name, .. } => !name.is_empty() && means_it(bound.type_scope[t], hir[name.at(0)].text),
                _ => false,
            })
            || hir.import_equals.iter().enumerate().any(|(other, import)| {
                matches!(import.target, ImportEqualsTarget::Entity(names) if !names.is_empty() && means_it(bound.import_equals_scope[other], hir[names.at(0)].text))
            })
            || hir.exports.iter().enumerate().any(|(x, export)| export.spec.is_none() && export.items.iter().any(|s| means_it(bound.export_scope[x], hir[s].local)))
    }

    /// Whether the file has `name` after a dot, as it would be written of what a namespace exports: `N.name`.
    fn xm_follows_a_dot_somewhere(&self, cx: &Cx<'_>, name: Atom) -> bool {
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

    /// `checkImportDeclaration`
    fn xm_import(&mut self, cx: &Cx<'_>, s: StmtId, i: ImportId, around: Around) {
        let (hir, files) = (self.hir(cx.file), self.files());
        let (import, pos) = (hir[i], hir[s].start);
        if self.xm_is_in_place(cx, s, import.spec, false, around) {
            // `checkGrammarImportClause`, of `import defer ..`
            let mut is_clause_refused = false;
            if cx.grammar && import.is_deferred {
                let is_supported = matches!(
                    self.p.files.options.module,
                    ModuleKind::EsNext | ModuleKind::Preserve
                );
                let code = if import.default.is_some() {
                    Some(18058)
                } else if import.namespace.is_none() {
                    Some(18059)
                } else {
                    (!is_supported).then_some(18060)
                };
                if let Some(code) = code {
                    is_clause_refused = true;
                    let start = import.clause_start;
                    self.error_at((cx.file, start, import.clause_end), code, &[]);
                }
            }
            let is_missing = self.xm_module_is_missing(cx, s, import.spec, around);
            // `checkImportBinding`: `checkCollisionsForDeclarationName`
            if !is_clause_refused {
                let (file, statement) = (cx.file, hir.node(s));
                let clause = statement.with(Part::ImportClause);
                self.check_collisions_for_declaration_name(file, clause, import.default);
                let bindings = statement.with(Part::NamedBindings);
                self.check_collisions_for_declaration_name(file, bindings, import.namespace);
                for s in import.named.iter().filter(|_| !is_missing) {
                    self.check_collisions_for_declaration_name(file, s, hir[s].local);
                }
            }
            // `checkImportBinding`: `checkAliasSymbol`. The names in braces are looked at once the module is found.
            if !is_clause_refused {
                self.check_alias_symbol(
                    cx.file,
                    &cx.aliases,
                    s,
                    Decl::ImportDefault(i),
                    around.is_ambient,
                );
                self.check_alias_symbol(
                    cx.file,
                    &cx.aliases,
                    s,
                    Decl::ImportNamespace(i),
                    around.is_ambient,
                );
                for named in import.named.iter().filter(|_| !is_missing) {
                    self.check_alias_symbol(
                        cx.file,
                        &cx.aliases,
                        s,
                        Decl::ImportSpec(named),
                        around.is_ambient,
                    );
                }
            }
            // `checkImportBinding`: `checkModuleExportName`, of the name before `as`.
            if !is_missing && !is_clause_refused {
                for s in import.named.iter() {
                    if hir[s].imported_pos != hir[s].pos {
                        self.xm_module_export_name(cx, hir[s].imported_pos);
                    }
                }
            }
            // 1543: `isOnlyImportableAsDefault`, `hasTypeJsonImportAttribute`
            if !import.type_only
                && !is_clause_refused
                && (ModuleKind::Node18..=ModuleKind::NodeNext).contains(&files.options.module)
                && let Some(written) = cx.specifier(pos, import.spec)
                && written.kind != SpecifierKind::SideEffect
                && let Some(module) = files.module_of_specifier_as(
                    cx.file,
                    import.spec,
                    files.mode_of_import(cx.file, import.mode),
                )
                && files.is_only_importable_as_default(cx.file, module)
                && !self
                    .xm_get_import_attributes(cx.file, hir[s].loc)
                    .is_some_and(|(.., attributes)| {
                        attributes.iter().map(|attribute| hir[attribute]).any(|it| {
                            it.key.name().map(|name| files.atoms.bytes(name)) == Some(b"type")
                                && self
                                    .xm_string_literal_like(cx.file, it.value)
                                    .is_some_and(|(value, _)| files.atoms.bytes(value) == b"json")
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
            let is_used = [import.default, import.namespace]
                .into_iter()
                .chain(import.named.iter().map(|s| hir[s].local))
                .any(|name| {
                    self.xm_alias_is_used(cx, self.bound(cx.file).import_scope[i.idx()], name)
                });
            if is_used {
                self.xm_module_is_missing(cx, s, import.spec, around);
            }
        }
        self.check_import_attributes(cx, s, import.spec, import.type_only);
    }

    /// `checkImportEqualsDeclaration`
    fn xm_import_equals(&mut self, cx: &Cx<'_>, s: StmtId, i: ImportEqualsId, around: Around) {
        let (hir, bound, files) = (self.hir(cx.file), self.bound(cx.file), self.files());
        let import = hir[i];
        let is_ambient = around.is_ambient || import.flags.contains(Flags::AMBIENT);
        let names = match import.target {
            ImportEqualsTarget::Require(spec) => {
                if self.xm_is_in_place(cx, s, spec, false, around) {
                    self.check_collisions_for_declaration_name(cx.file, s, import.name);
                    self.check_alias_symbol(
                        cx.file,
                        &cx.aliases,
                        s,
                        Decl::ImportEquals(i),
                        is_ambient,
                    );
                    self.xm_module_is_missing(cx, s, spec, around);
                } else {
                    let is_used =
                        self.xm_alias_is_used(cx, bound.import_equals_scope[i.idx()], import.name);
                    let may_be_used = import.flags.contains(Flags::EXPORT)
                        && self.xm_follows_a_dot_somewhere(cx, import.name);
                    if is_used || may_be_used {
                        self.xm_module_is_missing(cx, s, spec, around);
                    }
                }
                return;
            }
            ImportEqualsTarget::Entity(names) => names,
        };
        self.check_collisions_for_declaration_name(cx.file, s, import.name);
        self.check_alias_symbol(cx.file, &cx.aliases, s, Decl::ImportEquals(i), is_ambient);
        let scope = bound.import_equals_scope[i.idx()];
        if scope.is_none() || names.is_empty() {
            return;
        }
        let first = hir[names.at(0)];
        // `getSymbolOfPartOfRightHandSideOfImportEquals`: a name on its own is the name of a namespace.
        let meaning = if names.len() == 1 {
            SymFlags::NAMESPACE
        } else {
            SymFlags::VALUE | SymFlags::TYPE | SymFlags::NAMESPACE
        };
        let Some(target) = self.resolve_entity_name(cx.file, scope, names, meaning, false) else {
            // `markLinkedReferences`: not where nothing is emitted, nor when imports stay as they are written.
            if first.text == known::empty
                || import.flags.contains(Flags::AMBIENT)
                || files.options.verbatim_module_syntax
            {
                return;
            }
            // `markImportEqualsAliasReferenced`, `markExportSpecifierAliasReferenced`, `markIdentifierAliasReferenced`
            let is_referenced = import.flags.contains(Flags::EXPORT)
                || hir.exports.iter().enumerate().any(|(x, export)| {
                    export.spec.is_none()
                        && !export.type_only
                        && bound.export_scope[x] == scope
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
            // `markAliasSymbolAsReferenced`: the first name of an alias that is kept is looked up as a value as well.
            let value = SymFlags::VALUE | SymFlags::EXPORT_VALUE;
            if is_referenced
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
            // As a value, the first name may mean something nearer by that is no namespace.
            let wanted = SymFlags::VALUE | SymFlags::NAMESPACE;
            if means_umd_global(files, cx.file, scope, first.text, wanted) {
                self.error(cx.file, names.at(0), 2686, &[Arg::Atom(first.text)]);
            }
            let nearest = files
                .resolve_name(cx.file, scope, first.text, wanted)
                .and_then(|found| files.resolve_alias_as(found, wanted));
            if let Some(nearest) = nearest
                && !files.flags(nearest).intersects(SymFlags::NAMESPACE)
            {
                self.error_at((cx.file, first.pos(), 0), 2437, &[Arg::Atom(first.text)]);
            }
        }
        // `checkTypeNameIsReserved`
        if flags.intersects(SymFlags::TYPE)
            && matches!(
                files.atoms.bytes(import.name),
                b"any"
                    | b"unknown"
                    | b"never"
                    | b"number"
                    | b"bigint"
                    | b"boolean"
                    | b"string"
                    | b"symbol"
                    | b"void"
                    | b"object"
                    | b"undefined"
            )
        {
            self.error_at(
                (cx.file, import.name_pos, 0),
                2438,
                &[Arg::Atom(import.name)],
            );
        }
    }

    /// `checkModuleExportName`, of the name of an import or an export written at `pos`, where a string will do: 18057.
    fn xm_module_export_name(&mut self, cx: &Cx<'_>, pos: u32) {
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
    fn xm_export_named(&mut self, cx: &Cx<'_>, s: StmtId, x: ExportId, around: Around) {
        let hir = self.hir(cx.file);
        let export = hir[x];
        if export.spec.is_none() || self.xm_is_in_place(cx, s, export.spec, true, around) {
            let is_missing = if export.spec.is_none() {
                false
            } else if export.items.is_empty() {
                // Without a name to look up nobody asks for the module.
                true
            } else {
                self.xm_module_is_missing(cx, s, export.spec, around)
            };
            // `checkExportSpecifier`: `checkModuleExportName`, of both names. Without `from`, a string before `as` is a 1003.
            for s in export.items.iter() {
                if export.spec.is_some() && hir[s].local_pos != hir[s].pos {
                    self.xm_module_export_name(cx, hir[s].local_pos);
                }
                self.xm_module_export_name(cx, hir[s].pos);
            }
            // `checkExportSpecifier`: `checkAliasSymbol`
            for item in export.items.iter().filter(|_| !is_missing) {
                self.check_alias_symbol(
                    cx.file,
                    &cx.aliases,
                    s,
                    Decl::ExportSpec(item),
                    around.is_ambient,
                );
                if export.spec.is_none() {
                    self.xm_export_specifier(cx, x, item, around.is_ambient);
                }
            }
            let is_in_ambient_namespace = export.spec.is_none() && around.is_ambient;
            if around.module.is_some() && !around.is_ambient_module && !is_in_ambient_namespace {
                let start = hir[s].start;
                self.error_at((cx.file, start, self.end_of_stmt(cx.file, s)), 1194, &[]);
            }
        } else {
            // What a file exports other files may ask for.
            let may_be_used = around.module.is_none()
                || export
                    .items
                    .iter()
                    .any(|s| self.xm_follows_a_dot_somewhere(cx, hir[s].exported));
            if may_be_used {
                self.xm_module_is_missing(cx, s, export.spec, around);
            }
        }
        self.check_import_attributes(cx, s, export.spec, export.type_only);
    }

    /// `checkExportSpecifier`, of the `export { a }` `x`, which says no module
    fn xm_export_specifier(&mut self, cx: &Cx<'_>, x: ExportId, s: ExportSpecId, is_ambient: bool) {
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
        } else if means_umd_global(files, cx.file, scope, name, all) {
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
        // `markLinkedReferences`: not where nothing is emitted, nor when exports stay as they are written.
        // `markIdentifierAliasReferenced`: what is kept is looked up once more, as a value.
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
    fn xm_export_star(&mut self, cx: &Cx<'_>, s: StmtId, around: Around) {
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
        if self.xm_is_in_place(cx, s, spec, true, around) {
            if !self.xm_module_is_missing(cx, s, spec, around)
                && let Some(module) = self.xm_module_of_specifier(cx.file, spec)
            {
                // `hasExportAssignmentSymbol`
                if files.export(module, known::export_equals).is_some() {
                    if let Some(written) = cx.specifier(pos, spec) {
                        self.error_at((cx.file, written.pos, 0), 2498, &[Arg::Sym(module)]);
                    }
                } else {
                    self.check_alias_symbol(
                        cx.file,
                        &cx.aliases,
                        s,
                        Decl::ExportStarAs(s),
                        around.is_ambient,
                    );
                }
            }
            // `checkModuleExportName`, of the name in `export * as name`, unless 2498 was all there is to say.
            if alias.is_some()
                && !self
                    .xm_module_of_specifier(cx.file, spec)
                    .is_some_and(|module| files.export(module, known::export_equals).is_some())
            {
                self.xm_module_export_name(cx, alias_pos);
            }
        } else {
            let may_be_used = around.module.is_none()
                || alias.is_some() && self.xm_follows_a_dot_somewhere(cx, alias);
            if may_be_used {
                self.xm_module_is_missing(cx, s, spec, around);
            }
        }
        self.check_import_attributes(cx, s, spec, is_type_only);
    }

    /// `checkExportAssignment`
    fn xm_export_assignment(
        &mut self,
        cx: &Cx<'_>,
        s: StmtId,
        e: ExprId,
        is_export_equals: bool,
        around: Around,
    ) {
        let (hir, bound, files) = (self.hir(cx.file), self.bound(cx.file), self.files());
        let start = hir[s].start;
        if around.module.is_some() && !around.is_ambient_module {
            let code = if is_export_equals { 1063 } else { 1319 };
            self.error_at((cx.file, start, self.end_of_stmt(cx.file, s)), code, &[]);
            return;
        }
        // The rest is about what a compiler that sees one file at a time makes of it.
        if around.is_ambient || !self.p.files.options.isolated_modules {
            return;
        }
        // `isIllegalExportDefaultInCJS`: nothing else is said then.
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
                report(self, 1289, 1290);
                let code = if is_export_equals { 1289 } else { 1290 };
                self.relate(hir[e].pos, code, |c| {
                    c.type_only_declaration_related(sym, c.atom_text(name))
                });
            }
        }
    }

    // ───────────────────────────── import attributes ─────────────────────────────

    /// `GetImportAttributes`, of the declaration or the import type that is written at `within`: where `with` is, and the attributes as the
    /// parser keeps them, an `ExprKind::Object`.
    fn xm_get_import_attributes(
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

    /// `IsStringLiteralLike`: what `e` says, and whether it is `IsStringLiteral`.
    fn xm_string_literal_like(&self, file: FileId, e: ExprId) -> Option<(Atom, bool)> {
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

    /// `checkImportAttributes`, of the declaration `s`, which names the module `spec`.
    fn check_import_attributes(&mut self, cx: &Cx<'_>, s: StmtId, spec: Atom, is_type_only: bool) {
        let within = self.hir(cx.file)[s].loc;
        if spec.is_none() {
            return;
        }
        let Some((start, object, attributes)) = self.xm_get_import_attributes(cx.file, within)
        else {
            return;
        };
        let node = (
            cx.file,
            start,
            self.xm_end_of_import_attributes(cx.file, object),
        );
        // `getGlobalImportAttributesTypeChecked` returns `emptyObjectType` if there is no such interface, and the check is skipped.
        if let Some(sym) = self
            .files()
            .atoms
            .lookup(b"ImportAttributes")
            .and_then(|name| self.global_type_of_arity(name, 0))
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
        } else if self.xm_emits_commonjs(cx.file) {
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

    /// Where the `ImportAttributes` whose attributes are `object` end: after the closing brace. 0 if that is not known.
    fn xm_end_of_import_attributes(&self, file: FileId, object: ExprId) -> u32 {
        let (hir, open) = (self.hir(file), self.hir(file)[object].pos);
        if hir.text.get(open as usize) == Some(&b'{') {
            self.end_of_bracket_at(file, open)
        } else {
            0
        }
    }

    /// `getResolutionModeOverride`: whether `attributes`, the `node`, say how the module is to be looked for.
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
        if only.key.name().map(|name| self.files().atoms.bytes(name)) != Some(b"resolution-mode") {
            return report(self, (file, only.pos, 0), 1463);
        }
        let Some((value, _)) = self.xm_string_literal_like(file, only.value) else {
            return false;
        };
        matches!(self.files().atoms.bytes(value), b"import" | b"require")
            || report(self, (file, self.start_of(file, only.value), 0), 1453)
    }

    /// `HasResolutionModeOverride`, of the declaration or the import type whose module specifier is `written`. What attributes it has
    /// come after that, and before the next specifier.
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
        self.xm_get_import_attributes(file, within)
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
        let mut props: Vec<Prop> = Vec::with_capacity(attributes.len());
        for attribute in attributes.iter() {
            let (name, value) = (hir[attribute].key.name()?, hir[attribute].value);
            let ty = self.type_of_expr(file, value);
            if !self.is_known(ty) {
                return None;
            }
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
            ..Shape::default()
        }))
    }

    /// `checkGrammarImportCallExpression`, `checkImportType`, `getTypeFromImportTypeNode`
    fn xm_import_calls_and_types(&mut self, cx: &Cx<'_>) {
        let (hir, bound, files) = (self.hir(cx.file), self.bound(cx.file), self.files());
        if cx.grammar && cx.is_verbatim && self.p.files.options.module == ModuleKind::CommonJs {
            let index = self.exprs_by_kind(cx.file);
            for &e in index.of(ExprTag::ImportCall) {
                if !bound.is_unchecked(e.idx()) {
                    let start = hir[e].pos;
                    self.error_at(
                        (cx.file, start, self.end_inside_parentheses(cx.file, e)),
                        cx.esm_syntax_code,
                        &[],
                    );
                }
            }
        }
        for (i, node) in hir.types.iter().enumerate() {
            let TypeNodeKind::Import {
                spec,
                name,
                is_typeof,
                ..
            } = node.kind
            else {
                continue;
            };
            if bound.is_unchecked_type(i) {
                continue;
            }
            if !name.is_empty() {
                self.check_import_type_names(cx.file, TypeNodeId(i as u32));
            }
            let within = TextRange {
                pos: node.pos,
                end: self.end_of_type_node(cx.file, TypeNodeId(i as u32)),
            };
            if cx.grammar
                && let Some((_, object, attributes)) =
                    self.xm_get_import_attributes(cx.file, within)
            {
                // The node starts at the brace: `with` is a property of the object around it.
                let end = self.xm_end_of_import_attributes(cx.file, object);
                let node = (cx.file, hir[object].pos, end);
                self.get_resolution_mode_override(node, attributes, true);
            }
            if !name.is_empty() {
                continue;
            }
            // The module itself, or what it says it is, has to be what is asked for.
            let Some(module) = self.xm_module_of_specifier(cx.file, spec) else {
                continue;
            };
            let flags = files.symbol_flags(files.module_value(module));
            if flags == SymFlags::all() {
                continue;
            }
            if !flags.intersects(if is_typeof {
                SymFlags::VALUE
            } else {
                SymFlags::TYPE
            }) {
                let code = if is_typeof { 1339 } else { 1340 };
                let end = within.end;
                self.error_at((cx.file, node.pos, end), code, &[Arg::Atom(spec)]);
            }
        }
    }

    // ───────────────────────────── what is written where it cannot be ─────────────────────────────

    /// `checkGrammarModuleElementContext`, of the statements that are neither at the top of the file nor at the top of a namespace. 1211 for a class declaration without a name, wherever it is.
    fn xm_statements_in_blocks(&mut self, cx: &Cx<'_>) {
        if !cx.grammar || cx.text.is_empty() {
            return;
        }
        let (hir, bound) = (self.hir(cx.file), self.bound(cx.file));
        for (i, s) in hir.stmts.iter().enumerate() {
            // Only declarations, imports and exports are looked at.
            if !matches!(
                s.kind,
                StmtKind::Var(_)
                    | StmtKind::Fn(_)
                    | StmtKind::Class(_)
                    | StmtKind::Interface(_)
                    | StmtKind::TypeAlias(_)
                    | StmtKind::Enum(_)
                    | StmtKind::Module(_)
                    | StmtKind::Import(_)
                    | StmtKind::ImportEquals(_)
                    | StmtKind::ExportNamed(_)
                    | StmtKind::ExportStar { .. }
                    | StmtKind::ExportAssign(_)
                    | StmtKind::ExportDefault(_)
            ) || matches!(bound.stmt_parent[i], Parent::None)
            {
                continue;
            }
            // `checkClassDeclaration`: only `export default class` can do without a name.
            if let StmtKind::Class(c) = s.kind
                && hir[c].name.is_none()
                && !hir[c].flags.contains(Flags::DEFAULT)
                // `default` without `export` (1029) is a modifier all the same.
                && hir.find_modifier(s.modifiers, Flags::DEFAULT).is_none()
            {
                let start = hir[c].start;
                self.error_at((cx.file, start, 0), 1211, &[]);
            }
            if matches!(bound.stmt_parent[i], Parent::File | Parent::Module(_)) {
                continue;
            }
            let code = match s.kind {
                StmtKind::Module(m) if matches!(hir[m].name, ModuleName::Ident(_)) => 1235,
                StmtKind::Module(_) => 1234,
                StmtKind::Import(_) | StmtKind::ImportEquals(_) => {
                    if cx.is_js {
                        1473
                    } else {
                        1232
                    }
                }
                StmtKind::ExportNamed(_) | StmtKind::ExportStar { .. } => {
                    if cx.is_js {
                        1474
                    } else {
                        1233
                    }
                }
                StmtKind::ExportAssign(_) => 1231,
                StmtKind::ExportDefault(_) => 1258,
                _ => continue,
            };
            self.error_at((cx.file, s.start, 0), code, &[]);
        }
    }

    /// `reportObviousModifierErrors`, of `static { }`: nothing goes before it.
    fn xm_static_blocks(&mut self, cx: &Cx<'_>) {
        if !cx.grammar {
            return;
        }
        let (hir, bound) = (self.hir(cx.file), self.bound(cx.file));
        for (i, member) in hir.members.iter().enumerate() {
            if member.kind != MemberKind::StaticBlock
                || matches!(bound.member_owner[i], MemberOwner::None)
            {
                continue;
            }
            // `reportObviousDecoratorErrors` comes first, and nothing more is said then.
            if let Some(first) = hir.modifier_list(member.modifiers).first()
                && cx.text.get(member.start as usize) != Some(&b'@')
            {
                self.error_at((cx.file, first.pos, 0), 1184, &[]);
            }
        }
    }
}

// ───────────────────────────── whether the file parses ─────────────────────────────

// ───────────────────────────── names of modules ─────────────────────────────

// ───────────────────────────── what goes into messages ─────────────────────────────

/// `getIsolatedModulesLikeFlagName`
pub(super) fn isolated_modules_like_flag_name(files: &Files) -> &'static [u8] {
    if files.options.verbatim_module_syntax {
        b"verbatimModuleSyntax"
    } else {
        b"isolatedModules"
    }
}

/// `node.End()` of the import clause of the declaration whose module specifier is at `spec_pos`: where what comes before the `from`
/// ends. 0 if there is no `from`.
pub(super) fn import_clause_end(text: &[u8], spec_pos: u32) -> u32 {
    let end = skip_trivia_back(text, spec_pos as usize);
    let from = word_start(text, end);
    if &text[from..end] != b"from" {
        return 0;
    }
    skip_trivia_back(text, from) as u32
}

// ───────────────────────────── import attributes, as they are written ─────────────────────────────

// ───────────────────────────── reading the text ─────────────────────────────

/// The start of the first token of the file. The scanner skips a byte order mark and a `#!` line there like trivia.
fn first_token_start(text: &[u8]) -> u32 {
    let mut at = if text.starts_with(b"\xEF\xBB\xBF") {
        3
    } else {
        0
    };
    if text[at..].starts_with(b"#!") {
        at += text[at..]
            .iter()
            .position(|&c| c == b'\n' || c == b'\r')
            .unwrap_or(text.len() - at);
    }
    skip_trivia(text, at) as u32
}

/// Past the string that opens at `at`.
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
