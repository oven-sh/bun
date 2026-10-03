//! Aliases, module specifier resolution, and a few file-level checks:
//! 2303; 18042 18043; 1205 1269 1288 1293 1448 1484 1485 2748 2865; 2866; 1272; 1379 1380; 2308;
//! 1544; 6137 6142 2846 5097 2876 2877, 1471 1479 1541 1542; 7036; 1470 17013; 1006; 2578.
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

use super::explain::NOWHERE;
use super::sink::{NO_DIRECTIVE, held};
use super::*;
use crate::bind::{ClassOwner, Decl, MemberOwner, Parent, PatParent, SymbolId};
use crate::program::TypeOnlyDeclaration;
use crate::resolve::{ModuleKind, is_declaration_file_name, join, path_is_relative};
use crate::verify::relative_from_file;
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

impl Checker<'_> {
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
        let path = &files.module(file).path[..];
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

    /// `MarkLinkedReferencesRecursively`, which `ImportElisionTransformer` runs before a file is
    /// emitted: whether it reports anything the check does not. `markIdentifierAliasReferenced`
    /// calls `getResolvedSymbol` on every identifier that is emitted as an expression. The check
    /// has already resolved nearly all of them, except the `q` of `export import r = q`, which it
    /// resolves as a namespace: where `q` is not a value, that is 2708, 2693 or 2304. tsgo's test
    /// harness counts them (TS-1). Nothing else shows them.
    #[cfg(feature = "baselines")]
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

    /// `ConstEnumInliningTransformer`, the last transformer of `emitJSFile`: `GetConstantValue`
    /// calls `checkExpressionCached` on every property and element access that is emitted, a node
    /// before its children. tsgo's test harness writes `.types` and `.symbols` from a program that
    /// has emitted before it is checked (`compileFilesWithHost`, `Options::emits_first`), so there
    /// each access is checked first, outside its enclosing function, and a cycle is entered at a
    /// different point. JavaScript files are omitted: whether one is emitted depends on `outDir`.
    /// tsgo emits all the files and then checks them. Here it is done file by file.
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
        // Of two that start at the same position, the outer was created last.
        accesses.sort_by_key(|&e| (self.start_of(file, e), std::cmp::Reverse(e)));
        for e in accesses {
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
        // Diagnostics at the same position are ordered by message.
        let mut reported: Vec<(StmtId, Vec<Vec<u8>>)> = Vec::new();
        let links = files.module_links(files.file_symbol(file));
        for collision in links.export_collisions.iter() {
            let (of, first) = collision.first;
            if collision.duplicate.0 == file
                && let StmtKind::ExportStar { spec, .. } = self.hir(of)[first].kind
            {
                let specifier = self.aliases_specifier_text(of, self.hir(of)[first].start, spec);
                let arguments = vec![specifier, self.atom_text(collision.name)];
                reported.push((collision.duplicate.1, arguments));
            }
        }
        reported.sort();
        for (star, arguments) in reported {
            let start = hir[star].start;
            let end = self.end_of_stmt(file, star);
            self.add_diagnostic(Reported::new((file, start, end), 2308, held(arguments)));
        }
    }

    // ───────────────────────────── alias declarations ─────────────────────────────

    /// `node.Symbol` for the alias declarations in `file`.
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
        aliases: &FxHashMap<Decl, Sym>,
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
                Decl::ImportEquals(x) => match hir[x].target {
                    ImportEqualsTarget::Require(spec) => spec,
                    ImportEqualsTarget::Entity(_) => Atom::NONE,
                },
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
        let is_variable_declaration = matches!(decl, Decl::Require(_)) && binding_element.is_none();
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
    fn aliases_import_alias_of_type_only(
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

    /// A `const enum` whose first declaration is ambient.
    pub(super) fn aliases_is_ambient_const_enum(&self, sym: Sym) -> bool {
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

    /// The end of `onSuccessfullyResolvedSymbol`: 2866 at an import that does not resolve to a
    /// value, where its name is used for a global value.
    fn aliases_imports_hiding_global_values(&mut self, file: FileId) {
        let files = self.files();
        let (hir, bound) = (self.hir(file), self.bound(file));
        // `compilerOptions.isolatedModules` itself, not `GetIsolatedModules`. `IsExternalOrCommonJSModule`
        if !files.options.isolated_modules_reported || !files.module(file).is_module() {
            return;
        }
        for &(e, scope) in &bound.alias_idents {
            let ExprKind::Ident(name) = hir[e].kind else {
                continue;
            };
            // `checkExportAssignment`: a name that is not a value is not checked as an expression.
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
            let Some(id) = bound.lookup(bound.scopes[0].locals, name) else {
                continue;
            };
            let found = files.resolve_name(file, scope, name, SymFlags::VALUE);
            if found.is_none() || found != files.global(name, SymFlags::VALUE) {
                continue;
            }
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
            types.extend(hir[f].params.iter().map(&type_of_parameter));
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
            // The decorators of one node are consecutive.
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
                            ty = other.map_or(TypeNodeId::NONE, &type_of_accessor);
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
            match hir[part].kind {
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
        let mode =
            crate::program::mode_for_usage_location(options, importing.default_mode, &written);
        let (key, at) = ((spec, mode), self.place_of_token(file, start));
        let text = self.atoms().bytes(spec);
        if let Some(without_prefix) = text.strip_prefix(b"@types/") {
            self.error_at(at, 6137, &[Arg::Bytes(without_prefix), Arg::Atom(spec)]);
        }
        // `tryFindAmbientModule` and `patternAmbientModules` contain the modules that scripts
        // declare. A `declare module` that augments nothing is not among them, and does not shadow
        // a file.
        let found = files.module_of_specifier_as(file, spec, mode);
        if found
            .is_some_and(|m| !self.modules_is_a_file(m) && self.modules_is_declared_by_a_script(m))
        {
            return true;
        }
        let target = importing.imports.get(&key);
        // `GetResolutionDiagnostic`, `needJsx`: reported whether or not the file is in the program for another reason.
        let mut needs_jsx = importing.jsx_imports.iter();
        if let Some(&(.., path)) = needs_jsx.find(|r| (r.0, r.1) == key) {
            self.error_at(at, 6142, &[Arg::Atom(spec), Arg::Atom(path)]);
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
                && !is_declaration_file_name(&importing.path)
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
                // `ShouldRewriteModuleSpecifier`, `SourceFileMayBeEmitted`. 2878 needs project references, which are not supported.
                let should_rewrite = path_is_relative(text) && strip_ts_extension(text).is_some();
                let may_be_emitted = target.hir.kind != FileKind::Declaration
                    && !strings::contains(&target.path, b"/node_modules/");
                if !using_ts_extension && should_rewrite {
                    let path = relative_from_file(&importing.path, &target.path);
                    self.error_at(at, 2876, &[Arg::Bytes(&path)]);
                } else if using_ts_extension && !should_rewrite && may_be_emitted {
                    // `GetAnyExtensionFromPath`
                    let base =
                        &text[strings::last_index_of_char(text, b'/').map_or(0, |i| i + 1)..];
                    let extension =
                        strings::last_index_of_char(base, b'.').map_or(&b""[..], |i| &base[i..]);
                    self.error_at(at, 2877, &[Arg::Bytes(extension)]);
                }
            }
            if !target.is_module() {
                if !is_side_effect && !site.is_not_validated {
                    let mut redirected = importing.redirected_imports.iter();
                    let path = match redirected.find(|r| (r.0, r.1) == key) {
                        Some(r) => Arg::Atom(r.2),
                        None => Arg::Bytes(&target.path),
                    };
                    self.error_at(at, 2306, &[path]);
                }
                return false;
            }
            // `require` cannot load an ECMAScript module. Only what has code in it is of either kind.
            let is_sync_import = !importing.is_esm && kind != SpecifierKind::ImportCall
                || kind == SpecifierKind::Require;
            if matches!(options.module, ModuleKind::Node16 | ModuleKind::Node18)
                && is_sync_import
                && target.is_esm
                && !target.path.ends_with(b".json")
                // `HasResolutionModeOverride`
                && !(matches!(
                    kind,
                    SpecifierKind::SideEffect | SpecifierKind::Import | SpecifierKind::ImportType
                ) && self.has_resolution_mode_override(file, written))
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
            self.error_at(at, 6263, &[Arg::Atom(spec), Arg::Atom(path)]);
            return false;
        }
        // The specifier resolves to JavaScript that is not in the program.
        if let Some(index) = importing.untyped_imports.iter().position(|&u| u == key) {
            if site.is_for_augmentation {
                let path = importing.untyped_import_files[index].0;
                self.error_at(at, 2665, &[Arg::Atom(spec), Arg::Atom(path)]);
            } else if options.no_implicit_any && !is_side_effect {
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
            self.error_at(at, 6305, &[Arg::Atom(output), Arg::Atom(source)]);
            return false;
        }
        let mut extensionless = importing.extensionless_imports.iter();
        if !options.resolve_json_module && text.ends_with(b".json") {
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
        let path = &importing.path;
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
        let args: Vec<Arg<'_>> = args.chain(package_json.map(Arg::Atom)).collect();
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
                self.aliases_import_call_or_meta_property(file, e);
            }
        }
    }

    fn aliases_import_call_or_meta_property(&mut self, file: FileId, e: ExprId) {
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
                if ty.is_undefined() || ty.is_null() || !self.is_assignable(ty, TypeId::STRING) {
                    let start = self.start_of(file, argument);
                    let end = self.end_of_expr(file, argument);
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
        let Some(DirectivesOfFile {
            line_starts,
            by_line,
        }) = DirectivesOfFile::new(hir)
        else {
            return Vec::new();
        };
        if !by_line.iter().any(|directive| directive.2) {
            return Vec::new();
        }
        let text = &hir.text[..];
        let mut statement_starts: Vec<u32> = hir.stmts.iter().map(|s| s.start).collect();
        statement_starts.sort_unstable();
        let exprs = indices_by_position(hir.exprs.iter().map(|e| e.pos));
        let types = indices_by_position(hir.types.iter().map(|node| node.pos));
        let mut expected = Vec::new();
        for &(line, start, _) in by_line.iter().filter(|directive| directive.2) {
            // The range it applies to: the next line that is neither empty nor a comment, plus
            // whatever starts there, up to the next statement.
            let mut next = line + 1;
            while next < line_starts.len()
                && is_comment_or_blank_line(text, line_starts[next] as usize)
            {
                next += 1;
            }
            let end = text.len() as u32;
            let from = line_starts.get(next).copied().unwrap_or(end);
            let line_end = line_starts.get(next + 1).copied().unwrap_or(end);
            let next_statement = statement_starts.partition_point(|&pos| pos < line_end);
            let to = statement_starts.get(next_statement).copied().unwrap_or(end);
            if self.aliases_is_all_known(file, (&exprs[..], &types[..]), from, to) {
                let directive = hir.comment_directives.iter().find(|it| it.start == start);
                let at = (file, start, directive.map_or(0, |it| it.end));
                let mut unused = Reported::new(at, 2578, Default::default());
                self.settle_place(&mut unused);
                expected.push(unused);
            }
        }
        expected
    }

    /// Whether the type of every node from `from` up to `to` has been resolved. An error that
    /// depends on an unresolved type is withheld. `exprs`, `types`: `indices_by_position` of the
    /// expressions and the type nodes of `file`.
    fn aliases_is_all_known(
        &mut self,
        file: FileId,
        (exprs, types): (&[(u32, u32)], &[(u32, u32)]),
        from: u32,
        to: u32,
    ) -> bool {
        let bound = self.bound(file);
        for i in indices_in_range(exprs, from, to) {
            if bound.is_unchecked(i as usize) {
                continue;
            }
            let ty = self.type_at(file, ExprId(i));
            if self.is_non_inferrable_type(ty) {
                return false;
            }
        }
        for i in indices_in_range(types, from, to) {
            if bound.is_unchecked_type(i as usize) {
                continue;
            }
            let ty = self.type_from_node(file, TypeNodeId(i));
            if self.is_non_inferrable_type(ty) {
                return false;
            }
        }
        true
    }
}

/// `(position, index)` for each of `positions`, sorted.
fn indices_by_position(positions: impl Iterator<Item = u32>) -> Vec<(u32, u32)> {
    let mut sorted: Vec<(u32, u32)> = positions.zip(0..).collect();
    sorted.sort_unstable();
    sorted
}

/// The indices in `sorted` (`indices_by_position`) whose position is in `from..to`, ascending.
fn indices_in_range(sorted: &[(u32, u32)], from: u32, to: u32) -> Vec<u32> {
    let first = sorted.partition_point(|&(pos, _)| pos < from);
    let end = sorted.partition_point(|&(pos, _)| pos < to).max(first);
    let mut indices: Vec<u32> = sorted[first..end].iter().map(|&(_, i)| i).collect();
    indices.sort_unstable();
    indices
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

/// `path` without its TypeScript extension, if it ends with one.
fn strip_ts_extension(path: &[u8]) -> Option<&[u8]> {
    [
        &b".d.ts"[..],
        b".d.mts",
        b".d.cts",
        b".mts",
        b".cts",
        b".ts",
        b".tsx",
    ]
    .into_iter()
    .find_map(|e| path.strip_suffix(e))
    .filter(|stem| !stem.is_empty())
}

/// `TryExtractTSExtension`
fn try_extract_ts_extension(path: &[u8]) -> Option<&'static [u8]> {
    [
        &b".d.ts"[..],
        b".d.cts",
        b".d.mts",
        b".ts",
        b".tsx",
        b".mts",
        b".cts",
    ]
    .into_iter()
    .find(|&e| path.ends_with(e))
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
