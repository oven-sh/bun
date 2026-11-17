use super::BindInput;
use super::bindings::{ExportStatement, NO_STAR_PLACE, RequiredName};
use super::failures::{
    FailureEffect, FailureOrder, ModuleFailureKind, PendingFailure, SitePart, WrittenPart,
};
use super::imports::{FileImports, ImportedItem, find_specifier_of_site, imported_items};
use super::interop::{ImportPhase, ModuleKind};
use super::plan::ModuleRef;
use super::requests::{FileScan, RequestDraft, ScannedSite, Scans, is_jsx_site};
use super::test_run_evictions::find_modules_named_by_mocks;
use crate::load::sources::{SourceKind, parsed_source};
use crate::module_keys::is_name_of_text;
use bun_sema::bind::Binding;
use bun_sema::hir::{ExportId, ExportSpecId};
use bun_sema::import_sites::{ImportSite, ImportSiteKind, is_load_found_late};
use bun_sema::program::FileId;
use bun_sema::resolve::CodeFailure;
use bun_sema::util::{FxHashMap, FxHashSet, SharedSort};

#[derive(Copy, Clone, Debug)]
pub(super) struct UnloadableModule {
    pub file: FileId,
    pub importer: FileId,
    pub order: FailureOrder,
    through: Option<FileId>,
}

fn fails_load(pending: &PendingFailure, takes_link_failures: bool) -> bool {
    let is_found_at_load = match pending.failure.kind {
        ModuleFailureKind::Unresolved { .. } | ModuleFailureKind::NotAProgram { .. } => true,
        ModuleFailureKind::ExportNotFound { .. } | ModuleFailureKind::ExportAmbiguous { .. } => {
            takes_link_failures
        }
        ModuleFailureKind::UnresolvedAtLoad { .. }
        | ModuleFailureKind::ExportMayBeAbsent { .. } => false,
    };
    is_found_at_load
        && !pending.failure.is_refusal_of_compiler()
        && pending.failure.effect() == FailureEffect::StopsBuild
}

fn find_missing_name(kind: ModuleFailureKind) -> Option<RequiredName> {
    match kind {
        ModuleFailureKind::ExportNotFound { exporter, name }
        | ModuleFailureKind::ExportAmbiguous { exporter, name } => {
            Some(RequiredName::new(exporter, name))
        }
        ModuleFailureKind::Unresolved { .. }
        | ModuleFailureKind::UnresolvedAtLoad { .. }
        | ModuleFailureKind::NotAProgram { .. }
        | ModuleFailureKind::ExportMayBeAbsent { .. } => None,
    }
}

/// The statement that exports the name that is not found, under another name or its own.
fn find_failing_export_statement(
    input: &BindInput<'_, '_>,
    scan: &FileScan,
    pending: &PendingFailure,
) -> Option<ExportStatement> {
    let (PendingFailure { order, failure }, files) = (pending, input.files);
    let ModuleFailureKind::ExportNotFound { .. } = failure.kind else {
        return None;
    };
    let (hir, bound) = (files.hir(failure.importer), files.bound(failure.importer));
    let item = match (failure.site, order.part) {
        (ImportSiteKind::ExportFrom(export), SitePart::Name(place)) => {
            ExportSpecId(hir[export].items.start + place)
        }
        (ImportSiteKind::Import(_), _) if input.typescript_drops_absent_exports && !hir.is_js => {
            return None;
        }
        (ImportSiteKind::Import(import), part) => {
            let mut imported = imported_items(files, hir, import);
            let (declared, _) = imported.find(|(_, item)| {
                matches!(*item, ImportedItem::Name { part: of_item, .. } if of_item == part)
            })?;
            let symbol = Binding::Symbol(bound.declared_symbol(declared));
            let mut items = (0..hir.export_specs.len() as u32).map(ExportSpecId);
            items.find(|&item| {
                !hir[hir[item].export].has_module_specifier
                    && bound.exported_binding(item) == symbol
            })?
        }
        _ => return None,
    };
    let site = order.site as usize;
    Some(ExportStatement {
        export_name: hir[item].exported,
        specifier: find_specifier_of_site(files, failure.importer, scan, site)?,
    })
}

