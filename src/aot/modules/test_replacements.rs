use super::bindings::ImportBinding;
use super::imports::{
    FileBinder, PendingBinding, find_modules_of_alternatives,
    find_modules_that_program_may_answer_for,
};
use super::interop::ImportPhase;
use super::namespace_members::{StandsFor, find_outermost_type_assertion, imported_module};
use super::plan::{ModuleRef, View};
use super::requests::ScannedSite;
use crate::builtins::{BuiltinId, BuiltinName, ResolvedBuiltins, RuntimeModule, table};
use crate::load::sources::parsed_source;
use crate::test_runs::names_from_outside::find_items_handed_to_callback;
use bun_sema::atom::{Atom, Interner};
use bun_sema::bind::{Binding, Bound, Decl, Parent, SymbolId};
use bun_sema::file_analysis::FileAnalysis;
use bun_sema::hir::{
    BinOp, ExportSpecId, ExprId, ExprKind, File, Flags, FnKind, MemberKey, NodeData, PatId,
    PatKind, PropKey, StmtKind, UnOp, VarDeclId,
};
use bun_sema::import_sites::{
    ImportSiteKind, ImportSpecifier, is_module_call_of_plugin, may_spell_word_that_mock_looks_for,
    names_word_that_mock_looks_for,
};
use bun_sema::util::SharedSort;
use core::ops::Range;
use std::sync::OnceLock;

#[derive(Default)]
pub(super) struct SpiesOnUnknownObjects {
    pub names: Vec<Atom>,
    pub is_any_name: bool,
}

enum LoadedObjectUse {
    OnlyRead,
    Held(SymbolId),
    Escapes,
}

impl FileBinder<'_, '_> {
    pub(super) fn note_what_a_spy_may_reach(&mut self) {
        if !self.context.runs_tests {
            return;
        }
        let Some(source) = parsed_source(self.context.files, self.file) else {
            self.imports.spies_on_unknown_objects.is_any_name = true;
            return;
        };
        self.imports.spies_on_unknown_objects.is_any_name = source.builtins.hands_spy_on();
        let spies = source.builtins.spy_calls();
        if spies.is_empty() {
            return;
        }
        let names = self.collect_module_object_names();
        for spy in spies {
            if self.analysis.decisions.is_dead_expr(spy.call) {
                continue;
            }
            let objects = self.find_module_objects(&names, spy.object);
            match (&objects[..], spy.name) {
                ([], Some(name)) => self.imports.spies_on_unknown_objects.names.push(name),
                ([], None) if source.of_run.spies_read.contains(&spy.call) => {}
                ([], None) => self.imports.spies_on_unknown_objects.is_any_name = true,
                (objects, Some(name)) => {
                    for &object in objects {
                        self.replace_export(object, name);
                    }
                }
                (objects, None) => {
                    let modules = objects.iter().map(|object| object.module());
                    self.imports.namespaces_spied_on_whole.extend(modules);
                }
            }
        }
    }

    fn find_module_objects(
        &self,
        names: &[(SymbolId, StandsFor)],
        object: ExprId,
    ) -> Vec<StandsFor> {
        if let Some(found) = self.find_module_object(names, object) {
            return vec![found];
        }
        let (hir, atoms) = (self.hir, &self.context.files.atoms);
        let object = hir.skip_type_assertions(object);
        let Some(items) = find_items_handed_to_callback(hir, self.bound, atoms, object) else {
            return Vec::new();
        };
        let mut found = Vec::new();
        for item in hir.ids(items) {
            let of_item = self.find_module_objects(names, item);
            if of_item.is_empty() {
                return Vec::new();
            }
            found.extend(of_item);
        }
        found
    }

    fn collect_module_object_names(&self) -> Vec<(SymbolId, StandsFor)> {
        let imported = self.imports.bindings.iter();
        let imported = imported.filter_map(|&(name, binding)| {
            let object = match binding {
                PendingBinding::Bound(ImportBinding::Namespace { module, .. }) => {
                    StandsFor::ImportedNamespace(module)
                }
                _ => imported_module(binding)?,
            };
            Some((name, object))
        });
        let held = self.imports.holders.iter().map(|holder| {
            let object = match holder.view {
                View::Namespace(module) => StandsFor::RequiredNamespace(module),
                View::Exports(module) => StandsFor::Exports(module),
            };
            (holder.symbol, object)
        });
        let mut names: Vec<(SymbolId, StandsFor)> = imported.chain(held).collect();
        names.shared_sort_by_key(|name| name.0);
        names.dedup_by_key(|name| name.0);
        names
    }

