use super::*;
use crate::bind::{Bound, FnOwner, MemberOwner, Parent};
use crate::hir::{ExprId, ExprKind, FnId};
use crate::module_format::ModuleFormat;
use crate::resolve::{CodeImportKind, ComputedResolution, SiteResolution};

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum LoadedBy {
    Require,
    ImportAlone,
    RequireAfterAll,
}

impl LoadedBy {
    pub(super) fn is_import_alone(self) -> bool {
        self == LoadedBy::ImportAlone
    }
}

fn loading_kind(site: ImportSiteKind) -> Option<CodeImportKind> {
    match site {
        ImportSiteKind::RequireResolve(_)
        | ImportSiteKind::ImportMetaResolve(_)
        | ImportSiteKind::MockModule(_) => None,
        _ => Some(CodeImportKind::from_site(site)),
    }
}

fn visit_named_files(
    file: &WalkedFile<'_, '_>,
    visit: &mut dyn FnMut(u32, Option<ImportSiteKind>),
) {
    let Some(parsed) = &file.parsed else {
        return;
    };
    let mut targets = file.targets.iter().copied();
    let sites = parsed.code.analyzed.analysis.import_sites;
    for (site, &resolution) in sites.iter().zip(&parsed.code.resolutions) {
        for target in targets.by_ref().take(files_of(resolution).count()) {
            if target != NOT_LOADED {
                visit(target, Some(site.kind));
            }
        }
    }
    for target in targets.filter(|&target| target != NOT_LOADED) {
        visit(target, None);
    }
}

fn visit_loaded_files(
    file: &WalkedFile<'_, '_>,
    visit: &mut dyn FnMut(u32, Option<CodeImportKind>),
) {
    visit_named_files(file, &mut |target, site| match site.map(loading_kind) {
        None => visit(target, None),
        Some(None) => {}
        Some(kind) => visit(target, kind),
    });
}

fn is_module(file: &WalkedFile<'_, '_>) -> bool {
    let parsed = file.parsed.as_ref();
    parsed.is_some_and(|it| it.code.analyzed.analysis.module_format == ModuleFormat::Esm)
}

#[derive(Clone)]
struct Behind {
    lowest: u32,
    amid_statements: Vec<u32>,
}

const BEHIND_NO_LOAD: Behind = Behind {
    lowest: NOT_LOADED,
    amid_statements: Vec::new(),
};

struct LoadOrder {
    above: Vec<u32>,
    left_at: Vec<u32>,
    importers: Vec<Vec<u32>>,
    imported_in_order: Vec<Vec<u32>>,
    loaders: Vec<Vec<u32>>,
    runs_amid_statements: Vec<bool>,
    may_be_mocked: Vec<bool>,
}

impl LoadOrder {
    fn any_file(&self) -> u32 {
        self.above.len() as u32 - 2
    }

    fn host(&self) -> u32 {
        self.above.len() as u32 - 1
    }

