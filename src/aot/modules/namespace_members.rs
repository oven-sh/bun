use super::bindings::{
    AccessedModule, AnswerMember, CopiedExports, Holder, ImportBinding, ShownNames,
};
use super::imports::{FileBinder, NamedMember, PendingBinding};
use super::interop::{ImportPhase, ModuleKind};
use super::order::{PlannedSite, SiteKey, SitePosition};
use super::plan::{Member, ModuleRef, View};
use super::wrapped::InnerModuleKind;
use crate::builtins::table;
use crate::known_helpers::{Helper, KnownFunction, KnownReference, Shape as HelperShape};
use crate::load::sources::parsed_source;
use bun_sema::atom::{Atom, known};
use bun_sema::bind::{Binding, Bound, Decl, InitialState, Parent, SymbolId};
use bun_sema::fold::{Constant, FoldedValue};
use bun_sema::hir::{
    self, BinOp, Chain, ExprId, ExprKind, MemberKey, NodeData, PatId, PatKind, PropKey, StmtKind,
    UnOp, VarDeclId, VarKind,
};
use bun_sema::util::{FxHashSet, SharedSort};

#[derive(Copy, Clone)]
struct Root {
    symbol: SymbolId,
    stands_for: StandsFor,
    holder: Option<u32>,
}

#[derive(Copy, Clone)]
pub(super) enum StandsFor {
    ImportedNamespace(ModuleRef),
    RequiredNamespace(ModuleRef),
    Exports(ModuleRef),
    Copy {
        module: ModuleRef,
        has_marker: bool,
        is_star: bool,
    },
}

impl StandsFor {
    pub(super) fn module(self) -> ModuleRef {
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
        let imports = &mut self.imports;
        imports.holders = holders;
        imports
            .unread_sites
            .shared_sort_unstable_by_key(|&(call, _)| call);
        imports
            .accessed
            .shared_sort_unstable_by_key(|&(member, _)| member);
        imports
            .fixed_members
            .shared_sort_unstable_by_key(|&(member, _)| member);
    }

    fn settle_copies(&mut self, holders: &mut [Holder]) {
        let mut called_through = core::mem::take(&mut self.imports.copies_called_through);
        called_through.shared_sort_unstable();
        let members = &mut self.imports.answer_members;
        members.shared_sort_unstable_by_key(|&(member, _)| member);
        let read_whole = members.iter().filter(|it| it.1.name.is_none());
        let mut read_whole: Vec<SymbolId> = read_whole.map(|it| it.1.holder).collect();
        read_whole.shared_sort_unstable();
        let names = members.iter();
        let mut names: Vec<(SymbolId, Atom)> = names
            .filter_map(|&(_, member)| Some((member.holder, member.name?)))
            .collect();
        names.shared_sort_by_key(|&(holder, _)| holder);
        let mut seen = FxHashSet::default();
        names.retain(|&name| seen.insert(name));
        self.imports.names_read_on_answers = names;
        for holder in holders.iter_mut() {
            let Some(copy) = &mut holder.copy else {
                continue;
            };
            copy.is_called_through = called_through.binary_search(&holder.symbol).is_ok();
            if copy.passes_marked_answer_on || read_whole.binary_search(&holder.symbol).is_ok() {
                holder.is_needed_as_value = true;
                let (View::Namespace(module) | View::Exports(module)) = holder.view;
                self.look_at(StandsFor::Exports(module));
            }
        }
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
        for binding in analysis.bindings_read_without_expression(hir, bound) {
            if let Some(position) = find_root(roots, binding) {
                self.look_at_root(roots[position], holders);
            }
        }
        let source = parsed_source(self.context.files, self.file);
        let spies = source.into_iter().flat_map(|it| it.builtins.spy_calls());
        let mut objects_of_spies: Vec<ExprId> = spies.map(|spy| spy.object).collect();
        objects_of_spies.shared_sort_unstable();
        let mut is_used_as_value = vec![false; roots.len()];
        let mut is_handed_out = vec![false; roots.len()];
        for reference in (0..hir.exprs.len() as u32).map(ExprId) {
            if !bound.is_evaluated_ident(reference) {
                continue;
            }
            let Some(position) = find_root(roots, bound.binding(reference)) else {
                continue;
            };
            if analysis.decisions.is_dead_expr(reference) || bound.is_in_type_query(reference) {
                continue;
            }
            let root = roots[position];
            let is_resolved_at_run_time = bound
                .dynamic_lookup_scope(NodeData::Expr(reference))
                .is_some();
            let is_value =
                is_resolved_at_run_time || self.bind_member_path(reference, root.stands_for);
            if !is_value {
                continue;
            }
            if !core::mem::replace(&mut is_used_as_value[position], true) {
                self.look_at_root(root, holders);
            }
            let is_taken_by_spy =
                !is_resolved_at_run_time && objects_of_spies.binary_search(&reference).is_ok();
            if !is_taken_by_spy
                && !core::mem::replace(&mut is_handed_out[position], true)
                && let StandsFor::ImportedNamespace(module) | StandsFor::RequiredNamespace(module) =
                    root.stands_for
            {
                self.imports.namespaces_handed_out.push(module);
            }
        }
    }

