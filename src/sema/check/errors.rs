//! What is wrong with a file. The resolver answers questions and never complains; this goes over everything that is
//! written, once, asks it what it needs to know, and says where that does not add up.
//!
//! The codes are the TypeScript compiler's. An error that would rest on something the resolver could not work out is not
//! reported: better to miss one than to make one up.
//!
//! Nothing here allocates per node: one list of diagnostics is handed down, the arenas are gone through by index, and a
//! diagnostic is a place and a number until somebody wants to read it.

use super::errors_order::Named;
use super::errors_x_statements::{is_said_by_the_binder, is_said_by_the_parser};
use super::*;
use crate::bind::{
    ClassOwner, Decl, FnOwner, MemberOwner, Parent, PatParent, ScopeId, ScopeKind, SymbolId,
    TableId,
};

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub struct Diagnostic {
    /// Where what is wrong starts, in bytes.
    pub start: u32,
    pub code: u32,
}

#[derive(Copy, Clone, Debug)]
enum Container {
    File,
    Fn(FnId),
    Module(ModuleId),
    Member(MemberId),
    /// Somewhere that is never the place a variable is declared in.
    Other,
}

impl PartialEq for Container {
    fn eq(&self, other: &Container) -> bool {
        match (*self, *other) {
            (Container::File, Container::File) => true,
            (Container::Fn(a), Container::Fn(b)) => a == b,
            (Container::Module(a), Container::Module(b)) => a == b,
            (Container::Member(a), Container::Member(b)) => a == b,
            _ => false,
        }
    }
}

