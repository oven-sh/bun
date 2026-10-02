//! One name declared twice in ways that do not go together: 2300 2451 2528 2567 2649 2699. And what goes together in some ways only:
//! 2323 2433 2434 2813 2814.
//!
//! In TypeScript 7.0.2 this is spread over `declareSymbolEx` and `declareModuleMember` of binder.go, which refuse a declaration that
//! what is in the table excludes, `mergeSymbol` of checker.go, which does the same between files,
//! `checkObjectTypeForDuplicateDeclarations` and `checkTypeParameters`. What the binder refused is on record
//! (`Bound::redeclarations`) and is reported here.

use super::errors::Diagnostic;
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
    pub(super) fn check_duplicates(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
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
            self.check_what_merges(file, sym, out);
        }
        self.check_refused_merges(file, out);
        self.check_duplicate_umd_globals(file, out);
        self.check_duplicate_members(file, out);
        self.check_static_property_name_conflicts(file, out);
        self.check_external_module_exports(file, out);
        self.report_redeclarations(file, out);
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
                if params
                    .iter()
                    .take(i)
                    .any(|earlier| hir[earlier].name == hir[p].name)
                {
                    out.push(Diagnostic {
                        start: hir[p].pos,
                        code: 2300,
                    });
                    if hir[p].name == known::empty {
                        let missing = vec!["(Missing)".to_owned()];
                        self.note(hir[p].pos, super::explain::NO_LENGTH, 2300, missing);
                    }
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
            Decl::UmdGlobal(stmt) => {
                start_after_tokens(&hir.text, hir[stmt].pos, &[b"export", b"as", b"namespace"])?
            }
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
                _ => hir[stmt].pos,
            },
            Decl::Member(m) => hir[m].name_pos,
            Decl::ParameterProperty(p) => hir[hir[p].pat].pos,
            Decl::Property(p) => hir[p].pos,
            _ => return None,
        })
    }

    /// `declareSymbolEx`: "Report errors every position with duplicate declaration. Report errors on previous encountered
    /// declarations".
    fn report_redeclarations(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        use super::explain::{NO_LENGTH, Related};
        let bound = self.bound(file);
        let related_at = |(start, end, _): (u32, u32, bool), code: u32| Related {
            at: Some((file, start, if end == NO_LENGTH { start } else { end })),
            code,
            args: Vec::new(),
        };
        // Each report: where, with which code, and what goes with it.
        let mut reports: Vec<((u32, u32, bool), u32, Vec<Related>, Decl)> = Vec::new();
        for refusal in bound.redeclarations.iter() {
            let (symbol, code) = (refusal.symbol, refusal.code);
            self.relate_export_type_without_braces(file, refusal.decl, code, out);
            let reported = reports.len();
            let Some(new) = self.range_of_declaration_name(file, refusal.decl) else {
                continue;
            };
            let earlier = bound.symbols[symbol.idx()].decls[..refusal.count as usize].iter();
            // `multipleDefaultExports`
            let are_defaults = code == 2528;
            let mut firsts = Vec::new();
            for (index, &at) in earlier.enumerate() {
                let Some(range) = self.range_of_declaration_name(file, at) else {
                    continue;
                };
                let mut another = Vec::new();
                if are_defaults {
                    another.push(related_at(new, if index == 0 { 2753 } else { 6204 }));
                    firsts.push(related_at(range, 2752));
                }
                reports.push((range, code, another, at));
            }
            reports.push((new, code, firsts, refusal.decl));
            out.extend(reports[reported..].iter().map(|report| Diagnostic {
                start: report.0.0,
                code: report.1,
            }));
        }
        // `compactAndMergeRelatedInfos`: the reports of one error are one, with what goes with any of them in the order of errors.
        reports.sort_by_key(|report| (report.0.0, report.1));
        for same in reports.chunk_by(|a, b| (a.0.0, a.1) == (b.0.0, b.1)) {
            let ((start, end, is_token), code) = (same[0].0, same[0].1);
            let mut related: Vec<Related> = same.iter().flat_map(|r| r.2.iter().cloned()).collect();
            if same.len() > 1 {
                related.sort_by_key(|r| (r.at, r.code));
                related.dedup();
            }
            // `getDisplayName`
            let at = same[0].3;
            if matches!(at, Decl::ExportExpr(it) if matches!(self.hir(file)[it].kind, StmtKind::ExportAssign(_)))
            {
                // `export = e` has no name, so `getDeclarationName`.
                let end = if is_token { 0 } else { end };
                self.note(start, end, code, vec!["export=".to_owned()]);
            } else if matches!(at, Decl::Member(_) | Decl::Property(_)) {
                self.note_duplicate_name(file, start, start);
            } else if self.is_declaration_name_missing(file, at) {
                self.note(start, NO_LENGTH, code, vec!["(Missing)".to_owned()]);
            } else if !is_token {
                self.note(start, end, code, Vec::new());
            }
            if !related.is_empty() {
                self.relate(start, code, |_| related);
            }
        }
    }

    /// `GetErrorRangeForNode(GetNameOfDeclaration(decl) ?? decl)`, and whether that is one token. A function or a class without a
    /// name is reported at its first token, `export default e` as a whole unless `e` is an identifier.
    fn range_of_declaration_name(&self, file: FileId, decl: Decl) -> Option<(u32, u32, bool)> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let start = match decl {
            Decl::Fn(it) if hir[it].name.is_none() => match bound.fns[it.idx()].owner {
                crate::bind::FnOwner::Stmt(statement) => hir[statement].pos,
                _ => return None,
            },
            Decl::Class(it) if hir[it].name.is_none() => match bound.class_owner[it.idx()] {
                ClassOwner::Stmt(statement) if statement.is_some() => hir[statement].pos,
                _ => return None,
            },
            Decl::ExportExpr(statement) => {
                let start = self.export_assignment_name_start(file, statement);
                if start == hir[statement].pos {
                    return Some((start, self.end_of_stmt(file, statement), false));
                }
                // A missing identifier has no length.
                let (StmtKind::ExportDefault(e) | StmtKind::ExportAssign(e)) = hir[statement].kind
                else {
                    return None;
                };
                if matches!(hir[e].kind, ExprKind::Missing) {
                    return Some((start, super::explain::NO_LENGTH, false));
                }
                start
            }
            _ => self.declaration_name_start(file, decl)?,
        };
        Some((start, self.end_of_token_at(file, start), true))
    }

    /// Reports `code` at the name of every declaration in `decls` that is in `file`.
    fn report_declarations<'a>(
        &self,
        file: FileId,
        decls: impl Iterator<Item = &'a Declaration>,
        code: u32,
        out: &mut Vec<Diagnostic>,
    ) {
        for &(of, decl, _) in decls {
            if of == file
                && let Some(start) = self.declaration_name_start(of, decl)
            {
                out.push(Diagnostic { start, code });
                // `getDisplayName`. What 2649 says is noted where it is reported.
                if code != 2649 && self.is_declaration_name_missing(of, decl) {
                    let missing = vec!["(Missing)".to_owned()];
                    self.note(start, super::explain::NO_LENGTH, code, missing);
                }
            }
        }
    }

    /// Whether the name of `decl` is an identifier that is not there.
    fn is_declaration_name_missing(&self, file: FileId, decl: Decl) -> bool {
        let hir = self.hir(file);
        let name = match decl {
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

    /// `reportMergeSymbolError`: reports `code` at every declaration of both symbols, and says where the other symbol is declared. Skips
    /// a symbol whose first declaration is in a plain JavaScript file. `named`: what goes by the name of `source`.
    fn report_merge_symbol_error(
        &mut self,
        file: FileId,
        target: &[Declaration],
        source: &[Declaration],
        named: Sym,
        code: u32,
        out: &mut Vec<Diagnostic>,
    ) {
        if !target.iter().chain(source).any(|d| d.0 == file) {
            return;
        }
        // `symbolToString(source)`. A member: as its first declaration writes it.
        let name = match source.first() {
            _ if !self.explains => String::new(),
            Some(&(of, decl @ (Decl::Member(_) | Decl::Property(_)), _)) => {
                let place = self.place_of_declaration(of, decl);
                place.map_or(String::new(), |(of, from, to)| {
                    self.source_text(of, from, to)
                })
            }
            _ => self.symbol_to_string(named),
        };
        // A missing name has no length.
        let end = match self.files().symbol(named).name {
            known::empty => super::explain::NO_LENGTH,
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
                        .filter_map(|d| self.place_of_declaration(d.0, d.1));
                    let at = match decl {
                        Decl::Member(_) | Decl::Property(_) => {
                            (start, self.end_of_name_at(of, start))
                        }
                        _ => (start, end),
                    };
                    self.add_duplicate_declaration_error(file, at, others, &name, code, out);
                }
            }
        }
    }

    /// `addDuplicateDeclarationError`: reports `code` at `at`, which is in `file` (an end of 0: the token there), and says where else
    /// the name is declared.
    fn add_duplicate_declaration_error(
        &self,
        file: FileId,
        at: (u32, u32),
        others: impl Iterator<Item = super::related::Place>,
        name: &str,
        code: u32,
        out: &mut Vec<Diagnostic>,
    ) {
        let (start, end) = at;
        let is_again = self.explains && out.iter().any(|d| d.start == start && d.code == code);
        out.push(Diagnostic { start, code });
        if !self.explains {
            return;
        }
        let mut related: Vec<super::explain::Related> = Vec::new();
        for other in others {
            if (other.0, other.1) == (file, start)
                || related.len() >= 5
                || related.iter().any(|r| r.at == Some(other))
            {
                continue;
            }
            let (code, args) = if related.is_empty() {
                (6203, vec![name.to_owned()])
            } else {
                (6204, Vec::new())
            };
            related.push(super::explain::Related {
                at: Some(other),
                code,
                args,
            });
        }
        self.note(start, end, code, vec![name.to_owned()]);
        self.relate_reports_merged(start, code, is_again, related);
    }

    /// `declareSymbolEx`: `export type T;`, which is about to be refused with `code`, may have been meant to be `export type { T }`.
    /// `out`: what has been reported so far.
    fn relate_export_type_without_braces(
        &mut self,
        file: FileId,
        decl: Decl,
        code: u32,
        out: &[Diagnostic],
    ) {
        let Decl::Alias(a) = decl else { return };
        let hir = self.hir(file);
        let alias = &hir[a];
        if !alias.flags.contains(Flags::EXPORT) || alias.flags.contains(Flags::REPARSED) {
            return;
        }
        // `NodeIsMissing(node.Type())`
        let mut next = self.skip_trivia_from(file, self.end_of_name_at(file, alias.name_pos));
        if hir.text.get(next as usize) == Some(&b'=') {
            next = self.skip_trivia_from(file, next + 1);
        }
        if !matches!(hir.text.get(next as usize), None | Some(b';' | b'}'))
            || out
                .iter()
                .any(|d| d.start == alias.name_pos && d.code == code)
        {
            return;
        }
        self.relate(alias.name_pos, code, |c| {
            vec![super::explain::Related {
                at: Some(c.place_of_token(file, alias.name_pos)),
                code: 1369,
                args: vec![format!("export type {{ {} }}", c.atom_text(alias.name))],
            }]
        });
    }

    /// `mergeSymbol`: reports the pairs of symbols that `Files::merge` refused to merge.
    fn check_refused_merges(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let files = self.files();
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
                // What does not go with a namespace without values has words of its own, said once.
                self.report_declarations(file, added.iter().take(1), 2649, out);
                if let Some(&(of, decl, _)) = added.first()
                    && of == file
                    && let Some(start) = self.declaration_name_start(of, decl)
                {
                    self.explain(start, 2649, |c| vec![c.symbol_to_string(target)]);
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
            self.report_merge_symbol_error(file, &there, &added, source, code, out);
        }
    }

    /// `bindNamespaceExportDeclaration`: the names of all `export as namespace N` in a file share one symbol table, where an alias
    /// excludes an alias.
    fn check_duplicate_umd_globals(&self, file: FileId, out: &mut Vec<Diagnostic>) {
        let bound = self.bound(file);
        for (i, &(name, symbol)) in bound.umd_globals.iter().enumerate() {
            if bound
                .umd_globals
                .iter()
                .enumerate()
                .any(|(j, other)| j != i && other.0 == name)
                && let Some(start) =
                    self.declaration_name_start(file, bound.symbols[symbol.idx()].decls[0])
            {
                out.push(Diagnostic { start, code: 2300 });
            }
        }
    }

    /// From `checkModuleDeclaration`: 2433 2434, a namespace comes after the class or function it adds to, in the same file.
    /// From `checkFunctionOrConstructorSymbol`: 2813 2814, a function merges with a class only if the class is ambient.
    fn check_what_merges(&mut self, file: FileId, sym: Sym, out: &mut Vec<Diagnostic>) {
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
        let is_ambient = |of: FileId, flags: Flags| {
            flags.contains(Flags::AMBIENT) || self.hir(of).kind == FileKind::Declaration
        };
        // `getFirstNonAmbientClassOrFunctionDeclaration`
        let first = decls.iter().find_map(|&(of, decl, _)| match decl {
            Decl::Class(c) if !is_ambient(of, self.hir(of)[c].flags) => {
                Some((of, self.hir(of)[c].name_pos))
            }
            Decl::Fn(f)
                if !matches!(self.hir(of)[f].body, FnBody::None)
                    && !is_ambient(of, self.hir(of)[f].flags) =>
            {
                Some((of, self.hir(of)[f].pos))
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
                    || is_ambient(of, module.flags)
                    || !self.bound(of).is_instantiated_module(m, keeps_const_enums)
                {
                    continue;
                }
                if of != home {
                    out.push(Diagnostic {
                        start: module.name_pos,
                        code: 2433,
                    });
                } else if module.name_pos < start {
                    out.push(Diagnostic {
                        start: module.name_pos,
                        code: 2434,
                    });
                }
            }
        }
        let has_class = decls.iter().any(
            |&(of, d, _)| matches!(d, Decl::Class(c) if !is_ambient(of, self.hir(of)[c].flags)),
        );
        // The symbol has to be a function, which what is only listed with it does not make it.
        if has_class && decls.iter().any(|d| d.2 && matches!(d.1, Decl::Fn(_))) {
            let classes: Vec<(FileId, u32)> = decls
                .iter()
                .filter(|d| matches!(d.1, Decl::Class(_)))
                .filter_map(|&(of, decl, _)| {
                    Some((of, self.error_range_of_declaration(of, decl)?.0))
                })
                .collect();
            for &(of, decl, _) in decls {
                if of != file {
                    continue;
                }
                let Some((start, _)) = self.error_range_of_declaration(of, decl) else {
                    continue;
                };
                match decl {
                    Decl::Class(c) => {
                        let class = &self.hir(of)[c];
                        // `symbol.Name`
                        let name = if class.flags.contains(Flags::DEFAULT) {
                            known::default
                        } else {
                            class.name
                        };
                        self.report_class_with_function(start, 2813, name, &classes, out);
                    }
                    Decl::Fn(_) => {
                        self.report_class_with_function(start, 2814, Atom::NONE, &classes, out);
                    }
                    _ => {}
                }
            }
        }
    }

    /// 2813, which names the symbol `name`, or 2814, which names nothing. Both say of each of `classes`, the class declarations of the
    /// symbol, that it could be declared only.
    fn report_class_with_function(
        &mut self,
        start: u32,
        code: u32,
        name: Atom,
        classes: &[(FileId, u32)],
        out: &mut Vec<Diagnostic>,
    ) {
        let is_again = out.iter().any(|d| d.start == start && d.code == code);
        out.push(Diagnostic { start, code });
        if is_again {
            return;
        }
        if name.is_some() {
            self.note(start, 0, code, vec![self.atom_text(name)]);
        }
        self.relate(start, code, |c| {
            classes
                .iter()
                .map(|&(of, at)| super::explain::Related {
                    at: Some(c.place_of_token(of, at)),
                    code: 6506,
                    args: Vec::new(),
                })
                .collect()
        });
    }

    /// `checkExternalModuleExports`: 2323. "It is a Syntax Error if the ExportedNames of ModuleItemList contains any duplicate entries.
    /// (TS Exceptions: namespaces, function overloads, enums, and interfaces)". tsgo reports wherever a declaration is. Here a file
    /// asks about each module it has a declaration of, and keeps what is said about itself.
    fn check_external_module_exports(&self, file: FileId, out: &mut Vec<Diagnostic>) {
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
            let is_not_overload = |&&(of, decl): &&(FileId, Decl)| match decl {
                Decl::Fn(f) => !matches!(self.hir(of)[f].body, FnBody::None),
                _ => true,
            };
            let counted = declarations.iter().filter(is_not_overload);
            let count = counted
                .filter(|d| !matches!(d.1, Decl::Interface(_)))
                .count();
            // "it is legal to merge type alias with other values"
            if count < 2 || flags.contains(SymFlags::TYPE_ALIAS) && count == 2 {
                continue;
            }
            // `exports.a = 1` as often as one likes, but not next to `Object.defineProperty(exports, "a", ..)`.
            let is_exports_property = |&(of, decl): &(FileId, Decl)| {
                matches!(decl, Decl::ExportsProperty(e) if matches!(
                    assignment_declaration_kind(self.hir(of), e),
                    JsDeclarationKind::ExportsProperty(_)
                ))
            };
            if declarations.iter().all(is_exports_property) {
                continue;
            }
            for &(of, decl) in declarations.iter().filter(is_not_overload) {
                if of == file
                    && let Some((start, end)) = self.error_range_of_declaration(file, decl)
                {
                    out.push(Diagnostic { start, code: 2323 });
                    self.note(start, end, 2323, vec![self.atom_text(id)]);
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
    fn check_duplicate_members(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let hir = self.hir(file);
        let is_declaration_file = hir.kind == FileKind::Declaration;
        let classes = hir.classes.iter().map(|class| {
            let is_ambient = class.flags.contains(Flags::AMBIENT) || is_declaration_file;
            (class.members, is_ambient)
        });
        let interfaces = hir.interfaces.iter().map(|it| (it.members, true));
        let literals = hir.types.iter().filter_map(|node| match node.kind {
            TypeNodeKind::Object(members) => Some((members, true)),
            _ => None,
        });
        for (members, is_ambient) in classes.chain(interfaces).chain(literals) {
            // One member has nothing to clash with, unless it declares more than itself, or is static as the `prototype` of every class is.
            if members.len() > 1
                || members.iter().any(|m| {
                    hir[m].kind == MemberKind::Constructor || hir[m].flags.contains(Flags::STATIC)
                })
            {
                self.check_object_type_for_duplicate_declarations(file, members, is_ambient, out);
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
                    self.report_conflicts_of_late_bound_members(file, container, is_static, out);
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
        out: &mut Vec<Diagnostic>,
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
                    let name = if self.files().atoms.is_symbol_name(*name) {
                        self.source_text(of, from, to)
                    } else {
                        self.atom_text(*name)
                    };
                    for at in earlier.iter().chain(std::iter::once(refused)) {
                        if let Some((of, start, end)) = self.place_of_declaration(at.0, at.1)
                            && of == file
                        {
                            out.push(Diagnostic { start, code: 2300 });
                            self.note(start, end, 2300, vec![name.clone()]);
                        }
                    }
                }
                LateBoundConflict::NotMerged(target, source) => {
                    let own = |it: &(FileId, Decl)| (it.0, it.1, true);
                    let target: Vec<Declaration> = target.iter().map(own).collect();
                    let source: Vec<Declaration> = source.iter().map(own).collect();
                    self.report_merge_symbol_error(file, &target, &source, container, 2300, out);
                }
            }
        }
    }

    /// `checkObjectTypeForDuplicateDeclarations`, without the private names.
    fn check_object_type_for_duplicate_declarations(
        &mut self,
        file: FileId,
        members: Span<MemberId>,
        is_ambient: bool,
        out: &mut Vec<Diagnostic>,
    ) {
        let hir = self.hir(file);
        // `instanceNames`, `staticNames`: 1 for a property, 2 for an accessor, 3 once errors have been reported.
        let mut names: SmallVec<[(Atom, bool, u8); 4]> = SmallVec::new();
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
                    out.push(Diagnostic {
                        start: member.name_pos,
                        code: 2699,
                    });
                    self.explain_static_name_conflict(file, m, name);
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
                        self.report_duplicate_member_errors(file, members, name, is_static, out);
                    }
                    Some(_) => {}
                }
            }
        }
    }

    /// `reportDuplicateMemberErrors`, with `checkStatic`.
    fn report_duplicate_member_errors(
        &mut self,
        file: FileId,
        members: Span<MemberId>,
        name: Atom,
        is_static: bool,
        out: &mut Vec<Diagnostic>,
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
            } else if member.flags.contains(Flags::STATIC) == is_static
                && flags_of_member(member).is_some_and(|it| it.0.intersects(SymFlags::CLASS_MEMBER))
                && self.declared_member_name(file, member.key) == Some(name)
            {
                named.push(Decl::Member(m));
            }
            for declaration in named {
                let Some((_, start, end)) = self.place_of_declaration(file, declaration) else {
                    continue;
                };
                out.push(Diagnostic { start, code: 2300 });
                // `symbolToString(symbol)`: as its first declaration writes it.
                let first = self
                    .declarations_of_member(file, declaration)
                    .first()
                    .copied();
                let (of, first) = first.unwrap_or((file, declaration));
                let text = match self.place_of_declaration(of, first) {
                    Some((of, from, to)) => self.source_text(of, from, to),
                    None => self.source_text(file, start, end),
                };
                self.note(start, end, 2300, vec![text]);
            }
        }
    }

    /// `checkClassForStaticPropertyNameConflicts`: 2699
    fn check_static_property_name_conflicts(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
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
                        self.files().atoms.bytes(name),
                        b"name" | b"length" | b"caller" | b"arguments"
                    )
                {
                    out.push(Diagnostic {
                        start: member.name_pos,
                        code: 2699,
                    });
                    self.explain_static_name_conflict(file, m, name);
                }
            }
        }
    }

    /// The arguments of 2699, which is reported on the name of the static member `m`: `name`, and the class.
    fn explain_static_name_conflict(&mut self, file: FileId, m: MemberId, name: Atom) {
        let start = self.hir(file)[m].name_pos;
        let end = self.end_of_member_name(file, m);
        self.explain_to(start, end, 2699, |c| {
            let mut class_name = String::new();
            if let crate::bind::MemberOwner::Class(class) = c.bound(file).member_owner[m.idx()] {
                let symbol = c.bound(file).class_symbol[class.idx()];
                class_name = if symbol.is_some() {
                    let symbol = c.files().sym(file, symbol);
                    c.symbol_to_string(symbol)
                } else {
                    c.atom_text(c.hir(file)[class].name)
                };
            }
            vec![c.atom_text(name), class_name]
        });
    }

    /// The argument of 2300 at the name of a member that starts at `start`: the name that starts at `named_at`, as it is written.
    fn note_duplicate_name(&self, file: FileId, start: u32, named_at: u32) {
        let name = self.source_text(file, named_at, self.end_of_name_at(file, named_at));
        self.note(start, self.end_of_name_at(file, start), 2300, vec![name]);
    }
}

/// The start of the token that follows `tokens`, which are written in that order from `pos`. `None` if the text differs or was not kept.
fn start_after_tokens(text: &[u8], pos: u32, tokens: &[&[u8]]) -> Option<u32> {
    let mut at = pos as usize;
    for &token in tokens {
        at = skip_trivia(text, at);
        if !text.get(at..)?.starts_with(token) {
            return None;
        }
        at += token.len();
    }
    Some(skip_trivia(text, at) as u32)
}
