use super::bindings::{
    AccessedModule, AnswerMember, CopiedExports, Holder, ImportBinding, ShownNames,
};
use super::imports::{FileBinder, NamedMember, PendingBinding};
use super::interop::{ImportPhase, ModuleKind};
use super::order::{PlannedSite, SiteKey, SitePosition};
use super::plan::{Member, ModuleRef, View};
use super::requests::ScannedSite;
use super::wrapped::InnerModuleKind;
use crate::builtins::id::BuiltinId;
use crate::builtins::{BuiltinNames, RuntimeModule, table};
use crate::known_helpers::{Helper, KnownFunction, KnownReference, Shape as HelperShape};
use crate::load::replaced_modules::find_spies_on_unknown_objects;
use crate::load::sources::parsed_source;
use bun_sema::atom::{Atom, Interner, known};
use bun_sema::bind::{Binding, Bound, Decl, Parent, SymbolId};
use bun_sema::fold::{Constant, FoldedValue};
use bun_sema::hir::{
    self, BinOp, Chain, ExprId, ExprKind, MemberKey, PatId, PatKind, PropKey, StmtKind, UnOp,
};
use bun_sema::import_sites::ImportSiteKind;
use bun_sema::util::SharedSort;

/// A name that stands for a module: an import of its namespace or of its exports as a whole, or a holder.
#[derive(Copy, Clone)]
struct Root {
    symbol: SymbolId,
    stands_for: StandsFor,
    /// The position in the list of holders.
    holder: Option<usize>,
}

/// What the members of an expression are the members of.
#[derive(Copy, Clone)]
enum StandsFor {
    /// What `import * as ns` shows.
    ImportedNamespace(ModuleRef),
    /// What `require` of an ES module answers.
    RequiredNamespace(ModuleRef),
    /// `module.exports` of a CommonJS module.
    Exports(ModuleRef),
    /// What `__toESM(require(K))` and `__importStar(require(K))` make: a new object with a getter for each name that the answer of `require` has by then, which reads the name there.
    Copy {
        module: ModuleRef,
        /// `default` is a name like the others: the text of the module says that it has the marker, and the helper is not told to pass over it.
        has_marker: bool,
        /// `__importStar`
        is_star: bool,
    },
}

impl StandsFor {
    fn module(self) -> ModuleRef {
        match self {
            StandsFor::ImportedNamespace(module)
            | StandsFor::RequiredNamespace(module)
            | StandsFor::Exports(module)
            | StandsFor::Copy { module, .. } => module,
        }
    }
}

impl FileBinder<'_, '_> {
    pub(super) fn bind_namespace_members(&mut self) {
        let mut roots = self.collect_imported_roots();
        let mut holders = Vec::new();
        for site in self.context.sites.of(self.file) {
            self.bind_site(site, &mut roots, &mut holders);
        }
        if !roots.is_empty() {
            roots.shared_sort_by_key(|root| root.symbol);
            self.bind_references(&roots, &mut holders);
        }
        self.settle_copies(&mut holders);
        holders.shared_sort_unstable_by_key(|holder| holder.symbol);
        self.imports.holders = holders;
        self.imports
            .unread_sites
            .shared_sort_unstable_by_key(|&(call, _)| call);
        self.imports
            .accessed
            .shared_sort_unstable_by_key(|&(member, _)| member);
        self.imports
            .fixed_members
            .shared_sort_unstable_by_key(|&(member, _)| member);
    }

    // Whoever reads under `default` what `require` answered looks at the object of the module, and so does the helper of TypeScript.
    fn settle_copies(&mut self, holders: &mut [Holder]) {
        let called_through = core::mem::take(&mut self.imports.copies_called_through);
        for holder in holders.iter_mut() {
            let Some(copy) = &mut holder.copy else {
                continue;
            };
            copy.is_called_through = called_through.contains(&holder.symbol);
            let mut answer_members = self.imports.answer_members.iter();
            if copy.passes_marked_answer_on
                || answer_members
                    .any(|&(_, member)| member.holder == holder.symbol && member.name.is_none())
            {
                holder.is_needed_as_value = true;
                let (View::Namespace(module) | View::Exports(module)) = holder.view;
                self.look_at(StandsFor::Exports(module));
            }
        }
        self.imports
            .answer_members
            .shared_sort_unstable_by_key(|&(member, _)| member);
    }

    fn collect_imported_roots(&self) -> Vec<Root> {
        let bindings = self.imports.bindings.iter();
        let mut roots: Vec<Root> = bindings
            .filter_map(|&(symbol, binding)| {
                Some(Root {
                    symbol,
                    stands_for: imported_module(binding)?,
                    holder: None,
                })
            })
            .collect();
        roots.shared_sort_by_key(|root| root.symbol);
        roots.dedup_by_key(|root| root.symbol);
        roots
    }