    fn look_at_root(&mut self, root: Root, holders: &mut [Holder]) {
        if let Some(holder) = root.holder {
            let holder = &mut holders[holder as usize];
            holder.is_needed_as_value = true;
            if let Some(copy) = &mut holder.copy {
                copy.is_looked_at = true;
            }
        }
        self.look_at(root.stands_for);
    }

    pub(super) fn look_at(&mut self, stands_for: StandsFor) {
        let module = stands_for.module();
        let is_namespace = match stands_for {
            StandsFor::ImportedNamespace(_) | StandsFor::RequiredNamespace(_) => true,
            StandsFor::Exports(_) | StandsFor::Copy { .. } => false,
        };
        if is_namespace && self.namespace_value_set.insert(module) {
            self.imports.namespace_values.push(module);
        }
        if self.is_commonjs(module) && self.exports_value_set.insert(module) {
            self.imports.exports_values.push(module);
        }
    }

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

    fn is_dead_site(&self, site: &PlannedSite) -> bool {
        let decisions = &self.analysis.decisions;
        match site.key {
            SiteKey::Call(call) => decisions.is_dead_expr(call),
            SiteKey::ImportEquals(declaration) => {
                decisions.is_dead_stmt(self.hir[declaration].stmt)
            }
        }
    }

    fn bind_site(&mut self, site: &PlannedSite, roots: &mut Vec<Root>, holders: &mut Vec<Holder>) {
        if self.is_dead_site(site) {
            return;
        }
        let (context, target) = (self.context, site.target);
        if self.is_esm_wrapper(target) {
            return;
        }
        let (answer, view) = match context.modules.interop(target).kind {
            ModuleKind::SourceText => (
                StandsFor::RequiredNamespace(target),
                View::Namespace(target),
            ),
            _ => (StandsFor::Exports(target), View::Exports(target)),
        };
        let may_answer_another_object = context.evicted.is_stored_in_cache(target)
            || (context.order.is_code_of_program(target)
                && (context.evicted.contains(target)
                    || context.mocked.contains(target)
                    || (context.modules.interop(target).kind != ModuleKind::CommonJs
                        && context.evicted.is_table_reached())));
        if may_answer_another_object {
            return self.look_at(answer);
        }
        if self.bind_copy(site, view, roots, holders) {
            return;
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
        if let Some(symbol) = self.find_holder_of_marked_module(call, answer) {
            self.imports.unread_sites.push((call, false));
            return add_holder(roots, holders, symbol, call, view, answer, None);
        }
        let (hir, bound) = (self.hir, self.bound);
        match bound.parent_of_expr(find_outermost_type_assertion(hir, bound, call)) {
            Parent::VarInit(declaration) => {
                if let Some(symbol) = self.find_holder_declared_by(declaration) {
                    self.imports.unread_sites.push((call, false));
                    return add_holder(roots, holders, symbol, call, view, answer, None);
                }
                if self.bind_pattern(hir[declaration].pat, answer) {
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
            false => self.imports.unread_sites.push((call, false)),
        }
    }

    fn is_marked(&self, answer: StandsFor) -> bool {
        let module = answer.module();
        (self.context.marker)(module) == Some(true)
            && match answer {
                StandsFor::RequiredNamespace(_) => {
                    self.resolve_name(module, known::__esModule).is_err()
                }
                StandsFor::Exports(_) => true,
                StandsFor::ImportedNamespace(_) | StandsFor::Copy { .. } => false,
            }
    }

    fn find_holder_of_marked_module(
        &self,
        required: ExprId,
        answer: StandsFor,
    ) -> Option<SymbolId> {
        let (hir, bound, context) = (self.hir, self.bound, self.context);
        let operand = find_outermost_type_assertion(hir, bound, required);
        let written = parent_expression(bound, operand)?;
        let ExprKind::Call(call) = hir[written].kind else {
            return None;
        };
        let call = hir[call];
        if call.chain != Chain::No
            || call.args.len() != 1
            || hir.id_at::<ExprId>(call.args, 0) != operand
            || !self.is_marked(answer)
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
        self.find_holder_declared_by(declaration)
    }

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
        if !site.is_proven {
            return false;
        }
        let Some(copy) = self.find_copy(site, call) else {
            return false;
        };
        let Parent::VarInit(declaration) =
            bound.parent_of_expr(find_outermost_type_assertion(hir, bound, copy.written))
        else {
            return false;
        };
        let Some(symbol) = self.find_holder_declared_by(declaration) else {
            return false;
        };
        if site.evaluates {
            self.imports.unread_sites.push((call, false));
        }
        let stands_for = StandsFor::Copy {
            module: site.target,
            has_marker: copy.has_marker,
            is_star: copy.passes_marked_answer_on,
        };
        add_holder(roots, holders, symbol, call, view, stands_for, Some(copy));
        true
    }

    fn find_copy(&self, site: &PlannedSite, required: ExprId) -> Option<CopiedExports> {
        let (hir, bound, context) = (self.hir, self.bound, self.context);
        let target = site.target;
        let required = find_outermost_type_assertion(hir, bound, required);
        let written = parent_expression(bound, required)?;
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
            ModuleRef::Runtime(_) => {
                !context.mocked.contains(target) && !context.evicted.is_table_reached()
            }
            _ => self.exports_ordinary_object(target),
        };
        let is_marked = self.is_commonjs(target) && (context.marker)(target) == Some(true);
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
            && is_marked
            && (asks_for_marker_alone || self.has_name_once_run(target, known::default));
        Some(CopiedExports {
            has_marker,
            may_hold_answer: is_ordinary_object && (asks_for_marker_alone || passes_over_marker),
            ..copy
        })
    }

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
            KnownReference::Loaded { .. } => false,
        })
    }

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
            if is_star || is_called {
                return None;
            }
            let whole = AnswerMember { holder, name: None };
            self.imports.answer_members.push((member, whole));
            return Some(true);
        }
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

    fn find_holder_declared_by(&self, declaration: VarDeclId) -> Option<SymbolId> {
        if matches!(
            self.hir[declaration].kind,
            VarKind::Using | VarKind::AwaitUsing
        ) {
            return None;
        }
        self.find_holder(self.hir[declaration].pat)
    }

    pub(super) fn find_holder(&self, pattern: PatId) -> Option<SymbolId> {
        let bound = self.bound;
        if !matches!(self.hir[pattern].kind, PatKind::Ident(_)) {
            return None;
        }
        let holder = bound.declared_symbol(Decl::Var(pattern));
        let is_holder = holder.is_some()
            && bound.is_stable_binding(holder)
            && bound.dynamic_lookup_scope(NodeData::Pat(pattern)).is_none()
            && !self.is_exported(holder)
            && !bound.is_visible_to_eval(holder);
        is_holder.then_some(holder)
    }

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
                Some(NamedMember::Binding(binding)) if !has_variable(binding) => return false,
                Some(found) => members.push(((answer.module(), name), found)),
                None => return false,
            }
        }
        self.imports.named_members.extend(members);
        true
    }

    pub(super) fn resolve_member(&self, stands_for: StandsFor, name: Atom) -> Option<NamedMember> {
        let (context, module) = (self.context, stands_for.module());
        let is_copy = matches!(stands_for, StandsFor::Copy { .. });
        let is_exports = is_copy || matches!(stands_for, StandsFor::Exports(_));
        if is_exports && !context.input.is_plain_name(name) {
            return None;
        }
        if is_copy && name != known::__esModule && !self.has_name_once_run(module, name) {
            return None;
        }
        if name == known::__esModule {
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
            Err(_) if matches!(stands_for, StandsFor::RequiredNamespace(_)) => {
                Some(NamedMember::Fixed(Member::Undefined))
            }
            Ok(_) | Err(_) => None,
        }
    }

    fn may_be_undefined(&self, reference: ExprId) -> bool {
        let reference = self.hir.skip_type_assertions(reference);
        matches!(self.hir[reference].kind, ExprKind::Ident(_))
            && match self.bound.binding(reference) {
                Binding::Symbol(holder) => {
                    self.bound.initial_state(holder) == InitialState::Undefined
                }
                _ => false,
            }
    }

    fn bind_enclosing_member(
        &mut self,
        reference: ExprId,
        stands_for: StandsFor,
    ) -> Option<(ExprId, Option<StandsFor>)> {
        let (hir, bound) = (self.hir, self.bound);
        let (member, name) = enclosing_member(hir, bound, reference)?;
        let module = stands_for.module();
        let is_exports = matches!(stands_for, StandsFor::Exports(_) | StandsFor::Copy { .. });
        if is_assignment_target(hir, bound, member)
            || is_deleted(hir, bound, member)
            || (!is_outside_optional_chain(hir, member)
                && (is_exports || self.may_be_undefined(reference)))
        {
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
            NamedMember::Fixed(fixed) => {
                self.imports.fixed_members.push((member, (module, fixed)));
                return Some((member, None));
            }
            NamedMember::Binding(binding) => binding,
        };
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
            StandsFor::ImportedNamespace(_) | StandsFor::Exports(_) | StandsFor::Copy { .. } => {
                StandsFor::ImportedNamespace(inner)
            }
        });
        if let Some(inner) = inner
            && self.context.mocked.contains(module)
        {
            self.look_at(inner);
            return Some((member, None));
        }
        Some((member, inner))
    }

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