fn kind_thrown_at_load(
    kind: ModuleFailureKind,
    build_says_nothing: bool,
    asked_by: Option<ExportStatement>,
) -> ModuleFailureKind {
    match kind {
        ModuleFailureKind::Unresolved { specifier, reason } => {
            ModuleFailureKind::UnresolvedAtLoad { specifier, reason }
        }
        ModuleFailureKind::NotAProgram { is_silent, .. } => ModuleFailureKind::NotAProgram {
            is_loaded_at_start: false,
            is_silent: is_silent || build_says_nothing,
        },
        ModuleFailureKind::ExportNotFound { exporter, name }
        | ModuleFailureKind::ExportAmbiguous { exporter, name } => {
            ModuleFailureKind::ExportMayBeAbsent {
                exporter,
                name,
                asked_by,
            }
        }
        ModuleFailureKind::UnresolvedAtLoad { .. }
        | ModuleFailureKind::ExportMayBeAbsent { .. } => kind,
    }
}

fn find_load_failure(scans: &Scans, file: FileId) -> Option<FailureOrder> {
    let scan = scans.find(file)?;
    if scan.interop.kind != ModuleKind::SourceText {
        return None;
    }
    let mut failures = scan.failures.iter();
    let first = failures.find(|pending| fails_load(pending, false));
    first.map(|pending| pending.order)
}

fn is_unloadable(unloadable: &[UnloadableModule], file: FileId) -> bool {
    let found = unloadable.binary_search_by_key(&file, |module| module.file);
    found.is_ok()
}

fn imported_files(scans: &Scans, file: FileId) -> impl Iterator<Item = FileId> + '_ {
    let requests = scans.find(file).map_or(&[][..], |scan| &scan.requests);
    requests.iter().filter_map(|request| match request.target {
        ModuleRef::File(target) => Some(target),
        _ => None,
    })
}

fn is_found_late(input: &BindInput<'_, '_>, file: FileId, site: &ImportSite) -> bool {
    let (ImportSiteKind::Require(call) | ImportSiteKind::RequireResolve(call)) = site.kind else {
        return false;
    };
    let files = input.files;
    let decisions = &files.analysis(file).decisions;
    is_load_found_late(files.hir(file), files.bound(file), decisions, call)
}

fn written_files<'a>(
    input: &'a BindInput<'_, '_>,
    scans: &'a Scans,
    file: FileId,
) -> impl Iterator<Item = FileId> + 'a {
    let scan = scans.find(file);
    let answers = scan.map_or(&[][..], |scan| &scan.sites);
    let written = scan.map_or(&[][..], |_| input.files.analysis(file).import_sites);
    let sites = answers.iter().zip(written);
    sites.filter_map(move |(answer, site)| match *answer {
        ScannedSite::Module(ModuleRef::File(target)) if !is_found_late(input, file, site) => {
            Some(target)
        }
        _ => None,
    })
}

fn list_written_entry_points(input: &BindInput<'_, '_>) -> Vec<FileId> {
    let is_text = |file: FileId| is_name_of_text(input.sources.diagnostic_path(file));
    let entry_points = input.sources.entry_points().iter();
    let entry_points = entry_points.filter(|entry_point| !is_text(entry_point.file));
    let is_written = |file: FileId| !input.sources.is_entry_point_found_by_computed_name(file);
    let entry_points = entry_points.filter(|entry_point| is_written(entry_point.file));
    entry_points.map(|entry_point| entry_point.file).collect()
}

fn find_files_reached_from<Next: Iterator<Item = FileId>>(
    input: &BindInput<'_, '_>,
    mut left: Vec<FileId>,
    next: impl Fn(FileId) -> Next,
) -> Vec<bool> {
    let mut is_reached = vec![false; input.files.modules.len()];
    while let Some(file) = left.pop() {
        if !core::mem::replace(&mut is_reached[file.idx()], true) {
            left.extend(next(file));
        }
    }
    is_reached
}