    fn bind_references(&mut self, roots: &[Root], holders: &mut [Holder]) {
        let (hir, bound, analysis) = (self.hir, self.bound, self.analysis);
        for root in roots {
            if bound.is_visible_to_eval(root.symbol) {
                self.look_at(root.stands_for);
            }
        }
        // Such a read takes the object, and the names behind it from the object.
        for binding in analysis.bindings_read_without_expression(hir, bound) {
            if let Binding::Symbol(symbol) = binding
                && let Ok(position) = roots.binary_search_by_key(&symbol, |root| root.symbol)
            {
                self.look_at_root(roots[position], holders);
            }
        }
        let mut references: Vec<(usize, ExprId)> = Vec::new();
        for index in 0..hir.exprs.len() as u32 {
            let reference = ExprId(index);
            if !bound.is_evaluated_ident(reference) || analysis.decisions.is_dead_expr(reference) {
                continue;
            }
            let Binding::Symbol(symbol) = bound.binding(reference) else {
                continue;
            };
            if let Ok(position) = roots.binary_search_by_key(&symbol, |root| root.symbol) {
                references.push((position, reference));
            }
        }
        references.shared_sort_unstable();
        for of_root in references.chunk_by(|first, second| first.0 == second.0) {
            let root = roots[of_root[0].0];
            let mut is_needed_as_value = false;
            let mut is_handed_out = false;
            for &(_, reference) in of_root {
                let names_export = self.note_replaced_export(reference, root.stands_for);
                let is_value = self.bind_member_path(reference, root.stands_for);
                is_needed_as_value |= is_value;
                is_handed_out |= is_value && !names_export;
            }
            if is_needed_as_value {
                self.look_at_root(root, holders);
            }
            if let (
                true,
                StandsFor::ImportedNamespace(module) | StandsFor::RequiredNamespace(module),
            ) = (is_handed_out, root.stands_for)
            {
                self.imports.namespaces_handed_out.push(module);
            }
        }
    }

    // `spyOn(ns, "name")` stores a function of the test runner in the variable that the module exports under the name.
    // Returns whether the reference is such a call's object.
    fn note_replaced_export(&mut self, reference: ExprId, stands_for: StandsFor) -> bool {
        let (StandsFor::ImportedNamespace(_) | StandsFor::RequiredNamespace(_)) = stands_for else {
            return false;
        };
        let (hir, bound) = (self.hir, self.bound);
        let object = find_outermost_type_assertion(hir, bound, reference);
        let Parent::Expr(user) = bound.parent_of_expr(object) else {
            return false;
        };
        let call = match user.is_some().then(|| hir[user].kind) {
            Some(ExprKind::Call(call)) => hir[call],
            _ => return false,
        };
        if call.args.len() < 2 || hir.id_at::<ExprId>(call.args, 0) != object {
            return false;
        }
        let callee = hir.skip_type_assertions(call.callee);
        let builtins = parsed_source(self.context.files, self.file).map(|source| &source.builtins);
        let callee = builtins.and_then(|builtins| builtins.builtin_of_expression(callee));
        let is_spy = matches!(
            callee,
            Some(BuiltinId::BunTestSpyOn | BuiltinId::BunTestJestSpyOn | BuiltinId::BunTestViSpyOn)
        );
        if !is_spy {
            return false;
        }
        let name = hir.skip_type_assertions(hir.id_at::<ExprId>(call.args, 1));
        let FoldedValue::Constant(Constant::String(name)) =
            self.analysis.decisions.constant(hir, name)
        else {
            let module = stands_for.module();
            self.imports.namespaces_spied_on_whole.push(module);
            return true;
        };
        let spied_on = match stands_for {
            StandsFor::ImportedNamespace(module) => {
                StandsFor::ImportedNamespace(self.context.modules.module_behind(module))
            }
            _ => stands_for,
        };
        let Some(NamedMember::Binding(binding)) = self.resolve_member(spied_on, name) else {
            return true;
        };
        match binding {
            PendingBinding::Bound(ImportBinding::Variable(variable)) => {
                self.imports.replaced_variables.push(variable);
            }
            PendingBinding::Synthetic { module, name }
            | PendingBinding::CapturedBuiltin { module, name, .. } => {
                self.imports.replaced_names.push((module, name));
            }
            PendingBinding::Bound(_) => {}
        }
        true
    }

    // What `import()` and `require` answer goes where the file does not follow it, unless the file reads names off it.
    pub(super) fn note_loads_handed_out(&mut self) {
        let (hir, bound, analysis, scan) = (self.hir, self.bound, self.analysis, self.scan);
        let mut held: Vec<(SymbolId, ModuleRef)> = Vec::new();
        for (site, answer) in analysis.import_sites.iter().zip(&scan.sites) {
            let (
                ImportSiteKind::ImportCall(call)
                | ImportSiteKind::Require(call)
                | ImportSiteKind::ImportMetaRequire(call),
                &ScannedSite::Module(module),
            ) = (site.kind, answer)
            else {
                continue;
            };
            let mut value = find_outermost_type_assertion(hir, bound, call);
            let mut is_promise = matches!(site.kind, ImportSiteKind::ImportCall(_));
            if let Parent::Expr(user) = bound.parent_of_expr(value)
                && matches!(hir[user].kind, ExprKind::Await(_))
            {
                value = find_outermost_type_assertion(hir, bound, user);
                is_promise = false;
            }
            if is_promise {
                self.imports.namespaces_handed_out.push(module);
                continue;
            }
            match bound.parent_of_expr(value) {
                Parent::Expr(user)
                    if hir
                        .member_key(user)
                        .is_some_and(|(object, _)| object == value) => {}
                Parent::VarInit(declaration) => match hir[hir[declaration].pat].kind {
                    PatKind::Object(properties)
                        if properties.iter().all(|it| {
                            !hir[it].is_rest && matches!(hir[it].key, PropKey::Name(_))
                        }) => {}
                    _ => match self.find_holder(hir[declaration].pat) {
                        Some(symbol) => held.push((symbol, module)),
                        None => self.imports.namespaces_handed_out.push(module),
                    },
                },
                _ => self.imports.namespaces_handed_out.push(module),
            }
        }
        if held.is_empty() {
            return;
        }
        for index in 0..hir.exprs.len() as u32 {
            let reference = ExprId(index);
            if !bound.is_evaluated_ident(reference) {
                continue;
            }
            let Binding::Symbol(symbol) = bound.binding(reference) else {
                continue;
            };
            let Some(&(_, module)) = held.iter().find(|it| it.0 == symbol) else {
                continue;
            };
            let object = find_outermost_type_assertion(hir, bound, reference);
            let is_read = matches!(bound.parent_of_expr(object), Parent::Expr(user)
                if hir.member_key(user).is_some_and(|(accessed, _)| accessed == object));
            if !is_read {
                self.imports.namespaces_handed_out.push(module);
            }
        }
    }

