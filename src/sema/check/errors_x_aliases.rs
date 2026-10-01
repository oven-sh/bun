//! Aliases, what module specifiers lead to, and a few things that are about a file as a whole:
//! 2303; 18042 18043; 1205 1269 1288 1448 1484 1485 2748 2865; 1379 1380; 2308; 1544;
//! 6137 6142 2846 5097 2876 2877, 1471 1479 1541 1542; 7036; 1470 17013; 1006; 2578.
//!
//! Follows `resolveAlias` with `pushTypeResolution`, `getTargetOfAliasDeclaration` and what it calls, `getSymbolFlags`,
//! `markSymbolOfAliasDeclarationIfTypeOnly`, `checkAliasSymbol`, `checkAndReportErrorForResolvingImportAliasToTypeOnlySymbol`,
//! `getExportsOfModuleWorker`, `getExternalModuleMember`, `resolveExternalModule`,
//! `checkImportCallExpression`, `checkConstEnumAccess`, `checkNewTargetMetaProperty` and `checkImportMetaProperty` of TypeScript
//! 7.0.2's checker.go, `getSourceFileFromReference` of its fileloader.go, `getBindAndCheckDiagnosticsWithChecker` and
//! `GetIncludeProcessorDiagnostics` of its program.go and `processCommentDirective` of its scanner.go.
//!
//! `check_x_comment_directives` is an entry of its own: it goes by what all the others have said, so it comes after them.

use super::errors::{Diagnostic, is_close};
use super::*;
use crate::bind::{Decl, MemberOwner, Parent, ScopeId, ScopeKind, SymbolId};
use crate::resolve::{JsxEmit, ModuleKind, join, parent_dir};
use crate::util::FxHashSet;

const ALL_MEANINGS: SymFlags = SymFlags::VALUE
    .union(SymFlags::TYPE)
    .union(SymFlags::NAMESPACE);

/// A declaration of an alias in the file that is checked.
#[derive(Copy, Clone)]
struct AliasNode {
    sym: Sym,
    decl: Decl,
    /// Where an error about it goes.
    start: u32,
    stmt: StmtId,
}

/// The kinds of declaration that say `type`, as far as they are told apart.
#[derive(Copy, Clone, PartialEq, Eq)]
enum TypeOnlyKind {
    Import,
    ExportSpecifier,
    /// `export type * from`
    ExportStar,
    /// `export type * as ns from`
    NamespaceExport,
}

/// `typeOnlyDeclaration`
#[derive(Copy, Clone)]
struct TypeOnly {
    file: FileId,
    kind: TypeOnlyKind,
}

/// `AliasSymbolLinks` of every alias looked at, and what `typeResolutions` has of aliases.
#[derive(Default)]
struct AliasLinks {
    /// `aliasTarget`. `None`: `unknownSymbol`.
    targets: FxHashMap<Sym, Option<Sym>>,
    type_only: FxHashMap<Sym, TypeOnly>,
    /// The aliases being resolved, and whether each has come back to itself.
    resolving: Vec<(Sym, bool)>,
    circular: Vec<Sym>,
    /// `typeOnlyExportStarMap`, by module: the file the `export type *` is in.
    type_only_stars: FxHashMap<Sym, FxHashMap<Atom, FileId>>,
}

/// `export * from spec`
#[derive(Copy, Clone)]
struct ExportStar {
    file: FileId,
    spec: Atom,
    pos: u32,
    type_only: bool,
}

