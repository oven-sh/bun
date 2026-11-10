use super::*;
use crate::bind::{Bound, FnOwner, MemberOwner, Parent};
use crate::hir::{ExprId, ExprKind, FnId};
use crate::import_sites::ImportSite;
use crate::module_format::ModuleFormat;
use crate::resolve::{CodeImportKind, ComputedResolution, SiteResolution, is_typescript_file_name};

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

struct NamedFiles {
    starts: Vec<u32>,
    named: Vec<(u32, Option<ImportSiteKind>)>,
}

impl NamedFiles {
    fn new(files: &[WalkedFile<'_, '_>]) -> NamedFiles {
        let mut starts = Vec::with_capacity(files.len() + 1);
        let mut named = Vec::with_capacity(files.iter().map(|file| file.targets.len()).sum());
        starts.push(0);
        for file in files {
            visit_named_files(file, &mut |target, site| named.push((target, site)));
            starts.push(named.len() as u32);
        }
        NamedFiles { starts, named }
    }

    fn of(&self, file: u32) -> &[(u32, Option<ImportSiteKind>)] {
        let file = file as usize;
        &self.named[self.starts[file] as usize..self.starts[file + 1] as usize]
    }

    fn loaded_by(&self, file: u32) -> impl Iterator<Item = (u32, Option<CodeImportKind>)> + '_ {
        let named = self.of(file).iter();
        named.filter_map(|&(target, site)| match site.map(loading_kind) {
            None => Some((target, None)),
            Some(None) => None,
            Some(kind) => Some((target, kind)),
        })
    }
}

struct FileLists {
    starts: Vec<u32>,
    files: Vec<u32>,
}

impl FileLists {
    fn new(count: usize, pairs: &[(u32, u32)]) -> FileLists {
        let mut starts = vec![0u32; count + 1];
        for &(file, _) in pairs {
            starts[file as usize + 1] += 1;
        }
        for file in 0..count {
            starts[file + 1] += starts[file];
        }
        let mut next = starts.clone();
        let mut files = vec![0; pairs.len()];
        for &(file, listed) in pairs {
            let place = &mut next[file as usize];
            files[*place as usize] = listed;
            *place += 1;
        }
        FileLists { starts, files }
    }

    fn of(&self, file: u32) -> &[u32] {
        let file = file as usize;
        &self.files[self.starts[file] as usize..self.starts[file + 1] as usize]
    }
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
    importers: FileLists,
    imported_in_order: FileLists,
    loaders: FileLists,
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