    fn new(context: &CodeLoadContext<'_, '_, '_>, state: &WalkState<'_, '_>) -> LoadOrder {
        let files = &state.files;
        let mut order = LoadOrder {
            above: vec![NOT_LOADED; files.len() + 2],
            left_at: vec![NOT_LOADED; files.len() + 2],
            importers: vec![Vec::new(); files.len() + 2],
            imported_in_order: vec![Vec::new(); files.len() + 2],
            loaders: Vec::new(),
            runs_amid_statements: vec![false; files.len() + 2],
            may_be_mocked: vec![false; files.len() + 2],
        };
        let (any_file, host) = (order.any_file(), order.host());
        let mut loads: Vec<Vec<u32>> = (files.iter())
            .map(|file| {
                let targets = file.targets.iter().copied();
                let mut loads: Vec<u32> = targets.filter(|&target| target != NOT_LOADED).collect();
                if loads_under_unknown_name(file) {
                    loads.push(any_file);
                }
                loads
            })
            .collect();
        loads.push((0..any_file).collect());
        let mut entry_points: Vec<u32> = Vec::new();
        for entry_point in &context.entry_points() {
            entry_points.push(state.index_of[&context.canonical_key(entry_point.key)]);
        }
        loads.push(entry_points);
        order.follow_statements(files, &loads);

        let mut in_order_left: Vec<u32> = Vec::with_capacity(loads.len());
        let mut loaders: Vec<Vec<u32>> = vec![Vec::new(); loads.len()];
        let mut is_met = vec![false; loads.len()];
        is_met[host as usize] = true;
        let mut way: Vec<(u32, usize)> = vec![(host, 0)];
        while let Some(&mut (file, ref mut next)) = way.last_mut() {
            let Some(&target) = loads[file as usize].get(*next) else {
                order.left_at[file as usize] = in_order_left.len() as u32;
                in_order_left.push(file);
                way.pop();
                continue;
            };
            *next += 1;
            loaders[target as usize].push(file);
            if !std::mem::replace(&mut is_met[target as usize], true) {
                way.push((target, 0));
            }
        }

        order.above[host as usize] = host;
        let mut has_changed = true;
        while has_changed {
            has_changed = false;
            for &file in in_order_left.iter().rev().skip(1) {
                let known = |&&loader: &&u32| order.above[loader as usize] != NOT_LOADED;
                let mut loaders = loaders[file as usize].iter().filter(known).copied();
                let first = loaders
                    .next()
                    .expect("a walk comes to a file from a file that it has come to");
                let lowest = loaders.fold(first, |lowest, loader| {
                    order.lowest_above_both(lowest, loader)
                });
                has_changed |= std::mem::replace(&mut order.above[file as usize], lowest) != lowest;
            }
        }
        order.loaders = loaders;
        order
    }

    fn follow_statements(&mut self, files: &[WalkedFile<'_, '_>], loads: &[Vec<u32>]) {
        let mut may_be_mocked = vec![false; files.len()];
        let mut is_any_file_mocked = false;
        for file in files {
            is_any_file_mocked |=
                names_unknown_file(file, &|site| matches!(site, ImportSiteKind::MockModule(_)));
            visit_named_files(file, &mut |target, site| {
                may_be_mocked[target as usize] |=
                    matches!(site, Some(ImportSiteKind::MockModule(_)));
            });
        }
        for (kept, &is_named) in self.may_be_mocked.iter_mut().zip(&may_be_mocked) {
            *kept = is_any_file_mocked || is_named;
        }
        let mut to_visit: Vec<u32> = Vec::new();
        for (index, file) in (0..).zip(files) {
            visit_named_files(file, &mut |target, site| {
                let is_statement = matches!(
                    site,
                    Some(
                        ImportSiteKind::Import(_)
                            | ImportSiteKind::ExportFrom(_)
                            | ImportSiteKind::ExportStar(_)
                    )
                );
                if !is_statement {
                    return;
                }
                if !is_any_file_mocked && !may_be_mocked[target as usize] {
                    self.importers[target as usize].push(index);
                    self.imported_in_order[index as usize].push(target);
                }
                let imported = &files[target as usize];
                if !is_module(imported) && imported.target.host_module.is_none() {
                    to_visit.push(target);
                }
            });
        }
        let any_file = self.any_file();
        while let Some(file) = to_visit.pop() {
            if file != any_file
                && !std::mem::replace(&mut self.runs_amid_statements[file as usize], true)
            {
                to_visit.extend(&loads[file as usize]);
            }
        }
    }

    fn is_imported_in_front(&self, file: u32, loader: u32) -> bool {
        let runs_amid_statements = |file: u32| self.runs_amid_statements[file as usize];
        let mut first_to_run = loader;
        while runs_amid_statements(self.above[first_to_run as usize]) {
            first_to_run = self.above[first_to_run as usize];
        }
        let is_below_it = |mut loader: u32| {
            while loader != first_to_run && loader != self.host() {
                loader = self.above[loader as usize];
            }
            loader == first_to_run
        };
        let mut loaders = self.loaders[first_to_run as usize].iter();
        if loaders.any(|&loader| runs_amid_statements(loader) && !is_below_it(loader)) {
            return false;
        }
        let mut module = self.above[first_to_run as usize];
        let imported = &self.imported_in_order[module as usize];
        let place_of = |target: u32| imported.iter().position(|&it| it == target);
        if matches!((place_of(file), place_of(first_to_run)), (Some(file), Some(behind)) if file < behind)
        {
            return true;
        }
        while module != self.host() {
            module = self.above[module as usize];
            if self.imported_in_order[module as usize].contains(&file) {
                return true;
            }
        }
        false
    }