    pub(super) fn note_what_a_spy_may_reach(&mut self) {
        let (hir, analysis, scan) = (self.hir, self.analysis, self.scan);
        let sites = analysis.import_sites.iter().zip(&scan.sites);
        self.imports.loads_by_unknown_path = sites.clone().any(|(site, answer)| {
            matches!(answer, ScannedSite::AllModules | ScannedSite::Candidates(_))
                && matches!(
                    site.kind,
                    ImportSiteKind::ImportCall(_)
                        | ImportSiteKind::Require(_)
                        | ImportSiteKind::ImportMetaRequire(_)
                )
        });
        let test_runner = ScannedSite::Module(ModuleRef::Runtime(RuntimeModule::BunTest));
        let Some(source) = parsed_source(self.context.files, self.file) else {
            return;
        };
        // A file that the program writes and loads imports any file of the program.
        self.imports.loads_by_unknown_path |= !source.files_missing_at_build_at.is_empty();
        let builtins = &source.builtins;
        let (bound, bindings) = (self.bound, &self.imports.bindings);
        self.imports.spies_on_unknown_objects = find_spies_on_unknown_objects(
            hir,
            bound,
            analysis,
            builtins,
            &|site| scan.sites[site] == test_runner,
            &|object| {
                bound.is_evaluated_ident(object)
                    && matches!(bound.binding(object), Binding::Symbol(symbol)
                        if bindings.iter().any(|&(held, binding)| held == symbol
                            && imported_module(binding).is_some()))
            },
        );
        let spies = &mut self.imports.spies_on_unknown_objects;
        for object in core::mem::take(&mut spies.module_objects_behind_other_names) {
            let Binding::Symbol(symbol) = bound.binding(object) else {
                continue;
            };
            let held = self.imports.bindings.iter().filter(|it| it.0 == symbol);
            let modules: Vec<ModuleRef> = (held
                .filter_map(|it| imported_module(it.1))
                .map(|it| it.module()))
            .collect();
            self.imports.namespaces_spied_on_whole.extend(modules);
        }
    }

    // A mock is stored under the names of the module, as if through its namespace object.
    pub(super) fn collect_mocked_modules(&mut self) {
        // One file says it for all of them.
        let speaks_for_all = self.context.modules.compiled_files[0] == self.file;
        if self.context.mocks_any_module && speaks_for_all {
            self.mock_every_module();
        }
        let context = self.context;
        for &module in (context.mocked.out_of_sight.iter()).filter(|_| speaks_for_all) {
            self.mock(module);
        }
        let (analysis, scan) = (self.analysis, self.scan);
        for (site, answer) in analysis.import_sites.iter().zip(&scan.sites) {
            let ImportSiteKind::MockModule(call) = site.kind else {
                continue;
            };
            if analysis.decisions.is_dead_expr(call) {
                continue;
            }
            match *answer {
                ScannedSite::Module(module) => {
                    self.mock(module);
                    let modules = self.context.modules;
                    for form in modules.forms_of(module) {
                        self.mock(form);
                    }
                }
                ScannedSite::AllModules | ScannedSite::Candidates(_) => self.mock_every_module(),
                ScannedSite::Unresolved | ScannedSite::Erased => {}
            }
        }
    }

    fn mock_every_module(&mut self) {
        self.imports.mocks_any_module = true;
        for &file in &self.context.modules.compiled_files {
            self.mock(ModuleRef::File(file));
        }
    }

    fn mock(&mut self, module: ModuleRef) {
        self.imports.mocked_modules.push(module);
        self.look_at(StandsFor::ImportedNamespace(module));
    }

    fn look_at_root(&mut self, root: Root, holders: &mut [Holder]) {
        if let Some(holder) = root.holder {
            holders[holder].is_needed_as_value = true;
            if let Some(copy) = &mut holders[holder].copy {
                copy.is_looked_at = true;
            }
        }
        self.look_at(root.stands_for);
    }

    fn look_at(&mut self, stands_for: StandsFor) {
        let module = stands_for.module();
        let is_namespace = match stands_for {
            StandsFor::ImportedNamespace(_) | StandsFor::RequiredNamespace(_) => true,
            StandsFor::Exports(_) | StandsFor::Copy { .. } => false,
        };
        if is_namespace && self.namespace_value_set.insert(module) {
            self.imports.namespace_values.push(module);
        }
        // The namespace object of a CommonJS module shows `module.exports` as `default`.
        if self.is_commonjs(module) && self.exports_value_set.insert(module) {
            self.imports.exports_values.push(module);
        }
    }