    fn find_module_object(
        &self,
        names: &[(SymbolId, StandsFor)],
        object: ExprId,
    ) -> Option<StandsFor> {
        let bound = self.bound;
        let object = self.hir.skip_type_assertions(object);
        if !bound.is_evaluated_ident(object)
            || bound.dynamic_lookup_scope(NodeData::Expr(object)).is_some()
        {
            return None;
        }
        let Binding::Symbol(symbol) = bound.binding(object) else {
            return None;
        };
        let position = names.binary_search_by_key(&symbol, |name| name.0);
        position.ok().map(|position| names[position].1)
    }

    fn replace_export(&mut self, spied_on: StandsFor, name: Atom) {
        let resolved = match spied_on {
            StandsFor::ImportedNamespace(module) => {
                self.resolve_name(self.context.modules.module_behind(module), name)
            }
            StandsFor::RequiredNamespace(module)
            | StandsFor::Exports(module)
            | StandsFor::Copy { module, .. } => self.resolve_required_name(module, name),
        };
        let Ok((binding, _)) = resolved else {
            return;
        };
        match binding {
            PendingBinding::Bound(ImportBinding::Variable(variable)) => {
                self.imports.replaced_variables.push(variable);
            }
            PendingBinding::Synthetic { module, name }
            | PendingBinding::CapturedBuiltin { module, name, .. } => {
                self.imports.replaced_names.push((module, name));
            }
            PendingBinding::Bound(ImportBinding::NamespaceRead { module, .. }) => {
                self.imports.namespaces_spied_on_whole.push(module);
            }
            PendingBinding::Bound(
                ImportBinding::Local
                | ImportBinding::Unused
                | ImportBinding::Unbound
                | ImportBinding::Namespace { .. }
                | ImportBinding::Builtin(_)
                | ImportBinding::CapturedBuiltin { .. }
                | ImportBinding::BuiltinMember { .. }
                | ImportBinding::Synthetic(_)
                | ImportBinding::Exports { .. },
            ) => {}
        }
    }