fn find_modules_loaded_at_start(input: &BindInput<'_, '_>, scans: &Scans) -> Vec<bool> {
    // What the build found for a `Worker` loads when the worker starts, and a failure there is the worker's `error` event.
    let given = input.files.entry_points().iter();
    let given = given.take(input.written_entry_point_count);
    let given: FxHashSet<FileId> = given.copied().collect();
    let mut started = list_written_entry_points(input);
    started.retain(|file| given.contains(file));
    find_files_reached_from(input, started, |file| imported_files(scans, file))
}

pub(super) fn find_files_that_sites_name(input: &BindInput<'_, '_>, scans: &Scans) -> Vec<bool> {
    let next = |file| written_files(input, scans, file);
    find_files_reached_from(input, list_written_entry_points(input), next)
}

fn may_fail_where_loaded(
    input: &BindInput<'_, '_>,
    is_named_by_sites: &[bool],
    file: FileId,
) -> bool {
    input.sources.kind(file) == SourceKind::Program
        && (input.runs_tests || !is_named_by_sites[file.idx()])
}

fn lacks_jsx_module(pending: &PendingFailure) -> bool {
    matches!(pending.failure.kind, ModuleFailureKind::Unresolved { .. })
        && is_jsx_site(pending.failure.site)
}

fn requires_jsx_module_that_is_missing(scan: &FileScan) -> bool {
    scan.interop.kind == ModuleKind::CommonJs && scan.failures.iter().any(lacks_jsx_module)
}

/// Where no site of the program names the file, a name that the compiler refuses fails as a name that leads nowhere.
fn drop_targets_of_refused_names(input: &BindInput<'_, '_>, scans: &mut Scans) {
    let is_refused = |pending: &PendingFailure| pending.failure.is_refusal_of_compiler();
    let files = input.files.compiled_files().iter().copied();
    let refusing: Vec<FileId> = files
        .filter(|&file| (scans.find(file)).is_some_and(|scan| scan.failures.iter().any(is_refused)))
        .collect();
    if refusing.is_empty() || input.runs_tests {
        return;
    }
    let is_written = find_files_that_sites_name(input, scans);
    for file in refusing.into_iter().filter(|file| !is_written[file.idx()]) {
        let scan = scans.find_mut(file).expect("the file was scanned");
        for pending in scan.failures.iter_mut().filter(|it| is_refused(it)) {
            if let ModuleFailureKind::Unresolved { reason, .. } = &mut pending.failure.kind {
                *reason = CodeFailure::ModuleNotFound;
            }
        }
    }
}

pub(super) fn let_late_commonjs_files_fail_at_load(input: &BindInput<'_, '_>, scans: &mut Scans) {
    drop_targets_of_refused_names(input, scans);
    let files = input.files.compiled_files();
    let lacking = |file: &&FileId| {
        scans
            .find(**file)
            .is_some_and(requires_jsx_module_that_is_missing)
    };
    let lacking: Vec<FileId> = files.iter().filter(lacking).copied().collect();
    if lacking.is_empty() {
        return;
    }
    let is_written = find_files_that_sites_name(input, scans);
    for file in lacking {
        if is_written[file.idx()] && !input.runs_tests {
            continue;
        }
        let scan = scans.find_mut(file).expect("the file was scanned");
        for pending in scan.failures.iter_mut().filter(|it| lacks_jsx_module(it)) {
            if let ModuleFailureKind::Unresolved { specifier, reason } = pending.failure.kind {
                pending.failure.kind = ModuleFailureKind::UnresolvedAtLoad { specifier, reason };
            }
        }
    }
}

fn let_files_with_fold_errors_fail_at_load(input: &BindInput<'_, '_>, scans: &mut Scans) {
    let files = input.files.compiled_files();
    let has_errors = |file: &&FileId| !input.files.analysis(**file).errors.is_empty();
    let refused: Vec<FileId> = files.iter().filter(has_errors).copied().collect();
    if refused.is_empty() {
        return;
    }
    let is_named_by_sites = find_files_that_sites_name(input, scans);
    for file in refused {
        if scans.of(file).interop.kind != ModuleKind::SourceText
            || !may_fail_where_loaded(input, &is_named_by_sites, file)
            || find_load_failure(scans, file).is_some()
        {
            continue;
        }
        let after_every_site = u32::MAX as usize;
        let site = ImportSiteKind::ExportFrom(ExportId(0));
        let written = WrittenPart::new(after_every_site, SitePart::Specifier, site, 0..0);
        let kind = ModuleFailureKind::NotAProgram {
            is_loaded_at_start: true,
            is_silent: true,
        };
        let scan = scans.find_mut(file).expect("the file was scanned");
        scan.failures.push(written.fail(file, kind));
    }
}