    fn is_loaded_by_import_of(&self, file: u32, imported: u32) -> bool {
        if self.may_be_mocked[imported as usize] {
            return false;
        }
        let mut is_met = vec![false; self.above.len()];
        let mut to_visit = vec![file];
        while let Some(loaded) = to_visit.pop() {
            if loaded == imported {
                return true;
            }
            for &importer in &self.importers[loaded as usize] {
                if !std::mem::replace(&mut is_met[importer as usize], true) {
                    to_visit.push(importer);
                }
            }
        }
        false
    }

    fn lowest_above_both(&self, mut one: u32, mut other: u32) -> u32 {
        while one != other {
            while self.left_at[one as usize] < self.left_at[other as usize] {
                one = self.above[one as usize];
            }
            while self.left_at[other as usize] < self.left_at[one as usize] {
                other = self.above[other as usize];
            }
        }
        one
    }

    fn load_in(&self, file: u32) -> Behind {
        let lowest = match self.left_at[file as usize] {
            NOT_LOADED => self.host(),
            _ => file,
        };
        Behind {
            lowest,
            amid_statements: match self.runs_amid_statements[file as usize] {
                true => vec![lowest],
                false => Vec::new(),
            },
        }
    }

    fn note(&self, load: &Behind, behind: &mut Behind) -> bool {
        let lowest = match (behind.lowest, load.lowest) {
            (NOT_LOADED, other) | (other, NOT_LOADED) => other,
            (known, noted) => self.lowest_above_both(known, noted),
        };
        let mut has_changed = std::mem::replace(&mut behind.lowest, lowest) != lowest;
        for &loader in &load.amid_statements {
            if let Err(place) = behind.amid_statements.binary_search(&loader) {
                behind.amid_statements.insert(place, loader);
                has_changed = true;
            }
        }
        has_changed
    }

    fn is_loaded_with(&self, file: u32, behind: &Behind) -> bool {
        let mut is_above = vec![false; self.above.len()];
        let mut lower = behind.lowest;
        while !std::mem::replace(&mut is_above[lower as usize], true) {
            lower = self.above[lower as usize];
        }
        if is_above[file as usize] {
            return true;
        }
        let mut amid_statements = behind.amid_statements.iter();
        if !amid_statements.all(|&loader| self.is_imported_in_front(file, loader)) {
            return false;
        }
        let mut is_met = vec![false; self.above.len()];
        let mut to_visit = vec![file];
        while let Some(imported) = to_visit.pop() {
            for &importer in &self.importers[imported as usize] {
                if is_above[importer as usize] {
                    return true;
                }
                if !std::mem::replace(&mut is_met[importer as usize], true) {
                    to_visit.push(importer);
                }
            }
        }
        false
    }
}

struct AwaitedImport {
    place: u32,
    imported: u32,
    body: Option<FnId>,
}

