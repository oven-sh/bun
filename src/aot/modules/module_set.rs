use super::interop::{Interop, ModuleKind, RequireResult, file_interop};
use super::requests::{ScannedSite, Scans};
use super::wrapped::WrappedModules;
use super::{BindInput, ModuleRef, compare_modules};
use crate::load::loaders::{HostLoaderKind, host_loader_kind};
use crate::load::sources::parsed_source;
use crate::load::{EntryPointKind, SourceKind};
use crate::module_keys::{DEFAULT_LOADERS, loader_named_by_path, parses_text_as_data};
use bun_ast::Loader;
use bun_core::strings;
use bun_sema::atom::Atom;
use bun_sema::hir::FnId;
use bun_sema::import_sites::{ImportSiteKind, is_linked_by_bundler};
use bun_sema::program::{CodeAnswer, FileId, FileRole};
use bun_sema::resolve::ExternalKind;
use bun_sema::util::SharedSort;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum ImportTypeKind {
    None,
    Json,
    HostDefined,
}

pub(super) struct ModuleSet {
    pub compiled_files: Vec<FileId>,
    pub record_files: Vec<FileId>,
    pub other_modules: Vec<ModuleRef>,
    pub external_kinds: Vec<((FileId, Atom), ExternalKind)>,
    pub(super) left_to_loader: Vec<((FileId, Atom, Option<Loader>), FileId)>,
    pub wrapped: WrappedModules,
    inner_modules: Vec<(FileId, FnId)>,
    runs_again: Vec<bool>,
    interops: Vec<Option<Interop>>,
    forms: Vec<(FileId, FileId)>,
    pub(super) forms_require_checks_first: Vec<(FileId, FileId)>,
    sibling_forms: Vec<(FileId, FileId, ImportTypeKind)>,
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
                ..
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

    pub(super) fn has_sibling_forms(&self) -> bool {
        !self.sibling_forms.is_empty()
    }

    pub(super) fn looks_for_forms_first(&self, module: ModuleRef) -> bool {
        let forms = &self.forms_require_checks_first;
        matches!(module, ModuleRef::File(file) if forms.binary_search_by_key(&file, |entry| entry.0).is_ok())
    }

