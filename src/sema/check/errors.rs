//! The diagnostics of a file. The resolver answers queries and never reports. This pass visits
//! every node of the file once, queries the resolver, and reports the inconsistencies.
//!
//! The codes are the TypeScript compiler's. An error that depends on something the resolver could
//! not resolve is not reported: a false negative is preferred to a false positive.

use super::enclosing_declaration::Enclosing;
use super::errors_aliases::Directives;
use super::errors_names_and_exports::fully_qualified_name;
use super::errors_operators::has_empty_object_intersection;
use super::explain::{Explained, NOWHERE};
use super::sink::{MAX_SERIALIZATION_LEVEL, NO_DIRECTIVE, held};
use super::*;
use crate::bind::{ClassOwner, Decl, FnOwner, MemberOwner, Parent, PatParent, ScopeId, ScopeKind};
use crate::program::SymbolTable;
use bun_core::strings;

/// The diagnostics `check_file` passes to `Program::finish_file`, finalized. Diagnostics reported
/// inside a query are in the buffer of their file.
pub struct Checked {
    /// `GetSyntacticDiagnostics`
    syntactic: Vec<Reported>,
    /// The part of `getBindAndCheckDiagnostics` that was reported with no query in flight, and
    /// `JSDocDiagnostics`. `None`: the file is not checked.
    semantic: Option<Vec<Reported>>,
    /// `GetDeclarationDiagnostics`
    declaration: Vec<Reported>,
    /// `GetIncludeProcessorDiagnostics`, without those that a directive suppresses.
    include: Vec<Reported>,
    /// `Checker::expected_errors`
    expected_errors: Vec<Reported>,
    never_checked: Vec<(u32, u32)>,
    /// The private members that `checkUnusedClassMembers` has reported, and where. See
    /// `Program::properties_referenced_before`.
    unused_private_members: Vec<(Sym, u32)>,
    /// `Options::writes_declaration_files`: the emitted text of the file's declaration file, if it
    /// has one.
    pub declaration_file: Option<Vec<u8>>,
}

impl Checked {
    /// Moves the declaration diagnostics (`GetDeclarationDiagnostics`) into a `Checked` of their own, so that `finish_file` converts them
    /// separately. `None` if there are none.
    pub fn take_declaration_diagnostics(&mut self) -> Option<Checked> {
        (!self.declaration.is_empty()).then(|| Checked {
            syntactic: Vec::new(),
            semantic: None,
            declaration: std::mem::take(&mut self.declaration),
            include: Vec::new(),
            expected_errors: Vec::new(),
            never_checked: Vec::new(),
            unused_private_members: Vec::new(),
            declaration_file: None,
        })
    }
}

