//! What is wrong with a file. The resolver answers questions and never complains; this goes over everything that is
//! written, once, asks it what it needs to know, and says where that does not add up.
//!
//! The codes are the TypeScript compiler's. An error that would rest on something the resolver could not work out is not
//! reported: better to miss one than to make one up.

use super::errors_modules::fully_qualified_name;
use super::errors_x_operators::has_empty_object_intersection;
use super::sink::held;
use super::*;
use crate::bind::{ClassOwner, Decl, FnOwner, MemberOwner, Parent, PatParent, ScopeId, ScopeKind};
use crate::program::SymbolTable;
use bstr::ByteSlice;

/// What `check_file` found. What a question that was under way reported is in the sink. `finish_file` makes the errors of the file of it.
pub struct Checked {
    /// `GetSyntacticDiagnostics`
    syntactic: Vec<Reported>,
    /// `getBindAndCheckDiagnostics`, as far as it was reported with no question under way: what is never checked has been taken back.
    /// `None`: the file is not checked.
    semantic: Option<Vec<Reported>>,
    /// `GetDeclarationDiagnostics`
    declaration: Vec<Reported>,
    has_parse_diagnostics: bool,
    never_checked: Vec<(u32, u32)>,
}

impl Checked {
    pub(super) fn is_empty(&self) -> bool {
        self.syntactic.is_empty()
            && self.declaration.is_empty()
            && self.semantic.as_ref().is_none_or(Vec::is_empty)
    }
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
        self.noted_ahead.clear();
        self.limits = 0;
        self.instantiations_up_to_a_limit.clear();
        self.deferred_diagnostics.clear();
        self.node_check_flags.clear();
        self.never_checked.borrow_mut().clear();
        self.reported.clear();
        self.release_shapes_for_now();
        self.is_type_checked = false;
        let hir = self.hir(file);
        // `GetSyntacticDiagnostics` and `getBindAndCheckDiagnosticsWithChecker` are separate: only the second depends on whether the
        // file is checked.
        self.checking = Some(file);
        let is_syntactic = |d: &Reported| {
            is_syntactic_early_error(hir, d.start, d.code)
                // `checkJSDecoratorSyntax`: the parser's `jsDiagnostics`, which `hasParseDiagnostics` does not count.
                || hir.is_js && matches!(d.code, 1206 | 8038)
        };
        for &(start, code) in hir.early_errors.iter() {
            self.error_at((file, start, 0), code, &[]);
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
                vec![Reported::new(
                    (file, open, open),
                    1007,
                    held(vec![char::from(bracket).to_string(), closing.to_owned()]),
                )]
            });
        }
        self.relate_early_errors(file, &hir.early_errors);
        // `hasParseDiagnostics`: in a file with parser or scanner errors, `grammarErrorOnNode` and its like report nothing, and neither do
        // the binder's `checkContextualIdentifier` and `checkPrivateIdentifier`. Early errors with their codes are dropped as well.
        // Errors the checker reports with a plain `error` stay.
        let has_parse_diagnostics = hir.has_parse_diagnostics
            || self
                .reported
                .iter()
                .any(|d| is_syntactic_early_error(hir, d.start, d.code));
        let (syntactic, early): (Vec<Reported>, Vec<Reported>) = std::mem::take(&mut self.reported)
            .into_iter()
            .partition(is_syntactic);
        self.reported = syntactic;
        // `GetSyntacticDiagnostics`: `file.JSDiagnostics()`
        for &(start, end, code, what) in hir.js_diagnostics.iter() {
            let args = (!what.is_empty()).then(|| what.into());
            self.add_diagnostic(Reported::new(
                (file, start, end),
                code,
                args.into_iter().collect(),
            ));
        }
        self.get_additional_js_syntactic_diagnostics(file);
        // `getBindAndCheckDiagnostics` has nothing to say of a JSON file.
        let is_json = hir.kind == FileKind::Json;
        if self.only_syntax || is_json || !self.reports_semantic_errors(file) {
            return self.checked(None, false);
        }
        self.settle_what_was_noted_ahead();
        let syntactic = std::mem::take(&mut self.reported);
        for d in early {
            if !has_parse_diagnostics || !is_grammar_error(d.code) {
                self.reported.push(d);
            }
        }
        for &(start, code) in hir.checker_errors.iter() {
            self.error_at((file, start, 0), code, &[]);
            explain_early_error(self, file, start, code);
        }
        // `checkUnmatchedJSDocParameters`
        for &(start, code) in self.bound(file).jsdoc_param_errors.iter() {
            self.error_at((file, start, 0), code, &[]);
            explain_early_error(self, file, start, code);
        }
        self.checking = Some(file);
        self.emit_resolver_links = Default::default();
        if self.p.files.options.emits_first {
            self.inline_const_enums(file);
        }
        self.check_source_file(file);
        self.check_declare_modifiers(file);
        self.check_empty_declaration_lists(file);
        self.check_modules(file);
        self.report_unresolved_identifiers();
        self.check_keywords_implemented(file);
        self.check_property_accesses(file);
        self.check_calls(file);
        self.check_unused(file);
        self.check_grammar(file);
        self.check_duplicates(file);
        self.check_jsx(file);
        self.check_overloads(file);
        self.check_use_before_declaration(file);
        self.check_iteration(file);
        self.check_names_and_exports(file);
        self.check_jumps_and_labels(file);
        self.check_declarations(file);
        self.check_small_things(file);
        self.check_circularities(file);
        self.check_assignments(file);
        self.check_x_aliases(file);
        // It takes back what has been said of specifiers that are never resolved.
        self.check_x_modules(file);
        self.produce_deferred_diagnostics(file);
        self.check_x_typenodes(file);
        // The last two put other words in the place of what has been said: of what is assigned, of names that are not found.
        self.check_x_signatures(file);
        self.check_x_operators(file);
        self.check_x_enums_names(file);
        self.report_unresolved_identifiers();
        self.check_external_emit_helpers(file);
        // It takes back what has been said of decorators that are out of place.
        self.report_decorators(file);
        self.check_strict_mode_statements(file);
        // `checkWithStatement`, `checkReturnStatement`, `checkExportAssignment`: what they never look at is taken back, whoever said it.
        self.take_back_what_is_never_checked(file);
        // These name a type, which is not asked for before everything has been checked.
        for &(start, code) in &hir.early_errors {
            if matches!(code, 17019 | 17020) {
                explain_jsdoc_nullable_type(self, file, start, code);
            }
        }
        self.report_unresolved_identifiers();
        // `GetDeclarationDiagnostics`: no comment directive takes these back, and plain JavaScript has them too.
        self.settle_what_was_noted_ahead();
        // What is reported of another file goes where that file finds it.
        let (semantic, elsewhere) = (std::mem::take(&mut self.reported).into_iter())
            .partition(|d: &Reported| d.file == file);
        self.reported = elsewhere;
        self.commit_reported_from(0);
        self.check_module_exports_assignments(file);
        if self.files().options.emits_declarations {
            self.check_declaration_emit(file);
        }
        self.is_type_checked = true;
        let mut checked = self.checked(Some(semantic), has_parse_diagnostics);
        checked.declaration = std::mem::replace(&mut checked.syntactic, syntactic);
        checked
    }

    /// What has been reported and not committed is `GetSyntacticDiagnostics`.
    fn checked(&mut self, semantic: Option<Vec<Reported>>, has_parse_diagnostics: bool) -> Checked {
        self.settle_what_was_noted_ahead();
        Checked {
            syntactic: std::mem::take(&mut self.reported),
            semantic,
            declaration: Vec::new(),
            has_parse_diagnostics,
            never_checked: self.never_checked.take(),
        }
    }

    /// The errors of `file`, once every file whose checker may report in it has been through `check_file`.
    pub fn finish_file(&mut self, file: FileId, checked: Checked) -> Vec<explain::Explained> {
        let hir = self.hir(file);
        (self.checking, self.is_type_checked) = (Some(file), true);
        self.reported.clear();
        self.noted_ahead.clear();
        if let Some(semantic) = checked.semantic {
            self.reported = semantic;
            let settled = self.drain_sink(file, &checked.never_checked);
            self.reported.extend(settled);
            if checked.has_parse_diagnostics {
                // `bindNamespaceExportDeclaration` reports 1184 whether or not the file parses.
                self.reported.retain(|d| {
                    !is_grammar_error(d.code)
                        || d.code == 1184 && is_before_namespace_export(hir, d.start)
                });
            }
            let is_plain_js = self.is_plain_js(file);
            if is_plain_js {
                self.reported
                    .retain(|d| errors_js::PLAIN_JS_ERRORS.binary_search(&d.code).is_ok());
            }
            self.include_processor_diagnostics(file);
            if !is_plain_js {
                // `JSDocDiagnostics`
                for &(start, code) in hir.jsdoc_errors.iter() {
                    self.error_at((file, start, 0), code, &[]);
                    explain_early_error(self, file, start, code);
                }
                self.relate_early_errors(file, &hir.jsdoc_errors);
                // Last: it goes by all that is left. `getDiagnosticsWithPrecedingDirectives`: not by what the parser says.
                self.check_x_comment_directives(file);
            }
        }
        self.settle_what_was_noted_ahead();
        // `GetSyntacticDiagnostics`, `GetDeclarationDiagnostics`: no comment directive takes these back.
        let mut out = std::mem::take(&mut self.reported);
        out.extend(checked.declaration);
        out.extend(checked.syntactic);
        // What is reported bare is the same error as what is reported with its arguments.
        let said: Vec<(u32, u32)> = out
            .iter()
            .filter(|d| !d.is_bare())
            .map(|d| (d.start, d.code))
            .collect();
        out.retain(|d| !d.is_bare() || !said.contains(&(d.start, d.code)));
        for d in &mut out {
            self.settle_place(d);
        }
        self.sort_and_deduplicate_diagnostics(&mut out);
        out.into_iter().map(|d| self.explained(d)).collect()
    }

    /// `AddRelatedInfo`, of what arrives as an early error.
    fn relate_early_errors(&mut self, file: FileId, errors: &[(u32, u32)]) {
        let hir = self.hir(file);
        for &(start, code) in errors {
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
                vec![Reported::bare((file, from, to), related)]
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
                args: held(vec![types, package]),
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
            has_types_package |= module.path.contains_str(&types);
            has_declarations |= crate::resolve::is_declaration_file_name(&module.path)
                && module.path.contains_str(&own);
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
            args: held(args),
            level: 1,
        }
    }

    /// Who asks `resolveExternalModule` besides the import and export declarations. 2322 2880 for the options of `import()`.
    fn check_modules(&mut self, file: FileId) {
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
                let end = self.end_of_expr(file, options);
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
                self.error_at((file, prop.pos, 0), 2880, &[]);
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
            self.error_at(at, 1544, &[Arg::Bytes(files.options.module.name())]);
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
            let end = import.clause_end;
            let args = [Arg::Sym(module), Arg::Atom(import.default)];
            self.error_at((file, import.clause_start, end), 2613, &args);
            return;
        }
        let export_star = self.export_star_past_a_default(module);
        let related = export_star.map(|at| self.new_diagnostic(at, 1195, &[]));
        let at = self.place_of_token(file, import.default_pos);
        self.error_at(at, 1192, &[Arg::Sym(module)])
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
        self.error_at(at, code, args).related_information = related;
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
                        return Some((part.file, hir[s].start, self.end_of_stmt(part.file, s)));
                    }
                }
            }
        }
        None
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
            .filter(|_| !crate::resolve::is_relative(text.as_bytes()))
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
    pub(super) fn check_property_initialization(&mut self, file: FileId, c: ClassId) {
        let (options, hir) = (&self.p.files.options, self.hir(file));
        let class = &hir[c];
        if !options.strict_null_checks
            || !options.strict_property_initialization
            || hir.kind == FileKind::Declaration
            || class.flags.contains(Flags::AMBIENT)
        {
            return;
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
                    let sym = self.class_sym(file, c);
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
                // `DeclarationNameToString`
                let (start, end) = (member.name_pos, self.end_of_member_name(file, m));
                let name = Arg::Bytes(&hir.text[start as usize..end as usize]);
                self.error_at((file, start, end), 2564, &[name]);
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

    /// `resolveEntityName`, of the name of a primitive type after `implements`: a name like any other there, which is kept as the keyword.
    fn check_keywords_implemented(&mut self, file: FileId) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        for node in hir.classes.iter().flat_map(|c| hir.ids(c.implements)) {
            let TypeNodeKind::Keyword(keyword) = hir[node].kind else {
                continue;
            };
            if matches!(
                keyword,
                Keyword::Void | Keyword::Null | Keyword::This | Keyword::Intrinsic
            ) {
                continue;
            }
            let (location, scope) = (hir.node(node), bound.type_scope[node.idx()]);
            let (start, end) = self.get_error_range_for_node(file, location);
            if let Some(written) = hir.text.get(start as usize..end as usize) {
                let name = self.files().atoms.intern(written);
                self.on_failed_to_resolve_symbol(
                    file,
                    location,
                    None,
                    scope,
                    name,
                    SymFlags::TYPE,
                    2304,
                );
            }
        }
    }

    /// `addLazyDiagnostic`, which `onFailedToResolveSymbol` is wrapped in in checker.ts. To say what is wrong with a name classes are asked
    /// for their members, which here closes a circle with a question that is under way. So it is said when none is.
    fn report_unresolved_identifiers(&mut self) {
        while !self.unresolved_identifiers.is_empty() {
            let mut unresolved = std::mem::take(&mut self.unresolved_identifiers);
            unresolved.sort_unstable_by_key(|u| (u.0, u.1));
            unresolved.dedup_by_key(|u| (u.0, u.1));
            for (file, e, name) in unresolved {
                self.report_unresolved_identifier(file, e, name);
            }
        }
    }

    /// `getResolvedSymbol`, where `resolveName` comes back with nothing: no value goes by `name`, the identifier `e`.
    fn report_unresolved_identifier(&mut self, file: FileId, e: ExprId, name: Atom) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let scope_among = |idents: &[(ExprId, ScopeId)]| {
            let i = idents.binary_search_by_key(&e, |ident| ident.0).ok()?;
            Some(idents[i].1)
        };
        let Some(scope) =
            scope_among(&bound.free_idents).or_else(|| scope_among(&bound.alias_idents))
        else {
            return;
        };
        // `await x` where it cannot be: the parser took the keyword for a name, and has said what is wrong.
        if bound.is_unchecked(e.idx()) || hir.early_errors.contains(&(hir[e].pos, 1308)) {
            return;
        }
        match bound.expr_parent[e.idx()] {
            // `checkExportAssignment`: `export = A` and `export default A` are about whatever `A` is. In a namespace they are out of
            // place, and `A` is not looked at.
            Parent::Stmt(s)
                if matches!(
                    hir[s].kind,
                    StmtKind::ExportAssign(_) | StmtKind::ExportDefault(_)
                ) && (matches!(bound.stmt_parent[s.idx()], Parent::Module(m) if matches!(hir[m].name, ModuleName::Ident(_)))
                    || self
                        .files()
                        .resolve_name(file, scope, name, SymFlags::TYPE | SymFlags::NAMESPACE)
                        .is_some()) =>
            {
                return;
            }
            // `checkShorthandPropertyAssignment`: outside a destructuring pattern only the initializer of `{ a = 1 }` is checked.
            Parent::Expr(assign)
                if matches!(hir[assign].kind, ExprKind::Assign { op: None, target, .. } if target == e)
                    && matches!(bound.expr_parent[assign.idx()], Parent::Prop(p) if hir[p].kind == PropKind::Shorthand
                        && !self.is_assignment_target(file, bound.prop_owner[p.idx()])) =>
            {
                return;
            }
            _ => {}
        }
        let location = hir.node(e);
        match self
            .files()
            .resolve(file, scope, name, SymFlags::VALUE, true)
        {
            Err(error) => self.check_and_report_error_for_invalid_initializer(
                file,
                location,
                scope,
                name,
                SymFlags::VALUE,
                error,
            ),
            Ok(_) => {
                let message = self.get_cannot_find_name_diagnostic_for_name(file, location, name);
                let meaning = SymFlags::VALUE | SymFlags::EXPORT_VALUE;
                self.on_failed_to_resolve_symbol(
                    file, location, None, scope, name, meaning, message,
                );
            }
        }
    }

    /// What `resolveEntityName` says of `names`, which come to nothing. `meaning`: what the last has to be.
    pub(super) fn report_unresolved_entity_name(
        &mut self,
        file: FileId,
        scope: ScopeId,
        names: Span<NameId>,
        meaning: SymFlags,
    ) {
        let hir = self.hir(file);
        let Some(first) = names.iter().next() else {
            return;
        };
        let (location, name) = (hir.node(first), hir[first].text);
        let meaning_of_first = if names.len() > 1 {
            SymFlags::NAMESPACE
        } else {
            meaning
        };
        let is_namespace = meaning_of_first == SymFlags::NAMESPACE;
        // `NodeIsMissing(name)`
        if name == known::empty {
            return;
        }
        match self.resolve(file, scope, name, meaning_of_first, true) {
            Ok(Some(_)) if names.len() > 1 => {
                self.check_qualified_name(file, scope, names, meaning)
            }
            Ok(Some(_)) => {}
            Err(error) => self.check_and_report_error_for_invalid_initializer(
                file,
                location,
                scope,
                name,
                meaning_of_first,
                error,
            ),
            Ok(None) => {
                let message = if is_namespace {
                    2503
                } else {
                    self.get_cannot_find_name_diagnostic_for_name(file, location, name)
                };
                self.on_failed_to_resolve_symbol(
                    file,
                    location,
                    None,
                    scope,
                    name,
                    meaning_of_first,
                    message,
                );
            }
        }
    }

    /// `checkAndReportErrorForInvalidInitializer`: 2301 2844, with the property. Without one: what `Resolve` says itself, 2302 2467 2562.
    fn check_and_report_error_for_invalid_initializer(
        &mut self,
        file: FileId,
        location: Node,
        scope: ScopeId,
        name: Atom,
        meaning: SymFlags,
        (code, property): (u32, MemberId),
    ) {
        if property.is_none() {
            self.error(file, location, code, &[]);
            return;
        }
        // `result == nil`
        if self
            .files()
            .resolve_name(file, scope, name, meaning)
            .is_none()
            && self.check_and_report_error_for_missing_prefix(file, location, name)
        {
            return;
        }
        // `DeclarationNameToString`
        let hir = self.hir(file);
        let written =
            hir[property].name_pos as usize..self.end_of_member_name(file, property) as usize;
        let args = [
            Arg::Bytes(hir.text.get(written).unwrap_or_default()),
            Arg::Atom(name),
        ];
        self.error(file, location, code, &args);
    }

    /// `checkAndReportErrorForMissingPrefix`
    fn check_and_report_error_for_missing_prefix(
        &mut self,
        file: FileId,
        location: Node,
        name: Atom,
    ) -> bool {
        let hir = self.hir(file);
        // `isTypeReferenceIdentifier`: a name that is no expression stands in no class.
        if !matches!(hir.data(location), NodeData::Expr(_))
            || hir.kind(location) != Kind::Identifier
            || hir.text(location) != name
            || hir.is_in_type_query(location)
        {
            return false;
        }
        let container = hir.get_this_container(location, false, false);
        let mut at = container;
        while hir.parent(at).is_some() {
            if let Some(class) = hir.class_of(hir.parent(at)).some() {
                let class = self.class_sym(file, class);
                let constructor = self.type_of_symbol(class);
                if self.has_property(constructor, name) {
                    self.error(file, location, 2662, &[Arg::Atom(name), Arg::Sym(class)]);
                    return true;
                }
                if at == container && !hir.is_static(at) {
                    let instance = self.declared_type(class);
                    if self.has_property(instance, name) {
                        self.error(file, location, 2663, &[Arg::Atom(name)]);
                        return true;
                    }
                }
            }
            at = hir.parent(at);
        }
        false
    }

    /// `getCannotFindNameDiagnosticForName`
    pub(super) fn get_cannot_find_name_diagnostic_for_name(
        &self,
        file: FileId,
        node: Node,
        name: Atom,
    ) -> u32 {
        let (hir, text) = (self.hir(file), self.files().atoms.bytes(name));
        if let Some(&(with_all_types, otherwise)) = CANNOT_FIND_NAME_DIAGNOSTICS.get(text) {
            // `UsesWildcardTypes`: there is nothing to add to `types` then.
            let types = self.p.files.options.types.as_ref();
            return if types.is_some_and(|t| t.iter().any(|t| t == b"*")) {
                with_all_types
            } else {
                otherwise
            };
        }
        match hir.kind(hir.parent(node)) {
            Kind::CallExpression if text == b"await" => 2311,
            Kind::ShorthandPropertyAssignment => 18004,
            _ => 2304,
        }
    }

    /// `onFailedToResolveSymbol`. `scope`: where `location` is written. `at`: where the error goes, if not at `location`: at a tag, for
    /// what makes it.
    pub(super) fn on_failed_to_resolve_symbol(
        &mut self,
        file: FileId,
        location: Node,
        at: Option<super::related::Place>,
        scope: ScopeId,
        name: Atom,
        meaning: SymFlags,
        name_not_found_message: u32,
    ) {
        let (files, hir) = (self.files(), self.hir(file));
        if self.check_and_report_error_for_missing_prefix(file, location, name) {
            return;
        }
        let at = at.unwrap_or_else(|| {
            let (start, end) = self.get_error_range_for_node(file, location);
            (file, start, end)
        });
        let (text, said) = (files.atoms.bytes(name), Arg::Atom(name));
        if let NodeData::Expr(e) = hir.data(location)
            && self.check_and_report_error_for_extending_interface(file, e)
        {
            return;
        }
        let resolve_name = |meaning: SymFlags| files.resolve_name(file, scope, name, meaning);
        // `checkAndReportErrorForUsingTypeAsNamespace`
        if meaning == SymFlags::NAMESPACE
            && let Some(symbol) = resolve_name(SymFlags::TYPE.difference(SymFlags::NAMESPACE))
                .and_then(|s| files.resolve_alias_as(s, SymFlags::TYPE))
            && files.flags(symbol).intersects(SymFlags::TYPE)
        {
            let parent = hir.parent(location);
            if let (Kind::QualifiedName, NodeData::Name(right)) =
                (hir.kind(parent), hir.data(parent.row()))
            {
                let (declared, right) = (self.declared_type(symbol), hir[right].text);
                if self.has_property(declared, right) {
                    self.error(file, parent, 2713, &[said, Arg::Atom(right)]);
                    return;
                }
            }
            self.error_at(at, 2702, &[said]);
            return;
        }
        let is_primitive = super::errors_x_enums_names::is_primitive_type_name(text);
        // `checkAndReportErrorForExportingPrimitiveType`
        if is_primitive && hir.kind(hir.parent(location)) == Kind::ExportSpecifier {
            self.error_at(at, 2661, &[said]);
            return;
        }
        // `checkAndReportErrorForUsingNamespaceAsTypeOrValue`
        let (namespace, code) = if meaning.intersects(SymFlags::VALUE.difference(SymFlags::TYPE)) {
            (SymFlags::NAMESPACE_MODULE, 2708)
        } else {
            (SymFlags::MODULE, 2709)
        };
        if (code == 2708 || meaning.intersects(SymFlags::TYPE.difference(SymFlags::VALUE)))
            && resolve_name(namespace).is_some_and(|s| self.resolved_flags(s).intersects(namespace))
        {
            self.error_at(at, code, &[said]);
            return;
        }
        // `checkAndReportErrorForUsingTypeAsValue`
        if meaning.intersects(SymFlags::VALUE) {
            if is_primitive {
                // `errorLocation.Parent.Parent`. A keyword after `implements` has nothing around it.
                let clause = match hir.data(location) {
                    NodeData::Type(_) => hir.parent(location),
                    _ => hir.parent(hir.parent(location)),
                };
                let code = if hir.kind(clause) != Kind::HeritageClause {
                    2693
                } else {
                    match (hir.kind(hir.parent(clause)), clause.part()) {
                        (Kind::InterfaceDeclaration, Some(Part::Extends)) => 2840,
                        (Kind::ClassDeclaration | Kind::ClassExpression, Some(Part::Extends)) => {
                            2863
                        }
                        (Kind::ClassDeclaration | Kind::ClassExpression, _) => 2864,
                        _ => return,
                    }
                };
                self.error_at(at, code, &[said]);
                return;
            }
            if let Some(symbol) = resolve_name(SymFlags::TYPE.difference(SymFlags::VALUE)) {
                let flags = self.resolved_flags(symbol);
                if flags.intersects(SymFlags::TYPE) && !flags.intersects(SymFlags::VALUE) {
                    // `isES2015OrLaterConstructorName`
                    if matches!(
                        text,
                        b"Promise" | b"Symbol" | b"Map" | b"WeakMap" | b"Set" | b"WeakSet"
                    ) {
                        self.error_at(at, 2585, &[said]);
                    } else if self.maybe_mapped_type(file, location, symbol) {
                        let parameter = if text == b"K" { "P" } else { "K" };
                        self.error_at(at, 2690, &[said, Arg::Text(parameter)]);
                    } else {
                        self.error_at(at, 2693, &[said]);
                    }
                    return;
                }
            }
        }
        // `checkAndReportErrorForUsingValueAsType`
        if meaning.intersects(SymFlags::TYPE.difference(SymFlags::NAMESPACE))
            && let Some(symbol) = resolve_name(SymFlags::VALUE.difference(SymFlags::TYPE))
        {
            let flags = self.get_symbol_flags(symbol);
            if flags != SymFlags::all() && !flags.intersects(SymFlags::NAMESPACE) {
                self.error_at(at, 2749, &[said]);
                return;
            }
        }
        // `DeclarationNameToString`: with the escapes it is written with.
        let written = hir
            .text
            .get(at.1 as usize..at.2 as usize)
            .filter(|written| {
                written.contains(&b'\\')
                    && hir.kind(location) == Kind::Identifier
                    && hir.text(location) == name
            });
        let declaration_name = written.map_or(said, Arg::Bytes);
        // `getSuggestedLibForNonExistentName`
        if let Some(&lib) = SUGGESTED_LIBS.get(text) {
            let args = [declaration_name, Arg::Bytes(lib)];
            self.error_at(at, name_not_found_message, &args);
            return;
        }
        // `getSuggestedSymbolForNonexistentSymbol`
        let Some((meant, leads_to_export)) =
            similar_in_scope_and_where(self, file, scope, name, meaning)
        else {
            self.error_at(at, name_not_found_message, &[declaration_name]);
            return;
        };
        let (suggestion, declared) = match meant {
            // `suggestion.ValueDeclaration`, which what only leads to an export has none of.
            Meant::Symbol(sym) if leads_to_export => (Arg::Sym(sym), None),
            Meant::Symbol(sym) => (Arg::Sym(sym), self.place_where_value_is_declared(sym)),
            Meant::Word(word) => (Arg::Text(word), None),
        };
        let code = if meaning == SymFlags::NAMESPACE {
            2833
        } else {
            2552
        };
        let mut diagnostic = self.new_diagnostic(at, code, &[declaration_name, suggestion]);
        if let Some(declared) = declared {
            diagnostic.add_related_info(self.new_diagnostic(declared, 2728, &[suggestion]));
        }
        self.add_diagnostic(diagnostic);
    }

    /// `getTypeFromImportTypeNode`: 2694, each name after `import("m")` has to be there.
    pub(super) fn check_import_type_names(&mut self, file: FileId, node: TypeNodeId) {
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
        // In `typeof import("m").a.b`: the type the names so far come to, once they are past what modules and namespaces export.
        let mut ty: Option<TypeId> = None;
        // `sym` is what an `export { a }` stands for: who says so, and under which name. That alias is `currentNamespace`.
        let mut exported_by: Option<(Sym, Atom)> = None;
        for (i, current) in name.iter().enumerate() {
            let n = hir[current].text;
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
                let Some((namespace, exported_by)) = namespace else {
                    self.error(file, current, 2694, &[]);
                    return;
                };
                let mut qualified =
                    fully_qualified_name(self, exported_by.map_or(namespace, |by| by.0))
                        .into_bytes();
                if let Some((_, name)) = exported_by {
                    qualified.push(b'.');
                    qualified.extend_from_slice(self.files().atoms.bytes(name));
                }
                self.error(file, current, 2694, &[Arg::Bytes(&qualified), Arg::Atom(n)]);
                return;
            }
        }
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

    /// `getSymbolFlags`. Of an alias that leads nowhere, nothing.
    fn resolved_flags(&self, sym: Sym) -> SymFlags {
        let flags = self.files().symbol_flags(sym);
        if flags == SymFlags::all() {
            SymFlags::empty()
        } else {
            flags
        }
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
}