    pub(super) fn note_loads_handed_out(&mut self) {
        if !self.context.runs_tests {
            return;
        }
        let (hir, bound, analysis, scan) = (self.hir, self.bound, self.analysis, self.scan);
        for &(name, binding) in &self.imports.bindings {
            if let PendingBinding::Bound(ImportBinding::Namespace { module, phase }) = binding
                && (phase == ImportPhase::Defer || bound.is_visible_to_eval(name))
            {
                self.imports.namespaces_handed_out.push(module);
            }
        }
        let mut held: Vec<(SymbolId, ModuleRef)> = Vec::new();
        let (mut hands_out_candidates, mut hands_out_every_module) = (false, false);
        for (site, answer) in analysis.import_sites.iter().zip(&scan.sites) {
            let (call, returns_promise) = match site.kind {
                ImportSiteKind::ImportCall(call) | ImportSiteKind::ImportByTestRunner(call) => {
                    (call, true)
                }
                ImportSiteKind::Require(call)
                | ImportSiteKind::ImportMetaRequire(call)
                | ImportSiteKind::GetBuiltinModule(call)
                | ImportSiteKind::RequireByTestRunner(call) => (call, false),
                ImportSiteKind::ImportEquals(declaration) => {
                    let name = bound.declared_symbol(Decl::ImportEquals(declaration));
                    let is_evaluated = !analysis.decisions.is_dead_stmt(hir[declaration].stmt)
                        && analysis.unused_import_symbols.binary_search(&name).is_err();
                    if let (true, &ScannedSite::Module(module)) = (is_evaluated, answer) {
                        let holders = &self.imports.holders;
                        match holders.binary_search_by_key(&name, |holder| holder.symbol) {
                            Ok(_) => held.push((name, module)),
                            Err(_) => self.imports.namespaces_handed_out.push(module),
                        }
                    }
                    continue;
                }
                ImportSiteKind::JsxRuntime
                | ImportSiteKind::JsxPackage
                | ImportSiteKind::Import(_)
                | ImportSiteKind::ExportFrom(_)
                | ImportSiteKind::ExportStar(_)
                | ImportSiteKind::RequireResolve(_)
                | ImportSiteKind::ImportMetaResolve(_)
                | ImportSiteKind::MockModule(_) => continue,
            };
            if analysis.decisions.is_dead_expr(call) {
                continue;
            }
            match (self.find_loaded_object_use(call, returns_promise), answer) {
                (LoadedObjectUse::OnlyRead, _)
                | (_, ScannedSite::Unresolved | ScannedSite::Erased) => {}
                (LoadedObjectUse::Held(holder), &ScannedSite::Module(module)) => {
                    held.push((holder, module));
                }
                (LoadedObjectUse::Escapes, &ScannedSite::Module(module)) => {
                    self.imports.namespaces_handed_out.push(module);
                }
                (
                    LoadedObjectUse::Held(_) | LoadedObjectUse::Escapes,
                    ScannedSite::Candidates(_),
                ) => hands_out_candidates = true,
                (LoadedObjectUse::Held(_) | LoadedObjectUse::Escapes, ScannedSite::AllModules) => {
                    hands_out_every_module = true;
                }
            }
        }
        let (modules, handed_out) = (
            self.context.modules,
            &mut self.imports.namespaces_handed_out,
        );
        if hands_out_every_module {
            if !self.context.input.hands_on_any_module {
                let files = modules.compiled_files.iter();
                handed_out.extend(files.map(|&file| ModuleRef::File(file)));
                let test_runner = ModuleRef::Runtime(RuntimeModule::BunTest);
                let others = modules.other_modules.iter().copied();
                handed_out.extend(others.filter(|&module| module != test_runner));
            }
        } else if hands_out_candidates {
            handed_out.extend_from_slice(&scan.candidates);
        }
        if held.is_empty() {
            return;
        }
        held.shared_sort_unstable_by_key(|it| it.0);
        let find_held = |binding: Binding| match binding {
            Binding::Symbol(name) => {
                let position = held.binary_search_by_key(&name, |it| it.0);
                position.ok().map(|position| held[position].1)
            }
            Binding::Arguments(_) | Binding::CommonJs(_) | Binding::Free => None,
        };
        let without_expression = analysis.bindings_read_without_expression(hir, bound);
        handed_out.extend(without_expression.filter_map(find_held));
        for reference in (0..hir.exprs.len() as u32).map(ExprId) {
            if !bound.is_evaluated_ident(reference) {
                continue;
            }
            let Some(module) = find_held(bound.binding(reference)) else {
                continue;
            };
            if analysis.decisions.is_dead_expr(reference) || bound.is_in_type_query(reference) {
                continue;
            }
            let object = find_outermost_type_assertion(hir, bound, reference);
            if !is_object_of_member(hir, bound, object) && !is_only_tested(hir, bound, object) {
                handed_out.push(module);
            }
        }
    }

    fn find_loaded_object_use(&self, call: ExprId, returns_promise: bool) -> LoadedObjectUse {
        let (hir, bound) = (self.hir, self.bound);
        let mut holders = self.imports.holders.iter();
        if let Some(holder) = holders.find(|holder| holder.call == call) {
            return LoadedObjectUse::Held(holder.symbol);
        }
        let mut value = find_outermost_type_assertion(hir, bound, call);
        if returns_promise {
            match find_user(bound, value) {
                Some(user) if matches!(hir[user].kind, ExprKind::Await(_)) => {
                    value = find_outermost_type_assertion(hir, bound, user);
                }
                _ if is_only_tested(hir, bound, value) => return LoadedObjectUse::OnlyRead,
                _ => return LoadedObjectUse::Escapes,
            }
        }
        if is_only_tested(hir, bound, value) || is_object_of_member(hir, bound, value) {
            return LoadedObjectUse::OnlyRead;
        }
        let Parent::VarInit(declaration) = bound.parent_of_expr(value) else {
            return LoadedObjectUse::Escapes;
        };
        let pattern = hir[declaration].pat;
        if reads_only_named_properties(hir, pattern) {
            return LoadedObjectUse::OnlyRead;
        }
        match self.find_holder(pattern) {
            Some(holder) => LoadedObjectUse::Held(holder),
            None => LoadedObjectUse::Escapes,
        }
    }

