//! What is wrong with a file. The resolver answers questions and never complains; this goes over everything that is
//! written, once, asks it what it needs to know, and says where that does not add up.
//!
//! The codes are the TypeScript compiler's. An error that would rest on something the resolver could not work out is not
//! reported: better to miss one than to make one up.
//!
//! Nothing here allocates per node: one list of diagnostics is handed down, the arenas are gone through by index, and a
//! diagnostic is a place and a number until somebody wants to read it.

use super::errors_modules::fully_qualified_name;
use super::errors_x_operators::{has_empty_object_intersection, type_of_property_of_type};
use super::errors_x_statements::{is_said_by_the_binder, is_said_by_the_parser};
use super::*;
use crate::bind::{ClassOwner, Decl, FnOwner, MemberOwner, Parent, PatParent, ScopeId, ScopeKind};
use crate::program::SymbolTable;
use smallvec::SmallVec;

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub struct Diagnostic {
    /// Where what is wrong starts, in bytes.
    pub start: u32,
    pub code: u32,
}

/// What `check_file` found. `finish_file` makes the errors of the file of it.
pub struct Checked {
    /// `GetSyntacticDiagnostics`
    syntactic: Vec<Diagnostic>,
    /// `getBindAndCheckDiagnostics`. `None`: the file is not checked.
    semantic: Option<Vec<Diagnostic>>,
    /// `GetDeclarationDiagnostics`
    declaration: Vec<Diagnostic>,
    has_parse_diagnostics: bool,
    never_checked: Vec<(u32, u32)>,
    notes: Vec<explain::Note>,
    suggestions: Vec<(u32, u32)>,
}

/// What `getControlFlowContainer` finds.
#[derive(Copy, Clone, Debug)]
pub(super) enum Container {
    File,
    /// `IsFunctionLike`
    Fn(FnId),
    /// `IsModuleBlock`
    Module(ModuleId),
    /// `IsPropertyDeclaration`
    Member(MemberId),
    /// In a type literal, whose parent is not kept. It is equal to nothing: no variable is declared there.
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
    /// All that asks a question about `file`. What it leads other files, or other files lead this one, to report is in the sink.
    pub fn check_file(&mut self, file: FileId) -> Checked {
        self.notes.borrow_mut().clear();
        self.suggestions.borrow_mut().clear();
        self.never_checked.borrow_mut().clear();
        self.reported.clear();
        self.release_shapes_for_now();
        self.is_type_checked = false;
        let hir = self.hir(file);
        if hir.kind == FileKind::Json {
            let syntactic = self.check_json_file(file);
            return self.checked(syntactic, None, Vec::new(), false);
        }
        // `GetSyntacticDiagnostics` and `getBindAndCheckDiagnosticsWithChecker` are separate: only the second depends on whether the
        // file is checked.
        let (mut syntactic, early): (Vec<Diagnostic>, Vec<Diagnostic>) = hir
            .early_errors
            .iter()
            .map(|&(start, code)| Diagnostic { start, code })
            .partition(|d| is_syntactic_early_error(hir, d.start, d.code));
        if self.explains {
            for &(start, code) in hir.early_errors.iter().chain(hir.jsdoc_errors.iter()) {
                explain_early_error(self, file, start, code);
            }
            // `parseExpectedMatchingBrackets`
            for &(start, open, bracket) in hir.opening_brackets.iter() {
                let closing = match bracket {
                    b'(' => ")",
                    b'[' => "]",
                    _ => "}",
                };
                self.relate(start, 1005, |_| {
                    vec![super::explain::Related {
                        at: Some((file, open, open)),
                        code: 1007,
                        args: vec![char::from(bracket).to_string(), closing.to_owned()],
                    }]
                });
            }
        }
        if self.explains {
            self.relate_early_errors(file);
        }
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
        if self.explains {
            for &(start, code) in hir.checker_errors.iter() {
                explain_early_error(self, file, start, code);
            }
        }
        // `checkUnmatchedJSDocParameters`
        out.extend(
            self.bound(file)
                .jsdoc_param_errors
                .iter()
                .map(|&(start, code)| Diagnostic { start, code }),
        );
        if self.explains {
            for &(start, code) in self.bound(file).jsdoc_param_errors.iter() {
                if code == 8032 {
                    explain_qualified_parameter_name(self, file, start);
                }
            }
        }
        self.check_js_syntax(file, &mut syntactic);
        if self.only_syntax || !self.reports_semantic_errors(file) {
            return self.checked(syntactic, None, Vec::new(), false);
        }
        self.checking = Some(file);
        self.emit_resolver_links = Default::default();
        if self.p.files.options.emits_first {
            self.inline_const_enums(file);
        }
        self.check_source_file(file);
        self.check_declare_modifiers(file, &mut out);
        self.check_empty_declaration_lists(file, &mut out);
        self.check_modules(file, &mut out);
        self.check_names(file, &mut out);
        self.check_type_argument_counts(file, &mut out);
        self.check_properties_initialized(file, &mut out);
        self.check_writes(file, &mut out);
        self.check_property_accesses(file, &mut out);
        self.check_calls(file, &mut out);
        self.check_unused(file, &mut out);
        self.check_grammar(file, &mut out);
        self.check_grammar_modifiers(file, &mut out);
        self.check_duplicates(file, &mut out);
        self.check_heritage(file, &mut out);
        self.check_jsx(file, &mut out);
        self.check_overloads(file);
        self.check_use_before_declaration(file, &mut out);
        self.check_iteration(file, &mut out);
        self.check_names_and_exports(file, &mut out);
        self.check_jumps_and_labels(file, &mut out);
        self.check_declarations(file, &mut out);
        self.check_small_things(file, &mut out);
        self.check_circularities(file, &mut out);
        self.check_assignments(file, &mut out);
        self.check_x_aliases(file, &mut out);
        // It takes back what has been said of specifiers that are never resolved.
        self.check_x_modules(file, &mut out);
        self.check_x_classes(file, &mut out);
        self.check_x_collisions(file, &mut out);
        self.check_x_properties_jsx(file, &mut out);
        // `checkGrammarRegularExpressionLiteral`
        if !has_parse_diagnostics {
            self.check_x_regexp_scanner(file, &mut out);
        }
        self.check_x_typenodes(file, &mut out);
        self.recount_type_arguments_of_circular_aliases(file, &mut out);
        // The last two put other words in the place of what has been said: of what is assigned, of names that are not found.
        self.check_x_signatures(file, &mut out);
        self.check_x_operators(file, &mut out);
        self.check_x_enums_names(file, &mut out);
        self.check_external_emit_helpers(file, &mut out);
        // It takes back what has been said of decorators that are out of place.
        self.report_decorators(file, &mut out);
        // `checkWithStatement`, `checkReturnStatement`, `checkExportAssignment`: what they never look at is taken back, whoever said it.
        self.check_x_statements(file, &mut out);
        self.take_back_export_assignments_in_namespaces(file, &mut out);
        // These name a type, which is not asked for before everything has been checked.
        if self.explains {
            for &(start, code) in &hir.early_errors {
                if matches!(code, 17019 | 17020) {
                    explain_jsdoc_nullable_type(self, file, start, code);
                }
            }
        }
        // `GetDeclarationDiagnostics`: no comment directive takes these back, and plain JavaScript has them too.
        let semantic = std::mem::take(&mut out);
        self.check_module_exports_assignments(file, &mut out);
        if self.files().options.emits_declaration_files {
            self.check_declaration_emit(file, &mut out);
        }
        self.commit_reported_from(0);
        self.is_type_checked = true;
        self.checked(syntactic, Some(semantic), out, has_parse_diagnostics)
    }

    fn checked(
        &self,
        syntactic: Vec<Diagnostic>,
        semantic: Option<Vec<Diagnostic>>,
        declaration: Vec<Diagnostic>,
        has_parse_diagnostics: bool,
    ) -> Checked {
        Checked {
            syntactic,
            semantic,
            declaration,
            has_parse_diagnostics,
            never_checked: self.never_checked.take(),
            notes: self.notes.take(),
            suggestions: self.suggestions.take(),
        }
    }

    /// The errors of `file`, once every file whose checker may report in it has been through `check_file`.
    pub fn finish_file(&mut self, file: FileId, checked: Checked) -> Vec<explain::Explained> {
        let hir = self.hir(file);
        *self.notes.borrow_mut() = checked.notes;
        *self.suggestions.borrow_mut() = checked.suggestions;
        (self.checking, self.is_type_checked) = (Some(file), true);
        let is_checked = checked.semantic.is_some();
        let mut out = checked.semantic.unwrap_or_default();
        if is_checked {
            self.drain_sink(file, &checked.never_checked, &mut out);
            if checked.has_parse_diagnostics {
                // `bindNamespaceExportDeclaration` reports 1184 whether or not the file parses.
                out.retain(|d| {
                    !is_grammar_error(d.code)
                        || d.code == 1184 && is_before_namespace_export(hir, d.start)
                });
            }
            let is_plain_js = self.is_plain_js(file);
            if is_plain_js {
                out.retain(|d| errors_js::PLAIN_JS_ERRORS.binary_search(&d.code).is_ok());
            }
            self.include_processor_diagnostics(file, &mut out);
            if !is_plain_js {
                // `JSDocDiagnostics`
                out.extend(
                    hir.jsdoc_errors
                        .iter()
                        .map(|&(start, code)| Diagnostic { start, code }),
                );
                // Last: it goes by all that is left. `getDiagnosticsWithPrecedingDirectives`: not by what the parser says.
                self.check_x_comment_directives(file, &mut out);
            }
        }
        // `GetSyntacticDiagnostics`, `GetDeclarationDiagnostics`: no comment directive takes these back.
        out.extend(checked.declaration);
        out.extend(checked.syntactic);
        out.sort_unstable();
        out.dedup();
        self.explain_errors(file, out)
    }

    /// `GetSyntacticDiagnostics` of a JSON file. `getBindAndCheckDiagnostics` has nothing to say of one.
    fn check_json_file(&self, file: FileId) -> Vec<Diagnostic> {
        let parsed = crate::json::Expression::parse_with_errors(&self.hir(file).text);
        let mut out = Vec::new();
        for error in parsed.map_or_else(Vec::new, |parsed| parsed.1) {
            let (start, code) = (error.start, error.code);
            out.push(Diagnostic { start, code });
            let end = if error.end > start {
                error.end
            } else {
                super::explain::NO_LENGTH
            };
            let arguments = match error.expected {
                "" => Vec::new(),
                token => vec![token.to_owned()],
            };
            self.note(start, end, code, arguments);
        }
        out.sort_unstable();
        out.dedup();
        out
    }

