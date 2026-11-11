use super::evicted::EvictedModules;
use super::imports::MockedModules;
use super::interop::ModuleKind;
use super::module_set::ModuleSet;
use super::plan::Plan;
use super::requests::{ScannedSite, Scans};
use super::{BindInput, ModuleRef};
use crate::builtins::RuntimeModule;
use crate::load::{SourceKind, is_in_node_modules};
use crate::test_run_report::{say_es_packages_that_mocks_name, say_reloadable_files};
use bun_core::strings::{contains, last_index_of_char};
use bun_sema::components::strongly_connected_components;
use bun_sema::import_sites::ImportSiteKind;
use bun_sema::program::FileId;
use bun_sema::util::{FxHashSet, SharedSort};
use core::mem::replace;

pub(super) fn is_marked(set: &[bool], module: ModuleRef) -> bool {
    match module {
        ModuleRef::File(file) | ModuleRef::Facade(file) | ModuleRef::Check(file) => {
            set.get(file.idx()).copied().unwrap_or(false)
        }
        ModuleRef::Inner { .. } | ModuleRef::Runtime(_) | ModuleRef::External { .. } => false,
    }
}

pub(super) fn is_among(leaving: &[ModuleRef], module: ModuleRef) -> bool {
    let ModuleRef::File(file) = module else {
        return false;
    };
    let compare = |listed: &ModuleRef| match *listed {
        ModuleRef::File(listed) => listed.cmp(&file),
        _ => unreachable!("only files leave"),
    };
    leaving.binary_search_by(compare).is_ok()
}

fn find_forms<'a>(input: &BindInput<'a, '_>, scans: &Scans) -> Vec<(&'a [u8], FileId)> {
    let is_data = |form: &&FileId| scans.of(**form).interop.kind == ModuleKind::Data;
    let data_files = input.files.compiled_files().iter().filter(is_data);
    let mut forms: Vec<(&[u8], FileId)> = data_files
        .filter_map(|&form| {
            let path = input.sources.public_path(form);
            let mark = last_index_of_char(path, b'?')?;
            Some((&path[..mark], form))
        })
        .collect();
    forms.shared_sort_unstable();
    forms
}

fn find_importers_by_statements(input: &BindInput<'_, '_>, scans: &Scans) -> Vec<(FileId, FileId)> {
    let files = input.files;
    let mut importers = Vec::new();
    for &file in files.compiled_files() {
        let analysis = files.analysis(file);
        for (site, answer) in analysis.import_sites.iter().zip(&scans.of(file).sites) {
            let &ScannedSite::Module(ModuleRef::File(named)) = answer else {
                continue;
            };
            match site.kind {
                ImportSiteKind::JsxRuntime
                | ImportSiteKind::JsxPackage
                | ImportSiteKind::Import(_)
                | ImportSiteKind::ExportFrom(_)
                | ImportSiteKind::ExportStar(_)
                | ImportSiteKind::ImportEquals(_) => importers.push((named, file)),
                ImportSiteKind::Require(_)
                | ImportSiteKind::ImportMetaRequire(_)
                | ImportSiteKind::RequireByTestRunner(_)
                | ImportSiteKind::ImportCall(_)
                | ImportSiteKind::ImportByTestRunner(_)
                | ImportSiteKind::RequireResolve(_)
                | ImportSiteKind::ImportMetaResolve(_)
                | ImportSiteKind::GetBuiltinModule(_)
                | ImportSiteKind::MockModule(_) => {}
            }
        }
    }
    importers
}