impl Program<'_> {
    /// The errors of `file`, after the last barrier. It runs no query and reads no HIR.
    pub fn finish_file(&self, file: FileId, checked: Checked) -> Vec<Explained> {
        let mut out = Vec::new();
        if let Some(semantic) = checked.semantic {
            out = semantic;
            // Diagnostics for nodes `checkSourceFile` never reaches are not reported, whichever
            // task evaluated them.
            let is_checked = |d: &Reported| {
                let mut never_checked = checked.never_checked.iter();
                d.by_emit
                    || d.by_another_node
                    || !never_checked.any(|&(from, to)| (from..to).contains(&d.start))
            };
            out.extend(self.take_buffer(file).into_iter().filter(is_checked));
            // `requestedExternalEmitHelpers`: first come, whichever file was being checked.
            if self.files.options.import_helpers {
                let earlier = self.emit_helper_errors_of_earlier_files.lock();
                out.retain(|d| {
                    let same = earlier
                        .iter()
                        .filter(|it| (it.file, it.code) == (file, d.code) && it.args == d.args);
                    let first = same.min_by_key(|it| it.rank);
                    first.is_none_or(|first| first.start == d.start)
                });
            }
            if !checked.unused_private_members.is_empty() {
                let referenced = self.properties_referenced_before.lock();
                let mut unused = checked.unused_private_members;
                unused.retain(|it| referenced.contains(&it.0));
                let is_referenced = |d: &Reported| {
                    matches!(d.code, 6133 | 6138) && unused.iter().any(|it| it.1 == d.start)
                };
                out.retain(|d| !is_referenced(d));
            }
            // `getDiagnosticsWithPrecedingDirectives`
            let used = out.iter().map(|d| d.directive);
            let mut used: Vec<u32> = used.filter(|&start| start != NO_DIRECTIVE).collect();
            used.sort_unstable();
            // `FilterNoEmitSemanticDiagnostics` comes after the directives.
            let no_emit = self.files.options.no_emit;
            out.retain(|d| d.directive == NO_DIRECTIVE && !(no_emit && d.skipped_on_no_emit));
            let expected = checked.expected_errors.into_iter();
            out.extend(expected.filter(|unused| used.binary_search(&unused.start).is_err()));
            out.extend(checked.include);
        }
        // `GetSyntacticDiagnostics`, `GetDeclarationDiagnostics`: no comment directive suppresses
        // these.
        out.extend(checked.declaration);
        out.extend(checked.syntactic);
        // A diagnostic without an end and arguments duplicates a complete one with the same start and code. It is dropped unless it
        // has related info, which `compactAndMergeRelatedInfos` merges into the complete one.
        let complete: Vec<(u32, u32)> = out
            .iter()
            .filter(|d| !d.was_bare)
            .map(|d| (d.start, d.code))
            .collect();
        let is_duplicate = |d: &Reported| {
            d.was_bare && d.related_information.is_empty() && complete.contains(&(d.start, d.code))
        };
        out.retain(|d| !is_duplicate(d));
        self.sort_and_deduplicate_diagnostics(&mut out);
        out.into_iter().map(Explained::new).collect()
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
    /// In a type literal, whose parent is not stored. It compares equal to nothing: no variable is
    /// declared there.
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

impl Checker<'_, '_> {
    /// Drops the memos of this checker that are keyed by a node of `file`, which `is_leaf` and has
    /// been checked: no other file refers to it, so nothing evaluates one of its nodes again. A
    /// task of the last step checks dozens of such files. The capacity stays for the next one.
    fn forget_nodes_of_leaf(&mut self, file: FileId) {
        self.literals_checked_under.retain(|key, _| key.0 != file);
        self.discriminated.retain(|key, _| key.0 != file);
        self.non_existent_properties.retain(|key, _| key.0 != file);
        self.rechecked_exprs.retain(|key, _| key.0 != file);
        self.rechecked_members.retain(|key, _| key.0 != file);
        self.late_bound_members.retain(|key, _| key.0.file != file);
        self.early_bound_for_good.retain(|key| key.0.file != file);
        self.resolved_signatures.retain(|key| key.0 != file);
        self.context_checked_here.retain(|key| key.0 != file);
        self.prepared.retain(|key| key.0 != file);
        self.circular_before_parameter_symbol
            .retain(|key| key.0 != file);
    }

    /// Runs every check that queries `file`. Diagnostics it causes in other files, or other files
    /// cause in this one, are in the sink.
    pub fn check_file(&mut self, file: FileId) -> Checked {
        if let Some(previous) = self.task.file
            && previous != file
            && self.files().module(previous).is_leaf
        {
            self.forget_nodes_of_leaf(previous);
        }
        self.task
            .begin_file(file, !self.files().module(file).is_leaf);
        self.provisional.clear();
        self.refused_expressions.clear();
        self.work_trap = WORK_TRAP_DISARMED;
        self.limits = 0;
        self.outermost_comparison = None;
        self.checked_type_references.0 = None;
        self.instantiation_limit_hits = 0;
        self.instantiations_up_to_a_limit.clear();
        self.relations_cut_short.clear();
        self.variances_cut_short.clear();
        self.generic_mapped_types_cut_short.clear();
        self.deferred_diagnostics.clear();
        self.node_check_flags.clear();
        self.never_checked.borrow_mut().clear();
        self.unknown_symbols.clear();
        self.alias_targets_reported.clear();
        self.signatures_resolved_discarding.clear();
        self.expressions_cached_discarding.clear();
        self.emit_helpers_checked_elsewhere.clear();
        self.reported.clear();
        self.release_provisional_shapes();
        self.is_type_checked = false;
        let hir = self.hir(file);
        if hir.ran_out_of_stack {
            self.ran_out_of_stack.set(true);
        }
        // `GetSyntacticDiagnostics` and `getBindAndCheckDiagnosticsWithChecker` are separate: only the second depends on whether the
        // file is checked.
        self.report_hir_diagnostics(file, &[DiagnosticKind::Parse, DiagnosticKind::Js]);
        self.get_additional_js_syntactic_diagnostics(file);
        // `getBindAndCheckDiagnostics` reports nothing for a JSON file.
        let is_json = hir.kind == FileKind::Json;
        if self.expected != Requested::All || is_json || !self.reports_semantic_errors(file) {
            let syntactic = std::mem::take(&mut self.reported);
            let mut declaration = Vec::new();
            if self.expected != Requested::Syntactic {
                self.emit_resolver_links = Default::default();
                declaration = self.get_declaration_diagnostics(file);
            }
            self.is_type_checked = true;
            return self.checked(syntactic, declaration);
        }
        let syntactic = std::mem::take(&mut self.reported);
        // `hasParseDiagnostics`: parse errors suppress `grammarErrorOnNode` and similar, and the binder's `checkContextualIdentifier`
        // and `checkPrivateIdentifier`. They do not suppress errors reported through a plain `c.error`.
        let has_parse_diagnostics = hir.has_parse_diagnostics;
        if !has_parse_diagnostics {
            self.report_hir_diagnostics(file, &[DiagnosticKind::Grammar]);
        }
        self.report_hir_diagnostics(file, &[DiagnosticKind::Checker]);
        // `checkUnmatchedJSDocParameters`
        for &index in self.bound(file).jsdoc_param_errors.iter() {
            let diagnostic = &hir.jsdoc_param_errors[index as usize].1;
            self.add_diagnostic(Reported::from_hir(file, diagnostic));
        }
        self.emit_resolver_links = Default::default();
        if self.emits_first() {
            let from = self.reported.len();
            self.is_emitting = true;
            self.mark_linked_references_recursively(file);
            self.mark_jsx_aliases_referenced(file);
            self.mark_property_aliases_referenced(file);
            self.inline_const_enums(file);
            self.is_emitting = false;
            for d in self.reported.iter_mut().skip(from) {
                d.by_emit = true;
            }
        }
        self.check_required_global_types(Some(file));
        self.save_deferred_diagnostics = true;
        let logged = self.task.diagnostics.len();
        self.check_source_file(file);
        self.check_declare_modifiers(file);
        self.check_modules(file);
        self.report_unresolved_identifiers();
        self.check_property_accesses(file);
        self.check_calls(file);
        self.check_unused(file);
        self.check_grammar(file);
        self.check_duplicates(file);
        self.check_jsx(file);
        self.check_use_before_declaration(file);
        self.resolve_names_for_arguments(file);
        self.check_iteration(file);
        self.check_names_and_exports(file);
        self.check_declarations(file);
        self.check_misc(file);
        self.check_circularities(file);
        self.check_assignments(file);
        self.check_x_aliases(file);
        // It removes the diagnostics reported for specifiers that are never resolved.
        self.check_x_modules(file);
        self.produce_deferred_diagnostics(file);
        self.check_x_typenodes(file);
        // They replace messages that were already reported: for assignments, for unresolved names.
        self.check_x_operators(file);
        self.check_x_enums_names(file);
        self.report_unresolved_identifiers();
        self.check_external_emit_helpers(file);
        // It removes the diagnostics reported for misplaced decorators.
        self.report_decorators(file);
        self.check_strict_mode_statements(file);
        // `checkWithStatement`, `checkReturnStatement`, `checkExportAssignment`: diagnostics in the
        // nodes they never check are removed, whichever check reported them.
        self.remove_diagnostics_in_unchecked_ranges(file);
        // `MarkLinkedReferencesRecursively` visits those nodes too.
        if self.p.files.options.emits_first && self.elides_imports(file) {
            self.mark_identifier_aliases_referenced(file, true);
        }
        self.produce_type_not_iterable_errors(logged);
        self.resolve_marked_assignment_targets(file);
        self.report_unresolved_identifiers();
        // `GetDeclarationDiagnostics`: no comment directive suppresses these, and plain JavaScript
        // gets them too.
        // A diagnostic located in another file goes to the buffer of that file at the barrier.
        let reported = std::mem::take(&mut self.reported).into_iter();
        let (semantic, elsewhere): (Vec<_>, Vec<_>) = reported.partition(|d| d.file == file);
        self.reported = elsewhere;
        self.log_reported_from(0);
        let emits_later = !self.emits_first();
        let was_emitting = self.set_symbol_ids_emitting(emits_later);
        self.is_type_checked = emits_later;
        let declaration = self.get_declaration_diagnostics(file);
        self.set_symbol_ids_emitting(was_emitting);
        self.is_type_checked = true;
        let mut directives = Directives::default();
        let semantic = semantic.into_iter();
        let mut semantic: Vec<Reported> =
            (semantic.filter_map(|d| self.settled(d, &mut directives))).collect();
        let expected_errors = self.expected_errors(file);
        // The diagnostics of the file have been collected: diagnostics from queries first evaluated
        // while processing the directives are dropped.
        self.reported.clear();
        let mut checked = self.checked(syntactic, declaration);
        checked.expected_errors = expected_errors;
        if hir.check_directive != Some(false) {
            // `JSDocDiagnostics`: after the filters of `settled`, and a directive suppresses them.
            if !self.is_plain_js(file) {
                self.report_hir_diagnostics(file, &[DiagnosticKind::JsDoc]);
                for mut d in std::mem::take(&mut self.reported) {
                    self.settle_place(&mut d);
                    d.directive = directives.preceding(file, hir, d.start);
                    semantic.push(d);
                }
            }
            // `GetIncludeProcessorDiagnostics`: skipped under `SkipTypeChecking`. Its directive filter is a separate pass that does not
            // mark directives as used.
            self.include_processor_diagnostics(file);
            checked.include = std::mem::take(&mut self.reported);
            (checked.include).retain(|d| directives.preceding(file, hir, d.start) == NO_DIRECTIVE);
            for d in &mut checked.include {
                self.settle_place(d);
            }
        }
        checked.semantic = Some(semantic);
        checked
    }

    /// `GetDeclarationDiagnostics`. It also runs for files that are not type-checked. `self.reported` must be empty on entry.
    fn get_declaration_diagnostics(&mut self, file: FileId) -> Vec<Reported> {
        let options = &self.files().options;
        if options.emits_declarations && options.writes_declaration_files {
            self.declaration_file = self.emit_declaration_file(file);
        } else if options.emits_declarations {
            self.check_declaration_emit(file);
        }
        std::mem::take(&mut self.reported)
    }

    fn checked(&mut self, mut syntactic: Vec<Reported>, mut declaration: Vec<Reported>) -> Checked {
        for d in syntactic.iter_mut().chain(&mut declaration) {
            self.settle_place(d);
        }
        Checked {
            syntactic,
            semantic: None,
            declaration,
            include: Vec::new(),
            expected_errors: Vec::new(),
            never_checked: self.never_checked.take(),
            unused_private_members: std::mem::take(&mut self.unused_private_members),
            declaration_file: self.declaration_file.take(),
        }
    }

    /// `d`, a diagnostic of `getBindAndCheckDiagnostics`, with the fields that need the HIR of its
    /// file filled in: its end, and the comment directive that suppresses it. `None`: its file does
    /// not report it. Runs on the task's thread, before `d` leaves it.
    pub(super) fn settled(&self, mut d: Reported, directives: &mut Directives) -> Option<Reported> {
        if d.file == NOWHERE.0 {
            return Some(d);
        }
        let hir = self.hir(d.file);
        // `SkipTypeChecking`
        if hir.check_directive == Some(false) {
            return None;
        }
        // `bindNamespaceExportDeclaration` reports 1184 whether or not the file parses.
        if hir.has_parse_diagnostics
            && is_grammar_error(d.code)
            && !(d.code == 1184 && is_before_namespace_export(hir, d.start))
        {
            return None;
        }
        if !self.is_plain_js(d.file) {
            d.directive = directives.preceding(d.file, hir, d.start);
        } else if errors_js::PLAIN_JS_ERRORS.binary_search(&d.code).is_err() {
            return None;
        }
        self.settle_place(&mut d);
        d.start = super::spans::start_of_error_range(hir, d.start, d.end);
        Some(d)
    }

    /// Reports the HIR diagnostics of `file` whose kind is in `kinds`.
    fn report_hir_diagnostics(&mut self, file: FileId, kinds: &[DiagnosticKind]) {
        let diagnostics = self.hir(file).diagnostics.iter();
        let diagnostics = diagnostics.filter(|d| kinds.contains(&d.kind));
        self.reported
            .extend(diagnostics.map(|d| Reported::from_hir(file, d)));
    }

    // ───────────────────────────── modules ─────────────────────────────

    /// `CreateModuleNotFoundChain`: the hint for `spec`, which resolves into `package`, which has
    /// no type declarations.
    /// `alternate`: `AlternateResult`.
    fn module_not_found_hint(
        &self,
        spec: &[u8],
        package: &[u8],
        alternate: Option<&[u8]>,
    ) -> super::explain::Line {
        let mangled = crate::resolve::mangle_scoped(package);
        if let Some(types) = alternate {
            let package = if strings::contains(types, b"/node_modules/@types/") {
                cat!(b"@types/", mangled)
            } else {
                package.to_vec()
            };
            return super::explain::Line {
                code: 6278,
                args: held(vec![
                    crate::resolve::displayed_path(types).into_owned(),
                    package,
                ]),
                level: 1,
            };
        }
        // `typesPackageExists`, `packageBundlesTypes`
        let (types_package, atoms) = (cat!(b"@types/", mangled), self.atoms());
        let modules = self.files().modules.iter();
        let (mut has_types_package, mut has_declarations) = (false, false);
        for &(name, is_declaration_file) in modules.flat_map(|it| it.resolved_packages.iter()) {
            let name = atoms.bytes(name);
            has_types_package |= name == &types_package[..];
            has_declarations |= is_declaration_file && name == package;
        }
        let (code, args) = if has_types_package {
            (7040, vec![package.to_vec(), mangled])
        } else if has_declarations {
            (7058, vec![package.to_vec(), spec.to_vec()])
        } else {
            (7035, vec![spec.to_vec(), mangled])
        };
        super::explain::Line {
            code,
            args: held(args),
            level: 1,
        }
    }

    /// The callers of `resolveExternalModule` other than the import and export declarations. 2322
    /// 2880 for the options of `import()`.
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
            let ExprKind::ImportCall { args, .. } = hir[e].kind else {
                continue;
            };
            if self.bound(file).is_unchecked(e.idx()) || self.is_never_checked(hir[e].pos) {
                continue;
            }
            if let Some(options) = hir.ids(args).nth(1) {
                self.check_import_call_options(file, options);
            }
            let argument = hir.id_at(args, 0);
            // `resolveExternalModuleNameWorker`
            if is_string_literal_like(hir, argument) {
                let written = SpecifierUse {
                    spec: crate::bind::string_literal_text(hir, argument),
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
                self.resolve_required_module(file, argument, spec);
            }
        }
    }

    /// `resolveExternalModuleName` for `argument`, the argument of `require(spec)`: whether the
    /// module is found.
    fn resolve_required_module(&mut self, file: FileId, argument: ExprId, spec: Atom) -> bool {
        let written = SpecifierUse {
            spec,
            pos: self.hir(file)[argument].pos,
            kind: SpecifierKind::RequireCall,
            mode: self.require_resolution_mode(file, spec),
        };
        self.resolve_external_module(file, written, SpecifierSite::default())
    }

    /// The same for the module that the variable declaration or the binding element with the name
    /// `name` is initialized to (`getTargetOfImportEqualsDeclaration`, `getExternalModuleMember`).
    pub(super) fn resolve_module_required_by(&mut self, file: FileId, name: PatId) -> bool {
        let PatParent::Var(decl) = root_declaration(self.bound(file), name) else {
            return false;
        };
        let Some((argument, spec)) = self.external_module_require_argument(file, decl) else {
            return false;
        };
        // The loader only resolves the specifiers that the binder collected.
        self.bound(file).specifiers.contains(&spec)
            && self.resolve_required_module(file, argument, spec)
    }

    /// What `checkImportCallExpression` does with `options`, the second argument.
    fn check_import_call_options(&mut self, file: FileId, options: ExprId) {
        let hir = self.hir(file);
        let operand_type = self.type_of_expr(file, options);
        let options_type = match hir[options].kind {
            ExprKind::Spread(_) => self.type_of_spread_expression(file, options, operand_type),
            _ => operand_type,
        };
        // `getGlobalImportCallOptionsTypeChecked`
        let name = self.atoms().intern(b"ImportCallOptions");
        if let Some(sym) = self.get_global_type(name, 0, true) {
            let expected = self.declared_type(sym);
            let expected = self.optional(expected);
            let error_node = self.span_of_parenthesized_expr(file, options);
            self.check_type_assignable_to(options_type, expected, Some(error_node), None);
        }
        if let ExprKind::Object(props) = hir[options].kind
            && !is_parenthesized(hir, options)
            && let Some(prop) = props.iter().map(|p| hir[p]).find(|prop| {
                prop.kind == PropKind::Init
                    && matches!(prop.key, PropKey::Name(name) if self.atoms().bytes(name) == b"assert")
                    // `IsIdentifier(prop.Name())`: `"assert"` and `["assert"]` have the same key.
                    && !matches!(hir.text.get(prop.pos as usize), None | Some(b'"' | b'\'' | b'['))
            })
        {
            self.error_at((file, prop.pos, 0), 2880, &[]);
        }
    }

    /// The errors `getTargetOfAliasDeclaration` reports for the declaration `decl` in `file` of the
    /// alias `sym`, if its module resolves: `getTargetOfModuleDefault`, `getExternalModuleMember`.
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
            Decl::ImportSpec(s) => (hir[s].imported_pos, files.emit_syntax_of_import(file)),
            Decl::ExportSpec(s) => (hir[s].local_pos, files.emit_syntax_of_import(file)),
            Decl::Require(pat) => match bound.pat_parent[pat.idx()] {
                PatParent::Prop(_, p) => (hir[p].key_pos, ResolutionMode::Require),
                PatParent::Elem(..) => (hir[pat].pos, ResolutionMode::Require),
                _ => return,
            },
            _ => (0, files.emit_syntax_of_import(file)),
        };
        let target = files.module_value(module);
        // `TryGetModuleSpecifierFromDeclaration(node)`: nil for a binding element.
        let node = (file, (!matches!(decl, Decl::Require(_))).then_some(mode));
        // In a binding pattern too: `symbolFromModule == nil && nameText == InternalSymbolNameDefault`.
        if name == known::default {
            if self.module_has_default(usage, module) {
                return;
            }
            match decl {
                Decl::ImportDefault(i) => self.report_non_default_export(file, i, module),
                _ => self.error_no_module_member_symbol(module, target, node, name, start),
            }
        } else if !matches!(decl, Decl::Require(_))
            && files.is_only_importable_as_default(usage, module)
        {
            let at = self.place_of_token(file, start);
            self.error_at(at, 1544, &[Arg::Bytes(files.options.module.name())]);
        } else if files.alias_links(sym).immediate_target.is_none()
            && self.symbol_from_variable(sym).is_none()
        {
            self.error_no_module_member_symbol(module, target, node, name, start);
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
        let end = self.end_of_identifier_at(file, import.default, import.default_pos);
        self.error_at((file, import.default_pos, end), 1192, &[Arg::Sym(module)])
            .related_information
            .extend(related);
    }

    /// `errorNoModuleMemberSymbol`: `name`, at `start` in `from`, is imported from `module`, which
    /// has no such export. `target`: the value `module` exports with `export =`, or else `module`.
    /// `specifier_mode`: `GetModeForUsageLocation` of the module specifier of `node`.
    fn error_no_module_member_symbol(
        &mut self,
        module: Sym,
        target: Sym,
        (from, specifier_mode): (FileId, Option<ResolutionMode>),
        name: Atom,
        start: u32,
    ) {
        if self.files().options.no_check {
            return;
        }
        let (code, other) = self.why_no_module_member(from, module, target, name, start);
        self.enclosing_module_specifier_mode = specifier_mode;
        let containing_location = Some(Enclosing::at_scope(from, ScopeId(0)));
        let module_name = fully_qualified_name(self, module, containing_location);
        self.enclosing_module_specifier_mode = None;
        // `DeclarationNameToString`: a string literal name keeps its quotes.
        let written = match self.hir(from).text.get(start as usize) {
            Some(b'"' | b'\'') => word_at(self, from, start),
            _ => self.atom_text(name),
        };
        let (module_name, written) = (Arg::Bytes(&module_name), Arg::Bytes(&written));
        let mut related = Vec::new();
        match (code, other) {
            (2724, Some(suggestion)) => {
                if let Some(place) = self.span_of_value_declaration(suggestion) {
                    related.push(self.new_diagnostic(place, 2728, &[Arg::Sym(suggestion)]));
                }
            }
            // `reportNonExportedMember`
            (2459 | 2460, _) => {
                let local = self.files().local_of_module(module, name);
                let declarations = local.map(|local| self.files().decls_of(local));
                for (i, &(of, decl)) in declarations.iter().flat_map(|it| it.iter()).enumerate() {
                    if let Some(place) = self.error_place_of_declaration(of, decl) {
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
            2460 | 2724 => &[
                module_name,
                written,
                other.map_or(Arg::Bytes(b""), Arg::Sym),
            ],
            2595 | 2597 => &[written],
            2616 => &[written, written, module_name],
            _ => &[module_name, written],
        };
        let at = self.place_of_token(from, start);
        self.error_at(at, code, args).related_information = related;
    }

    /// `reportNonDefaultExport`: the first `export *` of `module` that targets a module with a
    /// default export, which is not re-exported.
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

    /// `getTargetOfModuleDefault`: whether `module` has a default export: its export
    /// `"module.exports"`, its own default or a synthetic one. `usage`: the syntax the specifier is
    /// emitted as (`getEmitSyntaxForModuleSpecifierExpression`), regardless of the resolution mode
    /// it specifies.
    fn module_has_default(&mut self, usage: ResolutionMode, module: Sym) -> bool {
        let files = self.files();
        if files.is_commonjs_import_of_esm_file(usage, module)
            && let Some(module_exports) = files.module_exports_name()
            && self.has_export_by_name(module, module_exports)
        {
            return true;
        }
        files.is_only_importable_as_default(usage, module)
            || self.can_have_synthetic_default(usage, module)
            || self.has_export_by_name(module, known::default)
    }

    /// `resolveExportByName(module, name, ..) != nil`: for a module with `export =`, a property of
    /// the exported value.
    fn has_export_by_name(&mut self, module: Sym, name: Atom) -> bool {
        let files = self.files();
        match files.export(module, known::export_equals) {
            Some(_) => self.resolve_export_by_name(module, name).is_some(),
            None => files.export(module, name).is_some(),
        }
    }

    /// `errorNoModuleMemberSymbol`, `reportNonExportedMember`,
    /// `reportInvalidImportEqualsExportMember`. The arguments are those of
    /// `error_no_module_member_symbol`. 2724 comes with the suggested name, 2460 with the name it
    /// is exported as.
    fn why_no_module_member(
        &mut self,
        from: FileId,
        module: Sym,
        target: Sym,
        name: Atom,
        start: u32,
    ) -> (u32, Option<Sym>) {
        let files = self.files();
        let text = self.atoms().bytes(name);
        // `getSuggestedSymbolForNonexistentModule`: for an identifier, not for a string literal,
        // and only among module members (`SymbolFlagsModuleMember`).
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
                files.flags(s).intersects(module_member)
                    && is_close(text, self.atoms().bytes(other))
            })
        {
            let candidates = exports
                .iter()
                .filter(|&&(_, s)| files.flags(s).intersects(module_member))
                .map(|&(other, s)| (self.atoms().bytes(other), SpellingSuggestion::Symbol(s)));
            return match get_spelling_suggestion_for_name(files, text, candidates) {
                Some(SpellingSuggestion::Symbol(suggestion)) => (2724, Some(suggestion)),
                _ => (2724, None),
            };
        }
        if files.export(module, known::default).is_some() {
            return (2614, None);
        }
        let Some(local) = files.local_of_module(module, name) else {
            return (2305, None);
        };
        // `getSymbolIfSameReference`
        let is_local = |c: &mut Self, exported: Sym| {
            c.merged_resolved_symbol(exported) == c.merged_resolved_symbol(local)
        };
        let Some(equals) = files.export(module, known::export_equals) else {
            let own = files.exports(module);
            let mut own = own.iter();
            return match own.find(|&&(_, exported)| is_local(self, exported)) {
                Some(&(_, exported)) => (2460, Some(exported)),
                None => (2459, None),
            };
        };
        let code = if !is_local(self, equals) {
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

    /// `getMergedSymbol(resolveSymbol(getMergedSymbol(symbol)))`, which `getSymbolIfSameReference`
    /// compares.
    pub(super) fn merged_resolved_symbol(&mut self, symbol: Sym) -> AliasTarget {
        let files = self.files();
        match self.resolve_symbol(files.canonical(symbol)) {
            AliasTarget::Symbol(target) => AliasTarget::Symbol(files.canonical(target)),
            target => target,
        }
    }

    /// `errorOnImplicitAnyModule` with `isError`: 7016 at `at` for `spec`, which is one of the
    /// `untyped_imports` of `file` in `mode`.
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
        let atoms = self.atoms();
        let text = atoms.bytes(spec);
        let error_info = package
            .filter(|_| !crate::resolve::is_relative(text))
            .map(|package| {
                let mut alternates = module.untyped_import_alternates.iter();
                let alternate = alternates.find(|a| (a.0, a.1) == (spec, mode));
                let alternate = alternate.map(|a| atoms.bytes(a.2));
                let hint = self.module_not_found_hint(text, atoms.bytes(package), alternate);
                Reported::new(at, hint.code, hint.args)
            });
        let args = [Arg::Atom(spec), Arg::Path(atoms.bytes(path))];
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
        self.bound(file).required_by(hir, hir[decl].pat)?;
        crate::bind::require_call_argument(hir, hir[decl].init)
    }

    // ───────────────────────────── uninitialized variables ─────────────────────────────

    /// `symbol.ValueDeclaration` of the symbol the identifier `e` resolves to, if that is a `var`,
    /// `let` or `const` of this file: the binding name, and the declaration that contains it.
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

    /// `checkIdentifier`: whether the variable the identifier `e` reads, whose type is `declared`,
    /// is assumed to be initialized at the start of its control flow container
    /// (`assumeInitialized`).
    pub(super) fn assumes_initialized(&self, file: FileId, e: ExprId, declared: TypeId) -> bool {
        // FOR SPEED: it is evaluated last, unless the answer depends on what has been asked before.
        let is_never_initialized = (self.has_order_dependent_assignment_marks(file))
            .then(|| self.is_never_initialized(file, e));
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
        // The variable of a `catch` clause is initialized with the thrown value.
        if decl.flags.intersects(Flags::AMBIENT | Flags::DEFINITE)
            || stmt.is_none()
            || !matches!(hir[stmt].kind, StmtKind::Var(_))
        {
            return true;
        }
        // `x!`. Not `(x)!`: only the immediate syntactic parent counts.
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
        // `isSameScopedBindingElement`. FOR SPEED: nodes in the pattern are numbered before the
        // initializer.
        if decl.pat != pat && e.0 < decl.init.0 {
            let binding_element = hir.find_ancestor_kind(hir.node(e), Kind::BindingElement);
            if binding_element.is_some() && hir.get_root_declaration(binding_element) == hir.node(d)
            {
                return true;
            }
        }
        // `isOuterVariable`, which uses the flow container before it is moved out of function
        // expressions.
        let declared_in = bound.stmt_parent[stmt.idx()];
        if self.get_control_flow_container(file, parent)
            == self.get_control_flow_container(file, declared_in)
        {
            return false;
        }
        // Its assignments by the time this code runs are unknown, unless it is never assigned.
        !is_never_initialized.unwrap_or_else(|| self.is_never_initialized(file, e))
    }

    /// `isNeverInitialized` of `checkIdentifier`, for the identifier `e`.
    fn is_never_initialized(&self, file: FileId, e: ExprId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let Some((pat, d)) = self.value_declaration_of_variable(file, e) else {
            return false;
        };
        let (decl, stmt) = (&hir[d], bound.var_stmt[d.idx()]);
        decl.pat == pat
            && stmt.is_some()
            && matches!(hir[stmt].kind, StmtKind::Var(_))
            && !self.declares_loop_variable(file, stmt)
            && decl.init.is_none()
            && !decl.flags.contains(Flags::DEFINITE)
            && self.is_mutable_local_variable_declaration(file, d)
            && !self.is_symbol_assigned_definitely(file, bound.expr_symbol[e.idx()])
    }

    /// `isMutableLocalVariableDeclaration`
    pub(super) fn is_mutable_local_variable_declaration(&self, file: FileId, d: VarDeclId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let stmt = bound.var_stmt[d.idx()];
        hir[d].kind == VarKind::Let
            && !hir[d].flags.contains(Flags::EXPORT)
            // `IsGlobalSourceFile`
            && !(stmt.is_some()
                && matches!(hir[stmt].kind, StmtKind::Var(_))
                && matches!(bound.stmt_parent[stmt.idx()], Parent::File)
                && !self.files().module(file).is_module())
    }

    /// 2564: a property that requires a value has no initializer and is not definitely assigned in
    /// the constructor.
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
                        | Flags::LITERAL_NAME,
                )
            {
                continue;
            }
            // The name of the symbol, and `getTypeOfSymbol` of the declaration: the declared type,
            // with `this` uninstantiated.
            let (name, ty) = match self.declared_member_name(file, member.key) {
                Some(name) => {
                    let sym = self.class_sym(file, c);
                    let instance = self.declared_type(sym);
                    let Some((prop, _)) = self.prop_ref(instance, name) else {
                        continue;
                    };
                    // The declarations of one symbol have one type: that of `m: string = ""; m?: number`
                    // is `string`. A declaration that `declareSymbolEx` refused has a symbol of its own.
                    let own = (self.bound(file).member_symbol[m.idx()].is_some())
                        .then(|| self.symbol_of_member(file, m));
                    let ty = match prop.source {
                        PropSource::Symbol(symbol) if Some(symbol) == own => {
                            Some(self.type_of_prop(prop, MapperId::IDENTITY))
                        }
                        _ => None,
                    };
                    (Some(name), ty)
                }
                // `[k]: T` is subject to the check whatever `k` is.
                None if matches!(member.key, PropKey::Computed(_)) => (None, None),
                None => continue,
            };
            let ty = match ty {
                Some(ty) => ty,
                // The type includes `undefined`, except that of an `accessor` field.
                None if member.flags.contains(Flags::OPTIONAL)
                    && !member.flags.contains(Flags::ACCESSOR) =>
                {
                    continue;
                }
                None => self.type_of_member_declaration(file, m),
            };
            if ty == TypeId::UNRESOLVED
                || ty == TypeId::UNKNOWN
                || self.is_any(ty)
                || self.contains_undefined(ty)
            {
                continue;
            }
            // `isPropertyInitializedInConstructor`: the reference is `this.name`, or `this[k]` for
            // the name `[k]`, whatever symbol that declares.
            let is_assigned = constructor.is_some_and(|func| {
                let key = match member.key {
                    PropKey::Computed(k) => self.access_key(file, k),
                    _ => name.map(super::flow::AccessKey::Name),
                };
                key.is_some_and(|key| self.is_assigned_in_constructor(file, func, key, ty))
            });
            if !is_assigned {
                // `DeclarationNameToString`
                let (start, end) = (member.name_pos, self.end_of_member_name(file, m));
                let name = Arg::Bytes(&hir.text[start as usize..end as usize]);
                self.error_at((file, start, end), 2564, &[name]);
            }
        }
    }

    /// `getControlFlowContainer` for a direct child of `parent`.
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
            match self.immediately_invoked_container(file, func) {
                Some(it) => parent = it,
                None => return Container::Fn(func),
            }
        }
    }

    /// `node.Parent` of the node `parent` represents, as far as `Parent` can express it: a pattern
    /// is skipped. `None`: for a member of a type literal and for a function type, whose parents
    /// are not stored.
    pub(super) fn parent_of_node(&self, file: FileId, parent: Parent) -> Parent {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let of_class = |c: ClassId| bound.class_owner[c.idx()].to_parent();
        let of_member = |m: MemberId| match bound.member_owner[m.idx()] {
            MemberOwner::Class(c) => of_class(c),
            MemberOwner::Interface(i) => Parent::Stmt(hir[i].stmt),
            _ => Parent::None,
        };
        let of_fn = |f: FnId| match bound.fns[f.idx()].owner {
            FnOwner::Expr(x) => Parent::Expr(x),
            FnOwner::Stmt(s) => Parent::Stmt(s),
            FnOwner::Member(m) => of_member(m),
            _ => Parent::None,
        };
        let of_pattern = |mut pat: PatId| loop {
            match bound.pat_parent[pat.idx()] {
                PatParent::Prop(outer, _) | PatParent::Elem(outer, _) => pat = outer,
                PatParent::Var(d) => return Parent::VarInit(d),
                PatParent::Param(p) => return Parent::ParamDefault(p),
                PatParent::None => return Parent::None,
            }
        };
        match parent {
            Parent::None | Parent::File => Parent::None,
            Parent::Expr(x) if x.is_none() => Parent::None,
            Parent::Expr(x) => bound.expr_parent[x.idx()],
            Parent::Stmt(s) if s.is_none() => Parent::None,
            Parent::Stmt(s) => bound.stmt_parent[s.idx()],
            Parent::VarInit(d) => Parent::Stmt(bound.var_stmt[d.idx()]),
            Parent::Prop(p) | Parent::PropKey(_, p) => Parent::Expr(bound.prop_owner[p.idx()]),
            Parent::Case(c) => Parent::Stmt(bound.case_stmt[c.idx()]),
            Parent::FnBody(f) => of_fn(f),
            Parent::ParamDefault(p) => of_fn(bound.param_fn[p.idx()]),
            Parent::MemberInit(m) => of_member(m),
            Parent::PatPropDefault(p) | Parent::PatKey(p) => of_pattern(hir[p].value),
            Parent::PatElemDefault(p) => of_pattern(hir[p].pat),
            // The name and the decorators of a member or a parameter are its children.
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
            Parent::ClassExtends(c) | Parent::Decorator(c, DecoratorOwner::Class(_)) => of_class(c),
            Parent::EnumInit(m) => Parent::Stmt(hir[bound.enum_member_owner[m.idx()]].stmt),
            Parent::Module(m) => Parent::Stmt(hir[m].stmt),
        }
    }

    /// `getControlFlowContainer`: a static block is not function-like, and an immediately invoked
    /// function expression (`GetImmediatelyInvokedFunctionExpression`), `async` or not, belongs to
    /// the enclosing container. Returns the class or the call, if `f` is one of these.
    fn immediately_invoked_container(&self, file: FileId, f: FnId) -> Option<Parent> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        match (hir[f].kind, bound.fns[f.idx()].owner) {
            (FnKind::StaticBlock, FnOwner::Member(m)) => match bound.member_owner[m.idx()] {
                MemberOwner::Class(c) => Some(bound.class_owner[c.idx()].to_parent()),
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

    // ───────────────────────────── unresolved names ─────────────────────────────

    /// `getResolvedSymbol`, where `resolveName` finds nothing for the identifier `e`. The error is
    /// created on the first call, so `addDiagnostic` discards it or not by the state of that call.
    /// In another file that depends on the order of the files: `check_file` of that file decides.
    pub(super) fn note_unresolved_identifier(&mut self, file: FileId, e: ExprId, name: Atom) {
        if self.task.file == Some(file) {
            let is_discarded = self.serialization_level >= MAX_SERIALIZATION_LEVEL;
            if *self.unknown_symbols.entry(e).or_insert(is_discarded) {
                return;
            }
        }
        self.unresolved_identifiers.push((file, e, name));
    }

    /// `addLazyDiagnostic`, which `onFailedToResolveSymbol` is wrapped in in checker.ts. Choosing the message queries the members of
    /// classes, which would close a cycle with a query in flight. So it is reported when no query is in flight.
    ///
    /// Only for the file being checked. No other task stores the entry of an unresolved identifier (`is_noted_for_check_file`), so
    /// `check_file` of another file evaluates its own identifiers itself, before its last call of this function.
    pub(super) fn report_unresolved_identifiers(&mut self) {
        while !self.unresolved_identifiers.is_empty() {
            let mut unresolved = std::mem::take(&mut self.unresolved_identifiers);
            unresolved.retain(|u| Some(u.0) == self.task.file);
            unresolved.sort_unstable_by_key(|u| (u.0, u.1));
            unresolved.dedup_by_key(|u| (u.0, u.1));
            for (file, e, name) in unresolved {
                self.report_unresolved_identifier(file, e, name);
            }
        }
    }

    /// `getResolvedSymbol`, where `resolveName` finds nothing: `name`, the identifier `e`, resolves
    /// to no value.
    fn report_unresolved_identifier(&mut self, file: FileId, e: ExprId, name: Atom) {
        self.report_unresolved_identifier_if(file, e, name, true);
    }

    /// `is_checked`: whether it is reported for an identifier that `checkSourceFile` resolves, or
    /// for one that it does not.
    fn report_unresolved_identifier_if(
        &mut self,
        file: FileId,
        e: ExprId,
        name: Atom,
        is_checked: bool,
    ) {
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
        // `await x` where it is not allowed: the parser treated the keyword as an identifier, and
        // has reported the error.
        if hir.has_diagnostic(hir[e].pos, 1308) {
            return;
        }
        let other = SymFlags::TYPE | SymFlags::NAMESPACE;
        let is_resolved_by_check = !bound.is_unchecked(e.idx())
            && match bound.expr_parent[e.idx()] {
                // `checkExportAssignment`: `export = A` and `export default A` resolve `A` with any
                // meaning, `(A)` is checked as an expression. In a namespace they are invalid, and
                // neither is checked.
                Parent::Stmt(s)
                    if matches!(
                        hir[s].kind,
                        StmtKind::ExportAssign(_) | StmtKind::ExportDefault(_)
                    ) && (matches!(bound.stmt_parent[s.idx()], Parent::Module(m) if matches!(hir[m].name, ModuleName::Ident(_)))
                        || !is_parenthesized(hir, e)
                            && self
                                .files()
                                .resolve_name(file, scope, name, other)
                                .is_some()) =>
                {
                    false
                }
                _ => !self.is_name_with_object_assignment_initializer(file, e),
            };
        if is_resolved_by_check != is_checked {
            return;
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
                // `getTargetOfAliasLikeExpression` has `checkExpressionCached` run while aliases
                // are in progress, and a second time if that interrupts the first.
                let lookups = self.files().failed_lookups_of(file, e);
                let runs = lookups.iter().map(|it| it.aliases_in_progress);
                for in_progress in runs.chain(lookups.is_empty().then_some(&[][..])) {
                    let outer = self.alias_targets_in_progress.len();
                    self.alias_targets_in_progress
                        .extend_from_slice(in_progress);
                    self.on_failed_to_resolve_symbol(
                        file, location, None, scope, name, meaning, message,
                    );
                    self.alias_targets_in_progress.truncate(outer);
                }
            }
        }
    }

    /// `getResolvedSymbol` for the identifiers named `arguments` that are not expressions. Only
    /// `containsArgumentsReference` resolves them.
    fn resolve_names_for_arguments(&mut self, file: FileId) {
        let name = known::arguments;
        for &(location, scope, local) in self.bound(file).names_resolved_for_arguments.iter() {
            if local.is_some() {
                // `onSuccessfullyResolvedSymbol`
                let result = self.files().sym(file, local);
                self.check_resolved_block_scoped_variable(file, result, location);
                continue;
            }
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
                Ok(Some(_)) => {}
                Ok(None) => {
                    let message =
                        self.get_cannot_find_name_diagnostic_for_name(file, location, name);
                    let meaning = SymFlags::VALUE | SymFlags::EXPORT_VALUE;
                    self.on_failed_to_resolve_symbol(
                        file, location, None, scope, name, meaning, message,
                    );
                }
            }
        }
    }

    /// Whether `ImportElisionTransformer` runs on `file`: `emitJSFile`, `sourceFileMayBeEmitted`,
    /// `importElisionEnabled`, `canCollectSymbolAliasAccessibilityData`.
    fn elides_imports(&self, file: FileId) -> bool {
        let (files, hir) = (self.files(), self.hir(file));
        let (options, module) = (&files.options, files.module(file));
        !(options.no_emit
            || options.emit_declaration_only
            || options.verbatim_module_syntax
            || !matches!(hir.kind, FileKind::Ts | FileKind::Tsx)
            || hir.is_js
            || module.is_from_external_library)
    }

    /// `markIdentifierAliasReferenced`, `markPropertyAliasReferenced`: `getResolvedSymbol` for the
    /// identifiers that are emitted as expressions. `is_checked`: as for
    /// `report_unresolved_identifier_if`. If set, only for those in a range of `never_checked`,
    /// once what the passes have reported there is removed.
    fn mark_identifier_aliases_referenced(&mut self, file: FileId, is_checked: bool) {
        let (files, hir, bound) = (self.files(), self.hir(file), self.bound(file));
        let never_checked = self.never_checked.borrow().clone();
        // `MarkLinkedReferencesRecursively` does not descend into these.
        let is_import = |n: Node| {
            matches!(hir.data(n), NodeData::Stmt(s) if match hir[s].kind {
                StmtKind::Import(_) => true,
                StmtKind::ImportEquals(i) => !hir[i].flags.contains(Flags::EXPORT),
                _ => false,
            })
        };
        let is_namespace =
            |n: Node| matches!(hir.kind(n), Kind::ModuleBlock | Kind::ModuleDeclaration);
        let idents = bound.free_idents.iter().chain(bound.alias_idents.iter());
        let idents: Vec<(ExprId, ScopeId)> = idents.copied().collect();
        for (e, scope) in idents {
            let ExprKind::Ident(name) = hir[e].kind else {
                continue;
            };
            let pos = hir[e].pos;
            if is_checked && !(never_checked.iter()).any(|&(from, to)| (from..to).contains(&pos)) {
                continue;
            }
            let location = hir.node(e);
            let parent = hir.parent(location);
            // `IsValueAliasDeclaration`, which `ImportElisionTransformer` calls for `export = A` and
            // `export default A` in a file or a namespace.
            let is_exported = hir.kind(parent) == Kind::ExportAssignment
                && hir.find_ancestor(hir.parent(parent), |n| !is_namespace(n)) == Node::FILE;
            if matches!(bound.expr_parent[e.idx()], Parent::None)
                || hir.is_ambient(location)
                || !(hir.is_expression_node(location)
                    || hir.kind(parent) == Kind::ShorthandPropertyAssignment
                    || is_exported)
            {
                continue;
            }
            // `getTargetOfAliasLikeExpression` checks an `A` that has no meaning at all.
            let other = SymFlags::TYPE | SymFlags::NAMESPACE;
            if is_exported && files.resolve_name(file, scope, name, other).is_some() {
                continue;
            }
            // As in `type_of_identifier`.
            let is_unresolved = match self.resolve_identifier(file, e, name, true) {
                Err(_) => true,
                Ok(None) => !(name == known::arguments && bound.is_arguments_object(e)),
                Ok(Some(sym)) => self
                    .value_symbol_of_identifier(file, e, name, sym)
                    .is_none(),
            };
            if is_unresolved && hir.find_ancestor(parent, is_import).is_none() {
                self.report_unresolved_identifier_if(file, e, name, is_checked);
            }
        }
    }

    /// `MarkLinkedReferencesRecursively`, which `ImportElisionTransformer` runs before a file is
    /// emitted. `markIdentifierAliasReferenced` and `markPropertyAliasReferenced` call
    /// `getResolvedSymbol` on every identifier that is emitted as an expression. The check resolves
    /// nearly all of them too. What is reported for the others shows only in tsgo's test harness,
    /// which counts the errors with and without `Emit` (TS-1).
    fn mark_linked_references_recursively(&mut self, file: FileId) {
        let (files, hir, bound) = (self.files(), self.hir(file), self.bound(file));
        if !self.elides_imports(file) {
            return;
        }
        // The `q` of `export import r = q`, which the check resolves as a namespace.
        let meaning = SymFlags::VALUE | SymFlags::EXPORT_VALUE;
        for (i, import) in hir.import_equals.iter().enumerate() {
            let ImportEqualsTarget::Entity(names) = import.target else {
                continue;
            };
            // `NodeFlagsAmbient`
            let is_ambient = import.flags.contains(Flags::AMBIENT)
                || matches!(bound.stmt_parent[import.stmt.idx()], Parent::Module(m) if hir[m].flags.contains(Flags::AMBIENT));
            if !import.flags.contains(Flags::EXPORT) || names.len() != 1 || is_ambient {
                continue;
            }
            let (scope, first) = (bound.import_equals_scope[i], names.at(0));
            let (location, name) = (hir.node(first), hir[first].text);
            if files.resolve_name(file, scope, name, meaning).is_none() {
                let message = self.get_cannot_find_name_diagnostic_for_name(file, location, name);
                self.on_failed_to_resolve_symbol(
                    file, location, None, scope, name, meaning, message,
                );
            }
        }
        self.mark_identifier_aliases_referenced(file, false);
        // The `this` of `typeof this.a` is an identifier, which `checkTypeQuery` does not resolve.
        // It resolves to a `this` parameter, which `bindParameter` declares like any other.
        for (i, node) in hir.types.iter().enumerate() {
            let TypeNodeKind::Typeof { expr, .. } = node.kind else {
                continue;
            };
            if expr.is_none() {
                continue;
            }
            let first = first_identifier(hir, expr);
            if matches!(hir[first].kind, ExprKind::This)
                && !hir.is_ambient(hir.node(first))
                && (files.resolve_name(file, bound.type_scope[i], known::this, meaning)).is_none()
            {
                let at = self.place_of_token(file, hir[first].pos);
                self.add_diagnostic(Reported::new(at, 2304, held(vec![b"this".to_vec()])));
            }
        }
    }

    /// The error `resolveEntityName` reports for `names`, which do not resolve. `meaning`: the
    /// meaning required of the last name.
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

    /// `checkAndReportErrorForInvalidInitializer`: 2301 2844, with the property. Without one: the
    /// errors `Resolve` reports itself, 2302 2467 2562.
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
        let is_arguments_symbol = name == known::arguments
            && meaning.intersects(SymFlags::VARIABLE)
            && (self.bound(file)).is_in_function_with_arguments(self.hir(file), scope);
        if !is_arguments_symbol
            && self
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
        if hir.kind(location) != Kind::Identifier
            || hir.text(location) != name
            || Self::is_type_reference_identifier(hir, location)
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
                if self.get_property_of_type(constructor, name).is_some() {
                    self.error(file, location, 2662, &[Arg::Atom(name), Arg::Sym(class)]);
                    return true;
                }
                if at == container && !hir.is_static(at) {
                    let instance = self.declared_type(class);
                    if self.get_property_of_type(instance, name).is_some() {
                        self.error(file, location, 2663, &[Arg::Atom(name)]);
                        return true;
                    }
                }
            }
            at = hir.parent(at);
        }
        false
    }

    /// `isTypeReferenceIdentifier`
    fn is_type_reference_identifier(hir: &hir::File, mut node: Node) -> bool {
        while hir.kind(hir.parent(node)) == Kind::QualifiedName {
            node = hir.parent(node);
        }
        hir.kind(hir.parent(node)) == Kind::TypeReference
    }

    /// `getCannotFindNameDiagnosticForName`
    pub(super) fn get_cannot_find_name_diagnostic_for_name(
        &self,
        file: FileId,
        node: Node,
        name: Atom,
    ) -> u32 {
        let (hir, text) = (self.hir(file), self.atoms().bytes(name));
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

    /// `onFailedToResolveSymbol`. `scope`: the scope of `location`. `at`: the error position, if
    /// not `location`: a tag, for a node synthesized from it.
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
        let (text, reported) = (self.atoms().bytes(name), Arg::Atom(name));
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
                if self.get_property_of_type(declared, right).is_some() {
                    self.error(file, parent, 2713, &[reported, Arg::Atom(right)]);
                    return;
                }
            }
            self.error_at(at, 2702, &[reported]);
            return;
        }
        let is_primitive = super::errors_enums_names::is_primitive_type_name(text);
        // `checkAndReportErrorForExportingPrimitiveType`
        if is_primitive && hir.kind(hir.parent(location)) == Kind::ExportSpecifier {
            self.error_at(at, 2661, &[reported]);
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
            self.error_at(at, code, &[reported]);
            return;
        }
        // `checkAndReportErrorForUsingTypeAsValue`
        if meaning.intersects(SymFlags::VALUE) {
            if is_primitive {
                // `errorLocation.Parent.Parent`
                let clause = hir.parent(hir.parent(location));
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
                self.error_at(at, code, &[reported]);
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
                        self.error_at(at, 2585, &[reported]);
                    } else if self.maybe_mapped_type(file, location, symbol) {
                        let parameter = if text == b"K" { "P" } else { "K" };
                        self.error_at(at, 2690, &[reported, Arg::Text(parameter)]);
                    } else {
                        self.error_at(at, 2693, &[reported]);
                    }
                    return;
                }
            }
        }
        // `checkAndReportErrorForUsingValueAsType`
        if meaning.intersects(SymFlags::TYPE.difference(SymFlags::NAMESPACE)) {
            // `argumentsSymbol`, which is in no table, is a property.
            let flags = if name == known::arguments
                && (self.bound(file)).is_in_function_with_arguments(hir, scope)
            {
                Some(SymFlags::PROPERTY)
            } else {
                resolve_name(SymFlags::VALUE.difference(SymFlags::TYPE))
                    .map(|symbol| self.get_symbol_flags(symbol))
            };
            if flags.is_some_and(|it| it != SymFlags::all() && !it.intersects(SymFlags::NAMESPACE))
            {
                self.error_at(at, 2749, &[reported]);
                return;
            }
        }
        // `DeclarationNameToString`: with its escapes as in the source text.
        let written = hir
            .text
            .get(at.1 as usize..at.2 as usize)
            .filter(|written| {
                bun_core::strings::contains_char(written, b'\\')
                    && hir.kind(location) == Kind::Identifier
                    && hir.text(location) == name
            });
        let declaration_name = written.map_or(reported, Arg::Bytes);
        let diagnostic = self.name_not_found_diagnostic(
            Some((file, scope)),
            at,
            declaration_name,
            name,
            meaning,
            name_not_found_message,
        );
        self.add_diagnostic(diagnostic);
    }

    /// The end of `onFailedToResolveSymbol`, which is all of it without an `errorLocation`: the
    /// missing library, a spelling suggestion, or `name_not_found_message`. `location`: the file
    /// and the scope of `errorLocation`. `at`: its error range.
    pub(super) fn name_not_found_diagnostic(
        &mut self,
        location: Option<(FileId, ScopeId)>,
        at: super::related::Place,
        declaration_name: Arg<'_>,
        name: Atom,
        meaning: SymFlags,
        name_not_found_message: u32,
    ) -> Reported {
        // `getSuggestedLibForNonExistentName`
        if let Some(&lib) = SUGGESTED_LIBS.get(self.atoms().bytes(name)) {
            let args = [declaration_name, Arg::Bytes(lib)];
            return self.new_diagnostic(at, name_not_found_message, &args);
        }
        // `getSuggestedSymbolForNonexistentSymbol`
        let Some((suggestion, leads_to_export)) =
            similar_in_scope_and_where(self, location, name, meaning)
        else {
            return self.new_diagnostic(at, name_not_found_message, &[declaration_name]);
        };
        let (suggestion, declared) = match suggestion {
            // `suggestion.ValueDeclaration`, which a symbol that only refers to an export symbol
            // does not have.
            SpellingSuggestion::Symbol(sym) if leads_to_export => (Arg::Sym(sym), None),
            SpellingSuggestion::Symbol(sym) => (Arg::Sym(sym), self.span_of_value_declaration(sym)),
            SpellingSuggestion::Word(word) => (Arg::Text(word), None),
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
        diagnostic
    }

    /// `checkAndReportErrorForExtendingInterface`
    pub(super) fn check_and_report_error_for_extending_interface(
        &mut self,
        file: FileId,
        error_location: ExprId,
    ) -> bool {
        let hir = self.hir(file);
        let Some(expression) = self.get_entity_name_for_extending_interface(file, error_location)
        else {
            return false;
        };
        // `resolveEntityName(expression, SymbolFlagsInterface, ignoreErrors)`
        let (mut names, mut first) = (Vec::new(), expression);
        while let ExprKind::Dot { obj, name, .. } = hir[first].kind {
            names.push(name);
            first = obj;
        }
        // `NodeIsMissing`
        let ExprKind::Ident(name) = hir[first].kind else {
            return false;
        };
        names.push(name);
        names.reverse();
        let scope = self.enclosing_scope_of_expr(file, first);
        let interface = SymFlags::INTERFACE;
        let found = self.files().resolve_entity(file, scope, &names, interface);
        if found.is_none_or(|found| !self.resolved_flags(found).contains(interface)) {
            return false;
        }
        let range_of = |e: ExprId| (self.start_of(file, e), self.end_of_expr(file, e));
        let ((from, to), (start, end)) = (range_of(expression), range_of(error_location));
        let text = self.source_text(file, from, to);
        self.error_at((file, start, end), 2689, &[Arg::Bytes(&text)]);
        true
    }

    /// `getEntityNameForExtendingInterface`. An `ExpressionWithTypeArguments` is what a class
    /// extends, or an instantiation expression.
    fn get_entity_name_for_extending_interface(
        &self,
        file: FileId,
        mut node: ExprId,
    ) -> Option<ExprId> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        loop {
            if !matches!(hir[node].kind, ExprKind::Ident(_) | ExprKind::Dot { .. })
                || is_parenthesized(hir, node)
            {
                return None;
            }
            match bound.expr_parent[node.idx()] {
                Parent::Expr(parent) if parent.is_some() => match hir[parent].kind {
                    ExprKind::Dot { .. } => node = parent,
                    ExprKind::Instantiation { .. } => break,
                    _ => return None,
                },
                Parent::ClassExtends(_) => break,
                _ => return None,
            }
        }
        is_entity_name_expression(hir, node).then_some(node)
    }

    /// `getSymbolFlags`. Empty for an alias that does not resolve.
    fn resolved_flags(&self, sym: Sym) -> SymFlags {
        let flags = self.files().symbol_flags(sym);
        if flags == SymFlags::all() {
            SymFlags::empty()
        } else {
            flags
        }
    }
}