/// What `getExportsOfModuleWorker` keeps while it goes from module to module.
#[derive(Default)]
struct ExportWalk {
    visited: Vec<Sym>,
    non_type_only_names: FxHashSet<Atom>,
    type_only_stars: FxHashMap<Atom, FileId>,
    /// The file whose `export *` are reported, and where those that say again what another has said start.
    report_in: Option<FileId>,
    collisions: Vec<u32>,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum SiteKind {
    SideEffect,
    Import,
    Export,
    ImportEquals,
    ImportType,
    ImportCall,
    /// `require("m")` in JavaScript
    Require,
}

/// Where a module specifier is written.
#[derive(Copy, Clone)]
struct SpecifierSite {
    kind: SiteKind,
    /// `getModeForUsageLocation`
    mode: ResolutionMode,
    /// `IsEmittableImport`, of what it is in.
    is_emittable: bool,
    /// `IsPartOfTypeOnlyImportOrExportDeclaration`, of every node the module is asked for from.
    is_type_only: bool,
    /// `import type .. from`
    is_type_only_import: bool,
    is_ambient: bool,
}

impl Checker<'_> {
    pub(super) fn check_x_aliases(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let hir = self.hir(file);
        // `SkipTypeChecking`: a declaration file is checked like any other file. The default library has no text and is not checked.
        if hir.has_errors || hir.kind == FileKind::Json || hir.text.is_empty() {
            return;
        }
        self.xa_self_references(file, out);
        self.xa_alias_declarations(file, out);
        self.xa_export_star_conflicts(file, out);
        self.xa_imported_members(file, out);
        self.xa_module_specifiers(file, out);
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
            }
        }
    }

    // ───────────────────────────── resolving aliases ─────────────────────────────

    /// `IsNonLocalAlias`: an alias and nothing else.
    fn xa_is_pure_alias(&self, sym: Sym) -> bool {
        let flags = self.files().flags(sym);
        flags.contains(SymFlags::ALIAS) && !flags.intersects(ALL_MEANINGS)
    }

    /// `getDeclarationOfAliasSymbol`
    fn xa_alias_declaration(&self, sym: Sym) -> Option<Decl> {
        self.files()
            .symbol(sym)
            .decls
            .iter()
            .rev()
            .copied()
            .find(|d| {
                matches!(
                    d,
                    Decl::ImportDefault(_)
                        | Decl::ImportNamespace(_)
                        | Decl::ImportSpec(_)
                        | Decl::ImportEquals(_)
                        | Decl::ExportSpec(_)
                        | Decl::ExportStarAs(_)
                        | Decl::ExportExpr(_)
                        | Decl::UmdGlobal(_)
                )
            })
    }

    /// `resolveAlias`: what `sym` stands for, up to the first thing that is more than an alias. An alias that is asked for while
    /// it is being resolved is in a circle with everything begun since.
    fn xa_resolve_alias(&self, sym: Sym, links: &mut AliasLinks) -> Option<Sym> {
        if let Some(&known) = links.targets.get(&sym) {
            return known;
        }
        if let Some(i) = links.resolving.iter().position(|r| r.0 == sym) {
            for r in &mut links.resolving[i..] {
                r.1 = true;
            }
            return None;
        }
        if links.resolving.len() >= 100 {
            return None;
        }
        links.resolving.push((sym, false));
        let mut target = self.xa_target_of_alias(sym, links);
        if let Some(next) = target
            && self.xa_is_pure_alias(next)
        {
            target = self.xa_resolve_indirection(sym, next, links);
        }
        if links.resolving.pop().is_some_and(|r| r.1) {
            links.circular.push(sym);
            target = None;
        }
        links.targets.insert(sym, target);
        target
    }

    /// `resolveIndirectionAlias`
    fn xa_resolve_indirection(
        &self,
        source: Sym,
        target: Sym,
        links: &mut AliasLinks,
    ) -> Option<Sym> {
        let result = self.xa_resolve_alias(target, links);
        if let Some(&type_only) = links.type_only.get(&target) {
            links.type_only.entry(source).or_insert(type_only);
        }
        result
    }

    /// `getSymbolFlags`. `None`: it ends in `unknownSymbol`, which is everything.
    fn xa_symbol_flags(&self, mut sym: Sym, links: &mut AliasLinks) -> Option<SymFlags> {
        let files = self.files();
        let mut flags = files.flags(sym);
        let mut seen: Vec<Sym> = Vec::new();
        while files.flags(sym).contains(SymFlags::ALIAS) {
            let target = self.xa_resolve_alias(sym, links)?;
            if files.flags(target).contains(SymFlags::ALIAS) {
                if target == sym || seen.contains(&target) {
                    break;
                }
                if seen.is_empty() {
                    seen.push(sym);
                }
                seen.push(target);
            }
            flags |= files.flags(target);
            sym = target;
        }
        Some(flags)
    }

    /// `IsTypeOnlyImportOrExportDeclaration`
    fn xa_type_only_kind(&self, file: FileId, decl: Decl) -> Option<TypeOnlyKind> {
        let hir = self.hir(file);
        let (is_type_only, kind) = match decl {
            Decl::ImportDefault(x) | Decl::ImportNamespace(x) => {
                (hir[x].type_only, TypeOnlyKind::Import)
            }
            Decl::ImportSpec(s) => (
                hir[s].type_only
                    || hir
                        .imports
                        .iter()
                        .any(|x| x.type_only && x.named.range().contains(&s.idx())),
                TypeOnlyKind::Import,
            ),
            Decl::ImportEquals(x) => (
                hir[x].flags.contains(Flags::TYPE_ONLY),
                TypeOnlyKind::Import,
            ),
            Decl::ExportSpec(s) => (
                hir[s].type_only
                    || hir
                        .exports
                        .iter()
                        .any(|x| x.type_only && x.items.range().contains(&s.idx())),
                TypeOnlyKind::ExportSpecifier,
            ),
            Decl::ExportStarAs(stmt) => (
                says_export_type(&hir.text, hir[stmt].pos),
                TypeOnlyKind::NamespaceExport,
            ),
            _ => return None,
        };
        is_type_only.then_some(kind)
    }

    /// `markSymbolOfAliasDeclarationIfTypeOnly`. `star`: the file of the `export type *` the name came through.
    fn xa_mark_type_only(
        &self,
        sym: Sym,
        decl: Decl,
        star: Option<FileId>,
        links: &mut AliasLinks,
    ) {
        if links.type_only.contains_key(&sym) {
            return;
        }
        if let Some(kind) = self.xa_type_only_kind(sym.file, decl) {
            links.type_only.insert(
                sym,
                TypeOnly {
                    file: sym.file,
                    kind,
                },
            );
        } else if let Some(file) = star {
            links.type_only.insert(
                sym,
                TypeOnly {
                    file,
                    kind: TypeOnlyKind::ExportStar,
                },
            );
        }
    }

    /// `getTargetOfAliasDeclaration`: one step, to what may be an alias again. But for a default import, what says `type` is
    /// marked whether or not its module is found.
    fn xa_target_of_alias(&self, sym: Sym, links: &mut AliasLinks) -> Option<Sym> {
        let files = self.files();
        let file = sym.file;
        let (hir, bound) = (self.hir(file), self.bound(file));
        let decl = self.xa_alias_declaration(sym)?;
        match decl {
            // `getTargetOfImportEqualsDeclaration`
            Decl::ImportEquals(x) => match hir[x].target {
                ImportEqualsTarget::Require(spec) => {
                    self.xa_mark_type_only(sym, decl, None, links);
                    let module = files.module_of_specifier(file, spec)?;
                    let resolved = files.export(module, known::export_equals).unwrap_or(module);
                    // From `node20` on, `require` of an ECMAScript module returns its `"module.exports"` export.
                    Some(files.module_exports_export(resolved).unwrap_or(resolved))
                }
                ImportEqualsTarget::Entity(names) => {
                    let names: Vec<Atom> = hir.ids(names).collect();
                    let meaning = if names.len() == 1 {
                        SymFlags::NAMESPACE
                    } else {
                        ALL_MEANINGS
                    };
                    self.xa_resolve_entity(
                        file,
                        bound.import_equals_scope[x.idx()],
                        &names,
                        meaning,
                        true,
                        links,
                    )
                }
            },
            // `getTargetOfImportClause`
            Decl::ImportDefault(x) => {
                let module = files.module_of_specifier(file, hir[x].spec)?;
                self.xa_default_of_module(sym, decl, module, links)
            }
            // `getTargetOfNamespaceImport`
            Decl::ImportNamespace(x) => {
                let target = files
                    .module_of_specifier(file, hir[x].spec)
                    .and_then(|module| {
                        let symbol = self.xa_es_module_symbol(sym, module, links)?;
                        // `resolveESModuleSymbol`: a namespace import emitted as `require` gets the same `"module.exports"` export.
                        let module_exports = if files.is_commonjs_import_of_esm_file(file, module) {
                            files.module_exports_export(symbol)
                        } else {
                            None
                        };
                        Some(module_exports.unwrap_or(symbol))
                    });
                self.xa_mark_type_only(sym, decl, None, links);
                target
            }
            // `getTargetOfImportSpecifier`
            Decl::ImportSpec(s) => {
                let import = hir
                    .imports
                    .iter()
                    .find(|x| x.named.range().contains(&s.idx()))?;
                let Some(module) = files.module_of_specifier(file, import.spec) else {
                    self.xa_mark_type_only(sym, decl, None, links);
                    return None;
                };
                if hir[s].imported == known::default {
                    return self.xa_default_of_module(sym, decl, module, links);
                }
                self.xa_module_member(sym, decl, module, hir[s].imported, links)
            }
            // `getTargetOfExportSpecifier`
            Decl::ExportSpec(s) => {
                let (index, export) = hir
                    .exports
                    .iter()
                    .enumerate()
                    .find(|(_, x)| x.items.range().contains(&s.idx()))?;
                if export.spec.is_some() {
                    let Some(module) = files.module_of_specifier(file, export.spec) else {
                        self.xa_mark_type_only(sym, decl, None, links);
                        return None;
                    };
                    if hir[s].local == known::default {
                        return self.xa_default_of_module(sym, decl, module, links);
                    }
                    return self.xa_module_member(sym, decl, module, hir[s].local, links);
                }
                let found = self.xa_resolve_entity(
                    file,
                    bound.export_scope[index],
                    &[hir[s].local],
                    ALL_MEANINGS,
                    true,
                    links,
                );
                self.xa_mark_type_only(sym, decl, None, links);
                found
            }
            // `getTargetOfNamespaceExport`
            Decl::ExportStarAs(stmt) => {
                let StmtKind::ExportStar { spec, .. } = hir[stmt].kind else {
                    return None;
                };
                let target = files
                    .module_of_specifier(file, spec)
                    .and_then(|module| self.xa_es_module_symbol(sym, module, links));
                self.xa_mark_type_only(sym, decl, None, links);
                target
            }
            // `getTargetOfExportAssignment`
            Decl::ExportExpr(stmt) => {
                let (StmtKind::ExportDefault(e) | StmtKind::ExportAssign(e)) = hir[stmt].kind
                else {
                    return None;
                };
                let mut names = Vec::new();
                let mut at = e;
                loop {
                    match hir[at].kind {
                        ExprKind::Ident(name) => {
                            names.push(name);
                            break;
                        }
                        ExprKind::Dot { obj, name, .. } => {
                            names.push(name);
                            at = obj;
                        }
                        _ => return None,
                    }
                }
                names.reverse();
                self.xa_resolve_entity(
                    file,
                    *bound.expr_scope.get(&e)?,
                    &names,
                    ALL_MEANINGS,
                    false,
                    links,
                )
            }
            // `getTargetOfNamespaceExportDeclaration`
            Decl::UmdGlobal(_) => {
                let module = files.file_symbol(file);
                Some(files.export(module, known::export_equals).unwrap_or(module))
            }
            _ => None,
        }
    }

    /// `getTargetOfModuleDefault`
    fn xa_default_of_module(
        &self,
        sym: Sym,
        decl: Decl,
        module: Sym,
        links: &mut AliasLinks,
    ) -> Option<Sym> {
        let files = self.files();
        let target = match files.export(module, known::export_equals) {
            // Its type is asked for a `default`, and then it is the default itself.
            Some(equals) => {
                if files.flags(equals).contains(SymFlags::ALIAS) {
                    self.xa_resolve_alias(equals, links);
                }
                Some(equals)
            }
            // The `"module.exports"` export of a required ECMAScript module, else a synthetic default, else the declared default.
            None => files.default_of_module(sym.file, module),
        };
        self.xa_mark_type_only(sym, decl, None, links);
        target
    }

    /// `resolveESModuleSymbol`, for the alias `node`. For `import * as ns` it goes on to resolve the members of the module's
    /// type, if nothing has yet, and with them the aliases the module exports. A circle that is only closed that way is there or
    /// not depending on what was checked before, so it is not looked for.
    fn xa_es_module_symbol(&self, node: Sym, module: Sym, links: &mut AliasLinks) -> Option<Sym> {
        let symbol = self
            .files()
            .export(module, known::export_equals)
            .unwrap_or(module);
        if self.xa_is_pure_alias(symbol) {
            self.xa_resolve_indirection(node, symbol, links)
        } else {
            Some(symbol)
        }
    }

    /// `getExternalModuleMember`, `getExportOfModule`
    fn xa_module_member(
        &self,
        sym: Sym,
        decl: Decl,
        module: Sym,
        name: Atom,
        links: &mut AliasLinks,
    ) -> Option<Sym> {
        self.xa_es_module_symbol(sym, module, links);
        let found = self.files().module_export(module, name);
        let star = self.xa_type_only_export_star(module, name, links);
        self.xa_mark_type_only(sym, decl, star, links);
        found
    }

    /// `getSymbol`: an alias has the meanings of what it stands for.
    fn xa_has_meaning(&self, sym: Sym, meaning: SymFlags, links: &mut AliasLinks) -> bool {
        let flags = self.files().flags(sym);
        flags.intersects(meaning)
            || flags.contains(SymFlags::ALIAS)
                && self
                    .xa_symbol_flags(sym, links)
                    .is_none_or(|f| f.intersects(meaning))
    }

    /// `resolveName`
    fn xa_resolve_name(
        &self,
        file: FileId,
        mut scope: ScopeId,
        name: Atom,
        meaning: SymFlags,
        links: &mut AliasLinks,
    ) -> Option<Sym> {
        let files = self.files();
        let bound = self.bound(file);
        while scope.is_some() {
            let s = &bound.scopes[scope.idx()];
            if let Some(id) = bound.lookup(s.locals, name) {
                let sym = files.sym(file, id);
                if self.xa_has_meaning(sym, meaning, links) {
                    return Some(sym);
                }
            }
            if s.symbol.is_some()
                && !matches!(s.kind, ScopeKind::File)
                && let Some(sym) = files.export(files.sym(file, s.symbol), name)
                && !files.flags(sym).contains(SymFlags::EXPORT_ONLY)
                && self.xa_has_meaning(sym, meaning, links)
            {
                return Some(sym);
            }
            scope = s.parent;
        }
        files
            .global(name, meaning)
            .filter(|&sym| self.xa_has_meaning(sym, meaning, links))
    }

    /// `resolveEntityName` that leaves the last name as it is found: `A.B.C` in `scope`, namespaces up to the last, which has to
    /// have `meaning`. `reports`: a first name that means nothing is an error, and what may have been meant is looked for.
    fn xa_resolve_entity(
        &self,
        file: FileId,
        scope: ScopeId,
        names: &[Atom],
        meaning: SymFlags,
        reports: bool,
        links: &mut AliasLinks,
    ) -> Option<Sym> {
        let files = self.files();
        let first_meaning = if names.len() == 1 {
            meaning
        } else {
            SymFlags::NAMESPACE
        };
        let (mut at, resolved_names) =
            match self.xa_resolve_name(file, scope, names[0], first_meaning, links) {
                Some(found) => (found, 1),
                // `globalThisSymbol` is a module whose exports are the globals. The lookup succeeds, so no suggestion is searched for.
                // No `Sym` represents it: `globalThis` alone resolves to `None`.
                None if names[0] == known::globalThis
                    && first_meaning.intersects(SymFlags::MODULE) =>
                {
                    let &member = names.get(1)?;
                    let member_meaning = if names.len() == 2 {
                        meaning
                    } else {
                        SymFlags::NAMESPACE
                    };
                    (
                        files
                            .global(member, member_meaning)
                            .filter(|&sym| self.xa_has_meaning(sym, member_meaning, links))?,
                        2,
                    )
                }
                None => {
                    if reports {
                        self.xa_failed_to_resolve(file, scope, names[0], first_meaning, links);
                    }
                    return None;
                }
            };
        // `resolveQualifiedName`
        for (i, &name) in names.iter().enumerate().skip(resolved_names) {
            // Something along the aliases is a namespace, or `at` would not have been found.
            let mut namespace = at;
            while !files.flags(namespace).intersects(SymFlags::NAMESPACE)
                && files.flags(namespace).contains(SymFlags::ALIAS)
            {
                namespace = self.xa_resolve_alias(namespace, links)?;
            }
            let meaning = if i + 1 == names.len() {
                meaning
            } else {
                SymFlags::NAMESPACE
            };
            let mut member = files
                .namespace_member(namespace, name)
                .filter(|&m| self.xa_has_meaning(m, meaning, links));
            // A namespace merged with something that is re-exported has what that has as well.
            if member.is_none() && files.flags(namespace).contains(SymFlags::ALIAS) {
                let further = self.xa_resolve_alias(namespace, links)?;
                member = files
                    .namespace_member(further, name)
                    .filter(|&m| self.xa_has_meaning(m, meaning, links));
            }
            at = member?;
        }
        Some(at)
    }

    /// `onFailedToResolveSymbol`, for what `getSuggestedSymbolForNonexistentSymbol` does on the side: in each table on the way out,
    /// until one has something similar, `getSpellingSuggestionForName` resolves every alias that is not being resolved.
    fn xa_failed_to_resolve(
        &self,
        file: FileId,
        mut scope: ScopeId,
        name: Atom,
        meaning: SymFlags,
        links: &mut AliasLinks,
    ) {
        let files = self.files();
        let bound = self.bound(file);
        let text = files.atoms.bytes(name);
        // `checkAndReportErrorForUsingTypeAsNamespace`: what is wrong is known.
        if meaning == SymFlags::NAMESPACE
            && self
                .xa_resolve_name(
                    file,
                    scope,
                    name,
                    SymFlags::TYPE.difference(SymFlags::NAMESPACE),
                    links,
                )
                .is_some()
        {
            return;
        }
        // `checkAndReportErrorForExportingPrimitiveType`, `checkAndReportErrorForUsingTypeAsValue`
        if matches!(
            text,
            b"any" | b"string" | b"number" | b"boolean" | b"never" | b"unknown"
        ) {
            return;
        }
        while scope.is_some() {
            let s = &bound.scopes[scope.idx()];
            let mut is_suggested = false;
            for &(other, id) in bound.table(s.locals) {
                is_suggested |= self.xa_is_spelling_candidate(files.sym(file, id), meaning, links)
                    && is_close(text, files.atoms.bytes(other));
            }
            if !is_suggested && s.symbol.is_some() {
                let container = files.sym(file, s.symbol);
                // A name that is only `export { name }` or `export * as name` is not in scope, and nothing else is looked for there.
                let is_only_exported = files.export(container, name).is_some_and(|exported| {
                    self.xa_is_pure_alias(exported)
                        && files
                            .symbol(exported)
                            .decls
                            .iter()
                            .any(|d| matches!(d, Decl::ExportSpec(_) | Decl::ExportStarAs(_)))
                });
                if !is_only_exported {
                    for (other, sym) in files.exports(container) {
                        is_suggested |= self.xa_is_spelling_candidate(sym, meaning, links)
                            && is_close(text, files.atoms.bytes(other));
                    }
                }
            }
            if is_suggested {
                return;
            }
            scope = s.parent;
        }
    }

    /// `getCandidateName` of `getSpellingSuggestionForName`, with `tryResolveAlias`.
    fn xa_is_spelling_candidate(
        &self,
        candidate: Sym,
        meaning: SymFlags,
        links: &mut AliasLinks,
    ) -> bool {
        let files = self.files();
        let flags = files.flags(candidate);
        if flags.intersects(meaning) {
            return true;
        }
        if !flags.contains(SymFlags::ALIAS)
            || !links.targets.contains_key(&candidate)
                && links.resolving.iter().any(|r| r.0 == candidate)
        {
            return false;
        }
        self.xa_resolve_alias(candidate, links)
            .is_some_and(|target| files.flags(target).intersects(meaning))
    }

    // ───────────────────────────── what a module exports ─────────────────────────────

    /// The `export * from` of `module`, in the order they are written.
    fn xa_export_stars_of(&self, module: Sym) -> Vec<ExportStar> {
        let files = self.files();
        let mut stars = Vec::new();
        for part in files.parts(module) {
            let (hir, bound) = (self.hir(part.file), self.bound(part.file));
            if !bound.export_stars.iter().any(|s| s.0 == part.id) {
                continue;
            }
            for &decl in &files.symbol(part).decls {
                let body = match decl {
                    Decl::File => hir.body,
                    Decl::Module(m) => hir[m].body,
                    _ => continue,
                };
                for s in hir.ids(body) {
                    if let StmtKind::ExportStar { spec, alias, .. } = hir[s].kind
                        && alias.is_none()
                    {
                        stars.push(ExportStar {
                            file: part.file,
                            spec,
                            pos: hir[s].pos,
                            type_only: says_export_type(&hir.text, hir[s].pos),
                        });
                    }
                }
            }
        }
        stars
    }

    /// `resolveSymbol`. `None`: `unknownSymbol`.
    fn xa_resolve_symbol(&self, sym: Sym) -> Option<Sym> {
        if self.xa_is_pure_alias(sym) {
            self.files().resolve_alias(sym)
        } else {
            Some(sym)
        }
    }

    /// `visit` of `getExportsOfModuleWorker`. `star`: the `export *` that led here, the file it is in and whether it says `type`.
    fn xa_visit_exports(
        &self,
        symbol: Option<Sym>,
        star: Option<(FileId, bool)>,
        is_type_only: bool,
        walk: &mut ExportWalk,
    ) -> Option<FxHashMap<Atom, Sym>> {
        let files = self.files();
        let symbol = symbol?;
        let own = files.exports(symbol);
        if !is_type_only {
            walk.non_type_only_names.extend(own.iter().map(|e| e.0));
        }
        if walk.visited.contains(&symbol) {
            return None;
        }
        walk.visited.push(symbol);
        let mut symbols: FxHashMap<Atom, Sym> = own.into_iter().collect();
        let stars = self.xa_export_stars_of(symbol);
        if !stars.is_empty() {
            let mut nested: FxHashMap<Atom, Sym> = FxHashMap::default();
            // `exportsWithDuplicate`, by name.
            let mut lookup: FxHashMap<Atom, Vec<(FileId, u32)>> = FxHashMap::default();
            for star in &stars {
                let resolved = files.module_of_specifier(star.file, star.spec);
                let Some(exported) = self.xa_visit_exports(
                    resolved,
                    Some((star.file, star.type_only)),
                    is_type_only || star.type_only,
                    walk,
                ) else {
                    continue;
                };
                // `extendExportSymbols`
                for (&id, &source) in &exported {
                    if id == known::default {
                        continue;
                    }
                    match nested.get(&id) {
                        None => {
                            nested.insert(id, source);
                            lookup.insert(id, Vec::new());
                        }
                        Some(&target) => {
                            if self.xa_resolve_symbol(target) != self.xa_resolve_symbol(source)
                                && let Some(duplicates) = lookup.get_mut(&id)
                            {
                                duplicates.push((star.file, star.pos));
                            }
                        }
                    }
                }
            }
            let report_in = walk.report_in;
            for (id, duplicates) in &lookup {
                // What the module exports itself settles it.
                if *id == known::export_equals || symbols.contains_key(id) {
                    continue;
                }
                walk.collisions.extend(
                    duplicates
                        .iter()
                        .filter(|d| Some(d.0) == report_in)
                        .map(|d| d.1),
                );
            }
            for (id, nested_symbol) in nested {
                symbols.entry(id).or_insert(nested_symbol);
            }
        }
        if let Some((star_file, true)) = star {
            walk.type_only_stars
                .extend(symbols.keys().map(|&name| (name, star_file)));
        }
        Some(symbols)
    }

    fn xa_has_type_only_export_star(&self, module: Sym, visited: &mut Vec<Sym>) -> bool {
        if visited.contains(&module) {
            return false;
        }
        visited.push(module);
        self.xa_export_stars_of(module).iter().any(|star| {
            star.type_only
                || self
                    .files()
                    .module_of_specifier(star.file, star.spec)
                    .is_some_and(|m| self.xa_has_type_only_export_star(m, visited))
        })
    }

    /// `typeOnlyExportStarMap[name]` of `module`: the file of the `export type *` that is the only way `name` gets out.
    fn xa_type_only_export_star(
        &self,
        module: Sym,
        name: Atom,
        links: &mut AliasLinks,
    ) -> Option<FileId> {
        if !links.type_only_stars.contains_key(&module) {
            let mut map = FxHashMap::default();
            if self.xa_has_type_only_export_star(module, &mut Vec::new()) {
                let mut walk = ExportWalk::default();
                self.xa_visit_exports(
                    Some(self.files().module_value(module)),
                    None,
                    false,
                    &mut walk,
                );
                map = walk.type_only_stars;
                map.retain(|name, _| !walk.non_type_only_names.contains(name));
            }
            links.type_only_stars.insert(module, map);
        }
        links.type_only_stars.get(&module)?.get(&name).copied()
    }

    /// `getExportsOfModuleWorker`: 2308
    fn xa_export_star_conflicts(&self, file: FileId, out: &mut Vec<Diagnostic>) {
        let files = self.files();
        if self.bound(file).export_stars.len() < 2 || !files.module(file).is_module() {
            return;
        }
        let module = files.file_symbol(file);
        // Of a module that is `export =`, what that is has the exports.
        if files.export(module, known::export_equals).is_some() {
            return;
        }
        let mut walk = ExportWalk {
            report_in: Some(file),
            ..Default::default()
        };
        self.xa_visit_exports(Some(module), None, false, &mut walk);
        out.extend(
            walk.collisions
                .iter()
                .map(|&start| Diagnostic { start, code: 2308 }),
        );
    }

    // ───────────────────────────── the declarations of aliases ─────────────────────────────

    /// Every alias the file declares, in the order they are written, as `checkSourceElements` gets to them.
    fn xa_alias_declarations(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let files = self.files();
        let (hir, bound) = (self.hir(file), self.bound(file));
        // A circle goes through a file by an alias others can get at, or by one that stands for another name of the file.
        let can_be_circular = bound.symbols.iter().any(|symbol| {
            symbol.flags.contains(SymFlags::ALIAS)
                && symbol.decls.iter().any(|d| {
                    matches!(
                        d,
                        Decl::ImportEquals(_)
                            | Decl::ExportSpec(_)
                            | Decl::ExportStarAs(_)
                            | Decl::ExportExpr(_)
                    )
                })
        });
        if !files.options.isolated_modules && !can_be_circular && !hir.is_js {
            return;
        }
        let mut import_stmts = vec![StmtId::NONE; hir.imports.len()];
        let mut import_equals_stmts = vec![StmtId::NONE; hir.import_equals.len()];
        let mut export_stmts = vec![StmtId::NONE; hir.exports.len()];
        for (i, stmt) in hir.stmts.iter().enumerate() {
            if matches!(bound.stmt_parent[i], Parent::None) {
                continue;
            }
            match stmt.kind {
                StmtKind::Import(x) => import_stmts[x.idx()] = StmtId(i as u32),
                StmtKind::ImportEquals(x) => import_equals_stmts[x.idx()] = StmtId(i as u32),
                StmtKind::ExportNamed(x) => export_stmts[x.idx()] = StmtId(i as u32),
                _ => {}
            }
        }
        let text = &hir.text[..];
        let mut nodes: Vec<AliasNode> = Vec::new();
        for (i, symbol) in bound.symbols.iter().enumerate() {
            if !symbol.flags.contains(SymFlags::ALIAS) {
                continue;
            }
            let sym = files.sym(file, SymbolId(i as u32));
            for &decl in &symbol.decls {
                let stmt = match decl {
                    Decl::ImportDefault(x) | Decl::ImportNamespace(x) => import_stmts[x.idx()],
                    Decl::ImportSpec(s) => hir
                        .imports
                        .iter()
                        .position(|x| x.named.range().contains(&s.idx()))
                        .map_or(StmtId::NONE, |x| import_stmts[x]),
                    Decl::ImportEquals(x) => import_equals_stmts[x.idx()],
                    Decl::ExportSpec(s) => hir
                        .exports
                        .iter()
                        .position(|x| x.items.range().contains(&s.idx()))
                        .map_or(StmtId::NONE, |x| export_stmts[x]),
                    Decl::ExportStarAs(s) | Decl::ExportExpr(s) | Decl::UmdGlobal(s) => s,
                    _ => continue,
                };
                if stmt.is_none() {
                    continue;
                }
                // `getErrorSpanForNode`: the name of `* as ns`, and where each of the others starts.
                let pos = hir[stmt].pos;
                let start = match decl {
                    Decl::ImportDefault(x) => eat_word(text, pos as usize, b"import")
                        .map_or(hir[x].default_pos, |end| skip_trivia(text, end) as u32),
                    Decl::ImportNamespace(x) => hir[x].namespace_pos,
                    Decl::ImportSpec(s) => {
                        specifier_start(text, hir[s].imported_pos, hir[s].type_only)
                    }
                    Decl::ExportSpec(s) => {
                        specifier_start(text, hir[s].local_pos, hir[s].type_only)
                    }
                    Decl::ExportStarAs(_) => namespace_export_start(text, pos),
                    _ => pos,
                };
                nodes.push(AliasNode {
                    sym,
                    decl,
                    start,
                    stmt,
                });
            }
        }
        nodes.sort_unstable_by_key(|n| n.start);
        let mut links = AliasLinks::default();
        // `mergeSymbol` resolves the alias that it merges a declaration into. `resolveAlias` reports a cycle found at that point at each
        // alias declaration in it, and their `aliasTarget` stays `unknownSymbol`.
        for &sym in &files.circular_at_merge {
            links.targets.insert(sym, None);
            if sym.file == file {
                links.circular.push(sym);
            }
        }
        for node in &nodes {
            self.xa_alias_symbol(file, node, &mut links, out);
        }
        for &sym in &links.circular {
            if let Some(node) = nodes.iter().rev().find(|n| n.sym == sym) {
                out.push(Diagnostic {
                    start: node.start,
                    code: 2303,
                });
            }
        }
    }

    /// `checkAliasSymbol`, and what stands before it in `checkImportDeclaration`, `checkImportEqualsDeclaration` and
    /// `checkExportDeclaration`.
    fn xa_alias_symbol(
        &mut self,
        file: FileId,
        node: &AliasNode,
        links: &mut AliasLinks,
        out: &mut Vec<Diagnostic>,
    ) {
        let files = self.files();
        let (hir, bound) = (self.hir(file), self.bound(file));
        let options = &files.options;
        let AliasNode {
            sym,
            decl,
            start,
            stmt,
        } = *node;
        // `checkGrammarModuleElementContext`
        let (is_at_top, is_in_ambient_module, mut is_ambient) = match bound.stmt_parent[stmt.idx()]
        {
            Parent::File => (true, false, false),
            Parent::Module(m) => (
                false,
                !matches!(hir[m].name, ModuleName::Ident(_)),
                hir[m].flags.contains(Flags::AMBIENT),
            ),
            _ => return,
        };
        // `NodeFlagsAmbient` is set on every node of a declaration file.
        is_ambient |= hir.kind == FileKind::Declaration;
        let spec = match (decl, hir[stmt].kind) {
            (
                Decl::ImportDefault(_) | Decl::ImportNamespace(_) | Decl::ImportSpec(_),
                StmtKind::Import(x),
            ) => hir[x].spec,
            (Decl::ImportEquals(x), _) => match hir[x].target {
                ImportEqualsTarget::Require(spec) => spec,
                ImportEqualsTarget::Entity(_) => Atom::NONE,
            },
            (Decl::ExportSpec(_), StmtKind::ExportNamed(x)) => hir[x].spec,
            (Decl::ExportStarAs(_), StmtKind::ExportStar { spec, .. }) => spec,
            // `checkExportAssignment`: in a namespace it reports 1063 or 1319 and resolves nothing. Other passes report its errors.
            (Decl::ExportExpr(_), _) => {
                if is_at_top || is_in_ambient_module {
                    self.xa_resolve_alias(sym, links);
                }
                return;
            }
            _ => return,
        };
        // `checkExternalImportOrExportDeclaration`
        if spec.is_some() {
            let text = files.atoms.bytes(spec);
            if !is_at_top && !is_in_ambient_module
                || is_in_ambient_module
                    && (is_relative_path(text) || text.starts_with(b"/"))
                    && !files.module(file).is_module()
            {
                return;
            }
        }
        let module = if spec.is_some() {
            files.module_of_specifier(file, spec)
        } else {
            None
        };
        match decl {
            // The names in braces are looked at once the module is found.
            Decl::ImportSpec(_) if module.is_none() => return,
            // A module that is `export =` is refused for that.
            Decl::ExportStarAs(_)
                if module.is_some_and(|m| files.export(m, known::export_equals).is_some()) =>
            {
                return;
            }
            Decl::ImportEquals(x) => is_ambient |= hir[x].flags.contains(Flags::AMBIENT),
            _ => {}
        }
        let target = self.xa_resolve_alias(sym, links);
        if let Decl::ImportEquals(x) = decl
            && let ImportEqualsTarget::Entity(names) = hir[x].target
        {
            self.xa_import_alias_of_type_only(file, x, names, links, out);
        }
        let Some(target) = target else { return };
        let target_flags = self.xa_symbol_flags(target, links);
        // The remaining checks apply to JavaScript files and to `isolatedModules`, and only to an alias that is not type-only.
        if !hir.is_js && !options.isolated_modules || self.xa_type_only_kind(file, decl).is_some() {
            return;
        }
        let Some(target_flags) = target_flags else {
            return;
        };
        let mut is_type = !target_flags.intersects(SymFlags::VALUE);
        // `combineValueAndTypeSymbols`: a property of the `export =` value with the same name adds the value meaning.
        let member = match decl {
            Decl::ImportSpec(s) => hir[s].imported,
            Decl::ExportSpec(s) if spec.is_some() => hir[s].local,
            _ => Atom::NONE,
        };
        if is_type
            && member.is_some()
            && member != known::default
            && let Some(equals) = module.and_then(|m| files.export(m, known::export_equals))
        {
            let Some(value) = self.xa_resolve_symbol(equals) else {
                return;
            };
            let ty = self.type_of_symbol(value);
            if !self.is_known(ty) || self.is_any(ty) {
                return;
            }
            is_type = self.imported_property_of_export_equals(sym).is_none();
        }
        // A type-only import or export already has a grammar error in a JavaScript file.
        if hir.is_js && is_type {
            // `node.PropertyNameOrName()`
            let name_start = match decl {
                Decl::ImportDefault(x) => hir[x].default_pos,
                Decl::ImportNamespace(x) => hir[x].namespace_pos,
                Decl::ImportSpec(s) => hir[s].imported_pos,
                Decl::ExportSpec(s) => hir[s].local_pos,
                Decl::ImportEquals(x) => hir[x].name_pos,
                _ => start,
            };
            out.push(Diagnostic {
                start: name_start,
                code: if matches!(decl, Decl::ExportSpec(_)) {
                    18043
                } else {
                    18042
                },
            });
            // `checkAliasSymbol` returns before 2440 and 2484, which earlier passes report at the start of the declaration.
            out.retain(|d| d.start != start || !matches!(d.code, 2440 | 2484));
            return;
        }
        if !options.isolated_modules {
            return;
        }
        // The meanings the name has in the file besides. What it stands for having one of them too is 2440 or 2484.
        let own = files.flags(sym);
        let mut excluded = SymFlags::empty();
        for meaning in [SymFlags::VALUE, SymFlags::TYPE, SymFlags::NAMESPACE] {
            if own.intersects(meaning) {
                excluded |= meaning;
            }
        }
        // `compilerOptions.isolatedModules` itself, not `GetIsolatedModules`: `verbatimModuleSyntax` has its own error for the import.
        if is_type
            && !target_flags.intersects(excluded)
            && !matches!(decl, Decl::ExportSpec(_))
            && options.isolated_modules_said
            && own.intersects(SymFlags::VALUE)
        {
            out.push(Diagnostic { start, code: 2865 });
        }
        if is_ambient {
            return;
        }
        let is_verbatim = options.verbatim_module_syntax;
        let type_only_alias = links.type_only.get(&sym).copied();
        if is_type || type_only_alias.is_some() {
            match decl {
                Decl::ImportDefault(_) | Decl::ImportSpec(_) | Decl::ImportEquals(_) => {
                    if is_verbatim {
                        out.push(Diagnostic {
                            start,
                            code: if spec.is_none() {
                                1288
                            } else if is_type {
                                1484
                            } else {
                                1485
                            },
                        });
                    }
                    if is_type
                        && matches!(decl, Decl::ImportEquals(x) if hir[x].flags.contains(Flags::EXPORT))
                    {
                        out.push(Diagnostic { start, code: 1269 });
                    }
                }
                // What says `type` in this very file can be seen to go away without looking at any other.
                Decl::ExportSpec(_)
                    if is_verbatim || type_only_alias.is_none_or(|t| t.file != file) =>
                {
                    out.push(Diagnostic {
                        start,
                        code: if is_type { 1205 } else { 1448 },
                    });
                }
                _ => {}
            }
        }
        if is_verbatim && self.xa_is_ambient_const_enum(target) {
            out.push(Diagnostic { start, code: 2748 });
        }
    }

    /// `checkAndReportErrorForResolvingImportAliasToTypeOnlySymbol`: 1379 1380
    fn xa_import_alias_of_type_only(
        &self,
        file: FileId,
        x: ImportEqualsId,
        names: IdList<Atom>,
        links: &mut AliasLinks,
        out: &mut Vec<Diagnostic>,
    ) {
        let files = self.files();
        let (hir, bound) = (self.hir(file), self.bound(file));
        let names: Vec<Atom> = hir.ids(names).collect();
        for end in (1..=names.len()).rev() {
            // `getTypeOnlyDeclarationOfEntityName`
            let Some(symbol) = self.xa_resolve_entity(
                file,
                bound.import_equals_scope[x.idx()],
                &names[..end],
                ALL_MEANINGS,
                false,
                links,
            ) else {
                continue;
            };
            if !files.flags(symbol).contains(SymFlags::ALIAS) {
                continue;
            }
            self.xa_resolve_alias(symbol, links);
            let Some(type_only) = links.type_only.get(&symbol) else {
                continue;
            };
            // Where what follows the `=` starts.
            let after_name = hir[x].name_pos as usize + files.atoms.bytes(hir[x].name).len();
            let Some(after_equals) = eat(&hir.text, after_name, b'=') else {
                return;
            };
            let is_export = matches!(
                type_only.kind,
                TypeOnlyKind::ExportSpecifier | TypeOnlyKind::ExportStar
            );
            out.push(Diagnostic {
                start: skip_trivia(&hir.text, after_equals) as u32,
                code: if is_export { 1379 } else { 1380 },
            });
            return;
        }
    }

    /// A `const enum` whose first declaration is only declared.
    fn xa_is_ambient_const_enum(&self, sym: Sym) -> bool {
        let files = self.files();
        files.flags(sym).contains(SymFlags::ENUM)
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

    // ───────────────────────────── what is imported by name ─────────────────────────────

    /// `getExternalModuleMember`: 1544 for each name imported or re-exported from a JSON module. `check_imported_names` reports the
    /// names that a module does not export.
    fn xa_imported_members(&self, file: FileId, out: &mut Vec<Diagnostic>) {
        let hir = self.hir(file);
        for import in &hir.imports {
            for s in import.named.iter() {
                self.xa_imported_member(
                    file,
                    import.spec,
                    hir[s].imported,
                    hir[s].imported_pos,
                    out,
                );
            }
        }
        for export in &hir.exports {
            if export.spec.is_none() {
                continue;
            }
            for s in export.items.iter() {
                self.xa_imported_member(file, export.spec, hir[s].local, hir[s].local_pos, out);
            }
        }
    }

    fn xa_imported_member(
        &self,
        file: FileId,
        spec: Atom,
        name: Atom,
        start: u32,
        out: &mut Vec<Diagnostic>,
    ) {
        let files = self.files();
        if name == known::default {
            return;
        }
        let Some(module) = files.module_of_specifier(file, spec) else {
            return;
        };
        // `isOnlyImportableAsDefault`: to Node, a JSON file has a default and nothing else.
        if files.options.module.is_node()
            && files.module(file).is_esm
            && files.symbol(module).decls.contains(&Decl::File)
        {
            let path = files.module(module.file).path.as_str();
            if path.ends_with(".json") || path.ends_with(".d.json.ts") {
                out.push(Diagnostic { start, code: 1544 });
            }
        }
    }

    // ───────────────────────────── module specifiers ─────────────────────────────

    /// Every place a module is named, and how.
    fn xa_module_specifiers(&self, file: FileId, out: &mut Vec<Diagnostic>) {
        let files = self.files();
        let (hir, bound) = (self.hir(file), self.bound(file));
        let text = &hir.text[..];
        // `NodeFlagsAmbient` is set on every node of a declaration file.
        let in_declaration_file = hir.kind == FileKind::Declaration;
        if !hir.specifier_uses.is_empty() {
            // Where the statements that name one start: a specifier belongs to the last that starts before it.
            let mut statements: Vec<(u32, StmtId)> = Vec::new();
            for (i, stmt) in hir.stmts.iter().enumerate() {
                if matches!(
                    stmt.kind,
                    StmtKind::Import(_)
                        | StmtKind::ImportEquals(_)
                        | StmtKind::ExportNamed(_)
                        | StmtKind::ExportStar { .. }
                ) && !matches!(bound.stmt_parent[i], Parent::None)
                {
                    statements.push((stmt.pos, StmtId(i as u32)));
                }
            }
            statements.sort_unstable();
            let import_types: Vec<u32> = hir
                .types
                .iter()
                .filter(|t| matches!(t.kind, TypeNodeKind::Import { .. }))
                .filter_map(|t| import_type_specifier(text, t.pos))
                .collect();
            for &SpecifierUse {
                spec,
                pos,
                kind,
                mode,
            } in &hir.specifier_uses
            {
                // `getModeForUsageLocation`
                let mode = if mode != ResolutionMode::None {
                    mode
                } else if kind == SpecifierKind::Require {
                    ResolutionMode::Require
                } else {
                    files.module(file).default_mode
                };
                if import_types.contains(&pos) {
                    let kind = SiteKind::ImportType;
                    let site = SpecifierSite {
                        kind,
                        mode,
                        is_emittable: false,
                        is_type_only: false,
                        is_type_only_import: false,
                        is_ambient: in_declaration_file,
                    };
                    self.xa_resolved_module(file, spec, pos, site, out);
                    continue;
                }
                let Some(&(_, stmt)) =
                    statements[..statements.partition_point(|s| s.0 <= pos)].last()
                else {
                    continue;
                };
                // `checkExternalImportOrExportDeclaration`: at the top of a file, or of a module that is declared, which names no paths
                // unless it adds to a module.
                let mut is_ambient = match bound.stmt_parent[stmt.idx()] {
                    Parent::File => in_declaration_file,
                    Parent::Module(m) if !matches!(hir[m].name, ModuleName::Ident(_)) => {
                        let path = files.atoms.bytes(spec);
                        if (is_relative_path(path) || path.starts_with(b"/"))
                            && !files.module(file).is_module()
                        {
                            continue;
                        }
                        in_declaration_file || hir[m].flags.contains(Flags::AMBIENT)
                    }
                    _ => continue,
                };
                let (said, site_kind, is_emittable, is_type_only, is_type_only_import) =
                    match hir[stmt].kind {
                        StmtKind::Import(x) if kind == SpecifierKind::SideEffect => {
                            (hir[x].spec, SiteKind::SideEffect, false, false, false)
                        }
                        StmtKind::Import(x) => {
                            let import = &hir[x];
                            // The module is asked for from the declaration itself if there are braces, and that says `type` nowhere.
                            let has_braces = import.namespace.is_none()
                                && (!import.named.is_empty() || import.default.is_none());
                            (
                                import.spec,
                                SiteKind::Import,
                                !import.type_only,
                                import.type_only && !has_braces,
                                import.type_only,
                            )
                        }
                        // `checkExportDeclaration` gets to the module through what is in the braces: without any it is never asked for.
                        StmtKind::ExportNamed(x) if hir[x].items.is_empty() => continue,
                        StmtKind::ExportNamed(x) => (
                            hir[x].spec,
                            SiteKind::Export,
                            !hir[x].type_only,
                            false,
                            false,
                        ),
                        StmtKind::ExportStar { spec, alias, .. } => {
                            let type_only = says_export_type(text, hir[stmt].pos);
                            (
                                spec,
                                SiteKind::Export,
                                !type_only,
                                type_only && alias.is_none(),
                                false,
                            )
                        }
                        StmtKind::ImportEquals(x) => {
                            let ImportEqualsTarget::Require(said) = hir[x].target else {
                                continue;
                            };
                            let type_only = hir[x].flags.contains(Flags::TYPE_ONLY);
                            is_ambient |= hir[x].flags.contains(Flags::AMBIENT);
                            (said, SiteKind::ImportEquals, !type_only, type_only, false)
                        }
                        _ => continue,
                    };
                if said != spec
                    || site_kind == SiteKind::SideEffect
                        && !files.options.no_unchecked_side_effect_imports
                {
                    continue;
                }
                self.xa_resolved_module(
                    file,
                    spec,
                    pos,
                    SpecifierSite {
                        kind: site_kind,
                        mode,
                        is_emittable,
                        is_type_only,
                        is_type_only_import,
                        is_ambient,
                    },
                    out,
                );
            }
        }
        for (i, e) in hir.exprs.iter().enumerate() {
            if let ExprKind::ImportCall(argument) = e.kind
                && argument.is_some()
                && !matches!(bound.expr_parent[i], Parent::None)
                && let ExprKind::String(spec) = hir[argument].kind
            {
                let (kind, mode) = (SiteKind::ImportCall, files.mode_of_import_call(file));
                let site = SpecifierSite {
                    kind,
                    mode,
                    is_emittable: true,
                    is_type_only: false,
                    is_type_only_import: false,
                    is_ambient: in_declaration_file,
                };
                self.xa_resolved_module(file, spec, hir[argument].pos, site, out);
            }
        }
        if !hir.is_js {
            return;
        }
        // `getTargetOfImportEqualsDeclaration` and `getExternalModuleMember` resolve the module for the aliases that a variable
        // declaration initialized to `require("m")` declares. `resolveExternalModuleTypeByLiteral` resolves it for every other call
        // that `isCommonJSRequire` accepts.
        let is_identifier = |pat: PatId| matches!(hir[pat].kind, PatKind::Ident(_));
        for i in 0..hir.exprs.len() {
            let call = ExprId(i as u32);
            let Some((argument, spec)) = require_call_argument(hir, call) else {
                continue;
            };
            // The loader resolves only the specifiers that the binder collected.
            if !bound.specifiers.contains(&spec) {
                continue;
            }
            let declares_alias = match bound.expr_parent[i] {
                Parent::None => continue,
                Parent::VarInit(decl)
                    if self.external_module_require_argument(file, decl).is_some() =>
                {
                    match hir[hir[decl].pat].kind {
                        PatKind::Ident(_) => true,
                        PatKind::Object(props) => props.iter().any(|p| is_identifier(hir[p].value)),
                        PatKind::Array(elems) => elems.iter().any(|x| is_identifier(hir[x].pat)),
                        PatKind::Missing => false,
                    }
                }
                _ => false,
            };
            if declares_alias || self.is_commonjs_require(file, call) {
                let (kind, mode) = (SiteKind::Require, ResolutionMode::Require);
                let site = SpecifierSite {
                    kind,
                    mode,
                    is_emittable: false,
                    is_type_only: false,
                    is_type_only_import: false,
                    is_ambient: false,
                };
                self.xa_resolved_module(file, spec, hir[argument].pos, site, out);
            }
        }
    }

    /// `resolveExternalModule`, for what it says of a module that is found.
    fn xa_resolved_module(
        &self,
        file: FileId,
        spec: Atom,
        start: u32,
        site: SpecifierSite,
        out: &mut Vec<Diagnostic>,
    ) {
        let files = self.files();
        let options = &files.options;
        let text = files.atoms.text(spec);
        if text.starts_with("@types/") {
            out.push(Diagnostic { start, code: 6137 });
        }
        // A module that is declared by name is what it is declared to be.
        if files
            .module_of_specifier_as(file, spec, site.mode)
            .is_some_and(|m| !files.symbol(m).decls.contains(&Decl::File))
        {
            return;
        }
        let importing = files.module(file);
        let Some(&target) = importing.imports.get(&(spec, site.mode)) else {
            return;
        };
        let target = files.module(target);
        // `GetResolutionDiagnostic`. A file that is refused is not loaded for the sake of the import.
        if target.path.ends_with(".tsx") && options.jsx == JsxEmit::None {
            out.push(Diagnostic { start, code: 6142 });
            if !options.files.contains(&target.path) {
                return;
            }
        }
        // `ResolvedUsingTsExtension`
        let using_ts_extension = importing.ts_extension_imports.contains(&(spec, site.mode));
        let is_declaration_name = is_declaration_file_name(&text);
        // `AllowImportingTsExtensionsFrom`
        let allows_ts_extensions =
            options.allow_importing_ts_extensions || is_declaration_file_name(&importing.path);
        if using_ts_extension && is_declaration_name {
            if site.is_emittable {
                out.push(Diagnostic { start, code: 2846 });
            }
        } else if using_ts_extension && !allows_ts_extensions {
            if site.is_emittable {
                out.push(Diagnostic { start, code: 5097 });
            }
        } else if options.rewrite_relative_import_extensions
            && !site.is_ambient
            && !is_declaration_name
            && site.kind != SiteKind::ImportType
            && !site.is_type_only
        {
            // `ShouldRewriteModuleSpecifier`, `SourceFileMayBeEmitted`. 2878 needs project references, which are not supported.
            let should_rewrite =
                is_relative_path(text.as_bytes()) && strip_ts_extension(&text).is_some();
            let may_be_emitted =
                target.hir.kind != FileKind::Declaration && !target.path.contains("/node_modules/");
            if !using_ts_extension && should_rewrite {
                out.push(Diagnostic { start, code: 2876 });
            } else if using_ts_extension && !should_rewrite && may_be_emitted {
                out.push(Diagnostic { start, code: 2877 });
            }
        }
        if !target.is_module() || !matches!(options.module, ModuleKind::Node16 | ModuleKind::Node18)
        {
            return;
        }
        // `require` cannot load an ECMAScript module. Only what has code in it is of either kind.
        let is_sync_import = !importing.is_esm && site.kind != SiteKind::ImportCall
            || site.kind == SiteKind::ImportEquals;
        if !is_sync_import || !target.is_esm || target.path.ends_with(".json") {
            return;
        }
        let source = &self.hir(file).text[..];
        let overrides_mode = matches!(
            site.kind,
            SiteKind::SideEffect | SiteKind::Import | SiteKind::Export | SiteKind::ImportType
        ) && string_literal(source, start as usize).is_some_and(|(_, end)| {
            has_resolution_mode_override(source, end, site.kind == SiteKind::ImportType)
        });
        if overrides_mode {
            return;
        }
        let code = match site.kind {
            SiteKind::ImportEquals => 1471,
            SiteKind::Import if site.is_type_only_import => 1541,
            SiteKind::ImportType => 1542,
            _ => 1479,
        };
        out.push(Diagnostic { start, code });
    }

    // ───────────────────────────── expressions ─────────────────────────────

    fn xa_expressions(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let files = self.files();
        let (hir, bound) = (self.hir(file), self.bound(file));
        for i in 0..hir.exprs.len() {
            if matches!(bound.expr_parent[i], Parent::None) {
                continue;
            }
            let e = ExprId(i as u32);
            match hir.exprs[i].kind {
                // `checkImportCallExpression`
                ExprKind::ImportCall(argument) => {
                    if argument.is_none()
                        || matches!(hir[argument].kind, ExprKind::Missing | ExprKind::Spread(_))
                    {
                        continue;
                    }
                    let ty = self.type_of_expr(file, argument);
                    if !self.is_known(ty) || self.is_uncertain(file, argument) {
                        continue;
                    }
                    // A type parameter where none is in scope is something that was not got to the bottom of.
                    if self.has_type_variables(ty) && !self.is_in_generic_context(file, argument) {
                        continue;
                    }
                    if ty.is_undefined() || ty.is_null() || !self.is_assignable(ty, TypeId::STRING)
                    {
                        out.push(Diagnostic {
                            start: self.start_of(file, argument),
                            code: 7036,
                        });
                    }
                }
                // `checkImportMetaProperty`
                ExprKind::ImportMeta => {
                    if files.options.module.is_node() && !files.module(file).is_esm {
                        out.push(Diagnostic {
                            start: hir.exprs[i].pos,
                            code: 1470,
                        });
                    }
                }
                // `checkNewTargetMetaProperty`
                ExprKind::NewTarget => {
                    if self.xa_has_new_target_container(file, e) == Some(false) {
                        out.push(Diagnostic {
                            start: hir.exprs[i].pos,
                            code: 17013,
                        });
                    }
                }
                ExprKind::Ident(_) if files.options.isolated_modules => {
                    let local = bound.expr_symbol[i];
                    if local.is_none()
                        || bound.symbols[local.idx()]
                            .flags
                            .intersects(SymFlags::ENUM | SymFlags::ALIAS)
                    {
                        self.xa_const_enum_access(file, e, out);
                    }
                }
                ExprKind::Dot { .. } if files.options.isolated_modules => {
                    self.xa_const_enum_access(file, e, out)
                }
                _ => {}
            }
        }
    }

    /// `GetNewTargetContainer`: whether `e` is in a function or a constructor, which know how they were called, going through
    /// arrow functions. `None`: where `e` is cannot be told.
    fn xa_has_new_target_container(&self, file: FileId, e: ExprId) -> Option<bool> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        // The expression last gone out of.
        let mut below = e;
        let mut parent = bound.expr_parent[e.idx()];
        loop {
            parent = match parent {
                Parent::None => return None,
                Parent::Stmt(s) if s.is_none() => return None,
                Parent::Expr(x) if x.is_none() => return None,
                Parent::File | Parent::Module(_) | Parent::MemberInit(_) | Parent::EnumInit(_) => {
                    return Some(false);
                }
                Parent::FnBody(_) | Parent::ParamDefault(_) => {
                    let f = match parent {
                        Parent::ParamDefault(p) => bound.param_fn[p.idx()],
                        Parent::FnBody(f) => f,
                        _ => return None,
                    };
                    match hir[f].kind {
                        FnKind::Arrow => self.outward(file, parent),
                        FnKind::Decl | FnKind::Expr | FnKind::Constructor => return Some(true),
                        _ => return Some(false),
                    }
                }
                Parent::Expr(x) => {
                    below = x;
                    bound.expr_parent[x.idx()]
                }
                // A computed name is worked out where the object, the pattern or the class is.
                Parent::Key(owner) if owner.is_some() => Parent::Expr(owner),
                Parent::Key(_) => {
                    let p = hir
                        .pat_props
                        .iter()
                        .position(|p| p.key == PropKey::Computed(below))?;
                    self.outward(file, Parent::PatPropDefault(PatPropId(p as u32)))
                }
                Parent::MemberKey => {
                    if let Some(m) = hir
                        .members
                        .iter()
                        .position(|m| m.key == PropKey::Computed(below))
                    {
                        let MemberOwner::Class(c) = bound.member_owner[m] else {
                            return None;
                        };
                        self.outward(file, Parent::ClassExtends(c))
                    } else {
                        let p = hir
                            .props
                            .iter()
                            .position(|p| p.key == PropKey::Computed(below))?;
                        Parent::Expr(bound.prop_owner[p])
                    }
                }
                _ => self.outward(file, parent),
            };
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
            let mut first = e;
            while let ExprKind::Dot { obj, .. } = hir[first].kind {
                first = obj;
            }
            let local = bound.expr_symbol[first.idx()];
            if !is_accessed
                || local.is_some() && bound.symbols[local.idx()].flags.contains(SymFlags::ALIAS)
            {
                return;
            }
        }
        // `IsValidTypeOnlyAliasUseSite`
        if bound.is_in_type_query(e) || self.xa_is_in_ambient_context(file, e) {
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
            Parent::MemberKey => {
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
                    && hir.parens.binary_search_by_key(&e.0, |p| p.0.0).is_err() =>
            {
                return;
            }
            _ => {}
        }
        out.push(Diagnostic {
            start: self.start_inside_parentheses(file, e),
            code: 2748,
        });
        // Parentheses around it are an expression of the same type.
        if self.p.files.options.isolated_modules_said
            && let Ok(at) = hir.parens.binary_search_by_key(&e.0, |p| p.0.0)
        {
            out.push(Diagnostic {
                start: hir.parens[at].1,
                code: 2748,
            });
        }
    }

    /// `NodeFlagsAmbient`. Where the way out is lost track of, it is taken to be set.
    fn xa_is_in_ambient_context(&self, file: FileId, e: ExprId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if hir.kind == FileKind::Declaration {
            return true;
        }
        // The expression last gone out of.
        let mut below = e;
        let mut parent = bound.expr_parent[e.idx()];
        loop {
            parent = match parent {
                Parent::File => return false,
                Parent::None => return true,
                Parent::Stmt(s) if s.is_none() => return true,
                Parent::Expr(x) if x.is_none() => return true,
                Parent::Module(m) => return hir[m].flags.contains(Flags::AMBIENT),
                Parent::EnumInit(m) => {
                    return hir[bound.enum_member_owner[m.idx()]]
                        .flags
                        .contains(Flags::AMBIENT);
                }
                Parent::VarInit(d) if hir[d].flags.contains(Flags::AMBIENT) => return true,
                Parent::MemberInit(m) if matches!(bound.member_owner[m.idx()], MemberOwner::Class(c) if hir[c].flags.contains(Flags::AMBIENT)) => {
                    return true;
                }
                Parent::Expr(x) => {
                    below = x;
                    bound.expr_parent[x.idx()]
                }
                Parent::Key(owner) if owner.is_some() => Parent::Expr(owner),
                Parent::Key(_) => match hir
                    .pat_props
                    .iter()
                    .position(|p| p.key == PropKey::Computed(below))
                {
                    Some(p) => self.outward(file, Parent::PatPropDefault(PatPropId(p as u32))),
                    None => return true,
                },
                Parent::MemberKey => {
                    if let Some(m) = hir
                        .members
                        .iter()
                        .position(|m| m.key == PropKey::Computed(below))
                    {
                        match bound.member_owner[m] {
                            MemberOwner::Class(c) if !hir[c].flags.contains(Flags::AMBIENT) => {
                                self.outward(file, Parent::ClassExtends(c))
                            }
                            _ => return true,
                        }
                    } else if let Some(p) = hir
                        .props
                        .iter()
                        .position(|p| p.key == PropKey::Computed(below))
                    {
                        Parent::Expr(bound.prop_owner[p])
                    } else {
                        return true;
                    }
                }
                _ => self.outward(file, parent),
            };
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
        if says_no_check(text) {
            out.clear();
            return;
        }
        let directives = comment_directives(text);
        if directives.is_empty() {
            return;
        }
        let line_starts = line_starts(text);
        let line_of = |pos: u32| line_starts.partition_point(|&start| start <= pos) - 1;
        // `directivesByLine`: the line, where the directive starts, whether an error is expected, and whether one came.
        let mut by_line: Vec<(usize, u32, bool, bool)> = Vec::new();
        for &(start, expects_error) in &directives {
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
                    by_line[i].3 |= !matches!(d.code, 1006 | 2688 | 2726 | 6053);
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
            }
        }
    }

    /// Whether the type of everything written from `from` up to `to` has been worked out. An error that rests on one that has
    /// not is kept back.
    fn xa_is_all_known(&mut self, file: FileId, from: u32, to: u32) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        for i in 0..hir.exprs.len() {
            if !(from..to).contains(&hir.exprs[i].pos)
                || matches!(bound.expr_parent[i], Parent::None)
            {
                continue;
            }
            let e = ExprId(i as u32);
            let ty = self.type_at(file, e);
            if !self.is_known(ty) || self.is_uncertain(file, e) {
                return false;
            }
        }
        for i in 0..hir.types.len() {
            if !(from..to).contains(&hir.types[i].pos) || bound.type_scope[i].is_none() {
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

/// `SkipTrivia`: past white space and comments.
fn skip_trivia(text: &[u8], at: usize) -> usize {
    let mut at = at.min(text.len());
    loop {
        while at < text.len() && text[at].is_ascii_whitespace() {
            at += 1;
        }
        if text[at..].starts_with(b"//") {
            while at < text.len() && text[at] != b'\n' && text[at] != b'\r' {
                at += 1;
            }
        } else if text[at..].starts_with(b"/*") {
            match text[at + 2..].windows(2).position(|w| w == b"*/") {
                Some(n) => at += n + 4,
                None => return text.len(),
            }
        } else {
            return at;
        }
    }
}

fn is_word_byte(c: u8) -> bool {
    c.is_ascii_alphanumeric() || c == b'_' || c == b'$' || c >= 0x80
}

/// Where `word` ends, if it is what is written at `at`.
fn eat_word(text: &[u8], at: usize, word: &[u8]) -> Option<usize> {
    let end = at + word.len();
    (text.get(at..end)? == word && !text.get(end).is_some_and(|&c| is_word_byte(c))).then_some(end)
}

/// Past `c`, if it is the next token from `at` on.
fn eat(text: &[u8], at: usize, c: u8) -> Option<usize> {
    let at = skip_trivia(text, at);
    (text.get(at) == Some(&c)).then_some(at + 1)
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

/// Whether the statement at `pos` starts `export type`.
fn says_export_type(text: &[u8], pos: u32) -> bool {
    eat_word(text, pos as usize, b"export")
        .is_some_and(|end| eat_word(text, skip_trivia(text, end), b"type").is_some())
}

/// Where the `*` of `export * as ns`, the statement at `pos`, is.
fn namespace_export_start(text: &[u8], pos: u32) -> u32 {
    let Some(end) = eat_word(text, pos as usize, b"export") else {
        return pos;
    };
    let at = skip_trivia(text, end);
    eat_word(text, at, b"type").map_or(at, |end| skip_trivia(text, end)) as u32
}

/// Where `a as b` in braces starts, `a` being at `name_pos`: at the `type` before it if it has one.
fn specifier_start(text: &[u8], name_pos: u32, type_only: bool) -> u32 {
    if !type_only {
        return name_pos;
    }
    let mut before = text[..(name_pos as usize).min(text.len())].trim_ascii_end();
    while before.ends_with(b"*/") {
        let Some(open) = before.windows(2).rposition(|w| w == b"/*") else {
            break;
        };
        before = before[..open].trim_ascii_end();
    }
    if before.ends_with(b"type") {
        before.len() as u32 - 4
    } else {
        name_pos
    }
}

/// Where the specifier of `import("m")` or `typeof import("m")`, the type at `pos`, is.
fn import_type_specifier(text: &[u8], pos: u32) -> Option<u32> {
    let mut at = pos as usize;
    if let Some(end) = eat_word(text, at, b"typeof") {
        at = skip_trivia(text, end);
    }
    let open = eat(text, eat_word(text, at, b"import")?, b'(')?;
    Some(skip_trivia(text, open) as u32)
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

/// `IsDeclarationFileName`
fn is_declaration_file_name(path: &str) -> bool {
    let base = &path[path.rfind('/').map_or(0, |i| i + 1)..];
    base.ends_with(".d.ts")
        || base.ends_with(".d.mts")
        || base.ends_with(".d.cts")
        || base.ends_with(".ts") && base.contains(".d.")
}

/// `IsRequireCall` with `requireStringLiteralLikeArgument`: the argument of `require("m")` and its text. Parentheses around `require`
/// or around the string make it an ordinary call.
fn require_call_argument(hir: &hir::File, call: ExprId) -> Option<(ExprId, Atom)> {
    let argument = crate::bind::require_argument(hir, call)?;
    let (ExprKind::Call(c), ExprKind::String(spec)) = (hir[call].kind, hir[argument].kind) else {
        return None;
    };
    let is_parenthesized = |e: ExprId| hir.parens.binary_search_by_key(&e.0, |p| p.0.0).is_ok();
    (!is_parenthesized(hir[c].callee) && !is_parenthesized(argument)).then_some((argument, spec))
}

/// How many bytes the line break at `at` takes; 0 if there is none. `\r\n` is two of them.
fn line_break_len(text: &[u8], at: usize) -> usize {
    match text[at] {
        b'\n' | b'\r' => 1,
        0xE2 if text[at..].starts_with(&[0xE2, 0x80, 0xA8])
            || text[at..].starts_with(&[0xE2, 0x80, 0xA9]) =>
        {
            3
        }
        _ => 0,
    }
}

/// `ComputeECMALineStarts`
fn line_starts(text: &[u8]) -> Vec<u32> {
    let mut starts = vec![0];
    let mut at = 0;
    while at < text.len() {
        let mut len = line_break_len(text, at);
        if len == 0 {
            at += 1;
            continue;
        }
        if text[at] == b'\r' && text.get(at + 1) == Some(&b'\n') {
            len = 2;
        }
        at += len;
        starts.push(at as u32);
    }
    starts
}

/// `isCommentOrBlankLine`
fn is_comment_or_blank_line(text: &[u8], mut at: usize) -> bool {
    while at < text.len() && (text[at] == b' ' || text[at] == b'\t') {
        at += 1;
    }
    at == text.len() || text[at] == b'\r' || text[at] == b'\n' || text[at..].starts_with(b"//")
}

/// `processCommentDirective`: the comment from `start` to `end`, or its last line if it can have several.
fn process_comment_directive(
    text: &[u8],
    start: usize,
    end: usize,
    multiline: bool,
    out: &mut Vec<(u32, bool)>,
) {
    let mut at = start;
    let skip = |at: &mut usize, wanted: &[u8]| {
        while *at < end && wanted.contains(&text[*at]) {
            *at += 1;
        }
    };
    if multiline {
        skip(&mut at, b" \t");
        skip(&mut at, b"/*");
    } else {
        at += 2;
        skip(&mut at, b"/");
    }
    skip(&mut at, b" \t");
    if at >= end || text[at] != b'@' {
        return;
    }
    let rest = &text[at + 1..];
    if rest.starts_with(b"ts-expect-error") {
        out.push((start as u32, true));
    } else if rest.starts_with(b"ts-ignore") {
        out.push((start as u32, false));
    }
}

/// Whether a `/` after `before` starts a regular expression rather than divides.
fn can_start_regular_expression(before: &[u8]) -> bool {
    let Some(&last) = before.last() else {
        return true;
    };
    if is_word_byte(last) {
        let word = &before[before
            .iter()
            .rposition(|&c| !is_word_byte(c))
            .map_or(0, |i| i + 1)..];
        return matches!(
            word,
            b"return"
                | b"typeof"
                | b"instanceof"
                | b"in"
                | b"of"
                | b"new"
                | b"delete"
                | b"void"
                | b"throw"
                | b"case"
                | b"do"
                | b"else"
                | b"yield"
                | b"await"
        );
    }
    // After `<` it closes a JSX element.
    !matches!(last, b')' | b']' | b'}' | b'<' | b'"' | b'\'' | b'`')
}

/// The comments of `text` that are `@ts-ignore` or `@ts-expect-error`: where each starts, as `CommentDirective.Loc` has it, and
/// whether it expects an error. What is in strings, templates and regular expressions is no comment.
fn comment_directives(text: &[u8]) -> Vec<(u32, bool)> {
    let mut out = Vec::new();
    if !text.windows(4).any(|w| w == b"@ts-") {
        return out;
    }
    // For each `${` that is open, how many `{` are open inside of it.
    let mut substitutions: Vec<u32> = Vec::new();
    // Where the last token ended.
    let mut token_end = 0;
    let mut at = 0;
    while at < text.len() {
        let c = text[at];
        let next = text.get(at + 1).copied();
        let mut in_template = false;
        match c {
            b'/' if next == Some(b'/') => {
                let start = at;
                while at < text.len() && line_break_len(text, at) == 0 {
                    at += 1;
                }
                process_comment_directive(text, start, at, false, &mut out);
                continue;
            }
            b'/' if next == Some(b'*') => {
                let mut last_line_start = at;
                at += 2;
                while at < text.len() {
                    if text[at..].starts_with(b"*/") {
                        at += 2;
                        break;
                    }
                    let len = line_break_len(text, at);
                    at += len.max(1);
                    if len > 0 {
                        last_line_start = at;
                    }
                }
                process_comment_directive(text, last_line_start, at, true, &mut out);
                continue;
            }
            b'/' if can_start_regular_expression(&text[..token_end]) => {
                // Up to the `/` that closes it, if there is one in the line.
                let mut end = at + 1;
                let mut in_class = false;
                while end < text.len()
                    && line_break_len(text, end) == 0
                    && (in_class || text[end] != b'/')
                {
                    match text[end] {
                        b'\\' => end += 1,
                        b'[' => in_class = true,
                        b']' => in_class = false,
                        _ => {}
                    }
                    end += 1;
                }
                at = if end < text.len() && text[end] == b'/' {
                    end + 1
                } else {
                    at + 1
                };
            }
            b'"' | b'\'' => {
                at += 1;
                while at < text.len() && text[at] != c && line_break_len(text, at) == 0 {
                    at += if text[at] == b'\\' { 2 } else { 1 };
                }
                at += 1;
            }
            b'`' => {
                at += 1;
                in_template = true;
            }
            b'{' => {
                if let Some(depth) = substitutions.last_mut() {
                    *depth += 1;
                }
                at += 1;
            }
            b'}' => {
                at += 1;
                match substitutions.pop() {
                    Some(0) => in_template = true,
                    Some(depth) => substitutions.push(depth - 1),
                    None => {}
                }
            }
            _ => {
                at += 1;
                if c.is_ascii_whitespace() {
                    continue;
                }
            }
        }
        if in_template {
            while at < text.len() && text[at] != b'`' {
                if text[at..].starts_with(b"${") {
                    substitutions.push(0);
                    at += 1;
                    break;
                }
                at += if text[at] == b'\\' { 2 } else { 1 };
            }
            at += 1;
        }
        at = at.min(text.len());
        token_end = at;
    }
    out
}

/// `// @ts-nocheck` among the comments at the top, with no `// @ts-check` after it: `getCommentPragmas`, `CheckJsDirective`.
fn says_no_check(text: &[u8]) -> bool {
    let mut is_off = false;
    let mut at = 0;
    if text.starts_with(b"#!") {
        while at < text.len() && line_break_len(text, at) == 0 {
            at += 1;
        }
    }
    loop {
        while at < text.len() && text[at].is_ascii_whitespace() {
            at += 1;
        }
        if text[at..].starts_with(b"/*") {
            match text[at + 2..].windows(2).position(|w| w == b"*/") {
                Some(n) => at += n + 4,
                None => return is_off,
            }
            continue;
        }
        if !text[at..].starts_with(b"//") {
            return is_off;
        }
        let start = at;
        while at < text.len() && line_break_len(text, at) == 0 {
            at += 1;
        }
        // `extractPragmas`
        let comment = &text[start + 2..at];
        let comment = comment.strip_prefix(b"/").unwrap_or(comment);
        let blanks = comment
            .iter()
            .take_while(|&&c| c == b' ' || c == b'\t')
            .count();
        let Some(rest) = comment[blanks..].strip_prefix(b"@") else {
            continue;
        };
        let name = &rest[..rest
            .iter()
            .take_while(|&&c| c.is_ascii_alphabetic() || c == b'-')
            .count()];
        if name.eq_ignore_ascii_case(b"ts-nocheck") {
            is_off = true;
        } else if name.eq_ignore_ascii_case(b"ts-check") {
            is_off = false;
        }
    }
}
