//! One name declared twice in ways that do not go together: 2300 2451 2528 2567 2649 2699. And what goes together in some ways only:
//! 2323 2433 2434 2484 2813 2814.
//!
//! In TypeScript 7.0.2 this is spread over `declareSymbolEx` and `declareModuleMember` of binder.go, which refuse a declaration that
//! what is in the table excludes, `mergeSymbol` of checker.go, which does the same between files,
//! `checkObjectTypeForDuplicateDeclarations` and `checkTypeParameters`. The binder here says nothing of it, so the declarations are
//! put in tables again.

use super::errors::Diagnostic;
use super::*;
use crate::bind::{ClassOwner, Decl, PatParent, ScopeId, ScopeKind, SymbolId};

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
        self.check_locals_of_bodies(file, out);
        self.check_refused_merges(file, out);
        self.check_duplicate_umd_globals(file, out);
        self.check_duplicate_members(file, out);
        self.check_static_property_name_conflicts(file, out);
        self.check_exported_twice(file, out);
        self.check_redeclared_exports(file, out);
        self.check_redeclared_namespace_exports(file, out);
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
            Decl::Module(m) if self.is_instantiated_module(file, m) => (
                VALUE_MODULE,
                VALUE & !(FUNCTION | CLASS | REGULAR_ENUM | VALUE_MODULE),
                hir[m].name_pos,
            ),
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

    /// `getModuleInstanceState(m) != NonInstantiated`, as the binder found it.
    fn is_instantiated_module(&self, file: FileId, m: ModuleId) -> bool {
        self.bound(file).module_instantiated[m.idx()]
    }

    /// `ModuleInstanceStateConstEnumOnly`, of a namespace that is instantiated: nothing in it is more of a value than a `const enum`.
    fn is_const_enum_only_module(&self, file: FileId, m: ModuleId) -> bool {
        let hir = self.hir(file);
        hir[m].has_body
            && hir.ids(hir[m].body).all(|s| match hir[s].kind {
                StmtKind::Interface(_) | StmtKind::TypeAlias(_) | StmtKind::Import(_) => true,
                StmtKind::Enum(e) => hir[e].flags.contains(Flags::CONST),
                StmtKind::ImportEquals(i) => !hir[i].flags.contains(Flags::EXPORT),
                StmtKind::Module(inner) => {
                    !self.is_instantiated_module(file, inner)
                        || self.is_const_enum_only_module(file, inner)
                }
                _ => false,
            })
    }

    /// The modifiers `decl` is written with, or is under.
    fn modifiers_of_declaration(&self, file: FileId, decl: Decl) -> Flags {
        let (hir, bound) = (self.hir(file), self.bound(file));
        match decl {
            Decl::Var(pat) => {
                let mut root = pat;
                loop {
                    match bound.pat_parent[root.idx()] {
                        PatParent::Prop(outer, _) | PatParent::Elem(outer, _) => root = outer,
                        PatParent::Var(d) => return hir[d].flags,
                        _ => return Flags::empty(),
                    }
                }
            }
            Decl::Fn(f) => hir[f].flags,
            Decl::Class(c) => hir[c].flags,
            Decl::Interface(i) => hir[i].flags,
            Decl::Alias(a) => hir[a].flags,
            Decl::Enum(e) => hir[e].flags,
            Decl::Module(m) => hir[m].flags,
            Decl::ImportEquals(i) => hir[i].flags,
            _ => Flags::empty(),
        }
    }

    /// `declareModuleMember`: whether the declaration of `part` whose name is at `pos` is put among the exports of the module, namespace
    /// or enum it is written in. `None`: it is written where nothing is exported.
    fn is_declared_among_exports(
        &self,
        part: Sym,
        includes: u32,
        pos: u32,
        modifiers: Flags,
    ) -> Option<bool> {
        let (hir, bound) = (self.hir(part.file), self.bound(part.file));
        let container = bound.symbols[part.id.idx()].parent;
        if container.is_none() {
            return None;
        }
        // Of the imports only `import a = b` can be exported, by saying so.
        if includes == ALIAS {
            return Some(modifiers.contains(Flags::EXPORT));
        }
        if includes == ENUM_MEMBER || modifiers.contains(Flags::EXPORT) {
            return Some(true);
        }
        // The bodies of a namespace follow one another: it is in the last that starts before it.
        let mut body: Option<ModuleId> = None;
        let mut is_in_file = false;
        for &d in &bound.symbols[container.idx()].decls {
            match d {
                Decl::Module(m)
                    if hir[m].name_pos < pos
                        && body.is_none_or(|b| hir[b].name_pos < hir[m].name_pos) =>
                {
                    body = Some(m)
                }
                Decl::File => is_in_file = true,
                _ => {}
            }
        }
        let in_declaration_file = hir.kind == FileKind::Declaration;
        let (list, is_ambient) = match body {
            Some(m) => (
                hir[m].body,
                in_declaration_file || hir[m].flags.contains(Flags::AMBIENT),
            ),
            None if is_in_file => (hir.body, in_declaration_file),
            None => return None,
        };
        // `setExportContextFlag`
        Some(is_ambient && !has_export_declarations(hir, list))
    }

    /// `getAdjustedNodeForError`: the start of the name of `decl`, or of `decl` itself if it has no name.
    fn declaration_name_start(&self, file: FileId, decl: Decl) -> Option<u32> {
        let hir = self.hir(file);
        match decl {
            // The name of `export { a as b }` is `b`.
            Decl::ExportSpec(spec) => Some(hir[spec].pos),
            Decl::ExportStarAs(stmt) => namespace_export_starts(hir, stmt).map(|(_, name)| name),
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
            }
        }
    }

    /// `reportMergeSymbolError`: reports `code` at every declaration of both symbols. Skips a symbol whose first declaration is in a
    /// plain JavaScript file.
    fn report_merge_symbol_error(
        &self,
        file: FileId,
        target: &[Declaration],
        source: &[Declaration],
        code: u32,
        out: &mut Vec<Diagnostic>,
    ) {
        for symbol in [source, target] {
            if symbol
                .first()
                .is_some_and(|first| !self.is_plain_js(first.0))
            {
                self.report_declarations(file, symbol.iter(), code, out);
            }
        }
    }

    /// The declarations of `sym`: those of each file as `declareSymbolEx` puts them in a table, then the files one after the other as
    /// `mergeSymbol` puts them together. What is said about `file` is kept.
    fn check_declarations_of(&mut self, file: FileId, sym: Sym, out: &mut Vec<Diagnostic>) {
        let files = self.files();
        let parts = files.parts(sym);
        if parts.len() == 1 && files.symbol(sym).decls.len() < 2 {
            return;
        }
        // The `declare global` blocks of a file are one namespace to the binder.
        let is_in_global_block = |part: Sym| {
            let bound = files.bound(part.file);
            bound
                .global_augmentations
                .contains(&bound.symbols[part.id.idx()].parent)
        };
        // What the files so far have come to.
        let mut target_flags = 0;
        let mut target: Vec<Declaration> = Vec::new();
        let mut source: Vec<Declaration> = Vec::new();
        let mut from = 0;
        while from < parts.len() {
            let first = parts[from];
            let more = parts[from + 1..]
                .iter()
                .take_while(|&&part| {
                    part.file == first.file && is_in_global_block(first) && is_in_global_block(part)
                })
                .count();
            // What the file makes of the name, and `getExcludedSymbolFlags` of that.
            let (mut flags, mut excluded) = (0, 0);
            source.clear();
            for &part in &parts[from..=from + more] {
                for &decl in &files.symbol(part).decls {
                    let (includes, excludes) =
                        if matches!(decl, Decl::ExportSpec(_) | Decl::ExportStarAs(_)) {
                            // `declareModuleMember`, `bindExportDeclaration`: an alias that is always declared among the exports.
                            (ALIAS, ALIAS)
                        } else {
                            let Some((includes, excludes, pos)) =
                                self.declaration_flags(part.file, decl)
                            else {
                                continue;
                            };
                            // Of a module or a namespace this is the table of exports. Its locals: `check_locals_of_bodies`. What is
                            // exported as the default goes by that name: `check_redeclared_exports`.
                            let modifiers = self.modifiers_of_declaration(part.file, decl);
                            if let Some(is_exported) =
                                self.is_declared_among_exports(part, includes, pos, modifiers)
                                && (!is_exported || modifiers.contains(Flags::DEFAULT))
                            {
                                continue;
                            }
                            (includes, excludes)
                        };
                    let this = (part.file, decl, true);
                    if flags & excludes == 0 {
                        flags |= includes;
                        excluded |= excludes;
                        source.push(this);
                        continue;
                    }
                    // What is refused gets a symbol of its own, which is not in the table.
                    self.report_declarations(
                        file,
                        source.iter().chain(std::iter::once(&this)),
                        code_of_refusal(flags, includes),
                        out,
                    );
                }
            }
            from += more + 1;
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

    /// `declareModuleMember`: the locals of each body of a module or a namespace. What is exported leaves no more than a mark there, which
    /// goes with everything, but is itself held against what is there.
    fn check_locals_of_bodies(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let in_declaration_file = hir.kind == FileKind::Declaration;
        let whole = self
            .files()
            .module(file)
            .is_module()
            .then_some((hir.body, in_declaration_file));
        let bodies = hir
            .modules
            .iter()
            .enumerate()
            .filter(|&(i, _)| bound.module_symbol[i].is_some())
            .map(|(_, m)| {
                (
                    m.body,
                    in_declaration_file || m.flags.contains(Flags::AMBIENT),
                )
            });
        let mut declared: Vec<(Atom, Decl, Flags)> = Vec::new();
        let mut accepted: Vec<Declaration> = Vec::new();
        for (list, is_ambient) in whole.into_iter().chain(bodies) {
            declared.clear();
            // `bindEachStatementFunctionsFirst`
            for functions in [true, false] {
                for s in hir.ids(list) {
                    if matches!(hir[s].kind, StmtKind::Fn(_)) == functions {
                        declared_by_statement(hir, s, false, &mut declared);
                    }
                }
            }
            // `setExportContextFlag`
            let is_export_context = is_ambient && !has_export_declarations(hir, list);
            // Those of one name next to each other, in the order they came.
            declared.sort_by_key(|d| d.0);
            let mut from = 0;
            while from < declared.len() {
                let to = from
                    + declared[from..]
                        .iter()
                        .take_while(|d| d.0 == declared[from].0)
                        .count();
                if to - from > 1 {
                    let mut flags = 0;
                    accepted.clear();
                    for &(_, decl, modifiers) in &declared[from..to] {
                        // `bindVariableDeclarationOrBindingElement`: a variable initialized to `require(..)` is an alias.
                        let decl = match decl {
                            Decl::Var(pat) if bound.required_by(hir, pat).is_some() => {
                                Decl::Require(pat)
                            }
                            _ => decl,
                        };
                        let Some((includes, excludes, _)) = self.declaration_flags(file, decl)
                        else {
                            continue;
                        };
                        let is_exported = includes != ALIAS
                            && (is_export_context || modifiers.contains(Flags::EXPORT));
                        // The mark is `SymbolFlagsExportValue` or nothing at all: no declaration excludes either.
                        let mark = if is_exported { 0 } else { includes };
                        if flags & excludes == 0 {
                            flags |= mark;
                            accepted.push((file, decl, !is_exported));
                            continue;
                        }
                        let code = if modifiers.contains(Flags::DEFAULT) {
                            2528
                        } else {
                            code_of_refusal(flags, mark)
                        };
                        self.report_declarations(
                            file,
                            accepted.iter().chain(std::iter::once(&(file, decl, true))),
                            code,
                            out,
                        );
                    }
                    self.check_declarations_that_merged(file, &accepted, out);
                }
                from = to;
            }
        }
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
        for &(target, source) in &files.refused_merges {
            let (target, source) = (files.canonical(target), files.canonical(source));
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
            let code = if either.contains(SymFlags::ENUM) {
                2567
            } else if either.contains(SymFlags::BLOCK_SCOPED_VARIABLE) {
                2451
            } else {
                2300
            };
            self.report_merge_symbol_error(file, &declarations(target), &added, code, out);
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
    fn check_what_merges(&self, file: FileId, decls: &[Declaration], out: &mut Vec<Diagnostic>) {
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
                    || !self.is_instantiated_module(of, m)
                {
                    continue;
                }
                // `isInstantiatedModule`
                if !keeps_const_enums && self.is_const_enum_only_module(of, m) {
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
            for &(of, decl, _) in decls {
                if of != file {
                    continue;
                }
                match decl {
                    Decl::Class(c) => {
                        let class = &self.hir(of)[c];
                        out.push(Diagnostic {
                            start: class.name_pos,
                            code: 2813,
                        });
                        // `symbol.Name`
                        let name = if class.flags.contains(Flags::DEFAULT) {
                            known::default
                        } else {
                            class.name
                        };
                        self.note(class.name_pos, 0, 2813, vec![self.atom_text(name)]);
                    }
                    Decl::Fn(f) => out.push(Diagnostic {
                        start: self.hir(of)[f].name_pos,
                        code: 2814,
                    }),
                    _ => {}
                }
            }
        }
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

    /// The name a member of a class, an interface or a type literal is declared under, if any. A computed name counts if the binder can
    /// read it (`IsDynamicName` says no) or it is written as a name, `a` or `a.b`, without parentheses or `#x` (`isLateBindableAST`).
    fn name_of_declared_member(&mut self, file: FileId, key: PropKey) -> Option<Atom> {
        if let PropKey::Computed(mut e) = key {
            let hir = self.hir(file);
            let is_in_parens = |e: ExprId| hir.parens.binary_search_by_key(&e.0, |p| p.0.0).is_ok();
            let is_literal = !is_in_parens(e)
                && match hir[e].kind {
                    ExprKind::String(_) | ExprKind::Number(_) => true,
                    ExprKind::Template { exprs, .. } => exprs.is_empty(),
                    ExprKind::Unary {
                        op: UnOp::Plus | UnOp::Minus,
                        operand,
                    } => matches!(hir[operand].kind, ExprKind::Number(_)) && !is_in_parens(operand),
                    _ => false,
                };
            while !is_literal {
                if is_in_parens(e) {
                    return None;
                }
                match hir[e].kind {
                    ExprKind::Ident(_) => break,
                    ExprKind::Dot { obj, name, .. }
                        if self.files().atoms.bytes(name).first() != Some(&b'#') =>
                    {
                        e = obj
                    }
                    _ => return None,
                }
            }
        }
        self.member_name(file, key)
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
            struct Entry {
                name: Atom,
                flags: u32,
                /// Which declaration, in which file, and where.
                accepted: Vec<(usize, FileId, u32)>,
            }
            let mut entries: Vec<Entry> = Vec::new();
            // Name, what it makes of the name, what that excludes, where.
            let mut declared: Vec<(Atom, u32, u32, u32)> = Vec::new();
            for (at, &(of, members, _)) in lists.iter().enumerate() {
                let hir = self.hir(of);
                declared.clear();
                for m in members.iter() {
                    let member = &hir[m];
                    // `bindParameter`
                    if member.kind == MemberKind::Constructor {
                        for p in hir[member.func].params.iter() {
                            if hir[p].flags.contains(Flags::PARAMETER_PROPERTY)
                                && let PatKind::Ident(name) = hir[hir[p].pat].kind
                            {
                                declared.push((
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
                    let Some(name) = self.name_of_declared_member(of, member.key) else {
                        continue;
                    };
                    declared.push((name, includes, excludes, member.pos));
                }
                for &(name, includes, excludes, pos) in &declared {
                    let Some(entry) = entries.iter_mut().find(|e| e.name == name) else {
                        entries.push(Entry {
                            name,
                            flags: includes,
                            accepted: vec![(at, of, pos)],
                        });
                        continue;
                    };
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
                let Some(name) = self.name_of_declared_member(of, member.key) else {
                    continue;
                };
                clash(self, name, includes, excludes, (of, member.pos));
            }
        }
    }

    /// One name in two `export { }`, `export * as` or `export import`, and `export =` twice: what a module exports has one entry for each.
    fn check_exported_twice(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let hir = self.hir(file);
        if hir.exports.is_empty()
            && !hir.stmts.iter().any(|s| {
                matches!(
                    s.kind,
                    StmtKind::ExportAssign(_) | StmtKind::ExportStar { .. }
                )
            })
        {
            return;
        }
        for body in std::iter::once(hir.body).chain(hir.modules.iter().map(|m| m.body)) {
            let mut names: Vec<(Atom, u32)> = Vec::new();
            // Where each `export =` is reported, and the statement if that is what it is reported on.
            let mut equals: Vec<(u32, StmtId)> = Vec::new();
            for s in hir.ids(body) {
                match hir[s].kind {
                    StmtKind::ExportNamed(x) => {
                        names.extend(
                            hir[x]
                                .items
                                .iter()
                                .filter(|&i| hir[i].exported != known::default)
                                .map(|i| (hir[i].exported, hir[i].pos)),
                        );
                    }
                    // `declareModuleMember`: an alias like the others.
                    StmtKind::ImportEquals(i) if hir[i].flags.contains(Flags::EXPORT) => {
                        names.push((hir[i].name, hir[i].name_pos))
                    }
                    // `bindExportDeclaration`
                    StmtKind::ExportStar { alias, .. }
                        if alias.is_some() && alias != known::default =>
                    {
                        names.extend(
                            namespace_export_starts(hir, s)
                                .map(|(_, name_start)| (alias, name_start)),
                        );
                    }
                    StmtKind::ExportAssign(e) => {
                        equals.push(if matches!(hir[e].kind, ExprKind::Ident(_)) {
                            (hir[e].pos, StmtId::NONE)
                        } else {
                            (hir[s].pos, s)
                        })
                    }
                    _ => {}
                }
            }
            if equals.len() > 1 {
                out.extend(
                    equals
                        .iter()
                        .map(|&(start, _)| Diagnostic { start, code: 2300 }),
                );
                for &(start, statement) in &equals {
                    let end = if statement.is_some() {
                        self.end_of_stmt(file, statement)
                    } else {
                        0
                    };
                    self.note(start, end, 2300, vec!["export=".to_owned()]);
                }
            }
            for (i, &(name, start)) in names.iter().enumerate() {
                if names
                    .iter()
                    .enumerate()
                    .any(|(j, other)| j != i && other.0 == name)
                {
                    out.push(Diagnostic { start, code: 2300 });
                }
            }
        }
    }

    /// `checkExternalModuleExports`: 2323, a module exports a name once, overloads, interfaces, namespaces and enums aside.
    /// And 2484 of `checkAliasSymbol`: `export { a }` next to an exported `a`.
    fn check_redeclared_exports(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        if !self.files().module(file).is_module() {
            return;
        }
        /// What an error on a declaration is reported on.
        #[derive(Copy, Clone)]
        enum Node {
            /// Its name or its first token.
            Token,
            Statement(StmtId),
            Specifier(ExportSpecId),
            /// `* as ns`: where `ns` is.
            NamespaceExport(u32),
        }
        struct Declared {
            name: Atom,
            /// Where an error on the declaration starts: at its name. An export specifier, `* as ns` and `export default e` are
            /// reported at their first token.
            start: u32,
            node: Node,
            includes: u32,
            excludes: u32,
            is_overload: bool,
            /// It is only declared.
            is_ambient: bool,
            /// `None` for `export default e`, `export { a }` and `export * as a`.
            decl: Option<Decl>,
            /// The specifier of an `export { a }` without `from`.
            specifier: Option<ExportSpecId>,
        }
        fn names_in(hir: &File, pat: PatId, into: &mut Vec<(Atom, PatId)>) {
            match hir[pat].kind {
                PatKind::Ident(name) => into.push((name, pat)),
                PatKind::Object(props) => {
                    props.iter().for_each(|p| names_in(hir, hir[p].value, into))
                }
                PatKind::Array(elems) => elems.iter().for_each(|e| names_in(hir, hir[e].pat, into)),
                _ => {}
            }
        }
        let hir = self.hir(file);
        let mut declared: Vec<Declared> = Vec::new();
        // What is declared without being exported.
        let mut locals: Vec<(Atom, u32)> = Vec::new();
        let mut names = Vec::new();
        for s in hir.ids(hir.body) {
            let mut add = |c: &Self,
                           name: Atom,
                           flags: Flags,
                           decl: Decl,
                           is_overload: bool,
                           unnamed: bool| {
                let Some((includes, excludes, start)) = c.declaration_flags(file, decl) else {
                    return;
                };
                if !flags.contains(Flags::EXPORT) {
                    locals.push((name, includes));
                    return;
                }
                declared.push(Declared {
                    name: if flags.contains(Flags::DEFAULT) {
                        known::default
                    } else {
                        name
                    },
                    start: if unnamed { hir[s].pos } else { start },
                    node: Node::Token,
                    includes,
                    excludes,
                    is_overload,
                    is_ambient: flags.contains(Flags::AMBIENT) || hir.kind == FileKind::Declaration,
                    decl: Some(decl),
                    specifier: None,
                });
            };
            match hir[s].kind {
                StmtKind::Var(decls) => {
                    for d in decls.iter() {
                        names.clear();
                        names_in(hir, hir[d].pat, &mut names);
                        for &(name, pat) in &names {
                            add(self, name, hir[d].flags, Decl::Var(pat), false, false);
                        }
                    }
                }
                StmtKind::Fn(f) => add(
                    self,
                    hir[f].name,
                    hir[f].flags,
                    Decl::Fn(f),
                    matches!(hir[f].body, FnBody::None),
                    hir[f].name.is_none(),
                ),
                StmtKind::Class(c) => add(
                    self,
                    hir[c].name,
                    hir[c].flags,
                    Decl::Class(c),
                    false,
                    hir[c].name.is_none(),
                ),
                StmtKind::Interface(i) => add(
                    self,
                    hir[i].name,
                    hir[i].flags,
                    Decl::Interface(i),
                    false,
                    false,
                ),
                StmtKind::TypeAlias(a) => add(
                    self,
                    hir[a].name,
                    hir[a].flags,
                    Decl::Alias(a),
                    false,
                    false,
                ),
                StmtKind::Enum(e) => {
                    add(self, hir[e].name, hir[e].flags, Decl::Enum(e), false, false)
                }
                StmtKind::Module(m) => {
                    if let ModuleName::Ident(name) = hir[m].name {
                        add(self, name, hir[m].flags, Decl::Module(m), false, false);
                    }
                }
                StmtKind::ExportDefault(e) => declared.push(Declared {
                    name: known::default,
                    start: hir[s].pos,
                    node: Node::Statement(s),
                    includes: if matches!(hir[e].kind, ExprKind::Ident(_) | ExprKind::Dot { .. }) {
                        ALIAS
                    } else {
                        PROPERTY
                    },
                    excludes: u32::MAX,
                    is_overload: false,
                    is_ambient: false,
                    decl: None,
                    specifier: None,
                }),
                StmtKind::ExportNamed(x) => {
                    for i in hir[x].items.iter() {
                        let from_here = hir[x].spec.is_none();
                        declared.push(Declared {
                            name: hir[i].exported,
                            start: export_specifier_start(hir, i),
                            node: Node::Specifier(i),
                            includes: ALIAS,
                            excludes: ALIAS,
                            is_overload: false,
                            is_ambient: false,
                            decl: None,
                            specifier: from_here.then_some(i),
                        });
                    }
                }
                // `bindExportDeclaration`: the declaration of `export * as ns` is the `* as ns` node.
                StmtKind::ExportStar { alias, .. } if alias.is_some() => {
                    if let Some((start, name_start)) = namespace_export_starts(hir, s) {
                        declared.push(Declared {
                            name: alias,
                            start,
                            node: Node::NamespaceExport(name_start),
                            includes: ALIAS,
                            excludes: ALIAS,
                            is_overload: false,
                            is_ambient: false,
                            decl: None,
                            specifier: None,
                        });
                    }
                }
                _ => {}
            }
        }
        // `bindEachStatementFunctionsFirst`
        declared.sort_by_key(|d| d.includes != FUNCTION);
        let mut done: Vec<Atom> = Vec::new();
        for i in 0..declared.len() {
            let name = declared[i].name;
            if done.contains(&name) {
                continue;
            }
            done.push(name);
            // What is refused is not in the table.
            let mut flags = 0;
            let mut accepted: Vec<&Declared> = Vec::new();
            for d in declared[i..].iter().filter(|d| d.name == name) {
                if flags & d.excludes == 0 {
                    flags |= d.includes;
                    accepted.push(d);
                }
            }
            if accepted.len() < 2 {
                continue;
            }
            // `checkFunctionOrConstructorSymbol` of the exported symbol: a function merges with a class only if the class is ambient.
            if flags & FUNCTION != 0
                && accepted
                    .iter()
                    .any(|d| d.includes == CLASS && !d.is_ambient)
            {
                for d in &accepted {
                    match d.includes {
                        CLASS => {
                            out.push(Diagnostic {
                                start: d.start,
                                code: 2813,
                            });
                            self.note(d.start, 0, 2813, vec![self.atom_text(name)]);
                        }
                        FUNCTION => out.push(Diagnostic {
                            start: d.start,
                            code: 2814,
                        }),
                        _ => {}
                    }
                }
            }
            // The defaults are one symbol, whatever each is called here.
            if name == known::default {
                let merged: Vec<Declaration> = accepted
                    .iter()
                    .filter_map(|d| d.decl.map(|decl| (file, decl, true)))
                    .collect();
                self.check_merged_members(file, &merged, out);
            }
            for d in &accepted {
                let Some(spec) = d.specifier else { continue };
                // The name is looked up among what is not exported first, and that is all it stands for if it is there.
                let local = hir[spec].local;
                let own = locals
                    .iter()
                    .filter(|l| l.0 == local)
                    .fold(0, |all, l| all | l.1);
                const NAMESPACE: u32 = VALUE_MODULE | NAMESPACE_MODULE | ENUM;
                let (is_value, is_type, is_namespace) = if own != 0 {
                    (own & VALUE != 0, own & TYPE != 0, own & NAMESPACE != 0)
                } else {
                    let all =
                        SymFlags::VALUE | SymFlags::TYPE | SymFlags::NAMESPACE | SymFlags::ALIAS;
                    let Some(target) = self
                        .files()
                        .resolve_name(file, ScopeId(0), local, all)
                        .and_then(|t| self.files().resolve_alias_if_needed(t))
                    else {
                        continue;
                    };
                    let target = self.files().flags(target);
                    (
                        target.intersects(SymFlags::VALUE),
                        target.intersects(SymFlags::TYPE),
                        target.intersects(SymFlags::NAMESPACE),
                    )
                };
                if flags & VALUE != 0 && is_value
                    || flags & TYPE != 0 && is_type
                    || flags & NAMESPACE != 0 && is_namespace
                {
                    out.push(Diagnostic {
                        start: d.start,
                        code: 2484,
                    });
                    let end = self.end_of_export_spec(file, spec);
                    self.note(d.start, end, 2484, vec![self.atom_text(name)]);
                }
            }
            if flags & (VALUE_MODULE | NAMESPACE_MODULE | ENUM) != 0 {
                continue;
            }
            let count = accepted
                .iter()
                .filter(|d| !d.is_overload && d.includes != INTERFACE)
                .count();
            if count < 2 || flags & TYPE_ALIAS != 0 && count <= 2 {
                continue;
            }
            out.extend(
                accepted
                    .iter()
                    .filter(|d| !d.is_overload)
                    .map(|d| Diagnostic {
                        start: d.start,
                        code: 2323,
                    }),
            );
            for d in accepted.iter().filter(|d| !d.is_overload) {
                let end = match d.node {
                    Node::Token => 0,
                    Node::Statement(s) => self.end_of_stmt(file, s),
                    Node::Specifier(spec) => self.end_of_export_spec(file, spec),
                    Node::NamespaceExport(name_start) => self.end_of_name_at(file, name_start),
                };
                self.note(d.start, end, 2323, vec![self.atom_text(name)]);
            }
        }
    }

    /// 2484 of `checkAliasSymbol`, for `export { a }` in the body of a namespace or of an ambient module.
    fn check_redeclared_namespace_exports(&self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound, files) = (self.hir(file), self.bound(file), self.files());
        // `declareSymbolEx`: a second specifier for the name is refused, and is a symbol of its own.
        let mut declared: Vec<(SymbolId, Atom)> = Vec::new();
        for (x, export) in hir.exports.iter().enumerate() {
            let scope = bound.export_scope[x];
            if export.spec.is_some() || scope.is_none() {
                continue;
            }
            let container = bound.scopes[scope.idx()].symbol;
            if container.is_none()
                || !matches!(bound.scopes[scope.idx()].kind, ScopeKind::Module(_))
            {
                continue;
            }
            for spec in export.items.iter() {
                let exported = hir[spec].exported;
                if declared.contains(&(container, exported)) {
                    continue;
                }
                declared.push((container, exported));
                // `export { "a" }` stands for nothing.
                if matches!(
                    hir.text.get(hir[spec].local_pos as usize),
                    Some(b'"' | b'\'')
                ) {
                    continue;
                }
                // The specifier's own symbol, with what the binder merged into it. What other files add to the name goes to what the
                // alias stands for (`mergeSymbol`).
                let exports = bound.symbols[container.idx()].exports;
                let Some(&(_, id)) = bound
                    .table(exports)
                    .iter()
                    .find(|&&(name, _)| name == exported)
                else {
                    continue;
                };
                let symbol = Sym { file, id };
                let own = bound.symbols[id.idx()].flags;
                let mut excluded = SymFlags::empty();
                for meaning in [SymFlags::VALUE, SymFlags::TYPE, SymFlags::NAMESPACE] {
                    if own.intersects(meaning) {
                        excluded |= meaning;
                    }
                }
                if excluded.is_empty() {
                    continue;
                }
                let all = SymFlags::VALUE | SymFlags::TYPE | SymFlags::NAMESPACE | SymFlags::ALIAS;
                let Some(found) = files.resolve_name(file, scope, hir[spec].local, all) else {
                    continue;
                };
                let target = if found == symbol {
                    Some(found)
                } else {
                    files.resolve_alias_if_needed(found)
                };
                if target.is_some_and(|target| files.flags(target).intersects(excluded)) {
                    let start = export_specifier_start(hir, spec);
                    out.push(Diagnostic { start, code: 2484 });
                    let end = self.end_of_export_spec(file, spec);
                    self.note(start, end, 2484, vec![self.atom_text(exported)]);
                }
            }
        }
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

    fn check_members_of(
        &mut self,
        file: FileId,
        members: Span<MemberId>,
        is_ambient: bool,
        out: &mut Vec<Diagnostic>,
    ) {
        struct Entry {
            name: Atom,
            is_static: bool,
            flags: u32,
            /// Where the declarations that went together are.
            accepted: Vec<u32>,
            /// All that go by the name, refused or not.
            all: Vec<u32>,
            /// As `checkObjectTypeForDuplicateDeclarations` has it: nothing yet, a property, an accessor, said.
            state: u8,
        }
        let hir = self.hir(file);
        // One member has nothing to clash with, unless it declares more than itself, or is static as the `prototype` of every class is.
        if members.len() < 2
            && !members.iter().any(|m| {
                hir[m].kind == MemberKind::Constructor || hir[m].flags.contains(Flags::STATIC)
            })
        {
            return;
        }
        let mut entries: Vec<Entry> = Vec::new();
        // Name, whether it is static, what it makes of the name, what that excludes, where, and 1 for a property, 2 for an accessor.
        let mut declared: Vec<(Atom, bool, u32, u32, u32, u8)> = Vec::new();
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
            let Some(name) = self.name_of_declared_member(file, member.key) else {
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
        // `bindClassLikeDeclaration`: every class has a static `prototype`, a property nobody declared.
        if declared.iter().any(|d| d.1 && d.0 == known::prototype) {
            entries.push(Entry {
                name: known::prototype,
                is_static: true,
                flags: PROPERTY,
                accepted: Vec::new(),
                all: Vec::new(),
                state: 0,
            });
        }
        for &(name, is_static, includes, excludes, pos, _) in &declared {
            let Some(entry) = entries
                .iter_mut()
                .find(|e| e.name == name && e.is_static == is_static)
            else {
                entries.push(Entry {
                    name,
                    is_static,
                    flags: includes,
                    accepted: vec![pos],
                    all: vec![pos],
                    state: 0,
                });
                continue;
            };
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
            for &start in entry.accepted.iter().chain(std::iter::once(&pos)) {
                out.push(Diagnostic { start, code: 2300 });
                match (late_before, late_bound.contains(&pos)) {
                    // The binder names each as it is written.
                    (None, false) => self.note_duplicate_name(file, start, start),
                    // `lateBindMember`
                    (Some(_), true) if !self.files().atoms.is_symbol_name(name) => {
                        let end = self.end_of_name_at(file, start);
                        self.note(start, end, 2300, vec![self.atom_text(name)]);
                    }
                    (Some(_), true) => self.note_duplicate_name(file, start, pos),
                    // `reportMergeSymbolError`: `symbolToString` of the symbol that is bound late.
                    (Some(first), false) => self.note_duplicate_name(file, start, first),
                    (None, true) => self.note_duplicate_name(file, start, pos),
                }
            }
            // After an accessor met something else, nothing goes with it any more.
            if entry.flags & ACCESSOR != 0 && entry.flags & ACCESSOR != includes & ACCESSOR {
                entry.flags |= ACCESSOR;
            }
        }
        // Two properties, or a property and an accessor.
        for &(name, is_static, _, _, pos, kind) in &declared {
            if kind == 0 {
                continue;
            }
            let Some(entry) = entries
                .iter_mut()
                .find(|e| e.name == name && e.is_static == is_static)
            else {
                continue;
            };
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

/// `SkipTrivia`: the offset of the first token at or after `at`.
fn skip_trivia(text: &[u8], mut at: usize) -> usize {
    loop {
        match text.get(at) {
            Some(c) if c.is_ascii_whitespace() || *c == 0x0b => at += 1,
            Some(b'/') if text.get(at + 1) == Some(&b'/') => {
                while text.get(at).is_some_and(|&c| c != b'\n' && c != b'\r') {
                    at += 1;
                }
            }
            Some(b'/') if text.get(at + 1) == Some(&b'*') => {
                at = text[at + 2..]
                    .windows(2)
                    .position(|w| w == b"*/")
                    .map_or(text.len(), |n| at + n + 4);
            }
            _ => return at,
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

/// The starts of `*` and of `ns` in the statement `export * as ns from "m"`.
fn namespace_export_starts(hir: &File, stmt: StmtId) -> Option<(u32, u32)> {
    let StmtKind::ExportStar { type_only, .. } = hir[stmt].kind else {
        return None;
    };
    let mut star = start_after_tokens(&hir.text, hir[stmt].pos, &[b"export"])?;
    if type_only {
        star = start_after_tokens(&hir.text, star, &[b"type"])?;
    }
    Some((star, start_after_tokens(&hir.text, star, &[b"*", b"as"])?))
}

/// The start of an export specifier: its `type` modifier if it has one, else its first name.
fn export_specifier_start(hir: &File, spec: ExportSpecId) -> u32 {
    let spec = &hir[spec];
    let first_name = spec.local_pos.min(spec.pos);
    if !spec.type_only {
        return first_name;
    }
    let Some(before) = hir.text.get(..first_name as usize) else {
        return first_name;
    };
    let mut before = before.trim_ascii_end();
    while before.ends_with(b"*/") {
        let Some(open) = before.windows(2).rposition(|w| w == b"/*") else {
            break;
        };
        before = before[..open].trim_ascii_end();
    }
    if before.ends_with(b"type") {
        before.len() as u32 - 4
    } else {
        first_name
    }
}

/// `hasExportDeclarations`
fn has_export_declarations(hir: &File, list: IdList<StmtId>) -> bool {
    hir.ids(list).any(|s| {
        matches!(
            hir[s].kind,
            StmtKind::ExportNamed(_)
                | StmtKind::ExportStar { .. }
                | StmtKind::ExportAssign(_)
                | StmtKind::ExportDefault(_)
        )
    })
}

/// What the statement `s` puts among the locals of the body of a module or a namespace it is in: name, declaration, modifiers.
/// `is_in_block`: there is a block between the two, out of which only `var` gets.
fn declared_by_statement(
    hir: &File,
    s: StmtId,
    is_in_block: bool,
    into: &mut Vec<(Atom, Decl, Flags)>,
) {
    fn bound_by(hir: &File, pat: PatId, flags: Flags, into: &mut Vec<(Atom, Decl, Flags)>) {
        match hir[pat].kind {
            PatKind::Ident(name) => into.push((name, Decl::Var(pat), flags)),
            PatKind::Object(props) => props
                .iter()
                .for_each(|p| bound_by(hir, hir[p].value, flags, into)),
            PatKind::Array(elems) => elems
                .iter()
                .for_each(|e| bound_by(hir, hir[e].pat, flags, into)),
            PatKind::Missing => {}
        }
    }
    if s.is_none() {
        return;
    }
    match hir[s].kind {
        StmtKind::Var(decls) => {
            for d in decls.iter() {
                if !is_in_block || hir[d].kind == VarKind::Var {
                    bound_by(hir, hir[d].pat, hir[d].flags, into);
                }
            }
        }
        // `GetContainerFlags`: these are no blocks themselves.
        StmtKind::If { yes, no, .. } => [yes, no]
            .into_iter()
            .for_each(|x| declared_by_statement(hir, x, is_in_block, into)),
        StmtKind::While { body, .. }
        | StmtKind::DoWhile { body, .. }
        | StmtKind::Labeled { body, .. } => {
            declared_by_statement(hir, body, is_in_block, into);
        }
        StmtKind::Block(list) => hir
            .ids(list)
            .for_each(|x| declared_by_statement(hir, x, true, into)),
        StmtKind::For { init, body, .. } => [init, body]
            .into_iter()
            .for_each(|x| declared_by_statement(hir, x, true, into)),
        StmtKind::ForIn { left, body, .. } | StmtKind::ForOf { left, body, .. } => {
            [left, body]
                .into_iter()
                .for_each(|x| declared_by_statement(hir, x, true, into));
        }
        StmtKind::Switch { cases, .. } => {
            for case in cases.iter() {
                hir.ids(hir[case].body)
                    .for_each(|x| declared_by_statement(hir, x, true, into));
            }
        }
        StmtKind::Try {
            block,
            handler,
            finalizer,
            ..
        } => {
            [block, handler, finalizer]
                .into_iter()
                .for_each(|x| declared_by_statement(hir, x, true, into));
        }
        _ if is_in_block => {}
        // An unnamed default has no local symbol.
        StmtKind::Fn(f) if hir[f].name.is_some() => {
            into.push((hir[f].name, Decl::Fn(f), hir[f].flags))
        }
        StmtKind::Class(c) if hir[c].name.is_some() => {
            into.push((hir[c].name, Decl::Class(c), hir[c].flags))
        }
        StmtKind::Interface(i) => into.push((hir[i].name, Decl::Interface(i), hir[i].flags)),
        StmtKind::TypeAlias(a) => into.push((hir[a].name, Decl::Alias(a), hir[a].flags)),
        StmtKind::Enum(e) => into.push((hir[e].name, Decl::Enum(e), hir[e].flags)),
        StmtKind::Module(m) => {
            if let ModuleName::Ident(name) = hir[m].name {
                into.push((name, Decl::Module(m), hir[m].flags));
            }
        }
        StmtKind::Import(i) => {
            let import = &hir[i];
            if import.default.is_some() {
                into.push((import.default, Decl::ImportDefault(i), Flags::empty()));
            }
            if import.namespace.is_some() {
                into.push((import.namespace, Decl::ImportNamespace(i), Flags::empty()));
            }
            into.extend(
                import
                    .named
                    .iter()
                    .map(|spec| (hir[spec].local, Decl::ImportSpec(spec), Flags::empty())),
            );
        }
        // One that is exported goes straight to the exports.
        StmtKind::ImportEquals(i) if !hir[i].flags.contains(Flags::EXPORT) => {
            into.push((hir[i].name, Decl::ImportEquals(i), Flags::empty()))
        }
        _ => {}
    }
}