    fn new(
        context: &CodeLoadContext<'_, '_, '_>,
        state: &WalkState<'_, '_>,
        is_of_program: &[bool],
        named: &NamedFiles,
    ) -> LoadOrder {
        let files = &state.files;
        let count = files.len() + 2;
        let StatementsFollowed {
            importers,
            imported_in_order,
            may_be_mocked,
            run_by_statements,
        } = follow_statements(files, is_of_program, named);
        let mut order = LoadOrder {
            above: vec![NOT_LOADED; count],
            left_at: vec![NOT_LOADED; count],
            importers,
            imported_in_order,
            loaders: FileLists::new(0, &[]),
            runs_amid_statements: vec![false; count],
            may_be_mocked,
        };
        let (any_file, host) = (order.any_file(), order.host());
        let mut loads: Vec<(u32, u32)> = Vec::new();
        for (index, file) in (0..).zip(files) {
            if !is_of_program[index as usize] {
                continue;
            }
            let targets = file.targets.iter().copied();
            let targets = targets.filter(|&target| target != NOT_LOADED);
            loads.extend(targets.map(|target| (index, target)));
            if loads_under_unknown_name(file) {
                loads.push((index, any_file));
            }
        }
        let of_program = (0..any_file).filter(|&file| is_of_program[file as usize]);
        loads.extend(of_program.map(|file| (any_file, file)));
        for entry_point in &context.entry_points() {
            let file = state.index_of[&context.canonical_key(entry_point.key)];
            loads.push((host, file));
        }
        let loads = FileLists::new(count, &loads);

        let mut in_order_left: Vec<u32> = Vec::with_capacity(count);
        let mut loaders: Vec<(u32, u32)> = Vec::with_capacity(loads.files.len());
        let mut is_met = vec![false; count];
        is_met[host as usize] = true;
        let mut way: Vec<(u32, usize)> = vec![(host, 0)];
        while let Some(&mut (file, ref mut next)) = way.last_mut() {
            let Some(&target) = loads.of(file).get(*next) else {
                order.left_at[file as usize] = in_order_left.len() as u32;
                in_order_left.push(file);
                way.pop();
                continue;
            };
            *next += 1;
            loaders.push((target, file));
            if !std::mem::replace(&mut is_met[target as usize], true) {
                way.push((target, 0));
            }
        }
        let loaders = FileLists::new(count, &loaders);

        order.above[host as usize] = host;
        let mut has_changed = true;
        while has_changed {
            has_changed = false;
            for &file in in_order_left.iter().rev().skip(1) {
                let known = |&&loader: &&u32| order.above[loader as usize] != NOT_LOADED;
                let mut loaders = loaders.of(file).iter().filter(known).copied();
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
        order.follow_loads_amid_statements(&loads, run_by_statements);
        order
    }

    fn follow_loads_amid_statements(&mut self, loads: &FileLists, mut to_visit: Vec<u32>) {
        let any_file = self.any_file();
        while let Some(file) = to_visit.pop() {
            if file != any_file
                && !std::mem::replace(&mut self.runs_amid_statements[file as usize], true)
            {
                let loaded = loads.of(file).iter().copied();
                to_visit.extend(loaded.filter(|&target| !self.stands_above(target, file)));
            }
        }
    }

    fn stands_above(&self, upper: u32, mut file: u32) -> bool {
        while file != self.host() && self.above[file as usize] != NOT_LOADED {
            file = self.above[file as usize];
            if file == upper {
                return true;
            }
        }
        false
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
        let mut loaders = self.loaders.of(first_to_run).iter();
        if loaders.any(|&loader| runs_amid_statements(loader) && !is_below_it(loader)) {
            return false;
        }
        let mut module = self.above[first_to_run as usize];
        let imported = self.imported_in_order.of(module);
        let place_of = |target: u32| imported.iter().position(|&it| it == target);
        if matches!((place_of(file), place_of(first_to_run)), (Some(file), Some(behind)) if file < behind)
        {
            return true;
        }
        while module != self.host() {
            module = self.above[module as usize];
            if self.imported_in_order.of(module).contains(&file) {
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
            for &importer in self.importers.of(loaded) {
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
            for &importer in self.importers.of(imported) {
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

struct StatementsFollowed {
    importers: FileLists,
    imported_in_order: FileLists,
    may_be_mocked: Vec<bool>,
    run_by_statements: Vec<u32>,
}

fn follow_statements(
    files: &[WalkedFile<'_, '_>],
    is_of_program: &[bool],
    named: &NamedFiles,
) -> StatementsFollowed {
    let count = files.len() + 2;
    let of_program = || (0..files.len() as u32).filter(move |&file| is_of_program[file as usize]);
    let mut may_be_mocked = vec![false; files.len()];
    let mut is_any_file_mocked = false;
    for index in of_program() {
        is_any_file_mocked |= names_unknown_file(&files[index as usize], &|site| {
            matches!(site, ImportSiteKind::MockModule(_))
        });
        for &(target, site) in named.of(index) {
            may_be_mocked[target as usize] |= matches!(site, Some(ImportSiteKind::MockModule(_)));
        }
    }
    let mut run_by_statements: Vec<u32> = Vec::new();
    let mut imported_in_order: Vec<(u32, u32)> = Vec::new();
    for index in of_program() {
        for &(target, site) in named.of(index) {
            let is_statement = matches!(
                site,
                Some(
                    ImportSiteKind::Import(_)
                        | ImportSiteKind::ExportFrom(_)
                        | ImportSiteKind::ExportStar(_)
                )
            );
            if !is_statement {
                continue;
            }
            if !is_any_file_mocked && !may_be_mocked[target as usize] {
                imported_in_order.push((index, target));
            }
            let imported = &files[target as usize];
            if !is_module(imported) && imported.target.host_module.is_none() {
                run_by_statements.push(target);
            }
        }
    }
    let importers = imported_in_order
        .iter()
        .map(|&(file, target)| (target, file));
    let importers: Vec<(u32, u32)> = importers.collect();
    let may_be_mocked = may_be_mocked.into_iter().map(|it| it || is_any_file_mocked);
    StatementsFollowed {
        importers: FileLists::new(count, &importers),
        imported_in_order: FileLists::new(count, &imported_in_order),
        may_be_mocked: may_be_mocked.chain([false; 2]).collect(),
        run_by_statements,
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

fn find_awaited_imports(
    file: &WalkedFile<'_, '_>,
    named: &[(u32, Option<ImportSiteKind>)],
) -> Vec<AwaitedImport> {
    let Some(parsed) = &file.parsed else {
        return Vec::new();
    };
    let (hir, bound) = (&parsed.parse.hir, &parsed.parse.bound);
    let mut awaited: Vec<AwaitedImport> = Vec::new();
    for &(imported, site) in named {
        let Some(ImportSiteKind::ImportCall(call)) = site else {
            continue;
        };
        let Parent::Expr(outer) = bound.parent_of_expr(call) else {
            continue;
        };
        let statement = match bound.parent_of_expr(outer) {
            Parent::Stmt(statement) => statement,
            Parent::VarInit(declaration) => bound.var_stmt[declaration.idx()],
            _ => continue,
        };
        let body = match bound.parent_of_stmt(statement) {
            Parent::File => None,
            Parent::FnBody(function) => Some(function),
            _ => continue,
        };
        if matches!(hir[outer].kind, ExprKind::Await(_)) {
            let place = hir[call].pos;
            awaited.push(AwaitedImport {
                place,
                imported,
                body,
            });
        }
    }
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
    names_unknown_file_at(file, &|site| is_asked(site.kind))
}

fn names_unknown_file_at(
    file: &WalkedFile<'_, '_>,
    is_asked: &dyn Fn(&ImportSite) -> bool,
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
            ) && is_asked(site)
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
    let is_of_program = find_files_of_program(context, state);
    let named = NamedFiles::new(files);
    let order = LoadOrder::new(context, state, &is_of_program, &named);
    let is_module = |file: u32| is_module(&files[file as usize]);
    let mut named_behind = vec![BEHIND_NO_LOAD; files.len()];
    let mut imported_behind = vec![BEHIND_NO_LOAD; files.len()];
    let mut to_visit: Vec<u32> = Vec::new();
    let imported = std::cell::OnceCell::new();
    let is_imported = |index: u32| {
        let imported: &Vec<bool> = imported.get_or_init(|| {
            let mut imported = vec![false; files.len()];
            for (file, _) in (0..).zip(&is_of_program).filter(|it| *it.1) {
                for &(target, site) in named.of(file) {
                    imported[target as usize] |=
                        site.map(loading_kind) == Some(Some(CodeImportKind::Import));
                }
            }
            imported
        });
        imported[index as usize]
    };
    for entry_point in &context.entry_points() {
        let index = state.index_of[&context.canonical_key(entry_point.key)];
        let Some(loads) = context.loads_that_alone_name(entry_point.key) else {
            named_behind[index as usize] = order.load_in(order.host());
            continue;
        };
        let counts = |load: &&NamingLoad| {
            load.requires
                && is_of_program.get(load.written_in.0 as usize) == Some(&true)
                && !(load.is_guess && is_imported(index))
        };
        for load in loads.iter().filter(counts) {
            let behind = order.load_in(load.file.0);
            order.note(&behind, &mut named_behind[index as usize]);
            if is_module(index) && order.note(&behind, &mut imported_behind[index as usize]) {
                to_visit.push(index);
            }
        }
    }
    for (index, file) in (0..).zip(files) {
        if !is_of_program[index as usize] {
            continue;
        }
        let awaited = find_awaited_imports(file, named.of(index));
        for &(target, site) in named.of(index) {
            let kind = match site.map(loading_kind) {
                None => None,
                Some(None) => continue,
                Some(kind) => kind,
            };
            let is_loaded = |awaited: &AwaitedImport| {
                site.is_some_and(|site| runs_behind(file, site, awaited))
                    && order.is_loaded_by_import_of(target, awaited.imported)
            };
            if awaited.iter().any(is_loaded) || kind == Some(CodeImportKind::Import) {
                continue;
            }
            order.note(&order.load_in(index), &mut named_behind[target as usize]);
            let starts_synchronous_load =
                kind == Some(CodeImportKind::Require) && is_module(target);
            if starts_synchronous_load
                && order.note(&order.load_in(index), &mut imported_behind[target as usize])
            {
                to_visit.push(target);
            }
        }
    }
    while let Some(file) = to_visit.pop() {
        let behind = imported_behind[file as usize].clone();
        for (target, kind) in named.loaded_by(file) {
            if kind != Some(CodeImportKind::Require)
                && order.note(&behind, &mut imported_behind[target as usize])
            {
                to_visit.push(target);
            }
        }
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

fn is_of_kind_that_loader_decides(
    context: &CodeLoadContext<'_, '_, '_>,
    file: &WalkedFile<'_, '_>,
) -> bool {
    let Some(parsed) = &file.parsed else {
        return false;
    };
    let formats = &parsed.code.analyzed.analysis.module_formats;
    let path = file.target.key.path;
    !formats.is_decided_by_text()
        && file.target.host_module.is_none()
        && !context.host.is_plugin_source(path)
        && formats.get(context.resolver.module_type_where_imported(path))
            != formats.get(context.resolver.declared_module_type(path))
}

struct NamedEntryPoints<'r> {
    written: Vec<u32>,
    named: Vec<(LoadKey<'r>, u32, Vec<NamingLoad>)>,
}

impl<'r> NamedEntryPoints<'r> {
    fn new(context: &CodeLoadContext<'_, '_, 'r>, state: &WalkState<'_, '_>) -> Self {
        let mut entry_points = NamedEntryPoints {
            written: Vec::new(),
            named: Vec::new(),
        };
        for entry_point in &context.entry_points() {
            let index = state.index_of[&context.canonical_key(entry_point.key)];
            match context.loads_that_alone_name(entry_point.key) {
                Some(loads) => entry_points.named.push((entry_point.key, index, loads)),
                None => entry_points.written.push(index),
            }
        }
        entry_points
    }

    fn list_what_each_file_names(
        &self,
        file_count: usize,
        counts: impl Fn(&NamingLoad) -> bool,
    ) -> Vec<Vec<u32>> {
        let mut named_from: Vec<Vec<u32>> = vec![Vec::new(); file_count];
        for (_, index, loads) in &self.named {
            for load in loads.iter().filter(|load| counts(load)) {
                if let Some(named) = named_from.get_mut(load.written_in.0 as usize) {
                    named.push(*index);
                }
            }
        }
        named_from
    }
}

pub(super) fn find_files_of_program(
    context: &CodeLoadContext<'_, '_, '_>,
    state: &WalkState<'_, '_>,
) -> Vec<bool> {
    find_files_reached(context, state, |_| true)
}

fn find_files_reached(
    context: &CodeLoadContext<'_, '_, '_>,
    state: &WalkState<'_, '_>,
    counts: impl Fn(&NamingLoad) -> bool,
) -> Vec<bool> {
    let entry_points = NamedEntryPoints::new(context, state);
    let named_from = entry_points.list_what_each_file_names(state.files.len(), counts);
    let mut is_reached = vec![false; state.files.len()];
    reach(
        &state.files,
        &named_from,
        entry_points.written,
        &mut is_reached,
    );
    is_reached
}

pub(super) fn program_rules_out_guesses(
    context: &CodeLoadContext<'_, '_, '_>,
    state: &WalkState<'_, '_>,
) -> bool {
    let is_of_program = find_files_of_program(context, state);
    let is_sure = find_files_reached(context, state, |load| !load.may_be_left_out);
    let files = state.files.iter().zip(is_of_program).zip(is_sure);
    let mut files = files.filter(|it| it.0.1).map(|it| (it.0.0, it.1));
    files.any(|(file, is_sure)| match is_sure {
        true => names_unknown_file_where_nothing_is_written(file),
        false => {
            names_unknown_file(file, &|_| true) || is_typescript_file_name(file.target.key.path)
        }
    })
}

fn names_unknown_file_where_nothing_is_written(file: &WalkedFile<'_, '_>) -> bool {
    let analysis = file.parsed.as_ref().map(|it| &it.code.analyzed.analysis);
    let guessed = analysis.into_iter().flat_map(|it| it.names_from_data_files);
    let guessed: FxHashSet<ExprId> = guessed.filter(|it| it.2).map(|it| it.1).collect();
    names_unknown_file_at(file, &|site| !guessed.contains(&site.specifier_node))
}

fn reach(
    files: &[WalkedFile<'_, '_>],
    named_from: &[Vec<u32>],
    mut to_visit: Vec<u32>,
    is_reached: &mut [bool],
) {
    while let Some(file) = to_visit.pop() {
        if !std::mem::replace(&mut is_reached[file as usize], true) {
            let targets = files[file as usize].targets.iter().copied();
            to_visit.extend(targets.filter(|&target| target != NOT_LOADED));
            to_visit.extend_from_slice(&named_from[file as usize]);
        }
    }
}

pub(super) fn find_file_of_kind_that_loader_decides(
    context: &CodeLoadContext<'_, '_, '_>,
    state: &WalkState<'_, '_>,
) -> Option<Vec<u8>> {
    let is_of_program = find_files_of_program(context, state);
    let entry_points = context.entry_points();
    let guesses = entry_points
        .iter()
        .filter(|it| context.is_mere_guess(it.key));
    let guesses = guesses.map(|it| state.index_of[&context.canonical_key(it.key)]);
    let mut is_reached_by_guess = vec![false; state.files.len()];
    let named_by_nobody = vec![Vec::new(); state.files.len()];
    reach(
        &state.files,
        &named_by_nobody,
        guesses.collect(),
        &mut is_reached_by_guess,
    );
    let files = state.files.iter().zip(&is_of_program);
    let mut files = files.zip(&is_reached_by_guess);
    let found = files.find(|&((file, &is_of_program), &is_reached_by_guess)| {
        is_of_program && is_reached_by_guess && is_of_kind_that_loader_decides(context, file)
    });
    found.map(|((file, _), _)| file.target.key.path.to_vec())
}

pub(super) fn leave_out_guesses_that_decide_formats(
    context: &CodeLoadContext<'_, '_, '_>,
    state: &mut WalkState<'_, '_>,
) -> bool {
    let entry_points = NamedEntryPoints::new(context, state);
    let mut loads = entry_points.named.iter().flat_map(|it| it.2.iter());
    if !loads.any(|load| load.may_be_left_out) {
        return false;
    }
    let file = find_file_of_kind_that_loader_decides(context, state);
    file.is_some() && let_all_guesses_go(context, state, file.as_deref())
}

pub(super) fn let_all_guesses_go(
    context: &CodeLoadContext<'_, '_, '_>,
    state: &mut WalkState<'_, '_>,
    file_whose_loader_decides_its_kind: Option<&[u8]>,
) -> bool {
    let entry_points = NamedEntryPoints::new(context, state);
    context.let_no_guess_in(file_whose_loader_decides_its_kind);
    let is_of_program = find_files_of_program(context, state);
    let dead = entry_points.named.iter();
    let dead = dead.filter(|it| !is_of_program[it.1 as usize]);
    let dead: Vec<LoadKey<'_>> = dead.map(|it| it.0).collect();
    context.leave_out_found_entry_points(&dead);
    true
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
