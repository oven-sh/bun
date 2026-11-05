use super::entries::{ExportEntries, ExportEntry};
use super::{DynamicStarTargets, find_table};
use crate::modules::imports::{ImportedItem, MockedModules, imported_items};
use crate::modules::interop::ImportPhase;
use crate::modules::module_set::ModuleSet;
use crate::modules::namespace_members::find_outermost_type_assertion;
use crate::modules::requests::{ScannedSite, Scans};
use crate::modules::{BindInput, ModuleRef};
use bun_sema::atom::{Atom, known};
use bun_sema::bind::{Binding, Bound, Parent, SymbolId};
use bun_sema::hir::{self, ExprId, ExprKind, MemberKey, NodeData, UnOp};
use bun_sema::import_sites::ImportSiteKind;
use bun_sema::program::{CodeAnswer, FileId};
use bun_sema::resolve::ExternalKind;
use bun_sema::util::{FxHashMap, FxHashSet, SharedSort};

pub(super) struct Stars<'a> {
    pub edges: &'a [Vec<u32>],
    pub is_taken_by_star: &'a [bool],
    pub component_of: &'a [u32],
    pub components: &'a [Vec<usize>],
    pub dynamic_targets: &'a [DynamicStarTargets],
}

pub(super) struct AskedNames {
    is_whole: Vec<bool>,
    names: FxHashSet<Atom>,
    pub left_out: FxHashSet<Atom>,
}

impl AskedNames {
    pub(super) fn everything(component_count: usize) -> AskedNames {
        AskedNames {
            is_whole: vec![true; component_count],
            names: FxHashSet::default(),
            left_out: FxHashSet::default(),
        }
    }

    pub(super) fn contains(&self, component: usize, name: Atom) -> bool {
        self.is_whole[component] || self.names.contains(&name)
    }

    pub(super) fn is_whole(&self, component: usize) -> bool {
        self.is_whole[component]
    }

