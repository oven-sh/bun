//! Aliases, what module specifiers lead to, and a few things that are about a file as a whole:
//! 2303; 18042 18043; 1205 1269 1288 1293 1448 1484 1485 2748 2865; 2866; 1272; 1379 1380; 2308; 1544;
//! 6137 6142 2846 5097 2876 2877, 1471 1479 1541 1542; 7036; 1470 17013; 1006; 2578.
//!
//! Follows `checkAliasSymbol`, `checkAndReportErrorForResolvingImportAliasToTypeOnlySymbol`,
//! `getExportsOfModuleWorker`, `getExternalModuleMember`, `resolveExternalModule`,
//! `checkImportCallExpression`, `checkConstEnumAccess`, `checkNewTargetMetaProperty` and `checkImportMetaProperty` of TypeScript
//! 7.0.2's checker.go, `getSourceFileFromReference` of its fileloader.go, `getBindAndCheckDiagnosticsWithChecker` and
//! `GetIncludeProcessorDiagnostics` of its program.go and `processCommentDirective` of its scanner.go.
//!
//! `check_x_comment_directives` is an entry of its own: it goes by what all the others have said, so it comes after them.

use super::errors::Diagnostic;
use super::*;
use crate::bind::{ClassOwner, Decl, MemberOwner, Parent, PatParent, SymbolId};
use crate::program::TypeOnlyDeclaration;
use crate::resolve::{ModuleKind, is_declaration_file_name, join, parent_dir};

const ALL_MEANINGS: SymFlags = SymFlags::VALUE
    .union(SymFlags::TYPE)
    .union(SymFlags::NAMESPACE);

/// A declaration of an alias in the file that is checked.
#[derive(Copy, Clone)]
struct AliasNode {
    decl: Decl,
    /// Where an error about it goes.
    start: u32,
    stmt: StmtId,
}

/// What `resolveExternalModule` asks of `location`.
#[derive(Copy, Clone, Default)]
pub(super) struct SpecifierSite {
    /// `IsEmittableImport`, of what it is in.
    pub(super) is_emittable: bool,
    /// `IsPartOfTypeOnlyImportOrExportDeclaration`, of every node the module is asked for from.
    pub(super) is_type_only: bool,
    /// `import type .. from`
    pub(super) is_type_only_import: bool,
    pub(super) is_ambient: bool,
}

