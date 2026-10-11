//! Aliases, module specifier resolution, and a few file-level checks:
//! 2303; 18042 18043; 1205 1269 1288 1293 1448 1484 1485 2748 2865; 2866; 1272; 1379 1380; 2308;
//! 1544; 6137 6142 7042 2846 5097 2876 2877 2878, 1471 1479 1541 1542; 7036; 1470 17013; 1006;
//! 2578.
//!
//! Follows `checkAliasSymbol`, `checkAndReportErrorForResolvingImportAliasToTypeOnlySymbol`,
//! `getExportsOfModuleWorker`, `getExternalModuleMember`, `resolveExternalModule`,
//! `checkImportCallExpression`, `checkConstEnumAccess`, `checkNewTargetMetaProperty` and
//! `checkImportMetaProperty` of TypeScript 7.0.2's checker.go, `getSourceFileFromReference` of its
//! fileloader.go, `getBindAndCheckDiagnosticsWithChecker` and `GetIncludeProcessorDiagnostics` of
//! its program.go and `processCommentDirective` of its scanner.go.
//!
//! Comment directives: `Directives` determines which directive suppresses a diagnostic,
//! `expected_errors` creates the TS2578 for each `@ts-expect-error`, and `Program::finish_file`
//! drops those whose directive was used.

use super::errors_operators::language_version;
use super::explain::NOWHERE;
use super::sink::{NO_DIRECTIVE, held};
use super::*;
use crate::bind::{ClassOwner, Decl, Parent, PatParent, SymbolId};
use crate::program::{TypeOnlyDeclaration, source_file_may_be_emitted};
use crate::resolve::{
    ModuleKind, Options, ScriptTarget, file_extension_is, get_relative_path_from_directory,
    has_ts_implementation_extension, is_declaration_file_name, join, path_is_relative,
    try_extract_ts_extension,
};
use crate::verify::relative_from_file;
use bun_collections::ArrayHashMap;
use bun_core::strings;
use bun_paths::platform::Posix;
use bun_paths::resolve_path::dirname;

const ALL_MEANINGS: SymFlags = SymFlags::VALUE
    .union(SymFlags::TYPE)
    .union(SymFlags::NAMESPACE);

/// The properties of `location` that `resolveExternalModule` queries.
#[derive(Copy, Clone, Default)]
pub(super) struct SpecifierSite {
    /// `IsEmittableImport` of its enclosing node.
    pub(super) is_emittable: bool,
    /// `IsPartOfTypeOnlyImportOrExportDeclaration` is true for every node the module is requested
    /// from.
    pub(super) is_type_only: bool,
    /// `import type .. from`
    pub(super) is_type_only_import: bool,
    pub(super) is_ambient: bool,
    /// `isForAugmentation`
    pub(super) is_for_augmentation: bool,
    /// `moduleNotFoundError == nil`: the name of an augmentation in an ambient context.
    pub(super) is_not_validated: bool,
}

/// `directivesByLine` of a file that has comment directives.
struct DirectivesOfFile {
    line_starts: Vec<u32>,
    /// (line, start of the directive, is `@ts-expect-error`). One entry per line: the last
    /// directive on a line wins.
    by_line: Vec<(usize, u32, bool)>,
}

impl DirectivesOfFile {
    fn new(hir: &hir::File) -> Option<DirectivesOfFile> {
        if hir.comment_directives.is_empty() {
            return None;
        }
        let line_starts = compute_ecma_line_starts(&hir.text);
        let mut by_line: Vec<(usize, u32, bool)> = Vec::new();
        for &CommentDirective { start, kind, .. } in &hir.comment_directives {
            let line = line_starts.partition_point(|&line_start| line_start <= start) - 1;
            if by_line.last().is_some_and(|last| last.0 == line) {
                by_line.pop();
            }
            by_line.push((line, start, kind == CommentDirectiveKind::ExpectError));
        }
        Some(DirectivesOfFile {
            line_starts,
            by_line,
        })
    }

    /// `getDiagnosticsWithPrecedingDirectives`: the start of the directive that suppresses a
    /// diagnostic at `start`.
    fn preceding(&self, text: &[u8], start: u32) -> u32 {
        let mut line = self
            .line_starts
            .partition_point(|&line_start| line_start <= start)
            - 1;
        while line > 0 {
            line -= 1;
            if let Ok(i) = (self.by_line).binary_search_by_key(&line, |directive| directive.0) {
                return self.by_line[i].1;
            }
            if !is_comment_or_blank_line(text, self.line_starts[line] as usize) {
                break;
            }
        }
        NO_DIRECTIVE
    }
}

/// `DirectivesOfFile` for the files that a list of diagnostics is located in, each built once.
#[derive(Default)]
pub(super) struct Directives(FxHashMap<FileId, Option<DirectivesOfFile>>);

impl Directives {
    /// The start of the directive of `file`, whose HIR is `hir`, that suppresses a diagnostic at
    /// `start`. `NO_DIRECTIVE`: none does.
    pub(super) fn preceding(&mut self, file: FileId, hir: &hir::File, start: u32) -> u32 {
        let of_file = self.0.entry(file);
        match of_file.or_insert_with(|| DirectivesOfFile::new(hir)) {
            Some(directives) => directives.preceding(&hir.text, start),
            None => NO_DIRECTIVE,
        }
    }
}

impl Checker<'_, '_> {
    pub(super) fn check_x_aliases(&mut self, file: FileId) {
        let hir = self.hir(file);
        // `SkipTypeChecking`: a declaration file is checked like any other file. The default library has no text and is not checked.
        if hir.has_errors || hir.kind == FileKind::Json || hir.text.is_empty() {
            return;
        }
        self.aliases_self_references(file);
        self.aliases_imports_hiding_global_values(file);
        self.aliases_decorator_metadata(file);
        self.aliases_export_star_conflicts(file);
        self.aliases_expressions(file);
    }

    /// `getSourceFileFromReference`: 1006
    fn aliases_self_references(&mut self, file: FileId) {
        let files = self.files();
        let path = files.module(file).file_name();
        for &(kind, value, start, _) in &self.hir(file).references {
            if kind == ReferenceKind::Path
                && join(dirname::<Posix>(path), self.atoms().bytes(value)) == path
            {
                let end = start + self.atoms().bytes(value).len() as u32;
                self.error_at((file, start, end), 1006, &[]);
            }
        }
    }

    // ───────────────────────────── error ranges ─────────────────────────────

    /// The position of the module specifier `spec` of the statement at `pos`.
    fn aliases_specifier_pos(&self, file: FileId, pos: u32, spec: Atom) -> Option<u32> {
        self.hir(file)
            .specifier_uses
            .iter()
            .filter(|u| u.spec == spec && u.pos >= pos && !u.kind.is_call())
            .map(|u| u.pos)
            .min()
    }

    /// `GetTextOfNode` of the same specifier, including its quotes.
    fn aliases_specifier_text(&self, file: FileId, pos: u32, spec: Atom) -> Vec<u8> {
        let text = &self.hir(file).text[..];
        self.aliases_specifier_pos(file, pos, spec)
            .and_then(|at| Some((at, string_literal(text, at as usize)?.1)))
            .map_or_else(
                || cat!(b"\"", self.atoms().bytes(spec), b"\""),
                |(at, end)| self.source_text(file, at, end as u32),
            )
    }