/// The files that a mock may stand in for. Their importers fail only where the run loads the file itself.
pub(super) enum NamedByMocks<'a> {
    Files(&'a FxHashSet<ModuleRef>),
    AnyFile,
}

impl NamedByMocks<'_> {
    fn names(&self, file: FileId) -> bool {
        match self {
            NamedByMocks::Files(named) => named.contains(&ModuleRef::File(file)),
            NamedByMocks::AnyFile => true,
        }
    }
}

fn add_transitive_importers(
    input: &BindInput<'_, '_>,
    scans: &Scans,
    named_by_mocks: &NamedByMocks<'_>,
    is_found: &mut [bool],
    found: &mut Vec<UnloadableModule>,
) {
    let mut importers: Vec<Vec<FileId>> = vec![Vec::new(); is_found.len()];
    for &file in input.files.compiled_files() {
        for imported in imported_files(scans, file) {
            importers[imported.idx()].push(file);
        }
    }
    let mut next = 0;
    while let Some(&module) = found.get(next) {
        next += 1;
        let may_be_replaced = input.runs_tests
            && input.sources.kind(module.file) == SourceKind::Program
            && named_by_mocks.names(module.file);
        if may_be_replaced {
            continue;
        }
        for &importer in &importers[module.file.idx()] {
            if !core::mem::replace(&mut is_found[importer.idx()], true) {
                found.push(UnloadableModule {
                    file: importer,
                    through: Some(module.file),
                    ..module
                });
            }
        }
    }
}

fn is_refused_data(input: &BindInput<'_, '_>, file: FileId) -> bool {
    parsed_source(input.files, file)
        .is_some_and(|source| source.parse_failure.is_some() && source.refused_at.is_some())
}

/// The parser refuses the text, so nothing of the file runs.
fn is_refused_text(input: &BindInput<'_, '_>, scans: &Scans, file: FileId) -> bool {
    let is_module = scans
        .find(file)
        .is_some_and(|scan| scan.interop.kind == ModuleKind::SourceText);
    parsed_source(input.files, file).is_some_and(|source| source.parse_failure.is_some())
        || (is_module && !input.files.analysis(file).errors.is_empty())
}

/// Counts the requests of the file in front of the first that fails. None if every request finds a module.
fn count_preceding_requests(
    input: &BindInput<'_, '_>,
    scans: &Scans,
    file: FileId,
) -> Option<usize> {
    let scan = scans.find(file)?;
    if is_refused_text(input, scans, file) {
        return Some(0);
    }
    let mut requests = scan.requests.iter();
    let refused = requests.position(|request| match request.target {
        ModuleRef::File(target) => is_refused_text(input, scans, target),
        _ => false,
    });
    let mut failures = scan.failures.iter();
    let Some(first) = failures.find(|pending| fails_load(pending, false)) else {
        return refused;
    };
    if !matches!(first.failure.kind, ModuleFailureKind::Unresolved { .. }) {
        return Some(0);
    }
    let sites = input
        .files
        .analysis(file)
        .import_sites
        .iter()
        .zip(&scan.sites);
    let earlier = sites.take(first.order.site as usize);
    let targets: Vec<ModuleRef> = earlier
        .filter_map(|(site, answer)| match (site.kind, answer) {
            (
                ImportSiteKind::Import(_)
                | ImportSiteKind::ExportFrom(_)
                | ImportSiteKind::ExportStar(_),
                &ScannedSite::Module(target),
            ) => Some(target),
            _ => None,
        })
        .collect();
    let mut requests = scan.requests.iter();
    let unresolved = requests.position(|request| !targets.contains(&request.target));
    let unresolved = unresolved.unwrap_or(scan.requests.len());
    Some(refused.map_or(unresolved, |refused| refused.min(unresolved)))
}