impl Checker<'_> {
    pub(super) fn check_x_aliases(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let hir = self.hir(file);
        // `SkipTypeChecking`: a declaration file is checked like any other file. The default library has no text and is not checked.
        if hir.has_errors || hir.kind == FileKind::Json || hir.text.is_empty() {
            return;
        }
        self.xa_self_references(file, out);
        self.xa_imports_hiding_global_values(file, out);
        self.xa_decorator_metadata(file, out);
        self.xa_export_star_conflicts(file, out);
        self.xa_expressions(file, out);
    }

    /// `getSourceFileFromReference`: 1006
    fn xa_self_references(&self, file: FileId, out: &mut Vec<Diagnostic>) {
        let files = self.files();
        let path = files.module(file).path.as_str();
        for &(kind, value, start, _) in &self.hir(file).references {
            if kind == ReferenceKind::Path
                && join(parent_dir(path), &files.atoms.text(value)) == path
            {
                out.push(Diagnostic { start, code: 1006 });
                let end = start + files.atoms.bytes(value).len() as u32;
                self.note(start, end, 1006, Vec::new());
            }
        }
    }

    // ───────────────────────────── where errors end ─────────────────────────────

    /// `node.End()` of the statement at `pos`. 0 if there is none.
    fn xa_statement_end(&self, file: FileId, pos: u32) -> u32 {
        self.hir(file)
            .stmts
            .iter()
            .position(|s| s.pos == pos)
            .map_or(0, |s| self.end_of_stmt(file, StmtId(s as u32)))
    }

    /// Where the module specifier of the statement at `pos`, which says `spec`, is written.
    fn xa_specifier_pos(&self, file: FileId, pos: u32, spec: Atom) -> Option<u32> {
        self.hir(file)
            .specifier_uses
            .iter()
            .filter(|u| u.spec == spec && u.pos >= pos && !u.kind.is_call())
            .map(|u| u.pos)
            .min()
    }

    /// `GetTextOfNode` of the same: with its quotes.
    fn xa_specifier_text(&self, file: FileId, pos: u32, spec: Atom) -> String {
        let text = &self.hir(file).text[..];
        self.xa_specifier_pos(file, pos, spec)
            .and_then(|at| Some((at, string_literal(text, at as usize)?.1)))
            .map_or_else(
                || format!("\"{}\"", self.atom_text(spec)),
                |(at, end)| self.source_text(file, at, end as u32),
            )
    }

    /// The end of `GetErrorRangeForNode` of the declaration `node` of an alias. 0: it is one token.
    fn xa_alias_node_end(&self, file: FileId, node: &AliasNode) -> u32 {
        let hir = self.hir(file);
        match node.decl {
            Decl::ImportDefault(x) => self
                .xa_specifier_pos(file, hir[node.stmt].pos, hir[x].spec)
                .map_or(0, |at| {
                    super::errors_x_modules::import_clause_end(&hir.text, at)
                }),
            Decl::ImportSpec(s) => self.end_of_import_spec(file, s),
            Decl::ExportSpec(s) => self.end_of_export_spec(file, s),
            // `* as ns`
            Decl::ExportStarAs(s) => match hir[s].kind {
                StmtKind::ExportStar { alias_pos, .. } => self.end_of_name_at(file, alias_pos),
                _ => 0,
            },
            Decl::ImportEquals(_) | Decl::ExportExpr(_) | Decl::UmdGlobal(_) => {
                self.end_of_stmt(file, node.stmt)
            }
            _ => 0,
        }
    }

    /// The start of `GetErrorRangeForNode` of the declaration `decl` of an alias: the name of `* as ns` in an import, and where each of
    /// the others starts.
    fn xa_alias_node_start(&self, file: FileId, decl: Decl) -> u32 {
        match decl {
            Decl::ImportNamespace(import) => self.hir(file)[import].namespace_pos,
            _ => self.files().start_of_declaration(file, decl),
        }
    }

    /// `GetErrorRangeForNode` of the declaration `decl` of the alias `sym`, in the file of `sym`. `None`: it declares no alias.
    pub(super) fn place_of_alias_declaration(
        &self,
        sym: Sym,
        decl: Decl,
    ) -> Option<(FileId, u32, u32)> {
        let file = sym.file;
        let (hir, bound) = (self.hir(file), self.bound(file));
        let stmt = match decl {
            Decl::ExportStarAs(s) | Decl::ExportExpr(s) | Decl::UmdGlobal(s) => s,
            _ => {
                let holds_it = |s: &Stmt| match (s.kind, decl) {
                    (StmtKind::Import(x), Decl::ImportDefault(of) | Decl::ImportNamespace(of)) => {
                        x == of
                    }
                    (StmtKind::Import(x), Decl::ImportSpec(spec)) => x == hir[spec].import,
                    (StmtKind::ImportEquals(x), Decl::ImportEquals(of)) => x == of,
                    (StmtKind::ExportNamed(x), Decl::ExportSpec(spec)) => x == hir[spec].export,
                    _ => false,
                };
                let s = (0..hir.stmts.len()).find(|&s| {
                    holds_it(&hir.stmts[s]) && !matches!(bound.stmt_parent[s], Parent::None)
                })?;
                StmtId(s as u32)
            }
        };
        let start = self.xa_alias_node_start(file, decl);
        let node = AliasNode { decl, start, stmt };
        Some(self.xa_place_of_alias_node(file, &node))
    }

    /// `GetErrorRangeForNode`
    fn xa_place_of_alias_node(&self, file: FileId, node: &AliasNode) -> (FileId, u32, u32) {
        let end = match self.xa_alias_node_end(file, node) {
            0 => self.end_of_token_at(file, node.start),
            end => end,
        };
        (file, node.start, end)
    }

    /// `GetErrorRangeForNode` of an `export *`.
    fn xa_place_of_export_star(&self, star: (FileId, StmtId)) -> (FileId, u32, u32) {
        let start = self.hir(star.0)[star.1].pos;
        (star.0, start, self.end_of_stmt(star.0, star.1))
    }

    // ───────────────────────────── what says `type` ─────────────────────────────

    /// `addTypeOnlyDeclarationRelatedInfo`: 1377 at `type_only` if `is_export`, or else 1376.
    pub(super) fn xa_type_only_related(
        &self,
        type_only: TypeOnlyDeclaration,
        is_export: bool,
        name: String,
    ) -> Vec<super::explain::Related> {
        let place = match type_only {
            TypeOnlyDeclaration::ExportStar(file, star) => {
                Some(self.xa_place_of_export_star((file, star)))
            }
            TypeOnlyDeclaration::Alias(alias, _, decl) => {
                self.place_of_alias_declaration(alias, decl)
            }
        };
        match place {
            Some(at) => vec![super::explain::Related {
                at: Some(at),
                code: if is_export { 1377 } else { 1376 },
                args: vec![name],
            }],
            None => Vec::new(),
        }
    }

    // ───────────────────────────── what is reported when the output is written ─────────────────────────────

    /// `MarkLinkedReferencesRecursively`, which `ImportElisionTransformer` runs before a file is written: whether it reports anything
    /// the check does not. `markIdentifierAliasReferenced` asks `getResolvedSymbol` of every identifier that is emitted as an
    /// expression. The check has asked nearly all of them. Not the `q` of `export import r = q`, which it resolves as a namespace:
    /// where `q` is no value, that is 2708, 2693 or 2304. tsgo's test harness counts them (TS-1). Nothing else shows them.
    pub fn mark_linked_references_recursively(&self, file: FileId) -> bool {
        let (files, hir, bound) = (self.files(), self.hir(file), self.bound(file));
        let (options, module) = (&files.options, files.module(file));
        // `emitJSFile`, `sourceFileMayBeEmitted`, `importElisionEnabled`, `canCollectSymbolAliasAccessibilityData`
        if options.no_emit
            || options.emit_declaration_only
            || options.verbatim_module_syntax
            || !matches!(hir.kind, FileKind::Ts | FileKind::Tsx)
            || hir.is_js
            || module.is_lib
            || module.is_from_external_library
        {
            return false;
        }
        hir.import_equals.iter().enumerate().any(|(i, import)| {
            let ImportEqualsTarget::Entity(names) = import.target else {
                return false;
            };
            // `NodeFlagsAmbient`
            let is_ambient = import.flags.contains(Flags::AMBIENT)
                || matches!(bound.stmt_parent[import.stmt.idx()], Parent::Module(m) if hir[m].flags.contains(Flags::AMBIENT));
            let meaning = SymFlags::VALUE | SymFlags::EXPORT_VALUE;
            import.flags.contains(Flags::EXPORT)
                && names.len() == 1
                && !is_ambient
                && files
                    .resolve_name(
                        file,
                        bound.import_equals_scope[i],
                        hir[names.at(0)].text,
                        meaning,
                    )
                    .is_none()
        })
    }

    /// `ConstEnumInliningTransformer`, the last transformer of `emitJSFile`: `GetConstantValue` asks `checkExpressionCached` of every
    /// property and element access that is written out, a node before its children. tsgo's test harness writes `.types` and
    /// `.symbols` from a program that has emitted BEFORE it is checked (`compileFilesWithHost`, `Options::emits_first`), so there each
    /// access is asked first, outside the function it is in, and a circle is come into at another place. JavaScript files are left out: whether one is written goes by `outDir`. tsgo emits
    /// all the files and then checks them: here it is file by file.
    pub(super) fn inline_const_enums(&mut self, file: FileId) {
        let (files, hir, bound) = (self.files(), self.hir(file), self.bound(file));
        let (options, module) = (&files.options, files.module(file));
        // `emitJSFile`, `sourceFileMayBeEmitted`, `GetIsolatedModules`
        if options.no_emit
            || options.emit_declaration_only
            || options.isolated_modules
            || options.verbatim_module_syntax
            || !matches!(hir.kind, FileKind::Ts | FileKind::Tsx)
            || hir.is_js
            || module.is_lib
            || module.is_from_external_library
        {
            return;
        }
        let index = self.exprs_by_kind(file);
        let mut accesses: Vec<ExprId> = [ExprTag::Dot, ExprTag::Index]
            .iter()
            .flat_map(|&tag| index.of(tag).iter().copied())
            .filter(|&e| !bound.is_unchecked(e.idx()) && !bound.is_in_type_query(e))
            .collect();
        // Of two that start at one place the outer is made last.
        accesses.sort_by_key(|&e| (self.start_of(file, e), std::cmp::Reverse(e)));
        for e in accesses {
            self.type_of_expr(file, e);
        }
    }

    // ───────────────────────────── what a module exports ─────────────────────────────

    /// `getExportsOfModuleWorker`: 2308
    fn xa_export_star_conflicts(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (files, hir) = (self.files(), self.hir(file));
        if self.bound(file).export_stars.len() < 2 || !files.module(file).is_module() {
            return;
        }
        // Those at one place come in the order of their messages.
        let mut said: Vec<(StmtId, Vec<String>)> = Vec::new();
        let links = files.module_links(files.file_symbol(file));
        for collision in links.export_collisions.iter() {
            let (of, first) = collision.first;
            if collision.duplicate.0 == file
                && let StmtKind::ExportStar { spec, .. } = self.hir(of)[first].kind
            {
                let specifier = self.xa_specifier_text(of, self.hir(of)[first].pos, spec);
                let arguments = vec![specifier, self.atom_text(collision.name)];
                said.push((collision.duplicate.1, arguments));
            }
        }
        said.sort();
        for (star, arguments) in said {
            let start = hir[star].pos;
            out.push(Diagnostic { start, code: 2308 });
            let end = self.end_of_stmt(file, star);
            self.explain_another(start, end, 2308, |_| arguments);
        }
    }

    // ───────────────────────────── the declarations of aliases ─────────────────────────────

    /// `node.Symbol`, of the declarations of aliases in `file`.
    pub(super) fn symbols_of_alias_declarations(&self, file: FileId) -> FxHashMap<Decl, Sym> {
        let mut symbols = FxHashMap::default();
        for (i, symbol) in self.bound(file).symbols.iter().enumerate() {
            if symbol.flags.contains(SymFlags::ALIAS) {
                let sym = self.files().sym(file, SymbolId(i as u32));
                symbols.extend(symbol.decls.iter().map(|&decl| (decl, sym)));
            }
        }
        symbols
    }

    /// `getVerbatimModuleSyntaxErrorMessage`
    pub(super) fn verbatim_module_syntax_error_message(&self, file: FileId) -> u32 {
        let path = &self.files().module(file).path;
        if path.ends_with(".cts") || path.ends_with(".cjs") {
            1286
        } else {
            1295
        }
    }

    /// `c.error(..)`, and `addTypeOnlyDeclarationRelatedInfo`. With `type_only`: whether it counts as an export.
    fn xa_error_about_type_only(
        &mut self,
        at: (FileId, u32, u32),
        code: u32,
        args: &[Arg<'_>],
        type_only: Option<(TypeOnlyDeclaration, bool)>,
        name: Atom,
    ) {
        let related = type_only.map_or_else(Vec::new, |(type_only, is_export)| {
            self.xa_type_only_related(type_only, is_export, self.atom_text(name))
        });
        let related = related
            .into_iter()
            .filter_map(super::explain::Related::into_reported);
        self.error(at, code, args)
            .related_information
            .extend(related);
    }

    /// `checkAliasSymbol`, of the declaration `decl` in the statement `stmt`. `is_ambient`: `node.Flags&NodeFlagsAmbient`.
    pub(super) fn check_alias_symbol(
        &mut self,
        file: FileId,
        aliases: &FxHashMap<Decl, Sym>,
        stmt: StmtId,
        decl: Decl,
        is_ambient: bool,
    ) {
        let Some(&sym) = aliases.get(&decl) else {
            return;
        };
        let files = self.files();
        let (hir, bound, options) = (self.hir(file), self.bound(file), &files.options);
        // `getTargetOfImportEqualsDeclaration`
        if let Decl::ImportEquals(x) = decl
            && let ImportEqualsTarget::Entity(names) = hir[x].target
        {
            self.xa_import_alias_of_type_only(file, x, names);
        }
        self.check_target_of_alias_declaration(file, sym, decl);
        // `getMergedSymbol(core.OrElse(symbol.ExportSymbol, symbol))`
        let symbol = match files.symbol(sym).export_symbol {
            SymbolId::NONE => sym,
            exported => files.sym(sym.file, exported),
        };
        // Most imports of most programs: the name means nothing else here, and the rest is for JavaScript and `isolatedModules`.
        let meanings =
            SymFlags::VALUE | SymFlags::EXPORT_VALUE | SymFlags::TYPE | SymFlags::NAMESPACE;
        if !hir.is_js && !options.isolated_modules && !files.flags(symbol).intersects(meanings) {
            return;
        }
        let target = self.resolve_alias(sym);
        let Some(target_flags) = self.flags_of_alias_target(sym) else {
            return;
        };
        let start = match decl {
            Decl::Require(pat) => hir[pat].pos,
            _ => self.xa_alias_node_start(file, decl),
        };
        let node = AliasNode { decl, start, stmt };
        let is_type = !target_flags.intersects(SymFlags::VALUE);
        let is_type_only = files.is_type_only_import_or_export_declaration(file, decl);
        let is_export_specifier = matches!(decl, Decl::ExportSpec(_));
        let binding_element = match decl {
            Decl::Require(pat) => match bound.pat_parent[pat.idx()] {
                PatParent::Prop(_, p) => Some(p),
                _ => None,
            },
            _ => None,
        };
        // A type-only import or export already has a grammar error in a JavaScript file.
        if hir.is_js && is_type && !is_type_only {
            // `node.PropertyNameOrName()`
            let name_start = match decl {
                Decl::ImportDefault(x) => hir[x].default_pos,
                Decl::ImportSpec(s) => hir[s].imported_pos,
                Decl::ExportSpec(s) => hir[s].local_pos,
                Decl::ImportEquals(x) => hir[x].name_pos,
                _ => binding_element.map_or(start, |p| hir[p].pos),
            };
            let at = self.place_of_token(file, name_start);
            if is_export_specifier {
                // The `@typedef` that exports it as it is.
                let exported = target.symbol().and_then(|target| {
                    let declarations = files.decls_of(target);
                    let mut declarations = declarations.iter();
                    declarations.find_map(|&(of, declared)| match declared {
                        Decl::Alias(a) if of == file && hir.is_in_jsdoc(hir[a].name_pos) => {
                            Some((hir[a].name_pos, files.symbol(target).name))
                        }
                        _ => None,
                    })
                });
                let related = exported.map(|(pos, name)| {
                    let at = self.place_of_token(file, pos);
                    self.new_diagnostic(at, 18044, &[Arg::Atom(name)])
                });
                self.error(at, 18043, &[])
                    .related_information
                    .extend(related);
                return;
            }
            // What is no Identifier goes by the name of the symbol.
            let written = hir.text.get(name_start as usize).copied();
            let name = files.symbol(sym).name;
            let identifier = match decl {
                _ if !written.is_some_and(is_identifier_part) => name,
                Decl::ImportSpec(s) => hir[s].imported,
                _ => binding_element.map_or(name, |p| hir[p].key.name().unwrap_or(name)),
            };
            // `TryGetModuleSpecifierFromDeclaration`
            let specifier = match decl {
                Decl::ImportDefault(x) | Decl::ImportNamespace(x) => hir[x].spec,
                Decl::ImportSpec(s) => hir[hir[s].import].spec,
                Decl::ImportEquals(x) => match hir[x].target {
                    ImportEqualsTarget::Require(spec) => spec,
                    ImportEqualsTarget::Entity(_) => Atom::NONE,
                },
                Decl::Require(pat) => bound.required_by(hir, pat).map_or(Atom::NONE, |it| it.0),
                _ => Atom::NONE,
            };
            let specifier = match specifier {
                Atom::NONE => &b"..."[..],
                specifier => files.atoms.bytes(specifier),
            };
            let mut import_text = [b"import(\"", specifier, b"\")"].concat();
            if matches!(decl, Decl::ImportSpec(_)) {
                import_text.push(b'.');
                import_text.extend_from_slice(files.atoms.bytes(identifier));
            }
            let args = [Arg::Atom(identifier), Arg::Bytes(&import_text)];
            self.error(at, 18042, &args);
            return;
        }
        // `declareSymbolEx`: a declaration that was refused is a symbol of its own, which means nothing besides.
        let own = if files.declaration_of_alias_symbol(sym) == Some((file, decl)) {
            files.flags(symbol)
        } else {
            SymFlags::ALIAS
        };
        let is_value_here = own.intersects(SymFlags::VALUE | SymFlags::EXPORT_VALUE);
        let mut excluded = SymFlags::empty();
        for (is_meant, meaning) in [
            (is_value_here, SymFlags::VALUE),
            (own.intersects(SymFlags::TYPE), SymFlags::TYPE),
            (own.intersects(SymFlags::NAMESPACE), SymFlags::NAMESPACE),
        ] {
            if is_meant {
                excluded |= meaning;
            }
        }
        let at = self.xa_place_of_alias_node(file, &node);
        if target_flags.intersects(excluded) {
            let code = if is_export_specifier { 2484 } else { 2440 };
            self.error(at, code, &[Arg::Sym(symbol)]);
        } else if !is_export_specifier
            // `compilerOptions.isolatedModules` itself, not `GetIsolatedModules`: `verbatimModuleSyntax` has its own error for the import.
            && options.isolated_modules_said
            && !is_type_only
            && is_value_here
        {
            self.error(at, 2865, &[Arg::Sym(symbol)]);
        }
        if !options.isolated_modules || is_type_only || is_ambient {
            return;
        }
        let is_verbatim = options.verbatim_module_syntax;
        let type_only_alias = files.alias_links(sym).type_only_declaration;
        let related = type_only_alias
            .filter(|_| !is_type)
            .map(|type_only| (type_only, type_only.is_export()));
        // `node.PropertyNameOrName().Text()`
        let name = match decl {
            Decl::ImportSpec(s) => hir[s].imported,
            Decl::ExportSpec(s) => hir[s].local,
            _ => files.symbol(sym).name,
        };
        let flag_name = super::errors_x_modules::isolated_modules_like_flag_name(files);
        if is_type || type_only_alias.is_some() {
            match decl {
                Decl::ImportDefault(_) | Decl::ImportSpec(_) | Decl::ImportEquals(_) => {
                    if is_verbatim {
                        let code = match decl {
                            Decl::ImportEquals(x)
                                if matches!(hir[x].target, ImportEqualsTarget::Entity(_)) =>
                            {
                                1288
                            }
                            _ if is_type => 1484,
                            _ => 1485,
                        };
                        self.xa_error_about_type_only(at, code, &[Arg::Atom(name)], related, name);
                    }
                    if is_type
                        && matches!(decl, Decl::ImportEquals(x) if hir[x].flags.contains(Flags::EXPORT))
                    {
                        self.error(at, 1269, &[Arg::Text(&flag_name)]);
                    }
                }
                // What says `type` in this very file can be seen to go away without looking at any other.
                Decl::ExportSpec(_)
                    if is_verbatim
                        || type_only_alias.is_none_or(|type_only| type_only.file() != file) =>
                {
                    if is_type {
                        self.error(at, 1205, &[Arg::Text(&flag_name)]);
                    } else {
                        let args = [Arg::Atom(name), Arg::Text(&flag_name)];
                        self.xa_error_about_type_only(at, 1448, &args, related, name);
                    }
                }
                _ => {}
            }
        }
        let is_import_equals = matches!(decl, Decl::ImportEquals(_));
        let is_variable_declaration = matches!(decl, Decl::Require(_)) && binding_element.is_none();
        if !is_import_equals && self.xm_emits_commonjs(file) {
            if is_verbatim && !hir.is_js {
                let code = self.verbatim_module_syntax_error_message(file);
                self.error(at, code, &[]);
            } else if options.module == ModuleKind::Preserve && !is_variable_declaration {
                self.error(at, 1293, &[]);
            }
        }
        if is_verbatim
            && let AliasTarget::Symbol(target) = target
            && self.xa_is_ambient_const_enum(target)
        {
            self.error(at, 2748, &[Arg::Text(&flag_name)]);
        }
    }

    /// `checkAndReportErrorForResolvingImportAliasToTypeOnlySymbol`: 1379 1380
    fn xa_import_alias_of_type_only(
        &mut self,
        file: FileId,
        x: ImportEqualsId,
        names: Span<NameId>,
    ) {
        let files = self.files();
        let (hir, bound) = (self.hir(file), self.bound(file));
        let names: Vec<Atom> = hir.texts(names).collect();
        for end in (1..=names.len()).rev() {
            // `getTypeOnlyDeclarationOfEntityName`
            let scope = bound.import_equals_scope[x.idx()];
            let Some(symbol) = files.resolve_entity(file, scope, &names[..end], ALL_MEANINGS)
            else {
                continue;
            };
            if !files.flags(symbol).contains(SymFlags::ALIAS) {
                continue;
            }
            let Some(type_only) = files.alias_links(symbol).type_only_declaration else {
                continue;
            };
            // Where what follows the `=` starts.
            let after_name = hir[x].name_pos as usize + files.atoms.bytes(hir[x].name).len();
            let Some(after_equals) = eat(&hir.text, after_name, b'=') else {
                return;
            };
            // `NodeKindIs(typeOnlyDeclaration, KindExportSpecifier, KindExportDeclaration)`
            let is_export = matches!(
                type_only,
                TypeOnlyDeclaration::Alias(_, _, Decl::ExportSpec(_))
                    | TypeOnlyDeclaration::ExportStar(..)
            );
            let start = skip_trivia(&hir.text, after_equals);
            let at = (file, start as u32, entity_name_end(&hir.text, start) as u32);
            let name = match type_only {
                // An `export type *` has no name.
                TypeOnlyDeclaration::ExportStar(..) => files.atoms.intern(b"*"),
                TypeOnlyDeclaration::Alias(alias, ..) => files.symbol(alias).name,
            };
            let code = if is_export { 1379 } else { 1380 };
            self.xa_error_about_type_only(at, code, &[], Some((type_only, is_export)), name);
            return;
        }
    }

    /// A `const enum` whose first declaration is only declared.
    fn xa_is_ambient_const_enum(&self, sym: Sym) -> bool {
        let files = self.files();
        files.flags(sym).intersects(SymFlags::ENUM)
            && files
                .decls(sym)
                .iter()
                .find_map(|&(f, d)| {
                    if let Decl::Enum(e) = d {
                        Some((f, e))
                    } else {
                        None
                    }
                })
                .is_some_and(|(f, e)| {
                    let flags = self.hir(f)[e].flags;
                    flags.contains(Flags::CONST)
                        && (flags.contains(Flags::AMBIENT)
                            || self.hir(f).kind == FileKind::Declaration)
                })
    }

    /// The end of `onSuccessfullyResolvedSymbol`: 2866 at an import that stands for no value, where its name is used for a global value.
    fn xa_imports_hiding_global_values(&self, file: FileId, out: &mut Vec<Diagnostic>) {
        let files = self.files();
        let (hir, bound) = (self.hir(file), self.bound(file));
        // `compilerOptions.isolatedModules` itself, not `GetIsolatedModules`. `IsExternalOrCommonJSModule`
        if !files.options.isolated_modules_said
            || bound.alias_idents.is_empty()
            || !files.module(file).is_module()
        {
            return;
        }
        let locals = bound.scopes[0].locals;
        let mut seen: Vec<SymbolId> = Vec::new();
        for &(e, scope) in &bound.alias_idents {
            let ExprKind::Ident(name) = hir[e].kind else {
                continue;
            };
            // `checkExportAssignment`: a name that is no value is not checked as an expression.
            let is_checked = match bound.expr_parent[e.idx()] {
                Parent::None => false,
                Parent::Stmt(s) if s.is_some() => !matches!(
                    hir[s].kind,
                    StmtKind::ExportAssign(_) | StmtKind::ExportDefault(_)
                ),
                _ => true,
            };
            if !is_checked || hir.is_in_with(hir[e].pos) {
                continue;
            }
            // `getSymbol(lastLocation.Locals(), name, ^SymbolFlagsValue)`
            let Some(local) = bound.lookup(locals, name) else {
                continue;
            };
            if seen.contains(&local) {
                continue;
            }
            let found = files.resolve_name(file, scope, name, SymFlags::VALUE);
            if found.is_none() || found != files.global(name, SymFlags::VALUE) {
                continue;
            }
            seen.push(local);
            let import = bound.symbols[local.idx()].decls.iter().copied().find(|d| {
                matches!(
                    d,
                    Decl::ImportDefault(_)
                        | Decl::ImportNamespace(_)
                        | Decl::ImportSpec(_)
                        | Decl::ImportEquals(_)
                )
            });
            let Some(import) = import else { continue };
            // `IsTypeOnlyImportDeclaration`
            if files.is_type_only_import_or_export_declaration(file, import) {
                continue;
            }
            let start = match import {
                Decl::ImportDefault(x) => hir[x].default_pos,
                Decl::ImportNamespace(x) => hir[x].namespace_pos,
                Decl::ImportSpec(s) => hir[s].imported_pos,
                Decl::ImportEquals(x) => hir
                    .stmts
                    .iter()
                    .find(|s| matches!(s.kind, StmtKind::ImportEquals(i) if i == x))
                    .map_or(hir[x].name_pos, |s| s.pos),
                _ => continue,
            };
            out.push(Diagnostic { start, code: 2866 });
            let end = match import {
                Decl::ImportDefault(x) => self
                    .xa_specifier_pos(file, start, hir[x].spec)
                    .map_or(0, |at| {
                        super::errors_x_modules::import_clause_end(&hir.text, at)
                    }),
                Decl::ImportSpec(s) => self.end_of_import_spec(file, s),
                Decl::ImportEquals(_) => self.xa_statement_end(file, start),
                _ => 0,
            };
            self.note(start, end, 2866, vec![self.atom_text(name)]);
        }
    }

    /// `markDecoratorAliasReferenced`, `markEntityNameOrEntityExpressionAsReference`: 1272 at each type of a decorated signature that
    /// `emitDecoratorMetadata` writes out by name, if the name is an import that stands for no value and does not say `type`.
    fn xa_decorator_metadata(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let files = self.files();
        let (hir, bound) = (self.hir(file), self.bound(file));
        let options = &files.options;
        // `canCollectSymbolAliasAccessibilityData`, `GetIsolatedModules`, `GetEmitModuleKind`
        if !options.emit_decorator_metadata
            || options.verbatim_module_syntax
            || !options.isolated_modules
            || options.module < ModuleKind::Es2015
            || hir.decorators.is_empty()
        {
            return;
        }
        // `getParameterTypeNodeForDecoratorCheck`, `GetRestParameterElementType`
        let type_of_parameter = |p: ParamId| {
            let ty = hir[p].ty;
            if ty.is_none() || !hir[p].flags.contains(Flags::REST) {
                return ty;
            }
            match hir[ty].kind {
                TypeNodeKind::Array(element) => element,
                TypeNodeKind::Ref { args, .. } if !args.is_empty() => hir.id_at(args, 0),
                _ => TypeNodeId::NONE,
            }
        };
        let signature = |f: FnId, types: &mut Vec<TypeNodeId>| {
            types.push(hir[f].this_ty(hir));
            types.extend(hir[f].params.iter().map(|p| type_of_parameter(p)));
            types.push(hir[f].ret);
        };
        // `getAnnotatedAccessorTypeNode`
        let type_of_accessor = |m: MemberId| {
            let f = hir[m].func;
            if f.is_none() {
                TypeNodeId::NONE
            } else if hir[m].kind == MemberKind::Getter {
                hir[f].ret
            } else {
                hir[f]
                    .params
                    .iter()
                    .next()
                    .map_or(TypeNodeId::NONE, |p| hir[p].ty)
            }
        };
        let mut types: Vec<TypeNodeId> = Vec::new();
        let mut last = None;
        for &(owner, e) in &hir.decorators {
            // The decorators of one node follow each other.
            if last == Some(owner) {
                continue;
            }
            last = Some(owner);
            // `NodeCanBeDecorated`
            if bound.is_unchecked(e.idx()) || bound.refused_decorators.contains(&e) {
                continue;
            }
            match owner {
                DecoratorOwner::Class(c) => {
                    if !matches!(bound.class_owner[c.idx()], ClassOwner::Stmt(_))
                        || hir[c].flags.contains(Flags::AMBIENT)
                    {
                        continue;
                    }
                    // `GetFirstConstructorWithBody`
                    let constructor = hir[c].members.iter().find(|&m| {
                        hir[m].kind == MemberKind::Constructor
                            && hir[m].func.is_some()
                            && !matches!(hir[hir[m].func].body, FnBody::None)
                    });
                    if let Some(constructor) = constructor {
                        signature(hir[constructor].func, &mut types);
                    }
                }
                DecoratorOwner::Member(m) => match hir[m].kind {
                    MemberKind::Property => types.push(hir[m].ty),
                    MemberKind::Method => signature(hir[m].func, &mut types),
                    MemberKind::Getter | MemberKind::Setter => {
                        let mut ty = type_of_accessor(m);
                        if ty.is_none()
                            && let MemberOwner::Class(c) = bound.member_owner[m.idx()]
                        {
                            let other = hir[c].members.iter().find(|&o| {
                                matches!(hir[o].kind, MemberKind::Getter | MemberKind::Setter)
                                    && hir[o].kind != hir[m].kind
                                    && hir[o].key == hir[m].key
                                    && hir[o].flags.contains(Flags::STATIC)
                                        == hir[m].flags.contains(Flags::STATIC)
                            });
                            ty = other.map_or(TypeNodeId::NONE, |o| type_of_accessor(o));
                        }
                        types.push(ty);
                    }
                    _ => {}
                },
                DecoratorOwner::Param(p) => {
                    let f = bound.param_fn[p.idx()];
                    if f.is_some() {
                        signature(f, &mut types);
                    }
                }
            }
        }
        for ty in types {
            let Some(reference) = self.xa_entity_name_for_decorator_metadata(file, ty) else {
                continue;
            };
            let TypeNodeKind::Ref { name, .. } = hir[reference].kind else {
                continue;
            };
            if name.is_empty() {
                continue;
            }
            let meaning = SymFlags::ALIAS
                | if name.len() == 1 {
                    SymFlags::TYPE
                } else {
                    SymFlags::NAMESPACE
                };
            let scope = bound.type_scope[reference.idx()];
            let Some(root) = files.resolve_name(file, scope, hir[name.at(0)].text, meaning) else {
                continue;
            };
            if !files.flags(root).contains(SymFlags::ALIAS) {
                continue;
            }
            // `symbolIsValue`: not by way of what says `type`. An alias that leads nowhere is everything.
            let is_value = files.flags(root).intersects(SymFlags::VALUE)
                || files.alias_links(root).type_only_declaration.is_none()
                    && files.symbol_flags(root).intersects(SymFlags::VALUE);
            if is_value
                || files
                    .symbol(root)
                    .decls
                    .iter()
                    .any(|&d| files.is_type_only_import_or_export_declaration(root.file, d))
            {
                continue;
            }
            let start = hir[reference].pos;
            out.push(Diagnostic { start, code: 1272 });
            self.note(
                start,
                entity_name_end(&hir.text, start as usize) as u32,
                1272,
                Vec::new(),
            );
            self.relate(start, 1272, |c| {
                // The first of its declarations that declares an alias.
                let declared = c
                    .files()
                    .symbol(root)
                    .decls
                    .iter()
                    .find_map(|&d| c.place_of_alias_declaration(root, d));
                match declared {
                    Some(at) => vec![super::explain::Related {
                        at: Some(at),
                        code: 1376,
                        args: vec![c.atom_text(hir[name.at(0)].text)],
                    }],
                    None => Vec::new(),
                }
            });
        }
    }

    /// `getEntityNameForDecoratorMetadata`: the type reference whose name stands for `ty` in the metadata.
    fn xa_entity_name_for_decorator_metadata(
        &self,
        file: FileId,
        ty: TypeNodeId,
    ) -> Option<TypeNodeId> {
        if ty.is_none() {
            return None;
        }
        let hir = self.hir(file);
        let parts: Vec<TypeNodeId> = match hir[ty].kind {
            TypeNodeKind::Ref { .. } => return Some(ty),
            TypeNodeKind::Union(types) | TypeNodeKind::Intersection(types) => {
                hir.ids(types).collect()
            }
            TypeNodeKind::Cond { yes, no, .. } => vec![yes, no],
            _ => return None,
        };
        // `getEntityNameForDecoratorMetadataFromTypeList`
        let mut common: Option<TypeNodeId> = None;
        for part in parts {
            match hir[part].kind {
                TypeNodeKind::Keyword(Keyword::Never) => continue,
                TypeNodeKind::Keyword(Keyword::Null | Keyword::Undefined)
                    if !self.files().options.strict_null_checks =>
                {
                    continue;
                }
                _ => {}
            }
            let individual = self.xa_entity_name_for_decorator_metadata(file, part)?;
            let Some(first) = common else {
                common = Some(individual);
                continue;
            };
            // Both are the same identifier, or an `Object` is written out.
            let (TypeNodeKind::Ref { name: a, .. }, TypeNodeKind::Ref { name: b, .. }) =
                (hir[first].kind, hir[individual].kind)
            else {
                return None;
            };
            if a.len() != 1 || b.len() != 1 || hir[a.at(0)].text != hir[b.at(0)].text {
                return None;
            }
        }
        common
    }

    // ───────────────────────────── module specifiers ─────────────────────────────

    /// `resolveExternalModule`, with an `errorNode`: the specifier `written` in `file`. Whether it finds the module.
    pub(super) fn resolve_external_module(
        &mut self,
        file: FileId,
        written: SpecifierUse,
        site: SpecifierSite,
    ) -> bool {
        let files = self.files();
        let (options, importing) = (&files.options, files.module(file));
        let SpecifierUse {
            spec,
            pos: start,
            kind,
            ..
        } = written;
        let is_side_effect = kind == SpecifierKind::SideEffect;
        // `checkImportDeclaration` does not ask.
        if is_side_effect && !options.no_unchecked_side_effect_imports {
            return true;
        }
        let mode =
            crate::program::mode_for_usage_location(options, importing.default_mode, &written);
        let (key, at) = ((spec, mode), self.place_of_token(file, start));
        let text = files.atoms.text(spec);
        if let Some(without_prefix) = text.strip_prefix("@types/") {
            self.error(at, 6137, &[Arg::Text(without_prefix), Arg::Atom(spec)]);
        }
        // `tryFindAmbientModule` and `patternAmbientModules` have what scripts declare. A `declare module` that adds to nothing is not
        // there, and does not stand in the way of a file.
        let found = files.module_of_specifier_as(file, spec, mode);
        if found.is_some_and(|m| !self.xm_is_a_file(m) && self.xm_is_declared_by_a_script(m)) {
            return true;
        }
        let target = importing.imports.get(&key);
        // `GetResolutionDiagnostic`, `needJsx`: reported whether or not the file is in the program for another reason.
        let mut needs_jsx = importing.jsx_imports.iter();
        if let Some(&(.., path)) = needs_jsx.find(|r| (r.0, r.1) == key) {
            self.error(at, 6142, &[Arg::Atom(spec), Arg::Atom(path)]);
            if target.is_none() {
                return false;
            }
        }
        if let Some(&target) = target {
            let target = files.module(target);
            // `ResolvedUsingTsExtension`
            let using_ts_extension = importing.ts_extension_imports.contains(&key);
            let is_declaration_name = (using_ts_extension
                || options.rewrite_relative_import_extensions)
                && is_declaration_file_name(&text);
            if using_ts_extension && is_declaration_name {
                if site.is_emittable {
                    let is_esm = (ModuleKind::Es2015..=ModuleKind::EsNext)
                        .contains(&options.module)
                        || mode == ResolutionMode::Import;
                    let prefers_ts = options.allow_importing_ts_extensions;
                    let suggested = suggested_import_source(&text, is_esm, prefers_ts);
                    self.error(at, 2846, &[Arg::Text(&suggested)]);
                }
            // `AllowImportingTsExtensionsFrom`
            } else if using_ts_extension
                && !options.allow_importing_ts_extensions
                && !is_declaration_file_name(&importing.path)
            {
                if site.is_emittable {
                    // An extension that a pattern of `imports` or `paths` matched may be anywhere in the specifier.
                    let extension = try_extract_ts_extension(&text).or_else(|| {
                        [".ts", ".tsx", ".d.ts", ".cts", ".d.cts", ".mts", ".d.mts"]
                            .into_iter()
                            .find(|&e| text.contains(e))
                    });
                    self.error(at, 5097, &[Arg::Text(extension.unwrap_or(""))]);
                }
            } else if options.rewrite_relative_import_extensions
                && !site.is_ambient
                && !is_declaration_name
                && kind != SpecifierKind::ImportType
                && !site.is_type_only
            {
                // `ShouldRewriteModuleSpecifier`, `SourceFileMayBeEmitted`. 2878 needs project references, which are not supported.
                let should_rewrite =
                    is_relative_path(text.as_bytes()) && strip_ts_extension(&text).is_some();
                let may_be_emitted = target.hir.kind != FileKind::Declaration
                    && !target.path.contains("/node_modules/");
                if !using_ts_extension && should_rewrite {
                    let path = relative_path_from_file(&importing.path, &target.path);
                    self.error(at, 2876, &[Arg::Text(&path)]);
                } else if using_ts_extension && !should_rewrite && may_be_emitted {
                    // `GetAnyExtensionFromPath`
                    let base = &text[text.rfind('/').map_or(0, |i| i + 1)..];
                    let extension = base.rfind('.').map_or("", |i| &base[i..]);
                    self.error(at, 2877, &[Arg::Text(extension)]);
                }
            }
            if !target.is_module() {
                if !is_side_effect {
                    let mut redirected = importing.redirected_imports.iter();
                    let path = match redirected.find(|r| (r.0, r.1) == key) {
                        Some(r) => Arg::Atom(r.2),
                        None => Arg::Text(&target.path),
                    };
                    self.error(at, 2306, &[path]);
                }
                return false;
            }
            // `require` cannot load an ECMAScript module. Only what has code in it is of either kind.
            let is_sync_import = !importing.is_esm && kind != SpecifierKind::ImportCall
                || kind == SpecifierKind::Require;
            let source = &self.hir(file).text[..];
            if matches!(options.module, ModuleKind::Node16 | ModuleKind::Node18)
                && is_sync_import
                && target.is_esm
                && !target.path.ends_with(".json")
                // `HasResolutionModeOverride`
                && !(matches!(
                    kind,
                    SpecifierKind::SideEffect | SpecifierKind::Import | SpecifierKind::ImportType
                ) && string_literal(source, start as usize).is_some_and(|(_, end)| {
                    has_resolution_mode_override(source, end, kind == SpecifierKind::ImportType)
                }))
            {
                let (code, details) = match kind {
                    SpecifierKind::Require => (1471, None),
                    SpecifierKind::Import if site.is_type_only_import => {
                        (1541, self.create_mode_mismatch_details(file, at))
                    }
                    SpecifierKind::ImportType => {
                        (1542, self.create_mode_mismatch_details(file, at))
                    }
                    _ => (1479, self.create_mode_mismatch_details(file, at)),
                };
                let diagnostic = self.new_diagnostic_chain(details, at, code, &[Arg::Atom(spec)]);
                self.add_diagnostic(diagnostic);
            }
            return true;
        }
        // `GetResolutionDiagnostic`, `needAllowArbitraryExtensions`
        let mut arbitrary = importing.arbitrary_extension_imports.iter();
        if let Some(index) = arbitrary.position(|&u| u == key) {
            let path = importing.arbitrary_extension_files[index];
            self.error(at, 6263, &[Arg::Atom(spec), Arg::Atom(path)]);
            return false;
        }
        // The specifier resolves to JavaScript that is not in the program.
        if importing.untyped_imports.contains(&key) {
            if options.no_implicit_any && !is_side_effect {
                self.error_on_implicit_any_module(file, spec, mode, at);
            }
            return false;
        }
        let mut extensionless = importing.extensionless_imports.iter();
        if !options.resolve_json_module && text.ends_with(".json") {
            self.error(at, 2732, &[Arg::Atom(spec)]);
        } else if options.resolves_like_node
            && mode == ResolutionMode::Import
            && let Some(&(_, is_there)) = extensionless.find(|e| e.0 == spec)
        {
            // Only of what is not found is it said that Node's `import` wants the extension written.
            let extension =
                super::errors_x_modules::suggested_import_extension(files, &importing.path, &text);
            match extension.filter(|_| is_there) {
                Some(extension) => {
                    let suggested = [text.as_bytes(), extension.as_bytes()].concat();
                    self.error(at, 2835, &[Arg::Bytes(&suggested)])
                }
                None => self.error(at, if is_there { 2835 } else { 2834 }, &[]),
            };
        } else if is_side_effect {
            self.error(at, 2882, &[Arg::Atom(spec)]);
        // `getCannotResolveModuleNameErrorForSpecificModule`: only for a string literal, not for a template.
        } else if crate::resolve::is_node_core_module(&text)
            && self.hir(file).text.get(start as usize) != Some(&b'`')
        {
            let types = options.types.as_ref();
            let uses_wildcard_types = types.is_some_and(|t| t.iter().any(|t| t == "*"));
            let code = if uses_wildcard_types { 2580 } else { 2591 };
            self.error(at, code, &[Arg::Atom(spec)]);
        } else {
            self.error(at, 2307, &[Arg::Atom(spec)]);
        }
        false
    }

    /// `createModeMismatchDetails`, for an extension `resolveExternalModule` asks it about.
    fn create_mode_mismatch_details(
        &mut self,
        file: FileId,
        at: (FileId, u32, u32),
    ) -> Option<Reported> {
        let importing = self.files().module(file);
        let path = &importing.path;
        let target_extension = if path.ends_with(".d.ts") {
            return None;
        } else if path.ends_with(".ts") {
            Some(".mts")
        } else if path.ends_with(".js") {
            Some(".mjs")
        } else if path.ends_with(".tsx") || path.ends_with(".jsx") {
            None
        } else {
            return None;
        };
        // The `package.json` the file goes by, if that says no `type`.
        let package_json = Some(importing.package_json_without_type).filter(|it| it.is_some());
        let code = match (target_extension, package_json) {
            (Some(_), Some(_)) => 1481,
            (None, Some(_)) => 1482,
            (Some(_), None) => 1480,
            (None, None) => 1483,
        };
        let args = target_extension.map(Arg::Text).into_iter();
        let args: Vec<Arg<'_>> = args.chain(package_json.map(Arg::Atom)).collect();
        Some(self.new_diagnostic(at, code, &args))
    }

    // ───────────────────────────── expressions ─────────────────────────────

    fn xa_expressions(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if !self.files().options.isolated_modules {
            let index = self.exprs_by_kind(file);
            for tag in [
                ExprTag::ImportCall,
                ExprTag::ImportMeta,
                ExprTag::Missing,
                ExprTag::NewTarget,
            ] {
                for &e in index.of(tag) {
                    self.xa_import_call_or_meta_property(file, e, out);
                }
            }
            return;
        }
        // Names and what is in namespaces are looked at as well, all in the order they have in the file.
        for i in 0..hir.exprs.len() {
            let e = ExprId(i as u32);
            match hir.exprs[i].kind {
                ExprKind::Ident(_) => {
                    let local = bound.expr_symbol[i];
                    if (local.is_none()
                        || bound.symbols[local.idx()]
                            .flags
                            .intersects(SymFlags::ENUM | SymFlags::ALIAS))
                        && !bound.is_unchecked(i)
                    {
                        self.xa_const_enum_access(file, e, out);
                    }
                }
                ExprKind::Dot { .. } => {
                    if !bound.is_unchecked(i) {
                        self.xa_const_enum_access(file, e, out);
                    }
                }
                ExprKind::ImportCall { .. }
                | ExprKind::ImportMeta
                | ExprKind::Missing
                | ExprKind::NewTarget(_) => self.xa_import_call_or_meta_property(file, e, out),
                _ => {}
            }
        }
    }

    fn xa_import_call_or_meta_property(
        &mut self,
        file: FileId,
        e: ExprId,
        out: &mut Vec<Diagnostic>,
    ) {
        let files = self.files();
        let (hir, bound) = (self.hir(file), self.bound(file));
        if bound.is_unchecked(e.idx()) {
            return;
        }
        match hir[e].kind {
            // `checkImportCallExpression`
            ExprKind::ImportCall { args, .. } => {
                let argument = hir.id_at(args, 0);
                if matches!(hir[argument].kind, ExprKind::Missing | ExprKind::Spread(_)) {
                    return;
                }
                let ty = self.type_of_expr(file, argument);
                if !self.is_known(ty) {
                    return;
                }
                if ty.is_undefined() || ty.is_null() || !self.is_assignable(ty, TypeId::STRING) {
                    let start = self.start_of(file, argument);
                    out.push(Diagnostic { start, code: 7036 });
                    let end = self.end_of_expr(file, argument);
                    self.explain_to(start, end, 7036, |c| vec![c.type_to_string(ty)]);
                }
            }
            // `checkImportMetaProperty`
            kind @ (ExprKind::ImportMeta | ExprKind::Missing) => {
                let module = files.options.module;
                let code = if module.is_node() {
                    if files.module(file).is_esm {
                        return;
                    }
                    1470
                } else if module < ModuleKind::Es2020 && module != ModuleKind::System {
                    1343
                } else {
                    return;
                };
                let start = hir[e].pos;
                if matches!(kind, ExprKind::ImportMeta)
                    || is_other_import_meta_property(&hir.text, start)
                {
                    out.push(Diagnostic { start, code });
                    let end = meta_property_end(&hir.text, start, b"import");
                    self.note(start, end, code, Vec::new());
                }
            }
            // `checkNewTargetMetaProperty`
            ExprKind::NewTarget(_) => {
                let node = self.hir(file).node(e);
                if self.hir(file).get_new_target_container(node).is_none() {
                    let start = hir[e].pos;
                    out.push(Diagnostic { start, code: 17013 });
                    let end = meta_property_end(&hir.text, start, b"new");
                    self.note(start, end, 17013, vec!["new.target".to_owned()]);
                }
            }
            _ => {}
        }
    }

    /// `checkConstEnumAccess`, as far as 2748 goes: `e` is a name, or a name in a namespace.
    fn xa_const_enum_access(&mut self, file: FileId, e: ExprId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let ty = self.type_of_expr(file, e);
        let TypeData::Anon {
            origin: Origin::EnumObject(sym),
            ..
        } = *self.data(ty)
        else {
            return;
        };
        if !self.xa_is_ambient_const_enum(sym) {
            return;
        }
        // Under `verbatimModuleSyntax` alone an import is where it is said, and what is misused has been told so.
        if !self.p.files.options.isolated_modules_said {
            let is_accessed = matches!(bound.expr_parent[e.idx()], Parent::Expr(p) if p.is_some() && matches!(hir[p].kind, ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } if obj == e));
            let first = first_identifier(hir, e);
            let local = bound.expr_symbol[first.idx()];
            if !is_accessed
                || local.is_some() && bound.symbols[local.idx()].flags.contains(SymFlags::ALIAS)
            {
                return;
            }
        }
        // `IsValidTypeOnlyAliasUseSite`
        // Nothing leads to it: nothing is said of it.
        let node = self.hir(file).node(e);
        if bound.is_in_type_query(e)
            || self.hir(file).parent(node).is_none()
            || self.hir(file).is_ambient(node)
        {
            return;
        }
        let mut top = e;
        let around = loop {
            match bound.expr_parent[top.idx()] {
                Parent::Expr(p) if matches!(hir[p].kind, ExprKind::Dot { obj, .. } if obj == top) => {
                    top = p
                }
                other => break other,
            }
        };
        match around {
            // The name of a member that is not there when the program runs.
            Parent::MemberKey(_) | Parent::MethodKey(_) => {
                if let Some(m) = hir
                    .members
                    .iter()
                    .position(|m| m.key == PropKey::Computed(top))
                    && (hir.members[m].flags.contains(Flags::ABSTRACT)
                        || !matches!(bound.member_owner[m], MemberOwner::Class(_)))
                {
                    return;
                }
            }
            // `export default E`, `export = E`: a name by itself there is no expression. `E.A` is one, and so is `(E)`.
            Parent::Stmt(s)
                if top == e
                    && s.is_some()
                    && matches!(hir[e].kind, ExprKind::Ident(_))
                    && matches!(
                        hir[s].kind,
                        StmtKind::ExportDefault(_) | StmtKind::ExportAssign(_)
                    )
                    && !is_parenthesized(hir, e) =>
            {
                return;
            }
            _ => {}
        }
        let flag_name = super::errors_x_modules::isolated_modules_like_flag_name(self.files());
        let start = self.start_inside_parentheses(file, e);
        out.push(Diagnostic { start, code: 2748 });
        self.note(
            start,
            self.end_inside_parentheses(file, e),
            2748,
            vec![flag_name.clone()],
        );
        // Parentheses around it are an expression of the same type.
        if self.p.files.options.isolated_modules_said
            && let Some(start) = open_parenthesis(hir, e)
        {
            out.push(Diagnostic { start, code: 2748 });
            self.note(
                start,
                self.end_of_expr_from(file, e, start),
                2748,
                vec![flag_name],
            );
        }
    }

    // ───────────────────────────── comments that are about errors ─────────────────────────────

    /// `getBindAndCheckDiagnosticsWithChecker`: nothing is said of a file that says `// @ts-nocheck`; what `// @ts-ignore` and
    /// `// @ts-expect-error` are about is taken back; and an error that was expected and did not come is one: 2578.
    /// `out` is everything the file has been told: this comes after all the rest.
    pub fn check_x_comment_directives(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let hir = self.hir(file);
        let text = &hir.text[..];
        // `SkipTypeChecking`
        if hir.check_directive == Some(false) {
            out.clear();
            return;
        }
        let directives = &hir.comment_directives;
        if directives.is_empty() {
            return;
        }
        let line_starts = compute_ecma_line_starts(text);
        let line_of = |pos: u32| line_starts.partition_point(|&start| start <= pos) - 1;
        // `directivesByLine`: the line, where the directive starts, whether an error is expected, and whether one came.
        let mut by_line: Vec<(usize, u32, bool, bool)> = Vec::new();
        for &CommentDirective { start, kind, .. } in directives {
            let expects_error = kind == CommentDirectiveKind::ExpectError;
            let line = line_of(start);
            // The last in a line is the one that counts.
            if by_line.last().is_some_and(|last| last.0 == line) {
                by_line.pop();
            }
            by_line.push((line, start, expects_error, false));
        }
        // `getDiagnosticsWithPrecedingDirectives`
        out.retain(|d| {
            let mut line = line_of(d.start);
            while line > 0 {
                line -= 1;
                if let Ok(i) = by_line.binary_search_by_key(&line, |directive| directive.0) {
                    // `GetIncludeProcessorDiagnostics`: what loading the program came upon is gone through apart from the rest. It
                    // is taken back, and is not the error that was expected.
                    by_line[i].3 |= !matches!(d.code, 1006 | 2688 | 2726 | 2727 | 6053);
                    return false;
                }
                if !is_comment_or_blank_line(text, line_starts[line] as usize) {
                    break;
                }
            }
            true
        });
        // An error that may have been there and was not found is not said to be missing.
        if hir.has_errors || hir.syntax_errors > 0 {
            return;
        }
        for &(line, start, expects_error, has_come) in &by_line {
            if !expects_error || has_come {
                continue;
            }
            // What it is about: the next line that is neither empty nor a comment, and what is begun there up to the next statement.
            let mut next = line + 1;
            while next < line_starts.len()
                && is_comment_or_blank_line(text, line_starts[next] as usize)
            {
                next += 1;
            }
            let end = text.len() as u32;
            let from = line_starts.get(next).copied().unwrap_or(end);
            let line_end = line_starts.get(next + 1).copied().unwrap_or(end);
            let to = hir
                .stmts
                .iter()
                .map(|s| s.pos)
                .filter(|&pos| pos >= line_end)
                .min()
                .unwrap_or(end);
            if self.xa_is_all_known(file, from, to) && !self.timed_out() {
                out.push(Diagnostic { start, code: 2578 });
                let end = directives
                    .iter()
                    .find(|directive| directive.start == start)
                    .map_or(0, |directive| directive.end);
                self.note(start, end, 2578, Vec::new());
            }
        }
    }

    /// Whether the type of everything written from `from` up to `to` has been worked out. An error that rests on one that has
    /// not is kept back.
    fn xa_is_all_known(&mut self, file: FileId, from: u32, to: u32) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        for i in 0..hir.exprs.len() {
            if !(from..to).contains(&hir.exprs[i].pos) || bound.is_unchecked(i) {
                continue;
            }
            let e = ExprId(i as u32);
            let ty = self.type_at(file, e);
            if !self.is_known(ty) {
                return false;
            }
        }
        for i in 0..hir.types.len() {
            if !(from..to).contains(&hir.types[i].pos) || bound.is_unchecked_type(i) {
                continue;
            }
            let ty = self.type_from_node(file, TypeNodeId(i as u32));
            if !self.is_known(ty) {
                return false;
            }
        }
        true
    }
}