    pub(super) fn find(
        input: &BindInput<'_, '_>,
        scans: &Scans,
        modules: &ModuleSet,
        entries: &[ExportEntries],
        table_files: &[FileId],
        mocked: &MockedModules,
        stars: &Stars<'_>,
    ) -> AskedNames {
        let everything = || AskedNames::everything(stars.components.len());
        let mut externals = modules.external_kinds.iter();
        let code_out_of_sight_names_files = (input.runs_in_place
            || input.files_are_named_out_of_sight)
            && externals.any(|&(_, kind)| kind == ExternalKind::UncompiledCode);
        if entries.iter().all(|module| module.stars.is_empty())
            || input.runs_tests
            || input.mocks_any_module
            || input.hands_on_any_module
            || input.any_module_loads_again
            || code_out_of_sight_names_files
            || !mocked.is_empty()
        {
            return everything();
        }
        let files = input.files;
        let is_dynamic =
            |targets: &DynamicStarTargets| !matches!(targets, DynamicStarTargets::Empty);
        let mut is_whole: Vec<bool> = stars.dynamic_targets.iter().map(is_dynamic).collect();
        let component_of = |module: ModuleRef| {
            let table = find_table(table_files, ModuleRef::File(modules.table_file(module)?))?;
            Some(stars.component_of[table] as usize)
        };
        let mut names: FxHashSet<Atom> = [known::then, known::__esModule].into_iter().collect();
        names.extend(files.atoms.lookup(b"module.exports"));
        let mut owners: FxHashMap<Atom, u32> = FxHashMap::default();
        let mut more_than_variables: FxHashSet<Atom> = FxHashSet::default();
        let mut handed_on: Vec<Vec<u32>> = vec![Vec::new(); stars.components.len()];
        for (table, module) in entries.iter().enumerate() {
            let sites = &scans.of(module.file).sites;
            let is_among_stars = !module.stars.is_empty() || stars.is_taken_by_star[table];
            for &(name, entry) in &module.own {
                let is_variable = match entry {
                    ExportEntry::Local(_) => true,
                    ExportEntry::Indirect {
                        site, name: asked, ..
                    } => {
                        names.insert(asked);
                        if let ScannedSite::Module(target) = sites[site as usize]
                            && let Some(component) = component_of(target)
                        {
                            handed_on[stars.component_of[table] as usize].push(component as u32);
                        }
                        false
                    }
                    ExportEntry::Namespace { site }
                    | ExportEntry::ImportedNamespace { site, .. } => {
                        if let ScannedSite::Module(target) = sites[site as usize]
                            && let Some(component) = component_of(target)
                        {
                            is_whole[component] = true;
                        }
                        false
                    }
                };
                if !is_variable {
                    more_than_variables.insert(name);
                }
                if is_among_stars && (!is_variable || owners.insert(name, table as u32).is_some()) {
                    names.insert(name);
                }
            }
        }
        let written = input.sources.entry_points().iter().map(|it| it.file);
        for entry_point in written.chain(files.entry_points().iter().copied()) {
            if let Some(component) = component_of(ModuleRef::File(entry_point)) {
                is_whole[component] = true;
            }
        }
        let has_stars = |component: usize| {
            let mut members = stars.components[component].iter();
            members.any(|&member| !entries[member].stars.is_empty())
        };
        for &file in &modules.compiled_files {
            let (hir, bound, scan) = (files.hir(file), files.bound(file), scans.of(file));
            let mut namespaces: Vec<(SymbolId, usize)> = Vec::new();
            let mut may_hold_objects: Vec<(SymbolId, usize)> = Vec::new();
            let sites = files.analysis(file).import_sites.iter();
            for (site, scanned) in sites.zip(&scan.sites) {
                match (site.kind, scanned) {
                    (ImportSiteKind::ExportStar(_) | ImportSiteKind::ExportFrom(_), _)
                    | (_, ScannedSite::Unresolved | ScannedSite::Erased) => {}
                    (ImportSiteKind::Import(id), &ScannedSite::Module(target)) => {
                        for (declaration, item) in imported_items(files, hir, id) {
                            let symbol = bound.declared_symbol(declaration);
                            let phase = match item {
                                ImportedItem::Name { name, .. } => {
                                    names.insert(name);
                                    if more_than_variables.contains(&name)
                                        && symbol.is_some()
                                        && let Some(component) = component_of(target)
                                    {
                                        may_hold_objects.push((symbol, component));
                                    }
                                    continue;
                                }
                                ImportedItem::Namespace(phase) => phase,
                            };
                            let Some(component) = component_of(target) else {
                                continue;
                            };
                            let is_followed = phase == ImportPhase::Evaluation
                                && symbol.is_some()
                                && !bound.is_visible_to_eval(symbol);
                            match is_followed {
                                true => namespaces.push((symbol, component)),
                                false => is_whole[component] = true,
                            }
                        }
                    }
                    (_, &ScannedSite::Module(target)) => {
                        if let Some(component) = component_of(target) {
                            is_whole[component] = true;
                        }
                    }
                    (_, ScannedSite::Candidates(range)) => {
                        let spelled = &scan.spellings[range.start as usize..range.end as usize];
                        for component in spelled.iter().filter_map(|it| component_of(it.module)) {
                            is_whole[component] = true;
                        }
                    }
                    (_, ScannedSite::AllModules) => return everything(),
                }
            }
            for answer in files
                .compiled(file)
                .map_or(&[][..], |it| it.implied_answers)
            {
                if let CodeAnswer::File(target) = *answer
                    && let Some(component) = component_of(ModuleRef::File(target))
                {
                    is_whole[component] = true;
                }
            }
            namespaces.retain(|&(_, component)| !is_whole[component] && has_stars(component));
            may_hold_objects.retain(|&(_, component)| !is_whole[component] && has_stars(component));
            if !may_hold_objects.is_empty() {
                may_hold_objects.shared_sort_by_key(|&(symbol, _)| symbol);
                for reference in (0..hir.exprs.len() as u32).map(ExprId) {
                    if bound.is_evaluated_ident(reference)
                        && let Binding::Symbol(symbol) = bound.binding(reference)
                        && let Ok(position) =
                            may_hold_objects.binary_search_by_key(&symbol, |it| it.0)
                        && is_object_of_called_member(hir, bound, reference)
                    {
                        is_whole[may_hold_objects[position].1] = true;
                    }
                }
            }
            if !namespaces.is_empty() {
                namespaces.shared_sort_by_key(|&(symbol, _)| symbol);
                let analysis = files.analysis(file);
                let without_expression = analysis.bindings_read_without_expression(hir, bound);
                let mut look_at = |symbol: SymbolId| {
                    let found = namespaces.binary_search_by_key(&symbol, |&(symbol, _)| symbol);
                    if let Ok(position) = found {
                        is_whole[namespaces[position].1] = true;
                    }
                };
                for binding in without_expression {
                    if let Binding::Symbol(symbol) = binding {
                        look_at(symbol);
                    }
                }
                for reference in (0..hir.exprs.len() as u32).map(ExprId) {
                    if !bound.is_evaluated_ident(reference) {
                        continue;
                    }
                    let Binding::Symbol(symbol) = bound.binding(reference) else {
                        continue;
                    };
                    match find_name_read_off(hir, bound, reference) {
                        Some(name) if name != known::__esModule => {
                            let found = namespaces.binary_search_by_key(&symbol, |it| it.0);
                            if found.is_ok() {
                                names.insert(name);
                            }
                        }
                        Some(_) | None => look_at(symbol),
                    }
                }
            }
        }
        let mut followed: Vec<usize> = (0..is_whole.len()).filter(|&it| is_whole[it]).collect();
        while let Some(component) = followed.pop() {
            let members = stars.components[component].iter();
            let behind_stars = members.flat_map(|&member| &stars.edges[member]);
            let behind_stars = behind_stars.map(|&target| stars.component_of[target as usize]);
            for target in behind_stars.chain(handed_on[component].iter().copied()) {
                if !core::mem::replace(&mut is_whole[target as usize], true) {
                    followed.push(target as usize);
                }
            }
        }
        let left_out = owners.into_keys().filter(|name| !names.contains(name));
        AskedNames {
            left_out: left_out.collect(),
            is_whole,
            names,
        }
    }
}

