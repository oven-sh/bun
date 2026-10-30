use super::interop::{Interop, ModuleKind, RequireResult, file_interop};
use super::requests::{ScannedSite, Scans};
use super::wrapped::WrappedModules;
use super::{BindInput, ModuleRef, compare_modules};
use crate::load::sources::parsed_source;
use bun_ast::Loader;
use bun_core::strings;
use bun_sema::atom::Atom;
use bun_sema::bind::{Binding, CommonJsVariable};
use bun_sema::hir::{ExprKind, FnId};
use bun_sema::import_sites::{ImportSiteKind, find_module_printed_as_require};
use bun_sema::program::{FileId, FileRole, Files};
use bun_sema::resolve::ExternalKind;
use bun_sema::util::SharedSort;

pub(super) struct ModuleSet {
    pub compiled_files: Vec<FileId>,
    pub record_files: Vec<FileId>,
    pub other_modules: Vec<ModuleRef>,
    pub external_kinds: Vec<((FileId, Atom), ExternalKind)>,
    /// The callbacks of `__commonJS(cb)` and `__esm(fn)` that are modules of their own.
    pub wrapped: WrappedModules,
    inner_modules: Vec<(FileId, FnId)>,
    interops: Vec<Option<Interop>>,
    /// By file: `a.txt?text` is a form of `a.txt`.
    forms: Vec<(FileId, FileId)>,
}

impl ModuleSet {
    pub(super) fn interop(&self, module: ModuleRef) -> Interop {
        match module {
            ModuleRef::File(file) => {
                self.interops[file.idx()].expect("a file without a module record")
            }
            ModuleRef::Inner { .. } => Interop::INNER_MODULE,
            ModuleRef::Face(_) | ModuleRef::Check(_) => Interop::ES_MODULE,
            ModuleRef::Runtime(_) => Interop::RUNTIME,
            ModuleRef::External {
                importer,
                specifier,
            } => Interop::of_external(self.external_kind(importer, specifier)),
        }
    }

    pub(super) fn find_commonjs_file(&self, module: ModuleRef) -> Option<FileId> {
        match module {
            ModuleRef::File(file) if self.interop(module).kind == ModuleKind::CommonJs => {
                Some(file)
            }
            _ => None,
        }
    }

    /// What import attributes make of the file. The loader of `bun run` keeps them under the path of the file, where a mock finds them.
    pub(super) fn forms_of(&self, module: ModuleRef) -> impl Iterator<Item = ModuleRef> + '_ {
        let forms = match module {
            ModuleRef::File(file) => {
                let start = self.forms.partition_point(|entry| entry.0 < file);
                let count = self.forms[start..].partition_point(|entry| entry.0 == file);
                &self.forms[start..start + count]
            }
            _ => &[],
        };
        forms.iter().map(|entry| ModuleRef::File(entry.1))
    }

    pub(super) fn table_file(&self, module: ModuleRef) -> Option<FileId> {
        match module {
            ModuleRef::File(file) if self.interop(module).has_export_table() => Some(file),
            _ => None,
        }
    }

    /// By file and callback, in ascending order.
    pub(super) fn inner_modules(&self) -> &[(FileId, FnId)] {
        &self.inner_modules
    }

    pub(super) fn inner_module_position(&self, file: FileId, callback: FnId) -> Option<usize> {
        self.inner_modules.binary_search(&(file, callback)).ok()
    }

    /// A later site of a module whose body threw throws the same error again.
    pub(super) fn keeps_error(&self, module: ModuleRef) -> bool {
        match module {
            ModuleRef::File(_) | ModuleRef::Face(_) | ModuleRef::Check(_) => true,
            // As the text of the helper has it.
            ModuleRef::Inner { file, callback } => {
                let inner = self.wrapped.of_callback(file, callback);
                inner.is_some_and(|inner| inner.keeps_error)
            }
            ModuleRef::Runtime(_) | ModuleRef::External { .. } => false,
        }
    }

    pub(super) fn is_uncompiled_code(&self, module: ModuleRef) -> bool {
        match module {
            ModuleRef::External {
                importer,
                specifier,
            } => match self.external_kind(importer, specifier) {
                ExternalKind::UncompiledCode => true,
                ExternalKind::HostValue => false,
            },
            _ => false,
        }
    }

    fn external_kind(&self, importer: FileId, specifier: Atom) -> ExternalKind {
        let kinds = &self.external_kinds;
        let key = external_key((importer, specifier));
        let index = kinds.binary_search_by_key(&key, |entry| external_key(entry.0));
        debug_assert!(index.is_ok(), "no import site names this external module");
        index.map_or(ExternalKind::UncompiledCode, |index| kinds[index].1)
    }
}

