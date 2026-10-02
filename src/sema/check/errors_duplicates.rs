//! One name declared twice in ways that do not go together: 2300 2451 2528 2567 2649 2699. And what goes together in some ways only:
//! 2323 2433 2434 2813 2814.
//!
//! In TypeScript 7.0.2 this is spread over `declareSymbolEx` and `declareModuleMember` of binder.go, which refuse a declaration that
//! what is in the table excludes, `mergeSymbol` of checker.go, which does the same between files,
//! `checkObjectTypeForDuplicateDeclarations` and `checkTypeParameters`. What the binder refused is on record
//! (`Bound::redeclarations`) and is reported here.

use super::errors::Diagnostic;
use super::*;
use crate::bind::{
    ClassOwner, Decl, JsDeclarationKind, PatParent, SymbolId, assignment_declaration_kind,
};
use crate::util::number_repeated;
use smallvec::SmallVec;

/// A member as it is declared: its name, whether it is static, what it makes of the name, what that excludes, where it is, and 1
/// for a property, 2 for an accessor.
type DeclaredName = (Atom, bool, u32, u32, u32, u8);

/// What goes by one name on one side of a class, an interface, a type literal or an object literal.
struct MembersOfName {
    flags: u32,
    /// Where the declarations that went together are.
    accepted: Vec<u32>,
    /// All that go by the name, refused or not.
    all: Vec<u32>,
    /// As `checkObjectTypeForDuplicateDeclarations` has it: nothing yet, a property, an accessor, said.
    state: u8,
}

const FUNCTION_SCOPED_VARIABLE: u32 = 1 << 0;
const BLOCK_SCOPED_VARIABLE: u32 = 1 << 1;
const PROPERTY: u32 = 1 << 2;
const ENUM_MEMBER: u32 = 1 << 3;
const FUNCTION: u32 = 1 << 4;
const CLASS: u32 = 1 << 5;
const INTERFACE: u32 = 1 << 6;
const CONST_ENUM: u32 = 1 << 7;
const REGULAR_ENUM: u32 = 1 << 8;
const VALUE_MODULE: u32 = 1 << 9;
const NAMESPACE_MODULE: u32 = 1 << 10;
const METHOD: u32 = 1 << 11;
const GET_ACCESSOR: u32 = 1 << 12;
const SET_ACCESSOR: u32 = 1 << 13;
const TYPE_PARAMETER: u32 = 1 << 14;
const TYPE_ALIAS: u32 = 1 << 15;
const ALIAS: u32 = 1 << 16;

const ENUM: u32 = REGULAR_ENUM | CONST_ENUM;
const ACCESSOR: u32 = GET_ACCESSOR | SET_ACCESSOR;
const VALUE: u32 = FUNCTION_SCOPED_VARIABLE
    | BLOCK_SCOPED_VARIABLE
    | PROPERTY
    | ENUM_MEMBER
    | FUNCTION
    | CLASS
    | ENUM
    | VALUE_MODULE
    | METHOD
    | ACCESSOR;
const TYPE: u32 = CLASS | INTERFACE | ENUM | ENUM_MEMBER | TYPE_PARAMETER | TYPE_ALIAS;

/// A declaration of a symbol as TypeScript has them: where it is, and whether that symbol is the one it goes by and gives its flags to.
/// The local symbol of a name in a module or a namespace also lists what is exported under the name, which goes by another symbol.
type Declaration = (FileId, Decl, bool);

/// What `declareSymbolEx` says of a declaration that would make `includes` of a name that is `flags` already.
fn code_of_refusal(flags: u32, includes: u32) -> u32 {
    if (flags | includes) & ENUM != 0 {
        2567
    } else if flags & BLOCK_SCOPED_VARIABLE != 0 {
        2451
    } else {
        2300
    }
}

/// `getExcludedSymbolFlags`, of what members make of a name.
fn excluded_by_member_flags(flags: u32) -> u32 {
    let mut excluded = 0;
    if flags & PROPERTY != 0 {
        excluded |= VALUE & !(PROPERTY | ACCESSOR);
    }
    if flags & METHOD != 0 {
        excluded |= VALUE & !METHOD;
    }
    if flags & GET_ACCESSOR != 0 {
        excluded |= VALUE & !(SET_ACCESSOR | PROPERTY);
    }
    if flags & SET_ACCESSOR != 0 {
        excluded |= VALUE & !(GET_ACCESSOR | PROPERTY);
    }
    excluded
}