impl Checker<'_> {
    pub fn check_file(&mut self, file: FileId) -> Vec<Diagnostic> {
        let hir = self.hir(file);
        // `GetSyntacticDiagnostics` and `getBindAndCheckDiagnosticsWithChecker` are separate: only the second depends on whether the
        // file is checked.
        let (mut syntactic, early): (Vec<Diagnostic>, Vec<Diagnostic>) = hir
            .early_errors
            .iter()
            .map(|&(start, code)| Diagnostic { start, code })
            .partition(|d| is_syntactic_early_error(hir, d.start, d.code));
        // `hasParseDiagnostics`: in a file with parser or scanner errors, `grammarErrorOnNode` and its like report nothing, and neither do
        // the binder's `checkContextualIdentifier` and `checkPrivateIdentifier`. Early errors with their codes are dropped as well.
        // Errors the checker reports with a plain `error` stay.
        let has_parse_diagnostics = hir.has_parse_diagnostics || !syntactic.is_empty();
        let mut out: Vec<Diagnostic> = Vec::new();
        for d in early {
            if d.code == 1212 || d.code == 1359 {
                if !has_parse_diagnostics && hir.syntax_errors == 0 {
                    self.check_contextual_identifier(file, d.start, d.code, &mut out);
                }
            } else if hir.is_js && matches!(d.code, 1206 | 8038) {
                // `checkJSDecoratorSyntax`: the parser's `jsDiagnostics`, which `hasParseDiagnostics` does not count.
                syntactic.push(d);
            } else if !has_parse_diagnostics || !is_grammar_error(d.code) {
                out.push(d);
            }
        }
        out.extend(
            hir.checker_errors
                .iter()
                .map(|&(start, code)| Diagnostic { start, code }),
        );
        self.check_js_syntax(file, &mut syntactic);
        if !self.reports_semantic_errors(file) {
            syntactic.sort_unstable();
            syntactic.dedup();
            return syntactic;
        }
        self.checking = Some(file);
        // `BUN_SEMA_TRACE_PASSES=1`: which pass added or removed each error.
        let trace_passes = std::env::var_os("BUN_SEMA_TRACE_PASSES").is_some();
        macro_rules! pass {
            ($name:ident) => {{
                let before = if trace_passes {
                    out.clone()
                } else {
                    Vec::new()
                };
                self.$name(file, &mut out);
                if trace_passes {
                    trace_pass(
                        &self.files().modules[file.idx()].path,
                        stringify!($name),
                        &before,
                        &out,
                    );
                }
            }};
        }
        pass!(check_declare_modifiers);
        pass!(check_empty_declaration_lists);
        pass!(check_modules);
        pass!(check_names);
        pass!(check_type_argument_counts);
        pass!(check_assigned_before_use);
        pass!(check_properties_initialized);
        pass!(check_operators);
        pass!(check_writes);
        pass!(check_property_accesses);
        pass!(check_calls);
        pass!(check_unused);
        pass!(check_grammar);
        pass!(check_duplicates);
        pass!(check_heritage);
        pass!(check_jsx);
        pass!(check_implicit_any);
        pass!(check_overloads);
        pass!(check_use_before_declaration);
        pass!(check_miscellaneous);
        pass!(check_iteration);
        pass!(check_names_and_exports);
        pass!(check_control_flow);
        pass!(check_declarations);
        pass!(check_small_things);
        pass!(check_circularities);
        pass!(check_assignments);
        pass!(check_x_aliases);
        // It takes back what has been said of specifiers that are never resolved.
        pass!(check_x_modules);
        pass!(check_x_classes);
        pass!(check_x_identifiers);
        pass!(check_x_properties_jsx);
        // `checkGrammarRegularExpressionLiteral`
        if !has_parse_diagnostics {
            pass!(check_x_regexp_scanner);
        }
        pass!(check_x_typenodes);
        // These three put other words in the place of what has been said: of declarations that are not one symbol after all, of what is
        // assigned, of names that are not found.
        pass!(check_x_signatures);
        pass!(check_x_operators);
        pass!(check_x_enums_names);
        // It takes back what has been said of decorators that are out of place.
        pass!(check_decorators);
        // `checkWithStatement`, `checkReturnStatement`, `checkExportAssignment`: what they never look at is taken back, whoever said it.
        pass!(check_x_statements);
        pass!(take_back_export_assignments_in_namespaces);
        if has_parse_diagnostics {
            out.retain(|d| !is_grammar_error(d.code));
        }
        if self.is_plain_js(file) {
            out.retain(|d| errors_js::PLAIN_JS_ERRORS.binary_search(&d.code).is_ok());
        } else {
            // Last: it goes by all that is left. `getDiagnosticsWithPrecedingDirectives`: not by what the parser says.
            self.check_x_comment_directives(file, &mut out);
        }
        out.append(&mut syntactic);
        out.sort_unstable();
        out.dedup();
        let suppressed = &hir.suppressed;
        if !suppressed.is_empty() {
            // 2578 is said once everything has been taken back, and stays.
            out.retain(|d| {
                d.code == 2578
                    || !suppressed
                        .iter()
                        .any(|&(start, end)| (start..end).contains(&d.start))
            });
        }
        out
    }

    /// `checkContextualIdentifier`: 1212 1213 1214, 1262 1359, of a reserved word the parser came upon at `start` where a name goes.
    /// `code`: 1359 if it says the word is `await`.
    fn check_contextual_identifier(
        &self,
        file: FileId,
        start: u32,
        code: u32,
        out: &mut Vec<Diagnostic>,
    ) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        // The name of a member can be any word.
        if hir.enum_members.iter().any(|m| m.pos == start) {
            return;
        }
        let ident = hir
            .exprs
            .iter()
            .position(|e| e.pos == start && matches!(e.kind, ExprKind::Ident(_)));
        let pat = if ident.is_none() {
            hir.pats
                .iter()
                .position(|p| p.pos == start && matches!(p.kind, PatKind::Ident(_)))
        } else {
            None
        };
        // Of `class await {}` the parser points at what comes after the name.
        let class = if ident.is_some() || pat.is_some() {
            None
        } else {
            hir.classes.iter().position(|c| {
                c.name.is_some()
                    && (c.name_pos == start
                        || hir
                            .text
                            .get(c.name_pos as usize..)
                            .is_some_and(|name| name.starts_with(b"await"))
                            && skip_trivia(&hir.text, c.name_pos as usize + b"await".len())
                                == start as usize)
            })
        };
        let start = class.map_or(start, |c| hir.classes[c].name_pos);
        let around = if let Some(e) = ident {
            bound.expr_parent[e]
        } else if let Some(p) = pat {
            let mut root = PatId(p as u32);
            loop {
                match bound.pat_parent[root.idx()] {
                    PatParent::Prop(outer, _) | PatParent::Elem(outer, _) => root = outer,
                    PatParent::Param(param) if bound.param_fn[param.idx()].is_some() => {
                        break Parent::FnBody(bound.param_fn[param.idx()]);
                    }
                    PatParent::Var(d) => break Parent::VarInit(d),
                    PatParent::Param(_) | PatParent::None => break Parent::None,
                }
            }
        } else if let Some(c) = class {
            // The name of a class is a name where the class is written.
            match bound.class_owner[c] {
                ClassOwner::Expr(x) if x.is_some() => Parent::Expr(x),
                ClassOwner::Stmt(s) if s.is_some() => Parent::Stmt(s),
                _ => Parent::None,
            }
        } else {
            Parent::None
        };
        // Where to go outwards from: an expression itself, so that the member whose computed name it is can be found.
        let from = match ident {
            Some(e) if !matches!(around, Parent::None) => Parent::Expr(ExprId(e as u32)),
            _ => around,
        };
        let is_module = self.files().module(file).is_module();
        // `await` is a name like any other, except at the top of a module and where something can be awaited.
        if code == 1359
            || hir
                .text
                .get(start as usize..)
                .is_some_and(|name| name.starts_with(b"await"))
        {
            // `IsInTopLevelContext`: in no function, namespace or enum, nor in the initializer of a property. A computed name is
            // worked out where the class is.
            let mut at = from;
            let is_at_top = loop {
                at = match at {
                    Parent::File => break true,
                    Parent::None
                    | Parent::FnBody(_)
                    | Parent::ParamDefault(_)
                    | Parent::Module(_)
                    | Parent::MemberInit(_)
                    | Parent::EnumInit(_) => break false,
                    Parent::Expr(x) if x.is_none() => break false,
                    Parent::Expr(key)
                        if matches!(bound.expr_parent[key.idx()], Parent::MemberKey) =>
                    {
                        match hir
                            .members
                            .iter()
                            .position(|m| m.key == PropKey::Computed(key))
                        {
                            Some(m) => self.outward(file, Parent::MemberInit(MemberId(m as u32))),
                            // Of a method of an object literal, which is not kept track of.
                            None => break false,
                        }
                    }
                    Parent::Key(owner) if owner.is_some() => Parent::Expr(owner),
                    other => self.outward(file, other),
                };
            };
            // `NodeFlagsAwaitContext`: the nearest function decides, and a static block counts as one that can.
            let can_await = self.enclosing_fn(file, around).is_some_and(|f| {
                hir[f].flags.contains(Flags::ASYNC) || hir[f].kind == FnKind::StaticBlock
            });
            if is_module && is_at_top {
                out.push(Diagnostic { start, code: 1262 });
            } else if can_await || matches!(around, Parent::None) {
                out.push(Diagnostic { start, code: 1359 });
            }
            return;
        }
        // `getStrictModeIdentifierMessage`: why the mode is strict is part of what is said. `GetContainingClass` starts at what the name
        // is in, so the name of a class is in that class.
        let code = if class.is_some() || !self.classes_around(file, from).is_empty() {
            1213
        } else if is_module {
            1214
        } else {
            1212
        };
        out.push(Diagnostic { start, code });
    }

    /// `checkExportAssignment` is done with an `export =` or an `export default` in a namespace (1063 1319) before it gets to the
    /// expression. All that is said of that is what the parser and the binder say.
    fn take_back_export_assignments_in_namespaces(&self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        for (i, s) in hir.stmts.iter().enumerate() {
            let (StmtKind::ExportAssign(e) | StmtKind::ExportDefault(e)) = s.kind else {
                continue;
            };
            if e.is_none()
                || !matches!(bound.stmt_parent[i], Parent::Module(m) if matches!(hir[m].name, ModuleName::Ident(_)))
            {
                continue;
            }
            let (from, to) = (
                self.start_of(file, e),
                self.start_of_what_follows(file, StmtId(i as u32)),
            );
            out.retain(|d| {
                !(from..to).contains(&d.start)
                    || is_said_by_the_binder(d.code)
                    || is_said_by_the_parser(d.code)
                        && hir.early_errors.contains(&(d.start, d.code))
            });
        }
    }

    // ───────────────────────────── modules ─────────────────────────────

    /// 2307 2882 2306 6137 6142 7016 2732 2834 2835 2591 2580: what a module specifier leads to. `resolveExternalModule`. 2322 2880 for the
    /// options of `import()`.
    fn check_modules(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let hir = self.hir(file);
        for i in 0..hir.specifier_uses.len() {
            let SpecifierUse {
                spec,
                pos,
                kind,
                mode,
            } = hir.specifier_uses[i];
            // `getModeForUsageLocation`: what is said where it is written, or else what the syntax and the file come to.
            let mode = if mode != ResolutionMode::None {
                mode
            } else if kind == SpecifierKind::Require {
                ResolutionMode::Require
            } else {
                self.files().module(file).default_mode
            };
            self.check_specifier(file, spec, pos, Some(kind), mode, out);
        }
        for i in 0..hir.exprs.len() {
            if let ExprKind::ImportCall(argument) = hir.exprs[i].kind
                && !matches!(self.bound(file).expr_parent[i], Parent::None)
                && let ExprKind::String(spec) = hir[argument].kind
            {
                let mode = self.files().mode_of_import_call(file);
                self.check_specifier(file, spec, hir[argument].pos, None, mode, out);
            }
        }
        // `checkAliasSymbol` for the names that `const a = require("m")` declares, `resolveExternalModuleTypeByLiteral` for every other
        // `require("m")`. JavaScript only. Both report at the string.
        if hir.is_js {
            let bound = self.bound(file);
            let is_identifier = |pat: PatId| matches!(hir[pat].kind, PatKind::Ident(_));
            for i in 0..hir.exprs.len() {
                let call = ExprId(i as u32);
                let Some((argument, spec)) = require_call_argument(hir, call) else {
                    continue;
                };
                // The loader only resolves the specifiers that the binder collected.
                if !bound.specifiers.contains(&spec) {
                    continue;
                }
                // `bindVariableDeclarationOrBindingElement`: the name, or each identifier directly in the binding pattern, is an alias,
                // whatever `require` resolves to.
                let alias_declaration = match bound.expr_parent[i] {
                    Parent::None => continue,
                    Parent::VarInit(decl)
                        if self.external_module_require_argument(file, decl).is_some() =>
                    {
                        match hir[hir[decl].pat].kind {
                            PatKind::Ident(_) => Some(decl),
                            PatKind::Object(props) => props
                                .iter()
                                .any(|p| is_identifier(hir[p].value))
                                .then_some(decl),
                            PatKind::Array(elems) => elems
                                .iter()
                                .any(|x| is_identifier(hir[x].pat))
                                .then_some(decl),
                            PatKind::Missing => None,
                        }
                    }
                    _ => None,
                };
                if alias_declaration.is_none() && !self.is_commonjs_require(file, call) {
                    continue;
                }
                let mode = self.require_resolution_mode(file, spec);
                self.check_specifier(
                    file,
                    spec,
                    hir[argument].pos,
                    Some(SpecifierKind::Require),
                    mode,
                    out,
                );
                if let Some(decl) = alias_declaration {
                    self.check_required_names(file, decl, spec, mode, out);
                }
            }
        }
        // `checkImportCallExpression`: the second argument is an `ImportCallOptions`, taken as a whole.
        if let Some(sym) = self
            .files()
            .atoms
            .lookup(b"ImportCallOptions")
            .and_then(|name| self.global_type_symbol(name))
        {
            for &(_, options) in &hir.import_options {
                if matches!(self.bound(file).expr_parent[options.idx()], Parent::None) {
                    continue;
                }
                let given = self.type_of_expr(file, options);
                if self.is_uncertain(file, options) {
                    continue;
                }
                let wanted = self.declared_type(sym);
                let wanted = self.optional(wanted);
                let at = self.start_of(file, options);
                self.check_assignable(file, given, wanted, at, ExprId::NONE, 2322, out);
            }
        }
        // `checkImportCallExpression`: 2880 at the first `assert: ..` of an options object literal, with or without a global
        // `ImportCallOptions`.
        for &(_, options) in &hir.import_options {
            if matches!(self.bound(file).expr_parent[options.idx()], Parent::None)
                || is_parenthesized(hir, options)
            {
                continue;
            }
            if let ExprKind::Object(props) = hir[options].kind
                && let Some(prop) = props.iter().map(|p| hir[p]).find(|prop| {
                    prop.kind == PropKind::Init
                        && matches!(prop.key, PropKey::Name(name) if self.files().atoms.bytes(name) == b"assert")
                        // `IsIdentifier(prop.Name())`: `"assert"` and `["assert"]` have the same key.
                        && !matches!(hir.text.get(prop.pos as usize), None | Some(b'"' | b'\'' | b'['))
                })
            {
                out.push(Diagnostic { start: prop.pos, code: 2880 });
            }
        }
        self.check_imported_names(file, out);
    }

    /// What is imported by name has to be exported: 2305 2459 2460 2614 2724, 2595 2597 2616 of a module that is `export =`, and 1192 2613
    /// for `default`. What is exported by name has to be there. `getExternalModuleMember`, `getTargetOfModuleDefault`,
    /// `getTargetOfExportSpecifier`.
    fn check_imported_names(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let hir = self.hir(file);
        // `getEmitSyntaxForModuleSpecifierExpression` for the specifier of an import or export declaration.
        let usage = self.files().module(file).default_mode;
        for import in &hir.imports {
            let mode = self.files().mode_of_import(file, import.mode);
            let Some((module, target)) = self.module_to_import_from(file, import.spec, mode) else {
                continue;
            };
            if import.default.is_some()
                && self.module_has_default(usage, module, target) == Some(false)
            {
                // `reportNonDefaultExport`: 2613 is said of the whole clause, which starts with `type` if that is written.
                let (start, code) = if self.files().export(module, import.default).is_none() {
                    (import.default_pos, 1192)
                } else if import.type_only {
                    (
                        start_of_type_keyword(&hir.text, import.default_pos)
                            .unwrap_or(import.default_pos),
                        2613,
                    )
                } else {
                    (import.default_pos, 2613)
                };
                out.push(Diagnostic { start, code });
            }
            for s in import.named.iter() {
                self.check_imported_name(
                    file,
                    usage,
                    module,
                    target,
                    hir[s].imported,
                    hir[s].imported_pos,
                    out,
                );
            }
        }
        for (x, export) in hir.exports.iter().enumerate() {
            if export.spec.is_none() {
                self.check_exported_names_are_there(file, x, out);
                continue;
            }
            let mode = self.files().mode_of_import(file, export.mode);
            let Some((module, target)) = self.module_to_import_from(file, export.spec, mode) else {
                continue;
            };
            for s in export.items.iter() {
                self.check_imported_name(
                    file,
                    usage,
                    module,
                    target,
                    hir[s].local,
                    hir[s].local_pos,
                    out,
                );
            }
        }
    }

    /// `getTargetOfExportSpecifier`, `markExportSpecifierAliasReferenced`: what the `x`th `export { a }` of the file names has to be there.
    fn check_exported_names_are_there(
        &mut self,
        file: FileId,
        x: usize,
        out: &mut Vec<Diagnostic>,
    ) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let (export, scope) = (&hir.exports[x], bound.export_scope[x]);
        // `checkGrammarModuleElementContext`: anywhere but at the top of a file or a namespace it is left at that.
        if scope.is_none()
            || !matches!(
                bound.scopes[scope.idx()].kind,
                ScopeKind::File | ScopeKind::Module(_)
            )
        {
            return;
        }
        let mut is_ambient = hir.kind == FileKind::Declaration;
        let mut at = scope;
        while !is_ambient && at.is_some() {
            is_ambient = matches!(bound.scopes[at.idx()].kind, ScopeKind::Module(m) if hir[m].flags.contains(Flags::AMBIENT));
            at = bound.scopes[at.idx()].parent;
        }
        // `markLinkedReferences`: not where nothing is emitted, nor when exports stay as they are written.
        let is_marked =
            !export.type_only && !is_ambient && !self.p.files.options.verbatim_module_syntax;
        let all = SymFlags::VALUE | SymFlags::TYPE | SymFlags::NAMESPACE;
        for s in export.items.iter() {
            let ExportSpec {
                local: name,
                local_pos: start,
                type_only,
                ..
            } = hir[s];
            if self.files().resolve_name(file, scope, name, all).is_some()
                || matches!(name, known::undefined | known::globalThis)
                // 2661, which `check_exports` says.
                || matches!(self.files().atoms.bytes(name), b"any" | b"string" | b"number" | b"boolean" | b"never" | b"unknown")
                // `export { "a" }`: not a name.
                || matches!(hir.text.get(start as usize), Some(b'"' | b'\''))
            {
                continue;
            }
            let code = self.not_found(file, scope, name, all);
            out.push(Diagnostic { start, code });
            // `markIdentifierAliasReferenced`: what is kept is looked up once more, as a value.
            if is_marked && !type_only {
                let code = self.not_found(file, scope, name, SymFlags::VALUE);
                out.push(Diagnostic { start, code });
            }
        }
    }

    /// The module `spec` means when it is resolved as `mode` says, if what there is to import from it can be told, and what it says it is
    /// with `export =`, or else the module once more.
    fn module_to_import_from(
        &self,
        file: FileId,
        spec: Atom,
        mode: ResolutionMode,
    ) -> Option<(Sym, Sym)> {
        if let Some(module) = self.module_with_known_exports(file, spec, mode) {
            return Some((module, module));
        }
        let files = self.files();
        let module = files.module_of_specifier_as(file, spec, mode)?;
        let target = files.resolve_alias(files.export(module, known::export_equals)?)?;
        Some((module, target))
    }

    /// The module `spec` means when it is resolved as `mode` says, if all there is to import from it can be told.
    pub(super) fn module_with_known_exports(
        &self,
        file: FileId,
        spec: Atom,
        mode: ResolutionMode,
    ) -> Option<Sym> {
        let files = self.files();
        let module = files.module_of_specifier_as(file, spec, mode)?;
        // What `export =` gives has properties, which can be imported as well.
        if files.export(module, known::export_equals).is_some() {
            return None;
        }
        // `declare module "m";` has whatever is asked of it. What a JSON file has is up to what is in it.
        let is_open = |m: Sym| {
            files.symbol(m).exports.is_none()
                || files.decls(m).iter().any(|&(f, d)| matches!(d, crate::bind::Decl::Module(id) if !files.hir(f)[id].has_body))
                || files.module(m.file).path.ends_with(".json")
        };
        if is_open(module) {
            return None;
        }
        let mut pending = vec![module];
        let mut visited = vec![module];
        while let Some(m) = pending.pop() {
            for part in files.parts(m) {
                for &(container, star) in &files.bound(part.file).export_stars {
                    if container != part.id {
                        continue;
                    }
                    let target = files.module_of_specifier(part.file, star)?;
                    if files.export(target, known::export_equals).is_some() || is_open(target) {
                        return None;
                    }
                    if !visited.contains(&target) {
                        visited.push(target);
                        pending.push(target);
                    }
                }
            }
        }
        Some(module)
    }

    /// `getTargetOfModuleDefault`: whether `module` has a default export, its own or a synthetic one. `usage` and `target` as in
    /// `check_imported_name`. `None` if the type of `target` is unknown.
    fn module_has_default(
        &mut self,
        usage: ResolutionMode,
        module: Sym,
        target: Sym,
    ) -> Option<bool> {
        let files = self.files();
        // `isOnlyImportableAsDefault`, `canHaveSyntheticDefault`: they go by how the import is emitted, whatever it says of how its
        // specifier is resolved.
        if files.is_only_importable_as_default(usage, module)
            || files.synthetic_default(usage, module).is_some()
        {
            return Some(true);
        }
        // `resolveExportByName`: of a module that is `export =`, the property `default` of what it is.
        if target == module {
            Some(files.export(module, known::default).is_some())
        } else {
            self.value_has_declared_property(target, known::default)
        }
    }

    /// `getPropertyOfTypeEx(getTypeOfSymbol(sym), name, skipObjectFunctionPropertyAugment)`. `None`: the type is not known.
    fn value_has_declared_property(&mut self, sym: Sym, name: Atom) -> Option<bool> {
        // What is no value has the error type, which has no properties.
        if !self.files().flags(sym).intersects(SymFlags::VALUE) {
            return Some(false);
        }
        let ty = self.type_of_symbol(sym);
        if !self.is_known(ty) {
            return None;
        }
        Some(self.has_declared_property(ty, name))
    }

    /// `getPropertyOfTypeEx` with `skipObjectFunctionPropertyAugment`: whether `ty` declares a property `name`. What every function and
    /// every object has does not count, what an index signature covers is no property, and `any` has none.
    fn has_declared_property(&mut self, ty: TypeId, name: Atom) -> bool {
        // `getReducedApparentType`
        let ty = self.force(ty);
        let ty = self.reduced(ty);
        let ty = self.apparent_type(ty);
        let ty = self.reduced(ty);
        let TypeData::Union(parts) = self.data(ty) else {
            return self.prop_of(ty, name).is_some();
        };
        // `createUnionOrIntersectionProperty`: some member has it, and those that do not have an index signature for it, or are object
        // literals that leave it out.
        let mut is_somewhere = false;
        for &part in parts.iter() {
            if self.has_declared_property(part, name) {
                is_somewhere = true;
                continue;
            }
            let apparent = self.apparent_type(part);
            let is_covered = match self.members(apparent) {
                Some(members) => self
                    .applicable_index_info(&members, TypeId::STRING, Some(name))
                    .is_some(),
                None => false,
            };
            if !is_covered && !self.is_closed_object_literal_type(part) {
                return false;
            }
        }
        is_somewhere
    }

    /// `getExternalModuleMember`, and `getTargetOfModuleDefault` for `default`: `name`, written at `start` in `from`, is imported from
    /// `module`. `usage`: the syntax the specifier is emitted as (`getEmitSyntaxForModuleSpecifierExpression`). `target`: the value
    /// `module` exports with `export =`, or else `module`.
    fn check_imported_name(
        &mut self,
        from: FileId,
        usage: ResolutionMode,
        module: Sym,
        target: Sym,
        name: Atom,
        start: u32,
        out: &mut Vec<Diagnostic>,
    ) {
        let files = self.files();
        let is_there = if name == known::default {
            self.module_has_default(usage, module, target)
        } else if files.is_only_importable_as_default(usage, module) {
            // 1544 is what is said of it then.
            return;
        } else if target == module {
            Some(files.module_export(module, name).is_some())
        } else if files.namespace_member(target, name).is_some()
            || files.export(module, name).is_some_and(|own| {
                let flags = files.symbol_flags(own);
                flags.intersects(SymFlags::TYPE | SymFlags::NAMESPACE)
                    && !flags.intersects(SymFlags::VALUE)
            })
        {
            // `getExportsOfModuleWorker`: what the value exports as a namespace, and of the module itself what is a type or a namespace
            // and no value.
            Some(true)
        } else {
            self.value_has_declared_property(target, name)
        };
        if is_there == Some(false) {
            out.push(Diagnostic {
                start,
                code: self.why_no_module_member(from, module, target, name, start),
            });
        }
    }

    /// `errorNoModuleMemberSymbol`, `reportNonExportedMember`, `reportInvalidImportEqualsExportMember`. The arguments are those of
    /// `check_imported_name`.
    fn why_no_module_member(
        &self,
        from: FileId,
        module: Sym,
        target: Sym,
        name: Atom,
        start: u32,
    ) -> u32 {
        let files = self.files();
        let text = files.atoms.bytes(name);
        // `getSuggestedSymbolForNonexistentModule`: for a name, not for a string, and only what a module declares (`SymbolFlagsModuleMember`).
        let is_identifier = !matches!(self.hir(from).text.get(start as usize), Some(b'"' | b'\''));
        let module_member = SymFlags::VARIABLE
            | SymFlags::FUNCTION
            | SymFlags::CLASS
            | SymFlags::INTERFACE
            | SymFlags::ENUM
            | SymFlags::MODULE
            | SymFlags::TYPE_ALIAS
            | SymFlags::ALIAS;
        let exports = if files.flags(target).intersects(SymFlags::MODULE) {
            files.all_module_exports(target)
        } else {
            files.exports(target)
        };
        if is_identifier
            && exports.iter().any(|&(other, s)| {
                files.flags(s).intersects(module_member) && is_close(text, files.atoms.bytes(other))
            })
        {
            return 2724;
        }
        if files.export(module, known::default).is_some() {
            return 2614;
        }
        // What the file, or the first `declare module "m"`, declares for itself.
        let local = files.decls(module).first().and_then(|&(of, decl)| {
            let bound = files.bound(of);
            let scope = match decl {
                Decl::File => 0,
                Decl::Module(m) => bound
                    .scopes
                    .iter()
                    .position(|s| s.kind == ScopeKind::Module(m))?,
                _ => return None,
            };
            bound
                .lookup(bound.scopes[scope].locals, name)
                .map(|id| files.sym(of, id))
        });
        let Some(local) = local else { return 2305 };
        // `getSymbolIfSameReference`
        let local = files.resolve_alias(local);
        let own = files.exports(module);
        let Some(equals) = files.export(module, known::export_equals) else {
            return if own.iter().any(|&(_, e)| files.resolve_alias(e) == local) {
                2460
            } else {
                2459
            };
        };
        // `bindCommonJSTypeExports`: next to types or namespaces that are exported, `export =` is a namespace of them besides, and no
        // longer stands for what it names.
        let is_more_than_an_alias = own.iter().any(|&(other, s)| {
            other != known::export_equals
                && files
                    .flags(s)
                    .intersects(SymFlags::TYPE | SymFlags::NAMESPACE)
        });
        if local.is_none() || is_more_than_an_alias || files.resolve_alias(equals) != local {
            2305
        } else if files.options.module >= crate::resolve::ModuleKind::Es2015 {
            2595
        } else if self.hir(from).is_js {
            2597
        } else {
            2616
        }
    }

    /// `resolveExternalModule`. `kind` is `None` for `import()` and `Require` for a `require()` call too. `mode`: the way the specifier is
    /// resolved where it is written.
    fn check_specifier(
        &mut self,
        file: FileId,
        spec: Atom,
        start: u32,
        kind: Option<SpecifierKind>,
        mode: ResolutionMode,
        out: &mut Vec<Diagnostic>,
    ) {
        let options = &self.p.files.options;
        let is_side_effect = kind == Some(SpecifierKind::SideEffect);
        if is_side_effect && !options.no_unchecked_side_effect_imports {
            return;
        }
        // Reported before the module is looked up, found or not.
        if self.files().atoms.bytes(spec).starts_with(b"@types/") {
            out.push(Diagnostic { start, code: 6137 });
        }
        let module = self.files().module(file);
        let is_jsx_set = options.jsx != crate::resolve::JsxEmit::None;
        let found = self.files().module_of_specifier_as(file, spec, mode);
        if let Some(&target) = module.imports.get(&(spec, mode))
            // A module that is declared by name is what it is declared to be.
            && found.is_none_or(|m| m == self.files().file_symbol(target))
        {
            // `GetResolutionDiagnostic`: `.tsx` and `.jsx` files need the `jsx` option. The error is reported even if the file is in the
            // program.
            let path = &self.files().module(target).path;
            let is_jsx_file = path.ends_with(".jsx");
            let is_refused = !is_jsx_set && (is_jsx_file || path.ends_with(".tsx"));
            if is_refused {
                out.push(Diagnostic { start, code: 6142 });
            }
            // The file is not a module. The loader reads a refused `.tsx` file for the import, which tsc does not do, so that file only
            // counts if it is a root file. A refused `.jsx` file is linked only if the program has it for another reason.
            if found.is_none()
                && !is_side_effect
                && (!is_refused || is_jsx_file || options.files.contains(path))
            {
                out.push(Diagnostic { start, code: 2306 });
            }
            return;
        }
        if found.is_some() {
            return;
        }
        // The specifier resolves to JavaScript that is not in the program.
        if module.untyped_imports.contains(&(spec, mode)) {
            // `GetResolutionDiagnostic`: a `.jsx` file needs `jsx` before anything else.
            if !is_jsx_set && module.jsx_imports.contains(&(spec, mode)) {
                out.push(Diagnostic { start, code: 6142 });
            // `errorOnImplicitAnyModule`
            } else if options.no_implicit_any && !is_side_effect {
                out.push(Diagnostic { start, code: 7016 });
            }
            return;
        }
        let text = self.files().atoms.text(spec);
        let code = if !options.resolve_json_module && text.ends_with(".json") {
            2732
        } else if options.resolves_like_node
            && mode == ResolutionMode::Import
            && let Some(&(_, is_there)) = module.extensionless_imports.iter().find(|e| e.0 == spec)
        {
            // Only of what is not found is it said that Node's `import` wants the extension written.
            if is_there { 2835 } else { 2834 }
        } else if is_side_effect {
            2882
        // `getCannotResolveModuleNameErrorForSpecificModule`: only for a string literal, not for a template.
        } else if crate::resolve::is_node_core_module(&text)
            && self.hir(file).text.get(start as usize) != Some(&b'`')
        {
            if options
                .types
                .as_ref()
                .is_some_and(|t| t.iter().any(|t| t == "*"))
            {
                2580
            } else {
                2591
            }
        } else {
            2307
        };
        out.push(Diagnostic { start, code });
    }

    /// `getModeForUsageLocation` for the argument of `require(spec)`: CommonJS. Falls back to the first mode the loader resolved `spec`
    /// in, in the order of `Files::module_of_specifier`, if it did not resolve it as CommonJS.
    fn require_resolution_mode(&self, file: FileId, spec: Atom) -> ResolutionMode {
        let module = self.files().module(file);
        [
            ResolutionMode::Require,
            module.default_mode,
            ResolutionMode::Import,
            ResolutionMode::None,
        ]
        .into_iter()
        .find(|&mode| {
            module.imports.contains_key(&(spec, mode))
                || module.untyped_imports.contains(&(spec, mode))
        })
        .unwrap_or(ResolutionMode::Require)
    }

    /// `getExternalModuleRequireArgument`: the argument of `require("m")` and its text, if `IsVariableDeclarationInitializedToRequire`
    /// holds for `decl`: JavaScript, no `export`, no type annotation, and the initializer is the call itself.
    pub(super) fn external_module_require_argument(
        &self,
        file: FileId,
        decl: VarDeclId,
    ) -> Option<(ExprId, Atom)> {
        let hir = self.hir(file);
        let VarDecl {
            ty, init, flags, ..
        } = hir[decl];
        if !hir.is_js
            || init.is_none()
            || ty.is_some()
            || flags.contains(Flags::EXPORT)
            || is_parenthesized(hir, init)
        {
            return None;
        }
        require_call_argument(hir, init)
    }

    /// `getTargetOfImportSpecifier` for a binding element: each identifier directly in the pattern of `const { a, b: c } = require(spec)`
    /// is an alias for the export that `PropertyNameOrName` names, and `getExternalModuleMember` reports the ones that are missing.
    /// `IsVariableDeclarationInitializedToRequire` holds for `decl`.
    fn check_required_names(
        &mut self,
        file: FileId,
        decl: VarDeclId,
        spec: Atom,
        mode: ResolutionMode,
        out: &mut Vec<Diagnostic>,
    ) {
        let hir = self.hir(file);
        let pattern = hir[hir[decl].pat].kind;
        if matches!(pattern, PatKind::Ident(_) | PatKind::Missing) {
            return;
        }
        let Some((module, target)) = self.module_to_import_from(file, spec, mode) else {
            return;
        };
        let identifier = |pat: PatId| match hir[pat].kind {
            PatKind::Ident(name) => Some((name, hir[pat].pos)),
            _ => None,
        };
        let mut check = |name: Atom, start: u32| {
            self.check_imported_name(
                file,
                ResolutionMode::Require,
                module,
                target,
                name,
                start,
                out,
            )
        };
        match pattern {
            PatKind::Object(props) => {
                for prop in props.iter().map(|p| hir[p]) {
                    let Some((local_name, local_start)) = identifier(prop.value) else {
                        continue;
                    };
                    let first_byte = hir.text.get(prop.pos as usize);
                    match prop.key {
                        // `...rest` has no property name.
                        _ if prop.is_rest => check(local_name, local_start),
                        // Only an identifier or a string literal names an export: not `[k]`, `["a"]` or `0`.
                        PropKey::Name(name)
                            if !matches!(first_byte, None | Some(b'[' | b'.' | b'0'..=b'9')) =>
                        {
                            check(name, prop.pos)
                        }
                        _ => {}
                    }
                }
            }
            PatKind::Array(elems) => {
                for (name, start) in elems.iter().filter_map(|x| identifier(hir[x].pat)) {
                    check(name, start);
                }
            }
            PatKind::Ident(_) | PatKind::Missing => {}
        }
    }

    // ───────────────────────────── variables without a value ─────────────────────────────

    /// `symbol.ValueDeclaration` of what the identifier `e` names, if that is a `var`, `let` or `const` of this file: the name that is
    /// bound, and the declaration it is bound in.
    fn value_declaration_of_variable(&self, file: FileId, e: ExprId) -> Option<(PatId, VarDeclId)> {
        let bound = self.bound(file);
        let symbol = bound.expr_symbol[e.idx()];
        if symbol.is_none() {
            return None;
        }
        let s = &bound.symbols[symbol.idx()];
        // `isParameter`, `isAlias`
        if !s.flags.intersects(SymFlags::VARIABLE)
            || s.flags.intersects(SymFlags::PARAMETER | SymFlags::ALIAS)
        {
            return None;
        }
        // `SetValueDeclaration`: the first declaration of a value. Interfaces, type aliases and namespaces without values are none.
        let is_of_a_value = |decl: Decl, flags: SymFlags| {
            !matches!(
                decl,
                Decl::Interface(_) | Decl::Alias(_) | Decl::TypeParam(_)
            ) && (flags.contains(SymFlags::VALUE_MODULE) || !matches!(decl, Decl::Module(_)))
        };
        // In another file it is ambient, or an outer variable: initialized either way.
        if s.flags.contains(SymFlags::MERGED) {
            let sym = self.files().sym(file, symbol);
            let flags = self.files().flags(sym);
            if self
                .files()
                .decls(sym)
                .iter()
                .find(|d| is_of_a_value(d.1, flags))
                .is_some_and(|d| d.0 != file)
            {
                return None;
            }
        }
        let Some(&Decl::Var(pat)) = s.decls.iter().find(|&&decl| is_of_a_value(decl, s.flags))
        else {
            return None;
        };
        // `GetRootDeclaration`
        let mut root = pat;
        loop {
            match bound.pat_parent[root.idx()] {
                PatParent::Prop(outer, _) | PatParent::Elem(outer, _) => root = outer,
                PatParent::Var(d) => return Some((pat, d)),
                _ => return None,
            }
        }
    }

    /// Whether `stmt` declares the variable of a `for`-`in` or a `for`-`of`.
    fn declares_loop_variable(&self, file: FileId, stmt: StmtId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        matches!(bound.stmt_parent[stmt.idx()], Parent::Stmt(owner)
            if matches!(hir[owner].kind, StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. } if left == stmt))
    }

    /// Whether `e` is written in the initializer of the declaration `d`, which binds `pat`.
    fn is_in_initializer_of(&self, file: FileId, e: ExprId, pat: PatId, d: VarDeclId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut parent = bound.expr_parent[e.idx()];
        loop {
            match parent {
                Parent::VarInit(v) if v == d => return true,
                Parent::None | Parent::File | Parent::Module(_) => return false,
                // A function that starts further up is around the declaration.
                Parent::FnBody(f) if hir[f].pos < hir[pat].pos => return false,
                _ => parent = self.parent_of(file, parent),
            }
        }
    }

    /// `getAssignmentTargetKind(e) == AssignmentKindDefinite`: `e` is given a value by `=`, `||=`, `&&=`, `??=`, or the head of a loop.
    fn is_definite_assignment_target(&self, file: FileId, e: ExprId) -> bool {
        if self.is_assignment_target(file, e) {
            return true;
        }
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut at = e;
        loop {
            let Parent::Expr(parent) = bound.expr_parent[at.idx()] else {
                return false;
            };
            match hir[parent].kind {
                ExprKind::NonNull(_) => at = parent,
                ExprKind::Assign {
                    op: Some(BinOp::And | BinOp::Or | BinOp::Nullish),
                    target,
                    ..
                } => return target == at,
                _ => return false,
            }
        }
    }

    /// `isSymbolAssignedDefinitely`: `+=` and `++` change a value, they do not give one.
    fn is_assigned_definitely(&self, file: FileId, symbol: SymbolId) -> bool {
        let bound = self.bound(file);
        let from = bound.assignments.partition_point(|a| a.0.0 < symbol.0);
        bound.assignments[from..]
            .iter()
            .take_while(|a| a.0 == symbol)
            .any(|a| self.is_definite_assignment_target(file, a.1))
    }

    /// `checkIdentifier`: whether the variable the identifier `e` reads, whose type is `declared`, is taken to hold a value where the
    /// flow of control it is followed in starts (`assumeInitialized`).
    pub(super) fn assumes_initialized(&self, file: FileId, e: ExprId, declared: TypeId) -> bool {
        if !self.p.files.options.strict_null_checks
            || declared == TypeId::UNKNOWN
            || declared == TypeId::VOID
            || self.is_any(declared)
        {
            return true;
        }
        let (hir, bound) = (self.hir(file), self.bound(file));
        let parent = bound.expr_parent[e.idx()];
        if hir.kind == FileKind::Declaration
            || matches!(parent, Parent::None)
            || bound.is_in_type_query(e)
        {
            return true;
        }
        let Some((pat, d)) = self.value_declaration_of_variable(file, e) else {
            return true;
        };
        let (decl, stmt) = (&hir[d], bound.var_stmt[d.idx()]);
        // The variable of a `catch` has what was thrown.
        if decl.flags.intersects(Flags::AMBIENT | Flags::DEFINITE)
            || stmt.is_none()
            || !matches!(hir[stmt].kind, StmtKind::Var(_))
        {
            return true;
        }
        // `x!`. Not `(x)!`: what is written right around it is what counts.
        if let Parent::Expr(x) = parent
            && matches!(hir[x].kind, ExprKind::NonNull(_))
            && hir.parens.binary_search_by_key(&e.0, |p| p.0.0).is_err()
        {
            return true;
        }
        // What finds out its type as it goes starts as `undefined` on its own account.
        let symbol = bound.expr_symbol[e.idx()];
        if self.auto_kind(file, symbol) != super::flow::Auto::No {
            return true;
        }
        // `isSameScopedBindingElement`: what a pattern binds, read in the nearest default around, which is one of the same pattern.
        if decl.pat != pat {
            let mut at = parent;
            loop {
                match at {
                    Parent::PatPropDefault(_) | Parent::PatElemDefault(_) => {
                        if self.outward(file, at) == Parent::VarInit(d) {
                            return true;
                        }
                        break;
                    }
                    Parent::None | Parent::File | Parent::Module(_) => break,
                    _ => at = self.outward(file, at),
                }
            }
        }
        // `isOuterVariable`, which goes by where the flow starts before that is moved out of function expressions.
        if self.flow_container(file, parent) == self.flow_container(file, Parent::Stmt(stmt)) {
            return false;
        }
        // `isNeverInitialized`: what has been done to it by the time this runs cannot be told, unless nothing ever gives it a value.
        let is_local_let = decl.kind == VarKind::Let
            && !decl.flags.contains(Flags::EXPORT)
            && (hir.has_module_syntax || !matches!(bound.stmt_parent[stmt.idx()], Parent::File));
        !(is_local_let
            && decl.pat == pat
            && decl.init.is_none()
            && !self.declares_loop_variable(file, stmt)
            && !self.is_assigned_definitely(file, symbol))
    }

    /// 2454: a variable is read where it may not have been given a value. `checkIdentifier`
    fn check_assigned_before_use(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if !self.p.files.options.strict_null_checks || hir.kind == FileKind::Declaration {
            return;
        }
        for i in 0..hir.exprs.len() {
            let e = ExprId(i as u32);
            let Some((pat, d)) = self.value_declaration_of_variable(file, e) else {
                continue;
            };
            let (decl, stmt) = (&hir[d], bound.var_stmt[d.idx()]);
            if stmt.is_none() {
                continue;
            }
            let around = bound.stmt_parent[stmt.idx()];
            let is_loop_variable = self.declares_loop_variable(file, stmt);
            let is_given_a_value = decl.init.is_some() || is_loop_variable;
            // Whether there is no way to what is written further down but through the declaration.
            let is_always_passed = match decl.kind {
                // Hoisted out of whatever it is written in.
                VarKind::Var => {
                    !is_loop_variable
                        && matches!(around, Parent::FnBody(_) | Parent::File | Parent::Module(_))
                }
                _ => match around {
                    Parent::Stmt(owner) if owner.is_some() => match hir[owner].kind {
                        // The clauses of a `switch` are one scope. As the whole body of an `if`, a loop or a label (1156) it is declared
                        // in the enclosing scope.
                        StmtKind::Switch { .. }
                        | StmtKind::If { .. }
                        | StmtKind::While { .. }
                        | StmtKind::DoWhile { .. }
                        | StmtKind::Labeled { .. } => false,
                        StmtKind::For { body, .. }
                        | StmtKind::ForIn { body, .. }
                        | StmtKind::ForOf { body, .. } => body != stmt,
                        _ => true,
                    },
                    _ => true,
                },
            };
            // Without a type or a value to go by it is `any`, or finds out its type as it goes.
            if (decl.ty.is_none() && !is_given_a_value)
                || (is_given_a_value
                    && is_always_passed
                    && hir.exprs[i].pos > hir[pat].pos
                    && !self.is_in_initializer_of(file, e, pat, d))
                || self.is_definite_assignment_target(file, e)
            {
                continue;
            }
            let declared = self.type_of_symbol(self.files().sym(file, bound.expr_symbol[i]));
            if !self.assumes_initialized(file, e, declared)
                && !self.contains_undefined(declared)
                && self.may_be_unassigned(file, e, declared)
            {
                out.push(Diagnostic {
                    start: hir.exprs[i].pos,
                    code: 2454,
                });
            }
        }
    }

    /// 2564: a property that has to hold something is left without a value by its declaration and by the constructor.
    /// `checkPropertyInitialization`
    fn check_properties_initialized(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let options = &self.p.files.options;
        if !options.strict_null_checks || !options.strict_property_initialization {
            return;
        }
        let hir = self.hir(file);
        if hir.kind == FileKind::Declaration {
            return;
        }
        for c in 0..hir.classes.len() {
            let class = &hir.classes[c];
            if class.flags.contains(Flags::AMBIENT) {
                continue;
            }
            let constructor = class
                .members
                .iter()
                .find(|&m| {
                    hir[m].kind == MemberKind::Constructor
                        && !matches!(hir[hir[m].func].body, FnBody::None)
                })
                .map(|m| hir[m].func);
            for m in class.members.iter() {
                let member = &hir[m];
                if member.kind != MemberKind::Property
                    || member.init.is_some()
                    || member.flags.intersects(
                        Flags::STATIC
                            | Flags::ABSTRACT
                            | Flags::AMBIENT
                            | Flags::DEFINITE
                            | Flags::OPTIONAL
                            | Flags::LITERAL_NAME,
                    )
                {
                    continue;
                }
                // What `this.name` or `this[key]` is known by where the constructor assigns to it, and `getTypeOfSymbol` of the
                // declaration: the type as it is declared, where `this` is still `this`.
                let (key, ty) = match self.member_name(file, member.key) {
                    Some(name) => {
                        let sym = self.files().sym(file, self.bound(file).class_symbol[c]);
                        let instance = self.declared_type(sym);
                        let Some((prop, _)) = self.prop_of(instance, name) else {
                            continue;
                        };
                        (Some(name), self.type_of_prop(&prop, MapperId::IDENTITY))
                    }
                    None => {
                        // `[k]: T` is held to it whatever `k` is.
                        let PropKey::Computed(k) = member.key else {
                            continue;
                        };
                        // What it is only matters where there is a constructor to go through.
                        let written = self.type_of_expr(file, k);
                        if constructor.is_some() && !self.is_known(written) {
                            continue;
                        }
                        (
                            self.access_key(file, k),
                            self.type_of_member_declaration(file, m),
                        )
                    }
                };
                if ty == TypeId::UNRESOLVED
                    || ty == TypeId::UNKNOWN
                    || self.is_any(ty)
                    || self.contains_undefined(ty)
                {
                    continue;
                }
                // `isPropertyInitializedInConstructor`
                let is_assigned = match (constructor, key) {
                    (Some(func), Some(key)) => self.is_assigned_in_constructor(file, func, key, ty),
                    _ => false,
                };
                if !is_assigned {
                    out.push(Diagnostic {
                        start: member.pos,
                        code: 2564,
                    });
                }
            }
        }
    }

    /// What the flow of control is followed within: from inside, what is declared outside has whatever value it was left with.
    /// `getControlFlowContainer`
    fn flow_container(&self, file: FileId, mut parent: Parent) -> Container {
        let bound = self.bound(file);
        loop {
            parent = match parent {
                Parent::Expr(x) => bound.expr_parent[x.idx()],
                Parent::Stmt(s) if s.is_some() => bound.stmt_parent[s.idx()],
                Parent::VarInit(d) => Parent::Stmt(bound.var_stmt[d.idx()]),
                Parent::Prop(p) => Parent::Expr(bound.prop_owner[p.idx()]),
                Parent::Case(c) => Parent::Stmt(bound.case_stmt[c.idx()]),
                // The default of a binding element is worked out where the pattern is.
                Parent::PatPropDefault(_) | Parent::PatElemDefault(_) => self.outward(file, parent),
                // What decorates a member or a parameter is inside of the member.
                Parent::Decorator(_, DecoratorOwner::Member(m)) => return Container::Member(m),
                Parent::Decorator(_, DecoratorOwner::Param(p)) => {
                    return Container::Fn(bound.param_fn[p.idx()]);
                }
                Parent::ClassExtends(c) | Parent::Decorator(c, DecoratorOwner::Class(_)) => {
                    match bound.class_owner[c.idx()] {
                        ClassOwner::Expr(x) => bound.expr_parent[x.idx()],
                        ClassOwner::Stmt(s) => bound.stmt_parent[s.idx()],
                    }
                }
                Parent::Key(owner) if owner.is_some() => bound.expr_parent[owner.idx()],
                Parent::FnBody(_) | Parent::ParamDefault(_) => {
                    let f = match parent {
                        Parent::FnBody(f) => f,
                        Parent::ParamDefault(p) => bound.param_fn[p.idx()],
                        _ => unreachable!(),
                    };
                    match self.what_runs_in_place(file, f) {
                        Some(it) => it,
                        None => return Container::Fn(f),
                    }
                }
                Parent::MemberInit(m) => return Container::Member(m),
                Parent::Module(m) => return Container::Module(m),
                Parent::File => return Container::File,
                _ => return Container::Other,
            };
        }
    }

    /// `getControlFlowContainer`: a static block is not like a function, and a function expression that is called where it is written
    /// (`GetImmediatelyInvokedFunctionExpression`), `async` or not, is part of what is around it. The class or the call, if `f` is one
    /// of these.
    fn what_runs_in_place(&self, file: FileId, f: FnId) -> Option<Parent> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        match (hir[f].kind, bound.fns[f.idx()].owner) {
            (FnKind::StaticBlock, FnOwner::Member(m)) => match bound.member_owner[m.idx()] {
                MemberOwner::Class(c) => Some(match bound.class_owner[c.idx()] {
                    ClassOwner::Expr(x) => Parent::Expr(x),
                    ClassOwner::Stmt(s) => Parent::Stmt(s),
                }),
                _ => None,
            },
            (FnKind::Expr | FnKind::Arrow, FnOwner::Expr(e))
                if self.is_immediately_invoked(file, f) =>
            {
                Some(bound.expr_parent[e.idx()])
            }
            _ => None,
        }
    }

    // ───────────────────────────── names nothing goes by ─────────────────────────────

    fn check_names(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let hir = self.hir(file);
        let bound = self.bound(file);
        for &(e, scope) in &bound.free_idents {
            let ExprKind::Ident(name) = hir[e].kind else {
                continue;
            };
            // `await x` where it cannot be: the parser took the keyword for a name, and has said what is wrong.
            if hir
                .early_errors
                .iter()
                .any(|&(start, code)| code == 1308 && start == hir[e].pos)
            {
                continue;
            }
            if matches!(bound.expr_parent[e.idx()], Parent::None)
                || matches!(name, known::undefined | known::globalThis)
                // What another declaration of the namespace or the enum around exports, in whichever file, is in scope too.
                || self.files().resolve_name(file, scope, name, SymFlags::VALUE).is_some()
            {
                continue;
            }
            // `RequireSymbol`: in JavaScript, `require(x)` needs no declaration. `(require)(x)` is not a require call (`IsRequireCall`).
            if let Parent::Expr(call) = bound.expr_parent[e.idx()]
                && hir.is_js
                && crate::bind::require_argument(hir, call).is_some()
                && matches!(hir[call].kind, ExprKind::Call(c) if hir[c].callee == e)
                && !is_parenthesized(hir, e)
            {
                continue;
            }
            // `checkExportAssignment`: `export = A` and `export default A` are about whatever `A` is. In a namespace they are out of
            // place, and `A` is not looked at.
            if let Parent::Stmt(s) = bound.expr_parent[e.idx()]
                && matches!(
                    hir[s].kind,
                    StmtKind::ExportAssign(_) | StmtKind::ExportDefault(_)
                )
                && (matches!(bound.stmt_parent[s.idx()], Parent::Module(m) if matches!(hir[m].name, ModuleName::Ident(_)))
                    || self
                        .files()
                        .resolve_name(file, scope, name, SymFlags::TYPE | SymFlags::NAMESPACE)
                        .is_some())
            {
                continue;
            }
            // `checkShorthandPropertyAssignment`: outside a destructuring pattern only the initializer of `{ a = 1 }` is checked.
            if let Parent::Expr(assign) = bound.expr_parent[e.idx()]
                && matches!(hir[assign].kind, ExprKind::Assign { op: None, target, .. } if target == e)
                && let Parent::Prop(p) = bound.expr_parent[assign.idx()]
                && hir[p].kind == PropKind::Shorthand
                && !self.is_assignment_target(file, bound.prop_owner[p.idx()])
            {
                continue;
            }
            let code = self.why_no_value(file, Some(e), scope, name);
            out.push(Diagnostic {
                start: hir[e].pos,
                code,
            });
        }
        // `getSymbol`: an alias is what it stands for. One that stands for no value is not there where a value is wanted, and the search
        // goes on further out.
        for &(e, scope) in &bound.alias_idents {
            let ExprKind::Ident(name) = hir[e].kind else {
                continue;
            };
            if matches!(bound.expr_parent[e.idx()], Parent::None)
                || self
                    .files()
                    .resolve_name(file, scope, name, SymFlags::VALUE)
                    .is_some()
            {
                continue;
            }
            // `checkExportAssignment`: `export = A` and `export default A` are about whatever `A` is.
            if let Parent::Stmt(s) = bound.expr_parent[e.idx()]
                && matches!(
                    hir[s].kind,
                    StmtKind::ExportAssign(_) | StmtKind::ExportDefault(_)
                )
            {
                continue;
            }
            let code = self.why_no_value(file, Some(e), scope, name);
            out.push(Diagnostic {
                start: hir[e].pos,
                code,
            });
        }
        for i in 0..hir.types.len() {
            if let TypeNodeKind::Import { name, .. } = hir.types[i].kind {
                if bound.type_scope[i].is_some() && !name.is_empty() {
                    self.check_import_type_names(file, TypeNodeId(i as u32), out);
                }
                continue;
            }
            let TypeNodeKind::Ref { name, .. } = hir.types[i].kind else {
                continue;
            };
            let scope = bound.type_scope[i];
            if scope.is_none() {
                continue;
            }
            let Some(first) = hir.ids(name).next() else {
                continue;
            };
            let start = hir.types[i].pos;
            if name.len() > 1 {
                let names: Vec<Atom> = hir.ids(name).collect();
                self.check_entity_name(file, scope, &names, start, SymFlags::TYPE, out);
                continue;
            }
            if self
                .files()
                .resolve_name(file, scope, first, SymFlags::TYPE)
                .is_none()
            {
                let is_primitive = matches!(
                    self.files().atoms.bytes(first),
                    b"any" | b"string" | b"number" | b"boolean" | b"never" | b"unknown"
                );
                let me = TypeNodeId(i as u32);
                let code = if is_primitive
                    && hir
                        .interfaces
                        .iter()
                        .any(|x| hir.ids(x.extends).any(|t| t == me))
                {
                    2840
                } else {
                    self.why_no_type(file, scope, first)
                };
                out.push(Diagnostic { start, code });
            }
        }
        // After `implements` the names of the primitive types are names like any other, and nothing goes by them.
        for class in &hir.classes {
            for node in hir.ids(class.implements) {
                let TypeNodeKind::Keyword(keyword) = hir[node].kind else {
                    continue;
                };
                let scope = bound.type_scope[node.idx()];
                let code = match keyword {
                    Keyword::Any
                    | Keyword::String
                    | Keyword::Number
                    | Keyword::Boolean
                    | Keyword::Never
                    | Keyword::Unknown => 2864,
                    Keyword::Undefined => 2749,
                    Keyword::Object | Keyword::Symbol | Keyword::BigInt if scope.is_some() => {
                        let text: &[u8] = match keyword {
                            Keyword::Object => b"object",
                            Keyword::Symbol => b"symbol",
                            _ => b"bigint",
                        };
                        let name = self.files().atoms.intern(text);
                        self.why_no_type(file, scope, name)
                    }
                    _ => continue,
                };
                out.push(Diagnostic {
                    start: hir[node].pos,
                    code,
                });
            }
        }
        // `checkImportEqualsDeclaration`: what `import a = A.B.C` names.
        for (i, import) in hir.import_equals.iter().enumerate() {
            let ImportEqualsTarget::Entity(list) = import.target else {
                continue;
            };
            let scope = bound.import_equals_scope[i];
            // `checkGrammarModuleElementContext`: anywhere but at the top of a file or a namespace it is left at that.
            if scope.is_none()
                || list.is_empty()
                || !matches!(
                    bound.scopes[scope.idx()].kind,
                    ScopeKind::File | ScopeKind::Module(_)
                )
            {
                continue;
            }
            let names: Vec<Atom> = hir.ids(list).collect();
            // Where the first name is written: past the name of the alias and the `=`. There is no text of a declaration file.
            let equals = skip_trivia(
                &hir.text,
                import.name_pos as usize + self.files().atoms.bytes(import.name).len(),
            );
            if hir.text.get(equals) != Some(&b'=') {
                continue;
            }
            let start = skip_trivia(&hir.text, equals + 1);
            if !hir
                .text
                .get(start..)
                .is_some_and(|rest| rest.starts_with(self.files().atoms.bytes(names[0])))
            {
                continue;
            }
            let start = start as u32;
            let before = out.len();
            self.check_entity_name(
                file,
                scope,
                &names,
                start,
                SymFlags::VALUE | SymFlags::TYPE | SymFlags::NAMESPACE,
                out,
            );
            // What was found and is a value is in a namespace that is one: only an alias that stands for nothing is looked at further.
            // `markLinkedReferences`: not where nothing is emitted, nor when imports stay as they are written.
            if out.len() == before
                || import.flags.contains(Flags::AMBIENT)
                || self.p.files.options.verbatim_module_syntax
            {
                continue;
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
                    !matches!(bound.expr_parent[e.idx()], Parent::None)
                        && !bound.is_in_type_query(e)
                        && bound.symbols[bound.expr_symbol[e.idx()].idx()]
                            .decls
                            .iter()
                            .any(|d| matches!(d, Decl::ImportEquals(x) if x.idx() == i))
                });
            // `markAliasSymbolAsReferenced`: the first name of an alias that is kept is looked up as a value as well.
            if is_referenced
                && self
                    .files()
                    .resolve_name(file, scope, names[0], SymFlags::VALUE)
                    .is_none()
            {
                let code = self.why_no_value(file, None, scope, names[0]);
                out.push(Diagnostic { start, code });
            }
        }
    }

    /// `resolveEntityName` with its errors: the first name of `A.B.C` has to be a namespace, the others exported. `start`: where the
    /// first is written. `meaning`: what the last has to be.
    fn check_entity_name(
        &mut self,
        file: FileId,
        scope: ScopeId,
        names: &[Atom],
        start: u32,
        meaning: SymFlags,
        out: &mut Vec<Diagnostic>,
    ) {
        let first = names[0];
        if first == known::globalThis {
            return;
        }
        if self
            .files()
            .resolve_name(file, scope, first, SymFlags::NAMESPACE)
            .is_some()
        {
            if names.len() > 1 {
                self.check_qualified_name(file, scope, names, start, meaning, out);
            }
            return;
        }
        // `checkAndReportErrorForUsingTypeAsNamespace`
        let as_type = self
            .files()
            .resolve_name(file, scope, first, SymFlags::TYPE)
            .and_then(|s| self.files().resolve_alias_as(s, SymFlags::TYPE));
        let code = match as_type {
            Some(sym) if self.files().flags(sym).intersects(SymFlags::TYPE) => {
                let declared = self.declared_type(sym);
                if names.len() > 1 && self.has_property(declared, names[1]) {
                    2713
                } else {
                    2702
                }
            }
            // `onFailedToResolveSymbol`: a library that is missing comes before a letter that is.
            _ if !is_name_of_a_library_feature(self.files().atoms.bytes(first))
                && self.is_something_similar_in_scope(file, scope, first, SymFlags::NAMESPACE) =>
            {
                2833
            }
            _ => 2503,
        };
        out.push(Diagnostic { start, code });
    }

    /// `getTypeFromImportTypeNode`: 2694, each name after `import("m")` has to be there.
    fn check_import_type_names(
        &mut self,
        file: FileId,
        node: TypeNodeId,
        out: &mut Vec<Diagnostic>,
    ) {
        let hir = self.hir(file);
        let TypeNodeKind::Import {
            spec,
            name,
            is_typeof,
            mode,
            ..
        } = hir[node].kind
        else {
            return;
        };
        let text = &hir.text[..];
        let mode = self.files().mode_of_import(file, mode);
        // Of a module that is not found that much has been said.
        let Some(module) = self.files().module_of_specifier_as(file, spec, mode) else {
            return;
        };
        let mut sym = self.files().module_value(module);
        // What `export =` gives could not be found; what a JSON file has is up to what is in it.
        if self.files().flags(sym).contains(SymFlags::ALIAS)
            || self.files().hir(module.file).kind == FileKind::Json
        {
            return;
        }
        // Past the `)` that closes `import(`.
        let mut at = skip_trivia(text, hir[node].pos as usize);
        while text.get(at).is_some_and(|&c| c != b'(') {
            at = skip_trivia(text, at + 1);
        }
        let mut depth = 0u32;
        loop {
            let Some(&c) = text.get(at) else { return };
            at += 1;
            match c {
                b'(' | b'{' => depth += 1,
                b')' | b'}' => {
                    depth -= 1;
                    if depth == 0 {
                        break;
                    }
                }
                b'"' | b'\'' => {
                    while text.get(at).is_some_and(|&x| x != c) {
                        at += if text[at] == b'\\' { 2 } else { 1 };
                    }
                    at += 1;
                }
                _ => {}
            }
            at = skip_trivia(text, at);
        }
        // In `typeof import("m").a.b`: the type the names so far come to, once they are past what modules and namespaces export.
        let mut ty: Option<TypeId> = None;
        for (i, n) in hir.ids(name).enumerate() {
            at = skip_trivia(text, at);
            if text.get(at) != Some(&b'.') {
                return;
            }
            at = skip_trivia(text, at + 1);
            let written = self.files().atoms.bytes(n);
            if !text.get(at..).is_some_and(|rest| rest.starts_with(written)) {
                return;
            }
            let wanted = if is_typeof {
                SymFlags::VALUE
            } else if i + 1 == name.len() {
                SymFlags::TYPE
            } else {
                SymFlags::NAMESPACE
            };
            // `getSymbol`, `symbolIsValueEx`: an alias is what it stands for, be it exported as a type only.
            let exported = match if ty.is_none() {
                self.files().namespace_member(sym, n)
            } else {
                None
            } {
                Some(member) if self.files().flags(member).intersects(wanted) => Some(member),
                Some(member) => match self.files().resolve_alias_if_needed(member) {
                    Some(target) => self
                        .files()
                        .flags(target)
                        .intersects(wanted)
                        .then_some(target),
                    // What it stands for cannot be told.
                    None => return,
                },
                None => None,
            };
            let is_there = match exported {
                Some(exported) => {
                    sym = exported;
                    true
                }
                // `getPropertyOfTypeEx`: the properties of the type of a value are there as well. `any` has none.
                None if is_typeof => {
                    let of = match ty {
                        Some(ty) => ty,
                        None => self.type_of_symbol(sym),
                    };
                    if !self.is_known(of) {
                        return;
                    }
                    ty = if of == TypeId::ANY {
                        None
                    } else {
                        self.type_of_property(of, n)
                    };
                    ty.is_some()
                }
                None => false,
            };
            if !is_there {
                out.push(Diagnostic {
                    start: at as u32,
                    code: 2694,
                });
                return;
            }
            at += written.len();
        }
    }

    /// 2314, 2707, 2315: a reference to a type with the wrong number of type arguments. 8026, 8027 for a heritage clause element in
    /// JavaScript. `getTypeReferenceType`
    fn check_type_argument_counts(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let hir = self.hir(file);
        let bound = self.bound(file);
        // `isJsImplicitAny`
        let is_js_implicit_any = hir.is_js && !self.p.files.options.no_implicit_any;
        for i in 0..hir.types.len() {
            if bound.type_scope[i].is_none() {
                continue;
            }
            let (sym, given) = match hir.types[i].kind {
                TypeNodeKind::Ref { name, args } => {
                    let mut names = [Atom::NONE; 8];
                    if name.len() > names.len() {
                        continue;
                    }
                    for (slot, part) in names.iter_mut().zip(hir.ids(name)) {
                        *slot = part;
                    }
                    let Some(sym) = self.files().resolve_entity(
                        file,
                        bound.type_scope[i],
                        &names[..name.len()],
                        SymFlags::TYPE,
                    ) else {
                        continue;
                    };
                    // `resolveEntityName`: an alias is followed as far as the first symbol that is a type itself.
                    let Some(sym) = self.files().resolve_alias_as(sym, SymFlags::TYPE) else {
                        continue;
                    };
                    (sym, args.len())
                }
                // `resolveImportSymbolType`: `import("m").A<T>` is read the same way. Found as `getTypeFromImportTypeNode` finds it.
                TypeNodeKind::Import {
                    spec,
                    name,
                    args,
                    is_typeof: false,
                    mode,
                } => {
                    let mode = self.files().mode_of_import(file, mode);
                    let Some(module) = self.files().module_of_specifier_as(file, spec, mode) else {
                        continue;
                    };
                    let mut found = Some(self.files().module_value(module));
                    for (k, n) in hir.ids(name).enumerate() {
                        let wanted = if k + 1 == name.len() {
                            SymFlags::TYPE
                        } else {
                            SymFlags::NAMESPACE
                        };
                        found = found
                            .and_then(|sym| self.files().namespace_member(sym, n))
                            .and_then(|member| self.files().resolve_alias_as(member, wanted))
                            .filter(|&next| self.files().flags(next).intersects(wanted));
                    }
                    let Some(sym) = found else { continue };
                    (sym, args.len())
                }
                _ => continue,
            };
            // Of what is no type nothing is said here.
            let flags = self.files().flags(sym);
            if !flags.intersects(SymFlags::TYPE) {
                continue;
            }
            let Some(code) = self.why_wrong_type_argument_count(sym, given) else {
                continue;
            };
            // `getTypeFromClassOrInterfaceReference`. Type aliases and 2315 (`checkNoTypeArguments`) are the same in JavaScript.
            let code = if hir.is_js
                && code != 2315
                && flags.intersects(SymFlags::CLASS | SymFlags::INTERFACE)
            {
                if is_js_implicit_any {
                    continue;
                }
                // `missingAugmentsTag`, `IsExpressionWithTypeArguments`: an element of `implements`, or of the `extends` of an interface.
                let node = TypeNodeId(i as u32);
                let is_heritage_element = hir
                    .classes
                    .iter()
                    .any(|c| hir.ids(c.implements).any(|t| t == node))
                    || hir
                        .interfaces
                        .iter()
                        .any(|x| hir.ids(x.extends).any(|t| t == node));
                match code {
                    2314 if is_heritage_element => 8026,
                    2707 if is_heritage_element => 8027,
                    code => code,
                }
            } else {
                code
            };
            out.push(Diagnostic {
                start: hir.types[i].pos,
                code,
            });
        }
        // `resolveBaseTypesOfClass`: what a class extends, if that is a class, is read like a reference to its type.
        for c in 0..hir.classes.len() {
            let class = &hir.classes[c];
            if class.extends.is_none()
                || bound.class_symbol[c].is_none()
                || matches!(bound.expr_parent[class.extends.idx()], Parent::None)
            {
                continue;
            }
            let constructor = self.type_of_expr(file, class.extends);
            if !self.is_known(constructor) || self.is_uncertain(file, class.extends) {
                continue;
            }
            let constructor = self.apparent_type(constructor);
            let TypeData::Anon {
                origin: Origin::ClassStatic(base),
                ..
            } = *self.data(constructor)
            else {
                continue;
            };
            // `areAllOuterTypeParametersApplied`: a class declared where type parameters can be mentioned goes by its construct
            // signatures. `getBaseConstructorTypeOfClass`: a class that comes back to itself extends what is in error.
            if !self.outer_type_params_of_symbol(base).is_empty()
                || self.extends_itself_as_written(self.class_sym(file, ClassId(c as u32)))
            {
                continue;
            }
            if let Some(code) = self.why_wrong_type_argument_count(base, class.extends_args.len()) {
                // `isJsImplicitAny`, `missingAugmentsTag`. 2315 is `checkNoTypeArguments`, which is the same in JavaScript.
                let code = match code {
                    2314 | 2707 if is_js_implicit_any => continue,
                    2314 if hir.is_js => 8026,
                    2707 if hir.is_js => 8027,
                    code => code,
                };
                out.push(Diagnostic {
                    start: self.start_of(file, class.extends),
                    code,
                });
            }
        }
    }

    /// `getTypeFromClassOrInterfaceReference`, `getTypeFromTypeAliasReference`, `checkNoTypeArguments`: what is said of `given` type
    /// arguments for `sym`, if that is not a number it takes.
    fn why_wrong_type_argument_count(&self, sym: Sym, given: usize) -> Option<u32> {
        let (least, most) = self.type_argument_arity(sym);
        if given >= least && given <= most {
            None
        } else if most == 0 {
            Some(2315)
        } else if least == most {
            Some(2314)
        } else {
            Some(2707)
        }
    }

    /// `onFailedToResolveSymbol`: `name` is written where a value goes and no value goes by it. `e`: the identifier, if it is an
    /// expression, which the first name of `import a = b.c` is not.
    fn why_no_value(&mut self, file: FileId, e: Option<ExprId>, scope: ScopeId, name: Atom) -> u32 {
        if let Some(code) = self.what_is_there_instead_of_a_value(file, e, scope, name) {
            return code;
        }
        let code = self.not_found(file, scope, name, SymFlags::VALUE);
        // `getCannotFindNameDiagnosticForName`: `await(x)` and `f(await)` were meant to await. Parentheses around the name come between
        // it and the call.
        if code == 2304
            && self.files().atoms.bytes(name) == b"await"
            && let Some(e) = e
            && matches!(self.bound(file).expr_parent[e.idx()], Parent::Expr(p) if matches!(self.hir(file)[p].kind, ExprKind::Call(_) | ExprKind::ImportCall(_)))
            && !self.is_written_in_parentheses(file, e)
        {
            return 2311;
        }
        code
    }

    /// `onFailedToResolveSymbol` for a value name that is not written where the error goes: what a tag is made with. `otherwise`: what
    /// the one who looks for it says of a name that is not found.
    pub(super) fn why_no_jsx_factory(
        &mut self,
        file: FileId,
        scope: ScopeId,
        name: Atom,
        otherwise: u32,
    ) -> u32 {
        if let Some(code) = self.what_is_there_instead_of_a_value(file, None, scope, name) {
            return code;
        }
        // A library that is missing comes before a letter that is.
        if !is_name_of_a_library_feature(self.files().atoms.bytes(name))
            && self.is_something_similar_in_scope(file, scope, name, SymFlags::VALUE)
        {
            return 2552;
        }
        otherwise
    }

    /// What `onFailedToResolveSymbol` starts with, where a value is wanted: what is said if something that is no value goes by `name`, or
    /// a member that takes a prefix. `e` as in `why_no_value`.
    fn what_is_there_instead_of_a_value(
        &mut self,
        file: FileId,
        e: Option<ExprId>,
        scope: ScopeId,
        name: Atom,
    ) -> Option<u32> {
        if let Some(e) = e
            && let Some(code) = self.member_meant_without_prefix(file, e, name)
        {
            return Some(code);
        }
        if e.is_some_and(|e| self.is_extending_interface(file, e)) {
            return Some(2689);
        }
        if self
            .files()
            .resolve_name(file, scope, name, SymFlags::NAMESPACE_MODULE)
            .is_some_and(|s| self.resolved_flags(s).contains(SymFlags::NAMESPACE_MODULE))
        {
            return Some(2708);
        }
        let text = self.files().atoms.bytes(name);
        if matches!(
            text,
            b"any" | b"string" | b"number" | b"boolean" | b"never" | b"unknown"
        ) {
            // The name is all that is extended: not `(string)`.
            let is_extended = e.is_some_and(|e| {
                matches!(
                    self.bound(file).expr_parent[e.idx()],
                    Parent::ClassExtends(_)
                ) && !self.is_written_in_parentheses(file, e)
            });
            return Some(if is_extended { 2863 } else { 2693 });
        }
        if let Some(sym) = self.files().resolve_name(file, scope, name, SymFlags::TYPE)
            && !e.is_some_and(|e| self.is_type_param_out_of_sight(file, e, sym))
        {
            let flags = self.resolved_flags(sym);
            if flags.intersects(SymFlags::TYPE) && !flags.intersects(SymFlags::VALUE) {
                return Some(
                    if matches!(
                        text,
                        b"Promise" | b"Symbol" | b"Map" | b"WeakMap" | b"Set" | b"WeakSet"
                    ) {
                        2585
                    } else {
                        2693
                    },
                );
            }
        }
        None
    }

    /// `checkAndReportErrorForExtendingInterface`: `e` is the dotted name that a class extends or that is given type arguments (an
    /// `ExpressionWithTypeArguments` either way), or the left part of it, and the whole name is that of an interface.
    pub(super) fn is_extending_interface(&self, file: FileId, e: ExprId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        // `getEntityNameForExtendingInterface`
        let mut top = e;
        let class = loop {
            match bound.expr_parent[top.idx()] {
                Parent::Expr(p) if p.is_some() => match hir[p].kind {
                    ExprKind::Dot { .. } => top = p,
                    ExprKind::Instantiation { .. } => break None,
                    _ => return false,
                },
                Parent::ClassExtends(c) => break Some(c),
                _ => return false,
            }
        };
        let mut names = [Atom::NONE; 8];
        let (mut n, mut at) = (0, top);
        loop {
            // `IsEntityNameExpression`: `(M.I)` is none, nor is `(M).I`.
            if n == names.len() || self.is_written_in_parentheses(file, at) {
                return false;
            }
            match hir[at].kind {
                ExprKind::Dot { obj, name, .. } => {
                    names[n] = name;
                    n += 1;
                    at = obj;
                }
                ExprKind::Ident(name) => {
                    names[n] = name;
                    n += 1;
                    break;
                }
                _ => return false,
            }
        }
        names[..n].reverse();
        // The scope the first name is written in, which but for what a class extends is only kept of names that are no values.
        let scope = match class {
            Some(c) => bound.class_scope[c.idx()],
            None => match bound
                .free_idents
                .iter()
                .chain(&bound.alias_idents)
                .find(|ident| ident.0 == at)
            {
                Some(ident) => ident.1,
                None => return false,
            },
        };
        self.files()
            .resolve_entity(file, scope, &names[..n], SymFlags::INTERFACE)
            .is_some_and(|s| self.resolved_flags(s).contains(SymFlags::INTERFACE))
    }

    /// `NameResolver.Resolve`: the type parameters of a class are not seen from what it extends, from its static members or from the
    /// computed names of its members, nor those of an interface from the computed names of its members: the search ends there, with
    /// nothing. Whether `sym`, which `e` would mean as a type, is such a type parameter.
    fn is_type_param_out_of_sight(&self, file: FileId, e: ExprId, sym: Sym) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if sym.file != file {
            return false;
        }
        let Some(&Decl::TypeParam(tp)) = self.files().symbol(sym).decls.first() else {
            return false;
        };
        let declared_in = bound.type_param_scope[tp.idx()];
        if declared_in.is_none() {
            return false;
        }
        let owner = match bound.scopes[declared_in.idx()].kind {
            ScopeKind::Class(c) => MemberOwner::Class(c),
            ScopeKind::Interface(i) => MemberOwner::Interface(i),
            _ => return false,
        };
        let is_own = |m: MemberId| bound.member_owner[m.idx()] == owner;
        let is_static = |m: MemberId| hir[m].flags.contains(Flags::STATIC);
        // An enum, an interface or a type literal has no place among the expressions: it is in the function its scope is in.
        let scope_of = |kind: ScopeKind| {
            bound
                .scopes
                .iter()
                .position(|s| s.kind == kind)
                .map_or(ScopeId::NONE, |s| ScopeId(s as u32))
        };
        let fn_around = |mut scope: ScopeId| loop {
            if scope.is_none() {
                return Parent::None;
            }
            match bound.scopes[scope.idx()].kind {
                ScopeKind::Fn(f) => return Parent::FnBody(f),
                _ => scope = bound.scopes[scope.idx()].parent,
            }
        };
        // The expression gone out of last: a computed name is known by it.
        let mut below = e;
        let mut parent = bound.expr_parent[e.idx()];
        loop {
            parent = match parent {
                Parent::Expr(x) if x.is_some() => {
                    below = x;
                    bound.expr_parent[x.idx()]
                }
                Parent::ClassExtends(c) if owner == MemberOwner::Class(c) => return true,
                // A decorator is looked up from the member it is on, or whose parameter it is on.
                Parent::MemberInit(m) | Parent::Decorator(_, DecoratorOwner::Member(m))
                    if is_own(m) =>
                {
                    return is_static(m);
                }
                Parent::ParamDefault(p) | Parent::Decorator(_, DecoratorOwner::Param(p)) => {
                    Parent::FnBody(bound.param_fn[p.idx()])
                }
                Parent::FnBody(f) => match bound.fns[f.idx()].owner {
                    FnOwner::Member(m) if is_own(m) => return is_static(m),
                    _ => self.outward(file, parent),
                },
                Parent::Key(_) | Parent::MemberKey => match self.what_is_named(file, parent, below)
                {
                    Named::Property(literal) | Named::Function(literal) => Parent::Expr(literal),
                    Named::Element(p) => self.outward(file, Parent::PatPropDefault(p)),
                    Named::Member(m) if is_own(m) => return true,
                    Named::Member(m) => match bound.member_owner[m.idx()] {
                        MemberOwner::Interface(i) => fn_around(scope_of(ScopeKind::Interface(i))),
                        MemberOwner::TypeLiteral(t) => fn_around(bound.type_scope[t.idx()]),
                        _ => self.parent_of(file, Parent::MemberInit(m)),
                    },
                    Named::Unknown => return false,
                },
                Parent::EnumInit(m) => {
                    fn_around(scope_of(ScopeKind::Enum(bound.enum_member_owner[m.idx()])))
                }
                Parent::None | Parent::File | Parent::Module(_) | Parent::Expr(_) => return false,
                other => self.outward(file, other),
            };
        }
    }

    /// `name` is written where a type goes and no type goes by it.
    fn why_no_type(&mut self, file: FileId, scope: ScopeId, name: Atom) -> u32 {
        if self
            .files()
            .resolve_name(file, scope, name, SymFlags::MODULE)
            .is_some_and(|s| self.resolved_flags(s).intersects(SymFlags::MODULE))
        {
            return 2709;
        }
        if let Some(sym) = self
            .files()
            .resolve_name(file, scope, name, SymFlags::VALUE)
        {
            let flags = self.resolved_flags(sym);
            if flags.intersects(SymFlags::VALUE) && !flags.intersects(SymFlags::NAMESPACE) {
                return 2749;
            }
        }
        self.not_found(file, scope, name, SymFlags::TYPE)
    }

    /// `getSymbolFlags`. Of an alias that leads nowhere, nothing.
    fn resolved_flags(&self, sym: Sym) -> SymFlags {
        let flags = self.files().symbol_flags(sym);
        if flags == SymFlags::all() {
            SymFlags::empty()
        } else {
            flags
        }
    }

    fn not_found(&mut self, file: FileId, scope: ScopeId, name: Atom, meaning: SymFlags) -> u32 {
        let text = self.files().atoms.bytes(name);
        if !is_name_of_a_library_feature(text)
            && self.is_something_similar_in_scope(file, scope, name, meaning)
        {
            return 2552;
        }
        // `getCannotFindNameDiagnosticForName`. `UsesWildcardTypes`: there is nothing to add to `types` then.
        let takes_all_types = self
            .p
            .files
            .options
            .types
            .as_ref()
            .is_some_and(|t| t.iter().any(|t| t == "*"));
        match text {
            b"document" | b"console" => 2584,
            b"$" => {
                if takes_all_types {
                    2581
                } else {
                    2592
                }
            }
            b"beforeEach" | b"describe" | b"suite" | b"it" | b"test" => {
                if takes_all_types {
                    2582
                } else {
                    2593
                }
            }
            b"process" | b"require" | b"Buffer" | b"module" | b"NodeJS" => {
                if takes_all_types {
                    2580
                } else {
                    2591
                }
            }
            b"Bun" => {
                if takes_all_types {
                    2867
                } else {
                    2868
                }
            }
            b"Map"
            | b"Set"
            | b"Promise"
            | b"WeakMap"
            | b"WeakSet"
            | b"Iterator"
            | b"AsyncIterator"
            | b"SharedArrayBuffer"
            | b"Atomics"
            | b"AsyncIterable"
            | b"AsyncIterableIterator"
            | b"AsyncGenerator"
            | b"AsyncGeneratorFunction"
            | b"BigInt"
            | b"Reflect"
            | b"BigInt64Array"
            | b"BigUint64Array" => 2583,
            _ => 2304,
        }
    }

    /// `getPropertyOfType`: whether `ty` has a property `name`, what every function and every object has included. What an index
    /// signature covers is no property.
    fn has_property(&mut self, ty: TypeId, name: Atom) -> bool {
        let ty = self.apparent_type(ty);
        if let TypeData::Union(parts) = self.data(ty) {
            return parts.iter().all(|&part| self.has_property(part, name));
        }
        if self.prop_of(ty, name).is_some() {
            return true;
        }
        let Some(members) = self.members(ty) else {
            return false;
        };
        let (is_called, is_constructed) = (
            !members.shape().call.is_empty(),
            !members.shape().construct.is_empty(),
        );
        if is_called || is_constructed {
            let strict = if is_called {
                known::CallableFunction
            } else {
                known::NewableFunction
            };
            let function = if self.p.files.options.strict_bind_call_apply {
                strict
            } else {
                known::Function
            };
            for global in [function, known::Function] {
                let function = self.global_ref(global, &[]);
                if self.prop_of(function, name).is_some() {
                    return true;
                }
            }
        }
        let object = self.global_ref(known::Object, &[]);
        self.prop_of(object, name).is_some()
    }

    /// `x` where `this.x` or `C.x` was meant: 2663, 2662. `checkAndReportErrorForMissingPrefix`
    fn member_meant_without_prefix(&mut self, file: FileId, e: ExprId, name: Atom) -> Option<u32> {
        let hir = self.hir(file);
        let bound = self.bound(file);
        if bound.is_in_type_query(e) {
            return None;
        }
        // The expression gone out of last: a computed name is known by it.
        let mut below = e;
        let mut parent = bound.expr_parent[e.idx()];
        // Whether what `this` belongs to has been passed on the way out.
        let mut past_this = false;
        loop {
            // What is gone out of, and the member of it whose body or initializer led there.
            let (owner, member) = match parent {
                Parent::Expr(x) if x.is_some() => {
                    below = x;
                    parent = bound.expr_parent[x.idx()];
                    continue;
                }
                Parent::Stmt(_)
                | Parent::VarInit(_)
                | Parent::Prop(_)
                | Parent::Case(_)
                | Parent::PatPropDefault(_)
                | Parent::PatElemDefault(_) => {
                    parent = self.outward(file, parent);
                    continue;
                }
                Parent::FnBody(_) | Parent::ParamDefault(_) => {
                    let f = match parent {
                        Parent::FnBody(f) => f,
                        Parent::ParamDefault(p) => bound.param_fn[p.idx()],
                        _ => unreachable!(),
                    };
                    match bound.fns[f.idx()].owner {
                        FnOwner::Member(m) => (bound.member_owner[m.idx()], Some(m)),
                        FnOwner::Expr(x) => {
                            past_this |= hir[f].kind != FnKind::Arrow;
                            parent = Parent::Expr(x);
                            continue;
                        }
                        FnOwner::Stmt(s) => {
                            past_this = true;
                            parent = Parent::Stmt(s);
                            continue;
                        }
                        _ => return None,
                    }
                }
                Parent::MemberInit(m) => (bound.member_owner[m.idx()], Some(m)),
                Parent::ClassExtends(c) | Parent::Decorator(c, _) => (MemberOwner::Class(c), None),
                Parent::Key(_) | Parent::MemberKey => match self.what_is_named(file, parent, below)
                {
                    Named::Property(literal) | Named::Function(literal) => {
                        parent = Parent::Expr(literal);
                        continue;
                    }
                    Named::Element(p) => {
                        parent = self.outward(file, Parent::PatPropDefault(p));
                        continue;
                    }
                    Named::Member(m) => (bound.member_owner[m.idx()], None),
                    Named::Unknown => return None,
                },
                _ => return None,
            };
            let MemberOwner::Class(c) = owner else {
                return None;
            };
            // `getThisContainer`: what a class extends, its decorators and the computed names of its members have the `this` of where
            // the class is. Past what `this` belongs to, whatever is written in a class is in it.
            if member.is_some() || past_this {
                let class = self.files().sym(file, bound.class_symbol[c.idx()]);
                let constructor = self.type_of_symbol(class);
                if self.has_property(constructor, name) {
                    return Some(2662);
                }
                if !past_this && member.is_some_and(|m| !hir[m].flags.contains(Flags::STATIC)) {
                    let instance = self.declared_type(class);
                    if self.has_property(instance, name) {
                        return Some(2663);
                    }
                }
                past_this = true;
            }
            parent = match bound.class_owner[c.idx()] {
                ClassOwner::Expr(x) => Parent::Expr(x),
                ClassOwner::Stmt(s) => Parent::Stmt(s),
            };
        }
    }

    /// Whether a name close enough to `name` to have been meant can be seen from `scope`.
    fn is_something_similar_in_scope(
        &self,
        file: FileId,
        mut scope: ScopeId,
        name: Atom,
        meaning: SymFlags,
    ) -> bool {
        let files = self.files();
        let bound = self.bound(file);
        let text = files.atoms.bytes(name);
        let fits = |sym: Sym| {
            let flags = files.flags(sym);
            flags.intersects(meaning)
                || (flags.contains(SymFlags::ALIAS) && self.resolved_flags(sym).intersects(meaning))
        };
        while scope.is_some() {
            let s = &bound.scopes[scope.idx()];
            let exports = if s.symbol.is_some() {
                bound.symbols[s.symbol.idx()].exports
            } else {
                TableId::NONE
            };
            for table in [s.locals, exports] {
                for &(candidate, id) in bound.table(table) {
                    if is_close(text, files.atoms.bytes(candidate)) && fits(files.sym(file, id)) {
                        return true;
                    }
                }
            }
            scope = s.parent;
        }
        // `getPrimitiveTypeAliasSuggestions`: the names of the primitive types count as type aliases, each where what wraps it is declared.
        let primitives: [(&[u8], Atom); 6] = [
            (b"string", known::String),
            (b"number", known::Number),
            (b"boolean", known::Boolean),
            (b"object", known::Object),
            (b"bigint", known::BigInt),
            (b"symbol", known::Symbol),
        ];
        if meaning.intersects(SymFlags::TYPE_ALIAS)
            && primitives.iter().any(|&(primitive, wrapper)| {
                is_close(text, primitive) && files.globals.contains_key(&wrapper)
            })
        {
            return true;
        }
        // `undefinedSymbol`, a property, and `globalThisSymbol`, a module, are entries of `globals` too.
        if meaning.intersects(SymFlags::VARIABLE) && is_close(text, b"undefined")
            || meaning.intersects(SymFlags::MODULE) && is_close(text, b"globalThis")
        {
            return true;
        }
        files
            .globals
            .iter()
            .any(|(&candidate, &sym)| is_close(text, files.atoms.bytes(candidate)) && fits(sym))
    }
}