    pub(super) fn sibling_forms_of_kind(
        &self,
        module: ModuleRef,
        kind: Option<ImportTypeKind>,
    ) -> impl Iterator<Item = ModuleRef> + '_ {
        let siblings = match module {
            ModuleRef::File(file) => {
                let start = self.sibling_forms.partition_point(|entry| entry.0 < file);
                let count = self.sibling_forms[start..].partition_point(|entry| entry.0 == file);
                &self.sibling_forms[start..start + count]
            }
            _ => &[],
        };
        let matching = siblings
            .iter()
            .filter(move |entry| kind.is_none_or(|kind| kind == entry.2));
        matching.map(|entry| ModuleRef::File(entry.1))
    }

    pub(super) fn table_file(&self, module: ModuleRef) -> Option<FileId> {
        match module {
            ModuleRef::File(file) if self.interop(module).has_export_table() => Some(file),
            _ => None,
        }
    }

    pub(super) fn find_inner_modules(
        &mut self,
        input: &BindInput<'_, '_>,
        run_again: &[ModuleRef],
    ) {
        for &module in run_again {
            if let ModuleRef::File(file) = module {
                self.runs_again[file.idx()] = true;
            }
        }
        let mut keeps_holders = self.runs_again.clone();
        let sources = input.sources;
        for entry_point in sources.entry_points() {
            keeps_holders[entry_point.file.idx()] |= entry_point.kind == EntryPointKind::Library;
        }
        self.wrapped = WrappedModules::compute(
            input.files,
            input.known_helpers,
            &|file: FileId| keeps_holders[file.idx()] || sources.kind(file) != SourceKind::Program,
            input.in_parallel,
        );
        let callbacks_of = |&file: &FileId| {
            let inner_modules = self.wrapped.of_file(file).iter();
            inner_modules.map(move |it| (file, it.callback))
        };
        let mut inner_modules: Vec<(FileId, FnId)> =
            self.compiled_files.iter().flat_map(callbacks_of).collect();
        inner_modules.shared_sort_unstable();
        self.inner_modules = inner_modules;
    }

    pub(super) fn runs_again(&self, file: FileId) -> bool {
        self.runs_again[file.idx()]
    }

    pub(super) fn inner_modules(&self) -> &[(FileId, FnId)] {
        &self.inner_modules
    }

    pub(super) fn inner_module_position(&self, file: FileId, callback: FnId) -> Option<usize> {
        self.inner_modules.binary_search(&(file, callback)).ok()
    }

    pub(super) fn is_uncompiled_code(&self, module: ModuleRef) -> bool {
        match module {
            ModuleRef::External {
                importer,
                specifier,
                ..
            } => match self.external_kind(importer, specifier) {
                ExternalKind::UncompiledCode => true,
                ExternalKind::HostValue => false,
            },
            _ => false,
        }
    }

    pub(super) fn module_behind(&self, module: ModuleRef) -> ModuleRef {
        let ModuleRef::External {
            importer,
            specifier,
            type_attribute,
        } = module
        else {
            return module;
        };
        let left = &self.left_to_loader;
        let key = statement_key((importer, specifier, type_attribute));
        let index = left.binary_search_by_key(&key, |entry| statement_key(entry.0));
        index.map_or(module, |index| ModuleRef::File(left[index].1))
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
    let mut compiled_files = files.compiled_files().to_vec();
    compiled_files.shared_sort_unstable();
    debug_assert!(compiled_files.is_sorted_by(|a, b| a < b));
    let mut interops: Vec<Option<Interop>> = vec![None; files.modules.len()];
    for &file in &compiled_files {
        interops[file.idx()] = Some(scans.of(file).interop);
    }
    let required_from_loader = match input.runs_in_place {
        true => compiled_files.clone(),
        false => find_files_required_from_loader(input, scans, &compiled_files),
    };
    for file in required_from_loader {
        if let Some(interop) = interops[file.idx()]
            .as_mut()
            .filter(|it| stands_for_string(input, file) && it.kind == ModuleKind::Data)
        {
            interop.require_result = RequireResult::Namespace;
        }
    }
    let holds_database = |file: FileId| {
        parsed_source(files, file)
            .is_some_and(|it| matches!(it.loader, Loader::Sqlite | Loader::SqliteEmbedded))
    };
    for &file in &compiled_files {
        if let Some(interop) = interops[file.idx()]
            .as_mut()
            .filter(|it| holds_database(file) && it.kind == ModuleKind::Data)
        {
            interop.require_result = RequireResult::Namespace;
        }
    }
    let forms = find_forms(input, &compiled_files, &interops);
    let sibling_forms = find_sibling_forms(input, &compiled_files, &interops);
    let forms_require_checks_first = answer_require_with_what_the_loader_holds(
        input,
        scans,
        &compiled_files,
        &forms,
        &mut interops,
    );
    for &file in &compiled_files {
        if let Some(interop) = interops[file.idx()].as_mut().filter(|it| {
            it.kind == ModuleKind::Data && it.require_result != RequireResult::Namespace
        }) {
            interop.answers_loader_with_namespace = stands_for_string(input, file);
        }
    }
    let mut other_modules = Vec::new();
    let mut external_kinds = Vec::new();
    let mut left_to_loader: Vec<((FileId, Atom, Option<Loader>), FileId)> = Vec::new();
    for &importer in &compiled_files {
        let scan = scans.of(importer);
        let answers = files
            .compiled(importer)
            .map_or(&[][..], |it| it.code_answers);
        for (site, answer) in scan.sites.iter().zip(answers) {
            if let (
                &ScannedSite::Module(ModuleRef::External {
                    importer,
                    specifier,
                    type_attribute,
                }),
                &CodeAnswer::File(file),
            ) = (site, answer)
            {
                left_to_loader.push(((importer, specifier, type_attribute), file));
            }
        }
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
                type_attribute: None,
            });
            external_kinds.push(((importer, specifier), ExternalKind::UncompiledCode));
        }
    }
    other_modules.shared_sort_unstable_by(|&a, &b| compare_modules(a, b, &files.atoms));
    other_modules.dedup();
    merge_external_kinds(&mut external_kinds);
    left_to_loader.shared_sort_unstable_by_key(|entry| statement_key(entry.0));
    left_to_loader.dedup();
    debug_assert!(left_to_loader.is_sorted_by(|a, b| statement_key(a.0) < statement_key(b.0)));
    let all_files = (0..interops.len() as u32).map(FileId);
    let with_record = all_files.filter(|file| interops[file.idx()].is_some());
    ModuleSet {
        forms,
        forms_require_checks_first,
        sibling_forms,
        compiled_files,
        record_files: with_record.collect(),
        other_modules,
        external_kinds,
        left_to_loader,
        wrapped: WrappedModules::default(),
        inner_modules: Vec::new(),
        runs_again: vec![false; interops.len()],
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
    let path_of = |file: FileId| input.sources.public_path(file);
    let forms_by_path = compiled_files.iter().filter(is_data).filter_map(|&form| {
        let path = path_of(form);
        let mark = strings::last_index_of_char(path, b'?')?;
        Some((&path[..mark], form))
    });
    let mut forms_by_path: Vec<(&[u8], FileId)> = forms_by_path.collect();
    if forms_by_path.is_empty() {
        return Vec::new();
    }
    forms_by_path.shared_sort_unstable();
    let mut forms: Vec<(FileId, FileId)> = Vec::new();
    for &file in compiled_files {
        let path = path_of(file);
        let first = forms_by_path.partition_point(|entry| entry.0 < path);
        let forms_of_file = forms_by_path[first..]
            .iter()
            .take_while(|entry| entry.0 == path);
        forms.extend(forms_of_file.map(|entry| (file, entry.1)));
    }
    debug_assert!(forms.is_sorted());
    forms
}