// ───────────────────────────── how things are written ─────────────────────────────

/// Where `word` ends, if it is what is written at `at`.
fn eat_word(text: &[u8], at: usize, word: &[u8]) -> Option<usize> {
    is_word_at(text, at, word).then_some(at + word.len())
}

/// Past `c`, if it is the next token from `at` on.
fn eat(text: &[u8], at: usize, c: u8) -> Option<usize> {
    let at = skip_trivia(text, at);
    (text.get(at) == Some(&c)).then_some(at + 1)
}

/// Whether `import.name` is written at `pos`, the name being neither `meta` nor `defer`. It is kept as a missing expression.
fn is_other_import_meta_property(text: &[u8], pos: u32) -> bool {
    eat_word(text, pos as usize, b"import")
        .and_then(|end| eat(text, end, b'.'))
        .is_some_and(|dot_end| eat_word(text, skip_trivia(text, dot_end), b"defer").is_none())
}

/// Where the meta-property `keyword.name` at `pos` ends. 0 if that is not what is written there.
fn meta_property_end(text: &[u8], pos: u32, keyword: &[u8]) -> u32 {
    let Some(dot_end) = eat_word(text, pos as usize, keyword).and_then(|end| eat(text, end, b'.'))
    else {
        return 0;
    };
    word_end(text, skip_trivia(text, dot_end)) as u32
}