    /// `GetErrorRangeForNode` of the declaration `decl` of the alias `sym`, in the file of `sym`. `None`: it declares no alias.
    pub(super) fn place_of_alias_declaration(
        &self,
        sym: Sym,
        decl: Decl,
    ) -> Option<(FileId, u32, u32)> {
        let (file, files) = (sym.file, self.files());
        files.is_alias_symbol_declaration(file, decl).then(|| {
            let (start, end) = self.get_error_range_for_node(file, self.hir(file).node(decl));
            (file, start, end)
        })
    }

    /// `GetErrorRangeForNode` of an `export *`.
    fn aliases_span_of_export_star(&self, star: (FileId, StmtId)) -> (FileId, u32, u32) {
        let start = self.hir(star.0)[star.1].start;
        (star.0, start, self.end_of_stmt(star.0, star.1))
    }

    // ───────────────────────────── what says `type` ─────────────────────────────

    /// `addTypeOnlyDeclarationRelatedInfo`: 1377 at `type_only` if `is_export`, or else 1376.
    pub(super) fn aliases_type_only_related(
        &self,
        type_only: TypeOnlyDeclaration,
        is_export: bool,
        name: Vec<u8>,
    ) -> Vec<Reported> {
        let place = match type_only {
            TypeOnlyDeclaration::ExportStar(file, star) => {
                Some(self.aliases_span_of_export_star((file, star)))
            }
            TypeOnlyDeclaration::Alias(alias, _, decl) => {
                self.place_of_alias_declaration(alias, decl)
            }
        };
        match place {
            Some(at) => vec![Reported::new(
                at,
                if is_export { 1377 } else { 1376 },
                held(vec![name]),
            )],
            None => Vec::new(),
        }
    }

    // ───────────────────────────── diagnostics reported during emit ─────────────────────────────

    /// Whether `Emit` comes before the check (`Options::emits_first`). Under `noEmitOnError` it
    /// begins with the check itself (`HandleNoEmitOnError`).
    pub(super) fn emits_first(&self) -> bool {
        let options = &self.p.files.options;
        options.emits_first && !options.no_emit_on_error
    }

    /// `emitJSFile`, `sourceFileMayBeEmitted`: whether `file` is TypeScript that is emitted as
    /// JavaScript. Whether JavaScript is emitted depends on `outDir`.
    pub(super) fn emits_js_file(&self, file: FileId) -> bool {
        let (files, hir) = (self.files(), self.hir(file));
        let (options, module) = (&files.options, files.module(file));
        !options.no_emit
            && !options.emit_declaration_only
            && matches!(hir.kind, FileKind::Ts | FileKind::Tsx)
            && !hir.is_js
            && !module.is_from_external_library
    }