pub(super) fn collect_modules(input: &BindInput<'_, '_>, scans: &Scans) -> ModuleSet {
    let files = input.files;
    let wrapped = WrappedModules::compute(files, input.known_helpers, input.in_parallel);
    let mut compiled_files = files.compiled_files().to_vec();
    compiled_files.shared_sort_unstable();
    debug_assert!(compiled_files.is_sorted_by(|a, b| a < b));
    let mut interops: Vec<Option<Interop>> = vec![None; files.modules.len()];
    for &file in &compiled_files {
        interops[file.idx()] = Some(scans.of(file).interop);
    }
    answer_require_with_namespace_of_imported_data(input, scans, &mut interops);
    // `bun run` answers `require()` of a text file with its namespace, `{ default }`. `bun build --compile` answers the text where it links the call.
    let required_from_loader = match input.runs_in_place {
        true => compiled_files.clone(),
        false => find_files_required_from_loader(input, scans, &compiled_files),
    };
    for file in required_from_loader {
        let is_text = parsed_source(files, file).is_some_and(|it| it.loader == Loader::Text);
        if let Some(interop) = interops[file.idx()]
            .as_mut()
            .filter(|it| is_text && it.kind == ModuleKind::Data)
        {
            interop.require_result = RequireResult::Namespace;
        }
    }
    leave_require_of_data_imported_later_to_loader(input, scans, &compiled_files, &mut interops);
    let mut other_modules = Vec::new();
    let mut external_kinds = Vec::new();
    for &importer in &compiled_files {
        let scan = scans.of(importer);
        let site_modules = scan.sites.iter().filter_map(|site| match site {
            ScannedSite::Module(module) => Some(*module),
            _ => None,
        });
        for module in site_modules.chain(scan.candidates.iter().copied()) {
            match module {
                ModuleRef::File(file) => ensure_record(input, &mut interops, file),
                ModuleRef::Runtime(_) | ModuleRef::External { .. } => other_modules.push(module),
                ModuleRef::Inner { .. } | ModuleRef::Face(_) | ModuleRef::Check(_) => {
                    unreachable!("no specifier names such a module")
                }
            }
        }
        let externals = scan.externals.iter();
        external_kinds.extend(externals.map(|&(specifier, kind)| ((importer, specifier), kind)));
    }
    for entry_point in input.sources.entry_points() {
        ensure_record(input, &mut interops, entry_point.file);
    }
    if let Some(entry_point) = input.sources.entry_points().first() {
        let importer = entry_point.file;
        for package in input.external_packages {
            let specifier = files.atoms.intern(package);
            other_modules.push(ModuleRef::External {
                importer,
                specifier,
            });
            external_kinds.push(((importer, specifier), ExternalKind::UncompiledCode));
        }
    }
    other_modules.shared_sort_unstable_by(|&a, &b| compare_modules(a, b, &files.atoms));
    other_modules.dedup();
    merge_external_kinds(&mut external_kinds);
    let all_files = (0..interops.len() as u32).map(FileId);
    let with_record = all_files.filter(|file| interops[file.idx()].is_some());
    let callbacks_of = |&file: &FileId| {
        wrapped
            .of_file(file)
            .iter()
            .map(move |it| (file, it.callback))
    };
    let mut inner_modules: Vec<(FileId, FnId)> =
        compiled_files.iter().flat_map(callbacks_of).collect();
    inner_modules.shared_sort_unstable();
    let forms = find_forms(input, &compiled_files, &interops);
    ModuleSet {
        forms,
        compiled_files,
        record_files: with_record.collect(),
        other_modules,
        external_kinds,
        wrapped,
        inner_modules,
        interops,
    }
}