fn trace_pass(path: &str, pass: &str, before: &[Diagnostic], after: &[Diagnostic]) {
    for d in after.iter().filter(|d| !before.contains(d)) {
        eprintln!("PASS\t{path}\t{}\t{}\tadded by\t{pass}", d.start, d.code);
    }
    for d in before.iter().filter(|d| !after.contains(d)) {
        eprintln!("PASS\t{path}\t{}\t{}\tREMOVED by\t{pass}", d.start, d.code);
    }
}

/// Whether an entry of `early_errors` is a parser or scanner diagnostic (`SourceFile.Diagnostics()`).
fn is_syntactic_early_error(hir: &hir::File, start: u32, code: u32) -> bool {
    // `parse_for_sema` sets the flag by who logged each error. Without it, a code the parser shares with the checker (1005 18016 ..) is
    // the checker's. It is not set for declaration files.
    if !hir.has_parse_diagnostics && hir.kind != FileKind::Declaration {
        return false;
    }
    match code {
        // `createIdentifier` reports a reserved word. For `await` and `yield` it is the binder's `checkContextualIdentifier`.
        1359 => !hir
            .text
            .get(start as usize..)
            .is_some_and(|word| word.starts_with(b"await") || word.starts_with(b"yield")),
        // `reportObviousDecoratorErrors`, `checkGrammarModifiers`
        1206 | 8038 => false,
        _ => errors_js::SYNTACTIC_ERRORS.binary_search(&code).is_ok(),
    }
}

