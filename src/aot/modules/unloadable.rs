use super::BindInput;
use super::failures::{FailureEffect, FailureOrder, ModuleFailureKind, PendingFailure};
use super::interop::ModuleKind;
use super::plan::ModuleRef;
use super::requests::{ScannedSite, Scans};
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

fn find_modules_loaded_at_start(input: &BindInput<'_, '_>, scans: &Scans) -> Vec<bool> {
    let mut is_loaded = vec![false; input.files.modules.len()];
    let entry_points = input.sources.entry_points().iter();
    let mut left: Vec<FileId> = entry_points.map(|entry_point| entry_point.file).collect();
    while let Some(file) = left.pop() {
        if !core::mem::replace(&mut is_loaded[file.idx()], true) {
            left.extend(imported_files(scans, file));
        }
    }
    is_loaded
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
            if !core::mem::replace(&mut is_found[importer.idx()], true) {
                found.push(UnloadableModule {
                    file: importer,
                    through: Some(module.file),
                    ..module
                });
            }
        }
    }
    // Where the import that names nothing is loaded at start, it stops the build, whoever else reaches it.
    let is_loaded_at_start = find_modules_loaded_at_start(input, scans);
    let is_late = |file: FileId| !is_loaded_at_start[file.idx()];
    found.retain(|module| is_late(module.file) && is_late(module.importer));
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