    /// A CommonJS file reads what its JSX imports from a CommonJS module off the value that `require` answers.
    pub(super) fn look_at_required_jsx_module(&mut self, exporter: ModuleRef) {
        if self.is_commonjs(ModuleRef::File(self.file)) && self.is_commonjs(exporter) {
            self.look_at(StandsFor::Exports(exporter));
        }
    }

    fn is_commonjs(&self, module: ModuleRef) -> bool {
        self.context.modules.interop(module).kind == ModuleKind::CommonJs
    }

    fn is_esm_wrapper(&self, module: ModuleRef) -> bool {
        let ModuleRef::Inner { file, callback } = module else {
            return false;
        };
        let inner = self.context.modules.wrapped.of_callback(file, callback);
        inner.is_some_and(|inner| inner.kind == InnerModuleKind::Esm)
    }

    fn bind_site(&mut self, site: &PlannedSite, roots: &mut Vec<Root>, holders: &mut Vec<Holder>) {
        let target = site.target;
        // `init_x()` gives `undefined`.
        if self.is_esm_wrapper(target) {
            return;
        }
        let (answer, view) = match self.context.modules.interop(target).kind {
            ModuleKind::SourceText => (
                StandsFor::RequiredNamespace(target),
                View::Namespace(target),
            ),
            _ => (StandsFor::Exports(target), View::Exports(target)),
        };
        // A file taken out of `require.cache` loads again: the answer is another object, not these variables.
        if self.context.evicted.contains(target) && self.context.order.is_code_of_program(target) {
            return self.look_at(answer);
        }
        // `require.cache["fs"] = { exports: fake }`: `require("fs")` answers what the entry exports, another object too.
        if self.context.stored_in_cache.contains(target) {
            return self.look_at(answer);
        }
        // `require.cache[path].exports = other`: `require` answers what the program has stored in the entry that the run time made for the file, another object too.
        if self.context.modules.interop(target).kind != ModuleKind::CommonJs
            && self.context.evicted.is_table_reached()
            && self.context.order.is_code_of_program(target)
        {
            return self.look_at(answer);
        }
        // Behind a mock of an ES module that was required before, `require` answers what the factory gave: another object too.
        if self.context.modules.interop(target).kind == ModuleKind::SourceText
            && self.context.mocked.contains(target)
            && self.context.order.is_code_of_program(target)
        {
            return self.look_at(answer);
        }
        if self.bind_copy(site, view, roots, holders) {
            return;
        }
        if let Some((call, symbol)) = self.find_holder_of_marked_module(site) {
            self.imports.unread_sites.push((call, false));
            return add_holder(roots, holders, symbol, call, view, answer, None);
        }
        if !site.evaluates || !site.is_proven {
            return self.look_at(answer);
        }
        let call = match site.key {
            SiteKey::Call(call) => call,
            SiteKey::ImportEquals(declaration) => {
                let symbol = self.bound.declared_symbol(Decl::ImportEquals(declaration));
                let is_holder = symbol.is_some()
                    && !self.is_exported(symbol)
                    && !self.bound.is_visible_to_eval(symbol);
                return match is_holder {
                    true => add_holder(roots, holders, symbol, ExprId::NONE, view, answer, None),
                    false => self.look_at(answer),
                };
            }
        };
        let (hir, bound) = (self.hir, self.bound);
        match bound.parent_of_expr(find_outermost_type_assertion(hir, bound, call)) {
            Parent::VarInit(declaration) => {
                let pattern = hir[declaration].pat;
                if let Some(symbol) = self.find_holder(pattern) {
                    self.imports.unread_sites.push((call, false));
                    return add_holder(roots, holders, symbol, call, view, answer, None);
                }
                if self.bind_pattern(pattern, answer) {
                    return self.imports.unread_sites.push((call, false));
                }
            }
            Parent::Stmt(statement) if matches!(hir[statement].kind, StmtKind::Expr(_)) => {
                return self.imports.unread_sites.push((call, true));
            }
            _ => {}
        }
        match self.bind_member_path(call, answer) {
            true => self.look_at(answer),
            // A module that is one value may be false, zero or null.
            false => self.imports.unread_sites.push((call, false)),
        }
    }

    // `const a = __importStar(require(K))` and `const a = __importDefault(require(K))`, where the text of the CommonJS module says that it has the marker: the helper answers what `require` answers. The call of `require` and `a`.
    fn find_holder_of_marked_module(&self, site: &PlannedSite) -> Option<(ExprId, SymbolId)> {
        let (hir, bound, context) = (self.hir, self.bound, self.context);
        let SiteKey::Call(required) = site.key else {
            return None;
        };
        if !site.evaluates
            || !site.is_proven
            || !self.is_commonjs(site.target)
            || (context.marker)(site.target) != Some(true)
        {
            return None;
        }
        let operand = find_outermost_type_assertion(hir, bound, required);
        let Parent::Expr(written) = bound.parent_of_expr(operand) else {
            return None;
        };
        let ExprKind::Call(call) = hir[written].kind else {
            return None;
        };
        let call = hir[call];
        if call.chain != Chain::No
            || call.args.len() != 1
            || hir.id_at::<ExprId>(call.args, 0) != operand
        {
            return None;
        }
        let helpers = context.known_helpers;
        let known = helpers.certain_callee(context.files, self.file, call.callee)?;
        if !matches!(
            known.shape.helper(),
            Helper::ImportStar | Helper::ImportDefault
        ) {
            return None;
        }
        let Parent::VarInit(declaration) =
            bound.parent_of_expr(find_outermost_type_assertion(hir, bound, written))
        else {
            return None;
        };
        Some((required, self.find_holder(hir[declaration].pat)?))
    }