    /// `markJsxAliasReferenced`, as `MarkLinkedReferencesRecursively` calls it for every tag of the
    /// file, a node before its children: `getJsxNamespaceContainerForImplicitImport` reports a
    /// module that is missing at the first one.
    pub(super) fn mark_jsx_aliases_referenced(&mut self, file: FileId) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        // `importElisionEnabled`
        if hir.jsx.is_empty()
            || !self.emits_js_file(file)
            || self.p.files.options.verbatim_module_syntax
        {
            return;
        }
        let index = self.exprs_by_kind(file);
        let tags = index.of(ExprTag::Jsx).iter().copied();
        let first = tags
            .filter(|e| !bound.is_unchecked(e.idx()))
            .min_by_key(|&e| hir[e].pos);
        self.first_jsx = (file, first, None);
    }

    /// `markPropertyAliasReferenced`, as `MarkLinkedReferencesRecursively` calls it for every `a.b`
    /// of the file: `checkExpressionCached(a)`, before `ConstEnumInliningTransformer` checks any
    /// access.
    pub(super) fn mark_property_aliases_referenced(&mut self, file: FileId) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        // `importElisionEnabled`. Under `GetIsolatedModules` it returns before it asks for a type.
        if !self.emits_js_file(file) || self.p.files.options.isolated_modules {
            return;
        }
        let index = self.exprs_by_kind(file);
        let mut lefts: Vec<ExprId> = (index.of(ExprTag::Dot).iter())
            .filter_map(|&e| match hir[e].kind {
                ExprKind::Dot { obj, .. }
                    if matches!(hir[obj].kind, ExprKind::Ident(_))
                        && !is_parenthesized(hir, obj)
                        && !bound.is_unchecked(e.idx())
                        && !bound.is_in_type_query(e)
                        && !hir.is_ambient(hir.node(e)) =>
                {
                    Some(obj)
                }
                _ => None,
            })
            .collect();
        lefts.sort_unstable_by_key(|&left| hir[left].pos);
        for left in lefts {
            let parameter = self.unassigned_parameter_read_by(file, left);
            self.type_of_expr(file, left);
            // `getTypeOfVariableOrParameterOrProperty` has pushed the resolution of the parameter,
            // and `getContextuallyTypedParameterType` resolves the call around the function, where
            // `assignParameterType` gives the parameter its type. Then it reads the signature that
            // the call has resolved to, outside the inference. `widenTypeForVariableLikeDeclaration`
            // reports a parameter that gets no type from there, and the result is not stored.
            if let Some((func, pat)) = parameter
                && self.contextual_signature(file, func).is_none()
                && !self.is_private_within_ambient(file, func)
            {
                self.report_implicit_any_of_name(file, pat, TypeId::ANY);
            }
        }
    }

    /// The function and the name of the parameter that the identifier `e` reads, if
    /// `links.resolvedType` of the parameter is nil and only `assignParameterType` assigns it
    /// (`isParameterOfContextSensitiveSignature`).
    fn unassigned_parameter_read_by(&mut self, file: FileId, e: ExprId) -> Option<(FnId, PatId)> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let symbol = bound.expr_symbol[e.idx()];
        if symbol.is_none() {
            return None;
        }
        let Some(&Decl::Param(pat)) = bound.symbols[symbol.idx()].decls.first() else {
            return None;
        };
        let PatParent::Param(p) = bound.pat_parent[pat.idx()] else {
            return None;
        };
        let func = bound.param_fn[p.idx()];
        if func.is_none() {
            return None;
        }
        let owner = self.takes_context(file, func)?;
        let is_untyped =
            hir[p].ty.is_none() && hir[p].default.is_none() && !hir[p].flags.contains(Flags::REST);
        (is_untyped
            && self.is_context_sensitive_function_or_method(file, func, owner)
            && !self.is_immediately_invoked(file, func)
            && (self.p.pat_types.get(&self.task, &(file, pat))).is_none())
        .then_some((func, pat))
    }

    /// `ConstEnumInliningTransformer`, the last transformer of `emitJSFile`: `GetConstantValue`
    /// calls `checkExpressionCached` on every property and element access that is emitted, a node
    /// before its children. tsgo's test harness writes `.types` and `.symbols` from a program that
    /// has emitted before it is checked (`compileFilesWithHost`, `Options::emits_first`), so there
    /// each access is checked first, outside its enclosing function, and a cycle is entered at a
    /// different point. JavaScript files are omitted: whether one is emitted depends on `outDir`.
    /// tsgo emits all the files and then checks them. Here it is done file by file.
    pub(super) fn inline_const_enums(&mut self, file: FileId) {
        self.cached_by_emit.clear();
        let (files, hir, bound) = (self.files(), self.hir(file), self.bound(file));
        let (options, module) = (&files.options, files.module(file));
        // `emitJSFile`, `sourceFileMayBeEmitted`, `GetIsolatedModules`
        if options.no_emit
            || options.emit_declaration_only
            || options.isolated_modules
            || options.verbatim_module_syntax
            || !matches!(hir.kind, FileKind::Ts | FileKind::Tsx)
            || hir.is_js
            || module.is_from_external_library
        {
            return;
        }
        let index = self.exprs_by_kind(file);
        // `shouldTransformPrivateElementsOrClassStaticBlocks`
        let transforms_private_elements = language_version(self) < ScriptTarget::ES2022;
        let mut accesses: Vec<ExprId> = [ExprTag::Dot, ExprTag::Index]
            .iter()
            .flat_map(|&tag| index.of(tag).iter().copied())
            .filter(|&e| !bound.is_unchecked(e.idx()) && !bound.is_in_type_query(e))
            // `visitPropertyAccessExpression` of the class fields transformer, which comes earlier,
            // has made `a.#b` a call of a helper.
            .filter(|&e| match hir[e].kind {
                ExprKind::Dot { name, .. } => {
                    !(transforms_private_elements
                        && self.is_private_name(name)
                        && (self.lookup_symbol_for_private_identifier_declaration(file, e, name))
                            .is_some())
                }
                _ => true,
            })
            .collect();
        // Of two that start at the same position, the outer was created last.
        accesses.sort_by_key(|&e| (self.start_of(file, e), std::cmp::Reverse(e)));
        for e in accesses {
            let is_computed_name = matches!(
                bound.expr_parent[e.idx()],
                Parent::PropKey(..)
                    | Parent::PatKey(_)
                    | Parent::MemberKey(_)
                    | Parent::MethodKey(_)
            );
            if is_computed_name
                && !is_parenthesized(hir, e)
                && !is_erased(hir, hir.node(e))
                && self.cached_type_of_expr(file, e).is_none()
            {
                self.cached_by_emit.push(e);
            }
            self.type_of_expr(file, e);
        }
    }

    // ───────────────────────────── module exports ─────────────────────────────

    /// `getExportsOfModuleWorker`: 2308
    fn aliases_export_star_conflicts(&mut self, file: FileId) {
        let (files, hir) = (self.files(), self.hir(file));
        if self.bound(file).export_stars.len() < 2 || !files.module(file).is_module() {
            return;
        }
        // `visit` reports here too when it comes from another module.
        let own = files.file_symbol(file);
        let others = files.modules_with_nested_export_collisions.iter();
        let others = others.copied().filter(|&module| {
            module != own && self.are_exports_of_module_resolved_no_later_than(module, file)
        });
        let modules: Vec<Sym> = std::iter::once(own).chain(others).collect();
        // Diagnostics at the same position are ordered by message.
        let mut reported: Vec<(StmtId, Vec<Vec<u8>>)> = Vec::new();
        let links = modules.iter().map(|&module| files.module_links(module));
        for collision in links.flat_map(|links| links.export_collisions.iter()) {
            if collision.duplicate.0 != file {
                continue;
            }
            // `extendExportSymbols`
            if let Some((target, source)) = collision.symbols
                && self.resolve_symbol(target) == self.resolve_symbol(source)
            {
                continue;
            }
            let (of, first) = collision.first;
            if let StmtKind::ExportStar { spec, .. } = self.hir(of)[first].kind {
                let specifier = self.aliases_specifier_text(of, self.hir(of)[first].start, spec);
                let arguments = vec![specifier, self.atom_text(collision.name)];
                reported.push((collision.duplicate.1, arguments));
            }
        }
        reported.sort();
        reported.dedup();
        for (star, arguments) in reported {
            let start = hir[star].start;
            let end = self.end_of_stmt(file, star);
            self.add_diagnostic(Reported::new((file, start, end), 2308, held(arguments)));
        }
    }

    /// Whether `getExportsOfModule(module)` has been called when the diagnostics of `file` are
    /// collected: by `checkExternalModuleExports`, or for an alias of a file that has been checked.
    fn are_exports_of_module_resolved_no_later_than(&self, module: Sym, file: FileId) -> bool {
        let files = self.files();
        let checked = files
            .order
            .iter()
            .take(files.rank_of_file(file) as usize + 1);
        self.are_module_exports_checked(module, file)
            || checked.copied().any(|other| {
                // What a leaf has is freed after its task.
                (other == file || !files.module(other).is_leaf)
                    && self.is_checked_no_later_than(other, file)
                    && self.has_alias_from_exports_of_module(other, module)
            })
    }

    /// Whether the target of an alias of `file` is looked up in `getExportsOfModule(module)`: by
    /// `getExternalModuleMember`, or by `resolveESModuleSymbol` for `import * as ns`.
    fn has_alias_from_exports_of_module(&self, file: FileId, module: Sym) -> bool {
        let (files, hir) = (self.files(), self.hir(file));
        let aliases = self.bound(file).symbols.iter();
        let aliases = aliases.filter(|symbol| symbol.flags.contains(SymFlags::ALIAS));
        aliases.flat_map(|symbol| symbol.decls.iter()).any(|&decl| {
            let specifier = match decl {
                Decl::ImportNamespace(import) => {
                    let import = &hir[import];
                    Some((import.spec, files.mode_of_import(file, import.mode)))
                }
                // `{ default as d }` is another syntax for the default import, but not in a binding
                // pattern.
                _ => (files.external_module_member_of(file, decl))
                    .filter(|it| it.2 != known::default || matches!(decl, Decl::Require(_)))
                    .map(|it| (it.0, it.1)),
            };
            specifier.is_some_and(|(spec, mode)| {
                files.module_of_specifier_as(file, spec, mode) == Some(module)
            })
        })
    }

    // ───────────────────────────── alias declarations ─────────────────────────────

    /// `node.Symbol` for the alias declarations in `file`, in the order of the symbols.
    pub(super) fn symbols_of_alias_declarations(&self, file: FileId) -> ArrayHashMap<Decl, Sym> {
        let mut symbols = ArrayHashMap::new();
        for (i, symbol) in self.bound(file).symbols.iter().enumerate() {
            if symbol.flags.contains(SymFlags::ALIAS) {
                let sym = self.files().sym(file, SymbolId(i as u32));
                for &decl in symbol.decls.iter() {
                    symbols.insert(decl, sym);
                }
            }
        }
        symbols
    }

    /// `getVerbatimModuleSyntaxErrorMessage`
    pub(super) fn verbatim_module_syntax_error_message(&self, file: FileId) -> u32 {
        let path = self.files().module(file).file_name();
        if path.ends_with(b".cts") || path.ends_with(b".cjs") {
            1286
        } else {
            1295
        }
    }

    /// `c.error(..)`, and `addTypeOnlyDeclarationRelatedInfo`. With `type_only`: whether it counts as an export.
    pub(super) fn aliases_error_about_type_only(
        &mut self,
        at: (FileId, u32, u32),
        code: u32,
        args: &[Arg<'_>],
        type_only: Option<(TypeOnlyDeclaration, bool)>,
        name: Atom,
    ) {
        let related = type_only.map_or_else(Vec::new, |(type_only, is_export)| {
            self.aliases_type_only_related(type_only, is_export, self.atom_text(name))
        });
        let related = related
            .into_iter()
            .filter(|related| related.file != NOWHERE.0);
        self.error_at(at, code, args)
            .related_information
            .extend(related);
    }

    /// `checkAliasSymbol` for the declaration `decl`. `is_ambient`: `node.Flags&NodeFlagsAmbient`.
    pub(super) fn check_alias_symbol(
        &mut self,
        file: FileId,
        aliases: &ArrayHashMap<Decl, Sym>,
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
            self.aliases_import_alias_of_type_only(file, x, names);
        }
        self.check_target_of_alias_declaration(file, sym, decl);
        // `getMergedSymbol(core.OrElse(symbol.ExportSymbol, symbol))`
        let symbol = match files.symbol(sym).export_symbol {
            SymbolId::NONE => sym,
            exported => files.sym(sym.file, exported),
        };
        // The common case for imports: the name has no other meaning here, and the remaining checks
        // only apply to JavaScript and `isolatedModules`.
        let meanings =
            SymFlags::VALUE | SymFlags::EXPORT_VALUE | SymFlags::TYPE | SymFlags::NAMESPACE;
        if !hir.is_js && !options.isolated_modules && !files.flags(symbol).intersects(meanings) {
            return;
        }
        let target = self.resolve_alias(sym);
        let Some(target_flags) = self.flags_of_alias_target(sym) else {
            return;
        };
        // The error points at the name, which is reachable without `parent`.
        let node = match decl {
            Decl::Require(name) => hir.node(name),
            _ => hir.node(decl),
        };
        let (start, end) = self.get_error_range_for_node(file, node);
        let at = (file, start, end);
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
                _ => binding_element.map_or(start, |p| hir[p].key_pos),
            };
            let at = self.place_of_token(file, name_start);
            if is_export_specifier {
                // The `@typedef` in this file that already exports it.
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
                self.error_at(at, 18043, &[])
                    .related_information
                    .extend(related);
                return;
            }
            // A name that is not an Identifier uses the name of the symbol.
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
                Decl::ImportEquals(x) => hir[x].target.spec(),
                Decl::Require(pat) => bound.required_by(hir, pat).map_or(Atom::NONE, |it| it.0),
                _ => Atom::NONE,
            };
            let specifier = match specifier {
                Atom::NONE => &b"..."[..],
                specifier => self.atoms().bytes(specifier),
            };
            let mut import_text = [b"import(\"", specifier, b"\")"].concat();
            if matches!(decl, Decl::ImportSpec(_)) {
                import_text.push(b'.');
                import_text.extend_from_slice(self.atoms().bytes(identifier));
            }
            let args = [Arg::Atom(identifier), Arg::Bytes(&import_text)];
            self.error_at(at, 18042, &args);
            return;
        }
        // `declareSymbolEx`: a declaration rejected as a conflict gets its own symbol, which has no
        // other meaning.
        let own = if files.declaration_of_alias_symbol(sym) == Some((file, decl)) {
            files.flags(symbol)
        } else {
            SymFlags::ALIAS
        };
        let is_value_here = own.intersects(SymFlags::VALUE | SymFlags::EXPORT_VALUE);
        let mut excluded = SymFlags::empty();
        for (is_intended, meaning) in [
            (is_value_here, SymFlags::VALUE),
            (own.intersects(SymFlags::TYPE), SymFlags::TYPE),
            (own.intersects(SymFlags::NAMESPACE), SymFlags::NAMESPACE),
        ] {
            if is_intended {
                excluded |= meaning;
            }
        }
        if target_flags.intersects(excluded) {
            let code = if is_export_specifier { 2484 } else { 2440 };
            self.error_at(at, code, &[Arg::Sym(symbol)]);
        } else if !is_export_specifier
            // `compilerOptions.isolatedModules` itself, not `GetIsolatedModules`: `verbatimModuleSyntax` has its own error for the import.
            && options.isolated_modules_reported
            && !is_type_only
            && is_value_here
        {
            self.error_at(at, 2865, &[Arg::Sym(symbol)]);
        }
        if !options.isolated_modules || is_type_only || is_ambient {
            return;
        }
        let is_verbatim = options.verbatim_module_syntax;
        // `getTypeOnlyAliasDeclaration(symbol)`: the export symbol of a local name is no alias.
        let type_only_alias = (files.flags(symbol).contains(SymFlags::ALIAS))
            .then(|| files.alias_links(symbol).type_only_declaration)
            .flatten();
        let related = type_only_alias
            .filter(|_| !is_type)
            .map(|type_only| (type_only, type_only.is_export()));
        // `node.PropertyNameOrName().Text()`
        let name = match decl {
            Decl::ImportSpec(s) => hir[s].imported,
            Decl::ExportSpec(s) => hir[s].local,
            _ => files.symbol(sym).name,
        };
        let flag_name = super::errors_modules::isolated_modules_like_flag_name(files);
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
                        self.aliases_error_about_type_only(
                            at,
                            code,
                            &[Arg::Atom(name)],
                            related,
                            name,
                        );
                    }
                    if is_type
                        && matches!(decl, Decl::ImportEquals(x) if hir[x].flags.contains(Flags::EXPORT))
                    {
                        self.error_at(at, 1269, &[Arg::Bytes(flag_name)]);
                    }
                }
                // A declaration marked `type` in this file is known to be elided without inspecting
                // any other file.
                Decl::ExportSpec(_)
                    if is_verbatim
                        || type_only_alias.is_none_or(|type_only| type_only.file() != file) =>
                {
                    if is_type {
                        self.error_at(at, 1205, &[Arg::Bytes(flag_name)]);
                    } else {
                        let args = [Arg::Atom(name), Arg::Bytes(flag_name)];
                        self.aliases_error_about_type_only(at, 1448, &args, related, name);
                    }
                }
                _ => {}
            }
        }
        let is_import_equals = matches!(decl, Decl::ImportEquals(_));
        let is_variable_declaration = matches!(decl, Decl::Require(pat)
            if matches!(bound.pat_parent[pat.idx()], PatParent::Var(_)));
        if !is_import_equals && self.modules_emits_commonjs(file) {
            if is_verbatim && !hir.is_js {
                let code = self.verbatim_module_syntax_error_message(file);
                self.error_at(at, code, &[]);
            } else if options.module == ModuleKind::Preserve && !is_variable_declaration {
                self.error_at(at, 1293, &[]);
            }
        }
        if is_verbatim
            && let AliasTarget::Symbol(target) = target
            && self.aliases_is_ambient_const_enum(target)
        {
            self.error_at(at, 2748, &[Arg::Bytes(flag_name)]);
        }
    }

    /// `checkAndReportErrorForResolvingImportAliasToTypeOnlySymbol`: 1379 1380
    pub(super) fn aliases_import_alias_of_type_only(
        &mut self,
        file: FileId,
        x: ImportEqualsId,
        names: Span<NameId>,
    ) {
        let files = self.files();
        let (hir, bound) = (self.hir(file), self.bound(file));
        let (reference, names) = (hir.node(names), hir.texts(names).collect::<Vec<Atom>>());
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
            // `NodeKindIs(typeOnlyDeclaration, KindExportSpecifier, KindExportDeclaration)`
            let is_export = matches!(
                type_only,
                TypeOnlyDeclaration::Alias(_, _, Decl::ExportSpec(_))
                    | TypeOnlyDeclaration::ExportStar(..)
            );
            let (start, end) = self.get_error_range_for_node(file, reference);
            let at = (file, start, end);
            let name = match type_only {
                // An `export type *` has no name.
                TypeOnlyDeclaration::ExportStar(..) => self.atoms().intern(b"*"),
                TypeOnlyDeclaration::Alias(alias, ..) => files.symbol(alias).name,
            };
            let code = if is_export { 1379 } else { 1380 };
            self.aliases_error_about_type_only(at, code, &[], Some((type_only, is_export)), name);
            return;
        }
    }

    /// What `checkAliasSymbol` and `checkConstEnumAccess` ask before 2748: whether `sym` is a
    /// `const enum` whose `ValueDeclaration` is ambient, unless it is in the output of a referenced
    /// project that preserves its `const` enums.
    pub(super) fn aliases_is_ambient_const_enum(&self, sym: Sym) -> bool {
        let files = self.files();
        if !files.flags(sym).contains(SymFlags::CONST_ENUM) {
            return false;
        }
        let Some((file, declaration)) = files.value_declaration(sym) else {
            return false;
        };
        let hir = self.hir(file);
        if hir.kind != FileKind::Declaration && !hir.is_ambient(hir.node(declaration)) {
            return false;
        }
        // `ShouldPreserveConstEnums`
        (files.options)
            .project_reference_from_output_dts(files.module(file).file_name())
            .is_none_or(|redirect| !redirect.preserve_const_enums && !redirect.isolated_modules)
    }

    /// `aliases_import_hiding_global_value` for the identifiers of `file` that are expressions.
    fn aliases_imports_hiding_global_values(&mut self, file: FileId) {
        let files = self.files();
        let (hir, bound) = (self.hir(file), self.bound(file));
        if !files.options.isolated_modules_reported {
            return;
        }
        for &(e, scope) in &bound.alias_idents {
            let ExprKind::Ident(name) = hir[e].kind else {
                continue;
            };
            // `checkExportAssignment`: a name that is not a value is not checked as an expression.
            let is_checked = match bound.expr_parent[e.idx()] {
                Parent::None => false,
                Parent::Stmt(s) if s.is_some() => {
                    is_parenthesized(hir, e)
                        || !matches!(
                            hir[s].kind,
                            StmtKind::ExportAssign(_) | StmtKind::ExportDefault(_)
                        )
                }
                _ => true,
            };
            if !is_checked || hir.is_in_with(hir[e].pos) {
                continue;
            }
            if let Some(result) = files.resolve_name(file, scope, name, SymFlags::VALUE) {
                self.aliases_import_hiding_global_value(file, result, SymFlags::VALUE);
            }
        }
    }

    /// The end of `onSuccessfullyResolvedSymbol` for `result`, which a name in `file` resolved to
    /// with `meaning`: 2866 at the import of that name, which does not resolve to a value, if
    /// `result` is the global value.
    pub(super) fn aliases_import_hiding_global_value(
        &mut self,
        file: FileId,
        result: Sym,
        meaning: SymFlags,
    ) {
        let (files, bound) = (self.files(), self.bound(file));
        let name = files.symbol(result).name;
        // `compilerOptions.isolatedModules` itself, not `GetIsolatedModules`. `isInExternalModule`,
        // `isGlobal`
        if !files.options.isolated_modules_reported
            || !files.module(file).is_module()
            || !meaning.contains(SymFlags::VALUE)
            || files.global(name, meaning) != Some(result)
        {
            return;
        }
        // `getSymbol(lastLocation.Locals(), name, ^SymbolFlagsValue)`
        let Some(id) = bound.lookup(bound.scopes[0].locals, name) else {
            return;
        };
        let import = bound.symbols[id.idx()].decls.iter().copied().find(|d| {
            matches!(
                d,
                Decl::ImportDefault(_)
                    | Decl::ImportNamespace(_)
                    | Decl::ImportSpec(_)
                    | Decl::ImportEquals(_)
            )
        });
        // `IsTypeOnlyImportDeclaration`
        if let Some(import) = import
            && !files.is_type_only_import_or_export_declaration(file, import)
            && let Some(at) = self.place_of_alias_declaration(Sym { file, id }, import)
        {
            self.error_at(at, 2866, &[Arg::Atom(name)]);
        }
    }

    /// `markDecoratorAliasReferenced`, `markEntityNameOrEntityExpressionAsReference`: 1272 at each
    /// type of a decorated signature that `emitDecoratorMetadata` emits by name, if the name is an
    /// import that does not resolve to a value and is not marked `type`.
    fn aliases_decorator_metadata(&mut self, file: FileId) {
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
        // `getAnnotatedAccessorTypeNode`
        let annotated_accessor_type_node = |(of, m): (FileId, MemberId)| {
            let hir = files.hir(of);
            let f = hir[m].func;
            let annotation = if f.is_none() {
                TypeNodeId::NONE
            } else if hir[m].kind == MemberKind::Getter {
                hir[f].ret
            } else {
                hir[f].effective_set_accessor_type_annotation_node(hir)
            };
            (of, annotation)
        };
        let mut types: Vec<(FileId, TypeNodeId)> = Vec::new();
        let mut last = None;
        for &(owner, e) in &hir.decorators {
            // The decorators of one node are consecutive.
            if last == Some(owner) {
                continue;
            }
            last = Some(owner);
            // `NodeCanBeDecorated`
            if bound.is_unchecked(e.idx()) || bound.refused_decorators.contains(&e) {
                continue;
            }
            // `markLinkedReferences`: of what is ambient, only a property contributes.
            let (location, is_property) = match owner {
                DecoratorOwner::Class(c) => (hir.node(c), false),
                DecoratorOwner::Member(m) => (hir.node(m), hir[m].kind == MemberKind::Property),
                DecoratorOwner::Param(p) => (hir.node(p), false),
            };
            if !is_property && hir.is_ambient(location) {
                continue;
            }
            // The function whose parameters are serialized, and the type that is.
            let (function, ty) = match owner {
                DecoratorOwner::Class(c) => {
                    if !matches!(bound.class_owner[c.idx()], ClassOwner::Stmt(_)) {
                        continue;
                    }
                    // `GetFirstConstructorWithBody`
                    let constructor = hir[c].members.iter().find(|&m| {
                        hir[m].kind == MemberKind::Constructor
                            && hir[m].func.is_some()
                            && !matches!(hir[hir[m].func].body, FnBody::None)
                    });
                    let constructor = constructor.map_or(FnId::NONE, |m| hir[m].func);
                    (constructor, (file, TypeNodeId::NONE))
                }
                DecoratorOwner::Member(m) => match hir[m].kind {
                    MemberKind::Property => (FnId::NONE, (file, hir[m].ty)),
                    MemberKind::Method => (hir[m].func, (file, hir[hir[m].func].ret)),
                    kind @ (MemberKind::Getter | MemberKind::Setter) => {
                        let other_kind = match kind {
                            MemberKind::Setter => MemberKind::Getter,
                            _ => MemberKind::Setter,
                        };
                        // `GetDeclarationOfKind(getSymbolOfDeclaration(node), otherKind)`
                        let declarations = self.declarations_of_member(file, Decl::Member(m));
                        let other_accessor = declarations.iter().find_map(|&(of, d)| match d {
                            Decl::Member(o) if files.hir(of)[o].kind == other_kind => Some((of, o)),
                            _ => None,
                        });
                        let annotation = annotated_accessor_type_node((file, m));
                        let annotation = match other_accessor {
                            Some(other) if annotation.1.is_none() => {
                                annotated_accessor_type_node(other)
                            }
                            _ => annotation,
                        };
                        (FnId::NONE, annotation)
                    }
                    _ => continue,
                },
                DecoratorOwner::Param(p) => {
                    let f = bound.param_fn[p.idx()];
                    let ret = hir.fns.get(f.idx()).map_or(TypeNodeId::NONE, |f| f.ret);
                    (f, (file, ret))
                }
            };
            if function.is_some() {
                let this = hir[function].this_param.some();
                for p in this.into_iter().chain(hir[function].params.iter()) {
                    types.push((
                        file,
                        self.get_parameter_type_node_for_decorator_check(file, p),
                    ));
                }
            }
            types.push(ty);
        }
        for (file, ty) in types {
            let (hir, bound) = (self.hir(file), self.bound(file));
            let Some(reference) = self.aliases_entity_name_for_decorator_metadata(file, ty) else {
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
            if self.symbol_is_value(root)
                || files
                    .symbol(root)
                    .decls
                    .iter()
                    .any(|&d| files.is_type_only_import_or_export_declaration(root.file, d))
            {
                continue;
            }
            // The first alias declaration of the symbol.
            let declarations = self.files().symbol(root).decls.iter();
            let related = { declarations }
                .find_map(|&d| self.place_of_alias_declaration(root, d))
                .map(|at| self.new_diagnostic(at, 1376, &[Arg::Atom(hir[name.at(0)].text)]));
            self.error(file, name, 1272, &[])
                .related_information
                .extend(related);
        }
    }

    /// `getParameterTypeNodeForDecoratorCheck`
    fn get_parameter_type_node_for_decorator_check(&self, file: FileId, p: ParamId) -> TypeNodeId {
        let hir = self.hir(file);
        let ty = hir[p].ty;
        if ty.is_none() || !hir[p].flags.contains(Flags::REST) {
            return ty;
        }
        // `GetRestParameterElementType`: a `ParenthesizedType` has no element type.
        let mut parentheses = self.parenthesized_types_around(file, ty, hir[p].pos);
        match hir[ty].kind {
            _ if parentheses.next().is_some() => TypeNodeId::NONE,
            TypeNodeKind::Array(element) => element,
            TypeNodeKind::Ref { args, .. } if !args.is_empty() => hir.id_at(args, 0),
            _ => TypeNodeId::NONE,
        }
    }

    /// `getEntityNameForDecoratorMetadata`: the type reference whose name represents `ty` in the
    /// metadata.
    fn aliases_entity_name_for_decorator_metadata(
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
            let mut parentheses = self.parenthesized_types_around(file, part, hir[ty].pos);
            match hir[part].kind {
                // A `ParenthesizedType` is no keyword.
                _ if parentheses.next().is_some() => {}
                TypeNodeKind::Keyword(Keyword::Never) => continue,
                TypeNodeKind::Keyword(Keyword::Null | Keyword::Undefined)
                    if !self.files().options.strict_null_checks =>
                {
                    continue;
                }
                _ => {}
            }
            let individual = self.aliases_entity_name_for_decorator_metadata(file, part)?;
            let Some(first) = common else {
                common = Some(individual);
                continue;
            };
            // Both are the same identifier, or else `Object` is emitted.
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

    /// `resolveExternalModule` with an `errorNode`, for the specifier `written` in `file`. Returns
    /// whether the module is found.
    pub(super) fn resolve_external_module(
        &mut self,
        file: FileId,
        written: SpecifierUse,
        site: SpecifierSite,
    ) -> bool {
        let at = self.place_of_token(file, written.pos);
        self.resolve_external_module_at(file, written, site, at, None)
    }

    /// `resolveExternalModule` with the `errorNode` at `at`. `module_not_found_error`:
    /// `moduleNotFoundError`. `None`: what the callers pass for a specifier such as `written`.
    pub(super) fn resolve_external_module_at(
        &mut self,
        file: FileId,
        written: SpecifierUse,
        site: SpecifierSite,
        at: (FileId, u32, u32),
        module_not_found_error: Option<u32>,
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
        // `checkImportDeclaration` does not resolve the module.
        if is_side_effect && !options.no_unchecked_side_effect_imports {
            return true;
        }
        let mode = crate::program::mode_for_usage_location(
            files.compiler_options_for_file(file),
            importing.default_mode,
            &written,
        );
        let key = (spec, mode);
        let text = self.atoms().bytes(spec);
        if let Some(without_prefix) = text.strip_prefix(b"@types/") {
            self.error_at(at, 6137, &[Arg::Bytes(without_prefix), Arg::Atom(spec)]);
        }
        // What is not a file is from `tryFindAmbientModule`, or there is no file and it is one of
        // `patternAmbientModules`.
        let found = files.module_of_specifier_as(file, spec, mode);
        if found.is_some_and(|m| !self.modules_is_a_file(m)) {
            return true;
        }
        let target = importing.imports.get(&key);
        // `ResolvedFileName`, in a table that has it for some specifiers.
        let resolved_file_name_in = |table: &[(Atom, ResolutionMode, Atom)]| {
            let mut table = table.iter();
            table.find(|r| (r.0, r.1) == key).map(|r| r.2)
        };
        // `GetResolutionDiagnostic`, `needJsx`
        let needs_jsx = resolved_file_name_in(&importing.jsx_imports);
        if let Some(&source_file) = target {
            let target = files.module(source_file);
            // "we need to report it even if a sourceFile is found"
            if let Some(path) = needs_jsx {
                let path = self.atoms().bytes(path);
                self.error_at(at, 6142, &[Arg::Atom(spec), Arg::Path(path)]);
            }
            let resolved_file_name = match resolved_file_name_in(&importing.redirected_imports) {
                Some(path) => self.atoms().bytes(path),
                None => target.file_name(),
            };
            // `ResolvedUsingTsExtension`
            let using_ts_extension = importing.ts_extension_imports.contains(&key);
            let is_declaration_name = (using_ts_extension
                || options.rewrite_relative_import_extensions)
                && is_declaration_file_name(text);
            if using_ts_extension && is_declaration_name {
                if site.is_emittable {
                    let is_esm = (ModuleKind::Es2015..=ModuleKind::EsNext)
                        .contains(&options.module)
                        || mode == ResolutionMode::Import;
                    let prefers_ts = options.allow_importing_ts_extensions;
                    let suggested = suggested_import_source(text, is_esm, prefers_ts);
                    self.error_at(at, 2846, &[Arg::Bytes(&suggested)]);
                }
            // `AllowImportingTsExtensionsFrom`
            } else if using_ts_extension
                && !options.allow_importing_ts_extensions
                && !is_declaration_file_name(importing.file_name())
            {
                if site.is_emittable {
                    // An extension that a pattern of `imports` or `paths` matched may be anywhere in the specifier.
                    let extension = try_extract_ts_extension(text).or_else(|| {
                        [
                            &b".ts"[..],
                            b".tsx",
                            b".d.ts",
                            b".cts",
                            b".d.cts",
                            b".mts",
                            b".d.mts",
                        ]
                        .into_iter()
                        .find(|&e| strings::contains(text, e))
                    });
                    self.error_at(at, 5097, &[Arg::Bytes(extension.unwrap_or(b""))]);
                }
            } else if options.rewrite_relative_import_extensions
                && !site.is_ambient
                && !is_declaration_name
                && kind != SpecifierKind::ImportType
                && !site.is_type_only
            {
                // `ShouldRewriteModuleSpecifier`
                let should_rewrite =
                    path_is_relative(text) && has_ts_implementation_extension(text);
                if !using_ts_extension && should_rewrite {
                    let path = relative_from_file(
                        importing.file_name(),
                        resolved_file_name,
                        files.is_case_sensitive,
                    );
                    self.error_at(at, 2876, &[Arg::Bytes(&path)]);
                } else if using_ts_extension
                    && !should_rewrite
                    && source_file_may_be_emitted(options, target, files.is_case_sensitive)
                {
                    // `GetAnyExtensionFromPath`
                    let base =
                        &text[strings::last_index_of_char(text, b'/').map_or(0, |i| i + 1)..];
                    let extension =
                        strings::last_index_of_char(base, b'.').map_or(&b""[..], |i| &base[i..]);
                    self.error_at(at, 2877, &[Arg::Bytes(extension)]);
                } else if using_ts_extension
                    && should_rewrite
                    && let Some(redirect) = target.redirect_for_resolution
                {
                    let own_root_dir = common_source_directory(options);
                    let other_root_dir = common_source_directory(redirect);
                    let own_out_dir = match &options.out_dir[..] {
                        b"" => own_root_dir,
                        out_dir => out_dir,
                    };
                    let other_out_dir = match &redirect.out_dir[..] {
                        b"" => other_root_dir,
                        out_dir => out_dir,
                    };
                    let relative = |from: &[u8], to: &[u8]| {
                        get_relative_path_from_directory(from, to, files.is_case_sensitive)
                    };
                    let root_dir_path = relative(own_root_dir, other_root_dir);
                    let out_dir_path = relative(own_out_dir, other_out_dir);
                    if root_dir_path != out_dir_path {
                        self.error_at(at, 2878, &[]);
                    }
                }
            }
            if !target.is_module() {
                if !is_side_effect && !site.is_not_validated {
                    self.error_at(at, 2306, &[Arg::Path(resolved_file_name)]);
                }
                return false;
            }
            // `require` cannot load an ECMAScript module.
            let importing_mode = files.default_resolution_mode_for_file(file);
            let is_sync_import = importing_mode == ResolutionMode::Require
                && kind != SpecifierKind::ImportCall
                || kind == SpecifierKind::Require;
            if matches!(options.module, ModuleKind::Node16 | ModuleKind::Node18)
                && is_sync_import
                && files.default_resolution_mode_for_file(source_file) == ResolutionMode::Import
                // `HasResolutionModeOverride`
                && !(matches!(
                    kind,
                    SpecifierKind::SideEffect | SpecifierKind::Import | SpecifierKind::ImportType
                ) && self.has_resolution_mode_override(file, written))
            {
                let (code, details) = match kind {
                    SpecifierKind::Require => (1471, None),
                    // The `JSImportDeclaration` of an `@import` tag is no `ImportDeclaration`.
                    SpecifierKind::Import
                        if site.is_type_only_import && !self.hir(file).is_in_jsdoc(start) =>
                    {
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
        // The specifier resolves to JavaScript that is not in the program.
        if needs_jsx.is_none()
            && let Some(index) = importing.untyped_imports.iter().position(|&u| u == key)
        {
            if site.is_for_augmentation {
                let path = self.atoms().bytes(importing.untyped_import_files[index].0);
                self.error_at(at, 2665, &[Arg::Atom(spec), Arg::Path(path)]);
            } else if options.no_implicit_any && !site.is_not_validated && !is_side_effect {
                self.error_on_implicit_any_module(file, spec, mode, at);
            }
            return false;
        }
        if site.is_not_validated {
            return false;
        }
        // "See if this was possibly a projectReference redirect"
        let mut unbuilt = importing.unbuilt_imports.iter();
        if let Some(&(.., output, source)) = unbuilt.find(|u| (u.0, u.1) == key) {
            let (output, source) = (self.atoms().bytes(output), self.atoms().bytes(source));
            self.error_at(at, 6305, &[Arg::Path(output), Arg::Path(source)]);
            return false;
        }
        // `GetResolutionDiagnostic`
        let mut arbitrary = importing.arbitrary_extension_imports.iter();
        let resolution_diagnostic = (needs_jsx.map(|path| (6142, path)))
            .or_else(|| resolved_file_name_in(&importing.json_imports).map(|path| (7042, path)))
            .or_else(|| {
                let index = arbitrary.position(|&u| u == key)?;
                Some((6263, importing.arbitrary_extension_files[index]))
            });
        if let Some((code, path)) = resolution_diagnostic {
            let path = self.atoms().bytes(path);
            self.error_at(at, code, &[Arg::Atom(spec), Arg::Path(path)]);
            return false;
        }
        let mut extensionless = importing.extensionless_imports.iter();
        if !options.resolve_json_module && file_extension_is(text, b".json") {
            self.error_at(at, 2732, &[Arg::Atom(spec)]);
        } else if options.resolves_like_node
            && mode == ResolutionMode::Import
            && let Some(&(_, extension)) = extensionless.find(|e| e.0 == spec)
        {
            // Only for a module that is not found is it reported that Node's `import` requires an
            // explicit extension.
            match extension {
                Some(extension) => {
                    let suggested = [self.atoms().bytes(spec), extension].concat();
                    self.error_at(at, 2835, &[Arg::Bytes(&suggested)])
                }
                None => self.error_at(at, 2834, &[]),
            };
        } else if let Some(code) = module_not_found_error {
            self.error_at(at, code, &[Arg::Atom(spec)]);
        } else if site.is_for_augmentation {
            self.error_at(at, 2664, &[Arg::Atom(spec)]);
        } else if is_side_effect {
            self.error_at(at, 2882, &[Arg::Atom(spec)]);
        // `getCannotResolveModuleNameErrorForSpecificModule`: only for a string literal, not for a template.
        } else if crate::resolve::is_node_core_module(text)
            && self.hir(file).text.get(start as usize) != Some(&b'`')
        {
            let types = options.types.as_ref();
            let uses_wildcard_types = types.is_some_and(|t| t.iter().any(|t| t == b"*"));
            let code = if uses_wildcard_types { 2580 } else { 2591 };
            self.error_at(at, code, &[Arg::Atom(spec)]);
        } else {
            self.error_at(at, 2307, &[Arg::Atom(spec)]);
        }
        false
    }

    /// `createModeMismatchDetails`, for an extension `resolveExternalModule` calls it with.
    fn create_mode_mismatch_details(
        &mut self,
        file: FileId,
        at: (FileId, u32, u32),
    ) -> Option<Reported> {
        let importing = self.files().module(file);
        let path = importing.file_name();
        let target_extension = if path.ends_with(b".d.ts") {
            return None;
        } else if path.ends_with(b".ts") {
            Some(".mts")
        } else if path.ends_with(b".js") {
            Some(".mjs")
        } else if path.ends_with(b".tsx") || path.ends_with(b".jsx") {
            None
        } else {
            return None;
        };
        // The `package.json` that applies to the file, if it has no `type` field.
        let package_json = Some(importing.package_json_without_type).filter(|it| it.is_some());
        let code = match (target_extension, package_json) {
            (Some(_), Some(_)) => 1481,
            (None, Some(_)) => 1482,
            (Some(_), None) => 1480,
            (None, None) => 1483,
        };
        let args = target_extension.map(Arg::Text).into_iter();
        let package_json = package_json.map(|path| Arg::Path(self.atoms().bytes(path)));
        let args: Vec<Arg<'_>> = args.chain(package_json).collect();
        Some(self.new_diagnostic(at, code, &args))
    }

    // ───────────────────────────── expressions ─────────────────────────────

    fn aliases_expressions(&mut self, file: FileId) {
        let index = self.exprs_by_kind(file);
        for tag in [
            ExprTag::ImportCall,
            ExprTag::ImportMeta,
            ExprTag::Missing,
            ExprTag::NewTarget,
        ] {
            for &e in index.of(tag) {
                if !self.is_never_checked(self.hir(file)[e].pos) {
                    self.aliases_import_call_or_meta_property(file, e);
                }
            }
        }
    }

    pub(super) fn aliases_import_call_or_meta_property(&mut self, file: FileId, e: ExprId) {
        let files = self.files();
        let (hir, bound) = (self.hir(file), self.bound(file));
        if bound.is_unchecked(e.idx()) {
            return;
        }
        match hir[e].kind {
            // `checkImportCallExpression`
            ExprKind::ImportCall { args, .. } => {
                let specifier = hir.id_at(args, 0);
                // `len(args) == 0`
                if matches!(hir[specifier].kind, ExprKind::Missing) {
                    return;
                }
                let operand_type = self.type_of_expr(file, specifier);
                let ty = match hir[specifier].kind {
                    ExprKind::Spread(_) => {
                        self.type_of_spread_expression(file, specifier, operand_type)
                    }
                    _ => operand_type,
                };
                if ty.is_undefined() || ty.is_null() || !self.is_assignable(ty, TypeId::STRING) {
                    let start = self.start_of(file, specifier);
                    let end = self.end_of_expr(file, specifier);
                    self.error_at((file, start, end), 7036, &[Arg::Type(ty)]);
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
                let end = match kind {
                    ExprKind::ImportMeta => Some(hir[e].end),
                    _ => other_import_meta_property_end(&hir.text, start),
                };
                if let Some(end) = end {
                    self.error_at((file, start, end), code, &[]);
                }
            }
            // `checkNewTargetMetaProperty`
            ExprKind::NewTarget(_) => {
                let node = self.hir(file).node(e);
                if self.hir(file).get_new_target_container(node).is_none() {
                    self.error(file, e, 17013, &[Arg::Bytes(b"new.target")]);
                }
            }
            _ => {}
        }
    }

    // ───────────────────────────── comment directives ─────────────────────────────

    /// TS2578 for each `@ts-expect-error` of `file`, fully built. `finish_file` reports those whose
    /// directive suppressed nothing, which is known only after the last barrier. Built at the end
    /// of `check_file`: the report step runs no query and reads no HIR.
    pub(super) fn expected_errors(&mut self, file: FileId) -> Vec<Reported> {
        let hir = self.hir(file);
        // `SkipTypeChecking`. An error that may exist but was not detected is not reported as
        // missing.
        if hir.check_directive == Some(false)
            || self.is_plain_js(file)
            || hir.has_errors
            || hir.syntax_errors > 0
        {
            return Vec::new();
        }
        let Some(DirectivesOfFile { by_line, .. }) = DirectivesOfFile::new(hir) else {
            return Vec::new();
        };
        let mut expected = Vec::new();
        for &(_, start, _) in by_line.iter().filter(|directive| directive.2) {
            let directive = hir.comment_directives.iter().find(|it| it.start == start);
            let at = (file, start, directive.map_or(0, |it| it.end));
            let mut unused = Reported::new(at, 2578, Default::default());
            self.settle_place(&mut unused);
            expected.push(unused);
        }
        expected
    }
}

/// Whether `TypeEraserTransformer` drops something around `node`: what is ambient, a type, an
/// overload, an abstract member. An accessor without a body that is not abstract gets a body.
fn is_erased(hir: &hir::File, node: Node) -> bool {
    let is_dropped = |around: Node| {
        let is_abstract = hir.flags(around).contains(Flags::ABSTRACT);
        match hir.fns.get(hir.function_of(around).idx()) {
            Some(function) => {
                matches!(function.body, FnBody::None)
                    && (is_abstract || !matches!(function.kind, FnKind::Getter | FnKind::Setter))
            }
            None => is_abstract && matches!(hir.data(around), NodeData::Member(_)),
        }
    };
    hir.is_in_ambient_or_type_node(node) || hir.find_ancestor(node, is_dropped).is_some()
}

/// `GetCommonSourceDirectory` without the `/` at its end, for a project that has a configuration
/// file: every project that references another one, or is referenced.
fn common_source_directory(options: &Options) -> &[u8] {
    match &options.root_dir[..] {
        b"" => dirname::<Posix>(&options.config_path),
        root_dir => root_dir,
    }
}

// ───────────────────────────── scanning the source text ─────────────────────────────

/// The end of `word`, if the text at `at` is `word`.
fn eat_word(text: &[u8], at: usize, word: &[u8]) -> Option<usize> {
    is_word_at(text, at, word).then_some(at + word.len())
}

/// The position after `c`, if it is the next token at or after `at`.
fn eat(text: &[u8], at: usize, c: u8) -> Option<usize> {
    let at = skip_trivia(text, at);
    (text.get(at) == Some(&c)).then_some(at + 1)
}

/// The end offset of the invalid meta-property `import.<name>` at `pos`, where `<name>` is neither `meta` nor `defer`. The parser lowers it
/// to `ExprKind::Missing`, whose `end` does not cover the name.
fn other_import_meta_property_end(text: &[u8], pos: u32) -> Option<u32> {
    let dot_end = eat_word(text, pos as usize, b"import").and_then(|end| eat(text, end, b'.'))?;
    let name = skip_trivia(text, dot_end);
    eat_word(text, name, b"defer")
        .is_none()
        .then(|| word_end(text, name) as u32)
}

/// The string literal at `at`: the raw text between the quotes, and its end.
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

/// `getSuggestedImportSource` for a specifier that names a declaration file. `is_esm`: the emitted
/// file is an ECMAScript module.
fn suggested_import_source(specifier: &[u8], is_esm: bool, prefers_ts: bool) -> Vec<u8> {
    let extension = try_extract_ts_extension(specifier).unwrap_or(b"");
    let stem = &specifier[..specifier.len() - extension.len()];
    if !is_esm {
        return stem.to_vec();
    }
    let suggested: &[u8] = match (extension, prefers_ts) {
        (b".mts" | b".d.mts", true) => b".mts",
        (b".mts" | b".d.mts", false) => b".mjs",
        (b".cts" | b".d.cts", true) => b".cts",
        (b".cts" | b".d.cts", false) => b".cjs",
        (_, true) => b".ts",
        (_, false) => b".js",
    };
    cat!(stem, suggested)
}

/// `isCommentOrBlankLine`
fn is_comment_or_blank_line(text: &[u8], mut at: usize) -> bool {
    while at < text.len() && (text[at] == b' ' || text[at] == b'\t') {
        at += 1;
    }
    at == text.len() || text[at] == b'\r' || text[at] == b'\n' || text[at..].starts_with(b"//")
}