/// Codes that are not reported in a file with parse diagnostics (`hasParseDiagnostics`). Only for diagnostics that are not the parser's own.
fn is_grammar_error(code: u32) -> bool {
    errors_js::GRAMMAR_ERRORS.binary_search(&code).is_ok()
        || matches!(
            code,
            // The parser has these codes too. The checker reports them through `grammarErrorOnNode` and its like.
            1003 | 1005 | 1110 | 1142 | 1206 | 1433 | 1453 | 8038
                // The message reaches `grammarErrorOnNode` and its like through a variable or a parameter, or is added under
                // `!hasParseDiagnostics`.
                | 1009 | 1013 | 1025 | 1091 | 1103..=1105 | 1115 | 1116 | 1162 | 1165 | 1166 | 1168..=1170 | 1184 | 1188..=1190
                | 1231..=1235 | 1244 | 1253 | 1255 | 1258 | 1263 | 1264 | 1276 | 1308 | 1309 | 1375 | 1378 | 1431 | 1432 | 1473
                | 1474 | 1497 | 2206 | 2207 | 2404 | 2483 | 2852..=2854 | 17019 | 17020
                // `checkContextualIdentifier`, `checkPrivateIdentifier` (binder)
                | 1212..=1214 | 1262 | 1359 | 18012
        )
}