    // `var a = __toESM(require(K))`, `const a = __importStar(require(K))`
    fn bind_copy(
        &mut self,
        site: &PlannedSite,
        view: View,
        roots: &mut Vec<Root>,
        holders: &mut Vec<Holder>,
    ) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        let SiteKey::Call(call) = site.key else {
            return false;
        };
        let module = site.target;
        let Some(copy) = self.find_copy(site, call) else {
            return false;
        };
        let (written, has_marker) = (copy.written, copy.has_marker);
        let Parent::VarInit(declaration) =
            bound.parent_of_expr(find_outermost_type_assertion(hir, bound, written))
        else {
            return false;
        };
        let Some(symbol) = self.find_holder(hir[declaration].pat) else {
            return false;
        };
        if !site.is_proven {
            return false;
        }
        if site.evaluates {
            self.imports.unread_sites.push((call, false));
        }
        let stands_for = StandsFor::Copy {
            module,
            has_marker,
            is_star: copy.passes_marked_answer_on,
        };
        add_holder(roots, holders, symbol, call, view, stands_for, Some(copy));
        true
    }

    // `__toESM(require(K))`, `__importStar(require(K))`
    fn find_copy(&self, site: &PlannedSite, required: ExprId) -> Option<CopiedExports> {
        let (hir, bound, context) = (self.hir, self.bound, self.context);
        let target = site.target;
        let required = find_outermost_type_assertion(hir, bound, required);
        let Parent::Expr(written) = bound.parent_of_expr(required) else {
            return None;
        };
        let ExprKind::Call(call) = hir[written].kind else {
            return None;
        };
        let call = hir[call];
        if call.chain != Chain::No
            || !matches!(call.args.len(), 1 | 2)
            || hir.id_at::<ExprId>(call.args, 0) != required
        {
            return None;
        }
        let gives_object = match target {
            ModuleRef::Runtime(module) => !table::is_es_module(module),
            _ => self.is_commonjs(target),
        };
        if !gives_object {
            return None;
        }
        let helpers = context.known_helpers;
        let known = helpers.certain_callee(context.files, self.file, call.callee)?;
        let is_ordinary_object = match target {
            ModuleRef::Runtime(_) => true,
            _ => self.exports_ordinary_object(target),
        };
        let copy = CopiedExports {
            written,
            shows: ShownNames::Own,
            passes_marked_answer_on: false,
            runs_once: site.position == SitePosition::InOrder,
            is_of_ordinary_object: is_ordinary_object,
            has_marker: false,
            may_hold_answer: false,
            is_looked_at: false,
            is_called_through: false,
        };
        let asks_for_marker_alone = match known.shape {
            HelperShape::ToEsModuleShowsUnmarkedValueAsDefault => true,
            HelperShape::ToEsModuleShowsValueWithoutDefaultAsDefault => false,
            HelperShape::ImportStarAnswersMarkedValueOrBindsItsEnumerableNames
            | HelperShape::ImportStarAnswersMarkedValueOrBindsItsOwnNames => {
                let is_marked = self.is_commonjs(target) && (context.marker)(target) == Some(true);
                let shows = match known.shape {
                    HelperShape::ImportStarAnswersMarkedValueOrBindsItsOwnNames => {
                        ShownNames::OwnWithValue
                    }
                    _ => ShownNames::OwnEnumerableWithValue,
                };
                let is_copy = call.args.len() == 1 && !is_marked && self.binds_getters(known);
                return is_copy.then_some(CopiedExports {
                    shows,
                    passes_marked_answer_on: true,
                    ..copy
                });
            }
            _ => return None,
        };
        let passes_over_marker = match hir.ids(call.args).nth(1) {
            None => false,
            Some(flag) => match self
                .analysis
                .decisions
                .constant(hir, hir.skip_type_assertions(flag))
            {
                FoldedValue::Constant(
                    Constant::Undefined | Constant::Null | Constant::Boolean(false),
                ) => false,
                FoldedValue::Constant(Constant::Boolean(true)) => true,
                FoldedValue::Constant(Constant::Number(number)) => {
                    number != 0.0 && !number.is_nan()
                }
                _ => return None,
            },
        };
        let has_marker = !passes_over_marker
            && self.is_commonjs(target)
            && (context.marker)(target) == Some(true)
            && (asks_for_marker_alone || self.has_name_once_run(target, known::default));
        Some(CopiedExports {
            has_marker,
            may_hold_answer: is_ordinary_object && (asks_for_marker_alone || passes_over_marker),
            ..copy
        })
    }

    // Whether each helper that the helper binds a name with defines a getter, or hands on a property that cannot change: none copies the value of the moment.
    fn binds_getters(&self, helper: &KnownFunction) -> bool {
        let helpers = self.context.known_helpers;
        helper.references.iter().all(|reference| match *reference {
            KnownReference::Helper { symbol, .. } => {
                let values = helpers.binding(self.file, symbol);
                values.is_some_and(|values| {
                    values.functions.iter().all(|held| {
                        let known = helpers.function(self.file, held.definition);
                        known.is_some_and(|it| it.shape != HelperShape::CreateBindingCopiesValue)
                    })
                })
            }
            KnownReference::Global { .. } => true,
        })
    }

    // `a.default` and `a.n`, where `a` holds the copy of an answer of which the text does not say that it has the marker. `Some(true)`: nothing else is to be bound.
    fn bind_member_of_answer(
        &mut self,
        holder: ExprId,
        member: ExprId,
        name: Atom,
        module: ModuleRef,
        is_star: bool,
    ) -> Option<bool> {
        let (hir, bound) = (self.hir, self.bound);
        let Binding::Symbol(holder) = bound.binding(hir.skip_type_assertions(holder)) else {
            return None;
        };
        let is_called = is_callee(hir, bound, member);
        if name == known::default {
            // What `require` answered, unless the run finds the marker on it.
            if is_star || is_called {
                return None;
            }
            let whole = AnswerMember { holder, name: None };
            self.imports.answer_members.push((member, whole));
            return Some(true);
        }
        // The copy has a getter for a name only where the answer has the name when the copy is made, which the run asks the answer. A name of which the build cannot say that the answer has it is left to the copy.
        let has_name = match module {
            ModuleRef::Runtime(module) => self.is_member_of_runtime_module(module, name),
            _ => self.has_name_once_run(module, name),
        };
        if !has_name {
            return None;
        }
        let named = AnswerMember {
            holder,
            name: Some(name),
        };
        self.imports.answer_members.push((member, named));
        if is_called {
            self.imports.copies_called_through.push(holder);
        }
        Some(is_star || matches!(module, ModuleRef::Runtime(_)))
    }

    // A `const`, `let` or `var` that is declared once, never stored to again, not exported and not seen by `eval`.
    fn find_holder(&self, pattern: PatId) -> Option<SymbolId> {
        let bound = self.bound;
        if !matches!(self.hir[pattern].kind, PatKind::Ident(_)) {
            return None;
        }
        let holder = bound.declared_symbol(Decl::Var(pattern));
        let is_holder = holder.is_some()
            && bound.is_stable_binding(holder)
            && !self.is_exported(holder)
            && !bound.is_visible_to_eval(holder);
        is_holder.then_some(holder)
    }

    // `const { a, b: c = d } = require(K)` reads the names once, at that point.
    fn bind_pattern(&mut self, pattern: PatId, answer: StandsFor) -> bool {
        let hir = self.hir;
        let PatKind::Object(properties) = hir[pattern].kind else {
            return false;
        };
        let mut members = Vec::new();
        for property in properties.iter().map(|id| hir[id]) {
            let PropKey::Name(name) = property.key else {
                return false;
            };
            if property.is_rest {
                return false;
            }
            match self.resolve_member(answer, name) {
                // A namespace or a built-in object behind the name is no variable that a copy could be taken of.
                Some(NamedMember::Binding(binding)) if !has_variable(binding) => return false,
                Some(found) => members.push(((answer.module(), name), found)),
                None => return false,
            }
        }
        self.imports.named_members.extend(members);
        true
    }

    // What a read of the name finds. `None`: only the object knows.
    fn resolve_member(&self, stands_for: StandsFor, name: Atom) -> Option<NamedMember> {
        let module = stands_for.module();
        let is_exports = match stands_for {
            StandsFor::ImportedNamespace(_) | StandsFor::RequiredNamespace(_) => false,
            StandsFor::Exports(_) | StandsFor::Copy { .. } => true,
        };
        let context = self.context;
        if is_exports && !is_plain_name(&context.files.atoms, context.builtin_names, name) {
            return None;
        }
        // A name that the module gets later has no getter.
        if matches!(stands_for, StandsFor::Copy { .. })
            && name != known::__esModule
            && !self.has_name_once_run(module, name)
        {
            return None;
        }
        if name == known::__esModule {
            // An ES module may export the name itself.
            if let StandsFor::RequiredNamespace(_) = stands_for
                && let Ok((binding, None)) = self.resolve_name(module, name)
            {
                return Some(NamedMember::Binding(binding));
            }
            return match stands_for {
                StandsFor::RequiredNamespace(_)
                | StandsFor::Exports(_)
                | StandsFor::Copy { .. } => {
                    let marker = (context.marker)(module)?;
                    Some(NamedMember::Fixed(Member::Marker(marker)))
                }
                StandsFor::ImportedNamespace(_) => None,
            };
        }
        let resolved = match stands_for {
            StandsFor::ImportedNamespace(_) if self.is_hidden_from_namespace(module, name) => {
                return None;
            }
            StandsFor::ImportedNamespace(_) => self.resolve_name(module, name),
            StandsFor::RequiredNamespace(_) | StandsFor::Exports(_) | StandsFor::Copy { .. } => {
                self.resolve_required_name(module, name)
            }
        };
        match resolved {
            Ok((binding, None)) => {
                (!is_exports || has_variable(binding)).then_some(NamedMember::Binding(binding))
            }
            // The namespace object of a module whose names are all known has no such property.
            Err(_) if matches!(stands_for, StandsFor::RequiredNamespace(_)) => {
                Some(NamedMember::Fixed(Member::Undefined))
            }
            Ok(_) | Err(_) => None,
        }
    }

    // The member that the reference is the object of, and what that member stands for in its turn.
    fn bind_enclosing_member(
        &mut self,
        reference: ExprId,
        stands_for: StandsFor,
    ) -> Option<(ExprId, Option<StandsFor>)> {
        let (hir, bound) = (self.hir, self.bound);
        let (member, name) = enclosing_member(hir, bound, reference)?;
        let is_stored = is_assignment_target(hir, bound, member);
        let module = stands_for.module();
        let is_copy = matches!(stands_for, StandsFor::Copy { .. });
        let is_exports = is_copy || matches!(stands_for, StandsFor::Exports(_));
        if is_deleted(hir, bound, member) || (is_exports && !is_link_of_no_chain(hir, member)) {
            return None;
        }
        // A getter takes no store.
        if is_copy && is_stored {
            return None;
        }
        match stands_for {
            StandsFor::Copy {
                has_marker: false,
                is_star,
                ..
            } => {
                if self.bind_member_of_answer(reference, member, name, module, is_star)? {
                    return Some((member, None));
                }
            }
            StandsFor::Copy { .. } => {
                if is_callee(hir, bound, member)
                    && let Binding::Symbol(holder) =
                        bound.binding(hir.skip_type_assertions(reference))
                {
                    self.imports.copies_called_through.push(holder);
                }
            }
            StandsFor::ImportedNamespace(_)
            | StandsFor::RequiredNamespace(_)
            | StandsFor::Exports(_) => {}
        }
        let binding = match self.resolve_member(stands_for, name)? {
            NamedMember::Fixed(fixed) if is_stored => {
                if matches!(fixed, Member::Marker(_)) {
                    self.imports.stored_markers.push(module);
                }
                return None;
            }
            NamedMember::Fixed(fixed) => {
                self.imports.fixed_members.push((member, (module, fixed)));
                return Some((member, None));
            }
            NamedMember::Binding(binding) => binding,
        };
        if is_stored {
            // The namespace object refuses a store, and so does a name that stands for a name of another module.
            let has_own_variable = matches!(binding, PendingBinding::Synthetic { module: owner, .. } if owner == module);
            if !is_exports || !has_own_variable || !is_stored_directly(hir, bound, member) {
                return None;
            }
        }
        self.imports.members.push((member, binding));
        let is_imported = matches!(stands_for, StandsFor::ImportedNamespace(_));
        let accessed = AccessedModule {
            module,
            is_imported,
        };
        self.imports.accessed.push((member, accessed));
        if is_callee(hir, bound, member) {
            match binding {
                PendingBinding::Synthetic {
                    module: owner,
                    name,
                } if is_exports => self.imports.called_members.push((module, owner, name)),
                _ if is_imported && self.is_commonjs(module) => {
                    self.imports.called_namespace_members.push((module, name));
                }
                _ => {}
            }
        }
        let inner = eager_namespace_module(binding).map(|inner| match stands_for {
            StandsFor::RequiredNamespace(_) => StandsFor::RequiredNamespace(inner),
            _ => StandsFor::ImportedNamespace(inner),
        });
        Some((member, inner))
    }

    // Whether something looks at the object: no member around the reference is bound, and more counts than that it is an object.
    fn bind_member_path(&mut self, mut reference: ExprId, mut stands_for: StandsFor) -> bool {
        let mut is_member_bound = false;
        while let Some((member, inner)) = self.bind_enclosing_member(reference, stands_for) {
            is_member_bound = true;
            let Some(inner) = inner else {
                return false;
            };
            (reference, stands_for) = (member, inner);
        }
        if is_member_bound {
            // `ns.inner`, where something looks at the namespace that `inner` is.
            self.look_at(stands_for);
            return false;
        }
        !self.is_only_tested(reference)
    }

    fn is_null_or_undefined(&self, expression: ExprId) -> bool {
        let expression = self.hir.skip_type_assertions(expression);
        matches!(
            self.analysis.decisions.constant(self.hir, expression),
            FoldedValue::Constant(Constant::Undefined | Constant::Null)
        )
    }

    // Of an object `true` in its place gives the same.
    fn is_only_tested(&self, expression: ExprId) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        let tested = find_outermost_type_assertion(hir, bound, expression);
        match bound.parent_of_expr(tested) {
            Parent::Expr(user) if user.is_some() => match hir[user].kind {
                ExprKind::Unary { op: UnOp::Not, .. } => true,
                ExprKind::Cond { test, .. } => test == tested,
                ExprKind::Binary {
                    op: BinOp::And,
                    left,
                    ..
                } => left == tested,
                ExprKind::Binary {
                    op: BinOp::EqEq | BinOp::NotEq | BinOp::EqEqEq | BinOp::NotEqEq,
                    left,
                    right,
                } => self.is_null_or_undefined(if left == tested { right } else { left }),
                _ => false,
            },
            Parent::Stmt(statement) => match hir[statement].kind {
                StmtKind::If { test, .. }
                | StmtKind::While { test, .. }
                | StmtKind::DoWhile { test, .. }
                | StmtKind::For { test, .. } => test == tested,
                _ => false,
            },
            _ => false,
        }
    }
}