/// The string literal at `at`: what is between the quotes, as written, and where it ends.
fn string_literal(text: &[u8], at: usize) -> Option<(&[u8], usize)> {
    let quote = *text.get(at)?;
    if quote != b'"' && quote != b'\'' {
        return None;
    }
    let mut end = at + 1;
    while end < text.len() && text[end] != quote {
        if text[end] == b'\n' {
            return None;
        }
        end += if text[end] == b'\\' { 2 } else { 1 };
    }
    (end < text.len()).then(|| (&text[at + 1..end], end + 1))
}

/// `HasResolutionModeOverride`: `with { "resolution-mode": "import" }` after the specifier, which ends at `at`; in a type,
/// `, { with: { "resolution-mode": "import" } }`.
fn has_resolution_mode_override(text: &[u8], at: usize, is_import_type: bool) -> bool {
    let attempt = || -> Option<usize> {
        let mut at = at;
        if is_import_type {
            at = eat(text, eat(text, at, b',')?, b'{')?;
        }
        at = skip_trivia(text, at);
        at = eat_word(text, at, b"with").or_else(|| eat_word(text, at, b"assert"))?;
        if is_import_type {
            at = eat(text, at, b':')?;
        }
        at = eat(text, at, b'{')?;
        let (name, end) = string_literal(text, skip_trivia(text, at))?;
        at = eat(text, end, b':')?;
        let (value, end) = string_literal(text, skip_trivia(text, at))?;
        if name != b"resolution-mode" || value != b"import" && value != b"require" {
            return None;
        }
        eat(text, eat(text, end, b',').unwrap_or(end), b'}')
    };
    attempt().is_some()
}