pub(super) fn find_files_whose_statements_ask(
    input: &BindInput<'_, '_>,
    scans: &Scans,
) -> Option<Vec<bool>> {
    let loads = &input.run.loads;
    if !input.runs_in_several_realms
        || input.entry_points_run_again
        || loads.is_any_file_taken_out
        || loads.why_every_file.is_empty()
    {
        return None;
    }
    let files = input.files;
    let count = files.modules.len();
    let mut loaders: Vec<Vec<FileId>> = vec![Vec::new(); count];
    let mut importers: Vec<Vec<FileId>> = vec![Vec::new(); count];
    let mut lays_mocks = vec![false; count];
    for &file in files.compiled_files() {
        let Some(scan) = scans.find(file) else {
            continue;
        };
        let add = |above: &mut [Vec<FileId>], module: ModuleRef| {
            if let ModuleRef::File(below) | ModuleRef::Facade(below) = module {
                above[below.idx()].push(file);
            }
        };
        for request in &scan.requests {
            add(&mut importers, request.target);
            add(&mut loaders, request.target);
        }
        for &candidate in &scan.candidates {
            add(&mut loaders, candidate);
        }
        let sites = files.analysis(file).import_sites.iter();
        for (site, answer) in sites.zip(&scan.sites) {
            lays_mocks[file.idx()] |= matches!(site.kind, ImportSiteKind::MockModule(_));
            if let &ScannedSite::Module(module) = answer {
                add(&mut loaders, module);
            }
        }
    }
    let find_above = |above: &[Vec<FileId>], mut pending: Vec<FileId>| {
        let mut is_found = vec![false; count];
        while let Some(file) = pending.pop() {
            if !replace(&mut is_found[file.idx()], true) {
                pending.extend_from_slice(&above[file.idx()]);
            }
        }
        is_found
    };
    let makers = loads.why_every_file.iter().map(|maker| maker.0).collect();
    let comes_to_maker = find_above(&loaders, makers);
    let mut preloads = input.run.preloads.iter();
    if preloads.any(|preload| comes_to_maker[preload.idx()]) {
        return None;
    }
    let runs_before_statements = |file: &&FileId| {
        comes_to_maker[file.idx()]
            && (scans.find(**file)).is_some_and(|scan| scan.interop.kind == ModuleKind::CommonJs)
    };
    let run_before = files.compiled_files().iter().filter(runs_before_statements);
    let mut asks = find_above(&importers, run_before.copied().collect());
    for &file in files.compiled_files() {
        asks[file.idx()] |= lays_mocks[file.idx()] && comes_to_maker[file.idx()];
    }
    let mut loaded_by: Vec<Vec<FileId>> = vec![Vec::new(); count];
    for (loaded, loaders) in loaders.iter().enumerate() {
        for loader in loaders {
            loaded_by[loader.idx()].push(FileId(loaded as u32));
        }
    }
    let asking = files.entry_points().iter().filter(|file| asks[file.idx()]);
    let is_loaded_beside = find_above(&loaded_by, asking.copied().collect());
    for (asks, is_loaded_beside) in asks.iter_mut().zip(is_loaded_beside) {
        *asks |= is_loaded_beside;
    }
    Some(asks)
}

pub(super) fn find_es_packages_that_mocks_name(
    input: &BindInput<'_, '_>,
    scans: &Scans,
) -> Vec<ModuleRef> {
    if !input.runner_starts_entry_points {
        return Vec::new();
    }
    let files = input.files;
    let is_es_package = |named: FileId| {
        let scan = scans.find(named);
        scan.is_some_and(|scan| scan.interop.kind == ModuleKind::SourceText)
            && is_in_node_modules(files.module(named).file_name())
    };
    let mut found: Vec<FileId> = Vec::new();
    for &file in files.compiled_files() {
        let sites = files.analysis(file).import_sites.iter();
        for (site, answer) in sites.zip(&scans.of(file).sites) {
            let &ScannedSite::Module(ModuleRef::File(named)) = answer else {
                continue;
            };
            if matches!(site.kind, ImportSiteKind::MockModule(_)) && is_es_package(named) {
                found.push(named);
            }
        }
    }
    found.shared_sort_unstable();
    found.dedup();
    say_es_packages_that_mocks_name(found.len());
    found.into_iter().map(ModuleRef::File).collect()
}

