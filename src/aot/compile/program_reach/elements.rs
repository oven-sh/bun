use core::mem::replace;

use bun_sema::bind::Parent;
use bun_sema::hir::{ExprKind, FnId, StmtKind};
use bun_sema::import_sites::{ImportSiteKind, JsxCallee, JsxImport, jsx_callee};
use bun_sema::util::SharedSort;
use rustc_hash::FxHashSet;
use smallvec::SmallVec;

use super::{FileScan, Interest, Part, TOP_LEVEL, runs_when_imported};
use crate::modules::{ExportBinding, ModuleKind, ModuleRef, SiteAnswer};

impl FileScan<'_, '_> {
    pub(super) fn add_imports_of_elements(&mut self) {
        let graph = self.input.graph;
        for site in [ImportSiteKind::JsxRuntime, ImportSiteKind::JsxPackage] {
            let bindings = graph.jsx_bindings(self.file).iter();
            let interests: SmallVec<[Interest; 4]> = bindings
                .filter(|(import, _)| import.site_kind() == site)
                .filter_map(|&(_, binding)| self.interest_in_import(binding, None, None))
                .collect();
            let target = self.find_module_asked_for_elements_alone(site);
            let dropped = target.and_then(|target| {
                let statements = self.find_statements_dropped_with_elements(site)?;
                Some((target, statements))
            });
            let Some((target, statements)) = dropped else {
                self.units.interests[TOP_LEVEL as usize].extend(interests);
                continue;
            };
            let request = Interest::Request(target);
            self.units.interests[TOP_LEVEL as usize].retain(|&interest| interest != request);
            for statement in statements {
                let of_statement = &mut self.units.interests[statement as usize];
                of_statement.extend(interests.iter().copied());
                if runs_when_imported(graph, target) {
                    of_statement.push(request);
                }
                (self.units.statements_with_elements).push((statement, target));
            }
        }
    }

    fn find_module_asked_for_elements_alone(&self, site: ImportSiteKind) -> Option<ModuleRef> {
        let (graph, file) = (self.input.graph, self.file);
        if self.input.removable.has_no_bundle
            || graph.kind(file) != ModuleKind::SourceText
            || graph.load_failure(file).is_some()
        {
            return None;
        }
        let answer_of = |site: ImportSiteKind| match graph.find_site_answer(file, site) {
            Some(SiteAnswer::Module(module)) => Some(module),
            _ => None,
        };
        let target = answer_of(site)?;
        let mut sites = self.input.files.analysis(file).import_sites.iter();
        let is_asked_otherwise = sites.any(|other| {
            let is_statement = matches!(
                other.kind,
                ImportSiteKind::JsxRuntime
                    | ImportSiteKind::JsxPackage
                    | ImportSiteKind::Import(_)
                    | ImportSiteKind::ExportFrom(_)
                    | ImportSiteKind::ExportStar(_)
            );
            is_statement && other.kind != site && answer_of(other.kind) == Some(target)
        });
        let mut required = graph.required_names(file).iter();
        let link_would_miss_name = !matches!(target, ModuleRef::External { .. })
            && required.any(|it| it.module == target && !self.has_found(it));
        (!is_asked_otherwise && !link_would_miss_name).then_some(target)
    }

