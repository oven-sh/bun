use super::interop::{Interop, file_interop};
use super::requests::{ScannedSite, Scans};
use super::wrapped::WrappedModules;
use super::{BindInput, ModuleRef, compare_modules};
use bun_sema::atom::Atom;
use bun_sema::hir::FnId;
use bun_sema::program::{FileId, FileRole};
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
    ModuleSet {
        compiled_files,
        record_files: with_record.collect(),
        other_modules,
        external_kinds,
        wrapped,
        inner_modules,
        interops,
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