    pub(super) fn collect_mocked_modules(&mut self) {
        let context = self.context;
        if context.modules.compiled_files.first() == Some(&self.file) {
            if context.input.mocks_any_module {
                self.mock_every_module();
            }
            for &module in &context.mocked.out_of_sight {
                self.mock(module);
            }
        }
        if context.input.run.loader_functions_answer_requires {
            let (files, scans, modules) = (context.files, context.scans, context.modules);
            for module in find_modules_that_program_may_answer_for(files, scans, modules, self.file)
            {
                match module {
                    ModuleRef::Runtime(module) => {
                        self.imports.library_modules_answered_for.push(module);
                    }
                    module => self.mock_with_forms(module),
                }
            }
        }
        let (analysis, scan) = (self.analysis, self.scan);
        for (site, answer) in analysis.import_sites.iter().zip(&scan.sites) {
            let ImportSiteKind::MockModule(call) = site.kind else {
                continue;
            };
            if analysis.decisions.is_dead_expr(call) {
                continue;
            }
            match answer {
                &ScannedSite::Module(module) => self.mock_with_forms(module),
                ScannedSite::Candidates(spelled) => {
                    match self.find_modules_of_alternatives(&site.specifier, spelled) {
                        Some(modules) => {
                            for module in modules {
                                self.mock_with_forms(module);
                            }
                        }
                        None => self.mock_every_module(),
                    }
                }
                ScannedSite::AllModules => self.mock_every_module(),
                ScannedSite::Unresolved | ScannedSite::Erased => {}
            }
        }
    }

    fn find_modules_of_alternatives(
        &self,
        specifier: &ImportSpecifier,
        spelled: &Range<u32>,
    ) -> Option<Vec<ModuleRef>> {
        find_modules_of_alternatives(self.analysis, self.scan, specifier, spelled)
    }

    fn mock_every_module(&mut self) {
        if core::mem::replace(&mut self.imports.mocks_any_module, true) {
            return;
        }
        for &file in &self.context.modules.compiled_files {
            self.mock(ModuleRef::File(file));
        }
    }

    fn mock_with_forms(&mut self, module: ModuleRef) {
        self.mock(module);
        let modules = self.context.modules;
        for form in modules.forms_of(module) {
            self.mock(form);
        }
    }

    fn mock(&mut self, module: ModuleRef) {
        self.imports.mocked_modules.push(module);
        self.look_at(StandsFor::ImportedNamespace(module));
    }
}

fn find_user(bound: &Bound<'_>, value: ExprId) -> Option<ExprId> {
    match bound.parent_of_expr(value) {
        Parent::Expr(user) => user.some(),
        _ => None,
    }
}

fn is_object_of_member(hir: &File<'_>, bound: &Bound<'_>, value: ExprId) -> bool {
    let member = find_user(bound, value).and_then(|user| hir.member_key(user));
    member.is_some_and(|(object, _)| object == value)
}

fn find_call_of(hir: &File<'_>, bound: &Bound<'_>, callee: ExprId) -> Option<ExprId> {
    let user = find_user(bound, callee)?;
    matches!(hir[user].kind, ExprKind::Call(call) if hir[call].callee == callee).then_some(user)
}

fn reads_only_named_properties(hir: &File<'_>, pattern: PatId) -> bool {
    matches!(hir[pattern].kind, PatKind::Object(properties) if properties.iter().all(|it| {
        !hir[it].is_rest && matches!(hir[it].key, PropKey::Name(_))
    }))
}