fn has_variable(binding: PendingBinding) -> bool {
    matches!(
        binding,
        PendingBinding::Synthetic { .. } | PendingBinding::Bound(ImportBinding::Variable(_))
    )
}

fn add_holder(
    roots: &mut Vec<Root>,
    holders: &mut Vec<Holder>,
    symbol: SymbolId,
    call: ExprId,
    view: View,
    stands_for: StandsFor,
    copy: Option<CopiedExports>,
) {
    roots.push(Root {
        symbol,
        stands_for,
        holder: Some(holders.len()),
    });
    holders.push(Holder {
        symbol,
        call,
        view,
        is_needed_as_value: false,
        copy,
    });
}

fn imported_module(binding: PendingBinding) -> Option<StandsFor> {
    match binding {
        PendingBinding::Bound(ImportBinding::Exports { module }) => {
            Some(StandsFor::Exports(module))
        }
        _ => eager_namespace_module(binding).map(StandsFor::ImportedNamespace),
    }
}

fn eager_namespace_module(binding: PendingBinding) -> Option<ModuleRef> {
    match binding {
        PendingBinding::Bound(ImportBinding::Namespace { module, phase }) => match phase {
            ImportPhase::Evaluation => Some(module),
            ImportPhase::Defer => None,
        },
        PendingBinding::Bound(
            ImportBinding::Local
            | ImportBinding::Unused
            | ImportBinding::Unbound
            | ImportBinding::Variable(_)
            | ImportBinding::Builtin(_)
            | ImportBinding::CapturedBuiltin { .. }
            | ImportBinding::BuiltinMember { .. }
            | ImportBinding::Synthetic(_)
            | ImportBinding::NamespaceRead { .. }
            | ImportBinding::Exports { .. },
        )
        | PendingBinding::Synthetic { .. }
        | PendingBinding::CapturedBuiltin { .. } => None,
    }
}