/// `require()` of `root` walks its graph breadth first and runs each CommonJS file on the way. A failing request ends the requests of its own file only.
fn collect_commonjs_run_first(
    input: &BindInput<'_, '_>,
    scans: &Scans,
    root: FileId,
) -> Vec<FileId> {
    let (mut made, mut loaded) = (Vec::new(), vec![root]);
    let mut seen: FxHashSet<FileId> = loaded.iter().copied().collect();
    let mut next = 0;
    while let Some(&file) = loaded.get(next) {
        next += 1;
        let requests = scans.find(file).map_or(&[][..], |scan| &scan.requests);
        let count = count_preceding_requests(input, scans, file);
        for request in &requests[..count.unwrap_or(requests.len())] {
            let ModuleRef::File(target) = request.target else {
                continue;
            };
            if request.phase != ImportPhase::Evaluation || !seen.insert(target) {
                continue;
            }
            match scans.find(target).map(|scan| scan.interop.kind) {
                Some(ModuleKind::CommonJs) => made.push(target),
                Some(ModuleKind::SourceText) => loaded.push(target),
                _ => {}
            }
        }
    }
    made
}

/// Finds the files that `require()` loads and `import()` does not. A failing `import()` runs its CommonJS files in an order that varies.
fn find_require_only_files(
    input: &BindInput<'_, '_>,
    scans: &Scans,
) -> impl Fn(FileId) -> bool + use<> {
    let (mut required, mut imported) = (FxHashSet::default(), FxHashSet::default());
    let (mut requires_any_file, mut imports_any_file) = (false, false);
    for &file in input.files.compiled_files() {
        let scan = scans.of(file);
        let sites = input.files.analysis(file).import_sites.iter();
        for (site, answer) in sites.zip(&scan.sites) {
            let (loaded, loads_any_file) = match site.kind {
                ImportSiteKind::Require(_) | ImportSiteKind::ImportMetaRequire(_) => {
                    (&mut required, &mut requires_any_file)
                }
                ImportSiteKind::ImportCall(_) => (&mut imported, &mut imports_any_file),
                _ => continue,
            };
            let mut add = |target: ModuleRef| {
                if let ModuleRef::File(target) = target {
                    loaded.insert(target);
                }
            };
            match answer {
                &ScannedSite::Module(target) => add(target),
                // `bun test` runs no file before the failure where the name is computed.
                _ if input.runs_tests => {}
                ScannedSite::Candidates(range) => scan.modules_spelled_in(range).for_each(add),
                ScannedSite::AllModules => *loads_any_file = true,
                _ => {}
            }
        }
    }
    let requires_any_file = requires_any_file && !imports_any_file;
    move |file| !imported.contains(&file) && (requires_any_file || required.contains(&file))
}

/// The files that a load requests beside a file that does not parse. It calls the factories of their mocks and runs none of them.
fn find_mockable_requests(
    input: &BindInput<'_, '_>,
    scans: &Scans,
    named_by_mocks: &NamedByMocks<'_>,
    module: &UnloadableModule,
) -> Vec<FileId> {
    let NamedByMocks::Files(named) = named_by_mocks else {
        return Vec::new();
    };
    let refused = module
        .through
        .filter(|&file| is_refused_text(input, scans, file));
    let Some(_) = refused.filter(|_| input.runs_tests && !named.is_empty()) else {
        return Vec::new();
    };
    let is_kept = |file: FileId| {
        let is_module =
            (scans.find(file)).is_some_and(|scan| scan.interop.kind == ModuleKind::SourceText);
        is_module
            && named_by_mocks.names(file)
            && !input.files.analysis(file).has_live_top_level_await
    };
    imported_files(scans, module.file)
        .filter(|&file| is_kept(file))
        .collect()
}