fn is_only_tested(hir: &File<'_>, bound: &Bound<'_>, mut value: ExprId) -> bool {
    loop {
        let user = match bound.parent_of_expr(value) {
            Parent::Expr(user) if user.is_some() => user,
            Parent::Stmt(statement) => {
                return match hir[statement].kind {
                    StmtKind::Expr(_) => true,
                    StmtKind::If { test, .. }
                    | StmtKind::While { test, .. }
                    | StmtKind::DoWhile { test, .. }
                    | StmtKind::For { test, .. } => test == value,
                    _ => false,
                };
            }
            _ => return false,
        };
        match hir[user].kind {
            ExprKind::Unary {
                op: UnOp::Typeof | UnOp::Not | UnOp::Void,
                ..
            }
            | ExprKind::Binary {
                op: BinOp::EqEq | BinOp::NotEq | BinOp::EqEqEq | BinOp::NotEqEq,
                ..
            } => return true,
            ExprKind::Binary {
                op: BinOp::And,
                left,
                ..
            } if left == value => return true,
            ExprKind::Cond { test, .. } if test == value => return true,
            ExprKind::Binary {
                op: BinOp::And | BinOp::Or | BinOp::Nullish,
                ..
            }
            | ExprKind::Cond { .. } => value = user,
            _ if hir.type_assertion_operand(user) == Some(value) => value = user,
            _ => return false,
        }
    }
}

fn test_runner_object() -> BuiltinId {
    table::canonical_id(table::namespace_of(RuntimeModule::BunTest))
}

fn returns_test_runner_object(builtin: BuiltinId) -> bool {
    builtin == table::canonical_id(BuiltinId::BunJest)
}

fn mocks_modules(builtin: BuiltinId) -> bool {
    let mut members = table::members(builtin).iter();
    builtin == table::canonical_id(BuiltinId::BunTestMock)
        || members.any(|&member| table::resets_modules(member))
}

fn leads_to_mocks(builtin: BuiltinId) -> bool {
    builtin == test_runner_object() || returns_test_runner_object(builtin) || mocks_modules(builtin)
}

const MEMBERS_THAT_LEAVE_MODULES_ALONE: [&[u8]; 30] = [
    b"advanceTimersByTime",
    b"advanceTimersToNextTimer",
    b"clearAllMocks",
    b"clearAllTimers",
    b"fn",
    b"getMockedSystemTime",
    b"getRealSystemTime",
    b"getTimerCount",
    b"hoisted",
    b"isFakeTimers",
    b"isMockFunction",
    b"mocked",
    b"now",
    b"resetAllMocks",
    b"restore",
    b"restoreAllMocks",
    b"runAllTicks",
    b"runAllTimers",
    b"runOnlyPendingTimers",
    b"setSystemTime",
    b"setTimeout",
    b"spyOn",
    b"stubEnv",
    b"stubGlobal",
    b"unstubAllEnvs",
    b"unstubAllGlobals",
    b"useFakeTimers",
    b"useRealTimers",
    b"waitFor",
    b"waitUntil",
];

fn leaves_modules_alone(member: BuiltinId) -> bool {
    static NAMES: OnceLock<Vec<BuiltinName>> = OnceLock::new();
    let names = NAMES.get_or_init(|| {
        let texts = MEMBERS_THAT_LEAVE_MODULES_ALONE.iter();
        texts.filter_map(|text| table::find_name(text)).collect()
    });
    names.contains(&table::entry(member).name)
}

fn allows_member(holder: BuiltinId, member: BuiltinId) -> bool {
    holder == test_runner_object() || leads_to_mocks(member) || leaves_modules_alone(member)
}

struct TestRunnerUses<'a, 's> {
    hir: &'a File<'s>,
    bound: &'a Bound<'s>,
    analysis: &'a FileAnalysis<'s>,
    builtins: &'a ResolvedBuiltins,
    atoms: &'a Interner<'s>,
    is_test_runner: &'a dyn Fn(usize) -> bool,
}