pub(super) fn find_modules_named_by_mocks(
    input: &BindInput<'_, '_>,
    scans: &Scans,
) -> Option<FxHashSet<ModuleRef>> {
    let mut named = FxHashSet::default();
    for &file in input.files.compiled_files() {
        let path = input.files.module(file).file_name();
        if input.run.is_replaced_in_text(&input.files.atoms, path) {
            named.insert(ModuleRef::File(file));
        }
        let (analysis, scan) = (input.files.analysis(file), scans.of(file));
        for (site, answer) in analysis.import_sites.iter().zip(&scan.sites) {
            let ImportSiteKind::MockModule(call) = site.kind else {
                continue;
            };
            if analysis.decisions.is_dead_expr(call) {
                continue;
            }
            match *answer {
                ScannedSite::Module(module) => {
                    named.insert(module);
                }
                ScannedSite::Candidates(ref range) => named.extend(scan.modules_spelled_in(range)),
                ScannedSite::AllModules => return None,
                ScannedSite::Unresolved | ScannedSite::Erased => {}
            }
        }
    }
    Some(named)
}

fn binds_importer_to_module(kind: ImportSiteKind) -> bool {
    match kind {
        ImportSiteKind::JsxRuntime
        | ImportSiteKind::JsxPackage
        | ImportSiteKind::Import(_)
        | ImportSiteKind::ExportFrom(_)
        | ImportSiteKind::ExportStar(_)
        | ImportSiteKind::ImportEquals(_)
        | ImportSiteKind::Require(_)
        | ImportSiteKind::ImportMetaRequire(_) => true,
        ImportSiteKind::RequireByTestRunner(_)
        | ImportSiteKind::ImportCall(_)
        | ImportSiteKind::ImportByTestRunner(_)
        | ImportSiteKind::RequireResolve(_)
        | ImportSiteKind::ImportMetaResolve(_)
        | ImportSiteKind::GetBuiltinModule(_)
        | ImportSiteKind::MockModule(_) => false,
    }
}

pub(super) fn find_reloadable_files(input: &BindInput<'_, '_>, scans: &Scans) -> Vec<bool> {
    let files = input.files;
    let mut is_reloadable = vec![false; files.modules.len()];
    if !input.runner_starts_entry_points {
        return is_reloadable;
    }
    let is_program = |file: &&FileId| input.sources.kind(**file) == SourceKind::Program;
    let named = match input.mocks_any_module {
        true => None,
        false => find_modules_named_by_mocks(input, scans),
    };
    let Some(named) = named else {
        for &file in files.compiled_files().iter().filter(is_program) {
            is_reloadable[file.idx()] = true;
        }
        return is_reloadable;
    };
    if named.is_empty() {
        return is_reloadable;
    }
    let mut importers: Vec<(FileId, FileId)> = Vec::new();
    let mut to_follow: Vec<FileId> = Vec::new();
    for &module in &named {
        if let ModuleRef::File(file) = module {
            to_follow.push(file);
        }
    }
    for &file in files.compiled_files() {
        let sites = files.analysis(file).import_sites.iter();
        for (site, answer) in sites.zip(&scans.of(file).sites) {
            let &ScannedSite::Module(target) = answer else {
                continue;
            };
            if !binds_importer_to_module(site.kind) {
                continue;
            }
            match target {
                ModuleRef::File(target) => importers.push((target, file)),
                _ if named.contains(&target) => to_follow.push(file),
                _ => {}
            }
        }
    }
    importers.shared_sort_unstable();
    importers.dedup();
    while let Some(file) = to_follow.pop() {
        if replace(&mut is_reloadable[file.idx()], true) {
            continue;
        }
        let first = importers.partition_point(|import| import.0 < file);
        let importers_of_file = importers[first..].iter().take_while(|it| it.0 == file);
        to_follow.extend(importers_of_file.map(|import| import.1));
    }
    is_reloadable
}

pub(super) fn fill_plan_of_reloads(input: &BindInput<'_, '_>, scans: &Scans, plan: &mut Plan) {
    plan.test_run.is_reloadable = find_reloadable_files(input, scans);
    let is_reloadable = &plan.test_run.is_reloadable;
    let count_of_kind = |kind: ModuleKind| {
        let files = input.files.compiled_files().iter();
        let reloadable = files.filter(|file| is_reloadable[file.idx()]);
        reloadable
            .filter(|&&file| scans.of(file).interop.kind == kind)
            .count()
    };
    say_reloadable_files(
        count_of_kind(ModuleKind::SourceText),
        count_of_kind(ModuleKind::CommonJs),
        input.files.compiled_files().len(),
    );
}