/// Names that come with a version of the standard library: what is missing then is the library, not a letter. The keys of
/// `getFeatureMap`.
fn is_name_of_a_library_feature(name: &[u8]) -> bool {
    matches!(
        name,
        b"Array"
            | b"Iterator"
            | b"AsyncIterator"
            | b"ArrayBuffer"
            | b"Atomics"
            | b"SharedArrayBuffer"
            | b"AsyncIterable"
            | b"AsyncIterableIterator"
            | b"AsyncGenerator"
            | b"AsyncGeneratorFunction"
            | b"RegExp"
            | b"RegExpConstructor"
            | b"Reflect"
            | b"ArrayConstructor"
            | b"ObjectConstructor"
            | b"NumberConstructor"
            | b"Math"
            | b"Map"
            | b"MapConstructor"
            | b"Set"
            | b"PromiseConstructor"
            | b"Symbol"
            | b"WeakMap"
            | b"WeakSet"
            | b"String"
            | b"StringConstructor"
            | b"DateTimeFormat"
            | b"Promise"
            | b"RegExpMatchArray"
            | b"RegExpExecArray"
            | b"Intl"
            | b"NumberFormat"
            | b"SymbolConstructor"
            | b"DataView"
            | b"BigInt"
            | b"RelativeTimeFormat"
            | b"Int8Array"
            | b"Uint8Array"
            | b"Uint8ClampedArray"
            | b"Int16Array"
            | b"Uint16Array"
            | b"Int32Array"
            | b"Uint32Array"
            | b"Float16Array"
            | b"Float32Array"
            | b"Float64Array"
            | b"BigInt64Array"
            | b"BigUint64Array"
            | b"Error"
            | b"ErrorConstructor"
            | b"Uint8ArrayConstructor"
            | b"DisposableStack"
            | b"AsyncDisposableStack"
            | b"Date"
    )
}