/// Whether an entry of `early_errors` is a parser or scanner diagnostic (`SourceFile.Diagnostics()`).
fn is_syntactic_early_error(hir: &hir::File, start: u32, code: u32) -> bool {
    // `parse_for_sema` sets the flag by who logged each error. Without it, a code the parser shares with the checker (1005 18016 ..) is
    // the checker's.
    if !hir.has_parse_diagnostics {
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

/// Whether an `export as namespace` statement that has modifiers starts at `start`.
fn is_before_namespace_export(hir: &hir::File, start: u32) -> bool {
    hir.stmts.iter().any(|s| {
        matches!(s.kind, StmtKind::ExportAsNamespace(_))
            && s.start == start
            && !s.modifiers.is_empty()
    })
}

bun_core::comptime_string_map! {
    /// `getFeatureMap`: the names that come with a version of the standard library, and the library of the first entry of each.
    static SUGGESTED_LIBS: &'static [u8] = {
        b"Array" => b"es2015",
        b"Iterator" => b"es2015",
        b"AsyncIterator" => b"es2015",
        b"ArrayBuffer" => b"es2024",
        b"Atomics" => b"es2017",
        b"SharedArrayBuffer" => b"es2017",
        b"AsyncIterable" => b"es2018",
        b"AsyncIterableIterator" => b"es2018",
        b"AsyncGenerator" => b"es2018",
        b"AsyncGeneratorFunction" => b"es2018",
        b"RegExp" => b"es2015",
        b"RegExpConstructor" => b"es2025",
        b"Reflect" => b"es2015",
        b"ArrayConstructor" => b"es2015",
        b"ObjectConstructor" => b"es2015",
        b"NumberConstructor" => b"es2015",
        b"Math" => b"es2015",
        b"Map" => b"es2015",
        b"MapConstructor" => b"es2024",
        b"Set" => b"es2015",
        b"PromiseConstructor" => b"es2015",
        b"Symbol" => b"es2015",
        b"WeakMap" => b"es2015",
        b"WeakSet" => b"es2015",
        b"String" => b"es2015",
        b"StringConstructor" => b"es2015",
        b"DateTimeFormat" => b"es2017",
        b"Promise" => b"es2015",
        b"RegExpMatchArray" => b"es2018",
        b"RegExpExecArray" => b"es2018",
        b"Intl" => b"es2018",
        b"NumberFormat" => b"es2018",
        b"SymbolConstructor" => b"es2020",
        b"DataView" => b"es2020",
        b"BigInt" => b"es2020",
        b"RelativeTimeFormat" => b"es2020",
        b"Int8Array" => b"es2022",
        b"Uint8Array" => b"es2022",
        b"Uint8ClampedArray" => b"es2022",
        b"Int16Array" => b"es2022",
        b"Uint16Array" => b"es2022",
        b"Int32Array" => b"es2022",
        b"Uint32Array" => b"es2022",
        b"Float16Array" => b"es2025",
        b"Float32Array" => b"es2022",
        b"Float64Array" => b"es2022",
        b"BigInt64Array" => b"es2020",
        b"BigUint64Array" => b"es2020",
        b"Error" => b"es2022",
        b"ErrorConstructor" => b"esnext",
        b"Uint8ArrayConstructor" => b"esnext",
        b"DisposableStack" => b"esnext",
        b"AsyncDisposableStack" => b"esnext",
        b"Date" => b"esnext",
    };
}

bun_core::comptime_string_map! {
    /// `getCannotFindNameDiagnosticForName`: with `UsesWildcardTypes`, and without.
    static CANNOT_FIND_NAME_DIAGNOSTICS: (u32, u32) = {
        b"document" => (2584, 2584),
        b"console" => (2584, 2584),
        b"$" => (2581, 2592),
        b"beforeEach" => (2582, 2593),
        b"describe" => (2582, 2593),
        b"suite" => (2582, 2593),
        b"it" => (2582, 2593),
        b"test" => (2582, 2593),
        b"process" => (2580, 2591),
        b"require" => (2580, 2591),
        b"Buffer" => (2580, 2591),
        b"module" => (2580, 2591),
        b"NodeJS" => (2580, 2591),
        b"Bun" => (2867, 2868),
        b"Map" => (2583, 2583),
        b"Set" => (2583, 2583),
        b"Promise" => (2583, 2583),
        b"WeakMap" => (2583, 2583),
        b"WeakSet" => (2583, 2583),
        b"Iterator" => (2583, 2583),
        b"AsyncIterator" => (2583, 2583),
        b"SharedArrayBuffer" => (2583, 2583),
        b"Atomics" => (2583, 2583),
        b"AsyncIterable" => (2583, 2583),
        b"AsyncIterableIterator" => (2583, 2583),
        b"AsyncGenerator" => (2583, 2583),
        b"AsyncGeneratorFunction" => (2583, 2583),
        b"BigInt" => (2583, 2583),
        b"Reflect" => (2583, 2583),
        b"BigInt64Array" => (2583, 2583),
        b"BigUint64Array" => (2583, 2583),
    };
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
                                && files.globals.contains_key(wrapper)
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

/// `node.End()` of the `ExpressionWithTypeArguments` that `class` extends. 0: it cannot be told.
pub(super) fn end_of_extends(c: &Checker<'_>, file: FileId, class: &Class) -> u32 {
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

/// What the message of an error of the parser names. `settle_place` has where it ends.
fn explain_early_error(c: &mut Checker<'_>, file: FileId, start: u32, code: u32) {
    let said = c.hir(file).error_arguments.iter();
    let mut said: Vec<_> = said.filter(|e| (e.0, e.1) == (start, code)).collect();
    // `parseErrorAtPosition` keeps a second error at a place if another lies between the two.
    said.sort_unstable();
    said.dedup();
    for (_, _, args) in said {
        c.note_printed(start, 0, code, args.clone());
    }
}

// ───────────────────────────── operators ─────────────────────────────

impl Checker<'_> {
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

    /// The types of the two operands of an operator whose result does not go by them, looked at left to right.
    pub(super) fn check_operands(
        &mut self,
        file: FileId,
        left: ExprId,
        right: ExprId,
    ) -> (TypeId, TypeId) {
        let (l, r) = (
            self.type_of_expr(file, left),
            self.type_of_expr(file, right),
        );
        (l, r)
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
            self.error_at(at, 2638, &[Arg::Type(right_type)]);
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
        let diagnostic = self.error_at(at, code, args);
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
        let diagnostic = self.error_at(self.place_of_expr(file, e), 2845, &[Arg::Text(always)]);
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
        self.error_at(at, 2447, &[Arg::Text(&operator), Arg::Text(suggested)]);
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
        let may_be_symbol = |c: &mut Self, t| {
            c.maybe_type_of_kind_considering_base_constraint(t, Self::is_symbol_like)
        };
        let offending = if may_be_symbol(self, l) {
            left
        } else if may_be_symbol(self, r) {
            right
        } else {
            return true;
        };
        let at = self.place_of_written_expr(file, offending);
        let is_assignment = matches!(self.hir(file)[e].kind, ExprKind::Assign { .. });
        self.error_at(at, 2469, &[Arg::Text(&operator_text(op, is_assignment))]);
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
        let maybe_missing_await =
            awaited.is_some_and(|awaited| self.is_assignable(awaited, numeric));
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
        self.error_at(at, code, &[]);
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
            if self
                .type_of_property_of_type(object, name)
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

    /// `checkNonNullType`: what is left of the type of `node` once `null` and `undefined` are ruled out, which they have to be here.
    pub(super) fn check_non_null_type(&mut self, file: FileId, node: ExprId, ty: TypeId) -> TypeId {
        self.check_non_null_type_with_reporter(ty, |c, error| {
            let (at, code, name) = c.object_possibly_null_error(file, node, error);
            let args: Vec<Arg> = name.iter().map(|name| Arg::Text(name)).collect();
            c.error_at(at, code, &args);
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
        start_of(self.hir(file), e)
    }

    /// Where `e` starts, not counting parentheses around the whole of it.
    pub(super) fn start_inside_parentheses(&self, file: FileId, e: ExprId) -> u32 {
        start_inside_parentheses(self.hir(file), e)
    }

    /// `GetErrorRangeForNode`, of a declaration.
    pub(super) fn error_range_of_declaration(
        &self,
        file: FileId,
        decl: Decl,
    ) -> Option<(u32, u32)> {
        let hir = self.hir(file);
        // The text of the default library and of JSON is not kept: there is nothing to tell an end by.
        if hir.text.is_empty() {
            let start = self.declaration_name_start(file, decl)?;
            return Some((start, start));
        }
        let node = hir.node(decl);
        (node.is_some()).then(|| self.get_error_range_for_node(file, node))
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
        let hir = self.hir(file);
        match hir.data(hir.node(decl)) {
            NodeData::Stmt(statement) => Some(statement),
            _ => None,
        }
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

impl<'p> Checker<'p> {
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

    /// Whatever is got at through `import * as` can only be read: whether `obj` is the name such an import declares.
    fn is_namespace_import_name(&self, file: FileId, obj: ExprId) -> bool {
        matches!(self.hir(file)[obj].kind, ExprKind::Ident(n)
        if self.symbol_of_identifier(file, obj, n).is_some_and(|s| {
            self.files().flags(s).contains(SymFlags::ALIAS) && self.files().symbol(s).decls.iter().any(|d| matches!(d, Decl::ImportNamespace(_)))
        }))
    }

    /// `isAssignmentToReadonlyEntity`: the property `name` of `obj`, which is what `e` is, if `e` is written to and the property can only be
    /// read.
    pub(super) fn readonly_entity_assigned_to(
        &mut self,
        file: FileId,
        e: ExprId,
        obj: ExprId,
        name: Atom,
    ) -> Option<&'p Prop> {
        self.write_kind(file, e)?;
        let ty = self.type_of_expr(file, obj);
        if self.is_any(ty) {
            return None;
        }
        let ty = self.non_nullable(ty);
        // `getIndexedAccessTypeOrUndefined`: in `a[k]` no property is looked for where `a` has only a string index signature.
        if matches!(self.hir(file)[e].kind, ExprKind::Index { .. })
            && !self.files().atoms.is_symbol_name(name)
        {
            let reduced = self.reduced(ty);
            if self.is_string_index_signature_only(reduced) {
                return None;
            }
        }
        // `getReducedApparentType`
        let apparent = self.reduced_apparent_type(ty);
        // `getPropertyOfType`: what every function and every object has counts.
        let (prop, _) = self.get_property_of_type(apparent, name)?;
        if self.is_union(apparent) {
            return prop.flags.contains(PropFlags::READONLY).then_some(prop);
        }
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
                return None;
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
            return (is_refused || self.is_namespace_import_name(file, obj)).then_some(prop);
        }
        let is_refused = if prop.flags.contains(PropFlags::READONLY) {
            !self.is_written_in_own_constructor(file, e, obj, prop)
        } else if self.has_readonly_assignment_declaration(prop) {
            true
        } else {
            self.is_namespace_import_name(file, obj)
        };
        is_refused.then_some(prop)
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
            Some(&PropSource::Symbol(sym)) => {
                let declarations = self.files().decls_of(sym);
                declarations.iter().any(|&(other, decl)| {
                    other == file
                        && match decl {
                            Decl::Member(m) => {
                                bound.member_owner[m.idx()] == bound.member_owner[constructor.idx()]
                            }
                            Decl::ParameterProperty(p) => bound.param_fn[p.idx()] == f,
                            // `isLocalThisPropertyAssignment`
                            Decl::ThisProperty(_) => {
                                matches!(bound.member_owner[constructor.idx()], MemberOwner::Class(class)
                                    if self.files().parent_of_symbol(sym) == Some(self.class_sym(file, class)))
                            }
                            _ => false,
                        }
                })
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