pub(super) fn find_files_that_leave(input: &BindInput<'_, '_>, scans: &Scans) -> Vec<ModuleRef> {
    let loads = &input.run.loads;
    if !input.runner_starts_entry_points
        || (input.any_module_loads_again && loads.is_any_file_taken_out)
    {
        return Vec::new();
    }
    let mut importers = find_importers_by_statements(input, scans);
    let mut to_follow = [&loads.files_taken_out[..], &loads.files_changed_on_disk[..]].concat();
    if to_follow.is_empty() {
        return Vec::new();
    }
    importers.shared_sort_unstable();
    importers.dedup();
    let forms = find_forms(input, scans);
    let mut leaves = vec![false; input.files.modules.len()];
    while let Some(file) = to_follow.pop() {
        if replace(&mut leaves[file.idx()], true) {
            continue;
        }
        let path = input.sources.public_path(file);
        let first = forms.partition_point(|form| form.0 < path);
        let forms_of_file = forms[first..].iter().take_while(|form| form.0 == path);
        to_follow.extend(forms_of_file.map(|form| form.1));
        let first = importers.partition_point(|import| import.0 < file);
        let importers_of_file = importers[first..].iter().take_while(|it| it.0 == file);
        to_follow.extend(importers_of_file.map(|import| import.1));
    }
    let files = (0..leaves.len() as u32).map(FileId);
    files
        .filter(|file| leaves[file.idx()])
        .map(ModuleRef::File)
        .collect()
}

pub(super) fn fill_plan_of_loads(
    input: &BindInput<'_, '_>,
    leaving: &[ModuleRef],
    plan: &mut Plan,
) {
    if !input.runner_starts_entry_points {
        return;
    }
    let file_count = input.files.modules.len();
    let mut may_be_evicted = vec![false; file_count];
    for &module in leaving {
        if let ModuleRef::File(file) = module {
            may_be_evicted[file.idx()] = true;
        }
    }
    let mut is_changed_on_disk_by_run = vec![false; file_count];
    for &file in &input.run.loads.files_changed_on_disk {
        is_changed_on_disk_by_run[file.idx()] = input.sources.kind(file) == SourceKind::Program;
    }
    plan.test_run.may_be_evicted = may_be_evicted;
    plan.test_run.is_changed_on_disk_by_run = is_changed_on_disk_by_run;
}

fn find_mocked_import_cycles(
    input: &BindInput<'_, '_>,
    scans: &Scans,
    mocked: &MockedModules,
) -> Vec<ModuleRef> {
    let mut imports = vec![Vec::new(); input.files.modules.len()];
    for (named, importer) in find_importers_by_statements(input, scans) {
        imports[importer.idx()].push(named.0);
    }
    let (component_of, components) = strongly_connected_components(&imports);
    let mut has_mocked_file = vec![false; components.len()];
    for &module in mocked.iter() {
        if let ModuleRef::File(file) = module {
            has_mocked_file[component_of[file.idx()] as usize] = true;
        }
    }
    let with_mocked_file = components.iter().zip(has_mocked_file);
    let cycles =
        with_mocked_file.filter(|(files, has_mocked_file)| *has_mocked_file && files.len() > 1);
    cycles
        .flat_map(|(files, _)| {
            files
                .iter()
                .map(|&file| ModuleRef::File(FileId(file as u32)))
        })
        .collect()
}

#[derive(Default)]
pub(super) struct NamedByCopies {
    is_every_file: bool,
    is_named: Vec<bool>,
}

impl NamedByCopies {
    pub(super) fn contains(&self, module: ModuleRef) -> bool {
        self.is_every_file || is_marked(&self.is_named, module)
    }
}