    /// `AddRelatedInfo`, of what arrives as an early error.
    fn relate_early_errors(&mut self, file: FileId) {
        let hir = self.hir(file);
        for &(start, code) in hir.early_errors.iter().chain(hir.jsdoc_errors.iter()) {
            let (from, to, related) = match code {
                // `parseTypedefTag`: it does not say where.
                8033 => (0, 0, 8034),
                // `checkGrammarModifiers`, `checkJSDecoratorSyntax`: the first decorator of what the one at `start` decorates.
                8038 => {
                    let at_sign = |c: &Self, e: ExprId| {
                        let name = (c.start_of(file, e) as usize).min(hir.text.len());
                        let found = hir.text[..name].iter().rposition(|&b| b == b'@');
                        found.map(|at| at as u32)
                    };
                    let after_export = hir
                        .decorators
                        .iter()
                        .find(|d| at_sign(self, d.1) == Some(start));
                    let Some(&(owner, _)) = after_export else {
                        continue;
                    };
                    let Some(&(_, first)) = hir.decorators.iter().find(|d| d.0 == owner) else {
                        continue;
                    };
                    let Some(from) = at_sign(self, first) else {
                        continue;
                    };
                    (from, self.end_of_expr(file, first), 1486)
                }
                _ => continue,
            };
            self.relate(start, code, |_| {
                vec![super::explain::Related {
                    at: Some((file, from, to)),
                    code: related,
                    args: Vec::new(),
                }]
            });
        }
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
                        if matches!(
                            bound.expr_parent[key.idx()],
                            Parent::MemberKey(_) | Parent::MethodKey(_)
                        ) =>
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
                    Parent::PropKey(owner, _) if owner.is_some() => Parent::Expr(owner),
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
                self.note(start, 0, 1359, vec![word_at(self, file, start)]);
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
        self.note(start, 0, code, vec![word_at(self, file, start)]);
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
            self.never_checked.borrow_mut().push((from, to));
            out.retain(|d| {
                !(from..to).contains(&d.start)
                    || is_said_by_the_binder(d.code)
                    || is_said_by_the_parser(d.code)
                        && hir.early_errors.contains(&(d.start, d.code))
            });
        }
    }

    // ───────────────────────────── modules ─────────────────────────────

    /// `CreateModuleNotFoundChain`: what to do about `spec`, which leads into `package`, where nothing declares its types.
    /// `alternate`: `AlternateResult`.
    fn module_not_found_hint(
        &self,
        spec: &str,
        package: &str,
        alternate: Option<String>,
    ) -> super::explain::Line {
        // `MangleScopedPackageName`
        let mangled = match package
            .strip_prefix('@')
            .and_then(|rest| rest.split_once('/'))
        {
            Some((scope, name)) => format!("{scope}__{name}"),
            None => package.to_owned(),
        };
        if let Some(types) = alternate {
            let package = if types.contains("/node_modules/@types/") {
                format!("@types/{mangled}")
            } else {
                package.to_owned()
            };
            return super::explain::Line {
                code: 6278,
                args: vec![types, package],
                level: 1,
            };
        }
        // `GetPackagesMap`
        let (types, own) = (
            format!("/node_modules/@types/{mangled}/"),
            format!("/node_modules/{package}/"),
        );
        let modules = self.files().modules.iter();
        let (mut has_types_package, mut has_declarations) = (false, false);
        for module in modules {
            has_types_package |= module.path.contains(&types);
            has_declarations |= crate::resolve::is_declaration_file_name(&module.path)
                && module.path.contains(&own);
        }
        let (code, args) = if has_types_package {
            (7040, vec![package.to_owned(), mangled])
        } else if has_declarations {
            (7058, vec![package.to_owned(), spec.to_owned()])
        } else {
            (7035, vec![spec.to_owned(), mangled])
        };
        super::explain::Line {
            code,
            args,
            level: 1,
        }
    }

    /// Who asks `resolveExternalModule` besides the import and export declarations. 2322 2880 for the options of `import()`.
    fn check_modules(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let hir = self.hir(file);
        let is_ambient = hir.kind == FileKind::Declaration;
        // `getTypeFromImportTypeNode`
        for &written in &hir.specifier_uses {
            if written.kind == SpecifierKind::ImportType {
                let site = SpecifierSite {
                    is_ambient,
                    ..Default::default()
                };
                self.resolve_external_module(file, written, site);
            }
        }
        let index = self.exprs_by_kind(file);
        // `checkImportCallExpression`
        for &e in index.of(ExprTag::ImportCall) {
            if let ExprKind::ImportCall { args, .. } = hir[e].kind
                && let argument = hir.id_at(args, 0)
                && !self.bound(file).is_unchecked(e.idx())
                && let ExprKind::String(spec) = hir[argument].kind
            {
                let written = SpecifierUse {
                    spec,
                    pos: hir[argument].pos,
                    kind: SpecifierKind::ImportCall,
                    mode: ResolutionMode::None,
                };
                let site = SpecifierSite {
                    is_emittable: true,
                    is_ambient,
                    ..Default::default()
                };
                self.resolve_external_module(file, written, site);
            }
        }
        // `checkAliasSymbol` for the names that `const a = require("m")` declares, `resolveExternalModuleTypeByLiteral` for every other
        // `require("m")`. JavaScript only. Both report at the string.
        if hir.is_js {
            let bound = self.bound(file);
            let is_identifier = |pat: PatId| matches!(hir[pat].kind, PatKind::Ident(_));
            for &call in index.of(ExprTag::Call) {
                let Some((argument, spec)) = crate::bind::require_call_argument(hir, call) else {
                    continue;
                };
                // The loader only resolves the specifiers that the binder collected.
                if !bound.specifiers.contains(&spec) {
                    continue;
                }
                // `bindVariableDeclarationOrBindingElement`: the name, or each identifier directly in the binding pattern, is an alias,
                // whatever `require` resolves to.
                let declares_alias = match bound.expr_parent[call.idx()] {
                    Parent::None => continue,
                    Parent::VarInit(decl)
                        if self.external_module_require_argument(file, decl).is_some() =>
                    {
                        match hir[hir[decl].pat].kind {
                            PatKind::Ident(_) => true,
                            PatKind::Object(props) => {
                                props.iter().any(|p| is_identifier(hir[p].value))
                            }
                            PatKind::Array(elems) => {
                                elems.iter().any(|x| is_identifier(hir[x].pat))
                            }
                            PatKind::Missing => false,
                        }
                    }
                    _ => false,
                };
                if !declares_alias && !self.is_commonjs_require(file, call) {
                    continue;
                }
                let mode = self.require_resolution_mode(file, spec);
                let written = SpecifierUse {
                    spec,
                    pos: hir[argument].pos,
                    kind: SpecifierKind::RequireCall,
                    mode,
                };
                self.resolve_external_module(file, written, SpecifierSite::default());
            }
        }
        // `checkImportCallExpression`: the second argument is an `ImportCallOptions`, taken as a whole.
        let import_options: Vec<ExprId> = index
            .of(ExprTag::ImportCall)
            .iter()
            .filter_map(|&e| match hir[e].kind {
                ExprKind::ImportCall { args, .. } => hir.ids(args).nth(1),
                _ => None,
            })
            .collect();
        if !import_options.is_empty()
            && let Some(sym) = self
                .files()
                .atoms
                .lookup(b"ImportCallOptions")
                .and_then(|name| self.global_type_symbol(name))
        {
            for &options in &import_options {
                if self.bound(file).is_unchecked(options.idx()) {
                    continue;
                }
                let given = self.type_of_expr(file, options);
                let wanted = self.declared_type(sym);
                let wanted = self.optional(wanted);
                let at = self.start_of(file, options);
                let end = if self.explains {
                    self.end_of_expr(file, options)
                } else {
                    0
                };
                self.check_type_assignable_to(given, wanted, Some((file, at, end)), None);
            }
        }
        // `checkImportCallExpression`: 2880 at the first `assert: ..` of an options object literal, with or without a global
        // `ImportCallOptions`.
        for &options in &import_options {
            if self.bound(file).is_unchecked(options.idx()) || is_parenthesized(hir, options) {
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
        for x in 0..hir.exports.len() {
            if hir.exports[x].spec.is_none() {
                self.check_exported_names_are_there(file, x, out);
            }
        }
    }

    /// What `getTargetOfAliasDeclaration` reports of the declaration `decl` in `file` of the alias `sym`, if its module is found:
    /// `getTargetOfModuleDefault`, `getExternalModuleMember`.
    pub(super) fn check_target_of_alias_declaration(&mut self, file: FileId, sym: Sym, decl: Decl) {
        let (hir, bound, files) = (self.hir(file), self.bound(file), self.files());
        if files.declaration_of_alias_symbol(sym) != Some((file, decl)) {
            return;
        }
        let member = match decl {
            Decl::ImportDefault(i) => {
                let mode = files.mode_of_import(file, hir[i].mode);
                Some((hir[i].spec, mode, known::default))
            }
            _ => files.external_module_member_of(file, decl),
        };
        let Some((spec, mode, name)) = member.filter(|it| it.2.is_some()) else {
            return;
        };
        let Some(module) = files.module_of_specifier_as(file, spec, mode) else {
            return;
        };
        // `node.PropertyNameOrName()`, and `getEmitSyntaxForModuleSpecifierExpression` of the specifier.
        let (start, usage) = match decl {
            Decl::ImportSpec(s) => (hir[s].imported_pos, files.module(file).default_mode),
            Decl::ExportSpec(s) => (hir[s].local_pos, files.module(file).default_mode),
            Decl::Require(pat) => match bound.pat_parent[pat.idx()] {
                PatParent::Prop(_, p) => (hir[p].pos, ResolutionMode::Require),
                _ => return,
            },
            _ => (0, files.module(file).default_mode),
        };
        let target = files.module_value(module);
        // In a binding pattern too: `symbolFromModule == nil && nameText == InternalSymbolNameDefault`.
        if name == known::default {
            if self.module_has_default(usage, module) {
                return;
            }
            match decl {
                Decl::ImportDefault(i) => self.report_non_default_export(file, i, module),
                _ => self.error_no_module_member_symbol(file, module, target, spec, name, start),
            }
        } else if !matches!(decl, Decl::Require(_))
            && files.is_only_importable_as_default(usage, module)
        {
            let at = self.place_of_token(file, start);
            self.error(at, 1544, &[Arg::Text(files.options.module.name())]);
        } else if files.alias_links(sym).immediate_target.is_none()
            && self.symbol_from_variable(sym).is_none()
        {
            self.error_no_module_member_symbol(file, module, target, spec, name, start);
        }
    }

    /// `reportNonDefaultExport`
    fn report_non_default_export(&mut self, file: FileId, import: ImportId, module: Sym) {
        let import = &self.hir(file)[import];
        if self.files().export(module, import.default).is_some() {
            let end = end_of_import_clause(self, file, import);
            let args = [Arg::Sym(module), Arg::Atom(import.default)];
            self.error((file, import.clause_start, end), 2613, &args);
            return;
        }
        let export_star = self.export_star_past_a_default(module);
        let related = export_star.map(|at| self.new_diagnostic(at, 1195, &[]));
        let at = self.place_of_token(file, import.default_pos);
        self.error(at, 1192, &[Arg::Sym(module)])
            .related_information
            .extend(related);
    }

    /// `errorNoModuleMemberSymbol`: `name`, written at `start` in `from`, is imported from `module`, which has none. `target`: the value
    /// `module` exports with `export =`, or else `module`. `spec`: the specifier `module` is imported by.
    fn error_no_module_member_symbol(
        &mut self,
        from: FileId,
        module: Sym,
        target: Sym,
        spec: Atom,
        name: Atom,
        start: u32,
    ) {
        let (code, other) = self.why_no_module_member(from, module, target, name, start);
        let module_name = module_name_as_imported(self, module, spec);
        // `DeclarationNameToString`: a string is written with its quotes.
        let written = match self.hir(from).text.get(start as usize) {
            Some(b'"' | b'\'') => word_at(self, from, start),
            _ => self.atom_text(name),
        };
        let (module_name, written) = (Arg::Text(&module_name), Arg::Text(&written));
        let mut related = Vec::new();
        match (code, other) {
            (2724, Some(meant)) => {
                if let Some(place) = self.place_where_value_is_declared(meant) {
                    related.push(self.new_diagnostic(place, 2728, &[Arg::Sym(meant)]));
                }
            }
            // `reportNonExportedMember`
            (2459 | 2460, _) => {
                let local = self.local_of_module(module, name);
                let declarations = local.map(|local| self.files().decls_of(local));
                for (i, &(of, decl)) in declarations.iter().flat_map(|it| it.iter()).enumerate() {
                    if let Some(place) = self.place_of_declaration(of, decl) {
                        related.push(match i {
                            0 => self.new_diagnostic(place, 2728, &[written]),
                            _ => self.new_diagnostic(place, 6204, &[]),
                        });
                    }
                }
            }
            _ => {}
        }
        let args: &[Arg<'_>] = match code {
            2460 | 2724 => &[module_name, written, other.map_or(Arg::Text(""), Arg::Sym)],
            2595 | 2597 => &[written],
            2616 => &[written, written, module_name],
            _ => &[module_name, written],
        };
        let at = self.place_of_token(from, start);
        self.error(at, code, args).related_information = related;
    }

    /// `moduleSymbol.ValueDeclaration.Locals()[name]`: what the file, or the first `declare module "m"`, declares for itself.
    fn local_of_module(&self, module: Sym, name: Atom) -> Option<Sym> {
        let files = self.files();
        let &(of, decl) = files.decls_of(module).first()?;
        let bound = files.bound(of);
        let scope = match decl {
            Decl::File => 0,
            Decl::Module(m) => bound.module_scope[m.idx()].idx(),
            _ => return None,
        };
        let local = bound.lookup(bound.scopes.get(scope)?.locals, name)?;
        Some(files.sym(of, local))
    }

    /// `reportNonDefaultExport`: the first `export *` of `module` that leads to a module with a default export, which is not passed on.
    fn export_star_past_a_default(&self, module: Sym) -> Option<(FileId, u32, u32)> {
        let files = self.files();
        for part in files.parts(module) {
            let hir = self.hir(part.file);
            for &decl in &files.symbol(part).decls {
                let body = match decl {
                    Decl::File => hir.body,
                    Decl::Module(m) => hir[m].body,
                    _ => continue,
                };
                for s in hir.ids(body) {
                    if let StmtKind::ExportStar { spec, alias, .. } = hir[s].kind
                        && alias.is_none()
                        && let Some(target) = files.module_of_specifier(part.file, spec)
                        && files.export(target, known::default).is_some()
                    {
                        return Some((part.file, hir[s].pos, self.end_of_stmt(part.file, s)));
                    }
                }
            }
        }
        None
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
                // 2661, which `check_exports` says.
                || matches!(self.files().atoms.bytes(name), b"any" | b"string" | b"number" | b"boolean" | b"never" | b"unknown")
                // `export { "a" }`: not a name.
                || matches!(hir.text.get(start as usize), Some(b'"' | b'\''))
            {
                continue;
            }
            let code = self.not_found(file, scope, name, all, start);
            out.push(Diagnostic { start, code });
            // `markIdentifierAliasReferenced`: what is kept is looked up once more, as a value.
            if is_marked && !type_only {
                let code = self.not_found(file, scope, name, SymFlags::VALUE, start);
                out.push(Diagnostic { start, code });
            }
        }
    }

    /// `getTargetOfModuleDefault`: whether `module` has a default export, its own or a synthetic one. `usage`: the syntax the specifier is
    /// emitted as (`getEmitSyntaxForModuleSpecifierExpression`), whatever it says of how it is resolved.
    fn module_has_default(&mut self, usage: ResolutionMode, module: Sym) -> bool {
        let files = self.files();
        if files.is_only_importable_as_default(usage, module)
            || self.can_have_synthetic_default(usage, module)
        {
            return true;
        }
        // `resolveExportByName`: of a module that is `export =`, the property `default` of what it is.
        let value = files.module_value(module);
        if value == module {
            return files.export(module, known::default).is_some();
        }
        let ty = self.type_of_symbol(value);
        self.type_of_own_property(ty, known::default).is_some()
    }

    /// `errorNoModuleMemberSymbol`, `reportNonExportedMember`, `reportInvalidImportEqualsExportMember`. The arguments are those of
    /// `error_no_module_member_symbol`. With 2724 comes what may have been meant, with 2460 what the name is exported as.
    fn why_no_module_member(
        &self,
        from: FileId,
        module: Sym,
        target: Sym,
        name: Atom,
        start: u32,
    ) -> (u32, Option<Sym>) {
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
            files.exports_of_module(target).to_vec()
        } else {
            files.exports(target)
        };
        if is_identifier
            && exports.iter().any(|&(other, s)| {
                files.flags(s).intersects(module_member) && is_close(text, files.atoms.bytes(other))
            })
        {
            let candidates = exports
                .iter()
                .filter(|&&(_, s)| files.flags(s).intersects(module_member))
                .map(|&(other, s)| (files.atoms.bytes(other), Meant::Symbol(s)));
            return match get_spelling_suggestion_for_name(files, text, candidates) {
                Some(Meant::Symbol(meant)) => (2724, Some(meant)),
                _ => (2724, None),
            };
        }
        if files.export(module, known::default).is_some() {
            return (2614, None);
        }
        let local = self.local_of_module(module, name);
        let Some(local) = local else {
            return (2305, None);
        };
        // `getSymbolIfSameReference`
        let local = files.resolve_alias(local);
        let own = files.exports(module);
        let Some(equals) = files.export(module, known::export_equals) else {
            return match own.iter().find(|&&(_, e)| files.resolve_alias(e) == local) {
                Some(&(_, exported)) => (2460, Some(exported)),
                None => (2459, None),
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
        let code =
            if local.is_none() || is_more_than_an_alias || files.resolve_alias(equals) != local {
                2305
            } else if files.options.module >= crate::resolve::ModuleKind::Es2015 {
                2595
            } else if self.hir(from).is_js {
                2597
            } else {
                2616
            };
        (code, None)
    }

    /// `errorOnImplicitAnyModule` with `isError`: 7016 at `at`, of `spec`, which is one of the `untyped_imports` of `file` in `mode`.
    pub(super) fn error_on_implicit_any_module(
        &mut self,
        file: FileId,
        spec: Atom,
        mode: ResolutionMode,
        at: (FileId, u32, u32),
    ) {
        let module = self.files().module(file);
        let mut untyped = module.untyped_imports.iter();
        let Some(index) = untyped.position(|&u| u == (spec, mode)) else {
            return;
        };
        let (path, package) = module.untyped_import_files[index];
        let text = self.atom_text(spec);
        let error_info = package
            .filter(|_| !crate::resolve::is_relative(&text))
            .map(|package| {
                let mut alternates = module.untyped_import_alternates.iter();
                let alternate = alternates.find(|a| (a.0, a.1) == (spec, mode));
                let alternate = alternate.map(|a| self.atom_text(a.2));
                let hint = self.module_not_found_hint(&text, &self.atom_text(package), alternate);
                Reported::new(at, hint.code, hint.args)
            });
        let args = [Arg::Atom(spec), Arg::Atom(path)];
        let diagnostic = self.new_diagnostic_chain(error_info, at, 7016, &args);
        self.add_diagnostic(diagnostic);
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
        crate::bind::require_call_argument(hir, init)
    }

    // ───────────────────────────── variables without a value ─────────────────────────────

    /// `symbol.ValueDeclaration` of what the identifier `e` names, if that is a `var`, `let` or `const` of this file: the name that is
    /// bound, and the declaration it is bound in.
    fn value_declaration_of_variable(&self, file: FileId, e: ExprId) -> Option<(PatId, VarDeclId)> {
        let bound = self.bound(file);
        let s = bound.symbols.get(bound.expr_symbol[e.idx()].idx())?;
        // `isParameter`, `isAlias`
        if !s.flags.intersects(SymFlags::VARIABLE)
            || s.flags.intersects(SymFlags::PARAMETER | SymFlags::ALIAS)
        {
            return None;
        }
        let sym = self.files().sym(file, bound.expr_symbol[e.idx()]);
        // In another file it is ambient, or an outer variable: initialized either way.
        let Some((of, Decl::Var(pat))) = self.files().value_declaration(sym) else {
            return None;
        };
        if of != file {
            return None;
        }
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
    pub(super) fn declares_loop_variable(&self, file: FileId, stmt: StmtId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        matches!(bound.stmt_parent[stmt.idx()], Parent::Stmt(owner)
            if matches!(hir[owner].kind, StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. } if left == stmt))
    }

    /// `checkIdentifier`: whether the variable the identifier `e` reads, whose type is `declared`, is taken to hold a value where the
    /// flow of control it is followed in starts (`assumeInitialized`).
    pub(super) fn assumes_initialized(&self, file: FileId, e: ExprId, declared: TypeId) -> bool {
        let is_automatic = self.is_automatic_type(declared);
        if !is_automatic
            && (!self.p.files.options.strict_null_checks
                || declared == TypeId::UNKNOWN
                || declared == TypeId::VOID
                || self.is_any(declared))
        {
            return true;
        }
        let (hir, bound) = (self.hir(file), self.bound(file));
        let parent = bound.expr_parent[e.idx()];
        if hir.kind == FileKind::Declaration || matches!(parent, Parent::None) {
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
            && !is_parenthesized(hir, e)
        {
            return true;
        }
        if !is_automatic
            && (bound.is_in_type_query(e) || hir.is_in_ambient_or_type_node(hir.node(e)))
        {
            return true;
        }
        let symbol = bound.expr_symbol[e.idx()];
        // `isSameScopedBindingElement`: what a pattern binds, read in the nearest default around, which is one of the same pattern.
        // What is in the pattern is numbered before the initializer.
        if decl.pat != pat && e.0 < decl.init.0 {
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
        let declared_in = bound.stmt_parent[stmt.idx()];
        if self.get_control_flow_container(file, parent)
            == self.get_control_flow_container(file, declared_in)
        {
            return false;
        }
        // `isNeverInitialized`: what has been done to it by the time this runs cannot be told, unless nothing ever gives it a value.
        let is_local_let = decl.kind == VarKind::Let
            && !decl.flags.contains(Flags::EXPORT)
            && (hir.has_module_syntax || !matches!(declared_in, Parent::File));
        !(is_local_let
            && decl.pat == pat
            && decl.init.is_none()
            && !self.declares_loop_variable(file, stmt)
            && !bound.is_symbol_assigned_definitely(hir, symbol))
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
                let (key, ty) = match self.declared_member_name(file, member.key) {
                    Some(name) => {
                        let sym = self.files().sym(file, self.bound(file).class_symbol[c]);
                        let instance = self.declared_type(sym);
                        let Some((prop, _)) = self.prop_ref(instance, name) else {
                            continue;
                        };
                        (Some(name), self.type_of_prop(prop, MapperId::IDENTITY))
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
                        start: member.name_pos,
                        code: 2564,
                    });
                    if hir.text.get(member.name_pos as usize) == Some(&b'[') {
                        let (start, end) = (member.name_pos, self.end_of_member_name(file, m));
                        self.explain_to(start, end, 2564, |c| {
                            vec![c.source_text(file, start, end)]
                        });
                    }
                }
            }
        }
    }

    /// `getControlFlowContainer`, of what is directly in `parent`.
    pub(super) fn get_control_flow_container(&self, file: FileId, mut parent: Parent) -> Container {
        let bound = self.bound(file);
        loop {
            let func = match parent {
                Parent::FnBody(f) => f,
                Parent::ParamDefault(p) => bound.param_fn[p.idx()],
                Parent::MemberInit(m)
                    if matches!(bound.member_owner[m.idx()], MemberOwner::Class(_)) =>
                {
                    return Container::Member(m);
                }
                Parent::Module(m) => return Container::Module(m),
                Parent::File => return Container::File,
                Parent::None => return Container::Other,
                _ => {
                    parent = self.parent_of_node(file, parent);
                    continue;
                }
            };
            match self.what_runs_in_place(file, func) {
                Some(it) => parent = it,
                None => return Container::Fn(func),
            }
        }
    }

    /// `node.Parent`, of what `parent` stands for. `None`: of a member of a type literal, whose parent is not kept.
    pub(super) fn parent_of_node(&self, file: FileId, parent: Parent) -> Parent {
        let (hir, bound) = (self.hir(file), self.bound(file));
        match parent {
            Parent::Expr(x) if x.is_none() => Parent::None,
            // Its name and its decorators are inside of a member or a parameter.
            Parent::MethodKey(p) => match hir[hir[p].value].kind {
                ExprKind::Fn(f) => Parent::FnBody(f),
                _ => Parent::None,
            },
            Parent::MemberKey(m) | Parent::Decorator(_, DecoratorOwner::Member(m)) => {
                if hir[m].func.is_some() {
                    Parent::FnBody(hir[m].func)
                } else {
                    Parent::MemberInit(m)
                }
            }
            Parent::Decorator(_, DecoratorOwner::Param(p)) => Parent::ParamDefault(p),
            Parent::MemberInit(m) => match bound.member_owner[m.idx()] {
                MemberOwner::Interface(i) => Parent::Stmt(hir[i].stmt),
                _ => self.outward(file, parent),
            },
            Parent::PropKey(_, p) => Parent::Expr(bound.prop_owner[p.idx()]),
            Parent::PatKey(p) => Parent::PatPropDefault(p),
            Parent::EnumInit(m) => Parent::Stmt(hir[bound.enum_member_owner[m.idx()]].stmt),
            Parent::Module(m) => Parent::Stmt(hir[m].stmt),
            _ => self.outward(file, parent),
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
            if bound.is_unchecked(e.idx())
                // What another declaration of the namespace or the enum around exports, in whichever file, is in scope too.
                || matches!(
                    self.files()
                        .resolve_name_or_error(file, scope, name, SymFlags::VALUE),
                    Ok(Some(_))
                )
            {
                continue;
            }
            // `RequireSymbol`: in JavaScript, `require(x)` needs no declaration. `(require)(x)` is not a require call (`IsRequireCall`).
            if let Parent::Expr(call) = bound.expr_parent[e.idx()]
                && hir.is_js
                && crate::bind::require_argument(hir, call).is_some()
                && matches!(hir[call].kind, ExprKind::Call(c) if hir[c].callee == e)
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
            let code = match self
                .files()
                .resolve(file, scope, name, SymFlags::VALUE, true)
            {
                Err(invalid) => {
                    // `result == nil`
                    let is_found = self
                        .files()
                        .resolve_name(file, scope, name, SymFlags::VALUE)
                        .is_some();
                    let not_found = (!is_found).then_some(e);
                    self.why_invalid_initializer(file, not_found, hir[e].pos, name, invalid)
                }
                Ok(_) => self.why_no_value(file, Some(e), scope, name, hir[e].pos),
            };
            out.push(Diagnostic {
                start: hir[e].pos,
                code,
            });
        }
        // `getSymbol`: an alias is what it stands for. One that stands for no value is not there where a value is wanted, and the search
        // goes on further out.
        // An import is a local of the file or the module it is written in, where the binder found it from the same scope: if it stands
        // for a value, that is where the search ends at the latest. Whether each does, once it has been asked.
        let mut imports_value: Vec<Option<bool>> = Vec::new();
        for &(e, scope) in &bound.alias_idents {
            let ExprKind::Ident(name) = hir[e].kind else {
                continue;
            };
            if bound.is_unchecked(e.idx()) {
                continue;
            }
            if imports_value.is_empty() {
                imports_value.resize(bound.symbols.len(), None);
            }
            let local = bound.expr_symbol[e.idx()];
            let is_value = local.is_some()
                && *imports_value[local.idx()].get_or_insert_with(|| {
                    let symbol = &bound.symbols[local.idx()];
                    !symbol.flags.contains(SymFlags::MERGED)
                        && matches!(
                            symbol.decls.first(),
                            Some(
                                Decl::ImportSpec(_)
                                    | Decl::ImportDefault(_)
                                    | Decl::ImportNamespace(_)
                            )
                        )
                        && self
                            .files()
                            .means(self.files().sym(file, local), SymFlags::VALUE)
                });
            if is_value
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
            let code = self.why_no_value(file, Some(e), scope, name, hir[e].pos);
            out.push(Diagnostic {
                start: hir[e].pos,
                code,
            });
        }
        for i in 0..hir.types.len() {
            if let TypeNodeKind::Import { name, .. } = hir.types[i].kind {
                if !bound.is_unchecked_type(i) && !name.is_empty() {
                    self.check_import_type_names(file, TypeNodeId(i as u32), out);
                }
                continue;
            }
            let TypeNodeKind::Ref { name, .. } = hir.types[i].kind else {
                continue;
            };
            let scope = bound.type_scope[i];
            if bound.is_unchecked_type(i) {
                continue;
            }
            let Some(first) = hir.texts(name).next() else {
                continue;
            };
            // `resolveEntityName`: `NodeIsMissing(name)`
            if first == known::empty {
                continue;
            }
            let start = hir.types[i].pos;
            // `getTypeFromTypeReference`: no symbol is looked for.
            if self
                .get_intended_type_from_jsdoc_type_reference(file, TypeNodeId(i as u32))
                .is_some()
            {
                continue;
            }
            if name.len() > 1 {
                let names: SmallVec<[Atom; 8]> = hir.texts(name).collect();
                self.check_entity_name(file, scope, &names, start, SymFlags::TYPE, out);
                continue;
            }
            let found = match self.resolve(file, scope, first, SymFlags::TYPE, true) {
                Ok(found) => found,
                // 2302 2467 2562
                Err((code, property)) if property.is_none() => {
                    out.push(Diagnostic { start, code });
                    continue;
                }
                Err(invalid) => {
                    let code = self.why_invalid_initializer(file, None, start, first, invalid);
                    out.push(Diagnostic { start, code });
                    continue;
                }
            };
            if found.is_none() {
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
                    self.why_no_type(file, scope, first, start)
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
                        self.why_no_type(file, scope, name, hir[node].pos)
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
            let names: Vec<Atom> = hir.texts(list).collect();
            // `resolveEntityName`: `NodeIsMissing(name)`
            if names[0] == known::empty {
                continue;
            }
            // Where the first name is written: past the name of the alias and the `=`. There is no text of a declaration file.
            let equals = skip_trivia(
                &hir.text,
                import.name_pos as usize + self.files().atoms.bytes(import.name).len(),
            );
            let start = if hir.text.get(equals) == Some(&b'=') {
                skip_trivia(&hir.text, equals + 1)
            } else if hir.early_errors.contains(&(equals as u32, 1005)) {
                // `parseExpected`: an `=` that is left out takes no room.
                equals
            } else {
                continue;
            };
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
                    !bound.is_unchecked(e.idx())
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
                let code = self.why_no_value(file, None, scope, names[0], start);
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
        // `resolveEntityName` looks for a namespace that is not found once more, with a message.
        if let Err(invalid) = self
            .files()
            .resolve(file, scope, first, SymFlags::NAMESPACE, true)
        {
            let code = self.why_invalid_initializer(file, None, start, first, invalid);
            out.push(Diagnostic { start, code });
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
            _ => self.not_found(file, scope, first, SymFlags::NAMESPACE, start),
        };
        out.push(Diagnostic { start, code });
        // It is said of the `QualifiedName` the first two names make.
        if code == 2713 {
            let (text, atoms) = (&self.hir(file).text, &self.files().atoms);
            let property = names[1];
            let dot = skip_trivia(text, start as usize + atoms.bytes(first).len());
            let end = if text.get(dot) == Some(&b'.') {
                (skip_trivia(text, dot + 1) + atoms.bytes(property).len()) as u32
            } else {
                0
            };
            self.explain_to(start, end, code, |c| {
                vec![c.atom_text(first), c.atom_text(property)]
            });
        }
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
        // What `export =` gives could not be found; what a JSON file has is up to what is in it. `resolveSymbol`: an `export =` that
        // is a namespace too (`bindCommonJSTypeExports`) is `currentNamespace` itself.
        let meanings = SymFlags::VALUE | SymFlags::TYPE | SymFlags::NAMESPACE;
        let flags = self.files().flags(sym);
        if flags.contains(SymFlags::ALIAS) && !flags.intersects(meanings)
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
        // `sym` is what an `export { a }` stands for: who says so, and under which name. That alias is `currentNamespace`.
        let mut exported_by: Option<(Sym, Atom)> = None;
        for (i, n) in hir.texts(name).enumerate() {
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
            // `currentNamespace`, as long as it is a symbol here.
            let namespace = ty.is_none().then_some((sym, exported_by));
            let member = if ty.is_none() {
                self.files().namespace_member(sym, n)
            } else {
                None
            };
            // `getSymbol`, `symbolIsValueEx`: an alias is what it stands for, be it exported as a type only.
            let exported = match member {
                Some(member) if self.files().flags(member).intersects(wanted) => Some(member),
                Some(member) => match self.files().resolve_alias_if_needed(member) {
                    Some(target) => self
                        .files()
                        .flags(target)
                        .intersects(wanted)
                        .then_some(target),
                    // What it stands for cannot be told, unless it is a property.
                    None => match self.get_symbol_flags(member) {
                        flags if flags == SymFlags::all() => return,
                        flags => flags.intersects(wanted).then_some(member),
                    },
                },
                None => None,
            };
            let is_there = match exported {
                Some(exported) => {
                    exported_by = member
                        .filter(|&member| {
                            self.files().flags(member).contains(SymFlags::ALIAS)
                                && self.files().export(sym, n) == Some(member)
                        })
                        .map(|_| (sym, n));
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
                    ty = if self.has_any_flag(of) {
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
                if let Some((namespace, exported_by)) = namespace {
                    self.explain(at as u32, 2694, |c| {
                        let qualified = match exported_by {
                            Some((module, name)) => {
                                let module = fully_qualified_name(c, module);
                                format!("{module}.{}", c.atom_text(name))
                            }
                            None => fully_qualified_name(c, namespace),
                        };
                        vec![qualified, c.atom_text(n)]
                    });
                }
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
            if bound.is_unchecked_type(i) {
                continue;
            }
            let (sym, given) = match hir.types[i].kind {
                TypeNodeKind::Ref { name, args } => {
                    let mut names = [Atom::NONE; 8];
                    let node = TypeNodeId(i as u32);
                    if name.len() > names.len()
                        || self
                            .get_intended_type_from_jsdoc_type_reference(file, node)
                            .is_some()
                    {
                        continue;
                    }
                    for (slot, part) in names.iter_mut().zip(hir.texts(name)) {
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
                    for (k, n) in hir.texts(name).enumerate() {
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
            let end = self.end_of_type_node(file, TypeNodeId(i as u32));
            explain_type_argument_count(self, hir.types[i].pos, end, code, sym);
        }
        // `resolveBaseTypesOfClass`: what a class extends, if that is a class, is read like a reference to its type.
        for c in 0..hir.classes.len() {
            let class = &hir.classes[c];
            if class.extends.is_none()
                || bound.class_symbol[c].is_none()
                || bound.is_unchecked(class.extends.idx())
            {
                continue;
            }
            let sym = self.class_sym(file, ClassId(c as u32));
            let constructor = self.base_constructor_type_of_class(sym);
            if !self.is_known(constructor) {
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
            // signatures.
            if !self.outer_type_params_of_symbol(base).is_empty() {
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
                let start = self.start_of(file, class.extends);
                out.push(Diagnostic { start, code });
                let end = end_of_extends(self, file, class);
                explain_type_argument_count(self, start, end, code, base);
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

    /// `getDeclaredTypeOfTypeAlias`: an alias that circularly references itself (2456) never gets its type parameters, so
    /// `getTypeFromTypeAliasReference` takes it for one that is not generic: 2315 with type arguments, nothing without.
    fn recount_type_arguments_of_circular_aliases(
        &mut self,
        file: FileId,
        out: &mut Vec<Diagnostic>,
    ) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut circular: Vec<Sym> = Vec::new();
        for (a, alias) in hir.aliases.iter().enumerate() {
            if alias.type_params.is_empty() || bound.alias_symbol[a].is_none() {
                continue;
            }
            let sym = self.files().sym(file, bound.alias_symbol[a]);
            self.declared_type(sym);
            if self.p.circular_aliases.get(&sym).is_some() {
                circular.push(sym);
            }
        }
        if circular.is_empty() {
            return;
        }
        for (i, node) in hir.types.iter().enumerate() {
            let TypeNodeKind::Ref { name, args } = node.kind else {
                continue;
            };
            if bound.is_unchecked_type(i) {
                continue;
            }
            let names: Vec<Atom> = hir.texts(name).collect();
            let found = self
                .files()
                .resolve_entity(file, bound.type_scope[i], &names, SymFlags::TYPE)
                .and_then(|sym| self.files().resolve_alias_as(sym, SymFlags::TYPE));
            if !found.is_some_and(|sym| circular.contains(&sym)) {
                continue;
            }
            out.retain(|d| d.start != node.pos || !matches!(d.code, 2314 | 2707));
            if !args.is_empty() {
                out.push(Diagnostic {
                    start: node.pos,
                    code: 2315,
                });
                if let Some(sym) = found {
                    let end = self.end_of_type_node(file, TypeNodeId(i as u32));
                    explain_type_argument_count(self, node.pos, end, 2315, sym);
                }
            }
        }
    }

    /// `onFailedToResolveSymbol`: `name` is written where a value goes and no value goes by it. `e`: the identifier, if it is an
    /// expression, which the first name of `import a = b.c` is not. `start`: where it is written.
    fn why_no_value(
        &mut self,
        file: FileId,
        e: Option<ExprId>,
        scope: ScopeId,
        name: Atom,
        start: u32,
    ) -> u32 {
        if let Some(code) = self.what_is_there_instead_of_a_value(file, e, scope, name) {
            return code;
        }
        let code = self.not_found(file, scope, name, SymFlags::VALUE, start);
        // `getCannotFindNameDiagnosticForName`: `await(x)` and `f(await)` were meant to await. Parentheses around the name come between
        // it and the call.
        if code == 2304
            && self.files().atoms.bytes(name) == b"await"
            && let Some(e) = e
            && matches!(self.bound(file).expr_parent[e.idx()], Parent::Expr(p) if matches!(self.hir(file)[p].kind, ExprKind::Call(_) | ExprKind::ImportCall { .. }))
            && !is_parenthesized(self.hir(file), e)
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
            && what_is_similar_in_scope(self, file, scope, name, SymFlags::VALUE).is_some()
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
        if let Some(e) = e
            && self.is_extending_interface(file, e)
        {
            let start = self.hir(file)[e].pos;
            self.explain(start, 2689, |c| vec![c.entity_name_around(file, e)]);
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
                ) && !is_parenthesized(self.hir(file), e)
            });
            return Some(if is_extended { 2863 } else { 2693 });
        }
        if let Some(sym) = self.files().resolve_name(file, scope, name, SymFlags::TYPE) {
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
            if n == names.len() || is_parenthesized(self.hir(file), at) {
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

    /// `name` is written at `start`, where a type goes, and no type goes by it.
    fn why_no_type(&mut self, file: FileId, scope: ScopeId, name: Atom, start: u32) -> u32 {
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
            let flags = self.get_symbol_flags(sym);
            if flags != SymFlags::all()
                && flags.intersects(SymFlags::VALUE)
                && !flags.intersects(SymFlags::NAMESPACE)
            {
                return 2749;
            }
        }
        self.not_found(file, scope, name, SymFlags::TYPE, start)
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

    /// `start`: where `name` is written, which is where the error goes.
    fn not_found(
        &mut self,
        file: FileId,
        scope: ScopeId,
        name: Atom,
        meaning: SymFlags,
        start: u32,
    ) -> u32 {
        let text = self.files().atoms.bytes(name);
        if !is_name_of_a_library_feature(text)
            && what_is_similar_in_scope(self, file, scope, name, meaning).is_some()
        {
            let code = did_you_mean(meaning);
            self.explain(start, code, |c| {
                let meant = name_meant(c, file, scope, name, meaning);
                vec![c.atom_text(name), meant]
            });
            // Who asks for a value and nothing else is `getResolvedSymbol`.
            let is_expression = meaning == SymFlags::VALUE;
            relate_name_meant(self, file, scope, name, meaning, is_expression, start);
            return code;
        }
        if meaning == SymFlags::NAMESPACE {
            return 2503;
        }
        // `getCannotFindNameDiagnosticForName`. `UsesWildcardTypes`: there is nothing to add to `types` then.
        let takes_all_types = self
            .p
            .files
            .options
            .types
            .as_ref()
            .is_some_and(|t| t.iter().any(|t| t == "*"));
        let code = match text {
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
        };
        if code != 2304 {
            self.explain(start, code, |c| {
                let mut arguments = vec![c.atom_text(name)];
                if code == 2583 {
                    arguments.push(library_of_feature(text).to_owned());
                }
                arguments
            });
        } else if self.explains {
            // `DeclarationNameToString`: a name with an escape in it is said as it is written.
            let end = self.end_of_token_at(file, start);
            let written = self.source_text(file, start, end);
            if written.contains('\\') {
                self.note(start, end, code, vec![written]);
            }
        }
        code
    }

    /// `getPropertyOfType`: whether `ty` has a property `name`, what every function and every object has included. What an index
    /// signature covers is no property.
    fn has_property(&mut self, ty: TypeId, name: Atom) -> bool {
        let ty = self.apparent_type(ty);
        if let TypeData::Union(parts) = self.data(ty) {
            return parts.iter().all(|&part| self.has_property(part, name));
        }
        if self.prop_ref(ty, name).is_some() {
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
                if self.prop_ref(function, name).is_some() {
                    return true;
                }
            }
        }
        let object = self.global_ref(known::Object, &[]);
        self.prop_ref(object, name).is_some()
    }

    /// `checkAndReportErrorForInvalidInitializer`: what is said of `name`, written at `start`, for which `Files::resolve` has ended
    /// with `invalid`, 2301 or 2844 and the property. `not_found`: the name, if it is an expression and nothing goes by it.
    fn why_invalid_initializer(
        &mut self,
        file: FileId,
        not_found: Option<ExprId>,
        start: u32,
        name: Atom,
        invalid: (u32, MemberId),
    ) -> u32 {
        if let Some(e) = not_found
            && let Some(code) = self.member_meant_without_prefix(file, e, name)
        {
            return code;
        }
        let (code, property) = invalid;
        // `DeclarationNameToString`: the name of the property as it is written.
        self.explain(start, code, |c| {
            let end = c.end_of_member_name(file, property);
            vec![
                c.source_text(file, c.hir(file)[property].name_pos, end),
                c.atom_text(name),
            ]
        });
        code
    }

    /// `x` where `this.x` or `C.x` was meant: 2663, 2662. `checkAndReportErrorForMissingPrefix`
    fn member_meant_without_prefix(&mut self, file: FileId, e: ExprId, name: Atom) -> Option<u32> {
        let hir = self.hir(file);
        if hir.is_in_type_query(hir.node(e)) {
            return None;
        }
        let container = hir.get_this_container(hir.node(e), false, false);
        let mut location = container;
        while hir.parent(location).is_some() {
            if let Some(class) = hir.class_of(hir.parent(location)).some() {
                let class = self.class_sym(file, class);
                let constructor = self.type_of_symbol(class);
                if self.has_property(constructor, name) {
                    self.explain(hir[e].pos, 2662, |c| {
                        vec![c.atom_text(name), c.symbol_to_string(class)]
                    });
                    return Some(2662);
                }
                if location == container && !hir.is_static(location) {
                    let instance = self.declared_type(class);
                    if self.has_property(instance, name) {
                        return Some(2663);
                    }
                }
            }
            location = hir.parent(location);
        }
        None
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

/// Whether only modifiers are written from `start` to an `export as namespace` statement, whose `pos` is at `export`.
fn is_before_namespace_export(hir: &hir::File, start: u32) -> bool {
    hir.stmts.iter().any(|s| {
        matches!(s.kind, StmtKind::ExportAsNamespace(_))
            && start < s.pos
            && hir
                .text
                .get(start as usize..s.pos as usize)
                .is_some_and(|between| {
                    between
                        .iter()
                        .all(|c| c.is_ascii_alphabetic() || c.is_ascii_whitespace())
                })
    })
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

/// Whether `GetSpellingSuggestion` would take `candidate` for `name`, were it the only one.
pub(super) fn is_close(name: &[u8], candidate: &[u8]) -> bool {
    let only = std::iter::once(candidate);
    get_spelling_suggestion(name, only, get_candidate_name, |a, b| a.cmp(b)).is_some()
}

/// `getCandidateName`: neither the name of a module nor `InternalSymbolNamePrefix`.
fn get_candidate_name(name: &[u8]) -> &[u8] {
    match name {
        [b'"' | 0xFE, ..] => &[],
        name => name,
    }
}

// ───────────────────────────── what goes into the messages ─────────────────────────────

/// Where the element of a tuple type that `start` is in ends: before the `,` or the `]` that comes next and is in no brackets.
fn end_of_tuple_element(c: &Checker<'_>, file: FileId, start: u32) -> u32 {
    let text = &c.hir(file).text[..];
    let (mut end, mut angles) = (start, 0u32);
    loop {
        let at = c.skip_trivia_from(file, end);
        let next = match text.get(at as usize) {
            None | Some(b']' | b')' | b'}') => return end,
            Some(b',' | b';') if angles == 0 => return end,
            Some(b'(' | b'[' | b'{') => c.end_of_bracket_at(file, at),
            Some(b'<') => {
                angles += 1;
                at + 1
            }
            Some(b'>') => {
                angles = angles.saturating_sub(1);
                at + 1
            }
            Some(_) => c.end_of_token_at(file, at),
        };
        if next <= at {
            return end;
        }
        end = next;
    }
}

/// `node.End()` of the member of a type literal that `from` is in: past the `;` or the `,` that comes next and is in no brackets, or
/// before the `}`.
fn end_of_type_member_from(c: &Checker<'_>, file: FileId, from: u32) -> u32 {
    let text = &c.hir(file).text[..];
    let (mut end, mut angles) = (from, 0u32);
    loop {
        let at = c.skip_trivia_from(file, end);
        let next = match text.get(at as usize) {
            None | Some(b'}' | b')' | b']') => return end,
            Some(b';' | b',') if angles == 0 => return at + 1,
            Some(b'(' | b'[' | b'{') => c.end_of_bracket_at(file, at),
            Some(b'<') => {
                angles += 1;
                at + 1
            }
            Some(b'>') => {
                angles = angles.saturating_sub(1);
                at + 1
            }
            Some(_) => c.end_of_token_at(file, at),
        };
        if next <= at {
            return end;
        }
        end = next;
    }
}

/// `checkUnmatchedJSDocParameters`: 8032 is said of all of the `a.b.c` written at `start`, and names it and `a.b`.
fn explain_qualified_parameter_name(c: &Checker<'_>, file: FileId, start: u32) {
    let text = &c.hir(file).text[..];
    let (mut end, mut last_dot) = (word_end(text, start as usize), None);
    while text.get(end) == Some(&b'.') && word_end(text, end + 1) > end + 1 {
        last_dot = Some(end);
        end = word_end(text, end + 1);
    }
    if let Some(dot) = last_dot {
        let whole = c.source_text(file, start, end as u32);
        let left = c.source_text(file, start, dot as u32);
        c.note(start, end as u32, 8032, vec![whole, left]);
    }
}

/// `DeclarationNameToString`, `TokenText`: the name or the word written at `start`.
fn word_at(c: &Checker<'_>, file: FileId, start: u32) -> String {
    c.source_text(file, start, c.end_of_name_at(file, start))
}

/// What may have been meant by a name that nothing goes by.
#[derive(Copy, Clone)]
pub(crate) enum Meant {
    Symbol(Sym),
    /// What has no declaration: the name of a primitive type, `undefined`, `globalThis`.
    Word(&'static str),
}

/// Where the first declaration of `sym` is: the libraries first, then by file, then by position. `compareSymbols`, `compareNodes`
pub(super) fn place_of_first_declaration(files: &Files, sym: Sym) -> Option<(bool, FileId, u32)> {
    let (file, decl) = files.decls_of(sym).first().copied()?;
    let pos = files.start_of_declaration(file, decl);
    Some((!files.module(file).is_lib, file, pos))
}

/// `getSpellingSuggestionForName`
fn get_spelling_suggestion_for_name<'a>(
    files: &Files,
    name: &[u8],
    candidates: impl Iterator<Item = (&'a [u8], Meant)>,
) -> Option<Meant> {
    let place = |meant: Meant| match meant {
        Meant::Symbol(sym) => place_of_first_declaration(files, sym),
        Meant::Word(_) => None,
    };
    // `compareSymbols`
    let compare = |a: (&'a [u8], Meant), b: (&'a [u8], Meant)| {
        match (place(a.1), place(b.1)) {
            (Some(a), Some(b)) => a.cmp(&b),
            (a, b) => b.is_some().cmp(&a.is_some()),
        }
        .then_with(|| a.0.cmp(b.0))
    };
    get_spelling_suggestion(name, candidates, |c| get_candidate_name(c.0), compare).map(|c| c.1)
}

/// `getSuggestedSymbolForNonexistentSymbol`
fn what_is_similar_in_scope(
    c: &Checker<'_>,
    file: FileId,
    scope: ScopeId,
    name: Atom,
    meaning: SymFlags,
) -> Option<Meant> {
    similar_in_scope_and_where(c, file, scope, name, meaning).map(|found| found.0)
}

/// The same, and whether it is come upon among the locals of the block of a module or namespace that exports it. `declareModuleMember`:
/// what is there is a symbol that only leads to what is exported.
fn similar_in_scope_and_where(
    c: &Checker<'_>,
    file: FileId,
    scope: ScopeId,
    name: Atom,
    meaning: SymFlags,
) -> Option<(Meant, bool)> {
    let files = c.files();
    let try_resolve_alias = &mut |sym| Some(files.symbol_flags(sym));
    files.suggested_symbol_for_nonexistent_symbol(file, scope, name, meaning, try_resolve_alias)
}

impl Files {
    /// `getSuggestedSymbolForNonexistentSymbol`, and whether what it finds is among the locals of a block that exports it.
    /// `try_resolve_alias`: the flags of `tryResolveAlias(candidate)`, all of them for `unknownSymbol`. `None`: nil.
    pub(crate) fn suggested_symbol_for_nonexistent_symbol(
        &self,
        file: FileId,
        scope: ScopeId,
        name: Atom,
        meaning: SymFlags,
        try_resolve_alias: &mut dyn FnMut(Sym) -> Option<SymFlags>,
    ) -> Option<(Meant, bool)> {
        let (files, bound) = (self, self.bound(file));
        let text = files.atoms.bytes(name);
        let (mut word, mut is_among_locals) = (None, false);
        // `getSuggestionForSymbolNameLookup`
        let lookup = &mut |table: SymbolTable, held: Option<Sym>, meaning: SymFlags| {
            is_among_locals = matches!(table, SymbolTable::Locals(..));
            if let Some(found) = held.filter(|&sym| files.means(sym, meaning)) {
                return Some(found);
            }
            // `GetSpellingSuggestion` asks for the name of every candidate, and then how far off it is.
            let fits = |&(candidate, sym): &(Atom, Sym)| {
                files.is_spelling_candidate(sym, meaning, &mut *try_resolve_alias)
                    && is_close(text, files.atoms.bytes(candidate))
            };
            let named =
                |(candidate, sym): (Atom, Sym)| (files.atoms.bytes(candidate), Meant::Symbol(sym));
            let meant = match table {
                SymbolTable::Locals(file, scope) => {
                    let s = &bound.scopes[scope.idx()];
                    // `IsGlobalSourceFile`: what a script declares is among the globals.
                    if s.kind == ScopeKind::File && s.symbol.is_none() {
                        return None;
                    }
                    let locals = bound.table(s.locals).iter();
                    let locals = locals.map(|&(candidate, id)| (candidate, files.sym(file, id)));
                    get_spelling_suggestion_for_name(files, text, locals.filter(fits).map(named))
                }
                SymbolTable::Exports(container) => get_spelling_suggestion_for_name(
                    files,
                    text,
                    files.each_export(container).filter(fits).map(named),
                ),
                SymbolTable::Globals => {
                    // `getPrimitiveTypeAliasSuggestions`. `undefinedSymbol` is an entry of `globals`.
                    let primitives: [(&'static str, Atom); 6] = [
                        ("string", known::String),
                        ("number", known::Number),
                        ("boolean", known::Boolean),
                        ("object", known::Object),
                        ("bigint", known::BigInt),
                        ("symbol", known::Symbol),
                    ];
                    let words = primitives
                        .into_iter()
                        .filter(|&(_, wrapper)| {
                            meaning.intersects(SymFlags::TYPE_ALIAS)
                                && files.globals.contains_key(&wrapper)
                        })
                        .map(|(primitive, _)| primitive)
                        .chain(
                            meaning
                                .intersects(SymFlags::VARIABLE)
                                .then_some("undefined"),
                        )
                        .map(|word| (word.as_bytes(), Meant::Word(word)));
                    let globals = files.globals.iter().copied();
                    get_spelling_suggestion_for_name(
                        files,
                        text,
                        globals.filter(fits).map(named).chain(words),
                    )
                }
            };
            match meant? {
                Meant::Symbol(sym) => Some(sym),
                Meant::Word(meant) => {
                    word = Some(meant);
                    None
                }
            }
        };
        let found = files.resolve_with(file, scope, name, meaning, false, lookup);
        if let Some(word) = word {
            return Some((Meant::Word(word), false));
        }
        let sym = found.ok()??;
        let declared = files.symbol(sym);
        let leads_to_export = is_among_locals
            && declared.export_symbol.is_some()
            && !declared.flags.intersects(SymFlags::VALUE);
        Some((Meant::Symbol(sym), leads_to_export))
    }

    /// `getCandidateName` of `getSpellingSuggestionForName`. `unknownSymbol` is made with `SymbolFlagsProperty`: a value, and nothing
    /// else.
    fn is_spelling_candidate(
        &self,
        sym: Sym,
        meaning: SymFlags,
        try_resolve_alias: &mut dyn FnMut(Sym) -> Option<SymFlags>,
    ) -> bool {
        let flags = self.flags(sym);
        if flags.intersects(meaning) {
            return true;
        }
        if !flags.contains(SymFlags::ALIAS) {
            return false;
        }
        match try_resolve_alias(sym) {
            Some(target) if target == SymFlags::all() => meaning.contains(SymFlags::VALUE),
            Some(target) => target.intersects(meaning),
            None => false,
        }
    }
}

/// `symbolToString` of `getSuggestedSymbolForNonexistentSymbol`: the name that may have been meant by `name`, which nothing that is a
/// `meaning` goes by in `scope`. Empty if nothing is close.
pub(super) fn name_meant(
    c: &mut Checker<'_>,
    file: FileId,
    scope: ScopeId,
    name: Atom,
    meaning: SymFlags,
) -> String {
    match what_is_similar_in_scope(c, file, scope, name, meaning) {
        Some(Meant::Symbol(sym)) => c.symbol_to_string(sym),
        Some(Meant::Word(word)) => word.to_owned(),
        None => String::new(),
    }
}

/// `Cannot_find_namespace_0_Did_you_mean_1`, `Cannot_find_name_0_Did_you_mean_1`
fn did_you_mean(meaning: SymFlags) -> u32 {
    if meaning == SymFlags::NAMESPACE {
        2833
    } else {
        2552
    }
}

/// `onFailedToResolveSymbol`: with the error at `start` comes where what `name_meant` names is declared, if it has a `ValueDeclaration`.
/// `is_expression`: `SymbolFlagsExportValue` is asked for too, so that what only leads to an export is taken for the suggestion. It
/// has no such declaration.
pub(super) fn relate_name_meant(
    c: &mut Checker<'_>,
    file: FileId,
    scope: ScopeId,
    name: Atom,
    meaning: SymFlags,
    is_expression: bool,
    start: u32,
) {
    c.relate(start, did_you_mean(meaning), |c| {
        let asked = if is_expression {
            meaning | SymFlags::EXPORT_VALUE
        } else {
            meaning
        };
        let Some((Meant::Symbol(sym), leads_to_export)) =
            similar_in_scope_and_where(c, file, scope, name, asked)
        else {
            return Vec::new();
        };
        if is_expression && leads_to_export {
            return Vec::new();
        }
        let Some(place) = c.place_where_value_is_declared(sym) else {
            return Vec::new();
        };
        let meant = c.symbol_to_string(sym);
        vec![c.declared_here(place, meant)]
    });
}

/// `getSuggestedLibForNonExistentName`: the library of the first entry of `getFeatureMap`, for the names 2583 is said of.
fn library_of_feature(name: &[u8]) -> &'static str {
    match name {
        b"SharedArrayBuffer" | b"Atomics" => "es2017",
        b"AsyncIterable"
        | b"AsyncIterableIterator"
        | b"AsyncGenerator"
        | b"AsyncGeneratorFunction" => "es2018",
        b"BigInt" | b"BigInt64Array" | b"BigUint64Array" => "es2020",
        _ => "es2015",
    }
}

/// `getFullyQualifiedName` of `module`, seen from an import of it. `getSpecifierForModuleSymbol`: a file goes by a specifier that
/// leads to it from there, for which `spec`, the one that is written, is taken.
fn module_name_as_imported(c: &mut Checker<'_>, module: Sym, spec: Atom) -> String {
    let decls = c.files().decls_of(module);
    if decls.iter().any(|d| matches!(d.1, Decl::File)) {
        format!("\"{}\"", c.atom_text(spec))
    } else {
        c.symbol_to_string(module)
    }
}

/// `node.End()` of the clause of `import a, { b } from "m"`, which has a default name.
fn end_of_import_clause(c: &Checker<'_>, file: FileId, import: &Import) -> u32 {
    let text = &c.hir(file).text;
    let name_end = c.end_of_name_at(file, import.default_pos);
    let comma = skip_trivia(text, name_end as usize);
    if text.get(comma) != Some(&b',') {
        return name_end;
    }
    let bindings = skip_trivia(text, comma + 1);
    match text.get(bindings) {
        Some(b'{') => c.end_of_bracket_at(file, bindings as u32),
        Some(b'*') => c.end_of_name_at(file, import.namespace_pos),
        _ => name_end,
    }
}

/// `node.End()` of the `ExpressionWithTypeArguments` that `class` extends. 0: it cannot be told.
fn end_of_extends(c: &Checker<'_>, file: FileId, class: &Class) -> u32 {
    if class.extends_args.is_empty() {
        return c.end_of_expr(file, class.extends);
    }
    let text = &c.hir(file).text;
    let mut at = skip_trivia(text, c.end_of_type_args(file, class.extends_args) as usize);
    if text.get(at) == Some(&b',') {
        at = skip_trivia(text, at + 1);
    }
    if text.get(at) == Some(&b'>') {
        at as u32 + 1
    } else {
        0
    }
}

/// What `getTypeFromClassOrInterfaceReference`, `getTypeFromTypeAliasReference` and `checkNoTypeArguments` say of `sym`. 8026 and 8027
/// are given the arguments of 2314 and 2707, so that their `{0}` is the type.
fn explain_type_argument_count(c: &mut Checker<'_>, start: u32, end: u32, code: u32, sym: Sym) {
    c.explain_to(start, end, code, |c| {
        if code == 2315 {
            return vec![c.symbol_to_string(sym)];
        }
        let flags = c.files().flags(sym);
        let name = if flags.intersects(SymFlags::CLASS | SymFlags::INTERFACE) {
            let declared = c.declared_type(sym);
            // `TypeFormatFlagsWriteArrayAsGenericType`
            match c.array_element(declared) {
                Some(element) => {
                    let (array, element) = (c.symbol_to_string(sym), c.type_to_string(element));
                    format!("{array}<{element}>")
                }
                None => c.type_to_string(declared),
            }
        } else {
            c.symbol_to_string(sym)
        };
        let (least, most) = c.type_argument_arity(sym);
        vec![name, least.to_string(), most.to_string()]
    });
}

/// `getPropertyTypeForIndexType`: where `e` is `a[k]`, the 2540 at `at` is said of all of `k`, and names the property as
/// `symbolToString` does. Of `a.b` it is said of `b`, which is read off the source.
fn explain_readonly_element(
    c: &mut Checker<'_>,
    file: FileId,
    e: ExprId,
    at: u32,
    prop: Option<&Prop>,
    name: Atom,
) {
    let ExprKind::Index { index, .. } = c.hir(file)[e].kind else {
        return;
    };
    let end = error_end_if_read(c, file, index);
    c.explain_to(at, end, 2540, |c| {
        vec![match prop {
            Some(prop) => c.prop_to_string(prop),
            None => c.atom_text(name),
        }]
    });
}

/// `error_end_of`, if it is going to be read.
fn error_end_if_read(c: &Checker<'_>, file: FileId, e: ExprId) -> u32 {
    if c.explains {
        c.error_end_of(file, e)
    } else {
        0
    }
}

/// `entityNameToString`
fn entity_name_text(c: &Checker<'_>, file: FileId, e: ExprId) -> String {
    match c.hir(file)[e].kind {
        ExprKind::Dot { obj, name, .. } => {
            format!("{}.{}", entity_name_text(c, file, obj), c.atom_text(name))
        }
        ExprKind::Ident(name) => c.atom_text(name),
        ExprKind::This => "this".to_owned(),
        _ => String::new(),
    }
}

/// `TokenToString` of the operator of `a op b`, or of `a op= b`.
fn operator_text(op: BinOp, is_assignment: bool) -> String {
    let text = match op {
        BinOp::Add => "+",
        BinOp::Sub => "-",
        BinOp::Mul => "*",
        BinOp::Div => "/",
        BinOp::Rem => "%",
        BinOp::Pow => "**",
        BinOp::Shl => "<<",
        BinOp::Shr => ">>",
        BinOp::UShr => ">>>",
        BinOp::BitAnd => "&",
        BinOp::BitOr => "|",
        BinOp::BitXor => "^",
        BinOp::Lt => "<",
        BinOp::Le => "<=",
        BinOp::Gt => ">",
        BinOp::Ge => ">=",
        BinOp::EqEq => "==",
        BinOp::NotEq => "!=",
        BinOp::EqEqEq => "===",
        BinOp::NotEqEq => "!==",
        BinOp::In => "in",
        BinOp::Instanceof => "instanceof",
        BinOp::And => "&&",
        BinOp::Or => "||",
        BinOp::Nullish => "??",
        BinOp::Comma => ",",
    };
    if is_assignment {
        format!("{text}=")
    } else {
        text.to_owned()
    }
}

/// What an operator asks of the types of its two operands.
type Related = fn(&mut Checker<'_>, TypeId, TypeId) -> bool;

/// `bothAreBigIntLike`
pub(super) fn both_are_bigint_like(c: &mut Checker<'_>, left: TypeId, right: TypeId) -> bool {
    c.is_assignable(left, TypeId::BIGINT) && c.is_assignable(right, TypeId::BIGINT)
}

/// `closeEnoughKind`: what `+` may well take.
pub(super) fn may_be_added(c: &mut Checker<'_>, left: TypeId, right: TypeId) -> bool {
    [left, right].into_iter().all(|t| {
        c.is_any(t)
            || t == TypeId::UNKNOWN
            || c.is_assignable(t, TypeId::NUMBER)
            || c.is_assignable(t, TypeId::BIGINT)
            || c.is_assignable(t, TypeId::STRING)
    })
}

/// What `<`, `<=`, `>` and `>=` take.
pub(super) fn can_be_ordered(c: &mut Checker<'_>, left: TypeId, right: TypeId) -> bool {
    if c.is_any(left) || c.is_any(right) {
        return true;
    }
    let numeric = c.union(&[TypeId::NUMBER, TypeId::BIGINT]);
    let (l, r) = (
        c.is_assignable(left, numeric),
        c.is_assignable(right, numeric),
    );
    l && r || !l && !r && c.are_comparable(left, right)
}

/// `isTypeEqualityComparableTo`, one way or the other.
pub(super) fn can_be_equal(c: &mut Checker<'_>, left: TypeId, right: TypeId) -> bool {
    let nullable = |t: TypeId| t.is_null() || t.is_undefined();
    nullable(left) || nullable(right) || c.are_comparable(left, right)
}

/// `GetViableKeywordSuggestions`
const VIABLE_KEYWORD_SUGGESTIONS: &[&str] = &[
    "abstract",
    "accessor",
    "any",
    "asserts",
    "assert",
    "bigint",
    "boolean",
    "break",
    "case",
    "catch",
    "class",
    "continue",
    "const",
    "constructor",
    "debugger",
    "declare",
    "default",
    "defer",
    "delete",
    "else",
    "enum",
    "export",
    "extends",
    "false",
    "finally",
    "for",
    "from",
    "function",
    "get",
    "immediate",
    "implements",
    "import",
    "infer",
    "instanceof",
    "interface",
    "intrinsic",
    "keyof",
    "let",
    "module",
    "namespace",
    "never",
    "new",
    "null",
    "number",
    "object",
    "package",
    "private",
    "protected",
    "public",
    "override",
    "out",
    "readonly",
    "require",
    "global",
    "return",
    "satisfies",
    "set",
    "static",
    "string",
    "super",
    "switch",
    "symbol",
    "this",
    "throw",
    "true",
    "try",
    "type",
    "typeof",
    "undefined",
    "unique",
    "unknown",
    "using",
    "var",
    "void",
    "while",
    "with",
    "yield",
    "async",
    "await",
];

/// `checkJSDocTypeIsInJsFile`: 17019 of `T?` or `T!`, 17020 of `?T` or `!T`, which starts at `start`.
fn explain_jsdoc_nullable_type(c: &mut Checker<'_>, file: FileId, start: u32, code: u32) {
    let hir = c.hir(file);
    let text = &hir.text[..];
    let is_postfix = code == 17019;
    // With `?` the tree has a union of `T` and a `null` that is put where all of it starts. With `!` it has `T` alone.
    let nullable = hir.types.iter().find_map(|t| match t.kind {
        TypeNodeKind::Union(members) if t.pos == start && members.len() == 2 => {
            let (operand, null) = (hir.id_at(members, 0), hir.id_at(members, 1));
            let is_made_up = hir[null].pos == start
                && matches!(hir[null].kind, TypeNodeKind::Keyword(Keyword::Null));
            is_made_up.then_some(operand)
        }
        _ => None,
    });
    let operand = nullable.or_else(|| {
        let at = if is_postfix {
            start
        } else {
            skip_trivia(text, start as usize + 1) as u32
        };
        // What is around comes after what is inside.
        (0..hir.types.len())
            .rev()
            .map(|i| TypeNodeId(i as u32))
            .find(|&node| {
                hir[node].pos == at
                    && (!is_postfix
                        || text.get(skip_trivia(text, c.end_of_type_node(file, node) as usize))
                            == Some(&b'!'))
            })
    });
    let Some(operand) = operand else {
        return;
    };
    let operand_end = c.end_of_type_node(file, operand);
    let end = if is_postfix {
        skip_trivia(text, operand_end as usize) as u32 + 1
    } else {
        operand_end
    };
    c.explain_to(start, end, code, |c| {
        let mut ty = c.type_from_node(file, operand);
        if nullable.is_none() {
            return vec!["!".to_owned(), c.type_to_string(ty)];
        }
        // `getNullableType`
        if !ty.is_never() && ty != TypeId::VOID {
            ty = if is_postfix {
                c.union(&[ty, TypeId::UNDEFINED])
            } else {
                c.union(&[ty, TypeId::UNDEFINED, TypeId::NULL])
            };
        }
        vec!["?".to_owned(), c.type_to_string(ty)]
    });
}

/// Past the `>` that closes the list whose `<` is at `open`. The parser took it for a list of types.
fn end_of_angle_brackets(c: &Checker<'_>, file: FileId, open: u32) -> Option<u32> {
    let text = &c.hir(file).text[..];
    if text.get(open as usize) != Some(&b'<') {
        return None;
    }
    let (mut at, mut depth) = (open, 0u32);
    loop {
        match text.get(at as usize)? {
            b'<' => {
                depth += 1;
                at += 1;
            }
            b'>' => {
                depth -= 1;
                at += 1;
                if depth == 0 {
                    return Some(at);
                }
            }
            b'(' | b'[' | b'{' => at = c.end_of_bracket_at(file, at).max(at + 1),
            // `=>` is one token.
            _ => at = c.end_of_token_at(file, at).max(at + 1),
        }
        at = c.skip_trivia_from(file, at);
    }
}

/// What goes with an entry of `early_errors`, which is a place and a code, where the source or the tree says it.
fn explain_early_error(c: &Checker<'_>, file: FileId, start: u32, code: u32) {
    let hir = c.hir(file);
    let (text, at) = (&hir.text[..], start as usize);
    match code {
        // `parseExpected`, `parseJsxElementOrSelfClosingElementOrFragment`, `parseNewExpressionOrNewDotTarget`
        1005 | 1209 | 17002 => {
            let mut named: Vec<&str> = hir
                .error_arguments
                .iter()
                .filter(|e| e.0 == start)
                .map(|e| &*e.1)
                .collect();
            // `parseErrorAtPosition` keeps a second error at a place if another lies between the two. Which code an argument goes with
            // is not kept.
            let mut here = hir.early_errors.iter().filter(|e| e.0 == start);
            if code == 1005 && here.all(|e| e.1 == 1005) {
                named.sort_unstable();
                named.dedup();
            } else {
                named.truncate(1);
            }
            for (i, named) in named.into_iter().enumerate() {
                c.note(start, 0, code, vec![named.to_owned()]);
                if i > 0 {
                    c.explain_as_another(start);
                }
            }
        }
        // `parseJsxElementOrSelfClosingElementOrFragment`: from the first of the elements, which commas join, to the end of the last.
        2657 => {
            let joined = hir.exprs.iter().position(|x| {
                matches!(x.kind, ExprKind::Binary { op: BinOp::Comma, left, .. }
                    if hir[left].pos == start && matches!(hir[left].kind, ExprKind::Jsx(_)))
            });
            let Some(joined) = joined else {
                return;
            };
            let mut last = ExprId(joined as u32);
            while let ExprKind::Binary {
                op: BinOp::Comma,
                right,
                ..
            } = hir[last].kind
            {
                last = right;
            }
            c.note(start, c.end_of_expr(file, last), code, Vec::new());
        }
        // `checkGrammarModifiers`, `checkJSDecoratorSyntax`: all of a decorator the class keeps, which is one after `export`.
        // `reportObviousDecoratorErrors` points at the `@`.
        1206 | 8038 => {
            let kept = hir.decorators.iter().find(|decorator| {
                matches!(decorator.0, DecoratorOwner::Class(_))
                    && start_of_token_before(text, c.start_of(file, decorator.1), b"@")
                        == Some(start)
            });
            if let Some(decorator) = kept {
                c.note(start, c.end_of_expr(file, decorator.1), code, Vec::new());
            }
        }
        // `checkGrammarTaggedTemplateChain`, `parseErrorForMissingSemicolonAfter`: said of `node.Template`.
        1358 | 1443 => c.note(start, c.end_of_template_at(file, start), code, Vec::new()),
        // `createIdentifierWithDiagnostic`, `parsingContextErrors`, `parseErrorForInvalidName`: these name the word they are reported at.
        1359 | 1389 | 1390 | 2819 => c.note(start, 0, code, vec![word_at(c, file, start)]),
        // What is made of a tag is as long as the tag, which goes on to the next one: the `?` of `makeQuestionIfOptional`, the type
        // parameters of `@template`.
        1047 | 1051 | 1092 if hir.is_in_jsdoc(start) => {
            let comment = hir.jsdoc_comments.partition_point(|c| c.0 <= start) - 1;
            let last = (hir.jsdoc_comments[comment].1 as usize)
                .saturating_sub(2)
                .min(text.len());
            let end = text[(at + 1).min(last)..last]
                .iter()
                .position(|&b| b == b'@')
                .map_or(last, |next| at + 1 + next);
            c.note(start, end as u32, code, Vec::new());
        }
        // `checkGrammarHeritageClause`: reported where the keyword ends.
        1097 => {
            let end = text[..at.min(text.len())].trim_ascii_end().len();
            let from = text[..end]
                .iter()
                .rposition(|b| !b.is_ascii_alphabetic())
                .map_or(0, |before| before + 1);
            let keyword = c.source_text(file, from as u32, end as u32);
            c.note(start, super::explain::NO_LENGTH, code, vec![keyword]);
        }
        // `Scanner.error`, `parseElementAccessExpressionRest`, `checkGrammarVariableDeclarationList`: said of a place, whatever is there.
        1002 | 1011 | 1123 | 1124 | 1125 | 1177 | 1178 | 1199 => {
            c.note(start, super::explain::NO_LENGTH, code, Vec::new());
        }
        // `createIdentifierWithDiagnostic`: at the end of the file it is said where the last token ends.
        1110 if skip_trivia(text, at) >= text.len() => {
            c.note(start, super::explain::NO_LENGTH, code, Vec::new());
        }
        // `checkGrammarImportClause`: said of the clause, which ends before the `from`.
        1363 => {
            let specifier = hir
                .specifier_uses
                .iter()
                .filter(|used| !used.kind.is_call())
                .map(|used| used.pos)
                .filter(|&pos| pos > start)
                .min();
            if let Some(specifier) = specifier {
                let end = super::errors_x_modules::import_clause_end(text, specifier);
                c.note(start, end, code, Vec::new());
            }
        }
        // `scanNumber`: after a `-` the error starts one character before the literal.
        1121 => {
            let with_minus = text.get(at) != Some(&b'0');
            let zero = at + usize::from(with_minus);
            if text.get(zero) != Some(&b'0') {
                return;
            }
            let mut end = zero + 1;
            while text.get(end).is_some_and(u8::is_ascii_digit) {
                end += 1;
            }
            let digits = c.source_text(file, zero as u32 + 1, end as u32);
            let digits = match digits.trim_start_matches('0') {
                "" => "0",
                digits => digits,
            };
            let sign = if with_minus { "-" } else { "" };
            c.note(start, end as u32, code, vec![format!("{sign}0o{digits}")]);
        }
        // `scanNumberFragment`, `scanHexDigits`: the `_`.
        6188 | 6189 => c.note(start, start + 1, code, Vec::new()),
        // `Scan`: the `#!`.
        18026 => c.note(start, start + 2, code, Vec::new()),
        // `scanConflictMarkerTrivia`: the seven characters of the marker.
        1185 => c.note(start, start + 7, code, Vec::new()),
        // `parseFunctionOrConstructorTypeToError`: said of the type and the blanks before it.
        1385..=1388 => {
            let head = skip_trivia(text, at);
            let written = hir
                .types
                .iter()
                .position(|t| t.pos as usize == head && matches!(t.kind, TypeNodeKind::Fn(_)));
            if let Some(node) = written {
                let end = c.end_of_type_node(file, TypeNodeId(node as u32));
                c.note(start, end, code, Vec::new());
            }
        }
        // `checkGrammarVariableDeclaration`
        1155 | 1492 => {
            let Some(decl) = hir.var_decls.iter().find(|d| hir[d.pat].pos == start) else {
                return;
            };
            let keyword = match decl.kind {
                VarKind::AwaitUsing => "await using",
                VarKind::Using => "using",
                _ => "const",
            };
            let end = c.end_of_pat(file, decl.pat);
            c.note(start, end, code, vec![keyword.to_owned()]);
        }
        // `parseParameterEx`: said of the first decorator or modifier and the blanks before it.
        1433 => {
            let first = skip_trivia(text, at);
            let end = if text.get(first) == Some(&b'@') {
                let written = skip_trivia(text, first + 1) as u32;
                // Those of a first parameter are statements of their own.
                let statements = hir.stmts.iter().filter_map(|s| match s.kind {
                    StmtKind::Expr(e) if e.is_some() => Some(e),
                    _ => None,
                });
                hir.decorators
                    .iter()
                    .map(|decorator| decorator.1)
                    .chain(statements)
                    .find(|&e| c.start_of(file, e) == written)
                    .map_or(0, |e| c.end_of_expr(file, e))
            } else {
                c.end_of_name_at(file, first as u32)
            };
            c.note(start, end, code, Vec::new());
        }
        // `parseErrorForMissingSemicolonAfter`
        1435 => {
            let word = word_at(c, file, start);
            let keywords = VIABLE_KEYWORD_SUGGESTIONS.iter().map(|k| k.as_bytes());
            let suggestion = match spelling_suggestion(word.as_bytes(), keywords) {
                Some(keyword) => keyword,
                // `getSpaceSuggestion`
                _ => match VIABLE_KEYWORD_SUGGESTIONS
                    .iter()
                    .find(|k| word.len() > k.len() + 2 && word.starts_with(**k))
                {
                    Some(keyword) => format!("{keyword} {}", &word[keyword.len()..]),
                    None => return,
                },
            };
            c.note(start, 0, code, vec![suggestion]);
        }
        // `checkGrammarTypeParameterList`, `checkGrammarForAtLeastOneTypeArgument`: from the `<` to what comes after the empty list.
        1098 | 1099 if text.get(at) == Some(&b'<') => {
            c.note(
                start,
                skip_trivia(text, at + 1) as u32 + 1,
                code,
                Vec::new(),
            );
        }
        // `parsePropertyAccessExpressionRest`: the type arguments and their brackets.
        1477 => {
            if let Some(end) = end_of_angle_brackets(c, file, start) {
                c.note(start, end, code, Vec::new());
            }
        }
        // `parseSuperExpression`: from where `super` ends to where its type arguments do.
        2754 => {
            if let Some(end) = end_of_angle_brackets(c, file, skip_trivia(text, at) as u32) {
                c.note(start, end, code, Vec::new());
            }
        }
        // `checkGrammarExpressionWithTypeArguments`: `import<T>`. `checkGrammarImportCallExpression`: all of `import<T>(x)`.
        1326 => {
            let open = skip_trivia(text, at + b"import".len()) as u32;
            if let Some(end) = end_of_angle_brackets(c, file, open) {
                let next = c.skip_trivia_from(file, end);
                let end = if text.get(next as usize) == Some(&b'(') {
                    c.end_of_bracket_at(file, next)
                } else {
                    end
                };
                c.note(start, end, code, Vec::new());
            }
        }
        // `scanEscapeSequence`: up to three octal digits, two after `4` to `7`.
        1487 => {
            let longest = if matches!(text.get(at + 1), Some(b'0'..=b'3')) {
                at + 4
            } else {
                at + 3
            };
            let mut end = at + 2;
            while end < longest && matches!(text.get(end), Some(b'0'..=b'7')) {
                end += 1;
            }
            let digits = c.source_text(file, start + 1, end as u32);
            if let Ok(value) = u32::from_str_radix(&digits, 8) {
                c.note(start, end as u32, code, vec![format!("\\x{value:02x}")]);
            }
        }
        // `checkGrammarIndexSignatureParameters`: without a parameter it is said of the signature.
        1096 => {
            let signature = hir
                .members
                .iter()
                .position(|m| m.kind == MemberKind::IndexSignature && m.start == start);
            if let Some(m) = signature {
                let end = hir.members[m].loc.end;
                c.note(start, end, code, Vec::new());
            }
        }
        // `checkGrammarAccessor`: in an interface or a type literal it is said of the body. `checkGrammarStatementInAmbientContext` points
        // at the `{`.
        1183 => {
            let bound = c.bound(file);
            let is_in_a_type = hir.members.iter().enumerate().any(|(m, member)| {
                matches!(member.kind, MemberKind::Getter | MemberKind::Setter)
                    && member.func.is_some()
                    && !matches!(bound.member_owner[m], MemberOwner::Class(_))
                    && skip_trivia(text, c.end_of_signature(file, member.func) as usize) == at
            });
            if is_in_a_type {
                c.note(start, c.end_of_bracket_at(file, start), code, Vec::new());
            }
        }
        1488 => c.note(
            start,
            start + 2,
            code,
            vec![c.source_text(file, start, start + 2)],
        ),
        // `processPragmasIntoFields`: said of the comment, which ends with its line.
        1084 => {
            let rest = text.get(at..).unwrap_or_default();
            let length = rest
                .iter()
                .position(|&b| matches!(b, b'\n' | b'\r'))
                .unwrap_or(rest.len());
            c.note(start, start + length as u32, code, Vec::new());
        }
        // `GetErrorRangeForNode` of a clause: up to its `:`.
        1113 => {
            let colon = c.skip_trivia_from(file, c.end_of_token_at(file, start));
            if text.get(colon as usize) == Some(&b':') {
                c.note(start, colon + 1, code, Vec::new());
            }
        }
        // `checkGrammarComputedPropertyName`: said of all that is between the brackets.
        1171 => {
            if let Some(open) = start_of_token_before(text, start, b"[") {
                let close = c.end_of_bracket_at(file, open);
                c.note(
                    start,
                    c.end_of_token_before(file, close - 1),
                    code,
                    Vec::new(),
                );
            }
        }
        // `checkGrammarClassDeclarationHeritageClauses`: the tag, the last name in it, the last name of what the class extends.
        8023 => {
            let word = |from: usize| c.source_text(file, from as u32, word_end(text, from) as u32);
            let Some(tag) = text[..at.min(text.len())].iter().rposition(|&b| b == b'@') else {
                return;
            };
            // The comment is on the class that comes next.
            let class = hir
                .classes
                .iter()
                .filter(|class| class.name_pos >= start && class.extends.is_some())
                .min_by_key(|class| class.name_pos);
            let extended = match class.map(|class| hir[class.extends].kind) {
                Some(ExprKind::Ident(name) | ExprKind::Dot { name, .. }) => c.atom_text(name),
                _ => return,
            };
            let name = word(at);
            let end = if name.is_empty() {
                super::explain::NO_LENGTH
            } else {
                start + name.len() as u32
            };
            c.note(start, end, code, vec![word(tag + 1), name, extended]);
        }
        // `parseIdentifierNameErrorOnUnicodeEscapeSequence`: said of the token, which `ScanJsxIdentifier` carries on through every `-`.
        17021 => c.note(start, jsx_identifier_end(text, at) as u32, code, Vec::new()),
        // `parseUnaryExpressionOrHigher`: said of all that is on the left of the `**`.
        17006 | 17007 => {
            let end = hir.exprs.iter().find_map(|x| match x.kind {
                ExprKind::Binary {
                    op: BinOp::Pow,
                    left,
                    ..
                } if c.start_of(file, left) == start => Some(c.end_of_expr(file, left)),
                _ => None,
            });
            let arguments = if code == 17006 {
                vec![c.source_text(file, start, c.end_of_token_at(file, start))]
            } else {
                Vec::new()
            };
            c.note(start, end.unwrap_or(0), code, arguments);
        }
        // `checkGrammarMappedType`: on the first member there is besides. `GetErrorRangeForNode` takes the name of a property, and the
        // whole of a method signature.
        7061 => {
            let mut after = c.skip_trivia_from(file, c.end_of_name_at(file, start));
            if text.get(after as usize) == Some(&b'?') {
                after = c.skip_trivia_from(file, after + 1);
            }
            if matches!(text.get(after as usize), Some(b'(' | b'<')) {
                c.note(
                    start,
                    end_of_type_member_from(c, file, after),
                    code,
                    Vec::new(),
                );
            }
        }
        // `parseJsxElementOrSelfClosingElementOrFragment`, `parseJsxChild`: the name in the opening tag.
        17008 => {
            let name = skip_trivia(text, at) as u32;
            let end = jsx_tag_name_end(text, name as usize) as u32;
            // A name that is missing is where the `<` ends, before any blanks.
            let reaches = if end == name {
                super::explain::NO_LENGTH
            } else {
                end
            };
            c.note(start, reaches, code, vec![c.source_text(file, name, end)]);
        }
        // `getTypeFromImportTypeNode`: said of what `import(..)` is given. `checkExternalImportOrExportDeclaration`: of the expression where
        // the module specifier goes.
        1141 => {
            let argument = hir.types.iter().find_map(|t| match t.kind {
                TypeNodeKind::Import { spec, args, .. } if spec.is_none() && !args.is_empty() => {
                    let argument = hir.id_at(args, 0);
                    (hir[argument].pos == start).then_some(argument)
                }
                _ => None,
            });
            let specifier = hir
                .specifier_expressions
                .iter()
                .find(|&&e| c.start_of(file, e) == start);
            if let Some(argument) = argument {
                c.note(start, c.end_of_type_node(file, argument), code, Vec::new());
            } else if let Some(&specifier) = specifier {
                c.note(start, c.end_of_expr(file, specifier), code, Vec::new());
            }
        }
        // `checkNamedTupleMember`: said of the member or of its type, which end where the element of the tuple does.
        5085..=5087 => c.note(
            start,
            end_of_tuple_element(c, file, start),
            code,
            Vec::new(),
        ),
        // `checkGrammarMetaProperty`
        17012 => {
            let Some(dot) = start_of_token_before(text, start, b".") else {
                return;
            };
            let (keyword, meant) = if start_of_token_before(text, dot, b"new").is_some() {
                ("new", "target")
            } else {
                ("import", "meta")
            };
            c.note(
                start,
                0,
                code,
                vec![
                    word_at(c, file, start),
                    keyword.to_owned(),
                    meant.to_owned(),
                ],
            );
        }
        _ => {}
    }
}

// ───────────────────────────── operators ─────────────────────────────

impl Checker<'_> {
    /// Whether the resolver worked `ty` out, all of it. Nothing is said about what it did not.
    pub(super) fn is_known(&self, ty: TypeId) -> bool {
        !self
            .p
            .types
            .object_flags(ty)
            .contains(ObjectFlags::HAS_UNRESOLVED)
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

    /// The types of the two operands of an operator whose result does not go by them, looked at left to right, and whether both
    /// were found out: if not, nothing is said of the two.
    pub(super) fn check_operands(
        &mut self,
        file: FileId,
        left: ExprId,
        right: ExprId,
    ) -> (TypeId, TypeId, bool) {
        let (l, r) = (
            self.type_of_expr(file, left),
            self.type_of_expr(file, right),
        );
        let is_sure = self.is_known(l) && self.is_known(r);
        (l, r, is_sure)
    }

    /// `checkInExpression`
    pub(super) fn check_in_expression(
        &mut self,
        file: FileId,
        left: ExprId,
        right: ExprId,
        left_type: TypeId,
        right_type: TypeId,
    ) {
        let hir = self.hir(file);
        match hir[left].kind {
            // `#x in v`: what is on the left is a name, looked up in the classes around, and no value. One that none of them
            // declares is missed in what is on the right, as it is.
            ExprKind::String(name) if is_private_name_at(hir, hir[left].pos) => {
                if !self.bound(file).private_class.contains_key(&left)
                    && !self.enclosing_classes(file, left).is_empty()
                {
                    let (start, is_unchecked_js) = (hir[left].pos, self.is_plain_js(file));
                    self.report_nonexistent_property(
                        file,
                        left,
                        name,
                        start,
                        right_type,
                        is_unchecked_js,
                    );
                }
            }
            _ => {
                let key = self.check_non_null_type(file, left, left_type);
                let wanted = self.union(&[TypeId::STRING, TypeId::NUMBER, TypeId::SYMBOL]);
                let at = self.place_of_written_expr(file, left);
                self.check_type_assignable_to(key, wanted, Some(at), None);
            }
        }
        let object = self.check_non_null_type(file, right, right_type);
        let at = self.place_of_written_expr(file, right);
        if self.check_type_assignable_to(object, TypeId::OBJECT, Some(at), None)
            && has_empty_object_intersection(self, right_type)
        {
            self.error(at, 2638, &[Arg::Type(right_type)]);
        }
    }

    /// `getErrorRangeForNode` of `e`, parentheses around it not counted.
    pub(super) fn place_of_expr(&self, file: FileId, e: ExprId) -> (FileId, u32, u32) {
        (
            file,
            self.start_inside_parentheses(file, e),
            self.end_inside_parentheses(file, e),
        )
    }

    /// `getErrorRangeForNode` of `e` as it is written, in its parentheses.
    pub(super) fn place_of_written_expr(&self, file: FileId, e: ExprId) -> (FileId, u32, u32) {
        (
            file,
            self.error_start_of(file, e),
            self.error_end_of(file, e),
        )
    }

    /// `errorAndMaybeSuggestAwait`
    fn error_and_maybe_suggest_await(
        &mut self,
        at: (FileId, u32, u32),
        maybe_missing_await: bool,
        code: u32,
        args: &[Arg<'_>],
    ) {
        let did_you_forget = self.new_diagnostic(at, 2773, &[]);
        let diagnostic = self.error(at, code, args);
        if maybe_missing_await {
            diagnostic.add_related_info(did_you_forget);
        }
    }

    /// `reportOperatorErrorUnless`
    pub(super) fn report_operator_error_unless(
        &mut self,
        file: FileId,
        e: ExprId,
        op: BinOp,
        left: TypeId,
        right: TypeId,
        types_are_compatible: Related,
    ) {
        if !types_are_compatible(self, left, right) {
            self.report_operator_error(file, e, op, left, right, Some(types_are_compatible));
        }
    }

    /// `reportOperatorError`, of `e`, which is `a op b` or `a op= b`: 2365, 2367. `left` and `right`: the types of the operands.
    /// `is_related`: what they fail.
    pub(super) fn report_operator_error(
        &mut self,
        file: FileId,
        e: ExprId,
        op: BinOp,
        left: TypeId,
        right: TypeId,
        is_related: Option<Related>,
    ) {
        let (mut effective_left, mut effective_right) = (left, right);
        let mut would_work_with_await = false;
        if let Some(is_related) = is_related {
            would_work_with_await =
                match (self.awaited_no_alias(left), self.awaited_no_alias(right)) {
                    (Some(l), Some(r)) if (l, r) != (left, right) => is_related(self, l, r),
                    _ => false,
                };
            if !would_work_with_await {
                // `getBaseTypesIfUnrelated`
                let (left_base, right_base) =
                    (self.base_of_literal(left), self.base_of_literal(right));
                if !is_related(self, left_base, right_base) {
                    (effective_left, effective_right) = (left_base, right_base);
                }
            }
        }
        let (left, right) = self.type_names_for_error_display(effective_left, effective_right);
        let at = self.place_of_expr(file, e);
        if matches!(
            op,
            BinOp::EqEq | BinOp::NotEq | BinOp::EqEqEq | BinOp::NotEqEq
        ) {
            let args = [Arg::Text(&left), Arg::Text(&right)];
            return self.error_and_maybe_suggest_await(at, would_work_with_await, 2367, &args);
        }
        let is_assignment = matches!(self.hir(file)[e].kind, ExprKind::Assign { .. });
        let operator = operator_text(op, is_assignment);
        let args = [Arg::Text(&operator), Arg::Text(&left), Arg::Text(&right)];
        self.error_and_maybe_suggest_await(at, would_work_with_await, 2365, &args);
    }

    /// `checkNaNEquality`: 2845.
    pub(super) fn check_nan_equality(
        &mut self,
        file: FileId,
        e: ExprId,
        is_equality: bool,
        left: ExprId,
        right: ExprId,
    ) {
        let (is_left_nan, is_right_nan) = (
            self.is_global_nan(file, left),
            self.is_global_nan(file, right),
        );
        if !is_left_nan && !is_right_nan {
            return;
        }
        let hir = self.hir(file);
        let location = if is_left_nan { right } else { left };
        // `IsEntityNameExpression(SkipParentheses(location))`
        let name = if matches!(hir[location].kind, ExprKind::Ident(_))
            || is_property_access_entity_name_expression(hir, location)
        {
            entity_name_text(self, file, location)
        } else {
            "...".to_owned()
        };
        let not = if is_equality { "" } else { "!" };
        let suggestion = format!("{not}Number.isNaN({name})");
        let (from, to) = self.error_range_of_expr(file, location);
        let did_you_mean = self.new_diagnostic((file, from, to), 1369, &[Arg::Text(&suggestion)]);
        let always = if is_equality { "false" } else { "true" };
        let diagnostic = self.error(self.place_of_expr(file, e), 2845, &[Arg::Text(always)]);
        if !(is_left_nan && is_right_nan) {
            diagnostic.add_related_info(did_you_mean);
        }
    }

    /// 2447, of `&`, `|` or `^` between two booleans: `getSuggestedBooleanOperator`. It is said of the operator, which is the token
    /// before the right operand: the tree does not keep where it is.
    pub(super) fn report_boolean_operands(
        &mut self,
        file: FileId,
        e: ExprId,
        op: BinOp,
        right: ExprId,
    ) {
        let hir = self.hir(file);
        let operator = operator_text(op, matches!(hir[e].kind, ExprKind::Assign { .. }));
        let suggested = match op {
            BinOp::BitAnd => "&&",
            BinOp::BitOr => "||",
            _ => "!==",
        };
        let found =
            start_of_token_before(&hir.text, self.start_of(file, right), operator.as_bytes());
        let at = match found {
            Some(start) => (file, start, start + operator.len() as u32),
            None => self.place_of_token(file, self.start_inside_parentheses(file, e)),
        };
        self.error(at, 2447, &[Arg::Text(&operator), Arg::Text(suggested)]);
    }

    /// 6807: `errorOrSuggestion`, an error in the initializer of a member of an enum and a suggestion anywhere else.
    pub(super) fn check_shift_count(
        &mut self,
        file: FileId,
        e: ExprId,
        op: BinOp,
        left: ExprId,
        right: ExprId,
    ) {
        let is_error = matches!(self.bound(file).expr_parent[e.idx()], Parent::EnumInit(_));
        if (is_error || self.captures_suggestions())
            && let Some(EnumValue::Number(bits)) = self.constant_value(file, right)
            && f64::from_bits(bits).abs() >= 32.0
        {
            let is_assignment = matches!(self.hir(file)[e].kind, ExprKind::Assign { .. });
            let written = self.source_text(
                file,
                self.start_of(file, left),
                self.end_of_expr(file, left),
            );
            let operator = operator_text(op, is_assignment);
            let count = crate::atom::number_to_string(f64::from_bits(bits) % 32.0);
            let args = [Arg::Text(&written), Arg::Text(&operator), Arg::Text(&count)];
            let diagnostic = self.new_diagnostic(self.place_of_expr(file, e), 6807, &args);
            self.add_error_or_suggestion(is_error, diagnostic);
        }
    }

    /// `checkForDisallowedESSymbolOperand`: 2469. `e`: `left op right` or `left op= right`.
    #[allow(clippy::too_many_arguments)]
    pub(super) fn check_for_disallowed_es_symbol_operand(
        &mut self,
        file: FileId,
        e: ExprId,
        op: BinOp,
        left: ExprId,
        right: ExprId,
        l: TypeId,
        r: TypeId,
    ) -> bool {
        let mut may_be_symbol =
            |t| self.maybe_type_of_kind_considering_base_constraint(t, Self::is_symbol_like);
        let offending = if may_be_symbol(l) {
            left
        } else if may_be_symbol(r) {
            right
        } else {
            return true;
        };
        let at = self.place_of_written_expr(file, offending);
        let is_assignment = matches!(self.hir(file)[e].kind, ExprKind::Assign { .. });
        self.error(at, 2469, &[Arg::Text(&operator_text(op, is_assignment))]);
        false
    }

    /// `checkArithmeticOperandType`: whether the operand will do.
    pub(super) fn check_arithmetic_operand_type(
        &mut self,
        file: FileId,
        operand: ExprId,
        ty: TypeId,
        code: u32,
        is_await_valid: bool,
    ) -> bool {
        // Most operands are numbers.
        if self.is_number_like(ty) {
            return true;
        }
        let numeric = self.union(&[TypeId::NUMBER, TypeId::BIGINT]);
        if self.is_assignable(ty, numeric) {
            return true;
        }
        // `getAwaitedTypeOfPromise`
        let awaited = if is_await_valid {
            self.thenable_value(ty)
                .and_then(|promised| self.awaited_or_none(promised))
        } else {
            None
        };
        let maybe_missing_await = awaited
            .is_some_and(|awaited| self.is_known(awaited) && self.is_assignable(awaited, numeric));
        let at = self.place_of_written_expr(file, operand);
        self.error_and_maybe_suggest_await(at, maybe_missing_await, code, &[]);
        false
    }

    /// `checkReferenceExpression`
    pub(super) fn check_reference_expression(
        &mut self,
        file: FileId,
        e: ExprId,
        invalid_reference: u32,
        invalid_optional_chain: u32,
    ) -> bool {
        let hir = self.hir(file);
        let Some(code) = super::errors_x_operators::why_no_reference(
            hir,
            e,
            invalid_reference,
            invalid_optional_chain,
        ) else {
            return true;
        };
        let at = self.place_of_written_expr(file, e);
        self.error(at, code, &[]);
        false
    }

    /// `checkAssignmentOperator`, of `left op= right`: 2364 2779, or 2322 2412 if `right_type` does not fit where it is put.
    /// `left_type`: `checkExpression(left)`, for an arithmetic operator with `null` and `undefined` ruled out. `right_type`: what
    /// is put there, which is what such an operator makes of the two.
    pub(super) fn check_assignment_operator(
        &mut self,
        file: FileId,
        op: BinOp,
        left: ExprId,
        right: ExprId,
        left_type: TypeId,
        right_type: TypeId,
    ) {
        let hir = self.hir(file);
        // A setter may take more than the getter gives: `checkPropertyAccessExpression` with `writeOnly`, `AccessFlagsWriting`.
        let property = match hir[left].kind {
            ExprKind::Dot { obj, name, .. } => Some((obj, name)),
            ExprKind::Index { obj, index, .. } => match hir[index].kind {
                ExprKind::String(name) => Some((obj, name)),
                _ => None,
            },
            _ => None,
        };
        let mut wanted = left_type;
        if !self.is_error_type(left_type)
            && let Some((obj, name)) = property
        {
            let object = self.type_of_expr(file, obj);
            let object = self.non_null_type(object);
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
        if !self.check_reference_expression(file, left, 2364, 2779) {
            return;
        }
        // `isExactOptionalPropertyMismatch`. The property is looked up in the type of the object itself: one that is possibly
        // `undefined` or `null` has no such property.
        let mut head_message = None;
        if self.p.files.options.exact_optional_property_types
            && !is_parenthesized(hir, left)
            && let ExprKind::Dot { obj, name, .. } = hir[left].kind
            && self.maybe_type_of_kind(right_type, |_, t| t.is_undefined())
        {
            let object = self.type_of_expr(file, obj);
            if type_of_property_of_type(self, object, name)
                .is_some_and(|declared| self.contains_missing_type(declared))
            {
                head_message = Some(2412);
            }
        }
        // `AssignmentKindDefinite` has what the target is declared as. Of what is read first a literal counts for all of its kind:
        // `checkIdentifier`, `getFlowTypeOfAccessExpression`.
        if !matches!(op, BinOp::And | BinOp::Or | BinOp::Nullish) {
            wanted = self.base_of_literal(wanted);
        }
        let at = self.place_of_written_expr(file, left);
        self.check_type_assignable_to_and_optionally_elaborate(
            right_type,
            wanted,
            Some(at),
            Some((file, right)),
            false,
            head_message,
            None,
        );
    }

    /// `getBaseTypeOfLiteralTypeForComparison`: `1` and `2` are compared as numbers, and a member of an enum as the string or the number
    /// it is, whatever else is in the enum.
    pub(super) fn base_for_comparison(&mut self, ty: TypeId) -> TypeId {
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

    /// `checkNonNullType`, for a pass.
    pub(super) fn check_not_nullish(
        &mut self,
        file: FileId,
        node: ExprId,
        ty: TypeId,
        out: &mut Vec<Diagnostic>,
    ) -> TypeId {
        self.check_non_null_type_with_reporter(ty, |c, error| {
            let ((_, start, end), code, name) = c.object_possibly_null_error(file, node, error);
            out.push(Diagnostic { start, code });
            c.note(start, end, code, name.into_iter().collect());
        })
    }

    /// `checkNonNullType`: what is left of the type of `node` once `null` and `undefined` are ruled out, which they have to be here.
    pub(super) fn check_non_null_type(&mut self, file: FileId, node: ExprId, ty: TypeId) -> TypeId {
        self.check_non_null_type_with_reporter(ty, |c, error| {
            let (at, code, name) = c.object_possibly_null_error(file, node, error);
            let args: Vec<Arg> = name.iter().map(|name| Arg::Text(name)).collect();
            c.error(at, code, &args);
        })
    }

    /// `reportObjectPossiblyNullOrUndefinedError`, and what `checkNonNullTypeWithReporter` says of `unknown`: where, which of 18050,
    /// 18046 to 18049, 2531 to 2533 and 2571, and the name in it.
    fn object_possibly_null_error(
        &self,
        file: FileId,
        node: ExprId,
        error: super::flow::NonNullError,
    ) -> ((FileId, u32, u32), u32, Option<String>) {
        use super::flow::NonNullError;
        let hir = self.hir(file);
        let is_name = self.is_entity_name(file, node);
        let code = match error {
            NonNullError::IsUnknown if is_name => 18046,
            NonNullError::IsUnknown => 2571,
            NonNullError::IsPossibly { undefined, null } => match hir[node].kind {
                // `(null)` and `(undefined)` are expressions in parentheses.
                ExprKind::Null if !is_parenthesized(hir, node) => 18050,
                ExprKind::Ident(known::undefined) if is_name => 18050,
                _ => match (is_name, undefined, null) {
                    (true, true, true) => 18049,
                    (true, true, false) => 18048,
                    (true, false, _) => 18047,
                    (false, true, true) => 2533,
                    (false, true, false) => 2532,
                    (false, false, _) => 2531,
                },
            },
        };
        let name = match code {
            18050 if matches!(hir[node].kind, ExprKind::Null) => Some("null".to_owned()),
            18046..=18050 => Some(entity_name_text(self, file, node)),
            _ => None,
        };
        let at = (
            file,
            self.error_start_of(file, node),
            self.error_end_of(file, node),
        );
        (at, code, name)
    }

    /// A name that is short enough to be repeated in what is said: `IsEntityNameExpression(node)`,
    /// `len(entityNameToString(node)) < 100`. In a type query `a.b` is a qualified name, which is none, and `this` an Identifier.
    fn is_entity_name(&self, file: FileId, e: ExprId) -> bool {
        let hir = self.hir(file);
        let is_name = if self.bound(file).is_in_type_query(e) {
            matches!(hir[e].kind, ExprKind::Ident(_) | ExprKind::This) && !is_parenthesized(hir, e)
        } else {
            is_entity_name_expression(hir, e)
        };
        is_name && entity_name_text(self, file, e).len() < 100
    }

    /// Where `e` starts as it is written.
    pub(super) fn start_of(&self, file: FileId, e: ExprId) -> u32 {
        let hir = self.hir(file);
        open_parenthesis(hir, e).unwrap_or_else(|| start_inside_parentheses(hir, e))
    }

    /// Where `e` starts, not counting parentheses around the whole of it.
    pub(super) fn start_inside_parentheses(&self, file: FileId, e: ExprId) -> u32 {
        start_inside_parentheses(self.hir(file), e)
    }

    /// `GetErrorRangeForNode`, of a declaration. `None`: the tree does not have it.
    pub(super) fn error_range_of_declaration(
        &self,
        file: FileId,
        decl: Decl,
    ) -> Option<(u32, u32)> {
        let hir = self.hir(file);
        Some(match decl {
            Decl::Member(m) => self.error_range_of_member(file, m),
            Decl::EnumMember(m) => self.error_range_of_enum_member(file, m),
            // All of a parameter, with its modifiers.
            Decl::ParameterProperty(p) => (hir[p].pos, self.end_of_param(file, p)),
            Decl::Param(name)
                if let PatParent::Param(p) = self.bound(file).pat_parent[name.idx()] =>
            {
                (hir[p].pos, self.end_of_param(file, p))
            }
            // `GetNameOfDeclaration`, of a variable declaration or a binding element.
            Decl::Var(name) | Decl::Require(name) | Decl::Param(name) => {
                (hir[name].pos, self.end_of_token_at(file, hir[name].pos))
            }
            // A method or an accessor is pointed at by its name.
            Decl::Property(p) => match hir[p].kind {
                PropKind::Method | PropKind::Getter | PropKind::Setter => {
                    (hir[p].pos, self.end_of_prop_name(file, p))
                }
                _ => (hir[p].pos, self.end_of_prop(file, p)),
            },
            // The file goes by its first token.
            Decl::File | Decl::CommonJsVariable => {
                let start = self.skip_trivia_from(file, 0);
                (start, self.end_of_token_at(file, start))
            }
            Decl::ExportSpec(it) => (hir[it].start, self.end_of_export_spec(file, it)),
            Decl::ExportStarAs(it) => match hir[it].kind {
                StmtKind::ExportStar {
                    star_pos,
                    alias_pos,
                    ..
                } => (star_pos, self.end_of_name_at(file, alias_pos)),
                _ => return None,
            },
            Decl::ModuleExports(e)
            | Decl::ExportsProperty(e)
            | Decl::Expando(e)
            | Decl::ThisProperty(e) => (
                self.error_start_inside_parentheses(file, e),
                self.error_end_inside_parentheses(file, e),
            ),
            _ => {
                let statement = self.files().statement_of_declaration(file, decl)?;
                self.error_range_of_stmt(file, statement)
            }
        })
    }
}

impl Files {
    /// `declaration.Loc`. `None`: the tree does not have it.
    pub(crate) fn loc_of_declaration(&self, file: FileId, decl: Decl) -> Option<hir::TextRange> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        match decl {
            Decl::EnumMember(member) => Some(hir[member].loc),
            Decl::Member(member) => Some(hir[member].loc),
            Decl::ParameterProperty(parameter) => Some(hir[parameter].loc),
            Decl::Var(pat) | Decl::Param(pat) | Decl::Require(pat) => {
                match bound.pat_parent[pat.idx()] {
                    PatParent::Param(parameter) => Some(hir[parameter].loc),
                    PatParent::Var(declaration) => Some(hir[declaration].loc),
                    _ => None,
                }
            }
            _ => Some(hir[self.statement_of_declaration(file, decl)?].loc),
        }
    }

    /// The statement that `decl` is.
    pub(crate) fn statement_of_declaration(&self, file: FileId, decl: Decl) -> Option<StmtId> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let statement = match decl {
            Decl::Fn(function) => match bound.fns[function.idx()].owner {
                FnOwner::Stmt(statement) => statement,
                _ => return None,
            },
            Decl::Class(class) => match bound.class_owner[class.idx()] {
                ClassOwner::Stmt(statement) => statement,
                ClassOwner::Expr(_) => return None,
            },
            Decl::Interface(interface) => hir[interface].stmt,
            Decl::Alias(alias) => hir[alias].stmt,
            Decl::Enum(enumeration) => hir[enumeration].stmt,
            Decl::Module(module) => hir[module].stmt,
            Decl::ImportEquals(import) => hir[import].stmt,
            Decl::ExportExpr(statement) | Decl::UmdGlobal(statement) => statement,
            _ => return None,
        };
        statement.some()
    }

    /// `GetTokenPosOfNode`, of a declaration: where its first token is, decorators and modifiers included.
    pub(crate) fn start_of_declaration(&self, file: FileId, decl: Decl) -> u32 {
        let (hir, bound) = (self.hir(file), self.bound(file));
        match decl {
            Decl::Var(pat) | Decl::Param(pat) | Decl::Require(pat) => {
                match bound.pat_parent[pat.idx()] {
                    PatParent::Param(parameter) => hir[parameter].pos,
                    PatParent::Prop(_, element) => hir[element].pos,
                    PatParent::Elem(_, element) => hir[element].start,
                    PatParent::Var(_) | PatParent::None => hir[pat].pos,
                }
            }
            Decl::Fn(function) => hir[function].start,
            Decl::Class(class) => hir[class].start,
            Decl::Interface(interface) => hir[hir[interface].stmt].start,
            Decl::Alias(alias) => hir[hir[alias].stmt].start,
            Decl::Enum(enumeration) => hir[hir[enumeration].stmt].start,
            Decl::EnumMember(member) => hir[member].pos,
            Decl::Module(module) => hir[hir[module].stmt].start,
            Decl::TypeParam(parameter) => hir[parameter].start,
            Decl::ImportDefault(import) => hir[import].clause_start,
            Decl::ImportNamespace(import) => hir[import].namespace_start,
            Decl::ImportSpec(specifier) => hir[specifier].start,
            Decl::ImportEquals(import) => hir[hir[import].stmt].start,
            Decl::ExportSpec(specifier) => hir[specifier].start,
            Decl::ExportStarAs(statement)
            | Decl::ExportExpr(statement)
            | Decl::UmdGlobal(statement) => match hir[statement].kind {
                StmtKind::ExportStar { star_pos, .. } => star_pos,
                _ => hir[statement].start,
            },
            Decl::ModuleExports(e)
            | Decl::ExportsProperty(e)
            | Decl::Expando(e)
            | Decl::ThisProperty(e)
            | Decl::ObjectLiteral(e) => start_inside_parentheses(hir, e),
            Decl::Member(member) => hir[member].start,
            Decl::ParameterProperty(parameter) => hir[parameter].pos,
            Decl::Property(property) => hir[property].start,
            Decl::TypeLiteral(node) => hir[node].pos,
            Decl::File | Decl::CommonJsVariable => 0,
        }
    }
}

// ───────────────────────────── what is written to ─────────────────────────────

impl Checker<'_> {
    /// How `e` is written to, if it is: by `=`, by an operator that reads it first, or by `++` and `--`.
    fn write_kind(&self, file: FileId, e: ExprId) -> Option<Write> {
        Some(
            match self.bound(file).get_assignment_target(self.hir(file), e)? {
                AssignmentTarget::Assign(Some(_)) => Write::Compound,
                AssignmentTarget::Unary => Write::Step,
                AssignmentTarget::Assign(None) | AssignmentTarget::ForInOrOf => Write::Assign,
            },
        )
    }

    /// 2628 to 2632, 2539, 2588: a name that cannot be assigned to. 2540: a property that can only be read.
    fn check_writes(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let index = self.exprs_by_kind(file);
        let (assignments, unaries) = (index.of(ExprTag::Assign), index.of(ExprTag::Unary));
        // What may be written to: the target of an assignment, of `++` or `--` or of the head of a loop, and in it whatever
        // `write_kind` sees through on its way out.
        let mut targets: Vec<ExprId> = Vec::new();
        for &e in assignments {
            if let ExprKind::Assign { target, .. } = hir[e].kind {
                targets.push(target);
            }
        }
        for &e in unaries {
            if let ExprKind::Unary {
                op: UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec,
                operand,
            } = hir[e].kind
            {
                targets.push(operand);
            }
        }
        for s in &hir.stmts {
            if let StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. } = s.kind
                && let StmtKind::Expr(x) = hir[left].kind
            {
                targets.push(x);
            }
        }
        let mut written: Vec<ExprId> = Vec::new();
        while let Some(e) = targets.pop() {
            if e.is_none() {
                continue;
            }
            match hir[e].kind {
                ExprKind::Ident(_) | ExprKind::Dot { .. } | ExprKind::Index { .. } => {
                    written.push(e)
                }
                ExprKind::NonNull(x) | ExprKind::Spread(x) => targets.push(x),
                ExprKind::Array(items) => targets.extend(hir.ids(items)),
                ExprKind::Object(props) => targets.extend(props.iter().map(|p| hir[p].value)),
                _ => {}
            }
        }
        written.sort_unstable();
        written.dedup();
        for e in written {
            let i = e.idx();
            if bound.is_unchecked(i) {
                continue;
            }
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
                _ => {}
            }
        }
    }

    /// Whatever is got at through `import * as` can only be read: whether `obj` is the name such an import declares.
    fn is_namespace_import_name(&self, file: FileId, obj: ExprId) -> bool {
        matches!(self.hir(file)[obj].kind, ExprKind::Ident(n)
        if self.symbol_of_identifier(file, obj, n).is_some_and(|s| {
            self.files().flags(s).contains(SymFlags::ALIAS) && self.files().symbol(s).decls.iter().any(|d| matches!(d, Decl::ImportNamespace(_)))
        }))
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
        // `getIndexedAccessTypeOrUndefined`: in `a[k]` no property is looked for where `a` has only a string index signature.
        if matches!(self.hir(file)[e].kind, ExprKind::Index { .. })
            && !self.files().atoms.is_symbol_name(name)
        {
            let reduced = self.reduced(ty);
            if self.is_string_index_signature_only(reduced) {
                return;
            }
        }
        // `getReducedApparentType`
        let apparent = self.apparent_type(ty);
        let apparent = self.reduced(apparent);
        if let TypeData::Union(parts) = self.data(apparent) {
            if self.is_readonly_in_union(parts, name) == Some(true) {
                out.push(Diagnostic {
                    start: at,
                    code: 2540,
                });
                explain_readonly_element(self, file, e, at, None, name);
            }
            return;
        }
        // `getPropertyOfType`: what every function and every object has counts.
        let Some(members) = self.members(apparent) else {
            return;
        };
        let Some((prop, _)) = self.property_in(&members, name) else {
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
            // `isReadonlySymbol`: not what `Object.defineProperty(exports, name, descriptor)` makes read-only, unless it is written through
            // `exports` or `module` itself.
            let is_through_module = matches!(self.hir(file)[obj].kind, ExprKind::Ident(n)
            if self.symbol_of_identifier(file, obj, n).is_some_and(|s| {
                self.files().flags(s).contains(SymFlags::MODULE_EXPORTS)
            }));
            if is_through_module {
                return;
            }
            let mut is_refused = false;
            for (declared_in, decl) in self.files().decls(sym) {
                if let Decl::ExportsProperty(declaration) = decl
                    && self.is_readonly_assignment_declaration(declared_in, declaration)
                {
                    is_refused = true;
                    break;
                }
            }
            if is_refused || self.is_namespace_import_name(file, obj) {
                out.push(Diagnostic {
                    start: at,
                    code: 2540,
                });
                explain_readonly_element(self, file, e, at, Some(prop), name);
            }
            return;
        }
        let is_refused = if prop.flags.contains(PropFlags::READONLY) {
            !self.is_written_in_own_constructor(file, e, obj, prop)
        } else if self.has_readonly_assignment_declaration(prop) {
            true
        } else {
            self.is_namespace_import_name(file, obj)
        };
        if is_refused {
            out.push(Diagnostic {
                start: at,
                code: 2540,
            });
            explain_readonly_element(self, file, e, at, Some(prop), name);
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
        // `checkElementAccessExpression`: a `const enum` is looked into with a string literal. Anything else is 2476, and in error.
        if !is_string_literal_like(self.hir(file), index) {
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
            if part.is_never() {
                continue;
            }
            // What a type parameter extends.
            if let TypeData::Union(inner) = self.data(part) {
                is_readonly |= self.is_readonly_in_union(inner, name)?;
                is_declared = true;
                continue;
            }
            let members = self.members(part)?;
            if let Some((prop, _)) = self.property_in(&members, name) {
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
                Some(info) => is_readonly |= info.readonly,
                // An object literal that does not mention it does not have it.
                None if self.is_closed_object_literal_type(part) => {}
                None => return None,
            }
        }
        // Where only signatures answer there is no property, and it is of them that something is said (2542).
        (is_declared && !self.is_hidden_in_union(parts, name)).then_some(is_readonly)
    }

    /// Why the name `e` cannot be given a value, if it cannot. `checkIdentifier`
    fn why_not_assignable(&self, file: FileId, e: ExprId, name: Atom) -> Option<u32> {
        let sym = self.symbol_of_identifier(file, e, name)?;
        let flags = self.files().flags(sym);
        if flags.intersects(SymFlags::VARIABLE) {
            return flags.contains(SymFlags::CONST).then_some(2588);
        }
        Some(if flags.intersects(SymFlags::ENUM) {
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
        let Container::Fn(f) = self.get_control_flow_container(file, bound.expr_parent[e.idx()])
        else {
            return false;
        };
        if hir[f].kind != FnKind::Constructor {
            return false;
        }
        let FnOwner::Member(constructor) = bound.fns[f.idx()].owner else {
            return false;
        };
        match Self::value_declaration(prop) {
            Some(PropSource::Members(members)) => members.iter().any(|&(other, m)| {
                other == file
                    && bound.member_owner[m.idx()] == bound.member_owner[constructor.idx()]
            }),
            Some(PropSource::Parameter(other, p)) => *other == file && bound.param_fn[p.idx()] == f,
            // `isLocalThisPropertyAssignment`
            Some(PropSource::Assigned(other, assignments)) => {
                *other == file
                    && matches!(bound.member_owner[constructor.idx()], MemberOwner::Class(class)
                    if assignments.first().is_some_and(|&first| {
                        bound.this_property(hir, first).is_some_and(|x| x.0 == class)
                    }))
            }
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