fn limit_unloadable_requests(
    scan: &mut FileScan,
    through: Option<FileId>,
    run_first: &[FileId],
    mockable: &[FileId],
) {
    let mut is_first = true;
    scan.requests.retain_mut(|request| {
        if let ModuleRef::File(file) = request.target
            && mockable.contains(&file)
            && through != Some(file)
            && request.phase == ImportPhase::Evaluation
        {
            *request = RequestDraft {
                target: request.target,
                phase: ImportPhase::Defer,
                is_star_export: false,
                star_place: NO_STAR_PLACE,
            };
            return true;
        }
        let leads_to_failure = through.map(ModuleRef::File) == Some(request.target);
        leads_to_failure && core::mem::replace(&mut is_first, false)
    });
    let drafts = run_first.iter().map(|&file| RequestDraft {
        target: ModuleRef::File(file),
        phase: ImportPhase::Evaluation,
        is_star_export: false,
        star_place: NO_STAR_PLACE,
    });
    scan.requests.splice(0..0, drafts);
    scan.candidates.clear();
    scan.spellings.clear();
    scan.sites.fill(ScannedSite::Erased);
}

/// Finds the modules that import refused data and lead to no other failure.
fn find_refused_data_importers(
    input: &BindInput<'_, '_>,
    scans: &Scans,
    unloadable: &[UnloadableModule],
) -> Vec<UnloadableModule> {
    let files = input.files.compiled_files().iter().copied();
    let refused = files.filter(|&file| is_refused_data(input, file));
    let mut found: Vec<UnloadableModule> = refused
        .map(|file| UnloadableModule {
            file,
            importer: file,
            order: FailureOrder {
                site: 0,
                part: SitePart::Specifier,
            },
            through: None,
        })
        .collect();
    let data_count = found.len();
    if input.runs_tests || data_count == 0 {
        return Vec::new();
    }
    let mut is_found = vec![false; input.files.modules.len()];
    for module in unloadable.iter().chain(&found) {
        is_found[module.file.idx()] = true;
    }
    let named_by_mocks = NamedByMocks::Files(&FxHashSet::default());
    add_transitive_importers(input, scans, &named_by_mocks, &mut is_found, &mut found);
    found.drain(..data_count);
    let is_loaded_at_start = find_modules_loaded_at_start(input, scans);
    found.retain(|module| !is_loaded_at_start[module.file.idx()]);
    found
}

pub(super) fn find_unloadable_modules(
    input: &BindInput<'_, '_>,
    scans: &mut Scans,
) -> Vec<UnloadableModule> {
    let_files_with_fold_errors_fail_at_load(input, scans);
    let files = input.files.compiled_files();
    let with_failure_of_their_own = files.iter().filter_map(|&file| {
        let order = find_load_failure(scans, file)?;
        Some(UnloadableModule {
            file,
            importer: file,
            order,
            through: None,
        })
    });
    let mut found: Vec<UnloadableModule> = with_failure_of_their_own.collect();
    let refused_data_importers = find_refused_data_importers(input, scans, &found);
    if found.is_empty() && refused_data_importers.is_empty() {
        return found;
    }
    let file_count = input.files.modules.len();
    let mut is_found = vec![false; file_count];
    for module in &found {
        is_found[module.file.idx()] = true;
    }
    let named = match input.runs_tests && !input.mocks_any_module {
        true => find_modules_named_by_mocks(input, scans),
        false => (!input.runs_tests).then(FxHashSet::default),
    };
    let named_by_mocks = (named.as_ref()).map_or(NamedByMocks::AnyFile, NamedByMocks::Files);
    add_transitive_importers(input, scans, &named_by_mocks, &mut is_found, &mut found);
    let mut is_named = vec![false; file_count];
    for &file in files {
        for site in &scans.of(file).sites {
            if let &ScannedSite::Module(ModuleRef::File(target)) = site {
                is_named[target.idx()] = true;
            }
        }
    }
    let is_loaded_at_start = find_modules_loaded_at_start(input, scans);
    let is_late = |file: FileId| !is_loaded_at_start[file.idx()];
    if !input.runs_tests {
        found.retain(|module| is_late(module.file) && is_late(module.importer));
    }
    let is_only_required = find_require_only_files(input, scans);
    let modules = found.iter().chain(&refused_data_importers);
    let modules = modules.filter(|module| is_only_required(module.file));
    let run_first: FxHashMap<FileId, Vec<FileId>> = modules
        .map(|module| {
            let files = collect_commonjs_run_first(input, scans, module.file);
            (module.file, files)
        })
        .collect();
    let run_first_by = |file: FileId| run_first.get(&file).map_or(&[][..], |files| &files[..]);
    for module in &refused_data_importers {
        if found.iter().any(|it| it.file == module.file) {
            continue;
        }
        if let Some(scan) = scans.find_mut(module.file) {
            limit_unloadable_requests(scan, module.through, run_first_by(module.file), &[]);
        }
    }
    let mockable: Vec<Vec<FileId>> = found
        .iter()
        .map(|module| find_mockable_requests(input, scans, &named_by_mocks, module))
        .collect();
    for (module, mockable) in found.iter().zip(&mockable) {
        let build_says_nothing = !is_named[module.file.idx()]
            || parsed_source(input.files, module.file)
                .is_some_and(|source| !source.is_language_assumed);
        let scan = scans.find_mut(module.file);
        let scan = scan.expect("an unloadable module was scanned");
        limit_unloadable_requests(scan, module.through, run_first_by(module.file), mockable);
        let failures = scan.failures.iter_mut();
        for pending in failures.filter(|it| fails_load(it, false)) {
            pending.failure.kind =
                kind_thrown_at_load(pending.failure.kind, build_says_nothing, None);
        }
    }
    found.shared_sort_unstable_by_key(|module| module.file);
    found
}