fn stands_in_body(bound: &Bound<'_>, expression: ExprId, body: Option<FnId>) -> bool {
    let is_body = |parent: Parent| match parent {
        Parent::File => body.is_none(),
        Parent::FnBody(function) => body == Some(function),
        _ => false,
    };
    let mut parent = bound.parent_of_expr(expression);
    while !is_body(parent) {
        let function = match parent {
            Parent::FnBody(function) => Some(function),
            Parent::ParamDefault(parameter) => Some(bound.param_fn[parameter.idx()]),
            _ => None,
        };
        let member = match (
            parent,
            function.map(|function| bound.fns[function.idx()].owner),
        ) {
            (Parent::MemberInit(member), _) | (_, Some(FnOwner::Member(member))) => Some(member),
            _ => None,
        };
        parent = match (
            parent,
            function.map(|function| bound.fns[function.idx()].owner),
        ) {
            (Parent::Expr(outer), _) if outer.is_some() => bound.parent_of_expr(outer),
            (Parent::Stmt(statement), _) if statement.is_some() => bound.parent_of_stmt(statement),
            (Parent::VarInit(declaration), _) => Parent::Stmt(bound.var_stmt[declaration.idx()]),
            (Parent::Prop(property), _) => Parent::Expr(bound.prop_owner[property.idx()]),
            (Parent::Case(case), _) => Parent::Stmt(bound.case_stmt[case.idx()]),
            (_, Some(FnOwner::Expr(made_by))) => Parent::Expr(made_by),
            (_, Some(FnOwner::Stmt(declared_by))) => match bound.parent_of_stmt(declared_by) {
                outer if is_body(outer) => return false,
                outer => outer,
            },
            _ => match member.map(|member| bound.member_owner[member.idx()]) {
                Some(MemberOwner::Class(class)) => bound.class_owner[class.idx()].to_parent(),
                _ => return false,
            },
        };
    }
    true
}

fn find_awaited_imports(file: &WalkedFile<'_, '_>) -> Vec<AwaitedImport> {
    let Some(parsed) = &file.parsed else {
        return Vec::new();
    };
    let (hir, bound) = (&parsed.parse.hir, &parsed.parse.bound);
    let mut awaited: Vec<AwaitedImport> = Vec::new();
    visit_named_files(file, &mut |imported, site| {
        let Some(ImportSiteKind::ImportCall(call)) = site else {
            return;
        };
        let Parent::Expr(outer) = bound.parent_of_expr(call) else {
            return;
        };
        let statement = match bound.parent_of_expr(outer) {
            Parent::Stmt(statement) => statement,
            Parent::VarInit(declaration) => bound.var_stmt[declaration.idx()],
            _ => return,
        };
        let body = match bound.parent_of_stmt(statement) {
            Parent::File => None,
            Parent::FnBody(function) => Some(function),
            _ => return,
        };
        if matches!(hir[outer].kind, ExprKind::Await(_)) {
            let place = hir[call].pos;
            awaited.push(AwaitedImport {
                place,
                imported,
                body,
            });
        }
    });
    let places: Vec<u32> = awaited.iter().map(|it| it.place).collect();
    awaited.retain(|it| places.iter().filter(|&&place| place == it.place).count() == 1);
    awaited
}

fn runs_behind(file: &WalkedFile<'_, '_>, site: ImportSiteKind, awaited: &AwaitedImport) -> bool {
    let parse = file.parsed.as_ref().map(|parsed| &parsed.parse);
    parse.zip(site.call()).is_some_and(|(parse, call)| {
        awaited.place < parse.hir[call].pos && stands_in_body(&parse.bound, call, awaited.body)
    })
}

fn names_unknown_file(
    file: &WalkedFile<'_, '_>,
    is_asked: &dyn Fn(ImportSiteKind) -> bool,
) -> bool {
    let Some(parsed) = &file.parsed else {
        return false;
    };
    let sites = parsed.code.analyzed.analysis.import_sites;
    sites
        .iter()
        .zip(&parsed.code.resolutions)
        .any(|(site, resolution)| {
            matches!(
                resolution,
                SiteResolution::Computed(ComputedResolution::All { .. })
            ) && is_asked(site.kind)
        })
}

fn loads_under_unknown_name(file: &WalkedFile<'_, '_>) -> bool {
    names_unknown_file(file, &|site| loading_kind(site).is_some())
}