pub(super) fn fill_plan_of_copies(
    input: &BindInput<'_, '_>,
    scans: &Scans,
    modules: &ModuleSet,
    evicted: &EvictedModules,
    mocked: &MockedModules,
    plan: &mut Plan,
) {
    if !input.runner_starts_entry_points || evicted.is_every_module() {
        return;
    }
    let is_any_module_mocked = mocked.is_every_module() || mocked.iter().next().is_some();
    let copied_under_queries = input.run.loads.files_copied_under_queries.iter();
    let copied_under_queries: Vec<ModuleRef> = copied_under_queries
        .map(|&file| ModuleRef::File(file))
        .collect();
    if evicted.modules().is_empty() && !is_any_module_mocked && copied_under_queries.is_empty() {
        return;
    }
    let mut changed = input.run.loads.files_changed_on_disk.iter();
    let is_code_changed = changed.any(|&file| input.sources.kind(file) != SourceKind::Data);
    let mut is_every_file = is_code_changed || mocked.is_every_module();
    is_every_file |= !evicted.modules().is_empty();
    let mut named: Vec<ModuleRef> = Vec::new();
    let mut asked_of_test_runner: Vec<ModuleRef> = Vec::new();
    for &file in (modules.compiled_files.iter()).filter(|_| is_any_module_mocked) {
        let Some(scan) = scans.find(file) else {
            continue;
        };
        let sites = input.files.analysis(file).import_sites.iter();
        for (site, answer) in sites.zip(&scan.sites) {
            let is_asked = matches!(
                site.kind,
                ImportSiteKind::ImportByTestRunner(_) | ImportSiteKind::RequireByTestRunner(_)
            );
            match *answer {
                _ if !is_asked => {}
                ScannedSite::Module(module) => asked_of_test_runner.push(module),
                ScannedSite::Candidates(ref range) => {
                    asked_of_test_runner.extend(scan.modules_spelled_in(range));
                }
                ScannedSite::AllModules => is_every_file = true,
                ScannedSite::Unresolved | ScannedSite::Erased => {}
            }
        }
    }
    let in_cycles = if is_every_file || !is_any_module_mocked {
        Vec::new()
    } else {
        find_mocked_import_cycles(input, scans, mocked)
    };
    let copies = evicted.modules().iter().chain(mocked.iter());
    let copies = copies.chain(&copied_under_queries).chain(&in_cycles);
    for &module in copies.chain(&asked_of_test_runner) {
        let ModuleRef::File(file) = module else {
            continue;
        };
        let Some(scan) = scans.find(file) else {
            continue;
        };
        for answer in &scan.sites {
            match *answer {
                ScannedSite::Module(module) => named.push(module),
                ScannedSite::Candidates(ref range) => named.extend(scan.modules_spelled_in(range)),
                ScannedSite::AllModules => is_every_file = true,
                ScannedSite::Unresolved | ScannedSite::Erased => {}
            }
        }
    }
    if is_any_module_mocked {
        let is_manual_mock =
            |file: &&FileId| contains(input.files.module(**file).file_name(), b"/__mocks__/");
        let manual_mocks = modules.compiled_files.iter().filter(is_manual_mock);
        named.extend(manual_mocks.map(|&file| ModuleRef::File(file)));
    }
    let mut is_named = vec![false; input.files.modules.len()];
    let mut library_modules: Vec<RuntimeModule> = Vec::new();
    while let Some(module) = named.pop() {
        let file = match module {
            ModuleRef::File(file) => file,
            ModuleRef::Runtime(module) => {
                library_modules.push(module);
                continue;
            }
            ModuleRef::Inner { .. }
            | ModuleRef::Facade(_)
            | ModuleRef::Check(_)
            | ModuleRef::External { .. } => continue,
        };
        if replace(&mut is_named[file.idx()], true) {
            continue;
        }
        named.extend(modules.forms_of(module));
        let Some(scan) = scans.find(file) else {
            continue;
        };
        let sites = input.files.analysis(file).import_sites.iter();
        for (site, answer) in sites.zip(&scan.sites) {
            let hands_on = matches!(
                site.kind,
                ImportSiteKind::ExportFrom(_) | ImportSiteKind::ExportStar(_)
            );
            if let (true, &ScannedSite::Module(source)) = (hands_on, answer) {
                named.push(source);
            }
        }
    }
    library_modules.shared_sort_unstable_by_key(|module| module.registry_id());
    library_modules.dedup();
    for module in library_modules {
        plan.expose_runtime_module(module);
    }
    plan.named_by_copies = NamedByCopies {
        is_every_file,
        is_named,
    };
}