pub(super) fn let_unlinkable_modules_fail_at_load(
    input: &BindInput<'_, '_>,
    scans: &Scans,
    is_named_by_sites: &[bool],
    pending: &mut [(FileId, Vec<PendingFailure>)],
    imports: &mut [FileImports],
    named_by_mocks: &NamedByMocks<'_>,
    unloadable: &mut Vec<UnloadableModule>,
) {
    debug_assert_eq!(pending.len(), imports.len());
    let mut found = Vec::new();
    for ((file, failures), imports) in pending.iter_mut().zip(imports) {
        let file = *file;
        if failures.is_empty()
            || is_unloadable(unloadable, file)
            || !may_fail_where_loaded(input, is_named_by_sites, file)
        {
            continue;
        }
        match scans.of(file).interop.kind {
            ModuleKind::SourceText => {}
            ModuleKind::CommonJs => {
                failures.retain(|it| find_missing_name(it.failure.kind).is_none());
                continue;
            }
            ModuleKind::Data
            | ModuleKind::RuntimeSource
            | ModuleKind::Runtime
            | ModuleKind::External => continue,
        }
        let Some(first) = failures.iter_mut().find(|it| fails_load(it, true)) else {
            continue;
        };
        let asked_by = find_failing_export_statement(input, scans.of(file), first);
        let missing = find_missing_name(first.failure.kind);
        (imports.required_names).extend(missing.map(|it| RequiredName { asked_by, ..it }));
        first.failure.kind = kind_thrown_at_load(first.failure.kind, true, asked_by);
        found.push(UnloadableModule {
            file,
            importer: file,
            order: first.order,
            through: None,
        });
    }
    if found.is_empty() {
        return;
    }
    let mut is_found = vec![false; input.files.modules.len()];
    for module in unloadable.iter().chain(&found) {
        is_found[module.file.idx()] = true;
    }
    add_transitive_importers(input, scans, named_by_mocks, &mut is_found, &mut found);
    unloadable.append(&mut found);
    unloadable.shared_sort_unstable_by_key(|module| module.file);
}