fn find_files_that_require_may_load(
    context: &CodeLoadContext<'_, '_, '_>,
    state: &WalkState<'_, '_>,
    asked: &[(u32, ())],
) -> Vec<(bool, bool)> {
    let files = &state.files;
    let order = LoadOrder::new(context, state);
    let is_module = |file: u32| is_module(&files[file as usize]);
    let mut named_behind = vec![BEHIND_NO_LOAD; files.len()];
    let mut imported_behind = vec![BEHIND_NO_LOAD; files.len()];
    let mut to_visit: Vec<u32> = Vec::new();
    for entry_point in &context.entry_points() {
        let index = state.index_of[&context.canonical_key(entry_point.key)];
        named_behind[index as usize] = order.load_in(order.host());
    }
    for (index, file) in (0..).zip(files) {
        let awaited = find_awaited_imports(file);
        visit_named_files(file, &mut |target, site| {
            let kind = match site.map(loading_kind) {
                None => None,
                Some(None) => return,
                Some(kind) => kind,
            };
            let is_loaded = |awaited: &AwaitedImport| {
                site.is_some_and(|site| runs_behind(file, site, awaited))
                    && order.is_loaded_by_import_of(target, awaited.imported)
            };
            if awaited.iter().any(is_loaded) {
                return;
            }
            if kind == Some(CodeImportKind::Import) {
                return;
            }
            order.note(&order.load_in(index), &mut named_behind[target as usize]);
            let starts_synchronous_load =
                kind == Some(CodeImportKind::Require) && is_module(target);
            if starts_synchronous_load
                && order.note(&order.load_in(index), &mut imported_behind[target as usize])
            {
                to_visit.push(target);
            }
        });
    }
    while let Some(file) = to_visit.pop() {
        let behind = imported_behind[file as usize].clone();
        visit_loaded_files(&files[file as usize], &mut |target, kind| {
            if kind != Some(CodeImportKind::Require)
                && order.note(&behind, &mut imported_behind[target as usize])
            {
                to_visit.push(target);
            }
        });
    }
    let may_come_first = |file: u32, behind: &Behind| {
        behind.lowest != NOT_LOADED && !order.is_loaded_with(file, behind)
    };
    (asked.iter())
        .map(|&(file, ())| {
            let runs_inside_require = may_come_first(file, &imported_behind[file as usize]);
            let is_named_first = may_come_first(file, &named_behind[file as usize]);
            (is_named_first || runs_inside_require, runs_inside_require)
        })
        .collect()
}

fn is_another_format_where_imported(
    context: &CodeLoadContext<'_, '_, '_>,
    file: &WalkedFile<'_, '_>,
) -> bool {
    let Some(parsed) = &file.parsed else {
        return false;
    };
    let analysis = &parsed.code.analyzed.analysis;
    let path = file.target.key.path;
    !analysis.module_formats.is_decided_by_text()
        && file.target.host_module.is_none()
        && !context.host.is_plugin_source(path)
        && analysis
            .module_formats
            .get(context.resolver.module_type_where_imported(path))
            != analysis.module_format
}

pub(super) fn forget_files_that_another_loader_reads(
    context: &CodeLoadContext<'_, '_, '_>,
    state: &mut WalkState<'_, '_>,
) -> bool {
    let depends_on_loader = |file: &WalkedFile<'_, '_>| match file.loaded_by {
        LoadedBy::Require | LoadedBy::RequireAfterAll => {
            is_another_format_where_imported(context, file)
        }
        LoadedBy::ImportAlone => true,
    };
    let candidates = find_in_every_file(context.host, &state.files, &|file| {
        depends_on_loader(file).then_some(())
    });
    if candidates.is_empty() {
        return false;
    }
    let answers = find_files_that_require_may_load(context, state, &candidates);
    let mut has_changed = false;
    for ((index, ()), (may_be_required, runs_inside_require)) in candidates.into_iter().zip(answers)
    {
        let file = &mut state.files[index as usize];
        if let Some(parsed) = &mut file.parsed {
            parsed.code.analyzed.runs_inside_require = runs_inside_require;
        }
        file.loaded_by = match (file.loaded_by, may_be_required) {
            (LoadedBy::Require, false) => LoadedBy::ImportAlone,
            (LoadedBy::ImportAlone, true) => LoadedBy::RequireAfterAll,
            _ => continue,
        };
        forget_parsed_file(state, index);
        has_changed = true;
    }
    has_changed
}
