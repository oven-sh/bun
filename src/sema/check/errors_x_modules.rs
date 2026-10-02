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
//! `check_import_attribute_types` and `check_flow_too_deep` ask for types.
//!
//! The summary of a file keeps neither modifiers nor keywords: they are read from the text, from a place the summary does have. The
//! attributes of import types are read from the text too. Those of declarations are in `hir::File::import_attributes`.
//! Of a declaration file there is no text, and what can only be read is not looked for.

use super::*;
use crate::bind::{Decl, MemberOwner, Parent, ScopeId};
use crate::resolve::ModuleKind;

/// What is the same all over a file.
struct Cx<'a> {
    file: FileId,
    text: &'a [u8],
    /// Where module specifiers are written, in the order of the text.
    uses: &'a [SpecifierUse],
    /// What `attributes_keyword` was last asked, and what it said.
    last_keyword: std::cell::Cell<(u32, bool, Option<(usize, usize)>)>,
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
    /// The start, the end and the type (`getTypeFromImportAttributes`) of the attributes of each import or export declaration. The
    /// `&self` passes collect them, and `check_import_attribute_types` relates them, which needs `&mut self`.
    attribute_types: std::cell::RefCell<Vec<(u32, u32, AttributesType)>>,
    /// `node.Symbol`, of the declarations of aliases.
    aliases: FxHashMap<Decl, Sym>,
    /// The start and the code of each error whose message names a symbol, and the symbol. Printing it needs `&mut self`.
    named_symbols: std::cell::RefCell<Vec<(u32, u32, Sym)>>,
}

/// What `getTypeFromImportAttributes` is computed from.
#[derive(Copy, Clone)]
enum AttributesType {
    /// The attributes as the parser kept them: an `ExprKind::Object` of `hir::File::import_attributes`.
    Object(ExprId),
    /// The type, for attributes that were read from the text.
    Known(TypeId),
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