impl TestRunnerUses<'_, '_> {
    fn find_loads(&self) -> Option<(bool, Vec<SymbolId>)> {
        let (mut is_loaded, mut namespace_names) = (false, Vec::new());
        for (index, site) in self.analysis.import_sites.iter().enumerate() {
            if !(self.is_test_runner)(index) {
                continue;
            }
            is_loaded = true;
            match site.kind {
                ImportSiteKind::Import(import) => {
                    let name = self.bound.declared_symbol(Decl::ImportNamespace(import));
                    if self.hir[import].namespace.is_some() && name.is_some() {
                        namespace_names.push(name);
                    }
                }
                ImportSiteKind::ImportEquals(import)
                    if self.hir[import].flags.contains(Flags::EXPORT) =>
                {
                    return None;
                }
                ImportSiteKind::JsxRuntime
                | ImportSiteKind::JsxPackage
                | ImportSiteKind::ImportEquals(_)
                | ImportSiteKind::Require(_)
                | ImportSiteKind::RequireResolve(_)
                | ImportSiteKind::ImportMetaRequire(_)
                | ImportSiteKind::ImportMetaResolve(_)
                | ImportSiteKind::GetBuiltinModule(_)
                | ImportSiteKind::MockModule(_) => {}
                ImportSiteKind::ExportFrom(_)
                | ImportSiteKind::ExportStar(_)
                | ImportSiteKind::ImportCall(_)
                | ImportSiteKind::ImportByTestRunner(_)
                | ImportSiteKind::RequireByTestRunner(_) => return None,
            }
        }
        Some((is_loaded, namespace_names))
    }

    fn shows_every_use(&self) -> bool {
        let (hir, bound, analysis, builtins) = (self.hir, self.bound, self.analysis, self.builtins);
        let Some((is_loaded, namespace_names)) = self.find_loads() else {
            return false;
        };
        let mentioned = builtins.mentioned().iter();
        let mut mentioned = mentioned.map(|&builtin| table::canonical_id(builtin));
        if !is_loaded && !mentioned.any(returns_test_runner_object) {
            return true;
        }
        let mut evals = bound.runtime.eval_scopes().iter();
        if evals.any(|&(call, _)| !analysis.decisions.is_dead_expr(call)) {
            return false;
        }
        let can_reach_mocks = |binding: Binding| match binding {
            Binding::Symbol(name) => {
                let held = builtins.of_symbol(name);
                namespace_names.contains(&name)
                    || held.is_some_and(|path| leads_to_mocks(table::canonical_id(path.id)))
            }
            Binding::Arguments(_) | Binding::CommonJs(_) | Binding::Free => false,
        };
        let is_namespace_import = |binding: Binding| match binding {
            Binding::Symbol(name) => namespace_names.contains(&name),
            Binding::Arguments(_) | Binding::CommonJs(_) | Binding::Free => false,
        };
        let specifiers = (0..hir.export_specs.len() as u32).map(ExportSpecId);
        let exported = specifiers.filter(|&specifier| {
            let export = &hir[hir[specifier].export];
            !export.has_module_specifier && !export.type_only && !hir[specifier].type_only
        });
        let exported = exported.map(|specifier| bound.exported_binding(specifier));
        let without_expression = analysis.bindings_read_without_expression(hir, bound);
        if exported.chain(without_expression).any(can_reach_mocks) {
            return false;
        }
        let is_live_reference_to_namespace_import = |mention: ExprId| {
            !namespace_names.is_empty()
                && bound.is_evaluated_ident(mention)
                && is_namespace_import(bound.binding(mention))
                && !analysis.decisions.is_dead_expr(mention)
                && !bound.is_in_type_query(mention)
        };
        (0..hir.exprs.len() as u32).map(ExprId).all(|mention| {
            let builtin = match builtins.builtin_of_expression(mention) {
                Some(builtin) => table::canonical_id(builtin),
                None if is_live_reference_to_namespace_import(mention) => test_runner_object(),
                None => return true,
            };
            !leads_to_mocks(builtin) || self.shows_use(mention, builtin)
        })
    }