fn find_forms(
    input: &BindInput<'_, '_>,
    compiled_files: &[FileId],
    interops: &[Option<Interop>],
) -> Vec<(FileId, FileId)> {
    let is_data =
        |file: &&FileId| interops[file.idx()].is_some_and(|it| it.kind == ModuleKind::Data);
    let data_files: Vec<FileId> = compiled_files.iter().filter(is_data).copied().collect();
    let path_of = |file: FileId| input.sources.public_path(file);
    let mut forms = Vec::new();
    for &form in &data_files {
        let path = path_of(form);
        let Some(mark) = strings::last_index_of_char(path, b'?') else {
            continue;
        };
        let files = compiled_files
            .iter()
            .filter(|&&file| path_of(file) == &path[..mark]);
        forms.extend(files.map(|&file| (file, form)));
    }
    forms.shared_sort_unstable();
    forms
}

/// The file is parsed into a value. Any other file stands for something in an executable, which `require()` answers: its path, an addon.
fn is_parsed_into_value(input: &BindInput<'_, '_>, file: FileId) -> bool {
    parsed_source(input.files, file).is_some_and(|source| {
        matches!(
            source.loader,
            Loader::Json
                | Loader::Jsonc
                | Loader::Json5
                | Loader::Toml
                | Loader::Yaml
                | Loader::Text
        )
    })
}

// `bun build` links `require(K)`, `module.require(K)` and `import a = require(K)`.
fn is_linked_by_bundler(files: &Files<'_>, importer: FileId, site: ImportSiteKind) -> bool {
    let call = match site {
        ImportSiteKind::ImportEquals(_) => return true,
        ImportSiteKind::Require(call) => call,
        _ => return false,
    };
    let (hir, bound) = (files.hir(importer), files.bound(importer));
    let ExprKind::Call(call) = hir[call].kind else {
        return false;
    };
    let callee = hir.skip_type_assertions(hir[call].callee);
    let is_require_of_file = matches!(hir[callee].kind, ExprKind::Ident(_))
        && bound.binding(callee) == Binding::CommonJs(CommonJsVariable::Require);
    is_require_of_file || find_module_printed_as_require(hir, bound, callee).is_some()
}

// In an executable of `bun build --compile` the loader of `bun run` answers every other call: what `createRequire` made, `import.meta.require`,
// `require` under another name, a computed path. A path that nothing is known about names no file here: it would change the answer of calls far from it.
fn find_files_required_from_loader(
    input: &BindInput<'_, '_>,
    scans: &Scans,
    compiled_files: &[FileId],
) -> Vec<FileId> {
    let mut found = Vec::new();
    for &importer in compiled_files {
        let scan = scans.of(importer);
        let sites = input.files.analysis(importer).import_sites.iter();
        for (site, scanned) in sites.zip(&scan.sites) {
            let requires = matches!(
                site.kind,
                ImportSiteKind::Require(_)
                    | ImportSiteKind::ImportMetaRequire(_)
                    | ImportSiteKind::ImportEquals(_)
            );
            let mut add = |module: ModuleRef| {
                if let ModuleRef::File(file) = module {
                    found.push(file);
                }
            };
            match scanned {
                _ if !requires => {}
                &ScannedSite::Module(module) => {
                    if !is_linked_by_bundler(input.files, importer, site.kind) {
                        add(module);
                    }
                }
                ScannedSite::Candidates(range) => {
                    let spelled = &scan.spellings[range.start as usize..range.end as usize];
                    spelled.iter().for_each(|it| add(it.module));
                }
                ScannedSite::AllModules | ScannedSite::Unresolved | ScannedSite::Erased => {}
            }
        }
    }
    found
}