fn find_sibling_forms(
    input: &BindInput<'_, '_>,
    compiled_files: &[FileId],
    interops: &[Option<Interop>],
) -> Vec<(FileId, FileId, ImportTypeKind)> {
    let files = input.files;
    let is_data =
        |file: &&FileId| interops[file.idx()].is_some_and(|it| it.kind == ModuleKind::Data);
    let kind_of = |file: FileId| match files.compiled(file).map(|it| host_loader_kind(it.loader)) {
        Some(Some(HostLoaderKind::Loader(Loader::Json))) => ImportTypeKind::Json,
        Some(Some(HostLoaderKind::Loader(_))) => ImportTypeKind::HostDefined,
        Some(Some(HostLoaderKind::ByName) | None) | None => ImportTypeKind::None,
    };
    let path_of = |file: FileId| files.module(file).path.text;
    let typed = compiled_files.iter().filter(is_data);
    let typed = typed.filter(|&&file| kind_of(file) != ImportTypeKind::None);
    let mut typed_paths: Vec<&[u8]> = typed.map(|&file| path_of(file)).collect();
    if typed_paths.is_empty() {
        return Vec::new();
    }
    typed_paths.shared_sort_unstable();
    let forms = compiled_files.iter();
    let forms = forms.filter(|&&file| typed_paths.binary_search(&path_of(file)).is_ok());
    let mut forms: Vec<(&[u8], FileId)> = forms.map(|&file| (path_of(file), file)).collect();
    forms.shared_sort_unstable();
    let mut siblings = Vec::new();
    for same_path in forms.chunk_by(|form, next| form.0 == next.0) {
        for &(_, form) in same_path {
            let others = same_path.iter().map(|other| &other.1).filter(is_data);
            let others = others.filter(|&&other| other != form);
            siblings.extend(others.map(|&other| (form, other, kind_of(other))));
        }
    }
    siblings.shared_sort_unstable_by_key(|entry| (entry.0, entry.1));
    siblings
}

fn stands_for_string(input: &BindInput<'_, '_>, file: FileId) -> bool {
    parsed_source(input.files, file)
        .is_some_and(|it| matches!(it.loader, Loader::Text | Loader::Md))
}