    fn shows_use(&self, mention: ExprId, builtin: BuiltinId) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        let mut value = find_outermost_type_assertion(hir, bound, mention);
        while let Some(choice) = find_user(bound, value)
            && matches!(hir[choice].kind, ExprKind::Cond { test, .. } if test != value)
        {
            value = find_outermost_type_assertion(hir, bound, choice);
        }
        if is_only_tested(hir, bound, value) {
            return true;
        }
        if is_object_of_member(hir, bound, value) {
            let Some(member) = find_user(bound, value) else {
                return false;
            };
            let read = find_outermost_type_assertion(hir, bound, member);
            if is_only_tested(hir, bound, read) || self.is_callee_of_mock_site(read) {
                return true;
            }
            if let Some(found) = self.builtins.builtin_of_expression(member) {
                return allows_member(builtin, table::canonical_id(found));
            }
            let written = self.find_member_written(builtin, member);
            return written.is_some_and(leaves_modules_alone);
        }
        if let Some(call) = find_call_of(hir, bound, value) {
            return !returns_test_runner_object(builtin)
                || self.shows_use(call, test_runner_object());
        }
        match bound.parent_of_expr(value) {
            Parent::VarInit(declaration) => self.takes_allowed_members(declaration, builtin),
            _ => false,
        }
    }

    fn find_member_written(&self, holder: BuiltinId, member: ExprId) -> Option<BuiltinId> {
        let (_, MemberKey::Name(name)) = self.hir.member_key(member)? else {
            return None;
        };
        table::own_member(holder, table::find_name(self.atoms.bytes(name))?)
    }

    fn is_callee_of_mock_site(&self, callee: ExprId) -> bool {
        let analysis = self.analysis;
        let call = find_call_of(self.hir, self.bound, callee);
        let site = call.and_then(|call| analysis.import_site_of_call(call));
        site.is_some_and(|site| {
            matches!(
                analysis.import_sites[site].kind,
                ImportSiteKind::MockModule(_)
            )
        })
    }

    fn takes_allowed_members(&self, declaration: VarDeclId, holder: BuiltinId) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        let declaration = &hir[declaration];
        let PatKind::Object(properties) = hir[declaration.pat].kind else {
            return false;
        };
        let mut properties = properties.iter().map(|it| hir[it]);
        !declaration.flags.contains(Flags::EXPORT)
            && properties.all(|it| {
                let name = bound.declared_symbol(Decl::Var(it.value));
                let member = name.some().and_then(|name| self.builtins.of_symbol(name));
                let member = member.map(|path| table::canonical_id(path.id));
                !it.is_rest
                    && it.default.is_none()
                    && matches!(it.key, PropKey::Name(_))
                    && member.is_some_and(|member| allows_member(holder, member))
            })
    }
}

pub(crate) fn asks_for_original_beside_mock<'s>(
    hir: &File<'s>,
    bound: &Bound<'s>,
    analysis: &FileAnalysis<'s>,
    builtins: &ResolvedBuiltins,
    atoms: &Interner<'s>,
    is_test_runner: &dyn Fn(usize) -> bool,
) -> bool {
    let may_word_come_from_outside = names_word_that_mock_looks_for(&hir.text)
        || (analysis.decisions)
            .folds_text_that(|it| names_word_that_mock_looks_for(atoms.bytes(it)));
    let text_names_original = |factory: ExprId| {
        let written = hir[factory].pos as usize..hir[factory].end as usize;
        let text = hir.text.get(written);
        may_word_come_from_outside || text.is_none_or(may_spell_word_that_mock_looks_for)
    };
    let takes_nothing = |factory: ExprId| {
        let factory = hir.skip_type_assertions(factory);
        let ExprKind::Fn(function) = hir[factory].kind else {
            return false;
        };
        hir[function].kind == FnKind::Arrow
            && hir[function].params.is_empty()
            && !text_names_original(factory)
    };
    for site in analysis.import_sites {
        let is_dead = |call: ExprId| analysis.decisions.is_dead_expr(call);
        match site.kind {
            ImportSiteKind::ImportByTestRunner(call)
            | ImportSiteKind::RequireByTestRunner(call)
                if !is_dead(call) =>
            {
                return true;
            }
            ImportSiteKind::MockModule(call)
                if !is_dead(call) && !is_module_call_of_plugin(hir, bound, call) =>
            {
                let ExprKind::Call(call) = hir[call].kind else {
                    return true;
                };
                let arguments = hir[call].args;
                if arguments.len() != 2 || !takes_nothing(hir.id_at::<ExprId>(arguments, 1)) {
                    return true;
                }
            }
            _ => {}
        }
    }
    let uses = TestRunnerUses {
        hir,
        bound,
        analysis,
        builtins,
        atoms,
        is_test_runner,
    };
    !uses.shows_every_use()
}