impl Checker<'_> {
    pub(super) fn check_duplicates(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let bound = self.bound(file);
        for i in 0..bound.symbols.len() {
            let symbol = &bound.symbols[i];
            if symbol.decls.len() < 2 && !symbol.flags.contains(SymFlags::MERGED) {
                continue;
            }
            let sym = self.files().sym(file, SymbolId(i as u32));
            // Once for each symbol, whichever of its parts leads here.
            if sym.file == file && sym.id.idx() != i {
                continue;
            }
            self.check_declarations_of(file, sym, out);
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

    /// What `decl` makes of its name, what that does not go with, and where the name is written.
    fn declaration_flags(&self, file: FileId, decl: Decl) -> Option<(u32, u32, u32)> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        Some(match decl {
            Decl::Var(pat) => {
                let mut root = pat;
                let is_var = loop {
                    match bound.pat_parent[root.idx()] {
                        PatParent::Prop(outer, _) | PatParent::Elem(outer, _) => root = outer,
                        // What `catch` binds is the block's.
                        PatParent::Var(d) => {
                            break hir[d].kind == VarKind::Var && bound.var_stmt[d.idx()].is_some();
                        }
                        _ => return None,
                    }
                };
                if is_var {
                    (
                        FUNCTION_SCOPED_VARIABLE,
                        VALUE & !FUNCTION_SCOPED_VARIABLE,
                        hir[pat].pos,
                    )
                } else {
                    (BLOCK_SCOPED_VARIABLE, VALUE, hir[pat].pos)
                }
            }
            Decl::Param(pat) => (FUNCTION_SCOPED_VARIABLE, VALUE, hir[pat].pos),
            Decl::Fn(f) if hir[f].kind == FnKind::Decl => (
                FUNCTION,
                VALUE & !(FUNCTION | VALUE_MODULE | CLASS),
                hir[f].name_pos,
            ),
            Decl::Class(c) if matches!(bound.class_owner[c.idx()], ClassOwner::Stmt(_)) => (
                CLASS,
                (VALUE | TYPE) & !(VALUE_MODULE | INTERFACE | FUNCTION),
                hir[c].name_pos,
            ),
            Decl::Interface(i) => (INTERFACE, TYPE & !(INTERFACE | CLASS), hir[i].name_pos),
            Decl::Alias(a) => (TYPE_ALIAS, TYPE, hir[a].name_pos),
            Decl::Enum(e) if hir[e].flags.contains(Flags::CONST) => {
                (CONST_ENUM, (VALUE | TYPE) & !CONST_ENUM, hir[e].name_pos)
            }
            Decl::Enum(e) => (
                REGULAR_ENUM,
                (VALUE | TYPE) & !(REGULAR_ENUM | VALUE_MODULE),
                hir[e].name_pos,
            ),
            Decl::EnumMember(m) => (ENUM_MEMBER, VALUE | TYPE, hir[m].pos),
            Decl::Module(m) if !matches!(hir[m].name, ModuleName::Ident(_)) => return None,
            // `declareModuleSymbol`
            Decl::Module(m)
                if self.bound(file).module_instance_state[m.idx()]
                    != ModuleInstanceState::NonInstantiated =>
            {
                (
                    VALUE_MODULE,
                    VALUE & !(FUNCTION | CLASS | REGULAR_ENUM | VALUE_MODULE),
                    hir[m].name_pos,
                )
            }
            Decl::Module(m) => (NAMESPACE_MODULE, 0, hir[m].name_pos),
            Decl::TypeParam(p) => (TYPE_PARAMETER, TYPE & !TYPE_PARAMETER, hir[p].pos),
            Decl::ImportDefault(i) => (ALIAS, ALIAS, hir[i].default_pos),
            Decl::ImportNamespace(i) => (ALIAS, ALIAS, hir[i].namespace_pos),
            Decl::ImportSpec(s) => (ALIAS, ALIAS, hir[s].pos),
            Decl::ImportEquals(i) => (ALIAS, ALIAS, hir[i].name_pos),
            // `bindVariableDeclarationOrBindingElement`
            Decl::Require(pat) => (ALIAS, ALIAS, hir[pat].pos),
            // `bindNamespaceExportDeclaration`
            Decl::UmdGlobal(stmt) => (
                ALIAS,
                ALIAS,
                start_after_tokens(&hir.text, hir[stmt].pos, &[b"export", b"as", b"namespace"])?,
            ),
            _ => return None,
        })
    }

    /// `getAdjustedNodeForError`: the start of the name of `decl`, or of `decl` itself if it has no name.
    pub(super) fn declaration_name_start(&self, file: FileId, decl: Decl) -> Option<u32> {
        let hir = self.hir(file);
        match decl {
            // The name of `export { a as b }` is `b`.
            Decl::ExportSpec(spec) => Some(hir[spec].pos),
            Decl::ExportStarAs(stmt) => match hir[stmt].kind {
                StmtKind::ExportStar { alias_pos, .. } => Some(alias_pos),
                _ => None,
            },
            // `GetNonAssignedNameOfDeclaration`: the name of `export default a` and `export = a` is `a`.
            Decl::ExportExpr(stmt) => match hir[stmt].kind {
                StmtKind::ExportDefault(e) | StmtKind::ExportAssign(e)
                    if matches!(hir[e].kind, ExprKind::Ident(_)) =>
                {
                    Some(hir[e].pos)
                }
                _ => Some(hir[stmt].pos),
            },
            _ => self
                .declaration_flags(file, decl)
                .map(|(_, _, start)| start),
        }
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
        // `symbolToString(source)`
        let name = if self.explains {
            self.symbol_to_string(named)
        } else {
            String::new()
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
                    let at = (start, end);
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

    /// The declarations of `sym`, the files one after the other as `mergeSymbol` puts them together. What is said about `file` is kept.
    fn check_declarations_of(&mut self, file: FileId, sym: Sym, out: &mut Vec<Diagnostic>) {
        let files = self.files();
        let parts = files.every_part(sym);
        if parts.len() == 1 && files.symbol(sym).decls.len() < 2 {
            return;
        }
        // What the files so far have come to.
        let mut target_flags = 0;
        let mut target: Vec<Declaration> = Vec::new();
        let mut source: Vec<Declaration> = Vec::new();
        for &part in parts.iter() {
            // What the file makes of the name, and `getExcludedSymbolFlags` of that.
            let (mut flags, mut excluded) = (0, 0);
            source.clear();
            for &decl in &files.symbol(part).decls {
                let (includes, excludes) =
                    if matches!(decl, Decl::ExportSpec(_) | Decl::ExportStarAs(_)) {
                        (ALIAS, ALIAS)
                    } else {
                        match self.declaration_flags(part.file, decl) {
                            Some((includes, excludes, _)) => (includes, excludes),
                            None => continue,
                        }
                    };
                let own = files.bound(part.file).symbol_of_declaration(decl);
                let is_own = own.is_none() || own == part.id;
                if is_own {
                    flags |= includes;
                    excluded |= excludes;
                }
                source.push((part.file, decl, is_own));
            }
            if source.is_empty() {
                continue;
            }
            if target_flags & excluded == 0 {
                target_flags |= flags;
                target.extend_from_slice(&source);
                continue;
            }
            if target_flags & NAMESPACE_MODULE != 0 {
                // What does not go with a namespace without values has words of its own, said once.
                self.report_declarations(file, source[..1].iter(), 2649, out);
                let (of, decl, _) = source[0];
                if of == file
                    && let Some(start) = self.declaration_name_start(of, decl)
                {
                    self.explain(start, 2649, |c| vec![c.symbol_to_string(sym)]);
                }
            } else {
                // The code depends on whether either symbol is an enum or block scoped.
                self.report_merge_symbol_error(
                    file,
                    &target,
                    &source,
                    sym,
                    code_of_refusal(target_flags | flags, 0),
                    out,
                );
            }
            // The two stay apart.
            self.check_declarations_that_merged(file, &source, out);
        }
        self.check_declarations_that_merged(file, &target, out);
    }

    /// Of the declarations of one symbol.
    fn check_declarations_that_merged(
        &mut self,
        file: FileId,
        decls: &[Declaration],
        out: &mut Vec<Diagnostic>,
    ) {
        if decls.len() > 1 {
            self.check_what_merges(file, decls, out);
            self.check_merged_members(file, decls, out);
        }
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

    /// `mergeSymbol`: reports the pairs of symbols that `Files::merge` refused to merge. The target is an alias, an export reached
    /// through `export *`, or an export of a pattern ambient module.
    fn check_refused_merges(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let files = self.files();
        let declarations = |sym: Sym| -> Vec<Declaration> {
            files
                .decls(sym)
                .into_iter()
                .map(|(of, decl)| (of, decl, true))
                .collect()
        };
        let is_declared_here = |sym: Sym| files.parts(sym).iter().any(|part| part.file == file);
        for &(target, source) in &files.refused_merges {
            let (target, source) = (files.canonical(target), files.canonical(source));
            if !is_declared_here(target) && !is_declared_here(source) {
                continue;
            }
            let added = declarations(source);
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
            self.report_merge_symbol_error(file, &declarations(target), &added, source, code, out);
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
    fn check_what_merges(
        &mut self,
        file: FileId,
        decls: &[Declaration],
        out: &mut Vec<Diagnostic>,
    ) {
        if !decls
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
                Some((of, self.hir(of)[c].pos))
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

    /// What a member makes of its name and what that does not go with.
    fn what_a_member_declares(member: &Member) -> Option<(u32, u32)> {
        Some(match member.kind {
            MemberKind::Property if member.flags.contains(Flags::ACCESSOR) => {
                (ACCESSOR, VALUE & !PROPERTY)
            }
            MemberKind::Property => (PROPERTY, VALUE & !(PROPERTY | ACCESSOR)),
            MemberKind::Method => (METHOD, VALUE & !METHOD),
            MemberKind::Getter => (GET_ACCESSOR, VALUE & !(SET_ACCESSOR | PROPERTY)),
            MemberKind::Setter => (SET_ACCESSOR, VALUE & !(GET_ACCESSOR | PROPERTY)),
            _ => return None,
        })
    }

    /// The declarations of a class or an interface that are one symbol share one table of members, and what is static in a class shares
    /// one with what a namespace that is one with it exports. What each declaration has by itself: `check_members_of`.
    fn check_merged_members(
        &mut self,
        file: FileId,
        decls: &[Declaration],
        out: &mut Vec<Diagnostic>,
    ) {
        // The members, and of a class where its name is. What is only listed with the symbol has its members elsewhere.
        let lists: Vec<(FileId, Span<MemberId>, Option<u32>)> = decls
            .iter()
            .filter(|d| d.2)
            .filter_map(|&(of, decl, _)| match decl {
                Decl::Class(c) => {
                    Some((of, self.hir(of)[c].members, Some(self.hir(of)[c].name_pos)))
                }
                Decl::Interface(i) => Some((of, self.hir(of)[i].members, None)),
                _ => None,
            })
            .collect();
        if lists.is_empty() {
            return;
        }
        if lists.len() > 1 {
            #[derive(Default)]
            struct Entry {
                flags: u32,
                /// Which declaration, in which file, and where.
                accepted: Vec<(usize, FileId, u32)>,
            }
            // Which declaration, in which file, the name, what it makes of the name, what that excludes, where.
            let mut declared: Vec<(usize, FileId, Atom, u32, u32, u32)> = Vec::new();
            for (at, &(of, members, _)) in lists.iter().enumerate() {
                let hir = self.hir(of);
                for m in members.iter() {
                    let member = &hir[m];
                    // `bindParameter`
                    if member.kind == MemberKind::Constructor {
                        for p in hir[member.func].params.iter() {
                            if hir[p].flags.contains(Flags::PARAMETER_PROPERTY)
                                && let PatKind::Ident(name) = hir[hir[p].pat].kind
                            {
                                declared.push((
                                    at,
                                    of,
                                    name,
                                    PROPERTY,
                                    VALUE & !(PROPERTY | ACCESSOR),
                                    hir[hir[p].pat].pos,
                                ));
                            }
                        }
                        continue;
                    }
                    if member.flags.contains(Flags::STATIC) {
                        continue;
                    }
                    let Some((includes, excludes)) = Self::what_a_member_declares(member) else {
                        continue;
                    };
                    let Some(name) = self.declared_member_name(of, member.key) else {
                        continue;
                    };
                    declared.push((at, of, name, includes, excludes, member.pos));
                }
            }
            let names: Vec<Atom> = declared.iter().map(|d| d.2).collect();
            // What is declared once has nothing to clash with.
            let repeated = number_repeated(&names);
            // One for each of `repeated`: what the files so far have come to.
            let none = || Vec::from_iter((0..repeated.len()).map(|_| Entry::default()));
            let mut entries: Vec<Entry> = none();
            // What one file declares is one symbol to the binder, with one table of members.
            for of_one_file in declared.chunk_by(|a, b| a.1 == b.1) {
                let mut own: Vec<Entry> = none();
                for &(at, of, name, includes, excludes, pos) in of_one_file {
                    let Some(&index) = repeated.get(&name) else {
                        continue;
                    };
                    let entry = &mut own[index];
                    if entry.flags & excludes == 0 {
                        entry.flags |= includes;
                        entry.accepted.push((at, of, pos));
                        continue;
                    }
                    // Within one declaration it has been said.
                    if !entry.accepted.iter().all(|a| a.0 == at) {
                        for &(_, other, start) in
                            entry.accepted.iter().chain(std::iter::once(&(at, of, pos)))
                        {
                            if other == file {
                                out.push(Diagnostic { start, code: 2300 });
                                self.note_duplicate_name(file, start, start);
                            }
                        }
                    }
                    // After an accessor met something else, nothing goes with it any more.
                    if entry.flags & ACCESSOR != 0 && entry.flags & ACCESSOR != includes & ACCESSOR
                    {
                        entry.flags |= ACCESSOR;
                    }
                }
                // `mergeSymbolTable`
                for (target, source) in entries.iter_mut().zip(own) {
                    if target.flags & excluded_by_member_flags(source.flags) == 0 {
                        target.flags |= source.flags;
                        target.accepted.extend(source.accepted);
                        continue;
                    }
                    // `reportMergeSymbolError`. `symbolToString(source)`: as its first declaration writes it.
                    let (_, named_in, named_at) = source.accepted[0];
                    let named_to = self.end_of_name_at(named_in, named_at);
                    let name = self.source_text(named_in, named_at, named_to);
                    for (symbol, other) in [
                        (&source.accepted, &target.accepted),
                        (&target.accepted, &source.accepted),
                    ] {
                        if self.is_plain_js(symbol[0].1) {
                            continue;
                        }
                        for &(_, of, start) in symbol {
                            if of != file {
                                continue;
                            }
                            let others = other
                                .iter()
                                .map(|&(_, of, at)| (of, at, self.end_of_name_at(of, at).max(at)));
                            let at = (start, self.end_of_name_at(file, start));
                            self.add_duplicate_declaration_error(
                                file, at, others, &name, 2300, out,
                            );
                        }
                    }
                }
            }
        }
        let namespace = decls.iter().find_map(|&(of, decl, is_own)| match decl {
            Decl::Module(m) if is_own && self.bound(of).module_symbol[m.idx()].is_some() => {
                Some(self.files().sym(of, self.bound(of).module_symbol[m.idx()]))
            }
            _ => None,
        });
        let Some(namespace) = namespace else { return };
        // `bindClassLikeDeclaration`: every class has a static `prototype`, a property nobody declared. It takes the place of what a
        // namespace written before the class exports under that name, whatever that is, and the first declaration of it is told.
        if let Some(exported) = self.files().export(namespace, known::prototype) {
            let theirs = self.files().decls(self.files().canonical(exported));
            for &(of, _, class_name) in &lists {
                let Some(class_name) = class_name else {
                    continue;
                };
                let mut is_told = false;
                for &(other, decl) in &theirs {
                    let Some((includes, _, start)) = self.declaration_flags(other, decl) else {
                        continue;
                    };
                    let is_spared = if other == of && start < class_name {
                        std::mem::replace(&mut is_told, true)
                    } else {
                        includes & VALUE == 0
                    };
                    if !is_spared && other == file {
                        out.push(Diagnostic { start, code: 2300 });
                    }
                }
            }
        }
        let mut clash =
            |c: &mut Self, name: Atom, includes: u32, excludes: u32, at: (FileId, u32)| {
                let Some(exported) = c.files().export(namespace, name) else {
                    return;
                };
                for (of, decl) in c.files().decls(c.files().canonical(exported)) {
                    let Some((theirs, they_exclude, start)) = c.declaration_flags(of, decl) else {
                        continue;
                    };
                    if theirs & excludes == 0 && includes & they_exclude == 0 {
                        continue;
                    }
                    // Between files it is `mergeSymbol` that refuses, and says where the other is.
                    if of != at.0 {
                        let written = c.atom_text(name);
                        let exported_at = c.place_of_token(of, start);
                        let member_at = (at.0, at.1, c.end_of_name_at(at.0, at.1).max(at.1));
                        for (here, other) in [(exported_at, member_at), (member_at, exported_at)] {
                            if here.0 == file {
                                c.add_duplicate_declaration_error(
                                    file,
                                    (here.1, here.2),
                                    std::iter::once(other),
                                    &written,
                                    2300,
                                    out,
                                );
                            }
                        }
                        continue;
                    }
                    if of == file {
                        out.push(Diagnostic { start, code: 2300 });
                    }
                    if at.0 == file {
                        out.push(Diagnostic {
                            start: at.1,
                            code: 2300,
                        });
                        c.note_duplicate_name(file, at.1, at.1);
                    }
                }
            };
        for &(of, members, class_name) in &lists {
            if class_name.is_none() {
                continue;
            }
            for m in members.iter() {
                let member = self.hir(of)[m];
                if !member.flags.contains(Flags::STATIC) {
                    continue;
                }
                let Some((includes, excludes)) = Self::what_a_member_declares(&member) else {
                    continue;
                };
                let Some(name) = self.declared_member_name(of, member.key) else {
                    continue;
                };
                clash(self, name, includes, excludes, (of, member.pos));
            }
        }
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
        for c in 0..hir.classes.len() {
            let is_ambient =
                hir.classes[c].flags.contains(Flags::AMBIENT) || hir.kind == FileKind::Declaration;
            self.check_members_of(file, hir.classes[c].members, is_ambient, out);
        }
        for i in 0..hir.interfaces.len() {
            self.check_members_of(file, hir.interfaces[i].members, true, out);
        }
        for t in 0..hir.types.len() {
            if let TypeNodeKind::Object(members) = hir.types[t].kind {
                self.check_members_of(file, members, true, out);
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
                        start: member.pos,
                        code: 2699,
                    });
                    self.explain_static_name_conflict(file, m, name);
                }
            }
        }
    }

    /// The arguments of 2699, which is reported on the name of the static member `m`: `name`, and the class.
    fn explain_static_name_conflict(&mut self, file: FileId, m: MemberId, name: Atom) {
        let start = self.hir(file)[m].pos;
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

    /// `declareSymbolEx`, `lateBindMember`, `combineSymbolTables`, as far as they report: 2300 at what the symbol of a name refuses
    /// and at all that symbol has by then. `late_bound`: where those of `declared` are whose names the checker works out. The
    /// answer: the names that are declared more than once, each with its place in the list of what became of them. `None`: there
    /// is none.
    fn report_refused_members(
        &mut self,
        file: FileId,
        declared: &[DeclaredName],
        late_bound: &[u32],
        out: &mut Vec<Diagnostic>,
    ) -> Option<(FxHashMap<(Atom, bool), usize>, Vec<MembersOfName>)> {
        let mut keys: SmallVec<[(Atom, bool); 16]> = declared.iter().map(|d| (d.0, d.1)).collect();
        // `bindClassLikeDeclaration`: every class has a static `prototype`, a property nobody declared.
        const PROTOTYPE: (Atom, bool) = (known::prototype, true);
        if keys.contains(&PROTOTYPE) {
            keys.push(PROTOTYPE);
        }
        // What is declared once has nothing to clash with.
        let repeated = number_repeated(&keys);
        if repeated.is_empty() {
            return None;
        }
        // One for each of `repeated`.
        let mut entries: Vec<MembersOfName> = (0..repeated.len())
            .map(|_| MembersOfName {
                flags: 0,
                accepted: Vec::new(),
                all: Vec::new(),
                state: 0,
            })
            .collect();
        if let Some(&at) = repeated.get(&PROTOTYPE) {
            entries[at].flags = PROPERTY;
        }
        for &(name, is_static, includes, excludes, pos, _) in declared {
            let Some(&at) = repeated.get(&(name, is_static)) else {
                continue;
            };
            let entry = &mut entries[at];
            entry.all.push(pos);
            if entry.flags & excludes == 0 {
                entry.flags |= includes;
                entry.accepted.push(pos);
                continue;
            }
            let late_before = entry
                .accepted
                .iter()
                .copied()
                .find(|at| late_bound.contains(at));
            // `combineSymbolTables`: what the binder names is one symbol, what is bound late another. Where the first of the latter is.
            let merged_with_late = match (late_before, late_bound.contains(&pos)) {
                (Some(first), false) => Some(first),
                (None, true) => Some(pos),
                _ => None,
            };
            for &start in entry.accepted.iter().chain(std::iter::once(&pos)) {
                // `reportMergeSymbolError`: `symbolToString` of the symbol that is bound late.
                if let Some(named_at) = merged_with_late {
                    let name =
                        self.source_text(file, named_at, self.end_of_name_at(file, named_at));
                    let is_late = late_bound.contains(&start);
                    let others = entry
                        .accepted
                        .iter()
                        .chain(std::iter::once(&pos))
                        .filter(|&other| late_bound.contains(other) != is_late)
                        .map(|&other| (file, other, self.end_of_name_at(file, other)));
                    let at = (start, self.end_of_name_at(file, start));
                    self.add_duplicate_declaration_error(file, at, others, &name, 2300, out);
                    continue;
                }
                out.push(Diagnostic { start, code: 2300 });
                match late_before {
                    // The binder names each as it is written.
                    None => self.note_duplicate_name(file, start, start),
                    // `lateBindMember`
                    Some(_) if !self.files().atoms.is_symbol_name(name) => {
                        let end = self.end_of_name_at(file, start);
                        self.note(start, end, 2300, vec![self.atom_text(name)]);
                    }
                    Some(_) => self.note_duplicate_name(file, start, pos),
                }
            }
            // After an accessor met something else, nothing goes with it any more.
            if entry.flags & ACCESSOR != 0 && entry.flags & ACCESSOR != includes & ACCESSOR {
                entry.flags |= ACCESSOR;
            }
        }
        Some((repeated, entries))
    }

    /// The same for the members `props` of an object literal.
    pub(super) fn report_refused_members_of_object_literal(
        &mut self,
        file: FileId,
        props: Span<PropId>,
        out: &mut Vec<Diagnostic>,
    ) {
        let hir = self.hir(file);
        let mut declared: SmallVec<[DeclaredName; 16]> = SmallVec::new();
        let mut late_bound: Vec<u32> = Vec::new();
        for p in props.iter() {
            let prop = &hir[p];
            let (includes, excludes) = match prop.kind {
                PropKind::Init | PropKind::Shorthand => (PROPERTY, VALUE & !(PROPERTY | ACCESSOR)),
                // `IsObjectLiteralMethod`: it goes with nothing, not even another.
                PropKind::Method => (METHOD, VALUE),
                PropKind::Getter => (GET_ACCESSOR, VALUE & !(SET_ACCESSOR | PROPERTY)),
                PropKind::Setter => (SET_ACCESSOR, VALUE & !(GET_ACCESSOR | PROPERTY)),
                PropKind::Spread => continue,
            };
            let Some(name) = self.declared_member_name(file, prop.key) else {
                continue;
            };
            if matches!(prop.key, PropKey::Computed(_)) {
                late_bound.push(prop.pos);
            }
            declared.push((name, false, includes, excludes, prop.pos, 0));
        }
        self.report_refused_members(file, &declared, &late_bound, out);
    }

    fn check_members_of(
        &mut self,
        file: FileId,
        members: Span<MemberId>,
        is_ambient: bool,
        out: &mut Vec<Diagnostic>,
    ) {
        let hir = self.hir(file);
        // One member has nothing to clash with, unless it declares more than itself, or is static as the `prototype` of every class is.
        if members.len() < 2
            && !members.iter().any(|m| {
                hir[m].kind == MemberKind::Constructor || hir[m].flags.contains(Flags::STATIC)
            })
        {
            return;
        }
        let mut declared: SmallVec<[DeclaredName; 16]> = SmallVec::new();
        // Where those are whose names the checker works out (`lateBindMember`).
        let mut late_bound: Vec<u32> = Vec::new();
        for m in members.iter() {
            let member = &hir[m];
            let is_static = member.flags.contains(Flags::STATIC);
            let (includes, excludes, kind) = match member.kind {
                MemberKind::Property if member.flags.contains(Flags::ACCESSOR) => {
                    (ACCESSOR, VALUE & !PROPERTY, 2)
                }
                MemberKind::Property => (PROPERTY, VALUE & !(PROPERTY | ACCESSOR), 1),
                MemberKind::Method => (METHOD, VALUE & !METHOD, 0),
                MemberKind::Getter => (GET_ACCESSOR, VALUE & !(SET_ACCESSOR | PROPERTY), 2),
                MemberKind::Setter => (SET_ACCESSOR, VALUE & !(GET_ACCESSOR | PROPERTY), 2),
                MemberKind::Constructor => {
                    for p in hir[member.func].params.iter() {
                        if hir[p].flags.contains(Flags::PARAMETER_PROPERTY)
                            && let PatKind::Ident(name) = hir[hir[p].pat].kind
                        {
                            declared.push((
                                name,
                                false,
                                PROPERTY,
                                VALUE & !(PROPERTY | ACCESSOR),
                                hir[hir[p].pat].pos,
                                1,
                            ));
                        }
                    }
                    continue;
                }
                _ => continue,
            };
            let Some(name) = self.declared_member_name(file, member.key) else {
                continue;
            };
            if !is_ambient && is_static && name == known::prototype {
                out.push(Diagnostic {
                    start: member.pos,
                    code: 2699,
                });
                self.explain_static_name_conflict(file, m, name);
            }
            if matches!(member.key, PropKey::Computed(_)) {
                late_bound.push(member.pos);
            }
            declared.push((name, is_static, includes, excludes, member.pos, kind));
        }
        let Some((repeated, mut entries)) =
            self.report_refused_members(file, &declared, &late_bound, out)
        else {
            return;
        };
        // Two properties, or a property and an accessor.
        for &(name, is_static, _, _, pos, kind) in &declared {
            if kind == 0 {
                continue;
            }
            let Some(&at) = repeated.get(&(name, is_static)) else {
                continue;
            };
            let entry = &mut entries[at];
            if entry.accepted.len() < 2 || !entry.accepted.contains(&pos) {
                continue;
            }
            match entry.state {
                0 => entry.state = kind,
                1 | 2 if entry.state == 1 || kind != 2 => {
                    for &start in &entry.all {
                        out.push(Diagnostic { start, code: 2300 });
                        // `symbolToString`: as the first declaration of the symbol writes it. Those the binder names come first.
                        let named_at = if entry.accepted.contains(&start) {
                            entry
                                .accepted
                                .iter()
                                .copied()
                                .find(|at| !late_bound.contains(at))
                                .unwrap_or(entry.accepted[0])
                        } else {
                            start
                        };
                        self.note_duplicate_name(file, start, named_at);
                    }
                    // `reportDuplicateMemberErrors`: a parameter property with the name is reported even if the duplicates are static.
                    if is_static {
                        let constructors = members
                            .iter()
                            .filter(|&m| hir[m].kind == MemberKind::Constructor);
                        for p in constructors.flat_map(|m| hir[hir[m].func].params.iter()) {
                            if hir[p].flags.contains(Flags::PARAMETER_PROPERTY)
                                && matches!(hir[hir[p].pat].kind, PatKind::Ident(n) if n == name)
                            {
                                out.push(Diagnostic {
                                    start: hir[hir[p].pat].pos,
                                    code: 2300,
                                });
                            }
                        }
                    }
                    entry.state = 3;
                }
                _ => {}
            }
        }
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
