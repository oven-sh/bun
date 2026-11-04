use super::BindInput;
use super::bindings::RequiredName;
use super::failures::{
    FailureEffect, FailureOrder, ModuleFailureKind, PendingFailure, SitePart, WrittenPart,
};
use super::imports::FileImports;
use super::interop::ModuleKind;
use super::plan::ModuleRef;
use super::requests::{FileScan, ScannedSite, Scans, is_jsx_site};
use crate::load::sources::{SourceKind, parsed_source};
use bun_sema::hir::ExportId;
use bun_sema::import_sites::ImportSiteKind;
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

/// The name that a link of the importer looks for and does not find.
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

fn kind_thrown_at_load(kind: ModuleFailureKind, build_says_nothing: bool) -> ModuleFailureKind {
    match kind {
        ModuleFailureKind::Unresolved { specifier, reason } => {
            ModuleFailureKind::UnresolvedAtLoad { specifier, reason }
        }
        ModuleFailureKind::NotAProgram { is_silent, .. } => ModuleFailureKind::NotAProgram {
            is_loaded_at_start: false,
            is_silent: is_silent || build_says_nothing,
        },
        // The link and the run time have one record for a name that a module lacks, and the error that they make of it says that the name is not found.
        ModuleFailureKind::ExportNotFound { exporter, name }
        | ModuleFailureKind::ExportAmbiguous { exporter, name } => {
            ModuleFailureKind::ExportMayBeAbsent {
                exporter,
                name,
                asked_by: None,
            }
        }
        ModuleFailureKind::UnresolvedAtLoad { .. }
        | ModuleFailureKind::ExportMayBeAbsent { .. } => kind,
    }
}

fn find_load_failure(scans: &Scans, file: FileId) -> Option<FailureOrder> {
    let scan = scans.find(file)?;
    // The body of a file of data would throw too, but the run time keeps the error of a file with code alone: the next load finds the file of data evaluated, and reads a variable that nothing has filled.
    if scan.interop.kind != ModuleKind::SourceText {
        return None;
    }
    // Exports are resolved after the scans, so a scan holds neither `ExportNotFound` nor `ExportAmbiguous`.
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

pub(super) fn find_files_that_sites_name(input: &BindInput<'_, '_>, scans: &Scans) -> Vec<bool> {
    find_files_reached_from_entry_points(input, |file| written_files(scans, file))
}

// One file with a mistake costs a test run what `bun test` loses to it, and an executable holds files that only a computed name may find. A mistake in a file of Bun's own is a fault of the compiler.
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

// `bun run` reports a fold error when its loader reads the file.
fn let_files_with_fold_errors_fail_at_load(input: &BindInput<'_, '_>, scans: &mut Scans) {
    let files = input.files.compiled_files();
    let has_errors = |file: &&FileId| !input.files.analysis(**file).errors.is_empty();
    let refused: Vec<FileId> = files.iter().filter(has_errors).copied().collect();
    if refused.is_empty() {
        return;
    }
    let is_named_by_sites = find_files_that_sites_name(input, scans);
    for file in refused {
        // Only the body of an ES module throws what its load ends with.
        if scans.of(file).interop.kind != ModuleKind::SourceText
            || !may_fail_where_loaded(input, &is_named_by_sites, file)
            || find_load_failure(scans, file).is_some()
        {
            continue;
        }
        // A scan's failures are sorted by order, and no site has this number.
        let after_every_site = u32::MAX as usize;
        let site = ImportSiteKind::ExportFrom(ExportId(0));
        let written = WrittenPart::new(after_every_site, SitePart::Specifier, site, 0..0);
        // `find_unloadable_modules` clears the flag: it keeps every module of a test run, and outside one a file that no site names is never loaded at start.
        let kind = ModuleFailureKind::NotAProgram {
            is_loaded_at_start: true,
            is_silent: true,
        };
        let scan = scans.find_mut(file).expect("the file was scanned");
        scan.failures.push(written.fail(file, kind));
    }
}

/// `is_found`: by file, set for each of `found`, and for whatever else is not to be added.
fn add_transitive_importers(
    input: &BindInput<'_, '_>,
    scans: &Scans,
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

// An `import` or `export .. from` that names nothing, or a file that is no program, fails the load of every module that reaches it through such statements, before one of them runs.
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
    if found.is_empty() {
        return found;
    }
    let file_count = input.files.modules.len();
    let mut is_found = vec![false; file_count];
    for module in &found {
        is_found[module.file.idx()] = true;
    }
    add_transitive_importers(input, scans, &mut is_found, &mut found);
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
        let build_says_nothing = !is_named[module.file.idx()]
            || parsed_source(input.files, module.file)
                .is_some_and(|source| !source.is_language_assumed);
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
        let failures = scan.failures.iter_mut();
        for pending in failures.filter(|it| fails_load(it, false)) {
            pending.failure.kind = kind_thrown_at_load(pending.failure.kind, build_says_nothing);
        }
    }
    found.shared_sort_unstable_by_key(|module| module.file);
    found
}

// A name that a module lacks, or that two stars export, fails the link of every module that imports it through import statements.
// The run-time link looks for the required name and throws before any of them runs. The body that throws is for a link that lets the name pass, as it does where a mock stands in place of the exporter.
/// `pending` and `imports`: by compiled file, in one order. A list of `pending` has what the file exports ahead of what it imports, as a link looks for the names.
/// `is_named_by_sites`: `find_files_that_sites_name`.
pub(super) fn let_unlinkable_modules_fail_at_load(
    input: &BindInput<'_, '_>,
    scans: &Scans,
    is_named_by_sites: &[bool],
    pending: &mut [(FileId, Vec<PendingFailure>)],
    imports: &mut [FileImports],
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
            // Nothing links a CommonJS file. It reads the names of its JSX off what `require` answers, and a name that is not there is undefined.
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
        imports
            .required_names
            .extend(find_missing_name(first.failure.kind));
        first.failure.kind = kind_thrown_at_load(first.failure.kind, true);
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
    // A module that is bound to the variables of one whose body is erased may run first, on a cycle.
    add_transitive_importers(input, scans, &mut is_found, &mut found);
    unloadable.append(&mut found);
    unloadable.shared_sort_unstable_by_key(|module| module.file);
}

// Under `bun run` a name that a module lacks is found out when the graph is linked, and this graph is never fetched whole.
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