    fn find_statements_dropped_with_elements(
        &self,
        site: ImportSiteKind,
    ) -> Option<SmallVec<[u32; 4]>> {
        let (hir, bound) = (self.hir, self.bound);
        let decisions = &self.input.files.analysis(self.file).decisions;
        let mode = self.input.files.compiled(self.file)?.jsx_mode;
        let mut statements: SmallVec<[u32; 4]> = SmallVec::new();
        for expression in self.expressions() {
            let ExprKind::Jsx(element) = hir[expression].kind else {
                continue;
            };
            if bound.parent_of_expr(expression) == Parent::None
                || decisions.is_dead_expr(expression)
            {
                continue;
            }
            let callee = match jsx_callee(hir, mode, element) {
                JsxCallee::Import(import) => Some(import),
                JsxCallee::Factory => None,
            };
            let fragment = hir[element].tag.is_none().then_some(JsxImport::Fragment);
            let mut imports = callee.into_iter().chain(fragment);
            if !imports.any(|import| import.site_kind() == site) {
                continue;
            }
            let last_position = hir[expression].end.saturating_sub(1);
            let statement = self.region_below_body(self.region_of(last_position));
            if statement == TOP_LEVEL {
                return None;
            }
            if !statements.contains(&statement) {
                statements.push(statement);
            }
        }
        let is_dropped = !statements.is_empty() && !self.may_bundler_keep_any(&statements);
        is_dropped.then_some(statements)
    }

    fn may_bundler_keep_any(&self, statements: &[u32]) -> bool {
        let (hir, bound, units) = (self.hir, self.bound, &self.units);
        let region_count = units.units.len() as u32 + 1;
        let statement_of: Vec<u32> = (0..region_count)
            .map(|region| self.region_below_body(region))
            .collect();
        let declared: FxHashSet<FnId> = (hir.ids(hir.body))
            .filter_map(|statement| match hir[statement].kind {
                StmtKind::Fn(function) => Some(function),
                _ => None,
            })
            .collect();
        let mut stays = vec![false; region_count as usize];
        stays[TOP_LEVEL as usize] = true;
        for (region, unit) in (1..).zip(&units.units) {
            let goes_unless_named = unit.class_checks.is_none()
                && match unit.part {
                    Part::Declarator(_) | Part::Class(_) => true,
                    Part::Statement(statement) => matches!(hir[statement].kind, StmtKind::Expr(_)),
                    Part::Bodies => matches!(unit.functions[..], [it] if declared.contains(&it)),
                    Part::InnerModule(_) => false,
                };
            if statement_of[region] == region as u32
                && (unit.region_around != TOP_LEVEL || !goes_unless_named)
            {
                stays[region] = true;
            }
        }
        for export in self.input.graph.exports(self.file) {
            if let ExportBinding::Variable(defined) = export.binding
                && defined.file == self.file
                && let Some(unit) = units.find_unit(hir, bound, defined.id)
            {
                stays[statement_of[unit as usize + 1] as usize] = true;
            }
        }
        let is_kept = |stays: &[bool]| statements.iter().any(|&it| stays[it as usize]);
        if is_kept(&stays) {
            return true;
        }
        let mut names: Vec<(u32, u32)> = Vec::new();
        for (region, interests) in units.interests.iter().enumerate() {
            let named = interests
                .iter()
                .filter_map(|&it| self.find_unit_named_by(it));
            names.extend(named.map(|unit| (statement_of[region], statement_of[unit as usize + 1])));
        }
        names.shared_sort_unstable();
        names.dedup();
        let mut pending: Vec<u32> = (0..region_count).filter(|&it| stays[it as usize]).collect();
        while let Some(naming) = pending.pop() {
            let first = names.partition_point(|&(from, _)| from < naming);
            let named = names[first..]
                .iter()
                .take_while(|&&(from, _)| from == naming);
            for &(_, statement) in named {
                if !replace(&mut stays[statement as usize], true) {
                    pending.push(statement);
                }
            }
        }
        is_kept(&stays)
    }

    fn find_unit_named_by(&self, interest: Interest) -> Option<u32> {
        match interest {
            Interest::Unit(unit) | Interest::Piece(unit) => Some(unit),
            Interest::Binding(defined)
            | Interest::TestedBinding(defined)
            | Interest::CalledBinding(defined, _)
            | Interest::KnownMember(defined)
            | Interest::KnownVariable(defined)
            | Interest::Lookup(defined)
            | Interest::HandedOnObject(defined)
                if defined.file == self.file =>
            {
                self.units.find_unit(self.hir, self.bound, defined.id)
            }
            _ => None,
        }
    }
}