fn is_parenthesized(hir: &hir::File, e: ExprId) -> bool {
    hir.parens.binary_search_by_key(&e.0, |p| p.0.0).is_ok()
}

/// `IsRequireCall` with `requireStringLiteralLikeArgument`: the argument of `require("m")` and its text. Parentheses around `require` or
/// around the string make it an ordinary call.
fn require_call_argument(hir: &hir::File, call: ExprId) -> Option<(ExprId, Atom)> {
    let argument = crate::bind::require_argument(hir, call)?;
    let (ExprKind::Call(c), ExprKind::String(spec)) = (hir[call].kind, hir[argument].kind) else {
        return None;
    };
    (!is_parenthesized(hir, hir[c].callee) && !is_parenthesized(hir, argument))
        .then_some((argument, spec))
}

/// `SkipTrivia`: past the blanks and comments at `at`.
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
                at += 2;
                while at < text.len() && !text[at..].starts_with(b"*/") {
                    at += 1;
                }
                at = (at + 2).min(text.len());
            }
            _ => return at,
        }
    }
}

/// Where the `type` of `import type name` is written. `name`: where the name is.
fn start_of_type_keyword(text: &[u8], name: u32) -> Option<u32> {
    let at = text
        .get(..name as usize)?
        .windows(4)
        .rposition(|w| w == b"type")?;
    (skip_trivia(text, at + 4) == name as usize).then_some(at as u32)
}

/// Where the token `written` that comes right before `at` starts, blanks and comments aside. `None`: something else is written there.
fn start_of_token_before(text: &[u8], at: u32, written: &[u8]) -> Option<u32> {
    let mut end = (at as usize).min(text.len());
    loop {
        let from = end;
        end = text[..end].trim_ascii_end().len();
        if text[..end].ends_with(b"*/") {
            end = text[..end - 2].windows(2).rposition(|w| w == b"/*")?;
            continue;
        }
        // A `//` comment ends with its line.
        if text[end..from].contains(&b'\n') {
            let line = text[..end]
                .iter()
                .rposition(|&b| b == b'\n')
                .map_or(0, |at| at + 1);
            if let Some(comment) = text[line..end].windows(2).position(|w| w == b"//") {
                end = line + comment;
                continue;
            }
        }
        return text[..end]
            .ends_with(written)
            .then(|| (end - written.len()) as u32);
    }
}

/// Whether somebody who wrote `name` may have meant `candidate`.
pub(super) fn is_close(name: &[u8], candidate: &[u8]) -> bool {
    let allowed_difference = 2.max(name.len() * 34 / 100);
    if name.len().abs_diff(candidate.len()) > allowed_difference
        || candidate == name
        || candidate.first() == Some(&b'"')
    {
        return false;
    }
    // Two letters are told apart at a glance, unless it is by their case.
    if candidate.len() < 3 && !candidate.eq_ignore_ascii_case(name) {
        return false;
    }
    let worst = (name.len() * 4 / 10 + 1) as f32;
    edit_distance_within(name, candidate, worst - 0.1)
}

/// Levenshtein's distance, where changing a letter costs two and changing its case next to nothing, is at most `max`.
fn edit_distance_within(a: &[u8], b: &[u8], max: f32) -> bool {
    const LONGEST: usize = 63;
    if a.len() > LONGEST || b.len() > LONGEST {
        return false;
    }
    let mut rows = [[0f32; LONGEST + 1]; 2];
    let big = max + 0.01;
    for (j, cell) in rows[0].iter_mut().enumerate().take(b.len() + 1) {
        *cell = j as f32;
    }
    for i in 1..=a.len() {
        let (previous, current) = {
            let (first, second) = rows.split_at_mut(1);
            if i % 2 == 1 {
                (&first[0], &mut second[0])
            } else {
                (&second[0], &mut first[0])
            }
        };
        let at = i as f32;
        let from = if at > max {
            (at - max).ceil() as usize
        } else {
            1
        };
        let to = if b.len() as f32 > max + at {
            (max + at).floor() as usize
        } else {
            b.len()
        };
        current[0] = at;
        let mut least = at;
        for cell in &mut current[1..from.min(b.len() + 1)] {
            *cell = big;
        }
        for j in from..=to {
            let distance = if a[i - 1] == b[j - 1] {
                previous[j - 1]
            } else {
                let change = previous[j - 1]
                    + if a[i - 1].eq_ignore_ascii_case(&b[j - 1]) {
                        0.1
                    } else {
                        2.0
                    };
                (previous[j] + 1.0).min(current[j - 1] + 1.0).min(change)
            };
            current[j] = distance;
            least = least.min(distance);
        }
        for cell in &mut current[(to + 1).min(b.len() + 1)..=b.len()] {
            *cell = big;
        }
        if least > max {
            return false;
        }
    }
    rows[a.len() % 2][b.len()] <= max
}

// ───────────────────────────── operators ─────────────────────────────