/// Codes that are not reported in a file with parse diagnostics (`hasParseDiagnostics`). Only for diagnostics that are not the parser's own.
fn is_grammar_error(code: u32) -> bool {
    errors_js::GRAMMAR_ERRORS.binary_search(&code).is_ok()
        || matches!(
            code,
            // The parser also reports these codes. The checker reports them through
            // `grammarErrorOnNode` and similar functions.
            1003 | 1005 | 1110 | 1142 | 1206 | 1433 | 1453 | 8038
                // The message reaches `grammarErrorOnNode` and similar functions through a variable
                // or a parameter, or is added under `!hasParseDiagnostics`.
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
    /// `getFeatureMap`: the names introduced by a version of the standard library, and the library
    /// of the first entry of each.
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

/// Whether `GetSpellingSuggestion` would suggest `candidate` for `name` if it were the only
/// candidate.
pub(crate) fn is_close(name: &[u8], candidate: &[u8]) -> bool {
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

// ───────────────────────────── message arguments ─────────────────────────────

/// `DeclarationNameToString`, `TokenText`: the name or the word at `start`.
fn word_at(c: &Checker<'_, '_>, file: FileId, start: u32) -> Vec<u8> {
    c.source_text(file, start, c.end_of_name_at(file, start))
}

/// A spelling suggestion for an unresolved name.
#[derive(Copy, Clone)]
pub(crate) enum SpellingSuggestion {
    Symbol(Sym),
    /// A suggestion without a declaration: the name of a primitive type, `undefined`, `globalThis`.
    Word(&'static str),
}

/// `compareSymbols`, `compareNodes`: the sort key of the first declaration of `sym`, as
/// `place_in_program_order` makes it.
fn place_of_first_declaration(files: &Files, sym: Sym) -> Option<(bool, u32, u32)> {
    let (file, decl) = files.decls_of(sym).first().copied()?;
    let pos = files.start_of_declaration(file, decl);
    Some((!files.module(file).is_lib, files.rank_of_file(file), pos))
}

/// `getSpellingSuggestionForName`
fn get_spelling_suggestion_for_name<'a>(
    files: &Files,
    name: &[u8],
    candidates: impl Iterator<Item = (&'a [u8], SpellingSuggestion)>,
) -> Option<SpellingSuggestion> {
    let place = |suggestion: SpellingSuggestion| match suggestion {
        SpellingSuggestion::Symbol(sym) => place_of_first_declaration(files, sym),
        SpellingSuggestion::Word(_) => None,
    };
    // `compareSymbols`
    let compare = |a: (&'a [u8], SpellingSuggestion), b: (&'a [u8], SpellingSuggestion)| {
        match (place(a.1), place(b.1)) {
            (Some(a), Some(b)) => a.cmp(&b),
            (a, b) => b.is_some().cmp(&a.is_some()),
        }
        .then_with(|| a.0.cmp(b.0))
    };
    get_spelling_suggestion(name, candidates, |c| get_candidate_name(c.0), compare).map(|c| c.1)
}

/// The same, and whether it was found among the locals of the module or namespace block that
/// exports it. `declareModuleMember`: the local there is a symbol that only refers to the export
/// symbol.
fn similar_in_scope_and_where(
    c: &mut Checker<'_, '_>,
    location: Option<(FileId, ScopeId)>,
    name: Atom,
    meaning: SymFlags,
) -> Option<(SpellingSuggestion, bool)> {
    let files = c.files();
    let name = (name, c.atoms().bytes(name));
    let among_globals = std::mem::take(&mut c.suggestions_among_globals);
    // `try_resolve_alias` finds nothing for an alias in progress.
    let is_function_of_candidate = c.alias_targets_in_progress.is_empty();
    let suggested = files.suggested_symbol_for_nonexistent_symbol(
        location,
        name,
        meaning,
        c,
        is_function_of_candidate.then_some(&among_globals),
    );
    c.suggestions_among_globals = among_globals;
    // `Resolve` returns nil where the name may not be used.
    suggested.ok().flatten()
}

/// What `getSuggestionForSymbolNameLookup` asks about the symbols of a table.
pub(crate) trait SuggestionLookup {
    /// `getSymbol`, given the entry of the table.
    fn get_symbol(&mut self, held: Option<Sym>, meaning: SymFlags) -> Option<Sym>;

    /// `tryResolveAlias(candidate).Flags`. `None`: nil.
    fn try_resolve_alias(&mut self, candidate: Sym) -> Option<SymFlags>;
}

impl SuggestionLookup for Checker<'_, '_> {
    fn get_symbol(&mut self, held: Option<Sym>, meaning: SymFlags) -> Option<Sym> {
        Checker::get_symbol(self, held, meaning)
    }

    fn try_resolve_alias(&mut self, candidate: Sym) -> Option<SymFlags> {
        let files = self.files();
        // `findResolutionCycleStartIndex(symbol, TypeSystemPropertyNameAliasTarget) >= 0`
        if self.alias_targets_in_progress.contains(&candidate) {
            return None;
        }
        // As for `get_symbol_flags`: the symbol tables have the target, unless types are needed.
        if let Some(target) = files.resolve_alias(candidate)
            && !files.has_symbol_to_combine(candidate)
        {
            return Some(files.flags(target));
        }
        Some(match self.resolve_alias(candidate) {
            AliasTarget::Symbol(target) => files.flags(target),
            AliasTarget::Property(..) => match self.property_of_alias(candidate) {
                Some(&Prop {
                    source: PropSource::Symbol(member),
                    ..
                }) => files.flags(member),
                _ => SymFlags::PROPERTY,
            },
            AliasTarget::Unknown => {
                self.check_target_of_alias_symbol(candidate);
                files.flags(files.unknown_symbol)
            }
        })
    }
}

/// By `meaning` and by the text of the name: what `getSuggestionForSymbolNameLookup` finds in
/// `globals`. A program without the types of its test framework asks for the same few names
/// thousands of times.
pub(crate) type SuggestionsAmongGlobals =
    std::cell::RefCell<FxHashMap<u32, FxHashMap<Vec<u8>, Option<SpellingSuggestion>>>>;

impl Files<'_> {
    /// `getSuggestedSymbolForNonexistentSymbol`, and whether the result is among the locals of a
    /// block that exports it.
    /// `location`: the file and the scope of the node. `None`: nil, so only `globals` is searched.
    /// `text`: the text of `name`, which may be a task-local atom.
    /// `among_globals`: only with a `try_resolve_alias` that is a function of its argument.
    /// `Err`: see `resolve_with`.
    pub(crate) fn suggested_symbol_for_nonexistent_symbol(
        &self,
        location: Option<(FileId, ScopeId)>,
        (name, text): (Atom, &[u8]),
        meaning: SymFlags,
        symbols: &mut dyn SuggestionLookup,
        among_globals: Option<&SuggestionsAmongGlobals>,
    ) -> Result<Option<(SpellingSuggestion, bool)>, (u32, MemberId)> {
        let files = self;
        let (mut word, mut is_among_locals) = (None, false);
        // `getSuggestionForSymbolNameLookup`
        let lookup = &mut |table: SymbolTable, held: Option<Sym>, meaning: SymFlags| {
            is_among_locals = matches!(table, SymbolTable::Locals(..));
            if let Some(found) = symbols.get_symbol(held, meaning) {
                return Some(found);
            }
            // `GetSpellingSuggestion` first gets the name of each candidate, then computes its edit
            // distance.
            let fits = |&(candidate, sym): &(Atom, Sym)| {
                files.is_spelling_candidate(sym, meaning, &mut *symbols)
                    && is_close(text, files.atoms.bytes(candidate))
            };
            let named = |(candidate, sym): (Atom, Sym)| {
                (
                    files.atoms.bytes(candidate),
                    SpellingSuggestion::Symbol(sym),
                )
            };
            let suggestion = match table {
                SymbolTable::Locals(file, scope) => {
                    let (hir, bound) = (files.hir(file), files.bound(file));
                    // tsgo does not put the name of a function or class expression in any symbol
                    // table: `Resolve` compares it directly.
                    let is_in_table = |&&(_, id): &&(Atom, crate::bind::SymbolId)| match bound
                        .symbols[id.idx()]
                    .decls
                    .first()
                    {
                        Some(&Decl::Fn(f)) => hir[f].kind != FnKind::Expr,
                        Some(&Decl::Class(c)) => {
                            !matches!(bound.class_owner[c.idx()], ClassOwner::Expr(_))
                        }
                        _ => true,
                    };
                    let s = &bound.scopes[scope.idx()];
                    // `IsGlobalSourceFile`: the declarations of a script are globals.
                    if s.kind == ScopeKind::File && s.symbol.is_none() {
                        return None;
                    }
                    // `KindInferType`: no table either, `Resolve` compares the name directly.
                    if s.kind == ScopeKind::InferConstraint {
                        return None;
                    }
                    let locals = bound.table(s.locals).iter().filter(is_in_table);
                    let locals = locals.map(|&(candidate, id)| (candidate, files.sym(file, id)));
                    get_spelling_suggestion_for_name(files, text, locals.filter(fits).map(named))
                }
                SymbolTable::Exports(container) => get_spelling_suggestion_for_name(
                    files,
                    text,
                    files.each_export(container).filter(fits).map(named),
                ),
                SymbolTable::Globals
                    if let Some(known) = among_globals
                        .and_then(|it| it.borrow().get(&meaning.bits())?.get(text).copied()) =>
                {
                    known
                }
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
                        .map(|word| (word.as_bytes(), SpellingSuggestion::Word(word)));
                    let globals = files.globals.iter().copied();
                    let suggestion = get_spelling_suggestion_for_name(
                        files,
                        text,
                        globals.filter(fits).map(named).chain(words),
                    );
                    if let Some(among_globals) = among_globals {
                        let mut among_globals = among_globals.borrow_mut();
                        let of_meaning = among_globals.entry(meaning.bits()).or_default();
                        of_meaning.insert(text.to_vec(), suggestion);
                    }
                    suggestion
                }
            };
            match suggestion? {
                SpellingSuggestion::Symbol(sym) => Some(sym),
                SpellingSuggestion::Word(suggestion) => {
                    word = Some(suggestion);
                    None
                }
            }
        };
        let found = match location {
            Some((file, scope)) => files.resolve_with(file, scope, name, meaning, false, lookup),
            None => Ok(lookup(
                SymbolTable::Globals,
                files.globals.get(name).copied(),
                meaning,
            )),
        };
        if let Some(word) = word {
            return Ok(Some((SpellingSuggestion::Word(word), false)));
        }
        let Some(sym) = found? else {
            return Ok(None);
        };
        let declared = files.symbol(sym);
        let leads_to_export = is_among_locals
            && declared.export_symbol.is_some()
            && !declared.flags.intersects(SymFlags::VALUE);
        Ok(Some((SpellingSuggestion::Symbol(sym), leads_to_export)))
    }

    /// `getCandidateName` of `getSpellingSuggestionForName`
    fn is_spelling_candidate(
        &self,
        sym: Sym,
        meaning: SymFlags,
        symbols: &mut dyn SuggestionLookup,
    ) -> bool {
        let flags = self.flags(sym);
        flags.intersects(meaning)
            || flags.contains(SymFlags::ALIAS)
                && symbols
                    .try_resolve_alias(sym)
                    .is_some_and(|target| target.intersects(meaning))
    }
}

/// `node.End()` of the `ExpressionWithTypeArguments` that `class` extends. 0: unknown.
pub(super) fn end_of_extends(c: &Checker<'_, '_>, file: FileId, class: &Class) -> u32 {
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
fn entity_name_text(c: &Checker<'_, '_>, file: FileId, e: ExprId) -> Vec<u8> {
    match c.hir(file)[e].kind {
        ExprKind::Dot { obj, name, .. } => {
            cat!(entity_name_text(c, file, obj), b".", c.atoms().bytes(name))
        }
        ExprKind::Ident(name) => c.atom_text(name),
        ExprKind::This => b"this".to_vec(),
        _ => Vec::new(),
    }
}

/// `TokenToString` of the operator of `a op b`, or of `a op= b`.
pub(super) fn operator_text(op: BinOp, is_assignment: bool) -> Vec<u8> {
    let text: &[u8] = match op {
        BinOp::Add => b"+",
        BinOp::Sub => b"-",
        BinOp::Mul => b"*",
        BinOp::Div => b"/",
        BinOp::Rem => b"%",
        BinOp::Pow => b"**",
        BinOp::Shl => b"<<",
        BinOp::Shr => b">>",
        BinOp::UShr => b">>>",
        BinOp::BitAnd => b"&",
        BinOp::BitOr => b"|",
        BinOp::BitXor => b"^",
        BinOp::Lt => b"<",
        BinOp::Le => b"<=",
        BinOp::Gt => b">",
        BinOp::Ge => b">=",
        BinOp::EqEq => b"==",
        BinOp::NotEq => b"!=",
        BinOp::EqEqEq => b"===",
        BinOp::NotEqEq => b"!==",
        BinOp::In => b"in",
        BinOp::Instanceof => b"instanceof",
        BinOp::And => b"&&",
        BinOp::Or => b"||",
        BinOp::Nullish => b"??",
        BinOp::Comma => b",",
    };
    if is_assignment {
        cat!(text, b"=")
    } else {
        text.to_vec()
    }
}

/// The relation an operator requires between the types of its two operands.
type Related = fn(&mut Checker<'_, '_>, TypeId, TypeId) -> bool;

/// `bothAreBigIntLike`
pub(super) fn both_are_bigint_like(c: &mut Checker<'_, '_>, left: TypeId, right: TypeId) -> bool {
    c.is_assignable(left, TypeId::BIGINT) && c.is_assignable(right, TypeId::BIGINT)
}

/// `closeEnoughKind`: whether `+` plausibly accepts the two operand types.
pub(super) fn may_be_added(c: &mut Checker<'_, '_>, left: TypeId, right: TypeId) -> bool {
    [left, right].into_iter().all(|t| {
        c.is_any(t)
            || t == TypeId::UNKNOWN
            || c.is_assignable(t, TypeId::NUMBER)
            || c.is_assignable(t, TypeId::BIGINT)
            || c.is_assignable(t, TypeId::STRING)
    })
}

/// Whether `<`, `<=`, `>` and `>=` accept the two operand types.
pub(super) fn can_be_ordered(c: &mut Checker<'_, '_>, left: TypeId, right: TypeId) -> bool {
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

/// `isTypeEqualityComparableTo`, in either direction.
pub(super) fn can_be_equal(c: &mut Checker<'_, '_>, left: TypeId, right: TypeId) -> bool {
    let nullable = |t: TypeId| t.is_null() || t.is_undefined();
    nullable(left) || nullable(right) || c.are_comparable(left, right)
}

// ───────────────────────────── operators ─────────────────────────────

impl Checker<'_, '_> {
    /// `isGlobalNaN`
    fn is_global_nan(&mut self, file: FileId, e: ExprId) -> bool {
        let ExprKind::Ident(name) = self.hir(file)[e].kind else {
            return false;
        };
        self.atoms().bytes(name) == b"NaN" && {
            let global = self.files().global(name, SymFlags::VALUE);
            global.is_some() && self.symbol_of_identifier(file, e, name) == global
        }
    }

    /// The types of the two operands of an operator whose result type does not depend on them,
    /// checked left to right.
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
            // `#x in v`: the left operand is a name, resolved in the enclosing classes, not a
            // value. A name that none of them declares is reported as missing on the type of the
            // right operand as it is.
            ExprKind::PrivateIdentifier(name) if !is_parenthesized(hir, left) => {
                self.note_external_emit_helpers_check(file, left);
                if !self.bound(file).private_class.contains_key(&left)
                    && !self.enclosing_classes(file, left).is_empty()
                {
                    let start = hir[left].pos;
                    let is_unchecked_js =
                        self.is_unchecked_js_suggestion(file, left, right_type, true);
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
                let expected = self.union(&[TypeId::STRING, TypeId::NUMBER, TypeId::SYMBOL]);
                let at = self.span_of_parenthesized_expr(file, left);
                self.check_type_assignable_to(key, expected, Some(at), None);
            }
        }
        let object = self.check_non_null_type(file, right, right_type);
        let at = self.span_of_parenthesized_expr(file, right);
        if self.check_type_assignable_to(object, TypeId::OBJECT, Some(at), None)
            && has_empty_object_intersection(self, right_type)
        {
            self.error_at(at, 2638, &[Arg::Type(right_type)]);
        }
    }

    /// `getErrorRangeForNode` of `e`, excluding enclosing parentheses.
    pub(super) fn place_of_expr(&self, file: FileId, e: ExprId) -> (FileId, u32, u32) {
        (
            file,
            self.error_start_inside_parentheses(file, e),
            self.error_end_inside_parentheses(file, e),
        )
    }

    /// `getErrorRangeForNode` of `e`, including its enclosing parentheses.
    pub(super) fn span_of_parenthesized_expr(&self, file: FileId, e: ExprId) -> (FileId, u32, u32) {
        (
            file,
            self.error_start_of(file, e),
            self.error_end_of(file, e),
        )
    }

    /// `errorAndMaybeSuggestAwait`
    pub(super) fn error_and_maybe_suggest_await(
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

    /// `reportOperatorError` for `e`, which is `a op b` or `a op= b`: 2365, 2367. `left` and
    /// `right`: the types of the operands.
    /// `is_related`: the relation they fail.
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
            let args = [Arg::Bytes(&left), Arg::Bytes(&right)];
            return self.error_and_maybe_suggest_await(at, would_work_with_await, 2367, &args);
        }
        let is_assignment = matches!(self.hir(file)[e].kind, ExprKind::Assign { .. });
        let operator = operator_text(op, is_assignment);
        let args = [Arg::Bytes(&operator), Arg::Bytes(&left), Arg::Bytes(&right)];
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
            b"...".to_vec()
        };
        let not: &[u8] = if is_equality { b"" } else { b"!" };
        let suggestion = cat!(not, b"Number.isNaN(", name, b")");
        let at = self.span_of_parenthesized_expr(file, location);
        let did_you_mean = self.new_diagnostic(at, 1369, &[Arg::Bytes(&suggestion)]);
        let always = if is_equality { "false" } else { "true" };
        let diagnostic = self.error_at(self.place_of_expr(file, e), 2845, &[Arg::Text(always)]);
        if !(is_left_nan && is_right_nan) {
            diagnostic.add_related_info(did_you_mean);
        }
    }

    /// 2447 for `&`, `|` or `^` between two booleans: `getSuggestedBooleanOperator`. It is reported
    /// on the operator, which is the token before the right operand: the HIR does not store its
    /// position.
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
        let found = start_of_token_before(&hir.text, self.start_of(file, right), &operator);
        let at = match found {
            Some(start) => (file, start, start + operator.len() as u32),
            None => self.place_of_token(file, self.start_inside_parentheses(file, e)),
        };
        self.error_at(at, 2447, &[Arg::Bytes(&operator), Arg::Text(suggested)]);
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
        // `evaluateEnumMember` reports errors of its own.
        let rhs_eval = self.constant_value(file, right);
        let is_error = matches!(self.bound(file).expr_parent[e.idx()], Parent::EnumInit(_));
        if (is_error || self.captures_suggestions())
            && let Some(EnumValue::Number(bits)) = rhs_eval
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
            let args = [
                Arg::Bytes(&written),
                Arg::Bytes(&operator),
                Arg::Bytes(&count),
            ];
            let diagnostic = self.new_diagnostic(self.place_of_expr(file, e), 6807, &args);
            self.add_error_or_suggestion(is_error, diagnostic);
        }
    }

    /// `checkForDisallowedESSymbolOperand`: 2469. `e`: `left op right` or `left op= right`.
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
        let at = self.span_of_parenthesized_expr(file, offending);
        let is_assignment = matches!(self.hir(file)[e].kind, ExprKind::Assign { .. });
        self.error_at(at, 2469, &[Arg::Bytes(&operator_text(op, is_assignment))]);
        false
    }

    /// `checkArithmeticOperandType`: whether the operand type is valid.
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
        let at = self.span_of_parenthesized_expr(file, operand);
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
        let Some(code) = super::errors_operators::why_no_reference(
            hir,
            e,
            invalid_reference,
            invalid_optional_chain,
        ) else {
            return true;
        };
        self.error(file, hir.child(e), code, &[]);
        false
    }

    /// `headMessage` of `checkAssignmentOperator`. The property is looked up in the type of the
    /// object itself: one that is possibly `undefined` or `null` has no such property. It is looked
    /// up by `left.Name().Text()`, which is not the name a private member is stored under.
    pub(super) fn exact_optional_head_message(
        &mut self,
        file: FileId,
        left: ExprId,
        right_type: TypeId,
    ) -> Option<u32> {
        let hir = self.hir(file);
        let ExprKind::Dot {
            obj,
            name,
            name_pos,
            ..
        } = hir[left].kind
        else {
            return None;
        };
        if !self.p.files.options.exact_optional_property_types
            || is_parenthesized(hir, left)
            || is_private_name_at(hir, name_pos)
        {
            return None;
        }
        let object = self.type_of_expr(file, obj);
        let target = self.type_of_property_of_type(object, name)?;
        self.is_exact_optional_property_mismatch(right_type, target)
            .then_some(2412)
    }

    /// `checkAssignmentOperator` for `left op= right`: 2364 2779, or 2322 2412 if `right_type` is
    /// not assignable to the target.
    /// `left_type`: `checkExpression(left)`, for an arithmetic operator with `null` and `undefined`
    /// removed. `right_type`: the assigned type, which for such an operator is its result type.
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
        // A setter may accept a wider type than the getter returns: `checkPropertyAccessExpression`
        // with `writeOnly`, which `(a.b) += c` does not reach, and `AccessFlagsWriting`.
        let property = match hir[left].kind {
            ExprKind::Dot { obj, name, .. } if !is_parenthesized(hir, left) => Some((obj, name)),
            ExprKind::Index { obj, index, .. } => match hir[index].kind {
                ExprKind::String(name) => Some((obj, name)),
                _ => None,
            },
            _ => None,
        };
        let mut expected = left_type;
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
                expected = written;
                // `checkPropertyAccessExpression` ends with `getFlowTypeOfAccessExpression`.
                if let ExprKind::Dot { name_pos, .. } = hir[left].kind {
                    let prop = self.get_property_of_type(object, name).map(|found| found.0);
                    let right = (file, name_pos, hir[left].end);
                    let target = self.target_kind(file, left);
                    expected = self.get_flow_type_of_access_expression(
                        file, left, prop, written, right, target,
                    );
                }
            }
        }
        if !self.check_reference_expression(file, left, 2364, 2779) {
            return;
        }
        let head_message = self.exact_optional_head_message(file, left, right_type);
        // `AssignmentKindDefinite` uses the declared type of the target. For a target that is read
        // first, a literal type is replaced by its base type: `checkIdentifier`,
        // `getFlowTypeOfAccessExpression`.
        if !matches!(op, BinOp::And | BinOp::Or | BinOp::Nullish) {
            expected = self.base_of_literal(expected);
        }
        let at = self.span_of_parenthesized_expr(file, left);
        self.check_type_assignable_to_and_optionally_elaborate(
            right_type,
            expected,
            Some(at),
            Some((file, right)),
            false,
            head_message,
            None,
        );
    }

    /// `getBaseTypeOfLiteralTypeForComparison`: `1` and `2` are compared as numbers, and an enum
    /// member as the string or the number it is, regardless of the other members of the enum.
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

    /// `checkNonNullType`: the type of `node` with `null` and `undefined` removed, which are not
    /// allowed here.
    pub(super) fn check_non_null_type(&mut self, file: FileId, node: ExprId, ty: TypeId) -> TypeId {
        self.check_non_null_type_with_reporter(ty, |c, error| {
            let (at, code, name) = c.object_possibly_null_error(file, node, error);
            let args: Vec<Arg> = name.iter().map(|name| Arg::Bytes(name)).collect();
            c.error_at(at, code, &args);
        })
    }

    /// `reportObjectPossiblyNullOrUndefinedError`, and the error `checkNonNullTypeWithReporter`
    /// reports for `unknown`: the span, the code (18050, 18046 to 18049, 2531 to 2533 or 2571), and
    /// the name argument.
    fn object_possibly_null_error(
        &self,
        file: FileId,
        node: ExprId,
        error: super::flow::NonNullError,
    ) -> ((FileId, u32, u32), u32, Option<Vec<u8>>) {
        use super::flow::NonNullError;
        let hir = self.hir(file);
        let is_name = self.is_entity_name(file, node);
        let code = match error {
            NonNullError::IsUnknown if is_name => 18046,
            NonNullError::IsUnknown => 2571,
            NonNullError::IsPossibly { undefined, null } => match hir[node].kind {
                // `(null)` and `(undefined)` are parenthesized expressions.
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
            18050 if matches!(hir[node].kind, ExprKind::Null) => Some(b"null".to_vec()),
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

    /// A name short enough to be quoted in the message: `IsEntityNameExpression(node)`,
    /// `len(entityNameToString(node)) < 100`. In a type query `a.b` is a qualified name, which is
    /// not one, and `this` is an Identifier.
    fn is_entity_name(&self, file: FileId, e: ExprId) -> bool {
        let hir = self.hir(file);
        let is_name = if self.bound(file).is_in_type_query(e) {
            matches!(hir[e].kind, ExprKind::Ident(_) | ExprKind::This) && !is_parenthesized(hir, e)
        } else {
            is_entity_name_expression(hir, e)
        };
        is_name && entity_name_text(self, file, e).len() < 100
    }

    /// Start of `e` in the source, including its enclosing parentheses.
    pub(super) fn start_of(&self, file: FileId, e: ExprId) -> u32 {
        start_of(self.hir(file), e)
    }

    /// Start of `e`, excluding parentheses that enclose the whole of it.
    pub(super) fn start_inside_parentheses(&self, file: FileId, e: ExprId) -> u32 {
        start_inside_parentheses(self.hir(file), e)
    }

    /// `GetErrorRangeForNode` for a declaration.
    pub(super) fn error_range_of_declaration(
        &self,
        file: FileId,
        decl: Decl,
    ) -> Option<(u32, u32)> {
        let hir = self.hir(file);
        // The source text of the default library and of JSON is not stored, so an end cannot be
        // computed.
        if hir.text.is_empty() {
            let start = self.declaration_name_start(file, decl)?;
            return Some((start, start));
        }
        let node = hir.node(decl);
        (node.is_some()).then(|| self.get_error_range_for_node(file, node))
    }
}

impl Files<'_> {
    /// `declaration.Loc`. `None`: the HIR does not store it.
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

    /// The statement node of `decl`.
    pub(crate) fn statement_of_declaration(&self, file: FileId, decl: Decl) -> Option<StmtId> {
        let hir = self.hir(file);
        match hir.data(hir.node(decl)) {
            NodeData::Stmt(statement) => Some(statement),
            _ => None,
        }
    }

    /// `GetTokenPosOfNode` for a declaration: the position of its first token, including decorators
    /// and modifiers.
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

// ───────────────────────────── assignment targets ─────────────────────────────

impl Checker<'_, '_> {
    /// `isAssignmentToReadonlyEntity(expr, symbol, getAssignmentTargetKind(expr))`. `expr`: the
    /// access `obj.name` or `obj[name]`.
    pub(super) fn is_assignment_to_readonly_entity(
        &mut self,
        file: FileId,
        expr: ExprId,
        obj: ExprId,
        symbol: &Prop,
    ) -> bool {
        let (hir, bound, files) = (self.hir(file), self.bound(file), self.files());
        if !self.is_assignment_target(file, expr) {
            return false;
        }
        // `getResolvedSymbol(SkipParentheses(expr.Expression()))`
        let expression_symbol = match hir[obj].kind {
            ExprKind::Ident(name) => self.symbol_of_identifier(file, obj, name),
            _ => None,
        };
        // "CommonJS module.exports is never readonly"
        if expression_symbol.is_some_and(|it| files.flags(it).contains(SymFlags::MODULE_EXPORTS)) {
            return false;
        }
        if self.is_readonly_symbol(symbol) {
            // "Allow assignments to readonly properties within constructors of the same class declaration."
            if let Some(&PropSource::Symbol(property)) = Self::value_declaration(symbol)
                && self
                    .flags_of_property(property)
                    .contains(SymFlags::PROPERTY)
                && matches!(hir[obj].kind, ExprKind::This)
                && !is_parenthesized(hir, obj)
                && let Container::Fn(ctor) =
                    self.get_control_flow_container(file, bound.expr_parent[expr.idx()])
                && hir[ctor].kind == FnKind::Constructor
                && let FnOwner::Member(constructor) = bound.fns[ctor.idx()].owner
                && let Some((declared_in, value_declaration)) = files.value_declaration(property)
            {
                let class = bound.member_owner[constructor.idx()];
                let is_writeable_symbol = match value_declaration {
                    // `isLocalPropertyDeclaration`
                    Decl::Member(member) => {
                        declared_in == file && bound.member_owner[member.idx()] == class
                    }
                    // `isLocalParameterProperty`
                    Decl::ParameterProperty(parameter) => {
                        declared_in == file && bound.param_fn[parameter.idx()] == ctor
                    }
                    // `isLocalThisPropertyAssignment`. No symbol has a constructor as the
                    // declaration of its parent (`getThisClassAndSymbolTable`), which
                    // `isLocalThisPropertyAssignmentConstructorFunction` asks for.
                    Decl::ThisProperty(_) => {
                        let parent = files.symbol_parent(property);
                        let parent = parent.and_then(|parent| files.value_declaration(parent));
                        matches!(class, MemberOwner::Class(class)
                            if parent == Some((file, Decl::Class(class))))
                    }
                    _ => false,
                };
                return !is_writeable_symbol;
            }
            return true;
        }
        // "references through namespace import should be readonly"
        expression_symbol.is_some_and(|it| {
            files.flags(it).contains(SymFlags::ALIAS)
                && matches!(
                    files.declaration_of_alias_symbol(it),
                    Some((_, Decl::ImportNamespace(_)))
                )
        })
    }
}
