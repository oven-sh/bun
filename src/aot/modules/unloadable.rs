use super::BindInput;
use super::failures::{FailureEffect, FailureOrder, ModuleFailureKind, PendingFailure};
use super::interop::ModuleKind;
use super::plan::ModuleRef;
use super::requests::{FileScan, ScannedSite, Scans, is_jsx_site};
use crate::load::sources::parsed_source;
use bun_sema::program::FileId;
use bun_sema::util::SharedSort;

/// A module whose load fails, and where the import that names nothing stands.
#[derive(Copy, Clone, Debug)]
pub(super) struct UnloadableModule {
    pub file: FileId,
    pub importer: FileId,
    pub order: FailureOrder,
    /// The module that it imports and that fails its load. `None`: the import that names nothing is its own.
    through: Option<FileId>,
}

fn fails_load(pending: &PendingFailure) -> bool {
    matches!(
        pending.failure.kind,
        ModuleFailureKind::Unresolved { .. } | ModuleFailureKind::NotAProgram { .. }
    ) && pending.failure.effect() == FailureEffect::StopsBuild
}

fn find_load_failure(scans: &Scans, file: FileId) -> Option<FailureOrder> {
    let scan = scans.find(file)?;
    if scan.interop.kind != ModuleKind::SourceText {
        return None;
    }
    let first = scan.failures.iter().find(|pending| fails_load(pending));
    first.map(|pending| pending.order)
}

fn imported_files(scans: &Scans, file: FileId) -> impl Iterator<Item = FileId> + '_ {
    let requests = scans.find(file).map_or(&[][..], |scan| &scan.requests);
    requests.iter().filter_map(|request| match request.target {
        ModuleRef::File(target) => Some(target),
        _ => None,
    })
}

fn written_files(scans: &Scans, file: FileId) -> impl Iterator<Item = FileId> + '_ {
    let sites = scans.find(file).map_or(&[][..], |scan| &scan.sites);
    sites.iter().filter_map(|site| match *site {
        ScannedSite::Module(ModuleRef::File(target)) => Some(target),
        _ => None,
    })
}

fn find_files_reached_from_entry_points<Next: Iterator<Item = FileId>>(
    input: &BindInput<'_, '_>,
    next: impl Fn(FileId) -> Next,
) -> Vec<bool> {
    let mut is_reached = vec![false; input.files.modules.len()];
    let entry_points = input.sources.entry_points().iter();
    let mut left: Vec<FileId> = entry_points.map(|entry_point| entry_point.file).collect();
    while let Some(file) = left.pop() {
        if !core::mem::replace(&mut is_reached[file.idx()], true) {
            left.extend(next(file));
        }
    }
    is_reached
}

fn find_modules_loaded_at_start(input: &BindInput<'_, '_>, scans: &Scans) -> Vec<bool> {
    find_files_reached_from_entry_points(input, |file| imported_files(scans, file))
}

fn lacks_jsx_module(pending: &PendingFailure) -> bool {
    matches!(pending.failure.kind, ModuleFailureKind::Unresolved { .. })
        && is_jsx_site(pending.failure.site)
}

fn requires_jsx_module_that_is_missing(scan: &FileScan) -> bool {
    scan.interop.kind == ModuleKind::CommonJs && scan.failures.iter().any(lacks_jsx_module)
}

// A CommonJS file requires the modules of its JSX at the head of its body. Where only a computed path may find the file, that require fails when the file is loaded, as under `bun run`.
pub(super) fn let_late_commonjs_files_fail_at_load(input: &BindInput<'_, '_>, scans: &mut Scans) {
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
    let is_written = find_files_reached_from_entry_points(input, |file| written_files(scans, file));
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

// An `import` or `export .. from` that names nothing, or a file that is no program, fails the load of every module that reaches it through such statements, before one of them runs.
pub(super) fn find_unloadable_modules(
    input: &BindInput<'_, '_>,
    scans: &mut Scans,
) -> Vec<UnloadableModule> {
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
    if found.is_empty() {
        return found;
    }
    let file_count = input.files.modules.len();
    let mut importers: Vec<Vec<FileId>> = vec![Vec::new(); file_count];
    for &file in files {
        for imported in imported_files(scans, file) {
            importers[imported.idx()].push(file);
        }
    }
    let mut is_found = vec![false; file_count];
    for module in &found {
        is_found[module.file.idx()] = true;
    }
    let mut next = 0;
    while let Some(&module) = found.get(next) {
        next += 1;
        for &importer in &importers[module.file.idx()] {
            // Each of its statements stands for a load by a file of its own, which fails alone.
            if input.stand_in_for_files_from_disk == Some(importer) {
                continue;
            }
            if !core::mem::replace(&mut is_found[importer.idx()], true) {
                found.push(UnloadableModule {
                    file: importer,
                    through: Some(module.file),
                    ..module
                });
            }
        }
    }
    let mut is_named = vec![false; file_count];
    for &file in files {
        for site in &scans.of(file).sites {
            if let &ScannedSite::Module(ModuleRef::File(target)) = site {
                is_named[target.idx()] = true;
            }
        }
    }
    // Where the import that names nothing is loaded at start, it stops the build, whoever else reaches it.
    let is_loaded_at_start = find_modules_loaded_at_start(input, scans);
    let is_late = |file: FileId| !is_loaded_at_start[file.idx()];
    // In a test run each test file loads on its own, and one that fails fails alone, as under `bun test`.
    if !input.runs_tests {
        found.retain(|module| is_late(module.file) && is_late(module.importer));
    }
    for module in &found {
        let scan = scans.find_mut(module.file);
        let scan = scan.expect("an unloadable module was scanned");
        let mut is_first = true;
        scan.requests.retain(|request| {
            let leads_to_failure = module.through.map(ModuleRef::File) == Some(request.target);
            leads_to_failure && core::mem::replace(&mut is_first, false)
        });
        scan.candidates.clear();
        scan.spellings.clear();
        scan.sites.fill(ScannedSite::Erased);
        for pending in scan.failures.iter_mut().filter(|it| fails_load(it)) {
            pending.failure.kind = match pending.failure.kind {
                ModuleFailureKind::Unresolved { specifier, reason } => {
                    ModuleFailureKind::UnresolvedAtLoad { specifier, reason }
                }
                ModuleFailureKind::NotAProgram { .. } => ModuleFailureKind::NotAProgram {
                    is_loaded_at_start: false,
                    is_silent: !is_named[module.file.idx()]
                        || parsed_source(input.files, module.file)
                            .is_some_and(|source| !source.is_language_assumed),
                },
                kind => kind,
            };
        }
    }
    found.shared_sort_unstable_by_key(|module| module.file);
    found
}

// Under `bun run` a name that a module lacks is found out when the graph is linked, and this graph is never fetched whole.
pub(super) fn drop_errors_of_unloadable_modules(
    pending: &mut [(FileId, Vec<PendingFailure>)],
    unloadable: &[UnloadableModule],
) {
    for (importer, failures) in pending {
        let found = unloadable.binary_search_by_key(importer, |module| module.file);
        if found.is_ok() {
            failures.retain(|pending| pending.failure.effect() != FailureEffect::StopsBuild);
        }
    }
}