/// An object finds the other names without having them, or keeps what is stored under them elsewhere.
pub(super) fn is_plain_name(atoms: &Interner<'_>, names: &BuiltinNames, name: Atom) -> bool {
    let is_index = atoms.bytes(name).first().is_some_and(u8::is_ascii_digit);
    let is_inherited = names
        .get(name)
        .is_some_and(|name| table::own_member(BuiltinId::ObjectPrototype, name).is_some());
    !is_index && !is_inherited && name != known::__proto__
}

pub(super) fn find_outermost_type_assertion(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    operand: ExprId,
) -> ExprId {
    let mut outermost = operand;
    while let Parent::Expr(parent) = bound.parent_of_expr(outermost)
        && hir.type_assertion_operand(parent) == Some(outermost)
    {
        outermost = parent;
    }
    outermost
}

fn enclosing_member(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    object: ExprId,
) -> Option<(ExprId, Atom)> {
    let object = find_outermost_type_assertion(hir, bound, object);
    let Parent::Expr(member) = bound.parent_of_expr(object) else {
        return None;
    };
    match hir.member_key(member) {
        Some((member_object, MemberKey::Name(name))) if member_object == object => {
            Some((member, name))
        }
        Some((_, MemberKey::Name(_) | MemberKey::PrivateName(_) | MemberKey::Computed(_)))
        | None => None,
    }
}