/// `PathIsRelative`
fn is_relative_path(path: &[u8]) -> bool {
    path == b"." || path == b".." || path.starts_with(b"./") || path.starts_with(b"../")
}

/// `path` without the extension of TypeScript's it ends with, if it ends with one.
fn strip_ts_extension(path: &str) -> Option<&str> {
    [".d.ts", ".d.mts", ".d.cts", ".mts", ".cts", ".ts", ".tsx"]
        .into_iter()
        .find_map(|e| path.strip_suffix(e))
        .filter(|stem| !stem.is_empty())
}

/// `TryExtractTSExtension`
fn try_extract_ts_extension(path: &str) -> Option<&'static str> {
    [".d.ts", ".d.cts", ".d.mts", ".ts", ".tsx", ".mts", ".cts"]
        .into_iter()
        .find(|&e| path.ends_with(e))
}

/// `getSuggestedImportSource`, of a specifier that names a declaration file. `is_esm`: what is written out is an ECMAScript module.
fn suggested_import_source(specifier: &str, is_esm: bool, prefers_ts: bool) -> String {
    let extension = try_extract_ts_extension(specifier).unwrap_or("");
    let stem = &specifier[..specifier.len() - extension.len()];
    if !is_esm {
        return stem.to_owned();
    }
    let suggested = match (extension, prefers_ts) {
        (".mts" | ".d.mts", true) => ".mts",
        (".mts" | ".d.mts", false) => ".mjs",
        (".cts" | ".d.cts", true) => ".cts",
        (".cts" | ".d.cts", false) => ".cjs",
        (_, true) => ".ts",
        (_, false) => ".js",
    };
    format!("{stem}{suggested}")
}