pub(super) fn drop_errors_of_unloadable_modules(
    pending: &mut [(FileId, Vec<PendingFailure>)],
    unloadable: &[UnloadableModule],
) {
    for (importer, failures) in pending {
        if is_unloadable(unloadable, *importer) {
            failures.retain(|pending| pending.failure.effect() != FailureEffect::StopsBuild);
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::modules::testing::{file_named, with_graph, with_test_run_graph};
    use crate::modules::{ModuleFailureId, ModuleFailureKind, ModuleKind, ModuleRef, RequiredName};

    #[test]
    fn importers_of_mocked_failures_load() {
        for is_mocked in [true, false] {
            let mock = match is_mocked {
                true => "import { vi } from 'bun:test'; vi.mock('./bad.js', () => ({ word: 1 }));",
                false => "",
            };
            let main = format!("{mock} import './above.js';");
            let files = [
                ("main.test.js", main.as_str()),
                (
                    "above.js",
                    "import { word } from './bad.js'; console.log(word);",
                ),
                (
                    "bad.js",
                    "import { absent } from './fine.js'; export const word = absent;",
                ),
                ("fine.js", "export {};"),
            ];
            with_test_run_graph(&files, |graph, input| {
                let fails = |name: &str| graph.load_failure(file_named(input, name)).is_some();
                assert!(graph.errors().is_empty(), "{:?}", graph.errors());
                let failing = ["bad.js", "above.js", "main.test.js"].map(fails);
                assert_eq!(failing, [true, !is_mocked, !is_mocked]);
            });
        }
    }

    const FILES: [(&str, &str); 4] = [
        (
            "main.test.js",
            "import './sibling.js'; import './above.js';",
        ),
        ("sibling.js", "console.log(1);"),
        (
            "above.js",
            "import { absent } from './fine.js'; console.log(absent);",
        ),
        ("fine.js", "export {};"),
    ];

    #[test]
    fn name_that_a_module_lacks_fails_the_load_in_a_test_run() {
        with_test_run_graph(&FILES, |graph, input| {
            let file = |name: &str| file_named(input, name);
            assert!(graph.errors().is_empty(), "{:?}", graph.errors());
            let [failure] = graph.failures() else {
                panic!("{:?}", graph.failures());
            };
            let fine = ModuleRef::File(file("fine.js"));
            assert!(matches!(
                failure.kind,
                ModuleFailureKind::ExportMayBeAbsent { exporter, .. } if exporter == fine
            ));
            assert_eq!(failure.importer, file("above.js"));
            let absent = input.files.atoms.intern(b"absent");
            assert_eq!(
                graph.required_names(file("above.js")),
                [RequiredName::new(fine, absent)]
            );
            let names = ["main.test.js", "sibling.js", "above.js", "fine.js"];
            let thrown = Some(ModuleFailureId(0));
            let load_failures = names.map(|name| graph.load_failure(file(name)));
            assert_eq!(load_failures, [thrown, None, thrown, None]);
            for name in ["main.test.js", "above.js"] {
                let hir = input.files.hir(file(name));
                let is_erased = |statement| graph.erased(file(name), statement);
                assert!(hir.ids(hir.body).all(is_erased), "{name}");
            }
            let mut requests = graph.requests(file("above.js")).iter();
            assert!(requests.any(|request| request.target == fine));
        });
    }

    #[test]
    fn name_that_a_module_lacks_stops_the_build_of_an_executable_that_spells_the_file() {
        with_graph(&FILES, |graph, input| {
            let [error] = graph.errors() else {
                panic!("{:?}", graph.errors());
            };
            assert!(matches!(
                error.kind,
                ModuleFailureKind::ExportNotFound { .. }
            ));
            assert_eq!(error.importer, file_named(input, "above.js"));
            assert_eq!(graph.unloadable_files().count(), 0);
        });
    }

    #[test]
    fn name_that_the_jsx_of_a_commonjs_file_lacks_fails_no_load_in_a_test_run() {
        let files = [
            ("main.test.jsx", "module.exports = <div />;"),
            ("node_modules/react/package.json", r#"{ "name": "react" }"#),
            ("node_modules/react/jsx-dev-runtime.js", "export {};"),
        ];
        with_test_run_graph(&files, |graph, input| {
            let main = file_named(input, "main.test.jsx");
            assert_eq!(graph.kind(main), ModuleKind::CommonJs);
            assert!(graph.errors().is_empty(), "{:?}", graph.errors());
            assert!(graph.failures().is_empty(), "{:?}", graph.failures());
            assert_eq!(graph.unloadable_files().count(), 0);
        });
    }
}