impl Checker<'_> {
    fn check_operators(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let hir = self.hir(file);
        for i in 0..hir.exprs.len() {
            if matches!(self.bound(file).expr_parent[i], Parent::None) {
                continue;
            }
            let e = ExprId(i as u32);
            match hir.exprs[i].kind {
                // `checkInExpression`
                ExprKind::Binary {
                    op: BinOp::In,
                    left,
                    right,
                } => {
                    // `#x in v`: what is on the left is a name, looked up in the classes around, and no value.
                    let private_name = match hir[left].kind {
                        ExprKind::String(name)
                            if hir.text.get(hir[left].pos as usize) == Some(&b'#') =>
                        {
                            Some(name)
                        }
                        _ => None,
                    };
                    if let Some(name) = private_name {
                        // `reportNonexistentProperty`: one that none of them declares is missed in what is on the right, as it is.
                        if !self.bound(file).private_class.contains_key(&left)
                            && !self.enclosing_classes(file, left).is_empty()
                        {
                            let object = self.type_of_expr(file, right);
                            if self.is_known(object) && !self.is_uncertain(file, right) {
                                let code = if self.is_any(object) {
                                    2339
                                } else {
                                    self.why_no_property(file, left, object, name)
                                };
                                out.push(Diagnostic {
                                    start: hir[left].pos,
                                    code,
                                });
                            }
                        }
                    } else {
                        let key = self.type_of_expr(file, left);
                        if self.is_known(key) {
                            let key = self.check_not_nullish(file, left, key, out);
                            let wanted =
                                self.union(&[TypeId::STRING, TypeId::NUMBER, TypeId::SYMBOL]);
                            let at = self.error_start_of(file, left);
                            self.check_assignable(file, key, wanted, at, ExprId::NONE, 2322, out);
                        }
                    }
                    let object = self.type_of_expr(file, right);
                    if self.is_known(object) {
                        let object = self.check_not_nullish(file, right, object, out);
                        let at = self.error_start_of(file, right);
                        self.check_assignable(
                            file,
                            object,
                            TypeId::OBJECT,
                            at,
                            ExprId::NONE,
                            2322,
                            out,
                        );
                    }
                }
                ExprKind::Binary { op, left, right } => {
                    self.check_binary(file, e, op, left, right, out);
                }
                // Whatever is on the left, what is on the right is looked at.
                ExprKind::Assign {
                    op: Some(op),
                    target,
                    value,
                } => {
                    if self.check_binary(file, e, op, target, value, out) {
                        self.check_compound_assignment(file, e, op, target, value, out);
                    }
                }
                ExprKind::Unary {
                    op: UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec,
                    operand,
                } => {
                    let ty = self.type_of_expr(file, operand);
                    if self.is_known(ty) && !self.is_refused_target(file, operand) {
                        let ty = self.check_not_nullish(file, operand, ty, out);
                        self.check_arithmetic_operand(file, operand, ty, 2356, out);
                    }
                }
                _ => {}
            }
        }
    }

    /// A function, a class, an enum, a constant, `undefined`, a name nothing goes by: assigning to it is the error, and nothing more is
    /// said about it. `checkIdentifier`, which is done with the arguments object before it asks what is done to it.
    fn is_name_that_cannot_be_assigned(&self, file: FileId, e: ExprId) -> bool {
        match self.hir(file)[e].kind {
            ExprKind::Ident(name) => match self.symbol_of_identifier(file, e, name) {
                Some(sym) => {
                    let flags = self.files().flags(sym);
                    !flags.intersects(SymFlags::VARIABLE) || flags.contains(SymFlags::CONST)
                }
                None => !self.bound(file).is_arguments_object(e),
            },
            // `getResolvedSymbol`: where an expression is left out there is a name that is not written, which nothing goes by.
            ExprKind::Missing => true,
            _ => false,
        }
    }

    /// Whether `e`, which `op=`, `++` or `--` writes to, is refused: a name that cannot be assigned to, a property that can only be
    /// read, or one without a name, which is what `parseSuperExpression` makes of a `super` that nothing follows. It is in error then,
    /// and so is `e!`. `checkIdentifier`, `checkPropertyAccessExpressionOrQualifiedName`, `getPropertyTypeForIndexType`
    fn is_refused_target(&mut self, file: FileId, mut e: ExprId) -> bool {
        let hir = self.hir(file);
        while let ExprKind::NonNull(x) = hir[e].kind {
            e = x;
        }
        let mut said = Vec::new();
        match hir[e].kind {
            ExprKind::Dot {
                obj,
                name,
                name_pos,
                ..
            } => self.check_property_write(file, e, obj, name, name_pos, &mut said),
            ExprKind::Index { obj, index, .. } => {
                self.check_element_write(file, e, obj, index, &mut said)
            }
            ExprKind::Super => return true,
            _ => return self.is_name_that_cannot_be_assigned(file, e),
        }
        !said.is_empty()
    }

    /// Whether the resolver worked `ty` out, all of it. Nothing is said about what it did not.
    pub(super) fn is_known(&self, ty: TypeId) -> bool {
        !self.p.types.flags(ty).contains(TypeFlags::HAS_UNRESOLVED)
    }

    /// `checkBinaryLikeExpression`, of an operator that makes something of two values. Whether it gets as far as
    /// `checkAssignmentOperator`, which is where `op=` goes on from.
    fn check_binary(
        &mut self,
        file: FileId,
        e: ExprId,
        op: BinOp,
        left: ExprId,
        right: ExprId,
        out: &mut Vec<Diagnostic>,
    ) -> bool {
        match op {
            BinOp::And | BinOp::Or | BinOp::Nullish => return true,
            BinOp::Comma | BinOp::In | BinOp::Instanceof => return false,
            _ => {}
        }
        let start = self.start_inside_parentheses(file, e);
        // `checkNaNEquality`, which is not a matter of types.
        if matches!(
            op,
            BinOp::EqEq | BinOp::NotEq | BinOp::EqEqEq | BinOp::NotEqEq
        ) && (self.is_global_nan(file, left) || self.is_global_nan(file, right))
        {
            out.push(Diagnostic { start, code: 2845 });
        }
        // What cannot be written to is in error, and can be anything.
        let is_refused = matches!(self.hir(file)[e].kind, ExprKind::Assign { .. })
            && self.is_refused_target(file, left);
        let l = if is_refused {
            TypeId::ANY
        } else {
            self.type_of_expr(file, left)
        };
        let r = self.type_of_expr(file, right);
        if !self.is_known(l) || !self.is_known(r) {
            // `checkArithmeticOperandType` checks each operand on its own. `&`, `|` and `^` look at both first (2447).
            if matches!(
                op,
                BinOp::Sub
                    | BinOp::Mul
                    | BinOp::Div
                    | BinOp::Rem
                    | BinOp::Pow
                    | BinOp::Shl
                    | BinOp::Shr
                    | BinOp::UShr
            ) {
                for (operand, ty, code) in [(left, l, 2362), (right, r, 2363)] {
                    if self.is_known(ty) && !self.is_uncertain(file, operand) {
                        let ty = self.check_not_nullish(file, operand, ty, out);
                        self.check_arithmetic_operand(file, operand, ty, code, out);
                    }
                }
            }
            return false;
        }
        match op {
            BinOp::Sub
            | BinOp::Mul
            | BinOp::Div
            | BinOp::Rem
            | BinOp::Pow
            | BinOp::Shl
            | BinOp::Shr
            | BinOp::UShr
            | BinOp::BitAnd
            | BinOp::BitOr
            | BinOp::BitXor => {
                let l = self.check_not_nullish(file, left, l, out);
                let r = self.check_not_nullish(file, right, r, out);
                if matches!(op, BinOp::BitAnd | BinOp::BitOr | BinOp::BitXor)
                    && self.every_type(l, Self::is_boolean_like)
                    && self.every_type(r, Self::is_boolean_like)
                    && l != TypeId::NEVER
                    && r != TypeId::NEVER
                {
                    // It is said of the operator, which is the token before the right operand: the tree does not keep where it is.
                    let hir = self.hir(file);
                    let operator: &[u8] = match (op, matches!(hir[e].kind, ExprKind::Assign { .. }))
                    {
                        (BinOp::BitAnd, false) => b"&",
                        (BinOp::BitAnd, true) => b"&=",
                        (BinOp::BitOr, false) => b"|",
                        (BinOp::BitOr, true) => b"|=",
                        (_, false) => b"^",
                        (_, true) => b"^=",
                    };
                    let start =
                        start_of_token_before(&hir.text, self.start_of(file, right), operator)
                            .unwrap_or(start);
                    out.push(Diagnostic { start, code: 2447 });
                    return false;
                }
                let left_fits = self.check_arithmetic_operand(file, left, l, 2362, out);
                let right_fits = self.check_arithmetic_operand(file, right, r, 2363, out);
                let anything = |c: &Self, t: TypeId| c.is_any(t) || t == TypeId::UNKNOWN;
                let gives_number = anything(self, l) && anything(self, r)
                    || !self.maybe_type_of_kind(l, Self::is_bigint_like)
                        && !self.maybe_type_of_kind(r, Self::is_bigint_like);
                if !gives_number {
                    let both = self.is_assignable(l, TypeId::BIGINT)
                        && self.is_assignable(r, TypeId::BIGINT);
                    if !both || op == BinOp::UShr {
                        out.push(Diagnostic { start, code: 2365 });
                    }
                }
                left_fits && right_fits
            }
            BinOp::Add => {
                let (mut l, mut r) = (l, r);
                // `isTypeAssignableToKindEx`, of number, bigint or string: the relation is asked about the operand itself, which sees to
                // what a type parameter extends.
                let is_kind = |c: &mut Self, t: TypeId, kind: TypeId, strict: bool| {
                    !(strict && (c.is_any(t) || t == TypeId::UNKNOWN || c.is_nullish(t)))
                        && c.is_assignable(t, kind)
                };
                if !is_kind(self, l, TypeId::STRING, false)
                    && !is_kind(self, r, TypeId::STRING, false)
                {
                    l = self.check_not_nullish(file, left, l, out);
                    r = self.check_not_nullish(file, right, r, out);
                }
                let has_result = is_kind(self, l, TypeId::NUMBER, true)
                    && is_kind(self, r, TypeId::NUMBER, true)
                    || is_kind(self, l, TypeId::BIGINT, true)
                        && is_kind(self, r, TypeId::BIGINT, true)
                    || is_kind(self, l, TypeId::STRING, true)
                    || is_kind(self, r, TypeId::STRING, true)
                    || self.is_any(l)
                    || self.is_any(r);
                if !has_result {
                    out.push(Diagnostic { start, code: 2365 });
                    return false;
                }
                // Symbols are only looked for once the two can be added.
                !self.check_no_symbol_operand(file, left, right, l, r, out)
            }
            BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge => {
                if self.check_no_symbol_operand(file, left, right, l, r, out) {
                    return false;
                }
                let l = self.check_not_nullish(file, left, l, out);
                let r = self.check_not_nullish(file, right, r, out);
                if self.is_any(l) || self.is_any(r) {
                    return false;
                }
                let (l, r) = (self.base_for_comparison(l), self.base_for_comparison(r));
                let numeric = self.union(&[TypeId::NUMBER, TypeId::BIGINT]);
                let (ln, rn) = (
                    self.is_assignable(l, numeric),
                    self.is_assignable(r, numeric),
                );
                if !((ln && rn)
                    || (!ln && !rn && (self.is_comparable(l, r) || self.is_comparable(r, l))))
                {
                    out.push(Diagnostic { start, code: 2365 });
                }
                false
            }
            BinOp::EqEq | BinOp::NotEq | BinOp::EqEqEq | BinOp::NotEqEq => {
                let nullable = |t: TypeId| t.is_null() || t.is_undefined();
                if !(nullable(l)
                    || nullable(r)
                    || self.is_comparable(l, r)
                    || self.is_comparable(r, l))
                {
                    self.trace_pair(2367, start, l, r);
                    out.push(Diagnostic { start, code: 2367 });
                }
                false
            }
            _ => false,
        }
    }

    /// `checkAssignmentOperator`, of `target op= value`, which is `e`: 2364, or 2322 if what comes of it does not fit where it is put.
    fn check_compound_assignment(
        &mut self,
        file: FileId,
        e: ExprId,
        op: BinOp,
        target: ExprId,
        value: ExprId,
        out: &mut Vec<Diagnostic>,
    ) {
        let hir = self.hir(file);
        let at = self.error_start_of(file, target);
        // `checkReferenceExpression`: what is asserted of a reference is a reference too. A pattern is only one to `=`.
        let mut reference = target;
        while let ExprKind::NonNull(x)
        | ExprKind::As { expr: x, .. }
        | ExprKind::AsConst(x)
        | ExprKind::Satisfies { expr: x, .. } = hir[reference].kind
        {
            reference = x;
        }
        // The property that is written to, if its name is written out.
        let property = match hir[reference].kind {
            // `checkIdentifier`: what cannot be assigned to is in error, and anything fits that.
            ExprKind::Ident(_) | ExprKind::Missing
                if self.is_written(file, reference)
                    && self.is_name_that_cannot_be_assigned(file, reference) =>
            {
                return;
            }
            ExprKind::Ident(_) | ExprKind::Missing => None,
            // `parseSuperExpression`: `super` that nothing follows is a property without a name, which is in error as well.
            ExprKind::Super => return,
            // Of `a?.b += 1` it is only said that it cannot be.
            ExprKind::Dot { chain, .. } | ExprKind::Index { chain, .. } if chain != Chain::No => {
                return;
            }
            ExprKind::Dot { obj, name, .. } => Some((obj, name)),
            ExprKind::Index { obj, index, .. } => match hir[index].kind {
                ExprKind::String(name) => Some((obj, name)),
                _ => None,
            },
            _ => {
                out.push(Diagnostic {
                    start: at,
                    code: 2364,
                });
                return;
            }
        };
        // `isAssignmentToReadonlyEntity`: so is what can only be read.
        let mut said = Vec::new();
        match hir[reference].kind {
            ExprKind::Dot {
                obj,
                name,
                name_pos,
                ..
            } => self.check_property_write(file, reference, obj, name, name_pos, &mut said),
            ExprKind::Index { obj, index, .. } => {
                self.check_element_write(file, reference, obj, index, &mut said)
            }
            _ => {}
        }
        if !said.is_empty() {
            return;
        }
        let (left, right) = (
            self.type_of_expr(file, target),
            self.type_of_expr(file, value),
        );
        if self.is_uncertain(file, target) || self.is_uncertain(file, value) {
            return;
        }
        // `&&=`, `||=` and `??=` give a value as `=` does (`AssignmentKindDefinite`): what is on the right, to what the target is
        // declared as, or asserted to be.
        if matches!(op, BinOp::And | BinOp::Or | BinOp::Nullish) {
            let is_declared = reference == target && !self.bound(file).is_arguments_object(target);
            let wanted = if is_declared {
                self.declared_type_of_reference(file, target)
            } else {
                left
            };
            self.check_assignable(file, right, wanted, at, value, 2322, out);
            return;
        }
        // The others put what they make of the two where the target is, which is what it is known to hold there.
        let mut wanted = left;
        // A setter may take more than the getter gives: `checkPropertyAccessExpression` with `writeOnly`, `AccessFlagsWriting`.
        if reference == target
            && let Some((obj, name)) = property
        {
            let object = self.type_of_expr(file, obj);
            let object = self.receiver_that_is_there(object);
            let (read, written) = (
                self.type_of_property(object, name),
                self.write_type_of_property(object, name),
            );
            if let Some(written) = written
                && read != Some(written)
            {
                wanted = written;
            }
        }
        // `checkIdentifier`, `getFlowTypeOfAccessExpression`: a literal counts for all of its kind.
        let wanted = self.base_of_literal(wanted);
        let source = self.type_of_expr(file, e);
        // A type parameter where none is in scope is something the resolver did not get to the bottom of.
        if self.has_type_variables(wanted) && !self.is_in_generic_context(file, e) {
            return;
        }
        self.check_assignable(file, source, wanted, at, ExprId::NONE, 2322, out);
    }

    /// `isGlobalNaN`
    fn is_global_nan(&self, file: FileId, e: ExprId) -> bool {
        let ExprKind::Ident(name) = self.hir(file)[e].kind else {
            return false;
        };
        self.files().atoms.bytes(name) == b"NaN" && {
            let global = self.files().global(name, SymFlags::VALUE);
            global.is_some() && self.symbol_of_identifier(file, e, name) == global
        }
    }

    /// `BUN_SEMA_TRACE_ERRORS=1`: the two types an error is about.
    pub(super) fn trace_pair(&mut self, code: u32, start: u32, a: TypeId, b: TypeId) {
        if self.trace_relations || std::env::var_os("BUN_SEMA_TRACE_ERRORS").is_some() {
            let mut describer = crate::describe::Describer::new(self);
            let (a, b) = (describer.describe(a), describer.describe(b));
            eprintln!("ERROR {code} at {start}: {a}  ~  {b}");
            return;
        }
        if std::env::var_os("BUN_SEMA_TRACE_ERRORS_RAW").is_some() {
            let parts = |c: &Self, t: TypeId| {
                c.parts(t)
                    .iter()
                    .map(|&p| format!("{:?}", c.data(p)))
                    .collect::<Vec<_>>()
                    .join(" | ")
            };
            eprintln!(
                "RAW {code} at {start}: {}  ~  {}",
                parts(self, a),
                parts(self, b)
            );
        }
    }

    /// 2469: an operator that does not take symbols is given one. `checkForDisallowedESSymbolOperand`
    fn check_no_symbol_operand(
        &mut self,
        file: FileId,
        left: ExprId,
        right: ExprId,
        l: TypeId,
        r: TypeId,
        out: &mut Vec<Diagnostic>,
    ) -> bool {
        // `maybeTypeOfKindConsideringBaseConstraint`
        let mut may_be_symbol = |t: TypeId| {
            self.maybe_type_of_kind(t, Self::is_symbol_like) || {
                let base = self.base_constraint_of(t).unwrap_or(t);
                self.maybe_type_of_kind(base, Self::is_symbol_like)
            }
        };
        let offending = if may_be_symbol(l) {
            left
        } else if may_be_symbol(r) {
            right
        } else {
            return false;
        };
        out.push(Diagnostic {
            start: self.error_start_of(file, offending),
            code: 2469,
        });
        true
    }

    /// `getBaseTypeOfLiteralTypeForComparison`: `1` and `2` are compared as numbers, and a member of an enum as the string or the number
    /// it is, whatever else is in the enum.
    fn base_for_comparison(&mut self, ty: TypeId) -> TypeId {
        self.map_type(ty, |c, m| match c.data(m) {
            TypeData::StringLit { .. }
            | TypeData::Template { .. }
            | TypeData::StringMapping { .. }
            | TypeData::EnumLit {
                value: EnumValue::String(_),
                ..
            } => TypeId::STRING,
            TypeData::NumberLit { .. }
            | TypeData::EnumLit {
                value: EnumValue::Number(_),
                ..
            }
            | TypeData::Enum { .. } => TypeId::NUMBER,
            TypeData::BigIntLit { .. } => TypeId::BIGINT,
            TypeData::BoolLit { .. } => TypeId::BOOLEAN,
            _ => m,
        })
    }

    /// `checkArithmeticOperandType`: whether the operand will do.
    fn check_arithmetic_operand(
        &mut self,
        file: FileId,
        operand: ExprId,
        ty: TypeId,
        code: u32,
        out: &mut Vec<Diagnostic>,
    ) -> bool {
        let numeric = self.union(&[TypeId::NUMBER, TypeId::BIGINT]);
        let fits = self.is_assignable(ty, numeric);
        if !fits {
            out.push(Diagnostic {
                start: self.error_start_of(file, operand),
                code,
            });
        }
        fits
    }

    /// What is left of the type of `node` once `null` and `undefined` are ruled out, which they have to be here.
    /// 18050, 18046 to 18049, 2531 to 2533, 2571. `checkNonNullType`, `reportObjectPossiblyNullOrUndefinedError`
    pub(super) fn check_not_nullish(
        &mut self,
        file: FileId,
        node: ExprId,
        ty: TypeId,
        out: &mut Vec<Diagnostic>,
    ) -> TypeId {
        if self.is_uncertain(file, node) {
            return ty;
        }
        let hir = self.hir(file);
        let start = self.error_start_of(file, node);
        let is_name = self.is_entity_name(file, node);
        // This much alone is a matter of strictNullChecks: without them a type that is `null` or `undefined` is nothing else.
        if ty == TypeId::UNKNOWN && self.p.files.options.strict_null_checks {
            out.push(Diagnostic {
                start,
                code: if is_name { 18046 } else { 2571 },
            });
            return TypeId::ANY;
        }
        // `getTypeFacts`: what waits for type parameters goes by what it extends, and so does an intersection.
        let seen = self.map_type(ty, |c, m| {
            if c.is_deferred(m) || matches!(c.data(m), TypeData::Intersection(_)) {
                c.base_constraint(m)
            } else {
                m
            }
        });
        let undefined = self.some_type(seen, |_, m| m.is_undefined());
        let null = self.some_type(seen, |_, m| m.is_null());
        if !undefined && !null {
            return ty;
        }
        let code = match hir[node].kind {
            // `(null)` and `(undefined)` are expressions in parentheses.
            ExprKind::Null if !self.is_written_in_parentheses(file, node) => 18050,
            ExprKind::Ident(known::undefined) if is_name => 18050,
            _ => match (is_name, undefined, null) {
                (true, true, true) => 18049,
                (true, true, false) => 18048,
                (true, false, _) => 18047,
                (false, true, true) => 2533,
                (false, true, false) => 2532,
                (false, false, _) => 2531,
            },
        };
        out.push(Diagnostic { start, code });
        // Where nothing is left, or nothing is taken out, it is in error.
        match self.non_nullable(ty) {
            rest if rest == TypeId::NEVER || rest.is_null() || rest.is_undefined() => TypeId::ANY,
            rest => rest,
        }
    }

    /// `a`, `a.b.c`, none of it in parentheses and none of the names private, if that is short enough to be repeated in what is said:
    /// `IsEntityNameExpression`, `len(entityNameToString(node)) < 100`. In a type query `a.b` is a qualified name, which is none, and
    /// `this` a name like any other.
    fn is_entity_name(&self, file: FileId, mut e: ExprId) -> bool {
        let (hir, atoms) = (self.hir(file), &self.files().atoms);
        if matches!(hir[e].kind, ExprKind::Dot { .. }) && self.bound(file).is_in_type_query(e) {
            return false;
        }
        let mut length = 0;
        loop {
            if self.is_written_in_parentheses(file, e) {
                return false;
            }
            match hir[e].kind {
                ExprKind::Ident(name) => return length + atoms.bytes(name).len() < 100,
                ExprKind::Dot { obj, name, .. } if atoms.bytes(name).first() != Some(&b'#') => {
                    length += atoms.bytes(name).len() + 1;
                    e = obj;
                }
                ExprKind::This => return self.bound(file).is_in_type_query(e),
                _ => return false,
            }
        }
    }

    /// Where `e` starts as it is written.
    pub(super) fn start_of(&self, file: FileId, e: ExprId) -> u32 {
        self.start_from(file, e, false)
    }

    /// Where `e` starts, not counting parentheses around the whole of it.
    pub(super) fn start_inside_parentheses(&self, file: FileId, e: ExprId) -> u32 {
        self.start_from(file, e, true)
    }

    fn start_from(&self, file: FileId, mut e: ExprId, mut inside: bool) -> u32 {
        let hir = self.hir(file);
        loop {
            if !std::mem::take(&mut inside)
                && let Ok(at) = hir.parens.binary_search_by_key(&e.0, |p| p.0.0)
            {
                return hir.parens[at].1;
            }
            // It starts where what it starts with starts.
            e = match hir[e].kind {
                ExprKind::Binary { left, .. } => left,
                ExprKind::Assign { target, .. } => target,
                ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => obj,
                ExprKind::Call(c) | ExprKind::TaggedTemplate(c) => hir[c].callee,
                ExprKind::Cond { test, .. } => test,
                // `x as T`. `<T>x` and `<const>x` are put at the `<` they start with.
                ExprKind::As { expr, ty } if hir[ty].pos > hir[expr].pos => expr,
                ExprKind::AsConst(x) if hir[e].pos < hir[x].pos => return hir[e].pos,
                ExprKind::NonNull(x)
                | ExprKind::AsConst(x)
                | ExprKind::Satisfies { expr: x, .. }
                | ExprKind::Instantiation { expr: x, .. } => x,
                ExprKind::Unary {
                    op: UnOp::PostInc | UnOp::PostDec,
                    operand,
                } => operand,
                _ => return hir[e].pos,
            };
        }
    }
}