/// `GetRelativePathFromFile`
fn relative_path_from_file(from: &str, to: &str) -> String {
    let from: Vec<&str> = parent_dir(from)
        .split('/')
        .filter(|part| !part.is_empty())
        .collect();
    let to: Vec<&str> = to.split('/').filter(|part| !part.is_empty()).collect();
    let common = from.iter().zip(&to).take_while(|(a, b)| a == b).count();
    let mut parts: Vec<&str> = vec![".."; from.len() - common];
    parts.extend_from_slice(&to[common..]);
    let path = parts.join("/");
    // `EnsurePathIsNonModuleName`
    if path.starts_with("../") {
        path
    } else {
        format!("./{path}")
    }
}

/// Where the entity name `a.b.c` that starts at `start` ends.
fn entity_name_end(text: &[u8], start: usize) -> usize {
    let mut end = word_end(text, start);
    loop {
        let Some(after_dot) = eat(text, end, b'.') else {
            return end;
        };
        let next = skip_trivia(text, after_dot);
        if word_end(text, next) == next {
            return end;
        }
        end = word_end(text, next);
    }
}

/// `isCommentOrBlankLine`
fn is_comment_or_blank_line(text: &[u8], mut at: usize) -> bool {
    while at < text.len() && (text[at] == b' ' || text[at] == b'\t') {
        at += 1;
    }
    at == text.len() || text[at] == b'\r' || text[at] == b'\n' || text[at..].starts_with(b"//")
}