// `require()` answers the namespace object of a file that the loader of ES modules already holds, and it holds all that an entry point imports before any code runs.
fn answer_require_with_namespace_of_imported_data(
    input: &BindInput<'_, '_>,
    scans: &Scans,
    interops: &mut [Option<Interop>],
) {
    let entry_points = input.sources.entry_points().iter();
    let mut pending: Vec<FileId> = entry_points.map(|it| it.file).collect();
    let mut is_seen = vec![false; interops.len()];
    while let Some(file) = pending.pop() {
        if core::mem::replace(&mut is_seen[file.idx()], true) {
            continue;
        }
        let (Some(interop), Some(scan)) = (&mut interops[file.idx()], scans.find(file)) else {
            continue;
        };
        if interop.kind == ModuleKind::Data && is_parsed_into_value(input, file) {
            interop.require_result = RequireResult::Namespace;
        }
        pending.extend(scan.requests.iter().filter_map(|it| match it.target {
            ModuleRef::File(target) => Some(target),
            _ => None,
        }));
    }
}

// Whether an import outside of that graph comes before the first `require()` of the file shows when the program runs.
fn leave_require_of_data_imported_later_to_loader(
    input: &BindInput<'_, '_>,
    scans: &Scans,
    compiled_files: &[FileId],
    interops: &mut [Option<Interop>],
) {
    let mut leave = |file: FileId| {
        if let Some(interop) = &mut interops[file.idx()]
            && interop.kind == ModuleKind::Data
            && interop.require_result == RequireResult::DefaultExport
            && is_parsed_into_value(input, file)
        {
            interop.require_result = RequireResult::NamespaceIfImported;
        }
    };
    for &importer in compiled_files {
        let scan = scans.of(importer);
        let sites = input.files.analysis(importer).import_sites.iter();
        for (site, scanned) in sites.zip(&scan.sites) {
            let imports = matches!(
                site.kind,
                ImportSiteKind::Import(_)
                    | ImportSiteKind::ExportFrom(_)
                    | ImportSiteKind::ExportStar(_)
                    | ImportSiteKind::ImportCall(_)
            );
            let targets = match scanned {
                _ if !imports => &[][..],
                ScannedSite::Module(module) => core::slice::from_ref(module),
                ScannedSite::Candidates(_) => &scan.candidates[..],
                ScannedSite::AllModules => return compiled_files.iter().copied().for_each(leave),
                ScannedSite::Unresolved | ScannedSite::Erased => &[][..],
            };
            for target in targets {
                if let ModuleRef::File(target) = *target {
                    leave(target);
                }
            }
        }
    }
}

fn ensure_record(input: &BindInput<'_, '_>, interops: &mut [Option<Interop>], file: FileId) {
    let interop = &mut interops[file.idx()];
    if interop.is_some() {
        return;
    }
    debug_assert_eq!(input.files.role(file), FileRole::TypesOnly);
    *interop = Some(file_interop(input.files, input.sources, file));
}

fn external_key(key: (FileId, Atom)) -> (FileId, u32) {
    (key.0, key.1.0)
}

fn join_external_kinds(a: ExternalKind, b: ExternalKind) -> ExternalKind {
    match (a, b) {
        (ExternalKind::HostValue, ExternalKind::HostValue) => ExternalKind::HostValue,
        (ExternalKind::UncompiledCode, ExternalKind::UncompiledCode | ExternalKind::HostValue)
        | (ExternalKind::HostValue, ExternalKind::UncompiledCode) => ExternalKind::UncompiledCode,
    }
}

fn merge_external_kinds(kinds: &mut Vec<((FileId, Atom), ExternalKind)>) {
    kinds.shared_sort_unstable_by_key(|entry| external_key(entry.0));
    kinds.dedup_by(|later, earlier| {
        let is_same_module = later.0 == earlier.0;
        if is_same_module {
            earlier.1 = join_external_kinds(earlier.1, later.1);
        }
        is_same_module
    });
}