    /// `attributes_keyword`. A statement is asked about more than once.
    fn attributes_keyword(&self, spec_pos: u32, is_export: bool) -> Option<(usize, usize)> {
        let (last_pos, last_is_export, found) = self.last_keyword.get();
        if last_pos == spec_pos && last_is_export == is_export {
            return found;
        }
        let found = attributes_keyword(self.text, spec_pos, is_export);
        self.last_keyword.set((spec_pos, is_export, found));
        found
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
            grammar: !has_parse_diagnostics(hir) && !has_import_assertions(&hir.text, uses),
            is_js: hir.is_js,
            is_verbatim,
            verbatim_commonjs: is_verbatim && self.xm_emits_commonjs(file),
            esm_syntax_code: self.verbatim_module_syntax_error_message(file),
            attribute_types: Default::default(),
            aliases: self.symbols_of_alias_declarations(file),
            named_symbols: Default::default(),
            uses,
            last_keyword: std::cell::Cell::new((u32::MAX, false, None)),
        };
        let top = Around {
            module: ModuleId::NONE,
            is_ambient_module: false,
            is_augmentation: false,
            is_top_level: false,
            is_ambient: hir.kind == FileKind::Declaration,
        };
        self.xm_statements(&cx, hir.body, top, false);
        self.xm_statements_out_of_place(&cx, top);
        self.xm_statements_in_blocks(&cx);
        self.xm_static_blocks(&cx);
        self.xm_import_calls_and_types(&cx);
        self.check_import_attribute_types(&cx);
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
        for (start, code, sym) in cx.named_symbols.take() {
            self.note(start, 0, code, &[Arg::Sym(sym)]);
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

    /// The statements of the file or of the body of a module. `says_module`: of `module A.B`, when this is what is in `A`.
    fn xm_statements(
        &mut self,
        cx: &Cx<'_>,
        list: IdList<StmtId>,
        around: Around,
        says_module: bool,
    ) {
        let hir = self.hir(cx.file);
        for s in hir.ids(list) {
            let Stmt {
                start, modifiers, ..
            } = hir[s];
            match hir[s].kind {
                StmtKind::Module(m) => self.xm_module(cx, list, s, m, around, says_module),
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
        inherited: bool,
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
        let says_module = !is_ambient_module && says_module(cx.text, name_pos, inherited);

        let inner = Around {
            module: m,
            is_ambient_module,
            is_augmentation,
            is_top_level: is_at_top,
            is_ambient,
        };
        self.xm_statements(cx, module.body, inner, says_module);

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
                self.error_at((cx.file, name_pos, 0), 5061, &[]);
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
        if says_module {
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
                    &[Arg::Text(&isolated_modules_like_flag_name(files))],
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
            && is_relative_name(files.atoms.bytes(name))
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
            around.is_ambient && !is_relative_name(text)
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
        let report = |c: &mut Self, code: u32, of_each: bool| {
            if of_each || first == Some(m) {
                c.error_at((cx.file, start, 0), code, &[]);
            }
        };
        let Some(found) = self.xm_module_of_specifier(cx.file, name) else {
            // `resolveExternalModule`. Names written where everything is only declared are not held against anybody.
            let (from, validates) = (files.module(cx.file), !around.is_ambient);
            if let Some(target) = from.imported_file(name) {
                if validates {
                    report(self, 2306, false);
                    self.note(
                        start,
                        0,
                        2306,
                        &[Arg::Text(&files.module(target).path.clone())],
                    );
                }
            } else if from.is_untyped_import(name) {
                // With `allowJs` the JavaScript is a file of the program like any other.
                if !self.p.files.options.allow_js {
                    report(self, 2665, false);
                    let at = from.untyped_imports.iter().position(|u| u.0 == name);
                    let path = from.untyped_import_files[at.unwrap()].0;
                    self.note(start, 0, 2665, &[Arg::Atom(name), Arg::Atom(path)]);
                }
            } else if validates {
                let code = if !self.p.files.options.resolve_json_module && text.ends_with(b".json")
                {
                    2732
                } else if let Some(&(_, is_there)) = from
                    .extensionless_imports
                    .iter()
                    .find(|e| from.is_esm && e.0 == name)
                {
                    if is_there { 2835 } else { 2834 }
                } else {
                    2664
                };
                report(self, code, false);
                let written = self.atom_text(name);
                match code {
                    2835 => {
                        if let Some(extension) =
                            suggested_import_extension(files, &from.path, &written)
                        {
                            self.note(start, 0, code, &[Arg::Text(&(written + extension))]);
                        }
                    }
                    _ => self.note(start, 0, code, &[Arg::Text(&written)]),
                }
            }
            return false;
        };
        // `resolveExternalModuleSymbol`
        let main = files.module_value(found);
        let flags = files.flags(main);
        if !flags.intersects(SymFlags::NAMESPACE) {
            // An alias here is one that could not be followed.
            if !flags.contains(SymFlags::ALIAS) {
                report(self, 2671, false);
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
                report(self, 2649, false);
                cx.named_symbols.borrow_mut().push((start, 2649, main));
            } else if !is_variable {
                // `reportMergeSymbolError`, of the declarations on this side.
                report(self, 2567, true);
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
            if !around.is_augmentation && is_relative_name(self.files().atoms.bytes(spec)) {
                self.error_at((cx.file, start, self.end_of_stmt(cx.file, s)), 2439, &[]);
                return false;
            }
        }
        // The values of its attributes are strings. `import a = require("m")` has none.
        let mut are_strings = true;
        if let Some(written) = written
            && written.kind != SpecifierKind::Require
        {
            let mut others = Vec::new();
            self.xm_attributes_after(cx, written.pos, is_export, |value, end| {
                others.push((value, end))
            });
            are_strings = others.is_empty();
            for (value, end) in others {
                self.error_at((cx.file, value, end), 2858, &[]);
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
                    .xm_attributes_after(cx, written.pos, false, |_, _| {})
                    .is_some_and(|(attributes, _)| {
                        attributes
                            .entries
                            .iter()
                            .any(|&(name, value)| name == b"type" && value == Some(&b"json"[..]))
                    })
            {
                self.error_at(
                    (cx.file, written.pos, 0),
                    1543,
                    &[Arg::Text(&files.options.module.name().to_owned())],
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
        self.xm_import_attributes(cx, pos, import.spec, import.type_only, false);
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
        let mut path = [Atom::NONE; 8];
        if scope.is_none() || names.is_empty() || names.len() > path.len() {
            return;
        }
        for (slot, name) in path.iter_mut().zip(hir.texts(names)) {
            *slot = name;
        }
        let path = &path[..names.len()];
        // `getSymbolOfPartOfRightHandSideOfImportEquals`: a name on its own is the name of a namespace.
        let meaning = if path.len() == 1 {
            SymFlags::NAMESPACE
        } else {
            SymFlags::VALUE | SymFlags::TYPE | SymFlags::NAMESPACE
        };
        let Some(target) = files.resolve_entity(cx.file, scope, path, meaning) else {
            return;
        };
        let flags = files.symbol_flags(target);
        if flags == SymFlags::all() {
            return;
        }
        if flags.intersects(SymFlags::VALUE) {
            // As a value, the first name may mean something nearer by that is no namespace.
            let wanted = SymFlags::VALUE | SymFlags::NAMESPACE;
            let nearest = files
                .resolve_name(cx.file, scope, path[0], wanted)
                .and_then(|found| files.resolve_alias_as(found, wanted));
            if let Some(nearest) = nearest
                && !files.flags(nearest).intersects(SymFlags::NAMESPACE)
                && let Some(start) = after_equals(cx.text, import.name_pos)
            {
                self.error_at((cx.file, start, 0), 2437, &[]);
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
            self.error_at((cx.file, import.name_pos, 0), 2438, &[]);
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
        let (export, pos) = (hir[x], hir[s].start);
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
        self.xm_import_attributes(cx, pos, export.spec, export.type_only, true);
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
                        self.error_at((cx.file, written.pos, 0), 2498, &[]);
                        cx.named_symbols
                            .borrow_mut()
                            .push((written.pos, 2498, module));
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
        self.xm_import_attributes(cx, pos, spec, is_type_only, true);
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
                    Arg::Text(&isolated_modules_like_flag_name(files)),
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

    /// `checkImportAttributes`, of the statement at `pos` that names the module `spec`.
    fn xm_import_attributes(
        &mut self,
        cx: &Cx<'_>,
        pos: u32,
        spec: Atom,
        is_type_only: bool,
        is_export: bool,
    ) {
        if spec.is_none() {
            return;
        }
        let Some(written) = cx.specifier(pos, spec) else {
            return;
        };
        let Some((attributes, object)) =
            self.xm_attributes_after(cx, written.pos, is_export, |_, _| {})
        else {
            return;
        };
        if object.is_some() {
            cx.attribute_types.borrow_mut().push((
                attributes.start,
                attributes.end,
                AttributesType::Object(object),
            ));
        } else if let Some(ty) = self.type_from_import_attributes(&attributes) {
            cx.attribute_types.borrow_mut().push((
                attributes.start,
                attributes.end,
                AttributesType::Known(ty),
            ));
        }
        // The remaining checks report with `grammarErrorOnNode`.
        if !cx.grammar {
            return;
        }
        let overrides = attributes.overrides_resolution_mode(self, is_type_only);
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
        self.error_at((cx.file, attributes.start, attributes.end), code, &[]);
    }

    /// `getTypeFromImportAttributes`: a non-fresh object type with one property per attribute, typed as the regular literal type of its
    /// value. Returns `None` if the text does not give the type of every value: a value is not a string, or has escapes.
    fn type_from_import_attributes(&self, attributes: &Attributes<'_>) -> Option<TypeId> {
        let atoms = &self.files().atoms;
        let mut props: Vec<Prop> = Vec::with_capacity(attributes.entries.len());
        for &(name, value) in &attributes.entries {
            let value = value?;
            if name.contains(&b'\\') || value.contains(&b'\\') {
                return None;
            }
            let name = atoms.intern(name);
            let ty = self.string_literal(atoms.intern(value), false);
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

    /// `getTypeFromImportAttributes`, from the attributes as the parser kept them. Returns `None` if the type of a value is unknown.
    fn type_from_import_attributes_object(
        &mut self,
        file: FileId,
        object: ExprId,
    ) -> Option<TypeId> {
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

    /// `checkImportAttributes`: reports 2322 at the keyword unless the attributes are assignable to the global `ImportAttributes`.
    /// tsgo reports it with a plain `error`, so parse diagnostics do not suppress it.
    fn check_import_attribute_types(&mut self, cx: &Cx<'_>) {
        let attribute_types = cx.attribute_types.take();
        if attribute_types.is_empty() {
            return;
        }
        // `getGlobalImportAttributesTypeChecked` returns `emptyObjectType` if there is no such interface, and the check is skipped.
        let Some(sym) = self
            .files()
            .atoms
            .lookup(b"ImportAttributes")
            .and_then(|name| self.global_type_of_arity(name, 0))
        else {
            return;
        };
        let target = self.declared_type(sym);
        // `getNullableType(importAttributesType, TypeFlagsUndefined)`
        let target = self.optional(target);
        for (start, end, source) in attribute_types {
            let source = match source {
                AttributesType::Known(ty) => Some(ty),
                AttributesType::Object(object) => {
                    self.type_from_import_attributes_object(cx.file, object)
                }
            };
            if let Some(source) = source {
                self.check_type_assignable_to(source, target, Some((cx.file, start, end)), None);
            }
        }
    }

    /// `parseImportType` in a file that does not parse: where the last token it takes ends, if it never gets to its `)`. The keyword is at
    /// `import`.
    fn xm_end_of_unfinished_import_type(&self, file: FileId, import: u32) -> Option<u32> {
        let hir = self.hir(file);
        if !hir.has_parse_diagnostics {
            return None;
        }
        let text = &hir.text[..];
        // `parseExpected`, `parseOptional`: takes what comes after `end` if it is `token`.
        let take = |end: &mut u32, token: &[u8]| {
            let at = self.skip_trivia_from(file, *end);
            let token_end = self.end_of_token_at(file, at);
            let is_next = text.get(at as usize..token_end as usize) == Some(token);
            if is_next {
                *end = token_end;
            }
            is_next
        };
        // Takes the name or the string that comes after `end`, or the number if it is a value that is wanted.
        let take_word = |end: &mut u32, is_name: bool| {
            let at = self.skip_trivia_from(file, *end);
            let is_next = text.get(at as usize).is_some_and(|&b| {
                b.is_ascii_alphabetic()
                    || matches!(b, b'_' | b'$' | b'"' | b'\'')
                    || !is_name && b.is_ascii_digit()
            });
            if is_next {
                *end = self.end_of_token_at(file, at);
            }
            is_next
        };
        let mut end = self.end_of_token_at(file, import);
        take(&mut end, b"(");
        let specifier = self.skip_trivia_from(file, end);
        if !matches!(text.get(specifier as usize), Some(b'"' | b'\'')) {
            return None;
        }
        end = self.end_of_token_at(file, specifier);
        if take(&mut end, b",") {
            take(&mut end, b"{");
            if !take(&mut end, b"with") {
                take(&mut end, b"assert");
            }
            take(&mut end, b":");
            // `parseImportAttributes`
            if take(&mut end, b"{") {
                while take_word(&mut end, true) {
                    take(&mut end, b":");
                    take_word(&mut end, false);
                    if !take(&mut end, b",") {
                        break;
                    }
                }
                take(&mut end, b"}");
            }
            take(&mut end, b",");
            take(&mut end, b"}");
        }
        (!take(&mut end, b")")).then_some(end)
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
            if cx.grammar
                && let Some(written) = cx.specifier(node.pos, spec)
                && let Some(attributes) = import_type_attributes(cx.text, written.pos as usize)
            {
                attributes.overrides_resolution_mode(self, true);
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
                let import = if is_typeof {
                    self.skip_trivia_from(cx.file, self.end_of_token_at(cx.file, node.pos))
                } else {
                    node.pos
                };
                let end = self
                    .xm_end_of_unfinished_import_type(cx.file, import)
                    .unwrap_or_else(|| self.end_of_type_node(cx.file, TypeNodeId(i as u32)));
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

/// `tryParseImportAttributes`, `parseExportDeclaration`, `parseImportType`: `assert` where `with` belongs is an error of the parser's.
fn has_import_assertions(text: &[u8], uses: &[SpecifierUse]) -> bool {
    uses.iter().any(|u| {
        let Some(end) = string_end(text, u.pos as usize) else {
            return false;
        };
        let mut at = skip_trivia(text, end);
        if text.get(at) != Some(&b',') {
            return word_at(text, at) == b"assert" && !has_line_break(&text[end..at]);
        }
        // `import("m", { assert: { .. } })`
        at = skip_trivia(text, at + 1);
        text.get(at) == Some(&b'{') && word_at(text, skip_trivia(text, at + 1)) == b"assert"
    })
}

// ───────────────────────────── names of modules ─────────────────────────────

/// `IsExternalModuleNameRelative`
fn is_relative_name(name: &[u8]) -> bool {
    match name {
        // `PathIsRelative`
        [b'.'] | [b'.', b'.'] | [b'.', b'/' | b'\\', ..] | [b'.', b'.', b'/' | b'\\', ..] => true,
        // `IsRootedDiskPath`
        [b'/' | b'\\', ..] | [b'^', b'/', ..] => true,
        [volume, b':'] | [volume, b':', b'/' | b'\\', ..] => volume.is_ascii_alphabetic(),
        _ => false,
    }
}

/// `getSuggestedImportExtension`, of the relative `spec` written in the file `from`. Only the files of the program are known to be there.
pub(super) fn suggested_import_extension(
    files: &Files,
    from: &str,
    spec: &str,
) -> Option<&'static str> {
    let stem = crate::resolve::join(crate::resolve::parent_dir(from), spec);
    let for_tsx = if files.options.jsx == crate::resolve::JsxEmit::Preserve {
        ".jsx"
    } else {
        ".js"
    };
    [
        (".mts", ".mjs"),
        (".ts", ".js"),
        (".cts", ".cjs"),
        (".mjs", ".mjs"),
        (".js", ".js"),
        (".cjs", ".cjs"),
        (".tsx", for_tsx),
        (".jsx", ".jsx"),
        (".json", ".json"),
    ]
    .into_iter()
    .find(|(written, _)| files.by_path.contains_key(&format!("{stem}{written}")))
    .map(|(_, suggested)| suggested)
}

// ───────────────────────────── what goes into messages ─────────────────────────────

/// `getIsolatedModulesLikeFlagName`
pub(super) fn isolated_modules_like_flag_name(files: &Files) -> String {
    if files.options.verbatim_module_syntax {
        "verbatimModuleSyntax".to_owned()
    } else {
        "isolatedModules".to_owned()
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

struct Attribute<'a> {
    name: &'a [u8],
    name_pos: u32,
    name_is_string: bool,
    /// `IsStringLiteralLike`: what is between the quotes, of whichever kind they are.
    value: Option<&'a [u8]>,
    value_pos: u32,
}

/// `with { name: "value", .. }`
struct Attributes<'a> {
    /// Where the node starts: at the keyword, or at the brace in `import("m", { with: { .. } })`.
    start: u32,
    /// Where it ends: after the closing brace. 0 if that is not known.
    end: u32,
    first: Option<Attribute<'a>>,
    /// The name, without quotes, and the `Attribute::value` of every attribute.
    entries: Vec<(&'a [u8], Option<&'a [u8]>)>,
}

impl Attributes<'_> {
    /// `getResolutionModeOverride`: whether they say how the module is to be looked for.
    fn overrides_resolution_mode(&self, c: &mut Checker<'_>, report_errors: bool) -> bool {
        let report = |c: &mut Checker<'_>, start: u32, code: u32| {
            if report_errors {
                c.error_at((c.checking.unwrap(), start, 0), code, &[]);
            }
        };
        let Some(only) = self.first.as_ref().filter(|_| self.entries.len() == 1) else {
            report(c, self.start, 1464);
            c.note(self.start, self.end, 1464, &[]);
            return false;
        };
        if !only.name_is_string {
            return false;
        }
        if only.name != b"resolution-mode" {
            report(c, only.name_pos, 1463);
            return false;
        }
        let Some(value) = only.value else {
            return false;
        };
        if value != b"import" && value != b"require" {
            report(c, only.value_pos, 1453);
            return false;
        }
        true
    }
}

impl<'p> Checker<'p> {
    /// The attributes after the module specifier at `spec_pos` of an import or export declaration, and the `ExprKind::Object` the
    /// parser kept them as (`hir::File::import_attributes`). They are read from the text, and the object is `NONE`, if it kept none.
    /// `on_other_value`: called with the start and the end of each value that is not a string in single or double quotes.
    fn xm_attributes_after<'a>(
        &self,
        cx: &Cx<'a>,
        spec_pos: u32,
        is_export: bool,
        mut on_other_value: impl FnMut(u32, u32),
    ) -> Option<(Attributes<'a>, ExprId)>
    where
        'p: 'a,
    {
        let (keyword, keyword_end) = cx.attributes_keyword(spec_pos, is_export)?;
        let start = keyword as u32;
        let (hir, atoms) = (self.hir(cx.file), &self.files().atoms);
        let Some(&(_, object)) = hir.import_attributes.iter().find(|kept| kept.0 == start) else {
            let attributes = parse_attributes(
                cx.text,
                skip_trivia(cx.text, keyword_end),
                start,
                on_other_value,
            )?;
            return Some((attributes, ExprId::NONE));
        };
        let ExprKind::Object(props) = hir[object].kind else {
            return None;
        };
        let mut attributes = Attributes {
            start,
            // Without a `{` they are the keyword.
            end: match cx.text.get(hir[object].pos as usize) {
                Some(b'{') => hir[object].end,
                _ => 0,
            },
            first: None,
            entries: Vec::with_capacity(props.len()),
        };
        for p in props.iter() {
            let prop = &hir[p];
            let name: &'a [u8] = prop.key.name().map_or(&[][..], |name| atoms.bytes(name));
            let value_pos = self.start_of(cx.file, prop.value);
            // Parentheses make it another kind of node. A template without substitutions may be lowered to a `String`.
            let quote = cx
                .text
                .get(value_pos as usize)
                .copied()
                .filter(|&c| matches!(c, b'"' | b'\'' | b'`'));
            let value: Option<&'a [u8]> = match hir[prop.value].kind {
                ExprKind::String(value) if quote.is_some() => Some(atoms.bytes(value)),
                ExprKind::Template { exprs } if exprs.is_empty() && quote.is_some() => {
                    Some(atoms.bytes(hir.id_at(hir.template_texts(exprs), 0)))
                }
                _ => None,
            };
            // The parser has reported a missing value.
            if (value.is_none() || quote == Some(b'`'))
                && !matches!(hir[prop.value].kind, ExprKind::Missing)
            {
                on_other_value(value_pos, self.end_of_expr(cx.file, prop.value));
            }
            if attributes.first.is_none() {
                let name_is_string = matches!(cx.text.get(prop.pos as usize), Some(b'"' | b'\''));
                attributes.first = Some(Attribute {
                    name,
                    name_pos: prop.pos,
                    name_is_string,
                    value,
                    value_pos,
                });
            }
            attributes.entries.push((name, value));
        }
        Some((attributes, object))
    }
}

/// The start and the end of the `with` or `assert` after the module specifier at `spec_pos` of an import or export declaration.
fn attributes_keyword(text: &[u8], spec_pos: u32, is_export: bool) -> Option<(usize, usize)> {
    let end = string_end(text, spec_pos as usize)?;
    let keyword = skip_trivia(text, end);
    let word = word_at(text, keyword);
    // `tryParseImportAttributes` accepts `with` on any line and `assert` on the same line only. `parseExportDeclaration` accepts both
    // on the same line only. The parser reports `assert` and still builds the node.
    let must_be_on_same_line = match word {
        b"with" => is_export,
        b"assert" => true,
        _ => return None,
    };
    if must_be_on_same_line && has_line_break(&text[end..keyword]) {
        return None;
    }
    Some((keyword, keyword + word.len()))
}

/// `parseImportAttributes`, from the brace at `open`. `None` for what does not parse, or cannot be told to.
fn parse_attributes(
    text: &[u8],
    open: usize,
    start: u32,
    mut on_other_value: impl FnMut(u32, u32),
) -> Option<Attributes<'_>> {
    if text.get(open) != Some(&b'{') {
        return None;
    }
    let mut at = skip_trivia(text, open + 1);
    let mut attributes = Attributes {
        start,
        end: 0,
        first: None,
        entries: Vec::new(),
    };
    while text.get(at) != Some(&b'}') {
        let name_pos = at;
        let name_is_string = matches!(text.get(at), Some(b'"' | b'\''));
        let name_end = if name_is_string {
            string_end(text, at)?
        } else {
            word_end(text, at)
        };
        if name_end == name_pos {
            return None;
        }
        at = skip_trivia(text, name_end);
        if text.get(at) != Some(&b':') {
            return None;
        }
        let value_pos = skip_trivia(text, at + 1);
        let (value, value_end) = match string_end(text, value_pos) {
            Some(end) => (Some(&text[value_pos + 1..end - 1]), end),
            None => {
                let end = expression_end(text, value_pos).filter(|&end| end > value_pos)?;
                on_other_value(value_pos as u32, skip_trivia_back(text, end) as u32);
                // A template that nothing is substituted in.
                match text[value_pos..end].trim_ascii_end() {
                    [b'`', inner @ .., b'`'] if !inner.contains(&b'`') => (Some(inner), end),
                    _ => (None, end),
                }
            }
        };
        let name = if name_is_string {
            &text[name_pos + 1..name_end - 1]
        } else {
            &text[name_pos..name_end]
        };
        if attributes.first.is_none() {
            attributes.first = Some(Attribute {
                name,
                name_pos: name_pos as u32,
                name_is_string,
                value,
                value_pos: value_pos as u32,
            });
        }
        attributes.entries.push((name, value));
        at = skip_trivia(text, value_end);
        match text.get(at) {
            Some(b',') => at = skip_trivia(text, at + 1),
            Some(b'}') => {}
            _ => return None,
        }
    }
    attributes.end = at as u32 + 1;
    Some(attributes)
}

/// The attributes of `import("m", { with: { .. } })`, whose `"m"` is at `spec_pos`.
fn import_type_attributes(text: &[u8], spec_pos: usize) -> Option<Attributes<'_>> {
    let mut at = skip_trivia(text, string_end(text, spec_pos)?);
    for expected in [b',', b'{'] {
        if text.get(at) != Some(&expected) {
            return None;
        }
        at = skip_trivia(text, at + 1);
    }
    if word_at(text, at) != b"with" {
        return None;
    }
    at = skip_trivia(text, at + 4);
    if text.get(at) != Some(&b':') {
        return None;
    }
    let open = skip_trivia(text, at + 1);
    parse_attributes(text, open, open as u32, |_, _| {})
}

/// Where the expression at `at` ends, which a `,` or a `}` follows. `None` if counting brackets does not tell.
fn expression_end(text: &[u8], mut at: usize) -> Option<usize> {
    let mut depth = 0u32;
    loop {
        match *text.get(at)? {
            b'"' | b'\'' => at = string_end(text, at)?,
            b'`' => {
                at += 1;
                loop {
                    match *text.get(at)? {
                        b'`' => break,
                        b'\\' => at += 2,
                        b'$' if text.get(at + 1) == Some(&b'{') => return None,
                        _ => at += 1,
                    }
                }
                at += 1;
            }
            // A comment. A division and a regular expression cannot be told apart from here.
            b'/' => {
                let after = skip_trivia(text, at);
                if after == at {
                    return None;
                }
                at = after;
            }
            b'(' | b'[' | b'{' => {
                depth += 1;
                at += 1;
            }
            b',' | b'}' if depth == 0 => return Some(at),
            b')' | b']' | b'}' => {
                depth = depth.checked_sub(1)?;
                at += 1;
            }
            _ => at += 1,
        }
    }
}

// ───────────────────────────── reading the text ─────────────────────────────

fn has_line_break(text: &[u8]) -> bool {
    text.iter().any(|&c| c == b'\n' || c == b'\r')
}

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

/// Whether the namespace whose name is at `name_pos` is declared with `module`. What holds for the `A` of `module A.B` holds for `B`.
fn says_module(text: &[u8], name_pos: u32, inherited: bool) -> bool {
    let end = skip_trivia_back(text, name_pos as usize);
    if text[..end].ends_with(b".") {
        return inherited;
    }
    &text[word_start(text, end)..end] == b"module"
}

/// Where what follows the `=` of `import name = ..` starts.
fn after_equals(text: &[u8], name_pos: u32) -> Option<u32> {
    let at = skip_trivia(text, word_end(text, name_pos as usize));
    (text.get(at) == Some(&b'=')).then(|| skip_trivia(text, at + 1) as u32)
}
