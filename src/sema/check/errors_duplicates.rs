//! One name declared twice in ways that do not go together: 2300 2451 2528 2567 2649 2699. And what goes together in some ways only:
//! 2323 2433 2434.
//!
//! In TypeScript 7.0.2 this is spread over `declareSymbolEx` and `declareModuleMember` of binder.go, which refuse a declaration that
//! what is in the table excludes, `mergeSymbol` of checker.go, which does the same between files,
//! `checkObjectTypeForDuplicateDeclarations` and `checkTypeParameters`. What the binder refused is on record
//! (`Bound::redeclarations`) and is reported here.

use super::explain::NO_LENGTH;
use super::late_bound::LateBoundConflict;
use super::*;
use crate::bind::{
    ClassOwner, Decl, JsDeclarationKind, SymbolId, assignment_declaration_kind, flags_of_member,
};
use smallvec::SmallVec;

/// A declaration of a symbol as TypeScript has them: where it is, and whether that symbol is the one it goes by and gives its flags to.
/// The local symbol of a name in a module or a namespace also lists what is exported under the name, which goes by another symbol.
type Declaration = (FileId, Decl, bool);

impl Checker<'_> {
    pub(super) fn check_duplicates(&mut self, file: FileId) {
        let bound = self.bound(file);
        for i in 0..bound.symbols.len() {
            let symbol = &bound.symbols[i];
            let is_merged = symbol.flags.contains(SymFlags::MERGED);
            let is_class_or_function = |d: &Decl| matches!(d, Decl::Class(_) | Decl::Fn(_));
            if !is_merged
                && (symbol.decls.len() < 2 || !symbol.decls.iter().any(is_class_or_function))
            {
                continue;
            }
            let sym = self.files().sym(file, SymbolId(i as u32));
            // Once for each symbol, whichever of its parts leads here.
            if sym.file == file && sym.id.idx() != i {
                continue;
            }
            self.check_what_merges(file, sym);
        }
        self.check_refused_merges(file);
        self.check_duplicate_umd_globals(file);
        self.check_duplicate_members(file);
        self.check_static_property_name_conflicts(file);
        self.check_external_module_exports(file);
        self.report_redeclarations(file);
        let hir = self.hir(file);
        let lists = hir
            .fns
            .iter()
            .map(|f| f.type_params)
            .chain(hir.classes.iter().map(|c| c.type_params))
            .chain(hir.interfaces.iter().map(|i| i.type_params))
            .chain(hir.aliases.iter().map(|a| a.type_params));
        // `checkTypeParameters`
        for params in lists {
            for (i, p) in params.iter().enumerate() {
                if (params.iter().take(i)).any(|earlier| hir[earlier].name == hir[p].name) {
                    self.report_on_declaration_name(file, Decl::TypeParam(p), 2300);
                }
            }
        }
    }

    /// `getAdjustedNodeForError`: the start of the name of `decl`, or of `decl` itself if it has no name.
    pub(super) fn declaration_name_start(&self, file: FileId, decl: Decl) -> Option<u32> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        Some(match decl {
            Decl::Var(pat) | Decl::Param(pat) | Decl::Require(pat) => hir[pat].pos,
            Decl::Fn(f) if hir[f].kind == FnKind::Decl => hir[f].name_pos,
            Decl::Class(c) if matches!(bound.class_owner[c.idx()], ClassOwner::Stmt(_)) => {
                hir[c].name_pos
            }
            Decl::Interface(i) => hir[i].name_pos,
            Decl::Alias(a) => hir[a].name_pos,
            Decl::Enum(e) => hir[e].name_pos,
            Decl::EnumMember(m) => hir[m].pos,
            Decl::Module(m) if matches!(hir[m].name, ModuleName::Ident(_)) => hir[m].name_pos,
            Decl::TypeParam(p) => hir[p].pos,
            Decl::ImportDefault(i) => hir[i].default_pos,
            Decl::ImportNamespace(i) => hir[i].namespace_pos,
            Decl::ImportSpec(s) => hir[s].pos,
            Decl::ImportEquals(i) => hir[i].name_pos,
            Decl::UmdGlobal(stmt) => hir.start(hir.name(hir.node(stmt))),
            // The name of `export { a as b }` is `b`.
            Decl::ExportSpec(spec) => hir[spec].pos,
            Decl::ExportStarAs(stmt) => match hir[stmt].kind {
                StmtKind::ExportStar { alias_pos, .. } => alias_pos,
                _ => return None,
            },
            // `GetNonAssignedNameOfDeclaration`: the name of `export default a` and `export = a` is `a`.
            Decl::ExportExpr(stmt) => match hir[stmt].kind {
                StmtKind::ExportDefault(e) | StmtKind::ExportAssign(e)
                    if matches!(hir[e].kind, ExprKind::Ident(_)) =>
                {
                    hir[e].pos
                }
                _ => hir[stmt].start,
            },
            Decl::Member(m) => hir[m].name_pos,
            Decl::ParameterProperty(p) => hir[hir[p].pat].pos,
            Decl::Property(p) => hir[p].pos,
            _ => return None,
        })
    }

    /// The reporting half of `declareSymbolEx`: one diagnostic for the rejected declaration and one for each earlier declaration of
    /// the symbol. Equal diagnostics are merged later by `sort_and_deduplicate_diagnostics`.
    fn report_redeclarations(&mut self, file: FileId) {
        let bound = self.bound(file);
        let place = |d: &Reported| {
            (
                file,
                d.start,
                if d.end == NO_LENGTH { d.start } else { d.end },
            )
        };
        for refusal in bound.redeclarations.iter() {
            let message = refusal.code;
            let Some(mut diag) =
                self.new_diagnostic_for_declaration_name(file, refusal.decl, message)
            else {
                continue;
            };
            let did_you_mean = self.did_you_mean_export_type_with_braces(file, refusal.decl);
            diag.related_information.extend(did_you_mean);
            let multiple_default_exports = message == 2528;
            let declarations = &bound.symbols[refusal.symbol.idx()].decls[..refusal.count as usize];
            for (index, &declaration) in declarations.iter().enumerate() {
                let Some(mut d) =
                    self.new_diagnostic_for_declaration_name(file, declaration, message)
                else {
                    continue;
                };
                if multiple_default_exports {
                    let here = if index == 0 { 2753 } else { 6204 };
                    d.add_related_info(Reported::bare(place(&diag), here));
                    diag.add_related_info(Reported::bare(place(&d), 2752));
                }
                self.add_diagnostic(d);
            }
            self.add_diagnostic(diag);
        }
    }

    /// `createDiagnosticForNode(GetNameOfDeclaration(node) ?? node, message, getDisplayName(node))`. The name argument is omitted
    /// for messages without a placeholder (`messageNeedsName`). Returns `None` if the declaration has no range to report on.
    fn new_diagnostic_for_declaration_name(
        &mut self,
        file: FileId,
        node: Decl,
        message: u32,
    ) -> Option<Reported> {
        let (start, mut end) = self.range_of_declaration_name(file, node)?;
        let hir = self.hir(file);
        // `getDisplayName`: the source text of the name node. `export = e` and `export default e` have no name node and use
        // `getDeclarationName`.
        let display_name: &[u8] = match node {
            Decl::ExportExpr(it) if matches!(hir[it].kind, StmtKind::ExportAssign(_)) => b"export=",
            Decl::ExportExpr(_) => b"default",
            _ if !matches!(node, Decl::Member(_) | Decl::Property(_))
                && self.is_declaration_name_missing(file, node) =>
            {
                end = NO_LENGTH;
                b"(Missing)"
            }
            _ => (hir.text.get(start as usize..end as usize)).unwrap_or_default(),
        };
        let message_needs_name = !matches!(message, 2528 | 2567);
        let args = [Arg::Bytes(display_name)];
        Some(self.new_diagnostic(
            (file, start, end),
            message,
            &args[..message_needs_name as usize],
        ))
    }

    fn report_on_declaration_name(&mut self, file: FileId, node: Decl, message: u32) {
        if let Some(diagnostic) = self.new_diagnostic_for_declaration_name(file, node, message) {
            self.add_diagnostic(diagnostic);
        }
    }

    /// `GetErrorRangeForNode(GetNameOfDeclaration(decl) ?? decl)`. An unnamed function or class uses its first token.
    /// `export default e` uses the whole statement unless `e` is an identifier.
    fn range_of_declaration_name(&self, file: FileId, decl: Decl) -> Option<(u32, u32)> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let start = match decl {
            Decl::Fn(it) if hir[it].name.is_none() => match bound.fns[it.idx()].owner {
                crate::bind::FnOwner::Stmt(statement) => hir[statement].start,
                _ => return None,
            },
            Decl::Class(it) if hir[it].name.is_none() => match bound.class_owner[it.idx()] {
                ClassOwner::Stmt(statement) if statement.is_some() => hir[statement].start,
                _ => return None,
            },
            Decl::ExportExpr(statement) => {
                let start = self.export_assignment_name_start(file, statement);
                if start == hir[statement].start {
                    return Some((start, self.end_of_stmt(file, statement)));
                }
                // A missing identifier has an empty range.
                let (StmtKind::ExportDefault(e) | StmtKind::ExportAssign(e)) = hir[statement].kind
                else {
                    return None;
                };
                if matches!(hir[e].kind, ExprKind::Missing) {
                    return Some((start, NO_LENGTH));
                }
                start
            }
            // A member name can be a string literal or a computed name, so the range covers the whole name node.
            Decl::Member(_) | Decl::Property(_) => {
                let start = self.declaration_name_start(file, decl)?;
                return Some((start, self.end_of_name_at(file, start)));
            }
            _ => self.declaration_name_start(file, decl)?,
        };
        Some((start, self.end_of_token_at(file, start)))
    }

    /// Whether the name of `decl` is an identifier that is not there.
    pub(super) fn is_declaration_name_missing(&self, file: FileId, decl: Decl) -> bool {
        let hir = self.hir(file);
        let name = match decl {
            // Nothing is written where the name would be, not even `""` or `[""]`.
            Decl::Member(m) => {
                return hir[m].key == PropKey::Name(known::empty)
                    && !matches!(
                        hir.text.get(hir[m].name_pos as usize),
                        Some(b'"' | b'\'' | b'[')
                    );
            }
            Decl::Var(pat) | Decl::Param(pat) | Decl::Require(pat) => match hir[pat].kind {
                PatKind::Ident(name) => name,
                _ => return false,
            },
            Decl::Fn(f) => hir[f].name,
            Decl::Class(c) => hir[c].name,
            Decl::Interface(i) => hir[i].name,
            Decl::Alias(a) => hir[a].name,
            Decl::Enum(e) => hir[e].name,
            Decl::TypeParam(p) => hir[p].name,
            Decl::ImportDefault(i) => hir[i].default,
            Decl::ImportNamespace(i) => hir[i].namespace,
            Decl::ImportSpec(s) => hir[s].local,
            Decl::ImportEquals(i) => hir[i].name,
            _ => return false,
        };
        name == known::empty
    }

    /// `reportMergeSymbolError`: reports `code` at every declaration of both symbols, with related information for the declarations
    /// of the other symbol. Skips a symbol whose first declaration is in a plain JavaScript file. `named`: the symbol whose name is
    /// printed.
    fn report_merge_symbol_error(
        &mut self,
        file: FileId,
        target: &[Declaration],
        source: &[Declaration],
        named: Sym,
        code: u32,
    ) {
        if !target.iter().chain(source).any(|d| d.0 == file) {
            return;
        }
        // `symbolToString(source)`. For a member, the source text of the name in its first declaration.
        let mut name = Vec::new();
        match source.first() {
            Some(&(of, decl @ (Decl::Member(_) | Decl::Property(_)), _)) => {
                if let Some((of, from, to)) = self.place_of_declaration(of, decl) {
                    let written = self.hir(of).text.get(from as usize..to as usize);
                    name.extend_from_slice(written.unwrap_or_default());
                }
            }
            _ => self.write_symbol(&mut name, named),
        }
        // A missing name has an empty range.
        let end = match self.files().symbol(named).name {
            known::empty => NO_LENGTH,
            _ => 0,
        };
        for (symbol, other) in [(source, target), (target, source)] {
            if symbol.first().is_none_or(|first| self.is_plain_js(first.0)) {
                continue;
            }
            for &(of, decl, _) in symbol {
                if of == file
                    && let Some(start) = self.declaration_name_start(of, decl)
                {
                    let others = other
                        .iter()
                        .filter_map(|d| self.place_of_declaration(d.0, d.1))
                        .collect::<Vec<_>>()
                        .into_iter();
                    let end = match decl {
                        Decl::Member(_) | Decl::Property(_) => self.end_of_name_at(of, start),
                        _ => end,
                    };
                    self.add_duplicate_declaration_error((file, start, end), others, &name, code);
                }
            }
        }
    }

    /// `addDuplicateDeclarationError`: reports `code` at `at` (`end == 0` means the token at `start`), with related information
    /// for the other declarations of the name. tsgo's `lookupOrIssueError` only finds an existing diagnostic that has no related
    /// information yet, so each call adds a diagnostic; `compactAndMergeRelatedInfos` merges the equal ones.
    fn add_duplicate_declaration_error(
        &mut self,
        at: super::related::Place,
        others: impl Iterator<Item = super::related::Place>,
        name: &[u8],
        code: u32,
    ) {
        let mut err = self.new_diagnostic(at, code, &[Arg::Bytes(name)]);
        for other in others {
            let related = &err.related_information;
            if (other.0, other.1) == (at.0, at.1)
                || related.len() >= 5
                || related.iter().any(|r| (r.file, r.start, r.end) == other)
            {
                continue;
            }
            let related = match related.is_empty() {
                true => self.new_diagnostic(other, 6203, &[Arg::Bytes(name)]),
                false => Reported::bare(other, 6204),
            };
            err.add_related_info(related);
        }
        self.add_diagnostic(err);
    }

    /// Related information for a rejected `export type T;`: suggests `export type { T }` (`declareSymbolEx`).
    fn did_you_mean_export_type_with_braces(
        &mut self,
        file: FileId,
        decl: Decl,
    ) -> Option<Reported> {
        let Decl::Alias(a) = decl else { return None };
        let hir = self.hir(file);
        let alias = &hir[a];
        if !alias.flags.contains(Flags::EXPORT) || alias.flags.contains(Flags::REPARSED) {
            return None;
        }
        // `NodeIsMissing(node.Type())`
        let mut next = self.skip_trivia_from(file, self.end_of_name_at(file, alias.name_pos));
        if hir.text.get(next as usize) == Some(&b'=') {
            next = self.skip_trivia_from(file, next + 1);
        }
        if !matches!(hir.text.get(next as usize), None | Some(b';' | b'}')) {
            return None;
        }
        let meant = [b"export type { ", self.atoms().bytes(alias.name), b" }"].concat();
        let at = self.place_of_token(file, alias.name_pos);
        Some(self.new_diagnostic(at, 1369, &[Arg::Bytes(&meant)]))
    }

    /// `mergeSymbol`: reports the pairs of symbols that `Files::merge` refused to merge.
    fn check_refused_merges(&mut self, file: FileId) {
        let files = self.files();
        if !files.has_refused_merges(file) {
            return;
        }
        let declarations = |parts: &[Sym]| -> Vec<Declaration> {
            let of_part = |&part: &Sym| {
                files
                    .symbol(part)
                    .decls
                    .iter()
                    .map(move |&d| (part.file, d, true))
            };
            parts.iter().flat_map(of_part).collect()
        };
        let is_declared_here = |sym: Sym| files.parts(sym).iter().any(|part| part.file == file);
        for &(target, source, parts) in &files.refused_merges {
            let (target, source) = (files.canonical(target), files.canonical(source));
            if !is_declared_here(target) && !is_declared_here(source) {
                continue;
            }
            let there = declarations(&files.parts(target)[..parts as usize]);
            let added = declarations(&files.parts(source));
            if files.flags(target).contains(SymFlags::NAMESPACE_MODULE) {
                // A value that merges with a non-instantiated namespace reports TS2649 once, on its first declaration.
                if let Some(&(of, decl, _)) = added.first()
                    && of == file
                    && let Some(start) = self.declaration_name_start(of, decl)
                {
                    self.error_at((file, start, 0), 2649, &[Arg::Sym(target)]);
                }
                continue;
            }
            // `reportMergeSymbolError`
            let either = files.flags(target) | files.flags(source);
            let code = if either.intersects(SymFlags::ENUM) {
                2567
            } else if either.contains(SymFlags::BLOCK_SCOPED_VARIABLE) {
                2451
            } else {
                2300
            };
            self.report_merge_symbol_error(file, &there, &added, source, code);
        }
    }

    /// `bindNamespaceExportDeclaration`: the names of all `export as namespace N` in a file share one symbol table, where an alias
    /// excludes an alias.
    fn check_duplicate_umd_globals(&mut self, file: FileId) {
        let bound = self.bound(file);
        for (i, &(name, symbol)) in bound.umd_globals.iter().enumerate() {
            if bound
                .umd_globals
                .iter()
                .enumerate()
                .any(|(j, other)| j != i && other.0 == name)
            {
                self.report_on_declaration_name(file, bound.symbols[symbol.idx()].decls[0], 2300);
            }
        }
    }

    /// From `checkModuleDeclaration`: 2433 2434, a namespace comes after the class or function it adds to, in the same file.
    fn check_what_merges(&mut self, file: FileId, sym: Sym) {
        let files = self.files();
        let mut decls: Vec<Declaration> = Vec::new();
        for &part in files.parts(sym).iter() {
            for &decl in &files.symbol(part).decls {
                let own = files.bound(part.file).symbol_of_declaration(decl);
                decls.push((part.file, decl, own.is_none() || own == part.id));
            }
        }
        let decls = &decls[..];
        if decls.len() < 2
            || !decls
                .iter()
                .any(|d| matches!(d.1, Decl::Class(_) | Decl::Fn(_)))
        {
            return;
        }
        let is_ambient = |c: &Self, of: FileId, flags: Flags| {
            flags.contains(Flags::AMBIENT) || c.hir(of).kind == FileKind::Declaration
        };
        // `getFirstNonAmbientClassOrFunctionDeclaration`
        let first = decls.iter().find_map(|&(of, decl, _)| match decl {
            Decl::Class(c) if !is_ambient(self, of, self.hir(of)[c].flags) => {
                Some((of, self.hir(of)[c].name_pos))
            }
            Decl::Fn(f)
                if !matches!(self.hir(of)[f].body, FnBody::None)
                    && !is_ambient(self, of, self.hir(of)[f].flags) =>
            {
                Some((of, self.hir(of)[f].start))
            }
            _ => None,
        });
        if let Some((home, start)) = first {
            // `ShouldPreserveConstEnums`
            let keeps_const_enums =
                self.p.files.options.preserve_const_enums || self.p.files.options.isolated_modules;
            for &(of, decl, is_own) in decls {
                let Decl::Module(m) = decl else { continue };
                let module = self.hir(of)[m];
                if !is_own
                    || of != file
                    || is_ambient(self, of, module.flags)
                    || !self.bound(of).is_instantiated_module(m, keeps_const_enums)
                {
                    continue;
                }
                if of != home {
                    self.error_at((file, module.name_pos, 0), 2433, &[]);
                } else if module.name_pos < start {
                    self.error_at((file, module.name_pos, 0), 2434, &[]);
                }
            }
        }
    }

    /// `checkExternalModuleExports`: 2323. "It is a Syntax Error if the ExportedNames of ModuleItemList contains any duplicate entries.
    /// (TS Exceptions: namespaces, function overloads, enums, and interfaces)". tsgo reports wherever a declaration is. Here a file
    /// asks about each module it has a declaration of, and keeps what is said about itself.
    fn check_external_module_exports(&mut self, file: FileId) {
        let (files, bound) = (self.files(), self.bound(file));
        let own = files.module(file).is_module();
        let own = own.then(|| files.file_symbol(file));
        let ambient = bound.ambient_modules.iter();
        let ambient = ambient.map(|module| files.sym(file, module.1));
        let mut modules: SmallVec<[Sym; 4]> = SmallVec::new();
        for module in own.into_iter().chain(ambient) {
            if !modules.contains(&module) && self.are_module_exports_checked(module) {
                modules.push(module);
            }
        }
        let exports = modules.iter();
        for &(id, symbol) in exports.flat_map(|&module| files.exports_of_module(module)) {
            let (flags, declarations) = (files.flags(symbol), files.decls_of(symbol));
            if declarations.len() < 2 || flags.intersects(SymFlags::NAMESPACE | SymFlags::ENUM) {
                continue;
            }
            // `isNotOverload`
            let is_not_overload = |c: &Self, &&(of, decl): &&(FileId, Decl)| match decl {
                Decl::Fn(f) => !matches!(c.hir(of)[f].body, FnBody::None),
                Decl::Member(m) if c.hir(of)[m].kind == MemberKind::Method => {
                    !matches!(c.hir(of)[c.hir(of)[m].func].body, FnBody::None)
                }
                _ => true,
            };
            // `!ast.IsAccessor(d) && !ast.IsInterfaceDeclaration(d)`
            let is_counted = |c: &Self, &&(of, decl): &&(FileId, Decl)| match decl {
                Decl::Member(m) => {
                    !matches!(c.hir(of)[m].kind, MemberKind::Getter | MemberKind::Setter)
                }
                _ => !matches!(decl, Decl::Interface(_)),
            };
            let counted = declarations.iter().filter(|it| is_not_overload(self, it));
            let count = counted.filter(|it| is_counted(self, it)).count();
            // "it is legal to merge type alias with other values"
            if count < 2 || flags.contains(SymFlags::TYPE_ALIAS) && count == 2 {
                continue;
            }
            // `exports.a = 1` as often as one likes, but not next to `Object.defineProperty(exports, "a", ..)`.
            let is_exports_property = |c: &Self, &(of, decl): &(FileId, Decl)| {
                matches!(decl, Decl::ExportsProperty(e) if matches!(
                    assignment_declaration_kind(c.hir(of), e),
                    JsDeclarationKind::ExportsProperty(_)
                ))
            };
            if declarations.iter().all(|it| is_exports_property(self, it)) {
                continue;
            }
            for it @ &(of, decl) in declarations.iter() {
                if of == file
                    && is_not_overload(self, &it)
                    && let Some((start, end)) = self.error_range_of_declaration(file, decl)
                {
                    // `InternalSymbolNamePrefix` (0xFE) is not valid UTF-8, so it prints as U+FFFD.
                    let name = match id == known::assignment_declaration {
                        true => Arg::Text("\u{FFFD}assignment"),
                        false => Arg::Atom(id),
                    };
                    self.error_at((file, start, end), 2323, &[name]);
                }
            }
        }
    }

    /// Whether `checkExternalModuleExports` is called for `module`: by `checkSourceFile`, for the module a file is, or by
    /// `checkExportAssignment`, for the module it is written in.
    fn are_module_exports_checked(&self, module: Sym) -> bool {
        let files = self.files();
        let assigned = [known::export_equals, known::default].into_iter();
        let assigned = assigned.filter_map(|name| files.export(module, name));
        std::iter::once(module).chain(assigned).any(|symbol| {
            files.decls_of(symbol).iter().any(|&(of, decl)| {
                matches!(decl, Decl::File | Decl::ExportExpr(_)) && self.reports_semantic_errors(of)
            })
        })
    }

    /// Of the members of each class, interface and type literal.
    fn check_duplicate_members(&mut self, file: FileId) {
        let hir = self.hir(file);
        let is_declaration_file = hir.kind == FileKind::Declaration;
        let classes = hir.classes.iter().map(|class| {
            let is_ambient = class.flags.contains(Flags::AMBIENT) || is_declaration_file;
            (class.members, is_ambient, true)
        });
        let interfaces = (hir.interfaces.iter()).map(|it| (it.members, true, false));
        let literals = hir.types.iter().filter_map(|node| match node.kind {
            TypeNodeKind::Object(members) => Some((members, true, false)),
            _ => None,
        });
        for (members, is_ambient, is_class) in classes.chain(interfaces).chain(literals) {
            // One member has nothing to clash with, unless it declares more than itself, or is static as the `prototype` of every class is.
            if members.len() > 1
                || members.iter().any(|m| {
                    hir[m].kind == MemberKind::Constructor || hir[m].flags.contains(Flags::STATIC)
                })
            {
                self.check_object_type_for_duplicate_declarations(
                    file, members, is_ambient, is_class,
                );
            }
            for is_static in [false, true] {
                let computed = members.iter().find(|&m| {
                    matches!(hir[m].key, PropKey::Computed(_))
                        && hir[m].flags.contains(Flags::STATIC) == is_static
                });
                let bound = self.bound(file);
                let symbol = computed.map_or(SymbolId::NONE, |m| bound.member_symbol[m.idx()]);
                if symbol.is_some() {
                    let container = self.files().sym(file, bound.symbols[symbol.idx()].parent);
                    self.report_conflicts_of_late_bound_members(file, container, is_static);
                }
            }
        }
    }

    /// What `lateBindMember` and `combineSymbolTables` report of one side of `container`, as far as it is in `file`.
    pub(super) fn report_conflicts_of_late_bound_members(
        &mut self,
        file: FileId,
        container: Sym,
        is_static: bool,
    ) {
        let Some(late) = self.late_bound_members(container, is_static) else {
            return;
        };
        for conflict in &late.conflicts {
            match conflict {
                LateBoundConflict::Refused(name, earlier, refused) => {
                    let Some((of, from, to)) = self.place_of_declaration(refused.0, refused.1)
                    else {
                        continue;
                    };
                    // `name := memberName`, `DeclarationNameToString(declName)` for a unique symbol.
                    let name = if self.atoms().is_symbol_name(*name) {
                        Arg::Bytes(&self.hir(of).text[from as usize..to as usize])
                    } else {
                        Arg::Atom(*name)
                    };
                    for at in earlier.iter().chain(std::iter::once(refused)) {
                        if let Some(place) = self.place_of_declaration(at.0, at.1) {
                            self.error_at(place, 2300, &[name]);
                        }
                    }
                }
                LateBoundConflict::NotMerged(target, source) => {
                    let own = |it: &(FileId, Decl)| (it.0, it.1, true);
                    let target: Vec<Declaration> = target.iter().map(own).collect();
                    let source: Vec<Declaration> = source.iter().map(own).collect();
                    self.report_merge_symbol_error(file, &target, &source, container, 2300);
                }
            }
        }
    }

    /// `checkObjectTypeForDuplicateDeclarations`
    fn check_object_type_for_duplicate_declarations(
        &mut self,
        file: FileId,
        members: Span<MemberId>,
        is_ambient: bool,
        check_private_names: bool,
    ) {
        let hir = self.hir(file);
        // `instanceNames`, `staticNames`: 1 for a property, 2 for an accessor, 3 once errors have been reported.
        let mut names: SmallVec<[(Atom, bool, u8); 4]> = SmallVec::new();
        // 1 for what is not static, 2 for what is.
        let mut private_names: SmallVec<[(Atom, u8); 4]> = SmallVec::new();
        for m in members.iter() {
            let member = &hir[m];
            let mut declared: SmallVec<[(Decl, Atom, u8, bool); 2]> = SmallVec::new();
            if member.kind == MemberKind::Constructor {
                for p in hir[member.func].params.iter() {
                    if hir[p].flags.contains(Flags::PARAMETER_PROPERTY)
                        && let PatKind::Ident(name) = hir[hir[p].pat].kind
                    {
                        declared.push((Decl::ParameterProperty(p), name, 1, false));
                    }
                }
            } else if let Some(name) = self.declared_member_name(file, member.key) {
                let is_static = member.flags.contains(Flags::STATIC);
                if !is_ambient && is_static && name == known::prototype {
                    self.report_static_property_name_conflict(file, m, name);
                }
                if check_private_names && matches!(member.key, PropKey::Private(_)) {
                    let at = private_names.iter().position(|it| it.0 == name);
                    let at = at.unwrap_or_else(|| {
                        private_names.push((name, 0));
                        private_names.len() - 1
                    });
                    let before = private_names[at].1;
                    private_names[at].1 |= if is_static { 2 } else { 1 };
                    if before != 3 && private_names[at].1 == 3 {
                        self.report_duplicate_member_errors(file, members, name, None, 2804);
                    }
                }
                let kind = match member.kind {
                    MemberKind::Property if !member.flags.contains(Flags::ACCESSOR) => 1,
                    MemberKind::Property | MemberKind::Getter | MemberKind::Setter => 2,
                    _ => continue,
                };
                declared.push((Decl::Member(m), name, kind, is_static));
            }
            // `checkPropertyOrAccessor`
            for (declaration, name, kind, is_static) in declared {
                if self.declarations_of_member(file, declaration).len() < 2 {
                    continue;
                }
                match names.iter_mut().find(|n| (n.0, n.1) == (name, is_static)) {
                    None => names.push((name, is_static, kind)),
                    Some(state) if state.2 == 1 || state.2 == 2 && kind != 2 => {
                        state.2 = 3;
                        let is_static = Some(is_static);
                        self.report_duplicate_member_errors(file, members, name, is_static, 2300);
                    }
                    Some(_) => {}
                }
            }
        }
    }

    /// `reportDuplicateMemberErrors`. `is_static` is `None` without `checkStatic`.
    fn report_duplicate_member_errors(
        &mut self,
        file: FileId,
        members: Span<MemberId>,
        name: Atom,
        is_static: Option<bool>,
        code: u32,
    ) {
        let hir = self.hir(file);
        for m in members.iter() {
            let member = &hir[m];
            let mut named: SmallVec<[Decl; 2]> = SmallVec::new();
            if member.kind == MemberKind::Constructor {
                for p in hir[member.func].params.iter() {
                    if hir[p].flags.contains(Flags::PARAMETER_PROPERTY)
                        && matches!(hir[hir[p].pat].kind, PatKind::Ident(it) if it == name)
                    {
                        named.push(Decl::ParameterProperty(p));
                    }
                }
            } else if is_static.is_none_or(|it| it == member.flags.contains(Flags::STATIC))
                && flags_of_member(member).is_some_and(|it| it.0.intersects(SymFlags::CLASS_MEMBER))
                && self.declared_member_name(file, member.key) == Some(name)
            {
                named.push(Decl::Member(m));
            }
            for declaration in named {
                let Some(place) = self.place_of_declaration(file, declaration) else {
                    continue;
                };
                // `symbolToString(symbol)`: as its first declaration writes it.
                let declarations = self.declarations_of_member(file, declaration);
                let first = declarations.first().copied();
                let first = first.and_then(|(of, first)| self.place_of_declaration(of, first));
                let (of, from, to) = first.unwrap_or(place);
                let text = Arg::Bytes(&self.hir(of).text[from as usize..to as usize]);
                self.error_at(place, code, &[text]);
            }
        }
    }

    /// `checkClassForStaticPropertyNameConflicts`: 2699
    fn check_static_property_name_conflicts(&mut self, file: FileId) {
        let hir = self.hir(file);
        if self.files().options.use_define_for_class_fields || hir.kind == FileKind::Declaration {
            return;
        }
        for c in 0..hir.classes.len() {
            if hir.classes[c].flags.contains(Flags::AMBIENT) {
                continue;
            }
            for m in hir.classes[c].members.iter() {
                let member = &hir[m];
                if !member.flags.contains(Flags::STATIC)
                    || !matches!(member.key, PropKey::Name(_) | PropKey::Computed(_))
                {
                    continue;
                }
                // `getEffectivePropertyNameForPropertyNameNode`
                if let Some(name) = self.member_name(file, member.key)
                    && matches!(
                        self.atoms().bytes(name),
                        b"name" | b"length" | b"caller" | b"arguments"
                    )
                {
                    self.report_static_property_name_conflict(file, m, name);
                }
            }
        }
    }

    /// Reports TS2699 on the name of static member `m`. Arguments: the property name and the class name.
    fn report_static_property_name_conflict(&mut self, file: FileId, m: MemberId, name: Atom) {
        let at = (
            file,
            self.hir(file)[m].name_pos,
            self.end_of_member_name(file, m),
        );
        let class_name = match self.bound(file).member_owner[m.idx()] {
            crate::bind::MemberOwner::Class(class) => {
                match self.bound(file).class_symbol[class.idx()] {
                    symbol if symbol.is_some() => Arg::Sym(self.files().sym(file, symbol)),
                    _ => Arg::Atom(self.hir(file)[class].name),
                }
            }
            _ => Arg::Bytes(b""),
        };
        self.error_at(at, 2699, &[Arg::Atom(name), class_name]);
    }
}