fn is_assignment_target(hir: &hir::File<'_>, bound: &Bound<'_>, member: ExprId) -> bool {
    let target = find_outermost_type_assertion(hir, bound, member);
    bound.get_assignment_target(hir, target).is_some()
}

// `a.n = v`, `a.n += v`, `a.n++`: no part of a pattern, and not the head of a loop.
fn is_stored_directly(hir: &hir::File<'_>, bound: &Bound<'_>, member: ExprId) -> bool {
    let target = find_outermost_type_assertion(hir, bound, member);
    let Parent::Expr(user) = bound.parent_of_expr(target) else {
        return false;
    };
    match hir[user].kind {
        ExprKind::Assign {
            target: assigned, ..
        } => assigned == target && !bound.is_shorthand_property_assignment(hir, user),
        ExprKind::Unary {
            op: UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec,
            ..
        } => true,
        _ => false,
    }
}

fn is_link_of_no_chain(hir: &hir::File<'_>, member: ExprId) -> bool {
    let (ExprKind::Dot { chain, .. } | ExprKind::Index { chain, .. }) = hir[member].kind else {
        return false;
    };
    chain == Chain::No
}

// The object says whether it lets the name go.
fn is_deleted(hir: &hir::File<'_>, bound: &Bound<'_>, member: ExprId) -> bool {
    let outermost = find_outermost_type_assertion(hir, bound, member);
    matches!(bound.parent_of_expr(outermost), Parent::Expr(user)
        if user.is_some() && matches!(hir[user].kind, ExprKind::Unary { op: UnOp::Delete, .. }))
}

// The object would be `this`.
fn is_callee(hir: &hir::File<'_>, bound: &Bound<'_>, member: ExprId) -> bool {
    let outermost = find_outermost_type_assertion(hir, bound, member);
    let Parent::Expr(user) = bound.parent_of_expr(outermost) else {
        return false;
    };
    match hir[user].kind {
        ExprKind::Call(call) | ExprKind::TaggedTemplate(call) => hir[call].callee == outermost,
        _ => false,
    }
}