fn answer_require_with_what_the_loader_holds(
    input: &BindInput<'_, '_>,
    scans: &Scans,
    compiled_files: &[FileId],
    forms: &[(FileId, FileId)],
    interops: &mut [Option<Interop>],
) -> Vec<(FileId, FileId)> {
    let mut is_any_imported = input.files_are_named_out_of_sight;
    let mut is_any_required = input.files_are_named_out_of_sight || input.hands_on_any_module;
    let mut is_imported = vec![false; interops.len()];
    let mut is_required = vec![false; interops.len()];
    for &importer in compiled_files {
        let scan = scans.of(importer);
        for &(_, file) in &scan.left_to_loader {
            is_imported[file.idx()] = true;
        }
        let sites = input.files.analysis(importer).import_sites.iter();
        for (site, scanned) in sites.zip(&scan.sites) {
            let (is_named, is_any_named) = match site.kind {
                ImportSiteKind::Import(_)
                | ImportSiteKind::ExportFrom(_)
                | ImportSiteKind::ExportStar(_)
                | ImportSiteKind::ImportCall(_)
                | ImportSiteKind::ImportByTestRunner(_) => (&mut is_imported, &mut is_any_imported),
                ImportSiteKind::ImportEquals(_)
                | ImportSiteKind::Require(_)
                | ImportSiteKind::ImportMetaRequire(_)
                | ImportSiteKind::RequireByTestRunner(_) => {
                    (&mut is_required, &mut is_any_required)
                }
                ImportSiteKind::JsxRuntime
                | ImportSiteKind::JsxPackage
                | ImportSiteKind::RequireResolve(_)
                | ImportSiteKind::ImportMetaResolve(_)
                | ImportSiteKind::GetBuiltinModule(_)
                | ImportSiteKind::MockModule(_) => continue,
            };
            let mut name = |module: ModuleRef| {
                if let ModuleRef::File(file) = module {
                    is_named[file.idx()] = true;
                }
            };
            match scanned {
                &ScannedSite::Module(module) => name(module),
                ScannedSite::Candidates(range) => scan.modules_spelled_in(range).for_each(name),
                ScannedSite::AllModules => *is_any_named = true,
                ScannedSite::Unresolved | ScannedSite::Erased => {}
            }
        }
    }
    for &file in compiled_files {
        let is_named_both_ways = (is_any_imported || is_imported[file.idx()])
            && (is_any_required || is_required[file.idx()]);
        let is_text = stands_for_string(input, file);
        let is_value = is_text
            || parsed_source(input.files, file)
                .is_some_and(|it| parses_text_as_data(it.loader) || it.loader == Loader::Css);
        if let Some(interop) = interops[file.idx()].as_mut().filter(|it| {
            is_named_both_ways
                && is_value
                && it.kind == ModuleKind::Data
                && it.require_result == RequireResult::DefaultExport
        }) {
            interop.require_result = match is_text && is_imported[file.idx()] {
                true => RequireResult::Namespace,
                false => RequireResult::NamespaceIfImported,
            };
        }
    }
    let mut checked_first: Vec<(FileId, FileId)> = Vec::new();
    for &(file, form) in forms {
        let Some(interop) = interops[file.idx()].filter(|it| it.kind == ModuleKind::Data) else {
            continue;
        };
        let is_read_by_require =
            interop.require_result != RequireResult::Namespace || stands_for_string(input, file);
        if !is_read_by_require || !(is_any_required || is_required[file.idx()]) {
            continue;
        }
        let is_first_form = checked_first.last().is_none_or(|last| last.0 != file);
        if is_first_form && interop.require_result == RequireResult::NamespaceIfImported {
            checked_first.push((file, file));
        }
        checked_first.push((file, form));
    }
    checked_first.extend(find_paths_that_answer_in_place_of_code(
        input,
        compiled_files,
        interops,
    ));
    for &(_, form) in &checked_first {
        if let Some(interop) = &mut interops[form.idx()] {
            interop.require_result = RequireResult::NamespaceIfImported;
        }
    }
    let is_read_as_json =
        |form: FileId| parsed_source(input.files, form).is_some_and(|it| it.loader == Loader::Json);
    checked_first.shared_sort_unstable_by_key(|&(file, form)| {
        (file, form != file, is_read_as_json(form), form)
    });
    checked_first
}

fn find_paths_that_answer_in_place_of_code(
    input: &BindInput<'_, '_>,
    compiled_files: &[FileId],
    interops: &mut [Option<Interop>],
) -> Vec<(FileId, FileId)> {
    if !input.runs_in_place {
        return Vec::new();
    }
    let path_of = |file: FileId| input.sources.public_path(file);
    let mut paths: Vec<(&[u8], FileId)> = Vec::new();
    for &file in compiled_files {
        let is_path = parsed_source(input.files, file).is_some_and(|it| it.loader == Loader::File)
            && loader_named_by_path(DEFAULT_LOADERS, path_of(file)).is_none();
        if let Some(interop) = interops[file.idx()]
            .as_mut()
            .filter(|it| is_path && it.kind == ModuleKind::Data)
        {
            interop.require_result = RequireResult::NamespaceIfImported;
            paths.push((path_of(file), file));
        }
    }
    paths.shared_sort_unstable();
    let is_code =
        |file: &&FileId| interops[file.idx()].is_some_and(|it| it.kind != ModuleKind::Data);
    let answered = compiled_files.iter().filter(is_code).filter_map(|&code| {
        let path = path_of(code);
        let mark = strings::last_index_of_char(path, b'?')?;
        let at = paths.binary_search_by(|entry| entry.0.cmp(&path[..mark]));
        Some((code, paths[at.ok()?].1))
    });
    answered.collect()
}

fn find_files_required_from_loader(
    input: &BindInput<'_, '_>,
    scans: &Scans,
    compiled_files: &[FileId],
) -> Vec<FileId> {
    let mut found = Vec::new();
    for &importer in compiled_files {
        let scan = scans.of(importer);
        let (hir, bound) = (input.files.hir(importer), input.files.bound(importer));
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
                    if !is_linked_by_bundler(hir, bound, site.kind)
                        || is_named_with_query(input, module)
                    {
                        add(module);
                    }
                }
                ScannedSite::Candidates(range) => {
                    scan.modules_spelled_in(range).for_each(&mut add);
                }
                ScannedSite::AllModules | ScannedSite::Unresolved | ScannedSite::Erased => {}
            }
        }
    }
    found
}

fn is_named_with_query(input: &BindInput<'_, '_>, module: ModuleRef) -> bool {
    let ModuleRef::File(file) = module else {
        return false;
    };
    parsed_source(input.files, file).is_some_and(|source| source.file_with_query.is_some())
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

fn statement_key(key: (FileId, Atom, Option<Loader>)) -> (FileId, u32, Option<u8>) {
    (key.0, key.1.0, key.2.map(|it| it as u8))
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