// ───────────────────────────── what is written to ─────────────────────────────

impl Checker<'_> {
    /// How `e` is written to, if it is: by `=`, by an operator that reads it first, or by `++` and `--`. `GetAssignmentTarget`
    fn write_kind(&self, file: FileId, e: ExprId) -> Option<Write> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        // `x!` and the literals a pattern is made of are seen through on the way to any of them: `[x]++` writes to `x`.
        let mut at = e;
        loop {
            at = match bound.expr_parent[at.idx()] {
                Parent::Expr(parent) => match hir[parent].kind {
                    ExprKind::Assign {
                        op: Some(_),
                        target,
                        ..
                    } if target == at => return Some(Write::Compound),
                    ExprKind::Unary {
                        op: UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec,
                        ..
                    } => return Some(Write::Step),
                    ExprKind::NonNull(_) | ExprKind::Array(_) | ExprKind::Spread(_) => parent,
                    _ => break,
                },
                Parent::Prop(p)
                    if matches!(hir[bound.prop_owner[p.idx()]].kind, ExprKind::Object(_)) =>
                {
                    bound.prop_owner[p.idx()]
                }
                _ => break,
            };
        }
        self.is_assignment_target(file, e).then_some(Write::Assign)
    }

    /// 2628 to 2632, 2539, 2588: a name that cannot be assigned to. 2540: a property that can only be read.
    /// 2364, 2357: something that is neither.
    fn check_writes(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let hir = self.hir(file);
        for i in 0..hir.exprs.len() {
            if matches!(self.bound(file).expr_parent[i], Parent::None) {
                continue;
            }
            let e = ExprId(i as u32);
            match hir.exprs[i].kind {
                ExprKind::Ident(name) => {
                    if self.write_kind(file, e).is_none() {
                        continue;
                    }
                    if let Some(code) = self.why_not_assignable(file, e, name) {
                        out.push(Diagnostic {
                            start: hir.exprs[i].pos,
                            code,
                        });
                    }
                }
                ExprKind::Dot {
                    obj,
                    name,
                    name_pos,
                    ..
                } => self.check_property_write(file, e, obj, name, name_pos, out),
                ExprKind::Index { obj, index, .. } => {
                    self.check_element_write(file, e, obj, index, out)
                }
                // What `op=` assigns to is looked at once the operands have been: `check_operators`.
                ExprKind::Assign {
                    op: None, target, ..
                } => {
                    if !self.can_be_written_to(file, target, true) {
                        out.push(Diagnostic {
                            start: self.error_start_of(file, target),
                            code: 2364,
                        });
                    }
                }
                ExprKind::Unary {
                    op: UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec,
                    operand,
                } => {
                    let ty = self.type_of_expr(file, operand);
                    if !self.is_known(ty) {
                        continue;
                    }
                    // `checkNonNullType`, whose errors `check_operators` has reported.
                    let ty = self.check_not_nullish(file, operand, ty, &mut Vec::new());
                    let numeric = self.union(&[TypeId::NUMBER, TypeId::BIGINT]);
                    if self.is_assignable(ty, numeric)
                        && !self.can_be_written_to(file, operand, false)
                    {
                        out.push(Diagnostic {
                            start: self.error_start_of(file, operand),
                            code: 2357,
                        });
                    }
                }
                _ => {}
            }
        }
    }

    /// `isAssignmentToReadonlyEntity`: 2540, put at `at`, if `e` is written to and the property `name` of `obj`, which is what `e` is,
    /// can only be read.
    pub(super) fn check_property_write(
        &mut self,
        file: FileId,
        e: ExprId,
        obj: ExprId,
        name: Atom,
        at: u32,
        out: &mut Vec<Diagnostic>,
    ) {
        if self.write_kind(file, e).is_none() {
            return;
        }
        let ty = self.type_of_expr(file, obj);
        if !self.is_known(ty) || self.is_any(ty) {
            return;
        }
        let ty = self.non_nullable(ty);
        // `getReducedApparentType`
        let apparent = self.apparent_type(ty);
        let apparent = self.reduced(apparent);
        if let TypeData::Union(parts) = self.data(apparent) {
            if self.is_readonly_in_union(parts, name) == Some(true) {
                out.push(Diagnostic {
                    start: at,
                    code: 2540,
                });
            }
            return;
        }
        // `getPropertyOfType`: what every function and every object has counts.
        let Some(members) = self.members(apparent) else {
            return;
        };
        let Some((prop, _)) = self.property_of_type(&members, name) else {
            return;
        };
        // `isAssignmentToReadonlyEntity`: what a CommonJS module exports by assigning can be assigned again, whatever it stands for.
        if let PropSource::Symbol(sym) = prop.source
            && self
                .files()
                .symbol(sym)
                .decls
                .iter()
                .any(|d| matches!(d, Decl::ExportsProperty(_) | Decl::ModuleExports(_)))
        {
            return;
        }
        let is_refused = if prop.flags.contains(PropFlags::READONLY) {
            !self.is_written_in_own_constructor(file, e, obj, &prop)
        } else {
            // Whatever is got at through `import * as` can only be read.
            matches!(self.hir(file)[obj].kind, ExprKind::Ident(n)
            if self.symbol_of_identifier(file, obj, n).is_some_and(|s| {
                self.files().flags(s).contains(SymFlags::ALIAS) && self.files().symbol(s).decls.iter().any(|d| matches!(d, Decl::ImportNamespace(_)))
            }))
        };
        if is_refused {
            out.push(Diagnostic {
                start: at,
                code: 2540,
            });
        }
    }

    /// `getPropertyTypeForIndexType`: 2540, of `obj[index]`, which is `e`, for each property that can only be read among those the
    /// type of `index` names.
    pub(super) fn check_element_write(
        &mut self,
        file: FileId,
        e: ExprId,
        obj: ExprId,
        index: ExprId,
        out: &mut Vec<Diagnostic>,
    ) {
        if self.write_kind(file, e).is_none() {
            return;
        }
        let keys = self.type_of_expr(file, index);
        if self.is_uncertain(file, index) {
            return;
        }
        // `checkElementAccessExpression`: a `const enum` is looked into with a string literal. Anything else is 2476, and in error.
        let is_string_literal_like = !self.is_written_in_parentheses(file, index)
            && match self.hir(file)[index].kind {
                ExprKind::String(_) => true,
                ExprKind::Template { exprs, .. } => exprs.is_empty(),
                _ => false,
            };
        if !is_string_literal_like {
            let object = self.type_of_expr(file, obj);
            if self.is_const_enum_object(object) {
                return;
            }
        }
        let at = self.error_start_of(file, index);
        for &key in self.parts(keys) {
            // `getPropertyNameFromIndex`
            if let Some(name) = self.property_name_of_type(key) {
                self.check_property_write(file, e, obj, name, at, out);
            }
        }
    }

    /// `createUnionOrIntersectionProperty`, of the union of `parts`: whether its property `name` can only be read, which is so as soon
    /// as it is so in one member. `None`: the union has no such property.
    fn is_readonly_in_union(&mut self, parts: &[TypeId], name: Atom) -> Option<bool> {
        let is_late_bound = self.files().atoms.is_symbol_name(name);
        let (mut is_declared, mut is_readonly) = (false, false);
        for &part in parts {
            let part = self.apparent_type(part);
            // What nothing can be has no say.
            if part == TypeId::NEVER {
                continue;
            }
            // What a type parameter extends.
            if let TypeData::Union(inner) = self.data(part) {
                is_readonly |= self.is_readonly_in_union(inner, name)?;
                is_declared = true;
                continue;
            }
            let members = self.members(part)?;
            if let Some((prop, _)) = self.property_of_type(&members, name) {
                is_declared = true;
                is_readonly |= prop.flags.contains(PropFlags::READONLY);
                continue;
            }
            // `getApplicableIndexInfoForName`: an index signature stands in for it, but not for what goes by a symbol.
            let stand_in = if is_late_bound {
                None
            } else {
                self.applicable_index(&members, TypeId::STRING, Some(name))
            };
            match stand_in {
                Some((_, readonly)) => is_readonly |= readonly,
                // An object literal that does not mention it does not have it.
                None if self.is_closed_object_literal_type(part) => {}
                None => return None,
            }
        }
        // Where only signatures answer there is no property, and it is of them that something is said (2542).
        (is_declared && !self.is_hidden_in_union(parts, name)).then_some(is_readonly)
    }

    /// `checkReferenceExpression`: a name or a property, whatever is asserted of it. That it may be no optional chain (2777 2779) is said
    /// with the operators. `patterns_too`: `e` is what `=` assigns to, where `checkBinaryLikeExpression` takes an object or array literal
    /// for a pattern, if it stands there as it is: in parentheses, or with something asserted of it, it is an expression like any other.
    fn can_be_written_to(&self, file: FileId, mut e: ExprId, patterns_too: bool) -> bool {
        let hir = self.hir(file);
        if patterns_too && matches!(hir[e].kind, ExprKind::Object(_) | ExprKind::Array(_)) {
            return !self.is_written_in_parentheses(file, e);
        }
        loop {
            match hir[e].kind {
                // Where an expression is left out there is a name that is not written, and after a `super` that nothing follows a
                // property without one: `parseSuperExpression`.
                ExprKind::Ident(_)
                | ExprKind::Missing
                | ExprKind::Super
                | ExprKind::Dot { .. }
                | ExprKind::Index { .. } => return true,
                ExprKind::NonNull(x)
                | ExprKind::As { expr: x, .. }
                | ExprKind::AsConst(x)
                | ExprKind::Satisfies { expr: x, .. } => e = x,
                _ => return false,
            }
        }
    }

    /// Why the name `e` cannot be given a value, if it cannot. `checkIdentifier`
    fn why_not_assignable(&self, file: FileId, e: ExprId, name: Atom) -> Option<u32> {
        let Some(sym) = self.symbol_of_identifier(file, e, name) else {
            // `undefinedSymbol` is made as a property and `globalThisSymbol` as a module: names, but of no variable.
            return match name {
                known::undefined => Some(2539),
                known::globalThis => Some(2631),
                _ => None,
            };
        };
        let flags = self.files().flags(sym);
        if flags.intersects(SymFlags::VARIABLE) {
            return flags.contains(SymFlags::CONST).then_some(2588);
        }
        Some(if flags.contains(SymFlags::ENUM) {
            2628
        } else if flags.contains(SymFlags::CLASS) {
            2629
        } else if flags.intersects(SymFlags::MODULE) {
            2631
        } else if flags.contains(SymFlags::FUNCTION) {
            2630
        } else if flags.contains(SymFlags::ALIAS) {
            2632
        } else {
            2539
        })
    }

    /// `this.p = v` in a constructor of the class that declares `p` is how a `readonly` property gets its value.
    fn is_written_in_own_constructor(
        &self,
        file: FileId,
        e: ExprId,
        obj: ExprId,
        prop: &Prop,
    ) -> bool {
        let hir = self.hir(file);
        let bound = self.bound(file);
        // `isAssignmentToReadonlyEntity`: only what is declared as a property. An accessor without a setter takes nothing.
        if prop.flags.contains(PropFlags::ACCESSOR) || !matches!(hir[obj].kind, ExprKind::This) {
            return false;
        }
        let Container::Fn(f) = self.flow_container(file, bound.expr_parent[e.idx()]) else {
            return false;
        };
        if hir[f].kind != FnKind::Constructor {
            return false;
        }
        let FnOwner::Member(constructor) = bound.fns[f.idx()].owner else {
            return false;
        };
        match &prop.source {
            PropSource::Members(members) => members.iter().any(|&(other, m)| {
                other == file
                    && bound.member_owner[m.idx()] == bound.member_owner[constructor.idx()]
            }),
            PropSource::Parameter(other, p) => *other == file && bound.param_fn[p.idx()] == f,
            _ => false,
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Write {
    Assign,
    Compound,
    Step,
}