fn find_root(roots: &[Root], binding: Binding) -> Option<usize> {
    let Binding::Symbol(symbol) = binding else {
        return None;
    };
    let found = roots.binary_search_by_key(&symbol, |root| root.symbol);
    found.ok()
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
        holder: Some(holders.len() as u32),
    });
    holders.push(Holder {
        symbol,
        call,
        view,
        is_needed_as_value: false,
        copy,
    });
}

pub(super) fn imported_module(binding: PendingBinding) -> Option<StandsFor> {
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

fn parent_expression(bound: &Bound<'_>, expression: ExprId) -> Option<ExprId> {
    match bound.parent_of_expr(expression) {
        Parent::Expr(parent) => parent.some(),
        _ => None,
    }
}

pub(super) fn find_outermost_type_assertion(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    operand: ExprId,
) -> ExprId {
    let mut outermost = operand;
    while let Some(parent) = parent_expression(bound, outermost)
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
    let member = parent_expression(bound, object)?;
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

fn is_outside_optional_chain(hir: &hir::File<'_>, member: ExprId) -> bool {
    let (ExprKind::Dot { chain, .. } | ExprKind::Index { chain, .. }) = hir[member].kind else {
        return false;
    };
    chain == Chain::No
}

fn is_deleted(hir: &hir::File<'_>, bound: &Bound<'_>, member: ExprId) -> bool {
    let outermost = find_outermost_type_assertion(hir, bound, member);
    let user = parent_expression(bound, outermost);
    user.is_some_and(|user| {
        matches!(
            hir[user].kind,
            ExprKind::Unary {
                op: UnOp::Delete,
                ..
            }
        )
    })
}

fn is_callee(hir: &hir::File<'_>, bound: &Bound<'_>, member: ExprId) -> bool {
    let outermost = find_outermost_type_assertion(hir, bound, member);
    let Some(user) = parent_expression(bound, outermost) else {
        return false;
    };
    match hir[user].kind {
        ExprKind::Call(call) | ExprKind::TaggedTemplate(call) => hir[call].callee == outermost,
        _ => false,
    }
}