fn is_object_of_called_member(hir: &hir::File<'_>, bound: &Bound<'_>, reference: ExprId) -> bool {
    let object = find_outermost_type_assertion(hir, bound, reference);
    let Parent::Expr(member) = bound.parent_of_expr(object) else {
        return false;
    };
    if hir
        .member_key(member)
        .is_none_or(|(holder, _)| holder != object)
    {
        return false;
    }
    let callee = find_outermost_type_assertion(hir, bound, member);
    let Parent::Expr(user) = bound.parent_of_expr(callee) else {
        return false;
    };
    match user.some().map(|user| hir[user].kind) {
        Some(ExprKind::Call(call) | ExprKind::TaggedTemplate(call)) => hir[call].callee == callee,
        Some(_) | None => false,
    }
}

fn find_name_read_off(hir: &hir::File<'_>, bound: &Bound<'_>, reference: ExprId) -> Option<Atom> {
    let Parent::Expr(member) = bound.parent_of_expr(reference) else {
        return None;
    };
    let (object, MemberKey::Name(name)) = hir.member_key(member)? else {
        return None;
    };
    let is_resolved_at_run_time = || {
        let scope = bound.dynamic_lookup_scope(NodeData::Expr(reference));
        scope.is_some()
    };
    let outermost = find_outermost_type_assertion(hir, bound, member);
    if object != reference
        || is_resolved_at_run_time()
        || bound.get_assignment_target(hir, outermost).is_some()
    {
        return None;
    }
    let Parent::Expr(user) = bound.parent_of_expr(outermost) else {
        return Some(name);
    };
    let is_only_read = match user.some().map(|user| hir[user].kind) {
        Some(ExprKind::Unary { op, .. }) => !matches!(
            op,
            UnOp::Delete | UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec
        ),
        Some(ExprKind::Assign { target, .. }) => target != outermost,
        Some(ExprKind::Call(call) | ExprKind::TaggedTemplate(call)) => {
            hir[call].callee != outermost
        }
        Some(_) | None => true,
    };
    is_only_read.then_some(name)
}
